'use strict';

// PHF HR — Competition V1.6 · Admin Control Tower read-only views.
//
// "Toàn bộ bài dự thi" (adminListAllSubmissions) and its history drill-down
// (adminGetSubmissionHistory) are the ONLY places in Competition that reveal
// full submission identity (author + assigned reviewer + actual reviewer
// actor) together with the complete, unfiltered submission_history. Both are
// admin-only (requireCompetitionAdmin) — mirrors the identity-reveal
// precedent already established in competition-leaderboard.js's
// identityMode==='admin' branch and screenAdminApproval's reviewer matrix.
//
// Bounded reads only: adminListAllSubmissions is paginated (limit capped at
// 100) and never fetches a whole campaign's lifetime dataset in one call.
// No N+1: assigned-reviewer + actual-reviewer-actor are resolved via
// LEFT JOIN / LATERAL in the SAME query, not one extra query per row.

const { readTx, cErr } = require('./competition-common');
const { resolveAuthority, requireCompetitionAdmin } = require('./competition-permissions');

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 100;

// Genuine reviewer-decision actions — SAME 4-value set myReviewedHistory()
// filters reviewer-facing history on (see competition-review.js). Reused
// here only to identify "who actually processed this", never to restrict
// what the admin sees in adminGetSubmissionHistory (which is unfiltered).
const REVIEW_ACTIONS = ['approve', 'upgrade', 'revision_requested', 'reject'];

// Status-category -> extra SQL predicate (appended with AND). `topLevel` is
// the campaign's max configured approval_levels.level_order, resolved once
// per call — never hardcoded 2, so a future campaign with more levels still
// categorizes correctly ("Đã duyệt 2 điểm" = base/level 1, "Đã duyệt 5 điểm"
// = the campaign's top level; a campaign with only one level then has no
// rows in the "5 điểm" bucket, which is correct, not a bug).
function statusPredicate(category) {
  switch (String(category || 'all')) {
    case 'pending': return { sql: `s.status = 'submitted'`, params: [] };
    case 'needs_revision': return { sql: `s.status = 'needs_revision'`, params: [] };
    case 'approved_low': return { sql: `s.status = 'approved' AND s.current_level_order = 1`, params: [] };
    case 'approved_high': return { sql: `s.status = 'approved' AND s.current_level_order = $TOPLEVEL`, params: [] };
    case 'zero': return { sql: `s.effective_score = 0`, params: [] };
    case 'rejected': return { sql: `s.status = 'rejected'`, params: [] };
    // Filter V1 — 'finalized' is a real, pre-existing s.status value the old
    // 7-tab set never exposed a filter for (only visible mixed into 'all').
    case 'finalized': return { sql: `s.status = 'finalized'`, params: [] };
    case 'all': default: return { sql: '', params: [] };
  }
}

// Filter V1 — admin "Toàn bộ bài dự thi" server-side filters, additive to the
// existing campaign_id + status predicate. Every value is bound as a query
// parameter (never string-concatenated into SQL) and every sortable column
// comes from a fixed allow-list — no user-controlled identifier ever reaches
// ORDER BY/column position. Keyword search targets ONLY fields already shown
// on this admin-only, already-deanonymized screen (author name/code +
// payload.customer_question/answer/actual_result — the real jsonb keys
// confirmed on phf_hr prod, not invented ones).
const ADMIN_ALL_SORTS = {
  // default = byte-identical to the pre-filter behavior (ORDER BY s.updated_at DESC)
  default: 's.updated_at DESC, s.id DESC',
  newest: 's.submitted_at DESC NULLS LAST, s.id DESC',
  oldest: 's.submitted_at ASC NULLS LAST, s.id ASC',
  score_desc: 's.effective_score DESC NULLS LAST, s.submitted_at DESC NULLS LAST, s.id DESC',
  similar_desc: 'COALESCE(occ.occurrence_count, 0) DESC, s.submitted_at DESC NULLS LAST, s.id DESC',
};

function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, (c) => '\\' + c);
}

function buildAdminAllFilters(params, startIdx) {
  const clauses = [];
  const values = [];
  let i = startIdx;
  const department = cleanStr(params.department);
  if (department) { clauses.push(`s.author_department_snapshot ILIKE $${i++} ESCAPE '\\'`); values.push('%' + escapeLike(department) + '%'); }
  const branch = cleanStr(params.branch);
  if (branch) { clauses.push(`s.author_branch_snapshot ILIKE $${i++} ESCAPE '\\'`); values.push('%' + escapeLike(branch) + '%'); }
  const employeeQuery = cleanStr(params.employeeQuery);
  if (employeeQuery) {
    clauses.push(`(s.author_employee_code ILIKE $${i} ESCAPE '\\' OR s.author_display_name_snapshot ILIKE $${i} ESCAPE '\\')`);
    values.push('%' + escapeLike(employeeQuery) + '%'); i++;
  }
  const levelOrder = params.levelOrder == null ? null : Number(params.levelOrder);
  if (levelOrder != null && Number.isFinite(levelOrder)) { clauses.push(`s.current_level_order = $${i++}`); values.push(levelOrder); }
  if (params.hasSimilar === true) { clauses.push(`COALESCE(occ.occurrence_count, 0) > 0`); }
  else if (params.hasSimilar === false) { clauses.push(`COALESCE(occ.occurrence_count, 0) = 0`); }
  const dateFrom = parseDateBoundary(params.dateFrom, false);
  if (dateFrom) { clauses.push(`s.submitted_at >= $${i++}`); values.push(dateFrom); }
  const dateTo = parseDateBoundary(params.dateTo, true);
  if (dateTo) { clauses.push(`s.submitted_at <= $${i++}`); values.push(dateTo); }
  const keyword = cleanStr(params.keyword);
  if (keyword) {
    clauses.push(`(s.author_display_name_snapshot ILIKE $${i} ESCAPE '\\' OR s.author_employee_code ILIKE $${i} ESCAPE '\\'
                    OR (s.payload->>'customer_question') ILIKE $${i} ESCAPE '\\'
                    OR (s.payload->>'answer') ILIKE $${i} ESCAPE '\\'
                    OR (s.payload->>'actual_result') ILIKE $${i} ESCAPE '\\')`);
    values.push('%' + escapeLike(keyword) + '%'); i++;
  }
  return { sql: clauses.length ? ' AND ' + clauses.join(' AND ') : '', values, nextIdx: i };
}

function cleanStr(v) {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? null : s;
}

// Accepts 'YYYY-MM-DD' or a full ISO timestamp; invalid input is ignored
// (treated as "no bound"), never thrown into the query as a raw string.
function parseDateBoundary(v, endOfDay) {
  const s = cleanStr(v);
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? (s + (endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z')) : s;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function submissionAdminView(r) {
  const effectiveScore = r.effective_score != null ? Number(r.effective_score)
    : (r.current_score == null ? null : Number(r.current_score));
  return {
    id: r.id,
    authorAccountId: r.author_account_id,
    authorEmployeeCode: r.author_employee_code,
    authorDisplayName: r.author_display_name_snapshot,
    authorDepartment: r.author_department_snapshot,
    authorBranch: r.author_branch_snapshot,
    payload: r.payload,
    status: r.status,
    currentLevelOrder: r.current_level_order,
    currentScore: r.current_score == null ? null : Number(r.current_score),
    effectiveScore, adjusted: r.effective_score != null,
    similarCount: r.occurrence_count == null ? 0 : Number(r.occurrence_count),
    lastReviewNote: r.last_review_note,
    submittedAt: r.submitted_at, approvedAt: r.approved_at, rejectedAt: r.rejected_at, finalizedAt: r.finalized_at,
    rowVersion: r.row_version,
    assignedReviewer: (r.assigned_reviewer_account_id || r.assigned_reviewer_employee_code) ? {
      accountId: r.assigned_reviewer_account_id, employeeCode: r.assigned_reviewer_employee_code,
      displayName: r.assigned_reviewer_display_name, tier: r.assigned_reviewer_tier,
    } : null,
    actualReviewerActor: (r.actual_actor_account_id || r.actual_actor_employee_code) ? {
      accountId: r.actual_actor_account_id, employeeCode: r.actual_actor_employee_code,
      displayName: r.actual_actor_display_name, action: r.actual_action, at: r.actual_at,
    } : null,
  };
}

async function adminListAllSubmissions(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  requireCompetitionAdmin(auth);
  const campaignId = String(params.campaignId || '');
  if (!campaignId) throw cErr('COMPETITION_CAMPAIGN_REQUIRED', 'Thiếu chương trình.', 400);

  const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, Number(params.limit) || PAGE_SIZE_DEFAULT));
  const offset = Math.max(0, Number(params.offset) || 0);

  return readTx(config, async (client) => {
    const topR = await client.query('SELECT max(level_order) m FROM competition.approval_levels WHERE campaign_id = $1', [campaignId]);
    const topLevel = topR.rows[0].m || 1;

    const pred = statusPredicate(params.status);
    const statusSql = pred.sql ? ' AND ' + pred.sql.replace('$TOPLEVEL', String(topLevel)) : '';
    // Filter V1 — additive filters start binding at $5 (params 1-4 are the
    // pre-existing campaignId/limit/offset/REVIEW_ACTIONS). The count query
    // has none of those 3 extra params, so its own filter fragment is built
    // SEPARATELY starting at $2 — Postgres' extended protocol requires the
    // bind array to exactly match the placeholders a given query text
    // actually references, so the two queries can never share one filt.values.
    const filt = buildAdminAllFilters(params, 5);
    const filtCount = buildAdminAllFilters(params, 2);
    const extraSql = statusSql + filt.sql;
    const extraSqlCount = statusSql + filtCount.sql;
    const sortKey = ADMIN_ALL_SORTS[String(params.sort || 'default')] ? String(params.sort || 'default') : 'default';
    const orderSql = ADMIN_ALL_SORTS[sortKey];

    // occurrence_count is needed both for the hasSimilar filter and the
    // similar_desc sort, computed once as a LEFT JOIN subquery (no N+1: one
    // extra indexed join, not one query per row).
    const occJoin = `LEFT JOIN (
           SELECT source_submission_id, count(*)::int occurrence_count
             FROM competition.submission_occurrences
            GROUP BY source_submission_id
         ) occ ON occ.source_submission_id = s.id`;

    const r = await client.query(
      `SELECT s.*, COALESCE(occ.occurrence_count, 0) AS occurrence_count,
              ra.reviewer_account_id AS assigned_reviewer_account_id,
              ra.reviewer_employee_code AS assigned_reviewer_employee_code,
              ra.tier AS assigned_reviewer_tier,
              rg.display_name AS assigned_reviewer_display_name,
              hist.actor_account_id AS actual_actor_account_id,
              hist.actor_employee_code AS actual_actor_employee_code,
              hist.actor_display_name AS actual_actor_display_name,
              hist.action AS actual_action,
              hist.at AS actual_at
         FROM competition.submissions s
         ${occJoin}
         LEFT JOIN LATERAL (
           SELECT reviewer_account_id, reviewer_employee_code, tier
             FROM competition.review_assignments
            WHERE submission_id = s.id AND is_active
            ORDER BY assigned_at DESC LIMIT 1
         ) ra ON true
         LEFT JOIN competition.reviewer_grants rg
           ON rg.campaign_id = s.campaign_id AND rg.is_active
          AND ( (ra.reviewer_account_id <> '' AND rg.account_id = ra.reviewer_account_id)
             OR (ra.reviewer_employee_code <> '' AND rg.employee_code = ra.reviewer_employee_code) )
         LEFT JOIN LATERAL (
           SELECT actor_account_id, actor_employee_code, actor_display_name, action, at
             FROM competition.submission_history
            WHERE submission_id = s.id AND action = ANY($4::text[])
            ORDER BY at DESC LIMIT 1
         ) hist ON true
        WHERE s.campaign_id = $1 ${extraSql}
        ORDER BY ${orderSql}
        LIMIT $2 OFFSET $3`,
      [campaignId, limit, offset, REVIEW_ACTIONS, ...filt.values]);

    const countR = await client.query(
      `SELECT count(*)::int n FROM competition.submissions s ${occJoin} WHERE s.campaign_id = $1 ${extraSqlCount}`,
      [campaignId, ...filtCount.values]);

    return {
      items: r.rows.map(submissionAdminView),
      total: countR.rows[0].n,
      limit, offset,
    };
  });
}

async function adminGetSubmissionHistory(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  requireCompetitionAdmin(auth);
  const submissionId = String(params.submissionId || '');
  if (!submissionId) throw cErr('COMPETITION_SUBMISSION_REQUIRED', 'Thiếu bài dự thi.', 400);

  return readTx(config, async (client) => {
    const sub = await client.query('SELECT id, campaign_id FROM competition.submissions WHERE id = $1', [submissionId]);
    if (!sub.rowCount) throw cErr('COMPETITION_SUBMISSION_NOT_FOUND', 'Không tìm thấy bài.', 404);
    if (params.campaignId && sub.rows[0].campaign_id !== params.campaignId) {
      throw cErr('COMPETITION_CAMPAIGN_MISMATCH', 'Sai chương trình.', 400);
    }
    // full, unfiltered, real-identity history — admin-only view, unlike
    // myReviewedHistory() which is reviewer-facing and deliberately narrowed.
    const r = await client.query(
      `SELECT id, action, actor_account_id, actor_employee_code, actor_display_name,
              before, after, reason, at
         FROM competition.submission_history
        WHERE submission_id = $1
        ORDER BY at ASC`,
      [submissionId]);
    return {
      submissionId,
      items: r.rows.map((x) => ({
        id: x.id, action: x.action,
        actorAccountId: x.actor_account_id, actorEmployeeCode: x.actor_employee_code, actorDisplayName: x.actor_display_name,
        before: x.before, after: x.after, reason: x.reason, at: x.at,
      })),
    };
  });
}

module.exports = { adminListAllSubmissions, adminGetSubmissionHistory, REVIEW_ACTIONS };
