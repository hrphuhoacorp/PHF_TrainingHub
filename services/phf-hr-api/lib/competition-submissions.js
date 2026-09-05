'use strict';

// PHF HR — Competition V1 · submission lifecycle.
//   draft -> submitted -> needs_revision -> submitted -> approved -> finalized
//                                        \-> rejected
// Participant may edit only draft / needs_revision. submitted/approved/
// finalized are locked (DB trigger guard_submission_immutability is the
// backstop; this layer refuses earlier with a friendly code).
// On first submit: alias is ensured and an L1 review assignment is created
// atomically (see competition-review.assignForSubmission).

const { readTx, writeTx, cErr, auditActor, isSamePerson, cleanText } = require('./competition-common');
const { resolveAuthority, requireCompetitionAdmin, assertReviewerCanActOnLevel } = require('./competition-permissions');
const { ensureAlias } = require('./competition-alias');
const review = require('./competition-review');

const OWNER_EDITABLE = ['draft', 'needs_revision'];

function ownerView(r) {
  // V1.3 — effectiveScore is the CURRENT counted result: NULL effective_score
  // means "never adjusted, use current_score" (every pre-V1.3 submission).
  // current_score/current_level_order are NEVER rewritten by an adjustment —
  // they stay the audit record of the original review decision.
  const effectiveScore = r.effective_score != null ? Number(r.effective_score)
    : (r.current_score == null ? null : Number(r.current_score));
  return {
    id: r.id, campaignId: r.campaign_id, status: r.status, payload: r.payload,
    currentLevelOrder: r.current_level_order, currentScore: r.current_score == null ? null : Number(r.current_score),
    effectiveScore, adjusted: r.effective_score != null,
    lastReviewNote: r.last_review_note, submittedAt: r.submitted_at, approvedAt: r.approved_at,
    firstApprovedAt: r.first_approved_at, rejectedAt: r.rejected_at, finalizedAt: r.finalized_at,
    rowVersion: r.row_version, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

async function listMySubmissions(config, actor, params) {
  return readTx(config, async (client) => {
    const r = await client.query(
      `SELECT * FROM competition.submissions
        WHERE ( ($1 <> '' AND author_account_id = $1) OR ($2 <> '' AND author_employee_code = $2) )
          ${params && params.campaignId ? 'AND campaign_id = $3' : ''}
        ORDER BY updated_at DESC`,
      params && params.campaignId
        ? [actor.accountId || '', actor.employeeCode || '', params.campaignId]
        : [actor.accountId || '', actor.employeeCode || '']);
    return r.rows.map(ownerView);
  });
}

async function getMySubmission(config, actor, submissionId) {
  return readTx(config, async (client) => {
    const r = await client.query('SELECT * FROM competition.submissions WHERE id = $1', [submissionId]);
    if (!r.rowCount) throw cErr('COMPETITION_SUBMISSION_NOT_FOUND', 'Không tìm thấy bài.', 404);
    if (!isSamePerson(actor, r.rows[0].author_account_id, r.rows[0].author_employee_code)) {
      throw cErr('COMPETITION_SUBMISSION_FORBIDDEN', 'Bạn không có quyền xem bài này.', 403);
    }
    return ownerView(r.rows[0]);
  });
}

async function createDraft(config, actor, params) {
  const aa = auditActor(actor);
  return writeTx(config, async (client) => {
    const c = await client.query('SELECT status FROM competition.campaigns WHERE id = $1', [params.campaignId]);
    if (!c.rowCount) throw cErr('COMPETITION_CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình.', 404);
    if (!['accepting', 'reviewing'].includes(c.rows[0].status)) {
      throw cErr('COMPETITION_CAMPAIGN_NOT_ACCEPTING', 'Chương trình hiện không nhận bài.', 409);
    }
    const r = await client.query(
      `INSERT INTO competition.submissions
         (campaign_id, author_account_id, author_employee_code, author_display_name_snapshot,
          author_department_snapshot, author_branch_snapshot, status, payload)
       VALUES ($1,$2,$3,$4,$5,$6,'draft', COALESCE($7,'{}')::jsonb)
       RETURNING *`,
      [params.campaignId, aa.account_id || ('ACC_' + aa.employee_code), aa.employee_code || ('EMP_' + aa.account_id),
       aa.display_name, actor.department, actor.branch,
       params.payload ? JSON.stringify(params.payload) : null]);
    await client.query(
      `INSERT INTO competition.submission_history (submission_id, action, actor_account_id, actor_employee_code, actor_display_name, after)
       VALUES ($1,'create',$2,$3,$4, jsonb_build_object('status','draft'))`,
      [r.rows[0].id, aa.account_id, aa.employee_code, aa.display_name]);
    return ownerView(r.rows[0]);
  });
}

async function editDraft(config, actor, params) {
  const aa = auditActor(actor);
  return writeTx(config, async (client) => {
    const cur = await client.query('SELECT * FROM competition.submissions WHERE id = $1 FOR UPDATE', [params.submissionId]);
    if (!cur.rowCount) throw cErr('COMPETITION_SUBMISSION_NOT_FOUND', 'Không tìm thấy bài.', 404);
    const row = cur.rows[0];
    if (!isSamePerson(actor, row.author_account_id, row.author_employee_code)) throw cErr('COMPETITION_SUBMISSION_FORBIDDEN', 'Không phải bài của bạn.', 403);
    if (!OWNER_EDITABLE.includes(row.status)) throw cErr('COMPETITION_SUBMISSION_LOCKED', 'Bài đang khoá, không sửa được.', 409);
    if (params.expectedRowVersion != null && Number(params.expectedRowVersion) !== row.row_version) {
      throw cErr('COMPETITION_SUBMISSION_VERSION_CONFLICT', 'Bài đã thay đổi, tải lại.', 409);
    }
    const r = await client.query(
      `UPDATE competition.submissions SET payload = $2::jsonb, row_version = row_version + 1 WHERE id = $1 RETURNING *`,
      [params.submissionId, JSON.stringify(params.payload || {})]);
    await client.query(
      `INSERT INTO competition.submission_history (submission_id, action, actor_account_id, actor_employee_code, actor_display_name, before, after)
       VALUES ($1,'edit',$2,$3,$4,$5::jsonb,$6::jsonb)`,
      [params.submissionId, aa.account_id, aa.employee_code, aa.display_name, JSON.stringify(row.payload), JSON.stringify(r.rows[0].payload)]);
    return ownerView(r.rows[0]);
  });
}

async function submit(config, actor, params) {
  const aa = auditActor(actor);
  return writeTx(config, async (client) => {
    const cur = await client.query('SELECT * FROM competition.submissions WHERE id = $1 FOR UPDATE', [params.submissionId]);
    if (!cur.rowCount) throw cErr('COMPETITION_SUBMISSION_NOT_FOUND', 'Không tìm thấy bài.', 404);
    const row = cur.rows[0];
    if (!isSamePerson(actor, row.author_account_id, row.author_employee_code)) throw cErr('COMPETITION_SUBMISSION_FORBIDDEN', 'Không phải bài của bạn.', 403);
    if (!OWNER_EDITABLE.includes(row.status)) throw cErr('COMPETITION_SUBMISSION_NOT_SUBMITTABLE', 'Bài không ở trạng thái gửi được.', 409);
    const c = await client.query('SELECT status FROM competition.campaigns WHERE id = $1', [row.campaign_id]);
    if (!['accepting', 'reviewing'].includes(c.rows[0].status)) throw cErr('COMPETITION_CAMPAIGN_NOT_ACCEPTING', 'Chương trình không nhận bài.', 409);

    const wasNeedsRevision = row.status === 'needs_revision';
    const r = await client.query(
      `UPDATE competition.submissions
          SET status = 'submitted',
              payload = COALESCE($2::jsonb, payload),
              submitted_at = COALESCE(submitted_at, now()),
              last_review_note = NULL,
              row_version = row_version + 1
        WHERE id = $1 RETURNING *`,
      [params.submissionId, params.payload ? JSON.stringify(params.payload) : null]);

    // alias + membership atomic with submit
    const { alias } = await ensureAlias(client, row.campaign_id, actor);

    await client.query(
      `INSERT INTO competition.submission_history (submission_id, action, actor_account_id, actor_employee_code, actor_display_name, after)
       VALUES ($1, $2, $3,$4,$5, jsonb_build_object('status','submitted'))`,
      [params.submissionId, wasNeedsRevision ? 'revise' : 'submit', aa.account_id, aa.employee_code, aa.display_name]);

    // assignment: fresh submit -> L1 pool; re-submit after needs_revision ->
    // reactivate/keep existing assignment (engine decides).
    const assignment = await review.assignForSubmission(client, {
      submissionId: params.submissionId, campaignId: row.campaign_id,
      authorAccountId: row.author_account_id, authorEmployeeCode: row.author_employee_code,
      resubmit: wasNeedsRevision,
    });

    return { submission: ownerView(r.rows[0]), alias, assignment };
  });
}

// ---- reviewer / admin actions ------------------------------------------
async function reviewAction(config, actor, params) {
  const action = String(params.action || '');
  const valid = ['approve', 'upgrade', 'request_revision', 'reject'];
  if (!valid.includes(action)) throw cErr('COMPETITION_REVIEW_ACTION_INVALID', 'Hành động duyệt không hợp lệ.', 400);
  const auth = await resolveAuthority(config, actor, params.campaignId);
  if (!auth.canReview) throw cErr('COMPETITION_NOT_A_REVIEWER', 'Bạn không có quyền duyệt.', 403);
  const aa = auditActor(actor);

  return writeTx(config, async (client) => {
    const cur = await client.query(
      `SELECT s.*, c.status AS campaign_status FROM competition.submissions s
        JOIN competition.campaigns c ON c.id = s.campaign_id WHERE s.id = $1 FOR UPDATE OF s`,
      [params.submissionId]);
    if (!cur.rowCount) throw cErr('COMPETITION_SUBMISSION_NOT_FOUND', 'Không tìm thấy bài.', 404);
    const row = cur.rows[0];

    // SERVER-AUTHORITATIVE self-review block (account_id OR employee_code)
    if (isSamePerson(actor, row.author_account_id, row.author_employee_code)) {
      throw cErr('COMPETITION_SELF_REVIEW_BLOCKED', 'Không thể tự duyệt bài của mình.', 403);
    }
    if (row.campaign_id !== params.campaignId) throw cErr('COMPETITION_CAMPAIGN_MISMATCH', 'Sai chương trình.', 400);

    const levels = await client.query(
      'SELECT level_order, score FROM competition.approval_levels WHERE campaign_id = $1 ORDER BY level_order', [row.campaign_id]);
    const levelScore = new Map(levels.rows.map((x) => [x.level_order, Number(x.score)]));

    let next = { status: row.status, level: row.current_level_order, score: row.current_score, histAction: action };
    let note = cleanText(params.note);

    if (action === 'approve') {
      if (!['submitted', 'needs_revision'].includes(row.status)) throw cErr('COMPETITION_SUBMISSION_NOT_PENDING', 'Bài không ở trạng thái chờ duyệt.', 409);
      const target = Number(params.levelOrder || 1);
      if (!levelScore.has(target)) throw cErr('COMPETITION_LEVEL_NOT_FOUND', 'Mức duyệt không tồn tại.', 400);
      assertReviewerCanActOnLevel(auth, target);
      next = { status: 'approved', level: target, score: levelScore.get(target), histAction: 'approve' };
    } else if (action === 'upgrade') {
      if (row.status !== 'approved') throw cErr('COMPETITION_UPGRADE_REQUIRES_APPROVED', 'Chỉ nâng mức bài đã duyệt.', 409);
      const target = Number(params.levelOrder);
      if (!levelScore.has(target)) throw cErr('COMPETITION_LEVEL_NOT_FOUND', 'Mức duyệt không tồn tại.', 400);
      if (target <= row.current_level_order) throw cErr('COMPETITION_UPGRADE_NOT_HIGHER', 'Mức mới phải cao hơn mức hiện tại.', 409);
      assertReviewerCanActOnLevel(auth, target);
      // replacement, NOT cumulative: current_score = score of target level
      next = { status: 'approved', level: target, score: levelScore.get(target), histAction: 'upgrade' };
    } else if (action === 'request_revision') {
      if (!['submitted'].includes(row.status)) throw cErr('COMPETITION_SUBMISSION_NOT_PENDING', 'Bài không ở trạng thái chờ duyệt.', 409);
      if (!note) throw cErr('COMPETITION_REVISION_NOTE_REQUIRED', 'Cần ghi chú lý do yêu cầu chỉnh sửa.', 400);
      next = { status: 'needs_revision', level: null, score: null, histAction: 'revision_requested' };
    } else if (action === 'reject') {
      if (!['submitted', 'needs_revision'].includes(row.status)) throw cErr('COMPETITION_SUBMISSION_NOT_PENDING', 'Bài không ở trạng thái chờ duyệt.', 409);
      if (!note) throw cErr('COMPETITION_REJECT_NOTE_REQUIRED', 'Cần ghi chú lý do từ chối.', 400);
      next = { status: 'rejected', level: null, score: null, histAction: 'reject' };
    }

    const setApprovedAt = next.status === 'approved';
    const r = await client.query(
      `UPDATE competition.submissions SET
         status = $2,
         current_level_order = $3,
         current_score = $4,
         last_review_note = COALESCE($5, last_review_note),
         approved_at = CASE WHEN $6::boolean THEN now() ELSE approved_at END,
         first_approved_at = CASE WHEN $6::boolean AND first_approved_at IS NULL THEN now() ELSE first_approved_at END,
         rejected_at = CASE WHEN $2 = 'rejected' THEN now() ELSE rejected_at END,
         row_version = row_version + 1
       WHERE id = $1 RETURNING *`,
      [params.submissionId, next.status, next.level, next.score, note, setApprovedAt]);

    const histPayload = next.histAction === 'upgrade'
      ? { from_level: row.current_level_order, to_level: next.level, from_score: row.current_score, to_score: next.score }
      : { status: next.status, level: next.level };
    await client.query(
      `INSERT INTO competition.submission_history (submission_id, action, actor_account_id, actor_employee_code, actor_display_name, before, after, reason)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
      [params.submissionId, next.histAction, aa.account_id, aa.employee_code, aa.display_name,
       JSON.stringify({ status: row.status, level: row.current_level_order, score: row.current_score }),
       JSON.stringify(histPayload), note]);

    // close the active review assignment for the acting reviewer
    const OUTCOME = { approve: 'approved', reject: 'rejected', upgrade: 'upgraded', request_revision: 'needs_revision' };
    await review.completeAssignmentForReviewer(client, {
      submissionId: params.submissionId, reviewerAccountId: actor.accountId, reviewerEmployeeCode: actor.employeeCode,
      outcome: OUTCOME[action],
      actor: aa,
    });

    // once approved at the base level, hand a lighter high-tier ownership
    // assignment to a high reviewer (best-effort; no-op if none / already set).
    if (next.status === 'approved' && next.histAction === 'approve' && Number(next.level) === 1) {
      await review.ensureHighAssignment(client, {
        submissionId: params.submissionId, campaignId: row.campaign_id,
        authorAccountId: row.author_account_id, authorEmployeeCode: row.author_employee_code,
        currentLevelOrder: next.level,
      });
    }

    return ownerView(r.rows[0]);
  });
}

// ---- admin override / withdraw approval --------------------------------
async function adminOverride(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  requireCompetitionAdmin(auth);
  const reason = cleanText(params.reason);
  if (!reason) throw cErr('COMPETITION_OVERRIDE_REASON_REQUIRED', 'Can thiệp của Admin phải có lý do.', 400);
  const aa = auditActor(actor);
  const mode = String(params.mode || ''); // 'withdraw_approval' | 'set_status' | 'edit_payload'

  return writeTx(config, async (client) => {
    const cur = await client.query('SELECT * FROM competition.submissions WHERE id = $1 FOR UPDATE', [params.submissionId]);
    if (!cur.rowCount) throw cErr('COMPETITION_SUBMISSION_NOT_FOUND', 'Không tìm thấy bài.', 404);
    const row = cur.rows[0];
    if (isSamePerson(actor, row.author_account_id, row.author_employee_code)) {
      throw cErr('COMPETITION_SELF_REVIEW_BLOCKED', 'Admin không thể tự duyệt/can thiệp bài của chính mình.', 403);
    }
    await client.query(`SET LOCAL competition.allow_submission_override = 'on'`);

    let r;
    let histAction = 'admin_override';
    if (mode === 'withdraw_approval') {
      if (row.status !== 'approved') throw cErr('COMPETITION_NOT_APPROVED', 'Bài chưa được duyệt.', 409);
      r = await client.query(
        `UPDATE competition.submissions SET status='submitted', current_level_order=NULL, current_score=NULL,
           approved_at=NULL, last_review_note=$2, row_version=row_version+1 WHERE id=$1 RETURNING *`,
        [params.submissionId, reason]);
      histAction = 'approval_withdrawn';
    } else if (mode === 'set_status') {
      const target = String(params.targetStatus || '');
      if (!['draft', 'submitted', 'needs_revision', 'approved', 'rejected', 'finalized'].includes(target)) {
        throw cErr('COMPETITION_STATUS_INVALID', 'Trạng thái không hợp lệ.', 400);
      }
      r = await client.query(
        `UPDATE competition.submissions SET status=$2, last_review_note=$3, row_version=row_version+1 WHERE id=$1 RETURNING *`,
        [params.submissionId, target, reason]);
    } else if (mode === 'edit_payload') {
      r = await client.query(
        `UPDATE competition.submissions SET payload=$2::jsonb, last_review_note=$3, row_version=row_version+1 WHERE id=$1 RETURNING *`,
        [params.submissionId, JSON.stringify(params.payload || {}), reason]);
    } else {
      throw cErr('COMPETITION_OVERRIDE_MODE_INVALID', 'mode không hợp lệ.', 400);
    }

    await client.query(
      `INSERT INTO competition.submission_history (submission_id, action, actor_account_id, actor_employee_code, actor_display_name, before, after, reason)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
      [params.submissionId, histAction, aa.account_id, aa.employee_code, aa.display_name,
       JSON.stringify({ status: row.status, level: row.current_level_order, score: row.current_score }),
       JSON.stringify({ status: r.rows[0].status, level: r.rows[0].current_level_order, score: r.rows[0].current_score }), reason]);
    return ownerView(r.rows[0]);
  });
}

// ---- V1.3 post-approval score adjustment (effective 0/2/5) -------------
// Authorized to: Competition Admin, OR a reviewer at the campaign's TOP
// configured level (the same "high reviewer" concept competition-review.js
// ensureHighAssignment / competition-leaderboard.js isPrivileged already
// use — reviewerMaxLevel >= max(level_order), i.e. "Reviewer 5đ" in the
// current 2-level campaign, dynamic for any future level count). A plain
// lower-level reviewer is REJECTED server-side even if the client somehow
// sent the action (never trust a hidden-button-only gate).
//
// current_score/current_level_order are NEVER touched here — they remain
// the audit record of the ORIGINAL review. Only effective_score changes;
// every count/sum (progress/leaderboard/awards) reads
// COALESCE(effective_score, current_score) as the current effective result.
async function adjustScore(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  const aa = auditActor(actor);
  const reason = cleanText(params.reason);
  if (!reason) throw cErr('COMPETITION_ADJUSTMENT_REASON_REQUIRED', 'Cần nhập lý do điều chỉnh.', 400);
  const reviewerRecord = cleanText(params.reviewerRecord);

  return writeTx(config, async (client) => {
    const topR = await client.query('SELECT max(level_order) m FROM competition.approval_levels WHERE campaign_id = $1', [params.campaignId]);
    const topLevel = topR.rows[0].m || 1;
    const isAuthorized = auth.isCompetitionAdmin || (auth.reviewerMaxLevel != null && auth.reviewerMaxLevel >= topLevel);
    if (!isAuthorized) {
      throw cErr('COMPETITION_ADJUSTMENT_NOT_AUTHORIZED',
        'Chỉ Reviewer ở mức cao nhất hoặc Competition Admin mới được điều chỉnh kết quả sau khi đã duyệt.', 403);
    }

    const cur = await client.query('SELECT * FROM competition.submissions WHERE id = $1 FOR UPDATE', [params.submissionId]);
    if (!cur.rowCount) throw cErr('COMPETITION_SUBMISSION_NOT_FOUND', 'Không tìm thấy bài.', 404);
    const row = cur.rows[0];
    if (row.campaign_id !== params.campaignId) throw cErr('COMPETITION_CAMPAIGN_MISMATCH', 'Sai chương trình.', 400);
    if (isSamePerson(actor, row.author_account_id, row.author_employee_code)) {
      throw cErr('COMPETITION_SELF_REVIEW_BLOCKED', 'Không thể tự điều chỉnh kết quả bài của chính mình.', 403);
    }
    if (!['approved', 'finalized'].includes(row.status)) {
      throw cErr('COMPETITION_ADJUSTMENT_NOT_APPROVED', 'Chỉ điều chỉnh được bài đã duyệt.', 409);
    }

    // targetLevelOrder: 0/null => "Không ghi nhận" (score 0, no level). Any
    // other value must resolve to a REAL configured level's score — the
    // effective score is never a number the campaign didn't actually define.
    const targetLevelOrder = Number(params.targetLevelOrder || 0);
    let newScore = 0;
    if (targetLevelOrder > 0) {
      const lv = await client.query(
        'SELECT score FROM competition.approval_levels WHERE campaign_id = $1 AND level_order = $2', [params.campaignId, targetLevelOrder]);
      if (!lv.rowCount) throw cErr('COMPETITION_LEVEL_NOT_FOUND', 'Mức duyệt không tồn tại.', 400);
      newScore = Number(lv.rows[0].score);
    }
    const oldEffective = row.effective_score != null ? Number(row.effective_score)
      : (row.current_score == null ? 0 : Number(row.current_score));

    const r = await client.query(
      `UPDATE competition.submissions SET
         effective_score = $2,
         last_review_note = COALESCE($3, last_review_note),
         row_version = row_version + 1
       WHERE id = $1 RETURNING *`,
      [params.submissionId, newScore, reviewerRecord]);

    await client.query(
      `INSERT INTO competition.submission_history (submission_id, action, actor_account_id, actor_employee_code, actor_display_name, before, after, reason)
       VALUES ($1,'score_adjust',$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
      [params.submissionId, aa.account_id, aa.employee_code, aa.display_name,
       JSON.stringify({ effectiveScore: oldEffective }),
       JSON.stringify({ effectiveScore: newScore, targetLevelOrder: targetLevelOrder || null }), reason]);

    return ownerView(r.rows[0]);
  });
}

// List approved/finalized submissions eligible for adjustment — same
// authorization + same anonymous shape as competition.review.queue (no
// author identity). Bounded (50 most recent) so this stays a cheap read.
async function listAdjustable(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  return readTx(config, async (client) => {
    const topR = await client.query('SELECT max(level_order) m FROM competition.approval_levels WHERE campaign_id = $1', [params.campaignId]);
    const topLevel = topR.rows[0].m || 1;
    const isAuthorized = auth.isCompetitionAdmin || (auth.reviewerMaxLevel != null && auth.reviewerMaxLevel >= topLevel);
    if (!isAuthorized) {
      throw cErr('COMPETITION_ADJUSTMENT_NOT_AUTHORIZED',
        'Chỉ Reviewer ở mức cao nhất hoặc Competition Admin mới xem được danh sách điều chỉnh.', 403);
    }
    const r = await client.query(
      `SELECT id AS submission_ref, payload, status, current_level_order, current_score, effective_score, submitted_at
         FROM competition.submissions
        WHERE campaign_id = $1 AND status IN ('approved','finalized')
        ORDER BY updated_at DESC
        LIMIT 50`,
      [params.campaignId]);
    return {
      items: r.rows.map((x) => ({
        submissionRef: x.submission_ref, payload: x.payload, status: x.status,
        currentLevelOrder: x.current_level_order,
        currentScore: x.current_score == null ? null : Number(x.current_score),
        effectiveScore: x.effective_score != null ? Number(x.effective_score) : (x.current_score == null ? null : Number(x.current_score)),
        adjusted: x.effective_score != null,
        submittedAt: x.submitted_at,
        // DELIBERATELY ABSENT: author name / code / department / branch / account
      })),
    };
  });
}

// finalize every approved submission of a campaign (part of "chốt chương trình")
async function finalizeCampaignSubmissions(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  requireCompetitionAdmin(auth);
  const aa = auditActor(actor);
  return writeTx(config, async (client) => {
    const c = await client.query('SELECT status FROM competition.campaigns WHERE id = $1 FOR UPDATE', [params.campaignId]);
    if (!c.rowCount) throw cErr('COMPETITION_CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình.', 404);
    const pending = await client.query(
      `SELECT count(*)::int n FROM competition.submissions WHERE campaign_id = $1 AND status IN ('submitted','needs_revision')`,
      [params.campaignId]);
    if (pending.rows[0].n > 0 && !params.force) {
      throw cErr('COMPETITION_PENDING_REVIEWS', `Còn ${pending.rows[0].n} bài chưa xử lý xong.`, 409);
    }
    const r = await client.query(
      `UPDATE competition.submissions SET status='finalized', finalized_at=now(), row_version=row_version+1
        WHERE campaign_id = $1 AND status = 'approved' RETURNING id`,
      [params.campaignId]);
    for (const s of r.rows) {
      await client.query(
        `INSERT INTO competition.submission_history (submission_id, action, actor_account_id, actor_employee_code, actor_display_name, after)
         VALUES ($1,'finalize',$2,$3,$4, jsonb_build_object('status','finalized'))`,
        [s.id, aa.account_id, aa.employee_code, aa.display_name]);
    }
    return { finalizedCount: r.rowCount, pendingRemaining: pending.rows[0].n };
  });
}

module.exports = {
  ownerView, listMySubmissions, getMySubmission,
  createDraft, editDraft, submit, reviewAction, adminOverride, adjustScore, listAdjustable, finalizeCampaignSubmissions,
};
