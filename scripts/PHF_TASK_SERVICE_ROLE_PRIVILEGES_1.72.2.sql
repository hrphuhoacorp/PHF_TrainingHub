-- #############################################################################
-- PHF TASK — SERVICE_ROLE TABLE PRIVILEGES PATCH — 1.72.2
-- Mục tiêu: Supabase project "PHF-HR-DEV" (project ref bắt đầu bằng pxkjva...)
-- TUYỆT ĐỐI KHÔNG chạy trên Supabase project Production
-- (project ref bắt đầu bằng byhpce...).
--
-- BỐI CẢNH: Bundle V2 (BAN_GIAO_PHF_TASK_DEV_STAGING_BUNDLE_V2_2026-08-23.sql)
-- đã apply DEV thành công — 12 bảng task_*, 13 RPC với EXECUTE đã cấp cho
-- service_role. NHƯNG test thật qua phf-hr-api (TASK-SERVER-02D) phát hiện
-- lỗi 403 khi service_role đọc task_categories/task_tasks/task_notifications/
-- task_code_counters/task_permission_assignments — Postgres trả về CHÍNH XÁC:
--   code 42501, message "permission denied for table X",
--   hint "GRANT SELECT ON public.X TO service_role;"
-- Đối chứng: employee_profiles/user_accounts (cùng key, cùng project) đọc
-- 200 OK bình thường — xác nhận đây KHÔNG phải lỗi cấu hình chung, mà do 8
-- bước migration V1/V2 chỉ REVOKE ALL khỏi anon/authenticated cho các bảng
-- task_*, KHÔNG hề GRANT bất kỳ verb nào cho service_role. Bảng (khác hàm)
-- trong Postgres mặc định KHÔNG cấp quyền cho ai ngoài owner khi tạo mới.
--
-- PATCH NÀY: chỉ GRANT/REVOKE privilege bảng liên quan task_* — KHÔNG
-- CREATE/DROP TABLE, KHÔNG sửa dữ liệu, KHÔNG đổi business logic, KHÔNG đụng
-- employee_profiles/user_accounts, KHÔNG GRANT ALL tổng quát ở bất kỳ đâu.
--
-- NGUỒN MA TRẬN QUYỀN: audit trực tiếp toàn bộ api/_lib/task-core.js,
-- task-permissions.js, task-notifications.js (mọi lệnh .from(...).select/
-- insert/update/delete) + đọc lại FULL source 13 RPC trong
-- scripts/PHF_TASK_CORE_RPC_1.67.0.sql, PHF_TASK_PERMISSION_V1_TARGETED_1.69.0.sql,
-- PHF_TASK_CATEGORY_CREATE_FOUNDATION_1.70.0.sql, PHF_TASK_CODE_IDEMPOTENCY_1.71.0.sql
-- (vì KHÔNG function nào SECURITY DEFINER, service_role cần table privilege
-- thật cho MỌI bảng RPC chạm tới, kể cả gọi lồng như task_next_code() bên
-- trong task_create_draft()). Chỉ cấp verb có bằng chứng code thật sử dụng —
-- không cấp vì "có thể cần sau này".
-- #############################################################################

-- =============================================================================
-- PREFLIGHT GUARD
-- =============================================================================
do $$
declare
  v_task_tables integer;
  v_missing_tables text;
begin
  select count(*) into v_task_tables
  from information_schema.tables
  where table_schema = 'public' and table_name like 'task\_%' escape '\';

  if v_task_tables <> 12 then
    raise exception 'PREFLIGHT GUARD FAILED: kỳ vọng đúng 12 bảng task_* đã tồn tại (từ bundle V2 đã apply trước đó), thực tế tìm thấy %. Patch này CHỈ dành cho môi trường ĐÃ có đủ schema Task (V2 đã chạy) — KHÔNG phải môi trường sạch. DỪNG NGAY.', v_task_tables;
  end if;

  select string_agg(t, ', ') into v_missing_tables
  from unnest(array[
    'task_tasks','task_categories','task_assignees','task_events','task_comments',
    'task_links','task_permission_grants','task_permission_grant_history',
    'task_permission_assignments','task_permission_assignment_history',
    'task_code_counters','task_notifications'
  ]) as t
  where not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = t
  );

  if v_missing_tables is not null then
    raise exception 'PREFLIGHT GUARD FAILED: thiếu bảng cụ thể: %. DỪNG NGAY.', v_missing_tables;
  end if;

  raise notice 'PREFLIGHT GUARD PASSED — đủ 12 bảng task_*, tiếp tục patch quyền.';
end $$;

begin;

-- =============================================================================
-- 1) task_tasks — SELECT, INSERT, UPDATE. KHÔNG DELETE (0 code path — xem
--    header). Đã có RLS bật + revoke anon/authenticated từ 1.66.0, không đổi.
-- =============================================================================
grant select, insert, update on table public.task_tasks to service_role;

-- =============================================================================
-- 2) task_categories — đủ 4 verb, mỗi verb có bằng chứng code riêng (không
--    phải GRANT ALL mặc định — xem WHY REQUIRED trong ma trận bàn giao).
-- =============================================================================
grant select, insert, update, delete on table public.task_categories to service_role;

-- =============================================================================
-- 3) task_assignees — SELECT, INSERT, UPDATE. KHÔNG DELETE (soft-deactivate
--    qua is_active=false, không có DELETE thật ở bất kỳ đâu).
-- =============================================================================
grant select, insert, update on table public.task_assignees to service_role;

-- =============================================================================
-- 4) task_events — APPEND-ONLY thật sự: SELECT, INSERT. KHÔNG UPDATE/DELETE —
--    khớp với trigger task_forbid_update_delete đã khoá ở tầng DB; patch này
--    không mở lại ở tầng quyền những gì trigger đang chặn ở tầng logic.
-- =============================================================================
grant select, insert on table public.task_events to service_role;

-- =============================================================================
-- 5) task_comments — SELECT, INSERT. Không có tính năng sửa/xoá comment
--    trong code hiện tại — không cấp UPDATE/DELETE suy đoán.
-- =============================================================================
grant select, insert on table public.task_comments to service_role;

-- =============================================================================
-- 6) task_links — SELECT, INSERT, UPDATE. UPDATE bắt buộc vì task_add_link
--    tự ghi lại related_event_id ngay sau khi insert (PHF_TASK_CORE_RPC_1.67.0.sql
--    dòng 597/614) — bỏ sót verb này sẽ khiến add_link fail y hệt kiểu lỗi
--    đã gặp. KHÔNG DELETE — removeTaskLink() đã xác nhận chỉ SELECT + insert
--    event 'remove', không hề xoá row vật lý.
-- =============================================================================
grant select, insert, update on table public.task_links to service_role;

-- =============================================================================
-- 7) task_permission_grants — SELECT, INSERT, UPDATE (revoke = soft qua
--    is_active=false). KHÔNG DELETE.
-- =============================================================================
grant select, insert, update on table public.task_permission_grants to service_role;

-- =============================================================================
-- 8) task_permission_grant_history — APPEND-ONLY, CHỈ INSERT. Không cấp
--    SELECT dù có thể hữu ích cho 1 màn hình audit tương lai — hiện KHÔNG có
--    code nào đọc lại bảng này (đã grep xác nhận), nên không cấp.
-- =============================================================================
grant insert on table public.task_permission_grant_history to service_role;

-- =============================================================================
-- 9) task_permission_assignments — SELECT (đọc trực tiếp), INSERT + UPDATE
--    (bên trong RPC task_set_permission_assignment: deactivate cũ + insert
--    mới). KHÔNG DELETE.
-- =============================================================================
grant select, insert, update on table public.task_permission_assignments to service_role;

-- =============================================================================
-- 10) task_permission_assignment_history — APPEND-ONLY, CHỈ INSERT (ghi từ
--     bên trong RPC). Trigger task_forbid_update_delete đã khoá UPDATE/DELETE
--     ở tầng DB — không cấp lại ở tầng quyền.
-- =============================================================================
grant insert on table public.task_permission_assignment_history to service_role;

-- =============================================================================
-- 11) task_code_counters — SELECT, INSERT, UPDATE. Sửa lại sau audit thứ 2
--     (ChatGPT phát hiện): task_next_code() dùng
--       INSERT ... ON CONFLICT (scope_key) DO UPDATE
--         SET next_value = task_code_counters.next_value + 1, updated_at = now()
--       RETURNING next_value - 1 INTO v_seq;
--     Vế "SET next_value = task_code_counters.next_value + 1" ĐỌC giá trị cột
--     hiện có của chính bảng để tính giá trị mới — đây là tham chiếu cột
--     trong biểu thức SET của UPDATE (kể cả khi UPDATE đó nằm trong ON
--     CONFLICT), và theo mô hình quyền cột-cấp của Postgres, việc này đòi
--     hỏi SELECT trên cột đó — KHÁC với việc dò xung đột (chỉ dùng unique
--     index, không cần SELECT). Bản trước gộp nhầm 2 việc này làm một, dẫn
--     tới thiếu SELECT. KHÔNG cấp DELETE — không có code path nào xoá dòng
--     counter.
-- =============================================================================
grant select, insert, update on table public.task_code_counters to service_role;

-- =============================================================================
-- 12) task_notifications — SELECT, INSERT, UPDATE (list / emit-upsert /
--     mark-read). KHÔNG DELETE — chưa có tính năng xoá thông báo. RLS đang
--     tắt CHỦ Ý (chỉ service_role truy cập) — patch này KHÔNG lấy việc RLS
--     tắt làm lý do cấp quyền rộng hơn cần thiết; verb vẫn giới hạn đúng theo
--     code thật trong api/_lib/task-notifications.js.
-- =============================================================================
grant select, insert, update on table public.task_notifications to service_role;

-- =============================================================================
-- KHÔNG grant thêm cho anon/authenticated/PUBLIC ở bất kỳ dòng nào trên —
-- giữ nguyên trạng thái "0 quyền" đã thiết lập từ V1/V2. Không cần REVOKE lại
-- vì V1/V2 đã REVOKE ALL cho 2 role này trên toàn bộ 12 bảng, patch này không
-- làm gì có thể vô tình cấp lại cho anon/authenticated (chỉ GRANT ... TO
-- service_role, không có GRANT nào target role khác).
-- =============================================================================

commit;

-- #############################################################################
-- POST-PATCH VERIFICATION (read-only) — đối chiếu trực tiếp với TABLE
-- PRIVILEGE MATRIX trong tài liệu bàn giao. Mỗi dòng kỳ vọng khớp CHÍNH XÁC
-- true/false theo bảng dưới (không phải "càng nhiều true càng an toàn").
-- #############################################################################

-- 1) Ma trận quyền service_role trên 12 bảng task_* — SO SÁNH TỪNG Ô với
--    bảng kỳ vọng bên dưới, KHÔNG chỉ nhìn có/không:
--
--    table                                 | select | insert | update | delete
--    task_tasks                            | true   | true   | true   | false
--    task_categories                       | true   | true   | true   | true
--    task_assignees                        | true   | true   | true   | false
--    task_events                           | true   | true   | false  | false
--    task_comments                         | true   | true   | false  | false
--    task_links                            | true   | true   | true   | false
--    task_permission_grants                | true   | true   | true   | false
--    task_permission_grant_history         | false  | true   | false  | false
--    task_permission_assignments           | true   | true   | true   | false
--    task_permission_assignment_history    | false  | true   | false  | false
--    task_code_counters                    | true   | true   | true   | false
--    task_notifications                    | true   | true   | true   | false
select
  c.relname as table_name,
  has_table_privilege('service_role', c.oid, 'SELECT') as can_select,
  has_table_privilege('service_role', c.oid, 'INSERT') as can_insert,
  has_table_privilege('service_role', c.oid, 'UPDATE') as can_update,
  has_table_privilege('service_role', c.oid, 'DELETE') as can_delete
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname like 'task\_%' escape '\' and c.relkind = 'r'
order by c.relname;

-- 2a) PUBLIC KHÔNG có bất kỳ quyền trực tiếp nào — kiểm bằng catalog ACL thật
--     (aclexplode trên pg_class.relacl), KHÔNG dùng has_table_privilege('public',
--     ...): PUBLIC là pseudo-role của Postgres (không phải role/user thông
--     thường), an toàn hơn khi đọc thẳng ACL thay vì qua hàm nhận chuỗi tên
--     role làm tham số. Trong biểu diễn ACL của Postgres, grantee = 0 CHÍNH
--     LÀ PUBLIC (quy ước chuẩn, không phải suy đoán). Dùng acldefault('r', ...)
--     làm fallback khi relacl IS NULL (bảng chưa từng có GRANT/REVOKE tường
--     minh nào — trường hợp đó mặc định KHÔNG ai ngoài owner có quyền, tức
--     PUBLIC cũng phải false, không phải "không xác định").
--     Kỳ vọng: CẢ 4 cột = false cho TOÀN BỘ 12 bảng.
select
  c.relname as table_name,
  coalesce(bool_or(a.grantee = 0 and a.privilege_type = 'SELECT'), false) as public_select,
  coalesce(bool_or(a.grantee = 0 and a.privilege_type = 'INSERT'), false) as public_insert,
  coalesce(bool_or(a.grantee = 0 and a.privilege_type = 'UPDATE'), false) as public_update,
  coalesce(bool_or(a.grantee = 0 and a.privilege_type = 'DELETE'), false) as public_delete
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a on true
where n.nspname = 'public' and c.relname like 'task\_%' escape '\' and c.relkind = 'r'
group by c.relname
order by c.relname;

-- 2b) anon / authenticated KHÔNG có bất kỳ quyền trực tiếp nào — kiểm bằng
--     has_table_privilege (đây LÀ role thật trong Postgres/Supabase, không
--     phải pseudo-role, nên has_table_privilege dùng đúng chỗ, không đổi
--     cách kiểm theo yêu cầu). Kỳ vọng: CẢ 8 cột = false cho TOÀN BỘ 12 bảng.
select
  c.relname as table_name,
  has_table_privilege('anon', c.oid, 'SELECT')    as anon_select,
  has_table_privilege('anon', c.oid, 'INSERT')    as anon_insert,
  has_table_privilege('anon', c.oid, 'UPDATE')    as anon_update,
  has_table_privilege('anon', c.oid, 'DELETE')    as anon_delete,
  has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select,
  has_table_privilege('authenticated', c.oid, 'INSERT') as authenticated_insert,
  has_table_privilege('authenticated', c.oid, 'UPDATE') as authenticated_update,
  has_table_privilege('authenticated', c.oid, 'DELETE') as authenticated_delete
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname like 'task\_%' escape '\' and c.relkind = 'r'
order by c.relname;

-- 3) Xác nhận employee_profiles/user_accounts KHÔNG bị patch này đụng tới —
--    kỳ vọng: privilege của service_role trên 2 bảng này giữ nguyên như
--    trước patch (đã xác nhận SELECT hoạt động qua test 02D trước đó).
select
  c.relname as table_name,
  has_table_privilege('service_role', c.oid, 'SELECT') as can_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('employee_profiles', 'user_accounts') and c.relkind = 'r'
order by c.relname;

-- #############################################################################
-- Nếu mục 1 khớp 100% bảng kỳ vọng, mục 2a (PUBLIC qua ACL) toàn bộ 4 cột
-- false trên cả 12 bảng, mục 2b (anon/authenticated qua has_table_privilege)
-- toàn bộ 8 cột false trên cả 12 bảng, mục 3 vẫn true:
--   TABLE PRIVILEGE PATCH PASS.
-- Nếu lệch bất kỳ ô nào: DỪNG, chụp lại kết quả, KHÔNG tự sửa, báo lại.
-- #############################################################################
