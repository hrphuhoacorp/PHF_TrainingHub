'use strict';

/*
 * PHF Task — "Nhân sự tôi quản lý" COLD-START HYDRATION FIX V1.
 *
 * Bug: taskUiState.hasManagedScope was hydrated ONLY as a side-effect of
 * loadTaskList() (assets/js/task/phf-task-app.js ~line 815). Trang chủ
 * (dashboard) — and Lịch/Timeline/Báo cáo when opened first — never call
 * loadTaskList(), so a real TBP/Trưởng ca hard-refreshing straight into
 * Trang chủ saw the sidebar render with hasManagedScope still at its initial
 * false, and "Nhân sự tôi quản lý" only appeared after manually clicking
 * into a sub-view like "Tôi nhận" that happens to call loadTaskList().
 *
 * Fix: hydrateManagedScopeIfNeeded() fires a single canonical listTasks()
 * probe (relation='received', scope='managed', limit=1 — same wire contract
 * as loadTaskList()'s existing 'managed' translation) from
 * window.phfRenderTask() on every route entry, guarded so it only ever
 * fires once per session (managedScopeHydrated + in-flight promise dedupe).
 *
 * jsdom, no network, no real DB — same harness pattern as
 * scripts/test-task-managed-scope-p0-fix-v1.js.
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
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/ql/task' });
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

// TỔNG QUAN V2 (2026-08-29) — cold-start dashboard route now ALSO fires
// getTaskOverviewV2 (real PostgreSQL-backed KPI data, LOCKED business
// requirement) alongside the pre-existing hasManagedScope hydrate probe
// (listTasks). This mock branches by body.action so capture.calls keeps
// measuring EXACTLY what this file's assertions are about — the listTasks
// hydrate-probe dedup contract — while the new Overview call is served a
// valid (empty) response and counted separately (capture.overviewCalls),
// never asserted on here (Overview's own request/response contract is
// covered by scripts/test-task-overview-v2-foundation.js against real data).
function mockOverviewV2Response() {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ ok: true, result: {
      report_contract_version: 1,
      period: { type: 'month', start: '', endExclusive: '' },
      effective_scope: 'self',
      metrics: { open: { value: 0 }, overdue: { value: 0 }, due_soon: { value: 0 }, completed_in_period: { value: 0 }, on_time_rate: { value: null }, attention_needed: { value: null } },
      status_breakdown: { not_started: 0, in_progress: 0, overdue: 0, completed: 0, cancelled: 0 },
      top_overdue: [], top_due_soon: [],
    } }),
  });
}
function mockTrendV2Response() {
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: { report_contract_version: 1, period: { type: 'day_window', start: '', endExclusive: '' }, effective_scope: 'self', trend_supported: true, buckets: [] } }) });
}
function mockDepartmentV2Response() {
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: { report_contract_version: 1, period: { type: 'month', start: '', endExclusive: '' }, effective_scope: 'self', departments: [] } }) });
}
// PERF (2026-09-02) — the dashboard cold-start route now fires ONE
// getTaskReportV2Bundle call whose nav_signals block carries the SAME
// hasManagedPeople / canManageTaskPermissions the listTasks() probe returned,
// so the default landing screen no longer needs a separate probe. The probe
// still exists as the fallback for other routes and for a failed bundle.
function mockBundleV2Response(navOverrides, captureBox) {
  captureBox.bundleCalls = (captureBox.bundleCalls || 0) + 1;
  const nav = Object.assign({ hasManagedPeople: false, canManageTaskPermissions: false }, navOverrides || {});
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: {
    report_contract_version: 1,
    period: { type: 'month', start: '', endExclusive: '' },
    effective_scope: nav.hasManagedPeople ? 'managed' : 'self',
    nav_signals: nav,
    sections_included: ['overview', 'trend', 'department'],
    sections: {
      overview: {
        report_contract_version: 1, period: { type: 'month', start: '', endExclusive: '' }, effective_scope: nav.hasManagedPeople ? 'managed' : 'self',
        metrics: { open: { value: 0 }, overdue: { value: 0 }, due_soon: { value: 0 }, completed_in_period: { value: 0 }, on_time_rate: { value: null }, attention_needed: { value: 0, items: [] } },
        status_breakdown: { not_started: 0, in_progress: 0, overdue: 0, completed: 0, cancelled: 0 },
        top_overdue: [], top_due_soon: [], bottlenecks: { count: 0, items: [] },
      },
      trend: { report_contract_version: 1, period: { type: 'month' }, effective_scope: 'self', trend_supported: true, buckets: [] },
      department: { report_contract_version: 1, period: { type: 'month' }, effective_scope: 'self', departments: [] },
    },
  } }) });
}
function mockListTasksResponse(window, resultOverrides, captureBox) {
  const ov = resultOverrides || {};
  window.fetch = function (url, options) {
    const body = JSON.parse(options.body);
    if (body.action === 'getTaskReportV2Bundle') {
      return mockBundleV2Response({
        hasManagedPeople: ov.hasManagedPeople === true,
        canManageTaskPermissions: ov.canManageTaskPermissions === true,
      }, captureBox);
    }
    if (body.action === 'getTaskOverviewV2') {
      captureBox.overviewCalls = (captureBox.overviewCalls || 0) + 1;
      return mockOverviewV2Response();
    }
    // UI POLISH (2026-08-29) — Tổng quan cold-start ALSO fires
    // getTaskReportV2Trend(window_days=30)/getTaskReportV2DepartmentAnalysis
    // (chart data, reused canonical V2 actions) — served valid empty
    // responses, counted separately, never asserted on here.
    if (body.action === 'getTaskReportV2Trend') {
      captureBox.trendCalls = (captureBox.trendCalls || 0) + 1;
      return mockTrendV2Response();
    }
    if (body.action === 'getTaskReportV2DepartmentAnalysis') {
      captureBox.departmentCalls = (captureBox.departmentCalls || 0) + 1;
      return mockDepartmentV2Response();
    }
    // NOTIFICATION BELL V1 (2026-09-01) — renderTaskRoot() also fires the
    // topbar notification list once per render; served an empty response and
    // counted separately, never part of the listTasks hydrate-probe assertions.
    if (body.action === 'listMyTaskNotifications') {
      captureBox.notifCalls = (captureBox.notifCalls || 0) + 1;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: { notifications: [], unreadCount: 0 } }) });
    }
    captureBox.calls = (captureBox.calls || 0) + 1;
    captureBox.lastRequest = body;
    return Promise.resolve({
      ok: true,
      // hasManagedPeople defaults to false (fail-closed) — G3 FOLLOW-UP fix
      // (2026-08-28): frontend hydrates hasManagedScope from THIS explicit
      // field now, not from viewScopeType/requesterActorType heuristics.
      json: () => Promise.resolve({ ok: true, result: Object.assign({ tasks: [], hasMore: false, viewScopeType: 'self', requesterActorType: 'nhan_vien', hasManagedPeople: false }, resultOverrides) }),
    });
  };
}

function mockListTasksError(window, captureBox) {
  window.fetch = function (url, options) {
    const body = JSON.parse(options.body);
    if (body.action === 'getTaskReportV2Bundle') {
      captureBox.bundleCalls = (captureBox.bundleCalls || 0) + 1;
      return Promise.reject(new Error('network down'));
    }
    if (body.action === 'getTaskOverviewV2') {
      captureBox.overviewCalls = (captureBox.overviewCalls || 0) + 1;
      return mockOverviewV2Response();
    }
    if (body.action === 'getTaskReportV2Trend') {
      captureBox.trendCalls = (captureBox.trendCalls || 0) + 1;
      return mockTrendV2Response();
    }
    if (body.action === 'getTaskReportV2DepartmentAnalysis') {
      captureBox.departmentCalls = (captureBox.departmentCalls || 0) + 1;
      return mockDepartmentV2Response();
    }
    // NOTIFICATION BELL V1 (2026-09-01) — renderTaskRoot() also fires the
    // topbar notification list once per render; served an empty response and
    // counted separately, never part of the listTasks hydrate-probe assertions.
    if (body.action === 'listMyTaskNotifications') {
      captureBox.notifCalls = (captureBox.notifCalls || 0) + 1;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: { notifications: [], unreadCount: 0 } }) });
    }
    captureBox.calls = (captureBox.calls || 0) + 1;
    return Promise.reject(new Error('network down'));
  };
}

(async () => {
  // =========================================================================
  // 1) COLD START trên Trang chủ (dashboard) cho TBP thật: hard refresh
  //    thẳng vào dashboard vẫn phải hydrate hasManagedScope=true và render
  //    menu "Nhân sự tôi quản lý" ngay. PERF (2026-09-02): dashboard route
  //    hydrate từ nav_signals của getTaskReportV2Bundle — KHÔNG còn 1 request
  //    listTasks() probe riêng.
  // =========================================================================
  {
    const window = newWindow();
    const t = window.__PHF_TASK_TEST__;
    const capture = {};
    mockListTasksResponse(window, { viewScopeType: 'employees', requesterActorType: 'truong_bo_phan', hasManagedPeople: true, canManageTaskPermissions: true }, capture);
    pass(t.getState().hasManagedScope === false, 'trước khi render: hasManagedScope vẫn false (fail-closed mặc định)');
    pass(t.getState().view === 'dashboard', 'state mặc định là dashboard trước khi render lần đầu');

    await window.phfRenderTask(t.taskHomePath());
    pass(t.getState().view === 'dashboard', 'cold start route resolves to dashboard, không tự chuyển view');
    pass(t.getState().hasManagedScope === true, 'COLD START dashboard: TBP -> hasManagedScope=true (từ nav_signals của bundle)');
    pass(t.getState().managedScopeHydrated === true, 'managedScopeHydrated=true sau cold start hydrate');
    pass(t.getState().canManageTaskPermissions === true, 'canManageTaskPermissions cũng hydrate từ cùng nav_signals');
    pass(t.taskManagerScopeAvailable() === true, 'taskManagerScopeAvailable() true ngay cold start');

    const root = window.document.getElementById('phfTaskRoot');
    pass(root.innerHTML.indexOf('Nhân sự tôi quản lý') !== -1, 'sidebar HTML thật sự chứa "Nhân sự tôi quản lý" ngay cold start (không cần click)');

    pass(capture.bundleCalls === 1, 'cold start dashboard: đúng 1 request getTaskReportV2Bundle');
    pass((capture.calls || 0) === 0, 'KHÔNG còn 1 request listTasks() probe riêng trên route dashboard (nav_signals đã có sẵn trong bundle)');
  }

  // =========================================================================
  // 2) Nhân viên thường (self scope) cold start trên dashboard -> menu vẫn
  //    KHÔNG xuất hiện (fail-closed đúng theo business rule).
  // =========================================================================
  {
    const window = newWindow();
    window.phfGetSessionRole = function () { return 'learner'; };
    const t = window.__PHF_TASK_TEST__;
    const capture = {};
    mockListTasksResponse(window, { viewScopeType: 'self', requesterActorType: 'nhan_vien' }, capture);
    await window.phfRenderTask(t.taskHomePath());
    await t.hydrateManagedScopeIfNeeded(window.document.getElementById('phfTaskRoot'));
    pass(t.getState().hasManagedScope === false, 'nhân viên thường cold start -> hasManagedScope vẫn false');
    pass(t.getState().managedScopeHydrated === true, 'nhân viên thường: managedScopeHydrated=true từ nav_signals của bundle');
    pass((capture.calls || 0) === 0, 'nhân viên thường: KHÔNG có request listTasks() probe riêng');
    const root = window.document.getElementById('phfTaskRoot');
    pass(root.innerHTML.indexOf('Nhân sự tôi quản lý') === -1, 'nhân viên thường: sidebar KHÔNG chứa "Nhân sự tôi quản lý"');
  }

  // =========================================================================
  // 3) API error trong lúc hydrate cold start -> fail-closed (hasManagedScope
  //    false), không throw ra ngoài (không phá route render), không suy đoán
  //    quyền từ title/role.
  // =========================================================================
  {
    const window = newWindow();
    const t = window.__PHF_TASK_TEST__;
    const capture = {};
    mockListTasksError(window, capture);
    await window.phfRenderTask(t.taskHomePath());
    await t.hydrateManagedScopeIfNeeded(window.document.getElementById('phfTaskRoot'));
    pass(t.getState().hasManagedScope === false, 'API error khi hydrate -> fail-closed, hasManagedScope=false');
    pass(t.getState().managedScopeHydrated === true, 'managedScopeHydrated vẫn đánh dấu true sau lỗi (không retry-loop mỗi render)');
    pass(t.getState().view === 'dashboard', 'lỗi hydrate không phá route render — vẫn ở dashboard bình thường');
  }

  // =========================================================================
  // 4) Không duplicate-request / render-loop: nhiều lần renderTask (revisit
  //    dashboard, chuyển route khác) sau khi đã hydrate xong CHỈ gọi API 1
  //    lần duy nhất cho toàn phiên.
  // =========================================================================
  {
    const window = newWindow();
    const t = window.__PHF_TASK_TEST__;
    const capture = {};
    mockListTasksResponse(window, { viewScopeType: 'employees', requesterActorType: 'truong_ca', hasManagedPeople: true }, capture);
    await window.phfRenderTask(t.taskHomePath());
    await t.hydrateManagedScopeIfNeeded(window.document.getElementById('phfTaskRoot'));
    pass(capture.bundleCalls === 1 && (capture.calls || 0) === 0, 'lần đầu cold start: đúng 1 request bundle, 0 probe riêng');

    // Revisit dashboard nhiều lần — không được bắn thêm request nào nữa
    // (overview.data đã có -> applyTaskRoute early-return).
    await window.phfRenderTask(t.taskHomePath());
    await window.phfRenderTask(t.taskHomePath());
    pass(capture.bundleCalls === 1 && (capture.calls || 0) === 0, 'revisit dashboard nhiều lần sau khi đã hydrate -> KHÔNG gọi thêm request nào (không loop)');
    pass(t.getState().hasManagedScope === true, 'Trưởng ca vẫn giữ đúng hasManagedScope=true sau các lần revisit');
  }

  // =========================================================================
  // 5) Không phá hỏng đường dẫn hydrate sẵn có qua loadTaskList() ("Tôi
  //    nhận") — vẫn hoạt động y hệt trước, và không bắn thêm request probe
  //    thừa vì managedScopeHydrated đã được loadTaskList() tự đánh dấu.
  // =========================================================================
  {
    const window = newWindow();
    const t = window.__PHF_TASK_TEST__;
    const capture = {};
    mockListTasksResponse(window, { viewScopeType: 'employees', requesterActorType: 'truong_bo_phan', hasManagedPeople: true }, capture);
    const root = window.document.getElementById('phfTaskRoot');
    await t.openTaskList(root, 'received');
    pass(t.getState().hasManagedScope === true, 'existing loadTaskList()->"Tôi nhận" hydration path vẫn hoạt động y hệt trước');
    pass(t.getState().managedScopeHydrated === true, 'loadTaskList() tự đánh dấu managedScopeHydrated=true');
    const requestsAfterList = capture.calls;
    await window.phfRenderTask(t.taskHomePath());
    pass(capture.calls === requestsAfterList, 'sau khi đã hydrate qua "Tôi nhận", revisit dashboard KHÔNG bắn thêm probe request');
  }

  console.log(`PHF Task Managed Scope Cold-Start Hydration V1 test: ${passed}/${passed} PASS`);
})().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
