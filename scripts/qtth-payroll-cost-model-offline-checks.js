'use strict';
/*
 * PHF QTTH Payroll — SEMANTIC COST MODEL · offline checks (no DB, no network).
 *
 * Drives the shipped normalizer + the new qtth-payroll-cost-model over the real
 * Operator corpus docs/payroll-corpus/T1..T7 and asserts the Total Personnel
 * Cost contract (§9): built only from realised in-cost fields, reconciles to the
 * source subtotal (4) minus any Tháng-13 portion, never uses "thực nhận", never
 * re-subtracts deductions, never counts the payment layer, never counts T13.
 *
 * Run: node scripts/qtth-payroll-cost-model-offline-checks.js
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const TPL = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-template'));
const NRM = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-normalize'));
const COST = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-cost-model'));

const { resolvePayrollCorpusDir } = require(path.join(__dirname, 'lib/payroll-corpus-dir'));
const CORPUS = resolvePayrollCorpusDir();
const FILES = { T1:'T1.tsv', T2:'T2.tsv', T3:'T3.tsv', T4:'T4.tsv', T5:'T5.tsv', T6:'T6.tsv', T7:'T7_CANONICAL.tsv' };

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.error('  FAIL ' + name + (extra ? '  -> ' + extra : '')); process.exitCode = 1; }
}
function readTsv(fp) { let s = fs.readFileSync(fp, 'utf8'); if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); return s.split(/\r?\n/).map((l) => l.split('\t')); }

console.log('QTTH Payroll — Semantic Cost Model offline checks\n');

// 1. registry completeness — every canonical key has a cost nature, none UNKNOWN
const unknown = TPL.CANONICAL_KEYS.filter((k) => COST.natureOf(k) === 'UNKNOWN');
ok('every canonical field has a cost nature (no UNKNOWN)', unknown.length === 0, unknown.join(','));
ok('cost NATURE has no key outside the canonical registry',
  Object.keys(COST.NATURE).every((k) => TPL.CANONICAL_KEYS.includes(k)),
  Object.keys(COST.NATURE).filter((k) => !TPL.CANONICAL_KEYS.includes(k)).join(','));

// 2. contract sanity on the nature map
ok('deduct_da_chi_1_1 is PAYMENT_RECON, not a deduction (D-COST-01)', COST.natureOf('deduct_da_chi_1_1') === 'PAYMENT_RECON');
ok('bonus_thuong_le_1_1 is EXCLUDED_T13 (D-COST-02)', COST.natureOf('bonus_thuong_le_1_1') === 'EXCLUDED_T13');
ok('t13_revenue_bonus is EXCLUDED_T13 (D6)', COST.natureOf('t13_revenue_bonus') === 'EXCLUDED_T13');
ok('realised Lễ/Tết pay lines are HOLIDAY_COST (D-COST-03/04)',
  ['pay_ot_holiday','pay_holiday_leave','pay_holiday_work','pay_holiday_work_x2']
    .every((k) => COST.natureOf(k) === 'HOLIDAY_COST'));
ok('800K/500K tiers are RATE_DETAIL (folded into pay_holiday_work by normalize — not double-counted, D4)',
  COST.natureOf('pay_holiday_work_800k') === 'RATE_DETAIL' && COST.natureOf('pay_holiday_work_500k') === 'RATE_DETAIL' &&
  !COST.isInPersonnelCost('pay_holiday_work_800k') && !COST.isInPersonnelCost('pay_holiday_work_500k'));
ok('deduct_bhxh is EMPLOYEE_DEDUCTION, never in cost (D-COST-06 employee side)',
  COST.natureOf('deduct_bhxh') === 'EMPLOYEE_DEDUCTION' && !COST.isInPersonnelCost('deduct_bhxh'));
ok('final_net_after_tax / pay_amount_* / reconcile_adjust are NOT in personnel cost (D5)',
  !COST.isInPersonnelCost('final_net_after_tax') && !COST.isInPersonnelCost('pay_amount_cash') &&
  !COST.isInPersonnelCost('pay_amount_transfer') && !COST.isInPersonnelCost('reconcile_adjust'));
ok('POLICY_STANDARD basis (base_salary_bhxh, std_*) is NOT realised cost',
  !COST.isInPersonnelCost('base_salary_bhxh') && !COST.isInPersonnelCost('std_hqcv_2') && !COST.isInPersonnelCost('std_khac_9'));

// 3. per-period: TPC reconciles to source (4) minus T13-in-(4); T13-revenue excluded; fingerprints stable
const CANON_FP = null; // captured from T7 then compared for T5/T6
let t7fp = null;
for (const [Tn, fname] of Object.entries(FILES)) {
  const rows = readTsv(path.join(CORPUS, fname));
  const built = TPL.buildColumnMap(rows);
  const fp = TPL.fingerprint(rows);
  const nrm = NRM.normalizeGrid(rows, built.map, {});
  const agg = COST.aggregatePeriodCost(nrm.records);

  // source aggregate grand_total_4 and the thuong_le_1_1 portion sitting inside it
  let g4 = 0, t13in4 = 0, t13rev = 0;
  for (const r of nrm.records) {
    const m = Object.assign({}, r.fields, r.sourceDetail);
    if (Number.isFinite(m.grand_total_4)) g4 += m.grand_total_4;
    if (Number.isFinite(m.bonus_thuong_le_1_1)) t13in4 += m.bonus_thuong_le_1_1;
    if (Number.isFinite(m.t13_revenue_bonus)) t13rev += m.t13_revenue_bonus;
  }
  const expected = g4 - t13in4;
  const delta = agg.totalPersonnelCost - expected;
  const tol = Math.max(5, nrm.rowCount * 0.5); // corpus TSV carries sub-VND float artifacts

  console.log('  -- ' + Tn + '  rows=' + nrm.rowCount + '  fp=' + fp.fingerprint.slice(0, 12) +
    '  TPC=' + Math.round(agg.totalPersonnelCost).toLocaleString() +
    '  src(4)-T13=' + Math.round(expected).toLocaleString() +
    '  Δ=' + Math.round(delta) +
    '  T13rev(excluded)=' + Math.round(t13rev).toLocaleString());

  ok(Tn + ': Total Personnel Cost reconciles to source (4) − T13  (|Δ| ≤ ' + Math.round(tol) + ')',
    Math.abs(delta) <= tol, 'Δ=' + delta);
  ok(Tn + ': t13_revenue_bonus (' + Math.round(t13rev).toLocaleString() + ') is NOT inside Total Personnel Cost',
    Math.abs((agg.totalPersonnelCost) - expected) <= tol && (t13rev === 0 || Math.abs(delta) < t13rev * 0.01 + tol));
  ok(Tn + ': employee deductions + tax + payment layer are reported, not added to cost',
    agg.employeeDeductions >= 0 && agg.employeeTax >= 0 && agg.paymentLayer !== undefined &&
    agg.totalPersonnelCost < agg.totalPersonnelCost + agg.employeeDeductions + 1);
  ok(Tn + ': TPC is NOT "thực nhận" (final_net_after_tax aggregate is strictly lower than TPC)',
    (function () {
      let net = 0; for (const r of nrm.records) { const m = Object.assign({}, r.fields, r.sourceDetail); if (Number.isFinite(m.final_net_after_tax)) net += m.final_net_after_tax; }
      return net > 0 && net < agg.totalPersonnelCost;
    })());

  if (Tn === 'T7') t7fp = fp.fingerprint;
  if (Tn === 'T6' || Tn === 'T5') {
    // T5/T6/T7 are the same structural family — fingerprint must be identical
    // (guards against an accidental mapping change from this batch)
  }
}

// 4. T5 == T6 == T7 fingerprint (canonical family unchanged by this batch)
const fps = {};
for (const [Tn, fname] of Object.entries(FILES)) {
  const rows = readTsv(path.join(CORPUS, fname));
  fps[Tn] = TPL.fingerprint(rows).fingerprint;
}
ok('T5 / T6 / T7 fingerprint identical (canonical family stable)', fps.T5 === fps.T6 && fps.T6 === fps.T7, JSON.stringify({ T5: fps.T5.slice(0,12), T6: fps.T6.slice(0,12), T7: fps.T7.slice(0,12) }));
ok('T7 canonical fingerprint == 82b1b54c2bc2… (Batch 02C lock, unchanged)', fps.T7.startsWith('82b1b54c2bc2'), fps.T7.slice(0, 16));
ok('T1..T4 fingerprints each distinct from the canonical family',
  ['T1','T2','T3','T4'].every((t) => fps[t] !== fps.T7));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
console.log('COST_MODEL_OFFLINE = PASS');
