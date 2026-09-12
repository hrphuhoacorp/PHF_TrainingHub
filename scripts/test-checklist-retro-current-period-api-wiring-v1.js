'use strict';
/*
 * Regression — PROD 400 CHECKLIST_MONTHLY_INVALID on "Lưu & áp dụng" (Apply-timing V1,
 * QTTH/HCNS – Trưởng bộ phận, 2026-09-12).
 *
 * Root cause: api/data.js (and server.js) routed checklistRetroClassifyCurrentPeriod /
 * checklistRetroApplyCurrentPeriod by passing the RAW request payload {action,input:{...}}
 * into classifyChecklistMonthlyRetroactiveScope()/applyChecklistMonthlyRetroactiveScope(),
 * instead of payload.input like every sibling Retro action (checklistRetroCopyVersion,
 * checklistRetroPreviewDiff, ...). The frontend helper checklistRetroApiCall() always wraps
 * the body as {action, input:{templateId,periodMonth}}, so the lib function received
 * input.periodMonth === undefined and month() failed with CHECKLIST_MONTHLY_INVALID.
 *
 * This test drives the REAL api/data.js module.exports handler (same as Vercel Production)
 * with the exact wrapped body shape the real frontend sends, and asserts the nested
 * periodMonth actually reaches the response — it must FAIL on the pre-fix code (which would
 * 400 with CHECKLIST_MONTHLY_INVALID instead of echoing periodMonth back at 200).
 *
 *   node scripts/test-checklist-retro-current-period-api-wiring-v1.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const fs = require('fs');
const path = require('path');
const supabasePath = require.resolve('@supabase/supabase-js');
const authPath = require.resolve('../api/_lib/auth');
const apiDataPath = require.resolve('../api/data');

let passes = 0, failures = 0;
function check(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); failures++; } else { passes++; console.log('PASS: ' + msg); } }

// ---- 1. Source-scan parity: both actions must unwrap payload.input in BOTH server.js and api/data.js
const ACTIONS = ['checklistRetroClassifyCurrentPeriod', 'checklistRetroApplyCurrentPeriod'];
const serverSrc = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
const dataSrc = fs.readFileSync(path.resolve(__dirname, '..', 'api', 'data.js'), 'utf8');
ACTIONS.forEach(a => {
  const reServer = new RegExp("action==='" + a + "'[^;]*payload\\.input\\|\\|\\{\\}");
  const reData = new RegExp("action==='" + a + "'[^;]*payload\\.input\\|\\|\\{\\}");
  check(reServer.test(serverSrc), 'server.js routes ' + a + ' with payload.input||{} (not raw payload)');
  check(reData.test(dataSrc), 'api/data.js routes ' + a + ' with payload.input||{} (not raw payload)');
});

// ---- 2. Drive the real handler with the exact wire shape checklistRetroApiCall() sends
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: { createClient() { return {
    from() { const q = { select(){return q;}, eq(){return q;}, in(){return q;}, not(){return q;}, order(){return q;}, limit(){return q;}, maybeSingle(){return q;}, single(){return q;}, then(r){return Promise.resolve({data:[],error:null}).then(r);} }; return q; }
  }; } }
};
const adminSession = { account: { id: 'admin-1', name: 'Admin Test', employeeCode: 'PHF001' }, role: 'admin' };
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: { requireSession: async () => adminSession, authorizePayload: (s, p) => p, listHubAccountSummaries: async () => [] }
};
delete require.cache[apiDataPath];
const handler = require('../api/data');

function fakeReqRes(bodyObj) {
  const bodyStr = JSON.stringify(bodyObj);
  const req = { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(bodyStr)) }, query: {}, body: bodyStr };
  const res = { _status: null, _body: null, setHeader() { return this; }, status(c) { this._status = c; return this; }, json(b) { this._body = b; return this; } };
  return { req, res };
}

(async () => {
  // CASE 1 — classify: nested input.periodMonth must reach the lib function, not undefined
  {
    const { req, res } = fakeReqRes({ action: 'checklistRetroClassifyCurrentPeriod', input: { templateId: 'qtth-hcns-thang', periodMonth: '2026-09' } });
    await handler(req, res);
    check(res._body && res._body.code !== 'CHECKLIST_MONTHLY_INVALID', 'classify NOT rejected with CHECKLIST_MONTHLY_INVALID (got code=' + (res._body && res._body.code) + ')');
    check(res._status === 200 && res._body && res._body.ok === true, 'classify → 200 ok:true (got status=' + res._status + ')');
    check(res._body && res._body.periodMonth === '2026-09', 'classify echoes periodMonth=2026-09 from nested input (got ' + (res._body && res._body.periodMonth) + ')');
  }

  // CASE 2 — apply: same nested-input contract, plus mode/reason siblings
  {
    const { req, res } = fakeReqRes({ action: 'checklistRetroApplyCurrentPeriod', input: { templateId: 'qtth-hcns-thang', periodMonth: '2026-09', mode: 'all', reason: 'Test routing contract' } });
    await handler(req, res);
    check(res._body && res._body.code !== 'CHECKLIST_MONTHLY_INVALID', 'apply NOT rejected with CHECKLIST_MONTHLY_INVALID (got code=' + (res._body && res._body.code) + ')');
    check(res._body && res._body.code !== 'CHECKLIST_MONTHLY_RETRO_SCOPE_MODE_INVALID', 'apply NOT rejected with mode invalid (mode reached the lib function)');
    check(res._body && res._body.code !== 'CHECKLIST_MONTHLY_RETRO_SCOPE_REASON_REQUIRED', 'apply NOT rejected with reason required (reason reached the lib function)');
    check(res._status === 200 && res._body && res._body.ok === true, 'apply → 200 ok:true (got status=' + res._status + ')');
    check(res._body && res._body.periodMonth === '2026-09', 'apply echoes periodMonth=2026-09 from nested input (got ' + (res._body && res._body.periodMonth) + ')');
  }

  console.log('\n' + passes + ' PASS' + (failures ? (' / ' + failures + ' FAIL') : ''));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
