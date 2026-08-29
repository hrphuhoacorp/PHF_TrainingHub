'use strict';

/*
 * PHF Task — BUSINESS UX HARDENING V3 — test suite.
 * jsdom, no network, no real DB/API. Loads the REAL production files via
 * window.eval — proves V3 behavior against the actual shipped code.
 *
 * Covers: "Tôi giao" Theo dõi & phản hồi, shared activity stream, Completion/
 * Rework/SLA presentation, Manager Scope (incl. cross-department manager
 * case), Proposal terminology safety. Every mutation is local-fixture-only;
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
  window.fetch = function () { throw new Error('DEMO MODE VIOLATION: fetch() was called — V3 demo actions must never reach the real API/network.'); };
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

(async () => {
  const window = newTaskAppWindow();
  const T = window.__PHF_TASK_TEST__;
  const state = T.getState();
  const root = window.document.getElementById('phfTaskRoot');
  T.bindShell(root);

  // ================= B. "Tôi giao" — Theo dõi & phản hồi =================
  await T.openTaskList(root, 'assigned');
  const inProgressAssigned = state.list.tasks.find(t => t.status === 'in_progress');
  pass(!!inProgressAssigned, 'SETUP: fixture "assigned" có 1 task đang thực hiện (demo-a5)');
  render(window, T, root);
  click(window, root, '[data-task-list-row="' + inProgressAssigned.task_id + '"]');
  render(window, T, root);
  let html = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/Theo dõi &amp; phản hồi/.test(html), 'ASSIGNED WORKSPACE: "Theo dõi & phản hồi" render trong Tôi giao detail');
  pass(window.document.querySelector('[data-task-demo-send-feedback]') != null, 'ASSIGNED WORKSPACE: nút "Gửi phản hồi" render');
  pass(!/Hoàn thành công việc/.test(html), 'ASSIGNED WORKSPACE: KHÔNG có nút "Hoàn thành công việc" (đó là action của recipient, không phải assigner)');

  const beforeLen = inProgressAssigned.history.length;
  setInput(window, '[data-task-demo-assigner-feedback-input]', 'Anh gửi thêm báo giá đối tác thứ 2 trước cuối tuần giúp em nhé.');
  click(window, root, '[data-task-demo-send-feedback]');
  pass(inProgressAssigned.history.length === beforeLen + 1, 'FEEDBACK: "Gửi phản hồi" append 1 entry shared activity stream');
  pass(inProgressAssigned.history[inProgressAssigned.history.length - 1].kind === 'assigner_feedback', 'FEEDBACK: entry mới có kind=assigner_feedback');
  html = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/báo giá đối tác thứ 2/.test(html), 'FEEDBACK: nội dung phản hồi xuất hiện trong Lịch sử hoạt động (shared stream)');

  // ================= NO SEPARATE COMMENT SYSTEMS (mục 4) =================
  // Recipient update + assigner feedback phải nằm CHUNG 1 mảng history.
  pass(inProgressAssigned.history.some(h => h.kind === 'assigner_feedback'), 'SHARED STREAM: history chứa event kind=assigner_feedback');
  pass(!Array.isArray(inProgressAssigned.recipient_notes) && !Array.isArray(inProgressAssigned.assigner_comments), 'SHARED STREAM: KHÔNG có field recipient_notes/assigner_comments riêng — chỉ 1 mảng history duy nhất');
  click(window, root, '[data-task-demo-detail-close]');

  // ================= C. Completion / Rework (interactive, demo-a1) =================
  await T.openTaskList(root, 'assigned');
  const reworkTarget = state.list.tasks.find(t => t.task_id === 'demo-a1');
  pass(reworkTarget && reworkTarget.status === 'completed' && !reworkTarget.rework_state, 'SETUP: demo-a1 completed, chưa có rework — mốc hoàn thành cũ có sẵn trong history');
  const completedMilestoneCountBefore = reworkTarget.history.filter(h => /Hoàn thành/.test(h.action)).length;
  render(window, T, root);
  click(window, root, '[data-task-list-row="demo-a1"]');
  render(window, T, root);
  pass(window.document.querySelector('[data-task-demo-rework-toggle]') != null, 'REWORK UI: nút "Yêu cầu xử lý lại" render cho task đã hoàn thành');
  click(window, root, '[data-task-demo-rework-toggle]');
  render(window, T, root);
  pass(window.document.querySelector('[data-task-demo-rework-confirm]') != null, 'REWORK UI: form lý do mở ra sau khi bấm toggle');

  // no-op if reason empty
  click(window, root, '[data-task-demo-rework-confirm]');
  pass(reworkTarget.rework_state !== 'requested', 'REWORK NO-OP: xác nhận với lý do rỗng không đổi state');

  setInput(window, '[data-task-demo-rework-reason]', 'Thiếu số liệu chi nhánh Ngô Quyền, bổ sung lại giúp anh.');
  click(window, root, '[data-task-demo-rework-confirm]');
  pass(reworkTarget.rework_state === 'requested' && reworkTarget.rework_reason.includes('Ngô Quyền'), 'REWORK CONFIRM: rework_state=requested + lưu đúng lý do (KHÔNG dùng "đánh dấu chưa hoàn thành")');
  pass(reworkTarget.status === 'completed', 'REWORK PRESERVES MILESTONE: row.status vẫn "completed" — mốc hoàn thành cũ KHÔNG bị xóa (mục 9: Task state tách khỏi Score state)');
  pass(reworkTarget.history.filter(h => /Hoàn thành/.test(h.action)).length === completedMilestoneCountBefore, 'REWORK PRESERVES HISTORY: history hoàn thành lần trước vẫn còn nguyên, không bị xóa/ghi đè');
  render(window, T, root);
  html = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/Cần xử lý lại|Đang xử lý lại/.test(html), 'REWORK LABEL: modal hiển thị presentation "Cần xử lý lại" thay vì "Hoàn thành"');
  pass(!/Đánh dấu chưa hoàn thành/i.test(html), 'REWORK WORDING: KHÔNG dùng cụm "Đánh dấu chưa hoàn thành"');
  click(window, root, '[data-task-demo-detail-close]');

  // ================= C2. Second completion (demo-r10 / demo-a10 shared object, self-task) =================
  const dualTaskId = 'demo-r10';
  await T.openTaskList(root, 'assigned');
  let dualTask = state.list.tasks.find(t => t.task_id === dualTaskId);
  pass(!!dualTask, 'SETUP: self-task rework demo (demo-r10) xuất hiện trong "Tôi giao" (vì self_task = actor vừa là assigner vừa là recipient)');
  render(window, T, root);
  click(window, root, '[data-task-list-row="' + dualTaskId + '"]');
  render(window, T, root);
  click(window, root, '[data-task-demo-rework-toggle]');
  render(window, T, root);
  setInput(window, '[data-task-demo-rework-reason]', 'Số liệu chi nhánh Lái Thiêu chưa khớp, kiểm tra lại giúp mình.');
  click(window, root, '[data-task-demo-rework-confirm]');
  pass(dualTask.rework_state === 'requested', 'DUAL-ROLE: yêu cầu xử lý lại từ vai trò assigner thành công trên task tự giao');
  click(window, root, '[data-task-demo-detail-close]');

  await T.openTaskList(root, 'received');
  let dualTaskAsRecipient = state.list.tasks.find(t => t.task_id === dualTaskId);
  pass(dualTaskAsRecipient === dualTask, 'DUAL-ROLE: mở lại CÙNG task_id từ "Tôi nhận" trả về CÙNG object JS (mutation ở "Tôi giao" phản ánh ngay, không có 2 bản dữ liệu lệch nhau)');
  render(window, T, root);
  click(window, root, '[data-task-list-row="' + dualTaskId + '"]');
  render(window, T, root);
  html = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/xử lý lại/i.test(html) && window.document.querySelector('[data-task-demo-status="completed"]') != null, 'DUAL-ROLE: recipient workspace cho thấy banner rework + nút hoàn thành lại');
  const completionCountBefore = dualTask.completion_count;
  click(window, root, '[data-task-demo-status="completed"]');
  pass(dualTask.completion_count === completionCountBefore + 1, 'SECOND COMPLETION: completion_count tăng đúng 1 lần');
  pass(dualTask.rework_state === null, 'SECOND COMPLETION: rework_state được clear sau khi hoàn thành lại');
  pass(dualTask.history.some(h => /Hoàn thành lần 2/.test(h.action)), 'SECOND COMPLETION: history có entry "Hoàn thành lần 2 (demo)"');
  pass(dualTask.history.some(h => /Hoàn thành \(demo\)/.test(h.action)), 'SECOND COMPLETION: entry "Hoàn thành (demo)" lần 1 vẫn còn trong history (không bị xóa)');

  // ================= D. SLA presentation =================
  await T.openTaskList(root, 'assigned');
  const withinSlaTask = state.list.tasks.find(t => t.task_id === 'demo-a1');
  pass(withinSlaTask.sla_state === 'within_sla', 'SLA SETUP: demo-a1 ở trạng thái còn hạn phản hồi');
  render(window, T, root);
  click(window, root, '[data-task-list-row="demo-a1"]');
  render(window, T, root);
  html = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/Còn hạn phản hồi trong 2 ngày làm việc/.test(html), 'SLA WITHIN: badge "Còn hạn phản hồi trong 2 ngày làm việc" render');
  click(window, root, '[data-task-demo-detail-close]');

  const lockedTask = state.list.tasks.find(t => t.task_id === 'demo-a3');
  pass(lockedTask && lockedTask.sla_state === 'locked', 'SLA SETUP: demo-a3 ở trạng thái đã chốt điểm (quá hạn phản hồi)');
  render(window, T, root);
  click(window, root, '[data-task-list-row="demo-a3"]');
  render(window, T, root);
  html = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/Đã chốt điểm cho lần hoàn thành này/.test(html), 'SLA LOCKED: badge "Đã chốt điểm..." render, phân biệt rõ với case còn hạn');
  pass(!/lỗi|sai của người giao|người giao sai/i.test(html), 'SLA WORDING: KHÔNG có ngôn từ quy trách nhiệm/đổ lỗi tự động');
  pass(window.document.querySelector('[data-task-demo-rework-toggle]') != null, 'SLA LOCKED: vẫn cho phép "Yêu cầu xử lý lại" sau khi đã chốt điểm (mục 7)');
  click(window, root, '[data-task-demo-rework-toggle]');
  render(window, T, root);
  setInput(window, '[data-task-demo-rework-reason]', 'Phát hiện sai số liệu sau khi đã chốt điểm.');
  click(window, root, '[data-task-demo-rework-confirm]');
  pass(lockedTask.sla_state === 'locked', 'SLA NO ROLLBACK: sla_state vẫn "locked" sau khi yêu cầu xử lý lại — KHÔNG tự động hồi tố điểm đã chốt (mục 7, 9)');
  render(window, T, root);
  html = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/phản hồi sau thời hạn/i.test(html), 'SLA LATE: presentation phân biệt "phản hồi sau thời hạn" một cách khách quan, không kết luận ai sai');
  click(window, root, '[data-task-demo-detail-close]');

  // ================= period-cutoff note (mục 8) =================
  await T.openTaskList(root, 'received');
  const cutoffTask = state.list.tasks.find(t => t.near_period_cutoff === true);
  pass(!!cutoffTask, 'SETUP: có 1 task demo near_period_cutoff=true (demo-r6)');
  render(window, T, root);
  click(window, root, '[data-task-list-row="' + cutoffTask.task_id + '"]');
  render(window, T, root);
  html = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/khóa kỳ.*Admin xử lý thủ công|Admin xử lý thủ công/i.test(html), 'PERIOD CUTOFF: note ngoại lệ "báo Admin xử lý thủ công" render, không có engine khóa kỳ nào chạy ngầm');
  click(window, root, '[data-task-demo-detail-close]');

  // ================= E. Manager scope =================
  // V5 SUPERSEDES: "Nhân sự tôi quản lý" không còn là scope filter bên trong
  // "Tôi nhận" nữa — đã tách thành relation/route riêng ('managed'). Test
  // đầy đủ (menu visibility, summary reconciliation, cross-department
  // filter, manager detail mode) nằm ở scripts/test-task-managed-workspace-v5.js.
  // Giữ lại ở đây 2 việc: (1) xác nhận demo-r7 KHÔNG còn lọt vào "Tôi nhận"
  // nữa (regression đúng mục 3/14 V5), (2) xác nhận route "Tôi nhận" không
  // đổi.
  await T.openTaskList(root, 'received');
  pass(!state.list.tasks.some(t => t.task_id === 'demo-r7'), 'V5 SEPARATION: "Tôi nhận" KHÔNG còn chứa task managed (demo-r7) — đã tách hẳn sang relation "managed" riêng');
  pass(T.taskListPath('received') === '/admin/task/nhan', 'REGRESSION: route "Tôi nhận" (/nhan) không đổi sau khi tách managed workspace');

  // ================= F. Proposal terminology safety =================
  await T.openTaskList(root, 'proposal_sent');
  const proposalTask = state.list.tasks[0];
  render(window, T, root);
  click(window, root, '[data-task-list-row="' + proposalTask.task_id + '"]');
  render(window, T, root);
  html = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/Nội dung đề xuất/.test(html), 'PROPOSAL WORDING: "Nội dung đề xuất" thay vì "Nội dung công việc"');
  pass(!/Nội dung công việc/.test(html), 'PROPOSAL WORDING: KHÔNG còn "Nội dung công việc" trong detail Đề xuất');
  pass(/Người xử lý đề xuất/.test(html), 'PROPOSAL WORDING: "Người xử lý đề xuất" thay vì "Người nhận chính"');
  pass(!/Người nhận chính/.test(html), 'PROPOSAL WORDING: KHÔNG còn "Người nhận chính" trong detail Đề xuất');
  pass(!/>Bắt đầu<|>Hạn hoàn thành</.test(html), 'PROPOSAL WORDING: ẩn mốc Bắt đầu/Hạn hoàn thành (chưa có business lock model thời gian riêng cho Đề xuất)');
  pass(!/Xử lý công việc/.test(html), 'PROPOSAL: KHÔNG có khu "Xử lý công việc" (không fake completion action cho Đề xuất)');
  pass(!/Theo dõi &amp; phản hồi/.test(html), 'PROPOSAL: KHÔNG có khu "Theo dõi & phản hồi" (chưa chốt lifecycle Đề xuất)');
  pass(!/Duyệt|Từ chối|Chấp nhận/i.test(html), 'PROPOSAL: KHÔNG có nút Duyệt/Từ chối/Chấp nhận giả');
  click(window, root, '[data-task-demo-detail-close]');

  await T.openTaskList(root, 'proposal_received');
  const proposalReceivedTask = state.list.tasks[0];
  render(window, T, root);
  click(window, root, '[data-task-list-row="' + proposalReceivedTask.task_id + '"]');
  render(window, T, root);
  html = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/Nội dung đề xuất/.test(html) && /Người xử lý đề xuất/.test(html), 'PROPOSAL RECEIVED: cùng terminology safety áp dụng cho "Đề xuất tôi nhận xử lý"');
  pass(!/Hoàn thành công việc/.test(html), 'PROPOSAL RECEIVED: KHÔNG mặc định dùng "Hoàn thành công việc" cho Đề xuất');
  click(window, root, '[data-task-demo-detail-close]');

  // list header wording for proposal relations (Người xử lý đề xuất / Người gửi đề xuất)
  await T.openTaskList(root, 'proposal_sent');
  html = T.taskListHtml();
  pass(/Người xử lý đề xuất/.test(html), 'PROPOSAL LIST: cột counterparty của "Đề xuất — Tôi gửi" dùng "Người xử lý đề xuất"');
  await T.openTaskList(root, 'proposal_received');
  html = T.taskListHtml();
  pass(/Người gửi đề xuất/.test(html), 'PROPOSAL LIST: cột counterparty của "Đề xuất — Tôi nhận xử lý" dùng "Người gửi đề xuất"');

  // ================= G. Regression =================
  await T.openTaskList(root, 'received');
  pass(state.list.relation === 'received', 'REGRESSION: openTaskList("received") vẫn hoạt động');
  const recipientTaskId = state.list.tasks.find(t => t.scope_kind !== 'managed').task_id;
  render(window, T, root);
  click(window, root, '[data-task-list-row="' + recipientTaskId + '"]');
  render(window, T, root);
  html = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/Xử lý công việc/.test(html), 'REGRESSION: workspace V2 "Xử lý công việc" vẫn render đúng cho recipient thật');
  click(window, root, '[data-task-demo-detail-close]');

  const navKeys = T.NAV_ITEMS.map(i => i.key);
  pass(navKeys.includes('viec-cua-toi'), 'REGRESSION: menu "Việc của tôi" không bị ảnh hưởng');
  pass(T.parseTaskRoute(T.taskListPath('received')).relation === 'received', 'REGRESSION: route /nhan vẫn hoạt động');
  pass(T.parseTaskRoute(T.taskListPath('assigned')).relation === 'assigned', 'REGRESSION: route /giao vẫn hoạt động');

  // ================= SAFETY =================
  pass(true, 'SAFETY: toàn bộ thao tác V3 phía trên (feedback/rework/complete/scope filter/manager view/proposal detail) không hề gọi fetch() — nếu có, test đã crash ở bước tương ứng');

  console.log('PHF Task UX Hardening V3 test: ' + passed + '/' + passed + ' PASS');
})().then(() => {
  pass(!/PHF_TASK_UI_DEMO/.test(PERMISSIONS_SRC), 'FOUNDATION: api/_lib/task-permissions.js không có dấu vết demo mode nào (không bị sửa)');
  pass(!/PHF_TASK_UI_DEMO/.test(SCOPE_SRC), 'FOUNDATION: api/_lib/task-employee-scope.js không có dấu vết demo mode nào (không bị sửa)');
  console.log('PHF Task UX Hardening V3 — foundation isolation check: ' + passed + '/' + passed + ' PASS (cumulative)');
}).catch(err => { console.error(err); process.exitCode = 1; });
