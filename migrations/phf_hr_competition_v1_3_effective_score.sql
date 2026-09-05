-- =============================================================================
-- PHF HR — CHƯƠNG TRÌNH THI ĐUA (Competition) V1.3 · effective score (0/2/5)
-- Target : Company PostgreSQL, database phf_hr_e2e (dev/test), schema competition
-- Owner  : phf_hr_owner   ·   Runtime role : phf_hr_app — additive: one new
--          nullable column + one new CHECK on it, plus widening the existing
--          submission_history_action_ck whitelist to accept the new
--          'score_adjust' audit action (drop + re-add, same values plus one —
--          no data rewrite, no existing history row is touched).
--
-- WHY a new column instead of touching current_score/current_level_order:
-- current_score/current_level_order are tied by CHECK to a REAL
-- approval_levels row (submissions_score_pair_ck, submissions_approved_
-- has_level_ck, the (campaign_id, current_level_order) FK) — they represent
-- "what a reviewer decided during the ORIGINAL review", and that history
-- must stay intact (LOCKED, V1.3 spec). "0 = Không ghi nhận" is explicitly
-- NOT a reviewer-authority level (no approval_levels row, no "Reviewer 0"),
-- so it cannot be expressed through that pair without weakening those
-- invariants for every submission, not just adjusted ones.
--
-- effective_score is the single source of truth every count/sum (progress,
-- leaderboard, awards) now reads via COALESCE(effective_score, current_score):
--   NULL            -> never adjusted, use current_score as before (fully
--                      backward-compatible with every pre-V1.3 submission).
--   0 / 2 / 5 (etc.) -> an authorized post-approval adjustment; current_score
--                      / current_level_order stay untouched as the audit
--                      record of the original review decision.
--
-- Run AFTER phf_hr_competition_v1.sql (+ v1_1). DOWN = same filename + _DOWN.sql.
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

ALTER TABLE competition.submissions
  ADD COLUMN effective_score numeric(12,2);

ALTER TABLE competition.submissions
  ADD CONSTRAINT submissions_effective_score_ck CHECK (effective_score IS NULL OR effective_score >= 0);

COMMENT ON COLUMN competition.submissions.effective_score IS
  'V1.3 post-approval score adjustment (0/2/5, Reviewer-top-level/Admin only). '
  'NULL = not adjusted, use current_score. current_score/current_level_order '
  'are NEVER rewritten by an adjustment — they remain the audit record of '
  'the original review decision; see competition-submissions.js adjustScore() '
  'and submission_history action ''score_adjust''.';

-- widen the append-only history's action whitelist — same values as V1,
-- plus 'score_adjust' for adjustScore()'s audit row.
ALTER TABLE competition.submission_history DROP CONSTRAINT submission_history_action_ck;
ALTER TABLE competition.submission_history ADD CONSTRAINT submission_history_action_ck CHECK (action IN
  ('create','edit','submit','revision_requested','revise','approve','upgrade',
   'reject','finalize','approval_withdrawn','admin_override','score_adjust'));

COMMIT;
RESET ROLE;
