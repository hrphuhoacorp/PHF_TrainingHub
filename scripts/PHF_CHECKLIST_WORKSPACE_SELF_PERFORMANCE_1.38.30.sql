-- PHF Checklist 1.38.30 - Index tối ưu Workspace Ghi nhận lỗi và Phiếu của tôi
-- An toàn chạy lặp lại. Không thay đổi dữ liệu hoặc nghiệp vụ.
begin;

create index if not exists idx_checklist_monthly_forms_self_employee_code_period
  on public.checklist_monthly_forms(employee_code, period_month desc)
  where status in ('waiting_self','waiting_review','reviewed','locked');

create index if not exists idx_checklist_monthly_forms_self_employee_id_period
  on public.checklist_monthly_forms(employee_id, period_month desc)
  where status in ('waiting_self','waiting_review','reviewed','locked');

create index if not exists idx_checklist_violation_records_live_employee_date
  on public.checklist_violation_records(employee_code, occurred_date)
  where is_test = false and record_status = 'official';

create index if not exists idx_checklist_monthly_form_history_form_changed
  on public.checklist_monthly_form_history(form_id, changed_at);

create index if not exists idx_checklist_template_versions_current_lookup
  on public.checklist_template_versions(template_key, version_no);

analyze public.checklist_monthly_forms;
analyze public.checklist_violation_records;
analyze public.checklist_monthly_form_history;
analyze public.checklist_template_versions;
commit;
