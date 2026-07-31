begin;

alter table public.checklist_monthly_forms
  add column if not exists reviewed_as_override boolean not null default false,
  add column if not exists review_override_reason text not null default '';

commit;
