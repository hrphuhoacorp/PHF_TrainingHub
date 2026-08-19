'use strict';
/*
 * Production bug fix (2026-08-19, bundled with T08 Transition Import batch) —
 * checklistScoreUiState.annual* fields (annualYear/annualDepartment/
 * annualBranch/annualQuery/annualLoading/annualLoadedKey/annualError/
 * annualData) và var checklistScoreAnnualSearchTimer chưa từng được COMMIT
 * dù đã có trong logic Annual Report đang sống trên Production - gõ vào ô
 * tìm kiếm "Cả năm" ném ReferenceError (checklistScoreAnnualSearchTimer is
 * not defined) ngay từ ký tự đầu tiên, khiến debounce reload không bao giờ
 * chạy. KHÔNG phải bug logic mới - chỉ là hoàn tất commit phần state đã có
 * sẵn trong code (không đổi hành vi nghiệp vụ Annual Report).
 *
 * Chạy: node scripts/test-checklist-annual-search-debounce-fix-2026-08.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const appPath = path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js');
const cssPath = path.resolve(__dirname, '..', 'assets/css/phf-checklist.css');
const code = fs.readFileSync(appPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

let failures = 0, passes = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else { passes++; console.log('PASS: ' + message); }
}
function tick(n) { return new Promise(resolve => setTimeout(resolve, n || 30)); }
function response(data) { return { ok: true, status: 200, json: async () => data }; }

const ANNUAL_PAYLOAD = { ok: true, year: '2026', periods: ['2026-01'], employees: [{ employeeCode: 'PHF060', employeeName: 'Nguyễn Thiên Trúc', department: 'Bán hàng', branch: 'Phú Lợi', periods: { '2026-01': { hasResult: true, resultState: 'SCORED', score: 90 } }, average: 90, scoredMonthCount: 1 }], scope: { role: 'admin', grant: null, count: 1 }, generatedAt: '2026-08-19T00:00:00.000Z', generatedBy: 'Admin' };

async function buildDom(startPath) {
  const dom = new JSDOM(
    '<!doctype html><html><head><style>' + css + '</style></head><body><div id="phfChecklistRoot"></div></body></html>',
    { url: 'http://localhost' + startPath, runScripts: 'outside-only' }
  );
  const { window } = dom;
  window.phfGetSessionRole = () => 'admin';
  window.phfGetCurrentUser = () => ({ id: 'admin-1', employeeCode: 'PHF000', name: 'Admin' });
  window.phfGetAuthenticatedUser = window.phfGetCurrentUser;
  window.requestAnimationFrame = fn => setTimeout(fn, 0);
  window.requestIdleCallback = fn => setTimeout(fn, 0);
  window.scrollTo = () => {};
  window.__phfLocalData = { checklistTemplates: [], checklistTemplatesReady: true, checklistTemplatesError: '' };
  window.fetch = async () => response({ ok: true });
  window.eval(code);
  return dom;
}

(async () => {
  const dom = await buildDom('/admin/checklist/bao-cao');
  const { window } = dom;
  const errors = [];
  window.addEventListener('error', e => errors.push(e.error || e.message));

  const calls = [];
  window.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body); calls.push(body);
    if (body.action === 'getChecklistAnnualResultReport') return response(ANNUAL_PAYLOAD);
    return response({ ok: true });
  };

  await window.phfRenderChecklist('/admin/checklist/bao-cao');
  await tick();
  const root = window.document.getElementById('phfChecklistRoot');

  [...root.querySelectorAll('[data-phfck-report-view]')].find(b => b.getAttribute('data-phfck-report-view') === 'checklist-score').click();
  await tick();
  [...root.querySelectorAll('[data-phfck-score-mode]')].find(b => b.getAttribute('data-phfck-score-mode') === 'annual').click();
  await tick(50);

  const searchInput = root.querySelector('[data-phfck-score-annual-search]');
  check(!!searchInput, 'Ô tìm kiếm "Cả năm" tồn tại trong DOM');

  // ---- Gõ vào ô tìm kiếm KHÔNG được ném lỗi ----
  let typeError = null;
  try {
    searchInput.value = 'Trúc';
    searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    await tick(10);
  } catch (e) { typeError = e; }
  check(!typeError, 'Gõ vào ô tìm kiếm Cả năm KHÔNG ném lỗi đồng bộ, thực tế=' + (typeError && typeError.message));
  check(errors.length === 0, '1. Không có ReferenceError nào bị bắt qua window.onerror khi gõ tìm kiếm, thực tế=' + errors.map(e => e && e.message || e).join('; '));

  const callsAfterType = calls.filter(c => c.action === 'getChecklistAnnualResultReport').length;

  // ---- Debounce 400ms rồi phải tự reload với query mới ----
  await tick(450);
  check(errors.length === 0, 'Không phát sinh lỗi trong lúc chờ debounce');
  const callsAfterDebounce = calls.filter(c => c.action === 'getChecklistAnnualResultReport').length;
  check(callsAfterDebounce > callsAfterType, '2. Debounce reload ĐÃ chạy sau 400ms - gọi lại getChecklistAnnualResultReport, số lần trước=' + callsAfterType + ' sau=' + callsAfterDebounce);
  const lastCall = calls.filter(c => c.action === 'getChecklistAnnualResultReport').pop();
  check(lastCall && lastCall.query === 'Trúc', 'Request reload mang đúng query đã gõ ("Trúc"), thực tế=' + (lastCall && lastCall.query));

  console.log('\n' + passes + ' passed, ' + failures + ' failed.');
  process.exitCode = failures ? 1 : 0;
})().catch(e => { console.error('FATAL', e && e.stack || e); process.exitCode = 1; });
