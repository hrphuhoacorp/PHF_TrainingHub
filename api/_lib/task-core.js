'use strict';

/*
 * PHF Task V1 — Batch 2: command-based write layer cho SINGLE TASK.
 *
 * KHÔNG có generic saveTask(taskObject) — mỗi command dưới đây là 1 hàm rõ
 * ràng, tự validate input + tự resolve field nào được ghi. Client không bao
 * giờ là authority: mọi command đều (1) resolve actor qua
 * lib/task-employee-scope.js, (2) check permission qua
 * lib/task-permissions.js (KHÔNG duplicate permission logic ở đây), (3)
 * validate expected row_version, (4) ghi qua RPC atomic khi cần 2+ statement
 * (xem scripts/PHF_TASK_CORE_RPC_1.67.0.sql — LOCAL CANDIDATE, CHƯA APPLY).
 *
 * ATOMICITY: createDraft(+initial primary), publish/progress/complete/reopen/
 * cancel/deadline_change/transfer/addRelated/addLink đi qua RPC (1 transaction
 * thật). updateDraft là 1 PostgREST statement nên tự atomic. removeRelated/
 * addComment/removeLink vẫn là 2 call rời theo phạm vi Batch 2 hiện hữu.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { resolveActorContext, resolveActorContextForRecord, loadOrgRows, findByCode, TASK_PRESET_TO_ACTOR_TYPE } = require('./task-employee-scope');
const {
  resolveBaseTaskScope,
  resolveEffectiveTaskScope,
  resolveEffectiveTaskScopeForActorContext,
  resolveEffectiveTaskScopesForActorContexts,
  TASK_PRESET_CODES,
  requireTaskCapability,
  classifyTaskRelation,
  canViewTask,
  canUpdateTask,
  canAssignTaskTo,
  canAddTaskRelated,
  listTaskAssignableEmployees: listAssignableEmployeesFromPeopleMaster,
  subjectMatchesTaskScope,
  loadActiveTaskAssignment
} = require('./task-permissions');
const { listHubAccountSummaries } = require('./auth');
const { emitTaskNotificationSafe } = require('./task-notifications');

// MANAGER_VIEW_ACTOR_TYPES — CÙNG danh sách canonical đã dùng ở
// task-permissions.js canViewTask() cho quan hệ manager_of_primary (KHÔNG
// tạo định nghĩa "quản lý phòng nhận" mới/khác — Cross-department V1 tái
// dùng NGUYÊN quan hệ manager_employee_code + actor type đã sống, đã test,
// KHÔNG suy diễn theo title/chức danh — xem audit đầu
// scripts/PHF_TASK_CROSS_DEPARTMENT_NOTIFICATION_1.72.0.sql).
const CROSS_DEPT_MANAGER_ACTOR_TYPES = new Set(['truong_bo_phan', 'truong_ca', 'giam_doc', 'tro_ly_gd']);

const configured = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const supabase = configured
  ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

// ---------------------------------------------------------------------------
// checkTaskFoundationStatus — READ-ONLY, không write. Cho UI (Tạo phiếu,
// Cài đặt) biết trung thực RPC/cột cần thiết đã sẵn sàng trên môi trường
// đang chạy hay chưa, để KHÔNG hiển thị nút "lưu thành công" giả khi
// migration Category + Create Task Foundation (scripts/
// PHF_TASK_CATEGORY_CREATE_FOUNDATION_1.70.0.sql) chưa được Business Owner
// apply. Không dùng write-probe (thử ghi rồi xem fail) — chỉ dùng (1) đọc
// cột qua PostgREST select, (2) đọc danh sách RPC qua OpenAPI root, cả 2 đều
// an toàn 100% (không có side effect, không tạo/sửa dữ liệu).
// ---------------------------------------------------------------------------
const FOUNDATION_STATUS_CACHE_TTL_MS = 60000;
let foundationStatusCache = null;
let foundationStatusCacheAt = 0;

async function readRpcInventory() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '') + '/rest/v1/';
  const key = String(process.env.SUPABASE_SECRET_KEY || '').trim();
  const response = await fetch(url, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
  const spec = await response.json();
  return new Set(Object.keys((spec && spec.paths) || {}));
}
async function columnExists(table, column) {
  const { error } = await supabase.from(table).select(column).limit(1);
  return !error;
}
async function checkTaskFoundationStatus(session) {
  await resolveActorContext(session);
  ensureDb();
  const now = Date.now();
  if (foundationStatusCache && (now - foundationStatusCacheAt) < FOUNDATION_STATUS_CACHE_TTL_MS) return foundationStatusCache;
  let rpcPaths = new Set();
  let rpcReadError = '';
  try { rpcPaths = await readRpcInventory(); } catch (error) { rpcReadError = String(error && error.message || 'Không đọc được danh sách RPC.'); }
  const [categoryAuditReady, categorySortReady, crossDeptSnapshotReady, taskNotificationsReady] = await Promise.all([
    columnExists(CATEGORIES_TABLE, 'created_by_account_id'),
    columnExists(CATEGORIES_TABLE, 'sort_order'),
    columnExists(TASKS_TABLE, 'source_department'),
    columnExists('task_notifications', 'dedupe_key')
  ]);
  const result = {
    category_schema_ready: categoryAuditReady && categorySortReady,
    create_task_rpc_ready: rpcPaths.has('/rpc/task_create_draft'),
    add_related_rpc_ready: rpcPaths.has('/rpc/task_add_related'),
    add_link_rpc_ready: rpcPaths.has('/rpc/task_add_link'),
    delete_category_rpc_ready: rpcPaths.has('/rpc/task_delete_category_if_unused'),
    // Cross-department V1 (1.72.0, CHƯA apply) — UI phải hỏi đúng 2 cờ này
    // trước khi tuyên bố "quản lý sẽ được thông báo" (mục 17 — không fake
    // capability). Đọc bằng columnExists thật, không đoán.
    cross_department_snapshot_ready: crossDeptSnapshotReady,
    task_notification_schema_ready: taskNotificationsReady,
    rpc_inventory_error: rpcReadError
  };
  result.create_task_ready = result.category_schema_ready && result.create_task_rpc_ready;
  foundationStatusCache = result;
  foundationStatusCacheAt = now;
  return result;
}

const TASKS_TABLE = 'task_tasks';
const ASSIGNEES_TABLE = 'task_assignees';
const EVENTS_TABLE = 'task_events';
const COMMENTS_TABLE = 'task_comments';
const LINKS_TABLE = 'task_links';
const CATEGORIES_TABLE = 'task_categories';
const PERMISSION_GRANTS_TABLE = 'task_permission_grants';
const PERMISSION_GRANT_HISTORY_TABLE = 'task_permission_grant_history';

function text(value) { return String(value == null ? '' : value).trim(); }
function code(value) { return text(value).toUpperCase(); }
function isoTimestamp(value, fieldName, required) {
  const raw = text(value);
  if (!raw) {
    if (required) fail(fieldName + ' là bắt buộc.', 400, fieldName === 'Deadline' ? 'TASK_DEADLINE_REQUIRED' : 'TASK_START_REQUIRED');
    return null;
  }
  if (raw.includes('T') && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    fail(fieldName + ' phải kèm timezone rõ ràng.', 400, fieldName === 'Deadline' ? 'TASK_DEADLINE_INVALID' : 'TASK_START_INVALID');
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) fail(fieldName + ' không hợp lệ.', 400, fieldName === 'Deadline' ? 'TASK_DEADLINE_INVALID' : 'TASK_START_INVALID');
  return parsed.toISOString();
}
function fail(message, statusCode, errorCode) {
  const e = new Error(message);
  e.statusCode = statusCode || 400;
  e.code = errorCode || 'TASK_CORE_INVALID';
  throw e;
}
function ensureDb() { if (!supabase) fail('Supabase chưa được cấu hình cho PHF Task.', 503, 'SUPABASE_NOT_CONFIGURED'); }

function throwDb(error) {
  if (!error) return;
  const errCode = text(error.code);
  const message = text(error.message);
  if (errCode === 'PGRST205' || errCode === '42P01' || /relation .* does not exist/i.test(message) || /Could not find the table/i.test(message)) {
    fail('Bảng PHF Task chưa sẵn sàng. Vui lòng kiểm tra migration Foundation/Permissions đã apply chưa.', 503, 'TASK_SCHEMA_MISSING');
  }
  fail('Lỗi hệ thống PHF Task: ' + message, 500, 'TASK_DB_ERROR');
}

// Dịch RAISE EXCEPTION message từ scripts/PHF_TASK_CORE_RPC_1.67.0.sql thành
// lỗi JS có statusCode/code rõ ràng — KHÔNG lộ nguyên văn Postgres error ra client.
const RPC_ERROR_MAP = {
  TASK_NOT_FOUND: [404, 'Không tìm thấy task.'],
  TASK_VERSION_CONFLICT: [409, 'Task đã được cập nhật ở nơi khác. Vui lòng tải lại trước khi thao tác tiếp.'],
  TASK_NOT_DRAFT: [409, 'Task không còn ở trạng thái draft.'],
  TASK_PRIMARY_REQUIRED: [400, 'Task cần đúng 1 người nhận chính (primary) trước khi phát hành.'],
  TASK_NOT_ACTIVE: [409, 'Task không ở trạng thái đang hoạt động (published/in_progress).'],
  TASK_PROGRESS_PERCENT_INVALID: [400, 'progress_percent phải trong khoảng 0-100.'],
  TASK_PROGRESS_STATUS_INVALID: [400, 'progress_status không hợp lệ.'],
  TASK_COMPLETION_RESULT_REQUIRED: [400, 'Bắt buộc nhập Kết quả thực hiện khi hoàn thành task.'],
  TASK_NOT_COMPLETED: [409, 'Chỉ task đã hoàn thành mới mở lại được.'],
  TASK_REOPEN_REASON_REQUIRED: [400, 'Bắt buộc nhập lý do khi mở lại task.'],
  TASK_DRAFT_USE_DELETE: [409, 'Task đang là draft — dùng xóa thay vì hủy.'],
  TASK_ALREADY_CANCELLED: [409, 'Task đã bị hủy trước đó.'],
  TASK_MUST_REOPEN_BEFORE_CANCEL: [409, 'Task đã hoàn thành — cần mở lại (reopen) trước khi hủy.'],
  TASK_CANCEL_REASON_REQUIRED: [400, 'Bắt buộc nhập lý do khi hủy task.'],
  TASK_CANCELLED_IMMUTABLE: [409, 'Task đã hủy — không thể đổi deadline.'],
  TASK_DEADLINE_REQUIRED: [400, 'Deadline mới là bắt buộc.'],
  TASK_CATEGORY_NOT_FOUND: [400, 'Category không tồn tại.'],
  TASK_CATEGORY_INACTIVE: [400, 'Category đã ngừng dùng và không thể chọn cho Task mới.'],
  TASK_CATEGORY_IN_USE: [409, 'Danh mục đã từng được dùng cho Task — không thể xóa, chỉ có thể Ngừng sử dụng.'],
  TASK_CATEGORY_CODE_REQUIRED: [400, 'Thiếu mã danh mục.'],
  TASK_DATE_ORDER_INVALID: [400, 'Ngày bắt đầu không được sau deadline.'],
  TASK_RELATED_TARGET_REQUIRED: [400, 'Thiếu nhân sự liên quan.'],
  TASK_RELATED_IS_PRIMARY: [400, 'Không thể thêm primary hiện hành làm related.'],
  TASK_DEADLINE_REASON_REQUIRED: [400, 'Bắt buộc nhập lý do khi đổi deadline.'],
  TASK_TRANSFER_REASON_REQUIRED: [400, 'Bắt buộc nhập lý do khi chuyển người phụ trách.'],
  TASK_TRANSFER_TARGET_REQUIRED: [400, 'Thiếu người phụ trách mới.'],
  TASK_PRIMARY_NOT_FOUND: [409, 'Task hiện chưa có primary active để chuyển.'],
  TASK_TRANSFER_SAME_EMPLOYEE: [400, 'Người phụ trách mới trùng người hiện tại.'],
  TASK_PERMISSION_ASSIGNMENT_TARGET_REQUIRED: [400, 'Thiếu nhân sự nhận Task preset.'],
  TASK_PERMISSION_PRESET_INVALID: [400, 'Task preset không hợp lệ.'],
  TASK_PERMISSION_REASON_REQUIRED: [400, 'Lý do thay đổi Task preset là bắt buộc.'],
  TASK_PERMISSION_ACTOR_REQUIRED: [401, 'Không xác định được tài khoản thực hiện thay đổi Task preset.']
};

function throwRpc(error) {
  if (!error) return;
  const msg = text(error.message);
  const known = Object.keys(RPC_ERROR_MAP).find(k => msg.indexOf(k) !== -1);
  if (known) {
    const [statusCode, friendly] = RPC_ERROR_MAP[known];
    fail(friendly, statusCode, known);
  }
  throwDb(error);
}

async function callRpc(fnName, params) {
  ensureDb();
  const { data, error } = await supabase.rpc(fnName, params);
  if (error) throwRpc(error);
  return data;
}

// task_create_draft V2 (PHF_TASK_CODE_IDEMPOTENCY_1.71.0, DESIGN — chưa apply
// Production) thêm p_idempotency_key vào signature. Trước khi migration đó
// apply, PostgREST chỉ biết chữ ký 9-tham-số cũ và sẽ trả PGRST202/"Could not
// find the function" nếu gọi kèm p_idempotency_key — KHÔNG được để lỗi đó
// làm hỏng luồng tạo Task đang chạy thật trên Local/Production hiện tại. Tự
// dò lại KHÔNG kèm idempotency key trong trường hợp đó — tự kích hoạt ngay
// khi migration được apply, không cần phối hợp thời điểm deploy code/DB.
async function callTaskCreateDraftRpc(params) {
  ensureDb();
  const first = await supabase.rpc('task_create_draft', params);
  if (!first.error) return first.data;
  const isMissingSignature = text(first.error.code) === 'PGRST202'
    || /Could not find the function/i.test(text(first.error.message));
  if (isMissingSignature && Object.prototype.hasOwnProperty.call(params, 'p_idempotency_key')) {
    const legacyParams = Object.assign({}, params);
    delete legacyParams.p_idempotency_key;
    const retry = await supabase.rpc('task_create_draft', legacyParams);
    if (retry.error) throwRpc(retry.error);
    return retry.data;
  }
  throwRpc(first.error);
}

function actorAuditToken(actorContext) { return actorContext.employeeCode || actorContext.accountId; }
function actorAuditColumns(actorContext, accountColumn, employeeColumn) {
  return {
    [accountColumn]: actorContext.accountId || null,
    [employeeColumn]: actorContext.employeeCode || null
  };
}
function actorOwnsTask(actorContext, taskRow) {
  return !!(
    (actorContext.accountId && text(taskRow && taskRow.created_by_account_id) === actorContext.accountId) ||
    (actorContext.employeeCode && code(taskRow && taskRow.created_by_employee_code) === actorContext.employeeCode)
  );
}

async function listTaskAssignableEmployees(session) {
  const result = await listAssignableEmployeesFromPeopleMaster(session);
  return { employees: result.employees, requester_actor_type: result.requesterActorType };
}

const TASK_ACTOR_TYPE_LABELS = Object.freeze({
  admin: 'Admin',
  giam_doc: 'Giám đốc',
  tro_ly_gd: 'Trợ lý Giám đốc',
  truong_bo_phan: 'Trưởng bộ phận',
  truong_ca: 'Trưởng ca',
  nhan_vien: 'Nhân viên'
});

function taskPeopleScopeLabel(scope) {
  const value = scope && scope.peopleScope ? scope.peopleScope : (scope || {});
  const count = Array.isArray(value.values) ? value.values.length : 0;
  switch (value.type) {
    case 'all_company': return 'Toàn công ty';
    case 'sales_all_branches_task': return 'Bán hàng tại 3 chi nhánh Task';
    case 'department': return 'Theo phòng ban' + (count ? ' (' + count + ')' : '');
    case 'branch': return 'Theo chi nhánh' + (count ? ' (' + count + ')' : '');
    case 'employees': return 'Nhóm nhân sự quản lý (' + count + ')';
    case 'self':
    default: return 'Bản thân';
  }
}

function taskAccountStatus(account) {
  if (!account) return { code: 'missing', label: 'Chưa có tài khoản' };
  const status = text(account.status).toLowerCase();
  if (status === 'active') return { code: 'active', label: 'Đang hoạt động' };
  if (status === 'locked') return { code: 'locked', label: 'Đã khóa' };
  if (status === 'inactive') return { code: 'inactive', label: 'Ngừng sử dụng' };
  return { code: status || 'unknown', label: 'Không xác định' };
}

function taskPermissionGrantDto(grant) {
  const rawScope = grant && grant.people_scope && typeof grant.people_scope === 'object' ? grant.people_scope : {};
  const scopeType = text(rawScope.type).toLowerCase() || 'self';
  const scopeValues = Array.from(new Set((Array.isArray(rawScope.values) ? rawScope.values : []).map(code).filter(Boolean)));
  const rawCapabilities = grant && grant.capabilities && typeof grant.capabilities === 'object' ? grant.capabilities : {};
  const capabilities = {};
  ['view', 'assign', 'update', 'manage'].forEach(key => {
    if (typeof rawCapabilities[key] === 'boolean') capabilities[key] = rawCapabilities[key];
  });
  return {
    id: text(grant && grant.id),
    grantee_employee_code: code(grant && grant.grantee_employee_code),
    grant_type: text(grant && grant.grant_type).toLowerCase(),
    people_scope: { type: scopeType, values: scopeValues },
    people_scope_label: taskPeopleScopeLabel({ peopleScope: { type: scopeType, values: scopeValues } }),
    capabilities,
    reason: text(grant && grant.reason),
    is_active: grant && grant.is_active === true,
    effective_from: text(grant && grant.effective_from),
    effective_to: text(grant && grant.effective_to) || null,
    created_by_account_id: text(grant && grant.created_by_account_id),
    created_by_employee_code: code(grant && grant.created_by_employee_code),
    created_at: text(grant && grant.created_at),
    can_revoke: text(grant && grant.grant_type).toLowerCase() === 'extend' && grant && grant.is_active === true
  };
}

function taskPermissionAdjustmentPolicy(employmentStatus, baseScopeType) {
  if (employmentStatus !== 'active' || baseScopeType === 'all_company') {
    return { can_create_extend: false, supported_scope_types: [] };
  }
  if (baseScopeType === 'self' || baseScopeType === 'employees') {
    return { can_create_extend: true, supported_scope_types: ['employees', 'all_company'] };
  }
  if (baseScopeType === 'sales_all_branches_task') {
    return { can_create_extend: true, supported_scope_types: ['all_company'] };
  }
  return { can_create_extend: false, supported_scope_types: [] };
}

async function requireTaskPermissionAdmin(session) {
  const requester = await resolveEffectiveTaskScope(session);
  if (requester.actorContext.actorType !== 'admin') {
    fail('Chỉ Admin PHF Task được điều chỉnh quyền.', 403, 'TASK_PERMISSION_ADMIN_REQUIRED');
  }
  requireTaskCapability(requester, 'manage');
  return requester.actorContext;
}

function validateTaskPermissionReason(value) {
  const reason = text(value);
  if (!reason) fail('Lý do điều chỉnh quyền là bắt buộc.', 400, 'TASK_PERMISSION_REASON_REQUIRED');
  if (reason.length > 500) fail('Lý do điều chỉnh quyền không được vượt quá 500 ký tự.', 400, 'TASK_PERMISSION_REASON_TOO_LONG');
  return reason;
}

function validateExtendCapabilityInput(input) {
  const capabilities = input && input.capabilities;
  if (capabilities == null) return;
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    fail('Capability grant không hợp lệ.', 400, 'TASK_PERMISSION_CAPABILITY_INVALID');
  }
  if (Object.keys(capabilities).length) {
    fail('V1 chỉ mở Extend theo phạm vi nhân sự; chưa mở capability hoặc Restrict.', 400, 'TASK_PERMISSION_CAPABILITY_NOT_SUPPORTED');
  }
}

function normalizeExtendPeopleScope(input, baseScopeType, orgRows) {
  const raw = input && input.peopleScope;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('Phạm vi Extend là bắt buộc.', 400, 'TASK_PERMISSION_SCOPE_REQUIRED');
  }
  const scopeType = text(raw.type).toLowerCase();
  const policy = taskPermissionAdjustmentPolicy('active', baseScopeType);
  if (!policy.supported_scope_types.includes(scopeType)) {
    fail('Phạm vi Extend không được engine V1 hỗ trợ an toàn cho vai trò này.', 400, 'TASK_PERMISSION_SCOPE_NOT_SUPPORTED');
  }
  if (scopeType === 'all_company') return { type: 'all_company', values: [] };
  const values = Array.from(new Set((Array.isArray(raw.values) ? raw.values : []).map(code).filter(Boolean)));
  if (!values.length) fail('Cần chọn ít nhất một nhân sự để mở rộng phạm vi.', 400, 'TASK_PERMISSION_SCOPE_VALUES_REQUIRED');
  if (values.length > 100) fail('Mỗi grant chỉ được chọn tối đa 100 nhân sự.', 400, 'TASK_PERMISSION_SCOPE_VALUES_TOO_MANY');
  values.forEach(employeeCode => {
    const person = findByCode(orgRows, employeeCode);
    if (!person) fail('Nhân sự trong phạm vi không tồn tại: ' + employeeCode, 400, 'TASK_PERMISSION_SCOPE_EMPLOYEE_NOT_FOUND');
    if (text(person.status).toLowerCase() !== 'active') {
      fail('Không thể mở rộng quyền tới nhân sự đã nghỉ: ' + employeeCode, 400, 'TASK_PERMISSION_SCOPE_EMPLOYEE_INACTIVE');
    }
  });
  return { type: 'employees', values };
}

async function createTaskPermissionGrant(session, input) {
  ensureDb();
  const admin = await requireTaskPermissionAdmin(session);
  const grantType = text(input && input.grantType).toLowerCase() || 'extend';
  if (grantType !== 'extend') {
    fail('V1 chỉ cho phép tạo grant Extend.', 400, 'TASK_PERMISSION_GRANT_TYPE_NOT_SUPPORTED');
  }
  validateExtendCapabilityInput(input);
  const [orgRows, accounts] = await Promise.all([loadOrgRows(), listHubAccountSummaries()]);
  const granteeEmployeeCode = code(input && input.granteeEmployeeCode);
  const granteeRecord = findByCode(orgRows, granteeEmployeeCode);
  if (!granteeRecord) fail('Nhân sự nhận quyền không tồn tại trong People Master.', 404, 'TASK_PERMISSION_GRANTEE_NOT_FOUND');
  if (text(granteeRecord.status).toLowerCase() !== 'active') {
    fail('Không thể cấp quyền mới cho nhân sự đã nghỉ.', 400, 'TASK_PERMISSION_GRANTEE_INACTIVE');
  }
  const granteeAccount = (accounts || []).find(account => code(account && account.employeeCode) === granteeEmployeeCode);
  const grantee = resolveActorContextForRecord({ account: { id: granteeAccount ? granteeAccount.id : '', role: granteeAccount ? granteeAccount.role : '' } }, granteeRecord, orgRows);
  const granteeEffective = await resolveEffectiveTaskScopeForActorContext(grantee);
  const peopleScope = normalizeExtendPeopleScope(input, granteeEffective.scope.peopleScope.type, orgRows);
  const reason = validateTaskPermissionReason(input && input.reason);
  const now = new Date().toISOString();
  const insertRow = {
    grantee_employee_code: granteeEmployeeCode,
    grant_type: 'extend',
    people_scope: peopleScope,
    capabilities: {},
    effective_from: now,
    effective_to: null,
    reason,
    is_active: true,
    ...actorAuditColumns(admin, 'created_by_account_id', 'created_by_employee_code'),
    ...actorAuditColumns(admin, 'updated_by_account_id', 'updated_by_employee_code'),
    updated_at: now
  };
  const { data: grant, error: grantError } = await supabase.from(PERMISSION_GRANTS_TABLE).insert(insertRow).select('*').single();
  if (grantError) throwDb(grantError);
  const { error: historyError } = await supabase.from(PERMISSION_GRANT_HISTORY_TABLE).insert({
    grant_id: grant.id,
    changed_field: 'created',
    old_value: null,
    new_value: taskPermissionGrantDto(grant),
    ...actorAuditColumns(admin, 'changed_by_account_id', 'changed_by_employee_code'),
    reason
  });
  if (historyError) {
    const { error: compensationError } = await supabase.from(PERMISSION_GRANTS_TABLE)
      .update({ is_active: false, ...actorAuditColumns(admin, 'updated_by_account_id', 'updated_by_employee_code'), updated_at: new Date().toISOString() })
      .eq('id', grant.id).eq('is_active', true);
    if (compensationError) fail('Không ghi được audit và không thể vô hiệu hóa grant vừa tạo.', 500, 'TASK_PERMISSION_AUDIT_COMPENSATION_FAILED');
    throwDb(historyError);
  }
  return { grant: taskPermissionGrantDto(grant) };
}

async function revokeTaskPermissionGrant(session, grantIdInput, reasonInput) {
  ensureDb();
  const admin = await requireTaskPermissionAdmin(session);
  const grantId = text(grantIdInput);
  if (!grantId || grantId.length > 120) fail('Grant ID không hợp lệ.', 400, 'TASK_PERMISSION_GRANT_ID_INVALID');
  const reason = validateTaskPermissionReason(reasonInput);
  const { data: existing, error: readError } = await supabase.from(PERMISSION_GRANTS_TABLE).select('*').eq('id', grantId).maybeSingle();
  if (readError) throwDb(readError);
  if (!existing) fail('Không tìm thấy grant.', 404, 'TASK_PERMISSION_GRANT_NOT_FOUND');
  if (text(existing.grant_type).toLowerCase() !== 'extend') {
    fail('V1 chỉ cho phép thu hồi grant Extend.', 400, 'TASK_PERMISSION_REVOKE_TYPE_NOT_SUPPORTED');
  }
  if (existing.is_active !== true) fail('Grant đã được thu hồi trước đó.', 409, 'TASK_PERMISSION_GRANT_ALREADY_REVOKED');
  const now = new Date().toISOString();
  const { data: revoked, error: updateError } = await supabase.from(PERMISSION_GRANTS_TABLE)
    .update({ is_active: false, ...actorAuditColumns(admin, 'updated_by_account_id', 'updated_by_employee_code'), updated_at: now })
    .eq('id', grantId).eq('is_active', true).select('*').maybeSingle();
  if (updateError) throwDb(updateError);
  if (!revoked) fail('Grant vừa thay đổi ở nơi khác. Vui lòng tải lại.', 409, 'TASK_PERMISSION_GRANT_CONFLICT');
  const { error: historyError } = await supabase.from(PERMISSION_GRANT_HISTORY_TABLE).insert({
    grant_id: grantId,
    changed_field: 'is_active',
    old_value: true,
    new_value: false,
    ...actorAuditColumns(admin, 'changed_by_account_id', 'changed_by_employee_code'),
    reason
  });
  if (historyError) {
    const { error: compensationError } = await supabase.from(PERMISSION_GRANTS_TABLE)
      .update({ is_active: true, ...actorAuditColumns(admin, 'updated_by_account_id', 'updated_by_employee_code'), updated_at: new Date().toISOString() })
      .eq('id', grantId).eq('is_active', false);
    if (compensationError) fail('Không ghi được audit và không thể khôi phục grant vừa thu hồi.', 500, 'TASK_PERMISSION_AUDIT_COMPENSATION_FAILED');
    throwDb(historyError);
  }
  return { revoked: true, grant_id: grantId, grantee_employee_code: code(existing.grantee_employee_code) };
}

function taskPermissionAssignmentDto(assignment) {
  if (!assignment) return null;
  return {
    id: text(assignment.id),
    account_id: text(assignment.account_id),
    employee_code: code(assignment.employee_code),
    preset_code: code(assignment.preset_code),
    effective_from: text(assignment.effective_from),
    effective_to: text(assignment.effective_to) || null,
    is_active: assignment.is_active === true,
    reason: text(assignment.reason),
    updated_at: text(assignment.updated_at)
  };
}

async function saveTaskPermissionAssignment(session, input) {
  const admin = await requireTaskPermissionAdmin(session);
  const presetCode = code(input && input.presetCode);
  if (!TASK_PRESET_CODES.includes(presetCode)) fail('Task preset không hợp lệ.', 400, 'TASK_PERMISSION_PRESET_INVALID');
  const reason = validateTaskPermissionReason(input && input.reason);
  const employeeCode = code(input && input.employeeCode);
  const [orgRows, accounts] = await Promise.all([loadOrgRows(), listHubAccountSummaries()]);
  const person = findByCode(orgRows, employeeCode);
  if (!person) fail('Nhân sự nhận Task preset không tồn tại trong People Master.', 404, 'TASK_PERMISSION_GRANTEE_NOT_FOUND');
  if (text(person.status).toLowerCase() !== 'active') fail('Không thể gán Task preset mới cho nhân sự đã nghỉ.', 400, 'TASK_PERMISSION_GRANTEE_INACTIVE');
  const account = (accounts || []).find(row => code(row && row.employeeCode) === employeeCode) || null;
  const assignment = await callRpc('task_set_permission_assignment', {
    p_target_account_id: account ? text(account.id) || null : null,
    p_target_employee_code: employeeCode,
    p_preset_code: presetCode,
    p_reason: reason,
    p_actor_account_id: admin.accountId || null,
    p_actor_employee_code: admin.employeeCode || null
  });
  return { assignment: taskPermissionAssignmentDto(assignment) };
}

// ---------------------------------------------------------------------------
// Checklist → Task preset mapping preview (read-only, Nhân sự & phân quyền).
//
// Checklist KHÔNG có preset "Giám đốc"/"Nhân viên" dạng lưu trữ — đây là hệ
// thống grant-per-person (checklist_permission_grants), preset_code chỉ là
// nhãn tiện lợi lúc lưu chứ KHÔNG enforce lúc đọc quyền (xem
// api/_lib/checklist-permissions.js PRESETS). "Giám đốc" thực chất =
// user_accounts.role==='admin' (cờ hệ thống, bypass toàn bộ — KHÔNG phải một
// preset Checklist và KHÔNG chắc gắn với đúng 1 người cụ thể). "Nhân viên" =
// hoàn toàn không có active grant nào (default ngầm).
//
// Mapping này CHỈ để hiển thị preview/đề xuất trên UI — KHÔNG tự động ghi
// bất kỳ Task assignment nào. Không đọc được Checklist (bảng thiếu/lỗi)
// không được làm sập trang Nhân sự & phân quyền — coi như "chưa khả dụng".
// ---------------------------------------------------------------------------
const CHECKLIST_GRANTS_TABLE = 'checklist_permission_grants';
const CHECKLIST_PRESET_TO_TASK_PRESET = Object.freeze({
  TRO_LY_GD: 'TRO_LY_GD',
  TRUONG_BO_PHAN: 'TRUONG_BO_PHAN',
  // Checklist TRUONG_CA_BH hard-code scope theo phòng ban/chi nhánh cố định
  // (Bán hàng × Phú Lợi/Ngô Quyền/Lái Thiêu) — Task TRUONG_CA V1 KHÔNG dùng
  // cơ chế đó, mà tự tính peopleScope theo quan hệ quản lý thật
  // (manager_employee_code). Preset/identity map được nhưng scope phía Task
  // sẽ do runtime tự tính lại, có thể khác phạm vi Checklist.
  TRUONG_CA_BH: 'TRUONG_CA'
  // QUAN_LY_TRUC_TIEP / CHI_XEM_BAO_CAO / TUY_CHINH: không có Task preset
  // tương ứng — cố ý KHÔNG map, xử lý ở nhánh "chưa có preset tương ứng".
});
const CHECKLIST_PRESET_LABELS = Object.freeze({
  TRO_LY_GD: 'Trợ lý Giám đốc (Checklist)',
  TRUONG_BO_PHAN: 'Trưởng bộ phận (Checklist)',
  TRUONG_CA_BH: 'Trưởng ca — Bán hàng 3 chi nhánh (Checklist)',
  QUAN_LY_TRUC_TIEP: 'Quản lý trực tiếp (Checklist)',
  CHI_XEM_BAO_CAO: 'Chỉ xem báo cáo (Checklist)',
  TUY_CHINH: 'Tùy chỉnh (Checklist)'
});

async function loadChecklistRoleReference() {
  ensureDb();
  const refByEmployee = new Map();
  const pushRef = (employeeCode, ref) => {
    const key = code(employeeCode);
    if (!key) return;
    if (!refByEmployee.has(key)) refByEmployee.set(key, []);
    refByEmployee.get(key).push(ref);
  };
  try {
    const [grantsRes, adminsRes] = await Promise.all([
      supabase.from(CHECKLIST_GRANTS_TABLE).select('employee_code,preset_code').eq('is_active', true),
      supabase.from('user_accounts').select('employee_code,role,status').eq('role', 'admin').eq('status', 'active')
    ]);
    if (grantsRes.error) throwDb(grantsRes.error);
    if (adminsRes.error) throwDb(adminsRes.error);
    (grantsRes.data || []).forEach(row => {
      const presetCode = code(row.preset_code);
      pushRef(row.employee_code, { source: 'grant', presetCode, label: CHECKLIST_PRESET_LABELS[presetCode] || ('Checklist: ' + presetCode) });
    });
    (adminsRes.data || []).forEach(row => {
      if (!text(row.employee_code)) return; // tài khoản admin tiện ích không gắn nhân sự — bỏ qua, không map
      pushRef(row.employee_code, { source: 'admin', presetCode: '', label: 'Quản trị hệ thống (Checklist admin)' });
    });
    return { ready: true, refByEmployee };
  } catch (error) {
    return { ready: false, refByEmployee, error };
  }
}

function computeChecklistMapping(person, checklistReady, refByEmployee) {
  if (!checklistReady) return { status: 'unavailable', label: '', proposed_preset: '', note: '' };
  const refs = refByEmployee.get(person.employee_code) || [];
  if (!refs.length) return { status: 'chua_gan', label: '', proposed_preset: '', note: '' };
  if (refs.length > 1) {
    return {
      status: 'conflict',
      label: refs.map(r => r.label).join(' + '),
      proposed_preset: '',
      note: 'Nhiều tham chiếu Checklist cùng lúc cho 1 người — cần Business Owner xác nhận thủ công.'
    };
  }
  const ref = refs[0];
  if (ref.source === 'admin') {
    return {
      status: 'can_duyet',
      label: ref.label,
      proposed_preset: 'GIAM_DOC',
      note: 'Cờ Admin hệ thống không đồng nghĩa đây là Giám đốc thật — cần Business Owner xác nhận danh tính trước khi gán.'
    };
  }
  const proposedPreset = CHECKLIST_PRESET_TO_TASK_PRESET[ref.presetCode] || '';
  if (!proposedPreset) {
    return {
      status: 'can_duyet',
      label: ref.label,
      proposed_preset: '',
      note: 'Preset Checklist "' + ref.presetCode + '" chưa có Task preset tương ứng — cần Business Owner quyết định.'
    };
  }
  const currentIsAssignment = person.task_preset_source === 'assignment';
  if (currentIsAssignment && code(person.task_preset_code) === proposedPreset) {
    return { status: 'khop', label: ref.label, proposed_preset: proposedPreset, note: '' };
  }
  return {
    status: 'de_xuat',
    label: ref.label,
    proposed_preset: proposedPreset,
    note: proposedPreset === 'TRUONG_CA'
      ? 'Checklist scope theo phòng ban/chi nhánh cố định; Task sẽ tự tính peopleScope theo quan hệ quản lý thật, có thể khác phạm vi Checklist.'
      : ''
  };
}

const CHECKLIST_MAPPING_STATUS_LABELS = Object.freeze({
  khop: 'Khớp',
  chua_gan: 'Chưa gán',
  de_xuat: 'Đề xuất gán',
  conflict: 'Conflict',
  can_duyet: 'Cần duyệt',
  unavailable: 'Chưa khả dụng'
});

async function listTaskAdminPeople(session) {
  const requester = await resolveEffectiveTaskScope(session);
  if (requester.actorContext.actorType !== 'admin') fail('Chỉ Admin PHF Task được xem Nhân sự & phân quyền.', 403, 'TASK_ADMIN_PEOPLE_DENIED');
  requireTaskCapability(requester, 'manage');

  const [orgRows, accounts, checklistRef] = await Promise.all([loadOrgRows(), listHubAccountSummaries(), loadChecklistRoleReference()]);
  const accountByEmployee = new Map();
  (accounts || []).forEach(account => {
    const employeeCode = code(account && account.employeeCode);
    if (employeeCode && !accountByEmployee.has(employeeCode)) accountByEmployee.set(employeeCode, account);
  });
  const actorContexts = (orgRows || []).map(person => {
    const account = accountByEmployee.get(code(person.employeeCode));
    return resolveActorContextForRecord({ account: { id: account ? account.id : '', role: account ? account.role : '' } }, person, orgRows);
  });
  let effectiveRows = null;
  let permissionSchemaError = null;
  try {
    effectiveRows = await resolveEffectiveTaskScopesForActorContexts(actorContexts);
  } catch (error) {
    if (error && error.code === 'TASK_SCHEMA_MISSING') permissionSchemaError = error;
    else throw error;
  }
  const permissionSchemaReady = !permissionSchemaError;
  const people = (effectiveRows || actorContexts.map(actorContext => ({ actorContext, assignment: null, grants: [], scope: null }))).map(effective => {
    const actorContext = effective.actorContext;
    const person = findByCode(orgRows, actorContext.employeeCode);
    const account = accountByEmployee.get(actorContext.employeeCode) || null;
    const accountStatus = taskAccountStatus(account);
    const baseScope = permissionSchemaReady ? resolveBaseTaskScope(actorContext) : null;
    const employmentStatus = text(person && person.status).toLowerCase() === 'inactive' ? 'inactive' : 'active';
    const checklistMapping = computeChecklistMapping(
      { employee_code: actorContext.employeeCode, task_preset_code: permissionSchemaReady ? actorContext.taskPresetCode : '', task_preset_source: permissionSchemaReady ? (effective.assignment ? 'assignment' : 'default') : 'unavailable' },
      checklistRef.ready,
      checklistRef.refByEmployee
    );
    return {
      employee_code: actorContext.employeeCode,
      full_name: actorContext.fullName,
      department: actorContext.department,
      title: actorContext.title,
      position: text(person && person.position),
      branch: actorContext.branch,
      manager_employee_code: actorContext.managerCode,
      employment_status: employmentStatus,
      employment_status_label: employmentStatus === 'active' ? 'Đang làm' : 'Nghỉ việc',
      has_account: !!account,
      account_status: accountStatus.code,
      account_status_label: accountStatus.label,
      task_actor_type: permissionSchemaReady ? actorContext.actorType : '',
      task_preset_code: permissionSchemaReady ? actorContext.taskPresetCode : '',
      task_preset_source: permissionSchemaReady ? (effective.assignment ? 'assignment' : (actorContext.actorType === 'admin' ? 'admin_system' : 'default')) : 'unavailable',
      task_role_label: permissionSchemaReady ? (TASK_ACTOR_TYPE_LABELS[actorContext.actorType] || TASK_ACTOR_TYPE_LABELS.nhan_vien) : 'Chưa khả dụng',
      task_assignment: permissionSchemaReady ? taskPermissionAssignmentDto(effective.assignment) : null,
      base_scope_type: permissionSchemaReady ? baseScope.peopleScope.type : '',
      base_scope_label: permissionSchemaReady ? taskPeopleScopeLabel(baseScope) : 'Chưa khả dụng',
      base_capabilities: {
        view: permissionSchemaReady && baseScope.capabilities.view === true,
        assign: permissionSchemaReady && baseScope.capabilities.assign === true,
        update: permissionSchemaReady && baseScope.capabilities.update === true,
        manage: permissionSchemaReady && baseScope.capabilities.manage === true
      },
      effective_scope_type: permissionSchemaReady ? effective.scope.peopleScope.type : '',
      effective_scope_label: permissionSchemaReady ? taskPeopleScopeLabel(effective.scope) : 'Chưa khả dụng',
      capabilities: {
        view: permissionSchemaReady && effective.scope.capabilities.view === true,
        assign: permissionSchemaReady && effective.scope.capabilities.assign === true,
        update: permissionSchemaReady && effective.scope.capabilities.update === true,
        manage: permissionSchemaReady && effective.scope.capabilities.manage === true
      },
      has_active_grant: permissionSchemaReady && effective.grants.length > 0,
      active_grant_count: permissionSchemaReady ? effective.grants.length : 0,
      active_grants: permissionSchemaReady ? effective.grants.map(taskPermissionGrantDto) : [],
      can_receive_new_tasks: employmentStatus === 'active',
      checklist_mapping_status: checklistMapping.status,
      checklist_mapping_status_label: CHECKLIST_MAPPING_STATUS_LABELS[checklistMapping.status] || 'Chưa khả dụng',
      checklist_role_label: checklistMapping.label,
      checklist_proposed_preset: checklistMapping.proposed_preset,
      checklist_mapping_note: checklistMapping.note,
      permission_adjustment: permissionSchemaReady ? Object.assign(
        taskPermissionAdjustmentPolicy(employmentStatus, baseScope.peopleScope.type),
        { can_set_base_preset: employmentStatus === 'active' }
      ) : { can_create_extend: false, supported_scope_types: [], can_set_base_preset: false }
    };
  }).sort((a, b) => a.full_name.localeCompare(b.full_name, 'vi') || a.employee_code.localeCompare(b.employee_code));

  return {
    identity_ready: true,
    identity_status: 'READY',
    identity_message: '',
    permission_schema_ready: permissionSchemaReady,
    permission_schema_error: permissionSchemaError ? permissionSchemaError.code : '',
    permission_schema_message: permissionSchemaError ? permissionSchemaError.message : '',
    checklist_reference_ready: checklistRef.ready,
    people,
    summary: {
      total: people.length,
      active: people.filter(person => person.employment_status === 'active').length,
      inactive: people.filter(person => person.employment_status === 'inactive').length,
      with_account: people.filter(person => person.has_account).length,
      checklist_khop: people.filter(person => person.checklist_mapping_status === 'khop').length,
      checklist_de_xuat: people.filter(person => person.checklist_mapping_status === 'de_xuat').length,
      checklist_conflict: people.filter(person => person.checklist_mapping_status === 'conflict').length,
      checklist_can_duyet: people.filter(person => person.checklist_mapping_status === 'can_duyet').length
    }
  };
}

function categoryDto(row, usedCodes) {
  if (!row) return null;
  return {
    category_code: code(row.category_code),
    display_name: text(row.display_name),
    description: text(row.description),
    color: text(row.color) || '#64748B',
    is_active: row.is_active === true,
    sort_order: Number.isFinite(row.sort_order) ? row.sort_order : null,
    is_used: usedCodes ? usedCodes.has(code(row.category_code)) : null
  };
}

function sortCategoryRows(rows) {
  return (rows || []).slice().sort((left, right) => {
    const leftOrder = Number.isFinite(left.sort_order) ? left.sort_order : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(right.sort_order) ? right.sort_order : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return text(left.display_name).localeCompare(text(right.display_name), 'vi');
  });
}

async function listTaskCategories(session) {
  await resolveActorContext(session);
  ensureDb();
  const { data, error } = await supabase.from(CATEGORIES_TABLE)
    .select('category_code,display_name,description,color,is_active,sort_order')
    .eq('is_active', true);
  if (error) throwDb(error);
  return { categories: sortCategoryRows(data || []).map(row => categoryDto(row)) };
}

async function requireTaskAdmin(session) {
  const actorContext = await resolveActorContext(session);
  if (actorContext.actorType !== 'admin') fail('Chỉ Admin được quản lý danh mục PHF Task.', 403, 'TASK_CATEGORY_ADMIN_REQUIRED');
  return actorContext;
}

// used-codes: đọc distinct category_code THẬT SỰ đang được task_tasks tham
// chiếu — quyết định "được xóa hay chỉ Ngừng sử dụng" (Cài đặt mục 4). Query
// riêng thay vì JOIN vì task_categories thường rất ít dòng, đơn giản hơn.
async function loadUsedCategoryCodes() {
  ensureDb();
  const { data, error } = await supabase.from(TASKS_TABLE).select('category_code');
  if (error) throwDb(error);
  return new Set((data || []).map(row => code(row.category_code)).filter(Boolean));
}

async function listAdminTaskCategories(session) {
  await requireTaskAdmin(session);
  ensureDb();
  const [{ data, error }, usedCodes] = await Promise.all([
    supabase.from(CATEGORIES_TABLE).select('category_code,display_name,description,color,is_active,sort_order'),
    loadUsedCategoryCodes()
  ]);
  if (error) throwDb(error);
  return { categories: sortCategoryRows(data || []).map(row => categoryDto(row, usedCodes)) };
}

function validateCategoryCode(value) {
  const categoryCode = code(value);
  if (!/^[A-Z0-9_]+$/.test(categoryCode)) fail('Mã category chỉ gồm A-Z, 0-9 và dấu gạch dưới.', 400, 'TASK_CATEGORY_CODE_INVALID');
  return categoryCode;
}

function validateCategoryName(value) {
  const displayName = text(value);
  if (!displayName) fail('Tên category là bắt buộc.', 400, 'TASK_CATEGORY_NAME_REQUIRED');
  if (displayName.length > 120) fail('Tên category không được vượt quá 120 ký tự.', 400, 'TASK_CATEGORY_NAME_TOO_LONG');
  return displayName;
}

async function createTaskCategory(session, input) {
  const actorContext = await requireTaskAdmin(session);
  ensureDb();
  const categoryCode = validateCategoryCode(input && input.categoryCode);
  const displayName = validateCategoryName(input && input.displayName);
  const { data, error } = await supabase.from(CATEGORIES_TABLE).insert({
    category_code: categoryCode,
    display_name: displayName,
    is_active: true,
    ...actorAuditColumns(actorContext, 'created_by_account_id', 'created_by_employee_code'),
    ...actorAuditColumns(actorContext, 'updated_by_account_id', 'updated_by_employee_code'),
    updated_at: new Date().toISOString()
  }).select('*').single();
  if (error) {
    if (text(error.code) === '23505') fail('Mã category đã tồn tại và không được đổi sau khi sử dụng.', 409, 'TASK_CATEGORY_CODE_EXISTS');
    throwDb(error);
  }
  return { category: categoryDto(data), updated_by_account_id: actorContext.accountId || null, updated_by_employee_code: actorContext.employeeCode || null };
}

async function renameTaskCategory(session, categoryCodeInput, displayNameInput) {
  const actorContext = await requireTaskAdmin(session);
  ensureDb();
  const categoryCode = validateCategoryCode(categoryCodeInput);
  const displayName = validateCategoryName(displayNameInput);
  const { data, error } = await supabase.from(CATEGORIES_TABLE)
    .update({
      display_name: displayName,
      ...actorAuditColumns(actorContext, 'updated_by_account_id', 'updated_by_employee_code'),
      updated_at: new Date().toISOString()
    })
    .eq('category_code', categoryCode)
    .select('*').maybeSingle();
  if (error) throwDb(error);
  if (!data) fail('Category không tồn tại: ' + categoryCode, 404, 'TASK_CATEGORY_NOT_FOUND');
  return { category: categoryDto(data), updated_by_account_id: actorContext.accountId || null, updated_by_employee_code: actorContext.employeeCode || null };
}

async function setTaskCategoryActive(session, categoryCodeInput, isActive) {
  const actorContext = await requireTaskAdmin(session);
  ensureDb();
  const categoryCode = validateCategoryCode(categoryCodeInput);
  if (typeof isActive !== 'boolean') fail('Trạng thái active của category không hợp lệ.', 400, 'TASK_CATEGORY_ACTIVE_INVALID');
  const { data, error } = await supabase.from(CATEGORIES_TABLE)
    .update({
      is_active: isActive,
      ...actorAuditColumns(actorContext, 'updated_by_account_id', 'updated_by_employee_code'),
      updated_at: new Date().toISOString()
    })
    .eq('category_code', categoryCode)
    .select('*').maybeSingle();
  if (error) throwDb(error);
  if (!data) fail('Category không tồn tại: ' + categoryCode, 404, 'TASK_CATEGORY_NOT_FOUND');
  return { category: categoryDto(data), updated_by_account_id: actorContext.accountId || null, updated_by_employee_code: actorContext.employeeCode || null };
}

// deleteTaskCategory — "chưa từng dùng → được xóa vật lý; đã dùng → chỉ
// Ngừng sử dụng" (Cài đặt mục 4). Check-rồi-xóa được thực hiện ATOMIC trong
// RPC task_delete_category_if_unused (advisory lock + kiểm tra task_tasks
// trong CÙNG transaction) để tránh race condition với 1 Task mới đang được
// tạo đúng lúc category bị xóa — KHÔNG tự kiểm tra rồi DELETE rời 2 bước ở
// tầng JS. RPC này CHƯA tồn tại trên Production (xem
// scripts/PHF_TASK_CATEGORY_CREATE_FOUNDATION_1.70.0.sql, CHƯA APPLY).
async function deleteTaskCategory(session, categoryCodeInput) {
  const actorContext = await requireTaskAdmin(session);
  const categoryCode = validateCategoryCode(categoryCodeInput);
  await callRpc('task_delete_category_if_unused', { p_category_code: categoryCode });
  return { deleted: true, category_code: categoryCode, updated_by_account_id: actorContext.accountId || null, updated_by_employee_code: actorContext.employeeCode || null };
}

// reorderTaskCategory — cập nhật sort_order đơn thuần (1 statement, tự
// atomic) — không cần RPC vì không có invariant nhiều bảng cần bảo vệ.
async function reorderTaskCategory(session, categoryCodeInput, sortOrderInput) {
  const actorContext = await requireTaskAdmin(session);
  ensureDb();
  const categoryCode = validateCategoryCode(categoryCodeInput);
  const sortOrder = Number(sortOrderInput);
  if (!Number.isInteger(sortOrder) || sortOrder < 1) fail('Thứ tự sắp xếp không hợp lệ.', 400, 'TASK_CATEGORY_SORT_ORDER_INVALID');
  const { data, error } = await supabase.from(CATEGORIES_TABLE)
    .update({
      sort_order: sortOrder,
      ...actorAuditColumns(actorContext, 'updated_by_account_id', 'updated_by_employee_code'),
      updated_at: new Date().toISOString()
    })
    .eq('category_code', categoryCode)
    .select('*').maybeSingle();
  if (error) throwDb(error);
  if (!data) fail('Category không tồn tại: ' + categoryCode, 404, 'TASK_CATEGORY_NOT_FOUND');
  return { category: categoryDto(data), updated_by_account_id: actorContext.accountId || null, updated_by_employee_code: actorContext.employeeCode || null };
}

async function loadTaskRow(taskId) {
  ensureDb();
  const { data, error } = await supabase.from(TASKS_TABLE).select('*').eq('id', taskId).maybeSingle();
  if (error) throwDb(error);
  if (!data) fail('Không tìm thấy task.', 404, 'TASK_NOT_FOUND');
  return data;
}

async function loadAssignees(taskId) {
  ensureDb();
  const { data, error } = await supabase.from(ASSIGNEES_TABLE).select('*').eq('task_id', taskId);
  if (error) throwDb(error);
  return data || [];
}

function toRelationAssignees(rows) {
  return (rows || []).map(r => ({ employeeCode: r.employee_code, role: r.role, isActive: r.is_active }));
}

async function requireView(session, taskRow, assigneeRows) {
  const relationTask = {
    createdByAccountId: taskRow.created_by_account_id,
    createdByEmployeeCode: taskRow.created_by_employee_code
  };
  const allowed = await canViewTask(session, relationTask, toRelationAssignees(assigneeRows));
  if (!allowed) fail('Không có quyền xem task này.', 403, 'TASK_VIEW_DENIED');
}

// Creator luôn được phép (actorOwnsTask, xử lý ở call site). Với người KHÔNG
// phải creator, không được chỉ dựa vào cờ capability 'update' (boolean) —
// phải khớp thêm với peopleScope của primary hiện hành trên chính Task đó,
// nếu không TBP/Trưởng ca này sẽ vô tình sửa được cả Task của nhân viên
// KHÔNG thuộc phạm vi quản lý mình (Permission Matrix V1, mục 5).
async function requireUpdateAuthority(session, taskRow, assigneeRows) {
  const relationTask = {
    createdByAccountId: taskRow.created_by_account_id,
    createdByEmployeeCode: taskRow.created_by_employee_code
  };
  const allowed = await canUpdateTask(session, relationTask, toRelationAssignees(assigneeRows));
  if (!allowed) fail('Không có quyền cập nhật task này.', 403, 'TASK_UPDATE_DENIED');
}

async function categoryActive(categoryCode) {
  ensureDb();
  const { data, error } = await supabase.from(CATEGORIES_TABLE).select('category_code,is_active').eq('category_code', categoryCode).maybeSingle();
  if (error) throwDb(error);
  if (!data) fail('Category không tồn tại: ' + categoryCode, 400, 'TASK_CATEGORY_NOT_FOUND');
  if (!data.is_active) fail('Category đã ngừng dùng: ' + categoryCode, 400, 'TASK_CATEGORY_INACTIVE');
}

// ---------------------------------------------------------------------------
// 1) CREATE DRAFT — Task + initial primary atomic qua task_create_draft().
//    KHÔNG event (draft = pre-audit, đúng chủ ý Foundation hiện hữu).
// ---------------------------------------------------------------------------
async function createTaskDraft(session, input) {
  ensureDb();
  const actorContext = await resolveActorContext(session);
  const flowType = text(input.flowType);
  if (!['giao_viec', 'de_xuat'].includes(flowType)) fail('flow_type không hợp lệ.', 400, 'TASK_FLOW_TYPE_INVALID');
  const title = text(input.title);
  if (!title) fail('Tiêu đề là bắt buộc.', 400, 'TASK_TITLE_REQUIRED');
  const categoryCode = code(input.categoryCode);
  if (!categoryCode) fail('Category là bắt buộc.', 400, 'TASK_CATEGORY_REQUIRED');
  await categoryActive(categoryCode);
  const priority = text(input.priority) || 'thuong';
  if (!['thuong', 'quan_trong', 'khan_cap'].includes(priority)) fail('priority không hợp lệ.', 400, 'TASK_PRIORITY_INVALID');
  const startAt = isoTimestamp(input.startAt, 'Ngày bắt đầu', false);
  const deadline = isoTimestamp(input.deadline, 'Deadline', true);
  if (startAt && new Date(startAt).getTime() > new Date(deadline).getTime()) {
    fail('Ngày bắt đầu không được sau deadline.', 400, 'TASK_DATE_ORDER_INVALID');
  }

  const primaryEmployeeCode = input.primaryEmployeeCode ? code(input.primaryEmployeeCode) : '';
  if (primaryEmployeeCode) {
    // self-task luôn hợp lệ; giao người khác cần capability assign + scope —
    // dùng đúng permission engine Batch 1, không tự viết lại logic.
    const allowed = await canAssignTaskTo(session, primaryEmployeeCode);
    if (!allowed) fail('Không có quyền giao task cho nhân sự này.', 403, 'TASK_ASSIGN_DENIED');
  }

  const idempotencyKey = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text(input.idempotencyKey))
    ? text(input.idempotencyKey) : null;

  return callTaskCreateDraftRpc({
    p_flow_type: flowType,
    p_title: title,
    p_content: text(input.content),
    p_category_code: categoryCode,
    p_priority: priority,
    p_start_at: startAt,
    p_deadline: deadline,
    p_actor_employee_code: actorAuditToken(actorContext),
    p_primary_employee_code: primaryEmployeeCode || null,
    p_idempotency_key: idempotencyKey
  });
}

// ---------------------------------------------------------------------------
// 2) UPDATE DRAFT — single UPDATE với WHERE status='draft' AND row_version=?,
//    tự atomic (1 statement). Chỉ creator/actor có capability update mới sửa.
// ---------------------------------------------------------------------------
async function updateTaskDraft(session, taskId, expectedRowVersion, patch) {
  ensureDb();
  const actorContext = await resolveActorContext(session);
  const current = await loadTaskRow(taskId);
  if (current.status !== 'draft') fail('Chỉ sửa được task đang ở trạng thái draft.', 409, 'TASK_NOT_DRAFT');
  if (!actorOwnsTask(actorContext, current)) {
    const assigneeRows = await loadAssignees(taskId);
    await requireUpdateAuthority(session, current, assigneeRows);
  }

  const patchRow = {};
  if (patch.title !== undefined) {
    const title = text(patch.title);
    if (!title) fail('Tiêu đề không được rỗng.', 400, 'TASK_TITLE_REQUIRED');
    patchRow.title = title;
  }
  if (patch.content !== undefined) patchRow.content = text(patch.content);
  if (patch.categoryCode !== undefined) {
    const categoryCode = code(patch.categoryCode);
    await categoryActive(categoryCode);
    patchRow.category_code = categoryCode;
  }
  if (patch.priority !== undefined) {
    if (!['thuong', 'quan_trong', 'khan_cap'].includes(patch.priority)) fail('priority không hợp lệ.', 400, 'TASK_PRIORITY_INVALID');
    patchRow.priority = patch.priority;
  }
  if (patch.startAt !== undefined) patchRow.start_at = patch.startAt || null;
  if (patch.deadline !== undefined) {
    if (!text(patch.deadline)) fail('Deadline không được rỗng.', 400, 'TASK_DEADLINE_REQUIRED');
    patchRow.deadline = patch.deadline;
  }
  patchRow.updated_at = new Date().toISOString();
  patchRow.row_version = expectedRowVersion + 1;

  const { data, error } = await supabase.from(TASKS_TABLE)
    .update(patchRow)
    .eq('id', taskId).eq('status', 'draft').eq('row_version', expectedRowVersion)
    .select('*').maybeSingle();
  if (error) throwDb(error);
  if (!data) {
    const recheck = await loadTaskRow(taskId);
    if (recheck.status !== 'draft') fail('Chỉ sửa được task đang ở trạng thái draft.', 409, 'TASK_NOT_DRAFT');
    fail('Task đã được cập nhật ở nơi khác. Vui lòng tải lại trước khi thao tác tiếp.', 409, 'TASK_VERSION_CONFLICT');
  }
  return data;
}

// ---------------------------------------------------------------------------
// 3) PUBLISH — atomic qua RPC task_publish (2 statement: update + event).
// ---------------------------------------------------------------------------
// CROSS-DEPARTMENT PUBLISH SIDE-EFFECT (Cross-department Task V1, REVISED sau
// Business Owner review mục 7) — department snapshot KHÔNG còn ghi ở đây.
// Snapshot (source_department/target_department/is_cross_department) giờ
// được DB trigger task_snapshot_department_on_publish() ghi ATOMIC, CÙNG
// transaction với chính statement chuyển status sang 'published' (xem PHẦN 2
// scripts/PHF_TASK_CROSS_DEPARTMENT_NOTIFICATION_1.72.0.sql) — không còn
// khoảng hở "publish thành công nhưng UPDATE snapshot rời có thể lỗi" như
// thiết kế trước. Nhờ vậy, hàm này chỉ cần ĐỌC LẠI kết quả `publishedTaskRow`
// mà chính task_publish RPC đã trả về (RETURNING * đã phản ánh giá trị
// trigger vừa ghi) — KHÔNG tự tính lại, KHÔNG tự ghi gì vào task_tasks.
//
// Notification VẪN CỐ Ý không atomic với publish (mục 8 đã CHỐT: notification
// là delivery thứ cấp — publish không bao giờ bị ảnh hưởng nếu bước này lỗi;
// mọi lỗi bên trong bị nuốt/log, không throw ra ngoài). Nếu 1.72.0 chưa
// apply, publishedTaskRow sẽ không có field is_cross_department (RPC cũ
// không trả field đó) — no-op sạch, không log noise, không đoán.
// ---------------------------------------------------------------------------
async function applyCrossDepartmentPublishSideEffects(actorContext, taskId, publishedTaskRow) {
  try {
    const row = publishedTaskRow || {};
    if (!Object.prototype.hasOwnProperty.call(row, 'is_cross_department')) return; // 1.72.0 chưa apply — RPC cũ không có field này
    if (row.is_cross_department !== true) return; // false hoặc null (unknown) — mục 12/13: không notification

    // PRIMARY CUỐI CÙNG (mục 14): trigger đã dùng đúng Primary active tại
    // thời điểm publish để tính target_department — ở đây chỉ cần đọc lại
    // ĐÚNG người đó để tìm manager, KHÔNG suy diễn lại từ nơi khác.
    const assigneeRows = await loadAssignees(taskId);
    const activePrimary = assigneeRows.find(a => a.role === 'primary' && a.is_active);
    if (!activePrimary) return;

    const rows = await loadOrgRows();
    const primarySubject = findByCode(rows, activePrimary.employee_code);
    if (!primarySubject || !primarySubject.managerCode) return; // không có manager_employee_code thật — không đoán
    const managerCode = primarySubject.managerCode;
    if (managerCode === actorContext.employeeCode) return; // người giao chính là manager của Primary — họ đã biết, không tự thông báo cho chính mình

    const managerSubject = findByCode(rows, managerCode);
    if (!managerSubject || String(managerSubject.status || '').toLowerCase() !== 'active') return; // manager đã nghỉ việc — không thông báo cho hồ sơ không còn hoạt động

    const managerAssignment = await loadActiveTaskAssignment({ employeeCode: managerCode, accountId: '' });
    const managerActorType = managerAssignment && TASK_PRESET_TO_ACTOR_TYPE[code(managerAssignment.preset_code)];
    if (!managerActorType || !CROSS_DEPT_MANAGER_ACTOR_TYPES.has(managerActorType)) return; // manager_employee_code có, nhưng KHÔNG có Task authority quản lý thật — không tự cấp

    await emitTaskNotificationSafe('TASK_CROSS_DEPARTMENT_ASSIGNED', {
      taskId,
      recipient: { employeeCode: managerCode },
      title: 'Công việc liên phòng ban mới',
      message: 'Có công việc liên phòng ban được giao cho nhân sự thuộc phạm vi quản lý của bạn (' + row.source_department + ' → ' + row.target_department + '). Đây KHÔNG phải yêu cầu duyệt.',
      targetPath: '/task/chi-tiet?task_id=' + taskId,
      dedupeKey: 'TASK_CROSS_DEPARTMENT_ASSIGNED|' + taskId
    });
  } catch (error) {
    console.warn('[PHF Task] cross-department notification thất bại (bỏ qua, không ảnh hưởng publish):', error && error.message ? error.message : error);
  }
}

async function publishTask(session, taskId, expectedRowVersion) {
  const actorContext = await resolveActorContext(session);
  const current = await loadTaskRow(taskId);
  if (!actorOwnsTask(actorContext, current)) {
    const { scope } = await resolveEffectiveTaskScope(session);
    requireTaskCapability({ scope }, 'assign');
  }
  const published = await callRpc('task_publish', {
    p_task_id: taskId, p_expected_row_version: expectedRowVersion, p_actor_employee_code: actorAuditToken(actorContext)
  });
  await applyCrossDepartmentPublishSideEffects(actorContext, taskId, published);
  return published;
}

// ---------------------------------------------------------------------------
// 4) READ / DETAIL — canViewTask() TRƯỚC khi trả bất kỳ dữ liệu nào.
// ---------------------------------------------------------------------------
async function getTaskDetail(session, taskId) {
  const task = await loadTaskRow(taskId);
  const assigneeRows = await loadAssignees(taskId);
  await requireView(session, task, assigneeRows);

  ensureDb();
  const [commentsRes, linksRes, eventsRes, categoryRes, orgRows] = await Promise.all([
    supabase.from(COMMENTS_TABLE).select('*').eq('task_id', taskId).order('created_at', { ascending: true }),
    supabase.from(LINKS_TABLE).select('*').eq('task_id', taskId).order('created_at', { ascending: true }),
    supabase.from(EVENTS_TABLE).select('*').eq('task_id', taskId).order('occurred_at', { ascending: false }),
    supabase.from(CATEGORIES_TABLE).select('category_code,display_name,description,color,is_active').eq('category_code', task.category_code).maybeSingle(),
    loadOrgRows()
  ]);
  if (commentsRes.error) throwDb(commentsRes.error);
  if (linksRes.error) throwDb(linksRes.error);
  if (eventsRes.error) throwDb(eventsRes.error);
  if (categoryRes.error) throwDb(categoryRes.error);

  // "Xóa" link = ghi event payload.action='remove' (KHÔNG hard-delete row,
  // KHÔNG cần cột soft-delete mới — xem lib/task-core.js:removeTaskLink()).
  // Ở đây lọc link đã bị remove ra khỏi danh sách hiển thị hiện hành.
  const removedLinkIds = new Set(
    (eventsRes.data || [])
      .filter(e => e.event_type === 'link' && e.payload && e.payload.action === 'remove' && e.payload.link_id)
      .map(e => e.payload.link_id)
  );
  const activeLinks = (linksRes.data || []).filter(l => !removedLinkIds.has(l.id));
  const peopleByCode = new Map((orgRows || []).map(person => [code(person.employeeCode), person]));
  const enrichAssignee = row => {
    if (!row) return null;
    const person = peopleByCode.get(code(row.employee_code));
    return {
      ...row,
      employee_code: code(row.employee_code),
      full_name: person ? person.fullName : '',
      department: person ? person.department : '',
      title: person ? person.title : '',
      position: person ? person.position : '',
      branch: person ? person.branch : '',
      employment_status: person ? person.status : ''
    };
  };

  return {
    task,
    category: categoryDto(categoryRes.data) || { category_code: code(task.category_code), display_name: code(task.category_code), description: '', color: '#64748B', is_active: false },
    primary: enrichAssignee(assigneeRows.find(a => a.role === 'primary' && a.is_active) || null),
    related: assigneeRows.filter(a => a.role === 'related' && a.is_active).map(enrichAssignee),
    comments: commentsRes.data || [],
    links: activeLinks,
    events: eventsRes.data || []
  };
}

// ---------------------------------------------------------------------------
// 5) PROGRESS UPDATE — atomic qua RPC.
// ---------------------------------------------------------------------------
async function updateTaskProgress(session, taskId, expectedRowVersion, progressPercent, progressStatus) {
  const actorContext = await resolveActorContext(session);
  const assigneeRows = await loadAssignees(taskId);
  const activePrimary = assigneeRows.find(a => a.role === 'primary' && a.is_active);
  if (!activePrimary || activePrimary.employee_code !== actorContext.employeeCode) {
    fail('Chỉ primary hiện hành mới cập nhật tiến độ.', 403, 'TASK_PROGRESS_ACTOR_DENIED');
  }
  return callRpc('task_update_progress', {
    p_task_id: taskId, p_expected_row_version: expectedRowVersion, p_actor_employee_code: actorAuditToken(actorContext),
    p_progress_percent: progressPercent, p_progress_status: progressStatus
  });
}

// ---------------------------------------------------------------------------
// 6) COMPLETE — explicit, primary hiện hành, atomic qua RPC.
// ---------------------------------------------------------------------------
async function completeTask(session, taskId, expectedRowVersion, resultText) {
  const actorContext = await resolveActorContext(session);
  const assigneeRows = await loadAssignees(taskId);
  const activePrimary = assigneeRows.find(a => a.role === 'primary' && a.is_active);
  if (!activePrimary || activePrimary.employee_code !== actorContext.employeeCode) {
    fail('Chỉ primary hiện hành mới bấm Hoàn thành.', 403, 'TASK_COMPLETE_ACTOR_DENIED');
  }
  return callRpc('task_complete', {
    p_task_id: taskId, p_expected_row_version: expectedRowVersion, p_actor_employee_code: actorAuditToken(actorContext),
    p_result_text: resultText
  });
}

// ---------------------------------------------------------------------------
// 7) REOPEN — creator hoặc capability update, atomic qua RPC.
// ---------------------------------------------------------------------------
async function reopenTask(session, taskId, expectedRowVersion, reason) {
  const actorContext = await resolveActorContext(session);
  const current = await loadTaskRow(taskId);
  if (!actorOwnsTask(actorContext, current)) {
    const assigneeRows = await loadAssignees(taskId);
    await requireUpdateAuthority(session, current, assigneeRows);
  }
  return callRpc('task_reopen', {
    p_task_id: taskId, p_expected_row_version: expectedRowVersion, p_actor_employee_code: actorAuditToken(actorContext), p_reason: reason
  });
}

// ---------------------------------------------------------------------------
// 8) CANCEL — creator hoặc capability update, atomic qua RPC.
// ---------------------------------------------------------------------------
async function cancelTask(session, taskId, expectedRowVersion, reason) {
  const actorContext = await resolveActorContext(session);
  const current = await loadTaskRow(taskId);
  if (!actorOwnsTask(actorContext, current)) {
    const assigneeRows = await loadAssignees(taskId);
    await requireUpdateAuthority(session, current, assigneeRows);
  }
  return callRpc('task_cancel', {
    p_task_id: taskId, p_expected_row_version: expectedRowVersion, p_actor_employee_code: actorAuditToken(actorContext), p_reason: reason
  });
}

// ---------------------------------------------------------------------------
// 9) DEADLINE CHANGE — creator/capability update, atomic qua RPC.
// ---------------------------------------------------------------------------
async function changeTaskDeadline(session, taskId, expectedRowVersion, newDeadline, reason) {
  const actorContext = await resolveActorContext(session);
  const current = await loadTaskRow(taskId);
  if (!actorOwnsTask(actorContext, current)) {
    const assigneeRows = await loadAssignees(taskId);
    await requireUpdateAuthority(session, current, assigneeRows);
  }
  return callRpc('task_change_deadline', {
    p_task_id: taskId, p_expected_row_version: expectedRowVersion, p_actor_employee_code: actorAuditToken(actorContext),
    p_new_deadline: newDeadline, p_reason: reason
  });
}

// ---------------------------------------------------------------------------
// 10) TRANSFER PRIMARY — atomic qua RPC. Scope target verify TRƯỚC ở JS.
// ---------------------------------------------------------------------------
async function transferTaskPrimary(session, taskId, expectedRowVersion, newPrimaryEmployeeCode, reason) {
  const actorContext = await resolveActorContext(session);
  const current = await loadTaskRow(taskId);
  if (!actorOwnsTask(actorContext, current)) {
    const assigneeRows = await loadAssignees(taskId);
    await requireUpdateAuthority(session, current, assigneeRows);
  }
  const allowedTarget = await canAssignTaskTo(session, newPrimaryEmployeeCode);
  if (!allowedTarget) fail('Người phụ trách mới nằm ngoài phạm vi giao việc của bạn.', 403, 'TASK_TRANSFER_TARGET_DENIED');
  return callRpc('task_transfer_primary', {
    p_task_id: taskId, p_expected_row_version: expectedRowVersion, p_actor_employee_code: actorAuditToken(actorContext),
    p_new_primary_employee_code: code(newPrimaryEmployeeCode), p_reason: reason
  });
}

// ---------------------------------------------------------------------------
// 11) RELATED PEOPLE — add atomic/idempotent qua RPC; remove giữ command cũ.
// ---------------------------------------------------------------------------
async function addTaskRelated(session, taskId, targetEmployeeCode) {
  ensureDb();
  const actorContext = await resolveActorContext(session);
  const current = await loadTaskRow(taskId);
  const assigneeRows = await loadAssignees(taskId);
  if (!actorOwnsTask(actorContext, current)) {
    await requireUpdateAuthority(session, current, assigneeRows);
  }
  const target = code(targetEmployeeCode);
  const activePrimary = assigneeRows.find(a => a.role === 'primary' && a.is_active);
  if (activePrimary && activePrimary.employee_code === target) {
    fail('Không thể thêm primary hiện hành làm related.', 400, 'TASK_RELATED_IS_PRIMARY');
  }
  // Related HOLD (Phase 1.5 mục 4): dùng canAddTaskRelated (peopleScope),
  // KHÔNG dùng canAssignTaskTo (assignScope) — tránh biến "được giao toàn
  // công ty" thành "related toàn công ty". Xem lib/task-permissions.js.
  const allowedTarget = await canAddTaskRelated(session, target);
  if (!allowedTarget) fail('Nhân sự này nằm ngoài phạm vi của bạn.', 403, 'TASK_RELATED_TARGET_DENIED');

  return callRpc('task_add_related', {
    p_task_id: taskId,
    p_target_employee_code: target,
    p_actor_employee_code: actorAuditToken(actorContext)
  });
}

async function removeTaskRelated(session, taskId, targetEmployeeCode) {
  ensureDb();
  const actorContext = await resolveActorContext(session);
  const current = await loadTaskRow(taskId);
  if (!actorOwnsTask(actorContext, current)) {
    const assigneeRows = await loadAssignees(taskId);
    await requireUpdateAuthority(session, current, assigneeRows);
  }
  const target = code(targetEmployeeCode);
  const { data, error } = await supabase.from(ASSIGNEES_TABLE)
    .update({ is_active: false, deactivated_at: new Date().toISOString() })
    .eq('task_id', taskId).eq('employee_code', target).eq('role', 'related').eq('is_active', true)
    .select('*').maybeSingle();
  if (error) throwDb(error);
  if (!data) fail('Không tìm thấy related active để gỡ.', 404, 'TASK_RELATED_NOT_FOUND');

  const { error: evError } = await supabase.from(EVENTS_TABLE).insert({
    task_id: taskId, event_type: 'assignment',
    ...actorAuditColumns(actorContext, 'actor_account_id', 'actor_employee_code'),
    payload: { action: 'remove', role: 'related', employee_code: target }
  });
  if (evError) throwDb(evError);

  return data;
}

// ---------------------------------------------------------------------------
// 12) COMMENTS — append-only theo convention (V1 không sửa/xóa). task_comments
//     CHƯA có DB trigger append-only (KHÁC task_events) — GAP đã biết, không
//     tự thêm migration ở Batch 2 (xem Output mục F/report riêng).
// ---------------------------------------------------------------------------
async function addTaskComment(session, taskId, body) {
  ensureDb();
  const actorContext = await resolveActorContext(session);
  const task = await loadTaskRow(taskId);
  const assigneeRows = await loadAssignees(taskId);
  await requireView(session, task, assigneeRows);
  const trimmed = text(body);
  if (!trimmed) fail('Nội dung comment không được rỗng.', 400, 'TASK_COMMENT_BODY_REQUIRED');

  const { data, error } = await supabase.from(COMMENTS_TABLE).insert({
    task_id: taskId,
    ...actorAuditColumns(actorContext, 'author_account_id', 'author_employee_code'),
    body: trimmed
  }).select('*').single();
  if (error) throwDb(error);

  const { error: evError } = await supabase.from(EVENTS_TABLE).insert({
    task_id: taskId, event_type: 'comment',
    ...actorAuditColumns(actorContext, 'actor_account_id', 'actor_employee_code'),
    payload: { comment_id: data.id }
  });
  if (evError) throwDb(evError);

  return data;
}

// ---------------------------------------------------------------------------
// 13) LINKS — add atomic/idempotent qua RPC. "Xóa" = event action='remove',
//     KHÔNG hard-delete row
//     (giữ đúng "không được làm mất dấu rằng link từng tồn tại" mà KHÔNG cần
//     thêm cột soft-delete/migration mới — xem getTaskDetail() lọc theo event).
// ---------------------------------------------------------------------------
const LINK_SIDES = ['input_reference', 'output_result', 'coordination'];
function isValidUrl(value) {
  try { const u = new URL(text(value)); return u.protocol === 'http:' || u.protocol === 'https:'; } catch (e) { return false; }
}

async function addTaskLink(session, taskId, side, url, label) {
  ensureDb();
  const actorContext = await resolveActorContext(session);
  const task = await loadTaskRow(taskId);
  const assigneeRows = await loadAssignees(taskId);
  await requireView(session, task, assigneeRows);
  if (!LINK_SIDES.includes(side)) fail('side không hợp lệ.', 400, 'TASK_LINK_SIDE_INVALID');
  if (!isValidUrl(url)) fail('URL không hợp lệ.', 400, 'TASK_LINK_URL_INVALID');

  return callRpc('task_add_link', {
    p_task_id: taskId,
    p_side: side,
    p_url: text(url),
    p_label: label ? text(label) : null,
    p_actor_employee_code: actorAuditToken(actorContext)
  });
}

async function removeTaskLink(session, taskId, linkId) {
  ensureDb();
  const actorContext = await resolveActorContext(session);
  const task = await loadTaskRow(taskId);
  const assigneeRows = await loadAssignees(taskId);
  await requireView(session, task, assigneeRows);

  const { data: link, error: linkError } = await supabase.from(LINKS_TABLE).select('*').eq('id', linkId).eq('task_id', taskId).maybeSingle();
  if (linkError) throwDb(linkError);
  if (!link) fail('Không tìm thấy link.', 404, 'TASK_LINK_NOT_FOUND');

  const { error: evError } = await supabase.from(EVENTS_TABLE).insert({
    task_id: taskId, event_type: 'link',
    ...actorAuditColumns(actorContext, 'actor_account_id', 'actor_employee_code'),
    payload: { action: 'remove', link_id: link.id, side: link.side, url: link.url }
  });
  if (evError) throwDb(evError);

  return { removed: true, link_id: link.id };
}

// ---------------------------------------------------------------------------
// 12) LIST TASKS — Workspace/Menu/View Scope V1. Một nguồn Task (task_tasks +
// task_assignees) → nhiều authorized view, KHÔNG có business engine riêng cho
// từng góc nhìn (myReceivedTasks/myAssignedTasks/managerTasks). AUTHORIZATION
// (ai được xem gì) tách khỏi VIEW/FILTER (status/scope/search) — authorization
// LUÔN enforce server-side bằng chính câu query (không fetch hết rồi lọc JS).
//
// relation (góc nhìn nghiệp vụ, KHÔNG phải trạng thái):
//   'received'          — "Tôi nhận": task_assignees.role='primary' của actor
//                          (+ mở rộng theo peopleScope nếu là quản lý — xem dưới).
//   'assigned'          — "Tôi giao": task_tasks.created_by_employee_code=actor,
//                          flow_type='giao_viec'. LUÔN self-only theo đúng nghĩa
//                          "CÁC CÔNG VIỆC BẠN ĐÃ GIAO" — canonical View Scope V1
//                          mục 2.B chỉ liệt kê quản lý được mở rộng xem Task
//                          NHÂN VIÊN MÌNH QUẢN LÝ NHẬN (relation='received'),
//                          KHÔNG mở rộng sang Task nhân viên mình quản lý GIAO —
//                          nên 'assigned' không có scope mở rộng cho bất kỳ actor
//                          type nào (kể cả Admin/GĐ/TLGĐ — xem OPEN BUSINESS
//                          QUESTIONS trong báo cáo bàn giao đi kèm).
//   'proposal_sent'     — như 'assigned' nhưng flow_type='de_xuat'.
//   'proposal_received' — như 'received' nhưng flow_type='de_xuat', LUÔN
//                          self-only (không mở rộng theo peopleScope quản lý —
//                          canonical mục 2.B chỉ nói "Đề xuất gửi tới mình", không
//                          nói "Đề xuất gửi tới nhân viên mình quản lý").
//
// Manager view scope mở rộng (chỉ áp dụng relation='received') tái dùng NGUYÊN
// resolveEffectiveTaskScope().scope.peopleScope đã canonical — KHÔNG suy đoán
// manager mới, KHÔNG mở permission engine thứ hai. scope filter ('mine'/
// 'managed'/'cross_department'/'all_company') CHỈ lọc trong tập đã authorized,
// không tự cấp thêm quyền (mục 8 — "UI filter không phải security boundary").
const TASK_LIST_RELATIONS = new Set(['received', 'assigned', 'proposal_sent', 'proposal_received']);
const TASK_LIST_STATUS_FILTERS = new Set(['all', 'in_progress', 'overdue', 'completed']);
const TASK_LIST_SCOPES = new Set(['mine', 'managed', 'cross_department', 'all_company']);

async function listTasks(session, params) {
  ensureDb();
  const { actorContext, scope } = await resolveEffectiveTaskScope(session);
  const input = params || {};

  const relation = text(input.relation);
  if (!TASK_LIST_RELATIONS.has(relation)) fail('Góc nhìn (relation) không hợp lệ.', 400, 'TASK_LIST_RELATION_INVALID');
  const statusFilter = TASK_LIST_STATUS_FILTERS.has(text(input.statusFilter)) ? text(input.statusFilter) : 'all';
  const scopeParam = TASK_LIST_SCOPES.has(text(input.scope)) ? text(input.scope) : '';
  const search = text(input.search).slice(0, 100);
  const limit = Math.min(200, Math.max(1, Number(input.limit) || 50));
  // Pagination foundation (mục 11 — không migration, không thay authorization):
  // server-side offset qua PostgREST .range(), enforce SAU KHI authorization/
  // filter đã áp hết (không đổi thứ tự: auth trước, pagination sau, luôn luôn).
  // Ordering deterministic: created_at desc + id asc làm tie-break (2 Task
  // cùng created_at millisecond vẫn có thứ tự cố định, không "trôi" giữa các
  // trang khi offset tăng).
  const offset = Math.min(5000, Math.max(0, Math.trunc(Number(input.offset)) || 0));

  const isReceivedLike = relation === 'received' || relation === 'proposal_received';
  const flowType = (relation === 'proposal_sent' || relation === 'proposal_received') ? 'de_xuat' : 'giao_viec';
  const nowIso = new Date().toISOString();
  const emptyResult = { tasks: [], relation, statusFilter, scope: scopeParam || 'default', viewScopeType: scope.peopleScope.type, requesterActorType: actorContext.actorType, offset, limit, hasMore: false };

  let taskQuery = supabase.from(TASKS_TABLE).select('*').eq('flow_type', flowType);

  if (isReceivedLike) {
    // "Đề xuất tôi nhận xử lý" LUÔN self-only theo đúng nghĩa cá nhân (không
    // suy sang phạm vi quản lý) — chỉ relation='received' mới dùng peopleScope
    // canonical để mở rộng cho TBP/Trưởng ca/Admin/GĐ/TLGĐ.
    let employeeCodes; // null => không giới hạn (all_company)
    if (relation === 'proposal_received') {
      employeeCodes = [actorContext.employeeCode];
    } else if (scope.peopleScope.type === 'all_company') {
      employeeCodes = (scopeParam === 'mine') ? [actorContext.employeeCode] : null;
    } else if (scope.peopleScope.type === 'employees') {
      const managed = Array.from(actorContext.managedEmployeeCodes || []);
      if (scopeParam === 'mine') employeeCodes = [actorContext.employeeCode];
      else if (scopeParam === 'managed' || scopeParam === 'cross_department') employeeCodes = managed;
      else employeeCodes = scope.peopleScope.values || [actorContext.employeeCode];
    } else {
      employeeCodes = [actorContext.employeeCode];
    }

    if (employeeCodes !== null && !employeeCodes.length) return emptyResult;

    let assigneeQuery = supabase.from(ASSIGNEES_TABLE).select('task_id').eq('role', 'primary').eq('is_active', true);
    if (employeeCodes !== null) assigneeQuery = assigneeQuery.in('employee_code', employeeCodes);
    const { data: assigneeRows, error: assigneeError } = await assigneeQuery.limit(5000);
    if (assigneeError) throwDb(assigneeError);
    const taskIds = Array.from(new Set((assigneeRows || []).map(r => r.task_id)));
    if (!taskIds.length) return emptyResult;

    taskQuery = taskQuery.in('id', taskIds);
    // draft ẩn khỏi người nhận — chưa publish nghĩa là chưa "thật" với người
    // nhận (không notification, không audit event) — chỉ creator thấy ở
    // relation='assigned'/'proposal_sent' (đúng đặc tả mục 6 handoff Create
    // Foundation: "draft = pre-audit").
    taskQuery = taskQuery.neq('status', 'draft');
    if (scopeParam === 'cross_department') taskQuery = taskQuery.eq('is_cross_department', true);
  } else {
    taskQuery = taskQuery.eq('created_by_employee_code', actorContext.employeeCode);
  }

  if (statusFilter === 'completed') taskQuery = taskQuery.eq('status', 'completed');
  else if (statusFilter === 'in_progress') taskQuery = taskQuery.in('status', ['published', 'in_progress']).gte('deadline', nowIso);
  else if (statusFilter === 'overdue') taskQuery = taskQuery.in('status', ['published', 'in_progress']).lt('deadline', nowIso);

  if (search) taskQuery = taskQuery.or('task_code.ilike.%' + search + '%,title.ilike.%' + search + '%');

  // Range lấy dư 1 dòng (limit+1) để biết hasMore mà KHÔNG cần query count()
  // riêng (2 round-trip) — cắt bớt dòng dư trước khi trả về client.
  const { data: pageRows, error: taskError } = await taskQuery
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit);
  if (taskError) throwDb(taskError);
  const hasMore = !!(pageRows && pageRows.length > limit);
  const taskRows = hasMore ? pageRows.slice(0, limit) : (pageRows || []);
  if (!taskRows.length) return emptyResult;

  const taskIdsForEnrich = taskRows.map(t => t.id);
  const { data: enrichAssignees, error: enrichError } = await supabase.from(ASSIGNEES_TABLE).select('*').in('task_id', taskIdsForEnrich).eq('is_active', true);
  if (enrichError) throwDb(enrichError);
  const orgRows = await loadOrgRows();
  const peopleByCode = new Map(orgRows.map(person => [code(person.employeeCode), person]));
  function personInfo(employeeCode) {
    const person = peopleByCode.get(code(employeeCode));
    return { employee_code: code(employeeCode), full_name: person ? person.fullName : '', department: person ? person.department : '' };
  }

  const tasks = taskRows.map(t => {
    const primary = (enrichAssignees || []).find(a => a.task_id === t.id && a.role === 'primary' && a.is_active);
    return {
      task_id: t.id,
      task_code: t.task_code,
      title: t.title,
      flow_type: t.flow_type,
      status: t.status,
      priority: t.priority,
      deadline: t.deadline,
      category_code: t.category_code,
      progress_percent: t.progress_percent,
      progress_status: t.progress_status,
      is_cross_department: t.is_cross_department,
      source_department: t.source_department,
      target_department: t.target_department,
      created_by: personInfo(t.created_by_employee_code),
      primary: primary ? personInfo(primary.employee_code) : null,
      // self-task metadata (mục 11 handoff — compatibility cho Dashboard/Report
      // sau này, KHÔNG tính KPI ở đây): "được giao" (creator ≠ primary),
      // "tự giao" (creator === primary), KHÔNG có "phối hợp" ở list level vì
      // đó là quan hệ related (CC) — related không nằm trong scope list này.
      self_task: !!(primary && code(t.created_by_employee_code) === code(primary.employee_code)),
      row_version: t.row_version
    };
  });

  return { tasks, relation, statusFilter, scope: scopeParam || 'default', viewScopeType: scope.peopleScope.type, requesterActorType: actorContext.actorType, offset, limit, hasMore };
}

module.exports = {
  listTaskAssignableEmployees,
  listTaskAdminPeople,
  saveTaskPermissionAssignment,
  createTaskPermissionGrant,
  revokeTaskPermissionGrant,
  listTaskCategories,
  listAdminTaskCategories,
  createTaskCategory,
  renameTaskCategory,
  setTaskCategoryActive,
  deleteTaskCategory,
  reorderTaskCategory,
  checkTaskFoundationStatus,
  createTaskDraft,
  updateTaskDraft,
  publishTask,
  getTaskDetail,
  updateTaskProgress,
  completeTask,
  reopenTask,
  cancelTask,
  changeTaskDeadline,
  transferTaskPrimary,
  addTaskRelated,
  removeTaskRelated,
  addTaskComment,
  addTaskLink,
  removeTaskLink,
  listTasks
};
