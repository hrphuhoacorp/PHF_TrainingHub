-- PHF KNL 1.50.3 — Compensation ladder versioning CRUD.
-- Additive only. Run manually in Production after application tests pass.
-- Adds three RPCs on top of the 1.50.0 compensation foundation schema:
--   knl_clone_compensation_version   Clone Active/any version -> new DRAFT (grades copied).
--   knl_save_compensation_grades     Edit LCB/HQCV/PC chuẩn on a DRAFT version's grades only.
--   knl_schedule_compensation_version  DRAFT -> SCHEDULED/ACTIVE with explicit effective date.
-- No new tables. No employee assignment is ever bulk-migrated by these RPCs.
begin;

create or replace function public.knl_clone_compensation_version(
  p_source_version_id uuid,p_name text default null,p_actor_id text default null,p_actor_name text default null
) returns public.knl_compensation_versions
language plpgsql security definer set search_path=public as $$
declare source public.knl_compensation_versions%rowtype; saved public.knl_compensation_versions%rowtype; g record; v_grade_count integer:=0;
begin
  select * into source from public.knl_compensation_versions where id=p_source_version_id;
  if not found then raise exception 'KNL_COMPENSATION_VERSION_NOT_FOUND' using errcode='P0002'; end if;
  insert into public.knl_compensation_versions(
    ladder_id,version_number,name,status,source_period,effective_period,effective_from,effective_to,
    based_on_version_id,source_manifest_version,source_hash,note,created_by,created_by_name,updated_by,updated_by_name
  ) values(
    source.ladder_id,
    (select coalesce(max(version_number),0)+1 from public.knl_compensation_versions where ladder_id=source.ladder_id),
    coalesce(nullif(btrim(p_name),''),source.name||' (Draft mới)'),'DRAFT',source.source_period,null,null,null,
    source.id,source.source_manifest_version,source.source_hash,'Cloned from v'||source.version_number,
    p_actor_id,p_actor_name,p_actor_id,p_actor_name
  ) returning * into saved;
  for g in select * from public.knl_compensation_grades where version_id=source.id order by grade_number loop
    insert into public.knl_compensation_grades(
      version_id,ladder_id,grade_code,grade_number,base_salary,hqcv,professional_allowance,management_allowance,
      created_by,created_by_name,updated_by,updated_by_name
    ) values(
      saved.id,saved.ladder_id,g.grade_code,g.grade_number,g.base_salary,g.hqcv,g.professional_allowance,g.management_allowance,
      p_actor_id,p_actor_name,p_actor_id,p_actor_name
    );
    v_grade_count:=v_grade_count+1;
  end loop;
  insert into public.knl_compensation_audit(entity_type,entity_id,action,before_data,after_data,actor_id,actor_name)
  values('compensation_version',saved.id,'clone',
    jsonb_build_object('sourceVersionId',source.id,'sourceVersionNumber',source.version_number),
    jsonb_build_object('grades',v_grade_count),p_actor_id,p_actor_name);
  return saved;
end $$;

create or replace function public.knl_save_compensation_grades(
  p_version_id uuid,p_grades jsonb,p_actor_id text default null,p_actor_name text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_version public.knl_compensation_versions%rowtype; g jsonb; v_existing integer; v_before jsonb; v_after jsonb;
begin
  select * into v_version from public.knl_compensation_versions where id=p_version_id for update;
  if not found then raise exception 'KNL_COMPENSATION_VERSION_NOT_FOUND' using errcode='P0002'; end if;
  if v_version.status<>'DRAFT' then raise exception 'KNL_COMPENSATION_VERSION_IMMUTABLE' using errcode='55000'; end if;
  if jsonb_typeof(p_grades)<>'array' or jsonb_array_length(p_grades)=0 then
    raise exception 'KNL_COMPENSATION_GRADES_REQUIRED' using errcode='22023';
  end if;
  select count(*) into v_existing from public.knl_compensation_grades where version_id=p_version_id;
  if jsonb_array_length(p_grades)<>v_existing then
    raise exception 'KNL_COMPENSATION_GRADES_COUNT_MISMATCH' using errcode='22023';
  end if;
  select jsonb_agg(jsonb_build_object('id',id,'baseSalary',base_salary,'hqcv',hqcv,'professionalAllowance',professional_allowance,'managementAllowance',management_allowance))
    into v_before from public.knl_compensation_grades where version_id=p_version_id;
  for g in select value from jsonb_array_elements(p_grades) loop
    if (g->>'baseSalary')::bigint<0 or (g->>'hqcv')::bigint<0
      or (g->>'professionalAllowance')::bigint<0 or (g->>'managementAllowance')::bigint<0 then
      raise exception 'KNL_COMPENSATION_GRADE_AMOUNT_NEGATIVE' using errcode='22023';
    end if;
    update public.knl_compensation_grades
      set base_salary=(g->>'baseSalary')::bigint,hqcv=(g->>'hqcv')::bigint,
          professional_allowance=(g->>'professionalAllowance')::bigint,management_allowance=(g->>'managementAllowance')::bigint,
          updated_by=p_actor_id,updated_by_name=p_actor_name,updated_at=now()
      where id=(g->>'id')::uuid and version_id=p_version_id;
    if not found then raise exception 'KNL_COMPENSATION_GRADE_NOT_FOUND:%',g->>'id' using errcode='22023'; end if;
  end loop;
  select jsonb_agg(jsonb_build_object('id',id,'baseSalary',base_salary,'hqcv',hqcv,'professionalAllowance',professional_allowance,'managementAllowance',management_allowance))
    into v_after from public.knl_compensation_grades where version_id=p_version_id;
  insert into public.knl_compensation_audit(entity_type,entity_id,action,before_data,after_data,actor_id,actor_name)
  values('compensation_grades',p_version_id,'update',
    jsonb_build_object('grades',v_before),jsonb_build_object('grades',v_after),p_actor_id,p_actor_name);
  return jsonb_build_object('versionId',p_version_id,'grades',jsonb_array_length(p_grades));
end $$;

create or replace function public.knl_schedule_compensation_version(
  p_version_id uuid,p_effective_period text,p_effective_from date,p_actor_id text default null,p_actor_name text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.knl_compensation_versions%rowtype; v_grade_count integer; v_status text;
begin
  select * into v from public.knl_compensation_versions where id=p_version_id for update;
  if not found then raise exception 'KNL_COMPENSATION_VERSION_NOT_FOUND' using errcode='P0002'; end if;
  if v.status<>'DRAFT' then raise exception 'KNL_COMPENSATION_VERSION_NOT_DRAFT' using errcode='55000'; end if;
  if p_effective_period!~'^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'KNL_EFFECTIVE_PERIOD_REQUIRED' using errcode='22023'; end if;
  if p_effective_from is null then raise exception 'KNL_EFFECTIVE_FROM_REQUIRED' using errcode='22023'; end if;
  select count(*) into v_grade_count from public.knl_compensation_grades where version_id=p_version_id;
  if v_grade_count=0 then raise exception 'KNL_COMPENSATION_GRADES_REQUIRED' using errcode='55000'; end if;
  v_status:=case when p_effective_from<=current_date then 'ACTIVE' else 'SCHEDULED' end;
  if v_status='ACTIVE' then
    update public.knl_compensation_versions
      set status='INACTIVE',effective_to=p_effective_from-1,updated_at=now(),updated_by=p_actor_id,updated_by_name=p_actor_name
      where ladder_id=v.ladder_id and status='ACTIVE' and id<>p_version_id;
  end if;
  update public.knl_compensation_versions
    set status=v_status,effective_period=p_effective_period,effective_from=p_effective_from,effective_to=null,
        updated_at=now(),updated_by=p_actor_id,updated_by_name=p_actor_name
    where id=p_version_id;
  insert into public.knl_compensation_audit(entity_type,entity_id,action,before_data,after_data,actor_id,actor_name)
  values('compensation_version',p_version_id,'schedule',to_jsonb(v),
    jsonb_build_object('status',v_status,'effectivePeriod',p_effective_period,'effectiveFrom',p_effective_from),
    p_actor_id,p_actor_name);
  return jsonb_build_object('versionId',p_version_id,'status',v_status,'effectivePeriod',p_effective_period,'effectiveFrom',p_effective_from);
end $$;

revoke all on function
  public.knl_clone_compensation_version(uuid,text,text,text),
  public.knl_save_compensation_grades(uuid,jsonb,text,text),
  public.knl_schedule_compensation_version(uuid,text,date,text,text)
from public,anon,authenticated;
grant execute on function
  public.knl_clone_compensation_version(uuid,text,text,text),
  public.knl_save_compensation_grades(uuid,jsonb,text,text),
  public.knl_schedule_compensation_version(uuid,text,date,text,text)
to service_role;

comment on function public.knl_clone_compensation_version(uuid,text,text,text) is 'Clone a compensation version''s grades into a new DRAFT version. Never migrates employee assignments.';
comment on function public.knl_save_compensation_grades(uuid,jsonb,text,text) is 'Edit LCB/HQCV/PC chuẩn on a DRAFT compensation version only; ACTIVE/SCHEDULED/INACTIVE remain immutable via trigger.';
comment on function public.knl_schedule_compensation_version(uuid,text,date,text,text) is 'Transition a DRAFT compensation version to SCHEDULED or ACTIVE with an explicit effective date. Creating a new version never bulk-migrates employee assignments.';

commit;

-- READ-ONLY verification after manual Production execution:
-- select proname from pg_proc where proname in ('knl_clone_compensation_version','knl_save_compensation_grades','knl_schedule_compensation_version');
-- select entity_type,action,count(*) from public.knl_compensation_audit group by 1,2 order by 1,2;
