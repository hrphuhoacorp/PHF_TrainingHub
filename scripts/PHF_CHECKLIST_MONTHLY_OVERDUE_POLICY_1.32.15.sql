begin;

create table if not exists public.checklist_monthly_policy_history(
  id uuid primary key default gen_random_uuid(),
  setting_key text not null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  reason text not null,
  changed_by text,
  changed_by_code text,
  changed_by_name text,
  changed_at timestamptz not null default now()
);
create index if not exists checklist_monthly_policy_history_key_idx on public.checklist_monthly_policy_history(setting_key,changed_at desc);
alter table public.checklist_monthly_policy_history enable row level security;
revoke all on public.checklist_monthly_policy_history from anon,authenticated;
insert into public.checklist_system_settings(setting_key,setting_value,description,updated_at,updated_by) values ('monthly_self_overdue_policy','{"mode":"max","effectiveFromPeriod":"2026-08","selfDueDay":2}','Cách xử lý phiếu tháng chưa tự đánh giá đúng hạn',now(),'PHF Checklist 1.32.15') on conflict(setting_key) do nothing;
commit;
