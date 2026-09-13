# PHF QTTH — TRUTH DATA PROD BOOTSTRAP V1 · PHASE 1.5
## SECURITY CLEANUP + PROD READINESS · NO PROD WRITE

Ngày: 2026-09-09 · Branch `feat/qtth-accounting-data-v1` · **NO PROD WRITE / NO PROD DEPLOY / NO SUPABASE MAIN WRITE / NO PUSH**

---

## FINAL OUTPUT

```
QTTH_BOOTSTRAP_PHASE1_5 = PASS

PAYROLL_PII_TRACKED_FILES      = 0
PAYROLL_PII_IN_BRANCH_HISTORY  = 0
SECURE_PAYROLL_SOURCE_PRESERVED = PASS

PAYROLL_PACKAGE_REBUILT = PASS
PAYROLL_T01_T07_PARITY  = PASS   (52/52 parity-check on fresh throwaway; per-period counts + cost totals + fingerprints exact)

QTTH_PROD_FOUNDATION_PLAN = PASS  (planned, NOT applied)
PROD_MIGRATION_ORDER =
  1. migrations/phf_hr_qtth_foundation_v1.sql          (schema qtth: permission_manager_grant, module_permission,
                                                        dict_unit/dict_group, classification, *_history)
  2. migrations/phf_hr_qtth_payroll_v1.sql             (schema payroll)
  3. migrations/phf_hr_qtth_accounting_v1.sql          (schema accounting + 13 seed classification rules)
  4. migrations/phf_hr_qtth_accounting_v2.sql          (accounting decision layer: +origin/cost_code/match_signature,
                                                        rule_history, item_decision, normalized.decision_source)
  5. migrations/phf_hr_qtth_truth_bootstrap_log.sql    (accounting.bootstrap_log audit)
  (all additive · phf_hr_owner · transactional · ON_ERROR_STOP · greenfield on PROD)

PROD_ENV_REQUIRED / PROD_ENV_MISSING  (names only — NO values):
  phf-hr-api container (phf-hr-api on phf-postgres host):
    PRESENT  : PHF_HR_DB_HOST · PHF_HR_DB_PORT · PHF_HR_DB_NAME · PHF_HR_DB_RUNTIME_USER · PHF_HR_DB_RUNTIME_PASSWORD
               · PHF_HR_ATTACHMENT_ROOT · PHF_HR_API_SERVICE_TOKEN · TASK_QUERY_DESCRIPTOR_SIGNING_SECRET
    MISSING  : (none new) — /v1/qtth is Bearer-only, no per-service flag (same pattern as /v1/notice, /v1/audit).
    ACTION   : deploy a phf-hr-api image that CONTAINS the qtth-service code (lib/qtth-service.js + qtth-payroll*.js
               + qtth-accounting*.js). Current PROD image predates QTTH.
    QTTH_DEV_ACCESS_ALLOW = leave UNSET on PROD  → dev-lock OFF = GO-LIVE (normal Admin / permission_manager rules).
  Vercel (project phf-training-hub / team hrphuhoacorp):
    PRESENT  : PHF_HR_API_BASE_URL · PHF_HR_API_SERVICE_TOKEN · PHF_NOTICE_BRIDGE_ENABLED · PHF_COMPETITION_BRIDGE_ENABLED
    MISSING  : PHF_QTTH_BRIDGE_ENABLED   → must be set = "true" (Production) for the QTTH module + Truth Data screens.
  Company PostgreSQL:
    PRESENT  : database phf_hr, roles phf_hr_owner + phf_hr_app (both exist on PROD).
    MISSING  : schemas qtth / payroll / accounting (created by the migrations above).
  Secrets: NONE new. Reuses the existing phf-hr-api service-token already shared by Task/Competition/Notice.
  Supabase MAIN: read-only (People Master) — no change, no new key.

  QTTH ACCESS BOOTSTRAP (business decision, NOT in the truth package):
    at least one qtth.permission_manager_grant row (or rely on system Admin) so the module opens for the Operator.
    API routing: /api/data (Vercel) already dispatches qtth actions; /api/qtth-accounting-upload rewrite is in vercel.json.

BRANCH_BASE_VS_ORIGIN_MAIN = merge-base == origin/main HEAD == 8e443ab (PR#49 notice-uiux, build 1.70.5)
COMMITS_BEHIND  = 0
COMMITS_AHEAD   = 20   (whole QTTH foundation + payroll module + accounting V1/V2 + decision layer + bootstrap + PII cleanup)
REBASE_OR_MERGE_REQUIRED = NO   (branch already sits on the current origin/main tip; contains all of main)

FRESH_THROWAWAY_REHEARSAL = PASS
  fresh phf_hr_bootstrap DB → 5 migrations in PROD order → dry-run (331 payroll + full accounting, 0 conflict)
  → apply (committed) → replay APPLY (payroll skip 331 / accounting normalized 0, 0 duplicate truth)
  → conflict test (mutated 1 row → CONFLICT → ROLLBACK, target unchanged, no bootstrap_log row)
  → parity-check 52/52 PASS
ACCOUNTING_T07_PARITY = PASS   (350 · 334 INCLUDE / 1,026,022,214 · 16 EXCLUDE / 22,725,465 · 0 REVIEW · total 1,048,747,679)
ACCOUNTING_MEMORY_PARITY = PASS   (44 item_decisions · 43 operator rules active / 0 disabled · 43 rule_history
                                   · Cost Dictionary V1 170 entries · 0 account-only rules · PHF-MKT flagged
                                   · 0 contra-911 · 0 raw-85k fact rows)
IDEMPOTENT_REPLAY = PASS
CONFLICT_FAIL_CLOSED = PASS

SAFE_FOR_PHASE2_PROD_APPLY = YES (mechanics) — but Phase 2 STILL BLOCKED on the two decisions below.

PROD_WRITE = NO   PROD_DEPLOY = NO   SUPABASE_MAIN_WRITE = NO   PUSH = NO
```

---

## 1 · BLOCKER B1 — REAL PAYROLL PII IN GIT · RESOLVED

**Verified extent (branch `origin/main..HEAD`, 20 commits):** 14 tracked files contained real
employee names + salary + per-employee tax IDs —
`docs/payroll-corpus/T{1..6}.tsv` + `T7_CANONICAL.tsv` and `scripts/fixtures/payroll/T{1..7}.tsv`.
`assets/templates/PHF_Payroll_Canonical_V1.xlsx` was inspected — blank template (10 label rows,
0 employee codes, 0 salary values) → **not PII, kept**. `docs/payroll-corpus/README.txt` — sha256
pins + row/col counts only → **not PII, kept (sanitized)**.

**Actions (commit `fdf18c0`):**
- **Backup first (local, NOT pushed):** branch `backup/pre-pii-cleanup-2026-09-09` + tag
  `pre-pii-cleanup-2026-09-09` at the pre-cleanup commit `e2bdb9e` — still carry the full pre-cleanup
  tree so nothing is unrecoverable.
- `git filter-branch --index-filter` over `8e443ab..HEAD` (19 commits) removed all 14 `.tsv` from
  **every** commit. `refs/original/` deleted (backup branch/tag is the recovery point).
- **Real corpus preserved** at `scripts/qtth-truth-bootstrap/_secure/payroll-corpus/` (gitignored) —
  sha256 == pinned values.
- `scripts/lib/payroll-corpus-dir.js` resolves the corpus:
  `$PHF_PAYROLL_CORPUS_DIR` → `_secure/payroll-corpus/` → `docs/payroll-corpus/`.
  All 8 payroll test scripts + `build-package.js` repointed.
- `.gitignore`: `/docs/payroll-corpus/*.tsv` + `/scripts/fixtures/payroll/`.

**Proof:**
```
git log 8e443ab..HEAD --name-only --diff-filter=A | grep '\.tsv$'      -> NONE (all 20 commits)
git ls-tree -r HEAD | grep -E 'payroll-corpus/T|fixtures/payroll/T'      -> NONE
git rev-list 8e443ab..HEAD | xargs -I{} git grep -l PHF041 {}           -> only pre-existing KNL/staff files, no payroll TSV
```
Payroll offline suites green after the repoint: `qtth-payroll-batch02-offline-checks` 32/32,
`cost-model-offline`, `cost-ui-render` 28/28, `semantic-cost-audit`, `corpus-gen` 7/7 verbatim.

> **Note (out of scope, pre-existing on `origin/main`):** `assets/data/phf-existing-staff.js`,
> `api/_lib/data/PHF_KNL_COMPENSATION_FOUNDATION_2026_07.json`, `scripts/phf-knl-salary-baseline-2026-08.js`
> reference employee-level compensation and are already on `origin/main` (KNL modules). Not touched by
> this batch; flag for a separate security review if the Operator wants.

---

## 2 · PAYROLL BOOTSTRAP CAPABILITY — PRESERVED

Rebuilt `QTTH_TRUTH_BOOTSTRAP_V1_2026-09-09` from the secure corpus. Truth anchors **unchanged**:
`payrollSourceSha256` (all 7 periods), `accountingSourceSha256`, `costDictionarySha256` identical to
Phase 1. Only `*PayloadSha256` + `manifest.generatedAt`/`head` differ (payload files carry a build
timestamp — non-truth; the importer verifies payload↔checksums within the same bundle).

```
T01 2026-01  44 rows  582,875,916  Δ+1     fp 742242d7f53f
T02 2026-02  44 rows  626,605,726  Δ-2     fp 10c641565633
T03 2026-03  52 rows  631,769,040  Δ-4     fp 251a25948631
T04 2026-04  51 rows  570,604,633  Δ 0     fp 3b2cfe7bf8ff
T05 2026-05  49 rows  560,957,961  Δ+1     fp 82b1b54c2bc2
T06 2026-06  47 rows  554,860,101  Δ+1     fp 82b1b54c2bc2
T07 2026-07  44 rows  562,741,327  Δ+1     fp 82b1b54c2bc2  (canonical)
```

---

## 5 · SECURE PROMOTION ARTIFACT

| Committed (sanitized) | Gitignored (confidential, local only) |
|---|---|
| `docs/qtth-truth-bootstrap/manifest.json` | `scripts/qtth-truth-bootstrap/_secure/payroll_payload.secure.json` (employee salary) |
| `docs/qtth-truth-bootstrap/payroll_periods.json` (aggregates, NO salary) | `scripts/qtth-truth-bootstrap/_secure/accounting_payload.secure.json` (vendor/customer rows + rules + history + dict) |
| `docs/qtth-truth-bootstrap/accounting_summary.json` (parity + rule shape/counts, NO rule text/invoice refs) | `scripts/qtth-truth-bootstrap/_secure/payroll-corpus/` (real workbooks) |
| `docs/qtth-truth-bootstrap/checksums.json` | `scripts/qtth-truth-bootstrap/_secure/dryrun-target.env`, `import-report-*.json` |
| `scripts/qtth-truth-bootstrap/{build-package,import,parity-check}.js` | |
| `scripts/lib/payroll-corpus-dir.js` | |

`CONFIDENTIAL_PAYLOAD_GITIGNORED = PASS` — verified `git check-ignore` on every `_secure/*` path.

---

## 6 · THROWAWAY REHEARSAL — full log

Fresh `phf_hr_bootstrap` (throwaway container) → migrations 1–5 in PROD order (all OK) →
`import.js --dry-run` (331 payroll inserts + accounting {dict 1, entries 170, rules 43, history 43,
normalized 350, decisions 44, import 1, file 1}, 0 conflict) →
`import.js --apply` (committed) →
`import.js --apply` again (payroll skip 331 / accounting normalized 0 — idempotent, 0 duplicate) →
mutate 1 target row → `import.js --apply --schema accounting` → **CONFLICT → ROLLBACK**, target
unchanged, no `bootstrap_log` row →
`parity-check.js` → **52 passed, 0 failed · PARITY = PASS**.

---

## 3 · WHAT PHASE 2 WOULD DO ON PROD (exact) — still BLOCKED

1. Deploy a phf-hr-api image containing the qtth-service code (payroll + accounting).
2. Apply migrations 1–5 (order above) to PROD `phf_hr` as `phf_hr_owner`.
3. Set Vercel `PHF_QTTH_BRIDGE_ENABLED=true` (Production). Keep `QTTH_DEV_ACCESS_ALLOW` unset.
4. QTTH access bootstrap: insert ≥1 `qtth.permission_manager_grant` (business decision).
5. `node scripts/qtth-truth-bootstrap/import.js --target-env <PROD db.env> --apply`
   (checksum-verified, one txn/schema, natural keys, SKIP-identical / CONFLICT-different, `bootstrap_log` on success).
6. `node scripts/qtth-truth-bootstrap/parity-check.js --target-env <PROD db.env>` → must be PASS.

## 4 · REMAINING BLOCKERS FOR PHASE 2

| # | Blocker | Owner |
|---|---|---|
| B1' | **`backup/pre-pii-cleanup-2026-09-09` branch + tag hold the PII tree locally.** They must NEVER be pushed. Delete them once the Operator confirms Phase 1.5 is accepted. | Operator/Claude (post-accept) |
| B2 | **QTTH module → PROD is a separate go-live decision** (image deploy + Vercel flag + permission grant). The truth bootstrap can only follow it. | Operator |
| B3 | Accept the corpus→normalizer provenance path for payroll (deterministic; not a re-upload). | Operator |
| B4 | `feat/qtth-batch-01` worktree branch (`C:\phf-wt\qtth-payroll-semantic`) STILL contains the payroll PII in its history — separate unpushed branch. Clean or abandon before it is ever pushed. | Operator/Claude |

---

## EXPECTED PROD PARITY (Phase 2 gate — must match EXACTLY)

Identical to Phase 1: accounting 350 / 334·1,026,022,214 / 16·22,725,465 / 0 / total 1,048,747,679 ;
44 decisions ; 43 rules active/0 disabled ; 43 history ; dict 170 ; PHF-MKT flagged ; 0 raw-85k rows.
Payroll: every period present + active + confirmed ; row count + fingerprint + personnel-cost total per `T01..T07` above.

**STOP. WAIT FOR OPERATOR / CHATGPT APPROVAL BEFORE ANY PROD WRITE.**
