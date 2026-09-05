'use strict';

/*
 * DEV-ONLY dry run of the Competition V1.2 historical-import logic against
 * the throwaway phf_hr_e2e — proves the import is idempotent (2nd run finds
 * all 5 already present via author+question match, inserts 0) BEFORE it
 * ever touches Production. Uses synthetic actors + a throwaway campaign,
 * mirrors scripts/test-competition-c1-realdb-2026-09.js's tunnel/env pattern.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
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
  adminExec(`SET session_replication_role = replica; DELETE FROM competition.campaigns WHERE code LIKE 'SYN5-IMP-%'; RESET session_replication_role;`);
}

const ADMIN = { accountId: 'SYN5-ACC-ADMIN', employeeCode: 'SYN5-ADMIN', displayName: '[SYN5] Sys Admin', systemRole: 'admin' };
const DIEM = { accountId: 'SYN5-ACC-DIEM', employeeCode: 'SYN5-DIEM', displayName: '[SYN5] Đặng Thị Diễm (fixture)', department: 'Bán hàng', branch: 'CN1', systemRole: 'learner' };
const LE = { accountId: 'SYN5-ACC-LE', employeeCode: 'SYN5-LE', displayName: '[SYN5] Nguyễn Thị Lệ (fixture)', department: 'Bán hàng', branch: 'CN2', systemRole: 'learner' };
const CODE = 'SYN5-IMP-1-2';

const ROWS = [
  { row: 1, author: DIEM, question: 'Q1 shop chưa bán', answer: 'A1', actual_result: 'R1' },
  { row: 2, author: DIEM, question: 'Q2 shop vừa hết', answer: 'A2', actual_result: 'R2' },
  { row: 3, author: LE, question: 'Q3 táo tàu', answer: 'A3', actual_result: 'R3' },
  { row: 4, author: LE, question: 'Q4 sản phẩm khác', answer: 'A4', actual_result: 'R4' },
  { row: 5, author: LE, question: 'Q5 nho xanh', answer: 'A5', actual_result: 'R5' },
];

async function findExistingByAuthorAndQuestion(config, campaignId, author, question) {
  const mine = await svc.dispatch(config, author, 'competition.submission.listMine', { campaignId });
  return (mine || []).find((s) => s.payload && s.payload.customer_question === question) || null;
}

async function runImportPass(campaignId) {
  let inserted = 0, skipped = 0;
  for (const r of ROWS) {
    const existing = await findExistingByAuthorAndQuestion(config, campaignId, r.author, r.question);
    if (existing) { skipped++; continue; }
    const payload = { customer_question: r.question, answer: r.answer, actual_result: r.actual_result };
    const draft = await svc.dispatch(config, r.author, 'competition.submission.createDraft', { campaignId, payload });
    await svc.dispatch(config, r.author, 'competition.submission.submit', { submissionId: draft.id, payload });
    inserted++;
  }
  return { inserted, skipped };
}

let PASS = 0, FAIL = 0;
function ok(cond, name, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + name); }
  else { FAIL++; console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}

(async () => {
  cleanupFixture();
  const camp = await svc.dispatch(config, ADMIN, 'competition.campaign.createDraft', { code: CODE, title: '[SYN5] Import idempotency dry run', minRequiredContributions: 1 });
  await svc.dispatch(config, ADMIN, 'competition.level.upsert', { campaignId: camp.id, levelOrder: 1, name: 'Hợp lệ', score: 2, slaHours: 48 });
  await svc.dispatch(config, ADMIN, 'competition.campaign.changeStatus', { campaignId: camp.id, targetStatus: 'accepting' });

  const pass1 = await runImportPass(camp.id);
  ok(pass1.inserted === 5 && pass1.skipped === 0, 'first pass inserts exactly 5, skips 0', pass1);

  const pass2 = await runImportPass(camp.id);
  ok(pass2.inserted === 0 && pass2.skipped === 5, 'second (re-run) pass is idempotent: inserts 0, skips all 5', pass2);

  const dSubs = await svc.dispatch(config, DIEM, 'competition.submission.listMine', { campaignId: camp.id });
  const lSubs = await svc.dispatch(config, LE, 'competition.submission.listMine', { campaignId: camp.id });
  ok(dSubs.length === 2, 'Đặng Thị Diễm has exactly 2 submissions', dSubs.length);
  ok(lSubs.length === 3, 'Nguyễn Thị Lệ has exactly 3 submissions', lSubs.length);
  ok(dSubs.every((s) => s.status === 'submitted' && s.currentScore == null), 'imported rows are unscored/pending review, not auto-approved', dSubs.map((s) => [s.status, s.currentScore]));

  console.log(`\n== RESULT: PASS ${PASS} FAIL ${FAIL} ==`);
  cleanupFixture();
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); try { cleanupFixture(); } catch (_e) {} process.exit(1); });
