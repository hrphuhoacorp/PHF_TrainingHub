-- =============================================================================
-- PHF HR — SYSTEM V1 · NHẬT KÝ HỆ THỐNG (Audit Log) — FOUNDATION V1
-- Target : Company PostgreSQL, database phf_hr (dev/throwaway: phf_hr_e2e), schema audit
-- Scope  : ONE central append-only audit store. Auth + account-management events
--          are wired GOING FORWARD only (no backfill). Task/Notice/Competition/
--          Checklist/KNL integration is a LATER batch — NOT here.
--
-- Identity (actor_account_id / actor_employee_code / actor_name) is referenced
-- BY VALUE, never by FK. object_type/object_id/object_label are also value-only
-- so an audit row SURVIVES deletion of the business object it describes.
--
-- DOWN = phf_hr_audit_v1_DOWN.sql.
-- REVIEW ONLY until the deployer applies it to the verified throwaway DB.
-- NEVER run against Production in this batch.
-- =============================================================================
\set ON_ERROR_STOP on

BEGIN;

CREATE SCHEMA IF NOT EXISTS audit;
ALTER SCHEMA audit OWNER TO phf_hr_owner;
COMMENT ON SCHEMA audit IS
  'PHF HR System V1 central audit log. ONE append-only table (audit.entries). '
  'Answers "ai đã làm gì trên hệ thống?". Identity + object are referenced by '
  'value only (no FK) so rows survive business-object deletion. The Admin screen '
  'reads from this table ONLY — no live cross-datastore join. Central stream '
  'starts at Foundation V1 go-live; there is no historical backfill.';

SET ROLE phf_hr_owner;
DO $$ BEGIN
  IF current_user <> 'phf_hr_owner' THEN
    RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %. Abort before DDL.', current_user;
  END IF;
END $$;

SET LOCAL search_path = audit, public;

-- Reused verbatim from the notice.block_history_mutation / task forbid-update
-- pattern: append-only enforced at the DB, not merely by application convention.
CREATE FUNCTION audit.block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % on %.% is not allowed', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END $$;

-- =============================================================================
-- audit.entries — the one central table.
--   result       : 'success' | 'failure' | 'blocked'   (default 'success')
--   source_system: 'web' | 'phf-hr-api' | 'cron' | 'backfill' | ...
--   *_json       : BOUNDED, projected, PII-scrubbed at emit time (see
--                  services/phf-hr-api/lib/audit-service.js boundJson()).
--                  A truncated projection carries {"_truncated": true}.
-- =============================================================================
CREATE TABLE audit.entries (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at           timestamptz NOT NULL DEFAULT now(),

  actor_account_id      text,
  actor_employee_code   text,
  actor_name            text,

  module                text NOT NULL,
  action                text NOT NULL,

  object_type           text,
  object_id             text,
  object_label          text,

  result                text NOT NULL DEFAULT 'success'
                          CHECK (result IN ('success','failure','blocked')),
  source_system         text NOT NULL DEFAULT 'web',

  request_id            text,
  ip                    text,
  user_agent            text,

  before_json           jsonb,
  after_json            jsonb,
  metadata_json         jsonb,

  CONSTRAINT audit_entries_module_ck  CHECK (nullif(btrim(module), '') IS NOT NULL),
  CONSTRAINT audit_entries_action_ck  CHECK (nullif(btrim(action), '') IS NOT NULL),
  -- hard DB backstop against giant payload dumps (helper bounds far tighter)
  CONSTRAINT audit_entries_before_len CHECK (before_json  IS NULL OR pg_column_size(before_json)  <= 16384),
  CONSTRAINT audit_entries_after_len  CHECK (after_json   IS NULL OR pg_column_size(after_json)   <= 16384),
  CONSTRAINT audit_entries_meta_len   CHECK (metadata_json IS NULL OR pg_column_size(metadata_json) <= 8192),
  CONSTRAINT audit_entries_ua_len     CHECK (user_agent IS NULL OR length(user_agent) <= 512)
);
COMMENT ON TABLE audit.entries IS 'PHF HR central audit log — append-only (DB trigger). Value-only identity/object refs.';

-- Keyset pagination anchor + the four locked filter columns. Not over-indexed.
CREATE INDEX audit_entries_occurred_id_idx ON audit.entries (occurred_at DESC, id DESC);
CREATE INDEX audit_entries_actor_idx       ON audit.entries (actor_employee_code, occurred_at DESC);
CREATE INDEX audit_entries_module_idx      ON audit.entries (module, occurred_at DESC);
CREATE INDEX audit_entries_action_idx      ON audit.entries (action, occurred_at DESC);

CREATE TRIGGER audit_entries_no_update
  BEFORE UPDATE ON audit.entries
  FOR EACH ROW EXECUTE FUNCTION audit.block_mutation();
CREATE TRIGGER audit_entries_no_delete
  BEFORE DELETE ON audit.entries
  FOR EACH ROW EXECUTE FUNCTION audit.block_mutation();
CREATE TRIGGER audit_entries_no_truncate
  BEFORE TRUNCATE ON audit.entries
  FOR EACH STATEMENT EXECUTE FUNCTION audit.block_mutation();

-- =============================================================================
-- GRANTS — least privilege. phf_hr_app: INSERT + SELECT only. Nothing to PUBLIC.
-- =============================================================================
REVOKE ALL ON SCHEMA audit FROM PUBLIC;
GRANT  USAGE ON SCHEMA audit TO phf_hr_app;
REVOKE ALL ON audit.entries FROM PUBLIC;
GRANT  SELECT, INSERT ON audit.entries TO phf_hr_app;
-- identity column: phf_hr_app must be able to draw the next value on INSERT
GRANT  USAGE ON ALL SEQUENCES IN SCHEMA audit TO phf_hr_app;
REVOKE EXECUTE ON FUNCTION audit.block_mutation() FROM PUBLIC;

RESET ROLE;

-- =============================================================================
-- POST-APPLY VALIDATION (SELECT-only, safe to re-run)
-- =============================================================================
SELECT 'schema audit exists = '        || count(*) FROM information_schema.schemata WHERE schema_name = 'audit';
SELECT 'table audit.entries exists = ' || count(*) FROM information_schema.tables   WHERE table_schema = 'audit' AND table_name = 'entries';
SELECT 'append-only triggers = '       || count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'audit' AND c.relname = 'entries' AND NOT t.tgisinternal;
SELECT 'indexes = '                    || count(*) FROM pg_indexes WHERE schemaname = 'audit' AND tablename = 'entries';
SELECT 'phf_hr_app can INSERT = '      || has_table_privilege('phf_hr_app', 'audit.entries', 'INSERT');
SELECT 'phf_hr_app can SELECT = '      || has_table_privilege('phf_hr_app', 'audit.entries', 'SELECT');
SELECT 'phf_hr_app CANNOT UPDATE = '   || NOT has_table_privilege('phf_hr_app', 'audit.entries', 'UPDATE');
SELECT 'phf_hr_app CANNOT DELETE = '   || NOT has_table_privilege('phf_hr_app', 'audit.entries', 'DELETE');

COMMIT;
