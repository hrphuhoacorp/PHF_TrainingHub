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
// GAP ĐÃ BIẾT (quyết định 2026-08-23, giữ nguyên cho tới khi có quyết định
// khác): response của phf-hr-api (services/phf-hr-api/lib/task-query-executor.js)
// KHÔNG SELECT category_code/progress_percent/progress_status — bridgeListTasks()
// trả các field này = null tường minh (KHÔNG suy đoán/fabricate). full_name/
// department của created_by/primary được enrich CỤC BỘ ở main app bằng
// loadOrgRows() (dữ liệu org đã có sẵn ở main app, không phụ thuộc phf-hr-api).
//
// Service token đọc từ process.env — KHÔNG hardcode, KHÔNG log giá trị.

const PHF_HR_API_BASE_URL = String(process.env.PHF_HR_API_BASE_URL || '').trim().replace(/\/$/, '');
const PHF_HR_API_SERVICE_TOKEN = String(process.env.PHF_HR_API_SERVICE_TOKEN || '').trim();
const TASK_QUERY_DESCRIPTOR_SIGNING_SECRET = String(process.env.TASK_QUERY_DESCRIPTOR_SIGNING_SECRET || '').trim();
const BRIDGE_TIMEOUT_MS = 6000;

const { buildResolvedTaskQueryDescriptor } = require('./task-query-descriptor-builder');
const { loadOrgRows } = require('./task-employee-scope');

function isBridgeEnabled() {
  return String(process.env.PHF_TASK_READ_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function isListTasksBridgeEnabled() {
  return String(process.env.PHF_TASK_READ_BRIDGE_LISTTASKS_ENABLED || '').trim().toLowerCase() === 'true';
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

  const descriptor = await buildResolvedTaskQueryDescriptor(session, params, { signingSecret: TASK_QUERY_DESCRIPTOR_SIGNING_SECRET });

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
  // progress_percent/progress_status = null tường minh (xem GAP ĐÃ BIẾT ở
  // đầu file) — KHÔNG suy đoán giá trị.
  const tasks = rows.map((r) => ({
    task_id: r.id,
    task_code: r.taskCode,
    title: r.title,
    flow_type: r.flowType,
    status: r.status,
    priority: r.priority,
    deadline: r.deadline,
    category_code: null,
    progress_percent: null,
    progress_status: null,
    is_cross_department: r.isCrossDepartment,
    source_department: r.sourceDepartment,
    target_department: r.targetDepartment,
    created_by: personInfo(r.createdByEmployeeCode),
    primary: r.primaryEmployeeCode ? personInfo(r.primaryEmployeeCode) : null,
    self_task: !!(r.primaryEmployeeCode && orgCode(r.createdByEmployeeCode) === orgCode(r.primaryEmployeeCode)),
    row_version: r.rowVersion,
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
  };
}

module.exports = { isBridgeEnabled, bridgeListTaskCategories, isListTasksBridgeEnabled, bridgeListTasks };
