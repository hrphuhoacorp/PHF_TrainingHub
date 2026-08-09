-- PHF KNL Batch 1: Framework / Version / Dynamic Structure
-- Additive only. No employee, organization, Checklist, Survey, Assessment or income data.
begin;

create extension if not exists pgcrypto;

create table if not exists public.knl_frameworks (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft','published','inactive')),
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  constraint knl_frameworks_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,49}$')
);
create unique index if not exists knl_frameworks_code_uq on public.knl_frameworks (upper(code));
create index if not exists knl_frameworks_status_idx on public.knl_frameworks(status,updated_at desc);

create table if not exists public.knl_framework_versions (
  id uuid primary key default gen_random_uuid(),
  framework_id uuid not null references public.knl_frameworks(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft','published','inactive')),
  based_on_version_id uuid references public.knl_framework_versions(id) on delete set null,
  is_locked boolean not null default false,
  locked_reason text,
  locked_at timestamptz,
  published_at timestamptz,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  unique(framework_id,version_number),
  constraint knl_version_lock_consistent check (
    (is_locked = false and locked_at is null) or
    (is_locked = true and locked_at is not null and nullif(btrim(locked_reason),'') is not null)
  )
);
create index if not exists knl_versions_framework_idx on public.knl_framework_versions(framework_id,version_number desc);
create index if not exists knl_versions_status_idx on public.knl_framework_versions(status,is_locked);

create table if not exists public.knl_competency_groups (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.knl_framework_versions(id) on delete cascade,
  name text not null,
  description text,
  sort_order integer not null check (sort_order > 0),
  is_active boolean not null default true,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  unique(version_id,sort_order),
  unique(id,version_id)
);
create index if not exists knl_groups_version_idx on public.knl_competency_groups(version_id,is_active,sort_order);

create table if not exists public.knl_competency_items (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.knl_framework_versions(id) on delete cascade,
  group_id uuid not null,
  name text not null,
  description text,
  sort_order integer not null check (sort_order > 0),
  is_active boolean not null default true,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  unique(group_id,sort_order),
  unique(id,version_id),
  foreign key(group_id,version_id) references public.knl_competency_groups(id,version_id) on delete cascade
);
create index if not exists knl_items_group_idx on public.knl_competency_items(group_id,is_active,sort_order);
create index if not exists knl_items_version_idx on public.knl_competency_items(version_id);

create table if not exists public.knl_structure_columns (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.knl_framework_versions(id) on delete cascade,
  column_type text not null check (column_type in ('item','description','level')),
  label text not null,
  level_number integer,
  sort_order integer not null check (sort_order > 0),
  is_active boolean not null default true,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  unique(version_id,sort_order),
  unique(id,version_id),
  constraint knl_column_level_consistent check (
    (column_type = 'level' and level_number is not null and level_number > 0) or
    (column_type <> 'level' and level_number is null)
  )
);
create unique index if not exists knl_column_single_item_uq on public.knl_structure_columns(version_id) where column_type='item' and is_active=true;
create unique index if not exists knl_column_single_description_uq on public.knl_structure_columns(version_id) where column_type='description' and is_active=true;
create unique index if not exists knl_column_level_number_uq on public.knl_structure_columns(version_id,level_number) where column_type='level' and is_active=true;
create index if not exists knl_columns_version_idx on public.knl_structure_columns(version_id,is_active,sort_order);

create table if not exists public.knl_item_level_contents (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.knl_framework_versions(id) on delete cascade,
  item_id uuid not null,
  column_id uuid not null,
  content text not null default '',
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  unique(item_id,column_id),
  foreign key(item_id,version_id) references public.knl_competency_items(id,version_id) on delete cascade,
  foreign key(column_id,version_id) references public.knl_structure_columns(id,version_id) on delete cascade
);
create index if not exists knl_level_contents_version_idx on public.knl_item_level_contents(version_id,item_id);

create table if not exists public.knl_structure_audit (
  id uuid primary key default gen_random_uuid(),
  framework_id uuid,
  version_id uuid,
  entity_type text not null,
  entity_id uuid,
  action text not null check (action in ('insert','update','delete','publish','clone','lock','reorder')),
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  changed_by text,
  changed_by_name text,
  changed_at timestamptz not null default now()
);
create index if not exists knl_structure_audit_version_idx on public.knl_structure_audit(version_id,changed_at desc);
create index if not exists knl_structure_audit_entity_idx on public.knl_structure_audit(entity_type,entity_id,changed_at desc);

create or replace function public.knl_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.knl_assert_version_mutable(p_version_id uuid) returns void
language plpgsql as $$
declare v public.knl_framework_versions%rowtype;
begin
  select * into v from public.knl_framework_versions where id=p_version_id for update;
  if not found then raise exception 'KNL_VERSION_NOT_FOUND' using errcode='P0002'; end if;
  if v.status <> 'draft' or v.is_locked then
    raise exception 'KNL_VERSION_IMMUTABLE' using errcode='55000';
  end if;
end $$;

create or replace function public.knl_guard_structure_mutation() returns trigger
language plpgsql as $$
declare v_version_id uuid;
begin
  v_version_id := case when tg_op='DELETE' then old.version_id else new.version_id end;
  perform public.knl_assert_version_mutable(v_version_id);
  if tg_op='UPDATE' and old.version_id <> new.version_id then
    raise exception 'KNL_VERSION_ID_IMMUTABLE' using errcode='55000';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

create or replace function public.knl_guard_version_mutation() returns trigger
language plpgsql as $$
begin
  if tg_op='DELETE' then
    if old.status <> 'draft' or old.is_locked then raise exception 'KNL_VERSION_IMMUTABLE' using errcode='55000'; end if;
    return old;
  end if;
  if old.status <> 'draft' or old.is_locked then
    if not (old.status='published' and new.status='inactive'
      and new.framework_id=old.framework_id and new.version_number=old.version_number
      and new.name=old.name and new.description is not distinct from old.description
      and new.based_on_version_id is not distinct from old.based_on_version_id
      and new.is_locked=old.is_locked and new.locked_reason is not distinct from old.locked_reason
      and new.locked_at is not distinct from old.locked_at and new.published_at is not distinct from old.published_at) then
      raise exception 'KNL_VERSION_IMMUTABLE' using errcode='55000';
    end if;
  end if;
  return new;
end $$;

create or replace function public.knl_guard_framework_mutation() returns trigger
language plpgsql as $$
begin
  if tg_op='DELETE' then
    if old.status <> 'draft' then raise exception 'KNL_FRAMEWORK_IMMUTABLE' using errcode='55000'; end if;
    return old;
  end if;
  if new.status='published' and not exists(select 1 from public.knl_framework_versions where framework_id=old.id and status='published') then
    raise exception 'KNL_FRAMEWORK_REQUIRES_PUBLISHED_VERSION' using errcode='23514';
  end if;
  return new;
end $$;

create or replace function public.knl_validate_publishable(p_version_id uuid) returns void
language plpgsql as $$
declare item_columns int; description_columns int; level_columns int;
begin
  perform public.knl_assert_version_mutable(p_version_id);
  select count(*) filter(where column_type='item'), count(*) filter(where column_type='description'), count(*) filter(where column_type='level')
    into item_columns,description_columns,level_columns
    from public.knl_structure_columns where version_id=p_version_id and is_active=true;
  if item_columns <> 1 then raise exception 'KNL_REQUIRES_ONE_ITEM_COLUMN' using errcode='23514'; end if;
  if description_columns > 1 then raise exception 'KNL_ALLOWS_ZERO_OR_ONE_DESCRIPTION_COLUMN' using errcode='23514'; end if;
  if level_columns < 1 then raise exception 'KNL_REQUIRES_AT_LEAST_ONE_LEVEL' using errcode='23514'; end if;
end $$;

create or replace function public.knl_publish_version(p_version_id uuid,p_actor_id text default null,p_actor_name text default null) returns public.knl_framework_versions
language plpgsql security definer set search_path=public as $$
declare saved public.knl_framework_versions; framework uuid;
begin
  perform public.knl_validate_publishable(p_version_id);
  update public.knl_framework_versions set status='published',is_locked=true,locked_reason='published',locked_at=now(),published_at=now(),updated_by=p_actor_id,updated_by_name=p_actor_name
    where id=p_version_id returning * into saved;
  framework:=saved.framework_id;
  update public.knl_frameworks set status='published',updated_by=p_actor_id,updated_by_name=p_actor_name where id=framework and status in ('draft','inactive');
  insert into public.knl_structure_audit(framework_id,version_id,entity_type,entity_id,action,after_data,changed_by,changed_by_name)
    values(framework,p_version_id,'version',p_version_id,'publish',to_jsonb(saved),p_actor_id,p_actor_name);
  return saved;
end $$;

create or replace function public.knl_lock_version(p_version_id uuid,p_reason text,p_actor_id text default null,p_actor_name text default null) returns public.knl_framework_versions
language plpgsql security definer set search_path=public as $$
declare saved public.knl_framework_versions;
begin
  if nullif(btrim(p_reason),'') is null then raise exception 'KNL_LOCK_REASON_REQUIRED' using errcode='22023'; end if;
  perform public.knl_assert_version_mutable(p_version_id);
  update public.knl_framework_versions set is_locked=true,locked_reason=btrim(p_reason),locked_at=now(),updated_by=p_actor_id,updated_by_name=p_actor_name
    where id=p_version_id returning * into saved;
  insert into public.knl_structure_audit(framework_id,version_id,entity_type,entity_id,action,after_data,changed_by,changed_by_name)
    values(saved.framework_id,saved.id,'version',saved.id,'lock',to_jsonb(saved),p_actor_id,p_actor_name);
  return saved;
end $$;

create or replace function public.knl_reorder_structure(p_entity text,p_parent_id uuid,p_ordered_ids uuid[],p_actor_id text default null,p_actor_name text default null) returns integer
language plpgsql security definer set search_path=public as $$
declare expected int; affected int; v_version_id uuid;
begin
  if p_entity='group' then
    select count(*),(array_agg(version_id))[1] into expected,v_version_id from public.knl_competency_groups where version_id=p_parent_id and is_active=true;
    perform public.knl_assert_version_mutable(p_parent_id);
    if expected <> coalesce(array_length(p_ordered_ids,1),0) or exists(select 1 from unnest(p_ordered_ids) x group by x having count(*)>1)
      or exists(select 1 from unnest(p_ordered_ids) x where not exists(select 1 from public.knl_competency_groups g where g.id=x and g.version_id=p_parent_id and g.is_active=true))
      then raise exception 'KNL_REORDER_SET_MISMATCH' using errcode='22023'; end if;
    update public.knl_competency_groups g set sort_order=100000+u.ord,updated_by=p_actor_id,updated_by_name=p_actor_name from unnest(p_ordered_ids) with ordinality u(id,ord) where g.id=u.id;
    update public.knl_competency_groups g set sort_order=u.ord,updated_by=p_actor_id,updated_by_name=p_actor_name from unnest(p_ordered_ids) with ordinality u(id,ord) where g.id=u.id;
  elsif p_entity='item' then
    select count(*),(array_agg(version_id))[1] into expected,v_version_id from public.knl_competency_items where group_id=p_parent_id and is_active=true;
    perform public.knl_assert_version_mutable(v_version_id);
    if expected <> coalesce(array_length(p_ordered_ids,1),0) or exists(select 1 from unnest(p_ordered_ids) x group by x having count(*)>1)
      or exists(select 1 from unnest(p_ordered_ids) x where not exists(select 1 from public.knl_competency_items i where i.id=x and i.group_id=p_parent_id and i.is_active=true))
      then raise exception 'KNL_REORDER_SET_MISMATCH' using errcode='22023'; end if;
    update public.knl_competency_items i set sort_order=100000+u.ord,updated_by=p_actor_id,updated_by_name=p_actor_name from unnest(p_ordered_ids) with ordinality u(id,ord) where i.id=u.id;
    update public.knl_competency_items i set sort_order=u.ord,updated_by=p_actor_id,updated_by_name=p_actor_name from unnest(p_ordered_ids) with ordinality u(id,ord) where i.id=u.id;
  elsif p_entity='column' then
    select count(*),(array_agg(version_id))[1] into expected,v_version_id from public.knl_structure_columns where version_id=p_parent_id and is_active=true;
    perform public.knl_assert_version_mutable(p_parent_id);
    if expected <> coalesce(array_length(p_ordered_ids,1),0) or exists(select 1 from unnest(p_ordered_ids) x group by x having count(*)>1)
      or exists(select 1 from unnest(p_ordered_ids) x where not exists(select 1 from public.knl_structure_columns c where c.id=x and c.version_id=p_parent_id and c.is_active=true))
      then raise exception 'KNL_REORDER_SET_MISMATCH' using errcode='22023'; end if;
    update public.knl_structure_columns c set sort_order=100000+u.ord,updated_by=p_actor_id,updated_by_name=p_actor_name from unnest(p_ordered_ids) with ordinality u(id,ord) where c.id=u.id;
    update public.knl_structure_columns c set sort_order=u.ord,updated_by=p_actor_id,updated_by_name=p_actor_name from unnest(p_ordered_ids) with ordinality u(id,ord) where c.id=u.id;
  else raise exception 'KNL_REORDER_ENTITY_INVALID' using errcode='22023'; end if;
  affected:=coalesce(array_length(p_ordered_ids,1),0);
  insert into public.knl_structure_audit(version_id,entity_type,action,after_data,changed_by,changed_by_name)
    values(coalesce(v_version_id,p_parent_id),p_entity,'reorder',jsonb_build_object('ordered_ids',p_ordered_ids),p_actor_id,p_actor_name);
  return affected;
end $$;

create or replace function public.knl_clone_version(p_source_version_id uuid,p_name text,p_actor_id text default null,p_actor_name text default null) returns public.knl_framework_versions
language plpgsql security definer set search_path=public as $$
declare source public.knl_framework_versions; saved public.knl_framework_versions; g record; i record; c record; lc record; new_id uuid; group_map jsonb:='{}'; item_map jsonb:='{}'; column_map jsonb:='{}';
begin
  select * into source from public.knl_framework_versions where id=p_source_version_id;
  if not found then raise exception 'KNL_VERSION_NOT_FOUND' using errcode='P0002'; end if;
  insert into public.knl_framework_versions(framework_id,version_number,name,description,status,based_on_version_id,created_by,created_by_name,updated_by,updated_by_name)
    values(source.framework_id,(select coalesce(max(version_number),0)+1 from public.knl_framework_versions where framework_id=source.framework_id),coalesce(nullif(btrim(p_name),''),source.name),source.description,'draft',source.id,p_actor_id,p_actor_name,p_actor_id,p_actor_name)
    returning * into saved;
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
  insert into public.knl_structure_audit(framework_id,version_id,entity_type,entity_id,action,after_data,changed_by,changed_by_name)
    values(saved.framework_id,saved.id,'version',saved.id,'clone',jsonb_build_object('source_version_id',source.id),p_actor_id,p_actor_name);
  return saved;
end $$;

create or replace function public.knl_audit_structure_change() returns trigger
language plpgsql as $$
declare row_data jsonb; old_data jsonb; v_version uuid; v_framework uuid; v_actor text; v_actor_name text;
begin
  row_data:=case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
  old_data:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_version:=coalesce((row_data->>'version_id')::uuid,(old_data->>'version_id')::uuid,case when tg_table_name='knl_framework_versions' then coalesce(new.id,old.id) end);
  if tg_table_name='knl_frameworks' then v_framework:=coalesce(new.id,old.id);
  elsif tg_table_name='knl_framework_versions' then v_framework:=coalesce(new.framework_id,old.framework_id);
  else select framework_id into v_framework from public.knl_framework_versions where id=v_version; end if;
  v_actor:=coalesce(row_data->>'updated_by',row_data->>'created_by',old_data->>'updated_by',old_data->>'created_by');
  v_actor_name:=coalesce(row_data->>'updated_by_name',row_data->>'created_by_name',old_data->>'updated_by_name',old_data->>'created_by_name');
  insert into public.knl_structure_audit(framework_id,version_id,entity_type,entity_id,action,before_data,after_data,changed_by,changed_by_name)
    values(v_framework,v_version,replace(tg_table_name,'knl_',''),coalesce(new.id,old.id),lower(tg_op),old_data,row_data,v_actor,v_actor_name);
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['knl_frameworks','knl_framework_versions','knl_competency_groups','knl_competency_items','knl_structure_columns','knl_item_level_contents'] loop
    if not exists(select 1 from pg_trigger where tgname='trg_'||t||'_touch' and tgrelid=to_regclass('public.'||t)) then
      execute format('create trigger %I before update on public.%I for each row execute function public.knl_touch_updated_at()','trg_'||t||'_touch',t);
    end if;
    if not exists(select 1 from pg_trigger where tgname='trg_'||t||'_audit' and tgrelid=to_regclass('public.'||t)) then
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.knl_audit_structure_change()','trg_'||t||'_audit',t);
    end if;
  end loop;
end $$;

do $$ begin
  if not exists(select 1 from pg_trigger where tgname='trg_knl_frameworks_guard' and tgrelid='public.knl_frameworks'::regclass) then
    create trigger trg_knl_frameworks_guard before update or delete on public.knl_frameworks for each row execute function public.knl_guard_framework_mutation();
  end if;
  if not exists(select 1 from pg_trigger where tgname='trg_knl_versions_guard' and tgrelid='public.knl_framework_versions'::regclass) then
    create trigger trg_knl_versions_guard before update or delete on public.knl_framework_versions for each row execute function public.knl_guard_version_mutation();
  end if;
end $$;

do $$ declare t text; begin
  foreach t in array array['knl_competency_groups','knl_competency_items','knl_structure_columns','knl_item_level_contents'] loop
    if not exists(select 1 from pg_trigger where tgname='trg_'||t||'_mutable' and tgrelid=to_regclass('public.'||t)) then
      execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.knl_guard_structure_mutation()','trg_'||t||'_mutable',t);
    end if;
  end loop;
end $$;

alter table public.knl_frameworks enable row level security;
alter table public.knl_framework_versions enable row level security;
alter table public.knl_competency_groups enable row level security;
alter table public.knl_competency_items enable row level security;
alter table public.knl_structure_columns enable row level security;
alter table public.knl_item_level_contents enable row level security;
alter table public.knl_structure_audit enable row level security;

revoke all on public.knl_frameworks,public.knl_framework_versions,public.knl_competency_groups,public.knl_competency_items,public.knl_structure_columns,public.knl_item_level_contents,public.knl_structure_audit from anon,authenticated;
revoke all on function public.knl_publish_version(uuid,text,text),public.knl_lock_version(uuid,text,text,text),public.knl_reorder_structure(text,uuid,uuid[],text,text),public.knl_clone_version(uuid,text,text,text) from anon,authenticated;

comment on table public.knl_framework_versions is 'Version KNL: Published hoặc is_locked=true là bất biến; thay đổi bằng Draft version mới.';
comment on table public.knl_structure_columns is 'Cấu hình Hàng 4 động: item, description optional, level 1..N; không hard-code 4 mức.';
comment on table public.knl_item_level_contents is 'Nội dung tiêu chuẩn của từng hạng mục tại từng cột mức động.';

commit;
