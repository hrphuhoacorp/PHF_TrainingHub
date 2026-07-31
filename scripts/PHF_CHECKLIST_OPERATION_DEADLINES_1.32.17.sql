begin;

-- 1) Hạn xác nhận của lỗi chính thức mới đọc từ cấu hình Admin.
--    Các công việc đã tồn tại giữ nguyên due_at để không làm sai lịch sử.
create or replace function public.phf_create_violation_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := 3;
  v_setting text;
  v_json jsonb := '{}'::jsonb;
begin
  begin
    select setting_value
      into v_setting
    from public.checklist_system_settings
    where setting_key = 'monthly_self_overdue_policy'
    limit 1;

    if coalesce(trim(v_setting), '') <> '' then
      v_json := v_setting::jsonb;
      if coalesce(v_json->>'employeeResponseDays', '') ~ '^[0-9]+$' then
        v_days := greatest(1, least(30, (v_json->>'employeeResponseDays')::integer));
      end if;
    end if;
  exception when others then
    v_days := 3;
  end;

  if new.is_test = false and new.record_status = 'official' then
    insert into public.checklist_violation_tasks (
      violation_id,
      employee_id,
      employee_code,
      employee_name,
      created_by,
      created_by_name,
      current_assignee_id,
      current_assignee_code,
      current_assignee_type,
      status,
      priority,
      due_at
    ) values (
      new.id,
      new.employee_id,
      new.employee_code,
      new.employee_name,
      new.created_by,
      new.created_by_name,
      new.employee_id,
      new.employee_code,
      'employee',
      'waiting_employee',
      'normal',
      coalesce(new.created_at, now()) + make_interval(days => v_days)
    )
    on conflict (violation_id) do nothing;
  end if;
  return new;
end;
$$;

-- 2) Ngày/giờ khóa kỳ đọc từ cấu hình Admin theo kỳ bắt đầu áp dụng.
create or replace function public.lock_checklist_monthly_period(
  p_period_month text,
  p_reason text,
  p_actor_id text,
  p_actor_name text,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_period public.checklist_monthly_periods%rowtype;
  v_total integer;
  v_reviewed integer;
  v_incomplete integer;
  v_period_date date;
  v_now_local timestamp := now() at time zone 'Asia/Ho_Chi_Minh';
  v_normal_lock_at timestamp;
  v_cutoff_day integer := 4;
  v_cutoff_time time := time '23:59';
  v_effective_period text := '2026-08';
  v_setting text;
  v_json jsonb := '{}'::jsonb;
begin
  if coalesce(length(trim(p_reason)),0)<10 then
    return jsonb_build_object('ok',false,'code','LOCK_REASON_REQUIRED','message','Lý do khóa kỳ cần tối thiểu 10 ký tự.');
  end if;

  select * into v_period
  from public.checklist_monthly_periods
  where period_month=p_period_month
  for update;

  if not found then
    return jsonb_build_object('ok',false,'code','PERIOD_NOT_FOUND','message','Không tìm thấy kỳ đánh giá.');
  end if;
  if v_period.status='locked' then
    return jsonb_build_object('ok',true,'alreadyLocked',true,'total',0,'message','Kỳ đã được khóa trước đó.');
  end if;
  if v_period.status<>'open' then
    return jsonb_build_object('ok',false,'code','PERIOD_NOT_OPEN','message','Chỉ khóa kỳ đang mở.');
  end if;

  select count(*),count(*) filter(where status='reviewed')
    into v_total,v_reviewed
  from public.checklist_monthly_forms
  where period_id=v_period.id;
  v_incomplete:=v_total-v_reviewed;

  if v_total=0 then
    return jsonb_build_object('ok',false,'code','PERIOD_EMPTY','message','Kỳ chưa có phiếu để khóa.');
  end if;
  if v_incomplete>0 then
    return jsonb_build_object(
      'ok',false,'code','FORMS_INCOMPLETE',
      'message','Còn '||v_incomplete||' phiếu chưa hoàn tất thẩm định.',
      'total',v_total,'reviewed',v_reviewed,'incomplete',v_incomplete
    );
  end if;

  begin
    select setting_value
      into v_setting
    from public.checklist_system_settings
    where setting_key='monthly_self_overdue_policy'
    limit 1;

    if coalesce(trim(v_setting), '') <> '' then
      v_json := v_setting::jsonb;
      if coalesce(v_json->>'effectiveFromPeriod','') ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
        v_effective_period := v_json->>'effectiveFromPeriod';
      end if;
      if p_period_month >= v_effective_period then
        if coalesce(v_json->>'monthlyCutoffDay','') ~ '^[0-9]+$' then
          v_cutoff_day := greatest(1,least(28,(v_json->>'monthlyCutoffDay')::integer));
        end if;
        if coalesce(v_json->>'monthlyCutoffTime','') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
          v_cutoff_time := (v_json->>'monthlyCutoffTime')::time;
        end if;
      end if;
    end if;
  exception when others then
    v_cutoff_day := 4;
    v_cutoff_time := time '23:59';
    v_effective_period := '2026-08';
  end;

  v_period_date:=to_date(p_period_month||'-01','YYYY-MM-DD');
  v_normal_lock_at:=
    ((v_period_date + interval '1 month' + ((v_cutoff_day-1) * interval '1 day'))::date + v_cutoff_time)
    + interval '1 minute';

  if v_now_local<v_normal_lock_at and not coalesce(p_force,false) then
    return jsonb_build_object(
      'ok',false,'code','LOCK_TOO_EARLY',
      'message','Kỳ này được khóa bình thường từ '||to_char(v_normal_lock_at,'HH24:MI DD/MM/YYYY')||'. Admin có thể chọn khóa ngoại lệ và ghi rõ lý do.',
      'normalLockAt',v_normal_lock_at,
      'timezone','Asia/Ho_Chi_Minh'
    );
  end if;

  update public.checklist_monthly_forms
  set status='locked',admin_exception_open=false,updated_at=now()
  where period_id=v_period.id and status='reviewed';

  insert into public.checklist_monthly_form_history(
    form_id,period_month,employee_code,action,before_data,after_data,reason,
    changed_by,changed_by_code,changed_by_name,changed_at
  )
  select id,period_month,employee_code,'lock_form',
    jsonb_build_object('status','reviewed'),
    jsonb_build_object('status','locked','forced',coalesce(p_force,false),'normalLockAt',v_normal_lock_at),
    trim(p_reason),p_actor_id,'',p_actor_name,now()
  from public.checklist_monthly_forms
  where period_id=v_period.id and status='locked';

  update public.checklist_monthly_periods
  set status='locked',locked_at=now(),locked_by=p_actor_id,
      locked_by_name=p_actor_name,lock_reason=trim(p_reason)
  where id=v_period.id;

  return jsonb_build_object('ok',true,'total',v_total,'locked',v_reviewed,'forced',coalesce(p_force,false),'normalLockAt',v_normal_lock_at);
end;
$$;

revoke all on function public.lock_checklist_monthly_period(text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.lock_checklist_monthly_period(text,text,text,text,boolean) to service_role;

commit;
