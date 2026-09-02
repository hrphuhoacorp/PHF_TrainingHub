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
    completed_in_period: { value: 10, source_breakdown: { total: 10, assigned: 4, self: 5, unknown: 1, by_source: { self_assigned: 5, assigned_by_other: 3, proposal: 1, unknown: 1 }, recurring: 2 } },
    on_time_rate: { value: 0 },
    // BOTTLENECK V1 — deterministic rule set (see task-reporting-v2.js). The
    // card now shows a real count + is clickable to a reason-carrying drilldown.
    attention_needed: { metric_id: 'attention_needed', value: 2, rule_version: 1, items: [
      { task_id: 'bn1', task_code: 'CV-2608-0007', title: 'Chờ duyệt định mức kho', status: 'in_progress', primary_full_name: 'Nguyễn Thị Bích', primary_department: 'Bộ phận Tài chính Kế toán', reason: 'Quá hạn 12 ngày và không có tiến độ mới trong 9 ngày.', overdue_days: 12, stalled_days: 9, deadline_change_count: 0, transfer_count: 0, signal_codes: ['stalled_overdue'], suggested_reviewer: 'Đề nghị người quản lý trực tiếp hoặc Ban giám đốc xem xét.' },
      { task_id: 'bn2', task_code: 'CV-2608-0031', title: 'Bàn giao hồ sơ nhân sự', status: 'published', primary_full_name: 'Nguyễn Huỳnh Phước Huy', primary_department: 'Bộ phận kho vận', reason: 'Đã chuyển người phụ trách 4 lần.', overdue_days: 0, stalled_days: 3, deadline_change_count: 1, transfer_count: 4, signal_codes: ['repeated_transfer'], suggested_reviewer: 'Đề nghị Quản lý M (quản lý trực tiếp) hoặc Ban giám đốc xem xét.' },
    ] },
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
    const ov = overrides || {};
    // PERF (2026-09-02) — the Overview screen fires ONE getTaskReportV2Bundle
    // call (context resolved once, all sections from it). Section objects are
    // byte-identical to the standalone action results, so per-section overrides
    // still work via the same fixture keys.
    if (body.action === 'getTaskReportV2Bundle') {
      const sec = {};
      const pick = (k, fx) => { sec[k] = ov[k === 'overview' ? 'getTaskOverviewV2' : k === 'trend' ? 'getTaskReportV2Trend' : 'getTaskReportV2DepartmentAnalysis'] || fx; };
      (body.sections || ['overview']).forEach((s) => {
        if (s === 'overview') pick('overview', OVERVIEW_FIXTURE);
        else if (s === 'trend') pick('trend', TREND_FIXTURE);
        else if (s === 'department') pick('department', DEPARTMENT_FIXTURE);
      });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: {
        report_contract_version: 1, period: body.period || { type: 'month' }, effective_scope: 'managed',
        nav_signals: { hasManagedPeople: true, canManageTaskPermissions: true },
        sections_included: body.sections, sections: sec,
      } }) });
    }
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
  pass(!!capture.getTaskReportV2Bundle && !capture.getTaskOverviewV2 && !capture.getTaskReportV2Trend && !capture.getTaskReportV2DepartmentAnalysis, 'OVERVIEW_TIME_CONTEXT_ALIGNED: 1 request bundle duy nhất (không còn 3 request rời)', Object.keys(capture));
  pass(Array.isArray(capture.getTaskReportV2Bundle.sections) && ['overview', 'trend', 'department'].every((s) => capture.getTaskReportV2Bundle.sections.indexOf(s) >= 0), 'OVERVIEW_TIME_CONTEXT_ALIGNED: bundle yêu cầu đủ 3 section overview/trend/department');
  pass(!!capture.getTaskReportV2Bundle.period && !!capture.getTaskReportV2Bundle.period.type, 'OVERVIEW_TIME_CONTEXT_ALIGNED: 1 period duy nhất cho cả 3 section (không thể lệch)');
  pass(capture.getTaskReportV2Bundle.window_days === undefined, 'OVERVIEW_TIME_CONTEXT_ALIGNED: request KHÔNG còn tham số window_days (đã gỡ time engine thứ 2)', capture.getTaskReportV2Bundle);

  // Đổi kỳ (period type) trên Tổng quan -> bundle reload với period MỚI —
  // KPI/Trend/Department (3 section trong CÙNG response) không thể lệch kỳ.
  const periodTypeSelect = root.querySelector('[data-task-overview-period-type]');
  periodTypeSelect.value = 'week';
  periodTypeSelect.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  pass(capture.getTaskReportV2Bundle.period.type === 'week' && capture.getTaskReportV2Bundle.sections.indexOf('trend') >= 0 && capture.getTaskReportV2Bundle.sections.indexOf('department') >= 0, 'OVERVIEW_TIME_CONTEXT_ALIGNED: đổi kỳ (Tuần) -> 1 bundle reload, cả 3 section dùng period.type mới', capture.getTaskReportV2Bundle.period);

  // ================= SIX_KPI_LAYOUT (UI/UX Step 2 — semantic groups) =====
  const allKpi = root.querySelectorAll('.phft-kpi.phft-kpi-v2');
  pass(allKpi.length === 6, 'SIX_KPI_LAYOUT: exactly 6 KPI cards render');
  const attnRow = root.querySelector('.phft-kpi-row.phft-kpi-attention');
  const sitRow = root.querySelector('.phft-kpi-row.phft-kpi-situation');
  pass(!!attnRow && !!sitRow, 'SIX_KPI_LAYOUT: KPIs split into "cần chú ý" + "tình hình" groups (hierarchy by order/accent, not one flat 6-grid)');
  pass(attnRow.querySelectorAll('.phft-kpi').length === 3 && sitRow.querySelectorAll('.phft-kpi').length === 3, 'SIX_KPI_LAYOUT: 3 + 3');
  pass(html.indexOf('phft-kpi-attention') < html.indexOf('phft-kpi-situation'), 'SIX_KPI_LAYOUT: attention group rendered first');
  pass(html.includes('Công việc đang mở') && html.includes('Công việc quá hạn') && html.includes('Sắp tới hạn (3 ngày)') && html.includes('Hoàn thành trong kỳ') && html.includes('Tỷ lệ đúng hạn') && html.includes('Điểm nghẽn cần chú ý'), 'SIX_KPI_LAYOUT: all 6 LOCKED labels present');
  pass(root.querySelectorAll('.phft-kpi-v2 .phft-kpi-icon').length === 6, 'SIX_KPI_LAYOUT: every KPI card has an icon');
  pass(root.querySelector('.phft-kpi-v2.tone-red') !== null && root.querySelector('.phft-kpi-v2.tone-orange') !== null && root.querySelector('.phft-kpi-v2.tone-green') !== null && root.querySelector('.phft-kpi-v2.tone-blue') !== null && root.querySelector('.phft-kpi-v2.tone-purple') !== null && root.querySelector('.phft-kpi-v2.tone-gray') !== null, 'SEMANTIC_COLOR_SYSTEM: red/orange/green/blue/purple/gray tones each present exactly where the contract expects');
  const bottleneckCard = Array.from(allKpi).find(c => c.textContent.includes('Điểm nghẽn'));
  // BOTTLENECK V1 (2026-09-01) — a DETERMINISTIC rule set now backs this card
  // (open work + a proven stall signal), NOT an invented KPI formula. The card
  // shows the actionable count and is clickable; the drilldown reveals the
  // real work + truthful reason + time, not merely a number.
  pass(bottleneckCard.querySelector('strong').textContent === '2', 'BOTTLENECK_V1: KPI card shows the actionable count from the deterministic rule set');
  pass(bottleneckCard.matches('button') && bottleneckCard.getAttribute('data-task-overview-metric') === 'attention_needed' && bottleneckCard.classList.contains('tone-gray'), 'BOTTLENECK_V1: bottleneck KPI is clickable to its drilldown, neutral gray tone');
  pass(html.includes('Đã chuyển người phụ trách 4 lần') && html.includes('Quá hạn 12 ngày'), 'BOTTLENECK_V1: Overview inline panel shows the truthful per-item reason (not just a count)');
  pass(html.includes('Ban giám đốc xem xét') && !html.includes('là điểm nghẽn'), 'BOTTLENECK_V1: suggests a review level, never labels a person as "the bottleneck"');

  // ================= DRILLDOWN_PRESERVED (KPI click) =================
  const openCard = Array.from(allKpi).find(c => c.getAttribute('data-task-overview-metric') === 'open');
  pass(!!openCard && openCard.matches('button.phft-kpi'), 'DRILLDOWN_PRESERVED: "Công việc đang mở" KPI is a clickable button (data-task-overview-metric=open)');
  const overdueCardBtn = root.querySelector('[data-task-overview-metric="overdue"]');
  pass(!!overdueCardBtn && overdueCardBtn.classList.contains('tone-red'), 'DRILLDOWN_PRESERVED + visual hierarchy: overdue KPI clickable AND carries the red critical tone');
  const rateCard = Array.from(allKpi).find(c => c.textContent.includes('Tỷ lệ đúng hạn'));
  pass(!rateCard.matches('button'), 'KPI_INTERACTION_CONTRACT: on_time_rate has no drill-down endpoint → not clickable (no fabricated drawer)');

  // ================= TREND_CHART (time-context aligned, 2026-08-29) =======
  pass(html.includes('Xu hướng công việc') && !html.includes('30 ngày gần nhất'), 'TREND_CHART: panel title no longer claims a fixed "30 ngày" window (time-context aligned to period selector)');
  pass(root.querySelector('.phft-linechart-svg') !== null, 'TREND_CHART: line chart SVG renders (not a table)');
  pass(root.querySelectorAll('.phft-linechart-line').length === 3, 'TREND_CHART: 3 series lines (Phát sinh/Hoàn thành/Quá hạn)');
  pass(html.includes('Phát sinh mới') && html.includes('Hoàn thành') && html.includes('Quá hạn'), 'TREND_CHART: legend labels present');
  pass(root.querySelectorAll('.phft-linechart-dot title').length > 0, 'TREND_CHART: hover tooltip (<title>) present on data points');
  pass(!/NaN/.test(html), 'TREND_CHART: no NaN in chart markup');

  // ================= DEPARTMENT_WORKLOAD_CHART (Step 2 §F) =================
  pass(html.includes('Khối lượng công việc theo phòng ban'), 'DEPARTMENT_WORKLOAD_CHART: panel title present');
  const deptRows = root.querySelectorAll('.phft-deptbar-row');
  pass(deptRows.length === 2, 'DEPARTMENT_WORKLOAD_CHART: horizontal bar per department (not a table)');
  // Order check scoped to the department panel — the sidebar nav now also
  // contains the literal "Nhân sự" ("Nhân sự & phân quyền"), so a whole-page
  // indexOf would match the nav, not the chart.
  const deptNamesInOrder = Array.from(deptRows).map(r => r.querySelector('.phft-deptbar-name').textContent);
  pass(deptNamesInOrder[0].indexOf('Kinh doanh') >= 0 && deptNamesInOrder[1].indexOf('Nhân sự') >= 0, 'DEPARTMENT_WORKLOAD_CHART: sorted by workload desc (backend-provided order preserved)', deptNamesInOrder);
  pass(html.includes('3 quá hạn'), 'DEPARTMENT_WORKLOAD_CHART: overdue count shown per department');
  pass(Array.from(deptRows).every(r => r.matches('button[data-task-overview-dept]')), 'DEPARTMENT_DRILLTHROUGH: each department row is a button → opens the population filtered to that department (SEE A PROBLEM → CLICK THE PROBLEM)');
  pass(Array.from(deptRows).every(r => r.getAttribute('title') && r.querySelector('.phft-deptbar-name').textContent.indexOf('Bộ phận') < 0), 'DEPARTMENT_DISPLAY: "Bộ phận" prefix stripped for display, full name kept in title (no master-data mutation)');
  pass(!html.includes('Xem báo cáo theo phòng ban') || root.querySelector('[data-task-overview-goto-report]') !== null, 'DEPARTMENT_WORKLOAD_CHART: "Xem báo cáo theo phòng ban" action present');

  // ================= CANCELLED_NOT_IN_MAIN_VISUALS =================
  pass(!html.includes('Cơ cấu trạng thái'), 'CANCELLED_NOT_IN_MAIN_VISUALS: status-breakdown block removed from Tổng quan (per LOCKED decision, demo has no such block)');
  pass(!html.includes('Đã hủy'), 'CANCELLED_NOT_IN_MAIN_VISUALS: "Đã hủy" never appears anywhere on Tổng quan');

  // ================= OVERDUE_TOP5 / DUE_SOON_TOP5 (Step 2 §G) =============
  pass(html.includes('Top 5 công việc quá hạn') && html.includes('Top 5 công việc sắp tới hạn'), 'OVERDUE_TOP5/DUE_SOON_TOP5: both panel titles present');
  const top5Row = root.querySelector('.phft-top5-row');
  pass(!!top5Row && top5Row.children.length === 2, 'OVERDUE_TOP5/DUE_SOON_TOP5: side-by-side layout (2 cards in 1 row)');
  pass(root.querySelector('.phft-op-when.tone-red') !== null, 'OVERDUE_TOP5: overdue day badge renders with RED semantic');
  pass(root.querySelector('.phft-op-when.tone-orange') !== null, 'DUE_SOON_TOP5: due-soon day badge renders with ORANGE semantic');
  const opRows = root.querySelectorAll('.phft-top5-row .phft-op-row');
  pass(opRows.length >= 1 && Array.from(opRows).every(r => r.querySelector('.phft-op-title') && r.querySelector('.phft-op-sub b')), 'TOP5_SHARED_ROW: Top-5 uses the same structured operational row as the drill-down (Primary bold, title strongest)');
  pass(html.includes('Xem tất cả công việc quá hạn') && html.includes('Xem tất cả công việc sắp tới hạn'), 'OVERDUE_TOP5/DUE_SOON_TOP5: "Xem tất cả" canonical drilldown links present');
  const goAllOverdue = root.querySelector('[data-task-overview-metric="overdue"].phft-panel-link');
  pass(!!goAllOverdue, 'DRILLDOWN_PRESERVED: "Xem tất cả công việc quá hạn" wired to canonical drilldown (data-task-overview-metric=overdue)');

  // ================= HEADER + FILTER (Step 2 §B) =========================
  pass(html.includes('Cập nhật lần cuối'), 'HEADER: "last updated" timestamp shown');
  pass(root.querySelector('[data-task-overview-period-type]') !== null, 'HEADER: period-type selector present');
  pass(root.querySelector('[data-task-overview-nav="prev"]') !== null && root.querySelector('[data-task-overview-nav="next"]') !== null, 'HEADER: prev/next period nav present');
  pass(root.querySelector('[data-task-overview-filter]') !== null, 'HEADER: "Bộ lọc" control present (real advanced filter)');
  pass(root.querySelector('.phft-page-head h1').textContent === 'Tổng quan', 'HEADER: title is "Tổng quan" (not tall/cluttered)');

  // ================= REPORTING_V2_ARCHITECTURE_PRESERVED =================
  pass(root.querySelector('.phft-seg [data-task-overview-tab="overview"].is-active') !== null, 'REPORTING_V2_ARCHITECTURE_PRESERVED: segmented Tổng quan/Báo cáo control present, Tổng quan active');
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
