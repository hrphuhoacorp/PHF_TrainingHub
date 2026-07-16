-- PHF Classroom 1.17 - Bài học theo khóa và tiến độ học viên
create table if not exists public.classroom_lessons (
  id text primary key,
  class_id text not null references public.classroom_classes(id) on delete cascade,
  category text not null default 'Nội dung khóa học',
  title text not null,
  summary text not null default '',
  content_type text not null default 'text' check (content_type in ('text','link','video','file')),
  content_url text not null default '',
  content_text text not null default '',
  estimated_minutes integer not null default 0 check (estimated_minutes >= 0),
  sort_order integer not null,
  required boolean not null default true,
  status text not null default 'draft' check (status in ('draft','published','hidden')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists classroom_lessons_class_idx on public.classroom_lessons(class_id, sort_order);

create table if not exists public.classroom_lesson_progress (
  id text primary key,
  class_id text not null references public.classroom_classes(id) on delete cascade,
  lesson_id text not null references public.classroom_lessons(id) on delete cascade,
  enrollment_id text not null references public.classroom_enrollments(id) on delete cascade,
  employee_id text,
  account_id text,
  status text not null default 'not_started' check (status in ('not_started','in_progress','completed')),
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(lesson_id, enrollment_id),
  check (employee_id is not null or account_id is not null)
);
create index if not exists classroom_lesson_progress_class_idx on public.classroom_lesson_progress(class_id);
create index if not exists classroom_lesson_progress_enrollment_idx on public.classroom_lesson_progress(enrollment_id);
