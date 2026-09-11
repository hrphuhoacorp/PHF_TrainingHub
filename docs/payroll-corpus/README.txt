PHF HR / QTTH — Payroll corpus T1–T7.

The corpus files (T1.tsv … T6.tsv + T7_CANONICAL.tsv) are the Operator's REAL
payroll workbooks converted XLSX -> UTF-8 (BOM) TSV, VERBATIM (no cell edited).
They contain real employee names, salary and per-employee tax IDs and are
therefore NEVER committed to git.

Location (gitignored, local only):
  scripts/qtth-truth-bootstrap/_secure/payroll-corpus/
  or $PHF_PAYROLL_CORPUS_DIR

Resolved by scripts/lib/payroll-corpus-dir.js for every payroll test and the
QTTH Truth Data bootstrap package builder.

sha256 (pinned — a promotion bundle must match these):
  T1.tsv          d547cc0aa50bedda616fb2d89bc266f5660c0a37a86ed8a8a09ad1c50b13fd6f
  T2.tsv          1aef82d1e02cac6e714add50a6c0fa753227a4663e6b4eea313e84c0eeb252d7
  T3.tsv          0164e97e2e89fab197a0f400641113a1cf7e5210dad70d42e63e5da3b965f9a5
  T4.tsv          61e7675f80750dd34304955b6ef02bf1b4d466ec7a09b3250051bfaae9b73f08
  T5.tsv          bc48d8a0ca210b9c60bf38438e8763bd4b1f9e5e85feb3e0c1b15b2fff9391b4
  T6.tsv          26e0683c2127240ca49fc4fa2d136a90e30de29120affb3a9e196d20bc807e34
  T7_CANONICAL.tsv eb3b5ad8c2ecac8fb344f18563fe9b88a8ff2d981e09049af85e5ba8d2b9bc3e
