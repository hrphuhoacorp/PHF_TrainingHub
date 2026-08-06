'use strict';
/* Regression test cho nguyên tắc nghiệp vụ mới: "Filter theo tổ chức hiện tại,
   không phải theo snapshot" (PHF076 case). Filter/search/counter/dropdown chi
   nhánh trên "Phiếu đánh giá tháng" phải dùng current_branch/current_department
   /current_title (đọc từ checklist_employee_assignments qua listMonthly()),
   TRONG KHI field snapshot branch/department/title trên chính form KHÔNG được
   đổi - đây chỉ là thay đổi công cụ tìm kiếm, không phải nghiệp vụ lịch sử.

   Cùng convention vm-sandbox với
   scripts/test-checklist-monthly-branch-search-counters.js. Không có jsdom.

   File này KHÔNG được gọi tự động ở bất kỳ đâu - chỉ chạy thủ công:
     node scripts/test-checklist-monthly-current-org-filter.js
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
  const expose = "\n  window.__phfckMonthlyTest={monthlyUiState:monthlyUiState,monthlyBranchSearchForms:monthlyBranchSearchForms,monthlyStatusTabsHtml:monthlyStatusTabsHtml,monthlyFilteredForms:monthlyFilteredForms,monthlyFormsHtml:monthlyFormsHtml};\n";
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
    addEventListener: noop, removeEventListener: noop,
    querySelector: function(){return null;}, querySelectorAll: function(){return [];},
    getElementById: function(){return null;},
    createElement: function(){return {style:{},setAttribute:noop,addEventListener:noop,classList:{add:noop,remove:noop}};},
    body: {classList:{add:noop,remove:noop}}, readyState: 'complete'
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

/* PHF076 case tái hiện đúng dữ liệu thật đã audit:
   - form snapshot branch = 'Phú Lợi' (đóng băng lúc tạo phiếu 07-29)
   - current_branch = 'Ngô Quyền' (assignment hiện tại, chuyển chi nhánh 08-02)
   -> lọc "Ngô Quyền" PHẢI thấy PHF076, lọc "Phú Lợi" KHÔNG được thấy,
      và form.branch (snapshot) không được sờ tới ở bất kỳ đâu trong bài test này. */
const FORMS = [
  { id: 'F-PHF076', employee_code: 'PHF076', employee_name: 'Võ Phương Diệu', department: 'Bộ phận bán hàng', title: 'Nhân viên', branch: 'Phú Lợi', status: 'waiting_self',
    current_branch: 'Ngô Quyền', current_department: 'Bộ phận bán hàng', current_title: 'Nhân viên', organization_mismatch: true },
  { id: 'F-PHF018', employee_code: 'PHF018', employee_name: 'Nguyễn Thị Lệ', department: 'Bộ phận bán hàng', title: 'Trưởng ca', branch: 'Ngô Quyền', status: 'waiting_self',
    current_branch: 'Ngô Quyền', current_department: 'Bộ phận bán hàng', current_title: 'Trưởng ca', organization_mismatch: false },
  { id: 'F-PHF092', employee_code: 'PHF092', employee_name: 'Huỳnh Nhật Toàn', department: 'Bộ phận bán hàng', title: 'Nhân viên', branch: 'Phú Lợi', status: 'waiting_self',
    current_branch: 'Lái Thiêu', current_department: 'Bộ phận bán hàng', current_title: 'Nhân viên', organization_mismatch: true }
];

function resetState(overrides) {
  api.monthlyUiState.forms = JSON.parse(JSON.stringify(FORMS));
  api.monthlyUiState.branch = '';
  api.monthlyUiState.status = 'all';
  api.monthlyUiState.query = '';
  Object.assign(api.monthlyUiState, overrides || {});
}

// ---------- 1. Lọc "Ngô Quyền" (current) phải thấy PHF076, dù snapshot là Phú Lợi ----------
resetState({ branch: 'Ngô Quyền' });
let rows = api.monthlyFilteredForms();
check(rows.some(function(r){ return r.employee_code === 'PHF076'; }),
  '1a. Lọc chi nhánh "Ngô Quyền" (current_branch) THẤY PHF076 dù snapshot branch = "Phú Lợi"');
check(rows.length === 2 && rows.every(function(r){ return r.employee_code !== 'PHF092'; }),
  '1b. Lọc "Ngô Quyền": đúng 2 người (PHF076, PHF018), không lẫn PHF092 (current=Lái Thiêu)');

// ---------- 2. Lọc "Phú Lợi" (current) KHÔNG được thấy PHF076 (dù snapshot khớp) ----------
resetState({ branch: 'Phú Lợi' });
rows = api.monthlyFilteredForms();
check(!rows.some(function(r){ return r.employee_code === 'PHF076'; }),
  '2. Lọc chi nhánh "Phú Lợi" KHÔNG thấy PHF076 (current_branch của PHF076 là Ngô Quyền, không phải Phú Lợi) - ĐÚNG nguyên tắc mới, không dùng snapshot');
check(rows.length === 0, '2b. Không còn ai match "Phú Lợi" theo current_branch (PHF092 đã chuyển sang Lái Thiêu)');

// ---------- 3. Snapshot của chính form KHÔNG bị đổi bởi việc lọc ----------
resetState({ branch: 'Ngô Quyền' });
const phf076 = api.monthlyFilteredForms().find(function(r){ return r.employee_code === 'PHF076'; });
check(phf076 && phf076.branch === 'Phú Lợi', '3. Sau khi lọc, form.branch (snapshot) của PHF076 vẫn nguyên "Phú Lợi" - filter không ghi đè/đổi snapshot');

// ---------- 4. Counter/summary (monthlyStatusTabsHtml) đếm theo current_branch, không theo snapshot ----------
resetState({ branch: 'Ngô Quyền' });
const tabsHtml = api.monthlyStatusTabsHtml();
const allCount = Number((tabsHtml.match(/<b>(\d+)<\/b>/) || [])[1]);
check(allCount === 2, '4. Counter "Tất cả" khi lọc Ngô Quyền = 2 (đếm theo current_branch, PHF076+PHF018), got ' + allCount);

// ---------- 5. Dropdown chi nhánh và search cũng phải theo current, không snapshot ----------
resetState({ query: 'Ngô Quyền' }); // search theo current_branch text
rows = api.monthlyFilteredForms();
check(rows.some(function(r){ return r.employee_code === 'PHF076'; }),
  '5. Tìm kiếm theo "Ngô Quyền" (chuỗi current_branch) khớp PHF076 dù snapshot branch khác');

// ---------- 6. HTML dòng hiển thị PHF076 không lộ chữ "Phú Lợi" (snapshot) làm rối người xem đang lọc theo Ngô Quyền ----------
resetState({ branch: 'Ngô Quyền' });
const html = api.monthlyFormsHtml();
check(html.indexOf('Ngô Quyền') >= 0, '6a. HTML dòng PHF076 hiển thị "Ngô Quyền" (current_branch)');
check(html.indexOf('Phú Lợi') === -1, '6b. HTML KHÔNG hiển thị "Phú Lợi" (snapshot) trong dòng nhân sự khi đang lọc theo current="Ngô Quyền" - tránh gây hiểu lầm cho người vận hành');

if (failures) {
  console.error('\n' + failures + ' check(s) failed.');
  process.exit(1);
}
console.log('\nALL PASS');
