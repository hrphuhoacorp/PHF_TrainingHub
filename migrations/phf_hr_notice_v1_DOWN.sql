-- =============================================================================
-- PHF HR — THÔNG BÁO QUẢN TRỊ V1 · FOUNDATION MIGRATION · DOWN
-- Reverses phf_hr_notice_v1.sql. Drops the whole `notice` schema (all V1 data).
-- REVIEW ONLY. Never run against Production.
-- =============================================================================
\set ON_ERROR_STOP on

BEGIN;

SET ROLE phf_hr_owner;
DO $$ BEGIN
  IF current_user <> 'phf_hr_owner' THEN
    RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %. Abort before DDL.', current_user;
  END IF;
END $$;

-- History/immutability guards fire on DROP TABLE via TRUNCATE? No — DROP TABLE is
-- not blocked by the BEFORE UPDATE/DELETE/TRUNCATE guards. Drop cascades cleanly.
DROP SCHEMA IF EXISTS notice CASCADE;

RESET ROLE;

COMMIT;
