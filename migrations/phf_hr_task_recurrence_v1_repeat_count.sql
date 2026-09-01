begin;

-- =============================================================================
-- PHF Task — RECURRENCE V1 — "Số lần lặp" (finite repeat count).
--
-- REVIEW + THROWAWAY APPLY ONLY, by the deployer (postgres superuser + docker),
-- against phf_hr_e2e FIRST. NOT for production until Operator GO.
-- Applies ON TOP OF migrations/phf_hr_task_recurrence_v1.sql (+ its acl_fix).
-- DOWN: migrations/phf_hr_task_recurrence_v1_repeat_count_DOWN.sql
--
-- Purely ADDITIVE:
--   + task.recurrence_rules.max_occurrences   smallint NULL
--   + task.recurrence_occurrences.is_initial  boolean NOT NULL DEFAULT false
--   ~ task_recurrence_rules_end_ck  — widened to allow end_condition_type
--     'after_count' (with max_occurrences 1..200), alongside 'never'/'on_date'.
--
-- Business contract (LOCKED 2026-08-31):
--   - "Số lần lặp" N = number of FUTURE Tasks the scheduler actually generates.
--   - The initial Task created by Full Create (claimed as occurrence #1, marked
--     is_initial=true) is NOT counted in N.
--   - Skipped occurrences (explicit pause, primary_inactive, category_inactive)
--     DO NOT consume N — only status='generated' AND is_initial=false rows do.
--   - When the Nth counted Task is generated, the rule auto-ends
--     (status='ended') — enforced by the engine, not the schema.
--   - NULL max_occurrences => repeat indefinitely until manually stopped.
--   - Upper bound 200 is a NEW engine/schema limit (no prior lifetime cap
--     existed — generateDue only had per-run caps). 200 ≈ ~4 years weekly /
--     ~16 years monthly; well inside smallint and the datemath iteration guard.
-- =============================================================================

alter table task.recurrence_rules
  add column if not exists max_occurrences smallint;

alter table task.recurrence_occurrences
  add column if not exists is_initial boolean not null default false;

-- Widen the end-condition CHECK. Old rows (never / on_date) keep passing:
-- max_occurrences is NULL for them by the ADD COLUMN default.
alter table task.recurrence_rules drop constraint task_recurrence_rules_end_ck;
alter table task.recurrence_rules add constraint task_recurrence_rules_end_ck check (
  (end_condition_type = 'never'       and end_date is null     and max_occurrences is null)
  or
  (end_condition_type = 'on_date'     and end_date is not null and max_occurrences is null)
  or
  (end_condition_type = 'after_count' and end_date is null     and max_occurrences between 1 and 200)
);

-- Supports the engine's hot-path count:
--   SELECT count(*) FROM task.recurrence_occurrences
--   WHERE rule_id = $1 AND status = 'generated' AND is_initial = false
create index if not exists task_recurrence_occurrences_counted_idx
  on task.recurrence_occurrences(rule_id)
  where status = 'generated' and is_initial = false;

commit;

-- =============================================================================
-- VALIDATION (read-only, run AFTER apply — not in the transaction).
-- =============================================================================

-- 1. New columns present
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'task'
  and (
    (table_name = 'recurrence_rules' and column_name = 'max_occurrences')
    or (table_name = 'recurrence_occurrences' and column_name = 'is_initial')
  )
order by table_name, column_name;
-- expected: max_occurrences smallint YES (null);  is_initial boolean NO (false)

-- 2. end-condition CHECK now allows after_count
select pg_get_constraintdef(oid) from pg_constraint where conname = 'task_recurrence_rules_end_ck';
-- expected: ... end_condition_type = 'after_count' ... max_occurrences between 1 and 200 ...

-- 3. after_count round-trip (expect: insert OK, then bad-bound insert ERRORS)
-- insert into task.recurrence_rules
--   (title, content, category_code, priority, primary_employee_code,
--    anchor_date, start_hour, start_minute, duration_ms, frequency, weekday,
--    end_condition_type, max_occurrences, created_by_employee_code)
--   values ('x','',<some active category>,'thuong','PHF000',
--    current_date, 8, 0, 86400000, 'weekly', 'T2', 'after_count', 3, 'PHF000');
-- insert ... end_condition_type='after_count', max_occurrences = 0    -> expect ERROR
-- insert ... end_condition_type='after_count', max_occurrences = 201  -> expect ERROR
-- insert ... end_condition_type='after_count', max_occurrences = NULL -> expect ERROR

-- 4. index present
select indexname from pg_indexes
where schemaname = 'task' and indexname = 'task_recurrence_occurrences_counted_idx';

-- 5. grants unchanged (columns inherit table grants — nothing new to phf_hr_app)
select grantee, string_agg(privilege_type, ',' order by privilege_type)
from information_schema.role_table_grants
where table_schema = 'task' and table_name in ('recurrence_rules', 'recurrence_occurrences')
group by grantee order by grantee;
