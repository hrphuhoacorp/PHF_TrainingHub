'use strict';

/*
 * PHF Task — Workspace/Menu/View Scope V1 — official mock/unit suite.
 *
 * MOCK TEST — in-memory stub for task_tasks/task_assignees/
 * task_permission_assignments/task_permission_grants/employee_profiles.
 * Exercises listTasks() (api/_lib/task-core.js) directly against pre-seeded
 * rows — no RPC involved (listTasks is read-only, plain PostgREST filters),
 * so Tasks are seeded already-published rather than run through
 * createTaskDraft()/publishTask(). Authorization reuses the EXACT same
 * resolveEffectiveTaskScope()/canViewTask() foundation already proven in
 * test-task-cross-department-v1.js and Production (CV-2608-0003) — this file
 * does NOT introduce a second permission engine, only a second CONSUMER of
 * the existing one (mục 13 Bước 2: "một nguồn Task → nhiều authorized views").
 */

process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const assert = require('assert');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const supabasePath = require.resolve('@supabase/supabase-js');
const employeeMasterPath = require.resolve(path.join(ROOT, 'api', '_lib', 'employee-master'));
const authPath = require.resolve(path.join(ROOT, 'api', '_lib', 'auth'));
const scopePath = require.resolve(path.join(ROOT, 'api', '_lib', 'task-employee-scope'));
const permissionsPath = require.resolve(path.join(ROOT, 'api', '_lib', 'task-permissions'));
const notificationsPath = require.resolve(path.join(ROOT, 'api', '_lib', 'task-notifications'));
const corePath = require.resolve(path.join(ROOT, 'api', '_lib', 'task-core'));
const dataJsPath = path.join(ROOT, 'api', 'data.js');
const serverJsPath = path.join(ROOT, 'server.js');

let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

// ---------------------------------------------------------------------------
// Generic Postgres-filter-accurate mock query builder — supports the exact
// operators task-core.js/task-permissions.js actually call: eq/neq/in/lte/
// gte/lt/or(field.op.value,...)/order/limit. AND semantics between chained
// calls; .or() adds one OR-group ANDed with everything else (matches
// PostgREST/supabase-js behavior for a single .or() call).
// ---------------------------------------------------------------------------
function parseOrExpr(expr) {
  return String(expr).split(',').map(clause => {
    const m = clause.match(/^([a-zA-Z_]+)\.(eq|ilike)\.(.*)$/);
    if (!m) return () => true;
    const [, field, op, rawValue] = m;
    if (op === 'eq') return row => String(row[field]) === String(rawValue);
    const needle = String(rawValue).replace(/^%|%$/g, '').toLowerCase();
    return row => String(row[field] || '').toLowerCase().includes(needle);
  });
}
function makeQuery(rows) {
  const predicates = [];
  const orderSpecs = [];
  let rangeSpec = null;
  function applySortAndRange(list) {
    let result = list;
    if (orderSpecs.length) {
      result = result.slice().sort((a, b) => {
        for (const spec of orderSpecs) {
          const av = a[spec.field], bv = b[spec.field];
          if (av === bv) continue;
          const cmp = av > bv ? 1 : -1;
          return spec.ascending ? cmp : -cmp;
        }
        return 0;
      });
    }
    if (rangeSpec) result = result.slice(rangeSpec.from, rangeSpec.to + 1);
    return result;
  }
  const builder = {
    select() { return builder; },
    eq(field, value) { predicates.push(row => String(row[field]) === String(value)); return builder; },
    neq(field, value) { predicates.push(row => String(row[field]) !== String(value)); return builder; },
    in(field, values) { const set = new Set((values || []).map(String)); predicates.push(row => set.has(String(row[field]))); return builder; },
    lte(field, value) { predicates.push(row => row[field] != null && row[field] <= value); return builder; },
    gte(field, value) { predicates.push(row => row[field] != null && row[field] >= value); return builder; },
    lt(field, value) { predicates.push(row => row[field] != null && row[field] < value); return builder; },
    or(expr) { const clauses = parseOrExpr(expr); predicates.push(row => clauses.some(fn => fn(row))); return builder; },
    order(field, opts) { orderSpecs.push({ field, ascending: !opts || opts.ascending !== false }); return builder; },
    limit() { return builder; },
    range(from, to) { rangeSpec = { from, to }; return builder; },
    maybeSingle() { const data = rows.filter(row => predicates.every(p => p(row))); return Promise.resolve({ data: clone(data[0] || null), error: null }); },
    then(resolve, reject) {
      try { resolve({ data: clone(applySortAndRange(rows.filter(row => predicates.every(p => p(row))))), error: null }); }
      catch (error) { (reject || (() => {}))(error); }
    }
  };
  return builder;
}
function tableRouter(rows) { return { select() { return makeQuery(rows); } }; }

const STATE = { employees: [], assignments: [], grants: [], categories: [], tasks: [], assignees: [] };

function resetState() {
  STATE.employees.length = 0; STATE.assignments.length = 0; STATE.grants.length = 0;
  STATE.categories.length = 0; STATE.tasks.length = 0; STATE.assignees.length = 0;
  if (require.cache[scopePath]) require.cache[scopePath].exports.invalidateOrgCache();
}

function loadWithMocks() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === '@supabase/supabase-js') return supabasePath;
    return originalResolve.call(this, request, ...rest);
  };
  [supabasePath, employeeMasterPath, authPath, scopePath, permissionsPath, notificationsPath, corePath].forEach(p => { delete require.cache[p]; });
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: {
      createClient() {
        return {
          from(table) {
            if (table === 'task_permission_assignments') return tableRouter(STATE.assignments);
            if (table === 'task_permission_grants') return tableRouter(STATE.grants);
            if (table === 'task_categories') return tableRouter(STATE.categories);
            if (table === 'task_tasks') return tableRouter(STATE.tasks);
            if (table === 'task_assignees') return tableRouter(STATE.assignees);
            throw new Error('Unexpected table in mock client: ' + table);
          }
        };
      }
    }
  };
  require.cache[employeeMasterPath] = { id: employeeMasterPath, filename: employeeMasterPath, loaded: true, exports: { loadCanonicalEmployeeProfiles() { return Promise.resolve({ rows: clone(STATE.employees), ready: true }); } } };
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { listHubAccountSummaries() { return Promise.resolve([]); } } };
  const core = require(corePath);
  Module._resolveFilename = originalResolve;
  return { core };
}

function emp(overrides) { return Object.assign({ employee_code: '', full_name: '', department: '', title: '', position: '', branch: '', manager_employee_code: '', employment_status: 'active' }, overrides); }
function assignment(overrides) { return Object.assign({ id: 'assign-' + Math.random(), account_id: '', employee_code: '', preset_code: 'NHAN_VIEN', effective_from: '2020-01-01T00:00:00.000Z', effective_to: null, is_active: true, reason: 'seed', updated_at: new Date().toISOString() }, overrides); }
function taskRow(overrides) {
  return Object.assign({
    id: 'task-' + Math.random(), task_code: 'CV-TEST', status: 'published', flow_type: 'giao_viec',
    title: 'Task', priority: 'thuong', deadline: '2099-01-01T00:00:00.000Z', category_code: 'CAT_OK',
    progress_percent: 0, progress_status: 'chua_bat_dau', created_by_employee_code: '',
    source_department: null, target_department: null, is_cross_department: null,
    row_version: 1, created_at: new Date().toISOString()
  }, overrides);
}
function assigneeRow(overrides) { return Object.assign({ id: 'as-' + Math.random(), task_id: '', employee_code: '', role: 'primary', is_active: true }, overrides); }
function sessionFor(employeeCode) { return Object.freeze({ sub: 'sess-' + employeeCode, employeeCode, role: 'manager' }); }

(async () => {
  const { core } = loadWithMocks();
  const { listTasks } = core;

  // ===========================================================================
  // CASE A — Employee B nhận Task từ A: B thấy ở "Tôi nhận", A thấy ở "Tôi giao".
  // Cùng 1 Task record — không duplicate để phục vụ 2 view (mục 1).
  // ===========================================================================
  resetState();
  STATE.employees.push(emp({ employee_code: 'A', department: 'Kinh doanh' }), emp({ employee_code: 'B', department: 'Kinh doanh' }));
  STATE.tasks.push(taskRow({ id: 'task-A1', task_code: 'CV-2608-1001', created_by_employee_code: 'A' }));
  STATE.assignees.push(assigneeRow({ task_id: 'task-A1', employee_code: 'B' }));
  {
    const received = await listTasks(sessionFor('B'), { relation: 'received' });
    pass(received.tasks.length === 1 && received.tasks[0].task_id === 'task-A1', 'CASE A: B thấy Task này ở "Tôi nhận"');
    const assigned = await listTasks(sessionFor('A'), { relation: 'assigned' });
    pass(assigned.tasks.length === 1 && assigned.tasks[0].task_id === 'task-A1', 'CASE A: A thấy CHÍNH Task đó ở "Tôi giao" — không phải bản sao');
    pass(STATE.tasks.length === 1, 'CASE A: chỉ 1 Task record duy nhất phục vụ cả 2 view');
  }

  // ===========================================================================
  // CASE A2 — ACCOUNT-ONLY CREATOR (2026-08-30 legacy parity). Admin account
  // without an employee profile creates a Task (legacy write stamps
  // created_by_account_id, created_by_employee_code NULL). "Tôi giao" must
  // still return it (match by created_by_account_id) — NOT 0 rows, and NOT
  // company-wide. A different Admin (acct-OTHER) must see nothing.
  // ===========================================================================
  resetState();
  STATE.employees.push(emp({ employee_code: 'PHF012', full_name: 'Lê Vĩnh Thắng', department: 'Kinh doanh' }));
  STATE.tasks.push(taskRow({ id: 'task-ADM1', task_code: 'CV-2608-0013', created_by_employee_code: null, created_by_account_id: 'acct-ADMIN-A' }));
  STATE.tasks.push(taskRow({ id: 'task-EMP1', task_code: 'CV-2608-9001', created_by_employee_code: 'PHF012', created_by_account_id: null }));
  STATE.assignees.push(assigneeRow({ task_id: 'task-ADM1', employee_code: 'PHF012' }));
  {
    const adminSession = Object.freeze({ sub: 'sess-admin-a', account: { id: 'acct-ADMIN-A', role: 'admin' } });
    const assigned = await listTasks(adminSession, { relation: 'assigned' });
    pass(assigned.tasks.length === 1 && assigned.tasks[0].task_id === 'task-ADM1',
      'CASE A2: account-only Admin thấy ĐÚNG Task mình tạo ở "Tôi giao" (match created_by_account_id), KHÔNG company-wide');

    const otherAdmin = Object.freeze({ sub: 'sess-admin-b', account: { id: 'acct-ADMIN-OTHER', role: 'admin' } });
    const otherAssigned = await listTasks(otherAdmin, { relation: 'assigned' });
    pass(otherAssigned.tasks.length === 0, 'CASE A2: Admin B (acct khác) KHÔNG thấy Task của Admin A ở "Tôi giao"');

    const empAssigned = await listTasks(sessionFor('PHF012'), { relation: 'assigned' });
    pass(empAssigned.tasks.length === 1 && empAssigned.tasks[0].task_id === 'task-EMP1',
      'CASE A2: employee creator vẫn match theo employee_code (không regression, không nuốt Task account-only)');
  }

  // ===========================================================================
  // CASE B — Employee không liên quan → không thấy Task.
  // ===========================================================================
  STATE.employees.push(emp({ employee_code: 'C_UNRELATED', department: 'Phòng khác' }));
  require.cache[scopePath].exports.invalidateOrgCache();
  {
    const unrelated = await listTasks(sessionFor('C_UNRELATED'), { relation: 'received' });
    pass(unrelated.tasks.length === 0, 'CASE B: nhân viên không liên quan không thấy Task ở "Tôi nhận"');
    const unrelatedAssigned = await listTasks(sessionFor('C_UNRELATED'), { relation: 'assigned' });
    pass(unrelatedAssigned.tasks.length === 0, 'CASE B: nhân viên không liên quan không thấy Task ở "Tôi giao" (không phải creator)');
  }

  // ===========================================================================
  // CASE C — TBP: "Tôi nhận" (relation=received, KHÔNG truyền scope) LUÔN
  // self-only — Task của nhân viên mình quản lý CHỈ hiện ở workspace riêng
  // "Nhân sự tôi quản lý" (scope=managed), KHÔNG trộn vào "Tôi nhận" (business
  // rule LOCK — xem PHF_TASK_HANDOVER_TO_NEW_CLAUDE_BEFORE_REPORT_04.md mục 4/8).
  // CASE D — TBP khác không liên quan → không thấy dù ở workspace nào.
  // ===========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'TBP1', department: 'Kho vận' }),
    emp({ employee_code: 'TBP2', department: 'Kế toán' }),
    emp({ employee_code: 'STAFF1', department: 'Kho vận', manager_employee_code: 'TBP1' }),
    emp({ employee_code: 'MGR_OF_CREATOR', department: 'Ban giám đốc' })
  );
  STATE.assignments.push(assignment({ employee_code: 'TBP1', preset_code: 'TRUONG_BO_PHAN' }), assignment({ employee_code: 'TBP2', preset_code: 'TRUONG_BO_PHAN' }));
  STATE.tasks.push(taskRow({ id: 'task-C1', task_code: 'CV-2608-1002', created_by_employee_code: 'MGR_OF_CREATOR' }));
  STATE.assignees.push(assigneeRow({ task_id: 'task-C1', employee_code: 'STAFF1' }));
  {
    const tbp1Received = await listTasks(sessionFor('TBP1'), { relation: 'received' });
    pass(!tbp1Received.tasks.some(t => t.task_id === 'task-C1'), 'CASE C: TBP1 "Tôi nhận" (không truyền scope) KHÔNG chứa Task của STAFF1 (nhân viên mình quản lý) — self-only, không trộn workspace');
    const tbp1Managed = await listTasks(sessionFor('TBP1'), { relation: 'received', scope: 'managed' });
    pass(tbp1Managed.tasks.some(t => t.task_id === 'task-C1'), 'CASE C: TBP1 thấy Task của STAFF1 ở đúng workspace "Nhân sự tôi quản lý" (scope=managed)');
    const tbp2View = await listTasks(sessionFor('TBP2'), { relation: 'received', scope: 'managed' });
    pass(!tbp2View.tasks.some(t => t.task_id === 'task-C1'), 'CASE D: TBP2 (không quản lý STAFF1) không thấy Task này kể cả ở scope=managed');
  }

  // ===========================================================================
  // CASE E — Cross-department manager: thấy Task của employee mình quản lý dù
  // Task do phòng khác giao sang (tái dùng đúng snapshot/relation đã Production
  // proof ở CV-2608-0003 — không phải logic mới).
  // ===========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'PHF002_SIM', department: 'Ban giám đốc' }),
    emp({ employee_code: 'PHF082_SIM', department: 'Bộ phận Quản trị tổng hợp', manager_employee_code: 'PHF012_SIM' }),
    emp({ employee_code: 'PHF012_SIM', department: 'Bộ phận Quản trị tổng hợp' }),
    emp({ employee_code: 'PHF018_SIM', department: 'Bộ phận bán hàng' })
  );
  STATE.assignments.push(assignment({ employee_code: 'PHF012_SIM', preset_code: 'TRUONG_BO_PHAN' }), assignment({ employee_code: 'PHF018_SIM', preset_code: 'TRUONG_CA' }));
  STATE.tasks.push(taskRow({
    id: 'task-E1', task_code: 'CV-2608-1003', created_by_employee_code: 'PHF002_SIM',
    source_department: 'Ban giám đốc', target_department: 'Bộ phận Quản trị tổng hợp', is_cross_department: true
  }));
  STATE.assignees.push(assigneeRow({ task_id: 'task-E1', employee_code: 'PHF082_SIM' }));
  {
    const managerReceivedView = await listTasks(sessionFor('PHF012_SIM'), { relation: 'received' });
    pass(!managerReceivedView.tasks.some(t => t.task_id === 'task-E1'), 'CASE E: "Tôi nhận" (không truyền scope) của manager phòng nhận (PHF012) KHÔNG chứa Task liên phòng ban của nhân viên mình quản lý — self-only');
    const managerView = await listTasks(sessionFor('PHF012_SIM'), { relation: 'received', scope: 'managed' });
    pass(managerView.tasks.some(t => t.task_id === 'task-E1' && t.is_cross_department === true), 'CASE E: manager phòng nhận (PHF012) thấy Task liên phòng ban của nhân viên mình quản lý ở đúng workspace "Nhân sự tôi quản lý" (scope=managed), kèm đúng cờ is_cross_department');
    const unrelatedManagerView = await listTasks(sessionFor('PHF018_SIM'), { relation: 'received', scope: 'managed' });
    pass(!unrelatedManagerView.tasks.some(t => t.task_id === 'task-E1'), 'CASE E: manager không liên quan (PHF018) vẫn KHÔNG thấy — cross-department không tự mở rộng visibility ra ngoài quan hệ manager_of_primary thật');
    const crossDeptFilterView = await listTasks(sessionFor('PHF012_SIM'), { relation: 'received', scope: 'cross_department' });
    pass(crossDeptFilterView.tasks.length === 1 && crossDeptFilterView.tasks[0].task_id === 'task-E1', 'CASE E: filter scope=cross_department (trong workspace "Nhân sự tôi quản lý") lọc đúng tập con liên phòng ban trong dữ liệu ĐÃ authorized');
  }

  // ===========================================================================
  // CASE F — G3 FIX (2026-08-28): Admin/GĐ/TLGĐ KHÔNG còn thấy toàn công ty
  // qua "Tôi nhận" (listTasks LIST/workspace contract) — CAPABILITY
  // (peopleScope=all_company, quyền can thiệp company-wide) != TASK_RELATIONSHIP
  // (Primary assignee thật). Evidence: PHF010 (tro_ly_gd) "Tôi nhận" từng trả
  // về 50/50 Task công ty dù chỉ Primary thật trên 1/50. viewScopeType vẫn
  // trả đúng 'all_company' (field capability riêng, KHÔNG đổi — frontend vẫn
  // dùng để quyết định hiện filter "Toàn công ty" ở chỗ khác, vd Report/
  // permission editor — không liên quan nội dung "Tôi nhận"). "Nhân sự tôi
  // quản lý" (scope=managed) giờ dùng managedEmployeeCodes THẬT từ org graph
  // (GD_REPORT là con thật của GD1), không còn null/toàn công ty.
  // ===========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'GD1', department: 'Ban giám đốc' }),
    emp({ employee_code: 'RANDOM_EMP', department: 'Phòng ngẫu nhiên' }),
    emp({ employee_code: 'GD_REPORT', department: 'Ban giám đốc', manager_employee_code: 'GD1' })
  );
  STATE.assignments.push(assignment({ employee_code: 'GD1', preset_code: 'GIAM_DOC' }));
  STATE.tasks.push(
    taskRow({ id: 'task-F1', task_code: 'CV-2608-1004', created_by_employee_code: 'RANDOM_EMP' }),
    taskRow({ id: 'task-F2-managed', task_code: 'CV-2608-1005', created_by_employee_code: 'RANDOM_EMP' })
  );
  STATE.assignees.push(
    assigneeRow({ task_id: 'task-F1', employee_code: 'RANDOM_EMP' }),
    assigneeRow({ task_id: 'task-F2-managed', employee_code: 'GD_REPORT' })
  );
  {
    const gdView = await listTasks(sessionFor('GD1'), { relation: 'received' });
    pass(!gdView.tasks.some(t => t.task_id === 'task-F1'), 'CASE F G3 FIX: "Tôi nhận" của Giám đốc KHÔNG còn chứa Task của nhân viên bất kỳ mình không phải Primary — executive all_company capability không leak vào quan hệ Task cá nhân');
    pass(gdView.tasks.length === 0, 'CASE F G3 FIX: GD1 không phải Primary trên Task nào trong dataset này -> "Tôi nhận" rỗng, đúng self-only thật');
    pass(gdView.viewScopeType === 'all_company', 'CASE F: viewScopeType field vẫn trả đúng all_company cho actor GIAM_DOC (capability signal riêng, KHÔNG đổi — chỉ nội dung "Tôi nhận" đổi)');
    const gdManaged = await listTasks(sessionFor('GD1'), { relation: 'received', scope: 'managed' });
    // COMPANY-LEVEL CLEANUP (2026-08-28 follow-up): "Nhân sự tôi quản lý" của
    // Admin/GĐ/TLGĐ giờ company-wide (unrestricted), KHÔNG còn bị bó vào
    // managedEmployeeCodes/org-graph subtree như TBP/Trưởng ca — business
    // contract mới: "Direct reports có thể tồn tại trong org graph nhưng
    // không được giới hạn company-wide Task scope của nhóm này". task-F1
    // (RANDOM_EMP, ngoài org graph của GD1) giờ PHẢI xuất hiện — trước đó
    // (G3-only) bị loại trừ vì managedEmployeeCodes-bounded, nay company-wide.
    pass(gdManaged.tasks.length === 2 && ['task-F1', 'task-F2-managed'].every(id => gdManaged.tasks.some(t => t.task_id === id)), 'CASE F COMPANY-LEVEL CLEANUP: "Nhân sự tôi quản lý" của Giám đốc là company-wide (CẢ task-F1 của RANDOM_EMP ngoài org graph VÀ task-F2-managed của GD_REPORT) — KHÔNG còn bị bó vào managedEmployeeCodes như TBP/Trưởng ca', JSON.stringify(gdManaged.tasks.map(t => t.task_id)));
    pass(gdManaged.hasManagedPeople === true, 'CASE F: GĐ hasManagedPeople=true (company-tier luôn eligible)');
  }

  // ===========================================================================
  // CASE G — Search task_code → tìm đúng Task.
  // ===========================================================================
  resetState();
  STATE.employees.push(emp({ employee_code: 'SEARCH_SELF', department: 'Kho vận' }));
  STATE.tasks.push(taskRow({ id: 'task-G1', task_code: 'CV-2608-2001', created_by_employee_code: 'SEARCH_SELF' }));
  STATE.tasks.push(taskRow({ id: 'task-G2', task_code: 'CV-2608-2002', created_by_employee_code: 'SEARCH_SELF' }));
  STATE.assignees.push(assigneeRow({ task_id: 'task-G1', employee_code: 'SEARCH_SELF' }), assigneeRow({ task_id: 'task-G2', employee_code: 'SEARCH_SELF' }));
  {
    const searchResult = await listTasks(sessionFor('SEARCH_SELF'), { relation: 'received', search: 'CV-2608-2001' });
    pass(searchResult.tasks.length === 1 && searchResult.tasks[0].task_code === 'CV-2608-2001', 'CASE G: search theo task_code trả đúng 1 Task, không lẫn Task khác');
  }

  // ===========================================================================
  // CASE H — Status filter chỉ filter TRONG tập đã authorized (không mở rộng
  // authorization, không leak Task ngoài phạm vi).
  // ===========================================================================
  resetState();
  STATE.employees.push(emp({ employee_code: 'STATUS_SELF', department: 'Kho vận' }), emp({ employee_code: 'STATUS_OTHER', department: 'Kho vận' }));
  const past = '2000-01-01T00:00:00.000Z', future = '2099-01-01T00:00:00.000Z';
  STATE.tasks.push(
    taskRow({ id: 'task-H1', task_code: 'CV-2608-3001', status: 'published', deadline: future, created_by_employee_code: 'STATUS_SELF' }),
    taskRow({ id: 'task-H2', task_code: 'CV-2608-3002', status: 'published', deadline: past, created_by_employee_code: 'STATUS_SELF' }),
    taskRow({ id: 'task-H3', task_code: 'CV-2608-3003', status: 'completed', deadline: past, created_by_employee_code: 'STATUS_SELF' }),
    taskRow({ id: 'task-H4', task_code: 'CV-2608-3004', status: 'published', deadline: future, created_by_employee_code: 'STATUS_OTHER' }) // not authorized for STATUS_SELF
  );
  STATE.assignees.push(
    assigneeRow({ task_id: 'task-H1', employee_code: 'STATUS_SELF' }),
    assigneeRow({ task_id: 'task-H2', employee_code: 'STATUS_SELF' }),
    assigneeRow({ task_id: 'task-H3', employee_code: 'STATUS_SELF' }),
    assigneeRow({ task_id: 'task-H4', employee_code: 'STATUS_OTHER' })
  );
  {
    const inProgress = await listTasks(sessionFor('STATUS_SELF'), { relation: 'received', statusFilter: 'in_progress' });
    pass(inProgress.tasks.length === 1 && inProgress.tasks[0].task_id === 'task-H1', 'CASE H: statusFilter=in_progress chỉ trả Task published còn hạn, trong tập đã authorized của STATUS_SELF');
    const overdue = await listTasks(sessionFor('STATUS_SELF'), { relation: 'received', statusFilter: 'overdue' });
    pass(overdue.tasks.length === 1 && overdue.tasks[0].task_id === 'task-H2', 'CASE H: statusFilter=overdue chỉ trả Task published quá hạn');
    const completed = await listTasks(sessionFor('STATUS_SELF'), { relation: 'received', statusFilter: 'completed' });
    pass(completed.tasks.length === 1 && completed.tasks[0].task_id === 'task-H3', 'CASE H: statusFilter=completed chỉ trả Task đã hoàn thành');
    const all = await listTasks(sessionFor('STATUS_SELF'), { relation: 'received', statusFilter: 'all' });
    pass(all.tasks.length === 3 && !all.tasks.some(t => t.task_id === 'task-H4'), 'CASE H: statusFilter=all không mở rộng ra ngoài tập authorized — task-H4 (của STATUS_OTHER) không bao giờ leak dù đổi status filter');
  }

  // ===========================================================================
  // CASE I — Self-task: architecture/list metadata không mất khả năng phân
  // biệt Được giao vs Tự giao (không tính KPI ở đây — chỉ compatibility).
  // ===========================================================================
  resetState();
  STATE.employees.push(emp({ employee_code: 'SELF_TASKER', department: 'Kho vận' }));
  STATE.tasks.push(taskRow({ id: 'task-I1', task_code: 'CV-2608-4001', created_by_employee_code: 'SELF_TASKER' }));
  STATE.assignees.push(assigneeRow({ task_id: 'task-I1', employee_code: 'SELF_TASKER' })); // creator === primary
  {
    const view = await listTasks(sessionFor('SELF_TASKER'), { relation: 'received' });
    pass(view.tasks.length === 1 && view.tasks[0].self_task === true, 'CASE I: Task tự giao (creator === primary) được đánh dấu self_task=true, không bị mất metadata cho Dashboard/Report sau này');
  }

  // ===========================================================================
  // CASE J — Proposal navigation: flow_type='de_xuat' cô lập đúng khỏi
  // 'received'/'assigned', KHÔNG fake accept/reject action nào chưa tồn tại.
  // ===========================================================================
  resetState();
  STATE.employees.push(emp({ employee_code: 'PROP_SENDER', department: 'Kho vận' }), emp({ employee_code: 'PROP_RECEIVER', department: 'Kho vận' }));
  STATE.tasks.push(taskRow({ id: 'task-J1', task_code: 'CV-2608-5001', flow_type: 'de_xuat', created_by_employee_code: 'PROP_SENDER' }));
  STATE.assignees.push(assigneeRow({ task_id: 'task-J1', employee_code: 'PROP_RECEIVER' }));
  {
    const sent = await listTasks(sessionFor('PROP_SENDER'), { relation: 'proposal_sent' });
    pass(sent.tasks.length === 1 && sent.tasks[0].task_id === 'task-J1', 'CASE J: PROP_SENDER thấy Đề xuất mình gửi ở relation=proposal_sent');
    const receivedProposal = await listTasks(sessionFor('PROP_RECEIVER'), { relation: 'proposal_received' });
    pass(receivedProposal.tasks.length === 1 && receivedProposal.tasks[0].task_id === 'task-J1', 'CASE J: PROP_RECEIVER thấy Đề xuất gửi tới mình ở relation=proposal_received');
    const notInGiaoViec = await listTasks(sessionFor('PROP_RECEIVER'), { relation: 'received' });
    pass(!notInGiaoViec.tasks.some(t => t.task_id === 'task-J1'), 'CASE J: Đề xuất (de_xuat) KHÔNG lẫn vào relation=received (giao_viec) — 2 flow_type cô lập nhau đúng thiết kế');
    const notInGiao = await listTasks(sessionFor('PROP_SENDER'), { relation: 'assigned' });
    pass(!notInGiao.tasks.some(t => t.task_id === 'task-J1'), 'CASE J: Đề xuất KHÔNG lẫn vào relation=assigned (giao_viec)');

    // No fake lifecycle: neither server dispatch nor core module exposes any
    // accept/reject/approve action for Proposal — foundation-only, honest.
    const fs = require('fs');
    const coreSource = fs.readFileSync(require.resolve(path.join(ROOT, 'api', '_lib', 'task-core.js')), 'utf8');
    pass(!/proposal.*(accept|reject|approve|deny)/i.test(coreSource), 'CASE J: task-core.js KHÔNG chứa bất kỳ hàm accept/reject/approve Proposal nào — không tự invent lifecycle (mục 4/13)');
    const dataJsSource = fs.readFileSync(dataJsPath, 'utf8');
    const serverJsSource = fs.readFileSync(serverJsPath, 'utf8');
    pass(!/acceptProposal|rejectProposal|approveProposal/i.test(dataJsSource) && !/acceptProposal|rejectProposal|approveProposal/i.test(serverJsSource),
      'CASE J: KHÔNG có action Task Proposal accept/reject/approve nào được wire ở dispatch layer (foundation/navigation-only turn này)');
  }

  // ===========================================================================
  // CASE K — Pagination foundation (mục 11): server-side offset/range, luôn
  // SAU authorization/filter, ordering deterministic (created_at desc + id
  // tie-break), không fetch hết rồi paginate client-side.
  // ===========================================================================
  resetState();
  STATE.employees.push(emp({ employee_code: 'PAGE_SELF', department: 'Kho vận' }));
  for (let i = 0; i < 5; i++) {
    const id = 'task-PAGE' + i;
    STATE.tasks.push(taskRow({ id, task_code: 'CV-2608-700' + i, created_by_employee_code: 'PAGE_SELF', created_at: new Date(2026, 7, 22, 0, i).toISOString() }));
    STATE.assignees.push(assigneeRow({ task_id: id, employee_code: 'PAGE_SELF' }));
  }
  {
    const page1 = await listTasks(sessionFor('PAGE_SELF'), { relation: 'received', limit: 2, offset: 0 });
    pass(page1.tasks.length === 2 && page1.hasMore === true, 'CASE K: trang 1 (limit=2, offset=0) trả đúng 2 Task, hasMore=true vì còn 3 Task nữa');
    pass(page1.tasks[0].task_id === 'task-PAGE4' && page1.tasks[1].task_id === 'task-PAGE3', 'CASE K: ordering deterministic created_at DESC — Task mới nhất (PAGE4) lên đầu');
    const page2 = await listTasks(sessionFor('PAGE_SELF'), { relation: 'received', limit: 2, offset: 2 });
    pass(page2.tasks.length === 2 && page2.hasMore === true, 'CASE K: trang 2 (offset=2) trả đúng 2 Task tiếp theo, vẫn còn hasMore=true');
    pass(page2.tasks[0].task_id === 'task-PAGE2' && page2.tasks[1].task_id === 'task-PAGE1', 'CASE K: trang 2 KHÔNG lặp lại Task đã trả ở trang 1 — offset chính xác');
    const page3 = await listTasks(sessionFor('PAGE_SELF'), { relation: 'received', limit: 2, offset: 4 });
    pass(page3.tasks.length === 1 && page3.hasMore === false, 'CASE K: trang cuối (offset=4) trả đúng 1 Task còn lại, hasMore=false (không còn trang tiếp)');
    pass(page3.tasks[0].task_id === 'task-PAGE0', 'CASE K: Task cũ nhất (PAGE0) nằm ở trang cuối cùng, đúng thứ tự');
    const allSeen = new Set([...page1.tasks, ...page2.tasks, ...page3.tasks].map(t => t.task_id));
    pass(allSeen.size === 5, 'CASE K: gộp cả 3 trang lại đúng 5 Task duy nhất — không thiếu, không trùng');
  }

  // ===========================================================================
  // MANAGER FILTER IS NOT A SECURITY BOUNDARY — a scope filter value that
  // does not correspond to the actor's real capability must never widen the
  // authorized set (mục 8 — "Filter không được tự cấp thêm quyền").
  // ===========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'PLAIN_STAFF', department: 'Kho vận' }),
    emp({ employee_code: 'OTHER_STAFF', department: 'Kho vận' })
  );
  STATE.tasks.push(taskRow({ id: 'task-NOSCOPE', task_code: 'CV-2608-6001', created_by_employee_code: 'OTHER_STAFF' }));
  STATE.assignees.push(assigneeRow({ task_id: 'task-NOSCOPE', employee_code: 'OTHER_STAFF' }));
  {
    // PLAIN_STAFF is a plain NHAN_VIEN (peopleScope.type='self') — requesting
    // scope='managed'/'all_company' must NOT grant visibility into OTHER_STAFF's task.
    const attemptManaged = await listTasks(sessionFor('PLAIN_STAFF'), { relation: 'received', scope: 'managed' });
    pass(attemptManaged.tasks.length === 0, 'SECURITY: nhân viên thường yêu cầu scope=managed KHÔNG được cấp thêm quyền xem Task người khác (peopleScope.type=self không có managedEmployeeCodes)');
    const attemptAllCompany = await listTasks(sessionFor('PLAIN_STAFF'), { relation: 'received', scope: 'all_company' });
    pass(attemptAllCompany.tasks.length === 0, 'SECURITY: nhân viên thường yêu cầu scope=all_company cũng KHÔNG được mở rộng (peopleScope.type=self bỏ qua tham số scope không hợp lệ với vai trò của mình)');
  }

  console.log('PHF Task View Scope V1 test: ' + passed + '/' + passed + ' PASS');

  await runFrontendChecks();
})().catch(err => { console.error(err); process.exitCode = 1; });

/* ---------------------------------------------------------------------
   FRONTEND — menu/routes/list screen. jsdom, no network. Verifies: các
   route mới map đúng relation, menu KHÔNG còn nhóm "Công việc" disabled
   gộp chung (mục 1: góc nhìn → trạng thái là filter BÊN TRONG, không phải
   menu riêng), header/tabs đúng cho từng relation, manager scope filter
   chỉ hiện đúng điều kiện (mục 8 — filter không phải security boundary,
   nên UI cũng không tự vẽ filter cho actor không có quyền tương ứng), và
   Đề xuất KHÔNG có action accept/reject/approve giả nào trong HTML.
--------------------------------------------------------------------- */
async function runFrontendChecks() {
  const fs = require('fs');
  const { JSDOM } = require('jsdom');
  const code = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'task', 'phf-task-app.js'), 'utf8');
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/admin/task' });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = function () { return 'admin'; };
  window.phfGetCurrentUser = function () { return { fullName: 'Test User', employeeCode: 'FE_TEST' }; };
  window.phfNavigate = function () { };
  window.phfToast = function () { };
  window.eval(code);
  const T = window.__PHF_TASK_TEST__;

  // ROUTER REGISTRY — ROOT CAUSE của bug "menu không click được" (2026-08-22
  // checkpoint): assets/js/phf-url-router.js fail-closed VỀ task-home cho bất
  // kỳ path /xx/task/* nào KHÔNG có trong ROUTE_REGISTRY (xem router dòng
  // ~1042: "Unknown Task paths fail closed to the namespace home"). 4 route
  // mới (/nhan, /giao, /de-xuat/toi-gui, /de-xuat/toi-nhan-xu-ly) phải được
  // đăng ký TRONG CẢ 3 namespace admin/ql/hv — thiếu 1 namespace nào cũng tái
  // hiện đúng bug đã báo. Test tĩnh này KHÔNG chạy được browser thật (xem giới
  // hạn môi trường trong báo cáo cuối) nên đây là bằng chứng gần nhất có thể
  // xác nhận offline rằng route đã được đăng ký đúng.
  const routerSource = require('fs').readFileSync(path.join(ROOT, 'assets', 'js', 'phf-url-router.js'), 'utf8');
  const newRoutePaths = ['/nhan', '/giao', '/de-xuat/toi-gui', '/de-xuat/toi-nhan-xu-ly'];
  ['admin', 'ql', 'hv'].forEach(prefix => {
    newRoutePaths.forEach(suffix => {
      const fullPath = '/' + prefix + '/task' + suffix;
      pass(routerSource.includes("'" + fullPath + "'"), 'ROUTER: ' + fullPath + ' phải xuất hiện trong ROUTE_REGISTRY/PHF_ROUTE_MAP của assets/js/phf-url-router.js (nếu thiếu, router fail-closed về /' + prefix + '/task — chính là bug đã báo)');
    });
  });
  const registryMatchesForNewRoutes = newRoutePaths.map(suffix => new RegExp("'/admin/task" + suffix.replace(/\//g, '\\/') + "':Object\\.freeze\\(\\{area:'admin'").test(routerSource));
  pass(registryMatchesForNewRoutes.every(Boolean), 'ROUTER: cả 4 route mới đều có entry ROUTE_REGISTRY riêng cho area admin (không chỉ nằm trong PHF_ROUTE_MAP array mà thiếu registry — cả 2 đều bắt buộc theo cách router hiện đọc path)');

  // Routes — mỗi path chỉ chọn RELATION, không phải view/business engine riêng.
  pass(T.parseTaskRoute(T.taskListPath('received')).view === 'list' && T.parseTaskRoute(T.taskListPath('received')).relation === 'received', 'ROUTE: "Tôi nhận" path → view=list, relation=received');
  pass(T.parseTaskRoute(T.taskListPath('assigned')).relation === 'assigned', 'ROUTE: "Tôi giao" path → relation=assigned');
  pass(T.parseTaskRoute(T.taskListPath('proposal_sent')).relation === 'proposal_sent', 'ROUTE: "Đề xuất — Tôi gửi" path → relation=proposal_sent');
  pass(T.parseTaskRoute(T.taskListPath('proposal_received')).relation === 'proposal_received', 'ROUTE: "Đề xuất — Tôi nhận xử lý" path → relation=proposal_received');

  // Menu — Business Owner CHỐT (checkpoint "Việc của tôi"): gom 4 góc nhìn
  // vào 1 menu cha DUY NHẤT "Việc của tôi", KHÔNG phải 4 mục rời cấp menu
  // chính. Menu riêng cho trạng thái (Đang làm/Quá hạn/Hoàn thành) và mục
  // "Công việc" gộp disabled cũ đều KHÔNG được tồn tại.
  const navKeys = T.NAV_ITEMS.map(item => item.key);
  pass(!navKeys.includes('cong-viec'), 'MENU: không còn mục "Công việc" gộp chung disabled cũ');
  pass(!navKeys.includes('toi-nhan') && !navKeys.includes('toi-giao'), 'MENU: "Tôi nhận"/"Tôi giao" KHÔNG còn ở cấp menu chính — đã gom vào group "Việc của tôi" theo đúng CHỐT của Business Owner');
  const parentItem = T.NAV_ITEMS.find(item => item.key === 'viec-cua-toi');
  pass(!!parentItem && Array.isArray(parentItem.children), 'MENU: có đúng 1 menu cha "viec-cua-toi" chứa children (không phải loại Task mới, chỉ là nhóm điều hướng)');
  const childKeys = (parentItem.children || []).map(c => c.key);
  pass(childKeys.includes('toi-nhan') && childKeys.includes('toi-giao') && childKeys.includes('de-xuat-toi-gui') && childKeys.includes('de-xuat-toi-nhan'), 'MENU: group "Việc của tôi" có đủ 4 child đúng canonical (Tôi nhận/Tôi giao/Đề xuất tôi gửi/Đề xuất tôi nhận xử lý)');
  pass(!navKeys.some(key => /dang-lam|qua-han|hoan-thanh/i.test(key)) && !childKeys.some(key => /dang-lam|qua-han|hoan-thanh/i.test(key)), 'MENU: KHÔNG có menu riêng cho từng trạng thái (Đang làm/Quá hạn/Hoàn thành phải là tab/filter BÊN TRONG, không phải menu)');
  pass(T.TASK_RELATION_BY_NAV_KEY['toi-nhan'] === 'received' && T.TASK_RELATION_BY_NAV_KEY['toi-giao'] === 'assigned' && T.TASK_RELATION_BY_NAV_KEY['de-xuat-toi-gui'] === 'proposal_sent' && T.TASK_RELATION_BY_NAV_KEY['de-xuat-toi-nhan'] === 'proposal_received', 'MENU: mỗi child nav key map đúng 1 relation, dùng lại authorized view có sẵn — không duplicate dữ liệu');

  // Parent expand/collapse — auto-expand khi active child, F5/deep-link giữ đúng.
  pass(T.findNavParentKey('toi-nhan') === 'viec-cua-toi' && T.findNavParentKey('toi-giao') === 'viec-cua-toi', 'MENU PARENT: mọi child đều thuộc đúng group "viec-cua-toi"');
  pass(T.navGroupExpanded('viec-cua-toi', 'toi-nhan') === true, 'MENU PARENT: group tự động expanded khi active child là "toi-nhan" (mô phỏng F5/deep-link vào /nhan) — đúng bất kể trạng thái toggle trước đó');
  pass(T.navGroupExpanded('viec-cua-toi', 'toi-giao') === true, 'MENU PARENT: group tự động expanded khi active child là "toi-giao"');
  pass(T.navGroupExpanded('viec-cua-toi', 'dashboard') === true, 'MENU PARENT: mặc định expanded ngay cả khi không ở child nào (chỉ có đúng 1 group, không cần thu gọn sẵn)');
  const groupHtmlCollapsed = T.navItemHtml(parentItem, 'dashboard');
  pass(/aria-expanded="true"/.test(groupHtmlCollapsed) && /toi-nhan/.test(groupHtmlCollapsed), 'MENU PARENT: render mặc định hiện sẵn children (không ẩn, đúng UX "không cần accordion phức tạp")');

  // Header/tabs — dùng đúng 1 hàm render cho cả 4 relation (mục 13 Bước 2).
  const state = T.getState();
  ['received', 'assigned', 'proposal_sent', 'proposal_received'].forEach(relation => {
    state.view = 'list';
    state.list = Object.assign(T.defaultTaskListState(), { relation, tasks: [] });
    const html = T.taskListHtml();
    pass(typeof html === 'string' && html.length > 0, 'LIST SCREEN: relation=' + relation + ' render qua đúng CÙNG MỘT hàm taskListHtml(), không phải engine riêng');
    pass(/data-task-list-status="all"/.test(html) && /data-task-list-status="in_progress"/.test(html) && /data-task-list-status="overdue"/.test(html) && /data-task-list-status="completed"/.test(html),
      'LIST SCREEN: relation=' + relation + ' có đủ 4 tab trạng thái BÊN TRONG màn (Tất cả/Đang làm/Quá hạn/Hoàn thành), không phải menu riêng');
  });

  // Manager scope filter — V5 SUPERSEDES: "Nhân sự tôi quản lý" không còn là
  // filter value bên trong "Tôi nhận" — đã tách thành relation/route riêng
  // ('managed'). Filter còn lại trong "Nhân sự tôi quản lý" chỉ còn 1 giá
  // trị thuộc tính: "Liên phòng ban" (không còn "Của tôi"/"Nhân sự tôi quản
  // lý" là lựa chọn filter nữa). Đủ chi tiết hơn ở
  // scripts/test-task-managed-workspace-v5.js — ở đây chỉ giữ smoke check
  // xác nhận "Tôi nhận"/"Tôi giao" không còn filter này nữa.
  state.list = Object.assign(T.defaultTaskListState(), { relation: 'received', viewScopeType: 'self' });
  pass(T.taskListManagerScopeFilterHtml() === '', 'MANAGER FILTER V5: "Tôi nhận" (nhân viên thường) KHÔNG thấy filter nào — đúng như trước');
  state.list = Object.assign(T.defaultTaskListState(), { relation: 'received', viewScopeType: 'employees' });
  pass(T.taskListManagerScopeFilterHtml() === '', 'MANAGER FILTER V5: "Tôi nhận" KHÔNG còn filter "Của tôi/Nhân sự tôi quản lý/Liên phòng ban" nữa dù actor có managed scope — đã tách hẳn sang relation "managed" riêng (mục 3 V5)');
  state.list = Object.assign(T.defaultTaskListState(), { relation: 'assigned', viewScopeType: 'employees' });
  pass(T.taskListManagerScopeFilterHtml() === '', 'MANAGER FILTER: KHÔNG hiện ở relation=assigned ("Tôi giao" luôn self-only theo canonical, filter không áp dụng)');
  state.list = Object.assign(T.defaultTaskListState(), { relation: 'managed', viewScopeType: 'employees' });
  pass(/Liên phòng ban/.test(T.taskListManagerScopeFilterHtml()) && !/Nhân sự tôi quản lý/.test(T.taskListManagerScopeFilterHtml()), 'MANAGER FILTER V5: relation="managed" chỉ còn đúng 1 attribute filter "Liên phòng ban" (không còn lựa chọn "Nhân sự tôi quản lý" bên trong nó — đã LÀ chính relation này rồi)');

  // Cross-department tag tái dùng đúng .phft-cross-dept-tag đã có sẵn từ V1
  // (không tạo class/markup riêng cho cùng 1 khái niệm).
  const tagHtml = T.taskListCrossDeptTagHtml({ is_cross_department: true, source_department: 'Ban giám đốc', target_department: 'Bộ phận Quản trị tổng hợp' });
  pass(tagHtml.includes('phft-cross-dept-tag') && tagHtml.includes('Ban giám đốc → Bộ phận Quản trị tổng hợp'), 'LIST SCREEN: tag Liên phòng ban tái dùng đúng class đã có, hiển thị đúng chiều nguồn→đích');
  pass(T.taskListCrossDeptTagHtml({ is_cross_department: false }) === '', 'LIST SCREEN: Task cùng phòng ban không hiện tag Liên phòng ban');
  pass(T.taskListCrossDeptTagHtml({ is_cross_department: null }) === '', 'LIST SCREEN: is_cross_department=null (Task cũ trước 1.72.0) không hiện tag — honest, không đoán');

  // Proposal foundation-only — KHÔNG render bất kỳ nút Chấp nhận/Từ chối nào.
  state.list = Object.assign(T.defaultTaskListState(), { relation: 'proposal_received', tasks: [{ task_id: 't1', task_code: 'CV-2608-9001', title: 'Đề xuất test', status: 'published', priority: 'thuong', deadline: '2099-01-01T00:00:00.000Z', category_code: 'CAT', created_by: { full_name: 'A', department: 'D' }, primary: { full_name: 'B', department: 'D' } }] });
  const proposalHtml = T.taskListHtml();
  pass(!/chấp nhận|từ chối|approve|reject/i.test(proposalHtml), 'PROPOSAL: màn "Đề xuất — Tôi nhận xử lý" KHÔNG render nút Chấp nhận/Từ chối giả (lifecycle chưa tồn tại, mục 4/13)');

  console.log('PHF Task View Scope V1 frontend checks: ' + passed + '/' + passed + ' PASS (cumulative)');
}
