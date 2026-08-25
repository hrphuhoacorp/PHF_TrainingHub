-- PHF_TASK_PERMISSION_HARDENING_1.73.0.sql
-- Gate: PHF_TASK_PERMISSION_HARDENING_PRE_GO_LIVE_V1
-- REVISED after PHF_TASK_PERMISSION_HARDENING_1_73_REVIEW_FIX_REPORT
-- (2 blockers found in the FIRST draft, both fixed in this version — see
-- report for full root cause. Summary inline at each fix below).
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
-- Objects, all additive, no pre-existing FUNCTION altered (task_tasks_guard_
-- delete / task_guard_task_delete / task_forbid_update_delete are all
-- untouched — see FIX 2 for exactly why a NEW dedicated trigger function was
-- needed for task_comments instead of reusing task_forbid_update_delete):
--   1. public.task_delete_draft(uuid, integer, text, text) — new RPC.
--      Creator-only (re-checked server-side inside the function against the
--      row's own created_by_account_id/created_by_employee_code — never
--      trusts the caller's claim alone), draft-only (defense-in-depth on
--      top of the existing DB trigger), row_version-checked (same
--      optimistic-concurrency convention as every other lifecycle RPC in
--      PHF_TASK_CORE_RPC_1.67.0.sql). Ends with a real DELETE on task_tasks
--      — the EXISTING task_tasks_guard_delete trigger is the final,
--      independent backstop (this RPC's own draft check is redundant with
--      it BY DESIGN, not a replacement for it). Child rows (task_assignees/
--      task_events/task_links/task_comments) are already ON DELETE CASCADE
--      from task_tasks (Foundation migration) — no new cascade needed.
--   2. task_comments append-only protection — NEW dedicated trigger
--      function public.task_forbid_comment_mutation() (does NOT reuse
--      task_forbid_update_delete — see FIX 2), same BEFORE UPDATE / BEFORE
--      DELETE trigger pair task_events already has via the shared function.
--      INSERT is untouched (the legitimate addTaskComment() path is
--      unaffected).
--
-- ===========================================================================
-- FIX 1 — ACCOUNT-ONLY CREATOR AUTHORIZATION (was a fail-OPEN bug)
-- ===========================================================================
-- ROOT CAUSE: after PHF_TASK_FOUNDATION_CORRECTION_REPAIR_1.74.0.sql, a
-- task_tasks row's creator identity can legitimately live in EITHER
-- created_by_employee_code OR created_by_account_id (task_normalize_actor_
-- identity(), 1.74.0, sets employee_code NULL for an Admin-linked account
-- and vice versa). The FIRST draft of task_delete_draft() only ever
-- compared v_task.created_by_employee_code — for an account-only-created
-- draft that column is NULL, so `upper(trim(NULL)) <> upper(trim(coalesce(
-- p_actor_employee_code,'')))` evaluates to SQL NULL, and PL/pgSQL's
-- `if NULL then` never enters the raise branch. Net effect: the DB-layer
-- creator check silently PASSED for ANY actor (not just the real creator)
-- whenever the draft's creator was account-only. The JS-layer actorOwnsTask()
-- check (api/_lib/task-core.js) already covers this correctly, but the RPC's
-- entire reason for existing is to be an independent, server-authoritative
-- backstop that does NOT just trust the caller — a fail-open backstop is
-- worse than no backstop, since it gives false confidence.
--
-- FIX: signature gains p_actor_account_id (mirrors the exact 2-parameter
-- actor convention already used by task_set_permission_assignment,
-- PHF_TASK_PERMISSION_V1_TARGETED_1.69.0.sql). Authorization is now an
-- explicit OR of two NULL-safe, presence-gated comparisons — a channel only
-- matches if BOTH the row's column AND the caller's supplied value for that
-- SAME channel are non-blank; there is no comparison that can silently
-- evaluate to NULL and skip the raise. task-core.js's deleteTaskDraft() is
-- updated to pass actorContext.accountId / actorContext.employeeCode as two
-- separate parameters (previously it collapsed them into one merged token
-- via actorAuditToken() — which is correct for plain audit-log columns
-- elsewhere, but was never safe to use as the ONLY input to a real
-- authorization check with two distinct row columns).
--
-- Also FIXED as a direct consequence: the first draft never REVOKEd/GRANTed
-- execute on task_delete_draft, unlike every sibling RPC in
-- PHF_TASK_CORE_RPC_1.67.0.sql / PHF_TASK_PERMISSION_V1_TARGETED_1.69.0.sql.
-- Postgres grants EXECUTE on a new function to PUBLIC by default; left as-is,
-- an authenticated Supabase client could have called task_delete_draft(...)
-- directly with a FORGED p_actor_account_id/p_actor_employee_code claim,
-- bypassing api/_lib/task-core.js's actorOwnsTask() check entirely — turning
-- FIX 1's own row-vs-claim comparison into the only defense against an
-- attacker who already knows (or guesses) the real creator's identity
-- strings. Locked to service_role only, matching every other lifecycle RPC.
--
-- ===========================================================================
-- FIX 2 — COMMENT APPEND-ONLY vs DRAFT CASCADE DELETE (was a false-negative:
-- LOCK 3 would have been UNUSABLE for any draft that already has a comment)
-- ===========================================================================
-- ROOT CAUSE: task_comments.task_id is `references public.task_tasks(id) on
-- delete cascade` (PHF_TASK_FOUNDATION_1.66.0.sql). The first draft's BEFORE
-- DELETE trigger on task_comments was unconditional (reused task_forbid_
-- update_delete() verbatim). addTaskComment() (api/_lib/task-core.js) has no
-- draft/published gate — a draft CAN legitimately receive comments before it
-- is published. So: task_delete_draft() DELETEs task_tasks -> ON DELETE
-- CASCADE fires a DELETE on every task_comments row for that task -> the
-- unconditional forbid-delete trigger raises -> the WHOLE transaction (the
-- entire draft delete, already authorization/row_version/status-checked)
-- aborts. LOCK 3 ("creator can delete own draft") would have silently failed
-- for the common case of a draft with any coordinator/creator discussion on
-- it, while appearing to work for the empty-comment case tested in isolation.
--
-- FIX: a NEW dedicated trigger function, public.task_forbid_comment_
-- mutation() (task_comments only — task_forbid_update_delete() and every
-- table using it, i.e. task_events, are entirely UNTOUCHED by this
-- migration, so the "fail-safe, not fail-open" guarantee already documented
-- for task_events' cascade case is preserved exactly as-is). UPDATE is
-- unconditionally forbidden, same as before. DELETE is forbidden UNLESS a
-- transaction-local Postgres GUC (`phf_task.delete_draft_task_id`) has been
-- set, this session, to EXACTLY this row's task_id. That GUC is set ONLY by
-- task_delete_draft() itself, ONLY immediately before its own DELETE
-- statement, via `set_config(..., is_local => true)` — meaning it is scoped
-- to the current transaction and resets automatically on COMMIT or ROLLBACK,
-- it can never leak across requests/connections in a pooled environment, and
-- nothing other than this one already-authorization-checked, service_role-
-- only RPC can ever set it. This is NOT a SECURITY DEFINER bypass (the
-- function keeps its normal, non-elevated privileges — the bypass is scoped
-- purely to "which specific task's cascade may proceed", decided by a value
-- the RPC computes from its OWN already-validated p_task_id, not from
-- anything the caller can set directly) and it does not touch task_events,
-- so LOCK 4/Z-51 event-history immutability is not weakened in any way.
--   A. Normal users/API still can never UPDATE or DELETE an existing
--      comment independently — the GUC is never set outside this one RPC's
--      own transaction, and even then only matches the ONE task_id it is
--      actively deleting.
--   B. A draft with comments can now be deleted atomically, including its
--      comments, exactly like its other child rows (assignees/events/links)
--      already did before this migration.
--
-- SAFETY (applies to both fixes)
--   - Idempotent: `drop function if exists ... ; create function ...` for
--     task_delete_draft (signature changed from the first draft, so a plain
--     `create or replace` would leave a stale 3-arg overload behind if the
--     first draft was ever partially applied — it was NOT, per the gate
--     report, but the DROP is here defensively, safe to re-run either way).
--     `create or replace function` for task_forbid_comment_mutation (no
--     signature change possible for a trigger function). DROP TRIGGER IF
--     EXISTS + CREATE for both triggers.
--   - No existing row touched, no backfill, no data migration.
--   - Apply via the Supabase SQL editor on the DEV/local configured project
--     only — this session has no direct Postgres connection (no DATABASE_URL
--     / pg client available), so this file is DRAFTED and structurally
--     tested but NOT applied by this session.

-- ---------------------------------------------------------------------------
-- 1) task_delete_draft — hard-delete a DRAFT task, creator-only.
-- ---------------------------------------------------------------------------
drop function if exists public.task_delete_draft(uuid, integer, text);

create or replace function public.task_delete_draft(
  p_task_id uuid,
  p_expected_row_version integer,
  p_actor_account_id text,
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

  -- Defense-in-depth: re-derive authorization from the ROW ITSELF, never
  -- trust the JS caller's claim alone (LOCK 3: creator-only, no Admin/
  -- manager override, no capability-based fallback). NULL-safe on BOTH
  -- sides for BOTH channels — see FIX 1 above for exactly why a naive
  -- single-column comparison fails open for an account-only creator.
  if not (
    (nullif(trim(coalesce(v_task.created_by_account_id, '')), '') is not null
       and nullif(trim(coalesce(p_actor_account_id, '')), '') is not null
       and v_task.created_by_account_id = p_actor_account_id)
    or
    (nullif(trim(coalesce(v_task.created_by_employee_code, '')), '') is not null
       and nullif(trim(coalesce(p_actor_employee_code, '')), '') is not null
       and upper(trim(v_task.created_by_employee_code)) = upper(trim(p_actor_employee_code)))
  ) then
    raise exception 'TASK_DELETE_DRAFT_NOT_CREATOR' using errcode = '42501';
  end if;

  -- Scope the append-only comment DELETE bypass to EXACTLY this task_id,
  -- transaction-local (is_local=true — auto-reset on COMMIT/ROLLBACK, never
  -- leaks to another request even over a pooled connection). See FIX 2.
  perform set_config('phf_task.delete_draft_task_id', p_task_id::text, true);

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

revoke execute on function public.task_delete_draft(uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.task_delete_draft(uuid, integer, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2) task_comments append-only — NEW dedicated function (see FIX 2 for why
--    this is NOT the shared task_forbid_update_delete()). task_events and
--    every other table using task_forbid_update_delete() is untouched.
-- ---------------------------------------------------------------------------
create or replace function public.task_forbid_comment_mutation() returns trigger as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'PHF Task: bảng task_comments là append-only — không cho phép UPDATE (Z-51).'
      using errcode = '0A000';
  end if;

  -- tg_op = 'DELETE'. Allowed ONLY as the cascade side-effect of
  -- task_delete_draft() deleting THIS exact draft task — see FIX 2 above.
  -- Any other DELETE path (raw client delete, a different task's cascade,
  -- no GUC set at all — including a published/completed/cancelled task,
  -- which task_tasks_guard_delete already blocks from ever reaching this
  -- cascade in the first place) still raises.
  if current_setting('phf_task.delete_draft_task_id', true) is not null
     and current_setting('phf_task.delete_draft_task_id', true) = old.task_id::text then
    return old;
  end if;

  raise exception 'PHF Task: bảng task_comments là append-only — không cho phép DELETE trực tiếp (Z-51). Comment chỉ mất theo khi xóa nguyên draft task hợp lệ qua task_delete_draft().'
    using errcode = '0A000';
end;
$$ language plpgsql;

drop trigger if exists task_comments_forbid_update on public.task_comments;
create trigger task_comments_forbid_update before update on public.task_comments
  for each row execute function public.task_forbid_comment_mutation();
drop trigger if exists task_comments_forbid_delete on public.task_comments;
create trigger task_comments_forbid_delete before delete on public.task_comments
  for each row execute function public.task_forbid_comment_mutation();

-- NOT in scope this migration (explicitly, per gate instruction to keep
-- migration minimal): task_links has the SAME "never mutated, append-only
-- by application convention" pattern (removeTaskLink() inserts a 'remove'
-- event instead of touching the row) but currently has NO DB trigger
-- enforcing it either — this is a real, analogous gap, reported in the
-- gate output as a P3/parallel finding for a future gate, not fixed here.
