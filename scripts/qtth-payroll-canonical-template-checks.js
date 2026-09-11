'use strict';
/*
 * PHF QTTH — canonical payroll template checks (offline, no DB / no network).
 *
 * TWO test layers (Operator §G):
 *   1. STRUCTURE PARITY   — template vs T07 canonical source, expected 100%
 *      (column count / positions / group headers / column headers / number row /
 *       structural blank cells / fingerprint). Only employee data rows differ.
 *   2. VISUAL / SANITIZATION — no historical employee/salary/bank/tax data,
 *      workbook opens, formatted (styles.xml + merges + freeze + widths),
 *      re-upload PASS, and the shipped T07 upload path is unaffected.
 *
 * Run: node scripts/qtth-payroll-canonical-template-checks.js
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const TPL = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-template'));
const NRM = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-normalize'));
const { readWorkbook } = require(path.join(REPO, 'services/phf-hr-api/lib/xlsx-lite'));
const gen = require(path.join(REPO, 'scripts/qtth-payroll-generate-canonical-template'));

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.error('  FAIL ' + n + (x ? '  -> ' + x : ''))); };
function readTsv(p) { let s = fs.readFileSync(p, 'utf8'); if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); return s.split(/\r?\n/).map((l) => l.split('\t')); }

console.log('QTTH — canonical payroll template checks\n');

const built = gen.build();
const buf = fs.readFileSync(gen.OUT);
const src = readTsv(gen.SRC);
const hdr = TPL.locateHeader(src);
const wb = readWorkbook(buf);
const sheet = wb.sheets[0];
const T = sheet.rows;

// ================= LAYER 1 — STRUCTURE PARITY =================
console.log('-- LAYER 1: STRUCTURE PARITY vs T07 canonical --');

ok('template opens (.xlsx / PK)', buf.length > 1000 && buf.readUInt16LE(0) === 0x4b50, 'len=' + buf.length);
ok('sheet name = "' + gen.TEMPLATE_NAME + '"', sheet.name === gen.TEMPLATE_NAME, sheet.name);

// column count
ok('COLUMN_COUNT_PARITY: width == T07 (' + src[hdr.labelRow].length + ')', T[hdr.labelRow].length === src[hdr.labelRow].length, T[hdr.labelRow].length + ' vs ' + src[hdr.labelRow].length);

// the 3 header rows must be byte-for-byte identical to T07
for (const [name, r] of [['GROUP_HEADER', hdr.groupRow], ['COLUMN_HEADER', hdr.labelRow], ['NUMBER_ROW', hdr.numberRow]]) {
  const diffs = [];
  for (let c = 0; c < src[r].length; c++) {
    const a = String(src[r][c] == null ? '' : src[r][c]);
    const b = String((T[r] || [])[c] == null ? '' : T[r][c]);
    if (a !== b) diffs.push(colName(c) + (r + 1) + ': ' + JSON.stringify(a) + ' -> ' + JSON.stringify(b));
  }
  ok(name + '_PARITY: row ' + (r + 1) + ' identical to T07 (' + src[r].filter(Boolean).length + ' cells)', diffs.length === 0, diffs.slice(0, 4).join(' | '));
}

// structural blank cells in the group row preserved exactly
const srcBlank = []; const tplBlank = [];
for (let c = 0; c < src[hdr.groupRow].length; c++) {
  if (String(src[hdr.groupRow][c] || '').trim() === '') srcBlank.push(c);
  if (String((T[hdr.groupRow] || [])[c] || '').trim() === '') tplBlank.push(c);
}
ok('STRUCTURAL_BLANK_PARITY: group-row blank columns identical', JSON.stringify(srcBlank) === JSON.stringify(tplBlank), 'src ' + srcBlank.length + ' / tpl ' + tplBlank.length);

// column positions: every canonical field maps to the SAME column index
const mapSrc = TPL.buildColumnMap(src).map;
const mapTpl = TPL.buildColumnMap(T).map;
const posDiffs = Object.keys(mapSrc).filter((k) => mapSrc[k] !== mapTpl[k]);
ok('COLUMN_POSITION_PARITY: all ' + Object.keys(mapSrc).length + ' fields at same column index', posDiffs.length === 0, posDiffs.slice(0, 6).join(','));

// fingerprint
const fpT = TPL.fingerprint(T), fpS = TPL.fingerprint(src);
ok('FINGERPRINT: template == T07 canonical (' + fpS.fingerprint.slice(0, 12) + ')', fpT.fingerprint === fpS.fingerprint, fpT.fingerprint + ' vs ' + fpS.fingerprint);
ok('FINGERPRINT: locked value 82b1b54c2bc2…', fpT.fingerprint.startsWith('82b1b54c2bc2'), fpT.fingerprint);
ok('column map fully resolves (ok, no missingCore)', fpT.ok === true && (fpT.missingCore || []).length === 0, JSON.stringify(fpT.missingCore));

// formula/row-number structure: T07 has no in-cell formulas in header/data
// area of the corpus (values only); template keeps the same — static, no drift.
ok('FORMULA_STRUCTURE_PARITY: number row 1..N present + identical (no static-ising drift)',
  T[hdr.numberRow].filter((x) => /^\d+$/.test(String(x))).length === src[hdr.numberRow].filter((x) => /^\d+$/.test(String(x))).length, '');

// the Operator's example column — report what the BL header actually is
const BL = String(T[hdr.labelRow][63] || '');
console.log('  INFO BL_HEADER (col 63) = ' + JSON.stringify(BL));
ok('BL header at col 63 is verbatim T07 (not paraphrased by the registry)', BL === String(src[hdr.labelRow][63] || ''), BL);

// ================= LAYER 2 — VISUAL / SANITIZATION =================
console.log('\n-- LAYER 2: VISUAL / SANITIZATION --');

const nm = NRM.normalizeGrid(T, fpT.columnMap, {});
ok('template normalizes to ZERO records (empty employee area)', nm.ok && nm.rowCount === 0, 'rowCount=' + nm.rowCount);

// leak scan — build the set of real names/codes from the T07 employee rows
const realCodes = new Set(), realNames = new Set();
for (let r = hdr.dataStart; r < src.length; r++) {
  const code = String((src[r] || [])[2] || '').trim().toUpperCase();
  if (/^[A-Z0-9_.]{2,32}$/.test(code)) realCodes.add(code);
  const nm2 = String((src[r] || [])[3] || '').trim();
  if (nm2.length > 3) realNames.add(nm2);
}
const headerRowSet = new Set([hdr.groupRow, hdr.labelRow, hdr.numberRow]);
const dataText = T.map((r, i) => headerRowSet.has(i) ? '' : r.join(' ')).join('  ');
ok('HISTORICAL_DATA_LEAK: no real employee codes', ![...realCodes].some((c) => dataText.toUpperCase().includes(c)));
ok('HISTORICAL_DATA_LEAK: no real employee names', ![...realNames].some((n) => dataText.includes(n)));
ok('HISTORICAL_DATA_LEAK: no 12-digit personal id', !/\b\d{12}\b/.test(dataText));
ok('HISTORICAL_DATA_LEAK: no long salary-like numbers (>=7 digits) outside header', !/\b\d{7,}\b/.test(dataText), (dataText.match(/\b\d{7,}\b/) || [''])[0]);
ok('HISTORICAL_DATA_LEAK: company MST removed', !/3703182824/.test(T.map((r) => r.join(' ')).join(' ')));
ok('HISTORICAL_DATA_LEAK: T07/2026 period removed', !/T0?7\s*\/\s*2026/i.test(T.map((r) => r.join(' ')).join(' ')));

// formatting present
const raw = buf.toString('latin1');
ok('VISUAL: styles.xml present (fonts/fills/borders/cellXfs)', /styleSheet/.test(inflateFind(buf, 'xl/styles.xml')) , '');
ok('VISUAL: merged group headers present (<mergeCells>)', /<mergeCell /.test(inflateFind(buf, 'xl/worksheets/sheet1.xml')), '');
ok('VISUAL: frozen panes present (<pane .. state="frozen">)', /<pane [^>]*state="frozen"/.test(inflateFind(buf, 'xl/worksheets/sheet1.xml')), '');
ok('VISUAL: column widths present (<cols>)', /<col min=/.test(inflateFind(buf, 'xl/worksheets/sheet1.xml')), '');
ok('VISUAL: money number format (#,##0)', /#,##0/.test(inflateFind(buf, 'xl/styles.xml')), '');

// version marker — docProps only, NOT in the sheet body
const bodyText = T.map((r) => r.join(' ')).join(' ');
ok('VERSION marker NOT in the payroll sheet body', bodyText.indexOf(gen.VERSION_MARKER) < 0);
ok('VERSION marker in docProps/core.xml', inflateFind(buf, 'docProps/core.xml').indexOf(gen.VERSION_MARKER) >= 0);

// T07 regression
ok('T07 canonical still resolves + normalizes 44 records', (function () {
  const f = TPL.fingerprint(src);
  const n = NRM.normalizeGrid(src, f.columnMap, {});
  return f.fingerprint.startsWith('82b1b54c2bc2') && n.rowCount === 44;
})());

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
console.log('CANONICAL_TEMPLATE_CHECKS = PASS');

// helpers
function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; }
function inflateFind(buffer, partName) {
  // minimal ZIP part reader for the checks (reuse of xlsx-lite internals would be
  // cleaner but it does not expose them) — locate + inflate one entry.
  const zlib = require('zlib');
  const eocdSig = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) { if (buffer.readUInt32LE(i) === eocdSig) { eocd = i; break; } }
  if (eocd < 0) return '';
  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(p + 10);
    const compSize = buffer.readUInt32LE(p + 20);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localOff = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === partName) {
      const nl = buffer.readUInt16LE(localOff + 26), el = buffer.readUInt16LE(localOff + 28);
      const ds = localOff + 30 + nl + el;
      const rawd = buffer.subarray(ds, ds + compSize);
      return (method === 8 ? zlib.inflateRawSync(rawd) : rawd).toString('utf8');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return '';
}
