-- =============================================================================
-- PHF HR — DATABASE-LEVEL CONNECT ISOLATION REMEDIATION
--
-- REVIEW ONLY UNTIL EXPLICITLY RUN BY DEPLOYER. Fixes the pre-existing
-- PostgreSQL default-ACL gap discovered during Gate S2 validation: PUBLIC
-- had CONNECT+TEMPORARY on both phfcrm and phf_hr (Postgres default when a
-- database is created and nobody explicitly revokes it — NOT introduced by
-- this migration work).
--
-- SCOPE (least privilege, per explicit instruction):
--   phfcrm: REVOKE CONNECT, TEMPORARY FROM PUBLIC. No compensating GRANT
--     here — CSKH's actual runtime role is "postgres" (superuser), which
--     bypasses ALL ACL checks regardless of PUBLIC grants, so it needs and
--     gets no explicit grant. Nothing else connects to phfcrm today
--     (pg_stat_activity showed 0 non-diagnostic connections at check time)
--     other than that superuser session.
--   phf_hr: GRANT CONNECT ONLY (no TEMPORARY — no evidence any application
--     code needs temp tables; can be added later with evidence) to
--     phf_hr_app specifically, THEN revoke PUBLIC's default. phf_hr_owner
--     stays NOLOGIN, gets no CONNECT grant (NOLOGIN roles never open their
--     own connection — only reached via SET ROLE from an already-connected
--     session, which is not gated by database CONNECT ACL at all).
--
-- KNOWN, ACCEPTED, OUT-OF-SCOPE LIMITATION (documented, not silently ignored):
--   postgres (CSKH's actual runtime role) is a cluster superuser and will
--   CONTINUE to have full access to phf_hr regardless of anything in this
--   file — superuser bypasses per-database ACL checks entirely. This
--   REVOKE/GRANT set CANNOT close that direction. Closing it requires CSKH
--   to stop running as superuser — a separate, explicitly out-of-scope
--   security-hardening workstream per current instruction, NOT part of
--   Gate S2.
--
-- Does NOT restart any container, does NOT touch any .env file, does NOT
-- change CSKH's runtime role/credential.
-- =============================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- BEFORE snapshot (read-only)
-- ---------------------------------------------------------------------------
select
  'BEFORE' as phase,
  has_database_privilege('phf_hr_app', 'phfcrm', 'CONNECT')    as phf_hr_app_to_phfcrm_connect,
  has_database_privilege('phf_hr_owner', 'phfcrm', 'CONNECT')  as phf_hr_owner_to_phfcrm_connect,
  has_database_privilege('phf_hr_app', 'phf_hr', 'CONNECT')    as phf_hr_app_to_phf_hr_connect,
  has_database_privilege('phf_hr_app', 'phf_hr', 'TEMPORARY')  as phf_hr_app_to_phf_hr_temp,
  has_database_privilege('postgres', 'phfcrm', 'CONNECT')      as postgres_to_phfcrm_connect,
  has_database_privilege('postgres', 'phf_hr', 'CONNECT')      as postgres_to_phf_hr_connect;

select 'BEFORE_ACL' as phase, datname, datacl from pg_database where datname in ('phfcrm', 'phf_hr');

-- ---------------------------------------------------------------------------
-- REMEDIATION (atomic — rolls back entirely if any statement fails)
-- ---------------------------------------------------------------------------
begin;

revoke connect, temporary on database phfcrm from public;

grant connect on database phf_hr to phf_hr_app;
revoke connect, temporary on database phf_hr from public;

commit;

-- ---------------------------------------------------------------------------
-- AFTER snapshot (same shape as BEFORE, for direct diff)
-- ---------------------------------------------------------------------------
select
  'AFTER' as phase,
  has_database_privilege('phf_hr_app', 'phfcrm', 'CONNECT')    as phf_hr_app_to_phfcrm_connect,
  has_database_privilege('phf_hr_owner', 'phfcrm', 'CONNECT')  as phf_hr_owner_to_phfcrm_connect,
  has_database_privilege('phf_hr_app', 'phf_hr', 'CONNECT')    as phf_hr_app_to_phf_hr_connect,
  has_database_privilege('phf_hr_app', 'phf_hr', 'TEMPORARY')  as phf_hr_app_to_phf_hr_temp,
  has_database_privilege('postgres', 'phfcrm', 'CONNECT')      as postgres_to_phfcrm_connect,
  has_database_privilege('postgres', 'phf_hr', 'CONNECT')      as postgres_to_phf_hr_connect;

select 'AFTER_ACL' as phase, datname, datacl from pg_database where datname in ('phfcrm', 'phf_hr');

-- Expected AFTER row: f, f, t, f, t, t  (in the same column order as above)
-- Expected AFTER_ACL: phfcrm and phf_hr both show explicit acl entries now
-- (no longer NULL/default) — phf_hr should show a grantee entry for
-- phf_hr_app with CONNECT (no TEMPORARY), PUBLIC entries removed from both.
