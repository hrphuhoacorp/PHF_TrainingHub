-- =============================================================================
-- PHF HR — THÔNG BÁO QUẢN TRỊ V1 · FOUNDATION MIGRATION (Batch 01)
-- Target : Company PostgreSQL, database phf_hr (dev/throwaway: phf_hr_e2e), schema notice
-- Owner  : phf_hr_owner   ·   Runtime role : phf_hr_app (NOLOGIN; phf_hr_runtime
--          logs in and SET LOCAL ROLE phf_hr_app per transaction — same pattern
--          as PHF Task / Competition / QTTH).
--
-- SCOPE (Batch 01): DATA STRUCTURE + hard invariants ONLY.
--   - notices (title, web content html + plain text, type, effective window,
--     pin, require-ack, replacement link, soft delete, current revision pointer)
--   - notice_scopes    (company | department | branch — LABEL/CONTEXT, never ACL)
--   - notice_keywords  (search terms)
--   - notice_revisions (immutable content snapshot per publish/edit; ack binds here)
--   - notice_attachments (image/pdf/word/excel/link; revision-scoped; audited)
--   - notice_views          (auto on detail open — first/last viewed)
--   - notice_acknowledgements (explicit "Tôi đã đọc và nắm thông tin"; per revision;
--                              NO un-tick — event, not setting)
--   - notice_audit_logs (append-only; every management mutation, before/after JSON)
--   - notice_permissions + notice_permission_history
--        (ONE manage toggle per person; unchecked == "Chỉ xem";
--         System Admin is ALWAYS manager and is NOT stored here)
--   - notice.vn_unaccent()  + notices.search_tsv  + GIN index  (server-side FTS,
--     accent-insensitive, no extension required, scales to thousands)
--
--   Effective status (ACTIVE/UPCOMING/EXPIRED/DELETED) is DERIVED, never stored.
--   NO cross-database FK to Supabase People Master — account_id / employee_code
--   are EXTERNAL identity references stored as text, resolved & verified on the
--   Vercel side (People Master, Supabase MAIN) before any write reaches here.
--
-- DOWN = phf_hr_notice_v1_DOWN.sql.
-- REVIEW ONLY until a human/deployer applies it to the verified dev DB.
-- NEVER run against Production in this batch.
-- =============================================================================
\set ON_ERROR_STOP on

BEGIN;

CREATE SCHEMA IF NOT EXISTS notice;
ALTER SCHEMA notice OWNER TO phf_hr_owner;
COMMENT ON SCHEMA notice IS
  'PHF HR Thông báo Quản trị V1 canonical data — company-wide notice feed, '
  'revisions, view/acknowledgement ledger, audit trail and the module manage '
  'permission. People/account master is external (Supabase People Master); '
  'identity is referenced by value (account_id / employee_code), never by FK. '
  'This module never writes back to People Master. "Áp dụng" (notice_scopes) is '
  'a reader label + report denominator ONLY — it is NOT a visibility ACL: every '
  'authenticated PHF HR account can read every published, non-deleted notice.';

SET ROLE phf_hr_owner;
DO $$ BEGIN
  IF current_user <> 'phf_hr_owner' THEN
    RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %. Abort before DDL.', current_user;
  END IF;
END $$;

SET LOCAL search_path = notice, public;

-- =============================================================================
-- SHARED HELPERS
-- =============================================================================
CREATE FUNCTION notice.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE FUNCTION notice.block_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % on %.% is not allowed', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END $$;

-- Accent-folding for Vietnamese full-text search WITHOUT the unaccent extension
-- (phf_hr_app cannot CREATE EXTENSION and PROD parity must not depend on it).
-- IMMUTABLE so it can be used in a generated column + a functional index.
CREATE FUNCTION notice.vn_unaccent(txt text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT lower(translate(
    $1,
    'ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĂăĐđĨĩŨũƠơƯưẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹ',
    'AAAAEEEIIOOOOUUYaaaaeeeiioooouuyAaDdIiUuOoUuAaAaAaAaAaAaAaAaAaAaAaAaEeEeEeEeEeEeIiIiOoOoOoOoOoOoOoOoOoOoOoOoUuUuUuUuUuUuUuYyYyYyYy'
  ));
$$;

-- =============================================================================
-- 1. NOTICES — one row per notice. Content lives on the web (html + plain text);
--    files are only attachments. Effective status is DERIVED at read time.
-- =============================================================================
CREATE TABLE notice.notices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 text NOT NULL,
  content_html          text NOT NULL DEFAULT '',
  content_text          text NOT NULL DEFAULT '',           -- plain-text projection for search + excerpt
  notice_type           text NOT NULL CHECK (notice_type IN ('regulation','policy','process','guide')),
  effective_from        date NOT NULL,
  effective_to          date,                               -- NULL = không thời hạn
  require_acknowledgement boolean NOT NULL DEFAULT false,
  is_pinned             boolean NOT NULL DEFAULT false,
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  published_at          timestamptz,
  replaced_notice_id    uuid REFERENCES notice.notices (id),          -- this notice REPLACES that one
  superseded_by_notice_id uuid REFERENCES notice.notices (id),        -- set when a replacement of THIS one goes effective
  current_revision_id   uuid,                               -- FK added after notice_revisions exists
  deleted_at            timestamptz,
  deleted_by_account_id text,
  deleted_by_name       text,
  created_by_account_id text,
  created_by_employee_code text,
  created_by_name       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_by_account_id text,
  updated_by_name       text,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (id <> replaced_notice_id),
  CHECK (id <> superseded_by_notice_id)
);
CREATE INDEX notices_feed_idx     ON notice.notices (status, deleted_at, is_pinned DESC, published_at DESC);
CREATE INDEX notices_type_idx     ON notice.notices (notice_type);
CREATE INDEX notices_effective_idx ON notice.notices (effective_from, effective_to);
CREATE INDEX notices_replaced_idx ON notice.notices (replaced_notice_id);
CREATE TRIGGER notices_touch BEFORE UPDATE ON notice.notices
  FOR EACH ROW EXECUTE FUNCTION notice.set_updated_at();

-- Full-text search vector: title (weight A) + keywords (A) + body (B), all
-- accent-folded. Maintained by trigger because notice_keywords is a child table.
ALTER TABLE notice.notices ADD COLUMN search_tsv tsvector;
CREATE INDEX notices_search_gin ON notice.notices USING gin (search_tsv);

CREATE FUNCTION notice.rebuild_notice_tsv(p_notice_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_title text; v_text text; v_kw text;
BEGIN
  SELECT title, content_text INTO v_title, v_text FROM notice.notices WHERE id = p_notice_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT string_agg(keyword, ' ') INTO v_kw FROM notice.notice_keywords WHERE notice_id = p_notice_id;
  UPDATE notice.notices SET search_tsv =
      setweight(to_tsvector('simple', notice.vn_unaccent(coalesce(v_title,''))), 'A')
   || setweight(to_tsvector('simple', notice.vn_unaccent(coalesce(v_kw,''))),    'A')
   || setweight(to_tsvector('simple', notice.vn_unaccent(coalesce(v_text,''))),  'B')
  WHERE id = p_notice_id;
END $$;

CREATE FUNCTION notice.notices_tsv_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notice.rebuild_notice_tsv(NEW.id);
  RETURN NULL;
END $$;
CREATE TRIGGER notices_tsv_after_write
  AFTER INSERT OR UPDATE OF title, content_text ON notice.notices
  FOR EACH ROW EXECUTE FUNCTION notice.notices_tsv_trigger();

-- =============================================================================
-- 2. NOTICE_SCOPES — "Áp dụng". LABEL + report denominator ONLY, never an ACL.
-- =============================================================================
CREATE TABLE notice.notice_scopes (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notice_id    uuid NOT NULL REFERENCES notice.notices (id) ON DELETE CASCADE,
  scope_type   text NOT NULL CHECK (scope_type IN ('company','department','branch')),
  scope_value  text,                                  -- NULL for company; dept/branch name otherwise
  CHECK (scope_type = 'company' OR scope_value IS NOT NULL)
);
CREATE UNIQUE INDEX notice_scopes_uq ON notice.notice_scopes (notice_id, scope_type, coalesce(scope_value,''));
CREATE INDEX notice_scopes_notice_idx ON notice.notice_scopes (notice_id);

-- =============================================================================
-- 3. NOTICE_KEYWORDS — free search terms.
-- =============================================================================
CREATE TABLE notice.notice_keywords (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notice_id    uuid NOT NULL REFERENCES notice.notices (id) ON DELETE CASCADE,
  keyword      text NOT NULL CHECK (btrim(keyword) <> '')
);
CREATE UNIQUE INDEX notice_keywords_uq ON notice.notice_keywords (notice_id, lower(keyword));
CREATE INDEX notice_keywords_notice_idx ON notice.notice_keywords (notice_id);
CREATE FUNCTION notice.notice_keywords_tsv_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notice.rebuild_notice_tsv(COALESCE(NEW.notice_id, OLD.notice_id));
  RETURN NULL;
END $$;
CREATE TRIGGER notice_keywords_tsv_after_write
  AFTER INSERT OR UPDATE OR DELETE ON notice.notice_keywords
  FOR EACH ROW EXECUTE FUNCTION notice.notice_keywords_tsv_trigger();

-- =============================================================================
-- 4. NOTICE_REVISIONS — immutable content snapshot. Acknowledgement binds to a
--    revision. A new revision is created on publish and on every edit; when the
--    Content Manager ticks "Yêu cầu xác nhận lại" the revision is marked so and
--    the current ack state becomes incomplete for it.
-- =============================================================================
CREATE TABLE notice.notice_revisions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id               uuid NOT NULL REFERENCES notice.notices (id) ON DELETE CASCADE,
  revision_no             integer NOT NULL,
  title_snapshot          text NOT NULL,
  content_html_snapshot   text NOT NULL DEFAULT '',
  content_text_snapshot   text NOT NULL DEFAULT '',
  metadata_snapshot       jsonb NOT NULL DEFAULT '{}'::jsonb,     -- type, effective window, scopes, keywords
  require_reacknowledgement boolean NOT NULL DEFAULT false,
  change_summary          text,
  created_by_account_id   text,
  created_by_employee_code text,
  created_by_name         text,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX notice_revisions_no_uq ON notice.notice_revisions (notice_id, revision_no);
CREATE INDEX notice_revisions_notice_idx ON notice.notice_revisions (notice_id, created_at DESC);
CREATE TRIGGER notice_revisions_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON notice.notice_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION notice.block_history_mutation();

ALTER TABLE notice.notices
  ADD CONSTRAINT notices_current_revision_fk
  FOREIGN KEY (current_revision_id) REFERENCES notice.notice_revisions (id);

-- =============================================================================
-- 5. NOTICE_ATTACHMENTS — reuse the PHF secure attachment store pattern
--    (authenticated download only). Rows are revision-scoped so a revision's
--    file set is reproducible. Soft-removed, never hard-deleted (audit).
-- =============================================================================
CREATE TABLE notice.notice_attachments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id            uuid NOT NULL REFERENCES notice.notices (id) ON DELETE CASCADE,
  revision_id          uuid REFERENCES notice.notice_revisions (id),
  kind                 text NOT NULL CHECK (kind IN ('file','link')),
  file_type            text,                            -- image | pdf | word | excel  (NULL for link)
  file_name            text,
  storage_key          text,                            -- server-side key in the PHF attachment store
  link_url             text,
  byte_size            bigint,
  created_by_account_id text,
  created_by_name       text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  deleted_by_account_id text,
  deleted_by_name      text,
  CHECK ((kind = 'file' AND storage_key IS NOT NULL) OR (kind = 'link' AND link_url IS NOT NULL))
);
CREATE INDEX notice_attachments_notice_idx ON notice.notice_attachments (notice_id, created_at);

-- =============================================================================
-- 6. NOTICE_VIEWS — automatic, on notice DETAIL open. One row per viewer.
--    viewer_key = 'EMP:<code>' when an employee identity exists, else
--    'ACC:<account_id>' (Admin / account-only sessions). §10.1.
-- =============================================================================
CREATE TABLE notice.notice_views (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notice_id         uuid NOT NULL REFERENCES notice.notices (id) ON DELETE CASCADE,
  viewer_key        text NOT NULL,
  account_id        text,
  employee_code     text,
  first_viewed_at   timestamptz NOT NULL DEFAULT now(),
  last_viewed_at    timestamptz NOT NULL DEFAULT now(),
  view_count        integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX notice_views_uq ON notice.notice_views (notice_id, viewer_key);
CREATE INDEX notice_views_emp_idx ON notice.notice_views (employee_code);

-- =============================================================================
-- 7. NOTICE_ACKNOWLEDGEMENTS — explicit "Tôi đã đọc và nắm thông tin".
--    Per (revision, viewer). NO un-tick (no UPDATE/DELETE) — it records an event.
--    Even a viewer outside the notice's "Áp dụng" scope may acknowledge (§10.4).
-- =============================================================================
CREATE TABLE notice.notice_acknowledgements (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notice_id         uuid NOT NULL REFERENCES notice.notices (id) ON DELETE CASCADE,
  revision_id       uuid NOT NULL REFERENCES notice.notice_revisions (id),
  acker_key         text NOT NULL,                      -- 'EMP:<code>' | 'ACC:<account_id>'
  account_id        text,
  employee_code     text,
  acker_name        text,
  acknowledged_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX notice_ack_uq ON notice.notice_acknowledgements (revision_id, acker_key);
CREATE INDEX notice_ack_notice_idx ON notice.notice_acknowledgements (notice_id);
CREATE INDEX notice_ack_emp_idx ON notice.notice_acknowledgements (employee_code);
CREATE TRIGGER notice_ack_no_untick
  BEFORE UPDATE OR DELETE OR TRUNCATE ON notice.notice_acknowledgements
  FOR EACH STATEMENT EXECUTE FUNCTION notice.block_history_mutation();

-- =============================================================================
-- 8. NOTICE_AUDIT_LOGS — append-only. Every management mutation (§19/§22).
-- =============================================================================
CREATE TABLE notice.notice_audit_logs (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notice_id         uuid REFERENCES notice.notices (id) ON DELETE SET NULL,
  actor_account_id  text,
  actor_employee_code text,
  actor_name        text,
  action_type       text NOT NULL,
  before_json       jsonb,
  after_json        jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notice_audit_notice_idx ON notice.notice_audit_logs (notice_id, created_at DESC);
CREATE INDEX notice_audit_action_idx ON notice.notice_audit_logs (action_type, created_at DESC);
CREATE TRIGGER notice_audit_no_mutation
  BEFORE UPDATE OR DELETE OR TRUNCATE ON notice.notice_audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION notice.block_history_mutation();

-- =============================================================================
-- 9. NOTICE_PERMISSIONS — ONE manage toggle per person (§6). Row created lazily;
--    absence == "Chỉ xem". System Admin is ALWAYS a manager and is NOT stored
--    here. can_manage is NEVER inferred from department / other module roles.
-- =============================================================================
CREATE TABLE notice.notice_permissions (
  employee_code        text PRIMARY KEY,
  can_manage           boolean NOT NULL DEFAULT false,
  updated_by_account_id text,
  updated_by_name       text,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER notice_permissions_touch BEFORE UPDATE ON notice.notice_permissions
  FOR EACH ROW EXECUTE FUNCTION notice.set_updated_at();

CREATE TABLE notice.notice_permission_history (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_code       text NOT NULL,
  before_value        boolean,
  after_value         boolean,
  changed_by_account_id text,
  changed_by_name       text,
  changed_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notice_permission_history_emp_idx ON notice.notice_permission_history (employee_code, changed_at DESC);
CREATE TRIGGER notice_permission_history_no_mutation
  BEFORE UPDATE OR DELETE OR TRUNCATE ON notice.notice_permission_history
  FOR EACH STATEMENT EXECUTE FUNCTION notice.block_history_mutation();

-- =============================================================================
-- GRANTS — phf_hr_app only, notice.* only, explicit, no wildcard, no PUBLIC.
-- No ALTER DEFAULT PRIVILEGES: every future notice table needs its own GRANT.
-- =============================================================================
GRANT USAGE ON SCHEMA notice TO phf_hr_app;
GRANT EXECUTE ON FUNCTION notice.vn_unaccent(text) TO phf_hr_app;
GRANT EXECUTE ON FUNCTION notice.rebuild_notice_tsv(uuid) TO phf_hr_app;

GRANT SELECT, INSERT, UPDATE ON notice.notices                     TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON notice.notice_scopes       TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON notice.notice_keywords     TO phf_hr_app;
GRANT SELECT, INSERT                 ON notice.notice_revisions     TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE         ON notice.notice_attachments   TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE         ON notice.notice_views         TO phf_hr_app;
GRANT SELECT, INSERT                 ON notice.notice_acknowledgements TO phf_hr_app;
GRANT SELECT, INSERT                 ON notice.notice_audit_logs    TO phf_hr_app;
GRANT SELECT, INSERT, UPDATE         ON notice.notice_permissions   TO phf_hr_app;
GRANT SELECT, INSERT                 ON notice.notice_permission_history TO phf_hr_app;

RESET ROLE;

COMMIT;
