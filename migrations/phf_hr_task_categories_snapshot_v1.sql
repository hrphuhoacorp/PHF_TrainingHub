-- =============================================================================
-- PHF HR — Task category snapshot import (Gate S2C artifact)
-- Target: database phf_hr, schema task, table task.categories
--
-- REVIEW ONLY. DO NOT EXECUTE. Not committed/pushed/deployed.
--
-- SOURCE: verbatim from scripts/PHF_TASK_CATEGORY_CREATE_FOUNDATION_1.70.0.sql
-- PHẦN 2, lines 59-74 — this is the file's own seed statement, self-labeled
-- "Business Owner đã CHỐT, KHÔNG phải demo/suggestion". category_code/
-- display_name/sort_order values are taken VERBATIM, not reconstructed from
-- memory. Matches exactly the 13 categories visible in the Production
-- category dropdown screenshot (Báo cáo, Tài chính, Kho vận, Nhân sự,
-- Kinh doanh, Công việc tổng thể, Thu mua, Chăm sóc khách hàng, Dự án,
-- Phát sinh khác, Đào tạo, Sửa chữa, Thanh toán).
--
-- NOTE ON color/description: the seed statement in the source file does NOT
-- set these 2 columns — it only inserts category_code/display_name/
-- is_active/sort_order, so color/description fall back to the table's own
-- DEFAULTs ('#64748B' and '' respectively per PHF_TASK_FOUNDATION_1.66.0.sql).
-- If an Admin has since customized any category's color/description via the
-- UI on Production, THIS SNAPSHOT WOULD NOT REFLECT THAT — this artifact
-- only reproduces the ORIGINAL seed, not necessarily current live state of
-- those 2 cosmetic fields. category_code/display_name/sort_order/is_active
-- are the fields that matter for FK integrity and are correct regardless.
--
-- CATEGORY_COUNT = 13 (verified count from source file, matches screenshot)
-- =============================================================================
--
-- ROLE ACTIVATION — separate psql -f invocation = separate session, does NOT
-- inherit SET ROLE from phf_hr_task_foundation_v1.sql's session. Self-verified
-- here too, same pattern (see that file for full rationale). Using
-- phf_hr_app (not phf_hr_owner) here deliberately — this also empirically
-- proves the GRANT ... TO phf_hr_app statements in the foundation file
-- actually work as intended (INSERT via the real runtime role, not the
-- owner bypassing grants).
\set ON_ERROR_STOP on

SET ROLE phf_hr_app;

DO $$
begin
  if current_user <> 'phf_hr_app' then
    raise exception 'ROLE_NOT_ACTIVE: expected current_user=phf_hr_app, got %. Aborting before any INSERT runs.', current_user;
  end if;
end $$;

begin;

insert into task.categories (category_code, display_name, is_active, sort_order)
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

commit;

-- Validation (read-only)
select category_code, display_name, color, description, is_active, sort_order
from task.categories order by sort_order;
-- expected: exactly 13 rows, sort_order 1..13, matches screenshot order

select count(*) as category_count from task.categories;
-- expected: 13
