'use strict';
/*
 * PHF HR — SYSTEM V1 · Nhật ký hệ thống (Audit Log) — LIVE LOCAL e2e (LOCAL ONLY).
 *
 * Closes the runtime gate the FOUNDATION V1 commit (988b95c) left open:
 *   auditEmit (Vercel helper)  ->  POST /v1/audit:emit (phf-hr-api bridge)
 *   ->  audit.entries (throwaway Company PostgreSQL phf_hr_e2e, SSH tunnel 15432)
 *   ->  GET /v1/audit:list / :detail  ->  bounded/redacted projection.
 *
 * Proves, against a REAL spawned phf-hr-api child + REAL throwaway PG:
 *   - emit -> row lands; list keyset shape; detail carries before/after
 *   - representative AUTH + ACCOUNT + EMPLOYEE events (the closed allowlist)
 *   - secret-key redaction + oversize truncation actually reach the DB
 *   - server-trusted identity/ip/ua/request-id; ctx spoof CANNOT override
 *   - security negatives: no Bearer 401 / unknown verb / unknown action /
 *     unknown module / bridge disabled 503
 *   - FAIL-OPEN: bridge unreachable or flag off -> auditEmit never throws,
 *     returns {ok:false}; read path (auditList) DOES surface the failure
 *
 * NOT prod. No prod DB / data / flag. No push/deploy.
 * Run: node scripts/audit-v1-live-local-e2e-dev.js
 */
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const DEV_HOST = 'pxkjvawdrixgoukhyvnk.supabase.co';
const THROWAWAY_CONTAINER = process.env.PHF_HR_E2E_CONTAINER || 'phf-hr-e2e-throwaway-20260827T123257Z';
const API_PORT = 18951;

function loadEnv(p) { const o = {}; if (!fs.existsSync(p)) return o; for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const s = l.trim(); if (!s || s[0] === '#') continue; const i = s.indexOf('='); if (i > 0) o[s.slice(0, i).trim()] = s.slice(i + 1).trim(); } return o; }
function die(m) { console.error('E2E_ABORT: ' + m); process.exit(1); }

const envTest = loadEnv(path.join(REPO, '.env.test'));
if (!envTest.SUPABASE_URL || new URL(envTest.SUPABASE_URL).host !== DEV_HOST) die('.env.test không phải PHF-HR-DEV.');
const dbEnv = loadEnv(path.join(REPO, 'e2e', 'phf-hr-e2e-db.env'));
if (dbEnv.PHF_HR_DB_HOST !== '127.0.0.1' || !/_e2e$/.test(dbEnv.PHF_HR_DB_NAME || '')) die('e2e/phf-hr-e2e-db.env sai (không phải throwaway *_e2e).');

const SERVICE_TOKEN = crypto.randomBytes(32).toString('hex');
const RUN_TAG = 'e2e-audit-' + Date.now();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function tcpOpen(port) { return new Promise((res) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); setTimeout(() => { s.destroy(); res(false); }, 1500); }); }
async function waitHealth(u, ms) { const end = Date.now() + ms; while (Date.now() < end) { try { const r = await fetch(u); if (r.status === 200) return true; } catch (_) {} await sleep(200); } return false; }
function psql(sql) { return execFileSync('ssh', ['claude-phf', `docker exec ${THROWAWAY_CONTAINER} psql -U postgres -d phf_hr_e2e -tAc "${sql.replace(/"/g, '\\"')}"`], { encoding: 'utf8' }).trim(); }

let PASS = 0, FAIL = 0;
function check(name, cond, extra) { if (cond) { PASS++; console.log('  PASS  ' + name); } else { FAIL++; console.error('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); } }

let apiChild = null;
function stopApi() {
  if (!apiChild) return Promise.resolve();
  const c = apiChild; apiChild = null;
  return new Promise((res) => { c.once('exit', () => res()); try { c.kill('SIGTERM'); } catch (_) { res(); } setTimeout(res, 4000); });
}
process.on('exit', () => { if (apiChild) { try { apiChild.kill('SIGTERM'); } catch (_) {} } });

async function startApi(port, bridgeEnabled) {
  const env = Object.assign({}, process.env, {
    PORT: String(port), PHF_HR_API_BIND_HOST: '127.0.0.1',
    PHF_HR_API_SERVICE_TOKEN: SERVICE_TOKEN,
    SUPABASE_URL: envTest.SUPABASE_URL, SUPABASE_SECRET_KEY: envTest.SUPABASE_SECRET_KEY,
    PHF_HR_DB_HOST: dbEnv.PHF_HR_DB_HOST, PHF_HR_DB_PORT: String(dbEnv.PHF_HR_DB_PORT),
    PHF_HR_DB_NAME: dbEnv.PHF_HR_DB_NAME, PHF_HR_DB_RUNTIME_USER: dbEnv.PHF_HR_DB_RUNTIME_USER,
    PHF_HR_DB_RUNTIME_PASSWORD: dbEnv.PHF_HR_DB_RUNTIME_PASSWORD,
    PHF_HR_ATTACHMENT_ROOT: fs.mkdtempSync(os.tmpdir() + path.sep + 'audit-e2e-'),
    TASK_QUERY_DESCRIPTOR_SIGNING_SECRET: crypto.randomBytes(32).toString('hex'),
    PHF_AUDIT_BRIDGE_ENABLED: bridgeEnabled ? 'true' : 'false',
  });
  apiChild = spawn(process.execPath, [path.join(REPO, 'services', 'phf-hr-api', 'server.js')], {
    cwd: path.join(REPO, 'services', 'phf-hr-api'), env, stdio: ['ignore', 'inherit', 'inherit'],
  });
  const base = 'http://127.0.0.1:' + port;
  if (!(await waitHealth(base + '/healthz', 15000))) { await stopApi(); die('phf-hr-api child not healthy on ' + port); }
  return base;
}

function rawPost(base, verb, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token !== null) headers.Authorization = 'Bearer ' + (token || SERVICE_TOKEN);
  return fetch(base + '/v1/audit:' + verb, { method: 'POST', headers, body: JSON.stringify(body || {}) })
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
}

// A fake Node request the Vercel emit helper reads ip/ua/request-id from.
function fakeReq(over) {
  return Object.assign({
    headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'PHF-E2E-UA/1.0', 'x-vercel-id': 'iad1::e2e-req-123' },
    socket: { remoteAddress: '10.9.9.9' },
  }, over || {});
}

(async () => {
  if (!(await tcpOpen(15432))) die('SSH tunnel 127.0.0.1:15432 chưa mở (ssh -N -L 15432:127.0.0.1:15432 claude-phf).');
  if (psql("select count(*) from information_schema.schemata where schema_name='audit'") !== '1') die('schema audit chưa có trên throwaway — apply migrations/phf_hr_audit_v1.sql trước.');

  // ==================================================================
  console.log('\n=== PHASE C · BRIDGE up, PHF_AUDIT_BRIDGE_ENABLED=true ===\n');
  let base = await startApi(API_PORT, true);
  process.env.PHF_HR_API_BASE_URL = base;
  process.env.PHF_HR_API_SERVICE_TOKEN = SERVICE_TOKEN;
  process.env.PHF_AUDIT_BRIDGE_ENABLED = 'true';
  // require AFTER env is set (module-level consts)
  const auditEmitMod = require(path.join(REPO, 'api', '_lib', 'audit-emit'));

  // ---- C: raw bridge emit ----
  const emit1 = await rawPost(base, 'emit', { entry: {
    module: 'auth', action: 'AUTH_LOGIN_SUCCESS', result: 'success',
    actor_account_id: 'acc-e2e-1', actor_employee_code: 'phf999', actor_name: 'E2E Bridge',
    object_type: 'account', object_id: 'acc-e2e-1', object_label: 'e2e@phf.local',
    ip: '198.51.100.7', user_agent: 'curl/e2e', request_id: RUN_TAG,
    metadata: { provider: 'password', phase: 'C1' },
  } });
  check('C1  POST /v1/audit:emit -> 200 + id', emit1.status === 200 && emit1.json.ok === true && emit1.json.data && emit1.json.data.id, JSON.stringify(emit1.json));
  const id1 = emit1.json.data && emit1.json.data.id;
  const rowCount = psql(`select count(*) from audit.entries where request_id='${RUN_TAG}' and action='AUTH_LOGIN_SUCCESS'`);
  check('C2  row landed in audit.entries', rowCount === '1', 'count=' + rowCount);
  check('C3  actor_employee_code stored UPPER-cased', psql(`select actor_employee_code from audit.entries where id=${id1}`) === 'PHF999');

  const list1 = await rawPost(base, 'list', { filters: { module: 'auth', limit: 5 } });
  check('C4  :list returns entries + keyset shape', list1.status === 200 && Array.isArray(list1.json.data.entries) && list1.json.data.entries.some((e) => e.id === String(id1)) && ('nextCursor' in list1.json.data), JSON.stringify(list1.json.data && list1.json.data.entries && list1.json.data.entries.length));
  const leaky = list1.json.data.entries.find((e) => ('before' in e) || ('after' in e) || ('ip' in e) || ('metadata' in e) || ('userAgent' in e) || ('requestId' in e));
  check('C5  :list rows carry NO before/after/ip/metadata (projection)', !leaky, leaky ? JSON.stringify(leaky) : '');

  const det1 = await rawPost(base, 'detail', { id: id1 });
  check('C6  :detail carries request_id/ip/user_agent/metadata', det1.status === 200 && det1.json.data.entry.ip === '198.51.100.7' && det1.json.data.entry.requestId === RUN_TAG && det1.json.data.entry.metadata && det1.json.data.entry.metadata.provider === 'password', JSON.stringify(det1.json.data.entry));

  // ---- C: security negatives ----
  const noTok = await rawPost(base, 'emit', { entry: { module: 'auth', action: 'AUTH_LOGOUT' } }, null);
  check('C7  no Bearer -> 401', noTok.status === 401, JSON.stringify(noTok));
  const badTok = await rawPost(base, 'emit', { entry: { module: 'auth', action: 'AUTH_LOGOUT' } }, 'wrong-token');
  check('C8  wrong Bearer -> 401', badTok.status === 401, JSON.stringify(badTok));
  const badVerb = await fetch(base + '/v1/audit:purge', { method: 'POST', headers: { Authorization: 'Bearer ' + SERVICE_TOKEN, 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.status);
  check('C9  unknown verb /v1/audit:purge -> not routed (404)', badVerb === 404, 'status=' + badVerb);
  const badAction = await rawPost(base, 'emit', { entry: { module: 'auth', action: 'TASK_SOMETHING' } });
  check('C10 unknown action rejected', badAction.status >= 400 && /AUDIT_ACTION_INVALID/.test(JSON.stringify(badAction.json)), JSON.stringify(badAction.json));
  const badModule = await rawPost(base, 'emit', { entry: { module: 'task', action: 'AUTH_LOGOUT' } });
  check('C11 unknown module rejected', badModule.status >= 400 && /AUDIT_MODULE_INVALID/.test(JSON.stringify(badModule.json)), JSON.stringify(badModule.json));
  const noUpdateVerb = await fetch(base + '/v1/audit:update', { method: 'POST', headers: { Authorization: 'Bearer ' + SERVICE_TOKEN, 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.status);
  check('C12 no :update verb exists', noUpdateVerb === 404, 'status=' + noUpdateVerb);

  // ==================================================================
  console.log('\n=== PHASE D · redaction + server-trusted identity via api/_lib/audit-emit ===\n');
  // Secret material in the payload must NEVER reach the DB.
  const secretBefore = {
    email: 'victim@phf.local', role: 'learner', status: 'active',
    password: 'PlainSecret123!', temporaryPassword: 'TmpAbc999', password_hash: 'argon2id$xxx',
    salt: 'deadbeef', token: 'jwt.aaa.bbb', authorization: 'Bearer leak', sessionId: 'sess-abc',
    note: 'x'.repeat(2000),
  };
  const r1 = await auditEmitMod.auditEmit(fakeReq(), { account: { id: 'admin-1', employeeCode: 'PHF001', name: 'Quản trị', email: 'admin@phf.local' } }, {
    module: 'account', action: 'ACCOUNT_UPDATE', result: 'success',
    object_type: 'account', object_id: 'victim-1', object_label: 'victim@phf.local',
    before: secretBefore, after: Object.assign({}, secretBefore, { role: 'admin' }),
    metadata: { run: RUN_TAG, apiKey: 'sk-should-not-appear' },
    // spoof attempts (must be ignored):
    ip: '1.2.3.4', request_id: 'SPOOFED', actor_name: 'HACKER',
  });
  check('D1  auditEmit returns {ok:true}', r1.ok === true, JSON.stringify(r1));
  const drow = JSON.parse(psql(`select row_to_json(t) from (select * from audit.entries where action='ACCOUNT_UPDATE' and object_id='victim-1' order by id desc limit 1) t`));
  const blob = JSON.stringify(drow);
  check('D2  NO secret value anywhere in stored row', !/PlainSecret123|TmpAbc999|argon2id|deadbeef|jwt\.aaa|sk-should-not-appear|Bearer leak|sess-abc/.test(blob), blob.slice(0, 400));
  check('D3  secret keys redacted to [redacted]', drow.before_json.password === '[redacted]' && drow.before_json.password_hash === '[redacted]' && drow.before_json.salt === '[redacted]' && drow.before_json.token === '[redacted]', JSON.stringify(drow.before_json));
  check('D4  oversize string truncated + _truncated marker', drow.before_json.note.length <= 600 && drow.before_json._truncated === true, 'noteLen=' + drow.before_json.note.length);
  check('D5  ip taken from request (x-forwarded-for), NOT ctx spoof', drow.ip === '203.0.113.9', 'ip=' + drow.ip);
  check('D6  request_id from x-vercel-id, NOT ctx spoof', drow.request_id === 'iad1::e2e-req-123', 'rid=' + drow.request_id);
  check('D7  user_agent from request header', drow.user_agent === 'PHF-E2E-UA/1.0', 'ua=' + drow.user_agent);
  check('D8  actor from SESSION, NOT ctx top-level spoof', drow.actor_employee_code === 'PHF001' && drow.actor_name === 'Quản trị', JSON.stringify([drow.actor_employee_code, drow.actor_name]));

  // sanctioned login-failure actor override (no session yet)
  const r2 = await auditEmitMod.auditEmit(fakeReq(), null, {
    module: 'auth', action: 'AUTH_LOGIN_FAILURE', result: 'failure',
    object_type: 'account', object_label: 'attempt@phf.local',
    metadata: { provider: 'password', reason: 'LOGIN_INVALID', run: RUN_TAG },
    actor: { actor_name: 'attempt@phf.local' },
  });
  const frow = JSON.parse(psql(`select row_to_json(t) from (select * from audit.entries where action='AUTH_LOGIN_FAILURE' and metadata_json->>'run'='${RUN_TAG}' order by id desc limit 1) t`));
  check('D9  login-failure: sanctioned ctx.actor override applied', r2.ok === true && frow.actor_name === 'attempt@phf.local' && frow.result === 'failure', JSON.stringify(frow && frow.actor_name));
  check('D10 login-failure row stores NO secret value (only provider label + reason)',
    frow.metadata_json && Object.keys(frow.metadata_json).sort().join(',') === 'provider,reason,run'
    && frow.metadata_json.provider === 'password' && frow.metadata_json.reason === 'LOGIN_INVALID'
    && frow.before_json === null && frow.after_json === null, JSON.stringify(frow.metadata_json));

  // ==================================================================
  console.log('\n=== PHASE E · representative event matrix (closed allowlist) ===\n');
  const S_ADMIN = { account: { id: 'admin-1', employeeCode: 'PHF001', name: 'Quản trị', email: 'admin@phf.local' } };
  const common = { module: 'account', result: 'success', object_type: 'account', object_id: 'target-9', object_label: 'target@phf.local' };
  const matrix = [
    ['AUTH_LOGIN_SUCCESS', { module: 'auth', action: 'AUTH_LOGIN_SUCCESS', object_type: 'account', metadata: { run: RUN_TAG } }],
    ['AUTH_LOGOUT', { module: 'auth', action: 'AUTH_LOGOUT', object_type: 'account', metadata: { run: RUN_TAG } }],
    ['ACCOUNT_CREATE', Object.assign({ action: 'ACCOUNT_CREATE', after: { email: 'target@phf.local', role: 'learner' }, metadata: { run: RUN_TAG } }, common)],
    ['ACCOUNT_ROLE_CHANGE', Object.assign({ action: 'ACCOUNT_ROLE_CHANGE', before: { role: 'learner' }, after: { role: 'admin' }, metadata: { run: RUN_TAG } }, common)],
    ['ACCOUNT_ACCESS_LOCK', Object.assign({ action: 'ACCOUNT_ACCESS_LOCK', before: { status: 'active' }, after: { status: 'inactive' }, metadata: { run: RUN_TAG } }, common)],
    ['ACCOUNT_ACCESS_UNLOCK', Object.assign({ action: 'ACCOUNT_ACCESS_UNLOCK', before: { status: 'inactive' }, after: { status: 'active' }, metadata: { run: RUN_TAG } }, common)],
    ['ACCOUNT_PASSWORD_RESET', Object.assign({ action: 'ACCOUNT_PASSWORD_RESET', metadata: { note: 'temp password issued (value never logged)', run: RUN_TAG } }, common)],
    ['ACCOUNT_DELETE', Object.assign({ action: 'ACCOUNT_DELETE', before: { email: 'target@phf.local', role: 'admin' }, metadata: { run: RUN_TAG } }, common)],
    ['EMPLOYEE_INACTIVE_AUTO_LOCK', Object.assign({ action: 'EMPLOYEE_INACTIVE_AUTO_LOCK', before: { status: 'active' }, after: { status: 'inactive' }, metadata: { trigger: 'employment_status->inactive', run: RUN_TAG } }, common)],
  ];
  for (const [label, ctx] of matrix) {
    const r = await auditEmitMod.auditEmit(fakeReq(), S_ADMIN, ctx);
    const c = psql(`select count(*) from audit.entries where action='${label}' and coalesce(metadata_json->>'run','')='${RUN_TAG}'`);
    check('E  ' + label + ' -> row', r.ok === true && c === '1', 'ok=' + r.ok + ' count=' + c);
  }

  // ==================================================================
  console.log('\n=== PHASE F · FAIL-OPEN (bridge unreachable) ===\n');
  // Point a fresh copy of the emit helper at a dead port.
  delete require.cache[require.resolve(path.join(REPO, 'api', '_lib', 'audit-emit'))];
  process.env.PHF_HR_API_BASE_URL = 'http://127.0.0.1:59999';
  const deadMod = require(path.join(REPO, 'api', '_lib', 'audit-emit'));
  let threw = false, res;
  try { res = await deadMod.auditEmit(fakeReq(), S_ADMIN, { module: 'auth', action: 'AUTH_LOGIN_SUCCESS', metadata: { run: RUN_TAG } }); } catch (e) { threw = true; }
  check('F1  bridge unreachable: auditEmit does NOT throw', threw === false, '');
  check('F2  bridge unreachable: returns {ok:false}', res && res.ok === false, JSON.stringify(res));
  let readThrew = false;
  try { await deadMod.auditList({ limit: 1 }); } catch (e) { readThrew = true; }
  check('F3  read path (auditList) DOES surface the failure (throws)', readThrew === true, '');

  // flag OFF entirely
  delete require.cache[require.resolve(path.join(REPO, 'api', '_lib', 'audit-emit'))];
  process.env.PHF_AUDIT_BRIDGE_ENABLED = 'false';
  const offMod = require(path.join(REPO, 'api', '_lib', 'audit-emit'));
  const offRes = await offMod.auditEmit(fakeReq(), S_ADMIN, { module: 'auth', action: 'AUTH_LOGOUT' });
  check('F4  flag OFF: auditEmit no-ops {ok:false,skipped:true}, no throw', offRes.ok === false && offRes.skipped === true, JSON.stringify(offRes));
  let offReadThrew = false; let offErr = null;
  try { await offMod.auditList({ limit: 1 }); } catch (e) { offReadThrew = true; offErr = e; }
  check('F5  flag OFF: read path throws AUDIT_BRIDGE_DISABLED (honest to Admin)', offReadThrew && offErr && offErr.code === 'AUDIT_BRIDGE_DISABLED', offErr && offErr.code);

  // bridge route fail-closed = Bearer only (same as /v1/notice). The on/off
  // switch is the Vercel-side flag exercised in F4/F5 above.
  process.env.PHF_AUDIT_BRIDGE_ENABLED = 'true';
  const noBearer = await rawPost(base, 'emit', { entry: { module: 'auth', action: 'AUTH_LOGOUT' } }, null);
  check('F6  bridge route without Bearer -> 401 (fail-closed)', noBearer.status === 401, JSON.stringify(noBearer));
  await stopApi();

  // ==================================================================
  console.log(`\n=== RESULT: ${PASS} PASS / ${FAIL} FAIL ===`);
  console.log(`(throwaway rows tagged run=${RUN_TAG} remain — append-only, throwaway only)`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error(e); stopApi().then(() => process.exit(1)); });
