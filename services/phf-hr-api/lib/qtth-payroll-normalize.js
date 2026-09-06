'use strict';

// PHF HR — QTTH Truth Data · payroll grid -> normalized records + validation.
//
// Input: a CLEAN cell grid (string[][], UTF-8, no mojibake) + the columnMap
// from qtth-payroll-template.buildColumnMap(). Output: one record per employee
// row: { employeeCode, fields (canonical numeric/text), sourceDetail (jsonb),
// rawCells, reconciliation (warn-only, never rewrites uploaded values) }.
//
// LOCKED: uploaded VALUE is authoritative. Arithmetic is validation only —
// a mismatch produces a warning with expected vs uploaded, never a correction.

const T = require('./qtth-payroll-template');

const EMP_RE = /^[A-Z0-9_.]{2,32}$/i;

// Reconciliation relationships (all warn-only). Each: { key, label, expr(f) }.
const CHECKS = [
  { key: 'base_1', label: 'Lương BHXH + Phụ cấp CV = Tổng lương cơ bản (1)',
    lhs: (f) => f.base_standard_total_1, rhs: (f) => sum(f.base_salary_bhxh, f.job_allowance) },
  { key: 'std_income', label: 'Tổng thu nhập theo công việc = (1)+(2)+…+(9)',
    lhs: (f) => f.std_income_total_1to9,
    rhs: (f) => sum(f.base_standard_total_1, f.std_hqcv_2, f.std_nv_3, f.std_ql_4, f.std_com_5, f.std_nhao_6, f.std_xang_7, f.std_dienthoai_8, f.std_khac_9) },
  { key: 'allowance_2', label: 'Tổng phụ cấp (2) = Σ phụ cấp thực tế',
    lhs: (f) => f.allowance_actual_total_2,
    rhs: (f) => sum(f.act_nv_3, f.act_ql_4, f.act_com_5, f.act_nhao_6, f.act_xang_7, f.act_dienthoai_8, f.act_khac) },
  { key: 'bonus_3', label: 'Tổng thưởng (3) = HQCV + Doanh thu + Hành động + Khác quy đổi',
    lhs: (f) => f.bonus_total_3, rhs: (f) => sum(f.bonus_hqcv, f.bonus_revenue, f.bonus_action, f.bonus_khac_convert) },
  { key: 'grand_4', label: 'Tổng lương ngày công + phụ cấp + thưởng (4) = (1)+(2)+(3)',
    lhs: (f) => f.grand_total_4, rhs: (f) => sum(f.worked_salary_total_1, f.allowance_actual_total_2, f.bonus_total_3) },
  { key: 'internal_5', label: 'Tổng giảm trừ nội bộ (5) = Quỹ thăm bệnh + Đi trễ + Xử lý phát sinh + Đã chi 1.1 + Ứng lương',
    lhs: (f) => f.internal_deduct_total_5,
    rhs: (f) => sum(f.deduct_quy_tham_benh, f.deduct_late, f.deduct_xu_ly_phat_sinh, f.deduct_da_chi_1_1, f.deduct_advance) },
  { key: 'after_internal', label: 'Tổng thu nhập (4) - (5)',
    lhs: (f) => f.income_after_internal_5, rhs: (f) => diff(f.grand_total_4, f.internal_deduct_total_5) },
  { key: 'statutory_6', label: 'Tổng giảm trừ (6) = BHXH + Khác',
    lhs: (f) => f.statutory_deduct_total_6, rhs: (f) => sum(f.deduct_bhxh, f.deduct_statutory_khac) },
  { key: 'after_deduct', label: 'Tổng thu nhập sau giảm trừ = Tổng thu nhập - (6)',
    lhs: (f) => f.income_after_deduct_6, rhs: (f) => diff(f.income_after_internal_5, f.statutory_deduct_total_6) },
  { key: 'final_net', label: 'Thực nhận sau thuế = Tổng thu nhập sau giảm trừ - Thuế TNCN',
    lhs: (f) => f.final_net_after_tax, rhs: (f) => diff(f.income_after_deduct_6, f.tax_pit_amount) },
];
function sum() { let s = 0, any = false; for (const v of arguments) { if (typeof v === 'number' && Number.isFinite(v)) { s += v; any = true; } } return any ? s : null; }
function diff(a, b) { if (typeof a !== 'number') return null; return a - (typeof b === 'number' ? b : 0); }
const TOL = 1; // VND rounding tolerance

function normalizeGrid(rows, columnMap, opts) {
  const options = opts || {};
  const map = columnMap;
  const hdr = T.locateHeader(rows);
  if (!hdr) return { ok: false, error: 'PAYROLL_HEADER_NOT_FOUND' };

  const records = [];
  const seenCodes = new Map();
  const fileWarnings = [];

  for (let r = hdr.dataStart; r < rows.length; r++) {
    const row = rows[r] || [];
    const rawCode = T.text(map.employee_code != null ? row[map.employee_code] : row[2]);
    if (!rawCode) continue;
    const code = rawCode.toUpperCase();
    if (!EMP_RE.test(code)) continue;                 // skip TOTAL / note rows
    if (/^(tong|cong|t\d+ n\d+)/i.test(code)) continue;

    const fields = {};
    const sourceDetail = {};
    const rawCells = {};
    for (const key of T.CANONICAL_KEYS) {
      const col = map[key];
      if (col == null) continue;
      const cell = row[col];
      const fdef = T.FIELD_BY_KEY.get(key);
      let val;
      if (fdef.text || fdef.kind === 'identity' || fdef.kind === 'ref' || fdef.kind === 'flag' || fdef.kind === 'raw_only') {
        val = T.text(cell);
      } else {
        val = T.num(cell);
      }
      if (val == null) continue;
      rawCells[key] = T.text(cell);
      if (T.REPORTING_CORE.has(key)) fields[key] = val;
      else sourceDetail[key] = val;
      if (fdef.kind === 'raw_only') { delete fields[key]; sourceDetail[key] = val; } // D8: never a Truth field
    }
    // D4: fold rate-detail holiday-work days under one concept + keep detail
    if (sourceDetail.att_holiday_work_800k_days != null || sourceDetail.att_holiday_work_500k_days != null) {
      sourceDetail.att_holiday_work_days = sum(sourceDetail.att_holiday_work_days, sourceDetail.att_holiday_work_800k_days, sourceDetail.att_holiday_work_500k_days) || sourceDetail.att_holiday_work_days;
    }

    const merged = Object.assign({}, fields, sourceDetail);
    const reconciliation = [];
    for (const c of CHECKS) {
      const lhs = c.lhs(merged), rhs = c.rhs(merged);
      if (lhs == null || rhs == null) continue;
      const dv = Math.round((lhs - rhs) * 100) / 100;
      if (Math.abs(dv) > TOL) {
        reconciliation.push({ check: c.key, label: c.label, uploaded: lhs, calculated: rhs, difference: dv });
      }
    }

    if (seenCodes.has(code)) {
      fileWarnings.push({ type: 'DUPLICATE_EMPLOYEE_IN_FILE', employeeCode: code, rows: [seenCodes.get(code), r + 1] });
    } else seenCodes.set(code, r + 1);

    records.push({
      sourceRowIndex: r + 1,
      employeeCode: code,
      fullName: T.text(map.full_name != null ? row[map.full_name] : null),
      fields, sourceDetail, rawCells, reconciliation,
    });
  }

  return {
    ok: true,
    header: hdr,
    records,
    rowCount: records.length,
    fileWarnings,
    reconciliationWarningCount: records.reduce((n, x) => n + x.reconciliation.length, 0),
  };
}

// Compare a new version's records against the current effective version.
// unchanged -> no delta ; changed -> before/after per field ; added ; removed(warn).
function diffVersions(prevRecords, nextRecords) {
  const prev = new Map((prevRecords || []).map((x) => [x.employeeCode, x]));
  const next = new Map((nextRecords || []).map((x) => [x.employeeCode, x]));
  const deltas = [];
  const missing = [];
  for (const [code, nrec] of next) {
    const prec = prev.get(code);
    if (!prec) { deltas.push({ employeeCode: code, changeType: 'added' }); continue; }
    const pAll = Object.assign({}, prec.fields, prec.sourceDetail);
    const nAll = Object.assign({}, nrec.fields, nrec.sourceDetail);
    const keys = new Set([...Object.keys(pAll), ...Object.keys(nAll)]);
    for (const k of keys) {
      const a = pAll[k], b = nAll[k];
      const same = (a == null && b == null) || (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 0.005 : String(a) === String(b));
      if (!same) deltas.push({ employeeCode: code, changeType: 'changed', field: k, before: a == null ? null : a, after: b == null ? null : b });
    }
  }
  for (const [code] of prev) if (!next.has(code)) missing.push(code);
  return { deltas, missing, added: deltas.filter((d) => d.changeType === 'added').map((d) => d.employeeCode) };
}

module.exports = { normalizeGrid, diffVersions, CHECKS };
