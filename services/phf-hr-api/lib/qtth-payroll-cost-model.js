'use strict';

// PHF HR — QTTH Truth Data · PAYROLL SEMANTIC COST MODEL V1.
//
// PURE + ADDITIVE. This module does NOT parse, map, normalize, or mutate
// anything. It is a lookup: canonical field key -> its BUSINESS COST NATURE,
// plus computePersonnelCost(record) which folds a normalized record's
// canonical values into cost groups + a single Total Personnel Cost number.
//
// It exists so a later reporting layer answers ONE question:
//   "How much personnel cost did the company actually bear this period?"
// without re-deriving business meaning. It changes NO existing behaviour and
// NO template fingerprint — qtth-payroll-template.js / -normalize.js untouched.
//
// LOCKED Operator cost decisions (Batch "Semantic Cost Normalization", §7):
//   D-COST-01  da_chi_1_1        = already-paid advance re-entered for correct
//                                  income/PIT. NOT a second expense. Payment/
//                                  reconciliation layer. Never in cost.
//   D-COST-02  thuong_le_1_1     = Tháng 13. EXCLUDED from monthly operating
//                                  payroll cost. Kept for a future T13 report.
//   D-COST-03  Lễ/Tết pay lines  = one HOLIDAY_COST group (no historical policy
//                                  split at the cost layer). Raw kept.
//   D-COST-04  800K / 500K       = period policy rate-detail, still HOLIDAY_COST.
//   D-COST-05  "khác" that the company actually bears (incl. net-salary
//                                  conversion / company-paid PIT) = OTHER_ALLOWANCE.
//   D-COST-06  BHXH: employer share = EMPLOYER_STATUTORY_COST (adds to cost);
//                    employee share  = EMPLOYEE_DEDUCTION (never added).
//
// Also LOCKED (Batch 02, D1–D9) and honoured here:
//   D5  final_net_after_tax + pay_amount_* + reconcile_adjust = payment layer.
//   D6  t13_revenue_bonus is outside (1)+(2)+(3) — EXCLUDED_T13.

// ---- cost nature of every canonical field ----------------------------------
// group values:
//   SALARY_COST            realised worked-time pay
//   HOLIDAY_COST           realised Lễ/Tết pay (work + leave + premium)
//   RATE_DETAIL            a policy rate-tier of a value ALREADY folded into its
//                          parent cost field by qtth-payroll-normalize (D4).
//                          Kept for provenance; MUST NOT be summed again.
//   ALLOWANCE              realised contractual allowance components (2)
//   OTHER_ALLOWANCE        "khác" the company actually bears (D-COST-05)
//   PERFORMANCE_REWARD     HQCV / doanh thu / hành động bonus (3)
//   EMPLOYER_STATUTORY_COST employer social-insurance burden (D-COST-06)
//   EMPLOYEE_DEDUCTION     reduces take-home only — never company cost
//   EMPLOYEE_TAX           PIT withheld — never company cost
//   EXCLUDED_T13           Tháng 13 / outside-period — not monthly operating cost
//   PAYMENT_RECON          how/what was paid or reconciled — not a cost
//   RECON_SUBTOTAL         a source subtotal column — reconciliation only
//   POLICY_STANDARD        the contractual STANDARD basis (1..9) — not realised cost
//   NON_MONETARY           identity / ref / flag / days / counts / bank text
//   RAW_ONLY               kept for traceability only (D8)
const NATURE = {
  employee_code:'NON_MONETARY', full_name:'NON_MONETARY', personal_tax_id:'NON_MONETARY',
  source_branch:'NON_MONETARY', salary_grade:'NON_MONETARY', source_ma_ht:'RAW_ONLY',
  flag_pc_nghiep_vu:'NON_MONETARY', flag_pc_quan_ly:'NON_MONETARY',

  // contractual RATE / STANDARD basis — not what was actually paid
  base_salary_bhxh:'POLICY_STANDARD', job_allowance:'POLICY_STANDARD',
  std_hqcv_2:'POLICY_STANDARD', std_nv_3:'POLICY_STANDARD', std_ql_4:'POLICY_STANDARD',
  std_com_5:'POLICY_STANDARD', std_nhao_6:'POLICY_STANDARD', std_xang_7:'POLICY_STANDARD',
  std_dienthoai_8:'POLICY_STANDARD', std_khac_9:'POLICY_STANDARD',

  // attendance / leave / kpi — counts, not money
  att_standard_days:'NON_MONETARY', att_ft:'NON_MONETARY', att_pt:'NON_MONETARY',
  att_ot_normal_days:'NON_MONETARY', att_rest_days:'NON_MONETARY', att_ot_holiday_days:'NON_MONETARY',
  leave_open:'NON_MONETARY', leave_approved:'NON_MONETARY', leave_remaining:'NON_MONETARY',
  leave_unpaid_days:'NON_MONETARY', att_holiday_leave_days:'NON_MONETARY',
  att_holiday_work_800k_days:'NON_MONETARY', att_holiday_work_500k_days:'NON_MONETARY',
  att_holiday_work_days:'NON_MONETARY', kpi_individual:'NON_MONETARY', kpi_team:'NON_MONETARY',

  // realised worked-time pay (1)
  pay_ft:'SALARY_COST', pay_pt:'SALARY_COST', pay_ot_normal:'SALARY_COST',
  pay_leave:'SALARY_COST', pay_leave_settlement:'SALARY_COST', pay_seasonal_train:'SALARY_COST',
  // realised Lễ/Tết pay (D-COST-03 / D-COST-04) — one group, raw tiers kept in source_detail
  pay_ot_holiday:'HOLIDAY_COST', pay_holiday_leave:'HOLIDAY_COST',
  pay_holiday_work_x2:'HOLIDAY_COST', pay_holiday_work:'HOLIDAY_COST',
  // D4: qtth-payroll-normalize folds these tiers into pay_holiday_work — the
  // parent already carries their value. Provenance only; never summed again.
  pay_holiday_work_800k:'RATE_DETAIL', pay_holiday_work_500k:'RATE_DETAIL',

  // realised allowance components (2)
  act_nv_3:'ALLOWANCE', act_ql_4:'ALLOWANCE', act_com_5:'ALLOWANCE',
  act_nhao_6:'ALLOWANCE', act_xang_7:'ALLOWANCE', act_dienthoai_8:'ALLOWANCE',
  act_khac:'OTHER_ALLOWANCE',              // D-COST-05
  bonus_khac_convert:'OTHER_ALLOWANCE',    // D-COST-05 (net-salary conversion / company-paid PIT)

  // performance / reward (3)
  bonus_hqcv:'PERFORMANCE_REWARD', bonus_revenue:'PERFORMANCE_REWARD', bonus_action:'PERFORMANCE_REWARD',

  // Tháng 13 / outside-period
  bonus_thuong_le_1_1:'EXCLUDED_T13',      // D-COST-02
  t13_revenue_bonus:'EXCLUDED_T13',        // D6

  // deductions (5) + (6) — reduce take-home, never company cost
  deduct_quy_tham_benh:'EMPLOYEE_DEDUCTION', deduct_late:'EMPLOYEE_DEDUCTION',
  deduct_xu_ly_phat_sinh:'EMPLOYEE_DEDUCTION', deduct_advance:'EMPLOYEE_DEDUCTION',
  deduct_bhxh:'EMPLOYEE_DEDUCTION',        // D-COST-06 employee side
  deduct_statutory_khac:'EMPLOYEE_DEDUCTION',
  deduct_da_chi_1_1:'PAYMENT_RECON',       // D-COST-01
  tax_dependents:'NON_MONETARY', tax_pit_amount:'EMPLOYEE_TAX',

  // source subtotal columns — reconciliation only
  base_standard_total_1:'RECON_SUBTOTAL', std_income_total_1to9:'RECON_SUBTOTAL',
  worked_salary_total_1:'RECON_SUBTOTAL', allowance_actual_total_2:'RECON_SUBTOTAL',
  bonus_total_3:'RECON_SUBTOTAL', grand_total_4:'RECON_SUBTOTAL',
  internal_deduct_total_5:'RECON_SUBTOTAL', income_after_internal_5:'RECON_SUBTOTAL',
  statutory_deduct_total_6:'RECON_SUBTOTAL', income_after_deduct_6:'RECON_SUBTOTAL',
  tax_taxable_income:'RECON_SUBTOTAL', tax_assessable_income:'RECON_SUBTOTAL',
  final_net_after_tax:'RECON_SUBTOTAL',

  // payment / reconciliation layer (D5)
  pay_amount_cash:'PAYMENT_RECON', pay_amount_transfer:'PAYMENT_RECON',
  payslip_mail_amount:'PAYMENT_RECON', reconcile_adjust:'PAYMENT_RECON',
  bank_account:'NON_MONETARY', bank_name:'NON_MONETARY',
};

// groups whose realised value ADDS to Total Personnel Cost (company burden)
const IN_PERSONNEL_COST = new Set([
  'SALARY_COST', 'HOLIDAY_COST', 'ALLOWANCE', 'OTHER_ALLOWANCE',
  'PERFORMANCE_REWARD', 'EMPLOYER_STATUTORY_COST',
]);

// display label per group (Vietnamese, reporting-facing)
const GROUP_LABEL = {
  SALARY_COST: 'Lương theo công',
  HOLIDAY_COST: 'Chi phí Lễ/Tết',
  ALLOWANCE: 'Phụ cấp',
  OTHER_ALLOWANCE: 'Phụ cấp khác',
  PERFORMANCE_REWARD: 'Thưởng hiệu quả / hành động',
  EMPLOYER_STATUTORY_COST: 'BHXH doanh nghiệp',
  EMPLOYEE_DEDUCTION: 'Giảm trừ của người lao động',
  EMPLOYEE_TAX: 'Thuế TNCN',
  EXCLUDED_T13: 'Tháng 13 (ngoài kỳ vận hành)',
  PAYMENT_RECON: 'Thanh toán / đối soát',
  RECON_SUBTOTAL: 'Cột tổng nguồn (đối soát)',
  POLICY_STANDARD: 'Định mức theo HĐLĐ',
  RATE_DETAIL: 'Chi tiết mức (đã gộp vào field cha)',
  NON_MONETARY: 'Phi tiền tệ',
  RAW_ONLY: 'Chỉ lưu vết nguồn',
};

function natureOf(key) { return NATURE[key] || 'UNKNOWN'; }
function isInPersonnelCost(key) { return IN_PERSONNEL_COST.has(natureOf(key)); }

// computePersonnelCost(record)
//   record = a qtth-payroll-normalize record OR any object exposing canonical
//            values (record.fields + record.sourceDetail merged, or a flat map).
// Returns:
//   { byGroup:{group:number}, totalPersonnelCost, excludedT13, employeeDeductions,
//     employeeTax, paymentLayer, sourceGrandTotal4, reconDeltaVsSource }
// TotalPersonnelCost is built ONLY from realised in-cost fields. It is NEVER
// "thực nhận". Deductions / tax / payment layer / T13 are reported separately,
// never added or re-subtracted.
function computePersonnelCost(record) {
  const flat = record && record.fields
    ? Object.assign({}, record.fields, record.sourceDetail || {})
    : (record || {});
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  const byGroup = {};
  let excludedT13 = 0, employeeDeductions = 0, employeeTax = 0, paymentLayer = 0;

  for (const key of Object.keys(flat)) {
    const g = natureOf(key);
    const v = n(flat[key]);
    if (v === 0) continue;
    if (IN_PERSONNEL_COST.has(g)) { byGroup[g] = (byGroup[g] || 0) + v; continue; }
    if (g === 'EXCLUDED_T13') excludedT13 += v;
    else if (g === 'EMPLOYEE_DEDUCTION') employeeDeductions += v;
    else if (g === 'EMPLOYEE_TAX') employeeTax += v;
    else if (g === 'PAYMENT_RECON') paymentLayer += v;
    // RECON_SUBTOTAL / POLICY_STANDARD / NON_MONETARY / RAW_ONLY -> ignored
  }

  const totalPersonnelCost = round2(
    Object.values(byGroup).reduce((a, b) => a + b, 0)
  );
  const sourceGrandTotal4 = n(flat.grand_total_4);
  // source (4) already excludes t13_revenue_bonus (D6). It still contains
  // thuong_le_1_1 when that column is populated, so the expected match is
  // (4) minus the thuong_le_1_1 portion of the T13 total.
  const t13InGrand4 = n(flat.bonus_thuong_le_1_1);
  const reconDeltaVsSource = sourceGrandTotal4
    ? round2(totalPersonnelCost - (sourceGrandTotal4 - t13InGrand4))
    : null;

  return {
    byGroup,
    groupLabels: GROUP_LABEL,
    totalPersonnelCost,
    excludedT13: round2(excludedT13),
    employeeDeductions: round2(employeeDeductions),
    employeeTax: round2(employeeTax),
    paymentLayer: round2(paymentLayer),
    sourceGrandTotal4,
    reconDeltaVsSource,
  };
}

// Aggregate many records (a whole period).
function aggregatePeriodCost(records) {
  const acc = { byGroup: {}, totalPersonnelCost: 0, excludedT13: 0,
    employeeDeductions: 0, employeeTax: 0, paymentLayer: 0,
    sourceGrandTotal4: 0, rows: 0, reconciledRows: 0 };
  for (const rec of records || []) {
    const c = computePersonnelCost(rec);
    acc.rows += 1;
    for (const [g, v] of Object.entries(c.byGroup)) acc.byGroup[g] = round2((acc.byGroup[g] || 0) + v);
    acc.totalPersonnelCost = round2(acc.totalPersonnelCost + c.totalPersonnelCost);
    acc.excludedT13 = round2(acc.excludedT13 + c.excludedT13);
    acc.employeeDeductions = round2(acc.employeeDeductions + c.employeeDeductions);
    acc.employeeTax = round2(acc.employeeTax + c.employeeTax);
    acc.paymentLayer = round2(acc.paymentLayer + c.paymentLayer);
    acc.sourceGrandTotal4 = round2(acc.sourceGrandTotal4 + c.sourceGrandTotal4);
    if (c.reconDeltaVsSource != null && Math.abs(c.reconDeltaVsSource) <= 2) acc.reconciledRows += 1;
  }
  acc.reconDeltaVsSource = round2(acc.totalPersonnelCost - acc.sourceGrandTotal4);
  return acc;
}

function round2(x) { return Math.round(x * 100) / 100; }

module.exports = {
  NATURE, IN_PERSONNEL_COST, GROUP_LABEL,
  natureOf, isInPersonnelCost,
  computePersonnelCost, aggregatePeriodCost,
};
