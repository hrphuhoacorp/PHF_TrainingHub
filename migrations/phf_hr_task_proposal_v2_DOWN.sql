begin;

-- Rollback for phf_hr_task_proposal_v2.sql — company PostgreSQL `phf_hr`,
-- schema `task` (run by deployer, psql -v ON_ERROR_STOP=1 -f).
-- Reverts event_type CHECK to Foundation's original 17 values and drops the
-- proposal_decisions table + its guard trigger/function. Does NOT touch
-- task.tasks/task.assignees/task.events rows themselves (no data in those
-- tables is deleted by this rollback — only the additive schema objects from
-- phf_hr_task_proposal_v2.sql are removed).

revoke select, insert, update on task.proposal_decisions from phf_hr_app;

drop trigger if exists task_proposal_decisions_guard_flow_type on task.proposal_decisions;
drop function if exists task.task_guard_proposal_decision_flow_type();

drop table if exists task.proposal_decisions;

alter table task.events drop constraint task_events_event_type_ck;
alter table task.events add constraint task_events_event_type_ck check (event_type in (
  'published', 'assignment', 'transfer', 'progress', 'comment', 'deadline_change',
  'extension_request', 'extension_decision', 'priority_change', 'attachment', 'link',
  'completion', 'reopen', 'cancel', 'recurring_change', 'monthly_close', 'permission_change'
));

commit;
