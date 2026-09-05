'use strict';

// PHF HR — Competition V1 · award read/selection logic (NOT payroll).
//
// Auto award (default 500,000 VND): from the authoritative leaderboard rank 1.
// Value award (default 1,000,000 VND): PHF picks from Top N (3/5).
// Rules:
//   - one person cannot hold two CONFIRMED awards in a campaign (DB partial
//     unique competition.awards WHERE status='confirmed' on (campaign, recipient)
//     is the backstop).
//   - if the auto winner is also given the value award, the 500k auto moves to
//     the next eligible participant (supersede + reassign_next_eligible).
// Auto tie-break: (1) more high-level approved submissions, (2) earlier
// qualifying approval time, (3) Competition Admin decision + reason (audited).

const { readTx, writeTx, cErr, auditActor } = require('./competition-common');
const { resolveAuthority, requireCompetitionAdmin } = require('./competition-permissions');
const { computeRows } = require('./competition-leaderboard');

const DEFAULT_AUTO_VND = 500000;
const DEFAULT_VALUE_VND = 1000000;

// rank the leaderboard rows for AUTO selection with the tie-break applied.
function orderForAuto(rows) {
  return rows.slice().sort((a, b) => {
    if (Number(b.total_score) !== Number(a.total_score)) return Number(b.total_score) - Number(a.total_score);
    if (Number(b.high_count) !== Number(a.high_count)) return Number(b.high_count) - Number(a.high_count);
    const ta = a.earliest_approved ? new Date(a.earliest_approved).getTime() : Infinity;
    const tb = b.earliest_approved ? new Date(b.earliest_approved).getTime() : Infinity;
    if (ta !== tb) return ta - tb;
    return 0; // still tied -> needs admin decision
  });
}

async function computeAutoCandidate(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  requireCompetitionAdmin(auth);
  return readTx(config, async (client) => {
    const rows = await computeRows(client, params.campaignId);
    if (!rows.length) return { candidate: null, tie: [], topN: [] };
    const ordered = orderForAuto(rows);
    const top = ordered[0];
    // who is genuinely tied with the top after all deterministic tie-breaks?
    const tie = ordered.filter((x) =>
      Number(x.total_score) === Number(top.total_score) &&
      Number(x.high_count) === Number(top.high_count) &&
      String(x.earliest_approved) === String(top.earliest_approved));
    return {
      candidate: {
        accountId: top.author_account_id, employeeCode: top.author_employee_code,
        displayName: top.display_name, alias: top.alias,
        totalScore: Number(top.total_score), highLevelCount: Number(top.high_count),
        earliestApproved: top.earliest_approved,
      },
      needsAdminDecision: tie.length > 1,
      tie: tie.map((x) => ({ employeeCode: x.author_employee_code, displayName: x.display_name, totalScore: Number(x.total_score) })),
      topN: ordered.slice(0, params.topN || 5).map((x, i) => ({
        rank: i + 1, accountId: x.author_account_id, employeeCode: x.author_employee_code,
        displayName: x.display_name, totalScore: Number(x.total_score),
      })),
    };
  });
}

async function listAwards(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  requireCompetitionAdmin(auth);
  return readTx(config, async (client) => {
    const r = await client.query(
      `SELECT * FROM competition.awards WHERE campaign_id = $1 ORDER BY award_type, decided_at`, [params.campaignId]);
    return r.rows.map((x) => ({
      id: x.id, awardType: x.award_type, amountVnd: Number(x.amount_vnd), status: x.status,
      recipientEmployeeCode: x.recipient_employee_code, recipientDisplayName: x.recipient_display_name_snapshot,
      rankBasis: x.rank_basis, selectionReason: x.selection_reason,
      tiebreakApplied: x.tiebreak_applied, tiebreakReason: x.tiebreak_reason, supersededBy: x.superseded_by,
    }));
  });
}

async function proposeAward(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  requireCompetitionAdmin(auth);
  const awardType = String(params.awardType || '');
  if (!['auto', 'value'].includes(awardType)) throw cErr('COMPETITION_AWARD_TYPE_INVALID', 'Loại giải không hợp lệ.', 400);
  const aa = auditActor(actor);
  const amount = Number(params.amountVnd || (awardType === 'auto' ? DEFAULT_AUTO_VND : DEFAULT_VALUE_VND));
  const reason = params.selectionReason ? String(params.selectionReason) : null;
  if (awardType === 'value' && !reason) throw cErr('COMPETITION_AWARD_REASON_REQUIRED', 'Giải giá trị cần lý do lựa chọn.', 400);
  const tiebreakApplied = !!params.tiebreakApplied;
  const tiebreakReason = params.tiebreakReason ? String(params.tiebreakReason) : null;
  if (tiebreakApplied && !tiebreakReason) throw cErr('COMPETITION_TIEBREAK_REASON_REQUIRED', 'Quyết định phá thế hoà cần lý do.', 400);

  return writeTx(config, async (client) => {
    const c = await client.query('SELECT status FROM competition.campaigns WHERE id = $1', [params.campaignId]);
    if (!c.rowCount) throw cErr('COMPETITION_CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình.', 404);
    const r = await client.query(
      `INSERT INTO competition.awards
         (campaign_id, award_type, amount_vnd, rank_basis, recipient_account_id, recipient_employee_code,
          recipient_display_name_snapshot, status, selection_reason, tiebreak_applied, tiebreak_reason,
          decided_by_account_id, decided_by_employee_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'proposed',$8,$9,$10,$11,$12)
       RETURNING *`,
      [params.campaignId, awardType, amount, params.rankBasis == null ? null : Number(params.rankBasis),
       String(params.recipientAccountId || ''), String(params.recipientEmployeeCode || ''),
       params.recipientDisplayName || null, reason, tiebreakApplied, tiebreakReason, aa.account_id, aa.employee_code]);
    await awardHist(client, r.rows[0].id, params.campaignId, 'propose', aa, { award_type: awardType, amount }, reason);
    return { id: r.rows[0].id, awardType, amountVnd: amount, status: 'proposed' };
  });
}

async function confirmAward(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  requireCompetitionAdmin(auth);
  const aa = auditActor(actor);
  return writeTx(config, async (client) => {
    const cur = await client.query('SELECT * FROM competition.awards WHERE id = $1 AND campaign_id = $2 FOR UPDATE', [params.awardId, params.campaignId]);
    if (!cur.rowCount) throw cErr('COMPETITION_AWARD_NOT_FOUND', 'Không tìm thấy giải.', 404);
    const a = cur.rows[0];
    if (a.status !== 'proposed') throw cErr('COMPETITION_AWARD_NOT_PROPOSED', 'Giải không ở trạng thái đề xuất.', 409);

    // dual-award rule: does this recipient already hold a CONFIRMED award?
    const dup = await client.query(
      `SELECT * FROM competition.awards
        WHERE campaign_id = $1 AND recipient_account_id = $2 AND status = 'confirmed' FOR UPDATE`,
      [params.campaignId, a.recipient_account_id]);

    let nextEligible = null;
    if (dup.rowCount > 0) {
      const held = dup.rows[0];
      // "if auto winner receives 1M value award: 500k moves to next eligible"
      if (held.award_type === 'auto' && a.award_type === 'value') {
        await client.query(`UPDATE competition.awards SET status = 'superseded' WHERE id = $1`, [held.id]);
        await awardHist(client, held.id, params.campaignId, 'supersede', aa, { reason: 'recipient took the value award' }, 'auto moves to next eligible');
        // find next eligible auto recipient from leaderboard, skipping anyone
        // already holding a confirmed award (post-supersede)
        const rows = await computeRows(client, params.campaignId);
        const ordered = rows.slice().sort((x, y) => Number(y.total_score) - Number(x.total_score)
          || Number(y.high_count) - Number(x.high_count)
          || (new Date(x.earliest_approved || 0) - new Date(y.earliest_approved || 0)));
        const confirmedHolders = await client.query(
          `SELECT recipient_account_id FROM competition.awards WHERE campaign_id = $1 AND status = 'confirmed'`, [params.campaignId]);
        const blocked = new Set(confirmedHolders.rows.map((z) => z.recipient_account_id));
        blocked.add(a.recipient_account_id); // the person taking the value award
        const nextRow = ordered.find((z) => !blocked.has(z.author_account_id));
        if (nextRow) {
          const ins = await client.query(
            `INSERT INTO competition.awards
               (campaign_id, award_type, amount_vnd, rank_basis, recipient_account_id, recipient_employee_code,
                recipient_display_name_snapshot, status, selection_reason, decided_by_account_id, decided_by_employee_code)
             VALUES ($1,'auto',$2,$3,$4,$5,$6,'proposed','next eligible after auto winner took value award',$7,$8)
             RETURNING *`,
            [params.campaignId, Number(held.amount_vnd), null, nextRow.author_account_id, nextRow.author_employee_code,
             nextRow.display_name, aa.account_id, aa.employee_code]);
          await awardHist(client, ins.rows[0].id, params.campaignId, 'reassign_next_eligible', aa,
            { from: held.recipient_employee_code, to: nextRow.author_employee_code }, null);
          nextEligible = { awardId: ins.rows[0].id, recipientEmployeeCode: nextRow.author_employee_code, status: 'proposed' };
        }
      } else {
        throw cErr('COMPETITION_DUAL_AWARD_BLOCKED',
          'Người này đã nhận một giải đã xác nhận trong chương trình.', 409);
      }
    }

    const r = await client.query(`UPDATE competition.awards SET status = 'confirmed' WHERE id = $1 RETURNING *`, [a.id]);
    await awardHist(client, a.id, params.campaignId, 'confirm', aa, { award_type: a.award_type }, null);
    return { id: a.id, status: 'confirmed', awardType: a.award_type, nextEligibleAuto: nextEligible };
  });
}

async function revokeAward(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  requireCompetitionAdmin(auth);
  const aa = auditActor(actor);
  const reason = String(params.reason || '').trim();
  if (!reason) throw cErr('COMPETITION_AWARD_REASON_REQUIRED', 'Thu hồi giải cần lý do.', 400);
  return writeTx(config, async (client) => {
    const r = await client.query(
      `UPDATE competition.awards SET status = 'revoked' WHERE id = $1 AND campaign_id = $2 AND status IN ('proposed','confirmed') RETURNING *`,
      [params.awardId, params.campaignId]);
    if (!r.rowCount) throw cErr('COMPETITION_AWARD_NOT_FOUND', 'Không tìm thấy giải để thu hồi.', 404);
    await awardHist(client, params.awardId, params.campaignId, 'revoke', aa, {}, reason);
    return { id: params.awardId, status: 'revoked' };
  });
}

async function awardHist(client, awardId, campaignId, action, aa, after, reason) {
  await client.query(
    `INSERT INTO competition.award_history
       (award_id, campaign_id, action, actor_account_id, actor_employee_code, actor_display_name, after, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [awardId, campaignId, action, aa.account_id, aa.employee_code, aa.display_name, JSON.stringify(after || {}), reason]);
}

module.exports = {
  DEFAULT_AUTO_VND, DEFAULT_VALUE_VND, orderForAuto,
  computeAutoCandidate, listAwards, proposeAward, confirmAward, revokeAward,
};
