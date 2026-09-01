begin;

-- DOWN for migrations/phf_hr_task_recurrence_v1_repeat_count.sql
-- THROWAWAY / rollback only. Safe only while no rule uses end_condition_type
-- = 'after_count' (the widened CHECK is restored to never/on_date only).

-- Refuse if any after_count rule exists (would violate the restored CHECK).
do $$
begin
  if exists (select 1 from task.recurrence_rules where end_condition_type = 'after_count') then
    raise exception 'cannot roll back: task.recurrence_rules has after_count rows';
  end if;
end $$;

drop index if exists task.task_recurrence_occurrences_counted_idx;

alter table task.recurrence_rules drop constraint task_recurrence_rules_end_ck;
alter table task.recurrence_rules add constraint task_recurrence_rules_end_ck check (
  (end_condition_type = 'never'   and end_date is null)
  or
  (end_condition_type = 'on_date' and end_date is not null)
);

alter table task.recurrence_occurrences drop column if exists is_initial;
alter table task.recurrence_rules drop column if exists max_occurrences;

commit;
