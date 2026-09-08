'use strict';
/*
 * PHF HR — QTTH · Payroll COST panel · UI render check (offline, no DB/network).
 * Loads phf-qtth-payroll.js in a minimal sandbox and renders the cost-truth
 * panel + drawer breakdown from a live cost object taken straight from the
 * shipped cost-model over the real T7 corpus. Asserts: no [object Object],
 * escaping intact, "Chưa có dữ liệu nguồn" for employer BHXH, reconciliation
 * state visible, numbers formatted.
 * Run: node scripts/qtth-payroll-cost-ui-render-check-dev.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const REPO = path.resolve(__dirname, '..');

const TPL = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-template'));
const NRM = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-normalize'));
const COST = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-cost-model'));

// --- build a realistic cost object from real T7 ---
function readTsv(f) { let s = fs.readFileSync(f, 'utf8'); if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); return s.split(/\r?\n/).map((l) => l.split('\t')); }
const T7 = readTsv(path.join(REPO, 'docs/payroll-corpus/T7_CANONICAL.tsv'));
const b = TPL.buildColumnMap(T7);
const nr = NRM.normalizeGrid(T7, b.map, {});
const agg = COST.aggregatePeriodCost(nr.records);
let g4 = 0, t13in4 = 0, t13rev = 0;
for (const r of nr.records) { const m = Object.assign({}, r.fields, r.sourceDetail); g4 += m.grand_total_4 || 0; t13in4 += m.bonus_thuong_le_1_1 || 0; t13rev += m.t13_revenue_bonus || 0; }
const cost = {
  periodMonth: '2026-07', exists: true, hasCost: true, version: 1, status: 'confirmed', isCurrent: true,
  rowCount: nr.rowCount, costModelVersion: COST.MODEL_VERSION,
  payrollCost: agg.totalPersonnelCost,
  salaryCost: agg.byGroup.SALARY_COST || 0, holidayCost: agg.byGroup.HOLIDAY_COST || 0,
  allowanceCost: agg.byGroup.ALLOWANCE || 0, otherAllowanceCost: agg.byGroup.OTHER_ALLOWANCE || 0,
  performanceRewardCost: agg.byGroup.PERFORMANCE_REWARD || 0,
  employerBhxhCost: null, employerBhxhStatus: 'NOT_AVAILABLE',
  excludedCost: { thuongLe11: t13in4, t13RevenueBonus: t13rev, total: agg.excludedT13 },
  reconciliationOnly: { employeeDeductions: agg.employeeDeductions, employeeTax: agg.employeeTax, paymentLayer: agg.paymentLayer },
  sourceReconciliation: { grandTotal4: g4, thuongLe11InGrand4: t13in4, expectedCost: g4 - t13in4 },
  costReconciliationDelta: Math.round((agg.totalPersonnelCost - (g4 - t13in4)) * 100) / 100,
  reconciled: true, tolerance: 22,
};
const breakdown = COST.computePersonnelCost(nr.records[0]);

// --- sandbox-load the payroll app ---
const src = fs.readFileSync(path.join(REPO, 'assets/js/qtth/phf-qtth-payroll.js'), 'utf8');
const window = { __qtthShared: { esc: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) } };
const document = { addEventListener() {} };
new Function('window', 'document', src)(window, document);
const H = window.__qtthPayrollTestHooks;

let P = 0, F = 0;
const ck = (n, c, x) => { c ? (P++, console.log('  PASS  ' + n)) : (F++, console.error('  FAIL  ' + n + (x ? '  -> ' + x : ''))); };

ck('test hooks exposed', H && typeof H.costTruthHtml === 'function' && typeof H.costBreakdownHtml === 'function');

const html = H.costTruthHtml(cost);
ck('panel renders (non-empty)', html && html.length > 200);
ck('no [object Object] leak', html.indexOf('[object Object]') < 0, html.slice(0, 200));
ck('no unresolved conflict / undefined', html.indexOf('undefined') < 0 && html.indexOf('NaN') < 0);
ck('title present', html.indexOf('Chi phí lương theo bảng lương') >= 0);
ck('employer BHXH shows "Chưa có dữ liệu nguồn"', html.indexOf('Chưa có dữ liệu nguồn') >= 0);
ck('reconciliation state visible (Đã đối chiếu)', html.indexOf('Đã đối chiếu') >= 0);
ck('5 cost groups shown', ['Lương theo công', 'Chi phí Lễ/Tết', 'Phụ cấp', 'Phụ cấp khác', 'Thưởng hiệu quả'].every((g) => html.indexOf(g) >= 0));
ck('excluded T13 row present', html.indexOf('Thưởng lễ 1.1 (Tháng 13)') >= 0 && html.indexOf('Thưởng T13 / doanh thu') >= 0);
ck('deductions / payment layer shown as NOT-cost', html.indexOf('Giảm trừ của người lao động') >= 0 && html.indexOf('Lớp thanh toán') >= 0);
ck('source reconciliation block present', html.indexOf('Đối chiếu nguồn') >= 0 && html.indexOf('Chi phí kỳ vọng') >= 0);
ck('big number formatted with grouping', /\d{1,3}(\.\d{3})+/.test(html), 'no grouped number found');
ck('model version surfaced', html.indexOf(COST.MODEL_VERSION) >= 0);

// not reconciled variant
const bad = Object.assign({}, cost, { reconciled: false, costReconciliationDelta: 12345 });
const badHtml = H.costTruthHtml(bad);
ck('non-reconciled shows "cần rà soát"', badHtml.indexOf('cần rà soát') >= 0);

// error + empty variants
ck('error variant renders warn', H.costTruthHtml({ _error: 'boom <x>' }).indexOf('boom &lt;x&gt;') >= 0);
ck('no-cost variant renders empty-state', H.costTruthHtml({ hasCost: false }).indexOf('chưa có phiên bản hiệu lực'.slice(0, 6)) >= 0 || H.costTruthHtml({ hasCost: false }).indexOf('chưa có phiên bản') >= 0);
ck('null cost -> empty string (no panel)', H.costTruthHtml(null) === '');

// drawer breakdown
const dh = H.costBreakdownHtml(breakdown);
ck('drawer breakdown renders', dh.indexOf('Phân nhóm chi phí') >= 0 && dh.indexOf('[object Object]') < 0);
ck('drawer breakdown has total row', dh.indexOf('Chi phí lương theo bảng lương') >= 0);
ck('drawer breakdown null -> empty', H.costBreakdownHtml(null) === '');

// --- template download card + schema-state label (§1, §5, §7) ---
const tc = H.templateCardHtml();
ck('template card renders "Mẫu bảng lương chuẩn"', tc.indexOf('Mẫu bảng lương chuẩn') >= 0);
ck('template card has download link to canonical .xlsx', /href="assets\/templates\/PHF_Payroll_Canonical_V1\.xlsx/.test(tc) && tc.indexOf('download="PHF_Payroll_Canonical_V1.xlsx"') >= 0);
ck('template card shows "PHF Payroll Canonical V1"', tc.indexOf('PHF Payroll Canonical V1') >= 0);
ck('template card button text "Tải mẫu Excel chuẩn"', tc.indexOf('Tải mẫu Excel chuẩn') >= 0);
ck('template card no [object Object]', tc.indexOf('[object Object]') < 0);
ck('schemaStateLabel: exact -> "Đúng mẫu chuẩn V1"', H.schemaStateLabel({ templateMatched: true }) === 'Đúng mẫu chuẩn V1');
ck('schemaStateLabel: drift -> "Khác mẫu chuẩn — cần rà mapping"', H.schemaStateLabel({ templateMatched: false, schemaDrift: { added: ['x'] } }) === 'Khác mẫu chuẩn — cần rà mapping');
ck('schemaStateLabel: compatible -> "Tương thích mẫu V1"', H.schemaStateLabel({ templateMatched: false }) === 'Tương thích mẫu V1');

console.log('\n' + P + '/' + (P + F) + ' render-check assertions passed' + (F ? '  — ' + F + ' FAILED' : '  — ALL PASS'));
process.exit(F ? 1 : 0);
