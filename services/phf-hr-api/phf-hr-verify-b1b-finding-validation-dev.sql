-- =============================================================================
-- PHF HR — B1b: Finding A (encoding) + Finding B (data classification) validation
-- READ-ONLY TUYỆT ĐỐI. Không có statement ghi nào trong file này.
--
-- Chạy: cat phf-hr-verify-b1b-finding-validation-dev.sql | docker exec -i phf-postgres psql -U postgres -d phf_hr
-- =============================================================================

-- -----------------------------------------------------------------------------
-- MỤC TIÊU 1 — Finding A, byte-level, KHÔNG gõ ký tự tiếng Việt trong câu query
-- (tránh chính terminal/truyền tải làm sai lệch kết quả) — dùng octet_length
-- vs char_length + hex dump để chẩn đoán khách quan.
-- -----------------------------------------------------------------------------
select '=== A1: client/server encoding của session này ===' as section;
select current_setting('client_encoding') as client_encoding,
       current_setting('server_encoding') as server_encoding;

select '=== A2: default value — raw, octet_length, char_length, hex ===' as section;
select
  pg_get_expr(d.adbin, d.adrelid) as raw_default_expr,
  octet_length(pg_get_expr(d.adbin, d.adrelid)) as octet_len,
  char_length(pg_get_expr(d.adbin, d.adrelid)) as char_len,
  encode(convert_to(pg_get_expr(d.adbin, d.adrelid), 'UTF8'), 'hex') as utf8_hex
from pg_attrdef d
join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
join pg_class c on c.oid = d.adrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'task' and c.relname = 'notifications' and a.attname = 'priority';

select '=== A3: CHECK constraint definition — raw + hex ===' as section;
select
  conname,
  pg_get_constraintdef(oid) as raw_constraintdef,
  octet_length(pg_get_constraintdef(oid)) as octet_len,
  char_length(pg_get_constraintdef(oid)) as char_len,
  encode(convert_to(pg_get_constraintdef(oid), 'UTF8'), 'hex') as utf8_hex
from pg_constraint
where conname = 'notifications_priority_check';

-- Diễn giải: nếu octet_len = char_len + (số ký tự có dấu thật), đây LÀ UTF-8 hợp lệ.
-- Nếu octet_len lệch nhiều hơn hẳn (mỗi ký tự có dấu chiếm 2-3 byte thừa thay vì 1),
-- đây LÀ mojibake double-encode. Chuỗi UTF-8 hex của "ì" đúng chuẩn = C3AC (2 byte).
-- Nếu thấy hex chứa "C383C2AC" (4 byte) thay vì "C3AC" tại đúng vị trí đó — xác nhận
-- double-encoding thật (KHÔNG phải suy đoán, đọc trực tiếp hex).

-- -----------------------------------------------------------------------------
-- MỤC TIÊU 2 — Inventory 10 task, trace toàn bộ bảng liên quan
-- -----------------------------------------------------------------------------
select '=== B1: 10 tasks — full detail ===' as section;
select id, task_code, title, status, flow_type, category_code,
       created_by_employee_code, created_by_account_id, created_at,
       legacy_source, legacy_task_code, create_idempotency_key
from task.tasks
order by created_at;

select '=== B2: assignees per task ===' as section;
select task_id, employee_code, role, is_active, assigned_by_employee_code, assigned_by_account_id, assigned_at
from task.assignees
order by task_id, assigned_at;

select '=== B3: events per task (type + actor + occurred_at, không cần full payload) ===' as section;
select task_id, event_type, actor_employee_code, actor_account_id, occurred_at,
       payload->>'action' as payload_action
from task.events
order by task_id, occurred_at;

select '=== B4: comments ===' as section;
select task_id, author_employee_code, author_account_id, created_at, left(body, 80) as body_preview
from task.comments
order by task_id, created_at;

select '=== B5: links ===' as section;
select task_id, side, url, label, added_by_employee_code, added_by_account_id, created_at
from task.links
order by task_id, created_at;

select '=== B6: attachments ===' as section;
select task_id, original_filename, uploaded_by_employee_code, status, created_at
from task.attachments
order by task_id, created_at;

-- -----------------------------------------------------------------------------
-- MỤC TIÊU 2b — Inventory 16 categories, xác định 3 category dư so với 13 baseline
-- -----------------------------------------------------------------------------
select '=== C1: full 16 category list ===' as section;
select category_code, display_name, is_active, created_at, created_by_employee_code, created_by_account_id
from task.categories
order by created_at;

select '=== C2: EXTRA categories (không nằm trong 13 baseline Supabase snapshot) ===' as section;
select category_code, display_name, is_active, created_at, created_by_employee_code, created_by_account_id
from task.categories
where category_code not in (
  'BAO_CAO','CHAM_SOC_KHACH_HANG','CONG_VIEC_TONG_THE','DAO_TAO','DU_AN',
  'KHO_VAN','KINH_DOANH','NHAN_SU','PHAT_SINH_KHAC','SUA_CHUA','TAI_CHINH',
  'THANH_TOAN','THU_MUA'
)
order by created_at;

-- -----------------------------------------------------------------------------
-- MỤC TIÊU 2c — permission_grants/assignments liên quan (có thể không gắn task_id
-- trực tiếp nhưng cùng đợt residue nếu có)
-- -----------------------------------------------------------------------------
select '=== D1: permission_assignments (4 dòng) ===' as section;
select account_id, employee_code, preset_code, is_active, reason, assigned_by_employee_code, assigned_by_account_id, created_at
from task.permission_assignments
order by created_at;

select '=== D2: permission_grants (7 dòng) ===' as section;
select grantee_employee_code, grant_type, is_active, reason, created_by_employee_code, created_by_account_id, created_at
from task.permission_grants
order by created_at;
