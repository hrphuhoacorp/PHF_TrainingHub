-- =============================================================================
-- PHF HR — QTTH TRUTH DATA · "CHI PHÍ XỬ LÝ" (PROCESSING COST) FOUNDATION V1
-- Target : Company PostgreSQL, database phf_hr (dev/throwaway: phf_hr_e2e), schema processing_cost
-- Owner  : phf_hr_owner   ·   Runtime role : phf_hr_app (SET LOCAL ROLE per txn),
--          same pattern as Payroll / BHXH / Accounting / qtth.
--
-- SCOPE (V1): monthly, per-employee flat amount upload. Natural key for V1 =
-- (period_month, employee_code). Minimal 3-table shape (NOT payroll's 6-table
-- RAW+NORMALIZED+DELTA+TEMPLATE machinery — this source is a fixed 3-column
-- schema, no schema-drift step, no reconciliation-arithmetic layer):
--   1. import        — one row per period_month
--   2. import_file   — one row per uploaded version (V1, V2, …); re-uploading
--      a byte-identical file (same sha256) for a period does NOT create a
--      spurious new version (dedupe-by-sha256-per-period, same as payroll).
--   3. normalized    — one row per (file_id, employee_code); within-file
--      duplicate employee_code is NEVER resolved by picking a winner — every
--      duplicated code is excluded ENTIRELY from this table (nothing
--      persisted for it) and reported as a blocking NEEDS_REVIEW warning in
--      import_file.validation (see qtth-processing-cost-normalize.js /
--      qtth-processing-cost.js). confirmImport() refuses to confirm a file
--      while any duplicate remains, so this table can never carry two rows
--      for the same employee_code in one file_id, and never carries a
--      "chosen" value for a code that was ambiguous in the source file.
--
-- Employee identity is EXTERNAL (People Master / Supabase MAIN) — referenced
-- by employee_code TEXT, never an FK, never auto-created here. Unknown codes
-- (not found in People Master) ARE still persisted here so they stay visible
-- in preview (people_master_matched=false), but confirmImport() BLOCKS
-- confirmation until every unknown code is corrected or removed from the
-- source file and re-uploaded. NEVER resolved by fuzzy/name matching.
--
-- Explicit V1 non-goals (do NOT add here): personal income report, advance/
-- deduction logic, personal income tax (TNCN) logic, Total Personnel Cost
-- aggregation. This source is NOT wired into payroll's costTruth aggregation.
--
-- DOWN = phf_hr_qtth_processing_cost_v1_DOWN.sql. REVIEW ONLY. Never run on Production.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE SCHEMA IF NOT EXISTS processing_cost;
ALTER SCHEMA processing_cost OWNER TO phf_hr_owner;
COMMENT ON SCHEMA processing_cost IS
  'PHF HR QTTH Truth Data — "Chi phí xử lý" (processing cost) monthly per-employee '
  'flat-amount import. Identity is external (Supabase People Master), referenced '
  'by employee_code text. V1 = upload foundation only, no aggregation/report logic.';

SET ROLE phf_hr_owner;
DO $$ BEGIN IF current_user <> 'phf_hr_owner' THEN
  RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %.', current_user; END IF; END $$;
SET LOCAL search_path = processing_cost, public;

CREATE FUNCTION processing_cost.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- 1. one row per period
CREATE TABLE processing_cost.import (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month      text NOT NULL UNIQUE CHECK (period_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active')),
  current_file_id   uuid,            -- FK set after first confirmed version (deferred)
  created_by_account_id text,
  created_by_name       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER import_touch BEFORE UPDATE ON processing_cost.import
  FOR EACH ROW EXECUTE FUNCTION processing_cost.set_updated_at();

-- 2. one row per uploaded file version of a period
CREATE TABLE processing_cost.import_file (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id         uuid NOT NULL REFERENCES processing_cost.import (id) ON DELETE CASCADE,
  version           integer NOT NULL CHECK (version >= 1),
  file_name         text NOT NULL,
  sha256            text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size         bigint NOT NULL CHECK (byte_size >= 0),
  status            text NOT NULL DEFAULT 'previewed'
                      CHECK (status IN ('previewed','confirmed','superseded')),
  row_count         integer NOT NULL DEFAULT 0,
  warning_count     integer NOT NULL DEFAULT 0,
  validation        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- full validatePreview() report
  uploaded_by_account_id text,
  uploaded_by_name       text,
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  confirmed_at      timestamptz,
  UNIQUE (import_id, version)
);
CREATE INDEX pc_import_file_import_idx ON processing_cost.import_file (import_id, version DESC);
-- dedupe-by-sha256-per-period: a byte-identical re-upload never creates a
-- spurious new version for the same import (period).
CREATE UNIQUE INDEX pc_import_file_sha_per_period ON processing_cost.import_file (import_id, sha256);

ALTER TABLE processing_cost.import
  ADD CONSTRAINT pc_import_current_file_fk FOREIGN KEY (current_file_id)
  REFERENCES processing_cost.import_file (id) DEFERRABLE INITIALLY DEFERRED;

-- 3. NORMALIZED — one row per (file, employee). Natural key (period, employee_code)
-- is enforced at the (file_id, employee_code) grain because file_id already
-- carries period_month 1:1; within-file duplicates are excluded entirely
-- BEFORE insert (never a chosen winner), so this PK can never be violated by
-- upload content.
CREATE TABLE processing_cost.normalized (
  file_id           uuid NOT NULL REFERENCES processing_cost.import_file (id) ON DELETE CASCADE,
  employee_code     text NOT NULL,
  period_month      text NOT NULL,
  employee_name     text,             -- HỌ VÀ TÊN — display/reference ONLY, never identity
  amount            numeric NOT NULL, -- CHI PHÍ XỬ LÝ — flat literal amount, no formula
  people_master_matched boolean NOT NULL DEFAULT false,
  PRIMARY KEY (file_id, employee_code)
);
CREATE INDEX pc_normalized_period_idx ON processing_cost.normalized (period_month, employee_code);
CREATE INDEX pc_normalized_emp_idx ON processing_cost.normalized (employee_code);

-- GRANTS — phf_hr_app only, processing_cost.* only, explicit, no ALTER DEFAULT PRIVILEGES
GRANT USAGE ON SCHEMA processing_cost TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE ON processing_cost.import        TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE ON processing_cost.import_file   TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON processing_cost.normalized TO phf_hr_app; -- DELETE = replace a previewed (uncommitted) version's rows

RESET ROLE;
COMMIT;
