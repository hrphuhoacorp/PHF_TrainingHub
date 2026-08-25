-- PHF_TASK_FOUNDATION_CORRECTION_REPAIR_1.74.0_DOWN.sql
-- Rollback for PHF_TASK_FOUNDATION_CORRECTION_REPAIR_1.74.0.sql.
--
-- Safe to run: every object this removes was added by that migration and
-- nothing else. Drops triggers first (dependents), then the shared
-- function, then the constraints/indexes/columns. Existing *_employee_code
-- data is untouched; this only removes the *_account_id columns and their
-- support objects, restoring the exact pre-repair shape. NOT NULL is
-- restored on the employee_code columns since 1.74.0 relaxed it — this is
-- safe only if no row currently relies solely on *_account_id (true by
-- construction, since 1.74.0 never backfilled or wrote any *_account_id
-- value into historical rows).

begin;

drop trigger if exists task_tasks_normalize_creator on public.task_tasks;
drop trigger if exists task_assignees_normalize_assigner on public.task_assignees;
drop trigger if exists task_events_normalize_actor on public.task_events;
drop trigger if exists task_comments_normalize_author on public.task_comments;
drop trigger if exists task_links_normalize_adder on public.task_links;
drop function if exists public.task_normalize_actor_identity();

alter table public.task_tasks drop constraint if exists task_tasks_created_by_ck;
drop index if exists public.task_tasks_created_by_account_idx;
alter table public.task_tasks drop column if exists created_by_account_id;
alter table public.task_tasks alter column created_by_employee_code set not null;
alter table public.task_tasks add constraint task_tasks_created_by_ck check (nullif(trim(created_by_employee_code), '') is not null);

alter table public.task_assignees drop constraint if exists task_assignees_assigned_by_ck;
alter table public.task_assignees drop column if exists assigned_by_account_id;
alter table public.task_assignees alter column assigned_by_employee_code set not null;
alter table public.task_assignees add constraint task_assignees_assigned_by_ck check (nullif(trim(assigned_by_employee_code), '') is not null);

alter table public.task_events drop constraint if exists task_events_actor_ck;
drop index if exists public.task_events_actor_account_idx;
alter table public.task_events drop column if exists actor_account_id;
alter table public.task_events alter column actor_employee_code set not null;
alter table public.task_events add constraint task_events_actor_ck check (nullif(trim(actor_employee_code), '') is not null);

alter table public.task_comments drop constraint if exists task_comments_author_ck;
alter table public.task_comments drop column if exists author_account_id;
alter table public.task_comments alter column author_employee_code set not null;
alter table public.task_comments add constraint task_comments_author_ck check (nullif(trim(author_employee_code), '') is not null);

alter table public.task_links drop constraint if exists task_links_added_by_ck;
alter table public.task_links drop column if exists added_by_account_id;
alter table public.task_links alter column added_by_employee_code set not null;
alter table public.task_links add constraint task_links_added_by_ck check (nullif(trim(added_by_employee_code), '') is not null);

commit;
