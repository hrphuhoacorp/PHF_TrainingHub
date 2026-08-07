'use strict';
/* Regression test cho Dashboard "Điểm Checklist" (view mới bên trong màn Báo
   cáo hiện có, KHÔNG phải trang mới - assets/js/checklist/phf-checklist-app.js).

   Build 1432->1433: tab "Theo kỳ" được viết lại HOÀN TOÀN - không còn ăn
   theo reportUiState.data (dữ liệu tab "Tổng hợp" cũ) mà tự gọi action riêng
   getChecklistScorePeriodReport() qua checklistScoreUiState.periodData, hỗ
   trợ cả 1 kỳ lẫn range tới 12 kỳ. Phần test cho chế độ này đã viết lại theo
   đúng contract mới; các phần khác (tab "Tổng hợp", chế độ "Hiện tại") giữ
   nguyên, chỉ bổ sung test cho UX nhấn mạnh điểm bị trừ/số lỗi.

   Khẳng định:
   - Tab "Tổng hợp"/"Điểm Checklist" tồn tại và active-state đúng theo
     reportUiState.view (dùng lại cơ chế data-phfck-report-view đã có sẵn từ
     trước nhưng chưa từng được nối vào nội dung).
   - Chế độ "Hiện tại" render đúng cột/số liệu từ checklistScoreUiState.data
     (nguồn getChecklistCurrentScoreReport riêng), không còn control chọn
     tháng lịch sử, và nhấn mạnh đúng điểm bị trừ/số lỗi >0.
   - Chế độ "Theo kỳ" render đúng từ checklistScoreUiState.periodData: bảng 1
     kỳ, bảng 2-4 kỳ (3 cột/kỳ), bảng 5-12 kỳ (mặc định chỉ Điểm cuối), quy
     tắc "—" vs "0", summary chỉ hiện với 1 kỳ, modal chi tiết đúng kỳ/nhân
     viên được click.

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
  const expose = "\n  window.__phfckScoreTest={reportUiState:reportUiState,checklistScoreUiState:checklistScoreUiState,reportsHtml:reportsHtml,checklistScoreDashboardHtml:checklistScoreDashboardHtml,checklistScoreCurrentHtml:checklistScoreCurrentHtml,checklistScorePeriodHtml:checklistScorePeriodHtml,reportTopTabsHtml:reportTopTabsHtml,checklistScoreValueHtml:checklistScoreValueHtml};\n";
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

// ---------- 2. Chế độ Hiện tại: render đúng cột/số liệu + không còn chọn tháng lịch sử + nhấn mạnh điểm/lỗi ----------
api.checklistScoreUiState.data = {
  month: '2026-08',
  employees: [
    { employeeCode: 'E1', employeeName: 'Nguyễn Văn Sạch', department: 'Bộ phận bán hàng', branch: 'Ngô Quyền', currentScore: 100, violationCount: 0, managerName: 'Quản Lý A', hasMonthlyForm: false, monthlyFormStatus: '' },
    { employeeCode: 'E5', employeeName: 'Phạm Thị Nhẹ', department: 'Bộ phận bán hàng', branch: 'Ngô Quyền', currentScore: 98, violationCount: 1, managerName: 'Quản Lý A', hasMonthlyForm: true, monthlyFormStatus: 'waiting_self' },
    { employeeCode: 'E3', employeeName: 'Lê Văn Test', department: 'Bộ phận bán hàng', branch: 'Lái Thiêu', currentScore: 60, violationCount: 3, managerName: 'Quản Lý B', hasMonthlyForm: true, monthlyFormStatus: 'waiting_self' }
  ],
  summary: { total: 3, averageScore: 86, belowThresholdCount: 1, cleanCount: 1 }
};
html = api.checklistScoreCurrentHtml();
check(html.indexOf('Nguyễn Văn Sạch') >= 0 && html.indexOf('Lê Văn Test') >= 0, '2a. Bảng Hiện tại hiển thị cả nhân viên điểm 100 chưa lỗi (E1) và nhân viên bị trừ điểm (E3)');
check(html.indexOf('Chưa có phiếu') >= 0, '2b. E1 (hasMonthlyForm=false) hiển thị "Chưa có phiếu" thay vì lỗi/rỗng');
check(html.indexOf('Chờ tự đánh giá') >= 0, '2c. E3 hiển thị đúng nhãn trạng thái phiếu tháng (waiting_self -> "Chờ tự đánh giá")');
check(/Tổng nhân viên[\s\S]*?<strong>3<\/strong>/.test(html), '2d. Summary card "Tổng nhân viên" = 3');
check(/Dưới ngưỡng[\s\S]*?<strong>1<\/strong>/.test(html), '2e. Summary card "Dưới ngưỡng" = 1 (chỉ E3 <70)');
check(/Chưa phát sinh lỗi[\s\S]*?<strong>1<\/strong>/.test(html), '2f. Summary card "Chưa phát sinh lỗi" = 1 (chỉ E1)');
check(html.indexOf('data-phfck-score-month') < 0, '2g (UX bổ sung). Không còn control chọn tháng lịch sử ở tab Hiện tại (đã bỏ input month)');
check(html.indexOf('Kỳ hiện tại:') >= 0, '2h (UX bổ sung). Hiển thị rõ "Kỳ hiện tại: ..." thay cho control chọn tháng');
check(/E1[\s\S]{0,400}?phfck-score-cell(?![\s\S]{0,5}is-)/.test(html) || html.indexOf('100.00</strong>') >= 0, '2i (UX bổ sung). E1 điểm=100 KHÔNG có emphasis class (is-warning/is-danger)');
check(/phfck-score-cell is-warning">98\.00/.test(html), '2j (UX bổ sung). E5 điểm=98 (<100, >=70) có class "is-warning" (nhấn mạnh vừa phải)');
check(/phfck-score-cell is-danger">60\.00/.test(html), '2k (UX bổ sung). E3 điểm=60 (<70, đã có nghiệp vụ "dưới ngưỡng") có class "is-danger" (nhấn mạnh mạnh hơn)');
check(/E1[\s\S]{0,600}?phfck-score-dash">—</.test(html), '2l (UX bổ sung). E1 violationCount=0 hiển thị "—", KHÔNG hiển thị số 0 (giảm nhiễu thị giác, KHÔNG áp dụng quy tắc này cho các cột điểm)');
check(/is-danger">3</.test(html), '2m (UX bổ sung). E3 violationCount=3 (>0) hiển thị số thật, không phải "—"');

// ---------- 3. Chế độ Theo kỳ: đọc checklistScoreUiState.periodData (action riêng getChecklistScorePeriodReport) ----------
api.checklistScoreUiState.data = null;
function periodCell(dept, branch, checklist, self, review, final, status, hasForm) {
  return { hasForm: hasForm !== false, department: dept, branch: branch, title: 'Nhân viên', checklistScore: checklist, selfTotalScore: self, reviewTotalScore: review, finalScore: final, status: status || 'waiting_self', reviewerName: 'Nguyễn Thị Lệ', reviewSubmittedAt: '', templateId: 'nv-ban-hang', templateVersion: 'BH-1.0', formId: 'F1' };
}

// ----- 3a-3d: 1 kỳ -----
api.checklistScoreUiState.mode = 'period';
api.checklistScoreUiState.periodFullView = false;
api.checklistScoreUiState.periodData = {
  fromMonth: '2026-08', toMonth: '2026-08', periods: ['2026-08'],
  employees: [
    { employeeCode: 'PHF076', employeeName: 'Võ Phương Diệu', periods: { '2026-08': periodCell('Bộ phận bán hàng', 'Phú Lợi', 99, 0, null, null, 'waiting_self') } },
    { employeeCode: 'PHF002', employeeName: 'Trần Thị B', periods: { '2026-08': periodCell('Bộ phận bán hàng', 'Ngô Quyền', null, null, null, null, '', false) } }
  ]
};
html = api.checklistScorePeriodHtml();
check(html.indexOf('PHF076') >= 0 && html.indexOf('Võ Phương Diệu') >= 0, '3a. Bảng Theo kỳ (1 kỳ) hiển thị đúng dữ liệu từ checklistScoreUiState.periodData');
check(html.indexOf('Phú Lợi') >= 0, '3b. Bảng Theo kỳ hiển thị branch SNAPSHOT của kỳ (Phú Lợi) - đúng nguyên tắc giữ nguyên lịch sử');
check(html.indexOf('99.00') >= 0, '3c. Cột Checklist hiển thị đúng giá trị persisted (99.00)');
check(/PHF076[\s\S]{0,300}?<td>0\.00<\/td>/.test(html), '8. self=0 (đã có dữ liệu thật) hiển thị SỐ "0.00", không phải "—"');
check(/PHF076[\s\S]{0,400}?<td>—<\/td>/.test(html), '9-10. review=null và final=null hiển thị "—", không phải "0.00"');
check(html.indexOf('Không có phiếu') >= 0, '11. PHF002 (kỳ không có phiếu) hiển thị trạng thái "Không có phiếu" và điểm "—"');
check(/PHF002[\s\S]{0,200}?—[\s\S]{0,50}?—[\s\S]{0,50}?—[\s\S]{0,50}?—/.test(html), '11b. PHF002 (không có phiếu) mọi cột điểm đều "—", không lộ số 0');

// ----- summary 1 kỳ (denominator, bỏ qua null, 0 vẫn tham gia) -----
check(/Checklist TB[\s\S]*?<strong>99\.00<\/strong>[\s\S]*?Trung bình 1\/2/.test(html), '20-21a. Summary "Checklist TB": chỉ PHF076 có checklistScore hợp lệ (PHF002 không có phiếu -> null, không tính) -> TB=99.00, denominator=1/2');
check(/Tự đánh giá TB[\s\S]*?<strong>0\.00<\/strong>[\s\S]*?Trung bình 1\/2/.test(html), '20-21b. Summary "Tự đánh giá TB": chỉ PHF076 có self=0 (số 0 vẫn tham gia average) -> TB=0.00, denominator=1/2 (bỏ qua null của PHF002)');
check(/Thẩm định TB[\s\S]*?<strong>—<\/strong>/.test(html), '20c. Summary "Thẩm định TB": không ai có review hợp lệ -> "—", không phải "0.00"');

// ----- 3e: 2-4 kỳ -> luôn đủ 3 cột/kỳ (Tự đánh/Thẩm định/Điểm cuối), KHÔNG có summary -----
api.checklistScoreUiState.periodData = {
  fromMonth: '2026-06', toMonth: '2026-08', periods: ['2026-06', '2026-07', '2026-08'],
  employees: [
    { employeeCode: 'PHF076', employeeName: 'Võ Phương Diệu', periods: {
      '2026-06': periodCell('Bộ phận bán hàng', 'Phú Lợi', 100, 90, 88, 88.67, 'locked'),
      '2026-07': periodCell('Bộ phận bán hàng', 'Phú Lợi', 95, 85, 90, 88.33, 'locked'),
      '2026-08': periodCell('Bộ phận bán hàng', 'Ngô Quyền', 99, 0, null, null, 'waiting_self')
    } }
  ]
};
html = api.checklistScorePeriodHtml();
check(/Tự đánh<\/th>[\s\S]*?Thẩm định<\/th>[\s\S]*?Điểm cuối<\/th>/.test(html), '15. 2-4 kỳ: đủ 3 subcolumns (Tự đánh/Thẩm định/Điểm cuối) mỗi kỳ');
check((html.match(/Tự đánh</g) || []).length === 3, '15b. 2-4 kỳ: đúng 3 nhóm cột Tự đánh (khớp số kỳ đang xem)');
check(html.indexOf('Checklist TB') < 0 && html.indexOf('phfck-exec-kpis') < 0, '22a. Multi-period (2-4 kỳ) KHÔNG hiện summary card trung bình toàn khoảng (không có ý nghĩa quản trị rõ trong batch này)');
check(html.indexOf('Chỉ điểm cuối') < 0, '15c. 2-4 kỳ: không có toggle "Chỉ điểm cuối" (chỉ xuất hiện khi >4 kỳ)');

// ----- 3f: 5-12 kỳ -> mặc định chỉ Điểm cuối, có toggle "Đầy đủ" -----
var manyPeriods = ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06'];
var manyPeriodsData = {}; manyPeriods.forEach(function (m, i) { manyPeriodsData[m] = periodCell('Bộ phận bán hàng', 'Ngô Quyền', 100, 90, 90, 90, 'locked'); });
api.checklistScoreUiState.periodFullView = false;
api.checklistScoreUiState.periodData = { fromMonth: manyPeriods[0], toMonth: manyPeriods[5], periods: manyPeriods, employees: [{ employeeCode: 'PHF076', employeeName: 'Võ Phương Diệu', periods: manyPeriodsData }] };
html = api.checklistScorePeriodHtml();
check(html.indexOf('Tự đánh<') < 0, '16. >4 kỳ (mặc định): CHỈ hiện Điểm cuối, không hiện Tự đánh/Thẩm định (tránh vỡ UX)');
check((html.match(/Điểm cuối</g) || []).length === manyPeriods.length, '16b. >4 kỳ: đúng số cột Điểm cuối = số kỳ (6)');
check(html.indexOf('Chỉ điểm cuối') >= 0 && html.indexOf('Đầy đủ') >= 0, '16c. >4 kỳ: có control toggle "Chỉ điểm cuối"/"Đầy đủ"');
check(html.indexOf('phfck-score-period-scroll') >= 0, 'C7. Bảng nhiều kỳ bọc trong vùng scroll ngang riêng (không để cả page overflow)');

api.checklistScoreUiState.periodFullView = true;
html = api.checklistScorePeriodHtml();
check(html.indexOf('Tự đánh<') >= 0, '16d. Bật "Đầy đủ": hiện lại đủ 3 subcolumns/kỳ');
api.checklistScoreUiState.periodFullView = false;

// ----- 18: không duplicate employee khi render nhiều kỳ -----
var codeMatches = (html.match(/PHF076/g) || []).length;
check(codeMatches >= 1, '18. Không lặp nhân viên trong bảng nhiều kỳ (PHF076 chỉ xuất hiện đúng 1 dòng)');
api.checklistScoreUiState.periodFullView = false;

// ----- 23-24: click "Xem chi tiết" mở đúng modal cho đúng nhân viên + đúng kỳ -----
api.checklistScoreUiState.periodData = {
  fromMonth: '2026-07', toMonth: '2026-08', periods: ['2026-07', '2026-08'],
  employees: [
    { employeeCode: 'PHF076', employeeName: 'Võ Phương Diệu', periods: {
      '2026-07': periodCell('Bộ phận bán hàng', 'Phú Lợi', 100, 90, 85, 86.67, 'locked'),
      '2026-08': periodCell('Bộ phận bán hàng', 'Ngô Quyền', 99, 0, null, null, 'waiting_self')
    } }
  ]
};
api.checklistScoreUiState.periodDetail = { employeeCode: 'PHF076', month: '2026-08' };
html = api.checklistScorePeriodHtml();
check(html.indexOf('phfck-score-detail-modal') >= 0, '23a. Click "Xem chi tiết" (đã set periodDetail) render đúng modal chi tiết');
check(/Điểm cuối<\/span><b>—<\/b>/.test(html), '24a. Modal đúng dữ liệu kỳ 2026-08 (final=null -> "—"), KHÔNG lấy nhầm dữ liệu kỳ 2026-07 (final=86.67)');
check(html.indexOf('Ngô Quyền') >= 0 && html.indexOf('Tháng 08/2026') >= 0, '24b. Modal hiển thị đúng snapshot org + đúng nhãn kỳ của period được click (không lẫn kỳ khác)');

api.checklistScoreUiState.periodDetail = { employeeCode: 'PHF076', month: '2026-07' };
html = api.checklistScorePeriodHtml();
check(/Điểm cuối<\/span><b>86\.67<\/b>/.test(html), '24c. Đổi periodDetail sang kỳ 2026-07: modal cập nhật đúng final=86.67 của kỳ đó, không giữ giá trị kỳ cũ');
api.checklistScoreUiState.periodDetail = null;

if (failures) {
  console.error('\n' + failures + ' check(s) failed.');
  process.exit(1);
}
console.log('\nALL PASS');
