begin;

-- PHF Task — CROSS-DEPARTMENT TASK V1 (department snapshot + manager
-- notification foundation) — targeted migration 1.72.0.
-- LOCAL DESIGN PACKAGE — CHƯA APPLY PRODUCTION. Chờ Business Owner GO riêng.
--
-- Scope: (1) snapshot source/target department trên task_tasks, ghi ATOMIC
-- ngay trong transaction publish qua DB trigger (revised sau Business Owner
-- review — KHÔNG còn là JS UPDATE rời sau RPC như bản trước, xem PHẦN 2),
-- bất biến sau khi set (cùng lý do task_code phải bất biến: lịch sử không
-- được "trôi" theo HR hiện tại); (2) bảng task_notifications RIÊNG của PHF
-- Task (KHÔNG dùng chung system_notifications/checklist_notifications/
-- knl_notifications — đúng convention domain-isolation đã áp dụng nhất quán
-- cho mọi bảng Task khác), chỉ 1 event_code lượt này
-- (TASK_CROSS_DEPARTMENT_ASSIGNED) — notification CỐ Ý KHÔNG atomic với
-- publish (mục 8 đã CHỐT: notification là delivery thứ cấp, publish không
-- được rollback chỉ vì notification lỗi — xem api/_lib/task-core.js
-- applyCrossDepartmentPublishSideEffects()).
--
-- KHÔNG đụng: task_code/idempotency (1.71.0), category (1.70.0), permission
-- (1.69.0), Related/Link/Recurrence/Proposal — ngoài phạm vi lượt này.
--
-- FRESH AUDIT xác nhận trước khi viết file này:
--   - CURRENT DEPARTMENT SOURCE: bảng employee_profiles (cột department),
--     đọc qua loadCanonicalEmployeeProfiles()/loadOrgRows() — ĐÃ là canonical
--     cho Task theo đúng comment đầu api/_lib/task-employee-scope.js, không
--     đổi/không suy nguồn khác.
--   - CURRENT MANAGER SOURCE: employee_profiles.manager_employee_code —
--     ĐÃ được dùng làm quan hệ "manager_of_primary" trong
--     api/_lib/task-permissions.js (classifyTaskRelation + canViewTask,
--     MANAGER_VIEW_ACTOR_TYPES = {truong_bo_phan, truong_ca, giam_doc,
--     tro_ly_gd}) — CƠ CHẾ VIEW NÀY ĐÃ SỐNG, ĐÃ TEST, hoạt động độc lập với
--     department (không phân biệt cùng/khác phòng ban) — migration này
--     KHÔNG cần thêm bảng "department -> manager" mới, chỉ cần chọn ĐÚNG
--     người nhận notification bằng CHÍNH quan hệ đã canonical đó (không suy
--     mới, không heuristic theo title/chức danh).
--   - task_notifications/task_code_counters(dept scope)/mọi bảng trong file
--     này: xác nhận CHƯA tồn tại (0 rows information_schema trước khi viết).
--
-- Xác nhận trước khi apply (đọc, không ghi):
--   select column_name from information_schema.columns where table_name='task_tasks'
--     and column_name in ('source_department','target_department','is_cross_department');
--   select 1 from information_schema.tables where table_name='task_notifications';
--   select trigger_name from information_schema.triggers where event_object_table='task_tasks'
--     and trigger_name in ('task_tasks_department_snapshot_on_publish','task_tasks_department_snapshot_immutable');

-- =============================================================================
-- PHẦN 1 — task_tasks: department snapshot (nullable, additive-first).
--
-- is_cross_department: boolean, NULL nghĩa là "chưa xác định được" (mục 13 —
-- KHÔNG suy diễn false chỉ vì thiếu dữ liệu, NULL != false).
--
-- source_department/target_department là TEXT tự do (department hiện tại
-- KHÔNG có bảng department chuẩn hoá/id riêng trong PHF HR — xác nhận qua
-- employee_profiles.department là cột text) — snapshot lưu ĐÚNG string thật
-- tại thời điểm publish, KHÔNG tự bịa department_id.
--
-- Task cũ trước 1.72.0 (đã published từ trước, vd CV-2608-0001/0002): 3 cột
-- này NULL vĩnh viễn — KHÔNG backfill, KHÔNG suy từ department hiện tại của
-- HR (mục 10 — lịch sử phải "objectively recoverable", không đoán ngược).
-- PHẦN 2 dưới đây CHỈ fire khi Task THẬT SỰ chuyển trạng thái sang published
-- SAU khi trigger được cài — Task cũ không trải qua transition đó nữa nên
-- không bị đụng tới, tự động giữ NULL đúng như mong muốn.
-- =============================================================================
alter table public.task_tasks add column if not exists source_department text;
alter table public.task_tasks add column if not exists target_department text;
alter table public.task_tasks add column if not exists is_cross_department boolean;

-- =============================================================================
-- PHẦN 2 — ATOMIC SNAPSHOT ON PUBLISH (revised sau Business Owner review mục
-- 7 — THAY THẾ hoàn toàn cách tiếp cận cũ "JS UPDATE riêng sau khi RPC
-- publish thành công", vốn có khoảng hở atomicity thật: nếu UPDATE đó lỗi
-- (mất kết nối, network blip), Task đã published nhưng snapshot có thể
-- KHÔNG BAO GIỜ được ghi.
--
-- THIẾT KẾ MỚI: BEFORE UPDATE trigger trên chính task_tasks, tự tính và ghi
-- snapshot NGAY TRONG CÙNG transaction với BẤT KỲ statement nào chuyển
-- status sang 'published' — bao gồm cả task_publish RPC hiện tại (1.6x,
-- KHÔNG có source trong repo hiện tại — chủ đích KHÔNG sửa/không cần biết
-- nội dung RPC đó, trigger hoạt động độc lập với bất kỳ ai thực hiện UPDATE
-- trên hàng đó). Đây chính là cách đạt atomicity THẬT mà KHÔNG cần đổi
-- signature/logic của task_publish, KHÔNG risk tạo overload/route ambiguity
-- như đã gặp phải khi đổi task_create_draft ở 1.71.0.
--
-- Trigger chỉ fire khi CHUYỂN vào published (OLD.status IS DISTINCT FROM
-- 'published' AND NEW.status = 'published') — không đụng các UPDATE khác
-- (progress/complete/reopen/cancel/deadline/transfer-primary), và chỉ ghi
-- nếu snapshot CHƯA có (idempotent — an toàn nếu vì lý do nào đó có UPDATE
-- lặp lại trên cùng transition, dù task_publish hiện có row_version guard
-- nên về lý thuyết transition này chỉ xảy ra đúng 1 lần cho 1 Task).
--
-- Primary CUỐI CÙNG (mục 14): đọc trực tiếp task_assignees NGAY TRONG
-- trigger — join real-time, không có khoảng hở giữa "đọc Primary" và "ghi
-- snapshot" vì cả hai nằm trong cùng 1 transaction/statement.
--
-- So sánh department: dùng lower(btrim(...)) — so khớp case-insensitive cơ
-- bản. KHÔNG áp dụng accent-fold Unicode NFD giống hệt normalizeScopeText()
-- phía JS (Postgres cần extension unaccent, không chắc đã cài trên
-- Production) — dữ liệu department thực tế nhập qua cùng 1 UI nên format đã
-- nhất quán; đây là giới hạn nhỏ được ghi nhận công khai, KHÔNG che giấu.
-- =============================================================================
create or replace function public.task_snapshot_department_on_publish()
returns trigger as $$
declare
  v_primary_code text;
  v_primary_dept text;
  v_actor_dept text;
begin
  if NEW.status = 'published' and OLD.status is distinct from 'published'
     and NEW.source_department is null and NEW.target_department is null then

    select ta.employee_code into v_primary_code
    from public.task_assignees ta
    where ta.task_id = NEW.id and ta.role = 'primary' and ta.is_active = true
    order by ta.assigned_at desc
    limit 1;

    if v_primary_code is not null then
      select ep.department into v_primary_dept
      from public.employee_profiles ep
      where ep.employee_code = v_primary_code
      limit 1;
    end if;

    if NEW.created_by_employee_code is not null and btrim(NEW.created_by_employee_code) <> '' then
      select ep.department into v_actor_dept
      from public.employee_profiles ep
      where ep.employee_code = NEW.created_by_employee_code
      limit 1;
    end if;

    NEW.source_department := nullif(btrim(v_actor_dept), '');
    NEW.target_department := nullif(btrim(v_primary_dept), '');

    if NEW.source_department is not null and NEW.target_department is not null then
      NEW.is_cross_department := (lower(NEW.source_department) is distinct from lower(NEW.target_department));
    else
      NEW.is_cross_department := null; -- mục 13: thiếu dữ liệu 1 trong 2 bên => unknown, KHÔNG đoán
    end if;
  end if;

  return NEW;
end;
$$ language plpgsql;
revoke execute on function public.task_snapshot_department_on_publish() from public, anon, authenticated;

drop trigger if exists task_tasks_department_snapshot_on_publish on public.task_tasks;
create trigger task_tasks_department_snapshot_on_publish
  before update on public.task_tasks
  for each row
  execute function public.task_snapshot_department_on_publish();

-- =============================================================================
-- PHẦN 2B — IMMUTABILITY GUARD cho department snapshot (cùng lý do/pattern
-- task_code ở 1.71.0 PHẦN 4B): sau khi đã set (source_department/
-- target_department NOT NULL), KHÔNG được đổi giá trị — lịch sử không được
-- "trôi" theo tổ chức hiện tại (mục 4/9). Set-lần-đầu (từ NULL sang có giá
-- trị, đúng lúc PHẦN 2 fire) LUÔN được phép. is_cross_department đi kèm cùng
-- guard vì nó phái sinh trực tiếp từ 2 cột kia — không tách rời.
--
-- Thứ tự thực thi giữa 2 trigger BEFORE UPDATE trên cùng bảng KHÔNG quan
-- trọng ở đây: lần đầu OLD.source_department luôn NULL (guard chỉ raise khi
-- OLD NOT NULL) nên PHẦN 2 set giá trị mới không bao giờ bị PHẦN 2B chặn
-- nhầm, bất kể thứ tự Postgres chọn chạy trước/sau (mặc định theo tên
-- alphabet: "on_publish" chạy trước "immutable" nếu có phụ thuộc, nhưng ở
-- đây không cần vì lý do trên).
--
-- KHÔNG chặn bất kỳ cột nào khác của task_tasks — publish/progress/complete/
-- reopen/cancel/change-deadline/transfer-primary vẫn hoạt động bình thường.
-- =============================================================================
create or replace function public.task_forbid_department_snapshot_change()
returns trigger as $$
begin
  if OLD.source_department is not null and OLD.source_department is distinct from NEW.source_department then
    raise exception 'TASK_DEPARTMENT_SNAPSHOT_IMMUTABLE — không được đổi source_department sau khi đã publish (cũ: %, mới: %).', OLD.source_department, NEW.source_department
      using errcode = '22023';
  end if;
  if OLD.target_department is not null and OLD.target_department is distinct from NEW.target_department then
    raise exception 'TASK_DEPARTMENT_SNAPSHOT_IMMUTABLE — không được đổi target_department sau khi đã publish (cũ: %, mới: %).', OLD.target_department, NEW.target_department
      using errcode = '22023';
  end if;
  return NEW;
end;
$$ language plpgsql;
revoke execute on function public.task_forbid_department_snapshot_change() from public, anon, authenticated;

drop trigger if exists task_tasks_department_snapshot_immutable on public.task_tasks;
create trigger task_tasks_department_snapshot_immutable
  before update on public.task_tasks
  for each row
  execute function public.task_forbid_department_snapshot_change();

-- =============================================================================
-- PHẦN 3 — task_notifications — bảng RIÊNG của PHF Task, mirror đúng pattern
-- đã có ở scripts/PHF_KNL_NOTIFICATIONS_1.64.0.sql (dedupe qua unique index
-- trên dedupe_key + upsert ignoreDuplicates — chống duplicate khi publish
-- retry/idempotency, mục 11/CASE F). CHỈ đọc/ghi qua api/_lib/
-- task-notifications.js (service role phía Node) — KHÔNG expose RLS/anon,
-- đúng convention KNL đã dùng cho notification riêng từng domain.
--
-- event_code CHỈ có đúng 1 giá trị lượt này — TASK_CROSS_DEPARTMENT_ASSIGNED.
-- Không mở thêm event nào khác (publish thường/same-department KHÔNG sinh
-- notification — mục 12).
-- =============================================================================
create table if not exists public.task_notifications (
  id uuid primary key default gen_random_uuid(),

  recipient_account_id text,
  recipient_employee_code text,
  check (recipient_account_id is not null or recipient_employee_code is not null),

  event_code text not null check (event_code in (
    'TASK_CROSS_DEPARTMENT_ASSIGNED'
  )),

  task_id uuid references public.task_tasks(id) on delete cascade,

  title text not null check (length(btrim(title)) > 0),
  message text not null check (length(btrim(message)) > 0),
  target_path text,
  priority text not null default 'Trung bình' check (priority in ('Trung bình','Cao','Khẩn')),

  created_at timestamptz not null default now(),
  read_at timestamptz,

  dedupe_key text
);
revoke all on table public.task_notifications from public, anon, authenticated;

create unique index if not exists task_notifications_dedupe_uq
  on public.task_notifications (dedupe_key) where dedupe_key is not null;

create index if not exists task_notifications_recipient_employee_idx
  on public.task_notifications (recipient_employee_code, created_at desc);

create index if not exists task_notifications_recipient_account_idx
  on public.task_notifications (recipient_account_id, created_at desc);

create index if not exists task_notifications_task_idx
  on public.task_notifications (task_id);

comment on table public.task_notifications is
  'Thông báo nội bộ RIÊNG của PHF Task (V1: chỉ Cross-department manager notification). KHÔNG dùng chung system_notifications/checklist_notifications/knl_notifications — chỉ đọc/ghi qua api/_lib/task-notifications.js.';

commit;

-- ---------------------------------------------------------------------------
-- EXCLUDED FROM THIS MIGRATION (chủ đích):
--   - Notification bell/UI list — CHƯA build lượt này (mục 24: chỉ đủ UI để
--     chứng minh detection/tag/direction/honest state — bell là workstream
--     UI riêng, tránh phình scope/Dashboard-adjacent).
--   - Primary transfer sau publish: KHÔNG tự cập nhật lại snapshot/manager
--     notification khi transfer — mục 15 explicit "report recommendation
--     riêng, có thể là follow-up" — xem report cuối, KHÔNG implement ở đây.
--   - department chuẩn hoá (department_id/bảng department riêng) — KHÔNG có
--     trong PHF HR hiện tại, KHÔNG tự invent lượt này.
-- ---------------------------------------------------------------------------
