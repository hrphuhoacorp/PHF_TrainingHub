begin;

-- =============================================================================
-- DOWN for migrations/phf_hr_task_recurrence_v1_daily.sql
--
-- Restores the frequency / weekday CHECKs to weekly|monthly only.
-- SAFE ONLY when no daily rows exist — this transaction ABORTS otherwise so a
-- daily rule is never left orphaned by a constraint it violates.
-- =============================================================================

do $$
begin
  if exists (select 1 from task.recurrence_rules where frequency = 'daily') then
    raise exception 'DOWN blocked: % daily recurrence rule(s) exist — archive/convert them first',
      (select count(*) from task.recurrence_rules where frequency = 'daily');
  end if;
end $$;

alter table task.recurrence_rules drop constraint task_recurrence_rules_frequency_ck;
alter table task.recurrence_rules add constraint task_recurrence_rules_frequency_ck
  check (frequency in ('weekly', 'monthly'));

alter table task.recurrence_rules drop constraint task_recurrence_rules_weekday_ck;
alter table task.recurrence_rules add constraint task_recurrence_rules_weekday_ck check (
  (frequency = 'weekly'  and weekday in ('T2','T3','T4','T5','T6','T7','CN') and day_of_month is null)
  or
  (frequency = 'monthly' and day_of_month between 1 and 31 and weekday is null)
);

commit;
