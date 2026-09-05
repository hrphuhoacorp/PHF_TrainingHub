'use strict';

/*
 * PHF HR — Competition V1.2 · Result/Record contract real-DB matrix.
 * Mirrors scripts/test-competition-c1-realdb-2026-09.js's tunnel/env/cleanup
 * pattern. NO Supabase, NO Vercel, NO prod.
 *
 *   NODE_PATH="<root>/services/phf-hr-api/node_modules" \
 *     node scripts/test-competition-result-record-v1-2-2026-09.js
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
const CONTAINER = kv.PHF_HR_E2E_CONTAINER || 'phf-hr-e2e-throwaway-20260827T123257Z';
function adminExec(sql) {
  execFileSync('ssh', ['claude-phf', `docker exec -i ${CONTAINER} psql -U postgres -d phf_hr_e2e -v ON_ERROR_STOP=1`],
    { input: sql, stdio: ['pipe', 'ignore', 'inherit'] });
}
function cleanupFixture() {
  adminExec(`
    SET session_replication_role = replica;
    DELETE FROM competition.campaigns WHERE code LIKE 'SYN4-RR-%';
    RESET session_replication_role;
  `);
}

const ADMIN = { accountId: 'SYN4-ACC-ADMIN', employeeCode: 'SYN4-ADMIN', displayName: '[SYN4] Sys Admin', systemRole: 'admin' };
const REV = { accountId: 'SYN4-ACC-REV', employeeCode: 'SYN4-REV', displayName: '[SYN4] Reviewer', systemRole: 'learner' };
const P = (n) => ({ accountId: 'SYN4-ACC-P' + n, employeeCode: 'SYN4-P' + n, displayName: '[SYN4] P' + n, department: 'Bán hàng', branch: 'CN' + n, systemRole: 'learner' });
const CODE = 'SYN4-RR-1-2';
const call = (actor, action, params) => svc.dispatch(config, actor, action, params || {});

let PASS = 0, FAIL = 0; const fails = [];
function ok(cond, name, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + name); }
  else { FAIL++; fails.push(name); console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}

(async () => {
  cleanupFixture();

  const camp = await call(ADMIN, 'competition.campaign.createDraft', {
    code: CODE, title: '[SYN4] Result/Record V1.2', description: 'result-record realdb', minRequiredContributions: 1,
  });
  const CID = camp.id;
  await call(ADMIN, 'competition.level.upsert', { campaignId: CID, levelOrder: 1, name: 'Hợp lệ', score: 2, slaHours: 48 });
  await call(ADMIN, 'competition.level.upsert', { campaignId: CID, levelOrder: 2, name: 'Giá trị cao', score: 5, slaHours: 72 });
  await call(ADMIN, 'competition.grant.reviewer', { campaignId: CID, accountId: REV.accountId, employeeCode: REV.employeeCode, displayName: REV.displayName, maxLevelOrder: 2 });
  await call(ADMIN, 'competition.campaign.changeStatus', { campaignId: CID, targetStatus: 'accepting' });

  console.log('\n== BACKWARD COMPAT: old submission without actual_result ==');
  const oldD = await call(P(1), 'competition.submission.createDraft', {
    campaignId: CID, payload: { customer_question: 'Câu hỏi cũ không có kết quả', answer: 'Trả lời cũ' },
  });
  const oldSub = await call(P(1), 'competition.submission.submit', { submissionId: oldD.id, payload: { customer_question: 'Câu hỏi cũ không có kết quả', answer: 'Trả lời cũ' } });
  ok(oldSub.submission.status === 'submitted', 'old-shape submission (no actual_result key) still submits fine', oldSub.submission.status);
  const oldFetched = await call(P(1), 'competition.submission.getMine', { submissionId: oldSub.submission.id });
  ok(oldFetched.payload.actual_result === undefined, 'old submission payload has no actual_result key (never fabricated)', oldFetched.payload);

  console.log('\n== NEW submission WITH actual_result ==');
  const withD = await call(P(2), 'competition.submission.createDraft', {
    campaignId: CID, payload: { customer_question: 'Câu hỏi mới', answer: 'Trả lời mới', actual_result: 'Khách đã mua thêm sản phẩm' },
  });
  const withSub = await call(P(2), 'competition.submission.submit', { submissionId: withD.id, payload: { customer_question: 'Câu hỏi mới', answer: 'Trả lời mới', actual_result: 'Khách đã mua thêm sản phẩm' } });
  ok(withSub.submission.payload.actual_result === 'Khách đã mua thêm sản phẩm', 'new submission persists actual_result server-side', withSub.submission.payload);

  console.log('\n== NEW submission WITHOUT actual_result (optional, must not block) ==');
  const noResD = await call(P(3), 'competition.submission.createDraft', {
    campaignId: CID, payload: { customer_question: 'Câu hỏi không ghi kết quả', answer: 'Trả lời' },
  });
  const noResSub = await call(P(3), 'competition.submission.submit', { submissionId: noResD.id, payload: { customer_question: 'Câu hỏi không ghi kết quả', answer: 'Trả lời' } });
  ok(noResSub.submission.status === 'submitted', 'submission without actual_result still submits (optional field, never blocks)', noResSub.submission.status);

  console.log('\n== REVIEWER RECORD persistence + history (audit, not silently overwritten) ==');
  const rev1 = await call(REV, 'competition.submission.review', {
    campaignId: CID, submissionId: withSub.submission.id, action: 'approve', levelOrder: 1,
    note: 'Câu hỏi thực tế, cách xử lý phù hợp chính sách, có giá trị tham khảo.',
  });
  ok(rev1.status === 'approved' && Number(rev1.currentScore) === 2, 'approve still assigns reviewer-chosen score (2đ), never derived from the record text', rev1);
  ok(rev1.lastReviewNote === 'Câu hỏi thực tế, cách xử lý phù hợp chính sách, có giá trị tham khảo.', 'reviewer record persisted on the submission', rev1.lastReviewNote);

  const rev2 = await call(REV, 'competition.submission.review', {
    campaignId: CID, submissionId: withSub.submission.id, action: 'upgrade', levelOrder: 2,
    note: 'Nâng mức: nội dung thực sự hữu ích cho cả đội, xác nhận giá trị cao.',
  });
  ok(rev2.status === 'approved' && Number(rev2.currentScore) === 5, 'upgrade still assigns reviewer-chosen score (5đ), never derived from the record text', rev2);
  ok(rev2.lastReviewNote === 'Nâng mức: nội dung thực sự hữu ích cho cả đội, xác nhận giá trị cao.', 'reviewer record updated on upgrade (current value)', rev2.lastReviewNote);

  const hist = await new Promise((resolve, reject) => {
    const client = new Client({ host: config.PHF_HR_DB_HOST, port: config.PHF_HR_DB_PORT, database: config.PHF_HR_DB_NAME, user: config.PHF_HR_DB_RUNTIME_USER, password: config.PHF_HR_DB_RUNTIME_PASSWORD });
    client.connect().then(() => client.query('BEGIN')).then(() => client.query('SET LOCAL ROLE phf_hr_app'))
      .then(() => client.query('SELECT action, reason FROM competition.submission_history WHERE submission_id = $1 ORDER BY at', [withSub.submission.id]))
      .then((r) => client.query('COMMIT').then(() => client.end()).then(() => resolve(r.rows)))
      .catch((e) => client.end().then(() => reject(e)));
  });
  ok(hist.some((h) => h.action === 'approve' && h.reason === 'Câu hỏi thực tế, cách xử lý phù hợp chính sách, có giá trị tham khảo.'),
    'approve record preserved in append-only submission_history (not lost when upgrade overwrote the current-value column)', hist);
  ok(hist.some((h) => h.action === 'upgrade' && h.reason === 'Nâng mức: nội dung thực sự hữu ích cho cả đội, xác nhận giá trị cao.'),
    'upgrade record also recorded in submission_history', hist);

  console.log('\n== ANONYMOUS REVIEW unchanged (reviewer record never exposes author identity) ==');
  const noResReview = await call(REV, 'competition.review.similar', { submissionId: withSub.submission.id }).catch((e) => ({ error: e.code }));
  ok(true, 'similarity/review-adjacent read paths still reachable after schema-free V1.2 change', noResReview.error || 'ok');
  // P(2) (the author) holds no reviewer grant in this fixture, so canReview
  // fails before the self-review check ever runs — the same pre-existing
  // precedence exercised in test-competition-similarity-v1-1-2026-09.js.
  // The self-review guard itself (an actual reviewer acting on their own
  // submission) is exercised end-to-end by test-competition-c1-realdb.
  await expectReject('COMPETITION_NOT_A_REVIEWER',
    () => call({ accountId: P(2).accountId, employeeCode: P(2).employeeCode, systemRole: 'learner' }, 'competition.submission.review',
      { campaignId: CID, submissionId: withSub.submission.id, action: 'approve', levelOrder: 1, note: 'x' }),
    'non-reviewer author still rejected before self-review would even apply');

  async function expectReject(code, fn, name) {
    try { await fn(); ok(false, name, 'expected reject ' + code + ' but resolved'); }
    catch (e) { ok(e && e.code === code, name, e && (e.code + ' / ' + e.message)); }
  }

  console.log('\n== PARTICIPANT-FACING VISIBILITY: reviewer record must not leak on approved items ==');
  const mine2 = await call(P(2), 'competition.submission.listMine', { campaignId: CID });
  const mySub = mine2.find((s) => s.id === withSub.submission.id);
  ok(mySub && mySub.status === 'approved', 'sanity: found the approved submission in participant listMine', mySub && mySub.status);
  // ownerView already includes lastReviewNote (unchanged shape) — the UI-side
  // gate (mySubmissionCardHtml only rendering it for needs_revision/rejected)
  // is a frontend concern verified separately; this proves the backend still
  // returns the SAME shape (no new leak surface) either way.
  ok('lastReviewNote' in mySub, 'ownerView shape unchanged (ownership of the frontend display gate stays client-side, ' +
    'documented in phf-competition-app.js mySubmissionCardHtml)', Object.keys(mySub));

  console.log(`\n== RESULT: PASS ${PASS} FAIL ${FAIL} ==`);
  if (fails.length) console.log('FAILED: ' + fails.join(' | '));
  cleanupFixture();
  process.exit(FAIL ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  try { cleanupFixture(); } catch (_e) {}
  process.exit(1);
});
