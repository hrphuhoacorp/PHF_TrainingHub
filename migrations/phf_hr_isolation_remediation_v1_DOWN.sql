-- =============================================================================
-- ROLLBACK for phf_hr_isolation_remediation_v1.sql
--
-- REVIEW ONLY. Restores PUBLIC default CONNECT+TEMPORARY on both databases
-- (i.e. returns to the exact pre-remediation state — the original gap).
-- Only use this if the AFTER validation in the UP script showed unexpected
-- results and you need to revert while investigating, per instruction to
-- "dừng và báo evidence" rather than auto-rollback.
-- =============================================================================
\set ON_ERROR_STOP on

begin;

grant connect, temporary on database phfcrm to public;
grant connect, temporary on database phf_hr to public;
revoke connect on database phf_hr from phf_hr_app;

commit;

select
  'AFTER_ROLLBACK' as phase,
  has_database_privilege('phf_hr_app', 'phfcrm', 'CONNECT')    as phf_hr_app_to_phfcrm_connect,
  has_database_privilege('phf_hr_app', 'phf_hr', 'CONNECT')    as phf_hr_app_to_phf_hr_connect;
-- expected: t, t (back to original PUBLIC-default state)
