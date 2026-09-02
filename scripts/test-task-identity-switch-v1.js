'use strict';

/*
 * PHF Task — IDENTITY SWITCH stale-UI invalidation (jsdom, no network).
 *
 * Proves: when the authenticated identity changes, every user-scoped Task slice
 * (dashboard/list/report/overview/detail/capabilities/notifications) is dropped
 * BEFORE the new identity renders, and a late response from the previous
 * identity can never repopulate the new identity's UI. Static config
 * (nav group expand prefs) is preserved. Same-identity navigation does NOT wipe.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const TASK_APP_SRC = fs.readFileSync(path.join(ROOT, 'assets/js/task/phf-task-app.js'), 'utf8');

let passed = 0;
function pass(cond, msg) { assert.ok(cond, msg); passed += 1; console.log('  PASS  ' + msg); }

function newWindow() {
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/admin/task' });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  const state = { user: null };
  window.__setUser = function (u) { state.user = u; };
  window.phfGetAuthenticatedUser = function () { return state.user; };
  window.phfGetCurrentUser = function () { return state.user; };
  window.phfGetSessionRole = function () { return state.user ? String(state.user.role || '') : ''; };
  window.__phfNav = [];
  window.phfNavigate = function (p) { window.__phfNav.push(p); return Promise.resolve(true); };
  window.phfToast = function () {};
  window.fetch = function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true, result: {} }); } }); };
  window.eval(TASK_APP_SRC);
  return window;
}

const THANG = { id: 'acc-thang-uuid', employeeCode: 'PHF012', role: 'manager' };
const ADMIN = { id: 'acc-admin-uuid', employeeCode: '', role: 'admin' };

// seed a fully-populated "previous identity" Task state
function seedPopulated(T) {
  const st = T.getState();
  st.overview.data = { report_contract_version: 'x', kpis: { total: 999 } };
  st.list.tasks = [{ task_id: 't-old', title: 'Việc của Thắng' }];
  st.report.summary = { data: { done: 42 } };
  st.detail = { task: { id: 't-old' } };
  st.taskId = 't-old';
  st.hasManagedScope = true;
  st.managedScopeHydrated = true;
  st.canManageTaskPermissions = true;
  st.adminPeople = [{ employeeCode: 'PHF001' }];
  st.navGroupExpanded = { myWork: true }; // STATIC config — must survive
  T.setNotifState({ items: [{ id: 'n-old', title: 'cũ', status: 'unread' }], unread: 3, loaded: true, open: true });
}

(async () => {
  // ---- [1] Thắng -> Admin: previous data cleared before new render ----
  {
    const w = newWindow(); const T = w.__PHF_TASK_TEST__;
    w.__setUser(THANG);
    T.syncTaskIdentity(null);                 // first mount — establishes key, no reset
    const gen0 = T.getTaskIdentityGen();
    seedPopulated(T);
    w.__setUser(ADMIN);
    const changed = T.syncTaskIdentity(null); // identity switch
    const st = T.getState();
    pass(changed === true, '[1] syncTaskIdentity reports the switch');
    pass(T.getTaskIdentityGen() === gen0 + 1, '[1b] identity generation bumped exactly once');
    pass(st.overview.data === null && st.list.tasks.length === 0 && st.report.summary.data == null,
      '[1c] dashboard / list / report data from the previous identity is GONE');
    pass(st.detail === null && st.taskId === '', '[1d] selected task detail cleared');
    pass(st.hasManagedScope === false && st.managedScopeHydrated === false && st.canManageTaskPermissions === false,
      '[1e] permission/scope capability state from the previous identity is GONE');
    pass(st.adminPeople === null, '[1f] admin people cache cleared');
    pass(T.getNotifState().items.length === 0 && T.getNotifState().unread === 0 && T.getNotifState().open === false && T.getNotifState().loaded === false,
      '[1g] notification badge/panel/state cleared on switch');
    pass(st.navGroupExpanded && st.navGroupExpanded.myWork === true, '[1h] STATIC nav-group expand config is PRESERVED');
  }

  // ---- [2] Admin -> Thắng: company-wide admin data must not linger ----
  {
    const w = newWindow(); const T = w.__PHF_TASK_TEST__;
    w.__setUser(ADMIN); T.syncTaskIdentity(null);
    T.getState().overview.data = { kpis: { total: 100000 } }; // company-wide
    T.setNotifState({ items: [{ id: 'a1' }], unread: 9 });
    w.__setUser(THANG);
    T.syncTaskIdentity(null);
    pass(T.getState().overview.data === null && T.getNotifState().unread === 0,
      '[2] Admin company-wide overview + notifications do not survive the switch to Thắng');
  }

  // ---- [3] late response from the PREVIOUS identity cannot repopulate ----
  {
    const w = newWindow(); const T = w.__PHF_TASK_TEST__;
    w.__setUser(THANG); T.syncTaskIdentity(null);
    let release;
    w.fetch = function () {
      return new Promise(function (resolve) { release = function () { resolve({ ok: true, json: function () { return Promise.resolve({ ok: true, result: { hasManagedPeople: true, canManageTaskPermissions: true } }); } }); }; });
    };
    const p = T.hydrateManagedScopeIfNeeded(null); // in flight for Thắng
    w.__setUser(ADMIN);
    T.syncTaskIdentity(null);                       // identity switches while request pending
    release();                                      // stale Thắng response lands now
    await p;
    pass(T.getState().hasManagedScope === false && T.getState().canManageTaskPermissions === false,
      '[3] a late managed-scope response from the previous identity is DISCARDED (generation guard)');
  }

  // ---- [4] same identity, repeated sync -> no wipe ----
  {
    const w = newWindow(); const T = w.__PHF_TASK_TEST__;
    w.__setUser(THANG); T.syncTaskIdentity(null);
    seedPopulated(T);
    const gen = T.getTaskIdentityGen();
    const changed = T.syncTaskIdentity(null);
    pass(changed === false && T.getTaskIdentityGen() === gen, '[4] same identity -> syncTaskIdentity is a no-op');
    pass(T.getState().overview.data !== null && T.getNotifState().unread === 3, '[4b] same-identity navigation does NOT wipe user state');
  }

  // ---- [5] logout (null) then login -> cleared ----
  {
    const w = newWindow(); const T = w.__PHF_TASK_TEST__;
    w.__setUser(THANG); T.syncTaskIdentity(null);
    seedPopulated(T);
    w.__setUser(null); T.syncTaskIdentity(null);      // logout
    pass(T.getState().overview.data === null && T.getNotifState().items.length === 0, '[5] logout clears user-scoped Task state');
    w.__setUser(ADMIN); const changed = T.syncTaskIdentity(null); // login as a different account
    pass(changed === true && T.getState().list.tasks.length === 0, '[5b] subsequent login starts from a clean slate');
  }

  // ---- [6] identity key shape: account id + employee code + role ----
  {
    const w = newWindow(); const T = w.__PHF_TASK_TEST__;
    w.__setUser(THANG);
    pass(T.computeTaskIdentityKey() === 'acc-thang-uuid|PHF012|manager', '[6] identity key = accountId|EMPLOYEECODE|role');
    w.__setUser(ADMIN);
    pass(T.computeTaskIdentityKey() === 'acc-admin-uuid||admin', '[6b] account-only Admin (no employee code) still yields a distinct key');
    w.__setUser(null);
    pass(T.computeTaskIdentityKey() === null, '[6c] no session -> null key');
  }

  // ---- [7] the phf-auth-changed event drives invalidation when Task is mounted ----
  {
    const w = newWindow(); const T = w.__PHF_TASK_TEST__;
    w.__setUser(THANG); T.syncTaskIdentity(null);
    seedPopulated(T);
    const root = w.document.getElementById('phfTaskRoot');
    root.innerHTML = '<div>mounted</div>'; // simulate a rendered Task shell
    w.__setUser(ADMIN);
    w.dispatchEvent(new w.CustomEvent('phf-auth-changed', { detail: { user: ADMIN } }));
    pass(T.getState().overview.data === null && T.getNotifState().unread === 0,
      '[7] phf-auth-changed clears stale Task state without waiting for the next route render');
  }

  // ---- [8] routes still parse after the change ----
  {
    const w = newWindow(); const T = w.__PHF_TASK_TEST__;
    w.__setUser(ADMIN);
    pass(T.parseTaskRoute('/admin/task/bao-cao').view === 'report' && T.parseTaskRoute('/admin/task').view === 'dashboard',
      '[8] task route parsing remains functional');
  }

  console.log('\n==== TASK_IDENTITY_SWITCH_V1  PASS=' + passed + ' ====');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
