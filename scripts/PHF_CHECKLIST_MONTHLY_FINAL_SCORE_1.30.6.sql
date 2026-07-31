begin;

alter table public.checklist_monthly_forms
  add column if not exists self_total_score numeric(7,2),
  add column if not exists review_total_score numeric(7,2),
  add column if not exists final_score numeric(7,2),
  add column if not exists score_calculated_at timestamptz;

commit;
