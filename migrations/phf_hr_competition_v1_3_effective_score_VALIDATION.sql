-- =============================================================================
-- PHF HR — CHƯƠNG TRÌNH THI ĐUA (Competition) V1.3 · POST-APPLY VALIDATION
-- Read-only. Run AFTER phf_hr_competition_v1_3_effective_score.sql.
-- =============================================================================
\set ON_ERROR_STOP on

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'competition' AND table_name = 'submissions' AND column_name = 'effective_score';
-- expected: 1 row, numeric, nullable = YES

SELECT conname FROM pg_constraint
WHERE conrelid = 'competition.submissions'::regclass AND conname = 'submissions_effective_score_ck';
-- expected: 1 row

SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
FROM information_schema.role_table_grants
WHERE table_schema = 'competition' AND table_name = 'submissions'
GROUP BY grantee ORDER BY grantee;
-- expected: unchanged from V1 (phf_hr_app SELECT,INSERT,UPDATE — new column inherits the existing table grant, no new GRANT needed)

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'competition' AND table_name = 'submissions' AND column_name = 'effective_score'
  ) THEN
    RAISE EXCEPTION 'VALIDATION_FAILED: effective_score column missing';
  END IF;
  RAISE NOTICE 'VALIDATION_OK: competition.submissions.effective_score structurally sound';
END $$;

SELECT 'phf_hr_competition_v1_3_effective_score_VALIDATION applied' AS result;
