'use strict';
/*
 * PHF QTTH — generate the DOWNLOADABLE payroll template
 *   assets/templates/PHF_Payroll_Canonical_V1.xlsx
 *
 * TWO layers, kept strictly separate (Operator lock):
 *   1. DATA STRUCTURE / SCHEMA  = T07 canonical (docs/payroll-corpus/T7_CANONICAL.tsv)
 *      1:1 — every header row, group header, column label, blank structural
 *      cell, column position and order is copied verbatim. Same column map =>
 *      same fingerprint 82b1b54c2bc2. NOTHING renamed/added/removed/moved.
 *   2. VISUAL PRESENTATION       = added for monthly use: column widths, merged
 *      group headers, freeze panes, header shading (PHF green), wrap, money
 *      number format, borders. Presentation is NEVER a parser dependency.
 *
 * Sanitised (values only, never structure): the T07 period, company MST, and
 * the reference constants above the header. Every employee row is dropped.
 *
 * Re-run when the canonical T07 structure changes; commit the .xlsx.
 * Run: node scripts/qtth-payroll-generate-canonical-template.js
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const TPL = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-template'));
const { gridToXlsx } = require(path.join(REPO, 'scripts/lib/xlsx-write-lite'));

const SRC = path.join(REPO, 'docs/payroll-corpus/T7_CANONICAL.tsv');
const OUT = path.join(REPO, 'assets/templates/PHF_Payroll_Canonical_V1.xlsx');
const TEMPLATE_VERSION = 1;
const TEMPLATE_NAME = 'PHF Payroll Canonical V1';
const VERSION_MARKER = 'PHF_PAYROLL_TEMPLATE_VERSION=' + TEMPLATE_VERSION;

function readTsv(p) {
  let s = fs.readFileSync(p, 'utf8');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return s.split(/\r?\n/).map((l) => l.split('\t'));
}
function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; }

function build() {
  const src = readTsv(SRC);
  const hdr = TPL.locateHeader(src);
  if (!hdr) throw new Error('locateHeader failed on canonical source');
  const width = src[hdr.labelRow].length;

  // ---- LAYER 1: structure 1:1 — keep rows [0 .. numberRow] verbatim ----
  const grid = src.slice(0, hdr.numberRow + 1).map((r) => {
    const row = r.slice();
    while (row.length < width) row.push('');
    return row;
  });

  // ---- sanitise VALUES in the banner block only (never the 3 header rows) ----
  for (let r = 0; r < hdr.groupRow; r++) {
    const row = grid[r] || (grid[r] = []);
    for (let c = 0; c < row.length; c++) {
      let v = String(row[c] == null ? '' : row[c]);
      if (!v) continue;
      // drop the T07 period token from the banner title
      v = v.replace(/\s*T\d{1,2}\/\d{4}\s*/g, ' ').replace(/\s+$/, '');
      // "MST: 3703182824" -> "MST:"  (drop the company tax id)
      v = v.replace(/^(MST\s*:).*/i, '$1');
      // blank a bare reference constant (standard-day count / rate)
      if (/^-?\d+(?:[.,]\d+)?$/.test(v.trim())) v = '';
      row[c] = v;
    }
  }
  // NO instruction / guide row is added — the sheet stays a clean T07 layout.

  // ---- which columns are numeric (money number format on data area) ----
  const canonMap = TPL.buildColumnMap(src).map;
  const numericCols = new Set();
  for (const [k, c] of Object.entries(canonMap)) {
    const def = TPL.FIELD_BY_KEY.get(k);
    if (def && TPL.NUMERIC_KINDS.has(def.kind)) numericCols.add(c);
  }

  // ---- LAYER 2: presentation ----
  // group-header merges: each non-empty group cell spans to the col before the next
  const g = grid[hdr.groupRow];
  const merges = [];
  let start = null;
  for (let c = 0; c <= width; c++) {
    const filled = c < width && String(g[c] == null ? '' : g[c]).trim() !== '';
    if (filled || c === width) {
      if (start != null && (c - 1) > start) {
        merges.push(colName(start) + (hdr.groupRow + 1) + ':' + colName(c - 1) + (hdr.groupRow + 1));
      }
      if (filled) start = c;
    }
  }

  // column widths: identity/text columns wider, numeric medium
  const idText = new Set([1, 3, 4, 5, 6]); // MST, HỌ VÀ TÊN, CHI NHÁNH, MÃ HT, BẬC LƯƠNG
  const cols = [];
  for (let c = 0; c < width; c++) {
    let w = 11;
    if (c === 0) w = 5;                 // STT
    else if (c === 2) w = 12;           // MÃ NV
    else if (idText.has(c)) w = c === 3 ? 26 : 16;
    else if (numericCols.has(c)) w = 13;
    cols.push({ min: c + 1, max: c + 1, width: w });
  }

  // per-cell styles: the 3 header rows are styled EDGE-TO-EDGE (every column,
  // filled or structurally blank) so the header band is continuous AND all
  // T07 columns are emitted (column-count parity, incl. trailing blank cols).
  const cellStyles = {};
  for (let c = 0; c < width; c++) {
    cellStyles[colName(c) + (hdr.groupRow + 1)] = 'groupHeader';
    cellStyles[colName(c) + (hdr.labelRow + 1)] = 'colHeader';
    cellStyles[colName(c) + (hdr.numberRow + 1)] = 'numRow';
  }
  for (let r = 0; r < hdr.groupRow; r++) {
    for (let c = 0; c < width; c++) {
      const v = String((grid[r] || [])[c] == null ? '' : grid[r][c]).trim();
      if (v) cellStyles[colName(c) + (r + 1)] = (r <= 2 ? 'banner' : 'bannerSub');
    }
  }

  // data-area column styles: numeric -> money, everything else -> text
  const colStyles = {};
  for (let c = 0; c < width; c++) colStyles[c + '-' + c] = numericCols.has(c) ? 'money' : 'text';

  const style = {
    cols,
    merges,
    rowHeights: { [hdr.groupRow + 1]: 46, [hdr.labelRow + 1]: 64, [hdr.numberRow + 1]: 16 },
    freeze: { rows: hdr.numberRow + 1, cols: 4 }, // freeze through number row + first 4 columns
    cellStyles,
    colStyles,
    dataStartRow: hdr.dataStart + 1, // 1-based
  };

  const xlsx = gridToXlsx(grid, {
    sheetName: TEMPLATE_NAME,
    description: 'PHF HR — ' + TEMPLATE_NAME + '. Mẫu bảng lương chuẩn (cấu trúc T07 1:1). Không chứa dữ liệu nhân viên thật.',
    keywords: VERSION_MARKER,
    style,
  });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, xlsx);
  return { grid, hdr, width, merges, numericCols: [...numericCols].sort((a, b) => a - b), bytes: xlsx.length };
}

if (require.main === module) {
  const r = build();
  console.log('wrote ' + path.relative(REPO, OUT) + '  (' + r.bytes + ' bytes)');
  console.log('rows kept: ' + r.grid.length + '  header group=' + r.hdr.groupRow + ' label=' + r.hdr.labelRow + ' number=' + r.hdr.numberRow + '  width=' + r.width + '  0 data rows');
  console.log('group merges: ' + r.merges.length + '   numeric cols: ' + r.numericCols.length);
  console.log('version : ' + VERSION_MARKER + '  (docProps only; not in the sheet body)');
}

module.exports = { build, OUT, SRC, TEMPLATE_VERSION, TEMPLATE_NAME, VERSION_MARKER };
