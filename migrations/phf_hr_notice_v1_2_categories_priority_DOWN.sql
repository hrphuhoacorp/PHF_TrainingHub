-- DOWN for phf_hr_notice_v1_2_categories_priority.sql. REVIEW ONLY. Never PROD.
\set ON_ERROR_STOP on
BEGIN;
SET ROLE phf_hr_owner;
DO $$ BEGIN
  IF current_user <> 'phf_hr_owner' THEN RAISE EXCEPTION 'ROLE_NOT_ACTIVE'; END IF;
END $$;
SET LOCAL search_path = notice, public;

DROP INDEX IF EXISTS notice.notices_priority_idx;
ALTER TABLE notice.notices DROP COLUMN IF EXISTS priority;
ALTER TABLE notice.notices DROP CONSTRAINT IF EXISTS notices_category_fk;
-- restore the closed 4-value CHECK (only valid if every row is still one of the 4)
ALTER TABLE notice.notices
  ADD CONSTRAINT notices_notice_type_check
  CHECK (notice_type IN ('regulation', 'policy', 'process', 'guide'));
DROP TABLE IF EXISTS notice.notice_categories;

RESET ROLE;
COMMIT;
