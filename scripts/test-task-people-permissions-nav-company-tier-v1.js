'use strict';

/*
 * PHF Task — "Nhân sự & phân quyền" nav/route company-tier parity
 * (2026-08-29, business owner correction to Known Gap #1 from the earlier
 * company-tier permission cleanup gate).
 *
 * Business contract: Admin = Giám đốc = Trợ lý GĐ on "Nhân sự & phân quyền".
 * ONLY "Cài đặt" (task category admin) stays Admin-exclusive.
 *
 * Frontend fix: NAV_ITEMS 'people-permissions' switched from adminOnly (Hub
 * role==='admin' only) to managePermissionsOnly, gated by
 * taskManagePermissionsAvailable() — hydrated from result.canManageTaskPermissions,
 * an explicit capability-derived signal from the server (scope.capabilities.manage),
 * piggybacking on the SAME probe request already used for hasManagedScope
 * (no extra round trip). taskAdminPeoplePath() is now role-aware
 * (taskHomePath()+'/nhan-su') instead of hard-coded '/admin/...'. 'settings'
 * NAV_ITEM keeps adminOnly (Hub role==='admin') unchanged — untouched by
 * this fix.
 *
 * jsdom, no network, no real DB — same harness pattern as
 * test-task-managed-scope-p0-fix-v1.js.
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

function newWindow(hubRole) {
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/ql/task' });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = function () { return hubRole || 'manager'; };
  window.phfGetCurrentUser = function () { return { fullName: 'Demo', employeeCode: 'DEMO' }; };
  window.phfNavigate = function () { };
  window.phfToast = function () { };
  window.fetch = function () { throw new Error('unstubbed fetch() call'); };
  window.eval(TASK_APP_SRC);
  return window;
}

function mockListTasksResponse(window, resultOverrides, captureBox) {
  window.fetch = function (url, options) {
    const body = JSON.parse(options.body);
    captureBox.calls = (captureBox.calls || 0) + 1;
    captureBox.lastRequest = body;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: Object.assign({ tasks: [], hasMore: false, viewScopeType: 'self', requesterActorType: 'nhan_vien', hasManagedPeople: false, canManageTaskPermissions: false }, resultOverrides) }),
    });
  };
}

(async () => {
  // =========================================================================
  // 1) TLGĐ (Hub role='manager', canManageTaskPermissions=true from server)
  //    -> "Nhân sự & phân quyền" nav item appears, taskAdminPeoplePath() is
  //    role-aware (/ql/... not /admin/...), route resolves to admin-people.
  // =========================================================================
  {
    const window = newWindow('manager');
    const t = window.__PHF_TASK_TEST__;
    const capture = {};
    mockListTasksResponse(window, { viewScopeType: 'all_company', requesterActorType: 'tro_ly_gd', canManageTaskPermissions: true }, capture);
    const root = window.document.getElementById('phfTaskRoot');
    await t.openTaskList(root, 'received');
    pass(t.taskManagePermissionsAvailable() === true, 'TLGĐ: taskManagePermissionsAvailable()=true after hydration from canManageTaskPermissions');
    const visible = t.NAV_ITEMS.filter(function (item) { return !item.managePermissionsOnly || t.taskManagePermissionsAvailable(); }).map(function (i) { return i.key; });
    pass(visible.indexOf('people-permissions') !== -1, 'TLGĐ: "people-permissions" nav item visible', JSON.stringify(visible));
    pass(t.taskAdminPeoplePath() === '/ql/task/nhan-su', 'TLGĐ: taskAdminPeoplePath() is role-aware (/ql/task/nhan-su, not /admin/...)', t.taskAdminPeoplePath());
    const route = t.parseTaskRoute('http://localhost/ql/task/nhan-su');
    pass(route.view === 'admin-people', 'TLGĐ: /ql/task/nhan-su route resolves to view=admin-people', JSON.stringify(route));
  }

  // =========================================================================
  // 2) Admin (Hub role='admin') — unaffected baseline: still true, path is
  //    /admin/task/nhan-su as before.
  // =========================================================================
  {
    const window = newWindow('admin');
    const t = window.__PHF_TASK_TEST__;
    const capture = {};
    mockListTasksResponse(window, { viewScopeType: 'all_company', requesterActorType: 'admin', canManageTaskPermissions: true }, capture);
    const root = window.document.getElementById('phfTaskRoot');
    await t.openTaskList(root, 'received');
    pass(t.taskManagePermissionsAvailable() === true, 'Admin: taskManagePermissionsAvailable()=true (baseline unaffected)');
    pass(t.taskAdminPeoplePath() === '/admin/task/nhan-su', 'Admin: taskAdminPeoplePath() unchanged (/admin/task/nhan-su)', t.taskAdminPeoplePath());
  }

  // =========================================================================
  // 3) TBP (Hub role='manager', canManageTaskPermissions=false from server —
  //    TBP still NOT company-tier) -> nav item stays hidden, fail-closed.
  // =========================================================================
  {
    const window = newWindow('manager');
    const t = window.__PHF_TASK_TEST__;
    const capture = {};
    mockListTasksResponse(window, { viewScopeType: 'employees', requesterActorType: 'truong_bo_phan', hasManagedPeople: true, canManageTaskPermissions: false }, capture);
    const root = window.document.getElementById('phfTaskRoot');
    await t.openTaskList(root, 'received');
    pass(t.taskManagePermissionsAvailable() === false, 'TBP: taskManagePermissionsAvailable()=false (has managed people, but NOT permission-management capability)');
    const visible = t.NAV_ITEMS.filter(function (item) { return !item.managePermissionsOnly || t.taskManagePermissionsAvailable(); }).map(function (i) { return i.key; });
    pass(visible.indexOf('people-permissions') === -1, 'TBP: "people-permissions" nav item stays hidden', JSON.stringify(visible));
  }

  // =========================================================================
  // 4) Plain employee -> hidden (fail-closed default, no hydration yet).
  // =========================================================================
  {
    const window = newWindow('learner');
    const t = window.__PHF_TASK_TEST__;
    pass(t.taskManagePermissionsAvailable() === false, 'Cold state (before any hydration): taskManagePermissionsAvailable()=false, fail-closed');
  }

  // =========================================================================
  // 5) "Cài đặt" (settings) untouched — still Hub-role-admin-only, NOT tied
  //    to canManageTaskPermissions (TLGĐ from case 1 must still lack it).
  // =========================================================================
  {
    const window = newWindow('manager');
    const t = window.__PHF_TASK_TEST__;
    const capture = {};
    mockListTasksResponse(window, { viewScopeType: 'all_company', requesterActorType: 'tro_ly_gd', canManageTaskPermissions: true }, capture);
    const root = window.document.getElementById('phfTaskRoot');
    await t.openTaskList(root, 'received');
    const visible = t.NAV_ITEMS.filter(function (item) { return !item.adminOnly || false; }).map(function (i) { return i.key; }); // isTaskAdminUi() false for Hub role='manager'
    pass(visible.indexOf('settings') === -1, 'TLGĐ (Hub role=manager): "settings" (Cài đặt) nav item still hidden — untouched by this fix, still Admin-only via Hub role', JSON.stringify(visible));
  }

  console.log(`PHF Task People-Permissions Nav Company-Tier V1 test: ${passed}/${passed} PASS`);
})().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
