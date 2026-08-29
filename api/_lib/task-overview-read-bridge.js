'use strict';

// PHF Task — Reporting V2 (Tổng quan) read bridge — api/data.js → HTTPS
// server-to-server → phf-hr-api → PostgreSQL phf_hr (task.*). Sibling of
// task-read-bridge.js, NOT a modification of it — Overview needs a different
// query shape (unpaginated authorized population + completion events in one
// call) than the Task List bridge provides.
//
// TẮT MẶC ĐỊNH (PHF_TASK_OVERVIEW_READ_BRIDGE_ENABLED phải ='true' tường
// minh) — cùng nguyên tắc an toàn "2 rủi ro khác nhau, không gộp chung 1 cờ"
// đã CLOSED cho task-read-bridge.js.
//
// Service token / signing secret đọc từ process.env — KHÔNG hardcode, KHÔNG
// log giá trị (đúng convention task-read-bridge.js).

const PHF_HR_API_BASE_URL = String(process.env.PHF_HR_API_BASE_URL || '').trim().replace(/\/$/, '');
const PHF_HR_API_SERVICE_TOKEN = String(process.env.PHF_HR_API_SERVICE_TOKEN || '').trim();
const TASK_QUERY_DESCRIPTOR_SIGNING_SECRET = String(process.env.TASK_QUERY_DESCRIPTOR_SIGNING_SECRET || '').trim();
const BRIDGE_TIMEOUT_MS = 6000;

const { buildResolvedTaskOverviewQueryDescriptor } = require('./task-overview-query-descriptor-builder');

function isOverviewBridgeEnabled() {
  return String(process.env.PHF_TASK_OVERVIEW_READ_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function bridgeFail(message, statusCode, errorCode) {
  const e = new Error(message);
  e.statusCode = statusCode || 502;
  e.code = errorCode || 'TASK_OVERVIEW_READ_BRIDGE_ERROR';
  throw e;
}

// bridgeFetchOverviewPopulation(session) -> {
//   tasks: [{ task_id, task_code, title, status, deadline, completed_at,
//             category_code, created_by_employee_code, is_cross_department,
//             source_department, target_department, created_at, row_version,
//             primary_employee_code, on_time }],
//   effectiveScope: 'self'|'managed'
// }
// on_time (boolean|null) is pre-merged here from the raw completionEvents
// array phf-hr-api returns (task-grain shape task-reporting-v2.js consumes
// directly — no separate event-grain fetch needed at the caller).
async function bridgeFetchOverviewPopulation(session) {
  if (!PHF_HR_API_BASE_URL || !PHF_HR_API_SERVICE_TOKEN || !TASK_QUERY_DESCRIPTOR_SIGNING_SECRET) {
    bridgeFail('PHF_TASK_OVERVIEW_READ_BRIDGE_ENABLED=true nhưng thiếu PHF_HR_API_BASE_URL/PHF_HR_API_SERVICE_TOKEN/TASK_QUERY_DESCRIPTOR_SIGNING_SECRET trong env.', 500, 'TASK_OVERVIEW_READ_BRIDGE_MISCONFIGURED');
  }

  const built = await buildResolvedTaskOverviewQueryDescriptor(session, { signingSecret: TASK_QUERY_DESCRIPTOR_SIGNING_SECRET });
  const { effectiveScope, ...descriptor } = built; // effectiveScope is local-only — never sent over the wire (see descriptor builder comment)

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(PHF_HR_API_BASE_URL + '/v1/task/overview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PHF_HR_API_SERVICE_TOKEN },
      body: JSON.stringify({ descriptor }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') bridgeFail('phf-hr-api không phản hồi kịp thời (timeout).', 504, 'TASK_OVERVIEW_READ_BRIDGE_TIMEOUT');
    bridgeFail('Không kết nối được phf-hr-api: ' + err.message, 502, 'TASK_OVERVIEW_READ_BRIDGE_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    bridgeFail('phf-hr-api trả lỗi khi đọc dữ liệu Tổng quan (HTTP ' + response.status + ').', 502, 'TASK_OVERVIEW_READ_BRIDGE_UPSTREAM_ERROR');
  }

  const body = await response.json();
  const rows = body.tasks || [];
  const events = body.completionEvents || [];

  // Latest completion event per task_id (events already ORDER BY occurred_at
  // DESC from the executor) — same "first occurrence wins" pattern the old
  // Supabase report engine used (fetchLatestCompletionEvents()).
  const latestEventByTaskId = new Map();
  events.forEach((e) => { if (!latestEventByTaskId.has(e.taskId)) latestEventByTaskId.set(e.taskId, e); });

  const tasks = rows.map((r) => {
    const event = latestEventByTaskId.get(r.id);
    // Simplified vs. the old engine's full completed_at/event cross-check +
    // data_integrity_warnings machinery (V2-R1 scope reduction, documented
    // in the gate report) — on_time is null (excluded from the rate's
    // denominator) whenever no completion event is found or its payload
    // lacks the flag, never guessed.
    const onTime = (event && event.payload && typeof event.payload.on_time === 'boolean') ? event.payload.on_time : null;
    return {
      task_id: r.id,
      task_code: r.taskCode,
      title: r.title,
      status: r.status,
      deadline: r.deadline,
      completed_at: r.completedAt,
      category_code: r.categoryCode,
      created_by_employee_code: r.createdByEmployeeCode,
      is_cross_department: r.isCrossDepartment,
      source_department: r.sourceDepartment,
      target_department: r.targetDepartment,
      created_at: r.createdAt,
      row_version: r.rowVersion,
      primary_employee_code: r.primaryEmployeeCode,
      on_time: onTime,
    };
  });

  return { tasks, effectiveScope };
}

module.exports = { isOverviewBridgeEnabled, bridgeFetchOverviewPopulation };
