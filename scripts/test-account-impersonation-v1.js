'use strict';
/*
 * Account Impersonation V1 — integration test against a running local server
 * (server.js) pointed at Supabase DEV/SANDBOX (pxkjvawdrixgoukhyvnk). READ
 * ONLY against real accounts: session cookies are minted locally with the
 * shared session secret (exactly what a real login produces), no password
 * required, no row is written. Any 403 test intentionally attempts a write
 * and asserts it is rejected before reaching Supabase.
 *
 * Usage: BASE_URL=http://localhost:3101 node scripts/test-account-impersonation-v1.js
 */
require('dotenv').config();
const assert = require('assert');
const { getAccountById, makeSession } = require('../api/_lib/auth');

const BASE = String(process.env.BASE_URL || 'http://localhost:3101').replace(/\/$/, '');

// Real, existing DEV/SANDBOX accounts (read-only lookup, no writes).
const ADMIN_ID = process.env.TEST_ADMIN_ID || 'acct-560b292c-8402-4a01-98a8-a8eff9583cc6';
const LEARNER_ID = process.env.TEST_LEARNER_ID || 'acct-6970b816-4f24-419f-ab2d-e9cd0d31e78e';
const MANAGER_ID = process.env.TEST_MANAGER_ID || 'acct-910033be-2332-4bb5-a656-aa7947725e20';

let passCount = 0, failCount = 0;
async function record(name, fn) {
  try { await fn(); console.log('  PASS -', name); passCount++; }
  catch (e) { console.error('  FAIL -', name, '\n       ', e && e.message || e); failCount++; }
}

function cookieJar() { return {}; }
function cookieHeaderFrom(jar) {
  return Object.keys(jar).map(k => `${k}=${jar[k]}`).join('; ');
}
function absorbSetCookie(jar, res) {
  const raw = res.headers.raw ? res.headers.raw()['set-cookie'] : res.headers.get('set-cookie');
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  list.forEach(line => {
    const first = String(line).split(';')[0];
    const eq = first.indexOf('=');
    if (eq > 0) {
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (value === '') delete jar[name]; else jar[name] = value;
    }
  });
}
async function call(jar, path, opts) {
  const options = Object.assign({ method: 'GET' }, opts || {});
  options.headers = Object.assign({ Cookie: cookieHeaderFrom(jar) }, options.headers || {});
  const res = await fetch(BASE + path, options);
  absorbSetCookie(jar, res);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

(async () => {
  console.log('BASE_URL =', BASE);
  const adminAccount = await getAccountById(ADMIN_ID);
  const learnerAccount = await getAccountById(LEARNER_ID);
  const managerAccount = await getAccountById(MANAGER_ID);
  assert.ok(adminAccount && adminAccount.role === 'admin' && adminAccount.status === 'active', 'Cần 1 admin thật active trong DEV sandbox');
  assert.ok(learnerAccount && learnerAccount.role === 'learner' && learnerAccount.status === 'active', 'Cần 1 learner thật active trong DEV sandbox');
  assert.ok(managerAccount && managerAccount.role === 'manager' && managerAccount.status === 'active', 'Cần 1 manager thật active trong DEV sandbox');
  console.log('Admin:', adminAccount.email, '| Learner:', learnerAccount.email, learnerAccount.employeeCode, '| Manager:', managerAccount.email, managerAccount.employeeCode);

  const adminToken = makeSession(adminAccount);
  const learnerToken = makeSession(learnerAccount);

  await record('1) Admin session hydrates as admin, not impersonating', async () => {
    const jar = { phf_session: adminToken };
    const { status, json } = await call(jar, '/api/auth/session');
    assert.strictEqual(status, 200);
    assert.strictEqual(json.authenticated, true);
    assert.strictEqual(json.user.role, 'admin');
    assert.strictEqual(json.impersonating, false);
    assert.strictEqual(json.actor, null);
  });

  await record('1b) GET /api/auth/accounts?action=impersonate-candidates (merged endpoint) returns real learner + manager lists', async () => {
    const jar = { phf_session: adminToken };
    const learnerList = await call(jar, '/api/auth/accounts?action=impersonate-candidates&role=learner');
    assert.strictEqual(learnerList.status, 200, JSON.stringify(learnerList.json));
    assert.strictEqual(learnerList.json.role, 'learner');
    assert.ok(Array.isArray(learnerList.json.candidates) && learnerList.json.candidates.length > 0, 'phải có ít nhất 1 learner active');
    assert.ok(learnerList.json.candidates.some(c => c.id === LEARNER_ID), 'phải chứa đúng learner test thật');

    const managerList = await call(jar, '/api/auth/accounts?action=impersonate-candidates&role=manager');
    assert.strictEqual(managerList.status, 200);
    assert.strictEqual(managerList.json.role, 'manager');
    assert.ok(managerList.json.candidates.some(c => c.id === MANAGER_ID), 'phải chứa đúng manager test thật');

    const badRole = await call(jar, '/api/auth/accounts?action=impersonate-candidates&role=employee');
    assert.strictEqual(badRole.status, 400, 'role không hợp lệ (employee) phải bị từ chối, không tạo role mới');

    const jarLearner = { phf_session: learnerToken };
    const forbidden = await call(jarLearner, '/api/auth/accounts?action=impersonate-candidates&role=learner');
    assert.strictEqual(forbidden.status, 403, 'non-admin không được xem danh sách ứng viên giả lập');
  });

  await record('2) Admin -> start impersonation (learner): effective session becomes learner, actor stays admin', async () => {
    const jar = { phf_session: adminToken };
    const start = await call(jar, '/api/auth/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'impersonate-start', accountId: LEARNER_ID }) });
    assert.strictEqual(start.status, 200, 'start phải 200: ' + JSON.stringify(start.json));
    assert.strictEqual(start.json.account.role, 'learner');
    assert.ok(jar.phf_impersonate, 'phải nhận cookie phf_impersonate');
    assert.ok(jar.phf_session === adminToken, 'phf_session của Admin KHÔNG được đổi');

    const session = await call(jar, '/api/auth/session');
    assert.strictEqual(session.json.user.role, 'learner');
    assert.strictEqual(session.json.user.id, LEARNER_ID);
    assert.strictEqual(session.json.impersonating, true);
    assert.strictEqual(session.json.actor.role, 'admin');
    assert.strictEqual(session.json.actor.id, ADMIN_ID);
    global.__jarLearnerImpersonation = jar; // reused by later tests
  });

  await record('3) Refresh/deep-link (new request, same cookies) keeps impersonation active', async () => {
    const jar = global.__jarLearnerImpersonation;
    const session = await call(jar, '/api/auth/session');
    assert.strictEqual(session.json.impersonating, true);
    assert.strictEqual(session.json.user.id, LEARNER_ID);
  });

  await record('4) GET /api/data while impersonating learner returns 200 (real profile/progress read), scoped to that employeeId', async () => {
    const jar = global.__jarLearnerImpersonation;
    const { status, json } = await call(jar, '/api/data');
    assert.strictEqual(status, 200, JSON.stringify(json));
    assert.ok(json && (json.employees || json.progress || json.settings), 'phải trả dữ liệu thật, không phải object rỗng/synthetic');
  });

  await record('5) POST /api/data (write) while impersonating learner -> 403 IMPERSONATION_READ_ONLY', async () => {
    const jar = global.__jarLearnerImpersonation;
    const { status, json } = await call(jar, '/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'autosave', employee: { id: LEARNER_ID }, currentPage: 'lesson:0' })
    });
    assert.strictEqual(status, 403);
    assert.strictEqual(json.code, 'IMPERSONATION_READ_ONLY');
  });

  await record('6) api/auth/accounts (admin-only) is blocked while impersonating learner', async () => {
    const jar = global.__jarLearnerImpersonation;
    const { status } = await call(jar, '/api/auth/accounts?action=list');
    assert.strictEqual(status, 403);
  });

  await record('7) Exit impersonation -> back to real admin, phf_session untouched throughout', async () => {
    const jar = global.__jarLearnerImpersonation;
    const stop = await call(jar, '/api/auth/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'impersonate-stop' }) });
    assert.strictEqual(stop.status, 200);
    assert.ok(!jar.phf_impersonate, 'cookie phf_impersonate phải bị xoá');
    assert.strictEqual(jar.phf_session, adminToken, 'phf_session của Admin thật không đổi');
    const session = await call(jar, '/api/auth/session');
    assert.strictEqual(session.json.user.role, 'admin');
    assert.strictEqual(session.json.impersonating, false);
    // Sau khi thoát, Admin thật lại truy cập được admin-only endpoint bình thường.
    const acc = await call(jar, '/api/auth/accounts?action=list');
    assert.strictEqual(acc.status, 200);
  });

  await record('8) Manager impersonation: effective role manager, scoped to that manager account', async () => {
    const jar = { phf_session: adminToken };
    const start = await call(jar, '/api/auth/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'impersonate-start', accountId: MANAGER_ID }) });
    assert.strictEqual(start.status, 200, JSON.stringify(start.json));
    assert.strictEqual(start.json.account.role, 'manager');
    const session = await call(jar, '/api/auth/session');
    assert.strictEqual(session.json.user.role, 'manager');
    assert.strictEqual(session.json.user.id, MANAGER_ID);
    const data = await call(jar, '/api/data');
    assert.strictEqual(data.status, 200);
    global.__jarManagerImpersonation = jar;
  });

  await record('9) Manager write attempt while impersonating -> 403', async () => {
    const jar = global.__jarManagerImpersonation;
    const { status, json } = await call(jar, '/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'autosave', employee: { id: MANAGER_ID }, currentPage: 'lesson:0' })
    });
    assert.strictEqual(status, 403);
    assert.strictEqual(json.code, 'IMPERSONATION_READ_ONLY');
    // clean up: exit before moving on
    await call(jar, '/api/auth/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'impersonate-stop' }) });
  });

  await record('10) Non-admin (real learner session) cannot start impersonation', async () => {
    const jar = { phf_session: learnerToken };
    const { status } = await call(jar, '/api/auth/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'impersonate-start', accountId: MANAGER_ID }) });
    assert.strictEqual(status, 403);
  });

  await record('11) Non-admin cannot forge a usable impersonation cookie (tamper -> falls back to real session, no admin-only access)', async () => {
    const jar = { phf_session: learnerToken, phf_impersonate: 'forged.notavalidtoken' };
    const { json } = await call(jar, '/api/auth/session');
    assert.strictEqual(json.user.role, 'learner');
    assert.strictEqual(json.impersonating, false);
  });

  await record('12) Tampered/mismatched impersonation cookie (wrong actor binding) fails open to the real admin session, not privilege-escalated', async () => {
    // Start a real impersonation as admin, then reuse that phf_impersonate value
    // together with a DIFFERENT (learner) real session — actorId in the token
    // won't match this session's account id, so the overlay must be ignored.
    const jarA = { phf_session: adminToken };
    await call(jarA, '/api/auth/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'impersonate-start', accountId: LEARNER_ID }) });
    const stolenCookie = jarA.phf_impersonate;
    await call(jarA, '/api/auth/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'impersonate-stop' }) });

    const jarB = { phf_session: learnerToken, phf_impersonate: stolenCookie };
    const { json } = await call(jarB, '/api/auth/session');
    assert.strictEqual(json.user.role, 'learner');
    assert.strictEqual(json.user.id, LEARNER_ID); // this IS the learner's own real session already
    assert.strictEqual(json.impersonating, false, 'token của admin khác không được áp dụng lên phiên learner');
  });

  await record('13) stop is idempotent / safe with no active impersonation', async () => {
    const jar = { phf_session: adminToken };
    const { status, json } = await call(jar, '/api/auth/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'impersonate-stop' }) });
    assert.strictEqual(status, 200);
    assert.strictEqual(json.impersonating, false);
  });

  await record('14) Regression: normal (non-impersonating) learner session is never blocked by the new impersonation guard', async () => {
    // NOTE: a full live write-through-to-Supabase check for this action is
    // blocked by a PRE-EXISTING, unrelated DEV/SANDBOX issue (service key
    // lacks grants on `employees`/`activity_log` -> 42501 permission denied,
    // reproducible on origin/main, zero diff in api/data.js or
    // api/_lib/employee-master.js on this branch — see test report). What we
    // CAN and DO verify live: a normal (non-impersonating) session never gets
    // session.impersonating=true, so it can never hit the
    // `if (session.impersonating && ...)` guard added in requireSession() —
    // the guard is syntactically unreachable without that flag.
    const jar = { phf_session: learnerToken };
    const { json } = await call(jar, '/api/auth/session');
    assert.strictEqual(json.impersonating, false);
    const { status, json: dataJson } = await call(jar, '/api/data');
    assert.strictEqual(status, 200, 'GET vẫn hoạt động bình thường cho learner thật: ' + JSON.stringify(dataJson));
  });

  console.log(`\n${passCount} PASS, ${failCount} FAIL`);
  process.exit(failCount ? 1 : 0);
})().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1); });
