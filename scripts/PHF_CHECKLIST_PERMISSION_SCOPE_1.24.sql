begin;

create extension if not exists pgcrypto;

create table if not exists public.checklist_permission_grants (
  id uuid primary key default gen_random_uuid(),
  account_id text,
  employee_code text,
  employee_name text,
  preset_code text not null,
  capabilities jsonb not null default '{}'::jsonb,
  view_scope jsonb not null default '{"type":"none","values":[]}'::jsonb,
  review_scope jsonb not null default '{"type":"none","values":[]}'::jsonb,
  record_scope jsonb not null default '{"type":"none","values":[]}'::jsonb,
  export_scope jsonb not null default '{"type":"none","values":[]}'::jsonb,
  effective_from date not null,
  effective_to date,
  reason text not null,
  is_active boolean not null default true,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  constraint checklist_permission_identity_ck check (nullif(trim(account_id),'') is not null or nullif(trim(employee_code),'') is not null),
  constraint checklist_permission_date_ck check (effective_to is null or effective_to >= effective_from),
  constraint checklist_permission_preset_ck check (preset_code in ('TRO_LY_GD','TRUONG_CA_BH','QUAN_LY_TRUC_TIEP','CHI_XEM_BAO_CAO','TUY_CHINH'))
);

create unique index if not exists checklist_permission_account_effective_uq
  on public.checklist_permission_grants(account_id,effective_from)
  where account_id is not null;

create unique index if not exists checklist_permission_employee_effective_uq
  on public.checklist_permission_grants(employee_code,effective_from)
  where account_id is null and employee_code is not null;

create index if not exists checklist_permission_active_idx
  on public.checklist_permission_grants(is_active,effective_from,effective_to);

create table if not exists public.checklist_permission_grant_history (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.checklist_permission_grants(id) on delete restrict,
  action text not null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  reason text not null,
  changed_by text,
  changed_by_name text,
  changed_at timestamptz not null default now()
);

create index if not exists checklist_permission_history_grant_idx
  on public.checklist_permission_grant_history(grant_id,changed_at desc);

alter table public.checklist_permission_grants enable row level security;
alter table public.checklist_permission_grant_history enable row level security;

revoke all on public.checklist_permission_grants from anon, authenticated;
revoke all on public.checklist_permission_grant_history from anon, authenticated;

comment on table public.checklist_permission_grants is
  'Quyền Checklist theo từng năng lực; phạm vi xem không suy ra phạm vi thẩm định.';
comment on table public.checklist_permission_grant_history is
  'Nhật ký bất biến trước-sau khi Admin cấp, đổi hoặc ngừng quyền Checklist.';

commit;

select preset_code, count(*) as so_quyen
from public.checklist_permission_grants
where is_active = true
group by preset_code
order by preset_code;
