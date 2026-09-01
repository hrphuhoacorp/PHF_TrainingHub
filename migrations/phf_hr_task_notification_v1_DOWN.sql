-- =============================================================================
-- PHF TASK — IN-APP NOTIFICATION V1  — DOWN (throwaway rollback only)
-- Reverts migrations/phf_hr_task_notification_v1.sql.
-- Rows with a V1 event_code are deleted first so the narrowed CHECK can apply.
-- THROWAWAY ONLY. Never on PROD.
-- =============================================================================

BEGIN;
SET LOCAL statement_timeout = '30s';

DELETE FROM task.notifications
 WHERE event_code IN (
   'TASK_PUBLISHED','TASK_ASSIGNED','TASK_TRANSFERRED','TASK_COMMENTED',
   'TASK_DEADLINE_CHANGED','TASK_COMPLETED','TASK_REOPENED','TASK_CANCELLED',
   'TASK_CANCEL_REQUESTED','TASK_CANCEL_REQUEST_DECIDED','TASK_RECURRING_GENERATED'
 );

DROP INDEX IF EXISTS task.task_notifications_event_recipient_emp_uq;
DROP INDEX IF EXISTS task.task_notifications_event_idx;

ALTER TABLE task.notifications DROP CONSTRAINT IF EXISTS notifications_event_id_fkey;
ALTER TABLE task.notifications DROP COLUMN IF EXISTS event_id;

ALTER TABLE task.notifications DROP CONSTRAINT notifications_event_code_check;
ALTER TABLE task.notifications ADD CONSTRAINT notifications_event_code_check
  CHECK (event_code = 'TASK_CROSS_DEPARTMENT_ASSIGNED');

COMMIT;
