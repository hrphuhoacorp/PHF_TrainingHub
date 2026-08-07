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
const CAPABILITY_KEYS = ['access_knl', 'view_people', 'propose', 'agree_proposal', 'approve', 'manage_framework', 'manage_permissions'];

// Preset chỉ là GỢI Ý điền sẵn form (mục 9) — Admin sửa tự do theo từng account,
// không hard-code chức danh -> quyền bất biến.
const PRESETS = Object.freeze({
  NHAN_VIEN: {
    name: 'Nhân viên',
    capabilities: { access_knl: true, view_people: true, propose: false, agree_proposal: false, approve: false, manage_framework: false, manage_permissions: false },
    peopleScope: { type: 'self', values: [] }
  },
  TRUONG_CA_CHTR: {
    name: 'Trưởng ca / Cửa hàng trưởng',
    capabilities: { access_knl: true, view_people: true, propose: false, agree_proposal: false, approve: false, manage_framework: false, manage_permissions: false },
    peopleScope: { type: 'sales_all_branches', values: [] }
  },
  TRUONG_BO_PHAN: {
    name: 'Trưởng bộ phận',
    capabilities: { access_knl: true, view_people: true, propose: false, agree_proposal: false, approve: false, manage_framework: false, manage_permissions: false },
    peopleScope: { type: 'department', values: [] }
  },
  TRO_LY_GD: {
    name: 'Trợ lý Giám đốc trở lên',
    capabilities: { access_knl: true, view_people: true, propose: false, agree_proposal: false, approve: false, manage_framework: false, manage_permissions: false },
    peopleScope: { type: 'all_company', values: [] }
  },
  CUSTOM: {
    name: 'Tùy chỉnh',
    capabilities: { access_knl: false, view_people: false, propose: false, agree_proposal: false, approve: false, manage_framework: false, manage_permissions: false },
    peopleScope: { type: 'self', values: [] }
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

function scope(value, fallback = 'self') {
  const source = value && typeof value === 'object' ? value : {};
  const type = text(source.type || fallback).toLowerCase();
  if (!KNL_SCOPE_TYPES.has(type)) fail('Phạm vi phân quyền KNL không hợp lệ: ' + type, 400, 'KNL_PERMISSION_SCOPE_INVALID');
  const values = Array.isArray(source.values) ? [...new Set(source.values.map(text).filter(Boolean))].slice(0, 20) : [];
  if (type === 'department' && !values.length) fail('Phạm vi "Bộ phận" cần chọn ít nhất một phòng ban.', 400, 'KNL_PERMISSION_SCOPE_VALUES_REQUIRED');
  return { type, values };
}

function capabilities(value) {
  const source = value && typeof value === 'object' ? value : {};
  const result = {};
  CAPABILITY_KEYS.forEach(key => { result[key] = source[key] === true; });
  return result;
}

/* Admin hệ thống (role='admin' ở Hub) LUÔN có full quyền KNL bất kể bảng
 * knl_permission_grants có dòng nào hay không — đây chính là "đường cứu hộ"
 * bắt buộc ở mục 11: vì đường cứu hộ độc lập hoàn toàn với dữ liệu trong
 * bảng grants, không có kịch bản nào Admin tự khóa mình khỏi KNL/Phân quyền
 * dù cấu hình quyền bị sai. Không cần thêm guard "last manage_permissions"
 * runtime nào khác — đủ và tối thiểu cho Step 1. */
async function resolveActorGrant(session) {
  const a = actor(session);
  if (a.role === 'admin') {
    return { source: 'admin_recovery', presetCode: 'ADMIN_RECOVERY', capabilities: capabilities({ access_knl: true, view_people: true, propose: true, agree_proposal: true, approve: true, manage_framework: true, manage_permissions: true }), peopleScope: { type: 'all_company', values: [] }, row: null, identity: a };
  }
  if (!a.id) return { source: 'none', presetCode: '', capabilities: capabilities({}), peopleScope: { type: 'self', values: [] }, row: null, identity: a };
  ensureDb();
  const { data, error } = await supabase.from(TABLE).select('*').eq('account_id', a.id).eq('is_active', true).limit(1).maybeSingle();
  throwDb(error);
  if (!data) return { source: 'none', presetCode: '', capabilities: capabilities({}), peopleScope: { type: 'self', values: [] }, row: null, identity: a };
  return { source: 'grant', presetCode: data.preset_code || '', capabilities: capabilities(data.capabilities), peopleScope: data.people_scope || { type: 'self', values: [] }, row: data, identity: a };
}

function requireAccessKnl(resolved) {
  if (!resolved.capabilities.access_knl) fail('Tài khoản chưa được cấp quyền truy cập KNL.', 403, 'KNL_ACCESS_DENIED');
}
function requireManagePermissions(resolved) {
  if (!resolved.capabilities.manage_permissions) fail('Chỉ người được cấp quyền "Quản lý phân quyền KNL" mới thao tác được màn này.', 403, 'KNL_MANAGE_PERMISSIONS_REQUIRED');
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
    peopleScope: row.people_scope || { type: 'self', values: [] },
    reason: row.reason || '',
    isActive: row.is_active === true,
    updatedAt: row.updated_at || '',
    updatedByName: row.updated_by_name || ''
  };
}

function normalizeGrant(input = {}) {
  const accountId = text(input.accountId || input.account_id);
  if (!accountId) fail('Phải chọn tài khoản Hub cần cấp quyền.', 400, 'KNL_PERMISSION_ACCOUNT_REQUIRED');
  const presetCode = text(input.presetCode || input.preset_code || 'CUSTOM').toUpperCase();
  if (!PRESETS[presetCode]) fail('Nhóm quyền không tồn tại.', 400, 'KNL_PERMISSION_PRESET_INVALID');
  const reason = text(input.reason);
  if (reason.length < 5) fail('Lý do cấp hoặc thay đổi quyền cần tối thiểu 5 ký tự.', 400, 'KNL_PERMISSION_REASON_REQUIRED');
  const preset = PRESETS[presetCode];
  const normalizedCapabilities = capabilities(input.capabilities || preset.capabilities);
  const peopleScope = normalizedCapabilities.view_people ? scope(input.peopleScope || input.people_scope, preset.peopleScope.type) : { type: 'self', values: [] };
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
  const row = normalizeGrant(input);
  const a = actor(session);
  const { data: existing, error: existingError } = await supabase.from(TABLE).select('*').eq('account_id', row.account_id).eq('is_active', true).limit(1).maybeSingle();
  throwDb(existingError);
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

module.exports = {
  PRESETS,
  CAPABILITY_KEYS,
  resolveActorGrant,
  requireAccessKnl,
  requireManagePermissions,
  requireManagePermissionsForSession,
  getKnlCapabilities,
  listKnlPermissionGrants,
  upsertKnlPermissionGrant
};
