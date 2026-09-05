-- =============================================================================
-- PHF HR — CHƯƠNG TRÌNH THI ĐUA (Competition) V1.1 · POST-APPLY VALIDATION
--
-- Read-only. Run AFTER phf_hr_competition_v1_1_submission_occurrences.sql.
-- Safe to run repeatedly.
-- =============================================================================
\set ON_ERROR_STOP on

-- 1. table exists, owned by phf_hr_owner
SELECT c.relname AS object, pg_get_userbyid(c.relowner) AS owner
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'competition' AND c.relname = 'submission_occurrences';
-- expected: 1 row, owner = phf_hr_owner

-- 2. grants — ONLY phf_hr_app (+ owner), SELECT+INSERT only (no UPDATE/DELETE)
SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
FROM information_schema.role_table_grants
WHERE table_schema = 'competition' AND table_name = 'submission_occurrences'
GROUP BY grantee ORDER BY grantee;
-- expected: phf_hr_app -> INSERT,SELECT ; phf_hr_owner -> full set

-- 3. FK graph stays inside competition.*
SELECT conrelid::regclass AS child, confrelid::regclass AS parent, conname
FROM pg_constraint
WHERE conrelid = 'competition.submission_occurrences'::regclass AND contype = 'f'
ORDER BY 2;
-- expected: (campaign_id -> competition.campaigns), (source_submission_id -> competition.submissions)

-- 4. one-confirmation-per-person-per-source uniqueness
SELECT indexrelid::regclass AS index_name, indisunique
FROM pg_index
WHERE indrelid = 'competition.submission_occurrences'::regclass AND indisunique;
-- expected: submission_occurrences_uk on (source_submission_id, account_id)

-- 5. structural assertion
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'competition' AND table_name = 'submission_occurrences'
  ) THEN
    RAISE EXCEPTION 'VALIDATION_FAILED: competition.submission_occurrences missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'competition' AND tablename = 'submission_occurrences'
       AND indexname = 'submission_occurrences_uk'
  ) THEN
    RAISE EXCEPTION 'VALIDATION_FAILED: submission_occurrences_uk missing';
  END IF;
  RAISE NOTICE 'VALIDATION_OK: competition.submission_occurrences structurally sound';
END $$;

SELECT 'phf_hr_competition_v1_1_submission_occurrences_VALIDATION applied' AS result;
