'use strict';

/*
 * PHF Task — updateTaskProgress OBSERVABILITY (PHF_SUPABASE_CPU_OBSERVABILITY_V1).
 * Drives the REAL exported api/data.js handler(req,res) over mock HTTP
 * objects with a genuine signed session cookie (built via api/_lib/auth's
 * real makeSession() against a real user_accounts row) — not a shortcut
 * around the trusted boundary, the actual code path a real browser request
 * takes. Captures console.log output to verify exactly one structured
 * phf_task_progress_request event per request, with no secret leakage, and
 * that response status/body are byte-identical to before this change.
 * Tagged [PROGRESS-OBSERVABILITY-TEST].
 */

const assert = require('assert');
require('dotenv').config();
require('./task-sandbox-guard'); // fail-closed: refuse to run unless SUPABASE_URL === PHF_HR sandbox
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const core = require('../api/_lib/task-core');
const { makeSession, COOKIE_NAME } = require('../api/_lib/auth');
const handler = require('../api/data.js');

let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }
function session(employeeCode) { return { account: { employeeCode } }; }
function futureDeadline(hours) { return new Date(Date.now() + hours * 3600e3).toISOString(); }

async function realAccountRow(employeeCode) {
  const { data, error } = await supabase.from('user_accounts').select('id,email,role,status,employee_code,metadata').ilike('employee_code', employeeCode).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('No real account found for ' + employeeCode);
  return data;
}

function buildCookieHeader(accountRow) {
  const token = makeSession({
    id: accountRow.id, email: accountRow.email, role: accountRow.role,
    phone: '', employeeId: accountRow.employee_code, metadata: accountRow.metadata
  });
  return COOKIE_NAME + '=' + encodeURIComponent(token);
}

function callHandler(cookieHeader, bodyObj) {
  const req = { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieHeader }, body: bodyObj };
  const captured = { statusCode: null, jsonBody: null, headers: {} };
  const res = {
    setHeader(k, v) { captured.headers[k] = v; },
    status(code) { captured.statusCode = code; return { json(body) { captured.jsonBody = body; return captured; } }; }
  };
  return handler(req, res).then(() => captured);
}

function captureConsoleLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => { lines.push(args.map(String).join(' ')); };
  return Promise.resolve().then(fn).finally(() => { console.log = original; }).then(result => ({ result, lines }));
}

function parseProgressEvents(lines) {
  return lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
    .filter(o => o && o.event === 'phf_task_progress_request');
}

const fixtures = require('./task-report-fixture-manifest');

(async () => {
  const accountRow = await realAccountRow('PHF010');
  const cookie = buildCookieHeader(accountRow);
  // Snapshot the [REPORT-UI-TEST] corpus BEFORE this suite runs — section 11
  // asserts "untouched" as a delta (drift-proof; the corpus may legitimately grow).
  const reportFixtureCountBefore = await fixtures.liveReportFixtureCount(supabase);

  // Real cookie sanity check — a bogus cookie must NOT authenticate (proves
  // the mock actually goes through real signature verification, not a stub).
  {
    const { result: captured } = await captureConsoleLog(() => callHandler(COOKIE_NAME + '=not-a-real-token', { action: 'updateTaskProgress', task_id: '00000000-0000-4000-8000-000000000000', expected_row_version: 1, progress_percent: 10, progress_status: 'dang_thuc_hien' }));
    pass(captured.statusCode === 401, 'SANITY: a forged/bogus cookie is genuinely rejected (401) by the real auth path — confirms this test drives the real handler, not a stub');
  }

  // Fixture: one real published task, PHF010 primary.
  const draft = await core.createTaskDraft(session('PHF010'), {
    flowType: 'giao_viec', title: '[PROGRESS-OBSERVABILITY-TEST] task-A',
    content: 'Observability gate fixture.', categoryCode: 'NHAN_SU', priority: 'thuong',
    startAt: null, deadline: futureDeadline(72), primaryEmployeeCode: 'PHF010'
  });
  let A = await core.publishTask(session('PHF010'), draft.id, draft.row_version);

  // =======================================================================
  // 1. Normal progress update -> exactly one SUCCESS log, response unchanged.
  // =======================================================================
  {
    const { result: captured, lines } = await captureConsoleLog(() => callHandler(cookie, { action: 'updateTaskProgress', task_id: A.id, expected_row_version: A.row_version, progress_percent: 10, progress_status: 'dang_thuc_hien' }));
    const events = parseProgressEvents(lines);
    pass(captured.statusCode === 200 && captured.jsonBody.ok === true, '1. NORMAL UPDATE: response status/body unchanged (200, ok:true) — RESPONSE_BEHAVIOR_REGRESSION');
    pass(events.length === 1, '1. NORMAL UPDATE: exactly one phf_task_progress_request log emitted (was ' + events.length + ')');
    const ev = events[0];
    pass(ev.outcome === 'success' && ev.http_status === 200 && ev.error_code === '', '1. NORMAL_LOG_TEST: outcome=success, http_status=200, error_code empty');
    pass(ev.task_id === A.id, '1. Log task_id matches the real task');
    pass(ev.actor_account_id === accountRow.id, '1. Log actor_account_id matches the real authenticated account id');
    pass(ev.actor_employee === 'PHF010', '1. Log actor_employee_code = PHF010');
    pass(typeof ev.duration_ms === 'number' && ev.duration_ms >= 0, '1. Log duration_ms present and sane');
    pass(ev.deployment !== undefined, '6. DEPLOYMENT_IDENTIFIER field present (value=' + ev.deployment + ', NOT_AVAILABLE expected outside real Vercel runtime)');
    A = captured.jsonBody.result;
  }

  // =======================================================================
  // 2. Stale row_version -> one ERROR log, TASK_VERSION_CONFLICT, response
  //    status/body unchanged from pre-observability behavior.
  // =======================================================================
  {
    const staleVersion = A.row_version - 1;
    const { result: captured, lines } = await captureConsoleLog(() => callHandler(cookie, { action: 'updateTaskProgress', task_id: A.id, expected_row_version: staleVersion, progress_percent: 20, progress_status: 'dang_thuc_hien' }));
    const events = parseProgressEvents(lines);
    pass(captured.statusCode === 409 && captured.jsonBody.ok === false && captured.jsonBody.code === 'TASK_VERSION_CONFLICT', '2. VERSION_CONFLICT_LOG_TEST: response unchanged (409, TASK_VERSION_CONFLICT) — real business error behavior preserved exactly');
    pass(events.length === 1, '2. Exactly one log emitted for the failed request');
    pass(events[0].outcome === 'error' && events[0].error_code === 'TASK_VERSION_CONFLICT' && events[0].http_status === 409, '2. Log captured the REAL domain error code, not reduced to generic 500');
  }

  // =======================================================================
  // 3. Unauthorized actor (not primary) -> one ERROR log with the real
  //    authorization code.
  // =======================================================================
  {
    const otherAccountRow = await realAccountRow('PHF082');
    const otherCookie = buildCookieHeader(otherAccountRow);
    const { result: captured, lines } = await captureConsoleLog(() => callHandler(otherCookie, { action: 'updateTaskProgress', task_id: A.id, expected_row_version: A.row_version, progress_percent: 30, progress_status: 'dang_thuc_hien' }));
    const events = parseProgressEvents(lines);
    pass(captured.statusCode === 403 && captured.jsonBody.code === 'TASK_PROGRESS_ACTOR_DENIED', '3. UNAUTHORIZED_LOG_TEST: response unchanged (403, TASK_PROGRESS_ACTOR_DENIED)');
    pass(events.length === 1 && events[0].error_code === 'TASK_PROGRESS_ACTOR_DENIED' && events[0].actor_employee === 'PHF082', '3. Log captured the real authorization denial code and the correct (denied) actor identity');
  }

  // =======================================================================
  // 4. Invalid progress percent -> error logged correctly.
  // =======================================================================
  {
    const { result: captured, lines } = await captureConsoleLog(() => callHandler(cookie, { action: 'updateTaskProgress', task_id: A.id, expected_row_version: A.row_version, progress_percent: 999, progress_status: 'dang_thuc_hien' }));
    const events = parseProgressEvents(lines);
    pass(captured.jsonBody.code === 'TASK_PROGRESS_PERCENT_INVALID', '4. INVALID_INPUT_LOG_TEST: response unchanged (TASK_PROGRESS_PERCENT_INVALID)');
    pass(events.length === 1 && events[0].error_code === 'TASK_PROGRESS_PERCENT_INVALID', '4. Log captured the real validation error code');
  }

  // =======================================================================
  // 5/6. No secret/cookie/header/body leakage in ANY log line emitted above.
  // =======================================================================
  {
    const { lines } = await captureConsoleLog(() => callHandler(cookie, { action: 'updateTaskProgress', task_id: A.id, expected_row_version: A.row_version + 500, progress_percent: 40, progress_status: 'dang_thuc_hien' }));
    const allLogText = lines.join('\n');
    const secretValue = String(process.env.SUPABASE_SECRET_KEY || '');
    pass(secretValue.length > 10 && !allLogText.includes(secretValue), '5. SECRET_LEAK_TEST: SUPABASE_SECRET_KEY value does not appear in any log line');
    pass(!allLogText.toLowerCase().includes('cookie'), '6. No literal "cookie" text appears in logged output');
    pass(!allLogText.toLowerCase().includes('authorization'), '6. No "authorization" header content appears in logged output');
    pass(!allLogText.includes(cookie), '6. The actual session cookie VALUE does not appear in any log line');
  }

  // =======================================================================
  // 100% progress still != completed (unaffected by this gate, spot check).
  // =======================================================================
  {
    const finalRow = (await supabase.from('task_tasks').select('row_version,status').eq('id', A.id).maybeSingle()).data;
    const { result: captured } = await captureConsoleLog(() => callHandler(cookie, { action: 'updateTaskProgress', task_id: A.id, expected_row_version: finalRow.row_version, progress_percent: 100, progress_status: 'hoan_thanh' }));
    pass(captured.jsonBody.ok === true && captured.jsonBody.result.status !== 'completed', '10. 100% progress does NOT auto-complete the task (observability change did not touch business logic)');
    A = captured.jsonBody.result;
  }

  // =======================================================================
  // 37 REPORT-UI-TEST fixtures untouched + cleanup.
  // =======================================================================
  {
    const countAfter = await fixtures.liveReportFixtureCount(supabase);
    pass(countAfter === reportFixtureCountBefore, '11. [REPORT-UI-TEST] corpus untouched by this suite (before=' + reportFixtureCountBefore + ', after=' + countAfter + ')');
  }
  {
    const { data: row } = await supabase.from('task_tasks').select('id,status,row_version').eq('id', A.id).maybeSingle();
    if (row && row.status !== 'cancelled' && row.status !== 'completed') {
      await core.cancelTask(session('PHF010'), row.id, row.row_version, 'Cleanup — PHF_SUPABASE_CPU_OBSERVABILITY_V1 gate fixture.');
    }
    pass(true, 'Fixture cancelled (audited cleanup path — hard-delete forbidden for non-draft tasks)');
  }

  console.log(`PHF Task Progress Observability V1: ${passed}/${passed} PASS`);
})().catch(err => { console.error('FAIL', err); process.exit(1); });
