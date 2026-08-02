-- PHF Checklist 1.38.29 - Index tối ưu danh sách phiếu thẩm định
-- An toàn chạy lặp lại. Không thay đổi dữ liệu hoặc nghiệp vụ.
begin;

create index if not exists idx_checklist_monthly_forms_review_summary
  on public.checklist_monthly_forms(period_month desc, self_submitted_at asc, id)
  where status in ('draft','waiting_self','waiting_review','reviewed','locked');

create index if not exists idx_checklist_monthly_forms_employee_id
  on public.checklist_monthly_forms(employee_id)
  where employee_id is not null and employee_id <> '';

create index if not exists idx_checklist_monthly_forms_employee_code
  on public.checklist_monthly_forms(employee_code)
  where employee_code is not null and employee_code <> '';

analyze public.checklist_monthly_forms;
commit;
