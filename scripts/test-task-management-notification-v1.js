'use strict';

/*
 * PHF Task — MANAGEMENT NOTIFICATION V1 (2026-09-01). Mock/unit, no DB.
 *
 * AUDIT CONCLUSION UNDER TEST:
 *   Across every current V1 lifecycle event, TASK_CANCEL_REQUESTED is the ONLY
 *   one with a genuine management decision. Its emit + route layer already
 *   accepts { creator + reviewerRecipients }; the creator is always resolved
 *   in-transaction. The one missing link was that the MAIN APP never resolved
 *   or forwarded the management reviewer.
 *
 * Proves:
 *   - task-core.resolveCancelRequestReviewerRecipients() names ONLY the active
 *     primary's manager-of-record, and ONLY when they hold real Task management
 *     authority (canonical preset -> actor-type gate, no title/name heuristics)
 *   - NON-BROADCAST: it never enumerates / adds admins or executives just
 *     because they can see the whole company; [] is a valid result
 *   - the main-app request path forwards the resolved reviewers to the bridge
 *   - ordinary events (TASK_COMMENTED / TASK_ASSIGNED / TASK_DEADLINE_CHANGED)
 *     gain NO management recipients from this change
 */

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let passed = 0;
function pass(cond, msg) { assert.ok(cond, msg); passed += 1; console.log('  PASS  ' + msg); }

// ---- stub the module graph task-core.js loads at require time -----------------
function stub(rel, exports) {
  const p = require.resolve(path.join(ROOT, 'api', '_lib', rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
  return p;
}
require.cache[require.resolve('@supabase/supabase-js')] = {
  id: 'sb', filename: 'sb', loaded: true, exports: { createClient: () => ({ from: () => ({}) }) },
};

const ORG = {
  // primary PHF200 -> manager PHF100 (active, real Task authority)
  PHF200: { employeeCode: 'PHF200', managerCode: 'PHF100', status: 'active', department: 'Kho' },
  PHF100: { employeeCode: 'PHF100', managerCode: 'PHF001', status: 'active', department: 'Kho' },
  // primary PHF300 -> manager PHF301 (active, but NO Task authority)
  PHF300: { employeeCode: 'PHF300', managerCode: 'PHF301', status: 'active', department: 'Bán hàng' },
  PHF301: { employeeCode: 'PHF301', managerCode: 'PHF001', status: 'active', department: 'Bán hàng' },
  // primary PHF400 -> manager PHF401 who has LEFT the company
  PHF400: { employeeCode: 'PHF400', managerCode: 'PHF401', status: 'active', department: 'Bán hàng' },
  PHF401: { employeeCode: 'PHF401', managerCode: 'PHF001', status: 'inactive', department: 'Bán hàng' },
  // primary PHF500 -> no manager link at all
  PHF500: { employeeCode: 'PHF500', managerCode: '', status: 'active', department: 'Bán hàng' },
};
const TASK_AUTHORITY_ASSIGNMENT = {
  PHF100: { preset_code: 'TRUONG_BO_PHAN' }, // real management authority
  PHF301: null,                              // manager link but no Task authority
  PHF401: { preset_code: 'TRUONG_BO_PHAN' },
};

stub('task-employee-scope', {
  loadOrgRows: async () => Object.values(ORG),
  findByCode: (rows, code) => (rows || []).find((r) => String(r.employeeCode).toUpperCase() === String(code || '').toUpperCase()) || null,
  TASK_PRESET_TO_ACTOR_TYPE: { TRUONG_BO_PHAN: 'truong_bo_phan', TRUONG_CA: 'truong_ca', GIAM_DOC: 'giam_doc', TRO_LY_GD: 'tro_ly_gd' },
  resolveActorContext: async () => ({ employeeCode: 'PHF200', accountId: '' }),
  resolveActorContextForRecord: async () => ({}),
});
stub('task-permissions', new Proxy({
  loadActiveTaskAssignment: async (actor) => TASK_AUTHORITY_ASSIGNMENT[String(actor.employeeCode).toUpperCase()] || null,
}, { get: (t, k) => (k in t ? t[k] : () => undefined) }));
stub('auth', { listHubAccountSummaries: async () => [] });
stub('task-notifications', { emitTaskNotificationSafe: async () => ({}), isNotificationBridgeEnabled: () => false });

const core = require(path.join(ROOT, 'api', '_lib', 'task-core'));
const resolve = core.resolveCancelRequestReviewerRecipients;
const A = (emp, active) => ({ role: 'primary', is_active: active !== false, employee_code: emp });
const actor = (emp) => ({ employeeCode: emp, accountId: '' });

(async () => {
  // ---- the one actionable case: primary's manager with real authority ----
  {
    const r = await resolve(actor('PHF200'), [A('PHF200')], 'PHF001');
    pass(r.length === 1 && r[0].employeeCode === 'PHF100',
      'cancel-request reviewer = the active primary\'s manager-of-record WITH real Task management authority');
  }

  // ---- manager exists but has no Task authority -> [] (awareness-only, no spam) ----
  {
    const r = await resolve(actor('PHF300'), [A('PHF300')], 'PHF001');
    pass(r.length === 0, 'a manager with a manager_employee_code link but NO Task authority is NOT notified');
  }

  // ---- manager left the company -> [] ----
  {
    const r = await resolve(actor('PHF400'), [A('PHF400')], 'PHF001');
    pass(r.length === 0, 'an inactive / departed manager is never a recipient');
  }

  // ---- no manager link -> [] ----
  {
    const r = await resolve(actor('PHF500'), [A('PHF500')], 'PHF001');
    pass(r.length === 0, 'no manager_employee_code -> [] (never guessed from title/department)');
  }

  // ---- manager IS the requester -> [] (already knows) ----
  {
    const r = await resolve(actor('PHF100'), [A('PHF200')], 'PHF001');
    pass(r.length === 0, 'when the requester is the primary\'s manager, no self-notification');
  }

  // ---- manager IS the creator -> [] (creator always notified anyway) ----
  {
    const r = await resolve(actor('PHF200'), [A('PHF200')], 'PHF100');
    pass(r.length === 0, 'when the manager is the task creator, not added twice (creator path covers it)');
  }

  // ---- no active primary -> [] ----
  {
    const r = await resolve(actor('PHF200'), [A('PHF200', false)], 'PHF001');
    pass(r.length === 0, 'no ACTIVE primary -> no reviewer');
  }

  // ---- NON-BROADCAST: result is only ever the single manager, never a list of execs/admins ----
  {
    const r = await resolve(actor('PHF200'), [A('PHF200')], 'PHF001');
    pass(r.length <= 1 && r.every((x) => x.employeeCode === 'PHF100'),
      'NON-BROADCAST: the resolver returns at most the ONE structural manager — it never enumerates admins / Giám đốc / Trợ lý GĐ');
  }

  // ---- ordinary events unaffected: task-notification-emit whitelist unchanged ----
  {
    const emit = require(path.join(ROOT, 'services', 'phf-hr-api', 'lib', 'task-notification-emit'));
    // dedupeRecipients + emit take ONLY caller-supplied recipients; there is no
    // "add management" branch anywhere in the emitter.
    const src = require('fs').readFileSync(path.join(ROOT, 'services', 'phf-hr-api', 'lib', 'task-notification-emit.js'), 'utf8');
    pass(!/admin|giam_doc|tro_ly_gd|executive|manager/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
      'NON-BROADCAST: the notification emitter has no role/management recipient logic — recipients are 100% caller-resolved');
    const out = emit.dedupeRecipients(
      [{ employeeCode: 'PHF200' }, { employeeCode: 'PHF201' }],
      { employeeCode: 'PHF999' }
    );
    pass(out.length === 2 && out.every((x) => x.employeeCode !== 'PHF999'),
      'ordinary events (comment/assign/deadline) fan out to EXACTLY the caller list minus the actor — no management injection');
  }

  // ---- WIRING: the main-app request path resolves + forwards reviewers ----
  {
    const fs = require('fs');
    const integ = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'task-server-integration.js'), 'utf8');
    const fn = integ.slice(integ.indexOf('async function requestTaskCancelViaServer'), integ.indexOf('async function decideTaskCancelRequestViaServer'));
    pass(/resolveCancelRequestReviewerRecipients\(/.test(fn) && /bridgeRequestTaskCancel\([^)]*reviewerRecipients\)/.test(fn.replace(/\s+/g, ' ')),
      'WIRING: requestTaskCancelViaServer() resolves reviewer recipients and passes them to bridgeRequestTaskCancel()');
    const wb = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'task-write-bridge.js'), 'utf8');
    const bfn = wb.slice(wb.indexOf('async function bridgeRequestTaskCancel'), wb.indexOf('async function bridgeRequestTaskCancel') + 500);
    pass(/reviewerRecipients/.test(bfn), 'WIRING: bridgeRequestTaskCancel() forwards reviewerRecipients in the :requestCancel body');
    pass(/reviewerRecipients:\s*Array\.isArray\(body\.reviewerRecipients\)/.test(fs.readFileSync(path.join(ROOT, 'services', 'phf-hr-api', 'server.js'), 'utf8')),
      'WIRING: phf-hr-api :requestCancel route already reads body.reviewerRecipients (1:1 passthrough, no authority derived there)');
  }

  console.log('\n==== TASK_MANAGEMENT_NOTIFICATION_V1  PASS=' + passed + ' ====');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
