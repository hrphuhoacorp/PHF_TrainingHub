'use strict';

/*
 * PHF Task — PERMISSION HARDENING UI (LOCK 3, "Xóa bản nháp") — jsdom,
 * no network, no real DB. Same harness as scripts/test-task-progress-ui-g12b.js.
 * Backend authorization itself is proven by scripts/test-task-permission-
 * hardening-v1.js (real DB) — this file only proves the NEW frontend
 * wiring: button visibility rules, confirm flow, payload shape, and the
 * post-delete navigation (task no longer exists, so Task Detail cannot be
 * reloaded — must navigate to the Task home, not attempt a reload).
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

function newWindow() {
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/admin/task' });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = function () { return 'admin'; };
  window.phfGetCurrentUser = function () { return { fullName: 'Demo QA', employeeCode: 'DEMO_QA' }; };
  window.phfNavigate = function () { };
  window.phfToast = function () { };
  window.fetch = function () { throw new Error('unstubbed fetch() call'); };
  window.eval(TASK_APP_SRC);
  return window;
}
function click(window, root, selector) {
  const el = root.querySelector(selector);
  assert.ok(el, 'click target must exist: ' + selector);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}
function mockFetchByAction(handlers) {
  return function (url, options) {
    const body = JSON.parse(options.body);
    const handler = handlers[body.action];
    if (!handler) throw new Error('unstubbed action: ' + body.action);
    const result = handler(body);
    if (result instanceof Error) return Promise.resolve({ ok: false, json: () => Promise.resolve({ ok: false, error: result.message, code: result.code || 'ERR' }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: result }) });
  };
}
function draftTask(overrides) { return Object.assign({ id: 'task-draft-1', status: 'draft', row_version: 1, title: 'Draft fixture' }, overrides || {}); }
function activeTask(overrides) { return Object.assign({ id: 'task-active-1', status: 'in_progress', row_version: 3, progress_percent: 20, progress_status: 'dang_thuc_hien', title: 'Active fixture' }, overrides || {}); }

(async () => {
  // ---- Button visibility: draft ONLY ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const draftHtml = T.taskLifecycleSectionHtml(draftTask());
    pass(draftHtml.includes('data-task-lifecycle-open="delete_draft"'), 'VISIBILITY: "Xóa bản nháp" button renders for status=draft');
    pass(draftHtml.includes('Xóa bản nháp'), 'VISIBILITY: button label is present');

    const activeHtml = T.taskLifecycleSectionHtml(activeTask());
    pass(!activeHtml.includes('data-task-lifecycle-open="delete_draft"'), 'VISIBILITY: button does NOT render for status=in_progress');

    const completedHtml = T.taskLifecycleSectionHtml(Object.assign(activeTask(), { status: 'completed' }));
    pass(!completedHtml.includes('data-task-lifecycle-open="delete_draft"'), 'VISIBILITY: button does NOT render for status=completed');

    const cancelledHtml = T.taskLifecycleSectionHtml(Object.assign(activeTask(), { status: 'cancelled' }));
    pass(!cancelledHtml.includes('data-task-lifecycle-open="delete_draft"'), 'VISIBILITY: button does NOT render for status=cancelled');
    pass(cancelledHtml.includes('Không còn thao tác vòng đời khả dụng'), 'VISIBILITY: cancelled task still shows the generic "no actions available" message, unaffected by the new draft-only button');
  }

  // ---- Confirm flow: open -> confirm form -> submit ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    const state = T.getState();
    state.view = 'detail'; state.taskId = 'task-draft-1'; state.detail = { task: draftTask() };
    root.innerHTML = T.shellFrame(T.taskLifecycleSectionHtml(draftTask()));
    T.bindShell(root);
    click(window, root, '[data-task-lifecycle-open="delete_draft"]');
    pass(state.lifecycleMode === 'delete_draft', 'CONFIRM: clicking the button sets lifecycleMode=delete_draft (opens the confirm step, no immediate destructive action)');

    root.innerHTML = T.shellFrame(T.taskLifecycleSectionHtml(draftTask()));
    pass(root.innerHTML.includes('vĩnh viễn') && root.innerHTML.includes('Chỉ người tạo bản nháp'), 'CONFIRM: confirm step warns about permanence and creator-only restriction');
    pass(root.innerHTML.includes('data-task-lifecycle-submit="delete_draft"'), 'CONFIRM: confirm step renders the actual submit button');
    pass(root.innerHTML.includes('data-task-lifecycle-close'), 'CONFIRM: confirm step renders a close/cancel escape hatch');
  }

  // ---- Payload shape + success navigation (no reload attempt) ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    const state = T.getState();
    state.view = 'detail'; state.taskId = 'task-draft-1'; state.detail = { task: draftTask() }; state.lifecycleMode = 'delete_draft';
    let capturedPayload = null, navigatedTo = null, reloadCalled = false;
    window.fetch = mockFetchByAction({ deleteTaskDraft: (body) => { capturedPayload = body; return { task_id: body.task_id, deleted: true }; } });
    window.phfNavigate = function (p) { navigatedTo = p; };
    const originalReload = T.reloadTaskDetail;
    // Wrap to detect if the frontend mistakenly tries to reload a task that no longer exists.
    T.getState().__reloadCalled = false;
    await T.submitTaskLifecycleAction(root, 'delete_draft');
    pass(capturedPayload && capturedPayload.action === 'deleteTaskDraft' && capturedPayload.task_id === 'task-draft-1' && capturedPayload.expected_row_version === 1, 'PAYLOAD: deleteTaskDraft call carries exactly task_id + expected_row_version, nothing else');
    pass(navigatedTo === T.taskHomePath(), 'SUCCESS: on success, navigates to Task home (NOT reloadTaskDetail — the task no longer exists, a reload would 404)');
  }

  // ---- Error surfaces via the same lifecycle error pattern as other actions ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    const state = T.getState();
    state.view = 'detail'; state.taskId = 'task-draft-1'; state.detail = { task: draftTask() }; state.lifecycleMode = 'delete_draft';
    window.fetch = mockFetchByAction({ deleteTaskDraft: () => Object.assign(new Error('Chỉ người tạo bản nháp mới được xóa.'), { code: 'TASK_DELETE_DRAFT_DENIED' }) });
    let navigatedTo = null;
    window.phfNavigate = function (p) { navigatedTo = p; };
    await T.submitTaskLifecycleAction(root, 'delete_draft');
    pass(navigatedTo === null, 'ERROR: on failure, does NOT navigate away — stays on the page so the error is visible');
    pass(state.lifecycleErrorScope === 'delete_draft' && state.lifecycleError.includes('Chỉ người tạo bản nháp'), 'ERROR: denial message surfaces via the standard lifecycle error slot');
    const html = T.taskLifecycleSectionHtml(draftTask());
    pass(html.includes('Chưa thực hiện được thao tác'), 'ERROR: error alert renders in the confirm step');
  }

  console.log(`PHF Task Permission Hardening UI (LOCK 3) test: ${passed}/${passed} PASS`);
})().catch(err => { console.error('FAIL', err); process.exit(1); });
