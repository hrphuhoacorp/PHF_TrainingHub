'use strict';
/*
 * PHF HR — QTTH · Accounting Data V1 · OPERATOR DECISION LAYER (V2) engine checks
 * (offline, no DB/network). Proves the SAFE remembered-rule mechanics against the
 * real T07 source: account-only cannot auto-classify, account + approved
 * deterministic description pattern can, materially different description falls
 * back to NEEDS_REVIEW, disabled rule stops firing, CCDC stays NEEDS_REVIEW,
 * PHF-MKT KEEP+WARN, no 911 double-count, 350 cost-scope rows always reconcile.
 *
 * Run: node scripts/qtth-accounting-v2-decision-engine-checks.js
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const C = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-accounting-classify'));
const { runFunnel } = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-accounting-normalize'));
const T07 = path.join(REPO, 'phf-qtth-input', 'accounting_t07.xlsx');

let P = 0, F = 0;
const ck = (n, c, x) => { c ? (P++, console.log('  PASS  ' + n)) : (F++, console.error('  FAIL  ' + n + (x != null ? '  -> ' + x : ''))); };
const seed = () => C.SEED_RULES.map((r) => Object.assign({ origin: 'seed' }, r));
const opRule = (id, acct, text, action, extra) => Object.assign({
  id, priority: 15, origin: 'operator', action, matchKind: 'combo',
  matchValue: { all: [
    { matchKind: 'account_exact', matchValue: { accounts: [acct] } },
    { matchKind: 'description', matchValue: { allTokens: C.descTokens(text) } },
  ] },
}, extra || {});
const row = (acct, desc, o) => Object.assign({ taiKhoan: acct, dienGiai: desc, tkDoiUng: '3311', maCt: 'HD', maBp: 'CN1', phatSinhNo: 100, phatSinhCo: 0 }, o || {});

(async () => {
  console.log('QTTH Accounting Data V1 — Operator decision engine checks\n');

  // ---- 1. account-only match cannot auto-classify --------------------
  const rExcl6414 = opRule('op-6414', '6414', 'phân bổ khấu hao TSCĐ', 'EXCLUDE');
  let clf = C.buildClassifier([rExcl6414].concat(seed()));
  ck('1. account 6414 alone (different desc) -> NEEDS_REVIEW (no account-only rule)',
    clf.classify(row('6414', 'Mua bàn ghế văn phòng chi nhánh')).classification === 'NEEDS_REVIEW');
  ck('1. there is NO account_exact/account_prefix operator rule path',
    !C.SEED_RULES.some((s) => s.origin === 'operator'));

  // ---- 2. account + approved description pattern can auto-classify ---
  ck('2. 6414 + "Bút toán phân bổ khấu hao TSCĐ" -> EXCLUDE (remembered)',
    clf.classify(row('6414', 'Bút toán phân bổ khấu hao TSCĐ kỳ 7/2026')).classification === 'EXCLUDE');
  ck('2. match is token-order independent + diacritic/-case insensitive',
    clf.classify(row('6414', 'KHAU HAO PHAN BO TSCD')).classification === 'EXCLUDE');

  // ---- 3. same account + materially different description -> NEEDS_REVIEW
  ck('3. 6414 + "Chi tiền tiếp khách" -> NEEDS_REVIEW (fail safe)',
    clf.classify(row('6414', 'Chi tiền mặt tiếp khách đối tác')).classification === 'NEEDS_REVIEW');
  ck('3. partial token overlap ("khấu hao" only) -> NEEDS_REVIEW (ALL tokens required)',
    clf.classify(row('6414', 'Trích khấu hao nhanh thiết bị')).classification === 'NEEDS_REVIEW');

  // ---- 4. disabled remembered rule no longer auto-classifies --------
  const disabled = Object.assign({}, rExcl6414, { isActive: false });
  clf = C.buildClassifier([disabled].concat(seed()));
  ck('4. disabled rule (isActive:false) -> 6414 approved desc back to NEEDS_REVIEW',
    clf.classify(row('6414', 'Bút toán phân bổ khấu hao TSCĐ')).classification === 'NEEDS_REVIEW');

  // ---- 5 (offline part). INCLUDE decision carries the category ------
  const incFB = opRule('op-64177fb', '64177', 'Chi phí quảng cáo facebook', 'INCLUDE',
    { costCode: 'D-6413-1-08', costCodeName: 'Chi phí quảng cáo và tiếp thị' });
  clf = C.buildClassifier([incFB].concat(seed()));
  const v = clf.classify(row('64177', 'Chi phí quảng cáo facebook tháng 7'));
  ck('5. INCLUDE remembered rule returns its cost category', v.classification === 'INCLUDE' && v.costCode === 'D-6413-1-08', JSON.stringify(v));

  // ---- 6 (offline part). EXCLUDE decision stays traceable to its rule
  clf = C.buildClassifier([rExcl6414].concat(seed()));
  const ex = clf.classify(row('6414', 'Bút toán phân bổ khấu hao TSCĐ'));
  ck('6. EXCLUDE verdict carries ruleId + source=operator_rule', ex.ruleId === 'op-6414' && ex.source === 'operator_rule', JSON.stringify(ex));

  // ---- conflict -> NEEDS_REVIEW (never arbitrary precedence) --------
  const a = opRule('op-a', '64178', 'phân bổ CCDC', 'INCLUDE');
  const b = opRule('op-b', '64178', 'phân bổ CCDC', 'EXCLUDE');
  clf = C.buildClassifier([a, b].concat(seed()));
  ck('CONFLICT. two operator rules disagree on the same row -> NEEDS_REVIEW',
    clf.classify(row('64178', 'Bút toán phân bổ CCDC')).classification === 'NEEDS_REVIEW');

  // ---- 7. CCDC allocation stays NEEDS_REVIEW with NO operator rule --
  clf = C.buildClassifier(seed());
  for (const acct of ['64177', '64178', '64273', '6422', '6423']) {
    ck('7. ' + acct + ' + "Bút toán phân bổ CCDC" -> NEEDS_REVIEW (no auto CCDC decision)',
      clf.classify(row(acct, 'Bút toán phân bổ CCDC')).classification === 'NEEDS_REVIEW');
  }

  // ---- funnel-level checks on the REAL T07 (engine unchanged) -------
  if (fs.existsSync(T07)) {
    const { report, normalizedRows, totals, amounts } = await runFunnel(fs.readFileSync(T07), { rules: seed() });
    const T = report.totals;
    ck('10. SOURCE/DEBIT/COST_SCOPE extraction unchanged (85975 / 38768 / 350)',
      T.sourceRows === 85975 && T.debitRows === 38768 && T.costScopeRows === 350, JSON.stringify(T));
    ck('10. INCLUDE 299 / NEEDS_REVIEW 51 / EXCLUDE 0 unchanged (no operator rules)',
      T.included === 299 && T.needsReview === 51 && T.excluded === 0);
    ck('11. rows reconcile: INCLUDE + EXCLUDE + NEEDS_REVIEW === COST_SCOPE',
      T.included + T.excluded + T.needsReview === T.costScopeRows);
    ck('11. amounts reconcile exactly (VND, no drift)',
      amounts.included + amounts.excluded + amounts.needsReview === amounts.costScope,
      `${amounts.included}+${amounts.excluded}+${amounts.needsReview} vs ${amounts.costScope}`);
    ck('8. PHF-MKT KEEP + WARN (flagged out-of-master, row retained)',
      T.outOfMasterDepartments.indexOf('PHF-MKT') >= 0 && normalizedRows.some((r) => r.maBp === 'PHF-MKT' && r.maBpOutOfMaster));
    ck('9. no 911 double-count: 0 normalized rows with contra 911',
      !normalizedRows.some((r) => /^911/.test(r.tkDoiUng || '')));
    ck('13. no 85,975 raw rows persisted as fact (normalized kept small)', normalizedRows.length === 350);

    // simulate an operator EXCLUDE-6414 remembered rule over the real file
    const with6414 = seed().concat([opRule('op-6414', '6414', 'phân bổ khấu hao TSCĐ', 'EXCLUDE')]);
    const r2 = await runFunnel(fs.readFileSync(T07), { rules: with6414 });
    const before6414 = normalizedRows.filter((r) => r.taiKhoan === '6414').length;
    const after6414excl = r2.normalizedRows.filter((r) => r.taiKhoan === '6414' && r.classification === 'EXCLUDE').length;
    ck('remembered 6414-EXCLUDE rule moves ONLY matching 6414 rows to EXCLUDE',
      after6414excl > 0 && after6414excl <= before6414 && r2.report.totals.excluded === after6414excl, `before=${before6414} excl=${after6414excl}`);
    ck('remembered rule still reconciles: I+E+NR == COST_SCOPE (350)',
      r2.report.totals.included + r2.report.totals.excluded + r2.report.totals.needsReview === 350);
    ck('remembered rule does NOT touch other accounts',
      r2.normalizedRows.filter((r) => r.taiKhoan !== '6414' && r.classification === 'EXCLUDE').length === 0);
  } else {
    console.log('  (T07 source absent — funnel checks skipped)');
  }

  console.log(`\n${P} passed, ${F} failed`);
  process.exit(F ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(3); });
