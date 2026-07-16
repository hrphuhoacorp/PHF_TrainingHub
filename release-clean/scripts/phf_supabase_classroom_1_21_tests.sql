create table if not exists public.classroom_tests (
  id text primary key,
  title text not null,
  description text,
  status text not null default 'draft' check (status in ('draft','published','hidden')),
  pass_score numeric not null default 80 check (pass_score between 0 and 100),
  duration_minutes integer not null default 0 check (duration_minutes >= 0),
  max_attempts integer not null default 1 check (max_attempts > 0),
  shuffle_questions boolean not null default true,
  shuffle_options boolean not null default true,
  questions jsonb not null default '[]'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.classroom_test_assignments (
  id text primary key,
  test_id text not null references public.classroom_tests(id) on delete cascade,
  class_id text references public.classroom_classes(id) on delete set null,
  session_id text references public.classroom_sessions(id) on delete set null,
  scope_type text not null default 'independent' check (scope_type in ('class','independent')),
  assignment_type text not null default 'independent' check (assignment_type in ('session','final','independent')),
  required boolean not null default true,
  status text not null default 'draft' check (status in ('draft','published','closed')),
  open_at timestamptz,
  close_at timestamptz,
  employee_ids jsonb not null default '[]'::jsonb,
  account_ids jsonb not null default '[]'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.classroom_test_attempts (
  id text primary key,
  test_id text not null references public.classroom_tests(id) on delete cascade,
  assignment_id text not null references public.classroom_test_assignments(id) on delete cascade,
  employee_id text,
  account_id text,
  score numeric not null default 0,
  passed boolean not null default false,
  status text not null default 'submitted',
  answers jsonb not null default '[]'::jsonb,
  started_at timestamptz,
  submitted_at timestamptz not null default now()
);
create index if not exists classroom_tests_status_idx on public.classroom_tests(status);
create index if not exists classroom_test_assignments_test_idx on public.classroom_test_assignments(test_id);
create index if not exists classroom_test_assignments_class_idx on public.classroom_test_assignments(class_id);
create index if not exists classroom_test_attempts_assignment_idx on public.classroom_test_attempts(assignment_id);
