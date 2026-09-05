'use strict';
/*
 * PHF HR — COMPETITION LOCAL PRODUCTION-PARITY SERVER (LOCAL ONLY, Batch C4).
 *
 *   127.0.0.1:3000  Main App local
 *     -> Competition bridge (api/_lib/competition-bridge.js, flag ON in
 *        process env only — never written to any .env file)
 *     -> local phf-hr-api (child, services/phf-hr-api/server.js — this
 *        worktree's candidate code)
 *     -> throwaway PostgreSQL 17 (127.0.0.1:15432 via the SSH tunnel to
 *        claude-phf; container phf-hr-e2e-throwaway-…; schema competition.*
 *        from Batch B)
 *
 * Modelled 1:1 on the existing scripts/task-local-parity-server-dev.js
 * pattern (same hard guards, same spawn shape) — kept as a SEPARATE,
 * Competition-scoped file rather than editing that one, and deliberately
 * does NOT flip any PHF_TASK_* flag (Task stays in its default/off state;
 * this file's only job is proving the Competition path).
 *
 * Identity: org/actor/auth = PHF-HR-DEV Supabase project (read-only,
 * .env.test) — the SAME People Master every other PHF HR module reads from
 * in this local-parity mode. NOT the live MAIN/Production project.
 *
 * HARD GUARDS fail-closed (abort before spawning anything):
 *   - SUPABASE_URL must be the PHF-HR-DEV ref. MAIN/blank/unknown -> abort.
 *   - PHF_HR_DB_* (from PHF_HR_E2E_DB_ENV) must be 127.0.0.1 + a *_e2e DB.
 *   - Bridge token/secret = random per run, never printed, never written.
 *   - No PHF_COMPETITION_* / PHF_TASK_* flag is ever written to a .env file
 *     — process env only, for the lifetime of this process.
 *
 * This worktree has no services/phf-hr-api/node_modules of its own — pass
 * PHF_LOCAL_PARITY_NODE_MODULES=<main worktree>/services/phf-hr-api/node_modules
 * (falls back to trying the sibling path both worktrees usually share).
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
function die(m) { console.error('COMPETITION_LOCAL_PARITY_ABORT: ' + m); process.exit(1); }

const envTest = loadEnv(path.join(REPO, '.env.test'));
let sHost = ''; try { sHost = new URL(envTest.SUPABASE_URL).host; } catch (_) {}
if (sHost === MAIN_HOST) die('SUPABASE trỏ MAIN — cấm.');
if (sHost !== DEV_HOST) die('SUPABASE không phải PHF-HR-DEV (host=' + sHost + ').');
if (!envTest.SUPABASE_SECRET_KEY || !envTest.SUPABASE_PUBLISHABLE_KEY) die('thiếu key .env.test.');

const dbEnvPath = process.env.PHF_HR_E2E_DB_ENV || path.join(REPO, 'e2e', 'phf-hr-e2e-db.env');
const dbEnv = loadEnv(dbEnvPath);
if (!fs.existsSync(dbEnvPath)) die('không thấy file DB throwaway: ' + dbEnvPath);
if (dbEnv.PHF_HR_DB_HOST !== '127.0.0.1') die('PHF_HR_DB_HOST != 127.0.0.1 (throwaway qua tunnel).');
if (!/_e2e$/.test(String(dbEnv.PHF_HR_DB_NAME || ''))) die('PHF_HR_DB_NAME phải kết thúc _e2e (thấy "' + dbEnv.PHF_HR_DB_NAME + '").');
if (!dbEnv.PHF_HR_DB_RUNTIME_USER || !dbEnv.PHF_HR_DB_RUNTIME_PASSWORD) die('thiếu PHF_HR_DB_RUNTIME_*.');

const API_TOKEN = process.env.PHF_LOCAL_PARITY_API_TOKEN || crypto.randomBytes(32).toString('hex');
const API_PORT = Number(process.env.PHF_LOCAL_PARITY_API_PORT || 18932); // distinct from Task's 18931 so both can run side by side
const APP_PORT = Number(process.env.PORT || 3000);
const API_BASE = 'http://127.0.0.1:' + API_PORT;
const ATTACH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'phf-comp-local-parity-attach-'));

// this worktree has no services/phf-hr-api/node_modules — reuse a sibling
// worktree's, same trick used by the Batch C1/C2/C3 offline+realdb tests.
function findApiNodeModules() {
  const local = path.join(REPO, 'services', 'phf-hr-api', 'node_modules');
  if (fs.existsSync(local)) return null; // has its own — no NODE_PATH needed
  const candidates = [
    process.env.PHF_LOCAL_PARITY_NODE_MODULES,
    'D:\\Web nội bộ - training\\ĐÃ CHỐT\\NHÂN VIÊN MỚI\\1. BÁN HÀNG\\PHF_TrainingHub\\services\\phf-hr-api\\node_modules',
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  die('services/phf-hr-api/node_modules không có trong worktree này và không tìm thấy worktree chị em nào — set PHF_LOCAL_PARITY_NODE_MODULES.');
}
const apiNodeModules = findApiNodeModules();

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
  console.log('[competition-local-parity] starting phf-hr-api child on ' + API_BASE + ' -> PG ' + dbEnv.PHF_HR_DB_HOST + ':' + dbEnv.PHF_HR_DB_PORT + '/' + dbEnv.PHF_HR_DB_NAME);
  const apiEnv = Object.assign({}, process.env, supaEnv, {
    PORT: String(API_PORT), PHF_HR_API_BIND_HOST: '127.0.0.1',
    PHF_HR_API_SERVICE_TOKEN: API_TOKEN,
    PHF_HR_DB_HOST: dbEnv.PHF_HR_DB_HOST, PHF_HR_DB_PORT: String(dbEnv.PHF_HR_DB_PORT),
    PHF_HR_DB_NAME: dbEnv.PHF_HR_DB_NAME, PHF_HR_DB_RUNTIME_USER: dbEnv.PHF_HR_DB_RUNTIME_USER,
    PHF_HR_DB_RUNTIME_PASSWORD: dbEnv.PHF_HR_DB_RUNTIME_PASSWORD,
    PHF_HR_ATTACHMENT_ROOT: ATTACH_ROOT,
  });
  if (apiNodeModules) apiEnv.NODE_PATH = apiNodeModules;
  const api = spawn(process.execPath, [path.join(REPO, 'services', 'phf-hr-api', 'server.js')], {
    cwd: path.join(REPO, 'services', 'phf-hr-api'), env: apiEnv, stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.push(api);
  api.on('exit', (c) => { console.error('[competition-local-parity] phf-hr-api child exited ' + c); stopAll(c || 1); });

  const apiHealth = await waitUrl(API_BASE + '/healthz', 15000, [200]);
  if (apiHealth !== 200) die('phf-hr-api child không healthy (/healthz != 200). Kiểm tra SSH tunnel 15432.');
  console.log('[competition-local-parity] phf-hr-api /healthz = 200');

  console.log('[competition-local-parity] starting Main App on http://127.0.0.1:' + APP_PORT + '  (Competition bridge ON only, Task flags left at default)');
  const app = spawn(process.execPath, [path.join(REPO, 'server.js')], {
    cwd: REPO,
    env: Object.assign({}, process.env, supaEnv, {
      HOST: '127.0.0.1', PORT: String(APP_PORT),
      PHF_HR_API_BASE_URL: API_BASE,
      PHF_HR_API_SERVICE_TOKEN: API_TOKEN,
      PHF_COMPETITION_BRIDGE_ENABLED: 'true',
    }),
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.push(app);
  app.on('exit', (c) => { console.error('[competition-local-parity] Main App exited ' + c); stopAll(c || 1); });

  const appUp = await waitUrl('http://127.0.0.1:' + APP_PORT + '/api/health', 20000, [200, 503]);
  if (!appUp) die('Main App không lên (/api/health không phản hồi).');

  console.log('\n========== COMPETITION LOCAL PRODUCTION-PARITY MODE READY ==========');
  console.log('LOCAL_URL            = http://127.0.0.1:' + APP_PORT + '/admin/thi-dua  (or /hv/thi-dua, /ql/thi-dua)');
  console.log('SUPABASE (org/auth)  = PHF-HR-DEV (' + DEV_HOST + ')  [read-only, real People Master]');
  console.log('COMPETITION_BACKEND  = SERVER BRIDGE (server.js -> competition-bridge.js -> local phf-hr-api ' + API_BASE + ')');
  console.log('COMPETITION_DB       = throwaway PostgreSQL ' + dbEnv.PHF_HR_DB_HOST + ':' + dbEnv.PHF_HR_DB_PORT + '/' + dbEnv.PHF_HR_DB_NAME + ' (container ' + (dbEnv.PHF_HR_E2E_CONTAINER || '?') + ')');
  console.log('FLAGS                = PHF_COMPETITION_BRIDGE_ENABLED=true (process env only). No PHF_TASK_* flag touched.');
  console.log('PROD DATA            = NOT touched (MAIN Supabase ' + MAIN_HOST + ' never written; live phf_hr never written)');
  console.log('======================================================================');
  console.log('Ctrl+C để dừng cả 2 tiến trình.');
})().catch((e) => { console.error('[competition-local-parity] fatal: ' + (e && e.stack || e)); stopAll(1); });
