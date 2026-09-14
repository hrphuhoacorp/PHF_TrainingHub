'use strict';

// PHF HR — QTTH Truth Data · BHXH grid -> normalized records.
//
// Deliberate divergence from payroll's normalizeGrid: a row missing/malformed
// employee_code is NEVER skipped (D-BHXH-03, locked adjustment #3) — it is
// always persisted (raw + normalized), classified NEEDS_REVIEW instead. The
// only rows excluded from `records` are non-employee structural rows (no
// name at all — e.g. a blank spacer or a rate-reference row like T3's row 4)
// and the sheet's own trailing "TỔNG TIỀN" total row (excluded by the caller
// via totalRow.dataEnd, not here).
//
// employer_cost_source is read VERBATIM from the mapped TK642 column only —
// never derived from base_salary_bhxh*0.215 or from TK334/employee columns
// (D-BHXH-01), even for the malformed row where that would "fill the gap".

const T = require('./qtth-bhxh-template');

const EMP_RE = /^PHF[0-9]{3,6}$/i;

// knownCodes: the canonical QTTH Phân quyền roster (Supabase People Master,
// same source as `loadOrgRows()` / `knownEmployeeCodes` elsewhere), supplied
// by the caller — this module stays a pure function, no I/O of its own.
// A row auto-matches ("match chắc -> auto, không hỏi Admin") only when its
// employee_code is BOTH well-formed AND actually present in that roster;
// format-valid-but-unknown-to-QTTH now correctly falls to NEEDS_REVIEW
// instead of being silently treated as matched. If knownCodes is empty/not
// supplied (e.g. the roster fetch failed upstream), the roster check is
// skipped rather than treating every row as unknown — same fail-open
// convention already used for the informational unknownEmployeeCodes list.
function normalizeGrid(rows, columnMap, totalRowInfo, knownCodes) {
  const map = columnMap;
  const hdr = T.locateHeader(rows);
  if (!hdr) return { ok: false, error: 'BHXH_HEADER_NOT_FOUND' };

  const dataEnd = totalRowInfo && totalRowInfo.dataEnd != null ? totalRowInfo.dataEnd : rows.length;
  const records = [];
  const seenCodes = new Map();
  const fileWarnings = [];

  for (let r = hdr.dataStart; r < dataEnd; r++) {
    const row = rows[r] || [];
    const nameCell = T.text(map.full_name != null ? row[map.full_name] : row[1]);
    if (!nameCell) continue; // not an employee data row (blank spacer / rate-reference row)

    const rawCodeText = T.text(map.employee_code != null ? row[map.employee_code] : row[2]);
    const code = rawCodeText ? rawCodeText.toUpperCase() : null;
    const idValid = !!(code && EMP_RE.test(code));

    const fields = {};
    const sourceDetail = {};
    const rawCells = {};
    for (const key of T.CANONICAL_KEYS) {
      const col = map[key];
      if (col == null) continue;
      const cell = row[col];
      const fdef = T.FIELD_BY_KEY.get(key);
      const val = (fdef.kind === 'identity' || fdef.kind === 'ref') ? T.text(cell) : T.num(cell);
      if (val == null) continue;
      rawCells[key] = T.text(cell);
      if (T.REPORTING_CORE.has(key)) fields[key] = val;
      else sourceDetail[key] = val;
    }

    // D-BHXH-01: employer_cost_source is verbatim only — never fabricated
    // even when it reads null/blank for a malformed row.
    const employerCostSource = fields.employer_cost_source == null ? 0 : fields.employer_cost_source;

    const rosterActive = !!(knownCodes && knownCodes.size);
    const inRoster = !rosterActive || (idValid && knownCodes.has(code));

    let classification, reviewReason;
    if (!code) { classification = 'NEEDS_REVIEW'; reviewReason = 'MISSING_EMPLOYEE_CODE'; }
    else if (!idValid) { classification = 'NEEDS_REVIEW'; reviewReason = 'INVALID_EMPLOYEE_CODE_FORMAT'; }
    else if (!inRoster) { classification = 'NEEDS_REVIEW'; reviewReason = 'EMPLOYEE_CODE_NOT_IN_QTTH_ROSTER'; }
    else { classification = 'MATCHED'; reviewReason = null; }

    if (code) {
      if (seenCodes.has(code)) {
        fileWarnings.push({ type: 'DUPLICATE_EMPLOYEE_IN_FILE', employeeCode: code, rows: [seenCodes.get(code), r + 1] });
      } else seenCodes.set(code, r + 1);
    }

    records.push({
      sourceRowIndex: r + 1,
      employeeCode: code,
      fullName: nameCell,
      fields, sourceDetail, rawCells,
      employerCostSource,
      classification, reviewReason,
    });
  }

  const employerCostTotal = records.reduce((s, x) => s + (x.employerCostSource || 0), 0);
  const needsReview = records.filter((x) => x.classification === 'NEEDS_REVIEW');

  return {
    ok: true,
    header: hdr,
    records,
    rowCount: records.length,
    fileWarnings,
    employerCostTotal: Math.round(employerCostTotal * 100) / 100,
    needsReviewCount: needsReview.length,
    needsReviewAmount: Math.round(needsReview.reduce((s, x) => s + (x.employerCostSource || 0), 0) * 100) / 100,
  };
}

// Diff key: employeeCode when resolved, else a stable row-based key so
// multiple unresolved rows never collapse into one diff bucket.
function diffKey(rec) { return rec.employeeCode || ('row:' + rec.sourceRowIndex); }

function diffVersions(prevRecords, nextRecords) {
  const prev = new Map((prevRecords || []).map((x) => [diffKey(x), x]));
  const next = new Map((nextRecords || []).map((x) => [diffKey(x), x]));
  const deltas = [];
  const missing = [];
  for (const [key, nrec] of next) {
    const prec = prev.get(key);
    if (!prec) { deltas.push({ key, employeeCode: nrec.employeeCode, sourceRowIndex: nrec.sourceRowIndex, changeType: 'added' }); continue; }
    const pAll = Object.assign({ employerCostSource: prec.employerCostSource }, prec.fields, prec.sourceDetail);
    const nAll = Object.assign({ employerCostSource: nrec.employerCostSource }, nrec.fields, nrec.sourceDetail);
    const keys = new Set([...Object.keys(pAll), ...Object.keys(nAll)]);
    // employee_code is the match key — never a diffable business field.
    // full_name and the snake_case employer_cost_source are asymmetric
    // between the DB-loaded prev record (kept as top-level columns/props,
    // not inside `fields`) and a fresh parse's `fields` (which includes
    // every REPORTING_CORE key verbatim) — excluded here so a record with
    // no real change never gets a spurious 'changed' entry. The actual
    // employer cost comparison already happens via the `employerCostSource`
    // key present in both pAll and nAll.
    keys.delete('employee_code');
    keys.delete('full_name');
    keys.delete('employer_cost_source');
    for (const k of keys) {
      const a = pAll[k], b = nAll[k];
      const same = (a == null && b == null) || (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 0.005 : String(a) === String(b));
      if (!same) deltas.push({ key, employeeCode: nrec.employeeCode, sourceRowIndex: nrec.sourceRowIndex, changeType: 'changed', field: k, before: a == null ? null : a, after: b == null ? null : b });
    }
  }
  for (const [key, prec] of prev) if (!next.has(key)) missing.push({ key, employeeCode: prec.employeeCode, sourceRowIndex: prec.sourceRowIndex });
  return { deltas, missing, added: deltas.filter((d) => d.changeType === 'added') };
}

module.exports = { normalizeGrid, diffVersions, EMP_RE };
