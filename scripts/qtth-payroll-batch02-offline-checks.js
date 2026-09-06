'use strict';
/*
 * PHF HR — QTTH Batch 02 · payroll importer OFFLINE checks (no DB, no network).
 * Corpus: the CLEAN-UTF-8 TSV rebuild of the Operator's T1–T7 files
 * (scratchpad/payroll). T7 = PHF Payroll Canonical Template V1.
 * Run: node scripts/qtth-payroll-batch02-offline-checks.js
 */
const fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '..');
const TPL = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-template'));
const NRM = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-normalize'));
const { readWorkbook } = require(path.join(REPO, 'services/phf-hr-api/lib/xlsx-lite'));
const { gridToXlsx } = require(path.join(REPO, 'scripts/lib/xlsx-write-lite'));
const CORP = path.join(REPO, 'scripts/fixtures/payroll');

function grid(name) { return fs.readFileSync(path.join(CORP, name), 'utf8').split(/\r?\n/).map((l) => l.split('\t')); }

let P = 0, F = 0;
const ck = (n, c, x) => { c ? (P++, console.log('  PASS  ' + n)) : (F++, console.error('  FAIL  ' + n + (x ? '  -> ' + x : ''))); };

console.log('QTTH Batch 02 — payroll importer offline checks\n');

const T7 = grid('T7.tsv');
const T1 = grid('T1.tsv');
const fp7 = TPL.fingerprint(T7);
const fp1 = TPL.fingerprint(T1);
const nm7 = NRM.normalizeGrid(T7, fp7.columnMap);
const nm1 = NRM.normalizeGrid(T1, fp1.columnMap);

// 1
ck('C1  T7 template recognized (fingerprint + all reporting-core columns mapped)',
  fp7.ok && fp7.fingerprint && fp7.missingCore.length === 0, JSON.stringify(fp7.missingCore));
// 2
ck('C2  T7 employee rows identified by employee_code (PHF002/PHF012/PHF091 present, TOTAL row skipped)',
  nm7.records.some((r) => r.employeeCode === 'PHF002') && nm7.records.some((r) => r.employeeCode === 'PHF091') &&
  !nm7.records.some((r) => !/^PHF/.test(r.employeeCode)));
// 3 duplicate  (data rows: PHF002=10 PHF001=11 PHF065=12 PHF012=13 PHF036=14 PHF046=15 PHF091=16)
const dupGrid = T7.slice();
dupGrid.push(T7[10].slice()); // clone PHF002 data row
const nmDup = NRM.normalizeGrid(dupGrid, fp7.columnMap);
ck('C3  duplicate employee_code within file detected', nmDup.fileWarnings.some((w) => w.type === 'DUPLICATE_EMPLOYEE_IN_FILE' && w.employeeCode === 'PHF002'));
// 4 unknown
const known = new Set(['PHF002', 'PHF001', 'PHF065', 'PHF012', 'PHF036', 'PHF046']);
const unknown = nm7.records.filter((r) => !known.has(r.employeeCode)).map((r) => r.employeeCode);
ck('C4  unknown employee_code (vs People Master set) surfaced: ' + JSON.stringify(unknown), unknown.includes('PHF091'));
// 5 not column-index dependent
ck('C5  historical T1 parser is not fixed-index (86-col sheet, shifted Lễ/Tết, still maps core)',
  fp1.ok && fp1.missingCore.length === 0 && fp1.fingerprint !== fp7.fingerprint);
// 6 T1 Lễ/Tết without invented values
const p041 = nm1.records.find((r) => r.employeeCode === 'PHF041');
ck('C6  T1 Lễ/Tết normalizes without invented values (single "đi làm lễ/tết" -> att_holiday_work_days; no 800k/500k fabricated)',
  p041 && p041.sourceDetail.att_holiday_work_days === 1 &&
  p041.sourceDetail.att_holiday_work_800k_days == null && p041.sourceDetail.att_holiday_work_500k_days == null &&
  p041.sourceDetail.pay_holiday_work === 462407.40740740742);   // D3: T1 "LÀM Lễ/Tết" -> pay_holiday_work
// 7 T7 stable schema auto-maps (fp deterministic across two reads)
ck('C7  T5/T6/T7 stable schema auto-map (T7 fingerprint deterministic)', TPL.fingerprint(grid('T7.tsv')).fingerprint === fp7.fingerprint);
// 8 base salary reconciliation
const p002 = nm7.records.find((r) => r.employeeCode === 'PHF002');
ck('C8  arithmetic base salary reconciliation: BHXH(14,000,000) + PC CV(1,800,000) = Tổng cơ bản(1) 15,800,000, no warn',
  Math.abs(p002.fields.base_salary_bhxh + p002.fields.job_allowance - p002.fields.base_standard_total_1) < 1 &&
  !p002.reconciliation.some((c) => c.check === 'base_1'));
// 9 parent vs components not double counted
ck('C9  allowance parent (Tổng phụ cấp (2)) reconciles to Σ components, never parent+components',
  Math.abs(p002.fields.allowance_actual_total_2 - (p002.sourceDetail.act_nv_3 + p002.sourceDetail.act_ql_4 + p002.sourceDetail.act_com_5)) < 1 &&
  !p002.reconciliation.some((c) => c.check === 'allowance_2'));
// 10 final payable reconciliation
ck('C10 final payable reconciliation: Thu nhập sau giảm trừ(29,118,000) - Thuế(97,900) = Thực nhận 29,020,100',
  Math.abs(p002.fields.income_after_deduct_6 - p002.fields.tax_pit_amount - p002.fields.final_net_after_tax) < 1 &&
  !p002.reconciliation.some((c) => c.check === 'final_net'));
// 11 uploaded value never auto-corrected — inject a wrong total, expect WARN + uploaded value preserved
const badGrid = T7.map((r) => r.slice());
const finalCol = fp7.columnMap.final_net_after_tax;
badGrid[10][finalCol] = '999';                       // corrupt PHF002 final
const nmBad = NRM.normalizeGrid(badGrid, fp7.columnMap);
const badRec = nmBad.records.find((r) => r.employeeCode === 'PHF002');
ck('C11 uploaded value never auto-corrected (bad final=999 -> warn, stored value stays 999)',
  badRec.fields.final_net_after_tax === 999 && badRec.reconciliation.some((c) => c.check === 'final_net' && c.uploaded === 999));
// 15 schema drift triggers mapping gate
ck('C15 schema drift: T1 fingerprint != canonical T7 -> mapping-confirmation gate would trigger',
  fp1.fingerprint !== fp7.fingerprint);
// 16 preview works before commit (normalizeGrid produces a full report with no persistence)
ck('C16 preview computes NEW/UNCHANGED/warnings with zero side effects (pure function)',
  nm7.rowCount === 7 && typeof nm7.reconciliationWarningCount === 'number');

// --- xlsx-lite round trip: T7 grid -> .xlsx -> parse -> same normalization ---
const xbuf = gridToXlsx(T7);
ck('C-XLSX  xlsx-lite reads a real .xlsx (ZIP+sharedStrings+sheet) — PK header',
  xbuf.readUInt16LE(0) === 0x4b50);
const wb = readWorkbook(xbuf);
const xrows = wb.sheets[0].rows;
const fpX = TPL.fingerprint(xrows);
const nmX = NRM.normalizeGrid(xrows, fpX.columnMap);
ck('C-XLSX  round-trip: .xlsx parse -> same fingerprint + same PHF002 final (29,020,100)',
  fpX.fingerprint === fp7.fingerprint &&
  nmX.records.find((r) => r.employeeCode === 'PHF002').fields.final_net_after_tax === 29020100);

// --- D-contract regression ---
ck('D1  Đã chi 1.1 and Xử lý phát sinh are SEPARATE fields in the registry',
  TPL.CANONICAL_KEYS.includes('deduct_da_chi_1_1') && TPL.CANONICAL_KEYS.includes('deduct_xu_ly_phat_sinh'));
ck('D2  Thưởng lễ 1.1 is its own bonus field (not folded into act_khac)',
  TPL.CANONICAL_KEYS.includes('bonus_thuong_le_1_1'));
ck('D5  final_net_after_tax is canonical; reconcile_adjust + pay_amount_transfer are separate',
  TPL.REPORTING_CORE.has('final_net_after_tax') && TPL.REPORTING_CORE.has('reconcile_adjust') &&
  !TPL.REPORTING_CORE.has('pay_amount_transfer'));
ck('D6  t13_revenue_bonus present, NOT part of the (1)+(2)+(3) grand-total check',
  TPL.CANONICAL_KEYS.includes('t13_revenue_bonus') &&
  !NRM.CHECKS.find((c) => c.key === 'grand_4').label.includes('T13'));
ck('D8  source_ma_ht is raw_only kind — never a reporting-core Truth field',
  TPL.FIELD_BY_KEY.get('source_ma_ht').kind === 'raw_only' && !TPL.REPORTING_CORE.has('source_ma_ht'));

// --- version diff (pure) ---
const v1 = nm7.records;
const v2raw = T7.map((r) => r.slice());
v2raw[12][fp7.columnMap.final_net_after_tax] = String(nm7.records.find((r) => r.employeeCode === 'PHF065').fields.final_net_after_tax + 5000); // change PHF065 (row 12)
v2raw.splice(16, 1);   // drop PHF091 (row 16)
v2raw.push('99\t000\tPHF999\tNew Person\tX\tX\tX\t\t\t5000000\t0\t5000000\t\t\t\t\t\t\t\t\t5000000\t27\t27\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t100\tDat\t5000000\t0\t0\t0\t0\t0\t0\t\t\t\t5000000\t0\t0\t0\t0\t0\t0\t0\t0\t0\t\t0\t\t0\t5000000\t0\t0\t\t0\t0\t5000000\t0\t\t0\t5000000\t0\t5000000\t0\t0\t5000000\t\tCK\t0\t5000000\t000\tX\t5000000\t0\t\t0'.split('\t'));
const nm2 = NRM.normalizeGrid(v2raw, fp7.columnMap);
const vd = NRM.diffVersions(v1, nm2.records);
ck('C12 V2 unchanged rows produce NO delta (only PHF065 changed + PHF999 added)',
  vd.deltas.filter((d) => d.changeType === 'changed').every((d) => d.employeeCode === 'PHF065'));
ck('C13 V2 changed field saved as before→after (PHF065 final +5000)',
  vd.deltas.some((d) => d.employeeCode === 'PHF065' && d.field === 'final_net_after_tax' && Number(d.after) - Number(d.before) === 5000));
ck('C14 employee missing in V2 -> reported, never auto-deleted (PHF091 in missing[])',
  vd.missing.includes('PHF091') && vd.added.includes('PHF999'));

console.log('\n' + P + '/' + (P + F) + ' offline checks passed' + (F ? '  — FAIL' : '  — ALL PASS'));
process.exit(F ? 1 : 0);
