'use strict';

// TEST/MOCK HARNESS for lib/task-timeline-query-executor.js — NO real DB.
// Same technique as test-task-query-executor-mock-harness.js: inject a fake
// 'pg' module into require.cache before requiring the executor(s).
//
// Proves:
//  - the authorised task set is resolved by executeResolvedTaskQuery() VERBATIM
//    (same signature/TTL/nonce gate — a bad signature is rejected, 0 queries)
//  - ONE bounded task.events query, ordered occurred_at DESC in SQL, LIMIT
//    eventLimit, over exactly the newest TIMELINE_TASK_FANOUT authorised ids
//  - DTO: id/taskId/taskCode/taskTitle/eventType/actorEmployeeCode/payload/
//    reason/occurredAt — taskCode/title come from the list result, no re-query
//  - empty authorised set -> { events: [] }, no events query issued
//  - NO full task-detail assembly (no comments/attachments/links queries)
//
// Run: node test-task-timeline-query-executor-mock-harness.js

const assert = require('assert');
const crypto = require('crypto');

const LIST_EXECUTOR_PATH = require.resolve('./lib/task-query-executor.js');
const TIMELINE_EXECUTOR_PATH = require.resolve('./lib/task-timeline-query-executor.js');
const DB_JS_PATH = require.resolve('./lib/db.js');

function makeFakeClient(script) {
  const calls = [];
  let step = 0;
  return {
    calls,
    async query(sql, params) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      const rule = script[step];
      calls.push({ step, sql: normalized, params });
      step += 1;
      if (!rule) throw new Error(`HARNESS_UNEXPECTED_EXTRA_QUERY: "${normalized}"`);
      if (!rule.expect.test(normalized)) {
        throw new Error(`HARNESS_QUERY_MISMATCH at step ${step - 1}: expected /${rule.expect}/ got "${normalized}"`);
      }
      return rule.result || { rows: [], rowCount: 0 };
    },
    release() {},
  };
}

function makeFakePgModule(client) {
  function FakePool() { return { connect: async () => client, on: () => {} }; }
  return { Pool: FakePool };
}

function loadExecutorsWithFakePg(client) {
  const pgPath = require.resolve('pg');
  delete require.cache[DB_JS_PATH];
  delete require.cache[LIST_EXECUTOR_PATH];
  delete require.cache[TIMELINE_EXECUTOR_PATH];
  const originalPgEntry = require.cache[pgPath];
  require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: makeFakePgModule(client) };
  const timeline = require(TIMELINE_EXECUTOR_PATH);
  if (originalPgEntry) require.cache[pgPath] = originalPgEntry;
  else delete require.cache[pgPath];
  return timeline;
}

let PASS = 0, FAIL = 0;
function check(name, cond) {
  if (cond) { PASS++; } else { FAIL++; console.error('FAIL:', name); }
}

const SECRET = 'test-signing-secret';
function signDescriptor(descriptor, secret) {
  const { signature, ...rest } = descriptor;
  const canon = JSON.stringify(rest, Object.keys(rest).sort());
  const sig = crypto.createHmac('sha256', secret).update(canon).digest('hex');
  return Object.assign({}, rest, { signature: sig });
}
function baseDescriptor(overrides) {
  return Object.assign({
    requesterEmployeeCode: 'PHF012',
    requesterActorType: 'truong_bo_phan',
    mode: 'assignee_in',
    creatorEmployeeCode: null,
    creatorAccountId: null,
    assigneeEmployeeCodes: ['PHF012'],
    flowType: 'giao_viec',
    requirePrimaryRoleActive: true,
    excludeDraft: false,
    crossDepartmentOnly: false,
    statusFilter: 'all',
    search: '',
    offset: 0,
    limit: 60,
    relation: 'received',
    scope: 'default',
    viewScopeType: 'self',
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 15000).toISOString(),
    nonce: crypto.randomBytes(16).toString('hex'),
  }, overrides || {});
}

// The list-resolver preamble + queries for mode=assignee_in / relation=received.
function listResolverScript(taskRows) {
  return [
    { expect: /^BEGIN READ ONLY$/ },
    { expect: /^SET LOCAL ROLE phf_hr_app$/ },
    { expect: /^SET LOCAL statement_timeout/ },
    { expect: /SELECT DISTINCT task_id FROM task\.assignees WHERE role = 'primary' AND is_active = true AND employee_code = ANY\(\$1::text\[\]\)/,
      result: { rows: taskRows.map((t) => ({ task_id: t.id })) } },
    ...(taskRows.length ? [
      { expect: /FROM task\.tasks t LEFT JOIN task\.proposal_decisions pd .* ORDER BY t\.created_at DESC, t\.id ASC/,
        result: { rows: taskRows.map((t) => ({
          id: t.id, task_code: t.task_code, flow_type: 'giao_viec', status: 'in_progress',
          title: t.title, priority: 'thuong', deadline: '2026-09-30T00:00:00Z',
          category_code: 'NHAN_SU', progress_percent: 0, progress_status: 'chua_bat_dau',
          created_by_employee_code: 'PHF001', created_by_account_id: null, recurring_series_id: null,
          is_cross_department: false, source_department: null, target_department: null,
          created_at: t.created_at, row_version: 1,
          proposal_status: null, recipient_employee_code: null, generated_task_id: null,
          reject_reason: null, cancel_reason: null, decided_by_employee_code: null, decided_at: null,
          proposal_generated: false,
        })) } },
      { expect: /SELECT task_id, employee_code\s+FROM task\.assignees WHERE role = 'primary' AND is_active = true AND task_id = ANY/,
        result: { rows: taskRows.map((t) => ({ task_id: t.id, employee_code: 'PHF012' })) } },
      { expect: /SELECT DISTINCT ON \(task_id\) task_id, employee_code\s+FROM task\.assignees WHERE role = 'primary' AND task_id = ANY/,
        result: { rows: taskRows.map((t) => ({ task_id: t.id, employee_code: 'PHF012' })) } },
    ] : []),
    { expect: /^COMMIT$/ },
  ];
}

async function run() {
  /* ===== 1. happy path — 2 tasks, 3 events, one bounded query ===== */
  {
    const tasks = [
      { id: 't-uuid-1', task_code: 'CV-2609-0001', title: 'Kiểm kê kho', created_at: '2026-09-06T00:00:00Z' },
      { id: 't-uuid-2', task_code: 'CV-2609-0002', title: 'Báo cáo tuần', created_at: '2026-09-05T00:00:00Z' },
    ];
    const script = [
      ...listResolverScript(tasks),
      { expect: /^BEGIN READ ONLY$/ },
      { expect: /^SET LOCAL ROLE phf_hr_app$/ },
      { expect: /^SET LOCAL statement_timeout/ },
      { expect: /SELECT e\.id, e\.task_id, e\.event_type, e\.actor_employee_code, e\.payload, e\.reason, e\.occurred_at FROM task\.events e WHERE e\.task_id = ANY\(\$1::uuid\[\]\) ORDER BY e\.occurred_at DESC, e\.id DESC LIMIT \$2/,
        result: { rows: [
          { id: 'ev-3', task_id: 't-uuid-1', event_type: 'progress', actor_employee_code: 'PHF012', payload: { percent: 40 }, reason: null, occurred_at: '2026-09-06T10:00:00Z' },
          { id: 'ev-2', task_id: 't-uuid-2', event_type: 'completion', actor_employee_code: 'PHF012', payload: {}, reason: 'done', occurred_at: '2026-09-05T09:00:00Z' },
          { id: 'ev-1', task_id: 't-uuid-1', event_type: 'transfer', actor_employee_code: 'PHF001', payload: {}, reason: null, occurred_at: '2026-09-04T08:00:00Z' },
        ] } },
      { expect: /^COMMIT$/ },
    ];
    const client = makeFakeClient(script);
    const { executeResolvedTaskTimelineQuery } = loadExecutorsWithFakePg(client);
    const descriptor = signDescriptor(baseDescriptor(), SECRET);
    const result = await executeResolvedTaskTimelineQuery({}, descriptor, SECRET, { eventLimit: 150 });

    const eventsCall = client.calls.find((c) => /FROM task\.events e/.test(c.sql));
    check('1: exactly one task.events query issued', client.calls.filter((c) => /FROM task\.events e/.test(c.sql)).length === 1);
    check('1b: events query param $1 = the two authorised task ids', JSON.stringify(eventsCall.params[0]) === JSON.stringify(['t-uuid-1', 't-uuid-2']));
    check('1c: events query param $2 = eventLimit (150)', eventsCall.params[1] === 150);
    check('1d: ordered occurred_at DESC, id DESC in SQL (no JS re-sort needed)', /ORDER BY e\.occurred_at DESC, e\.id DESC/.test(eventsCall.sql));
    check('1e: NO full task-detail assembly — no comments/attachments/links query', !client.calls.some((c) => /task\.comments|task\.attachments|task\.links/.test(c.sql)));
    check('1f: 3 events returned in SQL order', result.events.map((e) => e.id).join(',') === 'ev-3,ev-2,ev-1');

    const e0 = result.events[0];
    check('1g: DTO id', e0.id === 'ev-3');
    check('1h: DTO taskId', e0.taskId === 't-uuid-1');
    check('1i: DTO taskCode from the list result (not re-queried)', e0.taskCode === 'CV-2609-0001');
    check('1j: DTO taskTitle from the list result', e0.taskTitle === 'Kiểm kê kho');
    check('1k: DTO eventType', e0.eventType === 'progress');
    check('1l: DTO actorEmployeeCode (name enriched later in main app)', e0.actorEmployeeCode === 'PHF012');
    check('1m: DTO payload passthrough', JSON.stringify(e0.payload) === JSON.stringify({ percent: 40 }));
    check('1n: DTO reason passthrough (null)', e0.reason === null);
    check('1o: DTO reason passthrough (string)', result.events[1].reason === 'done');
    check('1p: DTO occurredAt passthrough', e0.occurredAt === '2026-09-06T10:00:00Z');
    check('1q: base relation/scope/viewScopeType/requesterActorType echoed from the list resolver',
      result.relation === 'received' && result.scope === 'default' && result.viewScopeType === 'self' && result.requesterActorType === 'truong_bo_phan');
  }

  /* ===== 2. empty authorised set -> no events query ===== */
  {
    const script = [...listResolverScript([])];
    const client = makeFakeClient(script);
    const { executeResolvedTaskTimelineQuery } = loadExecutorsWithFakePg(client);
    const descriptor = signDescriptor(baseDescriptor(), SECRET);
    const result = await executeResolvedTaskTimelineQuery({}, descriptor, SECRET, { eventLimit: 150 });
    check('2: empty authorised task set -> events: []', Array.isArray(result.events) && result.events.length === 0);
    check('2b: NO task.events query issued when nothing is authorised', !client.calls.some((c) => /FROM task\.events e/.test(c.sql)));
    check('2c: base still echoed on the empty path', result.relation === 'received');
  }

  /* ===== 3. TIMELINE_TASK_FANOUT cap — 61 authorised tasks -> newest 60 ===== */
  {
    const many = [];
    for (let i = 0; i < 61; i++) many.push({ id: 'm-' + i, task_code: 'CV-' + i, title: 'T' + i, created_at: '2026-09-0' + (1 + (i % 7)) + 'T00:00:00Z' });
    const script = [
      ...listResolverScript(many),
      { expect: /^BEGIN READ ONLY$/ }, { expect: /^SET LOCAL ROLE/ }, { expect: /^SET LOCAL statement_timeout/ },
      { expect: /FROM task\.events e WHERE e\.task_id = ANY/, result: { rows: [] } },
      { expect: /^COMMIT$/ },
    ];
    const client = makeFakeClient(script);
    const { executeResolvedTaskTimelineQuery, TIMELINE_TASK_FANOUT } = loadExecutorsWithFakePg(client);
    const descriptor = signDescriptor(baseDescriptor(), SECRET);
    await executeResolvedTaskTimelineQuery({}, descriptor, SECRET, { eventLimit: 100 });
    const eventsCall = client.calls.find((c) => /FROM task\.events e/.test(c.sql));
    check('3: events query scoped to newest TIMELINE_TASK_FANOUT (60) task ids', eventsCall.params[0].length === TIMELINE_TASK_FANOUT && TIMELINE_TASK_FANOUT === 60);
    check('3b: the 61st task id is excluded', !eventsCall.params[0].includes('m-60'));
  }

  /* ===== 4. authorization reuse — bad signature rejected, 0 queries ===== */
  {
    const client = makeFakeClient([]); // nothing should run
    const { executeResolvedTaskTimelineQuery } = loadExecutorsWithFakePg(client);
    const tampered = signDescriptor(baseDescriptor(), SECRET);
    tampered.assigneeEmployeeCodes = ['PHF999']; // change AFTER signing -> signature no longer matches
    let threw = null;
    try { await executeResolvedTaskTimelineQuery({}, tampered, SECRET, { eventLimit: 100 }); }
    catch (e) { threw = e; }
    check('4: tampered descriptor is rejected by the reused list resolver', threw && (threw.code === 'SIGNATURE_INVALID' || /DESCRIPTOR_REJECTED/.test(threw.message)));
    check('4b: statusCode 401 propagated', threw && threw.statusCode === 401);
    check('4c: NO DB query issued for a rejected descriptor', client.calls.length === 0);
  }

  /* ===== 5. eventLimit clamp ===== */
  {
    const tasks = [{ id: 'z1', task_code: 'CV-Z1', title: 'Z1', created_at: '2026-09-06T00:00:00Z' }];
    function scriptFor() {
      return [
        ...listResolverScript(tasks),
        { expect: /^BEGIN READ ONLY$/ }, { expect: /^SET LOCAL ROLE/ }, { expect: /^SET LOCAL statement_timeout/ },
        { expect: /FROM task\.events e/, result: { rows: [] } },
        { expect: /^COMMIT$/ },
      ];
    }
    let client = makeFakeClient(scriptFor());
    let m = loadExecutorsWithFakePg(client);
    await m.executeResolvedTaskTimelineQuery({}, signDescriptor(baseDescriptor(), SECRET), SECRET, { eventLimit: 99999 });
    check('5: eventLimit clamped to 200', client.calls.find((c) => /FROM task\.events e/.test(c.sql)).params[1] === 200);

    client = makeFakeClient(scriptFor());
    m = loadExecutorsWithFakePg(client);
    await m.executeResolvedTaskTimelineQuery({}, signDescriptor(baseDescriptor(), SECRET), SECRET, {});
    check('5b: missing eventLimit -> default 100', client.calls.find((c) => /FROM task\.events e/.test(c.sql)).params[1] === 100);
  }

  console.log(`\nPHF Task Timeline query executor mock harness: ${PASS}/${PASS + FAIL} PASS`);
  if (FAIL > 0) process.exit(1);
}

run().catch((err) => { console.error('HARNESS_CRASH', err); process.exit(1); });
