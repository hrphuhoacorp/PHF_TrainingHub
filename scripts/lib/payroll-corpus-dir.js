'use strict';
// PHF HR — QTTH Payroll corpus location resolver.
//
// The T1–T7 payroll corpus is the Operator's REAL workbooks (names + salary +
// per-employee tax IDs). It is NEVER committed. It lives in a gitignored local
// path and is supplied to the tests / package builder from there.
//
// Resolution order:
//   1. $PHF_PAYROLL_CORPUS_DIR                                  (explicit)
//   2. scripts/qtth-truth-bootstrap/_secure/payroll-corpus/     (default secure local path — gitignored)
//   3. docs/payroll-corpus/                                     (legacy; only README remains tracked)
//
// Each dir is expected to hold T1.tsv … T6.tsv + T7_CANONICAL.tsv (+ README.txt).
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');

function resolvePayrollCorpusDir() {
  const candidates = [
    process.env.PHF_PAYROLL_CORPUS_DIR,
    path.join(REPO, 'scripts/qtth-truth-bootstrap/_secure/payroll-corpus'),
    path.join(REPO, 'docs/payroll-corpus'),
  ].filter(Boolean);
  for (const d of candidates) {
    try { if (fs.existsSync(path.join(d, 'T7_CANONICAL.tsv'))) return d; } catch (_) {}
  }
  const e = new Error(
    'Payroll corpus not found. Set PHF_PAYROLL_CORPUS_DIR or place T1..T6.tsv + T7_CANONICAL.tsv in '
    + 'scripts/qtth-truth-bootstrap/_secure/payroll-corpus/ (gitignored — the corpus contains real employee salary and is never committed).');
  e.code = 'PAYROLL_CORPUS_MISSING';
  throw e;
}

module.exports = { resolvePayrollCorpusDir, REPO };
