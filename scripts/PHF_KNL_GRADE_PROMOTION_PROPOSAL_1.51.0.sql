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

-- ---------------------------------------------------------------------------
-- BATCH 2.1 HARDENING — atomic RPC. Trước batch này, Node làm 2 lệnh ghi rời
-- (update proposals rồi insert steps) — Technical Lead xác định đây là rủi ro
-- không chấp nhận được cho workflow này (có thể lệch trạng thái nếu request
-- thứ 2 crash giữa 2 lệnh). Một function call PL/pgSQL LUÔN atomic trong
-- Postgres (implicit transaction) — dồn cả state change + audit step vào một
-- lệnh RPC duy nhất, cùng commit hoặc cùng rollback, không có ngoại lệ. Toàn
-- bộ business logic (routing, chấm quyền, chặn bậc) vẫn nằm ở Node
-- (lib/knl-grade-proposals.js) — RPC ở đây CHỈ làm đúng 1 việc: ghi atomic,
-- không tự quyết định business rule nào (đúng khuyến nghị TRACE REPORT batch 1
-- mục 5d, tránh nhân đôi logic ở 2 ngôn ngữ).
--
-- knl_grade_promotion_propose(): tạo proposal + (các) step khởi tạo trong
-- cùng 1 transaction. Nếu vi phạm knl_grade_promotion_proposal_active_uq
-- (đã có 1 proposal 'pending' cho subject này), toàn bộ insert (kể cả steps)
-- rollback cùng nhau — không có proposal mồ côi không có step, hoặc step
-- không có proposal.
create or replace function public.knl_grade_promotion_propose(
  p_proposal jsonb,
  p_steps jsonb
) returns public.knl_grade_promotion_proposals
language plpgsql as $$
declare
  v_row public.knl_grade_promotion_proposals;
begin
  insert into public.knl_grade_promotion_proposals (
    subject_employee_code, subject_employee_name, created_by, created_by_name,
    compensation_ladder_id, compensation_version_id,
    current_grade_id, current_grade_code, current_grade_number,
    proposed_grade_id, proposed_grade_code, proposed_grade_number,
    reason, status, selected_first_approver_employee_code, routing_snapshot, current_step_index
  ) values (
    p_proposal->>'subject_employee_code',
    p_proposal->>'subject_employee_name',
    nullif(p_proposal->>'created_by',''),
    nullif(p_proposal->>'created_by_name',''),
    (p_proposal->>'compensation_ladder_id')::uuid,
    (p_proposal->>'compensation_version_id')::uuid,
    (p_proposal->>'current_grade_id')::uuid,
    p_proposal->>'current_grade_code',
    (p_proposal->>'current_grade_number')::integer,
    (p_proposal->>'proposed_grade_id')::uuid,
    p_proposal->>'proposed_grade_code',
    (p_proposal->>'proposed_grade_number')::integer,
    p_proposal->>'reason',
    'pending',
    nullif(p_proposal->>'selected_first_approver_employee_code',''),
    coalesce(p_proposal->'routing_snapshot','[]'::jsonb),
    coalesce((p_proposal->>'current_step_index')::integer, 0)
  ) returning * into v_row;

  insert into public.knl_grade_promotion_proposal_steps (
    proposal_id, step_index, actor_id, actor_employee_code, actor_name, action,
    suggested_grade_id, suggested_grade_code, suggested_grade_number, reason
  )
  select
    v_row.id,
    (s->>'step_index')::integer,
    nullif(s->>'actor_id',''),
    nullif(s->>'actor_employee_code',''),
    nullif(s->>'actor_name',''),
    s->>'action',
    nullif(s->>'suggested_grade_id','')::uuid,
    nullif(s->>'suggested_grade_code',''),
    nullif(s->>'suggested_grade_number','')::integer,
    nullif(s->>'reason','')
  from jsonb_array_elements(p_steps) as s;

  return v_row;
end
$$;

-- knl_grade_promotion_transition(): dùng chung cho agree/approve/reject/
-- withdraw (+ reassign audit đi kèm nếu có) — patch proposal + insert 1..2
-- step trong cùng 1 transaction. p_expected_status/p_expected_step_index là
-- optimistic-concurrency guard (đọc lại row bằng SELECT ... FOR UPDATE trước
-- khi so khớp — khoá đúng row này cho tới khi transaction kết thúc, chặn
-- race condition giữa 2 request xử lý đồng thời cùng 1 proposal): nếu trạng
-- thái đã đổi so với lúc Node đọc để tính toán (vd người khác vừa xử lý xong),
-- toàn bộ transaction rollback với lỗi PROPOSAL_STATE_CHANGED — Node dịch lỗi
-- này thành 409 rõ ràng, KHÔNG âm thầm ghi đè quyết định của người khác.
-- p_expected_step_index có thể NULL (bỏ qua check đó — dùng cho withdraw, vốn
-- không gắn với 1 step_index cụ thể).
create or replace function public.knl_grade_promotion_transition(
  p_proposal_id uuid,
  p_expected_status text,
  p_expected_step_index integer,
  p_patch jsonb,
  p_steps jsonb
) returns public.knl_grade_promotion_proposals
language plpgsql as $$
declare
  v_row public.knl_grade_promotion_proposals;
begin
  select * into v_row from public.knl_grade_promotion_proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'PROPOSAL_NOT_FOUND';
  end if;
  if v_row.status <> p_expected_status then
    raise exception 'PROPOSAL_STATE_CHANGED';
  end if;
  if p_expected_step_index is not null and v_row.current_step_index <> p_expected_step_index then
    raise exception 'PROPOSAL_STATE_CHANGED';
  end if;

  update public.knl_grade_promotion_proposals set
    status = coalesce(p_patch->>'status', status),
    current_step_index = coalesce((p_patch->>'current_step_index')::integer, current_step_index),
    routing_snapshot = coalesce(p_patch->'routing_snapshot', routing_snapshot),
    final_decided_grade_id = coalesce(nullif(p_patch->>'final_decided_grade_id','')::uuid, final_decided_grade_id),
    final_decided_grade_code = coalesce(p_patch->>'final_decided_grade_code', final_decided_grade_code),
    final_decided_grade_number = coalesce((p_patch->>'final_decided_grade_number')::integer, final_decided_grade_number),
    final_decided_by = coalesce(p_patch->>'final_decided_by', final_decided_by),
    final_decided_by_name = coalesce(p_patch->>'final_decided_by_name', final_decided_by_name),
    final_decided_at = coalesce((p_patch->>'final_decided_at')::timestamptz, final_decided_at),
    rejected_reason = coalesce(p_patch->>'rejected_reason', rejected_reason),
    rejected_by = coalesce(p_patch->>'rejected_by', rejected_by),
    rejected_by_name = coalesce(p_patch->>'rejected_by_name', rejected_by_name),
    rejected_at = coalesce((p_patch->>'rejected_at')::timestamptz, rejected_at),
    withdrawn_reason = coalesce(p_patch->>'withdrawn_reason', withdrawn_reason),
    withdrawn_by = coalesce(p_patch->>'withdrawn_by', withdrawn_by),
    withdrawn_by_name = coalesce(p_patch->>'withdrawn_by_name', withdrawn_by_name),
    withdrawn_at = coalesce((p_patch->>'withdrawn_at')::timestamptz, withdrawn_at),
    updated_at = now()
  where id = p_proposal_id
  returning * into v_row;

  insert into public.knl_grade_promotion_proposal_steps (
    proposal_id, step_index, actor_id, actor_employee_code, actor_name, action,
    suggested_grade_id, suggested_grade_code, suggested_grade_number, reason,
    reassigned_from_employee_code, reassigned_to_employee_code
  )
  select
    p_proposal_id,
    (s->>'step_index')::integer,
    nullif(s->>'actor_id',''),
    nullif(s->>'actor_employee_code',''),
    nullif(s->>'actor_name',''),
    s->>'action',
    nullif(s->>'suggested_grade_id','')::uuid,
    nullif(s->>'suggested_grade_code',''),
    nullif(s->>'suggested_grade_number','')::integer,
    nullif(s->>'reason',''),
    nullif(s->>'reassigned_from_employee_code',''),
    nullif(s->>'reassigned_to_employee_code','')
  from jsonb_array_elements(p_steps) as s;

  return v_row;
end
$$;

commit;

-- Verification (read-only, safe to run after apply):
-- select table_name from information_schema.tables where table_schema='public'
--   and table_name in ('knl_grade_promotion_proposals','knl_grade_promotion_proposal_steps');
-- select proname from pg_proc where proname in ('knl_grade_promotion_propose','knl_grade_promotion_transition');
