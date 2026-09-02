begin;

-- PHF Task Recurrence V1 — ACL / TRUNCATE hardening PATCH.
--
-- Applies the REVOKEs + BEFORE TRUNCATE guard that phf_hr_task_recurrence_v1.sql
-- now contains, to an environment where the ORIGINAL (pre-hardening) migration
-- was already applied (phf_hr_e2e). Idempotent — safe to run more than once.
-- Run by deployer (table owner / postgres): psql -v ON_ERROR_STOP=1 -f.
--
-- Reason: phf_hr_e2e provisions with
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA task GRANT ALL ON TABLES TO phf_hr_app
-- so recurrence_rule_history was born with phf_hr_app = SELECT/INSERT/UPDATE/
-- DELETE/TRUNCATE/REFERENCES/TRIGGER. The row-level forbid-update/delete trigger
-- blocks UPDATE/DELETE but NOT TRUNCATE. This patch removes the excess grants
-- and adds the missing BEFORE TRUNCATE statement trigger.

revoke update, delete, truncate, references, trigger on task.recurrence_rule_history from phf_hr_app;
revoke delete, truncate, references, trigger on task.recurrence_rules from phf_hr_app;
revoke delete, truncate, references, trigger on task.recurrence_occurrences from phf_hr_app;

drop trigger if exists task_recurrence_rule_history_forbid_truncate on task.recurrence_rule_history;
create trigger task_recurrence_rule_history_forbid_truncate before truncate on task.recurrence_rule_history
  for each statement execute function task.task_forbid_update_delete();

commit;

-- =============================================================================
-- VALIDATION (read-only, run after)
-- =============================================================================

-- 1. recurrence_rule_history grants for phf_hr_app -> expect exactly INSERT, SELECT
select grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'task' and table_name = 'recurrence_rule_history' and grantee = 'phf_hr_app'
group by grantee;

-- 2. recurrence_rules / recurrence_occurrences -> expect exactly INSERT, SELECT, UPDATE
select table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'task' and table_name in ('recurrence_rules', 'recurrence_occurrences') and grantee = 'phf_hr_app'
group by table_name order by table_name;

-- 3. TRUNCATE guard present
select tgname, pg_get_triggerdef(oid)
from pg_trigger where tgrelid = 'task.recurrence_rule_history'::regclass and not tgisinternal
order by tgname;

-- 4. has_table_privilege as phf_hr_app -> expect t,t,f,f,f
select
  has_table_privilege('phf_hr_app', 'task.recurrence_rule_history', 'SELECT')   as sel,
  has_table_privilege('phf_hr_app', 'task.recurrence_rule_history', 'INSERT')   as ins,
  has_table_privilege('phf_hr_app', 'task.recurrence_rule_history', 'UPDATE')   as upd,
  has_table_privilege('phf_hr_app', 'task.recurrence_rule_history', 'DELETE')   as del,
  has_table_privilege('phf_hr_app', 'task.recurrence_rule_history', 'TRUNCATE') as trunc;
