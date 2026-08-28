'use strict';

/*
 * PHF Task — FAIL-CLOSED sandbox guard for Task test / oracle / fixture
 * scripts.
 *
 * WHY: the Supabase MAIN (byhpcexmjzqpctyvfczd) CPU incident root vector was
 * a Task test script that inherited repo-root .env (then pointed at MAIN) and
 * drove service_role writes into MAIN through api/_lib/task-core.js (its
 * module-load createClient). Repointing .env to the sandbox project closed
 * the DEFAULT; this guard closes the OVERRIDE case — a script run with
 * SUPABASE_URL set (by shell/CI/mistake) to anything that is not EXACTLY the
 * PHF_HR sandbox project must refuse to start.
 *
 * USAGE — require this at the very top of every Task test/fixture script,
 * AFTER require('dotenv').config() and BEFORE any require of
 * api/_lib/task-core (or any createClient):
 *
 *     require('dotenv').config();
 *     require('./task-sandbox-guard');          // fail-closed: SANDBOX only
 *     const core = require('../api/_lib/task-core');
 *
 * If SUPABASE_URL does not resolve to the sandbox hostname this throws at
 * require() time (uncaught, top-level) — the task-core require below it never
 * runs, so no Supabase client (right or wrong project) is ever constructed.
 *
 * There is NO "default allow" branch: MAIN, MISSING, MALFORMED, UNKNOWN and
 * every spoof shape are rejected identically (exact-hostname WHATWG-URL match
 * via api/_lib/env-identity-guard.js — the same classifier server.js and the
 * seed-script hard gates use).
 *
 * For a script that MUST target something else on purpose (e.g. a real
 * post-apply verify against MAIN), do NOT weaken this file — use
 * assertDeclaredTargetOrFailClosed('MAIN', ...) from env-identity-guard
 * directly in that script and document the intent inline.
 */

require('dotenv').config();
const { assertSandboxTargetOrFailClosed } = require('../api/_lib/env-identity-guard');

assertSandboxTargetOrFailClosed('[PHF Task test/oracle/fixture script — task-sandbox-guard]');

module.exports = {};
