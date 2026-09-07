-- =============================================================================
-- PHF HR — THÔNG BÁO QUẢN TRỊ V1 · Final functional patch · categories + priority
-- Target : Company PostgreSQL phf_hr (dev/throwaway: phf_hr_e2e), schema notice
-- ADDITIVE. Existing notices keep their meaning: the 4 fixed notice_type values
-- (regulation/policy/process/guide) become the 4 seeded system categories, and
-- notices.notice_type is repurposed as the category slug (still exactly one per
-- notice, referenced BY VALUE with an FK for integrity). Priority defaults to
-- 'normal' for every existing row.
--
-- REVIEW ONLY. Never run against Production in this batch. DOWN reverses it.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;

SET ROLE phf_hr_owner;
DO $$ BEGIN
  IF current_user <> 'phf_hr_owner' THEN
    RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %.', current_user;
  END IF;
END $$;
SET LOCAL search_path = notice, public;

-- 1. CATEGORIES — Admin/Content-Manager-managed. Reorder + rename + enable/
--    disable. A category referenced by any notice is NEVER hard-deleted (there
--    is no DELETE grant + no delete path) — only is_active=false.
CREATE TABLE notice.notice_categories (
  slug          text PRIMARY KEY CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  name          text NOT NULL,
  sort_order    integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  is_system     boolean NOT NULL DEFAULT false,   -- the 4 seeded defaults; cannot be renamed away entirely / kept undeletable
  created_by_account_id text,
  created_by_name       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by_account_id text,
  updated_by_name       text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX notice_categories_name_ci_uq ON notice.notice_categories (lower(name));
CREATE INDEX notice_categories_order_idx ON notice.notice_categories (sort_order, is_active);
CREATE TRIGGER notice_categories_touch BEFORE UPDATE ON notice.notice_categories
  FOR EACH ROW EXECUTE FUNCTION notice.set_updated_at();

INSERT INTO notice.notice_categories (slug, name, sort_order, is_active, is_system) VALUES
  ('regulation', 'Quy định',   10, true, true),
  ('policy',     'Chính sách', 20, true, true),
  ('process',    'Quy trình',  30, true, true),
  ('guide',      'Hướng dẫn',  40, true, true);

-- 2. notices.notice_type -> category slug (drop the closed 4-value CHECK, add FK)
ALTER TABLE notice.notices DROP CONSTRAINT IF EXISTS notices_notice_type_check;
-- every current value already matches a seeded slug
ALTER TABLE notice.notices
  ADD CONSTRAINT notices_category_fk
  FOREIGN KEY (notice_type) REFERENCES notice.notice_categories (slug);

-- 3. priority — FIXED set, never dynamically configurable. Independent of
--    require_acknowledgement.
ALTER TABLE notice.notices
  ADD COLUMN priority text NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('normal', 'important', 'urgent'));
CREATE INDEX notices_priority_idx ON notice.notices (priority) WHERE priority <> 'normal';

-- 4. grants — categories: no DELETE (never hard-deleted). notices already has
--    SELECT/INSERT/UPDATE/DELETE from earlier migrations; the new column needs
--    no extra grant (column-level grants not used here).
GRANT SELECT, INSERT, UPDATE ON notice.notice_categories TO phf_hr_app;

RESET ROLE;
COMMIT;
