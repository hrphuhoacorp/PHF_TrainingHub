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

// V1.4 — participant-facing notification content for each reviewAction
// outcome. Never includes reviewer identity (recipient is the submission
// author, resolved server-side from the row's own columns — never client
// input). note is the reviewer's own text (mandatory for request_revision/
// reject already, see reviewAction below) and is surfaced verbatim when
// present; otherwise a generic fallback sentence is used.
function reviewNotificationContent(histAction, score, note) {
  if (histAction === 'approve') {
    return { eventCode: 'COMPETITION_SUBMISSION_APPROVED', title: 'Bài dự thi đã được duyệt',
      message: 'Bài dự thi của bạn đã được ghi nhận ' + score + ' điểm.' };
  }
  if (histAction === 'upgrade') {
    return { eventCode: 'COMPETITION_SUBMISSION_UPGRADED', title: 'Bài dự thi được nâng mức',
      message: 'Bài dự thi của bạn được ghi nhận ' + score + ' điểm · Giá trị cao.' };
  }
  if (histAction === 'revision_requested') {
    return { eventCode: 'COMPETITION_SUBMISSION_REVISION_REQUESTED', title: 'Bài dự thi cần chỉnh sửa',
      message: note || 'Bài dự thi của bạn cần được chỉnh sửa lại.' };
  }
  if (histAction === 'reject') {
    return { eventCode: 'COMPETITION_SUBMISSION_REJECTED', title: 'Bài dự thi chưa được ghi nhận',
      message: note || 'Bài dự thi của bạn chưa được ghi nhận.' };
  }
  return null;
}

// V1.6 — Admin Control Tower "Phục hồi trạng thái bài" author notification.
// Content mirrors reviewNotificationContent's plain-language style: no
// technical detail, no reviewer/admin identity, message reflects the
// RESULTING state only.
function restoreNotificationContent(targetStatus, targetScore) {
  if (targetStatus === 'submitted') {
    return { title: 'Trạng thái bài dự thi đã được phục hồi',
      message: 'Trạng thái bài dự thi của bạn đã được phục hồi và đang chờ xét duyệt.' };
  }
  if (targetStatus === 'needs_revision') {
    return { title: 'Trạng thái bài dự thi đã được phục hồi',
      message: 'Bài dự thi của bạn đã được phục hồi về trạng thái cần chỉnh sửa.' };
  }
  if (targetStatus === 'rejected') {
    return { title: 'Trạng thái bài dự thi đã được phục hồi',
      message: 'Bài dự thi của bạn đã được phục hồi về trạng thái chưa được ghi nhận.' };
  }
  if (targetStatus === 'approved') {
    return { title: 'Trạng thái bài dự thi đã được phục hồi',
      message: 'Bài dự thi của bạn đã được phục hồi và ghi nhận ' + targetScore + ' điểm.' };
  }
  return null;
}

// V1.6 — history actions a checkpoint can legitimately be restored FROM.
// Exactly the set spec'd: submit/revise -> submitted, approve/upgrade ->
// approved (+ level + score), revision_requested -> needs_revision,
// reject -> rejected. Never 'create' (draft), 'finalize', 'admin_override',
// 'approval_withdrawn', 'score_adjust' or 'restore' itself — those either
// have no reliably-derivable level+score or would compound audit noise.
const RESTORABLE_HISTORY_ACTIONS = ['submit', 'revise', 'approve', 'upgrade', 'revision_requested', 'reject'];

// Re-derive {status, level, score} FROM the history row's OWN recorded
// `after` JSON — never from client-supplied values. 'approve' didn't record
// a score at write time (see reviewAction's histPayload), so its score is
// looked up against the CAMPAIGN'S CURRENT approval_levels config (same
// source reviewAction/adjustScore already trust); 'upgrade' recorded
// to_level/to_score directly, so those are reused verbatim for full
// historical fidelity.
async function deriveRestoreTarget(client, campaignId, historyRow) {
  const after = historyRow.after || {};
  switch (historyRow.action) {
    case 'submit':
    case 'revise':
      return { status: 'submitted', level: null, score: null };
    case 'revision_requested':
      return { status: 'needs_revision', level: null, score: null };
    case 'reject':
      return { status: 'rejected', level: null, score: null };
    case 'approve': {
      const target = Number(after.level);
      if (!target) throw cErr('COMPETITION_RESTORE_CHECKPOINT_INVALID', 'Không xác định được mức duyệt để phục hồi.', 409);
      const lv = await client.query(
        'SELECT score FROM competition.approval_levels WHERE campaign_id = $1 AND level_order = $2', [campaignId, target]);
      if (!lv.rowCount) throw cErr('COMPETITION_LEVEL_NOT_FOUND', 'Mức duyệt của điểm phục hồi này không còn tồn tại.', 409);
      return { status: 'approved', level: target, score: Number(lv.rows[0].score) };
    }
    case 'upgrade': {
      const target = Number(after.to_level);
      const score = after.to_score != null ? Number(after.to_score) : null;
      if (!target || score == null) throw cErr('COMPETITION_RESTORE_CHECKPOINT_INVALID', 'Không xác định được mức duyệt để phục hồi.', 409);
      return { status: 'approved', level: target, score };
    }
    default:
      throw cErr('COMPETITION_RESTORE_CHECKPOINT_INVALID', 'Sự kiện này không thể dùng để phục hồi.', 400);
  }
}

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

// ---- V1.5 bulk upload (participant capability) -------------------------
// "Nhập nhiều bài" — lets a participant submit many rows from one uploaded
// file in a single call. Each row becomes its own normal Competition
// submission (own id, own submitted_at, own history/review/notification/
// similarity/leaderboard lifecycle) by literally reusing createDraft()+
// submit() above — never a shortcut/parallel write path. Author identity is
// ALWAYS the server-verified `actor`; the payload can never carry an
// employee/account selector (that field simply isn't read here).
//
// Row cap: a generous sane ceiling to block abuse, not a workflow limit.
const BULK_MAX_ROWS = 200;
// Idempotency window for retrying the SAME confirmed batch without a schema
// change: an identical (author, campaign, normalized question+answer) row
// created in the last N hours is treated as already imported.
const BULK_DEDUPE_WINDOW_HOURS = 24;

function normalizeForDedupe(s) {
  return String(s || '')
    .trim().toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ');
}

async function findExistingBulkDuplicate(client, { campaignId, authorAccountId, authorEmployeeCode, normQuestion, normAnswer }) {
  // Case-insensitive/whitespace-normalized text comparison against the
  // JSONB payload text columns — no new column/index needed.
  const r = await client.query(
    `SELECT id FROM competition.submissions
      WHERE campaign_id = $1
        AND ( ($2 <> '' AND author_account_id = $2) OR ($3 <> '' AND author_employee_code = $3) )
        AND created_at >= now() - ($4 || ' hours')::interval
        AND regexp_replace(lower(trim(both from COALESCE(payload->>'customer_question',''))), '\\s+', ' ', 'g') = $5
        AND regexp_replace(lower(trim(both from COALESCE(payload->>'answer',''))), '\\s+', ' ', 'g') = $6
      ORDER BY created_at DESC
      LIMIT 1`,
    [campaignId, authorAccountId || '', authorEmployeeCode || '', BULK_DEDUPE_WINDOW_HOURS, normQuestion, normAnswer]);
  return r.rowCount ? r.rows[0].id : null;
}

async function bulkSubmit(config, actor, params) {
  const aa = auditActor(actor);
  const campaignId = String(params.campaignId || '');
  if (!campaignId) throw cErr('COMPETITION_CAMPAIGN_REQUIRED', 'Thiếu chương trình.', 400);
  const rawRows = Array.isArray(params.rows) ? params.rows : [];
  if (!rawRows.length) throw cErr('COMPETITION_BULK_ROWS_REQUIRED', 'File không có dòng dữ liệu hợp lệ.', 400);
  if (rawRows.length > BULK_MAX_ROWS) {
    throw cErr('COMPETITION_BULK_TOO_MANY_ROWS', `Chỉ chấp nhận tối đa ${BULK_MAX_ROWS} dòng mỗi lần tải lên.`, 400);
  }

  // campaign must actually be accepting submissions — checked once, up
  // front, same rule createDraft() enforces per-row.
  const campaignStatus = await readTx(config, async (client) => {
    const c = await client.query('SELECT status FROM competition.campaigns WHERE id = $1', [campaignId]);
    if (!c.rowCount) throw cErr('COMPETITION_CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình.', 404);
    return c.rows[0].status;
  });
  if (!['accepting', 'reviewing'].includes(campaignStatus)) {
    throw cErr('COMPETITION_CAMPAIGN_NOT_ACCEPTING', 'Chương trình hiện không nhận bài.', 409);
  }

  // NEVER an employee/account/reviewer/score/status selector — only these
  // four content keys are ever read off an uploaded row, defensively,
  // regardless of what extra columns a user's file may contain.
  const seenInFile = new Map(); // normalized key -> first rowIndex
  const results = [];

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i] || {};
    const rowIndex = i + 1; // 1-based, matches a spreadsheet row-after-header convention on the frontend
    const customerQuestion = cleanText(raw.customer_question);
    const answer = cleanText(raw.answer);
    const actualResult = cleanText(raw.actual_result);
    const evidenceReference = cleanText(raw.evidence_reference);

    if (!customerQuestion || !answer) {
      results.push({ rowIndex, status: 'invalid', reason: 'Thiếu "Câu hỏi / Tình huống khách hàng" hoặc "Cách trả lời / Xử lý".' });
      continue;
    }

    const normQuestion = normalizeForDedupe(customerQuestion);
    const normAnswer = normalizeForDedupe(answer);
    const dedupeKey = normQuestion + '' + normAnswer;

    if (seenInFile.has(dedupeKey)) {
      results.push({ rowIndex, status: 'duplicate_in_file', reason: 'Trùng nội dung với dòng #' + seenInFile.get(dedupeKey) + ' trong cùng file.' });
      continue;
    }
    seenInFile.set(dedupeKey, rowIndex);

    const payload = { customer_question: customerQuestion, answer };
    if (actualResult) payload.actual_result = actualResult;
    if (evidenceReference) payload.evidence_reference = evidenceReference;

    try {
      // idempotency: same author + campaign + normalized text within the
      // recent window => treat a retry of the same confirmed batch as
      // already-imported rather than creating a second submission.
      const existingId = await readTx(config, (client) => findExistingBulkDuplicate(client, {
        campaignId, authorAccountId: actor.accountId, authorEmployeeCode: actor.employeeCode, normQuestion, normAnswer,
      }));
      if (existingId) {
        results.push({ rowIndex, status: 'already_exists', submissionId: existingId, reason: 'Bài với nội dung này đã được gửi trước đó.' });
        continue;
      }

      // per-row similarity flag — informational only, never blocks (safe
      // minimum per spec: no auto "Tôi cũng gặp" branching in bulk mode).
      let similar = false, similarSubmissionRef = null;
      try {
        const sim = await similarityService().checkSimilarityForSubmit(config, actor, {
          campaignId, question: customerQuestion, answer,
        });
        if (sim && sim.hasSimilar && sim.candidates && sim.candidates.length) {
          similar = true;
          similarSubmissionRef = sim.candidates[0].submissionRef;
        }
      } catch (e) { /* similarity is advisory only — never fail the row for it */ }

      // reuse the exact single-submit lifecycle: own transaction each.
      const draft = await createDraft(config, actor, { campaignId, payload });
      await submit(config, actor, { submissionId: draft.id, payload });

      results.push({
        rowIndex, status: 'submitted', submissionId: draft.id,
        similar, similarSubmissionRef,
      });
    } catch (e) {
      results.push({ rowIndex, status: 'invalid', reason: (e && e.message) || 'Không gửi được dòng này.' });
    }
  }

  const submittedCount = results.filter((x) => x.status === 'submitted').length;
  const needsAttentionCount = results.length - submittedCount;
  return {
    batchId: params.batchId || null,
    campaignId,
    totalRows: rawRows.length,
    submittedCount,
    needsAttentionCount,
    results,
  };
}

// lazy require to avoid a require-cycle between competition-submissions.js
// and competition-similarity-service.js (the latter does not import this
// module, but keeping the require lazy here costs nothing and is defensive).
function similarityService() { return require('./competition-similarity-service'); }

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

    // V1.4 — notify the AUTHOR (never the reviewer's identity revealed).
    // Recipient resolved from the submission row's own author columns, never
    // client input. dedupeKey is keyed off the row's new row_version so a
    // retry of the same commit never duplicates, while a genuinely later
    // event (e.g. a subsequent upgrade) gets its own row.
    const notifContent = reviewNotificationContent(next.histAction, next.score, note);
    if (notifContent) {
      await emitCompetitionNotifications({
        client, eventCode: notifContent.eventCode, submissionId: params.submissionId,
        title: notifContent.title, message: notifContent.message,
        targetPath: '/thi-dua/bai-cua-toi', priority: 'Trung bình',
        recipients: [{ accountId: row.author_account_id, employeeCode: row.author_employee_code }],
        actor: aa,
        dedupeKey: 'cmp:' + params.submissionId + ':' + notifContent.eventCode + ':v' + r.rows[0].row_version,
      });
    }

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

    // NOTE (technical-note cleanup): `reason` here is an internal Admin
    // audit/technical-correction note — it must go ONLY into
    // submission_history.reason (the audit trail), never into
    // last_review_note (the participant-visible "Kết quả / Ghi nhận của
    // giám khảo" field). This mirrors the already-correct adjustScore()
    // pattern below, which uses a SEPARATE dedicated param
    // (reviewerRecord) for anything meant to reach last_review_note.
    // last_review_note is therefore left UNTOUCHED by every adminOverride
    // mode — do not add it back to any of these UPDATE statements.
    let r;
    let histAction = 'admin_override';
    if (mode === 'withdraw_approval') {
      if (row.status !== 'approved') throw cErr('COMPETITION_NOT_APPROVED', 'Bài chưa được duyệt.', 409);
      r = await client.query(
        `UPDATE competition.submissions SET status='submitted', current_level_order=NULL, current_score=NULL,
           approved_at=NULL, row_version=row_version+1 WHERE id=$1 RETURNING *`,
        [params.submissionId]);
      histAction = 'approval_withdrawn';
    } else if (mode === 'set_status') {
      const target = String(params.targetStatus || '');
      if (!['draft', 'submitted', 'needs_revision', 'approved', 'rejected', 'finalized'].includes(target)) {
        throw cErr('COMPETITION_STATUS_INVALID', 'Trạng thái không hợp lệ.', 400);
      }
      r = await client.query(
        `UPDATE competition.submissions SET status=$2, row_version=row_version+1 WHERE id=$1 RETURNING *`,
        [params.submissionId, target]);
    } else if (mode === 'edit_payload') {
      r = await client.query(
        `UPDATE competition.submissions SET payload=$2::jsonb, row_version=row_version+1 WHERE id=$1 RETURNING *`,
        [params.submissionId, JSON.stringify(params.payload || {})]);
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

// ---- V1.6 Admin Control Tower — lifecycle restore -----------------------
// "Phục hồi trạng thái bài" — undoes a technical/erroneous lifecycle event by
// restoring a submission to a REAL prior checkpoint reconstructed from its
// own submission_history (never an arbitrary client-supplied status/level/
// score — see deriveRestoreTarget above). Admin-only. Mirrors adminOverride's
// write discipline: `reason` is audit-only (submission_history.reason),
// last_review_note is left untouched (this is a lifecycle correction, not a
// reviewer judgment). Stale-state safety is the WHERE row_version=$expected
// match on the UPDATE itself — a retry after a successful restore carries a
// now-stale expectedRowVersion and correctly fails with COMPETITION_STALE_STATE.
async function adminRestoreSubmission(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  requireCompetitionAdmin(auth);
  const reason = cleanText(params.reason);
  if (!reason) throw cErr('COMPETITION_RESTORE_REASON_REQUIRED', 'Phục hồi trạng thái bài phải có lý do.', 400);
  const aa = auditActor(actor);
  const submissionId = String(params.submissionId || '');
  const targetHistoryEventId = String(params.targetHistoryEventId || '');
  if (!submissionId || !targetHistoryEventId) throw cErr('COMPETITION_RESTORE_TARGET_REQUIRED', 'Thiếu điểm phục hồi.', 400);
  const expectedRowVersion = params.expectedRowVersion == null || params.expectedRowVersion === '' ? null : Number(params.expectedRowVersion);
  if (expectedRowVersion == null) throw cErr('COMPETITION_RESTORE_ROWVERSION_REQUIRED', 'Thiếu phiên bản bài để phục hồi an toàn.', 400);

  return writeTx(config, async (client) => {
    const cur = await client.query('SELECT * FROM competition.submissions WHERE id = $1 FOR UPDATE', [submissionId]);
    if (!cur.rowCount) throw cErr('COMPETITION_SUBMISSION_NOT_FOUND', 'Không tìm thấy bài.', 404);
    const row = cur.rows[0];
    if (params.campaignId && row.campaign_id !== params.campaignId) throw cErr('COMPETITION_CAMPAIGN_MISMATCH', 'Sai chương trình.', 400);
    if (isSamePerson(actor, row.author_account_id, row.author_employee_code)) {
      throw cErr('COMPETITION_SELF_REVIEW_BLOCKED', 'Admin không thể tự can thiệp bài của chính mình.', 403);
    }

    // stale-state safety FIRST — compare against the version the frontend
    // captured when it opened the restore modal, before touching anything.
    if (Number(expectedRowVersion) !== row.row_version) {
      throw cErr('COMPETITION_STALE_STATE', 'Trạng thái bài đã thay đổi ở nơi khác — vui lòng tải lại và mở lại.', 409);
    }

    const histR = await client.query(
      `SELECT id, action, after, at FROM competition.submission_history WHERE id = $1 AND submission_id = $2`,
      [targetHistoryEventId, submissionId]);
    if (!histR.rowCount) throw cErr('COMPETITION_RESTORE_CHECKPOINT_NOT_FOUND', 'Không tìm thấy điểm phục hồi này trên bài.', 404);
    const histRow = histR.rows[0];
    if (!RESTORABLE_HISTORY_ACTIONS.includes(histRow.action)) {
      throw cErr('COMPETITION_RESTORE_CHECKPOINT_INVALID', 'Sự kiện này không thể dùng làm điểm phục hồi.', 400);
    }

    const target = await deriveRestoreTarget(client, row.campaign_id, histRow);
    const sameAsCurrent = target.status === row.status
      && target.level === row.current_level_order
      && Number(target.score || 0) === Number(row.current_score || 0);
    if (sameAsCurrent) throw cErr('COMPETITION_RESTORE_NOOP', 'Bài đã ở đúng trạng thái này — không có gì để phục hồi.', 409);

    await client.query(`SET LOCAL competition.allow_submission_override = 'on'`);
    const r = await client.query(
      `UPDATE competition.submissions SET
         status = $2, current_level_order = $3, current_score = $4,
         row_version = row_version + 1
       WHERE id = $1 AND row_version = $5 RETURNING *`,
      [submissionId, target.status, target.level, target.score, expectedRowVersion]);
    if (!r.rowCount) throw cErr('COMPETITION_STALE_STATE', 'Trạng thái bài đã thay đổi ở nơi khác — vui lòng tải lại và mở lại.', 409);

    await client.query(
      `INSERT INTO competition.submission_history (submission_id, action, actor_account_id, actor_employee_code, actor_display_name, before, after, reason)
       VALUES ($1,'restore',$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
      [submissionId, aa.account_id, aa.employee_code, aa.display_name,
       JSON.stringify({ status: row.status, level: row.current_level_order, score: row.current_score }),
       JSON.stringify({ status: target.status, level: target.level, score: target.score, restoredFromHistoryId: histRow.id }),
       reason]);

    const content = restoreNotificationContent(target.status, target.score);
    if (content) {
      await emitCompetitionNotifications({
        client, eventCode: 'COMPETITION_SUBMISSION_RESTORED', submissionId,
        title: content.title, message: content.message,
        targetPath: '/thi-dua/bai-cua-toi', priority: 'Trung bình',
        recipients: [{ accountId: row.author_account_id, employeeCode: row.author_employee_code }],
        actor: aa,
        dedupeKey: 'cmp:' + submissionId + ':COMPETITION_SUBMISSION_RESTORED:v' + r.rows[0].row_version,
      });
    }

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

    // V1.4 — participant notification for a post-approval score adjustment.
    // Recipient is the submission author (server-resolved); actor (the
    // adjusting reviewer/admin) is excluded from recipients by the emit
    // helper itself. →0 renders as "Không ghi nhận"; 0→restore renders the
    // restored score, never a bare "0".
    const fromLabel = oldEffective === 0 ? 'Không ghi nhận' : oldEffective + ' điểm';
    const toLabel = newScore === 0 ? 'Không ghi nhận' : newScore + ' điểm';
    await emitCompetitionNotifications({
      client, eventCode: 'COMPETITION_SUBMISSION_ADJUSTED', submissionId: params.submissionId,
      title: 'Kết quả chấm đã thay đổi',
      message: 'Kết quả chấm bài dự thi của bạn đã thay đổi từ ' + fromLabel + ' thành ' + toLabel + '.',
      targetPath: '/thi-dua/bai-cua-toi', priority: 'Trung bình',
      recipients: [{ accountId: row.author_account_id, employeeCode: row.author_employee_code }],
      actor: aa,
      dedupeKey: 'cmp:' + params.submissionId + ':COMPETITION_SUBMISSION_ADJUSTED:v' + r.rows[0].row_version,
    });

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
  createDraft, editDraft, submit, bulkSubmit, reviewAction, adminOverride, adminRestoreSubmission,
  adjustScore, listAdjustable, finalizeCampaignSubmissions,
};
