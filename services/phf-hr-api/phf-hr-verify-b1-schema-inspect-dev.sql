-- =============================================================================
-- PHF HR — PHASE B1.2: READ-ONLY schema inventory of phf_hr.task
--
-- Chạy bằng: psql -d phf_hr -f phf-hr-verify-b1-schema-inspect-dev.sql
-- (hoặc psql -U postgres -d phf_hr, tuỳ session admin đang dùng)
--
-- TUYỆT ĐỐI READ-ONLY — không có statement ghi/đổi nào trong file này.
-- Dán TOÀN BỘ output lại để so sánh parity với phf_hr_verify sau khi build.
-- =============================================================================

select '=== TABLES ===' as section;
select table_name
from information_schema.tables
where table_schema = 'task'
order by table_name;

select '=== COLUMNS ===' as section;
select table_name, column_name, data_type, udt_name, character_maximum_length,
       is_nullable, column_default, ordinal_position
from information_schema.columns
where table_schema = 'task'
order by table_name, ordinal_position;

select '=== PRIMARY/UNIQUE KEYS ===' as section;
select tc.table_name, tc.constraint_name, tc.constraint_type,
       string_agg(kcu.column_name, ',' order by kcu.ordinal_position) as columns
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
where tc.table_schema = 'task' and tc.constraint_type in ('PRIMARY KEY','UNIQUE')
group by tc.table_name, tc.constraint_name, tc.constraint_type
order by tc.table_name, tc.constraint_type;

select '=== FOREIGN KEYS ===' as section;
select tc.table_name, tc.constraint_name,
       kcu.column_name, ccu.table_name as references_table, ccu.column_name as references_column
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
join information_schema.constraint_column_usage ccu on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
where tc.table_schema = 'task' and tc.constraint_type = 'FOREIGN KEY'
order by tc.table_name;

select '=== CHECK CONSTRAINTS ===' as section;
select tc.table_name, tc.constraint_name, cc.check_clause
from information_schema.table_constraints tc
join information_schema.check_constraints cc
  on tc.constraint_name = cc.constraint_name and tc.table_schema = cc.constraint_schema
where tc.table_schema = 'task' and tc.constraint_type = 'CHECK'
order by tc.table_name, tc.constraint_name;

select '=== INDEXES ===' as section;
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'task'
order by tablename, indexname;

select '=== SEQUENCES ===' as section;
select sequence_name, data_type, start_value, increment
from information_schema.sequences
where sequence_schema = 'task'
order by sequence_name;

select '=== FUNCTIONS/PROCEDURES ===' as section;
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'task'
order by p.proname;

select '=== TRIGGERS ===' as section;
select event_object_table, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers
where trigger_schema = 'task'
order by event_object_table, trigger_name;

select '=== TABLE OWNERSHIP ===' as section;
select schemaname, tablename, tableowner
from pg_tables
where schemaname = 'task'
order by tablename;

select '=== SCHEMA/TABLE GRANTS (role phf_hr_app, phf_hr_owner, phf_hr_runtime) ===' as section;
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'task' and grantee in ('phf_hr_app','phf_hr_owner','phf_hr_runtime','public')
order by table_name, grantee, privilege_type;

select '=== SCHEMA-LEVEL USAGE GRANT ===' as section;
select nspname, r.rolname as grantee,
       has_schema_privilege(r.rolname, 'task', 'USAGE') as has_usage,
       has_schema_privilege(r.rolname, 'task', 'CREATE') as has_create
from pg_namespace n, pg_roles r
where n.nspname = 'task' and r.rolname in ('phf_hr_app','phf_hr_owner','phf_hr_runtime');

select '=== ROW COUNTS (sanity, read-only) ===' as section;
select 'categories' as t, count(*) from task.categories
union all select 'tasks', count(*) from task.tasks
union all select 'assignees', count(*) from task.assignees
union all select 'events', count(*) from task.events
union all select 'comments', count(*) from task.comments
union all select 'links', count(*) from task.links
union all select 'permission_grants', count(*) from task.permission_grants
union all select 'permission_grant_history', count(*) from task.permission_grant_history
union all select 'permission_assignments', count(*) from task.permission_assignments
union all select 'permission_assignment_history', count(*) from task.permission_assignment_history
union all select 'notifications', count(*) from task.notifications
union all select 'code_counters', count(*) from task.code_counters
union all select 'attachments', count(*) from task.attachments;

select '=== PG VERSION ===' as section;
select version();
