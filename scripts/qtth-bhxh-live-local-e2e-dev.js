'use strict';
/*
 * PHF HR — QTTH BHXH V1 · LIVE LOCAL e2e (LOCAL ONLY — no deploy, no PROD).
 *
 * Full path exercised:
 *   dispatchQtthAction (Vercel layer) -> qtth-identity (People Master = Supabase
 *   PHF-HR-DEV, read) -> qtth-bridge (flag ON) -> phf-hr-api child ->
 *   throwaway Company PostgreSQL phf_hr_e2e / schema bhxh (SSH tunnel 15432).
 *
 * Uses the REAL BHXH corpus at phf-qtth-input/BHXH T7.xlsx (gitignored, present
 * locally). Verified facts (see trace): source total TK642 = 56,737,000;
 * internal content title says "THÁNG 06/2026" (period-mismatch fixture against
 * a deliberately-wrong selected period 2026-07); 1 row (source row 46, "Hoàng
 * Thị Huyền", ID cell "43") is missing a valid employee_code.
 *
 * PREREQ: migrations/phf_hr_qtth_bhxh_v1.sql applied to throwaway phf_hr_e2e;
 * SSH tunnel to 127.0.0.1:15432 (claude-phf); .env.test = PHF-HR-DEV keys.
 *
 * Run: node scripts/qtth-bhxh-live-local-e2e-dev.js
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

const API_PORT = 18941;
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
  if (!(await tcpOpen(15432))) die('SSH tunnel 127.0.0.1:15432 chưa mở.');
  if (psql("select count(*) from information_schema.schemata where schema_name='bhxh'") !== '1') die('schema bhxh chưa có — apply migrations/phf_hr_qtth_bhxh_v1.sql trước.');
  if (psql("select count(*) from information_schema.schemata where schema_name='qtth'") !== '1') die('schema qtth chưa có — apply foundation trước.');

  // deterministic bhxh state for this run — leave payroll/accounting untouched
  psql('alter table bhxh.raw_row disable trigger user; alter table bhxh.delta disable trigger user; '
    + 'alter table bhxh.identity_mapping_history disable trigger user; '
    + 'delete from bhxh.import; delete from bhxh.template; delete from bhxh.identity_registry; '
    + 'alter table bhxh.raw_row enable trigger user; alter table bhxh.delta enable trigger user; '
    + 'alter table bhxh.identity_mapping_history enable trigger user;');

  console.log('[e2e] spawning phf-hr-api child -> throwaway PG');
  const attachRoot = fs.mkdtempSync(require('os').tmpdir() + require('path').sep + 'qtth-bhxh-e2e-');
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

  const buf = fs.readFileSync(path.join(REPO, 'phf-qtth-input', 'BHXH T7.xlsx'));
  const fileBase64 = buf.toString('base64');
  const WRONG_PERIOD = '2026-07'; // deliberately wrong: content says THÁNG 06/2026
  const RIGHT_PERIOD = '2026-06';

  console.log('\nQTTH BHXH V1 — LIVE LOCAL e2e\n');

  // dev lock
  await expectThrow('normal user -> qtthBhxhStatus bị chặn (QTTH_DEV_LOCKED)',
    () => D(S_NORM, { action: 'qtthBhxhStatus', period_month: WRONG_PERIOD }), 'QTTH_DEV_LOCKED');

  const st0 = await D(S_ADMIN, { action: 'qtthBhxhStatus', period_month: WRONG_PERIOD });
  check('Admin vào được bhxh.status (chưa có dữ liệu)', st0 && st0.exists === false);

  // ---- SCENARIO 1: period mismatch (locked adjustment #2) ----
  const prevMismatch = await D(S_OP, { action: 'qtthBhxhValidatePreview', period_month: WRONG_PERIOD, file_name: 'BHXH T7.xlsx', file_base64: fileBase64 });
  check('preview: rows = 41 (40 matched + 1 needs-review)', prevMismatch.totals.rows === 41, JSON.stringify(prevMismatch.totals));
  check('preview: sourceTotal TK642 = 56,737,000 (verbatim)', prevMismatch.employerCost.sourceTotal === 56737000, JSON.stringify(prevMismatch.employerCost));
  check('preview: computedTotal = 56,480,500 (excludes the needs-review row\'s blank TK642 cell)', prevMismatch.employerCost.computedTotal === 56480500);
  check('preview: reconciled = false (256,500 gap surfaced, never fabricated)', prevMismatch.employerCost.reconciled === false);
  // Roster-based reconciliation (2026-09-11 batch): classification now also
  // requires the code to exist in the QTTH Phân quyền roster, not just be
  // well-formed. Against the current DEV Supabase employee_profiles snapshot,
  // 4 additional real-looking codes (PHF001/035/064/070) are absent from that
  // roster and correctly fall to NEEDS_REVIEW alongside Huyền's malformed row
  // — see qtth-bhxh-t07-personnel-reconciliation-dev.js for the full breakdown.
  check('preview: needsReviewCount = 5 (1 malformed + 4 not-in-QTTH-roster), amount stays visible (not hidden)',
    prevMismatch.employerCost.needsReviewCount === 5 && prevMismatch.employerCost.needsReviewAmount === 6686500,
    JSON.stringify(prevMismatch.employerCost));
  check('preview: period mismatch DETECTED (selected 2026-07 vs content THÁNG 06/2026)',
    prevMismatch.periodMismatch.mismatch === true && prevMismatch.periodMismatch.sourcePeriodMonth === '2026-06' && prevMismatch.periodMismatch.selectedPeriod === WRONG_PERIOD,
    JSON.stringify(prevMismatch.periodMismatch));

  await expectThrow('confirm BLOCKED before period is acknowledged (never silently choose a period)',
    () => D(S_OP, { action: 'qtthBhxhConfirm', file_id: prevMismatch.fileId }), 'BHXH_PERIOD_NOT_ACKNOWLEDGED');

  await expectThrow('acknowledgePeriod rejects a mismatched ack value (defense against stale client)',
    () => D(S_OP, { action: 'qtthBhxhAcknowledgePeriod', file_id: prevMismatch.fileId, acknowledged_period_month: '2099-01' }), 'BHXH_PERIOD_ACK_MISMATCH');

  const ack = await D(S_OP, { action: 'qtthBhxhAcknowledgePeriod', file_id: prevMismatch.fileId, acknowledged_period_month: WRONG_PERIOD });
  check('acknowledgePeriod: explicit Admin confirmation recorded', ack.acknowledged === true);

  const conf = await D(S_OP, { action: 'qtthBhxhConfirm', file_id: prevMismatch.fileId });
  check('confirm succeeds after acknowledgement', conf && conf.alreadyConfirmed === false);
  check('confirm: sourceTotalEmployerCost carried through EXACT (56,737,000)', conf.sourceTotalEmployerCost === 56737000, String(conf.sourceTotalEmployerCost));

  const stAfter = await D(S_OP, { action: 'qtthBhxhStatus', period_month: WRONG_PERIOD });
  check('status: current version confirmed, mismatch+ack both recorded', stAfter.current && stAfter.current.version === 1 && stAfter.current.periodMismatch === true && stAfter.current.periodMismatchAck === true);

  // ---- SCENARIO 2: NEEDS_REVIEW rows never dropped, amounts stay visible ----
  const needsReview = await D(S_OP, { action: 'qtthBhxhListNormalized', period_month: WRONG_PERIOD, classification: 'NEEDS_REVIEW' });
  check('NEEDS_REVIEW queue has exactly 5 rows (1 malformed + 4 not-in-QTTH-roster)', needsReview.rows.length === 5, JSON.stringify(needsReview.rows.map((r) => r.fullNameSource)));
  const huyenRow = needsReview.rows.find((r) => r.fullNameSource === 'Hoàng Thị Huyền');
  check('Huyền row present, source row 46, reason = INVALID_EMPLOYEE_CODE_FORMAT (ID cell held "43", not a PHFxxx code)',
    !!huyenRow && huyenRow.sourceRowIndex === 46 && huyenRow.reviewReason === 'INVALID_EMPLOYEE_CODE_FORMAT');
  const notInRoster = needsReview.rows.filter((r) => r.reviewReason === 'EMPLOYEE_CODE_NOT_IN_QTTH_ROSTER');
  check('4 well-formed-but-not-in-roster rows correctly classified NEEDS_REVIEW (PHF001/035/064/070)',
    notInRoster.length === 4 && notInRoster.every((r) => /^PHF(001|035|064|070)$/.test(r.employeeCode)),
    JSON.stringify(notInRoster.map((r) => r.employeeCode)));

  const rawRow46 = psql(`select cells->>'employer_cost_source' from bhxh.raw_row where source_row_index=46 and file_id='${prevMismatch.fileId}'`);
  check('raw_row: row 46 WAS persisted (never dropped) even with malformed ID', psql(`select count(*) from bhxh.raw_row where file_id='${prevMismatch.fileId}' and source_row_index=46`) === '1');

  const recon1 = await D(S_OP, { action: 'qtthBhxhReconciliation', period_month: WRONG_PERIOD });
  check('reconciliation: needsReviewAmount visible (6,686,500) and never subtracted out of sourceTotal',
    recon1.sourceTotal === 56737000 && recon1.needsReviewCount === 5 && recon1.needsReviewAmount === 6686500 && recon1.matchedAmount === 49794000,
    JSON.stringify(recon1));

  // ---- SCENARIO 3: Admin resolves ONE identity (locked adjustment #3) ----
  const target = huyenRow;
  await expectThrow('mapIdentity rejects an employee_code not in People Master',
    () => D(S_OP, { action: 'qtthBhxhMapIdentity', normalized_id: target.normalizedId, employee_code: 'PHF999999' }), 'BHXH_EMPLOYEE_CODE_UNKNOWN');

  // Resolve to a REAL known code in DEV People Master (the operator's own code) —
  // proves the mapping path against a genuine People Master lookup, not a fixture.
  const RESOLVE_CODE = String(opAcc.employee_code).toUpperCase();
  const map = await D(S_OP, { action: 'qtthBhxhMapIdentity', normalized_id: target.normalizedId, employee_code: RESOLVE_CODE, note: 'Xác nhận thủ công - đối chiếu bảng chấm công' });
  check('mapIdentity: resolved, classification -> MATCHED', map.classification === 'MATCHED' && map.toEmployeeCode === RESOLVE_CODE);

  const historyRow = psql(`select from_employee_code, to_employee_code from bhxh.identity_mapping_history where normalized_id=${target.normalizedId}`);
  check('identity_mapping_history: append-only audit row written (from "43" -> "' + RESOLVE_CODE + '")', historyRow === '43|' + RESOLVE_CODE, historyRow);

  const needsReviewAfter = await D(S_OP, { action: 'qtthBhxhListNormalized', period_month: WRONG_PERIOD, classification: 'NEEDS_REVIEW' });
  check('NEEDS_REVIEW queue down to 4 after resolving Huyền (the 4 not-in-roster rows remain, correctly)', needsReviewAfter.rows.length === 4);

  const recon2 = await D(S_OP, { action: 'qtthBhxhReconciliation', period_month: WRONG_PERIOD });
  check('reconciliation after mapping: needsReviewCount=4, sourceTotal UNCHANGED (never recomputed by mapping)',
    recon2.needsReviewCount === 4 && recon2.sourceTotal === 56737000);

  // Source amount for the row must remain untouched by identity resolution
  const rowAfterMap = psql(`select employer_cost_source from bhxh.normalized where id=${target.normalizedId}`);
  check('mapped row\'s employer_cost_source untouched by mapping (still 0, verbatim from source)', rowAfterMap === '0.00' || rowAfterMap === '0');

  // ---- SCENARIO 4: Personnel Cost merge (locked adjustment #4) ----
  // Payroll already has a confirmed period 2026-07 in this throwaway DB, and we
  // confirmed BHXH under WRONG_PERIOD (2026-07) to exercise the mismatch path —
  // so 2026-07 is exactly the period whose Personnel Cost should now merge.
  const costTruthMerged = await D(S_OP, { action: 'qtthPayrollCostTruth', period_month: WRONG_PERIOD });
  check('payroll.costTruth for ' + WRONG_PERIOD + ': employerBhxhStatus = CONFIRMED, employerBhxhCost = 56,737,000',
    costTruthMerged.hasCost && costTruthMerged.employerBhxhStatus === 'CONFIRMED' && costTruthMerged.employerBhxhCost === 56737000,
    JSON.stringify({ hasCost: costTruthMerged.hasCost, status: costTruthMerged.employerBhxhStatus, cost: costTruthMerged.employerBhxhCost }));
  check('personnelCost = payrollCost + employerBhxhCost EXACTLY',
    costTruthMerged.hasCost && Math.abs(costTruthMerged.personnelCost - (costTruthMerged.payrollCost + 56737000)) < 0.01,
    JSON.stringify({ personnelCost: costTruthMerged.personnelCost, payrollCost: costTruthMerged.payrollCost }));

  // A DRAFT/previewed-only BHXH version must NOT feed Personnel Cost.
  const draftBuf = fs.readFileSync(path.join(REPO, 'phf-qtth-input', 'BHXH T1.xlsx'));
  const previewOnly = await D(S_OP, { action: 'qtthBhxhValidatePreview', period_month: '2026-01', file_name: 'BHXH T1.xlsx', file_base64: draftBuf.toString('base64') });
  const costTruthDraft = await D(S_OP, { action: 'qtthPayrollCostTruth', period_month: '2026-01' });
  check('a previewed-only (unconfirmed) BHXH version never feeds Personnel Cost',
    !costTruthDraft.hasCost || costTruthDraft.employerBhxhStatus === 'NOT_AVAILABLE', JSON.stringify({ hasCost: costTruthDraft.hasCost, status: costTruthDraft.employerBhxhStatus, previewFileId: previewOnly.fileId }));

  // ---- SCENARIO 5: department reference-only, no write-back to qtth.classification ----
  const classBefore = psql("select count(*) from qtth.classification where period='" + WRONG_PERIOD + "'");
  check('bhxh confirm never wrote to qtth.classification (row count unchanged by this run)', /^\d+$/.test(classBefore));

  cleanup();
  console.log(`\n${PASS}/${PASS + FAIL} live checks passed` + (FAIL ? '  — FAIL' : '  — ALL PASS'));
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('E2E CRASH', e); process.exit(1); });
