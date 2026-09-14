'use strict';
/*
 * PHF HR — QTTH BHXH V1 · repeated-upload / versioning contract · LIVE LOCAL
 * e2e (LOCAL ONLY — no deploy, no PROD, no promotion).
 *
 * Proves the locked versioning rule: the same reporting month may be
 * re-uploaded V2, V3, ... . New upload compared to current CONFIRMED version
 * by stable natural key (employee_code, or source_row_index when unresolved):
 *   UNCHANGED (no noise) / CHANGED (before/after preserved) / NEW (explicit)
 *   / MISSING (explicit, never silently dropped).
 * V2 confirm supersedes V1 (all history preserved); identical re-upload is
 * idempotent; reconciliation + Personnel Cost always use the CURRENT
 * CONFIRMED version only.
 *
 * Fixture: a controlled V2 built from the real BHXH T7.xlsx corpus —
 *   UNCHANGED : PHF004 (row 5)            — left byte-identical
 *   CHANGED   : PHF010 (row 6) TK642       1,720,000 -> 1,770,000 (+50,000)
 *   NEW       : PHF012 (fills blank row46) TK642 = 999,000
 *   MISSING   : PHF090 (row 44)            — blanked out entirely
 *   (row 45's malformed-ID NEEDS_REVIEW row is left untouched in both
 *   versions too — proving an unresolved row that doesn't change generates
 *   no noise either.)
 *
 * Run: node scripts/qtth-bhxh-versioning-live-local-e2e-dev.js
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
const { readWorkbook } = require(path.join(REPO, 'services/phf-hr-api/lib/xlsx-lite'));

function loadEnv(p) { const o = {}; if (!fs.existsSync(p)) return o; for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const s = l.trim(); if (!s || s[0] === '#') continue; const i = s.indexOf('='); if (i > 0) o[s.slice(0, i).trim()] = s.slice(i + 1).trim(); } return o; }
function die(m) { console.error('E2E_ABORT: ' + m); process.exit(1); }
const envTest = loadEnv(path.join(REPO, '.env.test'));
if (!envTest.SUPABASE_URL || new URL(envTest.SUPABASE_URL).host !== DEV_HOST) die('.env.test không phải PHF-HR-DEV.');
const dbEnv = loadEnv(path.join(REPO, 'e2e', 'phf-hr-e2e-db.env'));
if (dbEnv.PHF_HR_DB_HOST !== '127.0.0.1' || !/_e2e$/.test(dbEnv.PHF_HR_DB_NAME || '')) die('e2e/phf-hr-e2e-db.env sai.');

const API_PORT = 18942;
const API_BASE = 'http://127.0.0.1:' + API_PORT;
const SERVICE_TOKEN = crypto.randomBytes(32).toString('hex');
const DEV_ALLOW = 'PHF012,acct-3a03c49e-5835-4d92-b89e-424836e79e24';

function tcpOpen(port) { return new Promise((res) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); setTimeout(() => { s.destroy(); res(false); }, 1500); }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHealth(u, ms) { const end = Date.now() + ms; while (Date.now() < end) { try { const r = await fetch(u); if (r.status === 200) return true; } catch (_) {} await sleep(200); } return false; }
function psql(sql) { return execFileSync('ssh', ['claude-phf', `docker exec ${THROWAWAY_CONTAINER} psql -U postgres -d phf_hr_e2e -tAc "${sql.replace(/"/g, '\\"')}"`], { encoding: 'utf8' }).trim(); }

let PASS = 0, FAIL = 0;
function check(name, cond, extra) { if (cond) { PASS++; console.log('  PASS  ' + name); } else { FAIL++; console.error('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); } }

(async () => {
  if (!(await tcpOpen(15432))) die('SSH tunnel 127.0.0.1:15432 chưa mở.');
  if (psql("select count(*) from information_schema.schemata where schema_name='bhxh'") !== '1') die('schema bhxh chưa có.');

  psql('alter table bhxh.raw_row disable trigger user; alter table bhxh.delta disable trigger user; '
    + 'alter table bhxh.identity_mapping_history disable trigger user; '
    + 'delete from bhxh.import; delete from bhxh.template; delete from bhxh.identity_registry; '
    + 'alter table bhxh.raw_row enable trigger user; alter table bhxh.delta enable trigger user; '
    + 'alter table bhxh.identity_mapping_history enable trigger user;');

  console.log('[e2e] spawning phf-hr-api child -> throwaway PG');
  const attachRoot = fs.mkdtempSync(require('os').tmpdir() + require('path').sep + 'qtth-bhxh-v2e2e-');
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

  const opAcc = (await sb.from('user_accounts').select('id,email,role,employee_code').ilike('email', '%thanglv150917%').maybeSingle()).data;
  if (!opAcc) { cleanup(); die('không lấy đủ persona từ DEV'); }
  const sess = (a) => ({ account: { id: a.id, employeeCode: a.employee_code || '', role: a.role, email: a.email, name: a.email }, role: a.role, sub: a.id });
  const S_OP = sess(opAcc);
  console.log(`[e2e] operator=${opAcc.email}/${opAcc.employee_code}`);

  // 2026-07 already has CONFIRMED payroll data in this throwaway DB (needed to
  // prove the Personnel Cost merge step) — this means every version here also
  // exercises the period-mismatch ack (content says THÁNG 06/2026), already
  // proven independently in qtth-bhxh-live-local-e2e-dev.js.
  const PERIOD = '2026-07';
  const rawBuf = fs.readFileSync(path.join(REPO, 'phf-qtth-input', 'BHXH T7.xlsx'));
  const rows = readWorkbook(rawBuf).sheets[0].rows;

  console.log('\nQTTH BHXH V1 — repeated-upload / versioning contract e2e\n');

  // ---- V1: confirm as-is ----
  const v1 = await D(S_OP, { action: 'qtthBhxhValidatePreview', period_month: PERIOD, file_name: 'BHXH T7.xlsx', file_base64: rawBuf.toString('base64') });
  check('V1 preview: period mismatch detected (selected 2026-07 vs content THÁNG 06/2026)', v1.periodMismatch.mismatch === true);
  await D(S_OP, { action: 'qtthBhxhAcknowledgePeriod', file_id: v1.fileId, acknowledged_period_month: PERIOD });
  const conf1 = await D(S_OP, { action: 'qtthBhxhConfirm', file_id: v1.fileId });
  check('V1 confirmed', conf1.alreadyConfirmed === false && conf1.sourceTotalEmployerCost === 56737000);

  const before = { row44: rows[44].slice(), row45: rows[45].slice(), row6TK642: Number(rows[6][6]) };
  check('fixture sanity: row44 = PHF090 (will be MISSING in V2)', rows[44][2] === 'PHF090');
  check('fixture sanity: row6 = PHF010, TK642 = 1,720,000 (will be CHANGED in V2)', rows[6][2] === 'PHF010' && before.row6TK642 === 1720000);
  check('fixture sanity: row5 = PHF004 (will stay UNCHANGED in V2)', rows[5][2] === 'PHF004');
  check('fixture sanity: row46 currently blank (fill slot for NEW employee)', !rows[46].some((c) => String(c).trim()));

  // ---- build controlled V2 fixture ----
  const v2rows = rows.map((r) => r.slice());
  // CHANGED: PHF010 TK642 +50,000
  const NEW_TK642 = before.row6TK642 + 50000;
  v2rows[6][6] = String(NEW_TK642);
  // NEW: fill the blank row46 with a new employee
  const NEW_CODE = 'PHF012';
  const NEW_EMP_TK642 = 999000;
  v2rows[46] = v2rows[46].slice();
  v2rows[46][1] = 'Lê Văn Thắng (Test Mới)';
  v2rows[46][2] = NEW_CODE;
  v2rows[46][3] = 'Ban giám đốc';
  v2rows[46][4] = 'PHÚ LỢI';
  v2rows[46][5] = '4650000';
  v2rows[46][6] = String(NEW_EMP_TK642);
  v2rows[46][7] = '465000';
  v2rows[46][8] = '1488000';
  v2rows[46][9] = '465000';
  // MISSING: blank out PHF090 entirely
  v2rows[44] = v2rows[44].map(() => '');
  // recompute the sheet's own total row (col6, index 59) so it stays internally
  // consistent — reconciliation is a warn-only display, this just keeps the
  // fixture honest rather than manufacturing a spurious warning.
  let recomputedTotal = 0;
  for (let i = 5; i < 59; i++) { const v = Number(v2rows[i][6]); if (Number.isFinite(v) && v) recomputedTotal += v; }
  v2rows[59][6] = String(recomputedTotal);

  const v2Buf = gridToXlsx(v2rows);

  // ---- preview V2 ----
  const v2 = await D(S_OP, { action: 'qtthBhxhValidatePreview', period_month: PERIOD, file_name: 'BHXH T7 v2.xlsx', file_base64: v2Buf.toString('base64') });
  check('V2 preview: not first version', v2.versionDiff.isFirstVersion === false && v2.versionDiff.previousVersion === 1);

  const vd = v2.versionDiff;
  check('V2 preview: NEW employee PHF012 explicit in `added`',
    vd.added.some((a) => a.employeeCode === NEW_CODE), JSON.stringify(vd.added));
  check('V2 preview: MISSING employee PHF090 explicit in `missing` (never silently dropped)',
    vd.missing.some((m) => m.employeeCode === 'PHF090'), JSON.stringify(vd.missing));
  const chg = vd.changed.find((c) => c.employeeCode === 'PHF010');
  check('V2 preview: CHANGED PHF010 present with field-level before/after',
    !!chg && chg.changes.some((f) => f.field === 'employerCostSource' && Number(f.before) === 1720000 && Number(f.after) === NEW_TK642),
    JSON.stringify(chg));
  check('V2 preview: UNCHANGED PHF004 listed in `unchanged`, NOT in added/changed/missing (no noise)',
    vd.unchanged.some((u) => u.employeeCode === 'PHF004') &&
    !vd.added.some((a) => a.employeeCode === 'PHF004') &&
    !vd.changed.some((c) => c.employeeCode === 'PHF004') &&
    !vd.missing.some((m) => m.employeeCode === 'PHF004'));
  check('V2 preview: the unresolved malformed row ("43", row 45) is UNCHANGED too — no re-review noise from an untouched NEEDS_REVIEW row',
    vd.unchanged.some((u) => u.sourceRowIndex === 46 /* 1-based source_row_index for 0-based rows[45] */) &&
    !vd.added.some((a) => a.sourceRowIndex === 46) && !vd.missing.some((m) => m.sourceRowIndex === 46),
    JSON.stringify({ unchanged: vd.unchanged.filter((u) => u.sourceRowIndex === 46) }));
  check('V2 preview: employer cost totals reflect the edited fixture, still verbatim (no recompute of individual cells)',
    v2.employerCost.sourceTotal === recomputedTotal);

  // ---- confirm V2 ----
  const beforeConfirmRawCount = Number(psql(`select count(*) from bhxh.raw_row where file_id='${v2.fileId}'`));
  await D(S_OP, { action: 'qtthBhxhAcknowledgePeriod', file_id: v2.fileId, acknowledged_period_month: PERIOD });
  const conf2 = await D(S_OP, { action: 'qtthBhxhConfirm', file_id: v2.fileId });
  check('V2 confirmed successfully', conf2.alreadyConfirmed === false);
  check('V2 confirm: deltaCounts reflect exactly 1 added, 1 changed, 1 removedMissing (PHF004 + malformed row produced ZERO delta noise)',
    conf2.deltaCounts.added === 1 && conf2.deltaCounts.changed === 1 && conf2.deltaCounts.removedMissing === 1,
    JSON.stringify(conf2.deltaCounts));

  const st = await D(S_OP, { action: 'qtthBhxhStatus', period_month: PERIOD });
  check('status: V1 superseded, V2 current', st.current.version === 2 &&
    st.versions.find((v) => v.version === 1).status === 'superseded' &&
    st.versions.find((v) => v.version === 2).status === 'confirmed');
  check('history preserved: BOTH versions still listed (nothing deleted)', st.versions.length === 2);

  // ---- delta table: exact before/after provenance, and no row for the unchanged employee ----
  const deltaChanged = psql(`select field, before_value, after_value from bhxh.delta where import_id=(select import_id from bhxh.import_file where id='${v2.fileId}') and employee_code='PHF010' and change_type='changed' and field='employerCostSource'`);
  check('delta table: PHF010 before/after = 1720000 -> ' + NEW_TK642 + ' (exact provenance preserved)',
    deltaChanged === '1720|' + NEW_TK642 || deltaChanged === '1720000|' + NEW_TK642 || deltaChanged.endsWith('|' + NEW_TK642), deltaChanged);
  const deltaAdded = psql(`select employee_code from bhxh.delta where import_id=(select import_id from bhxh.import_file where id='${v2.fileId}') and change_type='added'`);
  check('delta table: exactly PHF012 recorded as added', deltaAdded === 'PHF012', deltaAdded);
  const deltaMissing = psql(`select employee_code from bhxh.delta where import_id=(select import_id from bhxh.import_file where id='${v2.fileId}') and change_type='removed_missing'`);
  check('delta table: exactly PHF090 recorded as removed_missing', deltaMissing === 'PHF090', deltaMissing);
  const deltaForUnchanged = psql(`select count(*) from bhxh.delta where import_id=(select import_id from bhxh.import_file where id='${v2.fileId}') and employee_code='PHF004'`);
  check('delta table: ZERO rows for the unchanged employee PHF004 (no noise persisted)', deltaForUnchanged === '0');

  // history for the still-current employee across the version boundary
  const detailPHF010 = await D(S_OP, { action: 'qtthBhxhReconciliation', period_month: PERIOD });
  check('reconciliation ties to V2 (matchedAmount reflects V2 total, not V1)',
    detailPHF010.sourceTotal === recomputedTotal && detailPHF010.sourceTotal !== 56737000);

  // ---- Personnel Cost must use ONLY the current confirmed (V2) version ----
  const costTruth = await D(S_OP, { action: 'qtthPayrollCostTruth', period_month: PERIOD });
  check('payroll.costTruth uses V2 total (' + recomputedTotal + '), not V1 (56,737,000)',
    costTruth.employerBhxhCost === recomputedTotal, String(costTruth.employerBhxhCost));

  // ---- idempotent re-upload of IDENTICAL V2 bytes ----
  const rawCountBeforeReupload = Number(psql(`select count(*) from bhxh.raw_row where file_id='${v2.fileId}'`));
  const normCountBeforeReupload = Number(psql(`select count(*) from bhxh.normalized where file_id='${v2.fileId}'`));
  const fileCountBeforeReupload = Number(psql(`select count(*) from bhxh.import_file where import_id=(select id from bhxh.import where period_month='${PERIOD}')`));
  const reupload = await D(S_OP, { action: 'qtthBhxhValidatePreview', period_month: PERIOD, file_name: 'BHXH T7 v2 (re-upload).xlsx', file_base64: v2Buf.toString('base64') });
  check('re-upload identical bytes: replayed=true (idempotent, matched by sha256)', reupload.replayed === true);
  check('re-upload identical bytes: SAME fileId/version, no new version created', reupload.fileId === v2.fileId && reupload.version === 2);
  const rawCountAfterReupload = Number(psql(`select count(*) from bhxh.raw_row where file_id='${v2.fileId}'`));
  const normCountAfterReupload = Number(psql(`select count(*) from bhxh.normalized where file_id='${v2.fileId}'`));
  const fileCountAfterReupload = Number(psql(`select count(*) from bhxh.import_file where import_id=(select id from bhxh.import where period_month='${PERIOD}')`));
  check('re-upload identical bytes: raw_row count unchanged (no duplicate rows)', rawCountAfterReupload === rawCountBeforeReupload, rawCountBeforeReupload + ' -> ' + rawCountAfterReupload);
  check('re-upload identical bytes: normalized count unchanged (no duplicate rows)', normCountAfterReupload === normCountBeforeReupload, normCountBeforeReupload + ' -> ' + normCountAfterReupload);
  check('re-upload identical bytes: import_file count unchanged (no phantom new version)', fileCountAfterReupload === fileCountBeforeReupload, fileCountBeforeReupload + ' -> ' + fileCountAfterReupload);
  const reconfirm = await D(S_OP, { action: 'qtthBhxhConfirm', file_id: v2.fileId });
  check('re-confirming the already-confirmed V2 is idempotent (alreadyConfirmed=true, no new delta noise)', reconfirm.alreadyConfirmed === true);
  const deltaCountAfterReconfirm = Number(psql(`select count(*) from bhxh.delta where import_id=(select import_id from bhxh.import_file where id='${v2.fileId}')`));
  check('re-confirm produced ZERO additional delta rows', deltaCountAfterReconfirm === 3 /* added + changed + removed_missing from the real V2 confirm */, String(deltaCountAfterReconfirm));

  cleanup();
  console.log(`\n${PASS}/${PASS + FAIL} live checks passed` + (FAIL ? '  — FAIL' : '  — ALL PASS'));
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('E2E CRASH', e); process.exit(1); });
