-- =============================================================================
-- PHF HR — CHƯƠNG TRÌNH THI ĐUA (Competition) V1.6 · DOWN MIGRATION
--
-- Reverses phf_hr_competition_v1_6_admin_control_tower.sql ONLY — narrows the
-- two CHECK whitelists back to their pre-V1.6 values. Refuses if any row
-- already uses the new values (same discipline as
-- phf_hr_competition_v1_3_effective_score_DOWN.sql).
-- =============================================================================
\set ON_ERROR_STOP on

SET ROLE phf_hr_owner;
DO $$ BEGIN
  IF current_user <> 'phf_hr_owner' THEN
    RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %', current_user;
  END IF;
END $$;

BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM competition.submission_history WHERE action = 'restore') THEN
    RAISE EXCEPTION 'DOWN_REFUSED: submission_history already has restore rows — down-migration would strand them against the narrowed action whitelist.';
  END IF;
  IF EXISTS (SELECT 1 FROM competition.notifications WHERE event_code = 'COMPETITION_SUBMISSION_RESTORED') THEN
    RAISE EXCEPTION 'DOWN_REFUSED: notifications already has COMPETITION_SUBMISSION_RESTORED rows — down-migration would strand them against the narrowed event_code whitelist.';
  END IF;
END $$;

ALTER TABLE competition.submission_history DROP CONSTRAINT submission_history_action_ck;
ALTER TABLE competition.submission_history ADD CONSTRAINT submission_history_action_ck CHECK (action IN
  ('create','edit','submit','revision_requested','revise','approve','upgrade',
   'reject','finalize','approval_withdrawn','admin_override','score_adjust'));

ALTER TABLE competition.notifications DROP CONSTRAINT notifications_event_code_ck;
ALTER TABLE competition.notifications ADD CONSTRAINT notifications_event_code_ck CHECK (event_code IN (
  'COMPETITION_SUBMISSION_APPROVED',
  'COMPETITION_SUBMISSION_UPGRADED',
  'COMPETITION_SUBMISSION_REVISION_REQUESTED',
  'COMPETITION_SUBMISSION_REJECTED',
  'COMPETITION_SUBMISSION_ADJUSTED',
  'COMPETITION_REVIEW_ASSIGNED'
));

COMMIT;
RESET ROLE;

SELECT 'phf_hr_competition_v1_6_admin_control_tower_DOWN applied' AS result;
