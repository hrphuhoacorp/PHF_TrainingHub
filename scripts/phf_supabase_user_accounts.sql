-- PHF Training Hub
-- BƯỚC 1: Tạo bảng tài khoản dùng chung cho Vercel + Supabase
--
-- Mục tiêu:
-- - Không còn phụ thuộc private/accounts.json trên Vercel.
-- - Chỉ backend dùng SUPABASE_SECRET_KEY mới đọc/ghi tài khoản.
-- - Mật khẩu chỉ lưu dạng PBKDF2 hash + salt, không lưu mật khẩu rõ.
--
-- Có thể chạy lại nhiều lần.

begin;

create table if not exists public.user_accounts (
  id text primary key,
  employee_id text null references public.employees(id) on delete set null,
  employee_code text not null default '',
  name text not null,
  email text not null,
  phone text not null default '',
  role text not null default 'learner',
  status text not null default 'active',
  branch text not null default '',
  department text not null default '',
  position text not null default '',
  training_audience text not null default '',
  default_program text not null default '',
  hub_assignment_status text not null default 'not_activated',
  must_change_password boolean not null default false,

  password_algorithm text not null default 'pbkdf2-sha256',
  password_iterations integer not null default 120000,
  password_salt text not null,
  password_hash text not null,

  last_login_at timestamptz null,
  password_changed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,

  constraint user_accounts_email_not_blank
    check (length(trim(email)) > 0),
  constraint user_accounts_name_not_blank
    check (length(trim(name)) > 0),
  constraint user_accounts_role_valid
    check (role in ('learner', 'manager', 'admin')),
  constraint user_accounts_status_valid
    check (status in ('active', 'locked', 'inactive')),
  constraint user_accounts_hub_assignment_status_valid
    check (hub_assignment_status in ('not_activated','active','paused','completed','revoked')),
  constraint user_accounts_password_iterations_valid
    check (password_iterations >= 100000),
  constraint user_accounts_password_salt_not_blank
    check (length(trim(password_salt)) > 0),
  constraint user_accounts_password_hash_not_blank
    check (length(trim(password_hash)) > 0)
);

-- Email đăng nhập không phân biệt chữ hoa/chữ thường.
create unique index if not exists uq_user_accounts_email_lower
  on public.user_accounts (lower(trim(email)));

create index if not exists idx_user_accounts_employee_id
  on public.user_accounts(employee_id);

create index if not exists idx_user_accounts_phone
  on public.user_accounts(phone);

create index if not exists idx_user_accounts_role_status
  on public.user_accounts(role, status);

create or replace function public.phf_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_accounts_updated_at
  on public.user_accounts;

create trigger trg_user_accounts_updated_at
before update on public.user_accounts
for each row
execute function public.phf_touch_updated_at();

-- Không cho trình duyệt dùng anon/authenticated key đọc trực tiếp bảng tài khoản.
alter table public.user_accounts enable row level security;

revoke all on table public.user_accounts from anon;
revoke all on table public.user_accounts from authenticated;

-- Không tạo policy công khai.
-- Backend dùng SUPABASE_SECRET_KEY/service-role sẽ truy cập được.

commit;

select
  count(*) as total_accounts,
  count(*) filter (where role = 'admin') as admin_accounts,
  count(*) filter (where role = 'manager') as manager_accounts,
  count(*) filter (where role = 'learner') as learner_accounts
from public.user_accounts;
