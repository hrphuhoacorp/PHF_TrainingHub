'use strict';

// PHF HR — Competition V1 · authoritative permission resolution (server-side).
//
// Permission contract V1 (LOCKED):
//   Participant  — implicit for any eligible active identity. No grant table.
//   Reviewer     — competition.reviewer_grants: max_level_order per campaign.
//                  A reviewer at level N may act on ANY target level <= N and
//                  may upgrade a lower-approved submission up to N.
//   Comp Admin   — system PHF admin (systemRole === 'admin') OR an active row
//                  in competition.admin_grants. Sees everything; may override /
//                  reassign / reopen (audited); may NOT approve own submission.
//   Capability   — competition.capability_grants: 'view_participation_progress'
//                  is company-wide, grants no reviewer rights, effective now.
//
// This module only READS grant state. It never writes. Callers pass the result
// into the write modules, which re-check the specific authority they need.

const { readTx, cErr } = require('./competition-common');

// Resolve the actor's Competition authority for a given campaign (campaignId
// optional — omit for module-wide checks like admin/capability).
async function resolveAuthority(config, actor, campaignId) {
  return readTx(config, async (client) => {
    const isSystemAdmin = actor.systemRole === 'admin';

    // Competition Admin: system admin implicit, else an active grant row.
    let isCompetitionAdmin = isSystemAdmin;
    if (!isCompetitionAdmin && (actor.accountId || actor.employeeCode)) {
      const r = await client.query(
        `SELECT 1 FROM competition.admin_grants
          WHERE is_active
            AND ( ($1 <> '' AND account_id = $1) OR ($2 <> '' AND employee_code = $2) )
          LIMIT 1`,
        [actor.accountId || '', actor.employeeCode || '']);
      isCompetitionAdmin = r.rowCount > 0;
    }

    // Capability grants (module-wide).
    const capRows = await client.query(
      `SELECT DISTINCT capability FROM competition.capability_grants
        WHERE is_active
          AND ( ($1 <> '' AND account_id = $1) OR ($2 <> '' AND employee_code = $2) )`,
      [actor.accountId || '', actor.employeeCode || '']);
    const capabilities = {
      viewParticipationProgress:
        isCompetitionAdmin || capRows.rows.some((x) => x.capability === 'view_participation_progress'),
    };

    // Reviewer max level for this campaign (if campaignId given).
    let reviewerMaxLevel = null;
    if (campaignId) {
      const r = await client.query(
        `SELECT max_level_order FROM competition.reviewer_grants
          WHERE campaign_id = $1 AND is_active
            AND ( ($2 <> '' AND account_id = $2) OR ($3 <> '' AND employee_code = $3) )
          ORDER BY max_level_order DESC LIMIT 1`,
        [campaignId, actor.accountId || '', actor.employeeCode || '']);
      if (r.rowCount > 0) reviewerMaxLevel = r.rows[0].max_level_order;
    }

    return {
      isSystemAdmin,
      isCompetitionAdmin,
      reviewerMaxLevel,               // null = not a reviewer for this campaign
      isReviewer: reviewerMaxLevel != null,
      capabilities,
      canAdmin: isCompetitionAdmin,
      canReview: reviewerMaxLevel != null || isCompetitionAdmin,
      canSubmit: true,                // any eligible active identity (Vercel gate)
    };
  });
}

function requireCompetitionAdmin(authority) {
  if (!authority.isCompetitionAdmin) {
    throw cErr('COMPETITION_ADMIN_REQUIRED', 'Chức năng này chỉ dành cho Competition Admin.', 403);
  }
}

// A reviewer (or admin) may act on targetLevel iff targetLevel <= their max.
// Admin acts as an unbounded reviewer for intervention, but still cannot
// self-review (checked separately, in the write path).
function assertReviewerCanActOnLevel(authority, targetLevelOrder) {
  if (authority.isCompetitionAdmin) return;
  if (authority.reviewerMaxLevel == null) {
    throw cErr('COMPETITION_NOT_A_REVIEWER', 'Bạn không phải người duyệt của chương trình này.', 403);
  }
  if (Number(targetLevelOrder) > Number(authority.reviewerMaxLevel)) {
    throw cErr('COMPETITION_REVIEW_LEVEL_TOO_HIGH',
      'Bạn chỉ được duyệt tới mức ' + authority.reviewerMaxLevel + '.', 403);
  }
}

module.exports = { resolveAuthority, requireCompetitionAdmin, assertReviewerCanActOnLevel };
