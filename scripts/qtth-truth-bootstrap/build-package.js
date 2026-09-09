'use strict';
/*
 * PHF HR / QTTH — TRUTH DATA PROD BOOTSTRAP · Phase 1 · PACKAGE BUILDER.
 *
 * Reads the CURRENT LOCAL CANONICAL TRUTH and writes a deterministic,
 * reviewable Promotion Package. NO PROD WRITE. NO PROD READ.
 *
 *   PAYROLL truth  = docs/payroll-corpus/T1..T6.tsv + T7_CANONICAL.tsv
 *                    (Operator's real workbooks, verbatim; sha256 pinned in
 *                     docs/payroll-corpus/README.txt) run through the SHIPPED
 *                     normalizer + cost model. Deterministic — this is NOT
 *                     "re-uploading", it is regenerating the same confirmed
 *                     truth the local tests already proved.
 *   ACCOUNTING truth = the CONFIRMED accounting.* rows in the local throwaway
 *                      phf_hr_e2e (period 2026-07): normalized cost lines,
 *                      item decisions, operator rules + rule history, the
 *                      current Cost Dictionary + entries, import provenance.
 *
 * OUTPUT
 *   docs/qtth-truth-bootstrap/manifest.json            (committable — counts/fingerprints/totals only)
 *   docs/qtth-truth-bootstrap/payroll_periods.json     (committable — per-period aggregates, NO salary values)
 *   docs/qtth-truth-bootstrap/accounting_summary.json  (committable — counts + parity gates + rule metadata, NO customer rows)
 *   docs/qtth-truth-bootstrap/checksums.json           (committable)
 *   scripts/qtth-truth-bootstrap/_secure/payroll_payload.secure.json     (GITIGNORED — employee-level salary)
 *   scripts/qtth-truth-bootstrap/_secure/accounting_payload.secure.json  (GITIGNORED — vendor/customer rows)
 *
 * Run: node scripts/qtth-truth-bootstrap/build-package.js
 *   (needs the SSH tunnel 127.0.0.1:15432 -> throwaway phf_hr_e2e + e2e/phf-hr-e2e-db.env)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const REPO = path.resolve(__dirname, '..', '..');
const { Client } = require(path.join(REPO, 'services/phf-hr-api/node_modules/pg'));

const T = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-template'));
const { normalizeGrid } = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-normalize'));
const COST = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-cost-model'));

const OUT_PUB = path.join(REPO, 'docs/qtth-truth-bootstrap');
const OUT_SEC = path.join(REPO, 'scripts/qtth-truth-bootstrap/_secure');
fs.mkdirSync(OUT_PUB, { recursive: true });
fs.mkdirSync(OUT_SEC, { recursive: true });

const BUNDLE_ID = 'QTTH_TRUTH_BOOTSTRAP_V1_2026-09-09';
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const round0 = (x) => Math.round(Number(x) || 0);
function loadEnv(p) { const o = {}; for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim(); } return o; }
function grid(f) { let s = fs.readFileSync(f, 'utf8'); if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); return s.split(/\r?\n/).map((l) => l.split('\t')); }

// ---- PAYROLL -----------------------------------------------------------
const PERIOD_MAP = { T1: '2026-01', T2: '2026-02', T3: '2026-03', T4: '2026-04', T5: '2026-05', T6: '2026-06', T7: '2026-07' };
function buildPayroll() {
  const periods = [];
  const secure = { bundleId: BUNDLE_ID, generatedAt: new Date().toISOString(), schemaTarget: 'payroll', periods: [] };
  for (const [tag, pm] of Object.entries(PERIOD_MAP)) {
    const srcFile = path.join(REPO, 'scripts/fixtures/payroll', tag + '.tsv');
    const buf = fs.readFileSync(srcFile);
    const g = grid(srcFile);
    const fp = T.fingerprint(g);
    if (!fp.columnMap) throw new Error('payroll ' + tag + ': no columnMap');
    const nm = normalizeGrid(g, fp.columnMap);
    if (!nm.ok) throw new Error('payroll ' + tag + ': normalize !ok');
    const agg = COST.aggregatePeriodCost(nm.records);
    let grand4 = 0, t13in4 = 0;
    for (const r of nm.records) {
      const m = Object.assign({}, r.fields, r.sourceDetail);
      if (Number.isFinite(m.grand_total_4)) grand4 += m.grand_total_4;
      if (Number.isFinite(m.bonus_thuong_le_1_1)) t13in4 += m.bonus_thuong_le_1_1;
    }
    const expectedCost = round0(grand4 - t13in4);
    const delta = round0(agg.totalPersonnelCost - expectedCost);
    const isCanonical = tag === 'T7';

    periods.push({
      tag, periodMonth: pm,
      version: 1, status: 'confirmed',
      employeeRows: nm.records.length,
      normalizedRows: nm.records.length,
      sourceSha256: sha256(buf),
      templateFingerprint: fp.fingerprint,
      templateIsCanonical: isCanonical,
      canonicalCompatible: fp.fingerprint === '82b1b54c2bc2', // T5/T6/T7 share this
      personnelCostTotal: round0(agg.totalPersonnelCost),
      sourceReconciliationTotal: expectedCost,
      reconciliationDelta: delta,
      reconciliationWarnings: nm.reconciliationWarningCount || 0,
      reconciled: Math.abs(delta) <= Math.max(5, nm.records.length),
    });
    secure.periods.push({
      tag, periodMonth: pm, version: 1,
      sourceSha256: sha256(buf), templateFingerprint: fp.fingerprint, sheetName: nm.sheetName || null,
      columnMap: fp.columnMap,
      records: nm.records.map((r) => ({
        employeeCode: r.employeeCode,
        fullName: r.fullName,
        sourceBranch: (r.fields && r.fields.source_branch) || null,
        salaryGrade: (r.fields && r.fields.salary_grade) || null,
        sourceRowIndex: r.sourceRowIndex,
        fields: r.fields,
        sourceDetail: r.sourceDetail,
        reconciliation: r.reconciliation || [],
      })),
    });
  }
  return { periods, secure };
}

// ---- ACCOUNTING ------------------------------------------------------
async function buildAccounting() {
  const env = loadEnv(path.join(REPO, 'e2e/phf-hr-e2e-db.env'));
  if (env.PHF_HR_DB_HOST !== '127.0.0.1' || !/_e2e$/.test(env.PHF_HR_DB_NAME || '')) throw new Error('e2e/phf-hr-e2e-db.env is not the throwaway');
  const c = new Client({ host: env.PHF_HR_DB_HOST, port: +env.PHF_HR_DB_PORT, database: env.PHF_HR_DB_NAME, user: env.PHF_HR_DB_RUNTIME_USER, password: env.PHF_HR_DB_RUNTIME_PASSWORD });
  await c.connect();
  await c.query('SET ROLE phf_hr_app');
  const q = (s, p) => c.query(s, p).then((r) => r.rows);

  const imp = (await q("SELECT * FROM accounting.import WHERE period_month = '2026-07'"))[0];
  if (!imp) throw new Error('accounting: no 2026-07 import in throwaway');
  const file = (await q('SELECT * FROM accounting.import_file WHERE id = $1', [imp.current_file_id]))[0];
  if (!file || file.status !== 'confirmed') throw new Error('accounting: 2026-07 is not CONFIRMED (status=' + (file && file.status) + ')');

  const normalized = await q("SELECT * FROM accounting.normalized WHERE file_id = $1 ORDER BY source_row_index", [file.id]);
  const decisions = await q("SELECT * FROM accounting.item_decision WHERE file_id = $1 ORDER BY decided_at", [file.id]);
  const rules = await q("SELECT * FROM accounting.classification_rule WHERE origin = 'operator' ORDER BY created_at");
  const ruleHist = await q("SELECT * FROM accounting.rule_history ORDER BY changed_at");
  const dict = (await q("SELECT * FROM accounting.cost_dictionary WHERE is_current = true"))[0];
  const dictEntries = dict ? await q("SELECT * FROM accounting.cost_dictionary_entry WHERE dictionary_id = $1 ORDER BY ma_phi", [dict.id]) : [];
  await c.end();

  const by = { INCLUDE: { n: 0, amt: 0 }, EXCLUDE: { n: 0, amt: 0 }, NEEDS_REVIEW: { n: 0, amt: 0 } };
  const bySource = {};
  for (const r of normalized) {
    by[r.classification].n++; by[r.classification].amt += Number(r.phat_sinh_no);
    bySource[r.decision_source] = (bySource[r.decision_source] || 0) + 1;
  }
  const parity = {
    sourceRows: file.source_row_count, debitRows: file.debit_row_count, costScopeRows: normalized.length,
    include: { rows: by.INCLUDE.n, amount: round0(by.INCLUDE.amt) },
    exclude: { rows: by.EXCLUDE.n, amount: round0(by.EXCLUDE.amt) },
    needsReview: { rows: by.NEEDS_REVIEW.n, amount: round0(by.NEEDS_REVIEW.amt) },
    costScopeAmount: round0(by.INCLUDE.amt + by.EXCLUDE.amt + by.NEEDS_REVIEW.amt),
    operatorDecidedRows: (bySource.operator_item || 0) + (bySource.operator_rule || 0),
    decisionSourceBreakdown: bySource,
    reconciles: (by.INCLUDE.n + by.EXCLUDE.n + by.NEEDS_REVIEW.n) === normalized.length,
  };

  const summary = {
    period: '2026-07',
    fileSha256: file.sha256, ruleVersion: file.rule_version,
    sourceFromDate: file.source_from_date, sourceToDate: file.source_to_date,
    confirmedAt: file.confirmed_at,
    parity,
    costDictionary: dict ? { version: dict.version, sourceSha256: dict.source_sha256, entryCount: dictEntries.length } : null,
    operatorRules: (() => {
      // COMMITTABLE summary carries NO rule text / invoice refs / token lists —
      // only shape + counts. The full auditable rule list lives ONLY in the
      // gitignored secure payload.
      const shaped = rules.map((r) => {
        const mv = typeof r.match_value === 'string' ? JSON.parse(r.match_value) : r.match_value;
        const all = mv.all || [];
        const acc = ((all.find((s) => s.matchKind === 'account_exact') || {}).matchValue || {}).accounts || [];
        const tok = ((all.find((s) => s.matchKind === 'description') || {}).matchValue || {}).allTokens || [];
        return { account: acc[0] || '', decision: r.action, isAccountPlusDescription: !!(acc.length && tok.length), isActive: r.is_active };
      });
      return {
        active: rules.filter((r) => r.is_active).length,
        disabled: rules.filter((r) => !r.is_active).length,
        historyRows: ruleHist.length,
        itemDecisions: decisions.length,
        allAreAccountPlusDescription: shaped.every((s) => s.isAccountPlusDescription),
        accountOnlyRules: shaped.filter((s) => !s.isAccountPlusDescription).length,
        byAccount: shaped.reduce((o, s) => { (o[s.account] = o[s.account] || { INCLUDE: 0, EXCLUDE: 0 })[s.decision]++; return o; }, {}),
      };
    })(),
  };

  const secure = {
    bundleId: BUNDLE_ID, generatedAt: new Date().toISOString(), schemaTarget: 'accounting',
    import: { periodMonth: '2026-07', status: 'active' },
    importFile: {
      periodMonth: '2026-07', version: 1, status: 'confirmed',
      fileName: file.file_name, sha256: file.sha256, byteSize: Number(file.byte_size),
      storageRef: file.storage_ref, sheetName: file.sheet_name,
      sourceFromDate: file.source_from_date, sourceToDate: file.source_to_date, ruleVersion: file.rule_version,
      counters: {
        source_row_count: file.source_row_count, debit_row_count: file.debit_row_count, credit_row_count: file.credit_row_count,
        cost_scope_row_count: file.cost_scope_row_count, included_row_count: file.included_row_count,
        excluded_row_count: file.excluded_row_count, needs_review_row_count: file.needs_review_row_count,
        included_amount: file.included_amount, needs_review_amount: file.needs_review_amount, excluded_amount: file.excluded_amount,
        warning_count: file.warning_count,
      },
      report: file.report,
    },
    normalized: normalized.map((r) => ({
      sourceRowIndex: r.source_row_index, periodMonth: r.period_month,
      ngayCt: r.ngay_ct, maCt: r.ma_ct, soCt: r.so_ct, maKhach: r.ma_khach, tenKhach: r.ten_khach, dienGiai: r.dien_giai,
      taiKhoan: r.tai_khoan, tkDoiUng: r.tk_doi_ung, phatSinhNo: r.phat_sinh_no,
      maBp: r.ma_bp, maBpOutOfMaster: r.ma_bp_out_of_master,
      classification: r.classification, classifiedByRuleId: r.classified_by_rule_id, ruleVersion: r.rule_version,
      costCode: r.cost_code, costCodeStatus: r.cost_code_status, decisionSource: r.decision_source,
      warnings: r.warnings,
    })),
    itemDecisions: decisions.map((r) => ({
      periodMonth: r.period_month, sourceRowIndex: r.source_row_index, taiKhoan: r.tai_khoan, dienGiai: r.dien_giai,
      phatSinhNo: r.phat_sinh_no, decision: r.decision, costCode: r.cost_code, costCodeName: r.cost_code_name,
      rememberedRuleId: r.remembered_rule_id, note: r.note, decidedByName: r.decided_by_name, decidedAt: r.decided_at,
    })),
    operatorRules: rules.map((r) => ({
      id: r.id, priority: r.priority, matchKind: r.match_kind,
      matchValue: typeof r.match_value === 'string' ? JSON.parse(r.match_value) : r.match_value,
      action: r.action, note: r.note, ruleVersion: r.rule_version, isActive: r.is_active,
      origin: r.origin, costCode: r.cost_code, costCodeName: r.cost_code_name, matchSignature: r.match_signature,
      createdByName: r.created_by_name, createdAt: r.created_at, updatedAt: r.updated_at,
    })),
    ruleHistory: ruleHist.map((r) => ({
      ruleId: r.rule_id, action: r.action, snapshot: r.snapshot, reason: r.reason,
      changedByName: r.changed_by_name, changedAt: r.changed_at,
    })),
    costDictionary: dict ? {
      version: dict.version, sourceFileName: dict.source_file_name, sourceSha256: dict.source_sha256,
      entryCount: dictEntries.length, importedByName: dict.imported_by_name, importedAt: dict.imported_at,
      entries: dictEntries.map((e) => ({
        maPhi: e.ma_phi, tenPhi: e.ten_phi, boPhan: e.bo_phan,
        nhom1: e.nhom1, tenNhom1: e.ten_nhom1, nhom2: e.nhom2, tenNhom2: e.ten_nhom2, nhom3: e.nhom3, tenNhom3: e.ten_nhom3, ghiChu: e.ghi_chu,
      })),
    } : null,
  };
  return { summary, secure };
}

// ---- MAIN -----------------------------------------------------------
(async () => {
  const pay = buildPayroll();
  const acc = await buildAccounting();

  const paySecurePath = path.join(OUT_SEC, 'payroll_payload.secure.json');
  const accSecurePath = path.join(OUT_SEC, 'accounting_payload.secure.json');
  fs.writeFileSync(paySecurePath, JSON.stringify(pay.secure, null, 2));
  fs.writeFileSync(accSecurePath, JSON.stringify(acc.secure, null, 2));

  const payPeriods = { bundleId: BUNDLE_ID, schemaTarget: 'payroll', bootstrapPeriods: pay.periods.map((p) => p.periodMonth), periods: pay.periods };
  fs.writeFileSync(path.join(OUT_PUB, 'payroll_periods.json'), JSON.stringify(payPeriods, null, 2));
  fs.writeFileSync(path.join(OUT_PUB, 'accounting_summary.json'), JSON.stringify({ bundleId: BUNDLE_ID, schemaTarget: 'accounting', ...acc.summary }, null, 2));

  const checksums = {
    bundleId: BUNDLE_ID,
    payrollPayloadSha256: sha256(fs.readFileSync(paySecurePath)),
    accountingPayloadSha256: sha256(fs.readFileSync(accSecurePath)),
    payrollPeriodsSha256: sha256(fs.readFileSync(path.join(OUT_PUB, 'payroll_periods.json'))),
    accountingSummarySha256: sha256(fs.readFileSync(path.join(OUT_PUB, 'accounting_summary.json'))),
    payrollSourceSha256: Object.fromEntries(pay.periods.map((p) => [p.periodMonth, p.sourceSha256])),
    accountingSourceSha256: acc.summary.fileSha256,
    costDictionarySha256: acc.summary.costDictionary && acc.summary.costDictionary.sourceSha256,
  };
  fs.writeFileSync(path.join(OUT_PUB, 'checksums.json'), JSON.stringify(checksums, null, 2));

  const manifest = {
    bundleId: BUNDLE_ID,
    generatedAt: new Date().toISOString(),
    generatedFrom: {
      branch: require('child_process').execSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO }).toString().trim(),
      head: require('child_process').execSync('git rev-parse HEAD', { cwd: REPO }).toString().trim(),
      payrollSource: 'docs/payroll-corpus/ (Operator real workbooks, verbatim) via shipped normalizer',
      accountingSource: 'throwaway phf_hr_e2e accounting.* (CONFIRMED period 2026-07)',
    },
    targets: { payrollSchema: 'payroll', accountingSchema: 'accounting', prerequisite: 'qtth foundation schema + Admin/permission_manager grant' },
    contents: {
      payroll: {
        periods: pay.periods.map((p) => p.periodMonth),
        totalNormalizedRows: pay.periods.reduce((s, p) => s + p.normalizedRows, 0),
        canonicalTemplateFingerprint: '82b1b54c2bc2 (T5/T6/T7)',
        payloadFile: 'scripts/qtth-truth-bootstrap/_secure/payroll_payload.secure.json (GITIGNORED — employee salary)',
      },
      accounting: {
        period: '2026-07',
        parity: acc.summary.parity,
        costDictionary: acc.summary.costDictionary,
        operatorRules: { active: acc.summary.operatorRules.active, disabled: acc.summary.operatorRules.disabled, historyRows: acc.summary.operatorRules.historyRows, itemDecisions: acc.summary.operatorRules.itemDecisions },
        payloadFile: 'scripts/qtth-truth-bootstrap/_secure/accounting_payload.secure.json (GITIGNORED — vendor/customer rows)',
      },
    },
    checksums,
    prodWrite: false,
  };
  fs.writeFileSync(path.join(OUT_PUB, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log('PACKAGE BUILT — bundle', BUNDLE_ID);
  console.log('  committable :', path.relative(REPO, OUT_PUB) + '/{manifest,payroll_periods,accounting_summary,checksums}.json');
  console.log('  gitignored  :', path.relative(REPO, paySecurePath), '(' + (fs.statSync(paySecurePath).size / 1024).toFixed(0) + ' KB)');
  console.log('              :', path.relative(REPO, accSecurePath), '(' + (fs.statSync(accSecurePath).size / 1024).toFixed(0) + ' KB)');
  console.log('\npayroll periods:');
  for (const p of pay.periods) console.log('  ', p.periodMonth, 'rows=' + p.normalizedRows, 'fp=' + p.templateFingerprint.slice(0, 12), 'cost=' + p.personnelCostTotal.toLocaleString(), 'Δ=' + p.reconciliationDelta, 'reconciled=' + p.reconciled);
  console.log('\naccounting parity:', JSON.stringify(acc.summary.parity, null, 1));
})().catch((e) => { console.error('BUILD FAILED:', e); process.exit(1); });
