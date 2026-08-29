'use strict';

/*
 * PHF Task — test harness for scripts/task-sandbox-guard.js.
 *
 * Verifies FAIL-CLOSED only — no DB call, no INSERT/UPDATE/DELETE/RPC. Each
 * case runs in its own child Node process (the guard runs exactly once at
 * require() time; Node caches the module after the first require, so multiple
 * SUPABASE_URL values can only be tested with process isolation).
 *
 * The child cwd is set to a directory with NO .env file, so the guard's own
 * require('dotenv').config() is a no-op and ONLY the case's explicit env vars
 * decide the outcome.
 *
 * Same methodology / spoof-shape coverage as
 * scripts/test-task-oracle-dev-guard.js.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GUARD_PATH = path.resolve(__dirname, 'task-sandbox-guard.js');
const NODE_BIN = process.execPath;
const SANDBOX_URL = 'https://pxkjvawdrixgoukhyvnk.supabase.co';
const MAIN_URL = 'https://byhpcexmjzqpctyvfczd.supabase.co';

const CLEAN_CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'phf-task-guard-test-'));

let passed = 0;
let failed = 0;

function runCase(label, env, expectAllow) {
  const childEnv = Object.assign({}, process.env, env);
  if (!('SUPABASE_URL' in env)) delete childEnv.SUPABASE_URL;
  if (!('SUPABASE_SECRET_KEY' in env)) delete childEnv.SUPABASE_SECRET_KEY;

  const script = "try { require(" + JSON.stringify(GUARD_PATH) + "); " +
    "process.stdout.write('REQUIRE_OK'); process.exit(0); } " +
    "catch (e) { process.stderr.write(String(e && e.message || e)); process.exit(1); }";

  const result = spawnSync(NODE_BIN, ['-e', script], { env: childEnv, cwd: CLEAN_CWD, encoding: 'utf8' });

  const allowed = result.status === 0 && String(result.stdout).includes('REQUIRE_OK');
  const blockedFailClosed = result.status !== 0 &&
    String(result.stderr).includes('PHF_ENV_GUARD_FAIL_CLOSED');

  if (expectAllow && allowed) {
    console.log('PASS — ' + label + ' — guard cho phép require (đúng kỳ vọng).');
    passed += 1;
  } else if (!expectAllow && blockedFailClosed) {
    console.log('PASS — ' + label + ' — guard từ chối đúng bằng FAIL_CLOSED.');
    passed += 1;
  } else if (allowed) {
    console.log('FAIL — ' + label + ' — LẼ RA phải chặn nhưng lại cho phép require. NGHIÊM TRỌNG.');
    failed += 1;
  } else {
    console.log('FAIL — ' + label + ' — kết quả không đúng kỳ vọng. status=' + result.status + ' stderr=' + result.stderr);
    failed += 1;
  }
}

runCase('SANDBOX target (pxkjvawdrixgoukhyvnk)', { SUPABASE_URL: SANDBOX_URL, SUPABASE_SECRET_KEY: 'fake-sandbox-secret-guard-test-only' }, true);
runCase('MAIN target (byhpcexmjzqpctyvfczd)', { SUPABASE_URL: MAIN_URL, SUPABASE_SECRET_KEY: 'fake-main-secret-guard-test-only' }, false);
runCase('Unknown project ref', { SUPABASE_URL: 'https://totallyunknownref000000.supabase.co', SUPABASE_SECRET_KEY: 'x' }, false);
runCase('Missing SUPABASE_URL', {}, false);
runCase('Empty SUPABASE_URL', { SUPABASE_URL: '' }, false);
runCase('Malformed URL', { SUPABASE_URL: 'not a url at all', SUPABASE_SECRET_KEY: 'x' }, false);
runCase('Trailing-domain spoof (...supabase.co.evil.example)', { SUPABASE_URL: SANDBOX_URL + '.evil.example', SUPABASE_SECRET_KEY: 'x' }, false);
runCase('Subdomain spoof (evil-<ref>.supabase.co)', { SUPABASE_URL: 'https://evil-pxkjvawdrixgoukhyvnk.supabase.co', SUPABASE_SECRET_KEY: 'x' }, false);
runCase('ref only in path of another host', { SUPABASE_URL: 'https://example.com/pxkjvawdrixgoukhyvnk.supabase.co', SUPABASE_SECRET_KEY: 'x' }, false);

try { fs.rmSync(CLEAN_CWD, { recursive: true, force: true }); } catch (_) { /* best effort */ }

console.log('');
console.log('TOTAL: ' + (passed + failed) + ' cases, PASS=' + passed + ', FAIL=' + failed);
if (failed > 0) {
  console.log('OVERALL: FAIL — task-sandbox-guard KHÔNG fail-closed tuyệt đối.');
  process.exit(1);
}
console.log('OVERALL: PASS — task-sandbox-guard fail-closed đúng cho toàn bộ ' + (passed + failed) + ' case.');
process.exit(0);
