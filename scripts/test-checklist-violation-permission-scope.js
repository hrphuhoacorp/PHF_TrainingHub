'use strict';
/* Regression: proves getChecklistViolationWorkflowSummary() (Tong quan/Bao cao)
   and listChecklistViolations() (Nhat ky loi) resolve to the SAME viewScope and
   agree bucket-by-bucket, across every permission preset, using a deliberately
   crafted multi-department/multi-branch/multi-employee dataset that includes
   records OUTSIDE each preset's scope (to prove no leakage) - not just that the
   functions return a number.

   Unlike test-checklist-violation-workflow-summary.js (which stubs the DB with
   canned, unfiltered results per table), this file implements a small in-memory
   query engine that actually APPLIES .eq()/.in()/.neq()/.gte()/.lte()/.or() as
   real WHERE predicates against fixture rows. This is what makes the "no
   leakage" assertions meaningful: if a scope filter were ever dropped from the
   production code, this mock would let the wrong rows through and the test
   would fail - it is not just exercising the code path.

   No real Supabase project, no Production data. lib/checklist-violations.js,
   lib/checklist-reports.js, lib/checklist-tasks.js and lib/checklist-permissions.js
   all run for real against this mocked client. */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const violationsPath = require.resolve('../lib/checklist-violations');
const reportsPath = require.resolve('../lib/checklist-reports');
const permissionsPath = require.resolve('../lib/checklist-permissions');

// ---------------------------------------------------------------------------
// Minimal in-memory Postgrest-like query engine (eq/neq/in/gte/lte/or as real
// row predicates, not canned responses).
// ---------------------------------------------------------------------------
function parseOrClause(clauseStr, row) {
  const clauses = String(clauseStr || '').split(',').map(c => c.trim()).filter(Boolean);
  return clauses.some(clause => {
    const m = clause.match(/^([a-zA-Z0-9_]+)\.(eq|is|gte|lte|neq)\.(.*)$/);
    if (!m) return false;
    const [, field, op, rawVal] = m;
    const rowVal = row[field];
    if (op === 'is') return rawVal === 'null' ? (rowVal === null || rowVal === undefined || rowVal === '') : String(rowVal) === rawVal;
    if (op === 'eq') return String(rowVal) === rawVal;
    if (op === 'neq') return String(rowVal) !== rawVal;
    if (op === 'gte') return rowVal != null && String(rowVal) >= rawVal;
    if (op === 'lte') return rowVal != null && String(rowVal) <= rawVal;
    return false;
  });
}

// Builder methods (including range/limit/maybeSingle) only record intent and
// return `q` - the SAME object stays chainable no matter what order the
// production code calls them in (e.g. .limit(5000) then later .in(...), as
// getChecklistViolationWorkflowSummary does). The actual filtering/slicing
// only happens in .then(), making `q` itself a thenable - mirroring how the
// real supabase-js PostgrestFilterBuilder works (chainable AND awaitable).
function tableQuery(getRows) {
  const filters = [];
  let wantCount = false;
  let rangeFrom = null, rangeTo = null, limitN = null, wantSingle = false;
  const q = {
    select(_fields, opts) { if (opts && opts.count) wantCount = true; return q; },
    eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
    neq(field, value) { filters.push(r => String(r[field]) !== String(value)); return q; },
    in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
    gte(field, value) { filters.push(r => r[field] != null && r[field] >= value); return q; },
    lte(field, value) { filters.push(r => r[field] != null && r[field] <= value); return q; },
    lt(field, value) { filters.push(r => r[field] != null && r[field] < value); return q; },
    or(clauseStr) { filters.push(r => parseOrClause(clauseStr, r)); return q; },
    order() { return q; },
    range(from, to) { rangeFrom = from; rangeTo = to; return q; },
    limit(n) { limitN = n; return q; },
    maybeSingle() { wantSingle = true; return q; },
    then(resolve, reject) {
      try {
        let matched = getRows().filter(r => filters.every(fn => fn(r)));
        const count = wantCount ? matched.length : null;
        if (wantSingle) { resolve({ data: matched[0] || null, error: null }); return; }
        if (rangeFrom != null) matched = matched.slice(rangeFrom, rangeTo + 1);
        else if (limitN != null) matched = matched.slice(0, limitN);
        resolve({ data: matched, error: null, count });
      } catch (e) { (reject || (err => Promise.reject(err)))(e); }
    }
  };
  return q;
}

// ---------------------------------------------------------------------------
// Fixture data: 2 departments (Ban hang / Kho), 3 branches under Ban hang
// (matching TRUONG_CA_BH's real preset default scope values), 4 employees
// split across 2 different direct managers (TC01, QL01) so viewScope and
// reviewScope resolve to DIFFERENT sets for Truong ca - the exact case the
// business decisions require to be tested.
// ---------------------------------------------------------------------------
const ASSIGNMENTS = [
  { employee_code: 'NV001', employee_name: 'Nguyen Van A', department: 'Bán hàng', branch: 'Phú Lợi', manager_id: '', manager_code: 'TC01', employee_status: 'Đang làm việc' },
  { employee_code: 'NV002', employee_name: 'Tran Thi B', department: 'Bán hàng', branch: 'Ngô Quyền', manager_id: '', manager_code: 'QL01', employee_status: 'Đang làm việc' }, // in TC's viewScope, NOT in TC's reviewScope
  { employee_code: 'NV003', employee_name: 'Le Van C', department: 'Kho', branch: 'Phú Lợi', manager_id: '', manager_code: 'QL01', employee_status: 'Đang làm việc' },       // outside TBP/TC scope entirely
  { employee_code: 'NV004', employee_name: 'Pham Thi D', department: 'Bán hàng', branch: 'Lái Thiêu', manager_id: '', manager_code: 'TC01', employee_status: 'Đang làm việc' }
];

const OCCURRED = '2026-08-10';
const now = Date.now();
const iso = ms => new Date(ms).toISOString();
const PAST = iso(now - 60 * 60 * 1000);
const FAR_FUTURE = iso(now + 10 * 24 * 60 * 60 * 1000);   // outside any 3-day dueSoon window
const NEAR_FUTURE = iso(now + 2 * 24 * 60 * 60 * 1000);   // inside a 3-day dueSoon window
const OLD_PAST = iso(now - 100 * 24 * 60 * 60 * 1000);

const VIOLATIONS = [
  { id: 'r1', employee_code: 'NV001', record_status: 'official', occurred_date: OCCURRED, is_test: false }, // waiting_employee
  { id: 'r2', employee_code: 'NV001', record_status: 'official', occurred_date: OCCURRED, is_test: false }, // waiting_reviewer
  { id: 'r3', employee_code: 'NV002', record_status: 'official', occurred_date: OCCURRED, is_test: false }, // waiting_admin
  { id: 'r4', employee_code: 'NV002', record_status: 'official', occurred_date: OCCURRED, is_test: false }, // waiting_reviewer + overdue
  { id: 'r5', employee_code: 'NV003', record_status: 'official', occurred_date: OCCURRED, is_test: false }, // completed -> official only, not open
  { id: 'r6', employee_code: 'NV003', record_status: 'cancelled', occurred_date: OCCURRED, is_test: false },
  { id: 'r7', employee_code: 'NV004', record_status: 'official', occurred_date: OCCURRED, is_test: false }, // waiting_employee_result, due_soon
  { id: 'r8', employee_code: 'NV004', record_status: 'cancelled', occurred_date: OCCURRED, is_test: false }
];

const TASKS = [
  { violation_id: 'r1', status: 'waiting_employee', due_at: FAR_FUTURE },
  { violation_id: 'r2', status: 'waiting_reviewer', due_at: FAR_FUTURE },
  { violation_id: 'r3', status: 'waiting_admin', due_at: FAR_FUTURE },
  { violation_id: 'r4', status: 'waiting_reviewer', due_at: PAST },
  { violation_id: 'r5', status: 'completed', due_at: OLD_PAST },
  { violation_id: 'r7', status: 'waiting_employee_result', due_at: NEAR_FUTURE }
  // r6, r8 cancelled -> no linked task, as in real data
];

const TIMING_POLICY_ROW = {
  setting_key: 'monthly_self_overdue_policy',
  setting_value: JSON.stringify({ employeeResponseDays: 3, reviewerResponseDays: 3, monthlyCutoffDay: 4, monthlyCutoffTime: '23:59', adminAfterLock: 'controlled', effectiveFromPeriod: '2026-08' })
};

// All 6 personas' grants co-exist at once (realistic - proves actor-based
// .or('account_id.eq....') lookup isolates the right row, not "only one row
// ever exists in the table").
const GRANTS = [
  { id: 'g-tlgd', account_id: 'act-tlgd', employee_code: '', preset_code: 'TRO_LY_GD',
    capabilities: { view_violations: true, record_violation: true, review_monthly: true, view_reports: true, view_monthly: true, export_data: true },
    view_scope: { type: 'all_company', values: [] }, review_scope: { type: 'all_company', values: [] }, record_scope: { type: 'all_company', values: [] },
    export_scope: { type: 'all_company', values: [] },
    is_active: true, effective_from: '2020-01-01', effective_to: null, updated_at: '2026-01-01' },
  { id: 'g-tbp', account_id: 'act-tbp', employee_code: '', preset_code: 'TRUONG_BO_PHAN',
    capabilities: { view_violations: true, record_violation: true, review_monthly: true, view_reports: true, export_data: true },
    view_scope: { type: 'department', values: ['Bán hàng'] }, review_scope: { type: 'department', values: ['Bán hàng'] }, record_scope: { type: 'department', values: ['Bán hàng'] },
    export_scope: { type: 'department', values: ['Bán hàng'] },
    is_active: true, effective_from: '2020-01-01', effective_to: null, updated_at: '2026-01-01' },
  { id: 'g-tc', account_id: 'act-tc', employee_code: 'TC01', preset_code: 'TRUONG_CA_BH',
    capabilities: { view_violations: true, record_violation: true, review_monthly: true, view_reports: true },
    view_scope: { type: 'department_branch', values: ['Bán hàng', 'Phú Lợi', 'Ngô Quyền', 'Lái Thiêu'] },
    review_scope: { type: 'direct_reports', values: [] },
    record_scope: { type: 'department_branch', values: ['Bán hàng', 'Phú Lợi', 'Ngô Quyền', 'Lái Thiêu'] },
    is_active: true, effective_from: '2020-01-01', effective_to: null, updated_at: '2026-01-01' },
  // Luu y: preset QUAN_LY_TRUC_TIEP mac dinh co export_data:false/exportScope
  // 'none' (xem PRESETS trong lib/checklist-permissions.js) - grant fixture o
  // day CO CHU Y bat export_data:true + export_scope=direct_reports de mo
  // phong mot grant da duoc Admin tuy chinh rong hon mac dinh preset (hop le
  // vi grant luu doc lap voi preset), phuc vu AR-05 kiem tra engine co ho tro
  // dung direct_reports cho export khong. KHONG suy ra day la hanh vi mac
  // dinh cua QUAN_LY_TRUC_TIEP.
  { id: 'g-ql', account_id: 'act-ql', employee_code: 'QL01', preset_code: 'QUAN_LY_TRUC_TIEP',
    capabilities: { view_violations: true, record_violation: false, review_monthly: true, view_reports: true, export_data: true },
    view_scope: { type: 'direct_reports', values: [] }, review_scope: { type: 'direct_reports', values: [] }, record_scope: { type: 'none', values: [] },
    export_scope: { type: 'direct_reports', values: [] },
    is_active: true, effective_from: '2020-01-01', effective_to: null, updated_at: '2026-01-01' },
  { id: 'g-cxbc', account_id: 'act-cxbc', employee_code: '', preset_code: 'CHI_XEM_BAO_CAO',
    capabilities: { view_violations: false, record_violation: false, review_monthly: false, view_reports: true },
    view_scope: { type: 'direct_reports', values: [] }, review_scope: { type: 'none', values: [] }, record_scope: { type: 'none', values: [] },
    is_active: true, effective_from: '2020-01-01', effective_to: null, updated_at: '2026-01-01' },
  // Adversarial fixture: pretend act-nv (the learner/employee account) also has an
  // all_company grant row. If resolveViolationPermission ever stopped
  // short-circuiting the learner role BEFORE hitting this table, this row would
  // silently widen a Nhan vien session to company-wide - the test below proves
  // that does NOT happen (role-based short-circuit cannot be bypassed via
  // forged/leftover grant data).
  { id: 'g-nv-forged', account_id: 'act-nv', employee_code: 'NV001', preset_code: 'TRO_LY_GD',
    capabilities: { view_violations: true, record_violation: true, review_monthly: true, view_reports: true },
    view_scope: { type: 'all_company', values: [] }, review_scope: { type: 'all_company', values: [] }, record_scope: { type: 'all_company', values: [] },
    is_active: true, effective_from: '2020-01-01', effective_to: null, updated_at: '2026-01-01' },
  // AR-05 regression: khop CHINH XAC hinh dang 2 grant Production that ma
  // AR-04 doc thay (TRUONG_CA_BH, view_scope.type=department_branch, values
  // tagged department::/branch::) - truoc AR-05, assignmentMatchesPermission()
  // khong parse duoc tag nay nen view_violations/record_violation deu tra
  // rong (Silent Denial) du grant hop le. Dat ca view_scope LAN record_scope
  // deu la department_branch tagged (nang hon 2 grant Production that, von
  // da duoc chinh record_scope sang direct_reports) de kiem tra dung diem
  // code truoc day bi gay.
  { id: 'g-tc-tagged', account_id: 'act-tc-tagged', employee_code: 'TC02', preset_code: 'TRUONG_CA_BH',
    capabilities: { view_violations: true, record_violation: true, review_monthly: true, view_reports: true, export_data: true },
    view_scope: { type: 'department_branch', values: ['department::Bán hàng', 'branch::Phú Lợi', 'branch::Ngô Quyền', 'branch::Lái Thiêu'] },
    review_scope: { type: 'direct_reports', values: [] },
    record_scope: { type: 'department_branch', values: ['department::Bán hàng', 'branch::Phú Lợi', 'branch::Ngô Quyền', 'branch::Lái Thiêu'] },
    // exportScope dung CUNG mot bo tag department::/branch:: nhu view/record
    // scope o tren (khong phai tinh cong tu view_scope - day la truong rieng
    // export_scope, chi trung gia tri vi cung mot nghiep vu Truong ca).
    export_scope: { type: 'department_branch', values: ['department::Bán hàng', 'branch::Phú Lợi', 'branch::Ngô Quyền', 'branch::Lái Thiêu'] },
    is_active: true, effective_from: '2020-01-01', effective_to: null, updated_at: '2026-01-01' },
  // AR-05 FINAL: grant rieng cho exportScope.type='employees' - preset
  // TUY_CHINH (khong preset mac dinh nao dung 'employees' cho export, day la
  // cau hinh Admin tuy chinh qua UI, dung path that). values chi gom
  // NV002+NV004 - loai han NV001 (du cung phong ban Ban hang) de chung minh
  // dung dung 2 nguoi duoc chon, khong phai ca phong ban.
  { id: 'g-export-employees', account_id: 'act-export-emp', employee_code: 'EXPEMP', preset_code: 'TUY_CHINH',
    capabilities: { view_violations: false, record_violation: false, review_monthly: false, view_reports: false, export_data: true },
    view_scope: { type: 'none', values: [] }, review_scope: { type: 'none', values: [] }, record_scope: { type: 'none', values: [] },
    export_scope: { type: 'employees', values: ['NV002', 'NV004'] },
    is_active: true, effective_from: '2020-01-01', effective_to: null, updated_at: '2026-01-01' },
  // AR-05 FINAL: grant CO CHU Y dat view_scope va export_scope KHAC LOAI VA
  // KHAC GIA TRI nhau tren cung 1 row (view_scope=department rong hon,
  // export_scope=branch hep hon) - day la phep thu doc lap manh nhat: neu
  // getChecklistExportAccess() vo tinh dung nham view_scope thay vi
  // export_scope, ket qua se la 3 nguoi (ca phong Ban hang) thay vi dung 1
  // nguoi (Ngo Quyen) - sai lech se lo ngay, khong the trung hop ngau nhien.
  { id: 'g-export-divergent', account_id: 'act-export-divergent', employee_code: '', preset_code: 'TUY_CHINH',
    capabilities: { view_violations: false, record_violation: false, review_monthly: false, view_reports: true, export_data: true },
    view_scope: { type: 'department', values: ['Bán hàng'] }, review_scope: { type: 'none', values: [] }, record_scope: { type: 'none', values: [] },
    export_scope: { type: 'branch', values: ['Ngô Quyền'] },
    is_active: true, effective_from: '2020-01-01', effective_to: null, updated_at: '2026-01-01' }
];

require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true, exports: {
    createClient: () => ({
      from(table) {
        if (table === 'checklist_violation_records') return tableQuery(() => VIOLATIONS);
        if (table === 'checklist_violation_tasks') return tableQuery(() => TASKS);
        if (table === 'checklist_permission_grants') return tableQuery(() => GRANTS);
        if (table === 'checklist_employee_assignments') return tableQuery(() => ASSIGNMENTS);
        if (table === 'checklist_system_settings') return tableQuery(() => [TIMING_POLICY_ROW]);
        return tableQuery(() => []);
      }
    })
  }
};

const { listChecklistViolations, resolveViolationPermission, requireViolationPermission } = require(violationsPath);
const { getChecklistViolationWorkflowSummary } = require(reportsPath);
const { getChecklistMonthlyReviewAccess, getChecklistExportAccess } = require(permissionsPath);

const SESSIONS = {
  admin: { role: 'admin', account: { id: 'act-admin', name: 'Admin' } },
  tlgd: { role: 'manager', account: { id: 'act-tlgd', name: 'Tro ly GD' } },
  tbp: { role: 'manager', account: { id: 'act-tbp', name: 'Truong bo phan' } },
  tc: { role: 'manager', account: { id: 'act-tc', name: 'Truong ca' }, employeeCode: 'TC01' },
  ql: { role: 'manager', account: { id: 'act-ql', name: 'Quan ly truc tiep' }, employeeCode: 'QL01' },
  cxbc: { role: 'manager', account: { id: 'act-cxbc', name: 'Chi xem bao cao' } },
  nv: { role: 'learner', account: { id: 'act-nv', name: 'Nhan vien' }, employeeCode: 'NV001' },
  tcTagged: { role: 'manager', account: { id: 'act-tc-tagged', name: 'Truong ca (tagged, AR-05)' }, employeeCode: 'TC02' },
  exportEmployees: { role: 'manager', account: { id: 'act-export-emp', name: 'Export employees (AR-05 FINAL)' }, employeeCode: 'EXPEMP' },
  exportDivergent: { role: 'manager', account: { id: 'act-export-divergent', name: 'Export divergent (AR-05 FINAL)' } }
};

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}

const BUCKET_TO_WORKFLOW_STATUS = { waitingEmployee: 'waiting_employee', inExplanation: 'in_explanation', waitingAdmin: 'waiting_admin', overdue: 'overdue', dueSoon: 'due_soon', open: 'open' };

async function assertSummaryMatchesList(session, label, expected, allowedCodes) {
  const wf = await getChecklistViolationWorkflowSummary(session, { month: '2026-08' });
  check(wf.canView === true, label + ': canView = true');
  if (wf.canView !== true) return;
  ['total', 'official', 'cancelled', 'waitingEmployee', 'inExplanation', 'waitingAdmin', 'overdue', 'dueSoon', 'open'].forEach(key => {
    check(wf.summary[key] === expected[key], label + ': summary.' + key + ' = ' + expected[key] + ', got ' + wf.summary[key]);
  });

  const listAll = await listChecklistViolations(session, { pageSize: 100 });
  check(listAll.total === expected.total, label + ': list total (no filter) = ' + expected.total + ', got ' + listAll.total);
  const leaked = listAll.records.filter(r => !allowedCodes.includes(r.employee_code));
  check(leaked.length === 0, label + ': list (no filter) has 0 out-of-scope records, got ' + leaked.length + (leaked.length ? ' [' + leaked.map(r => r.employee_code).join(',') + ']' : ''));
  const empLeaked = (listAll.employees || []).filter(e => !allowedCodes.includes(e.employeeCode));
  check(empLeaked.length === 0, label + ': employees list has 0 out-of-scope entries, got ' + empLeaked.length);

  for (const key of ['official', 'cancelled']) {
    const list = await listChecklistViolations(session, { workflowStatus: key, pageSize: 100 });
    check(list.total === expected[key], label + ': summary.' + key + ' (' + expected[key] + ') === list.total(workflowStatus=' + key + ') (' + list.total + ')');
  }
  for (const bucket of Object.keys(BUCKET_TO_WORKFLOW_STATUS)) {
    const wfStatus = BUCKET_TO_WORKFLOW_STATUS[bucket];
    const list = await listChecklistViolations(session, { workflowStatus: wfStatus, pageSize: 100 });
    check(list.total === expected[bucket], label + ': summary.' + bucket + ' (' + expected[bucket] + ') === list.total(workflowStatus=' + wfStatus + ') (' + list.total + ')');
    const leakedBucket = list.records.filter(r => !allowedCodes.includes(r.employee_code));
    check(leakedBucket.length === 0, label + ': drill-down ' + wfStatus + ' has 0 out-of-scope records, got ' + leakedBucket.length);
  }
  return wf;
}

async function run() {
  console.log('== A. ADMIN - toan cong ty ==');
  const expectedAll = { total: 8, official: 6, cancelled: 2, waitingEmployee: 2, inExplanation: 3, waitingAdmin: 1, overdue: 1, dueSoon: 1, open: 5 };
  await assertSummaryMatchesList(SESSIONS.admin, 'Admin', expectedAll, ['NV001', 'NV002', 'NV003', 'NV004']);
  const adminPerm = await resolveViolationPermission(SESSIONS.admin, 'view');
  check(adminPerm.canView === true && adminPerm.canRecord === true && adminPerm.canEditTest === true && adminPerm.canCancel === true && adminPerm.scopeType === 'all_company', 'Admin: full capabilities + scope=all_company (source-of-truth, not inferred from role name alone elsewhere)');
  const adminReview = await getChecklistMonthlyReviewAccess(SESSIONS.admin);
  check(adminReview.canReview === true && adminReview.people.length === 4, 'Admin: Monthly Review sees all 4 employees (toan cong ty)');

  console.log('== B. TRO LY GD / BAN GIAM SAT - viewScope toan cong ty ==');
  await assertSummaryMatchesList(SESSIONS.tlgd, 'Tro ly GD', expectedAll, ['NV001', 'NV002', 'NV003', 'NV004']);
  const tlgdPerm = await resolveViolationPermission(SESSIONS.tlgd, 'view');
  check(tlgdPerm.scopeType === 'all_company', 'Tro ly GD: viewScope = all_company (khong chi case tu tao/duoc giao - toan bo cong ty)');
  const tlgdAdminAction = await resolveViolationPermission(SESSIONS.tlgd, 'view');
  check(tlgdAdminAction.canEditTest === false && tlgdAdminAction.canCancel === false, 'Tro ly GD: khong tu co quyen loi Admin (canEditTest/canCancel van false)');

  console.log('== C. TRUONG BO PHAN - chi dung bo phan ==');
  const expectedDept = { total: 6, official: 5, cancelled: 1, waitingEmployee: 2, inExplanation: 3, waitingAdmin: 1, overdue: 1, dueSoon: 1, open: 5 };
  await assertSummaryMatchesList(SESSIONS.tbp, 'Truong bo phan', expectedDept, ['NV001', 'NV002', 'NV004']);
  const tbpReview = await getChecklistMonthlyReviewAccess(SESSIONS.tbp);
  const tbpReviewCodes = tbpReview.people.map(p => p.employeeCode).sort();
  check(JSON.stringify(tbpReviewCodes) === JSON.stringify(['NV001', 'NV002', 'NV004']), 'Truong bo phan: Monthly Review (reviewScope) van dung department, khop voi viewScope trong case nay, khong lo NV003 (Kho), got ' + tbpReviewCodes.join(','));

  console.log('== D. TRUONG CA - viewScope rong hon reviewScope (case bat buoc) ==');
  // KPI ghi nhan loi phai dung viewScope: cung tap NV001/NV002/NV004 nhu Truong bo phan.
  await assertSummaryMatchesList(SESSIONS.tc, 'Truong ca (KPI ghi nhan loi)', expectedDept, ['NV001', 'NV002', 'NV004']);
  // Monthly Review (Phieu cho tham dinh) phai dung reviewScope = direct_reports (TC01) -> CHI NV001+NV004, KHONG NV002.
  const tcReview = await getChecklistMonthlyReviewAccess(SESSIONS.tc);
  const tcReviewCodes = tcReview.people.map(p => p.employeeCode).sort();
  check(JSON.stringify(tcReviewCodes) === JSON.stringify(['NV001', 'NV004']), 'Truong ca: Monthly Review (reviewScope=direct_reports) CHI thay NV001+NV004 (nguoi quan ly truc tiep), KHONG thay NV002 du NV002 nam trong viewScope KPI - khong nham 2 pham vi, got ' + tcReviewCodes.join(','));
  check(tcReviewCodes.indexOf('NV002') === -1, 'Truong ca: NV002 (trong viewScope nhung khong phai direct report) khong xuat hien trong danh sach tham dinh');

  console.log('== D2. TRUONG CA (TAGGED department_branch, dung HINH DANG Production that - AR-05 regression) ==');
  // AR-04 doc Production thay 2 grant TRUONG_CA_BH active co view_scope.type=
  // department_branch voi values dang tagged (department::.../branch::...).
  // Truoc AR-05, assignmentMatchesPermission() khong parse duoc tag nay ->
  // view_violations/record_violation deu tra RONG (Silent Denial) du grant
  // hop le va co view_violations/record_violation=true. Test nay chay dung
  // qua resolveViolationPermission() -> permissionEmployees() ->
  // listChecklistViolations()/requireViolationPermission() - dung API that,
  // khong test rieng ham noi bo - de chung minh duong hong thuc su da het.
  await assertSummaryMatchesList(SESSIONS.tcTagged, 'Truong ca (tagged)', expectedDept, ['NV001', 'NV002', 'NV004']);
  let tcTaggedRecordBlockedForInScope = false;
  try { await requireViolationPermission(SESSIONS.tcTagged, 'record', [{ employee_code: 'NV001' }]); }
  catch (e) { tcTaggedRecordBlockedForInScope = true; }
  check(tcTaggedRecordBlockedForInScope === false, 'Truong ca (tagged): NV001 (dung department_branch tagged) KHONG con bi chan nham CHECKLIST_VIOLATION_OUT_OF_SCOPE khi Ghi nhan loi (day chinh la bug AR-04 phat hien tren Production that)');
  let tcTaggedRecordBlockedForOutOfScope = false;
  try { await requireViolationPermission(SESSIONS.tcTagged, 'record', [{ employee_code: 'NV003' }]); }
  catch (e) { tcTaggedRecordBlockedForOutOfScope = e && e.code === 'CHECKLIST_VIOLATION_OUT_OF_SCOPE'; }
  check(tcTaggedRecordBlockedForOutOfScope === true, 'Truong ca (tagged): NV003 (Kho, ngoai tag department::Ban hang) VAN bi chan dung nhu cu - sua bug khong lam rong pham vi');

  console.log('== E. QUAN LY TRUC TIEP - chi xem, khong duoc ghi ==');
  const expectedQl = { total: 4, official: 3, cancelled: 1, waitingEmployee: 0, inExplanation: 2, waitingAdmin: 1, overdue: 1, dueSoon: 0, open: 2 };
  await assertSummaryMatchesList(SESSIONS.ql, 'Quan ly truc tiep', expectedQl, ['NV002', 'NV003']);
  const qlPerm = await resolveViolationPermission(SESSIONS.ql, 'record');
  check(qlPerm.canRecord === false, 'Quan ly truc tiep: khong co record_violation -> canRecord=false');
  let qlRecordBlocked = false;
  try { await requireViolationPermission(SESSIONS.ql, 'record', [{ employee_code: 'NV002' }]); }
  catch (e) { qlRecordBlocked = e && e.code === 'CHECKLIST_VIOLATION_PERMISSION_DENIED'; }
  check(qlRecordBlocked, 'Quan ly truc tiep: goi truc tiep requireViolationPermission(record) bi chan (khong the mo rong quyen qua goi API thang)');
  // Sua URL/goi API voi employeeCode ngoai pham vi (NV001 thuoc Truong ca, khong phai QL) -> ket qua RONG, khong lo, khong loi.
  const qlOutOfScope = await listChecklistViolations(SESSIONS.ql, { employeeCode: 'NV001', pageSize: 100 });
  check(qlOutOfScope.total === 0 && qlOutOfScope.records.length === 0, 'Quan ly truc tiep: goi listChecklistViolations voi employeeCode=NV001 (ngoai pham vi) -> 0 ban ghi, khong bi lo qua tham so URL/API');

  console.log('== F. CHI XEM BAO CAO - khong co view_violations ==');
  const cxbcSummary = await getChecklistViolationWorkflowSummary(SESSIONS.cxbc, { month: '2026-08' });
  check(cxbcSummary.canView === false && cxbcSummary.summary === null, 'Chi xem bao cao: khong co view_violations -> canView=false, summary=null (khong tu lay duoc du lieu vi pham)');
  let cxbcListBlocked = false;
  try { await listChecklistViolations(SESSIONS.cxbc, {}); }
  catch (e) { cxbcListBlocked = e && e.code === 'CHECKLIST_VIOLATION_PERMISSION_DENIED'; }
  check(cxbcListBlocked, 'Chi xem bao cao: listChecklistViolations (Nhat ky loi) bi chan dung code CHECKLIST_VIOLATION_PERMISSION_DENIED');
  const cxbcPerm = await resolveViolationPermission(SESSIONS.cxbc, 'view');
  check(cxbcPerm.canView === false, 'Chi xem bao cao: permission gate tu capabilities.view_violations, khong suy tu ten role (role="manager" giong het Truong bo phan/Truong ca nhung ket qua khac vi capabilities khac)');

  console.log('== G. NHAN VIEN - chi du lieu ca nhan ==');
  const expectedNv = { total: 2, official: 2, cancelled: 0, waitingEmployee: 1, inExplanation: 1, waitingAdmin: 0, overdue: 0, dueSoon: 0, open: 2 };
  await assertSummaryMatchesList(SESSIONS.nv, 'Nhan vien', expectedNv, ['NV001']);
  const nvPerm = await resolveViolationPermission(SESSIONS.nv, 'view');
  check(nvPerm.scopeType === 'employees' && JSON.stringify(nvPerm.scopeValues) === JSON.stringify(['NV001']), 'Nhan vien: scope luon la employees/[chinh minh], bat ke co ban ghi phan quyen "all_company" gia mao trong bang checklist_permission_grants cho cung account_id (role=learner short-circuit truoc khi doc bang quyen) - khong the mo rong qua du lieu quyen con sot/gia mao');

  console.log('== H. EXPORT_DATA / exportScope - AR-05 FINAL EXPORT REGRESSION ==');
  // getChecklistExportAccess() dung CHUNG subjectMatchesScope() (lib/checklist-scope.js)
  // qua truong export_scope rieng - KHONG di qua resolveViolationPermission/
  // assignmentMatchesPermission cua checklist-violations.js. Test nay goi
  // THANG getChecklistExportAccess() that, khong mock rieng ham noi bo.
  function exportCodes(result) { return result.people.map(p => p.employeeCode).sort(); }

  const adminExport = await getChecklistExportAccess(SESSIONS.admin);
  check(adminExport.role === 'admin' && adminExport.grant === null, 'Admin: export khong qua grant/scope, role=admin truc tiep');
  check(JSON.stringify(exportCodes(adminExport)) === JSON.stringify(['NV001', 'NV002', 'NV003', 'NV004']), 'Admin: export toan bo 4 nhan su (toan cong ty), got ' + exportCodes(adminExport).join(','));

  const tlgdExport = await getChecklistExportAccess(SESSIONS.tlgd);
  check(tlgdExport.grant.exportScope.type === 'all_company', 'Tro ly GD: exportScope.type = all_company, khong bi thu hep sai');
  check(JSON.stringify(exportCodes(tlgdExport)) === JSON.stringify(['NV001', 'NV002', 'NV003', 'NV004']), 'Tro ly GD: export toan bo 4 nhan su (all_company), got ' + exportCodes(tlgdExport).join(','));

  const tbpExport = await getChecklistExportAccess(SESSIONS.tbp);
  check(JSON.stringify(exportCodes(tbpExport)) === JSON.stringify(['NV001', 'NV002', 'NV004']), 'Truong bo phan: export dung 3 nguoi phong Ban hang (NV001/NV002/NV004), KHONG lo NV003 (Kho), got ' + exportCodes(tbpExport).join(','));

  const tcTaggedExport = await getChecklistExportAccess(SESSIONS.tcTagged);
  check(tcTaggedExport.grant.exportScope.type === 'department_branch', 'Truong ca (tagged): exportScope.type = department_branch (dung tag department::/branch::, dung hinh dang Production that)');
  check(JSON.stringify(exportCodes(tcTaggedExport)) === JSON.stringify(['NV001', 'NV002', 'NV004']), 'Truong ca (tagged): export dung department_branch TAGGED khop dung 3 nguoi (Ban hang x Phu Loi/Ngo Quyen/Lai Thieu), KHONG rong, KHONG lo NV003 (Kho), got ' + exportCodes(tcTaggedExport).join(','));

  const empExport = await getChecklistExportAccess(SESSIONS.exportEmployees);
  check(empExport.grant.exportScope.type === 'employees', 'Grant employees: exportScope.type = employees');
  check(JSON.stringify(exportCodes(empExport)) === JSON.stringify(['NV002', 'NV004']), 'Grant employees: export DUNG DUNG 2 nguoi duoc chon (NV002, NV004), KHONG phai ca phong ban Ban hang (se co ca NV001), got ' + exportCodes(empExport).join(','));

  const qlExport = await getChecklistExportAccess(SESSIONS.ql);
  check(qlExport.grant.exportScope.type === 'direct_reports', 'Quan ly truc tiep: engine ho tro direct_reports cho export_scope (khong rieng view/record/review)');
  check(JSON.stringify(exportCodes(qlExport)) === JSON.stringify(['NV002', 'NV003']), 'Quan ly truc tiep: export dung nguoi bao cao truc tiep QL01 (NV002, NV003), got ' + exportCodes(qlExport).join(','));

  const divergentExport = await getChecklistExportAccess(SESSIONS.exportDivergent);
  check(divergentExport.grant.viewScope.type === 'department' && divergentExport.grant.exportScope.type === 'branch', 'Grant divergent: viewScope (department) va exportScope (branch) la 2 truong doc lap, khac loai nhau tren cung 1 grant');
  check(JSON.stringify(exportCodes(divergentExport)) === JSON.stringify(['NV002']), 'Grant divergent: export CHI dung branch Ngo Quyen (NV002) - neu code nham dung view_scope=department se ra 3 nguoi (NV001/NV002/NV004), sai lech se lo ngay, got ' + exportCodes(divergentExport).join(','));

  let cxbcExportBlocked = false, cxbcExportCode = '';
  try { await getChecklistExportAccess(SESSIONS.cxbc); }
  catch (e) { cxbcExportBlocked = true; cxbcExportCode = e && e.code; }
  check(cxbcExportBlocked === true && cxbcExportCode === 'CHECKLIST_EXPORT_FORBIDDEN', 'Chi xem bao cao: khong co export_data -> backend CHAN THAT (403 CHECKLIST_EXPORT_FORBIDDEN), khong phai chi an nut frontend, got code=' + cxbcExportCode);

  if (failures) {
    console.error('\n' + failures + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

run().catch(e => { console.error('UNEXPECTED ERROR', e); process.exit(1); });
