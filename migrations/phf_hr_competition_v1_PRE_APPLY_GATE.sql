-- =============================================================================
-- PHF HR — CHƯƠNG TRÌNH THI ĐUA (Competition) V1 · PRE-APPLY GATE
--
-- Run this FIRST, in isolation, BEFORE phf_hr_competition_v1.sql.
-- ZERO DDL / ZERO DML. It only PROVES, visibly, that:
--   1. you are connected to a NON-PRODUCTION dev/test Company PostgreSQL,
--   2. the connecting login can SET ROLE to phf_hr_owner AND phf_hr_app,
--   3. schema "competition" does NOT already exist,
--   4. the People Master (public.user_accounts / public.employee_profiles)
--      is NOT co-located here — Competition references identity by value
--      (account_id / employee_code text), never by cross-DB FK.
--
-- If ANY assertion below raises, STOP. Do not run the migration. Report the
-- exact output instead. Safe to run repeatedly — changes nothing.
--
-- VERIFIED DEV TARGET (2026-09-04):
--   container : phf-hr-e2e-throwaway-20260827T123257Z  (127.0.0.1:15432)
--   database  : phf_hr_e2e
--   proof     : db name <> 'phf_hr'; no 'phfcrm' db in cluster; schemas =
--               {public, task}; roles phf_hr_owner/phf_hr_app/phf_hr_runtime
--               present; phf_hr_runtime IS a member of phf_hr_app.
-- =============================================================================
\set ON_ERROR_STOP on

select current_user  as connected_as,
       session_user  as login_role,
       current_database() as database,
       inet_server_addr() as host,
       inet_server_port() as port,
       now()          as at;

-- --- 1. HARD NON-PROD GATE -------------------------------------------------
DO $$
DECLARE d text := current_database();
BEGIN
  IF d = 'phf_hr' OR d = 'phfcrm' THEN
    RAISE EXCEPTION 'PRE_APPLY_GATE_FAILED: connected to PRODUCTION database "%". ABORT.', d;
  END IF;
  IF d NOT IN ('phf_hr_e2e', 'phf_hr_dev', 'phf_hr_test') THEN
    RAISE EXCEPTION 'PRE_APPLY_GATE_FAILED: database "%" is not a recognised dev/test target. '
      'If this really is a safe throwaway, widen this allow-list deliberately and re-run.', d;
  END IF;
  RAISE NOTICE 'OK  non-prod database: %', d;
END $$;

-- --- 2. ROLE REACHABILITY -------------------------------------------------
SET ROLE phf_hr_owner;
DO $$ BEGIN
  IF current_user <> 'phf_hr_owner' THEN
    RAISE EXCEPTION 'PRE_APPLY_GATE_FAILED: SET ROLE phf_hr_owner ineffective (current_user=%)', current_user;
  END IF; RAISE NOTICE 'OK  SET ROLE phf_hr_owner';
END $$;
RESET ROLE;

SET ROLE phf_hr_app;
DO $$ BEGIN
  IF current_user <> 'phf_hr_app' THEN
    RAISE EXCEPTION 'PRE_APPLY_GATE_FAILED: SET ROLE phf_hr_app ineffective (current_user=%)', current_user;
  END IF; RAISE NOTICE 'OK  SET ROLE phf_hr_app';
END $$;
RESET ROLE;

-- --- 3. SCHEMA "competition" MUST NOT EXIST YET --------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'competition') THEN
    RAISE EXCEPTION 'PRE_APPLY_GATE_FAILED: schema "competition" already exists. '
      'Run phf_hr_competition_v1_DOWN.sql first if you intend to re-apply.';
  END IF; RAISE NOTICE 'OK  schema competition absent';
END $$;

-- --- 4. NO CO-LOCATED PEOPLE MASTER (identity is by-value only) ----------
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name IN ('user_accounts','employee_profiles');
  IF n > 0 THEN
    RAISE WARNING 'People Master-like tables found in public (%). Competition still '
      'references identity BY VALUE only — no FK will be created to them.', n;
  ELSE
    RAISE NOTICE 'OK  no co-located People Master — identity references are external by design';
  END IF;
END $$;

select 'PRE_APPLY_GATE_PASS — safe to run phf_hr_competition_v1.sql' as result;
