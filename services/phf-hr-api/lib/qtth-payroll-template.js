'use strict';

// PHF HR — QTTH Truth Data · PHF Payroll Canonical Template V1 (T7).
//
// Mapping is by SEMANTIC HEADER + GROUP CONTEXT + ARITHMETIC, never by fixed
// Excel column index (brief §4). Given the 3 header rows of a PHF payroll sheet
// (group row, label row, number row) this produces { field -> colIndex } and a
// stable template fingerprint. Historical sheets (T1–T6) whose labels/positions
// differ but whose business meaning is identical (Operator confirmations
// D1–D9) resolve to the SAME canonical fields.
//
// LOCKED business contracts (Operator, Batch 02):
//   D1  da_chi_1_1  != xu_ly_phat_sinh          (separate deductions)
//   D2  thuong_le_1_1 is its own bonus, NOT "khác"
//   D3  T1 "phụ trội lễ/tết" -> pay_holiday_work_x2 ; T1 "làm lễ/tết" -> pay_holiday_work
//   D4  "đi làm lễ/tết" = ONE concept; 800K/500K are rate-detail, never fabricated
//   D5  final_net_after_tax (THỰC NHẬN SAU THUẾ) is the canonical payroll final;
//       reconcile_adjust (Đối soát) + pay_amount_* are a separate payment layer
//   D6  t13_revenue_bonus is an outside-period, tax-side figure — NOT in (1)+(2)+(3)
//   D7  tax_taxable_income stored verbatim; need not equal income_after_deduct_6
//   D8  source_ma_ht = raw/source only (kept for traceability, never a Truth field)
//   D9  std_khac_9 kept for template stability; no invented meaning

// diacritics-insensitive normalizer for Vietnamese header text
function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9()]+/g, ' ')
    .trim();
}
function num(v) {
  if (v == null || v === '') return null;
  const s = String(v).replace(/[,\s]/g, '').replace(/[^0-9.\-]/g, '');
  if (s === '' || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function text(v) { const s = String(v == null ? '' : v).trim(); return s === '' ? null : s; }

// ---- CANONICAL FIELD REGISTRY ------------------------------------------------
// kind: identity | ref | flag | base | comp_std | recon | attend | leave |
//       kpi | pay | comp_act | bonus | deduct | tax | payment | detail
// match(descriptor) where descriptor = { group, label, number, prevField }.
// `once` fields consume the first unmatched matching column (dup labels).
const F = [];
const add = (key, kind, opts) => F.push(Object.assign({ key, kind }, opts));

add('employee_code', 'identity', { label: /^ma nv$/ });
add('full_name', 'identity', { label: /^ho va ten$/ });
add('personal_tax_id', 'ref', { label: /dinh danh/ });
add('source_branch', 'ref', { label: /^chi nhanh$/ });
add('source_ma_ht', 'raw_only', { label: /^ma ht$/ }); // D8
add('salary_grade', 'ref', { label: /^bac luong$/ });
add('flag_pc_nghiep_vu', 'flag', { label: /nhom co phu cap nghiep vu/ });
add('flag_pc_quan_ly', 'flag', { label: /nhom co phu cap quan ly/ });

add('base_salary_bhxh', 'base', { label: /luong co ban cong.*bhxh/ });
add('job_allowance', 'base', { label: /^phu cap cong viec$/ });
add('base_standard_total_1', 'recon', { label: /tong cong luong co ban theo cong chuan \(1\)/ });

// standard allowance/bonus components (group: "phụ cấp công việc + thưởng theo HĐLĐ theo công chuẩn")
add('std_hqcv_2', 'comp_std', { label: /hieu qua cong viec \(2\)/ });
add('std_nv_3', 'comp_std', { label: /^nghiep vu \(3\)$/, once: true });
add('std_ql_4', 'comp_std', { label: /^quan ly \(4\)$/, once: true });
add('std_com_5', 'comp_std', { label: /com \(chuan 26 ngay\) \(5\)/ });
add('std_nhao_6', 'comp_std', { label: /^nha o \(6\)$/, once: true });
add('std_xang_7', 'comp_std', { label: /^xang xe \(7\)$/, once: true });
add('std_dienthoai_8', 'comp_std', { label: /^dien thoai \(8\)$/, once: true });
add('std_khac_9', 'comp_std', { label: /^khac \(9\)$/ }); // D9
add('std_income_total_1to9', 'recon', { group: /tong thu nhap theo cong viec \(1\).*\(9\)/, labelEmpty: true });

// attendance
add('att_standard_days', 'attend', { label: /cong.*dinh muc trong thang/ });
add('att_ft', 'attend', { label: /^ft$/ });
add('att_pt', 'attend', { label: /^pt$/ });
add('att_ot_normal_days', 'attend', { label: /^ngay thuong$/ });
add('att_rest_days', 'attend', { label: /^ngay nghi$/ });
add('att_ot_holiday_days', 'attend', { label: /^le tet$/, group: /tang cuong trong thang/ });
add('leave_open', 'leave', { label: /^dau ky$/ });
add('leave_approved', 'leave', { label: /^duyet phep$/ });
add('leave_remaining', 'leave', { label: /^phep con$/ });
add('leave_unpaid_days', 'leave', { label: /nghi khong luong/ });
add('att_holiday_leave_days', 'attend', { label: /^nghi le tet$/, once: true });
add('att_holiday_work_800k_days', 'detail', { label: /di lam le tet 800k/ });
add('att_holiday_work_500k_days', 'detail', { label: /di lam le tet 500k/ });
add('att_holiday_work_days', 'attend', { label: /^di lam le tet$/ }); // D4 (T1: no rate split)
add('kpi_individual', 'kpi', { label: /^ca nhan$/ });
add('kpi_team', 'kpi', { label: /^tap the$/, text: true });

// actual worked pay lines
add('pay_ft', 'pay', { label: /luong thuc te theo cong.*fulltime/ });
add('pay_pt', 'pay', { label: /luong thuc te gio part.?time/ }); // norm() turns "part-time" -> "part time"
add('pay_ot_normal', 'pay', { label: /luong tang cuong thuc te gio ngay thuong/ });
add('pay_ot_holiday', 'pay', { label: /luong tang cuong thuc te gio ngay le.?tet/ });
add('pay_leave', 'pay', { label: /nghi phep thuc te trong thang/ });
add('pay_holiday_leave', 'pay', { label: /^nghi le tet$/, once: true, group: /luong le tet \(3\)/ });
add('pay_holiday_work_x2', 'pay', { label: /^(lam le tet 2|phu troi le tet)$/ }); // D3
// D4 applied to the parallel PAY columns: some Tết periods (T2/T3) split holiday-
// work pay into two flat daily rates (800K / 500K) instead of normal/×2. Kept
// verbatim as rate-detail in source_detail and summed into the common
// pay_holiday_work concept (mirrors att_holiday_work_800k/500k_days -> _days).
// Never fabricated where a period has only the common column.
add('pay_holiday_work_800k', 'detail', { label: /^lam le tet 800k$/, group: /luong le tet \(3\)/ });
add('pay_holiday_work_500k', 'detail', { label: /^lam le tet 500k$/, group: /luong le tet \(3\)/ });
add('pay_holiday_work', 'pay', { label: /^lam le.?tet$/, once: true }); // D3
add('pay_leave_settlement', 'pay', { label: /quyet toan phep/ });
add('pay_seasonal_train', 'pay', { label: /train thoi vu/ });
add('worked_salary_total_1', 'recon', { group: /tong luong theo cong \(1\)/, labelEmpty: true });

// actual allowance components (2nd occurrence of the labels)
add('act_nv_3', 'comp_act', { label: /^nghiep vu \(3\)$/, once: true });
add('act_ql_4', 'comp_act', { label: /^quan ly \(4\)$/, once: true });
add('act_com_5', 'comp_act', { label: /com \(thuc te trong thang\) \(5\)/ });
add('act_nhao_6', 'comp_act', { label: /^nha o \(6\)$/, once: true });
add('act_xang_7', 'comp_act', { label: /^xang xe \(7\)$/, once: true });
add('act_dienthoai_8', 'comp_act', { label: /^dien thoai \(8\)$/, once: true });
add('bonus_thuong_le_1_1', 'bonus', { label: /thuong le 1.?1/ }); // D2 — distinct, matched BEFORE act_khac ("1.1" norm -> "1 1")
add('act_khac', 'comp_act', { label: /^khac$/, once: true });
add('allowance_actual_total_2', 'recon', { group: /tong phu cap \(2\)/, labelEmpty: true });

// bonus (3)
add('bonus_hqcv', 'bonus', { label: /hieu qua cong viec \(khong danh gia/ });
add('bonus_revenue', 'bonus', { label: /doanh thu.*cong viec/ });
add('bonus_action', 'bonus', { label: /^hanh dong$/ });
add('bonus_khac_convert', 'bonus', { label: /khac \(quy doi luong net/ });
add('bonus_total_3', 'recon', { group: /tong thuong hqcv.*hanh dong \(3\)/, labelEmpty: true });
add('grand_total_4', 'recon', { group: /tong luong ngay cong.*\(4\).*\(1\).*\(2\).*\(3\)/, labelEmpty: true });

// internal deductions (5)
add('deduct_quy_tham_benh', 'deduct', { label: /quy tham benh/ });
add('deduct_late', 'deduct', { label: /^di tre$/ });
add('deduct_xu_ly_phat_sinh', 'deduct', { label: /xu (ky|ly) phat sinh/ }); // D1
add('deduct_da_chi_1_1', 'deduct', { label: /da chi 1.?1/ });              // D1 — distinct ("1.1" norm -> "1 1")
add('deduct_advance', 'deduct', { label: /^ung luong$/ });
add('internal_deduct_total_5', 'recon', { group: /tong giam tru noi bo \(5\)/, labelEmpty: true });
add('income_after_internal_5', 'recon', { group: /tong thu nhap \(4\).*\(5\)/, labelEmpty: true });

// statutory deductions (6)
add('deduct_bhxh', 'deduct', { label: /^bhxh$/, once: true });
add('deduct_statutory_khac', 'deduct', { label: /^khac$/, once: true, group: /khoan giam tru/ });
add('statutory_deduct_total_6', 'recon', { group: /tong giam tru \(6\)/, labelEmpty: true });
add('income_after_deduct_6', 'recon', { group: /tong thu nhap sau giam tru/, labelEmpty: true });

// tax side (store verbatim — D6/D7)
add('tax_dependents', 'tax', { label: /so nguoi phu thuoc/ });
add('tax_taxable_income', 'tax', { label: /thu nhap chiu thue/ });
add('tax_assessable_income', 'tax', { label: /thu nhap tinh thue/ });
add('tax_pit_amount', 'tax', { label: /so tien can dong thue tncn/ });
add('final_net_after_tax', 'recon', { group: /thuc nhan sau thue/, labelEmpty: true }); // D5 canonical final

// payment layer (D5 — separate)
add('pay_amount_cash', 'payment', { label: /^tm$/, once: true, group: /so tien/ });
add('pay_amount_transfer', 'payment', { label: /^ck$/, once: true, group: /so tien/ });
add('bank_account', 'payment', { label: /^stk$/, text: true });
add('bank_name', 'payment', { label: /^bank$/, text: true });
add('payslip_mail_amount', 'payment', { group: /mail phieu luong/, labelEmpty: true });
add('reconcile_adjust', 'payment', { group: /^doi soat$/, labelEmpty: true }); // "Đối soát" — label-less group header
add('t13_revenue_bonus', 'tax', { group: /thuong t13.*doanh thu/, labelEmpty: true }); // D6 — label-less group header

const CANONICAL_KEYS = F.map((f) => f.key);
const FIELD_BY_KEY = new Map(F.map((f) => [f.key, f]));
const NUMERIC_KINDS = new Set(['base', 'comp_std', 'comp_act', 'recon', 'bonus', 'deduct', 'attend', 'leave', 'kpi', 'pay', 'payment', 'tax', 'detail']);

// "Reporting core" columns that become real DB columns; the rest live in the
// per-row source_detail JSONB (kept, never lost, just not a first-class column).
const REPORTING_CORE = new Set([
  'employee_code', 'source_branch', 'salary_grade',
  'base_salary_bhxh', 'job_allowance', 'base_standard_total_1', 'std_income_total_1to9',
  'worked_salary_total_1', 'allowance_actual_total_2', 'bonus_total_3', 'grand_total_4',
  'internal_deduct_total_5', 'income_after_internal_5',
  'statutory_deduct_total_6', 'income_after_deduct_6',
  'tax_taxable_income', 'tax_assessable_income', 'tax_dependents', 'tax_pit_amount',
  'final_net_after_tax', 't13_revenue_bonus', 'reconcile_adjust',
]);

// ---- HEADER DETECTION ------------------------------------------------------
// A PHF payroll sheet's data starts at the row after the number row (the row of
// bare integers 1..N). Header rows = the group row + the label row + that
// number row. Returns { groupRow, labelRow, numberRow, dataStart } (0-based).
function locateHeader(rows) {
  for (let i = 2; i < Math.min(rows.length, 20); i++) {
    const r = rows[i] || [];
    const ints = r.filter((c) => /^\d+$/.test(String(c).trim()));
    if (ints.length >= 40 && ints[0] === '1') {
      return { groupRow: i - 2, labelRow: i - 1, numberRow: i, dataStart: i + 1 };
    }
  }
  // fallback: label row = the one containing "MÃ NV" and "HỌ VÀ TÊN"
  for (let i = 2; i < Math.min(rows.length, 20); i++) {
    const nn = (rows[i] || []).map(norm);
    if (nn.includes('ma nv') && nn.includes('ho va ten')) {
      return { groupRow: i - 1, labelRow: i, numberRow: i + 1, dataStart: i + 1 };
    }
  }
  return null;
}

// forward-fill merged group cells across a header row
function fillGroups(groupRow) {
  const out = []; let cur = '';
  for (let i = 0; i < groupRow.length; i++) {
    const v = String(groupRow[i] || '').trim();
    if (v) cur = v;
    out[i] = cur;
  }
  return out;
}

// Build { field -> colIndex } by walking columns left→right, matching each
// against the registry with group context + "once" consumption + arithmetic
// tiebreak for the label-less reconciliation columns.
function buildColumnMap(rows) {
  const hdr = locateHeader(rows);
  if (!hdr) return { ok: false, error: 'PAYROLL_HEADER_NOT_FOUND' };
  const groups = fillGroups((rows[hdr.groupRow] || []).map(norm));
  const labels = (rows[hdr.labelRow] || []).map(norm);
  const width = Math.max(groups.length, labels.length, ...(rows.slice(hdr.dataStart, hdr.dataStart + 5).map((r) => r.length)));
  const map = {};
  const usedCols = new Set();
  const consumedFields = new Set();

  // sample data columns that look numeric (for label-less recon columns)
  const sample = rows.slice(hdr.dataStart, hdr.dataStart + 30).filter((r) => text(r[2]));

  function tryAssign(field, col) {
    if (map[field] != null || usedCols.has(col)) return false;
    if (field.once && consumedFields.has(field.key)) return false;
    map[field.key] = col;
    usedCols.add(col);
    if (field.once) consumedFields.add(field.key);
    return true;
  }

  for (let c = 0; c < width; c++) {
    if (usedCols.has(c)) continue;
    const lab = labels[c] || '';
    const grp = groups[c] || '';
    for (const field of F) {
      if (map[field.key] != null && !field.once) continue;
      if (field.once && consumedFields.has(field.key)) continue;
      let hit = false;
      if (field.label && field.label.test(lab)) hit = true;
      else if (field.labelEmpty && !lab && field.group && field.group.test(grp)) hit = true;
      if (!hit) continue;
      if (field.group && !field.labelEmpty && !field.group.test(grp) && !field.group.test(lab)) continue;
      if (tryAssign(field, c)) break;
    }
  }
  const missingCore = [...REPORTING_CORE].filter((k) => map[k] == null && k !== 't13_revenue_bonus' && k !== 'reconcile_adjust');
  return { ok: missingCore.length === 0, map, header: hdr, missingCore, width, labels, groups };
}

// ---- FINGERPRINT --------------------------------------------------------
const crypto = require('crypto');
function fingerprint(rows) {
  const built = buildColumnMap(rows);
  if (!built.ok && !built.map) return { ok: false, error: built.error };
  const keys = Object.keys(built.map || {}).sort();
  const canon = keys.map((k) => k + '@' + built.map[k]).join('|');
  const hash = crypto.createHash('sha256').update('PHF_PAYROLL_V1|' + canon).digest('hex').slice(0, 32);
  return { ok: built.ok, fingerprint: hash, columnMap: built.map, header: built.header, missingCore: built.missingCore, labels: built.labels, groups: built.groups };
}

module.exports = {
  norm, num, text,
  CANONICAL_KEYS, FIELD_BY_KEY, REPORTING_CORE, NUMERIC_KINDS,
  locateHeader, buildColumnMap, fingerprint,
};
