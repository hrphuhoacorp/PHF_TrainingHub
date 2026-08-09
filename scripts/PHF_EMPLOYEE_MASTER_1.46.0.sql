-- PHF HR 1.46.0 - Employee Master (additive, service-role only)
-- Rollback an toan (chi khi CHUA co du lieu can giu): drop theo thu tu
-- employee_master_history -> employee_compensation -> employee_contracts
-- -> employee_private_profiles -> employee_profiles. Khong dong user_accounts/employees.

begin;
create extension if not exists pgcrypto;

create or replace function public.phf_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create table if not exists public.employee_profiles (
  id uuid primary key default gen_random_uuid(),
  employee_id text null references public.employees(id) on delete set null,
  employee_code text not null default '',
  full_name text not null default '',
  employment_status text not null default 'active',
  avatar_url text not null default '',
  birth_date date null,
  gender text not null default '',
  phone text not null default '',
  work_email text not null default '',
  personal_email text not null default '',
  hire_date date null,
  official_date date null,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_profiles_identity_required check (
    length(trim(coalesce(employee_id,''))) > 0 or length(trim(employee_code)) > 0
  )
);
create unique index if not exists uq_employee_profiles_employee_id
  on public.employee_profiles(employee_id) where employee_id is not null and trim(employee_id) <> '';
create unique index if not exists uq_employee_profiles_employee_code
  on public.employee_profiles(lower(trim(employee_code))) where trim(employee_code) <> '';
create index if not exists idx_employee_profiles_name on public.employee_profiles(lower(full_name));

create table if not exists public.employee_private_profiles (
  employee_profile_id uuid primary key references public.employee_profiles(id) on delete cascade,
  citizen_id text not null default '',
  citizen_issued_date date null,
  citizen_issued_place text not null default '',
  citizen_expiry_date date null,
  permanent_address text not null default '',
  current_address text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_contracts (
  id uuid primary key default gen_random_uuid(),
  employee_profile_id uuid not null references public.employee_profiles(id) on delete restrict,
  contract_type text not null default '',
  contract_number text not null default '',
  signed_date date null,
  effective_date date null,
  expiry_date date null,
  contract_status text not null default 'active',
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_employee_contracts_profile_effective
  on public.employee_contracts(employee_profile_id,effective_date desc,created_at desc);
create unique index if not exists uq_employee_contract_number
  on public.employee_contracts(employee_profile_id,lower(trim(contract_number)))
  where trim(contract_number) <> '';

create table if not exists public.employee_compensation (
  id uuid primary key default gen_random_uuid(),
  employee_profile_id uuid not null references public.employee_profiles(id) on delete restrict,
  base_salary numeric(16,2) not null default 0,
  allowances numeric(16,2) not null default 0,
  currency text not null default 'VND',
  effective_from date not null,
  effective_to date null,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_compensation_non_negative check (base_salary >= 0 and allowances >= 0),
  constraint employee_compensation_period_valid check (effective_to is null or effective_to >= effective_from)
);
create index if not exists idx_employee_compensation_profile_effective
  on public.employee_compensation(employee_profile_id,effective_from desc,created_at desc);
create unique index if not exists uq_employee_compensation_profile_start
  on public.employee_compensation(employee_profile_id,effective_from);

create table if not exists public.employee_master_history (
  id uuid primary key default gen_random_uuid(),
  employee_profile_id uuid not null references public.employee_profiles(id) on delete restrict,
  domain text not null,
  action text not null,
  before_data jsonb null,
  after_data jsonb null,
  reason text not null default '',
  changed_by text not null default '',
  changed_by_name text not null default '',
  changed_at timestamptz not null default now()
);
create index if not exists idx_employee_master_history_profile_changed
  on public.employee_master_history(employee_profile_id,changed_at desc);

drop trigger if exists trg_employee_profiles_updated_at on public.employee_profiles;
create trigger trg_employee_profiles_updated_at before update on public.employee_profiles
for each row execute function public.phf_touch_updated_at();
drop trigger if exists trg_employee_private_profiles_updated_at on public.employee_private_profiles;
create trigger trg_employee_private_profiles_updated_at before update on public.employee_private_profiles
for each row execute function public.phf_touch_updated_at();
drop trigger if exists trg_employee_contracts_updated_at on public.employee_contracts;
create trigger trg_employee_contracts_updated_at before update on public.employee_contracts
for each row execute function public.phf_touch_updated_at();
drop trigger if exists trg_employee_compensation_updated_at on public.employee_compensation;
create trigger trg_employee_compensation_updated_at before update on public.employee_compensation
for each row execute function public.phf_touch_updated_at();

alter table public.employee_profiles enable row level security;
alter table public.employee_private_profiles enable row level security;
alter table public.employee_contracts enable row level security;
alter table public.employee_compensation enable row level security;
alter table public.employee_master_history enable row level security;
revoke all on table public.employee_profiles from anon,authenticated;
revoke all on table public.employee_private_profiles from anon,authenticated;
revoke all on table public.employee_contracts from anon,authenticated;
revoke all on table public.employee_compensation from anon,authenticated;
revoke all on table public.employee_master_history from anon,authenticated;

commit;
