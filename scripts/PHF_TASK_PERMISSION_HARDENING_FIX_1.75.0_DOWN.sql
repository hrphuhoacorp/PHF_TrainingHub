-- PHF_TASK_PERMISSION_HARDENING_FIX_1.75.0_DOWN.sql
-- Rollback for PHF_TASK_PERMISSION_HARDENING_FIX_1.75.0.sql.
--
-- Restores task_events' 2 triggers to the original, unconditional
-- task_forbid_update_delete() function (pre-1.75.0 behavior). WARNING: this
-- reintroduces the exact bug 1.75.0 fixes — task_delete_draft() will once
-- again fail (whole transaction rolled back) for any draft that has a
-- comment, since addTaskComment() always inserts a matching task_events row.
-- Only run this if you specifically need to revert task_events to its
-- pre-1.75.0 state.
--
-- Does NOT touch task_forbid_update_delete() itself (never modified by
-- 1.75.0), does NOT touch task_permission_grant_history/task_permission_
-- assignment_history (never touched by 1.75.0), does NOT touch
-- task_delete_draft() or task_forbid_comment_mutation() (both untouched by
-- 1.75.0 and stay as 1.73.0 left them either way).

drop trigger if exists task_events_forbid_update on public.task_events;
create trigger task_events_forbid_update before update on public.task_events
  for each row execute function public.task_forbid_update_delete();
drop trigger if exists task_events_forbid_delete on public.task_events;
create trigger task_events_forbid_delete before delete on public.task_events
  for each row execute function public.task_forbid_update_delete();

drop function if exists public.task_events_forbid_mutation();
