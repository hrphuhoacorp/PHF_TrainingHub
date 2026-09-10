'use strict';

/*
 * FORENSIC V3 — proves the /api/data phase-timing instrumentation:
 *   1. is fully inert when PHF_API_TIMING_ENABLED != 'true'
 *   2. changes NO business output (descriptor bytes identical ON vs OFF)
 *   3. emits exactly ONE structured line per request, with the expected phase
 *      keys and NOTHING resembling a token / cookie / email / name / title
 *   4. reports a cold marker that flips to warm on the 2nd request
 *
 * No network, no DB — @supabase/supabase-js is a counting/echo stub.
 */

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'stub';

const assert = require('assert');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');

// ---- stub @supabase/supabase-js -------------------------------------------
function q(rows) {
  const qq = {
    select() { return qq; }, eq() { return qq; }, in() { return qq; }, or() { return qq; },
    lte() { return qq; }, gte() { return qq; }, lt() { return qq; }, order() { return qq; },
    limit() { return Promise.resolve({ data: rows || [], error: null }); },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    then(res) { return Promise.resolve({ data: rows || [], error: null }).then(res); },
  };
  return qq;
}
const supabaseStub = { createClient: () => ({ from: () => q([]) }) };
const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@supabase/supabase-js') return supabaseStub;
  return origLoad.apply(this, arguments);
};

// ---- stub People Master ---------------------------------------------------
const emPath = require.resolve('../api/_lib/employee-master');
require(emPath);
require.cache[emPath].exports.loadCanonicalEmployeeProfiles = async () => ({
  ready: true,
  rows: [
    { employee_code: 'PHF900', full_name: 'X', department: 'D', title: 'T', position: '', branch: 'B', manager_employee_code: 'PHF901', employment_status: 'active' },
    { employee_code: 'PHF901', full_name: 'Y', department: 'D', title: 'T', position: '', branch: 'B', manager_employee_code: '', employment_status: 'active' },
  ],
});

let PASS = 0, FAIL = 0;
function ok(name, cond) { if (cond) { PASS++; } else { FAIL++; console.error('  FAIL:', name); } }

// capture console.log lines
const logLines = [];
const realLog = console.log;
console.log = (...a) => { logLines.push(a.join(' ')); };

(async () => {
  const timing = require('../api/_lib/request-timing');

  // ---- 1. inert when disabled -------------------------------------------
  delete process.env.PHF_API_TIMING_ENABLED;
  ok('disabled: enabled() false', timing.enabled() === false);
  logLines.length = 0;
  let ranInert = false;
  const rInert = await timing.run('getTaskDetail', async () => {
    timing.span('session_verify', () => {});
    timing.bridgeSpan('task_detail', () => {});
    timing.finish(200);
    ranInert = true;
    return 'RESULT';
  });
  ok('disabled: fn still runs + returns value', ranInert && rInert === 'RESULT');
  ok('disabled: emits nothing', logLines.length === 0);

  // ---- 2. enabled: one line, expected keys, cold->warm -----------------
  process.env.PHF_API_TIMING_ENABLED = 'true';
  ok('enabled: enabled() true', timing.enabled() === true);

  logLines.length = 0;
  const secretsThatMustNeverLeak = {
    token: 'eyJhbGciOiJIUzI1Ni.SECRET.sig', cookie: 'phf_session=abc123',
    email: 'someone@phuhoafresh.com', name: 'Nguyễn Văn A', title: 'Bí mật công việc XYZ',
  };
  const out = await timing.run('getTaskDetail', async () => {
    timing.setAction('getTaskDetail');
    await timing.span('session_verify', () => new Promise(r => setTimeout(r, 5)));
    await timing.spanInclusive('account_resolve', async () => {
      await timing.span('people_master', () => new Promise(r => setTimeout(r, 3)));
    });
    await timing.span('task_permission', () => new Promise(r => setTimeout(r, 4)));
    await timing.bridgeSpan('task_detail', () => new Promise(r => setTimeout(r, 6)));
    await timing.bridgeSpan('categories', () => new Promise(r => setTimeout(r, 2)));
    timing.span('serialization', () => JSON.stringify(secretsThatMustNeverLeak));
    return { ok: true, result: { echoed: secretsThatMustNeverLeak } };
  });
  ok('enabled: business result passes through untouched',
    JSON.stringify(out) === JSON.stringify({ ok: true, result: { echoed: secretsThatMustNeverLeak } }));
  ok('enabled: exactly one timing line', logLines.filter(l => l.includes('phf_api_timing')).length === 1);

  const line = logLines.find(l => l.includes('phf_api_timing'));
  const rec = JSON.parse(line);
  ok('line: evt', rec.evt === 'phf_api_timing');
  ok('line: action', rec.action === 'getTaskDetail');
  ok('line: has rid uuid', /^[0-9a-f-]{36}$/.test(rec.rid));
  ok('line: status 200', rec.status === 200);
  ok('line: cold true (first request)', rec.cold === true);
  ok('line: additive phases present', rec.phases.session_verify > 0 && rec.phases.people_master > 0
    && rec.phases.task_permission > 0 && rec.phases.bridge_wait > 0 && rec.phases.serialization >= 0);
  ok('line: bridge_wait = sum of routes', Math.abs(rec.phases.bridge_wait - (rec.bridge_routes.task_detail + rec.bridge_routes.categories)) < 1.0);
  ok('line: inclusive account_resolve present & >= people_master', rec.inclusive.account_resolve >= rec.phases.people_master);
  ok('line: total >= additive sum', rec.total_handler_ms + 0.5 >= Object.values(rec.phases).reduce((a, b) => a + b, 0));
  ok('line: unaccounted_ms is a number', typeof rec.unaccounted_ms === 'number');

  // PII scan — the whole serialized line must contain none of the secrets
  for (const [k, v] of Object.entries(secretsThatMustNeverLeak)) {
    ok('PII: line contains no ' + k, !line.includes(v));
  }
  ok('PII: no "@" (no email)', !line.includes('@'));
  ok('PII: no cookie/session keyword value', !/phf_session|Bearer |eyJ/.test(line));

  // second request in same process => warm
  logLines.length = 0;
  await timing.run('listTasks', async () => ({ ok: true }));
  const rec2 = JSON.parse(logLines.find(l => l.includes('phf_api_timing')));
  ok('2nd request: cold false (warm)', rec2.cold === false);
  ok('2nd request: action listTasks', rec2.action === 'listTasks');

  // error path still emits with error status
  logLines.length = 0;
  let threw = false;
  try {
    await timing.run('getTaskDetail', async () => { const e = new Error('x'); e.statusCode = 403; throw e; });
  } catch (_e) { threw = true; }
  const recErr = JSON.parse(logLines.find(l => l.includes('phf_api_timing')));
  ok('error path: propagates the throw', threw);
  ok('error path: emits line with status 403', recErr.status === 403);

  // ---- 3. descriptor bytes identical ON vs OFF -------------------------
  // resolveEffectiveTaskScope path is stubbed to empty perms; the descriptor
  // signature is deterministic given a fixed nonce/time — so freeze them.
  const crypto = require('crypto');
  const realRandomBytes = crypto.randomBytes;
  crypto.randomBytes = (n) => Buffer.alloc(n, 7);
  const realNow = Date.now;
  Date.now = () => 1789000000000;

  function buildOnce() {
    for (const k of Object.keys(require.cache)) {
      if (/api[\\/]_lib[\\/]task-(query-descriptor-builder|permissions|employee-scope)\.js$/.test(k)) delete require.cache[k];
    }
    const { buildResolvedTaskQueryDescriptor } = require('../api/_lib/task-query-descriptor-builder');
    const session = { account: { id: 'acc1', role: 'user', employeeCode: 'PHF900', name: 'X' } };
    return buildResolvedTaskQueryDescriptor(session, { relation: 'received', limit: 50 }, { signingSecret: 'sec' });
  }
  process.env.PHF_API_TIMING_ENABLED = 'true';
  const dOn = await buildOnce();
  delete process.env.PHF_API_TIMING_ENABLED;
  const dOff = await buildOnce();
  crypto.randomBytes = realRandomBytes;
  Date.now = realNow;
  ok('descriptor: byte-identical ON vs OFF', JSON.stringify(dOn) === JSON.stringify(dOff));
  ok('descriptor: signature identical ON vs OFF', dOn.signature === dOff.signature);

  console.log = realLog;
  console.log(`\n  test-api-data-timing-instrumentation-v1: ${PASS} PASS / ${FAIL} FAIL`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.log = realLog; console.error('HARNESS_CRASH', e); process.exit(1); });
