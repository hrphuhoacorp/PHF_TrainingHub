'use strict';
/* Regression test for the "Tinh trang xu ly ghi nhan loi" dashboard backend
   (lib/checklist-reports.js getChecklistViolationWorkflowSummary). Stubs
   @supabase/supabase-js and ./checklist-permissions via the require cache
   (no network, no Production data touched) so this exercises the real
   aggregation logic: canReview/reviewScope gating (via
   getChecklistMonthlyReviewAccess, untouched) and the record_status +
   checklist_violation_tasks.status/due_at mapping into KPI buckets. */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const permissionsPath = require.resolve('../lib/checklist-permissions');
const reportsPath = require.resolve('../lib/checklist-reports');

let reviewAccess = { role: 'manager', canReview: false, grant: null, people: [] };
let violationRecords = [];
let taskRows = [];

function chain(result) {
  const obj = {
    select() { return obj; },
    eq() { return obj; },
    in() { return obj; },
    gte() { return obj; },
    lt() { return obj; },
    limit: async () => result
  };
  return obj;
}

require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true, exports: {
    createClient: () => ({
      from(table) {
        if (table === 'checklist_violation_records') return chain({ data: violationRecords, error: null });
        if (table === 'checklist_violation_tasks') return chain({ data: taskRows, error: null });
        return chain({ data: [], error: null });
      }
    })
  }
};

require.cache[permissionsPath] = {
  id: permissionsPath, filename: permissionsPath, loaded: true, exports: {
    getChecklistReportAccess: async () => ({ role: 'admin', people: [], canExport: true, grant: null }),
    getChecklistMonthlyReviewAccess: async () => reviewAccess
  }
};

const { getChecklistViolationWorkflowSummary } = require(reportsPath);
const fakeSession = { role: 'manager', account: { id: 'm1', name: 'Manager' } };

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}

async function run() {
  // 1. canReview:false (no review_monthly grant, e.g. CHI_XEM_BAO_CAO) -> no dashboard
  reviewAccess = { role: 'manager', canReview: false, grant: null, people: [] };
  const denied = await getChecklistViolationWorkflowSummary(fakeSession, {});
  check(denied.canReview === false, 'canReview:false -> dashboard reports canReview:false');
  check(denied.summary === null, 'canReview:false -> no summary payload');

  // 2. canReview:true but zero people in scope (edge case) -> zeroed summary, no crash
  reviewAccess = { role: 'manager', canReview: true, grant: { presetCode: 'TRUONG_CA_BH' }, people: [] };
  const empty = await getChecklistViolationWorkflowSummary(fakeSession, { month: '2026-08' });
  check(empty.canReview === true, 'canReview:true with empty scope -> still canReview:true');
  check(empty.summary && empty.summary.total === 0, 'empty scope -> total:0, no query attempted');

  // 3. Full aggregation math over a realistic mixed batch
  reviewAccess = {
    role: 'manager',
    canReview: true,
    grant: { presetCode: 'TRO_LY_GD' },
    people: [{ employeeCode: 'NV001' }, { employeeCode: 'NV002' }, { employeeCode: 'NV003' }]
  };
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
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  taskRows = [
    { violation_id: 'v1', status: 'waiting_employee', due_at: future },
    { violation_id: 'v2', status: 'waiting_employee_result', due_at: future },
    { violation_id: 'v3', status: 'waiting_reviewer', due_at: future },
    { violation_id: 'v4', status: 'waiting_admin', due_at: future },
    { violation_id: 'v5', status: 'completed', due_at: past },
    { violation_id: 'v6', status: 'waiting_reviewer', due_at: past }
    // v7, v8 cancelled -> excluded from officialIds -> no task lookup expected for them
  ];
  const result = await getChecklistViolationWorkflowSummary(fakeSession, { month: '2026-08' });
  check(result.canReview === true, 'full case -> canReview:true');
  check(result.summary.total === 8, 'total = 8 (6 official + 2 cancelled), got ' + result.summary.total);
  check(result.summary.official === 6, 'official = 6, got ' + result.summary.official);
  check(result.summary.cancelled === 2, 'cancelled = 2, got ' + result.summary.cancelled);
  check(result.summary.waitingEmployee === 2, 'waitingEmployee = 2 (v1 waiting_employee + v2 waiting_employee_result), got ' + result.summary.waitingEmployee);
  check(result.summary.inExplanation === 3, 'inExplanation = 3 (v3 waiting_reviewer + v4 waiting_admin + v6 waiting_reviewer), got ' + result.summary.inExplanation);
  check(result.summary.overdue === 1, 'overdue = 1 (only v6: waiting_reviewer + due_at in the past; v5 excluded because completed), got ' + result.summary.overdue);
  check(result.month === '2026-08', 'month echoes requested period');
  check(result.scope && result.scope.presetCode === 'TRO_LY_GD' && result.scope.count === 3, 'scope reflects reviewScope role/preset/count, not a hardcoded value');

  if (failures) {
    console.error(failures + ' check(s) failed.');
    process.exit(1);
  }
  console.log('All checks passed.');
}

run().catch(e => { console.error('UNEXPECTED ERROR', e); process.exit(1); });
