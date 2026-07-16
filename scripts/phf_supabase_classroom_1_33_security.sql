-- PHF Classroom 1.33 - khóa truy cập trực tiếp từ anon/authenticated.
-- Backend PHF dùng service_role nên không bị ảnh hưởng.
begin;

do $$
declare t text;
begin
  foreach t in array array[
    'classroom_assignments','classroom_attendance','classroom_class_history','classroom_classes',
    'classroom_content_groups','classroom_enrollments','classroom_lesson_progress','classroom_lessons',
    'classroom_material_progress','classroom_material_versions','classroom_materials',
    'classroom_notification_recipients','classroom_notifications','classroom_sessions','classroom_settings',
    'classroom_system_audit','classroom_test_assignments','classroom_test_attempts','classroom_tests',
    'classroom_training_proposals'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I enable row level security',t);
      execute format('revoke all on table public.%I from anon, authenticated',t);
    end if;
  end loop;
end $$;

-- Bucket giữ private; client anon/authenticated không được thao tác trực tiếp.
update storage.buckets set public=false where id='phf-classroom';
revoke all on table storage.objects from anon, authenticated;
revoke all on table storage.buckets from anon, authenticated;
commit;
