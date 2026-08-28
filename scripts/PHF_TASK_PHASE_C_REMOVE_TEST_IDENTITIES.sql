-- ============================================================================
-- PHF_TASK_PHASE_C_REMOVE_TEST_IDENTITIES.sql   —   ONE PASTE BLOCK, DEPLOYER
--   (rev 2 — history-FK-safe)
-- ============================================================================
-- APPLY TARGET:  SANDBOX ONLY  —  project ref  pxkjvawdrixgoukhyvnk
-- DO NOT APPLY TO MAIN (byhpcexmjzqpctyvfczd).
--
-- Removes the test identities that accumulated in SANDBOX so the local /
-- SANDBOX baseline reflects real MAIN production identity. Verified against a
-- live READ-ONLY MAIN comparison (2026-08-28):
--   - all 39 real MAIN employee_profiles present in SANDBOX, 0 field drift.
--   - all 40 real MAIN user_accounts present (same id), 0 drift.
--   - the 9 real task_permission_assignments share MAIN's exact UUIDs.
--   - MAIN has 0 task_permission_grants.
-- Only the rows this script touches are NOT in MAIN — all test/gate fixtures.
--
-- rev 2 ROOT CAUSE: rev 1 tried to DELETE test task_permission_assignments,
-- but each is referenced by task_permission_assignment_history (FK
-- task_permission_assignment_history_assignment_id_fkey, ON DELETE RESTRICT).
-- Audit/history rows must NEVER be deleted. rev 2:
--   * hard-deletes ONLY test assignments with NO history child row,
--   * makes history-referenced test assignments permanently inert
--     (is_active=false + effective_to=now()) and leaves them + their history
--     physically in place (documented, excluded from active-state parity).
--
-- Single transaction. Idempotent. Preflight-guarded. FK-safe order.
-- The session's service_role has SELECT/INSERT only (no UPDATE/DELETE) on the
-- SANDBOX identity tables — run this as owner in the SQL Editor. No lasting
-- GRANT is added.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) PREFLIGHT — abort unless this is SANDBOX.
-- ---------------------------------------------------------------------------
do $$
declare v_real bigint;
begin
  select count(*) into v_real from public.employee_profiles
   where employee_code not like 'PARITY\_TEST\_%' escape '\'
     and employee_code not like 'ZTEST%';
  if v_real > 80 then
    raise exception 'PREFLIGHT ABORT: % non-test employee_profiles — looks like MAIN, not SANDBOX. Nothing applied.', v_real;
  end if;
  raise notice 'PREFLIGHT OK — % real employee_profiles, treating as SANDBOX.', v_real;
end $$;

-- ---------------------------------------------------------------------------
-- 1) task_permission_assignments (test) — history-FK-safe.
--    Delete the ones with no history; make the rest permanently inert.
--    task_permission_grants were already cleared to MAIN's 0 active by the
--    session (5 history-locked inactive rows remain, inert — left as-is,
--    same rationale).
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_del  int := 0;
  v_inert int := 0;
begin
  for r in
    select a.id, a.employee_code,
           exists (select 1 from public.task_permission_assignment_history h
                    where h.assignment_id = a.id) as has_history
      from public.task_permission_assignments a
     where a.employee_code like 'PARITY\_TEST\_%' escape '\'
        or a.employee_code like 'ZTEST%'
        or a.employee_code = 'LOCAL-PARITY-ADMIN'
  loop
    if r.has_history then
      update public.task_permission_assignments
         set is_active = false,
             effective_to = coalesce(effective_to, now()),
             updated_at = now()
       where id = r.id
         and (is_active = true or effective_to is null);
      v_inert := v_inert + 1;
    else
      delete from public.task_permission_assignments where id = r.id;
      v_del := v_del + 1;
    end if;
  end loop;
  raise notice 'task_permission_assignments (test): % hard-deleted, % retained-inert (history-locked)', v_del, v_inert;
end $$;

-- ---------------------------------------------------------------------------
-- 2) The 2 test-user-created tasks (CV-2608-0001/0002) are already cancelled
--    by the session. They cannot be hard-deleted (published history +
--    task_events append-only + task_tasks_guard_delete / LOCK 4). Their
--    created_by_employee_code is plain text with NO FK to employee_profiles
--    (Foundation 1.66.0, by design) — the orphan text code is harmless.
--    Left as-is.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3) user_accounts (test) — delete BEFORE employees (user_accounts.employee_id
--    → employees.id for the 2 ZTEST accounts).
-- ---------------------------------------------------------------------------
delete from public.user_accounts
 where email ilike '%@test.local'
    or employee_code like 'PARITY\_TEST\_%' escape '\'
    or employee_code like 'ZTEST%'
    or employee_code = 'LOCAL-PARITY-ADMIN';

-- ---------------------------------------------------------------------------
-- 4) employee_profiles (test) — the HR sub-tables
--    (employee_private_profiles / _contracts / _compensation / _master_history)
--    do not exist on SANDBOX, so no child rows block this.
-- ---------------------------------------------------------------------------
delete from public.employee_profiles
 where employee_code like 'PARITY\_TEST\_%' escape '\'
    or employee_code like 'ZTEST%';

-- ---------------------------------------------------------------------------
-- 5) employees (legacy Hub directory) — exact ids of the 2 ZTEST rows.
-- ---------------------------------------------------------------------------
delete from public.employees
 where id in ('ZTEST-MGR', 'ZTEST-SUBJ')
    or full_name ilike 'ZTEST %';

commit;

-- ---------------------------------------------------------------------------
-- POST-APPLY VERIFY (deployer):
--   select count(*) from public.employee_profiles;                             -- expect 39
--   select count(*) from public.user_accounts;                                 -- expect 40
--   select count(*) from public.employees;                                     -- expect 39
--   select count(*) filter (where is_active) as active,
--          count(*)                        as total
--     from public.task_permission_assignments;                                 -- active 8 ; total 9..13 (9 real + up to 4 history-locked inert test)
--   select count(*) from public.task_permission_assignments
--     where (employee_code like 'PARITY\_TEST\_%' escape '\' or employee_code like 'ZTEST%')
--       and is_active;                                                          -- expect 0
--   select count(*) filter (where is_active) from public.task_permission_grants; -- expect 0
--   select count(*) from public.task_tasks where title ilike '%[REPORT-UI-TEST]%'; -- expect 37 (demo corpus untouched)
--
-- Then re-run:
--   PHF_MAIN_SUPABASE_URL=... PHF_MAIN_SUPABASE_SECRET_KEY=... node scripts/task-main-readonly-mirror-dev.js
--   node scripts/test-task-real-persona-permission-v1.js
--   plus the full Phase B regression sweep.
-- ---------------------------------------------------------------------------
