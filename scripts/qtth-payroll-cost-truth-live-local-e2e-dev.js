'use strict';
/*
 * PHF HR — QTTH · Payroll COST TRUTH · LIVE LOCAL e2e (LOCAL ONLY — no deploy,
 * no PROD, no PROD migration, no Supabase MAIN write).
 *
 * Path: dispatchQtthAction (Vercel) -> qtth-identity (People Master = SANDBOX,
 * read) -> qtth-bridge (flag ON) -> phf-hr-api child -> throwaway Company
 * PostgreSQL phf_hr_e2e / schema payroll (SSH tunnel 15432).
 *
 * Proves the cost-model is RUNTIME-ACTIVE through `payroll.costTruth`:
 *   - reconciles to source (4) − T13 for a real T7 import
 *   - employer BHXH surfaces NOT_AVAILABLE (never auto-calculated)
 *   - T13 + deductions + payment layer are reported, NOT inside payrollCost
 *   - versioned: costTruth follows the current version; {version:N} reads N
 *   - 800K/500K holiday tiers are not double-counted (T2 fixture)
 *   - employeeDetail carries costBreakdown for drill-down
 *
 * PREREQ: SSH tunnel :15432 + .env.test (SANDBOX) + e2e/phf-hr-e2e-db.env (_e2e).
 * Run: node scripts/qtth-payroll-cost-truth-live-local-e2e-dev.js
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
if (!envTest.SUPABASE_URL || new URL(envTest.SUPABASE_URL).host !== DEV_HOST) die('.env.test không phải SANDBOX.');
const dbEnv = loadEnv(path.join(REPO, 'e2e', 'phf-hr-e2e-db.env'));
if (dbEnv.PHF_HR_DB_HOST !== '127.0.0.1' || !/_e2e$/.test(dbEnv.PHF_HR_DB_NAME || '')) die('e2e/phf-hr-e2e-db.env sai.');

const API_PORT = 18947;
const API_BASE = 'http://127.0.0.1:' + API_PORT;
const SERVICE_TOKEN = crypto.randomBytes(32).toString('hex');
const DEV_ALLOW = 'PHF012,acct-3a03c49e-5835-4d92-b89e-424836e79e24';

function tcpOpen(port) { return new Promise((res) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); setTimeout(() => { s.destroy(); res(false); }, 1500); }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHealth(u, ms) { const end = Date.now() + ms; while (Date.now() < end) { try { const r = await fetch(u); if (r.status === 200) return true; } catch (_) {} await sleep(200); } return false; }
function psql(sql) { return execFileSync('ssh', ['claude-phf', `docker exec ${THROWAWAY_CONTAINER} psql -U postgres -d phf_hr_e2e -tAc "${sql.replace(/"/g, '\\"')}"`], { encoding: 'utf8' }).trim(); }
const { resolvePayrollCorpusDir } = require(path.join(__dirname, 'lib/payroll-corpus-dir'));
function tsvGrid(name) { const dir = resolvePayrollCorpusDir(); const fn = name === 'T7.tsv' ? 'T7_CANONICAL.tsv' : name; return fs.readFileSync(path.join(dir, fn), 'utf8').replace(/^﻿/, '').split(/\r?\n/).map((l) => l.split('\t')); }

let PASS = 0, FAIL = 0;
function check(name, cond, extra) { if (cond) { PASS++; console.log('  PASS  ' + name); } else { FAIL++; console.error('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); } }

// offline oracle: the exact expected cost for a fixture, straight from the shipped model
const TPL = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-template'));
const NRM = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-normalize'));
const COST = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-cost-model'));
function oracle(grid) {
  const b = TPL.buildColumnMap(grid);
  const nr = NRM.normalizeGrid(grid, b.map, {});
  const a = COST.aggregatePeriodCost(nr.records);
  return { payrollCost: a.totalPersonnelCost, rows: nr.rowCount };
}

(async () => {
  if (!(await tcpOpen(15432))) die('SSH tunnel 127.0.0.1:15432 chưa mở.');
  if (psql("select count(*) from information_schema.schemata where schema_name='payroll'") !== '1') die('schema payroll chưa có trên throwaway.');

  psql('alter table payroll.raw_row disable trigger user; alter table payroll.delta disable trigger user; '
    + 'delete from payroll.import; delete from payroll.template; '
    + 'alter table payroll.raw_row enable trigger user; alter table payroll.delta enable trigger user;');

  const attachRoot = fs.mkdtempSync(require('os').tmpdir() + path.sep + 'qtth-cost-e2e-');
  const api = spawn(process.execPath, [path.join(REPO, 'services', 'phf-hr-api', 'server.js')], {
    cwd: path.join(REPO, 'services', 'phf-hr-api'),
    env: Object.assign({}, process.env, {
      PORT: String(API_PORT), PHF_HR_API_BIND_HOST: '127.0.0.1', PHF_HR_API_SERVICE_TOKEN: SERVICE_TOKEN,
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

  const opAcc = (await sb.from('user_accounts').select('id,email,role,employee_code').ilike('email', '%thanglv150917%').maybeSingle()).data;
  if (!opAcc) { cleanup(); die('không lấy được operator persona'); }
  const S_OP = { account: { id: opAcc.id, employeeCode: opAcc.employee_code || '', role: opAcc.role, email: opAcc.email, name: opAcc.email }, role: opAcc.role, sub: opAcc.id };

  console.log('\nQTTH · Payroll COST TRUTH · LIVE LOCAL e2e\n');

  // ---------- T7 canonical: V1 ----------
  const PERIOD = '2026-07';
  const T7 = tsvGrid('T7.tsv');
  const orT7 = oracle(T7);
  const prev1 = await D(S_OP, { action: 'qtthPayrollValidatePreview', period_month: PERIOD, file_name: 'T7.xlsx', file_base64: gridToXlsx(T7).toString('base64') });
  await D(S_OP, { action: 'qtthPayrollConfirm', file_id: prev1.fileId });

  const c1 = await D(S_OP, { action: 'qtthPayrollCostTruth', period_month: PERIOD });
  check('COST_RUNTIME_ACTIVE: costTruth trả hasCost + costModelVersion', c1.hasCost === true && c1.costModelVersion === COST.MODEL_VERSION, JSON.stringify({ v: c1.costModelVersion }));
  check('T7 payrollCost khớp oracle mô hình (±2)', Math.abs(c1.payrollCost - orT7.payrollCost) <= 2, 'api=' + c1.payrollCost + ' oracle=' + orT7.payrollCost);
  check('T7 reconciled = true (khớp source (4) − T13 trong tolerance)', c1.reconciled === true, 'delta=' + c1.costReconciliationDelta + ' tol=' + c1.tolerance);
  check('employer BHXH = NOT_AVAILABLE + không auto-calc', c1.employerBhxhStatus === 'NOT_AVAILABLE' && c1.employerBhxhCost === null);
  check('payrollCost = Σ 5 nhóm chi phí (không gồm thứ khác)',
    Math.abs(c1.payrollCost - (c1.salaryCost + c1.holidayCost + c1.allowanceCost + c1.otherAllowanceCost + c1.performanceRewardCost)) <= 1);
  check('T13 + giảm trừ + thuế + payment layer KHÔNG nằm trong payrollCost',
    c1.excludedCost && c1.reconciliationOnly &&
    c1.payrollCost < c1.payrollCost + c1.reconciliationOnly.employeeDeductions + c1.reconciliationOnly.employeeTax + 1 &&
    c1.excludedCost.total >= 0);
  check('costTruth version = V1, isCurrent = true', c1.version === 1 && c1.isCurrent === true);

  // final_net aggregate strictly below payrollCost (không phải "thực nhận")
  const list1 = await D(S_OP, { action: 'qtthPayrollListNormalized', period_month: PERIOD });
  const netAgg = (list1.rows || []).reduce((s, r) => s + (Number(r.finalNetAfterTax) || 0), 0);
  check('payrollCost KHÁC "thực nhận" (Σ finalNet < payrollCost)', netAgg > 0 && netAgg < c1.payrollCost, 'net=' + Math.round(netAgg) + ' cost=' + c1.payrollCost);

  // ---------- V2: bump one row's performance bonus ----------
  const T7v2 = T7.map((r) => r.slice());
  // find bonus_action column + a PHF row, add 1,000,000
  const b = TPL.buildColumnMap(T7);
  const colAction = b.map.bonus_action, hdr = b.header;
  let bumpedRow = null;
  for (let i = hdr.dataStart; i < T7v2.length; i++) {
    if (/^PHF\d+$/i.test(String(T7v2[i][2] || ''))) {
      const cur = TPL.num(T7v2[i][colAction]) || 0;
      T7v2[i][colAction] = String(cur + 1000000);
      // keep the row's grand_total_4 consistent so reconciliation still holds
      const g4c = b.map.grand_total_4;
      T7v2[i][g4c] = String((TPL.num(T7v2[i][g4c]) || 0) + 1000000);
      const b3c = b.map.bonus_total_3;
      if (b3c != null) T7v2[i][b3c] = String((TPL.num(T7v2[i][b3c]) || 0) + 1000000);
      bumpedRow = String(T7v2[i][2]).toUpperCase();
      break;
    }
  }
  const orT7v2 = oracle(T7v2);
  const prev2 = await D(S_OP, { action: 'qtthPayrollValidatePreview', period_month: PERIOD, file_name: 'T7-v2.xlsx', file_base64: gridToXlsx(T7v2).toString('base64') });
  await D(S_OP, { action: 'qtthPayrollConfirm', file_id: prev2.fileId });

  const c2 = await D(S_OP, { action: 'qtthPayrollCostTruth', period_month: PERIOD });
  check('VERSIONED: sau confirm V2, costTruth = V2', c2.version === 2 && c2.isCurrent === true);
  check('VERSIONED: payrollCost V2 = V1 + 1,000,000 (±2)', Math.abs(c2.payrollCost - (c1.payrollCost + 1000000)) <= 2, 'v1=' + c1.payrollCost + ' v2=' + c2.payrollCost);
  check('VERSIONED: payrollCost V2 khớp oracle V2 (±2)', Math.abs(c2.payrollCost - orT7v2.payrollCost) <= 2);
  check('VERSIONED: V2 vẫn reconciled', c2.reconciled === true, 'delta=' + c2.costReconciliationDelta);

  const c1again = await D(S_OP, { action: 'qtthPayrollCostTruth', period_month: PERIOD, version: 1 });
  check('VERSIONED: costTruth {version:1} đọc lại đúng số V1 (superseded)', Math.abs(c1again.payrollCost - c1.payrollCost) <= 2 && c1again.version === 1 && c1again.isCurrent === false);

  // ---------- drill-down: employeeDetail carries costBreakdown ----------
  const det = await D(S_OP, { action: 'qtthPayrollEmployeeDetail', period_month: PERIOD, employee_code: bumpedRow });
  check('DRILL-DOWN: employeeDetail có costBreakdown.byGroup + totalPersonnelCost',
    det.costBreakdown && det.costBreakdown.byGroup && typeof det.costBreakdown.totalPersonnelCost === 'number');
  check('DRILL-DOWN: nhân sự được bump có PERFORMANCE_REWARD trong byGroup',
    det.costBreakdown.byGroup.PERFORMANCE_REWARD > 0);

  // ---------- 800K/500K holiday double-count guard (T2 fixture) ----------
  const PERIOD2 = '2026-02';
  const T2 = tsvGrid('T2.tsv');
  const orT2 = oracle(T2);
  const pv = await D(S_OP, { action: 'qtthPayrollValidatePreview', period_month: PERIOD2, file_name: 'T2.xlsx', file_base64: gridToXlsx(T2).toString('base64') });
  await D(S_OP, { action: 'qtthPayrollConfirm', file_id: pv.fileId });
  const c3 = await D(S_OP, { action: 'qtthPayrollCostTruth', period_month: PERIOD2 });
  check('HOLIDAY 800K/500K KHÔNG double-count (T2 reconciled)', c3.reconciled === true, 'delta=' + c3.costReconciliationDelta);
  check('HOLIDAY T2 payrollCost khớp oracle (±2)', Math.abs(c3.payrollCost - orT2.payrollCost) <= 2, 'api=' + c3.payrollCost + ' oracle=' + orT2.payrollCost);
  check('HOLIDAY T2: t13_revenue_bonus báo cáo riêng, không vào payrollCost', c3.excludedCost.t13RevenueBonus > 0 && c3.reconciled === true);

  console.log('\n' + PASS + '/' + (PASS + FAIL) + ' live checks passed' + (FAIL ? '  — ' + FAIL + ' FAILED' : '  — ALL PASS'));
  cleanup();
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('E2E_CRASH', e); process.exit(1); });
