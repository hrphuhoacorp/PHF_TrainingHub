-- PHF HR — QTTH Truth Data · BHXH FOUNDATION V1 · DOWN. Data-destructive.
-- REVIEW ONLY. Never run against Production.
\set ON_ERROR_STOP on
BEGIN;
SET ROLE phf_hr_owner;
DO $$ BEGIN IF current_user <> 'phf_hr_owner' THEN
  RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %', current_user; END IF; END $$;

ALTER TABLE IF EXISTS bhxh.import DROP CONSTRAINT IF EXISTS import_current_file_fk;
DROP TABLE IF EXISTS bhxh.delta;
DROP TABLE IF EXISTS bhxh.identity_mapping_history;
DROP TABLE IF EXISTS bhxh.normalized;
DROP TABLE IF EXISTS bhxh.raw_row;
DROP TABLE IF EXISTS bhxh.template;
DROP TABLE IF EXISTS bhxh.import_file;
DROP TABLE IF EXISTS bhxh.import;
DROP FUNCTION IF EXISTS bhxh.block_mutation();
DROP FUNCTION IF EXISTS bhxh.set_updated_at();
RESET ROLE;
-- DROP SCHEMA IF EXISTS bhxh;   -- uncomment to remove the (now empty) schema
COMMIT;
