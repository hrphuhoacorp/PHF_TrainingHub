begin;

-- PHF Task Foundation Correction 1.68.0 (LOCAL CANDIDATE — DO NOT APPLY TO PRODUCTION).
-- Run after PHF_TASK_FOUNDATION_1.66.0.sql, PHF_TASK_PERMISSIONS_1.66.1.sql
-- and PHF_TASK_CORE_RPC_1.67.0.sql on a LOCAL/DEV database only.
--
-- Authority model:
--   authenticated account.role=admin -> system Admin, no employee row required;
--   non-admin -> task_permission_assignments preset, default NHAN_VIEN;
--   task_permission_grants remains the exception layer.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) Dual actor identity for Task writes and audit.
-- ---------------------------------------------------------------------------
alter table public.task_categories add column if not exists created_by_account_id text;
alter table public.task_categories add column if not exists created_by_employee_code text;
alter table public.task_categories add column if not exists updated_by_account_id text;
alter table public.task_categories add column if not exists updated_by_employee_code text;

alter table public.task_tasks add column if not exists created_by_account_id text;
alter table public.task_tasks alter column created_by_employee_code drop not null;
alter table public.task_tasks drop constraint if exists task_tasks_created_by_ck;
alter table public.task_tasks add constraint task_tasks_created_by_ck check (
  nullif(trim(created_by_account_id), '') is not null or
  nullif(trim(created_by_employee_code), '') is not null
);
create index if not exists task_tasks_created_by_account_idx on public.task_tasks(created_by_account_id) where created_by_account_id is not null;

alter table public.task_assignees add column if not exists assigned_by_account_id text;
alter table public.task_assignees alter column assigned_by_employee_code drop not null;
alter table public.task_assignees drop constraint if exists task_assignees_assigned_by_ck;
alter table public.task_assignees add constraint task_assignees_assigned_by_ck check (
  nullif(trim(assigned_by_account_id), '') is not null or
  nullif(trim(assigned_by_employee_code), '') is not null
);

alter table public.task_events add column if not exists actor_account_id text;
alter table public.task_events alter column actor_employee_code drop not null;
alter table public.task_events drop constraint if exists task_events_actor_ck;
alter table public.task_events add constraint task_events_actor_ck check (
  nullif(trim(actor_account_id), '') is not null or
  nullif(trim(actor_employee_code), '') is not null
);
create index if not exists task_events_actor_account_idx on public.task_events(actor_account_id) where actor_account_id is not null;

alter table public.task_comments add column if not exists author_account_id text;
alter table public.task_comments alter column author_employee_code drop not null;
alter table public.task_comments drop constraint if exists task_comments_author_ck;
alter table public.task_comments add constraint task_comments_author_ck check (
  nullif(trim(author_account_id), '') is not null or
  nullif(trim(author_employee_code), '') is not null
);

alter table public.task_links add column if not exists added_by_account_id text;
alter table public.task_links alter column added_by_employee_code drop not null;
alter table public.task_links drop constraint if exists task_links_added_by_ck;
alter table public.task_links add constraint task_links_added_by_ck check (
  nullif(trim(added_by_account_id), '') is not null or
  nullif(trim(added_by_employee_code), '') is not null
);

alter table public.task_permission_grants add column if not exists created_by_account_id text;
alter table public.task_permission_grants add column if not exists updated_by_account_id text;
alter table public.task_permission_grants alter column created_by_employee_code drop not null;
alter table public.task_permission_grants drop constraint if exists task_permission_created_by_ck;
alter table public.task_permission_grants add constraint task_permission_created_by_ck check (
  nullif(trim(created_by_account_id), '') is not null or
  nullif(trim(created_by_employee_code), '') is not null
);

alter table public.task_permission_grant_history add column if not exists changed_by_account_id text;
alter table public.task_permission_grant_history alter column changed_by_employee_code drop not null;
alter table public.task_permission_grant_history drop constraint if exists task_permission_history_changed_by_ck;
alter table public.task_permission_grant_history add constraint task_permission_history_changed_by_ck check (
  nullif(trim(changed_by_account_id), '') is not null or
  nullif(trim(changed_by_employee_code), '') is not null
);

-- Existing employee-only RPC signatures stay stable. This trigger normalizes
-- their legacy actor parameter before constraints run: an Admin account id is
-- moved out of the employee column; an employee write also receives its linked
-- account id when one exists. Persisted rows therefore never use a sentinel.
create or replace function public.task_normalize_actor_identity() returns trigger as $$
declare
  v_employee_column text := tg_argv[0];
  v_account_column text := tg_argv[1];
  v_employee_value text;
  v_account_value text;
  v_linked_account_id text;
begin
  v_employee_value := nullif(trim(to_jsonb(new)->>v_employee_column), '');
  v_account_value := nullif(trim(to_jsonb(new)->>v_account_column), '');

  if v_account_value is null and v_employee_value is not null then
    select ua.id into v_linked_account_id
    from public.user_accounts ua
    where ua.id = v_employee_value and lower(trim(ua.role)) = 'admin'
    limit 1;

    if v_linked_account_id is not null then
      v_account_value := v_linked_account_id;
      v_employee_value := null;
    else
      select ua.id into v_account_value
      from public.user_accounts ua
      where upper(trim(ua.employee_code)) = upper(v_employee_value)
      order by case when ua.status = 'active' then 0 else 1 end, ua.updated_at desc
      limit 1;
    end if;
  end if;

  new := jsonb_populate_record(new, jsonb_build_object(
    v_employee_column, v_employee_value,
    v_account_column, v_account_value
  ));
  return new;
end;
$$ language plpgsql;

drop trigger if exists task_tasks_normalize_creator on public.task_tasks;
create trigger task_tasks_normalize_creator before insert on public.task_tasks
  for each row execute function public.task_normalize_actor_identity('created_by_employee_code', 'created_by_account_id');
drop trigger if exists task_assignees_normalize_assigner on public.task_assignees;
create trigger task_assignees_normalize_assigner before insert on public.task_assignees
  for each row execute function public.task_normalize_actor_identity('assigned_by_employee_code', 'assigned_by_account_id');
drop trigger if exists task_events_normalize_actor on public.task_events;
create trigger task_events_normalize_actor before insert on public.task_events
  for each row execute function public.task_normalize_actor_identity('actor_employee_code', 'actor_account_id');
drop trigger if exists task_comments_normalize_author on public.task_comments;
create trigger task_comments_normalize_author before insert on public.task_comments
  for each row execute function public.task_normalize_actor_identity('author_employee_code', 'author_account_id');
drop trigger if exists task_links_normalize_adder on public.task_links;
create trigger task_links_normalize_adder before insert on public.task_links
  for each row execute function public.task_normalize_actor_identity('added_by_employee_code', 'added_by_account_id');

-- ---------------------------------------------------------------------------
-- 2) Canonical base Task preset assignment, separate from exceptions.
-- ---------------------------------------------------------------------------
create table if not exists public.task_permission_assignments (
  id uuid primary key default gen_random_uuid(),
  account_id text,
  employee_code text,
  preset_code text not null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  is_active boolean not null default true,
  reason text not null,
  assigned_by_account_id text,
  assigned_by_employee_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_permission_assignment_identity_ck check (
    nullif(trim(account_id), '') is not null or nullif(trim(employee_code), '') is not null
  ),
  constraint task_permission_assignment_preset_ck check (
    preset_code in ('GIAM_DOC', 'TRO_LY_GD', 'TRUONG_BO_PHAN', 'TRUONG_CA', 'NHAN_VIEN')
  ),
  constraint task_permission_assignment_window_ck check (effective_to is null or effective_to >= effective_from),
  constraint task_permission_assignment_reason_ck check (nullif(trim(reason), '') is not null),
  constraint task_permission_assignment_actor_ck check (
    nullif(trim(assigned_by_account_id), '') is not null or
    nullif(trim(assigned_by_employee_code), '') is not null
  )
);

create unique index if not exists task_permission_assignment_active_account_uq
  on public.task_permission_assignments(account_id) where is_active = true and account_id is not null;
create unique index if not exists task_permission_assignment_active_employee_uq
  on public.task_permission_assignments(employee_code) where is_active = true and employee_code is not null;
create index if not exists task_permission_assignment_window_idx
  on public.task_permission_assignments(is_active, effective_from, effective_to);

create table if not exists public.task_permission_assignment_history (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.task_permission_assignments(id) on delete restrict,
  action text not null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  reason text not null,
  changed_by_account_id text,
  changed_by_employee_code text,
  changed_at timestamptz not null default now(),
  constraint task_permission_assignment_history_action_ck check (action in ('assign', 'deactivate')),
  constraint task_permission_assignment_history_reason_ck check (nullif(trim(reason), '') is not null),
  constraint task_permission_assignment_history_actor_ck check (
    nullif(trim(changed_by_account_id), '') is not null or
    nullif(trim(changed_by_employee_code), '') is not null
  )
);

create index if not exists task_permission_assignment_history_assignment_idx
  on public.task_permission_assignment_history(assignment_id, changed_at desc);

drop trigger if exists task_permission_assignment_history_forbid_update on public.task_permission_assignment_history;
create trigger task_permission_assignment_history_forbid_update before update on public.task_permission_assignment_history
  for each row execute function public.task_forbid_update_delete();
drop trigger if exists task_permission_assignment_history_forbid_delete on public.task_permission_assignment_history;
create trigger task_permission_assignment_history_forbid_delete before delete on public.task_permission_assignment_history
  for each row execute function public.task_forbid_update_delete();

alter table public.task_permission_assignments enable row level security;
alter table public.task_permission_assignment_history enable row level security;
revoke all on public.task_permission_assignments from anon, authenticated;
revoke all on public.task_permission_assignment_history from anon, authenticated;

create or replace function public.task_set_permission_assignment(
  p_target_account_id text,
  p_target_employee_code text,
  p_preset_code text,
  p_reason text,
  p_actor_account_id text,
  p_actor_employee_code text
) returns public.task_permission_assignments as $$
declare
  v_previous public.task_permission_assignments;
  v_assignment public.task_permission_assignments;
  v_now timestamptz := now();
begin
  if nullif(trim(coalesce(p_target_account_id, '')), '') is null and
     nullif(trim(coalesce(p_target_employee_code, '')), '') is null then
    raise exception 'TASK_PERMISSION_ASSIGNMENT_TARGET_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_preset_code, '')), '') is null or
     upper(trim(p_preset_code)) not in ('GIAM_DOC', 'TRO_LY_GD', 'TRUONG_BO_PHAN', 'TRUONG_CA', 'NHAN_VIEN') then
    raise exception 'TASK_PERMISSION_PRESET_INVALID';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'TASK_PERMISSION_REASON_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_actor_account_id, '')), '') is null and
     nullif(trim(coalesce(p_actor_employee_code, '')), '') is null then
    raise exception 'TASK_PERMISSION_ACTOR_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'task-base-preset|' || coalesce(nullif(trim(p_target_account_id), ''), '') || '|' || upper(coalesce(nullif(trim(p_target_employee_code), ''), '')), 0
  ));

  for v_previous in
    update public.task_permission_assignments
    set is_active = false, effective_to = v_now, updated_at = v_now
    where is_active = true and (
      (nullif(trim(coalesce(p_target_account_id, '')), '') is not null and account_id = trim(p_target_account_id)) or
      (nullif(trim(coalesce(p_target_employee_code, '')), '') is not null and upper(employee_code) = upper(trim(p_target_employee_code)))
    )
    returning *
  loop
    insert into public.task_permission_assignment_history(
      assignment_id, action, before_data, after_data, reason,
      changed_by_account_id, changed_by_employee_code
    ) values (
      v_previous.id, 'deactivate', to_jsonb(v_previous),
      jsonb_build_object('is_active', false, 'effective_to', v_now), trim(p_reason),
      nullif(trim(coalesce(p_actor_account_id, '')), ''),
      nullif(upper(trim(coalesce(p_actor_employee_code, ''))), '')
    );
  end loop;

  insert into public.task_permission_assignments(
    account_id, employee_code, preset_code, effective_from, effective_to,
    is_active, reason, assigned_by_account_id, assigned_by_employee_code
  ) values (
    nullif(trim(coalesce(p_target_account_id, '')), ''),
    nullif(upper(trim(coalesce(p_target_employee_code, ''))), ''),
    upper(trim(p_preset_code)), v_now, null, true, trim(p_reason),
    nullif(trim(coalesce(p_actor_account_id, '')), ''),
    nullif(upper(trim(coalesce(p_actor_employee_code, ''))), '')
  ) returning * into v_assignment;

  insert into public.task_permission_assignment_history(
    assignment_id, action, before_data, after_data, reason,
    changed_by_account_id, changed_by_employee_code
  ) values (
    v_assignment.id, 'assign', '{}'::jsonb, to_jsonb(v_assignment), trim(p_reason),
    nullif(trim(coalesce(p_actor_account_id, '')), ''),
    nullif(upper(trim(coalesce(p_actor_employee_code, ''))), '')
  );

  return v_assignment;
end;
$$ language plpgsql;

revoke execute on function public.task_set_permission_assignment(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.task_set_permission_assignment(text, text, text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3) Preserve link idempotency after Admin actor normalization.
-- ---------------------------------------------------------------------------
create or replace function public.task_add_link(
  p_task_id uuid,
  p_side text,
  p_url text,
  p_label text,
  p_actor_employee_code text
) returns public.task_links as $$
declare
  v_label text := nullif(trim(coalesce(p_label, '')), '');
  v_link public.task_links;
  v_event_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'task-link|' || p_task_id::text || '|' || p_side || '|' || trim(p_url)
      || '|' || coalesce(v_label, '') || '|' || p_actor_employee_code, 0
  ));

  select l.* into v_link
  from public.task_links l
  where l.task_id = p_task_id
    and l.side = p_side
    and trim(l.url) = trim(p_url)
    and coalesce(trim(l.label), '') = coalesce(v_label, '')
    and (l.added_by_employee_code = p_actor_employee_code or l.added_by_account_id = p_actor_employee_code)
    and not exists (
      select 1 from public.task_events removed
      where removed.task_id = p_task_id
        and removed.event_type = 'link'
        and removed.payload->>'action' = 'remove'
        and removed.payload->>'link_id' = l.id::text
    )
  order by l.created_at desc
  limit 1
  for update;

  if found then
    v_event_id := v_link.related_event_id;
    if v_event_id is null then
      select e.id into v_event_id
      from public.task_events e
      where e.task_id = p_task_id and e.event_type = 'link'
        and e.payload->>'action' = 'add' and e.payload->>'link_id' = v_link.id::text
      order by e.occurred_at asc limit 1;
    end if;
    if v_event_id is null then
      insert into public.task_events(task_id, event_type, actor_employee_code, payload)
      values (p_task_id, 'link', p_actor_employee_code, jsonb_build_object(
        'action', 'add', 'link_id', v_link.id, 'side', v_link.side,
        'url', v_link.url, 'recovered_missing_audit', true
      )) returning id into v_event_id;
    end if;
    if v_link.related_event_id is distinct from v_event_id then
      update public.task_links set related_event_id = v_event_id
      where id = v_link.id returning * into v_link;
    end if;
    return v_link;
  end if;

  insert into public.task_links(task_id, side, url, label, added_by_employee_code)
  values (p_task_id, p_side, trim(p_url), v_label, p_actor_employee_code)
  returning * into v_link;

  insert into public.task_events(task_id, event_type, actor_employee_code, payload)
  values (p_task_id, 'link', p_actor_employee_code, jsonb_build_object(
    'action', 'add', 'link_id', v_link.id, 'side', v_link.side, 'url', v_link.url
  )) returning id into v_event_id;

  update public.task_links set related_event_id = v_event_id
  where id = v_link.id returning * into v_link;
  return v_link;
end;
$$ language plpgsql;

revoke execute on function public.task_add_link(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.task_add_link(uuid, text, text, text, text)
  to service_role;

comment on table public.task_permission_assignments is
  'PHF Task canonical base preset assignment. Absence means NHAN_VIEN; Admin needs no row.';
comment on table public.task_permission_assignment_history is
  'Append-only audit for Task base preset assignment changes.';

commit;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('task_permission_assignments', 'task_permission_assignment_history')
order by table_name;
