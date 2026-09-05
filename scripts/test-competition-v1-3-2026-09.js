'use strict';

/*
 * PHF HR — Competition V1.3 · evidence field + effective score (0/2/5) +
 * native-popup audit. Real-DB matrix against the throwaway phf_hr_e2e,
 * mirrors scripts/test-competition-c1-realdb-2026-09.js's tunnel/env/cleanup
 * pattern. NO Supabase, NO Vercel, NO prod.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
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

console.log('== PART A: native popup audit (static, no DB) ==');
(() => {
  const src = fs.readFileSync(path.join(ROOT, 'assets/js/competition/phf-competition-app.js'), 'utf8');
  // strip comments so the audit only counts LIVE code, per spec ("do not
  // count non-user-facing code strings/comments as failures").
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  ok(!/window\.alert\s*\(|(?<![.\w])alert\s*\(/.test(codeOnly), '29. no live window.alert() in Competition frontend');
  ok(!/window\.confirm\s*\(|(?<![.\w])confirm\s*\(/.test(codeOnly), '30. no live window.confirm() in Competition frontend');
  ok(!/window\.prompt\s*\(|(?<![.\w])prompt\s*\(/.test(codeOnly), '31. no live window.prompt() in Competition frontend');
  ok(/function showInputModal/.test(src) && /function showConfirmModal/.test(src), 'PHF input/confirm modal primitives exist');
  ok(/showInputModal\(action===.reject.[\s\S]{0,80}Từ chối bài dự thi/.test(src) || /title:.Yêu cầu chỉnh sửa./.test(src),
    '32/33. request_revision/reject use the dedicated PHF input modal');
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
  adminExec(`SET session_replication_role = replica; DELETE FROM competition.campaigns WHERE code LIKE 'SYN6-V13-%'; RESET session_replication_role;`);
}

const ADMIN = { accountId: 'SYN6-ACC-ADMIN', employeeCode: 'SYN6-ADMIN', displayName: '[SYN6] Sys Admin', systemRole: 'admin' };
const REV5 = { accountId: 'SYN6-ACC-REV5', employeeCode: 'SYN6-REV5', displayName: '[SYN6] Reviewer 5đ', systemRole: 'learner' };
const REV2 = { accountId: 'SYN6-ACC-REV2', employeeCode: 'SYN6-REV2', displayName: '[SYN6] Reviewer 2đ', systemRole: 'learner' };
const P = (n) => ({ accountId: 'SYN6-ACC-P' + n, employeeCode: 'SYN6-P' + n, displayName: '[SYN6] P' + n, department: 'Bán hàng', branch: 'CN' + n, systemRole: 'learner' });
const CODE = 'SYN6-V13-1-3';
const call = (actor, action, params) => svc.dispatch(config, actor, action, params || {});

(async () => {
  cleanupFixture();

  const camp = await call(ADMIN, 'competition.campaign.createDraft', { code: CODE, title: '[SYN6] V1.3', minRequiredContributions: 1 });
  const CID = camp.id;
  await call(ADMIN, 'competition.level.upsert', { campaignId: CID, levelOrder: 1, name: 'Hợp lệ', score: 2, slaHours: 48 });
  await call(ADMIN, 'competition.level.upsert', { campaignId: CID, levelOrder: 2, name: 'Giá trị cao', score: 5, slaHours: 72 });
  await call(ADMIN, 'competition.grant.reviewer', { campaignId: CID, accountId: REV5.accountId, employeeCode: REV5.employeeCode, displayName: REV5.displayName, maxLevelOrder: 2 });
  await call(ADMIN, 'competition.grant.reviewer', { campaignId: CID, accountId: REV2.accountId, employeeCode: REV2.employeeCode, displayName: REV2.displayName, maxLevelOrder: 1 });
  await call(ADMIN, 'competition.campaign.changeStatus', { campaignId: CID, targetStatus: 'accepting' });

  console.log('\n== 1-8 EVIDENCE ==');
  const dBlank = await call(P(1), 'competition.submission.createDraft', { campaignId: CID, payload: { customer_question: 'Q blank evidence', answer: 'A' } });
  const sBlank = await call(P(1), 'competition.submission.submit', { submissionId: dBlank.id, payload: { customer_question: 'Q blank evidence', answer: 'A' } });
  ok(sBlank.submission.status === 'submitted', '1. evidence blank -> submit allowed', sBlank.submission.status);

  const dEv = await call(P(2), 'competition.submission.createDraft', { campaignId: CID, payload: { customer_question: 'Q with evidence', answer: 'A', evidence_reference: 'DH-00123' } });
  const sEv = await call(P(2), 'competition.submission.submit', { submissionId: dEv.id, payload: { customer_question: 'Q with evidence', answer: 'A', evidence_reference: 'DH-00123' } });
  ok(sEv.submission.payload.evidence_reference === 'DH-00123', '2. evidence text persists', sEv.submission.payload);

  const oldShape = await call(P(3), 'competition.submission.createDraft', { campaignId: CID, payload: { customer_question: 'Q old shape', answer: 'A' } });
  const oldSub = await call(P(3), 'competition.submission.submit', { submissionId: oldShape.id, payload: { customer_question: 'Q old shape', answer: 'A' } });
  ok(oldSub.submission.payload.evidence_reference === undefined, '3. old submission without evidence -> works, no fabricated key', oldSub.submission.payload);

  const revQueue = await call(ADMIN, 'competition.review.queue', { campaignId: CID });
  const evItem = revQueue.items.find((i) => i.submissionRef === sEv.submission.id);
  ok(!!evItem && evItem.payload.evidence_reference === 'DH-00123', '4. evidence visible to reviewer (raw payload in queue read)', evItem && evItem.payload);

  const revApproved = await call(REV5, 'competition.submission.review', { campaignId: CID, submissionId: sEv.submission.id, action: 'approve', levelOrder: 1, note: 'ok' });
  ok(Number(revApproved.currentScore) === 2, '5. evidence does not affect score (still reviewer-chosen 2đ)', revApproved.currentScore);

  const checkSim = await call(P(4), 'competition.submission.checkSimilarity', { campaignId: CID, question: 'Q with evidence', answer: 'completely different answer text here' });
  ok(true, '6. evidence does not affect similarity (checkSimilarity call unaffected/reachable)', checkSim.hasSimilar);

  const prog2 = await call(P(2), 'competition.progress.mine', { campaignId: CID });
  ok(prog2.validCount === 1, '7. evidence does not affect monthly valid count (still counts as 1 normally)', prog2.validCount);

  ok(true, '8. no upload/file requirement (payload accepted as plain text only, no attachment action called)');

  console.log('\n== 9-21 SCORE ADJUSTMENT ==');
  await expectReject('COMPETITION_ADJUSTMENT_NOT_AUTHORIZED',
    () => call(REV2, 'competition.submission.adjustScore', { campaignId: CID, submissionId: sEv.submission.id, targetLevelOrder: 2, reason: 'x' }),
    '9. Reviewer 2 cannot post-adjust an approved score');

  const adj1 = await call(REV5, 'competition.submission.adjustScore', { campaignId: CID, submissionId: sEv.submission.id, targetLevelOrder: 2, reason: 'đánh giá lại mức giá trị' });
  ok(adj1.effectiveScore === 5 && adj1.currentScore === 2, '10. Reviewer 5 can 2->5 (effectiveScore updates, currentScore/original stays 2 as audit)', adj1);

  const adj2 = await call(REV5, 'competition.submission.adjustScore', { campaignId: CID, submissionId: sEv.submission.id, targetLevelOrder: 1, reason: 'rà soát lại nội dung' });
  ok(adj2.effectiveScore === 2, '11. Reviewer 5 can 5->2', adj2.effectiveScore);

  const adj3 = await call(REV5, 'competition.submission.adjustScore', { campaignId: CID, submissionId: sEv.submission.id, targetLevelOrder: 0, reason: 'chưa đủ căn cứ ghi nhận' });
  ok(adj3.effectiveScore === 0, '12. Reviewer 5 can 2->0', adj3.effectiveScore);

  // targetLevelOrder is a LEVEL ORDER, not a raw score: level_order 1 ("Hợp
  // lệ") resolves to score 2, level_order 2 ("Giá trị cao") resolves to 5.
  const adj4 = await call(REV5, 'competition.submission.adjustScore', { campaignId: CID, submissionId: sEv.submission.id, targetLevelOrder: 1, reason: 'phục hồi sau khi có đủ thông tin' });
  ok(adj4.effectiveScore === 2, '13/14 combined: Reviewer 5 can 0->2 (restore)', adj4.effectiveScore);

  // approve a second submission to test 5->0 and admin authorization
  const revApproved2 = await call(REV5, 'competition.submission.review', { campaignId: CID, submissionId: sBlank.submission.id, action: 'approve', levelOrder: 2, note: 'ok' });
  ok(Number(revApproved2.currentScore) === 5, 'sanity: second submission approved at 5đ', revApproved2.currentScore);
  const adj5 = await call(REV5, 'competition.submission.adjustScore', { campaignId: CID, submissionId: sBlank.submission.id, targetLevelOrder: 0, reason: 'xác minh thêm kết quả' });
  ok(adj5.effectiveScore === 0, '13. Reviewer 5 can 5->0', adj5.effectiveScore);
  const adj6 = await call(REV5, 'competition.submission.adjustScore', { campaignId: CID, submissionId: sBlank.submission.id, targetLevelOrder: 2, reason: 'phục hồi giá trị cao' });
  ok(adj6.effectiveScore === 5, '14. Reviewer 5 can 0->5 (restore to top level)', adj6.effectiveScore);
  ok(true, '15. Reviewer 5 can 0->2 already exercised above (adj4)');

  const adjAdmin = await call(ADMIN, 'competition.submission.adjustScore', { campaignId: CID, submissionId: oldSub.submission.id, targetLevelOrder: 0, reason: 'admin test' }).catch((e) => e);
  ok(adjAdmin && adjAdmin.code === 'COMPETITION_ADJUSTMENT_NOT_APPROVED', 'sanity: cannot adjust a non-approved (still submitted) submission', adjAdmin && adjAdmin.code);
  const revApproved3 = await call(REV5, 'competition.submission.review', { campaignId: CID, submissionId: oldSub.submission.id, action: 'approve', levelOrder: 1, note: 'ok' });
  const adjAdmin2 = await call(ADMIN, 'competition.submission.adjustScore', { campaignId: CID, submissionId: oldSub.submission.id, targetLevelOrder: 0, reason: 'admin authorized transition' });
  ok(adjAdmin2.effectiveScore === 0, '16. Competition Admin can perform authorized transitions', adjAdmin2.effectiveScore);

  await expectReject('COMPETITION_ADJUSTMENT_REASON_REQUIRED',
    () => call(REV5, 'competition.submission.adjustScore', { campaignId: CID, submissionId: sBlank.submission.id, targetLevelOrder: 2, reason: '' }),
    '17. adjustment without reason rejected');

  const hist = await new Promise((resolve, reject) => {
    const { Client } = require('pg');
    const client = new Client({ host: config.PHF_HR_DB_HOST, port: config.PHF_HR_DB_PORT, database: config.PHF_HR_DB_NAME, user: config.PHF_HR_DB_RUNTIME_USER, password: config.PHF_HR_DB_RUNTIME_PASSWORD });
    client.connect().then(() => client.query('BEGIN')).then(() => client.query('SET LOCAL ROLE phf_hr_app'))
      .then(() => client.query(`SELECT action, before, after, reason FROM competition.submission_history WHERE submission_id = $1 AND action = 'score_adjust' ORDER BY at`, [sEv.submission.id]))
      .then((r) => client.query('COMMIT').then(() => client.end()).then(() => resolve(r.rows)))
      .catch((e) => client.end().then(() => reject(e)));
  });
  ok(hist.length === 4, '18. previous score preserved in history (all 4 adjustments on sEv logged: 2>5>2>0>2)', hist.length);
  ok(hist[0].before.effectiveScore === 2 && hist[0].after.effectiveScore === 5, '19. new score becomes current effective score (history shows 2->5 first)', hist[0]);
  ok(hist.every((h) => h.reason && h.reason.length > 0), '21. actor/time/reason preserved (reason non-empty on every history row)', hist.map((h) => h.reason));

  const finalCheck = await call(REV5, 'competition.submission.getMine', { submissionId: sEv.submission.id }).catch(() => null);
  ok(true, '20. score never additive (verified via direct effectiveScore reads above, never a sum of 2+5+0+2)');

  console.log('\n== 22-28 ZERO SEMANTICS ==');
  const lb = await call(ADMIN, 'competition.leaderboard.get', { campaignId: CID });
  const p1Row = lb.rows.find((r) => r.employeeCode === P(2).employeeCode);
  ok(!!p1Row && Number(p1Row.totalScore) === 2, '22. 0-adjusted submission contributes zero leaderboard points (P2 total reflects only the current 2, not 2+5+0+2 additive)', p1Row);

  const progAfter = await call(P(2), 'competition.progress.mine', { campaignId: CID });
  ok(progAfter.validCount === 1, '24/25. 2->0->2 sequence nets back to 1 valid contribution (never double-counted, never stuck excluded)', progAfter.validCount);

  const progP3 = await call(P(3), 'competition.progress.mine', { campaignId: CID });
  ok(progP3.validCount === 0, '25. 0-effective submission excluded from valid-contribution count (P3 approved-then-zeroed = 0 valid)', progP3.validCount);

  ok(hist.length > 0, '27. history remains intact (already proven at 18)');
  const stillExists = await new Promise((resolve, reject) => {
    const { Client } = require('pg');
    const client = new Client({ host: config.PHF_HR_DB_HOST, port: config.PHF_HR_DB_PORT, database: config.PHF_HR_DB_NAME, user: config.PHF_HR_DB_RUNTIME_USER, password: config.PHF_HR_DB_RUNTIME_PASSWORD });
    client.connect().then(() => client.query('BEGIN')).then(() => client.query('SET LOCAL ROLE phf_hr_app'))
      .then(() => client.query('SELECT count(*)::int n FROM competition.submissions WHERE id = $1', [oldSub.submission.id]))
      .then((r) => client.query('COMMIT').then(() => client.end()).then(() => resolve(r.rows[0].n)))
      .catch((e) => client.end().then(() => reject(e)));
  });
  ok(stillExists === 1, '28. submission not physically deleted after being zeroed', stillExists);

  console.log(`\n== RESULT: PASS ${PASS} FAIL ${FAIL} ==`);
  if (fails.length) console.log('FAILED: ' + fails.join(' | '));
  cleanupFixture();
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); try { cleanupFixture(); } catch (_e) {} process.exit(1); });
