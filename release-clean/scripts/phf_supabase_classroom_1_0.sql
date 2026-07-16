-- PHF Classroom 1.0 - nền dữ liệu lớp đào tạo
create table if not exists public.classroom_classes (
  id text primary key,
  class_code text not null unique,
  class_name text not null,
  class_type text not null check (class_type in ('single','multi')),
  delivery_mode text not null check (delivery_mode in ('offline','online','hybrid')),
  training_purpose text not null,
  description text not null default '',
  department_id text,
  position_id text,
  branch_id text,
  start_at timestamptz,
  end_at timestamptz,
  registration_deadline timestamptz,
  capacity integer check (capacity is null or capacity > 0),
  status text not null default 'draft' check (status in ('draft','published','in_progress','completed','cancelled')),
  completion_rule text not null default 'manual_confirmation',
  minimum_attendance_rate numeric(5,2) not null default 0,
  minimum_score numeric(5,2) not null default 0,
  created_by text not null,
  created_by_email text,
  published_by text,
  published_at timestamptz,
  cancelled_by text,
  cancelled_at timestamptz,
  cancel_reason text,
  is_archived boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists classroom_classes_status_idx on public.classroom_classes(status);
create index if not exists classroom_classes_start_idx on public.classroom_classes(start_at);

create table if not exists public.classroom_sessions (
  id text primary key,
  class_id text not null references public.classroom_classes(id) on delete cascade,
  session_number integer not null,
  session_name text not null,
  session_date date,
  start_time time,
  end_time time,
  delivery_mode text not null check (delivery_mode in ('offline','online','hybrid')),
  location text not null default '',
  content_summary text not null default '',
  attendance_required boolean not null default true,
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(class_id, session_number)
);
create index if not exists classroom_sessions_class_idx on public.classroom_sessions(class_id);

create table if not exists public.classroom_enrollments (
  id text primary key,
  class_id text not null references public.classroom_classes(id) on delete cascade,
  employee_id text,
  account_id text,
  status text not null default 'enrolled' check (status in ('invited','enrolled','in_progress','completed','failed','withdrawn','cancelled')),
  required boolean not null default true,
  enrollment_source text not null default 'admin',
  department_snapshot text not null default '',
  position_snapshot text not null default '',
  branch_snapshot text not null default '',
  enrolled_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (employee_id is not null or account_id is not null)
);
create unique index if not exists classroom_enrollments_unique_person on public.classroom_enrollments(class_id, coalesce(employee_id,''), coalesce(account_id,''));
create index if not exists classroom_enrollments_employee_idx on public.classroom_enrollments(employee_id);
create index if not exists classroom_enrollments_account_idx on public.classroom_enrollments(account_id);

create table if not exists public.classroom_assignments (
  id text primary key,
  class_id text not null references public.classroom_classes(id) on delete cascade,
  session_id text references public.classroom_sessions(id) on delete cascade,
  employee_id text,
  account_id text,
  assignment_role text not null check (assignment_role in ('owner','coordinator','instructor','attendance_officer','grader','observer')),
  status text not null default 'active',
  assigned_by text not null,
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (employee_id is not null or account_id is not null)
);
create index if not exists classroom_assignments_class_idx on public.classroom_assignments(class_id);

create table if not exists public.classroom_class_history (
  id text primary key,
  class_id text not null references public.classroom_classes(id) on delete cascade,
  action text not null,
  old_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  performed_by text not null,
  performed_at timestamptz not null default now()
);
create index if not exists classroom_history_class_idx on public.classroom_class_history(class_id, performed_at desc);
