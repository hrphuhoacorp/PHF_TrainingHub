-- PHF_TASK_SANDBOX_PARITY_PHASE_B.sql
-- Gate: PHASE B — ENVIRONMENT CLEANUP / HARDENING (2026-08-28)
--
-- ============================================================================
-- APPLY TARGET:  SANDBOX ONLY  — project ref pxkjvawdrixgoukhyvnk
-- DO NOT APPLY TO MAIN (byhpcexmjzqpctyvfczd).
-- ============================================================================
--
-- WHY THIS FILE EXISTS
-- Phase B repointed all local dev/test (repo-root .env) from MAIN -> SANDBOX
-- and fail-closed-guarded every real-DB Task script. Running the live Task
-- regression against SANDBOX then surfaced the exact ways SANDBOX's schema/
-- privilege state differs from the (drifted) MAIN state the suites were
-- historically run against. This package closes the gaps that are safe and
-- in-scope for SANDBOX.
--
-- Probed live on SANDBOX via PostgREST (2026-08-28), service_role key:
--   ALREADY PRESENT on SANDBOX (no action needed):
--     - task_create_draft / task_update_progress / task_delete_draft RPCs
--     - task_comments.author_account_id, task_tasks.created_by_account_id,
--       task_events.actor_account_id  (=> 1.73.0 + the critical part of
--       1.74.0 already applied)
--     - service_role: SELECT/INSERT/UPDATE on all task_* tables
--   MISSING on SANDBOX (this file fixes):
--     1. service_role has NO DELETE on task_tasks / task_permission_grants
--        -> task_delete_draft() raises 42501; the permission-hardening and
--        grant-precedence suites' fixture cleanup raises 42501.
--        NOTE: PHF_TASK_SERVICE_ROLE_PRIVILEGES_1.72.2.sql DELIBERATELY
--        withholds DELETE here. MAIN must currently carry an out-of-band
--        DELETE grant (task_delete_draft is a live production UI feature).
--        The clean long-term fix is to make task_delete_draft SECURITY
--        DEFINER — tracked as a cutover follow-up. For SANDBOX test parity
--        we grant DELETE narrowly, matching de-facto MAIN.
--     2. 1.75.0 (task_events draft-scoped forbid trigger) — could not be
--        probed because (1) blocked the delete path; apply idempotently.
--
-- Everything below is additive / idempotent. No business rule changes.
-- Wrap-in-transaction; review RAISE NOTICEs.

begin;

-- ---------------------------------------------------------------------------
-- 0) PREFLIGHT — confirm we are on SANDBOX, not MAIN.
-- ---------------------------------------------------------------------------
do $$
declare
  v_db text := current_database();
begin
  -- Supabase project ref is not exposed in-DB; guard on a SANDBOX-only marker
  -- instead: SANDBOX has <= a handful of real task rows, MAIN has the live
  -- production corpus. Abort if task_tasks looks like production.
  if (select count(*) from public.task_tasks) > 500 then
    raise exception 'PREFLIGHT ABORT: task_tasks has % rows — this looks like MAIN/production, not SANDBOX. DO NOT APPLY.', (select count(*) from public.task_tasks);
  end if;
  raise notice 'PREFLIGHT OK — task_tasks row count is small, treating as SANDBOX (db=%).', v_db;
end $$;

-- ---------------------------------------------------------------------------
-- 1) SANDBOX test-parity DELETE grants (see NOTE above — narrow, SANDBOX only)
-- ---------------------------------------------------------------------------
grant delete on table public.task_tasks             to service_role;
grant delete on table public.task_permission_grants to service_role;

-- ---------------------------------------------------------------------------
-- 2) 1.75.0 — task_events draft-scoped forbid trigger (idempotent re-apply).
--    Source of truth: scripts/PHF_TASK_PERMISSION_HARDENING_FIX_1.75.0.sql
--    Paste that file's body here VERBATIM if the trigger/function below is
--    not already the draft-scoped version. (Left as an explicit deployer
--    step rather than duplicated, so the canonical file stays the single
--    source — run 1.75.0 then 1.75.0 is idempotent by design.)
-- ---------------------------------------------------------------------------
\echo '>>> Now run scripts/PHF_TASK_PERMISSION_HARDENING_FIX_1.75.0.sql against SANDBOX (idempotent).'

-- ---------------------------------------------------------------------------
-- 3) Clean the Phase B probe artifact (one inert draft left by a PostgREST
--    probe that could not self-delete before grant (1) existed).
-- ---------------------------------------------------------------------------
delete from public.task_tasks
 where title like '[PHASEB-PROBE%'
   and status = 'draft';

commit;

-- ---------------------------------------------------------------------------
-- POST-APPLY VERIFY (run as service_role via PostgREST or here):
--   select has_table_privilege('service_role','public.task_tasks','DELETE');            -- expect t
--   select has_table_privilege('service_role','public.task_permission_grants','DELETE');-- expect t
-- Then re-run:
--   node scripts/test-task-permission-hardening-v1.js
--   node scripts/test-task-permission-grant-precedence-v1.js
--   node scripts/test-task-schema-repair-post-apply-v1.js
-- ---------------------------------------------------------------------------
