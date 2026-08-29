begin;

-- =============================================================================
-- PHF Task Proposal V2 — company PostgreSQL `phf_hr`, schema `task`.
--
-- Áp dụng bởi deployer (actor có quyền postgres/docker) qua `psql -v
-- ON_ERROR_STOP=1 -f`, SAU khi Task Foundation + categories snapshot +
-- runtime identity/grants remediation đã live (đã verify read-only
-- 2026-08-29: 13 bảng task.*, 13 category active, flow_type CK đã chấp nhận
-- 'de_xuat', task_events_event_type_ck = 17 giá trị — khớp chính xác điều
-- kiện `drop/add constraint` bên dưới). Đã diễn tập đầy đủ trên container
-- E2E dùng-một-lần `phf_hr_e2e` (23/23 real-write + 25/25 full-stack). DOWN:
-- phf_hr_task_proposal_v2_DOWN.sql. Thay đổi thuần additive: 1 bảng mới +
-- 3 giá trị event_type mới + 1 GRANT — KHÔNG sửa bảng/nghiệp vụ hiện có.
--
-- Business locks (2026-08-29, đã LOCKED, xem BAN_GIAO Proposal V2 design):
--   1. Recipient = bất kỳ ai đang có quyền Giao việc (assign capability) theo
--      Permission Contract V1 hiện hành — resolve ở tầng app
--      (api/_lib/task-permissions.js::resolveProposalRecipientScope), KHÔNG
--      enforce ở DB layer (DB không có org/preset data).
--   2. Proposal chưa Accept KHÔNG phải Task chính thức — proposal_status là
--      state machine RIÊNG, tách hoàn toàn khỏi task.tasks.status (đã LOCKED
--      cho Giao việc, KHÔNG bị đụng bởi migration này).
--   3. Accept -> tạo task.tasks row MỚI (flow_type='giao_viec'), KHÔNG
--      convert/đổi flow_type của Proposal gốc.
--   4. Reject/Cancel bắt buộc reason — enforced ở DB CHECK (cùng pattern
--      task_tasks_cancel_reason_ck đã có).
--   5. task.tasks/task.events/task.assignees/task.categories KHÔNG bị sửa —
--      chỉ ALTER thêm 3 event_type mới vào CHECK constraint hiện có
--      (additive, không đổi giá trị cũ) + 1 bảng hoàn toàn mới.
--
-- Không đụng Permission Contract V1 (task.permission_*), không đụng
-- Reporting V2 (không có bảng/view Reporting nào trong migration này) —
-- flow_type='de_xuat' vẫn bị Reporting V2 loại trừ hoàn toàn như trước (xem
-- api/_lib/task-query-descriptor-builder.js:95 — không đổi bởi migration này).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- task.proposal_decisions — 1-1 với Proposal gốc (task.tasks.flow_type=
-- 'de_xuat'). Tách khỏi task.tasks.status theo đúng lock #2 — proposal_status
-- là state machine riêng: pending -> accepted | rejected | cancelled
-- (terminal). generated_task_id chỉ set khi accepted (lock #3).
-- -----------------------------------------------------------------------------
create table task.proposal_decisions (
  proposal_task_id uuid primary key references task.tasks(id) on delete restrict,
  recipient_employee_code text not null,
  proposal_status text not null default 'pending',
  decided_by_employee_code text,
  decided_at timestamptz,
  reject_reason text,
  cancel_reason text,
  generated_task_id uuid references task.tasks(id) on delete restrict,
  created_by_employee_code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_proposal_decisions_recipient_ck check (nullif(trim(recipient_employee_code), '') is not null),
  constraint task_proposal_decisions_created_by_ck check (nullif(trim(created_by_employee_code), '') is not null),
  constraint task_proposal_decisions_status_ck check (proposal_status in ('pending', 'accepted', 'rejected', 'cancelled')),
  constraint task_proposal_decisions_reject_reason_ck check (proposal_status <> 'rejected' or nullif(trim(reject_reason), '') is not null),
  constraint task_proposal_decisions_cancel_reason_ck check (proposal_status <> 'cancelled' or nullif(trim(cancel_reason), '') is not null),
  -- generated_task_id chỉ tồn tại khi VÀ CHỈ KHI accepted (2 chiều — lock #3).
  constraint task_proposal_decisions_generated_task_only_accepted_ck check (proposal_status = 'accepted' or generated_task_id is null),
  constraint task_proposal_decisions_accepted_needs_generated_task_ck check (proposal_status <> 'accepted' or generated_task_id is not null),
  -- decided_by/decided_at rỗng khi còn pending, bắt buộc khi đã terminal.
  constraint task_proposal_decisions_decided_consistency_ck check (
    (proposal_status = 'pending' and decided_by_employee_code is null and decided_at is null)
    or (proposal_status <> 'pending' and decided_by_employee_code is not null and decided_at is not null)
  ),
  -- Proposal không tự đề xuất cho chính mình (creator != recipient) — tránh
  -- vòng lặp vô nghĩa; self-task vẫn luôn đi qua Giao việc bình thường
  -- (EMPLOYEE_SELF_TASK_PRESERVED không liên quan bảng này).
  constraint task_proposal_decisions_recipient_not_creator_ck check (
    upper(trim(recipient_employee_code)) <> upper(trim(created_by_employee_code))
  )
);

-- 1 Task mới sinh chỉ được link từ ĐÚNG 1 Proposal (PK proposal_task_id đã
-- đảm bảo chiều ngược lại: 1 Proposal chỉ decide đúng 1 lần).
create unique index task_proposal_decisions_generated_task_uq
  on task.proposal_decisions(generated_task_id) where generated_task_id is not null;
create index task_proposal_decisions_recipient_pending_idx
  on task.proposal_decisions(recipient_employee_code) where proposal_status = 'pending';
create index task_proposal_decisions_status_idx on task.proposal_decisions(proposal_status);
create index task_proposal_decisions_created_by_idx on task.proposal_decisions(created_by_employee_code);

-- Backstop DB-level: 1 dòng proposal_decisions chỉ được trỏ vào 1 task.tasks
-- row có flow_type='de_xuat' (không cho lỡ tay gắn cho row 'giao_viec').
-- resolveProposalRecipientScope không chạy được ở DB (không có org data) nên
-- KHÔNG thể enforce population recipient ở đây — chỉ enforce đúng shape
-- flow_type, phần population enforce ở app layer (api/_lib/task-permissions.js).
create or replace function task.task_guard_proposal_decision_flow_type() returns trigger as $$
declare
  v_flow_type text;
begin
  select flow_type into v_flow_type from task.tasks where id = new.proposal_task_id;
  if v_flow_type is distinct from 'de_xuat' then
    raise exception 'PHF Task Proposal V2: proposal_task_id % không phải flow_type=de_xuat.', new.proposal_task_id
      using errcode = '23514';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger task_proposal_decisions_guard_flow_type before insert on task.proposal_decisions
  for each row execute function task.task_guard_proposal_decision_flow_type();

comment on table task.proposal_decisions is 'PHF Task Proposal V2 — quyết định 1-1 với Proposal gốc (task.tasks.flow_type=de_xuat). State machine RIÊNG (pending/accepted/rejected/cancelled), tách khỏi task.tasks.status. generated_task_id chỉ set khi accepted, KHÔNG convert flow_type của Proposal gốc.';

-- -----------------------------------------------------------------------------
-- task.events — additive: thêm 3 event_type mới cho lifecycle Proposal.
-- KHÔNG đổi/xóa giá trị cũ nào (append-only append đúng nghĩa constraint).
-- -----------------------------------------------------------------------------
alter table task.events drop constraint task_events_event_type_ck;
alter table task.events add constraint task_events_event_type_ck check (event_type in (
  'published', 'assignment', 'transfer', 'progress', 'comment', 'deadline_change',
  'extension_request', 'extension_decision', 'priority_change', 'attachment', 'link',
  'completion', 'reopen', 'cancel', 'recurring_change', 'monthly_close', 'permission_change',
  'proposal_accept', 'proposal_reject', 'proposal_cancel'
));

-- -----------------------------------------------------------------------------
-- GRANTS — phf_hr_app, cùng convention "minimal, explicit" của Foundation
-- migration (không UPDATE-only cho append-only đã có; proposal_decisions
-- CẦN update vì state machine transition update tại chỗ, không phải
-- append-only theo thiết kế — audit đầy đủ nằm ở task.events, không phải
-- ở bảng này).
-- -----------------------------------------------------------------------------
grant select, insert, update on task.proposal_decisions to phf_hr_app;

commit;

-- =============================================================================
-- VALIDATION QUERIES (read-only, chạy SAU khi apply)
-- =============================================================================

-- 1. Bảng mới tồn tại đúng schema
select table_name from information_schema.tables
where table_schema = 'task' and table_name = 'proposal_decisions';

-- 2. Constraint đầy đủ
select conname, contype from pg_constraint
where conrelid = 'task.proposal_decisions'::regclass order by conname;

-- 3. event_type CHECK đã mở rộng đúng 3 giá trị mới
select pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'task.events'::regclass and conname = 'task_events_event_type_ck';

-- 4. Grants
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'task' and table_name = 'proposal_decisions' order by grantee, privilege_type;
