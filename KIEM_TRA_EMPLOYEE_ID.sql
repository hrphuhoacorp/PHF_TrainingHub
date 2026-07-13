-- CHỈ DÙNG ĐỂ KIỂM TRA SAU KHI ÁP DỤNG BẢN 40.4.10
select
  id,
  employee_id,
  employee_code,
  name,
  email,
  phone,
  role,
  metadata ->> 'accountType' as account_type
from public.user_accounts
order by name;

-- Các tài khoản nhân sự còn chưa liên kết
select
  id,
  employee_code,
  name,
  email,
  phone,
  role
from public.user_accounts
where employee_id is null
  and coalesce(metadata ->> 'accountType', '') <> 'system_admin'
  and lower(coalesce(email, '')) <> 'hr.phuhoacorp@gmail.com'
  and not (
    role = 'admin'
    and coalesce(employee_code, '') = ''
    and coalesce(phone, '') = ''
  )
order by name;
