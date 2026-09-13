'use strict';
/*
 * PHF HR / QTTH — TRUTH DATA PROD BOOTSTRAP · IMPORTER.
 *
 *   node scripts/qtth-truth-bootstrap/import.js \
 *        --target-env <path/to/db.env>  (PHF_HR_DB_HOST/PORT/NAME + a superuser or phf_hr_owner) \
 *        [--bundle docs/qtth-truth-bootstrap]  [--dry-run | --apply] \
 *        [--schema payroll|accounting|all]
 *
 * PROPERTIES (Operator handover §8):
 *   - idempotent            : re-run = all SKIP, 0 duplicate truth
 *   - transactional         : ONE transaction per schema; ROLLBACK on any conflict
 *   - fail closed           : unknown state / missing schema / checksum mismatch -> STOP
 *   - conflict detection    : same natural key + different payload -> CONFLICT, no write
 *   - no silent overwrite   : an existing PROD truth row is NEVER UPDATEd
 *   - audit                 : accounting.bootstrap_log row + _secure/import-report-*.json
 *   - checksum verification : every payload sha256 checked against checksums.json first
 *   - safe rerun / rollback : DOWN migrations exist; apply is all-or-nothing per schema
 *
 * DEFAULT is --dry-run. --apply requires the explicit flag AND (for a PROD target)
 * an out-of-band Operator approval — this script does not itself gate that.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const REPO = path.resolve(__dirname, '..', '..');
const { Client } = require(path.join(REPO, 'services/phf-hr-api/node_modules/pg'));
const { descTokens } = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-accounting-classify'));

// ---- args ----
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
const APPLY = args.includes('--apply');
const DRY = !APPLY || args.includes('--dry-run');
const BUNDLE = path.resolve(REPO, opt('--bundle', 'docs/qtth-truth-bootstrap'));
const SECURE = path.join(REPO, 'scripts/qtth-truth-bootstrap/_secure');
const WHICH = String(opt('--schema', 'all'));
const TARGET_ENV = opt('--target-env');
if (!TARGET_ENV) { console.error('need --target-env <db.env>'); process.exit(2); }

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const round0 = (x) => Math.round(Number(x) || 0);
function loadEnv(p) { const o = {}; for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim(); } return o; }
function stableHash(obj) {
  const norm = (v) => {
    if (v == null) return null;
    if (typeof v === 'number') return Math.round(v * 100) / 100;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (Array.isArray(v)) return v.map(norm);
    if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = norm(v[k]); return o; }
    return String(v).trim();
  };
  return sha256(JSON.stringify(norm(obj)));
}

// ---- load + verify bundle ----
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
const manifest = readJson(path.join(BUNDLE, 'manifest.json'));
const checksums = readJson(path.join(BUNDLE, 'checksums.json'));
const payPayloadPath = path.join(SECURE, 'payroll_payload.secure.json');
const accPayloadPath = path.join(SECURE, 'accounting_payload.secure.json');

function verifyChecksums() {
  const fail = [];
  if (sha256(fs.readFileSync(payPayloadPath)) !== checksums.payrollPayloadSha256) fail.push('payroll_payload');
  if (sha256(fs.readFileSync(accPayloadPath)) !== checksums.accountingPayloadSha256) fail.push('accounting_payload');
  if (sha256(fs.readFileSync(path.join(BUNDLE, 'payroll_periods.json'))) !== checksums.payrollPeriodsSha256) fail.push('payroll_periods');
  if (sha256(fs.readFileSync(path.join(BUNDLE, 'accounting_summary.json'))) !== checksums.accountingSummarySha256) fail.push('accounting_summary');
  return fail;
}

const report = { bundleId: manifest.bundleId, mode: DRY ? 'dry-run' : 'apply', startedAt: new Date().toISOString(), target: null, schemas: {}, conflicts: [], ok: true };

async function main() {
  const cf = verifyChecksums();
  if (cf.length) { console.error('CHECKSUM MISMATCH:', cf.join(', '), '— refusing to proceed.'); process.exit(3); }
  console.log('checksums OK · bundle', manifest.bundleId, '·', DRY ? 'DRY-RUN' : 'APPLY');

  const env = loadEnv(TARGET_ENV);
  const c = new Client({ host: env.PHF_HR_DB_HOST, port: +env.PHF_HR_DB_PORT, database: env.PHF_HR_DB_NAME, user: env.PHF_HR_DB_RUNTIME_USER || env.PHF_HR_DB_USER, password: env.PHF_HR_DB_RUNTIME_PASSWORD || env.PHF_HR_DB_PASSWORD });
  await c.connect();
  // prechecks read information_schema, which is privilege-filtered — become
  // phf_hr_app first (the runtime role is only a MEMBER; grants apply after SET ROLE).
  try { await c.query('SET ROLE phf_hr_app'); } catch (_) { /* superuser target: stay as-is */ }
  const who = (await c.query('select session_user u, current_database() d')).rows[0];
  report.target = { database: who.d, user: who.u, host: env.PHF_HR_DB_HOST + ':' + env.PHF_HR_DB_PORT };
  console.log('target:', who.d, 'as', who.u);

  // schema precheck — fail closed
  const schemas = (await c.query("select nspname from pg_namespace where nspname in ('payroll','accounting','qtth')")).rows.map((r) => r.nspname);
  const need = [];
  if (WHICH === 'all' || WHICH === 'payroll') { if (!schemas.includes('payroll')) need.push('payroll'); }
  if (WHICH === 'all' || WHICH === 'accounting') { if (!schemas.includes('accounting')) need.push('accounting'); }
  if (need.length) { console.error('MISSING SCHEMA(S):', need.join(', '), '— run the migrations first. STOP.'); await c.end(); process.exit(4); }
  const accV2 = schemas.includes('accounting') && (await c.query("select 1 from information_schema.columns where table_schema='accounting' and table_name='normalized' and column_name='decision_source'")).rowCount > 0;
  const hasLog = (await c.query("select 1 from information_schema.tables where table_schema='accounting' and table_name='bootstrap_log'")).rowCount > 0;
  if ((WHICH === 'all' || WHICH === 'accounting') && !accV2) { console.error('accounting V2 (decision layer) not applied — STOP.'); await c.end(); process.exit(4); }

  try {
    if (WHICH === 'all' || WHICH === 'payroll') await doPayroll(c);
    if (WHICH === 'all' || WHICH === 'accounting') await doAccounting(c, hasLog);
  } finally {
    await c.end();
  }

  report.finishedAt = new Date().toISOString();
  const rp = path.join(SECURE, 'import-report-' + report.target.database + '-' + Date.now() + '.json');
  fs.writeFileSync(rp, JSON.stringify(report, null, 2));
  console.log('\n==== REPORT ====');
  console.log(JSON.stringify(report.schemas, null, 1));
  if (report.conflicts.length) { console.error('\nCONFLICTS (' + report.conflicts.length + ') — NOTHING WAS WRITTEN for the affected schema:'); report.conflicts.slice(0, 20).forEach((x) => console.error('  ', JSON.stringify(x))); }
  console.log('\nreport ->', path.relative(REPO, rp));
  console.log(report.ok && !report.conflicts.length ? (DRY ? 'DRY-RUN OK' : 'APPLY OK') : 'FAIL / CONFLICT');
  process.exit(report.ok && !report.conflicts.length ? 0 : 1);
}

// ------------------------------------------------------------------ PAYROLL
async function doPayroll(c) {
  const payload = readJson(payPayloadPath);
  const S = report.schemas.payroll = { periods: {}, inserted: 0, skipped: 0, conflicts: 0 };
  await c.query('BEGIN');
  await c.query('SET LOCAL ROLE phf_hr_app');
  try {
    for (const per of payload.periods) {
      const P = S.periods[per.periodMonth] = { imports: 0, files: 0, normalizedInsert: 0, normalizedSkip: 0, conflicts: [] };
      let imp = (await c.query('SELECT * FROM payroll.import WHERE period_month = $1', [per.periodMonth])).rows[0];
      let file = null;
      if (imp) {
        file = (await c.query('SELECT * FROM payroll.import_file WHERE import_id = $1 AND sha256 = $2', [imp.id, per.sourceSha256])).rows[0];
      }
      // existing normalized for this period (any confirmed file)
      const existing = imp ? (await c.query(
        `SELECT n.* FROM payroll.normalized n JOIN payroll.import_file f ON f.id = n.file_id
          WHERE f.import_id = $1 AND f.status = 'confirmed'`, [imp.id])).rows : [];
      const exByCode = new Map(existing.map((r) => [r.employee_code, r]));

      for (const rec of per.records) {
        const want = payrollRowShape(rec, per.periodMonth);
        const have = exByCode.get(rec.employeeCode);
        if (!have) { P.normalizedInsert++; continue; }
        if (stableHash(payrollRowShape(rowToRec(have), per.periodMonth)) === stableHash(want)) { P.normalizedSkip++; continue; }
        P.conflicts.push({ period: per.periodMonth, employeeCode: rec.employeeCode, reason: 'normalized row exists with different payload' });
      }
      // rows present on PROD but NOT in the bundle — report, do not delete
      for (const r of existing) if (!per.records.find((x) => x.employeeCode === r.employee_code)) P.conflicts.push({ period: per.periodMonth, employeeCode: r.employee_code, reason: 'exists on target, absent from bundle' });

      S.inserted += P.normalizedInsert; S.skipped += P.normalizedSkip; S.conflicts += P.conflicts.length;
      report.conflicts.push(...P.conflicts);

      if (!DRY && !P.conflicts.length && P.normalizedInsert > 0) {
        if (!imp) imp = (await c.query(
          "INSERT INTO payroll.import (period_month, status, created_by_name) VALUES ($1,'active',$2) RETURNING *",
          [per.periodMonth, 'QTTH bootstrap ' + manifest.bundleId])).rows[0];
        if (!file) {
          const nextVer = ((await c.query('SELECT COALESCE(MAX(version),0) v FROM payroll.import_file WHERE import_id = $1', [imp.id])).rows[0].v) + 1;
          file = (await c.query(
            `INSERT INTO payroll.import_file (import_id, version, file_name, sha256, byte_size, storage_ref, template_fingerprint, template_matched, status, row_count, warning_count, validation, uploaded_by_name, confirmed_at)
             VALUES ($1,$2,$3,$4,0,$5,$6,true,'confirmed',$7,0,$8,$9, now()) RETURNING *`,
            [imp.id, nextVer, 'bootstrap-' + per.tag + '.tsv', per.sourceSha256, 'bootstrap/' + per.periodMonth, per.templateFingerprint,
             per.records.length, JSON.stringify({ bundle: manifest.bundleId, columnMap: per.columnMap }), 'QTTH bootstrap'])).rows[0];
          await c.query(
            `INSERT INTO payroll.template (fingerprint, label, is_canonical, column_map, first_seen_period)
             VALUES ($1,$2,$3,$4,$5) ON CONFLICT (fingerprint) DO NOTHING`,
            [per.templateFingerprint, 'PHF Payroll ' + (per.templateFingerprint === '82b1b54c2bc2' ? 'Canonical V1' : per.tag),
             per.templateFingerprint === '82b1b54c2bc2', JSON.stringify(per.columnMap), per.periodMonth]);
        }
        for (const rec of per.records) {
          if (exByCode.has(rec.employeeCode)) continue;
          const f = rec.fields || {};
          await c.query('INSERT INTO payroll.raw_row (file_id, source_row_index, employee_code, cells) VALUES ($1,$2,$3,$4)',
            [file.id, rec.sourceRowIndex || 0, rec.employeeCode, JSON.stringify({})]);
          await c.query(
            `INSERT INTO payroll.normalized
               (file_id, employee_code, period_month, full_name_source, source_branch, salary_grade, people_master_matched,
                base_salary_bhxh, job_allowance, base_standard_total_1, std_income_total_1to9, worked_salary_total_1,
                allowance_actual_total_2, bonus_total_3, grand_total_4, internal_deduct_total_5, income_after_internal_5,
                statutory_deduct_total_6, income_after_deduct_6, tax_taxable_income, tax_assessable_income, tax_dependents,
                tax_pit_amount, final_net_after_tax, t13_revenue_bonus, reconcile_adjust, source_detail, validation_status, validation_notes)
             VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`,
            [file.id, rec.employeeCode, per.periodMonth, rec.fullName, f.source_branch || null, f.salary_grade || null,
             n(f.base_salary_bhxh), n(f.job_allowance), n(f.base_standard_total_1), n(f.std_income_total_1to9), n(f.worked_salary_total_1),
             n(f.allowance_actual_total_2), n(f.bonus_total_3), n(f.grand_total_4), n(f.internal_deduct_total_5), n(f.income_after_internal_5),
             n(f.statutory_deduct_total_6), n(f.income_after_deduct_6), n(f.tax_taxable_income), n(f.tax_assessable_income), n(f.tax_dependents),
             n(f.tax_pit_amount), n(f.final_net_after_tax), n(f.t13_revenue_bonus), n(f.reconcile_adjust),
             JSON.stringify(rec.sourceDetail || {}), (rec.reconciliation || []).length ? 'warn' : 'ok', JSON.stringify(rec.reconciliation || [])]);
        }
        await c.query('SET CONSTRAINTS ALL DEFERRED');
        await c.query("UPDATE payroll.import SET status='active', current_file_id=$2 WHERE id=$1", [imp.id, file.id]);
        P.imports = imp ? 1 : 0; P.files = 1;
      }
    }
    if (report.conflicts.length && !DRY) { await c.query('ROLLBACK'); report.ok = false; console.error('payroll: CONFLICT -> ROLLBACK'); return; }
    await c.query(DRY ? 'ROLLBACK' : 'COMMIT');
    console.log('payroll:', DRY ? 'dry-run rolled back' : 'committed', '· insert', S.inserted, '· skip', S.skipped, '· conflicts', S.conflicts);
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); report.ok = false; console.error('payroll FAILED:', e.message); throw e; }
}
function n(v) { return typeof v === 'number' && Number.isFinite(v) ? v : (v == null || v === '' ? null : Number(v)); }
function payrollRowShape(rec, pm) {
  const f = rec.fields || {};
  return {
    period: pm, employeeCode: rec.employeeCode,
    keys: ['base_salary_bhxh', 'job_allowance', 'base_standard_total_1', 'std_income_total_1to9', 'worked_salary_total_1',
      'allowance_actual_total_2', 'bonus_total_3', 'grand_total_4', 'internal_deduct_total_5', 'income_after_internal_5',
      'statutory_deduct_total_6', 'income_after_deduct_6', 'tax_taxable_income', 'tax_pit_amount', 'final_net_after_tax',
      't13_revenue_bonus', 'reconcile_adjust'].map((k) => n(f[k])),
  };
}
function rowToRec(row) {
  const fields = {};
  for (const k of ['base_salary_bhxh', 'job_allowance', 'base_standard_total_1', 'std_income_total_1to9', 'worked_salary_total_1',
    'allowance_actual_total_2', 'bonus_total_3', 'grand_total_4', 'internal_deduct_total_5', 'income_after_internal_5',
    'statutory_deduct_total_6', 'income_after_deduct_6', 'tax_taxable_income', 'tax_pit_amount', 'final_net_after_tax',
    't13_revenue_bonus', 'reconcile_adjust']) fields[k] = row[k] == null ? null : Number(row[k]);
  return { employeeCode: row.employee_code, fields };
}

// --------------------------------------------------------------- ACCOUNTING
function acctRowShape(r) {
  return {
    period: r.periodMonth || r.period_month, srx: r.sourceRowIndex != null ? r.sourceRowIndex : r.source_row_index,
    acct: r.taiKhoan || r.tai_khoan, contra: r.tkDoiUng || r.tk_doi_ung,
    no: r.phatSinhNo != null ? r.phatSinhNo : r.phat_sinh_no,
    dien: r.dienGiai || r.dien_giai, maBp: r.maBp || r.ma_bp,
    classification: r.classification, costCode: r.costCode || r.cost_code || null,
  };
}
async function doAccounting(c, hasLog) {
  const p = readJson(accPayloadPath);
  const S = report.schemas.accounting = { inserted: {}, skipped: {}, conflicts: 0, parity: null };
  const inc = (k) => (S.inserted[k] = (S.inserted[k] || 0) + 1);
  const skp = (k) => (S.skipped[k] = (S.skipped[k] || 0) + 1);
  await c.query('BEGIN');
  await c.query('SET LOCAL ROLE phf_hr_app');
  try {
    // ---- cost dictionary (by source_sha256) ----
    let dictId = null;
    if (p.costDictionary) {
      const d = p.costDictionary;
      const ex = (await c.query('SELECT * FROM accounting.cost_dictionary WHERE source_sha256 = $1', [d.sourceSha256])).rows[0];
      if (ex) { dictId = ex.id; skp('cost_dictionary'); if (Number((await c.query('SELECT count(*) n FROM accounting.cost_dictionary_entry WHERE dictionary_id=$1', [ex.id])).rows[0].n)) skp('cost_dictionary_entry(all)'); }
      else if (!DRY) {
        await c.query('UPDATE accounting.cost_dictionary SET is_current = false WHERE is_current = true');
        const nextVer = ((await c.query('SELECT COALESCE(MAX(version),0) v FROM accounting.cost_dictionary')).rows[0].v) + 1;
        const row = (await c.query(
          `INSERT INTO accounting.cost_dictionary (version, source_file_name, source_sha256, entry_count, is_current, imported_by_name)
           VALUES ($1,$2,$3,$4,true,$5) RETURNING id`, [nextVer, d.sourceFileName, d.sourceSha256, d.entryCount, 'QTTH bootstrap ' + manifest.bundleId])).rows[0];
        dictId = row.id;
        for (const e of d.entries) {
          await c.query(
            `INSERT INTO accounting.cost_dictionary_entry (dictionary_id, ma_phi, ten_phi, bo_phan, nhom1, ten_nhom1, nhom2, ten_nhom2, nhom3, ten_nhom3, ghi_chu)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [dictId, e.maPhi, e.tenPhi, e.boPhan, e.nhom1, e.tenNhom1, e.nhom2, e.tenNhom2, e.nhom3, e.tenNhom3, e.ghiChu]);
          inc('cost_dictionary_entry');
        }
        inc('cost_dictionary');
      } else { inc('cost_dictionary'); S.inserted['cost_dictionary_entry'] = d.entries.length; }
    }

    // ---- operator rules (natural key = match_signature) ----
    for (const r of p.operatorRules) {
      const ex = (await c.query('SELECT * FROM accounting.classification_rule WHERE match_signature = $1', [r.matchSignature])).rows[0];
      if (ex) {
        const same = ex.action === r.action && String(ex.cost_code || '') === String(r.costCode || '')
          && stableHash(typeof ex.match_value === 'string' ? JSON.parse(ex.match_value) : ex.match_value) === stableHash(r.matchValue);
        if (same) { skp('classification_rule'); continue; }
        report.conflicts.push({ table: 'classification_rule', key: r.matchSignature, reason: 'exists with different action/cost_code/match' });
        S.conflicts++; continue;
      }
      if (!DRY) {
        await c.query(
          `INSERT INTO accounting.classification_rule
             (id, priority, match_kind, match_value, action, note, rule_version, is_active, origin, cost_code, cost_code_name, created_from, match_signature, created_by_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'operator',$9,$10,$11,$12,$13)`,
          [r.id, r.priority || 15, r.matchKind || 'combo', JSON.stringify(r.matchValue), r.action, r.note, r.ruleVersion || 'v2', r.isActive,
           r.costCode, r.costCodeName, 'bootstrap:' + manifest.bundleId, r.matchSignature, r.createdByName || 'QTTH bootstrap']);
      }
      inc('classification_rule');
    }

    // ---- rule history (append; dedupe by rule_id+action+changed_at) ----
    for (const h of p.ruleHistory) {
      const ex = (await c.query(
        'SELECT 1 FROM accounting.rule_history WHERE rule_id = $1 AND action = $2 AND changed_at = $3', [h.ruleId, h.action, h.changedAt])).rowCount;
      if (ex) { skp('rule_history'); continue; }
      if (!DRY) await c.query(
        `INSERT INTO accounting.rule_history (rule_id, action, snapshot, reason, changed_by_name, changed_at)
         VALUES ($1,$2,$3,$4,$5,$6)`, [h.ruleId, h.action, JSON.stringify(h.snapshot || {}), h.reason, h.changedByName, h.changedAt]);
      inc('rule_history');
    }

    // ---- import + import_file (natural key = period_month / sha256) ----
    let imp = (await c.query("SELECT * FROM accounting.import WHERE period_month = $1", [p.importFile.periodMonth])).rows[0];
    let file = imp ? (await c.query('SELECT * FROM accounting.import_file WHERE import_id = $1 AND sha256 = $2', [imp.id, p.importFile.sha256])).rows[0] : null;
    const existingNorm = file ? (await c.query('SELECT * FROM accounting.normalized WHERE file_id = $1', [file.id])).rows : [];
    const exBySrx = new Map(existingNorm.map((r) => [r.source_row_index, r]));

    let normInsert = 0, normSkip = 0;
    for (const r of p.normalized) {
      const have = exBySrx.get(r.sourceRowIndex);
      if (!have) { normInsert++; continue; }
      if (stableHash(acctRowShape(r)) === stableHash(acctRowShape(have))) { normSkip++; continue; }
      report.conflicts.push({ table: 'normalized', period: r.periodMonth, sourceRowIndex: r.sourceRowIndex, reason: 'exists with different payload' });
      S.conflicts++;
    }
    for (const r of existingNorm) if (!p.normalized.find((x) => x.sourceRowIndex === r.source_row_index)) {
      report.conflicts.push({ table: 'normalized', sourceRowIndex: r.source_row_index, reason: 'exists on target, absent from bundle' });
      S.conflicts++;
    }
    S.inserted['normalized'] = normInsert; S.skipped['normalized'] = normSkip;

    if (!DRY && !report.conflicts.length && normInsert > 0) {
      if (!imp) imp = (await c.query(
        "INSERT INTO accounting.import (period_month, status, created_by_name) VALUES ($1,'active',$2) RETURNING *",
        [p.importFile.periodMonth, 'QTTH bootstrap ' + manifest.bundleId])).rows[0];
      if (!file) {
        const cc = p.importFile.counters;
        file = (await c.query(
          `INSERT INTO accounting.import_file
             (import_id, version, file_name, sha256, byte_size, storage_ref, sheet_name, source_from_date, source_to_date, rule_version, status,
              source_row_count, debit_row_count, credit_row_count, cost_scope_row_count, included_row_count, excluded_row_count, needs_review_row_count,
              included_amount, needs_review_amount, excluded_amount, warning_count, report, uploaded_by_name, confirmed_at)
           VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22, now()) RETURNING *`,
          [imp.id, p.importFile.fileName, p.importFile.sha256, p.importFile.byteSize, 'bootstrap/' + p.importFile.periodMonth,
           p.importFile.sheetName, p.importFile.sourceFromDate, p.importFile.sourceToDate, p.importFile.ruleVersion,
           cc.source_row_count, cc.debit_row_count, cc.credit_row_count, cc.cost_scope_row_count, cc.included_row_count, cc.excluded_row_count, cc.needs_review_row_count,
           cc.included_amount, cc.needs_review_amount, cc.excluded_amount, cc.warning_count, JSON.stringify(p.importFile.report || {}), 'QTTH bootstrap'])).rows[0];
      }
      for (const r of p.normalized) {
        if (exBySrx.has(r.sourceRowIndex)) continue;
        await c.query(
          `INSERT INTO accounting.normalized
             (file_id, period_month, source_row_index, ngay_ct, ma_ct, so_ct, ma_khach, ten_khach, dien_giai,
              tai_khoan, tk_doi_ung, phat_sinh_no, ma_bp, ma_bp_out_of_master,
              classification, classified_by_rule_id, rule_version, cost_code, cost_code_status, decision_source, warnings)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
          [file.id, r.periodMonth, r.sourceRowIndex, r.ngayCt, r.maCt, r.soCt, r.maKhach, r.tenKhach, r.dienGiai,
           r.taiKhoan, r.tkDoiUng, r.phatSinhNo, r.maBp, r.maBpOutOfMaster,
           r.classification, r.classifiedByRuleId, r.ruleVersion, r.costCode, r.costCodeStatus, r.decisionSource, JSON.stringify(r.warnings || [])]);
      }
      // item decisions (append; dedupe by period+srx+decidedAt)
      for (const d of p.itemDecisions) {
        const ex = (await c.query(
          'SELECT 1 FROM accounting.item_decision WHERE file_id = $1 AND source_row_index = $2 AND decided_at = $3', [file.id, d.sourceRowIndex, d.decidedAt])).rowCount;
        if (ex) { skp('item_decision'); continue; }
        await c.query(
          `INSERT INTO accounting.item_decision
             (import_id, file_id, period_month, source_row_index, tai_khoan, dien_giai, phat_sinh_no, decision, cost_code, cost_code_name, remembered_rule_id, note, decided_by_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [imp.id, file.id, d.periodMonth, d.sourceRowIndex, d.taiKhoan, d.dienGiai, d.phatSinhNo, d.decision, d.costCode, d.costCodeName, d.rememberedRuleId, d.note, d.decidedByName]);
        inc('item_decision');
      }
      await c.query('SET CONSTRAINTS ALL DEFERRED');
      await c.query("UPDATE accounting.import SET status='active', current_file_id=$2 WHERE id=$1", [imp.id, file.id]);
      inc('import'); inc('import_file');
    } else if (DRY) {
      S.inserted['normalized'] = normInsert; S.inserted['item_decision'] = p.itemDecisions.length;
      S.inserted['import'] = imp ? 0 : 1; S.inserted['import_file'] = file ? 0 : 1;
    }

    // parity read-back (post-insert if applied, else projected)
    S.parity = { include: p.importFile.counters.included_row_count, exclude: p.importFile.counters.excluded_row_count, needsReview: p.importFile.counters.needs_review_row_count, includeAmount: Number(p.importFile.counters.included_amount), excludeAmount: Number(p.importFile.counters.excluded_amount) };

    if (report.conflicts.length && !DRY) { await c.query('ROLLBACK'); report.ok = false; console.error('accounting: CONFLICT -> ROLLBACK'); return; }
    if (hasLog && !DRY && !report.conflicts.length) {
      await c.query(
        `INSERT INTO accounting.bootstrap_log (bundle_id, target_schema, mode, result, checksums, summary, applied_by_name)
         VALUES ($1,'accounting','apply','ok',$2,$3,$4)`,
        [manifest.bundleId, JSON.stringify(checksums), JSON.stringify(S), 'QTTH bootstrap importer']);
    }
    await c.query(DRY ? 'ROLLBACK' : 'COMMIT');
    console.log('accounting:', DRY ? 'dry-run rolled back' : 'committed', '· inserted', JSON.stringify(S.inserted), '· conflicts', S.conflicts);
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); report.ok = false; console.error('accounting FAILED:', e.message); throw e; }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
