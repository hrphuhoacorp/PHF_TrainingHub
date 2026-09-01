begin;

-- =============================================================================
-- PHF Task — RECURRENCE V1 — company PostgreSQL `phf_hr`, schema `task`.
--
-- REVIEW + THROWAWAY APPLY ONLY. Applied by deployer (postgres/docker actor)
-- via `psql -v ON_ERROR_STOP=1 -f` against the disposable E2E container
-- `phf_hr_e2e` FIRST. NOT for production until Operator GO.
-- DOWN: migrations/phf_hr_task_recurrence_v1_DOWN.sql
--
-- Purely ADDITIVE:
--   + task.recurrence_rules              (recurring template/config — mutable)
--   + task.recurrence_occurrences        (1 row per DECIDED occurrence)
--   + task.recurrence_rule_history       (append-only audit)
--   + 1 new event_type value 'recurring_generated' on task.events CHECK
--   + GRANTs to phf_hr_app
--
-- Does NOT ALTER task.tasks (the recurrence linkage columns
-- recurring_series_id / recurring_series_version / scheduled_occurrence_at /
-- occurrence_period ALREADY EXIST from Foundation — verified 2026-08-31 read-
-- only on phf_hr and phf_hr_e2e). batch_id intentionally NOT used in V1
-- (each occurrence = one standalone Task).
--
-- Business locks (RECURRENCE_V1_DESIGN = PASS_WITH_ADJUSTMENTS):
--   - V1 frequency: weekly | monthly ONLY. No daily/yearly (the pure engine
--     api/_lib/task-recurrence.js supports more; V1 UI/API/schema do not).
--   - No pre-created future Tasks. task.recurrence_occurrences only ever holds
--     rows for occurrences whose date <= VN-today.
--   - DB-level duplicate guarantee: UNIQUE (rule_id, occurrence_date).
--   - Month-end fallback (min(day_of_month, days_in_month)) is computed by the
--     engine, not the schema — day_of_month stays 1..31 verbatim.
--   - NO mail/notification delivery state in these tables (mail + in-app
--     notification are OUT OF SCOPE for V1 — a future delivery system owns its
--     own idempotency). The only hook V1 provides is the canonical
--     'recurring_generated' task.events row.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. task.recurrence_rules — the recurring template. MUTABLE (config that is
--    still alive), unlike task.tasks. Editing affects only future UNCLAIMED
--    occurrences (enforced in the API layer: bump rule_version, occurrences
--    keep rule_version_at_claim).
-- -----------------------------------------------------------------------------
create table task.recurrence_rules (
  id uuid primary key default gen_random_uuid(),

  -- Task template snapshot for each generated occurrence.
  title text not null,
  content text not null default '',
  category_code text not null references task.categories(category_code) on delete restrict,
  priority text not null default 'thuong',
  primary_employee_code text not null,
  related_employee_codes text[] not null default '{}',

  -- Timing. start_hour/start_minute are Asia/Ho_Chi_Minh (UTC+7) wall time.
  -- anchor_date is the VN-local calendar date the schedule is anchored on
  -- (for weekly it is snapped by the API layer to the first date matching
  -- `weekday` on/after the user's start date).
  anchor_date date not null,
  start_hour smallint not null,
  start_minute smallint not null,
  duration_ms bigint not null,   -- deadline - start; preserved every occurrence

  -- Frequency. V1: weekly | monthly only.
  frequency text not null,
  weekday text,          -- required iff frequency='weekly'; 'T2'..'CN'
  day_of_month smallint, -- required iff frequency='monthly'; 1..31 (min(x,eom) applied by engine)

  -- End condition (natural end).
  end_condition_type text not null default 'never',
  end_date date,         -- required iff end_condition_type='on_date'

  -- Lifecycle of the RULE ITSELF (manual manager action, distinct from end_condition).
  status text not null default 'active',
  paused_from date,      -- set on pause; window [paused_from, paused_to) is never generated
  paused_to date,        -- null while paused; set to the resume date on resume
  ended_at timestamptz,

  rule_version integer not null default 1,

  -- Identity / audit. creator (immutable) vs manager (transferable) — same
  -- dual-track pattern as task.permission_assignments.
  created_by_account_id text,
  created_by_employee_code text,
  manager_account_id text,
  manager_employee_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint task_recurrence_rules_title_ck check (nullif(trim(title), '') is not null),
  constraint task_recurrence_rules_priority_ck check (priority in ('thuong', 'quan_trong', 'khan_cap')),
  constraint task_recurrence_rules_primary_ck check (nullif(trim(primary_employee_code), '') is not null),
  constraint task_recurrence_rules_start_hour_ck check (start_hour between 0 and 23),
  constraint task_recurrence_rules_start_minute_ck check (start_minute between 0 and 59),
  constraint task_recurrence_rules_duration_ck check (duration_ms > 0),
  constraint task_recurrence_rules_frequency_ck check (frequency in ('weekly', 'monthly')),
  constraint task_recurrence_rules_weekday_ck check (
    (frequency = 'weekly'  and weekday in ('T2','T3','T4','T5','T6','T7','CN') and day_of_month is null)
    or
    (frequency = 'monthly' and day_of_month between 1 and 31 and weekday is null)
  ),
  constraint task_recurrence_rules_end_ck check (
    (end_condition_type = 'never'   and end_date is null)
    or
    (end_condition_type = 'on_date' and end_date is not null)
  ),
  constraint task_recurrence_rules_status_ck check (status in ('active', 'paused', 'ended')),
  constraint task_recurrence_rules_pause_ck check (
    (status <> 'paused') or (paused_from is not null)
  ),
  constraint task_recurrence_rules_ended_ck check (
    (status <> 'ended') or (ended_at is not null)
  ),
  constraint task_recurrence_rules_creator_ck check (
    nullif(trim(coalesce(created_by_account_id, '')), '') is not null
    or nullif(trim(coalesce(created_by_employee_code, '')), '') is not null
  )
);

create index task_recurrence_rules_scan_idx on task.recurrence_rules(status, frequency);
create index task_recurrence_rules_primary_idx on task.recurrence_rules(primary_employee_code);
create index task_recurrence_rules_manager_idx on task.recurrence_rules(manager_employee_code);
create index task_recurrence_rules_creator_idx on task.recurrence_rules(created_by_employee_code);

-- -----------------------------------------------------------------------------
-- B. task.recurrence_occurrences — one row per occurrence the engine has
--    DECIDED on (generated OR skipped). status='pending' is only a transient
--    in-transaction state (claim -> generate/skip within the same txn); a row
--    left 'pending' means a crash mid-transaction and the next run reconciles
--    it. The row is the atomic CLAIM: UNIQUE (rule_id, occurrence_date).
-- -----------------------------------------------------------------------------
create table task.recurrence_occurrences (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references task.recurrence_rules(id) on delete restrict,
  occurrence_date date not null,        -- VN-local calendar date of the occurrence
  occurrence_index integer not null,    -- 1-based, per rule
  status text not null default 'pending',
  scheduled_start_at timestamptz not null, -- VN wall time -> UTC instant it should have been created
  is_catchup boolean not null default false,
  generated_task_id uuid references task.tasks(id) on delete set null,
  generated_at timestamptz,
  skip_reason text,                     -- required iff status='skipped'
  rule_version_at_claim integer not null,
  created_at timestamptz not null default now(),

  -- MANDATORY DB-level duplicate protection (retry / double scheduler / restart).
  constraint task_recurrence_occurrence_uq unique (rule_id, occurrence_date),

  constraint task_recurrence_occurrence_status_ck check (status in ('pending', 'generated', 'skipped')),
  constraint task_recurrence_occurrence_index_ck check (occurrence_index >= 1),
  constraint task_recurrence_occurrence_shape_ck check (
    (status = 'generated' and generated_task_id is not null and generated_at is not null and skip_reason is null)
    or
    (status = 'skipped'   and generated_task_id is null and nullif(trim(skip_reason), '') is not null)
    or
    (status = 'pending'   and generated_task_id is null and generated_at is null)
  )
);

create index task_recurrence_occurrences_rule_idx on task.recurrence_occurrences(rule_id, occurrence_date);
create index task_recurrence_occurrences_status_idx on task.recurrence_occurrences(status);
create index task_recurrence_occurrences_task_idx on task.recurrence_occurrences(generated_task_id) where generated_task_id is not null;

-- -----------------------------------------------------------------------------
-- C. task.recurrence_rule_history — append-only audit (mirrors
--    task.permission_assignment_history: SELECT+INSERT grant only, forbid
--    update/delete trigger).
-- -----------------------------------------------------------------------------
create table task.recurrence_rule_history (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references task.recurrence_rules(id) on delete restrict,
  action text not null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  reason text,
  changed_by_account_id text,
  changed_by_employee_code text,
  changed_at timestamptz not null default now(),
  constraint task_recurrence_rule_history_action_ck check (
    action in ('create', 'update', 'pause', 'resume', 'end', 'transfer_manager', 'skip_occurrence')
  ),
  constraint task_recurrence_rule_history_actor_ck check (
    nullif(trim(coalesce(changed_by_account_id, '')), '') is not null
    or nullif(trim(coalesce(changed_by_employee_code, '')), '') is not null
  )
);
create index task_recurrence_rule_history_rule_idx
  on task.recurrence_rule_history(rule_id, changed_at desc);

create trigger task_recurrence_rule_history_forbid_update before update on task.recurrence_rule_history
  for each row execute function task.task_forbid_update_delete();
create trigger task_recurrence_rule_history_forbid_delete before delete on task.recurrence_rule_history
  for each row execute function task.task_forbid_update_delete();

-- -----------------------------------------------------------------------------
-- D. task.events — additive: allow the new canonical hook event.
--    'recurring_change' (rule edited) already exists from Foundation.
--    'recurring_generated' is emitted once on each Task the recurrence engine
--    creates — the ONLY hook a future Notification/Mail phase needs.
-- -----------------------------------------------------------------------------
alter table task.events drop constraint task_events_event_type_ck;
alter table task.events add constraint task_events_event_type_ck check (event_type in (
  'published', 'assignment', 'transfer', 'progress', 'comment', 'deadline_change',
  'extension_request', 'extension_decision', 'priority_change', 'attachment', 'link',
  'completion', 'reopen', 'cancel', 'recurring_change', 'monthly_close', 'permission_change',
  'proposal_accept', 'proposal_reject', 'proposal_cancel',
  'recurring_generated'
));

-- -----------------------------------------------------------------------------
-- E. GRANTs — explicit, minimal, no wildcard, no PUBLIC (Foundation convention).
--
-- IMPORTANT: some environments (the phf_hr_e2e throwaway included) run
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA task GRANT ALL ON TABLES TO phf_hr_app
-- at provision time, so every NEW table is born with phf_hr_app=arwdDxtm
-- (INSERT/SELECT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER). A bare `grant
-- select, insert, …` cannot walk that back — so each table is pinned below
-- with an explicit REVOKE to exactly the runtime minimum.
--   recurrence_rule_history : SELECT + INSERT only (append-only audit log)
--   recurrence_rules        : SELECT + INSERT + UPDATE (rule edits / lifecycle)
--   recurrence_occurrences  : SELECT + INSERT + UPDATE (claim -> finalise)
--   none                    : DELETE / TRUNCATE / REFERENCES / TRIGGER
-- -----------------------------------------------------------------------------
grant select, insert, update on task.recurrence_rules to phf_hr_app;
grant select, insert, update on task.recurrence_occurrences to phf_hr_app;
grant select, insert on task.recurrence_rule_history to phf_hr_app;

revoke delete, truncate, references, trigger on task.recurrence_rules from phf_hr_app;
revoke delete, truncate, references, trigger on task.recurrence_occurrences from phf_hr_app;
revoke update, delete, truncate, references, trigger on task.recurrence_rule_history from phf_hr_app;

-- BEFORE TRUNCATE guard for the audit log — row-level UPDATE/DELETE triggers do
-- NOT fire on TRUNCATE, so this statement-level trigger is the last line of
-- defence keeping recurrence_rule_history immutable even if a future GRANT slips
-- TRUNCATE back in. Reuses the existing Z-51 forbid function (its message reads
-- tg_op, which is 'TRUNCATE' here).
create trigger task_recurrence_rule_history_forbid_truncate before truncate on task.recurrence_rule_history
  for each statement execute function task.task_forbid_update_delete();

commit;

-- =============================================================================
-- VALIDATION QUERIES (read-only, run AFTER apply — not in the transaction).
-- =============================================================================

-- 1. New tables present
select table_name from information_schema.tables
where table_schema = 'task' and table_name like 'recurrence_%' order by table_name;
-- expected: recurrence_occurrences, recurrence_rule_history, recurrence_rules

-- 2. UNIQUE (rule_id, occurrence_date) present
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'task.recurrence_occurrences'::regclass and contype = 'u';
-- expected: task_recurrence_occurrence_uq  UNIQUE (rule_id, occurrence_date)

-- 3. CHECK constraints
select conrelid::regclass as table_name, conname
from pg_constraint
where connamespace = 'task'::regnamespace and conrelid::regclass::text like 'task.recurrence_%'
order by table_name, conname;

-- 4. Indexes
select tablename, indexname from pg_indexes
where schemaname = 'task' and tablename like 'recurrence_%' order by tablename, indexname;

-- 5. History append-only triggers present
select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where trigger_schema = 'task' and event_object_table = 'recurrence_rule_history'
order by trigger_name;

-- 6. event_type CHECK now includes 'recurring_generated'
select pg_get_constraintdef(oid) from pg_constraint where conname = 'task_events_event_type_ck';

-- 7. Grants — only phf_hr_app / owner, nothing to PUBLIC
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'task' and table_name like 'recurrence_%'
order by table_name, grantee, privilege_type;

-- 8. FK ON DELETE behaviour
select conname, confdeltype
from pg_constraint
where conrelid::regclass::text like 'task.recurrence_%' and contype = 'f'
order by conname;
-- expected: rule_id FKs = 'r' (RESTRICT); generated_task_id FK = 'n' (SET NULL)

-- 9. Append-only proof (expect ERROR on both):
-- insert into task.recurrence_rule_history(rule_id, action, changed_by_employee_code)
--   values ((select id from task.recurrence_rules limit 1), 'create', 'PHF000');
-- update task.recurrence_rule_history set reason = 'x';   -- expect: forbid trigger error
-- delete from task.recurrence_rule_history;               -- expect: forbid trigger error
