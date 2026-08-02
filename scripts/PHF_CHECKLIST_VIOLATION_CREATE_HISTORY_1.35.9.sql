begin;

-- Cho phép ghi nhận sự kiện tạo mới vào lịch sử.
do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.checklist_violation_record_history'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%action%';

  if constraint_name is not null then
    execute format('alter table public.checklist_violation_record_history drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.checklist_violation_record_history
  add constraint checklist_violation_record_history_action_check
  check (action in ('create','edit','cancel','delete_test','delete_test_batch'));

create or replace function public.phf_audit_checklist_violation_create()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.checklist_violation_record_history(
    record_id,
    employee_code,
    action,
    before_data,
    after_data,
    reason,
    changed_by,
    changed_by_name,
    changed_at
  ) values (
    new.id,
    coalesce(new.employee_code, ''),
    'create',
    '{}'::jsonb,
    to_jsonb(new),
    'Tạo bản ghi lỗi',
    coalesce(new.created_by, ''),
    coalesce(new.created_by_name, ''),
    coalesce(new.created_at, now())
  );
  return new;
end;
$$;

drop trigger if exists trg_phf_audit_checklist_violation_create
  on public.checklist_violation_records;

create trigger trg_phf_audit_checklist_violation_create
after insert on public.checklist_violation_records
for each row execute function public.phf_audit_checklist_violation_create();

commit;
