-- PHF Checklist 1.7.79 - Trạng thái nhân sự và hiệu lực Checklist
-- Chạy một lần sau PHF_CHECKLIST_ASSIGNMENTS_1.7.77.sql

alter table public.checklist_employee_assignments
  add column if not exists leave_until date,
  add column if not exists status_note text not null default '';

alter table public.checklist_employee_assignment_history
  add column if not exists leave_until date,
  add column if not exists status_note text not null default '';

create or replace function public.phf_save_checklist_assignments(
  p_rows jsonb,
  p_actor_id text default '',
  p_actor_name text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  old_row public.checklist_employee_assignments%rowtype;
  changed_count integer := 0;
  total_count integer := 0;
  key_value text;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  for item in select value from jsonb_array_elements(p_rows)
  loop
    total_count := total_count + 1;
    key_value := lower(trim(coalesce(item->>'employee_key','')));
    if key_value = '' then raise exception 'employee_key is required'; end if;

    select * into old_row from public.checklist_employee_assignments where employee_key = key_value for update;

    if not found or
      row(old_row.employee_id,old_row.employee_code,old_row.employee_name,old_row.department,old_row.title,old_row.branch,old_row.manager_id,old_row.manager_code,old_row.manager_name,old_row.employee_status,old_row.leave_until,old_row.status_note,old_row.template_id,old_row.template_version,old_row.effective_date)
      is distinct from
      row(coalesce(item->>'employee_id',''),coalesce(item->>'employee_code',''),coalesce(item->>'employee_name',''),coalesce(item->>'department',''),coalesce(item->>'title',''),coalesce(item->>'branch',''),coalesce(item->>'manager_id',''),coalesce(item->>'manager_code',''),coalesce(item->>'manager_name',''),coalesce(item->>'employee_status','Đang làm việc'),nullif(item->>'leave_until','')::date,coalesce(item->>'status_note',''),coalesce(item->>'template_id',''),coalesce(item->>'template_version',''),coalesce((item->>'effective_date')::date,current_date))
    then
      changed_count := changed_count + 1;
      insert into public.checklist_employee_assignment_history(
        employee_key,employee_id,employee_code,employee_name,department,title,branch,manager_id,manager_code,manager_name,employee_status,leave_until,status_note,template_id,template_version,effective_date,reason,changed_by,changed_by_name,previous_data,changed_at,updated_at
      ) values (
        key_value,coalesce(item->>'employee_id',''),coalesce(item->>'employee_code',''),coalesce(item->>'employee_name',''),coalesce(item->>'department',''),coalesce(item->>'title',''),coalesce(item->>'branch',''),coalesce(item->>'manager_id',''),coalesce(item->>'manager_code',''),coalesce(item->>'manager_name',''),coalesce(item->>'employee_status','Đang làm việc'),nullif(item->>'leave_until','')::date,coalesce(item->>'status_note',''),coalesce(item->>'template_id',''),coalesce(item->>'template_version',''),coalesce((item->>'effective_date')::date,current_date),coalesce(nullif(item->>'reason',''),'Đồng bộ cấu hình Checklist'),p_actor_id,p_actor_name,case when old_row.id is null then null else to_jsonb(old_row) end,now(),now()
      );

      insert into public.checklist_employee_assignments(
        employee_key,employee_id,employee_code,employee_name,department,title,branch,manager_id,manager_code,manager_name,employee_status,leave_until,status_note,template_id,template_version,effective_date,reason,updated_by,updated_by_name,updated_at
      ) values (
        key_value,coalesce(item->>'employee_id',''),coalesce(item->>'employee_code',''),coalesce(item->>'employee_name',''),coalesce(item->>'department',''),coalesce(item->>'title',''),coalesce(item->>'branch',''),coalesce(item->>'manager_id',''),coalesce(item->>'manager_code',''),coalesce(item->>'manager_name',''),coalesce(item->>'employee_status','Đang làm việc'),nullif(item->>'leave_until','')::date,coalesce(item->>'status_note',''),coalesce(item->>'template_id',''),coalesce(item->>'template_version',''),coalesce((item->>'effective_date')::date,current_date),coalesce(nullif(item->>'reason',''),'Đồng bộ cấu hình Checklist'),p_actor_id,p_actor_name,now()
      ) on conflict(employee_key) do update set
        employee_id=excluded.employee_id,employee_code=excluded.employee_code,employee_name=excluded.employee_name,department=excluded.department,title=excluded.title,branch=excluded.branch,manager_id=excluded.manager_id,manager_code=excluded.manager_code,manager_name=excluded.manager_name,employee_status=excluded.employee_status,leave_until=excluded.leave_until,status_note=excluded.status_note,template_id=excluded.template_id,template_version=excluded.template_version,effective_date=excluded.effective_date,reason=excluded.reason,updated_by=excluded.updated_by,updated_by_name=excluded.updated_by_name,updated_at=now();
    end if;
  end loop;
  return jsonb_build_object('saved',total_count,'changed',changed_count);
end;
$$;

revoke all on function public.phf_save_checklist_assignments(jsonb,text,text) from public, anon, authenticated;
