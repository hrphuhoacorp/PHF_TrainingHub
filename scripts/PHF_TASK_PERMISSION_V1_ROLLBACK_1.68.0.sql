-- PHF Task Permission V1 — Phase 1.5 rollback package.
-- KHÔNG CHẠY FILE NÀY. Đây là rollback CHÍNH THỨC được soạn trước, chỉ dùng
-- khi migration PHF_TASK_CORE_RPC_1.67.0.sql (re-apply phần còn thiếu) và/hoặc
-- PHF_TASK_FOUNDATION_CORRECTION_1.68.0.sql đã apply thật lên Production
-- (project ref byhpcexmjzqpctyvfczd) và cần đảo ngược.
--
-- PHẠM VI: chỉ rollback đúng những gì Phase 2 migration DỰ KIẾN tạo mới.
-- TUYỆT ĐỐI KHÔNG drop 7 RPC lifecycle đang live (task_publish,
-- task_update_progress, task_complete, task_reopen, task_cancel,
-- task_change_deadline, task_transfer_primary) — các hàm này đã tồn tại
-- TRƯỚC Phase 1.5, không do migration này tạo ra, script rollback này không
-- đụng tới chúng ở bất kỳ dòng nào.
--
-- Xác nhận real DB trước khi rollback (đọc, không ghi):
--   select table_name from information_schema.tables where table_schema='public'
--     and table_name in ('task_permission_assignments','task_permission_assignment_history');
--   select routine_name from information_schema.routines where routine_schema='public'
--     and routine_name in ('task_create_draft','task_add_related','task_add_link','task_set_permission_assignment');
--
-- Thứ tự rollback tuân theo dependency ngược lại với apply order
-- (1.68.0 rồi tới phần 1.67.0 mới apply lại):

begin;

-- ---------------------------------------------------------------------------
-- 1) Drop 5 trigger normalize-actor-identity + trigger function (1.68.0).
--    Trigger phải drop trước function nó tham chiếu.
-- ---------------------------------------------------------------------------
drop trigger if exists task_tasks_normalize_creator on public.task_tasks;
drop trigger if exists task_assignees_normalize_assigner on public.task_assignees;
drop trigger if exists task_events_normalize_actor on public.task_events;
drop trigger if exists task_comments_normalize_author on public.task_comments;
drop trigger if exists task_links_normalize_adder on public.task_links;
drop function if exists public.task_normalize_actor_identity();

-- ---------------------------------------------------------------------------
-- 2) Drop RPC do Phase 2 tạo mới. task_add_link CHỈ drop nếu phiên bản đang
--    live là bản 1.68.0 (idempotency-safe) — nếu vì lý do nào đó môi trường
--    đã có một task_add_link KHÁC từ trước Phase 2 (không thuộc phạm vi audit
--    này), XÁC MINH bằng tay trước khi chạy dòng drop này.
-- ---------------------------------------------------------------------------
drop function if exists public.task_set_permission_assignment(text, text, text, text, text, text);
drop function if exists public.task_add_link(uuid, text, text, text, text);
drop function if exists public.task_create_draft(text, text, text, text, text, timestamptz, timestamptz, text, text);
drop function if exists public.task_add_related(uuid, text, text);
-- Lưu ý: chữ ký (parameter types) chính xác của task_create_draft/task_add_related
-- phải đối chiếu lại với bản đã thực sự apply trước khi chạy (xem
-- scripts/PHF_TASK_CORE_RPC_1.67.0.sql dòng 41 và 462) — DROP FUNCTION cần
-- đúng signature, sai signature sẽ báo lỗi "function does not exist" (an toàn,
-- không xóa nhầm) chứ không xóa nhầm hàm khác.

-- ---------------------------------------------------------------------------
-- 3) Drop task_permission_assignment_history TRƯỚC (FK phụ thuộc
--    task_permission_assignments), rồi mới drop task_permission_assignments.
--    CHỈ drop nếu 2 bảng này do Phase 2 tạo mới — xác nhận qua
--    information_schema.tables ở trên trước khi chạy.
-- ---------------------------------------------------------------------------
drop trigger if exists task_permission_assignment_history_forbid_update on public.task_permission_assignment_history;
drop trigger if exists task_permission_assignment_history_forbid_delete on public.task_permission_assignment_history;
drop table if exists public.task_permission_assignment_history;
drop table if exists public.task_permission_assignments;

-- ---------------------------------------------------------------------------
-- 4) Added *_account_id columns — rollback CHỈ khi thật sự cần (các cột này
--    nullable, additive, không có dữ liệu phụ thuộc tại thời điểm audit vì
--    mọi bảng Task hiện có 0 dòng trên Production — nhưng nếu Phase 2 đã có
--    dữ liệu thật ghi vào trước khi rollback, DROP COLUMN sẽ MẤT dữ liệu đó.
--    XÁC NHẬN record count = 0 trước khi bỏ comment các dòng dưới.
-- ---------------------------------------------------------------------------
-- alter table public.task_tasks drop constraint if exists task_tasks_created_by_ck;
-- alter table public.task_tasks drop column if exists created_by_account_id;
-- alter table public.task_assignees drop constraint if exists task_assignees_assigned_by_ck;
-- alter table public.task_assignees drop column if exists assigned_by_account_id;
-- alter table public.task_events drop constraint if exists task_events_actor_ck;
-- alter table public.task_events drop column if exists actor_account_id;
-- alter table public.task_comments drop constraint if exists task_comments_author_ck;
-- alter table public.task_comments drop column if exists author_account_id;
-- alter table public.task_links drop constraint if exists task_links_added_by_ck;
-- alter table public.task_links drop column if exists added_by_account_id;
-- alter table public.task_permission_grants drop constraint if exists task_permission_created_by_ck;
-- alter table public.task_permission_grants drop column if exists created_by_account_id;
-- alter table public.task_permission_grants drop column if exists updated_by_account_id;
-- alter table public.task_permission_grant_history drop constraint if exists task_permission_history_changed_by_ck;
-- alter table public.task_permission_grant_history drop column if exists changed_by_account_id;
-- alter table public.task_categories drop column if exists created_by_account_id;
-- alter table public.task_categories drop column if exists created_by_employee_code;
-- alter table public.task_categories drop column if exists updated_by_account_id;
-- alter table public.task_categories drop column if exists updated_by_employee_code;
--
-- Các dòng NOT NULL đã được nới lỏng (created_by_employee_code, v.v.) trong
-- 1.68.0 KHÔNG tự phục hồi NOT NULL ở đây — việc siết lại constraint cần xác
-- nhận riêng vì có thể fail nếu dữ liệu thật đã ghi giá trị null hợp lệ
-- (actor chỉ có account_id, không có employee_code — đúng chủ ý của 1.68.0).

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK TRIGGER CONDITION (khi nào dùng file này):
--   - Post-migration verification (xem PHF_TASK_PERMISSION_V1_PHASE_1_5
--     report, mục POST-MIGRATION VERIFY PLAN) phát hiện object sai/hỏng; hoặc
--   - task_set_permission_assignment/task_create_draft gây lỗi ngoài dự kiến
--     khi test thật; hoặc
--   - Business Owner quyết định hoãn Phase 2, cần đưa schema về đúng trạng
--     thái trước migration để tránh nhầm lẫn với các workstream khác.
-- Không dùng file này để rollback do lỗi ngoài phạm vi Phase 1.5 (vd. lỗi ở
-- Checklist/KNL/Employee Master) — các module đó không bị Phase 2 đụng tới.
