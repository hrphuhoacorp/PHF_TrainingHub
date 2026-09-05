-- =============================================================================
-- PHF HR — CHƯƠNG TRÌNH THI ĐUA (Competition) V1.1 · "Tôi cũng gặp" occurrence signal
-- Target : Company PostgreSQL, database phf_hr_e2e (dev/test), schema competition
-- Owner  : phf_hr_owner   ·   Runtime role : phf_hr_app — same pattern as
--          phf_hr_competition_v1.sql, additive only (no ALTER on existing tables).
--
-- PURPOSE: when N participants independently confirm they hit the SAME
-- situation as an already-submitted contribution, PHF wants to know it
-- happened N times WITHOUT creating N duplicate Competition submissions and
-- WITHOUT affecting score/leaderboard in any way. This table is that
-- frequency signal ONLY.
--
-- Deliberately NOT competition.reactions: "heart" (Feed appreciation) and
-- "tôi cũng gặp" (situation-frequency evidence, visible to reviewers/admin,
-- never to the public) are different business meanings with different
-- readers — reusing reactions would conflate them (a reaction-count query
-- would start counting confirmations, and a UI reading "heart count" would
-- silently start showing frequency data). Two small tables, one meaning each,
-- is the cleaner design.
--
-- Run AFTER phf_hr_competition_v1.sql. DOWN = same filename + _DOWN.sql.
-- REVIEW ONLY until a human/deployer applies it to the verified dev DB.
-- =============================================================================
\set ON_ERROR_STOP on

BEGIN;

SET ROLE phf_hr_owner;
DO $$ BEGIN
  IF current_user <> 'phf_hr_owner' THEN
    RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %. Abort before DDL.', current_user;
  END IF;
END $$;

SET LOCAL search_path = competition, public;

-- =============================================================================
-- submission_occurrences — "Tôi cũng gặp tình huống này"
-- =============================================================================
CREATE TABLE competition.submission_occurrences (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           uuid NOT NULL REFERENCES competition.campaigns(id) ON DELETE CASCADE,
  source_submission_id  uuid NOT NULL REFERENCES competition.submissions(id) ON DELETE CASCADE,
  account_id            text NOT NULL,
  employee_code         text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submission_occurrences_actor_ck CHECK (
    nullif(btrim(account_id), '') IS NOT NULL AND nullif(btrim(employee_code), '') IS NOT NULL)
);

-- one participant may confirm the SAME source submission only once, ever.
-- No is_active/revoke flow exists (or is requested) for this signal — a
-- confirmation is a durable fact ("this happened"), not a toggle.
CREATE UNIQUE INDEX submission_occurrences_uk
  ON competition.submission_occurrences(source_submission_id, account_id);

CREATE INDEX submission_occurrences_source_idx
  ON competition.submission_occurrences(source_submission_id);
CREATE INDEX submission_occurrences_campaign_idx
  ON competition.submission_occurrences(campaign_id);

COMMENT ON TABLE competition.submission_occurrences IS
  'Frequency/evidence signal for "Toi cung gap tinh huong nay". NEVER creates '
  'a new competition.submissions row, NEVER affects score/leaderboard/awards. '
  'Distinct from competition.reactions (heart = appreciation, different '
  'business meaning, different unique-per-person semantics owner).';

-- =============================================================================
-- GRANTS — phf_hr_app only, competition.* only, explicit, no wildcard, no PUBLIC
-- =============================================================================
GRANT SELECT, INSERT ON competition.submission_occurrences TO phf_hr_app;

COMMIT;
RESET ROLE;
