begin;
create extension if not exists pgcrypto;

alter table public.checklist_violation_records add column if not exists request_id text;
alter table public.checklist_violation_records add column if not exists updated_by text not null default '';
alter table public.checklist_violation_records add column if not exists updated_by_name text not null default '';
alter table public.checklist_violation_records add column if not exists updated_at timestamptz;
alter table public.checklist_violation_records add column if not exists cancelled_by text not null default '';
alter table public.checklist_violation_records add column if not exists cancelled_by_name text not null default '';
alter table public.checklist_violation_records add column if not exists cancelled_at timestamptz;
alter table public.checklist_violation_records add column if not exists cancel_reason text not null default '';
alter table public.checklist_violation_records add column if not exists change_count integer not null default 0;

create unique index if not exists uq_checklist_violation_request_id
on public.checklist_violation_records(request_id);

create table if not exists public.checklist_violation_record_history (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null,
  employee_code text not null default '',
  action text not null check (action in ('edit','cancel','delete_test','delete_test_batch')),
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  reason text not null default '',
  changed_by text not null default '',
  changed_by_name text not null default '',
  changed_at timestamptz not null default now()
);
create index if not exists idx_checklist_violation_history_record on public.checklist_violation_record_history(record_id,changed_at desc);
create index if not exists idx_checklist_violation_history_employee on public.checklist_violation_record_history(employee_code,changed_at desc);
commit;

select 'checklist_violation_records' as table_name, count(*) as total from public.checklist_violation_records
union all
select 'checklist_violation_record_history', count(*) from public.checklist_violation_record_history;
