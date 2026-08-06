'use strict';
/* Regression test cho Dashboard "Điểm Checklist" (view mới bên trong màn Báo
   cáo hiện có, KHÔNG phải trang mới - assets/js/checklist/phf-checklist-app.js).

   Khẳng định:
   - Tab "Tổng hợp"/"Điểm Checklist" tồn tại và active-state đúng theo
     reportUiState.view (dùng lại cơ chế data-phfck-report-view đã có sẵn từ
     trước nhưng chưa từng được nối vào nội dung).
   - Chế độ "Hiện tại" render đúng cột/số liệu từ checklistScoreUiState.data
     (nguồn getChecklistCurrentScoreReport riêng).
   - Chế độ "Theo kỳ" render đúng cột F2 CHỈ từ reportUiState.data đã có sẵn
     (dữ liệu report cũ) - KHÔNG đọc checklistScoreUiState.data - chứng minh
     đúng yêu cầu "tái sử dụng, không gọi thêm API" cho chế độ này.

   Cùng convention vm-sandbox với
   scripts/test-checklist-monthly-branch-search-counters.js. Không có jsdom.

   File này KHÔNG được gọi tự động ở bất kỳ đâu - chỉ chạy thủ công:
     node scripts/test-checklist-score-dashboard-ui.js
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
  const expose = "\n  window.__phfckScoreTest={reportUiState:reportUiState,checklistScoreUiState:checklistScoreUiState,reportsHtml:reportsHtml,checklistScoreDashboardHtml:checklistScoreDashboardHtml,checklistScoreCurrentHtml:checklistScoreCurrentHtml,checklistScorePeriodHtml:checklistScorePeriodHtml,reportTopTabsHtml:reportTopTabsHtml};\n";
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
const api = ctx.window.__phfckScoreTest;

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}

// ---------- 1. Tab bar tồn tại, active đúng theo reportUiState.view ----------
api.reportUiState.view = 'summary';
api.reportUiState.data = null; // trạng thái "chưa có dữ liệu" của tab Tổng hợp
let html = api.reportsHtml();
check(html.indexOf('data-phfck-report-view="summary"') >= 0 && html.indexOf('data-phfck-report-view="checklist-score"') >= 0,
  '1a. reportsHtml() luôn render đủ 2 tab: Tổng hợp + Điểm Checklist');
check(/class="active" data-phfck-report-view="summary"/.test(html), '1b. view=summary: tab "Tổng hợp" đang active');

api.reportUiState.view = 'checklist-score';
api.checklistScoreUiState.mode = 'current';
api.checklistScoreUiState.data = null;
html = api.reportsHtml();
check(/class="active" data-phfck-report-view="checklist-score"/.test(html), '1c. view=checklist-score: tab "Điểm Checklist" đang active');
check(html.indexOf('Hiện tại') >= 0 && html.indexOf('Theo kỳ') >= 0, '1d. Dashboard con có 2 chip chế độ "Hiện tại"/"Theo kỳ"');

// ---------- 2. Chế độ Hiện tại (F1): render đúng cột/số liệu từ checklistScoreUiState.data ----------
api.checklistScoreUiState.data = {
  month: '2026-08',
  employees: [
    { employeeCode: 'E1', employeeName: 'Nguyễn Văn Sạch', department: 'Bộ phận bán hàng', branch: 'Ngô Quyền', currentScore: 100, violationCount: 0, managerName: 'Quản Lý A', hasMonthlyForm: false, monthlyFormStatus: '' },
    { employeeCode: 'E3', employeeName: 'Lê Văn Test', department: 'Bộ phận bán hàng', branch: 'Lái Thiêu', currentScore: 60, violationCount: 1, managerName: 'Quản Lý B', hasMonthlyForm: true, monthlyFormStatus: 'waiting_self' }
  ],
  summary: { total: 2, averageScore: 80, belowThresholdCount: 1, cleanCount: 1 }
};
html = api.checklistScoreCurrentHtml();
check(html.indexOf('Nguyễn Văn Sạch') >= 0 && html.indexOf('Lê Văn Test') >= 0, '2a. Bảng Hiện tại hiển thị cả nhân viên điểm 100 chưa lỗi (E1) và nhân viên bị trừ điểm (E3)');
check(html.indexOf('Chưa có phiếu') >= 0, '2b. E1 (hasMonthlyForm=false) hiển thị "Chưa có phiếu" thay vì lỗi/rỗng');
check(html.indexOf('Chờ tự đánh giá') >= 0, '2c. E3 hiển thị đúng nhãn trạng thái phiếu tháng (waiting_self -> "Chờ tự đánh giá")');
check(/Tổng nhân viên[\s\S]*?<strong>2<\/strong>/.test(html), '2d. Summary card "Tổng nhân viên" = 2');
check(/Dưới ngưỡng[\s\S]*?<strong>1<\/strong>/.test(html), '2e. Summary card "Dưới ngưỡng" = 1');
check(/Chưa phát sinh lỗi[\s\S]*?<strong>1<\/strong>/.test(html), '2f. Summary card "Chưa phát sinh lỗi" = 1');

// ---------- 3. Chế độ Theo kỳ (F2): CHỈ đọc reportUiState.data, KHÔNG đọc checklistScoreUiState.data ----------
api.checklistScoreUiState.data = null; // cố tình để trống - nếu period-mode lỡ đọc field này sẽ crash/rỗng
api.reportUiState.data = {
  month: '2026-08',
  forms: [
    { periodMonth: '2026-08', employeeCode: 'PHF076', employeeName: 'Võ Phương Diệu', department: 'Bộ phận bán hàng', branch: 'Phú Lợi', checklistScore: 99, selfTotalScore: 69.3, reviewTotalScore: 69.3, finalScore: null, reviewerName: 'Nguyễn Thị Lệ', status: 'waiting_self', reviewSubmittedAt: '' }
  ],
  violations: [], trend: [], repeatSuggestions: [], repeatPolicy: {}, scope: { role: 'admin' }, generatedAt: '2026-08-06T00:00:00Z'
};
html = api.checklistScorePeriodHtml();
check(html.indexOf('PHF076') >= 0 && html.indexOf('Võ Phương Diệu') >= 0, '3a. Bảng Theo kỳ hiển thị đúng dữ liệu lấy từ reportUiState.data (không throw dù checklistScoreUiState.data = null)');
check(html.indexOf('Phú Lợi') >= 0, '3b. Bảng Theo kỳ hiển thị branch SNAPSHOT trên phiếu ("Chi nhánh trên phiếu") - đúng nguyên tắc giữ nguyên lịch sử ở chế độ này');
check(html.indexOf('99.00') >= 0, '3c. Cột "Điểm Checklist" hiển thị đúng giá trị từ report data');
check(html.indexOf('Chi nhánh trên phiếu') >= 0 && html.indexOf('Phòng ban trên phiếu') >= 0, '3d. Tiêu đề cột đúng theo Phần F2: "...trên phiếu" (rõ ràng là snapshot, không phải current)');

if (failures) {
  console.error('\n' + failures + ' check(s) failed.');
  process.exit(1);
}
console.log('\nALL PASS');
