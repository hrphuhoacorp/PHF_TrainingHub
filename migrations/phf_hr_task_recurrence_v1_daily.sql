begin;

-- =============================================================================
-- PHF Task — RECURRENCE V1 — "Hàng ngày" (daily frequency).
--
-- REVIEW + THROWAWAY APPLY ONLY, by the deployer (postgres superuser + docker),
-- against phf_hr_e2e FIRST. NOT for production until Operator GO.
-- Applies ON TOP OF:
--   migrations/phf_hr_task_recurrence_v1.sql
--   migrations/phf_hr_task_recurrence_v1_acl_fix.sql
--   migrations/phf_hr_task_recurrence_v1_repeat_count.sql
-- DOWN: migrations/phf_hr_task_recurrence_v1_daily_DOWN.sql
--
-- Purely a CHECK-constraint widening (no columns, no indexes, no grants):
--   ~ task_recurrence_rules_frequency_ck  — allow 'daily' alongside weekly/monthly
--   ~ task_recurrence_rules_weekday_ck    — allow (daily => weekday IS NULL AND
--                                           day_of_month IS NULL)
--
-- Business contract (V1):
--   - "Hàng ngày" = every calendar day. No per-weekday selection is exposed in
--     V1. A daily rule stores weekday IS NULL and day_of_month IS NULL.
--   - anchor_date = the user's start date itself (first occurrence).
--   - Everything else (idempotency, pause/resume no-backfill, future-only edit,
--     "Số lần lặp", permissions, VN timezone) is unchanged — the engine models
--     daily as "all seven weekdays" over the already-proven date-math path.
--   - Existing weekly / monthly rows keep passing both CHECKs unchanged.
-- =============================================================================

alter table task.recurrence_rules drop constraint task_recurrence_rules_frequency_ck;
alter table task.recurrence_rules add constraint task_recurrence_rules_frequency_ck
  check (frequency in ('daily', 'weekly', 'monthly'));

alter table task.recurrence_rules drop constraint task_recurrence_rules_weekday_ck;
alter table task.recurrence_rules add constraint task_recurrence_rules_weekday_ck check (
  (frequency = 'daily'   and weekday is null and day_of_month is null)
  or
  (frequency = 'weekly'  and weekday in ('T2','T3','T4','T5','T6','T7','CN') and day_of_month is null)
  or
  (frequency = 'monthly' and day_of_month between 1 and 31 and weekday is null)
);

commit;

-- =============================================================================
-- VALIDATION (read-only, run AFTER apply — not in the transaction).
-- =============================================================================

-- 1. Both CHECKs now mention 'daily'
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conname in ('task_recurrence_rules_frequency_ck', 'task_recurrence_rules_weekday_ck')
order by conname;

-- 2. daily round-trip (expect: insert OK, then a daily row carrying a weekday ERRORS)
-- insert into task.recurrence_rules
--   (title, content, category_code, priority, primary_employee_code,
--    anchor_date, start_hour, start_minute, duration_ms, frequency,
--    end_condition_type, created_by_employee_code)
--   values ('x','',<some active category>,'thuong','PHF000',
--    current_date, 8, 0, 86400000, 'daily', 'never', 'PHF000');
-- insert ... frequency='daily', weekday='T2'        -> expect ERROR
-- insert ... frequency='daily', day_of_month = 5    -> expect ERROR

-- 3. existing weekly/monthly rows still valid
select count(*) as still_valid_rows from task.recurrence_rules
where (frequency = 'weekly' and weekday is not null)
   or (frequency = 'monthly' and day_of_month is not null);

-- 4. grants unchanged (constraint-only change — nothing new to phf_hr_app)
select grantee, string_agg(privilege_type, ',' order by privilege_type)
from information_schema.role_table_grants
where table_schema = 'task' and table_name = 'recurrence_rules'
group by grantee order by grantee;
