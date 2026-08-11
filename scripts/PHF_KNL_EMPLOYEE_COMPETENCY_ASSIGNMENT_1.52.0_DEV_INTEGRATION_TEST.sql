-- PHF KNL Employee Competency Assignment 1.52.0 — NON-PRODUCTION integration
-- test package. Chạy thủ công trên PHF-HR-DEV (Supabase SQL Editor) ONLY.
-- TUYỆT ĐỐI KHÔNG chạy bất kỳ phần nào của file này trên Production.
--
-- 4 bước ĐỘC LẬP, chạy tuần tự. Mỗi bước có expected result rõ ràng ngay
-- trong comment. Nếu bước/test nào lỗi khác với "Expected" ghi sẵn -> DỪNG,
-- không chạy tiếp, copy lại thông báo lỗi để báo Technical Lead.
--
-- BƯỚC 2 (migration 1.52.0 đã sửa) KHÔNG lặp lại ở đây — chạy trực tiếp nội
-- dung file scripts/PHF_KNL_EMPLOYEE_COMPETENCY_ASSIGNMENT_1.52.0_DRAFT.sql
-- (đã sửa 3 defect qua review, xem commit 018e69b/a4ac716/27d5a5d) giữa Bước 1
-- và Bước 3.

-- ============================================================================
-- BƯỚC 1 — DEV BOOTSTRAP TỐI THIỂU
-- ============================================================================
-- Mục đích: dựng 4 bảng phụ thuộc (knl_frameworks, knl_framework_versions,
-- knl_grade_definitions, knl_grade_requirements) ở dạng RÚT GỌN CÓ CHỦ Ý —
-- đủ để migration 1.52.0 có FK hợp lệ để test, KHÔNG đại diện đầy đủ schema
-- Production (bỏ FK knl_grade_requirements -> knl_competency_items/
-- knl_structure_columns vì 1.52.0 không phụ thuộc 2 bảng đó).
--
-- Expected: chạy xong không lỗi. Query cuối trả về đúng:
--   frameworks=2, versions=2, grades=6, requirements=2
-- STOP nếu: bất kỳ câu lệnh nào lỗi.

begin;

create extension if not exists pgcrypto;

create table public.knl_frameworks (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  status text not null default 'draft' check (status in ('draft','published','inactive')),
  created_at timestamptz not null default now()
);

create table public.knl_framework_versions (
  id uuid primary key default gen_random_uuid(),
  framework_id uuid not null references public.knl_frameworks(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  name text not null,
  status text not null default 'draft' check (status in ('draft','published','inactive')),
  lifecycle_status text not null default 'DRAFT' check (lifecycle_status in ('DRAFT','SCHEDULED','ACTIVE','INACTIVE')),
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  unique(framework_id, version_number)
);

create table public.knl_grade_definitions (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.knl_framework_versions(id) on delete restrict,
  grade_code text not null check (grade_code ~ '^B[1-9][0-9]*$'),
  grade_number integer not null check (grade_number > 0),
  label text not null check (length(btrim(label)) between 2 and 80),
  sort_order integer not null check (sort_order > 0),
  created_at timestamptz not null default now(),
  unique(version_id,grade_code),
  unique(version_id,grade_number),
  unique(version_id,sort_order),
  unique(id,version_id)
);

-- LƯU Ý: bảng dưới đây KHÔNG có FK tới knl_competency_items/knl_structure_columns
-- (Production thật CÓ 2 FK này — xem PHF_KNL_COMPETENCY_GRADE_COMPENSATION_
-- FOUNDATION_1.50.0.sql dòng 93/95 — bỏ ở DEV vì 1.52.0 không phụ thuộc chúng).
create table public.knl_grade_requirements (
  version_id uuid not null references public.knl_framework_versions(id) on delete restrict,
  item_id uuid not null,
  grade_id uuid not null,
  required_column_id uuid not null,
  required_level_number integer not null check (required_level_number > 0),
  created_at timestamptz not null default now(),
  primary key(item_id,grade_id)
);

-- Seed: 2 framework/version (mô phỏng 2 role khác nhau), mỗi version 3 Bậc B1/B2/B3
insert into public.knl_frameworks (id, code, name) values
  ('00000000-0000-4000-8000-000000000001', 'DEVTEST_FW1', 'DEV Test Framework 1'),
  ('00000000-0000-4000-8000-000000000002', 'DEVTEST_FW2', 'DEV Test Framework 2');

insert into public.knl_framework_versions (id, framework_id, version_number, name, status, lifecycle_status) values
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 1, 'Version 1', 'draft', 'DRAFT'),
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000002', 1, 'Version 1', 'draft', 'DRAFT');

insert into public.knl_grade_definitions (id, version_id, grade_code, grade_number, label, sort_order) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000011', 'B1', 1, 'Bậc 1', 1),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000011', 'B2', 2, 'Bậc 2', 2),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000011', 'B3', 3, 'Bậc 3', 3),
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000012', 'B1', 1, 'Bậc 1', 1),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000012', 'B2', 2, 'Bậc 2', 2),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000012', 'B3', 3, 'Bậc 3', 3);

insert into public.knl_grade_requirements (version_id, item_id, grade_id, required_column_id, required_level_number) values
  ('00000000-0000-4000-8000-000000000011', gen_random_uuid(), '00000000-0000-4000-8000-000000000101', gen_random_uuid(), 1),
  ('00000000-0000-4000-8000-000000000011', gen_random_uuid(), '00000000-0000-4000-8000-000000000102', gen_random_uuid(), 2);

commit;

select
  (select count(*) from public.knl_frameworks) as frameworks,
  (select count(*) from public.knl_framework_versions) as versions,
  (select count(*) from public.knl_grade_definitions) as grades,
  (select count(*) from public.knl_grade_requirements) as requirements;
-- Expected: frameworks=2 | versions=2 | grades=6 | requirements=2


-- ============================================================================
-- BƯỚC 2 — MIGRATION 1.52.0 (chạy riêng, không lặp lại ở đây)
-- ============================================================================
-- Copy TOÀN BỘ nội dung file
--   scripts/PHF_KNL_EMPLOYEE_COMPETENCY_ASSIGNMENT_1.52.0_DRAFT.sql
-- và chạy nguyên văn trong SQL Editor của PHF-HR-DEV.
-- Expected: chạy xong không lỗi (COMMIT thành công).
-- STOP nếu: bất kỳ lỗi nào (đặc biệt kiểm tra "btree_gist" extension có sẵn
-- không — nếu báo lỗi "extension btree_gist is not available", báo lại ngay,
-- đây là điều kiện tiên quyết không thể bỏ qua).
--
-- Verify ngay sau khi chạy xong:
select extname from pg_extension where extname = 'btree_gist';
-- Expected: đúng 1 dòng "btree_gist"
select conname, contype from pg_constraint where conrelid = 'public.knl_employee_competency_assignments'::regclass order by 1;
-- Expected: thấy đủ các constraint: knl_employee_competency_assignments_pkey (p),
--   employee_code check (c), knl_employee_competency_effective_range_ck (c),
--   knl_employee_competency_active_consistency_ck (c), 2 FK (f) tới
--   knl_framework_versions và knl_grade_definitions, knl_employee_competency_no_overlap (x)
select proname from pg_proc where proname = 'knl_set_employee_competency_assignment';
-- Expected: đúng 1 dòng


-- ============================================================================
-- BƯỚC 3 — INTEGRATION TESTS
-- ============================================================================
-- Chạy TỪNG khối một, theo đúng thứ tự T1 -> T-CLEANUP. Mỗi khối là 1 DO
-- block độc lập: nếu PASS thì hiện NOTICE "PASS: ..."; nếu FAIL thì tự
-- RAISE EXCEPTION rõ ràng (SQL Editor sẽ báo lỗi đỏ) -> DỪNG tại đó, báo lại.

-- ---- LIFECYCLE: CREATE ----
-- T1: CREATE PROVISIONAL cho DEVTEST01, FW1 v1, B1, effective_from=hôm nay, không cần reason.
do $$
declare v_result jsonb;
begin
  select public.knl_set_employee_competency_assignment(
    'DEVTEST01','DEV Test Nhan Vien 01',
    '00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101',
    'PROVISIONAL', current_date, 'baseline dev test', '{}'::jsonb, null, 'u-dev-admin','DEV Admin'
  ) into v_result;
  if (v_result->>'action') <> 'CREATE' then raise exception 'FAIL T1: expected action=CREATE, got %', v_result->>'action'; end if;
  raise notice 'PASS T1: CREATE thanh cong, action=%, assignmentId=%', v_result->>'action', v_result->>'assignmentId';
end $$;

-- T2: verify đúng 1 active row cho DEVTEST01, status=PROVISIONAL.
do $$
declare v_count int; v_status text;
begin
  select count(*), max(status) into v_count, v_status from public.knl_employee_competency_assignments where employee_code='DEVTEST01' and is_active=true;
  if v_count <> 1 or v_status <> 'PROVISIONAL' then raise exception 'FAIL T2: expected 1 active PROVISIONAL row, got count=% status=%', v_count, v_status; end if;
  raise notice 'PASS T2: dung 1 active row PROVISIONAL cho DEVTEST01';
end $$;

-- ---- LIFECYCLE: CONFIRM (bắt buộc reason) ----
-- T3: CONFIRM KHÔNG có reason -> phải bị reject.
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.knl_set_employee_competency_assignment(
      'DEVTEST01','DEV Test Nhan Vien 01',
      '00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101',
      'CONFIRMED', current_date, '', '{}'::jsonb, null, 'u-dev-admin','DEV Admin'
    );
  exception when others then
    if sqlerrm like '%KNL_COMPETENCY_REASON_REQUIRED:CONFIRM%' then v_failed := true;
    else raise exception 'FAIL T3: sai loai loi, got: %', sqlerrm;
    end if;
  end;
  if not v_failed then raise exception 'FAIL T3: CONFIRM khong co reason PHAI bi reject nhung lai thanh cong'; end if;
  raise notice 'PASS T3: CONFIRM khong reason bi reject dung nhu ky vong';
end $$;

-- T4: CONFIRM có reason, cùng grade -> thành công, action=CONFIRM, đóng đúng row cũ.
do $$
declare v_result jsonb; v_old_id uuid; v_active_count int; v_total_count int;
begin
  select id into v_old_id from public.knl_employee_competency_assignments where employee_code='DEVTEST01' and is_active=true;
  select public.knl_set_employee_competency_assignment(
    'DEVTEST01','DEV Test Nhan Vien 01',
    '00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101',
    'CONFIRMED', current_date, '', '{}'::jsonb, 'Da danh gia thuc te dung Bac 1', 'u-dev-admin','DEV Admin'
  ) into v_result;
  if (v_result->>'action') <> 'CONFIRM' then raise exception 'FAIL T4: expected action=CONFIRM, got %', v_result->>'action'; end if;
  if (v_result->>'supersededAssignmentId')::uuid <> v_old_id then raise exception 'FAIL T4: supersededAssignmentId khong khop row cu'; end if;
  select count(*) into v_active_count from public.knl_employee_competency_assignments where employee_code='DEVTEST01' and is_active=true;
  select count(*) into v_total_count from public.knl_employee_competency_assignments where employee_code='DEVTEST01';
  if v_active_count <> 1 or v_total_count <> 2 then raise exception 'FAIL T4: expected active=1 total=2, got active=% total=%', v_active_count, v_total_count; end if;
  if not exists (select 1 from public.knl_employee_competency_assignments where id=v_old_id and is_active=false and effective_to=current_date) then
    raise exception 'FAIL T4: row cu chua duoc dong dung effective_to';
  end if;
  raise notice 'PASS T4: CONFIRM thanh cong, row cu dong dung, tong 2 row (1 dong PROVISIONAL + 1 active CONFIRMED)';
end $$;

-- ---- CONFIRM kèm sửa grade (vẫn phải là CONFIRM, vẫn bắt buộc reason) ----
-- T5: Đang CONFIRMED B1 (từ T4) -> confirm lại với grade B2 (đánh giá thực tế khác) + reason.
do $$
declare v_result jsonb;
begin
  select public.knl_set_employee_competency_assignment(
    'DEVTEST01','DEV Test Nhan Vien 01',
    '00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000102',
    'CONFIRMED', current_date, '', '{}'::jsonb, 'Sua lai dung Bac 2 sau danh gia', 'u-dev-admin','DEV Admin'
  ) into v_result;
  -- Lưu ý: old.status hiện là CONFIRMED (không phải PROVISIONAL) nên action ở đây
  -- đúng ra phải là SUPERSEDE (CONFIRM chỉ fire khi old.status=PROVISIONAL) —
  -- test này xác nhận đúng hành vi đó, KHÔNG phải test "confirm kèm sửa grade"
  -- (test đó cần old đang PROVISIONAL, xem T5b).
  if (v_result->>'action') <> 'SUPERSEDE' then raise exception 'FAIL T5: expected action=SUPERSEDE (old da CONFIRMED), got %', v_result->>'action'; end if;
  raise notice 'PASS T5: doi grade tu trang thai CONFIRMED -> SUPERSEDE dung nhu thiet ke (khong phai CONFIRM vi old khong con PROVISIONAL)';
end $$;

-- T5b: tình huống ĐÚNG "confirm kèm sửa grade" — cần 1 nhân sự MỚI đang PROVISIONAL.
do $$
declare v_result jsonb;
begin
  perform public.knl_set_employee_competency_assignment(
    'DEVTEST03','DEV Test Nhan Vien 03',
    '00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101',
    'PROVISIONAL', current_date, 'baseline', '{}'::jsonb, null, 'u-dev-admin','DEV Admin'
  );
  select public.knl_set_employee_competency_assignment(
    'DEVTEST03','DEV Test Nhan Vien 03',
    '00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000103',
    'CONFIRMED', current_date, '', '{}'::jsonb, 'Danh gia thuc te la Bac 3, khong phai Bac 1 nhu baseline', 'u-dev-admin','DEV Admin'
  ) into v_result;
  if (v_result->>'action') <> 'CONFIRM' then raise exception 'FAIL T5b: expected action=CONFIRM (PROVISIONAL->CONFIRMED du grade doi), got %', v_result->>'action'; end if;
  if not exists (select 1 from public.knl_employee_competency_assignments where employee_code='DEVTEST03' and is_active=true and competency_grade_id='00000000-0000-4000-8000-000000000103') then
    raise exception 'FAIL T5b: grade khong duoc cap nhat thanh B3';
  end if;
  raise notice 'PASS T5b: confirm kem sua grade (PROVISIONAL->CONFIRMED, grade B1->B3) van dung action=CONFIRM va cap nhat dung grade moi';
end $$;

-- ---- Đổi framework (khác ngạch/vị trí) -> assignment mới ----
-- T6: DEVTEST01 chuyển sang FW2 v1 B1.
do $$
declare v_result jsonb; v_old_id uuid;
begin
  select id into v_old_id from public.knl_employee_competency_assignments where employee_code='DEVTEST01' and is_active=true;
  select public.knl_set_employee_competency_assignment(
    'DEVTEST01','DEV Test Nhan Vien 01',
    '00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000201',
    'PROVISIONAL', current_date, 'Chuyen vi tri, khung nang luc moi', '{}'::jsonb, null, 'u-dev-admin','DEV Admin'
  ) into v_result;
  if (v_result->>'action') <> 'SUPERSEDE' then raise exception 'FAIL T6: expected action=SUPERSEDE, got %', v_result->>'action'; end if;
  if not exists (select 1 from public.knl_employee_competency_assignments where id=v_old_id and is_active=false) then
    raise exception 'FAIL T6: row cu (FW1) chua duoc dong khi doi framework';
  end if;
  if not exists (select 1 from public.knl_employee_competency_assignments where employee_code='DEVTEST01' and is_active=true and framework_version_id='00000000-0000-4000-8000-000000000012') then
    raise exception 'FAIL T6: row moi khong tro dung FW2';
  end if;
  raise notice 'PASS T6: doi framework FW1->FW2 tao dung assignment moi, dong dung assignment cu';
end $$;

-- T7: chỉ 1 current assignment cho DEVTEST01 (sau toàn bộ T1-T6).
do $$
declare v_count int;
begin
  select count(*) into v_count from public.knl_employee_competency_assignments where employee_code='DEVTEST01' and is_active=true;
  if v_count <> 1 then raise exception 'FAIL T7: expected 1 active row, got %', v_count; end if;
  raise notice 'PASS T7: dung 1 current assignment cho DEVTEST01 sau nhieu lan doi';
end $$;

-- ---- RETROACTIVE ----
-- T8: CREATE cho DEVTEST02 với effective_from quá khứ xa (2020-01-01), KHÔNG cần reason (CREATE luôn được miễn).
do $$
declare v_result jsonb;
begin
  select public.knl_set_employee_competency_assignment(
    'DEVTEST02','DEV Test Nhan Vien 02',
    '00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101',
    'PROVISIONAL', date '2020-01-01', 'baseline cu', '{}'::jsonb, null, 'u-dev-admin','DEV Admin'
  ) into v_result;
  if (v_result->>'action') <> 'CREATE' then raise exception 'FAIL T8: expected action=CREATE, got %', v_result->>'action'; end if;
  raise notice 'PASS T8: CREATE voi effective_from qua khu (2020-01-01) khong can reason, dung nhu thiet ke';
end $$;

-- T9: hồi tố KHÔNG có reason -> phải bị reject.
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.knl_set_employee_competency_assignment(
      'DEVTEST02','DEV Test Nhan Vien 02',
      '00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000102',
      'PROVISIONAL', date '2020-06-01', '', '{}'::jsonb, null, 'u-dev-admin','DEV Admin'
    );
  exception when others then
    if sqlerrm like '%KNL_COMPETENCY_REASON_REQUIRED:RETROACTIVE_CHANGE%' then v_failed := true;
    else raise exception 'FAIL T9: sai loai loi, got: %', sqlerrm;
    end if;
  end;
  if not v_failed then raise exception 'FAIL T9: hoi to khong reason PHAI bi reject nhung lai thanh cong'; end if;
  raise notice 'PASS T9: hoi to khong reason bi reject dung nhu ky vong';
end $$;

-- T10: hồi tố hợp lệ (trong phạm vi cho phép: effective_from mới > effective_from row đang mở) + có reason -> thành công.
do $$
declare v_result jsonb;
begin
  select public.knl_set_employee_competency_assignment(
    'DEVTEST02','DEV Test Nhan Vien 02',
    '00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000102',
    'PROVISIONAL', date '2020-06-01', '', '{}'::jsonb, 'Phat hien sai sot, dieu chinh lai tu 2020-06', 'u-dev-admin','DEV Admin'
  ) into v_result;
  if (v_result->>'action') <> 'RETROACTIVE_CHANGE' then raise exception 'FAIL T10: expected action=RETROACTIVE_CHANGE, got %', v_result->>'action'; end if;
  if not exists (select 1 from public.knl_employee_competency_assignments where employee_code='DEVTEST02' and effective_from=date '2020-01-01' and is_active=false and effective_to=date '2020-06-01') then
    raise exception 'FAIL T10: row cu (2020-01-01) chua dong dung effective_to=2020-06-01';
  end if;
  raise notice 'PASS T10: hoi to hop le thanh cong, dong dung row cu tai moc 2020-06-01';
end $$;

-- T11: hồi tố VƯỢT phạm vi (lùi trước effective_from của row đang mở, 2020-06-01) -> phải bị reject.
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.knl_set_employee_competency_assignment(
      'DEVTEST02','DEV Test Nhan Vien 02',
      '00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000103',
      'PROVISIONAL', date '2019-01-01', 'thu lui qua xa', '{}'::jsonb, 'ly do hop le nhung ngay khong hop le', 'u-dev-admin','DEV Admin'
    );
  exception when others then
    if sqlerrm like '%KNL_COMPETENCY_RETROACTIVE_BEYOND_CURRENT_PERIOD%' then v_failed := true;
    else raise exception 'FAIL T11: sai loai loi, got: %', sqlerrm;
    end if;
  end;
  if not v_failed then raise exception 'FAIL T11: hoi to vuot pham vi PHAI bi reject nhung lai thanh cong'; end if;
  raise notice 'PASS T11: hoi to vuot pham vi (truoc 2020-06-01) bi reject dung nhu ky vong, khong duoc sua lich su da dong';
end $$;

-- ---- ATOMICITY (cố tình gây lỗi, xác nhận không có half-write) ----
-- T12: grade không tồn tại -> reject, KHÔNG có row nào bị thêm/đóng sai cho DEVTEST02.
do $$
declare v_before_active_id uuid; v_before_total int; v_after_total int; v_after_active_id uuid;
begin
  select id into v_before_active_id from public.knl_employee_competency_assignments where employee_code='DEVTEST02' and is_active=true;
  select count(*) into v_before_total from public.knl_employee_competency_assignments where employee_code='DEVTEST02';
  begin
    perform public.knl_set_employee_competency_assignment(
      'DEVTEST02','DEV Test Nhan Vien 02',
      '00000000-0000-4000-8000-000000000011', gen_random_uuid(),
      'PROVISIONAL', current_date, '', '{}'::jsonb, null, 'u-dev-admin','DEV Admin'
    );
    raise exception 'FAIL T12: grade khong ton tai nhung khong bi reject';
  exception when others then
    if sqlerrm not like '%KNL_COMPETENCY_GRADE_VERSION_MISMATCH%' then raise exception 'FAIL T12: sai loai loi, got: %', sqlerrm; end if;
  end;
  select count(*) into v_after_total from public.knl_employee_competency_assignments where employee_code='DEVTEST02';
  select id into v_after_active_id from public.knl_employee_competency_assignments where employee_code='DEVTEST02' and is_active=true;
  if v_after_total <> v_before_total or v_after_active_id <> v_before_active_id then
    raise exception 'FAIL T12: co half-write! before_total=% after_total=% before_active=% after_active=%', v_before_total, v_after_total, v_before_active_id, v_after_active_id;
  end if;
  raise notice 'PASS T12: grade khong hop le bi reject SACH, khong co half-write (row active cu van nguyen, tong so row khong doi)';
end $$;

-- T13: framework_version_id không khớp với grade (nhầm version) -> reject, không half-write.
do $$
declare v_before_total int; v_after_total int;
begin
  select count(*) into v_before_total from public.knl_employee_competency_assignments where employee_code='DEVTEST02';
  begin
    perform public.knl_set_employee_competency_assignment(
      'DEVTEST02','DEV Test Nhan Vien 02',
      '00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000103', -- grade B3 thuoc FW1, truyen nham version FW2
      'PROVISIONAL', current_date, '', '{}'::jsonb, null, 'u-dev-admin','DEV Admin'
    );
    raise exception 'FAIL T13: version khong khop grade nhung khong bi reject';
  exception when others then
    if sqlerrm not like '%KNL_COMPETENCY_GRADE_VERSION_MISMATCH%' then raise exception 'FAIL T13: sai loai loi, got: %', sqlerrm; end if;
  end;
  select count(*) into v_after_total from public.knl_employee_competency_assignments where employee_code='DEVTEST02';
  if v_after_total <> v_before_total then raise exception 'FAIL T13: co half-write, total truoc=% sau=%', v_before_total, v_after_total; end if;
  raise notice 'PASS T13: grade/version khong khop bi reject sach, khong half-write';
end $$;

-- T14: cố tình gây overlap bằng INSERT trực tiếp (bỏ qua RPC) -> EXCLUDE constraint phải chặn.
do $$
declare v_active record; v_failed boolean := false;
begin
  select * into v_active from public.knl_employee_competency_assignments where employee_code='DEVTEST02' and is_active=true;
  begin
    insert into public.knl_employee_competency_assignments(
      employee_code, employee_name, framework_version_id, competency_grade_id, status,
      effective_from, effective_to, is_active, grade_snapshot
    ) values (
      'DEVTEST02','DEV Test Nhan Vien 02', v_active.framework_version_id, v_active.competency_grade_id, 'PROVISIONAL',
      v_active.effective_from, null, true, '{}'::jsonb
    );
  exception when others then
    -- Chấp nhận CẢ 2 sqlstate: 23P01 (exclusion_violation - EXCLUDE constraint
    -- knl_employee_competency_no_overlap) hoặc 23505 (unique_violation -
    -- knl_employee_competency_active_uq). Postgres không đảm bảo thứ tự kiểm
    -- tra constraint nào trước; cả 2 đều là bằng chứng hợp lệ "DB tầng dưới
    -- chặn được duplicate/overlap", đúng mục đích test này.
    if sqlstate in ('23P01','23505') then v_failed := true;
    else raise exception 'FAIL T14: sai loai loi, sqlstate=%, message=%', sqlstate, sqlerrm;
    end if;
  end;
  if not v_failed then raise exception 'FAIL T14: INSERT chong lap (2 row active cung employee_code) PHAI bi constraint chan nhung lai thanh cong'; end if;
  raise notice 'PASS T14: constraint tang DB (EXCLUDE hoac unique index) chan dung insert chong lap, doc lap voi logic RPC';
end $$;

-- ---- SNAPSHOT ----
-- T15: grade_snapshot/organization_snapshot giữ đúng nội dung tại thời điểm gán.
do $$
declare v_snap jsonb; v_org jsonb;
begin
  select grade_snapshot, organization_snapshot into v_snap, v_org
    from public.knl_employee_competency_assignments where employee_code='DEVTEST03' and is_active=true;
  perform public.knl_set_employee_competency_assignment(
    'DEVTEST03','DEV Test Nhan Vien 03',
    '00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101',
    'PROVISIONAL', current_date, '', jsonb_build_object('department','DEV Dept','branch','DEV Branch'), 'test snapshot org', 'u-dev-admin','DEV Admin'
  );
  select organization_snapshot into v_org from public.knl_employee_competency_assignments where employee_code='DEVTEST03' and is_active=true;
  if (v_snap->>'gradeCode') <> 'B3' then raise exception 'FAIL T15a: grade_snapshot cua row TRUOC do (T5b) khong dung gradeCode=B3, got %', v_snap->>'gradeCode'; end if;
  if (v_org->>'department') <> 'DEV Dept' then raise exception 'FAIL T15b: organization_snapshot khong luu dung department, got %', v_org->>'department'; end if;
  raise notice 'PASS T15: grade_snapshot va organization_snapshot giu dung noi dung tai thoi diem gan';
end $$;

-- ---- DRAFT FRAMEWORK MUTATION GUARD ----
-- T16: cố tình DELETE trực tiếp 1 grade_definitions ĐANG được assignment tham chiếu -> phải bị FK chặn (23503).
do $$
declare v_referenced_grade_id uuid; v_failed boolean := false; v_before_assign_count int; v_after_assign_count int;
begin
  select competency_grade_id into v_referenced_grade_id from public.knl_employee_competency_assignments limit 1;
  select count(*) into v_before_assign_count from public.knl_employee_competency_assignments;
  begin
    delete from public.knl_grade_definitions where id = v_referenced_grade_id;
  exception when others then
    if sqlstate = '23503' then v_failed := true;
    else raise exception 'FAIL T16: sai loai loi, sqlstate=%, message=%', sqlstate, sqlerrm;
    end if;
  end;
  if not v_failed then raise exception 'FAIL T16: DELETE grade dang duoc assignment tham chieu PHAI bi FK chan (23503) nhung lai thanh cong'; end if;
  select count(*) into v_after_assign_count from public.knl_employee_competency_assignments;
  if v_after_assign_count <> v_before_assign_count then raise exception 'FAIL T16: du DELETE bi chan nhung du lieu assignment van bi anh huong'; end if;
  raise notice 'PASS T16: composite FK chan dung DELETE grade_definitions dang duoc tham chieu (23503), du lieu assignment/history khong bi anh huong';
end $$;

-- T17 (thông tin, không phải PASS/FAIL bắt buộc): xác nhận history append-only —
-- đếm số row history theo action, đối chiếu tay với số lần gọi RPC ở trên.
select action, count(*) from public.knl_employee_competency_assignment_history group by action order by 1;
-- Expected tối thiểu (tuỳ đã chạy đủ T1-T16 chưa): CREATE >=3 (DEVTEST01,02,03),
-- CONFIRM >=2 (T4, T5b), SUPERSEDE >=3 (T5, T6, ...), RETROACTIVE_CHANGE >=1 (T10)


-- ============================================================================
-- BƯỚC 4 — VERIFICATION / CLEANUP
-- ============================================================================
-- 4a. Verify tổng quan constraint (đối chiếu lại sau khi test xong, phải khớp
-- hệt kết quả đã kiểm tra ngay sau Bước 2 — xác nhận không có gì bị đổi/mất
-- trong lúc chạy Bước 3):
select conname, contype from pg_constraint where conrelid = 'public.knl_employee_competency_assignments'::regclass order by 1;

-- 4b. Xem toàn bộ timeline hiện tại của 3 nhân sự test (để mắt kiểm tra thủ công):
select employee_code, status, effective_from, effective_to, is_active, framework_version_id, competency_grade_id
  from public.knl_employee_competency_assignments
  order by employee_code, effective_from;

-- 4c. Xem toàn bộ history (audit) — xác nhận append-only, không có gì bị sửa/xoá:
select id, employee_code, action, reason, changed_at from public.knl_employee_competency_assignment_history order by id;

-- ---------------------------------------------------------------------------
-- 4d. CLEANUP (TUỲ CHỌN — chỉ chạy khi muốn reset PHF-HR-DEV về trạng thái
-- trống để bootstrap lại từ đầu; KHÔNG bắt buộc, có thể để nguyên dữ liệu test
-- làm tài liệu tham khảo). Chỉ áp dụng cho PHF-HR-DEV, KHÔNG BAO GIỜ chạy ở
-- Production.
-- ---------------------------------------------------------------------------
-- begin;
-- drop function if exists public.knl_set_employee_competency_assignment(text,text,uuid,uuid,text,date,text,jsonb,text,text,text);
-- drop table if exists public.knl_employee_competency_assignment_history;
-- drop table if exists public.knl_employee_competency_assignments;
-- drop table if exists public.knl_grade_requirements;
-- drop table if exists public.knl_grade_definitions;
-- drop table if exists public.knl_framework_versions;
-- drop table if exists public.knl_frameworks;
-- commit;
-- Expected: chạy xong không lỗi, PHF-HR-DEV trở về trạng thái trống (sẵn sàng
-- bootstrap lại từ Bước 1 nếu cần test lại sau khi sửa migration).
