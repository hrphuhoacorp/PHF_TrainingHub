-- PHF Training Hub - Bản 40.2
-- Tách Đối tượng đào tạo khỏi Trạng thái phân công Training Hub.
-- Có thể chạy lại: dữ liệu mặc định chỉ được gán trong lần đầu thêm cột.

begin;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_accounts'
      and column_name = 'hub_assignment_status'
  ) then
    alter table public.user_accounts
      add column hub_assignment_status text not null default 'not_activated';

    update public.user_accounts
    set hub_assignment_status = case
      when coalesce((metadata->>'accountType'),'employee') = 'system_admin' then 'not_activated'
      when role = 'learner' and trim(training_audience) = 'Nhân sự mới' then 'active'
      else 'not_activated'
    end;
  end if;
end $$;

alter table public.user_accounts
  drop constraint if exists user_accounts_hub_assignment_status_valid;

alter table public.user_accounts
  add constraint user_accounts_hub_assignment_status_valid
  check (hub_assignment_status in ('not_activated','active','paused','completed','revoked'));

create index if not exists idx_user_accounts_hub_assignment_status
  on public.user_accounts(hub_assignment_status);

commit;
