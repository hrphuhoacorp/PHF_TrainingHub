'use strict';

/*
 * PHF HR — Chương trình thi đua (Competition) V1 · Batch C1 REAL-DB matrix.
 *
 * Runs the ACTUAL phf-hr-api service modules
 * (services/phf-hr-api/lib/competition-*.js) against the disposable throwaway
 * database phf_hr_e2e over the local tunnel 127.0.0.1:15432. NO Supabase, NO
 * Vercel, NO mail/cron/notification, NO prod.
 *
 * Requires:
 *   - migrations/phf_hr_competition_v1.sql applied to phf_hr_e2e (Batch B).
 *   - an SSH tunnel to the throwaway's published port, e.g.
 *       ssh -fN -L 25432:127.0.0.1:15432 claude-phf
 *   - e2e/phf-hr-e2e-db.env with PHF_HR_DB_PORT matching the tunnel
 *     (25432 in this worktree; the throwaway container is
 *     phf-hr-e2e-throwaway-20260827T123257Z, DB phf_hr_e2e).
 *   - `pg` on NODE_PATH (the phf-hr-api service has no node_modules in this
 *     worktree — reuse the main worktree's):
 *       NODE_PATH="<main>/services/phf-hr-api/node_modules" \
 *         node scripts/test-competition-c1-realdb-2026-09.js
 *
 * Privileged fixture cleanup runs as postgres via `ssh claude-phf docker exec`
 * (phf_hr_app has no DELETE on competition.* by design).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const { Client } = require('pg');
const svc = require(path.join(ROOT, 'services/phf-hr-api/lib/competition-service'));

const ENV_PATH = process.env.PHF_HR_E2E_DB_ENV || path.join(ROOT, 'e2e', 'phf-hr-e2e-db.env');
const kv = {};
fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m) kv[m[1]] = m[2].trim();
});
if (kv.PHF_HR_DB_HOST !== '127.0.0.1' || !/_e2e$/.test(kv.PHF_HR_DB_NAME || '')) {
  console.error('throwaway DB env required (127.0.0.1 / *_e2e)'); process.exit(2);
}
const config = {
  PHF_HR_DB_HOST: kv.PHF_HR_DB_HOST, PHF_HR_DB_PORT: Number(kv.PHF_HR_DB_PORT || 15432),
  PHF_HR_DB_NAME: kv.PHF_HR_DB_NAME, PHF_HR_DB_RUNTIME_USER: kv.PHF_HR_DB_RUNTIME_USER,
  PHF_HR_DB_RUNTIME_PASSWORD: kv.PHF_HR_DB_RUNTIME_PASSWORD, SERVICE_TOKEN: 'x'.repeat(40),
};

let PASS = 0, FAIL = 0; const fails = [];
function ok(cond, name, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + name); }
  else { FAIL++; fails.push(name); console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}
async function expectReject(code, fn, name) {
  try { await fn(); ok(false, name, 'expected reject ' + code + ' but resolved'); }
  catch (e) { ok(e && e.code === code, name, e && (e.code + ' / ' + e.message)); }
}
const call = (actor, action, params) => svc.dispatch(config, actor, action, params || {});

// synthetic actors — obviously not real employees
const ADMIN = { accountId: 'SYN2-ACC-ADMIN', employeeCode: 'SYN2-ADMIN', displayName: '[SYN2] Sys Admin', systemRole: 'admin' };
const COMPADMIN = { accountId: 'SYN2-ACC-CADM', employeeCode: 'SYN2-CADM', displayName: '[SYN2] Comp Admin', systemRole: 'learner' };
const REVL1 = { accountId: 'SYN2-ACC-RL1', employeeCode: 'SYN2-RL1', displayName: '[SYN2] Reviewer L1', systemRole: 'learner' };
const REVL2 = { accountId: 'SYN2-ACC-RL2', employeeCode: 'SYN2-RL2', displayName: '[SYN2] Reviewer L2', systemRole: 'learner' };
const PROG = { accountId: 'SYN2-ACC-PROG', employeeCode: 'SYN2-PROG', displayName: '[SYN2] Progress Viewer', systemRole: 'learner' };
const P = (n) => ({ accountId: 'SYN2-ACC-P' + n, employeeCode: 'SYN2-P' + n, displayName: '[SYN2] P' + n, department: 'Bán hàng', branch: 'CN' + n, systemRole: 'learner' });
const CODE = 'SYN2-C1-REALDB';

// privileged cleanup runs as postgres via docker exec (phf_hr_app has no
// DELETE on competition.* by design — product never hard-deletes campaigns).
const CONTAINER = kv.PHF_HR_E2E_CONTAINER || 'phf-hr-e2e-throwaway-20260827T123257Z';
function adminExec(sql) {
  execFileSync('ssh', ['claude-phf', `docker exec -i ${CONTAINER} psql -U postgres -d phf_hr_e2e -v ON_ERROR_STOP=1`],
    { input: sql, stdio: ['pipe', 'ignore', 'inherit'] });
}
function cleanupFixture() {
  // session_replication_role = replica lets the cascade delete bypass the
  // append-only history guard — cleanup only, never a product code path.
  adminExec(`
    SET session_replication_role = replica;
    DELETE FROM competition.campaigns WHERE code LIKE 'SYN2-C1-%';
    DELETE FROM competition.admin_grants WHERE account_id LIKE 'SYN2-%';
    DELETE FROM competition.capability_grants WHERE account_id LIKE 'SYN2-%';
    RESET session_replication_role;
  `);
}

let admin; // raw pg client for setup/inspection

async function q(sql, params) {
  await admin.query('BEGIN'); await admin.query('SET LOCAL ROLE phf_hr_app');
  try { const r = await admin.query(sql, params || []); await admin.query('COMMIT'); return r; }
  catch (e) { await admin.query('ROLLBACK').catch(() => {}); throw e; }
}

(async () => {
  admin = new Client({
    host: config.PHF_HR_DB_HOST, port: config.PHF_HR_DB_PORT, database: config.PHF_HR_DB_NAME,
    user: config.PHF_HR_DB_RUNTIME_USER, password: config.PHF_HR_DB_RUNTIME_PASSWORD,
  });
  await admin.connect();

  // schema gate — pg_catalog shows all objects regardless of role privilege.
  // 15 tables from the V1 foundation migration + submission_occurrences
  // (V1.1, additive-only — see phf_hr_competition_v1_1_submission_occurrences.sql).
  const g = await admin.query("select count(*)::int n from pg_class c join pg_namespace nsp on nsp.oid=c.relnamespace where nsp.nspname='competition' and c.relkind='r'");
  if (g.rows[0].n < 15) { console.error('SCHEMA_NOT_APPLIED (competition tables=' + g.rows[0].n + ')'); process.exit(3); }

  cleanupFixture(); // pre-clean any leftover fixture from a prior aborted run

  // cross-module baseline (pg_catalog — privilege-independent)
  const taskBefore = await admin.query("select count(*)::int n from pg_class c join pg_namespace nsp on nsp.oid=c.relnamespace where nsp.nspname='task' and c.relkind='r'");
  const taskRowsBefore = await q("select coalesce((select count(*) from task.tasks),0)::int n").catch(() => ({ rows: [{ n: -1 }] }));

  console.log('\n== IDENTITY ==');
  await expectReject('COMPETITION_ACTOR_REQUIRED', () => call({}, 'competition.campaign.active'), 'empty actor rejected');
  await expectReject('COMPETITION_ACTOR_REQUIRED', () => call({ accountId: '', employeeCode: '' }, 'competition.feed.get', { campaignId: '00000000-0000-0000-0000-000000000000' }), 'blank identity rejected');
  ok((await call(P(1), 'competition.campaign.active')) !== undefined, 'active identity accepted (nullable active campaign ok)');

  console.log('\n== CAMPAIGN / LEVELS / GRANTS (admin) ==');
  const camp = await call(ADMIN, 'competition.campaign.createDraft', {
    code: CODE, title: '[SYN2] Câu hỏi & trả lời KH', description: 'c1 realdb',
    minRequiredContributions: 3,
    formSchema: [{ key: 'customer_question', label: 'Câu hỏi', type: 'textarea', required: true, order: 1 }],
  });
  ok(camp && camp.status === 'draft', 'campaign created draft', camp && camp.status);
  const CID = camp.id;
  await expectReject('COMPETITION_ADMIN_REQUIRED', () => call(P(1), 'competition.campaign.createDraft', { code: CODE + 'x', title: 'no' }), 'non-admin cannot create campaign');

  await call(ADMIN, 'competition.level.upsert', { campaignId: CID, levelOrder: 1, name: 'Hợp lệ', score: 2, slaHours: 48 });
  await call(ADMIN, 'competition.level.upsert', { campaignId: CID, levelOrder: 2, name: 'Đưa vào khung chuẩn', score: 5, slaHours: 72 });
  let levels = await call(ADMIN, 'competition.level.list', { campaignId: CID });
  ok(levels.length === 2 && levels[1].score === 5, 'two configurable levels (2 / 5, not hardcoded)');

  // grants — reviewer max levels, a non-system Competition Admin, a capability
  await call(ADMIN, 'competition.grant.reviewer', { campaignId: CID, accountId: REVL1.accountId, employeeCode: REVL1.employeeCode, displayName: REVL1.displayName, maxLevelOrder: 1 });
  await call(ADMIN, 'competition.grant.reviewer', { campaignId: CID, accountId: REVL2.accountId, employeeCode: REVL2.employeeCode, displayName: REVL2.displayName, maxLevelOrder: 2 });
  await call(ADMIN, 'competition.grant.admin', { accountId: COMPADMIN.accountId, employeeCode: COMPADMIN.employeeCode, displayName: COMPADMIN.displayName, reason: 'c1' });
  await call(ADMIN, 'competition.grant.capability', { capability: 'view_participation_progress', accountId: PROG.accountId, employeeCode: PROG.employeeCode, displayName: PROG.displayName });
  const bootCadm = await call(COMPADMIN, 'competition.bootstrap');
  ok(bootCadm.viewer.isCompetitionAdmin === true, 'non-system account can be granted Competition Admin');

  // level edit after freeze
  await call(ADMIN, 'competition.campaign.changeStatus', { campaignId: CID, targetStatus: 'accepting' });
  await expectReject('LEVELS_FROZEN', () => call(ADMIN, 'competition.level.upsert', { campaignId: CID, levelId: levels[0].id, score: 9 }), 'level edit blocked after accepting (frozen)');
  const fixed = await call(ADMIN, 'competition.level.upsert', { campaignId: CID, levelId: levels[0].id, score: 2, exceptionalCorrection: true, reason: 'audited correction' });
  ok(Number(fixed.score) === 2, 'audited exceptional correction succeeds');

  console.log('\n== SUBMISSIONS + ASSIGNMENT ==');
  async function draftAndSubmit(actor, text) {
    const d = await call(actor, 'competition.submission.createDraft', { campaignId: CID, payload: { customer_question: text } });
    return call(actor, 'competition.submission.submit', { submissionId: d.id });
  }
  const s1 = await draftAndSubmit(P(1), 'q1');
  ok(s1.alias && /[A-ZĐ]/.test(s1.alias), 'submit assigns an anonymous alias', s1.alias);
  ok(s1.assignment && s1.assignment.reviewerAccountId && s1.assignment.reviewerAccountId !== P(1).accountId, 'L1 assignment created, author excluded', s1.assignment && s1.assignment.reviewerAccountId);
  const s2 = await draftAndSubmit(P(2), 'q2');
  const s3 = await draftAndSubmit(P(3), 'q3');
  const s4 = await draftAndSubmit(P(4), 'q4');
  const s5 = await draftAndSubmit(P(5), 'q5');

  // reviewer who is also an author — self exclusion in the engine + self-review block
  const rsub = await draftAndSubmit(REVL1, 'reviewer own piece');
  ok(rsub.assignment == null || rsub.assignment.reviewerAccountId !== REVL1.accountId, 'engine never assigns a submission to its author (reviewer)');
  await expectReject('COMPETITION_SELF_REVIEW_BLOCKED', () => call(REVL1, 'competition.submission.review', { campaignId: CID, submissionId: rsub.submission.id, action: 'approve', levelOrder: 1 }), 'reviewer cannot self-review');

  // workload balance: 6 submissions across 2 reviewers -> both carry load
  const loadRows = await q(`select reviewer_account_id, count(*) n from competition.review_assignments where campaign_id=$1 and is_active group by 1 order by 1`, [CID]);
  ok(loadRows.rows.length === 2 && loadRows.rows.every((r) => Number(r.n) >= 1), 'lowest-workload spreads assignments across reviewers', loadRows.rows);

  console.log('\n== REVIEWER L1 / L2 AUTHORITY ==');
  await call(REVL1, 'competition.submission.review', { campaignId: CID, submissionId: s1.submission.id, action: 'approve', levelOrder: 1 });
  const s1v = await call(P(1), 'competition.submission.getMine', { submissionId: s1.submission.id });
  ok(s1v.status === 'approved' && Number(s1v.currentScore) === 2, 'L1 approves at level 1 -> score 2');
  await expectReject('COMPETITION_REVIEW_LEVEL_TOO_HIGH', () => call(REVL1, 'competition.submission.review', { campaignId: CID, submissionId: s2.submission.id, action: 'approve', levelOrder: 2 }), 'L1 cannot approve level 2');

  await call(REVL2, 'competition.submission.review', { campaignId: CID, submissionId: s2.submission.id, action: 'approve', levelOrder: 1 });
  const up = await call(REVL2, 'competition.submission.review', { campaignId: CID, submissionId: s2.submission.id, action: 'upgrade', levelOrder: 2 });
  ok(up.status === 'approved' && Number(up.currentScore) === 5, 'L2 upgrade 1->2 sets current_score = 5 (replacement, not 7)');

  await call(REVL2, 'competition.submission.review', { campaignId: CID, submissionId: s3.submission.id, action: 'approve', levelOrder: 1 }); // P3 = 2
  await call(REVL1, 'competition.submission.review', { campaignId: CID, submissionId: s4.submission.id, action: 'reject', note: 'off topic' });
  await call(REVL1, 'competition.submission.review', { campaignId: CID, submissionId: s5.submission.id, action: 'request_revision', note: 'add detail' });

  console.log('\n== ANONYMOUS QUEUE ==');
  const queue = await call(REVL2, 'competition.review.queue', { campaignId: CID });
  const qjson = JSON.stringify(queue);
  ok(!/SYN2-P\d|SYN2-ACC-P|Bán hàng|"CN\d"|displayName/.test(qjson), 'review queue carries NO author identity', qjson.slice(0, 200));
  ok(queue.items.every((i) => i.submissionRef && i.payload), 'queue items expose content + opaque ref only');

  console.log('\n== PRODUCTIVITY ==');
  const prodSelf = await call(REVL1, 'competition.review.productivity', { campaignId: CID });
  // "assigned" (historical assignment-ownership rows) and "processed" (real
  // completions, from review_assignment_history.actor_*) are DIFFERENT sets
  // under open-pool reviewing — reviewAction lets any sufficiently-leveled
  // reviewer complete a submission auto-assigned to someone else, so
  // processed CAN exceed assigned (REVL1 here: assigned 2, processed 3 — one
  // of their approvals was on a submission originally assigned to REVL2).
  // The old `assigned >= processed` invariant only held before the C4.4 fix,
  // when processed was (incorrectly) derived FROM review_assignments.
  ok(typeof prodSelf.processed === 'number' && prodSelf.processed >= 0 && typeof prodSelf.assigned === 'number', 'reviewer sees own productivity', prodSelf);

  // FINAL HOTFIX regression: s1 was approved at L1 by REVL1 above, which
  // auto-creates a primary_high "possible upgrade" assignment offering it to
  // REVL2 (ensureHighAssignment) — an is_active/'assigned' row whose
  // submission status is now 'approved', NOT submitted/needs_revision, so
  // anonymousQueue (which requires submitted/needs_revision) does not show
  // it. reviewerProductivity's pending_count must agree with the queue's
  // own actionability definition, not just count raw assignment rows —
  // found live on PHF012 (pendingCount=1, queue empty).
  const revl2Prod = await call(REVL2, 'competition.review.productivity', { campaignId: CID });
  const revl2Queue = await call(REVL2, 'competition.review.queue', { campaignId: CID });
  // V1.5 update: REVL2 is high-tier (maxLevelOrder=2 > base level 1), so the
  // queue now ALSO shows the full open-pool of actionable items within their
  // authority (see competition-review.js anonymousQueue's isHighTierReviewer
  // branch) — a submission can appear with NO review_assignments row for
  // REVL2 at all (responsibility: 'open_pool'). `pending` (reviewerProductivity)
  // still counts only actual assignment rows, so it is no longer expected to
  // equal the full queue length for a high-tier reviewer — it must still
  // equal exactly the ASSIGNED subset of the queue (never more, never less).
  const revl2QueueAssignedCount = revl2Queue.items.filter((i) => i.responsibility === 'assigned').length;
  ok(revl2Prod.pending === revl2QueueAssignedCount,
    'pending count is authoritatively consistent with the ASSIGNED subset of the queue (not counting an approved submission\'s "possible upgrade" offer, nor the V1.5 open-pool items, as pending)',
    { pending: revl2Prod.pending, queueAssignedCount: revl2QueueAssignedCount, queueLength: revl2Queue.items.length });
  ok(revl2Queue.items.length >= revl2QueueAssignedCount,
    'V1.5: queue length is the assigned subset plus any open-pool items the high-tier reviewer is additionally authorized on',
    { queueLength: revl2Queue.items.length, assigned: revl2QueueAssignedCount });
  await expectReject('COMPETITION_ADMIN_REQUIRED', () => call(REVL1, 'competition.review.productivity', { campaignId: CID, all: true }), 'reviewer cannot see all-reviewer productivity');
  const prodAll = await call(ADMIN, 'competition.review.productivity', { campaignId: CID, all: true });
  ok(Array.isArray(prodAll.reviewers) && prodAll.reviewers.length === 2, 'admin sees all reviewer productivity');

  // C4.4 regression: a Competition Admin has NO reviewer_grants row (they
  // review via the "admin acts as unbounded reviewer" bypass) — their own
  // productivity self-view must still reflect real completions, not the old
  // reviewer_grants-driven 0/0/0/0 (operator-reported bug: reviewed 2 items,
  // "Đã xử lý" stayed 0).
  const prodAdminBefore = await call(ADMIN, 'competition.review.productivity', { campaignId: CID });
  const adminSub = await draftAndSubmit(P(6), 'admin productivity regression fixture');
  await call(ADMIN, 'competition.submission.review', { campaignId: CID, submissionId: adminSub.submission.id, action: 'approve', levelOrder: 1 });
  const prodAdminAfter = await call(ADMIN, 'competition.review.productivity', { campaignId: CID });
  ok(prodAdminAfter.processed === prodAdminBefore.processed + 1,
    'Competition Admin (no reviewer_grants row) sees own "processed" increment after a real approve — not stuck at 0',
    { before: prodAdminBefore, after: prodAdminAfter });

  console.log('\n== SLA + REASSIGN ==');
  // force P... a still-pending submission's L1 assignment overdue
  await q(`update competition.review_assignments set due_at = now() - interval '2 hours'
            where campaign_id=$1 and is_active and status='assigned'
            and submission_id = (select id from competition.submissions where campaign_id=$1 and status='needs_revision' limit 1)`, [CID]);
  // re-submit s5 so it's pending again, then process overdue
  await call(P(5), 'competition.submission.submit', { submissionId: s5.submission.id });
  await q(`update competition.review_assignments set due_at = now() - interval '2 hours' where campaign_id=$1 and is_active and submission_id=$2`, [CID, s5.submission.id]);
  const overdue = await call(ADMIN, 'competition.review.processOverdue', { campaignId: CID });
  ok(overdue.processed >= 1, 'SLA overdue processing returns/reassigns', overdue);

  // manual reassign (audited)
  const anyActive = await q(`select id from competition.review_assignments where campaign_id=$1 and is_active and status='assigned' limit 1`, [CID]);
  if (anyActive.rows.length) {
    await expectReject('COMPETITION_REASSIGN_REASON_REQUIRED', () => call(ADMIN, 'competition.review.reassign', { campaignId: CID, assignmentId: anyActive.rows[0].id, toAccountId: REVL2.accountId, toEmployeeCode: REVL2.employeeCode }), 'manual reassign requires a reason');
    await call(ADMIN, 'competition.review.reassign', { campaignId: CID, assignmentId: anyActive.rows[0].id, toAccountId: REVL2.accountId, toEmployeeCode: REVL2.employeeCode, reason: 'balancing' });
    const h = await q(`select count(*)::int n from competition.review_assignment_history where action='manual_reassign' and submission_id in (select submission_id from competition.review_assignments where campaign_id=$1)`, [CID]);
    ok(h.rows[0].n >= 1, 'manual reassign writes audit history');
  } else ok(true, 'manual reassign (no active assignment to move — skipped)');

  // revoke reviewer -> unprocessed assignments return to pool
  await call(ADMIN, 'competition.grant.reviewer', { campaignId: CID, accountId: REVL2.accountId, active: false, reason: 'test revoke' });
  const stray = await q(`select count(*)::int n from competition.review_assignments where campaign_id=$1 and reviewer_account_id=$2 and is_active and status in ('assigned','in_progress')`, [CID, REVL2.accountId]);
  ok(stray.rows[0].n === 0, 'revoking a reviewer returns their unprocessed assignments');
  await call(ADMIN, 'competition.grant.reviewer', { campaignId: CID, accountId: REVL2.accountId, employeeCode: REVL2.employeeCode, displayName: REVL2.displayName, maxLevelOrder: 2 }); // restore

  console.log('\n== PARTICIPATION PROGRESS ==');
  const myp = await call(P(1), 'competition.progress.mine', { campaignId: CID });
  ok(myp.requiredCount === 3 && typeof myp.validCount === 'number', 'participant sees own progress x/required', myp);
  const compProg = await call(PROG, 'competition.progress.company', { campaignId: CID });
  ok(Array.isArray(compProg.rows) && compProg.rows.length >= 3, 'capability holder sees company-wide progress');
  await expectReject('COMPETITION_PROGRESS_FORBIDDEN', () => call(REVL1, 'competition.progress.company', { campaignId: CID }), 'plain reviewer cannot see company progress');
  await call(ADMIN, 'competition.grant.capability', { capability: 'view_participation_progress', accountId: PROG.accountId, active: false, reason: 'revoke test' });
  await expectReject('COMPETITION_PROGRESS_FORBIDDEN', () => call(PROG, 'competition.progress.company', { campaignId: CID }), 'capability revoke takes effect immediately');
  // capability did NOT grant reviewer rights
  await expectReject('COMPETITION_NOT_A_REVIEWER', () => call(PROG, 'competition.review.queue', { campaignId: CID }), 'capability confers no reviewer rights');

  console.log('\n== FEED + REACTIONS ==');
  const feed1 = await call(P(4), 'competition.feed.get', { campaignId: CID });
  ok(feed1.posts.length >= 2 && feed1.posts.every((p) => ['approved', 'finalized'].includes(p.status)), 'feed shows only approved/finalized');
  ok(feed1.posts.every((p) => p.authorName === null), 'feed hides real identity before publish (alias only)');
  ok(!JSON.stringify(feed1).match(/SYN2-P\d"|SYN2-ACC-P/), 'feed carries no raw author identity');
  const s1id = feed1.posts.find((p) => Number(p.currentScore) === 2 && p.reactionTotal === 0) ? feed1.posts[0].submissionId : feed1.posts[0].submissionId;
  const react1 = await call(P(4), 'competition.feed.react', { submissionId: feed1.posts[0].submissionId, on: true });
  ok(react1.reactionTotal === 1 && react1.viewerReacted, 'reaction add -> total 1');
  await call(P(4), 'competition.feed.react', { submissionId: feed1.posts[0].submissionId, on: true }); // idempotent
  const react2 = await call(P(3), 'competition.feed.react', { submissionId: feed1.posts[0].submissionId, on: true });
  ok(react2.reactionTotal === 2, 'second user reaction -> total 2 (one active per user)');
  const lbBefore = await call(P(1), 'competition.leaderboard.get', { campaignId: CID });
  const react3 = await call(P(4), 'competition.feed.react', { submissionId: feed1.posts[0].submissionId, on: false });
  ok(react3.reactionTotal === 1, 'reaction remove -> total back to 1');
  const lbAfter = await call(P(1), 'competition.leaderboard.get', { campaignId: CID });
  ok(JSON.stringify(lbBefore.rows) === JSON.stringify(lbAfter.rows), 'reactions do NOT affect leaderboard/score');

  console.log('\n== LEADERBOARD ==');
  const lbP1 = await call(P(1), 'competition.leaderboard.get', { campaignId: CID });
  ok(lbP1.identityMode === 'participant', 'participant leaderboard mode');
  ok(lbP1.you && lbP1.you.isYou && lbP1.you.displayName, 'own row marked + own identity visible');
  ok(lbP1.rows.filter((r) => !r.isYou).every((r) => r.displayName === null && r.alias), 'competitors shown as alias only');
  ok(!JSON.stringify(lbP1.rows).match(/approvedCount|department|branch/), 'no competitor counts / dept / branch');
  const p1rank = lbP1.rows.find((r) => r.isYou).rank;
  const p3row = (await call(P(3), 'competition.leaderboard.get', { campaignId: CID })).you;
  ok(p1rank === p3row.rank && Number(lbP1.you.totalScore) === 2 && Number(p3row.totalScore) === 2, 'equal total score => same rank (P1 == P3 @ 2)');
  const lbRev2 = await call(REVL2, 'competition.leaderboard.get', { campaignId: CID });
  ok(lbRev2.identityMode === 'privileged' && lbRev2.rows.every((r) => r.displayName), 'high reviewer privileged leaderboard shows real identity + score');
  const lbAdmin = await call(ADMIN, 'competition.leaderboard.get', { campaignId: CID });
  ok(lbAdmin.identityMode === 'admin' && lbAdmin.rows.every((r) => 'approvedCount' in r), 'admin leaderboard full view');

  console.log('\n== ADMIN OVERRIDE + SELF-REVIEW (campaign still reviewing) ==');
  const adSub = await draftAndSubmit(ADMIN, 'admin own piece');
  await expectReject('COMPETITION_OVERRIDE_REASON_REQUIRED', () => call(ADMIN, 'competition.submission.adminOverride', { campaignId: CID, submissionId: s3.submission.id, mode: 'withdraw_approval' }), 'admin override needs a reason');
  await expectReject('COMPETITION_SELF_REVIEW_BLOCKED', () => call(ADMIN, 'competition.submission.adminOverride', { campaignId: CID, submissionId: adSub.submission.id, mode: 'set_status', targetStatus: 'approved', reason: 'x' }), 'admin cannot self-intervene on own submission');
  // real override: withdraw P3's approval then restore it (keeps leaderboard stable)
  await call(ADMIN, 'competition.submission.adminOverride', { campaignId: CID, submissionId: s3.submission.id, mode: 'withdraw_approval', reason: 'audit recheck' });
  const s3w = await call(P(3), 'competition.submission.getMine', { submissionId: s3.submission.id });
  ok(s3w.status === 'submitted' && s3w.currentScore === null, 'admin withdraw_approval removes score');
  await call(REVL1, 'competition.submission.review', { campaignId: CID, submissionId: s3.submission.id, action: 'approve', levelOrder: 1 });
  const hist = await q(`select count(*)::int n from competition.submission_history where action in ('approve','upgrade','reject','revision_requested','finalize','approval_withdrawn','admin_override')`);
  ok(hist.rows[0].n >= 6, 'meaningful actions (incl admin override) are all audited', hist.rows[0].n);

  console.log('\n== AWARDS ==');
  const cand = await call(ADMIN, 'competition.award.autoCandidate', { campaignId: CID, topN: 3 });
  ok(cand.candidate && cand.candidate.employeeCode === 'SYN2-P2', 'auto candidate = top of leaderboard (P2 @ 5)', cand.candidate && cand.candidate.employeeCode);
  await expectReject('COMPETITION_AWARD_REASON_REQUIRED', () => call(ADMIN, 'competition.award.propose', { campaignId: CID, awardType: 'value', recipientAccountId: P(1).accountId, recipientEmployeeCode: P(1).employeeCode }), 'value award requires selection reason');

  // dual-award block: P3 holds a confirmed VALUE, then gets an AUTO -> blocked
  const p3v = await call(ADMIN, 'competition.award.propose', { campaignId: CID, awardType: 'value', recipientAccountId: P(3).accountId, recipientEmployeeCode: P(3).employeeCode, recipientDisplayName: P(3).displayName, selectionReason: 'clarity' });
  await call(ADMIN, 'competition.award.confirm', { campaignId: CID, awardId: p3v.id });
  const p3a = await call(ADMIN, 'competition.award.propose', { campaignId: CID, awardType: 'auto', recipientAccountId: P(3).accountId, recipientEmployeeCode: P(3).employeeCode, recipientDisplayName: P(3).displayName });
  await expectReject('COMPETITION_DUAL_AWARD_BLOCKED', () => call(ADMIN, 'competition.award.confirm', { campaignId: CID, awardId: p3a.id }), 'one person cannot hold two confirmed awards');
  await call(ADMIN, 'competition.award.revoke', { campaignId: CID, awardId: p3v.id, reason: 'reset for next check' });

  // auto -> value: the auto winner (P2) also takes the value award -> 500k
  // auto moves to the next eligible participant.
  const a2 = await call(ADMIN, 'competition.award.propose', { campaignId: CID, awardType: 'auto', recipientAccountId: P(2).accountId, recipientEmployeeCode: P(2).employeeCode, recipientDisplayName: P(2).displayName, rankBasis: 1 });
  await call(ADMIN, 'competition.award.confirm', { campaignId: CID, awardId: a2.id });
  const av = await call(ADMIN, 'competition.award.propose', { campaignId: CID, awardType: 'value', recipientAccountId: P(2).accountId, recipientEmployeeCode: P(2).employeeCode, recipientDisplayName: P(2).displayName, selectionReason: 'best answer', amountVnd: 1000000 });
  const conf = await call(ADMIN, 'competition.award.confirm', { campaignId: CID, awardId: av.id });
  ok(conf.status === 'confirmed' && conf.nextEligibleAuto && conf.nextEligibleAuto.recipientEmployeeCode !== 'SYN2-P2', 'auto winner taking the value award -> 500k auto moves to next eligible', conf.nextEligibleAuto);
  const awardList = await call(ADMIN, 'competition.award.list', { campaignId: CID });
  ok(awardList.some((x) => x.awardType === 'auto' && x.status === 'superseded'), 'original auto award superseded');
  const nextAuto = awardList.find((x) => x.awardType === 'auto' && x.status === 'proposed');
  const nc = await call(ADMIN, 'competition.award.confirm', { campaignId: CID, awardId: nextAuto.id });
  ok(nc.status === 'confirmed', 'reassigned auto award can be confirmed for the next eligible');

  console.log('\n== PUBLICATION ==');
  await call(ADMIN, 'competition.campaign.changeStatus', { campaignId: CID, targetStatus: 'reviewing' }).catch(() => {});
  await expectReject('COMPETITION_PUBLISH_GATE', () => call(ADMIN, 'competition.campaign.publish', { campaignId: CID }), 'cannot publish a non-finalized campaign');
  await call(ADMIN, 'competition.campaign.finalizeSubmissions', { campaignId: CID, force: true });
  await call(ADMIN, 'competition.campaign.changeStatus', { campaignId: CID, targetStatus: 'finalized' });
  const feedPre = await call(P(4), 'competition.feed.get', { campaignId: CID });
  ok(feedPre.posts.every((p) => p.authorName === null), 'identity still hidden pre-publish (finalized, not published)');
  await call(ADMIN, 'competition.campaign.publish', { campaignId: CID });
  const feedPost = await call(P(4), 'competition.feed.get', { campaignId: CID });
  ok(feedPost.published && feedPost.posts.some((p) => p.authorName), 'after publish: approved submissions reveal real identity');
  ok(feedPost.posts.every((p) => p.status !== 'rejected'), 'rejected submissions are NEVER on the feed / published');
  const lbPub = await call(P(3), 'competition.leaderboard.get', { campaignId: CID });
  ok(lbPub.identityMode === 'public' && lbPub.rows.every((r) => r.displayName), 'post-publish leaderboard = public real-identity mode');

  console.log('\n== CROSS-MODULE GUARDS ==');
  const taskAfter = await admin.query("select count(*)::int n from pg_class c join pg_namespace nsp on nsp.oid=c.relnamespace where nsp.nspname='task' and c.relkind='r'");
  ok(taskAfter.rows[0].n === taskBefore.rows[0].n, 'task schema table count unchanged');
  const taskRowsAfter = await q("select coalesce((select count(*) from task.tasks),0)::int n").catch(() => ({ rows: [{ n: -1 }] }));
  ok(taskRowsAfter.rows[0].n === taskRowsBefore.rows[0].n, 'task.tasks row count unchanged (no cross-module write)');
  const publicWrite = await admin.query("select count(*)::int n from pg_class c join pg_namespace nsp on nsp.oid=c.relnamespace where nsp.nspname='public' and c.relname in ('user_accounts','employee_profiles')");
  ok(publicWrite.rows[0].n === 0, 'no People Master tables touched/created');

  console.log('\n== UI/UX ROUND 2 — REQUIREMENT=5 CONFIG CORRECTION (real playground campaign) ==');
  // Operator-confirmed business rule is 5 nội dung hợp lệ/người/tháng; the
  // DEV OPERATOR-REVIEW-2026-09 campaign was corrected from 3 -> 5 via a
  // direct SQL UPDATE (competitionUpdateCampaignDraft only allows edits
  // while status='draft'; this campaign is 'accepting'). Guard against an
  // accidental revert, and prove progress derives from that column value —
  // not a hardcoded frontend/backend number — using the REAL bootstrap path.
  const OPERATOR_REVIEW_CID = 'b23202a9-cfa0-492c-813d-377452026a57';
  const reqRow = await q('select min_required_contributions from competition.campaigns where id = $1', [OPERATOR_REVIEW_CID]).catch(() => ({ rows: [] }));
  if (reqRow.rows.length) {
    ok(Number(reqRow.rows[0].min_required_contributions) === 5, 'OPERATOR-REVIEW-2026-09 min_required_contributions = 5 (corrected from 3, Operator-confirmed)', reqRow.rows[0]);
    const REAL_ACTOR = { accountId: 'acct-937560e2-7dba-4178-bbd2-b6fe6ff537c3', employeeCode: 'PHF084', displayName: 'Đặng Thị Duy', systemRole: 'learner' };
    const realProgress = await svc.dispatch(config, REAL_ACTOR, 'competition.progress.mine', { campaignId: OPERATOR_REVIEW_CID });
    ok(realProgress.requiredCount === 5, 'real participant progress.requiredCount derives from campaign config (5), not a hardcoded 3', realProgress);
  } else {
    ok(true, 'OPERATOR-REVIEW-2026-09 campaign not present in this DB — skip (not this run\'s fixture)');
  }

  await admin.end();
  cleanupFixture(); // keep the throwaway tidy
  console.log('\n==== COMPETITION_C1_REALDB  PASS=' + PASS + '  FAIL=' + FAIL + ' ====');
  if (FAIL) { console.log('FAILURES:\n - ' + fails.join('\n - ')); process.exit(1); }
})().catch(async (e) => {
  console.error('FATAL', e && e.stack || e);
  try { if (admin) await admin.end(); } catch (x) {}
  try { cleanupFixture(); } catch (x) {}
  process.exit(1);
});
