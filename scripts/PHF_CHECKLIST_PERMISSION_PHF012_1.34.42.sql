begin;

-- 1) Dừng mọi quyền ghi lỗi cũ đang hiệu lực của đúng tài khoản Thắng/PHF012,
--    tránh hai bản quyền chồng nhau. Không ảnh hưởng quyền của tài khoản khác.
update public.checklist_permission_grants
set is_active = false,
    effective_to = current_date,
    updated_by = 'PHF-ADMIN',
    updated_by_name = 'Admin PHF',
    updated_at = now()
where is_active = true
  and (account_id = 'acct-1783590095189' or upper(trim(coalesce(employee_code,''))) = 'PHF012')
  and coalesce((capabilities->>'record_violation')::boolean,false) = true;

-- 2) Cấp đúng quyền đã chốt: Thắng chỉ ghi lỗi cho nhân viên quản lý trực tiếp.
insert into public.checklist_permission_grants (
  account_id, employee_code, employee_name, preset_code, capabilities,
  view_scope, review_scope, record_scope, export_scope,
  effective_from, effective_to, reason, is_active,
  created_by, created_by_name, updated_by, updated_by_name
) values (
  'acct-1783590095189', 'PHF012', 'Lê Vĩnh Thắng', 'TUY_CHINH',
  '{"view_monthly":true,"view_violations":true,"view_reports":true,"export_data":false,"review_monthly":true,"record_violation":true}'::jsonb,
  '{"type":"direct_reports","values":[]}'::jsonb,
  '{"type":"direct_reports","values":[]}'::jsonb,
  '{"type":"direct_reports","values":[]}'::jsonb,
  '{"type":"none","values":[]}'::jsonb,
  current_date, null,
  'Cấp quyền ghi nhận lỗi theo nhân viên quản lý trực tiếp cho PHF012', true,
  'PHF-ADMIN', 'Admin PHF', 'PHF-ADMIN', 'Admin PHF'
)
on conflict (account_id, effective_from) where account_id is not null
do update set
  employee_code = excluded.employee_code,
  employee_name = excluded.employee_name,
  preset_code = excluded.preset_code,
  capabilities = excluded.capabilities,
  view_scope = excluded.view_scope,
  review_scope = excluded.review_scope,
  record_scope = excluded.record_scope,
  export_scope = excluded.export_scope,
  effective_to = null,
  reason = excluded.reason,
  is_active = true,
  updated_by = excluded.updated_by,
  updated_by_name = excluded.updated_by_name,
  updated_at = now();

commit;

-- 3) Kiểm tra sau khi chạy: phải trả đúng 1 bản quyền ghi lỗi direct_reports.
select account_id, employee_code, employee_name, capabilities, record_scope,
       effective_from, effective_to, is_active
from public.checklist_permission_grants
where is_active = true
  and (account_id = 'acct-1783590095189' or upper(trim(coalesce(employee_code,''))) = 'PHF012')
order by effective_from desc, updated_at desc;

-- 4) Kiểm tra nguồn cấp dưới. PHF078 phải xuất hiện trước khi test ghi nhận.
select employee_code, employee_name, manager_code, manager_name, employee_status,
       template_id, template_version, effective_date
from public.checklist_employee_assignments
where upper(trim(coalesce(manager_code,''))) = 'PHF012'
order by employee_name;
