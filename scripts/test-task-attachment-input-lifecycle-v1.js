'use strict';

/*
 * PHF Task — FILE ATTACHMENT V1 input EVENT LIFECYCLE regression (jsdom, real
 * source, real DOM events — no network).
 *
 * Proves the 1.66.8 regression fix in assets/js/task/phf-task-app.js:
 * before the fix, root.onchange=root.oninput meant BOTH the native 'input'
 * AND 'change' events (which fire for the SAME file-input selection) were
 * routed into the SAME upload/staging handler, which synchronously calls
 * renderTaskRoot() (root.innerHTML=...) — detaching the original <input>
 * before the browser's already-queued 'change' could bubble to root. 'change'
 * is now the SOLE authoritative event for both attach inputs; 'input' is a
 * no-op for them.
 *
 * CASE A — Task Detail (network upload)
 * CASE B — Full Create (local staged attachment, no network before task_id)
 * CASE C — duplicate safety: input THEN change on the same selection ->
 *          exactly one processing path
 * CASE D — existing Attachment regression suites still pass (run separately
 *          by the caller; this file focuses on the new lifecycle proof)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'assets/js/task/phf-task-app.js'), 'utf8');
let passed = 0;
function pass(c, m, detail) {
  if (c) { passed += 1; console.log('  PASS  ' + m); }
  else { console.log('  FAIL  ' + m + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); assert.ok(c, m); }
}

function newWindow(fetchImpl) {
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/ql/task' });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = () => 'manager';
  window.phfGetCurrentUser = () => ({ fullName: 'QA', employeeCode: 'PHF001', id: 'acc-qa', role: 'manager' });
  window.phfNavigate = () => {};
  window.phfToast = () => {};
  window.__fetchLog = [];
  window.fetch = function (url, opts) {
    const u = String(url);
    window.__fetchLog.push({ url: u, opts: opts || {} });
    if (fetchImpl) return fetchImpl(u, opts || {});
    if (u.indexOf('/api/task-attachment') >= 0) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: { id: 'att-new' } }) });
    }
    // /api/data — action-aware minimal responder so a post-upload reloadTaskDetail()
    // / notification poll doesn't collapse the re-rendered section (canUpload etc.).
    let body = {};
    try { body = JSON.parse((opts && opts.body) || '{}'); } catch (_e) {}
    if (body.action === 'getTaskDetail') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: JSON.parse(JSON.stringify(DETAIL_BASE)) }) });
    }
    if (body.action === 'listMyTaskNotifications') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: { notifications: [], unreadCount: 0 } }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: {} }) });
  };
  window.eval(SRC);
  return window;
}

function pngFile(w, name) {
  const f = new w.File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], name || 'anh-test.png', { type: 'image/png' });
  return f;
}
function setFiles(input, files) { Object.defineProperty(input, 'files', { value: files, configurable: true }); }
function tick(ms) { return new Promise((r) => setTimeout(r, ms || 30)); }

const DETAIL_BASE = {
  task: { id: 'task-1', task_code: 'CV-2609-0001', title: 'Việc test', status: 'in_progress', flow_type: 'giao_viec' },
  category: {}, primary: null, related: [], comments: [], links: [],
  viewer: { actions: { view: true, comment: true, upload_attachment: true } },
  attachments: [],
};

function renderTaskDetail(w) {
  const T = w.__PHF_TASK_TEST__;
  const st = T.getState();
  st.view = 'detail'; st.taskId = 'task-1'; st.detailLoading = false; st.detailError = ''; st.partialErrors = null;
  st.detail = JSON.parse(JSON.stringify(DETAIL_BASE));
  const root = w.document.getElementById('phfTaskRoot');
  T.renderTaskRoot(root);
  return root;
}

function renderTaskCreateFull(w) {
  const T = w.__PHF_TASK_TEST__;
  const st = T.getState();
  st.view = 'create'; st.createTab = 'full'; st.quickSuccess = null; st.submitting = false; st.submitError = '';
  st.foundationStatus = { createTaskReady: true }; st.foundationStatusLoading = false;
  st.form = T.defaultTaskForm();
  st.form.flow_type = 'giao_viec'; st.form.title = ''; st.form.category_code = ''; st.form.priority = 'thuong';
  st.form.start_at = '2026-09-01T08:00'; st.form.deadline = '2026-12-01T17:00';
  st.categories = []; st.categoriesLoading = false; st.categoriesError = '';
  st.employees = []; st.employeesLoading = false; st.employeesError = '';
  st.expandedSections = { content: false, related: false, links: false, recurrence: false };
  st.createAttachments = []; st.createAttachError = '';
  st.formErrors = {}; st.primaryPickerOpen = false; st.primaryQuery = ''; st.relatedQuery = '';
  const root = w.document.getElementById('phfTaskRoot');
  T.renderTaskRoot(root);
  return root;
}

(async () => {
  // =========================================================================
  // CASE A — Task Detail: 'change' is sole authoritative event
  // =========================================================================
  {
    const w = newWindow();
    const T = w.__PHF_TASK_TEST__;
    const root = renderTaskDetail(w);
    let input = root.querySelector('[data-task-attach-file-input]');
    pass(!!input, 'A0: real attach input rendered on Task Detail');

    const file = pngFile(w, 'anh-test.png');
    setFiles(input, [file]);

    // 1) 'input' fires first (native order for <input type=file>) -> MUST be a no-op now.
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    const uploadCallsAfterInput = w.__fetchLog.filter((c) => c.url.indexOf('/api/task-attachment') >= 0).length;
    pass(uploadCallsAfterInput === 0, 'A1: "input" event alone does NOT trigger an upload');
    pass(root.querySelector('[data-task-attach-file-input]') === input, 'A1b: "input" did not re-render / detach the input');
    pass(T.getAttachState().busy === false, 'A1c: attach state untouched by "input"');

    // 2) 'change' on the SAME (still-connected) input -> the real, sole trigger.
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
    await tick();

    const uploadCalls = w.__fetchLog.filter((c) => c.url.indexOf('/api/task-attachment') >= 0);
    pass(uploadCalls.length === 1, 'A2: exactly ONE request to /api/task-attachment for one selection', uploadCalls.map((c) => c.url));
    pass(uploadCalls[0].url === '/api/task-attachment?taskId=task-1', 'A2b: correct taskId in the request URL', uploadCalls[0].url);
    pass(uploadCalls[0].opts.body === file, 'A2c: the exact File object is forwarded as the raw body (no re-encode)');
    pass(uploadCalls[0].opts.headers['X-Attachment-Filename'] === encodeURIComponent('anh-test.png'), 'A2d: filename header correct');
    pass(uploadCalls[0].opts.method === 'POST', 'A2e: POST');

    // 3) Reselect the SAME file a second time — value must have been cleared,
    //    and (since the successful upload re-rendered the section) we must
    //    re-query the current input node, same as a real user interacting
    //    with the live DOM.
    const input2 = root.querySelector('[data-task-attach-file-input]');
    pass(!!input2, 'A3: attach input still present after re-render');
    const file2 = pngFile(w, 'anh-test.png'); // same name/content, fresh File instance (browser behaviour on reselect)
    setFiles(input2, [file2]);
    input2.dispatchEvent(new w.Event('change', { bubbles: true }));
    await tick();
    const uploadCalls2 = w.__fetchLog.filter((c) => c.url.indexOf('/api/task-attachment') >= 0);
    pass(uploadCalls2.length === 2, 'A4: re-selecting the SAME file still fires a new upload (value reset worked)', uploadCalls2.length);
    pass(uploadCalls2[1].opts.body === file2, 'A4b: second upload carries the second File instance');
  }

  // =========================================================================
  // CASE B — Full Create: local staged attachment, no network before task_id
  // =========================================================================
  {
    const w = newWindow();
    const T = w.__PHF_TASK_TEST__;
    const root = renderTaskCreateFull(w);
    let input = root.querySelector('[data-task-create-attach-input]');
    pass(!!input, 'B0: real create-attach input rendered on Full Create');

    const file = pngFile(w, 'ke-hoach.png');
    setFiles(input, [file]);

    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    pass(T.getState().createAttachments.length === 0, 'B1: "input" event alone does NOT stage the file');
    pass(w.__fetchLog.filter((c) => c.url.indexOf('/api/task-attachment') >= 0).length === 0, 'B1b: no network call from "input"');

    input.dispatchEvent(new w.Event('change', { bubbles: true }));
    pass(T.getState().createAttachments.length === 1, 'B2: "change" stages exactly one attachment');
    pass(T.getState().createAttachments[0].file === file, 'B2b: staged entry references the real File');
    pass(w.__fetchLog.filter((c) => c.url.indexOf('/api/task-attachment') >= 0).length === 0, 'B2c: still no upload before the Task exists');

    // re-render (state already triggers one inside handleCreateAttachSelect) —
    // assert the staged attachment SURVIVES a further explicit re-render.
    T.renderTaskRoot(root);
    pass(T.getState().createAttachments.length === 1, 'B3: staged attachment survives an additional render');
    const rerenderedInput = root.querySelector('[data-task-create-attach-input]');
    pass(!!rerenderedInput, 'B3b: create-attach input still present after re-render');

    // stage a 2nd file to prove no duplication / accumulation bug from the fix
    const file2 = pngFile(w, 'phu-luc.png');
    setFiles(rerenderedInput, [file2]);
    rerenderedInput.dispatchEvent(new w.Event('change', { bubbles: true }));
    pass(T.getState().createAttachments.length === 2, 'B4: a second selection stages a second entry (no loss, no dupe)');
  }

  // =========================================================================
  // CASE C — duplicate safety: some browser/tool fires BOTH input and change
  //          for one selection -> exactly one processing path runs
  // =========================================================================
  {
    const w = newWindow();
    const T = w.__PHF_TASK_TEST__;
    const root = renderTaskDetail(w);
    const input = root.querySelector('[data-task-attach-file-input]');
    const file = pngFile(w, 'ca-hai-event.png');
    setFiles(input, [file]);

    // Fire BOTH, in native order, back to back (worst case: a tool that still
    // dispatches both like a real browser does for <input type=file>).
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
    await tick();

    const calls = w.__fetchLog.filter((c) => c.url.indexOf('/api/task-attachment') >= 0);
    pass(calls.length === 1, 'C1: input+change together -> exactly ONE upload request (no duplicate)', calls.length);
  }

  console.log('\n==== TASK_ATTACHMENT_INPUT_LIFECYCLE_V1  PASS=' + passed + ' ====');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
