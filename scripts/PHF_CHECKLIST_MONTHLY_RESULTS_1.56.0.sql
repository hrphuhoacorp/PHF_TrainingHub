-- PHF_CHECKLIST_MONTHLY_RESULTS_1.56.0 — DESIGN ONLY, NOT YET RUN.
--
-- Mục tiêu: lớp KẾT QUẢ ĐIỂM CHECKLIST THEO THÁNG (authoritative monthly
-- result) — độc lập với checklist_monthly_forms (đã audit READ-ONLY trước
-- khi viết file này: checklist_monthly_forms là bảng WORKFLOW FORM thật —
-- period_id NOT NULL FK, template_snapshot NOT NULL, self_answers/
-- review_answers, status enum workflow (waiting_self/waiting_review/
-- reviewed/locked/cancelled), self_total_score/review_total_score/
-- final_score là kết quả CÔNG THỨC từ self/review answers thật, có trigger
-- khóa ghi trực tiếp. Nhét baseline lịch sử vào đó sẽ phải bịa period/
-- template_snapshot/self_answers chưa từng tồn tại — SAI ngữ nghĩa.
--
-- Bảng này KHÔNG dành riêng cho baseline T01-07 — đặt tên business-neutral
-- theo đúng yêu cầu, để về sau còn dùng chung cho TRANSITION_IMPORT/
-- SYSTEM_LIVE/MANUAL_IMPORT (source phân biệt qua cột `source`, không phải
-- qua tên bảng riêng cho từng loại nguồn).
--
-- ============================================================================
-- STOP-GATE: KHÔNG chạy file này trên Production hay bất kỳ project Supabase
-- nào cho tới khi có GO tường minh từ user. Môi trường hiện tại chỉ có 1
-- project Supabase cấu hình trong .env và đó CHÍNH LÀ Production (xem
-- README/báo cáo bàn giao trước) — không có project dev/local riêng để tự ý
-- thử nghiệm DDL này. File chỉ được VIẾT trong batch này, KHÔNG được THỰC
-- THI (xem PHF_CHECKLIST_RETROACTIVE_ENGINE_1.53.0.sql/PHF_CHECKLIST_
-- TEMPLATE_VERSION_IMMUTABLE_FIX_1.54.0.sql — cùng nguyên tắc STOP-GATE đã
-- áp dụng cho 2 file WIP khác trong repo).
-- ============================================================================

begin;

create extension if not exists pgcrypto;

create table if not exists public.checklist_monthly_results(
  id uuid primary key default gen_random_uuid(),

  -- Danh tính nhân sự: employee_code CHÍNH TẮC (khớp employee_profiles.employee_code,
  -- ĐÃ normalize trim+uppercase ở tầng service TRƯỚC KHI ghi — DB không tự
  -- normalize). employee_name là SNAPSHOT tại thời điểm import (hiển thị/audit
  -- nhanh không cần join) — KHÔNG phải nguồn sự thật cho tên hiện tại (đó vẫn
  -- là employee_profiles).
  employee_code text not null check(employee_code = upper(btrim(employee_code)) and employee_code <> ''),
  employee_name text not null default '',

  -- Regex '^\d{4}-\d{2}$' ĐƠN THUẦN không đủ (vd "2026-99" vẫn khớp đúng
  -- format) - checklist_monthly_periods hiện có (PHF_CHECKLIST_MONTHLY_STEP_1_
  -- 1.26.sql) mang đúng lỗ hổng này ở tầng DB, chỉ được chặn bởi tầng JS
  -- (lib/checklist-monthly.js#month(): regex '^\d{4}-(0[1-9]|1[0-2])$'). Vì
  -- đây là bảng MỚI không có ràng buộc tương thích ngược nào, xiết chặt luôn
  -- ở tầng DB (khớp đúng ngày tháng 01-12) làm lưới an toàn thứ 2, độc lập
  -- với tầng JS - phòng trường hợp có đường ghi khác (vd sửa tay/script sau
  -- này) bỏ qua lib/checklist-monthly-results.js.
  period_month text not null check(period_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),

  -- result_state: xem contract đầy đủ ở lib/checklist-monthly-results-service.js.
  -- SCORED = có điểm thật (kể cả 0). NO_ASSESSMENT/PROBATION/NO_DATA đều
  -- score=NULL — 3 lý do KHÁC NHAU cho việc không có điểm, KHÔNG được gộp
  -- lại thành cùng 1 ý nghĩa "0" hay "thiếu dữ liệu chung chung".
  result_state text not null check(result_state in ('SCORED','NO_ASSESSMENT','PROBATION','NO_DATA')),
  score numeric(7,2),
  constraint checklist_monthly_results_score_state_chk check(
    (result_state = 'SCORED' and score is not null and score >= 0 and score <= 100)
    or (result_state <> 'SCORED' and score is null)
  ),

  -- source: DO SERVER GÁN, KHÔNG BAO GIỜ đọc từ payload Excel/client. Xem
  -- ensureServerAssignedSource() trong service — mọi input.source từ caller
  -- bị bỏ qua tuyệt đối trên đường ghi.
  source text not null check(source in ('BASELINE_IMPORT','TRANSITION_IMPORT','SYSTEM_LIVE','MANUAL_IMPORT')),
  source_batch_id uuid,
  source_note text not null default '',

  created_at timestamptz not null default now(),
  created_by text not null default '',
  created_by_name text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text not null default '',
  updated_by_name text not null default '',

  -- Business key: 1 kết quả authoritative cho mỗi (nhân sự, tháng) — KHÔNG
  -- cho phép duplicate authoritative result. Khi SYSTEM_LIVE sau này trở
  -- thành nguồn chính thức thay cho bản import, đường ghi PHẢI đi qua
  -- UPDATE đúng row hiện có (giữ nguyên id, đổi source+score+audit fields),
  -- KHÔNG insert thêm row song song — xem ghi chú "future SYSTEM_LIVE
  -- override" trong service, KHÔNG implement trong batch T01-07 này.
  unique(employee_code, period_month)
);

create index if not exists checklist_monthly_results_period_idx
  on public.checklist_monthly_results(period_month);
create index if not exists checklist_monthly_results_source_batch_idx
  on public.checklist_monthly_results(source_batch_id);

alter table public.checklist_monthly_results enable row level security;
revoke all on public.checklist_monthly_results from anon,authenticated;
-- Không tạo policy cho anon/authenticated — đúng khuôn mẫu checklist_monthly_forms/
-- checklist_monthly_periods (chỉ service_role đọc/ghi qua server, RLS bật để
-- chặn truy cập trực tiếp ngoài ý muốn qua client key).

commit;
