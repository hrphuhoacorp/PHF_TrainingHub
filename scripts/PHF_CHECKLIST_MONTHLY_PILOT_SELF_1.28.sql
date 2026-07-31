begin;

alter table public.checklist_monthly_forms
  add column if not exists pilot_opened_at timestamptz,
  add column if not exists pilot_opened_by text not null default '',
  add column if not exists pilot_opened_by_name text not null default '',
  add column if not exists self_answers jsonb not null default '{}'::jsonb,
  add column if not exists self_note text not null default '',
  add column if not exists self_saved_at timestamptz,
  add column if not exists self_submitted_at timestamptz;

create or replace function public.open_checklist_monthly_pilot(
  p_period_month text,
  p_employee_code text,
  p_actor_id text,
  p_actor_name text
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_period public.checklist_monthly_periods%rowtype;
  v_form public.checklist_monthly_forms%rowtype;
begin
  select * into v_period from public.checklist_monthly_periods
  where period_month=p_period_month for update;
  if v_period.id is null then
    return jsonb_build_object('ok',false,'code','PERIOD_NOT_FOUND','message','Chưa có kỳ đánh giá để mở thử.');
  end if;
  if v_period.status<>'draft' then
    return jsonb_build_object('ok',false,'code','PERIOD_NOT_DRAFT','message','Chỉ kỳ đang nháp mới dùng chế độ mở thử một tài khoản.');
  end if;

  select * into v_form from public.checklist_monthly_forms
  where period_id=v_period.id and upper(employee_code)=upper(coalesce(p_employee_code,''))
  for update;
  if v_form.id is null then
    return jsonb_build_object('ok',false,'code','FORM_NOT_FOUND','message','Không tìm thấy phiếu của nhân viên được chọn.');
  end if;
  if coalesce(v_form.reviewer_id,'')='' and coalesce(v_form.reviewer_code,'')='' then
    return jsonb_build_object('ok',false,'code','MISSING_REVIEWER','message','Phiếu thử chưa có người thẩm định.');
  end if;
  if coalesce(v_form.template_id,'')='' or coalesce(v_form.template_version,'')='' then
    return jsonb_build_object('ok',false,'code','MISSING_TEMPLATE','message','Phiếu thử chưa đủ mẫu hoặc phiên bản.');
  end if;
  if v_form.status not in('draft','waiting_self') then
    return jsonb_build_object('ok',false,'code','FORM_ALREADY_PROGRESS','message','Phiếu đã qua bước tự đánh giá, không thể mở thử lại.');
  end if;

  update public.checklist_monthly_forms
  set status='waiting_self',pilot_opened_at=coalesce(pilot_opened_at,now()),
      pilot_opened_by=coalesce(p_actor_id,''),pilot_opened_by_name=coalesce(p_actor_name,''),
      updated_at=now()
  where id=v_form.id;

  return jsonb_build_object('ok',true,'employeeCode',v_form.employee_code,
    'employeeName',v_form.employee_name,'formId',v_form.id);
end;
$$;

revoke all on function public.open_checklist_monthly_pilot(text,text,text,text) from public,anon,authenticated;
grant execute on function public.open_checklist_monthly_pilot(text,text,text,text) to service_role;

commit;
