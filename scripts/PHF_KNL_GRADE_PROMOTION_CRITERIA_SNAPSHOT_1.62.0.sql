-- PHF KNL — "Đề xuất nâng bậc" mở rộng: snapshot Đánh giá theo tiêu chí năng
-- lực, 1.62.0.
--
-- KHÔNG sửa scripts/PHF_KNL_GRADE_PROMOTION_PROPOSAL_1.51.0.sql (file cũ giữ
-- nguyên) — migration này CHỈ bổ sung 1 cột mới lên bảng đã có + thay thế
-- (create or replace) đúng 1 hàm RPC propose() để ghi thêm cột đó. Hàm
-- transition() (agree/approve/reject/withdraw) KHÔNG cần sửa: UPDATE bên
-- trong nó liệt kê tường minh từng cột — criteria_snapshot không nằm trong
-- danh sách đó nên KHÔNG BAO GIỜ bị ghi đè bởi transition(), bất kể p_patch
-- gửi lên có chứa gì — đây chính là cơ chế đảm bảo "snapshot immutable sau
-- khi submit" mà không cần trigger chặn UPDATE riêng.
--
-- Business decisions đã chốt (Phase 2):
--   - Compensation grade và competency grade là 2 hệ khác nhau.
--   - proposed compensation grade_code CHỈ là khóa mapping có kiểm chứng
--     sang public.knl_grade_definitions (framework KNL ACTIVE của subject).
--   - Không resolve được mapping, hoặc grade không có requirements nào ->
--     BLOCK tạo/gửi proposal ở tầng Node (lib/knl-grade-proposals.js) —
--     KHÔNG cho phép proposal rỗng lọt xuống DB.
--   - Assessment V1: người khởi tạo đánh giá Đạt/Chưa đạt + ghi chú từng
--     tiêu chí; agree/approve CHỈ xem lại snapshot, không sửa.
--
-- CHƯA APPLY Production — chỉ tạo file, chờ duyệt migration.

begin;

alter table public.knl_grade_promotion_proposals
  add column if not exists criteria_snapshot jsonb not null default '{}'::jsonb;

comment on column public.knl_grade_promotion_proposals.criteria_snapshot is
  'Snapshot BẤT BIẾN (ghi 1 lần lúc propose, qua knl_grade_promotion_propose() — knl_grade_promotion_transition() không có cột này trong UPDATE nên không thể sửa) gồm: frameworkVersionId, competencyGradeId, gradeCode, framework{code,name,versionNumber}, groups[].items[]{id,name,requiredLevelNumber,requiredColumnLabel,content,result,note}, assessedAt/assessedById/assessedByName. KHÔNG chứa bất kỳ field tiền lương nào (base_salary/hqcv/allowance).';

-- knl_grade_promotion_propose(): giữ NGUYÊN toàn bộ tham số/behavior gốc
-- (1.51.0), CHỈ thêm insert criteria_snapshot từ p_proposal->'criteria_snapshot'
-- (Node tính toán + validate đầy đủ trước khi gọi RPC — RPC vẫn CHỈ ghi
-- atomic, không tự quyết định business rule nào, đúng nguyên tắc đã chốt ở
-- 1.51.0).
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
    reason, status, selected_first_approver_employee_code, routing_snapshot, current_step_index,
    criteria_snapshot
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
    coalesce((p_proposal->>'current_step_index')::integer, 0),
    coalesce(p_proposal->'criteria_snapshot','{}'::jsonb)
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

commit;

-- Verification (read-only, safe to run after apply):
-- select column_name from information_schema.columns where table_schema='public'
--   and table_name='knl_grade_promotion_proposals' and column_name='criteria_snapshot';
-- select prosrc from pg_proc where proname='knl_grade_promotion_propose'; -- xác nhận có nhắc criteria_snapshot
