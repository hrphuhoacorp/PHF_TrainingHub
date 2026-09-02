'use strict';
/* PHF Task — RECURRENCE MANAGEMENT ACCESS (all Task users) — pure unit
   regression (no DB, no network). Proves the server-side scope/authorization
   contract of api/_lib/task-recurrence-actions.js when the caller is a NORMAL
   Task-capable employee (not admin):
     - listTaskRecurrence => only rules the actor CREATED or MANAGES
     - update / pause / resume / stop another employee's rule (forged rule_id)
       => RECURRENCE_MANAGE_DENIED (403), no bridge write
     - the actor CAN manage their own rule (create/pause forwarded to bridge)
     - runTaskRecurrence stays Admin-only (RECURRENCE_RUN_DENIED for non-admin)
     - admin still sees every rule
   Dependencies are stubbed via require.cache BEFORE the module is loaded, so
   this exercises the real action-layer logic with zero I/O.
   Run: node scripts/test-task-recurrence-access-v1.js */
const assert = require('assert');
const path = require('path');

const LIB = path.resolve(__dirname, '..', 'api', '_lib');
const P = (m) => require.resolve(path.join(LIB, m));

let bridgeCalls = [];
const RULES = [
  { id: 'R1', title: 'Của tôi', status: 'active', frequency: 'weekly', weekday: 'T2', day_of_month: null,
    start_hour: 8, start_minute: 0, anchor_date: '2026-09-07', category_code: 'C1', priority: 'thuong',
    primary_employee_code: 'NV010', related_employee_codes: [], max_occurrences: null,
    created_by_employee_code: 'NV001', manager_employee_code: 'NV009', created_by_account_id: 'acc-1' },
  { id: 'R2', title: 'Của người khác', status: 'active', frequency: 'weekly', weekday: 'T3', day_of_month: null,
    start_hour: 9, start_minute: 0, anchor_date: '2026-09-08', category_code: 'C1', priority: 'thuong',
    primary_employee_code: 'NV020', related_employee_codes: [], max_occurrences: null,
    created_by_employee_code: 'NV002', manager_employee_code: 'NV002', created_by_account_id: 'acc-2' },
  { id: 'R3', title: 'NV001 quản lý', status: 'paused', frequency: 'monthly', weekday: null, day_of_month: 15,
    start_hour: 7, start_minute: 30, anchor_date: '2026-09-15', category_code: 'C2', priority: 'thuong',
    primary_employee_code: 'NV030', related_employee_codes: [], max_occurrences: null,
    created_by_employee_code: 'NV050', manager_employee_code: 'NV001', created_by_account_id: 'acc-5' },
];

function stub(mod, exports) { require.cache[P(mod)] = { id: P(mod), filename: P(mod), loaded: true, exports }; }

stub('task-employee-scope.js', {
  async resolveActorContext(session) {
    if (session && session.role === 'admin') {
      return { actorType: 'admin', employeeCode: '', accountId: 'acc-admin' };
    }
    return { actorType: 'nhan_vien', employeeCode: String(session.employeeCode || '').toUpperCase(), accountId: session.accountId || '' };
  },
  async loadOrgRows() {
    return [
      { employeeCode: 'NV010', fullName: 'Nhân viên 10', status: 'active' },
      { employeeCode: 'NV020', fullName: 'Nhân viên 20', status: 'active' },
      { employeeCode: 'NV030', fullName: 'Nhân viên 30', status: 'active' },
    ];
  },
  findByCode(rows, code) { return (rows || []).find((r) => r.employeeCode === String(code || '').toUpperCase()) || null; },
});
stub('task-permissions.js', { async canAssignTaskTo() { return true; } });
stub('task-recurrence.js', {
  isValidDateKey: (k) => /^\d{4}-\d{2}-\d{2}$/.test(String(k || '')),
  formatDateKey: (y, m, d) => [y, String(m).padStart(2, '0'), String(d).padStart(2, '0')].join('-'),
  firstOccurrenceDateKey: () => '2026-09-07',
  nextOccurrenceDateKey: (_r, k) => k,
  compareDateKey: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
});
stub('task-recurrence-bridge.js', {
  isRecurrenceBridgeEnabled: () => true,
  async bridgeListRecurrenceRules(filter) { bridgeCalls.push(['list', filter]); return { rules: RULES.map((r) => Object.assign({}, r)) }; },
  async bridgeCreateRecurrenceRule(input, ec, ac) { bridgeCalls.push(['create', ec, ac]); return { id: 'NEW' }; },
  async bridgeUpdateRecurrenceRule(id, input, ec) { bridgeCalls.push(['update', id, ec]); return { id }; },
  async bridgeTransitionRecurrenceRule(id, kind, reason, ec) { bridgeCalls.push(['transition', id, kind, ec]); return { id, status: kind }; },
  async bridgeRunRecurrence(o) { bridgeCalls.push(['run', o]); return { generated: 0 }; },
});

const actions = require(path.join(LIB, 'task-recurrence-actions.js'));

const EMP = { role: 'learner', employeeCode: 'NV001', accountId: 'acc-1' };
const ADMIN = { role: 'admin' };
const OK_INPUT = {
  title: 'CV lặp', content: '', categoryCode: 'C1', priority: 'thuong', primaryEmployeeCode: 'NV010',
  relatedEmployeeCodes: [], frequency: 'weekly', weekday: 'T2', startDate: '2026-09-07', startTime: '08:00', durationDays: 1,
};

let passed = 0;
function pass(c, m) { assert.ok(c, m); passed += 1; console.log('  ok - ' + m); }
async function denied(promise, code, m) {
  try { await promise; assert.fail('expected rejection: ' + m); }
  catch (e) { assert.strictEqual(e && e.code, code, m + ' (got ' + (e && e.code) + ')'); assert.strictEqual(e.statusCode, 403, m + ' status'); passed += 1; console.log('  ok - ' + m); }
}

(async function () {
  // 3 + 4 — normal user list scope
  bridgeCalls = [];
  const mine = await actions.listTaskRecurrence(EMP, {});
  const ids = mine.rules.map((r) => r.id).sort();
  pass(JSON.stringify(ids) === JSON.stringify(['R1', 'R3']), 'normal user sees ONLY rules they created (R1) or manage (R3)');
  pass(!ids.includes('R2'), 'normal user does NOT see an unrelated employee\'s rule (R2)');
  pass(mine.rules.every((r) => !('created_by_account_id' in r) && !('manager_employee_code' in r)), 'list DTO carries no raw ownership/technical columns');

  // 16 + 17 — admin sees all
  const all = await actions.listTaskRecurrence(ADMIN, {});
  pass(all.rules.map((r) => r.id).sort().join(',') === 'R1,R2,R3', 'admin sees every rule');

  // 6 / 8 / 10 / 12 — forged rule_id against another user's rule
  bridgeCalls = [];
  await denied(actions.updateTaskRecurrence(EMP, 'R2', OK_INPUT), 'RECURRENCE_MANAGE_DENIED', 'cannot EDIT another user\'s rule via forged rule_id');
  await denied(actions.pauseTaskRecurrence(EMP, 'R2'), 'RECURRENCE_MANAGE_DENIED', 'cannot PAUSE another user\'s rule');
  await denied(actions.resumeTaskRecurrence(EMP, 'R2'), 'RECURRENCE_MANAGE_DENIED', 'cannot RESUME another user\'s rule');
  await denied(actions.stopTaskRecurrence(EMP, 'R2'), 'RECURRENCE_MANAGE_DENIED', 'cannot STOP another user\'s rule');
  pass(!bridgeCalls.some((c) => c[0] === 'transition' || c[0] === 'update'), 'no bridge write happened for any denied action');

  // 5 / 7 / 11 — can manage OWN rule
  bridgeCalls = [];
  await actions.updateTaskRecurrence(EMP, 'R1', OK_INPUT);
  await actions.pauseTaskRecurrence(EMP, 'R1');
  await actions.stopTaskRecurrence(EMP, 'R1');
  pass(bridgeCalls.some((c) => c[0] === 'update' && c[1] === 'R1'), 'own rule EDIT forwarded to bridge');
  pass(bridgeCalls.some((c) => c[0] === 'transition' && c[1] === 'R1' && c[2] === 'pause'), 'own rule PAUSE forwarded to bridge');
  pass(bridgeCalls.some((c) => c[0] === 'transition' && c[1] === 'R1' && c[2] === 'stop'), 'own rule STOP forwarded to bridge');
  // 9 — resume own paused rule (R3, actor is manager)
  bridgeCalls = [];
  await actions.resumeTaskRecurrence(EMP, 'R3');
  pass(bridgeCalls.some((c) => c[0] === 'transition' && c[1] === 'R3' && c[2] === 'resume'), 'own (managed) paused rule RESUME forwarded to bridge');

  // transition forwards kind only — never a task id / mutation flag
  pass(bridgeCalls.every((c) => c[0] !== 'transition' || c.length === 4), 'transition call carries only (ruleId, kind, actor) — no generated-Task mutation param');

  // :run stays Admin-only
  await denied(actions.runTaskRecurrence(EMP, {}), 'RECURRENCE_RUN_DENIED', 'normal user cannot run the recurrence scheduler');

  // no Supabase anywhere in the action module
  const src = require('fs').readFileSync(path.join(LIB, 'task-recurrence-actions.js'), 'utf8');
  pass(!/require\([^)]*supabase|createClient\s*\(/.test(src), 'action module has no Supabase client usage');

  console.log('\nPHF Task Recurrence access (all-user management): ' + passed + '/' + passed + ' PASS');
})().catch((e) => { console.error(e && e.stack || e); process.exitCode = 1; });
