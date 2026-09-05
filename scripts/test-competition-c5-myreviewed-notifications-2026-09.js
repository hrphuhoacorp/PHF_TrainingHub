'use strict';

/*
 * PHF HR — Chương trình thi đua (Competition) V1.4 · "Bài tôi đã duyệt" +
 * Notification · REAL-DB matrix against the disposable throwaway database
 * phf_hr_e2e (same harness shape as scripts/test-competition-c1-realdb-2026-09.js
 * — see that file's header for the tunnel/env/container prerequisites).
 *
 * NO Supabase, NO Vercel, NO PROD. Exercises the ACTUAL phf-hr-api service
 * modules (services/phf-hr-api/lib/competition-*.js) via svc.dispatch(), the
 * SAME entry point api/data.js -> api/_lib/competition-actions.js ->
 * competition-bridge.js reaches over HTTP in dev/local.
 *
 * Adapted to THIS worktree's CURRENT (V1.3) code shape:
 *   - "post-approval adjustment" is competition.submission.adjustScore
 *     (effective_score, Reviewer-top-level/Admin only) — NOT adminOverride
 *     (which in this worktree's lifecycle just withdraws approval back to
 *     'submitted' and carries no effective-score/from->to semantics).
 *   - myReviewedHistory additionally surfaces effectiveScore/adjusted, since
 *     V1.3 added that column after the reference implementation was written.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const { Client } = require('pg');
const svc = require(path.join(ROOT, 'services/phf-hr-api/lib/competition-service'));
const { emitCompetitionNotifications } = require(path.join(ROOT, 'services/phf-hr-api/lib/competition-notification-emit'));

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

const ADMIN = { accountId: 'SYN4-ACC-ADMIN', employeeCode: 'SYN4-ADMIN', displayName: '[SYN4] Sys Admin', systemRole: 'admin' };
const REVL1 = { accountId: 'SYN4-ACC-RL1', employeeCode: 'SYN4-RL1', displayName: '[SYN4] Reviewer L1', systemRole: 'learner' };
const REVL2 = { accountId: 'SYN4-ACC-RL2', employeeCode: 'SYN4-RL2', displayName: '[SYN4] Reviewer L2', systemRole: 'learner' };
const P = (n) => ({ accountId: 'SYN4-ACC-P' + n, employeeCode: 'SYN4-P' + n, displayName: '[SYN4] P' + n, department: 'Bán hàng', branch: 'CN' + n, systemRole: 'learner' });
const CODE = 'SYN4-C5-MYREVIEWED';

const CONTAINER = kv.PHF_HR_E2E_CONTAINER || 'phf-hr-e2e-throwaway-20260827T123257Z';
function adminExec(sql) {
  execFileSync('ssh', ['claude-phf', `docker exec -i ${CONTAINER} psql -U postgres -d phf_hr_e2e -v ON_ERROR_STOP=1`],
    { input: sql, stdio: ['pipe', 'ignore', 'inherit'] });
}
function cleanupFixture() {
  adminExec(`
    SET session_replication_role = replica;
    DELETE FROM competition.campaigns WHERE code LIKE 'SYN4-C5-%';
    DELETE FROM competition.admin_grants WHERE account_id LIKE 'SYN4-%';
    RESET session_replication_role;
  `);
}

let admin;
async function q(sql, params) {
  await admin.query('BEGIN'); await admin.query('SET LOCAL ROLE phf_hr_app');
  try { const r = await admin.query(sql, params || []); await admin.query('COMMIT'); return r; }
  catch (e) { await admin.query('ROLLBACK').catch(() => {}); throw e; }
}
// run fn(client) inside a phf_hr_app transaction and commit — for direct
// emit-module idempotency tests (bypasses the business write path on purpose).
async function withAppTx(fn) {
  const c = new Client({ host: config.PHF_HR_DB_HOST, port: config.PHF_HR_DB_PORT, database: config.PHF_HR_DB_NAME, user: config.PHF_HR_DB_RUNTIME_USER, password: config.PHF_HR_DB_RUNTIME_PASSWORD });
  await c.connect();
  try {
    await c.query('BEGIN'); await c.query('SET LOCAL ROLE phf_hr_app');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { await c.end(); }
}

(async () => {
  admin = new Client({ host: config.PHF_HR_DB_HOST, port: config.PHF_HR_DB_PORT, database: config.PHF_HR_DB_NAME, user: config.PHF_HR_DB_RUNTIME_USER, password: config.PHF_HR_DB_RUNTIME_PASSWORD });
  await admin.connect();

  const g = await admin.query("select count(*)::int n from pg_class c join pg_namespace nsp on nsp.oid=c.relnamespace where nsp.nspname='competition' and c.relname='notifications'");
  if (g.rows[0].n !== 1) { console.error('NOTIFICATION_SCHEMA_NOT_APPLIED'); process.exit(3); }

  cleanupFixture();

  try {
    console.log('\n== SETUP ==');
    const camp = await call(ADMIN, 'competition.campaign.createDraft', {
      code: CODE, title: '[SYN4] Bài tôi đã duyệt + Notification', minRequiredContributions: 1,
      formSchema: [{ key: 'customer_question', label: 'Câu hỏi', type: 'textarea', required: true, order: 1 }],
    });
    const CID = camp.id;
    await call(ADMIN, 'competition.level.upsert', { campaignId: CID, levelOrder: 1, name: 'Hợp lệ', score: 2, slaHours: 48 });
    await call(ADMIN, 'competition.level.upsert', { campaignId: CID, levelOrder: 2, name: 'Giá trị cao', score: 5, slaHours: 72 });
    await call(ADMIN, 'competition.grant.reviewer', { campaignId: CID, accountId: REVL1.accountId, employeeCode: REVL1.employeeCode, displayName: REVL1.displayName, maxLevelOrder: 1 });
    await call(ADMIN, 'competition.grant.reviewer', { campaignId: CID, accountId: REVL2.accountId, employeeCode: REVL2.employeeCode, displayName: REVL2.displayName, maxLevelOrder: 2 });
    await call(ADMIN, 'competition.campaign.changeStatus', { campaignId: CID, targetStatus: 'accepting' });

    async function draftAndSubmit(actor, text) {
      const d = await call(actor, 'competition.submission.createDraft', { campaignId: CID, payload: { customer_question: text } });
      return call(actor, 'competition.submission.submit', { submissionId: d.id });
    }
    const s1 = await draftAndSubmit(P(1), 'q1 — tình huống 1');
    const s2 = await draftAndSubmit(P(2), 'q2 — tình huống 2');
    const s3 = await draftAndSubmit(P(3), 'q3 — tình huống 3 cần chỉnh sửa');

    console.log('\n== PARTICIPANT-ONLY CANNOT SEE "Bài tôi đã duyệt" ==');
    await expectReject('COMPETITION_NOT_A_REVIEWER', () => call(P(1), 'competition.review.myReviewed', { campaignId: CID }), 'participant-only cannot call myReviewed (403/hidden)');

    console.log('\n== ASSIGNMENT NOTIFICATION ==');
    const assignNotifRow = await q(`select count(*)::int n from competition.notifications where event_code='COMPETITION_REVIEW_ASSIGNED' and submission_id=$1`, [s1.submission.id]);
    ok(assignNotifRow.rows[0].n === 1, 'assignment creates exactly one reviewer notification', assignNotifRow.rows[0]);

    console.log('\n== REVIEWER APPROVE / UPGRADE ==');
    await call(REVL1, 'competition.submission.review', { campaignId: CID, submissionId: s1.submission.id, action: 'approve', levelOrder: 1 });
    // ensureHighAssignment should have created a primary_high assignment to REVL2 (only maxLevel>=2 reviewer)
    const highAssign = await q(`select reviewer_account_id from competition.review_assignments where submission_id=$1 and tier='primary_high' and is_active`, [s1.submission.id]);
    ok(highAssign.rows.length === 1 && highAssign.rows[0].reviewer_account_id === REVL2.accountId, 'ensureHighAssignment hands off to REVL2', highAssign.rows);
    await call(REVL2, 'competition.submission.review', { campaignId: CID, submissionId: s1.submission.id, action: 'upgrade', levelOrder: 2 });

    const approveNotif = await q(`select count(*)::int n from competition.notifications where event_code='COMPETITION_SUBMISSION_APPROVED' and submission_id=$1`, [s1.submission.id]);
    ok(approveNotif.rows[0].n === 1, 'approve -> exactly one COMPETITION_SUBMISSION_APPROVED notification', approveNotif.rows[0]);
    const upgradeNotif = await q(`select count(*)::int n, message from competition.notifications where event_code='COMPETITION_SUBMISSION_UPGRADED' and submission_id=$1 group by message`, [s1.submission.id]);
    ok(upgradeNotif.rows.length === 1 && upgradeNotif.rows[0].n === 1 && /5 điểm/.test(upgradeNotif.rows[0].message), 'upgrade -> one notification, correct score copy', upgradeNotif.rows);

    console.log('\n== REJECT / REVISION NOTE, NO REVIEWER IDENTITY ==');
    await call(REVL1, 'competition.submission.review', { campaignId: CID, submissionId: s2.submission.id, action: 'reject', note: 'nội dung không phù hợp' });
    await call(REVL1, 'competition.submission.review', { campaignId: CID, submissionId: s3.submission.id, action: 'request_revision', note: 'cần bổ sung chi tiết' });
    const rejMsg = await q(`select message from competition.notifications where event_code='COMPETITION_SUBMISSION_REJECTED' and submission_id=$1`, [s2.submission.id]);
    ok(rejMsg.rows[0] && /nội dung không phù hợp/.test(rejMsg.rows[0].message), 'reject notification carries the note text', rejMsg.rows);
    ok(!JSON.stringify(rejMsg.rows).match(/SYN4-RL1|SYN4-ACC-RL1/), 'reject notification carries no reviewer identity');
    const revMsg = await q(`select message from competition.notifications where event_code='COMPETITION_SUBMISSION_REVISION_REQUESTED' and submission_id=$1`, [s3.submission.id]);
    ok(revMsg.rows[0] && /cần bổ sung chi tiết/.test(revMsg.rows[0].message), 'revision notification carries the note text');
    ok(!JSON.stringify(revMsg.rows).match(/SYN4-RL1|SYN4-ACC-RL1/), 'revision notification carries no reviewer identity');

    console.log('\n== MY REVIEWED — REVL1 / REVL2 SEE CORRECT ROWS, NO AUTHOR IDENTITY ==');
    const mr1 = await call(REVL1, 'competition.review.myReviewed', { campaignId: CID });
    const mr1json = JSON.stringify(mr1);
    ok(!/SYN4-P\d|SYN4-ACC-P/.test(mr1json), 'myReviewed carries NO author identity', mr1json.slice(0, 160));
    ok(mr1.items.some((i) => i.submissionRef === s1.submission.id && i.myAction === 'approve'), 'REVL1 row reflects the actor who ACTUALLY processed s1 (approve)', mr1.items.map((i) => i.myAction));
    ok(mr1.items.some((i) => i.submissionRef === s2.submission.id && i.myAction === 'reject'), 'REVL1 sees s2 reject');
    ok(mr1.items.some((i) => i.submissionRef === s3.submission.id && i.myAction === 'revision_requested'), 'REVL1 sees s3 revision_requested');
    const s1Row = mr1.items.filter((i) => i.submissionRef === s1.submission.id)[0];
    ok(s1Row && s1Row.currentStatus === 'approved' && Number(s1Row.currentScore) === 5, 'REVL1 sees CURRENT result reflecting REVL2 later upgrade (5), not stale 2', s1Row);
    ok(s1Row && s1Row.effectiveScore === 5 && s1Row.adjusted === false, 'REVL1 sees V1.3 effectiveScore/adjusted fields, not yet adjusted', s1Row);

    const mr2 = await call(REVL2, 'competition.review.myReviewed', { campaignId: CID });
    ok(mr2.items.some((i) => i.submissionRef === s1.submission.id && i.myAction === 'upgrade'), 'REVL2 sees its own upgrade action on s1');

    console.log('\n== PRODUCTIVITY COUNT CONSISTENCY ==');
    const prod1 = await call(REVL1, 'competition.review.productivity', { campaignId: CID });
    ok(prod1.processed === mr1.items.length, 'REVL1 productivity.processed === myReviewed row count', { processed: prod1.processed, rows: mr1.items.length });
    const prod2 = await call(REVL2, 'competition.review.productivity', { campaignId: CID });
    ok(prod2.processed === mr2.items.length, 'REVL2 productivity.processed === myReviewed row count', { processed: prod2.processed, rows: mr2.items.length });

    console.log('\n== STATUS FILTER ==');
    const mr1Rejected = await call(REVL1, 'competition.review.myReviewed', { campaignId: CID, statusFilter: 'rejected' });
    ok(mr1Rejected.items.length === 1 && mr1Rejected.items[0].submissionRef === s2.submission.id, 'statusFilter=rejected narrows correctly', mr1Rejected.items);

    console.log('\n== OPEN-POOL CASE: ADMIN PROCESSES A SUBMISSION ASSIGNED TO SOMEONE ELSE ==');
    const s4 = await draftAndSubmit(P(4), 'q4 — open pool test');
    const s4AssignedTo = s4.assignment.reviewerAccountId;
    // ADMIN (not the assigned reviewer) approves directly — exercises the
    // completeAssignmentForReviewer "processed_by_other_reviewer" branch.
    await call(ADMIN, 'competition.submission.review', { campaignId: CID, submissionId: s4.submission.id, action: 'approve', levelOrder: 1 });
    const adminCompleted = await q(`select count(*)::int n from competition.review_assignments where submission_id=$1 and status='completed' and reviewer_account_id=$2`, [s4.submission.id, ADMIN.accountId]);
    ok(adminCompleted.rows[0].n === 1, 'a completed assignment row is attributed to the ACTUAL acting admin, not the original assignee', { s4AssignedTo, adminCompleted: adminCompleted.rows[0] });
    const staleReassigned = await q(`select count(*)::int n from competition.review_assignments where submission_id=$1 and status='reassigned' and reviewer_account_id=$2`, [s4.submission.id, s4AssignedTo]);
    ok(staleReassigned.rows[0].n === 1, 'the original assignee\'s stale assignment is closed out as reassigned (audited), not left dangling', staleReassigned.rows[0]);
    const mrAdmin = await call(ADMIN, 'competition.review.myReviewed', { campaignId: CID });
    ok(mrAdmin.items.some((i) => i.submissionRef === s4.submission.id && i.myAction === 'approve'), 'ADMIN\'s own "Bài tôi đã duyệt" reflects the open-pool approval it actually performed', mrAdmin.items.map((i) => i.submissionRef));
    const prodAdmin = await call(ADMIN, 'competition.review.productivity', { campaignId: CID });
    ok(prodAdmin.processed === mrAdmin.items.length, 'ADMIN productivity.processed === myReviewed row count (open-pool case included)', { processed: prodAdmin.processed, rows: mrAdmin.items.length });

    console.log('\n== REVIEWER 2 CANNOT ADJUST (adjustScore, top-level/admin only) ==');
    await expectReject('COMPETITION_ADJUSTMENT_NOT_AUTHORIZED', () => call(REVL1, 'competition.submission.adjustScore', { campaignId: CID, submissionId: s1.submission.id, targetLevelOrder: 0, reason: 'should be blocked' }), 'Reviewer 2 (max level 1, non-admin) cannot call adjustScore');

    console.log('\n== ADJUSTMENT (V1.3 adjustScore): HISTORY PRESERVED, "Kết quả hiện tại" CHANGES, NOTIFICATION FIRES ==');
    const beforeHistCount = await q(`select count(*)::int n from competition.submission_history where submission_id=$1 and action='approve'`, [s1.submission.id]);
    await call(ADMIN, 'competition.submission.adjustScore', { campaignId: CID, submissionId: s1.submission.id, targetLevelOrder: 0, reason: 'điều chỉnh lại theo audit' });
    const afterHistCount = await q(`select count(*)::int n from competition.submission_history where submission_id=$1 and action='approve'`, [s1.submission.id]);
    ok(beforeHistCount.rows[0].n === afterHistCount.rows[0].n, 'original approve history row is UNCHANGED (append-only) after adjustment', { before: beforeHistCount.rows[0].n, after: afterHistCount.rows[0].n });
    const mr1After = await call(REVL1, 'competition.review.myReviewed', { campaignId: CID });
    const s1RowAfter = mr1After.items.filter((i) => i.submissionRef === s1.submission.id)[0];
    ok(s1RowAfter && s1RowAfter.currentStatus === 'approved' && s1RowAfter.myAction === 'approve' && s1RowAfter.effectiveScore === 0 && s1RowAfter.adjusted === true,
      '"Kết quả hiện tại" (effectiveScore=0/adjusted) reflects the new state while "Bạn đã xử lý" (myAction) stays approve', s1RowAfter);
    const adjustNotif = await q(`select count(*)::int n, message from competition.notifications where event_code='COMPETITION_SUBMISSION_ADJUSTED' and submission_id=$1 group by message`, [s1.submission.id]);
    ok(adjustNotif.rows.length === 1 && adjustNotif.rows[0].n === 1 && /5 điểm/.test(adjustNotif.rows[0].message) && /Không ghi nhận/.test(adjustNotif.rows[0].message),
      'adjustScore(->0) -> one COMPETITION_SUBMISSION_ADJUSTED notification with correct from->to (5 điểm -> Không ghi nhận)', adjustNotif.rows);

    console.log('\n== MANUAL REASSIGN: OLD REVIEWER NOT SPAMMED, NEW REVIEWER NOTIFIED ==');
    const s5 = await draftAndSubmit(P(5), 'q5 — reassign test');
    const oldReviewer = s5.assignment.reviewerAccountId;
    const oldReviewerBefore = await q(`select count(*)::int n from competition.notifications where event_code='COMPETITION_REVIEW_ASSIGNED' and recipient_account_id=$1`, [oldReviewer]);
    const targetReviewer = oldReviewer === REVL1.accountId ? REVL2 : REVL1;
    await call(ADMIN, 'competition.review.reassign', { campaignId: CID, assignmentId: s5.assignment.id, toAccountId: targetReviewer.accountId, toEmployeeCode: targetReviewer.employeeCode, reason: 'manual reassign test' });
    const oldReviewerAfter = await q(`select count(*)::int n from competition.notifications where event_code='COMPETITION_REVIEW_ASSIGNED' and recipient_account_id=$1`, [oldReviewer]);
    ok(oldReviewerBefore.rows[0].n === oldReviewerAfter.rows[0].n, 'revoked/replaced reviewer receives NO extra notification on reassign', { before: oldReviewerBefore.rows[0].n, after: oldReviewerAfter.rows[0].n });
    const newReviewerNotif = await q(`select count(*)::int n from competition.notifications where event_code='COMPETITION_REVIEW_ASSIGNED' and submission_id=$1 and recipient_account_id=$2`, [s5.submission.id, targetReviewer.accountId]);
    ok(newReviewerNotif.rows[0].n === 1, 'new reviewer gets exactly one reassignment notification', newReviewerNotif.rows[0]);

    console.log('\n== DEDUPE (ON CONFLICT DO NOTHING) ==');
    const dedupeKey = 'cmp:test-dedupe:' + Date.now();
    const r1 = await withAppTx((c) => emitCompetitionNotifications({
      client: c, eventCode: 'COMPETITION_SUBMISSION_APPROVED', submissionId: s1.submission.id,
      title: 't', message: 'm', recipients: [{ employeeCode: P(1).employeeCode }], actor: {}, dedupeKey,
    }));
    const r2 = await withAppTx((c) => emitCompetitionNotifications({
      client: c, eventCode: 'COMPETITION_SUBMISSION_APPROVED', submissionId: s1.submission.id,
      title: 't', message: 'm (retry)', recipients: [{ employeeCode: P(1).employeeCode }], actor: {}, dedupeKey,
    }));
    ok(r1.created === 1 && r2.created === 0, 'retrying the SAME dedupe key creates 0 (idempotent)', { r1, r2 });
    const dedupeKey2 = dedupeKey + ':new-event';
    const r3 = await withAppTx((c) => emitCompetitionNotifications({
      client: c, eventCode: 'COMPETITION_SUBMISSION_APPROVED', submissionId: s1.submission.id,
      title: 't', message: 'm2', recipients: [{ employeeCode: P(1).employeeCode }], actor: {}, dedupeKey: dedupeKey2,
    }));
    ok(r3.created === 1, 'a genuinely new dedupe key still creates a new row', r3);

    console.log('\n== READ / MARK READ ==');
    const listP1 = await call(P(1), 'competition.notification.list', {});
    ok(listP1.notifications.length >= 1, 'participant can list own notifications', listP1.notifications.length);
    const someUnread = listP1.notifications.find((n) => n.status === 'unread');
    if (someUnread) {
      const markRes = await call(P(1), 'competition.notification.markRead', { id: someUnread.id });
      ok(markRes.updated === 1, 'markRead updates exactly the caller\'s own row');
      const listAfter = await call(P(1), 'competition.notification.list', {});
      ok(listAfter.notifications.find((n) => n.id === someUnread.id).status === 'read', 'row shows read after markRead');
    } else ok(true, 'no unread row to mark (non-fatal, environment order-dependent)');
    const markAllRes = await call(P(1), 'competition.notification.markAllRead');
    ok(typeof markAllRes.updated === 'number', 'markAllRead returns updated count');
    // cross-identity isolation — P(2) cannot see/mark P(1)'s rows
    const listP2 = await call(P(2), 'competition.notification.list', {});
    const p1NotifId = someUnread && someUnread.id;
    ok(!p1NotifId || !listP2.notifications.some((n) => n.id === p1NotifId), 'participant cannot read another participant\'s notifications');
    await expectReject('COMPETITION_NOTIFICATION_ID_REQUIRED', () => call(P(2), 'competition.notification.markRead', {}), 'markRead without an id is rejected, not a silent no-op');
    if (p1NotifId) {
      const crossMark = await call(P(2), 'competition.notification.markRead', { id: p1NotifId });
      ok(crossMark.updated === 0, 'P(2) cannot mark P(1)\'s notification as read (0 rows updated, not an error leak)', crossMark);
    }

    console.log('\n== FEED / anonymity regression spot-check ==');
    const queue = await call(REVL1, 'competition.review.queue', { campaignId: CID });
    ok(!JSON.stringify(queue).match(/SYN4-P\d|SYN4-ACC-P/), 'review queue still carries no author identity (unaffected)');

  } finally {
    cleanupFixture();
    await admin.end();
  }

  console.log('\n== SUMMARY ==');
  console.log('PASS=' + PASS + ' FAIL=' + FAIL);
  if (fails.length) { console.log('FAILED:'); fails.forEach((f) => console.log('  - ' + f)); }
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
