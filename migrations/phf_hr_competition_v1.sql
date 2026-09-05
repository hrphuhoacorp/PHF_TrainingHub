-- =============================================================================
-- PHF HR — CHƯƠNG TRÌNH THI ĐUA (Competition) V1 · FOUNDATION MIGRATION
-- Target : Company PostgreSQL, database phf_hr_e2e (dev/test), schema competition
-- Owner  : phf_hr_owner   ·   Runtime role : phf_hr_app (NOLOGIN; phf_hr_runtime
--          logs in and SET LOCAL ROLE phf_hr_app per transaction — same pattern
--          as PHF Task).
--
-- SCOPE (Batch B): DATA STRUCTURE + hard invariants ONLY.
--   - schema, tables, FKs (competition↔competition only), indexes, defaults,
--     CHECK constraints, append-only history guards, minimal lifecycle guards,
--     grants to phf_hr_app limited strictly to competition.*
--   - NO write-path orchestration (state machine, workload balancer, alias
--     generator, leaderboard/award engine) — that is phf-hr-api / Batch C.
--   - NO cross-database FK to Supabase People Master. account_id / employee_code
--     are EXTERNAL identity references stored as text, resolved & verified on
--     the Vercel side before any write reaches phf-hr-api.
--
-- Run phf_hr_competition_v1_PRE_APPLY_GATE.sql FIRST. Run
-- phf_hr_competition_v1_VALIDATION.sql AFTER. DOWN = phf_hr_competition_v1_DOWN.sql.
-- REVIEW ONLY until a human/deployer applies it to the verified dev DB.
-- =============================================================================
\set ON_ERROR_STOP on

BEGIN;

-- =============================================================================
-- SCHEMA — created by the connecting DDL admin (deployer / postgres), then
-- handed to phf_hr_owner. phf_hr_owner is NOLOGIN and has no CREATE on the
-- database itself, so it cannot CREATE SCHEMA; it only needs to OWN it.
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS competition;
ALTER SCHEMA competition OWNER TO phf_hr_owner;
COMMENT ON SCHEMA competition IS
  'PHF HR Competition (Chương trình thi đua) V1 canonical business data. '
  'People/account master is external (Supabase People Master); identity is '
  'referenced here by value (account_id, employee_code) — never by FK.';

-- Everything INSIDE the schema is owned by phf_hr_owner.
SET ROLE phf_hr_owner;
DO $$ BEGIN
  IF current_user <> 'phf_hr_owner' THEN
    RAISE EXCEPTION 'ROLE_NOT_ACTIVE: expected phf_hr_owner, got %. Abort before DDL.', current_user;
  END IF;
END $$;

SET LOCAL search_path = competition, public;

-- =============================================================================
-- SHARED HELPERS
-- =============================================================================
CREATE FUNCTION competition.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- Append-only guard for *_history tables.
CREATE FUNCTION competition.block_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % on %.% is not allowed',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END $$;

-- =============================================================================
-- 1. campaigns
-- =============================================================================
CREATE TABLE competition.campaigns (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                      text NOT NULL UNIQUE,
  title                     text NOT NULL,
  description               text,
  instructions              text,
  status                    text NOT NULL DEFAULT 'draft',
  form_schema               jsonb NOT NULL DEFAULT '[]'::jsonb,
  min_required_contributions integer,
  submission_starts_at      timestamptz,
  submission_deadline       timestamptz,
  review_deadline           timestamptz,
  publication_state         text NOT NULL DEFAULT 'internal',
  levels_frozen             boolean NOT NULL DEFAULT false,
  finalized_at              timestamptz,
  created_by_account_id     text,
  created_by_employee_code  text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaigns_code_ck      CHECK (nullif(btrim(code), '') IS NOT NULL),
  CONSTRAINT campaigns_title_ck     CHECK (nullif(btrim(title), '') IS NOT NULL),
  CONSTRAINT campaigns_status_ck    CHECK (status IN ('draft','accepting','reviewing','finalized')),
  CONSTRAINT campaigns_pubstate_ck  CHECK (publication_state IN ('internal','published')),
  CONSTRAINT campaigns_form_arr_ck  CHECK (jsonb_typeof(form_schema) = 'array'),
  CONSTRAINT campaigns_minreq_ck    CHECK (min_required_contributions IS NULL OR min_required_contributions >= 0),
  -- publication only from a finalized campaign
  CONSTRAINT campaigns_publish_gate_ck CHECK (publication_state = 'internal' OR status = 'finalized'),
  -- finalized_at present iff finalized
  CONSTRAINT campaigns_finalized_at_ck CHECK ((status = 'finalized') = (finalized_at IS NOT NULL)),
  -- deadlines ordering (only checked when both present)
  CONSTRAINT campaigns_deadline_order_ck CHECK (
    submission_starts_at IS NULL OR submission_deadline IS NULL OR submission_starts_at <= submission_deadline)
);
COMMENT ON COLUMN competition.campaigns.min_required_contributions IS
  'Minimum VALID (approved) contributions required per participant per month. '
  'NULL = no participation requirement for this campaign.';
CREATE TRIGGER campaigns_touch BEFORE UPDATE ON competition.campaigns
  FOR EACH ROW EXECUTE FUNCTION competition.set_updated_at();
CREATE INDEX campaigns_status_idx ON competition.campaigns(status);

-- guard: publication can only be turned on for a finalized campaign (defence
-- in depth alongside the CHECK — clearer error, and blocks the ordering bug
-- where status is flipped away from finalized while still published).
CREATE FUNCTION competition.guard_campaign_publish() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.publication_state = 'published' AND NEW.status <> 'finalized' THEN
    RAISE EXCEPTION 'PUBLISH_GATE: campaign % cannot be published while status=% (must be finalized)',
      NEW.id, NEW.status;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campaigns_publish_guard BEFORE INSERT OR UPDATE ON competition.campaigns
  FOR EACH ROW EXECUTE FUNCTION competition.guard_campaign_publish();

-- =============================================================================
-- 2. approval_levels  (per-campaign, configurable — NOT hardcoded 2/5)
-- =============================================================================
CREATE TABLE competition.approval_levels (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  uuid NOT NULL REFERENCES competition.campaigns(id) ON DELETE CASCADE,
  level_order  integer NOT NULL,
  name         text NOT NULL,
  score        numeric(12,2) NOT NULL,
  sla_hours    integer,                 -- reviewer SLA for assignments at this level; NULL = no SLA
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_levels_order_ck  CHECK (level_order >= 1),
  CONSTRAINT approval_levels_name_ck   CHECK (nullif(btrim(name), '') IS NOT NULL),
  CONSTRAINT approval_levels_score_ck  CHECK (score >= 0),
  CONSTRAINT approval_levels_sla_ck    CHECK (sla_hours IS NULL OR sla_hours > 0),
  CONSTRAINT approval_levels_campaign_order_uk UNIQUE (campaign_id, level_order),
  CONSTRAINT approval_levels_campaign_name_uk  UNIQUE (campaign_id, name)
);
CREATE TRIGGER approval_levels_touch BEFORE UPDATE ON competition.approval_levels
  FOR EACH ROW EXECUTE FUNCTION competition.set_updated_at();

-- guard: level definition editable ONLY while owning campaign is in 'draft'
-- and not frozen. phf-hr-api performs an audited exceptional correction by
-- issuing  SET LOCAL competition.allow_level_override = 'on'  inside the
-- transaction that also writes competition.campaign_history.
CREATE FUNCTION competition.guard_approval_level_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_campaign uuid := COALESCE(NEW.campaign_id, OLD.campaign_id);
  v_status   text;
  v_frozen   boolean;
  v_override boolean := COALESCE(current_setting('competition.allow_level_override', true), 'off') = 'on';
BEGIN
  SELECT status, levels_frozen INTO v_status, v_frozen
    FROM competition.campaigns WHERE id = v_campaign;
  -- owning campaign gone (ON DELETE CASCADE cleanup) or explicit audited
  -- override: nothing to protect.
  IF v_status IS NULL OR v_override THEN RETURN COALESCE(NEW, OLD); END IF;
  IF v_status IS DISTINCT FROM 'draft' OR v_frozen THEN
    RAISE EXCEPTION 'LEVELS_FROZEN: approval levels for campaign % are frozen (status=%, frozen=%). '
      'An audited admin exceptional correction is required.', v_campaign, v_status, v_frozen;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER approval_levels_change_guard
  BEFORE INSERT OR UPDATE OR DELETE ON competition.approval_levels
  FOR EACH ROW EXECUTE FUNCTION competition.guard_approval_level_change();

-- =============================================================================
-- 3. reviewer_grants  (per-campaign; one max level per reviewer per campaign)
-- =============================================================================
CREATE TABLE competition.reviewer_grants (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id               uuid NOT NULL REFERENCES competition.campaigns(id) ON DELETE CASCADE,
  account_id                text NOT NULL,
  employee_code             text NOT NULL,
  display_name              text,
  max_level_order           integer NOT NULL,
  is_active                 boolean NOT NULL DEFAULT true,
  granted_by_account_id     text,
  granted_by_employee_code  text,
  granted_at                timestamptz NOT NULL DEFAULT now(),
  revoked_at                timestamptz,
  revoked_by_account_id     text,
  revoke_reason             text,
  CONSTRAINT reviewer_grants_account_ck  CHECK (nullif(btrim(account_id), '') IS NOT NULL),
  CONSTRAINT reviewer_grants_emp_ck      CHECK (nullif(btrim(employee_code), '') IS NOT NULL),
  CONSTRAINT reviewer_grants_level_ck    CHECK (max_level_order >= 1),
  CONSTRAINT reviewer_grants_campaign_account_uk UNIQUE (campaign_id, account_id),
  -- max level must be a real level of the same campaign
  CONSTRAINT reviewer_grants_level_fk
    FOREIGN KEY (campaign_id, max_level_order)
    REFERENCES competition.approval_levels(campaign_id, level_order)
);
CREATE INDEX reviewer_grants_active_idx ON competition.reviewer_grants(campaign_id) WHERE is_active;
CREATE INDEX reviewer_grants_account_idx ON competition.reviewer_grants(account_id);

-- =============================================================================
-- 4. admin_grants  (module-wide; system PHF admin is implicit, no row)
-- =============================================================================
CREATE TABLE competition.admin_grants (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                text NOT NULL,
  employee_code             text NOT NULL,
  display_name              text,
  is_active                 boolean NOT NULL DEFAULT true,
  reason                    text,
  granted_by_account_id     text,
  granted_by_employee_code  text,
  granted_at                timestamptz NOT NULL DEFAULT now(),
  revoked_at                timestamptz,
  revoked_by_account_id     text,
  revoke_reason             text,
  CONSTRAINT admin_grants_account_ck CHECK (nullif(btrim(account_id), '') IS NOT NULL),
  CONSTRAINT admin_grants_emp_ck     CHECK (nullif(btrim(employee_code), '') IS NOT NULL)
);
CREATE UNIQUE INDEX admin_grants_active_account_uk
  ON competition.admin_grants(account_id) WHERE is_active;

-- =============================================================================
-- 5. capability_grants  (module-wide, company-wide; e.g. view_participation_progress)
-- =============================================================================
CREATE TABLE competition.capability_grants (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capability                text NOT NULL,
  account_id                text NOT NULL,
  employee_code             text NOT NULL,
  display_name              text,
  is_active                 boolean NOT NULL DEFAULT true,
  granted_by_account_id     text,
  granted_by_employee_code  text,
  granted_at                timestamptz NOT NULL DEFAULT now(),
  revoked_at                timestamptz,
  revoked_by_account_id     text,
  revoke_reason             text,
  CONSTRAINT capability_grants_cap_ck     CHECK (capability IN ('view_participation_progress')),
  CONSTRAINT capability_grants_account_ck CHECK (nullif(btrim(account_id), '') IS NOT NULL),
  CONSTRAINT capability_grants_emp_ck     CHECK (nullif(btrim(employee_code), '') IS NOT NULL)
);
CREATE UNIQUE INDEX capability_grants_active_uk
  ON competition.capability_grants(capability, account_id) WHERE is_active;
COMMENT ON TABLE competition.capability_grants IS
  'view_participation_progress: company-wide participation/productivity view. '
  'Does NOT confer reviewer rights or per-submission author identity.';

-- =============================================================================
-- 6. participant_aliases  (one system-assigned alias per participant per campaign)
-- =============================================================================
CREATE TABLE competition.participant_aliases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES competition.campaigns(id) ON DELETE CASCADE,
  account_id    text NOT NULL,
  employee_code text NOT NULL,
  alias         text NOT NULL,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT participant_aliases_account_ck CHECK (nullif(btrim(account_id), '') IS NOT NULL),
  CONSTRAINT participant_aliases_emp_ck     CHECK (nullif(btrim(employee_code), '') IS NOT NULL),
  CONSTRAINT participant_aliases_alias_ck   CHECK (nullif(btrim(alias), '') IS NOT NULL),
  CONSTRAINT participant_aliases_campaign_account_uk  UNIQUE (campaign_id, account_id),
  CONSTRAINT participant_aliases_campaign_emp_uk      UNIQUE (campaign_id, employee_code),
  CONSTRAINT participant_aliases_campaign_alias_uk    UNIQUE (campaign_id, alias)
);
CREATE INDEX participant_aliases_account_idx ON competition.participant_aliases(account_id);
COMMENT ON TABLE competition.participant_aliases IS
  'Real identity retained alongside the alias for auditability. Reviewer-facing '
  'queries MUST NOT select account_id / employee_code from this table.';

-- =============================================================================
-- 7. submissions
-- =============================================================================
CREATE TABLE competition.submissions (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id                   uuid NOT NULL REFERENCES competition.campaigns(id) ON DELETE CASCADE,
  author_account_id             text NOT NULL,
  author_employee_code          text NOT NULL,
  author_display_name_snapshot  text,
  author_department_snapshot    text,
  author_branch_snapshot        text,
  status                        text NOT NULL DEFAULT 'draft',
  payload                       jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_level_order           integer,
  current_score                 numeric(12,2),
  last_review_note              text,
  submitted_at                  timestamptz,   -- campaign membership time (first submit)
  approved_at                   timestamptz,   -- time of CURRENT approval
  first_approved_at             timestamptz,   -- earliest approval, immutable — tie-break key
  rejected_at                   timestamptz,
  finalized_at                  timestamptz,
  row_version                   integer NOT NULL DEFAULT 1,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submissions_author_ck  CHECK (nullif(btrim(author_account_id), '') IS NOT NULL
                                       AND nullif(btrim(author_employee_code), '') IS NOT NULL),
  CONSTRAINT submissions_status_ck  CHECK (status IN
    ('draft','submitted','needs_revision','approved','rejected','finalized')),
  CONSTRAINT submissions_payload_ck CHECK (jsonb_typeof(payload) = 'object'),
  -- score and level travel together
  CONSTRAINT submissions_score_pair_ck CHECK ((current_level_order IS NULL) = (current_score IS NULL)),
  -- an approved/finalized submission must carry a level+score
  CONSTRAINT submissions_approved_has_level_ck CHECK (
    status NOT IN ('approved','finalized') OR current_level_order IS NOT NULL),
  -- a submission that ever left 'draft' must have a submitted_at
  CONSTRAINT submissions_submitted_at_ck CHECK (
    status = 'draft' OR submitted_at IS NOT NULL),
  CONSTRAINT submissions_rowversion_ck CHECK (row_version >= 1),
  FOREIGN KEY (campaign_id, current_level_order)
    REFERENCES competition.approval_levels(campaign_id, level_order)
);
CREATE TRIGGER submissions_touch BEFORE UPDATE ON competition.submissions
  FOR EACH ROW EXECUTE FUNCTION competition.set_updated_at();
CREATE INDEX submissions_campaign_status_idx ON competition.submissions(campaign_id, status);
CREATE INDEX submissions_author_idx          ON competition.submissions(author_account_id);
CREATE INDEX submissions_feed_idx            ON competition.submissions(campaign_id)
  WHERE status IN ('approved','finalized');
CREATE INDEX submissions_level_idx           ON competition.submissions(campaign_id, current_level_order);

-- guard: approved content cannot silently mutate. Once a submission has left
-- the participant-editable states (draft / needs_revision), its payload and
-- authorship are immutable unless phf-hr-api sets
--   SET LOCAL competition.allow_submission_override = 'on'
-- inside an audited admin-override transaction.
CREATE FUNCTION competition.guard_submission_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_override boolean :=
  COALESCE(current_setting('competition.allow_submission_override', true), 'off') = 'on';
BEGIN
  IF v_override THEN RETURN NEW; END IF;
  IF OLD.status NOT IN ('draft','needs_revision') THEN
    IF NEW.payload IS DISTINCT FROM OLD.payload
       OR NEW.author_account_id    IS DISTINCT FROM OLD.author_account_id
       OR NEW.author_employee_code IS DISTINCT FROM OLD.author_employee_code THEN
      RAISE EXCEPTION 'SUBMISSION_LOCKED: payload/author of submission % is immutable in status % '
        '(admin override required)', OLD.id, OLD.status;
    END IF;
  END IF;
  -- first_approved_at, once set, never changes
  IF OLD.first_approved_at IS NOT NULL AND NEW.first_approved_at IS DISTINCT FROM OLD.first_approved_at THEN
    RAISE EXCEPTION 'SUBMISSION_LOCKED: first_approved_at of submission % is immutable', OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER submissions_immutability_guard BEFORE UPDATE ON competition.submissions
  FOR EACH ROW EXECUTE FUNCTION competition.guard_submission_immutability();

-- =============================================================================
-- 8. review_assignments  (authoritative source for reviewer workload/SLA/productivity)
-- =============================================================================
CREATE TABLE competition.review_assignments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id          uuid NOT NULL REFERENCES competition.submissions(id) ON DELETE CASCADE,
  campaign_id            uuid NOT NULL REFERENCES competition.campaigns(id) ON DELETE CASCADE,
  reviewer_account_id    text NOT NULL,
  reviewer_employee_code text NOT NULL,
  tier                   text NOT NULL,          -- 'primary_l1' | 'primary_high'
  level_scope_order      integer NOT NULL,       -- level this assignment covers
  status                 text NOT NULL DEFAULT 'assigned',
  assignment_method      text NOT NULL,
  assigned_by            text NOT NULL DEFAULT 'system',   -- 'system' | actor account_id
  assigned_at            timestamptz NOT NULL DEFAULT now(),
  due_at                 timestamptz,            -- assigned_at + level.sla_hours; NULL = no SLA
  completed_at           timestamptz,
  outcome                text,                   -- 'approved'|'needs_revision'|'rejected'|'upgraded'
  returned_at            timestamptz,
  is_active              boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_assignments_reviewer_ck CHECK (nullif(btrim(reviewer_account_id), '') IS NOT NULL),
  CONSTRAINT review_assignments_tier_ck     CHECK (tier IN ('primary_l1','primary_high')),
  CONSTRAINT review_assignments_level_ck    CHECK (level_scope_order >= 1),
  CONSTRAINT review_assignments_status_ck   CHECK (status IN
    ('assigned','in_progress','completed','returned_to_pool','reassigned','overdue_returned')),
  CONSTRAINT review_assignments_method_ck   CHECK (assignment_method IN
    ('auto_lowest_workload','auto_random_tiebreak','manual')),
  CONSTRAINT review_assignments_outcome_ck  CHECK (outcome IS NULL OR outcome IN
    ('approved','needs_revision','rejected','upgraded')),
  CONSTRAINT review_assignments_completed_ck CHECK (
    (status = 'completed') = (completed_at IS NOT NULL)),
  FOREIGN KEY (campaign_id, level_scope_order)
    REFERENCES competition.approval_levels(campaign_id, level_order)
);
-- exactly one ACTIVE assignment per (submission, tier)
CREATE UNIQUE INDEX review_assignments_active_uk
  ON competition.review_assignments(submission_id, tier) WHERE is_active;
CREATE INDEX review_assignments_workload_idx
  ON competition.review_assignments(reviewer_account_id) WHERE is_active;
CREATE INDEX review_assignments_campaign_status_idx
  ON competition.review_assignments(campaign_id, status);
CREATE INDEX review_assignments_due_idx
  ON competition.review_assignments(due_at) WHERE is_active;

-- self-review conflict is blocked at the DB edge too (defence in depth; the
-- assignment engine already excludes the author).
CREATE FUNCTION competition.guard_no_self_review() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_author text;
BEGIN
  SELECT author_account_id INTO v_author FROM competition.submissions WHERE id = NEW.submission_id;
  IF v_author IS NOT DISTINCT FROM NEW.reviewer_account_id THEN
    RAISE EXCEPTION 'SELF_REVIEW_BLOCKED: reviewer % is the author of submission %',
      NEW.reviewer_account_id, NEW.submission_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER review_assignments_self_review_guard
  BEFORE INSERT OR UPDATE OF reviewer_account_id, submission_id
  ON competition.review_assignments
  FOR EACH ROW EXECUTE FUNCTION competition.guard_no_self_review();

-- =============================================================================
-- 9. reactions  (feed "thả tim" — one active reaction per user per submission)
-- =============================================================================
CREATE TABLE competition.reactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES competition.submissions(id) ON DELETE CASCADE,
  account_id    text NOT NULL,
  employee_code text NOT NULL,
  reaction_type text NOT NULL DEFAULT 'heart',
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reactions_account_ck CHECK (nullif(btrim(account_id), '') IS NOT NULL),
  CONSTRAINT reactions_type_ck    CHECK (reaction_type IN ('heart'))
);
CREATE UNIQUE INDEX reactions_active_uk
  ON competition.reactions(submission_id, account_id) WHERE is_active;
CREATE INDEX reactions_submission_idx
  ON competition.reactions(submission_id) WHERE is_active;
CREATE TRIGGER reactions_touch BEFORE UPDATE ON competition.reactions
  FOR EACH ROW EXECUTE FUNCTION competition.set_updated_at();
COMMENT ON TABLE competition.reactions IS
  'Reactions never affect score / leaderboard / approval level / awards.';

-- =============================================================================
-- 10. awards
-- =============================================================================
CREATE TABLE competition.awards (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id                    uuid NOT NULL REFERENCES competition.campaigns(id) ON DELETE CASCADE,
  award_type                     text NOT NULL,             -- 'auto' | 'value'
  amount_vnd                     bigint NOT NULL,
  rank_basis                     integer,
  recipient_account_id           text NOT NULL,
  recipient_employee_code        text NOT NULL,
  recipient_display_name_snapshot text,
  status                         text NOT NULL DEFAULT 'proposed',
  selection_reason               text,
  tiebreak_applied               boolean NOT NULL DEFAULT false,
  tiebreak_reason                text,
  decided_by_account_id          text,
  decided_by_employee_code       text,
  decided_at                     timestamptz NOT NULL DEFAULT now(),
  superseded_by                  uuid REFERENCES competition.awards(id),
  created_at                     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awards_type_ck      CHECK (award_type IN ('auto','value')),
  CONSTRAINT awards_amount_ck    CHECK (amount_vnd > 0),
  CONSTRAINT awards_status_ck    CHECK (status IN ('proposed','confirmed','superseded','revoked')),
  CONSTRAINT awards_recipient_ck CHECK (nullif(btrim(recipient_account_id), '') IS NOT NULL),
  CONSTRAINT awards_tiebreak_ck  CHECK (NOT tiebreak_applied OR nullif(btrim(tiebreak_reason), '') IS NOT NULL)
);
-- one confirmed award of each type per campaign; a person cannot hold two
-- confirmed awards in the same campaign (auto 500k moves to next eligible if
-- the auto winner also takes the 1M value award).
CREATE UNIQUE INDEX awards_confirmed_type_uk
  ON competition.awards(campaign_id, award_type) WHERE status = 'confirmed';
CREATE UNIQUE INDEX awards_confirmed_recipient_uk
  ON competition.awards(campaign_id, recipient_account_id) WHERE status = 'confirmed';
CREATE INDEX awards_campaign_idx ON competition.awards(campaign_id);

-- =============================================================================
-- 11-15. APPEND-ONLY HISTORY / AUDIT
-- =============================================================================
CREATE TABLE competition.campaign_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         uuid NOT NULL REFERENCES competition.campaigns(id) ON DELETE CASCADE,
  action              text NOT NULL,
  actor_account_id    text,
  actor_employee_code text,
  actor_display_name  text,
  before              jsonb,
  after               jsonb,
  reason              text,
  at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_history_action_ck CHECK (action IN
    ('create','edit','status_change','reopen','publish','override',
     'level_create','level_edit','level_freeze','level_exceptional_correction'))
);
CREATE INDEX campaign_history_campaign_idx ON competition.campaign_history(campaign_id, at);

CREATE TABLE competition.submission_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id       uuid NOT NULL REFERENCES competition.submissions(id) ON DELETE CASCADE,
  action              text NOT NULL,
  actor_account_id    text,
  actor_employee_code text,
  actor_display_name  text,
  before              jsonb,
  after               jsonb,
  reason              text,
  at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submission_history_action_ck CHECK (action IN
    ('create','edit','submit','revision_requested','revise','approve','upgrade',
     'reject','finalize','approval_withdrawn','admin_override'))
);
CREATE INDEX submission_history_submission_idx ON competition.submission_history(submission_id, at);

CREATE TABLE competition.permission_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_kind          text NOT NULL,
  action              text NOT NULL,
  campaign_id         uuid REFERENCES competition.campaigns(id) ON DELETE CASCADE,
  capability          text,
  target_account_id   text,
  target_employee_code text,
  actor_account_id    text,
  actor_employee_code text,
  actor_display_name  text,
  before              jsonb,
  after               jsonb,
  reason              text,
  at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permission_history_kind_ck   CHECK (grant_kind IN ('reviewer','admin','capability')),
  CONSTRAINT permission_history_action_ck CHECK (action IN ('grant','revoke','modify'))
);
CREATE INDEX permission_history_target_idx ON competition.permission_history(target_account_id, at);

CREATE TABLE competition.review_assignment_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id       uuid NOT NULL REFERENCES competition.submissions(id) ON DELETE CASCADE,
  assignment_id       uuid REFERENCES competition.review_assignments(id) ON DELETE SET NULL,
  action              text NOT NULL,
  reviewer_account_id text,
  reviewer_employee_code text,
  actor_account_id    text,
  actor_employee_code text,
  actor_display_name  text,
  before              jsonb,
  after               jsonb,
  reason              text,
  at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_assignment_history_action_ck CHECK (action IN
    ('auto_assign','reassign','manual_reassign','sla_expiry','return_to_pool','completed'))
);
CREATE INDEX review_assignment_history_submission_idx
  ON competition.review_assignment_history(submission_id, at);
CREATE INDEX review_assignment_history_reviewer_idx
  ON competition.review_assignment_history(reviewer_account_id, at);

CREATE TABLE competition.award_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  award_id            uuid REFERENCES competition.awards(id) ON DELETE CASCADE,
  campaign_id         uuid NOT NULL REFERENCES competition.campaigns(id) ON DELETE CASCADE,
  action              text NOT NULL,
  actor_account_id    text,
  actor_employee_code text,
  actor_display_name  text,
  before              jsonb,
  after               jsonb,
  reason              text,
  at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT award_history_action_ck CHECK (action IN
    ('propose','confirm','supersede','revoke','tiebreak_decision','reassign_next_eligible'))
);
CREATE INDEX award_history_campaign_idx ON competition.award_history(campaign_id, at);

-- append-only enforcement on all five history tables
CREATE TRIGGER campaign_history_append_only
  BEFORE UPDATE OR DELETE ON competition.campaign_history
  FOR EACH ROW EXECUTE FUNCTION competition.block_history_mutation();
CREATE TRIGGER submission_history_append_only
  BEFORE UPDATE OR DELETE ON competition.submission_history
  FOR EACH ROW EXECUTE FUNCTION competition.block_history_mutation();
CREATE TRIGGER permission_history_append_only
  BEFORE UPDATE OR DELETE ON competition.permission_history
  FOR EACH ROW EXECUTE FUNCTION competition.block_history_mutation();
CREATE TRIGGER review_assignment_history_append_only
  BEFORE UPDATE OR DELETE ON competition.review_assignment_history
  FOR EACH ROW EXECUTE FUNCTION competition.block_history_mutation();
CREATE TRIGGER award_history_append_only
  BEFORE UPDATE OR DELETE ON competition.award_history
  FOR EACH ROW EXECUTE FUNCTION competition.block_history_mutation();

-- =============================================================================
-- GRANTS — phf_hr_app only, competition.* only, explicit, no wildcard, no PUBLIC
-- =============================================================================
GRANT USAGE ON SCHEMA competition TO phf_hr_app;

GRANT SELECT, INSERT, UPDATE ON
  competition.campaigns,
  competition.approval_levels,
  competition.reviewer_grants,
  competition.admin_grants,
  competition.capability_grants,
  competition.submissions,
  competition.review_assignments,
  competition.reactions,
  competition.awards
TO phf_hr_app;

-- approval_levels can be pruned while a campaign is still draft
GRANT DELETE ON competition.approval_levels TO phf_hr_app;

-- aliases: assign-once, never updated/deleted in normal operation
GRANT SELECT, INSERT ON competition.participant_aliases TO phf_hr_app;

-- history: append only
GRANT SELECT, INSERT ON
  competition.campaign_history,
  competition.submission_history,
  competition.permission_history,
  competition.review_assignment_history,
  competition.award_history
TO phf_hr_app;

-- No ALTER DEFAULT PRIVILEGES: every future competition table needs its own
-- explicit GRANT in its own migration.

COMMIT;
RESET ROLE;

SELECT 'phf_hr_competition_v1 applied — run phf_hr_competition_v1_VALIDATION.sql next' AS result;
