begin;

-- PHF Task — CATEGORY + CREATE TASK FOUNDATION — targeted migration 1.70.0.
-- LOCAL CANDIDATE — CHƯA APPLY PRODUCTION. Chờ Business Owner GO riêng.
--
-- Scope: CHỈ đóng blocker để tạo được 01 phiếu Giao việc thật end-to-end.
-- KHÔNG gộp Permission V1 (đã apply ở 1.69.0), KHÔNG gộp recurrence, KHÔNG
-- gộp proposal accept/reject, KHÔNG gộp notification.
--
-- Nguồn từng object trích dẫn rõ — RPC không viết mới từ trí nhớ nếu source
-- canonical cũ (PHF_TASK_CORE_RPC_1.67.0.sql, KHÔNG phải 1.68.0) đã đúng với
-- business rule hiện tại.
--
-- Xác nhận real DB trước khi apply (đọc, không ghi):
--   select column_name from information_schema.columns where table_schema='public'
--     and table_name='task_categories' and column_name in
--     ('created_by_account_id','created_by_employee_code','updated_by_account_id','updated_by_employee_code','sort_order');
--   select routine_name from information_schema.routines where routine_schema='public'
--     and routine_name in ('task_create_draft','task_add_related','task_add_link','task_delete_category_if_unused');
--   select count(*) from public.task_categories; -- phải = 0 nếu seed PHẦN 2 chưa từng chạy
--   select count(*) from public.task_tasks; -- phải = 0 nếu chưa có Task thật nào

-- =============================================================================
-- PHẦN 1 — task_categories: audit identity + sort_order.
--
-- WHY REQUIRED: createTaskCategory()/renameTaskCategory()/setTaskCategoryActive()
-- (api/_lib/task-core.js, đã LIVE trong action manifest) đều Admin-only
-- (requireTaskAdmin()) và ghi actorAuditColumns(admin, 'created_by_account_id',
-- 'created_by_employee_code') / ('updated_by_account_id','updated_by_employee_code').
-- task_categories HIỆN KHÔNG CÓ CẢ 4 cột này (khác task_tasks/task_permission_grants
-- vốn đã có sẵn employee_code) — verified bằng 1 lần ghi thật thất bại sạch,
-- 0 dòng, ở phiên trước (KHÔNG lặp lại cách test này nếu chưa GO). Vì
-- requireTaskAdmin() đảm bảo actor LUÔN là Admin (employeeCode rỗng), cột
-- *_employee_code trên thực tế sẽ luôn null cho path này — nhưng INSERT vẫn
-- cần CẢ HAI cột tồn tại (PostgREST reference cả 2 key dù giá trị null),
-- nên vẫn phải thêm đủ 4 cột để khớp đúng code hiện có, KHÔNG suy diễn thêm
-- cột nào khác ngoài đúng những gì actorAuditColumns() ghi.
--
-- sort_order: cần cho "sắp xếp" (Cài đặt mục 4) — CHƯA có cột nào tương
-- đương, thêm integer nullable + default theo thứ tự insert để không phá
-- danh mục cũ nếu sau này có dữ liệu thật trước khi migration này chạy.
-- =============================================================================
alter table public.task_categories add column if not exists created_by_account_id text;
alter table public.task_categories add column if not exists created_by_employee_code text;
alter table public.task_categories add column if not exists updated_by_account_id text;
alter table public.task_categories add column if not exists updated_by_employee_code text;
alter table public.task_categories add column if not exists sort_order integer;

-- =============================================================================
-- PHẦN 2 — Seed 13 danh mục chính thức (Business Owner đã CHỐT, KHÔNG phải
-- demo/suggestion). Idempotent — on conflict do nothing theo category_code,
-- an toàn re-run nếu migration chạy lại hoặc Admin đã tự tạo trước.
--
-- category_code: sinh ổn định từ tên tiếng Việt (bỏ dấu, upper, underscore)
-- — GIỐNG HỆT thuật toán generateCategoryCodeFromName() đã viết ở
-- assets/js/task/phf-task-app.js (Tạo phiếu V1) để code đề xuất qua UI và
-- seed chính thức không bao giờ tạo 2 mã khác nhau cho cùng 1 tên.
-- =============================================================================
insert into public.task_categories (category_code, display_name, is_active, sort_order)
values
  ('BAO_CAO', 'Báo cáo', true, 1),
  ('TAI_CHINH', 'Tài chính', true, 2),
  ('KHO_VAN', 'Kho vận', true, 3),
  ('NHAN_SU', 'Nhân sự', true, 4),
  ('KINH_DOANH', 'Kinh doanh', true, 5),
  ('CONG_VIEC_TONG_THE', 'Công việc tổng thể', true, 6),
  ('THU_MUA', 'Thu mua', true, 7),
  ('CHAM_SOC_KHACH_HANG', 'Chăm sóc khách hàng', true, 8),
  ('DU_AN', 'Dự án', true, 9),
  ('PHAT_SINH_KHAC', 'Phát sinh khác', true, 10),
  ('DAO_TAO', 'Đào tạo', true, 11),
  ('SUA_CHUA', 'Sửa chữa', true, 12),
  ('THANH_TOAN', 'Thanh toán', true, 13)
on conflict (category_code) do nothing;

-- =============================================================================
-- PHẦN 3 — RPC task_create_draft.
-- NGUỒN: PHF_TASK_CORE_RPC_1.67.0.sql, dòng 41-99 (verbatim — KHÔNG có
-- account_id nào được dùng, không cần cột mới trên task_tasks/task_assignees,
-- đã audit lại lần này và xác nhận không đổi so với bản đã trích ở
-- PHF_TASK_PERMISSION_V1_TARGETED_1.69.0.sql trước khi bị loại khỏi migration
-- đó — nay đưa lại đúng chỗ, migration Category/Create Task riêng).
-- =============================================================================
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

-- =============================================================================
-- PHẦN 4 — RPC task_add_related.
-- NGUỒN: PHF_TASK_CORE_RPC_1.67.0.sql, dòng 462-533 (verbatim).
--
-- Đối chiếu với business rule CC mới (Tạo phiếu V1 mục 7): RPC này CHỈ lo
-- data invariant (không trùng, không biến primary thành related, audit
-- event, idempotent) — KHÔNG tự quyết định AI được thêm làm related, việc
-- đó đã chuyển hẳn sang api/_lib/task-permissions.js canAddTaskRelated()
-- (JS layer, company-wide theo business rule mới) TRƯỚC khi RPC được gọi.
-- Vì vậy RPC KHÔNG cần sửa gì để khớp rule CC mới — đã đúng từ khi viết,
-- chỉ chưa từng deploy.
-- =============================================================================
create or replace function public.task_add_related(
  p_task_id uuid,
  p_target_employee_code text,
  p_actor_employee_code text
) returns public.task_assignees as $$
declare
  v_target text := upper(trim(coalesce(p_target_employee_code, '')));
  v_assignee public.task_assignees;
  v_event_id uuid;
begin
  if v_target = '' then
    raise exception 'TASK_RELATED_TARGET_REQUIRED' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'task-related|' || p_task_id::text || '|' || v_target, 0
  ));

  if exists (
    select 1 from public.task_assignees
    where task_id = p_task_id and employee_code = v_target
      and role = 'primary' and is_active = true
  ) then
    raise exception 'TASK_RELATED_IS_PRIMARY' using errcode = '22023';
  end if;

  select * into v_assignee
  from public.task_assignees
  where task_id = p_task_id and employee_code = v_target
    and role = 'related' and is_active = true
  order by assigned_at desc
  limit 1
  for update;

  if found then
    select e.id into v_event_id
    from public.task_events e
    where e.task_id = p_task_id
      and e.event_type = 'assignment'
      and e.payload->>'action' = 'add'
      and e.payload->>'role' = 'related'
      and e.payload->>'employee_code' = v_target
      and (
        e.payload->>'assignee_id' = v_assignee.id::text
        or (e.payload->>'assignee_id' is null and e.occurred_at >= v_assignee.assigned_at)
      )
    order by e.occurred_at asc
    limit 1;

    if v_event_id is null then
      insert into public.task_events(task_id, event_type, actor_employee_code, payload)
      values (p_task_id, 'assignment', p_actor_employee_code, jsonb_build_object(
        'action', 'add', 'role', 'related', 'employee_code', v_target,
        'assignee_id', v_assignee.id, 'recovered_missing_audit', true
      ));
    end if;
    return v_assignee;
  end if;

  insert into public.task_assignees(
    task_id, employee_code, role, assigned_by_employee_code
  ) values (
    p_task_id, v_target, 'related', p_actor_employee_code
  ) returning * into v_assignee;

  insert into public.task_events(task_id, event_type, actor_employee_code, payload)
  values (p_task_id, 'assignment', p_actor_employee_code, jsonb_build_object(
    'action', 'add', 'role', 'related', 'employee_code', v_target,
    'assignee_id', v_assignee.id
  ));

  return v_assignee;
end;
$$ language plpgsql;

-- =============================================================================
-- PHẦN 5 — RPC task_add_link.
-- NGUỒN: PHF_TASK_CORE_RPC_1.67.0.sql, dòng 542-617 (verbatim — bản GỐC
-- 1.67.0, KHÔNG PHẢI bản sửa ở 1.68.0). Lý do chọn bản 1.67.0: bản 1.68.0
-- kiểm tra thêm "l.added_by_account_id = p_actor_employee_code" để idempotent
-- đúng sau khi có normalize-actor-identity trigger — nhưng migration này
-- KHÔNG thêm added_by_account_id vào task_links (không có runtime dependency
-- thật, actorAuditToken() không bao giờ null kể cả Admin — xem PHẦN 1 của
-- PHF_TASK_PERMISSION_V1_TARGETED_1.69.0.sql cho lý luận tương tự đã áp dụng
-- cho các bảng khác). Dùng bản 1.68.0 ở đây sẽ 42703 vì cột đó không tồn tại.
-- =============================================================================
create or replace function public.task_add_link(
  p_task_id uuid,
  p_side text,
  p_url text,
  p_label text,
  p_actor_employee_code text
) returns public.task_links as $$
declare
  v_label text := nullif(trim(coalesce(p_label, '')), '');
  v_link public.task_links;
  v_event_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'task-link|' || p_task_id::text || '|' || p_side || '|' || trim(p_url)
      || '|' || coalesce(v_label, '') || '|' || p_actor_employee_code, 0
  ));

  select l.* into v_link
  from public.task_links l
  where l.task_id = p_task_id
    and l.side = p_side
    and trim(l.url) = trim(p_url)
    and coalesce(trim(l.label), '') = coalesce(v_label, '')
    and l.added_by_employee_code = p_actor_employee_code
    and not exists (
      select 1 from public.task_events removed
      where removed.task_id = p_task_id
        and removed.event_type = 'link'
        and removed.payload->>'action' = 'remove'
        and removed.payload->>'link_id' = l.id::text
    )
  order by l.created_at desc
  limit 1
  for update;

  if found then
    v_event_id := v_link.related_event_id;
    if v_event_id is null then
      select e.id into v_event_id
      from public.task_events e
      where e.task_id = p_task_id
        and e.event_type = 'link'
        and e.payload->>'action' = 'add'
        and e.payload->>'link_id' = v_link.id::text
      order by e.occurred_at asc
      limit 1;
    end if;
    if v_event_id is null then
      insert into public.task_events(task_id, event_type, actor_employee_code, payload)
      values (p_task_id, 'link', p_actor_employee_code, jsonb_build_object(
        'action', 'add', 'link_id', v_link.id, 'side', v_link.side,
        'url', v_link.url, 'recovered_missing_audit', true
      )) returning id into v_event_id;
    end if;
    if v_link.related_event_id is distinct from v_event_id then
      update public.task_links set related_event_id = v_event_id
      where id = v_link.id returning * into v_link;
    end if;
    return v_link;
  end if;

  insert into public.task_links(
    task_id, side, url, label, added_by_employee_code
  ) values (
    p_task_id, p_side, trim(p_url), v_label, p_actor_employee_code
  ) returning * into v_link;

  insert into public.task_events(task_id, event_type, actor_employee_code, payload)
  values (p_task_id, 'link', p_actor_employee_code, jsonb_build_object(
    'action', 'add', 'link_id', v_link.id, 'side', v_link.side, 'url', v_link.url
  )) returning id into v_event_id;

  update public.task_links set related_event_id = v_event_id
  where id = v_link.id returning * into v_link;

  return v_link;
end;
$$ language plpgsql;

-- =============================================================================
-- PHẦN 6 — RPC task_delete_category_if_unused (MỚI — không có trong migration
-- lịch sử nào, viết mới cho đúng business rule "chưa từng dùng → được xóa;
-- đã dùng → chỉ Ngừng sử dụng", Tạo phiếu V1 mục 4/Category+Create Task
-- Foundation mục 4-5). Dùng RPC thay vì SELECT-rồi-DELETE ở tầng JS để tránh
-- race condition (Task mới tham chiếu category đúng lúc đang xóa).
-- =============================================================================
create or replace function public.task_delete_category_if_unused(
  p_category_code text
) returns boolean as $$
declare
  v_code text := upper(trim(coalesce(p_category_code, '')));
  v_in_use boolean;
begin
  if v_code = '' then
    raise exception 'TASK_CATEGORY_CODE_REQUIRED' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('task-category-delete|' || v_code, 0));

  select exists(
    select 1 from public.task_tasks where category_code = v_code
  ) into v_in_use;

  if v_in_use then
    raise exception 'TASK_CATEGORY_IN_USE' using errcode = '22023';
  end if;

  delete from public.task_categories where category_code = v_code;
  if not found then
    raise exception 'TASK_CATEGORY_NOT_FOUND' using errcode = '22023';
  end if;

  return true;
end;
$$ language plpgsql;

-- =============================================================================
-- Revoke PUBLIC execute cho cả 4 RPC (đồng bộ đúng pattern defense-in-depth
-- đã dùng cho 7 RPC đang live — xem PHF_TASK_CORE_RPC_1.67.0.sql cuối file:
-- không SECURITY DEFINER + RLS đã bật + revoke all từ anon/authenticated ở
-- bảng, nên revoke EXECUTE ở đây chỉ là lớp phòng thủ thêm, KHÔNG cần grant
-- lại cho service_role — service_role không phụ thuộc PUBLIC grant, đúng
-- như 7 hàm anh em đã áp dụng và đang chạy thật).
-- =============================================================================
revoke execute on function public.task_create_draft(text, text, text, text, text, timestamptz, timestamptz, text, text)
  from public, anon, authenticated;
revoke execute on function public.task_add_related(uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.task_add_link(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.task_delete_category_if_unused(text)
  from public, anon, authenticated;

commit;

-- ---------------------------------------------------------------------------
-- EXCLUDED FROM THIS MIGRATION (chủ đích):
--   - Scheduler/recurrence — FROZEN, không đụng (xem
--     PHF_TASK_RECURRENCE_DESIGN_PACKAGE.sql, vẫn design-only).
--   - Đề xuất accept/reject lifecycle — chưa tồn tại, không tự invent.
--   - Notification subsystem — chưa tồn tại, không tự xây.
--   - *_account_id columns trên task_tasks/task_assignees/task_links/
--     task_events/task_comments — không có runtime dependency thật (đã audit
--     lại lần này, actorAuditToken() không bao giờ null kể cả Admin).
-- ---------------------------------------------------------------------------
