'use strict';

// PHF HR — THÔNG BÁO QUẢN TRỊ V1 · Batch 01 Vercel bridge to phf-hr-api.
//
// Mirrors api/_lib/competition-bridge.js / qtth-bridge.js exactly — same env
// vars (PHF_HR_API_BASE_URL / PHF_HR_API_SERVICE_TOKEN, the SAME service-token
// auth already used for Task + Competition), same timeout/abort/unwrap
// contract, same "throw on !ok, never return the raw response" discipline.
// One route, one flag: POST /v1/notice + PHF_NOTICE_BRIDGE_ENABLED.
//
// DEV/LOCAL ONLY in this batch. Never enable PHF_NOTICE_BRIDGE_ENABLED on Production.

const PHF_HR_API_BASE_URL = String(process.env.PHF_HR_API_BASE_URL || '').trim().replace(/\/$/, '');
const PHF_HR_API_SERVICE_TOKEN = String(process.env.PHF_HR_API_SERVICE_TOKEN || '').trim();
const BRIDGE_TIMEOUT_MS = 9000;

function isNoticeBridgeEnabled() {
  return String(process.env.PHF_NOTICE_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function bridgeFail(message, statusCode, errorCode) {
  const e = new Error(message);
  e.statusCode = statusCode || 502;
  e.code = errorCode || 'NOTICE_BRIDGE_ERROR';
  throw e;
}

function preflightCheck() {
  if (!isNoticeBridgeEnabled()) {
    bridgeFail('PHF_NOTICE_BRIDGE_ENABLED chưa bật — module Thông báo Quản trị chưa được phép gọi phf-hr-api.', 500, 'NOTICE_BRIDGE_DISABLED');
  }
  if (!PHF_HR_API_BASE_URL || !PHF_HR_API_SERVICE_TOKEN) {
    bridgeFail('PHF_NOTICE_BRIDGE_ENABLED=true nhưng thiếu PHF_HR_API_BASE_URL hoặc PHF_HR_API_SERVICE_TOKEN.', 500, 'NOTICE_BRIDGE_MISCONFIGURED');
  }
}

// callNoticeAction(action, actor, params) — actor is the VERIFIED actor from
// notice-identity.js. Never accepts a client-supplied actor.
async function callNoticeAction(action, actor, params) {
  preflightCheck();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(PHF_HR_API_BASE_URL + '/v1/notice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PHF_HR_API_SERVICE_TOKEN },
      body: JSON.stringify({ action, actor, params: params || {} }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') bridgeFail('phf-hr-api không phản hồi kịp thời (timeout).', 504, 'NOTICE_BRIDGE_TIMEOUT');
    bridgeFail('Không kết nối được phf-hr-api: ' + err.message, 502, 'NOTICE_BRIDGE_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }

  let parsed;
  try {
    parsed = await response.json();
  } catch (err) {
    bridgeFail('phf-hr-api trả response không phải JSON hợp lệ.', 502, 'NOTICE_BRIDGE_BAD_RESPONSE');
  }

  if (!response.ok || (parsed && parsed.ok === false)) {
    const code = (parsed && parsed.code) || 'NOTICE_BRIDGE_UPSTREAM_ERROR';
    const message = (parsed && parsed.message) || ('phf-hr-api trả lỗi HTTP ' + response.status);
    bridgeFail(message, response.status, code);
  }
  return parsed.data;
}

module.exports = { isNoticeBridgeEnabled, callNoticeAction };
