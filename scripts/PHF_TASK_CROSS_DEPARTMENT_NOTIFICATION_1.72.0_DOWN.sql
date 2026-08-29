-- PHF Task — CROSS-DEPARTMENT TASK V1 1.72.0 — DOWN / rollback.
-- KHÔNG CHẠY FILE NÀY trừ khi 1.72.0.sql đã thật sự apply lên Production
-- (project ref byhpcexmjzqpctyvfczd) và cần đảo ngược đúng những gì 1.72.0
-- tạo — không hơn, không kém.
--
-- CẢNH BÁO: source_department/target_department là dữ liệu LỊCH SỬ thật của
-- Task (snapshot tại publish) — DROP COLUMN sẽ xoá vĩnh viễn bối cảnh đó.
-- task_notifications cũng có thể đã chứa thông báo THẬT đã gửi cho quản lý.
-- Cả hai bị comment-out mặc định — giống pattern đã dùng cho task_code
-- (1.71.0) và category (1.70.0).
--
-- Rollback CHỈ đụng object do 1.72.0 tạo mới. KHÔNG drop task_tasks/
-- task_assignees và các cột/RPC do 1.70.0/1.71.0 tạo — ngoài phạm vi file này.
--
-- Xác nhận trước khi chạy (đọc, không ghi):
--   select count(*) from public.task_tasks where source_department is not null;
--     -- nếu > 0, cân nhắc kỹ trước khi bỏ comment PHẦN 3 (mất lịch sử liên
--     -- phòng ban thật)
--   select count(*) from public.task_notifications;
--     -- nếu > 0, đã có thông báo thật gửi cho quản lý — cân nhắc trước khi
--     -- bỏ comment DROP TABLE

begin;

-- ---------------------------------------------------------------------------
-- 1) Drop CẢ 2 trigger + function do 1.72.0 sở hữu HOÀN TOÀN (atomic snapshot
--    writer PHẦN 2 + immutability guard PHẦN 2B) — drop unconditional an
--    toàn (hạ tầng, không phải dữ liệu). PHẢI làm TRƯỚC bước 3 nếu có bỏ
--    comment drop cột — lý do giống hệt task_code: trigger còn treo tham
--    chiếu cột đã xoá sẽ lỗi runtime ở lần UPDATE task_tasks kế tiếp.
-- ---------------------------------------------------------------------------
drop trigger if exists task_tasks_department_snapshot_immutable on public.task_tasks;
drop function if exists public.task_forbid_department_snapshot_change();
drop trigger if exists task_tasks_department_snapshot_on_publish on public.task_tasks;
drop function if exists public.task_snapshot_department_on_publish();

-- ---------------------------------------------------------------------------
-- 2) task_notifications — MẶC ĐỊNH GIỮ NGUYÊN (comment out). Bảng này do
--    1.72.0 sở hữu hoàn toàn, không migration nào khác tham chiếu.
-- ---------------------------------------------------------------------------
-- drop table if exists public.task_notifications;

-- ---------------------------------------------------------------------------
-- 3) task_tasks department snapshot columns — MẶC ĐỊNH GIỮ NGUYÊN (comment
--    out). Guard (bước 1) đã drop ở trên nên an toàn bỏ comment mà không sợ
--    trigger treo tham chiếu cột đã xoá.
-- ---------------------------------------------------------------------------
-- alter table public.task_tasks drop column if exists source_department;
-- alter table public.task_tasks drop column if exists target_department;
-- alter table public.task_tasks drop column if exists is_cross_department;

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK TRIGGER CONDITION:
--   - Post-migration verification phát hiện lỗi ngoài dự kiến trong snapshot
--     write hoặc notification emit, hoặc
--   - Business Owner quyết định hoãn Cross-department V1 trong lúc vẫn QA.
-- Không dùng file này cho lỗi ngoài phạm vi 1.72.0 (Task Code/Idempotency
-- 1.71.0, Category/Create Foundation 1.70.0, Permission V1 1.69.0 không bị
-- 1.72.0 đụng tới).
-- ---------------------------------------------------------------------------
