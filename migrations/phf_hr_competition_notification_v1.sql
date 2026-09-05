-- =============================================================================
-- PHF HR — CHƯƠNG TRÌNH THI ĐUA (Competition) · NOTIFICATION V1 (2026-09-05)
-- Target : Company PostgreSQL, schema competition. Validated on phf_hr_e2e
--          (dev/test) first; this file is the canonical version applied to
--          phf_hr (Production) after review.
-- Owner  : phf_hr_owner   ·   Runtime role : phf_hr_app (same pattern as
--          phf_hr_competition_v1.sql / phf_hr_task_notification_v1.sql).
--
-- SCOPE: additive, standalone table competition.notifications. NOT a reuse of
-- task.notifications (that table's event_code CHECK is TASK_* only and its
-- task_id FK is cascade-tied to task.tasks — invasive to repurpose on a live
-- table). Same house style: append-friendly, plain NOT NULL non-partial unique
-- dedupe_key from day one (task.notifications had to be hotfixed from a
-- partial unique to a plain one — this table starts correct).
--
-- Fresh full backup + pg_restore --list verification required before applying
-- to Production. Purely additive DDL (CREATE TABLE/INDEX only) — no existing
-- table/column is touched.
-- =============================================================================
\set ON_ERROR_STOP on

BEGIN;

SET ROLE phf_hr_owner;
DO $$ BEGIN
  IF current_user <> 'phf_hr_owner' THEN
    RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %. Abort before DDL.', current_user;
  END IF;
END $$;

SET LOCAL search_path = competition, public;

CREATE TABLE competition.notifications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_account_id  text,
  recipient_employee_code text,
  event_code            text NOT NULL,
  submission_id         uuid REFERENCES competition.submissions(id) ON DELETE CASCADE,
  title                 text NOT NULL,
  message               text NOT NULL,
  target_path           text,
  priority              text NOT NULL DEFAULT 'Trung bình',
  created_at            timestamptz NOT NULL DEFAULT now(),
  read_at               timestamptz,
  dedupe_key            text NOT NULL,
  CONSTRAINT notifications_recipient_ck CHECK (
    nullif(btrim(recipient_account_id), '') IS NOT NULL OR nullif(btrim(recipient_employee_code), '') IS NOT NULL
  ),
  CONSTRAINT notifications_event_code_ck CHECK (event_code IN (
    'COMPETITION_SUBMISSION_APPROVED',
    'COMPETITION_SUBMISSION_UPGRADED',
    'COMPETITION_SUBMISSION_REVISION_REQUESTED',
    'COMPETITION_SUBMISSION_REJECTED',
    'COMPETITION_SUBMISSION_ADJUSTED',
    'COMPETITION_REVIEW_ASSIGNED'
  )),
  CONSTRAINT notifications_title_ck   CHECK (nullif(btrim(title), '') IS NOT NULL),
  CONSTRAINT notifications_message_ck CHECK (nullif(btrim(message), '') IS NOT NULL),
  CONSTRAINT notifications_priority_ck CHECK (priority IN ('Trung bình','Cao','Khẩn'))
);

-- plain NOT NULL, non-partial unique — ON CONFLICT (dedupe_key) works from
-- every call path without the partial-index caveat that hit task.notifications.
CREATE UNIQUE INDEX competition_notifications_dedupe_uq
  ON competition.notifications (dedupe_key);

CREATE INDEX competition_notifications_recipient_emp_idx
  ON competition.notifications (recipient_employee_code, created_at DESC);
CREATE INDEX competition_notifications_recipient_acc_idx
  ON competition.notifications (recipient_account_id, created_at DESC);
CREATE INDEX competition_notifications_submission_idx
  ON competition.notifications (submission_id);

COMMENT ON TABLE competition.notifications IS
  'Competition V1 in-app notifications. Standalone table (NOT task.notifications) '
  '— own event_code whitelist, own FK to competition.submissions. Recipient-scoped '
  'reads only; reviewer-facing content must never carry author identity.';

GRANT SELECT, INSERT, UPDATE ON competition.notifications TO phf_hr_app;

-- validation ------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='competition' AND table_name='notifications') THEN
    RAISE EXCEPTION 'competition.notifications table missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='competition' AND indexname='competition_notifications_dedupe_uq') THEN
    RAISE EXCEPTION 'dedupe_key unique index missing';
  END IF;
  RAISE NOTICE 'phf_hr_competition_notification_v1: OK';
END $$;

COMMIT;
RESET ROLE;

SELECT 'phf_hr_competition_notification_v1 applied' AS result;
