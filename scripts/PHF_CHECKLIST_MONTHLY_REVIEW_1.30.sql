begin;

alter table public.checklist_monthly_forms
  add column if not exists review_answers jsonb not null default '{}'::jsonb,
  add column if not exists review_note text not null default '',
  add column if not exists checklist_review_score numeric(7,2),
  add column if not exists checklist_review_reason text not null default '',
  add column if not exists review_saved_at timestamptz,
  add column if not exists review_submitted_at timestamptz,
  add column if not exists reviewed_by text,
  add column if not exists reviewed_by_code text,
  add column if not exists reviewed_by_name text;

alter table public.checklist_monthly_forms
  drop constraint if exists checklist_monthly_forms_status_check;

alter table public.checklist_monthly_forms
  add constraint checklist_monthly_forms_status_check
  check(status in('draft','waiting_self','waiting_review','reviewed','locked','cancelled'));

commit;
