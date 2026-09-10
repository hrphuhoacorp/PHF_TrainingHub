'use strict';

// TEST/MOCK HARNESS cho lib/task-query-executor.js — TASK LIST USABILITY V1
// (2026-09-10, smart default ORDER BY + Filter V1). KHÔNG kết nối DB thật —
// cùng kỹ thuật inject module 'pg' giả đã dùng ở test-task-query-executor-
// mock-harness.js / test-task-cancel-request-usability-v1.js.
//
// Covers:
//   A. ORDER BY — exact SQL text present on every statusFilter branch (the
//      SAME clause reused everywhere, proving no per-tab divergence), PLUS a
//      standalone JS simulation of the identical rule (deadline ASC NULLS
//      LAST -> overdue-before-future-before-no-deadline in one pass;
//      priority tie-break; created_at DESC final tie-break) against
//      hand-built rows including the operator's own example dates
//      (11/09/2026 vs 31/05/2027) — proves the RULE itself is correct, the
//      SQL-text assertions prove phf-hr-api actually SENDS that rule to
//      Postgres. (Real ORDER BY execution requires a live DB — out of scope
//      for a mock harness; this is the same "assert exact SQL text" proof
//      standard already used by every other *-mock-harness.js in this repo.)
//   B. deadline label rule (frontend, pure function) — see
//      scripts/test-task-list-usability-ui-v1.js for the DOM-level cover;
//      here only the ORDER BY the label is READING off of.
//   C. Filter V1 — cancelled status (real WHERE now, not silently coerced),
//      priority/category/date-range/creator/primary WHERE clauses
//      individually and combined (2-3 at once), Primary's set-based
//      subquery (no N+1 — one extra WHERE fragment, zero extra round-trip),
//      pagination (limit+1/offset) and search still work alongside filters,
//      and relation/scope (permission) resolution is UNCHANGED (reuses
//      test-task-query-descriptor-builder-scope-fix.js's proven branching,
//      not re-tested here — this file only covers the NEW filter fields).
//
// Chạy: node test-task-list-usability-v1.js

const assert = require('assert');
const crypto = require('crypto');

const DB_JS_PATH = require.resolve('./lib/db.js');
const EXEC_PATH = require.resolve('./lib/task-query-executor.js');

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
    release() { calls.push({ step: 'release' }); },
  };
}
function makeFakePgModule(client) {
  function FakePool() { return { connect: async () => client, on: () => {} }; }
  return { Pool: FakePool };
}
function loadExecutorWithFakePg(client) {
  const pgPath = require.resolve('pg');
  delete require.cache[DB_JS_PATH];
  delete require.cache[EXEC_PATH];
  const originalPgEntry = require.cache[pgPath];
  require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: makeFakePgModule(client) };
  const executor = require(EXEC_PATH);
  if (originalPgEntry) require.cache[pgPath] = originalPgEntry;
  else delete require.cache[pgPath];
  return executor;
}

const MOCK_CONFIG = {
  PHF_HR_DB_HOST: 'mock-host-not-real', PHF_HR_DB_PORT: 5432, PHF_HR_DB_NAME: 'mock-db-not-real',
  PHF_HR_DB_RUNTIME_USER: 'mock-user-not-real', PHF_HR_DB_RUNTIME_PASSWORD: 'mock-password-not-real',
};
const SECRET = 'mock-signing-secret-not-real';
function canonicalSortedJson(obj) { return JSON.stringify(obj, Object.keys(obj).sort()); }
function sign(descriptor) {
  const signature = crypto.createHmac('sha256', SECRET).update(canonicalSortedJson(descriptor)).digest('hex');
  return { ...descriptor, signature };
}
function baseDescriptor(overrides) {
  const now = Date.now();
  return sign(Object.assign({
    requesterEmployeeCode: 'PHF001', requesterActorType: 'nhan_vien', mode: 'assignee_in',
    creatorEmployeeCode: null, creatorAccountId: null, assigneeEmployeeCodes: ['PHF001'],
    flowType: 'giao_viec', requirePrimaryRoleActive: true, excludeDraft: true, crossDepartmentOnly: false,
    statusFilter: 'all', search: '',
    priorityFilter: '', categoryFilter: '', creatorFilter: '', primaryFilter: '', deadlineFrom: '', deadlineTo: '',
    offset: 0, limit: 50, relation: 'received', scope: 'default', viewScopeType: 'self',
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 15000).toISOString(),
    nonce: crypto.randomBytes(16).toString('hex'),
  }, overrides));
}
const ORDER_BY_RE = /ORDER BY CASE WHEN t\.status IN \('published', 'in_progress'\) THEN 0 ELSE 1 END, t\.deadline ASC NULLS LAST, CASE t\.priority WHEN 'khan_cap' THEN 0 WHEN 'quan_trong' THEN 1 ELSE 2 END, t\.created_at DESC, t\.id ASC/;
const ASSIGNEE_LOOKUP_RE = /^SELECT DISTINCT task_id FROM task\.assignees WHERE role = 'primary' AND is_active = true AND employee_code = ANY\(\$1::text\[\]\)/;
const PRIMARY_LOOKUP_RE = /^SELECT task_id, employee_code FROM task\.assignees WHERE role = 'primary' AND is_active = true AND task_id = ANY\(\$1::uuid\[\]\)$/;
const INITIAL_PRIMARY_RE = /^SELECT DISTINCT ON \(task_id\) task_id, employee_code FROM task\.assignees WHERE role = 'primary' AND task_id = ANY\(\$1::uuid\[\]\) ORDER BY task_id, assigned_at ASC, id ASC$/;

let PASS = 0, FAIL = 0;
function check(name, cond) { if (cond) { PASS++; } else { FAIL++; console.error('FAIL:', name); } }

(async function run() {
  // ===========================================================================
  // A. ORDER BY — same clause present regardless of statusFilter (proves no
  //    per-tab divergence: 'all', 'in_progress', 'overdue', 'completed',
  //    'cancelled' all reuse the identical smart-default sort).
  // ===========================================================================
  for (const statusFilter of ['all', 'in_progress', 'overdue', 'completed', 'cancelled']) {
    const client = makeFakeClient([
      { expect: /^BEGIN READ ONLY$/ }, { expect: /^SET LOCAL ROLE phf_hr_app$/ }, { expect: /^SET LOCAL statement_timeout/ },
      { expect: ORDER_BY_RE, result: { rows: [] } },
      { expect: /^COMMIT$/ },
    ]);
    const { executeResolvedTaskQuery } = loadExecutorWithFakePg(client);
    // assigneeEmployeeCodes: null -> company-wide, mode=assignee_in skips the
    // extra assignee-lookup round-trip, isolating this check to ORDER BY text.
    const out = await executeResolvedTaskQuery(MOCK_CONFIG, baseDescriptor({ statusFilter, assigneeEmployeeCodes: null }), SECRET);
    check(`A1 [${statusFilter}]: ORDER BY clause present and identical`, out.data.length === 0);
  }

  // ===========================================================================
  // A2. JS simulation of the exact SQL rule — proves the RULE ITSELF is
  //     correct against the operator's own worked examples. This mirrors
  //     (does not import) lib/task-query-executor.js's TASK_LIST_ORDER_BY —
  //     documented as a spec-compliance check, not a substitute for the
  //     SQL-text assertions above.
  // ===========================================================================
  function priorityRank(p) { return p === 'khan_cap' ? 0 : p === 'quan_trong' ? 1 : 2; }
  function activeRank(status) { return (status === 'published' || status === 'in_progress') ? 0 : 1; }
  function simulateOrder(rows) {
    return rows.slice().sort((a, b) => {
      const ar = activeRank(a.status), br = activeRank(b.status);
      if (ar !== br) return ar - br;
      const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      const ap = priorityRank(a.priority), bp = priorityRank(b.priority);
      if (ap !== bp) return ap - bp;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime(); // DESC
    });
  }
  {
    const now = Date.now();
    const rows = [
      { id: 'future-2027', status: 'published', deadline: '2027-05-31T00:00:00Z', priority: 'thuong', created_at: '2026-01-01T00:00:00Z' },
      { id: 'near-2026-09-11', status: 'published', deadline: '2026-09-11T00:00:00Z', priority: 'thuong', created_at: '2026-09-01T00:00:00Z' },
      { id: 'overdue-2d', status: 'in_progress', deadline: new Date(now - 2 * 86400000).toISOString(), priority: 'thuong', created_at: '2026-08-01T00:00:00Z' },
      { id: 'no-deadline', status: 'published', deadline: null, priority: 'khan_cap', created_at: '2026-09-09T00:00:00Z' }, // even khẩn cấp priority never beats a dated Task
      { id: 'completed-old', status: 'completed', deadline: '2026-01-01T00:00:00Z', priority: 'thuong', created_at: '2026-01-01T00:00:00Z' },
    ];
    const ordered = simulateOrder(rows).map((r) => r.id);
    check('A2a: overdue Task stands before a future-dated Task', ordered.indexOf('overdue-2d') < ordered.indexOf('near-2026-09-11'));
    check('A2b: 11/09/2026 deadline stands before 31/05/2027 deadline (operator worked example)', ordered.indexOf('near-2026-09-11') < ordered.indexOf('future-2027'));
    check('A2c: no-deadline Task stands AFTER every dated active Task, even with khan_cap priority', ordered.indexOf('no-deadline') > ordered.indexOf('future-2027'));
    check('A2d: completed Task (inactive) sinks to the bottom regardless of its own deadline', ordered[ordered.length - 1] === 'completed-old');
  }
  {
    // A2e/f: priority ONLY breaks ties on an IDENTICAL deadline — never
    // reorders across different deadlines.
    const sameDeadline = '2026-09-20T00:00:00Z';
    const rows = [
      { id: 'thuong', status: 'published', deadline: sameDeadline, priority: 'thuong', created_at: '2026-01-01T00:00:00Z' },
      { id: 'khan_cap', status: 'published', deadline: sameDeadline, priority: 'khan_cap', created_at: '2026-01-01T00:00:00Z' },
      { id: 'quan_trong', status: 'published', deadline: sameDeadline, priority: 'quan_trong', created_at: '2026-01-01T00:00:00Z' },
    ];
    const ordered = simulateOrder(rows).map((r) => r.id);
    check('A2e: priority tie-break on identical deadline — khan_cap first, then quan_trong, then thuong', ordered.join(',') === 'khan_cap,quan_trong,thuong');
    const laterDeadlineHighPriority = [
      { id: 'near-thuong', status: 'published', deadline: '2026-09-15T00:00:00Z', priority: 'thuong', created_at: '2026-01-01T00:00:00Z' },
      { id: 'far-khan_cap', status: 'published', deadline: '2026-12-01T00:00:00Z', priority: 'khan_cap', created_at: '2026-01-01T00:00:00Z' },
    ];
    const ordered2 = simulateOrder(laterDeadlineHighPriority).map((r) => r.id);
    check('A2f: priority NEVER overrides a nearer deadline (tie-breaker only, per spec)', ordered2[0] === 'near-thuong');
  }

  // ===========================================================================
  // C1. 'cancelled' status filter — REAL WHERE now (was silently coerced to
  //     'all' before this batch — the exact drift the lock calls out).
  // ===========================================================================
  {
    const client = makeFakeClient([
      { expect: /^BEGIN READ ONLY$/ }, { expect: /^SET LOCAL ROLE phf_hr_app$/ }, { expect: /^SET LOCAL statement_timeout/ },
      { expect: ASSIGNEE_LOOKUP_RE, result: { rows: [{ task_id: 't1' }] } },
      { expect: /WHERE flow_type = \$1 AND id = ANY\(\$2::uuid\[\]\) AND status <> 'draft' AND status = 'cancelled' ORDER BY/, result: { rows: [{ id: 't1', task_code: 'CV-1', flow_type: 'giao_viec', status: 'cancelled', title: 'x', priority: 'thuong', deadline: null, created_at: '2026-01-01', row_version: 1 }] } },
      { expect: PRIMARY_LOOKUP_RE, result: { rows: [] } },
      { expect: INITIAL_PRIMARY_RE, result: { rows: [] } },
      { expect: /^COMMIT$/ },
    ]);
    const { executeResolvedTaskQuery } = loadExecutorWithFakePg(client);
    const out = await executeResolvedTaskQuery(MOCK_CONFIG, baseDescriptor({ statusFilter: 'cancelled' }), SECRET);
    check('C1: statusFilter=cancelled sends a REAL "status = \'cancelled\'" WHERE clause (not coerced to all)', out.data.length === 1 && out.data[0].status === 'cancelled');
  }

  // ===========================================================================
  // C2. priority / category / date-range / creator individually, then 3
  //     combined at once — proves clauses compose (AND) correctly and every
  //     value is parameterized (never string-concatenated).
  // ===========================================================================
  {
    const client = makeFakeClient([
      { expect: /^BEGIN READ ONLY$/ }, { expect: /^SET LOCAL ROLE phf_hr_app$/ }, { expect: /^SET LOCAL statement_timeout/ },
      { expect: /priority = \$\d+/, result: { rows: [] } },
      { expect: /^COMMIT$/ },
    ]);
    const { executeResolvedTaskQuery } = loadExecutorWithFakePg(client);
    await executeResolvedTaskQuery(MOCK_CONFIG, baseDescriptor({ priorityFilter: 'khan_cap', assigneeEmployeeCodes: null }), SECRET);
    check('C2a: priority filter -> parameterized "priority = $N"', client.calls[3].sql.includes('priority = $') && client.calls[3].params.includes('khan_cap'));
  }
  {
    const client = makeFakeClient([
      { expect: /^BEGIN READ ONLY$/ }, { expect: /^SET LOCAL ROLE phf_hr_app$/ }, { expect: /^SET LOCAL statement_timeout/ },
      { expect: /category_code = \$\d+/, result: { rows: [] } },
      { expect: /^COMMIT$/ },
    ]);
    const { executeResolvedTaskQuery } = loadExecutorWithFakePg(client);
    await executeResolvedTaskQuery(MOCK_CONFIG, baseDescriptor({ categoryFilter: 'BAO_CAO', assigneeEmployeeCodes: null }), SECRET);
    check('C2b: category filter -> parameterized "category_code = $N"', client.calls[3].sql.includes('category_code = $') && client.calls[3].params.includes('BAO_CAO'));
  }
  {
    const client = makeFakeClient([
      { expect: /^BEGIN READ ONLY$/ }, { expect: /^SET LOCAL ROLE phf_hr_app$/ }, { expect: /^SET LOCAL statement_timeout/ },
      { expect: /deadline >= \$\d+ AND deadline <= \$\d+/, result: { rows: [] } },
      { expect: /^COMMIT$/ },
    ]);
    const { executeResolvedTaskQuery } = loadExecutorWithFakePg(client);
    await executeResolvedTaskQuery(MOCK_CONFIG, baseDescriptor({ deadlineFrom: '2026-09-01T00:00:00.000Z', deadlineTo: '2026-09-30T23:59:59.000Z', assigneeEmployeeCodes: null }), SECRET);
    check('C2c: deadline range filter -> parameterized ">=" AND "<="', client.calls[3].sql.includes('deadline >=') && client.calls[3].sql.includes('deadline <='));
  }
  {
    // 'received' relation -> mode stays assignee_in; creator filter is a
    // narrowing AND on top (never widens the already-authorized population).
    const client = makeFakeClient([
      { expect: /^BEGIN READ ONLY$/ }, { expect: /^SET LOCAL ROLE phf_hr_app$/ }, { expect: /^SET LOCAL statement_timeout/ },
      { expect: /t\.created_by_employee_code = \$\d+/, result: { rows: [] } },
      { expect: /^COMMIT$/ },
    ]);
    const { executeResolvedTaskQuery } = loadExecutorWithFakePg(client);
    await executeResolvedTaskQuery(MOCK_CONFIG, baseDescriptor({ creatorFilter: 'PHF090', assigneeEmployeeCodes: null }), SECRET);
    check('C2d: creator filter on relation=received -> parameterized "t.created_by_employee_code = $N" (qualified, no ambiguity with proposal_decisions)', client.calls[3].sql.includes('t.created_by_employee_code = $') && client.calls[3].params.includes('PHF090'));
  }
  {
    // primary filter -> set-based subquery, ONE extra WHERE fragment, ZERO
    // extra round-trip (no N+1).
    const client = makeFakeClient([
      { expect: /^BEGIN READ ONLY$/ }, { expect: /^SET LOCAL ROLE phf_hr_app$/ }, { expect: /^SET LOCAL statement_timeout/ },
      { expect: /id IN \(SELECT task_id FROM task\.assignees WHERE role = 'primary' AND is_active = true AND employee_code = \$\d+\)/, result: { rows: [] } },
      { expect: /^COMMIT$/ },
    ]);
    const { executeResolvedTaskQuery } = loadExecutorWithFakePg(client);
    await executeResolvedTaskQuery(MOCK_CONFIG, baseDescriptor({ relation: 'assigned', mode: 'creator_eq', creatorEmployeeCode: 'PHF001', assigneeEmployeeCodes: null, primaryFilter: 'PHF080' }), SECRET);
    const queryCalls = client.calls.filter((c) => c.sql);
    check('C2e: Primary filter -> ONE set-based subquery WHERE fragment, no extra query round-trip (N_PLUS_ONE=NO)', queryCalls.length === 5 && queryCalls[3].sql.includes('id IN (SELECT task_id FROM task.assignees'));
  }
  {
    // C3: 3 filters combined at once (priority + category + deadline range)
    // still AND together correctly, plus search + pagination untouched.
    const client = makeFakeClient([
      { expect: /^BEGIN READ ONLY$/ }, { expect: /^SET LOCAL ROLE phf_hr_app$/ }, { expect: /^SET LOCAL statement_timeout/ },
      { expect: ASSIGNEE_LOOKUP_RE, result: { rows: [{ task_id: 't1' }] } },
      {
        expect: /\(task_code ILIKE \$\d+ OR title ILIKE \$\d+\) AND priority = \$\d+ AND category_code = \$\d+ AND deadline >= \$\d+ AND deadline <= \$\d+ ORDER BY/,
        result: { rows: [{ id: 't1', task_code: 'CV-1', flow_type: 'giao_viec', status: 'published', title: 'kiem tra', priority: 'khan_cap', deadline: '2026-09-15', category_code: 'BAO_CAO', created_at: '2026-01-01', row_version: 1 }] },
      },
      { expect: PRIMARY_LOOKUP_RE, result: { rows: [] } },
      { expect: INITIAL_PRIMARY_RE, result: { rows: [] } },
      { expect: /^COMMIT$/ },
    ]);
    const { executeResolvedTaskQuery } = loadExecutorWithFakePg(client);
    const out = await executeResolvedTaskQuery(MOCK_CONFIG, baseDescriptor({
      search: 'kiem tra', priorityFilter: 'khan_cap', categoryFilter: 'BAO_CAO',
      deadlineFrom: '2026-09-01T00:00:00.000Z', deadlineTo: '2026-09-30T23:59:59.000Z',
    }), SECRET);
    check('C3: search + 3 filters combined (priority+category+date-range) AND together correctly', out.data.length === 1 && out.data[0].taskCode === 'CV-1');
    // pagination params still correct (limit+1 / offset), proving filters
    // don't disturb the existing pagination contract.
    const mainCall = client.calls[4];
    check('C3b: pagination untouched — LIMIT param = descriptor.limit+1 (hasMore probe)', mainCall.params[mainCall.params.length - 2] === 51);
    check('C3c: pagination untouched — OFFSET param = descriptor.offset', mainCall.params[mainCall.params.length - 1] === 0);
  }

  // ===========================================================================
  // C4. Permission/list scope (mode / assigneeEmployeeCodes resolution) is
  //     UNCHANGED — the Filter V1 fields are pure additive AND conditions,
  //     never touching the WHO-can-see-WHAT population already resolved by
  //     scope/relation. Verified here at the EXECUTOR level (does the
  //     already-authorized assignee/creator WHERE clause still appear
  //     unchanged when filters are also present); the full scope BRANCHING
  //     logic itself is covered by scripts/test-task-query-descriptor-
  //     builder-scope-fix.js (12/12 PASS, unaffected by this batch).
  // ===========================================================================
  {
    const client = makeFakeClient([
      { expect: /^BEGIN READ ONLY$/ }, { expect: /^SET LOCAL ROLE phf_hr_app$/ }, { expect: /^SET LOCAL statement_timeout/ },
      { expect: ASSIGNEE_LOOKUP_RE, result: { rows: [{ task_id: 't1' }] } },
      { expect: /id = ANY\(\$2::uuid\[\]\) AND status <> 'draft' AND priority = \$3 ORDER BY/, result: { rows: [] } },
      { expect: /^COMMIT$/ },
    ]);
    const { executeResolvedTaskQuery } = loadExecutorWithFakePg(client);
    await executeResolvedTaskQuery(MOCK_CONFIG, baseDescriptor({ assigneeEmployeeCodes: ['PHF001'], priorityFilter: 'thuong' }), SECRET);
    check('C4: the authorized-population WHERE (id = ANY(assignee-scoped ids)) still runs BEFORE and independent of the new priority filter — scope untouched', client.calls[3].sql.includes('SELECT DISTINCT task_id') && client.calls[4].sql.includes('id = ANY'));
  }

  console.log(`PHF Task List Usability V1 (mock harness): ${PASS}/${PASS + FAIL} PASS`);
  if (FAIL > 0) process.exit(1);
})();
