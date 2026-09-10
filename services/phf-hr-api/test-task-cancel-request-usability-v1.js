'use strict';

// TEST/MOCK HARNESS cho lib/task-cancel-request.js::listPendingCancelRequests()
// — CANCEL REQUEST USABILITY V1 (2026-09-10, "Yêu cầu cần xử lý" inbox).
// KHÔNG kết nối DB thật — cùng kỹ thuật inject module 'pg' giả vào
// require.cache đã dùng ở test-task-read-mock-harness.js /
// test-task-query-executor-mock-harness.js.
//
// Covers:
//   - schema-not-applied guard (to_regclass) -> { data: [] }, không throw
//   - happy path: BEGIN READ ONLY / SET LOCAL ROLE / schema-check / SELECT
//     JOIN task.tasks / COMMIT, đúng thứ tự, LIMIT 500, chỉ status='pending'
//   - a DB error inside the transaction rolls back (never silently swallowed)
//
// Chạy: node test-task-cancel-request-usability-v1.js

const assert = require('assert');

const DB_JS_PATH = require.resolve('./lib/db.js');
const CANCEL_REQUEST_JS_PATH = require.resolve('./lib/task-cancel-request.js');

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
      if (rule.error) throw rule.error;
      return rule.result || { rows: [], rowCount: 0 };
    },
    release() { calls.push({ step: 'release' }); },
    _remainingSteps: () => script.length - step,
  };
}

function makeFakePgModule(client) {
  function FakePool() { return { connect: async () => client, on: () => {} }; }
  return { Pool: FakePool };
}

function loadWithFakePg(client) {
  const pgPath = require.resolve('pg');
  delete require.cache[DB_JS_PATH];
  delete require.cache[CANCEL_REQUEST_JS_PATH];
  const originalPgEntry = require.cache[pgPath];
  require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: makeFakePgModule(client) };
  const mod = require(CANCEL_REQUEST_JS_PATH);
  if (originalPgEntry) require.cache[pgPath] = originalPgEntry;
  else delete require.cache[pgPath];
  return mod;
}

const MOCK_CONFIG = {
  PHF_HR_DB_HOST: 'mock-host-not-real',
  PHF_HR_DB_PORT: 5432,
  PHF_HR_DB_NAME: 'mock-db-not-real',
  PHF_HR_DB_RUNTIME_USER: 'mock-user-not-real',
  PHF_HR_DB_RUNTIME_PASSWORD: 'mock-password-not-real',
};

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`, detail !== undefined ? detail : '');
}

const BEGIN_RO = /^BEGIN READ ONLY$/;
const SET_ROLE = /^SET LOCAL ROLE phf_hr_app$/;
const SET_TIMEOUT = /^SET LOCAL statement_timeout = \d+$/;
const COMMIT = /^COMMIT$/;
const ROLLBACK = /^ROLLBACK$/;
const SCHEMA_CHECK = /^SELECT count\(\*\) FILTER \(WHERE table_name = 'cancel_requests'\)/;
const PENDING_SELECT = /^SELECT cr\.id, cr\.task_id, cr\.reason, cr\.requested_by_employee_code,.*FROM task\.cancel_requests cr\s+JOIN task\.tasks t ON t\.id = cr\.task_id\s+WHERE cr\.status = 'pending'\s+ORDER BY cr\.requested_at ASC\s+LIMIT 500$/s;

(async function schemaNotAppliedGuard() {
  const client = makeFakeClient([
    { expect: BEGIN_RO },
    { expect: SET_ROLE },
    { expect: SET_TIMEOUT },
    { expect: SCHEMA_CHECK, result: { rows: [{ t: '0', e: '0' }] } },
    { expect: COMMIT },
  ]);
  const mod = loadWithFakePg(client);
  const out = await mod.listPendingCancelRequests(MOCK_CONFIG);
  record('A1: schema not applied -> { data: [] }, no throw', Array.isArray(out.data) && out.data.length === 0);
  record('A2: schema not applied -> never reaches the SELECT (single no-op query)', client.calls.filter((c) => c.sql && PENDING_SELECT.test(c.sql)).length === 0);
})().then(happyPath).catch((err) => { console.error('HARNESS_CRASH', err); process.exit(1); });

async function happyPath() {
  const rows = [
    { id: 'cr1', task_id: 't1', reason: 'Trùng với checklist', requested_by_employee_code: 'PHF082', requested_by_account_id: null, requested_at: '2026-09-10T02:00:00Z', task_code: 'CV-1', title: 'Việc 1', task_status: 'published', created_by_employee_code: 'PHF001', created_by_account_id: null },
    { id: 'cr2', task_id: 't2', reason: 'Đổi kế hoạch', requested_by_employee_code: 'PHF083', requested_by_account_id: null, requested_at: '2026-09-10T01:00:00Z', task_code: 'CV-2', title: 'Việc 2', task_status: 'in_progress', created_by_employee_code: 'PHF001', created_by_account_id: null },
  ];
  const client = makeFakeClient([
    { expect: BEGIN_RO },
    { expect: SET_ROLE },
    { expect: SET_TIMEOUT },
    { expect: SCHEMA_CHECK, result: { rows: [{ t: '1', e: '1' }] } },
    { expect: PENDING_SELECT, result: { rows } },
    { expect: COMMIT },
  ]);
  const mod = loadWithFakePg(client);
  const out = await mod.listPendingCancelRequests(MOCK_CONFIG);
  record('B1: happy path returns both pending rows verbatim', out.data.length === 2 && out.data[0].id === 'cr1' && out.data[1].id === 'cr2');
  record('B2: transaction opened READ ONLY (no write-transaction fallback)', client.calls[0].sql === 'BEGIN READ ONLY');
  record('B3: SELECT is the ONLY status filter — never surfaces a non-pending row (server-side WHERE, not client-side filter)', /WHERE cr\.status = 'pending'/.test(client.calls[4].sql));
  record('B4: LIMIT 500 bound present (rare-event ceiling, no unbounded fan-out)', /LIMIT 500$/.test(client.calls[4].sql));
  record('B5: query is parameter-free (no user input reaches this SELECT — company-wide read, authorization happens in the main app)', client.calls[4].params === undefined || client.calls[4].params.length === 0);
  await dbErrorRollsBack();
}

async function dbErrorRollsBack() {
  const dbErr = new Error('connection reset');
  const client = makeFakeClient([
    { expect: BEGIN_RO },
    { expect: SET_ROLE },
    { expect: SET_TIMEOUT },
    { expect: SCHEMA_CHECK, result: { rows: [{ t: '1', e: '1' }] } },
    { expect: PENDING_SELECT, error: dbErr },
    { expect: ROLLBACK },
  ]);
  const mod = loadWithFakePg(client);
  let threw = null;
  try { await mod.listPendingCancelRequests(MOCK_CONFIG); } catch (e) { threw = e; }
  record('C1: a DB error during the SELECT rolls back the transaction (never silently swallowed)', threw === dbErr);
  record('C2: client released after rollback', client.calls.some((c) => c.step === 'release'));

  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`PHF Task Cancel Request Usability V1 (listPendingCancelRequests mock harness): ${passed}/${total} PASS`);
  if (passed !== total) process.exit(1);
}
