-- PHF KNL — Explicit mapping: compensation grade <-> competency grade, 1.63.0.
--
-- ROOT CAUSE (phát hiện qua DEV rehearsal thật trên PHF-HR-DEV, không phải
-- lý thuyết): knl_grade_definitions.grade_code bị CHECK ép chỉ nhận 'B1'/'B2'
-- (^B[1-9][0-9]*$', xem 1.50.0 dòng 64), trong khi knl_compensation_grades.
-- grade_code BẮT BUỘC có tiền tố + gạch ngang ('NSGQ-B1', xem 1.50.0 dòng
-- 322: ^[A-Z0-9][A-Z0-9_-]{1,19}-B[1-9][0-9]*$'). 2 regex loại trừ nhau tuyệt
-- đối — KHÔNG có chuỗi nào thoả cả hai — nên so khớp trực tiếp grade_code
-- giữa 2 hệ (bản Phase 2 batch trước) sẽ LUÔN thất bại với dữ liệu thật.
--
-- Business decision (đã chốt): compensation grade và competency grade là 2
-- hệ ĐỘC LẬP. KHÔNG suy diễn tương đương qua grade_number hay string-parse
-- kiểu "NSGQ-B1" -> "B1". Mapping phải EXPLICIT, UNIQUE, AUDITABLE — thiếu
-- mapping thì BLOCK proposal (giữ nguyên hành vi BLOCK đã có, chỉ đổi NGUỒN
-- xác định "có mapping hay không": trước đây là so khớp chuỗi, giờ là có
-- dòng mapping tường minh hay không).
--
-- Scope theo framework_version_id (không chỉ compensation_grade_id): cùng 1
-- bậc lương có thể map khác nhau tuỳ framework năng lực nào đang áp dụng cho
-- nhân sự — đúng thực tế nhiều framework/nhiều ngành nghề cùng tồn tại.
--
-- CHƯA APPLY DEV/Production — chỉ tạo file, chờ duyệt.

begin;

create table if not exists public.knl_compensation_competency_grade_map (
  id uuid primary key default gen_random_uuid(),

  framework_version_id uuid not null references public.knl_framework_versions(id) on delete restrict,
  compensation_grade_id uuid not null references public.knl_compensation_grades(id) on delete restrict,
  competency_grade_id uuid not null,

  created_by text,
  created_by_name text,
  updated_by text,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- UNIQUE: mỗi (framework_version_id, compensation_grade_id) tối đa 1 mapping
  -- — không cho mập mờ 2 bậc năng lực cùng map từ 1 bậc lương trong cùng 1
  -- framework version.
  unique (framework_version_id, compensation_grade_id),

  -- Composite FK (competency_grade_id, framework_version_id) -> đúng bảng
  -- knl_grade_definitions(id, version_id) — TÁI DÙNG pattern đã có ở
  -- knl_employee_competency_assignments (1.52.0) và knl_grade_promotion_
  -- proposals, đảm bảo competency_grade_id LUÔN thuộc đúng framework_version_id
  -- đang khai báo, không thể trỏ lệch version.
  foreign key (competency_grade_id, framework_version_id)
    references public.knl_grade_definitions(id, version_id) on delete restrict
);

create index if not exists knl_compensation_competency_grade_map_version_idx
  on public.knl_compensation_competency_grade_map(framework_version_id);

alter table public.knl_compensation_competency_grade_map enable row level security;
revoke all on public.knl_compensation_competency_grade_map from public, anon, authenticated;

comment on table public.knl_compensation_competency_grade_map is
  'Mapping TƯỜNG MINH bậc lương (knl_compensation_grades) <-> bậc năng lực (knl_grade_definitions), theo đúng framework_version_id đang áp dụng. Compensation grade và competency grade là 2 hệ độc lập — KHÔNG suy diễn qua grade_number/grade_code string. Thiếu mapping => Đề xuất nâng bậc (lib/knl-grade-proposals.js) BLOCK tạo/gửi, không fallback.';

commit;

-- READ-ONLY verification sau khi apply:
-- select column_name from information_schema.columns where table_schema='public'
--   and table_name='knl_compensation_competency_grade_map' order by column_name;
-- select conname from pg_constraint where conrelid='public.knl_compensation_competency_grade_map'::regclass;
