'use strict';
/* Regression test for getChecklistViolationTaskStatus (lib/checklist-violations.js) -
   the "Tình trạng xử lý" cell added to the Nhật ký lỗi detail modal. Stubs
   @supabase/supabase-js via the require cache (no network, no Production data
   touched) and exercises the real permission gate (admin bypass, learner
   self-only) plus the not-found and no-linked-task cases. */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const violationsPath = require.resolve('../lib/checklist-violations');

let violationRow = null;
let taskRow = null;

const assignmentRows = [
  { employee_code: 'NV001', employee_name: 'Nhan vien 001', department: 'Ban hang', branch: 'Ngo Quyen', manager_id: '', manager_code: '', employee_status: 'Đang làm việc' },
  { employee_code: 'NV999', employee_name: 'Nhan vien 999', department: 'Ban hang', branch: 'Phu Loi', manager_id: '', manager_code: '', employee_status: 'Đang làm việc' }
];

function recordChain() {
  const obj = { select() { return obj; }, eq() { return obj; }, maybeSingle: async () => ({ data: violationRow, error: null }) };
  return obj;
}
function taskChain() {
  const obj = { select() { return obj; }, eq() { return obj; }, order() { return obj; }, limit() { return obj; }, maybeSingle: async () => ({ data: taskRow, error: null }) };
  return obj;
}
function assignmentChain() {
  // permissionAssignmentRows() awaits the query directly (no maybeSingle) -
  // make the chain itself thenable so `await` resolves it.
  const obj = { select() { return obj; }, neq() { return obj; }, limit() { return obj; }, then(resolve) { resolve({ data: assignmentRows, error: null }); } };
  return obj;
}

require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true, exports: {
    createClient: () => ({
      from(table) {
        if (table === 'checklist_violation_records') return recordChain();
        if (table === 'checklist_violation_tasks') return taskChain();
        if (table === 'checklist_employee_assignments') return assignmentChain();
        return recordChain();
      }
    })
  }
};

const { getChecklistViolationTaskStatus } = require(violationsPath);

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}

async function run() {
  const adminSession = { role: 'admin', sub: 'admin-1', account: { id: 'admin-1', name: 'Admin' } };

  // 1. Missing id -> 400
  try {
    await getChecklistViolationTaskStatus(adminSession, {});
    check(false, 'missing id throws');
  } catch (e) {
    check(e.statusCode === 400 && e.code === 'CHECKLIST_VIOLATION_ID_REQUIRED', 'missing id -> 400 CHECKLIST_VIOLATION_ID_REQUIRED (got ' + e.statusCode + '/' + e.code + ')');
  }

  // 2. Record not found -> 404 (getRecord's own guard)
  violationRow = null;
  try {
    await getChecklistViolationTaskStatus(adminSession, { id: 'missing-id' });
    check(false, 'missing record throws');
  } catch (e) {
    check(e.statusCode === 404 && e.code === 'CHECKLIST_VIOLATION_NOT_FOUND', 'missing record -> 404 CHECKLIST_VIOLATION_NOT_FOUND (got ' + e.statusCode + '/' + e.code + ')');
  }

  // 3. Record exists, no linked task (e.g. cancelled before a task was ever created) -> task:null, no crash
  violationRow = { id: 'v1', employee_code: 'NV001', record_status: 'cancelled' };
  taskRow = null;
  const noTask = await getChecklistViolationTaskStatus(adminSession, { id: 'v1' });
  check(noTask.task === null, 'record with no linked task -> task:null (not an error)');

  // 4. Record with a linked task -> real fields pass through unchanged
  violationRow = { id: 'v2', employee_code: 'NV001', record_status: 'official' };
  taskRow = { id: 't1', status: 'waiting_reviewer', due_at: '2026-08-10T00:00:00.000Z', completed_at: null, current_assignee_type: 'creator', updated_at: '2026-08-05T00:00:00.000Z' };
  const withTask = await getChecklistViolationTaskStatus(adminSession, { id: 'v2' });
  check(withTask.task && withTask.task.status === 'waiting_reviewer', 'admin viewing record with task -> real status returned (got ' + (withTask.task && withTask.task.status) + ')');
  check(withTask.task.due_at === '2026-08-10T00:00:00.000Z', 'due_at passed through unchanged');

  // 5. Employee (learner) viewing their OWN record -> allowed
  const ownerSession = { role: 'learner', employeeCode: 'NV001', account: { id: 'emp-1', name: 'NV001' } };
  const own = await getChecklistViolationTaskStatus(ownerSession, { id: 'v2' });
  check(own.task && own.task.status === 'waiting_reviewer', 'employee viewing own record -> allowed, real status returned');

  // 6. Employee viewing SOMEONE ELSE's record -> 403, no data leaked
  const otherSession = { role: 'learner', employeeCode: 'NV999', account: { id: 'emp-2', name: 'NV999' } };
  try {
    await getChecklistViolationTaskStatus(otherSession, { id: 'v2' });
    check(false, 'employee viewing another employee\'s record throws');
  } catch (e) {
    check(e.statusCode === 403, 'employee viewing another employee\'s record -> 403 (got ' + e.statusCode + ')');
  }

  if (failures) {
    console.error(failures + ' check(s) failed.');
    process.exit(1);
  }
  console.log('All checks passed.');
}

run().catch(e => { console.error('UNEXPECTED ERROR', e); process.exit(1); });
