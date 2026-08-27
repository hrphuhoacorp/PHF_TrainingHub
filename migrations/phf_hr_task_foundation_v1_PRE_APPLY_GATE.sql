-- =============================================================================
-- PRE-APPLY GATE — run this FIRST, in isolation, before touching
-- phf_hr_task_foundation_v1.sql or phf_hr_task_categories_snapshot_v1.sql.
--
-- ZERO DDL, ZERO DML. Only proves, empirically and visibly, that the
-- connecting admin login can actually SET ROLE to both phf_hr_owner and
-- phf_hr_app, and that RESET ROLE correctly reverts — before any real
-- migration file is trusted to do the same thing implicitly.
--
-- If ANY step below fails or prints an unexpected value, STOP — do not run
-- the real migration files. Report back the exact output instead.
--
-- REVIEW ONLY. Safe to run as-is — it changes nothing persistent.
-- =============================================================================
\set ON_ERROR_STOP on

select current_user as connected_as, session_user as login_role;
-- record this — this is the admin login actually used for the whole gate

-- --- phf_hr_owner ---
SET ROLE phf_hr_owner;
select current_user as active_role_should_be_phf_hr_owner;

DO $$
begin
  if current_user <> 'phf_hr_owner' then
    raise exception 'PRE_APPLY_GATE_FAILED: SET ROLE phf_hr_owner did not take effect, current_user=%', current_user;
  end if;
end $$;

RESET ROLE;
select current_user as reverted_role_should_match_login_role;

-- --- phf_hr_app ---
SET ROLE phf_hr_app;
select current_user as active_role_should_be_phf_hr_app;

DO $$
begin
  if current_user <> 'phf_hr_app' then
    raise exception 'PRE_APPLY_GATE_FAILED: SET ROLE phf_hr_app did not take effect, current_user=%', current_user;
  end if;
end $$;

RESET ROLE;
select current_user as reverted_role_should_match_login_role_again;

select 'PRE_APPLY_GATE_PASS — both roles reachable, RESET ROLE confirmed working' as result;
