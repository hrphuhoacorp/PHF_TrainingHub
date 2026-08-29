-- =============================================================================
-- PHF HR — TASK SERVER FOUNDATION MIGRATION (Gate S2B artifact)
-- Target: database phf_hr (PostgreSQL 17, phf-postgres container), schema "task".
--
-- REVIEW ONLY. DO NOT EXECUTE. Not committed/pushed/deployed. Written by
-- Claude Code (claude-phf has NO write access to Postgres — this file exists
-- only as a local artifact for human/deployer review before any GO).
--
-- SOURCE OF TRUTH (verbatim final-state columns/constraints, read from these
-- exact files — nothing reconstructed from memory):
--   PHF_TASK_FOUNDATION_1.66.0.sql
--   PHF_TASK_PERMISSIONS_1.66.1.sql
--   PHF_TASK_FOUNDATION_CORRECTION_1.68.0.sql
--   PHF_TASK_PERMISSION_V1_TARGETED_1.69.0.sql   (added Gate S2C)
--   PHF_TASK_CODE_IDEMPOTENCY_1.71.0.sql
--   PHF_TASK_CROSS_DEPARTMENT_NOTIFICATION_1.72.0.sql
--   PHF_TASK_CORE_RPC_1.67.0.sql                 (read Gate S2C, for audit only — functions NOT ported, see below)
--
-- REVISED IN GATE S2C: task_permission_assignments/task_permission_assignment_history
-- ARE now included below (confirmed GO-LIVE REQUIRED — task-permissions.js
-- resolveEffectiveTaskScope() reads task_permission_assignments directly for
-- every permission check). Original S2B artifact had wrongly omitted these.
--
-- DELIBERATELY NOT PORTED IN THIS ARTIFACT (see Gate S2C output for full
-- reasoning):
--   - Supabase RLS / grants to anon,authenticated (no PostgREST here, N/A)
--   - task_set_permission_assignment() RPC — decision: MOVE_TO_PHF_HR_API_TRANSACTION
--     (see Gate S2C). Tables it writes to ARE created below.
--   - task_normalize_actor_identity() trigger — depends on public.user_accounts
--     (Employee Master, not migrated) — CANNOT be verbatim-ported safely.
--   - task_snapshot_department_on_publish() trigger — depends on
--     public.employee_profiles (Employee Master, not migrated) — CANNOT be
--     verbatim-ported safely.
--   - 10 RPC functions total (task_create_draft, task_publish,
--     task_update_progress, task_complete, task_reopen, task_cancel,
--     task_change_deadline, task_transfer_primary, task_add_related,
--     task_add_link) — full source read and audited in Gate S2C. Decision:
--     MOVE_TO_PHF_HR_API_TRANSACTION for all 10 — the original reason they
--     were Postgres RPCs (PostgREST/@supabase-js only sends 1 statement per
--     network call, so multi-statement atomicity required a DB-side
--     function) DOES NOT APPLY once phf-hr-api uses a native `pg` client,
--     which can wrap BEGIN/.../COMMIT itself. Moving them keeps one
--     language/test surface (JS) for business logic and matches "API server
--     is the new write boundary" — see Gate S2C LOGIC_TO_MOVE_TO_API.
--     NOT implemented in this artifact (schema-only gate) — a dedicated
--     follow-up gate must design+review the JS transaction equivalents
--     before phf-hr-api code is touched.
--
-- *** CORRECTED — SUPERSEDES the original note below ***
-- The "REAL_TASKS_TO_MIGRATE = 0" conclusion below was evidence collected
-- WITHOUT confirming which Supabase project the query actually ran against
-- (identity-verification gap, caught and fixed in a later turn). Once both
-- projects were independently confirmed by the human (visually checking the
-- Supabase Dashboard project selector before each query):
--   byhpcexmjzqpctyvfczd (TrainingHub — code-level PRODUCTION_HOSTNAME,
--     PARTIALLY_VERIFIED as the real source-of-truth, see chat Gate S2C
--     Environment Identity Assessment): fixture_rows=0, non_fixture_rows=3,
--     total_rows=3, 13/13 categories match this artifact's snapshot exactly.
--   pxkjvawdrixgoukhyvnk (PHF-HR-DEV — code-level DEV_HOSTNAME): fixture_rows=2,
--     non_fixture_rows=0, total_rows=2 — THIS is what the original note below
--     was actually measuring.
-- SOURCE_OF_TRUTH = VERIFIED (confirmed: Vercel Production SUPABASE_URL
-- project ref starts "byhpce...", matches byhpcexmjzqpctyvfczd / TrainingHub).
--
-- FINAL: REAL_TASKS_TO_MIGRATE = 0. The 3 non-fixture-by-regex rows on
-- TrainingHub (CV-2608-0001/0002/0003, titled "[TEST 1.70.0]"/"[TEST 1.71]"/
-- "[TEST 1.72]") are confirmed migration-verification test artifacts created
-- directly on Production while applying schema migrations 1.70.0/1.71/1.72 —
-- NOT real business Task data. (Process note: the fixture-detection regex
-- used earlier only matched "PARITY_TEST_*"/"[PARITY_TEST_*]" — it missed
-- this different "[TEST x.y.z]" naming convention used for on-Production
-- migration verification. Worth widening the pattern in any future inventory
-- query.)
--
-- DECISION: these 3 rows are PRESERVED, NOT deleted, NOT migrated — kept on
-- Supabase as-is for audit trail, unless a separate cleanup gate is approved
-- later. Cutover for task.tasks/assignees/events/etc. requires ZERO data
-- migration — only the category snapshot (companion file) needs applying.
--
-- --- ORIGINAL (INCORRECT PROJECT) NOTE, kept for audit trail, DO NOT TRUST ---
-- CUTOVER EVIDENCE (Gate S2C, confirmed via Supabase SQL Editor by human,
-- read-only aggregate count query, no row content read):
--   total_rows=2, fixture_rows=2, non_fixture_rows=0, all published.
-- REAL_TASKS_TO_MIGRATE = 0 — no real Task data exists on Supabase today.
-- Cutover requires ZERO data migration for task.tasks/assignees/events/etc.
-- (only the category snapshot in the companion file needs to be applied).
-- --- end original note ---
--
-- CONSEQUENCE: this artifact creates DATA STRUCTURE + hard invariants only
-- (constraints, uniqueness, append-only triggers). Write-path ORCHESTRATION
-- logic (state machine validation, row_version CAS orchestration, atomic
-- multi-table writes) is NOT yet implemented anywhere for phf_hr — that is
-- the explicit scope of the next gate, not this one.
-- =============================================================================

-- =============================================================================
-- ROLE ACTIVATION — self-contained, NOT dependent on how psql was invoked.
--
-- Do NOT rely on `psql -c "SET ROLE phf_hr_owner;" -f this_file.sql` — that
-- assumes psql combines -c and -f into one session in the given order,
-- which is real psql behavior but is an EXTERNAL, IMPLICIT assumption not
-- verifiable by reading this file alone, and gives no visible proof the
-- role switch actually took effect before DDL runs. SET ROLE + explicit
-- verification are done HERE, inside the single script, instead.
--
-- \set ON_ERROR_STOP makes psql abort the ENTIRE script on the FIRST error
-- — including a failed SET ROLE (e.g. connecting login is not a member of
-- phf_hr_owner) — instead of silently continuing under the wrong role.
-- =============================================================================
\set ON_ERROR_STOP on

SET ROLE phf_hr_owner;

-- Hard visible proof, not an assumption: abort immediately if the role
-- switch did not actually take effect for any reason.
DO $$
begin
  if current_user <> 'phf_hr_owner' then
    raise exception 'ROLE_NOT_ACTIVE: expected current_user=phf_hr_owner, got %. Aborting before any DDL runs.', current_user;
  end if;
end $$;

begin;

-- No IF NOT EXISTS on schema creation — this MUST fail loudly if "task"
-- schema already exists (would indicate unexpected prior state, not
-- something to silently paper over per Gate S2B instruction 9).
create schema task authorization phf_hr_owner;

-- -----------------------------------------------------------------------------
-- Shared append-only guard function (verbatim from PHF_TASK_FOUNDATION_1.66.0.sql)
-- Self-contained — no external table dependency, safe to port as-is.
-- -----------------------------------------------------------------------------
create or replace function task.task_forbid_update_delete() returns trigger as $$
begin
  raise exception 'PHF Task: bảng % là append-only — không cho phép % (Z-51).', tg_table_name, tg_op
    using errcode = '0A000';
end;
$$ language plpgsql;

-- -----------------------------------------------------------------------------
-- task.categories (verbatim structure from task_categories, final state incl.
-- 1.68.0 audit columns; RLS/anon/authenticated grants dropped — N/A here)
-- -----------------------------------------------------------------------------
create table task.categories (
  category_code text primary key,
  display_name text not null,
  description text not null default '',
  color text not null default '#64748B',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_account_id text,
  created_by_employee_code text,
  updated_by_account_id text,
  updated_by_employee_code text,
  sort_order integer,                     -- added PHF_TASK_CATEGORY_CREATE_FOUNDATION_1.70.0.sql, missed in original S2B pass, fixed in S2C
  constraint task_categories_code_ck check (category_code = upper(category_code) and category_code ~ '^[A-Z0-9_]+$'),
  constraint task_categories_name_ck check (nullif(trim(display_name), '') is not null)
);
create index task_categories_active_idx on task.categories(is_active);

-- -----------------------------------------------------------------------------
-- task.tasks (verbatim final-state columns across 1.66.0 + 1.68.0 + 1.71.0 +
-- 1.72.0 — historical intermediate ALTERs collapsed, per instruction 2)
-- -----------------------------------------------------------------------------
create table task.tasks (
  id uuid primary key default gen_random_uuid(),
  flow_type text not null,
  status text not null default 'draft',
  title text not null,
  content text not null default '',
  category_code text not null references task.categories(category_code) on delete restrict,
  priority text not null default 'thuong',
  start_at timestamptz,
  deadline timestamptz not null,
  deadline_version integer not null default 1,
  created_by_employee_code text,          -- 1.68.0: nullable, one-of with account_id
  created_by_account_id text,             -- 1.68.0
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  progress_status text not null default 'chua_bat_dau',
  progress_percent integer not null default 0,
  last_progress_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  copied_from_task_id uuid references task.tasks(id) on delete set null,
  recurring_series_id uuid,
  recurring_series_version integer,
  scheduled_occurrence_at timestamptz,
  occurrence_period text,
  batch_id uuid,
  row_version integer not null default 1,
  task_code text,                          -- 1.71.0, set NOT NULL below after this DDL block (fresh DB: 0 rows, safe immediately)
  create_idempotency_key uuid,             -- 1.71.0
  legacy_source text,                      -- 1.71.0
  legacy_task_code text,                   -- 1.71.0
  source_department text,                  -- 1.72.0
  target_department text,                  -- 1.72.0
  is_cross_department boolean,             -- 1.72.0
  constraint task_tasks_flow_type_ck check (flow_type in ('giao_viec', 'de_xuat')),
  constraint task_tasks_status_ck check (status in ('draft', 'published', 'in_progress', 'completed', 'cancelled')),
  constraint task_tasks_priority_ck check (priority in ('thuong', 'quan_trong', 'khan_cap')),
  constraint task_tasks_progress_status_ck check (progress_status in ('chua_bat_dau', 'dang_thuc_hien', 'hoan_thanh')),
  constraint task_tasks_progress_percent_ck check (progress_percent between 0 and 100),
  constraint task_tasks_title_ck check (nullif(trim(title), '') is not null),
  -- 1.68.0 corrected version: one of employee_code/account_id required (not employee_code alone as in 1.66.0 original)
  constraint task_tasks_created_by_ck check (
    nullif(trim(coalesce(created_by_employee_code, '')), '') is not null
    or nullif(trim(coalesce(created_by_account_id, '')), '') is not null
  ),
  constraint task_tasks_occurrence_period_ck check (occurrence_period is null or occurrence_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  constraint task_tasks_cancel_reason_ck check (status <> 'cancelled' or nullif(trim(cancel_reason), '') is not null)
);

-- task_code: fresh DB has 0 rows, so NOT NULL + UNIQUE can be applied directly
-- (Supabase original had to do nullable-first + backfill + set-not-null in
-- separate steps because it had existing rows; that 2-step dance is HISTORICAL
-- migration mechanics, not business behavior — safe to collapse per instruction 2).
alter table task.tasks alter column task_code set not null;
alter table task.tasks add constraint task_tasks_task_code_key unique (task_code);

create index task_tasks_status_idx on task.tasks(status);
create index task_tasks_deadline_idx on task.tasks(deadline);
create index task_tasks_created_by_idx on task.tasks(created_by_employee_code);
create index task_tasks_category_idx on task.tasks(category_code);
create index task_tasks_occurrence_period_idx on task.tasks(occurrence_period);
create index task_tasks_batch_idx on task.tasks(batch_id) where batch_id is not null;
create unique index task_tasks_actor_idem_key_uniq
  on task.tasks(created_by_employee_code, create_idempotency_key)
  where create_idempotency_key is not null;

-- -----------------------------------------------------------------------------
-- task.assignees (verbatim from task_assignees, final state incl. 1.68.0)
-- -----------------------------------------------------------------------------
create table task.assignees (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references task.tasks(id) on delete cascade,
  employee_code text not null,
  role text not null,
  is_active boolean not null default true,
  assigned_at timestamptz not null default now(),
  assigned_by_employee_code text not null,
  assigned_by_account_id text,             -- 1.68.0
  deactivated_at timestamptz,
  constraint task_assignees_role_ck check (role in ('primary', 'related')),
  constraint task_assignees_employee_ck check (nullif(trim(employee_code), '') is not null),
  constraint task_assignees_assigned_by_ck check (nullif(trim(assigned_by_employee_code), '') is not null)
);
create unique index task_assignees_one_active_primary_uq
  on task.assignees(task_id)
  where role = 'primary' and is_active = true;
create unique index task_assignees_one_active_assignment_per_employee_uq
  on task.assignees(task_id, employee_code)
  where is_active = true;
create index task_assignees_employee_idx on task.assignees(employee_code) where is_active = true;
create index task_assignees_task_idx on task.assignees(task_id);

-- -----------------------------------------------------------------------------
-- task.events (append-only, verbatim from task_events incl. 1.68.0 column)
-- -----------------------------------------------------------------------------
create table task.events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references task.tasks(id) on delete cascade,
  event_type text not null,
  actor_employee_code text not null,
  actor_account_id text,                   -- 1.68.0
  payload jsonb not null default '{}'::jsonb,
  reason text,
  occurred_at timestamptz not null default now(),
  constraint task_events_event_type_ck check (event_type in (
    'published', 'assignment', 'transfer', 'progress', 'comment', 'deadline_change',
    'extension_request', 'extension_decision', 'priority_change', 'attachment', 'link',
    'completion', 'reopen', 'cancel', 'recurring_change', 'monthly_close', 'permission_change'
  )),
  constraint task_events_actor_ck check (nullif(trim(actor_employee_code), '') is not null)
);
create index task_events_task_idx on task.events(task_id, occurred_at desc);
create index task_events_type_idx on task.events(event_type);

create trigger task_events_forbid_update before update on task.events
  for each row execute function task.task_forbid_update_delete();
create trigger task_events_forbid_delete before delete on task.events
  for each row execute function task.task_forbid_update_delete();

-- -----------------------------------------------------------------------------
-- task.comments (verbatim from task_comments incl. 1.68.0 column)
--
-- NOTE — exact source behavior preserved: the ORIGINAL Supabase
-- task_comments has NO forbid-update/delete trigger (append-only there is an
-- APPLICATION-LEVEL convention only, per its own source comment "V1 không
-- sửa/xóa"), unlike task_events which IS DB-enforced. Per instruction 5
-- ("do not invent behavior not in source"), NO trigger is added here either
-- — this is a deliberate 1:1 match with what the source actually enforces,
-- not an oversight.
-- -----------------------------------------------------------------------------
create table task.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references task.tasks(id) on delete cascade,
  author_employee_code text not null,
  author_account_id text,                  -- 1.68.0
  body text not null,
  created_at timestamptz not null default now(),
  constraint task_comments_author_ck check (nullif(trim(author_employee_code), '') is not null),
  constraint task_comments_body_ck check (nullif(trim(body), '') is not null)
);
create index task_comments_task_idx on task.comments(task_id, created_at);

-- -----------------------------------------------------------------------------
-- task.links (verbatim from task_links incl. 1.68.0 column)
-- -----------------------------------------------------------------------------
create table task.links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references task.tasks(id) on delete cascade,
  side text not null,
  url text not null,
  label text,
  added_by_employee_code text not null,
  added_by_account_id text,                 -- 1.68.0
  related_event_id uuid references task.events(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint task_links_side_ck check (side in ('input_reference', 'output_result', 'coordination')),
  constraint task_links_url_ck check (nullif(trim(url), '') is not null),
  constraint task_links_added_by_ck check (nullif(trim(added_by_employee_code), '') is not null)
);
create index task_links_task_idx on task.links(task_id);

-- -----------------------------------------------------------------------------
-- task.permission_grants + task.permission_grant_history
-- (verbatim from PHF_TASK_PERMISSIONS_1.66.1.sql incl. 1.68.0 audit columns)
-- -----------------------------------------------------------------------------
create table task.permission_grants (
  id uuid primary key default gen_random_uuid(),
  grantee_employee_code text not null,
  grant_type text not null,
  people_scope jsonb not null default '{"type":"self","values":[]}'::jsonb,
  capabilities jsonb not null default '{}'::jsonb,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  reason text not null,
  is_active boolean not null default true,
  created_by_employee_code text not null,
  created_by_account_id text,               -- 1.68.0
  created_at timestamptz not null default now(),
  updated_by_employee_code text,
  updated_by_account_id text,               -- 1.68.0
  updated_at timestamptz not null default now(),
  constraint task_permission_grantee_ck check (nullif(trim(grantee_employee_code), '') is not null),
  constraint task_permission_grant_type_ck check (grant_type in ('extend', 'restrict', 'delegation')),
  constraint task_permission_reason_ck check (nullif(trim(reason), '') is not null),
  constraint task_permission_created_by_ck check (nullif(trim(created_by_employee_code), '') is not null),
  constraint task_permission_delegation_window_ck check (grant_type <> 'delegation' or effective_to is not null),
  constraint task_permission_window_order_ck check (effective_to is null or effective_to > effective_from)
);

create table task.permission_grant_history (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references task.permission_grants(id) on delete restrict,
  changed_field text not null,
  old_value jsonb,
  new_value jsonb,
  changed_by_employee_code text not null,
  changed_by_account_id text,               -- 1.68.0
  changed_at timestamptz not null default now(),
  reason text not null,
  constraint task_permission_history_field_ck check (nullif(trim(changed_field), '') is not null),
  constraint task_permission_history_changed_by_ck check (nullif(trim(changed_by_employee_code), '') is not null),
  constraint task_permission_history_reason_ck check (nullif(trim(reason), '') is not null)
);
create index task_permission_history_grant_idx on task.permission_grant_history(grant_id, changed_at desc);

create trigger task_permission_grant_history_forbid_update before update on task.permission_grant_history
  for each row execute function task.task_forbid_update_delete();
create trigger task_permission_grant_history_forbid_delete before delete on task.permission_grant_history
  for each row execute function task.task_forbid_update_delete();

-- -----------------------------------------------------------------------------
-- task.permission_assignments + task.permission_assignment_history
-- ADDED IN GATE S2C — CONFIRMED GO-LIVE REQUIRED: task-permissions.js
-- resolveEffectiveTaskScope() reads task_permission_assignments DIRECTLY
-- (ASSIGNMENTS_TABLE constant) for EVERY permission-sensitive Task action,
-- including the descriptor builder used by the Production bridge. This is
-- NOT deferrable — omitted from the original S2B TARGET_OBJECTS list in
-- error, corrected here. Verbatim from PHF_TASK_PERMISSION_V1_TARGETED_1.69.0.sql
-- (final state after PHF_TASK_FOUNDATION_CORRECTION_1.68.0.sql's *_account_id
-- additions — already present in the 1.69.0 source read, no separate ALTER
-- needed). Self-contained: only account_id/employee_code as plain text, no
-- FK to user_accounts/employee_profiles — safe to port verbatim.
-- -----------------------------------------------------------------------------
create table task.permission_assignments (
  id uuid primary key default gen_random_uuid(),
  account_id text,
  employee_code text,
  preset_code text not null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  is_active boolean not null default true,
  reason text not null,
  assigned_by_account_id text,
  assigned_by_employee_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_permission_assignment_identity_ck check (
    nullif(trim(account_id), '') is not null or nullif(trim(employee_code), '') is not null
  ),
  constraint task_permission_assignment_preset_ck check (
    preset_code in ('GIAM_DOC', 'TRO_LY_GD', 'TRUONG_BO_PHAN', 'TRUONG_CA', 'NHAN_VIEN')
  ),
  constraint task_permission_assignment_window_ck check (effective_to is null or effective_to >= effective_from),
  constraint task_permission_assignment_reason_ck check (nullif(trim(reason), '') is not null),
  constraint task_permission_assignment_actor_ck check (
    nullif(trim(assigned_by_account_id), '') is not null or
    nullif(trim(assigned_by_employee_code), '') is not null
  )
);
create unique index task_permission_assignment_active_account_uq
  on task.permission_assignments(account_id) where is_active = true and account_id is not null;
create unique index task_permission_assignment_active_employee_uq
  on task.permission_assignments(employee_code) where is_active = true and employee_code is not null;
create index task_permission_assignment_window_idx
  on task.permission_assignments(is_active, effective_from, effective_to);

create table task.permission_assignment_history (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references task.permission_assignments(id) on delete restrict,
  action text not null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  reason text not null,
  changed_by_account_id text,
  changed_by_employee_code text,
  changed_at timestamptz not null default now(),
  constraint task_permission_assignment_history_action_ck check (action in ('assign', 'deactivate')),
  constraint task_permission_assignment_history_reason_ck check (nullif(trim(reason), '') is not null),
  constraint task_permission_assignment_history_actor_ck check (
    nullif(trim(changed_by_account_id), '') is not null or
    nullif(trim(changed_by_employee_code), '') is not null
  )
);
create index task_permission_assignment_history_assignment_idx
  on task.permission_assignment_history(assignment_id, changed_at desc);

create trigger task_permission_assignment_history_forbid_update before update on task.permission_assignment_history
  for each row execute function task.task_forbid_update_delete();
create trigger task_permission_assignment_history_forbid_delete before delete on task.permission_assignment_history
  for each row execute function task.task_forbid_update_delete();

-- NOTE: task_set_permission_assignment() RPC (the only writer of the 2 tables
-- above) is NOT ported here — same MOVE_TO_PHF_HR_API_TRANSACTION decision as
-- the 10 lifecycle RPCs (see Gate S2C output). Tables above are ready to
-- receive writes from an equivalent API-layer transaction in a follow-up gate.

-- -----------------------------------------------------------------------------
-- task.notifications (verbatim from PHF_TASK_CROSS_DEPARTMENT_NOTIFICATION_1.72.0.sql)
-- -----------------------------------------------------------------------------
create table task.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_account_id text,
  recipient_employee_code text,
  check (recipient_account_id is not null or recipient_employee_code is not null),
  event_code text not null check (event_code in ('TASK_CROSS_DEPARTMENT_ASSIGNED')),
  task_id uuid references task.tasks(id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  message text not null check (length(btrim(message)) > 0),
  target_path text,
  priority text not null default 'Trung bình' check (priority in ('Trung bình','Cao','Khẩn')),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  dedupe_key text
);
create unique index task_notifications_dedupe_uq
  on task.notifications (dedupe_key) where dedupe_key is not null;
create index task_notifications_recipient_employee_idx
  on task.notifications (recipient_employee_code, created_at desc);
create index task_notifications_recipient_account_idx
  on task.notifications (recipient_account_id, created_at desc);
create index task_notifications_task_idx on task.notifications (task_id);

-- -----------------------------------------------------------------------------
-- task.code_counters (verbatim from PHF_TASK_CODE_IDEMPOTENCY_1.71.0.sql)
-- -----------------------------------------------------------------------------
create table task.code_counters (
  scope_key text primary key,
  next_value integer not null default 1,
  updated_at timestamptz not null default now()
);

-- Self-contained (only references task.code_counters) — safe to port verbatim.
create or replace function task.task_next_code(p_now timestamptz)
returns text as $$
declare
  v_yymm text := to_char(p_now at time zone 'Asia/Ho_Chi_Minh', 'YYMM');
  v_seq integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('task-code|' || v_yymm, 0));
  insert into task.code_counters(scope_key, next_value)
  values (v_yymm, 2)
  on conflict (scope_key) do update set next_value = task.code_counters.next_value + 1, updated_at = now()
  returning next_value - 1 into v_seq;
  return 'CV-' || v_yymm || '-' || lpad(v_seq::text, 4, '0');
end;
$$ language plpgsql;

-- Self-contained (only OLD/NEW.task_code) — safe to port verbatim.
create or replace function task.task_forbid_task_code_change()
returns trigger as $$
begin
  if OLD.task_code is distinct from NEW.task_code then
    raise exception 'TASK_CODE_IMMUTABLE — không được đổi task_code sau khi đã cấp (mã cũ: %, mã mới: %).', OLD.task_code, NEW.task_code
      using errcode = '22023';
  end if;
  return NEW;
end;
$$ language plpgsql;
create trigger task_tasks_task_code_immutable
  before update on task.tasks
  for each row
  execute function task.task_forbid_task_code_change();

-- Self-contained (only OLD/NEW columns on task.tasks) — safe to port verbatim.
-- NOTE: this is the GUARD ONLY. The companion "SET on publish" function
-- (task_snapshot_department_on_publish) is NOT ported — it reads
-- public.employee_profiles, which does not exist in phf_hr. Consequence:
-- source_department/target_department/is_cross_department will stay NULL on
-- this schema until the app layer sets them explicitly (main app already has
-- org data via loadOrgRows() and could set these 3 fields itself before/at
-- publish — a DECISION for the follow-up write-path gate, not decided here).
create or replace function task.task_forbid_department_snapshot_change()
returns trigger as $$
begin
  if OLD.source_department is not null and OLD.source_department is distinct from NEW.source_department then
    raise exception 'TASK_DEPARTMENT_SNAPSHOT_IMMUTABLE — không được đổi source_department sau khi đã publish (cũ: %, mới: %).', OLD.source_department, NEW.source_department
      using errcode = '22023';
  end if;
  if OLD.target_department is not null and OLD.target_department is distinct from NEW.target_department then
    raise exception 'TASK_DEPARTMENT_SNAPSHOT_IMMUTABLE — không được đổi target_department sau khi đã publish (cũ: %, mới: %).', OLD.target_department, NEW.target_department
      using errcode = '22023';
  end if;
  return NEW;
end;
$$ language plpgsql;
create trigger task_tasks_department_snapshot_immutable
  before update on task.tasks
  for each row
  execute function task.task_forbid_department_snapshot_change();

-- Self-contained (only OLD.status) — safe to port verbatim.
create or replace function task.task_guard_task_delete() returns trigger as $$
begin
  if old.status <> 'draft' then
    raise exception 'PHF Task: không được hard-delete task % vì status hiện tại là ''%'' — chỉ task ở trạng thái draft mới được xóa cứng, task đã published dùng action Cancel (rule N.26/N.27).', old.id, old.status
      using errcode = '0A000';
  end if;
  return old;
end;
$$ language plpgsql;
create trigger task_tasks_guard_delete before delete on task.tasks
  for each row execute function task.task_guard_task_delete();

-- -----------------------------------------------------------------------------
-- task.attachments (NEW — not in Supabase source, designed per Gate S2 spec)
-- -----------------------------------------------------------------------------
create table task.attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references task.tasks(id) on delete cascade,
  original_filename text not null,
  stored_object_key text not null unique,
  mime_type text not null,
  extension text not null,
  size_bytes bigint not null,
  checksum_sha256 text not null,
  uploaded_by_employee_code text not null,
  created_at timestamptz not null default now(),
  status text not null default 'active',
  deleted_at timestamptz,
  deleted_by_employee_code text,
  constraint task_attachments_filename_ck check (nullif(trim(original_filename), '') is not null),
  constraint task_attachments_size_ck check (size_bytes > 0),
  constraint task_attachments_status_ck check (status in ('active', 'archived', 'pending_delete')),
  constraint task_attachments_uploaded_by_ck check (nullif(trim(uploaded_by_employee_code), '') is not null)
);
create index task_attachments_task_idx on task.attachments(task_id);

-- -----------------------------------------------------------------------------
-- GRANTS — phf_hr_app: minimal, explicit, no wildcard, no login/password set
-- here (per instruction 8 — role is currently NOLOGIN, this migration does
-- NOT alter that; login/password provisioning is a SEPARATE, later step with
-- its own review).
-- -----------------------------------------------------------------------------
grant usage on schema task to phf_hr_app;

grant select, insert, update on
  task.categories,
  task.tasks,
  task.assignees,
  task.attachments
to phf_hr_app;

-- Append-only tables: SELECT + INSERT only, no UPDATE/DELETE grant (DB-level
-- trigger already blocks it for events/permission_grant_history; explicit
-- grant restriction is defense-in-depth, not the only line of defense).
grant select, insert on
  task.events,
  task.comments,
  task.links,
  task.notifications,
  task.permission_grants,
  task.permission_grant_history,
  task.permission_assignment_history
to phf_hr_app;

-- permission_assignments needs UPDATE too (deactivate on preset change, same
-- pattern as the original task_set_permission_assignment RPC does).
grant select, insert, update on task.permission_assignments to phf_hr_app;

grant select, update on task.code_counters to phf_hr_app;
grant select, insert, update on task.notifications to phf_hr_app; -- read_at needs UPDATE

-- Explicit default privileges for THIS schema only — no schema-wide ALTER
-- DEFAULT PRIVILEGES that could leak to future unrelated objects without
-- review. Left deliberately UNSET here; each future table added to "task"
-- needs its own explicit GRANT in its own migration, not an inherited default.

commit;

-- =============================================================================
-- VALIDATION QUERIES (read-only, run AFTER apply — not part of the transaction
-- above; safe to run repeatedly)
-- =============================================================================

-- 1. Exact table list in schema "task"
select table_name from information_schema.tables
where table_schema = 'task' order by table_name;
-- expected: attachments, assignees, categories, code_counters, comments,
--           events, links, notifications, permission_assignment_history,
--           permission_assignments, permission_grant_history,
--           permission_grants, tasks  (13 rows — revised in Gate S2C,
--           added permission_assignments + permission_assignment_history)

-- 2. Constraints per table
select conrelid::regclass as table_name, conname, contype
from pg_constraint
where connamespace = 'task'::regnamespace
order by table_name, conname;

-- 3. Indexes
select tablename, indexname from pg_indexes where schemaname = 'task' order by tablename, indexname;

-- 4. Triggers
select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where trigger_schema = 'task' order by event_object_table, trigger_name;

-- 5. Table owners (all must be phf_hr_owner)
select schemaname, tablename, tableowner from pg_tables where schemaname = 'task';

-- 6. Grants — must show ONLY phf_hr_app + phf_hr_owner, nothing else, no PUBLIC
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'task'
order by table_name, grantee, privilege_type;

-- 7. phf_hr_app must have ZERO rights outside "task" schema and ZERO rights
--    on database "phfcrm" — run from a connection that can see both:
select table_schema, table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'phf_hr_app' and table_schema <> 'task';
-- expected: 0 rows

select has_database_privilege('phf_hr_app', 'phfcrm', 'CONNECT');
-- expected: false (or query errors because phf_hr_app has no visibility —
-- either outcome is acceptable evidence of isolation)

-- 8. phf_hr_app role attributes — must show nologin, no superuser/createdb/createrole
select rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole
from pg_roles where rolname in ('phf_hr_app', 'phf_hr_owner');
