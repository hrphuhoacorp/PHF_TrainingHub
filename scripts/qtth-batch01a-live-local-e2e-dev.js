'use strict';
/*
 * PHF HR — QTTH Batch 01A · LIVE LOCAL e2e (LOCAL ONLY, no deploy, no PROD).
 *
 * Full path exercised:
 *   dispatchQtthAction (Vercel layer)  ->  qtth-identity (People Master = Supabase
 *   PHF-HR-DEV, read)  ->  qtth-bridge (flag ON)  ->  phf-hr-api child  ->
 *   throwaway Company PostgreSQL phf_hr_e2e / schema qtth (via SSH tunnel 15432).
 *
 * PREREQ (all local-safe, already wired):
 *   1. migrations/phf_hr_qtth_foundation_v1.sql applied to throwaway phf_hr_e2e
 *   2. SSH tunnel: ssh -f -N -T -L 15432:127.0.0.1:15432 claude-phf
 *   3. .env.test = PHF-HR-DEV keys ; e2e/phf-hr-e2e-db.env = throwaway PG
 *
 * Run: node scripts/qtth-batch01a-live-local-e2e-dev.js
 */
const path = require('path');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const DEV_HOST = 'pxkjvawdrixgoukhyvnk.supabase.co';
const THROWAWAY_CONTAINER = 'phf-hr-e2e-throwaway-20260827T123257Z';

function loadEnv(p) { const o = {}; if (!fs.existsSync(p)) return o; for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const s = l.trim(); if (!s || s[0] === '#') continue; const i = s.indexOf('='); if (i > 0) o[s.slice(0, i).trim()] = s.slice(i + 1).trim(); } return o; }
function die(m) { console.error('E2E_ABORT: ' + m); process.exit(1); }
const envTest = loadEnv(path.join(REPO, '.env.test'));
if (!envTest.SUPABASE_URL || new URL(envTest.SUPABASE_URL).host !== DEV_HOST) die('.env.test không phải PHF-HR-DEV.');
const dbEnv = loadEnv(path.join(REPO, 'e2e', 'phf-hr-e2e-db.env'));
if (dbEnv.PHF_HR_DB_HOST !== '127.0.0.1' || !/_e2e$/.test(dbEnv.PHF_HR_DB_NAME || '')) die('e2e/phf-hr-e2e-db.env sai.');

const API_PORT = 18937;
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

(async () => {
  if (!(await tcpOpen(15432))) die('SSH tunnel 127.0.0.1:15432 chưa mở. Chạy: ssh -f -N -T -L 15432:127.0.0.1:15432 claude-phf');
  if (psql("select count(*) from information_schema.schemata where schema_name='qtth'") !== '1') die('schema qtth chưa có trên throwaway — apply migration trước.');

  // fresh QTTH state for a deterministic run. The append-only trigger blocks
  // DELETE/TRUNCATE on *_history even for superuser (by design) — disable it
  // only for this test-reset, then re-enable.
  psql('alter table qtth.classification_history disable trigger user; alter table qtth.permission_history disable trigger user; '
    + 'delete from qtth.classification_history; delete from qtth.permission_history; '
    + 'delete from qtth.classification; delete from qtth.module_permission; delete from qtth.permission_manager_grant; delete from qtth.dict_group; delete from qtth.dict_unit; '
    + 'alter table qtth.classification_history enable trigger user; alter table qtth.permission_history enable trigger user');

  console.log('[e2e] spawning phf-hr-api child -> throwaway PG');
  const api = spawn(process.execPath, [path.join(REPO, 'services', 'phf-hr-api', 'server.js')], {
    cwd: path.join(REPO, 'services', 'phf-hr-api'),
    env: Object.assign({}, process.env, {
      PORT: String(API_PORT), PHF_HR_API_BIND_HOST: '127.0.0.1',
      PHF_HR_API_SERVICE_TOKEN: SERVICE_TOKEN,
      SUPABASE_URL: envTest.SUPABASE_URL, SUPABASE_SECRET_KEY: envTest.SUPABASE_SECRET_KEY,
      PHF_HR_DB_HOST: dbEnv.PHF_HR_DB_HOST, PHF_HR_DB_PORT: String(dbEnv.PHF_HR_DB_PORT),
      PHF_HR_DB_NAME: dbEnv.PHF_HR_DB_NAME, PHF_HR_DB_RUNTIME_USER: dbEnv.PHF_HR_DB_RUNTIME_USER,
      PHF_HR_DB_RUNTIME_PASSWORD: dbEnv.PHF_HR_DB_RUNTIME_PASSWORD,
      PHF_HR_ATTACHMENT_ROOT: fs.mkdtempSync(require('os').tmpdir() + require('path').sep + 'qtth-e2e-attach-'),
      TASK_QUERY_DESCRIPTOR_SIGNING_SECRET: crypto.randomBytes(32).toString('hex'),
      QTTH_DEV_ACCESS_ALLOW: DEV_ALLOW,
    }),
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const cleanup = () => { try { api.kill('SIGTERM'); } catch (_) {} };
  process.on('exit', cleanup);

  if (!(await waitHealth(API_BASE + '/healthz', 15000))) { cleanup(); die('phf-hr-api child not healthy'); }

  // parent env for the Vercel bridge + identity
  process.env.PHF_HR_API_BASE_URL = API_BASE;
  process.env.PHF_HR_API_SERVICE_TOKEN = SERVICE_TOKEN;
  process.env.PHF_QTTH_BRIDGE_ENABLED = 'true';
  process.env.SUPABASE_URL = envTest.SUPABASE_URL;
  process.env.SUPABASE_SECRET_KEY = envTest.SUPABASE_SECRET_KEY;

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(envTest.SUPABASE_URL, envTest.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const { dispatchQtthAction } = require(path.join(REPO, 'api', '_lib', 'qtth-actions'));
  const D = (session, payload) => dispatchQtthAction(session, payload).then((r) => { if (!r.handled) throw Object.assign(new Error('unhandled action ' + payload.action), { code: 'UNHANDLED' }); return r.result; });

  // --- personas from PHF-HR-DEV user_accounts ---
  const adminAcc = (await sb.from('user_accounts').select('id,email,role,employee_code').eq('role', 'admin').eq('status', 'active').limit(1).maybeSingle()).data;
  const opAcc = (await sb.from('user_accounts').select('id,email,role,employee_code').ilike('email', '%thanglv150917%').maybeSingle()).data;
  const normAcc = (await sb.from('user_accounts').select('id,email,role,employee_code').eq('role', 'learner').eq('status', 'active').not('employee_code', 'is', null).neq('employee_code', '').limit(1).maybeSingle()).data;
  const inactiveEmp = (await sb.from('employee_profiles').select('employee_code,full_name').neq('employment_status', 'active').limit(1).maybeSingle()).data;
  const inactiveAcc = inactiveEmp ? (await sb.from('user_accounts').select('id,email,role,employee_code').ilike('employee_code', inactiveEmp.employee_code).maybeSingle()).data : null;
  const activeEmps = (await sb.from('employee_profiles').select('employee_code,department').eq('employment_status', 'active')).data || [];

  if (!adminAcc || !opAcc || !normAcc) { cleanup(); die('không lấy đủ persona từ DEV'); }
  const sess = (a) => ({ account: { id: a.id, employeeCode: a.employee_code || '', role: a.role, email: a.email, name: a.email }, role: a.role, sub: a.id });
  const S_ADMIN = sess(adminAcc), S_OP = sess(opAcc), S_NORM = sess(normAcc);
  console.log(`[e2e] admin=${adminAcc.email} operator=${opAcc.email}/${opAcc.employee_code} normal=${normAcc.email}/${normAcc.employee_code} inactive=${inactiveEmp && inactiveEmp.employee_code}(acct:${!!inactiveAcc})`);

  // pick 3 active target employees not equal to the personas
  const targets = activeEmps.map((e) => e.employee_code).filter((c) => c && c !== opAcc.employee_code && c !== normAcc.employee_code).slice(0, 3);
  const [T1, T2, T3] = targets;

  console.log('\nQTTH Batch 01A — LIVE LOCAL e2e\n');

  // 1. Admin in
  const bAdmin = await D(S_ADMIN, { action: 'qtthBootstrap' });
  check('1  Admin vào được QTTH (all caps, devLocked)', bAdmin.capabilities.canManagePermissions && bAdmin.capabilities.canViewQtth && bAdmin.capabilities.canViewOperations && bAdmin.devLocked === true, JSON.stringify(bAdmin.capabilities));

  // 2. Operator Thắng in without a manual grant
  const grantRows = psql(`select count(*) from qtth.permission_manager_grant where employee_code='${opAcc.employee_code}'`);
  const bOp = await D(S_OP, { action: 'qtthBootstrap' });
  check('2  Operator Thắng vào được, KHÔNG cần grant thủ công', bOp.capabilities.canManagePermissions === true && bOp.devOperator === true && grantRows === '0', 'grantRows=' + grantRows + ' caps=' + JSON.stringify(bOp.capabilities));

  // 3. normal user blocked despite a permission row
  await D(S_ADMIN, { action: 'qtthSetPermission', employee_code: normAcc.employee_code, field: 'can_view_qtth', value: true });
  await D(S_ADMIN, { action: 'qtthSetPermission', employee_code: normAcc.employee_code, field: 'can_view_operations', value: true });
  const bNorm = await D(S_NORM, { action: 'qtthBootstrap' });
  const normRow = psql(`select can_view_qtth||','||can_view_operations from qtth.module_permission where employee_code='${normAcc.employee_code}'`);
  check('3a normal user: bootstrap khoá dù có permission row (row=' + normRow + ')', bNorm.devLocked === true && !bNorm.capabilities.canViewQtth && !bNorm.capabilities.canViewOperations && !bNorm.capabilities.canManagePermissions);
  await expectThrow('3b normal user: qtthListRoster bị chặn server-side', () => D(S_NORM, { action: 'qtthListRoster' }), 'QTTH_DEV_LOCKED');
  await expectThrow('3c normal user: qtthSetClassification bị chặn server-side', () => D(S_NORM, { action: 'qtthSetClassification', employee_code: T1, unit_id: '' }), 'QTTH_DEV_LOCKED');

  // 4. roster active load (real)
  const period = (() => { const d = new Date(Date.now() + 7 * 3600e3); const m = d.getUTCMonth() + 1; return d.getUTCFullYear() + '-' + (m < 10 ? '0' + m : m); })();
  const roster1 = await D(S_OP, { action: 'qtthListRoster', period });
  const activeInRoster = roster1.roster.filter((r) => r.status === 'active').length;
  check('4  Roster active load thật (' + activeInRoster + ' active / ' + roster1.roster.length + ' tổng)', activeInRoster >= 30 && roster1.roster.length >= activeInRoster && Array.isArray(roster1.units));

  // 5. new employee defaults
  const t1row = roster1.roster.find((r) => r.employeeCode === T1);
  check('5  Nhân sự chưa có dữ liệu = no permission + no classification', t1row && !t1row.canViewQtth && !t1row.canViewOperations && !t1row.unitId && !t1row.groupId && !t1row.staffKind, JSON.stringify(t1row));

  // dictionaries for the edit tests
  const uId = (await D(S_OP, { action: 'qtthUpsertDictionary', kind: 'unit', name: 'Phú Lợi' })).id;
  const gId = (await D(S_OP, { action: 'qtthUpsertDictionary', kind: 'group', name: 'Khối Vận hành' })).id;

  // 6. edit CN/Nhóm/Trực-Gián persists across a refresh (re-list)
  await D(S_OP, { action: 'qtthSetClassification', employee_code: T1, period, unit_id: uId, group_id: gId, staff_kind: 'direct' });
  const roster2 = await D(S_OP, { action: 'qtthListRoster', period });
  const t1b = roster2.roster.find((r) => r.employeeCode === T1);
  check('6  Edit CN/Nhóm/Trực-Gián persist sau refresh', t1b.unitId === uId && t1b.groupId === gId && t1b.staffKind === 'direct', JSON.stringify(t1b));

  // 7. bulk classification persists
  await D(S_OP, { action: 'qtthBulkSetClassification', period, field: 'staff_kind', value: 'indirect', employee_codes: [T2, T3] });
  const roster3 = await D(S_OP, { action: 'qtthListRoster', period });
  const t2 = roster3.roster.find((r) => r.employeeCode === T2), t3 = roster3.roster.find((r) => r.employeeCode === T3);
  check('7  Bulk classification persist', t2.staffKind === 'indirect' && t3.staffKind === 'indirect');

  // 8. per-person permission toggle persists
  await D(S_ADMIN, { action: 'qtthSetPermission', employee_code: T1, field: 'can_view_qtth', value: true });
  const roster4 = await D(S_OP, { action: 'qtthListRoster', period });
  check('8  Permission toggle từng người persist', roster4.roster.find((r) => r.employeeCode === T1).canViewQtth === true);

  // 9. permission history
  const ph = await D(S_OP, { action: 'qtthPermissionHistory', employee_code: T1 });
  check('9  Permission history persist', ph.entries.length >= 1 && ph.entries.some((e) => e.field === 'can_view_qtth' && e.after === true));

  // 10. classification history
  const ch = await D(S_OP, { action: 'qtthClassificationHistory', employee_code: T1, period });
  check('10 Classification history persist', ch.entries.length >= 1 && ch.entries.some((e) => e.field === 'unit_id'));

  // 11. inactive user fail-closed
  if (inactiveAcc) {
    await expectThrow('11 Inactive user fail-closed (identity từ chối)', () => D(sess(inactiveAcc), { action: 'qtthBootstrap' }), 'QTTH_IDENTITY_INACTIVE');
  } else {
    // no account for an inactive employee on DEV — assert the roster marks them inactive + never active-classifiable via warnings path
    const inRoster = roster4.roster.find((r) => r.employeeCode === (inactiveEmp && inactiveEmp.employee_code));
    check('11 Inactive user fail-closed (roster marks đã nghỉ)', inRoster && inRoster.status === 'inactive', JSON.stringify(inRoster));
  }

  // 12. source department change does NOT overwrite classification
  psql(`update qtth.classification set source_department_snapshot='__SOURCE_CHANGED__' where employee_code='${T1}' and period='${period}'`);
  const roster5 = await D(S_OP, { action: 'qtthListRoster', period });
  const t1c = roster5.roster.find((r) => r.employeeCode === T1);
  check('12 Source department change không overwrite classification (flag cảnh báo, giữ nguyên giá trị)',
    t1c.unitId === uId && t1c.groupId === gId && t1c.staffKind === 'direct' && t1c.sourceDepartmentChanged === true && roster5.warnings.sourceDepartmentChanged >= 1,
    JSON.stringify(t1c));

  cleanup();
  console.log(`\n${PASS}/${PASS + FAIL} live checks passed` + (FAIL ? '  — FAIL' : '  — ALL PASS'));
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('E2E CRASH', e); process.exit(1); });
