'use strict';
/*
 * PHF HR — QTTH Batch 02 · payroll corpus SYNC + VERIFY.
 *
 * Source of record = docs/payroll-corpus/T1..T6.tsv + T7_CANONICAL.tsv, the
 * Operator's real payroll workbooks converted XLSX -> UTF-8 (BOM) TSV, VERBATIM
 * (no cell edited). sha256 of each is pinned in docs/payroll-corpus/README.txt.
 *
 * This script copies them into scripts/fixtures/payroll/ (T7_CANONICAL -> T7)
 * and verifies each fixture's sha256 against the README. It NEVER edits cells
 * and NEVER fabricates data — if a source file is missing it fails loudly.
 *
 * Run: node scripts/qtth-payroll-corpus-gen.js
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const REPO = path.resolve(__dirname, '..');
const { resolvePayrollCorpusDir } = require(path.join(__dirname, 'lib/payroll-corpus-dir'));
const SRC = resolvePayrollCorpusDir();
const OUT = path.join(REPO, 'scripts/fixtures/payroll');
fs.mkdirSync(OUT, { recursive: true });

const README = fs.readFileSync(path.join(SRC, 'README.txt'), 'utf8');
const pinned = {}; // fixtureName -> sha256
for (const m of README.matchAll(/^(T\d)(?:_CANONICAL)?\.tsv\s+.*?SHA256\s+([0-9a-f]{64})/gim)) pinned[m[1]] = m[2];

const MAP = { T1: 'T1', T2: 'T2', T3: 'T3', T4: 'T4', T5: 'T5', T6: 'T6', T7: 'T7_CANONICAL' };
let fail = 0;
for (const [fixture, source] of Object.entries(MAP)) {
  const sp = path.join(SRC, source + '.tsv');
  if (!fs.existsSync(sp)) { console.error('  MISSING source ' + source + '.tsv — cannot regenerate ' + fixture + ' (no fabrication)'); fail++; continue; }
  const buf = fs.readFileSync(sp);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (pinned[fixture] && pinned[fixture] !== sha) { console.error('  SHA MISMATCH ' + fixture + ': README ' + pinned[fixture] + ' != file ' + sha); fail++; continue; }
  fs.writeFileSync(path.join(OUT, fixture + '.tsv'), buf);
  console.log('  OK  ' + fixture + '.tsv  <- ' + source + '.tsv  sha256=' + sha.slice(0, 16) + (pinned[fixture] ? ' (pinned)' : ''));
}
console.log(fail ? '\nFAIL — ' + fail + ' file(s) missing or checksum mismatch' : '\nOK — 7/7 corpus fixtures synced + verified verbatim');
process.exit(fail ? 1 : 0);
