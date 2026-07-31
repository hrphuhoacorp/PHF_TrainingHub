-- PHF Checklist 1.30.8
-- Cấp quyền xuất đúng phạm vi xem cho nhóm Trưởng ca bán hàng hiện hữu.
-- Không thay đổi review_scope; quyền thẩm định vẫn chỉ theo quản lý trực tiếp.

begin;

with targets as materialized (
  select *
  from public.checklist_permission_grants
  where preset_code = 'TRUONG_CA_BH'
    and is_active = true
), updated as (
  update public.checklist_permission_grants g
  set
    capabilities = coalesce(g.capabilities, '{}'::jsonb) || '{"export_data": true}'::jsonb,
    export_scope = jsonb_build_object(
      'type', 'department_branch',
      'values', jsonb_build_array('Bán hàng', 'Phú Lợi', 'Ngô Quyền', 'Lái Thiêu')
    ),
    updated_at = now(),
    reason = case
      when coalesce(g.reason, '') = '' then 'Bổ sung quyền xuất dữ liệu Bán hàng theo phạm vi xem tại phiên bản 1.30.8'
      else g.reason || ' | Bổ sung quyền xuất dữ liệu Bán hàng theo phạm vi xem tại phiên bản 1.30.8'
    end
  from targets t
  where g.id = t.id
  returning g.*
)
insert into public.checklist_permission_grant_history (
  grant_id, action, before_data, after_data, reason, changed_by, changed_by_name
)
select
  u.id,
  'enable_export_scope',
  to_jsonb(t),
  to_jsonb(u),
  'Bổ sung quyền xuất dữ liệu Bán hàng; giữ nguyên phạm vi thẩm định trực tiếp.',
  'system-migration-1.30.8',
  'Hệ thống'
from updated u
join targets t on t.id = u.id;

commit;
