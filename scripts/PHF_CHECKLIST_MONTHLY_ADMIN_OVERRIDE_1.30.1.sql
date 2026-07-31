begin;

create table if not exists public.checklist_monthly_form_history(
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.checklist_monthly_forms(id) on delete restrict,
  period_month text not null,
  employee_code text not null,
  action text not null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  reason text not null,
  changed_by text,
  changed_by_code text,
  changed_by_name text,
  changed_at timestamptz not null default now()
);

create index if not exists checklist_monthly_form_history_form_idx
  on public.checklist_monthly_form_history(form_id,changed_at desc);

alter table public.checklist_monthly_form_history enable row level security;
revoke all on public.checklist_monthly_form_history from anon,authenticated;

create or replace function public.change_checklist_monthly_reviewer(
  p_form_id uuid,
  p_reviewer_id text,
  p_reviewer_code text,
  p_reviewer_name text,
  p_reason text,
  p_actor_id text,
  p_actor_code text,
  p_actor_name text
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_form public.checklist_monthly_forms%rowtype;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_form
  from public.checklist_monthly_forms
  where id=p_form_id
  for update;

  if v_form.id is null then
    return jsonb_build_object('ok',false,'code','FORM_NOT_FOUND','message','Không tìm thấy phiếu cần cập nhật.');
  end if;
  if v_form.status not in('draft','waiting_self','waiting_review') then
    return jsonb_build_object('ok',false,'code','FORM_REVIEWER_LOCKED','message','Chỉ được đổi người thẩm định trước khi hoàn tất thẩm định.');
  end if;

  v_before=jsonb_build_object(
    'reviewerId',coalesce(v_form.reviewer_id,''),
    'reviewerCode',coalesce(v_form.reviewer_code,''),
    'reviewerName',coalesce(v_form.reviewer_name,'')
  );
  v_after=jsonb_build_object(
    'reviewerId',coalesce(p_reviewer_id,''),
    'reviewerCode',upper(coalesce(p_reviewer_code,'')),
    'reviewerName',coalesce(p_reviewer_name,'')
  );

  update public.checklist_monthly_forms
  set reviewer_id=coalesce(p_reviewer_id,''),
      reviewer_code=upper(coalesce(p_reviewer_code,'')),
      reviewer_name=coalesce(p_reviewer_name,''),
      updated_at=now()
  where id=v_form.id;

  insert into public.checklist_monthly_form_history(
    form_id,period_month,employee_code,action,before_data,after_data,reason,
    changed_by,changed_by_code,changed_by_name
  ) values(
    v_form.id,v_form.period_month,v_form.employee_code,'change_reviewer',
    v_before,v_after,p_reason,p_actor_id,p_actor_code,p_actor_name
  );

  return jsonb_build_object('ok',true,'before',v_before,'after',v_after);
end;
$$;

revoke all on function public.change_checklist_monthly_reviewer(uuid,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.change_checklist_monthly_reviewer(uuid,text,text,text,text,text,text,text) to service_role;

commit;
