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
   DB-backed request/approve/reject/withdraw behaviour: task-cancel-request-e2e-dev.js */
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
  const html = T.taskLifecycleSectionHtml(activeTask(), viewer);
  pass(/Đang có yêu cầu hủy công việc/.test(html) && /Trùng với checklist/.test(html) && /PHF082/.test(html), 'C1: pending request panel shows requester + reason');
  pass(/data-task-lifecycle-submit="approve_cancel_request"/.test(html) && />Duyệt hủy</.test(html), 'C2: reviewer sees "Duyệt hủy"');
  pass(/data-task-lifecycle-open="reject_cancel_request"/.test(html) && />Từ chối</.test(html), 'C3: reviewer sees "Từ chối"');
  pass(!/data-task-lifecycle-submit="withdraw_cancel_request"/.test(html), 'C4: a non-requester reviewer does NOT see "Rút yêu cầu hủy"');
  // review panel html helper directly
  const panel = T.taskCancelRequestPanelHtml(cr, '', false);
  pass(/lịch sử\/audit được giữ nguyên/.test(panel), 'C5: panel copy states audit/history is preserved on approve');
})();

/* ---- D. pending request -> requester sees "Rút yêu cầu hủy" ---------------- */
(function () {
  const st = T.getState();
  const cr = { id: 'cr2', status: 'pending', reason: 'r', requested_by_employee_code: 'PHF082', requested_at: '2026-08-30T02:00:00Z', can_review: false, can_withdraw: true };
  st.detail = { task: activeTask(), cancel_request: cr };
  const viewer = { is_active_primary: true, actions: { view: true, comment: true, update_progress: true, complete: true, cancel: false, request_cancel: true, review_cancel_request: false } };
  const html = T.taskLifecycleSectionHtml(activeTask(), viewer);
  pass(/data-task-lifecycle-submit="withdraw_cancel_request"/.test(html) && />Rút yêu cầu hủy</.test(html), 'D1: requester sees "Rút yêu cầu hủy"');
  pass(!/data-task-lifecycle-open="request_cancel"/.test(html), 'D2: with a pending request, the "Yêu cầu hủy" button is hidden (no double submit)');
  pass(!/data-task-lifecycle-submit="approve_cancel_request"/.test(html), 'D3: a non-reviewer requester does NOT see "Duyệt hủy"');
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
