'use strict';

// PHF HR — QTTH Truth Data · PHF BHXH Canonical Template V1.
//
// Sheet "TỔNG_BHXH" — ONE header label row directly above the data (no group
// row, no number-run row like payroll's T7 template), and the data block is
// terminated by the sheet's OWN "TỔNG TIỀN" row rather than running to EOF.
// Verified against phf-qtth-input/BHXH T1..T7.xlsx: header label row is
// consistently index 3, data starts at index 5 (index 4 is a blank spacer),
// the total row is found by scanning for a first-cell "TỔNG…" label.
//
// LOCKED business contract (Operator):
//   D-BHXH-01  employer_cost_source ("TK 642 (21.5%)") is taken VERBATIM.
//              Never recalculated. Never inferred from TK334/employee columns.
//   D-BHXH-02  the CN/branch column's own header text says "Ngày tháng năm
//              sinh" but the column's actual data is the branch name (e.g.
//              "PHÚ LỢI") — a known header/data mismatch in the source
//              export. Mapped by fixed position (col 4, immediately after
//              "phòng ban") with this comment as the paper trail; never
//              trust that column's header text.

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

// ---- CANONICAL FIELD REGISTRY (label-based; column-position fallback below) --
const F = [];
const add = (key, kind, opts) => F.push(Object.assign({ key, kind }, opts));

add('employee_code', 'identity', { label: /^id$/ });
add('full_name', 'identity', { label: /^ho va ten$/ });
add('source_department', 'ref', { label: /^phong ban$/ });
add('source_branch', 'ref', { label: /ngay thang nam sinh/ }); // D-BHXH-02: header text is wrong; position-confirmed
add('base_salary_bhxh', 'base', { label: /muc luong.*bhxh/ });
add('employer_cost_source', 'base', { label: /^tk 642/ }); // D-BHXH-01: THE authoritative field
add('employee_bhxh_tk334', 'base', { label: /^tk 334/ });
add('bhxh_amount', 'base', { label: /^bhxh$/ });
add('bhyt_employer_45pct', 'base', { label: /tra.*4.?5.*bhyt/ });
add('bhyt_prepaid', 'base', { label: /thu tien truoc bhyt/ });
add('employee_total_contribution', 'base', { label: /tong tien nv dong/ });

const CANONICAL_KEYS = F.map((f) => f.key);
const FIELD_BY_KEY = new Map(F.map((f) => [f.key, f]));

// Fields promoted to real DB columns (bhxh.normalized) vs. staying in source_detail.
const REPORTING_CORE = new Set([
  'employee_code', 'full_name', 'source_department', 'source_branch',
  'base_salary_bhxh', 'employer_cost_source', 'employee_bhxh_tk334', 'bhxh_amount',
  'bhyt_employer_45pct', 'bhyt_prepaid', 'employee_total_contribution',
]);

// Fixed column-position fallback (0-based), matching the confirmed live layout.
// Used when label matching alone is ambiguous/fails for a given field.
const POSITION_FALLBACK = {
  employee_code: 2, full_name: 1, source_department: 3, source_branch: 4,
  base_salary_bhxh: 5, employer_cost_source: 6, employee_bhxh_tk334: 7,
  bhxh_amount: 8, bhyt_employer_45pct: 9, bhyt_prepaid: 10, employee_total_contribution: 11,
};

// ---- HEADER DETECTION -------------------------------------------------------
// Label row = the one containing normalized labels "id" and "ho va ten".
// dataStart = labelRow + 2 if the row right after the label row is fully
// blank (the confirmed spacer-row layout), else labelRow + 1.
function locateHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const nn = (rows[i] || []).map(norm);
    if (nn.includes('id') && nn.includes('ho va ten')) {
      const afterBlank = !(rows[i + 1] || []).some((c) => text(c));
      const dataStart = afterBlank ? i + 2 : i + 1;
      return { labelRow: i, dataStart };
    }
  }
  return null;
}

// Scan forward from dataStart for the sheet's own grand-total row (first cell
// matches /^tổng/i). Returns { totalRowIndex, dataEnd, sourceTotalEmployerCost }
// or null if no total row is found (preview must still work — flagged as a
// warning, never a hard failure, since the source total is only used for
// reconciliation display, not as a gate).
function locateTotalRow(rows, hdr, employerCostCol) {
  const start = hdr ? hdr.dataStart : 0;
  for (let i = start; i < rows.length; i++) {
    const c0 = text((rows[i] || [])[0]);
    if (c0 && /^t[oổ]ng/i.test(norm(c0))) {
      const cost = employerCostCol != null ? num((rows[i] || [])[employerCostCol]) : null;
      return { totalRowIndex: i, dataEnd: i, sourceTotalEmployerCost: cost };
    }
  }
  return null;
}

function buildColumnMap(rows) {
  const hdr = locateHeader(rows);
  if (!hdr) return { ok: false, error: 'BHXH_HEADER_NOT_FOUND' };
  const labels = (rows[hdr.labelRow] || []).map(norm);
  const width = Math.max(labels.length, ...(rows.slice(hdr.dataStart, hdr.dataStart + 5).map((r) => r.length)));
  const map = {};
  const usedCols = new Set();

  for (let c = 0; c < width; c++) {
    const lab = labels[c] || '';
    for (const field of F) {
      if (map[field.key] != null) continue;
      if (usedCols.has(c)) continue;
      if (field.label && field.label.test(lab)) { map[field.key] = c; usedCols.add(c); break; }
    }
  }
  // position fallback for anything label matching missed (covers the known
  // header/data mismatch on source_branch, and guards against label drift
  // across T1–T7 without silently dropping a reporting-core field).
  for (const key of REPORTING_CORE) {
    if (map[key] == null && POSITION_FALLBACK[key] != null && !usedCols.has(POSITION_FALLBACK[key])) {
      map[key] = POSITION_FALLBACK[key];
      usedCols.add(POSITION_FALLBACK[key]);
    }
  }
  const missingCore = [...REPORTING_CORE].filter((k) => map[k] == null);
  const totalRow = locateTotalRow(rows, hdr, map.employer_cost_source);
  return { ok: missingCore.length === 0, map, header: hdr, missingCore, width, labels, totalRow };
}

// ---- FINGERPRINT ------------------------------------------------------------
const crypto = require('crypto');
function fingerprint(rows) {
  const built = buildColumnMap(rows);
  if (!built.ok && !built.map) return { ok: false, error: built.error };
  const keys = Object.keys(built.map || {}).sort();
  const canon = keys.map((k) => k + '@' + built.map[k]).join('|');
  const hash = crypto.createHash('sha256').update('PHF_BHXH_V1|' + canon).digest('hex').slice(0, 32);
  return {
    ok: built.ok, fingerprint: hash, columnMap: built.map, header: built.header,
    missingCore: built.missingCore, labels: built.labels, totalRow: built.totalRow,
  };
}

module.exports = {
  norm, num, text,
  CANONICAL_KEYS, FIELD_BY_KEY, REPORTING_CORE, POSITION_FALLBACK,
  locateHeader, locateTotalRow, buildColumnMap, fingerprint,
};
