begin;

-- PHF KNL (Khung năng lực) Step 1 — Foundation phân quyền độc lập.
-- Namespace hoàn toàn riêng (bảng knl_*), KHÔNG đụng bất kỳ bảng checklist_*.
-- Chỉ phục vụ 2 năng lực đang mở trong Step 1: access_knl, view_people, manage_permissions.
-- Các capability propose/agree_proposal/approve/manage_framework được chuẩn bị sẵn trong
-- jsonb "capabilities" cho tương lai nhưng CHƯA có workflow/scope riêng — không enforce.

create extension if not exists pgcrypto;

create table if not exists public.knl_permission_grants (
  id uuid primary key default gen_random_uuid(),
  account_id text not null,
  employee_code text,
  employee_name text,
  preset_code text not null default 'CUSTOM',
  capabilities jsonb not null default '{}'::jsonb,
  people_scope jsonb not null default '{"type":"self","values":[]}'::jsonb,
  reason text not null,
  is_active boolean not null default true,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  constraint knl_permission_account_ck check (nullif(trim(account_id),'') is not null),
  constraint knl_permission_preset_ck check (preset_code in ('NHAN_VIEN','TRUONG_CA_CHTR','TRUONG_BO_PHAN','TRO_LY_GD','CUSTOM'))
);

-- Mỗi account chỉ có tối đa 1 grant đang hoạt động — Step 1 không có khái niệm
-- hiệu lực theo khoảng ngày (effective_from/to) như checklist_permission_grants,
-- vì nghiệp vụ KNL Step 1 chưa yêu cầu. Đổi quyền = sửa trực tiếp grant đang active
-- (có audit before/after), không tạo dòng mới chồng ngày.
create unique index if not exists knl_permission_account_active_uq
  on public.knl_permission_grants(account_id)
  where is_active = true;

create index if not exists knl_permission_active_idx
  on public.knl_permission_grants(is_active);

create table if not exists public.knl_permission_grant_history (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.knl_permission_grants(id) on delete restrict,
  action text not null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  reason text not null,
  changed_by text,
  changed_by_name text,
  changed_at timestamptz not null default now()
);

create index if not exists knl_permission_history_grant_idx
  on public.knl_permission_grant_history(grant_id,changed_at desc);

alter table public.knl_permission_grants enable row level security;
alter table public.knl_permission_grant_history enable row level security;

revoke all on public.knl_permission_grants from anon, authenticated;
revoke all on public.knl_permission_grant_history from anon, authenticated;

comment on table public.knl_permission_grants is
  'Quyền KNL (Khung năng lực) Step 1: access_knl/view_people/manage_permissions + scope self|sales_all_branches|department|all_company. Độc lập hoàn toàn với checklist_permission_grants.';
comment on table public.knl_permission_grant_history is
  'Nhật ký bất biến trước-sau khi Admin cấp, đổi hoặc ngừng quyền KNL.';

commit;

select preset_code, count(*) as so_quyen
from public.knl_permission_grants
where is_active = true
group by preset_code
order by preset_code;
