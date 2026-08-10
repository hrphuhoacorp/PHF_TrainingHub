'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { KNL_SCOPE_TYPES } = require('./knl-scope');

const configured = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const supabase = configured
  ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

const TABLE = 'knl_permission_grants';
const HISTORY_TABLE = 'knl_permission_grant_history';

// Đã chốt trong yêu cầu (mục 7). propose/agree_proposal/approve/manage_framework
// được chuẩn bị sẵn trong data model cho tương lai nhưng CHƯA có workflow —
// Step 1 chỉ thật sự enforce access_knl/view_people/manage_permissions.
// income_view (batch "quyền dữ liệu nhạy cảm"): CHỈ mang nghĩa "Truy cập mục
// Thu nhập" — chưa có menu/API/nội dung Thu nhập thật, KHÔNG suy diễn field
// lương ở đây. Enforce giống các key khác qua capabilities()/requireX(), trừ
// một ngoại lệ cho Admin ở resolveActorGrant() (xem ghi chú ở đó).
const CAPABILITY_KEYS = ['access_knl', 'view_people', 'propose', 'agree_proposal', 'approve', 'manage_framework', 'manage_permissions', 'income_view'];

// Preset chỉ là GỢI Ý điền sẵn form (mục 9) — Admin sửa tự do theo từng account,
// không hard-code chức danh -> quyền bất biến. income_view mặc định false ở
// mọi preset (kể cả Trợ lý GĐ) — đây là quyền ngoại lệ phải cấp riêng, không
// đi kèm preset nào theo đúng nghiệp vụ đã chốt.
const PRESETS = Object.freeze({
  NHAN_VIEN: {
    name: 'Nhân viên',
    capabilities: { access_knl: true, view_people: true, propose: false, agree_proposal: false, approve: false, manage_framework: false, manage_permissions: false, income_view: false },
    peopleScope: { type: 'self', values: [], reservedEmployees: [] }
  },
  TRUONG_CA_CHTR: {
    name: 'Trưởng ca / Cửa hàng trưởng',
    capabilities: { access_knl: true, view_people: true, propose: false, agree_proposal: false, approve: false, manage_framework: false, manage_permissions: false, income_view: false },
    peopleScope: { type: 'sales_all_branches', values: [], reservedEmployees: [] }
  },
  TRUONG_BO_PHAN: {
    name: 'Trưởng bộ phận',
    capabilities: { access_knl: true, view_people: true, propose: false, agree_proposal: false, approve: false, manage_framework: false, manage_permissions: false, income_view: false },
    // TBP quản lý danh sách nhân sự cụ thể do Admin gán (many-to-many qua
    // values), KHÔNG tự suy theo phòng ban — xem KNL Permission Audit.
    peopleScope: { type: 'employees', values: [], reservedEmployees: [] }
  },
  TRO_LY_GD: {
    name: 'Trợ lý Giám đốc trở lên',
    capabilities: { access_knl: true, view_people: true, propose: false, agree_proposal: false, approve: false, manage_framework: false, manage_permissions: false, income_view: false },
    peopleScope: { type: 'all_company', values: [], reservedEmployees: [] }
  },
  CUSTOM: {
    name: 'Tùy chỉnh',
    capabilities: { access_knl: false, view_people: false, propose: false, agree_proposal: false, approve: false, manage_framework: false, manage_permissions: false, income_view: false },
    peopleScope: { type: 'self', values: [], reservedEmployees: [] }
  }
});

function text(value) { return String(value == null ? '' : value).trim(); }
function fail(message, statusCode = 400, code = 'KNL_PERMISSION_INVALID') { const error = new Error(message); error.statusCode = statusCode; error.code = code; throw error; }
function ensureDb() { if (!supabase) fail('Supabase chưa được cấu hình để lưu phân quyền KNL.', 503, 'SUPABASE_NOT_CONFIGURED'); }

/* KHÔNG bắt lỗi rồi âm thầm trả rỗng/bỏ qua permission — chỉ dịch đúng loại lỗi
 * "bảng KNL chưa tồn tại" (PostgREST PGRST205 / Postgres 42P01) thành thông điệp
 * hành động được, thay vì để publicError() rơi vào nhánh 500 chung chung
 * "Hệ thống chưa thể xử lý yêu cầu". Mọi lỗi khác được throw nguyên vẹn. */
function throwDb(error) {
  if (!error) return;
  const code = text(error.code);
  const message = text(error.message);
  if (code === 'PGRST205' || code === '42P01' || /relation .* does not exist/i.test(message) || /Could not find the table/i.test(message)) {
    fail('Bảng phân quyền KNL (knl_permission_grants/knl_permission_grant_history) chưa được tạo trên Supabase. Vui lòng chạy scripts/PHF_KNL_PERMISSIONS_1.0.sql rồi thử lại.', 503, 'KNL_SCHEMA_MISSING');
  }
  throw error;
}

function actor(session) {
  return {
    id: text(session?.account?.id || session?.sub),
    name: text(session?.account?.name || session?.account?.email || session?.email),
    employeeCode: text(session?.employeeId || session?.account?.employeeCode).toUpperCase() || text(session?.account?.employeeCode).toUpperCase(),
    department: text(session?.account?.department),
    role: text(session?.role).toLowerCase()
  };
}

function normalizeScopeList(value) {
  return Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))].slice(0, 20) : [];
}

/* KNL Permission Audit (batch "reserve TBP") — invariant bắt buộc:
 * type==='employees' <=> reservedEmployees luôn []/vắng mặt; ngược lại
 * (type khác) thì values active luôn [] và reservedEmployees (nếu có) giữ
 * danh sách TBP gần nhất để phục hồi. existingScope là people_scope của
 * ĐÚNG row đang active của account này (nếu có) trước lượt lưu này — lấy từ
 * lookup account_id+is_active=true sẵn có ở upsertKnlPermissionGrant(), không
 * đổi cơ chế tìm row. Restore luôn chạy TRƯỚC validate "employees cần ít
 * nhất 1 người" để lượt phục hồi tự động không bị chính validate đó chặn. */
function scope(value, fallback, existingScope) {
  const source = value && typeof value === 'object' ? value : {};
  const type = text(source.type || fallback).toLowerCase();
  if (!KNL_SCOPE_TYPES.has(type)) fail('Phạm vi phân quyền KNL không hợp lệ: ' + type, 400, 'KNL_PERMISSION_SCOPE_INVALID');

  const prior = existingScope && typeof existingScope === 'object' ? existingScope : {};
  const priorType = text(prior.type).toLowerCase();
  const priorValues = normalizeScopeList(prior.values);
  const priorReserved = normalizeScopeList(prior.reservedEmployees);

  let values = normalizeScopeList(source.values);
  let reservedEmployees = priorReserved; // mặc định: không đổi gì liên quan employees

  if (type === 'employees') {
    if (!values.length && priorReserved.length) values = priorReserved; // Case C: cấp lại, không chọn ai -> auto-restore
    reservedEmployees = []; // invariant: đang active employees thì reserve luôn rỗng (Case A/D)
  } else if (priorType === 'employees' && priorValues.length) {
    reservedEmployees = priorValues; // Case B: vừa rời khỏi employees -> lưu lại đúng danh sách lúc rời
  }
  // else: type khác và priorType cũng không phải employees -> reservedEmployees giữ nguyên priorReserved (Case B tiếp diễn, ví dụ đổi role khác lần nữa)

  if (type === 'department' && !values.length) fail('Phạm vi "Bộ phận" cần chọn ít nhất một phòng ban.', 400, 'KNL_PERMISSION_SCOPE_VALUES_REQUIRED');
  if (type === 'employees' && !values.length) fail('Phạm vi "Nhân sự cụ thể" cần chọn ít nhất một nhân sự.', 400, 'KNL_PERMISSION_SCOPE_VALUES_REQUIRED');

  return { type, values, reservedEmployees };
}

function capabilities(value) {
  const source = value && typeof value === 'object' ? value : {};
  const result = {};
  CAPABILITY_KEYS.forEach(key => { result[key] = source[key] === true; });
  return result;
}

const INCOME_SCOPE_TYPES = Object.freeze(new Set(['all_company', 'employees']));

/* PHF HR – KNL PERMISSION UX POLISH + INCOME SCOPE — phạm vi xem "Thu nhập"
 * là khái niệm HOÀN TOÀN RIÊNG với people_scope (phạm vi nghiệp vụ KNL/TBP) -
 * không tái sử dụng scope()/subjectMatchesScope() của people_scope, không có
 * reserve/restore (income scope không cần giữ lịch sử, chỉ cần đúng lựa chọn
 * hiện tại - tắt income_view thì key này không được ghi lại ở lượt lưu kế
 * tiếp, xem normalizeGrant()). Lưu trong CHÍNH cột `capabilities` jsonb đã có
 * (không ALTER TABLE) dưới key `incomeScope`, KHÔNG phải cột/bảng mới -
 * capabilities() ở trên chỉ chuẩn hoá các key boolean, incomeScope được gắn
 * riêng ở normalizeGrant() sau khi gọi capabilities(). publicGrant() đã
 * forward nguyên row.capabilities (không qua capabilities()) nên đọc lại tự
 * hoạt động, không cần sửa gì cho chiều đọc.
 *
 * "Không dùng quy tắc ngầm danh sách rỗng = xem tất cả": value=null/undefined
 * (chưa từng chọn) là hợp lệ ở ĐÂY (hàm chỉ chuẩn hoá, không quyết định có
 * bắt buộc hay không) - normalizeGrant() mới là nơi ép buộc "income_view=true
 * thì incomeScope bắt buộc phải có". */
function normalizeIncomeScope(value) {
  if (value == null) return null;
  const source = value && typeof value === 'object' ? value : {};
  const type = text(source.type).toLowerCase();
  if (!INCOME_SCOPE_TYPES.has(type)) fail('Phạm vi xem Thu nhập không hợp lệ: ' + type, 400, 'KNL_INCOME_SCOPE_INVALID');
  const values = type === 'employees' ? normalizeScopeList(source.values) : [];
  if (type === 'employees' && !values.length) fail('Phạm vi "Chọn nhân sự cụ thể" (Thu nhập) cần chọn ít nhất một nhân sự.', 400, 'KNL_INCOME_SCOPE_VALUES_REQUIRED');
  return { type, values };
}

/* Admin hệ thống (role='admin' ở Hub) LUÔN có full quyền KNL bất kể bảng
 * knl_permission_grants có dòng nào hay không — đây chính là "đường cứu hộ"
 * bắt buộc ở mục 11: vì đường cứu hộ độc lập hoàn toàn với dữ liệu trong
 * bảng grants, không có kịch bản nào Admin tự khóa mình khỏi KNL/Phân quyền
 * dù cấu hình quyền bị sai. Không cần thêm guard "last manage_permissions"
 * runtime nào khác — đủ và tối thiểu cho Step 1.
 *
 * income_view LÀ NGOẠI LỆ DUY NHẤT trong đường cứu hộ này (đã chốt trong
 * KNL Permission Audit): mặc định true cho Admin, nhưng nếu Admin đó có 1
 * grant row active với capabilities.income_view === false tường minh (không
 * phải chỉ "vắng mặt" - vắng mặt vẫn coi là true, giữ đúng ý "mặc định bật")
 * thì bị override false - tức là RECALL được. Đọc DB ở đây là bonus-check
 * best-effort: nếu Supabase chưa cấu hình / bảng KNL chưa tồn tại / query lỗi
 * mạng, KHÔNG throw và KHÔNG khoá Admin - chỉ đơn giản không xác nhận được
 * override nào nên giữ mặc định true, đúng tinh thần "đường cứu hộ" không
 * bao giờ tự khoá Admin vì lỗi hạ tầng. 6 capability cứu hộ còn lại (không
 * phải income_view) giữ nguyên hard-code true tuyệt đối, không đổi. */
async function resolveAdminIncomeViewOverride(accountId) {
  if (!accountId || !supabase) return true;
  try {
    const { data } = await supabase.from(TABLE).select('capabilities').eq('account_id', accountId).eq('is_active', true).limit(1).maybeSingle();
    if (data && data.capabilities && data.capabilities.income_view === false) return false;
  } catch (_e) { /* best-effort: giữ mặc định true, không throw */ }
  return true;
}
async function resolveActorGrant(session) {
  const a = actor(session);
  if (a.role === 'admin') {
    return {
      source: 'admin_recovery',
      presetCode: 'ADMIN_RECOVERY',
      capabilities: capabilities({ access_knl: true, view_people: true, propose: true, agree_proposal: true, approve: true, manage_framework: true, manage_permissions: true, income_view: true }),
      peopleScope: { type: 'all_company', values: [], reservedEmployees: [] },
      row: null,
      identity: a
    };
  }
  if (!a.id) return { source: 'none', presetCode: '', capabilities: capabilities({}), peopleScope: { type: 'self', values: [], reservedEmployees: [] }, row: null, identity: a };
  ensureDb();
  const { data, error } = await supabase.from(TABLE).select('*').eq('account_id', a.id).eq('is_active', true).limit(1).maybeSingle();
  throwDb(error);
  if (!data) return { source: 'none', presetCode: '', capabilities: capabilities({}), peopleScope: { type: 'self', values: [], reservedEmployees: [] }, row: null, identity: a };
  return { source: 'grant', presetCode: data.preset_code || '', capabilities: capabilities(data.capabilities), peopleScope: data.people_scope || { type: 'self', values: [], reservedEmployees: [] }, row: data, identity: a };
}

function requireAccessKnl(resolved) {
  if (!resolved.capabilities.access_knl) fail('Tài khoản chưa được cấp quyền truy cập KNL.', 403, 'KNL_ACCESS_DENIED');
}
function requireManagePermissions(resolved) {
  if (!resolved.capabilities.manage_permissions) fail('Chỉ người được cấp quyền "Quản lý phân quyền KNL" mới thao tác được màn này.', 403, 'KNL_MANAGE_PERMISSIONS_REQUIRED');
}
function requireManageFramework(resolved) {
  if (!resolved.capabilities.manage_framework) fail('Tài khoản chưa được cấp quyền quản lý cấu trúc KNL.', 403, 'KNL_MANAGE_FRAMEWORK_REQUIRED');
}

async function getKnlCapabilities(session) {
  const resolved = await resolveActorGrant(session);
  return {
    isAdmin: resolved.source === 'admin_recovery',
    presetCode: resolved.presetCode,
    capabilities: resolved.capabilities,
    peopleScope: resolved.peopleScope
  };
}

function publicGrant(row = {}) {
  return {
    id: row.id || '',
    accountId: row.account_id || '',
    employeeCode: row.employee_code || '',
    employeeName: row.employee_name || '',
    presetCode: row.preset_code || '',
    capabilities: row.capabilities || {},
    peopleScope: row.people_scope || { type: 'self', values: [], reservedEmployees: [] },
    reason: row.reason || '',
    isActive: row.is_active === true,
    updatedAt: row.updated_at || '',
    updatedByName: row.updated_by_name || ''
  };
}

/* existing = row đang active hiện tại của account này (nếu có), lấy từ lookup
 * account_id+is_active=true sẵn có ở upsertKnlPermissionGrant() - KHÔNG đổi
 * cơ chế tìm row đang active. Luôn đi qua scope() kể cả khi view_people=false
 * để invariant reserve (mục "reserve TBP") áp dụng nhất quán, không có nhánh
 * tắt riêng bỏ qua reserve khi Admin tắt hẳn view_people. */
function normalizeGrant(input = {}, existing = null) {
  const accountId = text(input.accountId || input.account_id);
  if (!accountId) fail('Phải chọn tài khoản Hub cần cấp quyền.', 400, 'KNL_PERMISSION_ACCOUNT_REQUIRED');
  const presetCode = text(input.presetCode || input.preset_code || 'CUSTOM').toUpperCase();
  if (!PRESETS[presetCode]) fail('Nhóm quyền không tồn tại.', 400, 'KNL_PERMISSION_PRESET_INVALID');
  const reason = text(input.reason);
  if (reason.length < 5) fail('Lý do cấp hoặc thay đổi quyền cần tối thiểu 5 ký tự.', 400, 'KNL_PERMISSION_REASON_REQUIRED');
  const preset = PRESETS[presetCode];
  const normalizedCapabilities = capabilities(input.capabilities || preset.capabilities);
  const requestedScope = normalizedCapabilities.view_people ? (input.peopleScope || input.people_scope) : { type: 'self', values: [] };
  const peopleScope = scope(requestedScope, preset.peopleScope.type, existing ? existing.people_scope : null);
  /* income_view=true bắt buộc phải có incomeScope hợp lệ (Admin phải chủ
   * động chọn "Tất cả nhân sự" hoặc "Chọn nhân sự cụ thể" - không suy diễn
   * từ danh sách rỗng). income_view=false thì KHÔNG ghi incomeScope vào
   * capabilities đang chuẩn hoá - lần lưu tới cột capabilities bị ghi đè
   * toàn bộ (update, không merge) nên incomeScope cũ (nếu có) biến mất hẳn,
   * không còn sót lại để lỡ tham gia enforcement sau này. */
  const capabilitiesSource = input.capabilities || preset.capabilities || {};
  if (normalizedCapabilities.income_view) {
    const incomeScopeValue = normalizeIncomeScope(capabilitiesSource.incomeScope || capabilitiesSource.income_scope);
    if (!incomeScopeValue) fail('Vui lòng chọn phạm vi xem Thu nhập (Tất cả nhân sự hoặc Chọn nhân sự cụ thể).', 400, 'KNL_INCOME_SCOPE_REQUIRED');
    normalizedCapabilities.incomeScope = incomeScopeValue;
  }
  return {
    id: text(input.id) || null,
    account_id: accountId,
    employee_code: text(input.employeeCode || input.employee_code).toUpperCase() || null,
    employee_name: text(input.employeeName || input.employee_name) || null,
    preset_code: presetCode,
    capabilities: normalizedCapabilities,
    people_scope: peopleScope,
    reason,
    is_active: input.isActive !== false && input.is_active !== false
  };
}

async function audit(session, grantId, action, beforeData, afterData, reason) {
  const a = actor(session);
  const { error } = await supabase.from(HISTORY_TABLE).insert({
    grant_id: grantId,
    action,
    before_data: beforeData || {},
    after_data: afterData || {},
    reason: text(reason),
    changed_by: a.id || null,
    changed_by_name: a.name || null
  });
  throwDb(error);
}

async function listKnlPermissionGrants(session) {
  ensureDb();
  const resolved = await resolveActorGrant(session);
  requireManagePermissions(resolved);
  const { data, error } = await supabase.from(TABLE).select('*').order('is_active', { ascending: false }).order('updated_at', { ascending: false }).limit(1000);
  throwDb(error);
  return {
    grants: (data || []).map(publicGrant),
    presets: Object.entries(PRESETS).map(([code, p]) => ({ code, name: p.name, capabilities: p.capabilities, peopleScope: p.peopleScope })),
    scopeTypes: [...KNL_SCOPE_TYPES],
    capabilityKeys: CAPABILITY_KEYS
  };
}

async function upsertKnlPermissionGrant(session, input = {}) {
  ensureDb();
  const resolved = await resolveActorGrant(session);
  requireManagePermissions(resolved);
  const accountId = text(input.accountId || input.account_id);
  if (!accountId) fail('Phải chọn tài khoản Hub cần cấp quyền.', 400, 'KNL_PERMISSION_ACCOUNT_REQUIRED');
  /* Lookup KHÔNG đổi so với trước (vẫn account_id+is_active=true) - chỉ đổi
   * THỨ TỰ: fetch existing TRƯỚC normalizeGrant() để scope() có
   * existing.people_scope làm cơ sở tính reservedEmployees. Không mở thêm
   * behavior tìm/re-activate theo id cho row đang inactive (đã trace: đổi
   * preset TBP<->role khác luôn UPDATE cùng 1 row đang active, không đụng
   * is_active - xem KNL Permission Audit phần "reserve TBP"). */
  const { data: existing, error: existingError } = await supabase.from(TABLE).select('*').eq('account_id', accountId).eq('is_active', true).limit(1).maybeSingle();
  throwDb(existingError);
  const row = normalizeGrant(input, existing);
  const a = actor(session);
  const targetId = row.id || existing?.id || null;
  let action = 'create', beforeData = {};
  if (existing) {
    beforeData = existing;
    action = row.is_active === false ? 'disable' : (existing.is_active === false && row.is_active === true ? 'enable' : 'update');
  }
  const writeRow = {
    account_id: row.account_id,
    employee_code: row.employee_code,
    employee_name: row.employee_name,
    preset_code: row.preset_code,
    capabilities: row.capabilities,
    people_scope: row.people_scope,
    reason: row.reason,
    is_active: row.is_active,
    updated_by: a.id || null,
    updated_by_name: a.name || null,
    updated_at: new Date().toISOString()
  };
  let saved;
  if (targetId) {
    const { data, error } = await supabase.from(TABLE).update(writeRow).eq('id', targetId).select('*').single();
    throwDb(error);
    saved = data;
  } else {
    const { data, error } = await supabase.from(TABLE).insert({ ...writeRow, created_by: a.id || null, created_by_name: a.name || null }).select('*').single();
    throwDb(error);
    saved = data;
  }
  await audit(session, saved.id, action, beforeData, saved, row.reason);
  return { grant: publicGrant(saved) };
}

async function requireManagePermissionsForSession(session) {
  const resolved = await resolveActorGrant(session);
  requireManagePermissions(resolved);
  return resolved;
}

async function requireManageFrameworkForSession(session) {
  const resolved = await resolveActorGrant(session);
  requireManageFramework(resolved);
  return resolved;
}

module.exports = {
  PRESETS,
  CAPABILITY_KEYS,
  resolveActorGrant,
  requireAccessKnl,
  requireManagePermissions,
  requireManageFramework,
  requireManagePermissionsForSession,
  requireManageFrameworkForSession,
  getKnlCapabilities,
  listKnlPermissionGrants,
  upsertKnlPermissionGrant
};
