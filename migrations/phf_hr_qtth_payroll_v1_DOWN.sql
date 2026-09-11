-- PHF HR — QTTH Truth Data · PAYROLL FOUNDATION V1 · DOWN. Data-destructive.
-- REVIEW ONLY. Never run against Production.
\set ON_ERROR_STOP on
BEGIN;
SET ROLE phf_hr_owner;
DO $$ BEGIN IF current_user <> 'phf_hr_owner' THEN
  RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %', current_user; END IF; END $$;

ALTER TABLE IF EXISTS payroll.import DROP CONSTRAINT IF EXISTS import_current_file_fk;
DROP TABLE IF EXISTS payroll.delta;
DROP TABLE IF EXISTS payroll.normalized;
DROP TABLE IF EXISTS payroll.raw_row;
DROP TABLE IF EXISTS payroll.template;
DROP TABLE IF EXISTS payroll.import_file;
DROP TABLE IF EXISTS payroll.import;
DROP FUNCTION IF EXISTS payroll.block_mutation();
DROP FUNCTION IF EXISTS payroll.set_updated_at();
RESET ROLE;
-- DROP SCHEMA IF EXISTS payroll;   -- uncomment to remove the (now empty) schema
COMMIT;
