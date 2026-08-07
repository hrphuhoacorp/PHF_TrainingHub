'use strict';
/* Batch 1.43.4 - "Cover cá nhân + Actionable notification" + UAT fix round
   (1.43.4 Production acceptance = NO-GO, xem phần "UAT fix" cuối file):
   - "Checklist đang áp dụng" trước đó chỉ là card định danh (rolePersonCardHtml),
     không hiển thị đúng Checklist assignment hằng ngày thật (vd TBP-QTTH) -
     thêm ownChecklistDetailBodyHtml() đọc đúng checklist_employee_assignments
     + checklist_templates (reuse dữ liệu đã có cho luồng Ghi nhận lỗi).
   - Deep-link từ thông báo trước đó chỉ highlight employeeTaskInboxHtml()
     ("Việc cần tôi xử lý"), nhưng theo evidence UAT Production, user thực tế
     nhìn vào "Điểm Checklist tự động" (roleMonthlyChecklistBreakdownHtml) -
     thêm auto-expand + highlight đúng chỗ đó, dùng lại đúng
     data-phfck-focus-violation="1" đã có, không tạo cơ chế highlight mới.
   - roleWorkspaceState.taskLoaded/monthlyLoaded chỉ nạp 1 lần/phiên - nếu lỗi
     mới phát sinh sau lần nạp gần nhất, danh sách trong bộ nhớ không có lỗi
     đó. applyChecklistNotificationFocusScroll() ép nạp lại đúng 1 lần/deep-link
     key khi chưa tìm thấy bản ghi tương ứng.

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
  const expose = "\n  window.__phfckNotifTest={checklistNotificationAction:checklistNotificationAction,checklistNotificationTone:checklistNotificationTone,checklistNotificationFocusViolationIds:checklistNotificationFocusViolationIds,checklistNotificationFocusTaskId:checklistNotificationFocusTaskId,checklistNotificationFocusKeyFromLocation:checklistNotificationFocusKeyFromLocation,employeeTaskInboxHtml:employeeTaskInboxHtml,roleWorkspaceState:roleWorkspaceState,notificationUiState:notificationUiState,checklistNotificationInboxHtml:checklistNotificationInboxHtml,ownChecklistDetailBodyHtml:ownChecklistDetailBodyHtml,roleMonthlyChecklistBreakdownHtml:roleMonthlyChecklistBreakdownHtml,checklistTemplateDbState:checklistTemplateDbState,checklistNotificationFocusState:checklistNotificationFocusState};\n";
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

// ================================================================
// UAT fix (Production 1.43.4 NO-GO) - "Checklist đang áp dụng" phải là
// ĐÚNG Checklist assignment hằng ngày (checklist_employee_assignments +
// checklist_templates), KHÔNG phải dòng CT-03 tự động trong Phiếu tháng.
// ================================================================
check(app.indexOf('function ownChecklistDetailBodyHtml(assignment)') >= 0,
  'UAT-1. Có hàm ownChecklistDetailBodyHtml() riêng cho "Checklist đang áp dụng" - không tái dùng nhầm dữ liệu Phiếu tháng (CT-03)');
check((app.match(/rolePersonCardHtml\(data\.ownAssignment,true\)\+ownChecklistDetailBodyHtml\(data\.ownAssignment\)/g) || []).length === 3,
  'UAT-2a. Cả 3 khối "Checklist đang áp dụng" đều render thêm ownChecklistDetailBodyHtml(data.ownAssignment) ngay sau card định danh');
check((app.match(/ownChecklistDetailBodyHtml\(data\.ownAssignment\)/g) || []).length === 3,
  'UAT-2b. ownChecklistDetailBodyHtml(data.ownAssignment) xuất hiện đúng 3 lần (khớp đúng 3 nơi hiển thị "Checklist đang áp dụng")');

api.checklistTemplateDbState.ready = false;
check(api.ownChecklistDetailBodyHtml(null).indexOf('Chưa liên kết hồ sơ Checklist') >= 0,
  'UAT-3. Chưa có ownAssignment (chưa được phân công) -> hiển thị rõ "Chưa liên kết hồ sơ Checklist", không hiện trống trơn');
check(api.ownChecklistDetailBodyHtml({ templateId: 'tbp-qtth', templateVersion: 'TBP-QTTH-1.0' }).indexOf('Đang tải Checklist đang áp dụng') >= 0,
  'UAT-4. Có ownAssignment nhưng thư viện mẫu (checklistTemplateDbState) chưa nạp xong -> hiện trạng thái "Đang tải", không hiện trống hoặc sai dữ liệu');

api.checklistTemplateDbState.ready = true;
api.checklistTemplateDbState.byId = {};
check(api.ownChecklistDetailBodyHtml({ templateId: 'tbp-qtth', templateVersion: 'TBP-QTTH-1.0' }).indexOf('Chưa tìm thấy mẫu Checklist tương ứng') >= 0,
  'UAT-5. Thư viện mẫu đã nạp nhưng KHÔNG có template khớp templateId -> báo rõ ràng để Admin kiểm tra, không giả vờ có dữ liệu');

api.checklistTemplateDbState.byId = {
  'tbp-qtth': {
    templateKey: 'tbp-qtth', code: 'TBP-QTTH', name: 'Checklist Quản trị tổng hợp', version: '1.0',
    definition: { groups: [{ name: 'Tác phong', children: [{ name: 'Tác phong', items: [['CT-01', 'Mặc đồng phục đúng quy định', 1], ['CT-02', 'Đeo bảng tên', 1]] }] }], totalRows: [] }
  }
};
const ownHtml = api.ownChecklistDetailBodyHtml({ templateId: 'tbp-qtth', templateVersion: 'TBP-QTTH-1.0', effectiveDate: '2026-07-01' });
check(ownHtml.indexOf('Checklist Quản trị tổng hợp') >= 0 && ownHtml.indexOf('TBP-QTTH') >= 0,
  'UAT-6. Có đúng assignment + template -> hiển thị đúng tên/mã Checklist đang áp dụng thật (TBP-QTTH), không phải mẫu Phiếu tháng');
check(ownHtml.indexOf('Xem chi tiết') >= 0 && ownHtml.indexOf('CT-01') >= 0 && ownHtml.indexOf('Mặc đồng phục đúng quy định') >= 0,
  'UAT-7. Có action "Xem chi tiết" mở đúng danh sách tiêu chí thật của Checklist assignment (CT-01/CT-02), không phải dòng CT-03 của Phiếu tháng');
check(ownHtml.indexOf('01/07/2026') >= 0 || ownHtml.indexOf('2026') >= 0,
  'UAT-8. Hiển thị hiệu lực hiện tại (effectiveDate) của assignment');

// ---------- roleMonthlyChecklistBreakdownHtml() cũng phải nhận deep-link (đây là nơi user THẬT SỰ nhìn vào theo UAT) ----------
const formWithBreakdown = {
  checklist_score: 90, checklist_breakdown: {
    baseScore: 100, totalPoints: 10, score: 90,
    violations: [
      { id: 'v-real-1', criterionCode: 'CT-03', criterionName: 'Tuân thủ tiêu chuẩn công việc', note: 'Vi phạm thật', points: 10, occurredDate: '2026-08-05' }
    ]
  }
};
ctx.window.location.pathname = '/ql/checklist';
ctx.window.location.search = '?section=my-work&focus=violation&violation_id=v-real-1';
const breakdownHtml = api.roleMonthlyChecklistBreakdownHtml(formWithBreakdown);
check(/<details class="phfck-checklist-breakdown" open>/.test(breakdownHtml),
  'UAT-9. Deep-link đúng violation_id trong Điểm Checklist tự động -> tự mở <details> (không bắt user tự bấm "Xem N lỗi")');
check(breakdownHtml.indexOf('data-phfck-focus-violation="1"') >= 0 && breakdownHtml.indexOf('Từ thông báo') >= 0,
  'UAT-10. Đúng dòng lỗi (v-real-1) được đánh dấu "Từ thông báo" trong Điểm Checklist tự động - đúng chỗ user thật sự nhìn vào theo evidence UAT Production');

ctx.window.location.search = '?section=my-work';
const breakdownHtmlNoFocus = api.roleMonthlyChecklistBreakdownHtml(formWithBreakdown);
check(!/<details class="phfck-checklist-breakdown" open>/.test(breakdownHtmlNoFocus) && breakdownHtmlNoFocus.indexOf('data-phfck-focus-violation') < 0,
  'UAT-11. Không có deep-link -> KHÔNG tự mở <details>, hành vi mặc định giữ nguyên như trước (không thay đổi UX cho truy cập bình thường)');

// ---------- Nạp lại dữ liệu 1 lần khi deep-link tới nhưng chưa tìm thấy record (tránh cache "đã nạp trong phiên" làm mất lỗi mới) ----------
check(app.indexOf('checklistNotificationFocusState.reloadedKey!==key&&roleWorkspaceState.loaded') >= 0,
  'UAT-12. applyChecklistNotificationFocusScroll() ép nạp lại dữ liệu (startRoleWorkspaceBackgroundLoads force=true) đúng 1 lần khi chưa thấy đúng bản ghi - tránh trường hợp roleWorkspaceState.taskLoaded/monthlyLoaded đã nạp TRƯỚC KHI lỗi mới phát sinh trong cùng phiên');

if (failures) {
  console.error('\n' + failures + ' check(s) failed.');
  process.exit(1);
}
console.log('\nALL PASS');
