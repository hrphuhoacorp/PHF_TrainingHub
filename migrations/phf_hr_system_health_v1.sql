-- =============================================================================
-- PHF HR — SYSTEM V1 · TÌNH TRẠNG HỆ THỐNG (System Health) — V1
-- Target : Company PostgreSQL, database phf_hr (dev/throwaway: phf_hr_e2e), schema system
-- Scope  : ONE tiny heartbeat table. Records the last execution + result of the
--          EXISTING background jobs (task recurrence / task mail drainer /
--          task weekly report). NO new scheduler. NO business-object FK.
--
-- The Admin "Tình trạng hệ thống" screen READS this table (through the
-- phf-hr-api /v1/system:health bridge) so a */5 or weekly job that ran quietly
-- still leaves a trustworthy "last ran ok at <ts>" signal — the cron log lives
-- on the VPS and is not reachable from the app.
--
-- This is NOT append-only: a heartbeat is UPSERTed in place (one row per job).
--
-- DOWN = phf_hr_system_health_v1_DOWN.sql.
-- REVIEW ONLY until the deployer applies it to the verified throwaway DB.
-- NEVER run against Production in this batch.
-- =============================================================================
\set ON_ERROR_STOP on

BEGIN;

CREATE SCHEMA IF NOT EXISTS system;
ALTER SCHEMA system OWNER TO phf_hr_owner;
COMMENT ON SCHEMA system IS
  'PHF HR System V1 operational-health support. Small, non-business. Currently '
  'one table (system.cron_heartbeat) — the last-run ledger for the EXISTING '
  'background jobs. No scheduler, no metrics history, no PII.';

SET ROLE phf_hr_owner;
DO $$ BEGIN
  IF current_user <> 'phf_hr_owner' THEN
    RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %. Abort before DDL.', current_user;
  END IF;
END $$;

SET LOCAL search_path = system, public;

-- =============================================================================
-- system.cron_heartbeat — one row per background job.
--   job          : stable job key (closed set)
--   last_run_at  : when the job handler last finished (ok OR not)
--   last_ok      : did the last run succeed
--   last_summary : BOUNDED, non-sensitive counters only (claimed/sent/failed/
--                  generated/skipped/rulesScanned/providerConfigured/…).
--                  NEVER secrets / recipients / mail bodies / tokens / payloads.
-- =============================================================================
CREATE TABLE system.cron_heartbeat (
  job           text PRIMARY KEY
                  CHECK (job IN ('task-recurrence', 'task-mail', 'task-weekly-report')),
  last_run_at   timestamptz NOT NULL DEFAULT now(),
  last_ok       boolean     NOT NULL DEFAULT true,
  last_summary  jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cron_heartbeat_summary_len
    CHECK (last_summary IS NULL OR pg_column_size(last_summary) <= 8192)
);
COMMENT ON TABLE system.cron_heartbeat IS
  'PHF HR System Health — last-run ledger for existing background jobs. UPSERT in place (one row/job). No PII, no secrets.';

-- =============================================================================
-- GRANTS — least privilege. phf_hr_app: SELECT + INSERT + UPDATE (upsert).
-- No DELETE. Nothing to PUBLIC.
-- =============================================================================
REVOKE ALL ON SCHEMA system FROM PUBLIC;
GRANT  USAGE ON SCHEMA system TO phf_hr_app;
REVOKE ALL ON system.cron_heartbeat FROM PUBLIC;
GRANT  SELECT, INSERT, UPDATE ON system.cron_heartbeat TO phf_hr_app;

RESET ROLE;

-- =============================================================================
-- POST-APPLY VALIDATION (SELECT-only, safe to re-run)
-- =============================================================================
SELECT 'schema system exists = '            || count(*) FROM information_schema.schemata WHERE schema_name = 'system';
SELECT 'table system.cron_heartbeat exists = ' || count(*) FROM information_schema.tables WHERE table_schema = 'system' AND table_name = 'cron_heartbeat';
SELECT 'phf_hr_app can SELECT = '            || has_table_privilege('phf_hr_app', 'system.cron_heartbeat', 'SELECT');
SELECT 'phf_hr_app can INSERT = '            || has_table_privilege('phf_hr_app', 'system.cron_heartbeat', 'INSERT');
SELECT 'phf_hr_app can UPDATE = '            || has_table_privilege('phf_hr_app', 'system.cron_heartbeat', 'UPDATE');
SELECT 'phf_hr_app CANNOT DELETE = '         || NOT has_table_privilege('phf_hr_app', 'system.cron_heartbeat', 'DELETE');
SELECT 'PUBLIC CANNOT SELECT = '             || NOT has_table_privilege('public', 'system.cron_heartbeat', 'SELECT');

COMMIT;
