'use strict';

// PHF HR — QTTH Truth Data · "Chi phí xử lý" · grid -> normalized records.
//
// Pure functions, NO DB, NO network. employee_code is ALWAYS handled as TEXT
// (never Number()-coerced) — this is the identity key (LOCKED), employee_name
// is display/reference only and NEVER used for identity matching.
//
// Duplicate employee_code WITHIN one uploaded file: LOCKED rule (tightened) —
// NEVER pick a winner. Every employee_code that appears more than once in the
// same file is excluded ENTIRELY from the persisted/normalized set (none of
// its conflicting rows is stored) and reported as an explicit NEEDS_REVIEW
// blocker with every row + value involved. The upload cannot be confirmed
// while any duplicate remains — see qtth-processing-cost.js confirmImport().

const T = require('./qtth-processing-cost-template');

const EMP_RE = /^[A-Z0-9_.]{2,32}$/i;

function normalizeGrid(rows, columnMap) {
  const hdr = T.locateHeader(rows);
  if (!hdr) return { ok: false, error: 'PROCESSING_COST_HEADER_NOT_FOUND' };
  const map = columnMap;

  const allRecords = []; // in file order, BEFORE dedupe
  for (let r = hdr.dataStart; r < rows.length; r++) {
    const row = rows[r] || [];
    const rawCode = T.text(map.employee_code != null ? row[map.employee_code] : null);
    if (!rawCode) continue; // blank row — skip
    const code = rawCode.toUpperCase();
    if (!EMP_RE.test(code)) continue; // skip TOTAL / note rows, same precedent as payroll
    if (/^(tong|cong)/i.test(code)) continue;

    const name = T.text(map.employee_name != null ? row[map.employee_name] : null);
    const amount = T.num(map.amount != null ? row[map.amount] : null);

    allRecords.push({
      sourceRowIndex: r + 1, // 1-based, for the validation report
      employeeCode: code,    // TEXT — never coerced to a number
      employeeName: name,
      amount,                // numeric or null (reported as a warning below)
    });
  }

  // ---- duplicate employee_code within one file: NEVER choose a winner -----
  // Locked rule (tightened): any employee_code appearing more than once in
  // this file is entirely excluded from `records` (nothing is persisted for
  // it, no value is silently picked) and reported in `fileWarnings` as an
  // explicit NEEDS_REVIEW blocker naming every row + value involved. The
  // caller (qtth-processing-cost.js) must refuse confirmImport while any
  // duplicateInFile entry exists.
  const rowsByCode = new Map();
  for (const rec of allRecords) {
    if (!rowsByCode.has(rec.employeeCode)) rowsByCode.set(rec.employeeCode, []);
    rowsByCode.get(rec.employeeCode).push(rec);
  }
  const fileWarnings = [];
  const duplicateCodes = new Set();
  for (const [code, recs] of rowsByCode) {
    if (recs.length > 1) {
      duplicateCodes.add(code);
      fileWarnings.push({
        type: 'DUPLICATE_EMPLOYEE_IN_FILE',
        status: 'NEEDS_REVIEW',
        employeeCode: code,
        rows: recs.map((r) => r.sourceRowIndex),
        amounts: recs.map((r) => r.amount),
      });
    }
  }

  const missingAmount = [];
  // records = every UNIQUE employee_code in the file (duplicates excluded
  // entirely — see above), in file order.
  const records = allRecords.filter((rec) => !duplicateCodes.has(rec.employeeCode))
    .sort((a, b) => a.sourceRowIndex - b.sourceRowIndex);
  for (const rec of records) {
    if (rec.amount == null) missingAmount.push(rec.employeeCode);
  }

  return {
    ok: true,
    header: hdr,
    records,          // unique codes only — what actually gets persisted
    allRecords,       // raw, in-file-order — kept for traceability/tests only
    rowCount: records.length,
    fileWarnings,
    duplicateCodes: [...duplicateCodes],
    missingAmount,
  };
}

// Compare a new version's records against the previously active version of
// the same period. Mirrors payroll's diffVersions shape (added/changed/missing).
function diffVersions(prevRecords, nextRecords) {
  const prev = new Map((prevRecords || []).map((x) => [x.employeeCode, x]));
  const next = new Map((nextRecords || []).map((x) => [x.employeeCode, x]));
  const deltas = [];
  const missing = [];
  for (const [code, nrec] of next) {
    const prec = prev.get(code);
    if (!prec) { deltas.push({ employeeCode: code, changeType: 'added' }); continue; }
    const a = prec.amount, b = nrec.amount;
    const same = (a == null && b == null) || (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 0.005 : String(a) === String(b));
    if (!same) deltas.push({ employeeCode: code, changeType: 'changed', field: 'amount', before: a == null ? null : a, after: b == null ? null : b });
  }
  for (const [code] of prev) if (!next.has(code)) missing.push(code);
  return { deltas, missing, added: deltas.filter((d) => d.changeType === 'added').map((d) => d.employeeCode) };
}

module.exports = { normalizeGrid, diffVersions };
