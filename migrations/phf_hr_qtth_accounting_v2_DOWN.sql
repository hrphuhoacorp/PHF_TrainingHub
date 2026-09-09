-- PHF HR — QTTH Truth Data · ACCOUNTING · OPERATOR DECISION LAYER V2 · DOWN.
-- Data-destructive (drops operator decisions + rule history + operator rules).
-- REVIEW ONLY. Never run against Production.
\set ON_ERROR_STOP on
BEGIN;
SET ROLE phf_hr_owner;
DO $$ BEGIN IF current_user <> 'phf_hr_owner' THEN
  RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %', current_user; END IF; END $$;

-- operator-authored rules go away with the decision layer
DELETE FROM accounting.classification_rule WHERE origin = 'operator';

DROP TABLE IF EXISTS accounting.item_decision;
DROP TABLE IF EXISTS accounting.rule_history;

DROP INDEX IF EXISTS accounting.classification_rule_sig_uidx;
ALTER TABLE accounting.classification_rule
  DROP COLUMN IF EXISTS origin,
  DROP COLUMN IF EXISTS cost_code,
  DROP COLUMN IF EXISTS cost_code_name,
  DROP COLUMN IF EXISTS created_from,
  DROP COLUMN IF EXISTS match_signature;

ALTER TABLE accounting.normalized DROP COLUMN IF EXISTS decision_source;

RESET ROLE;
COMMIT;
