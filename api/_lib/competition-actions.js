'use strict';

// PHF HR — Competition V1 · Batch C2 action dispatcher.
//
// Shared by BOTH api/data.js (Vercel) and server.js (local :3000) so the two
// surfaces can never drift — each just does:
//   const competitionDispatch = await dispatchCompetitionAction(session, payload);
//   if (competitionDispatch.handled) return <sendJson>(res, 200, {ok:true, result: competitionDispatch.result});
//
// Every handler here:
//   1. resolves the VERIFIED actor from the PHF HR session via
//      competition-identity.js (People Master — same principle as PHF Task;
//      client can NEVER supply actor/accountId/employeeCode/systemRole),
//   2. picks an EXPLICIT whitelist of fields off the client payload (never
//      `...payload` — same anti-spread discipline as Task),
//   3. calls the phf-hr-api action via competition-bridge.js.
//
// Business authorization (admin/reviewer-level/capability) is NOT decided
// here — it is server-authoritative inside phf-hr-api (Batch C1), which reads
// competition.reviewer_grants / admin_grants / capability_grants ONLY, never
// job title / position / department.

const { resolveCompetitionActor } = require('./competition-identity');
const { callCompetitionAction } = require('./competition-bridge');

const COMPETITION_ACTION_MANIFEST = Object.freeze([
  'competitionBootstrap',
  'competitionListCampaigns', 'competitionGetActiveCampaign', 'competitionGetCampaignDetail',
  'competitionCreateCampaignDraft', 'competitionUpdateCampaignDraft', 'competitionChangeCampaignStatus',
  'competitionPublishCampaign', 'competitionFinalizeCampaignSubmissions',
  'competitionListLevels', 'competitionUpsertLevel', 'competitionDeleteLevel',
  'competitionSetReviewerGrant', 'competitionSetAdminGrant', 'competitionSetCapabilityGrant',
  'competitionListReviewerGrants', 'competitionListAdminGrants', 'competitionListCapabilityGrants',
  'competitionListMySubmissions', 'competitionGetMySubmission',
  'competitionCreateSubmissionDraft', 'competitionEditSubmissionDraft', 'competitionSubmitSubmission',
  'competitionReviewSubmission', 'competitionAdminOverrideSubmission',
  'competitionGetReviewQueue', 'competitionGetReviewerProductivity', 'competitionGetMyReviewed',
  'competitionReassignReview', 'competitionProcessOverdueReviews',
  'competitionListMyNotifications', 'competitionMarkNotificationRead', 'competitionMarkAllNotificationsRead',
  'competitionGetFeed', 'competitionSetReaction',
  'competitionGetLeaderboard',
  'competitionGetMyProgress', 'competitionGetCompanyProgress',
  'competitionListAwards', 'competitionGetAutoAwardCandidate',
  'competitionProposeAward', 'competitionConfirmAward', 'competitionRevokeAward',
]);

function str(v) { return v == null ? undefined : String(v); }
function num(v) { return v == null || v === '' ? undefined : Number(v); }
function bool(v) { return v == null ? undefined : !!v; }

// action -> { remote: <C1 action name>, params(payload): <params object> }
const ACTION_MAP = {
  competitionBootstrap: { remote: 'competition.bootstrap', params: () => ({}) },

  competitionListCampaigns: { remote: 'competition.campaign.list', params: () => ({}) },
  competitionGetActiveCampaign: { remote: 'competition.campaign.active', params: () => ({}) },
  competitionGetCampaignDetail: { remote: 'competition.campaign.detail', params: (p) => ({ campaignId: str(p.campaign_id) }) },
  competitionCreateCampaignDraft: {
    remote: 'competition.campaign.createDraft',
    params: (p) => ({
      code: str(p.code), title: str(p.title), description: str(p.description), instructions: str(p.instructions),
      formSchema: p.form_schema, minRequiredContributions: num(p.min_required_contributions),
      submissionStartsAt: str(p.submission_starts_at), submissionDeadline: str(p.submission_deadline),
      reviewDeadline: str(p.review_deadline),
    }),
  },
  competitionUpdateCampaignDraft: {
    remote: 'competition.campaign.updateDraft',
    params: (p) => ({
      campaignId: str(p.campaign_id), title: str(p.title), description: str(p.description), instructions: str(p.instructions),
      formSchema: p.form_schema, minRequiredContributions: num(p.min_required_contributions),
      submissionStartsAt: str(p.submission_starts_at), submissionDeadline: str(p.submission_deadline),
      reviewDeadline: str(p.review_deadline),
    }),
  },
  competitionChangeCampaignStatus: {
    remote: 'competition.campaign.changeStatus',
    params: (p) => ({ campaignId: str(p.campaign_id), targetStatus: str(p.target_status), reopen: bool(p.reopen), reason: str(p.reason) }),
  },
  competitionPublishCampaign: { remote: 'competition.campaign.publish', params: (p) => ({ campaignId: str(p.campaign_id) }) },
  competitionFinalizeCampaignSubmissions: {
    remote: 'competition.campaign.finalizeSubmissions',
    params: (p) => ({ campaignId: str(p.campaign_id), force: bool(p.force) }),
  },

  competitionListLevels: { remote: 'competition.level.list', params: (p) => ({ campaignId: str(p.campaign_id) }) },
  competitionUpsertLevel: {
    remote: 'competition.level.upsert',
    params: (p) => ({
      campaignId: str(p.campaign_id), levelId: str(p.level_id), levelOrder: num(p.level_order),
      name: str(p.name), score: num(p.score), slaHours: num(p.sla_hours),
      exceptionalCorrection: bool(p.exceptional_correction), reason: str(p.reason),
    }),
  },
  competitionDeleteLevel: { remote: 'competition.level.delete', params: (p) => ({ campaignId: str(p.campaign_id), levelId: str(p.level_id) }) },

  competitionSetReviewerGrant: {
    remote: 'competition.grant.reviewer',
    params: (p) => ({
      campaignId: str(p.campaign_id), accountId: str(p.account_id), employeeCode: str(p.employee_code),
      displayName: str(p.display_name), maxLevelOrder: num(p.max_level_order), active: p.active === false ? false : undefined,
      reason: str(p.reason),
    }),
  },
  competitionSetAdminGrant: {
    remote: 'competition.grant.admin',
    params: (p) => ({
      accountId: str(p.account_id), employeeCode: str(p.employee_code), displayName: str(p.display_name),
      active: p.active === false ? false : undefined, reason: str(p.reason),
    }),
  },
  competitionSetCapabilityGrant: {
    remote: 'competition.grant.capability',
    params: (p) => ({
      capability: str(p.capability), accountId: str(p.account_id), employeeCode: str(p.employee_code),
      displayName: str(p.display_name), active: p.active === false ? false : undefined, reason: str(p.reason),
    }),
  },

  competitionListReviewerGrants: { remote: 'competition.grant.listReviewers', params: (p) => ({ campaignId: str(p.campaign_id) }) },
  competitionListAdminGrants: { remote: 'competition.grant.listAdmins', params: () => ({}) },
  competitionListCapabilityGrants: { remote: 'competition.grant.listCapabilities', params: (p) => ({ capability: str(p.capability) }) },

  competitionListMySubmissions: { remote: 'competition.submission.listMine', params: (p) => ({ campaignId: str(p.campaign_id) }) },
  competitionGetMySubmission: { remote: 'competition.submission.getMine', params: (p) => ({ submissionId: str(p.submission_id) }) },
  competitionCreateSubmissionDraft: {
    remote: 'competition.submission.createDraft',
    params: (p) => ({ campaignId: str(p.campaign_id), payload: p.payload }),
  },
  competitionEditSubmissionDraft: {
    remote: 'competition.submission.editDraft',
    params: (p) => ({ submissionId: str(p.submission_id), payload: p.payload, expectedRowVersion: num(p.expected_row_version) }),
  },
  competitionSubmitSubmission: {
    remote: 'competition.submission.submit',
    params: (p) => ({ submissionId: str(p.submission_id), payload: p.payload }),
  },
  competitionReviewSubmission: {
    // NOTE: the client field is `review_action` (approve/upgrade/request_revision/
    // reject), deliberately NOT named `action` — the top-level `action` on every
    // payload is the DISPATCH selector (which entry of this map to use) and
    // colliding the two field names silently drops the dispatch selector
    // (object literals / Object.assign let the later key win). Found + fixed
    // in Batch C3.1. `params()` still sends `action` to phf-hr-api — that is
    // the SEPARATE, already-established C1 param name on that boundary.
    remote: 'competition.submission.review',
    params: (p) => ({
      campaignId: str(p.campaign_id), submissionId: str(p.submission_id), action: str(p.review_action),
      levelOrder: num(p.level_order), note: str(p.note),
    }),
  },
  competitionAdminOverrideSubmission: {
    remote: 'competition.submission.adminOverride',
    params: (p) => ({
      campaignId: str(p.campaign_id), submissionId: str(p.submission_id), mode: str(p.mode),
      targetStatus: str(p.target_status), payload: p.payload, reason: str(p.reason),
    }),
  },

  competitionGetReviewQueue: { remote: 'competition.review.queue', params: (p) => ({ campaignId: str(p.campaign_id) }) },
  competitionGetReviewerProductivity: {
    remote: 'competition.review.productivity',
    params: (p) => ({ campaignId: str(p.campaign_id), all: bool(p.all) }),
  },
  competitionReassignReview: {
    remote: 'competition.review.reassign',
    params: (p) => ({
      campaignId: str(p.campaign_id), assignmentId: str(p.assignment_id),
      toAccountId: str(p.to_account_id), toEmployeeCode: str(p.to_employee_code), reason: str(p.reason),
    }),
  },
  competitionProcessOverdueReviews: { remote: 'competition.review.processOverdue', params: (p) => ({ campaignId: str(p.campaign_id) }) },
  competitionGetMyReviewed: {
    remote: 'competition.review.myReviewed',
    params: (p) => ({ campaignId: str(p.campaign_id), statusFilter: str(p.status_filter), limit: num(p.limit) }),
  },

  competitionListMyNotifications: { remote: 'competition.notification.list', params: (p) => ({ limit: num(p.limit) }) },
  competitionMarkNotificationRead: { remote: 'competition.notification.markRead', params: (p) => ({ id: str(p.id), ids: p.ids }) },
  competitionMarkAllNotificationsRead: { remote: 'competition.notification.markAllRead', params: () => ({}) },

  competitionGetFeed: { remote: 'competition.feed.get', params: (p) => ({ campaignId: str(p.campaign_id) }) },
  competitionSetReaction: {
    remote: 'competition.feed.react',
    params: (p) => ({ submissionId: str(p.submission_id), on: p.on === false ? false : true }),
  },

  competitionGetLeaderboard: { remote: 'competition.leaderboard.get', params: (p) => ({ campaignId: str(p.campaign_id) }) },

  competitionGetMyProgress: { remote: 'competition.progress.mine', params: (p) => ({ campaignId: str(p.campaign_id), period: str(p.period) }) },
  competitionGetCompanyProgress: { remote: 'competition.progress.company', params: (p) => ({ campaignId: str(p.campaign_id), period: str(p.period) }) },

  competitionListAwards: { remote: 'competition.award.list', params: (p) => ({ campaignId: str(p.campaign_id) }) },
  competitionGetAutoAwardCandidate: {
    remote: 'competition.award.autoCandidate',
    params: (p) => ({ campaignId: str(p.campaign_id), topN: num(p.top_n) }),
  },
  competitionProposeAward: {
    remote: 'competition.award.propose',
    params: (p) => ({
      campaignId: str(p.campaign_id), awardType: str(p.award_type), amountVnd: num(p.amount_vnd),
      rankBasis: num(p.rank_basis), recipientAccountId: str(p.recipient_account_id),
      recipientEmployeeCode: str(p.recipient_employee_code), recipientDisplayName: str(p.recipient_display_name),
      selectionReason: str(p.selection_reason), tiebreakApplied: bool(p.tiebreak_applied), tiebreakReason: str(p.tiebreak_reason),
    }),
  },
  competitionConfirmAward: { remote: 'competition.award.confirm', params: (p) => ({ campaignId: str(p.campaign_id), awardId: str(p.award_id) }) },
  competitionRevokeAward: {
    remote: 'competition.award.revoke',
    params: (p) => ({ campaignId: str(p.campaign_id), awardId: str(p.award_id), reason: str(p.reason) }),
  },
};

async function dispatchCompetitionAction(session, payload) {
  const action = String((payload && payload.action) || '').trim();
  const entry = ACTION_MAP[action];
  if (!entry) return { handled: false };

  const actor = await resolveCompetitionActor(session);
  const params = entry.params(payload || {});
  const result = await callCompetitionAction(entry.remote, actor, params);
  return { handled: true, result };
}

module.exports = { dispatchCompetitionAction, COMPETITION_ACTION_MANIFEST };
