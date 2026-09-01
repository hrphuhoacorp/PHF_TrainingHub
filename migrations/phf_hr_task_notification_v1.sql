-- =============================================================================
-- PHF TASK — IN-APP NOTIFICATION V1 (2026-08-31)
-- Additive migration for Company PostgreSQL `phf_hr`, schema `task`.
--
-- LOCAL / THROWAWAY ONLY until deployer applies it under the throwaway gate.
-- NOT for PROD in this phase.
--
-- What it does (all additive, no data loss, no second table):
--   1. Widen task.notifications.event_code CHECK to the V1 event set
--      (keeps the existing TASK_CROSS_DEPARTMENT_ASSIGNED).
--   2. Add task.notifications.event_id  uuid NULL  FK -> task.events(id)
--      ON DELETE SET NULL  (events are append-only; SET NULL avoids any
--      interaction with the append-only guard and keeps event_id purely a
--      linkage/idempotency helper).
--   3. Event <-> recipient idempotency: a PARTIAL unique index on
--      (event_id, recipient_employee_code) that only applies when BOTH are
--      NOT NULL — so one task.events row can never fan out a duplicate
--      notification to the same employee, and the constraint never fires on
--      the NULL side of the account/employee identity model.
--   4. Keeps the existing partial-unique task_notifications_dedupe_uq
--      (dedupe_key) untouched — that stays the primary idempotency key,
--      composed by the emitter as  evt:<event_id>|<identity>  for V1 events
--      and  <event_code>|<task_id>|<identity>  for the legacy cross-dept one.
--
-- V1 identity model: every V1 recipient is an ACTIVE assignee or the task
-- creator, all identified by employee_code (task.assignees has no account_id
-- column). recipient_account_id stays available for the legacy cross-dept
-- path and any future account-keyed event.
-- =============================================================================

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';

-- 1) widen the event_code whitelist ------------------------------------------
ALTER TABLE task.notifications DROP CONSTRAINT notifications_event_code_check;
ALTER TABLE task.notifications ADD CONSTRAINT notifications_event_code_check
  CHECK (event_code IN (
    'TASK_CROSS_DEPARTMENT_ASSIGNED',   -- legacy, unchanged
    'TASK_PUBLISHED',
    'TASK_ASSIGNED',
    'TASK_TRANSFERRED',
    'TASK_COMMENTED',
    'TASK_DEADLINE_CHANGED',
    'TASK_COMPLETED',
    'TASK_REOPENED',
    'TASK_CANCELLED',
    'TASK_CANCEL_REQUESTED',
    'TASK_CANCEL_REQUEST_DECIDED',
    'TASK_RECURRING_GENERATED'
  ));

-- 2) event linkage -----------------------------------------------------------
ALTER TABLE task.notifications ADD COLUMN event_id uuid;
ALTER TABLE task.notifications ADD CONSTRAINT notifications_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES task.events(id) ON DELETE SET NULL;

-- 3) event <-> recipient idempotency (NULL-safe: partial on both-not-null) ---
CREATE UNIQUE INDEX task_notifications_event_recipient_emp_uq
  ON task.notifications (event_id, recipient_employee_code)
  WHERE event_id IS NOT NULL AND recipient_employee_code IS NOT NULL;

CREATE INDEX task_notifications_event_idx
  ON task.notifications (event_id)
  WHERE event_id IS NOT NULL;

-- grants: phf_hr_app already has SELECT, INSERT, UPDATE on task.notifications
-- (read_at needs UPDATE). A new nullable column needs no new grant.

-- validation ----------------------------------------------------------------
DO $$
DECLARE ck text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO ck FROM pg_constraint
   WHERE conrelid = 'task.notifications'::regclass AND conname = 'notifications_event_code_check';
  IF position('TASK_RECURRING_GENERATED' in ck) = 0 THEN
    RAISE EXCEPTION 'event_code CHECK not widened: %', ck;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='task' AND table_name='notifications' AND column_name='event_id') THEN
    RAISE EXCEPTION 'event_id column missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='task' AND indexname='task_notifications_event_recipient_emp_uq') THEN
    RAISE EXCEPTION 'event-recipient unique index missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='task' AND indexname='task_notifications_dedupe_uq') THEN
    RAISE EXCEPTION 'existing dedupe_key unique index unexpectedly gone';
  END IF;
  RAISE NOTICE 'phf_hr_task_notification_v1: OK';
END $$;

COMMIT;
