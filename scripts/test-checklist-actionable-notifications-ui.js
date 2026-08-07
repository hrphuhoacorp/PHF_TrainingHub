'use strict';
/* Batch 1.43.4 - "Cover cá nhân + Actionable notification".

   Hai kỹ thuật test khác nhau trong cùng file, theo đúng 2 convention đã có
   sẵn trong repo (không phát minh convention mới):

   - Phần A/A2 (cover "Phiếu của tôi" / "Checklist đang áp dụng") và phần
     backend (api/data.js/server.js) dùng SOURCE-SCAN (như
     scripts/test-checklist-assessment-profile-ui.js) - chỉ khẳng định đúng
     chuỗi/kết-nối đã đổi, không dựng DOM thật.
   - Phần B (checklistNotificationAction/CTA/deep-link/highlight) dùng
     vm-sandbox thật (như scripts/test-checklist-score-dashboard-ui.js) vì có
     logic điều kiện thật sự cần chạy để khẳng định đúng.

   File này KHÔNG được gọi tự động ở bất kỳ đâu - chỉ chạy thủ công:
     node scripts/test-checklist-actionable-notifications-ui.js
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const appRelPath = 'assets/js/checklist/phf-checklist-app.js';
const appPath = path.join(root, appRelPath);
const cssPath = path.join(root, 'assets/css/phf-checklist.css');
const apiDataPath = path.join(root, 'api/data.js');
const serverPath = path.join(root, 'server.js');

const app = fs.readFileSync(appPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
const apiData = fs.readFileSync(apiDataPath, 'utf8');
const serverJs = fs.readFileSync(serverPath, 'utf8');

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}

// ================================================================
// A. Cover "Phiếu của tôi" - source-scan
// ================================================================
check(app.indexOf("managerSectionHeading('PHF CHECKLIST · CÁ NHÂN','Phiếu của tôi','Tự đánh giá, theo dõi kết quả và các nội dung liên quan đến phiếu đánh giá của bạn.',marketingKpiButtonHtml(marketingKpiPeriodValue(),data))") >= 0,
  'A1. my-work header dùng đúng breadcrumb "PHF CHECKLIST · CÁ NHÂN" + title "Phiếu của tôi" + description đã chốt, cùng tinh thần breadcrumb->title->description như màn Báo cáo');
check(app.indexOf("marketingKpiButtonHtml(marketingKpiPeriodValue(),data)") >= 0,
  'A2. Action button "Cập nhật tiêu chí tháng" (marketingKpiButtonHtml) vẫn được truyền vào header - không bị gỡ');
check(app.indexOf("+roleMonthlyHtml()+employeeTaskInboxHtml()+'<section class=\"phfck-panel phfck-role-own\">") >= 0,
  'A3. Nội dung thật (roleMonthlyHtml/employeeTaskInboxHtml/Checklist đang áp dụng) vẫn nằm ngay dưới header - không có hero/banner chen giữa');

// ================================================================
// A2. Cover "Checklist đang áp dụng" (2 nơi: my-work + trang cá nhân learner)
// ================================================================
const headingOccurrences = (app.match(/<h3>Checklist đang áp dụng<\/h3>/g) || []).length;
check(headingOccurrences === 3, 'A2a. Đúng 3 nơi hiển thị heading "Checklist đang áp dụng" (my-work của manager + 2 nhánh trang cá nhân learner) - terminology giữ nguyên, không đổi tên');
check((app.match(/<h3>Checklist đang áp dụng<\/h3><p>Xem tiêu chuẩn, tiêu chí và Checklist hiện đang được áp dụng cho bạn\.<\/p>/g) || []).length === 3,
  'A2b. Cả 3 nơi đều có mô tả ngắn ngay dưới title, đúng wording đã chốt');
check((app.match(/rolePersonCardHtml\(data\.ownAssignment,true\)/g) || []).length === 3,
  'A2c. Cả 3 khối vẫn gọi rolePersonCardHtml(data.ownAssignment,true) - không đổi component/data render nội dung thật');
check(css.indexOf('.phfck-role-own .phfck-panel-head p{') >= 0,
  'A2d. CSS mô tả được scoped vào .phfck-role-own (không đổi global .phfck-panel-head/typography)');

// ================================================================
// B (backend). Notification VIOLATION_CREATED mang đúng violation_id/period,
//    parity server.js <-> api/data.js
// ================================================================
for (const [label, source] of [['api/data.js', apiData], ['server.js', serverJs]]) {
  check(source.indexOf("subjectType:'violation'") >= 0,
    `B1. ${label}: VIOLATION_CREATED dùng subjectType='violation' (cụ thể, thay cho 'violation_batch' luôn rỗng ở Production)`);
  check(source.indexOf("subjectId:violationIds.join(',')") >= 0,
    `B2. ${label}: subjectId mang đúng violation id thật (savedRows[].id), không còn phụ thuộc testBatchId (chỉ có ở chế độ TEST)`);
  check(source.indexOf("focus=violation&violation_id=") >= 0,
    `B3. ${label}: targetPath lưu kèm query deep-link focus=violation&violation_id= (đúng route /hv/checklist thay vì route không tồn tại /hv/checklist/viec-can-xu-ly)`);
  check(source.indexOf('/hv/checklist/viec-can-xu-ly') < 0,
    `B4. ${label}: đã bỏ route cũ không tồn tại "/hv/checklist/viec-can-xu-ly"`);
  check(source.indexOf('rowsByEmployee') >= 0,
    `B5. ${label}: gom theo employeeCode trước khi emit (1 notification/nhân viên, nhưng mang đủ id mọi lỗi mới của người đó trong batch)`);
}

// ================================================================
// B (frontend). vm sandbox thật cho checklistNotificationAction/highlight
// ================================================================
function buildTestSource() {
  const marker = '\n})();';
  const idx = app.lastIndexOf(marker);
  if (idx === -1 || idx < app.length - 20) {
    throw new Error('Không tìm thấy dấu đóng IIFE cuối file - cấu trúc file đã đổi, cần cập nhật test.');
  }
  const expose = "\n  window.__phfckNotifTest={checklistNotificationAction:checklistNotificationAction,checklistNotificationTone:checklistNotificationTone,checklistNotificationFocusViolationIds:checklistNotificationFocusViolationIds,checklistNotificationFocusTaskId:checklistNotificationFocusTaskId,checklistNotificationFocusKeyFromLocation:checklistNotificationFocusKeyFromLocation,employeeTaskInboxHtml:employeeTaskInboxHtml,roleWorkspaceState:roleWorkspaceState,notificationUiState:notificationUiState,checklistNotificationInboxHtml:checklistNotificationInboxHtml};\n";
  return app.slice(0, idx) + expose + app.slice(idx);
}

function buildSandbox() {
  const noop = function () {};
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.addEventListener = noop;
  sandbox.removeEventListener = noop;
  sandbox.dispatchEvent = noop;
  sandbox.PHF_BUILD_INFO = { version: 'test', fingerprint: 'test' };
  sandbox.document = {
    documentElement: { setAttribute: noop, getAttribute: function () { return null; } },
    addEventListener: noop, removeEventListener: noop,
    querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    getElementById: function () { return null; },
    createElement: function () { return { style: {}, setAttribute: noop, addEventListener: noop, classList: { add: noop, remove: noop } }; },
    body: { classList: { add: noop, remove: noop } }, readyState: 'complete'
  };
  sandbox.location = { pathname: '/hv/checklist', search: '', hash: '', origin: 'http://localhost' };
  sandbox.history = { pushState: noop, replaceState: noop, state: null };
  sandbox.localStorage = { getItem: function () { return null; }, setItem: noop, removeItem: noop };
  sandbox.sessionStorage = { getItem: function () { return null; }, setItem: noop, removeItem: noop };
  sandbox.navigator = { userAgent: 'node-test' };
  sandbox.matchMedia = null;
  sandbox.MutationObserver = function () { return { observe: noop, disconnect: noop }; };
  sandbox.fetch = function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}); } }); };
  sandbox.URL = URL;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.requestAnimationFrame = function (fn) { return setTimeout(fn, 0); };
  sandbox.CSS = { escape: function (v) { return String(v); } };
  sandbox.__phfLocalData = null;
  return vm.createContext(sandbox);
}

const ctx = buildSandbox();
new vm.Script(buildTestSource(), { filename: appRelPath }).runInContext(ctx);
const api = ctx.window.__phfckNotifTest;

// ---------- 1. CTA label + deep-link theo đúng loại thông báo ----------
ctx.window.location.pathname = '/hv/checklist';
ctx.window.location.search = '';
let action = api.checklistNotificationAction({ eventCode: 'VIOLATION_CREATED', subjectType: 'violation', subjectId: 'v1,v2', targetPath: '/hv/checklist' });
check(action.type === 'OPEN_CHECKLIST_TASK' && action.label === 'Xem lỗi', '1a. VIOLATION_CREATED -> CTA "Xem lỗi" (không còn "Xem việc" chung chung)');
check(action.path.indexOf('/hv/checklist?task=employee') === 0, '1b. VIOLATION_CREATED (role learner) -> vẫn dùng base path role-based đã có (/hv/checklist?task=employee) - không tin thẳng targetPath lưu sẵn');
check(action.path.indexOf('focus=violation&violation_id=v1%2Cv2') >= 0, '1c. Query bổ sung mang đúng violation_id (đã encode) để deep-link tới đúng lỗi');

ctx.window.location.pathname = '/admin/checklist';
action = api.checklistNotificationAction({ eventCode: 'EXPLANATION_SUBMITTED', subjectType: 'violation_task', subjectId: 'task-9', targetPath: '/admin/checklist/viec-can-xu-ly' });
check(action.label === 'Xử lý', '2a. EXPLANATION_SUBMITTED -> CTA "Xử lý" (khác "Xem lỗi", đúng nghiệp vụ "cần xử lý")');
check(action.path === '/admin/checklist/viec-can-xu-ly?focus=task&task_id=task-9', '2b. EXPLANATION_SUBMITTED mang đúng focus=task&task_id= trên route admin đã có sẵn (route này vốn đã hợp lệ, chỉ thêm deep-link)');

action = api.checklistNotificationAction({ eventCode: 'PERMISSION_CHANGED', subjectType: 'permission_grant', subjectId: 'g1', targetPath: '/ql/checklist' });
check(action.type === 'NONE' && action.label === '', '3a. PERMISSION_CHANGED (thông báo hệ thống) vẫn KHÔNG có CTA - giữ nguyên "nhẹ" như trước, không nâng thành actionable');
check(api.checklistNotificationTone({ eventCode: 'PERMISSION_CHANGED', priority: 'Trung bình' }) === 'info', '3b. Tone PERMISSION_CHANGED = info (neutral) - đúng phân loại A. INFORMATION');
check(api.checklistNotificationTone({ eventCode: 'VIOLATION_CREATED', priority: 'Cao' }) === 'warning', '3c. Tone VIOLATION_CREATED (priority Cao) = warning (cam), không phải đỏ - đúng phân loại B. ACTION REQUIRED mức thường');
check(api.checklistNotificationTone({ eventCode: 'VIOLATION_CREATED', priority: 'Khẩn' }) === 'danger', '3d. Chỉ priority=Khẩn (nghiệp vụ overdue/critical thật) mới lên đỏ, không tô đỏ toàn bộ notification lỗi');

// ---------- 2. Backward-compat: notification cũ thiếu subjectId ----------
ctx.window.location.pathname = '/hv/checklist';
action = api.checklistNotificationAction({ eventCode: 'VIOLATION_CREATED', subjectType: 'violation_batch', subjectId: '', targetPath: '/hv/checklist/viec-can-xu-ly' });
check(action.type === 'OPEN_CHECKLIST_TASK' && action.label === 'Xem lỗi', '4a. Notification cũ (subjectType=violation_batch, subjectId rỗng) vẫn nhận diện đúng là actionable, CTA "Xem lỗi"');
check(action.path.indexOf('focus=violation') < 0, '4b. Notification cũ không có subjectId -> KHÔNG gắn query focus/violation_id (không giả vờ có dữ liệu không tồn tại) -> fallback về route hiện tại, không crash');

// ---------- 3. employeeTaskInboxHtml() highlight đúng violation theo deep-link ----------
api.roleWorkspaceState.taskLoading = false;
api.roleWorkspaceState.taskLoaded = true;
api.roleWorkspaceState.tasks = [
  { id: 't1', violation_id: 'v1', status: 'waiting_employee', due_at: '', created_by_name: 'Giám sát A', violation: { id: 'v1', criterion_name: 'Đồng phục', criterion_group: 'Tác phong', note: 'Thiếu bảng tên', occurred_date: '2026-08-05' } },
  { id: 't2', violation_id: 'v2', status: 'waiting_employee', due_at: '', created_by_name: 'Giám sát B', violation: { id: 'v2', criterion_name: 'Vệ sinh quầy', criterion_group: 'Vận hành', note: 'Chưa dọn quầy', occurred_date: '2026-08-05' } }
];

ctx.window.location.pathname = '/hv/checklist';
ctx.window.location.search = '';
let html = api.employeeTaskInboxHtml();
check(html.indexOf('phfck-notification-focus') < 0, '5a. Không có query deep-link -> không thẻ nào bị đánh dấu "Từ thông báo" (không giả vờ có ngữ cảnh khi không có)');

ctx.window.location.search = '?focus=violation&violation_id=v1';
html = api.employeeTaskInboxHtml();
check(/data-phfck-focus-violation="1"[^]*?Đồng phục/.test(html), '5b. Có deep-link violation_id=v1 -> đúng thẻ lỗi v1 (Đồng phục) được đánh dấu data-phfck-focus-violation');
check(html.indexOf('Từ thông báo') >= 0, '5c. Thẻ được đánh dấu có chỉ báo "Từ thông báo" (nhẹ, không phải toàn row đỏ/nhấp nháy)');
const v2Card = html.slice(html.indexOf('Vệ sinh quầy') - 400, html.indexOf('Vệ sinh quầy'));
check(v2Card.indexOf('phfck-notification-focus') < 0, '5d. Thẻ lỗi khác (v2) trong CÙNG danh sách KHÔNG bị đánh dấu nhầm');

ctx.window.location.search = '?focus=violation&violation_id=v-not-exist';
html = api.employeeTaskInboxHtml();
check(html.indexOf('phfck-notification-focus') < 0 && html.indexOf('Đồng phục') >= 0, '5e. violation_id trỏ tới bản ghi không còn trong danh sách hiện tại (vd đã resolved/cancelled hoặc thuộc kỳ khác) -> không đánh dấu nhầm, không crash, danh sách vẫn hiển thị bình thường');

// ---------- 4. checklistNotificationFocusKeyFromLocation - key ổn định cho scroll-once guard ----------
ctx.window.location.pathname = '/hv/checklist';
ctx.window.location.search = '?focus=violation&violation_id=v1,v2';
check(api.checklistNotificationFocusKeyFromLocation('/hv/checklist?focus=violation&violation_id=v1,v2') === 'v:v1,v2', '6a. Key tính từ violation_id, ổn định giữa các lần re-render (dùng để chặn scroll lặp lại)');
check(api.checklistNotificationFocusKeyFromLocation('/hv/checklist') === '', '6b. Không có query -> key rỗng (không áp dụng focus scroll)');

if (failures) {
  console.error('\n' + failures + ' check(s) failed.');
  process.exit(1);
}
console.log('\nALL PASS');
