-- =============================================================================
-- DOWN for phf_hr_audit_v1.sql — throwaway phf_hr_e2e ONLY. NEVER on Production.
-- Drops the whole `audit` schema (one table, its trigger fn, grants).
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
SET ROLE phf_hr_owner;
DO $$ BEGIN
  IF current_user <> 'phf_hr_owner' THEN
    RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %.', current_user;
  END IF;
END $$;

DROP SCHEMA IF EXISTS audit CASCADE;

RESET ROLE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'audit') THEN
    RAISE EXCEPTION 'DOWN_FAILED: schema audit still present';
  END IF;
  RAISE NOTICE 'DOWN_OK: schema audit dropped';
END $$;
COMMIT;
