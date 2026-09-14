-- =============================================================================
-- PHF HR — QTTH TRUTH DATA · ACCOUNTING · OPERATOR DECISION LAYER V2
-- Target : Company PostgreSQL, database phf_hr (dev/throwaway: phf_hr_e2e),
--          schema `accounting`. ADDITIVE on top of phf_hr_qtth_accounting_v1.sql.
-- Owner  : phf_hr_owner   ·   Runtime role : phf_hr_app.
--
-- SCOPE (V2 — Operator decision layer + SAFE deterministic remembered rules):
--   The Operator (HR/QTTH, not an accountant) reviews the small NEEDS_REVIEW
--   population and records, per item: "Đưa vào" / "Không đưa vào" + a management
--   cost category (from the imported Cost Dictionary). Optionally they may
--   "Ghi nhớ" the decision as a remembered rule.
--
--   HARD BUSINESS LOCK (Operator handover 2026-09-09):
--     A remembered rule NEVER fires on account number alone. It requires
--       account  +  a deterministic, inspectable description matcher
--     (normalized text, all-token containment). Any future line whose
--     description does not deterministically match falls back to NEEDS_REVIEW.
--     No LLM / embedding / fuzzy classifier. Fail safe.
--     "Bút toán phân bổ CCDC" is a RECOGNIZED pattern but its INCLUDE/EXCLUDE
--     business decision is NOT locked — it stays NEEDS_REVIEW until the
--     Operator explicitly decides.
--
--   Engine / parser / cost-scope extraction / canonical amounts UNCHANGED.
--   RAW_ROWS_SAVED_AS_FACT still 0. Original FAST source untouched.
--
-- DOWN = phf_hr_qtth_accounting_v2_DOWN.sql. REVIEW ONLY. Never run on Production.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;

SET ROLE phf_hr_owner;
DO $$ BEGIN IF current_user <> 'phf_hr_owner' THEN
  RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %.', current_user; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='accounting' AND table_name='classification_rule') THEN
  RAISE EXCEPTION 'V1_NOT_APPLIED: run migrations/phf_hr_qtth_accounting_v1.sql first.'; END IF; END $$;
SET LOCAL search_path = accounting, public;

-- 1. classification_rule — additive columns for operator-authored rules -----
ALTER TABLE accounting.classification_rule
  ADD COLUMN IF NOT EXISTS origin         text NOT NULL DEFAULT 'seed'
    CHECK (origin IN ('seed','operator')),
  ADD COLUMN IF NOT EXISTS cost_code      text,           -- management category (cost_dictionary.ma_phi) when action=INCLUDE
  ADD COLUMN IF NOT EXISTS cost_code_name text,            -- denormalized label for display / audit
  ADD COLUMN IF NOT EXISTS created_from   text,            -- 'decision:<id>' provenance of an operator rule
  ADD COLUMN IF NOT EXISTS match_signature text;           -- stable hash of (kind|value) for dup detection

CREATE UNIQUE INDEX IF NOT EXISTS classification_rule_sig_uidx
  ON accounting.classification_rule (match_signature) WHERE match_signature IS NOT NULL;

-- 2. rule_history — append-only audit of every rule create/update/toggle -----
CREATE TABLE IF NOT EXISTS accounting.rule_history (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_id       text NOT NULL,
  action        text NOT NULL CHECK (action IN ('create','update','disable','enable')),
  snapshot      jsonb NOT NULL,          -- full rule row AFTER the change
  reason        text,
  changed_by_account_id text,
  changed_by_name       text,
  changed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rule_history_rule_idx ON accounting.rule_history (rule_id, changed_at DESC);
DROP TRIGGER IF EXISTS rule_history_immutable ON accounting.rule_history;
CREATE TRIGGER rule_history_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON accounting.rule_history
  FOR EACH STATEMENT EXECUTE FUNCTION accounting.block_mutation();

-- 3. item_decision — append-only log of every per-line Operator decision -----
--    Latest row per (file_id, source_row_index) is the effective decision for
--    that version. Ad-hoc (non-remembered) decisions are version-scoped by
--    design; remembered decisions ALSO create a classification_rule so they
--    carry forward to future imports through the engine.
CREATE TABLE IF NOT EXISTS accounting.item_decision (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_id     uuid NOT NULL REFERENCES accounting.import (id) ON DELETE CASCADE,
  file_id       uuid NOT NULL REFERENCES accounting.import_file (id) ON DELETE CASCADE,
  period_month  text NOT NULL,
  source_row_index integer NOT NULL,
  tai_khoan     text NOT NULL,
  dien_giai     text,
  phat_sinh_no  numeric NOT NULL,
  decision      text NOT NULL CHECK (decision IN ('INCLUDE','EXCLUDE')),
  cost_code     text,                    -- cost_dictionary.ma_phi when INCLUDE
  cost_code_name text,
  remembered_rule_id text,               -- set when the Operator chose "Ghi nhớ"
  note          text,
  decided_by_account_id text,
  decided_by_name       text,
  decided_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS item_decision_file_idx ON accounting.item_decision (file_id, source_row_index, decided_at DESC);
DROP TRIGGER IF EXISTS item_decision_immutable ON accounting.item_decision;
CREATE TRIGGER item_decision_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON accounting.item_decision
  FOR EACH STATEMENT EXECUTE FUNCTION accounting.block_mutation();

-- 4. normalized — how the current classification was reached ---------------
ALTER TABLE accounting.normalized
  ADD COLUMN IF NOT EXISTS decision_source text NOT NULL DEFAULT 'engine'
    CHECK (decision_source IN ('engine','operator_item','operator_rule'));

-- GRANTS — phf_hr_app only ------------------------------------------------
GRANT SELECT, INSERT          ON accounting.rule_history   TO phf_hr_app;
GRANT SELECT, INSERT          ON accounting.item_decision  TO phf_hr_app;
-- classification_rule / normalized already granted in v1 (SELECT/INSERT/UPDATE,
-- normalized also DELETE for previewed-version rebuilds).

RESET ROLE;
COMMIT;
