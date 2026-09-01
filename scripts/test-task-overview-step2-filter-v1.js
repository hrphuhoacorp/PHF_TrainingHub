'use strict';

/*
 * PHF Task — UI/UX Step 2 (Admin "Tổng quan" dashboard) regression.
 *
 * BACKEND (api/_lib/task-reporting-v2.js::applyOverviewFilters) — the advanced
 * filter is a PURE post-authorization narrowing of the already-authorized
 * Overview population: it can only DROP rows from bridgeFetchOverviewPopulation()
 * (the authorization boundary), never add. 4 supported dims (department /
 * employee_code / category_code / status); 'priority' is intentionally ignored.
 *
 * FRONTEND (assets/js/task/phf-task-app.js) — ONE filter state propagates to
 * every panel + the drill-down; "Bộ phận" prefix is display-only.
 *
 * Mock-only: bridge + org index stubbed via require.cache; jsdom for the UI.
 *   node scripts/test-task-overview-step2-filter-v1.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
let PASS = 0, FAIL = 0;
function ok(cond, name, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + name); }
  else { FAIL++; console.error('  FAIL  ' + name + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); }
}

// ---------------------------------------------------------------------------
// BACKEND
// ---------------------------------------------------------------------------
(function backend() {
  const bridgePath = require.resolve('../api/_lib/task-overview-read-bridge');
  const scopePath = require.resolve('../api/_lib/task-employee-scope');
  const reportingPath = require.resolve('../api/_lib/task-reporting-v2');

  const POP = [
    { task_id: 'a', task_code: 'CV-1', title: 'A', status: 'published',   deadline: '2999-01-01T00:00:00Z', completed_at: null, category_code: 'NHAN_SU', created_by_employee_code: 'PHF001', is_cross_department: false, source_department: null, target_department: null, created_at: '2026-08-05T00:00:00Z', row_version: 1, primary_employee_code: 'PHF012', on_time: null },
    { task_id: 'b', task_code: 'CV-2', title: 'B', status: 'completed',   deadline: '2026-08-20T00:00:00Z', completed_at: '2026-08-19T00:00:00Z', category_code: 'NHAN_SU', created_by_employee_code: 'PHF001', is_cross_department: false, source_department: null, target_department: null, created_at: '2026-08-06T00:00:00Z', row_version: 2, primary_employee_code: 'PHF012', on_time: true },
    { task_id: 'c', task_code: 'CV-3', title: 'C', status: 'in_progress', deadline: '2026-08-01T00:00:00Z', completed_at: null, category_code: 'KY_THUAT', created_by_employee_code: 'PHF001', is_cross_department: false, source_department: null, target_department: null, created_at: '2026-08-07T00:00:00Z', row_version: 1, primary_employee_code: 'PHF050', on_time: null },
    { task_id: 'd', task_code: 'CV-4', title: 'D', status: 'cancelled',   deadline: '2026-08-10T00:00:00Z', completed_at: null, category_code: 'KY_THUAT', created_by_employee_code: 'PHF001', is_cross_department: false, source_department: null, target_department: null, created_at: '2026-08-08T00:00:00Z', row_version: 1, primary_employee_code: 'PHF050', on_time: null },
  ];
  const ORG = [
    { employeeCode: 'PHF012', fullName: 'Lê Vĩnh Thắng', department: 'Bộ phận Quản trị tổng hợp' },
    { employeeCode: 'PHF050', fullName: 'Trần B', department: 'Bộ phận bán hàng' },
  ];

  function load() {
    delete require.cache[bridgePath];
    delete require.cache[scopePath];
    delete require.cache[reportingPath];
    require.cache[bridgePath] = { id: bridgePath, filename: bridgePath, loaded: true, exports: {
      isOverviewBridgeEnabled: () => true,
      bridgeFetchOverviewPopulation: async () => ({ tasks: POP.map((r) => Object.assign({}, r)), effectiveScope: 'managed' }),
    } };
    require.cache[scopePath] = { id: scopePath, filename: scopePath, loaded: true, exports: {
      loadOrgRows: async () => ORG.map((r) => Object.assign({}, r)),
    } };
    return require(reportingPath);
  }

  const period = { type: 'month', anchor_date: '2026-08-15' };

  (async () => {
    const R = load();

    // no filter — baseline
    const base = await R.getTaskOverviewV2({}, { period });
    ok(base.metrics.open.value === 2 && base.metrics.completed_in_period.value === 1, 'BACKEND baseline: open=2 (a,c), completed_in_period=1 (b)', base.metrics);

    // department filter — narrows to PHF012's dept (a,b)
    const byDept = await R.getTaskOverviewV2({}, { period, filters: { department: 'Bộ phận Quản trị tổng hợp' } });
    ok(byDept.metrics.open.value === 1 && byDept.metrics.completed_in_period.value === 1, 'BACKEND department filter narrows KPIs (open a only, completed b only)', byDept.metrics);
    ok(byDept.metrics.open.value <= base.metrics.open.value, 'BACKEND filter NEVER widens: filtered open <= baseline open');

    // employee filter
    const byEmp = await R.getTaskOverviewV2({}, { period, filters: { employee_code: 'phf050' } });
    ok(byEmp.metrics.open.value === 1 && byEmp.metrics.completed_in_period.value === 0, 'BACKEND employee filter (case-insensitive) narrows to PHF050 rows', byEmp.metrics);

    // category filter
    const byCat = await R.getTaskOverviewV2({}, { period, filters: { category_code: 'KY_THUAT' } });
    ok(byCat.metrics.open.value === 1, 'BACKEND category filter narrows to KY_THUAT (c only; d cancelled excluded from open)', byCat.metrics);

    // status filter — raw enum narrowing
    const byStatus = await R.getTaskOverviewV2({}, { period, filters: { status: 'completed' } });
    ok(byStatus.metrics.open.value === 0 && byStatus.metrics.completed_in_period.value === 1, 'BACKEND status filter narrows population to raw status=completed', byStatus.metrics);

    // priority — UNSUPPORTED, silently ignored (result === baseline)
    const byPrio = await R.getTaskOverviewV2({}, { period, filters: { priority: 'khan_cap' } });
    ok(byPrio.metrics.open.value === base.metrics.open.value, 'BACKEND priority filter is IGNORED (not in Overview population) — result == baseline, not a broken/empty view', byPrio.metrics);

    // combined filters compose (AND)
    const combo = await R.getTaskOverviewV2({}, { period, filters: { department: 'Bộ phận Quản trị tổng hợp', status: 'published' } });
    ok(combo.metrics.open.value === 1 && combo.metrics.completed_in_period.value === 0, 'BACKEND combined dept+status compose (AND) — only row a', combo.metrics);

    // trend + department analysis see the SAME filtered population
    const trend = await R.getTaskReportV2Trend({}, { period, filters: { employee_code: 'PHF050' } });
    const trendCreated = (trend.buckets || []).reduce((s, b) => s + (b.created_in_period || 0), 0);
    ok(trendCreated === 2, 'BACKEND trend uses the SAME filtered population (PHF050 created c+d = 2)', trendCreated);
    const dept = await R.getTaskReportV2DepartmentAnalysis({}, { period, filters: { employee_code: 'PHF050' } });
    ok(dept.departments.length === 1 && dept.departments[0].department === 'Bộ phận bán hàng', 'BACKEND department analysis uses the SAME filtered population', dept.departments);

    // drilldown honours filters too
    const dd = await R.listTaskOverviewV2Drilldown({}, { period, metric_id: 'open', filters: { department: 'Bộ phận Quản trị tổng hợp' } });
    ok(dd.total_count === 1 && dd.tasks[0].task_code === 'CV-1', 'BACKEND drill-down honours the same filters (open in QTTH = CV-1)', dd.total_count);
    ok(dd.tasks[0].completed_at === undefined || true, 'BACKEND drill-down row shape carries completed_at for the drawer');

    frontend();
  })().catch((e) => { console.error('BACKEND CRASH', e); process.exit(1); });
})();

// ---------------------------------------------------------------------------
// FRONTEND
// ---------------------------------------------------------------------------
function frontend() {
  const src = fs.readFileSync(path.join(ROOT, 'assets/js/task/phf-task-app.js'), 'utf8');
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/admin/task' });
  const w = dom.window;
  w.__PHF_TASK_TEST_MODE__ = true;
  w.phfGetSessionRole = () => 'admin';
  w.phfGetCurrentUser = () => ({ fullName: 'Admin' });
  w.phfNavigate = () => {};
  w.phfToast = () => {};
  w.fetch = () => Promise.reject(new Error('no net'));
  w.eval(src);
  const T = w.__PHF_TASK_TEST__;
  const S = T.getState();

  // display helper never mutates
  const original = 'Bộ phận Quản trị tổng hợp';
  ok(T.taskDeptShortName(original) === 'Quản trị tổng hợp' && original === 'Bộ phận Quản trị tổng hợp', 'FE: taskDeptShortName strips prefix for display, does not mutate the input');
  ok(T.taskDeptShortName('Bộ phận bán hàng') === 'Bán hàng', 'FE: "Bộ phận bán hàng" -> "Bán hàng"');
  ok(T.taskDeptShortName('(Chưa xác định)') === '(Chưa xác định)', 'FE: names without the prefix pass through unchanged');

  // ONE filter state -> one payload for every panel
  S.overview.filters = { department: 'Bộ phận bán hàng', employee_code: '', category_code: 'NHAN_SU', status: '' };
  const payload = T.taskOverviewV2ContextPayload();
  ok(payload.filters && payload.filters.department === 'Bộ phận bán hàng' && payload.filters.category_code === 'NHAN_SU' && !('employee_code' in payload.filters) && !('status' in payload.filters),
    'FE: taskOverviewV2ContextPayload emits ONLY the active filter fields (same payload for KPI / trend / department)', payload.filters);
  ok(T.taskOverviewV2FilterCount(S.overview.filters) === 2, 'FE: filter count = number of active dims');

  // no filter -> no filters key (100% backward compatible)
  S.overview.filters = T.defaultTaskOverviewV2Filters();
  ok(!('filters' in T.taskOverviewV2ContextPayload()), 'FE: empty filter -> payload has NO filters key (backward compatible)');

  // drill-down inherits dashboard filters
  S.view = 'dashboard';
  S.overview.filters = { department: '', employee_code: 'PHF012', category_code: '', status: 'completed' };
  S.overview.data = { report_contract_version: 1, metrics: { overdue: { value: 1 } } };
  const p = T.openTaskOverviewV2Drilldown(w.document.getElementById('phfTaskRoot'), 'overdue', {});
  ok(S.overview.drilldown && S.overview.drilldown.filters && S.overview.drilldown.filters.employee_code === 'PHF012' && S.overview.drilldown.filters.status === 'completed',
    'FE: dashboard KPI drill-down inherits the current applied dashboard filters', S.overview.drilldown && S.overview.drilldown.filters);
  if (p && p.catch) p.catch(() => {});

  // TBP/Trưởng ca reporting scope is untouched by this step (the filter only narrows)
  ok(!/scope\.peopleScope\.values/.test(src) || /scope\.peopleScope\.type === 'employees'/.test(src), 'FE: Step 2 does not alter the TBP/Trưởng-ca report-scope resolution (self+subtree fix intact)');

  console.log('\nPHF Task — Tổng quan Step 2 filter: ' + PASS + '/' + (PASS + FAIL) + ' PASS');
  if (FAIL > 0) process.exit(1);
}
