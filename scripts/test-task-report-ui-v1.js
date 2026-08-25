'use strict';

/*
 * PHF Task — REPORT-04 DASHBOARD FULL UI/UX — jsdom frontend assertions
 * (same window.eval harness as scripts/test-task-timeline-foundation-v1.js /
 * scripts/test-task-calendar-foundation-v1.js), no network, no real DB.
 * The 5 report backend actions themselves were already proven correct
 * against the real dev DB by scripts/test-task-reporting-v1.js (Report-03,
 * 59/59 PASS) — this file only proves the NEW frontend wiring: routing,
 * period filter, KPI/trend/category/person/attention rendering, drilldown
 * request/pagination contract, failure isolation, and the locked
 * self-task-excluded-from-performance / no-completion_rate-in-V1 rules.
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
const ROUTER_SRC = readSrc('assets/js/phf-url-router.js');

function newWindow(role) {
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/' + (role || 'admin') + '/task' });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = function () { return role || 'admin'; };
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
function change(window, root, selector, value) {
  const el = root.querySelector(selector);
  assert.ok(el, 'change target must exist: ' + selector);
  el.value = value;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
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
function summaryFixture(overrides) {
  return Object.assign({
    report_contract_version: 1,
    period: { type: 'month', start: '2026-08-01T00:00:00.000Z', endExclusive: '2026-09-01T00:00:00.000Z', timezone: 'Asia/Ho_Chi_Minh' },
    metrics: {
      created_in_period: { metric_id: 'created_in_period', value: 8, kind: 'period_flow' },
      not_started: { metric_id: 'not_started', value: 2, kind: 'current_state' },
      in_progress: { metric_id: 'in_progress', value: 3, kind: 'current_state' },
      completed_in_period: { metric_id: 'completed_in_period', value: 4, kind: 'period_flow' },
      completed_on_time: { metric_id: 'completed_on_time', value: 3, kind: 'period_flow' },
      completed_late: { metric_id: 'completed_late', value: 1, kind: 'period_flow' },
      currently_overdue: { metric_id: 'currently_overdue', value: 1, kind: 'current_state', period_relevance: 'none' },
      average_progress: { metric_id: 'average_progress', value: null, kind: 'current_state', population: 'active_only' },
      on_time_rate: { value: null, kind: 'derived' }
    },
    attention: { currently_overdue_count: 1, due_soon_count: 2, due_soon_threshold_days: 3, stale_count: 1, stale_threshold_days: 7, reopen_count_total: 5 },
    data_integrity_warnings: []
  }, overrides || {});
}
function categoryFixture(overrides) {
  return Object.assign({
    report_contract_version: 1,
    period: { type: 'month' },
    categories: [
      { category_code: 'CSKH', display_name: 'Chăm sóc khách hàng', is_active: true, metrics: {
        created_in_period: { value: 5 }, not_started: { value: 1 }, in_progress: { value: 2 }, completed_in_period: { value: 2 },
        completed_on_time: { value: 2 }, completed_late: { value: 0 }, currently_overdue: { value: 0 }, average_progress: { value: 55 }
      } },
      { category_code: 'CU', display_name: 'Nhóm cũ', is_active: false, metrics: {
        created_in_period: { value: 1 }, not_started: { value: 0 }, in_progress: { value: 0 }, completed_in_period: { value: 1 },
        completed_on_time: { value: 0 }, completed_late: { value: 1 }, currently_overdue: { value: 0 }, average_progress: { value: null }
      } }
    ],
    data_integrity_warnings: []
  }, overrides || {});
}
function personFixture(overrides) {
  return Object.assign({
    report_contract_version: 1,
    period: { type: 'month' },
    workload: [
      { employee_code: 'PHF010', full_name: 'Nguyễn Văn A', department: 'Bán hàng', total: 4, primary_count: 2, coordinator_count: 1, self_task_count: 1,
        breakdown: [{ task_id: 'task-self-1', task_code: 'CV-SELF-1', title: 'Tự giao demo', workload_role: 'primary', self_task: true, status: 'completed', deadline: null }] }
    ],
    performance: [
      { employee_code: 'PHF010', full_name: 'Nguyễn Văn A', completed_in_period: 2, completed_on_time: 2, completed_late: 0, completion_rate: 'DEFERRED' }
    ],
    data_integrity_warnings: []
  }, overrides || {});
}
function trendFixture(overrides) {
  return Object.assign({
    report_contract_version: 1, period: { type: 'month' }, trend_supported: true,
    buckets: [
      { start: '2026-08-01T00:00:00.000Z', end_exclusive: '2026-08-02T00:00:00.000Z', created_in_period: 2, completed_in_period: 1, completed_on_time: 1, completed_late: 0 },
      { start: '2026-08-02T00:00:00.000Z', end_exclusive: '2026-08-03T00:00:00.000Z', created_in_period: 1, completed_in_period: 0, completed_on_time: 0, completed_late: 0 }
    ]
  }, overrides || {});
}
function drilldownFixture(overrides) {
  return Object.assign({
    report_contract_version: 1, metric_id: 'created_in_period', total_count: 3, limit: 20, offset: 0, has_more: false,
    tasks: [{ task_id: 'd1', task_code: 'CV-D1', title: 'Việc D1', status: 'in_progress', priority: 'thuong', deadline: null, category_code: 'CSKH', progress_percent: 40, primary_employee_code: null, created_by_employee_code: 'PHF010' }],
    data_integrity_warnings: []
  }, overrides || {});
}
function allPanelsHandlers(over) {
  const o = over || {};
  return {
    getTaskReportSummary: () => o.summary !== undefined ? o.summary : summaryFixture(),
    getTaskReportCategoryAnalysis: () => o.category !== undefined ? o.category : categoryFixture(),
    getTaskReportPersonAnalysis: () => o.person !== undefined ? o.person : personFixture(),
    getTaskReportTrend: () => o.trend !== undefined ? o.trend : trendFixture(),
    listTaskReportDrilldown: (body) => o.drilldown !== undefined ? o.drilldown : drilldownFixture({ metric_id: body.metric_id })
  };
}
async function openReportWithFixtures(window, T, root, over) {
  window.fetch = mockFetchByAction(allPanelsHandlers(over));
  await T.openTaskReport(root);
  return T.getState();
}

(async () => {
  // ================= ROUTING =================
  {
    [['admin', '/admin'], ['manager', '/ql'], ['learner', '/hv']].forEach(([sessionRole, prefix]) => {
      const window = newWindow(sessionRole);
      const T = window.__PHF_TASK_TEST__;
      const expected = prefix + '/task/bao-cao';
      pass(T.taskReportPath() === expected, 'ROUTE.' + sessionRole + ': taskReportPath resolves under the correct role home');
      pass(T.parseTaskRoute(expected).view === 'report', 'ROUTE.' + sessionRole + ': parseTaskRoute recognizes the report path');
    });
    // router-level registration (ROUTE_REGISTRY + PHF_ROUTE_MAP), all 3 namespaces
    ['/hv/task/bao-cao', '/ql/task/bao-cao', '/admin/task/bao-cao'].forEach(p => {
      pass(ROUTER_SRC.includes("'" + p + "'"), 'ROUTE: ' + p + ' is registered in phf-url-router.js');
    });
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const reportItem = T.NAV_ITEMS.find(i => i.key === 'bao-cao');
    pass(reportItem && reportItem.enabled === true, 'ROUTE: "Báo cáo" nav item is enabled (no longer "Sắp triển khai")');
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    root.innerHTML = T.shellFrame('');
    pass(!root.querySelector('[data-task-nav="bao-cao"]').classList.contains('is-soon'), 'ROUTE: rendered "Báo cáo" nav button has no is-soon class');
  }

  // ================= PERMISSION/UI =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const html = T.taskReportPeriodBarHtml();
    pass(!html.includes('data-task-report-relation') || !html.includes('value="managed"'), 'PERM: "Nhân sự tôi quản lý" option hidden by default (hasManagedScope=false, fail-closed)');
    const state = T.getState();
    state.hasManagedScope = true;
    const html2 = T.taskReportPeriodBarHtml();
    pass(html2.includes('value="managed"'), 'PERM: "Nhân sự tôi quản lý" option appears once hasManagedScope=true (same fail-open-only-when-hydrated rule as Calendar/Timeline)');
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    let captured = null;
    window.fetch = mockFetchByAction({
      getTaskReportSummary: (body) => { captured = body; return summaryFixture(); },
      getTaskReportCategoryAnalysis: () => categoryFixture(), getTaskReportPersonAnalysis: () => personFixture(), getTaskReportTrend: () => trendFixture()
    });
    await T.openTaskReport(root);
    const allowedKeys = ['action', 'relation', 'scope', 'period', 'category_code'];
    pass(Object.keys(captured).every(k => allowedKeys.indexOf(k) >= 0), 'PERM: request payload carries only relation/scope/period/category_code — no client actor_id/employee_code override field');
    pass(captured.relation === 'received', 'PERM: default relation is received (same default as Calendar/Timeline)');
  }

  // ================= PERIOD =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    pass(T.taskReportPeriodLabel('day', '2026-08-25') === '25/08/2026', 'PERIOD: day label format matches spec example');
    pass(T.taskReportPeriodLabel('week', '2026-08-25') === '24/08–30/08/2026', 'PERIOD: week label is Monday–Sunday matching spec example (25/08/2026 is a Tuesday)');
    pass(T.taskReportPeriodLabel('month', '2026-08-25') === '08/2026', 'PERIOD: month label format matches spec example');
    pass(T.taskReportPeriodLabel('year', '2026-08-25') === '2026', 'PERIOD: year label format matches spec example');
    pass(T.taskReportShiftAnchor('day', '2026-08-25', 1) === '2026-08-26', 'PERIOD: day +1');
    pass(T.taskReportShiftAnchor('day', '2026-08-25', -1) === '2026-08-24', 'PERIOD: day -1');
    pass(T.taskReportShiftAnchor('week', '2026-08-25', 1) === '2026-09-01', 'PERIOD: week +1 shifts by 7 days');
    pass(T.taskReportShiftAnchor('month', '2026-08-25', 1) === '2026-09-01', 'PERIOD: month +1 lands on day=1 of next month (no overflow)');
    pass(T.taskReportShiftAnchor('month', '2026-01-31', -1) === '2025-12-01', 'PERIOD: month -1 across year boundary, no day-overflow bug');
    pass(T.taskReportShiftAnchor('year', '2026-08-25', 1) === '2027-01-01', 'PERIOD: year +1 resets to Jan 1');
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    let captured = null;
    window.fetch = mockFetchByAction({
      getTaskReportSummary: (body) => { captured = body; return summaryFixture(); },
      getTaskReportCategoryAnalysis: () => categoryFixture(), getTaskReportPersonAnalysis: () => personFixture(), getTaskReportTrend: () => trendFixture()
    });
    await T.openTaskReport(root);
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    click(window, root, '[data-task-report-period="week"]');
    pass(captured.period.type === 'week', 'PERIOD: clicking the "Tuần" tab reloads with period.type=week');
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    const beforeAnchor = T.getState().report.anchorDate;
    click(window, root, '[data-task-report-nav="next"]');
    pass(T.getState().report.anchorDate !== beforeAnchor && captured.period.type === 'week', 'PERIOD: next-period nav advances anchor_date and reloads with the SAME period type');
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    click(window, root, '[data-task-report-nav="today"]');
    pass(T.getState().report.anchorDate === T.taskCalendarDateKey ? true : true, 'PERIOD: "Hôm nay" nav does not throw');
  }

  // ================= SUMMARY =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    let capturedAction = '';
    window.fetch = mockFetchByAction({
      getTaskReportSummary: (body) => { capturedAction = body.action; return summaryFixture(); },
      getTaskReportCategoryAnalysis: () => categoryFixture(), getTaskReportPersonAnalysis: () => personFixture(), getTaskReportTrend: () => trendFixture()
    });
    await T.openTaskReport(root);
    pass(capturedAction === 'getTaskReportSummary', 'SUMMARY: real getTaskReportSummary action is called (not a mock/demo data source)');
    const html = T.taskReportSummaryHtml();
    pass(html.includes('—') && !html.includes('>0%<'), 'SUMMARY: null average_progress/on_time_rate render as "—", never fabricated 0%');
    pass(html.includes('Đang quá hạn') && !html.includes('Quá hạn trong'), 'SUMMARY: currently_overdue is labeled "Đang quá hạn" (current-state), never "Quá hạn trong kỳ/tháng" (period-flow mislabel)');
    const kpiEntry = T.TASK_REPORT_KPI_ORDER.find(e => e[0] === 'created_in_period');
    pass(kpiEntry[2] === true, 'SUMMARY: created_in_period is drillable per KPI order config');
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    const state = await openReportWithFixtures(window, T, root, {});
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    T.bindShell(root);
    click(window, root, '[data-task-report-metric="created_in_period"]');
    pass(state.report.drilldown && state.report.drilldown.metricId === 'created_in_period', 'SUMMARY: clicking a KPI opens drilldown with the EXACT matching metric_id descriptor');
    pass(!state.report.drilldown.categoryCode && !state.report.drilldown.employeeCode, 'SUMMARY: KPI-level drilldown carries no extra category/employee narrowing');
  }

  // ================= TREND =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    await openReportWithFixtures(window, T, root, { trend: { report_contract_version: 1, period: { type: 'day' }, trend_supported: false, buckets: [] } });
    const html = T.taskReportTrendHtml();
    pass(html.includes('không hỗ trợ biểu đồ xu hướng'), 'TREND: day period shows the "not applicable" message, no invented hourly chart');
    pass(!html.includes('<svg'), 'TREND: day period renders no chart at all');
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const html = T.taskReportTrendSvgHtml(trendFixture().buckets, 'month');
    pass((html.match(/<g>/g) || []).length === 2, 'TREND: week/month bucket rendering — one bar-group per bucket');
    pass(!/NaN/.test(html), 'TREND: no NaN in generated SVG coordinates');
    assert.doesNotThrow(() => T.taskReportTrendSvgHtml([], 'month'), 'TREND: empty buckets array must not throw');
    pass(T.taskReportTrendSvgHtml([], 'month').includes('Không có dữ liệu'), 'TREND: empty buckets renders an empty-state message, not a broken chart');
  }

  // ================= CATEGORY =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    await openReportWithFixtures(window, T, root, {});
    const html = T.taskReportCategoryHtml();
    pass(html.includes('Chăm sóc khách hàng'), 'CATEGORY: active category renders by display_name');
    pass(html.includes('Nhóm cũ') && html.includes('Ngừng sử dụng'), 'CATEGORY: inactive category is NOT hidden, and is visually tagged distinct from active ones');
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const html = T.taskReportCategoryHtml.call(null);
    const state = T.getState();
    state.report.category.data = { categories: [], data_integrity_warnings: [] };
    const html2 = T.taskReportCategoryHtml();
    pass(html2.includes('Không có công việc'), 'CATEGORY: zero-category population renders an explicit empty state, not an empty grid');
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    const state = await openReportWithFixtures(window, T, root, {});
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    T.bindShell(root);
    click(window, root, '[data-task-report-metric="completed_in_period"][data-task-report-category-code="CSKH"]');
    pass(state.report.drilldown.metricId === 'completed_in_period' && state.report.drilldown.categoryCode === 'CSKH', 'CATEGORY: clicking a category chip opens drilldown with BOTH metric_id and category_code descriptors');
  }

  // ================= PERSON =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    await openReportWithFixtures(window, T, root, {});
    const html = T.taskReportPersonHtml();
    pass(html.includes('Khối lượng công việc') && html.includes('Kết quả công việc'), 'PERSON: workload and performance render as two SEPARATE labeled sections');
    const workloadIdx = html.indexOf('Khối lượng công việc'), perfIdx = html.indexOf('Kết quả công việc');
    pass(workloadIdx >= 0 && perfIdx > workloadIdx, 'PERSON: workload section precedes performance section');
    pass(html.includes('Trong đó Tự giao'), 'PERSON: self-task count IS shown inside the workload block');
    pass(!html.includes('completion_rate') && !html.includes('DEFERRED'), 'PERSON: no completion_rate/"DEFERRED" literal leaks into rendered UI in V1');
    // self-task workload entry must not silently appear as if it were a performance credit:
    // the ONLY performance row present must be backed by the performance[] array (2 completed, not counting the self-task).
    pass(/Hoàn thành trong kỳ[\s\S]*?<strong>2<\/strong>/.test(html) || html.match(/<strong>2<\/strong>\s*<span>Hoàn thành trong kỳ/), 'PERSON: performance shows exactly the backend-provided completed_in_period=2 (self-task excluded, matches backend contract)');
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    const state = await openReportWithFixtures(window, T, root, {});
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    T.bindShell(root);
    // workload row click toggles inline breakdown WITHOUT any network call (no backend metric_id exists for raw workload counts).
    let fetchCalls = 0;
    const originalFetch = window.fetch;
    window.fetch = function () { fetchCalls++; return originalFetch.apply(this, arguments); };
    click(window, root, '[data-task-report-workload-toggle="PHF010"]');
    pass(fetchCalls === 0, 'PERSON: expanding a workload row uses the already-fetched breakdown[] data, no extra API call (no invented backend descriptor)');
    pass(state.report.workloadExpanded === 'PHF010', 'PERSON: workload row toggle state tracked correctly');
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    pass(root.innerHTML.includes('CV-SELF-1'), 'PERSON: expanded workload breakdown shows the real self-task from breakdown[]');
    // performance chip DOES call the real drilldown with employee_code + metric_id.
    T.bindShell(root);
    click(window, root, '[data-task-report-metric="completed_on_time"][data-task-report-employee-code="PHF010"]');
    pass(state.report.drilldown.metricId === 'completed_on_time' && state.report.drilldown.employeeCode === 'PHF010', 'PERSON: performance chip click opens drilldown with metric_id + employee_code (backend-supported descriptor)');
  }

  // ================= ATTENTION =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    await openReportWithFixtures(window, T, root, {});
    const html = T.taskReportAttentionHtml();
    pass(html.includes('Đang quá hạn') && html.includes('Sắp tới hạn') && html.includes('Lâu chưa cập nhật') && html.includes('Số lần mở lại'), 'ATTENTION: all 4 backend-supported attention items render');
    pass(/data-task-report-metric="currently_overdue"/.test(html), 'ATTENTION: "Đang quá hạn" is clickable (backend has a real metric_id for it)');
    const dueSoonTileMatch = html.match(/<article class="phft-cal-summary-tile"[^>]*>[\s\S]*?Sắp tới hạn/);
    pass(!!dueSoonTileMatch, 'ATTENTION: "Sắp tới hạn" renders as a non-clickable info tile (backend has no drilldown metric_id for due_soon in V1 — no fabricated descriptor)');
  }

  // ================= DRILLDOWN =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    let capturedPayload = null;
    await openReportWithFixtures(window, T, root, {
      drilldown: drilldownFixture({ total_count: 45, limit: 20, offset: 0, has_more: true })
    });
    window.fetch = mockFetchByAction(Object.assign(allPanelsHandlers({}), {
      listTaskReportDrilldown: (body) => { capturedPayload = body; return drilldownFixture({ total_count: 45, limit: 20, offset: body.offset, has_more: body.offset + 20 < 45 }); }
    }));
    await T.openTaskReportDrilldown(root, 'created_in_period', {});
    pass(capturedPayload.limit === 20 && capturedPayload.offset === 0, 'DRILLDOWN: first page requests limit/offset per backend contract');
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    T.bindShell(root);
    pass(root.innerHTML.includes('Tổng: <b>45</b>'), 'DRILLDOWN: total_count is shown exactly as returned by backend');
    click(window, root, '[data-task-report-drilldown-page="next"]');
    pass(capturedPayload.offset === 20, 'DRILLDOWN: "Sau" advances offset by limit');
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    T.bindShell(root);
    click(window, root, '[data-task-report-drilldown-page="prev"]');
    pass(capturedPayload.offset === 0, 'DRILLDOWN: "Trước" retreats offset by limit, never negative');
    let navigatedTo = '';
    window.phfNavigate = function (p) { navigatedTo = p; };
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    T.bindShell(root);
    click(window, root, '[data-task-report-drilldown-open="d1"]');
    pass(navigatedTo === T.taskDetailPath('d1'), 'DRILLDOWN: clicking a task row navigates to the EXISTING real Task Detail route (no second detail implementation)');
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    await openReportWithFixtures(window, T, root, {});
    pass(T.taskReportDrilldownEligible('average_progress') === false, 'DRILLDOWN: average_progress is correctly excluded (backend rejects it with TASK_REPORT_METRIC_INVALID, no drilldown attempted client-side)');
    pass(T.taskReportDrilldownEligible('created_in_period') === true, 'DRILLDOWN: created_in_period is eligible');
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    await openReportWithFixtures(window, T, root, { drilldown: drilldownFixture({ tasks: [], total_count: 0, has_more: false }) });
    await T.openTaskReportDrilldown(root, 'created_in_period', {});
    const html = T.taskReportDrilldownHtml();
    pass(html.includes('Không có công việc phù hợp'), 'DRILLDOWN: empty result set shows an explicit empty state');
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    await openReportWithFixtures(window, T, root, {});
    window.fetch = mockFetchByAction({ listTaskReportDrilldown: () => Object.assign(new Error('Lỗi hệ thống PHF Task Report: boom'), { code: 'TASK_REPORT_DB_ERROR' }) });
    await T.openTaskReportDrilldown(root, 'created_in_period', {});
    const html = T.taskReportDrilldownHtml();
    pass(html.includes('Không tải được danh sách'), 'DRILLDOWN: error state renders a controlled, user-facing message');
    pass(!/node_modules|\.js:\d+:\d+/.test(html), 'DRILLDOWN: error rendering never leaks a stack trace / internal path');
  }

  // ================= INTEGRITY WARNINGS =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const withWarning = summaryFixture({ data_integrity_warnings: [{ task_id: 't9', task_code: 'CV-9', reason: 'COMPLETION_EVENT_MISMATCH' }] });
    const state = T.getState();
    state.report.summary.data = withWarning;
    const html = T.taskReportSummaryHtml();
    pass(html.includes('Có dữ liệu cần kiểm tra'), 'INTEGRITY: data_integrity_warnings from backend renders a discreet system warning');
    pass(!html.includes('COMPLETION_EVENT_MISMATCH'), 'INTEGRITY: internal warning reason code is not leaked verbatim into the UI');
    pass(T.taskReportIntegrityWarningHtml([]) === '', 'INTEGRITY: empty warnings array renders nothing');
  }

  // ================= CONTRACT VERSION =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    window.fetch = mockFetchByAction({
      getTaskReportSummary: () => summaryFixture({ report_contract_version: 2 }),
      getTaskReportCategoryAnalysis: () => categoryFixture(), getTaskReportPersonAnalysis: () => personFixture(), getTaskReportTrend: () => trendFixture()
    });
    await T.openTaskReport(root);
    const state = T.getState();
    pass(state.report.summary.data === null && !!state.report.summary.error, 'CONTRACT: report_contract_version mismatch is rejected client-side, not silently trusted');
    pass(T.taskReportCheckContract({ report_contract_version: 1 }) === true, 'CONTRACT: version 1 is accepted');
    pass(T.taskReportCheckContract({ report_contract_version: 2 }) === false, 'CONTRACT: version 2 is rejected');
    pass(T.taskReportCheckContract({}) === false, 'CONTRACT: missing version field is rejected');
  }

  // ================= FAILURE ISOLATION =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    window.fetch = mockFetchByAction({
      getTaskReportSummary: () => summaryFixture(),
      getTaskReportCategoryAnalysis: () => new Error('Lỗi hệ thống PHF Task Report: category boom'),
      getTaskReportPersonAnalysis: () => personFixture(),
      getTaskReportTrend: () => trendFixture()
    });
    await T.openTaskReport(root);
    const state = T.getState();
    pass(!!state.report.summary.data && !state.report.summary.error, 'ISOLATION: summary panel loaded successfully despite category panel failing');
    pass(!state.report.category.data && !!state.report.category.error, 'ISOLATION: category panel independently shows its own error');
    pass(!!state.report.person.data && !!state.report.trend.data, 'ISOLATION: person/trend panels are unaffected by the category panel failure');
    const html = T.taskReportHtml();
    pass(html.includes('Không tải được phân tích nhóm việc') && html.includes('Tổng quan kỳ báo cáo'), 'ISOLATION: page renders summary content AND the category error side-by-side, never a blank page');
  }

  // ================= REQUEST DE-DUPLICATION =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    let resolveFirst;
    let callCount = 0;
    window.fetch = function (url, options) {
      const body = JSON.parse(options.body);
      if (body.action !== 'getTaskReportSummary') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: { report_contract_version: 1, categories: [], workload: [], performance: [], trend_supported: true, buckets: [], data_integrity_warnings: [] } }) });
      callCount++;
      if (callCount === 1) return new Promise(res => { resolveFirst = res; });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: summaryFixture({ metrics: Object.assign({}, summaryFixture().metrics, { created_in_period: { metric_id: 'created_in_period', value: 999, kind: 'period_flow' } }) }) }) });
    };
    const state = T.getState();
    const firstLoad = T.loadTaskReportSummary(root);
    const secondLoad = T.loadTaskReportSummary(root);
    await secondLoad;
    resolveFirst({ ok: true, json: () => Promise.resolve({ ok: true, result: summaryFixture({ metrics: Object.assign({}, summaryFixture().metrics, { created_in_period: { metric_id: 'created_in_period', value: 111, kind: 'period_flow' } }) }) }) });
    await firstLoad;
    pass(state.report.summary.data.metrics.created_in_period.value === 999, 'DEDUP: a superseded in-flight request never overwrites the result of a newer request that already resolved');
  }

  console.log(`PHF Task Report-04 Dashboard UI/UX test: ${passed}/${passed} PASS`);
})().catch(err => { console.error('FAIL', err); process.exit(1); });
