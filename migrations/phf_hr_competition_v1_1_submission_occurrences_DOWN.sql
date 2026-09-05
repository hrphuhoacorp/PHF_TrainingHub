-- =============================================================================
-- PHF HR — CHƯƠNG TRÌNH THI ĐUA (Competition) V1.1 · DOWN MIGRATION
--
-- Reverses phf_hr_competition_v1_1_submission_occurrences.sql ONLY — drops
-- competition.submission_occurrences and nothing else (the rest of the
-- competition schema is untouched). Safe to run against a database that
-- already holds real V1 Competition data; it only removes the "Tôi cũng gặp"
-- evidence table introduced in V1.1 (loses the frequency counts, does NOT
-- affect any submission/score/leaderboard/award row).
-- =============================================================================
\set ON_ERROR_STOP on

SET ROLE phf_hr_owner;
DO $$ BEGIN
  IF current_user <> 'phf_hr_owner' THEN
    RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %', current_user;
  END IF;
END $$;

BEGIN;
DROP TABLE IF EXISTS competition.submission_occurrences;
COMMIT;

RESET ROLE;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'competition' AND table_name = 'submission_occurrences'
  ) THEN
    RAISE EXCEPTION 'DOWN_FAILED: competition.submission_occurrences still present';
  END IF;
  RAISE NOTICE 'DOWN_OK: competition.submission_occurrences dropped';
END $$;

SELECT 'phf_hr_competition_v1_1_submission_occurrences_DOWN applied' AS result;
