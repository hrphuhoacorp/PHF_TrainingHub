-- PHF HR — QTTH Truth Data · "Chi phí xử lý" FOUNDATION V1 · DOWN. Data-destructive.
-- REVIEW ONLY. Never run against Production.
\set ON_ERROR_STOP on
BEGIN;
SET ROLE phf_hr_owner;
DO $$ BEGIN IF current_user <> 'phf_hr_owner' THEN
  RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %', current_user; END IF; END $$;

ALTER TABLE IF EXISTS processing_cost.import DROP CONSTRAINT IF EXISTS pc_import_current_file_fk;
DROP TABLE IF EXISTS processing_cost.normalized;
DROP TABLE IF EXISTS processing_cost.import_file;
DROP TABLE IF EXISTS processing_cost.import;
DROP FUNCTION IF EXISTS processing_cost.set_updated_at();
RESET ROLE;
-- DROP SCHEMA IF EXISTS processing_cost;   -- uncomment to remove the (now empty) schema
COMMIT;
