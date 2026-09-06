-- =============================================================================
-- PHF HR — QTTH TRUTH DATA · PAYROLL FOUNDATION V1 (Batch 02)
-- Target : Company PostgreSQL, database phf_hr (dev/throwaway: phf_hr_e2e), schema payroll
-- Owner  : phf_hr_owner   ·   Runtime role : phf_hr_app (SET LOCAL ROLE per txn),
--          same pattern as PHF Task / Competition / qtth.
--
-- SCOPE (Batch 02): the FIRST QTTH Truth Data source — payroll import ingestion
-- and auditability. THREE independent layers:
--   A. RAW SOURCE  — original file + verbatim decoded cells, immutable/append-only
--   B. NORMALIZED  — canonical payroll fields (PHF Payroll Canonical Template V1 = T7)
--   C. link to qtth.classification is by (employee_code, period) at read time —
--      NO copy here (source branch may differ from QTTH classification; both kept).
-- Versioning: V1 baseline per period; V2/V3 = same period re-upload; deltas only.
-- Employee identity is EXTERNAL (People Master / Supabase MAIN) — referenced by
-- employee_code text, never an FK, never auto-created here.
-- NO payroll calculation, NO analytics. Import + Truth Data only.
--
-- DOWN = phf_hr_qtth_payroll_v1_DOWN.sql. REVIEW ONLY. Never run on Production.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE SCHEMA IF NOT EXISTS payroll;
ALTER SCHEMA payroll OWNER TO phf_hr_owner;
COMMENT ON SCHEMA payroll IS
  'PHF HR QTTH Truth Data — payroll import (RAW + NORMALIZED + version/delta). '
  'Identity is external (Supabase People Master), referenced by employee_code text.';

SET ROLE phf_hr_owner;
DO $$ BEGIN IF current_user <> 'phf_hr_owner' THEN
  RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %.', current_user; END IF; END $$;
SET LOCAL search_path = payroll, public;

CREATE FUNCTION payroll.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE FUNCTION payroll.block_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'APPEND_ONLY: % on %.% is not allowed', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME; END $$;

-- 1. one row per payroll period
CREATE TABLE payroll.import (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month      text NOT NULL UNIQUE CHECK (period_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active')),
  current_file_id   uuid,            -- FK set after first confirmed version (deferred)
  created_by_account_id text,
  created_by_name       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER import_touch BEFORE UPDATE ON payroll.import
  FOR EACH ROW EXECUTE FUNCTION payroll.set_updated_at();

-- 2. one row per uploaded file version of a period (V1, V2, …)
CREATE TABLE payroll.import_file (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id         uuid NOT NULL REFERENCES payroll.import (id) ON DELETE CASCADE,
  version           integer NOT NULL CHECK (version >= 1),
  file_name         text NOT NULL,
  sha256            text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size         bigint NOT NULL CHECK (byte_size >= 0),
  storage_ref       text NOT NULL,        -- opaque server-side reference; NEVER a public URL
  template_fingerprint text,
  template_matched  boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'previewed'
                      CHECK (status IN ('previewed','confirmed','superseded')),
  row_count         integer NOT NULL DEFAULT 0,
  warning_count     integer NOT NULL DEFAULT 0,
  validation        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- full validate() report
  uploaded_by_account_id text,
  uploaded_by_name       text,
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  confirmed_at      timestamptz,
  UNIQUE (import_id, version)
);
CREATE INDEX import_file_import_idx ON payroll.import_file (import_id, version DESC);
CREATE UNIQUE INDEX import_file_sha_per_period ON payroll.import_file (import_id, sha256);

ALTER TABLE payroll.import
  ADD CONSTRAINT import_current_file_fk FOREIGN KEY (current_file_id)
  REFERENCES payroll.import_file (id) DEFERRABLE INITIALLY DEFERRED;

-- 3. RAW SOURCE — verbatim decoded cells, immutable
CREATE TABLE payroll.raw_row (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  file_id           uuid NOT NULL REFERENCES payroll.import_file (id) ON DELETE CASCADE,
  source_row_index  integer NOT NULL,          -- 1-based row in the uploaded sheet
  employee_code     text,                      -- as read (may be null / unknown)
  cells             jsonb NOT NULL,            -- { "<colIndex>": "<raw cell text>", ... }
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX raw_row_file_idx ON payroll.raw_row (file_id, source_row_index);
CREATE TRIGGER raw_row_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON payroll.raw_row
  FOR EACH STATEMENT EXECUTE FUNCTION payroll.block_mutation();

-- 4. NORMALIZED PAYROLL TRUTH — canonical fields per (file, employee)
CREATE TABLE payroll.normalized (
  file_id           uuid NOT NULL REFERENCES payroll.import_file (id) ON DELETE CASCADE,
  employee_code     text NOT NULL,
  period_month      text NOT NULL,
  full_name_source  text,
  source_branch     text,                      -- CHI NHÁNH from the sheet (raw ref)
  salary_grade      text,                      -- BẬC LƯƠNG (raw ref)
  people_master_matched boolean NOT NULL DEFAULT false,
  -- reporting-core numeric fields (VND). D-locked semantics; components live in source_detail.
  base_salary_bhxh          numeric,
  job_allowance             numeric,
  base_standard_total_1     numeric,
  std_income_total_1to9     numeric,
  worked_salary_total_1     numeric,
  allowance_actual_total_2  numeric,
  bonus_total_3             numeric,
  grand_total_4             numeric,
  internal_deduct_total_5   numeric,
  income_after_internal_5   numeric,
  statutory_deduct_total_6  numeric,
  income_after_deduct_6     numeric,
  tax_taxable_income        numeric,            -- D7: verbatim, may differ from income_after_deduct_6
  tax_assessable_income     numeric,
  tax_dependents            numeric,
  tax_pit_amount            numeric,
  final_net_after_tax       numeric,            -- D5: CANONICAL payroll final payable
  t13_revenue_bonus         numeric,            -- D6: outside-period, tax-side
  reconcile_adjust          numeric,            -- D5: payment-layer reconciliation ("Đối soát")
  source_detail             jsonb NOT NULL DEFAULT '{}'::jsonb,   -- every other mapped field, verbatim
  validation_status         text NOT NULL DEFAULT 'ok' CHECK (validation_status IN ('ok','warn')),
  validation_notes          jsonb NOT NULL DEFAULT '[]'::jsonb,   -- reconciliation warnings (never applied)
  PRIMARY KEY (file_id, employee_code)
);
CREATE INDEX normalized_period_idx ON payroll.normalized (period_month, employee_code);
CREATE INDEX normalized_emp_idx ON payroll.normalized (employee_code);

-- 5. VERSION DELTA — append-only, before→after per changed field
CREATE TABLE payroll.delta (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_id         uuid NOT NULL REFERENCES payroll.import (id) ON DELETE CASCADE,
  from_version      integer,
  to_version        integer NOT NULL,
  employee_code     text NOT NULL,
  change_type       text NOT NULL CHECK (change_type IN ('added','changed','removed_missing')),
  field             text,
  before_value      text,
  after_value       text,
  detected_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delta_import_idx ON payroll.delta (import_id, to_version);
CREATE TRIGGER delta_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON payroll.delta
  FOR EACH STATEMENT EXECUTE FUNCTION payroll.block_mutation();

-- 6. TEMPLATE / SCHEMA fingerprint registry
CREATE TABLE payroll.template (
  fingerprint       text PRIMARY KEY,
  label             text NOT NULL,
  is_canonical      boolean NOT NULL DEFAULT false,
  column_map        jsonb NOT NULL,             -- { field -> colIndex }
  first_seen_period text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- GRANTS — phf_hr_app only, payroll.* only, explicit, no ALTER DEFAULT PRIVILEGES
GRANT USAGE ON SCHEMA payroll TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE ON payroll.import        TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE ON payroll.import_file   TO phf_hr_app;
GRANT SELECT, INSERT          ON payroll.raw_row      TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll.normalized TO phf_hr_app;  -- DELETE = replace a previewed (uncommitted) version's rows
GRANT SELECT, INSERT          ON payroll.delta        TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE  ON payroll.template     TO phf_hr_app;

RESET ROLE;
COMMIT;
