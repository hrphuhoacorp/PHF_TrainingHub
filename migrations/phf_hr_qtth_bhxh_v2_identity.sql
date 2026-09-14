-- =============================================================================
-- PHF HR — QTTH TRUTH DATA · BHXH · IDENTITY RESOLUTION V2 (additive)
-- Target : Company PostgreSQL, database phf_hr (dev/throwaway: phf_hr_e2e), schema bhxh
-- Requires phf_hr_qtth_bhxh_v1.sql already applied.
--
-- SCOPE: a stable QTTH-local identity for BHXH source rows that cannot be
-- matched to a real People Master employee_code (missing/malformed ID,
-- ex-employee never on-boarded to a system account, etc). Locked business
-- rules (Operator):
--   - Real money (employer_cost_source) is NEVER dropped/zeroed for an
--     unresolved row (already true since V1 — unaffected by this migration).
--   - Match chắc -> auto (a later period's row matching an existing
--     registry entry's stable key resolves automatically, no re-review).
--   - Không chắc -> Admin xác nhận (ambiguous/colliding matches stay
--     NEEDS_REVIEW, never auto-guessed).
--   - Quyết định đủ tin cậy -> nhớ lại (once Admin confirms an identity —
--     either a real employee_code OR a declared "valid person without a
--     system account" — it is remembered via bhxh.identity_registry and
--     reused automatically in later periods).
--   - Không bắt tạo account / People Master record for a local identity.
--   - Department/branch is a monthly, per-row snapshot — inherited from the
--     registry's last-known value only when the CURRENT period's source is
--     blank, and only for the row being written THIS period. Historical
--     confirmed periods are NEVER rewritten.
--
-- DOWN = phf_hr_qtth_bhxh_v2_identity_DOWN.sql. REVIEW ONLY. Never run on Production.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
SET ROLE phf_hr_owner;
DO $$ BEGIN IF current_user <> 'phf_hr_owner' THEN
  RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %.', current_user; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name='bhxh') THEN
  RAISE EXCEPTION 'BHXH_SCHEMA_MISSING: apply phf_hr_qtth_bhxh_v1.sql first.'; END IF; END $$;
SET LOCAL search_path = bhxh, public;

-- Stable QTTH-local identity registry — persists across periods.
-- kind='employee_code'  : resolved to a real People Master employee (employee_code set).
-- kind='local_identity'  : Admin-declared valid person with NO system account
--                          (e.g. ex-employee, never on-boarded) — employee_code stays NULL.
-- match_key: normalized(full_name) used for automatic carry-forward matching
-- in later periods. NOT unique — two different real people can share a
-- normalized name; the service layer treats >1 active registry row for the
-- same match_key as a collision (never auto-resolved, always NEEDS_REVIEW).
CREATE TABLE bhxh.identity_registry (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              text NOT NULL CHECK (kind IN ('employee_code','local_identity')),
  employee_code     text,                      -- set iff kind='employee_code'
  display_name      text NOT NULL,
  match_key         text NOT NULL,             -- normalized(full_name) — carry-forward lookup key
  note              text,                      -- e.g. "đã nghỉ việc, chưa từng có tài khoản hệ thống"
  last_department   text,                      -- last-known dept, inherited by future blank-source rows
  last_branch       text,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_by_account_id text,
  created_by_name       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_registry_employee_code_required
    CHECK (kind <> 'employee_code' OR employee_code IS NOT NULL)
);
CREATE INDEX identity_registry_matchkey_idx ON bhxh.identity_registry (match_key) WHERE status = 'active';
CREATE INDEX identity_registry_empcode_idx ON bhxh.identity_registry (employee_code) WHERE employee_code IS NOT NULL;
CREATE TRIGGER identity_registry_touch BEFORE UPDATE ON bhxh.identity_registry
  FOR EACH ROW EXECUTE FUNCTION bhxh.set_updated_at();

-- normalized: track HOW a row's identity was resolved, and (for local
-- identities) which registry entry. employee_code stays the raw/resolved
-- People Master code when kind='employee_code'; NULL when kind='local_identity'.
ALTER TABLE bhxh.normalized
  ADD COLUMN identity_kind text CHECK (identity_kind IN ('employee_code','local_identity')),
  ADD COLUMN local_identity_id uuid REFERENCES bhxh.identity_registry (id),
  ADD COLUMN identity_auto_resolved boolean NOT NULL DEFAULT false; -- true = carried forward from registry, not entered this period

-- identity_mapping_history: extend the append-only audit trail to record
-- which mode was used and the local identity target (when applicable).
ALTER TABLE bhxh.identity_mapping_history
  ADD COLUMN mode text NOT NULL DEFAULT 'employee_code' CHECK (mode IN ('employee_code','local_identity')),
  ADD COLUMN to_local_identity_id uuid REFERENCES bhxh.identity_registry (id);
ALTER TABLE bhxh.identity_mapping_history ALTER COLUMN to_employee_code DROP NOT NULL;

GRANT SELECT, INSERT, UPDATE ON bhxh.identity_registry TO phf_hr_app;

RESET ROLE;
COMMIT;
