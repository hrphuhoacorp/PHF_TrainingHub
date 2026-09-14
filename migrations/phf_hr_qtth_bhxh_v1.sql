-- =============================================================================
-- PHF HR — QTTH TRUTH DATA · BHXH (EMPLOYER SOCIAL-INSURANCE COST) FOUNDATION V1
-- Target : Company PostgreSQL, database phf_hr (dev/throwaway: phf_hr_e2e), schema bhxh
-- Owner  : phf_hr_owner   ·   Runtime role : phf_hr_app (SET LOCAL ROLE per txn),
--          same pattern as payroll / accounting / qtth.
--
-- SCOPE: the SECOND QTTH Truth Data source — employer BHXH cost import ingestion.
-- Same THREE-layer shape as payroll:
--   A. RAW SOURCE  — original file + verbatim decoded cells, immutable/append-only.
--      EVERY data row is persisted here, including rows with missing/invalid
--      employee_code — BHXH never drops a row (it is real employer money).
--   B. NORMALIZED  — canonical BHXH fields (PHF BHXH sheet "TỔNG_BHXH").
--      employer_cost_source = EXACT verbatim value from the source "TK 642 (21.5%)"
--      column. NEVER recalculated. NEVER inferred from TK334 or employee-side
--      contribution columns. classification is an IDENTITY review state only
--      (MATCHED / NEEDS_REVIEW) — it never gates whether an amount counts;
--      no row's employer_cost_source is ever excluded from any total.
--   C. link to qtth.classification is by (employee_code, period) at read time —
--      NO copy here. source_department/source_branch below are reference/display
--      only and are NEVER written back into qtth.classification.
-- Period: import.period_month is the Operator-SELECTED period. import_file also
-- carries source_period_label/source_period_month (parsed from workbook content)
-- and a period_mismatch + period_mismatch_ack pair — Confirm must be blocked at
-- the service layer while a detected mismatch is not yet acknowledged. This
-- migration never hard-blocks on mismatch; it only carries the evidence.
-- Employee identity is EXTERNAL (People Master / Supabase MAIN) — referenced by
-- employee_code text, never an FK, never auto-created here. Rows without a valid
-- employee_code are resolved by an explicit Admin action (identity_mapping_history
-- below), never by inference and never by dropping the row.
--
-- DOWN = phf_hr_qtth_bhxh_v1_DOWN.sql. REVIEW ONLY. Never run on Production.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE SCHEMA IF NOT EXISTS bhxh;
ALTER SCHEMA bhxh OWNER TO phf_hr_owner;
COMMENT ON SCHEMA bhxh IS
  'PHF HR QTTH Truth Data — employer BHXH cost import (RAW + NORMALIZED + version/delta). '
  'Identity is external (Supabase People Master), referenced by employee_code text. '
  'employer_cost_source is verbatim from source column "TK 642 (21.5%)" — never recalculated.';

SET ROLE phf_hr_owner;
DO $$ BEGIN IF current_user <> 'phf_hr_owner' THEN
  RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %.', current_user; END IF; END $$;
SET LOCAL search_path = bhxh, public;

CREATE FUNCTION bhxh.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE FUNCTION bhxh.block_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'APPEND_ONLY: % on %.% is not allowed', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME; END $$;

-- 1. one row per BHXH period (Operator-selected period_month)
CREATE TABLE bhxh.import (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month      text NOT NULL UNIQUE CHECK (period_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active')),
  current_file_id   uuid,            -- FK set after first confirmed version (deferred)
  created_by_account_id text,
  created_by_name       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER import_touch BEFORE UPDATE ON bhxh.import
  FOR EACH ROW EXECUTE FUNCTION bhxh.set_updated_at();

-- 2. one row per uploaded file version of a period (V1, V2, …)
CREATE TABLE bhxh.import_file (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id         uuid NOT NULL REFERENCES bhxh.import (id) ON DELETE CASCADE,
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
  -- period evidence: selected vs source-content vs filename — never silently chosen
  selected_period_month   text NOT NULL,   -- == import.period_month, denormalized for audit
  source_period_label     text,            -- verbatim text parsed from workbook content
  source_period_month     text,            -- normalized YYYY-MM parse of source_period_label
  source_file_name        text,            -- original uploaded filename, kept as evidence
  period_mismatch         boolean NOT NULL DEFAULT false,
  period_mismatch_ack     boolean NOT NULL DEFAULT false,
  period_mismatch_ack_by_account_id text,
  period_mismatch_ack_by_name       text,
  period_mismatch_ack_at  timestamptz,
  -- employer-cost totals: source (verbatim, from the sheet's own total row) vs
  -- computed (sum of persisted normalized rows) — reconciliation display only,
  -- never used to alter either figure.
  source_total_employer_cost    numeric,
  computed_total_employer_cost  numeric,
  employer_cost_reconciled      boolean,
  needs_review_row_count  integer NOT NULL DEFAULT 0,
  needs_review_amount     numeric NOT NULL DEFAULT 0,
  uploaded_by_account_id text,
  uploaded_by_name       text,
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  confirmed_at      timestamptz,
  UNIQUE (import_id, version)
);
CREATE INDEX import_file_import_idx ON bhxh.import_file (import_id, version DESC);
CREATE UNIQUE INDEX import_file_sha_per_period ON bhxh.import_file (import_id, sha256);

ALTER TABLE bhxh.import
  ADD CONSTRAINT import_current_file_fk FOREIGN KEY (current_file_id)
  REFERENCES bhxh.import_file (id) DEFERRABLE INITIALLY DEFERRED;

-- 3. RAW SOURCE — verbatim decoded cells, immutable. EVERY data row, including
--    rows with missing/invalid employee_code — never skipped, never dropped.
CREATE TABLE bhxh.raw_row (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  file_id           uuid NOT NULL REFERENCES bhxh.import_file (id) ON DELETE CASCADE,
  source_row_index  integer NOT NULL,          -- 1-based row in the uploaded sheet
  employee_code     text,                      -- as read (may be null / unknown / malformed)
  cells             jsonb NOT NULL,            -- { "<colIndex>": "<raw cell text>", ... }
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX raw_row_file_idx ON bhxh.raw_row (file_id, source_row_index);
CREATE TRIGGER raw_row_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON bhxh.raw_row
  FOR EACH STATEMENT EXECUTE FUNCTION bhxh.block_mutation();

-- 4. NORMALIZED BHXH TRUTH — one row per source data row (NOT keyed solely by
--    employee_code, since it may be null/malformed pending Admin identity
--    resolution). classification is an IDENTITY review state only.
CREATE TABLE bhxh.normalized (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  file_id           uuid NOT NULL REFERENCES bhxh.import_file (id) ON DELETE CASCADE,
  period_month      text NOT NULL,
  source_row_index  integer NOT NULL,
  employee_code     text,                      -- verbatim "ID" cell; NULL/malformed allowed
  employee_code_resolved boolean NOT NULL DEFAULT false,  -- true once an admin mapping exists
  full_name_source  text,
  source_department text,                      -- "phòng ban" verbatim — reference/display only,
                                                 -- NEVER written back into qtth.classification
  source_branch     text,                      -- "CN" verbatim, reference only
  base_salary_bhxh  numeric,                   -- "Mức lương đóng BHXH" verbatim
  employer_cost_source numeric NOT NULL,        -- "TK 642 (21.5%)" verbatim — THE authoritative
                                                 -- BHXH truth amount. Never recalculated, never
                                                 -- inferred from TK334 or employee-side columns.
  employee_bhxh_tk334 numeric,                  -- "TK 334 (10.5%)" verbatim, reference only
  bhxh_amount       numeric,                    -- "BHXH" column verbatim
  bhyt_employer_45pct numeric,                  -- "Trả 4.5% BHYT" verbatim
  bhyt_prepaid      numeric,                    -- "Thu tiền trước BHYT" verbatim
  employee_total_contribution numeric,          -- "Tổng tiền NV đóng" verbatim
  source_detail     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- every other mapped column, verbatim
  classification    text NOT NULL CHECK (classification IN ('MATCHED','NEEDS_REVIEW')),
  review_reason     text,                       -- e.g. MISSING_EMPLOYEE_CODE / INVALID_EMPLOYEE_CODE_FORMAT
  validation_status text NOT NULL DEFAULT 'ok' CHECK (validation_status IN ('ok','warn')),
  validation_notes  jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX normalized_file_emp_uidx ON bhxh.normalized (file_id, employee_code)
  WHERE employee_code IS NOT NULL;
CREATE INDEX normalized_file_idx   ON bhxh.normalized (file_id, classification);
CREATE INDEX normalized_period_idx ON bhxh.normalized (period_month, employee_code);

-- 5. IDENTITY MAPPING HISTORY — append-only audit trail for Admin resolution of
--    NEEDS_REVIEW rows. Never mutates source amounts; only maps identity.
CREATE TABLE bhxh.identity_mapping_history (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_id         uuid NOT NULL REFERENCES bhxh.import (id) ON DELETE CASCADE,
  file_id           uuid NOT NULL REFERENCES bhxh.import_file (id) ON DELETE CASCADE,
  normalized_id     bigint NOT NULL REFERENCES bhxh.normalized (id) ON DELETE CASCADE,
  period_month      text NOT NULL,
  source_row_index  integer NOT NULL,
  from_employee_code text,                      -- what was there before (NULL on first mapping)
  to_employee_code   text NOT NULL,             -- the admin-chosen employee_code
  full_name_source   text,
  employer_cost_source numeric NOT NULL,        -- snapshot of the amount being mapped, for audit
  note              text,
  mapped_by_account_id text,
  mapped_by_name        text,
  mapped_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX identity_mapping_history_norm_idx ON bhxh.identity_mapping_history (normalized_id, mapped_at DESC);
CREATE TRIGGER identity_mapping_history_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON bhxh.identity_mapping_history
  FOR EACH STATEMENT EXECUTE FUNCTION bhxh.block_mutation();

-- 6. VERSION DELTA — append-only, before→after per changed field
CREATE TABLE bhxh.delta (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_id         uuid NOT NULL REFERENCES bhxh.import (id) ON DELETE CASCADE,
  from_version      integer,
  to_version        integer NOT NULL,
  employee_code     text,                       -- nullable: unresolved rows key by row instead
  source_row_index  integer,
  change_type       text NOT NULL CHECK (change_type IN ('added','changed','removed_missing')),
  field             text,
  before_value      text,
  after_value       text,
  detected_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delta_import_idx ON bhxh.delta (import_id, to_version);
CREATE TRIGGER delta_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON bhxh.delta
  FOR EACH STATEMENT EXECUTE FUNCTION bhxh.block_mutation();

-- 7. TEMPLATE / SCHEMA fingerprint registry
CREATE TABLE bhxh.template (
  fingerprint       text PRIMARY KEY,
  label             text NOT NULL,
  is_canonical      boolean NOT NULL DEFAULT false,
  column_map        jsonb NOT NULL,             -- { field -> colIndex }
  first_seen_period text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- GRANTS — phf_hr_app only, bhxh.* only, explicit, no ALTER DEFAULT PRIVILEGES
GRANT USAGE ON SCHEMA bhxh TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE ON bhxh.import        TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE ON bhxh.import_file   TO phf_hr_app;
GRANT SELECT, INSERT          ON bhxh.raw_row      TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bhxh.normalized TO phf_hr_app;  -- DELETE = replace a previewed (uncommitted) version's rows
GRANT SELECT, INSERT          ON bhxh.identity_mapping_history TO phf_hr_app;
GRANT SELECT, INSERT          ON bhxh.delta        TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE  ON bhxh.template     TO phf_hr_app;

RESET ROLE;
COMMIT;
