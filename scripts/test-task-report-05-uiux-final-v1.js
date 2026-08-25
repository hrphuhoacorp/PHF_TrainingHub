'use strict';

/*
 * PHF Task — REPORT-05 DASHBOARD UI/UX FINAL — jsdom frontend assertions
 * (same window.eval harness as scripts/test-task-report-ui-v1.js), no
 * network, no real DB. Backend contract/metrics were already proven by
 * scripts/test-task-reporting-v1.js (Report-03/63 assertions) and
 * scripts/test-task-report-employee-drilldown-parity-v1.js (Report-04A/23
 * assertions) — this file only proves the Report-05 REDESIGN itself:
 * information hierarchy reorder (Attention right after KPI, before Trend),
 * 2-tier KPI (primary/secondary), category/person TABLE conversion with
 * client-side sort (zero extra network calls), and the AI-floating-button
 * safe-area/no-polling/no-N+1 guards.
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
const CSS_SRC = readSrc('assets/css/phf-task.css');

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
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: result }) });
  };
}
function summaryFixture() {
  return {
    report_contract_version: 1, period: { type: 'month' },
    metrics: {
      created_in_period: { metric_id: 'created_in_period', value: 8, kind: 'period_flow' },
      not_started: { metric_id: 'not_started', value: 2, kind: 'current_state' },
      in_progress: { metric_id: 'in_progress', value: 3, kind: 'current_state' },
      completed_in_period: { metric_id: 'completed_in_period', value: 4, kind: 'period_flow' },
      completed_on_time: { metric_id: 'completed_on_time', value: 3, kind: 'period_flow' },
      completed_late: { metric_id: 'completed_late', value: 1, kind: 'period_flow' },
      currently_overdue: { metric_id: 'currently_overdue', value: 2, kind: 'current_state', period_relevance: 'none' },
      average_progress: { metric_id: 'average_progress', value: 40, kind: 'current_state', population: 'active_only' },
      on_time_rate: { value: 0.75, kind: 'derived' }
    },
    attention: { currently_overdue_count: 2, due_soon_count: 3, due_soon_threshold_days: 3, stale_count: 0, stale_threshold_days: 7, reopen_count_total: 1 },
    data_integrity_warnings: []
  };
}
function categoryFixture() {
  return {
    report_contract_version: 1, period: { type: 'month' },
    categories: [
      { category_code: 'A', display_name: 'Nhóm A (ít việc)', is_active: true, metrics: {
        created_in_period: { value: 2 }, not_started: { value: 0 }, in_progress: { value: 1 }, completed_in_period: { value: 1 },
        completed_on_time: { value: 1 }, completed_late: { value: 0 }, currently_overdue: { value: 0 }, average_progress: { value: 50 }
      } },
      { category_code: 'B', display_name: 'Nhóm B (nhiều việc, nhiều quá hạn)', is_active: true, metrics: {
        created_in_period: { value: 9 }, not_started: { value: 1 }, in_progress: { value: 2 }, completed_in_period: { value: 1 },
        completed_on_time: { value: 0 }, completed_late: { value: 1 }, currently_overdue: { value: 5 }, average_progress: { value: 20 }
      } }
    ],
    data_integrity_warnings: []
  };
}
function personFixture() {
  return {
    report_contract_version: 1, period: { type: 'month' },
    workload: [
      { employee_code: 'PHF010', full_name: 'Người A', department: 'X', total: 3, primary_count: 2, coordinator_count: 0, self_task_count: 1,
        breakdown: [
          { task_id: 't-self', task_code: 'CV-SELF', title: 'Tự giao', workload_role: 'primary', self_task: true, status: 'completed', deadline: null },
          { task_id: 't-overdue', task_code: 'CV-OVERDUE', title: 'Quá hạn', workload_role: 'primary', self_task: false, status: 'in_progress', deadline: new Date(Date.now() - 5 * 86400000).toISOString() }
        ] },
      { employee_code: 'PHF012', full_name: 'Người B (chỉ coordinator)', department: 'X', total: 5, primary_count: 0, coordinator_count: 5, self_task_count: 0, breakdown: [] }
    ],
    performance: [
      { employee_code: 'PHF010', full_name: 'Người A', completed_in_period: 1, completed_on_time: 1, completed_late: 0, completion_rate: 'DEFERRED' }
    ],
    data_integrity_warnings: []
  };
}
function trendFixture() {
  return {
    report_contract_version: 1, period: { type: 'month' }, trend_supported: true,
    buckets: [
      { start: '2026-08-01T00:00:00.000Z', end_exclusive: '2026-08-02T00:00:00.000Z', created_in_period: 2, completed_in_period: 1, completed_on_time: 1, completed_late: 0 },
      { start: '2026-08-02T00:00:00.000Z', end_exclusive: '2026-08-03T00:00:00.000Z', created_in_period: 1, completed_in_period: 0, completed_on_time: 0, completed_late: 0 }
    ]
  };
}
function allPanelsHandlers() {
  return {
    getTaskReportSummary: () => summaryFixture(),
    getTaskReportCategoryAnalysis: () => categoryFixture(),
    getTaskReportPersonAnalysis: () => personFixture(),
    getTaskReportTrend: () => trendFixture()
  };
}
async function openReport(window, T, root) {
  window.fetch = mockFetchByAction(allPanelsHandlers());
  await T.openTaskReport(root);
  root.innerHTML = T.shellFrame(T.taskReportHtml());
  T.bindShell(root);
  return T.getState();
}

(async () => {
  // ================= 1. INFORMATION HIERARCHY =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    await openReport(window, T, root);
    const html = T.taskReportHtml();
    const idxFilter = html.indexOf('phft-report-filterbar');
    const idxKpi = html.indexOf('Tổng quan kỳ báo cáo');
    const idxAttention = html.indexOf('Điểm cần chú ý');
    const idxTrend = html.indexOf('Xu hướng công việc');
    const idxCategory = html.indexOf('Phân tích tiến độ theo nhóm việc');
    const idxPerson = html.indexOf('Khối lượng công việc');
    pass(idxFilter >= 0 && idxKpi > idxFilter, 'HIERARCHY: filter bar renders before KPI');
    pass(idxAttention > idxKpi, 'HIERARCHY: Attention renders AFTER KPI');
    pass(idxAttention < idxTrend, 'HIERARCHY: Attention renders BEFORE Trend (mục III/XIX — not at the bottom of the page anymore)');
    pass(idxTrend < idxCategory, 'HIERARCHY: Trend renders before Category analysis');
    pass(idxCategory < idxPerson, 'HIERARCHY: Category renders before Person analysis');
    pass(html.indexOf('<div class="phft-report-page">') === 0, 'HIERARCHY: whole report wrapped in .phft-report-page (AI-button safe-area container)');
  }

  // ================= 2. PRIMARY / SECONDARY KPI =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const primaryIds = T.TASK_REPORT_KPI_PRIMARY.map(e => e[0]);
    const secondaryIds = T.TASK_REPORT_KPI_SECONDARY.map(e => e[0]);
    pass(primaryIds.length === 4, 'KPI: exactly 4 primary KPIs (mục V)');
    pass(JSON.stringify(primaryIds) === JSON.stringify(['created_in_period', 'completed_in_period', 'currently_overdue', 'on_time_rate']), 'KPI: primary tier is exactly Phát sinh/Hoàn thành/Đang quá hạn/Tỷ lệ đúng hạn, in that order');
    pass(secondaryIds.length === 5, 'KPI: exactly 5 secondary KPIs');
    pass(primaryIds.every(id => secondaryIds.indexOf(id) < 0), 'KPI: no overlap between primary and secondary tiers');
    pass(T.TASK_REPORT_KPI_ORDER.length === 9, 'KPI: full order (primary+secondary) still has all 9 metrics — no metric dropped, only regrouped');
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    await openReport(window, T, root);
    const html = T.taskReportSummaryHtml();
    pass(html.includes('phft-report-kpi-row-primary') && html.includes('phft-report-kpi-row-secondary'), 'KPI: two visually distinct rows rendered (primary/secondary)');
    pass(/phft-kpi-primary[^"]*"[^>]*data-task-report-metric="currently_overdue"/.test(html) || /data-task-report-metric="currently_overdue"[^>]*class="phft-kpi[^"]*phft-kpi-primary/.test(html) || html.match(/class="phft-kpi phft-kpi-primary[^"]*is-overdue-accent[^"]*" type="button" data-task-report-metric="currently_overdue"/), 'KPI: currently_overdue renders in the PRIMARY tier with the overdue accent class (value > 0 in fixture)');
    pass(!/class="phft-kpi phft-kpi-primary[^"]*"[^>]*data-task-report-metric="not_started"/.test(html), 'KPI: not_started renders in the secondary tier, not primary');
  }

  // ================= 7/8. CATEGORY & PERSON TABLE NUMBERS MATCH RESPONSE =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    const state = await openReport(window, T, root);
    const html = T.taskReportCategoryHtml();
    pass(html.includes('<table class="phft-report-table">'), 'CATEGORY: renders as a compact TABLE, not a card list (mục IX)');
    pass(html.includes('Nhóm A (ít việc)') && html.includes('Nhóm B (nhiều việc, nhiều quá hạn)'), 'CATEGORY: both fixture categories render by display_name');
    // Nhóm B: created_in_period=9, currently_overdue=5 — numbers must appear verbatim from the response.
    pass(/data-task-report-metric="created_in_period"[^>]*><strong>9<\/strong>/.test(html), 'CATEGORY: created_in_period value (9) matches the report response exactly');
    pass(/data-task-report-metric="currently_overdue"[^>]*><strong>5<\/strong>/.test(html), 'CATEGORY: currently_overdue value (5) matches the report response exactly');

    const personHtml = T.taskReportPersonHtml();
    pass(personHtml.includes('<table class="phft-report-table">'), 'PERSON: renders as compact TABLEs, not card list (mục X)');
    pass(/<td>5<\/td>/.test(personHtml), 'PERSON: PHF012 total workload (5) matches the report response exactly');
  }

  // ================= 9/10/11. SELF-TASK / COORDINATOR POLICY IN THE NEW TABLE =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    const state = await openReport(window, T, root);
    const html = T.taskReportPersonHtml();
    pass(/<th>Tự giao<\/th>/.test(html), 'SELF_TASK: workload table has a dedicated "Tự giao" column');
    pass(!html.includes('completion_rate') && !html.includes('"điểm hiệu suất"') && !/Top\s*1|Xếp hạng/.test(html), 'PERFORMANCE: no invented performance score / leaderboard / ranking label anywhere in the person section (mục X)');
    // PHF012 is coordinator-only (0 primary, 5 coordinator, workload total=5) and has NO performance[] entry in the fixture —
    // it must appear in the WORKLOAD table but must NOT appear in the PERFORMANCE table (coordinator never credited completion).
    const workloadIdx = html.indexOf('Khối lượng công việc'), perfIdx = html.indexOf('Kết quả công việc');
    const workloadSection = html.slice(workloadIdx, perfIdx);
    const perfSection = html.slice(perfIdx);
    pass(workloadSection.includes('Người B (chỉ coordinator)'), 'COORDINATOR: coordinator-only employee (PHF012) appears in the Workload table');
    pass(!perfSection.includes('Người B (chỉ coordinator)'), 'COORDINATOR: coordinator-only employee (PHF012) does NOT appear in the Performance table — never credited a completion they only coordinated on');
  }

  // ================= 15. EMPTY STATE IN NEW TABLE STRUCTURE =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const state = T.getState();
    state.report.category.data = { categories: [], data_integrity_warnings: [] };
    const html = T.taskReportCategoryHtml();
    pass(html.includes('Không có công việc') && !html.includes('<table'), 'EMPTY: zero categories renders the empty-state message, not an empty <table>');
    state.report.person.data = { workload: [], performance: [], data_integrity_warnings: [] };
    const personHtml = T.taskReportPersonHtml();
    pass(personHtml.includes('Không có khối lượng công việc') && personHtml.includes('Chưa có công việc hoàn thành'), 'EMPTY: zero workload/performance renders explicit empty-state messages in both columns');
  }

  // ================= 12/18. SORT = ZERO EXTRA NETWORK CALLS (NO N+1) =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    const state = await openReport(window, T, root);
    let fetchCalls = 0;
    const originalFetch = window.fetch;
    window.fetch = function () { fetchCalls++; return originalFetch.apply(this, arguments); };

    click(window, root, '[data-task-report-cat-sort="currently_overdue"]');
    pass(fetchCalls === 0, 'SORT: clicking a category sort header triggers ZERO network requests (client-side only, mục XVI)');
    pass(state.report.categorySort.key === 'currently_overdue' && state.report.categorySort.dir === 'desc', 'SORT: category sort state updates to the clicked column, default desc');
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    T.bindShell(root);
    const htmlAfterSort = T.taskReportCategoryHtml();
    const idxA = htmlAfterSort.indexOf('Nhóm A'), idxB = htmlAfterSort.indexOf('Nhóm B');
    pass(idxB >= 0 && idxA >= 0 && idxB < idxA, 'SORT: sorting by "Quá hạn" desc puts Nhóm B (5 overdue) before Nhóm A (0 overdue)');

    click(window, root, '[data-task-report-cat-sort="currently_overdue"]');
    pass(fetchCalls === 0, 'SORT: clicking the SAME column again (toggle asc/desc) still triggers ZERO network requests');
    pass(state.report.categorySort.dir === 'asc', 'SORT: clicking the same sort column again toggles direction to asc');

    root.innerHTML = T.shellFrame(T.taskReportHtml());
    T.bindShell(root);
    click(window, root, '[data-task-report-workload-sort="overdue"]');
    pass(fetchCalls === 0, 'SORT: clicking the workload "Quá hạn" sort header triggers ZERO network requests');
    pass(T.taskReportWorkloadOverdueCount(personFixture().workload[0]) === 1, 'SORT: computed workload overdue count reuses already-fetched breakdown[] data (1 real overdue entry in the fixture), no new metric invented');

    root.innerHTML = T.shellFrame(T.taskReportHtml());
    T.bindShell(root);
    click(window, root, '[data-task-report-perf-sort="completed_late"]');
    pass(fetchCalls === 0, 'SORT: clicking the performance "Trễ hạn" sort header triggers ZERO network requests');
  }

  // ================= 17. NO POLLING INTRODUCED =================
  {
    const reportSectionStart = TASK_APP_SRC.indexOf('REPORT / DASHBOARD V1');
    const reportSectionEnd = TASK_APP_SRC.indexOf('PHF_TASK_UI_DEMO_V1 — tìm 1 task demo');
    const reportSectionSrc = TASK_APP_SRC.slice(reportSectionStart, reportSectionEnd);
    pass(!/setInterval\s*\(/.test(reportSectionSrc), 'NO_POLLING: the entire Report/Dashboard section contains no setInterval call');
    pass(!/setTimeout\s*\([^,]+,\s*\d{3,}/.test(reportSectionSrc), 'NO_POLLING: no recurring setTimeout-based refresh loop in the Report section');
  }

  // ================= 16. NARROW VIEWPORT — RESPONSIVE RULES PRESENT =================
  {
    pass(/@media\(max-width:520px\)\{[^}]*\.phft-report-kpi-row-primary\{grid-template-columns:1fr 1fr\}/.test(CSS_SRC), 'NARROW: primary KPI row collapses to 2 columns at <=520px');
    pass(/\.phft-report-table-scroll\{overflow-x:auto/.test(CSS_SRC), 'NARROW: category/person tables scroll horizontally instead of breaking layout on narrow screens');
    pass(CSS_SRC.includes('.phft-report-drilldown-panel{width:100%}'), 'NARROW: drilldown panel goes full-width on narrow viewports');
    pass(/\.phft-report-page\{padding-bottom:96px\}/.test(CSS_SRC), 'AI_OVERLAP: report page reserves bottom safe-area so the floating PHF AI button cannot cover the last table row/actions');
  }

  // ================= 19. TASK DETAIL NAVIGATION STILL REAL (NO SECOND DETAIL IMPL) =================
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    const state = await openReport(window, T, root);
    let navigatedTo = '';
    window.phfNavigate = function (p) { navigatedTo = p; };
    click(window, root, '[data-task-report-workload-toggle="PHF010"]');
    root.innerHTML = T.shellFrame(T.taskReportHtml());
    T.bindShell(root);
    click(window, root, '[data-task-report-open-task="t-overdue"]');
    pass(navigatedTo === T.taskDetailPath('t-overdue'), 'TASK_DETAIL: clicking a workload breakdown row still navigates to the EXISTING real Task Detail route');
  }

  console.log(`PHF Task Report-05 Dashboard UI/UX Final test: ${passed}/${passed} PASS`);
})().catch(err => { console.error('FAIL', err); process.exit(1); });
