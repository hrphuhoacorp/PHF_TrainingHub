-- PHF Classroom 1.8 - Điểm danh theo từng buổi học
create table if not exists public.classroom_attendance (
  id text primary key,
  class_id text not null references public.classroom_classes(id) on delete cascade,
  session_id text not null references public.classroom_sessions(id) on delete cascade,
  enrollment_id text not null references public.classroom_enrollments(id) on delete cascade,
  employee_id text,
  account_id text,
  status text not null default 'unmarked' check (status in ('unmarked','present','late','excused','absent')),
  note text not null default '',
  checked_by text,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id, enrollment_id),
  check (employee_id is not null or account_id is not null)
);
create index if not exists classroom_attendance_session_idx on public.classroom_attendance(session_id);
create index if not exists classroom_attendance_employee_idx on public.classroom_attendance(employee_id);
create index if not exists classroom_attendance_account_idx on public.classroom_attendance(account_id);
