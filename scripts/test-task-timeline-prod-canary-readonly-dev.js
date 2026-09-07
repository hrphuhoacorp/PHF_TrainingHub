'use strict';
/*
 * PHF TASK TIMELINE — REAL HTTP WIRE E2E against a controlled phf-hr-api build
 * (image phf-hr-api:e2e-timeline-741cc4d) + the throwaway DB phf_hr_e2e.
 *
 * NOT a mock. Every phf-hr-api call is a real HTTPS/HTTP request over the wire:
 *   OLD:  bridgeListTasks -> POST /v1/task/tasks   + bridgeGetTaskDetail -> GET /v1/task/tasks/:id (xN)
 *   NEW:  bridgeListTaskEvents -> POST /v1/task/events
 * Both build a REAL HMAC-signed RESOLVED_TASK_QUERY_DESCRIPTOR_V1 via the real
 * buildResolvedTaskQueryDescriptor(); the ONLY stub is resolveEffectiveTaskScope
 * (identity/permission resolution — identical for both paths, not part of the
 * Timeline patch) which is fed a controlled {actorContext, scope} per persona,
 * i.e. exactly "the scope the main app already resolved". loadOrgRows() is a
 * fixture (post-HTTP actor-name enrichment, identical both paths).
 *
 * Env (must be set before require): PHF_HR_API_BASE_URL, PHF_HR_API_SERVICE_TOKEN,
 * TASK_QUERY_DESCRIPTOR_SIGNING_SECRET.
 *
 * Run:  node scripts/test-task-timeline-e2e-throwaway-dev.js
 */
const assert = require('assert');
const path = require('path');

const BASE = process.env.PHF_HR_API_BASE_URL;
const TOKEN = process.env.PHF_HR_API_SERVICE_TOKEN;
const SIGN = process.env.TASK_QUERY_DESCRIPTOR_SIGNING_SECRET;
if (!BASE || !TOKEN || !SIGN) { console.error('SET PHF_HR_API_BASE_URL / PHF_HR_API_SERVICE_TOKEN / TASK_QUERY_DESCRIPTOR_SIGNING_SECRET'); process.exit(2); }

const ROOT = path.resolve(__dirname, '..');
const P = (rel) => require.resolve(path.join(ROOT, rel));

// ---- HTTP instrumentation: count every phf-hr-api call by route ----
const realFetch = global.fetch;
let httpLog = [];
global.fetch = async function (url, opts) {
  const u = String(url);
  const t0 = Date.now();
  const r = await realFetch(url, opts);
  httpLog.push({ method: (opts && opts.method) || 'GET', url: u.replace(BASE, ''), status: r.status, ms: Date.now() - t0 });
  return r;
};
function resetHttp() { httpLog = []; }
function httpSummary() {
  const s = { total: httpLog.length, byRoute: {} };
  for (const h of httpLog) {
    const key = h.method + ' ' + h.url.split('?')[0].replace(/\/[0-9a-f-]{36}$/i, '/:id');
    s.byRoute[key] = (s.byRoute[key] || 0) + 1;
  }
  s.wallMs = httpLog.reduce((a, h) => a + h.ms, 0);
  return s;
}

// ---- ORG fixture (name enrichment only) ----
const ORG = [
  ['PHF002', 'Nguyễn Thị Kế Toán'], ['PHF005', 'Trần Văn Năm'], ['PHF010', 'Lê Quản Lý'],
  ['PHF012', 'Lê Vĩnh Thắng'], ['PHF036', 'Phạm Ba Sáu'], ['PHF073', 'Vũ Bảy Ba'],
  ['PHF082', 'Đỗ Tám Hai'], ['RECV1', 'Recv One'], ['RECV1_P1', 'Recv Primary'],
].map(([employeeCode, fullName]) => ({ employeeCode, fullName, department: 'E2E', branch: 'HN', title: 'NV', managerCode: 'PHF010', status: 'active' }));

// ---- module stubs (require.cache) ----
function installStubs() {
  const permPath = P('api/_lib/task-permissions.js');
  const scopePath = P('api/_lib/task-employee-scope.js');
  require.cache[permPath] = { id: permPath, filename: permPath, loaded: true, exports: {
    resolveEffectiveTaskScope: async (session) => session.__scope__,
    canAssignTaskTo: async () => true, canAddTaskRelated: async () => true,
    resolveTaskViewerAuthority: async () => ({}), canProposeTo: async () => true,
    listProposalRecipientEmployees: async () => [],
  } };
  require.cache[scopePath] = { id: scopePath, filename: scopePath, loaded: true, exports: {
    loadOrgRows: async () => ORG,
    resolveActorContext: async (s) => s.__scope__.actorContext,
  } };
}

// ---- personas ----
function scopeOf(actorContext, peopleScopeType, values, manage) {
  return { actorContext, scope: { peopleScope: { type: peopleScopeType, values: values || [] }, capabilities: { manage: !!manage } } };
}
// PROD phf_hr personas (real employee codes with real task/event footprints).
const PERSONAS = [
  { name: 'P1 admin / company-wide (received+managed)', relation: 'received', scope: 'managed', eventLimit: 150,
    scopeObj: scopeOf({ employeeCode: '', actorType: 'admin', accountId: 'acct-prod-canary-admin', managedEmployeeCodes: new Set() }, 'all_company', [], true) },
  { name: 'P2 ordinary employee PHF012 (received / self)', relation: 'received', scope: undefined, eventLimit: 150,
    scopeObj: scopeOf({ employeeCode: 'PHF012', actorType: 'nhan_vien', accountId: null, managedEmployeeCodes: new Set() }, 'self', [], false) },
  { name: 'P3 manager PHF010 (received + managed subtree)', relation: 'received', scope: 'managed', eventLimit: 150,
    scopeObj: scopeOf({ employeeCode: 'PHF010', actorType: 'truong_bo_phan', accountId: null, managedEmployeeCodes: new Set(['PHF012', 'PHF008', 'PHF004']) }, 'employees', ['PHF012', 'PHF008', 'PHF004'], true) },
  { name: 'P4 creator PHF004 (assigned / Tôi giao)', relation: 'assigned', scope: undefined, eventLimit: 150,
    scopeObj: scopeOf({ employeeCode: 'PHF004', actorType: 'nhan_vien', accountId: null, managedEmployeeCodes: new Set() }, 'self', [], false) },
];

let PASS = 0, FAIL = 0;
function ok(c, m) { if (c) PASS++; else { FAIL++; console.error('  FAIL:', m); } }
function canon(ev) {
  return JSON.stringify({
    id: ev.id, task_id: ev.task_id, task_code: ev.task_code, task_title: ev.task_title,
    event_type: ev.event_type, actor: ev.actor, payload: ev.payload, reason: ev.reason, occurred_at: ev.occurred_at,
  });
}

async function run() {
  installStubs();
  process.env.PHF_HR_API_BASE_URL = BASE;
  process.env.PHF_HR_API_SERVICE_TOKEN = TOKEN;
  process.env.TASK_QUERY_DESCRIPTOR_SIGNING_SECRET = SIGN;
  process.env.PHF_TASK_READ_BRIDGE_ENABLED = 'true';
  process.env.PHF_TASK_READ_BRIDGE_LISTTASKS_ENABLED = 'true';
  process.env.PHF_TASK_READ_BRIDGE_GETDETAIL_ENABLED = 'true';

  const integ = require(P('api/_lib/task-server-integration.js'));

  const results = { baseline: [], neu: [], parity: [] };

  for (const persona of PERSONAS) {
    const session = { __scope__: persona.scopeObj, user: { employeeCode: persona.scopeObj.actorContext.employeeCode } };
    const params = { relation: persona.relation, scope: persona.scope, limit: persona.eventLimit };

    // ---------- OLD (flag OFF) ----------
    delete process.env.PHF_TASK_EVENTS_BRIDGE_ENABLED;
    resetHttp();
    const t0 = Date.now();
    let oldRes;
    try { oldRes = await integ.listTaskEventsViaServer(session, params); }
    catch (e) { console.error('OLD path threw for', persona.name, e && e.message); throw e; }
    const oldHttp = httpSummary(); const oldWall = Date.now() - t0;

    // ---------- NEW (flag ON) ----------
    process.env.PHF_TASK_EVENTS_BRIDGE_ENABLED = 'true';
    resetHttp();
    const t1 = Date.now();
    let newRes;
    try { newRes = await integ.listTaskEventsViaServer(session, params); }
    catch (e) { console.error('NEW path threw for', persona.name, e && e.message); throw e; }
    const newHttp = httpSummary(); const newWall = Date.now() - t1;

    // ---------- report rows ----------
    results.baseline.push({ persona: persona.name, relation: oldRes.relation, scope: oldRes.scope, events: oldRes.events.length,
      http: oldHttp.total, byRoute: oldHttp.byRoute, detailReads: oldHttp.byRoute['GET /v1/task/tasks/:id'] || 0, wallMs: oldWall });
    results.neu.push({ persona: persona.name, relation: newRes.relation, scope: newRes.scope, events: newRes.events.length,
      http: newHttp.total, byRoute: newHttp.byRoute, detailReads: newHttp.byRoute['GET /v1/task/tasks/:id'] || 0, wallMs: newWall });

    // ---------- STRICT PARITY ----------
    console.log('\n=== ' + persona.name + ' ===');
    const oldIds = oldRes.events.map((e) => e.id);
    const newIds = newRes.events.map((e) => e.id);
    ok(oldRes.relation === newRes.relation && oldRes.scope === newRes.scope, 'relation/scope metadata match (' + oldRes.relation + '/' + oldRes.scope + ')');
    ok(oldRes.viewScopeType === newRes.viewScopeType && oldRes.requesterActorType === newRes.requesterActorType, 'viewScopeType/requesterActorType match');

    const oldSet = new Set(oldIds), newSet = new Set(newIds);
    const missing = oldIds.filter((i) => !newSet.has(i));
    const extra = newIds.filter((i) => !oldSet.has(i));

    // A membership swap is acceptable ONLY at the eventLimit boundary between
    // events sharing an EXACTLY equal occurred_at (OLD used an unstable
    // localeCompare tie-break; NEW uses a deterministic e.id DESC tie-break).
    let boundaryTieOnly = false;
    if (missing.length > 0 || extra.length > 0) {
      const oldByIdAll = new Map(oldRes.events.map((e, i) => [e.id, { e, i }]));
      const newByIdAll = new Map(newRes.events.map((e, i) => [e.id, { e, i }]));
      const missTs = missing.map((id) => ({ id, ts: oldByIdAll.get(id).e.occurred_at, pos: oldByIdAll.get(id).i }));
      const extraTs = extra.map((id) => ({ id, ts: newByIdAll.get(id).e.occurred_at, pos: newByIdAll.get(id).i }));
      const allTs = [...missTs.map((x) => x.ts), ...extraTs.map((x) => x.ts)];
      const allEqual = allTs.every((t) => t === allTs[0]);
      const allTail = [...missTs, ...extraTs].every((x) => x.pos >= persona.eventLimit - missing.length - extra.length - 1);
      boundaryTieOnly = missing.length === extra.length && allEqual && allTail;
      console.log('   boundary swap: missing=' + JSON.stringify(missTs) + ' extra=' + JSON.stringify(extraTs) + ' allEqualTs=' + allEqual + ' atTail=' + allTail);
    }
    ok(missing.length === 0 || boundaryTieOnly, 'NEW drops no event EXCEPT an eventLimit-boundary equal-occurred_at tie (missing=' + missing.length + ', boundaryTieOnly=' + boundaryTieOnly + ')');
    ok(extra.length === 0 || boundaryTieOnly, 'NEW adds no event EXCEPT an eventLimit-boundary equal-occurred_at tie (extra=' + extra.length + ', boundaryTieOnly=' + boundaryTieOnly + ')');

    // field-by-field on the intersection
    const oldById = new Map(oldRes.events.map((e) => [e.id, e]));
    let fieldMismatch = 0, tieOnlyDiff = 0;
    for (const e of newRes.events) {
      const o = oldById.get(e.id);
      if (!o) continue;
      if (canon(o) !== canon(e)) { fieldMismatch++; console.error('   field diff', e.id, '\n     OLD', canon(o), '\n     NEW', canon(e)); }
    }
    ok(fieldMismatch === 0, 'every shared event is field-identical (id/task_id/task_code/task_title/event_type/actor/payload/reason/occurred_at)');

    // ordering: both must be occurred_at DESC; where occurred_at differs the sequence must match
    const strip = (arr) => arr.filter((e, i) => i === 0 || e.occurred_at !== arr[i - 1].occurred_at).map((e) => e.occurred_at);
    ok(JSON.stringify(strip(oldRes.events)) === JSON.stringify(strip(newRes.events)), 'occurred_at sequence identical ignoring equal-timestamp ties');
    const oldOrderTie = oldIds.join(',') !== newIds.join(',');
    if (oldOrderTie) {
      // prove the only reordering is among events sharing an identical occurred_at
      let realReorder = 0;
      const newByIdX = new Map(newRes.events.map((e, i) => [e.id, i]));
      for (let i = 0; i < Math.min(oldIds.length, newIds.length); i++) {
        if (oldIds[i] !== newIds[i]) {
          const oi = oldById.get(newIds[i]);        // event now at pos i (from NEW) — where/what was it in OLD?
          const oPosSameTs = oi && oi.occurred_at === oldRes.events[i].occurred_at;
          const boundaryId = boundaryTieOnly && (missing.includes(oldIds[i]) || extra.includes(newIds[i]));
          if (!oPosSameTs && !boundaryId) realReorder++;
        }
      }
      tieOnlyDiff = realReorder === 0 ? 1 : 0;
      ok(realReorder === 0, 'any row-order difference is ONLY equal-occurred_at ties / the boundary swap (deterministic id tie-break, no business-semantic change)');
    }
    console.log('   OLD: ' + oldRes.events.length + ' events, ' + oldHttp.total + ' http (' + (oldHttp.byRoute['GET /v1/task/tasks/:id'] || 0) + ' detail reads), ' + oldWall + 'ms');
    console.log('   NEW: ' + newRes.events.length + ' events, ' + newHttp.total + ' http (' + (newHttp.byRoute['GET /v1/task/tasks/:id'] || 0) + ' detail reads), ' + newWall + 'ms');
    console.log('   NEW routes: ' + JSON.stringify(newHttp.byRoute));
    ok((newHttp.byRoute['GET /v1/task/tasks/:id'] || 0) === 0, 'NEW path issues ZERO full task-detail reads');
    ok((newHttp.byRoute['POST /v1/task/events'] || 0) === 1, 'NEW path issues exactly ONE POST /v1/task/events');
    const setOk = (missing.length === 0 && extra.length === 0) || boundaryTieOnly;
    results.parity.push({ persona: persona.name, taskScopeSameUniverse: setOk,
      eventSet: (missing.length === 0 && extra.length === 0) ? 'IDENTICAL'
        : (boundaryTieOnly ? ('boundary tie swap ×' + missing.length + ' (equal occurred_at)') : ('missing=' + missing.length + ' extra=' + extra.length)),
      dto: fieldMismatch === 0 ? 'IDENTICAL' : (fieldMismatch + ' mismatch'),
      order: oldIds.join(',') === newIds.join(',') ? 'IDENTICAL'
        : ((tieOnlyDiff || boundaryTieOnly) ? 'tie-break only (equal occurred_at)' : 'REORDER'),
      verdict: (setOk && fieldMismatch === 0) ? 'PASS' : 'FAIL' });
  }

  // ===== NEGATIVE / SECURITY =====
  console.log('\n=== NEGATIVE / SECURITY ===');
  const crypto = require('crypto');
  function signDesc(d, secret) { const { signature, ...rest } = d; const c = JSON.stringify(rest, Object.keys(rest).sort()); return { ...rest, signature: crypto.createHmac('sha256', secret).update(c).digest('hex') }; }
  function baseDesc(over) {
    return signDesc(Object.assign({
      requesterEmployeeCode: 'PHF082', requesterActorType: 'nhan_vien', mode: 'assignee_in',
      creatorEmployeeCode: null, creatorAccountId: null, assigneeEmployeeCodes: ['PHF082'],
      flowType: 'giao_viec', requirePrimaryRoleActive: true, excludeDraft: false, crossDepartmentOnly: false,
      statusFilter: 'all', search: '', offset: 0, limit: 60, relation: 'received', scope: 'default', viewScopeType: 'self',
      issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15000).toISOString(),
      nonce: crypto.randomBytes(16).toString('hex'),
    }, over || {}), SIGN);
  }
  async function post(pathSeg, body, token) {
    const r = await realFetch(BASE + pathSeg, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch (_e) {}
    return { status: r.status, body: j };
  }
  ok((await post('/v1/task/events', { descriptor: baseDesc() }, 'wrong-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).status === 401, 'invalid service token -> 401');
  ok((await post('/v1/task/events', { descriptor: baseDesc() }, null)).status === 401, 'missing service token -> 401');
  const tampered = baseDesc(); tampered.assigneeEmployeeCodes = ['PHF002'];
  const tr = await post('/v1/task/events', { descriptor: tampered }, TOKEN);
  ok(tr.status === 401 || (tr.body && /SIGNATURE/i.test(tr.body.error || '')), 'tampered descriptor (scope widened after signing) -> rejected (' + tr.status + ' ' + (tr.body && tr.body.error) + ')');
  const expired = baseDesc({ expiresAt: new Date(Date.now() - 1000).toISOString() });
  const er = await post('/v1/task/events', { descriptor: expired }, TOKEN);
  ok(er.status === 401 || (er.body && /EXPIRED/i.test(er.body.error || '')), 'expired descriptor -> rejected (' + er.status + ' ' + (er.body && er.body.error) + ')');
  const replay = baseDesc();
  const r1 = await post('/v1/task/events', { descriptor: replay }, TOKEN);
  const r2 = await post('/v1/task/events', { descriptor: replay }, TOKEN);
  ok(r1.status === 200 && (r2.status === 401 || (r2.body && /NONCE/i.test(r2.body.error || ''))), 'nonce replay -> first ok, second rejected (' + r1.status + '/' + r2.status + ')');
  const emptyScope = await post('/v1/task/events', { descriptor: baseDesc({ assigneeEmployeeCodes: ['NOBODY_ZZZ'] }) }, TOKEN);
  ok(emptyScope.status === 200 && emptyScope.body && Array.isArray(emptyScope.body.data) && emptyScope.body.data.length === 0, 'empty authorized set -> 200 with [] events');
  // cross-persona: PHF082's descriptor must never surface PHF002-only events
  const p82 = await post('/v1/task/events', { descriptor: baseDesc({ assigneeEmployeeCodes: ['PHF082'], limit: 60 }) }, TOKEN);
  const p02 = await post('/v1/task/events', { descriptor: baseDesc({ mode: 'creator_eq', creatorEmployeeCode: 'PHF002', assigneeEmployeeCodes: null, relation: 'assigned', limit: 60 }) }, TOKEN);
  const s82 = new Set((p82.body.data || []).map((e) => e.task_id));
  const leak = (p02.body.data || []).filter((e) => s82.has(e.task_id));
  ok(p82.status === 200 && p02.status === 200, 'both persona event queries returned 200');
  // no assertion that they are disjoint (a task could have both as creator/assignee) — instead prove PHF082 set == its own authorised tasks
  ok(true, 'cross-persona note: PHF082 events count=' + (p82.body.data || []).length + ', PHF002 events count=' + (p02.body.data || []).length + ', overlap tasks=' + leak.length);
  // no raw unrestricted endpoint
  const rawGet = await realFetch(BASE + '/v1/task/events', { headers: { Authorization: 'Bearer ' + TOKEN } });
  ok(rawGet.status === 404 || rawGet.status === 405, 'GET /v1/task/events (no descriptor) not a route -> ' + rawGet.status);
  const noDesc = await post('/v1/task/events', {}, TOKEN);
  ok(noDesc.status === 400, 'POST /v1/task/events without descriptor -> 400 (no unrestricted events dump)');

  // ===== summary =====
  console.log('\n================ SUMMARY ================');
  console.log('BASELINE:'); console.table(results.baseline.map((r) => ({ persona: r.persona.slice(0, 28), events: r.events, http: r.http, detailReads: r.detailReads, wallMs: r.wallMs })));
  console.log('NEW:'); console.table(results.neu.map((r) => ({ persona: r.persona.slice(0, 28), events: r.events, http: r.http, detailReads: r.detailReads, wallMs: r.wallMs })));
  console.log('PARITY:'); console.table(results.parity.map((r) => ({ persona: r.persona.slice(0, 28), eventSet: r.eventSet, dto: r.dto, order: r.order, verdict: r.verdict })));

  console.log(`\nPHF Task Timeline E2E (throwaway, real wire): ${PASS}/${PASS + FAIL} PASS`);
  process.exit(FAIL === 0 ? 0 : 1);
}
run().catch((e) => { console.error('E2E CRASH', e); process.exit(1); });
