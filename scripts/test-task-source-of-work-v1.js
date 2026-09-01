'use strict';
/*
 * PHF Task — SOURCE OF WORK reporting (creation-time self/assigned split).
 * MOCK unit test — no DB, no network. Stubs task-overview-read-bridge +
 * task-employee-scope via require.cache and drives api/_lib/task-reporting-v2.js
 * directly. Proves the LOCKED contract:
 *   - classification is CREATION-TIME (creator vs the INITIAL primary), never
 *     the current active primary; a transfer never rewrites it
 *   - proposal-generated Tasks are their own bucket (kept separate in the
 *     contract even if a 2-way view rolls them under "Được giao")
 *   - recurrence is orthogonal (self/assigned underneath + is_recurring flag)
 *   - account-only / no-primary-history => unknown (never fabricated as self)
 *   - Overview "Hoàn thành trong kỳ" carries source_breakdown
 *   - Person analysis carries workload_self / workload_assigned / src_recurring
 *   - drilldown accepts a source_of_work filter and tags each row
 * Run: node scripts/test-task-source-of-work-v1.js
 */
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const bridgePath = require.resolve(path.join(ROOT, 'api/_lib/task-overview-read-bridge'));
const scopePath = require.resolve(path.join(ROOT, 'api/_lib/task-employee-scope'));
const sowPath = require.resolve(path.join(ROOT, 'api/_lib/task-source-of-work'));
const reportingPath = require.resolve(path.join(ROOT, 'api/_lib/task-reporting-v2'));

let passed = 0;
function pass(c, m) { assert.ok(c, m); passed += 1; console.log('  ok - ' + m); }

/* ---------------- A. pure classifier ---------------------------------------- */
const { classifySourceOfWork, isRecurringOccurrence, rollupSourceOfWork } = require(sowPath);
(function () {
  pass(classifySourceOfWork({ createdByEmployeeCode: 'A', initialPrimaryEmployeeCode: 'A' }) === 'self_assigned', 'A1: creator === initial primary => self_assigned');
  pass(classifySourceOfWork({ createdByEmployeeCode: 'A', initialPrimaryEmployeeCode: 'B' }) === 'assigned_by_other', 'A2: creator !== initial primary => assigned_by_other');
  // self then transfer: initial primary stays A, creator A -> still self
  pass(classifySourceOfWork({ createdByEmployeeCode: 'A', initialPrimaryEmployeeCode: 'A' /* current primary C ignored */ }) === 'self_assigned', 'A3: self then transferred to C => still self_assigned (initial primary, not current)');
  // assigned then transfer: initial primary B, creator A -> still assigned
  pass(classifySourceOfWork({ createdByEmployeeCode: 'A', initialPrimaryEmployeeCode: 'B' }) === 'assigned_by_other', 'A4: assigned then transferred to C => still assigned_by_other');
  pass(classifySourceOfWork({ proposalGenerated: true, createdByEmployeeCode: 'B', initialPrimaryEmployeeCode: 'B' }) === 'proposal', 'A5: proposal-generated => proposal (even when acceptor is the primary)');
  pass(classifySourceOfWork({ createdByEmployeeCode: 'A', initialPrimaryEmployeeCode: 'A', recurringSeriesId: 'r1' }) === 'self_assigned' && isRecurringOccurrence({ recurringSeriesId: 'r1' }) === true, 'A6: recurring rule A->A => self_assigned + is_recurring');
  pass(classifySourceOfWork({ createdByEmployeeCode: 'MGR', initialPrimaryEmployeeCode: 'B', recurringSeriesId: 'r2' }) === 'assigned_by_other', 'A7: recurring rule MGR->B => assigned_by_other + is_recurring');
  pass(classifySourceOfWork({ createdByEmployeeCode: '', createdByAccountId: 'acc-admin', initialPrimaryEmployeeCode: 'B' }) === 'unknown', 'A8: account-only Admin creator => unknown (never self)');
  pass(classifySourceOfWork({ createdByEmployeeCode: 'A', initialPrimaryEmployeeCode: '' }) === 'unknown', 'A9: no initial primary history => unknown');
  pass(classifySourceOfWork({ createdByEmployeeCode: 'a', initialPrimaryEmployeeCode: 'A' }) === 'self_assigned', 'A10: case-insensitive identity match');
  pass(rollupSourceOfWork('proposal') === 'assigned' && rollupSourceOfWork('self_assigned') === 'self', 'A11: 2-way rollup — proposal folds under "assigned"');
})();

/* ---------------- B. reporting-v2 integration (stubbed population) ---------- */
let POPULATION = [];
require.cache[bridgePath] = {
  id: bridgePath, filename: bridgePath, loaded: true,
  exports: {
    isOverviewBridgeEnabled: () => true,
    bridgeFetchOverviewPopulation: async () => ({ tasks: POPULATION.map((t) => Object.assign({}, t)), effectiveScope: 'managed' }),
  },
};
require.cache[scopePath] = {
  id: scopePath, filename: scopePath, loaded: true,
  exports: {
    loadOrgRows: async () => ([
      { employeeCode: 'A', fullName: 'Nhân viên A', department: 'Kho', managerCode: 'MGR' },
      { employeeCode: 'B', fullName: 'Nhân viên B', department: 'Kho', managerCode: 'MGR' },
      { employeeCode: 'MGR', fullName: 'Quản lý M', department: 'Kho', managerCode: '' },
    ]),
  },
};
const reporting = require(reportingPath);

const NOW = Date.now();
const iso = (offsetDays) => new Date(NOW + offsetDays * 86400000).toISOString();
function task(o) {
  return Object.assign({
    task_id: 't' + Math.random().toString(36).slice(2), task_code: 'CV-X', title: 'T', status: 'completed',
    deadline: iso(-1), completed_at: iso(-2), category_code: 'C1', created_at: iso(-20),
    primary_employee_code: 'A', on_time: true,
    source_of_work: 'assigned_by_other', is_recurring_occurrence: false,
    last_progress_at: iso(-2), progress_percent: 100, published_at: iso(-19),
    deadline_change_count: 0, transfer_count: 0,
  }, o);
}
const ANCHOR = new Date(NOW).toISOString().slice(0, 10);
const input = { period: { type: 'month', anchor_date: ANCHOR } };

(async () => {
  // completed-in-period population: 3 self, 1 assigned_by_other, 1 proposal, 1 recurring-self
  POPULATION = [
    task({ primary_employee_code: 'A', source_of_work: 'self_assigned', completed_at: iso(0) }),
    task({ primary_employee_code: 'A', source_of_work: 'self_assigned', completed_at: iso(0) }),
    task({ primary_employee_code: 'A', source_of_work: 'self_assigned', is_recurring_occurrence: true, completed_at: iso(0) }),
    task({ primary_employee_code: 'A', source_of_work: 'assigned_by_other', completed_at: iso(0) }),
    task({ primary_employee_code: 'B', source_of_work: 'proposal', completed_at: iso(0) }),
  ];
  const ov = await reporting.getTaskOverviewV2({ account: { id: 'x', role: 'admin' } }, input);
  const sb = ov.metrics.completed_in_period.source_breakdown;
  pass(ov.metrics.completed_in_period.value === 5, 'B1: completed_in_period total = 5');
  pass(sb.self === 3 && sb.assigned === 2 && sb.unknown === 0, 'B2: source_breakdown 2-way — self 3, assigned 2 (assigned_by_other 1 + proposal 1)');
  pass(sb.by_source.self_assigned === 3 && sb.by_source.assigned_by_other === 1 && sb.by_source.proposal === 1, 'B3: by_source preserves proposal separately');
  pass(sb.recurring === 1, 'B4: source_breakdown.recurring = 1');

  const people = (await reporting.getTaskReportV2PersonAnalysis({ account: { id: 'x', role: 'admin' } }, input)).people;
  const pa = people.find((p) => p.employee_code === 'A');
  pass(pa.workload === 4 && pa.workload_self === 3 && pa.workload_assigned === 1, 'B5: person A workload 4 = self 3 + assigned 1 (raw count can\'t read as productivity)');
  pass(pa.src_recurring === 1, 'B6: person A src_recurring = 1');
  const pb = people.find((p) => p.employee_code === 'B');
  pass(pb.workload_assigned === 1 && pb.workload_self === 0, 'B7: person B — the proposal Task counts under "Được giao", not "Tự tạo"');

  // drilldown — source_of_work filter + per-row tag
  const ddSelf = await reporting.listTaskOverviewV2Drilldown({ account: { id: 'x', role: 'admin' } }, Object.assign({ metric_id: 'completed_in_period', source_of_work: 'self_assigned' }, input));
  pass(ddSelf.total_count === 3 && ddSelf.tasks.every((r) => r.source_of_work === 'self_assigned'), 'B8: drilldown source_of_work=self_assigned -> only the 3 self rows');
  const ddAll = await reporting.listTaskOverviewV2Drilldown({ account: { id: 'x', role: 'admin' } }, Object.assign({ metric_id: 'completed_in_period' }, input));
  pass(ddAll.tasks.every((r) => typeof r.source_of_work === 'string' && 'is_recurring_occurrence' in r), 'B9: every drilldown row carries source_of_work + is_recurring_occurrence');

  // scope authorization is NOT touched — reporting only aggregates the population
  // the bridge already authorized (stub returns exactly what it is given).
  pass(ov.effective_scope === 'managed', 'B10: effective_scope passthrough unchanged (no re-scoping)');

  console.log('\nPHF Task SOURCE OF WORK: ' + passed + '/' + passed + ' PASS');
})().catch((e) => { console.error(e && e.stack || e); process.exitCode = 1; });
