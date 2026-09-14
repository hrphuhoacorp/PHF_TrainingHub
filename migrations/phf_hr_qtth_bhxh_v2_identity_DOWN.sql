-- PHF HR — QTTH Truth Data · BHXH · IDENTITY RESOLUTION V2 · DOWN. Data-destructive.
-- REVIEW ONLY. Never run against Production.
\set ON_ERROR_STOP on
BEGIN;
SET ROLE phf_hr_owner;
DO $$ BEGIN IF current_user <> 'phf_hr_owner' THEN
  RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %', current_user; END IF; END $$;

ALTER TABLE IF EXISTS bhxh.identity_mapping_history DROP COLUMN IF EXISTS mode;
ALTER TABLE IF EXISTS bhxh.identity_mapping_history DROP COLUMN IF EXISTS to_local_identity_id;
ALTER TABLE IF EXISTS bhxh.normalized DROP COLUMN IF EXISTS identity_kind;
ALTER TABLE IF EXISTS bhxh.normalized DROP COLUMN IF EXISTS local_identity_id;
ALTER TABLE IF EXISTS bhxh.normalized DROP COLUMN IF EXISTS identity_auto_resolved;
DROP TRIGGER IF EXISTS identity_registry_touch ON bhxh.identity_registry;
DROP TABLE IF EXISTS bhxh.identity_registry;
RESET ROLE;
COMMIT;
