-- =============================================================================
-- PHF HR — QTTH TRUTH DATA · ACCOUNTING (CHI PHÍ QUẢN TRỊ) FOUNDATION V1
-- Target : Company PostgreSQL, database phf_hr (dev/throwaway: phf_hr_e2e),
--          schema `accounting`.
-- Owner  : phf_hr_owner   ·   Runtime role : phf_hr_app (SET LOCAL ROLE per txn),
--          same pattern as PHF Task / Competition / qtth / payroll.
--
-- SCOPE (V1 — DATA FOUNDATION ONLY, T07/2026 pilot):
--   Ingest the FAST "Bảng kê chứng từ theo bộ phận" export, filter to the
--   management-cost lines needed for QTTH, and store them as auditable Truth
--   Data. NO dashboard, NO management report, NO allocation, NO cost-code
--   auto-mapping. Operator handover 2026-09-09 §18.
--
--   FIVE layers:
--     A. import / import_file  — one row per period, one row per uploaded file
--        version. The RAW .xlsx is kept byte-for-byte on the phf-hr-api
--        filesystem (sha256 + storage_ref); NOT in the DB.
--     B. normalized            — ONLY the debit-side cost lines that survive the
--        filter (~350 / period for T07), never the ~86k source rows.
--        RAW_ROWS_SAVED_AS_FACT = 0 (Operator hard rule). source_row_index +
--        the verbatim FAST fields give full provenance back to the file.
--     C. cost_dictionary / cost_dictionary_entry — the FAST "Danh mục phí"
--        (170 Mã phí), versionable reference data. NEVER joined to transactions
--        by keyword in V1 (no true join key — §12). normalized.cost_code stays
--        NULL / UNRESOLVED.
--     D. classification_rule   — centralized INCLUDE / EXCLUDE / NEEDS_REVIEW
--        engine. Broad include (641*/642*) -> explicit exclude -> unknown =
--        NEEDS_REVIEW. Unknown is NEVER dropped.
--     E. link to qtth.classification / People Master — NONE here. Department is
--        the verbatim FAST `Mã bp`; out-of-master values (e.g. PHF-MKT) are
--        KEPT + flagged, never remapped.
--
-- Employee / customer identity is EXTERNAL — referenced by text, never an FK,
-- never auto-created here. Source amounts are immutable; no rounding on import.
--
-- DOWN = phf_hr_qtth_accounting_v1_DOWN.sql. REVIEW ONLY. Never run on Production.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE SCHEMA IF NOT EXISTS accounting;
ALTER SCHEMA accounting OWNER TO phf_hr_owner;
COMMENT ON SCHEMA accounting IS
  'PHF HR QTTH Truth Data — FAST management-cost import (RAW file + NORMALIZED '
  'cost lines + versionable Cost Dictionary + classification rule engine). '
  'Identity external (People Master); RAW source rows are NOT stored as fact.';

SET ROLE phf_hr_owner;
DO $$ BEGIN IF current_user <> 'phf_hr_owner' THEN
  RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %.', current_user; END IF; END $$;
SET LOCAL search_path = accounting, public;

CREATE FUNCTION accounting.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE FUNCTION accounting.block_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'APPEND_ONLY: % on %.% is not allowed', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME; END $$;

-- 1. one row per management period ------------------------------------------
CREATE TABLE accounting.import (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month      text NOT NULL UNIQUE CHECK (period_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active')),
  current_file_id   uuid,                         -- FK set after first confirm (deferred)
  created_by_account_id text,
  created_by_name       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER import_touch BEFORE UPDATE ON accounting.import
  FOR EACH ROW EXECUTE FUNCTION accounting.set_updated_at();

-- 2. one row per uploaded FAST export version of a period (V1, V2, …) -------
CREATE TABLE accounting.import_file (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id         uuid NOT NULL REFERENCES accounting.import (id) ON DELETE CASCADE,
  version           integer NOT NULL CHECK (version >= 1),
  file_name         text NOT NULL,
  sha256            text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size         bigint NOT NULL CHECK (byte_size >= 0),
  storage_ref       text NOT NULL,                -- opaque server-side ref; NEVER a public URL
  sheet_name        text,
  source_from_date  date,                         -- parsed from the FAST "Từ ngày … đến ngày …" band
  source_to_date    date,
  rule_version      text,                         -- classification_rule set version applied
  status            text NOT NULL DEFAULT 'previewed'
                      CHECK (status IN ('previewed','confirmed','superseded')),
  -- filter funnel (Operator §16 / §24) --------------------------------------
  source_row_count      integer NOT NULL DEFAULT 0,
  debit_row_count       integer NOT NULL DEFAULT 0,
  credit_row_count      integer NOT NULL DEFAULT 0,
  cost_scope_row_count  integer NOT NULL DEFAULT 0,   -- 641*/642* debit (broad)
  included_row_count      integer NOT NULL DEFAULT 0,
  excluded_row_count      integer NOT NULL DEFAULT 0,
  needs_review_row_count  integer NOT NULL DEFAULT 0,
  included_amount       numeric NOT NULL DEFAULT 0,   -- source precision, no rounding
  needs_review_amount   numeric NOT NULL DEFAULT 0,
  excluded_amount       numeric NOT NULL DEFAULT 0,
  warning_count         integer NOT NULL DEFAULT 0,
  report            jsonb NOT NULL DEFAULT '{}'::jsonb,   -- full preview aggregate
  uploaded_by_account_id text,
  uploaded_by_name       text,
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  confirmed_at      timestamptz,
  UNIQUE (import_id, version)
);
CREATE INDEX import_file_import_idx ON accounting.import_file (import_id, version DESC);
CREATE UNIQUE INDEX import_file_sha_per_period ON accounting.import_file (import_id, sha256);

ALTER TABLE accounting.import
  ADD CONSTRAINT import_current_file_fk FOREIGN KEY (current_file_id)
  REFERENCES accounting.import_file (id) DEFERRABLE INITIALLY DEFERRED;

-- 3. NORMALIZED COST TRUTH — ONLY the filtered debit-side cost lines ---------
--    ~350 rows / period. NOT the ~86k source rows. Every column below the
--    classification block is the VERBATIM FAST value (provenance); source
--    amount is immutable.
CREATE TABLE accounting.normalized (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  file_id           uuid NOT NULL REFERENCES accounting.import_file (id) ON DELETE CASCADE,
  period_month      text NOT NULL,
  source_row_index  integer NOT NULL,             -- 1-based row in the uploaded sheet
  -- verbatim FAST transaction line ---------------------------------------
  ngay_ct           date,
  ma_ct             text,                         -- HD / PKT / PX / PC / BN … (provenance only, never a filter)
  so_ct             text,
  ma_khach          text,
  ten_khach         text,
  dien_giai         text,
  tai_khoan         text NOT NULL,
  tk_doi_ung        text,
  phat_sinh_no      numeric NOT NULL,             -- immutable source amount (VND, source precision)
  ma_bp             text,
  ma_bp_out_of_master boolean NOT NULL DEFAULT false,
  -- classification -----------------------------------------------------
  classification    text NOT NULL CHECK (classification IN ('INCLUDE','EXCLUDE','NEEDS_REVIEW')),
  classified_by_rule_id text,
  rule_version      text,
  cost_code         text,                         -- ALWAYS NULL in V1 (no join key — §12)
  cost_code_status  text NOT NULL DEFAULT 'UNRESOLVED'
                      CHECK (cost_code_status IN ('UNRESOLVED','RESOLVED')),
  warnings          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX normalized_file_idx    ON accounting.normalized (file_id, classification);
CREATE INDEX normalized_account_idx ON accounting.normalized (file_id, tai_khoan);
CREATE INDEX normalized_period_idx  ON accounting.normalized (period_month);
-- previewed (uncommitted) versions can be rebuilt -> UPDATE/DELETE allowed for
-- phf_hr_app, but a CONFIRMED version's rows are frozen by the app layer.
CREATE TRIGGER normalized_no_truncate BEFORE TRUNCATE ON accounting.normalized
  FOR EACH STATEMENT EXECUTE FUNCTION accounting.block_mutation();

-- 4. VERSION DELTA — append-only, INCLUDE/NEEDS_REVIEW funnel change per version
CREATE TABLE accounting.delta (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_id         uuid NOT NULL REFERENCES accounting.import (id) ON DELETE CASCADE,
  from_version      integer,
  to_version        integer NOT NULL,
  metric            text NOT NULL,                -- e.g. 'included_amount', 'needs_review_row_count', 'account:64121'
  before_value      text,
  after_value       text,
  detected_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delta_import_idx ON accounting.delta (import_id, to_version);
CREATE TRIGGER delta_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON accounting.delta
  FOR EACH STATEMENT EXECUTE FUNCTION accounting.block_mutation();

-- 5. COST DICTIONARY — versionable reference data (FAST "Danh mục phí") ------
CREATE TABLE accounting.cost_dictionary (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version           integer NOT NULL,
  source_file_name  text,
  source_sha256     text CHECK (source_sha256 IS NULL OR source_sha256 ~ '^[0-9a-f]{64}$'),
  entry_count       integer NOT NULL DEFAULT 0,
  is_current        boolean NOT NULL DEFAULT false,
  imported_by_account_id text,
  imported_by_name       text,
  imported_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version)
);
CREATE UNIQUE INDEX cost_dictionary_one_current ON accounting.cost_dictionary (is_current) WHERE is_current;

CREATE TABLE accounting.cost_dictionary_entry (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dictionary_id     uuid NOT NULL REFERENCES accounting.cost_dictionary (id) ON DELETE CASCADE,
  ma_phi            text NOT NULL,
  ten_phi           text,
  bo_phan           text,
  nhom1             text, ten_nhom1 text,
  nhom2             text, ten_nhom2 text,
  nhom3             text, ten_nhom3 text,
  ghi_chu           text,
  UNIQUE (dictionary_id, ma_phi)
);
CREATE INDEX cost_dictionary_entry_dict_idx ON accounting.cost_dictionary_entry (dictionary_id);

-- 6. CLASSIFICATION RULE ENGINE -------------------------------------------
--    priority ASC = evaluated first. match_kind + match_value describe the
--    predicate; action is the verdict. The seed set (loaded by the app on
--    first use, or here below) encodes the BC Chi Phí QTTH canonical accounts
--    as INCLUDE and the 8 audited out-of-reference accounts as NEEDS_REVIEW.
CREATE TABLE accounting.classification_rule (
  id                text PRIMARY KEY,
  priority          integer NOT NULL DEFAULT 100,
  match_kind        text NOT NULL CHECK (match_kind IN
                      ('account_exact','account_prefix','contra_prefix','description','department','voucher','combo')),
  match_value       jsonb NOT NULL,               -- shape depends on match_kind
  action            text NOT NULL CHECK (action IN ('INCLUDE','EXCLUDE','NEEDS_REVIEW')),
  note              text,
  rule_version      text NOT NULL DEFAULT 'v1',
  is_active         boolean NOT NULL DEFAULT true,
  created_by_account_id text,
  created_by_name       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX classification_rule_active_idx ON accounting.classification_rule (is_active, priority);
CREATE TRIGGER classification_rule_touch BEFORE UPDATE ON accounting.classification_rule
  FOR EACH ROW EXECUTE FUNCTION accounting.set_updated_at();

-- ---- SEED: classification rule engine v1 ---------------------------------
-- Priority 10 : closing/transfer to 911 on the debit side -> EXCLUDE (double-count guard).
-- Priority 20 : explicit NEEDS_REVIEW for the 8 accounts seen in T07 with a
--               debit balance but no Mã số in BC Chi Phí QTTH (Operator §4).
-- Priority 30 : BC Chi Phí QTTH canonical management-cost accounts -> INCLUDE.
-- Priority 90 : broad safety net — any other 641*/642* debit -> NEEDS_REVIEW
--               (unknown is never dropped, never silently included — §7/§9).
INSERT INTO accounting.classification_rule (id, priority, match_kind, match_value, action, note) VALUES
 ('v1-exclude-closing-911', 10, 'contra_prefix', '{"prefixes":["911"]}', 'EXCLUDE',
  'Kết chuyển 641/642 -> 911 (KQKD). Không phải chi phí phát sinh — double-count guard.'),
 ('v1-review-6414',  20, 'account_exact', '{"accounts":["6414"]}',  'NEEDS_REVIEW', 'Rollup 4 chữ số — chờ KTT map chỉ tiêu QTTH.'),
 ('v1-review-6422',  20, 'account_exact', '{"accounts":["6422"]}',  'NEEDS_REVIEW', 'Rollup 4 chữ số — chờ KTT map chỉ tiêu QTTH.'),
 ('v1-review-6423',  20, 'account_exact', '{"accounts":["6423"]}',  'NEEDS_REVIEW', 'Rollup 4 chữ số — chờ KTT map chỉ tiêu QTTH.'),
 ('v1-review-64177', 20, 'account_exact', '{"accounts":["64177"]}', 'NEEDS_REVIEW', 'Không có Mã số trong BC Chi Phí QTTH (641 dừng ở 64176).'),
 ('v1-review-64178', 20, 'account_exact', '{"accounts":["64178"]}', 'NEEDS_REVIEW', 'Không có Mã số trong BC Chi Phí QTTH.'),
 ('v1-review-64188', 20, 'account_exact', '{"accounts":["64188"]}', 'NEEDS_REVIEW', 'Không có Mã số trong BC Chi Phí QTTH (nhóm 18 dừng ở 64187).'),
 ('v1-review-64273', 20, 'account_exact', '{"accounts":["64273"]}', 'NEEDS_REVIEW', 'Không có Mã số trong BC Chi Phí QTTH (642 dừng ở 64272).'),
 ('v1-review-64274', 20, 'account_exact', '{"accounts":["64274"]}', 'NEEDS_REVIEW', 'Không có Mã số trong BC Chi Phí QTTH.'),
 ('v1-include-bc-641', 30, 'account_exact',
  '{"accounts":["64111","64112","64113","64114","64115","64116","64117","64121","64122","64123","64124","64131","64132","64133","64134","64135","64141","64171","64172","64173","64174","64175","64176","64181","64182","64183","64184","64185","64186","64187"]}',
  'INCLUDE', 'Chi phí bán hàng — Mã số BC Chi Phí QTTH (IX / 641).'),
 ('v1-include-bc-642', 30, 'account_exact',
  '{"accounts":["64211","64212","64213","64214","64215","64216","64217","64221","64222","64223","64224","64241","64251","64271","64272","64281","64282","64283","64284","64285","64286","64287","64288"]}',
  'INCLUDE', 'Chi phí quản lý doanh nghiệp — Mã số BC Chi Phí QTTH (X / 642).'),
 ('v1-safety-641', 90, 'account_prefix', '{"prefixes":["641"]}', 'NEEDS_REVIEW',
  'Bất kỳ 641* phát sinh Nợ nào chưa có rule -> chờ Operator xem bằng chứng dòng thật (không drop, không auto-include).'),
 ('v1-safety-642', 90, 'account_prefix', '{"prefixes":["642"]}', 'NEEDS_REVIEW',
  'Bất kỳ 642* phát sinh Nợ nào chưa có rule -> chờ Operator xem bằng chứng dòng thật.');

-- GRANTS — phf_hr_app only, accounting.* only, explicit ---------------------
GRANT USAGE ON SCHEMA accounting TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE         ON accounting.import                 TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE         ON accounting.import_file            TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON accounting.normalized            TO phf_hr_app;  -- DELETE = rebuild a previewed version
GRANT SELECT, INSERT                 ON accounting.delta                 TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE         ON accounting.cost_dictionary       TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON accounting.cost_dictionary_entry TO phf_hr_app;  -- DELETE = replace a re-imported dict version
GRANT SELECT, INSERT, UPDATE         ON accounting.classification_rule   TO phf_hr_app;

RESET ROLE;
COMMIT;
