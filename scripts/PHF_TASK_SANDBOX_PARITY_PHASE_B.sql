-- ============================================================================
-- PHF_TASK_SANDBOX_PARITY_PHASE_B.sql   —   ONE COPY/PASTE BLOCK FOR DEPLOYER
-- ============================================================================
-- APPLY TARGET:  SANDBOX ONLY  —  Supabase project ref  pxkjvawdrixgoukhyvnk
-- DO NOT APPLY TO MAIN  (byhpcexmjzqpctyvfczd).
--
-- Paste this entire file into the SANDBOX project's Supabase SQL Editor and
-- run once. It is a single transaction, fully idempotent, additive only, no
-- business-rule change, no data migration, no existing row touched.
--
-- WHAT IT DOES (all verified needed by live PostgREST probe on SANDBOX,
-- 2026-08-28 — SANDBOX already has 1.73.0 + the critical 1.74.0 columns +
-- every task_* RPC):
--   1. Grants service_role DELETE on task_tasks + task_permission_grants.
--      (PHF_TASK_SERVICE_ROLE_PRIVILEGES_1.72.2.sql deliberately withheld
--      these; MAIN carries them out-of-band, and task_delete_draft() — a
--      live production UI feature — needs task_tasks DELETE to function.
--      Long-term fix tracked separately: make task_delete_draft SECURITY
--      DEFINER. For SANDBOX regression parity we grant them narrowly.)
--   2. Applies PHF_TASK_PERMISSION_HARDENING_FIX_1.75.0 (task_events
--      draft-scoped forbid trigger) inline — idempotent.
--   3. Removes the one inert probe draft Phase B left behind.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) PREFLIGHT — abort if this is not SANDBOX. SANDBOX holds only a small
--    handful of real task rows; MAIN holds the live production corpus.
-- ---------------------------------------------------------------------------
do $$
declare v_n bigint;
begin
  select count(*) into v_n from public.task_tasks
   where coalesce(title,'') not like '[%TEST%]' and coalesce(title,'') not like '[REPORT-UI-TEST]%';
  if v_n > 200 then
    raise exception 'PREFLIGHT ABORT: % non-test task rows — this looks like MAIN/production, not SANDBOX. Nothing applied.', v_n;
  end if;
  raise notice 'PREFLIGHT OK — % non-test task rows, treating as SANDBOX.', v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 1) SANDBOX test-parity DELETE grants (SANDBOX only — see header).
-- ---------------------------------------------------------------------------
grant delete on table public.task_tasks             to service_role;
grant delete on table public.task_permission_grants to service_role;

-- ---------------------------------------------------------------------------
-- 2) PHF_TASK_PERMISSION_HARDENING_FIX_1.75.0 — task_events append-only
--    trigger, draft-cascade-aware. Verbatim from
--    scripts/PHF_TASK_PERMISSION_HARDENING_FIX_1.75.0.sql. Idempotent.
-- ---------------------------------------------------------------------------
create or replace function public.task_events_forbid_mutation() returns trigger as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'PHF Task: bảng task_events là append-only — không cho phép UPDATE (Z-51).'
      using errcode = '0A000';
  end if;
  if current_setting('phf_task.delete_draft_task_id', true) is not null
     and current_setting('phf_task.delete_draft_task_id', true) = old.task_id::text then
    return old;
  end if;
  raise exception 'PHF Task: bảng task_events là append-only — không cho phép DELETE trực tiếp (Z-51). Event chỉ mất theo khi xóa nguyên draft task hợp lệ qua task_delete_draft().'
    using errcode = '0A000';
end;
$$ language plpgsql;

drop trigger if exists task_events_forbid_update on public.task_events;
create trigger task_events_forbid_update before update on public.task_events
  for each row execute function public.task_events_forbid_mutation();
drop trigger if exists task_events_forbid_delete on public.task_events;
create trigger task_events_forbid_delete before delete on public.task_events
  for each row execute function public.task_events_forbid_mutation();

-- ---------------------------------------------------------------------------
-- 3) Remove the inert Phase B probe draft (a PostgREST probe created it and
--    could not self-delete before grant (1) existed).
-- ---------------------------------------------------------------------------
delete from public.task_tasks where title like '[PHASEB-PROBE%' and status = 'draft';

commit;

-- ---------------------------------------------------------------------------
-- POST-APPLY VERIFY (deployer):
--   select has_table_privilege('service_role','public.task_tasks','DELETE');             -- expect  t
--   select has_table_privilege('service_role','public.task_permission_grants','DELETE'); -- expect  t
--   select tgname from pg_trigger where tgrelid = 'public.task_events'::regclass;        -- includes task_events_forbid_delete/_update
--
-- Then hand back to the session / re-run:
--   node scripts/test-task-report-ui-fixture-seed-today.js --rebuild-manifest-only
--   node scripts/test-task-schema-repair-post-apply-v1.js
--   node scripts/test-task-permission-hardening-v1.js
--   node scripts/test-task-permission-grant-precedence-v1.js
-- ---------------------------------------------------------------------------
