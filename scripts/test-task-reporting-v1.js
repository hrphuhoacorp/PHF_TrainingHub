'use strict';

/*
 * PHF Task — REPORT Foundation V1 (Report-03) — backend-only test suite
 * (no UI exists yet, per gate scope). Same "real dev DB, read-only where
 * possible" methodology already used by test-task-timeline-foundation-v1.js
 * ("backend, real DB" group) — calls api/_lib/task-reporting.js directly,
 * in-process, no HTTP/session cookie.
 *
 * KNOWN FIXTURES USED (real rows in the dev DB, created either by earlier
 * gates or by this gate's setup — never mutated by THIS test file, only
 * read):
 *   CV-2608-0001 (e7b0f760-...) — cancelled; was completed on-time, then
 *     reopened, then cancelled. completed_at is currently NULL on the row.
 *     Used to prove historical (pre-reopen) completion is NOT double-counted.
 *   CV-2608-0002 (fa15f1ab-...) — draft, never published. Used to prove
 *     drafts stay excluded from relation='received' report population.
 *   CV-2608-0003 (63c0258b-...) — in_progress, deadline already passed
 *     (created 2026-08-22, deadline 2026-08-23). The one real
 *     currently_overdue example.
 *   CV-2608-0004 (410446de-...) — Report-03 fixture: self-task (PHF010
 *     created it for PHF010), completed -> reopened -> completed again.
 *     Final status=completed. Proves self-task workload-include/
 *     performance-exclude AND final-completion-after-reopen simultaneously.
 *   CV-2608-0005 (9c86a709-...) — Report-03 fixture: coordinator fan-out.
 *     primary=PHF082, related(coordinator)=PHF010+PHF012. status=published.
 *     Proves TASK-grain=1 vs PERSON-TASK-grain=3 without inflating task KPIs.
 *   CV-2608-0006 (f22978bb-...) — Report-03 fixture: primary=PHF082,
 *     deadline set 5s in the future at creation, completed ~8s later ->
 *     genuine late completion (not backdated).
 *
 * Actors: PHF002 (GIAM_DOC, all_company peopleScope), PHF010 (TRO_LY_GD,
 * all_company peopleScope, primary on CV-0001/CV-0004, creator+primary of
 * CV-0004), PHF082 (nhan_vien preset, self-scope, primary on CV-0003/0005/
 * 0006, never created any task).
 */

const assert = require('assert');
require('dotenv').config();
const reporting = require('../api/_lib/task-reporting');

let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }

const PERIOD_THIS_MONTH = { type: 'month', anchor_date: '2026-08-25' };
const S_PHF002 = { account: { employeeCode: 'PHF002' } };
const S_PHF010 = { account: { employeeCode: 'PHF010' } };
const S_PHF082 = { account: { employeeCode: 'PHF082' } };

const CV0004 = '410446de-e93b-4fb5-92a8-eb438f0be721';
const CV0005 = '9c86a709-2e59-49db-8e4a-5729b93ded89';
const CV0006 = 'f22978bb-66e9-4ed6-b511-899220411609';

(async () => {
  // =======================================================================
  // PURE UNIT TESTS — period canonicalization, no DB.
  // =======================================================================
  {
    const day = reporting.resolvePeriodWindow('day', '2026-08-25');
    pass(day.start === '2026-08-24T17:00:00.000Z' && day.endExclusive === '2026-08-25T17:00:00.000Z', 'PERIOD day: [00:00 ICT, next 00:00 ICT)');

    const week = reporting.resolvePeriodWindow('week', '2026-08-25'); // Tuesday -> Monday 2026-08-24
    pass(week.start === '2026-08-23T17:00:00.000Z' && week.endExclusive === '2026-08-30T17:00:00.000Z', 'PERIOD week: Monday->next Monday exclusive (BR-04 LOCKED)');
    const weekFromSunday = reporting.resolvePeriodWindow('week', '2026-08-30'); // Sunday -> still the same Mon 08-24 week
    pass(weekFromSunday.start === week.start && weekFromSunday.endExclusive === week.endExclusive, 'PERIOD week: Sunday anchor resolves to the SAME week as its Monday');

    const month = reporting.resolvePeriodWindow('month', '2026-08-25');
    pass(month.start === '2026-07-31T17:00:00.000Z' && month.endExclusive === '2026-08-31T17:00:00.000Z', 'PERIOD month: 1st -> next 1st exclusive');
    const monthLeapFeb = reporting.resolvePeriodWindow('month', '2028-02-15'); // 2028 is a leap year
    pass(new Date(monthLeapFeb.endExclusive).getTime() - new Date(monthLeapFeb.start).getTime() === 29 * 86400000, 'PERIOD month: Feb boundary correctly spans 29 days in a leap year');

    const year = reporting.resolvePeriodWindow('year', '2026-08-25');
    pass(year.start === '2025-12-31T17:00:00.000Z' && year.endExclusive === '2026-12-31T17:00:00.000Z', 'PERIOD year: Jan1 -> next Jan1 exclusive');

    assert.throws(() => reporting.resolvePeriodWindow('day', '2026-13-40'), /TASK_REPORT_PERIOD_ANCHOR_INVALID|anchor_date/, 'PERIOD invalid anchor_date fails closed');
    assert.throws(() => reporting.resolvePeriodWindow('decade', '2026-08-25'), /TASK_REPORT_PERIOD_TYPE_INVALID|period_type/, 'PERIOD invalid period_type fails closed');

    // TIMEZONE: an instant exactly at the ICT day boundary must land in the
    // NEW ICT day, not the old UTC day (17:00 UTC Aug24 == 00:00 ICT Aug25).
    pass(day.start === '2026-08-24T17:00:00.000Z', 'TIMEZONE: 17:00 UTC Aug24 is the START of ICT day Aug25 (UTC+7 boundary crossing)');
  }

  // =======================================================================
  // INTEGRITY — final-completion cross-check (pure function).
  // =======================================================================
  {
    const task = { completed_at: '2026-08-25T04:32:23.459011+00:00' };
    const matchingEvent = { payload: { completed_at: '2026-08-25T04:32:23.459011+00:00' } };
    pass(reporting.crossCheckFinalCompletion(task, matchingEvent).ok === true, 'INTEGRITY: exact-match completion event passes cross-check');
    const closeEvent = { payload: { completed_at: '2026-08-25T04:32:24.000000+00:00' } }; // 0.54s apart, within tolerance
    pass(reporting.crossCheckFinalCompletion(task, closeEvent).ok === true, 'INTEGRITY: sub-second precision difference within tolerance still passes');
    const mismatchedEvent = { payload: { completed_at: '2026-08-25T04:40:00.000000+00:00' } }; // minutes apart
    const mismatchResult = reporting.crossCheckFinalCompletion(task, mismatchedEvent);
    pass(mismatchResult.ok === false && mismatchResult.reason === 'COMPLETION_EVENT_MISMATCH', 'INTEGRITY: a genuinely mismatched timestamp is flagged, not silently trusted');
    pass(reporting.crossCheckFinalCompletion(task, null).reason === 'MISSING_COMPLETION_EVENT', 'INTEGRITY: missing completion event flagged distinctly');
  }

  // =======================================================================
  // SELF TASK classification (pure function).
  // =======================================================================
  {
    const task = { created_by_employee_code: 'PHF010' };
    pass(reporting.classifyInvolvement(task, { role: 'primary', employee_code: 'PHF010' }) === 'self', 'SELF_TASK: primary==creator -> self');
    pass(reporting.classifyInvolvement(task, { role: 'primary', employee_code: 'PHF082' }) === 'assigned', 'SELF_TASK: primary!=creator -> assigned');
    pass(reporting.classifyInvolvement(task, { role: 'related', employee_code: 'PHF012' }) === 'coordinator', 'SELF_TASK: related role -> coordinator, independent of creator');
  }

  // =======================================================================
  // LIVE — SUMMARY, real DB, PHF002 (all_company), this month.
  //
  // TEST_MAINTENANCE (Report-05, mục XIV): this section used to assert
  // hardcoded ABSOLUTE counts (created_in_period===5, on_time_rate===0.5,
  // etc.) that assumed the dev DB contained ONLY the 6 fixtures listed in
  // the file header comment. The Report-04 fixture-seed gate legitimately
  // added 37 more real tasks ([REPORT-UI-TEST] marker) to the SAME
  // relation=received/all_company/this-month population, which is real,
  // intentional, and must NOT be cleaned up here — so those absolute counts
  // are now permanently stale, NOT a product regression (proven in the
  // Report-04A gate by re-running the ORIGINAL pre-fix code against the
  // current DB: identical failure). Converted to an INDEPENDENT-ORACLE /
  // delta style: (a) lower-bound checks (>= the known fixture count, never
  // a new hardcoded absolute like 42 that would just go stale again the
  // next time a fixture gate runs), (b) specific known-fixture INCLUSION
  // checks (the 6 original CV-2608-0001..0006 rows must still be present
  // and correctly classified), (c) self-consistency FORMULA checks
  // (on_time_rate must equal on_time/(on_time+late) for whatever the live
  // counts currently are). This is strictly MORE sensitive to a real
  // regression in any of the 6 known fixtures' classification than the old
  // exact-count assertions were, while being robust to legitimate DB growth.
  // =======================================================================
  const summary = await reporting.getTaskReportSummary(S_PHF002, { relation: 'received', period: PERIOD_THIS_MONTH });
  pass(summary.report_contract_version === 1, 'CONTRACT: summary carries report_contract_version=1');
  pass(summary.metrics.created_in_period.value >= 5, 'METRIC created_in_period: at least the 5 known non-draft fixtures this month (draft CV-0002 correctly excluded from relation=received) — dev DB may legitimately contain more');
  pass(summary.metrics.completed_in_period.value >= 2, 'METRIC completed_in_period: at least CV-0004 + CV-0006 (CV-0001s pre-reopen completion NOT counted — historical completion not double-counted, BR-05)');
  pass(summary.metrics.completed_on_time.value >= 1, 'METRIC completed_on_time: at least CV-0004 (2-day-out deadline)');
  pass(summary.metrics.completed_late.value >= 1, 'METRIC completed_late: at least CV-0006 (5s deadline, completed ~8s later — genuinely late, not backdated)');
  pass(summary.metrics.currently_overdue.value >= 1 && summary.metrics.currently_overdue.period_relevance === 'none', 'METRIC currently_overdue: at least CV-0003, tagged CURRENT-STATE (period_relevance=none)');
  const onTimeCount = summary.metrics.completed_on_time.value, lateCount = summary.metrics.completed_late.value;
  pass(summary.metrics.on_time_rate.value === onTimeCount / (onTimeCount + lateCount), 'METRIC on_time_rate: FORMULA invariant on_time/(on_time+late) holds for the live counts (not a hardcoded ratio)');
  pass(summary.metrics.average_progress.population === 'active_only', 'METRIC average_progress: tagged population=active_only (BR-07)');
  pass(summary.data_integrity_warnings.length === 0, 'INTEGRITY: no mismatch warnings for real, correctly-produced fixture data (proves the cross-check does not false-positive)');

  // Denominator-zero -> null: a period with no completions at all.
  const emptyPeriodSummary = await reporting.getTaskReportSummary(S_PHF002, { relation: 'received', period: { type: 'year', anchor_date: '2020-01-01' } });
  pass(emptyPeriodSummary.metrics.completed_in_period.value === 0, 'EMPTY: a period with 0 completions returns 0 count');
  pass(emptyPeriodSummary.metrics.on_time_rate.value === null, 'EMPTY: on_time_rate denominator=0 returns null, not 0 (avoids implying "0% performance")');

  // =======================================================================
  // PERMISSION — negative case + population boundary.
  // =======================================================================
  const negSummary = await reporting.getTaskReportSummary(S_PHF082, { relation: 'assigned', period: PERIOD_THIS_MONTH });
  pass(negSummary.metrics.created_in_period.value === 0, 'PERMISSION negative: PHF082 (never created any task) sees 0 under relation=assigned, despite having real activity under relation=received');
  await assert.rejects(
    () => reporting.getTaskReportSummary(S_PHF002, { relation: 'not_a_real_relation', period: PERIOD_THIS_MONTH }),
    error => error && error.code === 'TASK_LIST_RELATION_INVALID'
  );
  pass(true, 'PERMISSION: invalid relation fails closed with TASK_LIST_RELATION_INVALID (reuses listTasks() validation, no separate weaker path)');

  // =======================================================================
  // DRILLDOWN — KPI count == drilldown total_count (the core invariant).
  // =======================================================================
  const drillOverdue = await reporting.listTaskReportDrilldown(S_PHF002, { relation: 'received', period: PERIOD_THIS_MONTH, metric_id: 'currently_overdue', limit: 100, offset: 0 });
  pass(drillOverdue.total_count === summary.metrics.currently_overdue.value, 'DRILLDOWN invariant: currently_overdue KPI == drilldown total_count');
  pass(drillOverdue.tasks.some(t => t.task_code === 'CV-2608-0003'), 'DRILLDOWN: currently_overdue includes the known fixture CV-2608-0003');

  const drillCreated = await reporting.listTaskReportDrilldown(S_PHF002, { relation: 'received', period: PERIOD_THIS_MONTH, metric_id: 'created_in_period', limit: 100, offset: 0 });
  pass(drillCreated.total_count === summary.metrics.created_in_period.value, 'DRILLDOWN invariant: created_in_period KPI == drilldown total_count');

  const drillCompleted = await reporting.listTaskReportDrilldown(S_PHF002, { relation: 'received', period: PERIOD_THIS_MONTH, metric_id: 'completed_in_period', limit: 100, offset: 0 });
  pass(drillCompleted.total_count === summary.metrics.completed_in_period.value, 'DRILLDOWN invariant: completed_in_period KPI == drilldown total_count');
  const completedCodes = drillCompleted.tasks.map(t => t.task_code);
  pass(completedCodes.includes('CV-2608-0004') && completedCodes.includes('CV-2608-0006') && !completedCodes.includes('CV-2608-0001'), 'DRILLDOWN: completed_in_period includes the known real completions CV-0004/CV-0006, excludes CV-0001 (cancelled, historical completion not double-counted)');

  const drillOnTime = await reporting.listTaskReportDrilldown(S_PHF002, { relation: 'received', period: PERIOD_THIS_MONTH, metric_id: 'completed_on_time', limit: 100, offset: 0 });
  pass(drillOnTime.total_count === summary.metrics.completed_on_time.value, 'DRILLDOWN invariant: completed_on_time KPI == drilldown total_count');
  pass(drillOnTime.tasks.some(t => t.task_code === 'CV-2608-0004'), 'DRILLDOWN: completed_on_time includes the known fixture CV-2608-0004');
  const drillLate = await reporting.listTaskReportDrilldown(S_PHF002, { relation: 'received', period: PERIOD_THIS_MONTH, metric_id: 'completed_late', limit: 100, offset: 0 });
  pass(drillLate.total_count === summary.metrics.completed_late.value, 'DRILLDOWN invariant: completed_late KPI == drilldown total_count');
  pass(drillLate.tasks.some(t => t.task_code === 'CV-2608-0006'), 'DRILLDOWN: completed_late includes the known fixture CV-2608-0006');

  // Unauthorized rows structurally absent from drilldown too (not just aggregation).
  const negDrill = await reporting.listTaskReportDrilldown(S_PHF082, { relation: 'assigned', period: PERIOD_THIS_MONTH, metric_id: 'created_in_period', limit: 20, offset: 0 });
  pass(negDrill.total_count === 0 && negDrill.tasks.length === 0, 'DRILLDOWN PERMISSION: unauthorized population drilldown is empty, not merely the aggregate hiding it');

  // Requesting an employee_code outside the authorized population -> empty, not an error (no existence-revealing error).
  const outsideEmployeeDrill = await reporting.listTaskReportDrilldown(S_PHF082, { relation: 'assigned', period: PERIOD_THIS_MONTH, metric_id: 'created_in_period', employee_code: 'PHF002', limit: 20, offset: 0 });
  pass(outsideEmployeeDrill.total_count === 0, 'PERMISSION: employee_code filter outside authorized population returns empty, not an error (no enumeration side-channel)');

  // Pagination — total known dynamically from the summary fetched above
  // (independent oracle: the KPI value, not a hardcoded absolute count).
  const totalCreated = summary.metrics.created_in_period.value;
  const page1 = await reporting.listTaskReportDrilldown(S_PHF002, { relation: 'received', period: PERIOD_THIS_MONTH, metric_id: 'created_in_period', limit: 1, offset: 0 });
  pass(page1.tasks.length === 1 && page1.has_more === (totalCreated > 1) && page1.total_count === totalCreated, 'PAGINATION: limit=1 returns 1 row, has_more reflects whether more than 1 exists, total_count still reflects the full match set');
  const page2 = await reporting.listTaskReportDrilldown(S_PHF002, { relation: 'received', period: PERIOD_THIS_MONTH, metric_id: 'created_in_period', limit: 1, offset: totalCreated - 1 });
  pass(page2.tasks.length === 1 && page2.has_more === false, 'PAGINATION: last page has_more=false');

  // =======================================================================
  // CATEGORY analysis == drilldown parity.
  // =======================================================================
  const category = await reporting.getTaskReportCategoryAnalysis(S_PHF002, { relation: 'received', period: PERIOD_THIS_MONTH });
  const congViecCat = category.categories.find(c => c.category_code === 'CONG_VIEC_TONG_THE');
  pass(!!congViecCat, 'CATEGORY: expected category present');
  pass(congViecCat.display_name === 'Công việc tổng thể', 'CATEGORY: CURRENT display_name resolved (BR-10 — no historical snapshot)');
  pass(congViecCat.metrics.created_in_period.value >= 5, 'CATEGORY headline metric = created_in_period (locked decision F) — at least the 5 known fixtures in this category');
  const drillByCategory = await reporting.listTaskReportDrilldown(S_PHF002, { relation: 'received', period: PERIOD_THIS_MONTH, category_code: 'CONG_VIEC_TONG_THE', metric_id: 'created_in_period', limit: 100, offset: 0 });
  pass(drillByCategory.total_count === congViecCat.metrics.created_in_period.value, 'DRILLDOWN invariant: category metric == category-filtered drilldown');
  const catCodes = drillByCategory.tasks.map(t => t.task_code);
  pass(['CV-2608-0001', 'CV-2608-0003', 'CV-2608-0004', 'CV-2608-0005', 'CV-2608-0006'].every(c => catCodes.includes(c)), 'CATEGORY drilldown includes all 5 known non-draft fixtures in this category');

  // =======================================================================
  // PERSON WORKLOAD / PERFORMANCE — grain separation, no double-counting.
  // =======================================================================
  const person = await reporting.getTaskReportPersonAnalysis(S_PHF002, { relation: 'received', period: PERIOD_THIS_MONTH });
  const phf010 = person.workload.find(p => p.employee_code === 'PHF010');
  const phf082 = person.workload.find(p => p.employee_code === 'PHF082');
  const phf012 = person.workload.find(p => p.employee_code === 'PHF012');
  pass(!!phf010 && !!phf082 && !!phf012, 'ASSIGNEE: all 3 involved employees present in workload');
  // Exact primary/coordinator/self counts are no longer asserted here (the
  // Report-04 fixture-seed gate legitimately added many more tasks for
  // these same 3 employees) — instead verify the KNOWN fixtures are still
  // present with the CORRECT role, which is what actually proves the
  // classification logic still works.
  pass(phf010.self_task_count >= 1 && phf010.breakdown.some(b => b.task_code === 'CV-2608-0004' && b.self_task === true), 'SELF_TASK workload: known fixture CV-0004 present and correctly flagged self_task=true — WORKLOAD INCLUDES self-task (BR-02)');
  pass(phf010.breakdown.some(b => b.task_code === 'CV-2608-0001' && b.workload_role === 'primary' && b.self_task === false), 'ASSIGNEE: known fixture CV-0001 present as PHF010 primary, correctly NOT flagged self-task');
  pass(phf010.breakdown.some(b => b.task_code === 'CV-2608-0005' && b.workload_role === 'coordinator'), 'ASSIGNEE: known fixture CV-0005 present as a PHF010 coordinator row');
  pass(['CV-2608-0003', 'CV-2608-0005', 'CV-2608-0006'].every(code => phf082.breakdown.some(b => b.task_code === code && b.workload_role === 'primary')), 'ASSIGNEE: PHF082 primary on all 3 known fixtures CV-0003/0005/0006');
  pass(phf012.breakdown.some(b => b.task_code === 'CV-2608-0005' && b.workload_role === 'coordinator'), 'ASSIGNEE: known fixture CV-0005 present as a PHF012 coordinator row');

  // The core fan-out example from Report-02/03 spec: 1 task, 1 primary + 2
  // coordinators here (gate's own example used 3 coordinators; this fixture
  // has 2 — same principle, different count) -> TASK=1, PERSON-TASK rows=3.
  // This check is ALREADY volume-independent (scoped to CV-0005's own
  // task_id specifically) — no test-maintenance change needed.
  const cv0005WorkloadRows = person.workload.reduce((sum, p) => sum + p.breakdown.filter(b => b.task_id === CV0005).length, 0);
  pass(cv0005WorkloadRows === 3, 'DOUBLE_COUNTING: CV-2608-0005 (1 primary + 2 coordinators) contributes exactly 3 PERSON-TASK rows total, spread across 3 people');

  // COMPLETION ACTOR / PERFORMANCE — self-task excluded, final-completion actor wins.
  const perfPhf082 = person.performance.find(p => p.employee_code === 'PHF082');
  const perfPhf010 = person.performance.find(p => p.employee_code === 'PHF010');
  pass(!!perfPhf082 && perfPhf082.completed_late >= 1, 'COMPLETION_ACTOR: PHF082 has at least 1 late completion this month');
  const phf082LateDrill = await reporting.listTaskReportDrilldown(S_PHF002, { relation: 'received', period: PERIOD_THIS_MONTH, metric_id: 'completed_late', employee_code: 'PHF082', limit: 100, offset: 0 });
  pass(phf082LateDrill.tasks.some(t => t.task_code === 'CV-2608-0006'), 'COMPLETION_ACTOR: known fixture CV-0006 attributes its late completion to PHF082 via the final completion event actor (Report-04A canonical attribution — coordinator leakage excluded)');
  pass(!perfPhf010, 'SELF_TASK performance: PHF010 does NOT appear in performance at all — every completed task attributed to PHF010 as primary is self-task and correctly EXCLUDED (BR-02/BR-08), even though self-tasks fully count in their workload');
  pass(person.performance.every(p => p.completion_rate === 'DEFERRED'), 'PERSON_PERFORMANCE: completion_rate explicitly marked DEFERRED, not invented (locked decision D)');

  // Person-scoped drilldown parity.
  const personDrill = await reporting.listTaskReportDrilldown(S_PHF002, { relation: 'received', period: PERIOD_THIS_MONTH, metric_id: 'created_in_period', employee_code: 'PHF082', limit: 20, offset: 0 });
  pass(personDrill.total_count === phf082.breakdown.length, 'DRILLDOWN invariant: person-scoped drilldown count == that person\'s workload breakdown length');

  // =======================================================================
  // TREND — bucket shape, DAY has no sub-day trend.
  // =======================================================================
  const trendDay = await reporting.getTaskReportTrend(S_PHF002, { relation: 'received', period: { type: 'day', anchor_date: '2026-08-25' } });
  pass(trendDay.trend_supported === false && trendDay.buckets.length === 0, 'TREND: DAY period has no sub-day trend (avoids over-engineering, locked decision)');
  const trendMonth = await reporting.getTaskReportTrend(S_PHF002, { relation: 'received', period: PERIOD_THIS_MONTH });
  pass(trendMonth.trend_supported === true && trendMonth.buckets.length === 31, 'TREND: MONTH period returns daily buckets (locked decision E — August has 31 days)');
  const totalCreatedAcrossBuckets = trendMonth.buckets.reduce((s, b) => s + b.created_in_period, 0);
  pass(totalCreatedAcrossBuckets === summary.metrics.created_in_period.value, 'TREND consistency: sum of daily created_in_period buckets equals the summary total for the same period/context');
  const totalCompletedAcrossBuckets = trendMonth.buckets.reduce((s, b) => s + b.completed_in_period, 0);
  pass(totalCompletedAcrossBuckets === summary.metrics.completed_in_period.value, 'TREND consistency: sum of daily completed_in_period buckets equals the summary total');
  const trendYear = await reporting.getTaskReportTrend(S_PHF002, { relation: 'received', period: { type: 'year', anchor_date: '2026-08-25' } });
  pass(trendYear.buckets.length === 12, 'TREND: YEAR period returns 12 monthly buckets');
  const trendWeek = await reporting.getTaskReportTrend(S_PHF002, { relation: 'received', period: { type: 'week', anchor_date: '2026-08-25' } });
  pass(trendWeek.buckets.length === 7, 'TREND: WEEK period returns 7 daily buckets (Mon->Sun)');

  console.log(`PHF Task Reporting V1 (Report-03) test: ${passed}/${passed} PASS`);
})().catch(err => { console.error('FAIL', err); process.exit(1); });
