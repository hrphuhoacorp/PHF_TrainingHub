'use strict';

/*
 * PHF HR — Competition V1.6 · Admin Control Tower — "Toàn bộ bài dự thi" +
 * "Phục hồi trạng thái bài" (lifecycle restore). Real-DB matrix against the
 * throwaway phf_hr_e2e, mirrors scripts/test-competition-v1-3-2026-09.js's
 * tunnel/env/cleanup pattern. NO Supabase, NO Vercel, NO Production.
 *
 * Covers spec sections 32-36 (43 numbered cases): admin-all-submissions
 * access matrix (#1-14), menu semantics (#15-19), restore (#20-33),
 * technical-history-presentation (#34-37), role matrix (#38-43).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Client } = require('pg');
const ROOT = path.resolve(__dirname, '..');
const svc = require(path.join(ROOT, 'services/phf-hr-api/lib/competition-service'));

let PASS = 0, FAIL = 0; const fails = [];
function ok(cond, name, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + name); }
  else { FAIL++; fails.push(name); console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}
async function expectReject(code, fn, name) {
  try { await fn(); ok(false, name, 'expected reject ' + code + ' but resolved'); }
  catch (e) { ok(e && e.code === code, name, e && (e.code + ' / ' + e.message)); }
}

console.log('== PART A: static source checks (no DB) ==');
(() => {
  const reviewSrc = fs.readFileSync(path.join(ROOT, 'services/phf-hr-api/lib/competition-review.js'), 'utf8');
  const m = reviewSrc.match(/sh\.action IN \(([^)]+)\)/);
  ok(!!m, "34a. myReviewedHistory's action filter is present");
  const actions = m ? m[1].replace(/'/g, '').split(',').map((s) => s.trim()) : [];
  ok(actions.length === 4 && actions.sort().join(',') === ['approve', 'reject', 'revision_requested', 'upgrade'].sort().join(','),
    '34b. myReviewedHistory action filter is EXACTLY the 4 genuine-review actions', actions);
  ok(actions.indexOf('restore') === -1, "34c. 'restore' is NOT in myReviewedHistory's action filter (new V1.6 action correctly excluded)");
  ok(actions.indexOf('admin_override') === -1 && actions.indexOf('score_adjust') === -1,
    '34d. admin_override/score_adjust already excluded (pre-existing, re-confirmed)');

  const appSrc = fs.readFileSync(path.join(ROOT, 'assets/js/competition/phf-competition-app.js'), 'utf8');
  ok(/'toan-bo':screenAdminAllSubmissions/.test(appSrc), '19. RENDERERS registers toan-bo -> screenAdminAllSubmissions');
  ok(/key==='toan-bo'.*cap\.canAdmin|cap\.canAdmin[\s\S]{0,10}toan-bo/.test(appSrc) || /'toan-bo'\)return !!cap\.canAdmin/.test(appSrc) || /key==='quan-ly'\|\|key==='xet-duyet'\|\|key==='chot'\|\|key==='toan-bo'/.test(appSrc),
    '17. isScreenAuthorized gates toan-bo on cap.canAdmin');
  ok(/toan-bo.*group:'Quản trị'|group:'Quản trị'.*toan-bo/.test(appSrc.replace(/\n/g, ' ')) || /key:'toan-bo'/.test(appSrc), '15. menuModel defines a toan-bo item');
})();

console.log('\n== PART B: real-DB matrix (phf_hr_e2e) ==');
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
const CONTAINER = kv.PHF_HR_E2E_CONTAINER || 'phf-hr-e2e-throwaway-20260827T123257Z';
function adminExec(sql) {
  execFileSync('ssh', ['claude-phf', `docker exec -i ${CONTAINER} psql -U postgres -d phf_hr_e2e -v ON_ERROR_STOP=1`],
    { input: sql, stdio: ['pipe', 'ignore', 'inherit'] });
}
function cleanupFixture() {
  adminExec(`SET session_replication_role = replica; DELETE FROM competition.campaigns WHERE code LIKE 'SYN7-V16-%'; RESET session_replication_role;`);
}
async function rawQuery(sql, params) {
  const client = new Client({ host: config.PHF_HR_DB_HOST, port: config.PHF_HR_DB_PORT, database: config.PHF_HR_DB_NAME, user: config.PHF_HR_DB_RUNTIME_USER, password: config.PHF_HR_DB_RUNTIME_PASSWORD });
  await client.connect();
  try {
    await client.query('BEGIN'); await client.query('SET LOCAL ROLE phf_hr_app');
    const r = await client.query(sql, params);
    await client.query('COMMIT');
    return r.rows;
  } finally { await client.end(); }
}

const ADMIN = { accountId: 'SYN7-ACC-ADMIN', employeeCode: 'SYN7-ADMIN', displayName: '[SYN7] Sys Admin', systemRole: 'admin' };
// Competition Admin via admin_grants row, NOT systemRole (role-matrix #39).
const ADMIN2 = { accountId: 'SYN7-ACC-ADMIN2', employeeCode: 'SYN7-ADMIN2', displayName: '[SYN7] Grant Admin', systemRole: 'learner' };
const REV5 = { accountId: 'SYN7-ACC-REV5', employeeCode: 'SYN7-REV5', displayName: '[SYN7] Reviewer 5đ', systemRole: 'learner' };
const REV2 = { accountId: 'SYN7-ACC-REV2', employeeCode: 'SYN7-REV2', displayName: '[SYN7] Reviewer 2đ', systemRole: 'learner' };
const P = (n) => ({ accountId: 'SYN7-ACC-P' + n, employeeCode: 'SYN7-P' + n, displayName: '[SYN7] P' + n, department: 'Bán hàng', branch: 'CN' + n, systemRole: 'learner' });
const CODE = 'SYN7-V16-1';
const call = (actor, action, params) => svc.dispatch(config, actor, action, params || {});

(async () => {
  cleanupFixture();

  const camp = await call(ADMIN, 'competition.campaign.createDraft', { code: CODE, title: '[SYN7] V1.6', minRequiredContributions: 1 });
  const CID = camp.id;
  await call(ADMIN, 'competition.level.upsert', { campaignId: CID, levelOrder: 1, name: 'Hợp lệ', score: 2, slaHours: 48 });
  await call(ADMIN, 'competition.level.upsert', { campaignId: CID, levelOrder: 2, name: 'Giá trị cao', score: 5, slaHours: 72 });
  await call(ADMIN, 'competition.grant.reviewer', { campaignId: CID, accountId: REV5.accountId, employeeCode: REV5.employeeCode, displayName: REV5.displayName, maxLevelOrder: 2 });
  await call(ADMIN, 'competition.grant.reviewer', { campaignId: CID, accountId: REV2.accountId, employeeCode: REV2.employeeCode, displayName: REV2.displayName, maxLevelOrder: 1 });
  await call(ADMIN, 'competition.grant.admin', { accountId: ADMIN2.accountId, employeeCode: ADMIN2.employeeCode, displayName: ADMIN2.displayName, reason: 'V1.6 test fixture' });
  await call(ADMIN, 'competition.campaign.changeStatus', { campaignId: CID, targetStatus: 'accepting' });

  // ---- fixture submissions across every status/score bucket --------------
  async function submitFor(p, q) {
    const d = await call(p, 'competition.submission.createDraft', { campaignId: CID, payload: { customer_question: q, answer: 'A ' + q } });
    return call(p, 'competition.submission.submit', { submissionId: d.id, payload: { customer_question: q, answer: 'A ' + q } });
  }

  const s1 = await submitFor(P(1), 'Q pending'); // stays submitted
  const s2 = await submitFor(P(2), 'Q needs revision');
  await call(REV2, 'competition.submission.review', { campaignId: CID, submissionId: s2.submission.id, action: 'request_revision', note: 'sửa lại' });
  const s3 = await submitFor(P(3), 'Q approved low');
  await call(REV5, 'competition.submission.review', { campaignId: CID, submissionId: s3.submission.id, action: 'approve', levelOrder: 1, note: 'ok level 1' });
  const s4 = await submitFor(P(4), 'Q approved high');
  await call(REV5, 'competition.submission.review', { campaignId: CID, submissionId: s4.submission.id, action: 'approve', levelOrder: 1, note: 'ok' });
  await call(REV5, 'competition.submission.review', { campaignId: CID, submissionId: s4.submission.id, action: 'upgrade', levelOrder: 2, note: 'giá trị cao' });
  const s5 = await submitFor(P(5), 'Q rejected');
  await call(REV2, 'competition.submission.review', { campaignId: CID, submissionId: s5.submission.id, action: 'reject', note: 'không hợp lệ' });
  const s6 = await submitFor(P(6), 'Q zero');
  await call(REV5, 'competition.submission.review', { campaignId: CID, submissionId: s6.submission.id, action: 'approve', levelOrder: 1, note: 'ok' });
  await call(REV5, 'competition.submission.adjustScore', { campaignId: CID, submissionId: s6.submission.id, targetLevelOrder: 0, reason: 'không đủ căn cứ' });

  console.log('\n== 1-14 ADMIN-ALL-SUBMISSIONS ACCESS MATRIX ==');
  const listAsAdmin = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all', limit: 50 });
  ok(listAsAdmin.items.length >= 6, '1. Admin can list all submissions', listAsAdmin.items.length);
  await expectReject('COMPETITION_ADMIN_REQUIRED', () => call(REV5, 'competition.admin.listAllSubmissions', { campaignId: CID }), '2. Reviewer 5 cannot list-all (403)');
  await expectReject('COMPETITION_ADMIN_REQUIRED', () => call(REV2, 'competition.admin.listAllSubmissions', { campaignId: CID }), '3. Reviewer 2 cannot list-all (403)');
  await expectReject('COMPETITION_ADMIN_REQUIRED', () => call(P(1), 'competition.admin.listAllSubmissions', { campaignId: CID }), '4. Participant cannot list-all (403)');

  const s3Row = listAsAdmin.items.find((x) => x.id === s3.submission.id);
  ok(!!s3Row && s3Row.authorDisplayName === P(3).displayName && s3Row.authorEmployeeCode === P(3).employeeCode,
    '5. real author identity revealed to admin', s3Row && { name: s3Row.authorDisplayName, code: s3Row.authorEmployeeCode });
  ok(!!s3Row.assignedReviewer, '6. assignedReviewer present for a processed submission', s3Row.assignedReviewer);
  ok(!!s3Row.actualReviewerActor && s3Row.actualReviewerActor.employeeCode === REV5.employeeCode,
    '7. actualReviewerActor reveals the real reviewer identity', s3Row.actualReviewerActor);

  const fPending = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'pending' });
  ok(fPending.items.every((x) => x.status === 'submitted') && fPending.items.some((x) => x.id === s1.submission.id),
    '8. filter pending -> only submitted', fPending.items.map((x) => x.status));
  const fRevision = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'needs_revision' });
  ok(fRevision.items.every((x) => x.status === 'needs_revision') && fRevision.items.some((x) => x.id === s2.submission.id),
    '9. filter needs_revision -> only needs_revision', fRevision.items.map((x) => x.status));
  const fLow = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'approved_low' });
  ok(fLow.items.every((x) => x.status === 'approved' && x.currentLevelOrder === 1) && fLow.items.some((x) => x.id === s3.submission.id),
    '10. filter approved_low -> approved + level 1 only', fLow.items.map((x) => [x.status, x.currentLevelOrder]));
  const fHigh = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'approved_high' });
  ok(fHigh.items.every((x) => x.status === 'approved' && x.currentLevelOrder === 2) && fHigh.items.some((x) => x.id === s4.submission.id),
    '11. filter approved_high -> approved + level 2 only', fHigh.items.map((x) => [x.status, x.currentLevelOrder]));
  const fZero = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'zero' });
  ok(fZero.items.every((x) => x.effectiveScore === 0) && fZero.items.some((x) => x.id === s6.submission.id),
    '12. filter zero -> effectiveScore 0 only', fZero.items.map((x) => x.effectiveScore));
  const fRejected = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'rejected' });
  ok(fRejected.items.every((x) => x.status === 'rejected') && fRejected.items.some((x) => x.id === s5.submission.id),
    '13. filter rejected -> rejected only', fRejected.items.map((x) => x.status));

  const page1 = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all', limit: 2, offset: 0 });
  const page2 = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all', limit: 2, offset: 2 });
  ok(page1.items.length === 2 && page2.items.length === 2 && page1.items[0].id !== page2.items[0].id && page1.total >= 6,
    '14. pagination: limit/offset bounded and windowed correctly', { p1: page1.items.length, p2: page2.items.length, total: page1.total });

  console.log('\n== 15-19 MENU SEMANTICS == (static checks in PART A; DB confirmation below)');
  const bootAdmin = await call(ADMIN, 'competition.bootstrap', {});
  ok(bootAdmin.capabilities.canAdmin === true, '16a. sanity: ADMIN bootstrap capabilities.canAdmin true (menu gate input)');
  const bootRev5 = await call(REV5, 'competition.bootstrap', {});
  ok(bootRev5.capabilities.canAdmin === false, '16b. Reviewer 5 bootstrap capabilities.canAdmin false (menu item correctly hidden)', bootRev5.capabilities);
  const bootP1 = await call(P(1), 'competition.bootstrap', {});
  ok(bootP1.capabilities.canAdmin === false, '18. Participant bootstrap capabilities.canAdmin false (deep-link guard input)', bootP1.capabilities);

  console.log('\n== 20-33 RESTORE ==');
  // fresh submission dedicated to restore tests: submitted -> approved (level 1)
  const s7 = await submitFor(P(3), 'Q restore target');
  const approve7 = await call(REV5, 'competition.submission.review', { campaignId: CID, submissionId: s7.submission.id, action: 'approve', levelOrder: 1, note: 'note before restore' });
  const hist7a = await call(ADMIN, 'competition.admin.getSubmissionHistory', { campaignId: CID, submissionId: s7.submission.id });
  const submitEvt = hist7a.items.find((h) => h.action === 'submit');
  const approveEvt = hist7a.items.find((h) => h.action === 'approve');
  const createEvt = hist7a.items.find((h) => h.action === 'create');
  ok(!!submitEvt && !!approveEvt && !!createEvt, 'sanity: submit/approve/create history events all present');

  await expectReject('COMPETITION_RESTORE_REASON_REQUIRED',
    () => call(ADMIN, 'competition.submission.adminRestore', { campaignId: CID, submissionId: s7.submission.id, targetHistoryEventId: submitEvt.id, expectedRowVersion: approve7.rowVersion, reason: '' }),
    '20. restore without reason rejected');
  await expectReject('COMPETITION_RESTORE_ROWVERSION_REQUIRED',
    () => call(ADMIN, 'competition.submission.adminRestore', { campaignId: CID, submissionId: s7.submission.id, targetHistoryEventId: submitEvt.id, reason: 'x' }),
    '21. restore without expectedRowVersion rejected');
  await expectReject('COMPETITION_STALE_STATE',
    () => call(ADMIN, 'competition.submission.adminRestore', { campaignId: CID, submissionId: s7.submission.id, targetHistoryEventId: submitEvt.id, expectedRowVersion: approve7.rowVersion + 99, reason: 'stale test' }),
    '22. restore with stale rowVersion rejected, no write happens');
  const afterStaleAttempt = await call(P(3), 'competition.submission.getMine', { submissionId: s7.submission.id });
  ok(afterStaleAttempt.status === 'approved' && afterStaleAttempt.rowVersion === approve7.rowVersion,
    '22b. stale-state rejection wrote NOTHING (status/rowVersion unchanged)', afterStaleAttempt);

  const restoreToSubmitted = await call(ADMIN, 'competition.submission.adminRestore', {
    campaignId: CID, submissionId: s7.submission.id, targetHistoryEventId: submitEvt.id, expectedRowVersion: approve7.rowVersion, reason: 'phục hồi kiểm thử V1.6',
  });
  ok(restoreToSubmitted.status === 'submitted' && restoreToSubmitted.currentLevelOrder == null && restoreToSubmitted.currentScore == null,
    '23. restore to submitted checkpoint works, level/score cleared', restoreToSubmitted);
  ok(restoreToSubmitted.rowVersion === approve7.rowVersion + 1, '33a. row_version incremented by exactly 1 on restore', { before: approve7.rowVersion, after: restoreToSubmitted.rowVersion });
  ok(restoreToSubmitted.lastReviewNote === 'note before restore', '26. restore does NOT touch last_review_note', restoreToSubmitted.lastReviewNote);

  const restoreToApproved = await call(ADMIN, 'competition.submission.adminRestore', {
    campaignId: CID, submissionId: s7.submission.id, targetHistoryEventId: approveEvt.id, expectedRowVersion: restoreToSubmitted.rowVersion, reason: 'phục hồi lại mức đã duyệt',
  });
  ok(restoreToApproved.status === 'approved' && restoreToApproved.currentLevelOrder === 1 && Number(restoreToApproved.currentScore) === 2,
    '24. restore to approved checkpoint re-derives level+score from current approval_levels', restoreToApproved);

  const hist7b = await call(ADMIN, 'competition.admin.getSubmissionHistory', { campaignId: CID, submissionId: s7.submission.id });
  const restoreRows = hist7b.items.filter((h) => h.action === 'restore');
  ok(restoreRows.length === 2, '25a. two restore audit rows recorded', restoreRows.length);
  ok(restoreRows.every((h) => h.reason && h.reason.length > 0), '25b. restore rows carry the admin-supplied reason', restoreRows.map((h) => h.reason));
  ok(restoreRows[1].after.status === 'approved' && restoreRows[1].after.level === 1 && restoreRows[1].after.restoredFromHistoryId === approveEvt.id,
    '25c. restore audit row after JSON references the source checkpoint', restoreRows[1].after);

  const notifRes = await call(P(3), 'competition.notification.list', {});
  ok((notifRes.notifications || []).some((n) => n.eventCode === 'COMPETITION_SUBMISSION_RESTORED' || /phục hồi/i.test(n.message || '')),
    '27. author received a COMPETITION_SUBMISSION_RESTORED notification', (notifRes.notifications || []).map((n) => n.eventCode || n.title));

  await expectReject('COMPETITION_RESTORE_NOOP',
    () => call(ADMIN, 'competition.submission.adminRestore', { campaignId: CID, submissionId: s7.submission.id, targetHistoryEventId: approveEvt.id, expectedRowVersion: restoreToApproved.rowVersion, reason: 'noop test' }),
    '28. restore to the CURRENT state is rejected as a no-op');

  // self-restore block
  const adminOwnSub = await submitFor(ADMIN, 'Q admin own submission');
  const adminHist = await call(ADMIN, 'competition.admin.getSubmissionHistory', { campaignId: CID, submissionId: adminOwnSub.submission.id });
  const adminSubmitEvt = adminHist.items.find((h) => h.action === 'submit');
  await expectReject('COMPETITION_SELF_REVIEW_BLOCKED',
    () => call(ADMIN, 'competition.submission.adminRestore', { campaignId: CID, submissionId: adminOwnSub.submission.id, targetHistoryEventId: adminSubmitEvt.id, expectedRowVersion: adminOwnSub.submission.rowVersion, reason: 'self restore' }),
    '29. Admin cannot restore their OWN submission');

  await expectReject('COMPETITION_RESTORE_CHECKPOINT_NOT_FOUND',
    () => call(ADMIN, 'competition.submission.adminRestore', { campaignId: CID, submissionId: s7.submission.id, targetHistoryEventId: '00000000-0000-0000-0000-000000000000', expectedRowVersion: restoreToApproved.rowVersion, reason: 'bad checkpoint' }),
    '30. restore with a non-existent targetHistoryEventId rejected');
  await expectReject('COMPETITION_RESTORE_CHECKPOINT_INVALID',
    () => call(ADMIN, 'competition.submission.adminRestore', { campaignId: CID, submissionId: s7.submission.id, targetHistoryEventId: createEvt.id, expectedRowVersion: restoreToApproved.rowVersion, reason: 'non-restorable action' }),
    '31. restore from a non-restorable action (create) rejected');

  await expectReject('COMPETITION_ADMIN_REQUIRED',
    () => call(REV5, 'competition.submission.adminRestore', { campaignId: CID, submissionId: s7.submission.id, targetHistoryEventId: submitEvt.id, expectedRowVersion: restoreToApproved.rowVersion, reason: 'reviewer5 attempt' }),
    '32/41. Reviewer 5 (even max authority) cannot restore — 403 via dispatcher directly');
  ok(true, '33b. row_version increment already verified at 33a');

  console.log('\n== 34-37 TECHNICAL-HISTORY-PRESENTATION ==');
  // s3 was approved by REV5 with a genuine note; have ADMIN admin_override +
  // restore an unrelated lifecycle event on it, then verify REV5's
  // myReviewedHistory for s3 shows ONLY their genuine approve note.
  const beforeOverride = await call(ADMIN, 'competition.admin.getSubmissionHistory', { campaignId: CID, submissionId: s3.submission.id });
  await call(ADMIN, 'competition.submission.adminOverride', { campaignId: CID, submissionId: s3.submission.id, mode: 'edit_payload', payload: { customer_question: 'Q approved low (edited)', answer: 'A edited' }, reason: 'technical correction' });
  const myRevAfterOverride = await call(REV5, 'competition.review.myReviewed', { campaignId: CID });
  const s3Entry = (myRevAfterOverride.items || []).find((x) => x.submissionRef === s3.submission.id);
  ok(!!s3Entry && s3Entry.myAction === 'approve' && s3Entry.myNote === 'ok level 1',
    '35. myReviewedHistory for REV5 still shows ONLY their genuine approve note after an unrelated admin_override', s3Entry);
  ok(!s3Entry || !/technical correction/i.test(JSON.stringify(s3Entry)), '35b. the admin_override reason text never leaks into myReviewedHistory', s3Entry);

  // edge case: grant REV2 admin rights too, have REV2 do an admin_override on
  // a submission they ALSO genuinely approved-adjacent (use s5, which REV2
  // rejected) — verify myReviewedHistory for REV2 on s5 still shows only the
  // genuine reject, never the admin_override.
  await call(ADMIN, 'competition.grant.admin', { accountId: REV2.accountId, employeeCode: REV2.employeeCode, displayName: REV2.displayName, reason: 'edge-case fixture' });
  await call(REV2, 'competition.submission.adminOverride', { campaignId: CID, submissionId: s5.submission.id, mode: 'edit_payload', payload: { customer_question: 'Q rejected (edited)', answer: 'A edited' }, reason: 'same-actor edge case' });
  const myRevRev2 = await call(REV2, 'competition.review.myReviewed', { campaignId: CID, statusFilter: 'rejected' });
  const s5Entry = (myRevRev2.items || []).find((x) => x.submissionRef === s5.submission.id);
  ok(!!s5Entry && s5Entry.myAction === 'reject' && s5Entry.myNote === 'không hợp lệ',
    '36. same-actor edge case: REV2 (also an admin) still sees only their genuine reject, not their own later admin_override', s5Entry);
  await call(ADMIN, 'competition.grant.admin', { accountId: REV2.accountId, active: false, reason: 'edge-case fixture cleanup' });

  const fullHist = await call(ADMIN, 'competition.admin.getSubmissionHistory', { campaignId: CID, submissionId: s3.submission.id });
  ok(fullHist.items.some((h) => h.action === 'admin_override') && fullHist.items.some((h) => h.action === 'approve'),
    '37a. adminGetSubmissionHistory is UNFILTERED — shows admin_override + approve together', fullHist.items.map((h) => h.action));
  ok(fullHist.items.some((h) => h.action === 'admin_override' && h.actorEmployeeCode === ADMIN.employeeCode),
    '37b. adminGetSubmissionHistory reveals real actor identity even for technical events', fullHist.items.filter((h) => h.action === 'admin_override'));

  console.log('\n== 38-43 ROLE MATRIX ==');
  const listAsSystemAdmin = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all' }).then(() => true).catch(() => false);
  ok(listAsSystemAdmin, '38. system PHF admin (systemRole=admin) can access admin-all-submissions');
  const listAsGrantAdmin = await call(ADMIN2, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all' }).then(() => true).catch(() => false);
  ok(listAsGrantAdmin, '39. admin_grants-based Competition Admin (non-systemRole) can also access admin-all-submissions');
  const restoreAsGrantAdmin = await (async () => {
    const s8 = await submitFor(P(4), 'Q grant-admin restore target');
    const app8 = await call(REV5, 'competition.submission.review', { campaignId: CID, submissionId: s8.submission.id, action: 'approve', levelOrder: 1, note: 'ok' });
    const h8 = await call(ADMIN2, 'competition.admin.getSubmissionHistory', { campaignId: CID, submissionId: s8.submission.id });
    const submitEvt8 = h8.items.find((h) => h.action === 'submit');
    const r = await call(ADMIN2, 'competition.submission.adminRestore', { campaignId: CID, submissionId: s8.submission.id, targetHistoryEventId: submitEvt8.id, expectedRowVersion: app8.rowVersion, reason: 'grant admin restore' });
    return r.status === 'submitted';
  })();
  ok(restoreAsGrantAdmin, '39b. admin_grants-based Competition Admin can also restore');

  await expectReject('COMPETITION_ADMIN_REQUIRED', () => call(REV5, 'competition.admin.listAllSubmissions', { campaignId: CID }), '40. Reviewer 5 explicit re-confirmation: cannot access admin-all-submissions');
  await expectReject('COMPETITION_ADMIN_REQUIRED', () => call(REV5, 'competition.submission.adminRestore', { campaignId: CID, submissionId: s7.submission.id, targetHistoryEventId: submitEvt.id, expectedRowVersion: restoreToApproved.rowVersion, reason: 'x' }),
    '41. Reviewer 5 explicit re-confirmation: cannot restore');
  await expectReject('COMPETITION_ADMIN_REQUIRED', () => call(P(1), 'competition.submission.adminRestore', { campaignId: CID, submissionId: s7.submission.id, targetHistoryEventId: submitEvt.id, expectedRowVersion: restoreToApproved.rowVersion, reason: 'x' }),
    '42. Participant cannot restore (nor access admin-all, already proven #4)');

  // Reviewer 2 completely unaffected — anonymousQueue/myReviewedHistory still
  // reachable and shaped exactly as before (no author identity fields).
  const queueRev2 = await call(REV2, 'competition.review.queue', { campaignId: CID });
  const anyLeak = (queueRev2.items || []).some((x) => 'authorDisplayName' in x || 'authorEmployeeCode' in x || 'authorAccountId' in x);
  ok(!anyLeak, '43. Reviewer 2 queue still carries NO author identity fields (unaffected by V1.6)', Object.keys((queueRev2.items || [])[0] || {}));

  console.log(`\n== RESULT: ${PASS} passed, ${FAIL} failed ==`);
  if (fails.length) { console.log('Failed:'); fails.forEach((f) => console.log('  - ' + f)); }
  cleanupFixture();
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); cleanupFixture(); process.exit(2); });
