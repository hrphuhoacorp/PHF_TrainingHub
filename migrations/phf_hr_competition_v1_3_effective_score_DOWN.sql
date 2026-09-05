-- =============================================================================
-- PHF HR — CHƯƠNG TRÌNH THI ĐUA (Competition) V1.3 · DOWN MIGRATION
--
-- Reverses phf_hr_competition_v1_3_effective_score.sql ONLY — drops
-- competition.submissions.effective_score and nothing else. Safe against a
-- database holding real V1/V1.1/V1.2 Competition data; loses only the
-- post-approval adjustment values (current_score/current_level_order and
-- every other column are untouched).
-- =============================================================================
\set ON_ERROR_STOP on

SET ROLE phf_hr_owner;
DO $$ BEGIN
  IF current_user <> 'phf_hr_owner' THEN
    RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %', current_user;
  END IF;
END $$;

BEGIN;
-- refuse if any row already recorded a score_adjust event — dropping the
-- column loses the adjustment value while the history row (still valid,
-- append-only) would then reference an action the narrowed CHECK forbids
-- reinserting; safe to down-migrate only on a DB with no adjustments yet.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM competition.submission_history WHERE action = 'score_adjust') THEN
    RAISE EXCEPTION 'DOWN_REFUSED: submission_history already has score_adjust rows — down-migration would strand them against the narrowed action whitelist. Do not run on a DB with real V1.3 adjustments.';
  END IF;
END $$;
ALTER TABLE competition.submission_history DROP CONSTRAINT submission_history_action_ck;
ALTER TABLE competition.submission_history ADD CONSTRAINT submission_history_action_ck CHECK (action IN
  ('create','edit','submit','revision_requested','revise','approve','upgrade',
   'reject','finalize','approval_withdrawn','admin_override'));
ALTER TABLE competition.submissions DROP CONSTRAINT IF EXISTS submissions_effective_score_ck;
ALTER TABLE competition.submissions DROP COLUMN IF EXISTS effective_score;
COMMIT;

RESET ROLE;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'competition' AND table_name = 'submissions' AND column_name = 'effective_score'
  ) THEN
    RAISE EXCEPTION 'DOWN_FAILED: competition.submissions.effective_score still present';
  END IF;
  RAISE NOTICE 'DOWN_OK: competition.submissions.effective_score dropped';
END $$;

SELECT 'phf_hr_competition_v1_3_effective_score_DOWN applied' AS result;
