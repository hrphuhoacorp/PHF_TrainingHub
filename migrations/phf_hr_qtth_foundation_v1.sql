-- =============================================================================
-- PHF HR — QUẢN TRỊ TỔNG HỢP (QTTH) V1 · FOUNDATION MIGRATION (Batch 01)
-- Target : Company PostgreSQL, database phf_hr (dev/throwaway: phf_hr_e2e), schema qtth
-- Owner  : phf_hr_owner   ·   Runtime role : phf_hr_app (NOLOGIN; phf_hr_runtime
--          logs in and SET LOCAL ROLE phf_hr_app per transaction — same pattern
--          as PHF Task / Competition).
--
-- SCOPE (Batch 01): DATA STRUCTURE + hard invariants ONLY.
--   - module permissions (can_view_qtth / can_view_operations) — per person
--   - permission-manager grant (Admin grants "quản lý phân quyền" to a user,
--     e.g. Thắng, without making them a system Admin)
--   - QTTH management classification (unit / group / staff kind) by MONTH period
--   - QTTH dictionaries (CN/Đơn vị QTTH, Phòng/Nhóm QTTH)
--   - append-only history for permission + classification
--   - grants to phf_hr_app limited strictly to qtth.*
--   NO reporting engine, NO payroll, NO Vận hành publish mechanism (deferred).
--   NO cross-database FK to Supabase People Master — employee_code is an
--   EXTERNAL identity reference stored as text, resolved & verified on the
--   Vercel side (People Master, Supabase MAIN) before any write reaches here.
--
-- DOWN = phf_hr_qtth_foundation_v1_DOWN.sql.
-- REVIEW ONLY until a human/deployer applies it to the verified dev DB.
-- NEVER run against Production in this batch.
-- =============================================================================
\set ON_ERROR_STOP on

BEGIN;

CREATE SCHEMA IF NOT EXISTS qtth;
ALTER SCHEMA qtth OWNER TO phf_hr_owner;
COMMENT ON SCHEMA qtth IS
  'PHF HR Quản trị tổng hợp (QTTH) V1 canonical data — module permissions and '
  'management classification. People/account master is external (Supabase '
  'People Master); identity is referenced by value (employee_code / account_id), '
  'never by FK. QTTH never writes back to People Master.';

SET ROLE phf_hr_owner;
DO $$ BEGIN
  IF current_user <> 'phf_hr_owner' THEN
    RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %. Abort before DDL.', current_user;
  END IF;
END $$;

SET LOCAL search_path = qtth, public;

-- =============================================================================
-- SHARED HELPERS
-- =============================================================================
CREATE FUNCTION qtth.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE FUNCTION qtth.block_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % on %.% is not allowed', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END $$;

-- =============================================================================
-- 1. DICTIONARIES — CN/Đơn vị QTTH  &  Phòng/Nhóm QTTH
--    Admin-managed. Reorder + rename + active/inactive. No hard delete once
--    referenced (enforced at the service layer; the row stays, is_active=false).
-- =============================================================================
CREATE TABLE qtth.dict_unit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  sort_order   integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by_account_id text,
  created_by_name       text
);
CREATE UNIQUE INDEX dict_unit_name_ci_uq ON qtth.dict_unit (lower(name));
CREATE TRIGGER dict_unit_touch BEFORE UPDATE ON qtth.dict_unit
  FOR EACH ROW EXECUTE FUNCTION qtth.set_updated_at();

CREATE TABLE qtth.dict_group (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  sort_order   integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by_account_id text,
  created_by_name       text
);
CREATE UNIQUE INDEX dict_group_name_ci_uq ON qtth.dict_group (lower(name));
CREATE TRIGGER dict_group_touch BEFORE UPDATE ON qtth.dict_group
  FOR EACH ROW EXECUTE FUNCTION qtth.set_updated_at();

-- =============================================================================
-- 2. MODULE PERMISSIONS — two INDEPENDENT booleans, per person, never bulk.
--    Row is created lazily on first write; absence == both false.
--    A person going inactive in People Master is enforced at READ time in the
--    service layer (row is kept, access is denied) — §6 inactive contract.
-- =============================================================================
CREATE TABLE qtth.module_permission (
  employee_code        text PRIMARY KEY,
  can_view_qtth        boolean NOT NULL DEFAULT false,
  can_view_operations  boolean NOT NULL DEFAULT false,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by_account_id text,
  updated_by_name       text
);
CREATE TRIGGER module_permission_touch BEFORE UPDATE ON qtth.module_permission
  FOR EACH ROW EXECUTE FUNCTION qtth.set_updated_at();

-- Permission-manager grant. Admin (system) is ALWAYS a permission manager and
-- is NOT stored here. This table is for non-Admin users (e.g. Thắng) that Admin
-- entrusts with granting/revoking can_view_qtth / can_view_operations for
-- others and with full module access. It is itself only editable by a system
-- Admin (service-layer enforced).
CREATE TABLE qtth.permission_manager_grant (
  employee_code        text PRIMARY KEY,
  is_active            boolean NOT NULL DEFAULT true,
  granted_by_account_id text,
  granted_by_name       text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER permission_manager_grant_touch BEFORE UPDATE ON qtth.permission_manager_grant
  FOR EACH ROW EXECUTE FUNCTION qtth.set_updated_at();

CREATE TABLE qtth.permission_history (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_code       text NOT NULL,
  field               text NOT NULL
                        CHECK (field IN ('can_view_qtth','can_view_operations','permission_manager')),
  before_value        boolean,
  after_value         boolean,
  changed_by_account_id text,
  changed_by_name       text,
  changed_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX permission_history_emp_idx ON qtth.permission_history (employee_code, changed_at DESC);
CREATE TRIGGER permission_history_no_update
  BEFORE UPDATE OR DELETE OR TRUNCATE ON qtth.permission_history
  FOR EACH STATEMENT EXECUTE FUNCTION qtth.block_history_mutation();

-- =============================================================================
-- 3. MANAGEMENT CLASSIFICATION — by MONTH period (YYYY-MM), §12 semantics.
--    unit_id / group_id are nullable = "Chưa phân loại".
--    staff_kind: 'direct' | 'indirect' | NULL (= "Chưa xác định"). No 3rd kind.
--    source_department_snapshot = the People Master department captured at the
--    time of the last classification edit, for the §9 "phòng ban nguồn đã thay
--    đổi" warning (compared against live People Master at read time).
-- =============================================================================
CREATE TABLE qtth.classification (
  employee_code       text NOT NULL,
  period              text NOT NULL CHECK (period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  unit_id             uuid REFERENCES qtth.dict_unit (id),
  group_id            uuid REFERENCES qtth.dict_group (id),
  staff_kind          text CHECK (staff_kind IN ('direct','indirect')),
  source_department_snapshot text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by_account_id text,
  updated_by_name       text,
  PRIMARY KEY (employee_code, period)
);
CREATE INDEX classification_period_idx ON qtth.classification (period);
CREATE TRIGGER classification_touch BEFORE UPDATE ON qtth.classification
  FOR EACH ROW EXECUTE FUNCTION qtth.set_updated_at();

CREATE TABLE qtth.classification_history (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_code       text NOT NULL,
  period              text NOT NULL,
  field               text NOT NULL CHECK (field IN ('unit_id','group_id','staff_kind')),
  before_value        text,
  after_value         text,
  changed_by_account_id text,
  changed_by_name       text,
  changed_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX classification_history_emp_idx ON qtth.classification_history (employee_code, period, changed_at DESC);
CREATE TRIGGER classification_history_no_update
  BEFORE UPDATE OR DELETE OR TRUNCATE ON qtth.classification_history
  FOR EACH STATEMENT EXECUTE FUNCTION qtth.block_history_mutation();

-- =============================================================================
-- GRANTS — phf_hr_app only, qtth.* only, explicit, no wildcard, no PUBLIC.
-- No ALTER DEFAULT PRIVILEGES: every future qtth table needs its own GRANT.
-- =============================================================================
GRANT USAGE ON SCHEMA qtth TO phf_hr_app;

GRANT SELECT, INSERT, UPDATE ON qtth.dict_unit                TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE ON qtth.dict_group               TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE ON qtth.module_permission        TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE ON qtth.permission_manager_grant TO phf_hr_app;
GRANT SELECT, INSERT         ON qtth.permission_history       TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE ON qtth.classification           TO phf_hr_app;
GRANT SELECT, INSERT         ON qtth.classification_history   TO phf_hr_app;

RESET ROLE;

COMMIT;
