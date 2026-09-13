-- PHF Training Hub — Canonical Department Foundation V1 (Batch A)
-- Target: Supabase MAIN (Training Hub People Master), table employee_profiles.
--
-- ADDITIVE ONLY. Adds one nullable column. Does NOT touch `employees` or
-- `user_accounts` (explicit constraint: no write-back/sync into shared
-- `employees` yet — Checklist/Classroom also read that table).
--
-- Safe to run multiple times (IF NOT EXISTS). No row is deleted or altered
-- by this file — see the separate backfill script for populating the column
-- from existing canonical department display names (exact match only).
--
-- Rollback: PHF_TRAINING_HUB_EMPLOYEE_PROFILES_DEPARTMENT_KEY_V1_DOWN.sql

ALTER TABLE employee_profiles
  ADD COLUMN IF NOT EXISTS department_key text NULL;

COMMENT ON COLUMN employee_profiles.department_key IS
  'Canonical department key (see api/_lib/department-catalog.js), e.g. dept_ban_hang. Nullable: NULL means not yet backfilled/assigned. Additive column, Batch A of Training Hub canonical-department foundation.';

-- Optional but recommended once this rolls out broadly: constrain future
-- values to the known catalog. Left OFF in Batch A (commented) so the
-- migration stays purely additive/non-blocking while department_key is only
-- being introduced — enable after backfill + write-path validation have both
-- been live for a while and every active row is known-clean.
-- ALTER TABLE employee_profiles
--   ADD CONSTRAINT employee_profiles_department_key_chk
--   CHECK (department_key IS NULL OR department_key IN (
--     'dept_ban_giam_doc','dept_ban_hang','dept_ban_hang_online',
--     'dept_goi_qua_che_bien','dept_kho_van','dept_quan_tri_tong_hop',
--     'dept_tai_chinh_ke_toan','dept_thu_mua','dept_truyen_thong_quang_cao'
--   ));
