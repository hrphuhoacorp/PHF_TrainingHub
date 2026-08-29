-- =============================================================================
-- PHF HR — ACTOR IDENTITY NULLABILITY REMEDIATION (permission_grants /
-- permission_grant_history), v1
--
-- REVIEW ONLY UNTIL EXPLICITLY RUN BY DEPLOYER. Not applied to any database
-- yet — closes a structural drift discovered between phf_hr (Production)
-- and a fresh phf_hr_verify build (2026-08-27, after the grant-parity
-- remediation was already applied and re-verified 127/127).
--
-- DRIFT (confirmed by reading raw information_schema.columns +
-- pg_get_constraintdef() output from BOTH databases, not inferred):
--   task.permission_grants.created_by_employee_code          Production = NULLABLE, foundation = NOT NULL
--   task.permission_grant_history.changed_by_employee_code   Production = NULLABLE, foundation = NOT NULL
--
-- ROOT CAUSE: migrations/phf_hr_task_foundation_v1.sql (and its source,
-- scripts/PHF_TASK_PERMISSIONS_1.66.1.sql) declared both columns NOT NULL
-- with a CHECK that only accepts a non-blank value — written before the
-- "actor identity: employeeCode OR accountId, exactly one required"
-- pattern (S3B §6.2, already correctly nullable elsewhere in this same
-- foundation file for task.tasks.created_by_employee_code and
-- task.permission_assignments.assigned_by_employee_code) was extended to
-- these two columns. Production was corrected by hand at some later point
-- — no migration file in this repo captures that ALTER — to support
-- Admin-only actors (accountId present, employeeCode null) calling
-- createTaskPermissionGrant()/revokeTaskPermissionGrant()
-- (services/phf-hr-api/lib/task-write.js), which insert
-- normActorEmployeeCode as-is and throw only if BOTH actor identifiers are
-- missing (never if just one is). Production already has 7 real
-- permission_grants rows written by Admin-only actors with
-- created_by_employee_code NULL (Gate12 test fixtures, 2026-08-26) —
-- direct evidence the nullable form is the one the running code actually
-- needs, not the NOT NULL form still in the foundation file.
--
-- This migration is deliberately forward-only: it does NOT edit
-- phf_hr_task_foundation_v1.sql or scripts/PHF_TASK_PERMISSIONS_1.66.1.sql
-- (no rewriting applied history), and does NOT touch Production phf_hr in
-- this GO — it exists on disk only until a deployer runs it against a
-- specific target database (intended target right now: phf_hr_verify
-- only, to bring it to Production's actual, already-correct state).
--
-- SCOPE — exactly 2 columns, 2 constraints, nothing else:
--   ALTER TABLE task.permission_grants ALTER COLUMN created_by_employee_code DROP NOT NULL;
--   ALTER TABLE task.permission_grant_history ALTER COLUMN changed_by_employee_code DROP NOT NULL;
--   task_permission_created_by_ck        -> replaced with the NULL-tolerant form
--   task_permission_history_changed_by_ck -> replaced with the NULL-tolerant form
--
-- New constraint definitions copied verbatim (semantics) from Production's
-- own pg_get_constraintdef() output — NOT independently designed:
--   task_permission_created_by_ck:
--     ((created_by_employee_code IS NULL) OR (NULLIF(TRIM(BOTH FROM created_by_employee_code), ''::text) IS NOT NULL))
--   task_permission_history_changed_by_ck:
--     ((changed_by_employee_code IS NULL) OR (NULLIF(TRIM(BOTH FROM changed_by_employee_code), ''::text) IS NOT NULL))
--
-- Does NOT touch any other column, table, function, trigger, grant, or
-- role attribute. Does NOT touch phfcrm.
--
-- Idempotent: `ALTER COLUMN ... DROP NOT NULL` on an already-nullable
-- column is a silent no-op in PostgreSQL (no error). The constraint swap
-- uses DROP CONSTRAINT IF EXISTS before ADD CONSTRAINT each time, so
-- re-running this file any number of times converges to the same end
-- state without error.
-- =============================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- BEFORE snapshot (read-only)
-- ---------------------------------------------------------------------------
select 'BEFORE' as phase, table_name, column_name, is_nullable
from information_schema.columns
where (table_schema, table_name, column_name) in (
  ('task', 'permission_grants', 'created_by_employee_code'),
  ('task', 'permission_grant_history', 'changed_by_employee_code')
);

select 'BEFORE' as phase, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conname in ('task_permission_created_by_ck', 'task_permission_history_changed_by_ck');

-- ---------------------------------------------------------------------------
-- REMEDIATION (atomic — rolls back entirely if any statement fails)
-- ---------------------------------------------------------------------------
begin;

alter table task.permission_grants
  alter column created_by_employee_code drop not null;

alter table task.permission_grant_history
  alter column changed_by_employee_code drop not null;

alter table task.permission_grants
  drop constraint if exists task_permission_created_by_ck;
alter table task.permission_grants
  add constraint task_permission_created_by_ck
  check (created_by_employee_code is null or nullif(trim(both from created_by_employee_code), '') is not null);

alter table task.permission_grant_history
  drop constraint if exists task_permission_history_changed_by_ck;
alter table task.permission_grant_history
  add constraint task_permission_history_changed_by_ck
  check (changed_by_employee_code is null or nullif(trim(both from changed_by_employee_code), '') is not null);

commit;

-- ---------------------------------------------------------------------------
-- AFTER / VERIFICATION (read-only) — MUST match Production exactly
-- ---------------------------------------------------------------------------
select 'AFTER' as phase, table_name, column_name, is_nullable
from information_schema.columns
where (table_schema, table_name, column_name) in (
  ('task', 'permission_grants', 'created_by_employee_code'),
  ('task', 'permission_grant_history', 'changed_by_employee_code')
);
-- Expected: is_nullable = YES for both rows.

select 'AFTER' as phase, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conname in ('task_permission_created_by_ck', 'task_permission_history_changed_by_ck');
-- Expected, character-for-character match with Production:
--   task_permission_created_by_ck:
--     CHECK (((created_by_employee_code IS NULL) OR (NULLIF(TRIM(BOTH FROM created_by_employee_code), ''::text) IS NOT NULL)))
--   task_permission_history_changed_by_ck:
--     CHECK (((changed_by_employee_code IS NULL) OR (NULLIF(TRIM(BOTH FROM changed_by_employee_code), ''::text) IS NOT NULL)))
-- If either AFTER row does not match — STOP, do not proceed to B3, investigate before re-running.
