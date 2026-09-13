# PHF HR / QTTH — TRUTH DATA PROD BOOTSTRAP · PHASE 1
## FREEZE + MANIFEST + PROMOTION PACKAGE · NO PROD WRITE

Ngày: 2026-09-09 · Branch `feat/qtth-accounting-data-v1` · **NO PROD WRITE / NO PROD DEPLOY / NO PUSH**

---

## FINAL HANDOVER BLOCK

```
QTTH_TRUTH_BOOTSTRAP_PHASE1 = PASS

CURRENT_BRANCH = feat/qtth-accounting-data-v1
CURRENT_HEAD   = 870ba552e38944f7df442cebdf886ae701f974a5  (+ this commit)
WORKTREE_STATUS = clean (tracked); untracked = pre-existing handover .md's + this batch's new files

PAYROLL_FOUNDATION_LINEAGE   = base 7b36b05 "fix(qtth/payroll): canonical template = T07 1:1" (payroll module IS on this branch's base)
ACCOUNTING_FOUNDATION_LINEAGE = 131ebf6 → 6d376ba (decision layer) → 870ba55, all on feat/qtth-accounting-data-v1

LOCAL_TEST_DB       = throwaway phf_hr_e2e   (container phf-hr-e2e-throwaway-20260827T123257Z)
DRY_RUN_TARGET_DB   = throwaway phf_hr_bootstrap (fresh scratch DB in the same container)
PROD_DB            = phf_hr on container phf-postgres (VPS, ssh claude-phf)
SUPABASE_MAIN_REF     = byhpcexmjzqpctyvfczd   (People Master — NOT touched)
SUPABASE_SANDBOX_REF  = pxkjvawdrixgoukhyvnk   (PHF-HR-DEV — read only)

PAYROLL_LOCAL_PERIODS     = T01–T07 (source = docs/payroll-corpus/, Operator real workbooks verbatim)
PAYROLL_BOOTSTRAP_PERIODS = 2026-01 · 2026-02 · 2026-03 · 2026-04 · 2026-05 · 2026-06 · 2026-07

PAYROLL_T01 = 2026-01 · 44 rows · fp 742242d7f53f (older layout) · personnel-cost 582,875,916 · reconc 582,875,915 · Δ +1 · reconciled=true · status confirmed
PAYROLL_T02 = 2026-02 · 44 rows · fp 10c641565633 (older layout) · personnel-cost 626,605,726 · reconc 626,605,728 · Δ -2 · reconciled=true · status confirmed
PAYROLL_T03 = 2026-03 · 52 rows · fp 251a25948631 (older layout) · personnel-cost 631,769,040 · reconc 631,769,044 · Δ -4 · reconciled=true · status confirmed
PAYROLL_T04 = 2026-04 · 51 rows · fp 3b2cfe7bf8ff (older layout) · personnel-cost 570,604,633 · reconc 570,604,633 · Δ  0 · reconciled=true · status confirmed
PAYROLL_T05 = 2026-05 · 49 rows · fp 82b1b54c2bc2 (canonical-compatible) · personnel-cost 560,957,961 · reconc 560,957,960 · Δ +1 · reconciled=true · status confirmed
PAYROLL_T06 = 2026-06 · 47 rows · fp 82b1b54c2bc2 (canonical-compatible) · personnel-cost 554,860,101 · reconc 554,860,100 · Δ +1 · reconciled=true · status confirmed
PAYROLL_T07 = 2026-07 · 44 rows · fp 82b1b54c2bc2 (CANONICAL TEMPLATE V1) · personnel-cost 562,741,327 · reconc 562,741,326 · Δ +1 · reconciled=true · status confirmed
T05/T06/T07 share fingerprint 82b1b54c2bc2 — T07 is the canonical template; T01–T04 are older source layouts, each fully mapped (missingCore=[]).
PAYROLL_NORMALIZED_ROWS_TOTAL = 331

ACCOUNTING_T07_ROWS    = 350
ACCOUNTING_T07_INCLUDE = 334   amount 1,026,022,214
ACCOUNTING_T07_EXCLUDE = 16    amount 22,725,465
ACCOUNTING_T07_REVIEW  = 0     amount 0
ACCOUNTING_T07_TOTAL   = 1,048,747,679          (INCLUDE + EXCLUDE + REVIEW = 350 ; 1,026,022,214 + 22,725,465 = 1,048,747,679)
ACCOUNTING_T07 status  = CONFIRMED (import_file V1 confirmed 2026-09-09 11:13:54Z, import active)
ACCOUNTING_T07 operator-decided source rows = 51  (44 operator_item + 7 operator_rule ; 299 engine)

ACCOUNTING_ACTIVE_OPERATOR_RULES  = 43
ACCOUNTING_DISABLED_OPERATOR_RULES = 0
ACCOUNTING_RULE_HISTORY_ROWS      = 43
ACCOUNTING_ITEM_DECISIONS         = 44
ACCOUNTING_COST_DICTIONARY_VERSION = 1
ACCOUNTING_COST_DICTIONARY_ROWS    = 170
  All 43 operator rules are account + deterministic description (allTokens) — accountOnlyRules = 0.
  CCDC: the Operator's LOCAL confirmed state is "Bút toán phân bổ CCDC" -> EXCLUDE (one such rule per unresolved account,
        8 accounts). Phase 2 promotes this EXACTLY — no new policy invented.
  PHF-MKT: source value kept verbatim, ma_bp_out_of_master=true on its rows.

PROMOTION_BUNDLE_ID   = QTTH_TRUTH_BOOTSTRAP_V1_2026-09-09
PROMOTION_BUNDLE_PATH = docs/qtth-truth-bootstrap/  (committable) + scripts/qtth-truth-bootstrap/_secure/  (GITIGNORED)
CONFIDENTIAL_PAYLOAD_GITIGNORED = PASS
  committable  : docs/qtth-truth-bootstrap/{manifest,payroll_periods,accounting_summary,checksums}.json
                 — counts / fingerprints / totals / rule SHAPE only. NO salary, NO customer/vendor rows,
                   NO invoice refs, NO rule text.
  gitignored   : scripts/qtth-truth-bootstrap/_secure/payroll_payload.secure.json     (960 KB — employee-level salary)
                 scripts/qtth-truth-bootstrap/_secure/accounting_payload.secure.json  (446 KB — 350 vendor/customer rows + 43 rules + history + dict)
                 scripts/qtth-truth-bootstrap/_secure/dryrun-target.env
                 scripts/qtth-truth-bootstrap/_secure/import-report-*.json

PROD_PRECHECK = PASS (read-only)
  PROD_PAYROLL_SCHEMA           = ABSENT
  PROD_ACCOUNTING_SCHEMA        = ABSENT
  PROD_QTTH_SCHEMA              = ABSENT   (foundation not on PROD either)
  PROD_PAYROLL_EXISTING_PERIODS = none
  PROD_ACCOUNTING_EXISTING_PERIODS = none
  PROD schemas present today   = audit, competition, notice, system, task   (roles phf_hr_owner + phf_hr_app exist)
PROD_EXISTING_TRUTH_COLLISION = NO   (greenfield)

DRY_RUN_THROWAWAY      = PASS  (fresh phf_hr_bootstrap: payroll 331 inserts + accounting full set, 0 conflict)
IDEMPOTENT_REPLAY      = PASS  (re-run APPLY: payroll skip 331 / accounting normalized 0 / 0 duplicate truth)
CONFLICT_FAIL_CLOSED   = PASS  (mutated 1 target row -> importer reports CONFLICT, ROLLBACK, target unchanged, no bootstrap_log row)
APPLY_TO_SCRATCH       = PASS  (committed; parity-check 52/52)
PAYROLL_PARITY_CHECKER_READY    = YES  (scripts/qtth-truth-bootstrap/parity-check.js)
ACCOUNTING_PARITY_CHECKER_READY = YES  (same script)
ROLLBACK_PLAN_READY = YES  (migrations *_DOWN.sql ; apply is all-or-nothing per schema ; bundle is re-runnable)

PROD_WRITE = NO
PROD_DB_CHANGE = NO
SUPABASE_MAIN_WRITE = NO
PROD_DEPLOY = NO
PUSH = NO
```

---

## 1. WHAT WILL BE PROMOTED IN PHASE 2

**PAYROLL** (schema `payroll`) — 7 historical periods 2026-01 … 2026-07, each as a single
CONFIRMED baseline version:
- `payroll.import` (1/period, status active) + `payroll.import_file` (version 1, status confirmed,
  sha256 of the source TSV, template fingerprint)
- `payroll.template` (fingerprints: 4 older + 1 canonical `82b1b54c2bc2`)
- `payroll.normalized` — 331 employee rows total (canonical reporting-core fields, verbatim uploaded
  values, warn-only reconciliation notes)
- `payroll.raw_row` — provenance stub per employee row

**ACCOUNTING** (schema `accounting`) — period 2026-07 CONFIRMED truth:
- `accounting.import` + `accounting.import_file` (V1 confirmed, funnel counters, report jsonb)
- `accounting.normalized` — 350 cost-scope rows (verbatim FAST fields + classification +
  decision_source + cost_code)
- `accounting.item_decision` — 44 Operator per-line decisions (append-only)
- `accounting.classification_rule` (origin='operator') — 43 remembered rules
  (account_exact + description allTokens; id = `op-<sig12>` derived from match_signature)
- `accounting.rule_history` — 43 audit rows (append-only)
- `accounting.cost_dictionary` V1 + `accounting.cost_dictionary_entry` — 170 entries
- `accounting.bootstrap_log` — 1 audit row (bundle_id, checksums, summary)

## 2. WHAT WILL **NOT** BE PROMOTED

- The 13 SEED classification rules — created by the migration itself, not promoted.
- The ~85,975 raw FAST source rows — NEVER persisted as fact (RAW_ROWS_SAVED_AS_FACT = 0).
- The raw FAST .xlsx / payroll .xlsx binaries — stay in `phf-qtth-input/` / operator machine (gitignored).
- Throwaway surrogate UUIDs (`import.id`, `import_file.id`) — regenerated on PROD by the importer.
- Any e2e / scratch / test data, any other module's data.
- Payroll T08+ and Accounting T08+ — BLOCKED (see §5).

## 3. EXACT PROD ACTIONS PHASE 2 WOULD PERFORM

1. **Migrations** (as `phf_hr_owner`, transactional, `ON_ERROR_STOP`), in order — additive, greenfield:
   `phf_hr_qtth_foundation_v1.sql` · `phf_hr_qtth_payroll_v1.sql` · `phf_hr_qtth_accounting_v1.sql`
   · `phf_hr_qtth_accounting_v2.sql` · `phf_hr_qtth_truth_bootstrap_log.sql`
2. **QTTH access bootstrap** (business decision — NOT in this package): at least one
   `qtth.permission_manager_grant` (or rely on system Admin) so the module is reachable, + Vercel/phf-hr-api
   `PHF_QTTH_BRIDGE_ENABLED` + QTTH env. *This is a separate "QTTH module goes to PROD" decision.*
3. **Bundle import** — `node scripts/qtth-truth-bootstrap/import.js --target-env <PROD db.env> --apply`
   - verifies every payload sha256 against `checksums.json` first (fail-closed)
   - ONE transaction per schema; any CONFLICT → ROLLBACK that schema, STOP
   - natural keys only: payroll `(period_month, employee_code)`; accounting `(period_month, source_row_index)`,
     rules `match_signature`, dict `source_sha256`; existing identical rows → SKIP; existing + different → CONFLICT
   - writes `accounting.bootstrap_log` on success
4. **Parity gate** — `node scripts/qtth-truth-bootstrap/parity-check.js --target-env <PROD db.env>`
   must be **PASS** (52/52) before anything else proceeds.

## 4. RISKS / BLOCKERS

| # | Item | Status |
|---|---|---|
| B1 | **PII IN GIT (pre-existing):** `docs/payroll-corpus/T1..T7.tsv` + `scripts/fixtures/payroll/T1..T7.tsv` are the Operator's **real** payroll workbooks (names + salary + MST), **committed** on this branch's base (payroll batch, not this work). This branch is NOT pushed. **If it is ever pushed, real salaries reach GitHub.** Needs an Operator/security decision (history rewrite or keep local-only). This batch did NOT add to it and did NOT commit any new payroll payload. |
| B2 | QTTH module is not on PROD at all (no `qtth` schema, no Vercel/phf-hr-api QTTH env, no permission grants). The truth bootstrap depends on that broader "QTTH → PROD" go-live. Separate decision. |
| B3 | Payroll DB truth does not exist locally as confirmed rows — only 2 stray e2e periods in the throwaway. The promotion payload is **regenerated deterministically** from the pinned corpus via the shipped normalizer (T1–T7 offline suite 32/32). This is NOT "re-uploading" — it is the same confirmed truth the tests prove. Operator should accept this provenance path. |
| B4 | Reconciliation deltas are 0–4 VND per period (rounding in the source workbooks). `reconciled=true` at tolerance = max(5, rowCount). Consistent with the prior "within a few VND" note. |
| B5 | Payroll `raw_row` provenance is a stub (`{}`) — the byte-exact source is the pinned TSV (sha256 in `checksums.json` + `README.txt`), not re-embedded per cell. Acceptable for a historical baseline; flag if full per-cell raw is required. |
| B6 | The local SSH tunnel to the throwaway is fragile (dropped twice this session). Not a PROD risk; noted for whoever re-runs the dry-run. |

## 5. EXPECTED PROD PARITY VALUES (Phase 2 gate — must match EXACTLY)

**ACCOUNTING (2026-07):**
```
cost rows        = 350
INCLUDE          = 334   / 1,026,022,214
EXCLUDE          = 16    / 22,725,465
NEEDS_REVIEW     = 0     / 0
cost-scope total = 1,048,747,679
item decisions   = 44
operator rules   = 43 active / 0 disabled   (0 account-only)
rule history     = 43
cost dictionary  = 170 entries (V1)
PHF-MKT rows flagged out-of-master = true
911 double-count in normalized     = 0
raw 85,975 fact rows               = 0
```
**PAYROLL:** every period present + active + confirmed; normalized row count, template fingerprint and
personnel-cost total per period exactly as in `PAYROLL_T01..T07` above.

## 6. T08 GATE

T08 (payroll and accounting) is **BLOCKED** until, on PROD:
`PAYROLL_T01_T07_PROD_PARITY = PASS` **AND** `ACCOUNTING_T07_PROD_PARITY = PASS` **AND**
`ACCOUNTING_MEMORY_PROD_PARITY = PASS` (rules + history + decisions + dictionary).
Only then may the Operator upload real T08 once on PROD.

---

## FILES ADDED THIS PHASE (all committable except `_secure/`)

```
migrations/phf_hr_qtth_truth_bootstrap_log.sql (+_DOWN)   — accounting.bootstrap_log audit table (additive, idempotent)
scripts/qtth-truth-bootstrap/build-package.js             — reads local canonical truth -> promotion bundle
scripts/qtth-truth-bootstrap/import.js                    — dry-run / apply importer (idempotent, fail-closed, natural keys)
scripts/qtth-truth-bootstrap/parity-check.js              — post-apply parity gate
docs/qtth-truth-bootstrap/manifest.json                   — bundle manifest (sanitized)
docs/qtth-truth-bootstrap/payroll_periods.json            — per-period aggregates (NO salary)
docs/qtth-truth-bootstrap/accounting_summary.json         — parity + rule shape/counts (NO customer rows / rule text)
docs/qtth-truth-bootstrap/checksums.json                  — sha256 of every payload + source
.gitignore                                                — + /scripts/qtth-truth-bootstrap/_secure/
```

**STOP. WAIT FOR OPERATOR / CHATGPT APPROVAL BEFORE ANY PROD WRITE.**
