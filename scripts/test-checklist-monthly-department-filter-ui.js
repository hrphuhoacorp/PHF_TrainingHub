'use strict';
/*
 * Regression test — "Phiếu đánh giá tháng": đồng bộ counter theo filter (Mục
 * tiêu 1) + filter Phòng ban mới (Mục tiêu 2), build 1432-monthly-department-
 * filter-counter-sync.
 *
 * Bug đã sửa: đổi Chi nhánh/Search trước đây chỉ thay outerHTML của
 * .phfck-table-wrap, KHÔNG render lại .phfck-monthly-tabs — nên các số trên
 * tab (Tất cả/Chờ tự đánh giá/...) vẫn đứng yên ở tổng toàn kỳ dù bảng đã lọc
 * đúng. Fix: monthlyRefreshTabsAndTable() giờ luôn thay CẢ HAI cùng lúc.
 *
 * Test này gọi thẳng root.__phfChecklistInputHandler (được bindRootOnce gắn
 * vào root qua addEventListener('input',...)) với các fake DOM event/target
 * tối thiểu — tức là test đúng path DOM thật chạy khi người dùng đổi
 * Chi nhánh/Phòng ban/gõ Search, không chỉ test các hàm filter thuần.
 *
 * Cùng convention "load real source trong vm sandbox" với
 * scripts/test-checklist-monthly-branch-search-counters.js. Không đụng DB thật.
 *
 * File này KHÔNG được gọi tự động ở bất kỳ đâu - chỉ chạy thủ công:
 *   node scripts/test-checklist-monthly-department-filter-ui.js
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
  const expose = "\n  window.__phfckDeptTest={monthlyUiState:monthlyUiState,monthlyBranchSearchForms:monthlyBranchSearchForms,monthlyStatusTabsHtml:monthlyStatusTabsHtml,monthlyFilteredForms:monthlyFilteredForms,monthlyFormsHtml:monthlyFormsHtml,monthlyBranchOptionsForDepartment:monthlyBranchOptionsForDepartment,monthlyBranchSelectHtml:monthlyBranchSelectHtml,bindRootOnce:bindRootOnce};\n";
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
const api = ctx.window.__phfckDeptTest;

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}

// ---------- fake DOM: root + panel + tabs/table/branch-select elements ----------
function makeFakeElement(className) {
  return {
    className: className || '',
    _outerHTML: '',
    set outerHTML(v) { this._outerHTML = v; },
    get outerHTML() { return this._outerHTML; }
  };
}
function makeFakeRoot() {
  const listeners = {};
  return {
    addEventListener: function(type, fn) { listeners[type] = fn; this['__phfChecklistInputHandler'] = type === 'input' ? fn : this['__phfChecklistInputHandler']; },
    removeEventListener: function(){},
    querySelector: function(){ return null; },
    querySelectorAll: function(){ return []; },
    __listeners: listeners
  };
}
function makeFakePanel(tabsEl, tableEl, branchSelectEl) {
  return {
    querySelector: function(sel) {
      if (sel === '.phfck-monthly-tabs') return tabsEl;
      if (sel === '.phfck-table-wrap,.phfck-monthly-empty') return tableEl;
      if (sel === '[data-phfck-monthly-branch]') return branchSelectEl;
      return null;
    }
  };
}
function makeFakeTarget(attrName, value, panel) {
  return {
    value: value,
    matches: function(sel) { return sel === '[' + attrName + ']'; },
    closest: function(sel) { return sel === '.phfck-monthly-panel' ? panel : null; }
  };
}
function tabCounts(html) {
  return (html.match(/<b>(\d+)<\/b>/g) || []).map(function(s){ return Number(s.replace(/[^0-9]/g, '')); });
}

// ---------- synthetic kỳ 2026-08: 8 forms, 2 phòng ban, 3 chi nhánh ----------
const BH = 'Bộ phận bán hàng', KT = 'Bộ phận Tài chính Kế toán';
function form(id, code, name, currentDept, currentBranch, snapshotBranch, status) {
  return {
    id: id, employee_code: code, employee_name: name,
    department: currentDept, current_department: currentDept,
    title: 'Nhân viên', current_title: 'Nhân viên',
    branch: snapshotBranch || currentBranch, current_branch: currentBranch,
    status: status, reviewer_name: '', template_id: '', template_version: ''
  };
}
const SYNTHETIC_FORMS = [
  form('F1', 'PHF001', 'Nguyễn Văn A', BH, 'Ngô Quyền', 'Ngô Quyền', 'waiting_self'),
  form('F2', 'PHF002', 'Nguyễn Văn B', BH, 'Ngô Quyền', 'Ngô Quyền', 'waiting_self'),
  form('F3', 'PHF018', 'Nguyễn Thị Lệ', BH, 'Ngô Quyền', 'Ngô Quyền', 'waiting_self'),
  form('F4', 'PHF076', 'Võ Phương Diệu', BH, 'Ngô Quyền', 'Phú Lợi', 'waiting_self'), // snapshot mismatch, giống case thật
  form('F5', 'PHF092', 'Huỳnh Nhật Toàn', BH, 'Lái Thiêu', 'Phú Lợi', 'waiting_self'),
  form('F6', 'PHF041', 'Đặng Thị Diễm', BH, 'Lái Thiêu', 'Phú Lợi', 'draft'),
  form('F7', 'PHF100', 'Lê Thị Kế', KT, 'Lái Thiêu', 'Lái Thiêu', 'waiting_self'),
  form('F8', 'PHF101', 'Phạm Văn Kế Hai', KT, 'Phú Lợi', 'Phú Lợi', 'reviewed')
];

function resetState(overrides) {
  api.monthlyUiState.forms = SYNTHETIC_FORMS.slice();
  api.monthlyUiState.department = '';
  api.monthlyUiState.branch = '';
  api.monthlyUiState.status = 'all';
  api.monthlyUiState.query = '';
  Object.assign(api.monthlyUiState, overrides || {});
}

// ================= 1. Toàn kỳ: counter = tổng form trong scope =================
resetState();
check(api.monthlyBranchSearchForms().length === 8, '1. Toàn kỳ: baseRows = 8/8 form (không lọc gì)');
check(tabCounts(api.monthlyStatusTabsHtml())[0] === 8, '1b. Toàn kỳ: chip "Tất cả" = 8');

// ================= Chuẩn bị fake DOM để test ĐÚNG path event handler thật =================
const fakeRoot = makeFakeRoot();
api.bindRootOnce(fakeRoot);
const inputHandler = fakeRoot.__phfChecklistInputHandler;
check(typeof inputHandler === 'function', 'setup. bindRootOnce() đã gắn root.__phfChecklistInputHandler (đúng path DOM thật)');

function simulate(attrName, value) {
  const tabsEl = makeFakeElement('phfck-monthly-tabs');
  const tableEl = makeFakeElement('phfck-table-wrap');
  const branchSelectEl = makeFakeElement('branch-select');
  const panel = makeFakePanel(tabsEl, tableEl, branchSelectEl);
  const target = makeFakeTarget(attrName, value, panel);
  inputHandler({ target: target });
  return { tabsEl: tabsEl, tableEl: tableEl, branchSelectEl: branchSelectEl };
}

// ================= 2. Ngô Quyền: bảng=4, Tất cả=4, phân bố cộng đúng 4 =================
resetState();
let dom = simulate('data-phfck-monthly-branch', 'Ngô Quyền');
check(api.monthlyUiState.branch === 'Ngô Quyền', '2a. monthlyUiState.branch đã đổi đúng qua event handler thật');
check((dom.tableEl.outerHTML.match(/<tr><td>/g) || []).length === 4, '2b. bảng (DOM thật, outerHTML) = 4 dòng đúng nhóm Ngô Quyền, gồm cả PHF076 (current, khác snapshot Phú Lợi)');
check(['PHF001','PHF002','PHF018','PHF076'].every(function(c){return dom.tableEl.outerHTML.indexOf('<b>'+({'PHF001':'Nguyễn Văn A','PHF002':'Nguyễn Văn B','PHF018':'Nguyễn Thị Lệ','PHF076':'Võ Phương Diệu'}[c])+'</b>')>=0;}), '2b2. cả 4 nhân viên đúng tên đều có mặt trong bảng');
let counts2 = tabCounts(dom.tabsEl.outerHTML);
check(counts2[0] === 4, '2c. Counter TAB (DOM thật, không phải hàm thuần) "Tất cả" = 4 SAU khi đổi Chi nhánh — ĐÂY LÀ BUG SẢN XUẤT ĐÃ SỬA (trước đây vẫn đứng ở 8/toàn kỳ)');
check(counts2.reduce(function(a,b){return a+b;},0) - counts2[0] === 4, '2d. Tổng các chip trạng thái con (Nháp+Chờ tự đánh giá+...) = 4, khớp baseRows');
check(counts2[2] === 4, '2e. Chip "Chờ tự đánh giá" = 4 (F1,F2,F3,PHF076 đều waiting_self)');

// ================= 3. Ngô Quyền + search PHF076: bảng=1, Tất cả=1, Chờ tự đánh giá=1 =================
resetState({ branch: 'Ngô Quyền' });
dom = simulate('data-phfck-monthly-search', 'PHF076');
check((dom.tableEl.outerHTML.match(/PHF076/g) || []).length >= 1 && dom.tableEl.outerHTML.indexOf('PHF001') === -1, '3a. bảng (DOM thật) chỉ còn PHF076 sau khi search trong Ngô Quyền');
let counts3 = tabCounts(dom.tabsEl.outerHTML);
check(counts3[0] === 1 && counts3[2] === 1, '3b. Counter TAB (DOM thật) Tất cả=1, Chờ tự đánh giá=1 sau search — không còn đứng yên ở số cũ');

// ================= 4. Phòng ban Bán hàng: chỉ hiện current_department Bán hàng =================
resetState();
dom = simulate('data-phfck-monthly-department', BH);
check(api.monthlyUiState.department === BH, '4a. monthlyUiState.department đã đổi đúng');
check(dom.tableEl.outerHTML.indexOf('PHF100') === -1 && dom.tableEl.outerHTML.indexOf('PHF101') === -1, '4b. bảng KHÔNG còn nhân sự phòng Kế toán (PHF100/PHF101) khi lọc Phòng ban=Bán hàng');
check(tabCounts(dom.tabsEl.outerHTML)[0] === 6, '4c. Counter TAB "Tất cả" = 6 (đúng số form current_department=Bán hàng)');

// ================= 5. Bán hàng + Lái Thiêu: AND đúng, PHF092/PHF041 theo cơ cấu hiện tại =================
resetState({ department: BH });
dom = simulate('data-phfck-monthly-branch', 'Lái Thiêu');
check(dom.tableEl.outerHTML.indexOf('PHF092') >= 0 && dom.tableEl.outerHTML.indexOf('PHF041') >= 0, '5a. Bán hàng+Lái Thiêu: thấy đúng PHF092 và PHF041 (current_branch=Lái Thiêu, current_department=Bán hàng)');
check(dom.tableEl.outerHTML.indexOf('PHF100') === -1, '5b. Bán hàng+Lái Thiêu: KHÔNG lẫn PHF100 (cùng branch Lái Thiêu nhưng khác phòng ban Kế toán) — AND đúng, không phải OR');
check(tabCounts(dom.tabsEl.outerHTML)[0] === 2, '5c. Counter TAB "Tất cả" = 2');

// ================= 6. Đổi phòng ban làm chi nhánh cũ không hợp lệ -> branch tự reset =================
resetState({ branch: 'Ngô Quyền' });
check(api.monthlyUiState.branch === 'Ngô Quyền', '6a (setup). branch=Ngô Quyền hợp lệ ở phòng ban rỗng (Tất cả phòng ban)');
dom = simulate('data-phfck-monthly-department', KT);
check(api.monthlyUiState.department === KT, '6b. monthlyUiState.department đổi sang Kế toán');
check(api.monthlyUiState.branch === '', '6c. branch TỰ RESET về rỗng vì "Ngô Quyền" không tồn tại trong phòng Kế toán (chỉ có Lái Thiêu/Phú Lợi)');
check(dom.branchSelectEl.outerHTML.indexOf('Ngô Quyền') === -1 || dom.branchSelectEl.outerHTML.indexOf('selected') === -1 || !/Ngô Quyền[^<]*selected/.test(dom.branchSelectEl.outerHTML), '6d. <select> Chi nhánh (DOM thật) được vẽ lại, không còn giữ "Ngô Quyền" đã chọn');
check(api.monthlyBranchOptionsForDepartment(KT).sort().join(',') === ['Lái Thiêu','Phú Lợi'].sort().join(','), '6e. Danh sách chi nhánh cho phòng Kế toán đúng = [Lái Thiêu, Phú Lợi]');

// ================= 7. Search không dấu: PHF076 / Diệu / dieu đều tìm đúng =================
resetState();
['PHF076', 'Diệu', 'dieu', 'DIEU'].forEach(function(q) {
  resetState();
  const rows = (function(){ api.monthlyUiState.query = q; return api.monthlyBranchSearchForms(); })();
  check(rows.length === 1 && rows[0].employee_code === 'PHF076', '7. search="' + q + '" tìm đúng 1 kết quả PHF076 (không phân biệt dấu/hoa-thường), got ' + rows.length);
});

// ================= Regression: hành vi cũ (không phòng ban) vẫn đúng =================
resetState();
dom = simulate('data-phfck-monthly-branch', 'Lái Thiêu');
check(tabCounts(dom.tabsEl.outerHTML)[0] === 3, 'R1. Không lọc phòng ban, chỉ Lái Thiêu: Tất cả = 3 (PHF092,PHF041,PHF100 - current_branch=Lái Thiêu; PHF101 hiện tại là Phú Lợi nên không tính)');

if (failures) {
  console.error('\n' + failures + ' check(s) failed.');
  process.exit(1);
}
console.log('\nALL PASS');
