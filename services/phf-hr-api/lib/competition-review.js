'use strict';

// PHF HR — Competition V1 · review-assignment engine + SLA + productivity +
// anonymous reviewer queue.
//
// Authoritative data only: competition.review_assignments (+ _history). No
// stored counters. Author is always excluded from candidate reviewers. The DB
// also blocks self-review (guard_no_self_review) as a backstop.

const { readTx, writeTx, cErr, auditActor, isSamePerson } = require('./competition-common');
const { resolveAuthority, requireCompetitionAdmin } = require('./competition-permissions');
const { emitCompetitionNotifications } = require('./competition-notification-emit');

// pick reviewers of a campaign at tier, excluding an author, by lowest active
// workload with random tie-break. Runs inside an open transaction.
async function pickReviewer(client, { campaignId, tier, authorAccountId, authorEmployeeCode, minLevel }) {
  const level = tier === 'primary_high' ? Math.max(2, minLevel || 2) : 1;
  const cand = await client.query(
    `WITH reviewers AS (
       SELECT rg.account_id, rg.employee_code, rg.max_level_order
         FROM competition.reviewer_grants rg
        WHERE rg.campaign_id = $1 AND rg.is_active
          AND rg.max_level_order >= $2
          AND rg.account_id <> $3 AND rg.employee_code <> $4
     ),
     workload AS (
       SELECT r.account_id, r.employee_code, r.max_level_order,
              COALESCE(( SELECT count(*) FROM competition.review_assignments ra
                          WHERE ra.reviewer_account_id = r.account_id
                            AND ra.campaign_id = $1 AND ra.is_active
                            AND ra.status IN ('assigned','in_progress') ), 0) AS active_load
         FROM reviewers r
     )
     SELECT account_id, employee_code, max_level_order, active_load
       FROM workload
      ORDER BY active_load ASC, random()
      LIMIT 1`,
    [campaignId, level, authorAccountId || '__none__', authorEmployeeCode || '__none__']);
  return cand.rowCount ? cand.rows[0] : null;
}

async function levelSla(client, campaignId, levelOrder) {
  const r = await client.query(
    'SELECT sla_hours FROM competition.approval_levels WHERE campaign_id = $1 AND level_order = $2', [campaignId, levelOrder]);
  return r.rowCount ? r.rows[0].sla_hours : null;
}

// Create / refresh the primary_l1 assignment for a submission entering review.
async function assignForSubmission(client, params) {
  const { submissionId, campaignId, authorAccountId, authorEmployeeCode, resubmit } = params;

  const existing = await client.query(
    `SELECT * FROM competition.review_assignments
      WHERE submission_id = $1 AND tier = 'primary_l1' AND is_active FOR UPDATE`, [submissionId]);
  const sla = await levelSla(client, campaignId, 1);

  if (existing.rowCount > 0) {
    const a = existing.rows[0];
    const r = await client.query(
      `UPDATE competition.review_assignments
          SET status = 'assigned', returned_at = NULL,
              due_at = CASE WHEN $2::int IS NULL THEN NULL ELSE now() + ($2 || ' hours')::interval END
        WHERE id = $1 RETURNING *`,
      [a.id, sla]);
    await histRow(client, submissionId, a.id, resubmit ? 'reassign' : 'auto_assign',
      a.reviewer_account_id, a.reviewer_employee_code, null, { note: 'refreshed on resubmit' }, null);
    return publicAssignment(r.rows[0]);
  }

  const reviewer = await pickReviewer(client, { campaignId, tier: 'primary_l1', authorAccountId, authorEmployeeCode });
  if (!reviewer) {
    // no eligible reviewer yet — leave unassigned (pool). Not an error.
    await histRow(client, submissionId, null, 'return_to_pool', null, null, null, { reason: 'no_eligible_reviewer' }, null);
    return null;
  }
  const method = await tieMethod(client, campaignId, reviewer);
  const r = await client.query(
    `INSERT INTO competition.review_assignments
       (submission_id, campaign_id, reviewer_account_id, reviewer_employee_code, tier, level_scope_order,
        status, assignment_method, assigned_by, due_at)
     VALUES ($1,$2,$3,$4,'primary_l1',1,'assigned',$5,'system',
             CASE WHEN $6::int IS NULL THEN NULL ELSE now() + ($6 || ' hours')::interval END)
     RETURNING *`,
    [submissionId, campaignId, reviewer.account_id, reviewer.employee_code, method, sla]);
  await histRow(client, submissionId, r.rows[0].id, 'auto_assign', reviewer.account_id, reviewer.employee_code, null,
    { method, active_load: reviewer.active_load }, null);
  await emitCompetitionNotifications({
    client, eventCode: 'COMPETITION_REVIEW_ASSIGNED', submissionId,
    title: 'Có bài mới cần xét duyệt', message: 'Bạn có bài mới cần xét duyệt.',
    targetPath: '/thi-dua/cho-duyet', priority: 'Trung bình',
    recipients: [{ accountId: reviewer.account_id, employeeCode: reviewer.employee_code }],
    dedupeKey: 'cmp:' + submissionId + ':COMPETITION_REVIEW_ASSIGNED:' + r.rows[0].id,
  });
  return publicAssignment(r.rows[0]);
}

// crude "was there a tie?" -> method label. If >1 reviewer shares the min
// workload, mark random tie-break; else lowest-workload.
async function tieMethod(client, campaignId, chosen) {
  const r = await client.query(
    `WITH loads AS (
       SELECT rg.account_id,
              COALESCE((SELECT count(*) FROM competition.review_assignments ra
                         WHERE ra.reviewer_account_id = rg.account_id AND ra.campaign_id = $1
                           AND ra.is_active AND ra.status IN ('assigned','in_progress')),0) AS l
         FROM competition.reviewer_grants rg WHERE rg.campaign_id = $1 AND rg.is_active
     )
     SELECT count(*)::int c FROM loads WHERE l = (SELECT min(l) FROM loads)`, [campaignId]);
  return (r.rows[0].c > 1) ? 'auto_random_tiebreak' : 'auto_lowest_workload';
}

async function histRow(client, submissionId, assignmentId, action, reviewerAcc, reviewerEmp, actor, after, reason) {
  await client.query(
    `INSERT INTO competition.review_assignment_history
       (submission_id, assignment_id, action, reviewer_account_id, reviewer_employee_code,
        actor_account_id, actor_employee_code, actor_display_name, after, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
    [submissionId, assignmentId, action, reviewerAcc, reviewerEmp,
     actor ? actor.account_id : null, actor ? actor.employee_code : null, actor ? actor.display_name : null,
     JSON.stringify(after || {}), reason]);
}

function publicAssignment(a) {
  return {
    id: a.id, submissionId: a.submission_id, tier: a.tier, status: a.status,
    reviewerAccountId: a.reviewer_account_id, reviewerEmployeeCode: a.reviewer_employee_code,
    assignmentMethod: a.assignment_method, assignedAt: a.assigned_at, dueAt: a.due_at,
    completedAt: a.completed_at, outcome: a.outcome,
  };
}

// Close the acting reviewer's active assignment on a submission (any tier).
//
// OPEN-POOL / cross-reviewer intervention (2026-09-05, added for "Bài tôi đã
// duyệt"): reviewAction() never required the caller to BE the currently
// assigned reviewer (any reviewer/admin with sufficient level authority may
// act — see competition-submissions.js reviewAction, only self-review is
// blocked). Previously, when the acting reviewer's account/employee code
// didn't match the active assignment row, this function only wrote an
// audit-trail history breadcrumb and left the stale assignment dangling
// 'assigned' forever — meaning neither reviewerProductivity() nor
// myReviewedHistory() (both authoritative-data-only, sourced from
// review_assignments) would EVER reflect who actually processed the item.
// Now: close out whichever assignment WAS open (status 'reassigned', audited)
// and attribute a completed record to the ACTOR who did the work, so "Đã xử
// lý" / "Bài tôi đã duyệt" stay truthful and consistent with each other.
async function completeAssignmentForReviewer(client, { submissionId, reviewerAccountId, reviewerEmployeeCode, outcome, actor }) {
  const r = await client.query(
    `UPDATE competition.review_assignments
        SET status = 'completed', completed_at = now(), outcome = $4, is_active = false
      WHERE submission_id = $1 AND is_active
        AND ( ($2 <> '' AND reviewer_account_id = $2) OR ($3 <> '' AND reviewer_employee_code = $3) )
      RETURNING *`,
    [submissionId, reviewerAccountId || '', reviewerEmployeeCode || '', outcome]);
  if (r.rowCount > 0) {
    await histRow(client, submissionId, r.rows[0].id, 'completed', r.rows[0].reviewer_account_id, r.rows[0].reviewer_employee_code, actor, { outcome }, null);
    return r.rowCount;
  }

  const stale = await client.query(
    `SELECT * FROM competition.review_assignments WHERE submission_id = $1 AND is_active ORDER BY assigned_at DESC LIMIT 1 FOR UPDATE`,
    [submissionId]);
  if (stale.rowCount > 0 && (reviewerAccountId || reviewerEmployeeCode)) {
    const s = stale.rows[0];
    await client.query(`UPDATE competition.review_assignments SET status='reassigned', is_active=false, returned_at=now() WHERE id=$1`, [s.id]);
    await histRow(client, submissionId, s.id, 'reassign', s.reviewer_account_id, s.reviewer_employee_code, actor, { reason: 'processed_by_other_reviewer' }, null);
    const ins = await client.query(
      `INSERT INTO competition.review_assignments
         (submission_id, campaign_id, reviewer_account_id, reviewer_employee_code, tier, level_scope_order,
          status, assignment_method, assigned_by, assigned_at, completed_at, outcome, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,'completed','manual',$7,now(),now(),$8,false)
       RETURNING *`,
      [submissionId, s.campaign_id, reviewerAccountId || '', reviewerEmployeeCode || '', s.tier, s.level_scope_order,
        (actor && (actor.account_id || actor.employee_code)) || 'system', outcome]);
    await histRow(client, submissionId, ins.rows[0].id, 'completed', reviewerAccountId || null, reviewerEmployeeCode || null, actor, { outcome, note: 'processed_outside_own_assignment' }, null);
    return 1;
  }

  // acting reviewer had no assignment row and none was open to close — record it
  await histRow(client, submissionId, null, 'completed', reviewerAccountId || null, reviewerEmployeeCode || null, actor, { outcome, note: 'no_active_assignment_for_actor' }, null);
  return 0;
}

// Ensure a lighter high-tier ownership assignment once a submission is approved
// at L1 (called from the submission review path via a lazy require).
async function ensureHighAssignment(client, { submissionId, campaignId, authorAccountId, authorEmployeeCode, currentLevelOrder }) {
  const has = await client.query(
    `SELECT 1 FROM competition.review_assignments WHERE submission_id = $1 AND tier = 'primary_high' AND is_active LIMIT 1`, [submissionId]);
  if (has.rowCount) return null;
  const maxLevelR = await client.query('SELECT max(level_order) m FROM competition.approval_levels WHERE campaign_id = $1', [campaignId]);
  const highLevel = maxLevelR.rows[0].m;
  if (!highLevel || highLevel < 2) return null;
  const reviewer = await pickReviewer(client, { campaignId, tier: 'primary_high', authorAccountId, authorEmployeeCode, minLevel: highLevel });
  if (!reviewer) return null;
  const sla = await levelSla(client, campaignId, highLevel);
  const r = await client.query(
    `INSERT INTO competition.review_assignments
       (submission_id, campaign_id, reviewer_account_id, reviewer_employee_code, tier, level_scope_order,
        status, assignment_method, assigned_by, due_at)
     VALUES ($1,$2,$3,$4,'primary_high',$5,'assigned','auto_lowest_workload','system',
             CASE WHEN $6::int IS NULL THEN NULL ELSE now() + ($6 || ' hours')::interval END)
     RETURNING *`,
    [submissionId, campaignId, reviewer.account_id, reviewer.employee_code, highLevel, sla]);
  await histRow(client, submissionId, r.rows[0].id, 'auto_assign', reviewer.account_id, reviewer.employee_code, null, { tier: 'primary_high' }, null);
  await emitCompetitionNotifications({
    client, eventCode: 'COMPETITION_REVIEW_ASSIGNED', submissionId,
    title: 'Có bài mới cần xét duyệt', message: 'Bạn có bài mới cần xét duyệt.',
    targetPath: '/thi-dua/cho-duyet', priority: 'Trung bình',
    recipients: [{ accountId: reviewer.account_id, employeeCode: reviewer.employee_code }],
    dedupeKey: 'cmp:' + submissionId + ':COMPETITION_REVIEW_ASSIGNED:' + r.rows[0].id,
  });
  return publicAssignment(r.rows[0]);
}

// ---- admin manual reassign (audited) ----------------------------------
async function manualReassign(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  requireCompetitionAdmin(auth);
  const aa = auditActor(actor);
  const reason = String(params.reason || '').trim();
  if (!reason) throw cErr('COMPETITION_REASSIGN_REASON_REQUIRED', 'Chuyển người duyệt phải có lý do.', 400);
  return writeTx(config, async (client) => {
    const cur = await client.query('SELECT * FROM competition.review_assignments WHERE id = $1 FOR UPDATE', [params.assignmentId]);
    if (!cur.rowCount) throw cErr('COMPETITION_ASSIGNMENT_NOT_FOUND', 'Không tìm thấy phân công.', 404);
    const a = cur.rows[0];
    const sub = await client.query('SELECT author_account_id, author_employee_code FROM competition.submissions WHERE id = $1', [a.submission_id]);
    if (isSamePerson({ accountId: params.toAccountId, employeeCode: params.toEmployeeCode },
      sub.rows[0].author_account_id, sub.rows[0].author_employee_code)) {
      throw cErr('COMPETITION_SELF_REVIEW_BLOCKED', 'Không thể giao cho tác giả.', 409);
    }
    await client.query(`UPDATE competition.review_assignments SET status='reassigned', is_active=false, returned_at=now() WHERE id=$1`, [a.id]);
    const sla = await levelSla(client, a.campaign_id, a.level_scope_order);
    const r = await client.query(
      `INSERT INTO competition.review_assignments
         (submission_id, campaign_id, reviewer_account_id, reviewer_employee_code, tier, level_scope_order,
          status, assignment_method, assigned_by, due_at)
       VALUES ($1,$2,$3,$4,$5,$6,'assigned','manual',$7,
               CASE WHEN $8::int IS NULL THEN NULL ELSE now() + ($8 || ' hours')::interval END)
       RETURNING *`,
      [a.submission_id, a.campaign_id, String(params.toAccountId || ''), String(params.toEmployeeCode || ''),
       a.tier, a.level_scope_order, aa.account_id || aa.employee_code, sla]);
    await histRow(client, a.submission_id, r.rows[0].id, 'manual_reassign', r.rows[0].reviewer_account_id, r.rows[0].reviewer_employee_code, aa,
      { from_reviewer: a.reviewer_account_id, to_reviewer: r.rows[0].reviewer_account_id }, reason);
    // notify ONLY the new reviewer — never the old/revoked one
    await emitCompetitionNotifications({
      client, eventCode: 'COMPETITION_REVIEW_ASSIGNED', submissionId: a.submission_id,
      title: 'Có bài mới cần xét duyệt', message: 'Bạn có bài mới cần xét duyệt.',
      targetPath: '/thi-dua/cho-duyet', priority: 'Trung bình',
      recipients: [{ accountId: r.rows[0].reviewer_account_id, employeeCode: r.rows[0].reviewer_employee_code }],
      dedupeKey: 'cmp:' + a.submission_id + ':COMPETITION_REVIEW_ASSIGNED:' + r.rows[0].id,
    });
    return publicAssignment(r.rows[0]);
  });
}

// ---- SLA expiry processing (callable; no cron in this batch) ----------
async function processOverdueAssignments(config, params) {
  return writeTx(config, async (client) => {
    const campaignFilter = params && params.campaignId ? 'AND ra.campaign_id = $1' : '';
    const overdue = await client.query(
      `SELECT ra.* FROM competition.review_assignments ra
        WHERE ra.is_active AND ra.status IN ('assigned','in_progress')
          AND ra.due_at IS NOT NULL AND ra.due_at < now() ${campaignFilter}
        FOR UPDATE`,
      params && params.campaignId ? [params.campaignId] : []);
    const results = [];
    for (const a of overdue.rows) {
      await client.query(`UPDATE competition.review_assignments SET status='overdue_returned', is_active=false, returned_at=now() WHERE id=$1`, [a.id]);
      await histRow(client, a.submission_id, a.id, 'sla_expiry', a.reviewer_account_id, a.reviewer_employee_code, null,
        { was_due_at: a.due_at }, 'SLA expired');
      const sub = await client.query('SELECT author_account_id, author_employee_code, status FROM competition.submissions WHERE id = $1', [a.submission_id]);
      if (['submitted', 'needs_revision'].includes(sub.rows[0].status) && a.tier === 'primary_l1') {
        const re = await assignForSubmission(client, {
          submissionId: a.submission_id, campaignId: a.campaign_id,
          authorAccountId: sub.rows[0].author_account_id, authorEmployeeCode: sub.rows[0].author_employee_code, resubmit: false,
        });
        results.push({ submissionId: a.submission_id, reassignedTo: re ? re.reviewerAccountId : null });
      } else {
        results.push({ submissionId: a.submission_id, reassignedTo: null });
      }
    }
    return { processed: overdue.rowCount, results };
  });
}

// When a reviewer grant is revoked, return their unprocessed active assignments.
async function returnAssignmentsForRevokedReviewer(config, params) {
  return writeTx(config, async (client) => {
    const rows = await client.query(
      `SELECT * FROM competition.review_assignments
        WHERE campaign_id = $1 AND reviewer_account_id = $2 AND is_active AND status IN ('assigned','in_progress') FOR UPDATE`,
      [params.campaignId, params.accountId]);
    const out = [];
    for (const a of rows.rows) {
      await client.query(`UPDATE competition.review_assignments SET status='returned_to_pool', is_active=false, returned_at=now() WHERE id=$1`, [a.id]);
      await histRow(client, a.submission_id, a.id, 'return_to_pool', a.reviewer_account_id, a.reviewer_employee_code, null, { reason: 'reviewer_revoked' }, null);
      const sub = await client.query('SELECT author_account_id, author_employee_code, status FROM competition.submissions WHERE id = $1', [a.submission_id]);
      if (['submitted', 'needs_revision'].includes(sub.rows[0].status) && a.tier === 'primary_l1') {
        const re = await assignForSubmission(client, {
          submissionId: a.submission_id, campaignId: a.campaign_id,
          authorAccountId: sub.rows[0].author_account_id, authorEmployeeCode: sub.rows[0].author_employee_code, resubmit: false,
        });
        out.push({ submissionId: a.submission_id, reassignedTo: re ? re.reviewerAccountId : null });
      }
    }
    return { returned: rows.rowCount, out };
  });
}

// ---- reviewer productivity (self, or admin sees all) ------------------
async function reviewerProductivity(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  const wantAll = !!params.all;
  if (wantAll) requireCompetitionAdmin(auth);
  return readTx(config, async (client) => {
    const scopeSelf = !wantAll;
    const r = await client.query(
      `WITH rg AS (
         SELECT account_id, employee_code, display_name, max_level_order
           FROM competition.reviewer_grants
          WHERE campaign_id = $1 AND ( $2::boolean = false OR is_active )
            AND ( $3::boolean = false OR account_id = $4 OR employee_code = $5 )
       )
       SELECT rg.account_id, rg.employee_code, rg.display_name, rg.max_level_order,
              COALESCE(count(ra.*),0)                                                   AS assigned_count,
              COALESCE(count(ra.*) FILTER (WHERE ra.status = 'completed'),0)            AS processed_count,
              COALESCE(count(ra.*) FILTER (WHERE ra.is_active AND ra.status IN ('assigned','in_progress')),0) AS pending_count,
              COALESCE(count(ra.*) FILTER (WHERE ra.is_active AND ra.status IN ('assigned','in_progress')
                        AND ra.due_at IS NOT NULL AND ra.due_at < now()),0)             AS overdue_count
         FROM rg
         LEFT JOIN competition.review_assignments ra
           ON ra.reviewer_account_id = rg.account_id AND ra.campaign_id = $1
        GROUP BY rg.account_id, rg.employee_code, rg.display_name, rg.max_level_order
        ORDER BY rg.max_level_order DESC, rg.account_id`,
      [params.campaignId, wantAll, scopeSelf, actor.accountId || '', actor.employeeCode || '']);
    const rows = r.rows.map((x) => ({
      reviewerAccountId: x.account_id, reviewerEmployeeCode: x.employee_code,
      displayName: wantAll ? x.display_name : undefined, maxLevelOrder: x.max_level_order,
      assigned: Number(x.assigned_count), processed: Number(x.processed_count),
      pending: Number(x.pending_count), overdue: Number(x.overdue_count),
    }));
    return wantAll ? { reviewers: rows } : (rows[0] || { assigned: 0, processed: 0, pending: 0, overdue: 0 });
  });
}

// ---- anonymous reviewer queue (NO identity fields, by construction) ----
async function anonymousQueue(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  if (!auth.canReview) throw cErr('COMPETITION_NOT_A_REVIEWER', 'Bạn không có quyền duyệt.', 403);
  return readTx(config, async (client) => {
    // submissions this actor may act on: their own active assignments +
    // (admin) any pending submission. Author is filtered out server-side.
    const r = await client.query(
      `SELECT s.id AS submission_ref, s.campaign_id, c.title AS campaign_title,
              s.payload, s.status AS review_status, s.current_level_order, s.submitted_at,
              ra.id AS assignment_id, ra.tier, ra.due_at
         FROM competition.submissions s
         JOIN competition.campaigns c ON c.id = s.campaign_id
         LEFT JOIN competition.review_assignments ra
                ON ra.submission_id = s.id AND ra.is_active
               AND ( ($2 <> '' AND ra.reviewer_account_id = $2) OR ($3 <> '' AND ra.reviewer_employee_code = $3) )
        WHERE s.campaign_id = $1
          AND s.status IN ('submitted','needs_revision')
          AND NOT ( ($2 <> '' AND s.author_account_id = $2) OR ($3 <> '' AND s.author_employee_code = $3) )
          AND ( $4::boolean = true OR ra.id IS NOT NULL )
        ORDER BY s.submitted_at ASC NULLS LAST`,
      [params.campaignId, actor.accountId || '', actor.employeeCode || '', auth.isCompetitionAdmin]);
    const levels = await client.query(
      'SELECT level_order, name, score FROM competition.approval_levels WHERE campaign_id = $1 ORDER BY level_order', [params.campaignId]);
    const eligible = levels.rows
      .filter((l) => auth.isCompetitionAdmin || l.level_order <= auth.reviewerMaxLevel)
      .map((l) => ({ levelOrder: l.level_order, name: l.name, score: Number(l.score) }));
    return {
      eligibleLevels: eligible,
      items: r.rows.map((x) => ({
        submissionRef: x.submission_ref,          // opaque to the reviewer UI
        campaignId: x.campaign_id, campaignTitle: x.campaign_title,
        payload: x.payload,                       // content only
        reviewStatus: x.review_status,
        currentLevelOrder: x.current_level_order,
        submittedAt: x.submitted_at,
        assignmentId: x.assignment_id, tier: x.tier, dueAt: x.due_at,
        // DELIBERATELY ABSENT: author name / code / department / branch / account
      })),
    };
  });
}

// ---- "Bài tôi đã duyệt" (My Reviewed) ----------------------------------
// Base query is IDENTICAL WHERE clause to reviewerProductivity()'s
// processed_count (review_assignments WHERE reviewer=self AND status=
// 'completed') so the two numbers are provably consistent — never a second
// definition of "processed" derived from submission_history. LEFT JOINs are
// read-only: they never rewrite review_assignments / submission_history.
// Author identity columns are NEVER selected (same discipline as
// anonymousQueue).
const OUTCOME_FILTER = {
  all: null,
  approved: ['approved', 'upgraded'],
  needs_revision: ['needs_revision'],
  rejected: ['rejected'],
};
async function myReviewedHistory(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  if (!auth.canReview) throw cErr('COMPETITION_NOT_A_REVIEWER', 'Bạn không có quyền duyệt.', 403);
  const limit = Math.min(50, Math.max(1, Number(params.limit) || 50));
  const statusFilter = String(params.statusFilter || 'all');
  const outcomes = Object.prototype.hasOwnProperty.call(OUTCOME_FILTER, statusFilter) ? OUTCOME_FILTER[statusFilter] : null;

  return readTx(config, async (client) => {
    const r = await client.query(
      `SELECT ra.id AS assignment_id, ra.submission_id, ra.tier, ra.outcome, ra.completed_at, ra.level_scope_order,
              s.status AS current_status, s.current_level_order, s.current_score, s.payload,
              hist.after AS my_action_after, hist.at AS my_action_at, hist.action AS my_action, hist.reason AS my_note
         FROM competition.review_assignments ra
         JOIN competition.submissions s ON s.id = ra.submission_id
         LEFT JOIN LATERAL (
           SELECT sh.after, sh.at, sh.action, sh.reason
             FROM competition.submission_history sh
            WHERE sh.submission_id = ra.submission_id
              AND ( (sh.actor_account_id <> '' AND sh.actor_account_id = ra.reviewer_account_id)
                 OR (sh.actor_employee_code <> '' AND sh.actor_employee_code = ra.reviewer_employee_code) )
              AND sh.at >= ra.assigned_at
              AND sh.at <= COALESCE(ra.completed_at, now())
              AND sh.action IN ('approve','upgrade','revision_requested','reject')
            ORDER BY sh.at DESC LIMIT 1
         ) hist ON true
        WHERE ra.campaign_id = $1 AND ra.status = 'completed'
          AND ( ($2 <> '' AND ra.reviewer_account_id = $2) OR ($3 <> '' AND ra.reviewer_employee_code = $3) )
          AND ( $4::text[] IS NULL OR ra.outcome = ANY($4::text[]) )
        ORDER BY ra.completed_at DESC NULLS LAST
        LIMIT $5`,
      [params.campaignId, actor.accountId || '', actor.employeeCode || '', outcomes, limit]);

    return {
      items: r.rows.map((x) => ({
        submissionRef: x.submission_id,
        assignmentId: x.assignment_id,
        tier: x.tier,
        outcome: x.outcome,
        processedAt: x.completed_at,
        payload: x.payload,                    // content only — no author fields
        myAction: x.my_action,                 // what THIS actor actually did
        myActionAt: x.my_action_at,
        myNote: x.my_note,
        myResult: x.my_action_after,           // { from_level/to_level/... } as recorded at the time
        currentStatus: x.current_status,       // "Kết quả hiện tại"
        currentLevelOrder: x.current_level_order,
        currentScore: x.current_score == null ? null : Number(x.current_score),
        // DELIBERATELY ABSENT: author name / code / department / branch / account
      })),
    };
  });
}

module.exports = {
  pickReviewer, assignForSubmission, completeAssignmentForReviewer, ensureHighAssignment,
  manualReassign, processOverdueAssignments, returnAssignmentsForRevokedReviewer,
  reviewerProductivity, anonymousQueue, myReviewedHistory, publicAssignment,
};
