begin;

alter table public.checklist_monthly_forms
  add column if not exists score_formula_version text;

comment on column public.checklist_monthly_forms.score_formula_version is
  'Phiên bản engine đã tạo totals. NULL giữ nguyên cho phiếu lịch sử chưa migration.';

create or replace function public.phf_checklist_stamp_score_formula_version()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.score_formula_version is null or trim(new.score_formula_version)='' then
    new.score_formula_version := 'excel_weighted_average_1_2_v2';
  end if;
  return new;
end;
$$;

drop trigger if exists phf_checklist_stamp_score_formula_version on public.checklist_monthly_forms;
create trigger phf_checklist_stamp_score_formula_version
before update of self_total_score,review_total_score,final_score
on public.checklist_monthly_forms
for each row
when (
  new.self_total_score is distinct from old.self_total_score
  or new.review_total_score is distinct from old.review_total_score
  or new.final_score is distinct from old.final_score
)
execute function public.phf_checklist_stamp_score_formula_version();

revoke all on function public.phf_checklist_stamp_score_formula_version() from public,anon,authenticated;

commit;
