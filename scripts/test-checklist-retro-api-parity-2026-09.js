'use strict';
/*
 * Regression — Production api/data.js parity for the Checklist score-table versioning flow.
 *
 * PROD bug: "Sửa Bảng tổng điểm" → "Xem trước & tạo phiên bản" → "Chưa thể xem trước /
 * Thiếu thông tin học viên cần lưu." Root cause: the checklistRetro* actions were routed
 * only in server.js (local `npm start`), NOT in api/data.js (Vercel serverless). The request
 * fell through to legacy validatePayload → request-guard.js → EMPLOYEE_REQUIRED.
 *
 * This test drives the REAL api/data.js module.exports handler (same as Vercel Production).
 *   node scripts/test-checklist-retro-api-parity-2026-09.js
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

// ---- 1. Source-scan parity: the 6 retro actions must be in BOTH server.js and api/data.js
const RETRO_ACTIONS = ['checklistRetroCopyVersion','checklistRetroPreviewDiff','checklistRetroDryRunApply','checklistRetroApply','checklistRetroApplyReviewedForm','checklistRetroSimulateEmployeeImpact'];
const serverSrc = fs.readFileSync(path.resolve(__dirname,'..','server.js'),'utf8');
const dataSrc = fs.readFileSync(path.resolve(__dirname,'..','api','data.js'),'utf8');
RETRO_ACTIONS.forEach(a => {
  check(serverSrc.includes("'" + a + "'"), 'server.js routes ' + a);
  check(dataSrc.includes("'" + a + "'"), 'api/data.js routes ' + a + ' (Production parity)');
});

// ---- 2. Drive the real handler
const rpcCalls = [];
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: { createClient() { return {
    from() { const q = { select(){return q;}, eq(){return q;}, in(){return q;}, order(){return q;}, limit(){return q;}, maybeSingle(){return q;}, single(){return q;}, then(r){return Promise.resolve({data:[],error:null}).then(r);} }; return q; },
    rpc(name, params) { rpcCalls.push({ name, params }); return Promise.resolve({ data: { ok: true, newVersionNo: params && params.p_new_version, counts: {} }, error: null }); }
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

// BH 70/30 target definition: Checklist automatic 70% + manual 30% = 100%
const OLD_DEF = { templateType: 'score_summary', groups: [], totalRows: [
  { id: 'r-lap-phieu', code: 'BH-LAP-PHIEU', name: 'Lập phiếu và đánh giá công việc tháng', target: 5, unit: 'phiếu', weight: 5, source: { type: 'manual' } },
  { id: 'r-tuan-thu', code: 'BH-TUAN-THU', name: 'Tuân thủ tiêu chuẩn công việc', target: 100, unit: 'điểm', weight: 70, source: { type: 'manual' } },
  { id: 'r-cap-tren-giao', code: 'BH-CAP-TREN', name: 'Công việc cấp trên giao', target: 10, unit: 'điểm', weight: 25, source: { type: 'manual' } }
]};
const NEW_DEF = { templateType: 'score_summary', groups: [], totalRows: [
  { id: 'r-tuan-thu', code: 'BH-TUAN-THU', name: 'Tuân thủ tiêu chuẩn công việc', target: 100, unit: 'điểm', weight: 70, source: { type: 'checklist_total' } },
  { id: 'r-cap-tren-giao', code: 'BH-CAP-TREN', name: 'Công việc cấp trên giao', target: 10, unit: 'điểm', weight: 30, source: { type: 'manual' } }
]};

(async () => {
  // CASE 2 — preview no longer fails with EMPLOYEE_REQUIRED / "học viên"
  {
    const { req, res } = fakeReqRes({ action: 'checklistRetroPreviewDiff', input: { oldDefinition: OLD_DEF, newDefinition: NEW_DEF } });
    await handler(req, res);
    check(res._status === 200, 'checklistRetroPreviewDiff → 200 via api/data.js (got ' + res._status + ')');
    check(res._body && res._body.code !== 'EMPLOYEE_REQUIRED', 'preview NOT blocked by EMPLOYEE_REQUIRED');
    check(!(res._body && typeof res._body.message === 'string' && res._body.message.indexOf('học viên') >= 0), 'preview response has no "...học viên..." legacy message');
    // CASE 1/3/8 — 70% checklist_total + 30% manual is valid, diff computed
    check(res._body && Array.isArray(res._body.errors) && res._body.errors.length === 0, 'BH 70/30 (checklist_total + manual) is valid — errors empty: ' + JSON.stringify(res._body && res._body.errors));
    check(res._body && Math.abs(Number(res._body.totalWeightAfter) - 100) < 0.001, 'totalWeightAfter = 100 (got ' + (res._body && res._body.totalWeightAfter) + ')');
    check(res._body && res._body.ok === true, 'preview ok:true');
  }

  // CASE 3b — an invalid edit (weights != 100) is still rejected by server validation
  {
    const badNew = { ...NEW_DEF, totalRows: NEW_DEF.totalRows.map(r => r.id === 'r-cap-tren-giao' ? { ...r, weight: 20 } : r) };
    const { req, res } = fakeReqRes({ action: 'checklistRetroPreviewDiff', input: { oldDefinition: OLD_DEF, newDefinition: badNew } });
    await handler(req, res);
    check(res._body && Array.isArray(res._body.errors) && res._body.errors.length > 0, 'weight total 90% still rejected server-side (validations preserved)');
  }

  // CASE 4 — publish (copy version) reaches the retro RPC exactly once, not the legacy branch
  {
    rpcCalls.length = 0;
    const { req, res } = fakeReqRes({ action: 'checklistRetroCopyVersion', input: { templateKey: 'nv-ban-hang', sourceVersion: 'BH-1.0', newVersion: 'BH-1.1', effectiveDate: '2026-09-01', reason: 'BH 70/30 hiệu lực từ 09/2026', definition: NEW_DEF } });
    await handler(req, res);
    check(res._status === 200 && res._body && res._body.code !== 'EMPLOYEE_REQUIRED', 'checklistRetroCopyVersion → 200, not legacy EMPLOYEE_REQUIRED');
    check(rpcCalls.filter(c => c.name === 'phf_copy_checklist_template_version').length === 1, 'phf_copy_checklist_template_version RPC called once (got ' + rpcCalls.filter(c => c.name === 'phf_copy_checklist_template_version').length + ')');
  }

  // CASE 11/13 — dry-run apply routes to the retro RPC (idempotent engine), not legacy
  {
    rpcCalls.length = 0;
    const { req, res } = fakeReqRes({ action: 'checklistRetroDryRunApply', input: { batchId: '11111111-1111-4111-8111-111111111111', templateKey: 'nv-ban-hang', oldVersion: 'BH-1.0', newVersion: 'BH-1.1', periodMonthFrom: '2026-09', periodMonthTo: '2026-09', reason: 'preview impact' } });
    await handler(req, res);
    check(res._status === 200 && res._body && res._body.code !== 'EMPLOYEE_REQUIRED', 'checklistRetroDryRunApply → 200, not legacy');
    check(rpcCalls.some(c => c.name === 'phf_retroactive_apply_checklist_template'), 'dry-run reaches phf_retroactive_apply_checklist_template RPC');
  }

  console.log('\n' + passes + ' PASS' + (failures ? (' / ' + failures + ' FAIL') : ''));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
