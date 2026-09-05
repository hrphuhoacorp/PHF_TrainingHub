'use strict';

// PHF HR — Competition V1 · action dispatcher.
//
// ONE canonical action map, shared by the phf-hr-api HTTP route
// (POST /v1/competition) and — later, Batch C2 — the Vercel bridge, so the
// action list never drifts between layers.
//
// Every handler is (config, actor, params). `actor` is the VERIFIED actor
// object supplied across the service-token boundary — resolved on the Vercel
// side against the People Master. phf-hr-api never resolves identity itself
// and the client can never supply an authoritative actor.

const { assertActor, CompetitionError } = require('./competition-common');
const campaigns = require('./competition-campaigns');
const submissions = require('./competition-submissions');
const review = require('./competition-review');
const feed = require('./competition-feed');
const leaderboard = require('./competition-leaderboard');
const awards = require('./competition-awards');
const progress = require('./competition-progress');
const { resolveAuthority } = require('./competition-permissions');
const similarity = require('./competition-similarity-service');
const notificationRead = require('./competition-notification-read');
const adminView = require('./competition-admin-view');

const READ_ACTIONS = new Set([
  'competition.bootstrap',
  'competition.campaign.list', 'competition.campaign.detail', 'competition.campaign.active',
  'competition.level.list',
  'competition.submission.listMine', 'competition.submission.getMine',
  'competition.submission.checkSimilarity', 'competition.submission.listAdjustable',
  'competition.review.queue', 'competition.review.productivity', 'competition.review.similar',
  'competition.review.myReviewed',
  'competition.submission.occurrenceCount',
  'competition.feed.get',
  'competition.leaderboard.get',
  'competition.progress.mine', 'competition.progress.company', 'competition.progress.submittedTotal',
  'competition.grant.listReviewers', 'competition.grant.listAdmins', 'competition.grant.listCapabilities',
  'competition.award.list', 'competition.award.autoCandidate',
  'competition.notification.list',
  // V1.6 — Admin Control Tower reads
  'competition.admin.listAllSubmissions', 'competition.admin.getSubmissionHistory',
]);

const HANDLERS = {
  // bootstrap — one call the module shell uses on load
  'competition.bootstrap': async (config, actor) => {
    const active = await campaigns.getActiveCampaign(config);
    const authority = await resolveAuthority(config, actor, active ? active.id : null);
    let myProgress = null;
    if (active) {
      try { myProgress = await progress.myProgress(config, actor, { campaignId: active.id }); } catch (e) { myProgress = null; }
    }
    return {
      viewer: {
        accountId: actor.accountId, employeeCode: actor.employeeCode, displayName: actor.displayName,
        department: actor.department || '', title: actor.title || '',
        isCompetitionAdmin: authority.isCompetitionAdmin,
        reviewerMaxLevel: authority.reviewerMaxLevel,
      },
      activeCampaign: active,
      myRequirement: myProgress,
      capabilities: {
        canSubmit: authority.canSubmit, canReview: authority.canReview, canAdmin: authority.canAdmin,
        viewParticipationProgress: authority.capabilities.viewParticipationProgress,
      },
    };
  },

  'competition.campaign.list': (c, a) => campaigns.listCampaigns(c, a),
  'competition.campaign.active': (c) => campaigns.getActiveCampaign(c),
  'competition.campaign.detail': (c, a, p) => campaigns.getCampaignDetail(c, a, p.campaignId),
  'competition.campaign.createDraft': (c, a, p) => campaigns.createDraftCampaign(c, a, p),
  'competition.campaign.updateDraft': (c, a, p) => campaigns.updateDraftCampaign(c, a, p),
  'competition.campaign.changeStatus': (c, a, p) => campaigns.changeCampaignStatus(c, a, p),
  'competition.campaign.publish': (c, a, p) => campaigns.publishCampaign(c, a, p),
  'competition.campaign.finalizeSubmissions': (c, a, p) => submissions.finalizeCampaignSubmissions(c, a, p),

  'competition.level.list': (c, a, p) => campaigns.listLevels(c, p.campaignId),
  'competition.level.upsert': (c, a, p) => campaigns.upsertLevel(c, a, p),
  'competition.level.delete': (c, a, p) => campaigns.deleteLevel(c, a, p),

  'competition.grant.reviewer': async (c, a, p) => {
    const res = await campaigns.setReviewerGrant(c, a, p);
    if (p.active === false) {
      // full revoke — return ALL of their unprocessed assignments to the pool
      await review.returnAssignmentsForRevokedReviewer(c, { campaignId: p.campaignId, accountId: p.accountId, reasonCode: 'reviewer_revoked' });
    } else if (Number(res.maxLevelOrder) < 2) {
      // downgraded below high-reviewer level — level-1 authority is kept, so
      // only their now-ineligible HIGH assignments come back to the pool.
      await review.returnAssignmentsForRevokedReviewer(c, { campaignId: p.campaignId, accountId: p.accountId, tiers: ['primary_high'], reasonCode: 'reviewer_downgraded' });
    }
    return res;
  },
  'competition.grant.admin': (c, a, p) => campaigns.setAdminGrant(c, a, p),
  'competition.grant.capability': (c, a, p) => campaigns.setCapabilityGrant(c, a, p),
  'competition.grant.listReviewers': (c, a, p) => campaigns.listReviewerGrants(c, a, p),
  'competition.grant.listAdmins': (c, a) => campaigns.listAdminGrants(c, a),
  'competition.grant.listCapabilities': (c, a, p) => campaigns.listCapabilityGrants(c, a, p),

  'competition.submission.listMine': (c, a, p) => submissions.listMySubmissions(c, a, p),
  'competition.submission.getMine': (c, a, p) => submissions.getMySubmission(c, a, p.submissionId),
  'competition.submission.createDraft': (c, a, p) => submissions.createDraft(c, a, p),
  'competition.submission.editDraft': (c, a, p) => submissions.editDraft(c, a, p),
  'competition.submission.submit': (c, a, p) => submissions.submit(c, a, p),
  'competition.submission.bulkSubmit': (c, a, p) => submissions.bulkSubmit(c, a, p),
  'competition.submission.review': (c, a, p) => submissions.reviewAction(c, a, p),
  'competition.submission.adminOverride': (c, a, p) => submissions.adminOverride(c, a, p),
  'competition.submission.adminRestore': (c, a, p) => submissions.adminRestoreSubmission(c, a, p),
  'competition.submission.adjustScore': (c, a, p) => submissions.adjustScore(c, a, p),
  'competition.submission.listAdjustable': (c, a, p) => submissions.listAdjustable(c, a, p),
  'competition.submission.checkSimilarity': (c, a, p) => similarity.checkSimilarityForSubmit(c, a, p),
  'competition.submission.confirmOccurrence': (c, a, p) => similarity.confirmOccurrence(c, a, p),
  'competition.submission.occurrenceCount': (c, a, p) => similarity.getOccurrenceCount(c, a, p),

  'competition.review.queue': async (c, a, p) => {
    const result = await review.anonymousQueue(c, a, p);
    return similarity.attachQueueSimilarityFlags(c, result, p.campaignId);
  },
  'competition.review.similar': (c, a, p) => similarity.getSimilarForReview(c, a, p),
  'competition.review.productivity': (c, a, p) => review.reviewerProductivity(c, a, p),
  'competition.review.myReviewed': (c, a, p) => review.myReviewedHistory(c, a, p),
  'competition.review.reassign': (c, a, p) => review.manualReassign(c, a, p),
  'competition.review.processOverdue': (c, a, p) => review.processOverdueAssignments(c, p),

  // V1.6 — Admin Control Tower
  'competition.admin.listAllSubmissions': (c, a, p) => adminView.adminListAllSubmissions(c, a, p),
  'competition.admin.getSubmissionHistory': (c, a, p) => adminView.adminGetSubmissionHistory(c, a, p),

  'competition.notification.list': (c, a, p) => notificationRead.listMyCompetitionNotifications(c, a, p),
  'competition.notification.markRead': (c, a, p) => notificationRead.markCompetitionNotificationRead(c, a, p),
  'competition.notification.markAllRead': (c, a) => notificationRead.markAllCompetitionNotificationsRead(c, a),

  'competition.feed.get': (c, a, p) => feed.getFeed(c, a, p),
  'competition.feed.react': (c, a, p) => feed.setReaction(c, a, p),

  'competition.leaderboard.get': (c, a, p) => leaderboard.getLeaderboard(c, a, p),

  'competition.progress.mine': (c, a, p) => progress.myProgress(c, a, p),
  'competition.progress.company': (c, a, p) => progress.companyProgress(c, a, p),
  'competition.progress.submittedTotal': (c, a, p) => progress.submittedTotal(c, a, p),

  'competition.award.list': (c, a, p) => awards.listAwards(c, a, p),
  'competition.award.autoCandidate': (c, a, p) => awards.computeAutoCandidate(c, a, p),
  'competition.award.propose': (c, a, p) => awards.proposeAward(c, a, p),
  'competition.award.confirm': (c, a, p) => awards.confirmAward(c, a, p),
  'competition.award.revoke': (c, a, p) => awards.revokeAward(c, a, p),
};

const ACTIONS = Object.keys(HANDLERS);

function isReadAction(action) { return READ_ACTIONS.has(action); }

async function dispatch(config, rawActor, action, params) {
  const handler = HANDLERS[action];
  if (!handler) throw new CompetitionError('COMPETITION_ACTION_UNKNOWN', 'Hành động Competition không hợp lệ: ' + action, 404);
  const actor = assertActor(rawActor);
  return handler(config, actor, params || {});
}

module.exports = { dispatch, ACTIONS, isReadAction, HANDLERS };
