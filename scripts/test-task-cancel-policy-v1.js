'use strict';
/* PHF Task — CANCEL POLICY V1 — jsdom UI/logic regression (no backend, no net).
   Loads assets/js/task/phf-task-app.js in jsdom (same harness as
   test-task-recurrence-ui-v1.js) and asserts the "Yêu cầu hủy" flow is wired
   to the backend action flags:
     - active primary (actions.cancel=false, request_cancel=true) -> "Yêu cầu hủy"
     - creator / management (actions.cancel=true) -> "Hủy công việc"
     - a pending cancel_request -> review panel (Duyệt/Từ chối) for a reviewer,
       "Rút yêu cầu hủy" for the requester
     - UI action flags mirror the DTO exactly (no title/role guessing)
   DB-backed request/approve/reject/withdraw behaviour: task-cancel-request-e2e-dev.js

   CANCEL REQUEST USABILITY V1 (2026-09-10) — the pending-request review panel
   (Duyệt hủy/Từ chối/Rút yêu cầu hủy) moved OUT of taskLifecycleSectionHtml()
   and now lives in its own top-level taskCancelRequestSectionHtml(detail),
   rendered right under the hero in detailContentHtml() — see the UX direction
   lock. taskLifecycleSectionHtml() keeps only the "Yêu cầu hủy" TRIGGER button
   (opens the compose form) and the no-double-submit gate; blocks C/D below now
   assert against taskCancelRequestSectionHtml(), not taskLifecycleSectionHtml(). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'assets', 'js', 'task', 'phf-task-app.js'), 'utf8');
const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/admin/task/chi-tiet' });
const { window } = dom;
window.__PHF_TASK_TEST_MODE__ = true;
window.phfGetSessionRole = () => 'admin';
window.phfGetCurrentUser = () => ({ fullName: 'A', email: 'a@a' });
window.phfNavigate = () => {}; window.phfToast = () => {};
window.eval(code);
const T = window.__PHF_TASK_TEST__;
assert.ok(T, '__PHF_TASK_TEST__ exposed');
let passed = 0;
function pass(c, m) { assert.ok(c, m); passed += 1; }

const activeTask = () => ({ id: 't1', task_code: 'CV-1', title: 'Việc', content: 'x', status: 'published', row_version: 4, flow_type: 'giao_viec', progress_percent: 20 });

/* ---- A. active primary sees "Yêu cầu hủy", NOT "Hủy công việc" -------------- */
(function () {
  const st = T.getState();
  st.detail = { task: activeTask(), cancel_request: null };
  const viewer = { is_active_primary: true, actions: { view: true, comment: true, update_progress: true, complete: true, cancel: false, request_cancel: true, review_cancel_request: false } };
  const html = T.taskLifecycleSectionHtml(activeTask(), viewer);
  pass(/data-task-lifecycle-open="request_cancel"/.test(html) && />Yêu cầu hủy</.test(html), 'A1: active primary sees "Yêu cầu hủy" button');
  pass(!/data-task-lifecycle-open="cancel"/.test(html) && !/>Hủy công việc</.test(html), 'A2: active primary does NOT see "Hủy công việc"');
})();

/* ---- B. creator / management sees "Hủy công việc", NOT "Yêu cầu hủy" -------- */
(function () {
  const st = T.getState();
  st.detail = { task: activeTask(), cancel_request: null };
  const viewer = { is_creator: true, is_active_primary: false, actions: { view: true, comment: true, cancel: true, request_cancel: false, review_cancel_request: true } };
  const html = T.taskLifecycleSectionHtml(activeTask(), viewer);
  pass(/data-task-lifecycle-open="cancel"/.test(html) && />Hủy công việc</.test(html), 'B1: creator/management sees "Hủy công việc"');
  pass(!/data-task-lifecycle-open="request_cancel"/.test(html), 'B2: creator/management does NOT see "Yêu cầu hủy"');
})();

/* ---- C. pending cancel_request -> review panel for a reviewer -------------- */
(function () {
  const st = T.getState();
  const cr = { id: 'cr1', status: 'pending', reason: 'Trùng với checklist', requested_by_employee_code: 'PHF082', requested_at: '2026-08-30T02:00:00Z', can_review: true, can_withdraw: false };
  st.detail = { task: activeTask(), cancel_request: cr };
  const viewer = { is_creator: true, is_active_primary: false, actions: { view: true, comment: true, cancel: true, request_cancel: false, review_cancel_request: true } };
  // CANCEL REQUEST USABILITY V1 — the panel now lives in
  // taskCancelRequestSectionHtml(detail), rendered right under the hero.
  const sectionHtml = T.taskCancelRequestSectionHtml(st.detail);
  pass(/Đang có yêu cầu hủy công việc/.test(sectionHtml) && /Trùng với checklist/.test(sectionHtml) && /PHF082/.test(sectionHtml), 'C1: pending request panel shows requester + reason');
  pass(/data-task-lifecycle-submit="approve_cancel_request"/.test(sectionHtml) && />Duyệt hủy</.test(sectionHtml), 'C2: reviewer sees "Duyệt hủy"');
  pass(/data-task-lifecycle-open="reject_cancel_request"/.test(sectionHtml) && />Từ chối</.test(sectionHtml), 'C3: reviewer sees "Từ chối"');
  pass(!/data-task-lifecycle-submit="withdraw_cancel_request"/.test(sectionHtml), 'C4: a non-requester reviewer does NOT see "Rút yêu cầu hủy"');
  // review panel html helper directly
  const panel = T.taskCancelRequestPanelHtml(cr, '', false);
  pass(/lịch sử\/audit được giữ nguyên/.test(panel), 'C5: panel copy states audit/history is preserved on approve');
  // taskLifecycleSectionHtml() no longer duplicates the panel/decision buttons
  const lifecycleHtml = T.taskLifecycleSectionHtml(activeTask(), viewer);
  pass(!/Đang có yêu cầu hủy công việc/.test(lifecycleHtml) && !/data-task-lifecycle-submit="approve_cancel_request"/.test(lifecycleHtml), 'C6: the panel is NOT duplicated inside "Thao tác vòng đời"');
})();

/* ---- D. pending request -> requester sees "Rút yêu cầu hủy" ---------------- */
(function () {
  const st = T.getState();
  const cr = { id: 'cr2', status: 'pending', reason: 'r', requested_by_employee_code: 'PHF082', requested_at: '2026-08-30T02:00:00Z', can_review: false, can_withdraw: true };
  st.detail = { task: activeTask(), cancel_request: cr };
  const viewer = { is_active_primary: true, actions: { view: true, comment: true, update_progress: true, complete: true, cancel: false, request_cancel: true, review_cancel_request: false } };
  const sectionHtml = T.taskCancelRequestSectionHtml(st.detail);
  pass(/data-task-lifecycle-submit="withdraw_cancel_request"/.test(sectionHtml) && />Rút yêu cầu hủy</.test(sectionHtml), 'D1: requester sees "Rút yêu cầu hủy"');
  pass(!/data-task-lifecycle-submit="approve_cancel_request"/.test(sectionHtml), 'D3: a non-reviewer requester does NOT see "Duyệt hủy"');
  const html = T.taskLifecycleSectionHtml(activeTask(), viewer);
  pass(!/data-task-lifecycle-open="request_cancel"/.test(html), 'D2: with a pending request, the "Yêu cầu hủy" button is hidden (no double submit)');
})();

/* ---- G. no pending request + no history -> section renders nothing -------- */
(function () {
  const st = T.getState();
  st.detail = { task: activeTask(), cancel_request: null, cancel_request_history: [] };
  pass(T.taskCancelRequestSectionHtml(st.detail) === '', 'G1: a Task never involved in a cancel request renders no section at all');
})();

/* ---- H. decided history -> visible even with no pending request ----------- */
(function () {
  const st = T.getState();
  const history = [{ id: 'cr0', status: 'rejected', reason: 'Chưa đủ căn cứ', requested_by_employee_code: 'PHF082', requested_by_full_name: 'Nguyễn Văn A', requested_at: '2026-08-20T02:00:00Z', decided_by_employee_code: 'PHF001', decided_by_full_name: 'Trần Thị B', decided_at: '2026-08-20T05:00:00Z', decision_note: 'Chưa đủ căn cứ' }];
  st.detail = { task: activeTask(), cancel_request: null, cancel_request_history: history };
  const html = T.taskCancelRequestSectionHtml(st.detail);
  pass(/Lịch sử yêu cầu hủy/.test(html) && /Nguyễn Văn A/.test(html) && /Trần Thị B/.test(html) && /Đã từ chối/.test(html), 'H1: decided history stays visible after the pending panel clears — requester → reason → decision → decision actor → time');
  pass(!/Đang có yêu cầu hủy công việc/.test(html), 'H2: no pending panel when there is no pending request, history only');
})();

/* ---- E. no cancel_request + not primary + not mgmt -> nothing cancel-y ----- */
(function () {
  const st = T.getState();
  st.detail = { task: activeTask(), cancel_request: null };
  const viewer = { is_related: true, actions: { view: true, comment: true, cancel: false, request_cancel: false, review_cancel_request: false } };
  const html = T.taskLifecycleSectionHtml(activeTask(), viewer);
  pass(!/data-task-lifecycle-open="cancel"/.test(html) && !/data-task-lifecycle-open="request_cancel"/.test(html) && !/Đang có yêu cầu hủy/.test(html), 'E1: a related-only viewer sees no cancel / request / panel');
})();

/* ---- F. reason validation in the request form (client-side) ---------------- */
(function () {
  const st = T.getState();
  st.detail = { task: activeTask(), cancel_request: null };
  st.lifecycleReason = '';
  const viewer = { is_active_primary: true, actions: { view: true, cancel: false, request_cancel: true, review_cancel_request: false } };
  T.openTaskLifecycleForm({}, 'request_cancel');
  const html = T.taskLifecycleSectionHtml(activeTask(), viewer);
  pass(/Lý do yêu cầu hủy \*/.test(html) && /data-task-lifecycle-field="reason"/.test(html), 'F1: request form has a mandatory reason field');
})();

console.log('PHF Task Cancel Policy V1 (jsdom): ' + passed + '/' + passed + ' PASS');
