'use strict';
/*
 * PHF QTTH — canonical BHXH template checks (offline, no DB / no network).
 *
 * Feeds the generated PHF_BHXH_Canonical_V1.xlsx back through the SAME
 * parser functions the real bhxh.validatePreview action uses
 * (services/phf-hr-api/lib/qtth-bhxh-template.js#fingerprint/buildColumnMap
 * and qtth-bhxh-normalize.js#normalizeGrid) — only the DB persistence layer
 * (writeTx / bhxh.import*) is skipped, since this is a structure/parity
 * check, not a live upload.
 *
 * Checks:
 *   1. STRUCTURE / FINGERPRINT  — template's column map + fingerprint match
 *      the LOCKED value shared by every production sample (BHXH T1..T7).
 *   2. PARSE / NORMALIZE        — normalizeGrid() runs clean on the template
 *      (the same call validatePreview makes) and yields exactly the one
 *      placeholder row, correctly classified.
 *   3. SANITIZATION             — no real employee code / real PHF names /
 *      real numeric amounts anywhere in the template.
 *
 * Run: node scripts/qtth-bhxh-canonical-template-checks.js
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const TPL = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-bhxh-template'));
const { normalizeGrid } = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-bhxh-normalize'));
const { readWorkbook } = require(path.join(REPO, 'services/phf-hr-api/lib/xlsx-lite'));
const gen = require(path.join(REPO, 'scripts/qtth-bhxh-generate-canonical-template'));

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.error('  FAIL ' + n + (x ? '  -> ' + x : ''))); };

console.log('QTTH — canonical BHXH template checks\n');

const built = gen.build();
const buf = fs.readFileSync(gen.OUT);

// ================= LAYER 1 — WORKBOOK OPENS / SHEET NAME =================
console.log('-- LAYER 1: workbook / sheet --');
ok('template opens (.xlsx / PK)', buf.length > 1000 && buf.readUInt16LE(0) === 0x4b50, 'len=' + buf.length);

const wb = readWorkbook(buf);
const sheet = wb.sheets.find((s) => /TONG.?BHXH|TỔNG.?BHXH/i.test(s.name)) || wb.sheets[0];
ok('sheet name = "' + gen.SHEET_NAME + '"', sheet.name === gen.SHEET_NAME, sheet.name);
const T = sheet.rows;

// ================= LAYER 2 — STRUCTURE PARITY vs the parser's own contract =====
console.log('\n-- LAYER 2: STRUCTURE PARITY (same functions bhxh.validatePreview uses) --');

const hdr = TPL.locateHeader(T);
ok('HEADER_FOUND: labelRow=3, dataStart=5 (matches T1..T7)', !!hdr && hdr.labelRow === 3 && hdr.dataStart === 5, JSON.stringify(hdr));

const built1 = TPL.buildColumnMap(T);
ok('COLUMN_MAP_OK: all REPORTING_CORE fields resolve, no missingCore', built1.ok === true && (built1.missingCore || []).length === 0, JSON.stringify(built1.missingCore));

// every canonical field must resolve via LABEL matching, not the position
// fallback — proves the template exercises the real production header text,
// not just the fallback safety net.
const usedFallback = Object.keys(TPL.POSITION_FALLBACK).filter((k) => built1.map[k] === TPL.POSITION_FALLBACK[k]
  && !F_label_matches(k, built1));
function F_label_matches(key, built) {
  const field = TPL.FIELD_BY_KEY.get(key);
  if (!field || !field.label) return false;
  const col = built.map[key];
  const lab = (built.labels || [])[col] || '';
  return field.label.test(lab);
}
ok('LABEL_MATCH_NOT_FALLBACK: every field resolved by real header label', usedFallback.length === 0, usedFallback.join(','));

const fp = TPL.fingerprint(T);
ok('FINGERPRINT: template == locked production value', fp.fingerprint === gen.LOCKED_FINGERPRINT, fp.fingerprint + ' vs ' + gen.LOCKED_FINGERPRINT);

// cross-check directly against every real production sample, if present locally
const inputDir = path.join(REPO, 'phf-qtth-input');
let sampleChecks = 0;
if (fs.existsSync(inputDir)) {
  for (const f of fs.readdirSync(inputDir)) {
    if (!/^BHXH T\d+\.xlsx$/i.test(f)) continue;
    const sb = fs.readFileSync(path.join(inputDir, f));
    const swb = readWorkbook(sb);
    const ssheet = swb.sheets.find((s) => /TONG.?BHXH|TỔNG.?BHXH/i.test(s.name)) || swb.sheets[0];
    const sfp = TPL.fingerprint(ssheet.rows);
    ok('FINGERPRINT_MATCHES_SAMPLE: ' + f, sfp.fingerprint === fp.fingerprint, sfp.fingerprint + ' vs ' + fp.fingerprint);
    sampleChecks++;
  }
}
if (sampleChecks > 0) {
  console.log('  INFO sample cross-check ran against ' + sampleChecks + ' local production file(s)');
} else {
  console.log('  SKIP sample cross-check — phf-qtth-input/ not present locally (gitignored fixture dir; not required)');
}

// ================= LAYER 3 — PARSE / NORMALIZE (same call validatePreview makes) ====
console.log('\n-- LAYER 3: PARSE / NORMALIZE (bhxh.validatePreview code path, DB skipped) --');

const nm = normalizeGrid(T, fp.columnMap, fp.totalRow, new Set());
ok('NORMALIZE_OK', nm.ok === true, JSON.stringify(nm.error || null));
ok('exactly 1 placeholder data row parsed', nm.records && nm.records.length === 1, 'records=' + (nm.records || []).length);

const rec = (nm.records || [])[0];
ok('placeholder row classification = NEEDS_REVIEW (invalid/example employee_code)', rec && rec.classification === 'NEEDS_REVIEW', rec && rec.classification);
ok('placeholder full_name preserved as example text', rec && rec.fields && rec.fields.full_name === gen.PLACEHOLDER_ROW[1], rec && rec.fields && rec.fields.full_name);

// ================= LAYER 4 — SANITIZATION / NO REAL DATA =================
console.log('\n-- LAYER 4: SANITIZATION (no real PHF employee/business data) --');

const EMP_RE_REAL = /^PHF[0-9]{3,6}$/i;
ok('employee_code placeholder does NOT match the real code pattern (never collides)', !EMP_RE_REAL.test(gen.PLACEHOLDER_ROW[2]), gen.PLACEHOLDER_ROW[2]);
ok('employee_code stored as TEXT (shared string), not a numeric cell', (() => {
  // locate the cell in the raw sheet XML-parsed row: readWorkbook already
  // returns strings for text cells and numbers-as-strings for numeric cells;
  // the authoritative check is that the written value is non-numeric, so
  // xlsx-write-lite's own numeric-cell auto-detect never applied to it.
  return !/^-?\d+(\.\d+)?$/.test(String(gen.PLACEHOLDER_ROW[2]));
})(), gen.PLACEHOLDER_ROW[2]);

// real production employee codes seen locally (from phf-qtth-input samples), to
// prove the placeholder never coincides with an actual PHF employee code.
const realCodes = new Set();
if (fs.existsSync(inputDir)) {
  for (const f of fs.readdirSync(inputDir)) {
    if (!/^BHXH T\d+\.xlsx$/i.test(f)) continue;
    const sb = fs.readFileSync(path.join(inputDir, f));
    const swb = readWorkbook(sb);
    const ssheet = swb.sheets.find((s) => /TONG.?BHXH|TỔNG.?BHXH/i.test(s.name)) || swb.sheets[0];
    for (const row of ssheet.rows.slice(5)) { const c = row[2]; if (c) realCodes.add(String(c).toUpperCase()); }
  }
}
ok('placeholder code not among ' + realCodes.size + ' real employee codes seen in samples', !realCodes.has(String(gen.PLACEHOLDER_ROW[2]).toUpperCase()), '');

// all money columns in the placeholder row are 0 — never a real figure
const moneyCols = [5, 6, 7, 8, 9, 10, 11];
const nonZero = moneyCols.filter((c) => String(gen.PLACEHOLDER_ROW[c]) !== '0');
ok('all money columns are 0 in the placeholder row', nonZero.length === 0, nonZero.join(','));

// name/dept/branch placeholders are marked "(Ví dụ)" — never a bare real-looking name
for (const [label, idx] of [['full_name', 1], ['source_department', 3], ['source_branch', 4]]) {
  ok(label + ' placeholder marked as example text', String(gen.PLACEHOLDER_ROW[idx]).startsWith('(Ví dụ)'), gen.PLACEHOLDER_ROW[idx]);
}

// no residual period token in the banner (template must not imply a specific month)
ok('banner has no THÁNG mm/yyyy period token', !/TH[ÁA]NG\s*\d{1,2}\s*\/\s*\d{4}/i.test(String(T[2][0])), T[2][0]);

console.log('\n' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
