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
  resolveUpdateAuthorityBasis,
  resolveTaskViewerAuthority,
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

// ---------------------------------------------------------------------------
// updateTaskProgress CONTAINMENT — PHF_SUPABASE_CPU_FIX_V1. Two independent
// layers, neither alone claimed sufficient, both purely additive (no schema/
// config/platform change, no business-rule change):
//
// Layer 1 (PROGRESS_THROTTLE_MAP below) — per-instance, in-process, short
// sliding window keyed by actor+task+action. Explicitly NOT distributed-safe
// on its own (Vercel/serverless can run multiple instances with separate
// memory) — it only guarantees suppression of rapid-fire attempts landing on
// the SAME warm instance. Kept because it is real, free, and catches a real
// subset of bursts (same-instance reuse is common for consecutive requests
// from one client under normal routing) — never represented as the complete
// fix by itself.
//
// Layer 2 (the row_version pre-check inside updateTaskProgress(), below) —
// genuinely distributed-safe: every instance reads the SAME row from the
// SAME database before deciding whether to even attempt the RPC. This is
// the layer that actually caps cost for the dominant storm shape this gate's
// evidence points to (a caller repeatedly resubmitting a stale/already-
// superseded expected_row_version) — a cheap single-column SELECT replaces
// a full RPC transaction (SET_CONFIG + SELECT...FOR UPDATE + ROLLBACK) for
// every such repeat, on every instance, without any new infrastructure.
// It is NOT a substitute for a true cross-instance concurrent-burst lock
// (many DIFFERENT instances receiving the SAME actor+task+valid-version
// request at the same literal instant) — that residual gap would need
// either a small RPC-side pg_try_advisory_xact_lock addition (a migration)
// or a platform-level distributed store (a platform feature), neither of
// which is implemented here — see gate report, proposed not applied.
//
// The pre-check NEVER weakens correctness: the RPC's own SELECT...FOR
// UPDATE + row_version comparison remains the sole authoritative CAS gate.
// This pre-check can only ever short-circuit to the SAME error the RPC
// would itself have produced (TASK_VERSION_CONFLICT / TASK_NOT_FOUND,
// identical code/message/status) — a race between the pre-check read and
// the RPC call (row changes in between) is harmless: the RPC still runs
// and still enforces CAS correctly if the pre-check happened to pass stale.
// ---------------------------------------------------------------------------
const TASK_PROGRESS_THROTTLE_WINDOW_MS = 500;
const progressThrottleMap = new Map();
function taskProgressThrottleKey(actorContext, taskId) {
  return (actorContext.employeeCode || actorContext.accountId || '') + '|' + taskId;
}
function checkTaskProgressThrottle(actorContext, taskId) {
  const key = taskProgressThrottleKey(actorContext, taskId);
  const now = Date.now();
  const last = progressThrottleMap.get(key);
  progressThrottleMap.set(key, now);
  // Opportunistic eviction of stale entries so this Map cannot grow
  // unbounded across a long-lived warm instance — cheap, only runs on the
  // rare occasion the map has grown, never on the hot path itself.
  if (progressThrottleMap.size > 500) {
    for (const [k, ts] of progressThrottleMap) {
      if (now - ts > TASK_PROGRESS_THROTTLE_WINDOW_MS) progressThrottleMap.delete(k);
    }
  }
  if (last != null && (now - last) < TASK_PROGRESS_THROTTLE_WINDOW_MS) {
    fail('Yêu cầu trước đó đang được xử lý. Vui lòng đợi một chút rồi thử lại.', 429, 'TASK_UPDATE_THROTTLED');
  }
}

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
  TASK_DRAFT_USE_DELETE: [409, 'Task đang là draft — dùng chức năng "Xóa bản nháp" (deleteTaskDraft) thay vì Hủy.'],
  TASK_DELETE_DRAFT_DENIED: [403, 'Chỉ người tạo bản nháp mới được xóa.'],
  TASK_DELETE_DRAFT_NOT_CREATOR: [403, 'Chỉ người tạo bản nháp mới được xóa.'],
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
  // COMPANY-LEVEL PERMISSION CLEANUP (2026-08-29) — "Nhân sự & phân quyền"
  // authorized by CAPABILITY (manage), KHÔNG hard-code actorType==='admin'
  // nữa. resolveBaseTaskScope() (task-permissions.js) gives manage:true to
  // admin/giam_doc/tro_ly_gd canonically (preset-level, not name/account
  // special-cased) — TBP/Trưởng ca/nhân viên stay manage:false, unchanged.
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

// resolveAndAuthorizeCreatePermissionGrant — tách "resolve+validate+
// authorize" khỏi "persist" (seam refactor 2026-08-27, giữ nguyên 100% thứ
// tự/rule gốc). Bước resolve grantee + tính effective scope của họ (để biết
// policy nào áp dụng cho peopleScope) chỉ chạy được ở main app (People
// Master + Hub accounts đều là bảng Supabase, không có ở phf_hr) — PHẢI
// chạy trước persist dù ghi Supabase hay phf_hr.
async function resolveAndAuthorizeCreatePermissionGrant(session, input) {
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
  return { admin, granteeEmployeeCode, peopleScope, reason };
}

async function createTaskPermissionGrant(session, input) {
  ensureDb();
  const { admin, granteeEmployeeCode, peopleScope, reason } = await resolveAndAuthorizeCreatePermissionGrant(session, input);
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

// resolveAndAuthorizeRevokePermissionGrant — tách "resolve+validate+
// authorize" khỏi "persist" (seam refactor 2026-08-27). CHỈ gồm phần KHÔNG
// phụ thuộc datastore (admin + format grantId + reason) — bước đọc
// existing/is_active/grant_type PHẢI chạy đúng trên datastore đang ghi
// (Supabase cho path gốc, phf_hr cho path server — 2 bảng có thể lệch nhau
// trước cutover), nên KHÔNG đưa vào seam dùng chung; phía server, check này
// đã có sẵn (verbatim, cùng error code) trong revokeTaskPermissionGrant()
// của services/phf-hr-api/lib/task-write.js — không bị mất.
async function resolveAndAuthorizeRevokePermissionGrant(session, grantIdInput, reasonInput) {
  const admin = await requireTaskPermissionAdmin(session);
  const grantId = text(grantIdInput);
  if (!grantId || grantId.length > 120) fail('Grant ID không hợp lệ.', 400, 'TASK_PERMISSION_GRANT_ID_INVALID');
  const reason = validateTaskPermissionReason(reasonInput);
  return { admin, grantId, reason };
}

async function revokeTaskPermissionGrant(session, grantIdInput, reasonInput) {
  ensureDb();
  const { admin, grantId, reason } = await resolveAndAuthorizeRevokePermissionGrant(session, grantIdInput, reasonInput);
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

// resolveAndAuthorizeSetPermissionAssignment — tách "resolve+validate+
// authorize" khỏi "persist" (seam refactor 2026-08-27, cùng nguyên tắc với
// 13 operation Batch 1-5 — KHÔNG đổi 1 rule nào, chỉ tách để tái dùng cho
// đường ghi phf_hr). Đọc từ People Master (Supabase) là bước KHÔNG thể lặp
// lại phía phf-hr-api (bảng đó không tồn tại ở phf_hr) — PHẢI chạy ở main
// app trước khi persist dù ghi vào Supabase hay phf_hr.
async function resolveAndAuthorizeSetPermissionAssignment(session, input) {
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
  return { admin, employeeCode, presetCode, reason, accountId: account ? text(account.id) || null : null };
}

async function saveTaskPermissionAssignment(session, input) {
  const { admin, employeeCode, presetCode, reason, accountId } = await resolveAndAuthorizeSetPermissionAssignment(session, input);
  const assignment = await callRpc('task_set_permission_assignment', {
    p_target_account_id: accountId,
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
  // COMPANY-LEVEL PERMISSION CLEANUP (2026-08-29) — capability-driven
  // (manage), không hard-code actorType==='admin' — xem comment ở
  // requireTaskPermissionAdmin() cho lý do đầy đủ.
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

function validateCategoryActiveFlag(value) {
  if (typeof value !== 'boolean') fail('Trạng thái active của category không hợp lệ.', 400, 'TASK_CATEGORY_ACTIVE_INVALID');
  return value;
}

async function setTaskCategoryActive(session, categoryCodeInput, isActive) {
  const actorContext = await requireTaskAdmin(session);
  ensureDb();
  const categoryCode = validateCategoryCode(categoryCodeInput);
  validateCategoryActiveFlag(isActive);
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
function validateCategorySortOrder(value) {
  const sortOrder = Number(value);
  if (!Number.isInteger(sortOrder) || sortOrder < 1) fail('Thứ tự sắp xếp không hợp lệ.', 400, 'TASK_CATEGORY_SORT_ORDER_INVALID');
  return sortOrder;
}

async function reorderTaskCategory(session, categoryCodeInput, sortOrderInput) {
  const actorContext = await requireTaskAdmin(session);
  ensureDb();
  const categoryCode = validateCategoryCode(categoryCodeInput);
  const sortOrder = validateCategorySortOrder(sortOrderInput);
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
// Trả về "intervention basis" (chuỗi lý do được phép: executive_authority /
// active_primary / exception_grant / system_admin) — caller stamp lên
// actorContext để write-bridge forward xuống phf-hr-api làm defence-in-depth
// (LOCKED AUTHORITY RULE 2026-08-28, xem task-permissions.js).
async function requireUpdateAuthority(session, taskRow, assigneeRows) {
  const relationTask = {
    createdByAccountId: taskRow.created_by_account_id,
    createdByEmployeeCode: taskRow.created_by_employee_code
  };
  const basis = await resolveUpdateAuthorityBasis(session, relationTask, toRelationAssignees(assigneeRows));
  if (!basis) fail('Không có quyền cập nhật task này.', 403, 'TASK_UPDATE_DENIED');
  return basis;
}

// SEAM (2026-08-27, integration-neutral, cùng nguyên tắc pilot #1/#2) — dùng
// chung cho MỌI lifecycle operation theo pattern "creator hoặc capability
// update" (reopen/cancel/changeDeadline/transferPrimary/removeRelated đều
// giống hệt nhau: actorOwnsTask() || requireUpdateAuthority()). Nhận
// `current` (task row đã load) + `loadAssigneeRowsFn` (callback lazy-load,
// CHỈ gọi khi thật sự cần — giữ đúng optimization gốc "không query
// assignees nếu actor đã là creator") — caller tự quyết nguồn đọc.
async function resolveAndAuthorizeUpdateCapability(session, current, loadAssigneeRowsFn) {
  const actorContext = await resolveActorContext(session);
  if (!current) fail('Không tìm thấy task.', 404, 'TASK_NOT_FOUND');
  if (actorOwnsTask(actorContext, current)) {
    actorContext.interventionBasis = 'creator';
    return actorContext;
  }
  const assigneeRows = await loadAssigneeRowsFn();
  actorContext.interventionBasis = await requireUpdateAuthority(session, current, assigneeRows);
  return actorContext;
}

// SEAM — updateTaskProgress: chỉ primary hiện hành + version check tường
// minh trước khi persist. KHÔNG chứa throttle check (Layer 1, xem CONTAINMENT
// comment gốc) — throttle PHẢI chạy TRƯỚC BẤT KỲ I/O nào (kể cả load task/
// assignees), nên caller tự gọi checkTaskProgressThrottle()+resolveActorContext()
// TRƯỚC khi load state rồi mới gọi seam này — giữ đúng 100% thứ tự gốc dù
// state đến từ Supabase hay phf_hr.
async function resolveAndAuthorizeUpdateProgress(actorContext, current, assigneeRows, expectedRowVersion) {
  const activePrimary = (assigneeRows || []).find(a => a.role === 'primary' && a.is_active);
  if (!activePrimary || activePrimary.employee_code !== actorContext.employeeCode) {
    fail('Chỉ primary hiện hành mới cập nhật tiến độ.', 403, 'TASK_PROGRESS_ACTOR_DENIED');
  }
  if (!current) fail('Không tìm thấy task.', 404, 'TASK_NOT_FOUND');
  if (current.row_version !== expectedRowVersion) {
    fail('Task đã được cập nhật ở nơi khác. Vui lòng tải lại trước khi thao tác tiếp.', 409, 'TASK_VERSION_CONFLICT');
  }
}

// SEAM — completeTask: chỉ primary hiện hành (KHÔNG có version pre-check
// riêng ở JS — RPC tự CAS, giữ đúng hành vi gốc).
async function resolveAndAuthorizeComplete(session, assigneeRows) {
  const actorContext = await resolveActorContext(session);
  const activePrimary = (assigneeRows || []).find(a => a.role === 'primary' && a.is_active);
  if (!activePrimary || activePrimary.employee_code !== actorContext.employeeCode) {
    fail('Chỉ primary hiện hành mới bấm Hoàn thành.', 403, 'TASK_COMPLETE_ACTOR_DENIED');
  }
  return actorContext;
}

// SEAM — addTaskComment/addTaskLink/removeTaskLink: chỉ cần requireView()
// (xem, không cần update authority) — đúng phân loại đã audit ở S3A.
async function resolveAndAuthorizeView(session, current, assigneeRows) {
  const actorContext = await resolveActorContext(session);
  if (!current) fail('Không tìm thấy task.', 404, 'TASK_NOT_FOUND');
  await requireView(session, current, assigneeRows);
  return actorContext;
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
// SEAM (2026-08-27, integration-neutral refactor — không đổi 1 business rule
// nào, thuần tách "resolve+validate+authorize" ra khỏi "persist" để module
// khác (vd task-server-integration.js, gọi phf-hr-api thay vì Supabase) có
// thể tái dùng ĐÚNG cùng logic này thay vì duplicate lại — tránh tái diễn
// bug lệch đồng bộ như task-query-descriptor-builder.js trước đây). Hàm này
// KHÔNG persist gì — trả về params đã validate xong, sẵn sàng cho bất kỳ
// persistence backend nào (Supabase RPC hôm nay, phf-hr-api sau này).
//
// opts.validateCategory (2026-08-29, fix TASK_CREATE_CATEGORY_SUPABASE_DEPENDENCY)
// — validator category CÓ THỂ tiêm từ ngoài. Mặc định = categoryActive()
// (Supabase task_categories — Legacy path, KHÔNG đổi khi flags OFF). Đường
// ViaServer/PostgreSQL (task-server-integration.js) tiêm validator đọc
// canonical task.categories qua bridge để KHÔNG chạm Supabase — cùng nguồn
// dữ liệu với chính task row (đồng nhất với quyết định LOCKED của Proposal
// V2, xem validateProposalCategory()). Validator BẮT BUỘC ném đúng error
// code (TASK_CATEGORY_NOT_FOUND / TASK_CATEGORY_INACTIVE) như categoryActive().
async function resolveAndValidateCreateDraftInput(session, input, opts) {
  const actorContext = await resolveActorContext(session);
  const flowType = text(input.flowType);
  if (!['giao_viec', 'de_xuat'].includes(flowType)) fail('flow_type không hợp lệ.', 400, 'TASK_FLOW_TYPE_INVALID');
  const title = text(input.title);
  if (!title) fail('Tiêu đề là bắt buộc.', 400, 'TASK_TITLE_REQUIRED');
  const categoryCode = code(input.categoryCode);
  if (!categoryCode) fail('Category là bắt buộc.', 400, 'TASK_CATEGORY_REQUIRED');
  const validateCategory = (opts && typeof opts.validateCategory === 'function') ? opts.validateCategory : categoryActive;
  await validateCategory(categoryCode);
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

  return {
    actorContext, flowType, title, content: text(input.content), categoryCode, priority,
    startAt, deadline, primaryEmployeeCode, idempotencyKey,
  };
}

async function createTaskDraft(session, input) {
  ensureDb();
  const v = await resolveAndValidateCreateDraftInput(session, input);
  return callTaskCreateDraftRpc({
    p_flow_type: v.flowType,
    p_title: v.title,
    p_content: v.content,
    p_category_code: v.categoryCode,
    p_priority: v.priority,
    p_start_at: v.startAt,
    p_deadline: v.deadline,
    p_actor_employee_code: actorAuditToken(v.actorContext),
    p_primary_employee_code: v.primaryEmployeeCode || null,
    p_idempotency_key: v.idempotencyKey
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
// 2b) DELETE DRAFT — Permission Hardening LOCK 3. Creator-ONLY (KHÔNG có
//     fallback requireUpdateAuthority như update/reopen/cancel/transfer —
//     đây là quyết định business rõ ràng: Admin/GĐ/TBP KHÔNG được xóa nháp
//     người khác trừ khi có rule riêng đã khóa, và chưa có rule đó). Chỉ
//     draft mới xóa được — task_delete_draft RPC tự re-check creator +
//     status từ chính row (không tin actorOwnsTask() ở JS là đủ), và DB
//     trigger task_tasks_guard_delete (đã có từ Foundation migration) là
//     backstop độc lập cuối cùng chặn hard-delete mọi task không phải draft
//     (LOCK 4), bất kể gọi qua RPC này hay đường nào khác.
// ---------------------------------------------------------------------------
async function deleteTaskDraft(session, taskId, expectedRowVersion) {
  ensureDb();
  const actorContext = await resolveActorContext(session);
  const current = await loadTaskRow(taskId);
  if (current.status !== 'draft') fail('Chỉ xóa được task đang ở trạng thái draft — task đã published dùng Hủy (Cancel).', 409, 'TASK_NOT_DRAFT');
  if (!actorOwnsTask(actorContext, current)) {
    fail('Chỉ người tạo bản nháp mới được xóa.', 403, 'TASK_DELETE_DRAFT_DENIED');
  }
  await callRpc('task_delete_draft', {
    p_task_id: taskId, p_expected_row_version: expectedRowVersion,
    p_actor_account_id: actorContext.accountId || null,
    p_actor_employee_code: actorContext.employeeCode || null
  });
  return { task_id: taskId, deleted: true };
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
// resolveCrossDepartmentNotificationRecipient — tách khỏi
// applyCrossDepartmentPublishSideEffects() (seam refactor 2026-08-27, KHÔNG
// đổi 1 rule nào — cùng nguyên tắc "resolve+authorize" tách khỏi "persist"
// đã áp dụng cho mọi seam khác). Nhận assigneeRows làm tham số (thay vì tự
// loadAssignees(taskId) từ Supabase) để dùng được cho CẢ 2 nguồn: task sống
// ở Supabase (loadAssignees()) LẪN task sống ở phf_hr (assignees đã có sẵn
// từ bridgeGetTaskById()/response publish) — đây CHÍNH LÀ phần bị thiếu
// khiến publishTaskViaServer() không emit được notification (OPEN GAP đã
// ghi trong task-server-integration.js, nay đóng). KHÔNG tự emit — trả về
// {recipientEmployeeCode, title, message, targetPath, dedupeKey} hoặc null,
// caller tự quyết persist vào đâu (Supabase hay phf_hr).
async function resolveCrossDepartmentNotificationRecipient(actorContext, taskId, publishedTaskRow, assigneeRows) {
  const row = publishedTaskRow || {};
  if (!Object.prototype.hasOwnProperty.call(row, 'is_cross_department')) return null; // 1.72.0 chưa apply — RPC cũ không có field này
  if (row.is_cross_department !== true) return null; // false hoặc null (unknown) — mục 12/13: không notification

  // PRIMARY CUỐI CÙNG (mục 14): source đã dùng đúng Primary active tại thời
  // điểm publish để tính target_department — ở đây chỉ cần đọc lại ĐÚNG
  // người đó để tìm manager, KHÔNG suy diễn lại từ nơi khác.
  const activePrimary = (assigneeRows || []).find(a => a.role === 'primary' && a.is_active);
  if (!activePrimary) return null;

  const rows = await loadOrgRows();
  const primarySubject = findByCode(rows, activePrimary.employee_code);
  if (!primarySubject || !primarySubject.managerCode) return null; // không có manager_employee_code thật — không đoán
  const managerCode = primarySubject.managerCode;
  if (managerCode === actorContext.employeeCode) return null; // người giao chính là manager của Primary — họ đã biết, không tự thông báo cho chính mình

  const managerSubject = findByCode(rows, managerCode);
  if (!managerSubject || String(managerSubject.status || '').toLowerCase() !== 'active') return null; // manager đã nghỉ việc — không thông báo cho hồ sơ không còn hoạt động

  const managerAssignment = await loadActiveTaskAssignment({ employeeCode: managerCode, accountId: '' });
  const managerActorType = managerAssignment && TASK_PRESET_TO_ACTOR_TYPE[code(managerAssignment.preset_code)];
  if (!managerActorType || !CROSS_DEPT_MANAGER_ACTOR_TYPES.has(managerActorType)) return null; // manager_employee_code có, nhưng KHÔNG có Task authority quản lý thật — không tự cấp

  return {
    recipientEmployeeCode: managerCode,
    title: 'Công việc liên phòng ban mới',
    message: 'Có công việc liên phòng ban được giao cho nhân sự thuộc phạm vi quản lý của bạn (' + row.source_department + ' → ' + row.target_department + '). Đây KHÔNG phải yêu cầu duyệt.',
    targetPath: '/task/chi-tiet?task_id=' + taskId,
    dedupeKey: 'TASK_CROSS_DEPARTMENT_ASSIGNED|' + taskId
  };
}

// resolveTaskDepartmentSnapshot — thuần, KHÔNG DB write. Supabase path
// KHÔNG dùng hàm này (RPC task_publish tự tính department snapshot bằng
// trigger nội bộ đọc employee_profiles); phf_hr KHÔNG có bảng đó nên
// publishTaskViaServer() PHẢI tự resolve ở main app rồi truyền vào, đúng
// thiết kế đã ghi tại bridgePublishTask()'s comment (S3B mục 6.3 CLOSED).
function resolveTaskDepartmentSnapshot(actorContext, primaryEmployeeCode, orgRows) {
  const actorSubject = findByCode(orgRows, actorContext.employeeCode);
  const primarySubject = primaryEmployeeCode ? findByCode(orgRows, primaryEmployeeCode) : null;
  return {
    sourceDepartment: actorSubject ? (text(actorSubject.department) || null) : null,
    targetDepartment: primarySubject ? (text(primarySubject.department) || null) : null,
  };
}

async function applyCrossDepartmentPublishSideEffects(actorContext, taskId, publishedTaskRow) {
  try {
    const assigneeRows = await loadAssignees(taskId);
    const recipient = await resolveCrossDepartmentNotificationRecipient(actorContext, taskId, publishedTaskRow, assigneeRows);
    if (!recipient) return;
    await emitTaskNotificationSafe('TASK_CROSS_DEPARTMENT_ASSIGNED', {
      taskId,
      recipient: { employeeCode: recipient.recipientEmployeeCode },
      title: recipient.title,
      message: recipient.message,
      targetPath: recipient.targetPath,
      dedupeKey: recipient.dedupeKey
    });
  } catch (error) {
    console.warn('[PHF Task] cross-department notification thất bại (bỏ qua, không ảnh hưởng publish):', error && error.message ? error.message : error);
  }
}

// SEAM (2026-08-27, cùng nguyên tắc resolveAndValidateCreateDraftInput()) —
// nhận `current` (task row ĐÃ load sẵn) làm tham số thay vì tự load, để
// caller tự quyết nguồn đọc (Supabase loadTaskRow() hôm nay, hoặc phf-hr-api
// getTaskById() cho task sống trên phf_hr) — hàm này KHÔNG biết/không cần
// biết task đến từ đâu, chỉ thuần authorize. KHÔNG duplicate business rule.
async function resolveAndAuthorizePublish(session, current) {
  const actorContext = await resolveActorContext(session);
  if (!current) fail('Không tìm thấy task.', 404, 'TASK_NOT_FOUND');
  if (!actorOwnsTask(actorContext, current)) {
    const { scope } = await resolveEffectiveTaskScope(session);
    requireTaskCapability({ scope }, 'assign');
  }
  return actorContext;
}

async function publishTask(session, taskId, expectedRowVersion) {
  const current = await loadTaskRow(taskId);
  const actorContext = await resolveAndAuthorizePublish(session, current);
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

  const viewer = await resolveTaskViewerAuthority(session, task, assigneeRows);
  return assembleTaskDetailDto(task, assigneeRows, commentsRes.data, linksRes.data, eventsRes.data, categoryDto(categoryRes.data), orgRows, viewer);
}

// enrichAssigneeWithOrg/filterActiveLinks/assembleTaskDetailDto — tách khỏi
// getTaskDetail() (seam refactor 2026-08-27, KHÔNG đổi 1 rule nào) để dùng
// chung cho getTaskDetailViaServer() (phf_hr) — bản đó đọc task/assignees/
// comments/links/events từ bridge (bridgeGetTaskDetail(), raw rows CÙNG
// shape với Supabase select('*') — xem services/phf-hr-api/lib/task-read.js)
// nhưng vẫn phải lắp ráp/enrich ĐÚNG NGUYÊN VẸN logic này (People Master/
// org data luôn ở Supabase, không tồn tại ở phf_hr — cùng lý do đã áp dụng
// cho permission assignment/grant).
function enrichAssigneeWithOrg(row, peopleByCode) {
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
}

// "Xóa" link = ghi event payload.action='remove' (KHÔNG hard-delete row,
// KHÔNG cần cột soft-delete mới — xem removeTaskLink() dưới đây). Lọc link
// đã bị remove ra khỏi danh sách hiển thị hiện hành.
function filterActiveLinks(linkRows, eventRows) {
  const removedLinkIds = new Set(
    (eventRows || [])
      .filter(e => e.event_type === 'link' && e.payload && e.payload.action === 'remove' && e.payload.link_id)
      .map(e => e.payload.link_id)
  );
  return (linkRows || []).filter(l => !removedLinkIds.has(l.id));
}

// viewer (optional): backend-computed per-action authority
// (resolveTaskViewerAuthority) — caller passes it in vì assembleTaskDetailDto
// là pure (không có session). Frontend gate nút theo dto.viewer.actions.*.
function enrichCommentWithOrg(row, peopleByCode) {
  if (!row) return row;
  const person = peopleByCode.get(code(row.author_employee_code));
  return {
    ...row,
    author_employee_code: code(row.author_employee_code),
    author_full_name: person ? person.fullName : '',
    author_department: person ? person.department : ''
  };
}

function assembleTaskDetailDto(task, assigneeRows, commentRows, linkRows, eventRows, categoryDtoObj, orgRows, viewer) {
  const peopleByCode = new Map((orgRows || []).map(person => [code(person.employeeCode), person]));
  const activePrimaryRow = (assigneeRows || []).find(a => a.role === 'primary' && a.is_active) || null;
  return {
    task,
    category: categoryDtoObj || { category_code: code(task.category_code), display_name: code(task.category_code), description: '', color: '#64748B', is_active: false },
    primary: enrichAssigneeWithOrg(activePrimaryRow, peopleByCode),
    related: (assigneeRows || []).filter(a => a.role === 'related' && a.is_active).map(row => enrichAssigneeWithOrg(row, peopleByCode)),
    comments: (commentRows || []).map(row => enrichCommentWithOrg(row, peopleByCode)),
    links: filterActiveLinks(linkRows, eventRows),
    events: eventRows || [],
    // "Tự giao" (LOCKED UI requirement, 2026-08-28) — canonical identity
    // comparison (employee_code), KHÔNG so sánh display name — cùng công
    // thức với listTasks() (line ~1943). Display-only: KHÔNG ảnh hưởng
    // permission/lifecycle/audit/progress ownership/performance calculation
    // — chỉ 1 field bổ sung ở detail DTO, không đụng bất kỳ nhánh authorize/
    // RPC nào.
    self_task: !!(activePrimaryRow && code(task && task.created_by_employee_code) === code(activePrimaryRow.employee_code)),
    viewer: viewer || null
  };
}

// ---------------------------------------------------------------------------
// 5) PROGRESS UPDATE — atomic qua RPC.
// ---------------------------------------------------------------------------
async function updateTaskProgress(session, taskId, expectedRowVersion, progressPercent, progressStatus) {
  const actorContext = await resolveActorContext(session);
  // Layer 1 (per-instance, best-effort — see CONTAINMENT comment near the
  // top of this file). Cheapest possible check: pure in-memory, before any
  // I/O at all — giữ nguyên vị trí, KHÔNG di chuyển vào seam.
  checkTaskProgressThrottle(actorContext, taskId);
  const assigneeRows = await loadAssignees(taskId);
  // Layer 2 (distributed-safe — see CONTAINMENT comment) + primary check —
  // seam dùng chung với path phf-hr-api, không duplicate logic.
  const currentRow = await loadTaskRow(taskId);
  await resolveAndAuthorizeUpdateProgress(actorContext, currentRow, assigneeRows, expectedRowVersion);
  return callRpc('task_update_progress', {
    p_task_id: taskId, p_expected_row_version: expectedRowVersion, p_actor_employee_code: actorAuditToken(actorContext),
    p_progress_percent: progressPercent, p_progress_status: progressStatus
  });
}

// ---------------------------------------------------------------------------
// 6) COMPLETE — explicit, primary hiện hành, atomic qua RPC.
// ---------------------------------------------------------------------------
async function completeTask(session, taskId, expectedRowVersion, resultText) {
  const assigneeRows = await loadAssignees(taskId);
  const actorContext = await resolveAndAuthorizeComplete(session, assigneeRows);
  return callRpc('task_complete', {
    p_task_id: taskId, p_expected_row_version: expectedRowVersion, p_actor_employee_code: actorAuditToken(actorContext),
    p_result_text: resultText
  });
}

// ---------------------------------------------------------------------------
// 7) REOPEN — creator hoặc capability update, atomic qua RPC.
// ---------------------------------------------------------------------------
async function reopenTask(session, taskId, expectedRowVersion, reason) {
  const current = await loadTaskRow(taskId);
  const actorContext = await resolveAndAuthorizeUpdateCapability(session, current, () => loadAssignees(taskId));
  return callRpc('task_reopen', {
    p_task_id: taskId, p_expected_row_version: expectedRowVersion, p_actor_employee_code: actorAuditToken(actorContext), p_reason: reason
  });
}

// ---------------------------------------------------------------------------
// 8) CANCEL — creator hoặc capability update, atomic qua RPC.
// ---------------------------------------------------------------------------
async function cancelTask(session, taskId, expectedRowVersion, reason) {
  const current = await loadTaskRow(taskId);
  const actorContext = await resolveAndAuthorizeUpdateCapability(session, current, () => loadAssignees(taskId));
  return callRpc('task_cancel', {
    p_task_id: taskId, p_expected_row_version: expectedRowVersion, p_actor_employee_code: actorAuditToken(actorContext), p_reason: reason
  });
}

// ---------------------------------------------------------------------------
// 9) DEADLINE CHANGE — creator/capability update, atomic qua RPC.
// ---------------------------------------------------------------------------
async function changeTaskDeadline(session, taskId, expectedRowVersion, newDeadline, reason) {
  const current = await loadTaskRow(taskId);
  const actorContext = await resolveAndAuthorizeUpdateCapability(session, current, () => loadAssignees(taskId));
  return callRpc('task_change_deadline', {
    p_task_id: taskId, p_expected_row_version: expectedRowVersion, p_actor_employee_code: actorAuditToken(actorContext),
    p_new_deadline: newDeadline, p_reason: reason
  });
}

// ---------------------------------------------------------------------------
// 10) TRANSFER PRIMARY — atomic qua RPC. Scope target verify TRƯỚC ở JS.
// ---------------------------------------------------------------------------
async function transferTaskPrimary(session, taskId, expectedRowVersion, newPrimaryEmployeeCode, reason) {
  const current = await loadTaskRow(taskId);
  const actorContext = await resolveAndAuthorizeUpdateCapability(session, current, () => loadAssignees(taskId));
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
  const current = await loadTaskRow(taskId);
  const assigneeRows = await loadAssignees(taskId);
  const actorContext = await resolveAndAuthorizeUpdateCapability(session, current, () => Promise.resolve(assigneeRows));
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
  const current = await loadTaskRow(taskId);
  const actorContext = await resolveAndAuthorizeUpdateCapability(session, current, () => loadAssignees(taskId));
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
  const task = await loadTaskRow(taskId);
  const assigneeRows = await loadAssignees(taskId);
  const actorContext = await resolveAndAuthorizeView(session, task, assigneeRows);
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
  const task = await loadTaskRow(taskId);
  const assigneeRows = await loadAssignees(taskId);
  const actorContext = await resolveAndAuthorizeView(session, task, assigneeRows);
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
  const task = await loadTaskRow(taskId);
  const assigneeRows = await loadAssignees(taskId);
  const actorContext = await resolveAndAuthorizeView(session, task, assigneeRows);

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
// COMPANY-LEVEL PERMISSION CLEANUP (2026-08-28) — Admin/Giám đốc/Trợ lý GĐ
// là "company-level authority" theo business contract LOCKED (không phải
// biến thể của mô hình TBP/Trưởng ca). "Nhân sự tôi quản lý" (workspace
// scope=managed/cross_department) của nhóm này PHẢI là company-wide — KHÔNG
// bị giới hạn về đúng managedEmployeeCodes (direct-report subtree) như TBP/
// Trưởng ca, dù direct report thật có tồn tại trong org graph hay không.
// Đây là generic-set-based, đọc trực tiếp từ actorType đã resolve qua
// task_permission_assignments/session admin — KHÔNG suy theo title/display
// name, KHÔNG mở rộng "Tôi nhận" cá nhân (Primary vẫn đúng nghĩa thật, xem
// nhánh 'mine'/rỗng bên dưới — KHÔNG đổi bởi set này).
const COMPANY_TIER_ACTOR_TYPES = new Set(['admin', 'giam_doc', 'tro_ly_gd']);

// ---------------------------------------------------------------------------
// SHARED AUTHORIZED TASK SCOPE RESOLVER — Report-02/03 mục 2: branching
// "actorContext/scope + relation/scope input → concrete authorization
// filter" trước đây bị duplicate ở task-query-descriptor-builder.js (file đó
// tự ghi nhận trong comment đầu file: "phải duplicate tối thiểu ở đây" vì
// branching này KHÔNG được export riêng từ task-core.js). Report KHÔNG được
// tạo bản duplicate thứ 3 — hàm này là bản trích xuất NGUYÊN VẸN branching
// gốc của listTasks() (không đổi 1 điều kiện/thứ tự nào), để cả listTasks()
// và Report engine dùng chung. Hành vi phải byte-semantically equivalent với
// trước khi extract — chứng minh bằng toàn bộ Task regression suite hiện có
// + live-DB before/after diff (xem PHF_TASK_REPORT_03 report).
// PURE decision extraction (Reporting V2, 2026-08-29) — the "which
// employeeCodes/creator does this actor+relation+scope authorize" branching
// below, WITHOUT the trailing Supabase assignee lookup that
// resolveAuthorizedTaskScope() does afterward. Extracted so a PostgreSQL-
// native caller (Reporting V2 descriptor builder) can reuse this SAME
// canonical decision and run its OWN query against task.assignees on
// PostgreSQL, instead of duplicating this branching a 3rd time (the 2nd copy,
// in task-query-descriptor-builder.js, already documents that risk in its own
// header comment). Byte-identical branching to the block this replaces —
// resolveAuthorizedTaskScope() below is now a thin wrapper: call this, then
// do the Supabase-specific assignee query.
function resolveAuthorizedTaskEmployeeScope(actorContext, scope, relation, scopeParam, options) {
  const isReceivedLike = relation === 'received' || relation === 'proposal_received';
  const flowType = (relation === 'proposal_sent' || relation === 'proposal_received') ? 'de_xuat' : 'giao_viec';

  if (!isReceivedLike) {
    return { mode: 'creator_eq', flowType, creatorEmployeeCode: actorContext.employeeCode };
  }

  // G3 fix (2026-08-28) — "Tôi nhận"/"Nhân sự tôi quản lý" (listTasks(), the
  // Task LIST/workspace contract) phải LUÔN theo TASK_RELATIONSHIP thật
  // (Primary assignee thật / managedEmployeeCodes thật từ org graph),
  // KHÔNG BAO GIỜ theo peopleScope/capability — CAPABILITY != PEOPLE_SCOPE
  // != TASK_RELATIONSHIP. Trước fix, executive actorType (giam_doc/tro_ly_gd
  // — peopleScope.type='all_company', 1 capability marker cho quyền can
  // thiệp/xem company-wide, KHÔNG phải quan hệ Task cá nhân) khiến nhánh
  // dưới coi "Tôi nhận" mặc định = không giới hạn = lộ TOÀN BỘ Task công ty
  // (evidence PHF010: 50/50 Task, chỉ là Primary thật trên 1/50). Task
  // Report/Dashboard (task-reporting.js) KHÔNG gọi qua nhánh này —
  // relationshipOnly chỉ true khi caller (listTasks() bên dưới) truyền vào,
  // giữ NGUYÊN semantics company-wide Report cho GĐ/TLGĐ (feature khác, đã
  // khoá bởi test-task-reporting-v1.js với real DB fixtures — KHÔNG đụng).
  const relationshipOnly = !!(options && options.taskRelationshipOnly);

  // "Đề xuất tôi nhận xử lý" LUÔN self-only theo đúng nghĩa cá nhân (không
  // suy sang phạm vi quản lý) — chỉ relation='received' mới dùng peopleScope
  // canonical để mở rộng cho TBP/Trưởng ca/Admin/GĐ/TLGĐ.
  let employeeCodes; // null => không giới hạn (all_company)
  if (relation === 'proposal_received') {
    employeeCodes = [actorContext.employeeCode];
  } else if (relationshipOnly) {
    if (scopeParam === 'managed' || scopeParam === 'cross_department') {
      if (COMPANY_TIER_ACTOR_TYPES.has(actorContext.actorType)) {
        // COMPANY-LEVEL CLEANUP — Admin/GĐ/TLGĐ workspace "Nhân sự tôi quản
        // lý" = company-wide (null = không giới hạn), KHÔNG bị bó vào
        // managedEmployeeCodes/org-graph subtree như TBP/Trưởng ca (mục 4
        // của business contract: "Direct reports có thể tồn tại trong org
        // graph nhưng không được giới hạn company-wide Task scope"). scope=
        // cross_department vẫn lọc đúng is_cross_department qua
        // crossDepartmentOnly bên dưới, áp SAU khi employeeCodes=null đã mở
        // hết company-wide — không đổi cơ chế filter đó.
        employeeCodes = null;
      } else {
        // TBP/Trưởng ca — LUÔN managedEmployeeCodes thật (org graph, đúng
        // subtree mình quản lý) — KHÔNG đổi hành vi cũ.
        employeeCodes = Array.from(actorContext.managedEmployeeCodes || []);
      }
    } else if (scopeParam === 'mine' || !scopeParam) {
      // "Tôi nhận" mặc định — LUÔN self-only, bất kể peopleScope là self/
      // employees/all_company. Đây chính là G3 fix root cause.
      employeeCodes = [actorContext.employeeCode];
    } else if (scopeParam === 'all_company' && COMPANY_TIER_ACTOR_TYPES.has(actorContext.actorType)) {
      // scopeParam='all_company' tường minh cho company-tier — cùng company-
      // wide semantics như scope=managed ở trên (không phải nhánh riêng).
      employeeCodes = null;
    } else if (scope.peopleScope.type === 'employees') {
      employeeCodes = scope.peopleScope.values || [actorContext.employeeCode];
    } else {
      employeeCodes = [actorContext.employeeCode];
    }
  } else if (scope.peopleScope.type === 'all_company') {
    employeeCodes = (scopeParam === 'mine') ? [actorContext.employeeCode] : null;
  } else if (scope.peopleScope.type === 'employees') {
    const managed = Array.from(actorContext.managedEmployeeCodes || []);
    // "Tôi nhận" phải LUÔN self-only cho TBP/Trưởng ca (business rule LOCK —
    // xem PHF_TASK_HANDOVER_TO_NEW_CLAUDE_BEFORE_REPORT_04.md mục 4/8). Trước
    // đây scopeParam rỗng (mặc định của tab "Tôi nhận", KHÔNG truyền scope)
    // rơi vào nhánh else bên dưới và trả về self+managed — trộn nhầm 2
    // workspace. "Nhân sự tôi quản lý" là workspace riêng, CHỈ truy cập được
    // qua scopeParam='managed'/'cross_department'.
    if (scopeParam === 'managed' || scopeParam === 'cross_department') employeeCodes = managed;
    else if (scopeParam === 'mine' || !scopeParam) employeeCodes = [actorContext.employeeCode];
    else employeeCodes = scope.peopleScope.values || [actorContext.employeeCode];
  } else {
    employeeCodes = [actorContext.employeeCode];
  }

  return { mode: 'employee_codes', flowType, employeeCodes, excludeDraft: true, crossDepartmentOnly: scopeParam === 'cross_department' };
}

async function resolveAuthorizedTaskScope(actorContext, scope, relation, scopeParam, options) {
  const decision = resolveAuthorizedTaskEmployeeScope(actorContext, scope, relation, scopeParam, options);
  if (decision.mode === 'creator_eq') return decision;

  const { flowType, employeeCodes, excludeDraft, crossDepartmentOnly } = decision;
  if (employeeCodes !== null && !employeeCodes.length) {
    return { mode: 'empty', flowType, excludeDraft, crossDepartmentOnly };
  }

  let assigneeQuery = supabase.from(ASSIGNEES_TABLE).select('task_id').eq('role', 'primary').eq('is_active', true);
  if (employeeCodes !== null) assigneeQuery = assigneeQuery.in('employee_code', employeeCodes);
  const { data: assigneeRows, error: assigneeError } = await assigneeQuery.limit(5000);
  if (assigneeError) throwDb(assigneeError);
  const taskIds = Array.from(new Set((assigneeRows || []).map(r => r.task_id)));
  if (!taskIds.length) {
    return { mode: 'empty', flowType, excludeDraft, crossDepartmentOnly };
  }

  return { mode: 'assignee_in', flowType, taskIds, excludeDraft, crossDepartmentOnly };
}

// 'managed' — UI-level alias for the "Nhân sự tôi quản lý" workspace, which is
// canonically (relation='received', scope='managed'). Resolve before validation
// so listTasks({relation:'managed'}) works identically on the legacy and the
// bridged (task-query-descriptor-builder.js) paths. Same authorization contract,
// no new relation type, no manager-graph change.
function normalizeTaskListRelationScope(rawRelation, rawScope) {
  let relation = text(rawRelation);
  let scope = text(rawScope);
  if (relation === 'managed') {
    relation = 'received';
    if (!scope) scope = 'managed';
  }
  return { relation, scope };
}

async function listTasks(session, params) {
  ensureDb();
  const { actorContext, scope } = await resolveEffectiveTaskScope(session);
  const input = params || {};

  const { relation, scope: scopeInput } = normalizeTaskListRelationScope(input.relation, input.scope);
  if (!TASK_LIST_RELATIONS.has(relation)) fail('Góc nhìn (relation) không hợp lệ.', 400, 'TASK_LIST_RELATION_INVALID');
  const statusFilter = TASK_LIST_STATUS_FILTERS.has(text(input.statusFilter)) ? text(input.statusFilter) : 'all';
  const scopeParam = TASK_LIST_SCOPES.has(scopeInput) ? scopeInput : '';
  const search = text(input.search).slice(0, 100);
  const limit = Math.min(200, Math.max(1, Number(input.limit) || 50));
  // Pagination foundation (mục 11 — không migration, không thay authorization):
  // server-side offset qua PostgREST .range(), enforce SAU KHI authorization/
  // filter đã áp hết (không đổi thứ tự: auth trước, pagination sau, luôn luôn).
  // Ordering deterministic: created_at desc + id asc làm tie-break (2 Task
  // cùng created_at millisecond vẫn có thứ tự cố định, không "trôi" giữa các
  // trang khi offset tăng).
  const offset = Math.min(5000, Math.max(0, Math.trunc(Number(input.offset)) || 0));

  const nowIso = new Date().toISOString();
  // G3 FOLLOW-UP + COMPANY-LEVEL CLEANUP (2026-08-28) — hasManagedPeople:
  // trustworthy, explicit signal cho frontend quyết định hiện "Nhân sự tôi
  // quản lý" hay không. Với TBP/Trưởng ca: derived TRỰC TIẾP từ
  // managedEmployeeCodes thật (org graph, manager_employee_code) — KHÔNG
  // suy từ viewScopeType/title, KHÔNG phụ thuộc tasks.length (0 report có
  // Task hiện tại vẫn phải hiện menu nếu managedEmployeeCodes thật > 0). Với
  // Admin/GĐ/TLGĐ (COMPANY_TIER_ACTOR_TYPES): LUÔN true — company-level
  // authority có company-wide workspace theo thiết kế PHF (mục 1/4 business
  // contract), KHÔNG bị ràng buộc bởi việc có direct report thật hay không
  // (khác managedEmployeeCodes.length>0 của TBP/Trưởng ca — cố tình, không
  // phải suy đoán qua title/actorType không rõ nguồn: actorType ở đây đã
  // resolve canonical qua task_permission_assignments/session admin, KHÔNG
  // phải string so sánh display).
  const hasManagedPeople = COMPANY_TIER_ACTOR_TYPES.has(actorContext.actorType)
    || !!(actorContext.managedEmployeeCodes && actorContext.managedEmployeeCodes.size > 0);
  // COMPANY-LEVEL PERMISSION CLEANUP (2026-08-29) — canManageTaskPermissions:
  // trustworthy, explicit, CAPABILITY-derived signal (scope.capabilities.manage
  // — the exact same flag requireTaskPermissionAdmin()/listTaskAdminPeople()
  // enforce server-side, see task-permissions.js::resolveBaseTaskScope()) cho
  // frontend quyết định hiện nav "Nhân sự & phân quyền" hay không. KHÔNG suy
  // từ actorType/title phía client — piggybacks trên cùng listTasks() probe
  // đã dùng để hydrate hasManagedPeople, không thêm round-trip nào.
  const canManageTaskPermissions = scope.capabilities.manage === true;
  const emptyResult = { tasks: [], relation, statusFilter, scope: scopeParam || 'default', viewScopeType: scope.peopleScope.type, requesterActorType: actorContext.actorType, hasManagedPeople, canManageTaskPermissions, offset, limit, hasMore: false };

  // listTasks() = the Task LIST/workspace contract ("Tôi nhận"/"Nhân sự tôi
  // quản lý") — taskRelationshipOnly:true enforces G3 (relationship/org-graph
  // only, never capability/all_company). task-reporting.js calls this SAME
  // resolver WITHOUT the option, intentionally preserving its own separate
  // company-wide Report semantics for GĐ/TLGĐ (see comment on the resolver).
  const authScope = await resolveAuthorizedTaskScope(actorContext, scope, relation, scopeParam, { taskRelationshipOnly: true });
  if (authScope.mode === 'empty') return emptyResult;

  let taskQuery = supabase.from(TASKS_TABLE).select('*').eq('flow_type', authScope.flowType);

  if (authScope.mode === 'assignee_in') {
    taskQuery = taskQuery.in('id', authScope.taskIds);
    // draft ẩn khỏi người nhận — chưa publish nghĩa là chưa "thật" với người
    // nhận (không notification, không audit event) — chỉ creator thấy ở
    // relation='assigned'/'proposal_sent' (đúng đặc tả mục 6 handoff Create
    // Foundation: "draft = pre-audit").
    if (authScope.excludeDraft) taskQuery = taskQuery.neq('status', 'draft');
    if (authScope.crossDepartmentOnly) taskQuery = taskQuery.eq('is_cross_department', true);
  } else {
    taskQuery = taskQuery.eq('created_by_employee_code', authScope.creatorEmployeeCode);
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
      start_at: t.start_at,
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

  return { tasks, relation, statusFilter, scope: scopeParam || 'default', viewScopeType: scope.peopleScope.type, requesterActorType: actorContext.actorType, hasManagedPeople, canManageTaskPermissions, offset, limit, hasMore };
}

// ---------------------------------------------------------------------------
// 13) LIST TASK EVENTS — Timeline Foundation V1. KHÔNG có permission model
// riêng: authorization = NGUYÊN kết quả listTasks() cho đúng relation/scope
// đã truyền vào (relation='received'+scope='managed' cho "Nhân sự tôi quản
// lý", giống hệt cách Calendar Foundation V1 đã dùng). Task nào KHÔNG xuất
// hiện trong listTasks() cho actor này thì event của Task đó KHÔNG BAO GIỜ
// được query — filter tại chính câu SQL (.in('task_id', taskIds đã
// authorized)), không phải "fetch hết rồi che ở JS". KHÔNG tạo bảng mới,
// KHÔNG đổi write-path, KHÔNG mở rộng quyền — chỉ đọc thêm task_events cho
// ĐÚNG tập Task mà actor vốn đã được xem.
//
// GIỚI HẠN V1 (kế thừa nguyên limit:200 của listTasks(), như Calendar V1 đã
// chấp nhận): nếu actor có >200 Task trong relation/scope này, Timeline chỉ
// thấy event của 200 Task gần nhất (created_at desc) — KHÔNG phân trang
// thêm ở gate này.
async function listTaskEvents(session, params) {
  ensureDb();
  const input = params || {};
  const eventLimit = Math.min(200, Math.max(1, Number(input.limit) || 100));

  const taskListResult = await listTasks(session, {
    relation: input.relation,
    statusFilter: 'all',
    scope: input.scope,
    limit: 200,
    offset: 0
  });
  const tasksById = new Map(taskListResult.tasks.map(t => [t.task_id, t]));
  const taskIds = Array.from(tasksById.keys());
  if (!taskIds.length) {
    return { events: [], relation: taskListResult.relation, scope: taskListResult.scope, viewScopeType: taskListResult.viewScopeType, requesterActorType: taskListResult.requesterActorType };
  }

  const { data: eventRows, error } = await supabase.from(EVENTS_TABLE)
    .select('*')
    .in('task_id', taskIds)
    .order('occurred_at', { ascending: false })
    .limit(eventLimit);
  if (error) throwDb(error);

  const orgRows = await loadOrgRows();
  const peopleByCode = new Map(orgRows.map(person => [code(person.employeeCode), person]));
  function actorInfo(employeeCode) {
    const person = peopleByCode.get(code(employeeCode));
    return { employee_code: code(employeeCode), full_name: person ? person.fullName : '' };
  }

  const events = (eventRows || []).map(e => {
    const task = tasksById.get(e.task_id);
    return {
      id: e.id,
      task_id: e.task_id,
      task_code: task ? task.task_code : '',
      task_title: task ? task.title : '',
      event_type: e.event_type,
      actor: actorInfo(e.actor_employee_code),
      payload: e.payload || {},
      reason: e.reason || null,
      occurred_at: e.occurred_at
    };
  });

  return { events, relation: taskListResult.relation, scope: taskListResult.scope, viewScopeType: taskListResult.viewScopeType, requesterActorType: taskListResult.requesterActorType };
}

module.exports = {
  listTaskAssignableEmployees,
  listTaskAdminPeople,
  saveTaskPermissionAssignment,
  resolveAndAuthorizeSetPermissionAssignment,
  createTaskPermissionGrant,
  resolveAndAuthorizeCreatePermissionGrant,
  revokeTaskPermissionGrant,
  resolveAndAuthorizeRevokePermissionGrant,
  listTaskCategories,
  listAdminTaskCategories,
  requireTaskAdmin,
  validateCategoryCode,
  validateCategoryName,
  validateCategoryActiveFlag,
  validateCategorySortOrder,
  createTaskCategory,
  renameTaskCategory,
  setTaskCategoryActive,
  deleteTaskCategory,
  reorderTaskCategory,
  checkTaskFoundationStatus,
  createTaskDraft,
  resolveAndValidateCreateDraftInput,
  actorAuditToken,
  updateTaskDraft,
  deleteTaskDraft,
  publishTask,
  resolveAndAuthorizePublish,
  resolveCrossDepartmentNotificationRecipient,
  resolveTaskDepartmentSnapshot,
  getTaskDetail,
  assembleTaskDetailDto,
  updateTaskProgress,
  resolveAndAuthorizeUpdateProgress,
  checkTaskProgressThrottle,
  completeTask,
  resolveAndAuthorizeComplete,
  reopenTask,
  cancelTask,
  resolveAndAuthorizeUpdateCapability,
  changeTaskDeadline,
  transferTaskPrimary,
  addTaskRelated,
  removeTaskRelated,
  addTaskComment,
  addTaskLink,
  removeTaskLink,
  resolveAndAuthorizeView,
  listTasks,
  resolveAuthorizedTaskEmployeeScope,
  listTaskEvents,
  resolveAuthorizedTaskScope,
  TASK_LIST_RELATIONS,
  TASK_LIST_SCOPES,
  TASKS_TABLE,
  ASSIGNEES_TABLE,
  EVENTS_TABLE,
  CATEGORIES_TABLE
};
