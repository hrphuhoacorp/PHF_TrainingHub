begin;

-- PHF Task V1 — canonical initial categories.
-- LOCAL CANDIDATE, CHƯA APPLY PRODUCTION.
--
-- category_code là key kỹ thuật immutable sau khi được sử dụng. Re-run seed
-- không ghi đè display_name/is_active do Admin đã quản trị sau lần apply đầu.
insert into public.task_categories(category_code, display_name, is_active)
values
  ('ROUTINE', 'Công việc thường xuyên', true),
  ('ADHOC', 'Công việc phát sinh', true),
  ('PROJECT_PLAN', 'Dự án / Kế hoạch', true)
on conflict (category_code) do nothing;

commit;
