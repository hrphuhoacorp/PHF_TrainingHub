-- PHF Checklist 1.55.0 · Workstream B — Đi trễ BCC, đối soát ghi nhận từ bộ phận (bất kỳ
-- tài khoản nào có capability+scope ghi nhận lỗi — Trưởng ca CHỈ là một ví dụ, KHÔNG phải
-- điều kiện duy nhất) và Admin phê duyệt. KHÔNG có quota cưỡng chế — mọi ngưỡng tần suất (3/6/8/12 điểm theo phút,
-- 4/2/1/1 lần/tháng tham khảo) chỉ hiển thị THAM KHẢO, không có logic SQL nào ở đây tự
-- chặn/từ chối/áp điểm khác dựa trên số lần — mọi quyết định điểm cuối cùng do Admin bấm
-- "Ghi nhận" ở tầng ứng dụng (lib/checklist-late-reconciliation-service.js).
--
-- QUAN TRỌNG — CHƯA CHẠY: môi trường hiện tại chỉ có 1 Supabase project cấu hình
-- (SUPABASE_URL trong .env) và đó là project đang phục vụ Production. File này viết theo
-- đúng quy ước migration hiện có (PHF_CHECKLIST_LATE_POINTS_POLICY_1.32.26.sql,
-- PHF_CHECKLIST_VIOLATION_SAFETY_1.14.sql, PHF_CHECKLIST_RETROACTIVE_ENGINE_1.53.0.sql) và
-- đã được xác minh TĨNH (đọc kỹ, không chạy) nhưng KHÔNG được thực thi trong batch này.
--
-- Ghi chú thiết kế bắt buộc đọc trước khi chạy:
--  1) KHÔNG khôi phục lại unique constraint toàn cục theo employee_code+criterion_code+
--     occurred_date (đã bị drop có chủ ý ở PHF_CHECKLIST_VIOLATION_DUPLICATE_UNBLOCK_1.42.0.sql
--     để cho phép 2 ghi nhận độc lập thật trùng nội dung). Idempotency của import BCC dựa
--     trên request_id/import_row_key (khoá theo mã giao dịch BCC + nội dung dòng), KHÔNG
--     dựa trên employee+date — xem lib/checklist-late-reconciliation.js#buildImportRowKey.
--  2) Mọi cột mới trên checklist_violation_records đều NULLABLE — không đổi hành vi của
--     các luồng ghi nhận lỗi khác đang chạy (Ghi nhận chi tiết / Nhập nhanh / Ghi nhận nhiều
--     ngày) khi các cột này để trống. Tab "Nhập thủ công/Nhập dồn" riêng cho Đi trễ đã bị RÚT
--     LẠI khỏi UI (2026-08-15, xem assets/js/checklist/phf-checklist-app.js) để tránh rủi ro
--     ghi đúp (double-write) tiêu chí Đi trễ độc lập với pipeline đối soát BCC ở file này —
--     migration này không cần biết việc đó, chỉ ghi chú lại để không gây nhầm lẫn khi đọc lại.
--  3) Dòng ở checklist_late_bcc_import_rows là DỮ LIỆU NHÁP/STAGING — KHÔNG được
--     checklistBreakdown() (lib/checklist-monthly.js) đọc tới, nên upload không bao giờ tự
--     đổi checklist_score/Phiếu tháng. Chỉ khi Admin phê duyệt, service layer mới ghi 1 dòng
--     vào checklist_violation_records với record_status='official' — đúng lúc đó mới được
--     checklistBreakdown() tính vào.
--  4) PHASE-2/DORMANT thật sự — KHÔNG có cột nào còn lại thuộc diện này sau khi re-verify mã
--     nguồn service 2026-08-15 (đã sửa lại đánh giá ban đầu của audit trước migration này):
--       - checklist_violation_records.manager_decision: LÚC ĐẦU audit coi là dormant, nhưng
--         grep lại lib/checklist-late-reconciliation-service.js cho thấy CẢ approveLateEvents()
--         VÀ createLinkedAdjustment() đều ghi cột này (manager_decision: resolvedManagerDecision
--         / importRow.manager_decision_suggested) khi tạo bản ghi CHÍNH THỨC — KHÔNG dormant,
--         đang hoạt động thật ở phase này, không phải chỗ trống cho phase sau.
--     KHÔNG dormant (khác với đánh giá ban đầu của audit trước migration này — đã re-verify lại
--     mã nguồn service 2026-08-15): checklist_late_bcc_import_rows.standard_points/
--     suggested_points/admin_applied_points/frequency_reference_snapshot — 4 cột này ĐANG được
--     lib/checklist-late-reconciliation-service.js đọc/ghi chủ động (createBccImport ghi,
--     approveLateEvents đọc lại để tính finalPoints, isEligibleForBulkApprove đọc
--     frequency_reference_snapshot để loại dòng cần xử lý riêng khỏi duyệt hàng loạt) — KHÔNG
--     được coi là phase-2/bỏ trống, dù tên cột nghe giống các cột quota/scoring khác. Riêng
--     quota_reference_snapshot (đã GỠ khỏi checklist_violation_records ở khối dưới) mới đúng là
--     cột phase-2 thật sự duy nhất từng tồn tại trong migration này.

begin;
create extension if not exists pgcrypto;

-- ============================================================================
-- 1) Mở rộng checklist_violation_records — bổ sung định danh sự kiện đi trễ hợp nhất
--    BCC + ghi nhận từ bộ phận (bất kỳ tài khoản có quyền ghi nhận nào), trạng thái xin
--    phép, và audit quyết định Admin.
-- ============================================================================
alter table public.checklist_violation_records
  add column if not exists late_event_id uuid,
  -- manager_decision: đổi tên từ permission_status (2026-08-15) — ĐANG được ghi thật bởi
  -- approveLateEvents()/createLinkedAdjustment() (lib/checklist-late-reconciliation-service.js)
  -- khi tạo bản ghi CHÍNH THỨC, mang giá trị Duyệt/Không duyệt được gộp từ ghi nhận bộ phận
  -- hoặc do Admin tự chọn khi "Cần đối chiếu" — KHÔNG dormant (đã re-verify lại mã nguồn service
  -- 2026-08-15, sửa lại đánh giá "dormant/phase-2" ban đầu của audit trước migration này). Đổi
  -- tên trước khi có dữ liệu thật để khớp đúng ngữ nghĩa "quyết định của người quản lý duyệt/
  -- không duyệt", không còn ngữ nghĩa cũ "nhân sự có xin phép hay không".
  add column if not exists manager_decision text,
  add column if not exists bcc_identity jsonb,
  add column if not exists import_row_key text,
  add column if not exists admin_decision text,
  add column if not exists admin_decision_reason text,
  add column if not exists admin_decision_by text,
  add column if not exists admin_decision_by_name text,
  add column if not exists admin_decision_at timestamptz,
  -- Bản ghi này là 1 delta-adjustment liên kết tới 1 bản ghi CHÍNH THỨC đã có từ trước
  -- (trường hợp import lại phát hiện dữ liệu BCC đổi khác sau khi đã official) — KHÔNG
  -- BAO GIỜ sửa đè bản ghi gốc, luôn tạo dòng mới trỏ về adjustment_of_violation_id.
  add column if not exists adjustment_of_violation_id uuid references public.checklist_violation_records(id),
  -- late_minutes (Gap 2, Workstream B vòng 2): số phút trễ THẬT, cấu trúc — lấy DUY NHẤT
  -- từ cột "Phút trễ" đã validate (integer>=0) của Excel BCC hoặc checklist_late_bcc_import_rows.minutes_late,
  -- KHÔNG BAO GIỜ parse ra từ text tự do (Nhận xét/note). Đặt ở ĐÂY (bản ghi CHÍNH THỨC),
  -- không chỉ ở bảng staging checklist_late_bcc_import_rows, vì:
  --   1) Bảng staging là dữ liệu NHÁP có thể bị xoá/dọn theo vòng đời import, còn
  --      checklist_violation_records mới là nguồn số liệu chính thức tồn tại lâu dài cho
  --      Checklist/Phiếu tháng/Export — Gap 2 yêu cầu số liệu "exportable" phải bền vững
  --      độc lập với staging.
  --   2) Bản ghi delta-adjustment (create_linked_adjustment) tạo dòng MỚI trỏ về
  --      adjustment_of_violation_id — dòng mới đó cũng cần late_minutes riêng của chính nó
  --      (số phút có thể đã đổi so với bản gốc), nên phải là cột trên chính bảng này để đi
  --      theo đúng từng bản ghi immutable, không phải 1 giá trị dùng chung qua FK.
  -- NULLABLE bắt buộc: các luồng ghi nhận lỗi khác (Nhập nhanh/Ghi nhận chi tiết/Ghi nhận
  -- nhiều ngày) và mọi bản ghi CŨ trước migration này không có số liệu — UI/export PHẢI hiển
  -- thị "Không có dữ liệu" cho NULL, không suy đoán/backfill về 0.
  add column if not exists late_minutes integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'checklist_violation_manager_decision_chk'
  ) then
    alter table public.checklist_violation_records
      add constraint checklist_violation_manager_decision_chk
      check (manager_decision is null or manager_decision in ('approved','rejected','no_record'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'checklist_violation_admin_decision_chk'
  ) then
    alter table public.checklist_violation_records
      add constraint checklist_violation_admin_decision_chk
      check (admin_decision is null or admin_decision in
        ('accept_exempt','apply_no_permission_points','adjust_points','not_applied','hold_for_review'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'checklist_violation_late_minutes_chk'
  ) then
    alter table public.checklist_violation_records
      add constraint checklist_violation_late_minutes_chk
      check (late_minutes is null or late_minutes >= 0);
  end if;
end $$;

-- Non-unique — chỉ tăng tốc tra cứu "sự kiện đi trễ này đã có bản ghi chính thức chưa"
-- và join delta-adjustment; KHÔNG unique vì brief cấm khôi phục ràng buộc duy nhất theo
-- nội dung (mục 1 phía trên).
create index if not exists checklist_violation_late_event_idx
  on public.checklist_violation_records(late_event_id) where late_event_id is not null;
create index if not exists checklist_violation_import_row_key_idx
  on public.checklist_violation_records(import_row_key) where import_row_key is not null;

-- ============================================================================
-- 2) checklist_late_manager_observations — ghi nhận nhanh của BẤT KỲ tài khoản nào có
--    capability record_violation + record_scope bao phủ nhân sự được chọn (chỉ quan sát
--    trực tiếp, KHÔNG có nghĩa vụ rà BCC). Đặt tên CHUNG có chủ đích: Trưởng ca CHỈ là một
--    ví dụ minh hoạ trong tài liệu, KHÔNG phải điều kiện — người ghi nhận thật có thể là
--    Trưởng ca, Trưởng bộ phận, Trợ lý Giám đốc, Giám đốc, Admin, hay vai trò khác, hoàn
--    toàn do checklist_permission_grants (capability+scope) quyết định, không hardcode ở
--    schema hay ở tầng ứng dụng. Không tự có điểm — chỉ là input đối chiếu.
-- ============================================================================
create table if not exists public.checklist_late_manager_observations(
  id uuid primary key default gen_random_uuid(),
  employee_code text not null,
  employee_name text not null default '',
  department text not null default '',
  branch text not null default '',
  occurred_date date not null,
  -- manager_decision: đổi tên từ permission_status (2026-08-15) — ĐÂY LÀ quyết định của người
  -- ghi nhận (Duyệt/Không duyệt) về việc nhân sự có xin phép hay không, KHÔNG phải quyết định
  -- CUỐI CÙNG của Admin (đó là admin_decision ở checklist_late_bcc_import_rows/
  -- checklist_violation_records — 2 khái niệm khác nhau, không dùng lẫn tên).
  manager_decision text not null check (manager_decision in ('approved','rejected')),
  note text not null default '',
  request_id text unique, -- idempotency chống gửi lặp do mạng, cùng khuôn mẫu request_id ở checklist_violation_records
  created_by text,
  created_by_name text not null default '',
  -- recorder_role_label: TÊN PRESET QUYỀN thật của tài khoản tại thời điểm ghi nhận (vd
  -- "Trưởng ca bán hàng"/"Trưởng bộ phận"/"Trợ lý Giám đốc – Điều hành web") — CHỈ để hiển
  -- thị byline/export ("ghi nhận bởi: X (chức danh thật)"), KHÔNG dùng trong bất kỳ logic
  -- quyền/so khớp nào.
  recorder_role_label text not null default '',
  created_at timestamptz not null default now(),
  matched_late_event_id uuid, -- gán khi service đối soát BCC dùng bản ghi này làm nguồn merge
  matched_at timestamptz
);
create index if not exists checklist_late_manager_observations_employee_date_idx
  on public.checklist_late_manager_observations(employee_code, occurred_date);

alter table public.checklist_late_manager_observations enable row level security;
revoke all on public.checklist_late_manager_observations from anon, authenticated;

-- ============================================================================
-- 3) checklist_late_bcc_imports / checklist_late_bcc_import_rows — staging cho 1 lượt
--    upload BCC. KHÔNG BAO GIỜ được đọc bởi checklistBreakdown() — chỉ dùng để Admin xem
--    trước/đối soát/phê duyệt.
-- ============================================================================
create table if not exists public.checklist_late_bcc_imports(
  id uuid primary key default gen_random_uuid(),
  file_name text not null default '',
  period_start date,
  period_end date,
  uploaded_by text,
  uploaded_by_name text not null default '',
  uploaded_at timestamptz not null default now(),
  row_count integer not null default 0,
  new_count integer not null default 0,
  changed_count integer not null default 0,
  identical_count integer not null default 0,
  needs_review_count integer not null default 0,
  reconciliation_choice text, -- keep_old | update_newest | row_by_row | null (chưa chọn)
  status text not null default 'previewed' -- previewed | reconciled | closed
);

create table if not exists public.checklist_late_bcc_import_rows(
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.checklist_late_bcc_imports(id) on delete cascade,
  row_index integer not null default 0,
  employee_code text not null,
  employee_name_raw text not null default '',
  occurred_date date not null,
  shift text not null default '',
  checkin_time text not null default '',
  minutes_late integer not null default 0,
  bcc_transaction_id text not null default '',
  source text not null default 'BCC',
  bcc_identity jsonb not null default '{}'::jsonb,
  import_row_key text not null,
  matched_manager_observation_id uuid references public.checklist_late_manager_observations(id),
  -- match_status: 'unmatched_default_no_permission' | 'matched' | 'matched_agreed' (≥2 người
  -- ghi nhận cùng kết quả, đã gộp) | 'conflict_needs_review' (≥2 người ghi nhận KHÁC kết quả —
  -- Admin phải tự xem cả các input gốc rồi quyết định, không tự chọn theo thời điểm/vai trò) |
  -- 'ambiguous_needs_review' (định danh sự kiện không đủ để phân biệt, xem buildEventIdentity).
  match_status text not null default 'unmatched_default_no_permission',
  -- manager_decision_suggested: đổi tên từ permission_status_suggested (2026-08-15) —
  -- approved | rejected | no_record | 'conflict' (sentinel riêng khi
  -- match_status='conflict_needs_review' — chưa có giá trị gợi ý cho tới khi Admin tự chọn ở
  -- bước phê duyệt). 'no_record' = không có ghi nhận nào từ bộ phận (không phải giá trị
  -- approved/rejected thật).
  manager_decision_suggested text not null default 'no_record',
  -- standard_points/suggested_points/admin_applied_points/frequency_reference_snapshot
  -- (xem khối ghi chú PHASE-2 phía dưới, mục 1b) — ĐANG được service code hiện tại đọc/ghi
  -- chủ động để tính điểm áp dụng ở bước phê duyệt (approveLateEvents) — KHÔNG phải cột phase-2
  -- bỏ trống như quota_reference_snapshot đã bị gỡ khỏi checklist_violation_records.
  standard_points numeric not null default 0,
  suggested_points numeric not null default 0,
  admin_applied_points numeric,
  admin_decision text,
  admin_decision_reason text,
  admin_decision_by text,
  admin_decision_by_name text,
  admin_decision_at timestamptz,
  row_status text not null default 'pending_approval',
  -- 'pending_approval' | 'needs_review' | 'applied' | 'not_applied' | 'unchanged' | 'changed'
  linked_violation_id uuid references public.checklist_violation_records(id),
  frequency_reference_snapshot jsonb not null default '{}'::jsonb,
  -- recorders_snapshot: audit trail TỪNG người đã ghi nhận sự kiện này lúc preview/lưu import
  -- (agreed hoặc conflict) — mỗi phần tử {recordedBy,recordedByName,recorderDepartment,
  -- recorderBranch,recorderRoleLabel,permissionStatus,note,recordedAt}. Luôn giữ TỪNG input gốc,
  -- không chỉ mỗi kết quả gộp/kết luận cuối — đây là cơ sở audit cho cả 2 nhánh gộp và mâu thuẫn.
  recorders_snapshot jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Idempotency STAGING (khác hoàn toàn ràng buộc đã bị bỏ ở 1.42.0 — đây là khoá theo
-- NGUỒN GIAO DỊCH BCC, không phải theo employee+date thô, xem ghi chú đầu file mục 1):
-- cùng 1 import_row_key trong CÙNG 1 import không được lặp; giữa các import khác nhau vẫn
-- cho phép (mỗi lượt upload là 1 staging riêng, việc coi 1 dòng "đã từng thấy" được xử lý
-- ở lớp service bằng cách tra cứu import_row_key qua TẤT CẢ các import trước, không bằng
-- constraint DB).
create unique index if not exists checklist_late_bcc_import_row_unique_per_import
  on public.checklist_late_bcc_import_rows(import_id, import_row_key);
create index if not exists checklist_late_bcc_import_rows_key_idx
  on public.checklist_late_bcc_import_rows(import_row_key);
create index if not exists checklist_late_bcc_import_rows_employee_date_idx
  on public.checklist_late_bcc_import_rows(employee_code, occurred_date);

alter table public.checklist_late_bcc_imports enable row level security;
alter table public.checklist_late_bcc_import_rows enable row level security;
revoke all on public.checklist_late_bcc_imports from anon, authenticated;
revoke all on public.checklist_late_bcc_import_rows from anon, authenticated;

commit;

-- ============================================================================
-- Verification (chạy sau khi apply, KHÔNG chạy trong batch này):
-- 1) Xác nhận cột mới trên checklist_violation_records:
--    select column_name from information_schema.columns
--    where table_schema='public' and table_name='checklist_violation_records'
--      and column_name in ('late_event_id','manager_decision','bcc_identity','import_row_key',
--        'admin_decision','admin_decision_reason',
--        'admin_decision_by','admin_decision_by_name','admin_decision_at',
--        'adjustment_of_violation_id','late_minutes');
--    -> kỳ vọng đủ 11 dòng (quota_reference_snapshot đã bị gỡ khỏi migration này 2026-08-15,
--       không còn nằm trong danh sách cột kỳ vọng).
-- 2) Xác nhận uq_checklist_violation_request_id (migration 1.13) và
--    idx_checklist_violation_duplicate_fingerprint vẫn còn nguyên, KHÔNG bị đổi:
--    select indexname from pg_indexes where schemaname='public'
--      and tablename='checklist_violation_records'
--      and indexname in ('uq_checklist_violation_request_id','idx_checklist_violation_duplicate_fingerprint');
--    -> kỳ vọng đủ 2 dòng (script này không đụng tới 2 index đó).
-- 3) Xác nhận uq_checklist_violation_active_fingerprint (đã drop ở 1.42.0) VẪN vắng mặt —
--    script này không được vô tình tạo lại:
--    select indexname from pg_indexes where schemaname='public'
--      and tablename='checklist_violation_records' and indexname='uq_checklist_violation_active_fingerprint';
--    -> kỳ vọng 0 dòng.
-- 4) Xác nhận 3 bảng mới tồn tại và RLS bật, anon/authenticated không có quyền:
--    select relname, relrowsecurity from pg_class
--    where relname in ('checklist_late_manager_observations','checklist_late_bcc_imports','checklist_late_bcc_import_rows');
--    -> relrowsecurity = true cho cả 3.
-- ============================================================================

-- ROLLBACK tương ứng (chỉ chạy nếu cần lùi lại, KHÔNG chạy cùng lúc với script apply):
-- begin;
-- drop table if exists public.checklist_late_bcc_import_rows;
-- drop table if exists public.checklist_late_bcc_imports;
-- drop table if exists public.checklist_late_manager_observations;
-- alter table public.checklist_violation_records
--   drop constraint if exists checklist_violation_manager_decision_chk,
--   drop constraint if exists checklist_violation_admin_decision_chk,
--   drop constraint if exists checklist_violation_late_minutes_chk,
--   drop column if exists late_event_id,
--   drop column if exists manager_decision,
--   drop column if exists bcc_identity,
--   drop column if exists import_row_key,
--   drop column if exists admin_decision,
--   drop column if exists admin_decision_reason,
--   drop column if exists admin_decision_by,
--   drop column if exists admin_decision_by_name,
--   drop column if exists admin_decision_at,
--   drop column if exists adjustment_of_violation_id,
--   drop column if exists late_minutes;
-- commit;
