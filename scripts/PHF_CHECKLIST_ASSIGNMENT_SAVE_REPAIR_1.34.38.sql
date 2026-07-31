-- PHF Checklist 1.34.38 · Repair lưu Nhân sự & phân công
-- Chạy 01 lần trên Supabase SQL Editor trước khi test lại Sửa nhanh.
-- Phạm vi: chỉ bổ sung cột tương thích còn thiếu và cài lại RPC lưu phân công theo baseline Production 1.33.1.

begin;

create extension if not exists pgcrypto;

create table if not exists public.checklist_employee_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_key text not null unique,
  employee_id text not null default '', employee_code text not null default '', employee_name text not null default '',
  department text not null default '', title text not null default '', branch text not null default '',
  manager_id text not null default '', manager_code text not null default '', manager_name text not null default '',
  employee_status text not null default 'Đang làm việc', leave_until date, status_note text not null default '',
  template_id text not null default '', template_version text not null default '', effective_date date not null default current_date,
  reason text not null default 'Đồng bộ cấu hình Checklist', updated_by text not null default '', updated_by_name text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.checklist_employee_assignment_history (
  id uuid primary key default gen_random_uuid(), employee_key text not null,
  employee_id text not null default '', employee_code text not null default '', employee_name text not null default '',
  department text not null default '', title text not null default '', branch text not null default '',
  manager_id text not null default '', manager_code text not null default '', manager_name text not null default '',
  employee_status text not null default 'Đang làm việc', leave_until date, status_note text not null default '',
  template_id text not null default '', template_version text not null default '', effective_date date not null default current_date,
  reason text not null default 'Đồng bộ cấu hình Checklist', changed_by text not null default '', changed_by_name text not null default '',
  previous_data jsonb, changed_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

alter table public.checklist_employee_assignments
  add column if not exists leave_until date,
  add column if not exists status_note text not null default '',
  add column if not exists updated_at timestamptz not null default now();

alter table public.checklist_employee_assignment_history
  add column if not exists leave_until date,
  add column if not exists status_note text not null default '',
  add column if not exists updated_at timestamptz not null default now();

update public.checklist_employee_assignments set updated_at=now() where updated_at is null;
update public.checklist_employee_assignment_history set updated_at=coalesce(changed_at,now()) where updated_at is null;

create unique index if not exists checklist_employee_assignments_employee_key_uidx
  on public.checklist_employee_assignments(employee_key);
create index if not exists checklist_assignment_history_employee_idx
  on public.checklist_employee_assignment_history(employee_key,changed_at desc);

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

revoke all on function public.phf_save_checklist_assignments(jsonb,text,text) from public,anon,authenticated;
grant execute on function public.phf_save_checklist_assignments(jsonb,text,text) to service_role;

commit;

-- Kiểm tra sau khi chạy:
-- select employee_key,employee_code,department,updated_at
-- from public.checklist_employee_assignments where employee_code='PHF012';
