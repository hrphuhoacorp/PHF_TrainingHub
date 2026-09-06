'use strict';
/*
 * PHF TASK — LOCAL PRODUCTION-PARITY SERVER (LOCAL ONLY, không deploy).
 *
 *   127.0.0.1:3000  Main App local
 *     -> Task integration/server bridge (flags ON trong process env, KHÔNG .env Production)
 *     -> local phf-hr-api  (child, services/phf-hr-api/server.js — candidate code)
 *     -> throwaway PostgreSQL 17 (127.0.0.1:15432 qua SSH tunnel; schema/trigger/role
 *        parity với live phf_hr; baseline Task sạch)
 *
 * KHÔNG legacy Supabase Task path. Org/actor/auth = PHF-HR-DEV (read).
 *
 * HARD GUARD fail-closed (abort trước khi spawn):
 *   - SUPABASE_URL BẮT BUỘC = PHF-HR-DEV ref. MAIN/rỗng/lạ -> abort.
 *   - PHF_HR_DB_* (từ PHF_HR_E2E_DB_ENV) BẮT BUỘC 127.0.0.1 + tên DB *_e2e.
 *   - Token/secret bridge = random runtime, KHÔNG in ra, KHÔNG ghi file.
 *   - KHÔNG set/ghi bất kỳ PHF_TASK_* flag nào vào .env — chỉ trong process env.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const DEV_HOST = 'pxkjvawdrixgoukhyvnk.supabase.co';
const MAIN_HOST = 'byhpcexmjzqpctyvfczd.supabase.co';

function loadEnv(p) {
  const o = {}; if (!p || !fs.existsSync(p)) return o;
  for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const s = l.trim(); if (!s || s[0] === '#') continue; const i = s.indexOf('='); if (i > 0) o[s.slice(0, i).trim()] = s.slice(i + 1).trim(); }
  return o;
}
function die(m) { console.error('LOCAL_PARITY_ABORT: ' + m); process.exit(1); }

const envTest = loadEnv(path.join(REPO, '.env.test'));
let sHost = ''; try { sHost = new URL(envTest.SUPABASE_URL).host; } catch (_) {}
if (sHost === MAIN_HOST) die('SUPABASE trỏ MAIN — cấm.');
if (sHost !== DEV_HOST) die('SUPABASE không phải PHF-HR-DEV (host=' + sHost + ').');
if (!envTest.SUPABASE_SECRET_KEY || !envTest.SUPABASE_PUBLISHABLE_KEY) die('thiếu key .env.test.');

const dbEnvPath = process.env.PHF_HR_E2E_DB_ENV || '';
const dbEnv = loadEnv(dbEnvPath);
if (!dbEnvPath) die('cần env PHF_HR_E2E_DB_ENV = đường dẫn phf-hr-e2e-db.env (từ throwaway provision).');
if (dbEnv.PHF_HR_DB_HOST !== '127.0.0.1') die('PHF_HR_DB_HOST != 127.0.0.1 (throwaway qua tunnel).');
if (!/_e2e$/.test(String(dbEnv.PHF_HR_DB_NAME || ''))) die('PHF_HR_DB_NAME phải kết thúc _e2e (thấy "' + dbEnv.PHF_HR_DB_NAME + '").');
if (!dbEnv.PHF_HR_DB_RUNTIME_USER || !dbEnv.PHF_HR_DB_RUNTIME_PASSWORD) die('thiếu PHF_HR_DB_RUNTIME_*.');

// token/secret: mặc định random runtime; cho phép override qua env CHỈ để debug
// local (không ghi ra đâu). Không phải secret Production.
const API_TOKEN = process.env.PHF_LOCAL_PARITY_API_TOKEN || crypto.randomBytes(32).toString('hex');
const DESC_SECRET = process.env.PHF_LOCAL_PARITY_DESC_SECRET || crypto.randomBytes(32).toString('hex');
const API_PORT = Number(process.env.PHF_LOCAL_PARITY_API_PORT || 18931);
const APP_PORT = Number(process.env.PORT || 3000);
const API_BASE = 'http://127.0.0.1:' + API_PORT;
const ATTACH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'phf-local-parity-attach-'));

const supaEnv = {
  SUPABASE_URL: envTest.SUPABASE_URL,
  SUPABASE_SECRET_KEY: envTest.SUPABASE_SECRET_KEY,
  SUPABASE_PUBLISHABLE_KEY: envTest.SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_JWKS_URL: 'https://' + DEV_HOST + '/auth/v1/.well-known/jwks.json',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUrl(u, ms, wantAnyOf) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(u); if (!wantAnyOf || wantAnyOf.includes(r.status)) return r.status; } catch (_) {}
    await sleep(200);
  }
  return null;
}

const children = [];
function stopAll(code) { for (const c of children) { try { c.kill('SIGTERM'); } catch (_) {} } try { fs.rmSync(ATTACH_ROOT, { recursive: true, force: true }); } catch (_) {} process.exit(code); }
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

(async () => {
  // 1) child phf-hr-api (candidate code) -> throwaway PG
  console.log('[local-parity] starting phf-hr-api child on ' + API_BASE + ' -> PG ' + dbEnv.PHF_HR_DB_HOST + ':' + dbEnv.PHF_HR_DB_PORT + '/' + dbEnv.PHF_HR_DB_NAME);
  const api = spawn(process.execPath, [path.join(REPO, 'services', 'phf-hr-api', 'server.js')], {
    cwd: path.join(REPO, 'services', 'phf-hr-api'),
    env: Object.assign({}, process.env, supaEnv, {
      PORT: String(API_PORT), PHF_HR_API_BIND_HOST: '127.0.0.1',
      PHF_HR_API_SERVICE_TOKEN: API_TOKEN, TASK_QUERY_DESCRIPTOR_SIGNING_SECRET: DESC_SECRET,
      PHF_HR_DB_HOST: dbEnv.PHF_HR_DB_HOST, PHF_HR_DB_PORT: String(dbEnv.PHF_HR_DB_PORT),
      PHF_HR_DB_NAME: dbEnv.PHF_HR_DB_NAME, PHF_HR_DB_RUNTIME_USER: dbEnv.PHF_HR_DB_RUNTIME_USER,
      PHF_HR_DB_RUNTIME_PASSWORD: dbEnv.PHF_HR_DB_RUNTIME_PASSWORD,
      PHF_HR_ATTACHMENT_ROOT: ATTACH_ROOT,
      // QTTH Batch 01A — DEVELOPMENT ACCESS LOCK. While QTTH is not FINAL the
      // module is closed to everyone except the system Admin and this explicit
      // allow-list (employee codes / account ids — never display names). Build/
      // test operators only. GO-LIVE = drop this env var (no code / no
      // permission-data change). Override with env QTTH_DEV_ACCESS_ALLOW.
      QTTH_DEV_ACCESS_ALLOW: process.env.QTTH_DEV_ACCESS_ALLOW
        || 'PHF012,acct-3a03c49e-5835-4d92-b89e-424836e79e24',
    }),
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.push(api);
  api.on('exit', (c) => { console.error('[local-parity] phf-hr-api child exited ' + c); stopAll(c || 1); });

  const apiHealth = await waitUrl(API_BASE + '/healthz', 15000, [200]);
  if (apiHealth !== 200) die('phf-hr-api child không healthy (/healthz != 200). Kiểm tra SSH tunnel 15432.');
  console.log('[local-parity] phf-hr-api /healthz = 200');

  // 2) Main App -> bridge -> child.  Flags ON chỉ trong process env.
  console.log('[local-parity] starting Main App on http://127.0.0.1:' + APP_PORT + '  (Task flags ON, bridge -> ' + API_BASE + ')');
  const app = spawn(process.execPath, [path.join(REPO, 'server.js')], {
    cwd: REPO,
    env: Object.assign({}, process.env, supaEnv, {
      HOST: '127.0.0.1', PORT: String(APP_PORT),
      PHF_HR_API_BASE_URL: API_BASE,
      PHF_HR_API_SERVICE_TOKEN: API_TOKEN, TASK_QUERY_DESCRIPTOR_SIGNING_SECRET: DESC_SECRET,
      PHF_TASK_SERVER_WRITE_ENABLED: 'true',
      PHF_TASK_WRITE_BRIDGE_ENABLED: 'true',
      PHF_TASK_READ_BRIDGE_ENABLED: 'true',
      PHF_TASK_READ_BRIDGE_GETDETAIL_ENABLED: 'true',
      PHF_TASK_READ_BRIDGE_LISTTASKS_ENABLED: 'true',
      PHF_TASK_OVERVIEW_READ_BRIDGE_ENABLED: 'true',
      // IN-APP NOTIFICATION V1 — Company-PG notification read/mark bridge.
      PHF_TASK_NOTIFICATION_BRIDGE_ENABLED: 'true',
      // C4.1 — Chương trình thi đua (Competition) V1 bridge, same phf-hr-api
      // child, same throwaway DB. Does not affect any PHF_TASK_* behaviour.
      PHF_COMPETITION_BRIDGE_ENABLED: 'true',
      // QTTH V1 Batch 01 — Quản trị tổng hợp bridge, same phf-hr-api child,
      // same throwaway DB. Needs migrations/phf_hr_qtth_foundation_v1.sql applied
      // to the throwaway (deployer). Does not affect Task/Competition behaviour.
      PHF_QTTH_BRIDGE_ENABLED: 'true',
    }),
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.push(app);
  app.on('exit', (c) => { console.error('[local-parity] Main App exited ' + c); stopAll(c || 1); });

  const appUp = await waitUrl('http://127.0.0.1:' + APP_PORT + '/api/health', 20000, [200, 503]);
  if (!appUp) die('Main App không lên (/api/health không phản hồi).');

  console.log('\n================= LOCAL PRODUCTION-PARITY MODE READY =================');
  console.log('LOCAL_URL       = http://127.0.0.1:' + APP_PORT);
  console.log('SUPABASE (org/auth) = PHF-HR-DEV (' + DEV_HOST + ')  [read]');
  console.log('TASK_BACKEND_READ  = SERVER BRIDGE (server.js dispatch -> read-bridge -> local phf-hr-api ' + API_BASE + ')');
  console.log('TASK_BACKEND_WRITE = SERVER BRIDGE (server.js dispatch -> write-bridge -> local phf-hr-api ' + API_BASE + ')');
  console.log('TASK_DB          = throwaway PostgreSQL ' + dbEnv.PHF_HR_DB_HOST + ':' + dbEnv.PHF_HR_DB_PORT + '/' + dbEnv.PHF_HR_DB_NAME + ' (container ' + (dbEnv.PHF_HR_E2E_CONTAINER || '?') + ')');
  console.log('TASK FLAGS       = SERVER_WRITE + WRITE_BRIDGE + READ(categories/getTaskDetail/listTasks) = ON (process env only)');
  console.log('COMPETITION      = PHF_COMPETITION_BRIDGE_ENABLED=true (same phf-hr-api child, same throwaway DB, process env only)');
  console.log('COMPETITION_URL  = http://127.0.0.1:' + APP_PORT + '/admin/thi-dua  (or /hv/thi-dua, /ql/thi-dua)');
  console.log('PROD DATA        = NOT touched (MAIN ' + MAIN_HOST + ' never written; live phf_hr never written)');
  console.log('===================================================================');
  console.log('Ctrl+C để dừng cả 2 tiến trình.');
})().catch((e) => { console.error('[local-parity] fatal: ' + (e && e.stack || e)); stopAll(1); });
