-- =============================================================================
-- PHF HR — RUNTIME GRANTS REMEDIATION (phf_hr_app), v1
--
-- REVIEW ONLY UNTIL EXPLICITLY RUN BY DEPLOYER. Not applied to any database
-- yet — this file was written to close a grant-level drift discovered
-- between phf_hr (Production, 127 table grants for schema task) and
-- phf_hr_verify (built fresh from migrations/phf_hr_task_foundation_v1.sql,
-- 123 table grants) — see B2 schema-capture diff, 2026-08-27.
--
-- ROOT CAUSE (confirmed by reading phf_hr_task_foundation_v1.sql directly,
-- lines 594-599 / 604-612 / 618): the foundation migration's GRANT
-- statements never included these 4 privileges. phf_hr Production has them
-- anyway — almost certainly granted by hand at some point after Gate 12
-- (category/permission-grant CRUD) and the addTaskLink idempotent re-link
-- path were implemented, without the foundation file ever being amended to
-- match. This file does NOT rewrite that history (foundation file stays
-- untouched, per explicit instruction) — it is a forward-only remediation
-- that makes any freshly-built database (phf_hr_verify today, any future
-- rebuild) reach the SAME grant state phf_hr already has, without ever
-- re-running the foundation script's GRANT block by hand.
--
-- SCOPE — exactly 4 GRANT statements, nothing else:
--   1. GRANT DELETE ON task.categories TO phf_hr_app;
--        needed by deleteTaskCategoryIfUnused() (Gate 12, lib/task-write.js)
--   2. GRANT INSERT ON task.code_counters TO phf_hr_app;
--        needed by task.task_next_code() — SECURITY INVOKER (no DEFINER
--        clause), runs as the caller (phf_hr_app via SET LOCAL ROLE), and
--        does INSERT ... ON CONFLICT DO UPDATE
--   3. GRANT UPDATE ON task.links TO phf_hr_app;
--        needed by addTaskLink()'s idempotent-recovery branch, which does
--        UPDATE task.links SET related_event_id = $2
--   4. GRANT UPDATE ON task.permission_grants TO phf_hr_app;
--        needed by revokeTaskPermissionGrant() (Gate 12), which sets
--        is_active = false on an existing grant row
--
-- Does NOT revoke anything. Does NOT touch table/schema/function/trigger
-- definitions. Does NOT touch phfcrm. Does NOT change role attributes
-- (LOGIN/SUPERUSER/CREATEDB/CREATEROLE) for phf_hr_app or any other role.
-- Does NOT run against Production phf_hr in this GO — target database is
-- whichever the deployer connects to when running this file (intended
-- target right now: phf_hr_verify only).
--
-- Idempotent: PostgreSQL GRANT is idempotent by nature (granting an
-- already-held privilege is a silent no-op, not an error) — safe to re-run
-- this file any number of times, on phf_hr_verify or on any future
-- freshly-built database, without side effects beyond the first run.
-- =============================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- BEFORE snapshot (read-only)
-- ---------------------------------------------------------------------------
select 'BEFORE' as phase,
  has_table_privilege('phf_hr_app', 'task.categories', 'DELETE')        as categories_delete,
  has_table_privilege('phf_hr_app', 'task.code_counters', 'INSERT')     as code_counters_insert,
  has_table_privilege('phf_hr_app', 'task.links', 'UPDATE')             as links_update,
  has_table_privilege('phf_hr_app', 'task.permission_grants', 'UPDATE') as permission_grants_update;

-- ---------------------------------------------------------------------------
-- REMEDIATION (atomic — rolls back entirely if any statement fails)
-- ---------------------------------------------------------------------------
begin;

grant delete on task.categories to phf_hr_app;
grant insert on task.code_counters to phf_hr_app;
grant update on task.links to phf_hr_app;
grant update on task.permission_grants to phf_hr_app;

commit;

-- ---------------------------------------------------------------------------
-- AFTER / VERIFICATION (read-only) — all 4 MUST be true
-- ---------------------------------------------------------------------------
select 'AFTER' as phase,
  has_table_privilege('phf_hr_app', 'task.categories', 'DELETE')        as categories_delete,
  has_table_privilege('phf_hr_app', 'task.code_counters', 'INSERT')     as code_counters_insert,
  has_table_privilege('phf_hr_app', 'task.links', 'UPDATE')             as links_update,
  has_table_privilege('phf_hr_app', 'task.permission_grants', 'UPDATE') as permission_grants_update;
-- Expected: t, t, t, t — all four. If any is f, STOP, do not proceed to
-- categories_snapshot_v1 or B3, investigate before re-running.
