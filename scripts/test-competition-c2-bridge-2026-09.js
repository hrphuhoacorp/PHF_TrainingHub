'use strict';

/*
 * PHF HR — Chương trình thi đua (Competition) V1 · Batch C2 offline tests.
 *
 * OFFLINE (no network, no DB). Exercises the REAL modules with the shared
 * People-Master helper functions monkey-patched (same trick as mocking a
 * shared export object before first require — no proxyquire dependency).
 * Covers:
 *   - identity resolution mirrors PHF Task (admin vs employee, People Master
 *     lookup, inactive-employee/account rejection, no client-supplied actor);
 *   - the bridge refuses to call out when its flag is off / misconfigured,
 *     and never accepts a client-supplied actor;
 *   - the action dispatcher: 36-action manifest, explicit param whitelist
 *     (never `...payload`), forwards the VERIFIED actor only;
 *   - api/data.js and server.js wire the dispatcher identically, ahead of the
 *     legacy fallback, with no client-actor trust and no raw payload spread.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let PASS = 0;
function ok(cond, name) { assert.ok(cond, name); PASS++; console.log('PASS', name); }
async function rejects(fn, code, name) {
  try { await fn(); ok(false, name + ' (did not throw)'); }
  catch (e) { ok(e && e.code === code, name + ' -> ' + (e && e.code)); }
}

// ---- 1. identity resolver (People Master, mirrors Task) -----------------
const tes = require(path.join(ROOT, 'api/_lib/task-employee-scope'));
const auth = require(path.join(ROOT, 'api/_lib/auth'));
const FIXTURE_ROWS = [
  { employeeCode: 'NV001', fullName: 'Nguyễn Văn A', department: 'Bán hàng', title: 'Nhân viên', position: 'Sales', branch: 'CN1', status: 'active' },
  { employeeCode: 'NV002', fullName: 'Trần Thị B', department: 'Bán hàng', title: 'Trưởng nhóm', position: 'Lead', branch: 'CN2', status: 'inactive' },
];
tes.loadOrgRows = async () => FIXTURE_ROWS;
tes.findByCode = (rows, code) => (rows || []).find((r) => r.employeeCode === String(code || '').toUpperCase()) || null;
tes.resolveSessionEmployeeCode = (session) => (session && session.employeeCode) || '';
tes.resolveSessionAccountRole = (session) => (session && session.role) || '';
tes.resolveSessionAccountId = (session) => (session && session.accountId) || '';
auth.getAccountById = async (id) => (id === 'acc-inactive' ? { status: 'inactive' } : { status: 'active' });

const { resolveCompetitionActor, CompetitionIdentityError } = require(path.join(ROOT, 'api/_lib/competition-identity'));

function ACTION_MAP_HAS_NO_ACTION_FIELD_COLLISION() {
  const src = fs.readFileSync(path.join(ROOT, 'api/_lib/competition-actions.js'), 'utf8');
  // find every params() arrow body and confirm none of them read `p.action`
  const bodies = src.match(/params:\s*\(p\)\s*=>\s*\(\{[\s\S]*?\}\),/g) || [];
  return bodies.length > 0 && bodies.every((b) => !/\bp\.action\b/.test(b));
}

(async () => {
  console.log('\n== IDENTITY (People Master, same principle as PHF Task) ==');
  const admin = await resolveCompetitionActor({ role: 'admin', accountId: 'acc-admin', account: { name: 'Admin User' } });
  ok(admin.systemRole === 'admin' && admin.accountId === 'acc-admin' && admin.employeeCode === '', 'admin session -> admin actor, no employeeCode');

  const emp = await resolveCompetitionActor({ role: 'learner', employeeCode: 'nv001', accountId: 'acc-1' });
  ok(emp.employeeCode === 'NV001' && emp.displayName === 'Nguyễn Văn A' && emp.department === 'Bán hàng'
    && emp.title === 'Nhân viên' && emp.branch === 'CN1' && emp.systemRole === 'learner',
    'employee session resolves REAL identity from People Master (code/name/dept/title/branch)');

  await rejects(() => resolveCompetitionActor(null), 'COMPETITION_SESSION_REQUIRED', 'no session rejected');
  await rejects(() => resolveCompetitionActor({ role: 'learner', employeeCode: '' }), 'COMPETITION_IDENTITY_REQUIRED', 'blank employeeCode rejected');
  await rejects(() => resolveCompetitionActor({ role: 'learner', employeeCode: 'NV999' }), 'COMPETITION_EMPLOYEE_NOT_FOUND', 'unknown employee rejected (no hồ sơ thật)');
  await rejects(() => resolveCompetitionActor({ role: 'learner', employeeCode: 'NV002' }), 'COMPETITION_IDENTITY_INACTIVE', 'inactive employee (employment_status) rejected');
  await rejects(() => resolveCompetitionActor({ role: 'learner', employeeCode: 'NV001', accountId: 'acc-inactive' }), 'COMPETITION_IDENTITY_INACTIVE', 'inactive account (user_accounts.status) rejected');
  await rejects(() => resolveCompetitionActor({ role: 'admin', accountId: '' }), 'COMPETITION_ACCOUNT_IDENTITY_REQUIRED', 'admin session without account id rejected');

  const idCode = fs.readFileSync(path.join(ROOT, 'api/_lib/competition-identity.js'), 'utf8');
  ok(!/session\.actor\b|payload\.actor\b|body\.actor\b/.test(idCode), 'identity resolver never reads a client-supplied actor');
  ok(!/reviewer_grants|admin_grants|capability_grants|isCompetitionAdmin|canReview/.test(idCode), 'identity resolver never infers Competition authority (that is C1, from grants only)');
  ok(!/synthetic|SYN-|SYN2-/i.test(idCode), 'identity resolver contains no SYN/synthetic fallback for the runtime path');

  // ---- 2. bridge ---------------------------------------------------------
  console.log('\n== BRIDGE (flag-gated, service-token only, no second auth protocol) ==');
  delete process.env.PHF_COMPETITION_BRIDGE_ENABLED;
  const bridge = require(path.join(ROOT, 'api/_lib/competition-bridge'));
  ok(bridge.isCompetitionBridgeEnabled() === false, 'bridge disabled by default');
  await rejects(() => bridge.callCompetitionAction('competition.bootstrap', { accountId: 'x' }, {}), 'COMPETITION_BRIDGE_DISABLED', 'bridge refuses to call out while disabled');
  process.env.PHF_COMPETITION_BRIDGE_ENABLED = 'true';
  delete process.env.PHF_HR_API_BASE_URL; delete process.env.PHF_HR_API_SERVICE_TOKEN;
  await rejects(() => bridge.callCompetitionAction('competition.bootstrap', { accountId: 'x' }, {}), 'COMPETITION_BRIDGE_MISCONFIGURED', 'bridge requires base URL + service token');
  const bridgeCode = fs.readFileSync(path.join(ROOT, 'api/_lib/competition-bridge.js'), 'utf8');
  ok(/PHF_HR_API_SERVICE_TOKEN/.test(bridgeCode) && !/CHECKLIST_CRON_SECRET|new.*Secret|competitionSecret/i.test(bridgeCode), 'bridge reuses the SAME phf-hr-api service token — no second auth protocol');
  ok(/Bearer ' \+ PHF_HR_API_SERVICE_TOKEN/.test(bridgeCode), 'bridge sends Bearer service token, matching task-write-bridge.js pattern');
  process.env.PHF_COMPETITION_BRIDGE_ENABLED = 'false';

  // ---- 3. action dispatcher ----------------------------------------------
  console.log('\n== ACTION DISPATCHER ==');
  const idModule = require(path.join(ROOT, 'api/_lib/competition-identity'));
  const bridgeModule = require(path.join(ROOT, 'api/_lib/competition-bridge'));
  let capturedActor = null, capturedRemote = null, capturedParams = null;
  idModule.resolveCompetitionActor = async () => ({ accountId: 'acc-1', employeeCode: 'NV001', displayName: 'Nguyễn Văn A', department: 'Bán hàng', branch: 'CN1', title: 'Nhân viên', systemRole: 'learner' });
  bridgeModule.callCompetitionAction = async (remote, actor, params) => { capturedRemote = remote; capturedActor = actor; capturedParams = params; return { echoed: true }; };

  const { dispatchCompetitionAction, COMPETITION_ACTION_MANIFEST } = require(path.join(ROOT, 'api/_lib/competition-actions'));
  // 39 C1 (phf-hr-api) actions + 1 C4.3 composite action
  // (competitionListReviewablePeople — People Master + phf-hr-api grants,
  // not a plain ACTION_MAP passthrough, see competition-actions.js) + 4 V1.1
  // similarity/occurrence actions (competitionCheckSimilarity,
  // competitionConfirmOccurrence, competitionGetOccurrenceCount,
  // competitionGetSimilarForReview) + 2 V1.3 effective-score actions
  // (competitionAdjustScore, competitionListAdjustable).
  ok(COMPETITION_ACTION_MANIFEST.length === 46, 'manifest has all 39 C1 + 1 C4.3 composite + 4 V1.1 + 2 V1.3 actions mapped (' + COMPETITION_ACTION_MANIFEST.length + ')');
  ok(new Set(COMPETITION_ACTION_MANIFEST).size === 46, 'manifest has no duplicate action names');

  const unhandled = await dispatchCompetitionAction({ role: 'learner', employeeCode: 'NV001' }, { action: 'notAnAction' });
  ok(unhandled.handled === false, 'unknown action -> not handled (falls through to legacy dispatch)');

  const d1 = await dispatchCompetitionAction({ role: 'learner', employeeCode: 'NV001', accountId: 'client-supplied-should-be-ignored' },
    { action: 'competitionSubmitSubmission', submission_id: 'sub-1', payload: { customer_question: 'q' }, actor: { accountId: 'HACK', systemRole: 'admin' } });
  ok(d1.handled && d1.result.echoed === true, 'submit action dispatched to phf-hr-api');
  ok(capturedRemote === 'competition.submission.submit', 'maps to the correct C1 remote action name');
  ok(capturedActor.accountId === 'acc-1' && capturedActor.systemRole === 'learner', 'actor sent is the RESOLVED one, not the client-supplied payload.actor');
  ok(JSON.stringify(capturedParams) === JSON.stringify({ submissionId: 'sub-1', payload: { customer_question: 'q' } }), 'params are an explicit whitelist, not the raw payload');

  const d2 = await dispatchCompetitionAction({ role: 'learner', employeeCode: 'NV001' },
    { action: 'competitionReviewSubmission', campaign_id: 'c1', submission_id: 's1', review_action: 'approve', level_order: 1, extraneous_field: 'x' });
  ok(d2.handled && capturedRemote === 'competition.submission.review', 'review action dispatches to the correct C1 remote action (not swallowed by the action/review_action field split)');
  ok(capturedParams.action === 'approve', 'review verb (review_action on the client payload) reaches phf-hr-api as params.action, distinct from the top-level dispatch selector');
  ok(capturedParams.extraneousField === undefined && capturedParams.extraneous_field === undefined && !('extraneous_field' in capturedParams), 'unknown/extraneous client fields are dropped, not forwarded');
  // Regression guard: the dispatch selector `action` and the review verb
  // must never share a client field name — a shared name lets JS's
  // "later key wins" object semantics silently swap which server action
  // gets called (found + fixed in Batch C3.1).
  ok(ACTION_MAP_HAS_NO_ACTION_FIELD_COLLISION(), 'no ACTION_MAP params() extractor reads client field "action" for anything other than the dispatch selector');

  const actionsCode = fs.readFileSync(path.join(ROOT, 'api/_lib/competition-actions.js'), 'utf8');
  const actionsCodeNoComments = actionsCode.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  ok(!/\.\.\.payload/.test(actionsCodeNoComments), 'dispatcher never forwards the raw payload via object spread');
  ok(!/actor_employee_code|actor_role|actor_scope|is_admin|permission_flags/.test(actionsCode), 'dispatcher never trusts client actor/permission fields (Task anti-spoof rule)');

  // ---- 4. api/data.js + server.js parity wiring --------------------------
  console.log('\n== SURFACE PARITY (api/data.js vs server.js) ==');
  const dataSrc = fs.readFileSync(path.join(ROOT, 'api/data.js'), 'utf8');
  const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  for (const [name, src, reqPath] of [['api/data.js', dataSrc, "require('./_lib/competition-actions')"], ['server.js', serverSrc, "require('./api/_lib/competition-actions')"]]) {
    ok(src.includes(reqPath), name + ' requires competition-actions from the correct relative path');
    ok(src.includes('dispatchCompetitionAction(session, payload)'), name + ' calls dispatchCompetitionAction(session, payload)');
    const dIdx = src.indexOf('const taskDispatch = await dispatchTaskAction');
    const cIdx = src.indexOf('dispatchCompetitionAction(session, payload)');
    const legacyIdx = name === 'api/data.js' ? src.indexOf('authorizePayload(session, payload);') : src.indexOf('payload = authorizePayload(session, payload);');
    ok(dIdx > 0 && cIdx > dIdx && legacyIdx > cIdx, name + ' order: task dispatch -> competition dispatch -> legacy fallback');
  }
  ok(dataSrc.match(/dispatchCompetitionAction\(session, payload\)/g).length === serverSrc.match(/dispatchCompetitionAction\(session, payload\)/g).length, 'identical call-site count on both surfaces');

  // Task's own wiring/parity is untouched by this batch.
  ok(!/dispatchTaskAction[\s\S]{0,40}COMPETITION/.test(dataSrc), 'Task dispatch block itself is unmodified');

  console.log('\n==== COMPETITION_C2_BRIDGE_OFFLINE  PASS=' + PASS + ' ====');
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
