begin;

-- Rollback for phf_hr_task_recurrence_v1.sql — company PostgreSQL `phf_hr`,
-- schema `task` (run by deployer, `psql -v ON_ERROR_STOP=1 -f`).
--
-- Removes ONLY the additive schema objects from the UP migration. Does NOT
-- delete any task.tasks / task.events rows. Tasks that the recurrence engine
-- already generated remain fully intact and independent (they only carry
-- recurring_series_id / scheduled_occurrence_at values that will point at a
-- now-dropped rule id — harmless nullable columns, no FK).
--
-- Order: drop the 'recurring_generated' event_type value LAST is unsafe if
-- any task.events row already uses it, so this DOWN first checks and aborts
-- with a clear message rather than silently leaving a broken CHECK.
--
-- The recreated whitelist removes ONLY 'recurring_generated' (this migration's
-- own addition) and KEEPS 'cancel_request' / 'cancel_request_decision' — PROD
-- has Cancel Policy V1, and rolling Recurrence V1 back must not regress that
-- constraint. Mirrors phf_hr_task_cancel_request_v1_DOWN.sql, which likewise
-- keeps 'recurring_generated'.

do $$
begin
  if exists (select 1 from task.events where event_type = 'recurring_generated') then
    raise exception 'RECURRENCE_DOWN_BLOCKED: task.events still has recurring_generated rows — a generated Task exists. Resolve/keep those events before rolling back, or keep the event_type value.';
  end if;
end$$;

revoke select, insert on task.recurrence_rule_history from phf_hr_app;
revoke select, insert, update on task.recurrence_occurrences from phf_hr_app;
revoke select, insert, update on task.recurrence_rules from phf_hr_app;

drop trigger if exists task_recurrence_rule_history_forbid_truncate on task.recurrence_rule_history;
drop trigger if exists task_recurrence_rule_history_forbid_update on task.recurrence_rule_history;
drop trigger if exists task_recurrence_rule_history_forbid_delete on task.recurrence_rule_history;

drop table if exists task.recurrence_occurrences;
drop table if exists task.recurrence_rule_history;
drop table if exists task.recurrence_rules;

alter table task.events drop constraint task_events_event_type_ck;
alter table task.events add constraint task_events_event_type_ck check (event_type in (
  'published', 'assignment', 'transfer', 'progress', 'comment', 'deadline_change',
  'extension_request', 'extension_decision', 'priority_change', 'attachment', 'link',
  'completion', 'reopen', 'cancel', 'recurring_change', 'monthly_close', 'permission_change',
  'proposal_accept', 'proposal_reject', 'proposal_cancel',
  'cancel_request', 'cancel_request_decision'
));

commit;
