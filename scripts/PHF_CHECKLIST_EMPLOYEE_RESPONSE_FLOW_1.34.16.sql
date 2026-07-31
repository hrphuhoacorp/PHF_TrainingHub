-- PHF Checklist 1.34.16 - Employee response flow
-- Chạy 1 lần trên Supabase SQL Editor trước khi test luồng Báo Admin.
-- Thời hạn 3 ngày được tính theo ngày dương lịch và hết lúc 23:59:59 giờ Việt Nam.

create or replace function public.phf_transition_checklist_task(
  p_task_id uuid,
  p_action text,
  p_note text default '',
  p_actor_id text default '',
  p_actor_employee_id text default '',
  p_actor_code text default '',
  p_actor_name text default '',
  p_actor_role text default '',
  p_reviewer_days integer default 3,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task public.checklist_violation_tasks%rowtype;
  v_after public.checklist_violation_tasks%rowtype;
  v_violation public.checklist_violation_records%rowtype;
  v_new_violation public.checklist_violation_records%rowtype;
  v_status text;
  v_assignee_id text;
  v_assignee_code text;
  v_assignee_type text;
  v_due timestamptz;
  v_completed timestamptz;
  v_now timestamptz := now();
  v_is_subject boolean;
  v_is_creator boolean;
begin
  select * into v_task
  from public.checklist_violation_tasks
  where id=p_task_id
  for update;

  if not found then return jsonb_build_object('ok',false,'code','CHECKLIST_TASK_NOT_FOUND','message','Công việc không còn tồn tại.'); end if;
  if p_expected_updated_at is null or v_task.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok',false,'code','CHECKLIST_TASK_STALE','message','Công việc đã được cập nhật ở tab hoặc máy khác.');
  end if;
  if v_task.status in ('completed','cancelled') then return jsonb_build_object('ok',false,'code','CHECKLIST_TASK_ALREADY_CLOSED','message','Công việc đã có kết luận cuối.'); end if;

  v_is_subject := (trim(p_actor_employee_id)<>'' and v_task.employee_id=trim(p_actor_employee_id))
    or (trim(p_actor_code)<>'' and upper(v_task.employee_code)=upper(trim(p_actor_code)));
  v_is_creator := trim(p_actor_id)<>'' and v_task.created_by=trim(p_actor_id);

  if p_action in ('employee_confirm','employee_explain') and (v_task.status<>'waiting_employee' or not v_is_subject) then
    return jsonb_build_object('ok',false,'code','CHECKLIST_TASK_EMPLOYEE_ONLY','message','Chỉ nhân viên liên quan được xử lý lỗi này.');
  end if;
  if p_action='employee_accept_result' and (v_task.status<>'waiting_employee_result' or not v_is_subject) then
    return jsonb_build_object('ok',false,'code','CHECKLIST_TASK_EMPLOYEE_ONLY','message','Chỉ nhân viên liên quan được xác nhận kết luận.');
  end if;
  if p_action='employee_escalate' and (
    not v_is_subject or not (
      v_task.status='waiting_employee_result'
      or (v_task.status='waiting_reviewer' and v_task.due_at is not null and v_task.due_at < v_now)
    )
  ) then
    return jsonb_build_object('ok',false,'code','CHECKLIST_TASK_ESCALATE_NOT_ALLOWED','message','Chỉ được báo Admin khi người ghi đã quá hạn phản hồi hoặc sau khi giữ nguyên lỗi.');
  end if;
  if p_action in ('reviewer_accept','reviewer_uphold') and (v_task.status<>'waiting_reviewer' or (not v_is_creator and lower(trim(p_actor_role))<>'admin')) then
    return jsonb_build_object('ok',false,'code','CHECKLIST_TASK_REVIEWER_ONLY','message','Chỉ người ghi lỗi hoặc Admin được phản hồi giải trình.');
  end if;
  if p_action in ('admin_uphold','admin_cancel') and (v_task.status<>'waiting_admin' or lower(trim(p_actor_role))<>'admin') then
    return jsonb_build_object('ok',false,'code','CHECKLIST_TASK_ADMIN_ONLY','message','Chỉ Admin được kết luận trường hợp này.');
  end if;

  if p_action='employee_confirm' then
    v_status:='completed';v_assignee_id:=v_task.current_assignee_id;v_assignee_code:=v_task.current_assignee_code;v_assignee_type:='employee';v_due:=v_task.due_at;v_completed:=v_now;
  elsif p_action='employee_explain' then
    v_status:='waiting_reviewer';v_assignee_id:=v_task.created_by;v_assignee_code:=null;v_assignee_type:='reviewer';v_due:=((timezone('Asia/Ho_Chi_Minh',v_now)::date + greatest(1,least(30,coalesce(p_reviewer_days,3)))) + time '23:59:59') at time zone 'Asia/Ho_Chi_Minh';v_completed:=null;
  elsif p_action='employee_accept_result' then
    v_status:='completed';v_assignee_id:=v_task.current_assignee_id;v_assignee_code:=v_task.current_assignee_code;v_assignee_type:='employee';v_due:=v_task.due_at;v_completed:=v_now;
  elsif p_action='employee_escalate' then
    v_status:='waiting_admin';v_assignee_id:=null;v_assignee_code:=null;v_assignee_type:='admin';v_due:=null;v_completed:=null;
  elsif p_action='reviewer_accept' then
    v_status:='cancelled';v_assignee_id:=p_actor_id;v_assignee_code:=p_actor_code;v_assignee_type:='reviewer';v_due:=v_task.due_at;v_completed:=v_now;
  elsif p_action='reviewer_uphold' then
    v_status:='waiting_employee_result';v_assignee_id:=v_task.employee_id;v_assignee_code:=v_task.employee_code;v_assignee_type:='employee';v_due:=null;v_completed:=null;
  elsif p_action='admin_cancel' then
    v_status:='cancelled';v_assignee_id:=p_actor_id;v_assignee_code:=p_actor_code;v_assignee_type:='admin';v_due:=v_task.due_at;v_completed:=v_now;
  elsif p_action='admin_uphold' then
    v_status:='completed';v_assignee_id:=p_actor_id;v_assignee_code:=p_actor_code;v_assignee_type:='admin';v_due:=v_task.due_at;v_completed:=v_now;
  else
    return jsonb_build_object('ok',false,'code','CHECKLIST_TASK_ACTION_INVALID','message','Thao tác xử lý không hợp lệ.');
  end if;

  update public.checklist_violation_tasks set
    status=v_status,current_assignee_id=v_assignee_id,current_assignee_code=v_assignee_code,
    current_assignee_type=v_assignee_type,due_at=v_due,completed_at=v_completed,updated_at=v_now
  where id=p_task_id and status=v_task.status
  returning * into v_after;

  if not found then raise exception 'CHECKLIST_TASK_STALE:%',p_task_id; end if;

  insert into public.checklist_violation_task_history(
    task_id,violation_id,action,from_status,to_status,note,actor_id,actor_name,created_at
  ) values (
    v_task.id,v_task.violation_id,p_action,v_task.status,v_after.status,
    coalesce(nullif(trim(p_note),''),case when p_action='employee_confirm' then 'Nhân viên xác nhận lỗi' else p_action end),
    coalesce(nullif(trim(p_actor_id),''),nullif(trim(p_actor_employee_id),'')),p_actor_name,v_now
  );

  if p_action in ('reviewer_accept','admin_cancel') then
    select * into v_violation
    from public.checklist_violation_records
    where id=v_task.violation_id
    for update;

    if found and v_violation.record_status<>'cancelled' then
      update public.checklist_violation_records set
        record_status='cancelled',cancel_reason=trim(p_note),cancelled_by=p_actor_id,
        cancelled_by_name=p_actor_name,cancelled_at=v_now,updated_by=p_actor_id,
        updated_by_name=p_actor_name,updated_at=v_now,change_count=coalesce(change_count,0)+1
      where id=v_violation.id
      returning * into v_new_violation;

      insert into public.checklist_violation_record_history(
        record_id,employee_code,action,before_data,after_data,reason,changed_by,changed_by_name,changed_at
      ) values (
        v_violation.id,v_violation.employee_code,'cancel',to_jsonb(v_violation),to_jsonb(v_new_violation),
        trim(p_note),p_actor_id,p_actor_name,v_now
      );
    end if;
  end if;

  return jsonb_build_object('ok',true,'taskId',v_after.id,'status',v_after.status);
end;
$$;

