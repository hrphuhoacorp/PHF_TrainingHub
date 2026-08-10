-- PHF KNL 1.50.0 — Competency Grade Standard + effective versioning
-- + Salary Grade / Reference Income foundation.
-- Additive only. Run manually in Production after application tests pass.
-- IMPORTANT: this migration creates no employee compensation assignment.
begin;

-- Existing framework version publication/locking remains the content immutability
-- contract used by Survey V1. Effective lifecycle is additive so Survey's
-- published+locked contract is not reinterpreted or broken.
alter table public.knl_framework_versions
  add column if not exists lifecycle_status text not null default 'DRAFT'
    check (lifecycle_status in ('DRAFT','SCHEDULED','ACTIVE','INACTIVE')),
  add column if not exists effective_from timestamptz,
  add column if not exists effective_to timestamptz,
  add column if not exists activated_at timestamptz;

create unique index if not exists knl_framework_one_active_version_idx
  on public.knl_framework_versions(framework_id)
  where lifecycle_status='ACTIVE';
create index if not exists knl_framework_due_version_idx
  on public.knl_framework_versions(lifecycle_status,effective_from)
  where lifecycle_status='SCHEDULED';

-- Extend Batch 1's immutable-version guard only for the additive lifecycle
-- fields. Framework/content identity remains byte-for-byte immutable.
create or replace function public.knl_guard_version_mutation() returns trigger
language plpgsql as $$
begin
  if tg_op='DELETE' then
    if old.status <> 'draft' or old.is_locked then raise exception 'KNL_VERSION_IMMUTABLE' using errcode='55000'; end if;
    return old;
  end if;
  if old.status <> 'draft' or old.is_locked then
    if not (
      new.framework_id=old.framework_id and new.version_number=old.version_number
      and new.name=old.name and new.description is not distinct from old.description
      and new.based_on_version_id is not distinct from old.based_on_version_id
      and new.is_locked=old.is_locked and new.locked_reason is not distinct from old.locked_reason
      and new.locked_at is not distinct from old.locked_at and new.published_at is not distinct from old.published_at
      and (new.status=old.status or (old.status='published' and new.status='inactive'))
      and (
        (new.lifecycle_status=old.lifecycle_status
          and (old.lifecycle_status='SCHEDULED' or (
            new.effective_from is not distinct from old.effective_from
            and new.effective_to is not distinct from old.effective_to
            and new.activated_at is not distinct from old.activated_at)))
        or (old.lifecycle_status in ('DRAFT','SCHEDULED') and new.lifecycle_status in ('SCHEDULED','ACTIVE'))
        or (old.lifecycle_status='ACTIVE' and new.lifecycle_status='INACTIVE')
      )
    ) then raise exception 'KNL_VERSION_IMMUTABLE' using errcode='55000'; end if;
  end if;
  return new;
end $$;

-- Required by composite version-consistency foreign keys below.
create unique index if not exists knl_competency_items_id_version_uq
  on public.knl_competency_items(id,version_id);
create unique index if not exists knl_structure_columns_id_version_uq
  on public.knl_structure_columns(id,version_id);

create table if not exists public.knl_grade_definitions (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.knl_framework_versions(id) on delete restrict,
  grade_code text not null check (grade_code ~ '^B[1-9][0-9]*$'),
  grade_number integer not null check (grade_number > 0),
  label text not null check (length(btrim(label)) between 2 and 80),
  sort_order integer not null check (sort_order > 0),
  created_by text,
  created_by_name text,
  updated_by text,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(version_id,grade_code),
  unique(version_id,grade_number),
  unique(version_id,sort_order),
  unique(id,version_id)
);

create table if not exists public.knl_grade_requirements (
  version_id uuid not null references public.knl_framework_versions(id) on delete restrict,
  item_id uuid not null,
  grade_id uuid not null,
  required_column_id uuid not null,
  required_level_number integer not null check (required_level_number > 0),
  created_by text,
  created_by_name text,
  updated_by text,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(item_id,grade_id),
  foreign key(item_id,version_id) references public.knl_competency_items(id,version_id) on delete restrict,
  foreign key(grade_id,version_id) references public.knl_grade_definitions(id,version_id) on delete restrict,
  foreign key(required_column_id,version_id) references public.knl_structure_columns(id,version_id) on delete restrict
);

create index if not exists knl_grade_requirement_version_idx
  on public.knl_grade_requirements(version_id,grade_id,item_id);

create or replace function public.knl_guard_grade_matrix_mutation()
returns trigger language plpgsql set search_path=public as $$
declare v_version uuid; v_row public.knl_framework_versions%rowtype;
begin
  v_version=coalesce(new.version_id,old.version_id);
  select * into v_row from public.knl_framework_versions where id=v_version;
  if not found or v_row.status<>'draft' or v_row.is_locked or v_row.lifecycle_status<>'DRAFT' then
    raise exception 'KNL_GRADE_MATRIX_IMMUTABLE' using errcode='55000';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

drop trigger if exists trg_knl_grade_definitions_mutable on public.knl_grade_definitions;
create trigger trg_knl_grade_definitions_mutable before insert or update or delete
  on public.knl_grade_definitions for each row execute function public.knl_guard_grade_matrix_mutation();
drop trigger if exists trg_knl_grade_requirements_mutable on public.knl_grade_requirements;
create trigger trg_knl_grade_requirements_mutable before insert or update or delete
  on public.knl_grade_requirements for each row execute function public.knl_guard_grade_matrix_mutation();

create or replace function public.knl_save_grade_matrix(
  p_version_id uuid,p_grades jsonb,p_requirements jsonb,
  p_actor_id text default null,p_actor_name text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_version public.knl_framework_versions%rowtype; g jsonb; r jsonb; v_grade uuid; v_count integer;
begin
  select * into v_version from public.knl_framework_versions where id=p_version_id for update;
  if not found then raise exception 'KNL_VERSION_NOT_FOUND' using errcode='P0002'; end if;
  if v_version.status<>'draft' or v_version.is_locked or v_version.lifecycle_status<>'DRAFT' then
    raise exception 'KNL_GRADE_MATRIX_IMMUTABLE' using errcode='55000';
  end if;
  if jsonb_typeof(p_grades)<>'array' or jsonb_array_length(p_grades)=0 then
    raise exception 'KNL_GRADES_REQUIRED' using errcode='22023';
  end if;
  if jsonb_typeof(p_requirements)<>'array' then
    raise exception 'KNL_GRADE_REQUIREMENTS_INVALID' using errcode='22023';
  end if;
  delete from public.knl_grade_requirements where version_id=p_version_id;
  delete from public.knl_grade_definitions where version_id=p_version_id;
  for g in select value from jsonb_array_elements(p_grades) loop
    if (g->>'gradeCode') is distinct from ('B'||(g->>'gradeNumber')) then raise exception 'KNL_GRADE_CODE_NUMBER_MISMATCH' using errcode='22023'; end if;
    insert into public.knl_grade_definitions(version_id,grade_code,grade_number,label,sort_order,created_by,created_by_name,updated_by,updated_by_name)
    values(p_version_id,upper(btrim(g->>'gradeCode')),(g->>'gradeNumber')::integer,btrim(g->>'label'),(g->>'sortOrder')::integer,p_actor_id,p_actor_name,p_actor_id,p_actor_name);
  end loop;
  if (select min(grade_number)=1 and max(grade_number)=count(*) from public.knl_grade_definitions where version_id=p_version_id) is not true then
    raise exception 'KNL_GRADES_MUST_BE_CONTIGUOUS' using errcode='22023';
  end if;
  for r in select value from jsonb_array_elements(p_requirements) loop
    select id into v_grade from public.knl_grade_definitions
      where version_id=p_version_id and grade_code=upper(btrim(r->>'gradeCode'));
    if v_grade is null then raise exception 'KNL_GRADE_NOT_FOUND:%',r->>'gradeCode' using errcode='22023'; end if;
    if not exists(select 1 from public.knl_competency_items i where i.id=(r->>'itemId')::uuid and i.version_id=p_version_id and i.is_active=true) then
      raise exception 'KNL_GRADE_ITEM_INVALID' using errcode='22023';
    end if;
    if not exists(
      select 1 from public.knl_structure_columns c
      where c.id=(r->>'requiredColumnId')::uuid and c.version_id=p_version_id
        and c.column_type='level' and c.is_active=true
        and c.level_number=(r->>'requiredLevelNumber')::integer
    ) then raise exception 'KNL_REQUIRED_LEVEL_INVALID' using errcode='22023'; end if;
    insert into public.knl_grade_requirements(version_id,item_id,grade_id,required_column_id,required_level_number,created_by,created_by_name,updated_by,updated_by_name)
    values(p_version_id,(r->>'itemId')::uuid,v_grade,(r->>'requiredColumnId')::uuid,(r->>'requiredLevelNumber')::integer,p_actor_id,p_actor_name,p_actor_id,p_actor_name);
  end loop;
  select count(*) into v_count from public.knl_grade_requirements where version_id=p_version_id;
  if v_count<>(select count(*) from public.knl_competency_items where version_id=p_version_id and is_active=true)*jsonb_array_length(p_grades) then
    raise exception 'KNL_GRADE_MATRIX_INCOMPLETE' using errcode='22023';
  end if;
  insert into public.knl_structure_audit(framework_id,version_id,entity_type,entity_id,action,before_data,after_data,changed_by,changed_by_name)
  values(v_version.framework_id,p_version_id,'grade_matrix',p_version_id,'update','{}'::jsonb,jsonb_build_object('grades',jsonb_array_length(p_grades),'requirements',v_count),p_actor_id,p_actor_name);
  return jsonb_build_object('grades',jsonb_array_length(p_grades),'requirements',v_count);
end $$;

create or replace function public.knl_validate_publishable(p_version_id uuid) returns void
language plpgsql as $$
declare item_columns int; description_columns int; level_columns int; active_items int; grades int; requirements int;
begin
  perform public.knl_assert_version_mutable(p_version_id);
  select count(*) filter(where column_type='item'),count(*) filter(where column_type='description'),count(*) filter(where column_type='level')
    into item_columns,description_columns,level_columns from public.knl_structure_columns where version_id=p_version_id and is_active=true;
  if item_columns<>1 then raise exception 'KNL_REQUIRES_ONE_ITEM_COLUMN' using errcode='23514'; end if;
  if description_columns>1 then raise exception 'KNL_ALLOWS_ZERO_OR_ONE_DESCRIPTION_COLUMN' using errcode='23514'; end if;
  if level_columns<1 then raise exception 'KNL_REQUIRES_AT_LEAST_ONE_LEVEL' using errcode='23514'; end if;
  select count(*) into active_items from public.knl_competency_items where version_id=p_version_id and is_active=true;
  select count(*) into grades from public.knl_grade_definitions where version_id=p_version_id;
  select count(*) into requirements from public.knl_grade_requirements where version_id=p_version_id;
  if grades<1 or requirements<>active_items*grades then raise exception 'KNL_GRADE_MATRIX_INCOMPLETE' using errcode='23514'; end if;
end $$;

create or replace function public.knl_set_version_effectivity(
  p_version_id uuid,p_effective_from timestamptz,p_actor_id text default null,p_actor_name text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.knl_framework_versions%rowtype; v_status text;
begin
  select * into v from public.knl_framework_versions where id=p_version_id for update;
  if not found then raise exception 'KNL_VERSION_NOT_FOUND' using errcode='P0002'; end if;
  if v.status<>'published' or not v.is_locked then raise exception 'KNL_VERSION_NOT_PUBLISHED' using errcode='55000'; end if;
  if v.lifecycle_status in ('ACTIVE','INACTIVE') then raise exception 'KNL_EFFECTIVE_HISTORY_IMMUTABLE' using errcode='55000'; end if;
  if p_effective_from is null then raise exception 'KNL_EFFECTIVE_FROM_REQUIRED' using errcode='22023'; end if;
  if p_effective_from<=now() then
    update public.knl_framework_versions set lifecycle_status='INACTIVE',effective_to=now(),updated_at=now(),updated_by=p_actor_id,updated_by_name=p_actor_name
      where framework_id=v.framework_id and lifecycle_status='ACTIVE' and id<>p_version_id;
    v_status='ACTIVE';
    update public.knl_framework_versions set lifecycle_status='ACTIVE',effective_from=p_effective_from,effective_to=null,activated_at=now(),updated_at=now(),updated_by=p_actor_id,updated_by_name=p_actor_name where id=p_version_id;
  else
    v_status='SCHEDULED';
    update public.knl_framework_versions set lifecycle_status='SCHEDULED',effective_from=p_effective_from,effective_to=null,updated_at=now(),updated_by=p_actor_id,updated_by_name=p_actor_name where id=p_version_id;
  end if;
  insert into public.knl_structure_audit(framework_id,version_id,entity_type,entity_id,action,before_data,after_data,changed_by,changed_by_name)
  values(v.framework_id,v.id,'version_effectivity',v.id,'update',to_jsonb(v),jsonb_build_object('lifecycleStatus',v_status,'effectiveFrom',p_effective_from),p_actor_id,p_actor_name);
  return jsonb_build_object('versionId',v.id,'lifecycleStatus',v_status,'effectiveFrom',p_effective_from);
end $$;

create or replace function public.knl_activate_due_versions()
returns integer language plpgsql security definer set search_path=public as $$
declare v record; n integer:=0;
begin
  for v in select id,framework_id,effective_from from public.knl_framework_versions
    where lifecycle_status='SCHEDULED' and effective_from<=now() order by effective_from,id for update
  loop
    update public.knl_framework_versions set lifecycle_status='INACTIVE',effective_to=v.effective_from,updated_at=now()
      where framework_id=v.framework_id and lifecycle_status='ACTIVE' and id<>v.id;
    update public.knl_framework_versions set lifecycle_status='ACTIVE',activated_at=now(),effective_to=null,updated_at=now() where id=v.id;
    n:=n+1;
  end loop;
  return n;
end $$;

-- Batch 1's clone RPC is extended after the grade tables exist. Every cloned
-- row receives a new id; requirements are remapped to the cloned item, grade
-- and level column so the source version remains immutable and independent.
create or replace function public.knl_clone_version(
  p_source_version_id uuid,p_name text,p_actor_id text default null,p_actor_name text default null
) returns public.knl_framework_versions
language plpgsql security definer set search_path=public as $$
declare
  source public.knl_framework_versions; saved public.knl_framework_versions;
  g record; i record; c record; lc record; gd record; gr record; new_id uuid;
  group_map jsonb:='{}'; item_map jsonb:='{}'; column_map jsonb:='{}'; grade_map jsonb:='{}';
begin
  select * into source from public.knl_framework_versions where id=p_source_version_id;
  if not found then raise exception 'KNL_VERSION_NOT_FOUND' using errcode='P0002'; end if;
  insert into public.knl_framework_versions(
    framework_id,version_number,name,description,status,based_on_version_id,
    lifecycle_status,effective_from,effective_to,activated_at,
    created_by,created_by_name,updated_by,updated_by_name
  ) values(
    source.framework_id,
    (select coalesce(max(version_number),0)+1 from public.knl_framework_versions where framework_id=source.framework_id),
    coalesce(nullif(btrim(p_name),''),source.name),source.description,'draft',source.id,
    'DRAFT',null,null,null,p_actor_id,p_actor_name,p_actor_id,p_actor_name
  ) returning * into saved;
  for c in select * from public.knl_structure_columns where version_id=source.id order by sort_order loop
    insert into public.knl_structure_columns(version_id,column_type,label,level_number,sort_order,is_active,created_by,created_by_name,updated_by,updated_by_name)
    values(saved.id,c.column_type,c.label,c.level_number,c.sort_order,c.is_active,p_actor_id,p_actor_name,p_actor_id,p_actor_name) returning id into new_id;
    column_map:=column_map||jsonb_build_object(c.id::text,new_id::text);
  end loop;
  for g in select * from public.knl_competency_groups where version_id=source.id order by sort_order loop
    insert into public.knl_competency_groups(version_id,name,description,sort_order,is_active,created_by,created_by_name,updated_by,updated_by_name)
    values(saved.id,g.name,g.description,g.sort_order,g.is_active,p_actor_id,p_actor_name,p_actor_id,p_actor_name) returning id into new_id;
    group_map:=group_map||jsonb_build_object(g.id::text,new_id::text);
  end loop;
  for i in select * from public.knl_competency_items where version_id=source.id order by group_id,sort_order loop
    insert into public.knl_competency_items(version_id,group_id,name,description,sort_order,is_active,created_by,created_by_name,updated_by,updated_by_name)
    values(saved.id,(group_map->>i.group_id::text)::uuid,i.name,i.description,i.sort_order,i.is_active,p_actor_id,p_actor_name,p_actor_id,p_actor_name) returning id into new_id;
    item_map:=item_map||jsonb_build_object(i.id::text,new_id::text);
  end loop;
  for lc in select * from public.knl_item_level_contents where version_id=source.id loop
    insert into public.knl_item_level_contents(version_id,item_id,column_id,content,created_by,created_by_name,updated_by,updated_by_name)
    values(saved.id,(item_map->>lc.item_id::text)::uuid,(column_map->>lc.column_id::text)::uuid,lc.content,p_actor_id,p_actor_name,p_actor_id,p_actor_name);
  end loop;
  for gd in select * from public.knl_grade_definitions where version_id=source.id order by sort_order loop
    insert into public.knl_grade_definitions(version_id,grade_code,grade_number,label,sort_order,created_by,created_by_name,updated_by,updated_by_name)
    values(saved.id,gd.grade_code,gd.grade_number,gd.label,gd.sort_order,p_actor_id,p_actor_name,p_actor_id,p_actor_name) returning id into new_id;
    grade_map:=grade_map||jsonb_build_object(gd.id::text,new_id::text);
  end loop;
  for gr in select * from public.knl_grade_requirements where version_id=source.id loop
    insert into public.knl_grade_requirements(version_id,item_id,grade_id,required_column_id,required_level_number,created_by,created_by_name,updated_by,updated_by_name)
    values(saved.id,(item_map->>gr.item_id::text)::uuid,(grade_map->>gr.grade_id::text)::uuid,(column_map->>gr.required_column_id::text)::uuid,gr.required_level_number,p_actor_id,p_actor_name,p_actor_id,p_actor_name);
  end loop;
  insert into public.knl_structure_audit(framework_id,version_id,entity_type,entity_id,action,after_data,changed_by,changed_by_name)
  values(saved.framework_id,saved.id,'version',saved.id,'clone',jsonb_build_object('source_version_id',source.id,'grade_matrix',true),p_actor_id,p_actor_name);
  return saved;
end $$;

-- Reference compensation domain. Legacy public.employee_compensation remains
-- untouched for compatibility and is not a source of truth for this domain.
create table if not exists public.knl_compensation_ladders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'),
  name text not null check (length(btrim(name)) between 2 and 200),
  description text,
  created_by text,created_by_name text,updated_by text,updated_by_name text,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);

create table if not exists public.knl_compensation_versions (
  id uuid primary key default gen_random_uuid(),
  ladder_id uuid not null references public.knl_compensation_ladders(id) on delete restrict,
  version_number integer not null check(version_number>0),
  name text not null,
  status text not null default 'DRAFT' check(status in ('DRAFT','SCHEDULED','ACTIVE','INACTIVE')),
  source_period text not null check(source_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  effective_period text check(effective_period is null or effective_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  effective_from date,
  effective_to date,
  based_on_version_id uuid references public.knl_compensation_versions(id) on delete restrict,
  source_manifest_version text,
  source_hash text,
  note text,
  created_by text,created_by_name text,updated_by text,updated_by_name text,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(ladder_id,version_number),unique(id,ladder_id)
);
create unique index if not exists knl_compensation_one_active_version_idx
  on public.knl_compensation_versions(ladder_id) where status='ACTIVE';
create index if not exists knl_compensation_version_period_idx
  on public.knl_compensation_versions(ladder_id,effective_period,status);

create table if not exists public.knl_compensation_grades (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.knl_compensation_versions(id) on delete restrict,
  ladder_id uuid not null references public.knl_compensation_ladders(id) on delete restrict,
  grade_code text not null check(grade_code ~ '^[A-Z0-9][A-Z0-9_-]{1,19}-B[1-9][0-9]*$'),
  grade_number integer not null check(grade_number>0),
  base_salary bigint not null check(base_salary>=0),
  hqcv bigint not null check(hqcv>=0),
  professional_allowance bigint not null check(professional_allowance>=0),
  management_allowance bigint not null check(management_allowance>=0),
  created_by text,created_by_name text,updated_by text,updated_by_name text,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(version_id,grade_code),unique(version_id,grade_number),unique(id,version_id),
  foreign key(version_id,ladder_id) references public.knl_compensation_versions(id,ladder_id) on delete restrict
);

create or replace function public.knl_valid_extra_allowances(value jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(coalesce(value,'[]'::jsonb))='array'
    and jsonb_array_length(coalesce(value,'[]'::jsonb))<=3
    and not exists(
      select 1 from jsonb_array_elements(coalesce(value,'[]'::jsonb)) x
      where btrim(coalesce(x->>'name',''))=''
        or coalesce(x->>'amount','')!~ '^[0-9]+$'
        or (x->>'amount')::numeric<0
    );
$$;

create table if not exists public.knl_employee_compensation_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_code text not null check(employee_code=upper(btrim(employee_code)) and employee_code<>''),
  employee_name text not null,
  employment_type text not null check(employment_type in ('OFFICIAL','PROBATION')),
  payroll_period text not null check(payroll_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  compensation_version_id uuid references public.knl_compensation_versions(id) on delete restrict,
  compensation_grade_id uuid references public.knl_compensation_grades(id) on delete restrict,
  has_professional_allowance boolean not null default false,
  has_management_allowance boolean not null default false,
  has_meal_allowance boolean not null default false,
  meal_allowance bigint not null default 0 check(meal_allowance>=0),
  probation_amount bigint not null default 0 check(probation_amount>=0),
  extra_allowances jsonb not null default '[]'::jsonb check(public.knl_valid_extra_allowances(extra_allowances)),
  organization_snapshot jsonb not null default '{}'::jsonb,
  structure_snapshot jsonb not null,
  reference_total bigint not null check(reference_total>=0),
  reason text,
  created_by text,created_by_name text,updated_by text,updated_by_name text,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(employee_code,payroll_period),
  foreign key(compensation_grade_id,compensation_version_id) references public.knl_compensation_grades(id,version_id) on delete restrict,
  check(
    (employment_type='PROBATION' and compensation_version_id is null and compensation_grade_id is null
      and probation_amount>0 and not has_professional_allowance and not has_management_allowance
      and not has_meal_allowance and meal_allowance=0 and extra_allowances='[]'::jsonb)
    or
    (employment_type='OFFICIAL' and compensation_version_id is not null and compensation_grade_id is not null
      and probation_amount=0)
  )
);
create index if not exists knl_employee_compensation_current_idx
  on public.knl_employee_compensation_assignments(employee_code,payroll_period desc);
create index if not exists knl_employee_compensation_grade_idx
  on public.knl_employee_compensation_assignments(compensation_grade_id,payroll_period desc);

create table if not exists public.knl_employee_compensation_history (
  id bigint generated always as identity primary key,
  assignment_id uuid not null references public.knl_employee_compensation_assignments(id) on delete restrict,
  employee_code text not null,
  payroll_period text not null,
  action text not null check(action in ('CREATE','UPDATE')),
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null,
  reason text,
  changed_by text,changed_by_name text,
  changed_at timestamptz not null default now()
);
create index if not exists knl_employee_compensation_history_idx
  on public.knl_employee_compensation_history(employee_code,payroll_period desc,changed_at desc);

create table if not exists public.knl_compensation_audit (
  id bigint generated always as identity primary key,
  entity_type text not null,entity_id uuid not null,action text not null,
  before_data jsonb not null default '{}'::jsonb,after_data jsonb not null default '{}'::jsonb,
  actor_id text,actor_name text,created_at timestamptz not null default now()
);
create index if not exists knl_compensation_audit_entity_idx
  on public.knl_compensation_audit(entity_type,entity_id,created_at desc);

create table if not exists public.knl_compensation_seed_runs (
  id uuid primary key default gen_random_uuid(),
  manifest_version text not null,
  source_hash text not null,
  source_period text not null check(source_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  effective_period text not null check(effective_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  reconciliation_snapshot jsonb not null,
  result_summary jsonb not null,
  created_by text,created_by_name text,created_at timestamptz not null default now(),
  unique(manifest_version,effective_period)
);

create or replace function public.knl_guard_compensation_standard_mutation()
returns trigger language plpgsql set search_path=public as $$
declare v_version uuid; v_status text;
begin
  v_version=coalesce(new.version_id,old.version_id);
  select status into v_status from public.knl_compensation_versions where id=v_version;
  if v_status is distinct from 'DRAFT' then raise exception 'KNL_COMPENSATION_VERSION_IMMUTABLE' using errcode='55000'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists trg_knl_compensation_grades_mutable on public.knl_compensation_grades;
create trigger trg_knl_compensation_grades_mutable before insert or update or delete
  on public.knl_compensation_grades for each row execute function public.knl_guard_compensation_standard_mutation();

create or replace function public.knl_guard_compensation_version_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then
    if old.status<>'DRAFT' then raise exception 'KNL_COMPENSATION_VERSION_IMMUTABLE' using errcode='55000'; end if;
    return old;
  end if;
  if old.status<>'DRAFT' and not (
    new.ladder_id=old.ladder_id and new.version_number=old.version_number and new.name=old.name
    and new.source_period=old.source_period and new.effective_period is not distinct from old.effective_period
    and new.effective_from is not distinct from old.effective_from
    and (new.effective_to is not distinct from old.effective_to or (old.status='ACTIVE' and new.status='INACTIVE'))
    and new.based_on_version_id is not distinct from old.based_on_version_id
    and new.source_manifest_version is not distinct from old.source_manifest_version
    and new.source_hash is not distinct from old.source_hash and new.note is not distinct from old.note
    and ((old.status='SCHEDULED' and new.status='ACTIVE') or (old.status='ACTIVE' and new.status='INACTIVE') or new.status=old.status)
  ) then raise exception 'KNL_COMPENSATION_VERSION_IMMUTABLE' using errcode='55000'; end if;
  return new;
end $$;
drop trigger if exists trg_knl_compensation_versions_immutable on public.knl_compensation_versions;
create trigger trg_knl_compensation_versions_immutable before update or delete on public.knl_compensation_versions
  for each row execute function public.knl_guard_compensation_version_mutation();

create or replace function public.knl_activate_due_compensation_versions()
returns integer language plpgsql security definer set search_path=public as $$
declare v record; n integer:=0;
begin
  for v in select id,ladder_id,effective_from from public.knl_compensation_versions
    where status='SCHEDULED' and effective_from<=current_date order by effective_from,id for update
  loop
    update public.knl_compensation_versions set status='INACTIVE',effective_to=v.effective_from-1,updated_at=now()
      where ladder_id=v.ladder_id and status='ACTIVE' and id<>v.id;
    update public.knl_compensation_versions set status='ACTIVE',effective_to=null,updated_at=now() where id=v.id;
    n:=n+1;
  end loop;
  return n;
end $$;

create or replace function public.knl_save_employee_compensation(
  p_employee_code text,p_employee_name text,p_employment_type text,p_payroll_period text,
  p_grade_id uuid default null,p_has_professional boolean default false,p_has_management boolean default false,
  p_has_meal boolean default false,p_meal_amount bigint default 0,p_probation_amount bigint default 0,
  p_extra_allowances jsonb default '[]'::jsonb,p_organization_snapshot jsonb default '{}'::jsonb,
  p_reason text default null,p_actor_id text default null,p_actor_name text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare g record; v_old public.knl_employee_compensation_assignments%rowtype; v_id uuid; v_compensation_version_id uuid; v_snapshot jsonb; v_total bigint; v_extra bigint; v_type text:=upper(btrim(p_employment_type));
begin
  if p_payroll_period!~'^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'KNL_PAYROLL_PERIOD_INVALID' using errcode='22023'; end if;
  if not public.knl_valid_extra_allowances(p_extra_allowances) then raise exception 'KNL_EXTRA_ALLOWANCES_INVALID' using errcode='22023'; end if;
  if v_type='PROBATION' then
    if p_probation_amount<=0 then raise exception 'KNL_PROBATION_AMOUNT_REQUIRED' using errcode='22023'; end if;
    v_snapshot=jsonb_build_object('employmentType','PROBATION','probationAmount',p_probation_amount);
    v_total=p_probation_amount;p_grade_id=null;v_compensation_version_id=null;p_has_professional=false;p_has_management=false;p_has_meal=false;p_meal_amount=0;p_extra_allowances='[]'::jsonb;
  elsif v_type='OFFICIAL' then
    select cg.*,cv.ladder_id,cv.version_number,cv.status,cv.effective_period,cl.code ladder_code,cl.name ladder_name
      into g from public.knl_compensation_grades cg join public.knl_compensation_versions cv on cv.id=cg.version_id
      join public.knl_compensation_ladders cl on cl.id=cv.ladder_id where cg.id=p_grade_id;
    if not found or g.status='DRAFT' or g.effective_period is null or g.effective_period>p_payroll_period then raise exception 'KNL_COMPENSATION_GRADE_NOT_EFFECTIVE' using errcode='22023'; end if;
    v_compensation_version_id=g.version_id;
    select coalesce(sum((x->>'amount')::bigint),0) into v_extra from jsonb_array_elements(p_extra_allowances) x;
    v_snapshot=jsonb_build_object('employmentType','OFFICIAL','ladderId',g.ladder_id,'ladderCode',g.ladder_code,'ladderName',g.ladder_name,'versionId',g.version_id,'versionNumber',g.version_number,'effectivePeriod',g.effective_period,'gradeId',g.id,'gradeCode',g.grade_code,'gradeNumber',g.grade_number,'baseSalary',g.base_salary,'hqcv',g.hqcv,'professionalAllowance',g.professional_allowance,'managementAllowance',g.management_allowance);
    v_total=g.base_salary+g.hqcv+case when p_has_professional then g.professional_allowance else 0 end+case when p_has_management then g.management_allowance else 0 end+case when p_has_meal then p_meal_amount else 0 end+v_extra;
  else raise exception 'KNL_EMPLOYMENT_TYPE_INVALID' using errcode='22023'; end if;
  select * into v_old from public.knl_employee_compensation_assignments where employee_code=upper(btrim(p_employee_code)) and payroll_period=p_payroll_period for update;
  if found then
    update public.knl_employee_compensation_assignments set employee_name=btrim(p_employee_name),employment_type=v_type,compensation_version_id=v_compensation_version_id,compensation_grade_id=p_grade_id,has_professional_allowance=p_has_professional,has_management_allowance=p_has_management,has_meal_allowance=p_has_meal,meal_allowance=p_meal_amount,probation_amount=p_probation_amount,extra_allowances=p_extra_allowances,organization_snapshot=coalesce(p_organization_snapshot,'{}'::jsonb),structure_snapshot=v_snapshot,reference_total=v_total,reason=p_reason,updated_by=p_actor_id,updated_by_name=p_actor_name,updated_at=now() where id=v_old.id returning id into v_id;
  else
    insert into public.knl_employee_compensation_assignments(employee_code,employee_name,employment_type,payroll_period,compensation_version_id,compensation_grade_id,has_professional_allowance,has_management_allowance,has_meal_allowance,meal_allowance,probation_amount,extra_allowances,organization_snapshot,structure_snapshot,reference_total,reason,created_by,created_by_name,updated_by,updated_by_name)
    values(upper(btrim(p_employee_code)),btrim(p_employee_name),v_type,p_payroll_period,v_compensation_version_id,p_grade_id,p_has_professional,p_has_management,p_has_meal,p_meal_amount,p_probation_amount,p_extra_allowances,coalesce(p_organization_snapshot,'{}'::jsonb),v_snapshot,v_total,p_reason,p_actor_id,p_actor_name,p_actor_id,p_actor_name) returning id into v_id;
  end if;
  insert into public.knl_employee_compensation_history(assignment_id,employee_code,payroll_period,action,before_data,after_data,reason,changed_by,changed_by_name)
  select v_id,employee_code,payroll_period,case when v_old.id is null then 'CREATE' else 'UPDATE' end,case when v_old.id is null then '{}'::jsonb else to_jsonb(v_old) end,to_jsonb(a),p_reason,p_actor_id,p_actor_name from public.knl_employee_compensation_assignments a where a.id=v_id;
  return jsonb_build_object('assignmentId',v_id,'referenceTotal',v_total,'payrollPeriod',p_payroll_period);
end $$;

create or replace function public.knl_seed_compensation_foundation(
  p_manifest jsonb,p_reconciled_rows jsonb,p_effective_period text,
  p_actor_id text default null,p_actor_name text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare l jsonb; g jsonb; e jsonb; v_ladder uuid; v_version uuid; v_grade uuid; v_version_number integer; v_status text; v_existing public.knl_compensation_seed_runs%rowtype; v_ladders integer:=0; v_grades integer:=0; v_assignments integer:=0; v_probation integer:=0; v_summary jsonb;
begin
  if p_effective_period!~'^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'KNL_EFFECTIVE_PERIOD_REQUIRED' using errcode='22023'; end if;
  if jsonb_typeof(p_manifest->'ladders')<>'array' or jsonb_typeof(p_reconciled_rows)<>'array' then raise exception 'KNL_COMPENSATION_SEED_INVALID' using errcode='22023'; end if;
  if coalesce(p_manifest->>'manifestVersion','')='' or coalesce(p_manifest->>'sourceSha256','')='' then raise exception 'KNL_COMPENSATION_MANIFEST_IDENTITY_REQUIRED' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtext('knl_compensation_foundation|'||p_effective_period));
  select * into v_existing from public.knl_compensation_seed_runs where manifest_version=p_manifest->>'manifestVersion' and effective_period=p_effective_period;
  if found then
    if v_existing.source_hash<>p_manifest->>'sourceSha256' then raise exception 'KNL_COMPENSATION_SOURCE_HASH_CONFLICT' using errcode='55000'; end if;
    return v_existing.result_summary||jsonb_build_object('idempotent',true,'seedRunId',v_existing.id);
  end if;
  v_status=case when p_effective_period<=to_char(current_date,'YYYY-MM') then 'ACTIVE' else 'SCHEDULED' end;
  for l in select value from jsonb_array_elements(p_manifest->'ladders') loop
    insert into public.knl_compensation_ladders(code,name,created_by,created_by_name,updated_by,updated_by_name)
    values(upper(btrim(l->>'code')),btrim(l->>'name'),p_actor_id,p_actor_name,p_actor_id,p_actor_name)
    on conflict(code) do update set name=excluded.name,updated_by=p_actor_id,updated_by_name=p_actor_name,updated_at=now()
    returning id into v_ladder;
    select coalesce(max(version_number),0)+1 into v_version_number from public.knl_compensation_versions where ladder_id=v_ladder;
    insert into public.knl_compensation_versions(ladder_id,version_number,name,status,source_period,effective_period,effective_from,source_manifest_version,source_hash,note,created_by,created_by_name,updated_by,updated_by_name)
    values(v_ladder,v_version_number,'Baseline T07.2026','DRAFT',p_manifest->>'sourcePeriod',p_effective_period,(p_effective_period||'-01')::date,p_manifest->>'manifestVersion',p_manifest->>'sourceSha256','Initial reviewed compensation foundation',p_actor_id,p_actor_name,p_actor_id,p_actor_name)
    returning id into v_version;
    for g in select value from jsonb_array_elements(l->'grades') loop
      insert into public.knl_compensation_grades(version_id,ladder_id,grade_code,grade_number,base_salary,hqcv,professional_allowance,management_allowance,created_by,created_by_name,updated_by,updated_by_name)
      values(v_version,v_ladder,upper(btrim(g->>'gradeCode')),(g->>'gradeNumber')::integer,(g->>'baseSalary')::bigint,(g->>'hqcv')::bigint,(g->>'professionalAllowance')::bigint,(g->>'managementAllowance')::bigint,p_actor_id,p_actor_name,p_actor_id,p_actor_name);
      v_grades:=v_grades+1;
    end loop;
    if v_status='ACTIVE' then
      update public.knl_compensation_versions set status='INACTIVE',effective_to=(p_effective_period||'-01')::date-1,updated_at=now(),updated_by=p_actor_id,updated_by_name=p_actor_name where ladder_id=v_ladder and status='ACTIVE' and id<>v_version;
    end if;
    update public.knl_compensation_versions set status=v_status where id=v_version;
    v_ladders:=v_ladders+1;
  end loop;
  for e in select value from jsonb_array_elements(p_reconciled_rows) loop
    if coalesce(e->>'classification','')<>'WILL_ASSIGN' then raise exception 'KNL_SEED_ONLY_WILL_ASSIGN' using errcode='22023'; end if;
    if exists(select 1 from public.knl_employee_compensation_assignments where employee_code=upper(btrim(e->>'employeeCode')) and payroll_period=p_effective_period) then raise exception 'KNL_SEED_ASSIGNMENT_EXISTS:%',e->>'employeeCode' using errcode='55000'; end if;
    if not exists(select 1 from public.checklist_employee_assignments a where upper(btrim(a.employee_code))=upper(btrim(e->>'employeeCode')) and lower(btrim(a.employee_name))=lower(btrim(e->>'employeeName')) and lower(coalesce(a.employee_status,'')) not in ('đã nghỉ việc','inactive','terminated')) then raise exception 'KNL_SEED_ORGANIZATION_CHANGED:%',e->>'employeeCode' using errcode='55000'; end if;
    if upper(e->>'employmentType')='OFFICIAL' then
      select cg.id into v_grade from public.knl_compensation_grades cg join public.knl_compensation_versions cv on cv.id=cg.version_id where cg.grade_code=upper(btrim(e->>'mappedGradeCode')) and cv.source_manifest_version=p_manifest->>'manifestVersion' and cv.effective_period=p_effective_period;
      if v_grade is null then raise exception 'KNL_SEED_GRADE_NOT_FOUND:%',e->>'mappedGradeCode' using errcode='22023'; end if;
      perform public.knl_save_employee_compensation(e->>'employeeCode',e->>'employeeName','OFFICIAL',p_effective_period,v_grade,coalesce((e->>'hasProfessionalAllowance')::boolean,false),coalesce((e->>'hasManagementAllowance')::boolean,false),coalesce((e->>'hasMealAllowance')::boolean,false),coalesce((e->>'mealAllowance')::bigint,0),0,'[]'::jsonb,coalesce(e->'organizationSnapshot','{}'::jsonb),'Initial reviewed T07.2026 foundation',p_actor_id,p_actor_name);
    else
      perform public.knl_save_employee_compensation(e->>'employeeCode',e->>'employeeName','PROBATION',p_effective_period,null,false,false,false,0,(e->>'probationAmount')::bigint,'[]'::jsonb,coalesce(e->'organizationSnapshot','{}'::jsonb),'Initial reviewed T07.2026 probation amount',p_actor_id,p_actor_name);
      v_probation:=v_probation+1;
    end if;
    v_assignments:=v_assignments+1;
  end loop;
  v_summary=jsonb_build_object('idempotent',false,'ladders',v_ladders,'grades',v_grades,'assignments',v_assignments,'probation',v_probation,'effectivePeriod',p_effective_period);
  insert into public.knl_compensation_seed_runs(manifest_version,source_hash,source_period,effective_period,reconciliation_snapshot,result_summary,created_by,created_by_name)
  values(p_manifest->>'manifestVersion',p_manifest->>'sourceSha256',p_manifest->>'sourcePeriod',p_effective_period,p_reconciled_rows,v_summary,p_actor_id,p_actor_name);
  return v_summary;
end $$;

-- Touch triggers reuse the Survey helper already deployed in 1.49.0.
drop trigger if exists trg_knl_grade_definitions_touch on public.knl_grade_definitions;
create trigger trg_knl_grade_definitions_touch before update on public.knl_grade_definitions for each row execute function public.knl_survey_touch_updated_at();
drop trigger if exists trg_knl_grade_requirements_touch on public.knl_grade_requirements;
create trigger trg_knl_grade_requirements_touch before update on public.knl_grade_requirements for each row execute function public.knl_survey_touch_updated_at();
drop trigger if exists trg_knl_compensation_ladders_touch on public.knl_compensation_ladders;
create trigger trg_knl_compensation_ladders_touch before update on public.knl_compensation_ladders for each row execute function public.knl_survey_touch_updated_at();
drop trigger if exists trg_knl_compensation_versions_touch on public.knl_compensation_versions;
create trigger trg_knl_compensation_versions_touch before update on public.knl_compensation_versions for each row execute function public.knl_survey_touch_updated_at();
drop trigger if exists trg_knl_compensation_grades_touch on public.knl_compensation_grades;
create trigger trg_knl_compensation_grades_touch before update on public.knl_compensation_grades for each row execute function public.knl_survey_touch_updated_at();
drop trigger if exists trg_knl_employee_compensation_touch on public.knl_employee_compensation_assignments;
create trigger trg_knl_employee_compensation_touch before update on public.knl_employee_compensation_assignments for each row execute function public.knl_survey_touch_updated_at();

alter table public.knl_grade_definitions enable row level security;
alter table public.knl_grade_requirements enable row level security;
alter table public.knl_compensation_ladders enable row level security;
alter table public.knl_compensation_versions enable row level security;
alter table public.knl_compensation_grades enable row level security;
alter table public.knl_employee_compensation_assignments enable row level security;
alter table public.knl_employee_compensation_history enable row level security;
alter table public.knl_compensation_audit enable row level security;
alter table public.knl_compensation_seed_runs enable row level security;

revoke all on public.knl_grade_definitions,public.knl_grade_requirements,public.knl_compensation_ladders,public.knl_compensation_versions,public.knl_compensation_grades,public.knl_employee_compensation_assignments,public.knl_employee_compensation_history,public.knl_compensation_audit,public.knl_compensation_seed_runs from public,anon,authenticated;
revoke all on function public.knl_save_grade_matrix(uuid,jsonb,jsonb,text,text),public.knl_set_version_effectivity(uuid,timestamptz,text,text),public.knl_activate_due_versions(),public.knl_activate_due_compensation_versions(),public.knl_save_employee_compensation(text,text,text,text,uuid,boolean,boolean,boolean,bigint,bigint,jsonb,jsonb,text,text,text),public.knl_seed_compensation_foundation(jsonb,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.knl_save_grade_matrix(uuid,jsonb,jsonb,text,text),public.knl_set_version_effectivity(uuid,timestamptz,text,text),public.knl_activate_due_versions(),public.knl_activate_due_compensation_versions(),public.knl_save_employee_compensation(text,text,text,text,uuid,boolean,boolean,boolean,bigint,bigint,jsonb,jsonb,text,text,text),public.knl_seed_compensation_foundation(jsonb,jsonb,text,text,text) to service_role;

comment on table public.knl_grade_requirements is 'Per-item, per-grade required competency level. No averaging or compensation across criteria.';
comment on table public.knl_employee_compensation_assignments is 'Versioned reference compensation by employee and payroll period; not payroll, attendance, tax, insurance or net salary.';
comment on table public.knl_compensation_versions is 'Creating a new master version never bulk-migrates employee assignments.';

commit;

-- READ-ONLY verification after manual Production execution:
-- select lifecycle_status,count(*) from public.knl_framework_versions group by 1;
-- select tablename from pg_tables where schemaname='public' and tablename like 'knl_%compensation%' order by 1;
