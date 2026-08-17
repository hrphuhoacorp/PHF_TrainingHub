-- PHF_KNL_COMPENSATION_EFFECTIVE_PERIOD_CORRECTION — 1.56.0
-- Batch 1D Phase B. Cho phép Admin sửa một compensation assignment đã nhập
-- SAI KỲ hiệu lực (vd payroll_period=2026-08 nhưng nghiệp vụ đúng là 2026-09)
-- qua ĐÚNG 1 RPC transactional — KHÔNG sửa DB tay, KHÔNG hard-delete, KHÔNG
-- mất audit, KHÔNG overwrite kỳ đích im lặng.
--
-- Forward-only. Không rewrite dữ liệu hiện có ngoài việc gán status mặc định
-- 'ACTIVE' cho MỌI row hiện có (qua DEFAULT của cột mới, không cần UPDATE
-- hàng loạt). Giữ nguyên mọi constraint/hành vi cũ ngoài phạm vi cần đổi.
--
-- ĐÃ SỬA (post pre-1.56 metadata trên PHF-HR-DEV): tên constraint unique cũ
-- KHÔNG phải "<table>_<col1>_<col2>_key" đầy đủ như giả định ban đầu —
-- PostgreSQL giới hạn identifier ở 63 byte (NAMEDATALEN) và đã tự động cắt
-- ngắn tên auto-generated "knl_employee_compensation_assignments_employee_
-- code_payroll_period_key" (74 ký tự, vượt giới hạn) thành đúng
-- "knl_employee_compensation_assi_employee_code_payroll_period_key" (63 ký
-- tự) lúc bảng được tạo ở 1.50.0. Migration cũ hard-code tên chưa-bị-cắt nên
-- "drop constraint if exists" chỉ no-op im lặng — KHÔNG lỗi, nhưng cũng
-- KHÔNG drop được gì, để lại full-unique cũ chặn song song với partial index
-- mới (constraint cũ vẫn chặn 2 row cùng kỳ dù 1 cái VOIDED -> correction
-- RPC sẽ fail unique_violation ở INSERT target thay vì hoạt động đúng).
--
-- Fix: KHÔNG hard-code tên constraint (kể cả tên đã-biết-đúng trên DEV) —
-- tên auto-generated có thể khác nhau giữa các môi trường nếu độ dài tên
-- bảng/cột từng đổi trong lịch sử migration. Thay vào đó, bước 2 bên dưới tự
-- tra pg_constraint tại thời điểm chạy để tìm ĐÚNG MỘT unique constraint có
-- cột chính xác là (employee_code,payroll_period) — không hơn không kém —
-- rồi drop đúng constraint đó bằng tên thật vừa tra ra. Nếu tìm thấy 0 hoặc
-- >1 constraint khớp, RAISE EXCEPTION và toàn bộ transaction rollback (fail-
-- safe) — KHÔNG bao giờ đoán/drop nhầm constraint khác.

begin;

-- =============================================================================
-- 1) Lifecycle status trên assignment. Mọi row hiện có tự động ACTIVE qua
-- DEFAULT — không cần UPDATE hàng loạt, không rewrite dữ liệu.
-- =============================================================================
alter table public.knl_employee_compensation_assignments
  add column if not exists status text not null default 'ACTIVE'
  check (status in ('ACTIVE', 'VOIDED'));

comment on column public.knl_employee_compensation_assignments.status is
  'ACTIVE = dang la co cau nghiep vu that cua ky do. VOIDED = da bi Admin dieu chinh sang ky khac qua knl_correct_employee_compensation_period(), giu nguyen de audit, KHONG bi xoa, KHONG duoc business read nao dung lam du lieu hien hanh.';

-- =============================================================================
-- 2) unique(employee_code,payroll_period) cũ chặn 2 row cùng kỳ dù 1 cái đã
-- VOIDED (vd sau này lại cần 1 assignment thật khác cho đúng payroll_period
-- đã từng bị correction rời đi). Đổi sang partial unique index CHỈ áp cho
-- ACTIVE — business rule "1 kỳ tối đa 1 assignment đang hiệu lực" vẫn giữ
-- nguyên, chỉ nới cho phép nhiều row VOIDED lịch sử cùng kỳ.
--
-- Tự tra tên constraint thật thay vì hard-code (xem ghi chú đầu file) — chỉ
-- drop nếu tìm thấy ĐÚNG MỘT unique constraint mà tập cột chính xác là
-- {employee_code,payroll_period}, không hơn không kém. 0 hoặc >1 kết quả ->
-- raise exception, rollback toàn bộ transaction, KHÔNG drop gì cả.
-- =============================================================================
do $drop_old_unique$
declare
  v_conname text;
  v_match_count int;
begin
  select count(*) into v_match_count
  from pg_constraint c
  where c.conrelid = 'public.knl_employee_compensation_assignments'::regclass
    and c.contype = 'u'
    and (
      select array_agg(a.attname::text order by a.attname::text)
      from unnest(c.conkey) as k(attnum)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    ) = array['employee_code', 'payroll_period']::text[];

  if v_match_count = 0 then
    raise exception 'KNL_1_56_OLD_UNIQUE_NOT_FOUND: no UNIQUE constraint on knl_employee_compensation_assignments(employee_code,payroll_period) — refusing to proceed blind, nothing dropped';
  elsif v_match_count > 1 then
    raise exception 'KNL_1_56_OLD_UNIQUE_AMBIGUOUS: % UNIQUE constraints match (employee_code,payroll_period) — refusing to guess which one to drop', v_match_count;
  end if;

  select c.conname into v_conname
  from pg_constraint c
  where c.conrelid = 'public.knl_employee_compensation_assignments'::regclass
    and c.contype = 'u'
    and (
      select array_agg(a.attname::text order by a.attname::text)
      from unnest(c.conkey) as k(attnum)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    ) = array['employee_code', 'payroll_period']::text[];

  execute format('alter table public.knl_employee_compensation_assignments drop constraint %I', v_conname);
end;
$drop_old_unique$;

create unique index if not exists knl_employee_compensation_assignments_active_period_uq
  on public.knl_employee_compensation_assignments(employee_code, payroll_period)
  where status = 'ACTIVE';

-- =============================================================================
-- 3) Mở history action check để thêm CORRECT_EFFECTIVE_PERIOD — GIỮ NGUYÊN
-- CREATE/UPDATE, không đổi nghĩa action cũ.
-- =============================================================================
alter table public.knl_employee_compensation_history
  drop constraint if exists knl_employee_compensation_history_action_check;
alter table public.knl_employee_compensation_history
  add constraint knl_employee_compensation_history_action_check
  check (action in ('CREATE', 'UPDATE', 'CORRECT_EFFECTIVE_PERIOD'));

-- =============================================================================
-- 4) knl_save_employee_compensation() PHẢI chỉ upsert vào row ACTIVE của đúng
-- kỳ đó — nếu không thêm status='ACTIVE' vào lookup, save bình thường có thể
-- vô tình khớp trúng 1 row VOIDED lịch sử cùng kỳ (từ 1 correction trước đó)
-- và "hồi sinh" nội dung của nó mà KHÔNG đổi status trở lại ACTIVE (business
-- save không có nhiệm vụ un-void) -> record cập nhật xong vẫn vô hình với mọi
-- read (vì mọi read đều lọc status='ACTIVE'). Toàn bộ phần business logic
-- khác GIỮ NGUYÊN 100% so với 1.50.0 — chỉ thêm đúng 1 điều kiện lookup.
-- =============================================================================
create or replace function public.knl_save_employee_compensation(
  p_employee_code text,p_employee_name text,p_employment_type text,p_payroll_period text,
  p_grade_id uuid default null,p_has_professional boolean default false,p_has_management boolean default false,
  p_has_meal boolean default false,p_meal_amount bigint default 0,p_probation_amount bigint default 0,
  p_extra_allowances jsonb default '[]'::jsonb,p_organization_snapshot jsonb default '{}'::jsonb,
  p_reason text default null,p_actor_id text default null,p_actor_name text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare g record; v_old public.knl_employee_compensation_assignments%rowtype; v_id uuid; v_compensation_version_id uuid; v_snapshot jsonb; v_total bigint; v_extra bigint; v_type text:=upper(btrim(p_employment_type));
begin
  if p_payroll_period!~'^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'KNL_PAYROLL_PERIOD_INVALID' using errcode='22023'; end if;
  if not public.knl_valid_extra_allowances(p_extra_allowances) then raise exception 'KNL_EXTRA_ALLOWANCES_INVALID' using errcode='22023'; end if;
  if v_type='PROBATION' then
    if p_probation_amount<=0 then raise exception 'KNL_PROBATION_AMOUNT_REQUIRED' using errcode='22023'; end if;
    v_snapshot=jsonb_build_object('employmentType','PROBATION','probationAmount',p_probation_amount);
    v_total=p_probation_amount;p_grade_id=null;v_compensation_version_id=null;p_has_professional=false;p_has_management=false;p_has_meal=false;p_meal_amount=0;p_extra_allowances='[]'::jsonb;
  elsif v_type='OFFICIAL' then
    select cg.*,cv.ladder_id,cv.version_number,cv.status,cv.effective_period,cl.code ladder_code,cl.name ladder_name
      into g from public.knl_compensation_grades cg join public.knl_compensation_versions cv on cv.id=cg.version_id
      join public.knl_compensation_ladders cl on cl.id=cv.ladder_id where cg.id=p_grade_id;
    if not found or g.status='DRAFT' or g.effective_period is null or g.effective_period>p_payroll_period then raise exception 'KNL_COMPENSATION_GRADE_NOT_EFFECTIVE' using errcode='22023'; end if;
    v_compensation_version_id=g.version_id;
    select coalesce(sum((x->>'amount')::bigint),0) into v_extra from jsonb_array_elements(p_extra_allowances) x;
    v_snapshot=jsonb_build_object('employmentType','OFFICIAL','ladderId',g.ladder_id,'ladderCode',g.ladder_code,'ladderName',g.ladder_name,'versionId',g.version_id,'versionNumber',g.version_number,'effectivePeriod',g.effective_period,'gradeId',g.id,'gradeCode',g.grade_code,'gradeNumber',g.grade_number,'baseSalary',g.base_salary,'hqcv',g.hqcv,'professionalAllowance',g.professional_allowance,'managementAllowance',g.management_allowance);
    v_total=g.base_salary+g.hqcv+case when p_has_professional then g.professional_allowance else 0 end+case when p_has_management then g.management_allowance else 0 end+case when p_has_meal then p_meal_amount else 0 end+v_extra;
  else raise exception 'KNL_EMPLOYMENT_TYPE_INVALID' using errcode='22023'; end if;
  select * into v_old from public.knl_employee_compensation_assignments where employee_code=upper(btrim(p_employee_code)) and payroll_period=p_payroll_period and status='ACTIVE' for update;
  if found then
    update public.knl_employee_compensation_assignments set employee_name=btrim(p_employee_name),employment_type=v_type,compensation_version_id=v_compensation_version_id,compensation_grade_id=p_grade_id,has_professional_allowance=p_has_professional,has_management_allowance=p_has_management,has_meal_allowance=p_has_meal,meal_allowance=p_meal_amount,probation_amount=p_probation_amount,extra_allowances=p_extra_allowances,organization_snapshot=coalesce(p_organization_snapshot,'{}'::jsonb),structure_snapshot=v_snapshot,reference_total=v_total,reason=p_reason,updated_by=p_actor_id,updated_by_name=p_actor_name,updated_at=now() where id=v_old.id returning id into v_id;
  else
    insert into public.knl_employee_compensation_assignments(employee_code,employee_name,employment_type,payroll_period,compensation_version_id,compensation_grade_id,has_professional_allowance,has_management_allowance,has_meal_allowance,meal_allowance,probation_amount,extra_allowances,organization_snapshot,structure_snapshot,reference_total,reason,created_by,created_by_name,updated_by,updated_by_name)
    values(upper(btrim(p_employee_code)),btrim(p_employee_name),v_type,p_payroll_period,v_compensation_version_id,p_grade_id,p_has_professional,p_has_management,p_has_meal,p_meal_amount,p_probation_amount,p_extra_allowances,coalesce(p_organization_snapshot,'{}'::jsonb),v_snapshot,v_total,p_reason,p_actor_id,p_actor_name,p_actor_id,p_actor_name) returning id into v_id;
  end if;
  insert into public.knl_employee_compensation_history(assignment_id,employee_code,payroll_period,action,before_data,after_data,reason,changed_by,changed_by_name)
  select v_id,employee_code,payroll_period,case when v_old.id is null then 'CREATE' else 'UPDATE' end,case when v_old.id is null then '{}'::jsonb else to_jsonb(v_old) end,to_jsonb(a),p_reason,p_actor_id,p_actor_name from public.knl_employee_compensation_assignments a where a.id=v_id;
  return jsonb_build_object('assignmentId',v_id,'referenceTotal',v_total,'payrollPeriod',p_payroll_period);
end $$;

-- =============================================================================
-- 5) RPC transactional MỚI — correction duy nhất, atomic, server tự suy mọi
-- thứ có thể suy (KHÔNG tin action/status từ client). Preconditions P1-P4 đều
-- raise exception rõ ràng TRƯỚC bất kỳ write nào — function fail giữa chừng
-- (do exception) tự động ROLLBACK toàn bộ nhờ transaction ngầm định của 1 lần
-- gọi RPC plpgsql (đúng pattern knl_set_employee_competency_assignment /
-- knl_save_employee_compensation đã dùng và đã chứng minh work).
-- =============================================================================
create or replace function public.knl_correct_employee_compensation_period(
  p_employee_code text,
  p_source_period text,
  p_target_period text,
  p_reason text,
  p_actor_id text default null,
  p_actor_name text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(btrim(p_employee_code));
  v_source public.knl_employee_compensation_assignments%rowtype;
  v_conflict_id uuid;
  v_target_id uuid;
begin
  if v_code = '' then raise exception 'KNL_EMPLOYEE_CODE_REQUIRED' using errcode = '22023'; end if;
  if p_source_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or p_target_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'KNL_PAYROLL_PERIOD_INVALID' using errcode = '22023';
  end if;
  -- P2: target khác source.
  if p_source_period = p_target_period then
    raise exception 'KNL_CORRECTION_TARGET_SAME_AS_SOURCE' using errcode = '22023';
  end if;
  -- P4: reason bắt buộc, trim không rỗng, tối thiểu 5 ký tự (cùng ngưỡng đã
  -- chốt cho hồi tố/confirm ở các RPC khác trong hệ KNL).
  if coalesce(length(btrim(p_reason)), 0) < 5 then
    raise exception 'KNL_CORRECTION_REASON_REQUIRED' using errcode = '22023';
  end if;

  -- P1: lock source — PHẢI tồn tại và đang ACTIVE. Nếu source đã VOIDED (vd
  -- do 1 correction trước đó / do retry request cũ) -> not found -> reject
  -- sạch, KHÔNG có write nào xảy ra (đúng yêu cầu retry-safe/idempotent).
  select * into v_source from public.knl_employee_compensation_assignments
    where employee_code = v_code and payroll_period = p_source_period and status = 'ACTIVE'
    for update;
  if not found then
    raise exception 'KNL_CORRECTION_SOURCE_NOT_FOUND' using errcode = '22023';
  end if;

  -- P3: target period KHÔNG được có ACTIVE assignment khác — KHÔNG overwrite
  -- im lặng.
  select id into v_conflict_id from public.knl_employee_compensation_assignments
    where employee_code = v_code and payroll_period = p_target_period and status = 'ACTIVE'
    for update;
  if found then
    raise exception 'KNL_CORRECTION_TARGET_CONFLICT' using errcode = '55000';
  end if;

  -- Step 3: tạo target = COPY toàn bộ nội dung nghiệp vụ của source (LCB/HQCV/
  -- phụ cấp/meal/extra/reference_total/employment_type/organization_snapshot
  -- — KHÔNG bắt Admin nhập lại), chỉ đổi payroll_period + id mới + status
  -- ACTIVE + reason/actor của chính lần correction này.
  insert into public.knl_employee_compensation_assignments(
    employee_code, employee_name, employment_type, payroll_period,
    compensation_version_id, compensation_grade_id,
    has_professional_allowance, has_management_allowance, has_meal_allowance, meal_allowance,
    probation_amount, extra_allowances, organization_snapshot, structure_snapshot, reference_total,
    reason, status, created_by, created_by_name, updated_by, updated_by_name
  ) values (
    v_source.employee_code, v_source.employee_name, v_source.employment_type, p_target_period,
    v_source.compensation_version_id, v_source.compensation_grade_id,
    v_source.has_professional_allowance, v_source.has_management_allowance, v_source.has_meal_allowance, v_source.meal_allowance,
    v_source.probation_amount, v_source.extra_allowances, v_source.organization_snapshot, v_source.structure_snapshot, v_source.reference_total,
    p_reason, 'ACTIVE', p_actor_id, p_actor_name, p_actor_id, p_actor_name
  ) returning id into v_target_id;

  -- Step 4: void source — KHÔNG delete, KHÔNG đổi reason gốc của source (giữ
  -- nguyên evidence lịch sử của chính nó; lý do CỦA LẦN CORRECTION nằm ở
  -- history row bên dưới, không cần ghi đè lên row nguồn).
  update public.knl_employee_compensation_assignments
    set status = 'VOIDED', updated_by = p_actor_id, updated_by_name = p_actor_name, updated_at = now()
    where id = v_source.id;

  -- Step 5: 1 history event authoritative duy nhất — before_data = source
  -- NGUYÊN VẸN lúc còn ACTIVE (đã lock ở v_source trước khi void), after_data
  -- = target vừa tạo. Đủ đọc old period/new period/employee/before/after chỉ
  -- từ 1 row, không cần join thêm.
  insert into public.knl_employee_compensation_history(
    assignment_id, employee_code, payroll_period, action, before_data, after_data, reason, changed_by, changed_by_name
  )
  select v_target_id, v_code, p_target_period, 'CORRECT_EFFECTIVE_PERIOD',
    to_jsonb(v_source), to_jsonb(a), p_reason, p_actor_id, p_actor_name
  from public.knl_employee_compensation_assignments a where a.id = v_target_id;

  return jsonb_build_object(
    'sourceAssignmentId', v_source.id, 'targetAssignmentId', v_target_id,
    'oldPeriod', p_source_period, 'newPeriod', p_target_period, 'status', 'CORRECTED'
  );
end $$;

-- =============================================================================
-- 6) knl_correct_employee_compensation_period() là SECURITY DEFINER — theo
-- đúng convention bắt buộc của repo (mọi RPC KNL/Checklist khác đều làm vậy,
-- vd knl_save_employee_compensation ở 1.50.0), PHẢI revoke PUBLIC EXECUTE
-- (mặc định Postgres cấp EXECUTE cho PUBLIC trên function mới, KHÔNG như
-- table) rồi chỉ grant lại cho service_role — nếu không, RPC admin-only này
-- gọi được thẳng qua PostgREST bằng anon/publishable key, bỏ qua hoàn toàn
-- requireAdmin(session) ở tầng Node (lib/knl-foundation.js).
-- =============================================================================
revoke all on function public.knl_correct_employee_compensation_period(text,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.knl_correct_employee_compensation_period(text,text,text,text,text,text)
  to service_role;

commit;

-- Rollback reference (KHÔNG chạy tự động — chỉ ghi lại cách lùi nếu cần):
--   drop function if exists public.knl_correct_employee_compensation_period(text,text,text,text,text,text);
--   alter table public.knl_employee_compensation_history
--     drop constraint if exists knl_employee_compensation_history_action_check,
--     add constraint knl_employee_compensation_history_action_check check (action in ('CREATE','UPDATE'));
--   drop index if exists knl_employee_compensation_assignments_active_period_uq;
--   alter table public.knl_employee_compensation_assignments
--     add constraint knl_employee_compensation_assignments_employee_code_payroll_period_key unique(employee_code,payroll_period);
--   -- (chỉ an toàn nếu KHÔNG có row VOIDED trùng kỳ trong lúc rollback)
--   alter table public.knl_employee_compensation_assignments drop column if exists status;
--   -- knl_save_employee_compensation() có thể revert về bản 1.50.0 nếu cần.
