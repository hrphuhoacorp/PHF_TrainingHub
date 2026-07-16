create table if not exists public.classroom_notifications (
  id text primary key,
  title text not null,
  content text not null,
  level text not null default 'normal' check (level in ('normal','important','urgent')),
  scope_type text not null default 'selected',
  scope_value text,
  link text,
  status text not null default 'draft' check (status in ('draft','sent','hidden')),
  start_at timestamptz,
  end_at timestamptz,
  created_by text,
  recipient_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  hidden_at timestamptz
);
create table if not exists public.classroom_notification_recipients (
  id text primary key,
  notification_id text not null references public.classroom_notifications(id) on delete cascade,
  recipient_key text not null,
  employee_id text,
  account_id text,
  recipient_name text,
  recipient_code text,
  recipient_department text,
  recipient_position text,
  recipient_branch text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(notification_id,recipient_key)
);
create index if not exists idx_classroom_notify_status on public.classroom_notifications(status,sent_at desc);
create index if not exists idx_classroom_notify_recipient on public.classroom_notification_recipients(recipient_key,read_at);
