'use strict';

// PHF HR — Competition V1 · leaderboard.
//
// Score source: approved / finalized submissions only, using each submission's
// CURRENT level score (replacement, non-cumulative: a 2->5 upgrade contributes
// 5, not 7). Withdrawing an approval nulls current_score -> the row drops out.
// Equal total score => same rank (dense-ish: rank(), so ties share and the
// next rank skips).
//
// Views:
//   participant  — own row (real identity, marked isYou), others alias-only,
//                  NO competitor approved_count / department / branch.
//   privileged   — high-level reviewer: real identity + total score (still NOT
//                  per-submission author identity, still NOT competitor x/5).
//   admin        — full identity + approved_count.
//   public       — only when finalized + published: real identity.

const { readTx, cErr } = require('./competition-common');
const { resolveAuthority } = require('./competition-permissions');

async function computeRows(client, campaignId) {
  const r = await client.query(
    `WITH totals AS (
       SELECT s.author_account_id, s.author_employee_code,
              max(s.author_display_name_snapshot) AS display_name,
              count(*) FILTER (WHERE s.status IN ('approved','finalized'))                    AS approved_count,
              -- V1.3: high_count/total_score are what RANKS people (leaderboard +
              -- awards tiebreak) — a 0-adjusted submission (effective_score = 0,
              -- "Không ghi nhận") must drop out of BOTH, even though it stays
              -- status='approved' (audit truth, not a rejection).
              count(*) FILTER (WHERE s.status IN ('approved','finalized') AND s.current_level_order >= 2
                                AND COALESCE(s.effective_score, s.current_score, 0) > 0) AS high_count,
              COALESCE(sum(COALESCE(s.effective_score, s.current_score, 0)) FILTER (WHERE s.status IN ('approved','finalized')),0)::numeric AS total_score,
              min(s.first_approved_at) FILTER (WHERE s.status IN ('approved','finalized'))    AS earliest_approved
         FROM competition.submissions s
        WHERE s.campaign_id = $1
        GROUP BY s.author_account_id, s.author_employee_code
     )
     SELECT t.*, pa.alias,
            rank() OVER (ORDER BY t.total_score DESC) AS rnk
       FROM totals t
       LEFT JOIN competition.participant_aliases pa
         ON pa.campaign_id = $1 AND pa.account_id = t.author_account_id
      WHERE t.total_score > 0
      ORDER BY rnk, pa.alias NULLS LAST`,
    [campaignId]);
  return r.rows;
}

async function getLeaderboard(config, actor, params) {
  const campaignId = params.campaignId;
  const auth = await resolveAuthority(config, actor, campaignId);
  return readTx(config, async (client) => {
    const c = await client.query('SELECT status, publication_state FROM competition.campaigns WHERE id = $1', [campaignId]);
    if (!c.rowCount) throw cErr('COMPETITION_CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình.', 404);
    const published = c.rows[0].publication_state === 'published' && c.rows[0].status === 'finalized';

    const rows = await computeRows(client, campaignId);

    // highest-level reviewer for this campaign => privileged identity view
    const maxLevelR = await client.query('SELECT max(level_order) m FROM competition.approval_levels WHERE campaign_id = $1', [campaignId]);
    const topLevel = maxLevelR.rows[0].m || 1;
    const isPrivileged = auth.isCompetitionAdmin || (auth.reviewerMaxLevel != null && auth.reviewerMaxLevel >= topLevel);

    const identityMode = auth.isCompetitionAdmin ? 'admin'
      : published ? 'public'
        : isPrivileged ? 'privileged'
          : 'participant';

    const out = rows.map((x) => {
      const isYou = (actor.accountId && x.author_account_id === actor.accountId)
        || (actor.employeeCode && x.author_employee_code === actor.employeeCode);
      const base = { rank: Number(x.rnk), totalScore: Number(x.total_score), isYou: !!isYou };
      if (identityMode === 'admin') {
        return Object.assign(base, {
          displayName: x.display_name, employeeCode: x.author_employee_code,
          alias: x.alias, approvedCount: Number(x.approved_count), highLevelCount: Number(x.high_count),
        });
      }
      if (identityMode === 'public' || identityMode === 'privileged') {
        return Object.assign(base, { displayName: x.display_name || x.alias, alias: x.alias });
      }
      // participant view: your own real name, everyone else alias-only
      return Object.assign(base, {
        displayName: isYou ? (x.display_name || 'Bạn') : null,
        alias: isYou ? null : (x.alias || 'Người tham gia'),
      });
    });

    const you = out.find((x) => x.isYou) || null;
    return { identityMode, published, you, rows: out };
  });
}

module.exports = { getLeaderboard, computeRows };
