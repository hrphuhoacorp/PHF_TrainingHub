'use strict';

// PHF HR — Competition V1 · Batch C2 Vercel bridge to phf-hr-api.
//
// Mirrors api/_lib/task-write-bridge.js's callWriteRoute() pattern exactly —
// same env vars (PHF_HR_API_BASE_URL / PHF_HR_API_SERVICE_TOKEN, the SAME
// service-token auth already used for Task, no second auth protocol), same
// timeout/abort/unwrap contract, same "throw on !ok, never return the raw
// response" discipline. One route, one flag: Competition's phf-hr-api surface
// is a single POST /v1/competition action dispatcher (Batch C1) that already
// separates read vs write server-side — no flag explosion needed.
//
// DEV/LOCAL ONLY in this batch. Never enable PHF_COMPETITION_BRIDGE_ENABLED
// on Production.

const PHF_HR_API_BASE_URL = String(process.env.PHF_HR_API_BASE_URL || '').trim().replace(/\/$/, '');
const PHF_HR_API_SERVICE_TOKEN = String(process.env.PHF_HR_API_SERVICE_TOKEN || '').trim();
const BRIDGE_TIMEOUT_MS = 8000;

function isCompetitionBridgeEnabled() {
  return String(process.env.PHF_COMPETITION_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function bridgeFail(message, statusCode, errorCode) {
  const e = new Error(message);
  e.statusCode = statusCode || 502;
  e.code = errorCode || 'COMPETITION_BRIDGE_ERROR';
  throw e;
}

function preflightCheck() {
  if (!isCompetitionBridgeEnabled()) {
    bridgeFail('PHF_COMPETITION_BRIDGE_ENABLED chưa bật — module Chương trình thi đua chưa được phép gọi phf-hr-api.', 500, 'COMPETITION_BRIDGE_DISABLED');
  }
  if (!PHF_HR_API_BASE_URL || !PHF_HR_API_SERVICE_TOKEN) {
    bridgeFail('PHF_COMPETITION_BRIDGE_ENABLED=true nhưng thiếu PHF_HR_API_BASE_URL hoặc PHF_HR_API_SERVICE_TOKEN.', 500, 'COMPETITION_BRIDGE_MISCONFIGURED');
  }
}

// callCompetitionAction(action, actor, params) — actor is the VERIFIED actor
// from competition-identity.js. Never accepts a client-supplied actor.
async function callCompetitionAction(action, actor, params) {
  preflightCheck();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(PHF_HR_API_BASE_URL + '/v1/competition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PHF_HR_API_SERVICE_TOKEN },
      body: JSON.stringify({ action, actor, params: params || {} }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') bridgeFail('phf-hr-api không phản hồi kịp thời (timeout).', 504, 'COMPETITION_BRIDGE_TIMEOUT');
    bridgeFail('Không kết nối được phf-hr-api: ' + err.message, 502, 'COMPETITION_BRIDGE_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }

  let parsed;
  try {
    parsed = await response.json();
  } catch (err) {
    bridgeFail('phf-hr-api trả response không phải JSON hợp lệ.', 502, 'COMPETITION_BRIDGE_BAD_RESPONSE');
  }

  if (!response.ok || (parsed && parsed.ok === false)) {
    const code = (parsed && parsed.code) || 'COMPETITION_BRIDGE_UPSTREAM_ERROR';
    const message = (parsed && parsed.message) || ('phf-hr-api trả lỗi HTTP ' + response.status);
    bridgeFail(message, response.status, code);
  }
  return parsed.data;
}

module.exports = { isCompetitionBridgeEnabled, callCompetitionAction };
