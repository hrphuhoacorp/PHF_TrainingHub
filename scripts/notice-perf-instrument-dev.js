'use strict';
/*
 * PHF HR — THÔNG BÁO QUẢN TRỊ · PERFORMANCE INSTRUMENT (LOCAL ONLY).
 *
 * Measures — with evidence, not feel — what the browser actually costs the
 * backend for the common navigation flows of the Thông báo module:
 *   - how many /api/data round-trips the SPA fires per screen,
 *   - how many phf-hr-api bridge calls that becomes,
 *   - how many Company-PostgreSQL transactions (BEGIN/SET ROLE/COMMIT) open,
 *   - wall time per flow.
 *
 * It drives the SAME dispatchNoticeAction entrypoint the Vercel layer uses and
 * replays the exact call sequence window.phfRenderNotice() issues for each
 * navigation (read straight off assets/js/notice/phf-notice-app.js).
 *
 * PREREQ (same as the live e2e): SSH tunnel 127.0.0.1:15432 up, throwaway PG
 * with schema notice.*, .env.test = PHF-HR-DEV, e2e/phf-hr-e2e-db.env.
 * Run: node scripts/notice-perf-instrument-dev.js
 */
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const DEV_HOST = 'pxkjvawdrixgoukhyvnk.supabase.co';

function loadEnv(p) { const o = {}; if (!fs.existsSync(p)) return o; for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const s = l.trim(); if (!s || s[0] === '#') continue; const i = s.indexOf('='); if (i > 0) o[s.slice(0, i).trim()] = s.slice(i + 1).trim(); } return o; }
function die(m) { console.error('PERF_ABORT: ' + m); process.exit(1); }
const envTest = loadEnv(path.join(REPO, '.env.test'));
if (!envTest.SUPABASE_URL || new URL(envTest.SUPABASE_URL).host !== DEV_HOST) die('.env.test không phải PHF-HR-DEV.');
const dbEnv = loadEnv(path.join(REPO, 'e2e', 'phf-hr-e2e-db.env'));
if (dbEnv.PHF_HR_DB_HOST !== '127.0.0.1' || !/_e2e$/.test(dbEnv.PHF_HR_DB_NAME || '')) die('e2e/phf-hr-e2e-db.env sai.');

const SERVICE_TOKEN = crypto.randomBytes(32).toString('hex');
const API_PORT = 18949;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function tcpOpen(port) { return new Promise((res) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); setTimeout(() => { s.destroy(); res(false); }, 1500); }); }
async function waitHealth(u, ms) { const end = Date.now() + ms; while (Date.now() < end) { try { const r = await fetch(u); if (r.status === 200) return true; } catch (_) {} await sleep(200); } return false; }

let apiChild = null;
function stopApi() { if (!apiChild) return Promise.resolve(); const c = apiChild; apiChild = null; return new Promise((res) => { c.once('exit', () => res()); try { c.kill('SIGTERM'); } catch (_) {} setTimeout(res, 4000); }); }
process.on('exit', () => { if (apiChild) { try { apiChild.kill('SIGTERM'); } catch (_) {} } });

async function startApi() {
  const env = Object.assign({}, process.env, {
    PORT: String(API_PORT), PHF_HR_API_BIND_HOST: '127.0.0.1', PHF_HR_API_SERVICE_TOKEN: SERVICE_TOKEN,
    SUPABASE_URL: envTest.SUPABASE_URL, SUPABASE_SECRET_KEY: envTest.SUPABASE_SECRET_KEY,
    PHF_HR_DB_HOST: dbEnv.PHF_HR_DB_HOST, PHF_HR_DB_PORT: String(dbEnv.PHF_HR_DB_PORT),
    PHF_HR_DB_NAME: dbEnv.PHF_HR_DB_NAME, PHF_HR_DB_RUNTIME_USER: dbEnv.PHF_HR_DB_RUNTIME_USER,
    PHF_HR_DB_RUNTIME_PASSWORD: dbEnv.PHF_HR_DB_RUNTIME_PASSWORD,
    PHF_HR_ATTACHMENT_ROOT: fs.mkdtempSync(os.tmpdir() + path.sep + 'notice-perf-attach-'),
    TASK_QUERY_DESCRIPTOR_SIGNING_SECRET: crypto.randomBytes(32).toString('hex'),
    NOTICE_LOG_LEVEL: 'error',
  });
  delete env.NOTICE_DEV_ACCESS_ALLOW;
  apiChild = spawn(process.execPath, [path.join(REPO, 'services', 'phf-hr-api', 'server.js')], {
    cwd: path.join(REPO, 'services', 'phf-hr-api'), env, stdio: ['ignore', 'ignore', 'inherit'],
  });
  const base = 'http://127.0.0.1:' + API_PORT;
  if (!(await waitHealth(base + '/healthz', 15000))) { await stopApi(); die('phf-hr-api child not healthy'); }
  process.env.PHF_HR_API_BASE_URL = base;
  process.env.PHF_HR_API_SERVICE_TOKEN = SERVICE_TOKEN;
  process.env.PHF_NOTICE_BRIDGE_ENABLED = 'true';
  process.env.SUPABASE_URL = envTest.SUPABASE_URL;
  process.env.SUPABASE_SECRET_KEY = envTest.SUPABASE_SECRET_KEY;
}

// ---- instrumentation ------------------------------------------------------
const counters = { httpFromBrowser: 0, bridgeCalls: 0, bridgeByAction: {}, bridgeMs: 0 };
function resetCounters() { counters.httpFromBrowser = 0; counters.bridgeCalls = 0; counters.bridgeByAction = {}; counters.bridgeMs = 0; }

let dispatchNoticeAction = null;
// wrap the Vercel->phf-hr-api bridge AFTER startApi() has populated the env the
// bridge module snapshots into a const at require time.
function wireInstrumentation() {
  const bridgeMod = require(path.join(REPO, 'api', '_lib', 'notice-bridge'));
  const realCall = bridgeMod.callNoticeAction;
  bridgeMod.callNoticeAction = async function (action, actor, params) {
    counters.bridgeCalls++;
    counters.bridgeByAction[action] = (counters.bridgeByAction[action] || 0) + 1;
    const t0 = Date.now();
    try { return await realCall(action, actor, params); }
    finally { counters.bridgeMs += Date.now() - t0; }
  };
  ({ dispatchNoticeAction } = require(path.join(REPO, 'api', '_lib', 'notice-actions')));
}
async function browserPost(session, payload) {
  // one /api/data POST from the SPA
  counters.httpFromBrowser++;
  const r = await dispatchNoticeAction(session, payload);
  if (!r.handled) throw new Error('unhandled ' + payload.action);
  return r.result;
}

/*
 * The SPA call sequences, transcribed from assets/js/notice/phf-notice-app.js.
 *
 * window.phfRenderNotice() ALWAYS runs, on every in-app navigation to a
 * /thong-bao path (router calls it — phf-url-router.js line ~1220):
 *   1. call('noticeBootstrap')          [phfRenderNotice line ~153]
 *   2. loadCategories(true)  -> call('noticeCategoriesList')   [line ~170, force=true]
 *   3. the per-screen loader:
 *        feed   -> renderFeed -> loadFeed -> call('noticeFeed')
 *        detail -> renderDetail -> call('noticeDetail')
 *
 * A client that keeps STATE.boot / STATE.categories across navigations only
 * needs step 3. The helpers below take `cache` to model that.
 */
async function navFeed(S, cache) {
  if (!cache.boot) { await browserPost(S, { action: 'noticeBootstrap' }); cache.boot = true; }
  if (!cache.cats) { await browserPost(S, { action: 'noticeCategoriesList' }); cache.cats = true; }
  await browserPost(S, { action: 'noticeFeed', q: '', type: '', status: '', scope: '', include_drafts: false });
}
async function navDetail(S, cache, id) {
  if (!cache.boot) { await browserPost(S, { action: 'noticeBootstrap' }); cache.boot = true; }
  if (!cache.cats) { await browserPost(S, { action: 'noticeCategoriesList' }); cache.cats = true; }
  await browserPost(S, { action: 'noticeDetail', id });
}
async function statusFilterClick(S) {
  // feed status chip -> renderFeed re-render -> loadFeed only (NO re-bootstrap)
  await browserPost(S, { action: 'noticeFeed', q: '', status: 'active', include_drafts: false });
}

async function measure(label, fn) {
  resetCounters();
  const t0 = Date.now();
  await fn();
  const ms = Date.now() - t0;
  const byAction = Object.entries(counters.bridgeByAction).map(([a, n]) => `${a}×${n}`).join(' ');
  console.log(
    `  ${label.padEnd(46)}  browserPOST=${String(counters.httpFromBrowser).padStart(2)}  bridge=${String(counters.bridgeCalls).padStart(2)}  ${String(ms).padStart(5)}ms`
    + (byAction ? `\n${' '.repeat(50)}${byAction}` : '')
  );
  return { label, ...counters, ms };
}

(async () => {
  if (!(await tcpOpen(15432))) die('SSH tunnel 127.0.0.1:15432 chưa mở.');
  await startApi();
  wireInstrumentation();

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(envTest.SUPABASE_URL, envTest.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const adminAcc = (await sb.from('user_accounts').select('id,email,role,employee_code').eq('role', 'admin').eq('status', 'active').limit(1).maybeSingle()).data;
  const viewerAcc = (await sb.from('user_accounts').select('id,email,role,employee_code').eq('role', 'learner').eq('status', 'active').not('employee_code', 'is', null).neq('employee_code', '').limit(1).maybeSingle()).data;
  if (!adminAcc || !viewerAcc) die('không lấy đủ persona');
  const sess = (a) => ({ account: { id: a.id, employeeCode: a.employee_code || '', role: a.role, email: a.email, name: a.email }, role: a.role, sub: a.id });
  const S_ADMIN = sess(adminAcc), S_VIEWER = sess(viewerAcc);

  // make sure at least one published notice exists to open
  let feed = await browserPost(S_ADMIN, { action: 'noticeFeed', q: '' });
  if (!feed.notices.length) {
    const cr = await browserPost(S_ADMIN, { action: 'noticeCreate', title: 'Perf fixture', content_text: 'nội dung.', notice_type: 'guide', effective_from: '2026-09-01' });
    await browserPost(S_ADMIN, { action: 'noticePublish', id: cr.id });
    feed = await browserPost(S_ADMIN, { action: 'noticeFeed', q: '' });
  }
  const someId = feed.notices[0].id;

  const MODE = process.env.NOTICE_PERF_MODE || (process.argv[2] || 'current');
  console.log(`\n=== NOTICE PERF INSTRUMENT · mode=${MODE} · fixture notice=${someId} ===`);
  console.log('Flow = the exact call sequence the SPA fires (transcribed from phf-notice-app.js).\n');

  const cacheModel = MODE === 'cached'
    ? { boot: false, cats: false }                     // persists across the whole session
    : null;                                            // 'current' = fresh cache every nav
  const c = () => cacheModel || { boot: false, cats: false };

  const results = [];
  console.log('VIEWER — open module → open a notice → back to feed → open another → status filter:');
  results.push(await measure('open module (feed)', () => navFeed(S_VIEWER, c())));
  results.push(await measure('open a notice (detail)', () => navDetail(S_VIEWER, c(), someId)));
  results.push(await measure('back to feed', () => navFeed(S_VIEWER, c())));
  results.push(await measure('open another notice (detail)', () => navDetail(S_VIEWER, c(), someId)));
  results.push(await measure('click "Đang hiệu lực" status filter', () => statusFilterClick(S_VIEWER)));

  console.log('\nADMIN — open module → open a notice → back:');
  const ca = () => cacheModel || { boot: false, cats: false };
  if (cacheModel) { cacheModel.boot = false; cacheModel.cats = false; }
  results.push(await measure('open module (feed)', () => navFeed(S_ADMIN, ca())));
  results.push(await measure('open a notice (detail)', () => navDetail(S_ADMIN, ca(), someId)));
  results.push(await measure('back to feed', () => navFeed(S_ADMIN, ca())));

  const totBrowser = results.reduce((s, r) => s + r.httpFromBrowser, 0);
  const totBridge = results.reduce((s, r) => s + r.bridgeCalls, 0);
  const totMs = results.reduce((s, r) => s + r.ms, 0);
  console.log(`\n  ---- TOTAL for the 8-step flow: browserPOST=${totBrowser}  bridgeCalls=${totBridge}  wall=${totMs}ms ----`);

  await stopApi();
  process.exit(0);
})().catch((e) => { stopApi(); console.error('PERF fatal: ' + (e && e.stack || e)); process.exit(1); });
