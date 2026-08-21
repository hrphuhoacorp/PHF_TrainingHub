'use strict';
/* Batch "notification-violation-detail-modal" - proves getChecklistViolationDetail()
   (lib/checklist-tasks.js) resolves permission per actor<->record relationship
   (isSubject/isCreator/sameActor - the SAME helpers getChecklistTaskHistory()
   already uses, not a new grant-based engine) and never leaks a record the
   actor is not allowed to see, using a real in-memory Postgrest-like mock so
   the actual .in()/.select() filters run for real (not canned responses).

   Same mocking technique as scripts/test-checklist-violation-permission-scope.js
   (smaller fixture, scoped to this one function only).

   No real Supabase project, no Production data. lib/checklist-tasks.js runs
   for real against this mocked client.

   File này KHÔNG được gọi tự động ở bất kỳ đâu - chỉ chạy thủ công:
     node scripts/test-checklist-violation-detail-permission.js
*/
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const tasksPath = require.resolve('../api/_lib/checklist-tasks');

function tableQuery(getRows) {
  const filters = [];
  let orderField = null, orderAsc = true;
  const q = {
    select() { return q; },
    in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
    eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
    order(field, opts) { orderField = field; orderAsc = !(opts && opts.ascending === false); return q; },
    then(resolve, reject) {
      try {
        let matched = getRows().filter(r => filters.every(fn => fn(r)));
        if (orderField) matched = matched.slice().sort((a, b) => {
          const av = a[orderField], bv = b[orderField];
          return (av < bv ? -1 : av > bv ? 1 : 0) * (orderAsc ? 1 : -1);
        });
        resolve({ data: matched, error: null });
      } catch (e) { (reject || (err => Promise.reject(err)))(e); }
    }
  };
  return q;
}

// ---------------------------------------------------------------------------
// Fixture: 3 violations, 2 with a linked task, 1 without (violation without a
// task must still resolve permission from the violation row itself - isSubject/
// isCreator do not require a task to exist).
// ---------------------------------------------------------------------------
const VIOLATIONS = [
  { id: 'v1', employee_id: 'emp-e1', employee_code: 'E1', employee_name: 'Nguyen Van E1', department: 'Bán hàng', branch: 'Ngô Quyền', title: '', template_id: 't1', template_version: 'T1', template_name: 'Checklist QTTH', criterion_code: 'CT-01', criterion_name: 'Đồng phục', criterion_group: 'Tác phong', points: 5, occurred_date: '2026-08-05', occurred_time: '09:00', location: 'Ngô Quyền', note: 'Thiếu bảng tên', record_status: 'official', is_test: false, created_by: 'u-mgr1', created_by_name: 'QL Một', created_at: '2026-08-05T09:00:00Z', cancelled_by_name: '', cancelled_at: '', cancel_reason: '' },
  { id: 'v2', employee_id: 'emp-e2', employee_code: 'E2', employee_name: 'Tran Thi E2', department: 'Bán hàng', branch: 'Phú Lợi', title: '', template_id: 't1', template_version: 'T1', template_name: 'Checklist QTTH', criterion_code: 'CT-02', criterion_name: 'Vệ sinh quầy', criterion_group: 'Vận hành', points: 3, occurred_date: '2026-08-06', occurred_time: '10:00', location: 'Phú Lợi', note: 'Chưa dọn quầy', record_status: 'official', is_test: false, created_by: 'u-mgr2', created_by_name: 'QL Hai', created_at: '2026-08-06T10:00:00Z', cancelled_by_name: '', cancelled_at: '', cancel_reason: '' },
  { id: 'v3', employee_id: 'emp-e3', employee_code: 'E3', employee_name: 'Le Van E3', department: 'Kho', branch: 'Lái Thiêu', title: '', template_id: 't2', template_version: 'T2', template_name: 'Checklist Kho', criterion_code: 'CT-03', criterion_name: 'Sắp xếp hàng hóa', criterion_group: 'Vận hành', points: 2, occurred_date: '2026-08-07', occurred_time: '11:00', location: 'Lái Thiêu', note: 'Hàng để lộn xộn', record_status: 'official', is_test: false, created_by: 'u-mgr1', created_by_name: 'QL Một', created_at: '2026-08-07T11:00:00Z', cancelled_by_name: '', cancelled_at: '', cancel_reason: '' }
];
const TASKS = [
  { id: 'task-v1', violation_id: 'v1', status: 'waiting_employee', current_assignee_id: 'u-mgr1', current_assignee_code: 'MGR1', current_assignee_type: 'creator', current_assignee_name: 'QL Một', due_at: '2099-01-01T00:00:00Z', created_by: 'u-mgr1', created_by_name: 'QL Một', created_at: '2026-08-05T09:00:01Z' },
  { id: 'task-v2', violation_id: 'v2', status: 'waiting_reviewer', current_assignee_id: 'u-mgr3', current_assignee_code: 'MGR3', current_assignee_type: 'reviewer', current_assignee_name: 'QL Ba', due_at: '2099-01-01T00:00:00Z', created_by: 'u-mgr2', created_by_name: 'QL Hai', created_at: '2026-08-06T10:00:01Z' }
  // v3 has no linked task on purpose.
];
const TASK_HISTORY = [
  { id: 'h1', task_id: 'task-v1', action: 'created', actor_name: 'Hệ thống', note: '', created_at: '2026-08-05T09:00:01Z' },
  { id: 'h2', task_id: 'task-v2', action: 'employee_explain', actor_name: 'Tran Thi E2', note: 'Tôi đã dọn nhưng chưa kịp cập nhật ảnh.', created_at: '2026-08-06T12:00:00Z' }
];

function buildSupabaseMock() {
  return {
    createClient() {
      return {
        from(table) {
          if (table === 'checklist_violation_records') return tableQuery(() => VIOLATIONS);
          if (table === 'checklist_violation_tasks') return tableQuery(() => TASKS);
          if (table === 'checklist_violation_task_history') return tableQuery(() => TASK_HISTORY);
          throw new Error('Unexpected table in mock: ' + table);
        }
      };
    }
  };
}

function loadTasksLibWithMock() {
  const Module = require('module');
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === '@supabase/supabase-js') return supabasePath;
    return originalResolve.call(this, request, ...rest);
  };
  const originalCache = require.cache[supabasePath];
  delete require.cache[supabasePath];
  delete require.cache[tasksPath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock()
  };
  const lib = require(tasksPath);
  Module._resolveFilename = originalResolve;
  if (originalCache) require.cache[supabasePath] = originalCache; else delete require.cache[supabasePath];
  return lib;
}

const { getChecklistViolationDetail } = loadTasksLibWithMock();

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}

function session(role, opts) {
  opts = opts || {};
  return { role, account: { id: opts.id || '', name: opts.name || '' }, employeeCode: opts.employeeCode || '', sub: opts.id || '' };
}

async function run() {
  // ---------- 1. Nhân viên tự xem lỗi của chính mình (isSubject) - không cần bất kỳ grant nào ----------
  let result = await getChecklistViolationDetail(session('learner', { employeeCode: 'E1' }), { violationIds: ['v1'] });
  check(result.items.length === 1 && result.items[0].violation.id === 'v1', '1a. Nhân viên E1 (role learner, không có Checklist grant nào) vẫn xem được đúng lỗi v1 của chính mình - quyền nền cá nhân luôn áp dụng');
  check(result.deniedCount === 0, '1b. Không có lỗi nào bị từ chối khi tự xem đúng lỗi của mình');
  check(result.items[0].history.length === 1 && result.items[0].history[0].action === 'created', '1c. Trả kèm đúng lịch sử xử lý (task_id đúng, không lẫn lịch sử của bản ghi khác)');

  // ---------- 2. Nhân viên KHÔNG xem được lỗi của người khác (không leak) ----------
  result = await getChecklistViolationDetail(session('learner', { employeeCode: 'E1' }), { violationIds: ['v1', 'v2'] });
  check(result.items.length === 1 && result.items[0].violation.id === 'v1', '2a. E1 yêu cầu cả v1 (của mình) và v2 (của E2) -> chỉ trả về v1');
  check(result.deniedCount === 1, '2b. v2 bị đếm vào deniedCount (không âm thầm bỏ qua, cũng không throw làm hỏng cả request)');
  check(!JSON.stringify(result.items).includes('E2') && !JSON.stringify(result.items).includes('Vệ sinh quầy'), '2c. Không leak bất kỳ trường nào của v2 (không có tên/tiêu chí của E2 trong response)');

  // ---------- 3. Người tạo bản ghi (isCreator) xem được, kể cả lỗi không có task (v3) ----------
  result = await getChecklistViolationDetail(session('manager', { id: 'u-mgr1', employeeCode: 'MGR1' }), { violationIds: ['v1', 'v3'] });
  check(result.items.length === 2, '3a. Người ghi nhận (created_by=u-mgr1) xem được cả v1 và v3 - đều do chính mình ghi');
  check(result.items.find(x => x.violation.id === 'v3').task === null, '3b. v3 không có task liên kết vẫn trả về đúng (task:null), không crash - permission tự resolve từ chính bản ghi violation');

  // ---------- 4. Current assignee (reviewer đang phải phản hồi giải trình - sameActor) xem được ----------
  result = await getChecklistViolationDetail(session('manager', { id: 'u-mgr3', employeeCode: 'MGR3' }), { violationIds: ['v2'] });
  check(result.items.length === 1 && result.items[0].violation.id === 'v2', '4a. Reviewer hiện đang được assign (current_assignee_id=u-mgr3, nhận EXPLANATION_SUBMITTED) xem được v2');
  check(result.items[0].history[0].note.includes('dọn nhưng chưa kịp'), '4b. Thấy đúng nội dung giải trình gần nhất của nhân viên trong lịch sử');

  // ---------- 5. Người không liên quan (không phải subject/creator/assignee) -> denied hoàn toàn ----------
  result = await getChecklistViolationDetail(session('manager', { id: 'u-outsider', employeeCode: 'OUTSIDER' }), { violationIds: ['v1', 'v2', 'v3'] });
  check(result.items.length === 0 && result.deniedCount === 3, '5a. Manager không liên quan gì tới cả 3 lỗi -> items rỗng, deniedCount=3 (không phải throw 403 làm crash toàn bộ notification click)');

  // ---------- 6. Admin luôn xem được tất cả ----------
  result = await getChecklistViolationDetail(session('admin', { id: 'u-admin' }), { violationIds: ['v1', 'v2', 'v3'] });
  check(result.items.length === 3, '6a. Admin xem được cả 3 lỗi bất kể subject/creator/assignee');

  // ---------- 7. Input validation ----------
  let threw = false;
  try { await getChecklistViolationDetail(session('admin', { id: 'u-admin' }), { violationIds: [] }); }
  catch (err) { threw = err && err.code === 'CHECKLIST_VIOLATION_DETAIL_ID_REQUIRED'; }
  check(threw, '7a. Không truyền violationIds -> báo lỗi rõ CHECKLIST_VIOLATION_DETAIL_ID_REQUIRED, không query rỗng/không crash mơ hồ');

  result = await getChecklistViolationDetail(session('admin', { id: 'u-admin' }), { violationIds: ['v-not-exist'] });
  check(result.items.length === 0 && result.deniedCount === 0 && result.totalRequested === 1, '7b. Id không tồn tại -> trả rỗng, không phải deniedCount (khác nghĩa với "không đủ quyền") - không crash');

  if (failures) {
    console.error('\n' + failures + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nALL PASS');
}

run().catch(err => { console.error('UNCAUGHT', err); process.exit(1); });
