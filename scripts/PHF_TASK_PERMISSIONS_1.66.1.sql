begin;

-- PHF Task V1 — Batch 1: Permission exception schema.
-- task_permission_grants CHỈ dùng để MỞ RỘNG (extend) / HẠN CHẾ (restrict) /
-- ỦY QUYỀN TẠM THỜI (delegation) trên nền base scope suy trực tiếp từ HR
-- (xem lib/task-employee-scope.js + lib/task-permissions.js). KHÔNG dùng bảng
-- này để dựng lại Organization Master, KHÔNG phải nguồn định nghĩa actor type
-- (khác knl_permission_grants — nơi preset_code chính là nguồn gán quyền).
--
-- delegation bắt buộc effective_to (Correction Gate mục 1.2) — extend/restrict
-- được phép vô thời hạn nếu Admin chủ động chọn (không tự ép expiry).
-- Nhiều grant active cùng lúc trên 1 người là hợp lệ (VD vừa có 1 extend vừa
-- có 1 restrict) — KHÔNG unique theo grantee như knl_permission_grants.

create extension if not exists pgcrypto;

create table if not exists public.task_permission_grants (
  id uuid primary key default gen_random_uuid(),
  grantee_employee_code text not null,
  grant_type text not null,
  people_scope jsonb not null default '{"type":"self","values":[]}'::jsonb,
  capabilities jsonb not null default '{}'::jsonb,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  reason text not null,
  is_active boolean not null default true,
  created_by_employee_code text not null,
  created_at timestamptz not null default now(),
  updated_by_employee_code text,
  updated_at timestamptz not null default now(),
  constraint task_permission_grantee_ck check (nullif(trim(grantee_employee_code), '') is not null),
  constraint task_permission_grant_type_ck check (grant_type in ('extend', 'restrict', 'delegation')),
  constraint task_permission_reason_ck check (nullif(trim(reason), '') is not null),
  constraint task_permission_created_by_ck check (nullif(trim(created_by_employee_code), '') is not null),
  -- delegation KHÔNG được vô thời hạn (mục 5/Correction Gate 1.2); extend/restrict thì được.
  constraint task_permission_delegation_window_ck check (grant_type <> 'delegation' or effective_to is not null),
  constraint task_permission_window_order_ck check (effective_to is null or effective_to > effective_from)
);

create index if not exists task_permission_grantee_active_idx
  on public.task_permission_grants(grantee_employee_code)
  where is_active = true;

create index if not exists task_permission_effective_window_idx
  on public.task_permission_grants(effective_from, effective_to);

create table if not exists public.task_permission_grant_history (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.task_permission_grants(id) on delete restrict,
  changed_field text not null,
  old_value jsonb,
  new_value jsonb,
  changed_by_employee_code text not null,
  changed_at timestamptz not null default now(),
  reason text not null,
  constraint task_permission_history_field_ck check (nullif(trim(changed_field), '') is not null),
  constraint task_permission_history_changed_by_ck check (nullif(trim(changed_by_employee_code), '') is not null),
  constraint task_permission_history_reason_ck check (nullif(trim(reason), '') is not null)
);

create index if not exists task_permission_history_grant_idx
  on public.task_permission_grant_history(grant_id, changed_at desc);

-- task_forbid_update_delete() được định nghĩa ở PHF_TASK_FOUNDATION_1.66.0.sql —
-- migration này PHẢI chạy sau foundation. Áp dụng cho lịch sử grant (append-only).
drop trigger if exists task_permission_grant_history_forbid_update on public.task_permission_grant_history;
create trigger task_permission_grant_history_forbid_update before update on public.task_permission_grant_history
  for each row execute function public.task_forbid_update_delete();
drop trigger if exists task_permission_grant_history_forbid_delete on public.task_permission_grant_history;
create trigger task_permission_grant_history_forbid_delete before delete on public.task_permission_grant_history
  for each row execute function public.task_forbid_update_delete();

alter table public.task_permission_grants enable row level security;
alter table public.task_permission_grant_history enable row level security;

revoke all on public.task_permission_grants from anon, authenticated;
revoke all on public.task_permission_grant_history from anon, authenticated;

comment on table public.task_permission_grants is
  'PHF Task — ngoại lệ scope/capability (extend|restrict|delegation) chồng lên base scope suy từ HR. KHÔNG phải nguồn định nghĩa actor type.';
comment on table public.task_permission_grant_history is
  'PHF Task — nhật ký bất biến trước-sau mỗi lần tạo/sửa/thu hồi task_permission_grants (chặn UPDATE/DELETE ở DB level qua trigger).';

commit;

select grant_type, count(*) as so_luong
from public.task_permission_grants
group by grant_type
order by grant_type;
