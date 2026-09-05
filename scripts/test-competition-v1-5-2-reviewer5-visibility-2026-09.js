'use strict';

/*
 * PHF HR — Competition V1.5.2 · TARGETED real-DB check for the
 * anonymousQueue "approved item still has upgrade room" completion fix.
 * Minimal, fast (no 200-row bulk case) — exactly the 5 checks requested:
 *   1. Reviewer 2 behavior unchanged.
 *   2. Reviewer 5 sees a never-reviewed actionable submission.
 *   3. Reviewer 5 sees an approved-at-2 submission still upgradeable to 5.
 *   4. Reviewer 5 cannot self-review.
 *   5. A final/non-actionable item is not incorrectly shown.
 *
 * phf_hr_e2e / DEV only, same harness shape as the other test-competition-*
 * real-DB scripts (SSH-tunneled throwaway container).
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

const ADMIN = { accountId: 'SYN52-ACC-ADMIN', employeeCode: 'SYN52-ADMIN', displayName: '[SYN52] Sys Admin', systemRole: 'admin' };
const REV2A = { accountId: 'SYN52-ACC-R2A', employeeCode: 'SYN52-R2A', displayName: '[SYN52] Reviewer 2 (base)', systemRole: 'learner' };
const REV5A = { accountId: 'SYN52-ACC-R5A', employeeCode: 'SYN52-R5A', displayName: '[SYN52] Reviewer 5 A', systemRole: 'learner' };
const P = (n) => ({ accountId: 'SYN52-ACC-P' + n, employeeCode: 'SYN52-P' + n, displayName: '[SYN52] P' + n, systemRole: 'learner' });
const CODE = 'SYN52-V152';

const CONTAINER = kv.PHF_HR_E2E_CONTAINER || 'phf-hr-e2e-throwaway-20260827T123257Z';
function adminExec(sql) {
  execFileSync('ssh', ['claude-phf', `docker exec -i ${CONTAINER} psql -U postgres -d phf_hr_e2e -v ON_ERROR_STOP=1`],
    { input: sql, stdio: ['pipe', 'ignore', 'inherit'] });
}
function cleanupFixture() {
  adminExec(`
    SET session_replication_role = replica;
    DELETE FROM competition.campaigns WHERE code LIKE 'SYN52-%';
    DELETE FROM competition.admin_grants WHERE account_id LIKE 'SYN52-%';
    RESET session_replication_role;
  `);
}

(async () => {
  cleanupFixture();
  try {
    console.log('\n== SETUP: campaign, 2 levels, Reviewer 2 (base) + Reviewer 5 (high-tier) ==');
    const camp = await call(ADMIN, 'competition.campaign.createDraft', {
      code: CODE, title: '[SYN52] V1.5.2 targeted visibility check', minRequiredContributions: 1,
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
    await call(ADMIN, 'competition.campaign.changeStatus', { campaignId: CID, targetStatus: 'accepting' });

    async function draftAndSubmit(actor, question) {
      const d = await call(actor, 'competition.submission.createDraft', { campaignId: CID, payload: { customer_question: question, answer: 'trả lời ' + question } });
      return call(actor, 'competition.submission.submit', { submissionId: d.id });
    }

    // ---- fixture: 3 authored submissions (never REV5A) ----
    const sNew = await draftAndSubmit(P(1), 'state1 never-reviewed actionable');
    const sApprovable = await draftAndSubmit(P(2), 'state2 candidate for approve-then-upgrade');
    const sFinal = await draftAndSubmit(P(3), 'state3 candidate for final non-actionable');
    const sSelf = await draftAndSubmit(REV5A, 'REV5A own submission, must never self-review');

    // approve sApprovable to level 1 (2 điểm) via REV2A — real reviewer action,
    // real lifecycle — leaves it 'approved', current_level_order=1, WITH room
    // for REV5A to upgrade to level 2 (5 điểm).
    await call(REV2A, 'competition.submission.review', { campaignId: CID, submissionId: sApprovable.submission.id, action: 'approve', levelOrder: 1 });

    // sFinal -> reject (final/non-actionable state).
    await call(REV2A, 'competition.submission.review', { campaignId: CID, submissionId: sFinal.submission.id, action: 'reject', note: 'không đạt yêu cầu' });

    console.log('\n== TARGETED CHECKS ==');

    // 1. Reviewer 2 unaffected: sees only their own assigned pending items,
    //    never an 'approved' row (their authority caps at level 1).
    const q2 = await call(REV2A, 'competition.review.queue', { campaignId: CID });
    ok(!q2.items.some((i) => i.submissionRef === sApprovable.submission.id),
      '1. Reviewer 2 does NOT see the approved-awaiting-upgrade item (authority caps at level 1)', q2.items.map((i) => i.submissionRef));
    ok(q2.items.every((i) => i.responsibility === 'assigned'),
      '1b. Reviewer 2 items are all "assigned" (never open_pool) — unchanged scope');

    // 2. Reviewer 5 sees the never-reviewed item.
    const q5 = await call(REV5A, 'competition.review.queue', { campaignId: CID });
    const newItem = q5.items.find((i) => i.submissionRef === sNew.submission.id);
    ok(!!newItem, '2. Reviewer 5 sees the never-reviewed actionable submission', q5.items.map((i) => i.submissionRef));
    ok(!!newItem && !newItem.currentLevelOrder, '2b. that item carries no currentLevelOrder (never reviewed) -> UI label "Chưa duyệt"');

    // 3. Reviewer 5 sees the approved-at-2 item, still upgradeable to 5.
    const approvedItem = q5.items.find((i) => i.submissionRef === sApprovable.submission.id);
    ok(!!approvedItem, '3. Reviewer 5 sees the approved-at-2 item (upgrade room to 5)', q5.items.map((i) => i.submissionRef));
    ok(!!approvedItem && approvedItem.currentLevelOrder === 1,
      '3b. that item has currentLevelOrder=1 -> UI label "Đã duyệt 2 điểm — có thể nâng mức"', approvedItem);
    const scoreForItem = (q5.eligibleLevels || []).find((l) => l.levelOrder === (approvedItem && approvedItem.currentLevelOrder));
    ok(!!scoreForItem && Number(scoreForItem.score) === 2,
      '3c. eligibleLevels resolves currentLevelOrder=1 to score=2 (matches "Đã duyệt 2 điểm")', scoreForItem);

    // 4. Reviewer 5 cannot self-review (server-authoritative, independent of
    //    the queue broadening).
    await expectReject('COMPETITION_SELF_REVIEW_BLOCKED',
      () => call(REV5A, 'competition.submission.review', { campaignId: CID, submissionId: sSelf.submission.id, action: 'approve', levelOrder: 1 }),
      '4. Reviewer 5 direct API self-review attempt is blocked server-side');
    ok(!q5.items.some((i) => i.submissionRef === sSelf.submission.id),
      '4b. Reviewer 5 does not even see their own submission in the queue');

    // 5. Final/non-actionable (rejected) item must not appear for Reviewer 5.
    ok(!q5.items.some((i) => i.submissionRef === sFinal.submission.id),
      '5. rejected (final/non-actionable) submission is NOT shown in Reviewer 5\'s queue', q5.items.map((i) => i.submissionRef));

    // sanity: anonymity — no author identity leaked anywhere in the queue payload.
    const anonCheck = JSON.stringify(q5);
    ok(!/SYN52-P\d|SYN52-ACC-P|displayName/.test(anonCheck), 'sanity: no author identity in Reviewer 5\'s queue response');

    console.log('\n==== V1_5_2_TARGETED  PASS=' + PASS + '  FAIL=' + FAIL + ' ====');
    if (FAIL) { console.log('FAILURES:'); fails.forEach((f) => console.log(' - ' + f)); }
    process.exitCode = FAIL ? 1 : 0;
  } finally {
    // leave the fixture in place ONLY on success, so the Operator can
    // reuse these exact 3 real states for visual verification if useful —
    // caller decides; this script itself does not clean up on success.
    if (FAIL) cleanupFixture();
  }
})().catch((e) => { console.error('FATAL', e && (e.stack || e)); process.exit(1); });
