-- PHF Checklist 1.7.107
-- Cấu hình trung tâm chế độ Ghi nhận lỗi. Mặc định fail-safe = TEST.

create table if not exists public.checklist_system_settings (
  setting_key text primary key,
  setting_value text not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into public.checklist_system_settings(setting_key,setting_value,description,updated_at,updated_by)
values (
  'violation_mode',
  'test',
  'test: chỉ PHF012 và luôn is_test=true; production: ghi dữ liệu chính thức',
  now(),
  'PHF Checklist 1.7.107'
)
on conflict (setting_key) do update
set description=excluded.description,
    updated_at=now(),
    updated_by='PHF Checklist 1.7.107'
where public.checklist_system_settings.setting_value not in ('test','production');

-- Kiểm tra trạng thái hiện tại
select setting_key,setting_value,description,updated_at,updated_by
from public.checklist_system_settings
where setting_key='violation_mode';

-- CHỈ dùng khi đã hoàn tất checklist Go-live và được Admin xác nhận:
-- update public.checklist_system_settings
-- set setting_value='production', updated_at=now(), updated_by='Admin PHF'
-- where setting_key='violation_mode';
