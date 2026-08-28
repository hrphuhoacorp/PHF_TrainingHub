'use strict';

/*
 * PHF Task — REPORT-04A: employee-scoped completion drilldown parity fix.
 * Real dev DB, read-only, in-process require of api/_lib/task-reporting.js
 * (same methodology as scripts/test-task-reporting-v1.js). No new fixtures
 * created — reuses the 37 [REPORT-UI-TEST] fixtures already seeded plus the
 * pre-existing Report-03 fixtures, exactly as the fixture-seed gate left them.
 *
 * BUG (found by the fixture-seed gate, fixed here): getPersonPerformance()
 * attributes a completed task to whoever's task_events.completion actually
 * completed it (final completion event actor_employee_code), excluding
 * self-task. listTaskReportDrilldown()'s old employee_code filter matched
 * ANY active assignee (primary OR coordinator) instead — so a coordinator
 * on a task someone else completed would leak into that coordinator's
 * employee-scoped completion drilldown, breaking the documented
 * "Performance count == drilldown total_count" invariant.
 *
 * Root-cause fixture: CV-2608-0011 (fixture A5) — primary/completer=PHF004,
 * coordinators=[PHF012, PHF082] (multi-coordinator). Before the fix, PHF082's
 * completed_on_time drilldown wrongly included CV-2608-0011 (total_count=4
 * vs performance=3). This suite proves the fix and guards every locked
 * business rule the fix must NOT regress.
 */

const assert = require('assert');
require('dotenv').config();
require('./task-sandbox-guard'); // fail-closed: refuse to run unless SUPABASE_URL === PHF_HR sandbox
const reporting = require('../api/_lib/task-reporting');
const fixtures = require('./task-report-fixture-manifest');

let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }

function todayYmd() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const PERIOD_THIS_MONTH = { type: 'month', anchor_date: todayYmd() };
const S_PHF010 = { account: { employeeCode: 'PHF010' } }; // TRO_LY_GD — all_company scope, used as the report-viewing actor
const S_PHF082 = { account: { employeeCode: 'PHF082' } }; // nhan_vien preset — self-scope only, used for the permission negative test

// fixture A5 (canonical manifest): completed-on-time, primary/completer=PHF004,
// 2 coordinators=[PHF012, PHF082] — task_code is DB-assigned, resolve by role.
const A5_TASK_CODE = fixtures.requireSemantic(fixtures.load(), 'completedOnTimeCoordinatorFanout').task_code;

async function drilldown(session, metricId, extra) {
  return reporting.listTaskReportDrilldown(session, Object.assign({ metric_id: metricId, relation: 'received', scope: 'all_company', period: PERIOD_THIS_MONTH, limit: 50, offset: 0 }, extra || {}));
}
async function personAnalysis(session, extra) {
  return reporting.getTaskReportPersonAnalysis(session, Object.assign({ relation: 'received', scope: 'all_company', period: PERIOD_THIS_MONTH }, extra || {}));
}

(async () => {
  {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), { auth: { persistSession: false } });
    await fixtures.assertFresh(sb); // fail loudly + actionably if the [REPORT-UI-TEST] corpus drifted from the manifest
  }
  const person = await personAnalysis(S_PHF010);
  const perfByEmployee = new Map(person.performance.map(p => [p.employee_code, p]));
  const phf082Perf = perfByEmployee.get('PHF082');
  const phf004Perf = perfByEmployee.get('PHF004');
  const phf012Perf = perfByEmployee.get('PHF012');
  pass(!!phf082Perf && !!phf004Perf, 'SETUP: PHF082 and PHF004 both have Performance entries this month (fixture population present)');

  // ---- B. Post-fix: PHF082 completed_on_time drilldown == performance, CV-2608-0011 absent ----
  {
    const dd = await drilldown(S_PHF010, 'completed_on_time', { employee_code: 'PHF082' });
    pass(dd.total_count === phf082Perf.completed_on_time, 'B1: PHF082 completed_on_time drilldown total_count (' + dd.total_count + ') == Performance panel value (' + phf082Perf.completed_on_time + ')');
    pass(!dd.tasks.some(t => t.task_code === A5_TASK_CODE), 'B2: ' + A5_TASK_CODE + ' (A5, coordinator-only for PHF082) is NOT in PHF082\'s completed_on_time drilldown');
  }

  // ---- C. PHF004 (the real completer of A5) gets correct attribution ----
  {
    const dd = await drilldown(S_PHF010, 'completed_on_time', { employee_code: 'PHF004' });
    pass(dd.total_count === phf004Perf.completed_on_time, 'C1: PHF004 completed_on_time drilldown total_count (' + dd.total_count + ') == Performance panel value (' + phf004Perf.completed_on_time + ')');
    pass(dd.tasks.some(t => t.task_code === A5_TASK_CODE), 'C2: ' + A5_TASK_CODE + ' correctly appears in PHF004\'s (the actual completer\'s) drilldown');
  }

  // ---- D. Parity across all 3 completion metrics, for every performance-listed employee ----
  {
    for (const p of person.performance) {
      const ddInPeriod = await drilldown(S_PHF010, 'completed_in_period', { employee_code: p.employee_code });
      pass(ddInPeriod.total_count === p.completed_in_period, 'D.' + p.employee_code + '.completed_in_period: drilldown(' + ddInPeriod.total_count + ') == performance(' + p.completed_in_period + ')');
      const ddOnTime = await drilldown(S_PHF010, 'completed_on_time', { employee_code: p.employee_code });
      pass(ddOnTime.total_count === p.completed_on_time, 'D.' + p.employee_code + '.completed_on_time: drilldown(' + ddOnTime.total_count + ') == performance(' + p.completed_on_time + ')');
      const ddLate = await drilldown(S_PHF010, 'completed_late', { employee_code: p.employee_code });
      pass(ddLate.total_count === p.completed_late, 'D.' + p.employee_code + '.completed_late: drilldown(' + ddLate.total_count + ') == performance(' + p.completed_late + ')');
    }
  }

  // ---- E/F. Coordinator != completer, including the multi-coordinator case ----
  {
    // A5 has TWO coordinators (PHF012 and PHF082), neither of whom completed it (PHF004 did).
    // Both coordinators' completed_on_time drilldowns must exclude A5.
    const ddCoord1 = await drilldown(S_PHF010, 'completed_on_time', { employee_code: 'PHF082' });
    const ddCoord2 = await drilldown(S_PHF010, 'completed_on_time', { employee_code: 'PHF012' });
    pass(!ddCoord1.tasks.some(t => t.task_code === A5_TASK_CODE), 'E1: coordinator #1 (PHF082) drilldown excludes ' + A5_TASK_CODE);
    pass(!ddCoord2.tasks.some(t => t.task_code === A5_TASK_CODE), 'F1: coordinator #2 (PHF012, multi-coordinator case) drilldown excludes ' + A5_TASK_CODE);
    const ddCompleter = await drilldown(S_PHF010, 'completed_on_time', { employee_code: 'PHF004' });
    pass(ddCompleter.tasks.filter(t => t.task_code === A5_TASK_CODE).length === 1, 'F2: multi-coordinator task (2 coordinators) attributes to its actual completer exactly ONCE, not duplicated per coordinator');
  }

  // ---- G. Self-task exclusion regression guard ----
  {
    // PHF010 has 5 self-task fixtures this month (workload) but must remain
    // completely absent from the Performance array — same locked policy as
    // before the fix, unaffected by this change.
    pass(!perfByEmployee.has('PHF010'), 'G1: PHF010 (self-task-heavy) has NO Performance entry at all — self-task exclusion unaffected by the fix');
    const ddSelf = await drilldown(S_PHF010, 'completed_on_time', { employee_code: 'PHF010' });
    pass(ddSelf.total_count === 0, 'G2: employee-scoped completed_on_time drilldown for a self-task-only employee (PHF010) returns 0, not a self-task leak');
  }

  // ---- H. Category-scoped + employee-scoped completion drilldown combined ----
  {
    const ddCombined = await drilldown(S_PHF010, 'completed_on_time', { employee_code: 'PHF082', category_code: 'KINH_DOANH' });
    const ddEmployeeOnly = await drilldown(S_PHF010, 'completed_on_time', { employee_code: 'PHF082' });
    pass(ddCombined.total_count <= ddEmployeeOnly.total_count, 'H1: category+employee combined filter is a subset of the employee-only filter (' + ddCombined.total_count + ' <= ' + ddEmployeeOnly.total_count + ')');
    pass(ddCombined.tasks.every(t => t.category_code === 'KINH_DOANH'), 'H2: every task in the combined drilldown genuinely belongs to the requested category');
  }

  // ---- I. Permission negative test: fix must not widen authorized report scope ----
  {
    // PHF082 (nhan_vien preset, self-scope) requesting relation=received under
    // its OWN authorized scope must never see PHF004's/PHF012's completion
    // rows leak in just because the attribution logic changed.
    const ddSelfScope = await reporting.listTaskReportDrilldown(S_PHF082, { metric_id: 'completed_on_time', employee_code: 'PHF004', relation: 'received', period: PERIOD_THIS_MONTH, limit: 50, offset: 0 });
    pass(ddSelfScope.total_count === 0, 'I1: PHF082 (self-scope actor) requesting employee_code=PHF004 under its OWN authorized (self) scope gets 0 — no cross-employee leak, authorization boundary unchanged by the fix');
    const ddOwnScope = await reporting.listTaskReportDrilldown(S_PHF082, { metric_id: 'completed_on_time', employee_code: 'PHF082', relation: 'received', period: PERIOD_THIS_MONTH, limit: 50, offset: 0 });
    pass(ddOwnScope.total_count <= phf082Perf.completed_on_time, 'I2: PHF082 viewing its own narrower (self) scope never sees MORE than the all_company Performance count (' + ddOwnScope.total_count + ' <= ' + phf082Perf.completed_on_time + ')');
  }

  console.log(`PHF Task Report-04A employee drilldown parity fix test: ${passed}/${passed} PASS`);
})().catch(err => { console.error('FAIL', err); process.exit(1); });
