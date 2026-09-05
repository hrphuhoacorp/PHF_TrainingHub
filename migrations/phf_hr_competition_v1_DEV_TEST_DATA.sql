-- =============================================================================
-- PHF HR — CHƯƠNG TRÌNH THI ĐUA (Competition) V1 · DEV/TEST FIXTURE + BEHAVIOUR TESTS
--
-- DEV/TEST ONLY (database phf_hr_e2e). Run AFTER phf_hr_competition_v1.sql +
-- VALIDATION. Idempotent-ish: it first removes any prior fixture campaign by
-- code, then re-seeds. Synthetic identities only — account_id 'SYN-*',
-- employee_code 'SYN000..'. No real employee data, no Supabase.
--
-- Part 1  seed a full campaign world and COMMIT it.
-- Part 2  negative-constraint tests inside SAVEPOINTs that always roll back.
-- Part 3  analytic-readiness queries (workload / SLA / score replacement /
--         leaderboard+ties / participation progress / award tie-break).
-- =============================================================================
\set ON_ERROR_STOP on
SET ROLE phf_hr_owner;
SET search_path = competition, public;

-- ---------------------------------------------------------------------------
-- PART 1 — SEED
-- ---------------------------------------------------------------------------
BEGIN;

DELETE FROM competition.campaigns WHERE code = 'SYN-CAU-HOI-KH-2026-09';

-- campaign first (plain INSERT) so the approval-level guard trigger can see
-- the committed-within-txn 'draft' status. A data-modifying CTE would hide it.
INSERT INTO competition.campaigns
  (code, title, description, instructions, status, form_schema,
   min_required_contributions, submission_starts_at, submission_deadline,
   review_deadline, created_by_account_id, created_by_employee_code)
VALUES
  ('SYN-CAU-HOI-KH-2026-09', '[SYN] Câu hỏi & cách trả lời khách hàng',
   'Fixture campaign', 'Gửi tình huống thật.', 'draft',
   '[{"key":"customer_question","label":"Câu hỏi khách hàng","type":"textarea","required":true,"order":1},
     {"key":"answer","label":"Câu trả lời","type":"textarea","required":true,"order":2},
     {"key":"actual_result","label":"Kết quả thực tế","type":"textarea","required":false,"order":3},
     {"key":"context","label":"Ngữ cảnh","type":"select","required":false,"order":4}]'::jsonb,
   5, now() - interval '10 days', now() + interval '20 days',
   now() + interval '30 days', 'SYN-ADMIN', 'SYN000');

INSERT INTO competition.approval_levels (campaign_id, level_order, name, score, sla_hours)
SELECT id, 1, 'Hợp lệ', 2, 48
  FROM competition.campaigns WHERE code = 'SYN-CAU-HOI-KH-2026-09'
UNION ALL
SELECT id, 2, 'Đưa vào khung chuẩn', 5, 72
  FROM competition.campaigns WHERE code = 'SYN-CAU-HOI-KH-2026-09';

-- move campaign into 'accepting' (freezes levels)
UPDATE competition.campaigns
   SET status = 'accepting', levels_frozen = true
 WHERE code = 'SYN-CAU-HOI-KH-2026-09';

-- --- grants ---------------------------------------------------------------
WITH cid AS (SELECT id FROM competition.campaigns WHERE code='SYN-CAU-HOI-KH-2026-09')
INSERT INTO competition.reviewer_grants
  (campaign_id, account_id, employee_code, display_name, max_level_order, granted_by_account_id)
SELECT id, 'SYN-REV-L1', 'SYN010', '[SYN] Reviewer L1', 1, 'SYN-ADMIN' FROM cid
UNION ALL SELECT id, 'SYN-REV-L2', 'SYN011', '[SYN] Reviewer L2', 2, 'SYN-ADMIN' FROM cid;

INSERT INTO competition.admin_grants
  (account_id, employee_code, display_name, reason, granted_by_account_id)
VALUES ('SYN-COMPADMIN', 'SYN020', '[SYN] Competition Admin (non-system)', 'fixture', 'SYN-ADMIN');

INSERT INTO competition.capability_grants
  (capability, account_id, employee_code, display_name, granted_by_account_id)
VALUES ('view_participation_progress', 'SYN-PROG', 'SYN021', '[SYN] Progress viewer', 'SYN-ADMIN');

-- --- participants + aliases (P1..P5) ------------------------------------
WITH cid AS (SELECT id FROM competition.campaigns WHERE code='SYN-CAU-HOI-KH-2026-09')
INSERT INTO competition.participant_aliases (campaign_id, account_id, employee_code, alias)
SELECT id, 'SYN-P'||g, 'SYN10'||g, a
FROM cid, (VALUES
  (1,'Táo Tư Vấn'),(2,'Cam Chốt Đơn'),(3,'Nho Tận Tâm'),
  (4,'Kiwi Nhanh Nhẹn'),(5,'Dâu Thân Thiện')) v(g,a);

-- --- submissions -------------------------------------------------------
-- P1: approved at L1 (score 2)
-- P2: approved at L1 then upgraded to L2 (score 5, first_approved_at earlier)
-- P3: approved at L1 (score 2)  -> ties P1 on total (both 2)
-- P4: submitted (pending), P5: needs_revision, P1: also a draft, P3: rejected
WITH cid AS (SELECT id FROM competition.campaigns WHERE code='SYN-CAU-HOI-KH-2026-09'),
lvl AS (SELECT campaign_id, level_order, score FROM competition.approval_levels)
INSERT INTO competition.submissions
  (campaign_id, author_account_id, author_employee_code, author_display_name_snapshot,
   author_department_snapshot, author_branch_snapshot, status, payload,
   current_level_order, current_score, submitted_at, approved_at, first_approved_at)
SELECT cid.id, s.acc, s.emp, s.nm, s.dep, s.br, s.st, s.pl::jsonb,
       s.lvl, s.scr, s.sub, s.app, s.fapp
FROM cid, (VALUES
  ('SYN-P1','SYN101','[SYN] P1','Bán hàng','CN1','approved',
     '{"customer_question":"q1","answer":"a1"}', 1, 2::numeric,
     now()-interval '3 days', now()-interval '40 hours', now()-interval '40 hours'),
  ('SYN-P2','SYN102','[SYN] P2','Bán hàng','CN1','approved',
     '{"customer_question":"q2","answer":"a2"}', 2, 5::numeric,
     now()-interval '3 days', now()-interval '20 hours', now()-interval '50 hours'),
  ('SYN-P3','SYN103','[SYN] P3','Bán hàng','CN2','approved',
     '{"customer_question":"q3","answer":"a3"}', 1, 2::numeric,
     now()-interval '3 days', now()-interval '30 hours', now()-interval '30 hours'),
  ('SYN-P4','SYN104','[SYN] P4','Bán hàng','CN2','submitted',
     '{"customer_question":"q4","answer":"a4"}', NULL, NULL,
     now()-interval '2 days', NULL, NULL),
  ('SYN-P5','SYN105','[SYN] P5','Bán hàng','CN3','needs_revision',
     '{"customer_question":"q5","answer":"a5"}', NULL, NULL,
     now()-interval '2 days', NULL, NULL),
  ('SYN-P1','SYN101','[SYN] P1','Bán hàng','CN1','draft',
     '{"customer_question":"q1b"}', NULL, NULL, NULL, NULL, NULL),
  ('SYN-P3','SYN103','[SYN] P3','Bán hàng','CN2','rejected',
     '{"customer_question":"q3b","answer":"a3b"}', NULL, NULL,
     now()-interval '3 days', NULL, NULL)
) s(acc,emp,nm,dep,br,st,pl,lvl,scr,sub,app,fapp);

-- move campaign to reviewing
UPDATE competition.campaigns SET status='reviewing' WHERE code='SYN-CAU-HOI-KH-2026-09';

-- --- review assignments ----------------------------------------------
-- completed L1 assignment for P1 (reviewer L1); active+overdue L1 for P4;
-- active L2 (high) ownership for P2 that upgraded.
WITH cid AS (SELECT id FROM competition.campaigns WHERE code='SYN-CAU-HOI-KH-2026-09'),
sub AS (SELECT s.id, s.author_account_id, s.status FROM competition.submissions s
        JOIN cid ON cid.id = s.campaign_id)
INSERT INTO competition.review_assignments
  (submission_id, campaign_id, reviewer_account_id, reviewer_employee_code, tier,
   level_scope_order, status, assignment_method, assigned_by, assigned_at, due_at,
   completed_at, outcome, is_active)
SELECT sub.id, (SELECT id FROM cid), r.rev, r.emp, r.tier, r.lvl, r.st, r.method,
       r.by, r.at, r.due, r.done, r.outcome, r.active
FROM sub JOIN (VALUES
  ('SYN-P1','SYN-REV-L1','SYN010','primary_l1',1,'completed','auto_lowest_workload','system',
     now()-interval '6 days', now()-interval '4 days', now()-interval '5 days','approved',false),
  ('SYN-P4','SYN-REV-L1','SYN010','primary_l1',1,'assigned','auto_lowest_workload','system',
     now()-interval '2 days', now()-interval '1 hour', NULL, NULL, true),
  ('SYN-P2','SYN-REV-L2','SYN011','primary_high',2,'completed','manual','SYN-COMPADMIN',
     now()-interval '5 days', now()-interval '2 days', now()-interval '3 days','upgraded',false)
) r(pacc,rev,emp,tier,lvl,st,method,by,at,due,done,outcome,active)
  ON r.pacc = sub.author_account_id AND sub.status IN ('approved','submitted');

-- --- reactions ------------------------------------------------------
WITH sub AS (
  SELECT s.id, s.author_account_id FROM competition.submissions s
  JOIN competition.campaigns c ON c.id=s.campaign_id
  WHERE c.code='SYN-CAU-HOI-KH-2026-09' AND s.status='approved')
INSERT INTO competition.reactions (submission_id, account_id, employee_code, is_active)
SELECT sub.id, v.acc, v.emp, v.active
FROM sub JOIN (VALUES
  ('SYN-P1','SYN-P4','SYN104', true),
  ('SYN-P1','SYN-P5','SYN105', true),
  ('SYN-P2','SYN-P4','SYN104', true),
  -- P3 reacted to P1 then removed (inactive row) then re-added (active row)
  ('SYN-P1','SYN-P3','SYN103', false),
  ('SYN-P1','SYN-P3','SYN103', true)
) v(pauthor,acc,emp,active) ON sub.author_account_id = v.pauthor;

-- --- audit sample rows --------------------------------------------
WITH cid AS (SELECT id FROM competition.campaigns WHERE code='SYN-CAU-HOI-KH-2026-09')
INSERT INTO competition.campaign_history (campaign_id, action, actor_account_id, after, reason)
SELECT id, 'create', 'SYN-ADMIN', '{"status":"draft"}'::jsonb, NULL FROM cid
UNION ALL SELECT id, 'status_change', 'SYN-ADMIN', '{"status":"accepting"}'::jsonb, NULL FROM cid
UNION ALL SELECT id, 'level_freeze', 'SYN-ADMIN', '{"levels_frozen":true}'::jsonb, NULL FROM cid;

COMMIT;

-- ---------------------------------------------------------------------------
-- PART 2 — NEGATIVE CONSTRAINT TESTS (each in a SAVEPOINT that rolls back)
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP off
BEGIN;
\echo '--- NEG 1: duplicate approval level order -> expect UNIQUE violation'
SAVEPOINT n1;
INSERT INTO competition.approval_levels (campaign_id, level_order, name, score)
SELECT id, 1, 'dup', 9 FROM competition.campaigns WHERE code='SYN-CAU-HOI-KH-2026-09';
ROLLBACK TO n1;

\echo '--- NEG 2: duplicate reviewer grant (same campaign+account) -> expect UNIQUE violation'
SAVEPOINT n2;
INSERT INTO competition.reviewer_grants (campaign_id, account_id, employee_code, max_level_order)
SELECT id, 'SYN-REV-L1', 'SYN010', 1 FROM competition.campaigns WHERE code='SYN-CAU-HOI-KH-2026-09';
ROLLBACK TO n2;

\echo '--- NEG 3: duplicate alias within campaign -> expect UNIQUE violation'
SAVEPOINT n3;
INSERT INTO competition.participant_aliases (campaign_id, account_id, employee_code, alias)
SELECT id, 'SYN-PX', 'SYN199', 'Táo Tư Vấn' FROM competition.campaigns WHERE code='SYN-CAU-HOI-KH-2026-09';
ROLLBACK TO n3;

\echo '--- NEG 4: second ACTIVE reaction, same user+submission -> expect partial-unique violation'
SAVEPOINT n4;
INSERT INTO competition.reactions (submission_id, account_id, employee_code, is_active)
SELECT s.id, 'SYN-P4', 'SYN104', true
FROM competition.submissions s JOIN competition.campaigns c ON c.id=s.campaign_id
WHERE c.code='SYN-CAU-HOI-KH-2026-09' AND s.author_account_id='SYN-P1' AND s.status='approved';
ROLLBACK TO n4;

\echo '--- NEG 5: invalid submission status -> expect CHECK violation'
SAVEPOINT n5;
UPDATE competition.submissions SET status='bogus'
WHERE author_account_id='SYN-P4';
ROLLBACK TO n5;

\echo '--- NEG 6: self-review assignment -> expect SELF_REVIEW_BLOCKED'
SAVEPOINT n6;
INSERT INTO competition.review_assignments
  (submission_id, campaign_id, reviewer_account_id, reviewer_employee_code, tier,
   level_scope_order, assignment_method)
SELECT s.id, s.campaign_id, s.author_account_id, s.author_employee_code, 'primary_l1', 1, 'manual'
FROM competition.submissions s JOIN competition.campaigns c ON c.id=s.campaign_id
WHERE c.code='SYN-CAU-HOI-KH-2026-09' AND s.author_account_id='SYN-P4';
ROLLBACK TO n6;

\echo '--- NEG 7: edit approval level after freeze -> expect LEVELS_FROZEN'
SAVEPOINT n7;
UPDATE competition.approval_levels SET score = 99
WHERE campaign_id = (SELECT id FROM competition.campaigns WHERE code='SYN-CAU-HOI-KH-2026-09')
  AND level_order = 1;
ROLLBACK TO n7;

\echo '--- NEG 7b: same edit WITH audited override flag -> expect SUCCESS'
SAVEPOINT n7b;
SET LOCAL competition.allow_level_override = 'on';
UPDATE competition.approval_levels SET score = 3
WHERE campaign_id = (SELECT id FROM competition.campaigns WHERE code='SYN-CAU-HOI-KH-2026-09')
  AND level_order = 1;
\echo '   (rows above = 1 means override path works)'
RESET competition.allow_level_override;
ROLLBACK TO n7b;

\echo '--- NEG 8: mutate payload of an APPROVED submission -> expect SUBMISSION_LOCKED'
SAVEPOINT n8;
UPDATE competition.submissions SET payload = '{"customer_question":"tampered"}'::jsonb
WHERE author_account_id='SYN-P1' AND status='approved';
ROLLBACK TO n8;

\echo '--- NEG 9: publish a non-finalized campaign -> expect PUBLISH_GATE'
SAVEPOINT n9;
UPDATE competition.campaigns SET publication_state='published'
WHERE code='SYN-CAU-HOI-KH-2026-09';
ROLLBACK TO n9;

\echo '--- NEG 10: UPDATE an append-only history row -> expect APPEND_ONLY'
SAVEPOINT n10;
UPDATE competition.campaign_history SET reason='x' WHERE action='create';
ROLLBACK TO n10;

ROLLBACK;
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- PART 3 — ANALYTIC READINESS (all read-only)
-- ---------------------------------------------------------------------------
\echo '=== reviewer workload (active assignments per reviewer) ==='
SELECT reviewer_account_id, count(*) AS active_assignments
FROM competition.review_assignments
WHERE is_active AND campaign_id = (SELECT id FROM competition.campaigns WHERE code='SYN-CAU-HOI-KH-2026-09')
GROUP BY reviewer_account_id ORDER BY 1;

\echo '=== SLA overdue queue ==='
SELECT ra.reviewer_account_id, s.author_account_id AS submission_author, ra.due_at,
       now() - ra.due_at AS overdue_by
FROM competition.review_assignments ra
JOIN competition.submissions s ON s.id = ra.submission_id
WHERE ra.is_active AND ra.status IN ('assigned','in_progress') AND ra.due_at < now();

\echo '=== reviewer productivity (from authoritative assignment data, no stored counters) ==='
SELECT r.account_id AS reviewer,
       count(*) FILTER (WHERE ra.id IS NOT NULL)                          AS assigned_count,
       count(*) FILTER (WHERE ra.status='completed')                      AS processed_count,
       count(*) FILTER (WHERE ra.is_active AND ra.status<>'completed')    AS pending_count,
       count(*) FILTER (WHERE ra.is_active AND ra.status IN ('assigned','in_progress')
                              AND ra.due_at < now())                      AS overdue_count
FROM competition.reviewer_grants r
LEFT JOIN competition.review_assignments ra ON ra.reviewer_account_id = r.account_id
     AND ra.campaign_id = r.campaign_id
WHERE r.campaign_id = (SELECT id FROM competition.campaigns WHERE code='SYN-CAU-HOI-KH-2026-09')
GROUP BY r.account_id ORDER BY 1;

\echo '=== current-score replacement (upgrade 2->5 contributes 5, not 7) + leaderboard with ties ==='
WITH totals AS (
  SELECT s.author_account_id,
         count(*) FILTER (WHERE s.status IN ('approved','finalized'))        AS approved_count,
         coalesce(sum(s.current_score) FILTER (WHERE s.status IN ('approved','finalized')),0) AS total_score
  FROM competition.submissions s
  WHERE s.campaign_id = (SELECT id FROM competition.campaigns WHERE code='SYN-CAU-HOI-KH-2026-09')
  GROUP BY s.author_account_id
)
SELECT rank() OVER (ORDER BY total_score DESC) AS rank,
       author_account_id, approved_count, total_score
FROM totals WHERE total_score > 0 ORDER BY rank, author_account_id;

\echo '=== participant progress (valid=approved this period vs required) ==='
SELECT pa.account_id,
       count(s.*) FILTER (WHERE s.status IN ('approved','finalized')
                                AND to_char(s.submitted_at,'YYYY-MM') = to_char(now(),'YYYY-MM')) AS valid_count,
       c.min_required_contributions AS required_count,
       greatest(0, c.min_required_contributions
         - count(s.*) FILTER (WHERE s.status IN ('approved','finalized')
             AND to_char(s.submitted_at,'YYYY-MM') = to_char(now(),'YYYY-MM'))) AS missing_count
FROM competition.campaigns c
JOIN competition.participant_aliases pa ON pa.campaign_id = c.id
LEFT JOIN competition.submissions s ON s.campaign_id = c.id AND s.author_account_id = pa.account_id
WHERE c.code='SYN-CAU-HOI-KH-2026-09'
GROUP BY pa.account_id, c.min_required_contributions ORDER BY 1;

\echo '=== auto-award tie-break ordering (higher-level count, then earliest first_approved_at) ==='
WITH scored AS (
  SELECT s.author_account_id,
         coalesce(sum(s.current_score) FILTER (WHERE s.status IN ('approved','finalized')),0) AS total_score,
         count(*) FILTER (WHERE s.status IN ('approved','finalized') AND s.current_level_order = 2) AS high_level_count,
         min(s.first_approved_at) FILTER (WHERE s.status IN ('approved','finalized')) AS earliest_qualifying
  FROM competition.submissions s
  WHERE s.campaign_id = (SELECT id FROM competition.campaigns WHERE code='SYN-CAU-HOI-KH-2026-09')
  GROUP BY s.author_account_id
)
SELECT author_account_id, total_score, high_level_count, earliest_qualifying
FROM scored WHERE total_score > 0
ORDER BY total_score DESC, high_level_count DESC, earliest_qualifying ASC;

\echo '=== anonymous feed projection (approved only, alias only, NO identity columns) ==='
SELECT pa.alias, s.current_level_order AS approval_level, s.current_score,
       (SELECT count(*) FROM competition.reactions r WHERE r.submission_id = s.id AND r.is_active) AS reaction_total
FROM competition.submissions s
JOIN competition.participant_aliases pa
  ON pa.campaign_id = s.campaign_id AND pa.account_id = s.author_account_id
WHERE s.campaign_id = (SELECT id FROM competition.campaigns WHERE code='SYN-CAU-HOI-KH-2026-09')
  AND s.status IN ('approved','finalized')
ORDER BY s.current_score DESC, pa.alias;

RESET ROLE;
SELECT 'phf_hr_competition_v1_DEV_TEST_DATA complete' AS result;
