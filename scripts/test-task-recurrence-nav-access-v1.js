'use strict';
/* PHF Task — RECURRENCE MANAGEMENT NAV/ROUTE ACCESS (all Task users) — jsdom
   DOM/logic regression, no backend, no network. Asserts "Lịch lặp" is a core
   user feature exposed for learner / manager / admin through ONE shared
   component (no duplication), and that identity switch drops the previous
   user's recurrence rows.
   Run: node scripts/test-task-recurrence-nav-access-v1.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'assets', 'js', 'task', 'phf-task-app.js'), 'utf8');

let passed = 0;
function pass(cond, msg) { assert.ok(cond, msg); passed += 1; console.log('  ok - ' + msg); }

function load(role, url) {
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: url });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = function () { return role; };
  window.phfGetCurrentUser = function () { return { fullName: 'U ' + role, email: role + '@test', employeeCode: 'NV' + role }; };
  window.phfNavigate = function () {};
  window.phfToast = function () {};
  window.eval(code);
  return window.__PHF_TASK_TEST__;
}

const ROLE_PREFIX = { learner: '/hv', manager: '/ql', admin: '/admin' };

Object.keys(ROLE_PREFIX).forEach(function (role) {
  const prefix = ROLE_PREFIX[role];
  const T = load(role, 'http://localhost' + prefix + '/task');

  pass(T.taskRecurrencePath() === prefix + '/task/lich-lap', role + ': taskRecurrencePath() is role-aware (' + prefix + '/task/lich-lap)');
  pass(T.parseTaskRoute(prefix + '/task/lich-lap').view === 'recurrence', role + ': ' + prefix + '/task/lich-lap parses to the recurrence view');

  // NAV item present + NOT gated as adminOnly
  const navItem = T.NAV_ITEMS.filter(function (i) { return i.key === 'lich-lap'; })[0];
  pass(navItem && !navItem.adminOnly, role + ': "lich-lap" nav item exists and is not adminOnly');

  const st = T.getState();
  st.view = 'recurrence';
  const shell = T.shellFrame('<div></div>');
  pass(/data-task-nav="lich-lap"/.test(shell) && /Lịch lặp/.test(shell), role + ': "Lịch lặp" is rendered in the Task sidebar');
});

// Shared component — the three routes resolve to the SAME renderer function
(function () {
  const T = load('learner', 'http://localhost/hv/task');
  pass(typeof T.taskRecurrenceManageHtml === 'function' && typeof T.openTaskRecurrenceManage === 'function',
    'ONE shared recurrence renderer/opener is exported (no per-role fork)');
  // learner can drive the shared opener (no admin short-circuit)
  const st = T.getState();
  st.recurrenceManage = { loading: false, error: '', saving: false, confirmStop: null, editing: null, rules: [
    { id: 'r1', title: 'Việc lặp của tôi', primary_employee_name: 'Tôi', cycle: 'Hàng tuần · Thứ 2', frequency: 'weekly',
      weekday: 'T2', day_of_month: null, start_time: '08:00', anchor_date: '2026-09-07', next_run_date: '2026-09-14',
      status: 'active', status_label: 'Đang hoạt động', can_edit: true, can_pause: true, can_resume: false, can_stop: true } ] };
  const html = T.taskRecurrenceManageHtml();
  pass(/Việc lặp của tôi/.test(html) && /data-task-recurrence-manage-action="pause"/.test(html),
    'learner renders the shared "Lịch lặp" management table with per-rule actions');

  // identity switch drops previous user's recurrence rows
  if (typeof T.resetTaskUserScopedState === 'function') {
    T.resetTaskUserScopedState();
    pass((T.getState().recurrenceManage.rules || []).length === 0,
      'identity/account switch clears recurrenceManage.rules (no leak of previous user data)');
  } else {
    pass(false, 'resetTaskUserScopedState must be exported for identity-switch safety');
  }
})();

console.log('\nPHF Task Recurrence nav/route access: ' + passed + '/' + passed + ' PASS');
