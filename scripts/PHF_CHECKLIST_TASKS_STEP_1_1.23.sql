-- PHF Checklist 1.23 · Việc cần xử lý · Bước 1
-- Tạo nền dữ liệu, lịch sử và tự sinh việc khi một lỗi CHÍNH THỨC được tạo.

begin;

create table if not exists public.checklist_violation_tasks (
  id uuid primary key default gen_random_uuid(),
  violation_id uuid not null references public.checklist_violation_records(id) on delete restrict,
  employee_id text not null,
  employee_code text not null,
  employee_name text,
  created_by text,
  created_by_name text,
  current_assignee_id text,
  current_assignee_code text,
  current_assignee_type text not null default 'employee'
    check (current_assignee_type in ('employee','reviewer','admin','collaborator')),
  status text not null default 'waiting_employee'
    check (status in ('waiting_employee','waiting_reviewer','waiting_admin','completed','cancelled')),
  priority text not null default 'normal'
    check (priority in ('normal','high','urgent')),
  due_at timestamptz not null default (now() + interval '3 days'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (violation_id)
);

create index if not exists idx_checklist_tasks_assignee
  on public.checklist_violation_tasks(current_assignee_id, status, due_at);
create index if not exists idx_checklist_tasks_employee
  on public.checklist_violation_tasks(employee_code, status, due_at);
create index if not exists idx_checklist_tasks_creator
  on public.checklist_violation_tasks(created_by, status, due_at);

create table if not exists public.checklist_violation_task_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.checklist_violation_tasks(id) on delete restrict,
  violation_id uuid not null references public.checklist_violation_records(id) on delete restrict,
  action text not null,
  from_status text,
  to_status text,
  note text,
  actor_id text,
  actor_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_checklist_task_history_task
  on public.checklist_violation_task_history(task_id, created_at desc);

alter table public.checklist_violation_tasks enable row level security;
alter table public.checklist_violation_task_history enable row level security;
revoke all on table public.checklist_violation_tasks from anon, authenticated;
revoke all on table public.checklist_violation_task_history from anon, authenticated;

create or replace function public.phf_create_violation_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_test = false and new.record_status = 'official' then
    insert into public.checklist_violation_tasks (
      violation_id,
      employee_id,
      employee_code,
      employee_name,
      created_by,
      created_by_name,
      current_assignee_id,
      current_assignee_code,
      current_assignee_type,
      status,
      priority,
      due_at
    ) values (
      new.id,
      new.employee_id,
      new.employee_code,
      new.employee_name,
      new.created_by,
      new.created_by_name,
      new.employee_id,
      new.employee_code,
      'employee',
      'waiting_employee',
      'normal',
      coalesce(new.created_at, now()) + interval '3 days'
    )
    on conflict (violation_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_phf_create_violation_task
  on public.checklist_violation_records;
create trigger trg_phf_create_violation_task
after insert on public.checklist_violation_records
for each row execute function public.phf_create_violation_task();

-- Bù các lỗi chính thức đã có trước khi cài bước 1.
insert into public.checklist_violation_tasks (
  violation_id, employee_id, employee_code, employee_name,
  created_by, created_by_name,
  current_assignee_id, current_assignee_code,
  current_assignee_type, status, priority, due_at, created_at, updated_at
)
select
  r.id, r.employee_id, r.employee_code, r.employee_name,
  r.created_by, r.created_by_name,
  r.employee_id, r.employee_code,
  'employee', 'waiting_employee', 'normal',
  coalesce(r.created_at, now()) + interval '3 days',
  coalesce(r.created_at, now()), now()
from public.checklist_violation_records r
where r.is_test = false
  and r.record_status = 'official'
on conflict (violation_id) do nothing;

commit;

select status, count(*) as so_viec
from public.checklist_violation_tasks
group by status
order by status;
