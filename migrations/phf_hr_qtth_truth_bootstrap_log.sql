-- =============================================================================
-- PHF HR / QTTH — TRUTH DATA PROD BOOTSTRAP · audit-log table (additive).
-- Records every promotion-bundle apply (payroll / accounting) for traceability.
-- Idempotent. Safe to run on any environment that has schema `accounting`.
-- DOWN = phf_hr_qtth_truth_bootstrap_log_DOWN.sql.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
SET ROLE phf_hr_owner;
DO $$ BEGIN IF current_user <> 'phf_hr_owner' THEN
  RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %.', current_user; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name='accounting') THEN
  RAISE EXCEPTION 'ACCOUNTING_SCHEMA_MISSING: apply phf_hr_qtth_accounting_v1.sql first.'; END IF; END $$;
SET LOCAL search_path = accounting, public;

CREATE TABLE IF NOT EXISTS accounting.bootstrap_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bundle_id     text NOT NULL,
  target_schema text NOT NULL CHECK (target_schema IN ('payroll','accounting')),
  mode          text NOT NULL CHECK (mode IN ('dry-run','apply')),
  result        text NOT NULL CHECK (result IN ('ok','conflict','failed')),
  checksums     jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- inserted / skipped / conflicts / parity
  applied_by_account_id text,
  applied_by_name       text,
  applied_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bootstrap_log_bundle_idx ON accounting.bootstrap_log (bundle_id, target_schema, applied_at DESC);

DROP TRIGGER IF EXISTS bootstrap_log_immutable ON accounting.bootstrap_log;
CREATE TRIGGER bootstrap_log_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON accounting.bootstrap_log
  FOR EACH STATEMENT EXECUTE FUNCTION accounting.block_mutation();

GRANT SELECT, INSERT ON accounting.bootstrap_log TO phf_hr_app;

RESET ROLE;
COMMIT;
