-- PHF KNL 1.50.0 — Production hotfix for probation record access.
-- Replaces one RPC only. No table data is changed by this migration.
begin;

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

revoke all on function public.knl_save_employee_compensation(text,text,text,text,uuid,boolean,boolean,boolean,bigint,bigint,jsonb,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.knl_save_employee_compensation(text,text,text,text,uuid,boolean,boolean,boolean,bigint,bigint,jsonb,jsonb,text,text,text) to service_role;

commit;
