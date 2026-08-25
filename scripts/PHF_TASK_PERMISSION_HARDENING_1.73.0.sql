-- PHF_TASK_PERMISSION_HARDENING_1.73.0.sql
-- Gate: PHF_TASK_PERMISSION_HARDENING_PRE_GO_LIVE_V1
--
-- Implements LOCK 3 (delete draft) and LOCK 5 (comments append-only DB
-- protection) from the locked business decisions. LOCK 1/2/4 required NO
-- schema change (already enforced — see audit evidence in the gate report):
--   LOCK 1 (coordinator has no update authority) — already true in
--     api/_lib/task-permissions.js canUpdateTask(), no relation-based
--     shortcut exists for 'related'.
--   LOCK 2 (published task immutability) — already true, updateTaskDraft()
--     hard-rejects any non-draft status before any field mutation.
--   LOCK 4 (no hard-delete after publish) — ALREADY enforced at the DB
--     layer by the task_tasks_guard_delete trigger defined in
--     PHF_TASK_FOUNDATION_1.66.0.sql (task_guard_task_delete()), applied
--     since the original Foundation migration. This migration does not
--     touch that trigger — it is verified live in this gate's regression
--     (a raw service-role DELETE on a non-draft row is rejected by this
--     existing trigger, independent of the new RPC below).
--
-- Two objects only, both additive, no existing object altered:
--   1. public.task_delete_draft(uuid, integer, text) — new RPC. Creator-only
--      (re-checked server-side inside the function against the row's own
--      created_by_employee_code — never trusts the caller's claim alone),
--      draft-only (defense-in-depth on top of the existing DB trigger),
--      row_version-checked (same optimistic-concurrency convention as every
--      other lifecycle RPC in PHF_TASK_CORE_RPC_1.67.0.sql). Ends with a
--      real DELETE on task_tasks — the EXISTING task_tasks_guard_delete
--      trigger is the final, independent backstop (this RPC's own draft
--      check is redundant with it BY DESIGN, not a replacement for it).
--      Child rows (task_assignees/task_events/task_links) are already
--      ON DELETE CASCADE from task_tasks (Foundation migration) — no new
--      cascade needed. task_comments becomes ON DELETE CASCADE too (already
--      was, unchanged). A draft is defined (createTaskDraft comment, task-
--      core.js) to never have task_events rows, so the cascade never hits
--      the append-only task_events forbid-delete trigger in the normal
--      case; if it somehow did, that trigger would abort the whole
--      transaction (fail-safe, not fail-open — verified by reading
--      task_forbid_update_delete()'s unconditional RAISE).
--   2. task_comments append-only protection — mirrors task_events exactly:
--      reuses the EXISTING public.task_forbid_update_delete() function
--      (Foundation migration), adds the same BEFORE UPDATE / BEFORE DELETE
--      trigger pair task_events already has. INSERT is untouched (the
--      legitimate addTaskComment() path is unaffected).
--
-- NOT in scope this migration (explicitly, per gate instruction to keep
-- migration minimal): task_links has the SAME "never mutated, append-only
-- by application convention" pattern (removeTaskLink() inserts a 'remove'
-- event instead of touching the row) but currently has NO DB trigger
-- enforcing it either — this is a real, analogous gap, reported in the
-- gate output as a P3/parallel finding for a future gate, not fixed here.
--
-- Idempotent (CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS + CREATE),
-- safe to re-run. Apply via the Supabase SQL editor on the DEV/local
-- configured project only — this session has no direct Postgres connection
-- (no DATABASE_URL / pg client available), so this file is DRAFTED and
-- structurally tested but NOT applied by this session. See gate report
-- MIGRATION_FILE/DRAFT_DELETE_IMPLEMENTED for exact status.

-- ---------------------------------------------------------------------------
-- 1) task_delete_draft — hard-delete a DRAFT task, creator-only.
-- ---------------------------------------------------------------------------
create or replace function public.task_delete_draft(
  p_task_id uuid,
  p_expected_row_version integer,
  p_actor_employee_code text
) returns void as $$
declare
  v_task public.task_tasks;
begin
  select * into v_task from public.task_tasks where id = p_task_id for update;
  if not found then
    raise exception 'TASK_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_task.row_version <> p_expected_row_version then
    raise exception 'TASK_VERSION_CONFLICT' using errcode = '40001';
  end if;
  if v_task.status <> 'draft' then
    raise exception 'TASK_NOT_DRAFT' using errcode = '22023';
  end if;
  -- Defense-in-depth: re-derive authorization from the ROW itself, not just
  -- trust that the JS caller already checked actorOwnsTask() before calling
  -- this RPC (LOCK 3: creator-only, no Admin/manager override, no
  -- capability-based fallback — deliberately narrower than
  -- reopen/cancel/transfer's "creator OR update-authority" pattern).
  if upper(trim(v_task.created_by_employee_code)) <> upper(trim(coalesce(p_actor_employee_code, ''))) then
    raise exception 'TASK_DELETE_DRAFT_NOT_CREATOR' using errcode = '42501';
  end if;

  -- The existing task_tasks_guard_delete trigger (Foundation migration)
  -- independently re-verifies status='draft' at DELETE time — this is not
  -- a redundant no-op, it is the real backstop if this function is ever
  -- called with a stale row read under a race (FOR UPDATE above already
  -- prevents that within this transaction, but the trigger remains the
  -- authoritative last line of defense for ANY delete path, including ones
  -- that might bypass this RPC in the future).
  delete from public.task_tasks where id = p_task_id;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- 2) task_comments append-only — mirrors task_events exactly, reuses the
--    SAME existing function (Foundation migration), no new function.
-- ---------------------------------------------------------------------------
drop trigger if exists task_comments_forbid_update on public.task_comments;
create trigger task_comments_forbid_update before update on public.task_comments
  for each row execute function public.task_forbid_update_delete();
drop trigger if exists task_comments_forbid_delete on public.task_comments;
create trigger task_comments_forbid_delete before delete on public.task_comments
  for each row execute function public.task_forbid_update_delete();
