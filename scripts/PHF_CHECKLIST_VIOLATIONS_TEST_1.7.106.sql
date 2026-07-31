begin;
create extension if not exists pgcrypto;

create table if not exists public.checklist_violation_records (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null default '',
  employee_code text not null,
  employee_name text not null default '',
  template_id text not null,
  template_version text not null default '',
  template_name text not null default '',
  criterion_id text not null default '',
  criterion_code text not null,
  criterion_name text not null default '',
  criterion_group text not null default '',
  factor numeric not null default 1,
  points numeric not null default 0,
  occurred_date date not null,
  occurred_time time null,
  location text not null default '',
  note text not null,
  evidence_required boolean not null default false,
  has_evidence boolean not null default false,
  record_status text not null default 'official' check (record_status in ('draft','official','cancelled')),
  is_test boolean not null default false,
  test_batch_id text not null default '',
  created_by text not null default '',
  created_by_name text not null default '',
  created_at timestamptz not null default now()
);

alter table public.checklist_violation_records add column if not exists template_name text not null default '';
alter table public.checklist_violation_records add column if not exists criterion_id text not null default '';
alter table public.checklist_violation_records add column if not exists points numeric not null default 0;
alter table public.checklist_violation_records add column if not exists location text not null default '';
alter table public.checklist_violation_records add column if not exists evidence_required boolean not null default false;
alter table public.checklist_violation_records add column if not exists has_evidence boolean not null default false;

create index if not exists idx_checklist_violation_test on public.checklist_violation_records(is_test,test_batch_id,employee_code);
create index if not exists idx_checklist_violation_employee_date on public.checklist_violation_records(employee_id,occurred_date);
create index if not exists idx_checklist_violation_template_version on public.checklist_violation_records(template_id,template_version);

commit;

select id, employee_code, criterion_code, occurred_date, occurred_time, points, is_test, test_batch_id, created_at
from public.checklist_violation_records
order by created_at desc
limit 20;
