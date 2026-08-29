begin;

-- PHF Task — NOTIFICATION DEDUPE HOTFIX — targeted migration 1.72.1.
-- LOCAL DESIGN PACKAGE — CHƯA APPLY PRODUCTION. Chờ Business Owner GO riêng.
--
-- BỐI CẢNH: Official Cross-Department write test (CV-2608-0003, thực hiện
-- 2026-08-22) phát hiện emitTaskNotificationSafe() luôn fail với lỗi Postgres
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification". create/publish/snapshot/manager-visibility/no-approval/
-- no-CC/task_code/idempotency/counter đều PASS — CHỈ notification insert lỗi.
--
-- ROOT CAUSE: 1.72.0 tạo PARTIAL unique index
--   task_notifications_dedupe_uq ON task_notifications(dedupe_key)
--   WHERE dedupe_key IS NOT NULL
-- nhưng api/_lib/task-notifications.js gọi
--   .upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
-- PostgREST dịch thành "ON CONFLICT (dedupe_key)" KHÔNG kèm predicate WHERE —
-- Postgres không match ON CONFLICT (col) với partial unique index trừ khi
-- predicate được lặp lại y hệt trong câu lệnh, mà PostgREST không hỗ trợ
-- truyền predicate qua tham số onConflict. Kết quả: MỌI lần insert vào
-- task_notifications đều rơi vào lỗi này, bị emitTaskNotificationSafe() nuốt
-- (đúng chủ ý "notification lỗi không rollback publish") — nên trước hotfix
-- này, PHF Task Cross-department KHÔNG BAO GIỜ tạo được notification thật,
-- dù publish/snapshot vẫn đúng.
--
-- TECHNICAL DECISION (Technical Owner chốt): đổi dedupe_key sang UNIQUE
-- THƯỜNG (không partial). KHÔNG workaround bằng select-rồi-insert hay
-- client-side dedupe (race-prone) — vẫn giữ đúng cơ chế
-- upsert+onConflict+ignoreDuplicates hiện có trong task-notifications.js,
-- CHỈ sửa schema để onConflict target khớp đúng.
--
-- AUDIT xác nhận trước khi viết file này (đọc, không ghi):
--   - task_notifications hiện có 0 rows (write test CV-2608-0003 emit fail
--     100%, không có row nào lọt qua) — KHÔNG có dữ liệu cũ dedupe_key NULL
--     cần cân nhắc khi ALTER COLUMN SET NOT NULL.
--   - Toàn bộ code path GHI vào task_notifications chỉ có đúng 1 nơi:
--     emitTaskNotification() (api/_lib/task-notifications.js dòng 100-108) —
--     dedupe_key LUÔN được set (dedupeBase + '|' + identityKey), KHÔNG có
--     nhánh nào insert row với dedupe_key NULL. NOT NULL an toàn theo đúng
--     contract hiện hành, không suy đoán.
--
-- KHÔNG đụng: snapshot columns/triggers (task_snapshot_department_on_publish,
-- task_forbid_department_snapshot_change), task_publish, task permissions,
-- task_code/idempotency (1.71.0), category (1.70.0), Task data hiện có
-- (CV-2608-0001/0002/0003) — ngoài phạm vi migration này.
--
-- KHÔNG sửa api/_lib/task-notifications.js — .upsert(...onConflict:
-- 'dedupe_key', ignoreDuplicates:true) là ĐÚNG path khi DB có unique index
-- thường; lỗi nằm ở schema, không phải ở JS.
--
-- Xác nhận trước khi apply (đọc, không ghi):
--   select count(*) from public.task_notifications where dedupe_key is null;
--     -- PHẢI = 0 trước khi chạy ALTER COLUMN SET NOT NULL bên dưới
--   select indexdef from pg_indexes where indexname = 'task_notifications_dedupe_uq';
--     -- xác nhận đang là partial index (có mệnh đề WHERE) trước hotfix

-- =============================================================================
-- GUARD — chặn migration nếu phát sinh dữ liệu ngoài dự kiến kể từ audit ở
-- trên (defense-in-depth, không tin audit thời điểm viết file mãi đúng tại
-- thời điểm apply).
-- =============================================================================
do $$
declare
  v_null_dedupe_count integer;
begin
  select count(*) into v_null_dedupe_count
    from public.task_notifications
    where dedupe_key is null;

  if v_null_dedupe_count > 0 then
    raise exception 'PHF_TASK_NOTIFICATION_DEDUPE_HOTFIX_1.72.1: % row(s) task_notifications có dedupe_key NULL — KHÔNG an toàn để ALTER COLUMN SET NOT NULL. STOP, không tự sửa dữ liệu, báo Business Owner.', v_null_dedupe_count;
  end if;
end $$;

-- =============================================================================
-- 1) Drop partial unique index cũ (1.72.0) — hạ tầng thuần túy, không phải
--    dữ liệu, drop unconditional an toàn.
-- =============================================================================
drop index if exists public.task_notifications_dedupe_uq;

-- =============================================================================
-- 2) dedupe_key NOT NULL — an toàn vì guard ở trên đã xác nhận 0 row NULL,
--    và contract ghi (emitTaskNotification) luôn set dedupe_key.
-- =============================================================================
alter table public.task_notifications
  alter column dedupe_key set not null;

-- =============================================================================
-- 3) Unique index THƯỜNG (không predicate) — CÙNG TÊN như cũ để không cần
--    đổi bất kỳ tham chiếu nào khác (chỉ có onConflict:'dedupe_key' trong
--    task-notifications.js tham chiếu theo TÊN CỘT, không theo tên index —
--    giữ tên chỉ để nhất quán/dễ audit, không phải yêu cầu kỹ thuật bắt buộc).
--    Không predicate => PostgREST "ON CONFLICT (dedupe_key)" khớp trực tiếp.
-- =============================================================================
create unique index if not exists task_notifications_dedupe_uq
  on public.task_notifications (dedupe_key);

commit;

-- ---------------------------------------------------------------------------
-- EXCLUDED FROM THIS MIGRATION (chủ đích):
--   - KHÔNG sửa api/_lib/task-notifications.js (mục Code Audit — schema fix
--     đủ, JS path đã đúng).
--   - KHÔNG re-publish/re-create CV-2608-0003 — Task này giữ nguyên trạng
--     thái published thật, snapshot thật. Notification recovery cho Task này
--     (nếu Business Owner muốn) là bước RIÊNG, THỦ CÔNG, chạy SAU khi hotfix
--     này apply — dùng lại đúng emitTaskNotificationSafe() với dedupe_key
--     deterministic (event_code|task_id|recipient), KHÔNG phải publish lại.
-- ---------------------------------------------------------------------------
