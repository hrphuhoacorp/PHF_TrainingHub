-- PHF_TASK_FOUNDATION_CORRECTION_REPAIR_1.74.0.sql
-- Gate: PHF_TASK_SCHEMA_REPAIR_PRE_GO_LIVE_V1
--
-- WHY THIS FILE EXISTS
-- PHF_TASK_FOUNDATION_CORRECTION_1.68.0.sql was applied to this dev schema
-- only PARTIALLY at some earlier point (confirmed read-only this gate,
-- SELECT probes against the real Postgres schema — errors are genuine
-- Postgres 42703 "column does not exist", not PostgREST schema-cache
-- staleness):
--
--   APPLIED (confirmed live, untouched by this file):
--     - task_categories.{created_by_account_id,created_by_employee_code,
--       updated_by_account_id,updated_by_employee_code}
--     - task_permission_grants.{created_by_account_id,updated_by_account_id}
--     - task_permission_grant_history.changed_by_account_id
--     - public.task_permission_assignments (table + indexes)
--     - public.task_permission_assignment_history (table + index + its own
--       forbid-update/forbid-delete triggers)
--     - public.task_set_permission_assignment(...) RPC
--
--   NOT APPLIED (confirmed live, this file repairs exactly these):
--     - task_tasks.created_by_account_id (+ relaxed created_by_employee_code
--       NOT NULL + replaced check constraint + index)
--     - task_assignees.assigned_by_account_id (+ relaxed NOT NULL + constraint)
--     - task_events.actor_account_id (+ relaxed NOT NULL + constraint + index)
--     - task_comments.author_account_id (+ relaxed NOT NULL + constraint)
--       <- THIS is the exact column addTaskComment() needs; its absence is
--          the direct cause of the "Could not find the 'author_account_id'
--          column" failure discovered in the Permission Hardening gate.
--     - task_links.added_by_account_id (+ relaxed NOT NULL + constraint)
--     - public.task_normalize_actor_identity() function
--     - the 5 BEFORE INSERT normalize triggers on task_tasks/task_assignees/
--       task_events/task_comments/task_links
--
-- NOT included here (deliberately, see gate report OTHER_PARTIAL_MIGRATION_
-- GAPS / recommendation): the task_add_link() RPC replacement from section 3
-- of 1.68.0. The CURRENTLY DEPLOYED task_add_link is confirmed still working
-- (live-tested in the Permission Hardening gate) using the ORIGINAL
-- (pre-1.68) signature/body that never references added_by_account_id — so
-- it is not required to unblock LOCK 5 / comments, and replacing a live,
-- working RPC is a separate, slightly higher-risk change than adding
-- nullable columns + triggers. Offered as an OPTIONAL follow-up, not bundled
-- into this minimal repair.
--
-- SAFETY
--   - Every ALTER TABLE ADD COLUMN uses IF NOT EXISTS — safe to re-run.
--   - Every DROP CONSTRAINT uses IF EXISTS — safe to re-run.
--   - ALTER COLUMN ... DROP NOT NULL is a no-op (no error) if already
--     nullable — safe to re-run regardless of current state.
--   - No existing row is touched. No backfill. New *_account_id columns
--     stay NULL for every historical row (their *_employee_code sibling is
--     already populated and satisfies the new check constraint) — exactly
--     the "keep it nullable, do not invent historical author values"
--     instruction. Zero data loss, zero data change.
--   - No DELETE, no data migration, no destructive statement anywhere.
--   - This is copy-verbatim (byte-identical SQL) from the untouched
--     PHF_TASK_FOUNDATION_CORRECTION_1.68.0.sql for exactly the objects
--     confirmed missing — not a rewrite, so there is no risk of this repair
--     silently drifting from the already-reviewed original design.
--
-- APPLY: DEV/local Supabase project only, via SQL Editor. Read PRECHECK_SQL
-- (gate report) first to confirm the same missing-object picture on your
-- own connection before running this.

begin;

-- ---------------------------------------------------------------------------
-- task_tasks.created_by_account_id
-- ---------------------------------------------------------------------------
alter table public.task_tasks add column if not exists created_by_account_id text;
alter table public.task_tasks alter column created_by_employee_code drop not null;
alter table public.task_tasks drop constraint if exists task_tasks_created_by_ck;
alter table public.task_tasks add constraint task_tasks_created_by_ck check (
  nullif(trim(created_by_account_id), '') is not null or
  nullif(trim(created_by_employee_code), '') is not null
);
create index if not exists task_tasks_created_by_account_idx on public.task_tasks(created_by_account_id) where created_by_account_id is not null;

-- ---------------------------------------------------------------------------
-- task_assignees.assigned_by_account_id
-- ---------------------------------------------------------------------------
alter table public.task_assignees add column if not exists assigned_by_account_id text;
alter table public.task_assignees alter column assigned_by_employee_code drop not null;
alter table public.task_assignees drop constraint if exists task_assignees_assigned_by_ck;
alter table public.task_assignees add constraint task_assignees_assigned_by_ck check (
  nullif(trim(assigned_by_account_id), '') is not null or
  nullif(trim(assigned_by_employee_code), '') is not null
);

-- ---------------------------------------------------------------------------
-- task_events.actor_account_id
-- ---------------------------------------------------------------------------
alter table public.task_events add column if not exists actor_account_id text;
alter table public.task_events alter column actor_employee_code drop not null;
alter table public.task_events drop constraint if exists task_events_actor_ck;
alter table public.task_events add constraint task_events_actor_ck check (
  nullif(trim(actor_account_id), '') is not null or
  nullif(trim(actor_employee_code), '') is not null
);
create index if not exists task_events_actor_account_idx on public.task_events(actor_account_id) where actor_account_id is not null;

-- ---------------------------------------------------------------------------
-- task_comments.author_account_id  <-- the reported blocker
-- ---------------------------------------------------------------------------
alter table public.task_comments add column if not exists author_account_id text;
alter table public.task_comments alter column author_employee_code drop not null;
alter table public.task_comments drop constraint if exists task_comments_author_ck;
alter table public.task_comments add constraint task_comments_author_ck check (
  nullif(trim(author_account_id), '') is not null or
  nullif(trim(author_employee_code), '') is not null
);

-- ---------------------------------------------------------------------------
-- task_links.added_by_account_id
-- ---------------------------------------------------------------------------
alter table public.task_links add column if not exists added_by_account_id text;
alter table public.task_links alter column added_by_employee_code drop not null;
alter table public.task_links drop constraint if exists task_links_added_by_ck;
alter table public.task_links add constraint task_links_added_by_ck check (
  nullif(trim(added_by_account_id), '') is not null or
  nullif(trim(added_by_employee_code), '') is not null
);

-- ---------------------------------------------------------------------------
-- Normalize trigger function + the 5 BEFORE INSERT triggers.
-- ---------------------------------------------------------------------------
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

commit;

-- POSTCHECK — see the gate report's POSTCHECK_SQL block for the full
-- standalone verification package (safe to paste separately, no error
-- expected from any of those SELECTs once this migration has committed).
