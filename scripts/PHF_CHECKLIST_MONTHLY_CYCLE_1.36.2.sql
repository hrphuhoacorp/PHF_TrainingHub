begin;

alter table public.checklist_monthly_periods
  add column if not exists cycle_policy_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists source_period_month text,
  add column if not exists auto_created boolean not null default false,
  add column if not exists synced_at timestamptz,
  add column if not exists self_open_at timestamptz,
  add column if not exists self_due_at timestamptz,
  add column if not exists review_open_at timestamptz,
  add column if not exists review_due_at timestamptz,
  add column if not exists scheduled_lock_at timestamptz;

create table if not exists public.checklist_monthly_period_overrides(
  id uuid primary key default gen_random_uuid(),
  period_month text not null unique check(period_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  self_start_day smallint check(self_start_day between 1 and 28),
  self_end_day smallint check(self_end_day between 1 and 28),
  review_start_day smallint check(review_start_day between 1 and 28),
  review_end_day smallint check(review_end_day between 1 and 28),
  lock_day smallint check(lock_day between 1 and 28),
  lock_time text check(lock_time is null or lock_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  reason text not null check(length(trim(reason))>=10),
  updated_at timestamptz not null default now(),
  updated_by text,
  updated_by_code text,
  updated_by_name text
);

create table if not exists public.checklist_monthly_cycle_policy_history(
  id uuid primary key default gen_random_uuid(),
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  reason text not null,
  changed_by text,
  changed_by_code text,
  changed_by_name text,
  changed_at timestamptz not null default now()
);

alter table public.checklist_monthly_period_overrides enable row level security;
alter table public.checklist_monthly_cycle_policy_history enable row level security;
revoke all on public.checklist_monthly_period_overrides from anon,authenticated;
revoke all on public.checklist_monthly_cycle_policy_history from anon,authenticated;
grant all on public.checklist_monthly_period_overrides to service_role;
grant all on public.checklist_monthly_cycle_policy_history to service_role;

insert into public.checklist_system_settings(setting_key,setting_value,description,updated_at,updated_by)
values(
 'monthly_cycle_policy',
 '{"autoCreateEnabled":true,"sourceMode":"previous_period","createDay":1,"createTime":"00:05","selfStartDay":1,"selfEndDay":3,"reviewStartDay":1,"reviewEndDay":4,"lockDay":4,"lockTime":"23:59","effectiveFromPeriod":"2026-08"}',
 'Chu kỳ tự động tạo phiếu, tự đánh giá, thẩm định và khóa kỳ',
 now(),
 'PHF Checklist 1.36.2'
)
on conflict(setting_key) do nothing;

create index if not exists idx_checklist_monthly_periods_scheduled_lock
  on public.checklist_monthly_periods(status,scheduled_lock_at);
create index if not exists idx_checklist_monthly_cycle_history_changed
  on public.checklist_monthly_cycle_policy_history(changed_at desc);

comment on column public.checklist_monthly_periods.review_open_at is 'Mốc bắt đầu cho phép thao tác thẩm định của kỳ (Asia/Ho_Chi_Minh).';
comment on column public.checklist_monthly_periods.review_due_at is 'Mốc kết thúc cửa sổ thẩm định của kỳ.';
comment on table public.checklist_monthly_period_overrides is 'Ngoại lệ lịch tự đánh giá/thẩm định/khóa cho từng kỳ; không thay đổi mặc định các kỳ sau.';

commit;

-- ROLLBACK THAM KHẢO (chỉ dùng khi chưa phát sinh dữ liệu):
-- drop table if exists public.checklist_monthly_cycle_policy_history;
-- drop table if exists public.checklist_monthly_period_overrides;
-- delete from public.checklist_system_settings where setting_key='monthly_cycle_policy';
