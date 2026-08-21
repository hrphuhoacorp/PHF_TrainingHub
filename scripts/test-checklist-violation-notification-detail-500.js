'use strict';
/*
 * Regression Test — UAT Production: Notification "Xem lỗi" -> modal "Chi tiết lỗi
 * Checklist" trả HTTP 500 cho TBP (Chrome console: POST /api/data?checklistTasks=1
 * -> 500, body "Hệ thống chưa thể xử lý yêu cầu. Vui lòng thử lại.").
 *
 * ROOT CAUSE xác nhận qua trace (KHÔNG suy đoán): getChecklistViolationDetail()
 * (lib/checklist-tasks.js) select() 4 cột KHÔNG TỒN TẠI trên schema thật:
 *   - checklist_violation_records: department, branch, title
 *     (bảng này CHƯA BAO GIỜ có 3 cột này - xem scripts/PHF_CHECKLIST_VIOLATIONS_TEST_1.7.106.sql
 *     + toàn bộ ALTER TABLE sau đó; nơi khác trong app (lib/checklist-violations.js
 *     listChecklistViolations) lấy department/branch từ checklist_employee_assignments
 *     qua permissionEmployees(), KHÔNG phải từ chính bảng violation)
 *   - checklist_violation_tasks: current_assignee_name (không có trong
 *     scripts/PHF_CHECKLIST_TASKS_STEP_1_1.23.sql, không dùng ở bất kỳ đâu khác)
 * Postgrest trả lỗi "column ... does not exist" (không có statusCode riêng của
 * app) -> lib/request-guard.js publicError() rơi vào nhánh mặc định 500 với đúng
 * message evidence. KHÔNG liên quan permission/role/current-org/score/monthly-cycle;
 * lỗi này 500 cho MỌI actor gọi getChecklistViolationDetail(), bất kể quyền gì -
 * TBP chỉ là người đầu tiên bấm vào flow này trên Production.
 *
 * Modal có gọi sai endpoint không: KHÔNG. "?checklistTasks=1" trong URL chỉ là
 * chuỗi query string trang trí phía client (server không đọc query param này để
 * routing) - action thật trong body JSON luôn là 'getChecklistViolationDetail',
 * đúng kiến trúc đã chốt (đọc violation detail, không load toàn bộ task list).
 *
 * Test này dùng MOCK Postgrest "biết schema thật" (allow-list cột lấy trực tiếp
 * từ các file SQL trong scripts/) - khác test cũ scripts/test-checklist-violation-
 * detail-permission.js vốn có select() no-op (không phát hiện được cột ma vì
 * không mô phỏng hành vi "column does not exist" của Postgrest thật - đây chính
 * là lý do bug lọt qua CI trước đó). Nếu sau này có ai vô tình thêm lại một cột
 * không tồn tại vào các query trong file này, test sẽ FAIL ngay với đúng thông
 * điệp lỗi Postgrest, thay vì im lặng pass như trước.
 *
 * In-memory only — No Production Database — Safe for future verification.
 * File này KHÔNG được gọi tự động ở bất kỳ đâu — chỉ chạy thủ công:
 *   node scripts/test-checklist-violation-notification-detail-500.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const tasksPath = require.resolve('../api/_lib/checklist-tasks');

// ---------------------------------------------------------------------------
// Allow-list cột THẬT của từng bảng, lấy trực tiếp từ SQL đã chạy Production
// (create table + toàn bộ "alter table ... add column" tìm được trong scripts/).
// KHÔNG chấp nhận cột nào ngoài danh sách này — mô phỏng đúng hành vi Postgrest
// "column ... does not exist" khi select() yêu cầu cột lạ.
// ---------------------------------------------------------------------------
const REAL_COLUMNS = {
  checklist_violation_records: new Set([
    'id', 'employee_id', 'employee_code', 'employee_name', 'template_id', 'template_version',
    'template_name', 'criterion_id', 'criterion_code', 'criterion_name', 'criterion_group',
    'factor', 'points', 'late_standard_points', 'late_adjustment_reason', 'late_adjusted_by',
    'late_adjusted_by_name', 'late_adjusted_at', 'occurred_date', 'occurred_time', 'location',
    'note', 'evidence_required', 'has_evidence', 'record_status', 'is_test', 'test_batch_id',
    'request_id', 'duplicate_fingerprint', 'created_by', 'created_by_name', 'created_at',
    'updated_by', 'updated_by_name', 'updated_at', 'cancelled_by', 'cancelled_by_name',
    'cancelled_at', 'cancel_reason', 'change_count'
  ]),
  checklist_violation_tasks: new Set([
    'id', 'violation_id', 'employee_id', 'employee_code', 'employee_name', 'created_by',
    'created_by_name', 'current_assignee_id', 'current_assignee_code', 'current_assignee_type',
    'status', 'priority', 'due_at', 'completed_at', 'created_at', 'updated_at'
  ]),
  checklist_violation_task_history: new Set([
    'id', 'task_id', 'violation_id', 'action', 'note', 'actor_id', 'actor_code', 'actor_name', 'created_at'
  ])
};

function parseSelectColumns(selectArg) {
  // Đủ dùng cho các query trong getChecklistViolationDetail()/listChecklistTasks()
  // ở đây: chuỗi cột phân tách bằng dấu phẩy, bỏ qua phần embed quan hệ
  // "alias:table(...)" nếu có (không phải cột thật của chính bảng đang select).
  const text = String(selectArg || '');
  const out = [];
  let depth = 0, current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(current); current = ''; continue; }
    current += ch;
  }
  if (current) out.push(current);
  return out.map(s => s.trim()).filter(Boolean)
    .filter(s => !s.includes('(')) // bỏ field embed quan hệ dạng alias:table(...)
    .map(s => s.split(':').pop().trim())
    .filter(s => s !== '*');
}

function tableQuery(table, getRows) {
  const filters = [];
  let orderField = null, orderAsc = true, selectedColumns = null, limitN = null, single = null;
  const q = {
    select(fields) { selectedColumns = parseSelectColumns(fields); return q; },
    in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
    eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
    or() { return q; },
    order(field, opts) { orderField = field; orderAsc = !(opts && opts.ascending === false); return q; },
    limit(n) { limitN = n; return q; },
    maybeSingle() { single = 'maybe'; return q; },
    then(resolve, reject) {
      try {
        const known = REAL_COLUMNS[table];
        if (known && selectedColumns) {
          const bogus = selectedColumns.find(col => !known.has(col));
          if (bogus) {
            resolve({ data: null, error: { message: `column ${table}.${bogus} does not exist`, code: '42703' } });
            return;
          }
        }
        let matched = getRows().filter(r => filters.every(fn => fn(r)));
        if (orderField) matched = matched.slice().sort((a, b) => {
          const av = a[orderField], bv = b[orderField];
          return (av < bv ? -1 : av > bv ? 1 : 0) * (orderAsc ? 1 : -1);
        });
        if (limitN != null) matched = matched.slice(0, limitN);
        if (single === 'maybe') { resolve({ data: matched[0] || null, error: null }); return; }
        resolve({ data: matched, error: null });
      } catch (e) { (reject || (err => Promise.reject(err)))(e); }
    }
  };
  return q;
}

// ---------------------------------------------------------------------------
// Fixture: TBP (manager) đang là current_assignee của v1 (giống tình huống UAT —
// TBP bấm "Xem lỗi" từ notification vì đang phải xử lý lỗi này). v2 thuộc phạm
// vi nhân viên khác, TBP không liên quan -> phải bị deny an toàn, không leak.
// ---------------------------------------------------------------------------
const VIOLATIONS = [
  { id: 'v1', employee_id: 'emp-e1', employee_code: 'E1', employee_name: 'Nguyen Van E1', template_id: 't1', template_version: 'T1', template_name: 'Checklist QTTH', criterion_code: 'CT-01', criterion_name: 'Đồng phục', criterion_group: 'Tác phong', points: 5, occurred_date: '2026-08-05', occurred_time: '09:00', location: 'Ngô Quyền', note: 'Thiếu bảng tên', record_status: 'official', is_test: false, created_by: 'u-mgr1', created_by_name: 'TBP Một', created_at: '2026-08-05T09:00:00Z', cancelled_by_name: '', cancelled_at: '', cancel_reason: '' },
  { id: 'v2', employee_id: 'emp-e2', employee_code: 'E2', employee_name: 'Tran Thi E2', template_id: 't1', template_version: 'T1', template_name: 'Checklist QTTH', criterion_code: 'CT-02', criterion_name: 'Vệ sinh quầy', criterion_group: 'Vận hành', points: 3, occurred_date: '2026-08-06', occurred_time: '10:00', location: 'Phú Lợi', note: 'Chưa dọn quầy', record_status: 'official', is_test: false, created_by: 'u-mgr2', created_by_name: 'TBP Hai', created_at: '2026-08-06T10:00:00Z', cancelled_by_name: '', cancelled_at: '', cancel_reason: '' }
];
const TASKS = [
  { id: 'task-v1', violation_id: 'v1', status: 'waiting_reviewer', current_assignee_id: 'u-tbp1', current_assignee_code: 'TBP1', current_assignee_type: 'reviewer', due_at: '2099-01-01T00:00:00Z', created_by: 'u-mgr1', created_by_name: 'TBP Một', created_at: '2026-08-05T09:00:01Z' },
  { id: 'task-v2', violation_id: 'v2', status: 'waiting_employee', current_assignee_id: 'emp-e2', current_assignee_code: 'E2', current_assignee_type: 'employee', due_at: '2099-01-01T00:00:00Z', created_by: 'u-mgr2', created_by_name: 'TBP Hai', created_at: '2026-08-06T10:00:01Z' }
];
const TASK_HISTORY = [
  { id: 'h1', task_id: 'task-v1', action: 'employee_explain', note: 'Đã bổ sung bảng tên, xin xem lại.', actor_name: 'Nguyen Van E1', created_at: '2026-08-05T12:00:00Z' }
];
const SYSTEM_SETTINGS = [
  { setting_key: 'monthly_self_overdue_policy', setting_value: JSON.stringify({ employeeResponseDays: 3, reviewerResponseDays: 3, monthlyCutoffDay: 4, monthlyCutoffTime: '23:59', adminAfterLock: 'controlled', effectiveFromPeriod: '2026-08' }) }
];

function buildSupabaseMock() {
  return {
    createClient() {
      return {
        from(table) {
          if (table === 'checklist_violation_records') return tableQuery(table, () => VIOLATIONS);
          if (table === 'checklist_violation_tasks') return tableQuery(table, () => TASKS);
          if (table === 'checklist_violation_task_history') return tableQuery(table, () => TASK_HISTORY);
          if (table === 'checklist_system_settings') return tableQuery(table, () => SYSTEM_SETTINGS);
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
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
  const lib = require(tasksPath);
  Module._resolveFilename = originalResolve;
  if (originalCache) require.cache[supabasePath] = originalCache; else delete require.cache[supabasePath];
  return lib;
}

const { getChecklistViolationDetail, listChecklistTasks } = loadTasksLibWithMock();

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
  // ---------- 0. Chứng minh mock THỰC SỰ mô phỏng đúng Postgrest báo cột không tồn tại
  //               (nếu không, test dưới đây "pass" không có ý nghĩa gì - giống lỗi cũ). ----------
  const rawProbe = tableQuery('checklist_violation_records', () => VIOLATIONS).select('id,department').in('id', ['v1']);
  const probeResult = await new Promise(resolve => rawProbe.then(resolve));
  check(probeResult.error && probeResult.error.code === '42703', '0. Mock phát hiện đúng cột ma (department) như Postgrest thật - nếu bug tái diễn, test này sẽ bắt được (khác test cũ có select() no-op không phát hiện được)');

  // ---------- 1. TBP (manager) mở notification "Xem lỗi" cho lỗi mình đang phải xử lý (reviewer) -> KHÔNG 500 ----------
  let threw = null, result = null;
  try { result = await getChecklistViolationDetail(session('manager', { id: 'u-tbp1', employeeCode: 'TBP1' }), { violationIds: ['v1'] }); }
  catch (err) { threw = err; }
  check(!threw, '1a. TBP mở violation notification -> getChecklistViolationDetail KHÔNG throw (không còn 500 do cột ma department/branch/title/current_assignee_name)' + (threw ? (' - LỖI THẬT: ' + threw.message) : ''));
  check(!!result && result.items.length === 1 && result.items[0].violation.id === 'v1', '1b. Modal nhận đúng violation v1 (đúng lỗi TBP bấm từ notification, không lệch/rỗng)');
  check(!!result && result.items[0].task && result.items[0].task.status === 'waiting_reviewer', '1c. Modal nhận kèm đúng task hiện tại (status waiting_reviewer) để hiển thị "Thời hạn phản hồi"');
  check(!!result && result.items[0].history.length === 1 && result.items[0].history[0].note.includes('bảng tên'), '1d. Modal nhận đúng lịch sử xử lý (giải trình gần nhất của nhân viên)');

  // ---------- 2. Unauthorized: TBP1 không liên quan gì tới v2 (của TBP Hai/E2) -> deny an toàn, không 500, không leak ----------
  threw = null;
  try { result = await getChecklistViolationDetail(session('manager', { id: 'u-tbp1', employeeCode: 'TBP1' }), { violationIds: ['v2'] }); }
  catch (err) { threw = err; }
  check(!threw, '2a. Request lỗi không thuộc phạm vi TBP1 KHÔNG throw/500 (deny bằng deniedCount, không phải exception)');
  check(!!result && result.items.length === 0 && result.deniedCount === 1, '2b. v2 bị deny đúng (không liên quan), không lộ dữ liệu');

  // ---------- 3. Employee flow (learner) tự xem lỗi của chính mình -> không regression ----------
  threw = null;
  try { result = await getChecklistViolationDetail(session('learner', { employeeCode: 'E1' }), { violationIds: ['v1'] }); }
  catch (err) { threw = err; }
  check(!threw, '3a. Nhân viên tự xem lỗi của mình KHÔNG throw/500');
  check(!!result && result.items.length === 1 && result.items[0].violation.id === 'v1', '3b. Nhân viên nhận đúng violation của chính mình');

  // ---------- 4. Admin xem toàn bộ -> không regression ----------
  threw = null;
  try { result = await getChecklistViolationDetail(session('admin', { id: 'u-admin' }), { violationIds: ['v1', 'v2'] }); }
  catch (err) { threw = err; }
  check(!threw, '4a. Admin xem nhiều lỗi cùng lúc KHÔNG throw/500');
  check(!!result && result.items.length === 2, '4b. Admin thấy đủ cả 2 lỗi');

  // ---------- 5. listChecklistTasks (endpoint anh em cùng namespace URL) vẫn bình thường, không bị fix này làm hỏng ----------
  threw = null;
  let taskResult = null;
  try { taskResult = await listChecklistTasks(session('admin', { id: 'u-admin' }), { scope: 'all', status: 'all' }); }
  catch (err) { threw = err; }
  check(!threw, '5a. listChecklistTasks (Việc cần xử lý) vẫn hoạt động bình thường sau khi sửa getChecklistViolationDetail() - không đụng hàm này');
  check(!!taskResult && Array.isArray(taskResult.tasks) && taskResult.tasks.length === 2, '5b. listChecklistTasks trả đủ dữ liệu task như trước');

  if (failures) {
    console.error('\n' + failures + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nALL PASS');
}

run().catch(err => { console.error('UNCAUGHT', err); process.exit(1); });
