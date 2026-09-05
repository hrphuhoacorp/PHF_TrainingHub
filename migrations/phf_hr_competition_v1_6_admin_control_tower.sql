-- =============================================================================
-- PHF HR — CHƯƠNG TRÌNH THI ĐUA (Competition) V1.6 · Admin Control Tower
-- Target : Company PostgreSQL, schema competition. Validated on phf_hr_e2e
--          (dev/test) first; this file is the canonical version applied to
--          phf_hr (Production) after review.
-- Owner  : phf_hr_owner   ·   Runtime role : phf_hr_app — additive only: widens
--          two existing CHECK whitelists (drop + re-add, same values plus one
--          each — no data rewrite, no existing row is touched, no new table,
--          no new column).
--
-- WHAT: Admin-only "Phục hồi trạng thái bài" (lifecycle restore) needs a new
-- submission_history action value ('restore') and a new in-app-notification
-- event code (COMPETITION_SUBMISSION_RESTORED). Both whitelists were already
-- widened once before this exact same way — see
-- phf_hr_competition_v1_3_effective_score.sql (added 'score_adjust') for the
-- submission_history_action_ck precedent this migration mirrors verbatim.
--
-- Run AFTER phf_hr_competition_v1.sql + v1_3_effective_score.sql +
-- notification_v1.sql. DOWN = same filename + _DOWN.sql.
-- REVIEW ONLY until a human/deployer applies it to the verified dev DB.
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

-- 1) widen submission_history_action_ck — same 12 values as V1.3, plus 'restore'.
ALTER TABLE competition.submission_history DROP CONSTRAINT submission_history_action_ck;
ALTER TABLE competition.submission_history ADD CONSTRAINT submission_history_action_ck CHECK (action IN
  ('create','edit','submit','revision_requested','revise','approve','upgrade',
   'reject','finalize','approval_withdrawn','admin_override','score_adjust','restore'));

COMMENT ON CONSTRAINT submission_history_action_ck ON competition.submission_history IS
  'V1.6 adds ''restore'' — adminRestoreSubmission() lifecycle-correction audit row. '
  'Deliberately NOT one of the 4 genuine-review actions (approve/upgrade/'
  'revision_requested/reject) myReviewedHistory() filters on, so a restore event '
  'can never surface as a reviewer''s own "Bài tôi đã duyệt" note.';

-- 2) widen notifications_event_code_ck — same 6 values as notification V1,
--    plus 'COMPETITION_SUBMISSION_RESTORED'.
ALTER TABLE competition.notifications DROP CONSTRAINT notifications_event_code_ck;
ALTER TABLE competition.notifications ADD CONSTRAINT notifications_event_code_ck CHECK (event_code IN (
  'COMPETITION_SUBMISSION_APPROVED',
  'COMPETITION_SUBMISSION_UPGRADED',
  'COMPETITION_SUBMISSION_REVISION_REQUESTED',
  'COMPETITION_SUBMISSION_REJECTED',
  'COMPETITION_SUBMISSION_ADJUSTED',
  'COMPETITION_REVIEW_ASSIGNED',
  'COMPETITION_SUBMISSION_RESTORED'
));

-- validation ------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'competition.submission_history'::regclass
       AND conname = 'submission_history_action_ck'
       AND pg_get_constraintdef(oid) LIKE '%restore%'
  ) THEN
    RAISE EXCEPTION 'submission_history_action_ck was not widened with ''restore''';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'competition.notifications'::regclass
       AND conname = 'notifications_event_code_ck'
       AND pg_get_constraintdef(oid) LIKE '%COMPETITION_SUBMISSION_RESTORED%'
  ) THEN
    RAISE EXCEPTION 'notifications_event_code_ck was not widened with COMPETITION_SUBMISSION_RESTORED';
  END IF;
  RAISE NOTICE 'phf_hr_competition_v1_6_admin_control_tower: OK';
END $$;

COMMIT;
RESET ROLE;

SELECT 'phf_hr_competition_v1_6_admin_control_tower applied' AS result;
