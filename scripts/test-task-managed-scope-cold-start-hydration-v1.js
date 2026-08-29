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
function mockListTasksResponse(window, resultOverrides, captureBox) {
  window.fetch = function (url, options) {
    const body = JSON.parse(options.body);
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
    captureBox.calls = (captureBox.calls || 0) + 1;
    return Promise.reject(new Error('network down'));
  };
}

(async () => {
  // =========================================================================
  // 1) COLD START trên Trang chủ (dashboard) cho TBP thật: hard refresh
  //    thẳng vào dashboard (KHÔNG gọi openTaskList/vào sub-view nào) vẫn phải
  //    hydrate hasManagedScope=true và render menu "Nhân sự tôi quản lý"
  //    ngay, không cần navigation side-effect.
  // =========================================================================
  {
    const window = newWindow();
    const t = window.__PHF_TASK_TEST__;
    const capture = {};
    mockListTasksResponse(window, { viewScopeType: 'employees', requesterActorType: 'truong_bo_phan', hasManagedPeople: true }, capture);
    pass(t.getState().hasManagedScope === false, 'trước khi render: hasManagedScope vẫn false (fail-closed mặc định)');
    pass(t.getState().view === 'dashboard', 'state mặc định là dashboard trước khi render lần đầu');

    await window.phfRenderTask(t.taskHomePath());
    pass(t.getState().view === 'dashboard', 'cold start route resolves to dashboard, không tự chuyển view');
    // hydrateManagedScopeIfNeeded() được fire-and-forget từ phfRenderTask —
    // đợi đúng promise đó (không phải applyTaskRoute) để chắc chắn hydrate
    // xong trước khi assert, mô phỏng đúng thời điểm nó thật sự resolve.
    await t.hydrateManagedScopeIfNeeded(window.document.getElementById('phfTaskRoot'));
    pass(t.getState().hasManagedScope === true, 'COLD START dashboard: TBP -> hasManagedScope=true KHÔNG cần vào sub-view');
    pass(t.getState().managedScopeHydrated === true, 'managedScopeHydrated=true sau cold start hydrate');
    pass(t.taskManagerScopeAvailable() === true, 'taskManagerScopeAvailable() true ngay cold start');

    const root = window.document.getElementById('phfTaskRoot');
    window.__PHF_TASK_TEST__.getState(); // no-op, state already rendered by hydrate's own renderTaskRoot()
    pass(root.innerHTML.indexOf('Nhân sự tôi quản lý') !== -1, 'sidebar HTML thật sự chứa "Nhân sự tôi quản lý" ngay cold start (không cần click)');

    pass(capture.calls === 1, 'chỉ 1 request listTasks() probe cho cold-start hydrate (không duplicate)');
    pass(capture.lastRequest.relation === 'received' && capture.lastRequest.scope === 'managed', 'probe request đúng canonical contract relation=received, scope=managed');
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
    pass(capture.calls === 1, 'lần đầu cold start: đúng 1 request');

    // Revisit dashboard nhiều lần + mở Lịch/Timeline (không phải list) —
    // không được bắn thêm request probe nào nữa.
    await window.phfRenderTask(t.taskHomePath());
    await window.phfRenderTask(t.taskHomePath());
    pass(capture.calls === 1, 'revisit dashboard nhiều lần sau khi đã hydrate -> KHÔNG gọi thêm request nào (không loop)');
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
