-- PHF Checklist 1.36.3
-- Vá tương thích schema cho Cấu hình chu kỳ đánh giá tự động.
-- An toàn khi chạy lặp lại. Không xóa hoặc ghi đè phiếu/thẩm định hiện hữu.

begin;

-- 1) Bảng cấu hình trung tâm: một số môi trường cũ có bảng nhưng thiếu cột chuẩn.
create table if not exists public.checklist_system_settings (
  setting_key text,
  setting_value text,
  description text,
  updated_at timestamptz default now(),
  updated_by text
);

alter table public.checklist_system_settings
  add column if not exists setting_key text,
  add column if not exists setting_value text,
  add column if not exists description text,
  add column if not exists updated_at timestamptz default now(),
  add column if not exists updated_by text;

-- Tương thích dữ liệu từ các tên cột cũ phổ biến nếu có.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='checklist_system_settings' and column_name='key') then
    execute 'update public.checklist_system_settings set setting_key = "key"::text where setting_key is null and "key" is not null';
  elsif exists (select 1 from information_schema.columns where table_schema='public' and table_name='checklist_system_settings' and column_name='setting_name') then
    execute 'update public.checklist_system_settings set setting_key = setting_name::text where setting_key is null and setting_name is not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='checklist_system_settings' and column_name='value') then
    execute 'update public.checklist_system_settings set setting_value = value::text where setting_value is null and value is not null';
  elsif exists (select 1 from information_schema.columns where table_schema='public' and table_name='checklist_system_settings' and column_name='config_value') then
    execute 'update public.checklist_system_settings set setting_value = config_value::text where setting_value is null and config_value is not null';
  end if;
end $$;

create unique index if not exists uq_checklist_system_settings_setting_key
  on public.checklist_system_settings(setting_key)
  where setting_key is not null;

-- 2) Snapshot lịch trên từng kỳ.
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

-- 3) Ngoại lệ theo kỳ.
create table if not exists public.checklist_monthly_period_overrides (
  id uuid primary key default gen_random_uuid(),
  period_month text not null unique,
  self_start_day integer,
  self_end_day integer,
  review_start_day integer,
  review_end_day integer,
  lock_day integer,
  lock_time text,
  reason text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_code text,
  updated_by_name text
);

-- 4) Lịch sử cấu hình.
create table if not exists public.checklist_monthly_cycle_policy_history (
  id uuid primary key default gen_random_uuid(),
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  reason text not null,
  changed_by uuid,
  changed_by_code text,
  changed_by_name text,
  changed_at timestamptz not null default now()
);

alter table public.checklist_monthly_period_overrides enable row level security;
alter table public.checklist_monthly_cycle_policy_history enable row level security;
revoke all on public.checklist_monthly_period_overrides from anon, authenticated;
revoke all on public.checklist_monthly_cycle_policy_history from anon, authenticated;
grant all on public.checklist_monthly_period_overrides to service_role;
grant all on public.checklist_monthly_cycle_policy_history to service_role;

insert into public.checklist_system_settings(setting_key,setting_value,description,updated_at,updated_by)
values (
  'monthly_cycle_policy',
  '{"autoCreateEnabled":true,"sourceMode":"previous_period","createDay":1,"createTime":"00:05","selfStartDay":1,"selfEndDay":3,"reviewStartDay":1,"reviewEndDay":4,"lockDay":4,"lockTime":"23:59","effectiveFromPeriod":"2026-08"}',
  'Chu kỳ tự động phiếu đánh giá tháng',
  now(),
  'PHF Checklist 1.36.3'
)
on conflict (setting_key) do nothing;

create index if not exists idx_checklist_monthly_cycle_history_changed
  on public.checklist_monthly_cycle_policy_history(changed_at desc);
create index if not exists idx_checklist_monthly_periods_schedule
  on public.checklist_monthly_periods(period_month,scheduled_lock_at,status);

commit;

-- Yêu cầu PostgREST/Supabase nạp lại schema ngay để không còn lỗi schema cache.
notify pgrst, 'reload schema';

-- Kiểm tra nhanh sau khi chạy.
select setting_key, setting_value, updated_at
from public.checklist_system_settings
where setting_key='monthly_cycle_policy';

select period_month,status,self_open_at,review_open_at,review_due_at,scheduled_lock_at
from public.checklist_monthly_periods
order by period_month desc
limit 5;
