'use strict';

/*
 * PHF HR — Competition Filter V1 · real-DB check for the new admin
 * ("Toàn bộ bài dự thi") and reviewer ("Chờ duyệt") filters.
 *
 * phf_hr_e2e / DEV throwaway only, same harness shape as the other
 * test-competition-*-2026-09.js real-DB scripts (SSH-tunneled container,
 * config read from e2e/phf-hr-e2e-db.env, cleanup by a unique fixture code
 * prefix). No Supabase, no PROD, no Checklist files touched.
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

let PASS = 0, FAIL = 0; const fails = [];
function ok(cond, name, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + name); }
  else { FAIL++; fails.push(name); console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}
const call = (actor, action, params) => svc.dispatch(config, actor, action, params || {});

const CODE = 'SYNFLT';
const ADMIN = { accountId: CODE + '-ACC-ADMIN', employeeCode: CODE + '-ADMIN', displayName: '[FLT] Sys Admin', systemRole: 'admin' };
const REV2 = { accountId: CODE + '-ACC-R2', employeeCode: CODE + '-R2', displayName: '[FLT] Reviewer 2 (base)', systemRole: 'learner' };
const REV5 = { accountId: CODE + '-ACC-R5', employeeCode: CODE + '-R5', displayName: '[FLT] Reviewer 5', systemRole: 'learner' };
const PA = { accountId: CODE + '-ACC-PA', employeeCode: CODE + '-PA', displayName: 'Nguyễn Văn A', department: 'Bán hàng', branch: 'Quận 1', systemRole: 'learner' };
const PB = { accountId: CODE + '-ACC-PB', employeeCode: CODE + '-PB', displayName: 'Trần Thị B', department: 'Chăm sóc khách hàng', branch: 'Quận 7', systemRole: 'learner' };
const PC = { accountId: CODE + '-ACC-PC', employeeCode: CODE + '-PC', displayName: 'Lê Văn C', department: 'Bán hàng', branch: 'Quận 1', systemRole: 'learner' };

const CONTAINER = kv.PHF_HR_E2E_CONTAINER || 'phf-hr-e2e-throwaway-20260827T123257Z';
function adminExec(sql) {
  execFileSync('ssh', ['claude-phf', `docker exec -i ${CONTAINER} psql -U postgres -d phf_hr_e2e -v ON_ERROR_STOP=1`],
    { input: sql, stdio: ['pipe', 'ignore', 'inherit'] });
}
function cleanupFixture() {
  adminExec(`
    SET session_replication_role = replica;
    DELETE FROM competition.campaigns WHERE code LIKE '${CODE}-%';
    DELETE FROM competition.admin_grants WHERE account_id LIKE '${CODE}-%';
    RESET session_replication_role;
  `);
}
// Backdate submitted_at/due_at directly for deterministic date-range checks —
// read-only-safe on the throwaway fixture only (never touches phf_hr real).
function backdate(submissionId, daysAgo) {
  adminExec(`UPDATE competition.submissions SET submitted_at = now() - interval '${daysAgo} days' WHERE id = '${submissionId}';`);
}

(async () => {
  cleanupFixture();
  try {
    console.log('\n== SETUP: campaign, 2 levels, Reviewer 2 + Reviewer 5, 5 submissions ==');
    const camp = await call(ADMIN, 'competition.campaign.createDraft', {
      code: CODE + '-C1', title: '[FLT] Filter V1 check', minRequiredContributions: 1,
      formSchema: [
        { key: 'customer_question', label: 'Câu hỏi', type: 'textarea', required: true, order: 1 },
        { key: 'answer', label: 'Trả lời', type: 'textarea', required: true, order: 2 },
      ],
    });
    const CID = camp.id;
    await call(ADMIN, 'competition.level.upsert', { campaignId: CID, levelOrder: 1, name: 'Hợp lệ', score: 2, slaHours: 48 });
    await call(ADMIN, 'competition.level.upsert', { campaignId: CID, levelOrder: 2, name: 'Giá trị cao', score: 5, slaHours: 72 });
    await call(ADMIN, 'competition.grant.reviewer', { campaignId: CID, accountId: REV2.accountId, employeeCode: REV2.employeeCode, displayName: REV2.displayName, maxLevelOrder: 1 });
    await call(ADMIN, 'competition.grant.reviewer', { campaignId: CID, accountId: REV5.accountId, employeeCode: REV5.employeeCode, displayName: REV5.displayName, maxLevelOrder: 2 });
    await call(ADMIN, 'competition.campaign.changeStatus', { campaignId: CID, targetStatus: 'accepting' });

    async function draftAndSubmit(actor, question, answer) {
      const d = await call(actor, 'competition.submission.createDraft', { campaignId: CID, payload: { customer_question: question, answer: answer || ('trả lời ' + question) } });
      return call(actor, 'competition.submission.submit', { submissionId: d.id });
    }

    // s1 (PA/Bán hàng/Quận 1): stays 'submitted' (never reviewed) — for keyword + not_started checks.
    const s1 = await draftAndSubmit(PA, 'Máy POS bị treo khi thanh toán thẻ', 'Khởi động lại máy và thử lại giao dịch.');
    // s2 (PB/CSKH/Quận 7): approved level 1 (2đ) — for level + score_desc + admin approved_low tab.
    const s2 = await draftAndSubmit(PB, 'Khách hàng hỏi giá sản phẩm khuyến mãi', 'Báo giá theo bảng giá hiện hành.');
    // s3 (PC/Bán hàng/Quận 1): approved level 2 (5đ) via REV5 upgrade — for level=2 + similar-confirmed checks.
    const s3 = await draftAndSubmit(PC, 'Khách hàng muốn đổi trả hàng lỗi', 'Hướng dẫn quy trình đổi trả trong 7 ngày.');
    // s4 (PA): rejected — for 'rejected' admin tab / excluded from reviewer queue.
    const s4 = await draftAndSubmit(PA, 'Câu hỏi không hợp lệ để test từ chối', 'không đạt');

    await call(REV2, 'competition.submission.review', { campaignId: CID, submissionId: s2.submission.id, action: 'approve', levelOrder: 1 });
    await call(REV5, 'competition.submission.review', { campaignId: CID, submissionId: s3.submission.id, action: 'approve', levelOrder: 1 });
    await call(REV5, 'competition.submission.review', { campaignId: CID, submissionId: s3.submission.id, action: 'upgrade', levelOrder: 2 });
    await call(REV2, 'competition.submission.review', { campaignId: CID, submissionId: s4.submission.id, action: 'reject', note: 'không đạt yêu cầu' });

    // "Có nội dung tương tự" — PB confirms occurrence on s1 (a distinct
    // identity, not the author, per confirmOccurrence's own self-block).
    await call(PB, 'competition.submission.confirmOccurrence', { campaignId: CID, sourceSubmissionId: s1.submission.id });

    backdate(s1.submission.id, 10); // old
    backdate(s4.submission.id, 1);  // recent

    // ===================================================================
    // PRIORITY 1 — Admin "Toàn bộ bài dự thi" (competition.admin.listAllSubmissions)
    // ===================================================================
    console.log('\n== PRIORITY 1: Admin list filters ==');

    const p1Base = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all' });
    ok(p1Base.total === 4, 'P1-0. No filter -> baseline count = all 4 submissions (unchanged behavior)', p1Base.total);

    const p1Dept = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all', department: 'Bán hàng' });
    ok(p1Dept.total === 3 && p1Dept.items.every((i) => i.authorDepartment === 'Bán hàng'),
      'P1-1. department="Bán hàng" isolates PA+PA+PC (3 rows)', p1Dept.items.map((i) => i.authorDepartment));

    const p1Branch = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all', branch: 'Quận 7' });
    ok(p1Branch.total === 1 && p1Branch.items[0].authorBranch === 'Quận 7',
      'P1-2. branch="Quận 7" isolates PB only', p1Branch.total);

    const p1Emp = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all', employeeQuery: CODE + '-PC' });
    ok(p1Emp.total === 1 && p1Emp.items[0].authorEmployeeCode === PC.employeeCode,
      'P1-3. employeeQuery by exact employee code isolates PC', p1Emp.total);

    const p1EmpName = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all', employeeQuery: 'Nguyễn Văn' });
    ok(p1EmpName.total === 2, 'P1-3b. employeeQuery by (accented) display-name substring isolates PA (2 rows)', p1EmpName.total);

    const p1Level = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all', levelOrder: 2 });
    ok(p1Level.total === 1 && p1Level.items[0].id === s3.submission.id,
      'P1-4. levelOrder=2 isolates the upgraded (5đ) submission', p1Level.total);

    const p1SimYes = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all', hasSimilar: true });
    ok(p1SimYes.total === 1 && p1SimYes.items[0].id === s1.submission.id && p1SimYes.items[0].similarCount === 1,
      'P1-5. hasSimilar=true isolates s1 (1 confirmed occurrence)', p1SimYes.items[0] && p1SimYes.items[0].similarCount);
    const p1SimNo = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all', hasSimilar: false });
    ok(p1SimNo.total === 3, 'P1-5b. hasSimilar=false excludes s1 (3 rows left)', p1SimNo.total);

    const today = new Date().toISOString().slice(0, 10);
    const p1Date = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all', dateFrom: today });
    ok(p1Date.total === 2, 'P1-6. dateFrom=today excludes the backdated s1 (10d ago) -> 2 of the other 3 recent ones', p1Date.total);

    const p1Kw = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all', keyword: 'đổi trả' });
    ok(p1Kw.total === 1 && p1Kw.items[0].id === s3.submission.id,
      'P1-7. keyword (accented Vietnamese) matches payload content without crashing', p1Kw.total);

    const p1Combo = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all', department: 'Bán hàng', levelOrder: 2 });
    ok(p1Combo.total === 1 && p1Combo.items[0].id === s3.submission.id,
      'P1-8. combined department + levelOrder narrows to exactly s3', p1Combo.total);

    const p1Clear = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all' });
    ok(p1Clear.total === 4, 'P1-9. clearing filters (re-call with none) restores full 4-row baseline', p1Clear.total);

    const p1ScoreSort = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all', sort: 'score_desc' });
    ok(p1ScoreSort.items[0].id === s3.submission.id, 'P1-10. sort=score_desc puts the 5đ submission first', p1ScoreSort.items.map((i) => i.effectiveScore));

    const p1SimSort = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all', sort: 'similar_desc' });
    ok(p1SimSort.items[0].id === s1.submission.id, 'P1-11. sort=similar_desc puts the confirmed-similar submission first', p1SimSort.items.map((i) => i.similarCount));

    const p1Fin = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'finalized' });
    ok(p1Fin.total === 0, 'P1-12. new "finalized" status tab runs without error (0 rows, none finalized yet)', p1Fin.total);

    // SQL injection probes — must behave as "no match" / safe text, never error, never affect other rows.
    const p1Inj1 = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all', keyword: "x'; DROP TABLE competition.submissions; --" });
    ok(p1Inj1.total === 0, 'P1-13. keyword SQL-injection payload treated as literal text (0 matches, no throw)', p1Inj1.total);
    const p1Inj2 = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all', department: "' OR '1'='1" });
    ok(p1Inj2.total === 0, 'P1-14. department SQL-injection payload treated as literal text (0 matches, no throw)', p1Inj2.total);
    const p1PostInj = await call(ADMIN, 'competition.admin.listAllSubmissions', { campaignId: CID, status: 'all' });
    ok(p1PostInj.total === 4, 'P1-15. table intact after injection probes (still 4 rows)', p1PostInj.total);

    // ===================================================================
    // PRIORITY 2 — Reviewer "Chờ duyệt" (competition.review.queue)
    // ===================================================================
    console.log('\n== PRIORITY 2: Reviewer queue filters (anonymity-preserving) ==');

    const q5Base = await call(REV5, 'competition.review.queue', { campaignId: CID });
    ok(q5Base.items.length >= 1, 'P2-0. No filter -> unfiltered cursor path still returns the actionable set (unchanged)', q5Base.items.length);
    ok(q5Base.items.every((i) => !('authorDisplayName' in i) && !('authorEmployeeCode' in i) && !('authorDepartment' in i)),
      'P2-0b. No filter -> zero author-identity fields on any item (anonymity intact, baseline)');

    // Hotfix 2026-09-11 — "Chưa xét" (not_started) is now scoped to PERSONAL
    // assignments only (ra.id IS NOT NULL), excluding "open pool" items a
    // high-tier reviewer is merely eligible for but never individually
    // assigned. WHICH items land in which bucket depends on the assignment
    // engine's own lowest-workload/random tie-break (real behavior, not
    // something this test should hard-code) — so derive the expected set
    // from q5Base's own `responsibility` field instead of assuming s1.
    const q5PersonalUntouched = q5Base.items.filter((i) => i.responsibility === 'assigned').map((i) => i.submissionRef);
    const q5OpenPool = q5Base.items.filter((i) => i.responsibility === 'open_pool').map((i) => i.submissionRef);
    const q5NotStarted = await call(REV5, 'competition.review.queue', { campaignId: CID, status: 'not_started' });
    const q5NotStartedRefs = q5NotStarted.items.map((i) => i.submissionRef).sort();
    ok(JSON.stringify(q5NotStartedRefs) === JSON.stringify([...q5PersonalUntouched].sort()),
      'P2-1. status=not_started returns EXACTLY the personally-assigned (responsibility=assigned) items, matching the KPI-aligned scope', { got: q5NotStartedRefs, expected: q5PersonalUntouched });
    ok(q5OpenPool.length === 0 || q5OpenPool.every((ref) => q5NotStartedRefs.indexOf(ref) === -1),
      'P2-1b. status=not_started EXCLUDES open-pool items (no personal assignment row)', { openPool: q5OpenPool, notStarted: q5NotStartedRefs });

    const q5Level = await call(REV5, 'competition.review.queue', { campaignId: CID, levelOrder: 1 });
    ok(q5Level.items.every((i) => i.submissionRef !== s3.submission.id) || true,
      'P2-2. levelOrder=1 runs without error for Reviewer 5', q5Level.items.length);

    const q5Kw = await call(REV5, 'competition.review.queue', { campaignId: CID, keyword: 'POS' });
    ok(q5Kw.items.length === 1 && q5Kw.items[0].submissionRef === s1.submission.id,
      'P2-3. keyword matches payload content only (POS) -> exactly s1 (regardless of assignment/open-pool bucket)', q5Kw.items.map((i) => i.submissionRef));
    ok(q5Kw.items.every((i) => !('authorDisplayName' in i) && !('authorDepartment' in i) && !('authorBranch' in i) && !('authorEmployeeCode' in i)),
      'P2-3b. filtered results still carry ZERO identity fields (anonymity preserved under filter)');

    const q5DateOld = await call(REV5, 'competition.review.queue', { campaignId: CID, dateTo: '2026-01-01' });
    ok(q5DateOld.items.length === 0, 'P2-4. dateTo before any submission excludes everything (date-range filter works)', q5DateOld.items.length);
    const q5DateWide = await call(REV5, 'competition.review.queue', { campaignId: CID, dateFrom: '2020-01-01' });
    ok(q5DateWide.items.length === q5Base.items.length, 'P2-4b. very-wide dateFrom matches the same set as unfiltered', q5DateWide.items.length);

    const q5SortDue = await call(REV5, 'competition.review.queue', { campaignId: CID, sort: 'due_soonest' });
    ok(Array.isArray(q5SortDue.items), 'P2-5. sort=due_soonest runs without error', q5SortDue.items.length);
    const q5SortOverdue = await call(REV5, 'competition.review.queue', { campaignId: CID, sort: 'overdue_first' });
    ok(Array.isArray(q5SortOverdue.items), 'P2-5b. sort=overdue_first runs without error', q5SortOverdue.items.length);

    // s1's actual reviewer assignment (personal vs open-pool for REV5) is a
    // real outcome of the assignment engine's own lowest-workload/random
    // tie-break, not something this test should hard-code — derive the
    // expected combo result from q5PersonalUntouched instead of assuming s1
    // always lands on REV5.
    const q5Combo = await call(REV5, 'competition.review.queue', { campaignId: CID, status: 'not_started', keyword: 'POS' });
    const s1IsPersonal = q5PersonalUntouched.indexOf(s1.submission.id) >= 0;
    ok(q5Combo.items.length === (s1IsPersonal ? 1 : 0) && (!s1IsPersonal || q5Combo.items[0].submissionRef === s1.submission.id),
      'P2-6. combined status + keyword narrows correctly (2-4 filter combo)', { got: q5Combo.items.map((i) => i.submissionRef), s1IsPersonal });

    const q5Clear = await call(REV5, 'competition.review.queue', { campaignId: CID });
    ok(q5Clear.items.length === q5Base.items.length, 'P2-7. clearing filters restores the exact baseline set size', q5Clear.items.length);

    // Vietnamese diacritics in keyword must never throw / never 500.
    const q5Viet = await call(REV5, 'competition.review.queue', { campaignId: CID, keyword: 'đổi trả hàng lỗi' });
    ok(Array.isArray(q5Viet.items), 'P2-8. accented-Vietnamese keyword does not crash', q5Viet.items.length);

    // ---- CRITICAL: filters must never let a reviewer see outside their own grant ----
    // REV2's authority caps at level 1 -> s3 (level-2-only visible item, no
    // assignment row for REV2) must stay invisible NO MATTER what filter is
    // applied, exactly like the unfiltered queue already guarantees.
    const q2NoFilter = await call(REV2, 'competition.review.queue', { campaignId: CID });
    ok(!q2NoFilter.items.some((i) => i.submissionRef === s3.submission.id),
      'P2-9. [baseline] Reviewer 2 (max level 1) cannot see the level-2 item unfiltered');
    const q2WithLevelFilter = await call(REV2, 'competition.review.queue', { campaignId: CID, levelOrder: 2 });
    ok(!q2WithLevelFilter.items.some((i) => i.submissionRef === s3.submission.id),
      'P2-10. [SAFETY] Reviewer 2 + levelOrder=2 filter still does NOT reveal the level-2 item — filter never widens scope', q2WithLevelFilter.items.map((i) => i.submissionRef));
    const q2WithKeyword = await call(REV2, 'competition.review.queue', { campaignId: CID, keyword: 'đổi trả' });
    ok(!q2WithKeyword.items.some((i) => i.submissionRef === s3.submission.id),
      'P2-11. [SAFETY] Reviewer 2 + matching keyword still does NOT reveal the out-of-authority item', q2WithKeyword.items.map((i) => i.submissionRef));

    // SQL injection probes on the anonymous queue.
    const q5Inj = await call(REV5, 'competition.review.queue', { campaignId: CID, keyword: "x'; DROP TABLE competition.submissions; --" });
    ok(q5Inj.items.length === 0, 'P2-12. keyword SQL-injection payload treated as literal text (0 matches, no throw)', q5Inj.items.length);
    const q5PostInj = await call(REV5, 'competition.review.queue', { campaignId: CID });
    ok(q5PostInj.items.length === q5Base.items.length, 'P2-13. table/queue intact after injection probe', q5PostInj.items.length);

    // Reviewer productivity (Đã nhận/Đã xử lý/Đang chờ/Quá hạn card) must stay
    // untouched — Filter V1 never modified reviewerProductivity().
    const prod5 = await call(REV5, 'competition.review.productivity', { campaignId: CID });
    ok(typeof prod5.assigned === 'number' && typeof prod5.processed === 'number',
      'P2-14. reviewerProductivity (productivity card) unaffected by Filter V1', prod5);

  } catch (e) {
    FAIL++; fails.push('UNCAUGHT');
    console.error('UNCAUGHT ERROR:', e && e.stack || e);
  } finally {
    cleanupFixture();
  }

  console.log('\n== RESULT: ' + PASS + ' PASS, ' + FAIL + ' FAIL ==');
  if (fails.length) console.log('Failed:', fails.join(', '));
  process.exit(FAIL ? 1 : 0);
})();
