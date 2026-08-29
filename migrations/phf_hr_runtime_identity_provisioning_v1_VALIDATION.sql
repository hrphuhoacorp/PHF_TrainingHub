-- =============================================================================
-- PHF HR — RUNTIME DB IDENTITY VALIDATION (BEFORE / DURING / AFTER)
--
-- REVIEW ONLY UNTIL EXPLICITLY RUN BY DEPLOYER. Run this file ONLY after:
--   1) phf_hr_runtime_identity_provisioning_v1.sql has been run and its
--      POST_MEMBERSHIP_OPTIONS query showed exactly admin_option=f,
--      inherit_option=f, set_option=t, and POST_CONNECT_MATRIX showed t, f.
--   2) Deployer has set phf_hr_runtime's password interactively via
--      `\password phf_hr_runtime` in an admin session (see runbook — NOT
--      part of this file, NOT part of any script, password never touches
--      chat/log/history).
--
-- HOW TO RUN — this file must be executed as a session AUTHENTICATED AS
-- phf_hr_runtime itself (not as superuser/admin — the whole point is to
-- prove what THIS login can and cannot do). Example invocation (deployer
-- types the password at the interactive prompt psql shows — it is never
-- passed as a CLI argument, never placed in this file, never in shell
-- history):
--
--   psql -h 127.0.0.1 -p 5432 -U phf_hr_runtime -d phf_hr -f phf_hr_runtime_identity_provisioning_v1_VALIDATION.sql
--
-- This whole file runs on ONE physical connection, matching the exact
-- concern raised about connection pooling: if role state leaked across
-- statement boundaries within a single session, the AFTER_COMMIT and
-- AFTER_ROLLBACK checks below would catch it (SELECT would unexpectedly
-- succeed where it must fail).
--
-- Any single unexpected result anywhere in this file = STOP. Do not write
-- any credential into .env, do not proceed to Batch 1, do not attempt to
-- patch the role definition ad hoc — report back with the exact query and
-- unexpected output for re-review.
-- =============================================================================
\set ON_ERROR_STOP off
-- ON_ERROR_STOP is deliberately OFF here: the whole point of BEFORE/AFTER is
-- that certain SELECTs are EXPECTED TO FAIL (permission denied). We want the
-- script to keep going and print every phase's result rather than abort on
-- the first expected failure. Read every phase's output — do not assume
-- silence means pass.

-- ---------------------------------------------------------------------------
-- BEFORE — no SET LOCAL ROLE issued yet on this connection
-- ---------------------------------------------------------------------------
select 'BEFORE' as phase, current_user, session_user;
-- Expected: current_user = phf_hr_runtime, session_user = phf_hr_runtime

select 'BEFORE_SELECT_ATTEMPT' as phase, count(*) from task.tasks;
-- Expected: ERROR permission denied for schema task (or for table
-- task.tasks) — this MUST fail. If this SELECT succeeds, STOP immediately —
-- it means phf_hr_runtime has direct privileges it should not have (either
-- INHERIT was not actually FALSE, or some other grant exists) — do not
-- proceed under any circumstance, this is the core safety property of the
-- whole design.

-- ---------------------------------------------------------------------------
-- DURING — inside an explicit transaction, after SET LOCAL ROLE
-- ---------------------------------------------------------------------------
begin;

set local role phf_hr_app;

select 'DURING' as phase, current_user, session_user;
-- Expected: current_user = phf_hr_app, session_user = phf_hr_runtime
-- (session_user staying phf_hr_runtime is the proof that this is a
-- transaction-local role switch, not a re-authentication — matches the
-- forensic value claimed for Option B: logs/pg_stat_activity still show the
-- true login identity.)

select 'DURING_SELECT_ATTEMPT' as phase, count(*) from task.tasks;
-- Expected: SUCCEEDS (returns a row count, no error) — this is phf_hr_app's
-- pre-existing S2 runtime grant working as designed.

commit;

-- ---------------------------------------------------------------------------
-- AFTER_COMMIT — same connection, no new transaction opened yet
-- ---------------------------------------------------------------------------
select 'AFTER_COMMIT' as phase, current_user, session_user;
-- Expected: current_user reverted to phf_hr_runtime automatically (SET
-- LOCAL is transaction-scoped) — session_user unchanged throughout.

select 'AFTER_COMMIT_SELECT_ATTEMPT' as phase, count(*) from task.tasks;
-- Expected: ERROR permission denied again. If this SUCCEEDS, the role
-- reverted in name (current_user shows phf_hr_runtime) but NOT in effective
-- privilege, or some other leak occurred — STOP, this is exactly the
-- pooling-leak failure mode the design must rule out.

-- ---------------------------------------------------------------------------
-- AFTER_ROLLBACK — repeat DURING but abort instead of commit, same
-- connection, to prove the revert also happens on the error/abort path
-- (the path most likely to be hit by a real application bug).
-- ---------------------------------------------------------------------------
begin;

set local role phf_hr_app;

select 'AFTER_ROLLBACK_DURING' as phase, current_user, session_user;
-- Expected: current_user = phf_hr_app again (sanity check the pattern is
-- repeatable on the same connection).

rollback;

select 'AFTER_ROLLBACK' as phase, current_user, session_user;
-- Expected: current_user = phf_hr_runtime again.

select 'AFTER_ROLLBACK_SELECT_ATTEMPT' as phase, count(*) from task.tasks;
-- Expected: ERROR permission denied again — proves revert-on-abort works
-- without any explicit RESET ROLE, which is the entire justification for
-- mandating SET LOCAL ROLE (not SET ROLE) in the write-bridge code later.

-- ---------------------------------------------------------------------------
-- CROSS-DATABASE ISOLATION CHECK (does not need SET ROLE — plain catalog
-- function, works from any authenticated session)
-- ---------------------------------------------------------------------------
select 'PHFCRM_ISOLATION' as phase,
  has_database_privilege('phf_hr_runtime', 'phfcrm', 'CONNECT') as runtime_to_phfcrm_connect;
-- Expected: f
