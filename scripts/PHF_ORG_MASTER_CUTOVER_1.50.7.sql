-- PHF Organization Master Cutover 1.50.7 — schema only, additive.
-- Retracts the ownership statement in PHF_HR_EMPLOYEE_PROFILE_V1_1.46.2.sql
-- ("Organization remains owned by checklist_employee_assignments"). After
-- this migration + the bootstrap seed (scripts/phf-org-master-seed-from-
-- checklist-1.50.7.js), public.employee_profiles is the sole write surface
-- for department/title/position/branch/manager. checklist_employee_
-- assignments keeps its own operational fields (leave_until, status_note,
-- template_id/version, effective_date, reason) and becomes a read
-- projection for organization fields — that consumer switch is Phase 5/6,
-- NOT part of this migration.
--
-- Run manually in Production after application tests pass. Additive only:
-- new nullable/default-empty columns, no drop/rename, no data mutation.

begin;

alter table public.employee_profiles
  add column if not exists department text not null default '',
  add column if not exists title text not null default '',
  add column if not exists position text null,
  add column if not exists branch text not null default '',
  add column if not exists manager_employee_code text not null default '';

comment on column public.employee_profiles.department is 'Organization Master field. Canonical department (Phòng ban). Sole write surface after cutover.';
comment on column public.employee_profiles.title is 'Organization Master field. Canonical job title / chức danh, bootstrapped from checklist_employee_assignments.title.';
comment on column public.employee_profiles.position is 'Organization Master field. Chức vụ. Nullable by design — no verified source exists yet at cutover time; NOT backfilled from user_accounts.position (unverified legacy data).';
comment on column public.employee_profiles.branch is 'Organization Master field. Canonical chi nhánh.';
comment on column public.employee_profiles.manager_employee_code is 'Organization Master field. Direct manager''s employee_code, resolved (never guessed) at seed time. Empty = no manager on record.';

commit;

-- READ-ONLY verification after manual Production execution:
-- select column_name from information_schema.columns
-- where table_schema='public' and table_name='employee_profiles'
--   and column_name in ('department','title','position','branch','manager_employee_code')
-- order by column_name;
