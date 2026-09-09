'use strict';
/*
 * PHF QTTH Payroll — SEMANTIC COST NORMALIZATION AUDIT (Phase A, READ-ONLY).
 *
 * No DB, no network, no writes. Reads docs/payroll-corpus/T1..T7 (verbatim
 * XLSX->TSV, sha256-pinned in README) and, using the SHIPPED normalizer
 * (qtth-payroll-template.js + qtth-payroll-normalize.js), produces:
 *   1. per-period column-map coverage  (which canonical fields resolve, T1..T7)
 *   2. a COST-GROUP classification of every money field per Operator D-COST-01..06
 *   3. a candidate Total Personnel Cost per period + cross-check vs source (4)
 *   4. an over-mapping / semantic-mismatch report
 *
 * Run: node scripts/qtth-payroll-semantic-cost-audit-dev.js
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const TPL = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-template'));
const NRM = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-normalize'));

const { resolvePayrollCorpusDir } = require(path.join(__dirname, 'lib/payroll-corpus-dir'));
const CORPUS = resolvePayrollCorpusDir();
const FILES = {
  T1: 'T1.tsv', T2: 'T2.tsv', T3: 'T3.tsv', T4: 'T4.tsv',
  T5: 'T5.tsv', T6: 'T6.tsv', T7: 'T7_CANONICAL.tsv',
};

function readTsv(fp) {
  let s = fs.readFileSync(fp, 'utf8');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return s.split(/\r?\n/).map((line) => line.split('\t'));
}

// ---- COST MODEL (Operator §7 D-COST-01..06 + §8) ---------------------------
// group: one of
//   SALARY_COST | HOLIDAY_COST | ALLOWANCE | OTHER_ALLOWANCE | PERFORMANCE_REWARD
//   EMPLOYER_STATUTORY_COST | EMPLOYEE_DEDUCTION | EMPLOYEE_TAX
//   EXCLUDED_T13 | PAYMENT_RECON | RECON_SUBTOTAL | NON_MONETARY | RAW_ONLY
// inCost: does this line ADD to Total Personnel Cost (company burden)?
const COST = {
  // identity / ref / flags / attendance / leave / kpi — not money
  employee_code:'NON_MONETARY', full_name:'NON_MONETARY', personal_tax_id:'NON_MONETARY',
  source_branch:'NON_MONETARY', salary_grade:'NON_MONETARY',
  source_ma_ht:'RAW_ONLY',
  flag_pc_nghiep_vu:'NON_MONETARY', flag_pc_quan_ly:'NON_MONETARY',
  base_salary_bhxh:'NON_MONETARY',  // a RATE (BHXH base), not a paid cost line
  job_allowance:'NON_MONETARY',     // a RATE component of base; realised cost = worked_salary_total_1
  att_standard_days:'NON_MONETARY', att_ft:'NON_MONETARY', att_pt:'NON_MONETARY',
  att_ot_normal_days:'NON_MONETARY', att_rest_days:'NON_MONETARY', att_ot_holiday_days:'NON_MONETARY',
  leave_open:'NON_MONETARY', leave_approved:'NON_MONETARY', leave_remaining:'NON_MONETARY',
  leave_unpaid_days:'NON_MONETARY', att_holiday_leave_days:'NON_MONETARY',
  att_holiday_work_800k_days:'NON_MONETARY', att_holiday_work_500k_days:'NON_MONETARY',
  att_holiday_work_days:'NON_MONETARY',
  kpi_individual:'NON_MONETARY', kpi_team:'NON_MONETARY',

  // --- ACTUAL WORKED PAY (the realised salary cost of the period) ---
  pay_ft:'SALARY_COST', pay_pt:'SALARY_COST', pay_ot_normal:'SALARY_COST',
  pay_leave:'SALARY_COST', pay_leave_settlement:'SALARY_COST', pay_seasonal_train:'SALARY_COST',
  // D-COST-03 / D-COST-04 — every holiday-work / holiday-leave pay line -> HOLIDAY_COST
  pay_ot_holiday:'HOLIDAY_COST', pay_holiday_leave:'HOLIDAY_COST',
  pay_holiday_work_x2:'HOLIDAY_COST', pay_holiday_work:'HOLIDAY_COST',
  pay_holiday_work_800k:'HOLIDAY_COST', pay_holiday_work_500k:'HOLIDAY_COST',

  // --- ACTUAL ALLOWANCE COMPONENTS (2) ---
  act_nv_3:'ALLOWANCE', act_ql_4:'ALLOWANCE', act_com_5:'ALLOWANCE',
  act_nhao_6:'ALLOWANCE', act_xang_7:'ALLOWANCE', act_dienthoai_8:'ALLOWANCE',
  act_khac:'OTHER_ALLOWANCE',                 // D-COST-05
  bonus_khac_convert:'OTHER_ALLOWANCE',       // D-COST-05 ("khác (quy đổi lương net...)")

  // --- BONUS / PERFORMANCE (3) ---
  bonus_hqcv:'PERFORMANCE_REWARD', bonus_revenue:'PERFORMANCE_REWARD', bonus_action:'PERFORMANCE_REWARD',
  bonus_thuong_le_1_1:'EXCLUDED_T13',         // D-COST-02 (Tháng 13)

  // --- STANDARD (policy) allowance/bonus components (1..9) : these are the
  //     CONTRACTUAL STANDARD basis, NOT the realised cost. Realised = act_* + pay_*.
  std_hqcv_2:'NON_MONETARY', std_nv_3:'NON_MONETARY', std_ql_4:'NON_MONETARY',
  std_com_5:'NON_MONETARY', std_nhao_6:'NON_MONETARY', std_xang_7:'NON_MONETARY',
  std_dienthoai_8:'NON_MONETARY', std_khac_9:'NON_MONETARY',

  // --- DEDUCTIONS (5) + (6) : reduce employee take-home, NOT company cost ---
  deduct_quy_tham_benh:'EMPLOYEE_DEDUCTION', deduct_late:'EMPLOYEE_DEDUCTION',
  deduct_xu_ly_phat_sinh:'EMPLOYEE_DEDUCTION',
  deduct_da_chi_1_1:'PAYMENT_RECON',          // D-COST-01 (already-paid advance, reconciliation)
  deduct_advance:'EMPLOYEE_DEDUCTION',
  deduct_bhxh:'EMPLOYEE_DEDUCTION',           // D-COST-06 employee side
  deduct_statutory_khac:'EMPLOYEE_DEDUCTION',
  tax_dependents:'NON_MONETARY',
  tax_taxable_income:'RECON_SUBTOTAL', tax_assessable_income:'RECON_SUBTOTAL',
  tax_pit_amount:'EMPLOYEE_TAX',
  t13_revenue_bonus:'EXCLUDED_T13',           // D6

  // --- SOURCE SUBTOTAL COLUMNS (reconciliation only, never summed into cost) ---
  base_standard_total_1:'RECON_SUBTOTAL', std_income_total_1to9:'RECON_SUBTOTAL',
  worked_salary_total_1:'RECON_SUBTOTAL', allowance_actual_total_2:'RECON_SUBTOTAL',
  bonus_total_3:'RECON_SUBTOTAL', grand_total_4:'RECON_SUBTOTAL',
  internal_deduct_total_5:'RECON_SUBTOTAL', income_after_internal_5:'RECON_SUBTOTAL',
  statutory_deduct_total_6:'RECON_SUBTOTAL', income_after_deduct_6:'RECON_SUBTOTAL',
  final_net_after_tax:'RECON_SUBTOTAL',

  // --- PAYMENT / RECONCILIATION LAYER (§8, not a cost) ---
  pay_amount_cash:'PAYMENT_RECON', pay_amount_transfer:'PAYMENT_RECON',
  bank_account:'NON_MONETARY', bank_name:'NON_MONETARY',
  payslip_mail_amount:'PAYMENT_RECON', reconcile_adjust:'PAYMENT_RECON',
};
const IN_COST = new Set(['SALARY_COST','HOLIDAY_COST','ALLOWANCE','OTHER_ALLOWANCE','PERFORMANCE_REWARD','EMPLOYER_STATUTORY_COST']);

// ---- run --------------------------------------------------------------------
const ALL = TPL.CANONICAL_KEYS;
const perPeriod = {};
const labelSeen = {}; // key -> { Tn: matchedLabel }

console.log('# PHF QTTH PAYROLL — SEMANTIC COST AUDIT (Phase A)\n');
console.log('normalizer field count :', ALL.length);
console.log('classified in COST map :', Object.keys(COST).length);
const unclassified = ALL.filter((k) => !(k in COST));
if (unclassified.length) console.log('!! UNCLASSIFIED FIELDS :', unclassified.join(', '));

for (const [Tn, fname] of Object.entries(FILES)) {
  const rows = readTsv(path.join(CORPUS, fname));
  const built = TPL.buildColumnMap(rows);
  const fp = TPL.fingerprint(rows);
  const nrm = NRM.normalizeGrid(rows, built.map, {});
  perPeriod[Tn] = { built, fp, nrm, rows: nrm.rowCount };
  for (const k of Object.keys(built.map || {})) {
    const col = built.map[k];
    (labelSeen[k] = labelSeen[k] || {})[Tn] = built.labels[col] || '(label-less/group)';
  }
}

// ---- 1. coverage matrix ----
console.log('\n## 1. CANONICAL FIELD COVERAGE  (T1..T7)  — . = not resolved in that period\n');
console.log(['field'.padEnd(28), 'grp'.padEnd(20), ...Object.keys(FILES)].join(' '));
for (const k of ALL) {
  const row = Object.keys(FILES).map((Tn) => (perPeriod[Tn].built.map[k] != null ? 'Y' : '.'));
  console.log([k.padEnd(28), (COST[k]||'?').padEnd(20), ...row.map((x)=>x.padEnd(2))].join(' '));
}

// ---- 2. label drift per field ----
console.log('\n## 2. SOURCE LABEL PER PERIOD  (semantic-match evidence — same concept, drifting label)\n');
for (const k of ALL) {
  const seen = labelSeen[k]; if (!seen) continue;
  const uniq = [...new Set(Object.values(seen))];
  if (uniq.length > 1) {
    console.log('  ' + k);
    for (const [Tn, lab] of Object.entries(seen)) console.log('      ' + Tn + '  "' + lab + '"');
  }
}

// ---- 3. candidate Total Personnel Cost per period ----
console.log('\n## 3. CANDIDATE TOTAL PERSONNEL COST  vs  source subtotal (4)\n');
function agg(records, pick) { let s = 0; for (const r of records) { const m = Object.assign({}, r.fields, r.sourceDetail); const v = pick(m); if (Number.isFinite(v)) s += v; } return s; }
const G = (m,k)=> (Number.isFinite(m[k])?m[k]:0);
for (const Tn of Object.keys(FILES)) {
  const recs = perPeriod[Tn].nrm.records;
  const salary   = agg(recs, (m)=>G(m,'pay_ft')+G(m,'pay_pt')+G(m,'pay_ot_normal')+G(m,'pay_leave')+G(m,'pay_leave_settlement')+G(m,'pay_seasonal_train'));
  const holiday  = agg(recs, (m)=>G(m,'pay_ot_holiday')+G(m,'pay_holiday_leave')+G(m,'pay_holiday_work_x2')+G(m,'pay_holiday_work'));
  const worked1  = agg(recs, (m)=>G(m,'worked_salary_total_1'));
  const allowance= agg(recs, (m)=>G(m,'act_nv_3')+G(m,'act_ql_4')+G(m,'act_com_5')+G(m,'act_nhao_6')+G(m,'act_xang_7')+G(m,'act_dienthoai_8'));
  const otherAllw= agg(recs, (m)=>G(m,'act_khac')+G(m,'bonus_khac_convert'));
  const allow2   = agg(recs, (m)=>G(m,'allowance_actual_total_2'));
  const perf     = agg(recs, (m)=>G(m,'bonus_hqcv')+G(m,'bonus_revenue')+G(m,'bonus_action'));
  const t13      = agg(recs, (m)=>G(m,'bonus_thuong_le_1_1'));
  const bonus3   = agg(recs, (m)=>G(m,'bonus_total_3'));
  const grand4   = agg(recs, (m)=>G(m,'grand_total_4'));
  const cand     = salary + holiday + allowance + otherAllw + perf;   // NO employer statutory (not in sheet), NO T13
  console.log('  ' + Tn + '  rows=' + perPeriod[Tn].nrm.rowCount + '  fp=' + perPeriod[Tn].fp.fingerprint.slice(0,12) + (perPeriod[Tn].fp.ok?'':'  [missingCore: '+perPeriod[Tn].fp.missingCore.join(',')+']'));
  console.log('     salary(pay_*)      = ' + salary.toLocaleString());
  console.log('     holiday(pay_*)     = ' + holiday.toLocaleString());
  console.log('     Σ pay lines        = ' + (salary+holiday).toLocaleString() + '   vs  source worked_salary_total_1 = ' + worked1.toLocaleString() + '   Δ=' + (salary+holiday-worked1).toLocaleString());
  console.log('     allowance(act_*)   = ' + allowance.toLocaleString());
  console.log('     other allowance    = ' + otherAllw.toLocaleString());
  console.log('     Σ allowance        = ' + (allowance+otherAllw).toLocaleString() + '   vs  source allowance_actual_total_2 = ' + allow2.toLocaleString() + '   Δ=' + (allowance+otherAllw-allow2).toLocaleString());
  console.log('     performance reward = ' + perf.toLocaleString());
  console.log('     T13 (thuong_le_1_1)= ' + t13.toLocaleString() + '   vs source bonus_total_3 = ' + bonus3.toLocaleString() + '   (perf+T13 Δ vs bonus3 = ' + (perf+t13-bonus3).toLocaleString() + ')');
  console.log('     >>> CANDIDATE TPC  = ' + cand.toLocaleString());
  console.log('         source grand_total_4          = ' + grand4.toLocaleString());
  console.log('         grand_total_4 - T13           = ' + (grand4 - t13).toLocaleString() + '   Δ(TPC vs g4-T13) = ' + (cand - (grand4 - t13)).toLocaleString());
  console.log('');
}

// ---- 4. over-mapping / mismatch scan ----
console.log('## 4. OVER-MAPPING / SEMANTIC-MISMATCH SCAN\n');
const notes = [];
// 4a. same source label matched by >1 canonical field across periods? (once-consumption ambiguity)
// 4b. a canonical field whose matched label text differs in *meaning* not just spelling
for (const k of ALL) {
  const seen = labelSeen[k]; if (!seen) continue;
  const labs = [...new Set(Object.values(seen))];
  // heuristic: flag when the matched labels share almost no tokens
  if (labs.length > 1) {
    const tok = labs.map((l)=> new Set(String(l).split(/\s+/).filter((w)=>w.length>2)));
    let minOverlap = 1;
    for (let i=0;i<tok.length;i++) for (let j=i+1;j<tok.length;j++) {
      const inter = [...tok[i]].filter((x)=>tok[j].has(x)).length;
      const uni = new Set([...tok[i],...tok[j]]).size || 1;
      minOverlap = Math.min(minOverlap, inter/uni);
    }
    if (minOverlap < 0.34) notes.push('LABEL_DRIFT_WIDE  ' + k + '  -> ' + JSON.stringify(seen));
  }
}
// 4c. reconciliation failures aggregated per period (genuine source imperfection vs mapping bug)
for (const Tn of Object.keys(FILES)) {
  const recs = perPeriod[Tn].nrm.records;
  const byCheck = {};
  for (const r of recs) for (const w of r.reconciliation) byCheck[w.check] = (byCheck[w.check]||0)+1;
  const tot = Object.values(byCheck).reduce((a,b)=>a+b,0);
  if (tot) notes.push('RECON_WARN  ' + Tn + '  ' + JSON.stringify(byCheck));
}
notes.forEach((n)=>console.log('  ' + n));
if (!notes.length) console.log('  (none)');

console.log('\n## 5. FIELDS BY COST GROUP\n');
const byGroup = {};
for (const k of ALL) (byGroup[COST[k]||'?'] = byGroup[COST[k]||'?']||[]).push(k);
for (const g of Object.keys(byGroup).sort()) console.log('  ' + g.padEnd(24) + byGroup[g].length + '  ' + byGroup[g].join(', '));
