-- PHF_TASK_PERMISSION_HARDENING_FIX_1.75.0.sql
-- Gate: PHF_TASK_PERMISSION_HARDENING_1_73_FIX3_DRAFT_EVENT_CASCADE
--
-- 1.73.0 is ALREADY APPLIED to canonical DEV (byhpcexmjzqpctyvfczd). This is
-- a NEW, separate, additive corrective migration — 1.73.0's file is kept
-- as-is, unmodified, as the historical record of what was actually applied.
-- This file does NOT re-declare task_delete_draft() or task_forbid_comment_
-- mutation() — neither needs to change (see FIX below for why).
--
-- ===========================================================================
-- ROOT CAUSE (confirmed live on canonical DEV — real post-apply test FAIL,
-- not speculative): addTaskComment() (api/_lib/task-core.js) inserts BOTH a
-- task_comments row AND a task_events row (event_type='comment') for every
-- comment, on ANY task including a draft — there is no draft/published gate
-- on either insert. 1.73.0's own doc comment claimed "a draft is defined to
-- never have task_events rows" — that assumption was already false before
-- 1.73.0 shipped; it was never tested against a draft-with-comment fixture
-- until this gate's post-apply run, which reproduced it directly:
--
--   PHF Task: bảng task_events là append-only — không cho phép DELETE (Z-51).
--
-- task_events.task_id is `references public.task_tasks(id) on delete
-- cascade` (Foundation 1.66.0). task_delete_draft()'s DELETE on task_tasks
-- cascades to task_events exactly like it does to task_comments — but
-- task_events' BEFORE DELETE trigger was still the original, unconditional
-- task_forbid_update_delete() (shared with task_permission_grant_history and
-- task_permission_assignment_history), so the cascade raised and the whole
-- draft-delete transaction rolled back.
--
-- ===========================================================================
-- FK AUDIT (re-run this gate, not assumed) — every table with
-- `references public.task_tasks(id)`:
--   task_assignees      — on delete cascade, NO forbid-mutation trigger   — already worked (proven live: block-1 post-apply test deletes a draft with a primary assignee successfully)
--   task_events          — on delete cascade, forbid trigger (task_forbid_update_delete, UNCONDITIONAL) — THE BUG, fixed by this file
--   task_comments        — on delete cascade, forbid trigger (task_forbid_comment_mutation, already draft-scoped since 1.73.0) — already fixed
--   task_links            — on delete cascade, NO forbid-mutation trigger  — no fix needed
--   task_notifications  — on delete cascade (PHF_TASK_CROSS_DEPARTMENT_NOTIFICATION_1.72.0.sql), NO forbid-mutation trigger, and drafts never publish so never acquire a cross-department notification row anyway — no fix needed
--   task_tasks.copied_from_task_id (self-ref) — on delete SET NULL, not cascade, and task_tasks has no generic forbid-update trigger — no fix needed
-- Only task_events needed a change. Scope stays minimal.
--
-- ===========================================================================
-- BUSINESS LOCK — reaffirmed, NOT changed by this file
-- ===========================================================================
-- A DRAFT owned by its creator may be hard-deleted atomically, and every
-- actual FK child of that ONE draft (task_comments, task_events,
-- task_assignees, task_links, task_notifications) may disappear with it —
-- this exception exists ONLY because the parent Task is still 'draft'.
-- Once a task is published or later: task_tasks cannot hard-delete
-- (task_tasks_guard_delete, untouched), task_events remain append-only
-- (enforced below), comments cannot be independently mutated/deleted
-- (task_forbid_comment_mutation, untouched, 1.73.0). This file introduces
-- NO general delete-history capability — the bypass added below is gated
-- the exact same way the 1.73.0 task_comments bypass already is: scoped to
-- one specific, already-authorized, in-flight draft deletion.
--
-- ===========================================================================
-- FIX — NEW dedicated trigger function for task_events, NOT a change to the
-- shared task_forbid_update_delete() (that function is used unmodified by
-- task_permission_grant_history and task_permission_assignment_history —
-- both must stay unconditionally, permanently immutable; loosening the
-- shared function would have weakened them too).
-- ===========================================================================
-- public.task_events_forbid_mutation() mirrors public.task_forbid_comment_
-- mutation() (1.73.0) exactly: UPDATE always raises; DELETE is allowed ONLY
-- when the transaction-local GUC `phf_task.delete_draft_task_id` is set AND
-- equals OLD.task_id exactly. This is the SAME GUC task_delete_draft()
-- already sets (via set_config(..., is_local => true), immediately before
-- its own DELETE FROM task_tasks) — introduced in 1.73.0 for the
-- task_comments cascade, reused as-is here. task_delete_draft() itself does
-- NOT need any change: it already sets the right value at the right time in
-- its own transaction, before either cascade (comments or events) fires.
-- No new GUC, no SECURITY DEFINER, no privilege elevation — the function
-- keeps its normal, non-elevated privileges exactly like task_forbid_
-- comment_mutation() does.
--
-- SAFETY
--   - Additive/corrective only: adds one new function, repoints exactly the
--     2 existing triggers on task_events (DROP TRIGGER IF EXISTS + CREATE,
--     safe to re-run). Does NOT touch task_forbid_update_delete() itself,
--     does NOT touch its triggers on task_permission_grant_history /
--     task_permission_assignment_history, does NOT touch task_delete_draft()
--     or task_forbid_comment_mutation() (both already correct from 1.73.0).
--   - No existing row touched, no backfill, no data migration.
--   - Apply via the Supabase SQL editor on canonical DEV
--     (byhpcexmjzqpctyvfczd) only — this session has no direct Postgres
--     connection, so this file is DRAFTED and structurally tested but NOT
--     applied by this session.
--
-- SECURITY BOUNDARY (scoped claim, re-using the privilege/RLS evidence
-- already established this gate — NOT re-asserted as a global Postgres
-- guarantee):
--   - Within the PHF Task application / PostgREST threat model already
--     audited this gate: anon/authenticated have zero table-level grant on
--     task_events/task_comments (REVOKE ALL, Foundation 1.66.0, confirmed
--     live) and RLS is enabled with zero policies (double-deny). set_config
--     is not introspected/exposed by PostgREST for any role (confirmed
--     live, PGRST202 for both anon and service_role via the REST API).
--     task_delete_draft stays service_role-only (revoke/grant unchanged
--     from 1.73.0). Within THIS threat model, the only code path that can
--     ever set phf_task.delete_draft_task_id is task_delete_draft()'s own
--     already-authorization-checked function body.
--   - This is NOT a claim that the GUC is impossible to set through
--     arbitrary direct PostgreSQL access (e.g. a superuser psql session, or
--     any other credential path outside PostgREST/the app) — such access is
--     outside the audited threat model and outside what any DB-level trigger
--     design can prevent; it is the same trust boundary every other
--     service_role-only RPC in this schema already relies on.

create or replace function public.task_events_forbid_mutation() returns trigger as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'PHF Task: bảng task_events là append-only — không cho phép UPDATE (Z-51).'
      using errcode = '0A000';
  end if;

  -- tg_op = 'DELETE'. Allowed ONLY as the cascade side-effect of
  -- task_delete_draft() deleting THIS exact draft task — same GUC, same
  -- exact-task_id match, same reasoning as task_forbid_comment_mutation()
  -- (1.73.0). Any other DELETE path (raw client delete, a different task's
  -- cascade, no GUC set at all — including a published/completed/cancelled
  -- task, which task_tasks_guard_delete already blocks from ever reaching
  -- this cascade in the first place) still raises.
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

-- task_forbid_update_delete() is UNCHANGED and remains in place, still used
-- unmodified by task_permission_grant_history and task_permission_
-- assignment_history — neither is touched by this file.
