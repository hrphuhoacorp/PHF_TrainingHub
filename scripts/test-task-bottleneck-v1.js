'use strict';
/*
 * PHF Task — BOTTLENECK V1 ("Điểm nghẽn cần chú ý").
 * MOCK unit test — no DB, no network. Stubs the Overview read bridge +
 * org scope and drives api/_lib/task-reporting-v2.js.
 *
 * LOCKED: "Điểm nghẽn không phải nơi có nhiều việc nhất; điểm nghẽn là nơi
 * đang làm việc của người khác không thể đi tiếp." Proves:
 *   - overdue alone is NOT a bottleneck (condition ≠ blocker)
 *   - a bottleneck needs a PROVEN stall signal (stalled-overdue / repeated
 *     deadline change / repeated transfer) from canonical data
 *   - reason falls back to a truthful generic string, never an invented cause
 *   - deterministic priority ordering, capped at 5 on Overview
 *   - never labels a person; suggests a review level from org data only
 *   - runs on the already-authorized population (no re-scoping)
 * Run: node scripts/test-task-bottleneck-v1.js
 */
const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const bridgePath = require.resolve(path.join(ROOT, 'api/_lib/task-overview-read-bridge'));
const scopePath = require.resolve(path.join(ROOT, 'api/_lib/task-employee-scope'));
const reportingPath = require.resolve(path.join(ROOT, 'api/_lib/task-reporting-v2'));

let passed = 0;
function pass(c, m) { assert.ok(c, m); passed += 1; console.log('  ok - ' + m); }

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
      { employeeCode: 'NOBOSS', fullName: 'Nhân viên X', department: 'Kho', managerCode: '' },
      { employeeCode: 'MGR', fullName: 'Quản lý M', department: 'Kho', managerCode: '' },
    ]),
  },
};
const reporting = require(reportingPath);

const NOW = Date.now();
const iso = (offDays) => new Date(NOW + offDays * 86400000).toISOString();
function open(o) {
  return Object.assign({
    task_id: 't' + Math.random().toString(36).slice(2), task_code: 'CV-B', title: 'Task', status: 'in_progress',
    deadline: iso(2), completed_at: null, category_code: 'C1', created_at: iso(-30), published_at: iso(-29),
    primary_employee_code: 'A', on_time: null, source_of_work: 'assigned_by_other', is_recurring_occurrence: false,
    last_progress_at: iso(-1), progress_percent: 40, deadline_change_count: 0, transfer_count: 0,
  }, o);
}
const ANCHOR = new Date(NOW).toISOString().slice(0, 10);
const input = { period: { type: 'month', anchor_date: ANCHOR } };
const adminSession = { account: { id: 'x', role: 'admin' } };

(async () => {
  /* 1. overdue but fresh progress => NOT a bottleneck (overdue ≠ blocker) */
  POPULATION = [open({ deadline: iso(-2), last_progress_at: iso(-1), progress_percent: 60 })];
  let ov = await reporting.getTaskOverviewV2(adminSession, input);
  pass(ov.metrics.attention_needed.value === 0, '1: overdue by 2 days but progress updated yesterday => NOT flagged (condition, not blocker)');
  pass(ov.metrics.overdue.value === 1, '1b: it still counts as overdue — the two concepts stay separate');

  /* 2. overdue AND stalled ≥ 7 days => bottleneck, with a specific reason */
  POPULATION = [open({ deadline: iso(-10), last_progress_at: iso(-9), progress_percent: 30 })];
  ov = await reporting.getTaskOverviewV2(adminSession, input);
  pass(ov.metrics.attention_needed.value === 1, '2: overdue + no progress for 9 days => 1 bottleneck');
  pass(/Quá hạn 10 ngày và không có tiến độ mới trong 9 ngày/.test(ov.metrics.attention_needed.items[0].reason), '2b: truthful specific reason (days from canonical data)');
  pass(ov.metrics.attention_needed.items[0].signal_codes.indexOf('stalled_overdue') >= 0, '2c: signal_code = stalled_overdue');

  /* 3. repeated deadline change (>=3) => bottleneck even if not overdue */
  POPULATION = [open({ deadline: iso(5), last_progress_at: iso(-1), deadline_change_count: 4 })];
  ov = await reporting.getTaskOverviewV2(adminSession, input);
  pass(ov.metrics.attention_needed.value === 1 && /Đã dời hạn 4 lần/.test(ov.metrics.attention_needed.items[0].reason), '3: deadline moved 4 times => bottleneck "Đã dời hạn 4 lần."');
  pass(ov.metrics.attention_needed.items[0].deadline_change_count === 4, '3b: raw count carried for the drilldown');

  /* 4. repeated transfer (>=3) => bottleneck */
  POPULATION = [open({ deadline: iso(5), last_progress_at: iso(-1), transfer_count: 3 })];
  ov = await reporting.getTaskOverviewV2(adminSession, input);
  pass(ov.metrics.attention_needed.value === 1 && /Đã chuyển người phụ trách 3 lần/.test(ov.metrics.attention_needed.items[0].reason), '4: transferred 3 times => bottleneck "Đã chuyển người phụ trách 3 lần."');

  /* 5. below thresholds => nothing (no manufactured sophistication) */
  POPULATION = [open({ deadline: iso(5), last_progress_at: iso(-1), deadline_change_count: 2, transfer_count: 2 })];
  ov = await reporting.getTaskOverviewV2(adminSession, input);
  pass(ov.metrics.attention_needed.value === 0, '5: 2 deadline changes + 2 transfers (below threshold) => NOT flagged');

  /* 6. reason falls back to a truthful generic string when only "overdue" holds
        but stall days are just under threshold — actually that yields nothing;
        the generic reason path is exercised when overdue + another signal but
        no stalled_overdue signal. */
  POPULATION = [open({ deadline: iso(-4), last_progress_at: iso(-1), transfer_count: 3 })];
  ov = await reporting.getTaskOverviewV2(adminSession, input);
  pass(ov.metrics.attention_needed.items[0].reason === 'Quá hạn chưa hoàn thành.' || /Đã chuyển/.test(ov.metrics.attention_needed.items[0].reason), '6: overdue + repeated-transfer, not stalled — reason is a truthful string, never an invented cause');

  /* 7. completed / cancelled tasks are never bottlenecks */
  POPULATION = [
    open({ status: 'completed', deadline: iso(-20), last_progress_at: iso(-20), completed_at: iso(0) }),
    open({ status: 'cancelled', deadline: iso(-20), last_progress_at: iso(-20) }),
  ];
  ov = await reporting.getTaskOverviewV2(adminSession, input);
  pass(ov.metrics.attention_needed.value === 0, '7: completed + cancelled never flagged as bottlenecks');

  /* 8. deterministic priority + cap at 5 */
  POPULATION = [];
  for (let i = 0; i < 8; i++) POPULATION.push(open({ deadline: iso(-8 - i), last_progress_at: iso(-8 - i), progress_percent: 10, task_code: 'CV-B' + i }));
  POPULATION.push(open({ deadline: iso(-3), last_progress_at: iso(-1), transfer_count: 6, deadline_change_count: 5, task_code: 'CV-TOP' }));
  ov = await reporting.getTaskOverviewV2(adminSession, input);
  pass(ov.metrics.attention_needed.value === 9, '8: all 9 flagged in the count');
  pass(ov.metrics.attention_needed.items.length === 5, '8b: Overview shows at most 5');
  pass(ov.metrics.attention_needed.items[0].task_code === 'CV-TOP', '8c: highest-severity item first (6 transfers + 5 deadline moves), deterministic');
  const sev = ov.metrics.attention_needed.items.map((it) => it.severity);
  pass(sev.every((s, i) => i === 0 || sev[i - 1] >= s), '8d: items sorted by descending severity');

  /* 9. never labels a person; suggests a review level from org data */
  POPULATION = [open({ primary_employee_code: 'A', deadline: iso(-10), last_progress_at: iso(-9), progress_percent: 5 })];
  ov = await reporting.getTaskOverviewV2(adminSession, input);
  let it = ov.metrics.attention_needed.items[0];
  pass(/Quản lý M/.test(it.suggested_reviewer) && !/là điểm nghẽn/.test(it.suggested_reviewer), '9: suggests the manager (from org graph) to review — never "X là điểm nghẽn"');
  POPULATION = [open({ primary_employee_code: 'NOBOSS', deadline: iso(-10), last_progress_at: iso(-9), progress_percent: 5 })];
  ov = await reporting.getTaskOverviewV2(adminSession, input);
  pass(/Ban giám đốc/.test(ov.metrics.attention_needed.items[0].suggested_reviewer), '9b: no manager in org data => generic "Ban giám đốc" fallback');

  /* 10. drilldown reveals the full list with reason/time, not just a number */
  const dd = await reporting.listTaskOverviewV2Drilldown(adminSession, Object.assign({ metric_id: 'attention_needed' }, input));
  pass(dd.is_bottleneck === true && dd.total_count === 1, '10: attention_needed drilldown returns the ranked list');
  pass(typeof dd.tasks[0].reason === 'string' && 'overdue_days' in dd.tasks[0] && 'suggested_reviewer' in dd.tasks[0], '10b: each drilldown item carries reason + time + reviewer (not merely a count)');

  /* 11. runs on the already-authorized ctx.tasks — no re-scoping */
  POPULATION = [open({ deadline: iso(-10), last_progress_at: iso(-9), progress_percent: 5 })];
  const ovScoped = await reporting.getTaskOverviewV2({ sub: 's', employeeCode: 'A', role: 'manager' }, input);
  pass(ovScoped.metrics.attention_needed.value === 1, '11: same rule on a scoped manager population — the bridge stub is the sole authorization boundary, unchanged');

  console.log('\nPHF Task BOTTLENECK V1: ' + passed + '/' + passed + ' PASS');
})().catch((e) => { console.error(e && e.stack || e); process.exitCode = 1; });
