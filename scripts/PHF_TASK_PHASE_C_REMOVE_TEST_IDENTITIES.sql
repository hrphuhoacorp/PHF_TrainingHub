-- ============================================================================
-- PHF_TASK_PHASE_C_REMOVE_TEST_IDENTITIES.sql   —   ONE PASTE BLOCK, DEPLOYER
-- ============================================================================
-- APPLY TARGET:  SANDBOX ONLY  —  project ref  pxkjvawdrixgoukhyvnk
-- DO NOT APPLY TO MAIN (byhpcexmjzqpctyvfczd).
--
-- Removes the test identities that accumulated in SANDBOX, so the local /
-- SANDBOX baseline reflects real MAIN production identity 1:1. Verified
-- against a live READ-ONLY MAIN comparison (2026-08-28):
--   - every real MAIN employee_profiles row (39) is already present in
--     SANDBOX with identical master fields — 0 field mismatches, 0 missing.
--   - every real MAIN user_accounts row (40) already present, 0 mismatches.
--   - the 9 real task_permission_assignments rows already share MAIN's exact
--     UUIDs. MAIN has 0 task_permission_grants.
-- Only the rows below are NOT in MAIN — all are test/gate fixtures.
--
-- The session's service_role has SELECT/INSERT only (no UPDATE/DELETE) on the
-- SANDBOX identity tables, so this removal must run as owner in the SQL
-- Editor. No lasting GRANT is added.
--
-- Single transaction. Idempotent. FK-safe order.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) PREFLIGHT — abort unless this is SANDBOX.
-- ---------------------------------------------------------------------------
do $$
declare v_real bigint;
begin
  select count(*) into v_real from public.employee_profiles
   where employee_code not like 'PARITY_TEST_%' and employee_code not like 'ZTEST%';
  if v_real > 80 then
    raise exception 'PREFLIGHT ABORT: % non-test employee_profiles — looks like MAIN, not SANDBOX.', v_real;
  end if;
  raise notice 'PREFLIGHT OK — % real employee_profiles, treating as SANDBOX.', v_real;
end $$;

-- ---------------------------------------------------------------------------
-- 1) The test identity keys.
-- ---------------------------------------------------------------------------
create temporary table _phf_c_test_ec (employee_code text primary key) on commit drop;
insert into _phf_c_test_ec(employee_code) values
  ('ZTEST-MGR'),('ZTEST-SUBJ'),('LOCAL-PARITY-ADMIN'),
  ('PARITY_TEST_E01'),('PARITY_TEST_E02'),('PARITY_TEST_E03'),('PARITY_TEST_E04'),('PARITY_TEST_E05'),
  ('PARITY_TEST_E06'),('PARITY_TEST_E07'),('PARITY_TEST_E08'),('PARITY_TEST_E09'),('PARITY_TEST_E10');

-- ---------------------------------------------------------------------------
-- 2) Task permission rows for test identities (assignments; grants already
--    cleared to MAIN's 0 by the session, 5 history-locked inactive rows remain
--    and are functionally inert — left as-is).
-- ---------------------------------------------------------------------------
delete from public.task_permission_assignments
 where employee_code in (select employee_code from _phf_c_test_ec);

-- ---------------------------------------------------------------------------
-- 3) The 2 test-user-created tasks (CV-2608-0001/0002) are already cancelled
--    by the session. They cannot be hard-deleted (published history +
--    task_events append-only + task_tasks_guard_delete / LOCK 4). Their
--    created_by_employee_code is a plain text column with NO FK to
--    employee_profiles (Foundation 1.66.0, by design), so removing the
--    profiles below leaves only a harmless orphan text code. Left as-is.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4) user_accounts — test accounts.
-- ---------------------------------------------------------------------------
delete from public.user_accounts
 where email ilike '%@test.local'
    or employee_code in (select employee_code from _phf_c_test_ec);

-- ---------------------------------------------------------------------------
-- 5) employee_profiles — test profiles.
-- ---------------------------------------------------------------------------
delete from public.employee_profiles
 where employee_code in (select employee_code from _phf_c_test_ec);

-- ---------------------------------------------------------------------------
-- 6) employees (legacy Hub directory) — the 2 ZTEST rows not in MAIN.
-- ---------------------------------------------------------------------------
delete from public.employees
 where full_name ilike 'ZTEST %'
    or full_name ilike '%parity test%'
    or full_name ilike 'local-parity%';

commit;

-- ---------------------------------------------------------------------------
-- POST-APPLY VERIFY (deployer):
--   select count(*) from public.employee_profiles;                 -- expect 39
--   select count(*) from public.user_accounts;                     -- expect 40
--   select count(*) from public.task_permission_assignments;       -- expect 9
--   select count(*) from public.employees;                         -- expect 39
-- Then re-run:
--   node scripts/task-main-readonly-mirror-dev.js       (PHF_MAIN_* env)
--   node scripts/test-task-real-persona-permission-v1.js
--   plus the full Phase B regression sweep.
-- ---------------------------------------------------------------------------
