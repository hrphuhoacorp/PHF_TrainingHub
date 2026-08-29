-- PHF Task — TASK CODE + CREATE IDEMPOTENCY FOUNDATION 1.71.0 — DOWN / rollback.
-- KHÔNG CHẠY FILE NÀY trừ khi 1.71.0.sql đã thật sự apply lên Production
-- (project ref byhpcexmjzqpctyvfczd) và cần đảo ngược đúng những gì 1.71.0
-- tạo — không hơn, không kém.
--
-- CẢNH BÁO ĐẶC BIỆT: task_code là mã nghiệp vụ có thể ĐÃ được người dùng
-- copy/gửi qua Zalo/email/nội bộ ngay khi migration apply xong (đúng mục
-- đích thiết kế). Rollback DROP COLUMN task_code sẽ xoá vĩnh viễn dữ liệu đó
-- — KHÔNG làm mặc định. Cột bị comment-out mặc định, giống đúng pattern đã
-- dùng ở PHF_TASK_CATEGORY_CREATE_FOUNDATION_1.70.0_DOWN.sql.
--
-- Rollback này CHỈ đụng object do 1.71.0 tạo mới. KHÔNG drop:
--   - task_categories/13 category chính thức (1.70.0) — ngoài phạm vi file này;
--   - task_tasks/task_assignees/task_links/task_events/task_comments — CHỈ
--     RPC + cột do 1.71.0 thêm, KHÔNG đụng dữ liệu Task hiện hữu ngoài
--     task_code/create_idempotency_key/legacy_* nếu bạn chủ động bỏ comment;
--   - Checklist/KNL/Employee Master objects.
--
-- Xác nhận trước khi chạy (đọc, không ghi):
--   select count(*) from public.task_tasks where task_code is not null;
--     -- nếu > 0 và bạn KHÔNG chắc chắn không ai đã dùng mã này để trao đổi
--     -- thật (Zalo/email/nội bộ), DỪNG LẠI — chỉ rollback RPC signature +
--     -- allocator, GIỮ NGUYÊN cột/dữ liệu task_code (bỏ qua PHẦN 3 dưới).
--   select count(*) from public.task_code_counters;
--     -- nếu > 0, counter đã advance thật — drop bảng này là an toàn (chỉ là
--     -- con trỏ cấp phát, không phải dữ liệu nghiệp vụ), nhưng nếu bạn định
--     -- áp lại 1.71.0 sau đó, counter sẽ reset về 1 cho mỗi YYMM và CÓ THỂ
--     -- cấp trùng mã với task_code cũ còn giữ lại nếu bạn không rollback
--     -- luôn PHẦN 3 — đọc kỹ trước khi chọn nhánh rollback nào.
--   select trigger_name from information_schema.triggers where event_object_table='task_tasks'
--     and trigger_name='task_tasks_task_code_immutable'; -- xác nhận guard đang tồn tại trước khi drop

begin;

-- ---------------------------------------------------------------------------
-- 1) Khôi phục task_create_draft về đúng chữ ký 9-tham-số của 1.70.0
--    (verbatim — không chỉnh sửa gì so với PHẦN 3 của
--    PHF_TASK_CATEGORY_CREATE_FOUNDATION_1.70.0.sql).
-- ---------------------------------------------------------------------------
drop function if exists public.task_create_draft(text, text, text, text, text, timestamptz, timestamptz, text, text, uuid);

create or replace function public.task_create_draft(
  p_flow_type text,
  p_title text,
  p_content text,
  p_category_code text,
  p_priority text,
  p_start_at timestamptz,
  p_deadline timestamptz,
  p_actor_employee_code text,
  p_primary_employee_code text
) returns public.task_tasks as $$
declare
  v_task public.task_tasks;
  v_category_active boolean;
begin
  if p_deadline is null then
    raise exception 'TASK_DEADLINE_REQUIRED' using errcode = '22023';
  end if;
  if p_start_at is not null and p_start_at > p_deadline then
    raise exception 'TASK_DATE_ORDER_INVALID' using errcode = '22023';
  end if;

  select is_active into v_category_active
  from public.task_categories
  where category_code = p_category_code
  for share;
  if not found then
    raise exception 'TASK_CATEGORY_NOT_FOUND' using errcode = '22023';
  end if;
  if v_category_active is not true then
    raise exception 'TASK_CATEGORY_INACTIVE' using errcode = '22023';
  end if;

  insert into public.task_tasks(
    flow_type, status, title, content, category_code, priority,
    start_at, deadline, created_by_employee_code
  ) values (
    p_flow_type, 'draft', p_title, coalesce(p_content, ''), p_category_code,
    p_priority, p_start_at, p_deadline, p_actor_employee_code
  ) returning * into v_task;

  if coalesce(trim(p_primary_employee_code), '') <> '' then
    insert into public.task_assignees(
      task_id, employee_code, role, assigned_by_employee_code
    ) values (
      v_task.id, p_primary_employee_code, 'primary', p_actor_employee_code
    );
  end if;

  return v_task;
end;
$$ language plpgsql;

revoke execute on function public.task_create_draft(text, text, text, text, text, timestamptz, timestamptz, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Drop IMMUTABILITY GUARD trước (trigger rồi tới function nó dùng — đúng
--    thứ tự phụ thuộc). task_forbid_task_code_change() do 1.71.0 sở hữu
--    HOÀN TOÀN — không hàm/trigger nào khác trong hệ thống dùng chung tên
--    này (đã grep xác nhận), nên drop unconditional an toàn, KHÔNG cần
--    comment-out như phần dữ liệu ở bước 4. Phải làm TRƯỚC bước 4 (drop cột
--    task_code) nếu bạn có bỏ comment bước đó — nếu không, trigger sẽ còn
--    tồn tại nhưng tham chiếu 1 cột đã bị xoá, gây lỗi runtime ở lần UPDATE
--    task_tasks kế tiếp (Postgres không tự kiểm tra điều này lúc DROP COLUMN
--    vì trigger function là plpgsql text, không phải dependency tracked).
-- ---------------------------------------------------------------------------
drop trigger if exists task_tasks_task_code_immutable on public.task_tasks;
drop function if exists public.task_forbid_task_code_change();

-- ---------------------------------------------------------------------------
-- 3) Drop allocator RPC + counters table. An toàn — đây là cơ chế cấp phát
--    nội bộ, KHÔNG phải dữ liệu nghiệp vụ. Nếu định apply lại 1.71.0 sau
--    rollback, đọc cảnh báo ở đầu file trước.
-- ---------------------------------------------------------------------------
drop function if exists public.task_next_code(timestamptz);
drop table if exists public.task_code_counters;

-- ---------------------------------------------------------------------------
-- 4) task_tasks columns — MẶC ĐỊNH GIỮ NGUYÊN (comment out). Chỉ bỏ comment
--    sau khi xác nhận task_code KHÔNG có row nào đang được dùng thật để trao
--    đổi (xem xác nhận ở đầu file). Bỏ NOT NULL + UNIQUE constraint TRƯỚC khi
--    drop cột, đúng thứ tự ngược với lúc apply. Bước 2 (drop guard) ĐÃ chạy
--    ở trên rồi nên an toàn bỏ comment các dòng này mà không sợ trigger còn
--    treo tham chiếu cột đã xoá.
-- ---------------------------------------------------------------------------
-- alter table public.task_tasks drop constraint if exists task_tasks_task_code_key;
-- drop index if exists public.task_tasks_actor_idem_key_uniq;
-- alter table public.task_tasks alter column task_code drop not null;
-- alter table public.task_tasks drop column if exists task_code;
-- alter table public.task_tasks drop column if exists create_idempotency_key;
-- alter table public.task_tasks drop column if exists legacy_source;
-- alter table public.task_tasks drop column if exists legacy_task_code;

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK TRIGGER CONDITION:
--   - Post-migration verification phát hiện lỗi ngoài dự kiến trong
--     task_create_draft V2 (vd. replay detection sai actor scope), hoặc
--   - Business Owner quyết định hoãn Task Code/Idempotency, cần đưa RPC về
--     đúng chữ ký 1.70.0 trong lúc vẫn đang QA.
-- Không dùng file này cho lỗi ngoài phạm vi 1.71.0 (Category/Create
-- Foundation 1.70.0, Permission V1 1.69.0 không bị 1.71.0 đụng tới).
-- ---------------------------------------------------------------------------
