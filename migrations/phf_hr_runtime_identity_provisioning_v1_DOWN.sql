-- =============================================================================
-- PHF HR — RUNTIME DB IDENTITY PROVISIONING — ROLLBACK
--
-- MANUAL TRIGGER ONLY. Do NOT run this automatically as a reaction to a
-- validation failure — per explicit instruction, a failed validation means
-- STOP AND REPORT, not auto-rollback. A human (PHF/deployer) decides,
-- after seeing the exact unexpected output, whether rollback or forward-fix
-- is appropriate.
--
-- Fully isolated: touches ONLY phf_hr_runtime and its membership in
-- phf_hr_app. Does NOT touch phf_hr_owner, phf_hr_app's own grants, schema
-- task, any table, or phfcrm.
-- =============================================================================
\set ON_ERROR_STOP on

begin;

revoke phf_hr_app from phf_hr_runtime;
revoke connect on database phf_hr from phf_hr_runtime;
drop role if exists phf_hr_runtime;

commit;

-- Verification (read-only)
select 'ROLLBACK_VERIFY' as phase, count(*) as remaining_rows
from pg_roles where rolname = 'phf_hr_runtime';
-- Expected: 0
