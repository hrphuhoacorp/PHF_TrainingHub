-- Rollback cho PHF_CHECKLIST_VIOLATION_DUPLICATE_UNBLOCK_HEALTH_FIX_1.42.1.sql
--
-- Day la rollback SCHEMA thuan tuy (CREATE OR REPLACE FUNCTION) - KHONG dong den bat ky
-- dong du lieu nao ca 2 chieu, nen KHONG can preflight dieu kien nhu rollback 1.42.0.
-- Chi don gian dua ham phf_checklist_production_health() ve dung dinh nghia truoc 1.42.1
-- (kiem tra lai uq_checklist_violation_active_fingerprint thay vi uq_checklist_violation_request_id).
--
-- CHI dung rollback nay neu can quay lai dung migration 1.42.0 (tao lai unique fingerprint
-- index) - neu khong, rollback nay se lam /api/health bao "not-ready" tro lai y nhu loi da sua.

begin;

create or replace function public.phf_checklist_production_health()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_missing text[] := array[]::text[];
  v_name text;
begin
  foreach v_name in array array[
    'phf_save_checklist_assignments','phf_save_checklist_template','phf_create_checklist_monthly','phf_save_checklist_monthly_self','phf_save_checklist_monthly_review',
    'phf_mutate_checklist_violation','phf_delete_checklist_test_violations',
    'phf_transition_checklist_task','phf_save_checklist_permission_grants',
    'phf_disable_checklist_permission_grant','phf_save_checklist_monthly_overdue_policy',
    'phf_save_checklist_monthly_score_policy','phf_save_checklist_late_points_policy',
    'phf_save_checklist_repeat_violation_policy','phf_apply_monthly_overdue_batch'
  ] loop
    if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=v_name) then
      v_missing:=array_append(v_missing,'function:'||v_name);
    end if;
  end loop;

  if to_regclass('public.checklist_employee_assignments') is null then v_missing:=array_append(v_missing,'table:checklist_employee_assignments'); end if;
  if to_regclass('public.checklist_templates') is null then v_missing:=array_append(v_missing,'table:checklist_templates'); end if;
  if to_regclass('public.checklist_violation_records') is null then v_missing:=array_append(v_missing,'table:checklist_violation_records'); end if;
  if to_regclass('public.checklist_monthly_forms') is null then v_missing:=array_append(v_missing,'table:checklist_monthly_forms'); end if;
  if not exists(select 1 from pg_trigger where tgname='trg_phf_guard_violation_finalized_period' and not tgisinternal) then v_missing:=array_append(v_missing,'trigger:trg_phf_guard_violation_finalized_period'); end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='uq_checklist_violation_active_fingerprint') then v_missing:=array_append(v_missing,'index:uq_checklist_violation_active_fingerprint'); end if;
  if exists(
    select 1
    from public.checklist_permission_grants a
    join public.checklist_permission_grants b on a.id<b.id and a.is_active=true and b.is_active=true
      and ((a.account_id is not null and a.account_id=b.account_id) or (a.employee_code is not null and b.employee_code is not null and upper(a.employee_code)=upper(b.employee_code)))
      and daterange(a.effective_from,coalesce(a.effective_to,'infinity'::date),'[]') && daterange(b.effective_from,coalesce(b.effective_to,'infinity'::date),'[]')
  ) then v_missing:=array_append(v_missing,'data:checklist_permission_overlap'); end if;

  return jsonb_build_object('ok',coalesce(array_length(v_missing,1),0)=0,'missing',to_jsonb(v_missing));
end;
$$;

revoke all on function public.phf_checklist_production_health() from public,anon,authenticated;
grant execute on function public.phf_checklist_production_health() to service_role;

commit;
