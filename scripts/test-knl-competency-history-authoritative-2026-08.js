'use strict';
/*
 * Batch 1C — "Lịch sử thay đổi bậc KNL" (Section 5, incomeHtml() ->
 * competencyHistoryHtml() trong assets/js/knl/phf-knl-app.js) dùng
 * AUTHORITATIVE event source: knl_employee_competency_assignment_history,
 * ghi bởi RPC duy nhất knl_set_employee_competency_assignment() (server tự
 * suy action CREATE/CONFIRM/SUPERSEDE/RETROACTIVE_CHANGE — xem
 * scripts/PHF_KNL_EMPLOYEE_COMPETENCY_ASSIGNMENT_1.52.0.sql:139-258).
 * lib/knl-competency.js:listKnlEmployeeCompetencyHistory() giờ join theo
 * assignment_id để lấy action + before_data.grade_snapshot THẬT, KHÔNG còn
 * suy nâng/giảm bậc bằng cách so 2 phần tử liền kề trong mảng periods.
 *
 * 2 lớp test:
 *  - Backend: mock Supabase in-memory, gọi thẳng listKnlEmployeeCompetencyHistory
 *    để xác nhận query/mapping/permission đúng (không đổi gate).
 *  - Frontend: JSDOM route-render (file app.js bọc IIFE, không export global)
 *    để xác nhận presentation đúng theo action authoritative.
 *
 * Fixture dựng tay, KHÔNG ghi Production, KHÔNG hard-code theo tên nhân sự thật.
 */
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');

// ================= BACKEND — listKnlEmployeeCompetencyHistory =================

process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const peoplePath = require.resolve('../api/_lib/knl-people');
const permissionsPath = require.resolve('../api/_lib/knl-permissions');
const scopePath = require.resolve('../api/_lib/knl-scope');
const competencyPath = require.resolve('../api/_lib/knl-competency');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function makeTableFactory(rows) {
  return function tableQuery() {
    const filters = [];
    let orderSpecs = [], limitN = null, singleMode = null;
    const q = {
      select() { return q; },
      eq(f, v) { filters.push(r => String(r[f]) === String(v)); return q; },
      order(f, o) { orderSpecs.push({ f, asc: !(o && o.ascending === false) }); return q; },
      limit(n) { limitN = n; return q; },
      maybeSingle() { singleMode = 'maybe'; return q; },
      single() { singleMode = 'single'; return q; },
      then(resolve, reject) {
        try {
          let matched = rows.filter(r => filters.every(fn => fn(r)));
          orderSpecs.forEach(spec => { matched = matched.slice().sort((a, b) => (a[spec.f] < b[spec.f] ? -1 : a[spec.f] > b[spec.f] ? 1 : 0) * (spec.asc ? 1 : -1)); });
          if (limitN != null) matched = matched.slice(0, limitN);
          if (singleMode) { resolve({ data: clone(matched[0] || null), error: null }); return; }
          resolve({ data: clone(matched), error: null });
        } catch (e) { (reject || (err => Promise.reject(err)))(e); }
      }
    };
    return q;
  };
}
const BSTATE = { grants: [], employees: [
  { employee_id: 'e-1', employee_code: 'PHF_TEST', full_name: 'Nhân sự Test', title: 'Nhân viên', position: null, department: 'Kinh doanh', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' }
], assignments: [], events: [] };
function buildSupabaseMock() {
  return {
    createClient() {
      return {
        from(table) {
          if (table === 'knl_permission_grants') return makeTableFactory(BSTATE.grants)();
          if (table === 'employee_profiles') return makeTableFactory(BSTATE.employees)();
          if (table === 'knl_employee_competency_assignments') return makeTableFactory(BSTATE.assignments)();
          if (table === 'knl_employee_competency_assignment_history') return makeTableFactory(BSTATE.events)();
          throw new Error('Unexpected table in mock: ' + table);
        }
      };
    }
  };
}
function loadCompetencyWithMock() {
  const Module = require('module');
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === '@supabase/supabase-js') return supabasePath;
    return originalResolve.call(this, request, ...rest);
  };
  try {
    [peoplePath, permissionsPath, scopePath, competencyPath].forEach(p => delete require.cache[p]);
    require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
    return require(competencyPath);
  } finally {
    Module._resolveFilename = originalResolve;
  }
}
function session(id) { return { role: 'learner', account: { id, employeeCode: id.toUpperCase() }, employeeCode: id.toUpperCase() }; }

async function runBackend() {
  const { listKnlEmployeeCompetencyHistory } = loadCompetencyWithMock();

  const gradeSnapB1 = { frameworkCode: 'SALE', frameworkName: 'Nhân viên bán hàng', gradeCode: 'B1', gradeNumber: 1, versionNumber: 1 };
  const gradeSnapB2 = { frameworkCode: 'SALE', frameworkName: 'Nhân viên bán hàng', gradeCode: 'B2', gradeNumber: 2, versionNumber: 1 };
  const assignmentB1 = { id: 'a-1', employee_code: 'PHF_TEST', employee_name: 'Nhân sự Test', framework_version_id: 'v1', competency_grade_id: 'g1', status: 'CONFIRMED', effective_from: '2026-06-01', effective_to: '2026-08-01', is_active: false, grade_snapshot: gradeSnapB1, organization_snapshot: {}, note: '', reason: 'PHF KNL baseline 08/2026 theo danh sách đối soát ban đầu.', created_by_name: 'PHF KNL/Salary Baseline 08/2026 — batch script', updated_by_name: 'PHF KNL/Salary Baseline 08/2026 — batch script', updated_at: '2026-06-01T09:00:00+07:00' };
  const assignmentB2 = { id: 'a-2', employee_code: 'PHF_TEST', employee_name: 'Nhân sự Test', framework_version_id: 'v1', competency_grade_id: 'g2', status: 'CONFIRMED', effective_from: '2026-08-01', effective_to: null, is_active: true, grade_snapshot: gradeSnapB2, organization_snapshot: {}, note: '', reason: 'Xét duyệt nâng bậc quý 3', created_by_name: 'Nguyễn Thị HR', updated_by_name: 'Nguyễn Thị HR', updated_at: '2026-08-01T09:00:00+07:00' };
  BSTATE.assignments = [assignmentB1, assignmentB2];
  BSTATE.events = [
    { assignment_id: 'a-1', employee_code: 'PHF_TEST', action: 'CREATE', before_data: {} },
    { assignment_id: 'a-2', employee_code: 'PHF_TEST', action: 'SUPERSEDE', before_data: { grade_snapshot: gradeSnapB1 } }
  ];
  grant2(BSTATE, 'phf_test', { type: 'self', values: [] });

  const result = await listKnlEmployeeCompetencyHistory(session('phf_test'));
  const p1 = result.periods.find(p => p.id === 'a-1');
  const p2 = result.periods.find(p => p.id === 'a-2');
  assert.strictEqual(p1.action, 'CREATE', 'Backend: assignment a-1 must carry its real authoritative action=CREATE');
  assert.strictEqual(p1.beforeGradeSnapshot, null, 'Backend: CREATE has no before_data.grade_snapshot (before_data={})');
  assert.strictEqual(p2.action, 'SUPERSEDE', 'Backend: assignment a-2 must carry its real authoritative action=SUPERSEDE');
  assert.deepStrictEqual(p2.beforeGradeSnapshot, gradeSnapB1, 'Backend: SUPERSEDE must expose the real before_data.grade_snapshot (B1)');
  console.log('PASS: Backend — listKnlEmployeeCompetencyHistory joins real action/beforeGradeSnapshot per assignment_id');

  // Permission regression: denial for out-of-scope employee unchanged (has
  // access_knl+view_people but peopleScope does not cover PHF_TEST).
  grant2(BSTATE, 'someone-else', { type: 'department', values: ['Kho vận'] });
  BSTATE.grants[BSTATE.grants.length - 1].capabilities.view_people = true;
  await assert.rejects(
    () => listKnlEmployeeCompetencyHistory(session('someone-else'), { employeeCode: 'PHF_TEST' }),
    err => err && err.statusCode === 403 && err.code === 'KNL_COMPETENCY_VIEW_DENIED',
    'Backend: out-of-scope actor must still be denied exactly as before'
  );
  console.log('PASS: Backend permission — out-of-scope denial unchanged (K8)');
}
function grant2(state, id, peopleScope) {
  state.grants.push({ id: 'grant-' + id, account_id: id, is_active: true, preset_code: 'CUSTOM', capabilities: { access_knl: true }, people_scope: peopleScope });
}

// ================= FRONTEND — competencyHistoryHtml() render =================

const code = fs.readFileSync('assets/js/knl/phf-knl-app.js', 'utf8');
const css = fs.readFileSync('assets/css/phf-knl.css', 'utf8');
function response(data) { return { ok: true, json: async () => data }; }
function tick() { return new Promise(resolve => setTimeout(resolve, 25)); }

const CURRENT_INCOME = {
  employeeCode: 'PHF_TEST', employeeName: 'Nhân sự Test', payrollPeriod: '2026-09', employmentType: 'OFFICIAL',
  ladderCode: 'SALE-COMP', ladderName: 'Ngạch Bán hàng', gradeCode: 'SALE-B3', gradeNumber: 3, versionNumber: 2,
  baseSalary: 6000000, hqcv: 1560500,
  isProfessionalAllowance: false, professionalAllowance: 0, standardProfessionalAllowance: 624250,
  isManagementAllowance: false, managementAllowance: 0, standardManagementAllowance: 500000,
  isMealAllowance: false, mealAllowance: 0, extraAllowances: [],
  totalReferenceIncome: 7560500, organizationSnapshot: {}, updatedAt: '2026-08-20T09:00:00+07:00'
};
function competencyPeriod(overrides) {
  return Object.assign({
    id: 'p1', employeeCode: 'PHF_TEST', employeeName: 'Nhân sự Test',
    frameworkVersionId: 'v1', competencyGradeId: 'g1', status: 'CONFIRMED',
    effectiveFrom: '2026-08-01', effectiveTo: null, isActive: true,
    gradeSnapshot: { frameworkCode: 'SALE', frameworkName: 'Nhân viên bán hàng', gradeCode: 'B1', gradeNumber: 1, versionNumber: 1 },
    action: 'CREATE', beforeGradeSnapshot: null,
    organizationSnapshot: {}, note: '', reason: '', updatedAt: '2026-08-01T09:00:00+07:00', createdByName: '', updatedByName: ''
  }, overrides || {});
}
async function renderIncomePage(competencyHistory) {
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
    if (body.action === 'getKnlEmployeeIncome') return response({ ok: true, employeeCode: 'PHF_TEST', current: CURRENT_INCOME, history: [] });
    if (body.action === 'getKnlEmployeeNextCompensationGrade') return response({ ok: true, hasCurrentGrade: false });
    if (body.action === 'getKnlEmployeeCompetencyStandard') return { ok: false, json: async () => ({ ok: false, error: 'not mocked' }) };
    if (body.action === 'listKnlEmployeeCompetencyHistory') return response(Object.assign({ ok: true, employeeCode: 'PHF_TEST' }, competencyHistory));
    if (body.action === 'getKnlEmployeeProfile') return { ok: false, json: async () => ({ ok: false, error: 'not mocked' }) };
    return { ok: false, json: async () => ({ ok: false, error: 'Unexpected action ' + body.action }) };
  };
  window.eval(code);
  await window.phfRenderKnl('/hv/knl/co-cau-thu-nhap');
  await tick();
  return { window, root: window.document.getElementById('phfKnlRoot') };
}
function panelOf(root) {
  const heading = [...root.querySelectorAll('h2')].find(h => h.textContent.includes('Lịch sử thay đổi bậc KNL'));
  assert(heading, 'KNL history section heading must be present');
  return heading.closest('section');
}

async function runFrontend() {
  // K1: baseline seed B1 — must not read "Bắt đầu áp dụng: — → B1".
  const p1 = competencyPeriod({
    action: 'CREATE', beforeGradeSnapshot: null,
    reason: 'PHF KNL baseline 08/2026 theo danh sách đối soát ban đầu.',
    createdByName: 'PHF KNL/Salary Baseline 08/2026 — batch script', updatedByName: ''
  });
  const { root: rootK1 } = await renderIncomePage({ periods: [p1] });
  const panelK1 = panelOf(rootK1);
  assert(!panelK1.textContent.includes('Bắt đầu áp dụng'), 'K1: baseline/seed must NOT be labeled as a real "Bắt đầu áp dụng" event');
  assert(!panelK1.textContent.includes('— →') && !panelK1.textContent.includes('—→'), 'K1: no "— → B1" arrow-from-nothing wording');
  assert(panelK1.textContent.includes('Trạng thái ban đầu khi thiết lập dữ liệu'), 'K1: baseline presented as an initial-state marker');
  assert(panelK1.textContent.includes('B1'), 'K1: recorded grade B1 still shown');
  console.log('PASS: K1 — baseline seed presented as initial-state marker, not a real event');

  // K2: real B1 -> B2 (authoritative SUPERSEDE + beforeGradeSnapshot).
  const p2 = competencyPeriod({
    id: 'p2', effectiveFrom: '2026-10-01',
    gradeSnapshot: { frameworkCode: 'SALE', frameworkName: 'Nhân viên bán hàng', gradeCode: 'B2', gradeNumber: 2, versionNumber: 1 },
    action: 'SUPERSEDE', beforeGradeSnapshot: { frameworkCode: 'SALE', frameworkName: 'Nhân viên bán hàng', gradeCode: 'B1', gradeNumber: 1, versionNumber: 1 },
    reason: 'Xét duyệt nâng bậc quý 3', createdByName: 'Nguyễn Thị HR', updatedByName: 'Nguyễn Thị HR'
  });
  const { root: rootK2 } = await renderIncomePage({ periods: [p2] });
  const panelK2 = panelOf(rootK2);
  assert(panelK2.textContent.includes('Chuyển bậc'), 'K2: authoritative grade change must render as Chuyển bậc');
  assert(panelK2.textContent.includes('B1') && panelK2.textContent.includes('B2'), 'K2: both real before/after grades must be shown');
  console.log('PASS: K2 — authoritative B1 -> B2 SUPERSEDE renders as Chuyển bậc: B1 -> B2');

  // K3: a period with no matching authoritative event (action=null, defensive/edge
  // case — e.g. history table row beyond the .limit(100) window) must NOT be
  // rendered as if it were a real up/down grade transition.
  const p3 = competencyPeriod({ id: 'p3', action: null, beforeGradeSnapshot: null });
  const { root: rootK3 } = await renderIncomePage({ periods: [p3] });
  const panelK3 = panelOf(rootK3);
  assert(!panelK3.textContent.includes('Nâng bậc') && !panelK3.textContent.includes('Giảm bậc'), 'K3: no event with an unmatched/unknown action may be presented as a real grade-change direction');
  console.log('PASS: K3 — entry with no authoritative action never renders a fabricated up/down transition');

  // K4: CONFIRM action (provisional -> confirmed, no grade change) renders distinctly.
  const p4 = competencyPeriod({ id: 'p4', status: 'CONFIRMED', action: 'CONFIRM', beforeGradeSnapshot: null, reason: 'Xác nhận theo đánh giá quý', createdByName: 'Nguyễn Thị HR' });
  const { root: rootK4 } = await renderIncomePage({ periods: [p4] });
  const panelK4 = panelOf(rootK4);
  assert(panelK4.textContent.includes('Xác nhận Chính thức'), 'K4: CONFIRM action must render as Xác nhận Chính thức');
  console.log('PASS: K4 — CONFIRM action (applied, not a proposal) renders correctly');

  // K5: framework change must be distinguished from a grade-only change.
  const p5 = competencyPeriod({
    id: 'p5', gradeSnapshot: { frameworkCode: 'WAREHOUSE', frameworkName: 'Nhân viên kho', gradeCode: 'B1', gradeNumber: 1, versionNumber: 1 },
    action: 'SUPERSEDE', beforeGradeSnapshot: { frameworkCode: 'SALE', frameworkName: 'Nhân viên bán hàng', gradeCode: 'B1', gradeNumber: 1, versionNumber: 1 }
  });
  const { root: rootK5 } = await renderIncomePage({ periods: [p5] });
  const panelK5 = panelOf(rootK5);
  assert(panelK5.textContent.includes('Đổi Khung năng lực'), 'K5: framework change must render as Đổi Khung năng lực, not Nâng bậc/Chuyển bậc');
  assert(!panelK5.textContent.includes('Chuyển bậc'), 'K5: a pure framework change must not also claim Chuyển bậc');
  console.log('PASS: K5 — framework change distinguished from grade-only change');

  // K6: compensation isolation — a compensation gradeCode must never leak into or influence Section 5.
  const p6 = competencyPeriod({ id: 'p6' });
  const { root: rootK6 } = await renderIncomePage({ periods: [p6] });
  const panelK6 = panelOf(rootK6);
  assert(!panelK6.textContent.includes('SALE-B3'), 'K6: compensation gradeCode (SALE-B3) must never appear in the KNL grade history section');
  console.log('PASS: K6 — Section 5 shows no compensation-domain grade codes');

  // K7: actor/reason only shown when the source actually has them.
  const p7NoReason = competencyPeriod({ id: 'p7', reason: '', createdByName: 'Nguyễn Thị HR' });
  const { root: rootK7 } = await renderIncomePage({ periods: [p7NoReason] });
  const panelK7 = panelOf(rootK7);
  assert(!panelK7.textContent.includes('Lý do:'), 'K7: no reason in source must not render a fabricated "Lý do:" line');
  assert(panelK7.textContent.includes('Nguyễn Thị HR'), 'K7: real actor name must still be shown');
  console.log('PASS: K7 — actor/reason reflect real source data only');

  // K8: permission — covered on the backend side (runBackend), re-asserted here that
  // a denied session never reaches the KNL history section at all.
  const dom = new JSDOM('<!doctype html><html><head><style>' + css + '</style></head><body><div id="phfKnlRoot"></div></body></html>', { url: 'http://localhost/hv/knl/co-cau-thu-nhap?employee_code=PHF_TEST', runScripts: 'outside-only' });
  const { window } = dom;
  window.phfGetSessionRole = () => 'learner';
  window.phfGetCurrentUser = () => ({ id: 'phf-test', employeeCode: 'PHF_TEST', name: 'Nhân sự Test' });
  window.phfNavigate = () => {}; window.scrollTo = () => {}; window.requestAnimationFrame = fn => setTimeout(fn, 0);
  window.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.action === 'getKnlCapabilities') return response({ ok: true, isAdmin: false, capabilities: { access_knl: true }, peopleScope: { type: 'self', values: [] } });
    if (body.action === 'getKnlEmployeeIncome') return { ok: false, json: async () => ({ ok: false, error: 'Không có quyền xem thu nhập của nhân sự này.', code: 'KNL_INCOME_VIEW_DENIED' }) };
    return { ok: false, json: async () => ({ ok: false, error: 'Unexpected action ' + body.action }) };
  };
  window.eval(code);
  await window.phfRenderKnl('/hv/knl/co-cau-thu-nhap');
  await tick();
  assert(!window.document.body.textContent.includes('Lịch sử thay đổi bậc KNL'), 'K8: a denied income session must never reach the KNL history section either (same page, same gate)');
  console.log('PASS: K8 — denied session never reaches Section 5');

  // K9: baseline entry and a subsequent real event coexist, none dropped.
  const p9baseline = competencyPeriod({ id: 'p9a', effectiveFrom: '2026-08-01', isActive: false, effectiveTo: '2026-10-01', action: 'CREATE', beforeGradeSnapshot: null, createdByName: 'PHF KNL/Salary Baseline 08/2026 — batch script' });
  const p9real = competencyPeriod({
    id: 'p9b', effectiveFrom: '2026-10-01', isActive: true,
    gradeSnapshot: { frameworkCode: 'SALE', frameworkName: 'Nhân viên bán hàng', gradeCode: 'B2', gradeNumber: 2, versionNumber: 1 },
    action: 'SUPERSEDE', beforeGradeSnapshot: { frameworkCode: 'SALE', frameworkName: 'Nhân viên bán hàng', gradeCode: 'B1', gradeNumber: 1, versionNumber: 1 },
    createdByName: 'Nguyễn Thị HR', updatedByName: 'Nguyễn Thị HR'
  });
  const { root: rootK9 } = await renderIncomePage({ periods: [p9baseline, p9real] });
  const panelK9 = panelOf(rootK9);
  assert.strictEqual(panelK9.querySelectorAll('.phfk-comp-history-item').length, 2, 'K9: baseline + real event must both render, none dropped');
  assert(panelK9.textContent.includes('Trạng thái ban đầu khi thiết lập dữ liệu'), 'K9: baseline entry present with distinct semantics');
  assert(panelK9.textContent.includes('Chuyển bậc'), 'K9: real subsequent event present with distinct semantics');
  console.log('PASS: K9 — baseline and real event coexist with clearly different semantics');

  // K10: no technical leak (raw ids/JSON) as primary content.
  const panelText = panelK9.textContent;
  assert(!panelText.includes('frameworkVersionId') && !panelText.includes('competencyGradeId'), 'K10: raw technical ids must not leak');
  assert(!panelText.includes('{"'), 'K10: no raw JSON payload leak');
  console.log('PASS: K10 — no technical leak in primary Section 5 content');
}

(async () => {
  await runBackend();
  await runFrontend();
  console.log('ALL PASS — KNL Competency History Authoritative Event Source (Batch 1C)');
})().catch(err => { console.error(err); process.exit(1); });
