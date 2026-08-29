begin;

-- PHF Task V1 — Batch 2: Core lifecycle RPC — LOCAL CANDIDATE, CHƯA APPLY.
--
-- Lý do cần RPC (không dùng nhiều PostgREST call rời cho state-mutating
-- command): mỗi lệnh critical bên dưới cần TỐI THIỂU 2 statement atomic cùng
-- lúc — (1) update task_tasks (kèm CAS trên row_version) và (2) insert
-- task_events — hoặc với transfer_primary còn thêm dual-write trên
-- task_assignees. PostgREST qua @supabase/supabase-js chỉ gửi 1 statement/1
-- network call; 2 call rời KHÔNG atomic (có thể fail giữa chừng để lại state
-- nửa vời). Postgres function gọi qua .rpc() chạy trong ĐÚNG 1 transaction —
-- đây là pattern đã có tiền lệ thật trong repo (vd
-- lock_checklist_monthly_period, phf_save_checklist_monthly_self,
-- phf_save_checklist_monthly_overdue_policy) — không phải kiến trúc mới.
--
-- Không SECURITY DEFINER ở bất kỳ function nào (service-role key đã bypass
-- RLS sẵn, không cần nâng đặc quyền thêm — đúng nguyên tắc least-privilege
-- đã áp dụng cho task_forbid_update_delete()/task_guard_task_delete()).
-- Không dynamic SQL — mọi function có tham số CỐ ĐỊNH, KHÔNG nhận field-list
-- tùy ý từ client (giữ đúng nguyên tắc "command-based, không phải generic
-- saveTask" ở tầng SQL, không chỉ tầng JS).
--
-- Permission/scope KHÔNG được kiểm tra trong các function này — đó là trách
-- nhiệm của lib/task-permissions.js (đã có ở Batch 1), gọi TRƯỚC khi RPC được
-- gọi. Function ở đây chỉ enforce data invariant thuần túy (row_version CAS,
-- state-machine hợp lệ, primary uniqueness, reason bắt buộc) — không biết gì
-- về actor type/scope.
--
-- event_type dùng ĐÚNG enum đã có trong task_events_event_type_ck (Production
-- đã apply, KHÔNG sửa CHECK constraint ở đây) — không cần tên event_type mới
-- kiểu "progress_updated"/"completed"/"reopened" như draft thiết kế Batch 2
-- ban đầu liệt kê; thay vào đó dùng enum hiện có (progress/completion/reopen/
-- cancel/deadline_change/transfer) và mã hóa chi tiết hành động trong payload
-- jsonb. Xem Output mục H (Event contract) để biết mapping đầy đủ.

-- ---------------------------------------------------------------------------
-- 0) task_create_draft — Task + initial primary trong CÙNG transaction.
--    Nếu insert primary fail thì toàn bộ function rollback, không để draft
--    mồ côi. Draft không ghi event theo contract Foundation hiện hữu.
-- ---------------------------------------------------------------------------
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

  -- Authoritative create gate: lock the canonical category row while creating
  -- so an Admin active-toggle cannot race between JS validation and INSERT.
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

-- ---------------------------------------------------------------------------
-- 1) task_publish — draft -> published, đúng 1 active primary bắt buộc
--    (universal theo rule E.8, không phân biệt giao_viec/de_xuat).
-- ---------------------------------------------------------------------------
create or replace function public.task_publish(
  p_task_id uuid,
  p_expected_row_version integer,
  p_actor_employee_code text
) returns public.task_tasks as $$
declare
  v_task public.task_tasks;
  v_primary_count integer;
begin
  select * into v_task from public.task_tasks where id = p_task_id for update;
  if not found then
    raise exception 'TASK_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_task.row_version <> p_expected_row_version then
    raise exception 'TASK_VERSION_CONFLICT' using errcode = '40001';
  end if;
  if v_task.status <> 'draft' then
    raise exception 'TASK_NOT_DRAFT' using errcode = '22023';
  end if;

  select count(*) into v_primary_count from public.task_assignees
    where task_id = p_task_id and role = 'primary' and is_active = true;
  if v_primary_count <> 1 then
    raise exception 'TASK_PRIMARY_REQUIRED' using errcode = '22023';
  end if;

  update public.task_tasks
    set status = 'published', published_at = now(), updated_at = now(), row_version = row_version + 1
    where id = p_task_id
    returning * into v_task;

  insert into public.task_events(task_id, event_type, actor_employee_code, payload)
    values (p_task_id, 'published', p_actor_employee_code, jsonb_build_object('flow_type', v_task.flow_type));

  return v_task;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- 2) task_update_progress — published/in_progress only; published+percent>0
--    tự chuyển in_progress (I.15/I.16). 100% KHÔNG tự complete (rule I.16 +
--    Batch 2 mục 7: "100% progress ≠ completed cho tới khi explicit complete").
-- ---------------------------------------------------------------------------
create or replace function public.task_update_progress(
  p_task_id uuid,
  p_expected_row_version integer,
  p_actor_employee_code text,
  p_progress_percent integer,
  p_progress_status text
) returns public.task_tasks as $$
declare
  v_task public.task_tasks;
  v_old_percent integer;
  v_old_status text;
  v_new_status text;
begin
  select * into v_task from public.task_tasks where id = p_task_id for update;
  if not found then
    raise exception 'TASK_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_task.row_version <> p_expected_row_version then
    raise exception 'TASK_VERSION_CONFLICT' using errcode = '40001';
  end if;
  if v_task.status not in ('published', 'in_progress') then
    raise exception 'TASK_NOT_ACTIVE' using errcode = '22023';
  end if;
  if p_progress_percent is null or p_progress_percent < 0 or p_progress_percent > 100 then
    raise exception 'TASK_PROGRESS_PERCENT_INVALID' using errcode = '22023';
  end if;
  if p_progress_status not in ('chua_bat_dau', 'dang_thuc_hien', 'hoan_thanh') then
    raise exception 'TASK_PROGRESS_STATUS_INVALID' using errcode = '22023';
  end if;

  v_old_percent := v_task.progress_percent;
  v_old_status := v_task.status;
  v_new_status := case when v_task.status = 'published' and p_progress_percent > 0 then 'in_progress' else v_task.status end;

  update public.task_tasks
    set progress_percent = p_progress_percent, progress_status = p_progress_status,
        last_progress_at = now(), status = v_new_status, updated_at = now(), row_version = row_version + 1
    where id = p_task_id
    returning * into v_task;

  insert into public.task_events(task_id, event_type, actor_employee_code, payload)
    values (p_task_id, 'progress', p_actor_employee_code, jsonb_build_object(
      'old_percent', v_old_percent, 'new_percent', p_progress_percent,
      'old_lifecycle_status', v_old_status, 'new_lifecycle_status', v_new_status));

  return v_task;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- 3) task_complete — explicit only, published/in_progress -> completed.
--    completed_at LUÔN server time (rule H.18) — không nhận từ client.
-- ---------------------------------------------------------------------------
create or replace function public.task_complete(
  p_task_id uuid,
  p_expected_row_version integer,
  p_actor_employee_code text,
  p_result_text text
) returns public.task_tasks as $$
declare
  v_task public.task_tasks;
  v_completed_at timestamptz;
  v_on_time boolean;
begin
  select * into v_task from public.task_tasks where id = p_task_id for update;
  if not found then
    raise exception 'TASK_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_task.row_version <> p_expected_row_version then
    raise exception 'TASK_VERSION_CONFLICT' using errcode = '40001';
  end if;
  if v_task.status not in ('published', 'in_progress') then
    raise exception 'TASK_NOT_ACTIVE' using errcode = '22023';
  end if;
  if coalesce(trim(p_result_text), '') = '' then
    raise exception 'TASK_COMPLETION_RESULT_REQUIRED' using errcode = '22023';
  end if;

  v_completed_at := now();
  v_on_time := v_completed_at <= v_task.deadline;

  update public.task_tasks
    set status = 'completed', completed_at = v_completed_at, progress_percent = 100,
        progress_status = 'hoan_thanh', updated_at = now(), row_version = row_version + 1
    where id = p_task_id
    returning * into v_task;

  insert into public.task_events(task_id, event_type, actor_employee_code, payload)
    values (p_task_id, 'completion', p_actor_employee_code, jsonb_build_object(
      'result_text', p_result_text, 'completed_at', v_completed_at, 'on_time', v_on_time, 'deadline', v_task.deadline));

  return v_task;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- 4) task_reopen — completed -> in_progress. reason bắt buộc (rule N.19).
--    Batch 2 KHÔNG query bảng monthly result (chưa tồn tại) — guard cutoff
--    để lại cho module Monthly Close ở batch sau (đúng chỉ định mục 9).
-- ---------------------------------------------------------------------------
create or replace function public.task_reopen(
  p_task_id uuid,
  p_expected_row_version integer,
  p_actor_employee_code text,
  p_reason text
) returns public.task_tasks as $$
declare
  v_task public.task_tasks;
  v_prev_completed_at timestamptz;
begin
  select * into v_task from public.task_tasks where id = p_task_id for update;
  if not found then
    raise exception 'TASK_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_task.row_version <> p_expected_row_version then
    raise exception 'TASK_VERSION_CONFLICT' using errcode = '40001';
  end if;
  if v_task.status <> 'completed' then
    raise exception 'TASK_NOT_COMPLETED' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'TASK_REOPEN_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_prev_completed_at := v_task.completed_at;

  update public.task_tasks
    set status = 'in_progress', completed_at = null, updated_at = now(), row_version = row_version + 1
    where id = p_task_id
    returning * into v_task;

  insert into public.task_events(task_id, event_type, actor_employee_code, payload, reason)
    values (p_task_id, 'reopen', p_actor_employee_code, jsonb_build_object('previous_completed_at', v_prev_completed_at), p_reason);

  return v_task;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- 5) task_cancel — mọi status trừ draft/cancelled. completed muốn cancel phải
--    reopen trước (rule N — "conservative: completed -> cancelled KHÔNG mặc
--    định cho phép"). draft dùng hard-delete riêng, không đi qua đây.
-- ---------------------------------------------------------------------------
create or replace function public.task_cancel(
  p_task_id uuid,
  p_expected_row_version integer,
  p_actor_employee_code text,
  p_reason text
) returns public.task_tasks as $$
declare
  v_task public.task_tasks;
  v_prev_status text;
begin
  select * into v_task from public.task_tasks where id = p_task_id for update;
  if not found then
    raise exception 'TASK_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_task.row_version <> p_expected_row_version then
    raise exception 'TASK_VERSION_CONFLICT' using errcode = '40001';
  end if;
  if v_task.status = 'draft' then
    raise exception 'TASK_DRAFT_USE_DELETE' using errcode = '22023';
  end if;
  if v_task.status = 'cancelled' then
    raise exception 'TASK_ALREADY_CANCELLED' using errcode = '22023';
  end if;
  if v_task.status = 'completed' then
    raise exception 'TASK_MUST_REOPEN_BEFORE_CANCEL' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'TASK_CANCEL_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_prev_status := v_task.status;

  update public.task_tasks
    set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason, updated_at = now(), row_version = row_version + 1
    where id = p_task_id
    returning * into v_task;

  insert into public.task_events(task_id, event_type, actor_employee_code, payload, reason)
    values (p_task_id, 'cancel', p_actor_employee_code, jsonb_build_object('previous_status', v_prev_status), p_reason);

  return v_task;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- 6) task_change_deadline — cancelled task immutable. reason bắt buộc.
--    Giữ nguyên deadline cũ trong event payload (rule K.22 — "không mất
--    deadline cũ").
-- ---------------------------------------------------------------------------
create or replace function public.task_change_deadline(
  p_task_id uuid,
  p_expected_row_version integer,
  p_actor_employee_code text,
  p_new_deadline timestamptz,
  p_reason text
) returns public.task_tasks as $$
declare
  v_task public.task_tasks;
  v_old_deadline timestamptz;
  v_old_deadline_version integer;
begin
  select * into v_task from public.task_tasks where id = p_task_id for update;
  if not found then
    raise exception 'TASK_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_task.row_version <> p_expected_row_version then
    raise exception 'TASK_VERSION_CONFLICT' using errcode = '40001';
  end if;
  if v_task.status = 'cancelled' then
    raise exception 'TASK_CANCELLED_IMMUTABLE' using errcode = '22023';
  end if;
  if p_new_deadline is null then
    raise exception 'TASK_DEADLINE_REQUIRED' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'TASK_DEADLINE_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_old_deadline := v_task.deadline;
  v_old_deadline_version := v_task.deadline_version;

  update public.task_tasks
    set deadline = p_new_deadline, deadline_version = deadline_version + 1, updated_at = now(), row_version = row_version + 1
    where id = p_task_id
    returning * into v_task;

  insert into public.task_events(task_id, event_type, actor_employee_code, payload, reason)
    values (p_task_id, 'deadline_change', p_actor_employee_code, jsonb_build_object(
      'old_deadline', v_old_deadline, 'new_deadline', p_new_deadline,
      'old_deadline_version', v_old_deadline_version, 'new_deadline_version', v_old_deadline_version + 1), p_reason);

  return v_task;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- 7) task_transfer_primary — A->B atomic (rule M.25 + Correction Gate mục 8).
--    Nếu B đang active related, tự deactivate related trước khi promote lên
--    primary (role promotion) — tránh vi phạm
--    task_assignees_one_active_assignment_per_employee_uq. Target scope
--    (assign authority) đã được verify ở tầng JS TRƯỚC khi gọi RPC này —
--    function chỉ enforce data invariant, không biết gì về scope.
-- ---------------------------------------------------------------------------
create or replace function public.task_transfer_primary(
  p_task_id uuid,
  p_expected_row_version integer,
  p_actor_employee_code text,
  p_new_primary_employee_code text,
  p_reason text
) returns public.task_tasks as $$
declare
  v_task public.task_tasks;
  v_old_primary text;
  v_related_deactivated_count integer;
  v_was_active_related boolean;
begin
  select * into v_task from public.task_tasks where id = p_task_id for update;
  if not found then
    raise exception 'TASK_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_task.row_version <> p_expected_row_version then
    raise exception 'TASK_VERSION_CONFLICT' using errcode = '40001';
  end if;
  if v_task.status not in ('published', 'in_progress') then
    raise exception 'TASK_NOT_ACTIVE' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'TASK_TRANSFER_REASON_REQUIRED' using errcode = '22023';
  end if;
  if coalesce(trim(p_new_primary_employee_code), '') = '' then
    raise exception 'TASK_TRANSFER_TARGET_REQUIRED' using errcode = '22023';
  end if;

  select employee_code into v_old_primary from public.task_assignees
    where task_id = p_task_id and role = 'primary' and is_active = true
    for update;
  if v_old_primary is null then
    raise exception 'TASK_PRIMARY_NOT_FOUND' using errcode = '22023';
  end if;
  if v_old_primary = p_new_primary_employee_code then
    raise exception 'TASK_TRANSFER_SAME_EMPLOYEE' using errcode = '22023';
  end if;

  update public.task_assignees
    set is_active = false, deactivated_at = now()
    where task_id = p_task_id and employee_code = p_new_primary_employee_code and role = 'related' and is_active = true;
  get diagnostics v_related_deactivated_count = row_count;
  v_was_active_related := v_related_deactivated_count > 0;

  update public.task_assignees
    set is_active = false, deactivated_at = now()
    where task_id = p_task_id and role = 'primary' and is_active = true;

  insert into public.task_assignees(task_id, employee_code, role, is_active, assigned_by_employee_code)
    values (p_task_id, p_new_primary_employee_code, 'primary', true, p_actor_employee_code);

  update public.task_tasks
    set updated_at = now(), row_version = row_version + 1
    where id = p_task_id
    returning * into v_task;

  insert into public.task_events(task_id, event_type, actor_employee_code, payload, reason)
    values (p_task_id, 'transfer', p_actor_employee_code, jsonb_build_object(
      'from_employee_code', v_old_primary, 'to_employee_code', p_new_primary_employee_code,
      'was_active_related', v_was_active_related), p_reason);

  return v_task;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- 8) task_add_related — child row + assignment event atomic và idempotent.
--    Advisory lock serialize cùng logical target. Nếu gặp row active legacy
--    thiếu event (do implementation cũ fail giữa 2 PostgREST call), RPC bổ
--    sung đúng event còn thiếu thay vì insert duplicate assignment.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 9) task_add_link — link + audit event + related_event_id atomic.
--    Exact active logical link của cùng actor là idempotent. Row legacy thiếu
--    audit được nối lại bằng related_event_id; link đã remove không bị reuse.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- EXECUTE hardening (Migration Preflight P2 fix). PostgreSQL mặc định GRANT
-- EXECUTE ON FUNCTION cho PUBLIC ngay khi tạo (khác TABLE — không tự cấp).
-- Vì cả 10 function đều KHÔNG SECURITY DEFINER (invoker-privilege), việc
-- anon/authenticated gọi trực tiếp KHÔNG đọc/ghi được dữ liệu thật (bảng
-- task_tasks/task_assignees đã RLS-enabled + 0 policy + revoke all từ
-- anon/authenticated ở Foundation 1.66.0) — nhưng vẫn revoke EXECUTE ở đây
-- cho nhất quán defense-in-depth với chính pattern double-lock (RLS + revoke)
-- đã áp dụng cho bảng, và để tránh lộ Postgres error text nội bộ qua
-- PostgREST một cách không cần thiết. KHÔNG revoke service_role (không bị
-- liệt kê ở đây) — service_role không phụ thuộc PUBLIC grant, không cần cấp
-- lại EXECUTE riêng.
-- ---------------------------------------------------------------------------
revoke execute on function public.task_create_draft(text, text, text, text, text, timestamptz, timestamptz, text, text)
  from public, anon, authenticated;
revoke execute on function public.task_publish(uuid, integer, text)
  from public, anon, authenticated;
revoke execute on function public.task_update_progress(uuid, integer, text, integer, text)
  from public, anon, authenticated;
revoke execute on function public.task_complete(uuid, integer, text, text)
  from public, anon, authenticated;
revoke execute on function public.task_reopen(uuid, integer, text, text)
  from public, anon, authenticated;
revoke execute on function public.task_cancel(uuid, integer, text, text)
  from public, anon, authenticated;
revoke execute on function public.task_change_deadline(uuid, integer, text, timestamptz, text)
  from public, anon, authenticated;
revoke execute on function public.task_transfer_primary(uuid, integer, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.task_add_related(uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.task_add_link(uuid, text, text, text, text)
  from public, anon, authenticated;

commit;
