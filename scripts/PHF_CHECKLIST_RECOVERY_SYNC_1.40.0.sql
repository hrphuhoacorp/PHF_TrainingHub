begin;
create extension if not exists pgcrypto;

create table if not exists public.checklist_monthly_recovery_audit(
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  idempotency_key text not null,
  action text not null,
  form_id uuid,
  period_month text not null,
  employee_id text not null default '',
  employee_code text not null default '',
  employee_name text not null default '',
  status text not null default '',
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  reason text not null,
  actor_id text not null default '',
  actor_code text not null default '',
  actor_name text not null default '',
  result text not null check(result in('success','failed')),
  created_at timestamptz not null default now(),
  unique(action,idempotency_key,period_month,employee_code)
);
create index if not exists checklist_monthly_recovery_audit_operation_idx
  on public.checklist_monthly_recovery_audit(operation_id,created_at);
create index if not exists checklist_monthly_recovery_audit_form_idx
  on public.checklist_monthly_recovery_audit(form_id,created_at);
alter table public.checklist_monthly_recovery_audit enable row level security;
revoke all on public.checklist_monthly_recovery_audit from anon,authenticated;

create or replace function public.phf_checklist_recovery_audit_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'CHECKLIST_RECOVERY_AUDIT_IMMUTABLE';
end;
$$;
drop trigger if exists phf_checklist_recovery_audit_immutable on public.checklist_monthly_recovery_audit;
create trigger phf_checklist_recovery_audit_immutable
before update or delete on public.checklist_monthly_recovery_audit
for each row execute function public.phf_checklist_recovery_audit_immutable();

create or replace function public.phf_recovery_create_missing_monthly_forms(
  p_period_month text,
  p_forms jsonb,
  p_source_revision jsonb,
  p_reason text,
  p_idempotency_key text,
  p_actor_id text,
  p_actor_code text,
  p_actor_name text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_period public.checklist_monthly_periods%rowtype;
  v_operation_id uuid:=gen_random_uuid();
  v_existing_operation public.checklist_monthly_recovery_audit%rowtype;
  v_item jsonb;v_form_id uuid;v_created integer:=0;v_skipped integer:=0;
  v_start date;v_end date;v_previous text;
  v_current_count bigint;v_history_count bigint;v_template_count bigint;v_template_version_count bigint;
  v_violation_count bigint;v_monthly_form_count bigint;v_marketing_current_count bigint;v_marketing_previous_count bigint;v_marketing_previous_form_count bigint;
  v_current_max timestamptz;v_history_max timestamptz;v_template_max timestamptz;v_template_version_max timestamptz;
  v_violation_max timestamptz;v_monthly_form_max timestamptz;v_marketing_current_max timestamptz;v_marketing_previous_max timestamptz;v_marketing_previous_form_max timestamptz;
begin
  if p_period_month!~'^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'CHECKLIST_RECOVERY_PERIOD_INVALID';end if;
  if jsonb_typeof(p_forms)<>'array' or jsonb_typeof(p_source_revision)<>'object' then raise exception 'CHECKLIST_RECOVERY_PAYLOAD_INVALID';end if;
  if length(trim(coalesce(p_reason,'')))<10 then raise exception 'CHECKLIST_RECOVERY_REASON_REQUIRED';end if;
  if length(trim(coalesce(p_idempotency_key,'')))<8 or length(trim(coalesce(p_idempotency_key,'')))>120 then raise exception 'CHECKLIST_RECOVERY_IDEMPOTENCY_REQUIRED';end if;

  perform pg_advisory_xact_lock(hashtext('phf_checklist_recovery_idempotency|'||p_idempotency_key));
  select * into v_existing_operation from public.checklist_monthly_recovery_audit
   where action='admin_create_missing_forms_operation' and idempotency_key=p_idempotency_key and period_month=p_period_month and employee_code='';
  if found then return jsonb_build_object('ok',true,'idempotent',true,'operationId',v_existing_operation.operation_id,'created',coalesce((v_existing_operation.after_data->>'created')::integer,0),'skipped',coalesce((v_existing_operation.after_data->>'skipped')::integer,0));end if;

  perform pg_advisory_xact_lock(hashtext('phf_checklist_assignment_global'));
  perform pg_advisory_xact_lock(hashtext('phf_checklist_template_global'));
  perform pg_advisory_xact_lock(hashtext('phf_checklist_monthly|'||p_period_month));
  v_start:=to_date(p_period_month||'-01','YYYY-MM-DD');v_end:=(v_start+interval '1 month'-interval '1 day')::date;v_previous:=to_char(v_start-interval '1 month','YYYY-MM');

  select count(*),max(updated_at) into v_current_count,v_current_max from public.checklist_employee_assignments;
  select count(*),max(coalesce(changed_at,updated_at)) into v_history_count,v_history_max from public.checklist_employee_assignment_history;
  select count(*),max(updated_at) into v_template_count,v_template_max from public.checklist_templates;
  select count(*),max(created_at) into v_template_version_count,v_template_version_max from public.checklist_template_versions;
  select count(*),max(coalesce(updated_at,created_at)) into v_violation_count,v_violation_max from public.checklist_violation_records where is_test=false and record_status='official' and occurred_date between v_start and v_end;
  select count(*),max(updated_at) into v_monthly_form_count,v_monthly_form_max from public.checklist_monthly_forms where period_month=p_period_month;
  select count(*),max(updated_at) into v_marketing_current_count,v_marketing_current_max from public.checklist_monthly_kpi_configs where period_month=p_period_month and department='Marketing' and template_id in(select jsonb_array_elements_text(coalesce(p_source_revision->'marketing_config_ids','[]'::jsonb)));
  select count(*),max(updated_at) into v_marketing_previous_count,v_marketing_previous_max from public.checklist_monthly_kpi_configs where period_month=v_previous and department='Marketing' and template_id in(select jsonb_array_elements_text(coalesce(p_source_revision->'marketing_config_ids','[]'::jsonb)));
  select count(*),max(updated_at) into v_marketing_previous_form_count,v_marketing_previous_form_max from public.checklist_monthly_forms where period_month=v_previous and lower(trim(department))='marketing' and template_id in(select jsonb_array_elements_text(coalesce(p_source_revision->'marketing_template_keys','[]'::jsonb)));

  if coalesce((p_source_revision->>'current_count')::bigint,-1)<>v_current_count or coalesce((p_source_revision->>'history_count')::bigint,-1)<>v_history_count
   or nullif(p_source_revision->>'current_max','')::timestamptz is distinct from v_current_max or nullif(p_source_revision->>'history_max','')::timestamptz is distinct from v_history_max
   or coalesce((p_source_revision->>'template_count')::bigint,-1)<>v_template_count or coalesce((p_source_revision->>'template_version_count')::bigint,-1)<>v_template_version_count
   or nullif(p_source_revision->>'template_max','')::timestamptz is distinct from v_template_max or nullif(p_source_revision->>'template_version_max','')::timestamptz is distinct from v_template_version_max
   or coalesce((p_source_revision->>'violation_count')::bigint,-1)<>v_violation_count or nullif(p_source_revision->>'violation_max','')::timestamptz is distinct from v_violation_max
   or coalesce((p_source_revision->>'monthly_form_count')::bigint,-1)<>v_monthly_form_count or nullif(p_source_revision->>'monthly_form_max','')::timestamptz is distinct from v_monthly_form_max
   or coalesce((p_source_revision->>'marketing_current_count')::bigint,-1)<>v_marketing_current_count or nullif(p_source_revision->>'marketing_current_max','')::timestamptz is distinct from v_marketing_current_max
   or coalesce((p_source_revision->>'marketing_previous_count')::bigint,-1)<>v_marketing_previous_count or nullif(p_source_revision->>'marketing_previous_max','')::timestamptz is distinct from v_marketing_previous_max
   or coalesce((p_source_revision->>'marketing_previous_form_count')::bigint,-1)<>v_marketing_previous_form_count or nullif(p_source_revision->>'marketing_previous_form_max','')::timestamptz is distinct from v_marketing_previous_form_max
  then raise exception 'CHECKLIST_RECOVERY_SOURCE_STALE';end if;

  select * into v_period from public.checklist_monthly_periods where period_month=p_period_month for update;
  if not found then insert into public.checklist_monthly_periods(period_month,status,created_by,created_by_name,score_policy_snapshot,updated_at) values(p_period_month,'draft',p_actor_id,p_actor_name,coalesce((p_forms->0)->'score_policy_snapshot','{}'::jsonb),now()) returning * into v_period;end if;
  if v_period.status='locked' then raise exception 'CHECKLIST_RECOVERY_PERIOD_LOCKED';end if;
  if v_period.status not in('draft','open') then raise exception 'CHECKLIST_RECOVERY_PERIOD_BLOCKED';end if;

  for v_item in select value from jsonb_array_elements(p_forms) loop
    if coalesce(v_item->>'period_month','')<>p_period_month or trim(coalesce(v_item->>'employee_code',''))='' then raise exception 'CHECKLIST_RECOVERY_FORM_INVALID';end if;
    if trim(coalesce(v_item->>'template_id',''))='' or trim(coalesce(v_item->>'template_version',''))='' or coalesce(v_item->'template_snapshot','{}'::jsonb)='{}'::jsonb then raise exception 'CHECKLIST_RECOVERY_TEMPLATE_INVALID';end if;
    if trim(coalesce(v_item->>'reviewer_id',''))='' and trim(coalesce(v_item->>'reviewer_code',''))='' then raise exception 'CHECKLIST_RECOVERY_REVIEWER_INVALID';end if;
    perform pg_advisory_xact_lock(hashtext('phf_checklist_monthly|'||p_period_month||'|'||upper(v_item->>'employee_code')));
    insert into public.checklist_monthly_forms(
      period_id,period_month,employee_id,employee_code,employee_name,department,title,branch,reviewer_id,reviewer_code,reviewer_name,
      template_id,template_version,template_snapshot,score_policy_snapshot,score_formula_version,checklist_score,status,updated_at
    ) values(
      v_period.id,p_period_month,coalesce(v_item->>'employee_id',''),upper(v_item->>'employee_code'),coalesce(v_item->>'employee_name',''),coalesce(v_item->>'department',''),coalesce(v_item->>'title',''),coalesce(v_item->>'branch',''),
      coalesce(v_item->>'reviewer_id',''),upper(coalesce(v_item->>'reviewer_code','')),coalesce(v_item->>'reviewer_name',''),coalesce(v_item->>'template_id',''),coalesce(v_item->>'template_version',''),
      coalesce(v_item->'template_snapshot','{}'::jsonb),coalesce(v_item->'score_policy_snapshot','{}'::jsonb),coalesce(v_item->>'score_formula_version',''),coalesce((v_item->>'checklist_score')::numeric,100),case when v_period.status='open' then 'waiting_self' else 'draft' end,now()
    ) on conflict(period_month,employee_code) do nothing returning id into v_form_id;
    if v_form_id is null then v_skipped:=v_skipped+1;continue;end if;
    v_created:=v_created+1;
    insert into public.checklist_monthly_form_history(form_id,period_month,employee_code,action,before_data,after_data,reason,changed_by,changed_by_code,changed_by_name,changed_at)
    values(v_form_id,p_period_month,upper(v_item->>'employee_code'),'admin_create_missing_form','{}'::jsonb,jsonb_build_object('operationId',v_operation_id,'status',case when v_period.status='open' then 'waiting_self' else 'draft' end,'templateId',v_item->>'template_id','templateVersion',v_item->>'template_version','reviewerCode',v_item->>'reviewer_code'),trim(p_reason),p_actor_id,upper(coalesce(p_actor_code,'')),p_actor_name,now());
    insert into public.checklist_monthly_recovery_audit(operation_id,idempotency_key,action,form_id,period_month,employee_id,employee_code,employee_name,status,after_data,reason,actor_id,actor_code,actor_name,result)
    values(v_operation_id,p_idempotency_key,'admin_create_missing_form',v_form_id,p_period_month,coalesce(v_item->>'employee_id',''),upper(v_item->>'employee_code'),coalesce(v_item->>'employee_name',''),case when v_period.status='open' then 'waiting_self' else 'draft' end,jsonb_build_object('templateId',v_item->>'template_id','templateVersion',v_item->>'template_version','templateSnapshot',v_item->'template_snapshot','reviewerId',v_item->>'reviewer_id','reviewerCode',v_item->>'reviewer_code','reviewerName',v_item->>'reviewer_name','checklistScore',v_item->>'checklist_score','formulaVersion',v_item->>'score_formula_version'),trim(p_reason),p_actor_id,upper(coalesce(p_actor_code,'')),p_actor_name,'success');
  end loop;
  insert into public.checklist_monthly_recovery_audit(operation_id,idempotency_key,action,period_month,employee_code,after_data,reason,actor_id,actor_code,actor_name,result)
  values(v_operation_id,p_idempotency_key,'admin_create_missing_forms_operation',p_period_month,'',jsonb_build_object('created',v_created,'skipped',v_skipped),trim(p_reason),p_actor_id,upper(coalesce(p_actor_code,'')),p_actor_name,'success');
  return jsonb_build_object('ok',true,'operationId',v_operation_id,'created',v_created,'skipped',v_skipped,'idempotent',false);
end;
$$;

revoke all on function public.phf_checklist_recovery_audit_immutable() from public,anon,authenticated;
revoke all on function public.phf_recovery_create_missing_monthly_forms(text,jsonb,jsonb,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.phf_recovery_create_missing_monthly_forms(text,jsonb,jsonb,text,text,text,text,text) to service_role;
commit;
notify pgrst,'reload schema';
