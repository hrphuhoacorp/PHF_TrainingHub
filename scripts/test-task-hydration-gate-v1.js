'use strict';

/*
 * PHF Task — SCREEN HYDRATION / LOADING GATE V1.
 *
 * Builds ON TOP of the identity-invalidation mechanism (test-task-identity-
 * switch-v1.js). Until the minimum truthful screen state is ready — identity
 * resolved + managed-scope/permission probe done + the screen's own primary
 * payload present — renderTaskRoot() must show a controlled skeleton (nav +
 * main), never the real screen with stale / fail-closed / empty-flash data.
 *
 * jsdom, no network, no DB — same harness pattern as
 * scripts/test-task-managed-scope-cold-start-hydration-v1.js.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }
const TASK_APP_SRC = fs.readFileSync(path.join(ROOT, 'assets/js/task/phf-task-app.js'), 'utf8');

function newWindow() {
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>',
    { runScripts: 'outside-only', url: 'http://localhost/ql/task' });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = function () { return 'manager'; };
  window.phfGetCurrentUser = function () { return { fullName: 'Demo TBP', employeeCode: 'DEMO_TBP', id: 'acc-1', role: 'manager' }; };
  window.phfGetAuthenticatedUser = window.phfGetCurrentUser;
  window.phfNavigate = function () {};
  window.phfToast = function () {};
  window.fetch = function () { throw new Error('unstubbed fetch()'); };
  window.eval(TASK_APP_SRC);
  return window;
}

// ---------------------------------------------------------------------------
{
  const w = newWindow();
  const T = w.__PHF_TASK_TEST__;
  const st = T.getState();
  const root = w.document.getElementById('phfTaskRoot');

  // 1. Dormant until the real nav entrypoint arms it — direct-render unit
  //    tests and existing suites are unaffected.
  pass(T.isTaskShellArmed() === false, 'gate: dormant before phfRenderTask arms it');
  st.view = 'dashboard';
  pass(T.taskScreenGated() === false, 'gate: not gated while dormant (even with no data)');

  // 2. Armed + identity resolved + probe NOT done -> gated.
  T.armTaskShell(true);
  T.syncTaskIdentity(root);            // resolves phfTaskIdentityKey
  st.managedScopeHydrated = false;
  st.overview.data = { effective_scope: 'managed', metrics: {} };
  pass(T.taskShellHydrated() === false, 'gate: managed-scope probe not yet hydrated');
  pass(T.taskScreenGated() === true, 'gate: armed + probe pending -> gated even if a payload is already sitting in state');

  T.renderTaskRoot(root);
  const html1 = root.innerHTML;
  pass(/phft-hydration-gate/.test(html1), 'gate: renders the skeleton gate in <main>');
  pass(/phft-nav-skel/.test(html1) && !/data-task-nav=/.test(html1), 'gate: nav is a skeleton — no real (permission-dependent) nav buttons rendered');
  pass(/aria-busy="true"/.test(html1), 'gate: skeleton is announced busy to AT');
  pass(/is-hydrating/.test(html1), 'gate: root shell flagged is-hydrating (main pointer-events:none)');
  pass(!/DEMO TBP-should-not/.test(html1), 'gate: no task rows / counts leaked into the skeleton');

  // 3. Probe done + primary payload present -> real screen.
  st.managedScopeHydrated = true;
  pass(T.taskScreenGated() === false, 'gate: hydrated + overview payload -> reveal');
  T.renderTaskRoot(root);
  pass(!/phft-hydration-gate/.test(root.innerHTML) && /phft-nav-item/.test(root.innerHTML), 'gate: real nav + screen render once ready');
}

// ---------------------------------------------------------------------------
{
  const w = newWindow();
  const T = w.__PHF_TASK_TEST__;
  const st = T.getState();
  const root = w.document.getElementById('phfTaskRoot');
  T.armTaskShell(true);
  T.syncTaskIdentity(root);
  st.managedScopeHydrated = true;

  // 4. Per-screen minimum-ready contracts.
  st.view = 'list';
  st.list.loadedOnce = false; st.list.error = '';
  pass(T.taskScreenGated() === true, 'contract(list): identity+scope ready but first list payload not in -> gated');
  st.list.loadedOnce = true;
  pass(T.taskScreenGated() === false, 'contract(list): first payload in -> reveal');

  st.view = 'recurrence';
  st.recurrenceManage.loadedOnce = false; st.recurrenceManage.error = '';
  pass(T.taskScreenGated() === true, 'contract(recurrence): first rule list not in -> gated');
  st.recurrenceManage.error = 'boom';
  pass(T.taskScreenGated() === false, 'contract(recurrence): a hard error is NOT the gate — the screen shows its own retry/error, no stale fallback');

  st.view = 'admin-people';
  st.adminPeople = null; st.adminPeopleError = '';
  pass(T.taskScreenGated() === true, 'contract(people): permission policy + people list not in -> gated');
  st.adminPeople = { people: [] };
  pass(T.taskScreenGated() === false, 'contract(people): ready -> reveal');

  st.view = 'detail';
  st.detail = null; st.detailError = ''; st.detailLoading = true;
  pass(T.taskScreenGated() === false, 'contract(detail): detail has its own loading view — gate defers to it');
}

// ---------------------------------------------------------------------------
{
  // 5. Identity switch: gate re-engages, no old-user flash.
  const w = newWindow();
  const T = w.__PHF_TASK_TEST__;
  const st = T.getState();
  const root = w.document.getElementById('phfTaskRoot');
  T.armTaskShell(true);
  T.syncTaskIdentity(root);
  st.managedScopeHydrated = true;
  st.view = 'list';
  st.list.loadedOnce = true;
  st.list.tasks = [{ id: 'T-OLD', title: 'PREV USER TASK' }];
  pass(T.taskScreenGated() === false, 'switch: user A screen ready');

  T.resetTaskUserScopedState();   // what the identity-change handler runs
  pass(st.managedScopeHydrated === false, 'switch: reset drops the scope-hydrated flag');
  pass(st.list.loadedOnce !== true, 'switch: reset drops the previous list payload marker');
  pass(T.taskScreenGated() === true, 'switch: gate re-engages immediately for the new identity');
  T.renderTaskRoot(root);
  pass(!/PREV USER TASK/.test(root.innerHTML), 'switch: previous identity task row never rendered');
  pass(/phft-hydration-gate/.test(root.innerHTML), 'switch: skeleton shown while the new identity hydrates');
}

// ---------------------------------------------------------------------------
{
  // 6. The managed-scope probe is bounded so the gate cannot hang forever.
  pass(/action:'listTasks'[^)]*scope:'managed',limit:1,offset:0\},\{timeoutMs:\d+\}/.test(TASK_APP_SRC),
    'no-hang: the managed-scope hydrate probe carries a bounded timeoutMs');
  pass(/taskUiState\.canManageTaskPermissions=false;\s*\/\/ fail-closed/.test(TASK_APP_SRC),
    'no-hang: probe failure is fail-closed (narrower), never a scoped->broader fallback');
}

console.log('PHF Task HYDRATION GATE V1: ' + passed + '/' + passed + ' PASS');
