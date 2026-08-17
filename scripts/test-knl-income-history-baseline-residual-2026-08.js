'use strict';
/*
 * Residual fix regression — 2 khối lịch sử trên màn cá nhân (incomeHtml()):
 *
 * Residual 1: compensation history — Batch 1B FINAL REWORK đổi hẳn sang model
 * "cơ cấu mới đang áp dụng" (không còn before/after diff), nên residual gốc
 * ("Chưa áp dụng -> 910.000" lặp mỗi kỳ dù không đổi) tự nhiên biến mất: mỗi
 * kỳ chỉ liệt kê current snapshot của chính nó (buildCompensationCurrentEntry/
 * compensationSnapshotComponents), không đọc before_data nữa. Test C-series ở
 * đây xác nhận đúng invariant đó theo model MỚI.
 *
 * Residual 2: KNL grade history — record đầu tiên do actor batch/seed/baseline
 * tạo KHÔNG được trình bày như "Bắt đầu áp dụng: — → B1" (competencyHistoryLabel/
 * competencyHistoryHtml + isSystemBaselineActor) — KHÔNG bị ảnh hưởng bởi rework
 * phần 6, giữ nguyên K-series.
 *
 * Cùng kỹ thuật JSDOM route-render với test-knl-income-semantic-history-2026-08.js
 * (file bọc IIFE, không export global — phải render route thật qua window.eval).
 * Fixture dựng tay, KHÔNG ghi Production, KHÔNG hard-code theo tên nhân sự thật.
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

async function renderIncomePage(income, competencyHistory) {
  const dom = new JSDOM('<!doctype html><html><head><style>' + css + '</style></head><body><div id="phfKnlRoot"></div></body></html>', { url: 'http://localhost/hv/knl/co-cau-thu-nhap?employee_code=PHF_TEST', runScripts: 'outside-only' });
  const { window } = dom;
  window.phfGetSessionRole = () => 'learner';
  window.phfGetCurrentUser = () => ({ id: 'phf-test', employeeCode: 'PHF_TEST', name: 'Nhân sự Test' });
  window.phfNavigate = () => {};
  window.scrollTo = () => {};
  window.requestAnimationFrame = fn => setTimeout(fn, 0);
  window.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.action === 'getKnlCapabilities') return response({ ok: true, isAdmin: false, capabilities: { access_knl: true }, peopleScope: { type: 'self', values: [] } });
    if (body.action === 'getKnlEmployeeIncome') return response(Object.assign({ ok: true }, JSON.parse(JSON.stringify(income))));
    if (body.action === 'getKnlEmployeeNextCompensationGrade') return response({ ok: true, hasCurrentGrade: false });
    if (body.action === 'getKnlEmployeeCompetencyStandard') return { ok: false, json: async () => ({ ok: false, error: 'not mocked' }) };
    if (body.action === 'listKnlEmployeeCompetencyHistory') return competencyHistory ? response(Object.assign({ ok: true }, JSON.parse(JSON.stringify(competencyHistory)))) : { ok: false, json: async () => ({ ok: false, error: 'not mocked' }) };
    if (body.action === 'getKnlEmployeeProfile') return { ok: false, json: async () => ({ ok: false, error: 'not mocked' }) };
    return { ok: false, json: async () => ({ ok: false, error: 'Unexpected action ' + body.action }) };
  };
  window.eval(code);
  await window.phfRenderKnl('/hv/knl/co-cau-thu-nhap');
  await tick();
  return { window, root: window.document.getElementById('phfKnlRoot') };
}

const CURRENT = {
  employeeCode: 'PHF_TEST', employeeName: 'Nhân sự Test', payrollPeriod: '2026-09', employmentType: 'OFFICIAL',
  ladderCode: 'SALE', ladderName: 'Ngạch Bán hàng', gradeCode: 'SALE-B3', gradeNumber: 3, versionNumber: 2,
  baseSalary: 6000000, hqcv: 1560500,
  isProfessionalAllowance: false, professionalAllowance: 0, standardProfessionalAllowance: 624250,
  isManagementAllowance: false, managementAllowance: 0, standardManagementAllowance: 500000,
  isMealAllowance: true, mealAllowance: 910000, extraAllowances: [],
  totalReferenceIncome: 8470500, organizationSnapshot: { department: 'Kinh doanh', title: 'Nhân viên' }, updatedAt: '2026-08-20T09:00:00+07:00'
};

function itemFor(panel, periodLabel) {
  return [...panel.querySelectorAll('.phfk-comp-history-item')].find(el => {
    var head = el.querySelector('.phfk-comp-history-head');
    return head && head.textContent.indexOf(periodLabel) === 0;
  });
}

(async () => {
  // ================= RESIDUAL 1 — Compensation baseline (Test C1-C5, model MỚI) =================

  // Test C1: 07/2026 -> 08/2026 -> 09/2026, meal luôn 910k, mỗi kỳ là 1 row CREATE riêng
  // (đúng workflow thật: 1 row/kỳ, unique(employee_code,payroll_period)). Model mới KHÔNG
  // diff nữa — mỗi kỳ chỉ liệt kê current snapshot của chính nó.
  const row07 = withTotal(officialRow({ payroll_period: '2026-07' }));
  const h07 = historyEntry('h07', '2026-07', 'CREATE', {}, row07, '', 'Trần Văn Admin', '2026-06-25T09:00:00+07:00');
  const row08 = withTotal(officialRow({ payroll_period: '2026-08' }));
  const h08 = historyEntry('h08', '2026-08', 'CREATE', {}, row08, '', 'Trần Văn Admin', '2026-07-25T09:00:00+07:00');
  const row09 = withTotal(officialRow({ payroll_period: '2026-09' }));
  const h09 = historyEntry('h09', '2026-09', 'CREATE', {}, row09, '', 'Trần Văn Admin', '2026-08-25T09:00:00+07:00');

  const incomeC1 = { employeeCode: 'PHF_TEST', current: CURRENT, history: [h09, h08, h07] }; // changed_at desc, đúng thứ tự backend trả
  const { root: rootC1 } = await renderIncomePage(incomeC1);
  const headingC1 = [...rootC1.querySelectorAll('h2')].find(h => h.textContent.includes('Lịch sử thay đổi cơ cấu thu nhập'));
  const panelC1 = headingC1.closest('section');
  const items07to09 = [...panelC1.querySelectorAll('.phfk-comp-history-item')];
  assert.strictEqual(items07to09.length, 3, 'Test C1: all 3 monthly rollover entries must still render as timeline cards');
  const item07 = itemFor(panelC1, '07/2026');
  const item08 = itemFor(panelC1, '08/2026');
  const item09 = itemFor(panelC1, '09/2026');
  assert(item07 && item08 && item09, 'Test C1: 07/08/09 2026 entries must all be found');
  assert(item07.textContent.includes('Thiết lập cơ cấu thu nhập ban đầu'), 'Test C1: earliest period is the initial-setup entry');
  assert(item08.textContent.includes('Cơ cấu thu nhập áp dụng') && item09.textContent.includes('Cơ cấu thu nhập áp dụng'), 'Test C1: later periods use the safe generic heading');
  [item07, item08, item09].forEach(item => {
    assert(item.textContent.includes('Tiền cơm'), 'Test C1: every period must still show Tiền cơm as a plain current fact');
    assert(item.textContent.includes('910.000'), 'Test C1: Tiền cơm amount must be the real stored value in every period');
    assert(!item.textContent.includes('Chưa áp dụng'), 'Test C1: unchanged meal allowance must NEVER claim "Chưa áp dụng" in any period');
    assert(!item.textContent.includes('→'), 'Test C1: no before->after arrow anywhere');
  });
  console.log('PASS: Test C1 — repeated unchanged Tiền cơm across 3 periods never fakes a "Chưa áp dụng" claim');

  // Test C2: period where meal is genuinely not applied — must simply be absent, not shown as a diff.
  const row08b = withTotal(officialRow({ payroll_period: '2026-08', has_meal_allowance: false, meal_allowance: 0 }));
  const h08b = historyEntry('h08b', '2026-08', 'CREATE', {}, row08b, '', 'Trần Văn Admin', '2026-07-25T09:00:00+07:00');
  const incomeC2 = { employeeCode: 'PHF_TEST', current: CURRENT, history: [h08b] };
  const { root: rootC2 } = await renderIncomePage(incomeC2);
  const panelC2 = [...rootC2.querySelectorAll('h2')].find(h => h.textContent.includes('Lịch sử thay đổi cơ cấu thu nhập')).closest('section');
  const item08b = itemFor(panelC2, '08/2026');
  assert(!item08b.textContent.includes('Tiền cơm'), 'Test C2: a period with no meal allowance must not mention Tiền cơm at all');
  console.log('PASS: Test C2 — component genuinely not applied in current snapshot is simply absent');

  // Test C3: base salary differs from a prior fixture period — only the CURRENT value is shown.
  const row08c = withTotal(officialRow({ payroll_period: '2026-08', structure_snapshot: officialSnapshot({ baseSalary: 6500000 }) }));
  const h08c = historyEntry('h08c', '2026-08', 'CREATE', {}, row08c, 'Tăng lương cơ bản theo xét duyệt', 'Trần Văn Admin', '2026-07-25T09:00:00+07:00');
  const incomeC3 = { employeeCode: 'PHF_TEST', current: CURRENT, history: [h08c] };
  const { root: rootC3 } = await renderIncomePage(incomeC3);
  const panelC3 = [...rootC3.querySelectorAll('h2')].find(h => h.textContent.includes('Lịch sử thay đổi cơ cấu thu nhập')).closest('section');
  const item08c = itemFor(panelC3, '08/2026');
  assert(item08c.textContent.includes('6.500.000'), 'Test C3: current LCB value must be shown');
  assert(!item08c.textContent.includes('6.000.000'), 'Test C3: no other/prior LCB value should appear since there is no diff anymore');
  assert(!item08c.textContent.includes('→'), 'Test C3: no before->after arrow');
  console.log('PASS: Test C3 — component amount shown as current fact only, no arrow');

  // Test C4: CREATE mid-series (not the earliest period) must NOT be labeled initial setup.
  const row07d = withTotal(officialRow({ payroll_period: '2026-07' }));
  const h07d = historyEntry('h07d', '2026-07', 'CREATE', {}, row07d, '', 'Trần Văn Admin', '2026-06-25T09:00:00+07:00');
  const row08d = withTotal(officialRow({ payroll_period: '2026-08' }));
  const h08d = historyEntry('h08d', '2026-08', 'CREATE', {}, row08d, 'Tăng lương cơ bản theo xét duyệt', 'Trần Văn Admin', '2026-07-25T09:00:00+07:00');
  const incomeC4 = { employeeCode: 'PHF_TEST', current: CURRENT, history: [h08d, h07d] };
  const { root: rootC4 } = await renderIncomePage(incomeC4);
  const panelC4 = [...rootC4.querySelectorAll('h2')].find(h => h.textContent.includes('Lịch sử thay đổi cơ cấu thu nhập')).closest('section');
  const item08d = itemFor(panelC4, '08/2026');
  assert(!item08d.textContent.includes('ban đầu'), 'Test C4: a later CREATE row (not the earliest period) must never be described as initial setup');
  assert(item08d.textContent.includes('Cơ cấu thu nhập áp dụng'), 'Test C4: later CREATE rows use the generic heading');
  console.log('PASS: Test C4 — CREATE with an earlier period present is never mislabeled as initial setup');

  // Test C5: genuine first-ever CREATE (no prior period anywhere in history).
  const row07e = withTotal(officialRow({ payroll_period: '2026-07' }));
  const h07e = historyEntry('h07e', '2026-07', 'CREATE', {}, row07e, 'Gán cơ cấu thu nhập lần đầu', 'Trần Văn Admin', '2026-06-25T09:00:00+07:00');
  const incomeC5 = { employeeCode: 'PHF_TEST', current: CURRENT, history: [h07e] };
  const { root: rootC5 } = await renderIncomePage(incomeC5);
  const panelC5 = [...rootC5.querySelectorAll('h2')].find(h => h.textContent.includes('Lịch sử thay đổi cơ cấu thu nhập')).closest('section');
  const item07e = panelC5.querySelector('.phfk-comp-history-item');
  assert(item07e.textContent.includes('Thiết lập cơ cấu thu nhập ban đầu'), 'Test C5: genuine first-ever CREATE may be labeled as initial setup');
  console.log('PASS: Test C5 — genuine first-ever CREATE (no prior period) still allowed to say "thiết lập ban đầu"');

  // RESIDUAL 2 (KNL grade baseline/seed presentation) is now covered by the
  // full authoritative-event suite in scripts/test-knl-competency-history-authoritative-2026-08.js
  // (Batch 1C — periods now carry authoritative action/beforeGradeSnapshot
  // from knl_employee_competency_assignment_history, superseding the old
  // neighbor-snapshot-diff fixtures that used to live here).

  console.log('ALL PASS — Income history residual fix (compensation, current-snapshot model)');
})().catch(err => { console.error(err); process.exit(1); });
