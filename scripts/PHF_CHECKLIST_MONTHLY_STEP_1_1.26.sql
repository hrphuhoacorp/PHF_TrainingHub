begin;
create extension if not exists pgcrypto;
create table if not exists public.checklist_monthly_periods(
 id uuid primary key default gen_random_uuid(), period_month text not null unique check(period_month ~ '^\d{4}-\d{2}$'),
 status text not null default 'draft' check(status in('draft','open','locked')), created_by text,created_by_name text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists public.checklist_monthly_forms(
 id uuid primary key default gen_random_uuid(),period_id uuid not null references public.checklist_monthly_periods(id) on delete restrict,
 period_month text not null,employee_id text not null,employee_code text not null,employee_name text not null,
 department text not null default '',title text not null default '',branch text not null default '',
 reviewer_id text not null default '',reviewer_code text not null default '',reviewer_name text not null default '',
 template_id text not null,template_version text not null,template_snapshot jsonb not null default '{}'::jsonb,
 checklist_score numeric(7,2) not null default 100,status text not null default 'waiting_self'
 check(status in('waiting_self','waiting_review','locked','cancelled')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(period_month,employee_code));
create index if not exists checklist_monthly_forms_period_idx on public.checklist_monthly_forms(period_month,status);
alter table public.checklist_monthly_periods enable row level security;
alter table public.checklist_monthly_forms enable row level security;
revoke all on public.checklist_monthly_periods from anon,authenticated;
revoke all on public.checklist_monthly_forms from anon,authenticated;
commit;
