'use strict';

/*
 * PHF Task — Tổng quan & Báo cáo V2 (Gate V2-R2) — jsdom frontend assertions
 * (same window.eval harness as scripts/test-task-timeline-foundation-v1.js),
 * no network, no real DB. The 6 backend actions themselves are proven
 * correct against real PostgreSQL by scripts/test-task-overview-v2-
 * foundation.js + scripts/test-task-report-v2-foundation.js — this file only
 * proves the FRONTEND wiring: routing, period filter, KPI/trend/category/
 * person/department rendering, drilldown request/pagination contract,
 * failure isolation, and the contract-version guard.
 *
 * REWRITTEN 2026-08-29 (Gate V2-R2) — the OLD legacy report UI (Supabase-
 * backed, 9-KPI/sort/expand-row tables) this file used to test was REPLACED
 * wholesale by the PostgreSQL-native Reporting V2 UI (see
 * api/_lib/task-reporting-v2.js). This is not a parity port — new fixture
 * shapes, new action names, simplified tables (no sort/expand — see V2-R2
 * gate report for that explicit scope decision).
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
function overviewFixture(overrides) {
  return Object.assign({
    report_contract_version: 1,
    period: { type: 'month', start: '2026-08-01T00:00:00.000Z', endExclusive: '2026-09-01T00:00:00.000Z', timezone: 'Asia/Ho_Chi_Minh' },
    effective_scope: 'managed',
    metrics: {
      open: { metric_id: 'open', value: 6 },
      overdue: { metric_id: 'overdue', value: 1 },
      due_soon: { metric_id: 'due_soon', value: 2 },
      completed_in_period: { metric_id: 'completed_in_period', value: 4 },
      on_time_rate: { value: 75 },
      attention_needed: { value: null, needs_decision: true },
    },
    status_breakdown: { not_started: 2, in_progress: 3, overdue: 1, completed: 4, cancelled: 1 },
    top_overdue: [{ task_id: 'ov1', task_code: 'CV-OV1', title: 'Việc quá hạn', status: 'in_progress', deadline: '2026-08-10T00:00:00.000Z', primary_employee_code: 'PHF010', primary_full_name: 'Nguyễn Văn A', primary_department: 'Bán hàng', is_cross_department: false }],
    top_due_soon: [{ task_id: 'ds1', task_code: 'CV-DS1', title: 'Việc sắp tới hạn', status: 'published', deadline: '2026-08-27T00:00:00.000Z', primary_employee_code: 'PHF010', primary_full_name: 'Nguyễn Văn A', primary_department: 'Bán hàng', is_cross_department: false }],
  }, overrides || {});
}
function personFixture(overrides) {
  return Object.assign({
    report_contract_version: 1, period: { type: 'month' }, effective_scope: 'managed',
    people: [{ key: 'PHF010', employee_code: 'PHF010', full_name: 'Nguyễn Văn A', department: 'Bán hàng', workload: 4, open: 2, overdue: 0, due_soon: 1, completed_in_period: 2, completed_on_time: 2, completed_late: 0, on_time_rate: 100 }],
  }, overrides || {});
}
function departmentFixture(overrides) {
  return Object.assign({
    report_contract_version: 1, period: { type: 'month' }, effective_scope: 'managed',
    departments: [{ key: 'Bán hàng', department: 'Bán hàng', workload: 4, open: 2, overdue: 0, due_soon: 1, completed_in_period: 2, completed_on_time: 2, completed_late: 0, on_time_rate: 100 }],
  }, overrides || {});
}
function categoryFixture(overrides) {
  return Object.assign({
    report_contract_version: 1, period: { type: 'month' }, effective_scope: 'managed',
    categories: [{ key: 'CSKH', category_code: 'CSKH', display_name: 'Chăm sóc khách hàng', workload: 4, open: 2, overdue: 0, due_soon: 1, completed_in_period: 2, completed_on_time: 2, completed_late: 0, on_time_rate: 100 }],
  }, overrides || {});
}
function trendFixture(overrides) {
  return Object.assign({
    report_contract_version: 1, period: { type: 'month' }, effective_scope: 'managed', trend_supported: true,
    buckets: [
      { start: '2026-08-01T00:00:00.000Z', end_exclusive: '2026-08-02T00:00:00.000Z', created_in_period: 2, completed_in_period: 1, completed_on_time: 1, completed_late: 0 },
      { start: '2026-08-02T00:00:00.000Z', end_exclusive: '2026-08-03T00:00:00.000Z', created_in_period: 1, completed_in_period: 0, completed_on_time: 0, completed_late: 0 },
    ],
  }, overrides || {});
}
function drilldownFixture(overrides) {
  return Object.assign({
    report_contract_version: 1, metric_id: 'open', total_count: 3, limit: 20, offset: 0, has_more: false,
    tasks: [{ task_id: 'd1', task_code: 'CV-D1', title: 'Việc D1', status: 'in_progress', deadline: null, primary_employee_code: 'PHF010', primary_full_name: 'Nguyễn Văn A', primary_department: 'Bán hàng', is_cross_department: false }],
  }, overrides || {});
}
// PERF (2026-09-02) — the Báo cáo screen now fires ONE getTaskReportV2Bundle
// call (context resolved once, every section computed from it) instead of 5
// separate actions. Section objects are byte-identical to the standalone
// results, so the same per-section override keys (o.summary/o.trend/…) drive
// the bundle mock. Individual actions are kept as handlers for single-panel
// retry. A section value that is an Error / bad-contract object is passed
// through into sections[] so per-section isolation can still be exercised.
function bundleSectionFor(o, section) {
  const map = {
    overview: ['summary', overviewFixture],
    trend: ['trend', trendFixture],
    person: ['person', personFixture],
    department: ['department', departmentFixture],
    category: ['category', categoryFixture],
  };
  const [key, fx] = map[section] || [];
  if (!fx) return undefined;
  return o[key] !== undefined ? o[key] : fx();
}
function bundleFixture(body, over) {
  const o = over || {};
  const requested = Array.isArray(body && body.sections) && body.sections.length ? body.sections : ['overview'];
  const sections = {};
  requested.forEach((s) => { const v = bundleSectionFor(o, s); if (v !== undefined) sections[s] = v; });
  return Object.assign({
    report_contract_version: 1,
    period: { type: 'month', start: '2026-08-01T00:00:00.000Z', endExclusive: '2026-09-01T00:00:00.000Z', timezone: 'Asia/Ho_Chi_Minh' },
    effective_scope: 'managed',
    nav_signals: { hasManagedPeople: true, canManageTaskPermissions: true },
    sections_included: requested,
    sections,
  }, o.bundleTop || {});
}
function allPanelsHandlers(over) {
  const o = over || {};
  return {
    getTaskReportV2Bundle: (body) => bundleFixture(body, o),
    getTaskOverviewV2: () => o.summary !== undefined ? o.summary : overviewFixture(),
    getTaskReportV2CategoryAnalysis: () => o.category !== undefined ? o.category : categoryFixture(),
    getTaskReportV2PersonAnalysis: () => o.person !== undefined ? o.person : personFixture(),
    getTaskReportV2DepartmentAnalysis: () => o.department !== undefined ? o.department : departmentFixture(),
    getTaskReportV2Trend: () => o.trend !== undefined ? o.trend : trendFixture(),
    listTaskOverviewV2Drilldown: (body) => o.drilldown !== undefined ? o.drilldown : drilldownFixture({ metric_id: body.metric_id }),
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
    ['/hv/task/bao-cao', '/ql/task/bao-cao', '/admin/task/bao-cao'].forEach(p => {
      pass(ROUTER_SRC.includes("'" + p + "'"), 'ROUTE: ' + p + ' is registered in phf-url-router.js');
    });
  }
  {
    // Tổng quan & Báo cáo V2 (LOCKED UI direction) — 1 nav item duy nhất
    // (key 'tong-quan-bao-cao'), "Báo cáo" là 1 TAB bên trong.
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const overviewReportItem = T.NAV_ITEMS.find(i => i.key === 'tong-quan-bao-cao');
    pass(overviewReportItem && overviewReportItem.enabled === true, 'ROUTE: "Tổng quan & Báo cáo" nav item is enabled (no longer "Sắp triển khai")');
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    root.innerHTML = T.shellFrame('');
    pass(!root.querySelector('[data-task-nav="tong-quan-bao-cao"]').classList.contains('is-soon'), 'ROUTE: rendered "Tổng quan & Báo cáo" nav button has no is-soon class');
  }

  // ================= PERMISSION/UI =================
  {
    // V2: period bar mang DUY NHẤT period.type/anchor_date — không còn
    // relation/scope/category_code (server tự xác định effective_scope theo
    // actor, "Không cho người dùng chọn phạm vi vượt permission").
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    let captured = null;
    window.fetch = mockFetchByAction(Object.assign(allPanelsHandlers({}), {
      getTaskReportV2Bundle: (body) => { captured = body; return bundleFixture(body); },
    }));
    await T.openTaskReport(root);
    const allowedKeys = ['action', 'period', 'sections'];
    pass(Object.keys(captured).every(k => allowedKeys.indexOf(k) >= 0), 'PERM: request payload carries ONLY action/period/sections — no relation/scope/employee override, no client-chosen scope');
    pass(!!captured.period && !!captured.period.type, 'PERM: period always present in request');
    pass(Array.isArray(captured.sections) && captured.sections.length > 0, 'PERM: request lists the sections to bundle (server whitelists them)');
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
    window.fetch = mockFetchByAction(Object.assign(allPanelsHandlers({}), {
      getTaskReportV2Bundle: (body) => { captured = body; return bundleFixture(body); },
    }));
    await T.openTaskReport(root);
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    click(window, root, '[data-task-report-period="week"]');
    pass(captured.period.type === 'week', 'PERIOD: clicking the "Tuần" tab reloads with period.type=week');
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    const beforeAnchor = T.getState().report.anchorDate;
    click(window, root, '[data-task-report-nav="next"]');
    pass(T.getState().report.anchorDate !== beforeAnchor && captured.period.type === 'week', 'PERIOD: next-period nav advances anchor_date and reloads with the SAME period type');
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    assert.doesNotThrow(() => click(window, root, '[data-task-report-nav="today"]'), 'PERIOD: "Hôm nay" nav does not throw');
  }

  // ================= SUMMARY (Tổng hợp kỳ báo cáo) =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    let capturedAction = '';
    window.fetch = mockFetchByAction(Object.assign(allPanelsHandlers({}), {
      getTaskReportV2Bundle: (body) => { capturedAction = body.action; return bundleFixture(body); },
    }));
    await T.openTaskReport(root);
    pass(capturedAction === 'getTaskReportV2Bundle', 'SUMMARY: Báo cáo "Tổng hợp" is served by the SAME getTaskReportV2Bundle call the whole screen uses — one context, no 2nd summary engine');
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    pass(root.innerHTML.includes('Công việc đang mở') && root.innerHTML.includes('Đang quá hạn'), 'SUMMARY: KPI cards render with LOCKED labels');
    pass(root.innerHTML.includes('75%'), 'SUMMARY: on_time_rate renders as percentage');
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    await openReportWithFixtures(window, T, root, { summary: overviewFixture({ metrics: Object.assign({}, overviewFixture().metrics, { on_time_rate: { value: null } }) }) });
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    pass(root.innerHTML.includes('—'), 'SUMMARY: null on_time_rate (zero denominator) renders as "—", never NaN/Infinity/0%-fabricated');
    pass(!/NaN|Infinity/.test(root.innerHTML), 'SUMMARY: no NaN/Infinity leaks into rendered HTML');
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    const state = await openReportWithFixtures(window, T, root, {});
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    T.bindShell(root);
    click(window, root, '[data-task-overview-metric="open"]');
    pass(state.overview.drilldown && state.overview.drilldown.metricId === 'open', 'SUMMARY: clicking a KPI opens the SHARED Overview drilldown state (Tab Báo cáo reuses Tab Tổng quan drilldown — canonical, not a 2nd implementation)');
    pass(!state.overview.drilldown.employeeCode && !state.overview.drilldown.department && !state.overview.drilldown.categoryCode, 'SUMMARY: KPI-level drilldown (from Tổng hợp) carries no dimension filter');
  }

  // ================= TREND =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    await openReportWithFixtures(window, T, root, { trend: { report_contract_version: 1, period: { type: 'day' }, effective_scope: 'managed', trend_supported: false, buckets: [] } });
    const html = T.taskReportTrendHtml();
    pass(html.includes('không hỗ trợ biểu đồ xu hướng'), 'TREND: day period shows the "not applicable" message, no invented hourly chart');
    pass(!html.includes('<svg'), 'TREND: day period renders no chart at all');
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const html = T.taskReportTrendSvgHtml(trendFixture().buckets, 'month');
    pass((html.match(/<g class=/g) || []).length === 2, 'TREND: V2 trend buckets (created_in_period/completed_in_period/completed_on_time/completed_late field names) render unchanged via the REUSED SVG renderer — one bar-group per bucket');
    pass(!/NaN/.test(html), 'TREND: no NaN in generated SVG coordinates');
    assert.doesNotThrow(() => T.taskReportTrendSvgHtml([], 'month'), 'TREND: empty buckets array must not throw');
    pass(T.taskReportTrendSvgHtml([], 'month').includes('Không có dữ liệu'), 'TREND: empty buckets renders an empty-state message, not a broken chart');
  }

  // ================= CATEGORY (Theo loại công việc) =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    await openReportWithFixtures(window, T, root, {});
    const html = T.taskReportV2CategoryHtml();
    pass(html.includes('Chăm sóc khách hàng'), 'CATEGORY: category renders by display_name (fetched via bridgeListTaskCategories — PostgreSQL-native)');
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const state = T.getState();
    state.report.category.data = { categories: [] };
    const html2 = T.taskReportV2CategoryHtml();
    pass(html2.includes('Không có loại công việc'), 'CATEGORY: zero-category population renders an explicit empty state');
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    const state = await openReportWithFixtures(window, T, root, {});
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    T.bindShell(root);
    click(window, root, '[data-task-report-v2-metric="workload"][data-task-report-v2-category-code="CSKH"]');
    pass(state.overview.drilldown.metricId === 'workload' && state.overview.drilldown.categoryCode === 'CSKH', 'CATEGORY: clicking a category chip opens the SHARED drilldown with metric_id=workload + category_code filter');
  }

  // ================= PERSON (Theo nhân sự) =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    await openReportWithFixtures(window, T, root, {});
    const html = T.taskReportV2PersonHtml();
    pass(html.includes('Nguyễn Văn A') && html.includes('Bán hàng'), 'PERSON: person row renders full_name + department (Primary attribution, from org lookup)');
    pass(html.includes('100%'), 'PERSON: on_time_rate renders as percentage');
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    const state = await openReportWithFixtures(window, T, root, {});
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    T.bindShell(root);
    click(window, root, '[data-task-report-v2-metric="completed_in_period"][data-task-report-v2-employee-code="PHF010"]');
    pass(state.overview.drilldown.metricId === 'completed_in_period' && state.overview.drilldown.employeeCode === 'PHF010', 'PERSON: performance chip click opens SHARED drilldown with metric_id + employee_code');
  }

  // ================= DEPARTMENT (Theo phòng ban — MỚI, Gate V2-R2) =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    let capturedBody = null;
    window.fetch = mockFetchByAction(Object.assign(allPanelsHandlers({}), {
      getTaskReportV2Bundle: (body) => { capturedBody = body; return bundleFixture(body); },
    }));
    await T.openTaskReport(root);
    pass(capturedBody && capturedBody.action === 'getTaskReportV2Bundle' && capturedBody.sections.indexOf('department') >= 0, 'DEPARTMENT: department data is requested as a section of the canonical bundle call');
    const html = T.taskReportV2DepartmentHtml();
    pass(html.includes('Bán hàng'), 'DEPARTMENT: department bucket renders by name (Primary\'s own department — LOCKED cross-department attribution)');
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    const state = await openReportWithFixtures(window, T, root, {});
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    T.bindShell(root);
    click(window, root, '[data-task-report-v2-metric="workload"][data-task-report-v2-department="Bán hàng"]');
    pass(state.overview.drilldown.metricId === 'workload' && state.overview.drilldown.department === 'Bán hàng', 'DEPARTMENT: workload chip click opens SHARED drilldown with metric_id=workload + department filter');
  }

  // ================= DRILLDOWN (CANONICAL, dùng chung Tổng quan/Báo cáo) =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    let capturedPayload = null;
    await openReportWithFixtures(window, T, root, { drilldown: drilldownFixture({ total_count: 45, limit: 20, offset: 0, has_more: true }) });
    window.fetch = mockFetchByAction(Object.assign(allPanelsHandlers({}), {
      listTaskOverviewV2Drilldown: (body) => { capturedPayload = body; return drilldownFixture({ total_count: 45, limit: 20, offset: body.offset, has_more: body.offset + 20 < 45 }); },
    }));
    await T.openTaskOverviewV2Drilldown(root, 'open', {});
    pass(capturedPayload.limit === 20 && capturedPayload.offset === 0, 'DRILLDOWN: first page requests limit/offset per backend contract');
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    T.bindShell(root);
    pass(root.innerHTML.includes('phft-op-count">45<'), 'DRILLDOWN: total_count is shown exactly as returned by backend (Step 2 drawer header count)');
    click(window, root, '[data-task-overview-drilldown-page="next"]');
    pass(capturedPayload.offset === 20, 'DRILLDOWN: "Sau" advances offset by limit');
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    T.bindShell(root);
    click(window, root, '[data-task-overview-drilldown-page="prev"]');
    pass(capturedPayload.offset === 0, 'DRILLDOWN: "Trước" retreats offset by limit, never negative');
    let navigatedTo = '';
    window.phfNavigate = function (p) { navigatedTo = p; };
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    T.bindShell(root);
    click(window, root, '[data-task-list-row="d1"]');
    pass(navigatedTo === T.taskDetailPath('d1'), 'DRILLDOWN: clicking a task row navigates to the EXISTING real Task Detail route (no second detail implementation)');
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    await openReportWithFixtures(window, T, root, { drilldown: drilldownFixture({ tasks: [], total_count: 0, has_more: false }) });
    await T.openTaskOverviewV2Drilldown(root, 'open', {});
    const html = T.taskOverviewV2DrilldownHtml();
    pass(html.includes('Không có công việc phù hợp'), 'DRILLDOWN: empty result set shows an explicit empty state');
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    await openReportWithFixtures(window, T, root, {});
    window.fetch = mockFetchByAction({ listTaskOverviewV2Drilldown: () => Object.assign(new Error('Lỗi hệ thống PHF Task Overview: boom'), { code: 'TASK_OVERVIEW_V2_ERROR' }) });
    await T.openTaskOverviewV2Drilldown(root, 'open', {});
    const html = T.taskOverviewV2DrilldownHtml();
    pass(html.includes('Không tải được danh sách'), 'DRILLDOWN: error state renders a controlled, user-facing message');
    pass(!/node_modules|\.js:\d+:\d+/.test(html), 'DRILLDOWN: error rendering never leaks a stack trace / internal path');
  }

  // ================= CONTRACT VERSION =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    window.fetch = mockFetchByAction(allPanelsHandlers({ summary: overviewFixture({ report_contract_version: 2 }) }));
    await T.openTaskReport(root);
    const state = T.getState();
    pass(state.report.summary.data === null && !!state.report.summary.error, 'CONTRACT: a bundle section with a mismatched report_contract_version is rejected client-side, not silently trusted');
    pass(T.taskOverviewV2CheckContract({ report_contract_version: 1 }) === true, 'CONTRACT: version 1 is accepted');
    pass(T.taskOverviewV2CheckContract({ report_contract_version: 2 }) === false, 'CONTRACT: version 2 is rejected');
    pass(T.taskOverviewV2CheckContract({}) === false, 'CONTRACT: missing version field is rejected');
  }

  // ================= FAILURE ISOLATION =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    window.fetch = mockFetchByAction(allPanelsHandlers({ category: Object.assign(new Error('Lỗi hệ thống PHF Task Report: category boom'), { code: 'ERR' }) }));
    await T.openTaskReport(root);
    const state = T.getState();
    pass(!!state.report.summary.data && !state.report.summary.error, 'ISOLATION: summary panel loaded successfully despite the category section being malformed');
    pass(!state.report.category.data && !!state.report.category.error, 'ISOLATION: category panel independently shows its own error');
    pass(!!state.report.person.data && !!state.report.department.data && !!state.report.trend.data, 'ISOLATION: person/department/trend panels are unaffected by the bad category section');
    const html = T.taskReportHtml();
    pass(html.includes('Không tải được dữ liệu') && html.includes('Tổng hợp kỳ báo cáo'), 'ISOLATION: page renders summary content AND the category error side-by-side, never a blank page');
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
      if (body.action !== 'getTaskOverviewV2') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: { report_contract_version: 1, categories: [], people: [], departments: [], trend_supported: true, buckets: [] } }) });
      callCount++;
      if (callCount === 1) return new Promise(res => { resolveFirst = res; });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: overviewFixture({ metrics: Object.assign({}, overviewFixture().metrics, { open: { metric_id: 'open', value: 999 } }) }) }) });
    };
    const state = T.getState();
    const firstLoad = T.loadTaskReportSummary(root);
    const secondLoad = T.loadTaskReportSummary(root);
    await secondLoad;
    resolveFirst({ ok: true, json: () => Promise.resolve({ ok: true, result: overviewFixture({ metrics: Object.assign({}, overviewFixture().metrics, { open: { metric_id: 'open', value: 111 } }) }) }) });
    await firstLoad;
    pass(state.report.summary.data.metrics.open.value === 999, 'DEDUP: a superseded in-flight request never overwrites the result of a newer request that already resolved');
  }

  console.log(`PHF Task Tổng quan & Báo cáo V2 (Gate V2-R2) UI test: ${passed}/${passed} PASS`);
})().catch(err => { console.error('FAIL', err); process.exit(1); });
