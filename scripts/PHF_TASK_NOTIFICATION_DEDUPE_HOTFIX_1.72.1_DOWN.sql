-- PHF Task — NOTIFICATION DEDUPE HOTFIX 1.72.1 — DOWN / rollback.
-- KHÔNG CHẠY FILE NÀY trừ khi 1.72.1.sql đã thật sự apply lên Production
-- (project ref byhpcexmjzqpctyvfczd) và cần đảo ngược đúng những gì 1.72.1
-- tạo — không hơn, không kém.
--
-- CẢNH BÁO: sau khi 1.72.1 apply, task_notifications có thể đã chứa
-- notification THẬT (dedupe_key non-null theo đúng contract cũ lẫn mới) —
-- rollback về partial unique index KHÔNG xoá row nào, nhưng ALTER COLUMN DROP
-- NOT NULL + tái tạo partial index sẽ đưa constraint layer về đúng trạng thái
-- 1.72.0 (kém an toàn hơn, đã biết gây lỗi ON CONFLICT). Chỉ chạy khi thật sự
-- cần đảo ngược riêng phần constraint này (ví dụ phát hiện vấn đề mới của
-- chính 1.72.1), KHÔNG dùng để "dọn" sau khi phát hiện lỗi KHÁC ngoài phạm
-- vi migration này.
--
-- Rollback CHỈ đụng đúng 3 thay đổi 1.72.1 tạo (drop partial index cũ, set
-- NOT NULL, tạo unique index thường). KHÔNG đụng bảng task_notifications
-- (tạo bởi 1.72.0), KHÔNG đụng task_tasks/snapshot columns/trigger, KHÔNG
-- đụng task_code/idempotency/permission/category.
--
-- Xác nhận trước khi chạy (đọc, không ghi):
--   select indexdef from pg_indexes where indexname = 'task_notifications_dedupe_uq';
--     -- xác nhận đang là REGULAR unique index (không WHERE) trước khi rollback
--   select count(*) from public.task_notifications;
--     -- nếu > 0, đã có notification thật ghi được nhờ 1.72.1 — cân nhắc kỹ
--     -- trước khi rollback (không mất row nào, nhưng quay lại trạng thái
--     -- known-broken cho MỌI insert kế tiếp)

begin;

-- ---------------------------------------------------------------------------
-- 1) Drop unique index thường (1.72.1) — hạ tầng thuần túy.
-- ---------------------------------------------------------------------------
drop index if exists public.task_notifications_dedupe_uq;

-- ---------------------------------------------------------------------------
-- 2) dedupe_key trở lại nullable — khôi phục đúng định nghĩa cột nguyên bản
--    1.72.0 (text, không NOT NULL). Không mất dữ liệu (DROP NOT NULL không
--    xoá giá trị hiện có, chỉ bỏ ràng buộc).
-- ---------------------------------------------------------------------------
alter table public.task_notifications
  alter column dedupe_key drop not null;

-- ---------------------------------------------------------------------------
-- 3) Tái tạo PARTIAL unique index nguyên bản 1.72.0 — CẢNH BÁO: đây chính là
--    cấu hình đã gây lỗi ON CONFLICT ban đầu. Chỉ hợp lý nếu rollback để điều
--    tra vấn đề MỚI của riêng 1.72.1, không phải để "quay về ổn định".
-- ---------------------------------------------------------------------------
create unique index if not exists task_notifications_dedupe_uq
  on public.task_notifications (dedupe_key) where dedupe_key is not null;

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK TRIGGER CONDITION:
--   - Post-hotfix verification phát hiện lỗi MỚI do chính 1.72.1 gây ra
--     (ví dụ NOT NULL chặn một code path ghi hợp lệ chưa được audit), hoặc
--   - Business Owner quyết định hoãn notification feature hoàn toàn.
-- Không dùng file này cho lỗi ngoài phạm vi 1.72.1 (Cross-department V1
-- 1.72.0, Task Code/Idempotency 1.71.0, Category 1.70.0, Permission 1.69.0
-- không bị 1.72.1 đụng tới).
-- ---------------------------------------------------------------------------
