-- PHF Task Permission V1 — TARGETED migration 1.69.0 (SCOPE-CORRECTED) — DOWN.
-- KHÔNG CHẠY FILE NÀY trừ khi PHF_TASK_PERMISSION_V1_TARGETED_1.69.0.sql đã
-- thật sự apply lên Production (project ref byhpcexmjzqpctyvfczd) và cần
-- đảo ngược 1:1 đúng những gì 1.69.0 (bản scope-corrected) tạo — không hơn,
-- không kém.
--
-- Rollback này CHỈ đụng object do 1.69.0 tạo mới. KHÔNG drop:
--   - 7 RPC lifecycle đang live TRƯỚC 1.69.0 (task_publish, task_update_progress,
--     task_complete, task_reopen, task_cancel, task_change_deadline,
--     task_transfer_primary);
--   - task_create_draft — 1.69.0 (bản scope-corrected) KHÔNG tạo RPC này,
--     nên DOWN cũng không đụng tới nó ở bất kỳ trạng thái nào (dù nó tồn tại
--     hay không tồn tại trên DB, đó là ngoài phạm vi migration này);
--   - 8 bảng Task core đã tồn tại trước 1.69.0 (task_tasks, task_assignees,
--     task_events, task_comments, task_links, task_categories,
--     task_permission_grants, task_permission_grant_history — CHỈ rollback
--     phần CỘT/CONSTRAINT mà 1.69.0 thêm vào 2 bảng grants/grant_history,
--     không drop chính 2 bảng này);
--   - task_categories — 1.69.0 không đụng Category ở bất kỳ hình thức nào
--     (không cột, không seed, không RPC) — DOWN cũng vậy;
--   - task_forbid_update_delete() — xem PHẦN 0 rollback bên dưới để biết vì
--     sao hàm này KHÔNG được drop dù 1.69.0 có (re)create nó;
--   - Employee Master / Checklist / KNL objects — 1.69.0 không đụng tới.
--
-- Xác nhận trước khi chạy (đọc, không ghi):
--   select count(*) from public.task_permission_assignments; -- phải = 0 nếu
--     chưa từng ghi dữ liệu thật sau 1.69.0, an toàn để drop bảng
--   select count(*) from public.task_permission_grants where
--     created_by_account_id is not null or updated_by_account_id is not null;
--     -- phải = 0 để an toàn drop cột (nếu > 0, KHÔNG drop cột, chỉ dừng ở
--     -- bước rollback trước đó và báo lại)

begin;

-- ---------------------------------------------------------------------------
-- 1) Drop RPC task_set_permission_assignment (do 1.69.0 tạo/replace).
-- ---------------------------------------------------------------------------
drop function if exists public.task_set_permission_assignment(text, text, text, text, text, text);

-- ---------------------------------------------------------------------------
-- 2) Drop task_permission_assignment_history TRƯỚC (FK phụ thuộc
--    task_permission_assignments), rồi mới drop task_permission_assignments.
--    XÁC NHẬN row count = 0 ở cả 2 bảng trước khi bỏ comment (drop table sẽ
--    mất dữ liệu vĩnh viễn nếu đã có dòng thật).
-- ---------------------------------------------------------------------------
drop trigger if exists task_permission_assignment_history_forbid_update on public.task_permission_assignment_history;
drop trigger if exists task_permission_assignment_history_forbid_delete on public.task_permission_assignment_history;
drop table if exists public.task_permission_assignment_history;
drop table if exists public.task_permission_assignments;

-- ---------------------------------------------------------------------------
-- 0) task_forbid_update_delete() — KHÔNG DROP.
--    1.69.0 dùng "create or replace" để migration tự-contained, KHÔNG phải vì
--    hàm này "thuộc về" 1.69.0. Bằng chứng: task_events và task_comments
--    (cả 2 confirmed EXISTS trên Production TRƯỚC 1.69.0, từ
--    PHF_TASK_FOUNDATION_1.66.0.sql) có trigger forbid-update/forbid-delete
--    tham chiếu ĐÚNG hàm này — được tạo trong CÙNG transaction 1.66.0, nghĩa
--    là hàm này gần như chắc chắn đã tồn tại từ trước 1.69.0 rất lâu. Drop nó
--    ở đây sẽ làm hỏng 2 trigger append-only đang bảo vệ task_events/
--    task_comments — hoàn toàn ngoài phạm vi rollback của migration này.
--    Nếu thật sự cần gỡ định nghĩa lại (revert business behavior), đó là
--    thay đổi tách biệt, không thuộc 1.69.0_DOWN.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3) Cột + constraint thêm vào task_permission_grants / grant_history.
--    MẶC ĐỊNH GIỮ NGUYÊN (comment out) — chỉ bỏ comment sau khi xác nhận
--    row count created_by_account_id/updated_by_account_id/
--    changed_by_account_id đều = 0 (nghĩa là chưa có Admin nào thật sự tạo/
--    thu hồi grant sau khi 1.69.0 apply). Nếu đã có dữ liệu thật, DROP COLUMN
--    sẽ xóa vĩnh viễn — KHÔNG chạy nếu chưa có explicit GO + xác nhận 0 dòng.
--
--    Phục hồi NOT NULL trên *_employee_code CHỈ an toàn nếu MỌI dòng hiện
--    hữu đều có employee_code khác null (tức là không có dòng nào do Admin
--    tạo/thu hồi thuần account_id) — kiểm tra bằng:
--      select count(*) from public.task_permission_grants where created_by_employee_code is null;
--      select count(*) from public.task_permission_grant_history where changed_by_employee_code is null;
--    Cả 2 phải = 0 trước khi bỏ comment các dòng "alter column ... set not null".
-- ---------------------------------------------------------------------------
-- alter table public.task_permission_grants drop constraint if exists task_permission_created_by_ck;
-- alter table public.task_permission_grants alter column created_by_employee_code set not null;
-- alter table public.task_permission_grants drop column if exists created_by_account_id;
-- alter table public.task_permission_grants drop column if exists updated_by_account_id;
-- alter table public.task_permission_grant_history drop constraint if exists task_permission_history_changed_by_ck;
-- alter table public.task_permission_grant_history alter column changed_by_employee_code set not null;
-- alter table public.task_permission_grant_history drop column if exists changed_by_account_id;

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK TRIGGER CONDITION:
--   - Post-migration verification phát hiện object sai hình dạng hoặc RPC lỗi
--     ngoài dự kiến; hoặc
--   - Business Owner quyết định hoãn Permission V1, cần đưa schema về đúng
--     trạng thái trước 1.69.0.
-- Không dùng file này cho lỗi ngoài phạm vi 1.69.0 (Category/Create Task là
-- workstream riêng, không bị 1.69.0 đụng tới nên không cần rollback qua đây;
-- Checklist/KNL/Employee Master cũng vậy).
