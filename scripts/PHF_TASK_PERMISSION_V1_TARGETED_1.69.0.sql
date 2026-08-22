begin;

-- PHF Task Permission V1 — TARGETED migration 1.69.0 (SCOPE-CORRECTED).
-- LOCAL CANDIDATE — CHƯA APPLY PRODUCTION. Chờ Business Owner GO.
--
-- Scope correction so với bản trước: migration này giờ CHỈ phục vụ Permission
-- V1 (role-source table + grant/assignment audit trail + RPC gán preset).
-- task_create_draft KHÔNG còn trong file này — Category/Create Task tách
-- thành workstream riêng, tự migration riêng sau (không trộn 2 concern).
--
-- Đây KHÔNG phải bản chạy lại nguyên khối của các migration lịch sử
-- (1.66.0/1.66.1/1.67.0/1.67.1/1.68.0). Mỗi object dưới đây được extract thủ
-- công, trích dẫn đúng file/dòng nguồn, và chỉ đưa vào nếu có runtime
-- dependency THẬT cho Permission V1 trong code hiện hành
-- (api/_lib/task-permissions.js: resolveEffectiveTaskScope/
-- loadActiveTaskAssignment; api/_lib/task-core.js:
-- createTaskPermissionGrant/revokeTaskPermissionGrant/
-- saveTaskPermissionAssignment). KHÔNG có DELETE, KHÔNG DROP object đang
-- live, KHÔNG seed business data, KHÔNG tạo task_create_draft,
-- task_add_related, task_add_link, category seed, category management,
-- delegation, hay month lock.
--
-- Tự-contained: task_forbid_update_delete() được CREATE OR REPLACE lại ngay
-- trong file này (PHẦN 0) thay vì giả định đã tồn tại — migration không còn
-- phụ thuộc mơ hồ vào trạng thái chưa verify được của DB thật. Business
-- behavior của hàm giữ nguyên 100% so với bản gốc
-- PHF_TASK_FOUNDATION_1.66.0.sql dòng 38-43 — nếu hàm đã tồn tại,
-- CREATE OR REPLACE chỉ định nghĩa lại giống hệt (no-op hiệu quả); nếu chưa
-- tồn tại, migration tự tạo mới, không còn phụ thuộc ngoài.
--
-- Xác nhận real DB trước khi apply (đọc, không ghi):
--   select table_name from information_schema.tables where table_schema='public'
--     and table_name in ('task_permission_assignments','task_permission_assignment_history');
--   select routine_name from information_schema.routines where routine_schema='public'
--     and routine_name in ('task_set_permission_assignment','task_forbid_update_delete');
--   select column_name from information_schema.columns where table_schema='public'
--     and table_name='task_permission_grants' and column_name in ('created_by_account_id','updated_by_account_id');
--   select column_name from information_schema.columns where table_schema='public'
--     and table_name='task_permission_grant_history' and column_name='changed_by_account_id';

create extension if not exists pgcrypto;

-- =============================================================================
-- PHẦN 0 — task_forbid_update_delete() — trigger function dùng chung cho mọi
-- bảng append-only (task_events, task_comments đã live từ 1.66.0; và
-- task_permission_assignment_history mới ở PHẦN 2 dưới đây).
--
-- NGUỒN: PHF_TASK_FOUNDATION_1.66.0.sql, dòng 38-43 (verbatim, KHÔNG đổi
-- business behavior — vẫn đúng 1 raise exception với message/errcode gốc).
--
-- WHY REQUIRED: PHẦN 2 tạo trigger forbid-update/forbid-delete trên
-- task_permission_assignment_history tham chiếu thẳng hàm này. Đưa vào đây
-- để migration KHÔNG còn dependency chưa verify được — xem ghi chú đầu file.
-- =============================================================================
create or replace function public.task_forbid_update_delete() returns trigger as $$
begin
  raise exception 'PHF Task: bảng % là append-only — không cho phép % (Z-51).', tg_table_name, tg_op
    using errcode = '0A000';
end;
$$ language plpgsql;

-- =============================================================================
-- PHẦN 1 — task_permission_grants / task_permission_grant_history:
-- thêm cột *_account_id + nới NOT NULL trên *_employee_code.
--
-- NGUỒN: PHF_TASK_FOUNDATION_CORRECTION_1.68.0.sql, dòng 64-78 (verbatim,
-- KHÔNG đổi 1 ký tự) — CHỈ lấy đúng 2 bảng grants/grant_history, bỏ hết các
-- alter khác của 1.68.0 trên task_categories/task_tasks/task_assignees/
-- task_events/task_comments/task_links (KHÔNG có runtime dependency thật
-- trong Permission V1 — actorAuditToken() của các bảng đó không bao giờ null
-- nên không hard-fail nếu thiếu cột, và các bảng đó ngoài scope Permission).
--
-- WHY REQUIRED (HARD BLOCKER): api/_lib/task-core.js createTaskPermissionGrant()
-- và revokeTaskPermissionGrant() luôn được gọi bởi actor Admin (Admin-only,
-- requireTaskPermissionAdmin() enforce trước) — actorAuditColumns(admin,
-- 'created_by_account_id', 'created_by_employee_code') tạo ra
-- {created_by_account_id: admin.accountId, created_by_employee_code: null}.
-- Với schema hiện tại (cột không tồn tại + created_by_employee_code vẫn
-- "not null" từ 1.66.1), INSERT này sẽ fail CẢ HAI lỗi: 42703 (cột không tồn
-- tại) và 23502 (not-null violation) nếu chỉ thêm cột mà không nới NOT NULL.
-- Phải làm cả hai cùng lúc mới hết blocker.
-- =============================================================================
alter table public.task_permission_grants add column if not exists created_by_account_id text;
alter table public.task_permission_grants add column if not exists updated_by_account_id text;
alter table public.task_permission_grants alter column created_by_employee_code drop not null;
alter table public.task_permission_grants drop constraint if exists task_permission_created_by_ck;
alter table public.task_permission_grants add constraint task_permission_created_by_ck check (
  nullif(trim(created_by_account_id), '') is not null or
  nullif(trim(created_by_employee_code), '') is not null
);

alter table public.task_permission_grant_history add column if not exists changed_by_account_id text;
alter table public.task_permission_grant_history alter column changed_by_employee_code drop not null;
alter table public.task_permission_grant_history drop constraint if exists task_permission_history_changed_by_ck;
alter table public.task_permission_grant_history add constraint task_permission_history_changed_by_ck check (
  nullif(trim(changed_by_account_id), '') is not null or
  nullif(trim(changed_by_employee_code), '') is not null
);

-- =============================================================================
-- PHẦN 2 — task_permission_assignments + task_permission_assignment_history
-- (bảng canonical role-source — hiện KHÔNG tồn tại trên Production).
--
-- NGUỒN: PHF_TASK_FOUNDATION_CORRECTION_1.68.0.sql, dòng 141-204 (verbatim).
-- Không cần sửa gì — 2 bảng này được thiết kế sẵn dual-identity (account_id/
-- employee_code đều nullable, CHECK constraint yêu cầu ít nhất 1 cái) nên
-- không có vấn đề NOT NULL như PHẦN 1.
--
-- WHY REQUIRED (HARD BLOCKER): đây CHÍNH LÀ role-source table mà
-- lib/task-permissions.js loadActiveTaskAssignment() đọc để xác định preset
-- Task của actor. Thiếu bảng này, MỌI actor không phải Admin sẽ nhận lỗi
-- TASK_SCHEMA_MISSING (503) khi resolveEffectiveTaskScope() chạy — chặn
-- toàn bộ Permission V1 hoạt động, không có cách nào né qua code.
--
-- DEPENDENCY: trigger forbid-update/delete tham chiếu
-- public.task_forbid_update_delete() — nay đã tự-contained ở PHẦN 0 phía
-- trên trong CHÍNH transaction này, không còn phụ thuộc ngoài chưa verify.
-- =============================================================================
create table if not exists public.task_permission_assignments (
  id uuid primary key default gen_random_uuid(),
  account_id text,
  employee_code text,
  preset_code text not null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  is_active boolean not null default true,
  reason text not null,
  assigned_by_account_id text,
  assigned_by_employee_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_permission_assignment_identity_ck check (
    nullif(trim(account_id), '') is not null or nullif(trim(employee_code), '') is not null
  ),
  constraint task_permission_assignment_preset_ck check (
    preset_code in ('GIAM_DOC', 'TRO_LY_GD', 'TRUONG_BO_PHAN', 'TRUONG_CA', 'NHAN_VIEN')
  ),
  constraint task_permission_assignment_window_ck check (effective_to is null or effective_to >= effective_from),
  constraint task_permission_assignment_reason_ck check (nullif(trim(reason), '') is not null),
  constraint task_permission_assignment_actor_ck check (
    nullif(trim(assigned_by_account_id), '') is not null or
    nullif(trim(assigned_by_employee_code), '') is not null
  )
);

create unique index if not exists task_permission_assignment_active_account_uq
  on public.task_permission_assignments(account_id) where is_active = true and account_id is not null;
create unique index if not exists task_permission_assignment_active_employee_uq
  on public.task_permission_assignments(employee_code) where is_active = true and employee_code is not null;
create index if not exists task_permission_assignment_window_idx
  on public.task_permission_assignments(is_active, effective_from, effective_to);

create table if not exists public.task_permission_assignment_history (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.task_permission_assignments(id) on delete restrict,
  action text not null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  reason text not null,
  changed_by_account_id text,
  changed_by_employee_code text,
  changed_at timestamptz not null default now(),
  constraint task_permission_assignment_history_action_ck check (action in ('assign', 'deactivate')),
  constraint task_permission_assignment_history_reason_ck check (nullif(trim(reason), '') is not null),
  constraint task_permission_assignment_history_actor_ck check (
    nullif(trim(changed_by_account_id), '') is not null or
    nullif(trim(changed_by_employee_code), '') is not null
  )
);

create index if not exists task_permission_assignment_history_assignment_idx
  on public.task_permission_assignment_history(assignment_id, changed_at desc);

drop trigger if exists task_permission_assignment_history_forbid_update on public.task_permission_assignment_history;
create trigger task_permission_assignment_history_forbid_update before update on public.task_permission_assignment_history
  for each row execute function public.task_forbid_update_delete();
drop trigger if exists task_permission_assignment_history_forbid_delete on public.task_permission_assignment_history;
create trigger task_permission_assignment_history_forbid_delete before delete on public.task_permission_assignment_history
  for each row execute function public.task_forbid_update_delete();

alter table public.task_permission_assignments enable row level security;
alter table public.task_permission_assignment_history enable row level security;
revoke all on public.task_permission_assignments from anon, authenticated;
revoke all on public.task_permission_assignment_history from anon, authenticated;

-- =============================================================================
-- PHẦN 3 — RPC task_set_permission_assignment.
--
-- NGUỒN: PHF_TASK_FOUNDATION_CORRECTION_1.68.0.sql, dòng 208-291 (verbatim).
--
-- WHY REQUIRED: api/_lib/task-core.js saveTaskPermissionAssignment() gọi
-- thẳng callRpc('task_set_permission_assignment', ...) — đây là RPC DUY NHẤT
-- ghi vào task_permission_assignments (PHẦN 2). Admin-only enforcement,
-- active-employee check, và "no assignment = NHAN_VIEN" canonical đều đã
-- được audit và enforce ở tầng JS TRƯỚC khi RPC được gọi
-- (requireTaskPermissionAdmin() + findByCode/status check trong task-core.js)
-- — RPC ở đây CHỈ enforce data invariant thuần túy (preset enum, actor bắt
-- buộc có identity, reason bắt buộc), đúng nguyên tắc "permission KHÔNG kiểm
-- tra trong RPC" đã ghi trong header PHF_TASK_CORE_RPC_1.67.0.sql.
--
-- Behavior: UPSERT/REPLACE — deactivate mọi assignment active cũ khớp
-- account_id HOẶC employee_code (ghi history 'deactivate' cho từng dòng),
-- rồi insert 1 dòng active mới (ghi history 'assign'). "Reset về NHAN_VIEN"
-- không cần API riêng — gọi lại RPC này với p_preset_code='NHAN_VIEN' là đủ,
-- vì NHAN_VIEN nằm trong enum hợp lệ như mọi preset khác.
--
-- RLS/service-role: revoke execute từ public/anon/authenticated, chỉ
-- service_role gọi được — khớp với cách backend dùng SUPABASE_SECRET_KEY
-- (service role key) cho mọi request, không có client-side Supabase call.
-- =============================================================================
create or replace function public.task_set_permission_assignment(
  p_target_account_id text,
  p_target_employee_code text,
  p_preset_code text,
  p_reason text,
  p_actor_account_id text,
  p_actor_employee_code text
) returns public.task_permission_assignments as $$
declare
  v_previous public.task_permission_assignments;
  v_assignment public.task_permission_assignments;
  v_now timestamptz := now();
begin
  if nullif(trim(coalesce(p_target_account_id, '')), '') is null and
     nullif(trim(coalesce(p_target_employee_code, '')), '') is null then
    raise exception 'TASK_PERMISSION_ASSIGNMENT_TARGET_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_preset_code, '')), '') is null or
     upper(trim(p_preset_code)) not in ('GIAM_DOC', 'TRO_LY_GD', 'TRUONG_BO_PHAN', 'TRUONG_CA', 'NHAN_VIEN') then
    raise exception 'TASK_PERMISSION_PRESET_INVALID';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'TASK_PERMISSION_REASON_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_actor_account_id, '')), '') is null and
     nullif(trim(coalesce(p_actor_employee_code, '')), '') is null then
    raise exception 'TASK_PERMISSION_ACTOR_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'task-base-preset|' || coalesce(nullif(trim(p_target_account_id), ''), '') || '|' || upper(coalesce(nullif(trim(p_target_employee_code), ''), '')), 0
  ));

  for v_previous in
    update public.task_permission_assignments
    set is_active = false, effective_to = v_now, updated_at = v_now
    where is_active = true and (
      (nullif(trim(coalesce(p_target_account_id, '')), '') is not null and account_id = trim(p_target_account_id)) or
      (nullif(trim(coalesce(p_target_employee_code, '')), '') is not null and upper(employee_code) = upper(trim(p_target_employee_code)))
    )
    returning *
  loop
    insert into public.task_permission_assignment_history(
      assignment_id, action, before_data, after_data, reason,
      changed_by_account_id, changed_by_employee_code
    ) values (
      v_previous.id, 'deactivate', to_jsonb(v_previous),
      jsonb_build_object('is_active', false, 'effective_to', v_now), trim(p_reason),
      nullif(trim(coalesce(p_actor_account_id, '')), ''),
      nullif(upper(trim(coalesce(p_actor_employee_code, ''))), '')
    );
  end loop;

  insert into public.task_permission_assignments(
    account_id, employee_code, preset_code, effective_from, effective_to,
    is_active, reason, assigned_by_account_id, assigned_by_employee_code
  ) values (
    nullif(trim(coalesce(p_target_account_id, '')), ''),
    nullif(upper(trim(coalesce(p_target_employee_code, ''))), ''),
    upper(trim(p_preset_code)), v_now, null, true, trim(p_reason),
    nullif(trim(coalesce(p_actor_account_id, '')), ''),
    nullif(upper(trim(coalesce(p_actor_employee_code, ''))), '')
  ) returning * into v_assignment;

  insert into public.task_permission_assignment_history(
    assignment_id, action, before_data, after_data, reason,
    changed_by_account_id, changed_by_employee_code
  ) values (
    v_assignment.id, 'assign', '{}'::jsonb, to_jsonb(v_assignment), trim(p_reason),
    nullif(trim(coalesce(p_actor_account_id, '')), ''),
    nullif(upper(trim(coalesce(p_actor_employee_code, ''))), '')
  );

  return v_assignment;
end;
$$ language plpgsql;

revoke execute on function public.task_set_permission_assignment(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.task_set_permission_assignment(text, text, text, text, text, text)
  to service_role;

commit;

-- ---------------------------------------------------------------------------
-- EXCLUDED FROM THIS MIGRATION (chủ đích — scope-corrected, xem report):
--   - task_create_draft RPC — Category/Create Task tách workstream riêng, tự
--     migration riêng sau. Migration này KHÔNG tạo bất kỳ RPC lifecycle nào.
--   - task_add_related RPC — Related = OUT OF V1 / HOLD (business decision).
--   - task_add_link RPC (mới hoặc bản 1.68.0) — không phải blocker Permission
--     V1; DEFER, audit lại riêng khi có business need rõ ràng.
--   - task_normalize_actor_identity() + 5 trigger normalize-actor trên
--     task_tasks/task_assignees/task_events/task_comments/task_links —
--     phụ thuộc các cột *_account_id trên chính các bảng đó, mà các bảng đó
--     KHÔNG có runtime dependency thật trong Permission V1.
--   - *_account_id columns trên task_categories/task_tasks/task_assignees/
--     task_events/task_comments/task_links — không có runtime dependency
--     thật cho Permission V1 (actorAuditToken() không bao giờ null cho các
--     bảng này, kể cả actor Admin).
--   - PHF_TASK_CATEGORY_SEED_1.67.1.sql + mọi category management (data,
--     không phải Permission schema) — workstream riêng, không thuộc V1 này.
--   - Mọi thứ liên quan delegation, month lock — ngoài phạm vi V1.
