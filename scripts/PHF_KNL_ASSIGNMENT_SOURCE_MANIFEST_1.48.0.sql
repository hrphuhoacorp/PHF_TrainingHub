-- PHF KNL Batch 2: source manifest + employee/position assignments.
-- Additive only. Does not create an employee/org master and never writes Checklist.
begin;

create table if not exists public.knl_source_manifests (
  id uuid primary key default gen_random_uuid(),
  manifest_key text not null unique,
  spec_date date not null,
  source_file text not null,
  source_sheet text not null,
  source_position text,
  source_guidance text,
  source_hash text not null,
  payload_hash text not null,
  candidate_status text not null check(candidate_status in ('READY','NEEDS_REVIEW','EXCLUDED')),
  import_status text not null default 'PENDING' check(import_status in ('PENDING','SEEDED','SKIPPED','CONFLICT')),
  decision_reason text not null,
  level_count integer not null default 0 check(level_count between 0 and 20),
  expected_groups integer not null default 0 check(expected_groups >= 0),
  expected_items integer not null default 0 check(expected_items >= 0),
  expected_contents integer not null default 0 check(expected_contents >= 0),
  framework_id uuid references public.knl_frameworks(id) on delete restrict,
  version_id uuid references public.knl_framework_versions(id) on delete restrict,
  result_summary jsonb not null default '{}'::jsonb,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  constraint knl_source_hash_format check(source_hash='' or source_hash ~ '^[0-9a-f]{64}$'),
  constraint knl_payload_hash_format check(payload_hash ~ '^[0-9a-f]{64}$')
);
create index if not exists knl_source_manifest_status_idx on public.knl_source_manifests(candidate_status,import_status,updated_at desc);
create index if not exists knl_source_manifest_version_idx on public.knl_source_manifests(version_id) where version_id is not null;

alter table public.knl_frameworks add column if not exists source_manifest_id uuid references public.knl_source_manifests(id) on delete restrict;
alter table public.knl_frameworks add column if not exists source_key text;
alter table public.knl_frameworks add column if not exists source_hash text;
create unique index if not exists knl_frameworks_source_key_uq on public.knl_frameworks(source_key) where source_key is not null;

alter table public.knl_framework_versions add column if not exists source_manifest_id uuid references public.knl_source_manifests(id) on delete restrict;
alter table public.knl_framework_versions add column if not exists source_key text;
alter table public.knl_framework_versions add column if not exists source_hash text;
create unique index if not exists knl_versions_source_key_uq on public.knl_framework_versions(source_key) where source_key is not null;

alter table public.knl_competency_groups add column if not exists source_manifest_id uuid references public.knl_source_manifests(id) on delete restrict;
alter table public.knl_competency_groups add column if not exists source_key text;
alter table public.knl_competency_groups add column if not exists source_hash text;
create unique index if not exists knl_groups_source_key_uq on public.knl_competency_groups(source_key) where source_key is not null;

alter table public.knl_competency_items add column if not exists source_manifest_id uuid references public.knl_source_manifests(id) on delete restrict;
alter table public.knl_competency_items add column if not exists source_key text;
alter table public.knl_competency_items add column if not exists source_hash text;
create unique index if not exists knl_items_source_key_uq on public.knl_competency_items(source_key) where source_key is not null;

alter table public.knl_structure_columns add column if not exists source_manifest_id uuid references public.knl_source_manifests(id) on delete restrict;
alter table public.knl_structure_columns add column if not exists source_key text;
alter table public.knl_structure_columns add column if not exists source_hash text;
create unique index if not exists knl_columns_source_key_uq on public.knl_structure_columns(source_key) where source_key is not null;

alter table public.knl_item_level_contents add column if not exists source_manifest_id uuid references public.knl_source_manifests(id) on delete restrict;
alter table public.knl_item_level_contents add column if not exists source_key text;
alter table public.knl_item_level_contents add column if not exists source_hash text;
create unique index if not exists knl_level_contents_source_key_uq on public.knl_item_level_contents(source_key) where source_key is not null;

create table if not exists public.knl_framework_assignments (
  id uuid primary key default gen_random_uuid(),
  assignment_key text not null unique,
  version_id uuid not null references public.knl_framework_versions(id) on delete restrict,
  target_type text not null check(target_type in ('employee','position')),
  target_ref text not null,
  employee_code text,
  position_ref text,
  organization_snapshot jsonb not null default '{}'::jsonb,
  is_primary boolean not null default false,
  status text not null default 'active' check(status in ('active','inactive')),
  valid_from date not null default current_date,
  valid_to date,
  reason text not null,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  unique(version_id,target_type,target_ref),
  constraint knl_assignment_target_consistent check(
    (target_type='employee' and employee_code=target_ref and position_ref is null) or
    (target_type='position' and position_ref=target_ref and employee_code is null)
  ),
  constraint knl_assignment_dates_valid check(valid_to is null or valid_to >= valid_from)
);
create index if not exists knl_assignments_version_idx on public.knl_framework_assignments(version_id,status);
create index if not exists knl_assignments_employee_idx on public.knl_framework_assignments(employee_code,status) where employee_code is not null;
create index if not exists knl_assignments_position_idx on public.knl_framework_assignments(position_ref,status) where position_ref is not null;
create unique index if not exists knl_assignment_primary_target_uq on public.knl_framework_assignments(target_type,target_ref) where is_primary=true and status='active';

create table if not exists public.knl_framework_assignment_history (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid,
  action text not null check(action in ('insert','update','delete')),
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  changed_by text,
  changed_by_name text,
  changed_at timestamptz not null default now()
);
create index if not exists knl_assignment_history_idx on public.knl_framework_assignment_history(assignment_id,changed_at desc);

create or replace function public.knl_audit_assignment_change() returns trigger
language plpgsql as $$
declare before_row jsonb; after_row jsonb; actor_id text; actor_name text;
begin
  before_row:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
  after_row:=case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
  actor_id:=coalesce(after_row->>'updated_by',after_row->>'created_by',before_row->>'updated_by',before_row->>'created_by');
  actor_name:=coalesce(after_row->>'updated_by_name',after_row->>'created_by_name',before_row->>'updated_by_name',before_row->>'created_by_name');
  insert into public.knl_framework_assignment_history(assignment_id,action,before_data,after_data,changed_by,changed_by_name)
    values(coalesce(new.id,old.id),lower(tg_op),before_row,after_row,actor_id,actor_name);
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

do $$ begin
  if not exists(select 1 from pg_trigger where tgname='trg_knl_assignment_touch' and tgrelid='public.knl_framework_assignments'::regclass) then
    create trigger trg_knl_assignment_touch before update on public.knl_framework_assignments for each row execute function public.knl_touch_updated_at();
  end if;
  if not exists(select 1 from pg_trigger where tgname='trg_knl_assignment_audit' and tgrelid='public.knl_framework_assignments'::regclass) then
    create trigger trg_knl_assignment_audit after insert or update or delete on public.knl_framework_assignments for each row execute function public.knl_audit_assignment_change();
  end if;
  if not exists(select 1 from pg_trigger where tgname='trg_knl_source_manifest_touch' and tgrelid='public.knl_source_manifests'::regclass) then
    create trigger trg_knl_source_manifest_touch before update on public.knl_source_manifests for each row execute function public.knl_touch_updated_at();
  end if;
end $$;

create or replace function public.knl_seed_source_candidate(p_candidate jsonb,p_actor_id text default null,p_actor_name text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  existing public.knl_source_manifests%rowtype; manifest public.knl_source_manifests%rowtype;
  framework public.knl_frameworks%rowtype; version public.knl_framework_versions%rowtype;
  column_row jsonb; group_row jsonb; item_row jsonb; level_text text;
  group_id uuid; item_id uuid; column_id uuid; level_index integer;
  v_candidate_status text:=p_candidate->>'candidateStatus'; v_manifest_key text:=p_candidate->>'manifestKey';
  v_source_hash text:=coalesce(p_candidate->>'sourceHash',''); v_payload_hash text:=p_candidate->>'payloadHash';
  result jsonb;
begin
  if v_manifest_key is null or v_payload_hash is null or v_candidate_status not in ('READY','NEEDS_REVIEW','EXCLUDED') then
    raise exception 'KNL_SOURCE_MANIFEST_INVALID' using errcode='22023';
  end if;
  select * into existing from public.knl_source_manifests m where m.manifest_key=v_manifest_key for update;
  if found and (existing.source_hash<>v_source_hash or existing.payload_hash<>v_payload_hash) then
    update public.knl_source_manifests set import_status='CONFLICT',decision_reason='SOURCE_HASH_CHANGED_REVIEW_REQUIRED',updated_by=p_actor_id,updated_by_name=p_actor_name where id=existing.id returning * into manifest;
    return jsonb_build_object('manifestKey',v_manifest_key,'status','CONFLICT','reason','SOURCE_HASH_CHANGED_REVIEW_REQUIRED');
  end if;
  if not found then
    insert into public.knl_source_manifests(manifest_key,spec_date,source_file,source_sheet,source_position,source_guidance,source_hash,payload_hash,candidate_status,import_status,decision_reason,level_count,expected_groups,expected_items,expected_contents,created_by,created_by_name,updated_by,updated_by_name)
      values(v_manifest_key,(p_candidate->>'specDate')::date,p_candidate->>'sourceFile',p_candidate->>'sourceSheet',nullif(p_candidate->>'sourcePosition',''),nullif(p_candidate->>'guidance',''),v_source_hash,v_payload_hash,v_candidate_status,'PENDING',p_candidate->>'decisionReason',coalesce((p_candidate->>'levelCount')::int,0),coalesce((p_candidate#>>'{counts,groups}')::int,0),coalesce((p_candidate#>>'{counts,items}')::int,0),coalesce((p_candidate#>>'{counts,contents}')::int,0),p_actor_id,p_actor_name,p_actor_id,p_actor_name)
      returning * into manifest;
  else manifest:=existing;
  end if;
  if v_candidate_status<>'READY' then
    update public.knl_source_manifests set import_status='SKIPPED',updated_by=p_actor_id,updated_by_name=p_actor_name,result_summary=jsonb_build_object('reason',p_candidate->>'decisionReason') where id=manifest.id;
    return jsonb_build_object('manifestKey',v_manifest_key,'status','SKIPPED','reason',p_candidate->>'decisionReason');
  end if;
  if manifest.import_status='SEEDED' then
    return manifest.result_summary||jsonb_build_object('manifestKey',v_manifest_key,'status','UNCHANGED');
  end if;

  insert into public.knl_frameworks(code,name,description,status,source_manifest_id,source_key,source_hash,created_by,created_by_name,updated_by,updated_by_name)
    values(p_candidate->>'frameworkCode',p_candidate->>'frameworkName',null,'draft',manifest.id,v_manifest_key,v_source_hash,p_actor_id,p_actor_name,p_actor_id,p_actor_name)
    returning * into framework;
  insert into public.knl_framework_versions(framework_id,version_number,name,description,status,source_manifest_id,source_key,source_hash,created_by,created_by_name,updated_by,updated_by_name)
    values(framework.id,1,p_candidate->>'versionName',null,'draft',manifest.id,p_candidate->>'sourceVersionKey',v_source_hash,p_actor_id,p_actor_name,p_actor_id,p_actor_name)
    returning * into version;

  for column_row in select value from jsonb_array_elements(coalesce(p_candidate->'columns','[]'::jsonb)) loop
    insert into public.knl_structure_columns(version_id,column_type,label,level_number,sort_order,is_active,source_manifest_id,source_key,source_hash,created_by,created_by_name,updated_by,updated_by_name)
      values(version.id,column_row->>'type',column_row->>'label',nullif(column_row->>'levelNumber','')::int,(column_row->>'sortOrder')::int,true,manifest.id,column_row->>'sourceKey',v_payload_hash,p_actor_id,p_actor_name,p_actor_id,p_actor_name);
  end loop;
  for group_row in select value from jsonb_array_elements(coalesce(p_candidate->'groups','[]'::jsonb)) loop
    insert into public.knl_competency_groups(version_id,name,description,sort_order,is_active,source_manifest_id,source_key,source_hash,created_by,created_by_name,updated_by,updated_by_name)
      values(version.id,group_row->>'name',null,(group_row->>'sortOrder')::int,true,manifest.id,group_row->>'sourceKey',v_payload_hash,p_actor_id,p_actor_name,p_actor_id,p_actor_name) returning id into group_id;
    for item_row in select value from jsonb_array_elements(coalesce(group_row->'items','[]'::jsonb)) loop
      insert into public.knl_competency_items(version_id,group_id,name,description,sort_order,is_active,source_manifest_id,source_key,source_hash,created_by,created_by_name,updated_by,updated_by_name)
        values(version.id,group_id,item_row->>'name',nullif(item_row->>'description',''),(item_row->>'sortOrder')::int,true,manifest.id,item_row->>'sourceKey',v_payload_hash,p_actor_id,p_actor_name,p_actor_id,p_actor_name) returning id into item_id;
      level_index:=0;
      for level_text in select value#>>'{}' from jsonb_array_elements(coalesce(item_row->'levels','[]'::jsonb)) loop
        level_index:=level_index+1;
        if nullif(btrim(level_text),'') is not null then
          select id into column_id from public.knl_structure_columns where source_key=v_manifest_key||':column:level:'||level_index::text;
          insert into public.knl_item_level_contents(version_id,item_id,column_id,content,source_manifest_id,source_key,source_hash,created_by,created_by_name,updated_by,updated_by_name)
            values(version.id,item_id,column_id,level_text,manifest.id,(item_row->>'sourceKey')||':level:'||level_index::text,v_payload_hash,p_actor_id,p_actor_name,p_actor_id,p_actor_name);
        end if;
      end loop;
    end loop;
  end loop;
  result:=jsonb_build_object('status','SEEDED','frameworks',1,'versions',1,'groups',(p_candidate#>>'{counts,groups}')::int,'items',(p_candidate#>>'{counts,items}')::int,'contents',(p_candidate#>>'{counts,contents}')::int,'frameworkId',framework.id,'versionId',version.id);
  update public.knl_source_manifests set import_status='SEEDED',framework_id=framework.id,version_id=version.id,result_summary=result,updated_by=p_actor_id,updated_by_name=p_actor_name where id=manifest.id;
  return result||jsonb_build_object('manifestKey',v_manifest_key);
end $$;

alter table public.knl_source_manifests enable row level security;
alter table public.knl_framework_assignments enable row level security;
alter table public.knl_framework_assignment_history enable row level security;
revoke all on public.knl_source_manifests,public.knl_framework_assignments,public.knl_framework_assignment_history from anon,authenticated;
revoke all on function public.knl_seed_source_candidate(jsonb,text,text) from anon,authenticated;

comment on table public.knl_source_manifests is 'Idempotent PHF KNL source registry. Duplicate regular/v2/legacy sources remain NEEDS_REVIEW and create no framework.';
comment on table public.knl_framework_assignments is 'Version-specific KNL assignment to exact employee_code or adapter-validated position_ref; organization_snapshot is evidence, not a new org master.';

commit;
