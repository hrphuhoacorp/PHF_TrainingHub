'use strict';

/*
 * PHF Task — GUARD COVERAGE ENFORCEMENT (Phase B, 2026-08-28).
 *
 * Static scan (no DB, no network). Asserts that every scripts/{task-*,
 * test-task-*}.js that can reach a REAL Supabase project — i.e. it
 * require('dotenv').config() AND requires a real api/_lib/task-* module or
 * builds a real @supabase/supabase-js client — also loads a fail-closed
 * environment guard BEFORE it can construct that client:
 *
 *   - scripts/task-sandbox-guard.js  (SANDBOX-only), OR
 *   - scripts/task-oracle-dev-only.js (its own DEV-only fail-closed wrapper), OR
 *   - a direct assertSandboxTargetOrFailClosed / assertDeclaredTargetOrFailClosed
 *     call from api/_lib/env-identity-guard.js.
 *
 * MOCK suites that hard-set process.env.SUPABASE_URL to a fake project before
 * any require are exempt (they can never touch a real project).
 *
 * This test is the standing regression guard for the Supabase MAIN CPU
 * incident root vector (a Task test script silently inheriting .env and
 * driving service_role writes into MAIN via api/_lib/task-core.js).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SCRIPTS_DIR = __dirname;
const GUARD_TOKENS = [
  "require('./task-sandbox-guard')",
  'require("./task-sandbox-guard")',
  "require('./task-oracle-dev-only')",
  'assertSandboxTargetOrFailClosed',
  'assertDeclaredTargetOrFailClosed',
  'assertDevTargetOrFailClosed',
];
const FAKE_ENV_TOKENS = [
  "process.env.SUPABASE_URL = 'https://fake",
  'process.env.SUPABASE_URL = "https://fake',
  "process.env.SUPABASE_URL='https://fake",
];
const REAL_MODULE_RES = [
  // static require of a real task-* lib
  /require\(\s*['"]\.\.\/api\/_lib\/task-(?:core|reporting|permissions|notifications|read-bridge|write-bridge|server-integration)['"]\s*\)/,
  // dynamic path.join(..., 'api', '_lib', 'task-*') / '..api/_lib/task-*'
  /_lib['"),\s]+['"]?task-(?:core|reporting|permissions|notifications)/,
  /_lib\/task-(?:core|reporting|permissions|notifications)/,
  // real supabase client construction against the inherited secret
  /createClient\(\s*(?:String\()?process\.env\.SUPABASE_URL/,
];
const DOTENV_RE = /require\(\s*['"]dotenv['"]\s*\)\s*\.config\(/;
function usesRealModuleFn(src) { return REAL_MODULE_RES.some(re => re.test(src)); }

const files = fs.readdirSync(SCRIPTS_DIR)
  .filter(n => /^(task-|test-task-).*\.js$/.test(n))
  .filter(n => n !== path.basename(__filename));

let checked = 0;
const violations = [];
const exemptMock = [];
const guarded = [];

for (const name of files) {
  const src = fs.readFileSync(path.join(SCRIPTS_DIR, name), 'utf8');
  const usesDotenv = DOTENV_RE.test(src);
  const usesRealModule = usesRealModuleFn(src);
  if (!usesDotenv || !usesRealModule) continue; // cannot reach a real project via inherited env
  checked += 1;

  if (FAKE_ENV_TOKENS.some(t => src.includes(t))) { exemptMock.push(name); continue; }
  if (GUARD_TOKENS.some(t => src.includes(t))) { guarded.push(name); continue; }
  violations.push(name);
}

console.log('Task scripts scanned (dotenv + real Supabase module): ' + checked);
console.log('  guarded      : ' + guarded.length);
console.log('  exempt (mock): ' + exemptMock.length + (exemptMock.length ? ' [' + exemptMock.join(', ') + ']' : ''));
console.log('  UNGUARDED    : ' + violations.length);
if (violations.length) {
  console.log('');
  for (const v of violations) console.log('  ✗ ' + v + ' — add: require(\'./task-sandbox-guard\'); right after require(\'dotenv\').config();');
}
console.log('');

assert.strictEqual(violations.length, 0,
  'GUARD COVERAGE FAIL — ' + violations.length + ' Task script(s) can inherit .env into a real Supabase client with no fail-closed environment guard: ' + violations.join(', '));

console.log('OVERALL: PASS — every real-DB Task script is environment-guarded (' + guarded.length + ' guarded, ' + exemptMock.length + ' mock-exempt).');
