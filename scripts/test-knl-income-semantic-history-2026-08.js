'use strict';
/*
 * Batch 1B FINAL REWORK — "Lịch sử thay đổi cơ cấu thu nhập" (màn cá nhân,
 * incomeHtml() mục 6, assets/js/knl/phf-knl-app.js) trình bày CƠ CẤU MỚI ĐANG
 * ÁP DỤNG theo từng kỳ, KHÔNG còn audit diff before→after (user đã chốt lại
 * nghiệp vụ — không show giá trị cũ/khoản đã mất/% thay đổi). Regression DOM
 * thật qua JSDOM (cùng kỹ thuật scripts/test-knl-dashboard-ui-polish-2026-08.js):
 * eval nguyên file app.js (bọc IIFE, không export global), mock fetch/apiPost,
 * render route thật, assert trên text/DOM đã render.
 *
 * Fixture dựng tay tương đương testcase T1-T10 của rework spec — KHÔNG ghi
 * Production, KHÔNG hard-code logic theo tên nhân sự thật.
 */
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync('assets/js/knl/phf-knl-app.js', 'utf8');
const css = fs.readFileSync('assets/css/phf-knl.css', 'utf8');

function response(data) { return { ok: true, json: async () => data }; }
function tick() { return new Promise(resolve => setTimeout(resolve, 25)); }

function officialSnapshot(overrides) {
  return Object.assign({
    employmentType: 'OFFICIAL', ladderId: 'ladder-1', ladderCode: 'SALE', ladderName: 'Ngạch Bán hàng',
    versionId: 'v1', versionNumber: 2, effectivePeriod: '2026-01', gradeId: 'grade-1', gradeCode: 'SALE-B3', gradeNumber: 3,
    baseSalary: 6000000, hqcv: 1560500, professionalAllowance: 624250, managementAllowance: 500000
  }, overrides || {});
}
function officialRow(overrides) {
  return Object.assign({
    employee_code: 'PHF_TEST', employee_name: 'Nhân sự Test', employment_type: 'OFFICIAL', payroll_period: '2026-08',
    compensation_grade_id: 'grade-1', has_professional_allowance: false, has_management_allowance: false,
    has_meal_allowance: true, meal_allowance: 910000, probation_amount: 0, extra_allowances: [],
    structure_snapshot: officialSnapshot(), reference_total: 0, reason: null
  }, overrides || {});
}
function withTotal(row) {
  const s = row.structure_snapshot || {};
  const prof = row.has_professional_allowance ? Number(s.professionalAllowance || 0) : 0;
  const mgmt = row.has_management_allowance ? Number(s.managementAllowance || 0) : 0;
  const meal = row.has_meal_allowance ? Number(row.meal_allowance || 0) : 0;
  const extra = (row.extra_allowances || []).reduce((sum, x) => sum + Number(x.amount || 0), 0);
  row.reference_total = Number(s.baseSalary || 0) + Number(s.hqcv || 0) + prof + mgmt + meal + extra;
  return row;
}
function historyEntry(id, payrollPeriod, action, beforeData, afterData, reason, changedByName, changedAt) {
  return { id, payrollPeriod, action, beforeData, afterData, reason: reason || '', changedByName: changedByName || '', changedAt: changedAt || '2026-08-20T10:00:00+07:00' };
}

const CURRENT = {
  employeeCode: 'PHF_TEST', employeeName: 'Nhân sự Test', payrollPeriod: '2026-09', employmentType: 'OFFICIAL',
  ladderCode: 'SALE', ladderName: 'Ngạch Bán hàng', gradeCode: 'SALE-B3', gradeNumber: 3, versionNumber: 2,
  baseSalary: 6270000, hqcv: 1568000,
  isProfessionalAllowance: false, professionalAllowance: 0, standardProfessionalAllowance: 624250,
  isManagementAllowance: true, managementAllowance: 627000, standardManagementAllowance: 627000,
  isMealAllowance: true, mealAllowance: 910000, extraAllowances: [],
  totalReferenceIncome: 9375000, organizationSnapshot: { department: 'Kinh doanh', title: 'Nhân viên' }, updatedAt: '2026-08-20T09:00:00+07:00'
};

async function renderIncomePage(income, fetchOverrides) {
  const dom = new JSDOM('<!doctype html><html><head><style>' + css + '</style></head><body><div id="phfKnlRoot"></div></body></html>', { url: 'http://localhost/hv/knl/co-cau-thu-nhap?employee_code=PHF_TEST', runScripts: 'outside-only' });
  const { window } = dom;
  window.phfGetSessionRole = () => 'learner';
  window.phfGetCurrentUser = () => ({ id: 'phf-test', employeeCode: 'PHF_TEST', name: 'Nhân sự Test' });
  window.phfNavigate = () => {};
  window.scrollTo = () => {};
  window.requestAnimationFrame = fn => setTimeout(fn, 0);
  window.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (fetchOverrides && fetchOverrides[body.action]) return fetchOverrides[body.action](body);
    if (body.action === 'getKnlCapabilities') return response({ ok: true, isAdmin: false, capabilities: { access_knl: true }, peopleScope: { type: 'self', values: [] } });
    if (body.action === 'getKnlEmployeeIncome') return response(Object.assign({ ok: true }, JSON.parse(JSON.stringify(income))));
    if (body.action === 'getKnlEmployeeNextCompensationGrade') return response({ ok: true, hasCurrentGrade: false });
    if (body.action === 'getKnlEmployeeCompetencyStandard') return { ok: false, json: async () => ({ ok: false, error: 'not mocked' }) };
    if (body.action === 'listKnlEmployeeCompetencyHistory') return { ok: false, json: async () => ({ ok: false, error: 'not mocked' }) };
    if (body.action === 'getKnlEmployeeProfile') return { ok: false, json: async () => ({ ok: false, error: 'not mocked' }) };
    return { ok: false, json: async () => ({ ok: false, error: 'Unexpected action ' + body.action }) };
  };
  window.eval(code);
  await window.phfRenderKnl('/hv/knl/co-cau-thu-nhap');
  await tick();
  return { window, root: window.document.getElementById('phfKnlRoot') };
}
function historyPanel(root) {
  const heading = [...root.querySelectorAll('h2')].find(h => h.textContent.includes('Lịch sử thay đổi cơ cấu thu nhập'));
  assert(heading, 'History section heading must be present');
  return heading.closest('section');
}
function itemFor(panel, periodLabel) {
  return [...panel.querySelectorAll('.phfk-comp-history-item')].find(el => {
    var head = el.querySelector('.phfk-comp-history-head');
    return head && head.textContent.indexOf(periodLabel) === 0;
  });
}

// 3 kỳ liên tiếp đúng theo QA target (mục 15 rework spec):
// 07/2026 first-ever, 08/2026 có PC nghiệp vụ (không có PC quản lý), 09/2026 đổi sang PC quản lý (không còn PC nghiệp vụ).
const row07 = withTotal(officialRow({
  payroll_period: '2026-07', has_professional_allowance: false, has_management_allowance: false,
  structure_snapshot: officialSnapshot({ baseSalary: 5500000, hqcv: 1375000 })
}));
const h07 = historyEntry('h07', '2026-07', 'CREATE', {}, row07, 'Gán cơ cấu thu nhập lần đầu', 'Trần Văn Admin', '2026-06-25T09:00:00+07:00');

const row08 = withTotal(officialRow({
  payroll_period: '2026-08', has_professional_allowance: true, has_management_allowance: false,
  structure_snapshot: officialSnapshot({ baseSalary: 6242500, hqcv: 1560500 })
}));
const h08 = historyEntry('h08', '2026-08', 'CREATE', row07, row08, 'Bổ sung phụ cấp nghiệp vụ', 'Trần Văn Admin', '2026-07-25T09:00:00+07:00');

const row09 = withTotal(officialRow({
  payroll_period: '2026-09', has_professional_allowance: false, has_management_allowance: true,
  structure_snapshot: officialSnapshot({ baseSalary: 6270000, hqcv: 1568000, managementAllowance: 627000 })
}));
const h09 = historyEntry('h09', '2026-09', 'CREATE', row08, row09, 'Điều chỉnh cơ cấu theo bậc mới', 'Trần Văn Admin', '2026-08-25T09:00:00+07:00');

const income = { employeeCode: 'PHF_TEST', current: CURRENT, history: [h09, h08, h07] }; // changed_at desc, đúng thứ tự backend

(async () => {
  const { root } = await renderIncomePage(income);
  const panel = historyPanel(root);
  const panelText = panel.textContent;
  const items = panel.querySelectorAll('.phfk-comp-history-item');
  assert.strictEqual(items.length, 3, 'All 3 fixture periods must render as timeline cards');

  const item07 = itemFor(panel, '07/2026');
  const item08 = itemFor(panel, '08/2026');
  const item09 = itemFor(panel, '09/2026');
  assert(item07 && item08 && item09, 'All 3 period entries must be found');

  // ---- T1: 07 first-ever ----
  assert(item07.textContent.includes('Thiết lập cơ cấu thu nhập ban đầu'), 'T1: earliest period must be labeled as initial setup');
  assert(item07.textContent.includes('5.500.000'), 'T1: must show current LCB value');
  assert(item07.textContent.includes('1.375.000'), 'T1: must show current HQCV value');
  assert(item07.textContent.includes('910.000'), 'T1: must show current Tiền cơm value');
  assert(!item07.textContent.includes('→'), 'T1: no before->after arrow anywhere in the entry');
  console.log('PASS: T1 — 07/2026 first-ever entry shows only the current snapshot, no arrow diff');

  // ---- T2: 08 same meal (910k both periods) must not read "Chưa áp dụng -> 910.000" ----
  assert(item08.textContent.includes('Tiền cơm'), 'T2: Tiền cơm must be listed as a current component');
  assert(item08.textContent.includes('910.000'), 'T2: Tiền cơm amount must be shown');
  assert(!item08.textContent.includes('Chưa áp dụng'), 'T2: unchanged meal allowance must never claim "Chưa áp dụng"');
  console.log('PASS: T2 — repeated unchanged Tiền cơm never fakes a "Chưa áp dụng" claim');

  // ---- T3: 09 has no PC nghiệp vụ (removed relative to 08) -> must not appear at all, no removal arrow ----
  assert(!item09.textContent.includes('Phụ cấp nghiệp vụ'), 'T3: component absent from current snapshot must not be rendered at all');
  assert(!item09.textContent.includes('624.250'), 'T3: old amount from a prior period must not leak into a later entry');
  assert(!item09.textContent.includes('Không áp dụng'), 'T3: no "X -> Không áp dụng" removal wording anywhere');
  console.log('PASS: T3 — component removed from current snapshot is simply absent, not shown as a removal arrow');

  // ---- T4: new management allowance in 09 shown as a plain current fact, not an addition arrow ----
  assert(item09.textContent.includes('Phụ cấp quản lý/trách nhiệm'), 'T4: new current component must be listed');
  assert(item09.textContent.includes('627.000'), 'T4: new component amount must be shown');
  assert(!item09.textContent.includes('Chưa áp dụng'), 'T4: must not render as an addition arrow');
  console.log('PASS: T4 — new current component rendered as plain fact, not an addition arrow');

  // ---- T5: LCB/HQCV show current values only ----
  assert(item09.textContent.includes('6.270.000'), 'T5: current LCB value must be shown');
  assert(item09.textContent.includes('1.568.000'), 'T5: current HQCV value must be shown');
  assert(!item09.textContent.includes('6.242.500'), 'T5: prior period LCB value must not leak into this entry');
  console.log('PASS: T5 — LCB/HQCV show current-period values only');

  // ---- T6: total shows current reference_total only, no delta % ----
  assert(item09.textContent.includes('9.375.000'), 'T6: current total must be shown');
  assert(!/%/.test(item09.textContent), 'T6: no % delta anywhere in the entry');
  assert(!item08.textContent.includes('9.337.250 →') , 'T6: total must not be rendered as a before value in an arrow');
  console.log('PASS: T6 — total shows current reference_total only, no % delta');

  // ---- T7: no "Đổi ngạch" heading despite structure_snapshot differing across periods ----
  assert(!panelText.includes('Đổi ngạch') && !panelText.includes('Nâng bậc') && !panelText.includes('Giảm bậc'), 'T7: no grade-change heading may be inferred from compensation snapshot alone');
  assert(item08.textContent.includes('Cơ cấu thu nhập áp dụng'), 'T7: later entries use the safe generic heading');
  console.log('PASS: T7 — no grade-change heading inferred from compensation snapshot');

  // ---- T9: permission unchanged — denial path untouched ----
  const denied = await renderIncomePage(income, {
    getKnlEmployeeIncome: async () => ({ ok: false, json: async () => ({ ok: false, error: 'Không có quyền xem thu nhập của nhân sự này.', code: 'KNL_INCOME_VIEW_DENIED' }) })
  });
  assert(denied.root.textContent.includes('Không có quyền xem thu nhập'), 'T9: denied income view must still show the existing permission error');
  assert(!denied.root.textContent.includes('Lịch sử thay đổi cơ cấu thu nhập'), 'T9: denied session must never reach the history section');
  console.log('PASS: T9 — permission path unchanged');

  // ---- T10: no technical leak ----
  assert(!panelText.includes('structure_snapshot'), 'T10: raw structure_snapshot key must not leak');
  assert(!panelText.includes('gradeId') && !panelText.includes('versionId') && !panelText.includes('compensation_grade_id'), 'T10: raw technical ids must not leak');
  assert(!panelText.includes('SALE-B3') && !panelText.includes('"SALE"'), 'T10: raw grade/ladder code must not be primary content');
  assert(!panelText.includes('{"'), 'T10: no raw JSON payload leak');
  console.log('PASS: T10 — no technical leak in primary history content');

  // ---- Reason/actor/effective period still shown (mục 8 rework spec) ----
  assert(item08.textContent.includes('Áp dụng từ kỳ 08/2026'), 'Effective period text must be shown per entry');
  assert(item08.textContent.includes('Bổ sung phụ cấp nghiệp vụ'), 'Real reason must still be shown when present');
  assert(item08.textContent.includes('Trần Văn Admin'), 'Real actor must still be shown when present');
  console.log('PASS: reason/actor/effective-period still rendered from real source data');

  console.log('ALL PASS — KNL Income Current-Snapshot History (Batch 1B Final Rework)');
})().catch(err => { console.error(err); process.exit(1); });
