-- =============================================================================
-- PHF HR — CHƯƠNG TRÌNH THI ĐUA (Competition) V1 · DOWN MIGRATION
--
-- Reverses phf_hr_competition_v1.sql completely. DEV/TEST ONLY.
-- `DROP SCHEMA competition CASCADE` removes every table, index, trigger,
-- function, constraint and ALL DATA in the schema. Never run against a
-- database that holds real Competition data.
--
-- The grants to phf_hr_app disappear automatically with the objects they were
-- on; phf_hr_app itself and its membership are NOT touched (it is a shared
-- pre-existing role).
-- =============================================================================
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF current_database() IN ('phf_hr','phfcrm') THEN
    RAISE EXCEPTION 'REFUSING: DOWN migration run against production database "%"', current_database();
  END IF;
END $$;

SET ROLE phf_hr_owner;
DO $$ BEGIN
  IF current_user <> 'phf_hr_owner' THEN
    RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %', current_user;
  END IF;
END $$;

BEGIN;
DROP SCHEMA IF EXISTS competition CASCADE;
COMMIT;

RESET ROLE;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'competition') THEN
    RAISE EXCEPTION 'DOWN_FAILED: schema competition still present';
  END IF;
  RAISE NOTICE 'DOWN_OK: schema competition dropped';
END $$;

SELECT 'phf_hr_competition_v1_DOWN applied' AS result;
