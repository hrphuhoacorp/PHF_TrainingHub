create table if not exists public.classroom_training_proposals (
  id text primary key,
  title text not null,
  reason text not null,
  target_audience text not null,
  expected_outcome text not null,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  target_scope text not null default 'self' check (target_scope in ('self','department','people','company')),
  target_details jsonb not null default '{}'::jsonb,
  note text not null default '',
  status text not null default 'draft' check (status in ('draft','pending','needs_revision','approved','rejected','converted','completed')),
  admin_comment text not null default '',
  created_by text not null,
  created_by_employee_id text,
  submitted_at timestamptz,
  reviewed_by text,
  reviewed_at timestamptz,
  class_id text references public.classroom_classes(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists classroom_training_proposals_status_idx on public.classroom_training_proposals(status, updated_at desc);
create index if not exists classroom_training_proposals_creator_idx on public.classroom_training_proposals(created_by, created_by_employee_id);
