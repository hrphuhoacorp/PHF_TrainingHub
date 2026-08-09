-- PHF KNL Batch 3 — Survey V1 (additive migration; run manually in Production)
-- Depends on PHF_KNL_FRAMEWORK_VERSION_DYNAMIC_1.47.0.sql and
-- PHF_KNL_ASSIGNMENT_SOURCE_MANIFEST_1.48.0.sql.

begin;

create table if not exists public.knl_survey_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 3 and 160),
  description text,
  status text not null default 'DRAFT' check (status in ('DRAFT','OPEN','CLOSED')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  opened_at timestamptz,
  closed_at timestamptz,
  created_by text,
  created_by_name text,
  updated_by text,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((status='DRAFT' and opened_at is null) or status<>'DRAFT')
);

create table if not exists public.knl_survey_campaign_versions (
  campaign_id uuid not null references public.knl_survey_campaigns(id) on delete cascade,
  version_id uuid not null references public.knl_framework_versions(id) on delete restrict,
  framework_id uuid not null references public.knl_frameworks(id) on delete restrict,
  framework_code text not null,
  framework_name text not null,
  version_number integer not null,
  version_name text not null,
  created_at timestamptz not null default now(),
  primary key(campaign_id,version_id)
);

create table if not exists public.knl_survey_campaign_targets (
  campaign_id uuid not null references public.knl_survey_campaigns(id) on delete cascade,
  employee_code text not null,
  employee_name text not null,
  organization_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(campaign_id,employee_code),
  check (employee_code=btrim(employee_code) and employee_code<>'')
);

create table if not exists public.knl_survey_tickets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.knl_survey_campaigns(id) on delete restrict,
  version_id uuid not null references public.knl_framework_versions(id) on delete restrict,
  employee_code text not null,
  employee_name text not null,
  organization_snapshot jsonb not null default '{}'::jsonb,
  framework_snapshot jsonb not null,
  status text not null default 'NOT_STARTED' check (status in ('NOT_STARTED','IN_PROGRESS','SUBMITTED')),
  general_feedback text,
  revision integer not null default 0 check (revision>=0),
  first_saved_at timestamptz,
  submitted_at timestamptz,
  last_submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id,employee_code,version_id)
);

create table if not exists public.knl_survey_responses (
  ticket_id uuid not null references public.knl_survey_tickets(id) on delete cascade,
  item_id uuid not null references public.knl_competency_items(id) on delete restrict,
  selected_column_id uuid references public.knl_structure_columns(id) on delete restrict,
  selected_level_number integer,
  suitability text check (suitability in ('SUITABLE','UNCLEAR','UNSUITABLE')),
  comment text,
  updated_at timestamptz not null default now(),
  primary key(ticket_id,item_id),
  check ((selected_column_id is null and selected_level_number is null) or (selected_column_id is not null and selected_level_number is not null))
);

create table if not exists public.knl_survey_submission_history (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.knl_survey_tickets(id) on delete restrict,
  revision integer not null,
  action text not null check (action in ('SUBMIT','RESUBMIT')),
  response_snapshot jsonb not null,
  general_feedback text,
  submitted_by text,
  submitted_by_name text,
  submitted_at timestamptz not null default now(),
  unique(ticket_id,revision)
);

create table if not exists public.knl_survey_audit (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  actor_id text,
  actor_name text,
  created_at timestamptz not null default now()
);

create index if not exists knl_survey_campaign_status_idx on public.knl_survey_campaigns(status,ends_at);
create index if not exists knl_survey_ticket_employee_idx on public.knl_survey_tickets(employee_code,status);
create index if not exists knl_survey_ticket_campaign_idx on public.knl_survey_tickets(campaign_id,status);
create index if not exists knl_survey_response_item_idx on public.knl_survey_responses(item_id,suitability);
create index if not exists knl_survey_history_ticket_idx on public.knl_survey_submission_history(ticket_id,revision desc);
create index if not exists knl_survey_audit_entity_idx on public.knl_survey_audit(entity_type,entity_id,created_at desc);

create or replace function public.knl_survey_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end $$;

create or replace function public.knl_save_survey_campaign(
  p_campaign jsonb,p_version_ids uuid[],p_targets jsonb,p_actor_id text default null,p_actor_name text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_before jsonb:='{}'; v_status text; v_target jsonb;
begin
  if coalesce(array_length(p_version_ids,1),0)=0 then raise exception 'KNL_SURVEY_VERSIONS_REQUIRED' using errcode='22023'; end if;
  if jsonb_typeof(p_targets)<>'array' or jsonb_array_length(p_targets)=0 then raise exception 'KNL_SURVEY_TARGETS_REQUIRED' using errcode='22023'; end if;
  v_id=nullif(p_campaign->>'id','')::uuid;
  if v_id is not null then
    select status,to_jsonb(c) into v_status,v_before from public.knl_survey_campaigns c where id=v_id for update;
    if not found then raise exception 'KNL_SURVEY_CAMPAIGN_NOT_FOUND' using errcode='P0002'; end if;
    if v_status<>'DRAFT' then raise exception 'KNL_SURVEY_CAMPAIGN_IMMUTABLE' using errcode='55000'; end if;
    update public.knl_survey_campaigns set name=btrim(p_campaign->>'name'),description=nullif(btrim(p_campaign->>'description'),''),starts_at=(p_campaign->>'startsAt')::timestamptz,ends_at=(p_campaign->>'endsAt')::timestamptz,updated_by=p_actor_id,updated_by_name=p_actor_name where id=v_id;
    delete from public.knl_survey_campaign_versions where campaign_id=v_id;
    delete from public.knl_survey_campaign_targets where campaign_id=v_id;
  else
    insert into public.knl_survey_campaigns(name,description,starts_at,ends_at,created_by,created_by_name,updated_by,updated_by_name)
    values(btrim(p_campaign->>'name'),nullif(btrim(p_campaign->>'description'),''),(p_campaign->>'startsAt')::timestamptz,(p_campaign->>'endsAt')::timestamptz,p_actor_id,p_actor_name,p_actor_id,p_actor_name) returning id into v_id;
  end if;
  insert into public.knl_survey_campaign_versions(campaign_id,version_id,framework_id,framework_code,framework_name,version_number,version_name)
  select v_id,v.id,f.id,f.code,f.name,v.version_number,v.name from public.knl_framework_versions v join public.knl_frameworks f on f.id=v.framework_id where v.id=any(p_version_ids) and v.status='published' and v.is_locked=true;
  if (select count(*) from public.knl_survey_campaign_versions where campaign_id=v_id)<>array_length(p_version_ids,1) then raise exception 'KNL_SURVEY_VERSION_NOT_PUBLISHED' using errcode='22023'; end if;
  for v_target in select value from jsonb_array_elements(p_targets) loop
    insert into public.knl_survey_campaign_targets(campaign_id,employee_code,employee_name,organization_snapshot)
    values(v_id,upper(btrim(v_target->>'employeeCode')),btrim(v_target->>'employeeName'),coalesce(v_target->'organizationSnapshot','{}'::jsonb));
  end loop;
  insert into public.knl_survey_audit(entity_type,entity_id,action,before_data,after_data,actor_id,actor_name)
  select 'campaign',v_id,case when v_before='{}'::jsonb then 'CREATE_DRAFT' else 'UPDATE_DRAFT' end,v_before,to_jsonb(c),p_actor_id,p_actor_name from public.knl_survey_campaigns c where c.id=v_id;
  return v_id;
end $$;

create or replace function public.knl_open_survey_campaign(p_campaign_id uuid,p_actor_id text default null,p_actor_name text default null)
returns integer language plpgsql security definer set search_path=public as $$
declare v_campaign public.knl_survey_campaigns%rowtype; v_count integer;
begin
  select * into v_campaign from public.knl_survey_campaigns where id=p_campaign_id for update;
  if not found then raise exception 'KNL_SURVEY_CAMPAIGN_NOT_FOUND' using errcode='P0002'; end if;
  if v_campaign.status='CLOSED' then raise exception 'KNL_SURVEY_CAMPAIGN_CLOSED' using errcode='55000'; end if;
  insert into public.knl_survey_tickets(campaign_id,version_id,employee_code,employee_name,organization_snapshot,framework_snapshot)
  select p_campaign_id,cv.version_id,t.employee_code,t.employee_name,t.organization_snapshot,
    jsonb_build_object('frameworkId',cv.framework_id,'frameworkCode',cv.framework_code,'frameworkName',cv.framework_name,'versionId',cv.version_id,'versionNumber',cv.version_number,'versionName',cv.version_name)
  from public.knl_survey_campaign_targets t join public.knl_survey_campaign_versions cv on cv.campaign_id=t.campaign_id
  join public.knl_framework_assignments a on a.version_id=cv.version_id and a.employee_code=t.employee_code and a.target_type='employee' and a.status='active'
  where t.campaign_id=p_campaign_id on conflict(campaign_id,employee_code,version_id) do nothing;
  get diagnostics v_count=row_count;
  if not exists(select 1 from public.knl_survey_tickets where campaign_id=p_campaign_id) then raise exception 'KNL_SURVEY_NO_ELIGIBLE_TICKETS' using errcode='22023'; end if;
  -- Campaign chỉ nhận Published + locked version. Không UPDATE lại version đã
  -- khóa (guard Batch 1 sẽ và phải từ chối mutation); FK restrict giữ reference.
  update public.knl_survey_campaigns set status='OPEN',opened_at=coalesce(opened_at,now()),updated_by=p_actor_id,updated_by_name=p_actor_name where id=p_campaign_id and status='DRAFT';
  insert into public.knl_survey_audit(entity_type,entity_id,action,actor_id,actor_name) values('campaign',p_campaign_id,'OPEN',p_actor_id,p_actor_name);
  return v_count;
end $$;

create or replace function public.knl_close_survey_campaign(p_campaign_id uuid,p_actor_id text default null,p_actor_name text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.knl_survey_campaigns set status='CLOSED',closed_at=coalesce(closed_at,now()),updated_by=p_actor_id,updated_by_name=p_actor_name where id=p_campaign_id and status='OPEN';
  if not found then raise exception 'KNL_SURVEY_CAMPAIGN_NOT_OPEN' using errcode='55000'; end if;
  insert into public.knl_survey_audit(entity_type,entity_id,action,actor_id,actor_name) values('campaign',p_campaign_id,'CLOSE',p_actor_id,p_actor_name);
end $$;

create or replace function public.knl_save_survey_ticket(
  p_ticket_id uuid,p_employee_code text,p_responses jsonb,p_general_feedback text,p_submit boolean,p_actor_id text default null,p_actor_name text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.knl_survey_tickets%rowtype; c public.knl_survey_campaigns%rowtype; r jsonb; v_revision integer; v_missing uuid;
begin
  select * into t from public.knl_survey_tickets where id=p_ticket_id for update;
  if not found then raise exception 'KNL_SURVEY_TICKET_NOT_FOUND' using errcode='P0002'; end if;
  if t.employee_code<>upper(btrim(p_employee_code)) then raise exception 'KNL_SURVEY_OWN_ONLY' using errcode='42501'; end if;
  select * into c from public.knl_survey_campaigns where id=t.campaign_id;
  if c.status<>'OPEN' or now()<c.starts_at or now()>c.ends_at then raise exception 'KNL_SURVEY_DEADLINE_LOCKED' using errcode='55000'; end if;
  if jsonb_typeof(p_responses)<>'array' then raise exception 'KNL_SURVEY_RESPONSES_INVALID' using errcode='22023'; end if;
  for r in select value from jsonb_array_elements(p_responses) loop
    if not exists(select 1 from public.knl_competency_items i where i.id=(r->>'itemId')::uuid and i.version_id=t.version_id and i.is_active=true) then raise exception 'KNL_SURVEY_ITEM_INVALID' using errcode='22023'; end if;
    if nullif(r->>'selectedColumnId','') is not null and not exists(select 1 from public.knl_structure_columns sc where sc.id=(r->>'selectedColumnId')::uuid and sc.version_id=t.version_id and sc.column_type='level' and sc.is_active=true and sc.level_number=(r->>'selectedLevelNumber')::integer) then raise exception 'KNL_SURVEY_LEVEL_INVALID' using errcode='22023'; end if;
    if coalesce(r->>'suitability','') not in ('','SUITABLE','UNCLEAR','UNSUITABLE') then raise exception 'KNL_SURVEY_SUITABILITY_INVALID' using errcode='22023'; end if;
    if r->>'suitability' in ('UNCLEAR','UNSUITABLE') and btrim(coalesce(r->>'comment',''))='' then raise exception 'KNL_SURVEY_COMMENT_REQUIRED' using errcode='22023'; end if;
    insert into public.knl_survey_responses(ticket_id,item_id,selected_column_id,selected_level_number,suitability,comment)
    values(t.id,(r->>'itemId')::uuid,nullif(r->>'selectedColumnId','')::uuid,nullif(r->>'selectedLevelNumber','')::integer,nullif(r->>'suitability',''),nullif(btrim(r->>'comment'),''))
    on conflict(ticket_id,item_id) do update set selected_column_id=excluded.selected_column_id,selected_level_number=excluded.selected_level_number,suitability=excluded.suitability,comment=excluded.comment,updated_at=now();
  end loop;
  if p_submit then
    select i.id into v_missing from public.knl_competency_items i left join public.knl_survey_responses sr on sr.ticket_id=t.id and sr.item_id=i.id
    where i.version_id=t.version_id and i.is_active=true and (sr.selected_column_id is null or sr.suitability is null or (sr.suitability in ('UNCLEAR','UNSUITABLE') and btrim(coalesce(sr.comment,''))='')) order by i.sort_order limit 1;
    if v_missing is not null then raise exception 'KNL_SURVEY_INCOMPLETE:%',v_missing using errcode='22023'; end if;
    v_revision=t.revision+1;
    insert into public.knl_survey_submission_history(ticket_id,revision,action,response_snapshot,general_feedback,submitted_by,submitted_by_name)
    select t.id,v_revision,case when t.revision=0 then 'SUBMIT' else 'RESUBMIT' end,coalesce(jsonb_agg(to_jsonb(sr) order by i.sort_order),'[]'::jsonb),nullif(btrim(p_general_feedback),''),p_actor_id,p_actor_name
    from public.knl_competency_items i left join public.knl_survey_responses sr on sr.ticket_id=t.id and sr.item_id=i.id where i.version_id=t.version_id and i.is_active=true;
    update public.knl_survey_tickets set status='SUBMITTED',general_feedback=nullif(btrim(p_general_feedback),''),revision=v_revision,submitted_at=coalesce(submitted_at,now()),last_submitted_at=now(),first_saved_at=coalesce(first_saved_at,now()) where id=t.id;
  else
    update public.knl_survey_tickets set status=case when status='NOT_STARTED' then 'IN_PROGRESS' else status end,general_feedback=nullif(btrim(p_general_feedback),''),first_saved_at=coalesce(first_saved_at,now()) where id=t.id;
  end if;
  return jsonb_build_object('ticketId',t.id,'status',case when p_submit then 'SUBMITTED' else case when t.status='NOT_STARTED' then 'IN_PROGRESS' else t.status end end,'revision',case when p_submit then v_revision else t.revision end);
end $$;

create or replace function public.knl_guard_surveyed_structure_delete() returns trigger language plpgsql as $$
declare v_version uuid; v_old jsonb;
begin
  -- OLD là RECORD động theo từng trigger table. Không truy cập OLD.version_id
  -- trực tiếp vì knl_framework_versions không có field đó; PostgreSQL resolve
  -- field của RECORD trước khi CASE short-circuit và sẽ lỗi khi xóa Draft.
  v_old=to_jsonb(old);
  v_version=case when tg_table_name='knl_framework_versions' then nullif(v_old->>'id','')::uuid else nullif(v_old->>'version_id','')::uuid end;
  if exists(select 1 from public.knl_survey_tickets where version_id=v_version) then raise exception 'KNL_SURVEY_REFERENCE_DELETE_GUARD' using errcode='55000'; end if;
  return old;
end $$;

do $$ declare n text; begin
  foreach n in array array['knl_framework_versions','knl_competency_groups','knl_competency_items','knl_structure_columns','knl_item_level_contents'] loop
    if not exists(select 1 from pg_trigger where tgname='trg_'||n||'_survey_delete_guard' and tgrelid=('public.'||n)::regclass) then execute format('create trigger %I before delete on public.%I for each row execute function public.knl_guard_surveyed_structure_delete()','trg_'||n||'_survey_delete_guard',n); end if;
  end loop;
  if not exists(select 1 from pg_trigger where tgname='trg_knl_survey_campaign_touch') then create trigger trg_knl_survey_campaign_touch before update on public.knl_survey_campaigns for each row execute function public.knl_survey_touch_updated_at(); end if;
  if not exists(select 1 from pg_trigger where tgname='trg_knl_survey_ticket_touch') then create trigger trg_knl_survey_ticket_touch before update on public.knl_survey_tickets for each row execute function public.knl_survey_touch_updated_at(); end if;
end $$;

alter table public.knl_survey_campaigns enable row level security;
alter table public.knl_survey_campaign_versions enable row level security;
alter table public.knl_survey_campaign_targets enable row level security;
alter table public.knl_survey_tickets enable row level security;
alter table public.knl_survey_responses enable row level security;
alter table public.knl_survey_submission_history enable row level security;
alter table public.knl_survey_audit enable row level security;
revoke all on public.knl_survey_campaigns,public.knl_survey_campaign_versions,public.knl_survey_campaign_targets,public.knl_survey_tickets,public.knl_survey_responses,public.knl_survey_submission_history,public.knl_survey_audit from public,anon,authenticated;
revoke all on function public.knl_save_survey_campaign(jsonb,uuid[],jsonb,text,text),public.knl_open_survey_campaign(uuid,text,text),public.knl_close_survey_campaign(uuid,text,text),public.knl_save_survey_ticket(uuid,text,jsonb,text,boolean,text,text) from public,anon,authenticated;
grant execute on function public.knl_save_survey_campaign(jsonb,uuid[],jsonb,text,text),public.knl_open_survey_campaign(uuid,text,text),public.knl_close_survey_campaign(uuid,text,text),public.knl_save_survey_ticket(uuid,text,jsonb,text,boolean,text,text) to service_role;

comment on table public.knl_survey_tickets is 'One immutable version-specific Survey V1 form per campaign + employee + framework version; never an Assessment or score.';
commit;
