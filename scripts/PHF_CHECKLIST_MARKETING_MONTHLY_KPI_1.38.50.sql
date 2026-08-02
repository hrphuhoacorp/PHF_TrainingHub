-- PHF Checklist 1.38.50 · KPI tháng Marketing hoạt động trước khi tạo phiếu
-- Phạm vi: TBP-MKT-1.0 và NV-MEDIA-1.0
-- Mẫu gốc/version giữ nguyên; cấu hình kỳ cập nhật snapshot phiếu bằng một transaction.

begin;
create extension if not exists pgcrypto;

create table if not exists public.checklist_monthly_kpi_configs(
  id uuid primary key default gen_random_uuid(),
  period_month text not null check(period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  department text not null,
  template_id text not null,
  template_version text not null,
  definition_snapshot jsonb not null default '{}'::jsonb,
  source_type text not null default 'monthly_form_snapshot',
  source_period_month text,
  revision integer not null default 1,
  is_exception boolean not null default false,
  exception_reason text not null default '',
  updated_by text,
  updated_by_code text,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(period_month,department,template_id)
);

create table if not exists public.checklist_monthly_kpi_config_history(
  id uuid primary key default gen_random_uuid(),
  config_id uuid references public.checklist_monthly_kpi_configs(id) on delete restrict,
  period_month text not null,
  department text not null,
  template_id text not null,
  template_version text not null,
  action text not null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  reason text not null default '',
  changed_by text,
  changed_by_code text,
  changed_by_name text,
  changed_at timestamptz not null default now()
);

create index if not exists checklist_monthly_kpi_configs_period_idx
  on public.checklist_monthly_kpi_configs(period_month,department,template_id);
create index if not exists checklist_monthly_kpi_config_history_idx
  on public.checklist_monthly_kpi_config_history(period_month,template_id,changed_at desc);

alter table public.checklist_monthly_kpi_configs enable row level security;
alter table public.checklist_monthly_kpi_config_history enable row level security;
revoke all on public.checklist_monthly_kpi_configs from anon,authenticated;
revoke all on public.checklist_monthly_kpi_config_history from anon,authenticated;

create or replace function public.phf_save_marketing_monthly_kpi(
  p_period_month text,
  p_department text,
  p_template_id text,
  p_template_version text,
  p_definition jsonb,
  p_expected_revision integer default 0,
  p_is_exception boolean default false,
  p_reason text default '',
  p_actor_id text default '',
  p_actor_code text default '',
  p_actor_name text default ''
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_template text := lower(trim(coalesce(p_template_id,'')));
  v_department text := trim(coalesce(p_department,''));
  v_config public.checklist_monthly_kpi_configs%rowtype;
  v_form public.checklist_monthly_forms%rowtype;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb;
  v_rows jsonb;
  v_existing_rows jsonb;
  v_base_definition jsonb;
  v_count integer;
  v_existing_count integer;
  v_total numeric := 0;
  v_invalid integer := 0;
  v_mismatch integer := 0;
  v_updated integer := 0;
  v_revision integer;
  v_action text;
begin
  if p_period_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    return jsonb_build_object('ok',false,'code','CHECKLIST_MARKETING_KPI_PERIOD_INVALID','message','Kỳ đánh giá không hợp lệ.');
  end if;
  if lower(v_department) <> 'marketing' then
    return jsonb_build_object('ok',false,'code','CHECKLIST_MARKETING_KPI_DEPARTMENT_FORBIDDEN','message','Chỉ áp dụng cho bộ phận Marketing.');
  end if;
  if v_template not in('tbp-mkt-1.0','nv-media-1.0') then
    return jsonb_build_object('ok',false,'code','CHECKLIST_MARKETING_KPI_TEMPLATE_FORBIDDEN','message','Mẫu không thuộc phạm vi KPI tháng Marketing.');
  end if;
  if jsonb_typeof(p_definition) <> 'object' or jsonb_typeof(p_definition->'totalRows') <> 'array' then
    return jsonb_build_object('ok',false,'code','CHECKLIST_MARKETING_KPI_DEFINITION_INVALID','message','Cấu hình tiêu chí không hợp lệ.');
  end if;

  perform pg_advisory_xact_lock(hashtext('phf_marketing_monthly_kpi|'||p_period_month||'|'||v_template));

  select * into v_form
  from public.checklist_monthly_forms
  where period_month=p_period_month
    and lower(trim(department))='marketing'
    and lower(trim(template_id))=v_template
  order by id
  limit 1
  for update;

  if v_form.id is not null and trim(coalesce(v_form.template_version,'')) <> trim(coalesce(p_template_version,'')) then
    return jsonb_build_object('ok',false,'code','CHECKLIST_MARKETING_KPI_VERSION_MISMATCH','message','Phiên bản mẫu đã thay đổi. Vui lòng tải lại.');
  end if;

  if v_form.id is not null then
    v_existing_rows := coalesce(v_form.template_snapshot#>'{version,definition,totalRows}','[]'::jsonb);
  else
    select definition into v_base_definition
    from public.checklist_template_versions
    where lower(trim(template_key))=v_template
      and trim(coalesce(version_no,''))=trim(coalesce(p_template_version,''))
    order by effective_date desc nulls last, created_at desc nulls last
    limit 1;
    if v_base_definition is null then
      return jsonb_build_object('ok',false,'code','CHECKLIST_MARKETING_KPI_TEMPLATE_VERSION_MISSING','message','Không tìm thấy phiên bản mẫu nền phù hợp.');
    end if;
    v_existing_rows := coalesce(v_base_definition->'totalRows','[]'::jsonb);
  end if;

  if exists(
    select 1 from public.checklist_monthly_forms f
    where f.period_month=p_period_month
      and lower(trim(f.department))='marketing'
      and lower(trim(f.template_id))=v_template
      and (
        f.self_saved_at is not null or f.self_submitted_at is not null or
        coalesce(f.self_answers,'{}'::jsonb) <> '{}'::jsonb
      )
  ) then
    raise exception 'CHECKLIST_MARKETING_KPI_SELF_STARTED';
  end if;

  v_rows := p_definition->'totalRows';
  v_count := jsonb_array_length(v_rows);
  v_existing_count := jsonb_array_length(v_existing_rows);
  if v_count <> v_existing_count then
    return jsonb_build_object('ok',false,'code','CHECKLIST_MARKETING_KPI_ROW_COUNT_CHANGED','message','Không được thêm hoặc xóa dòng tiêu chí trong cấu hình tháng.');
  end if;

  with incoming as(
    select ord,
      lower(trim(case when jsonb_typeof(value)='array' then value->>1 else coalesce(value->>'code','') end)) code,
      trim(case when jsonb_typeof(value)='array' then value->>2 else coalesce(value->>'content',value->>'name','') end) name,
      trim(case when jsonb_typeof(value)='array' then value->>3 else coalesce(value->>'target','') end) target,
      case when jsonb_typeof(value)='array' then nullif(value->>5,'')::numeric else nullif(value->>'weight','')::numeric end weight
    from jsonb_array_elements(v_rows) with ordinality x(value,ord)
  ), existing as(
    select ord,
      lower(trim(case when jsonb_typeof(value)='array' then value->>1 else coalesce(value->>'code','') end)) code
    from jsonb_array_elements(v_existing_rows) with ordinality x(value,ord)
  )
  select
    coalesce(sum(i.weight),0),
    count(*) filter(where i.code='' or i.name='' or i.target='' or i.weight is null or i.weight<0 or i.weight>100),
    count(*) filter(where e.code is null or e.code<>i.code)
  into v_total,v_invalid,v_mismatch
  from incoming i left join existing e on e.ord=i.ord;

  if v_invalid>0 then
    return jsonb_build_object('ok',false,'code','CHECKLIST_MARKETING_KPI_ROW_INVALID','message','Nội dung, mục tiêu và tỷ trọng của mọi tiêu chí phải hợp lệ.');
  end if;
  if v_mismatch>0 then
    return jsonb_build_object('ok',false,'code','CHECKLIST_MARKETING_KPI_ROW_MISMATCH','message','Không được đổi mã, thêm, xóa hoặc đảo cấu trúc dòng tiêu chí.');
  end if;
  if abs(v_total-100)>0.001 then
    return jsonb_build_object('ok',false,'code','CHECKLIST_MARKETING_KPI_WEIGHT_TOTAL_INVALID','message','Tổng tỷ trọng toàn phiếu phải đúng 100%.','totalWeight',v_total);
  end if;

  select * into v_config
  from public.checklist_monthly_kpi_configs
  where period_month=p_period_month and department='Marketing' and template_id=v_template
  for update;

  if v_config.id is not null then
    if coalesce(p_expected_revision,0) <> v_config.revision then
      raise exception 'CHECKLIST_MARKETING_KPI_STALE';
    end if;
    v_before := to_jsonb(v_config);
    v_revision := v_config.revision+1;
    update public.checklist_monthly_kpi_configs set
      template_version=p_template_version,
      definition_snapshot=p_definition,
      source_type='monthly_override',
      revision=v_revision,
      is_exception=coalesce(p_is_exception,false),
      exception_reason=case when coalesce(p_is_exception,false) then trim(coalesce(p_reason,'')) else '' end,
      updated_by=p_actor_id,
      updated_by_code=upper(trim(coalesce(p_actor_code,''))),
      updated_by_name=p_actor_name,
      updated_at=now()
    where id=v_config.id
    returning * into v_config;
    v_action := case when coalesce(p_is_exception,false) then 'exception_update' else 'update' end;
  else
    if coalesce(p_expected_revision,0) <> 0 then
      raise exception 'CHECKLIST_MARKETING_KPI_STALE';
    end if;
    insert into public.checklist_monthly_kpi_configs(
      period_month,department,template_id,template_version,definition_snapshot,
      source_type,revision,is_exception,exception_reason,
      updated_by,updated_by_code,updated_by_name
    ) values(
      p_period_month,'Marketing',v_template,p_template_version,p_definition,
      'monthly_override',1,coalesce(p_is_exception,false),case when coalesce(p_is_exception,false) then trim(coalesce(p_reason,'')) else '' end,
      p_actor_id,upper(trim(coalesce(p_actor_code,''))),p_actor_name
    ) returning * into v_config;
    v_revision := 1;
    v_action := case when coalesce(p_is_exception,false) then 'exception_create' else 'create' end;
  end if;

  update public.checklist_monthly_forms f set
    template_snapshot=jsonb_set(f.template_snapshot,'{version,definition}',p_definition,true),
    updated_at=now()
  where f.period_month=p_period_month
    and lower(trim(f.department))='marketing'
    and lower(trim(f.template_id))=v_template
    and trim(coalesce(f.template_version,''))=trim(coalesce(p_template_version,''));
  get diagnostics v_updated = row_count;


  v_after := to_jsonb(v_config);
  insert into public.checklist_monthly_kpi_config_history(
    config_id,period_month,department,template_id,template_version,action,
    before_data,after_data,reason,changed_by,changed_by_code,changed_by_name
  ) values(
    v_config.id,p_period_month,'Marketing',v_template,p_template_version,v_action,
    v_before,v_after,case when coalesce(p_is_exception,false) then trim(coalesce(p_reason,'')) else 'Cập nhật KPI tháng trong thời gian cho phép.' end,
    p_actor_id,upper(trim(coalesce(p_actor_code,''))),p_actor_name
  );

  insert into public.checklist_monthly_form_history(
    form_id,period_month,employee_code,action,before_data,after_data,reason,
    changed_by,changed_by_code,changed_by_name
  )
  select f.id,f.period_month,f.employee_code,'marketing_monthly_kpi_update',
    jsonb_build_object('templateVersion',p_template_version,'revision',greatest(v_revision-1,0)),
    jsonb_build_object('templateVersion',p_template_version,'revision',v_revision),
    case when coalesce(p_is_exception,false) then trim(coalesce(p_reason,'')) else 'Cập nhật KPI tháng Marketing.' end,
    p_actor_id,upper(trim(coalesce(p_actor_code,''))),p_actor_name
  from public.checklist_monthly_forms f
  where f.period_month=p_period_month
    and lower(trim(f.department))='marketing'
    and lower(trim(f.template_id))=v_template;

  return jsonb_build_object('ok',true,'revision',v_revision,'updatedForms',v_updated,'totalWeight',v_total,'configId',v_config.id);
end;
$$;

revoke all on function public.phf_save_marketing_monthly_kpi(text,text,text,text,jsonb,integer,boolean,text,text,text,text) from public,anon,authenticated;
grant execute on function public.phf_save_marketing_monthly_kpi(text,text,text,text,jsonb,integer,boolean,text,text,text,text) to service_role;

commit;
