'use strict';

/*
 * PHF Task — MAIL CONTRACT V1 bridge (Vercel -> phf-hr-api `/v1/task/mail-*`).
 *
 * Same transport + env + error contract as api/_lib/task-recurrence-bridge.js.
 * The Vercel drainer calls these; phf-hr-api owns the transactional-outbox
 * state in Company PostgreSQL. No Supabase here.
 *
 * The drain path rides the SAME write-bridge kill switch
 * (PHF_TASK_WRITE_BRIDGE_ENABLED) plus its own PHF_TASK_MAIL_V1_ENABLED master
 * flag (checked by the caller, api/_lib/task-mail-drain.js).
 */

const PHF_HR_API_BASE_URL = String(process.env.PHF_HR_API_BASE_URL || '').trim().replace(/\/$/, '');
const PHF_HR_API_SERVICE_TOKEN = String(process.env.PHF_HR_API_SERVICE_TOKEN || '').trim();
const BRIDGE_TIMEOUT_MS = 9000;

function isMailBridgeEnabled() {
  return String(process.env.PHF_TASK_WRITE_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function bridgeFail(message, statusCode, errorCode) {
  const e = new Error(message);
  e.statusCode = statusCode || 502;
  e.code = errorCode || 'TASK_MAIL_BRIDGE_ERROR';
  throw e;
}

function preflight() {
  if (!isMailBridgeEnabled()) {
    bridgeFail('PHF_TASK_WRITE_BRIDGE_ENABLED chưa bật — mail bridge chưa được phép.', 500, 'TASK_WRITE_BRIDGE_DISABLED');
  }
  if (!PHF_HR_API_BASE_URL || !PHF_HR_API_SERVICE_TOKEN) {
    bridgeFail('Thiếu PHF_HR_API_BASE_URL hoặc PHF_HR_API_SERVICE_TOKEN.', 500, 'TASK_WRITE_BRIDGE_MISCONFIGURED');
  }
}

async function call(method, routePath, body, query) {
  preflight();
  let url = PHF_HR_API_BASE_URL + routePath;
  if (method === 'GET' && query) {
    const qs = new URLSearchParams();
    Object.keys(query).forEach((k) => { if (query[k] != null && query[k] !== '') qs.set(k, String(query[k])); });
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
    if (err.name === 'AbortError') bridgeFail('phf-hr-api timeout.', 504, 'TASK_MAIL_BRIDGE_TIMEOUT');
    bridgeFail('Không kết nối được phf-hr-api: ' + err.message, 502, 'TASK_MAIL_BRIDGE_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }
  let parsed;
  try { parsed = await response.json(); }
  catch (err) { bridgeFail('phf-hr-api trả response không phải JSON.', 502, 'TASK_MAIL_BRIDGE_BAD_RESPONSE'); }
  if (!response.ok || (parsed && parsed.ok === false)) {
    bridgeFail((parsed && parsed.message) || ('HTTP ' + response.status), response.status, (parsed && parsed.code) || 'TASK_MAIL_BRIDGE_UPSTREAM_ERROR');
  }
  return parsed.data;
}

// --- drainer ---
async function bridgeClaimMailOutbox(limit) {
  return call('POST', '/v1/task/mail-outbox:claim', { limit: limit || undefined });
}
async function bridgeMarkMailOutbox(id, outcome, reason) {
  return call('POST', '/v1/task/mail-outbox:mark', { id, outcome, reason: reason || undefined });
}
async function bridgeMarkMailOutboxBatch(marks) {
  return call('POST', '/v1/task/mail-outbox:markBatch', { marks: Array.isArray(marks) ? marks : [] });
}
async function bridgeMailOutboxStats() {
  return call('GET', '/v1/task/mail-outbox/stats');
}

// --- Increment 2: weekly-report settings + weekly-outbox enqueue ---------
async function bridgeGetMailSettings() {
  return call('GET', '/v1/task/mail-settings');
}
async function bridgeListActiveMailRecipients() {
  return call('GET', '/v1/task/mail-settings/active-recipients');
}
async function bridgeSetWeeklyReportEnabled(enabled, actor) {
  return call('POST', '/v1/task/mail-settings:setWeeklyReportEnabled', { enabled: !!enabled, actor: actor || {} });
}
async function bridgeAddMailRecipient(email, label, actor) {
  return call('POST', '/v1/task/mail-settings:addRecipient', { email, label: label || undefined, actor: actor || {} });
}
async function bridgeSetMailRecipientEnabled(id, enabled) {
  return call('POST', '/v1/task/mail-settings:setRecipientEnabled', { id, enabled: !!enabled });
}
async function bridgeRemoveMailRecipient(id) {
  return call('POST', '/v1/task/mail-settings:removeRecipient', { id });
}
async function bridgeEnqueueWeeklyReport(payload) {
  return call('POST', '/v1/task/mail-outbox:enqueueWeekly', {
    periodKey: payload.periodKey, periodLabel: payload.periodLabel,
    subject: payload.subject, html: payload.html, recipients: payload.recipients || [],
  });
}

module.exports = {
  isMailBridgeEnabled,
  bridgeClaimMailOutbox,
  bridgeMarkMailOutbox,
  bridgeMarkMailOutboxBatch,
  bridgeMailOutboxStats,
  bridgeGetMailSettings,
  bridgeListActiveMailRecipients,
  bridgeSetWeeklyReportEnabled,
  bridgeAddMailRecipient,
  bridgeSetMailRecipientEnabled,
  bridgeRemoveMailRecipient,
  bridgeEnqueueWeeklyReport,
};
