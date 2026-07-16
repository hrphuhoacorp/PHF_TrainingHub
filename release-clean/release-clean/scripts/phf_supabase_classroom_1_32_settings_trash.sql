-- PHF Classroom 1.32 - Cấu hình & Thùng rác
create table if not exists public.classroom_settings (
  id text primary key,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);
create table if not exists public.classroom_system_audit (
  id text primary key,
  action text not null,
  entity_type text not null,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  actor_id text,
  actor_email text,
  created_at timestamptz not null default now()
);
create index if not exists classroom_system_audit_created_idx on public.classroom_system_audit(created_at desc);

do $$
declare t text;
begin
  foreach t in array array['classroom_classes','classroom_sessions','classroom_tests','classroom_materials','classroom_training_proposals','classroom_notifications']
  loop
    execute format('alter table public.%I add column if not exists deleted_at timestamptz',t);
    execute format('alter table public.%I add column if not exists deleted_by text',t);
    execute format('alter table public.%I add column if not exists delete_reason text',t);
    execute format('create index if not exists %I on public.%I(deleted_at)',t||'_deleted_idx',t);
  end loop;
end $$;
insert into public.classroom_settings(id,settings) values('default','{}'::jsonb) on conflict(id) do nothing;
