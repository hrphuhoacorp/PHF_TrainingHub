'use strict';
/* Regression test for the "Tinh trang xu ly ghi nhan loi" dashboard backend
   (lib/checklist-reports.js getChecklistViolationWorkflowSummary). Stubs
   @supabase/supabase-js and ./checklist-permissions via the require cache
   (no network, no Production data touched). lib/checklist-violations.js is
   NOT stubbed - it runs for real against the mocked supabase client, so this
   also exercises resolveViolationPermission()/permissionEmployees() (the
   SAME viewScope resolution Nhat ky loi uses via listChecklistViolations()),
   plus the record_status + checklist_violation_tasks.status/due_at mapping
   into KPI buckets (waitingEmployee/inExplanation/waitingAdmin/overdue/
   dueSoon/open). */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const permissionsPath = require.resolve('../api/_lib/checklist-permissions');
const reportsPath = require.resolve('../api/_lib/checklist-reports');

let grantRows = [];
let assignmentRows = [];
let violationRecords = [];
let taskRows = [];
let timingPolicySetting = { setting_value: JSON.stringify({ employeeResponseDays: 3, reviewerResponseDays: 3, monthlyCutoffDay: 4, monthlyCutoffTime: '23:59', adminAfterLock: 'controlled', effectiveFromPeriod: '2026-08' }) };

function chain(result) {
  const obj = {
    select() { return obj; },
    eq() { return obj; },
    neq() { return obj; },
    in() { return obj; },
    gte() { return obj; },
    lt() { return obj; },
    lte() { return obj; },
    or() { return obj; },
    order() { return obj; },
    limit: async () => result,
    maybeSingle: async () => result
  };
  return obj;
}

require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true, exports: {
    createClient: () => ({
      from(table) {
        if (table === 'checklist_violation_records') return chain({ data: violationRecords, error: null });
        if (table === 'checklist_violation_tasks') return chain({ data: taskRows, error: null });
        if (table === 'checklist_permission_grants') return chain({ data: grantRows, error: null });
        if (table === 'checklist_employee_assignments') return chain({ data: assignmentRows, error: null });
        if (table === 'checklist_system_settings') return chain({ data: timingPolicySetting, error: null });
        return chain({ data: [], error: null });
      }
    })
  }
};

require.cache[permissionsPath] = {
  id: permissionsPath, filename: permissionsPath, loaded: true, exports: {
    getChecklistReportAccess: async () => ({ role: 'admin', people: [], canExport: true, grant: null })
  }
};

const { getChecklistViolationWorkflowSummary } = require(reportsPath);
const fakeSession = { role: 'manager', account: { id: 'm1', name: 'Manager' } };

function activeGrant(viewScope, overrides = {}) {
  return {
    account_id: 'm1',
    employee_code: '',
    preset_code: overrides.presetCode || 'TUY_CHINH',
    capabilities: { view_violations: true, ...overrides.capabilities },
    view_scope: viewScope,
    effective_from: '2020-01-01',
    effective_to: null,
    updated_at: '2026-01-01'
  };
}

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}

async function run() {
  // 1. No active view_violations grant -> no dashboard (mirrors requireViolationPermission
  //    denial that also blocks Nhat ky loi's listChecklistViolations for the same account).
  grantRows = [];
  assignmentRows = [];
  const denied = await getChecklistViolationWorkflowSummary(fakeSession, {});
  check(denied.canView === false, 'no view_violations grant -> canView:false');
  check(denied.summary === null, 'canView:false -> no summary payload');

  // 2. canView:true but scope resolves to zero people in scope (e.g. department scope with
  //    no matching assignment rows) -> zeroed summary, no crash, no query against records.
  grantRows = [activeGrant({ type: 'department', values: ['Phong khong ton tai'] }, { presetCode: 'TRUONG_BO_PHAN' })];
  assignmentRows = [];
  const empty = await getChecklistViolationWorkflowSummary(fakeSession, { month: '2026-08' });
  check(empty.canView === true, 'canView:true with empty resolved scope -> still canView:true');
  check(empty.summary && empty.summary.total === 0, 'empty scope -> total:0, no query attempted');

  // 3. Full aggregation math over a realistic mixed batch, scopeType 'all' (all_company
  //    viewScope, e.g. Tro ly GD) so the records query is NOT filtered by employee_code -
  //    same scope Nhat ky loi resolves to for this preset via requireViolationPermission('view').
  grantRows = [activeGrant({ type: 'all_company', values: [] }, { presetCode: 'TRO_LY_GD' })];
  assignmentRows = [];
  violationRecords = [
    { id: 'v1', record_status: 'official' },   // waiting_employee
    { id: 'v2', record_status: 'official' },   // waiting_employee_result
    { id: 'v3', record_status: 'official' },   // waiting_reviewer (in explanation)
    { id: 'v4', record_status: 'official' },   // waiting_admin (in explanation)
    { id: 'v5', record_status: 'official' },   // completed, overdue due_at but excluded (completed)
    { id: 'v6', record_status: 'official' },   // waiting_reviewer AND overdue (counts in both, additive)
    { id: 'v7', record_status: 'cancelled' },  // cancelled, no task
    { id: 'v8', record_status: 'cancelled' }   // cancelled, no task
  ];
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(); // outside the 3-day dueSoon window
  const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(); // inside the 3-day dueSoon window
  taskRows = [
    { violation_id: 'v1', status: 'waiting_employee', due_at: inTwoDays },
    { violation_id: 'v2', status: 'waiting_employee_result', due_at: future },
    { violation_id: 'v3', status: 'waiting_reviewer', due_at: future },
    { violation_id: 'v4', status: 'waiting_admin', due_at: future },
    { violation_id: 'v5', status: 'completed', due_at: past },
    { violation_id: 'v6', status: 'waiting_reviewer', due_at: past }
    // v7, v8 cancelled -> excluded from officialIds -> no task lookup expected for them
  ];
  const result = await getChecklistViolationWorkflowSummary(fakeSession, { month: '2026-08' });
  check(result.canView === true, 'full case -> canView:true');
  check(result.summary.total === 8, 'total = 8 (6 official + 2 cancelled), got ' + result.summary.total);
  check(result.summary.official === 6, 'official = 6, got ' + result.summary.official);
  check(result.summary.cancelled === 2, 'cancelled = 2, got ' + result.summary.cancelled);
  check(result.summary.waitingEmployee === 2, 'waitingEmployee = 2 (v1 waiting_employee + v2 waiting_employee_result), got ' + result.summary.waitingEmployee);
  check(result.summary.inExplanation === 3, 'inExplanation = 3 (v3 waiting_reviewer + v4 waiting_admin + v6 waiting_reviewer), got ' + result.summary.inExplanation);
  check(result.summary.waitingAdmin === 1, 'waitingAdmin = 1 (only v4), got ' + result.summary.waitingAdmin);
  check(result.summary.overdue === 1, 'overdue = 1 (only v6: waiting_reviewer + due_at in the past; v5 excluded because completed), got ' + result.summary.overdue);
  check(result.summary.dueSoon === 1, 'dueSoon = 1 (only v1: due within 3 calendar days, not overdue, not completed), got ' + result.summary.dueSoon);
  check(result.summary.open === 5, 'open = 5 (v1,v2,v3,v4,v6 - task not completed/cancelled; v5 excluded because completed), got ' + result.summary.open);
  check(result.month === '2026-08', 'month echoes requested period');
  check(result.scope && result.scope.scopeType === 'all_company' && result.scope.count === null, 'scope reflects resolved viewScope (all_company, canonical type - not renamed/hardcoded)');

  // 4. dueSoon must track the CONFIGURED operationTimingPolicy, not a hardcoded 3-day window.
  //    reviewerResponseDays=1 here: a waiting_reviewer task due in 2 days must NOT be dueSoon
  //    (it would incorrectly be dueSoon under a hardcoded 3-day rule).
  timingPolicySetting = { setting_value: JSON.stringify({ employeeResponseDays: 5, reviewerResponseDays: 1, monthlyCutoffDay: 4, monthlyCutoffTime: '23:59', adminAfterLock: 'controlled', effectiveFromPeriod: '2026-08' }) };
  grantRows = [activeGrant({ type: 'all_company', values: [] }, { presetCode: 'TRO_LY_GD' })];
  violationRecords = [
    { id: 'p1', record_status: 'official' }, // waiting_employee, due in 4 days -> dueSoon under employeeResponseDays=5, NOT under a hardcoded 3
    { id: 'p2', record_status: 'official' }  // waiting_reviewer, due in 2 days -> NOT dueSoon under reviewerResponseDays=1, WOULD be under a hardcoded 3
  ];
  const inFourDays = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();
  const inTwoDaysAgain = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  taskRows = [
    { violation_id: 'p1', status: 'waiting_employee', due_at: inFourDays },
    { violation_id: 'p2', status: 'waiting_reviewer', due_at: inTwoDaysAgain }
  ];
  const policyResult = await getChecklistViolationWorkflowSummary(fakeSession, { month: '2026-08' });
  check(policyResult.summary.dueSoon === 1, 'dueSoon = 1 (only p1: employeeResponseDays=5 covers a 4-day-out due date; p2 excluded because reviewerResponseDays=1 does not cover 2 days out) - proves dueSoon reads operationTimingPolicy dynamically, got ' + policyResult.summary.dueSoon);

  if (failures) {
    console.error(failures + ' check(s) failed.');
    process.exit(1);
  }
  console.log('All checks passed.');
}

run().catch(e => { console.error('UNEXPECTED ERROR', e); process.exit(1); });
