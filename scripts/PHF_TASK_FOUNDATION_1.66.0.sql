begin;

-- PHF Task V1 — Batch 1: Foundation schema.
-- Namespace hoàn toàn riêng (bảng task_*), KHÔNG đụng bảng checklist_*/knl_*.
-- Nguồn nhân sự/tổ chức DUY NHẤT vẫn là employee_profiles (Quản trị nhân sự) —
-- các bảng dưới đây chỉ lưu employee_code làm tham chiếu văn bản (text), KHÔNG
-- tạo FK sang employee_profiles (đúng Phase 1B: Task không được duplicate/khoá
-- cứng Organization Master, và employee_code không phải PK vật lý ở đó).
--
-- CHƯA tạo: task_recurring_series, task_batches, task_attachments (file upload),
-- task_permission_grants (xem PHF_TASK_PERMISSIONS_1.66.1.sql), task_notifications,
-- task_monthly_results, task_settings — theo đúng phạm vi Batch 1 (chỉ Foundation +
-- Permission core). Các cột recurring_series_id/recurring_series_version/batch_id
-- ở task_tasks để PLAIN uuid (chưa FK) vì bảng đích chưa tồn tại — sẽ thêm
-- constraint FK ở migration tạo bảng tương ứng, không migrate ngược lại bảng này.
--
-- occurrence identity: scheduled_occurrence_at (timestamptz chính xác) là khoá
-- chống trùng recurring occurrence THẬT. occurrence_period (YYYY-MM) CHỈ phục vụ
-- reporting/group-by — tuyệt đối KHÔNG dùng làm unique key (đã sửa ở Correction Gate
-- mục 2: 1 series có thể có nhiều occurrence trong cùng tháng — daily/weekly).
--
-- Migration Preflight correction (2 fix): (1) task_assignees chỉ còn ĐÚNG 1
-- unique index theo (task_id, employee_code) WHERE is_active=true — thay cho
-- index cũ chỉ giới hạn role='related', vì 1 employee không được vừa active
-- primary vừa active related cùng task. (2) task_tasks có thêm trigger
-- task_tasks_guard_delete chặn hard-delete khi status<>'draft' (rule N.26/
-- N.27), vì 4 bảng con đang ON DELETE CASCADE nên nếu không chặn ở tầng DB,
-- xóa 1 published task sẽ kéo theo mất audit trail append-only.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Trigger dùng chung: chặn UPDATE/DELETE trên bảng append-only (Z-51). Định
-- nghĩa 1 lần ở đây, tái dùng cho task_events (batch này) và các bảng
-- append-only khác sẽ tạo ở batch sau (task_monthly_results, task_permission_
-- grant_history...).
-- ---------------------------------------------------------------------------
create or replace function public.task_forbid_update_delete() returns trigger as $$
begin
  raise exception 'PHF Task: bảng % là append-only — không cho phép % (Z-51).', tg_table_name, tg_op
    using errcode = '0A000';
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- task_categories
-- ---------------------------------------------------------------------------
create table if not exists public.task_categories (
  category_code text primary key,
  display_name text not null,
  description text not null default '',
  color text not null default '#64748B',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_categories_code_ck check (category_code = upper(category_code) and category_code ~ '^[A-Z0-9_]+$'),
  constraint task_categories_name_ck check (nullif(trim(display_name), '') is not null)
);

create index if not exists task_categories_active_idx on public.task_categories(is_active);

-- ---------------------------------------------------------------------------
-- task_tasks
-- ---------------------------------------------------------------------------
create table if not exists public.task_tasks (
  id uuid primary key default gen_random_uuid(),
  flow_type text not null,
  status text not null default 'draft',
  title text not null,
  content text not null default '',
  category_code text not null references public.task_categories(category_code) on delete restrict,
  priority text not null default 'thuong',
  start_at timestamptz,
  deadline timestamptz not null,
  deadline_version integer not null default 1,
  created_by_employee_code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  progress_status text not null default 'chua_bat_dau',
  progress_percent integer not null default 0,
  last_progress_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  copied_from_task_id uuid references public.task_tasks(id) on delete set null,
  recurring_series_id uuid,
  recurring_series_version integer,
  scheduled_occurrence_at timestamptz,
  occurrence_period text,
  batch_id uuid,
  row_version integer not null default 1,
  constraint task_tasks_flow_type_ck check (flow_type in ('giao_viec', 'de_xuat')),
  constraint task_tasks_status_ck check (status in ('draft', 'published', 'in_progress', 'completed', 'cancelled')),
  constraint task_tasks_priority_ck check (priority in ('thuong', 'quan_trong', 'khan_cap')),
  constraint task_tasks_progress_status_ck check (progress_status in ('chua_bat_dau', 'dang_thuc_hien', 'hoan_thanh')),
  constraint task_tasks_progress_percent_ck check (progress_percent between 0 and 100),
  constraint task_tasks_title_ck check (nullif(trim(title), '') is not null),
  constraint task_tasks_created_by_ck check (nullif(trim(created_by_employee_code), '') is not null),
  constraint task_tasks_occurrence_period_ck check (occurrence_period is null or occurrence_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  constraint task_tasks_cancel_reason_ck check (status <> 'cancelled' or nullif(trim(cancel_reason), '') is not null)
);

create index if not exists task_tasks_status_idx on public.task_tasks(status);
create index if not exists task_tasks_deadline_idx on public.task_tasks(deadline);
create index if not exists task_tasks_created_by_idx on public.task_tasks(created_by_employee_code);
create index if not exists task_tasks_category_idx on public.task_tasks(category_code);
create index if not exists task_tasks_occurrence_period_idx on public.task_tasks(occurrence_period);
create index if not exists task_tasks_batch_idx on public.task_tasks(batch_id) where batch_id is not null;

-- Chống trùng recurring occurrence THẬT (không phải theo YYYY-MM) — xem ghi chú đầu file.
create unique index if not exists task_tasks_series_occurrence_uq
  on public.task_tasks(recurring_series_id, scheduled_occurrence_at)
  where recurring_series_id is not null;

-- Migration Preflight P2 fix: khóa rule N.26/N.27 ("Draft được hard-delete;
-- Published/in_progress/completed/cancelled KHÔNG hard-delete — muốn bỏ
-- nghiệp vụ thì Cancel") thành DB guarantee thay vì chỉ là quy ước tầng ứng
-- dụng — vì 4 bảng con (task_assignees/task_events/task_comments/task_links)
-- đang ON DELETE CASCADE từ task_tasks, nếu không chặn ở đây thì 1 lệnh DELETE
-- published task sẽ xóa mất audit trail append-only (task_events) mà Z-51 yêu
-- cầu bất biến vĩnh viễn. Function RIÊNG (không trộn vào
-- task_forbid_update_delete() — semantics khác: đây là điều kiện theo OLD.status,
-- không phải "chặn tuyệt đối mọi UPDATE/DELETE"). Không SECURITY DEFINER
-- (không cần nâng quyền), không dynamic SQL, không lookup object nào khác
-- ngoài OLD.id/OLD.status (không có injection surface qua search_path), không
-- gọi hàm khác nên không thể recursion, chỉ BEFORE DELETE (không đụng
-- UPDATE/INSERT). Message nêu task id + status để trace, KHÔNG lộ title/
-- content/payload nhạy cảm của task.
create or replace function public.task_guard_task_delete() returns trigger as $$
begin
  if old.status <> 'draft' then
    raise exception 'PHF Task: không được hard-delete task % vì status hiện tại là ''%'' — chỉ task ở trạng thái draft mới được xóa cứng, task đã published dùng action Cancel (rule N.26/N.27).', old.id, old.status
      using errcode = '0A000';
  end if;
  return old;
end;
$$ language plpgsql;

drop trigger if exists task_tasks_guard_delete on public.task_tasks;
create trigger task_tasks_guard_delete before delete on public.task_tasks
  for each row execute function public.task_guard_task_delete();

-- ---------------------------------------------------------------------------
-- task_assignees
-- ---------------------------------------------------------------------------
create table if not exists public.task_assignees (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.task_tasks(id) on delete cascade,
  employee_code text not null,
  role text not null,
  is_active boolean not null default true,
  assigned_at timestamptz not null default now(),
  assigned_by_employee_code text not null,
  deactivated_at timestamptz,
  constraint task_assignees_role_ck check (role in ('primary', 'related')),
  constraint task_assignees_employee_ck check (nullif(trim(employee_code), '') is not null),
  constraint task_assignees_assigned_by_ck check (nullif(trim(assigned_by_employee_code), '') is not null)
);

-- Chỉ 1 primary active tại 1 thời điểm/task (F.9, Correction Gate mục C).
create unique index if not exists task_assignees_one_active_primary_uq
  on public.task_assignees(task_id)
  where role = 'primary' and is_active = true;

-- Migration Preflight P1 fix: KHÔNG dùng index chỉ giới hạn role='related' —
-- 2 index độc lập theo role riêng biệt để lọt case cùng 1 employee vừa là
-- active primary vừa là active related trên cùng task (2 unique khác trục
-- không cross-check nhau). Business rule LOCKED: 1 employee/1 task/1 thời
-- điểm chỉ được đúng 1 active assignment role (bất kể primary hay related).
-- Index rộng hơn này (task_id, employee_code) WHERE is_active=true vẫn giữ
-- nguyên hiệu lực chặn trùng active-related cũ (case cũ là tập con của case
-- mới), đồng thời chặn thêm case primary+related active đồng thời — không
-- đụng tới task_assignees_one_active_primary_uq (trục khác: theo task_id,
-- không theo employee_code, vẫn cho phép 1 primary khác employee tồn tại
-- song song 1 related). Partial unique index là đủ, không cần trigger.
create unique index if not exists task_assignees_one_active_assignment_per_employee_uq
  on public.task_assignees(task_id, employee_code)
  where is_active = true;

create index if not exists task_assignees_employee_idx on public.task_assignees(employee_code) where is_active = true;
create index if not exists task_assignees_task_idx on public.task_assignees(task_id);

-- ---------------------------------------------------------------------------
-- task_events (append-only audit — Z-51)
-- ---------------------------------------------------------------------------
create table if not exists public.task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.task_tasks(id) on delete cascade,
  event_type text not null,
  actor_employee_code text not null,
  payload jsonb not null default '{}'::jsonb,
  reason text,
  occurred_at timestamptz not null default now(),
  constraint task_events_event_type_ck check (event_type in (
    'published', 'assignment', 'transfer', 'progress', 'comment', 'deadline_change',
    'extension_request', 'extension_decision', 'priority_change', 'attachment', 'link',
    'completion', 'reopen', 'cancel', 'recurring_change', 'monthly_close', 'permission_change'
  )),
  constraint task_events_actor_ck check (nullif(trim(actor_employee_code), '') is not null)
);

create index if not exists task_events_task_idx on public.task_events(task_id, occurred_at desc);
create index if not exists task_events_type_idx on public.task_events(event_type);

drop trigger if exists task_events_forbid_update on public.task_events;
create trigger task_events_forbid_update before update on public.task_events
  for each row execute function public.task_forbid_update_delete();
drop trigger if exists task_events_forbid_delete on public.task_events;
create trigger task_events_forbid_delete before delete on public.task_events
  for each row execute function public.task_forbid_update_delete();

-- ---------------------------------------------------------------------------
-- task_comments (append-only, V1 không sửa/xóa — xem ghi chú mục R.35)
-- ---------------------------------------------------------------------------
create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.task_tasks(id) on delete cascade,
  author_employee_code text not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint task_comments_author_ck check (nullif(trim(author_employee_code), '') is not null),
  constraint task_comments_body_ck check (nullif(trim(body), '') is not null)
);

create index if not exists task_comments_task_idx on public.task_comments(task_id, created_at);

-- ---------------------------------------------------------------------------
-- task_links (V1: chỉ link tham chiếu — CHƯA file upload, xem mục Q.31-33)
-- ---------------------------------------------------------------------------
create table if not exists public.task_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.task_tasks(id) on delete cascade,
  side text not null,
  url text not null,
  label text,
  added_by_employee_code text not null,
  related_event_id uuid references public.task_events(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint task_links_side_ck check (side in ('input_reference', 'output_result', 'coordination')),
  constraint task_links_url_ck check (nullif(trim(url), '') is not null),
  constraint task_links_added_by_ck check (nullif(trim(added_by_employee_code), '') is not null)
);

create index if not exists task_links_task_idx on public.task_links(task_id);

-- ---------------------------------------------------------------------------
-- RLS: chặn hoàn toàn client trực tiếp (anon/authenticated) — mọi truy cập đi
-- qua server dùng service-role key, đúng convention checklist_*/knl_* hiện có.
-- ---------------------------------------------------------------------------
alter table public.task_categories enable row level security;
alter table public.task_tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_events enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_links enable row level security;

revoke all on public.task_categories from anon, authenticated;
revoke all on public.task_tasks from anon, authenticated;
revoke all on public.task_assignees from anon, authenticated;
revoke all on public.task_events from anon, authenticated;
revoke all on public.task_comments from anon, authenticated;
revoke all on public.task_links from anon, authenticated;

comment on table public.task_categories is 'PHF Task — danh mục category chuẩn hóa (không free-text, không hard-delete khi đã dùng).';
comment on table public.task_tasks is 'PHF Task — bảng task chính (giao_viec|de_xuat). occurrence_period CHỈ reporting, occurrence identity thật là scheduled_occurrence_at.';
comment on table public.task_assignees is 'PHF Task — người nhận (primary|related). Đúng 1 primary active/task tại 1 thời điểm (partial unique index).';
comment on table public.task_events is 'PHF Task — audit append-only (Z-51), chặn UPDATE/DELETE ở DB level qua trigger.';
comment on table public.task_comments is 'PHF Task — comment append-only trong task (V1 không sửa/xóa).';
comment on table public.task_links is 'PHF Task — link tham chiếu/kết quả/phối hợp theo side (input_reference|output_result|coordination).';

commit;

select table_name, (select count(*) from information_schema.columns c where c.table_schema = 'public' and c.table_name = t.table_name) as so_cot
from information_schema.tables t
where table_schema = 'public' and table_name in ('task_categories', 'task_tasks', 'task_assignees', 'task_events', 'task_comments', 'task_links')
order by table_name;
