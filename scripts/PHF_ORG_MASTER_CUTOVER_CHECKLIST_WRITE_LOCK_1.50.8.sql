-- PHF Organization Master Cutover — Checklist Write Lock, 1.50.8
-- Replacement (same signature) of phf_save_checklist_assignments. Closes
-- the gap the application layer alone cannot close: even a DIRECT call to
-- this RPC (bypassing lib/checklist-assignments.js) can no longer write
-- department/title/position/branch/manager_code/manager_name — those are
-- now always taken live from public.employee_profiles (Organization
-- Master) by employee_code, falling back to the row's own current stored
-- value only when no Employee Master row exists yet for that code (never
-- invented, never blanked, never taken from the JSON payload).
--
-- NOT locked (traced, not guessed — see PHF_TrainingHub commit adding
-- lib/checklist-assignments.js's Checklist Write Lock comment):
--   employee_status stays payload-controlled. assets/js/checklist/
--   phf-checklist-app.js#employeeStatusModalHtml is Checklist's own
--   3-state "trạng thái áp dụng Checklist" (Đang làm việc/Nghỉ dài hạn/
--   Đã nghỉ việc) gating template-assignment eligibility — its own copy
--   says "không chỉnh lẫn trong thông tin tổ chức". It has no equivalent
--   in Employee Master's binary employment_status and would break the
--   "Cập nhật trạng thái làm việc" feature if locked here.
--   leave_until, status_note, template_id, template_version,
--   effective_date, reason, employee_id/employee_code/employee_name are
--   unchanged (Checklist's own domain/identity fields).
--
-- Does NOT drop department/title/position/branch/manager_id/manager_code/
-- manager_name from checklist_employee_assignments — kept for
-- compatibility/audit/history, no longer a write target for new data.
--
-- Run manually in Production after application tests pass.

begin;

create or replace function public.phf_save_checklist_assignments(
  p_rows jsonb,
  p_actor_id text default '',
  p_actor_name text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  old_row public.checklist_employee_assignments%rowtype;
  master public.employee_profiles%rowtype;
  manager_master public.employee_profiles%rowtype;
  changed_count integer := 0;
  total_count integer := 0;
  key_value text;
  employee_code_value text;
  v_master_found boolean;
  v_department text; v_title text; v_position text; v_branch text;
  v_manager_code text; v_manager_name text;
  expected_stamp timestamptz;
  expected_absent boolean;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  perform pg_advisory_xact_lock(hashtext('phf_checklist_assignment_global'));

  for item in
    select value
    from jsonb_array_elements(p_rows)
    order by lower(trim(coalesce(value->>'employee_key','')))
  loop
    total_count := total_count + 1;
    key_value := lower(trim(coalesce(item->>'employee_key','')));
    if key_value = '' then raise exception 'employee_key is required'; end if;
    perform pg_advisory_xact_lock(hashtext('phf_checklist_assignment|'||key_value));

    select * into old_row
    from public.checklist_employee_assignments
    where employee_key = key_value
    for update;

    expected_stamp := nullif(item->>'expected_updated_at','')::timestamptz;
    expected_absent := coalesce((item->>'expected_absent')::boolean,false);
    if found and (expected_absent or expected_stamp is null or old_row.updated_at is distinct from expected_stamp) then
      raise exception 'CHECKLIST_ASSIGNMENT_STALE:%', key_value;
    end if;
    if not found and (not expected_absent or expected_stamp is not null) then
      raise exception 'CHECKLIST_ASSIGNMENT_STALE:%', key_value;
    end if;

    -- Organization Master lookup: NEVER read department/title/position/
    -- branch/manager from `item` (client payload). employee_code prefers
    -- the payload's own value (needed for brand-new rows old_row lacks),
    -- falling back to old_row's stored code.
    employee_code_value := upper(trim(coalesce(nullif(item->>'employee_code',''), old_row.employee_code, '')));
    v_master_found := false;
    if employee_code_value <> '' then
      select * into master from public.employee_profiles where upper(trim(employee_code)) = employee_code_value;
      v_master_found := found;
    end if;

    if v_master_found and (coalesce(master.department,'')<>'' or coalesce(master.title,'')<>'' or coalesce(master.branch,'')<>'' or coalesce(master.position,'')<>'' or coalesce(master.manager_employee_code,'')<>'') then
      v_department := coalesce(master.department,'');
      v_title := coalesce(master.title,'');
      v_position := coalesce(master.position,'');
      v_branch := coalesce(master.branch,'');
      v_manager_code := coalesce(master.manager_employee_code,'');
      v_manager_name := '';
      if v_manager_code <> '' then
        select * into manager_master from public.employee_profiles where upper(trim(employee_code)) = upper(v_manager_code);
        if found then v_manager_name := coalesce(manager_master.full_name,''); end if;
      end if;
    else
      -- Chua co Employee Master row cho ma nay (vd nhan vien moi chua
      -- onboard) - giu nguyen gia tri dang luu, TUYET DOI khong lay tu
      -- client, khong blank.
      v_department := coalesce(old_row.department,'');
      v_title := coalesce(old_row.title,'');
      v_position := coalesce(old_row.position,'');
      v_branch := coalesce(old_row.branch,'');
      v_manager_code := coalesce(old_row.manager_code,'');
      v_manager_name := coalesce(old_row.manager_name,'');
    end if;

    if not found or
      row(old_row.employee_id,old_row.employee_code,old_row.employee_name,old_row.department,old_row.title,old_row.position,old_row.branch,old_row.manager_id,old_row.manager_code,old_row.manager_name,old_row.employee_status,old_row.leave_until,old_row.status_note,old_row.template_id,old_row.template_version,old_row.effective_date,old_row.reason)
      is distinct from
      row(coalesce(item->>'employee_id',''),coalesce(item->>'employee_code',''),coalesce(item->>'employee_name',''),v_department,v_title,v_position,v_branch,coalesce(item->>'manager_id',''),v_manager_code,v_manager_name,coalesce(item->>'employee_status','Đang làm việc'),nullif(item->>'leave_until','')::date,coalesce(item->>'status_note',''),coalesce(item->>'template_id',''),coalesce(item->>'template_version',''),(item->>'effective_date')::date,coalesce(nullif(item->>'reason',''),'Đồng bộ cấu hình Checklist'))
    then
      changed_count := changed_count + 1;

      insert into public.checklist_employee_assignment_history(
        employee_key,employee_id,employee_code,employee_name,department,title,position,branch,
        manager_id,manager_code,manager_name,employee_status,leave_until,status_note,
        template_id,template_version,effective_date,reason,changed_by,changed_by_name,
        previous_data,changed_at,updated_at
      ) values (
        key_value,coalesce(item->>'employee_id',''),coalesce(item->>'employee_code',''),
        coalesce(item->>'employee_name',''),v_department,v_title,v_position,v_branch,
        coalesce(item->>'manager_id',''),v_manager_code,v_manager_name,
        coalesce(item->>'employee_status','Đang làm việc'),
        nullif(item->>'leave_until','')::date,coalesce(item->>'status_note',''),
        coalesce(item->>'template_id',''),coalesce(item->>'template_version',''),
        (item->>'effective_date')::date,
        coalesce(nullif(item->>'reason',''),'Đồng bộ cấu hình Checklist'),
        p_actor_id,p_actor_name,
        case when old_row.id is null then null else to_jsonb(old_row) end,
        now(),now()
      );

      insert into public.checklist_employee_assignments(
        employee_key,employee_id,employee_code,employee_name,department,title,position,branch,
        manager_id,manager_code,manager_name,employee_status,leave_until,status_note,
        template_id,template_version,effective_date,reason,updated_by,updated_by_name,updated_at
      ) values (
        key_value,coalesce(item->>'employee_id',''),coalesce(item->>'employee_code',''),
        coalesce(item->>'employee_name',''),v_department,v_title,v_position,v_branch,
        coalesce(item->>'manager_id',''),v_manager_code,v_manager_name,
        coalesce(item->>'employee_status','Đang làm việc'),
        nullif(item->>'leave_until','')::date,coalesce(item->>'status_note',''),
        coalesce(item->>'template_id',''),coalesce(item->>'template_version',''),
        (item->>'effective_date')::date,
        coalesce(nullif(item->>'reason',''),'Đồng bộ cấu hình Checklist'),
        p_actor_id,p_actor_name,now()
      )
      on conflict(employee_key) do update set
        employee_id=excluded.employee_id,
        employee_code=excluded.employee_code,
        employee_name=excluded.employee_name,
        department=excluded.department,
        title=excluded.title,
        position=excluded.position,
        branch=excluded.branch,
        manager_id=excluded.manager_id,
        manager_code=excluded.manager_code,
        manager_name=excluded.manager_name,
        employee_status=excluded.employee_status,
        leave_until=excluded.leave_until,
        status_note=excluded.status_note,
        template_id=excluded.template_id,
        template_version=excluded.template_version,
        effective_date=excluded.effective_date,
        reason=excluded.reason,
        updated_by=excluded.updated_by,
        updated_by_name=excluded.updated_by_name,
        updated_at=now();
    end if;
  end loop;

  return jsonb_build_object('saved',total_count,'changed',changed_count);
end;
$$;

revoke all on function public.phf_save_checklist_assignments(jsonb,text,text) from public,anon,authenticated;
grant execute on function public.phf_save_checklist_assignments(jsonb,text,text) to service_role;

commit;

-- READ-ONLY verification after manual Production execution:
-- 1) Confirm function body updated: select prosrc from pg_proc where proname='phf_save_checklist_assignments';
-- 2) Try changing an org field via the Checklist UI/API for a real employee_code
--    that has employee_profiles data -> the saved row must show the Employee
--    Master value, not what was submitted.
