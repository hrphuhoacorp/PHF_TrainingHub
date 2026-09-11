'use strict';
/*
 * PHF HR — QTTH Accounting Data V1 · OFFLINE checks (no DB, no network).
 *
 * Runs the streaming FAST reader + classification engine over the REAL Operator
 * source files in phf-qtth-input/ (gitignored — never committed):
 *   accounting_t07.xlsx   · FAST "Bảng kê chứng từ theo bộ phận" T07/2026
 *   cost_dictionary.xlsx  · FAST "Danh mục phí"
 *
 * Verifies every contract from the handover:
 *   parse · large-file safety (constant memory) · debit-only guard ·
 *   cost-scope · classification · exclusion (911) · unknown preservation ·
 *   out-of-master BP warning · funnel totals · dictionary parse.
 *
 * Run: node scripts/qtth-accounting-v1-offline-checks.js
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const LIB = path.join(REPO, 'services/phf-hr-api/lib');
const { runFunnel } = require(path.join(LIB, 'qtth-accounting-normalize'));
const { parseCostDictionary } = require(path.join(LIB, 'qtth-accounting-dictionary'));
const { SEED_RULES } = require(path.join(LIB, 'qtth-accounting-classify'));

const IN = path.join(REPO, 'phf-qtth-input');
const T07 = path.join(IN, 'accounting_t07.xlsx');
const DICT = path.join(IN, 'cost_dictionary.xlsx');

let P = 0, F = 0;
const ck = (n, c, x) => { c ? (P++, console.log('  PASS  ' + n)) : (F++, console.error('  FAIL  ' + n + (x != null ? '  -> ' + x : ''))); };
const vnd = (x) => Math.round(x).toLocaleString('vi-VN');

(async () => {
  if (!fs.existsSync(T07)) { console.error('MISSING source file: ' + T07); process.exit(2); }

  console.log('QTTH Accounting Data V1 — offline checks\n');
  console.log('== FAST T07 funnel ==');
  const memBefore = process.memoryUsage().heapUsed;
  const buf = fs.readFileSync(T07);
  const { report, normalizedRows, totals, amounts } = await runFunnel(buf, { rules: SEED_RULES });
  const memPeak = process.memoryUsage().heapUsed;

  const T = report.totals;
  console.log(JSON.stringify(report.totals, null, 1));
  console.log('amounts:', JSON.stringify(report.amounts, null, 1));

  // ---- baseline (matches the 2026-09-09 audit report) ---------------------
  ck('source rows = 85975', T.sourceRows === 85975, T.sourceRows);
  ck('debit rows = 38768', T.debitRows === 38768, T.debitRows);
  ck('credit rows = 38768', T.creditRows === 38768, T.creditRows);
  ck('cost-scope rows (641*/642* debit) = 350', T.costScopeRows === 350, T.costScopeRows);
  ck('unique cost accounts = 36', T.uniqueCostAccounts === 36, T.uniqueCostAccounts);
  ck('cost-scope amount = 1,048,747,679', report.amounts.costScope === 1048747679, vnd(report.amounts.costScope));

  // ---- debit-only / double-count guard ----------------------------------
  ck('every normalized row is debit-side (phatSinhNo > 0)', normalizedRows.every((r) => r.phatSinhNo > 0));
  ck('no normalized row has contra 911 (closing entry excluded from INCLUDE/REVIEW)',
    !normalizedRows.some((r) => /^911/.test(r.tkDoiUng || '') && r.classification !== 'EXCLUDE'));
  ck('included + excluded + needsReview === costScopeRows',
    T.included + T.excluded + T.needsReview === T.costScopeRows,
    `${T.included}+${T.excluded}+${T.needsReview}`);
  ck('included + needsReview amount ≈ costScope - excluded (VND, no rounding drift > 1)',
    Math.abs((amounts.included + amounts.needsReview + amounts.excluded) - amounts.costScope) < 1);

  // ---- classification engine ------------------------------------------
  const REVIEW8 = ['6414', '6422', '6423', '64177', '64178', '64188', '64273', '64274'];
  const byAcct = new Map(normalizedRows.map((r) => [r.taiKhoan, r]));
  ck('all 8 audited out-of-reference accounts classified NEEDS_REVIEW',
    REVIEW8.every((a) => !byAcct.has(a) || normalizedRows.filter((r) => r.taiKhoan === a).every((r) => r.classification === 'NEEDS_REVIEW')),
    REVIEW8.filter((a) => byAcct.has(a) && normalizedRows.some((r) => r.taiKhoan === a && r.classification !== 'NEEDS_REVIEW')).join(','));
  ck('64111 (BC Mã số 9.1) classified INCLUDE',
    normalizedRows.filter((r) => r.taiKhoan === '64111').every((r) => r.classification === 'INCLUDE'));
  ck('64121 (BC Mã số 9.8, 105 rows) classified INCLUDE',
    normalizedRows.filter((r) => r.taiKhoan === '64121').every((r) => r.classification === 'INCLUDE'));

  // ---- unknown preservation (never dropped) --------------------------
  ck('NEEDS_REVIEW rows > 0 and all retained with amount',
    T.needsReview > 0 && normalizedRows.filter((r) => r.classification === 'NEEDS_REVIEW').every((r) => r.phatSinhNo > 0));
  ck('NEEDS_REVIEW account list is exactly the audited 8 (or subset present in T07)',
    report.needsReviewAccounts.every((a) => REVIEW8.indexOf(a.account) >= 0),
    report.needsReviewAccounts.map((a) => a.account).join(','));

  // ---- out-of-master department --------------------------------------
  ck('PHF-MKT flagged out-of-master (kept, not dropped)',
    T.outOfMasterDepartments.indexOf('PHF-MKT') >= 0 &&
    normalizedRows.some((r) => r.maBp === 'PHF-MKT' && r.maBpOutOfMaster === true),
    JSON.stringify(T.outOfMasterDepartments));
  ck('a PHF-MKT row survives into normalized (KEEP + WARN)',
    normalizedRows.some((r) => r.maBp === 'PHF-MKT'));

  // ---- large-file safety --------------------------------------------
  const grewMB = (memPeak - memBefore) / 1048576;
  ck('streaming parse did not blow heap (<120 MB growth for a 73 MB sheet)', grewMB < 120, grewMB.toFixed(1) + ' MB');
  ck('normalized rows kept small (< 1000, NOT ~86k) — RAW_ROWS_SAVED_AS_FACT=0', normalizedRows.length < 1000, normalizedRows.length);

  // ---- provenance --------------------------------------------------
  ck('every normalized row carries source_row_index + verbatim FAST fields',
    normalizedRows.every((r) => Number.isFinite(r.sourceRowIndex) && r.taiKhoan && typeof r.dienGiai === 'string'));
  ck('report declares rawRowsSavedAsFact = 0', report.rawRowsSavedAsFact === 0);

  // ---- cost dictionary --------------------------------------------
  console.log('\n== Cost Dictionary ==');
  if (fs.existsSync(DICT)) {
    const d = parseCostDictionary(fs.readFileSync(DICT));
    console.log('  entries =', d.entries.length, ' groups(Nhóm1) =', [...new Set(d.entries.map((e) => e.nhom1))].join(','));
    ck('cost dictionary parsed = 170 entries', d.entries.length === 170, d.entries.length);
    ck('every entry has Mã phí', d.entries.every((e) => e.maPhi));
    ck('no cost dictionary code looks like a real account (join key absent — §12)',
      !d.entries.some((e) => /^64(1|2)\d{2}$/.test(e.maPhi)));
  } else {
    console.log('  (cost_dictionary.xlsx not present — skipped)');
  }

  // ---- FINAL numbers block (handover §24) --------------------------
  console.log('\n================ ACCOUNTING_DATA_V1 — ACTUAL T07 (offline engine) ================');
  console.log('ACCOUNTING_T07_SOURCE_ROWS      =', T.sourceRows);
  console.log('ACCOUNTING_T07_DEBIT_ROWS       =', T.debitRows);
  console.log('ACCOUNTING_T07_COST_SCOPE_ROWS  =', T.costScopeRows);
  console.log('ACCOUNTING_T07_INCLUDED         =', T.included, ' amount =', vnd(amounts.included));
  console.log('ACCOUNTING_T07_EXCLUDED         =', T.excluded, ' amount =', vnd(amounts.excluded));
  console.log('ACCOUNTING_T07_NEEDS_REVIEW     =', T.needsReview, ' amount =', vnd(amounts.needsReview));
  console.log('UNIQUE_COST_ACCOUNTS           =', T.uniqueCostAccounts);
  console.log('UNIQUE_DEPARTMENTS             =', T.uniqueDepartments);
  console.log('OUT_OF_MASTER_DEPARTMENTS      =', JSON.stringify(T.outOfMasterDepartments));
  console.log('TOTAL_INCLUDED_AMOUNT          =', vnd(amounts.included));
  console.log('TOTAL_REVIEW_AMOUNT            =', vnd(amounts.needsReview));
  console.log('NEEDS_REVIEW ACCOUNTS          =');
  for (const a of report.needsReviewAccounts) console.log('   ', a.account.padEnd(8), String(a.rows).padStart(4), vnd(a.amount).padStart(16), ' ', a.note || '');
  console.log('================================================================================');

  console.log(`\n${P} passed, ${F} failed`);
  process.exit(F ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(3); });
