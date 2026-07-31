-- PHF Checklist 1.22
-- Chạy trong Supabase SQL Editor sau khi đã sao lưu và kiểm tra quyền ghi nhận.
-- Backend là nguồn quyết định duy nhất cho TEST/PRODUCTION.

begin;

insert into public.checklist_system_settings
  (setting_key, setting_value, description, updated_at, updated_by)
values
  (
    'violation_mode',
    'production',
    'production: ghi nhận lỗi chính thức; bản ghi mới có is_test=false',
    now(),
    'Admin PHF - checkpoint 1.22'
  )
on conflict (setting_key) do update
set setting_value = excluded.setting_value,
    description = excluded.description,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

commit;

select setting_key, setting_value, updated_at, updated_by
from public.checklist_system_settings
where setting_key = 'violation_mode';

-- QUAY LẠI TEST nếu cần:
-- update public.checklist_system_settings
-- set setting_value='test', updated_at=now(), updated_by='Admin PHF rollback 1.22'
-- where setting_key='violation_mode';
