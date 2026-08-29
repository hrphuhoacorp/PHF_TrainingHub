'use strict';

/*
 * PHF Task — "Nhân sự tôi quản lý" P0 FIX V1 — targeted regression for the
 * 2 P0 bugs found in the read-only audit (2026-08-26) and fixed in this
 * gate:
 *   1. taskUiState.hasManagedScope was never hydrated (stuck at its initial
 *      false forever) -> nav item never rendered for real TBP/Trưởng ca.
 *   2. loadTaskList()/loadMoreTaskList() sent relation:'managed' literally
 *      to the server, which only accepts relation IN
 *      ['received','assigned','proposal_sent','proposal_received'] ->
 *      guaranteed 400 TASK_LIST_RELATION_INVALID if the nav item were ever
 *      reachable.
 *
 * jsdom, no network, no real DB — same harness pattern as
 * scripts/test-task-calendar-foundation-v1.js (loads the REAL production
 * file via window.eval, stubs window.fetch to capture the exact outgoing
 * request and control the mocked response).
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
  window.phfGetSessionRole = function () { return 'manager'; };
  window.phfGetCurrentUser = function () { return { fullName: 'Demo TBP', employeeCode: 'DEMO_TBP' }; };
  window.phfNavigate = function () { };
  window.phfToast = function () { };
  window.fetch = function () { throw new Error('unstubbed fetch() call'); };
  window.eval(TASK_APP_SRC);
  return window;
}

function mockListTasksResponse(window, resultOverrides, captureBox) {
  window.fetch = function (url, options) {
    const body = JSON.parse(options.body);
    captureBox.lastRequest = body;
    return Promise.resolve({
      ok: true,
      // hasManagedPeople defaults to false (fail-closed) — G3 FOLLOW-UP fix
      // (2026-08-28): frontend now hydrates hasManagedScope from THIS
      // explicit field (managedEmployeeCodes.length>0, server-computed),
      // NOT from viewScopeType/requesterActorType heuristics anymore — see
      // hydrateManagedScopeIfNeeded()/loadTaskList() in phf-task-app.js.
      json: () => Promise.resolve({ ok: true, result: Object.assign({ tasks: [], hasMore: false, viewScopeType: 'self', requesterActorType: 'nhan_vien', hasManagedPeople: false }, resultOverrides) }),
    });
  };
}

(async () => {
  const T = () => newWindow().__PHF_TASK_TEST__;

  // =========================================================================
  // 1) TBP có managed scope thật (server trả viewScopeType='employees' +
  //    requesterActorType='truong_bo_phan') -> hasManagedScope=true sau load.
  // =========================================================================
  {
    const window = newWindow();
    const t = window.__PHF_TASK_TEST__;
    const capture = {};
    mockListTasksResponse(window, { viewScopeType: 'employees', requesterActorType: 'truong_bo_phan', hasManagedPeople: true }, capture);
    const root = window.document.getElementById('phfTaskRoot');
    await t.openTaskList(root, 'received');
    pass(t.getState().hasManagedScope === true, 'TBP với hasManagedPeople=true -> hasManagedScope=true');
    pass(t.taskManagerScopeAvailable() === true, 'taskManagerScopeAvailable() true ngay sau khi hydrate cho TBP');
  }

  // =========================================================================
  // 2) Trưởng ca có managed scope thật -> hasManagedScope=true.
  // =========================================================================
  {
    const window = newWindow();
    const t = window.__PHF_TASK_TEST__;
    const capture = {};
    mockListTasksResponse(window, { viewScopeType: 'employees', requesterActorType: 'truong_ca', hasManagedPeople: true }, capture);
    const root = window.document.getElementById('phfTaskRoot');
    await t.openTaskList(root, 'received');
    pass(t.getState().hasManagedScope === true, 'Trưởng ca với hasManagedPeople=true -> hasManagedScope=true');
  }

  // =========================================================================
  // 3) Nhân viên thường (viewScopeType='self', requesterActorType='nhan_vien')
  //    -> hasManagedScope vẫn false, menu không hiện.
  // =========================================================================
  {
    const window = newWindow();
    const t = window.__PHF_TASK_TEST__;
    const capture = {};
    mockListTasksResponse(window, { viewScopeType: 'self', requesterActorType: 'nhan_vien' }, capture);
    const root = window.document.getElementById('phfTaskRoot');
    await t.openTaskList(root, 'received');
    pass(t.getState().hasManagedScope === false, 'Nhân viên thường -> hasManagedScope vẫn false');
    pass(t.taskManagerScopeAvailable() === false, 'taskManagerScopeAvailable() false cho nhân viên thường');
  }

  // =========================================================================
  // 3b) G3 FOLLOW-UP (2026-08-28): viewScopeType='all_company' (GĐ/Admin)
  //     KHÔNG còn tự quyết định hasManagedScope — hasManagedPeople (server,
  //     từ managedEmployeeCodes thật) mới là nguồn sự thật. GĐ KHÔNG có
  //     direct report thật (hasManagedPeople=false) -> vẫn ẩn menu, dù
  //     viewScopeType=all_company (capability, không phải quan hệ quản lý).
  // =========================================================================
  {
    const window = newWindow();
    const t = window.__PHF_TASK_TEST__;
    const capture = {};
    mockListTasksResponse(window, { viewScopeType: 'all_company', requesterActorType: 'giam_doc', hasManagedPeople: false }, capture);
    const root = window.document.getElementById('phfTaskRoot');
    await t.openTaskList(root, 'received');
    pass(t.getState().hasManagedScope === false, 'GĐ với hasManagedPeople=false (không có direct report thật) -> vẫn false (fail-closed), dù viewScopeType=all_company');
  }

  // =========================================================================
  // 3c) G3 FOLLOW-UP: GĐ/TLGĐ VỚI hasManagedPeople=true thật (vd PHF010 quản
  //     lý 8 direct report) -> hasManagedScope=true, menu HIỆN — dù
  //     actorType không phải truong_bo_phan/truong_ca (điều kiện cũ đã bỏ).
  // =========================================================================
  {
    const window = newWindow();
    const t = window.__PHF_TASK_TEST__;
    const capture = {};
    mockListTasksResponse(window, { viewScopeType: 'all_company', requesterActorType: 'tro_ly_gd', hasManagedPeople: true }, capture);
    const root = window.document.getElementById('phfTaskRoot');
    await t.openTaskList(root, 'received');
    pass(t.getState().hasManagedScope === true, 'TLGĐ với hasManagedPeople=true thật (vd PHF010, 8 direct report) -> hasManagedScope=true, menu HIỆN dù viewScopeType=all_company');
    pass(t.taskManagerScopeAvailable() === true, 'taskManagerScopeAvailable() true cho TLGĐ có managed people thật');
  }

  // =========================================================================
  // 4) TBP click "Nhân sự tôi quản lý" (relation='managed' phía UI) -> request
  //    thật gửi lên server PHẢI là relation:'received', scope:'managed' —
  //    KHÔNG còn relation:'managed' (nguồn gốc lỗi 400 TASK_LIST_RELATION_INVALID).
  // =========================================================================
  {
    const window = newWindow();
    const t = window.__PHF_TASK_TEST__;
    const capture = {};
    mockListTasksResponse(window, { viewScopeType: 'employees', requesterActorType: 'truong_bo_phan' }, capture);
    const root = window.document.getElementById('phfTaskRoot');
    await t.openTaskList(root, 'managed');
    pass(capture.lastRequest.relation === 'received', 'request thật: relation=received (không phải "managed")');
    pass(capture.lastRequest.scope === 'managed', 'request thật: scope=managed');
    pass(t.getState().list.relation === 'managed', 'UI state nội bộ list.relation vẫn giữ "managed" (không đổi UI logic khác)');
  }

  // =========================================================================
  // 4b) "Nhân sự tôi quản lý" + filter "Liên phòng ban" (list.scope đã được
  //     người dùng chọn = cross_department) -> vẫn giữ đúng cross_department,
  //     không bị fix này ghi đè thành 'managed'.
  // =========================================================================
  {
    const window = newWindow();
    const t = window.__PHF_TASK_TEST__;
    const capture = {};
    mockListTasksResponse(window, { viewScopeType: 'employees', requesterActorType: 'truong_bo_phan' }, capture);
    const root = window.document.getElementById('phfTaskRoot');
    await t.openTaskList(root, 'managed');
    t.getState().list.scope = 'cross_department';
    mockListTasksResponse(window, { viewScopeType: 'employees', requesterActorType: 'truong_bo_phan' }, capture);
    await t.loadTaskList(root);
    pass(capture.lastRequest.relation === 'received', 'cross_department filter: relation vẫn dịch đúng thành received');
    pass(capture.lastRequest.scope === 'cross_department', 'cross_department filter: scope giữ nguyên cross_department, không bị ép thành managed');
  }

  // =========================================================================
  // 5) "Tôi nhận" (relation='received', scope mặc định rỗng) — semantics giữ
  //    nguyên y hệt trước fix: relation=received, scope=undefined.
  // =========================================================================
  {
    const window = newWindow();
    const t = window.__PHF_TASK_TEST__;
    const capture = {};
    mockListTasksResponse(window, { viewScopeType: 'employees', requesterActorType: 'truong_bo_phan' }, capture);
    const root = window.document.getElementById('phfTaskRoot');
    await t.openTaskList(root, 'received');
    pass(capture.lastRequest.relation === 'received', '"Tôi nhận": relation=received không đổi');
    pass(capture.lastRequest.scope === undefined, '"Tôi nhận": scope mặc định vẫn undefined (không tự gán managed)');
  }

  // =========================================================================
  // 6) "Tôi giao" (relation='assigned') — không hề bị đụng tới bởi fix này.
  // =========================================================================
  {
    const window = newWindow();
    const t = window.__PHF_TASK_TEST__;
    const capture = {};
    mockListTasksResponse(window, { viewScopeType: 'self', requesterActorType: 'nhan_vien' }, capture);
    const root = window.document.getElementById('phfTaskRoot');
    await t.openTaskList(root, 'assigned');
    pass(capture.lastRequest.relation === 'assigned', '"Tôi giao": relation=assigned không bị fix động tới');
  }

  // =========================================================================
  // 7) loadMoreTaskList (phân trang "Xem thêm") cho relation='managed' cũng
  //    phải dịch đúng, không chỉ trang đầu.
  // =========================================================================
  {
    const window = newWindow();
    const t = window.__PHF_TASK_TEST__;
    const capture = {};
    mockListTasksResponse(window, { viewScopeType: 'employees', requesterActorType: 'truong_bo_phan', tasks: [{ id: '1' }], hasMore: true }, capture);
    const root = window.document.getElementById('phfTaskRoot');
    await t.openTaskList(root, 'managed');
    mockListTasksResponse(window, { viewScopeType: 'employees', requesterActorType: 'truong_bo_phan', tasks: [{ id: '2' }], hasMore: false }, capture);
    await t.loadMoreTaskList(root);
    pass(capture.lastRequest.relation === 'received', 'loadMoreTaskList: relation dịch đúng thành received');
    pass(capture.lastRequest.scope === 'managed', 'loadMoreTaskList: scope=managed');
  }

  console.log(`PHF Task Managed Scope P0 Fix V1 test: ${passed}/${passed} PASS`);
})().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
