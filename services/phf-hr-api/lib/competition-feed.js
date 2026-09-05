'use strict';

// PHF HR — Competition V1 · anonymous feed + reactions ("thả tim").
//
// Feed shows ONLY approved / finalized submissions. While the campaign is not
// published, the author is shown by alias only — no real identity. After
// finalize + publish, real names may be revealed. Rejected / submitted /
// needs_revision never appear. A lower->higher upgrade keeps the same feed
// post (it is the same submission row).
//
// Reactions never touch score / leaderboard / awards / approval level — there
// is no column or FK linking them.

const { readTx, writeTx, cErr, auditActor } = require('./competition-common');

async function getFeed(config, actor, params) {
  const campaignId = params.campaignId;
  return readTx(config, async (client) => {
    const c = await client.query('SELECT status, publication_state FROM competition.campaigns WHERE id = $1', [campaignId]);
    if (!c.rowCount) throw cErr('COMPETITION_CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình.', 404);
    const published = c.rows[0].publication_state === 'published';

    const rows = await client.query(
      `SELECT s.id, s.payload, s.current_level_order, s.current_score, s.submitted_at, s.status,
              al.name AS level_name,
              pa.alias,
              CASE WHEN $2::boolean THEN s.author_display_name_snapshot ELSE NULL END AS revealed_name,
              ( SELECT count(*) FROM competition.reactions r WHERE r.submission_id = s.id AND r.is_active ) AS reaction_total,
              EXISTS ( SELECT 1 FROM competition.reactions r
                        WHERE r.submission_id = s.id AND r.is_active
                          AND ( ($3 <> '' AND r.account_id = $3) OR ($4 <> '' AND r.employee_code = $4) ) ) AS viewer_reacted
         FROM competition.submissions s
         LEFT JOIN competition.approval_levels al ON al.campaign_id = s.campaign_id AND al.level_order = s.current_level_order
         LEFT JOIN competition.participant_aliases pa ON pa.campaign_id = s.campaign_id
               AND pa.account_id = s.author_account_id
        WHERE s.campaign_id = $1 AND s.status IN ('approved','finalized')
        ORDER BY COALESCE(s.approved_at, s.submitted_at) DESC`,
      [campaignId, published, actor.accountId || '', actor.employeeCode || '']);

    return {
      campaignStatus: c.rows[0].status,
      published,
      posts: rows.rows.map((x) => ({
        submissionId: x.id,
        anonAlias: x.alias || 'Người tham gia',
        authorName: x.revealed_name || null,     // null unless published
        payload: x.payload,
        approvalLevel: x.current_level_order,
        approvalLevelName: x.level_name,
        currentScore: x.current_score == null ? null : Number(x.current_score),
        reactionTotal: Number(x.reaction_total),
        viewerReacted: x.viewer_reacted,
        submittedAt: x.submitted_at,
        status: x.status,
      })),
    };
  });
}

async function setReaction(config, actor, params) {
  const on = params.on !== false;
  const aa = auditActor(actor);
  const acc = aa.account_id || ('ACC_' + aa.employee_code);
  const emp = aa.employee_code || ('EMP_' + aa.account_id);
  return writeTx(config, async (client) => {
    const s = await client.query('SELECT id, status FROM competition.submissions WHERE id = $1', [params.submissionId]);
    if (!s.rowCount) throw cErr('COMPETITION_SUBMISSION_NOT_FOUND', 'Không tìm thấy bài.', 404);
    if (!['approved', 'finalized'].includes(s.rows[0].status)) {
      throw cErr('COMPETITION_REACTION_NOT_ALLOWED', 'Chỉ thả tim cho bài đã duyệt.', 409);
    }
    if (on) {
      await client.query(
        `INSERT INTO competition.reactions (submission_id, account_id, employee_code, is_active)
         VALUES ($1,$2,$3,true)
         ON CONFLICT (submission_id, account_id) WHERE is_active DO NOTHING`,
        [params.submissionId, acc, emp]);
    } else {
      await client.query(
        `UPDATE competition.reactions SET is_active = false
          WHERE submission_id = $1 AND account_id = $2 AND is_active`,
        [params.submissionId, acc]);
    }
    const total = await client.query(
      'SELECT count(*)::int n FROM competition.reactions WHERE submission_id = $1 AND is_active', [params.submissionId]);
    return { submissionId: params.submissionId, reactionTotal: total.rows[0].n, viewerReacted: on };
  });
}

module.exports = { getFeed, setReaction };
