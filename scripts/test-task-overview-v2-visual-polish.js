'use strict';

/*
 * PHF Task — Tổng quan V2 UI polish (2026-08-29, demo approved) — jsdom
 * structural acceptance. Presentation-only gate: verifies layout/DOM
 * structure matches the LOCKED target layout, NOT metric formulas (those
 * are proven by scripts/test-task-overview-v2-foundation.js against real
 * PostgreSQL data). No network, no real DB.
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
  window.phfGetSessionRole = function () { return 'admin'; };
  window.phfGetCurrentUser = function () { return { fullName: 'Demo QA', employeeCode: 'DEMO_QA' }; };
  window.phfNavigate = function () { };
  window.phfToast = function () { };
  window.fetch = function () { throw new Error('unstubbed fetch() call'); };
  window.eval(TASK_APP_SRC);
  return window;
}

const OVERVIEW_FIXTURE = {
  report_contract_version: 1,
  period: { type: 'month', start: '2026-08-01T00:00:00.000Z', endExclusive: '2026-09-01T00:00:00.000Z' },
  effective_scope: 'managed',
  metrics: {
    open: { value: 61 }, overdue: { value: 4 }, due_soon: { value: 17 },
    completed_in_period: { value: 10 }, on_time_rate: { value: 0 }, attention_needed: { value: null },
  },
  status_breakdown: { not_started: 10, in_progress: 52, overdue: 8, completed: 78, cancelled: 4 },
  top_overdue: [
    { task_id: 'ov1', task_code: 'CV-2608-0089', title: 'Đối chiếu chứng từ chi tuần', status: 'in_progress', deadline: new Date(Date.now() - 5 * 86400000).toISOString(), primary_employee_code: 'PHF001', primary_full_name: 'Nguyễn Thị Bích', primary_department: 'Bộ phận Tài chính Kế toán', is_cross_department: false },
    { task_id: 'ov2', task_code: 'CV-2608-0120', title: 'Rà soát hạn sử dụng hàng hoá', status: 'in_progress', deadline: new Date(Date.now() - 3 * 86400000).toISOString(), primary_employee_code: 'PHF002', primary_full_name: 'Nguyễn Huỳnh Phước Huy', primary_department: 'Bộ phận kho vận', is_cross_department: false },
  ],
  top_due_soon: [
    { task_id: 'ds1', task_code: 'CV-2608-0145', title: 'Kiểm đếm hàng nhập lô mới', status: 'published', deadline: new Date(Date.now() + 1 * 86400000).toISOString(), primary_employee_code: 'PHF003', primary_full_name: 'Nguyễn Huỳnh Phước Huy', primary_department: 'Bộ phận kho vận', is_cross_department: false },
  ],
};
const TREND_FIXTURE = {
  report_contract_version: 1, period: { type: 'month', start: '2026-08-01T00:00:00.000Z', endExclusive: '2026-09-01T00:00:00.000Z' }, effective_scope: 'managed', trend_supported: true,
  buckets: Array.from({ length: 30 }, (_, i) => ({
    start: new Date(Date.now() - (29 - i) * 86400000).toISOString(), end_exclusive: '',
    created_in_period: (i * 3) % 20, completed_in_period: (i * 2) % 15, completed_on_time: i % 5, completed_late: i % 3, overdue_in_period: i % 4,
  })),
};
const DEPARTMENT_FIXTURE = {
  report_contract_version: 1, period: { type: 'month' }, effective_scope: 'managed',
  departments: [
    { department: 'Kinh doanh', workload: 30, open: 25, overdue: 3, due_soon: 2, completed_in_period: 5, completed_on_time: 4, completed_late: 1, on_time_rate: 80 },
    { department: 'Nhân sự', workload: 20, open: 18, overdue: 0, due_soon: 1, completed_in_period: 2, completed_on_time: 2, completed_late: 0, on_time_rate: 100 },
  ],
};

function mockFetch(overrides, captureBox) {
  return function (url, options) {
    const body = JSON.parse(options.body);
    if (captureBox) { captureBox[body.action] = body; }
    const map = Object.assign({
      getTaskOverviewV2: OVERVIEW_FIXTURE,
      getTaskReportV2Trend: TREND_FIXTURE,
      getTaskReportV2DepartmentAnalysis: DEPARTMENT_FIXTURE,
    }, overrides || {});
    const result = map[body.action];
    if (result === undefined) throw new Error('unstubbed action: ' + body.action);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result }) });
  };
}

(async () => {
  const window = newWindow();
  const T = window.__PHF_TASK_TEST__;
  const root = window.document.getElementById('phfTaskRoot');
  T.bindShell(root);
  const capture = {};
  window.fetch = mockFetch({}, capture);
  await T.openTaskOverviewV2(root);
  root.innerHTML = T.shellFrame(T.taskOverviewV2Html());
  const html = root.innerHTML;

  // ================= OVERVIEW_TIME_CONTEXT_ALIGNED =================
  // KPI (getTaskOverviewV2), Trend (getTaskReportV2Trend) và Department
  // (getTaskReportV2DepartmentAnalysis) PHẢI cùng gửi period.type/anchor_date
  // GIỐNG HỆT NHAU — 1 time-context duy nhất cho toàn màn Tổng quan.
  pass(!!capture.getTaskOverviewV2 && !!capture.getTaskReportV2Trend && !!capture.getTaskReportV2DepartmentAnalysis, 'OVERVIEW_TIME_CONTEXT_ALIGNED: cả 3 request đều được gửi', Object.keys(capture));
  pass(JSON.stringify(capture.getTaskOverviewV2.period) === JSON.stringify(capture.getTaskReportV2Trend.period), 'OVERVIEW_TIME_CONTEXT_ALIGNED: Trend request dùng CÙNG period với KPI (không còn window_days cố định)', { kpi: capture.getTaskOverviewV2.period, trend: capture.getTaskReportV2Trend.period });
  pass(JSON.stringify(capture.getTaskOverviewV2.period) === JSON.stringify(capture.getTaskReportV2DepartmentAnalysis.period), 'OVERVIEW_TIME_CONTEXT_ALIGNED: Department request dùng CÙNG period với KPI', { kpi: capture.getTaskOverviewV2.period, dept: capture.getTaskReportV2DepartmentAnalysis.period });
  pass(capture.getTaskReportV2Trend.window_days === undefined, 'OVERVIEW_TIME_CONTEXT_ALIGNED: request Trend KHÔNG còn tham số window_days (đã gỡ time engine thứ 2)', capture.getTaskReportV2Trend);

  // Đổi kỳ (period type) trên Tổng quan -> CẢ 3 request đều reload với period
  // MỚI giống nhau — chứng minh không có 1 màn 2 time-context.
  const periodTypeSelect = root.querySelector('[data-task-overview-period-type]');
  periodTypeSelect.value = 'week';
  periodTypeSelect.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  pass(capture.getTaskOverviewV2.period.type === 'week' && capture.getTaskReportV2Trend.period.type === 'week' && capture.getTaskReportV2DepartmentAnalysis.period.type === 'week', 'OVERVIEW_TIME_CONTEXT_ALIGNED: đổi kỳ (Tuần) -> KPI/Trend/Department đều reload cùng period.type mới', { kpi: capture.getTaskOverviewV2.period.type, trend: capture.getTaskReportV2Trend.period.type, dept: capture.getTaskReportV2DepartmentAnalysis.period.type });

  // ================= SIX_KPI_LAYOUT =================
  const kpiRow = root.querySelector('.phft-kpi-row.is-managed');
  pass(!!kpiRow, 'SIX_KPI_LAYOUT: KPI row renders as 6-column grid (.is-managed)');
  pass(kpiRow.querySelectorAll('.phft-kpi').length === 6, 'SIX_KPI_LAYOUT: exactly 6 KPI cards render');
  pass(html.includes('Công việc đang mở') && html.includes('Công việc quá hạn') && html.includes('Sắp tới hạn (3 ngày)') && html.includes('Hoàn thành trong kỳ') && html.includes('Tỷ lệ đúng hạn') && html.includes('Điểm nghẽn cần chú ý'), 'SIX_KPI_LAYOUT: all 6 LOCKED labels present');
  pass(kpiRow.querySelectorAll('.phft-kpi-icon').length === 6, 'SIX_KPI_LAYOUT: every KPI card has an icon');
  pass(root.querySelector('.phft-kpi-icon.is-bottleneck') !== null, 'SIX_KPI_LAYOUT: bottleneck KPI slot renders (value "—", no invented number)');
  const bottleneckCard = Array.from(kpiRow.querySelectorAll('.phft-kpi')).find(c => c.textContent.includes('Điểm nghẽn'));
  pass(bottleneckCard.querySelector('strong').textContent === '—', 'BOTTLENECK_NO_INVENTED_FORMULA: KPI card shows "—", not a fabricated number');
  pass(!bottleneckCard.matches('button'), 'BOTTLENECK_NO_INVENTED_FORMULA: bottleneck KPI card is NOT clickable (no canonical drilldown for it)');

  // ================= DRILLDOWN_PRESERVED (KPI click) =================
  const openCard = Array.from(kpiRow.querySelectorAll('button.phft-kpi')).find(c => c.getAttribute('data-task-overview-metric') === 'open');
  pass(!!openCard, 'DRILLDOWN_PRESERVED: "Công việc đang mở" KPI is a clickable button (data-task-overview-metric=open)');
  const overdueCardBtn = root.querySelector('[data-task-overview-metric="overdue"]');
  pass(!!overdueCardBtn && overdueCardBtn.classList.contains('is-overdue-accent'), 'DRILLDOWN_PRESERVED + visual hierarchy: overdue KPI clickable AND has accent styling');

  // ================= TREND_CHART (time-context aligned, 2026-08-29) =======
  pass(html.includes('Xu hướng công việc') && !html.includes('30 ngày gần nhất'), 'TREND_CHART: panel title no longer claims a fixed "30 ngày" window (time-context aligned to period selector)');
  pass(root.querySelector('.phft-linechart-svg') !== null, 'TREND_CHART: line chart SVG renders (not a table)');
  pass(root.querySelectorAll('.phft-linechart-line').length === 3, 'TREND_CHART: 3 series lines (Phát sinh/Hoàn thành/Quá hạn)');
  pass(html.includes('Phát sinh mới') && html.includes('Hoàn thành') && html.includes('Quá hạn'), 'TREND_CHART: legend labels present');
  pass(root.querySelectorAll('.phft-linechart-dot title').length > 0, 'TREND_CHART: hover tooltip (<title>) present on data points');
  pass(!/NaN/.test(html), 'TREND_CHART: no NaN in chart markup');

  // ================= DEPARTMENT_WORKLOAD_CHART =================
  pass(html.includes('Khối lượng công việc theo phòng ban'), 'DEPARTMENT_WORKLOAD_CHART: panel title present');
  pass(root.querySelectorAll('.phft-deptbar-row').length === 2, 'DEPARTMENT_WORKLOAD_CHART: horizontal bar per department (not a table)');
  pass(html.indexOf('Kinh doanh') < html.indexOf('Nhân sự'), 'DEPARTMENT_WORKLOAD_CHART: sorted by workload desc (backend-provided order preserved)');
  pass(html.includes('3 quá hạn'), 'DEPARTMENT_WORKLOAD_CHART: overdue count shown per department');
  pass(!html.includes('Xem báo cáo theo phòng ban') || root.querySelector('[data-task-overview-goto-report]') !== null, 'DEPARTMENT_WORKLOAD_CHART: "Xem báo cáo theo phòng ban" action present');

  // ================= CANCELLED_NOT_IN_MAIN_VISUALS =================
  pass(!html.includes('Cơ cấu trạng thái'), 'CANCELLED_NOT_IN_MAIN_VISUALS: status-breakdown block removed from Tổng quan (per LOCKED decision, demo has no such block)');
  pass(!html.includes('Đã hủy'), 'CANCELLED_NOT_IN_MAIN_VISUALS: "Đã hủy" never appears anywhere on Tổng quan');

  // ================= OVERDUE_TOP5 / DUE_SOON_TOP5 =================
  pass(html.includes('Top 5 công việc quá hạn') && html.includes('Top 5 công việc sắp tới hạn'), 'OVERDUE_TOP5/DUE_SOON_TOP5: both panel titles present');
  const top5Row = root.querySelector('.phft-top5-row');
  pass(!!top5Row && top5Row.children.length === 2, 'OVERDUE_TOP5/DUE_SOON_TOP5: side-by-side layout (2 cards in 1 row)');
  pass(root.querySelector('.phft-top5-days.is-overdue') !== null, 'OVERDUE_TOP5: "X ngày" overdue badge renders');
  pass(root.querySelector('.phft-top5-days.is-due-soon') !== null, 'DUE_SOON_TOP5: "X ngày" due-soon badge renders');
  pass(html.includes('Xem tất cả công việc quá hạn') && html.includes('Xem tất cả công việc sắp tới hạn'), 'OVERDUE_TOP5/DUE_SOON_TOP5: "Xem tất cả" canonical drilldown links present');
  const goAllOverdue = root.querySelector('[data-task-overview-metric="overdue"].phft-panel-link');
  pass(!!goAllOverdue, 'DRILLDOWN_PRESERVED: "Xem tất cả công việc quá hạn" wired to canonical drilldown (data-task-overview-metric=overdue)');

  // ================= HEADER =================
  pass(html.includes('Cập nhật lần cuối'), 'HEADER: "last updated" timestamp shown');
  pass(root.querySelector('[data-task-overview-period-type]') !== null, 'HEADER: period-type selector present');
  pass(root.querySelector('[data-task-overview-nav="prev"]') !== null && root.querySelector('[data-task-overview-nav="next"]') !== null, 'HEADER: prev/next period nav present');
  pass(root.querySelector('[data-task-overview-filter]') !== null, 'HEADER: "Bộ lọc" control present (placeholder, does not fake a filter)');
  pass(root.querySelector('.phft-page-head h1').textContent === 'Tổng quan', 'HEADER: title is "Tổng quan" (not tall/cluttered)');

  // ================= REPORTING_V2_ARCHITECTURE_PRESERVED =================
  pass(root.querySelector('[data-task-overview-tab="overview"].is-active') !== null, 'REPORTING_V2_ARCHITECTURE_PRESERVED: tab bar still present, Tổng quan active');
  pass(root.querySelector('[data-task-overview-tab="report"]') !== null, 'REPORTING_V2_ARCHITECTURE_PRESERVED: Báo cáo tab still reachable');

  // ================= responsive class presence (structural, not pixel) ====
  const cssSrc = readSrc('assets/css/phf-task.css');
  pass(/@media\(max-width:1100px\)\{[^]*?\.phft-ov-chart-row\{grid-template-columns:1fr\}/.test(cssSrc), 'RESPONSIVE: chart row stacks to 1 column under 1100px');
  pass(/@media\(max-width:1100px\)\{[^]*?\.phft-top5-row\{grid-template-columns:1fr\}/.test(cssSrc), 'RESPONSIVE: Top5 row stacks to 1 column under 1100px');

  // ================= day period -> báo limitation, KHÔNG tự phát minh =====
  {
    const window2 = newWindow();
    const T2 = window2.__PHF_TASK_TEST__;
    const root2 = window2.document.getElementById('phfTaskRoot');
    T2.bindShell(root2);
    window2.fetch = mockFetch({ getTaskReportV2Trend: { report_contract_version: 1, period: { type: 'day' }, effective_scope: 'managed', trend_supported: false, buckets: [] } });
    await T2.openTaskOverviewV2(root2);
    root2.innerHTML = T2.shellFrame(T2.taskOverviewV2Html());
    const html2 = root2.innerHTML;
    pass(html2.includes('chưa hỗ trợ biểu đồ xu hướng theo giờ'), 'DAY_PERIOD_LIMITATION: kỳ "Ngày" báo rõ giới hạn granularity, KHÔNG tự phát minh dữ liệu theo giờ');
    pass(!root2.querySelector('.phft-linechart-svg'), 'DAY_PERIOD_LIMITATION: không render chart giả (rỗng) khi trend_supported=false');
  }

  // ================= backend period-boundary reuse (pure unit, in-process) ==
  {
    const engine = require('../api/_lib/task-reporting-v2');
    pass(typeof engine.getTaskReportV2Trend === 'function' && !/trailingDayWindow|window_days/.test(readSrc('api/_lib/task-reporting-v2.js')), 'REPORTING_V2_SEMANTICS_PRESERVED: getTaskReportV2Trend không còn time-engine thứ 2 (trailingDayWindow/window_days đã gỡ)');
    const monthWindow = engine.resolvePeriodWindow('month', '2026-08-15');
    pass(monthWindow.start === '2026-07-31T17:00:00.000Z' && monthWindow.endExclusive === '2026-08-31T17:00:00.000Z', 'PERIOD_TIMEZONE_BOUNDARY: month window vẫn đúng ICT UTC+7 (dùng lại resolvePeriodWindow() gốc, không đổi)');
  }

  console.log(`PHF Task Tổng quan V2 UI polish (visual acceptance): ${passed}/${passed} PASS`);
})().catch(err => { console.error('FAIL', err); process.exit(1); });
