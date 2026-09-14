'use strict';

// PHF HR — QTTH Truth Data · "Chi phí xử lý" (Processing cost) · header/column map.
//
// Fixed 3-column schema, in this exact order: MÃ NV | HỌ VÀ TÊN | CHI PHÍ XỬ LÝ.
// Unlike Payroll (T7, ~90 columns, group+label+number 3-row header, schema-drift
// machinery), this source has NO schema-drift step at all (per spec): a
// straightforward, case/whitespace/diacritics-tolerant header-NAME match is
// sufficient. Column ORDER in the uploaded file does not matter — only the
// header names matter — but the canonical downloadable template always emits
// them in the locked order above.

function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const HEADER_MATCH = {
  employee_code: /^ma nv$/,
  employee_name: /^ho va ten$/,
  amount: /^chi phi xu ly$/,
};

// Locate the header row (scan first 15 rows) — the row that contains BOTH
// "MÃ NV" and "CHI PHÍ XỬ LÝ" (case/diacritics/whitespace tolerant).
function locateHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const nn = (rows[i] || []).map(norm);
    if (nn.some((c) => HEADER_MATCH.employee_code.test(c)) && nn.some((c) => HEADER_MATCH.amount.test(c))) {
      return { headerRow: i, dataStart: i + 1 };
    }
  }
  return null;
}

// Build { field -> colIndex } from the header row, by NAME match (never by
// fixed index) — tolerant of column re-ordering in an uploaded file.
function buildColumnMap(rows) {
  const hdr = locateHeader(rows);
  if (!hdr) return { ok: false, header: null, map: null, missingCore: ['employee_code', 'employee_name', 'amount'] };
  const labels = (rows[hdr.headerRow] || []).map(norm);
  const map = {};
  for (let c = 0; c < labels.length; c++) {
    for (const key of Object.keys(HEADER_MATCH)) {
      if (map[key] == null && HEADER_MATCH[key].test(labels[c])) map[key] = c;
    }
  }
  const missingCore = Object.keys(HEADER_MATCH).filter((k) => map[k] == null);
  return { ok: missingCore.length === 0, header: hdr, map, missingCore };
}

const crypto = require('crypto');
function fingerprint(rows) {
  const built = buildColumnMap(rows);
  if (!built.ok) return { ok: false, error: 'PROCESSING_COST_HEADER_NOT_FOUND' };
  const keys = Object.keys(built.map).sort();
  const canon = keys.map((k) => k + '@' + built.map[k]).join('|');
  const hash = crypto.createHash('sha256').update('PHF_PROCESSINGCOST_V1|' + canon).digest('hex').slice(0, 32);
  return { ok: true, fingerprint: hash, columnMap: built.map, header: built.header, missingCore: built.missingCore };
}

function num(v) {
  if (v == null || v === '') return null;
  const s = String(v).replace(/[,\s]/g, '').replace(/[^0-9.\-]/g, '');
  if (s === '' || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function text(v) { const s = String(v == null ? '' : v).trim(); return s === '' ? null : s; }

module.exports = { norm, num, text, locateHeader, buildColumnMap, fingerprint };
