begin;

create extension if not exists pgcrypto;

create table if not exists public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  code text not null unique,
  name text not null,
  group_name text not null default '',
  template_type text not null default 'checklist_detail' check (template_type in ('checklist_detail','score_summary')),
  has_checklist boolean not null default true,
  source text not null default '',
  note text not null default '',
  status text not null default 'active',
  current_version text not null,
  effective_date date not null,
  created_by text not null default '',
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checklist_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_key text not null references public.checklist_templates(template_key) on update cascade on delete restrict,
  version_no text not null,
  effective_date date not null,
  reason text not null,
  source_version text not null default '',
  change_type text not null default 'sync',
  definition jsonb not null default '{"groups":[],"totalRows":[],"templateType":"checklist_detail"}'::jsonb,
  created_by text not null default '',
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  unique(template_key,version_no)
);

create index if not exists idx_checklist_templates_status on public.checklist_templates(status);
create index if not exists idx_checklist_template_versions_key_created on public.checklist_template_versions(template_key,created_at desc);

alter table public.checklist_templates enable row level security;
alter table public.checklist_template_versions enable row level security;

comment on table public.checklist_templates is 'Thư viện mẫu Checklist hiện hành; ứng dụng ghi qua backend service role.';
comment on table public.checklist_template_versions is 'Các phiên bản bất biến của từng mẫu Checklist, gồm định nghĩa JSON và lịch sử phát hành.';

commit;
