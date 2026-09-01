'use strict';

// PHF Task — RECURRENCE V1 WRITE/READ bridge — api/data.js dispatch
// (`*TaskRecurrence*` actions) → HTTPS server-to-server → phf-hr-api
// `/v1/task/recurrence*` → Company PostgreSQL `phf_hr` (schema `task`).
//
// Same pattern + same env + same error contract as api/_lib/task-write-bridge.js
// (which is already CLOSED for Task write). This module adds ONLY what
// recurrence needs on top of that pattern: a PATCH verb and a GET-with-query
// verb, neither of which task-write-bridge's POST-only callWriteRoute() covers.
//
// NO authorization here — the caller (api/_lib/task-recurrence-actions.js,
// main app) resolves identity + permission scope + (for :run) the ACTIVE
// employee/category sets BEFORE calling this module, exactly like
// task-server-integration.js does for every other Task write.
//
// Company PostgreSQL is the only datastore. This module never touches Supabase.

const PHF_HR_API_BASE_URL = String(process.env.PHF_HR_API_BASE_URL || '').trim().replace(/\/$/, '');
const PHF_HR_API_SERVICE_TOKEN = String(process.env.PHF_HR_API_SERVICE_TOKEN || '').trim();
const BRIDGE_TIMEOUT_MS = 8000;

// Recurrence rides the SAME write-bridge kill switch as every other Task write
// (PHF_TASK_WRITE_BRIDGE_ENABLED) — there is no separate recurrence flag, and
// there is no Supabase/legacy fallback because recurrence has never existed
// anywhere but Company PostgreSQL.
function isRecurrenceBridgeEnabled() {
  return String(process.env.PHF_TASK_WRITE_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function bridgeFail(message, statusCode, errorCode) {
  const e = new Error(message);
  e.statusCode = statusCode || 502;
  e.code = errorCode || 'TASK_RECURRENCE_BRIDGE_ERROR';
  throw e;
}

function preflightCheck() {
  if (!isRecurrenceBridgeEnabled()) {
    bridgeFail('PHF_TASK_WRITE_BRIDGE_ENABLED chưa bật — lịch lặp chưa được phép ghi.', 500, 'TASK_WRITE_BRIDGE_DISABLED');
  }
  if (!PHF_HR_API_BASE_URL || !PHF_HR_API_SERVICE_TOKEN) {
    bridgeFail('PHF_TASK_WRITE_BRIDGE_ENABLED=true nhưng thiếu PHF_HR_API_BASE_URL hoặc PHF_HR_API_SERVICE_TOKEN.', 500, 'TASK_WRITE_BRIDGE_MISCONFIGURED');
  }
}

function unwrapOrThrow(httpOk, parsed, httpStatus) {
  if (!httpOk || (parsed && parsed.ok === false)) {
    const code = (parsed && parsed.code) || 'TASK_RECURRENCE_BRIDGE_UPSTREAM_ERROR';
    const message = (parsed && parsed.message) || ('phf-hr-api trả lỗi HTTP ' + httpStatus);
    bridgeFail(message, httpStatus, code);
  }
}

// method: 'POST' | 'PATCH' | 'GET'. `body` is ignored for GET; `query` (an
// object) is only used for GET. Returns parsed.data on success, throws an
// Error whose .code/.statusCode match the phf-hr-api response verbatim.
async function callRecurrenceRoute(method, path, body, query) {
  preflightCheck();

  let url = PHF_HR_API_BASE_URL + path;
  if (method === 'GET' && query) {
    const qs = new URLSearchParams();
    Object.keys(query).forEach((k) => { if (query[k] !== undefined && query[k] !== null && query[k] !== '') qs.set(k, String(query[k])); });
    const s = qs.toString();
    if (s) url += '?' + s;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: Object.assign(
        { Authorization: 'Bearer ' + PHF_HR_API_SERVICE_TOKEN },
        method === 'GET' ? {} : { 'Content-Type': 'application/json' }
      ),
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') bridgeFail('phf-hr-api không phản hồi kịp thời (timeout).', 504, 'TASK_WRITE_BRIDGE_TIMEOUT');
    bridgeFail('Không kết nối được phf-hr-api: ' + err.message, 502, 'TASK_WRITE_BRIDGE_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }

  let parsed;
  try {
    parsed = await response.json();
  } catch (err) {
    bridgeFail('phf-hr-api trả response không phải JSON hợp lệ.', 502, 'TASK_WRITE_BRIDGE_BAD_RESPONSE');
  }
  unwrapOrThrow(response.ok, parsed, response.status);
  return parsed.data;
}

function actorPayload(actorEmployeeCode, actorAccountId) {
  return { employeeCode: actorEmployeeCode || undefined, accountId: actorAccountId || undefined };
}

// input: the fully-validated rule shape the engine's validateRuleInput()
// expects (title, content, categoryCode, priority, primaryEmployeeCode,
// relatedEmployeeCodes[], startDateKey, startHour, startMinute, durationMs,
// frequency, weekday|dayOfMonth, endConditionType, endDateKey, reason?).
async function bridgeCreateRecurrenceRule(input, actorEmployeeCode, actorAccountId) {
  return callRecurrenceRoute('POST', '/v1/task/recurrence', Object.assign({}, input, { actor: actorPayload(actorEmployeeCode, actorAccountId) }));
}

async function bridgeUpdateRecurrenceRule(ruleId, input, actorEmployeeCode, actorAccountId) {
  return callRecurrenceRoute('PATCH', `/v1/task/recurrence/${encodeURIComponent(ruleId)}`, Object.assign({}, input, { actor: actorPayload(actorEmployeeCode, actorAccountId) }));
}

// kind: 'pause' | 'resume' | 'stop'
async function bridgeTransitionRecurrenceRule(ruleId, kind, reason, actorEmployeeCode, actorAccountId) {
  return callRecurrenceRoute('POST', `/v1/task/recurrence/${encodeURIComponent(ruleId)}:${kind}`, {
    reason: reason || undefined,
    actor: actorPayload(actorEmployeeCode, actorAccountId),
  });
}

async function bridgeListRecurrenceRules(filter) {
  const f = filter || {};
  return callRecurrenceRoute('GET', '/v1/task/recurrence', null, {
    status: f.status,
    createdByEmployeeCode: f.createdByEmployeeCode,
  });
}

// activePrimaryCodes / activeCategoryCodes MUST be resolved by the caller
// (main app) — passing null here means "caller could not resolve", and the
// engine then treats primary as active. The main-app action never passes null
// for a real run (see task-recurrence-actions.js runTaskRecurrence()).
async function bridgeRunRecurrence(options) {
  const o = options || {};
  return callRecurrenceRoute('POST', '/v1/task/recurrence:run', {
    ruleId: o.ruleId || undefined,
    nowMs: o.nowMs,
    activePrimaryCodes: Array.isArray(o.activePrimaryCodes) ? o.activePrimaryCodes : null,
    activeCategoryCodes: Array.isArray(o.activeCategoryCodes) ? o.activeCategoryCodes : null,
    maxCatchupPerRule: o.maxCatchupPerRule,
    maxTotalPerRun: o.maxTotalPerRun,
  });
}

module.exports = {
  isRecurrenceBridgeEnabled,
  bridgeCreateRecurrenceRule,
  bridgeUpdateRecurrenceRule,
  bridgeTransitionRecurrenceRule,
  bridgeListRecurrenceRules,
  bridgeRunRecurrence,
};
