-- =============================================================================
-- PHF HR — RUNTIME DB IDENTITY PROVISIONING (phf_hr_runtime)
--
-- REVIEW ONLY UNTIL EXPLICITLY RUN BY DEPLOYER, AS A SUPERUSER/ADMIN SESSION
-- (NOT claude-phf — claude-phf has no DB login and must not be given one).
--
-- Implements OPTION_B runtime identity design (accepted in principle by PHF):
--   phf_hr_owner  : NOLOGIN (unchanged, owns schema/tables — untouched here)
--   phf_hr_app    : NOLOGIN (unchanged, holds all runtime CRUD grants from
--                   Gate S2 — untouched here, NOT given a password, ever)
--   phf_hr_runtime: NEW, LOGIN-only, holds ZERO direct grants on schema task.
--                   Reaches phf_hr_app's privileges ONLY via
--                   `SET LOCAL ROLE phf_hr_app` inside an explicit
--                   transaction (see phf_hr_runtime_identity_provisioning_v1_VALIDATION.sql).
--
-- Correction applied per explicit instruction: membership is granted with
-- INHERIT FALSE (default GRANT role TO member would let phf_hr_runtime
-- silently inherit phf_hr_app's privileges on login, defeating the entire
-- "zero privilege before SET LOCAL ROLE" model) + SET TRUE (permission to
-- run SET ROLE/SET LOCAL ROLE) + ADMIN FALSE (cannot re-grant this
-- membership to any other role).
--
-- PRE-FLIGHT EVIDENCE (confirmed live on server, catalog-based, non-
-- interactive — no \h/pager involved):
--   server_version      = PostgreSQL 17.10
--   password_encryption = scram-sha-256
--   pg_auth_members has admin_option, inherit_option, set_option columns —
--     all three confirmed present and queryable.
-- This confirms the server supports the WITH INHERIT/SET/ADMIN {TRUE|FALSE}
-- membership-option grammar used below (feature introduced PG16, carried
-- into PG17). Syntax is otherwise still first-use on this instance — the
-- POST_MEMBERSHIP_OPTIONS query after GRANT is the actual proof it was
-- accepted and applied as intended, not just that the server is new enough.
--
-- Does NOT set a password (see companion runbook — password is entered
-- interactively via \password, never via this file, never via any script
-- argument, never logged).
-- Does NOT touch phfcrm (no CONNECT granted there, matches S2 isolation
-- remediation intent).
-- Does NOT touch .env, does NOT restart any container, does NOT install pg,
-- does NOT change application code.
-- =============================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- PRE-FLIGHT (read-only) — confirm phf_hr_runtime does not already exist,
-- confirm phf_hr_app/phf_hr_owner attributes are still as S2 left them.
-- ---------------------------------------------------------------------------
select 'PRE_FLIGHT_ROLES' as phase, rolname, rolcanlogin, rolinherit, rolsuper,
       rolcreatedb, rolcreaterole
from pg_roles
where rolname in ('phf_hr_owner', 'phf_hr_app', 'phf_hr_runtime')
order by rolname;
-- Expected: phf_hr_owner + phf_hr_app rows present (rolcanlogin=f each,
-- unchanged from S2); NO row for phf_hr_runtime yet.
--
-- This SELECT alone does NOT stop the script if the file is run
-- non-interactively (`psql -f`) in one shot — a human would not get a
-- chance to read this output before the transaction below proceeds. The DO
-- block immediately after is the actual enforcement: it RAISEs and aborts
-- the whole script (via ON_ERROR_STOP) if any pre-condition is violated,
-- instead of relying on a human reading SELECT output mid-script.

-- ---------------------------------------------------------------------------
-- PROVISIONING (atomic — rolls back entirely if any statement fails)
-- ---------------------------------------------------------------------------
begin;

-- Hard guard — must run BEFORE create role. Aborts the transaction (and,
-- via ON_ERROR_STOP, the whole script) instead of silently proceeding on a
-- wrong assumption. Does not change any state itself (read-only checks).
do $guard$
begin
  if exists (select 1 from pg_roles where rolname = 'phf_hr_runtime') then
    raise exception 'GUARD FAILED: role phf_hr_runtime already exists — refusing to proceed. Investigate before re-running; do not drop/recreate blindly.';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'phf_hr_app' and rolcanlogin = false) then
    raise exception 'GUARD FAILED: phf_hr_app missing or unexpectedly has LOGIN — S2 baseline assumption violated, refusing to proceed.';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'phf_hr_owner' and rolcanlogin = false) then
    raise exception 'GUARD FAILED: phf_hr_owner missing or unexpectedly has LOGIN — S2 baseline assumption violated, refusing to proceed.';
  end if;
end
$guard$;

create role phf_hr_runtime with
  login
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  connection limit -1;
-- No PASSWORD clause here on purpose — role is created unusable (no
-- password = cannot authenticate) until deployer sets it interactively in a
-- separate step (see runbook). This keeps this file safe to exist as a
-- reviewable artifact with zero secret material in it.

grant connect on database phf_hr to phf_hr_runtime;
-- Deliberately NOT granting connect on phfcrm — preserves S2 isolation intent.

grant phf_hr_app to phf_hr_runtime with inherit false, set true, admin false;

commit;

-- ---------------------------------------------------------------------------
-- POST-PROVISIONING VERIFICATION (read-only, run in same admin session)
-- ---------------------------------------------------------------------------

-- 1) Role attributes
select 'POST_ROLE_ATTRS' as phase, rolname, rolcanlogin, rolinherit, rolsuper,
       rolcreatedb, rolcreaterole
from pg_roles
where rolname = 'phf_hr_runtime';
-- Expected: rolcanlogin=t, rolinherit=f, rolsuper=f, rolcreatedb=f, rolcreaterole=f

-- 2) Database CONNECT privilege matrix
select 'POST_CONNECT_MATRIX' as phase,
  has_database_privilege('phf_hr_runtime', 'phf_hr', 'CONNECT')  as runtime_to_phf_hr_connect,
  has_database_privilege('phf_hr_runtime', 'phfcrm', 'CONNECT')  as runtime_to_phfcrm_connect;
-- Expected: t, f  — if runtime_to_phfcrm_connect is anything but f, STOP,
-- do not proceed to password/validation, investigate (likely means PUBLIC
-- still has CONNECT on phfcrm — contradicts S2 isolation remediation, needs
-- separate investigation, not silently patched here).

-- 3) Membership options — the exact correction requested. Column names
-- (inherit_option, set_option, admin_option) confirmed present via
-- pre-flight catalog check (information_schema.columns) before this file
-- was finalized — see PRE-FLIGHT EVIDENCE note at top of file.
select 'POST_MEMBERSHIP_OPTIONS' as phase,
  r.rolname as granted_role,
  m.rolname as member_role,
  am.admin_option,
  am.inherit_option,
  am.set_option
from pg_auth_members am
join pg_roles r on r.oid = am.roleid
join pg_roles m on m.oid = am.member
where r.rolname = 'phf_hr_app' and m.rolname = 'phf_hr_runtime';
-- Expected exactly one row: admin_option=f, inherit_option=f, set_option=t.
-- Any deviation (row missing, or any of the three booleans wrong) → STOP.
-- Do not proceed to password step or validation until this row matches
-- exactly. Do not attempt to "fix forward" with an ad hoc GRANT/REVOKE
-- without re-reviewing this file first — re-run from a clean state instead
-- (see companion _DOWN.sql, run manually, not automatically).
