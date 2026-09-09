-- PHF HR — QTTH Truth Data · ACCOUNTING (CHI PHÍ QUẢN TRỊ) FOUNDATION V1 · DOWN.
-- Data-destructive. REVIEW ONLY. Never run against Production.
\set ON_ERROR_STOP on
BEGIN;
SET ROLE phf_hr_owner;
DO $$ BEGIN IF current_user <> 'phf_hr_owner' THEN
  RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %', current_user; END IF; END $$;

ALTER TABLE IF EXISTS accounting.import DROP CONSTRAINT IF EXISTS import_current_file_fk;
DROP TABLE IF EXISTS accounting.delta;
DROP TABLE IF EXISTS accounting.normalized;
DROP TABLE IF EXISTS accounting.classification_rule;
DROP TABLE IF EXISTS accounting.cost_dictionary_entry;
DROP TABLE IF EXISTS accounting.cost_dictionary;
DROP TABLE IF EXISTS accounting.import_file;
DROP TABLE IF EXISTS accounting.import;
DROP FUNCTION IF EXISTS accounting.block_mutation();
DROP FUNCTION IF EXISTS accounting.set_updated_at();
RESET ROLE;
-- DROP SCHEMA IF EXISTS accounting;   -- uncomment to remove the (now empty) schema
COMMIT;
