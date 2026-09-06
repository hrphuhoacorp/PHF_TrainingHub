'use strict';
/*
 * PHF HR — QTTH Batch 02 · Bảng lương · LIVE LOCAL e2e (LOCAL ONLY — no deploy,
 * no PROD, no PROD migration).
 *
 * Full path exercised:
 *   dispatchQtthAction (Vercel layer) -> qtth-identity (People Master = Supabase
 *   PHF-HR-DEV, read) -> qtth-bridge (flag ON) -> phf-hr-api child ->
 *   throwaway Company PostgreSQL phf_hr_e2e / schema payroll (SSH tunnel 15432).
 *
 * PREREQ:
 *   1. migrations/phf_hr_qtth_payroll_v1.sql applied to throwaway phf_hr_e2e
 *      (schema `payroll`), plus qtth foundation (for the dev-lock bootstrap).
 *   2. SSH tunnel: ssh -f -N -T -L 15432:127.0.0.1:15432 claude-phf
 *   3. .env.test = PHF-HR-DEV keys ; e2e/phf-hr-e2e-db.env = throwaway PG
 *
 * Run: node scripts/qtth-payroll-batch02-live-local-e2e-dev.js
 */
const path = require('path');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const DEV_HOST = 'pxkjvawdrixgoukhyvnk.supabase.co';
const THROWAWAY_CONTAINER = 'phf-hr-e2e-throwaway-20260827T123257Z';
const { gridToXlsx } = require(path.join(REPO, 'scripts/lib/xlsx-write-lite'));

function loadEnv(p) { const o = {}; if (!fs.existsSync(p)) return o; for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const s = l.trim(); if (!s || s[0] === '#') continue; const i = s.indexOf('='); if (i > 0) o[s.slice(0, i).trim()] = s.slice(i + 1).trim(); } return o; }
function die(m) { console.error('E2E_ABORT: ' + m); process.exit(1); }
const envTest = loadEnv(path.join(REPO, '.env.test'));
if (!envTest.SUPABASE_URL || new URL(envTest.SUPABASE_URL).host !== DEV_HOST) die('.env.test không phải PHF-HR-DEV.');
const dbEnv = loadEnv(path.join(REPO, 'e2e', 'phf-hr-e2e-db.env'));
if (dbEnv.PHF_HR_DB_HOST !== '127.0.0.1' || !/_e2e$/.test(dbEnv.PHF_HR_DB_NAME || '')) die('e2e/phf-hr-e2e-db.env sai.');

const API_PORT = 18939;
const API_BASE = 'http://127.0.0.1:' + API_PORT;
const SERVICE_TOKEN = crypto.randomBytes(32).toString('hex');
const DEV_ALLOW = 'PHF012,acct-3a03c49e-5835-4d92-b89e-424836e79e24';

function tcpOpen(port) { return new Promise((res) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); setTimeout(() => { s.destroy(); res(false); }, 1500); }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHealth(u, ms) { const end = Date.now() + ms; while (Date.now() < end) { try { const r = await fetch(u); if (r.status === 200) return true; } catch (_) {} await sleep(200); } return false; }
function psql(sql) { return execFileSync('ssh', ['claude-phf', `docker exec ${THROWAWAY_CONTAINER} psql -U postgres -d phf_hr_e2e -tAc "${sql.replace(/"/g, '\\"')}"`], { encoding: 'utf8' }).trim(); }

let PASS = 0, FAIL = 0;
function check(name, cond, extra) { if (cond) { PASS++; console.log('  PASS  ' + name); } else { FAIL++; console.error('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); } }
async function expectThrow(name, fn, codeWanted) {
  try { await fn(); check(name, false, 'no error thrown'); }
  catch (e) { check(name, !codeWanted || e.code === codeWanted, 'got code=' + e.code + ' msg=' + e.message); }
}

function tsvGrid(name) { return fs.readFileSync(path.join(REPO, 'scripts/fixtures/payroll', name), 'utf8').split(/\r?\n/).map((l) => l.split('\t')); }

(async () => {
  if (!(await tcpOpen(15432))) die('SSH tunnel 127.0.0.1:15432 chưa mở. Chạy: ssh -f -N -T -L 15432:127.0.0.1:15432 claude-phf');
  if (psql("select count(*) from information_schema.schemata where schema_name='payroll'") !== '1') die('schema payroll chưa có trên throwaway — apply migrations/phf_hr_qtth_payroll_v1.sql trước.');
  if (psql("select count(*) from information_schema.schemata where schema_name='qtth'") !== '1') die('schema qtth chưa có — apply foundation trước.');

  // deterministic payroll state
  // append-only triggers block cascade DELETE on raw_row/delta even for superuser
  psql('alter table payroll.raw_row disable trigger user; alter table payroll.delta disable trigger user; '
    + 'delete from payroll.import; delete from payroll.template; '
    + 'alter table payroll.raw_row enable trigger user; alter table payroll.delta enable trigger user;');

  console.log('[e2e] spawning phf-hr-api child -> throwaway PG');
  const attachRoot = fs.mkdtempSync(require('os').tmpdir() + require('path').sep + 'qtth-payroll-e2e-');
  const api = spawn(process.execPath, [path.join(REPO, 'services', 'phf-hr-api', 'server.js')], {
    cwd: path.join(REPO, 'services', 'phf-hr-api'),
    env: Object.assign({}, process.env, {
      PORT: String(API_PORT), PHF_HR_API_BIND_HOST: '127.0.0.1',
      PHF_HR_API_SERVICE_TOKEN: SERVICE_TOKEN,
      SUPABASE_URL: envTest.SUPABASE_URL, SUPABASE_SECRET_KEY: envTest.SUPABASE_SECRET_KEY,
      PHF_HR_DB_HOST: dbEnv.PHF_HR_DB_HOST, PHF_HR_DB_PORT: String(dbEnv.PHF_HR_DB_PORT),
      PHF_HR_DB_NAME: dbEnv.PHF_HR_DB_NAME, PHF_HR_DB_RUNTIME_USER: dbEnv.PHF_HR_DB_RUNTIME_USER,
      PHF_HR_DB_RUNTIME_PASSWORD: dbEnv.PHF_HR_DB_RUNTIME_PASSWORD,
      PHF_HR_ATTACHMENT_ROOT: attachRoot,
      TASK_QUERY_DESCRIPTOR_SIGNING_SECRET: crypto.randomBytes(32).toString('hex'),
      QTTH_DEV_ACCESS_ALLOW: DEV_ALLOW,
    }),
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const cleanup = () => { try { api.kill('SIGTERM'); } catch (_) {} };
  process.on('exit', cleanup);
  if (!(await waitHealth(API_BASE + '/healthz', 15000))) { cleanup(); die('phf-hr-api child not healthy'); }

  process.env.PHF_HR_API_BASE_URL = API_BASE;
  process.env.PHF_HR_API_SERVICE_TOKEN = SERVICE_TOKEN;
  process.env.PHF_QTTH_BRIDGE_ENABLED = 'true';
  process.env.SUPABASE_URL = envTest.SUPABASE_URL;
  process.env.SUPABASE_SECRET_KEY = envTest.SUPABASE_SECRET_KEY;

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(envTest.SUPABASE_URL, envTest.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const { dispatchQtthAction } = require(path.join(REPO, 'api', '_lib', 'qtth-actions'));
  const D = (session, payload) => dispatchQtthAction(session, payload).then((r) => { if (!r.handled) throw Object.assign(new Error('unhandled ' + payload.action), { code: 'UNHANDLED' }); return r.result; });

  const adminAcc = (await sb.from('user_accounts').select('id,email,role,employee_code').eq('role', 'admin').eq('status', 'active').limit(1).maybeSingle()).data;
  const opAcc = (await sb.from('user_accounts').select('id,email,role,employee_code').ilike('email', '%thanglv150917%').maybeSingle()).data;
  const normAcc = (await sb.from('user_accounts').select('id,email,role,employee_code').eq('role', 'learner').eq('status', 'active').not('employee_code', 'is', null).neq('employee_code', '').limit(1).maybeSingle()).data;
  if (!adminAcc || !opAcc || !normAcc) { cleanup(); die('không lấy đủ persona từ DEV'); }
  const sess = (a) => ({ account: { id: a.id, employeeCode: a.employee_code || '', role: a.role, email: a.email, name: a.email }, role: a.role, sub: a.id });
  const S_ADMIN = sess(adminAcc), S_OP = sess(opAcc), S_NORM = sess(normAcc);
  console.log(`[e2e] admin=${adminAcc.email} operator=${opAcc.email}/${opAcc.employee_code} normal=${normAcc.email}`);

  const PERIOD = '2026-07';
  const T7 = tsvGrid('T7.tsv');
  const xlsxV1 = gridToXlsx(T7).toString('base64');

  console.log('\nQTTH Batch 02 — Bảng lương · LIVE LOCAL e2e\n');

  // C20 — normal user blocked (dev lock) before anything persists
  await expectThrow('C20 normal user -> qtthPayrollStatus bị chặn (QTTH_DEV_LOCKED)',
    () => D(S_NORM, { action: 'qtthPayrollStatus', period_month: PERIOD }), 'QTTH_DEV_LOCKED');
  await expectThrow('C20 normal user -> qtthPayrollValidatePreview bị chặn',
    () => D(S_NORM, { action: 'qtthPayrollValidatePreview', period_month: PERIOD, file_name: 'x.xlsx', file_base64: xlsxV1 }), 'QTTH_DEV_LOCKED');

  // Admin + Operator allowed
  const st0 = await D(S_ADMIN, { action: 'qtthPayrollStatus', period_month: PERIOD });
  check('Admin vào được payroll.status', st0 && st0.exists === false);
  const st0op = await D(S_OP, { action: 'qtthPayrollStatus', period_month: PERIOD });
  check('Operator PHF012 vào được payroll.status', st0op && st0op.exists === false);

  // C17 — confirm required before data becomes "current"
  const prev = await D(S_OP, { action: 'qtthPayrollValidatePreview', period_month: PERIOD, file_name: 'bang-luong-T7.xlsx', file_base64: xlsxV1 });
  check('validatePreview trả report đầy đủ (V1, rows>0, fingerprint)',
    prev.version === 1 && prev.totals.rows > 0 && prev.templateFingerprint && prev.versionDiff.isFirstVersion === true,
    JSON.stringify({ v: prev.version, rows: prev.totals && prev.totals.rows }));
  const stAfterPreview = await D(S_OP, { action: 'qtthPayrollStatus', period_month: PERIOD });
  check('C17 sau preview: chưa có phiên bản "current" (phải xác nhận trước)',
    stAfterPreview.exists === true && !stAfterPreview.current && stAfterPreview.versions[0].status === 'previewed');
  const listBefore = await D(S_OP, { action: 'qtthPayrollListNormalized', period_month: PERIOD });
  check('C17 listNormalized rỗng trước khi confirm', (listBefore.rows || []).length === 0 && listBefore.version == null);

  // confirm
  const conf = await D(S_OP, { action: 'qtthPayrollConfirm', file_id: prev.fileId });
  check('confirm V1 thành công', conf && conf.alreadyConfirmed === false);
  const stAfterConfirm = await D(S_OP, { action: 'qtthPayrollStatus', period_month: PERIOD });
  check('sau confirm: current = V1', stAfterConfirm.current && stAfterConfirm.current.version === 1 && stAfterConfirm.importStatus === 'active');

  // first canonical template registered
  check('mẫu chuẩn V1 được đăng ký là canonical',
    psql("select is_canonical from payroll.template order by created_at limit 1") === 't');

  // C18 — raw + normalized + delta traceable
  const list1 = await D(S_OP, { action: 'qtthPayrollListNormalized', period_month: PERIOD });
  check('C18 listNormalized trả đúng số dòng đã confirm', list1.rows.length === stAfterConfirm.current.rowCount && list1.rows.length > 0);
  const someCode = list1.rows[0].employeeCode;
  const det1 = await D(S_OP, { action: 'qtthPayrollEmployeeDetail', period_month: PERIOD, employee_code: someCode });
  check('C18 employeeDetail: normalized + sourceDetail + rawCells cùng có',
    det1.normalized && det1.normalized.employee_code === someCode && det1.rawCells && typeof det1.sourceDetail === 'object',
    JSON.stringify({ hasRaw: !!det1.rawCells, hasSD: !!det1.sourceDetail }));
  check('C18 raw_row immutable (append-only trigger) tồn tại',
    psql("select count(*) from pg_trigger where tgname='raw_row_immutable'") === '1');

  // D5 — final stays the uploaded value
  const pRow = list1.rows.find((r) => r.employeeCode === 'PHF002');
  check('D5 THỰC NHẬN SAU THUẾ (PHF002) = giá trị tải lên 29,020,100',
    pRow && Number(pRow.finalNetAfterTax) === 29020100, pRow && String(pRow.finalNetAfterTax));

  // C19 — re-read persistence
  const stRe = await D(S_ADMIN, { action: 'qtthPayrollStatus', period_month: PERIOD });
  const listRe = await D(S_ADMIN, { action: 'qtthPayrollListNormalized', period_month: PERIOD });
  check('C19 re-status/listNormalized (persona khác) trả cùng dữ liệu',
    stRe.current.version === 1 && listRe.rows.length === list1.rows.length && listRe.version === 1);

  // C12–C14 — V1 -> V2 delta
  const T7v2 = T7.map((r) => r.slice());
  const finalCol = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-template')).fingerprint(T7).columnMap.final_net_after_tax;
  // bump PHF065 final by 5000 (row 12, 0-based)
  T7v2[12][finalCol] = String(Number(T7v2[12][finalCol]) + 5000);
  T7v2.splice(16, 1); // drop PHF091 (row 16)
  const xlsxV2 = gridToXlsx(T7v2).toString('base64');
  const prev2 = await D(S_OP, { action: 'qtthPayrollValidatePreview', period_month: PERIOD, file_name: 'bang-luong-T7-v2.xlsx', file_base64: xlsxV2 });
  check('C13 preview V2: PHF065 nằm trong changed (before→after +5000)',
    (prev2.versionDiff.changed || []).some((c) => c.employeeCode === 'PHF065' && c.changes.some((ch) => ch.field === 'final_net_after_tax' && Number(ch.after) - Number(ch.before) === 5000)),
    JSON.stringify(prev2.versionDiff.changed));
  check('C14 preview V2: PHF091 nằm trong missingFromNewVersion',
    (prev2.versionDiff.missingFromNewVersion || []).includes('PHF091'));
  check('C12 preview V2: các dòng không đổi KHÔNG nằm trong changed',
    (prev2.versionDiff.changed || []).every((c) => c.employeeCode === 'PHF065'));
  const conf2 = await D(S_OP, { action: 'qtthPayrollConfirm', file_id: prev2.fileId });
  check('confirm V2: delta ghi nhận (changed>=1, removedMissing>=1)',
    conf2.deltaCounts.changed >= 1 && conf2.deltaCounts.removedMissing >= 1, JSON.stringify(conf2.deltaCounts));
  const stV2 = await D(S_OP, { action: 'qtthPayrollStatus', period_month: PERIOD });
  check('sau confirm V2: current = V2, V1 -> superseded',
    stV2.current.version === 2 && stV2.versions.find((v) => v.version === 1).status === 'superseded');
  const det65 = await D(S_OP, { action: 'qtthPayrollEmployeeDetail', period_month: PERIOD, employee_code: 'PHF065' });
  check('C18 delta traceable: lịch sử PHF065 có bản ghi changed final_net_after_tax',
    (det65.history || []).some((h) => h.change_type === 'changed' && h.field === 'final_net_after_tax'));
  const det91 = await D(S_OP, { action: 'qtthPayrollEmployeeDetail', period_month: PERIOD, employee_code: 'PHF091' }).catch((e) => ({ err: e.code }));
  check('PHF091 vắng ở V2: không còn trong bản chuẩn hiệu lực (404), lịch sử vẫn giữ ở delta',
    det91.err === 'PAYROLL_EMPLOYEE_NOT_IN_PERIOD' &&
    psql("select count(*) from payroll.delta where employee_code='PHF091' and change_type='removed_missing'") === '1');

  // idempotent confirm
  const confAgain = await D(S_OP, { action: 'qtthPayrollConfirm', file_id: prev2.fileId });
  check('confirm V2 lần 2 idempotent (alreadyConfirmed)', confAgain.alreadyConfirmed === true);

  cleanup();
  console.log(`\n${PASS}/${PASS + FAIL} live checks passed` + (FAIL ? '  — FAIL' : '  — ALL PASS'));
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('E2E CRASH', e); process.exit(1); });
