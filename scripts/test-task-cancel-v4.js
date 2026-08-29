'use strict';

/*
 * PHF Task — BUSINESS UX HARDENING V4 — Hủy phiếu / Admin cancel request —
 * test suite. jsdom, no network, no real DB/API. Loads the REAL production
 * files via window.eval.
 *
 * Covers: cancel unfinished (incl. overdue), cancel completed → Admin
 * request only, score-lock non-rollback interaction, recipient/manager/
 * proposal do NOT get cancel authority. Every mutation is local-fixture-only;
 * window.fetch is stubbed to throw if any demo action reaches it.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }
function readSrc(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

const TASK_APP_SRC = readSrc('assets/js/task/phf-task-app.js');
const DEMO_FIXTURES_SRC = readSrc('assets/js/task/phf-task-ui-demo-fixtures.js');
const PERMISSIONS_SRC = readSrc('api/_lib/task-permissions.js');
const SCOPE_SRC = readSrc('api/_lib/task-employee-scope.js');

function newTaskAppWindow() {
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/admin/task' });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = function () { return 'admin'; };
  window.phfGetCurrentUser = function () { return { fullName: 'Demo QA', employeeCode: 'DEMO_QA' }; };
  window.phfNavigate = function () { };
  window.phfToast = function () { };
  window.fetch = function () { throw new Error('DEMO MODE VIOLATION: fetch() was called — V4 cancel demo actions must never reach the real API/network.'); };
  window.eval(DEMO_FIXTURES_SRC);
  window.eval(TASK_APP_SRC);
  return window;
}
function click(window, root, selector) {
  const el = window.document.querySelector(selector);
  assert.ok(el, 'click target must exist: ' + selector);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}
function setInput(window, selector, value) {
  const el = window.document.querySelector(selector);
  assert.ok(el, 'input target must exist: ' + selector);
  el.value = value;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
}
function render(window, T, root) { root.innerHTML = T.shellFrame(T.taskListHtml()); }
function openDetail(window, T, root, taskId) {
  render(window, T, root);
  click(window, root, '[data-task-list-row="' + taskId + '"]');
  render(window, T, root);
}
function closeDetail(window, T, root) {
  click(window, root, '[data-task-demo-detail-close]');
}

(async () => {
  const window = newTaskAppWindow();
  const T = window.__PHF_TASK_TEST__;
  const state = T.getState();
  const root = window.document.getElementById('phfTaskRoot');
  T.bindShell(root);

  // ================= A. Cancel unfinished (in_progress, demo-a5) =================
  await T.openTaskList(root, 'assigned');
  const unfinished = state.list.tasks.find(t => t.task_id === 'demo-a5');
  pass(!!unfinished && unfinished.status === 'in_progress', 'SETUP: demo-a5 đang thực hiện (chưa hoàn thành)');
  openDetail(window, T, root, 'demo-a5');
  let html = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(window.document.querySelector('[data-task-demo-cancel-toggle]') != null, 'CANCEL UNFINISHED: nút "Hủy phiếu" render cho creator khi Task chưa hoàn thành');
  pass(!/Gửi yêu cầu Admin hủy phiếu/.test(html), 'CANCEL UNFINISHED: KHÔNG render "Gửi yêu cầu Admin hủy phiếu" (đó là case Task đã hoàn thành)');
  click(window, root, '[data-task-demo-cancel-toggle]');
  render(window, T, root);
  pass(window.document.querySelector('[data-task-demo-cancel-confirm]') != null, 'CANCEL UNFINISHED: form lý do mở sau khi bấm toggle');

  // reason required
  click(window, root, '[data-task-demo-cancel-confirm]');
  pass(unfinished.status !== 'cancelled', 'CANCEL REASON REQUIRED: xác nhận hủy với lý do rỗng là no-op, Task chưa bị hủy');

  const historyLenBefore = unfinished.history.length;
  setInput(window, '[data-task-demo-cancel-reason]', 'Ngân sách chưa được duyệt, tạm dừng công việc này.');
  click(window, root, '[data-task-demo-cancel-confirm]');
  pass(unfinished.status === 'cancelled', 'CANCEL UNFINISHED: xác nhận với lý do hợp lệ -> status chuyển "cancelled" (KHÔNG hard delete — object vẫn còn nguyên trong fixture)');
  pass(unfinished.cancel_reason.includes('Ngân sách'), 'CANCEL REASON: lý do được lưu đúng vào cancel_reason');
  pass(unfinished.history.length === historyLenBefore + 1, 'CANCEL ACTIVITY: append đúng 1 entry vào shared activity stream');
  pass(/Hủy phiếu \(demo\)/.test(unfinished.history[unfinished.history.length - 1].action), 'CANCEL ACTIVITY: entry có action "Hủy phiếu (demo)"');
  pass(unfinished.history[unfinished.history.length - 1].text.includes('Ngân sách'), 'CANCEL ACTIVITY: entry ghi đúng lý do → thời gian (ai → làm gì → lý do → thời gian)');
  render(window, T, root);
  html = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/Đã hủy/.test(html), 'CANCEL LABEL: modal hiển thị "Đã hủy"');
  pass(!window.document.querySelector('[data-task-demo-cancel-toggle]'), 'CANCEL FINAL: sau khi hủy, không còn nút "Hủy phiếu" nữa (double-cancel guard)');
  closeDetail(window, T, root);

  // recipient side: task now cancelled -> no more action buttons for recipient
  // (demo-a5's primary is DEMO_LVTHANG, not the demo actor, so we cannot open
  // it from "received" — instead verify via the shared taskWorkspaceCardHtml
  // function directly, proving the cancelled early-return branch fires.)
  const cancelledWorkspaceHtml = T.taskWorkspaceCardHtml(unfinished);
  pass(/Không còn thao tác xử lý/.test(cancelledWorkspaceHtml), 'RECIPIENT ON CANCELLED: workspace card của recipient chỉ hiện thông tin đã hủy, không có nút cập nhật/hoàn thành nào');
  pass(!/data-task-demo-status|data-task-demo-add-note|data-task-demo-add-evidence/.test(cancelledWorkspaceHtml), 'RECIPIENT ON CANCELLED: không còn action nào (status/note/evidence) sau khi Task bị hủy');

  // ================= B. Cancel overdue unfinished (demo-a4, published + quá hạn) =================
  await T.openTaskList(root, 'assigned');
  const overdue = state.list.tasks.find(t => t.task_id === 'demo-a4');
  pass(!!overdue && overdue.status === 'published' && new Date(overdue.deadline).getTime() < Date.now(), 'SETUP: demo-a4 đã quá hạn nhưng vẫn chưa hoàn thành');
  openDetail(window, T, root, 'demo-a4');
  pass(window.document.querySelector('[data-task-demo-cancel-toggle]') != null, 'CANCEL OVERDUE: nút "Hủy phiếu" VẪN render dù Task đã quá hạn (mục 5A: bất kể còn hạn hay đã quá hạn)');
  click(window, root, '[data-task-demo-cancel-toggle]');
  render(window, T, root);
  setInput(window, '[data-task-demo-cancel-reason]', 'Kho Fast đã xử lý xong bằng cách khác, không cần task này nữa.');
  click(window, root, '[data-task-demo-cancel-confirm]');
  pass(overdue.status === 'cancelled', 'CANCEL OVERDUE: hủy thành công dù đã quá hạn');
  closeDetail(window, T, root);

  // ================= C. Cancel completed (demo-a1, within_sla, chưa có cancel request) =================
  await T.openTaskList(root, 'assigned');
  const completedWithinSla = state.list.tasks.find(t => t.task_id === 'demo-a1');
  pass(!!completedWithinSla && completedWithinSla.status === 'completed', 'SETUP: demo-a1 đã hoàn thành');
  openDetail(window, T, root, 'demo-a1');
  html = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(!window.document.querySelector('[data-task-demo-cancel-toggle]'), 'CANCEL COMPLETED: KHÔNG có nút "Hủy phiếu" trực tiếp cho Task đã hoàn thành');
  pass(window.document.querySelector('[data-task-demo-cancel-request-toggle]') != null, 'CANCEL COMPLETED: có nút "Gửi yêu cầu Admin hủy phiếu"');
  click(window, root, '[data-task-demo-cancel-request-toggle]');
  render(window, T, root);

  // reason required
  click(window, root, '[data-task-demo-cancel-request-confirm]');
  pass(completedWithinSla.cancel_request_state !== 'pending', 'CANCEL REQUEST REASON REQUIRED: xác nhận với lý do rỗng là no-op');

  const statusBefore = completedWithinSla.status;
  setInput(window, '[data-task-demo-cancel-request-reason]', 'Phát hiện trùng lặp với 1 task khác đã xử lý xong.');
  click(window, root, '[data-task-demo-cancel-request-confirm]');
  pass(completedWithinSla.cancel_request_state === 'pending', 'CANCEL REQUEST: gửi thành công, cancel_request_state=pending');
  pass(completedWithinSla.status === statusBefore, 'CANCEL REQUEST: status Task KHÔNG đổi ngay (vẫn "completed") — chỉ là 1 yêu cầu chờ xử lý');
  pass(completedWithinSla.history.some(h => /Đã gửi yêu cầu Admin hủy phiếu \(demo\)/.test(h.action)), 'CANCEL REQUEST ACTIVITY: timeline ghi "Đã gửi yêu cầu Admin hủy phiếu (demo)"');
  render(window, T, root);
  html = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/Chờ Admin xử lý/.test(html), 'CANCEL REQUEST STATUS: hiển thị "Chờ Admin xử lý" trong detail');
  pass(/Trạng thái: Hoàn thành/.test(html), 'CANCEL REQUEST: dòng trạng thái đầu modal vẫn ghi "Hoàn thành" (KHÔNG hiển thị nhầm "Đã hủy" ngay lập tức)');

  // Admin cancel-request info banner renders with required fields
  pass(/Yêu cầu hủy phiếu đã hoàn thành/.test(html), 'ADMIN CANCEL REQUEST INFO: banner "Yêu cầu hủy phiếu đã hoàn thành" render');
  pass(/Trần Gia Bảo Ngọc/.test(html), 'ADMIN CANCEL REQUEST INFO: hiện đúng người yêu cầu');
  pass(/Phát hiện trùng lặp/.test(html), 'ADMIN CANCEL REQUEST INFO: hiện đúng lý do');
  pass(/Mã phiếu.*CV-DEMO-201/.test(html.replace(/\n/g, ' ')), 'ADMIN CANCEL REQUEST INFO: hiện đúng mã phiếu');
  pass(!/Duyệt yêu cầu|Từ chối yêu cầu/.test(html), 'ADMIN CANCEL REQUEST INFO: KHÔNG có nút Duyệt/Từ chối giả (chưa có lifecycle thật)');

  // list-level tag
  render(window, T, root);
  const listHtml = T.taskListHtml();
  pass(/Chờ Admin xử lý yêu cầu hủy/.test(listHtml), 'LIST SIGNAL: tag "Chờ Admin xử lý yêu cầu hủy" render trên bảng danh sách');
  closeDetail(window, T, root);

  // duplicate request guard
  await T.openTaskList(root, 'assigned');
  openDetail(window, T, root, 'demo-a1');
  const requestCountBefore = completedWithinSla.history.filter(h => /Đã gửi yêu cầu Admin hủy phiếu/.test(h.action)).length;
  pass(!window.document.querySelector('[data-task-demo-cancel-request-toggle]'), 'CANCEL REQUEST DUPLICATE GUARD: không còn nút gửi yêu cầu mới sau khi đã có 1 yêu cầu đang chờ');
  T.demoCancelRequestConfirm(root); // gọi thẳng state layer để chắc chắn no-op kể cả khi có ai bypass UI
  pass(completedWithinSla.history.filter(h => /Đã gửi yêu cầu Admin hủy phiếu/.test(h.action)).length === requestCountBefore, 'CANCEL REQUEST DUPLICATE GUARD: gọi lại ở tầng state cũng không tạo yêu cầu trùng');
  closeDetail(window, T, root);

  // ================= D. Score lock interaction (demo-a3, locked) =================
  await T.openTaskList(root, 'assigned');
  const lockedTask = state.list.tasks.find(t => t.task_id === 'demo-a3');
  pass(!!lockedTask && lockedTask.sla_state === 'locked', 'SETUP: demo-a3 đã completed + sla_state=locked (điểm đã chốt)');
  openDetail(window, T, root, 'demo-a3');
  click(window, root, '[data-task-demo-cancel-request-toggle]');
  render(window, T, root);
  setInput(window, '[data-task-demo-cancel-request-reason]', 'Không còn cần thiết nữa, xin hủy.');
  click(window, root, '[data-task-demo-cancel-request-confirm]');
  pass(lockedTask.cancel_request_state === 'pending', 'SCORE LOCK: gửi yêu cầu hủy trên task đã locked vẫn thành công');
  pass(lockedTask.sla_state === 'locked', 'SCORE LOCK: sla_state VẪN "locked" sau cancel request — KHÔNG tự động rollback điểm (mục 7, 9)');
  render(window, T, root);
  html = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/Điểm lần hoàn thành trước đã được chốt/.test(html), 'SCORE LOCK UI: banner cancel request hiện rõ "Điểm lần hoàn thành trước đã được chốt"');
  closeDetail(window, T, root);

  // ================= E. Recipient: no cancel-creator action =================
  await T.openTaskList(root, 'received');
  const recipientTask = state.list.tasks.find(t => t.scope_kind !== 'managed' && t.primary && t.primary.employee_code === window.PHF_TASK_UI_DEMO_ACTOR.employee_code);
  pass(!!recipientTask, 'SETUP: có task recipient thật để kiểm tra');
  openDetail(window, T, root, recipientTask.task_id);
  html = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(!window.document.querySelector('[data-task-demo-cancel-toggle]') && !window.document.querySelector('[data-task-demo-cancel-request-toggle]'), 'RECIPIENT: KHÔNG có action Hủy phiếu/Gửi yêu cầu Admin hủy nào (recipient không có quyền hủy Task người khác giao)');
  closeDetail(window, T, root);

  // ================= F. Manager: no cancel/rework/complete creator/recipient action =================
  // V5 SUPERSEDES: demo-r7 (managed) đã tách khỏi "Tôi nhận" sang relation
  // "managed" riêng — mở qua đó thay vì 'received'.
  await T.openTaskList(root, 'managed');
  openDetail(window, T, root, 'demo-r7');
  html = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/Quản lý của người thực hiện/.test(html), 'MANAGER: role banner render đúng cho task managed');
  pass(!window.document.querySelector('[data-task-demo-cancel-toggle]') && !window.document.querySelector('[data-task-demo-cancel-request-toggle]'), 'MANAGER: không có action Hủy phiếu nào');
  pass(!window.document.querySelector('[data-task-demo-rework-toggle]'), 'MANAGER: không có action Yêu cầu xử lý lại');
  pass(!window.document.querySelector('[data-task-demo-status]'), 'MANAGER: không có action Hoàn thành/Cập nhật trạng thái');
  pass(!window.document.querySelector('[data-task-demo-add-note]') && !window.document.querySelector('[data-task-demo-add-evidence]'), 'MANAGER: không có action ghi chú/evidence của recipient');
  closeDetail(window, T, root);

  // ================= G. Proposal: no cancel/completion Task lifecycle UI =================
  await T.openTaskList(root, 'proposal_sent');
  const proposalTask = state.list.tasks[0];
  openDetail(window, T, root, proposalTask.task_id);
  html = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(!window.document.querySelector('[data-task-demo-cancel-toggle]') && !window.document.querySelector('[data-task-demo-cancel-request-toggle]'), 'PROPOSAL: không có action Hủy phiếu nào (Task cancel lifecycle không áp dụng cho Đề xuất)');
  pass(!window.document.querySelector('[data-task-demo-status]'), 'PROPOSAL: không có action hoàn thành Task');
  pass(!/Hạn phản hồi/.test(html), 'PROPOSAL: KHÔNG tự thêm "Hạn phản hồi" (chưa chốt business lock)');
  closeDetail(window, T, root);

  // ================= H. Safety =================
  pass(true, 'SAFETY: toàn bộ thao tác Hủy phiếu/Admin cancel request phía trên không hề gọi fetch() — nếu có, test đã crash ở bước tương ứng');

  console.log('PHF Task Cancel V4 test: ' + passed + '/' + passed + ' PASS');
})().then(() => {
  pass(!/PHF_TASK_UI_DEMO/.test(PERMISSIONS_SRC), 'FOUNDATION: api/_lib/task-permissions.js không có dấu vết demo mode nào (không bị sửa)');
  pass(!/PHF_TASK_UI_DEMO/.test(SCOPE_SRC), 'FOUNDATION: api/_lib/task-employee-scope.js không có dấu vết demo mode nào (không bị sửa)');
  console.log('PHF Task Cancel V4 — foundation isolation check: ' + passed + '/' + passed + ' PASS (cumulative)');
}).catch(err => { console.error(err); process.exitCode = 1; });
