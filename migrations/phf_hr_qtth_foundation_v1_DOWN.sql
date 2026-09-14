-- =============================================================================
-- PHF HR — QTTH V1 FOUNDATION · DOWN
-- Drops everything phf_hr_qtth_foundation_v1.sql created. Data-destructive.
-- REVIEW ONLY. Never run against Production.
-- =============================================================================
\set ON_ERROR_STOP on

BEGIN;

SET ROLE phf_hr_owner;
DO $$ BEGIN
  IF current_user <> 'phf_hr_owner' THEN
    RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %', current_user;
  END IF;
END $$;

DROP TABLE IF EXISTS qtth.classification_history;
DROP TABLE IF EXISTS qtth.classification;
DROP TABLE IF EXISTS qtth.permission_history;
DROP TABLE IF EXISTS qtth.permission_manager_grant;
DROP TABLE IF EXISTS qtth.module_permission;
DROP TABLE IF EXISTS qtth.dict_group;
DROP TABLE IF EXISTS qtth.dict_unit;

DROP FUNCTION IF EXISTS qtth.block_history_mutation();
DROP FUNCTION IF EXISTS qtth.set_updated_at();

RESET ROLE;

-- Schema left in place (owned by phf_hr_owner, empty). Drop explicitly if needed:
--   DROP SCHEMA IF EXISTS qtth;

COMMIT;
