-- PHF Training Hub - Bản 27.0
-- Hồ sơ thử việc chính thức + trạng thái thông báo hệ thống.
-- Chạy trong Supabase SQL Editor. Có thể chạy lại nhiều lần.

create table if not exists public.probation_records (
  id text primary key,
  employee_id text not null unique references public.employees(id) on delete cascade,
  expected_end_date date,
  status text not null default 'in_progress',
  conclusion text,
  proposed_by text,
  proposed_at timestamptz,
  confirmed_by text,
  confirmed_at timestamptz,
  extension_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_probation_records_status
  on public.probation_records(status);

create index if not exists idx_probation_records_expected_end
  on public.probation_records(expected_end_date);

create table if not exists public.system_notifications (
  id text primary key,
  employee_id text references public.employees(id) on delete cascade,
  target_role text not null default 'manager',
  notification_type text not null,
  title text not null,
  message text not null,
  priority text not null default 'normal',
  status text not null default 'new',
  due_at timestamptz,
  source_type text,
  source_id text,
  read_at timestamptz,
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_system_notifications_target_role
  on public.system_notifications(target_role, status);

create index if not exists idx_system_notifications_employee
  on public.system_notifications(employee_id, status);

-- Ngày bắt đầu thử việc chính thức lấy từ employees.study_start_date.
-- Ngày kết thúc dự kiến mặc định = ngày bắt đầu + 59 ngày (chu kỳ 60 ngày).
insert into public.probation_records (
  id, employee_id, expected_end_date, status, created_at, updated_at, metadata
)
select
  'probation-' || e.id,
  e.id,
  case
    when e.study_start_date is not null
      then (e.study_start_date::date + interval '59 day')::date
    else null
  end,
  case
    when e.study_start_date is null then 'missing_start'
    else 'in_progress'
  end,
  now(),
  now(),
  jsonb_build_object(
    'startSource', 'employees.study_start_date',
    'defaultDurationDays', 60
  )
from public.employees e
on conflict (employee_id)
do update set
  expected_end_date = coalesce(
    public.probation_records.expected_end_date,
    excluded.expected_end_date
  ),
  status = case
    when public.probation_records.status is null
      then excluded.status
    else public.probation_records.status
  end,
  updated_at = now(),
  metadata = public.probation_records.metadata || excluded.metadata;

select
  (select count(*) from public.probation_records) as probation_records_total,
  (select count(*) from public.system_notifications) as notification_states_total;
