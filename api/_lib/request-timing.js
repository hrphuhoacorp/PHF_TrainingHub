'use strict';

/*
 * PHF — minimal structured request timing (READ-ONLY forensic V3).
 *
 * Purpose: split the observed /api/data TTFB (browser-measured 3–8 s) into real
 * server-side phases so a region / orchestration decision can be made on
 * evidence rather than assumption.
 *
 * Design constraints (locked):
 *   - ZERO business-logic change. Seams call span()/spanInclusive()/bridgeSpan()
 *     as pure pass-through wrappers around work they already do; when timing is
 *     OFF the wrapper is `return fn()` — no AsyncLocalStorage, no allocation.
 *   - NO PII. Only: requestId (random), action name (whitelisted charset),
 *     phase durations (ms), HTTP status, cold/warm marker, bridge route name,
 *     small counters. Never a token / cookie / email / name / task title /
 *     SQL param / request payload.
 *   - One structured line per request:
 *     console.log(JSON.stringify({evt:'phf_api_timing', ...})).
 *   - Gated by env PHF_API_TIMING_ENABLED === 'true'. Off => fully inert.
 *
 * Additive phases (non-overlapping, meant to sum): session_verify,
 * people_master, task_permission, bridge_wait, serialization.
 * Inclusive phases (wall time of a stage that CONTAINS additive leaves above —
 * reported separately, never summed): account_resolve, descriptor_build.
 */

const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');

const als = new AsyncLocalStorage();
const MODULE_LOADED_AT = now();
let INVOCATIONS = 0; // 0 => the next request this lambda instance serves is a cold start

function enabled() {
  return String(process.env.PHF_API_TIMING_ENABLED || '').trim().toLowerCase() === 'true';
}

function now() {
  try { return Number(process.hrtime.bigint() / 1000n) / 1000; } catch (_e) { return Date.now(); }
}

function round(obj) {
  const out = {};
  for (const k of Object.keys(obj)) out[k] = Math.round((obj[k] + Number.EPSILON) * 10) / 10;
  return out;
}

function sanitize(token) {
  const a = String(token || '').trim();
  return /^[a-zA-Z0-9_.:/-]{1,64}$/.test(a) ? a : 'unknown';
}

function newStore(action) {
  const cold = INVOCATIONS === 0;
  INVOCATIONS += 1;
  return {
    rid: crypto.randomUUID(),
    action: sanitize(action),
    t0: now(),
    cold,
    instanceAgeMs: cold ? Math.round(now() - MODULE_LOADED_AT) : undefined,
    phases: Object.create(null),
    inclusive: Object.create(null),
    routes: Object.create(null),
    counts: Object.create(null),
    status: 0,
    finished: false,
  };
}

/*
 * enter(action) — bind a fresh timing context to the CURRENT async execution
 * (one serverless request = one handler invocation = its own async root, so
 * concurrent requests stay isolated). Use when the handler body cannot be
 * wrapped in a callback. Pair with finish(). Inert when timing is disabled.
 */
function enter(action) {
  if (!enabled()) return null;
  const store = newStore(action);
  als.enterWith(store);
  return store;
}

/*
 * run(action, fn) — callback form, used by the parity test. Establishes a
 * context, emits exactly one summary line when `fn` settles. Inert when disabled.
 */
function run(action, fn) {
  if (!enabled()) return fn();
  const store = newStore(action);
  return als.run(store, async () => {
    try {
      const result = await fn();
      finish(store.status || 200);
      return result;
    } catch (err) {
      finish((err && (err.statusCode || err.status)) || 500);
      throw err;
    }
  });
}

function setAction(action) {
  const s = als.getStore();
  if (s && (!s.action || s.action === 'unknown')) s.action = sanitize(action);
}

function setStatus(code) {
  const s = als.getStore();
  if (s) s.status = Number(code) || s.status;
}

function count(key, n) {
  const s = als.getStore();
  if (!s) return;
  const k = sanitize(key);
  s.counts[k] = (s.counts[k] || 0) + (n == null ? 1 : Number(n));
}

// additive leaf phase
function span(name, fn) {
  const s = als.getStore();
  if (!s) return fn();
  const start = now();
  const done = () => { s.phases[name] = (s.phases[name] || 0) + (now() - start); };
  let r;
  try { r = fn(); } catch (e) { done(); throw e; }
  if (r && typeof r.then === 'function') return r.then((v) => { done(); return v; }, (e) => { done(); throw e; });
  done();
  return r;
}

// inclusive container stage — recorded separately, never summed with `phases`
function spanInclusive(name, fn) {
  const s = als.getStore();
  if (!s) return fn();
  const start = now();
  const done = () => { s.inclusive[name] = (s.inclusive[name] || 0) + (now() - start); };
  let r;
  try { r = fn(); } catch (e) { done(); throw e; }
  if (r && typeof r.then === 'function') return r.then((v) => { done(); return v; }, (e) => { done(); throw e; });
  done();
  return r;
}

// bridge fetch — additive into bridge_wait AND broken out per route
function bridgeSpan(route, fn) {
  const s = als.getStore();
  if (!s) return fn();
  const r = sanitize(route);
  const start = now();
  const done = () => {
    const dt = now() - start;
    s.phases.bridge_wait = (s.phases.bridge_wait || 0) + dt;
    s.routes[r] = (s.routes[r] || 0) + dt;
  };
  let out;
  try { out = fn(); } catch (e) { done(); throw e; }
  if (out && typeof out.then === 'function') return out.then((v) => { done(); return v; }, (e) => { done(); throw e; });
  done();
  return out;
}

function finish(status) {
  const s = als.getStore();
  if (!s || s.finished) return;
  s.finished = true;
  const total = now() - s.t0;
  const additive = Object.values(s.phases).reduce((a, b) => a + b, 0);
  const line = {
    evt: 'phf_api_timing',
    rid: s.rid,
    action: s.action,
    status: Number(status) || s.status || 0,
    cold: s.cold,
    total_handler_ms: Math.round((total + Number.EPSILON) * 10) / 10,
    phases: round(s.phases),
    inclusive: round(s.inclusive),
    bridge_routes: round(s.routes),
    counts: s.counts,
    unaccounted_ms: Math.round((total - additive + Number.EPSILON) * 10) / 10,
  };
  if (s.cold && s.instanceAgeMs != null) line.instance_age_ms = s.instanceAgeMs;
  try { console.log(JSON.stringify(line)); } catch (_e) {}
  return line;
}

module.exports = {
  enabled,
  enter,
  run,
  setAction,
  setStatus,
  count,
  span,
  spanInclusive,
  bridgeSpan,
  finish,
};
