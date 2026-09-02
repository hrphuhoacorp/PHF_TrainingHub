-- =============================================================================
-- PHF HR — TASK ATTACHMENT ACTOR IDENTITY REMEDIATION, v1
--
-- REVIEW ONLY UNTIL EXPLICITLY RUN BY DEPLOYER. Local / throwaway E2E DB
-- only in this GO — NOT applied to Production phf_hr.
--
-- ROOT CAUSE (VERIFIED 2026-09-02, Production Task CV-2609-0001 /
-- 3ecb1a5f-bf8c-41d8-a013-bb266d7ea8b4):
--   task.attachments was designed (migrations/phf_hr_task_foundation_v1.sql,
--   Gate S2) BEFORE the "actor identity: employeeCode OR accountId, exactly
--   one required" pattern (S3B §6.2 — already correct for task.tasks.
--   created_by_employee_code, task.permission_assignments.assigned_by_*, and
--   fixed later for task.permission_grants via
--   phf_hr_task_actor_identity_remediation_v1.sql).
--   uploaded_by_employee_code was left `not null` + a non-blank CHECK, so an
--   Admin-only actor (accountId present, employeeCode = '') cannot upload:
--   lib/attachment-storage.js buildObjectKey() rejects the empty actor with
--   ATTACHMENT_STORAGE_INVALID_ACTOR (HTTP 400) before any FS/DB write, and
--   even past that the DB INSERT would violate the NOT NULL / CHECK.
--
-- SCOPE — task.attachments only, additive + constraint relaxation:
--   1. uploaded_by_employee_code  -> DROP NOT NULL
--   2. ADD COLUMN uploaded_by_account_id text   (nullable)
--   3. ADD COLUMN deleted_by_account_id  text   (nullable — remove-path parity)
--   4. task_attachments_uploaded_by_ck -> NULL-tolerant form
--   5. NEW task_attachments_uploaded_by_present_ck — at least ONE of
--      (uploaded_by_employee_code, uploaded_by_account_id) is non-blank
--   6. NEW task_attachments_deleted_by_acct_ck — deleted_by_account_id, when
--      present, is non-blank (mirrors the existing deleted_by column shape)
--
-- Does NOT touch any other table, column, function, trigger, grant, role, or
-- schema. Does NOT touch task.events (its actor_employee_code already carries
-- an audit token = employeeCode OR accountId, per resolveAuditToken() in
-- services/phf-hr-api/lib/task-write.js — the established repo pattern).
-- Does NOT touch phfcrm.
--
-- Idempotent: DROP NOT NULL on an already-nullable column is a silent no-op;
-- ADD COLUMN IF NOT EXISTS; every constraint swap is DROP CONSTRAINT IF EXISTS
-- then ADD. Re-running converges to the same end state without error.
-- =============================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- BEFORE snapshot (read-only)
-- ---------------------------------------------------------------------------
select 'BEFORE' as phase, column_name, is_nullable, data_type
from information_schema.columns
where table_schema = 'task' and table_name = 'attachments'
  and column_name in ('uploaded_by_employee_code', 'uploaded_by_account_id',
                      'deleted_by_employee_code', 'deleted_by_account_id')
order by column_name;

select 'BEFORE' as phase, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'task.attachments'::regclass
  and conname like 'task_attachments_%_by_%';

-- ---------------------------------------------------------------------------
-- REMEDIATION (atomic — rolls back entirely if any statement fails)
-- ---------------------------------------------------------------------------
begin;

alter table task.attachments
  alter column uploaded_by_employee_code drop not null;

alter table task.attachments
  add column if not exists uploaded_by_account_id text;

alter table task.attachments
  add column if not exists deleted_by_account_id text;

alter table task.attachments
  drop constraint if exists task_attachments_uploaded_by_ck;
alter table task.attachments
  add constraint task_attachments_uploaded_by_ck
  check (uploaded_by_employee_code is null
         or nullif(trim(both from uploaded_by_employee_code), '') is not null);

alter table task.attachments
  drop constraint if exists task_attachments_uploaded_by_present_ck;
alter table task.attachments
  add constraint task_attachments_uploaded_by_present_ck
  check (coalesce(nullif(trim(both from uploaded_by_employee_code), ''),
                  nullif(trim(both from uploaded_by_account_id), '')) is not null);

alter table task.attachments
  drop constraint if exists task_attachments_deleted_by_acct_ck;
alter table task.attachments
  add constraint task_attachments_deleted_by_acct_ck
  check (deleted_by_account_id is null
         or nullif(trim(both from deleted_by_account_id), '') is not null);

commit;

-- ---------------------------------------------------------------------------
-- AFTER / VERIFICATION (read-only)
-- ---------------------------------------------------------------------------
select 'AFTER' as phase, column_name, is_nullable, data_type
from information_schema.columns
where table_schema = 'task' and table_name = 'attachments'
  and column_name in ('uploaded_by_employee_code', 'uploaded_by_account_id',
                      'deleted_by_employee_code', 'deleted_by_account_id')
order by column_name;
-- Expected: uploaded_by_employee_code is_nullable = YES;
--           uploaded_by_account_id / deleted_by_account_id present, nullable.

select 'AFTER' as phase, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'task.attachments'::regclass
  and conname like 'task_attachments_%_by_%'
order by conname;
