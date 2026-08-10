-- PHF KNL 1.50.2 gate — restore missing grade definitions/matrix for the
-- exact 11 READY source versions seeded from the 2026-08-09 manifest.
--
-- DATA FIX: run manually in Production only after reviewing the audit output.
-- This is not a general rule that grade_count must equal level_count. The
-- initial PHF baseline explicitly approved B1..B4 for its 4-level source and
-- B1..B5 for its ten 5-level sources.
begin;

do $$
declare
  v_target_count integer;
  v_four_count integer;
  v_five_count integer;
  v_grade_count integer;
  v_requirement_count integer;
  v_item_count integer;
  v_actual_level_count integer;
  v record;
begin
  select count(*),
         count(*) filter(where m.level_count=4),
         count(*) filter(where m.level_count=5)
    into v_target_count,v_four_count,v_five_count
  from public.knl_source_manifests m
  where m.manifest_key like 'phf-knl-2026-08-09:%'
    and m.candidate_status='READY'
    and m.import_status='SEEDED'
    and m.framework_id is not null
    and m.version_id is not null;

  if v_target_count<>11 or v_four_count<>1 or v_five_count<>10 then
    raise exception 'KNL_GRADE_BASELINE_TARGET_MISMATCH: targets=%, four=%, five=%',
      v_target_count,v_four_count,v_five_count using errcode='55000';
  end if;

  for v in
    select m.id manifest_id,m.framework_id,m.version_id,m.source_sheet,
           m.level_count,fv.status,fv.is_locked,fv.lifecycle_status
    from public.knl_source_manifests m
    join public.knl_framework_versions fv on fv.id=m.version_id
    where m.manifest_key like 'phf-knl-2026-08-09:%'
      and m.candidate_status='READY'
      and m.import_status='SEEDED'
    order by m.source_sheet
    for update of fv
  loop
    if v.status<>'draft' or v.is_locked or v.lifecycle_status<>'DRAFT' then
      raise exception 'KNL_GRADE_BASELINE_VERSION_NOT_MUTABLE:%',v.source_sheet using errcode='55000';
    end if;

    select count(*) into v_actual_level_count
    from public.knl_structure_columns c
    where c.version_id=v.version_id and c.column_type='level' and c.is_active=true;
    if v_actual_level_count<>v.level_count then
      raise exception 'KNL_GRADE_BASELINE_LEVEL_MISMATCH:% expected=% actual=%',
        v.source_sheet,v.level_count,v_actual_level_count using errcode='55000';
    end if;

    select count(*) into v_grade_count
    from public.knl_grade_definitions g where g.version_id=v.version_id;
    select count(*) into v_requirement_count
    from public.knl_grade_requirements r where r.version_id=v.version_id;
    select count(*) into v_item_count
    from public.knl_competency_items i where i.version_id=v.version_id and i.is_active=true;

    if v_grade_count=0 and v_requirement_count=0 then
      insert into public.knl_grade_definitions(
        version_id,grade_code,grade_number,label,sort_order,
        created_by,created_by_name,updated_by,updated_by_name
      )
      select v.version_id,'B'||n,n,'Bậc '||n,n,
             'knl-grade-baseline-1.50.2','PHF KNL baseline data fix',
             'knl-grade-baseline-1.50.2','PHF KNL baseline data fix'
      from generate_series(1,v.level_count) n;

      insert into public.knl_grade_requirements(
        version_id,item_id,grade_id,required_column_id,required_level_number,
        created_by,created_by_name,updated_by,updated_by_name
      )
      select v.version_id,i.id,g.id,c.id,g.grade_number,
             'knl-grade-baseline-1.50.2','PHF KNL baseline data fix',
             'knl-grade-baseline-1.50.2','PHF KNL baseline data fix'
      from public.knl_competency_items i
      cross join public.knl_grade_definitions g
      join public.knl_structure_columns c
        on c.version_id=g.version_id
       and c.column_type='level'
       and c.is_active=true
       and c.level_number=g.grade_number
      where i.version_id=v.version_id
        and i.is_active=true
        and g.version_id=v.version_id;

      insert into public.knl_structure_audit(
        framework_id,version_id,entity_type,entity_id,action,
        before_data,after_data,changed_by,changed_by_name
      ) values(
        v.framework_id,v.version_id,'grade_matrix',v.version_id,'update',
        jsonb_build_object('grades',0,'requirements',0),
        jsonb_build_object('grades',v.level_count,'requirements',v_item_count*v.level_count,
          'baseline','PHF_KNL_SOURCE_2026-08-09_V1'),
        'knl-grade-baseline-1.50.2','PHF KNL baseline data fix'
      );
    elsif v_grade_count=v.level_count
      and v_requirement_count=v_item_count*v_grade_count then
      -- Idempotent rerun: the complete baseline already exists.
      null;
    else
      raise exception 'KNL_GRADE_BASELINE_PARTIAL_DATA:% grades=% requirements=% expected_requirements=%',
        v.source_sheet,v_grade_count,v_requirement_count,v_item_count*v.level_count
        using errcode='55000';
    end if;
  end loop;
end $$;

commit;

-- READ-ONLY verification after manual execution:
-- select f.code,f.name,m.source_sheet,m.level_count,
--   (select count(*) from public.knl_grade_definitions g where g.version_id=m.version_id) grade_count,
--   (select count(*) from public.knl_grade_requirements r where r.version_id=m.version_id) requirement_count
-- from public.knl_source_manifests m
-- join public.knl_frameworks f on f.id=m.framework_id
-- where m.manifest_key like 'phf-knl-2026-08-09:%' and m.candidate_status='READY'
-- order by m.source_sheet;
