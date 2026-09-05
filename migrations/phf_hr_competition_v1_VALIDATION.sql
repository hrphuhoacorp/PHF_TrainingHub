-- =============================================================================
-- PHF HR — CHƯƠNG TRÌNH THI ĐUA (Competition) V1 · POST-APPLY VALIDATION
--
-- Read-only. Run AFTER phf_hr_competition_v1.sql. Safe to run repeatedly.
-- Every query prints an "expected" comment — compare visually. The final
-- assertion block RAISEs if any structural invariant is missing.
-- =============================================================================
\set ON_ERROR_STOP on

-- 1. table inventory (expected: 15 rows)
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'competition' ORDER BY table_name;
-- expected: approval_levels, admin_grants, award_history, awards,
--   campaign_history, campaigns, capability_grants, participant_aliases,
--   permission_history, reactions, review_assignment_history,
--   review_assignments, reviewer_grants, submission_history, submissions

-- 2. schema + table ownership (all phf_hr_owner)
SELECT n.nspname AS schema, c.relname AS object, pg_get_userbyid(c.relowner) AS owner
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'competition' AND c.relkind = 'r'
ORDER BY c.relname;

-- 3. grants — ONLY phf_hr_app (+ owner). No PUBLIC. No other role.
SELECT grantee, table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
FROM information_schema.role_table_grants
WHERE table_schema = 'competition'
GROUP BY grantee, table_name
ORDER BY table_name, grantee;
-- expected grantee set: {phf_hr_owner, phf_hr_app} only
-- expected phf_hr_app: SELECT,INSERT on *_history + participant_aliases;
--   SELECT,INSERT,UPDATE on the 9 mutable tables; +DELETE on approval_levels

-- 4. phf_hr_app must have ZERO rights outside competition.*
SELECT table_schema, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'phf_hr_app' AND table_schema NOT IN ('competition','task')
ORDER BY 1,2,3;
-- expected: 0 rows (task rows, if any, are pre-existing and out of scope here)

-- 5. FK graph — every FK stays inside competition.*
SELECT conrelid::regclass AS child, confrelid::regclass AS parent, conname
FROM pg_constraint
WHERE connamespace = 'competition'::regnamespace AND contype = 'f'
ORDER BY 1,2;
-- expected: every parent is a competition.* table (never public.*, never Supabase)

-- 6. CHECK constraints
SELECT conrelid::regclass AS table_name, conname
FROM pg_constraint
WHERE connamespace = 'competition'::regnamespace AND contype = 'c'
ORDER BY 1,2;

-- 7. unique constraints + unique indexes (partials included)
SELECT indexrelid::regclass AS index_name, indrelid::regclass AS table_name, indisunique, indpred IS NOT NULL AS partial
FROM pg_index
WHERE indrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'competition'::regnamespace)
  AND indisunique
ORDER BY 2,1;
-- expected partial-unique: admin_grants_active_account_uk, capability_grants_active_uk,
--   review_assignments_active_uk, reactions_active_uk,
--   awards_confirmed_type_uk, awards_confirmed_recipient_uk

-- 8. triggers
SELECT event_object_table AS table_name, trigger_name, action_timing,
       string_agg(event_manipulation, ',' ORDER BY event_manipulation) AS events
FROM information_schema.triggers
WHERE trigger_schema = 'competition'
GROUP BY 1,2,3 ORDER BY 1,2;
-- expected: 5 *_append_only (UPDATE,DELETE), set_updated_at touches,
--   campaigns_publish_guard, approval_levels_change_guard,
--   submissions_immutability_guard, review_assignments_self_review_guard

-- 9. functions
SELECT proname FROM pg_proc WHERE pronamespace = 'competition'::regnamespace ORDER BY 1;
-- expected: block_history_mutation, guard_approval_level_change,
--   guard_campaign_publish, guard_no_self_review,
--   guard_submission_immutability, set_updated_at

-- =============================================================================
-- STRUCTURAL ASSERTIONS
-- =============================================================================
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.tables WHERE table_schema='competition';
  IF n <> 15 THEN RAISE EXCEPTION 'VALIDATION_FAILED: expected 15 tables, found %', n; END IF;

  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace nsp ON nsp.oid=c.relnamespace
   WHERE nsp.nspname='competition' AND c.relkind='r' AND pg_get_userbyid(c.relowner)<>'phf_hr_owner';
  IF n <> 0 THEN RAISE EXCEPTION 'VALIDATION_FAILED: % competition tables not owned by phf_hr_owner', n; END IF;

  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE table_schema='competition' AND grantee NOT IN ('phf_hr_owner','phf_hr_app');
  IF n <> 0 THEN RAISE EXCEPTION 'VALIDATION_FAILED: % unexpected grantees in competition', n; END IF;

  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE grantee='phf_hr_app' AND table_schema NOT IN ('competition','task');
  IF n <> 0 THEN RAISE EXCEPTION 'VALIDATION_FAILED: phf_hr_app has % grants outside competition', n; END IF;

  SELECT count(*) INTO n FROM pg_constraint
   WHERE connamespace='competition'::regnamespace AND contype='f'
     AND confrelid::regclass::text NOT LIKE 'competition.%';
  IF n <> 0 THEN RAISE EXCEPTION 'VALIDATION_FAILED: % FK(s) point outside competition schema', n; END IF;

  SELECT count(*) INTO n FROM pg_proc WHERE pronamespace='competition'::regnamespace;
  IF n <> 6 THEN RAISE EXCEPTION 'VALIDATION_FAILED: expected 6 functions, found %', n; END IF;

  SELECT count(*) INTO n FROM information_schema.triggers WHERE trigger_schema='competition';
  IF n < 14 THEN RAISE EXCEPTION 'VALIDATION_FAILED: expected >=14 trigger rows, found %', n; END IF;

  RAISE NOTICE 'VALIDATION_PASS — 15 tables, 6 functions, ownership + grants + FK isolation OK';
END $$;

SELECT 'phf_hr_competition_v1_VALIDATION complete' AS result;
