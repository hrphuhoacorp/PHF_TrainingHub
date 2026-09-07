-- =============================================================================
-- PHF HR — SYSTEM V1 · TÌNH TRẠNG HỆ THỐNG — DOWN
-- Reverses phf_hr_system_health_v1.sql. Drops system.cron_heartbeat and the
-- `system` schema (only if empty). Throwaway use only.
-- =============================================================================
\set ON_ERROR_STOP on

BEGIN;

SET ROLE phf_hr_owner;
DROP TABLE IF EXISTS system.cron_heartbeat;
-- RESTRICT: refuse if anything else was added under `system` later.
DROP SCHEMA IF EXISTS system RESTRICT;
RESET ROLE;

SELECT 'schema system remaining = ' || count(*) FROM information_schema.schemata WHERE schema_name = 'system';

COMMIT;
