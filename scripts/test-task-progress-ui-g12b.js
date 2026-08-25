'use strict';

/*
 * PHF Task — G12B PROGRESS UI — static/behavioral assertions, jsdom, no
 * network, no real DB. Loads the REAL production file via window.eval (same
 * harness pattern as scripts/test-task-cancel-v4.js). Covers: current-percent
 * visibility, range+number+quick-pick control presence, status-gating
 * (published/in_progress only), percent→progress_status derivation, payload
 * shape sent to updateTaskProgress, and that 100% never triggers completeTask.
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
function baseTask(overrides) {
  return Object.assign({ id: 'task-g12b-1', status: 'published', row_version: 5, progress_percent: 20, progress_status: 'dang_thuc_hien', title: 'G12B fixture' }, overrides || {});
}
function click(window, root, selector) {
  const el = root.querySelector(selector);
  assert.ok(el, 'click target must exist: ' + selector);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

(async () => {
  // ---- A. Static presence/visibility on an active (published) task ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const html = T.taskLifecycleSectionHtml(baseTask());
    pass(html.includes('Tiến độ hiện tại: 20%'), 'A1: current percent visible without any click ("Tiến độ hiện tại: 20%")');
    pass(/data-task-progress-range[^>]*value="20"/.test(html), 'A2: range input present and pre-filled with current percent');
    pass(/data-task-progress-number[^>]*value="20"/.test(html), 'A3: number input present and pre-filled with current percent');
    ['0', '25', '50', '75', '100'].forEach(v => pass(html.includes('data-task-progress-quick="' + v + '"'), 'A4: quick pick ' + v + '% present'));
    pass(html.includes('data-task-progress-save'), 'A5: Save button present');
    pass(!html.includes('data-task-lifecycle-open="progress"'), 'A6: no separate click-to-open toggle for progress (control is inline, always visible)');
    pass(!/data-task-lifecycle-field="progressStatus"/.test(html), 'A7: no manual progress_status selector (derived from percent client-side)');
  }

  // ---- B. Status gating ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    ['completed', 'cancelled', 'draft'].forEach(status => {
      const html = T.taskLifecycleSectionHtml(baseTask({ status }));
      pass(!html.includes('data-task-progress-save'), 'B: progress control hidden for status=' + status);
    });
    const inProgHtml = T.taskLifecycleSectionHtml(baseTask({ status: 'in_progress' }));
    pass(inProgHtml.includes('data-task-progress-save'), 'B: progress control shown for status=in_progress');
  }

  // ---- C. Percent -> progress_status derivation ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    pass(T.taskProgressStatusForPercent(0) === 'chua_bat_dau', 'C1: 0% -> chua_bat_dau');
    pass(T.taskProgressStatusForPercent(1) === 'dang_thuc_hien', 'C2: 1% -> dang_thuc_hien');
    pass(T.taskProgressStatusForPercent(99) === 'dang_thuc_hien', 'C3: 99% -> dang_thuc_hien');
    pass(T.taskProgressStatusForPercent(100) === 'hoan_thanh', 'C4: 100% -> hoan_thanh');
    pass(T.clampTaskPercent(-5) === 0, 'C5: clamp negative to 0');
    pass(T.clampTaskPercent(150) === 100, 'C6: clamp >100 to 100');
    pass(T.clampTaskPercent('abc') === 0, 'C7: clamp NaN-ish to 0');
  }

  // ---- D. Interactive: quick-pick updates live display ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const state = T.getState();
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    state.view = 'detail'; state.taskId = 'task-g12b-1'; state.detail = { task: baseTask({ progress_percent: 20 }) };
    root.innerHTML = T.shellFrame(T.detailContentHtml(state.detail, []));
    T.bindShell(root);
    click(window, root, '[data-task-progress-quick="75"]');
    pass(state.lifecyclePercent === 75 && state.lifecycleDirty === true, 'D1: clicking 75% quick-pick updates state');
    root.innerHTML = T.shellFrame(T.detailContentHtml(state.detail, []));
    pass(root.innerHTML.includes('Tiến độ hiện tại: 75%'), 'D2: re-render reflects the new percent immediately (no save needed to see it)');
    pass(root.innerHTML.includes('Đang thực hiện'), 'D3: derived status label shown for 75%');
  }

  // ---- E. Save payload shape + 100% never triggers completeTask ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const state = T.getState();
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    const task = baseTask({ progress_percent: 40, row_version: 9 });
    state.view = 'detail'; state.taskId = task.id; state.detail = { task: task };
    let capturedBody = null;
    window.fetch = function (url, options) {
      const body = JSON.parse(options.body);
      if (body.action === 'updateTaskProgress') capturedBody = body;
      const resultTask = body.action === 'updateTaskProgress' ? Object.assign({}, task, { progress_percent: body.progress_percent, progress_status: body.progress_status, row_version: task.row_version + 1 }) : task;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: resultTask }) });
    };
    root.innerHTML = T.shellFrame(T.detailContentHtml(state.detail, []));
    T.bindShell(root);
    click(window, root, '[data-task-progress-quick="100"]');
    root.innerHTML = T.shellFrame(T.detailContentHtml(state.detail, []));
    T.bindShell(root);
    click(window, root, '[data-task-progress-save]');
    await new Promise(r => setTimeout(r, 20));
    pass(!!capturedBody, 'E1: Save triggered a real fetch to the API');
    pass(capturedBody.action === 'updateTaskProgress', 'E2: action=updateTaskProgress (never completeTask, even at 100%)');
    pass(capturedBody.task_id === task.id, 'E3: task_id matches');
    pass(capturedBody.expected_row_version === 9, 'E4: expected_row_version = row_version read from loaded detail (CAS)');
    pass(capturedBody.progress_percent === 100, 'E5: progress_percent=100 sent');
    pass(capturedBody.progress_status === 'hoan_thanh', 'E6: progress_status derived as hoan_thanh for 100%');
  }

  console.log(`PHF Task G12B Progress UI test: ${passed}/${passed} PASS`);
})().catch(err => { console.error('FAIL', err); process.exit(1); });
