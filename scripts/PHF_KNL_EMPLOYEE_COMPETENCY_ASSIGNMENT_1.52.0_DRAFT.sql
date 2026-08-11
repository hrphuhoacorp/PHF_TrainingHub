-- PHF KNL Employee Competency Assignment — 1.52.0
-- *** DRAFT — CHƯA APPLY PRODUCTION. Chờ Technical Lead/PHF duyệt. ***
--
-- Thiết kế theo policy đã chốt (KNL Personal Assignment Design batch):
--   - 1 employee = tối đa 1 assignment is_active=true tại 1 thời điểm.
--   - Mọi thay đổi (grade/framework/status) = mốc mới (effective_from mới),
--     đóng assignment cũ (effective_to = effective_from mới), KHÔNG update-in-place
--     nội dung của 1 row duy nhất qua nhiều lần đổi (khác hẳn draft trước).
--   - History append-only, không update/xoá.
--   - status: PROVISIONAL ("Tạm áp dụng") | CONFIRMED ("Chính thức").
--   - Framework version draft/DRAFT được phép trỏ tới (baseline không cần publish).
--   - Bảo vệ khỏi draft-grade-matrix bị sửa âm thầm: composite FK
--     (competency_grade_id, framework_version_id) -> knl_grade_definitions(id, version_id)
--     ON DELETE RESTRICT. knl_save_grade_matrix() (đã có, xem
--     PHF_KNL_COMPETENCY_GRADE_COMPENSATION_FOUNDATION_1.50.0.sql dòng 137-138)
--     DELETE toàn bộ knl_grade_definitions của version trước khi insert lại —
--     một khi có bất kỳ assignment nào tham chiếu, DELETE đó sẽ bị Postgres tự
--     chặn bằng lỗi foreign key violation (23503), toàn bộ knl_save_grade_matrix()
--     rollback. Đây CHÍNH LÀ guard — không cần thêm trigger/logic riêng.

begin;

create extension if not exists pgcrypto;
-- Cần cho EXCLUDE USING gist bên dưới (so sánh "=" trên text kết hợp range
-- overlap "&&" trong cùng 1 index). Extension chuẩn của Postgres/Supabase,
-- cần xác nhận đã enable trên project Supabase thật trước khi apply thật
-- (thường bật sẵn, nhưng phải kiểm tra qua Supabase Dashboard > Database >
-- Extensions trước khi chạy migration này).
create extension if not exists btree_gist;

create table if not exists public.knl_employee_competency_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_code text not null check (employee_code = upper(btrim(employee_code)) and employee_code <> ''),
  employee_name text not null,
  framework_version_id uuid not null references public.knl_framework_versions(id) on delete restrict,
  competency_grade_id uuid not null references public.knl_grade_definitions(id) on delete restrict,
  status text not null default 'PROVISIONAL' check (status in ('PROVISIONAL', 'CONFIRMED')),
  effective_from date not null,
  effective_to date,
  is_active boolean not null default true,
  -- Snapshot đầy đủ nội dung Bậc tại thời điểm gán (label, sort_order, toàn bộ
  -- yêu cầu theo item) — phòng trường hợp version chuyển từ draft sang locked/
  -- published sau này và nội dung hiển thị lịch sử cần đúng như lúc gán, không
  -- phụ thuộc join runtime vào bảng có thể đã đổi (dù FK restrict đã chặn xoá,
  -- schema vẫn có thể được publish/khoá làm thay đổi ý nghĩa hiển thị nếu không
  -- snapshot). Mirror đúng pattern structure_snapshot của compensation.
  grade_snapshot jsonb not null default '{}'::jsonb,
  organization_snapshot jsonb not null default '{}'::jsonb,
  note text not null default '',
  reason text,
  created_by text,
  created_by_name text,
  updated_by text,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (competency_grade_id, framework_version_id)
    references public.knl_grade_definitions(id, version_id) on delete restrict,
  constraint knl_employee_competency_effective_range_ck
    check (effective_to is null or effective_to >= effective_from),
  constraint knl_employee_competency_active_consistency_ck
    check ((is_active and effective_to is null) or (not is_active and effective_to is not null))
);

-- Belt-and-suspenders #1: tối đa 1 row is_active=true / nhân sự. (Thực ra đã
-- được đảm bảo bởi EXCLUDE bên dưới vì 2 row active cùng employee_code luôn có
-- range [from, +inf) chồng nhau — giữ cả 2 để lỗi báo rõ ràng hơn khi vi phạm,
-- không phải để bổ sung logic mới.)
create unique index if not exists knl_employee_competency_active_uq
  on public.knl_employee_competency_assignments(employee_code) where is_active = true;

-- Belt-and-suspenders #2: KHÔNG cho phép 2 khoảng effective_from/effective_to
-- của cùng 1 nhân sự chồng lấn nhau ở tầng DB (không chỉ dựa vào RPC lock +
-- logic ứng dụng). effective_to NULL = chưa đóng = range mở tới +infinity.
alter table public.knl_employee_competency_assignments
  add constraint knl_employee_competency_no_overlap
  exclude using gist (
    employee_code with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

create index if not exists knl_employee_competency_employee_idx
  on public.knl_employee_competency_assignments(employee_code, effective_from desc);
create index if not exists knl_employee_competency_grade_idx
  on public.knl_employee_competency_assignments(competency_grade_id);

create table if not exists public.knl_employee_competency_assignment_history (
  id bigint generated always as identity primary key,
  assignment_id uuid not null references public.knl_employee_competency_assignments(id) on delete restrict,
  superseded_assignment_id uuid references public.knl_employee_competency_assignments(id) on delete restrict,
  employee_code text not null,
  action text not null check (action in ('CREATE', 'CONFIRM', 'SUPERSEDE', 'RETROACTIVE_CHANGE')),
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null,
  reason text,
  changed_by text,
  changed_by_name text,
  changed_at timestamptz not null default now()
);
create index if not exists knl_employee_competency_history_idx
  on public.knl_employee_competency_assignment_history(employee_code, changed_at desc);

revoke all on public.knl_employee_competency_assignments, public.knl_employee_competency_assignment_history
  from public, anon, authenticated;

comment on table public.knl_employee_competency_assignments is
  'Timeline (khong overlap) cua Bac KNL hien hanh theo nhan su. Moi thay doi = row moi, row cu dong lai (is_active=false, effective_to=effective_from moi). Khong phai payroll/income.';
comment on table public.knl_employee_competency_assignment_history is
  'Audit ky thuat append-only, tach rieng khoi timeline nghiep vu tren.';

-- ---------------------------------------------------------------------------
-- RPC atomic: khoá row active hiện tại (nếu có) -> validate -> đóng row cũ ->
-- insert row mới -> ghi history. Toàn bộ trong 1 transaction (1 lần gọi
-- plpgsql function = 1 statement từ phía Node -> tự động atomic, đúng pattern
-- knl_save_employee_compensation đã dùng và đã chứng minh work ở Income
-- Batch 1/2/Salary Baseline).
--
-- Action được SERVER tự suy ra, không tin caller truyền:
--   - Chưa có row active nào của nhân sự -> CREATE
--   - p_effective_from < current_date -> RETROACTIVE_CHANGE (ưu tiên cao nhất,
--     vì tính hồi tố là sự kiện quan trọng nhất cần audit rõ, bất kể nội dung
--     khác thay đổi gì)
--   - status cũ PROVISIONAL, status mới CONFIRMED, effective_from = hôm nay
--     hoặc tương lai -> CONFIRM
--   - còn lại -> SUPERSEDE
--
-- Giới hạn hồi tố (đã chốt trong batch: "không silently rewrite history"):
--   Chỉ cho phép p_effective_from lùi về TỐI ĐA bằng effective_from của row
--   active hiện tại (tức "sửa lại ngày bắt đầu của giai đoạn đang mở"), KHÔNG
--   cho phép lùi trước đó (tức chèn/ghi đè vào các giai đoạn đã đóng trong quá
--   khứ). Nếu Admin cần sửa 1 giai đoạn đã đóng thật sự, đó là 1 nghiệp vụ
--   khác (sửa lịch sử) chưa được PHF chốt trong batch này -> RPC chủ động
--   raise exception, không đoán.
create or replace function public.knl_set_employee_competency_assignment(
  p_employee_code text,
  p_employee_name text,
  p_framework_version_id uuid,
  p_competency_grade_id uuid,
  p_status text default 'PROVISIONAL',
  p_effective_from date default current_date,
  p_note text default '',
  p_organization_snapshot jsonb default '{}'::jsonb,
  p_reason text default null,
  p_actor_id text default null,
  p_actor_name text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(btrim(p_employee_code));
  v_old public.knl_employee_competency_assignments%rowtype;
  v_id uuid;
  v_action text;
  v_grade record;
  v_grade_snapshot jsonb;
  v_requirements jsonb;
begin
  if v_code = '' then raise exception 'KNL_EMPLOYEE_CODE_REQUIRED' using errcode = '22023'; end if;
  if p_status not in ('PROVISIONAL', 'CONFIRMED') then
    raise exception 'KNL_COMPETENCY_STATUS_INVALID' using errcode = '22023';
  end if;
  if p_effective_from is null then raise exception 'KNL_EFFECTIVE_FROM_REQUIRED' using errcode = '22023'; end if;

  -- Khoá row active hiện tại của nhân sự (nếu có) trước khi quyết định gì khác,
  -- để 2 request đồng thời cho cùng 1 nhân sự tuần tự hoá qua row lock, không
  -- chỉ dựa vào EXCLUDE constraint bắt lỗi SAU khi đã insert (constraint là lưới
  -- an toàn cuối, không phải cơ chế chính để tránh race).
  select * into v_old from public.knl_employee_competency_assignments
    where employee_code = v_code and is_active = true for update;

  if found and p_effective_from < v_old.effective_from then
    raise exception 'KNL_COMPETENCY_RETROACTIVE_BEYOND_CURRENT_PERIOD: khong the lui ve truoc effective_from cua giai doan dang mo (%). Sua giai doan da dong la nghiep vu khac, chua duoc chot.', v_old.effective_from
      using errcode = '55000';
  end if;

  if not found then
    v_action := 'CREATE';
  elsif p_effective_from < current_date then
    v_action := 'RETROACTIVE_CHANGE';
  elsif v_old.status = 'PROVISIONAL' and p_status = 'CONFIRMED'
        and v_old.framework_version_id = p_framework_version_id
        and v_old.competency_grade_id = p_competency_grade_id then
    v_action := 'CONFIRM';
  else
    v_action := 'SUPERSEDE';
  end if;

  -- Reason bắt buộc cho 2 trường hợp đã chốt nghiệp vụ: hồi tố (mọi hành động
  -- có effective_from ở quá khứ) VÀ confirm (PROVISIONAL->CONFIRMED, kể cả khi
  -- effective_from không hồi tố) — "Khi confirm: bắt buộc reason/căn cứ" theo
  -- đúng mục 3 của batch Personal Assignment Design. KHÔNG bắt buộc cho CREATE/
  -- SUPERSEDE thường (không hồi tố, không phải confirm) vì batch không chốt
  -- yêu cầu này cho các trường hợp đó.
  if v_action in ('RETROACTIVE_CHANGE', 'CONFIRM') and coalesce(length(btrim(p_reason)), 0) < 5 then
    raise exception 'KNL_COMPETENCY_REASON_REQUIRED:%', v_action using errcode = '22023';
  end if;

  -- Snapshot nội dung Bậc tại thời điểm gán (label + sort_order + toàn bộ
  -- requirement theo item).
  select gd.grade_code, gd.grade_number, gd.sort_order, gd.label, fv.version_number, f.code as framework_code, f.name as framework_name
    into v_grade
    from public.knl_grade_definitions gd
    join public.knl_framework_versions fv on fv.id = gd.version_id
    join public.knl_frameworks f on f.id = fv.framework_id
    where gd.id = p_competency_grade_id and gd.version_id = p_framework_version_id;
  if not found then raise exception 'KNL_COMPETENCY_GRADE_VERSION_MISMATCH' using errcode = '22023'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'itemId', gr.item_id, 'requiredColumnId', gr.required_column_id, 'requiredLevelNumber', gr.required_level_number
    )), '[]'::jsonb) into v_requirements
    from public.knl_grade_requirements gr where gr.version_id = p_framework_version_id and gr.grade_id = p_competency_grade_id;

  v_grade_snapshot := jsonb_build_object(
    'frameworkCode', v_grade.framework_code, 'frameworkName', v_grade.framework_name,
    'versionNumber', v_grade.version_number, 'gradeCode', v_grade.grade_code,
    'gradeNumber', v_grade.grade_number, 'sortOrder', v_grade.sort_order, 'label', v_grade.label, 'requirements', v_requirements
  );

  -- SỬA (review 1.52.0 trước integration test): KHÔNG dùng "if found then" ở
  -- đây — FOUND đã bị ghi đè bởi 2 lệnh SELECT INTO phía trên (dòng snapshot
  -- Bậc + snapshot requirements, lệnh sau luôn "found" vì có COALESCE/aggregate
  -- luôn trả đúng 1 dòng), nên "if found" ở vị trí cũ LUÔN đúng bất kể v_old có
  -- thật hay không. Hành vi quan sát được TRƯỚC ĐÂY vẫn đúng một cách tình cờ
  -- (UPDATE ... WHERE id = NULL luôn khớp 0 dòng khi v_old.id là NULL), nhưng
  -- đây là logic dễ vỡ nếu ai đó chèn thêm 1 SELECT INTO nữa phía trên - kiểm
  -- tra thẳng v_old.id để không phụ thuộc trạng thái FOUND còn sót lại.
  if v_old.id is not null then
    update public.knl_employee_competency_assignments
      set is_active = false, effective_to = p_effective_from, updated_by = p_actor_id, updated_by_name = p_actor_name, updated_at = now()
      where id = v_old.id;
  end if;

  insert into public.knl_employee_competency_assignments(
    employee_code, employee_name, framework_version_id, competency_grade_id, status,
    effective_from, effective_to, is_active, grade_snapshot, organization_snapshot, note, reason,
    created_by, created_by_name, updated_by, updated_by_name
  ) values (
    v_code, btrim(p_employee_name), p_framework_version_id, p_competency_grade_id, p_status,
    p_effective_from, null, true, v_grade_snapshot, coalesce(p_organization_snapshot, '{}'::jsonb), p_note, p_reason,
    p_actor_id, p_actor_name, p_actor_id, p_actor_name
  ) returning id into v_id;

  insert into public.knl_employee_competency_assignment_history(
    assignment_id, superseded_assignment_id, employee_code, action, before_data, after_data, reason, changed_by, changed_by_name
  )
  select v_id, v_old.id, v_code, v_action,
    case when v_old.id is null then '{}'::jsonb else to_jsonb(v_old) end,
    to_jsonb(a), p_reason, p_actor_id, p_actor_name
  from public.knl_employee_competency_assignments a where a.id = v_id;

  return jsonb_build_object('assignmentId', v_id, 'supersededAssignmentId', v_old.id, 'action', v_action, 'effectiveFrom', p_effective_from);
end $$;

revoke all on function public.knl_set_employee_competency_assignment(
  text, text, uuid, uuid, text, date, text, jsonb, text, text, text
) from public, anon, authenticated;
grant execute on function public.knl_set_employee_competency_assignment(
  text, text, uuid, uuid, text, date, text, jsonb, text, text, text
) to service_role;

commit;

-- READ-ONLY verification sau khi apply thật (chưa chạy trong batch này):
-- select conname, contype from pg_constraint where conrelid='public.knl_employee_competency_assignments'::regclass;
-- select proname from pg_proc where proname='knl_set_employee_competency_assignment';
