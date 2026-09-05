'use strict';

// PHF HR — Competition V1.1 · DB-facing layer for the NO-AI similarity
// suggestion + "Tôi cũng gặp" occurrence signal. Pure scoring lives in
// ./competition-similarity.js; this file only fetches bounded candidate
// sets and shapes server responses (sender-safe vs reviewer-safe).

const { readTx, writeTx, cErr, auditActor, isSamePerson, cleanText } = require('./competition-common');
const { resolveAuthority } = require('./competition-permissions');
const sim = require('./competition-similarity');

// Candidate pool is bounded and Competition-scoped: same campaign only,
// only submissions that actually entered review (never draft/rejected —
// LOCKED scope rule), newest first, hard LIMIT so cost stays flat even if a
// campaign accumulates many months of history in one row.
const CANDIDATE_STATUSES = ['submitted', 'needs_revision', 'approved', 'finalized'];
const CANDIDATE_FETCH_LIMIT = 300;
const TOP_N = 3;

async function fetchCandidates(client, { campaignId, excludeSubmissionId }) {
  const r = await client.query(
    `SELECT id, payload->>'customer_question' AS question, payload->>'answer' AS answer,
            submitted_at, author_account_id, author_employee_code
       FROM competition.submissions
      WHERE campaign_id = $1
        AND status = ANY($2::text[])
        AND ($3::uuid IS NULL OR id <> $3)
      ORDER BY submitted_at DESC NULLS LAST
      LIMIT $4`,
    [campaignId, CANDIDATE_STATUSES, excludeSubmissionId || null, CANDIDATE_FETCH_LIMIT]);
  return r.rows.map((x) => ({
    id: x.id, question: x.question || '', answer: x.answer || '',
    submittedAt: x.submitted_at, authorAccountId: x.author_account_id, authorEmployeeCode: x.author_employee_code,
  }));
}

async function occurrenceCounts(client, submissionIds) {
  if (!submissionIds.length) return new Map();
  const r = await client.query(
    `SELECT source_submission_id, count(*)::int AS n
       FROM competition.submission_occurrences
      WHERE source_submission_id = ANY($1::uuid[])
      GROUP BY source_submission_id`,
    [submissionIds]);
  const m = new Map();
  r.rows.forEach((x) => m.set(x.source_submission_id, x.n));
  return m;
}

// ---- SENDER pre-submit check --------------------------------------------
// Never exposes: candidate answer text, candidate author identity. Only
// what a participant needs to make an honest "same situation?" judgement.
async function checkSimilarityForSubmit(config, actor, params) {
  const campaignId = params.campaignId || params.campaign_id;
  const question = cleanText(params.question) || '';
  const answer = cleanText(params.answer) || '';
  if (!campaignId) throw cErr('COMPETITION_CAMPAIGN_REQUIRED', 'Thiếu chương trình.', 400);
  if (!question && !answer) return { hasSimilar: false, candidates: [] };

  return readTx(config, async (client) => {
    const pool = await fetchCandidates(client, {
      campaignId, excludeSubmissionId: params.excludeSubmissionId || params.submissionId || null,
    });
    // a participant's own earlier/other submissions are not "someone else
    // already reported this" against themselves.
    const others = pool.filter((c) => !isSamePerson(actor, c.authorAccountId, c.authorEmployeeCode));
    const top = sim.rankCandidates(question, answer, others, TOP_N);
    return {
      hasSimilar: top.length > 0,
      candidates: top.map((c) => ({
        // the submission id is an opaque record key, not an identity — safe
        // to return as-is; the client needs it to call confirmOccurrence.
        submissionRef: c.id,
        questionExcerpt: c.question.slice(0, 160),
        submittedAt: c.submittedAt,
        submittedBeforeYou: true, // candidate pool is always already-submitted content
        questionLabel: c.questionLabel, answerLabel: c.answerLabel,
      })),
    };
  });
}

// ---- REVIEWER warning (on-demand expand of one queue item) --------------
// Reviewer already sees anonymous question+answer content by design
// (competition.review.queue) — this stays consistent: candidate question AND
// answer are shown, author identity never is.
async function getSimilarForReview(config, actor, params) {
  const submissionId = params.submissionId;
  if (!submissionId) throw cErr('COMPETITION_SUBMISSION_REQUIRED', 'Thiếu bài cần xem.', 400);

  const target = await readTx(config, async (client) => {
    const t = await client.query(
      `SELECT id, campaign_id, author_account_id, author_employee_code, submitted_at,
              payload->>'customer_question' AS question, payload->>'answer' AS answer
         FROM competition.submissions WHERE id = $1`, [submissionId]);
    if (!t.rowCount) throw cErr('COMPETITION_SUBMISSION_NOT_FOUND', 'Không tìm thấy bài.', 404);
    return t.rows[0];
  });

  const auth = await resolveAuthority(config, actor, target.campaign_id);
  if (!auth.canReview) throw cErr('COMPETITION_NOT_A_REVIEWER', 'Bạn không có quyền duyệt.', 403);
  if (isSamePerson(actor, target.author_account_id, target.author_employee_code)) {
    throw cErr('COMPETITION_SELF_REVIEW_BLOCKED', 'Không thể tự duyệt bài của mình.', 403);
  }

  return readTx(config, async (client) => {
    const pool = await fetchCandidates(client, { campaignId: target.campaign_id, excludeSubmissionId: submissionId });
    const top = sim.rankCandidates(target.question || '', target.answer || '', pool, TOP_N);
    const counts = await occurrenceCounts(client, top.map((c) => c.id));
    return {
      candidates: top.map((c) => ({
        submissionRef: c.id,
        question: c.question, answer: c.answer,
        submittedAt: c.submittedAt,
        relationship: (c.submittedAt && target.submitted_at && new Date(c.submittedAt) < new Date(target.submitted_at))
          ? 'before' : 'after',
        questionLabel: c.questionLabel, answerLabel: c.answerLabel,
        occurrenceCount: counts.get(c.id) || 0,
      })),
    };
  });
}

// Batch augmentation for the review QUEUE list (one shared candidate fetch,
// in-process scoring per item — NOT a separate DB round trip per row). Only
// a boolean + count is attached here; full candidate content is fetched
// lazily via getSimilarForReview when a reviewer actually expands a row.
async function attachQueueSimilarityFlags(config, queueResult, campaignId) {
  if (!queueResult || !Array.isArray(queueResult.items) || !queueResult.items.length) return queueResult;
  return readTx(config, async (client) => {
    const pool = await fetchCandidates(client, { campaignId, excludeSubmissionId: null });
    queueResult.items = queueResult.items.map((item) => {
      const others = pool.filter((c) => c.id !== item.submissionRef);
      const q = (item.payload && item.payload.customer_question) || '';
      const a = (item.payload && item.payload.answer) || '';
      const top = sim.rankCandidates(q, a, others, TOP_N);
      return Object.assign({}, item, { hasSimilar: top.length > 0, similarCount: top.length });
    });
    return queueResult;
  });
}

// ---- "Tôi cũng gặp tình huống này" occurrence -----------------------------
// Records a frequency signal ONLY. Never creates a competition.submissions
// row, never touches score/leaderboard/awards (LOCKED).
async function confirmOccurrence(config, actor, params) {
  const sourceSubmissionId = params.sourceSubmissionId || params.source_submission_id;
  const campaignId = params.campaignId || params.campaign_id;
  if (!sourceSubmissionId || !campaignId) throw cErr('COMPETITION_OCCURRENCE_TARGET_REQUIRED', 'Thiếu bài gốc cần ghi nhận.', 400);
  const aa = auditActor(actor);

  return writeTx(config, async (client) => {
    const src = await client.query(
      `SELECT id, campaign_id, status, author_account_id, author_employee_code
         FROM competition.submissions WHERE id = $1 FOR UPDATE`, [sourceSubmissionId]);
    if (!src.rowCount) throw cErr('COMPETITION_SUBMISSION_NOT_FOUND', 'Không tìm thấy bài.', 404);
    const row = src.rows[0];
    if (row.campaign_id !== campaignId) throw cErr('COMPETITION_CAMPAIGN_MISMATCH', 'Sai chương trình.', 400);
    if (!CANDIDATE_STATUSES.includes(row.status)) {
      throw cErr('COMPETITION_OCCURRENCE_TARGET_NOT_ELIGIBLE', 'Bài này chưa được gửi chính thức.', 409);
    }
    if (isSamePerson(actor, row.author_account_id, row.author_employee_code)) {
      throw cErr('COMPETITION_OCCURRENCE_SELF_NOT_ALLOWED', 'Không thể tự ghi nhận cho bài của chính mình.', 403);
    }

    const ins = await client.query(
      `INSERT INTO competition.submission_occurrences (campaign_id, source_submission_id, account_id, employee_code)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (source_submission_id, account_id) DO NOTHING
       RETURNING id`,
      [campaignId, sourceSubmissionId, aa.account_id || ('ACC_' + aa.employee_code), aa.employee_code || ('EMP_' + aa.account_id)]);

    const cnt = await client.query(
      `SELECT count(*)::int n FROM competition.submission_occurrences WHERE source_submission_id = $1`,
      [sourceSubmissionId]);
    return { alreadyConfirmed: ins.rowCount === 0, occurrenceCount: cnt.rows[0].n };
  });
}

async function getOccurrenceCount(config, actor, params) {
  const submissionId = params.submissionId;
  if (!submissionId) throw cErr('COMPETITION_SUBMISSION_REQUIRED', 'Thiếu bài cần xem.', 400);
  return readTx(config, async (client) => {
    const r = await client.query(
      `SELECT count(*)::int n FROM competition.submission_occurrences WHERE source_submission_id = $1`,
      [submissionId]);
    return { occurrenceCount: r.rows[0].n };
  });
}

module.exports = {
  CANDIDATE_STATUSES, CANDIDATE_FETCH_LIMIT, TOP_N,
  checkSimilarityForSubmit, getSimilarForReview, attachQueueSimilarityFlags,
  confirmOccurrence, getOccurrenceCount,
};
