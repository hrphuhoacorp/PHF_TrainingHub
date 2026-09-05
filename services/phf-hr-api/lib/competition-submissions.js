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
const { emitCompetitionNotifications } = require('./competition-notification-emit');

const OWNER_EDITABLE = ['draft', 'needs_revision'];

// Vietnamese notification copy for reviewAction() outcomes (spec section 9).
// Never includes reviewer identity — only score/level and, for revision/
// reject, the reviewer's note text (content only, no actor).
function reviewNotificationContent(histAction, score, note) {
  if (histAction === 'approve' || histAction === 'upgrade') {
    const s = Number(score);
    return {
      eventCode: histAction === 'upgrade' ? 'COMPETITION_SUBMISSION_UPGRADED' : 'COMPETITION_SUBMISSION_APPROVED',
      title: 'Bài dự thi đã được duyệt',
      message: 'Bài dự thi của bạn được ghi nhận ' + s + ' điểm' + (s >= 5 ? ' · Giá trị cao.' : '.'),
    };
  }
  if (histAction === 'revision_requested') {
    return {
      eventCode: 'COMPETITION_SUBMISSION_REVISION_REQUESTED',
      title: 'Bài dự thi cần chỉnh sửa',
      message: note ? ('Lý do: ' + note) : 'Bài dự thi của bạn cần được chỉnh sửa.',
    };
  }
  if (histAction === 'reject') {
    return {
      eventCode: 'COMPETITION_SUBMISSION_REJECTED',
      title: 'Bài dự thi chưa được ghi nhận',
      message: note ? ('Lý do: ' + note) : 'Bài dự thi của bạn chưa được ghi nhận.',
    };
  }
  return { eventCode: null };
}

function ownerView(r) {
  return {
    id: r.id, campaignId: r.campaign_id, status: r.status, payload: r.payload,
    currentLevelOrder: r.current_level_order, currentScore: r.current_score == null ? null : Number(r.current_score),
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

    // participant notification — recipient is the submission's OWN author,
    // resolved server-side from the row (never client-supplied). No reviewer
    // identity is ever included in the content.
    await emitCompetitionNotifications({
      client, submissionId: params.submissionId,
      recipients: [{ accountId: row.author_account_id, employeeCode: row.author_employee_code }],
      actor: {}, // do not exclude the author (they are the recipient, never the actor here)
      priority: 'Trung bình', targetPath: '/thi-dua/bai-cua-toi',
      dedupeKey: 'cmp:' + params.submissionId + ':' + next.histAction + ':' + r.rows[0].row_version,
      ...reviewNotificationContent(next.histAction, next.score, note),
    });

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

    // notify the participant ONLY when this override actually changes the
    // effective result of a submission that WAS approved/finalized — never
    // for a plain edit_payload / a status change that never carried a score.
    const wasScored = ['approved', 'finalized'].includes(row.status);
    const scoreChanged = Number(row.current_score || 0) !== Number(r.rows[0].current_score || 0)
      || row.status !== r.rows[0].status;
    if (wasScored && scoreChanged && mode !== 'edit_payload') {
      const fromScore = row.current_score == null ? 0 : Number(row.current_score);
      const toScore = r.rows[0].current_score == null ? 0 : Number(r.rows[0].current_score);
      let phrase;
      if (toScore === 0) phrase = fromScore + ' → 0 (Không ghi nhận)';
      else if (fromScore === 0) phrase = '0 → ' + toScore + ' (khôi phục)';
      else phrase = fromScore + ' → ' + toScore;
      await emitCompetitionNotifications({
        client, submissionId: params.submissionId,
        recipients: [{ accountId: row.author_account_id, employeeCode: row.author_employee_code }],
        actor: {}, priority: 'Cao', targetPath: '/thi-dua/bai-cua-toi',
        eventCode: 'COMPETITION_SUBMISSION_ADJUSTED',
        title: 'Kết quả chấm đã thay đổi',
        message: 'Kết quả bài dự thi của bạn đã được điều chỉnh: ' + phrase + ' điểm.',
        dedupeKey: 'cmp:' + params.submissionId + ':COMPETITION_SUBMISSION_ADJUSTED:' + r.rows[0].row_version,
      });
    }
    return ownerView(r.rows[0]);
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
  createDraft, editDraft, submit, reviewAction, adminOverride, finalizeCampaignSubmissions,
};
