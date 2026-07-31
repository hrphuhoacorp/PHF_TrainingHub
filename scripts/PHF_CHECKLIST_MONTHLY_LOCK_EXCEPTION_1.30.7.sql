begin;

alter table public.checklist_monthly_periods
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists locked_by_name text,
  add column if not exists lock_reason text;

alter table public.checklist_monthly_forms
  add column if not exists admin_exception_open boolean not null default false,
  add column if not exists admin_exception_reason text,
  add column if not exists admin_exception_opened_at timestamptz,
  add column if not exists admin_exception_opened_by text,
  add column if not exists admin_exception_opened_by_name text;

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
  v_today date := current_date;
  v_period_date date;
  v_normal_lock_date date;
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

  v_period_date:=to_date(p_period_month||'-01','YYYY-MM-DD');
  v_normal_lock_date:=(v_period_date+interval '1 month 4 days')::date;
  if v_today<v_normal_lock_date and not coalesce(p_force,false) then
    return jsonb_build_object(
      'ok',false,'code','LOCK_TOO_EARLY',
      'message','Kỳ này được khóa bình thường từ ngày '||to_char(v_normal_lock_date,'DD/MM/YYYY')||'. Admin có thể chọn khóa ngoại lệ và ghi rõ lý do.',
      'normalLockDate',v_normal_lock_date
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
    jsonb_build_object('status','locked','forced',coalesce(p_force,false)),
    trim(p_reason),p_actor_id,'',p_actor_name,now()
  from public.checklist_monthly_forms
  where period_id=v_period.id and status='locked';

  update public.checklist_monthly_periods
  set status='locked',locked_at=now(),locked_by=p_actor_id,
      locked_by_name=p_actor_name,lock_reason=trim(p_reason)
  where id=v_period.id;

  return jsonb_build_object('ok',true,'total',v_total,'locked',v_reviewed,'forced',coalesce(p_force,false));
end;
$$;

create or replace function public.open_checklist_monthly_admin_exception(
  p_form_id uuid,
  p_reason text,
  p_actor_id text,
  p_actor_name text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_form public.checklist_monthly_forms%rowtype;
  v_period_status text;
begin
  if coalesce(length(trim(p_reason)),0)<10 then
    return jsonb_build_object('ok',false,'code','EXCEPTION_REASON_REQUIRED','message','Lý do mở ngoại lệ cần tối thiểu 10 ký tự.');
  end if;

  select * into v_form
  from public.checklist_monthly_forms
  where id=p_form_id
  for update;
  if not found then
    return jsonb_build_object('ok',false,'code','FORM_NOT_FOUND','message','Không tìm thấy phiếu.');
  end if;

  select status into v_period_status
  from public.checklist_monthly_periods
  where id=v_form.period_id;
  if v_period_status<>'locked' or v_form.status<>'locked' then
    return jsonb_build_object('ok',false,'code','FORM_NOT_LOCKED','message','Chỉ mở ngoại lệ cho phiếu thuộc kỳ đã khóa.');
  end if;

  update public.checklist_monthly_forms
  set status='waiting_review',
      admin_exception_open=true,
      admin_exception_reason=trim(p_reason),
      admin_exception_opened_at=now(),
      admin_exception_opened_by=p_actor_id,
      admin_exception_opened_by_name=p_actor_name,
      updated_at=now()
  where id=p_form_id;

  insert into public.checklist_monthly_form_history(
    form_id,period_month,employee_code,action,before_data,after_data,reason,
    changed_by,changed_by_code,changed_by_name,changed_at
  ) values(
    v_form.id,v_form.period_month,v_form.employee_code,'open_admin_exception',
    jsonb_build_object('status','locked'),
    jsonb_build_object('status','waiting_review','adminExceptionOpen',true),
    trim(p_reason),p_actor_id,'',p_actor_name,now()
  );

  return jsonb_build_object('ok',true,'formId',v_form.id,'employeeName',v_form.employee_name);
end;
$$;

create or replace function public.log_checklist_monthly_review_history()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_action text;
begin
  if new.review_saved_at is not distinct from old.review_saved_at then
    return new;
  end if;

  v_action=case
    when coalesce(old.admin_exception_open,false) and new.status='locked' then 'complete_admin_exception'
    when old.status='waiting_review' and new.status='reviewed' then 'complete_review'
    else 'save_review_draft'
  end;

  insert into public.checklist_monthly_form_history(
    form_id,period_month,employee_code,action,before_data,after_data,reason,
    changed_by,changed_by_code,changed_by_name,changed_at
  ) values(
    new.id,new.period_month,new.employee_code,v_action,
    jsonb_build_object('status',old.status,'reviewAnswers',coalesce(old.review_answers,'{}'::jsonb),'checklistReviewScore',old.checklist_review_score,'reviewNote',coalesce(old.review_note,'')),
    jsonb_build_object('status',new.status,'reviewAnswers',coalesce(new.review_answers,'{}'::jsonb),'checklistReviewScore',new.checklist_review_score,'reviewNote',coalesce(new.review_note,''),'adminOverride',coalesce(new.reviewed_as_override,false)),
    case
      when v_action='complete_admin_exception' then coalesce(nullif(old.admin_exception_reason,''),'Hoàn tất xử lý ngoại lệ')
      when coalesce(new.reviewed_as_override,false) then coalesce(nullif(new.review_override_reason,''),'Admin xử lý thay')
      when v_action='complete_review' then 'Hoàn tất thẩm định'
      else 'Lưu nháp thẩm định'
    end,
    new.reviewed_by,new.reviewed_by_code,new.reviewed_by_name,now()
  );
  return new;
end;
$$;

revoke all on function public.lock_checklist_monthly_period(text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.lock_checklist_monthly_period(text,text,text,text,boolean) to service_role;

revoke all on function public.open_checklist_monthly_admin_exception(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.open_checklist_monthly_admin_exception(uuid,text,text,text) to service_role;

commit;
