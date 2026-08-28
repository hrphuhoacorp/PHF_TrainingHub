# PHF HR / PHF Task — Environment Source of Truth (Phase B)

**Date:** 2026-08-28
**Context:** Post Supabase MAIN CPU incident. Containment commit `44766e2`. This
document is the canonical environment mapping after Phase B cleanup.

---

## 1. PROJECT / TARGET MAP

| Name | What it is | Identifier | Task write role after cutover |
|---|---|---|---|
| **MAIN** | Supabase production project. Live PHF HR + (still) PHF Task production reads/writes until the company-PostgreSQL cutover completes. | project ref `byhpcexmjzqpctyvfczd` · host `byhpcexmjzqpctyvfczd.supabase.co` | **Being retired for Task.** No new Task write paths. |
| **SANDBOX** | Supabase non-production project. Canonical target for ALL local dev + Task test/oracle/fixture runs. | project ref `pxkjvawdrixgoukhyvnk` · host `pxkjvawdrixgoukhyvnk.supabase.co` | Test/dev only. Never production. |
| **company PostgreSQL** | Non-Supabase Postgres (`phf_hr` DB) that PHF Task production writes migrate TO. Accessed by `services/phf-hr-api` via `pg` (node-postgres), never PostgREST. | `PHF_HR_DB_HOST` / `PHF_HR_DB_NAME=phf_hr` / user `phf_hr_runtime` | **Production Task write target.** |
| **throwaway PG** | Ephemeral local Postgres container for full-stack E2E (`scripts/task-fullstack-e2e-throwaway-dev.js`). Created/destroyed per run. | `PHF_HR_E2E_DB_ENV` → an abs-path env file | E2E only. |

**Deprecated / banned terms:** "canonical DEV", "dev DB", "PHF-HR-DEV" when they
actually mean MAIN. Several older test-script headers say "real dev DB
(byhpcexmjzqpctyvfczd)" — that phrasing IS the drift that caused the incident.
The Task dev/test target is **SANDBOX**, full stop.

---

## 2. ENV FILE MAP

| File | Tracked? | Purpose | SUPABASE_URL now |
|---|---|---|---|
| `.env` | **git-ignored** (`.gitignore` `.env`) | repo-root default for `require('dotenv').config()` — `server.js` + every `scripts/*.js` | **SANDBOX** (`pxkjvawdrixgoukhyvnk`) — repointed from MAIN in Phase B |
| `.env.test` | **git-ignored** (`.gitignore` `.env.*`) | consumed by `services/phf-hr-api/lib/config.js` as `devEnv` fallback; source of the SANDBOX credentials `.env` was repointed to | SANDBOX |
| `.env.production.example` | **tracked** | template only — placeholders (`YOUR_PROJECT`, `YOUR_SUPABASE_SERVICE_ROLE_KEY`). No real secret. | placeholder |
| `services/phf-hr-api/.env` | git-ignored | phf-hr-api service config (`PHF_HR_DB_*`, service token). Optional `SUPABASE_URL`. | SANDBOX or empty |
| `services/phf-hr-api/.env.example` | tracked | template — all values blank | blank |

**Production credentials (MAIN) live ONLY in the Vercel dashboard** (Project →
Settings → Environment Variables). They are NOT in any repo file and MUST NOT be
put in `.env` / `.env.test`.

---

## 3. RUNTIME → TARGET

| Runtime | Reads env from | Task write path | Guard against MAIN |
|---|---|---|---|
| **Vercel production** (`api/*.js`) | Vercel dashboard env | `api/data.js` → `updateTaskProgressLegacy` etc. → `api/_lib/task-core.js` → **MAIN** (while `PHF_TASK_SERVER_WRITE_ENABLED` OFF) | ⚠️ **none** on `task-core.js` client — deferred to cutover (Phase B locks: no prod behavior change) |
| **Local `node server.js`** | repo-root `.env` → **SANDBOX** | same code path, now → SANDBOX | `api/_lib/env-identity-guard.js::logSupabaseIdentityOnce` (warn, not fail) at boot |
| **`services/phf-hr-api`** (Docker / VPS) | `services/phf-hr-api/.env` → root `.env.test` fallback → **SANDBOX** | `lib/task-write.js` via `pg` to company Postgres (`withTaskWriteTransaction`) — **not PostgREST** | `lib/config.js::isProductionSupabaseUrl` — **HARD STOP boot** if `SUPABASE_URL` = `byhpcexmjzqpctyvfczd` |
| **Task test/oracle/fixture scripts** | repo-root `.env` → **SANDBOX** | via `api/_lib/task-core` service_role client, or direct `createClient` | ✅ **`scripts/task-sandbox-guard.js`** (fail-closed) + `scripts/task-oracle-dev-only.js` — enforced by `scripts/test-task-scripts-guard-coverage-v1.js` |
| **KNL / Checklist / AI test scripts** | repo-root `.env` → **SANDBOX** | n/a (not Task) | default only (`.env` repoint). Per-script fail-closed guard = documented follow-on (not Phase B scope). |
| **KNL `*-production-*` scripts** | shell env, explicit | MAIN by design | `api/_lib/env-identity-guard.js::assertDeclaredTargetOrFailClosed('MAIN', …)` (Phase 2C) |

---

## 4. WHY THE INCIDENT WAS POSSIBLE (root, restated)

`api/_lib/task-core.js` builds one module-load `createClient(SUPABASE_URL,
SUPABASE_SECRET_KEY)` service_role client with **no environment guard**. Repo-root
`.env` pointed `SUPABASE_URL` at MAIN. Every Task test/fixture/oracle script does
`require('dotenv').config()` then `require('../api/_lib/task-core')` → that client
→ `supabase.rpc('task_update_progress', …)` → PostgREST → MAIN, as service_role,
with no throttle. Bursty/looping gate scripts (esp. the progress-throttle
containment test) during the uncommitted CPU-fix iteration drove the storm.

**Phase B closes the DEV/TEST vector** (`.env` → SANDBOX + fail-closed guards).
**The production `task-core.js` client guard + retiring the legacy Supabase Task
write path remain deferred to the company-PostgreSQL cutover GO** (they take Task
production offline until the bridge is enabled — a business/release decision).
