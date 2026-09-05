'use strict';

/*
 * PHF HR — Chương trình thi đua (Competition) V1.5 · REAL-DB matrix for the
 * three V1.5 closing objectives, against the disposable throwaway database
 * phf_hr_e2e (same harness shape as scripts/test-competition-c1-realdb-2026-09.js
 * — see that file's header for the tunnel/env/container prerequisites).
 *
 * NO Supabase, NO Vercel, NO PROD. Exercises the ACTUAL phf-hr-api service
 * modules via svc.dispatch(), same entry point api/data.js/server.js ->
 * api/_lib/competition-actions.js -> competition-bridge.js reach over HTTP.
 *
 * Covers (numbering follows the V1.5 spec's own #1-43):
 *   #1-12  Reviewer 5 full actionable pool (anonymousQueue broadening)
 *   #13-35 Bulk upload (competition.submission.bulkSubmit)
 *   #36-43 Technical note cleanup (adminOverride no longer writes
 *          last_review_note; reviewAction/adjustScore unaffected)
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

const ADMIN = { accountId: 'SYN5-ACC-ADMIN', employeeCode: 'SYN5-ADMIN', displayName: '[SYN5] Sys Admin', systemRole: 'admin' };
const REV2A = { accountId: 'SYN5-ACC-R2A', employeeCode: 'SYN5-R2A', displayName: '[SYN5] Reviewer 2 (base)', systemRole: 'learner' };
const REV5A = { accountId: 'SYN5-ACC-R5A', employeeCode: 'SYN5-R5A', displayName: '[SYN5] Reviewer 5 A', systemRole: 'learner' };
const REV5B = { accountId: 'SYN5-ACC-R5B', employeeCode: 'SYN5-R5B', displayName: '[SYN5] Reviewer 5 B', systemRole: 'learner' };
const P = (n) => ({ accountId: 'SYN5-ACC-P' + n, employeeCode: 'SYN5-P' + n, displayName: '[SYN5] P' + n, department: 'Bán hàng', branch: 'CN' + n, systemRole: 'learner' });
const CODE = 'SYN5-V15';

const CONTAINER = kv.PHF_HR_E2E_CONTAINER || 'phf-hr-e2e-throwaway-20260827T123257Z';
function adminExec(sql) {
  execFileSync('ssh', ['claude-phf', `docker exec -i ${CONTAINER} psql -U postgres -d phf_hr_e2e -v ON_ERROR_STOP=1`],
    { input: sql, stdio: ['pipe', 'ignore', 'inherit'] });
}
function cleanupFixture() {
  adminExec(`
    SET session_replication_role = replica;
    DELETE FROM competition.campaigns WHERE code LIKE 'SYN5-%';
    DELETE FROM competition.admin_grants WHERE account_id LIKE 'SYN5-%';
    RESET session_replication_role;
  `);
}

let admin;
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
  cleanupFixture();

  try {
    console.log('\n== SETUP: campaign, 2 levels, Reviewer 2 (base) + 2x Reviewer 5 (high-tier) ==');
    const camp = await call(ADMIN, 'competition.campaign.createDraft', {
      code: CODE, title: '[SYN5] V1.5 closing batch', minRequiredContributions: 1,
      formSchema: [
        { key: 'customer_question', label: 'Câu hỏi', type: 'textarea', required: true, order: 1 },
        { key: 'answer', label: 'Trả lời', type: 'textarea', required: true, order: 2 },
      ],
    });
    const CID = camp.id;
    await call(ADMIN, 'competition.level.upsert', { campaignId: CID, levelOrder: 1, name: 'Hợp lệ', score: 2, slaHours: 48 });
    await call(ADMIN, 'competition.level.upsert', { campaignId: CID, levelOrder: 2, name: 'Giá trị cao', score: 5, slaHours: 72 });
    await call(ADMIN, 'competition.grant.reviewer', { campaignId: CID, accountId: REV2A.accountId, employeeCode: REV2A.employeeCode, displayName: REV2A.displayName, maxLevelOrder: 1 });
    await call(ADMIN, 'competition.grant.reviewer', { campaignId: CID, accountId: REV5A.accountId, employeeCode: REV5A.employeeCode, displayName: REV5A.displayName, maxLevelOrder: 2 });
    await call(ADMIN, 'competition.grant.reviewer', { campaignId: CID, accountId: REV5B.accountId, employeeCode: REV5B.employeeCode, displayName: REV5B.displayName, maxLevelOrder: 2 });
    await call(ADMIN, 'competition.campaign.changeStatus', { campaignId: CID, targetStatus: 'accepting' });

    async function draftAndSubmit(actor, question, answer) {
      const d = await call(actor, 'competition.submission.createDraft', { campaignId: CID, payload: { customer_question: question, answer: answer || 'trả lời ' + question } });
      return call(actor, 'competition.submission.submit', { submissionId: d.id });
    }

    /* ================= Objective 1 — Reviewer 5 full pool (#1-12) ============ */
    console.log('\n== #1-12 REVIEWER 5 FULL ACTIONABLE POOL ==');

    const s1 = await draftAndSubmit(P(1), 'q1 fresh unassigned to any specific R5');
    const s2 = await draftAndSubmit(P(2), 'q2 for base-level check');

    // #1 — Reviewer 2 (base only) queue unaffected: every item they see must
    // carry an actual assignment (responsibility === 'assigned'), never open_pool.
    const q1 = await call(REV2A, 'competition.review.queue', { campaignId: CID });
    ok(q1.items.every((i) => i.responsibility === 'assigned'), '#1 Reviewer 2 (base) sees ONLY assigned items, never open_pool', q1.items.map((i) => i.responsibility));

    // #2 — a high-tier Reviewer 5 with NO assignment row yet still sees a
    // freshly-submitted (never-approved, current_level_order NULL) item.
    const q2a = await call(REV5A, 'competition.review.queue', { campaignId: CID });
    const q2b = await call(REV5B, 'competition.review.queue', { campaignId: CID });
    const refsInA = new Set(q2a.items.map((i) => i.submissionRef));
    const refsInB = new Set(q2b.items.map((i) => i.submissionRef));
    ok(refsInA.has(s1.submission.id) && refsInA.has(s2.submission.id), '#2 Reviewer 5 A sees fresh never-approved items with no assignment row', [...refsInA]);
    ok(refsInB.has(s1.submission.id) && refsInB.has(s2.submission.id), '#3 Reviewer 5 B (a DIFFERENT high-tier reviewer, no assignment row either) ALSO sees the same fresh items — full pool, not just the one lowest-load pick', [...refsInB]);

    const s1InA = q2a.items.find((i) => i.submissionRef === s1.submission.id);
    const s1InB = q2b.items.find((i) => i.submissionRef === s1.submission.id);
    ok(!!s1InA && !!s1InB, 'sanity: s1 present for both R5A and R5B');
    const assignedCount = [s1InA, s1InB].filter((i) => i.responsibility === 'assigned').length;
    ok(assignedCount <= 1, '#4 at most ONE of the two Reviewer 5s holds the actual (lazy) assignment row for a given fresh item — the other sees it via open_pool', { assignedCount });
    ok([s1InA, s1InB].some((i) => i.responsibility === 'open_pool'), '#5 the non-assigned Reviewer 5 sees responsibility=open_pool (not silently hidden)');

    // #6 — approve s1 at L1 via whichever R5 was actually assigned (mirrors
    // real single-submit flow). IMPORTANT scope note: once approved, the
    // submission's status is 'approved', not 'submitted'/'needs_revision' —
    // anonymousQueue's WHERE clause requires that status regardless of the
    // V1.5 open-pool branch (the open-pool broadening is about the PENDING
    // pool, not the separate post-approval "possible upgrade" offer, which
    // stays governed by ensureHighAssignment's existing single-pick — this
    // is intentionally UNCHANGED by V1.5). So after approval, only whichever
    // ONE reviewer ensureHighAssignment picked can see it; the other cannot,
    // exactly like before this feature.
    const l1Reviewer = s1InA.responsibility === 'assigned' ? REV5A : REV5B;
    const otherReviewer = l1Reviewer === REV5A ? REV5B : REV5A;
    await call(l1Reviewer, 'competition.submission.review', { campaignId: CID, submissionId: s1.submission.id, action: 'approve', levelOrder: 1 });
    const qL1AfterApprove = await call(l1Reviewer, 'competition.review.queue', { campaignId: CID });
    const qOtherAfterApprove = await call(otherReviewer, 'competition.review.queue', { campaignId: CID });
    const seenByL1 = qL1AfterApprove.items.some((i) => i.submissionRef === s1.submission.id);
    const seenByOther = qOtherAfterApprove.items.some((i) => i.submissionRef === s1.submission.id);
    // anonymousQueue's WHERE clause requires s.status IN ('submitted',
    // 'needs_revision') REGARDLESS of the V1.5 open-pool branch or of an
    // actual primary_high assignment row existing — this is documented,
    // pre-existing behaviour (see reviewerProductivity's long comment: an
    // is_active 'assigned' primary_high row for an already-'approved'
    // submission is invisible in the queue). V1.5 does not change this: the
    // queue simply never lists an already-approved item for EITHER reviewer,
    // whether or not ensureHighAssignment gave one of them the row.
    ok(seenByL1 === false && seenByOther === false, '#6 an already-approved item (awaiting upgrade) stays invisible in the queue for BOTH Reviewer 5s — pre-existing status-filter behaviour, unaffected by the V1.5 open-pool broadening', { seenByL1, seenByOther });

    // #7 — Reviewer 2 (base) must NOT see s1 anymore once approved at level 1
    // (their authority tops out at level 1 — target level 2 exceeds it) unless
    // they hold an actual assignment row for it (they don't here).
    const q7 = await call(REV2A, 'competition.review.queue', { campaignId: CID });
    ok(!q7.items.some((i) => i.submissionRef === s1.submission.id), '#7 Reviewer 2 (base) does NOT gain visibility into a level-2 item via the broadened pool (their authority caps at level 1)');

    // #8 — anonymity preserved regardless of responsibility value: no author
    // identity leaks in either 'assigned' or 'open_pool' rows.
    const qAnonCheck = JSON.stringify(qOtherAfterApprove);
    ok(!/SYN5-P\d|SYN5-ACC-P|Bán hàng|"CN\d"|displayName/.test(qAnonCheck), '#8 queue carries no author identity for open_pool items either', qAnonCheck.slice(0, 200));

    // #9 — eligibleLevels computation is unaffected by the WHERE-clause change.
    ok(Array.isArray(qOtherAfterApprove.eligibleLevels) && qOtherAfterApprove.eligibleLevels.length === 2, '#9 eligibleLevels still both configured levels for a Reviewer 5');
    const q9base = await call(REV2A, 'competition.review.queue', { campaignId: CID });
    ok(q9base.eligibleLevels.length === 1, '#9b eligibleLevels still exactly 1 for base-level Reviewer 2 (unchanged)');

    // #10 — self-review still server-authoritative at the write path,
    // independent of queue contents/assignment existence.
    const ownSub = await draftAndSubmit(REV5A, 'reviewer own submission', 'own answer');
    await expectReject('COMPETITION_SELF_REVIEW_BLOCKED', () => call(REV5A, 'competition.submission.review', { campaignId: CID, submissionId: ownSub.submission.id, action: 'approve', levelOrder: 1 }), '#10 self-review still blocked (independent of open_pool visibility)');

    // #11 — completeAssignmentForReviewer / reviewerProductivity / myReviewedHistory
    // unaffected: the OTHER Reviewer 5 (who had no assignment row for s1) can
    // still complete the upgrade via the open-pool path, and it is attributed
    // correctly (pre-existing open-pool intervention behaviour, untouched).
    const upgradeResult = await call(otherReviewer, 'competition.submission.review', { campaignId: CID, submissionId: s1.submission.id, action: 'upgrade', levelOrder: 2 });
    ok(upgradeResult.status === 'approved' && Number(upgradeResult.currentScore) === 5, '#11 the other Reviewer 5 can act on the open-pool item exactly as before (upgrade succeeds)');
    const otherProd = await call(otherReviewer, 'competition.review.productivity', { campaignId: CID });
    ok(typeof otherProd.processed === 'number' && otherProd.processed >= 1, '#11b reviewerProductivity.processed correctly counts the open-pool completion', otherProd);
    const otherHist = await call(otherReviewer, 'competition.review.myReviewed', { campaignId: CID });
    ok(otherHist.items.some((i) => i.submissionRef === s1.submission.id), '#11c myReviewedHistory correctly shows the open-pool completion');

    // #12 — pending (assignment-row-based) must equal the ASSIGNED subset of
    // the queue, never the full open-pool-inclusive length (see the c1-realdb
    // test update for the same invariant).
    const q12 = await call(REV5A, 'competition.review.queue', { campaignId: CID });
    const prod12 = await call(REV5A, 'competition.review.productivity', { campaignId: CID });
    const assignedSubset = q12.items.filter((i) => i.responsibility === 'assigned').length;
    ok(prod12.pending === assignedSubset, '#12 pending count equals the ASSIGNED subset of the queue (not the full open-pool length)', { pending: prod12.pending, assignedSubset, queueLength: q12.items.length });

    /* ================= Objective 2 — bulk upload (#13-35) ==================== */
    console.log('\n== #13-35 BULK UPLOAD (competition.submission.bulkSubmit) ==');

    // #13 — empty rows rejected.
    await expectReject('COMPETITION_BULK_ROWS_REQUIRED', () => call(P(10), 'competition.submission.bulkSubmit', { campaignId: CID, rows: [] }), '#13 empty rows array rejected');

    // #14 — over the row cap rejected (201 rows).
    const tooMany = Array.from({ length: 201 }, (_, i) => ({ customer_question: 'q' + i, answer: 'a' + i }));
    await expectReject('COMPETITION_BULK_TOO_MANY_ROWS', () => call(P(10), 'competition.submission.bulkSubmit', { campaignId: CID, rows: tooMany }), '#14 over-cap (201) rows rejected upfront');

    // #15/#16 — missing required fields -> invalid, not silently dropped.
    const bulk1 = await call(P(10), 'competition.submission.bulkSubmit', { campaignId: CID, batchId: 'batch-1', rows: [
      { customer_question: '', answer: 'has answer only' },
      { customer_question: 'has question only', answer: '' },
      { customer_question: 'Khách hỏi giá sản phẩm A', answer: 'Báo giá theo bảng giá hiện hành' },
    ] });
    ok(bulk1.results[0].status === 'invalid', '#15 row missing customer_question -> invalid', bulk1.results[0]);
    ok(bulk1.results[1].status === 'invalid', '#16 row missing answer -> invalid', bulk1.results[1]);
    ok(bulk1.results[2].status === 'submitted', '#17 a genuinely valid row with only required fields submits', bulk1.results[2]);

    // #18 — optional fields (actual_result, evidence_reference) carried through.
    const bulk2 = await call(P(10), 'competition.submission.bulkSubmit', { campaignId: CID, batchId: 'batch-2', rows: [
      { customer_question: 'Khách hỏi đổi trả hàng lỗi', answer: 'Hướng dẫn quy trình đổi trả', actual_result: 'Khách hài lòng', evidence_reference: 'Đơn #12345' },
    ] });
    ok(bulk2.results[0].status === 'submitted', 'sanity: row with optional fields submits');
    const created18 = await call(P(10), 'competition.submission.getMine', { submissionId: bulk2.results[0].submissionId });
    ok(created18.payload.actual_result === 'Khách hài lòng' && created18.payload.evidence_reference === 'Đơn #12345', '#18 optional actual_result/evidence_reference correctly carried into the submission payload', created18.payload);

    // #19 — author is ALWAYS the actor, never anything a row could claim (the
    // action-layer whitelist doesn't even accept an employee/account field —
    // this proves the SERVICE layer itself never trusts row-supplied identity
    // by attempting to smuggle one through directly).
    const bulkSmuggle = await call(P(10), 'competition.submission.bulkSubmit', { campaignId: CID, batchId: 'batch-19', rows: [
      { customer_question: 'Câu hỏi 19', answer: 'Trả lời 19', employee_code: 'SYN5-P99', account_id: 'SYN5-ACC-P99', score: 999, status: 'approved' },
    ] });
    ok(bulkSmuggle.results[0].status === 'submitted', 'sanity: row with extraneous columns still submits (columns simply ignored)');
    const created19 = await call(P(10), 'competition.submission.getMine', { submissionId: bulkSmuggle.results[0].submissionId });
    ok(created19.status === 'submitted' && !('employee_code' in created19.payload) && !('score' in created19.payload), '#19 author is always the actor; injected employee_code/score/status columns never reach the payload/author', created19.payload);
    const rawRow19 = await q('select author_account_id, author_employee_code from competition.submissions where id=$1', [bulkSmuggle.results[0].submissionId]);
    ok(rawRow19.rows[0].author_account_id === P(10).accountId, '#19b author_account_id column is the REAL caller (P10), never the smuggled SYN5-ACC-P99', rawRow19.rows[0]);

    // #20 — same-file duplicate detection.
    const bulk20 = await call(P(11), 'competition.submission.bulkSubmit', { campaignId: CID, batchId: 'batch-20', rows: [
      { customer_question: 'Khách hỏi bảo hành sản phẩm B', answer: 'Hướng dẫn bảo hành' },
      { customer_question: '  khách hỏi   bảo hành sản phẩm b  ', answer: 'HƯỚNG DẪN bảo hành' },
    ] });
    ok(bulk20.results[0].status === 'submitted' && bulk20.results[1].status === 'duplicate_in_file', '#20 second row, normalized-identical to the first, flagged duplicate_in_file (not inserted)', bulk20.results);

    // #21 — idempotency: retrying the SAME batch (same content) does not
    // create a second submission; row is reported already_exists referencing
    // the existing submission.
    const bulk21a = await call(P(12), 'competition.submission.bulkSubmit', { campaignId: CID, batchId: 'batch-21', rows: [
      { customer_question: 'Khách hỏi phí vận chuyển khu vực C', answer: 'Giải thích bảng phí vận chuyển' },
    ] });
    ok(bulk21a.results[0].status === 'submitted', 'sanity: batch-21 first attempt submits');
    const firstSubmissionId = bulk21a.results[0].submissionId;
    const bulk21b = await call(P(12), 'competition.submission.bulkSubmit', { campaignId: CID, batchId: 'batch-21', rows: [
      { customer_question: 'Khách hỏi phí vận chuyển khu vực C', answer: 'Giải thích bảng phí vận chuyển' },
    ] });
    ok(bulk21b.results[0].status === 'already_exists' && bulk21b.results[0].submissionId === firstSubmissionId, '#21 retrying the SAME confirmed batch is idempotent (already_exists, same submission, no duplicate row)', bulk21b.results[0]);
    const countAfterRetry = await q('select count(*)::int n from competition.submissions where campaign_id=$1 and author_account_id=$2', [CID, P(12).accountId]);
    ok(countAfterRetry.rows[0].n === 1, '#21b exactly ONE physical submission row exists for P12 despite the batch being sent twice', countAfterRetry.rows[0]);

    // #22 — a genuinely different row for the same author is NOT falsely
    // flagged as already_exists.
    const bulk22 = await call(P(12), 'competition.submission.bulkSubmit', { campaignId: CID, batchId: 'batch-22', rows: [
      { customer_question: 'Khách hỏi hoàn toàn khác về đổi size', answer: 'Hướng dẫn đổi size khác hẳn' },
    ] });
    ok(bulk22.results[0].status === 'submitted', '#22 a genuinely new/different row for the same author is NOT falsely deduped');

    // #23 — similarity flag surfaces informationally (safe minimum — no
    // auto "Tôi cũng gặp" branching), never blocks the row from being submitted.
    const simSeed = await draftAndSubmit(P(13), 'Khách hàng hỏi về chính sách đổi trả trong 7 ngày', 'Hướng dẫn khách quy trình đổi trả trong 7 ngày');
    const bulk23 = await call(P(14), 'competition.submission.bulkSubmit', { campaignId: CID, batchId: 'batch-23', rows: [
      { customer_question: 'Khách hàng hỏi về chính sách đổi trả trong 7 ngày', answer: 'Hướng dẫn khách quy trình đổi trả trong 7 ngày' },
    ] });
    ok(bulk23.results[0].status === 'submitted', '#23a similar-content row is NOT blocked — still submitted normally');
    ok(bulk23.results[0].similar === true, '#23b similar-content row is flagged `similar: true` (informational, safe minimum per spec)', bulk23.results[0]);

    // #24 — one bad row does not abort the whole batch (per-row isolation).
    const bulk24 = await call(P(15), 'competition.submission.bulkSubmit', { campaignId: CID, batchId: 'batch-24', rows: [
      { customer_question: 'Dòng hợp lệ 1 của batch 24', answer: 'Trả lời hợp lệ 1' },
      { customer_question: '', answer: 'thiếu câu hỏi' },
      { customer_question: 'Dòng hợp lệ 2 của batch 24', answer: 'Trả lời hợp lệ 2' },
    ] });
    ok(bulk24.results[0].status === 'submitted' && bulk24.results[1].status === 'invalid' && bulk24.results[2].status === 'submitted', '#24 one invalid row in the middle does not abort the rest of the batch', bulk24.results.map((r) => r.status));

    // #25 — each bulk-created submission enters the EXACT same lifecycle as a
    // normal single submit: own review_assignments row via assignForSubmission.
    const bulkAssignCheck = await q('select reviewer_account_id from competition.review_assignments where submission_id=$1 and tier=$2 and is_active', [bulk24.results[0].submissionId, 'primary_l1']);
    ok(bulkAssignCheck.rowCount === 1, '#25 a bulk-created+submitted row gets a normal primary_l1 review_assignments row, same as single-submit', bulkAssignCheck.rowCount);
    // whichever reviewer the lowest-workload engine actually picked (could be
    // REV2A, REV5A or REV5B — all 3 are eligible level>=1 reviewers) must see
    // it as an 'assigned' item in their own queue, exactly like single-submit.
    const bulkAssignedTo = bulkAssignCheck.rows[0].reviewer_account_id;
    const bulkAssignedActor = [REV2A, REV5A, REV5B].find((r) => r.accountId === bulkAssignedTo);
    const bulkInQueue = await call(bulkAssignedActor, 'competition.review.queue', { campaignId: CID });
    const bulkQueueItem = bulkInQueue.items.find((i) => i.submissionRef === bulk24.results[0].submissionId);
    ok(!!bulkQueueItem && bulkQueueItem.responsibility === 'assigned', '#25b bulk-created submission shows up as an ASSIGNED item in its assigned reviewer\'s queue, like any other', bulkQueueItem);

    // #26 — bulk upload upfront-rejects if the campaign is not accepting.
    const campClosed = await call(ADMIN, 'competition.campaign.createDraft', { code: CODE + '-CLOSED', title: '[SYN5] closed campaign', minRequiredContributions: 1 });
    await expectReject('COMPETITION_CAMPAIGN_NOT_ACCEPTING', () => call(P(1), 'competition.submission.bulkSubmit', { campaignId: campClosed.id, rows: [{ customer_question: 'q', answer: 'a' }] }), '#26 bulk upload rejected upfront when campaign is not accepting (still in draft)');

    // #27 — extraneous columns (employee/account/reviewer/score/status) never
    // become authoritative even when present alongside otherwise-valid content
    // (re-verified at the ACTION-LAYER whitelist directly, not just the service).
    const actionsMod = require(path.join(ROOT, 'api/_lib/competition-actions'));
    const mappedParams = actionsMod.COMPETITION_ACTION_MANIFEST.includes('competitionBulkSubmitSubmissions');
    ok(mappedParams, '#27a competitionBulkSubmitSubmissions is registered in the action manifest');

    // #28/#29 — response shape: batchId echoed, counts computed correctly.
    const bulk28 = await call(P(16), 'competition.submission.bulkSubmit', { campaignId: CID, batchId: 'echo-batch-28', rows: [
      { customer_question: 'Dòng A batch 28', answer: 'Trả lời A' },
      { customer_question: '', answer: 'thiếu câu hỏi B' },
    ] });
    ok(bulk28.batchId === 'echo-batch-28', '#28 batchId is echoed back in the response', bulk28.batchId);
    ok(bulk28.totalRows === 2 && bulk28.submittedCount === 1 && bulk28.needsAttentionCount === 1, '#29 totalRows/submittedCount/needsAttentionCount computed correctly', bulk28);

    // #30 — reviewing-status campaigns (not just accepting) still accept bulk uploads.
    await call(ADMIN, 'competition.campaign.changeStatus', { campaignId: CID, targetStatus: 'reviewing' });
    const bulk30 = await call(P(17), 'competition.submission.bulkSubmit', { campaignId: CID, batchId: 'batch-30', rows: [
      { customer_question: 'Dòng gửi khi campaign đang reviewing', answer: 'Trả lời trong giai đoạn reviewing' },
    ] });
    ok(bulk30.results[0].status === 'submitted', '#30 campaign status=reviewing still accepts bulk submissions (matches single-submit rule)');
    await call(ADMIN, 'competition.campaign.changeStatus', { campaignId: CID, targetStatus: 'accepting', reopen: true, reason: 'test setup: continue exercising bulk upload after the reviewing-status check' }); // restore for subsequent cases

    // #31 — whitespace-only required fields are treated as missing (trimmed).
    const bulk31 = await call(P(18), 'competition.submission.bulkSubmit', { campaignId: CID, batchId: 'batch-31', rows: [
      { customer_question: '    ', answer: 'có trả lời nhưng câu hỏi toàn khoảng trắng' },
    ] });
    ok(bulk31.results[0].status === 'invalid', '#31 whitespace-only customer_question is treated as missing, not accepted');

    // #32 — case/whitespace-insensitive same-file dedupe (already partially
    // covered at #20; add a pure-case-difference variant here).
    const bulk32 = await call(P(19), 'competition.submission.bulkSubmit', { campaignId: CID, batchId: 'batch-32', rows: [
      { customer_question: 'ABC XYZ CASE TEST', answer: 'answer case test' },
      { customer_question: 'abc xyz case test', answer: 'ANSWER CASE TEST' },
    ] });
    ok(bulk32.results[0].status === 'submitted' && bulk32.results[1].status === 'duplicate_in_file', '#32 pure-case-difference duplicate correctly detected within the same file');

    // #33 — exactly-200-row batch is accepted (boundary, not rejected).
    const exactly200 = Array.from({ length: 200 }, (_, i) => ({ customer_question: 'boundary q ' + i + ' unique', answer: 'boundary a ' + i }));
    const bulk33 = await call(P(20), 'competition.submission.bulkSubmit', { campaignId: CID, batchId: 'batch-33', rows: exactly200 });
    ok(bulk33.totalRows === 200 && bulk33.submittedCount === 200, '#33 exactly 200 rows (the documented cap) is accepted, not rejected', { totalRows: bulk33.totalRows, submittedCount: bulk33.submittedCount });

    // #34 — a Reviewer/Admin can also use bulk upload as a participant (no
    // admin-only gate — this is a participant capability per spec).
    const bulk34 = await call(REV2A, 'competition.submission.bulkSubmit', { campaignId: CID, batchId: 'batch-34', rows: [
      { customer_question: 'Reviewer cũng có thể tự nộp bài của họ', answer: 'Trả lời của reviewer với vai trò participant' },
    ] });
    ok(bulk34.results[0].status === 'submitted', '#34 a Reviewer account can also use bulk upload as a participant (not admin-gated)');

    // #35 — campaign-scoped: a row targeted at a different (non-existent)
    // campaign id is rejected outright, not silently attributed to CID.
    await expectReject('COMPETITION_CAMPAIGN_NOT_FOUND', () => call(P(1), 'competition.submission.bulkSubmit', { campaignId: '00000000-0000-0000-0000-000000000000', rows: [{ customer_question: 'q', answer: 'a' }] }), '#35 bulk upload against a non-existent campaign id is rejected');

    /* ============= Objective 3 — technical note cleanup (#36-43) ============= */
    console.log('\n== #36-43 TECHNICAL NOTE CLEANUP (adminOverride vs reviewAction vs adjustScore) ==');

    // Recreate the SAME pattern as the real Production bug: an approved
    // submission with a genuine reviewer-facing last_review_note, then an
    // admin_override call carrying an INTERNAL technical reason.
    const techSub = await draftAndSubmit(P(21), 'Bài kiểm tra kỹ thuật ghi chú', 'Trả lời kiểm tra ghi chú');
    await call(REV2A, 'competition.submission.review', { campaignId: CID, submissionId: techSub.submission.id, action: 'approve', levelOrder: 1, note: 'Ghi nhận tốt, đúng quy trình' });
    const beforeOverride = await q('select last_review_note from competition.submissions where id=$1', [techSub.submission.id]);
    ok(beforeOverride.rows[0].last_review_note === 'Ghi nhận tốt, đúng quy trình', 'sanity: genuine reviewer note is present before any admin_override', beforeOverride.rows[0]);

    // #36 — withdraw_approval mode: technical reason must NOT leak into
    // last_review_note; last_review_note must be UNCHANGED (never cleared
    // either — adminOverride simply never touches this column now).
    await call(ADMIN, 'competition.submission.adminOverride', { campaignId: CID, submissionId: techSub.submission.id, mode: 'withdraw_approval', reason: 'Kỹ thuật: dữ liệu import lỗi trùng dòng, rollback để re-import' });
    const after36 = await q('select last_review_note, status from competition.submissions where id=$1', [techSub.submission.id]);
    ok(after36.rows[0].last_review_note === 'Ghi nhận tốt, đúng quy trình', '#36 withdraw_approval: technical reason does NOT leak into last_review_note (unchanged from before)', after36.rows[0]);
    ok(after36.rows[0].status === 'submitted', 'sanity: withdraw_approval reverted status to submitted');

    // #37 — set_status mode: same guarantee.
    await call(ADMIN, 'competition.submission.adminOverride', { campaignId: CID, submissionId: techSub.submission.id, mode: 'set_status', targetStatus: 'needs_revision', reason: 'Kỹ thuật: đưa về needs_revision để điều chỉnh dữ liệu import' });
    const after37 = await q('select last_review_note, status from competition.submissions where id=$1', [techSub.submission.id]);
    ok(after37.rows[0].last_review_note === 'Ghi nhận tốt, đúng quy trình', '#37 set_status: technical reason does NOT leak into last_review_note', after37.rows[0]);
    ok(after37.rows[0].status === 'needs_revision', 'sanity: set_status changed status correctly');

    // #38 — edit_payload mode: same guarantee.
    await call(ADMIN, 'competition.submission.adminOverride', { campaignId: CID, submissionId: techSub.submission.id, mode: 'edit_payload', payload: { customer_question: 'Bài kiểm tra kỹ thuật ghi chú (đã sửa)', answer: 'Trả lời kiểm tra ghi chú' }, reason: 'Kỹ thuật: sửa lỗi chính tả trong nội dung import' });
    const after38 = await q('select last_review_note, payload from competition.submissions where id=$1', [techSub.submission.id]);
    ok(after38.rows[0].last_review_note === 'Ghi nhận tốt, đúng quy trình', '#38 edit_payload: technical reason does NOT leak into last_review_note', after38.rows[0].last_review_note);
    ok(after38.rows[0].payload.customer_question.includes('(đã sửa)'), 'sanity: edit_payload correctly updated the payload');

    // #39/#40 — reviewAction request_revision/reject still correctly write the
    // reviewer's note into last_review_note EXACTLY as before (unaffected).
    const revSub = await draftAndSubmit(P(22), 'Bài kiểm tra request_revision', 'Trả lời ban đầu');
    await call(REV2A, 'competition.submission.review', { campaignId: CID, submissionId: revSub.submission.id, action: 'request_revision', note: 'Cần bổ sung thêm chi tiết về kết quả' });
    const after39 = await q('select last_review_note, status from competition.submissions where id=$1', [revSub.submission.id]);
    ok(after39.rows[0].last_review_note === 'Cần bổ sung thêm chi tiết về kết quả' && after39.rows[0].status === 'needs_revision', '#39 reviewAction(request_revision) still correctly writes the reviewer note into last_review_note', after39.rows[0]);

    const rejSub = await draftAndSubmit(P(23), 'Bài kiểm tra reject', 'Trả lời sẽ bị từ chối');
    await call(REV2A, 'competition.submission.review', { campaignId: CID, submissionId: rejSub.submission.id, action: 'reject', note: 'Không đúng chủ đề chương trình' });
    const after40 = await q('select last_review_note, status from competition.submissions where id=$1', [rejSub.submission.id]);
    ok(after40.rows[0].last_review_note === 'Không đúng chủ đề chương trình' && after40.rows[0].status === 'rejected', '#40 reviewAction(reject) still correctly writes the reviewer note into last_review_note', after40.rows[0]);

    // #41 — adjustScore unaffected: reason -> submission_history ONLY,
    // reviewerRecord -> last_review_note ONLY (pre-existing correct pattern).
    const adjSub = await draftAndSubmit(P(24), 'Bài kiểm tra adjustScore', 'Trả lời sẽ được duyệt rồi điều chỉnh');
    await call(REV5A, 'competition.submission.review', { campaignId: CID, submissionId: adjSub.submission.id, action: 'approve', levelOrder: 1, note: 'Duyệt ban đầu' });
    await call(REV5A, 'competition.submission.adjustScore', { campaignId: CID, submissionId: adjSub.submission.id, targetLevelOrder: 2, reviewerRecord: 'Xem lại, nâng lên mức cao', reason: 'Kỹ thuật: rà soát lại sau khi có thêm bằng chứng' });
    const after41 = await q('select last_review_note from competition.submissions where id=$1', [adjSub.submission.id]);
    ok(after41.rows[0].last_review_note === 'Xem lại, nâng lên mức cao', '#41 adjustScore: reviewerRecord (not reason) correctly lands in last_review_note, unaffected by the adminOverride fix', after41.rows[0]);
    const adjHist = await q(`select reason from competition.submission_history where submission_id=$1 and action='score_adjust' order by at desc limit 1`, [adjSub.submission.id]);
    ok(adjHist.rows[0].reason === 'Kỹ thuật: rà soát lại sau khi có thêm bằng chứng', '#41b adjustScore: reason correctly lands ONLY in submission_history.reason', adjHist.rows[0]);

    // #42 — audit trail (submission_history.reason) is NEVER erased by the
    // fix — every adminOverride call above must still have its own reason
    // recorded in submission_history for audit purposes.
    const histReasons = await q(`select action, reason from competition.submission_history where submission_id=$1 and action in ('approval_withdrawn','admin_override') order by at asc`, [techSub.submission.id]);
    ok(histReasons.rowCount === 3, '#42 all 3 adminOverride audit rows exist for techSub (withdraw/set_status/edit_payload)', histReasons.rowCount);
    ok(histReasons.rows.every((r) => !!r.reason && r.reason.startsWith('Kỹ thuật:')), '#42b every adminOverride audit row still carries its full technical reason in submission_history.reason (never erased)', histReasons.rows);

    // #43 — a prior genuine last_review_note is preserved UNCHANGED across
    // MULTIPLE subsequent adminOverride calls (not just the first one) —
    // proves the fix is not a one-shot/partial guard.
    const finalNote = await q('select last_review_note from competition.submissions where id=$1', [techSub.submission.id]);
    ok(finalNote.rows[0].last_review_note === 'Ghi nhận tốt, đúng quy trình', '#43 the original genuine reviewer note survives UNCHANGED across all 3 subsequent adminOverride calls', finalNote.rows[0]);

  } finally {
    cleanupFixture();
    await admin.end();
  }

  console.log('\n== SUMMARY ==');
  console.log('PASS=' + PASS + ' FAIL=' + FAIL);
  if (FAIL > 0) { console.log('FAILED:', fails); process.exit(1); }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
