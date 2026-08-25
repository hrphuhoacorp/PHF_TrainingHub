-- PHF Task — CATEGORY + CREATE TASK FOUNDATION 1.70.0 — DOWN / rollback.
-- KHÔNG CHẠY FILE NÀY trừ khi 1.70.0.sql đã thật sự apply lên Production
-- (project ref byhpcexmjzqpctyvfczd) và cần đảo ngược 1:1 đúng những gì
-- 1.70.0 tạo — không hơn, không kém.
--
-- Rollback này CHỈ đụng object do 1.70.0 tạo mới. KHÔNG drop:
--   - 8 RPC đang live TRƯỚC 1.70.0 (7 lifecycle + task_set_permission_assignment);
--   - task_permission_assignments/task_permission_assignment_history/cột
--     grants đã apply ở 1.69.0 — ngoài phạm vi file này;
--   - task_tasks/task_assignees/task_links/task_events/task_comments — CHỈ
--     RPC ghi vào các bảng này, KHÔNG có cột nào 1.70.0 thêm vào chúng;
--   - Checklist/KNL/Employee Master objects.
--
-- CẢNH BÁO ĐẶC BIỆT (mục 14C của yêu cầu gốc — "13 category đã được Task sử
-- dụng thì rollback data phải cực kỳ thận trọng"):
--   Nếu tại thời điểm rollback đã có Task THẬT tham chiếu bất kỳ category nào
--   trong 13 category seed, XÓA category đó sẽ vi phạm FK
--   (task_tasks.category_code references task_categories on delete restrict)
--   — Postgres sẽ tự chặn, KHÔNG cần logic thêm. Nhưng nếu bạn định soft-undo
--   (set is_active=false) thay vì DELETE, điều đó KHÔNG nằm trong rollback
--   này — đó là thao tác nghiệp vụ bình thường (Ngừng sử dụng qua UI/API),
--   không phải rollback migration.
--
-- Xác nhận trước khi chạy (đọc, không ghi):
--   select count(*) from public.task_tasks where category_code in (
--     'BAO_CAO','TAI_CHINH','KHO_VAN','NHAN_SU','KINH_DOANH','CONG_VIEC_TONG_THE',
--     'THU_MUA','CHAM_SOC_KHACH_HANG','DU_AN','PHAT_SINH_KHAC','DAO_TAO','SUA_CHUA','THANH_TOAN'
--   ); -- nếu > 0, KHÔNG chạy PHẦN 2 (xóa seed) — dừng lại, báo Business Owner.
--   select count(*) from public.task_categories where
--     created_by_account_id is not null or updated_by_account_id is not null;
--     -- phải = 0 để an toàn drop cột (nếu > 0, có Admin đã thao tác thật qua
--     -- UI/API sau khi 1.70.0 apply — KHÔNG drop cột, chỉ dừng ở đây)

begin;

-- ---------------------------------------------------------------------------
-- 1) Drop 4 RPC do 1.70.0 tạo/replace. Chữ ký đã verify khớp đúng nguồn
--    trích trong 1.70.0.sql — sai signature sẽ báo lỗi "function does not
--    exist" (an toàn, không xóa nhầm hàm khác).
-- ---------------------------------------------------------------------------
drop function if exists public.task_delete_category_if_unused(text);
drop function if exists public.task_add_link(uuid, text, text, text, text);
drop function if exists public.task_add_related(uuid, text, text);
drop function if exists public.task_create_draft(text, text, text, text, text, timestamptz, timestamptz, text, text);

-- ---------------------------------------------------------------------------
-- 2) Xóa đúng 13 category seed — CHỈ nếu KHÔNG có Task nào tham chiếu (xem
--    xác nhận ở trên). Nếu Admin đã tự thêm category KHÁC ngoài 13 category
--    này sau khi apply, KHÔNG bị đụng — chỉ xóa đúng 13 category_code liệt
--    kê tường minh dưới đây, không dùng điều kiện rộng hơn.
-- ---------------------------------------------------------------------------
delete from public.task_categories where category_code in (
  'BAO_CAO','TAI_CHINH','KHO_VAN','NHAN_SU','KINH_DOANH','CONG_VIEC_TONG_THE',
  'THU_MUA','CHAM_SOC_KHACH_HANG','DU_AN','PHAT_SINH_KHAC','DAO_TAO','SUA_CHUA','THANH_TOAN'
);
-- Postgres sẽ tự raise foreign_key_violation nếu bất kỳ category nào trong
-- danh sách đang bị task_tasks tham chiếu — đây CHÍNH LÀ hành vi mong muốn
-- (fail loud, không xóa âm thầm dữ liệu đang dùng).

-- ---------------------------------------------------------------------------
-- 3) Cột thêm vào task_categories — MẶC ĐỊNH GIỮ NGUYÊN (comment out), chỉ
--    bỏ comment sau khi xác nhận row count *_account_id đều = 0 (xem trên).
-- ---------------------------------------------------------------------------
-- alter table public.task_categories drop column if exists sort_order;
-- alter table public.task_categories drop column if exists created_by_account_id;
-- alter table public.task_categories drop column if exists created_by_employee_code;
-- alter table public.task_categories drop column if exists updated_by_account_id;
-- alter table public.task_categories drop column if exists updated_by_employee_code;

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK TRIGGER CONDITION:
--   - Post-migration verification phát hiện RPC lỗi ngoài dự kiến, hoặc
--   - Business Owner quyết định hoãn Create Task Foundation, cần đưa schema
--     về đúng trạng thái trước 1.70.0.
-- Không dùng file này cho lỗi ngoài phạm vi 1.70.0 (Permission V1/1.69.0,
-- Checklist/KNL/Employee Master không bị 1.70.0 đụng tới).
