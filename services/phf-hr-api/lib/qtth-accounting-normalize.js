'use strict';

// PHF HR — QTTH Truth Data · Accounting · funnel + normalize + preview report.
//
// Streams a FAST export through the debit filter -> broad cost scope ->
// classification engine, keeping ONLY the cost-scope rows (~350 / period) as
// normalized records. The ~86k source rows are counted, never retained
// (RAW_ROWS_SAVED_AS_FACT = 0). Produces the §16 preview aggregate.

const { readFastExport } = require('./qtth-accounting-fast-xlsx');
const { inCostScope, buildClassifier, isOutOfMasterDepartment } = require('./qtth-accounting-classify');

function round0(x) { return Math.round(Number(x) || 0); }

// runFunnel(buffer, { rules }) -> {
//   meta, totals, normalizedRows[], report
// }
async function runFunnel(buffer, opts) {
  const options = opts || {};
  const clf = buildClassifier(options.rules);

  const t = {
    sourceRows: 0, debitRows: 0, creditRows: 0,
    costScopeRows: 0, included: 0, excluded: 0, needsReview: 0,
  };
  const amt = { included: 0, needsReview: 0, excluded: 0, costScope: 0 };
  const accounts = new Map();       // acct -> { rows, amount, byClass:{} }
  const departments = new Map();    // dept -> rows
  const outOfMaster = new Map();     // dept -> rows
  const warnings = new Map();        // reason -> count
  const reviewAccounts = new Map();  // acct -> { rows, amount, note }
  const excludedReasons = new Map(); // ruleId -> { rows, amount }
  const normalizedRows = [];

  function warn(reason) { warnings.set(reason, (warnings.get(reason) || 0) + 1); }

  const meta = await readFastExport(buffer, (row) => {
    if (row.phatSinhNo > 0) t.debitRows++;
    if (row.phatSinhCo > 0) t.creditRows++;

    if (!inCostScope(row)) return; // out of V1 scope

    t.costScopeRows++;
    amt.costScope += row.phatSinhNo;
    const acct = row.taiKhoan;
    if (!accounts.has(acct)) accounts.set(acct, { account: acct, rows: 0, amount: 0, byClass: { INCLUDE: 0, EXCLUDE: 0, NEEDS_REVIEW: 0 } });
    const arec = accounts.get(acct);
    arec.rows++; arec.amount += row.phatSinhNo;

    const dept = row.maBp || '(trống)';
    departments.set(dept, (departments.get(dept) || 0) + 1);
    const oom = isOutOfMasterDepartment(row.maBp);
    if (oom) {
      outOfMaster.set(row.maBp, (outOfMaster.get(row.maBp) || 0) + 1);
      warn('Mã bp ngoài danh mục: ' + row.maBp);
    }

    const verdict = clf.classify(row);
    arec.byClass[verdict.classification] = (arec.byClass[verdict.classification] || 0) + 1;

    if (verdict.classification === 'INCLUDE') { t.included++; amt.included += row.phatSinhNo; }
    else if (verdict.classification === 'EXCLUDE') {
      t.excluded++; amt.excluded += row.phatSinhNo;
      const k = verdict.ruleId || 'unknown';
      if (!excludedReasons.has(k)) excludedReasons.set(k, { ruleId: k, note: verdict.ruleNote, rows: 0, amount: 0 });
      const er = excludedReasons.get(k); er.rows++; er.amount += row.phatSinhNo;
      warn('EXCLUDE: ' + (verdict.ruleNote || verdict.ruleId));
    } else {
      t.needsReview++; amt.needsReview += row.phatSinhNo;
      if (!reviewAccounts.has(acct)) reviewAccounts.set(acct, { account: acct, rows: 0, amount: 0, note: verdict.ruleNote });
      const rr = reviewAccounts.get(acct); rr.rows++; rr.amount += row.phatSinhNo;
      warn('NEEDS_REVIEW: tài khoản ' + acct);
    }

    normalizedRows.push({
      sourceRowIndex: row.rowIndex,
      ngayCt: row.ngayCt, maCt: row.maCt, soCt: row.soCt,
      maKhach: row.maKhach, tenKhach: row.tenKhach, dienGiai: row.dienGiai,
      taiKhoan: acct, tkDoiUng: row.tkDoiUng, phatSinhNo: row.phatSinhNo,
      maBp: row.maBp, maBpOutOfMaster: oom,
      classification: verdict.classification,
      classifiedByRuleId: verdict.ruleId,
      warnings: oom ? ['MA_BP_OUT_OF_MASTER'] : [],
    });
  });

  t.sourceRows = meta.sourceRowCount;

  const topAccounts = [...accounts.values()]
    .sort((a, b) => b.amount - a.amount)
    .map((a) => ({ account: a.account, rows: a.rows, amount: round0(a.amount), byClass: a.byClass }));

  const report = {
    meta: {
      sheetName: meta.sheetName, headerRowIndex: meta.headerRowIndex,
      fromDate: meta.fromDate, toDate: meta.toDate,
      ruleVersion: clf.ruleVersion, ruleCount: clf.rules.length,
    },
    totals: {
      sourceRows: t.sourceRows,
      debitRows: t.debitRows,
      creditRows: t.creditRows,
      costScopeRows: t.costScopeRows,
      included: t.included,
      excluded: t.excluded,
      needsReview: t.needsReview,
      uniqueCostAccounts: accounts.size,
      uniqueDepartments: departments.size,
      outOfMasterDepartments: [...outOfMaster.keys()],
    },
    amounts: {
      costScope: round0(amt.costScope),
      included: round0(amt.included),
      needsReview: round0(amt.needsReview),
      excluded: round0(amt.excluded),
    },
    topAccounts,
    departmentBreakdown: [...departments.entries()].map(([dept, rows]) => ({ dept, rows, outOfMaster: isOutOfMasterDepartment(dept) })).sort((a, b) => b.rows - a.rows),
    needsReviewAccounts: [...reviewAccounts.values()].map((r) => ({ account: r.account, rows: r.rows, amount: round0(r.amount), note: r.note })).sort((a, b) => b.amount - a.amount),
    excludedReasons: [...excludedReasons.values()].map((r) => ({ ruleId: r.ruleId, note: r.note, rows: r.rows, amount: round0(r.amount) })),
    warnings: [...warnings.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    rawRowsSavedAsFact: 0,
  };

  return { meta, totals: t, amounts: amt, normalizedRows, report };
}

module.exports = { runFunnel, round0 };
