-- PHF KNL — "Đề xuất nâng bậc" (Grade Promotion Proposal) workflow foundation, 1.51.0.
--
-- Scope (đã chốt ở TRACE REPORT batch 1, implement ở batch 2): CHỈ workflow
-- propose -> agree (nhiều tầng) -> approve/reject/withdraw. TUYỆT ĐỐI không
-- đụng lương/thu nhập — "approved" ở đây chỉ có nghĩa "Admin đã chấp thuận
-- proposal", KHÔNG ghi/ đổi knl_employee_compensation_assignments hay bất kỳ
-- bảng thu nhập nào. Hậu xử lý sau approved là bài toán riêng, KHÔNG nằm
-- trong migration hay RPC nào ở đây.
--
-- "Bậc hiện tại"/"bậc đề xuất" tham chiếu public.knl_compensation_grades
-- (thang lương, KHÔNG phải knl_grade_definitions — thang năng lực, xem TRACE
-- REPORT mục A/B) — CHỈ FK để đọc id/grade_code/grade_number, KHÔNG có cột
-- tiền nào trong 2 bảng dưới đây.
--
-- 2 bảng:
--   knl_grade_promotion_proposals       — current state, 1 dòng/proposal.
--   knl_grade_promotion_proposal_steps  — append-only timeline/audit, immutable
--                                          (chặn UPDATE/DELETE bằng trigger).
--
-- DB-level partial unique index enforce "mỗi subject tối đa 1 active
-- proposal" (status='pending') — KHÔNG chỉ app-level check (mục 12/8 yêu cầu
-- batch 1, nhắc lại rõ ở batch 2 mục 8).
--
-- CHƯA APPLY Production ở batch này — chỉ tạo file, PHF/Technical Lead
-- duyệt xong mới apply.

begin;

create table if not exists public.knl_grade_promotion_proposals (
  id uuid primary key default gen_random_uuid(),

  subject_employee_code text not null check (subject_employee_code = upper(btrim(subject_employee_code)) and subject_employee_code <> ''),
  subject_employee_name text not null check (length(btrim(subject_employee_name)) > 0),

  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),

  compensation_ladder_id uuid not null references public.knl_compensation_ladders(id) on delete restrict,
  compensation_version_id uuid not null references public.knl_compensation_versions(id) on delete restrict,

  -- Snapshot bậc hiện tại tại thời điểm tạo (mục 14 batch 1) — chỉ id/code/number,
  -- KHÔNG snapshot base_salary/hqcv/allowance nào.
  current_grade_id uuid not null references public.knl_compensation_grades(id) on delete restrict,
  current_grade_code text not null,
  current_grade_number integer not null check (current_grade_number > 0),

  -- Bậc đề xuất BAN ĐẦU — không đổi sau khi tạo (mục A/9 batch 1+2).
  proposed_grade_id uuid not null references public.knl_compensation_grades(id) on delete restrict,
  proposed_grade_code text not null,
  proposed_grade_number integer not null check (proposed_grade_number > current_grade_number),

  reason text not null check (length(btrim(reason)) >= 5),

  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),

  -- Định danh ngữ cảnh routing cần để REVALIDATE lại chain mỗi lượt xử lý
  -- (mục 15 batch 1, mục 5/7 batch 2) — KHÔNG dùng routing_snapshot để xử lý,
  -- chỉ để hiển thị "dự kiến lúc tạo". Sales: nếu subject không tự có quyền
  -- agree_proposal (NV Bán hàng thường), creator phải chọn 1 Trưởng ca hợp lệ
  -- — lưu lại ở đây để routing tái tạo đúng lại mỗi lần.
  selected_first_approver_employee_code text,
  routing_snapshot jsonb not null default '[]'::jsonb,
  current_step_index integer not null default 0 check (current_step_index >= 0),

  final_decided_grade_id uuid references public.knl_compensation_grades(id) on delete restrict,
  final_decided_grade_code text,
  final_decided_grade_number integer,
  final_decided_by text,
  final_decided_by_name text,
  final_decided_at timestamptz,

  rejected_reason text,
  rejected_by text,
  rejected_by_name text,
  rejected_at timestamptz,

  withdrawn_reason text,
  withdrawn_by text,
  withdrawn_by_name text,
  withdrawn_at timestamptz,

  updated_at timestamptz not null default now(),

  foreign key (proposed_grade_id, compensation_version_id) references public.knl_compensation_grades(id, version_id) on delete restrict,
  foreign key (current_grade_id, compensation_version_id) references public.knl_compensation_grades(id, version_id) on delete restrict
);

-- Mỗi subject tối đa 1 proposal đang 'pending' — DB-level, không chỉ app check.
create unique index if not exists knl_grade_promotion_proposal_active_uq
  on public.knl_grade_promotion_proposals(subject_employee_code) where status = 'pending';

create index if not exists knl_grade_promotion_proposal_status_idx
  on public.knl_grade_promotion_proposals(status, updated_at desc);
create index if not exists knl_grade_promotion_proposal_creator_idx
  on public.knl_grade_promotion_proposals(created_by, created_at desc);

create table if not exists public.knl_grade_promotion_proposal_steps (
  id bigint generated always as identity primary key,
  proposal_id uuid not null references public.knl_grade_promotion_proposals(id) on delete restrict,
  step_index integer not null check (step_index >= 0),

  actor_id text,
  actor_employee_code text,
  actor_name text,

  -- 'approve' = quyết định cuối của Admin (mục 11: APPROVED chỉ có nghĩa
  -- Admin đã chấp thuận), tách khỏi 'agree' (đồng ý ở tầng trung gian) để
  -- timeline đọc rõ ai là người kết thúc workflow.
  action text not null check (action in ('propose','agree','approve','reject','withdraw','reassign')),

  -- Bậc từng tầng kiến nghị (mục 8/17 batch 1) — snapshot id/code/number,
  -- KHÔNG có tiền. NULL cho action reject/withdraw/reassign.
  suggested_grade_id uuid references public.knl_compensation_grades(id) on delete restrict,
  suggested_grade_code text,
  suggested_grade_number integer,

  reason text,

  -- Chỉ dùng cho action='reassign' (mục 7 batch 2, broken route).
  reassigned_from_employee_code text,
  reassigned_to_employee_code text,

  acted_at timestamptz not null default now()
);

create index if not exists knl_grade_promotion_proposal_steps_proposal_idx
  on public.knl_grade_promotion_proposal_steps(proposal_id, step_index);

-- Append-only: chặn UPDATE/DELETE ở DB level (mục 8/13/17 batch 1: "không
-- hard delete, không overwrite action cũ").
create or replace function public.knl_grade_promotion_step_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'knl_grade_promotion_proposal_steps is append-only; UPDATE/DELETE is not allowed (attempted on proposal_id=%)', coalesce(old.proposal_id, new.proposal_id);
end
$$;

drop trigger if exists knl_grade_promotion_step_no_update on public.knl_grade_promotion_proposal_steps;
create trigger knl_grade_promotion_step_no_update
  before update on public.knl_grade_promotion_proposal_steps
  for each row execute function public.knl_grade_promotion_step_immutable();

drop trigger if exists knl_grade_promotion_step_no_delete on public.knl_grade_promotion_proposal_steps;
create trigger knl_grade_promotion_step_no_delete
  before delete on public.knl_grade_promotion_proposal_steps
  for each row execute function public.knl_grade_promotion_step_immutable();

commit;

-- Verification (read-only, safe to run after apply):
-- select table_name from information_schema.tables where table_schema='public'
--   and table_name in ('knl_grade_promotion_proposals','knl_grade_promotion_proposal_steps');
