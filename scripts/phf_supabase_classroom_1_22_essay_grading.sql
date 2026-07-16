alter table public.classroom_tests
  add column if not exists test_type text not null default 'auto';
alter table public.classroom_tests drop constraint if exists classroom_tests_test_type_check;
alter table public.classroom_tests add constraint classroom_tests_test_type_check check (test_type in ('auto','mixed','essay'));

alter table public.classroom_test_assignments
  add column if not exists grader_employee_id text,
  add column if not exists grader_account_id text;

alter table public.classroom_test_attempts
  add column if not exists auto_score numeric not null default 0,
  add column if not exists manual_score numeric not null default 0,
  add column if not exists grading_status text not null default 'not_required',
  add column if not exists grader_employee_id text,
  add column if not exists grader_account_id text,
  add column if not exists grader_comment text,
  add column if not exists graded_at timestamptz;
alter table public.classroom_test_attempts drop constraint if exists classroom_test_attempts_grading_status_check;
alter table public.classroom_test_attempts add constraint classroom_test_attempts_grading_status_check check (grading_status in ('not_required','pending','grading','graded'));

create index if not exists classroom_test_attempts_grading_idx on public.classroom_test_attempts(grading_status);
create index if not exists classroom_test_assignments_grader_account_idx on public.classroom_test_assignments(grader_account_id);
