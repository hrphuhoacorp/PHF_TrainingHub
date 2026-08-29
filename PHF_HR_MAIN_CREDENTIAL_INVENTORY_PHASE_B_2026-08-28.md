# PHF HR — MAIN service_role Credential Inventory (Phase B)

**Date:** 2026-08-28 · **Rule:** inventory before any rotation. No rotation performed in Phase B.

---

## A. CREDENTIAL LITERALS IN TRACKED FILES

**Result: NONE.** `git grep` over all tracked files (excluding `.md` docs and
`*.example` templates) for `sb_secret_…`, `service_role":"ey…`, and JWT-shaped
`eyJhbGci…` literals returns **zero matches**. The only tracked env file,
`.env.production.example`, contains placeholders only
(`YOUR_SUPABASE_SERVICE_ROLE_KEY`). `.env` and `.env.test` are git-ignored
(`.gitignore`: `.env`, `.env.*`) and were never tracked.

⇒ No "remove literal / replace with env ref" action is required. Nothing to do here.

---

## B. WHERE THE MAIN service_role KEY IS *PROVIDED* AT RUNTIME

| # | Location | Purpose | Runtime | Still needed? |
|---|---|---|---|---|
| 1 | **Vercel dashboard env** `SUPABASE_SECRET_KEY` (+ `SUPABASE_URL` = MAIN) | Every `api/*.js` serverless function: KNL, Checklist, Classroom, Employee, Auth, **and Task (legacy path, until cutover)** | Vercel production | **YES** — KNL/Checklist/Classroom/Employee stay on MAIN. Only PHF Task writes migrate off. Do not rotate before cutover (would break all HR modules simultaneously). |
| 2 | repo-root **`.env`** `SUPABASE_SECRET_KEY` | *Was* MAIN → local `node server.js` + every `scripts/*.js` default. **Phase B repointed this to the SANDBOX key.** | local dev / test | **NO (MAIN key removed here).** Now SANDBOX. |
| 3 | **`.env.test`** `SUPABASE_SECRET_KEY` | SANDBOX service_role — consumed by `services/phf-hr-api/lib/config.js` (`devEnv` fallback) and now the value `.env` mirrors. | local / phf-hr-api dev | SANDBOX key, not MAIN. Fine. |
| 4 | Operator shell (ad-hoc `export SUPABASE_URL=… SUPABASE_SECRET_KEY=…`) for KNL `*-production-*` scripts | Deliberate MAIN writes (grade/compensation/permission seeds), gated by `assertDeclaredTargetOrFailClosed('MAIN', …)` | operator laptop | YES for those specific KNL ops. Not a stored credential. |

**No other source.** No hardcoded key in code, config, CI, or Docker files.

---

## C. CONSUMERS OF THE (env-provided) service_role CLIENT

~45 modules under `api/_lib/*` each call
`createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)` at
module load. All key off env — none embed a credential. Task-relevant:
`task-core.js` (the incident call site), `task-reporting.js`,
`task-permissions.js`, `task-notifications.js`.

`services/phf-hr-api` does **not** use the MAIN service_role for Task writes — it
uses `pg` to the company Postgres, and `lib/config.js` HARD-STOPs boot if
`SUPABASE_URL` = `byhpcexmjzqpctyvfczd`.

---

## D. ROTATION RECOMMENDATION (NOT executed — inventory only)

The MAIN service_role key (`sb_secret_…` prefix seen pre-Phase-B in local `.env`)
was, before Phase B, the default local credential for every developer and every
script — i.e. broadly exposed on developer machines and in shell history. It
**should be rotated**, but only **after the Task cutover**, and as a coordinated
op because rotating it breaks Vercel (all HR modules) until the dashboard value
is updated. Sequence when ready:
1. Cutover Task off MAIN (removes one class of consumer).
2. Generate new MAIN service_role key in Supabase.
3. Update Vercel dashboard env in the same change window.
4. Confirm no `.env` / `.env.test` / script references the old key (Phase B
   already removed the local default).

**HARD STOP respected: no MAIN credential rotated in Phase B.**
