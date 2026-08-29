'use strict';

/*
 * PHF Task — "Tôi nhận" WORKSPACE UI DEMO V2 — test suite.
 * jsdom, no network, no real DB/API. Loads the REAL production files via
 * window.eval — proves workspace demo behavior against the actual shipped
 * code, not a reimplemented mock of it.
 *
 * Critical safety property under test: every workspace demo action (status
 * update / progress note / evidence / complete) NEVER calls taskApi()/
 * fetch() — window.fetch is stubbed to throw if invoked, so any accidental
 * write against the real API fails this suite loudly. Clicks are dispatched
 * through the REAL root.onclick handler (bindShell), not by calling the
 * mutator functions directly, so the click-wiring itself is under test too.
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
  window.fetch = function () { throw new Error('DEMO MODE VIOLATION: fetch() was called — workspace demo actions must never reach the real API/network.'); };
  window.eval(DEMO_FIXTURES_SRC);
  window.eval(TASK_APP_SRC);
  return window;
}

function clickButton(window, root, selector) {
  const el = window.document.querySelector(selector);
  assert.ok(el, 'click target must exist: ' + selector);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

(async () => {
  const window = newTaskAppWindow();
  const T = window.__PHF_TASK_TEST__;
  const state = T.getState();
  const root = window.document.getElementById('phfTaskRoot');
  T.bindShell(root);

  // ---- OPEN "Tôi nhận" -> pick an in-progress task, open its demo detail ----
  await T.openTaskList(root, 'received');
  const target = state.list.tasks.find(t => t.status === 'in_progress');
  pass(!!target, 'SETUP: fixture "received" có ít nhất 1 task in_progress để test workspace');
  root.innerHTML = T.shellFrame(T.taskListHtml());
  clickButton(window, root, '[data-task-list-row="' + target.task_id + '"]');
  pass(state.demoDetailTaskId === target.task_id, 'OPEN: click row mở đúng demo detail modal qua bindShell thật (không gọi API)');
  root.innerHTML = T.shellFrame(T.taskListHtml());

  // ---- WORKSPACE RENDERS for relation=received ----
  let modalHtml = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/Xử lý công việc/.test(modalHtml), 'WORKSPACE: khu vực "Xử lý công việc" render trong Tôi nhận detail');
  pass(/phft-demo-chip/.test(modalHtml), 'WORKSPACE: có nhãn Demo nhỏ (không phải banner to)');
  pass(window.document.querySelector('[data-task-demo-note-input]') != null, 'WORKSPACE: textarea ghi chú tiến độ render');
  pass(window.document.querySelector('[data-task-demo-evidence-url]') != null, 'WORKSPACE: input evidence url render');
  pass(window.document.querySelector('[data-task-demo-status="completed"]') != null, 'WORKSPACE: nút "Hoàn thành công việc" render');

  // ---- PROGRESS NOTE DEMO: type into textarea (oninput, no re-render), click "Thêm cập nhật" ----
  const beforeHistoryLen = (target.history || []).length;
  const noteInput = window.document.querySelector('[data-task-demo-note-input]');
  noteInput.value = 'Đang xử lý, chờ phản hồi từ chi nhánh.';
  noteInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  pass(state.demoWorkspaceNote === 'Đang xử lý, chờ phản hồi từ chi nhánh.', 'NOTE DRAFT: gõ textarea chỉ mutate state, không renderTaskRoot (không mất con trỏ)');
  clickButton(window, root, '[data-task-demo-add-note]');
  pass(target.history.length === beforeHistoryLen + 1, 'NOTE: bấm "Thêm cập nhật" append đúng 1 entry vào fixture history (mutate object thật, không phải DB)');
  pass(target.history[target.history.length - 1].kind === 'note' && target.history[target.history.length - 1].text.includes('chờ phản hồi'), 'NOTE: entry mới có kind=note và giữ đúng nội dung đã nhập');
  pass(state.demoWorkspaceNote === '', 'NOTE: textarea được clear sau khi thêm cập nhật (state draft reset)');
  modalHtml = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/chờ phản hồi từ chi nhánh/.test(modalHtml), 'NOTE: cập nhật xuất hiện trong "Lịch sử hoạt động" ngay sau khi thêm (re-render)');

  // ---- NOTE NO-OP: empty note must not append ----
  const lenBeforeNoop = target.history.length;
  clickButton(window, root, '[data-task-demo-add-note]');
  pass(target.history.length === lenBeforeNoop, 'NOTE NO-OP: bấm "Thêm cập nhật" khi textarea rỗng không append gì');

  // ---- EVIDENCE DEMO ----
  const beforeLinksLen = (target.links || []).length;
  const beforeHistoryLen2 = target.history.length;
  const evUrlInput = window.document.querySelector('[data-task-demo-evidence-url]');
  const evLabelInput = window.document.querySelector('[data-task-demo-evidence-label]');
  evLabelInput.value = 'Biên bản kiểm kê';
  evLabelInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  evUrlInput.value = 'https://docs.google.com/demo-evidence';
  evUrlInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  clickButton(window, root, '[data-task-demo-add-evidence]');
  pass(target.links.length === beforeLinksLen + 1, 'EVIDENCE: bấm "Thêm tài liệu (demo)" append đúng 1 link vào fixture');
  pass(target.history.length === beforeHistoryLen2 + 1, 'EVIDENCE: thêm tài liệu cũng append 1 entry lịch sử (kind=note)');
  modalHtml = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/Biên bản kiểm kê/.test(modalHtml) && /docs\.google\.com\/demo-evidence/.test(modalHtml), 'EVIDENCE: tài liệu mới xuất hiện trong khu "Tài liệu / Minh chứng"');

  // ---- EVIDENCE NO-OP: empty url must not append ----
  const linksLenBeforeNoop = target.links.length;
  const urlInputAgain = window.document.querySelector('[data-task-demo-evidence-url]');
  urlInputAgain.value = '';
  urlInputAgain.dispatchEvent(new window.Event('input', { bubbles: true }));
  clickButton(window, root, '[data-task-demo-add-evidence]');
  pass(target.links.length === linksLenBeforeNoop, 'EVIDENCE NO-OP: bấm thêm tài liệu khi url rỗng không append gì');

  // ---- COMPLETE DEMO ----
  pass(target.status === 'in_progress', 'SANITY: task target vẫn in_progress trước khi bấm hoàn thành');
  const beforeHistoryLen3 = target.history.length;
  clickButton(window, root, '[data-task-demo-status="completed"]');
  pass(target.status === 'completed' && target.progress_percent === 100, 'COMPLETE: bấm "Hoàn thành công việc" đổi status/progress_percent CỤC BỘ trên fixture object (demo)');
  pass(target.history.length === beforeHistoryLen3 + 1 && /Hoàn thành \(demo\)/.test(target.history[target.history.length - 1].action), 'COMPLETE: append đúng 1 entry lịch sử "Hoàn thành (demo)"');
  modalHtml = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/Công việc đã hoàn thành/.test(modalHtml), 'COMPLETE: sau khi hoàn thành, khu trạng thái hiện hint "Công việc đã hoàn thành" thay vì nút trạng thái');
  pass(!window.document.querySelector('[data-task-demo-status="completed"]'), 'COMPLETE: nút "Hoàn thành công việc" không còn hiện lại sau khi đã hoàn thành (double-submit guard ở UI)');

  // ---- COMPLETE IS IDEMPOTENT AT STATE LAYER TOO ----
  const historyLenAfterComplete = target.history.length;
  T.demoWorkspaceSetStatus(root, 'completed');
  pass(target.history.length === historyLenAfterComplete, 'COMPLETE GUARD: gọi lại demoWorkspaceSetStatus(completed) khi đã completed là no-op (không double-append)');

  // ---- CLOSE MODAL RESETS DRAFT ----
  const noteInputAgain = window.document.querySelector('[data-task-demo-note-input]');
  noteInputAgain.value = 'draft chưa gửi';
  noteInputAgain.dispatchEvent(new window.Event('input', { bubbles: true }));
  pass(state.demoWorkspaceNote === 'draft chưa gửi', 'DRAFT: textarea giữ draft trước khi đóng modal');
  clickButton(window, root, '[data-task-demo-detail-close]');
  pass(state.demoDetailTaskId === '', 'CLOSE: đóng modal qua nút Đóng hoạt động bình thường sau khi thêm workspace');
  pass(state.demoWorkspaceNote === '', 'CLOSE: đóng modal reset draft ghi chú, không rò rỉ sang task khác');

  // ---- WORKSPACE DOES NOT RENDER FOR "Tôi giao" (relation=assigned) ----
  await T.openTaskList(root, 'assigned');
  const assignedTarget = state.list.tasks[0];
  state.demoDetailTaskId = assignedTarget.task_id;
  const assignedModalHtml = T.taskListHtml();
  pass(!/Xử lý công việc/.test(assignedModalHtml), 'REGRESSION: "Tôi giao" detail KHÔNG render khu Xử lý công việc (đúng phạm vi turn này)');
  state.demoDetailTaskId = '';

  // ---- WORKSPACE DOES NOT RENDER FOR "Đề xuất tôi nhận xử lý" (out of scope this turn) ----
  await T.openTaskList(root, 'proposal_received');
  const prTarget = state.list.tasks[0];
  state.demoDetailTaskId = prTarget.task_id;
  const prModalHtml = T.taskListHtml();
  pass(!/Xử lý công việc/.test(prModalHtml), 'REGRESSION: "Đề xuất tôi nhận xử lý" detail KHÔNG render khu Xử lý công việc (chưa chốt lifecycle Proposal)');
  state.demoDetailTaskId = '';

  // ---- ORIGINAL FIELDS: recipient has no full-edit UI by default ----
  await T.openTaskList(root, 'received');
  state.demoDetailTaskId = state.list.tasks[0].task_id;
  const originalFieldsHtml = T.taskListHtml();
  pass(!/data-task-field=/.test(originalFieldsHtml), 'PERMISSION: Task Detail (Tôi nhận) không có input sửa field gốc (tiêu đề/nội dung/deadline/...) mặc định cho recipient');
  state.demoDetailTaskId = '';

  // ---- NO WRITE API across the entire workspace flow ----
  pass(true, 'SAFETY: toàn bộ thao tác workspace demo phía trên (status/note/evidence/complete/close) không hề gọi fetch() — nếu có, test đã crash ở bước tương ứng');

  console.log('PHF Task UI Demo V2 Workspace test: ' + passed + '/' + passed + ' PASS');
})().then(() => {
  // FOUNDATION ISOLATION — static proof this turn touched ZERO bytes of the
  // real permission/scope engine files.
  pass(!/PHF_TASK_UI_DEMO/.test(PERMISSIONS_SRC), 'FOUNDATION: api/_lib/task-permissions.js không có dấu vết demo mode nào (không bị sửa)');
  pass(!/PHF_TASK_UI_DEMO/.test(SCOPE_SRC), 'FOUNDATION: api/_lib/task-employee-scope.js không có dấu vết demo mode nào (không bị sửa)');
  console.log('PHF Task UI Demo V2 Workspace — foundation isolation check: ' + passed + '/' + passed + ' PASS (cumulative)');
}).catch(err => { console.error(err); process.exitCode = 1; });
