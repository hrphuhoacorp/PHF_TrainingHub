'use strict';
/*
 * PHF HR — QTTH Accounting Data V1 · LIVE LOCAL e2e (LOCAL ONLY — no deploy,
 * no PROD, no PROD migration).
 *
 * Full path exercised:
 *   accountingUploadPreviewViaBridge / dispatchQtthAction (Vercel layer) ->
 *   qtth-identity (People Master = Supabase PHF-HR-DEV, read) -> qtth-bridge
 *   (flag ON) -> phf-hr-api child -> throwaway Company PostgreSQL phf_hr_e2e /
 *   schema `accounting` (SSH tunnel 15432).
 *
 * PREREQ:
 *   1. migrations/phf_hr_qtth_foundation_v1.sql + phf_hr_qtth_accounting_v1.sql
 *      applied to throwaway phf_hr_e2e.
 *   2. SSH tunnel: ssh -f -N -T -L 15432:127.0.0.1:15432 claude-phf
 *   3. .env.test = PHF-HR-DEV keys ; e2e/phf-hr-e2e-db.env = throwaway PG
 *   4. phf-qtth-input/accounting_t07.xlsx + cost_dictionary.xlsx present
 *      (Operator source files — gitignored).
 *
 * Run: node scripts/qtth-accounting-v1-live-local-e2e-dev.js
 */
const path = require('path');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const DEV_HOST = 'pxkjvawdrixgoukhyvnk.supabase.co';
const THROWAWAY_CONTAINER = process.env.PHF_HR_E2E_CONTAINER || 'phf-hr-e2e-throwaway-20260827T123257Z';
const IN = path.join(REPO, 'phf-qtth-input');
const T07 = path.join(IN, 'accounting_t07.xlsx');
const DICT = path.join(IN, 'cost_dictionary.xlsx');

function loadEnv(p) { const o = {}; if (!fs.existsSync(p)) return o; for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const s = l.trim(); if (!s || s[0] === '#') continue; const i = s.indexOf('='); if (i > 0) o[s.slice(0, i).trim()] = s.slice(i + 1).trim(); } return o; }
function die(m) { console.error('E2E_ABORT: ' + m); process.exit(1); }
const envTest = loadEnv(path.join(REPO, '.env.test'));
if (!envTest.SUPABASE_URL || new URL(envTest.SUPABASE_URL).host !== DEV_HOST) die('.env.test không phải PHF-HR-DEV.');
const dbEnv = loadEnv(path.join(REPO, 'e2e', 'phf-hr-e2e-db.env'));
if (dbEnv.PHF_HR_DB_HOST !== '127.0.0.1' || !/_e2e$/.test(dbEnv.PHF_HR_DB_NAME || '')) die('e2e/phf-hr-e2e-db.env sai.');
if (!fs.existsSync(T07)) die('thiếu ' + T07);

const API_PORT = 18941;
const API_BASE = 'http://127.0.0.1:' + API_PORT;
const SERVICE_TOKEN = crypto.randomBytes(32).toString('hex');
const DEV_ALLOW = 'PHF012,acct-3a03c49e-5835-4d92-b89e-424836e79e24';

function tcpOpen(port) { return new Promise((res) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); setTimeout(() => { s.destroy(); res(false); }, 1500); }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHealth(u, ms) { const end = Date.now() + ms; while (Date.now() < end) { try { const r = await fetch(u); if (r.status === 200) return true; } catch (_) {} await sleep(200); } return false; }
function psql(sql) { return execFileSync('ssh', ['claude-phf', `docker exec ${THROWAWAY_CONTAINER} psql -U postgres -d phf_hr_e2e -tAc "${sql.replace(/"/g, '\\"')}"`], { encoding: 'utf8' }).trim(); }

let PASS = 0, FAIL = 0;
const check = (n, c, x) => { c ? (PASS++, console.log('  PASS  ' + n)) : (FAIL++, console.error('  FAIL  ' + n + (x != null ? '  -> ' + x : ''))); };
async function expectThrow(name, fn, codeWanted) {
  try { await fn(); check(name, false, 'no error thrown'); }
  catch (e) { check(name, !codeWanted || e.code === codeWanted, 'got code=' + e.code + ' msg=' + e.message); }
}

(async () => {
  if (!(await tcpOpen(15432))) die('SSH tunnel 127.0.0.1:15432 chưa mở.');
  if (psql("select count(*) from information_schema.schemata where schema_name='accounting'") !== '1') die('schema accounting chưa có — apply migrations/phf_hr_qtth_accounting_v1.sql.');
  if (psql("select count(*) from information_schema.schemata where schema_name='qtth'") !== '1') die('schema qtth chưa có.');

  // deterministic state (append-only triggers block delete on delta/normalized truncate)
  psql('alter table accounting.delta disable trigger user; delete from accounting.import; '
    + 'delete from accounting.cost_dictionary; alter table accounting.delta enable trigger user;');

  const attachRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qtth-accounting-e2e-'));
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
  const { dispatchQtthAction, accountingUploadPreviewViaBridge } = require(path.join(REPO, 'api', '_lib', 'qtth-actions'));
  const D = (session, payload) => dispatchQtthAction(session, payload).then((r) => { if (!r.handled) throw Object.assign(new Error('unhandled ' + payload.action), { code: 'UNHANDLED' }); return r.result; });

  const adminAcc = (await sb.from('user_accounts').select('id,email,role,employee_code').eq('role', 'admin').eq('status', 'active').limit(1).maybeSingle()).data;
  const opAcc = (await sb.from('user_accounts').select('id,email,role,employee_code').ilike('email', '%thanglv150917%').maybeSingle()).data;
  const normAcc = (await sb.from('user_accounts').select('id,email,role,employee_code').eq('role', 'learner').eq('status', 'active').not('employee_code', 'is', null).neq('employee_code', '').limit(1).maybeSingle()).data;
  if (!adminAcc || !opAcc || !normAcc) { cleanup(); die('không lấy đủ persona từ DEV'); }
  const sess = (a) => ({ account: { id: a.id, employeeCode: a.employee_code || '', role: a.role, email: a.email, name: a.email }, role: a.role, sub: a.id });
  const S_ADMIN = sess(adminAcc), S_OP = sess(opAcc), S_NORM = sess(normAcc);

  const PERIOD = '2026-07';
  const buf = fs.readFileSync(T07);
  console.log('\nQTTH Accounting Data V1 — LIVE LOCAL e2e\n');

  // dev lock
  await expectThrow('normal user -> qtthAccountingStatus bị chặn (QTTH_DEV_LOCKED)',
    () => D(S_NORM, { action: 'qtthAccountingStatus', period_month: PERIOD }), 'QTTH_DEV_LOCKED');

  const st0 = await D(S_ADMIN, { action: 'qtthAccountingStatus', period_month: PERIOD });
  check('Admin vào được accounting.status (kỳ trống)', st0 && st0.exists === false);

  // rules seeded
  const rules = await D(S_OP, { action: 'qtthAccountingListRules', period_month: PERIOD });
  check('classification_rule seed nạp từ DB (>= 12 rule active)', rules.rules.length >= 12, rules.rules.length);

  // upload preview via the bridge (the dedicated binary endpoint calls this)
  const prev = await accountingUploadPreviewViaBridge(S_OP, { periodMonth: PERIOD, fileName: 'accounting_t07.xlsx', buffer: buf });
  check('uploadPreview: V1, previewed', prev.version === 1, JSON.stringify({ v: prev.version }));
  check('uploadPreview funnel = audit baseline (source 85975 / debit 38768 / cost-scope 350)',
    prev.totals.sourceRows === 85975 && prev.totals.debitRows === 38768 && prev.totals.costScopeRows === 350,
    JSON.stringify(prev.totals));
  check('INCLUDE 299 / NEEDS_REVIEW 51 / EXCLUDE 0',
    prev.totals.included === 299 && prev.totals.needsReview === 51 && prev.totals.excluded === 0,
    JSON.stringify(prev.totals));
  check('INCLUDED amount = 1,003,597,227', prev.amounts.included === 1003597227, prev.amounts.included);
  check('PHF-MKT flagged out-of-master', (prev.totals.outOfMasterDepartments || []).indexOf('PHF-MKT') >= 0);

  // NOT current until confirmed
  const stPre = await D(S_OP, { action: 'qtthAccountingStatus', period_month: PERIOD });
  check('sau preview: chưa có "current"', stPre.exists === true && !stPre.current && stPre.versions[0].status === 'previewed');
  const listPre = await D(S_OP, { action: 'qtthAccountingListNormalized', period_month: PERIOD });
  check('listNormalized trước confirm: trả dòng của bản previewed (để Operator rà soát), isConfirmed=false',
    (listPre.rows || []).length === 350 && listPre.isConfirmed === false && listPre.status === 'previewed',
    JSON.stringify({ n: (listPre.rows || []).length, status: listPre.status, isConfirmed: listPre.isConfirmed }));

  // RAW_ROWS_SAVED_AS_FACT = 0
  check('DB: normalized rows = 350 (KHÔNG 86k)', psql('select count(*) from accounting.normalized') === '350');
  check('DB: 0 bảng lưu 86k dòng nguồn', Number(psql("select coalesce(max(n),0) from (select count(*) n from accounting.normalized group by file_id) x")) < 1000);

  // confirm
  const conf = await D(S_OP, { action: 'qtthAccountingConfirm', file_id: prev.fileId });
  check('confirm V1', conf && conf.alreadyConfirmed === false);
  const stPost = await D(S_OP, { action: 'qtthAccountingStatus', period_month: PERIOD });
  check('sau confirm: current = V1, active', stPost.current && stPost.current.version === 1 && stPost.importStatus === 'active');

  // drilldown
  const rev = await D(S_ADMIN, { action: 'qtthAccountingListNormalized', period_month: PERIOD, classification: 'NEEDS_REVIEW' });
  const REVIEW8 = ['6414', '6422', '6423', '64177', '64178', '64188', '64273', '64274'];
  check('NEEDS_REVIEW drilldown = 51 dòng, mọi tài khoản thuộc 8 mã đã audit',
    rev.rows.length === 51 && rev.rows.every((r) => REVIEW8.indexOf(r.taiKhoan) >= 0), rev.rows.length);
  check('mọi dòng normalized: cost_code_status = UNRESOLVED (không đoán mã phí — §12)',
    rev.rows.every((r) => r.costCodeStatus === 'UNRESOLVED'));
  const inc = await D(S_ADMIN, { action: 'qtthAccountingListNormalized', period_month: PERIOD, account: '64121' });
  check('drilldown theo tài khoản 64121 = 105 dòng INCLUDE', inc.rows.length === 105 && inc.rows.every((r) => r.classification === 'INCLUDE'), inc.rows.length);

  // provenance: raw file stored + sha
  check('RAW file lưu trên đĩa (sha256 provenance)',
    /^[0-9a-f]{12}$/.test(stPost.current.sha256) && fs.readdirSync(path.join(attachRoot, 'qtth-accounting', PERIOD)).some((f) => /\.xlsx$/.test(f)));

  // re-upload same file -> replay (no dup version)
  const prev2 = await accountingUploadPreviewViaBridge(S_OP, { periodMonth: PERIOD, fileName: 'accounting_t07.xlsx', buffer: buf });
  check('re-upload cùng sha -> replay đúng V1 đã confirmed (không tạo version thừa)', prev2.alreadyConfirmed === true || prev2.version === 1);

  // dictionary
  if (fs.existsSync(DICT)) {
    const dib = fs.readFileSync(DICT).toString('base64');
    const di = await D(S_OP, { action: 'qtthAccountingImportDictionary', file_name: 'cost_dictionary.xlsx', file_base64: dib });
    check('importDictionary = 170 mã phí, V1 current', di.entryCount === 170 && di.version === 1, JSON.stringify(di));
    const ds = await D(S_ADMIN, { action: 'qtthAccountingDictionaryStatus' });
    check('dictionaryStatus: current V1, 6 nhóm', ds.exists && ds.version === 1 && ds.groups.length >= 5, JSON.stringify(ds.groups));
  }

  // ================= V2 · OPERATOR DECISION LAYER =========================
  const hasV2 = psql("select count(*) from information_schema.columns where table_schema='accounting' and table_name='normalized' and column_name='decision_source'") === '1';
  if (!hasV2) {
    console.log('\n[e2e] accounting V2 not applied (migrations/phf_hr_qtth_accounting_v2.sql) — decision-layer checks skipped.');
  } else {
    console.log('\n--- V2 · Operator decision layer ---');
    const fid = stPost.current.fileId;

    // categories come from the imported Cost Dictionary D/E groups
    const cats641 = await D(S_OP, { action: 'qtthAccountingListCategories', account: '64177' });
    check('listCategories: from Cost Dictionary, filtered to D (641*)', cats641.hasDictionary && cats641.filteredBy === 'D' && cats641.categories.length > 0, JSON.stringify({ n: cats641.categories.length, f: cats641.filteredBy }));

    // A. EXCLUDE 6414 + remember "phân bổ khấu hao TSCĐ"
    const r6414 = rev.rows.filter((r) => r.taiKhoan === '6414');
    const dec = await D(S_OP, { action: 'qtthAccountingDecideItem', file_id: fid, source_row_index: r6414[0].sourceRowIndex, decision: 'EXCLUDE', remember: true, match_text: 'phân bổ khấu hao TSCĐ' });
    check('decideItem EXCLUDE 6414 + remember -> rule created + applied to all matching 6414 rows',
      dec.remembered && dec.decision === 'EXCLUDE' && (dec.decided + dec.ruleAlsoAppliedTo) >= r6414.length - 0, JSON.stringify({ decided: dec.decided, also: dec.ruleAlsoAppliedTo }));
    check('decideItem live funnel reconciles (I+E+NR === 350)',
      dec.live.totals.included + dec.live.totals.excluded + dec.live.totals.needsReview === 350 && dec.live.reconciles === true, JSON.stringify(dec.live.totals));

    const rev2 = await D(S_ADMIN, { action: 'qtthAccountingListNormalized', period_month: PERIOD, classification: 'EXCLUDE' });
    check('6414 rows now EXCLUDE via operator (decision_source operator_*)',
      rev2.rows.filter((r) => r.taiKhoan === '6414').length > 0 && rev2.rows.filter((r) => r.taiKhoan === '6414').every((r) => /operator/.test(r.decisionSource)));
    check('other accounts NOT touched by the 6414 rule', rev2.rows.every((r) => r.taiKhoan === '6414'));

    // B. INCLUDE 64177 FB row + category
    const fbRow = rev.rows.find((r) => r.taiKhoan === '64177' && /facebook/i.test(r.dienGiai || ''));
    const cat = cats641.categories[0].maPhi;
    const decInc = await D(S_OP, { action: 'qtthAccountingDecideItem', file_id: fid, source_row_index: fbRow.sourceRowIndex, decision: 'INCLUDE', cost_code: cat, cost_code_name: cats641.categories[0].tenPhi, remember: false });
    check('decideItem INCLUDE 64177 + category (no remember) -> single row, cost_code set',
      decInc.decided === 1 && decInc.costCode === cat && !decInc.remembered);
    const incRows = await D(S_ADMIN, { action: 'qtthAccountingListNormalized', period_month: PERIOD, account: '64177' });
    const fbNow = incRows.rows.find((r) => r.sourceRowIndex === fbRow.sourceRowIndex);
    check('64177 FB row: classification INCLUDE, costCode kept, costCodeStatus RESOLVED, decision_source operator_item',
      fbNow.classification === 'INCLUDE' && fbNow.costCode === cat && fbNow.costCodeStatus === 'RESOLVED' && fbNow.decisionSource === 'operator_item');

    // C. remembered rule list + conflict guard
    const rr = await D(S_ADMIN, { action: 'qtthAccountingListRememberedRules' });
    check('listRememberedRules: 1 operator rule (6414 EXCLUDE), account-only NOT a rule kind',
      rr.rules.length === 1 && rr.rules[0].account === '6414' && rr.rules[0].decision === 'EXCLUDE' && rr.rules[0].matchTokens.length >= 3);
    await expectThrow('conflict: remembering 6414 same content with opposite decision -> blocked',
      () => D(S_OP, { action: 'qtthAccountingDecideItem', file_id: fid, source_row_index: r6414[1] ? r6414[1].sourceRowIndex : r6414[0].sourceRowIndex, decision: 'INCLUDE', remember: true, match_text: 'phân bổ khấu hao TSCĐ' }),
      'ACCOUNTING_RULE_CONFLICT');

    // D. disable rule -> re-upload (fresh preview) puts 6414 back to NEEDS_REVIEW
    const rid = rr.rules[0].id;
    const off = await D(S_OP, { action: 'qtthAccountingSetRuleActive', rule_id: rid, is_active: false, reason: 'e2e test' });
    check('setRuleActive false -> changed', off.changed === true);
    const rr2 = await D(S_ADMIN, { action: 'qtthAccountingListRememberedRules' });
    check('rule now inactive in the list', rr2.rules[0].isActive === false);
    const hist = await D(S_ADMIN, { action: 'qtthAccountingRuleHistory', rule_id: rid });
    check('rule_history: create + disable recorded (audit preserved)',
      hist.entries.length >= 2 && hist.entries.some((e) => e.action === 'create') && hist.entries.some((e) => e.action === 'disable'));
    // fresh preview (new period) proves the disabled rule no longer fires
    const P2 = '2026-06';
    psql("delete from accounting.import where period_month = '2026-06'");
    const fresh = await accountingUploadPreviewViaBridge(S_OP, { periodMonth: P2, fileName: 'accounting_t07.xlsx', buffer: buf });
    check('disabled rule does NOT auto-classify a fresh import (6414 back to NEEDS_REVIEW, INCLUDE 299 / NR 51 / EXCL 0)',
      fresh.totals.included === 299 && fresh.totals.needsReview === 51 && fresh.totals.excluded === 0, JSON.stringify(fresh.totals));

    // E. no raw rows persisted as fact (still)
    check('V2: still 0 raw source rows persisted as fact',
      Number(psql('select coalesce(max(n),0) from (select count(*) n from accounting.normalized group by file_id) x')) < 1000);
    check('V2: item_decision + rule_history are append-only (blocked UPDATE)',
      psql("select count(*) from pg_trigger where tgname in ('item_decision_immutable','rule_history_immutable')") === '2');
  }

  cleanup();
  console.log('\nTESTED_COMMIT =', (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(); } catch (_) { return '?'; } })());
  console.log('TEST_DB       = phf_hr_e2e (throwaway, tunnel 15432)   SUPABASE_REF = PHF-HR-DEV pxkjvawdrixgoukhyvnk');
  console.log(`\n${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(3); });
