-- =============================================================================
-- PHF HR — Competition Notification V1 · DOWN MIGRATION
-- Reverses phf_hr_competition_notification_v1.sql. DEV/TEST ONLY.
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
DROP TABLE IF EXISTS competition.notifications CASCADE;
COMMIT;

RESET ROLE;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='competition' AND table_name='notifications') THEN
    RAISE EXCEPTION 'DOWN_FAILED: competition.notifications still present';
  END IF;
  RAISE NOTICE 'DOWN_OK: competition.notifications dropped';
END $$;

SELECT 'phf_hr_competition_notification_v1_DOWN applied' AS result;
