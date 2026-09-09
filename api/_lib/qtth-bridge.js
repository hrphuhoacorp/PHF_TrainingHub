'use strict';

// PHF HR — QTTH V1 · Batch 01 Vercel bridge to phf-hr-api.
//
// Mirrors api/_lib/competition-bridge.js exactly — same env vars
// (PHF_HR_API_BASE_URL / PHF_HR_API_SERVICE_TOKEN, the SAME service-token auth
// already used for Task + Competition), same timeout/abort/unwrap contract,
// same "throw on !ok, never return the raw response" discipline. One route,
// one flag: QTTH's phf-hr-api surface is a single POST /v1/qtth action
// dispatcher that separates read vs write + authorization server-side.
//
// DEV/LOCAL ONLY in this batch. Never enable PHF_QTTH_BRIDGE_ENABLED on Production.

const PHF_HR_API_BASE_URL = String(process.env.PHF_HR_API_BASE_URL || '').trim().replace(/\/$/, '');
const PHF_HR_API_SERVICE_TOKEN = String(process.env.PHF_HR_API_SERVICE_TOKEN || '').trim();
const BRIDGE_TIMEOUT_MS = 8000;
const BRIDGE_TIMEOUT_MS_PAYROLL = 25000; // payroll import (parse + normalize + persist) is heavier
// accounting.uploadPreview streams + classifies a ~73MB FAST worksheet then
// persists ~350 rows — give it the same generous window as payroll import.
const BRIDGE_TIMEOUT_MS_ACCOUNTING = 45000;

function isQtthBridgeEnabled() {
  return String(process.env.PHF_QTTH_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function bridgeFail(message, statusCode, errorCode) {
  const e = new Error(message);
  e.statusCode = statusCode || 502;
  e.code = errorCode || 'QTTH_BRIDGE_ERROR';
  throw e;
}

function preflightCheck() {
  if (!isQtthBridgeEnabled()) {
    bridgeFail('PHF_QTTH_BRIDGE_ENABLED chưa bật — module Quản trị tổng hợp chưa được phép gọi phf-hr-api.', 500, 'QTTH_BRIDGE_DISABLED');
  }
  if (!PHF_HR_API_BASE_URL || !PHF_HR_API_SERVICE_TOKEN) {
    bridgeFail('PHF_QTTH_BRIDGE_ENABLED=true nhưng thiếu PHF_HR_API_BASE_URL hoặc PHF_HR_API_SERVICE_TOKEN.', 500, 'QTTH_BRIDGE_MISCONFIGURED');
  }
}

// callQtthAction(action, actor, params) — actor is the VERIFIED actor from
// qtth-identity.js. Never accepts a client-supplied actor.
async function callQtthAction(action, actor, params) {
  preflightCheck();

  const controller = new AbortController();
  const timeoutMs = /^payroll\./.test(action) ? BRIDGE_TIMEOUT_MS_PAYROLL
    : (action === 'accounting.uploadPreview' || action === 'accounting.decideItem' || action === 'accounting.setRuleActive' || action === 'accounting.importDictionary') ? BRIDGE_TIMEOUT_MS_ACCOUNTING
      : BRIDGE_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(PHF_HR_API_BASE_URL + '/v1/qtth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PHF_HR_API_SERVICE_TOKEN },
      body: JSON.stringify({ action, actor, params: params || {} }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') bridgeFail('phf-hr-api không phản hồi kịp thời (timeout).', 504, 'QTTH_BRIDGE_TIMEOUT');
    bridgeFail('Không kết nối được phf-hr-api: ' + err.message, 502, 'QTTH_BRIDGE_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }

  let parsed;
  try {
    parsed = await response.json();
  } catch (err) {
    bridgeFail('phf-hr-api trả response không phải JSON hợp lệ.', 502, 'QTTH_BRIDGE_BAD_RESPONSE');
  }

  if (!response.ok || (parsed && parsed.ok === false)) {
    const code = (parsed && parsed.code) || 'QTTH_BRIDGE_UPSTREAM_ERROR';
    const message = (parsed && parsed.message) || ('phf-hr-api trả lỗi HTTP ' + response.status);
    bridgeFail(message, response.status, code);
  }
  return parsed.data;
}

module.exports = { isQtthBridgeEnabled, callQtthAction };
