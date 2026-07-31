-- PHF Checklist 1.33.0 · Production stability / deep logic fixes
-- Chạy sau toàn bộ SQL Checklist 1.32.x hiện có.
-- Mục tiêu: transaction, optimistic locking, chống ghi đè, khóa kỳ và audit nguyên tử.

begin;

-- Chuẩn hóa timestamp cho optimistic locking trên dữ liệu cũ.
update public.checklist_violation_records
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;
alter table public.checklist_violation_records alter column updated_at set default now();
alter table public.checklist_violation_records alter column updated_at set not null;

-- ---------------------------------------------------------------------------
-- 1) Nhân sự & phân công: transaction sẵn có + optimistic locking theo updated_at
-- ---------------------------------------------------------------------------
create or replace function public.phf_save_checklist_assignments(
  p_rows jsonb,
  p_actor_id text default '',
  p_actor_name text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  old_row public.checklist_employee_assignments%rowtype;
  changed_count integer := 0;
  total_count integer := 0;
  key_value text;
  expected_stamp timestamptz;
  expected_absent boolean;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  -- Đồng bộ với khởi tạo kỳ tháng để snapshot phân công không đổi giữa lúc kiểm tra và ghi phiếu.
  perform pg_advisory_xact_lock(hashtext('phf_checklist_assignment_global'));

  for item in select value from jsonb_array_elements(p_rows) order by lower(trim(coalesce(value->>'employee_key','')))
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

    if not found or
      row(old_row.employee_id,old_row.employee_code,old_row.employee_name,old_row.department,old_row.title,old_row.branch,old_row.manager_id,old_row.manager_code,old_row.manager_name,old_row.employee_status,old_row.leave_until,old_row.status_note,old_row.template_id,old_row.template_version,old_row.effective_date,old_row.reason)
      is distinct from
      row(coalesce(item->>'employee_id',''),coalesce(item->>'employee_code',''),coalesce(item->>'employee_name',''),coalesce(item->>'department',''),coalesce(item->>'title',''),coalesce(item->>'branch',''),coalesce(item->>'manager_id',''),coalesce(item->>'manager_code',''),coalesce(item->>'manager_name',''),coalesce(item->>'employee_status','Đang làm việc'),nullif(item->>'leave_until','')::date,coalesce(item->>'status_note',''),coalesce(item->>'template_id',''),coalesce(item->>'template_version',''),(item->>'effective_date')::date,coalesce(nullif(item->>'reason',''),'Đồng bộ cấu hình Checklist'))
    then
      changed_count := changed_count + 1;

      insert into public.checklist_employee_assignment_history(
        employee_key,employee_id,employee_code,employee_name,department,title,branch,
        manager_id,manager_code,manager_name,employee_status,leave_until,status_note,
        template_id,template_version,effective_date,reason,changed_by,changed_by_name,
        previous_data,changed_at,updated_at
      ) values (
        key_value,coalesce(item->>'employee_id',''),coalesce(item->>'employee_code',''),
        coalesce(item->>'employee_name',''),coalesce(item->>'department',''),
        coalesce(item->>'title',''),coalesce(item->>'branch',''),
        coalesce(item->>'manager_id',''),coalesce(item->>'manager_code',''),
        coalesce(item->>'manager_name',''),coalesce(item->>'employee_status','Đang làm việc'),
        nullif(item->>'leave_until','')::date,coalesce(item->>'status_note',''),
        coalesce(item->>'template_id',''),coalesce(item->>'template_version',''),
        (item->>'effective_date')::date,
        coalesce(nullif(item->>'reason',''),'Đồng bộ cấu hình Checklist'),
        p_actor_id,p_actor_name,
        case when old_row.id is null then null else to_jsonb(old_row) end,
        now(),now()
      );

      insert into public.checklist_employee_assignments(
        employee_key,employee_id,employee_code,employee_name,department,title,branch,
        manager_id,manager_code,manager_name,employee_status,leave_until,status_note,
        template_id,template_version,effective_date,reason,updated_by,updated_by_name,updated_at
      ) values (
        key_value,coalesce(item->>'employee_id',''),coalesce(item->>'employee_code',''),
        coalesce(item->>'employee_name',''),coalesce(item->>'department',''),
        coalesce(item->>'title',''),coalesce(item->>'branch',''),
        coalesce(item->>'manager_id',''),coalesce(item->>'manager_code',''),
        coalesce(item->>'manager_name',''),coalesce(item->>'employee_status','Đang làm việc'),
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

-- ---------------------------------------------------------------------------
-- 2) Thư viện mẫu: parent + version trong cùng transaction, chống stale update
-- ---------------------------------------------------------------------------
create or replace function public.phf_save_checklist_template(
  p_template jsonb,
  p_version jsonb,
  p_actor_id text default '',
  p_actor_name text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := lower(trim(coalesce(p_template->>'template_key','')));
  v_version text := trim(coalesce(p_version->>'version_no',''));
  v_old public.checklist_templates%rowtype;
  v_expected timestamptz := nullif(p_template->>'expected_updated_at','')::timestamptz;
  v_expected_absent boolean := coalesce((p_template->>'expected_absent')::boolean,false);
begin
  if v_key='' or v_version='' then
    raise exception 'CHECKLIST_TEMPLATE_KEY_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtext('phf_checklist_template_global'));
  perform pg_advisory_xact_lock(hashtext('phf_checklist_template|'||v_key));

  select * into v_old
  from public.checklist_templates
  where template_key=v_key
  for update;

  if found and (v_expected_absent or v_expected is null or v_old.updated_at is distinct from v_expected) then
    raise exception 'CHECKLIST_TEMPLATE_STALE:%',v_key;
  end if;
  if not found and (not v_expected_absent or v_expected is not null) then
    raise exception 'CHECKLIST_TEMPLATE_STALE:%',v_key;
  end if;

  if not found then
    insert into public.checklist_templates(
      template_key,code,name,group_name,template_type,has_checklist,source,note,status,
      current_version,effective_date,created_by,created_by_name,updated_at
    ) values (
      v_key,upper(trim(p_template->>'code')),coalesce(p_template->>'name',''),
      coalesce(p_template->>'group_name',''),coalesce(nullif(p_template->>'template_type',''),'checklist_detail'),
      coalesce((p_template->>'has_checklist')::boolean,true),coalesce(p_template->>'source',''),
      coalesce(p_template->>'note',''),coalesce(nullif(p_template->>'status',''),'active'),
      v_version,(p_template->>'effective_date')::date,p_actor_id,p_actor_name,now()
    );
  end if;

  insert into public.checklist_template_versions(
    template_key,version_no,effective_date,reason,source_version,change_type,definition,
    created_by,created_by_name,created_at
  ) values (
    v_key,v_version,(p_version->>'effective_date')::date,
    coalesce(nullif(p_version->>'reason',''),'Cập nhật mẫu Checklist'),
    coalesce(p_version->>'source_version',''),coalesce(nullif(p_version->>'change_type',''),'sync'),
    coalesce(p_version->'definition','{"groups":[],"totalRows":[],"templateType":"checklist_detail"}'::jsonb),
    p_actor_id,p_actor_name,coalesce(nullif(p_version->>'created_at','')::timestamptz,now())
  )
  on conflict(template_key,version_no) do update set
    effective_date=excluded.effective_date,
    reason=excluded.reason,
    source_version=excluded.source_version,
    change_type=excluded.change_type,
    definition=excluded.definition,
    created_by=excluded.created_by,
    created_by_name=excluded.created_by_name;

  update public.checklist_templates set
    code=upper(trim(p_template->>'code')),
    name=coalesce(p_template->>'name',''),
    group_name=coalesce(p_template->>'group_name',''),
    template_type=coalesce(nullif(p_template->>'template_type',''),'checklist_detail'),
    has_checklist=coalesce((p_template->>'has_checklist')::boolean,true),
    source=coalesce(p_template->>'source',''),
    note=coalesce(p_template->>'note',''),
    status=coalesce(nullif(p_template->>'status',''),'active'),
    current_version=v_version,
    effective_date=(p_template->>'effective_date')::date,
    updated_at=now()
  where template_key=v_key;

  return jsonb_build_object('ok',true,'templateKey',v_key,'version',v_version);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Khởi tạo kỳ + phiếu tháng: atomic, idempotent và khóa snapshot phân công
-- ---------------------------------------------------------------------------
drop function if exists public.phf_create_checklist_monthly(text,jsonb,jsonb,text,text);
create or replace function public.phf_create_checklist_monthly(
  p_period_month text,
  p_score_policy jsonb,
  p_forms jsonb,
  p_source_revision jsonb,
  p_actor_id text default '',
  p_actor_name text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period public.checklist_monthly_periods%rowtype;
  item jsonb;
  v_created integer := 0;
  v_skipped integer := 0;
  v_current_count bigint := 0;
  v_history_count bigint := 0;
  v_current_max timestamptz;
  v_history_max timestamptz;
  v_expected_current_count bigint;
  v_expected_history_count bigint;
  v_expected_current_max timestamptz;
  v_expected_history_max timestamptz;
  v_template_count bigint := 0;
  v_template_version_count bigint := 0;
  v_template_max timestamptz;
  v_template_version_max timestamptz;
  v_expected_template_count bigint;
  v_expected_template_version_count bigint;
  v_expected_template_max timestamptz;
  v_expected_template_version_max timestamptz;
begin
  if p_period_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    return jsonb_build_object('ok',false,'code','CHECKLIST_MONTHLY_INVALID','message','Kỳ đánh giá không hợp lệ.');
  end if;
  if jsonb_typeof(p_forms)<>'array' then
    return jsonb_build_object('ok',false,'code','CHECKLIST_MONTHLY_FORMS_INVALID','message','Danh sách phiếu không hợp lệ.');
  end if;
  if jsonb_typeof(p_source_revision)<>'object' then
    return jsonb_build_object('ok',false,'code','CHECKLIST_SOURCE_REVISION_INVALID','message','Revision nguồn dữ liệu không hợp lệ.');
  end if;

  -- Khóa cùng khóa mà RPC lưu phân công sử dụng. Nếu có thay đổi sau lúc backend
  -- đọc snapshot, revision sẽ lệch và toàn bộ thao tác tạo kỳ bị rollback.
  perform pg_advisory_xact_lock(hashtext('phf_checklist_assignment_global'));
  perform pg_advisory_xact_lock(hashtext('phf_checklist_template_global'));
  select count(*),max(updated_at) into v_current_count,v_current_max
  from public.checklist_employee_assignments;
  select count(*),max(coalesce(changed_at,updated_at)) into v_history_count,v_history_max
  from public.checklist_employee_assignment_history;

  select count(*),max(updated_at) into v_template_count,v_template_max from public.checklist_templates;
  select count(*),max(created_at) into v_template_version_count,v_template_version_max from public.checklist_template_versions;

  v_expected_current_count := coalesce((p_source_revision->>'current_count')::bigint,-1);
  v_expected_history_count := coalesce((p_source_revision->>'history_count')::bigint,-1);
  v_expected_current_max := nullif(p_source_revision->>'current_max','')::timestamptz;
  v_expected_history_max := nullif(p_source_revision->>'history_max','')::timestamptz;
  v_expected_template_count := coalesce((p_source_revision->>'template_count')::bigint,-1);
  v_expected_template_version_count := coalesce((p_source_revision->>'template_version_count')::bigint,-1);
  v_expected_template_max := nullif(p_source_revision->>'template_max','')::timestamptz;
  v_expected_template_version_max := nullif(p_source_revision->>'template_version_max','')::timestamptz;

  if v_expected_current_count<>v_current_count
    or v_expected_history_count<>v_history_count
    or v_expected_current_max is distinct from v_current_max
    or v_expected_history_max is distinct from v_history_max
    or v_expected_template_count<>v_template_count
    or v_expected_template_version_count<>v_template_version_count
    or v_expected_template_max is distinct from v_template_max
    or v_expected_template_version_max is distinct from v_template_version_max
  then
    raise exception 'CHECKLIST_SOURCE_SNAPSHOT_STALE';
  end if;

  perform pg_advisory_xact_lock(hashtext('phf_checklist_monthly|'||p_period_month));

  select * into v_period
  from public.checklist_monthly_periods
  where period_month=p_period_month
  for update;

  if not found then
    insert into public.checklist_monthly_periods(
      period_month,status,created_by,created_by_name,score_policy_snapshot,updated_at
    ) values (
      p_period_month,'draft',p_actor_id,p_actor_name,coalesce(p_score_policy,'{}'::jsonb),now()
    ) returning * into v_period;
  end if;

  if v_period.status<>'draft' then
    return jsonb_build_object('ok',false,'code','CHECKLIST_MONTHLY_NOT_DRAFT','message','Kỳ đánh giá đã mở hoặc đã khóa; không thể bổ sung phiếu tự động.');
  end if;

  if coalesce(v_period.score_policy_snapshot,'{}'::jsonb)='{}'::jsonb then
    update public.checklist_monthly_periods
    set score_policy_snapshot=coalesce(p_score_policy,'{}'::jsonb),updated_at=now()
    where id=v_period.id;
  end if;

  for item in select value from jsonb_array_elements(p_forms)
  loop
    insert into public.checklist_monthly_forms(
      period_id,period_month,employee_id,employee_code,employee_name,department,title,branch,
      reviewer_id,reviewer_code,reviewer_name,template_id,template_version,template_snapshot,
      score_policy_snapshot,checklist_score,status,updated_at
    ) values (
      v_period.id,p_period_month,coalesce(item->>'employee_id',''),upper(coalesce(item->>'employee_code','')),
      coalesce(item->>'employee_name',''),coalesce(item->>'department',''),coalesce(item->>'title',''),
      coalesce(item->>'branch',''),coalesce(item->>'reviewer_id',''),coalesce(item->>'reviewer_code',''),
      coalesce(item->>'reviewer_name',''),coalesce(item->>'template_id',''),coalesce(item->>'template_version',''),
      coalesce(item->'template_snapshot','{}'::jsonb),coalesce(item->'score_policy_snapshot',p_score_policy,'{}'::jsonb),
      coalesce((item->>'checklist_score')::numeric,100),coalesce(nullif(item->>'status',''),'draft'),now()
    )
    on conflict(period_month,employee_code) do nothing;

    if found then v_created:=v_created+1; else v_skipped:=v_skipped+1; end if;
  end loop;

  return jsonb_build_object('ok',true,'periodId',v_period.id,'created',v_created,'skipped',v_skipped);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Khóa thay đổi lỗi thuộc phiếu đã reviewed/locked
-- ---------------------------------------------------------------------------
create or replace function public.phf_assert_checklist_violation_period_open(
  p_employee_code text,
  p_occurred_date date
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  -- Khóa cùng bản ghi phiếu mà RPC thẩm định sẽ khóa. Nhờ đó ghi lỗi và
  -- hoàn tất thẩm định không thể cùng vượt qua kiểm tra bằng hai snapshot khác nhau.
  select f.status into v_status
  from public.checklist_monthly_forms f
  where upper(f.employee_code)=upper(coalesce(p_employee_code,''))
    and f.period_month=to_char(p_occurred_date,'YYYY-MM')
  for update;
  if found and v_status in ('reviewed','locked') then
    raise exception 'CHECKLIST_PERIOD_FINALIZED:%:%',upper(coalesce(p_employee_code,'')),to_char(p_occurred_date,'YYYY-MM');
  end if;
end;
$$;

create or replace function public.phf_guard_checklist_violation_finalized_period()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op='INSERT' then
    if new.is_test=false and new.record_status='official' then
      perform public.phf_assert_checklist_violation_period_open(new.employee_code,new.occurred_date);
    end if;
    return new;
  end if;

  if tg_op='DELETE' then
    if old.is_test=false and old.record_status='official' then
      perform public.phf_assert_checklist_violation_period_open(old.employee_code,old.occurred_date);
    end if;
    return old;
  end if;

  if (
    old.is_test is distinct from new.is_test or
    old.record_status is distinct from new.record_status or
    old.points is distinct from new.points or
    old.employee_code is distinct from new.employee_code or
    old.occurred_date is distinct from new.occurred_date or
    old.criterion_code is distinct from new.criterion_code
  ) then
    if old.is_test=false and old.record_status='official' then
      perform public.phf_assert_checklist_violation_period_open(old.employee_code,old.occurred_date);
    end if;
    if new.is_test=false and new.record_status='official' then
      perform public.phf_assert_checklist_violation_period_open(new.employee_code,new.occurred_date);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_phf_guard_violation_finalized_period on public.checklist_violation_records;
create trigger trg_phf_guard_violation_finalized_period
before insert or update or delete on public.checklist_violation_records
for each row execute function public.phf_guard_checklist_violation_finalized_period();

-- ---------------------------------------------------------------------------
-- 5) Sửa / hủy / xóa TEST + audit trong cùng transaction
-- ---------------------------------------------------------------------------
create or replace function public.phf_mutate_checklist_violation(
  p_record_id uuid,
  p_action text,
  p_after jsonb default '{}'::jsonb,
  p_reason text default '',
  p_actor_id text default '',
  p_actor_name text default '',
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.checklist_violation_records%rowtype;
  v_new public.checklist_violation_records%rowtype;
  v_task public.checklist_violation_tasks%rowtype;
  v_new_task public.checklist_violation_tasks%rowtype;
  v_now timestamptz := now();
begin
  -- Thống nhất thứ tự khóa task -> violation với RPC chuyển trạng thái để tránh deadlock.
  select * into v_task
  from public.checklist_violation_tasks
  where violation_id=p_record_id
  for update;

  select * into v_old
  from public.checklist_violation_records
  where id=p_record_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'code','CHECKLIST_VIOLATION_NOT_FOUND','message','Bản ghi không còn tồn tại.');
  end if;
  if p_expected_updated_at is not null and v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'CHECKLIST_VIOLATION_STALE:%',p_record_id;
  end if;

  if p_action='edit_test' then
    if v_old.is_test<>true then
      return jsonb_build_object('ok',false,'code','CHECKLIST_PRODUCTION_EDIT_BLOCKED','message','Dữ liệu chính thức không được sửa trực tiếp.');
    end if;
    if v_old.record_status='cancelled' then
      return jsonb_build_object('ok',false,'code','CHECKLIST_RECORD_CANCELLED','message','Bản ghi đã hủy, không thể chỉnh sửa.');
    end if;

    update public.checklist_violation_records set
      employee_id=coalesce(p_after->>'employee_id',employee_id),
      employee_code=coalesce(p_after->>'employee_code',employee_code),
      employee_name=coalesce(p_after->>'employee_name',employee_name),
      template_id=coalesce(p_after->>'template_id',template_id),
      template_version=coalesce(p_after->>'template_version',template_version),
      template_name=coalesce(p_after->>'template_name',template_name),
      criterion_id=coalesce(p_after->>'criterion_id',criterion_id),
      criterion_code=coalesce(p_after->>'criterion_code',criterion_code),
      criterion_name=coalesce(p_after->>'criterion_name',criterion_name),
      criterion_group=coalesce(p_after->>'criterion_group',criterion_group),
      factor=coalesce((p_after->>'factor')::numeric,factor),
      points=coalesce((p_after->>'points')::numeric,points),
      late_standard_points=case when p_after ? 'late_standard_points' then nullif(p_after->>'late_standard_points','')::numeric else late_standard_points end,
      late_adjustment_reason=coalesce(p_after->>'late_adjustment_reason',late_adjustment_reason),
      late_adjusted_by=coalesce(p_after->>'late_adjusted_by',late_adjusted_by),
      late_adjusted_by_name=coalesce(p_after->>'late_adjusted_by_name',late_adjusted_by_name),
      late_adjusted_at=case when p_after ? 'late_adjusted_at' then nullif(p_after->>'late_adjusted_at','')::timestamptz else late_adjusted_at end,
      occurred_date=coalesce((p_after->>'occurred_date')::date,occurred_date),
      occurred_time=case when p_after ? 'occurred_time' then nullif(p_after->>'occurred_time','')::time else occurred_time end,
      location=coalesce(p_after->>'location',location),
      note=coalesce(p_after->>'note',note),
      evidence_required=coalesce((p_after->>'evidence_required')::boolean,evidence_required),
      has_evidence=coalesce((p_after->>'has_evidence')::boolean,has_evidence),
      duplicate_fingerprint=coalesce(p_after->>'duplicate_fingerprint',duplicate_fingerprint),
      updated_by=p_actor_id,updated_by_name=p_actor_name,updated_at=v_now,
      change_count=coalesce(change_count,0)+1
    where id=p_record_id
    returning * into v_new;

    insert into public.checklist_violation_record_history(
      record_id,employee_code,action,before_data,after_data,reason,changed_by,changed_by_name,changed_at
    ) values (
      v_old.id,v_old.employee_code,'edit',to_jsonb(v_old),to_jsonb(v_new),coalesce(nullif(trim(p_reason),''),'Chỉnh sửa dữ liệu TEST'),p_actor_id,p_actor_name,v_now
    );

    return jsonb_build_object('ok',true,'record',to_jsonb(v_new));
  elsif p_action='cancel' then
    if v_old.record_status='cancelled' then
      return jsonb_build_object('ok',false,'code','CHECKLIST_ALREADY_CANCELLED','message','Bản ghi đã được hủy trước đó.');
    end if;

    update public.checklist_violation_records set
      record_status='cancelled',cancel_reason=trim(p_reason),cancelled_by=p_actor_id,
      cancelled_by_name=p_actor_name,cancelled_at=v_now,updated_by=p_actor_id,
      updated_by_name=p_actor_name,updated_at=v_now,change_count=coalesce(change_count,0)+1
    where id=p_record_id
    returning * into v_new;

    insert into public.checklist_violation_record_history(
      record_id,employee_code,action,before_data,after_data,reason,changed_by,changed_by_name,changed_at
    ) values (
      v_old.id,v_old.employee_code,'cancel',to_jsonb(v_old),to_jsonb(v_new),trim(p_reason),p_actor_id,p_actor_name,v_now
    );

    if v_task.id is not null and v_task.status<>'cancelled' then
      update public.checklist_violation_tasks set
        status='cancelled',completed_at=v_now,updated_at=v_now
      where id=v_task.id
      returning * into v_new_task;
      insert into public.checklist_violation_task_history(
        task_id,violation_id,action,from_status,to_status,note,actor_id,actor_name,created_at
      ) values (
        v_task.id,v_old.id,'cancel_violation_direct',v_task.status,'cancelled',trim(p_reason),p_actor_id,p_actor_name,v_now
      );
    end if;

    return jsonb_build_object('ok',true,'record',to_jsonb(v_new),'task',case when v_new_task.id is null then null else to_jsonb(v_new_task) end);
  elsif p_action='delete_test' then
    if v_old.is_test<>true then
      return jsonb_build_object('ok',false,'code','CHECKLIST_PRODUCTION_DELETE_BLOCKED','message','Không thể xóa cứng dữ liệu chính thức.');
    end if;

    insert into public.checklist_violation_record_history(
      record_id,employee_code,action,before_data,after_data,reason,changed_by,changed_by_name,changed_at
    ) values (
      v_old.id,v_old.employee_code,'delete_test',to_jsonb(v_old),'{}'::jsonb,coalesce(nullif(trim(p_reason),''),'Xóa bản ghi TEST'),p_actor_id,p_actor_name,v_now
    );

    delete from public.checklist_violation_records where id=p_record_id and is_test=true;
    return jsonb_build_object('ok',true,'deleted',1);
  end if;

  return jsonb_build_object('ok',false,'code','CHECKLIST_VIOLATION_ACTION_INVALID','message','Thao tác không hợp lệ.');
end;
$$;

create or replace function public.phf_delete_checklist_test_violations(
  p_employee_code text default '',
  p_test_batch_id text default '',
  p_reason text default '',
  p_actor_id text default '',
  p_actor_name text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_item public.checklist_violation_records%rowtype;
  v_deleted integer := 0;
begin
  for row_item in
    select * from public.checklist_violation_records
    where is_test=true
      and (trim(coalesce(p_employee_code,''))='' or upper(employee_code)=upper(trim(p_employee_code)))
      and (trim(coalesce(p_test_batch_id,''))='' or test_batch_id=trim(p_test_batch_id))
    for update
  loop
    insert into public.checklist_violation_record_history(
      record_id,employee_code,action,before_data,after_data,reason,changed_by,changed_by_name,changed_at
    ) values (
      row_item.id,row_item.employee_code,'delete_test_batch',to_jsonb(row_item),'{}'::jsonb,
      coalesce(nullif(trim(p_reason),''),'Dọn đợt TEST'),p_actor_id,p_actor_name,now()
    );
    delete from public.checklist_violation_records where id=row_item.id;
    v_deleted:=v_deleted+1;
  end loop;
  return jsonb_build_object('ok',true,'deleted',v_deleted);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Task + task history + violation history trong cùng transaction
-- reviewer_accept = chấp nhận giải trình, hủy lỗi và hoàn điểm.
-- ---------------------------------------------------------------------------
create or replace function public.phf_transition_checklist_task(
  p_task_id uuid,
  p_action text,
  p_note text default '',
  p_actor_id text default '',
  p_actor_employee_id text default '',
  p_actor_code text default '',
  p_actor_name text default '',
  p_actor_role text default '',
  p_reviewer_days integer default 3,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task public.checklist_violation_tasks%rowtype;
  v_after public.checklist_violation_tasks%rowtype;
  v_violation public.checklist_violation_records%rowtype;
  v_new_violation public.checklist_violation_records%rowtype;
  v_status text;
  v_assignee_id text;
  v_assignee_code text;
  v_assignee_type text;
  v_due timestamptz;
  v_completed timestamptz;
  v_now timestamptz := now();
  v_is_subject boolean;
  v_is_creator boolean;
begin
  select * into v_task
  from public.checklist_violation_tasks
  where id=p_task_id
  for update;

  if not found then return jsonb_build_object('ok',false,'code','CHECKLIST_TASK_NOT_FOUND','message','Công việc không còn tồn tại.'); end if;
  if p_expected_updated_at is null or v_task.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok',false,'code','CHECKLIST_TASK_STALE','message','Công việc đã được cập nhật ở tab hoặc máy khác.');
  end if;
  if v_task.status in ('completed','cancelled') then return jsonb_build_object('ok',false,'code','CHECKLIST_TASK_ALREADY_CLOSED','message','Công việc đã có kết luận cuối.'); end if;

  v_is_subject := (trim(p_actor_employee_id)<>'' and v_task.employee_id=trim(p_actor_employee_id))
    or (trim(p_actor_code)<>'' and upper(v_task.employee_code)=upper(trim(p_actor_code)));
  v_is_creator := trim(p_actor_id)<>'' and v_task.created_by=trim(p_actor_id);

  if p_action in ('employee_confirm','employee_explain') and (v_task.status<>'waiting_employee' or not v_is_subject) then
    return jsonb_build_object('ok',false,'code','CHECKLIST_TASK_EMPLOYEE_ONLY','message','Chỉ nhân viên liên quan được xử lý lỗi này.');
  end if;
  if p_action in ('reviewer_accept','reviewer_uphold','reviewer_escalate') and (v_task.status<>'waiting_reviewer' or (not v_is_creator and lower(trim(p_actor_role))<>'admin')) then
    return jsonb_build_object('ok',false,'code','CHECKLIST_TASK_REVIEWER_ONLY','message','Chỉ người ghi lỗi hoặc Admin được phản hồi giải trình.');
  end if;
  if p_action in ('admin_uphold','admin_cancel') and (v_task.status<>'waiting_admin' or lower(trim(p_actor_role))<>'admin') then
    return jsonb_build_object('ok',false,'code','CHECKLIST_TASK_ADMIN_ONLY','message','Chỉ Admin được kết luận trường hợp này.');
  end if;

  if p_action='employee_confirm' then
    v_status:='completed';v_assignee_id:=v_task.current_assignee_id;v_assignee_code:=v_task.current_assignee_code;v_assignee_type:='employee';v_due:=v_task.due_at;v_completed:=v_now;
  elsif p_action='employee_explain' then
    v_status:='waiting_reviewer';v_assignee_id:=v_task.created_by;v_assignee_code:=null;v_assignee_type:='reviewer';v_due:=v_now+(greatest(1,least(30,coalesce(p_reviewer_days,3)))||' days')::interval;v_completed:=null;
  elsif p_action='reviewer_escalate' then
    v_status:='waiting_admin';v_assignee_id:=null;v_assignee_code:=null;v_assignee_type:='admin';v_due:=v_now+interval '3 days';v_completed:=null;
  elsif p_action='reviewer_accept' then
    v_status:='cancelled';v_assignee_id:=p_actor_id;v_assignee_code:=p_actor_code;v_assignee_type:='reviewer';v_due:=v_task.due_at;v_completed:=v_now;
  elsif p_action='reviewer_uphold' then
    v_status:='completed';v_assignee_id:=p_actor_id;v_assignee_code:=p_actor_code;v_assignee_type:='reviewer';v_due:=v_task.due_at;v_completed:=v_now;
  elsif p_action='admin_cancel' then
    v_status:='cancelled';v_assignee_id:=p_actor_id;v_assignee_code:=p_actor_code;v_assignee_type:='admin';v_due:=v_task.due_at;v_completed:=v_now;
  elsif p_action='admin_uphold' then
    v_status:='completed';v_assignee_id:=p_actor_id;v_assignee_code:=p_actor_code;v_assignee_type:='admin';v_due:=v_task.due_at;v_completed:=v_now;
  else
    return jsonb_build_object('ok',false,'code','CHECKLIST_TASK_ACTION_INVALID','message','Thao tác xử lý không hợp lệ.');
  end if;

  update public.checklist_violation_tasks set
    status=v_status,current_assignee_id=v_assignee_id,current_assignee_code=v_assignee_code,
    current_assignee_type=v_assignee_type,due_at=v_due,completed_at=v_completed,updated_at=v_now
  where id=p_task_id and status=v_task.status
  returning * into v_after;

  if not found then raise exception 'CHECKLIST_TASK_STALE:%',p_task_id; end if;

  insert into public.checklist_violation_task_history(
    task_id,violation_id,action,from_status,to_status,note,actor_id,actor_name,created_at
  ) values (
    v_task.id,v_task.violation_id,p_action,v_task.status,v_after.status,
    coalesce(nullif(trim(p_note),''),case when p_action='employee_confirm' then 'Nhân viên xác nhận lỗi' else p_action end),
    coalesce(nullif(trim(p_actor_id),''),nullif(trim(p_actor_employee_id),'')),p_actor_name,v_now
  );

  if p_action in ('reviewer_accept','admin_cancel') then
    select * into v_violation
    from public.checklist_violation_records
    where id=v_task.violation_id
    for update;

    if found and v_violation.record_status<>'cancelled' then
      update public.checklist_violation_records set
        record_status='cancelled',cancel_reason=trim(p_note),cancelled_by=p_actor_id,
        cancelled_by_name=p_actor_name,cancelled_at=v_now,updated_by=p_actor_id,
        updated_by_name=p_actor_name,updated_at=v_now,change_count=coalesce(change_count,0)+1
      where id=v_violation.id
      returning * into v_new_violation;

      insert into public.checklist_violation_record_history(
        record_id,employee_code,action,before_data,after_data,reason,changed_by,changed_by_name,changed_at
      ) values (
        v_violation.id,v_violation.employee_code,'cancel',to_jsonb(v_violation),to_jsonb(v_new_violation),
        trim(p_note),p_actor_id,p_actor_name,v_now
      );
    end if;
  end if;

  return jsonb_build_object('ok',true,'taskId',v_after.id,'status',v_after.status);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Phân quyền: chống overlap + data/history atomic theo batch
-- ---------------------------------------------------------------------------
create or replace function public.phf_save_checklist_permission_grants(
  p_grants jsonb,
  p_actor_id text default '',
  p_actor_name text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  v_before public.checklist_permission_grants%rowtype;
  v_saved public.checklist_permission_grants%rowtype;
  v_id uuid;
  v_input_id uuid;
  v_expected timestamptz;
  v_expected_absent boolean;
  v_results jsonb := '[]'::jsonb;
  v_account text;
  v_employee text;
  v_from date;
  v_to date;
  v_active boolean;
begin
  if jsonb_typeof(p_grants)<>'array' then raise exception 'p_grants must be a JSON array'; end if;
  -- Cấu hình quyền là thao tác Admin hiếm; khóa chung toàn batch để tránh deadlock
  -- và last-write-wins khi hai Admin import/sửa cùng lúc.
  perform pg_advisory_xact_lock(hashtext('phf_permission_grants_global'));

  for item in
    select value from jsonb_array_elements(p_grants)
    order by coalesce(value->>'account_id',value->>'employee_code',''),coalesce(value->>'effective_from','')
  loop
    v_account:=nullif(trim(coalesce(item->>'account_id','')),'');
    v_employee:=nullif(upper(trim(coalesce(item->>'employee_code',''))),'');
    v_from:=(item->>'effective_from')::date;
    v_to:=nullif(item->>'effective_to','')::date;
    v_active:=coalesce((item->>'is_active')::boolean,true);
    v_input_id:=nullif(item->>'id','')::uuid;
    v_expected:=nullif(item->>'expected_updated_at','')::timestamptz;
    v_expected_absent:=coalesce((item->>'expected_absent')::boolean,false);
    v_before:=null;

    if v_input_id is not null then
      select * into v_before from public.checklist_permission_grants where id=v_input_id for update;
    else
      select * into v_before
      from public.checklist_permission_grants
      where effective_from=v_from
        and ((v_account is not null and account_id=v_account) or (v_employee is not null and upper(employee_code)=v_employee))
      order by updated_at desc
      limit 1
      for update;
    end if;

    if found and (v_expected_absent or v_expected is null or v_before.updated_at is distinct from v_expected) then
      raise exception 'CHECKLIST_PERMISSION_STALE:%',coalesce(v_input_id::text,v_account,v_employee);
    end if;
    if not found and (not v_expected_absent or v_expected is not null or v_input_id is not null) then
      raise exception 'CHECKLIST_PERMISSION_STALE:%',coalesce(v_input_id::text,v_account,v_employee);
    end if;

    v_id:=case when v_before.id is not null then v_before.id else gen_random_uuid() end;

    if v_active and exists(
      select 1 from public.checklist_permission_grants g
      where g.id<>v_id and g.is_active=true
        and ((v_account is not null and g.account_id=v_account) or (v_employee is not null and upper(g.employee_code)=v_employee))
        and daterange(g.effective_from,coalesce(g.effective_to,'infinity'::date),'[]') && daterange(v_from,coalesce(v_to,'infinity'::date),'[]')
    ) then
      raise exception 'CHECKLIST_PERMISSION_OVERLAP:%',coalesce(v_account,v_employee);
    end if;

    if v_before.id is null then
      insert into public.checklist_permission_grants(
        id,account_id,employee_code,employee_name,preset_code,capabilities,view_scope,review_scope,
        record_scope,export_scope,effective_from,effective_to,reason,is_active,
        created_by,created_by_name,updated_by,updated_by_name,updated_at
      ) values (
        v_id,v_account,v_employee,nullif(item->>'employee_name',''),item->>'preset_code',
        coalesce(item->'capabilities','{}'::jsonb),coalesce(item->'view_scope','{}'::jsonb),
        coalesce(item->'review_scope','{}'::jsonb),coalesce(item->'record_scope','{}'::jsonb),
        coalesce(item->'export_scope','{}'::jsonb),v_from,v_to,item->>'reason',v_active,
        p_actor_id,p_actor_name,p_actor_id,p_actor_name,now()
      ) returning * into v_saved;
    else
      update public.checklist_permission_grants set
        account_id=v_account,employee_code=v_employee,employee_name=nullif(item->>'employee_name',''),
        preset_code=item->>'preset_code',capabilities=coalesce(item->'capabilities','{}'::jsonb),
        view_scope=coalesce(item->'view_scope','{}'::jsonb),review_scope=coalesce(item->'review_scope','{}'::jsonb),
        record_scope=coalesce(item->'record_scope','{}'::jsonb),export_scope=coalesce(item->'export_scope','{}'::jsonb),
        effective_from=v_from,effective_to=v_to,reason=item->>'reason',is_active=v_active,
        updated_by=p_actor_id,updated_by_name=p_actor_name,updated_at=now()
      where id=v_before.id returning * into v_saved;
    end if;

    insert into public.checklist_permission_grant_history(
      grant_id,action,before_data,after_data,reason,changed_by,changed_by_name,changed_at
    ) values (
      v_saved.id,case when v_before.id is null then 'create' else 'update' end,
      case when v_before.id is null then '{}'::jsonb else to_jsonb(v_before) end,
      to_jsonb(v_saved),coalesce(item->>'reason',''),p_actor_id,p_actor_name,now()
    );

    v_results:=v_results||jsonb_build_array(to_jsonb(v_saved));
  end loop;

  return jsonb_build_object('ok',true,'grants',v_results);
end;
$$;

drop function if exists public.phf_disable_checklist_permission_grant(uuid,text,text,text);
create or replace function public.phf_disable_checklist_permission_grant(
  p_grant_id uuid,
  p_reason text,
  p_actor_id text default '',
  p_actor_name text default '',
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before public.checklist_permission_grants%rowtype;
  v_saved public.checklist_permission_grants%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('phf_permission_grants_global'));
  select * into v_before from public.checklist_permission_grants where id=p_grant_id for update;
  if not found then return jsonb_build_object('ok',false,'code','CHECKLIST_PERMISSION_NOT_FOUND','message','Phân quyền không còn tồn tại.'); end if;
  if p_expected_updated_at is null or v_before.updated_at is distinct from p_expected_updated_at then
    raise exception 'CHECKLIST_PERMISSION_STALE:%',p_grant_id;
  end if;

  update public.checklist_permission_grants set
    is_active=false,reason=trim(p_reason),updated_by=p_actor_id,updated_by_name=p_actor_name,updated_at=now()
  where id=p_grant_id returning * into v_saved;

  insert into public.checklist_permission_grant_history(
    grant_id,action,before_data,after_data,reason,changed_by,changed_by_name,changed_at
  ) values (
    p_grant_id,'disable',to_jsonb(v_before),to_jsonb(v_saved),trim(p_reason),p_actor_id,p_actor_name,now()
  );

  return jsonb_build_object('ok',true,'grant',to_jsonb(v_saved));
end;
$$;

-- Lưu/gửi tự đánh giá: khóa phiếu và kiểm tra lại ledger lỗi trong cùng transaction.
create or replace function public.phf_save_checklist_monthly_self(
  p_form_id uuid,
  p_patch jsonb,
  p_expected_updated_at timestamptz,
  p_expected_checklist_score numeric
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_form public.checklist_monthly_forms%rowtype;
  v_saved public.checklist_monthly_forms%rowtype;
  v_current_score numeric;
  v_status text;
begin
  select * into v_form from public.checklist_monthly_forms where id=p_form_id for update;
  if not found then return jsonb_build_object('ok',false,'code','CHECKLIST_MONTHLY_SELF_NOT_FOUND','message','Không tìm thấy phiếu tự đánh giá.'); end if;
  if v_form.status<>'waiting_self' then return jsonb_build_object('ok',false,'code','CHECKLIST_MONTHLY_NOT_WAITING_SELF','message','Phiếu không còn ở bước tự đánh giá.'); end if;
  if p_expected_updated_at is null or v_form.updated_at is distinct from p_expected_updated_at then
    raise exception 'CHECKLIST_MONTHLY_SELF_STALE:%',p_form_id;
  end if;

  select greatest(0,100-coalesce(sum(greatest(coalesce(v.points,0),0)),0)) into v_current_score
  from public.checklist_violation_records v
  where upper(v.employee_code)=upper(v_form.employee_code)
    and v.is_test=false and v.record_status='official'
    and v.occurred_date>=(v_form.period_month||'-01')::date
    and v.occurred_date<((v_form.period_month||'-01')::date+interval '1 month');
  if abs(v_current_score-coalesce(p_expected_checklist_score,-999999))>0.0001 then
    raise exception 'CHECKLIST_MONTHLY_SELF_SCORE_CHANGED:%:%',v_current_score,p_expected_checklist_score;
  end if;

  v_status:=case when p_patch ? 'status' then p_patch->>'status' else v_form.status end;
  if v_status not in ('waiting_self','waiting_review') then raise exception 'CHECKLIST_MONTHLY_SELF_STATUS_INVALID'; end if;

  update public.checklist_monthly_forms set
    self_answers=coalesce(p_patch->'self_answers',self_answers),
    self_note=case when p_patch ? 'self_note' then coalesce(p_patch->>'self_note','') else self_note end,
    checklist_score=v_current_score,
    self_total_score=case when p_patch ? 'self_total_score' then (p_patch->>'self_total_score')::numeric else self_total_score end,
    self_saved_at=case when p_patch ? 'self_saved_at' then nullif(p_patch->>'self_saved_at','')::timestamptz else self_saved_at end,
    self_submitted_at=case when p_patch ? 'self_submitted_at' then nullif(p_patch->>'self_submitted_at','')::timestamptz else self_submitted_at end,
    status=v_status,
    updated_at=coalesce(nullif(p_patch->>'updated_at','')::timestamptz,now())
  where id=p_form_id
  returning * into v_saved;
  return jsonb_build_object('ok',true,'form',to_jsonb(v_saved));
end;
$$;

-- Hoàn tất/lưu thẩm định: khóa phiếu, kiểm tra lại ledger lỗi ngay trong transaction.
create or replace function public.phf_save_checklist_monthly_review(
  p_form_id uuid,
  p_patch jsonb,
  p_expected_updated_at timestamptz,
  p_expected_checklist_score numeric
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_form public.checklist_monthly_forms%rowtype;
  v_saved public.checklist_monthly_forms%rowtype;
  v_current_score numeric;
  v_status text;
begin
  select * into v_form from public.checklist_monthly_forms where id=p_form_id for update;
  if not found then return jsonb_build_object('ok',false,'code','CHECKLIST_MONTHLY_REVIEW_NOT_FOUND','message','Không tìm thấy phiếu cần thẩm định.'); end if;
  if v_form.status<>'waiting_review' then return jsonb_build_object('ok',false,'code','CHECKLIST_MONTHLY_NOT_WAITING_REVIEW','message','Phiếu không còn ở bước chờ thẩm định.'); end if;
  if p_expected_updated_at is null or v_form.updated_at is distinct from p_expected_updated_at then
    raise exception 'CHECKLIST_MONTHLY_REVIEW_STALE:%',p_form_id;
  end if;

  select greatest(0,100-coalesce(sum(greatest(coalesce(v.points,0),0)),0)) into v_current_score
  from public.checklist_violation_records v
  where upper(v.employee_code)=upper(v_form.employee_code)
    and v.is_test=false and v.record_status='official'
    and v.occurred_date>=(v_form.period_month||'-01')::date
    and v.occurred_date<((v_form.period_month||'-01')::date+interval '1 month');
  if abs(v_current_score-coalesce(p_expected_checklist_score,-999999))>0.0001 then
    raise exception 'CHECKLIST_MONTHLY_REVIEW_SCORE_CHANGED:%:%',v_current_score,p_expected_checklist_score;
  end if;

  v_status:=case when p_patch ? 'status' then p_patch->>'status' else v_form.status end;
  if v_status not in ('waiting_review','reviewed','locked') then raise exception 'CHECKLIST_MONTHLY_REVIEW_STATUS_INVALID'; end if;

  update public.checklist_monthly_forms set
    review_answers=coalesce(p_patch->'review_answers',review_answers),
    review_note=case when p_patch ? 'review_note' then coalesce(p_patch->>'review_note','') else review_note end,
    checklist_score=v_current_score,
    checklist_review_score=case when p_patch ? 'checklist_review_score' then (p_patch->>'checklist_review_score')::numeric else checklist_review_score end,
    checklist_review_reason=case when p_patch ? 'checklist_review_reason' then coalesce(p_patch->>'checklist_review_reason','') else checklist_review_reason end,
    review_total_score=case when p_patch ? 'review_total_score' then (p_patch->>'review_total_score')::numeric else review_total_score end,
    review_saved_at=case when p_patch ? 'review_saved_at' then nullif(p_patch->>'review_saved_at','')::timestamptz else review_saved_at end,
    reviewed_by=case when p_patch ? 'reviewed_by' then coalesce(p_patch->>'reviewed_by','') else reviewed_by end,
    reviewed_by_code=case when p_patch ? 'reviewed_by_code' then coalesce(p_patch->>'reviewed_by_code','') else reviewed_by_code end,
    reviewed_by_name=case when p_patch ? 'reviewed_by_name' then coalesce(p_patch->>'reviewed_by_name','') else reviewed_by_name end,
    reviewed_as_override=case when p_patch ? 'reviewed_as_override' then (p_patch->>'reviewed_as_override')::boolean else reviewed_as_override end,
    review_override_reason=case when p_patch ? 'review_override_reason' then coalesce(p_patch->>'review_override_reason','') else review_override_reason end,
    review_submitted_at=case when p_patch ? 'review_submitted_at' then nullif(p_patch->>'review_submitted_at','')::timestamptz else review_submitted_at end,
    self_total_score=case when p_patch ? 'self_total_score' then (p_patch->>'self_total_score')::numeric else self_total_score end,
    final_score=case when p_patch ? 'final_score' then (p_patch->>'final_score')::numeric else final_score end,
    score_calculated_at=case when p_patch ? 'score_calculated_at' then nullif(p_patch->>'score_calculated_at','')::timestamptz else score_calculated_at end,
    admin_exception_open=case when p_patch ? 'admin_exception_open' then (p_patch->>'admin_exception_open')::boolean else admin_exception_open end,
    status=v_status,
    updated_at=coalesce(nullif(p_patch->>'updated_at','')::timestamptz,now())
  where id=p_form_id
  returning * into v_saved;
  return jsonb_build_object('ok',true,'form',to_jsonb(v_saved));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Chính sách + xử lý quá hạn: dữ liệu chính và history cùng transaction
-- ---------------------------------------------------------------------------
create or replace function public.phf_save_checklist_monthly_overdue_policy(
  p_policy jsonb,
  p_reason text,
  p_actor_id text,
  p_actor_code text,
  p_actor_name text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period text := trim(coalesce(p_policy->>'effectiveFromPeriod',''));
  v_before_text text;
  v_before jsonb := '{}'::jsonb;
  v_saved public.checklist_system_settings%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('phf_monthly_overdue_policy|'||v_period));
  if v_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'CHECKLIST_MONTHLY_POLICY_PERIOD_INVALID'; end if;
  if length(trim(coalesce(p_reason,''))) < 10 then raise exception 'CHECKLIST_MONTHLY_POLICY_REASON_REQUIRED'; end if;
  perform 1 from public.checklist_monthly_periods where period_month=v_period for update;
  if exists(select 1 from public.checklist_monthly_periods where period_month=v_period and status='locked') then
    raise exception 'CHECKLIST_MONTHLY_POLICY_PERIOD_LOCKED';
  end if;

  select setting_value into v_before_text
  from public.checklist_system_settings
  where setting_key='monthly_self_overdue_policy'
  for update;
  if found and coalesce(trim(v_before_text),'')<>'' then v_before:=v_before_text::jsonb; end if;

  insert into public.checklist_system_settings(setting_key,setting_value,description,updated_at,updated_by)
  values ('monthly_self_overdue_policy',p_policy::text,'Chính sách kỳ đánh giá, thời hạn xử lý và ngoại lệ sau khóa',now(),p_actor_name)
  on conflict(setting_key) do update set
    setting_value=excluded.setting_value,
    description=excluded.description,
    updated_at=excluded.updated_at,
    updated_by=excluded.updated_by
  returning * into v_saved;

  insert into public.checklist_monthly_policy_history(
    setting_key,before_data,after_data,reason,changed_by,changed_by_code,changed_by_name,changed_at
  ) values (
    'monthly_self_overdue_policy',v_before,p_policy,trim(p_reason),p_actor_id,p_actor_code,p_actor_name,now()
  );
  return jsonb_build_object('ok',true,'policy',p_policy,'updated_at',v_saved.updated_at);
end;
$$;

create or replace function public.phf_save_checklist_monthly_score_policy(
  p_effective_from_period text,
  p_self_weight numeric,
  p_review_weight numeric,
  p_reason text,
  p_actor_id text,
  p_actor_code text,
  p_actor_name text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before public.checklist_monthly_score_policies%rowtype;
  v_saved public.checklist_monthly_score_policies%rowtype;
  v_first_form text;
  v_snapshot jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('phf_monthly_score_policy|'||coalesce(p_effective_from_period,'')));
  if trim(coalesce(p_effective_from_period,'')) !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'CHECKLIST_MONTHLY_SCORE_PERIOD_INVALID'; end if;
  if coalesce(p_self_weight,0)+coalesce(p_review_weight,0)<=0 then raise exception 'CHECKLIST_MONTHLY_SCORE_WEIGHT_ZERO'; end if;
  if length(trim(coalesce(p_reason,'')))<10 then raise exception 'CHECKLIST_MONTHLY_SCORE_REASON_REQUIRED'; end if;
  perform 1 from public.checklist_monthly_periods where period_month=p_effective_from_period for update;
  if exists(select 1 from public.checklist_monthly_periods where period_month=p_effective_from_period and status='locked') then
    raise exception 'CHECKLIST_MONTHLY_SCORE_PERIOD_LOCKED';
  end if;
  select period_month into v_first_form from public.checklist_monthly_forms
  where period_month>=p_effective_from_period order by period_month limit 1;
  if found then raise exception 'CHECKLIST_MONTHLY_SCORE_FORMS_EXIST:%',v_first_form; end if;

  select * into v_before from public.checklist_monthly_score_policies
  where effective_from_period=p_effective_from_period for update;

  insert into public.checklist_monthly_score_policies(
    effective_from_period,self_weight,review_weight,reason,is_active,
    created_by,created_by_code,created_by_name,created_at,
    updated_by,updated_by_code,updated_by_name,updated_at
  ) values (
    p_effective_from_period,p_self_weight,p_review_weight,trim(p_reason),true,
    p_actor_id,p_actor_code,p_actor_name,now(),p_actor_id,p_actor_code,p_actor_name,now()
  ) on conflict(effective_from_period) do update set
    self_weight=excluded.self_weight,review_weight=excluded.review_weight,reason=excluded.reason,
    is_active=true,updated_by=excluded.updated_by,updated_by_code=excluded.updated_by_code,
    updated_by_name=excluded.updated_by_name,updated_at=excluded.updated_at
  returning * into v_saved;

  v_snapshot:=jsonb_build_object(
    'effectiveFromPeriod',p_effective_from_period,'selfWeight',p_self_weight,
    'reviewWeight',p_review_weight,'totalWeight',p_self_weight+p_review_weight,
    'formulaVersion','weighted_average_v1','reason',trim(p_reason),
    'updatedAt',v_saved.updated_at,'updatedBy',p_actor_name
  );
  update public.checklist_monthly_periods set score_policy_snapshot=v_snapshot
  where period_month=p_effective_from_period;

  insert into public.checklist_monthly_score_policy_history(
    policy_id,effective_from_period,before_data,after_data,reason,
    changed_by,changed_by_code,changed_by_name,changed_at
  ) values (
    v_saved.id,p_effective_from_period,
    case when v_before.id is null then '{}'::jsonb else to_jsonb(v_before) end,
    to_jsonb(v_saved),trim(p_reason),p_actor_id,p_actor_code,p_actor_name,now()
  );
  return jsonb_build_object('ok',true,'policy',to_jsonb(v_saved),'snapshot',v_snapshot);
end;
$$;

create or replace function public.phf_save_checklist_late_points_policy(
  p_effective_from_period text,
  p_levels jsonb,
  p_reason text,
  p_actor_id text,
  p_actor_code text,
  p_actor_name text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before public.checklist_late_point_policies%rowtype;
  v_saved public.checklist_late_point_policies%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('phf_late_policy|'||coalesce(p_effective_from_period,'')));
  if p_effective_from_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'CHECKLIST_LATE_POLICY_PERIOD_INVALID'; end if;
  if jsonb_typeof(p_levels)<>'array' then raise exception 'CHECKLIST_LATE_POLICY_LEVELS_INVALID'; end if;
  if length(trim(coalesce(p_reason,'')))<10 then raise exception 'CHECKLIST_LATE_POLICY_REASON_REQUIRED'; end if;
  perform 1 from public.checklist_monthly_periods where period_month=p_effective_from_period for update;
  if exists(select 1 from public.checklist_monthly_periods where period_month=p_effective_from_period and status='locked') then
    raise exception 'CHECKLIST_LATE_POLICY_PERIOD_LOCKED';
  end if;
  select * into v_before from public.checklist_late_point_policies where effective_from_period=p_effective_from_period for update;
  insert into public.checklist_late_point_policies(
    effective_from_period,levels,reason,is_active,created_by,created_by_code,created_by_name,created_at,
    updated_by,updated_by_code,updated_by_name,updated_at
  ) values (
    p_effective_from_period,p_levels,trim(p_reason),true,p_actor_id,p_actor_code,p_actor_name,now(),
    p_actor_id,p_actor_code,p_actor_name,now()
  ) on conflict(effective_from_period) do update set
    levels=excluded.levels,reason=excluded.reason,is_active=true,updated_by=excluded.updated_by,
    updated_by_code=excluded.updated_by_code,updated_by_name=excluded.updated_by_name,updated_at=excluded.updated_at
  returning * into v_saved;
  insert into public.checklist_late_point_policy_history(
    policy_id,effective_from_period,before_data,after_data,reason,changed_by,changed_by_code,changed_by_name,changed_at
  ) values (
    v_saved.id,p_effective_from_period,case when v_before.id is null then '{}'::jsonb else to_jsonb(v_before) end,
    to_jsonb(v_saved),trim(p_reason),p_actor_id,p_actor_code,p_actor_name,now()
  );
  return jsonb_build_object('ok',true,'policy',to_jsonb(v_saved));
end;
$$;

create or replace function public.phf_save_checklist_repeat_violation_policy(
  p_effective_from_period text,
  p_monthly_warning_count integer,
  p_training_occurrence_count integer,
  p_training_window_months integer,
  p_reason text,
  p_actor_id text,
  p_actor_code text,
  p_actor_name text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before public.checklist_repeat_violation_policies%rowtype;
  v_saved public.checklist_repeat_violation_policies%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('phf_repeat_policy|'||coalesce(p_effective_from_period,'')));
  if p_effective_from_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'CHECKLIST_REPEAT_POLICY_PERIOD_INVALID'; end if;
  if p_monthly_warning_count not between 2 and 20 or p_training_occurrence_count not between 2 and 50 or p_training_window_months not between 1 and 12 or p_training_occurrence_count<p_monthly_warning_count then
    raise exception 'CHECKLIST_REPEAT_POLICY_THRESHOLD_INVALID';
  end if;
  if length(trim(coalesce(p_reason,'')))<10 then raise exception 'CHECKLIST_REPEAT_POLICY_REASON_REQUIRED'; end if;
  perform 1 from public.checklist_monthly_periods where period_month=p_effective_from_period for update;
  if exists(select 1 from public.checklist_monthly_periods where period_month=p_effective_from_period and status='locked') then
    raise exception 'CHECKLIST_REPEAT_POLICY_PERIOD_LOCKED';
  end if;
  select * into v_before from public.checklist_repeat_violation_policies where effective_from_period=p_effective_from_period for update;
  insert into public.checklist_repeat_violation_policies(
    effective_from_period,monthly_warning_count,training_occurrence_count,training_window_months,
    reason,is_active,created_by,created_by_code,created_by_name,created_at,
    updated_by,updated_by_code,updated_by_name,updated_at
  ) values (
    p_effective_from_period,p_monthly_warning_count,p_training_occurrence_count,p_training_window_months,
    trim(p_reason),true,p_actor_id,p_actor_code,p_actor_name,now(),p_actor_id,p_actor_code,p_actor_name,now()
  ) on conflict(effective_from_period) do update set
    monthly_warning_count=excluded.monthly_warning_count,
    training_occurrence_count=excluded.training_occurrence_count,
    training_window_months=excluded.training_window_months,reason=excluded.reason,is_active=true,
    updated_by=excluded.updated_by,updated_by_code=excluded.updated_by_code,
    updated_by_name=excluded.updated_by_name,updated_at=excluded.updated_at
  returning * into v_saved;
  insert into public.checklist_repeat_violation_policy_history(
    policy_id,effective_from_period,before_data,after_data,reason,changed_by,changed_by_code,changed_by_name,changed_at
  ) values (
    v_saved.id,p_effective_from_period,case when v_before.id is null then '{}'::jsonb else to_jsonb(v_before) end,
    to_jsonb(v_saved),trim(p_reason),p_actor_id,p_actor_code,p_actor_name,now()
  );
  return jsonb_build_object('ok',true,'policy',to_jsonb(v_saved));
end;
$$;

create or replace function public.phf_apply_monthly_overdue_batch(
  p_period_month text,
  p_rows jsonb,
  p_reason text,
  p_actor_id text,
  p_actor_code text,
  p_actor_name text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  v_form public.checklist_monthly_forms%rowtype;
  v_expected timestamptz;
  v_stamp timestamptz;
  v_current_score numeric;
  v_expected_score numeric;
  v_processed integer:=0;
begin
  if p_period_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or jsonb_typeof(p_rows)<>'array' then raise exception 'CHECKLIST_MONTHLY_OVERDUE_PAYLOAD_INVALID'; end if;
  perform 1 from public.checklist_monthly_periods where period_month=p_period_month for update;
  if exists(select 1 from public.checklist_monthly_periods where period_month=p_period_month and status='locked') then
    raise exception 'CHECKLIST_MONTHLY_PERIOD_LOCKED';
  end if;
  for item in select value from jsonb_array_elements(p_rows)
  loop
    select * into v_form from public.checklist_monthly_forms
    where id=(item->>'form_id')::uuid for update;
    v_expected:=nullif(item->>'expected_updated_at','')::timestamptz;
    if not found or v_form.period_month<>p_period_month or v_form.status<>'waiting_self' or v_expected is null or v_form.updated_at is distinct from v_expected then
      raise exception 'CHECKLIST_MONTHLY_OVERDUE_STALE:%',coalesce(item->>'form_id','');
    end if;
    select greatest(0,100-coalesce(sum(greatest(coalesce(v.points,0),0)),0)) into v_current_score
    from public.checklist_violation_records v
    where upper(v.employee_code)=upper(v_form.employee_code)
      and v.is_test=false and v.record_status='official'
      and v.occurred_date>=(v_form.period_month||'-01')::date
      and v.occurred_date<((v_form.period_month||'-01')::date+interval '1 month');
    v_expected_score:=coalesce((item->>'checklist_score')::numeric,-999999);
    if abs(v_current_score-v_expected_score)>0.0001 then
      raise exception 'CHECKLIST_MONTHLY_OVERDUE_SCORE_CHANGED:%:%',v_current_score,v_expected_score;
    end if;
    v_stamp:=coalesce(nullif(item->>'self_submitted_at','')::timestamptz,now());
    update public.checklist_monthly_forms set
      self_answers=coalesce(item->'self_answers','{}'::jsonb),
      self_note=coalesce(item->>'self_note',''),
      checklist_score=coalesce((item->>'checklist_score')::numeric,0),
      self_total_score=coalesce((item->>'self_total_score')::numeric,0),
      self_saved_at=v_stamp,self_submitted_at=v_stamp,status='waiting_review',updated_at=v_stamp
    where id=v_form.id;
    insert into public.checklist_monthly_form_history(
      form_id,period_month,employee_code,action,before_data,after_data,reason,
      changed_by,changed_by_code,changed_by_name,changed_at
    ) values (
      v_form.id,p_period_month,v_form.employee_code,'apply_self_overdue_policy',
      jsonb_build_object('status',v_form.status,'selfTotalScore',v_form.self_total_score,'updatedAt',v_form.updated_at),
      coalesce(item->'after_data','{}'::jsonb),trim(p_reason),p_actor_id,p_actor_code,p_actor_name,v_stamp
    );
    v_processed:=v_processed+1;
  end loop;
  return jsonb_build_object('ok',true,'processed',v_processed);
end;
$$;

-- Health gate dùng cho /api/health và release smoke test.
create or replace function public.phf_checklist_production_health()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_missing text[] := array[]::text[];
  v_name text;
begin
  foreach v_name in array array[
    'phf_save_checklist_assignments','phf_save_checklist_template','phf_create_checklist_monthly','phf_save_checklist_monthly_self','phf_save_checklist_monthly_review',
    'phf_mutate_checklist_violation','phf_delete_checklist_test_violations',
    'phf_transition_checklist_task','phf_save_checklist_permission_grants',
    'phf_disable_checklist_permission_grant','phf_save_checklist_monthly_overdue_policy',
    'phf_save_checklist_monthly_score_policy','phf_save_checklist_late_points_policy',
    'phf_save_checklist_repeat_violation_policy','phf_apply_monthly_overdue_batch'
  ] loop
    if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=v_name) then
      v_missing:=array_append(v_missing,'function:'||v_name);
    end if;
  end loop;

  if to_regclass('public.checklist_employee_assignments') is null then v_missing:=array_append(v_missing,'table:checklist_employee_assignments'); end if;
  if to_regclass('public.checklist_templates') is null then v_missing:=array_append(v_missing,'table:checklist_templates'); end if;
  if to_regclass('public.checklist_violation_records') is null then v_missing:=array_append(v_missing,'table:checklist_violation_records'); end if;
  if to_regclass('public.checklist_monthly_forms') is null then v_missing:=array_append(v_missing,'table:checklist_monthly_forms'); end if;
  if not exists(select 1 from pg_trigger where tgname='trg_phf_guard_violation_finalized_period' and not tgisinternal) then v_missing:=array_append(v_missing,'trigger:trg_phf_guard_violation_finalized_period'); end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='uq_checklist_violation_active_fingerprint') then v_missing:=array_append(v_missing,'index:uq_checklist_violation_active_fingerprint'); end if;
  if exists(
    select 1
    from public.checklist_permission_grants a
    join public.checklist_permission_grants b on a.id<b.id and a.is_active=true and b.is_active=true
      and ((a.account_id is not null and a.account_id=b.account_id) or (a.employee_code is not null and b.employee_code is not null and upper(a.employee_code)=upper(b.employee_code)))
      and daterange(a.effective_from,coalesce(a.effective_to,'infinity'::date),'[]') && daterange(b.effective_from,coalesce(b.effective_to,'infinity'::date),'[]')
  ) then v_missing:=array_append(v_missing,'data:checklist_permission_overlap'); end if;

  return jsonb_build_object('ok',coalesce(array_length(v_missing,1),0)=0,'missing',to_jsonb(v_missing));
end;
$$;

-- Chỉ service_role được gọi mutation RPC.
revoke all on function public.phf_save_checklist_assignments(jsonb,text,text) from public,anon,authenticated;
revoke all on function public.phf_save_checklist_template(jsonb,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.phf_create_checklist_monthly(text,jsonb,jsonb,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.phf_save_checklist_monthly_self(uuid,jsonb,timestamptz,numeric) from public,anon,authenticated;
revoke all on function public.phf_save_checklist_monthly_review(uuid,jsonb,timestamptz,numeric) from public,anon,authenticated;
revoke all on function public.phf_mutate_checklist_violation(uuid,text,jsonb,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.phf_delete_checklist_test_violations(text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.phf_transition_checklist_task(uuid,text,text,text,text,text,text,text,integer,timestamptz) from public,anon,authenticated;
revoke all on function public.phf_save_checklist_permission_grants(jsonb,text,text) from public,anon,authenticated;
revoke all on function public.phf_disable_checklist_permission_grant(uuid,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.phf_save_checklist_monthly_overdue_policy(jsonb,text,text,text,text) from public,anon,authenticated;
revoke all on function public.phf_save_checklist_monthly_score_policy(text,numeric,numeric,text,text,text,text) from public,anon,authenticated;
revoke all on function public.phf_save_checklist_late_points_policy(text,jsonb,text,text,text,text) from public,anon,authenticated;
revoke all on function public.phf_save_checklist_repeat_violation_policy(text,integer,integer,integer,text,text,text,text) from public,anon,authenticated;
revoke all on function public.phf_apply_monthly_overdue_batch(text,jsonb,text,text,text,text) from public,anon,authenticated;
revoke all on function public.phf_checklist_production_health() from public,anon,authenticated;

grant execute on function public.phf_save_checklist_assignments(jsonb,text,text) to service_role;
grant execute on function public.phf_save_checklist_template(jsonb,jsonb,text,text) to service_role;
grant execute on function public.phf_create_checklist_monthly(text,jsonb,jsonb,jsonb,text,text) to service_role;
grant execute on function public.phf_save_checklist_monthly_self(uuid,jsonb,timestamptz,numeric) to service_role;
grant execute on function public.phf_save_checklist_monthly_review(uuid,jsonb,timestamptz,numeric) to service_role;
grant execute on function public.phf_mutate_checklist_violation(uuid,text,jsonb,text,text,text,timestamptz) to service_role;
grant execute on function public.phf_delete_checklist_test_violations(text,text,text,text,text) to service_role;
grant execute on function public.phf_transition_checklist_task(uuid,text,text,text,text,text,text,text,integer,timestamptz) to service_role;
grant execute on function public.phf_save_checklist_permission_grants(jsonb,text,text) to service_role;
grant execute on function public.phf_disable_checklist_permission_grant(uuid,text,text,text,timestamptz) to service_role;
grant execute on function public.phf_save_checklist_monthly_overdue_policy(jsonb,text,text,text,text) to service_role;
grant execute on function public.phf_save_checklist_monthly_score_policy(text,numeric,numeric,text,text,text,text) to service_role;
grant execute on function public.phf_save_checklist_late_points_policy(text,jsonb,text,text,text,text) to service_role;
grant execute on function public.phf_save_checklist_repeat_violation_policy(text,integer,integer,integer,text,text,text,text) to service_role;
grant execute on function public.phf_apply_monthly_overdue_batch(text,jsonb,text,text,text,text) to service_role;
grant execute on function public.phf_checklist_production_health() to service_role;

commit;

-- ---------------------------------------------------------------------------
-- 8) Bắt buộc index chống trùng lỗi chính thức.
-- Phần này cố ý chạy sau COMMIT: nếu dữ liệu cũ đang trùng, các RPC ở trên vẫn
-- được cài nhưng SQL sẽ báo lỗi rõ để Admin xử lý dữ liệu trùng rồi chạy lại.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists(
    select 1
    from public.checklist_violation_records
    where duplicate_fingerprint is not null
      and record_status<>'cancelled'
    group by duplicate_fingerprint
    having count(*)>1
  ) then
    raise exception 'CHECKLIST_DUPLICATE_DATA_EXISTS: cần xử lý bản ghi trùng trước khi tạo unique index';
  end if;
end;
$$;

create unique index if not exists uq_checklist_violation_active_fingerprint
on public.checklist_violation_records(duplicate_fingerprint)
where duplicate_fingerprint is not null and record_status<>'cancelled';

-- Kiểm tra nhanh sau khi chạy.
select proname
from pg_proc
where proname in (
  'phf_save_checklist_assignments','phf_save_checklist_template','phf_create_checklist_monthly','phf_save_checklist_monthly_self','phf_save_checklist_monthly_review',
  'phf_mutate_checklist_violation','phf_delete_checklist_test_violations',
  'phf_transition_checklist_task','phf_save_checklist_permission_grants',
  'phf_disable_checklist_permission_grant','phf_save_checklist_monthly_overdue_policy',
  'phf_save_checklist_monthly_score_policy','phf_save_checklist_late_points_policy',
  'phf_save_checklist_repeat_violation_policy','phf_apply_monthly_overdue_batch'
)
order by proname;
