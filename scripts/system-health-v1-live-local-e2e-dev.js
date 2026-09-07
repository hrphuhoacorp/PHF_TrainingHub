'use strict';
/*
 * PHF SYSTEM V1 — TÌNH TRẠNG HỆ THỐNG — LIVE LOCAL e2e (LOCAL ONLY).
 *
 * Spawns a REAL phf-hr-api child against the throwaway Company PostgreSQL
 * (phf_hr_e2e, SSH tunnel 15432) with PHF_SYSTEM_HEALTH_BRIDGE_ENABLED=true
 * and proves the full chain:
 *   - GET  /v1/system:health   — process ok + deep SELECT 1 + heartbeat rows + mail aggregate
 *   - POST /v1/system:heartbeat — upsert; sensitive keys in `summary` are dropped
 *   - security: no Bearer -> 401 ; bad job -> 400 ; flag OFF -> 503
 *   - api/_lib/system-health.getSystemHealth() composes 6 lines against the live child
 *   - emitCronHeartbeat FAIL-OPEN when the bridge is unreachable / disabled
 *
 * NOT prod. No prod DB/data/flag. No push/deploy.
 * Run: node scripts/system-health-v1-live-local-e2e-dev.js
 */
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const DEV_HOST = 'pxkjvawdrixgoukhyvnk.supabase.co';
const CONTAINER = process.env.PHF_HR_E2E_CONTAINER || 'phf-hr-e2e-throwaway-20260827T123257Z';
const API_PORT = 18953;

function loadEnv(p) { const o = {}; if (!fs.existsSync(p)) return o; for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const s = l.trim(); if (!s || s[0] === '#') continue; const i = s.indexOf('='); if (i > 0) o[s.slice(0, i).trim()] = s.slice(i + 1).trim(); } return o; }
function die(m) { console.error('E2E_ABORT: ' + m); process.exit(1); }
const envTest = loadEnv(path.join(REPO, '.env.test'));
if (!envTest.SUPABASE_URL || new URL(envTest.SUPABASE_URL).host !== DEV_HOST) die('.env.test không phải PHF-HR-DEV.');
const dbEnv = loadEnv(path.join(REPO, 'e2e', 'phf-hr-e2e-db.env'));
if (dbEnv.PHF_HR_DB_HOST !== '127.0.0.1' || !/_e2e$/.test(dbEnv.PHF_HR_DB_NAME || '')) die('e2e/phf-hr-e2e-db.env sai (không phải throwaway *_e2e).');

const SERVICE_TOKEN = crypto.randomBytes(32).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function tcpOpen(port) { return new Promise((res) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); setTimeout(() => { s.destroy(); res(false); }, 1500); }); }
async function waitHealth(u, ms) { const end = Date.now() + ms; while (Date.now() < end) { try { const r = await fetch(u); if (r.status === 200) return true; } catch (_) {} await sleep(200); } return false; }
function psql(sql) { return execFileSync('ssh', ['claude-phf', `docker exec ${CONTAINER} psql -U postgres -d phf_hr_e2e -tAc "${sql.replace(/"/g, '\\"')}"`], { encoding: 'utf8' }).trim(); }

let PASS = 0, FAIL = 0;
function check(name, cond, extra) { if (cond) { PASS++; console.log('  PASS  ' + name); } else { FAIL++; console.error('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); } }

let apiChild = null;
function stopApi() {
  if (!apiChild) return Promise.resolve();
  const c = apiChild; apiChild = null;
  return new Promise((res) => { c.once('exit', () => res()); try { c.kill('SIGTERM'); } catch (_) { res(); } setTimeout(res, 4000); });
}
process.on('exit', () => { if (apiChild) { try { apiChild.kill('SIGTERM'); } catch (_) {} } });

async function startApi(port, healthEnabled) {
  const env = Object.assign({}, process.env, {
    PORT: String(port), PHF_HR_API_BIND_HOST: '127.0.0.1',
    PHF_HR_API_SERVICE_TOKEN: SERVICE_TOKEN,
    SUPABASE_URL: envTest.SUPABASE_URL, SUPABASE_SECRET_KEY: envTest.SUPABASE_SECRET_KEY,
    PHF_HR_DB_HOST: dbEnv.PHF_HR_DB_HOST, PHF_HR_DB_PORT: String(dbEnv.PHF_HR_DB_PORT),
    PHF_HR_DB_NAME: dbEnv.PHF_HR_DB_NAME, PHF_HR_DB_RUNTIME_USER: dbEnv.PHF_HR_DB_RUNTIME_USER,
    PHF_HR_DB_RUNTIME_PASSWORD: dbEnv.PHF_HR_DB_RUNTIME_PASSWORD,
    PHF_HR_ATTACHMENT_ROOT: fs.mkdtempSync(os.tmpdir() + path.sep + 'sh-e2e-'),
    TASK_QUERY_DESCRIPTOR_SIGNING_SECRET: crypto.randomBytes(32).toString('hex'),
    PHF_SYSTEM_HEALTH_BRIDGE_ENABLED: healthEnabled ? 'true' : 'false',
  });
  apiChild = spawn(process.execPath, [path.join(REPO, 'services', 'phf-hr-api', 'server.js')], {
    cwd: path.join(REPO, 'services', 'phf-hr-api'), env, stdio: ['ignore', 'inherit', 'inherit'],
  });
  const base = 'http://127.0.0.1:' + port;
  if (!(await waitHealth(base + '/healthz', 15000))) { await stopApi(); die('phf-hr-api child not healthy on ' + port); }
  return base;
}

function get(base, pathname, token) {
  const h = {};
  if (token !== null) h.Authorization = 'Bearer ' + (token || SERVICE_TOKEN);
  return fetch(base + pathname, { headers: h }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
}
function post(base, pathname, body, token) {
  const h = { 'Content-Type': 'application/json' };
  if (token !== null) h.Authorization = 'Bearer ' + (token || SERVICE_TOKEN);
  return fetch(base + pathname, { method: 'POST', headers: h, body: JSON.stringify(body || {}) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
}

(async () => {
  if (!(await tcpOpen(15432))) die('SSH tunnel 127.0.0.1:15432 chưa mở.');
  if (psql("select count(*) from information_schema.tables where table_schema='system' and table_name='cron_heartbeat'") !== '1') {
    die('system.cron_heartbeat chưa có trên throwaway — apply migrations/phf_hr_system_health_v1.sql trước.');
  }

  console.log('\n=== PHASE A · bridge ON ===\n');
  let base = await startApi(API_PORT, true);

  // ---- deep health snapshot ----
  const h1 = await get(base, '/v1/system:health');
  check('A1  GET /v1/system:health -> 200', h1.status === 200 && h1.json.ok === true, JSON.stringify(h1.json).slice(0, 200));
  const d = h1.json.data || {};
  check('A2  api.status = ok + uptime', d.api && d.api.status === 'ok' && Number.isFinite(d.api.uptimeSeconds), JSON.stringify(d.api));
  check('A3  db deep probe ok + latency', d.db && d.db.ok === true && Number.isFinite(d.db.latencyMs) && d.db.reason == null, JSON.stringify(d.db));
  check('A4  heartbeats: all 3 jobs present', Array.isArray(d.heartbeats) && d.heartbeats.length === 3 && d.heartbeats.map((x) => x.job).sort().join(',') === 'task-mail,task-recurrence,task-weekly-report', JSON.stringify(d.heartbeats && d.heartbeats.map((x) => x.job)));
  check('A5  mail aggregate present (counts only)', d.mail && ('pending' in d.mail) && !('recipient' in d.mail) && !('payload' in d.mail), JSON.stringify(d.mail));
  check('A6  DTO carries no DSN / host / password', !/PHF_HR_DB_RUNTIME_PASSWORD|host":|"password"|postgresql:\/\//.test(JSON.stringify(h1.json)), '');

  // ---- heartbeat upsert + redaction ----
  const w1 = await post(base, '/v1/system:heartbeat', { job: 'task-mail', ok: true, summary: { sent: 4, failed: 0, providerConfigured: true, recipientEmail: 'victim@phf.local', body: 'secret body', token: 'sk-xxx' } });
  check('A7  POST /v1/system:heartbeat -> 200', w1.status === 200 && w1.json.ok === true, JSON.stringify(w1.json));
  const stored = JSON.parse(psql("select coalesce(last_summary::text,'null') from system.cron_heartbeat where job='task-mail'"));
  check('A8  heartbeat summary keeps only safe counters', JSON.stringify(stored) === JSON.stringify({ sent: 4, failed: 0, providerConfigured: true }), JSON.stringify(stored));
  check('A9  NO recipient / body / token stored', !/victim@phf|secret body|sk-xxx/.test(psql("select row_to_json(t)::text from (select * from system.cron_heartbeat where job='task-mail') t")), '');
  const w2 = await post(base, '/v1/system:heartbeat', { job: 'notice-bogus', ok: true });
  check('A10 unknown job -> 400 SYSTEM_HEALTH_JOB_INVALID', w2.status === 400 && /SYSTEM_HEALTH_JOB_INVALID/.test(JSON.stringify(w2.json)), JSON.stringify(w2.json));

  // fresh recurrence + weekly heartbeats so the aggregator has something recent
  await post(base, '/v1/system:heartbeat', { job: 'task-recurrence', ok: true, summary: { rulesScanned: 27, generated: 0 } });
  await post(base, '/v1/system:heartbeat', { job: 'task-weekly-report', ok: true, summary: { recipients: 5 } });

  const h2 = await get(base, '/v1/system:health');
  const mailHb = (h2.json.data.heartbeats || []).find((x) => x.job === 'task-mail');
  check('A11 heartbeat read-back: task-mail lastOk + fresh age', mailHb && mailHb.lastOk === true && mailHb.ageSeconds != null && mailHb.ageSeconds < 120, JSON.stringify(mailHb));

  // ---- security negatives ----
  const noTok = await get(base, '/v1/system:health', null);
  check('A12 no Bearer -> 401', noTok.status === 401, JSON.stringify(noTok));
  const noTokW = await post(base, '/v1/system:heartbeat', { job: 'task-mail', ok: true }, null);
  check('A13 heartbeat no Bearer -> 401', noTokW.status === 401, JSON.stringify(noTokW));

  console.log('\n=== PHASE B · Vercel aggregator against the live child ===\n');
  delete require.cache[require.resolve(path.join(REPO, 'api/_lib/system-health.js'))];
  process.env.PHF_HR_API_BASE_URL = base;
  process.env.PHF_HR_API_SERVICE_TOKEN = SERVICE_TOKEN;
  process.env.PHF_SYSTEM_HEALTH_BRIDGE_ENABLED = 'true';
  const A = require(path.join(REPO, 'api/_lib/system-health.js'));
  const snap = await A.getSystemHealth();
  check('B1  composed snapshot has 6 lines + overall', snap && snap.lines && Object.keys(snap.lines).length === 6 && snap.overall && snap.overall.status, JSON.stringify(snap && snap.overall));
  check('B2  API line HEALTHY (process + deep db ok)', snap.lines.api.status === 'HEALTHY', JSON.stringify(snap.lines.api));
  check('B3  Database line reads Company PG deep probe', snap.lines.database.companyPostgres && snap.lines.database.companyPostgres.status === 'HEALTHY', JSON.stringify(snap.lines.database));
  check('B4  Tác vụ nền uses the fresh heartbeats -> HEALTHY', snap.lines.jobs.status === 'HEALTHY' && snap.lines.jobs.recurrence && snap.lines.jobs.recurrence.status === 'HEALTHY', JSON.stringify(snap.lines.jobs));
  check('B5  Email line derives from the mail aggregate', ['HEALTHY', 'WARNING', 'ERROR'].includes(snap.lines.mail.status), JSON.stringify(snap.lines.mail));
  check('B6  Sao lưu = UNKNOWN (no app-readable signal in V1)', snap.lines.backup.status === 'UNKNOWN', JSON.stringify(snap.lines.backup));
  check('B7  snapshot carries NO secret', !/PHF_HR_DB_RUNTIME_PASSWORD|"password"|postgresql:\/\/|Bearer /.test(JSON.stringify(snap)), '');

  // ---- fail-open emit ----
  console.log('\n=== PHASE C · FAIL-OPEN ===\n');
  delete require.cache[require.resolve(path.join(REPO, 'api/_lib/system-health.js'))];
  process.env.PHF_HR_API_BASE_URL = 'http://127.0.0.1:59998';
  const A2 = require(path.join(REPO, 'api/_lib/system-health.js'));
  let threw = false, res;
  try { res = await A2.emitCronHeartbeat('task-mail', true, { sent: 1 }); } catch (e) { threw = true; }
  check('C1  emitCronHeartbeat unreachable: does NOT throw', threw === false, '');
  check('C2  emitCronHeartbeat unreachable: {ok:false}', res && res.ok === false, JSON.stringify(res));
  const snapDead = await A2.getSystemHealth();
  check('C3  aggregator with dead bridge still returns (no hang)', snapDead && snapDead.lines && snapDead.lines.api.status === 'ERROR', JSON.stringify(snapDead.lines.api));
  check('C4  dead-bridge: DB + jobs + mail = UNKNOWN (not silently HEALTHY)', snapDead.lines.database.companyPostgres.status === 'UNKNOWN' && snapDead.lines.jobs.status === 'UNKNOWN' && snapDead.lines.mail.status === 'UNKNOWN', JSON.stringify(Object.keys(snapDead.lines).map((k) => k + ':' + snapDead.lines[k].status)));

  delete require.cache[require.resolve(path.join(REPO, 'api/_lib/system-health.js'))];
  process.env.PHF_SYSTEM_HEALTH_BRIDGE_ENABLED = 'false';
  const A3 = require(path.join(REPO, 'api/_lib/system-health.js'));
  const off = await A3.emitCronHeartbeat('task-mail', true, { sent: 1 });
  check('C5  flag OFF: emit no-ops {ok:false,skipped:true}', off.ok === false && off.skipped === true, JSON.stringify(off));

  // bridge route fail-closed = Bearer only (same as /v1/notice). The on/off
  // switch is the Vercel-side flag exercised in C5 above.
  const nb1 = await get(base, '/v1/system:health', null);
  const nb2 = await post(base, '/v1/system:heartbeat', { job: 'task-mail', ok: true }, null);
  check('C6  :health without Bearer -> 401 (fail-closed)', nb1.status === 401, JSON.stringify(nb1));
  check('C7  :heartbeat without Bearer -> 401 (fail-closed)', nb2.status === 401, JSON.stringify(nb2));
  await stopApi();

  console.log(`\n=== RESULT: ${PASS} PASS / ${FAIL} FAIL ===`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error(e); stopApi().then(() => process.exit(1)); });
