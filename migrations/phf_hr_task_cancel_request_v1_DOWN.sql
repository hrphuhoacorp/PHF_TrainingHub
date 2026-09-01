begin;
-- DOWN for phf_hr_task_cancel_request_v1.sql — THROWAWAY / rollback only.
do $$ begin
  if exists (select 1 from task.cancel_requests) then
    raise exception 'cannot roll back: task.cancel_requests has rows';
  end if;
end $$;
alter table task.events drop constraint task_events_event_type_ck;
alter table task.events add constraint task_events_event_type_ck check (event_type in (
  'published', 'assignment', 'transfer', 'progress', 'comment', 'deadline_change',
  'extension_request', 'extension_decision', 'priority_change', 'attachment', 'link',
  'completion', 'reopen', 'cancel', 'recurring_change', 'monthly_close', 'permission_change',
  'proposal_accept', 'proposal_reject', 'proposal_cancel',
  'recurring_generated'
));
drop table task.cancel_requests;
commit;
