begin;

create or replace function public.phf_recovery_delete_monthly_form(
  p_form_id uuid,
  p_expected_updated_at timestamptz,
  p_reason text,
  p_idempotency_key text,
  p_confirm_delete boolean,
  p_confirm_pilot_test boolean,
  p_actor_id text,
  p_actor_code text,
  p_actor_name text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_form public.checklist_monthly_forms%rowtype;
  v_period public.checklist_monthly_periods%rowtype;
  v_existing public.checklist_monthly_recovery_audit%rowtype;
  v_operation_id uuid:=gen_random_uuid();v_before jsonb:='{}'::jsonb;
  v_history_count integer:=0;v_notification_count integer:=0;v_deleted_history integer:=0;v_deleted_notifications integer:=0;
  v_error text;
begin
  if length(trim(coalesce(p_idempotency_key,'')))<8 or length(trim(coalesce(p_idempotency_key,'')))>120 then
    return jsonb_build_object('ok',false,'code','CHECKLIST_RECOVERY_IDEMPOTENCY_REQUIRED','message','Mã chống gửi lặp không hợp lệ.');
  end if;
  perform pg_advisory_xact_lock(hashtext('phf_checklist_recovery_idempotency|'||p_idempotency_key));
  select * into v_existing from public.checklist_monthly_recovery_audit
   where idempotency_key=p_idempotency_key and form_id=p_form_id and action in('admin_delete_monthly_form','admin_delete_monthly_form_failed') order by created_at desc limit 1;
  if found then
    if v_existing.result='success' then return jsonb_build_object('ok',true,'idempotent',true,'operationId',v_existing.operation_id,'formId',p_form_id,'deletedHistory',coalesce((v_existing.after_data->>'deletedHistory')::integer,0),'deletedNotifications',coalesce((v_existing.after_data->>'deletedNotifications')::integer,0));end if;
    return jsonb_build_object('ok',false,'idempotent',true,'code',coalesce(v_existing.after_data->>'code','CHECKLIST_RECOVERY_DELETE_FAILED'),'message',coalesce(v_existing.after_data->>'message','Lần xử lý trước đã thất bại.'));
  end if;

  begin
    if length(trim(coalesce(p_reason,'')))<10 then raise exception 'CHECKLIST_RECOVERY_REASON_REQUIRED';end if;
    if not coalesce(p_confirm_delete,false) then raise exception 'CHECKLIST_RECOVERY_DELETE_CONFIRM_REQUIRED';end if;
    perform pg_advisory_xact_lock(hashtext('phf_checklist_recovery_form|'||p_form_id::text));
    select * into v_form from public.checklist_monthly_forms where id=p_form_id for update;
    if not found then raise exception 'CHECKLIST_RECOVERY_FORM_NOT_FOUND';end if;
    v_before:=to_jsonb(v_form);
    select * into v_period from public.checklist_monthly_periods where id=v_form.period_id for update;
    if not found then raise exception 'CHECKLIST_RECOVERY_PERIOD_NOT_FOUND';end if;
    perform pg_advisory_xact_lock(hashtext('phf_checklist_monthly|'||v_form.period_month));
    perform pg_advisory_xact_lock(hashtext('phf_checklist_monthly|'||v_form.period_month||'|'||upper(v_form.employee_code)));
    if v_period.status='locked' or v_form.status='locked' then raise exception 'CHECKLIST_RECOVERY_DELETE_LOCKED';end if;
    if v_form.status not in('waiting_self','waiting_review','reviewed') then raise exception 'CHECKLIST_RECOVERY_DELETE_STATUS_BLOCKED';end if;
    if v_form.status='reviewed' and not coalesce(p_confirm_pilot_test,false) then raise exception 'CHECKLIST_RECOVERY_DELETE_REVIEWED_CONFIRM_REQUIRED';end if;
    if p_expected_updated_at is null or v_form.updated_at is distinct from p_expected_updated_at then raise exception 'CHECKLIST_RECOVERY_FORM_STALE';end if;
    select count(*) into v_history_count from public.checklist_monthly_form_history where form_id=p_form_id;
    select count(*) into v_notification_count from public.checklist_notifications where subject_type='monthly_form' and subject_id=p_form_id::text;

    insert into public.checklist_monthly_recovery_audit(
      operation_id,idempotency_key,action,form_id,period_month,employee_id,employee_code,employee_name,status,before_data,after_data,reason,
      actor_id,actor_code,actor_name,result
    ) values(
      v_operation_id,p_idempotency_key,'admin_delete_monthly_form',v_form.id,v_form.period_month,v_form.employee_id,v_form.employee_code,v_form.employee_name,v_form.status,
      v_before||jsonb_build_object('historyCount',v_history_count,'notificationCount',v_notification_count,'pilotTestConfirmed',coalesce(p_confirm_pilot_test,false)),
      jsonb_build_object('deletedHistory',v_history_count,'deletedNotifications',v_notification_count,'preserved',jsonb_build_array('employee','account','assignment','template_version','violations','violation_tasks','period')),
      trim(p_reason),p_actor_id,upper(coalesce(p_actor_code,'')),p_actor_name,'success'
    );
    delete from public.checklist_notifications where subject_type='monthly_form' and subject_id=p_form_id::text;get diagnostics v_deleted_notifications=row_count;
    delete from public.checklist_monthly_form_history where form_id=p_form_id;get diagnostics v_deleted_history=row_count;
    delete from public.checklist_monthly_forms where id=p_form_id;
    if not found then raise exception 'CHECKLIST_RECOVERY_FORM_DELETE_FAILED';end if;
    return jsonb_build_object('ok',true,'idempotent',false,'operationId',v_operation_id,'formId',p_form_id,'period',v_form.period_month,'employeeCode',v_form.employee_code,'deletedHistory',v_deleted_history,'deletedNotifications',v_deleted_notifications);
  exception when others then
    v_error:=sqlerrm;
    insert into public.checklist_monthly_recovery_audit(
      operation_id,idempotency_key,action,form_id,period_month,employee_id,employee_code,employee_name,status,before_data,after_data,reason,
      actor_id,actor_code,actor_name,result
    ) values(
      v_operation_id,p_idempotency_key,'admin_delete_monthly_form_failed',p_form_id,coalesce(v_form.period_month,''),coalesce(v_form.employee_id,''),coalesce(v_form.employee_code,''),coalesce(v_form.employee_name,''),coalesce(v_form.status,''),
      coalesce(v_before,'{}'::jsonb),jsonb_build_object('code',split_part(v_error,':',1),'message',v_error),coalesce(trim(p_reason),''),p_actor_id,upper(coalesce(p_actor_code,'')),p_actor_name,'failed'
    );
    return jsonb_build_object('ok',false,'operationId',v_operation_id,'code',split_part(v_error,':',1),'message',v_error);
  end;
end;
$$;

revoke all on function public.phf_recovery_delete_monthly_form(uuid,timestamptz,text,text,boolean,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.phf_recovery_delete_monthly_form(uuid,timestamptz,text,text,boolean,boolean,text,text,text) to service_role;
commit;
notify pgrst,'reload schema';
