'use strict';

/*
 * Batch 1A.2 (+ Effective Snapshot / Carry-Forward, cập nhật) — KNL Dashboard
 * period completeness, DETERMINISTIC coverage (lib/knl-dashboard.js:
 * computePeriodCoverage). NO percentage threshold: isComplete = expectedCount>0
 * && coveredCount===expectedCount — coveredCount giờ đếm nhân sự RESOLVE ĐƯỢC
 * effective compensation tại period đó (carry-forward từ row ACTIVE gần nhất
 * <= period, qua resolveEffectiveCompensationMap), KHÔNG còn đòi hỏi row
 * đúng payroll_period exact. Test 2/3/6 đã được VIẾT LẠI so với bản 1A.2 gốc
 * vì premise cũ ("thiếu đúng row tháng này = partial") không còn đúng theo
 * business rule đã chốt lại — coi carry-forward hợp lệ là "thiếu dữ liệu"
 * chính là bug đã audit ra. Test 1/4/5/7/8 giữ nguyên vì không phụ thuộc
 * exact-period (single-period data hoặc future-period, không có gì để
 * carry-forward). In-memory Supabase mock only, không chạm Production.
 *
 * Periods are computed relative to the real host clock (not hard-coded
 * strings) so the future/past semantics stay correct regardless of when this
 * suite runs.
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const assert = require('assert');
const supabasePath = require.resolve('@supabase/supabase-js');
const peoplePath = require.resolve('../api/_lib/knl-people');
const permissionsPath = require.resolve('../api/_lib/knl-permissions');
const scopePath = require.resolve('../api/_lib/knl-scope');
const dashboardPath = require.resolve('../api/_lib/knl-dashboard');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function ym(offsetMonths) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offsetMonths);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  return y + '-' + (m < 10 ? '0' + m : '' + m);
}

function makeTableFactory(rows) {
  return function tableQuery() {
    const filters = [];
    let orderSpecs = [], limitN = null, inFilter = null, singleMode = null;
    const q = {
      select() { return q; },
      eq(f, v) { filters.push(r => String(r[f]) === String(v)); return q; },
      in(f, values) { inFilter = { f, values: values.map(String) }; return q; },
      order(f, o) { orderSpecs.push({ f, asc: !(o && o.ascending === false) }); return q; },
      limit(n) { limitN = n; return q; },
      maybeSingle() { singleMode = 'maybe'; return q; },
      single() { singleMode = 'single'; return q; },
      then(resolve, reject) {
        try {
          let matched = rows.filter(r => filters.every(fn => fn(r)));
          if (inFilter) matched = matched.filter(r => inFilter.values.includes(String(r[inFilter.f])));
          orderSpecs.forEach(spec => { matched = matched.slice().sort((a, b) => (a[spec.f] < b[spec.f] ? -1 : a[spec.f] > b[spec.f] ? 1 : 0) * (spec.asc ? 1 : -1)); });
          if (limitN != null) matched = matched.slice(0, limitN);
          if (singleMode) { resolve({ data: clone(matched[0] || null), error: null }); return; }
          resolve({ data: clone(matched), error: null });
        } catch (e) { (reject || (err => Promise.reject(err)))(e); }
      }
    };
    return q;
  };
}

// 8 người "Kinh doanh" (trong scope của Tiên) + 2 người "Kho vận" (ngoài scope
// Tiên, chỉ Admin/Giám đốc mới thấy) — dùng cho Test 5 (scope) và Test 6 (filter).
const EMPLOYEES = [];
for (let i = 1; i <= 8; i++) EMPLOYEES.push({ employee_id: 'e-' + i, employee_code: 'SALE' + String(i).padStart(2, '0'), full_name: 'NV Sale ' + i, title: 'Nhân viên', position: null, department: 'Kinh doanh', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' });
for (let i = 1; i <= 2; i++) EMPLOYEES.push({ employee_id: 'w-' + i, employee_code: 'WH' + String(i).padStart(2, '0'), full_name: 'NV Kho ' + i, title: 'Nhân viên', position: null, department: 'Kho vận', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' });
const ALL_CODES = EMPLOYEES.map(e => e.employee_code);
const SALE_CODES = ALL_CODES.filter(c => c.startsWith('SALE'));

function assignmentsForPeriod(period, codes, total) {
  return codes.map(code => ({ employee_code: code, payroll_period: period, reference_total: total, status: 'ACTIVE' }));
}

const STATE = { grants: [], employees: EMPLOYEES, assignments: [], competency: [] };

function buildSupabaseMock() {
  return {
    createClient() {
      return {
        from(table) {
          if (table === 'knl_permission_grants') return makeTableFactory(STATE.grants)();
          if (table === 'employee_profiles') return makeTableFactory(STATE.employees)();
          if (table === 'knl_employee_compensation_assignments') return makeTableFactory(STATE.assignments)();
          if (table === 'knl_employee_competency_assignments') return makeTableFactory(STATE.competency)();
          throw new Error('Unexpected table in mock: ' + table);
        },
        rpc() { throw new Error('RPC not mocked (write path out of scope)'); }
      };
    }
  };
}

function loadLibsWithMock() {
  const Module = require('module');
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === '@supabase/supabase-js') return supabasePath;
    return originalResolve.call(this, request, ...rest);
  };
  try {
    [peoplePath, permissionsPath, scopePath, dashboardPath].forEach(p => delete require.cache[p]);
    require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
    return require(dashboardPath);
  } finally {
    Module._resolveFilename = originalResolve;
  }
}

function grant(id, capabilities, peopleScope = { type: 'all_company', values: [] }) {
  STATE.grants.push({ id: 'grant-' + id, account_id: id, is_active: true, preset_code: 'CUSTOM', capabilities, people_scope: peopleScope });
}
function session(id) { return { role: 'learner', account: { id, employeeCode: id.toUpperCase() }, employeeCode: id.toUpperCase() }; }

grant('director', { dashboard_view: true, income_view: true, incomeScope: { type: 'all_company', values: [] } });
grant('tien', { dashboard_view: true, income_view: true, incomeScope: { type: 'department', values: ['Kinh doanh'] } }, { type: 'department', values: ['Kinh doanh'] });

const { getKnlDashboardOverview, computePeriodCoverage } = loadLibsWithMock();

async function run() {
  const PREV1 = ym(-1), CURRENT = ym(0), NEXT1 = ym(1);

  // ---- Unit test of computePeriodCoverage() intersection guard (Test 4) ----
  // 10 expected, table has 11 rows where 1 employee_code is NOT in the
  // expected set (simulating a stale/out-of-scope row bypassing normal .in()
  // query filtering) -> coveredCount must be capped at the intersection (10),
  // not 11, and coverageStatus must still be 'complete' (not overcounted).
  {
    const expected = new Set(SALE_CODES.concat(['WH01', 'WH02'])); // 10 expected
    const rows = expected.size ? [...expected].map(c => ({ employee_code: c, payroll_period: '2026-01' })) : [];
    rows.push({ employee_code: 'GHOST99', payroll_period: '2026-01' }); // stale/out-of-scope row
    const coverage = computePeriodCoverage('2026-01', rows, expected);
    assert.strictEqual(coverage.expectedCount, 10, 'Test 4: expectedCount must be the scoped population size (10), not table row count');
    assert.strictEqual(coverage.coveredCount, 10, 'Test 4: coveredCount must be the INTERSECTION with expected, not raw row count (11)');
    assert.strictEqual(coverage.coverageStatus, 'complete', 'Test 4: extra stale row must not push status past complete (never "11/10")');
    assert.strictEqual(coverage.missingCount, 0, 'Test 4: no missing when intersection already covers 100% of expected');
  }

  // ---- Test 1: 100% coverage — default period + working comparison ----
  STATE.assignments = [].concat(
    assignmentsForPeriod(PREV1, ALL_CODES, 10000000),
    assignmentsForPeriod(CURRENT, ALL_CODES, 11000000)
  );
  const t1 = await getKnlDashboardOverview(session('director'));
  assert.strictEqual(t1.meta.currentPeriod, CURRENT, 'Test 1: default period must be the current, fully-covered period');
  assert.strictEqual(t1.meta.currentPeriodStatus, 'complete', 'Test 1: full coverage (10/10) must report complete');
  assert.strictEqual(t1.meta.expectedCount, 10, 'Test 1: expectedCount must equal the income-scope population');
  assert.strictEqual(t1.meta.coveredCount, 10, 'Test 1: coveredCount must equal expectedCount when every expected employee has a row');
  assert.strictEqual(t1.meta.missingCount, 0, 'Test 1: no missing when complete');
  assert.strictEqual(t1.meta.previousPeriod, PREV1, 'Test 1: complete previous period must resolve for comparison');
  assert.strictEqual(t1.meta.comparisonAvailable, true, 'Test 1: comparison must be available when both periods are complete');
  assert.strictEqual(t1.kpis.totalFund, 10 * 11000000, 'Test 1: KPI must reflect the complete current period exactly');
  const deptRow = t1.deptComparison.find(d => d.department === 'Kinh doanh');
  assert(deptRow.deltaPct != null, 'Test 1: a real, non-null delta must be computable when both periods are complete');
  assert.strictEqual(Math.round(deptRow.deltaPct * 10) / 10, 10, 'Test 1: delta must be the real, deterministic +10% (11M vs 10M), not fabricated');

  // ---- Test 2 (REWRITTEN): genuinely-missing employee (never assigned at
  // ANY period, not just this one) must still report partial — coveredCount
  // 9/10 is real, not a carry-forward artifact. Employee WH02 has NO row at
  // PREV1 either, so there is nothing to carry forward from.
  const MISSING_CODE = ALL_CODES[9]; // WH02
  const PRESENT_CODES = ALL_CODES.filter(c => c !== MISSING_CODE);
  STATE.assignments = [].concat(
    assignmentsForPeriod(PREV1, PRESENT_CODES, 10000000),
    assignmentsForPeriod(CURRENT, PRESENT_CODES, 11000000) // WH02 never assigned, ever
  );
  const t2 = await getKnlDashboardOverview(session('director'), { period: CURRENT });
  assert.strictEqual(t2.meta.currentPeriod, CURRENT, 'Test 2: explicit request must be honored');
  assert.strictEqual(t2.meta.currentPeriodStatus, 'partial', 'Test 2: genuinely-missing employee (no ACTIVE row at any period) must report partial, not complete');
  assert.strictEqual(t2.meta.expectedCount, 10, 'Test 2: expectedCount must stay the full scope population');
  assert.strictEqual(t2.meta.coveredCount, 9, 'Test 2: coveredCount must be exactly 9 (WH02 never resolves via carry-forward — nothing to carry)');
  assert.strictEqual(t2.meta.missingCount, 1, 'Test 2: missingCount must be exactly 1 — genuinely missing, not a carry-forward gap');
  assert.strictEqual(t2.meta.comparisonAvailable, false, 'Test 2: partial current period must disable comparison');
  assert.strictEqual(t2.meta.previousPeriod, null, 'Test 2: previousPeriod must be null when current is not complete');
  t2.deptComparison.forEach(d => assert.strictEqual(d.deltaPct, null, 'Test 2: no deltaPct anywhere while current period is partial'));

  // ---- Test 3 (REWRITTEN — was "1/10 sparse must never become default";
  // that premise is now WRONG under carry-forward and was exactly the bug
  // this batch fixes). 1 employee has an explicit CURRENT change; the other
  // 9 carry forward unchanged from PREV1 -> CURRENT is genuinely complete
  // (10/10 resolvable) and MUST become the default, not be skipped. ----
  STATE.assignments = [].concat(
    assignmentsForPeriod(PREV1, ALL_CODES, 10000000),
    assignmentsForPeriod(CURRENT, ALL_CODES.slice(0, 1), 12000000) // only SALE01 changed this period
  );
  const t3 = await getKnlDashboardOverview(session('director'));
  assert.strictEqual(t3.meta.currentPeriod, CURRENT, 'Test 3: CURRENT must become the default — the other 9 carry-forward validly from PREV1, this is NOT a sparse/missing period');
  assert.strictEqual(t3.meta.currentPeriodStatus, 'complete', 'Test 3: carry-forward makes CURRENT genuinely 10/10 complete');
  assert.strictEqual(t3.meta.coveredCount, 10, 'Test 3: coveredCount must be 10 — 1 explicit + 9 carried forward, not 1');
  assert.strictEqual(t3.meta.missingCount, 0, 'Test 3: nobody genuinely missing — carry-forward resolves the other 9');
  assert.strictEqual(t3.kpis.totalFund, 12000000 + 9 * 10000000, 'Test 3: KPI must mix the 1 explicit new value with the 9 carried-forward values, not silently drop them');
  const t3SaleRow = t3.drillDown['Kinh doanh'].find(r => r.employeeCode === 'SALE02');
  assert.strictEqual(t3SaleRow.currentIncome, 10000000, 'Test 3: an unchanged employee (SALE02, no CURRENT row) must show their carried-forward PREV1 value in drillDown, not null/missing');

  // ---- Test 5: scope — expected/covered computed on actor's own incomeScope ----
  STATE.assignments = [].concat(
    assignmentsForPeriod(CURRENT, ALL_CODES, 10000000) // full company, 10/10
  );
  const tienView = await getKnlDashboardOverview(session('tien'));
  assert.strictEqual(tienView.meta.expectedCount, 8, 'Test 5: Tien (Kinh doanh only) expected population must be 8, not company-wide 10');
  assert.strictEqual(tienView.meta.coveredCount, 8, 'Test 5: Tien coverage must be computed only within her own incomeScope');
  assert.strictEqual(tienView.meta.currentPeriodStatus, 'complete', 'Test 5: scoped-complete must not be blocked by out-of-scope headcount');
  assert.deepStrictEqual(tienView.deptComparison.map(d => d.department), ['Kinh doanh'], 'Test 5: no leak of Kho vận headcount into Tien scoped view');
  const directorSameCurrent = await getKnlDashboardOverview(session('director'));
  assert.strictEqual(directorSameCurrent.meta.expectedCount, 10, 'Test 5: Director (all_company) expected population must be the full 10');

  // ---- Test 6: UI department/branch/title/grade filter must NOT change
  // completeness. Kho vận (WH01/WH02) genuinely NEVER assigned at any period
  // (not just missing this month) so carry-forward cannot mask it — the
  // company-wide 8/10 partial is real and must stay real regardless of which
  // department the UI filter is scoped to. ----
  STATE.assignments = [].concat(
    assignmentsForPeriod(PREV1, SALE_CODES, 10000000),
    assignmentsForPeriod(CURRENT, SALE_CODES, 11000000) // Kinh doanh (8) fully covered, Kho vận (2) never assigned, ever
  );
  const unfiltered = await getKnlDashboardOverview(session('director'), { period: CURRENT });
  assert.strictEqual(unfiltered.meta.currentPeriodStatus, 'partial', 'Test 6: unfiltered company view must be partial (8/10, Kho vận genuinely never assigned)');
  const filteredToSales = await getKnlDashboardOverview(session('director'), { period: CURRENT, department: 'Kinh doanh' });
  assert.strictEqual(filteredToSales.meta.currentPeriodStatus, 'partial', 'Test 6: filtering the UI to a fully-covered department must NOT flip company-wide period status to complete');
  assert.strictEqual(filteredToSales.meta.expectedCount, 10, 'Test 6: expectedCount must stay the full incomeScope population, unaffected by the department filter');
  assert.strictEqual(filteredToSales.meta.coveredCount, 8, 'Test 6: coveredCount must stay computed against the full scope, not the filtered subset');

  // ---- Test 7: future period at 100% coverage is still "future", never default/complete ----
  STATE.assignments = [].concat(
    assignmentsForPeriod(CURRENT, ALL_CODES, 10000000),
    assignmentsForPeriod(NEXT1, ALL_CODES, 12000000) // full coverage but next month
  );
  const t7Default = await getKnlDashboardOverview(session('director'));
  assert.strictEqual(t7Default.meta.currentPeriod, CURRENT, 'Test 7: default must not silently promote a future period even at 100% coverage');
  const t7Explicit = await getKnlDashboardOverview(session('director'), { period: NEXT1 });
  assert.strictEqual(t7Explicit.meta.currentPeriodIsFuture, true, 'Test 7: explicitly viewed future period must be flagged future');
  assert.strictEqual(t7Explicit.meta.currentPeriodStatus, 'future', 'Test 7: future must win the status label even with full row coverage');
  assert.strictEqual(t7Explicit.meta.comparisonAvailable, false, 'Test 7: future period must never enable a standard comparison');

  // ---- Test 8: no complete period at all — safe technical fallback ----
  STATE.assignments = assignmentsForPeriod(CURRENT, ALL_CODES.slice(0, 2), 1000000); // 2/10 only, nothing else
  const t8 = await getKnlDashboardOverview(session('director'));
  assert.strictEqual(t8.meta.currentPeriod, CURRENT, 'Test 8: with no complete period anywhere, fallback must still show the nearest period with data');
  assert.strictEqual(t8.meta.currentPeriodStatus, 'partial', 'Test 8: fallback period must be honestly labeled partial, never called complete');
  assert.strictEqual(t8.meta.comparisonAvailable, false, 'Test 8: no comparison possible with no complete period available');
  assert(t8.kpis.totalHeadcount >= 0 && !Number.isNaN(t8.kpis.totalHeadcount), 'Test 8: dashboard must not crash and must still render a usable KPI shape');

  console.log('ALL PASS — KNL Dashboard Batch 1A.2 deterministic period coverage');
}

run().catch(err => { console.error(err); process.exit(1); });
