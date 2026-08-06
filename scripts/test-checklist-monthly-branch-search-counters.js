'use strict';
/* Regression test for the "Phiếu đánh giá tháng" (Admin Checklist) status-tab
   and summary-card counters (build 1.42.3 / 1423-monthly-branch-search-scoped-counters).

   Bug: monthlyStatusTabsHtml() and the summary cards in monthlyHtml() used to
   count from the FULL, unfiltered monthlyUiState.forms — so picking a branch
   (e.g. "Ngô Quyền") in the toolbar left "Tất cả" and every status chip still
   showing whole-kỳ totals instead of the branch-scoped count. Fix: both now go
   through the shared monthlyBranchSearchForms() (filters branch+search, NOT
   status), and monthlyFilteredForms() reuses the same helper before applying
   the status filter on top.

   No jsdom in this repo — same convention as
   scripts/test-checklist-template-hydration-race.js: load the real
   assets/js/checklist/phf-checklist-app.js in a vm sandbox. That file has no
   module exports (one giant IIFE), so this test injects a single exposure
   line right before the trailing "})();" of an IN-MEMORY COPY of the source
   string only (nothing is ever written back to the real file) to reach
   monthlyUiState/monthlyBranchSearchForms/monthlyStatusTabsHtml/monthlyFilteredForms
   for direct, functional assertions instead of source-text pattern matching.

   File này KHÔNG được gọi tự động ở bất kỳ đâu - chỉ chạy thủ công:
     node scripts/test-checklist-monthly-branch-search-counters.js
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const filePath = 'assets/js/checklist/phf-checklist-app.js';
const originalSource = fs.readFileSync(path.join(root, filePath), 'utf8');

function buildTestSource() {
  const marker = '\n})();';
  const idx = originalSource.lastIndexOf(marker);
  if (idx === -1 || idx < originalSource.length - 20) {
    throw new Error('Không tìm thấy dấu đóng IIFE cuối file - cấu trúc file đã đổi, cần cập nhật test.');
  }
  const expose = "\n  window.__phfckMonthlyTest={monthlyUiState:monthlyUiState,monthlyBranchSearchForms:monthlyBranchSearchForms,monthlyStatusTabsHtml:monthlyStatusTabsHtml,monthlyFilteredForms:monthlyFilteredForms};\n";
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
    createElement: function(){return {style:{},setAttribute:noop,addEventListener:noop,classList:{add:noop,remove:noop}};},
    body: {classList:{add:noop,remove:noop}},
    readyState: 'complete'
  };
  sandbox.location = { pathname: '/admin/checklist', search: '', hash: '', origin: 'http://localhost' };
  sandbox.history = { pushState: noop, replaceState: noop, state: null };
  sandbox.localStorage = { getItem: function(){return null;}, setItem: noop, removeItem: noop };
  sandbox.navigator = { userAgent: 'node-test' };
  sandbox.matchMedia = null;
  sandbox.MutationObserver = function(){ return { observe: noop, disconnect: noop }; };
  sandbox.fetch = function(){ return Promise.resolve({ ok:true, json: function(){ return Promise.resolve({}); } }); };
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
const api = ctx.window.__phfckMonthlyTest;

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}

// ---------- Synthetic kỳ 08/2026: 6 forms, 2 chi nhánh, đủ 5 trạng thái phân biệt ----------
const SYNTHETIC_FORMS = [
  { id: 'NQ1', employee_code: 'T1', employee_name: 'Nguyễn Văn A', department: 'Bộ phận bán hàng', title: 'Nhân viên', branch: 'Ngô Quyền', status: 'draft' },
  { id: 'NQ2', employee_code: 'T2', employee_name: 'Nguyễn Văn B', department: 'Bộ phận bán hàng', title: 'Nhân viên', branch: 'Ngô Quyền', status: 'waiting_self' },
  { id: 'NQ3', employee_code: 'T3', employee_name: 'Nguyễn Văn C', department: 'Bộ phận bán hàng', title: 'Nhân viên', branch: 'Ngô Quyền', status: 'waiting_review' },
  { id: 'LT1', employee_code: 'T4', employee_name: 'Trần Văn D', department: 'Bộ phận bán hàng', title: 'Nhân viên', branch: 'Lái Thiêu', status: 'waiting_self' },
  { id: 'LT2', employee_code: 'T5', employee_name: 'Trần Văn E', department: 'Bộ phận bán hàng', title: 'Nhân viên', branch: 'Lái Thiêu', status: 'reviewed' },
  { id: 'LT3', employee_code: 'T6', employee_name: 'Trần Văn F', department: 'Bộ phận bán hàng', title: 'Nhân viên', branch: 'Lái Thiêu', status: 'locked' }
];

function resetState(overrides) {
  api.monthlyUiState.forms = SYNTHETIC_FORMS.slice();
  api.monthlyUiState.branch = '';
  api.monthlyUiState.status = 'all';
  api.monthlyUiState.query = '';
  Object.assign(api.monthlyUiState, overrides || {});
}

function tabCounts(html) {
  // Order in monthlyStatusTabsHtml(): all, draft, self, review, reviewed, locked
  return (html.match(/<b>(\d+)<\/b>/g) || []).map(function(s){ return Number(s.replace(/[^0-9]/g, '')); });
}
function activeTab(html) {
  const m = html.match(/data-phfck-monthly-status="([a-z]+)"[^>]*>\s*<span>[^<]*<\/span>\s*<b>\d+<\/b>\s*<\/button>/);
  // Simpler: find which button has class "active"
  const active = html.match(/class="active" data-phfck-monthly-status="([a-z]+)"/);
  return active ? active[1] : null;
}

// ---------- A. Toàn kỳ (không lọc chi nhánh/search) hiển thị tổng toàn kỳ ----------
resetState();
let scoped = api.monthlyBranchSearchForms();
check(scoped.length === 6, 'A1. Không lọc branch/search: monthlyBranchSearchForms() trả đủ 6/6 form toàn kỳ');
let tabsHtml = api.monthlyStatusTabsHtml();
check(JSON.stringify(tabCounts(tabsHtml)) === JSON.stringify([6,1,2,1,1,1]),
  'A2. Toàn kỳ: chip Tất cả/Nháp/Chờ tự đánh giá/Chờ thẩm định/Đã thẩm định/Đã khóa = 6/1/2/1/1/1, got ' + tabCounts(tabsHtml).join('/'));

// ---------- B. Chọn chi nhánh Ngô Quyền -> counter CHỈ tính Ngô Quyền ----------
resetState({ branch: 'Ngô Quyền' });
scoped = api.monthlyBranchSearchForms();
check(scoped.length === 3 && scoped.every(function(x){ return x.branch === 'Ngô Quyền'; }),
  'B1. branch=Ngô Quyền: monthlyBranchSearchForms() trả đúng 3 form, toàn bộ thuộc Ngô Quyền');
tabsHtml = api.monthlyStatusTabsHtml();
check(JSON.stringify(tabCounts(tabsHtml)) === JSON.stringify([3,1,1,1,0,0]),
  'B2. branch=Ngô Quyền: chip Tất cả/Nháp/Chờ tự đánh giá/Chờ thẩm định/Đã thẩm định/Đã khóa = 3/1/1/1/0/0 (KHÔNG còn lẫn số của Lái Thiêu), got ' + tabCounts(tabsHtml).join('/'));

// ---------- C. Chọn chi nhánh Lái Thiêu -> counter CHỈ tính Lái Thiêu ----------
resetState({ branch: 'Lái Thiêu' });
scoped = api.monthlyBranchSearchForms();
check(scoped.length === 3 && scoped.every(function(x){ return x.branch === 'Lái Thiêu'; }),
  'C1. branch=Lái Thiêu: monthlyBranchSearchForms() trả đúng 3 form, toàn bộ thuộc Lái Thiêu');
tabsHtml = api.monthlyStatusTabsHtml();
check(JSON.stringify(tabCounts(tabsHtml)) === JSON.stringify([3,0,1,0,1,1]),
  'C2. branch=Lái Thiêu: chip Tất cả/Nháp/Chờ tự đánh giá/Chờ thẩm định/Đã thẩm định/Đã khóa = 3/0/1/0/1/1, got ' + tabCounts(tabsHtml).join('/'));

// ---------- D. Tìm kiếm 1 nhân viên -> counter thu hẹp đúng ----------
resetState({ query: 'Trần Văn D' });
scoped = api.monthlyBranchSearchForms();
check(scoped.length === 1 && scoped[0].employee_code === 'T4',
  'D1. search="Trần Văn D": monthlyBranchSearchForms() trả đúng 1 form (T4), got ' + scoped.length + ' - ' + (scoped[0] && scoped[0].employee_code));
tabsHtml = api.monthlyStatusTabsHtml();
check(JSON.stringify(tabCounts(tabsHtml)) === JSON.stringify([1,0,1,0,0,0]),
  'D2. search thu hẹp đúng: Tất cả=1, Chờ tự đánh giá=1, các chip khác=0, got ' + tabCounts(tabsHtml).join('/'));

resetState({ query: 'T4' }); // search theo mã nhân viên cũng phải thu hẹp giống hệt theo tên
scoped = api.monthlyBranchSearchForms();
check(scoped.length === 1 && scoped[0].employee_code === 'T4', 'D3. search="T4" (mã NV) cũng thu hẹp đúng còn 1 form (T4)');

// ---------- E. Đổi status active CHỈ đổi rows hiển thị, KHÔNG làm sai số trên các chip khác ----------
resetState({ branch: 'Ngô Quyền', status: 'all' });
const tabsAll = tabCounts(api.monthlyStatusTabsHtml());
resetState({ branch: 'Ngô Quyền', status: 'draft' });
const tabsDraftActive = tabCounts(api.monthlyStatusTabsHtml());
check(JSON.stringify(tabsAll) === JSON.stringify(tabsDraftActive),
  'E1. Đổi status đang chọn (all -> draft) KHÔNG làm đổi phân bố số trên các chip trạng thái (vẫn 3/1/1/1/0/0 dù tab nào đang active), got all=' + tabsAll.join('/') + ' vs draft-active=' + tabsDraftActive.join('/'));
check(activeTab(api.monthlyStatusTabsHtml()) === 'draft', 'E2. Class "active" đúng chuyển sang tab draft khi monthlyUiState.status=\'draft\'');
// nhưng rows HIỂN THỊ (monthlyFilteredForms) phải đổi theo status
const rowsWhenAll = (function(){ resetState({branch:'Ngô Quyền', status:'all'}); return api.monthlyFilteredForms(); })();
const rowsWhenDraft = (function(){ resetState({branch:'Ngô Quyền', status:'draft'}); return api.monthlyFilteredForms(); })();
check(rowsWhenAll.length === 3, 'E3. status=all + branch=Ngô Quyền: rows hiển thị (monthlyFilteredForms) = 3');
check(rowsWhenDraft.length === 1 && rowsWhenDraft[0].id === 'NQ1', 'E4. status=draft + branch=Ngô Quyền: rows hiển thị thu hẹp đúng còn 1 (NQ1), KHÔNG đổi tổng chip ở E1');

if (failures) {
  console.error('\n' + failures + ' check(s) failed.');
  process.exit(1);
}
console.log('\nALL PASS');
