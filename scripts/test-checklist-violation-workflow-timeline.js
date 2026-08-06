'use strict';
/* Regression test cho timeline hợp nhất "LỊCH SỬ HOẠT ĐỘNG" trong modal
   "Chi tiết bản ghi" (Nhật ký lỗi) - assets/js/checklist/phf-checklist-app.js.

   Bug đã trace: modal chỉ gọi loadViolationHistory() (đọc
   checklist_violation_record_history) và loadViolationTaskStatus() (đọc
   TRẠNG THÁI hiện tại của task, không phải lịch sử), nên khi task đã
   "completed" (Hoàn tất) qua employee_confirm/reviewer_uphold/... người xem
   chỉ thấy đúng 1 dòng "Tạo bản ghi" - không có gì giải thích vì sao Hoàn
   tất, dù checklist_violation_task_history (đọc qua action
   getChecklistTaskHistory ĐÃ CÓ SẴN, dùng chung với modal "Việc cần xử lý")
   có đầy đủ bằng chứng.

   Fix: violationHistoryHtml(id) giờ merge 2 nguồn (record_history +
   task_history qua loadViolationTaskHistoryForRecord), dedupe đúng 1 sự
   kiện "Tạo bản ghi" khi cả 2 nguồn cùng phản ánh việc tạo (timestamp gần
   nhau), sort theo thời gian, và fail-soft khi task_history lỗi/không có.

   Cùng convention vm-sandbox với
   scripts/test-checklist-monthly-branch-search-counters.js. Không có jsdom.

   File này KHÔNG được gọi tự động ở bất kỳ đâu - chỉ chạy thủ công:
     node scripts/test-checklist-violation-workflow-timeline.js
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
  const expose = "\n  window.__phfckTimelineTest={violationLogState:violationLogState,violationHistoryHtml:violationHistoryHtml,taskHistoryLabel:taskHistoryLabel,violationHistoryActionLabel:violationHistoryActionLabel,loadViolationTaskHistoryForRecord:loadViolationTaskHistoryForRecord,openViolationLogDetail:openViolationLogDetail};\n";
  return originalSource.slice(0, idx) + expose + originalSource.slice(idx);
}

function buildSandbox(fetchImpl) {
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
  sandbox.fetch = fetchImpl || function(){ return Promise.resolve({ ok:true, json: function(){ return Promise.resolve({}); } }); };
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
const api = ctx.window.__phfckTimelineTest;

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}
function reset() {
  api.violationLogState.history = {};
  api.violationLogState.historyLoading = {};
  api.violationLogState.taskHistory = {};
  api.violationLogState.taskHistoryLoading = {};
  api.violationLogState.taskHistoryError = {};
}

// ---------- 1+2. PHF076-like: create+created (đồng thời) phải gộp thành đúng 1 dòng, không duplicate ----------
reset();
const ID = 'REC-PHF076';
api.violationLogState.history[ID] = [
  { action: 'create', changed_by_name: 'Nguyễn Thị Lệ', changed_at: '2026-08-06T11:05:21.384725+00:00', reason: 'Tạo bản ghi lỗi' }
];
api.violationLogState.taskHistory[ID] = [
  { action: 'created', actor_name: 'Nguyễn Thị Lệ', created_at: '2026-08-06T11:05:21.384725+00:00', note: 'Tạo việc từ lỗi chính thức' },
  { action: 'employee_confirm', actor_name: 'Võ Phương Diệu', created_at: '2026-08-06T12:37:30.285538+00:00', note: 'Nhân viên xác nhận lỗi' }
];
let html = api.violationHistoryHtml(ID);
const articleCount = (html.match(/<article>/g) || []).length;
check(articleCount === 2, '1a. Timeline PHF076 hiện đúng 2 sự kiện (không phải 3) - đã gộp "Tạo bản ghi"/"Tạo việc" đồng thời thành 1, got ' + articleCount);
check(html.indexOf('Tạo bản ghi') >= 0 && html.indexOf('Nguyễn Thị Lệ') >= 0, '1b. Sự kiện đầu: "Tạo bản ghi" - Nguyễn Thị Lệ');
check(html.indexOf('Nhân viên đồng ý') >= 0 && html.indexOf('Võ Phương Diệu') >= 0, '1c. Sự kiện sau: "Nhân viên đồng ý" (employee_confirm) - Võ Phương Diệu, giải thích được vì sao "Hoàn tất"');
check(html.indexOf('2026-08-06 11:05') >= 0 && html.indexOf('2026-08-06 12:37') >= 0, '1d. Thời gian hiển thị đúng cho cả 2 sự kiện (11:05 và 12:37)');
check(html.indexOf('Tạo việc') === -1, '2. Không hiện riêng dòng "Tạo việc" (task created) trùng nghĩa với "Tạo bản ghi" đã gộp');

// ---------- 3. Giải trình (employee_explain) hiện đúng note/actor ----------
reset();
api.violationLogState.history[ID] = [{ action: 'create', changed_by_name: 'Lê Vĩnh Thắng', changed_at: '2026-08-04T11:15:18+00:00', reason: 'Tạo bản ghi lỗi' }];
api.violationLogState.taskHistory[ID] = [
  { action: 'created', actor_name: 'Lê Vĩnh Thắng', created_at: '2026-08-04T11:15:18+00:00', note: 'Tạo việc từ lỗi chính thức' },
  { action: 'employee_explain', actor_name: 'Nguyễn Văn A', created_at: '2026-08-04T15:00:00+00:00', note: 'Tôi không có mặt tại vị trí lúc đó' }
];
html = api.violationHistoryHtml(ID);
check(html.indexOf('Nhân viên gửi ý kiến') >= 0, '3a. employee_explain hiện đúng nhãn tiếng Việt "Nhân viên gửi ý kiến"');
check(html.indexOf('Nguyễn Văn A') >= 0 && html.indexOf('Tôi không có mặt tại vị trí lúc đó') >= 0, '3b. Đúng actor và note của employee_explain');

// ---------- 4. Quản lý xử lý (reviewer_uphold) hiện đúng actor/lý do ----------
api.violationLogState.taskHistory[ID].push({ action: 'reviewer_uphold', actor_name: 'Trưởng ca B', created_at: '2026-08-05T09:00:00+00:00', note: 'Có camera ghi nhận rõ, giữ nguyên lỗi' });
html = api.violationHistoryHtml(ID);
check(html.indexOf('Người ghi giữ nguyên lỗi') >= 0, '4a. reviewer_uphold hiện đúng nhãn "Người ghi giữ nguyên lỗi"');
check(html.indexOf('Trưởng ca B') >= 0 && html.indexOf('Có camera ghi nhận rõ, giữ nguyên lỗi') >= 0, '4b. Đúng actor và lý do của reviewer_uphold');

// ---------- 5. Hủy trực tiếp (cancel_violation_direct) hiện đúng người thực hiện/lý do ----------
reset();
api.violationLogState.history[ID] = [{ action: 'create', changed_by_name: 'HR Phuhoa Fresh', changed_at: '2026-07-30T09:12:12+00:00', reason: 'Tạo bản ghi lỗi' }];
api.violationLogState.taskHistory[ID] = [
  { action: 'created', actor_name: 'HR Phuhoa Fresh', created_at: '2026-07-30T09:12:12+00:00', note: 'Tạo việc từ lỗi chính thức' },
  { action: 'employee_confirm', actor_name: 'Lê Vĩnh Thắng', created_at: '2026-07-31T09:56:00+00:00', note: 'Nhân viên xác nhận lỗi' },
  { action: 'cancel_violation_direct', actor_name: 'HR Phuhoa Fresh', created_at: '2026-08-05T02:04:44+00:00', note: 'hủy phiếu do dữ liệu test' }
];
html = api.violationHistoryHtml(ID);
check(html.indexOf('Hủy trực tiếp') >= 0, '5a. cancel_violation_direct hiện đúng nhãn "Hủy trực tiếp"');
check(html.indexOf('hủy phiếu do dữ liệu test') >= 0, '5b. Đúng lý do của cancel_violation_direct');
check((html.match(/<article>/g) || []).length === 3, '5c. Đủ 3 sự kiện: Tạo bản ghi (gộp) + Nhân viên xác nhận + Hủy trực tiếp');

// ---------- 6. Bản ghi không có task (dữ liệu cũ/is_test): record history vẫn hiện bình thường, không lỗi giả ----------
reset();
api.violationLogState.history[ID] = [{ action: 'create', changed_by_name: 'Admin', changed_at: '2026-06-01T00:00:00+00:00', reason: 'Tạo bản ghi lỗi' }];
// KHÔNG set taskHistory[ID] - giả lập loadViolationTaskHistoryForRecord đã chạy và set về [] vì task=null (xem test riêng bên dưới), taskHistoryError để trống.
api.violationLogState.taskHistory[ID] = [];
api.violationLogState.taskHistoryError[ID] = '';
html = api.violationHistoryHtml(ID);
check(html.indexOf('Tạo bản ghi') >= 0, '6a. Bản ghi không có task: vẫn hiện đúng lịch sử bản ghi (Tạo bản ghi)');
check(html.indexOf('Không thể tải đầy đủ diễn biến') === -1, '6b. Không hiện cảnh báo lỗi giả khi đơn giản là không có task (không phải lỗi permission)');

// ---------- 7. Task history API lỗi (403 ngoài scope): record history vẫn render, có cảnh báo fail-soft, KHÔNG mất cả modal ----------
reset();
api.violationLogState.history[ID] = [{ action: 'create', changed_by_name: 'Admin', changed_at: '2026-06-01T00:00:00+00:00', reason: 'Tạo bản ghi lỗi' }];
api.violationLogState.taskHistory[ID] = [];
api.violationLogState.taskHistoryError[ID] = 'Bạn không có quyền xem lịch sử công việc này.';
html = api.violationHistoryHtml(ID);
check(html.indexOf('Tạo bản ghi') >= 0, '7a. Task history lỗi: lịch sử BẢN GHI vẫn render đầy đủ, modal không trống');
check(html.indexOf('Không thể tải đầy đủ diễn biến xử lý') >= 0, '7b. Có cảnh báo fail-soft rõ ràng cho phần diễn biến xử lý bị thiếu (không im lặng bỏ qua)');

// ---------- 8. loadViolationTaskHistoryForRecord: task=null -> không gọi fetch, không lỗi giả ----------
(async () => {
  reset();
  let fetchCalled = false;
  const ctxNoTask = buildSandbox(function(){ fetchCalled = true; return Promise.resolve({ ok:true, json: function(){ return Promise.resolve({ ok:true, history: [] }); } }); });
  new vm.Script(buildTestSource(), { filename: filePath }).runInContext(ctxNoTask);
  const apiNoTask = ctxNoTask.window.__phfckTimelineTest;
  apiNoTask.violationLogState.taskStatus[ID] = null; // record không có task (dữ liệu cũ)
  await apiNoTask.loadViolationTaskHistoryForRecord(null, ID);
  check(fetchCalled === false, '8a. Không có task -> loadViolationTaskHistoryForRecord KHÔNG gọi fetch (tránh gọi API thừa/lỗi giả)');
  check(Array.isArray(apiNoTask.violationLogState.taskHistory[ID]) && apiNoTask.violationLogState.taskHistory[ID].length === 0, '8b. taskHistory được set về mảng rỗng an toàn');
  check(apiNoTask.violationLogState.taskHistoryError[ID] === '', '8c. Không set lỗi khi đơn giản là không có task');

  // ---------- 9. loadViolationTaskHistoryForRecord: backend trả 403 -> fail-soft, không throw ra ngoài ----------
  const ctxForbidden = buildSandbox(function(){ return Promise.resolve({ ok:false, status:403, json: function(){ return Promise.resolve({ ok:false, message:'Bạn không có quyền xem lịch sử công việc này.' }); } }); });
  new vm.Script(buildTestSource(), { filename: filePath }).runInContext(ctxForbidden);
  const apiForbidden = ctxForbidden.window.__phfckTimelineTest;
  apiForbidden.violationLogState.taskStatus[ID] = { id: 'task-123', status: 'completed' };
  let threw = false;
  try { await apiForbidden.loadViolationTaskHistoryForRecord(null, ID); } catch (e) { threw = true; }
  check(threw === false, '9a. Backend 403 -> loadViolationTaskHistoryForRecord KHÔNG throw ra ngoài (fail-soft), openViolationLogDetail vẫn mở được modal');
  check(apiForbidden.violationLogState.taskHistoryError[ID].length > 0, '9b. Lỗi được ghi vào taskHistoryError để UI hiện cảnh báo đúng');
  check(Array.isArray(apiForbidden.violationLogState.taskHistory[ID]) && apiForbidden.violationLogState.taskHistory[ID].length === 0, '9c. taskHistory về mảng rỗng an toàn khi lỗi (không giữ dữ liệu cũ gây hiểu nhầm)');

  if (failures) {
    console.error('\n' + failures + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nALL PASS');
})();
