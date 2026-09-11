'use strict';
/*
 * Regression test — Frontend-only fix: "Khóa kỳ" (monthlyLockModalHtml /
 * lockMonthlyPeriod trong assets/js/checklist/phf-checklist-app.js) không còn
 * chặn Admin khóa kỳ khi còn phiếu chưa hoàn tất (incomplete>0). Backend RPC
 * (lock_checklist_monthly_period) đã được duyệt cho phép việc này từ trước —
 * batch này CHỈ sửa UI, không đụng RPC/SQL/schema.
 *
 * Cùng convention "load real source trong vm sandbox, expose nội bộ qua
 * window.__phfckXTest" với scripts/test-checklist-monthly-department-filter-ui.js
 * — không mock module, không kết nối DB thật, chỉ test đúng hàm render/hành vi
 * thật của UI qua vm.
 *
 * File này KHÔNG được gọi tự động ở bất kỳ đâu — chỉ chạy thủ công:
 *   node scripts/test-checklist-monthly-lock-incomplete-ui-2026-09.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const filePath = 'assets/js/checklist/phf-checklist-app.js';
const originalSource = fs.readFileSync(path.join(root, filePath), 'utf8');

function buildTestSource() {
  const marker = '\n})();';
  const idx = originalSource.lastIndexOf(marker);
  if (idx === -1 || idx < originalSource.length - 20) {
    throw new Error('Không tìm thấy dấu đóng IIFE cuối file - cấu trúc file đã đổi, cần cập nhật test.');
  }
  const expose = "\n  checklistToast=function(){};\n  window.__phfckLockTest={monthlyUiState:monthlyUiState,monthlyLockModalHtml:monthlyLockModalHtml,lockMonthlyPeriod:lockMonthlyPeriod,monthlyPeriodValue:monthlyPeriodValue};\n";
  return originalSource.slice(0, idx) + expose + originalSource.slice(idx);
}

function buildSandbox() {
  const noop = function(){};
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.addEventListener = noop;
  sandbox.removeEventListener = noop;
  sandbox.dispatchEvent = noop;
  sandbox.PHF_BUILD_INFO = { version: 'test', fingerprint: 'test' };
  sandbox.document = {
    documentElement: { setAttribute: noop, getAttribute: function(){return null;} },
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: function(){return null;},
    querySelectorAll: function(){return [];},
    getElementById: function(){return null;},
    createElement: function(){return {style:{},setAttribute:noop,removeAttribute:noop,addEventListener:noop,removeEventListener:noop,classList:{add:noop,remove:noop,contains:function(){return false;}},querySelector:function(){return null;},querySelectorAll:function(){return [];},appendChild:noop,insertAdjacentHTML:noop,remove:noop,dataset:{}};},
    body: {classList:{add:noop,remove:noop},appendChild:noop},
    readyState: 'complete'
  };
  sandbox.location = { pathname: '/admin/checklist/phieu-danh-gia-thang', search: '', hash: '', origin: 'http://localhost' };
  sandbox.history = { pushState: noop, replaceState: noop, state: null };
  sandbox.localStorage = { getItem: function(){return null;}, setItem: noop, removeItem: noop };
  sandbox.navigator = { userAgent: 'node-test' };
  sandbox.matchMedia = null;
  sandbox.MutationObserver = function(){ return { observe: noop, disconnect: noop }; };
  sandbox.__fetchCalls = [];
  sandbox.fetch = function(url, opts) {
    sandbox.__fetchCalls.push({ url: url, opts: opts, body: opts && opts.body ? JSON.parse(opts.body) : null });
    return Promise.resolve({ ok: true, json: function(){ return Promise.resolve({ ok: true, locked: 1, forms: [], period: { status: 'locked' } }); } });
  };
  sandbox.URL = URL;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.requestAnimationFrame = function(fn){ return setTimeout(fn,0); };
  sandbox.CSS = { escape: function(v){ return String(v); } };
  sandbox.__phfLocalData = null;
  return vm.createContext(sandbox);
}

const ctx = buildSandbox();
new vm.Script(buildTestSource(), { filename: filePath }).runInContext(ctx);
const api = ctx.window.__phfckLockTest;

let failures = 0, passes = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else { passes++; console.log('PASS: ' + message); }
}
function tick(n) { return new Promise(resolve => setTimeout(resolve, n || 20)); }

function makeForm(code, status) {
  return { id: 'f-' + code, employee_code: code, employee_name: code, status: status };
}
function resetState(overrides) {
  api.monthlyUiState.forms = [];
  api.monthlyUiState.locking = false;
  api.monthlyUiState.month = '2026-08';
  Object.assign(api.monthlyUiState, overrides || {});
}
function makeFakeRoot(reasonValue) {
  const modal = {
    className: 'phfck-monthly-open-modal',
    querySelector: function(sel) {
      if (sel === '[data-phfck-lock-reason]') return { value: reasonValue == null ? '' : reasonValue };
      return null;
    }
  };
  const workspace = { innerHTML: '' };
  return {
    querySelector: function(sel) {
      if (sel === '.phfck-monthly-open-modal') return modal;
      if (sel === '[data-phfck-workspace]') return workspace;
      return null;
    },
    __workspace: workspace
  };
}

// ================= 1. incomplete>0: không còn chặn, hiển thị cảnh báo mới, nút không disabled =================
resetState({ forms: [makeForm('PHF001', 'waiting_self'), makeForm('PHF002', 'waiting_review'), makeForm('PHF003', 'reviewed')] });
let html = api.monthlyLockModalHtml();
check(html.indexOf('Chưa thể khóa kỳ') === -1, '1a. Không còn text chặn cứng "Chưa thể khóa kỳ" khi incomplete>0');
check(html.indexOf('Cần hoàn tất thẩm định toàn bộ phiếu trước') === -1, '1b. Không còn text "Cần hoàn tất thẩm định toàn bộ phiếu trước..."');
check(html.indexOf('còn 2 phiếu chưa hoàn tất') >= 0, '1c. Cảnh báo mới hiển thị đúng số phiếu chưa hoàn tất (2/3)');
check(html.indexOf('Khóa kỳ sẽ dừng toàn bộ thao tác tự đánh giá/thẩm định tiếp theo, nhưng không làm mất dữ liệu đã có.') >= 0, '1d. Đúng nội dung cảnh báo canonical');
check(/data-phfck-monthly-lock-confirm\s*>/.test(html), '1e. Nút "Xác nhận khóa kỳ" KHÔNG có thuộc tính disabled khi incomplete>0 (chỉ còn khoảng trắng, không có "disabled")');
check(html.indexOf('Xác nhận khóa kỳ') >= 0, '1f. Label nút vẫn là "Xác nhận khóa kỳ" (không phải "Đang khóa…") khi không loading');

// ================= 2. incomplete=0: giữ nguyên notice cũ (đủ điều kiện / khóa sớm), không đổi hành vi =================
resetState({ forms: [makeForm('PHF003', 'reviewed'), makeForm('PHF004', 'reviewed')] });
html = api.monthlyLockModalHtml();
check(html.indexOf('Đủ điều kiện khóa kỳ') >= 0 || html.indexOf('Đang khóa sớm theo quyền Admin') >= 0, '2a. incomplete=0 vẫn hiển thị đúng 1 trong 2 notice hiện hữu (không đổi khi không còn phiếu dở dang)');
check(/data-phfck-monthly-lock-confirm\s*>/.test(html), '2b. Nút không disabled khi incomplete=0 (hành vi cũ giữ nguyên)');

// ================= 3. Khi đang locking: nút disabled + label "Đang khóa…", bất kể incomplete =================
resetState({ forms: [makeForm('PHF001', 'waiting_self')], locking: true });
html = api.monthlyLockModalHtml();
check(html.indexOf('data-phfck-monthly-lock-confirm disabled') >= 0, '3a. Nút disabled khi đang trong quá trình khóa (locking=true), không liên quan tới incomplete');
check(html.indexOf('Đang khóa…') >= 0, '3b. Label đổi thành "Đang khóa…" khi locking=true');

// ================= 4. reason<10 ký tự vẫn chặn (giữ nguyên reason validation) =================
(async () => {
  resetState({ forms: [makeForm('PHF001', 'waiting_self')] });
  const fakeRoot = makeFakeRoot('ngắn quá');
  ctx.window.__fetchCalls.length = 0;
  await api.lockMonthlyPeriod(fakeRoot);
  await tick();
  check(ctx.window.__fetchCalls.length === 0, '4. reason < 10 ký tự: KHÔNG gọi fetch (vẫn chặn ở tầng JS như cũ, không liên quan gì tới việc bỏ chặn incomplete)');
  check(api.monthlyUiState.locking === false, '4b. monthlyUiState.locking không bị kẹt true khi reason không hợp lệ');

  // ================= 5. reason>=10 ký tự + incomplete>0: PHẢI gọi được lock (đây là thay đổi chính) =================
  resetState({ forms: [makeForm('PHF001', 'waiting_self'), makeForm('PHF002', 'waiting_review')], month: '2026-08' });
  const fakeRoot2 = makeFakeRoot('Chốt kỳ theo quyết định Admin dù còn phiếu dở dang');
  ctx.window.__fetchCalls.length = 0;
  await api.lockMonthlyPeriod(fakeRoot2);
  await tick();
  check(ctx.window.__fetchCalls.length >= 1, '5a. reason hợp lệ + incomplete>0: fetch ĐƯỢC gọi (trước đây UI chặn không cho tới bước này) — got ' + ctx.window.__fetchCalls.length + ' call(s) (lock + loadMonthly refresh)');
  const body5 = ctx.window.__fetchCalls[0] && ctx.window.__fetchCalls[0].body;
  check(body5 && body5.action === 'lockChecklistMonthly', '5b. action đúng = lockChecklistMonthly');
  check(body5 && body5.month === '2026-08', '5c. month đúng = 2026-08');
  check(body5 && typeof body5.force === 'boolean', '5d. field force vẫn được gửi (p_force logic không bị đụng)');
  check(api.monthlyUiState.locking === false, '5e. locking trở về false sau khi hoàn tất (không kẹt loading)');

  // ================= 6. complete period (incomplete=0) vẫn khóa được như cũ =================
  resetState({ forms: [makeForm('PHF003', 'reviewed')], month: '2026-08' });
  const fakeRoot3 = makeFakeRoot('Chốt kỳ khi đã thẩm định xong toàn bộ phiếu');
  ctx.window.__fetchCalls.length = 0;
  await api.lockMonthlyPeriod(fakeRoot3);
  await tick();
  check(ctx.window.__fetchCalls.length >= 1, '6. incomplete=0 vẫn gọi lock bình thường (regression check, không đổi hành vi cũ)');

  // ================= 7. p_force/early-lock: force=true khi kỳ ở tương lai xa, force=false khi đã qua ngày khóa thường =================
  resetState({ forms: [makeForm('PHF001', 'waiting_self')], month: '2099-01' }); // rất xa tương lai -> chắc chắn early=true
  const fakeRoot4 = makeFakeRoot('Chốt sớm kỳ tương lai theo quyền Admin');
  ctx.window.__fetchCalls.length = 0;
  await api.lockMonthlyPeriod(fakeRoot4);
  await tick();
  const body7a = ctx.window.__fetchCalls[0] && ctx.window.__fetchCalls[0].body;
  check(body7a && body7a.force === true, '7a. Kỳ tương lai xa (chưa tới ngày khóa thường) -> force=true, không bị ảnh hưởng bởi việc bỏ chặn incomplete');

  resetState({ forms: [makeForm('PHF003', 'reviewed')], month: '2020-01' }); // rất xa quá khứ -> chắc chắn early=false
  const fakeRoot5 = makeFakeRoot('Chốt kỳ quá khứ đã qua hạn khóa thường từ lâu');
  ctx.window.__fetchCalls.length = 0;
  await api.lockMonthlyPeriod(fakeRoot5);
  await tick();
  const body7b = ctx.window.__fetchCalls[0] && ctx.window.__fetchCalls[0].body;
  check(body7b && body7b.force === false, '7b. Kỳ quá khứ xa (đã qua ngày khóa thường) -> force=false, đúng behavior cũ');

  console.log('\n' + passes + ' passed, ' + failures + ' failed.');
  process.exitCode = failures ? 1 : 0;
})();
