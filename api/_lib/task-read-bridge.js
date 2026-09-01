'use strict';

// PHF Task read-path bridge — api/data.js (KHÔNG ĐỔI) → HTTPS server-to-server
// → phf-hr-api (hr-api.phuhoafresh.info.vn) → Supabase DEV.
//
// TẮT MẶC ĐỊNH (PHF_TASK_READ_BRIDGE_ENABLED phải ='true' tường minh) — nếu
// KHÔNG bật, mọi hành vi hệ thống giữ NGUYÊN 100% như trước file này tồn tại
// (api/data.js tự gọi thẳng task-core.js/Supabase như cũ). Đây là gate an
// toàn bắt buộc: không đổi hành vi mặc định của WIP đang chạy.
//
// listTaskCategories: bridge thẳng qua GET /v1/task/categories (danh mục
// toàn cục, KHÔNG phân quyền theo actor).
//
// listTasks: bridge qua POST /v1/task/tasks descriptor-aware (endpoint đã
// PASS parity server-thật ở Phase A — xem checkpoint 2026-08-23) — descriptor
// build+ký bằng buildResolvedTaskQueryDescriptor() (REUSE resolveEffectiveTaskScope()
// nguyên vẹn, KHÔNG tự suy luận quyền ở đây). TẮT MẶC ĐỊNH RIÊNG bằng
// PHF_TASK_READ_BRIDGE_LISTTASKS_ENABLED (khác cờ với categories — 2 rủi ro
// khác nhau, không gộp chung 1 cờ).
//
// GAP ĐÃ ĐÓNG (2026-08-27): trước đây response của phf-hr-api
// (services/phf-hr-api/lib/task-query-executor.js) KHÔNG SELECT
// category_code/progress_percent/progress_status, bridgeListTasks() phải trả
// null tường minh cho 3 field này. Nay executeResolvedTaskQuery() (Gate 11,
// PostgreSQL phf_hr) đã SELECT đủ 3 cột — map thẳng giá trị thật bên dưới,
// không còn hardcode null. full_name/department của created_by/primary vẫn
// enrich CỤC BỘ ở main app bằng loadOrgRows() (dữ liệu org đã có sẵn ở main
// app, không phụ thuộc phf-hr-api) — không đổi.
//
// Service token đọc từ process.env — KHÔNG hardcode, KHÔNG log giá trị.

const PHF_HR_API_BASE_URL = String(process.env.PHF_HR_API_BASE_URL || '').trim().replace(/\/$/, '');
const PHF_HR_API_SERVICE_TOKEN = String(process.env.PHF_HR_API_SERVICE_TOKEN || '').trim();
const TASK_QUERY_DESCRIPTOR_SIGNING_SECRET = String(process.env.TASK_QUERY_DESCRIPTOR_SIGNING_SECRET || '').trim();
const BRIDGE_TIMEOUT_MS = 6000;

const { buildResolvedTaskQueryDescriptor } = require('./task-query-descriptor-builder');
const { loadOrgRows } = require('./task-employee-scope');
const { classifySourceOfWork: taskSourceOfWork } = require('./task-source-of-work');

function isBridgeEnabled() {
  return String(process.env.PHF_TASK_READ_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function isListTasksBridgeEnabled() {
  return String(process.env.PHF_TASK_READ_BRIDGE_LISTTASKS_ENABLED || '').trim().toLowerCase() === 'true';
}

// getTaskDetailViaServer — cờ RIÊNG (khác listTasks/listTaskCategories, cùng
// nguyên tắc "2 rủi ro khác nhau, không gộp chung 1 cờ" đã ghi ở đầu file).
function isGetTaskDetailBridgeEnabled() {
  return String(process.env.PHF_TASK_READ_BRIDGE_GETDETAIL_ENABLED || '').trim().toLowerCase() === 'true';
}

function orgCode(value) { return String(value == null ? '' : value).trim().toUpperCase(); }

function bridgeFail(message, statusCode, errorCode) {
  const e = new Error(message);
  e.statusCode = statusCode || 502;
  e.code = errorCode || 'TASK_READ_BRIDGE_ERROR';
  throw e;
}

async function bridgeListTaskCategories() {
  if (!PHF_HR_API_BASE_URL || !PHF_HR_API_SERVICE_TOKEN) {
    bridgeFail('PHF_TASK_READ_BRIDGE_ENABLED=true nhưng thiếu PHF_HR_API_BASE_URL hoặc PHF_HR_API_SERVICE_TOKEN trong env.', 500, 'TASK_READ_BRIDGE_MISCONFIGURED');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(PHF_HR_API_BASE_URL + '/v1/task/categories', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + PHF_HR_API_SERVICE_TOKEN },
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') bridgeFail('phf-hr-api không phản hồi kịp thời (timeout).', 504, 'TASK_READ_BRIDGE_TIMEOUT');
    bridgeFail('Không kết nối được phf-hr-api: ' + err.message, 502, 'TASK_READ_BRIDGE_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    bridgeFail('phf-hr-api trả lỗi khi đọc danh mục Task (HTTP ' + response.status + ').', 502, 'TASK_READ_BRIDGE_UPSTREAM_ERROR');
  }

  const body = await response.json();
  // Map response schema của phf-hr-api (camelCase) về ĐÚNG shape task-core.js
  // categoryDto() đang trả (snake_case) — để frontend hiện tại KHÔNG cần đổi
  // 1 dòng nào khi bridge được bật.
  const categories = (body.data || []).map((row) => ({
    category_code: row.categoryCode,
    display_name: row.displayName,
    description: row.description,
    color: row.color,
    is_active: row.isActive,
    sort_order: row.sortOrder,
    is_used: null,
  }));
  return { categories };
}

async function bridgeListTasks(session, params) {
  if (!PHF_HR_API_BASE_URL || !PHF_HR_API_SERVICE_TOKEN || !TASK_QUERY_DESCRIPTOR_SIGNING_SECRET) {
    bridgeFail('PHF_TASK_READ_BRIDGE_LISTTASKS_ENABLED=true nhưng thiếu PHF_HR_API_BASE_URL/PHF_HR_API_SERVICE_TOKEN/TASK_QUERY_DESCRIPTOR_SIGNING_SECRET trong env.', 500, 'TASK_READ_BRIDGE_MISCONFIGURED');
  }

  // hasManagedPeople/canManageTaskPermissions — local-only UI capability
  // signals piggybacked on the same descriptor build (see comment in
  // task-query-descriptor-builder.js). Tách ra khỏi `descriptor` TRƯỚC khi
  // POST — phf-hr-api không cần và không xác thực 2 field này (không phải
  // 1 phần của signature); giữ nguyên wire contract cũ 100%.
  const { hasManagedPeople, canManageTaskPermissions, ...descriptor } = await buildResolvedTaskQueryDescriptor(session, params, { signingSecret: TASK_QUERY_DESCRIPTOR_SIGNING_SECRET });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(PHF_HR_API_BASE_URL + '/v1/task/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PHF_HR_API_SERVICE_TOKEN },
      body: JSON.stringify({ descriptor }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') bridgeFail('phf-hr-api không phản hồi kịp thời (timeout).', 504, 'TASK_READ_BRIDGE_TIMEOUT');
    bridgeFail('Không kết nối được phf-hr-api: ' + err.message, 502, 'TASK_READ_BRIDGE_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    bridgeFail('phf-hr-api trả lỗi khi đọc danh sách Task (HTTP ' + response.status + ').', 502, 'TASK_READ_BRIDGE_UPSTREAM_ERROR');
  }

  const body = await response.json();
  const rows = body.data || [];

  // Enrich full_name/department CỤC BỘ bằng org data đã có sẵn ở main app —
  // KHÔNG phụ thuộc phf-hr-api cho phần này (đúng quyết định 2026-08-23).
  const orgRows = await loadOrgRows();
  const peopleByCode = new Map(orgRows.map((person) => [orgCode(person.employeeCode), person]));
  function personInfo(employeeCode) {
    if (!employeeCode) return null;
    const person = peopleByCode.get(orgCode(employeeCode));
    return { employee_code: orgCode(employeeCode), full_name: person ? person.fullName : '', department: person ? person.department : '' };
  }

  // Map response schema của phf-hr-api (camelCase) về ĐÚNG shape mà
  // task-core.js listTasks() đang trả (snake_case) — để frontend hiện tại
  // KHÔNG cần đổi 1 dòng nào khi bridge được bật. category_code/
  // progress_percent/progress_status nay map thẳng từ giá trị thật (xem GAP
  // ĐÃ ĐÓNG ở đầu file).
  const tasks = rows.map((r) => ({
    task_id: r.id,
    task_code: r.taskCode,
    title: r.title,
    flow_type: r.flowType,
    status: r.status,
    priority: r.priority,
    deadline: r.deadline,
    category_code: r.categoryCode != null ? r.categoryCode : null,
    progress_percent: r.progressPercent != null ? r.progressPercent : null,
    progress_status: r.progressStatus != null ? r.progressStatus : null,
    is_cross_department: r.isCrossDepartment,
    source_department: r.sourceDepartment,
    target_department: r.targetDepartment,
    created_by: personInfo(r.createdByEmployeeCode),
    primary: r.primaryEmployeeCode ? personInfo(r.primaryEmployeeCode) : null,
    // "Tự giao" — CREATION-TIME classification (creator vs the INITIAL primary,
    // not the current one). A later transfer no longer flips the badge.
    self_task: taskSourceOfWork({
      createdByEmployeeCode: r.createdByEmployeeCode,
      createdByAccountId: r.createdByAccountId,
      initialPrimaryEmployeeCode: r.initialPrimaryEmployeeCode,
      proposalGenerated: r.proposalGenerated === true,
      recurringSeriesId: r.recurringSeriesId,
    }) === 'self_assigned',
    source_of_work: taskSourceOfWork({
      createdByEmployeeCode: r.createdByEmployeeCode,
      createdByAccountId: r.createdByAccountId,
      initialPrimaryEmployeeCode: r.initialPrimaryEmployeeCode,
      proposalGenerated: r.proposalGenerated === true,
      recurringSeriesId: r.recurringSeriesId,
    }),
    row_version: r.rowVersion,
    // Proposal V2 (2026-08-29) — null cho mọi row Giao việc (LEFT JOIN không
    // match ở phf-hr-api, xem lib/task-query-executor.js). Dùng cho list
    // "Đề xuất tôi gửi/nhận" hiển thị trạng thái + link Task sinh ra.
    proposal_status: r.proposalStatus != null ? r.proposalStatus : null,
    proposal_recipient_employee_code: r.proposalRecipientEmployeeCode != null ? r.proposalRecipientEmployeeCode : null,
    proposal_generated_task_id: r.proposalGeneratedTaskId != null ? r.proposalGeneratedTaskId : null,
    proposal_reject_reason: r.proposalRejectReason != null ? r.proposalRejectReason : null,
    proposal_cancel_reason: r.proposalCancelReason != null ? r.proposalCancelReason : null,
  }));

  return {
    tasks,
    relation: body.relation,
    statusFilter: descriptor.statusFilter,
    scope: body.scope,
    viewScopeType: body.viewScopeType,
    requesterActorType: body.requesterActorType,
    offset: body.offset,
    limit: body.limit,
    hasMore: body.hasMore,
    hasManagedPeople,
    canManageTaskPermissions,
  };
}

// bridgeGetTaskDetail — GET /v1/task/tasks/:id (route DÙNG CHUNG với
// bridgeGetTaskById() bên task-write-bridge.js — cùng 1 endpoint phf-hr-api,
// KHÔNG phải 2 route khác nhau). Định nghĩa RIÊNG ở đây (không import từ
// task-write-bridge.js) vì mục đích khác: đây là READ path user-facing
// (getTaskDetail, gate bằng cờ đọc riêng), còn bản bên write-bridge chỉ là
// state-source nội bộ cho seam authorize trước khi ghi (gate bằng cờ WRITE
// BRIDGE — 2 rủi ro/lifecycle bật khác nhau, không được trộn 1 cờ). Response
// trả RAW (task/assignees/comments/links/events, snake_case) — KHÔNG remap ở
// đây, business logic (enrich/filter/authorize) chạy ở task-core.js's
// getTaskDetailViaServer(), đúng nguyên tắc "adapter không chứa business
// logic" đã CLOSED cho toàn bộ file này.
async function bridgeGetTaskDetail(taskId) {
  if (!PHF_HR_API_BASE_URL || !PHF_HR_API_SERVICE_TOKEN) {
    bridgeFail('PHF_TASK_READ_BRIDGE_GETDETAIL_ENABLED=true nhưng thiếu PHF_HR_API_BASE_URL hoặc PHF_HR_API_SERVICE_TOKEN trong env.', 500, 'TASK_READ_BRIDGE_MISCONFIGURED');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(PHF_HR_API_BASE_URL + `/v1/task/tasks/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + PHF_HR_API_SERVICE_TOKEN },
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') bridgeFail('phf-hr-api không phản hồi kịp thời khi đọc chi tiết task (timeout).', 504, 'TASK_READ_BRIDGE_TIMEOUT');
    bridgeFail('Không kết nối được phf-hr-api khi đọc chi tiết task: ' + err.message, 502, 'TASK_READ_BRIDGE_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 404) return { task: null, assignees: [], comments: [], links: [], events: [], attachments: [], recurrence: null, cancel_request: null };
  if (!response.ok) {
    bridgeFail('phf-hr-api trả lỗi khi đọc chi tiết task (HTTP ' + response.status + ').', 502, 'TASK_READ_BRIDGE_UPSTREAM_ERROR');
  }

  const body = await response.json();
  return body.data;
}

// IN-APP NOTIFICATION V1 — Company-PG notification read/mark. Own flag (1 flag
// / 1 risk). The DUAL identity `{ employeeCode, accountId }` is resolved by the
// caller from the authenticated session (api/_lib/task-notifications.js) — never
// from client input. Either field may be empty; phf-hr-api scopes by whichever
// is present (handover §10 — account-only Admin has employeeCode='').
function isNotificationBridgeEnabled() {
  return String(process.env.PHF_TASK_NOTIFICATION_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

async function notificationFetch(method, pathAndQuery, body) {
  if (!PHF_HR_API_BASE_URL || !PHF_HR_API_SERVICE_TOKEN) {
    bridgeFail('PHF_TASK_NOTIFICATION_BRIDGE_ENABLED=true nhưng thiếu PHF_HR_API_BASE_URL hoặc PHF_HR_API_SERVICE_TOKEN trong env.', 500, 'TASK_NOTIFICATION_BRIDGE_MISCONFIGURED');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(PHF_HR_API_BASE_URL + pathAndQuery, {
      method,
      headers: Object.assign({ Authorization: 'Bearer ' + PHF_HR_API_SERVICE_TOKEN }, method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') bridgeFail('phf-hr-api không phản hồi kịp thời khi xử lý Thông báo (timeout).', 504, 'TASK_NOTIFICATION_BRIDGE_TIMEOUT');
    bridgeFail('Không kết nối được phf-hr-api khi xử lý Thông báo: ' + err.message, 502, 'TASK_NOTIFICATION_BRIDGE_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }
  let parsed = null; try { parsed = await response.json(); } catch (_e) {}
  if (!response.ok || (parsed && parsed.ok === false)) {
    const code = (parsed && parsed.code) || 'TASK_NOTIFICATION_BRIDGE_UPSTREAM_ERROR';
    const msg = (parsed && parsed.message) || ('phf-hr-api trả lỗi HTTP ' + response.status + ' khi xử lý Thông báo.');
    bridgeFail(msg, response.status >= 400 && response.status < 600 ? response.status : 502, code);
  }
  return parsed;
}

function notificationIdentityFields(identity) {
  const id = identity || {};
  return {
    recipientEmployeeCode: String(id.employeeCode || '').trim(),
    recipientAccountId: String(id.accountId || '').trim(),
  };
}

async function bridgeListTaskNotifications(identity, limit) {
  const { recipientEmployeeCode, recipientAccountId } = notificationIdentityFields(identity);
  const parts = [];
  if (recipientEmployeeCode) parts.push('recipientEmployeeCode=' + encodeURIComponent(recipientEmployeeCode));
  if (recipientAccountId) parts.push('recipientAccountId=' + encodeURIComponent(recipientAccountId));
  if (limit) parts.push('limit=' + encodeURIComponent(String(limit)));
  const parsed = await notificationFetch('GET', '/v1/task/notifications?' + parts.join('&'));
  return {
    notifications: (parsed && parsed.data) || [],
    count: (parsed && parsed.count) || 0,
    taskRelations: (parsed && parsed.taskRelations) || [],
  };
}

async function bridgeMarkTaskNotificationsRead(identity, ids) {
  const parsed = await notificationFetch('POST', '/v1/task/notifications:markRead',
    Object.assign(notificationIdentityFields(identity), { ids }));
  return (parsed && parsed.data) || { marked: 0 };
}

async function bridgeMarkAllTaskNotificationsRead(identity) {
  const parsed = await notificationFetch('POST', '/v1/task/notifications:markAllRead',
    notificationIdentityFields(identity));
  return (parsed && parsed.data) || { marked: 0 };
}

module.exports = {
  isBridgeEnabled,
  bridgeListTaskCategories,
  isListTasksBridgeEnabled,
  bridgeListTasks,
  isGetTaskDetailBridgeEnabled,
  bridgeGetTaskDetail,
  isNotificationBridgeEnabled,
  bridgeListTaskNotifications,
  bridgeMarkTaskNotificationsRead,
  bridgeMarkAllTaskNotificationsRead,
};
