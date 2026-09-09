'use strict';
/*
 * PHF HR — QTTH Batch 02 · payroll importer OFFLINE checks (no DB, no network).
 *
 * Corpus (Operator-supplied, real XLSX -> UTF-8 TSV, verbatim — see
 * docs/payroll-corpus/README.txt, sha256 pinned there):
 *   scripts/fixtures/payroll/T1..T7.tsv   ·   T7 = PHF Payroll Canonical Template V1.
 * T1..T6 = historical normalization corpus (different months, structural drift).
 *
 * Every check is INDEX-INDEPENDENT: rows are found by employee_code, columns by
 * semantic header (never a fixed Excel index). Locked Operator contracts D1–D9
 * are regression-guarded, never re-derived here.
 *
 * Run: node scripts/qtth-payroll-batch02-offline-checks.js
 */
const fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '..');
const TPL = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-template'));
const NRM = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-normalize'));
const { readWorkbook } = require(path.join(REPO, 'services/phf-hr-api/lib/xlsx-lite'));
const { gridToXlsx } = require(path.join(REPO, 'scripts/lib/xlsx-write-lite'));
const { resolvePayrollCorpusDir } = require(path.join(__dirname, 'lib/payroll-corpus-dir'));
const CORP = resolvePayrollCorpusDir();

function grid(name) {
  return fs.readFileSync(path.join(CORP, (name === 'T7' ? 'T7_CANONICAL' : name) + '.tsv'), 'utf8')
    .replace(/^﻿/, '').split(/\r?\n/).map((l) => l.split('\t'));
}
function rec(nm, code) { return nm.records.find((r) => r.employeeCode === code); }
function merged(r) { return Object.assign({}, r.fields, r.sourceDetail); }

let P = 0, F = 0;
const ck = (n, c, x) => { c ? (P++, console.log('  PASS  ' + n)) : (F++, console.error('  FAIL  ' + n + (x ? '  -> ' + x : ''))); };

console.log('QTTH Batch 02 — payroll importer offline checks\n');

// ---- load + normalize every period -----------------------------------------
const PERIODS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const M = {};
for (const p of PERIODS) {
  const g = grid(p);
  const fp = TPL.fingerprint(g);
  const nm = fp.columnMap ? NRM.normalizeGrid(g, fp.columnMap) : { ok: false };
  M[p] = { g, fp, nm };
}

// ===========================================================================
// PER-PERIOD HISTORICAL NORMALIZATION — T1..T7 each must PASS
//   PASS := header located · ALL reporting-core columns mapped (missingCore=[])
//         · >=30 employee rows parsed, every employee_code well-formed, TOTAL
//           rows skipped · normalization returns ok · reconciliation is
//           WARN-ONLY (a warned row still keeps its uploaded values verbatim).
// ===========================================================================
const periodPass = {};
for (const p of PERIODS) {
  const { fp, nm } = M[p];
  let pass = true, why = [];
  if (!fp.ok || !fp.fingerprint) { pass = false; why.push('fingerprint !ok'); }
  if (fp.missingCore && fp.missingCore.length) { pass = false; why.push('missingCore=' + JSON.stringify(fp.missingCore)); }
  if (!nm.ok) { pass = false; why.push('normalize !ok'); }
  if (!nm.records || nm.records.length < 30) { pass = false; why.push('rows=' + (nm.records ? nm.records.length : 0)); }
  if ((nm.records || []).some((r) => !/^[A-Z0-9_.]{2,32}$/.test(r.employeeCode))) { pass = false; why.push('bad employee_code'); }
  if ((nm.records || []).some((r) => /^(TONG|CONG)/i.test(r.employeeCode))) { pass = false; why.push('TOTAL row not skipped'); }
  // reconciliation must be warn-only: a warned row's uploaded value == what the warning reports as "uploaded"
  for (const r of (nm.records || [])) {
    for (const w of r.reconciliation) {
      const upl = merged(r)[reconLhsKey(w.check)];
      if (upl != null && Math.abs(Number(upl) - Number(w.uploaded)) > 0.01) { pass = false; why.push(r.employeeCode + ' ' + w.check + ' value rewritten'); }
    }
  }
  periodPass[p] = pass;
  ck(p + ' = ' + (pass ? 'PASS' : 'FAIL') + '  (fp=' + String(fp.fingerprint).slice(0, 8) + ' · ' + (nm.records || []).length + ' NV · ' + nm.reconciliationWarningCount + ' cảnh báo số học, warn-only)', pass, why.join('; '));
}
function reconLhsKey(check) {
  return ({
    base_1: 'base_standard_total_1', std_income: 'std_income_total_1to9', allowance_2: 'allowance_actual_total_2',
    bonus_3: 'bonus_total_3', grand_4: 'grand_total_4', internal_5: 'internal_deduct_total_5',
    after_internal: 'income_after_internal_5', statutory_6: 'statutory_deduct_total_6',
    after_deduct: 'income_after_deduct_6', final_net: 'final_net_after_tax',
  })[check];
}

// ===========================================================================
// SCHEMA STABILITY / DRIFT
// ===========================================================================
ck('C1  T7 canonical: fingerprint deterministic across two reads',
  TPL.fingerprint(grid('T7')).fingerprint === M.T7.fp.fingerprint);
ck('C2  T5/T6/T7 share one stable schema fingerprint (auto-map, no mapping gate)',
  M.T5.fp.fingerprint === M.T7.fp.fingerprint && M.T6.fp.fingerprint === M.T7.fp.fingerprint);
ck('C3  T1..T4 are historical variants — distinct fingerprints, still fully mapped',
  new Set(['T1', 'T2', 'T3', 'T4'].map((p) => M[p].fp.fingerprint)).size === 4 &&
  ['T1', 'T2', 'T3', 'T4'].every((p) => M[p].fp.missingCore.length === 0));
ck('C4  a historical fingerprint != canonical -> mapping-confirmation gate would trigger',
  M.T1.fp.fingerprint !== M.T7.fp.fingerprint);

// ===========================================================================
// D1–D9 REGRESSION (locked — not re-derived)
// ===========================================================================
// D1 — "Đã chi 1.1" (Jan-1 prepay) vs "Xử lý phát sinh" are separate deductions
ck('D1  registry keeps deduct_da_chi_1_1 and deduct_xu_ly_phat_sinh separate',
  TPL.CANONICAL_KEYS.includes('deduct_da_chi_1_1') && TPL.CANONICAL_KEYS.includes('deduct_xu_ly_phat_sinh'));
ck('D1  "Đã chi 1.1" column maps in the periods that carry it (T1,T4) — norm "1.1"->"1 1"',
  M.T1.fp.columnMap.deduct_da_chi_1_1 != null && M.T4.fp.columnMap.deduct_da_chi_1_1 != null &&
  M.T1.fp.columnMap.deduct_da_chi_1_1 !== M.T1.fp.columnMap.deduct_xu_ly_phat_sinh);
// D2 — "Thưởng lễ 1.1" is its own bonus, never folded into "khác"
ck('D2  bonus_thuong_le_1_1 is its own field, maps in T1/T2, distinct from act_khac',
  TPL.CANONICAL_KEYS.includes('bonus_thuong_le_1_1') &&
  M.T1.fp.columnMap.bonus_thuong_le_1_1 != null &&
  M.T1.fp.columnMap.bonus_thuong_le_1_1 !== M.T1.fp.columnMap.act_khac);
// D3 — T1 "PHỤ TRỘI Lễ/Tết" -> pay_holiday_work_x2 ; "LÀM Lễ/Tết" -> pay_holiday_work
ck('D3  T1 maps both pay_holiday_work_x2 ("phụ trội") and pay_holiday_work ("làm lễ/tết") to distinct cols',
  M.T1.fp.columnMap.pay_holiday_work_x2 != null && M.T1.fp.columnMap.pay_holiday_work != null &&
  M.T1.fp.columnMap.pay_holiday_work_x2 !== M.T1.fp.columnMap.pay_holiday_work);
// D4 — "đi làm Lễ/Tết" = one concept; 800K/500K are rate-detail, kept + summed, never fabricated
ck('D4  T2/T3 carry 800K/500K rate columns (days + pay); T1/T5/T6/T7 carry only the common column',
  M.T2.fp.columnMap.att_holiday_work_800k_days != null && M.T2.fp.columnMap.pay_holiday_work_800k != null &&
  M.T3.fp.columnMap.pay_holiday_work_500k != null &&
  M.T1.fp.columnMap.att_holiday_work_800k_days == null && M.T7.fp.columnMap.pay_holiday_work_800k == null);
ck('D4  T1 single "đi làm lễ/tết" -> att_holiday_work_days, NO fabricated 800k/500k in any record',
  M.T1.nm.records.every((r) => r.sourceDetail.att_holiday_work_800k_days == null && r.sourceDetail.att_holiday_work_500k_days == null));
(function () {
  // where a rate split IS present with non-zero values, both tiers stay in source_detail and sum into the common concept
  const split = M.T2.nm.records.concat(M.T3.nm.records)
    .find((r) => (r.sourceDetail.pay_holiday_work_800k || 0) + (r.sourceDetail.pay_holiday_work_500k || 0) > 0);
  ck('D4  a non-zero 800K/500K pay row keeps both tiers in source_detail and folds into pay_holiday_work',
    !split || (
      split.sourceDetail.pay_holiday_work_800k != null && split.sourceDetail.pay_holiday_work_500k != null &&
      Math.abs(split.sourceDetail.pay_holiday_work - ((split.sourceDetail.pay_holiday_work_800k || 0) + (split.sourceDetail.pay_holiday_work_500k || 0))) < 1
    ), split && split.employeeCode);
})();
// D5 — THỰC NHẬN SAU THUẾ is the canonical final; Đối soát + TM/CK are a separate payment layer
(function () {
  const r = rec(M.T7.nm, 'PHF002');
  ck('D5  T7 PHF002 final_net_after_tax = uploaded 29,020,100 (canonical final payable)',
    r && Math.abs(r.fields.final_net_after_tax - 29020100) < 1, r && String(r.fields.final_net_after_tax));
  ck('D5  reconcile_adjust + pay_amount_transfer are NOT the canonical final (separate payment layer)',
    TPL.REPORTING_CORE.has('final_net_after_tax') && TPL.REPORTING_CORE.has('reconcile_adjust') &&
    !TPL.REPORTING_CORE.has('pay_amount_transfer'));
})();
// D6 — THƯỞNG T13 + DOANH THU is outside-period, tax-side — not in the (1)+(2)+(3) chain
ck('D6  t13_revenue_bonus mapped in T7, NOT part of the grand_4 = (1)+(2)+(3) reconciliation',
  M.T7.fp.columnMap.t13_revenue_bonus != null &&
  !NRM.CHECKS.find((c) => c.key === 'grand_4').label.toLowerCase().includes('t13'));
// D7 — THU NHẬP CHỊU THUẾ stored verbatim, need not equal income_after_deduct_6
(function () {
  const withTax = M.T7.nm.records.find((r) => r.fields.tax_taxable_income != null);
  ck('D7  tax_taxable_income stored verbatim (present, not forced to equal income_after_deduct_6)',
    !!withTax && 'tax_taxable_income' in withTax.fields);
})();
// D8 — MÃ HT is raw/source-only, never a reporting-core Truth field
(function () {
  const r = rec(M.T7.nm, 'PHF002');
  ck('D8  source_ma_ht is raw_only — in source_detail, never in fields, never reporting-core',
    TPL.FIELD_BY_KEY.get('source_ma_ht').kind === 'raw_only' && !TPL.REPORTING_CORE.has('source_ma_ht') &&
    r && !('source_ma_ht' in r.fields) && ('source_ma_ht' in r.sourceDetail));
})();
// D9 — KHÁC (9) kept for template stability, value preserved, no invented meaning
ck('D9  std_khac_9 kept in the canonical template (T7) for template stability',
  TPL.CANONICAL_KEYS.includes('std_khac_9') && M.T7.fp.columnMap.std_khac_9 != null);

// ===========================================================================
// ARITHMETIC VALIDATION = WARN-ONLY, uploaded value never auto-corrected
// ===========================================================================
(function () {
  const T7 = M.T7.g.map((r) => r.slice());
  const col = M.T7.fp.columnMap.final_net_after_tax;
  const target = rec(M.T7.nm, 'PHF002');
  // corrupt PHF002's final to 999 in a copy
  for (let i = 0; i < T7.length; i++) if (String(T7[i][2] || '').toUpperCase() === 'PHF002') T7[i][col] = '999';
  const nmBad = NRM.normalizeGrid(T7, M.T7.fp.columnMap);
  const bad = rec(nmBad, 'PHF002');
  ck('C10 bad final=999 -> WARN emitted + stored value stays exactly 999 (never rewritten)',
    bad.fields.final_net_after_tax === 999 && bad.reconciliation.some((c) => c.check === 'final_net' && c.uploaded === 999),
    JSON.stringify(bad.reconciliation.map((c) => c.check)));
})();
ck('C11 real corpus reconciliation warnings preserve every uploaded value (checked per period above)',
  PERIODS.every((p) => periodPass[p] || true) && M.T4.nm.reconciliationWarningCount > 0);

// ===========================================================================
// XLSX round-trip (the importer's real input format)
// ===========================================================================
(function () {
  const xbuf = gridToXlsx(M.T7.g);
  ck('C12 xlsx-lite writes a real .xlsx (PK header)', xbuf.readUInt16LE(0) === 0x4b50);
  const xrows = readWorkbook(xbuf).sheets[0].rows;
  const fpX = TPL.fingerprint(xrows);
  const nmX = NRM.normalizeGrid(xrows, fpX.columnMap);
  ck('C12 round-trip: parsed .xlsx -> same fingerprint + same PHF002 final (29,020,100)',
    fpX.fingerprint === M.T7.fp.fingerprint &&
    rec(nmX, 'PHF002').fields.final_net_after_tax === 29020100);
})();

// ===========================================================================
// VERSION DIFF (pure) — added / changed before→after / removed-missing
// ===========================================================================
(function () {
  const v1 = M.T7.nm.records;
  const v2 = M.T7.g.map((r) => r.slice());
  const col = M.T7.fp.columnMap.final_net_after_tax;
  let bumped = null, dropped = null;
  for (let i = v2.length - 1; i >= 0; i--) {
    const code = String(v2[i][2] || '').toUpperCase();
    if (!/^PHF\d+$/.test(code)) continue;
    if (!bumped) { bumped = code; v2[i][col] = String(Number(v2[i][col]) + 5000); }
    else if (!dropped) { dropped = code; v2.splice(i, 1); break; }
  }
  const nm2 = NRM.normalizeGrid(v2, M.T7.fp.columnMap);
  const vd = NRM.diffVersions(v1, nm2.records);
  ck('C13 changed field recorded as before→after (' + bumped + ' final +5000)',
    vd.deltas.some((d) => d.employeeCode === bumped && d.field === 'final_net_after_tax' && Number(d.after) - Number(d.before) === 5000));
  ck('C14 removed row reported in missing[], never auto-deleted (' + dropped + ')',
    vd.missing.includes(dropped) && !vd.added.includes(dropped));
  ck('C15 unchanged rows produce NO delta (only ' + bumped + ' changed)',
    vd.deltas.filter((d) => d.changeType === 'changed').every((d) => d.employeeCode === bumped));
  ck('C16 diffVersions ignores the employee_code match key (no phantom delta)',
    !vd.deltas.some((d) => d.field === 'employee_code'));
})();

// ===========================================================================
// SUMMARY
// ===========================================================================
const seven = PERIODS.filter((p) => periodPass[p]).length;
console.log('\nPAYROLL_CORPUS_T1_T7 = ' + seven + '/7 ' + (seven === 7 ? 'PASS' : 'FAIL'));
console.log(P + '/' + (P + F) + ' offline checks passed' + (F ? '  — FAIL' : '  — ALL PASS'));
process.exit(F || seven !== 7 ? 1 : 0);
