begin;

-- =============================================================================
-- PHF TASK — MAIL CONTRACT V1 · INCREMENT 2 (Weekly Report settings store)
-- Company PostgreSQL phf_hr, schema task.
--
-- REVIEW + THROWAWAY APPLY ONLY. Applied by the deployer against phf_hr_e2e
-- FIRST. NOT for production until Operator GO.
-- DOWN: migrations/phf_hr_task_mail_settings_v1_DOWN.sql
--
-- SCOPE: the Weekly-Report config store ONLY. The transactional outbox
-- (migrations/phf_hr_task_mail_v1.sql) is unchanged. No column of any other
-- table is touched.
--
--   + task.mail_settings    -- singleton config row (id = 1): weekly on/off
--   + task.mail_recipients  -- weekly-report recipient list, admin-managed
--   + GRANT select,insert,update,delete to phf_hr_app
--     (DELETE: a real "Remove recipient" hard-deletes the row — matches the
--      existing task.categories / permission-grant admin convention where an
--      unused config row may be removed; a normal toggle uses is_enabled.)
-- =============================================================================

set local statement_timeout = '30s';
set local lock_timeout = '10s';

create table task.mail_settings (
  id smallint primary key default 1,
  weekly_report_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by_employee_code text,
  updated_by_account_id text,
  constraint task_mail_settings_singleton_ck check (id = 1)
);
insert into task.mail_settings (id) values (1) on conflict (id) do nothing;
comment on table task.mail_settings is 'PHF Task Mail V1 Increment 2 -- singleton config (id=1). weekly_report_enabled default false. Provider/transactional flags live in env, not here.';

create table task.mail_recipients (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  label text,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_employee_code text,
  created_by_account_id text,
  constraint task_mail_recipients_email_ck check (email = lower(trim(email)) and position('@' in email) > 1 and position('.' in email) > 1)
);
create unique index task_mail_recipients_email_uq on task.mail_recipients(email);
comment on table task.mail_recipients is 'PHF Task Mail V1 Increment 2 -- weekly-report recipients, 100% admin-managed. Email stored normalised lower(trim()). No names/emails hardcoded in source.';

grant select, insert, update, delete on task.mail_settings to phf_hr_app;
grant select, insert, update, delete on task.mail_recipients to phf_hr_app;
revoke truncate, references, trigger on task.mail_settings from phf_hr_app;
revoke truncate, references, trigger on task.mail_recipients from phf_hr_app;

do $$
begin
  if not exists (select 1 from task.mail_settings where id = 1) then
    raise exception 'task.mail_settings singleton row missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='task' and indexname='task_mail_recipients_email_uq') then
    raise exception 'task_mail_recipients_email_uq missing';
  end if;
  raise notice 'phf_hr_task_mail_settings_v1: OK';
end $$;

commit;

-- VALIDATION (read-only, run AFTER apply).
select table_name from information_schema.tables where table_schema='task' and table_name in ('mail_settings','mail_recipients') order by table_name;
select weekly_report_enabled from task.mail_settings where id = 1;
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='task.mail_recipients'::regclass order by conname;
select grantee, string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.role_table_grants
 where table_schema='task' and table_name in ('mail_settings','mail_recipients')
 group by grantee order by grantee;
