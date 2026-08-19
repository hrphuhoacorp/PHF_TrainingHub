'use strict';
/*
 * T08 Transition Import (2026-08-19) — Real-route JSDOM UI test:
 * /admin/checklist/cai-dat -> tab "Nhập điểm chuyển tiếp T08" -> upload CSV
 * -> xem trước -> xác nhận. Cùng kỹ thuật với scripts/test-checklist-annual-
 * result-ui-2026-08.js (window.eval code thật + click/change DOM thật).
 *
 * Chạy: node scripts/test-checklist-transition-import-ui-2026-08.js
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

const PREVIEW_PAYLOAD = {
  ok: true, batchId: 'batch-1', total: 3,
  counts: { READY: 1, SKIP_LT_NQ_LIVE: 1, SKIP_NOT_CURRENT_EMPLOYEE: 0, SKIP_INACTIVE: 0, MISSING_CODE: 0, INVALID_SCORE: 0, NEED_REVIEW: 0, DUPLICATE: 0, CONFLICT_SYSTEM_LIVE: 0, CONFLICT: 1 },
  rows: [
    { employeeCode: 'PHF040', employeeName: 'Nguyễn Văn Bốn Mươi', periodMonth: '2026-08', status: 'READY', reason: 'Hợp lệ, sẵn sàng nhập.', resultState: 'SCORED', score: 88 },
    { employeeCode: 'PHF010', employeeName: 'Lê Văn Lái Thiêu', periodMonth: '2026-08', status: 'SKIP_LT_NQ_LIVE', reason: 'Chi nhánh "Lái Thiêu" đang vận hành Checklist live chính thức.' },
    { employeeCode: 'PHF050', employeeName: 'Trần Thị Năm Mươi', periodMonth: '2026-08', status: 'CONFLICT', reason: 'Đã có kết quả authoritative khác nguồn (MANUAL_IMPORT).' }
  ]
};
const CONFIRM_PAYLOAD = { ok: true, batchId: 'batch-1', source: 'TRANSITION_IMPORT', inserted: 1, rows: [{ id: 'r1', employee_code: 'PHF040', period_month: '2026-08', result_state: 'SCORED', score: 88, source: 'TRANSITION_IMPORT' }] };

(async () => {
  const dom = await buildDom('/admin/checklist/cai-dat');
  const { window } = dom;
  const calls = [];
  window.fetch = async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : {};
    calls.push(body);
    if (body.action === 'previewChecklistTransitionImport') return response(PREVIEW_PAYLOAD);
    if (body.action === 'confirmChecklistTransitionImport') return response(CONFIRM_PAYLOAD);
    return response({ ok: true });
  };

  await window.phfRenderChecklist('/admin/checklist/cai-dat');
  await tick();
  const root = window.document.getElementById('phfChecklistRoot');

  const tabBtn = [...root.querySelectorAll('[data-phfck-settings-tab]')].find(b => b.getAttribute('data-phfck-settings-tab') === 'transitionImport');
  check(!!tabBtn, 'Tab "Nhập điểm chuyển tiếp T08" tồn tại trong Cài đặt (Admin-only)');
  tabBtn.click();
  await tick();

  check(root.innerHTML.includes('Lái Thiêu') && root.innerHTML.includes('Ngô Quyền'), 'Nội dung giải thích LT/NQ hiển thị rõ ràng, tiếng Việt');
  const fileInput = root.querySelector('[data-phfck-transition-file]');
  check(!!fileInput, 'Có input chọn file upload');

  // ---- Simulate CSV upload (File qua defineProperty trên .files - JSDOM không hỗ trợ DataTransfer construction) ----
  const csvContent = 'Mã nhân viên,Họ tên,Điểm T08\nPHF040,Nguyễn Văn Bốn Mươi,88\n';
  let uploadOk = true;
  try {
    const file = new window.File([csvContent], 'transition.csv', { type: 'text/csv' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick(50);
  } catch (e) { uploadOk = false; console.error('upload simulation error', e && e.message); }
  check(uploadOk, 'Mô phỏng chọn file CSV không lỗi (File qua defineProperty)');

  if (uploadOk) {
    check(root.innerHTML.includes('transition.csv'), 'Tên file đã chọn hiển thị sau upload');
    const previewBtn = root.querySelector('[data-phfck-transition-preview]');
    check(!!previewBtn && !previewBtn.disabled, 'Nút "Xem trước" bật sau khi có dữ liệu file');
    previewBtn.click();
    await tick(50);

    const previewCall = calls.find(c => c.action === 'previewChecklistTransitionImport');
    check(!!previewCall, 'Đã gọi action previewChecklistTransitionImport');
    check(Array.isArray(previewCall.rows) && previewCall.rows[0].employeeCode === 'PHF040', 'Payload preview đúng shape (employeeCode từ file)');

    check(root.innerHTML.includes('Sẵn sàng nhập'), 'Tổng hợp hiển thị "Sẵn sàng nhập" (không lộ enum READY)');
    check(root.innerHTML.includes('Bỏ qua chi nhánh live'), 'Tổng hợp hiển thị nhãn tiếng Việt cho SKIP_LT_NQ_LIVE (không lộ enum)');
    check(!/\bREADY\b/.test(root.innerHTML) && !/SKIP_LT_NQ_LIVE/.test(root.innerHTML) && !/CONFLICT_SYSTEM_LIVE/.test(root.innerHTML), 'Không lộ enum kỹ thuật (READY/SKIP_LT_NQ_LIVE/CONFLICT_SYSTEM_LIVE) ra HTML hiển thị');
    check(root.innerHTML.includes('Lái Thiêu') && root.innerHTML.includes('đang vận hành Checklist live'), 'Dòng ngoại lệ hiển thị lý do rõ ràng bằng tiếng Việt');

    const confirmBtn = root.querySelector('[data-phfck-transition-confirm]');
    check(!!confirmBtn && !confirmBtn.disabled, 'Nút "Xác nhận nhập" bật khi có ít nhất 1 dòng READY');

    // window.phfckConfirm mở modal xác nhận riêng - click "Xác nhận" trong modal đó trước, rồi mới gọi confirm thật.
    confirmBtn.click();
    await tick(30);
    const decisionConfirmBtn = root.querySelector('[data-phfck-decision-confirm]') || [...root.querySelectorAll('button')].find(b => /Xác nhận nhập/.test(b.textContent) && b !== confirmBtn);
    if (decisionConfirmBtn) { decisionConfirmBtn.click(); await tick(50); }

    const confirmCall = calls.find(c => c.action === 'confirmChecklistTransitionImport');
    check(!!confirmCall, 'Đã gọi action confirmChecklistTransitionImport sau khi xác nhận modal');
    if (confirmCall) {
      check(confirmCall.batchId === 'batch-1', 'confirm gửi đúng batchId từ preview trước đó (liên kết audit)');
      await tick(30);
      check(root.innerHTML.includes('Đã nhập thành công'), 'Hiển thị thông báo thành công sau khi confirm');
    }
  }

  console.log('\n' + passes + ' passed, ' + failures + ' failed.');
  process.exitCode = failures ? 1 : 0;
})().catch(e => { console.error('FATAL', e && e.stack || e); process.exitCode = 1; });
