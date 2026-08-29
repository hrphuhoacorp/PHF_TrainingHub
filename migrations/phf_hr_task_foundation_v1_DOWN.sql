-- =============================================================================
-- ROLLBACK for phf_hr_task_foundation_v1.sql — FOUNDATION STAGE ONLY.
--
-- REVIEW ONLY. DO NOT EXECUTE.
--
-- Scope: drops ONLY the schema "task" (and everything inside it, via CASCADE
-- on the schema itself) in database phf_hr. Does NOT touch:
--   - database phfcrm (different database entirely — not reachable from
--     within phf_hr's DROP SCHEMA at all)
--   - phf_hr_owner / phf_hr_app roles (roles are cluster-wide objects,
--     created outside this migration at Gate S1 — NOT dropped here; if role
--     removal is ever needed that is a separate, explicit decision)
--   - any other schema in phf_hr (none exist yet at this stage — "legacy"
--     schema explicitly NOT created by the UP migration either)
--
-- Safe ONLY while this is the sole migration applied (foundation stage, zero
-- business data yet). Do NOT reuse this rollback once real Task data exists
-- in phf_hr — a data-preserving rollback would need a different design
-- (this file intentionally does not attempt that).
-- =============================================================================

begin;

-- Revoke grants first (explicit, mirrors what the UP migration granted —
-- not strictly required since DROP SCHEMA ... CASCADE removes grants along
-- with the objects, but kept explicit for auditability of what is undone).
revoke usage on schema task from phf_hr_app;

drop schema task cascade;

commit;

-- -----------------------------------------------------------------------------
-- VALIDATION AFTER ROLLBACK (read-only)
-- -----------------------------------------------------------------------------
select schema_name from information_schema.schemata where schema_name = 'task';
-- expected: 0 rows

select datname from pg_database where datname = 'phfcrm';
-- expected: 1 row, untouched — sanity check that phfcrm still exists and was
-- never in scope of this rollback
