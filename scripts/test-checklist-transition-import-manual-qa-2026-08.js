'use strict';
/*
 * T08 Transition Import — LOCAL MANUAL QA (2026-08-19), scripted via JSDOM to
 * be reproducible (không có trình duyệt thật trong môi trường này). Đi qua
 * đúng luồng người dùng thật: mở Cài đặt -> tab -> upload -> Xem trước ->
 * kiểm tra tổng hợp/ngoại lệ/không lộ enum -> modal Xác nhận XUẤT HIỆN.
 * DỪNG LẠI Ở ĐÓ - không bấm nút xác nhận trong modal, không gọi
 * confirmChecklistTransitionImport (dù chỉ là mock, tuân thủ đúng yêu cầu QA
 * "DO NOT execute real Production confirm/import").
 *
 * Chạy: node scripts/test-checklist-transition-import-manual-qa-2026-08.js
 */
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

// Bao phủ đủ các case QA yêu cầu: Phú Lợi READY (score 0 thật + score thường +
// NO_ASSESSMENT + PROBATION + blank/NO_DATA đều là READY vì backend đã phân loại
// hợp lệ), LT/NQ bị loại, inactive, not-found.
const PREVIEW_PAYLOAD = {
  ok: true, batchId: 'qa-batch-1', total: 8,
  counts: { READY: 5, SKIP_LT_NQ_LIVE: 2, SKIP_NOT_CURRENT_EMPLOYEE: 1, SKIP_INACTIVE: 1, MISSING_CODE: 0, INVALID_SCORE: 0, NEED_REVIEW: 0, DUPLICATE: 0, CONFLICT_SYSTEM_LIVE: 0, CONFLICT: 0 },
  rows: [
    { employeeCode: 'PHF040', employeeName: 'Đỗ Văn Bốn Mươi', periodMonth: '2026-08', status: 'READY', resultState: 'SCORED', score: 92 },
    { employeeCode: 'PHF041', employeeName: 'Trần Thị Bốn Mốt', periodMonth: '2026-08', status: 'READY', resultState: 'SCORED', score: 0 },
    { employeeCode: 'PHF042', employeeName: 'Lê Văn Bốn Hai', periodMonth: '2026-08', status: 'READY', resultState: 'NO_ASSESSMENT', score: null },
    { employeeCode: 'PHF043', employeeName: 'Phạm Thị Bốn Ba', periodMonth: '2026-08', status: 'READY', resultState: 'PROBATION', score: null },
    { employeeCode: 'PHF044', employeeName: 'Võ Văn Bốn Tư', periodMonth: '2026-08', status: 'READY', resultState: 'NO_DATA', score: null },
    { employeeCode: 'PHF010', employeeName: 'Lê Văn Lái Thiêu', periodMonth: '2026-08', status: 'SKIP_LT_NQ_LIVE', reason: 'Chi nhánh "Lái Thiêu" đang vận hành Checklist live chính thức trong kỳ chuyển tiếp - không nhập tay đè lên kết quả live.' },
    { employeeCode: 'PHF020', employeeName: 'Phạm Thị Ngô Quyền', periodMonth: '2026-08', status: 'SKIP_LT_NQ_LIVE', reason: 'Chi nhánh "Ngô Quyền" đang vận hành Checklist live chính thức trong kỳ chuyển tiếp - không nhập tay đè lên kết quả live.' },
    { employeeCode: 'PHF999', employeeName: 'Không rõ', periodMonth: '2026-08', status: 'SKIP_NOT_CURRENT_EMPLOYEE', reason: 'Mã "PHF999" không tồn tại trong employee_profiles hiện tại - không tạo/khôi phục nhân sự.' },
    { employeeCode: 'PHF002', employeeName: 'Trần Thị B', periodMonth: '2026-08', status: 'SKIP_INACTIVE', reason: 'Nhân sự "PHF002" tồn tại nhưng employment_status không phải active.' }
  ]
};

(async () => {
  console.log('=== T08 Transition Import — Local Manual QA (JSDOM, không chạm Production) ===\n');
  const dom = await buildDom('/admin/checklist/cai-dat');
  const { window } = dom;
  const calls = [];
  window.fetch = async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : {};
    calls.push(body);
    if (body.action === 'previewChecklistTransitionImport') return response(PREVIEW_PAYLOAD);
    if (body.action === 'confirmChecklistTransitionImport') { throw new Error('QA VIOLATION: confirm action được gọi - không được phép trong bước QA này.'); }
    return response({ ok: true });
  };

  await window.phfRenderChecklist('/admin/checklist/cai-dat');
  await tick();
  const root = window.document.getElementById('phfChecklistRoot');

  // ---- Admin-only tab visible ----
  const tabBtn = [...root.querySelectorAll('[data-phfck-settings-tab]')].find(b => b.getAttribute('data-phfck-settings-tab') === 'transitionImport');
  check(!!tabBtn, 'QA1: Tab "Nhập điểm chuyển tiếp T08" hiển thị (Admin-only, canManageChecklistCore)');
  tabBtn.click();
  await tick();

  // ---- File picker accepts .xlsx/.xls/.csv ----
  const fileInput = root.querySelector('[data-phfck-transition-file]');
  check(!!fileInput, 'QA2: Có input chọn file');
  const accept = fileInput && fileInput.getAttribute('accept');
  check(accept === '.xlsx,.xls,.csv', 'QA2: File picker chấp nhận đúng .xlsx,.xls,.csv, thực tế=' + accept);

  // ---- Simulate CSV upload ----
  const csvContent = 'Mã nhân viên,Họ tên,Điểm T08\nPHF040,Đỗ Văn Bốn Mươi,92\nPHF041,Trần Thị Bốn Mốt,0\nPHF042,Lê Văn Bốn Hai,không đánh giá\nPHF043,Phạm Thị Bốn Ba,thử việc\nPHF044,Võ Văn Bốn Tư,\nPHF010,Lê Văn Lái Thiêu,85\nPHF020,Phạm Thị Ngô Quyền,85\nPHF999,Không rõ,70\nPHF002,Trần Thị B,77\n';
  const file = new window.File([csvContent], 'qa_transition_t08.csv', { type: 'text/csv' });
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
  fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(50);
  check(root.innerHTML.includes('qa_transition_t08.csv'), 'QA2: Tên file hiển thị sau khi chọn (9 dòng)');

  // ---- Preview ----
  const previewBtn = root.querySelector('[data-phfck-transition-preview]');
  check(!!previewBtn && !previewBtn.disabled, 'QA3: Nút "Xem trước" bật');
  previewBtn.click();
  await tick(50);
  const previewCall = calls.find(c => c.action === 'previewChecklistTransitionImport');
  check(!!previewCall && previewCall.rows.length === 9, 'QA3: Đã gửi đúng 9 dòng đã parse tới previewChecklistTransitionImport');

  // ---- Summary counts render Vietnamese ----
  const html = root.innerHTML;
  check(/Sẵn sàng nhập[\s\S]{0,40}5/.test(html) || html.includes('Sẵn sàng nhập'), 'QA5: Tổng hợp có "Sẵn sàng nhập" (tiếng Việt)');
  check(html.includes('Bỏ qua chi nhánh live'), 'QA5: Tổng hợp có nhãn "Bỏ qua chi nhánh live (LT/NQ)"');
  check(html.includes('Không còn trong hệ thống'), 'QA5: Tổng hợp có nhãn "Không còn trong hệ thống"');
  check(html.includes('Không hoạt động'), 'QA5: Tổng hợp có nhãn "Không hoạt động"');

  // ---- LT/NQ rows classified as excluded, shown in exceptions table with reason ----
  check(html.includes('Lái Thiêu') && html.includes('đang vận hành Checklist live'), 'QA6: Dòng Lái Thiêu xuất hiện trong bảng ngoại lệ với lý do rõ ràng');
  check(html.includes('Ngô Quyền') && (html.match(/đang vận hành Checklist live/g) || []).length >= 2, 'QA6: Dòng Ngô Quyền cũng bị loại tương tự (2 lần xuất hiện lý do)');

  // ---- inactive/not-found handled ----
  check(html.includes('Không rõ') && html.includes('không tồn tại trong employee_profiles'), 'QA: Dòng not-found (PHF999) hiển thị đúng lý do');
  check(html.includes('không phải active'), 'QA: Dòng inactive (PHF002) hiển thị đúng lý do');

  // ---- no raw enums leaked ----
  const leaks = ['SKIP_LT_NQ_LIVE', 'SKIP_NOT_CURRENT_EMPLOYEE', 'SKIP_INACTIVE', 'CONFLICT_SYSTEM_LIVE', 'SCORED', 'NO_ASSESSMENT', 'PROBATION', 'NO_DATA'];
  leaks.forEach(code2 => check(!new RegExp('\\b' + code2 + '\\b').test(html), 'QA: Không lộ enum kỹ thuật "' + code2 + '" ra HTML'));

  // ---- Confirm button + modal appears, but DO NOT proceed ----
  const confirmBtn = root.querySelector('[data-phfck-transition-confirm]');
  check(!!confirmBtn && !confirmBtn.disabled, 'QA: Nút "Xác nhận nhập" bật (có 5 dòng READY)');
  check(/Xác nhận nhập \(5 dòng\)/.test(confirmBtn.textContent), 'QA: Nút hiển thị đúng số dòng sẽ ghi (5), thực tế="' + confirmBtn.textContent + '"');
  confirmBtn.click();
  await tick(30);
  const modalVisible = !!root.querySelector('[data-phfck-decision-modal],.phfck-modal-layer') || /Xác nhận nhập điểm chuyển tiếp T08/.test(root.innerHTML);
  check(modalVisible, 'QA: Modal xác nhận XUẤT HIỆN sau khi bấm "Xác nhận nhập"');
  check(!calls.some(c => c.action === 'confirmChecklistTransitionImport'), 'QA GUARD: confirmChecklistTransitionImport CHƯA được gọi (dừng đúng ở bước modal xuất hiện, không tiến hành xác nhận thật)');

  console.log('\n' + passes + ' passed, ' + failures + ' failed.');
  process.exitCode = failures ? 1 : 0;
})().catch(e => { console.error('FATAL', e && e.stack || e); process.exitCode = 1; });
