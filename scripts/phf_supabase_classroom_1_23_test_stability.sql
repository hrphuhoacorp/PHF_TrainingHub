-- PHF Classroom 1.23: ổn định lượt giao, thời lượng và trộn đề
alter table public.classroom_test_attempts
  add column if not exists question_order jsonb not null default '[]'::jsonb,
  add column if not exists option_orders jsonb not null default '{}'::jsonb,
  add column if not exists expires_at timestamptz;

alter table public.classroom_test_attempts alter column submitted_at drop not null;

create index if not exists classroom_test_attempts_active_idx
  on public.classroom_test_attempts(assignment_id, employee_id, account_id, status);
create index if not exists classroom_test_attempts_expires_idx
  on public.classroom_test_attempts(expires_at);
