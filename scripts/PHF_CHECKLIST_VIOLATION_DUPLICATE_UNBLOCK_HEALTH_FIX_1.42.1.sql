-- PHF Checklist Batch D1 hotfix - phf_checklist_production_health() con kiem tra cung
-- ten index 'uq_checklist_violation_active_fingerprint' - index nay da bi DROP CHU DONG
-- boi PHF_CHECKLIST_VIOLATION_DUPLICATE_UNBLOCK_1.42.0.sql (dung y muon cua Batch D1, khong
-- phai loi mat du lieu). Ham health-check nay dinh nghia tu PHF_CHECKLIST_PRODUCTION_STABILITY_
-- 1.33.1.sql, TRUOC Batch D1, nen chua biet ve thay doi nay - sau khi 1.42.0 chay, /api/health
-- Production tra {"ok":false,"code":"CHECKLIST_PRODUCTION_NOT_READY","missing":
-- ["index:uq_checklist_violation_active_fingerprint"]} du he thong hoat dong dung.
--
-- Xac nhan bang code (khong suy doan): checkSupabaseHealth() (lib/production-hardening.js)
-- CHI duoc goi tu api/health.js va server.js (route /api/health) - khong noi nao khac trong
-- codebase goi ham nay. Tra 503 lam sai lech monitoring/canh bao, nhung KHONG chan bat ky
-- request nghiep vu thuc nao (login, saveChecklistViolations, ...).
--
-- Sua: doi health gate sang kiem tra DUNG thu duoc yeu cau thuc su sau Batch D1 -
-- uq_checklist_violation_request_id (idempotency ky thuat DUY NHAT con lai) - thay cho
-- fingerprint da chu dong bo. Day la CREATE OR REPLACE FUNCTION thuan tuy - khong dong den
-- bat ky dong du lieu nao, khong co rui ro mat/sua du lieu.
--
-- Preflight (2026-08-06, Production, ngay sau 1.42.0):
--   /api/health -> {"ok":false,"missing":["index:uq_checklist_violation_active_fingerprint"]}
--   (xac nhan dung nhu du doan, khong phai loi khac).

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
  -- Batch D1 (1.42.0): fingerprint khong con la unique constraint bat buoc - thay bang
  -- kiem tra dung index idempotency ky thuat con lai (request_id).
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='uq_checklist_violation_request_id') then v_missing:=array_append(v_missing,'index:uq_checklist_violation_request_id'); end if;
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

-- Verification (chay sau khi apply):
-- select public.phf_checklist_production_health();
-- -> ky vong {"ok": true, "missing": []}
-- Va goi that: curl https://training.phuhoafresh.info.vn/api/health -> ky vong "ok":true.
