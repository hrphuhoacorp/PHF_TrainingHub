# PHF HR / PHF Task — Phase C: Real Identity / Employee / Permission Parity

**Date:** 2026-08-28 · Continues from Phase B FULL GREEN (`d6e5aa5`).
**Goal:** SANDBOX baseline reflects MAIN production identity/employee/permission 1:1; test users removed; Task demo corpus retained.

---

## 1. MAIN — READ-ONLY SOURCE (evidence)

MAIN (`byhpcexmjzqpctyvfczd`) was accessed **read-only** via
`scripts/task-main-readonly-mirror-dev.js`, whose MAIN client is a Proxy that
**throws on `.insert` / `.update` / `.upsert` / `.delete` / `.rpc`** — only
`.from(t).select(...)` reaches the wire. MAIN credentials were passed as
`PHF_MAIN_SUPABASE_URL` / `PHF_MAIN_SUPABASE_SECRET_KEY` to that one process
only; never written to `.env`, never committed, never printed.

**MAIN mutations performed: 0.** No write, no RPC, no schema change, no cleanup.

---

## 2. PARITY AUDIT

| Domain | MAIN | SANDBOX | Result |
|---|---|---|---|
| employee_profiles (all rows) | 39 | 51 | DIFF — SANDBOX has +12 test rows |
| employee_profiles — **real rows missing in SANDBOX** | — | — | **0** |
| employee_profiles — **field drift on shared rows** | — | — | **0** |
| user_accounts (all rows) | 40 | 44 | DIFF — SANDBOX has +4 test rows |
| user_accounts — **real rows missing in SANDBOX** | — | — | **0** |
| user_accounts — **field drift on shared rows** | — | — | **0** |
| task_permission_assignments (all) | 9 | 13 | DIFF — +4 test rows |
| **task_permission_assignments (active)** | **8** | **8** | **✅ MATCH** |
| task_permission_assignments — real 9 rows share MAIN's exact UUIDs | — | — | **yes** |
| **task_permission_grants (active)** | **0** | **0** | **✅ MATCH** |
| employees (legacy Hub directory) | 39 | 41 | DIFF — +2 ZTEST rows |

**Interpretation:** every real MAIN identity/permission row is already mirrored
into SANDBOX **byte-identical**. The only differences are SANDBOX carrying
**extra test rows**. Functional permission parity is **exact** (resolution reads
only `is_active=true` assignments/grants + `employee_profiles` by code).

---

## 3. EMPLOYEE / ACCOUNT PARITY

- **employee_profiles:** all 39 MAIN employees present in SANDBOX; `full_name`,
  `department`, `branch`, `title`, `manager_employee_code`, `employment_status`
  identical for every one. **0 drift.**
- **user_accounts:** all 40 MAIN accounts present (same `id`); `email`, `role`,
  `status`, `employee_code` identical. **0 drift.** account↔employee mapping
  preserved exactly.
- **employees (legacy Hub):** 39 real MAIN rows present; +2 ZTEST rows to remove.

No mapping was invented. Nothing reconciled *away from* MAIN.

---

## 4. PERMISSION / SCOPE PARITY

- **task_permission_assignments:** the 9 real rows (PHF012→TRUONG_BO_PHAN,
  PHF004/PHF010/PHF032→TRO_LY_GD, PHF041/PHF018→TRUONG_CA, PHF002→GIAM_DOC ×2,
  PHF034→TRUONG_BO_PHAN) exist in SANDBOX with **MAIN's exact UUIDs**. 8 active
  ⇔ 8 active. The 4 `PARITY_TEST_*` rows were **soft-revoked** (`is_active=false`)
  by this session and are removed by the deployer SQL (§7).
- **task_permission_grants:** MAIN has **0**. SANDBOX cleared from 27 → **0
  active** (22 hard-deleted, 5 blocked by `task_permission_grant_history` FK,
  left `is_active=false` — functionally inert).
- **managed scope:** `TRUONG_BO_PHAN` PHF012 correctly resolves
  `managedEmployeeCodes = {PHF082}` from `employee_profiles.manager_employee_code`
  — verified live.

---

## 5. TEST USERS REMOVED

| Identity | Where | Status |
|---|---|---|
| `PARITY_TEST_E01…E10`, `ZTEST-MGR`, `ZTEST-SUBJ` (employee_profiles ×12) | SANDBOX | physical delete = deployer SQL `PHF_TASK_PHASE_C_REMOVE_TEST_IDENTITIES.sql` (service_role has no DELETE/UPDATE on `employee_profiles`) |
| `*@test.local`, `LOCAL-PARITY-ADMIN`, `local-parity-admin-v2` (user_accounts ×4) | SANDBOX | same — deployer SQL |
| `PARITY_TEST_*` task_permission_assignments ×4 | SANDBOX | **soft-revoked now** (inactive); hard delete in deployer SQL |
| all task_permission_grants (27) | SANDBOX | **cleared now** (0 active) |
| `ZTEST Quan Ly`, `ZTEST Nhan Vien` (employees ×2) | SANDBOX | deployer SQL |
| `CV-2608-0001`, `CV-2608-0002` (tasks created by `PARITY_TEST_E07/E09`) | SANDBOX | **cancelled now**. Cannot be hard-deleted (published + `task_events` append-only + LOCK 4). `task_tasks.created_by_employee_code` has **no FK** to `employee_profiles` (Foundation 1.66.0, deliberate) → the orphan text code after profile removal is harmless. Documented exception. |

**No committed test suite references `PARITY_TEST_*` / `ZTEST-*` / `LOCAL-PARITY-ADMIN`** (`grep` over `scripts/test-task-*` and versioned scripts — 0 matches). The only users were untracked `task-*-dev.js` scratch scripts and `task-fullstack-e2e-throwaway-dev.js` (throwaway PG, not SANDBOX).

---

## 6. PASSWORD / SECRET HARD LOCK

**No production password / hash / session / token / secret was copied.** MAIN
was read via `PHF_MAIN_SUPABASE_SECRET_KEY` (env, this-process-only) for
`SELECT` only. No MAIN user password was reset. SANDBOX auth remains its own
DEV-safe test authentication — identity/business mapping is real, credentials
are not.

---

## 7. DEMO DATA RETAINED

The 37-fixture `[REPORT-UI-TEST]` corpus (real personas PHF010/082/004/012/002)
is **untouched** — count verified 37 before and after. Report / timeline /
progress / permission / regression all still exercise it. Cleanup deferred to
after Task is complete.

---

## 8. REAL PERSONA PERMISSION TEST — `scripts/test-task-real-persona-permission-v1.js`

**29/29 PASS** against the real MAIN-mirrored identity rows (no mock):

| Persona | Real code | Verified |
|---|---|---|
| Admin | (empty-code admin account) | actorType=admin, all capabilities, views any task |
| Director / GIAM_DOC | PHF002 | preset=GIAM_DOC, all_company scope, view+assign |
| Assistant / TRO_LY_GD | PHF010 | preset=TRO_LY_GD, all_company scope |
| Manager / TRUONG_BO_PHAN | PHF012 | managed={PHF082}, bounded scope, **views managed employee's task, DENIED out-of-scope task** |
| Shift Lead / TRUONG_CA | PHF041 | preset=TRUONG_CA, bounded scope, denied unrelated task |
| Normal employee / NHAN_VIEN | PHF082 | Hub role `manager` does **not** leak into Task authority → nhan_vien / self scope |
| received vs managed | PHF012 | a managed employee's task classifies as `manager_of_primary`, never `primary`/`creator` |
| cross-department | PHF082↔PHF041 | correctly cross-department; same dept → not |

---

## 9. PHASE C EXIT CRITERIA (revised 2026-08-28 after the history-FK finding)

Physical row-count equality with MAIN is **not** an exit criterion — audit /
history rows must never be deleted, and every test permission row is
history-referenced. Exit criteria are:

1. **Real rows exact** — every real MAIN `employee_profiles` / `user_accounts`
   / `task_permission_assignments` row present in SANDBOX, byte-identical. ✅
2. **Active permission state exact** — SANDBOX active `task_permission_assignments`
   == MAIN (8), active `task_permission_grants` == MAIN (0). ✅
3. **Historical test assignments inert and documented** — every test
   `task_permission_assignments` row that a history FK forbids deleting is
   `is_active=false` + `effective_to` past, excluded from every parity
   active-count check, and listed here. ✅ (§ Rows retained for audit)
4. Real-persona permission verification PASS. ✅ (29/29)
5. Task demo corpus retained + Phase B regression GREEN. ✅
6. MAIN: 0 mutation. ✅

## 10. EXCEPTIONS

| # | Exception | Reason | Resolution |
|---|---|---|---|
| C-1 | 12 `employee_profiles` + 4 `user_accounts` + 2 `employees` test rows still physically present | service_role has SELECT/INSERT only (no UPDATE/DELETE) on SANDBOX identity tables — a deliberate lockdown; no delete RPC exists | `scripts/PHF_TASK_PHASE_C_REMOVE_TEST_IDENTITIES.sql` rev 2 — one deployer paste (SANDBOX only, preflight-guarded, FK-safe). These are FK-clean (HR sub-tables absent on SANDBOX) → hard-deleted. |
| C-2 | 4 test `task_permission_assignments` — **history-FK-locked** (`task_permission_assignment_history_assignment_id_fkey`, ON DELETE RESTRICT) | audit history must never be deleted | **retained permanently inert** (`is_active=false` + `effective_to`=now). Excluded from active-count parity (which matches MAIN exactly at 8). Deployer SQL rev 2 hard-deletes only test assignments with **no** history row. |
| C-3 | 5 inactive `task_permission_grants` rows remain | `task_permission_grant_history` FK (ON DELETE RESTRICT) | inert (`is_active=false`), 0 active — active-state parity holds; retained for audit |
| C-4 | `CV-2608-0001/0002` remain as cancelled orphan tasks | published + append-only events + LOCK 4 forbid hard-delete; no FK from `created_by_employee_code` | cancelled + assignees deactivated — harmless |
| C-5 | `checklist_permission_grants` table missing on SANDBOX (MAIN has 8) | needed by `org-directory` (Checklist module), **NOT** by the Task permission path | out of Phase C (Task) scope; note for Checklist-module work |

## ROWS THAT WILL BE HARD-DELETED (deployer SQL rev 2)

| Table | Rows | Filter |
|---|---|---|
| `task_permission_assignments` | test rows **with no history child** (0–4, determined at apply time) | `employee_code` `PARITY_TEST_*` / `ZTEST*` / `LOCAL-PARITY-ADMIN` AND no `task_permission_assignment_history` |
| `user_accounts` | 4 | `email ilike '%@test.local'` OR test `employee_code` |
| `employee_profiles` | 12 | `employee_code` `PARITY_TEST_E01..E10`, `ZTEST-MGR`, `ZTEST-SUBJ` |
| `employees` (legacy Hub) | 2 | `id IN ('ZTEST-MGR','ZTEST-SUBJ')` |

## ROWS RETAINED FOR AUDIT (never deleted)

| Table | Rows | Made inert | Why kept |
|---|---|---|---|
| `task_permission_assignments` | test rows **with** a history child (up to 4: `PARITY_TEST_E01/E07/E08/E09`) | `is_active=false` + `effective_to`=now | `task_permission_assignment_history` FK ON DELETE RESTRICT — audit trail |
| `task_permission_assignment_history` | all rows | — | audit; never touched |
| `task_permission_grants` | 5 inactive | already `is_active=false` (session) | `task_permission_grant_history` FK |
| `task_permission_grant_history` | all rows | — | audit; never touched |
| `task_events` for `CV-2608-0001/0002` | 2 | — | append-only; task cancelled |

---

## 10. REGRESSION

**All green — Phase B FULL GREEN preserved.**

- New: `test-task-real-persona-permission-v1` **29/29 PASS**
- Guard/env: sandbox-guard, scripts-guard-coverage (**14 guarded**), env-identity-guard 27/27, oracle-dev-guard 12/12 — PASS
- Mock/bridge/parity: api-parity 212/212, write-bridge 44/44, server-integration 33+22+8+23, permission-v1 45/45, view-scope 79/79, cross-department 43/43, create-foundation 50/50, received-managed 18/18 — PASS
- Live SANDBOX: reporting 59/59, drilldown 23/23, timeline 28/28, progress-throttle 17/17, progress-observability 23/23, permission-hardening 55/55, grant-precedence 38/38, schema-repair-post-apply 36/36 — PASS

---

## EXPECTED COUNTS AFTER APPLY (deployer SQL rev 2)

| Table | Before | After | MAIN | Note |
|---|---|---|---|---|
| `employee_profiles` | 51 | **39** | 39 | exact |
| `user_accounts` | 44 | **40** | 40 | exact |
| `employees` (legacy Hub) | 41 | **39** | 39 | exact |
| `task_permission_assignments` total | 13 | **9–13** | 9 | 9 real + 0–4 history-locked inert test (audit) |
| `task_permission_assignments` **active** | 8 | **8** | 8 | exact — the parity criterion |
| `task_permission_assignments` active test rows | 0 | **0** | — | exact |
| `task_permission_grants` **active** | 0 | **0** | 0 | exact |
| `task_tasks` `[REPORT-UI-TEST]` demo corpus | 37 | **37** | — | untouched |

## POST-APPLY VERIFY COMMANDS

```sql
select count(*) from public.employee_profiles;                                        -- 39
select count(*) from public.user_accounts;                                            -- 40
select count(*) from public.employees;                                                -- 39
select count(*) filter (where is_active) as active, count(*) as total
  from public.task_permission_assignments;                                            -- active 8 ; total 9..13
select count(*) from public.task_permission_assignments
 where (employee_code like 'PARITY\_TEST\_%' escape '\' or employee_code like 'ZTEST%')
   and is_active;                                                                     -- 0
select count(*) filter (where is_active) from public.task_permission_grants;          -- 0
select count(*) from public.task_tasks where title ilike '%[REPORT-UI-TEST]%';        -- 37
```
```bash
PHF_MAIN_SUPABASE_URL=... PHF_MAIN_SUPABASE_SECRET_KEY=... node scripts/task-main-readonly-mirror-dev.js   # every real row MATCH
node scripts/test-task-real-persona-permission-v1.js                                                       # 29/29 PASS
node scripts/test-task-report-ui-fixture-seed-today.js --rebuild-manifest-only                             # corpus 37
# then the full Phase B regression sweep
```

## 12. STATUS

- **Employee/account/permission master data:** SANDBOX ⇔ MAIN — **0 missing, 0 drift** on every real row; **active permission state exact** (assignments 8⇔8, grants 0⇔0).
- **Test users:** permission rows neutralised now (0 active test); identity rows + FK-clean test assignments hard-deleted by one deployer paste; history-locked test assignments retained inert + documented.
- **Production credentials:** not copied. MAIN mutations: **0**.
- **Real personas:** 29/29 PASS.
- **Task demo data:** retained, working.
- **Phase B regression:** GREEN.
