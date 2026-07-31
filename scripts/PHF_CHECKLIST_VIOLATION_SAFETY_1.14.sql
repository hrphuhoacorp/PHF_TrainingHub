begin;
create extension if not exists pgcrypto;

alter table public.checklist_violation_records
  add column if not exists duplicate_fingerprint text;

-- Bổ sung dấu vân tay cho dữ liệu cũ để chống trùng có hiệu lực ngay sau khi nâng cấp.
update public.checklist_violation_records
set duplicate_fingerprint = encode(
  digest(
    upper(trim(coalesce(employee_code,''))) || '|' ||
    upper(trim(coalesce(criterion_code,''))) || '|' ||
    coalesce(to_char(occurred_date,'YYYY-MM-DD'),'') || '|' ||
    left(coalesce(occurred_time::text,''),5) || '|' ||
    lower(regexp_replace(trim(coalesce(location,'')), '\s+', ' ', 'g')) || '|' ||
    lower(regexp_replace(trim(coalesce(note,'')), '\s+', ' ', 'g')),
    'sha256'
  ),
  'hex'
)
where duplicate_fingerprint is null or duplicate_fingerprint = '';

create index if not exists idx_checklist_violation_duplicate_fingerprint
on public.checklist_violation_records(duplicate_fingerprint)
where duplicate_fingerprint is not null and record_status <> 'cancelled';

-- Chỉ tạo khóa duy nhất khi dữ liệu hiện hữu không có trùng đang hiệu lực.
do $$
begin
  if not exists (
    select 1
    from public.checklist_violation_records
    where duplicate_fingerprint is not null
      and record_status <> 'cancelled'
    group by duplicate_fingerprint
    having count(*) > 1
  ) then
    execute 'create unique index if not exists uq_checklist_violation_active_fingerprint
             on public.checklist_violation_records(duplicate_fingerprint)
             where duplicate_fingerprint is not null and record_status <> ''cancelled''';
  else
    raise notice 'Chưa tạo unique index vì đang có dữ liệu trùng cũ. Xem truy vấn đối soát cuối script.';
  end if;
end $$;

create table if not exists public.checklist_violation_permissions (
  id uuid primary key default gen_random_uuid(),
  account_id text not null default '',
  employee_code text not null default '',
  can_record boolean not null default false,
  can_view_history boolean not null default false,
  can_edit_test boolean not null default false,
  can_cancel boolean not null default false,
  scope_type text not null default 'none' check (scope_type in ('none','all','branch','employee')),
  scope_values jsonb not null default '[]'::jsonb,
  effective_from date not null default current_date,
  effective_to date,
  is_active boolean not null default true,
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create index if not exists idx_checklist_violation_permissions_account
on public.checklist_violation_permissions(account_id,is_active,effective_from,effective_to);

create index if not exists idx_checklist_violation_permissions_employee
on public.checklist_violation_permissions(employee_code,is_active,effective_from,effective_to);

-- Admin vẫn được backend cấp toàn quyền mặc định; không cần tạo dòng quyền cho Admin.
-- Chỉ thêm dòng ở bảng này khi mở quyền cho Quản lý/Nhân sự khác.

commit;

select duplicate_fingerprint,
       count(*) as duplicate_count,
       string_agg(employee_code || ' · ' || criterion_code || ' · ' || occurred_date::text, '; ') as records
from public.checklist_violation_records
where duplicate_fingerprint is not null
  and record_status <> 'cancelled'
group by duplicate_fingerprint
having count(*) > 1
order by duplicate_count desc;
