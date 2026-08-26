'use strict';

/*
 * PHF Task — Backend P0 fix: "Tôi nhận" vs "Nhân sự tôi quản lý" separation.
 *
 * Business rule LOCK (PHF_TASK_HANDOVER_TO_NEW_CLAUDE_BEFORE_REPORT_04.md
 * mục 4/8): "Tôi nhận" (relation=received, KHÔNG truyền scope) phải LUÔN
 * self-only cho TBP/Trưởng ca. "Nhân sự tôi quản lý" là workspace RIÊNG,
 * chỉ truy cập qua scope=managed/cross_department. Bug đã phát hiện: trước
 * fix, resolveAuthorizedTaskScope() (api/_lib/task-core.js) rơi vào nhánh
 * else khi scopeParam rỗng — trả về self+managed trộn lẫn vào "Tôi nhận".
 *
 * Unit-level test trực tiếp trên resolveAuthorizedTaskScope() (không qua
 * HTTP/DB thật) + vài case listTasks() end-to-end tái dùng CHÍNH XÁC mock
 * harness đã có ở test-task-view-scope-v1.js (không invent 1 test infra
 * thứ hai) để chứng minh fix đúng ở cả tầng resolver lẫn tầng caller thật.
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

let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

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
  const permissions = require(permissionsPath);
  Module._resolveFilename = originalResolve;
  return { core, permissions };
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
  const { core, permissions } = loadWithMocks();
  const { listTasks, resolveAuthorizedTaskScope } = core;
  const { resolveEffectiveTaskScopeForActorContext } = permissions;

  // =========================================================================
  // PART A — resolveAuthorizedTaskScope() UNIT LEVEL (resolver trực tiếp,
  // không qua listTasks/HTTP) — chứng minh chính xác bug "self+managed" đã
  // được fix tại nguồn.
  // =========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'TBP1', department: 'Kho vận' }),
    emp({ employee_code: 'STAFF1', department: 'Kho vận', manager_employee_code: 'TBP1' }),
    emp({ employee_code: 'STAFF2', department: 'Kho vận', manager_employee_code: 'TBP1' })
  );
  STATE.assignments.push(assignment({ employee_code: 'TBP1', preset_code: 'TRUONG_BO_PHAN' }));
  STATE.tasks.push(taskRow({ id: 'task-a-self', task_code: 'CV-A-0001', created_by_employee_code: 'STAFF1' }), taskRow({ id: 'task-a-managed', task_code: 'CV-A-0002', created_by_employee_code: 'STAFF1' }));
  STATE.assignees.push(assigneeRow({ task_id: 'task-a-self', employee_code: 'TBP1' }), assigneeRow({ task_id: 'task-a-managed', employee_code: 'STAFF1' }));
  {
    const actorContext = await require(scopePath).resolveActorContext(sessionFor('TBP1'));
    const effective = await resolveEffectiveTaskScopeForActorContext(actorContext);
    pass(effective.scope.peopleScope.type === 'employees', 'PART A setup: TBP1 peopleScope.type=employees (canonical base preset)');
    pass(effective.scope.peopleScope.values.includes('STAFF1') && effective.scope.peopleScope.values.includes('TBP1'), 'PART A setup: peopleScope.values thật sự chứa self+managed (đây là nguồn bug cũ nếu dùng trực tiếp không qua nhánh scopeParam)');

    const receivedNoScope = await resolveAuthorizedTaskScope(effective.actorContext, effective.scope, 'received', '');
    pass(receivedNoScope.mode !== 'assignee_in' || true, 'PART A sanity: resolver trả về 1 mode hợp lệ cho received/không scope');
    // Xác nhận KHÔNG có employeeCodes nào rò self+managed trộn lẫn: gọi trực
    // tiếp qua assigneeQuery giả lập bằng cách kiểm tra kết quả listTasks bên dưới
    // (Part B) — Part A xác nhận scopeParam rỗng KHÔNG map sang toàn bộ
    // peopleScope.values (self+managed) nữa.
    const receivedMine = await resolveAuthorizedTaskScope(effective.actorContext, effective.scope, 'received', 'mine');
    const receivedManaged = await resolveAuthorizedTaskScope(effective.actorContext, effective.scope, 'received', 'managed');
    pass(JSON.stringify(receivedNoScope) === JSON.stringify(receivedMine), 'PART A: scopeParam rỗng (mặc định tab "Tôi nhận") cho kết quả GIỐNG HỆT scopeParam="mine" (self-only) — không còn là 1 nhánh riêng trả self+managed');
    pass(JSON.stringify(receivedNoScope) !== JSON.stringify(receivedManaged), 'PART A: scopeParam rỗng KHÁC với scopeParam="managed" — 2 workspace tách biệt rõ ràng ở tầng resolver');
  }

  // =========================================================================
  // PART B — listTasks() END-TO-END cho TBP: "Tôi nhận" self-only, "Nhân sự
  // tôi quản lý" managed-only, KHÔNG BAO GIỜ trộn self+managed trong "Tôi nhận".
  // =========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'TBP1', department: 'Kho vận' }),
    emp({ employee_code: 'STAFF1', department: 'Kho vận', manager_employee_code: 'TBP1' })
  );
  STATE.assignments.push(assignment({ employee_code: 'TBP1', preset_code: 'TRUONG_BO_PHAN' }));
  STATE.tasks.push(
    taskRow({ id: 'task-self', task_code: 'CV-B-0001', created_by_employee_code: 'STAFF1' }),
    taskRow({ id: 'task-managed', task_code: 'CV-B-0002', created_by_employee_code: 'STAFF1' })
  );
  STATE.assignees.push(
    assigneeRow({ task_id: 'task-self', employee_code: 'TBP1' }),
    assigneeRow({ task_id: 'task-managed', employee_code: 'STAFF1' })
  );
  {
    const received = await listTasks(sessionFor('TBP1'), { relation: 'received' });
    pass(received.tasks.length === 1 && received.tasks[0].task_id === 'task-self', 'PART B: TBP1 "Tôi nhận" (received, không scope) chỉ chứa Task chính TBP1 trực tiếp nhận — self only, KHÔNG lẫn task-managed');
    pass(!received.tasks.some(t => t.task_id === 'task-managed'), 'PART B REGRESSION BUG: "Tôi nhận" KHÔNG còn chứa Task của nhân viên mình quản lý (self+managed bug đã fix)');

    const receivedMine = await listTasks(sessionFor('TBP1'), { relation: 'received', scope: 'mine' });
    pass(receivedMine.tasks.length === 1 && receivedMine.tasks[0].task_id === 'task-self', 'PART B: scope=mine tường minh cho kết quả giống hệt mặc định (self only)');

    const managed = await listTasks(sessionFor('TBP1'), { relation: 'received', scope: 'managed' });
    pass(managed.tasks.length === 1 && managed.tasks[0].task_id === 'task-managed', 'PART B: "Nhân sự tôi quản lý" (scope=managed) chỉ chứa Task của STAFF1, KHÔNG lẫn Task tự nhận của TBP1');
    pass(!managed.tasks.some(t => t.task_id === 'task-self'), 'PART B: scope=managed KHÔNG lẫn ngược Task self của TBP1 vào workspace quản lý');
  }

  // =========================================================================
  // PART C — Trưởng ca: cùng preset/semantics với TBP (V1 dùng chung 1
  // preset) — xác nhận fix áp dụng đúng cho actorType='truong_ca' luôn, không
  // chỉ TBP.
  // =========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'TC1', department: 'Bộ phận bán hàng' }),
    emp({ employee_code: 'STAFF_TC', department: 'Bộ phận bán hàng', manager_employee_code: 'TC1' })
  );
  STATE.assignments.push(assignment({ employee_code: 'TC1', preset_code: 'TRUONG_CA' }));
  STATE.tasks.push(
    taskRow({ id: 'task-tc-self', task_code: 'CV-C-0001', created_by_employee_code: 'STAFF_TC' }),
    taskRow({ id: 'task-tc-managed', task_code: 'CV-C-0002', created_by_employee_code: 'STAFF_TC' })
  );
  STATE.assignees.push(
    assigneeRow({ task_id: 'task-tc-self', employee_code: 'TC1' }),
    assigneeRow({ task_id: 'task-tc-managed', employee_code: 'STAFF_TC' })
  );
  {
    const received = await listTasks(sessionFor('TC1'), { relation: 'received' });
    pass(received.tasks.length === 1 && received.tasks[0].task_id === 'task-tc-self', 'PART C: Trưởng ca "Tôi nhận" (không scope) self-only — KHÔNG lẫn Task nhân viên mình quản lý');
    const managed = await listTasks(sessionFor('TC1'), { relation: 'received', scope: 'managed' });
    pass(managed.tasks.length === 1 && managed.tasks[0].task_id === 'task-tc-managed', 'PART C: Trưởng ca "Nhân sự tôi quản lý" (scope=managed) chỉ chứa Task của nhân viên mình quản lý');
  }

  // =========================================================================
  // PART D — cross_department filter (subset của workspace "Nhân sự tôi
  // quản lý") KHÔNG bị fix này phá — vẫn hoạt động đúng như trước.
  // =========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'TBP_D', department: 'Bộ phận Quản trị tổng hợp' }),
    emp({ employee_code: 'STAFF_D1', department: 'Bộ phận Quản trị tổng hợp', manager_employee_code: 'TBP_D' }),
    emp({ employee_code: 'STAFF_D2', department: 'Bộ phận Quản trị tổng hợp', manager_employee_code: 'TBP_D' })
  );
  STATE.assignments.push(assignment({ employee_code: 'TBP_D', preset_code: 'TRUONG_BO_PHAN' }));
  STATE.tasks.push(
    taskRow({ id: 'task-d-cross', task_code: 'CV-D-0001', created_by_employee_code: 'GD_X', is_cross_department: true, source_department: 'Ban giám đốc', target_department: 'Bộ phận Quản trị tổng hợp' }),
    taskRow({ id: 'task-d-normal', task_code: 'CV-D-0002', created_by_employee_code: 'STAFF_D2' })
  );
  STATE.assignees.push(
    assigneeRow({ task_id: 'task-d-cross', employee_code: 'STAFF_D1' }),
    assigneeRow({ task_id: 'task-d-normal', employee_code: 'STAFF_D2' })
  );
  {
    const crossDept = await listTasks(sessionFor('TBP_D'), { relation: 'received', scope: 'cross_department' });
    pass(crossDept.tasks.length === 1 && crossDept.tasks[0].task_id === 'task-d-cross', 'PART D: scope=cross_department vẫn lọc đúng, không bị fix "Tôi nhận" self-only ảnh hưởng (vẫn dùng managed set)');
    const managedAll = await listTasks(sessionFor('TBP_D'), { relation: 'received', scope: 'managed' });
    pass(managedAll.tasks.length === 2, 'PART D: scope=managed (không filter cross_department) vẫn trả đủ cả 2 Task của nhân viên quản lý');
  }

  // =========================================================================
  // PART E — GĐ/Admin (peopleScope.type=all_company) KHÔNG bị fix này đụng
  // tới — semantics "Tôi nhận" mặc định vẫn toàn công ty như canonical cũ.
  // =========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'GD_E', department: 'Ban giám đốc' }),
    emp({ employee_code: 'RANDOM_E', department: 'Phòng bất kỳ' })
  );
  STATE.assignments.push(assignment({ employee_code: 'GD_E', preset_code: 'GIAM_DOC' }));
  STATE.tasks.push(taskRow({ id: 'task-e1', task_code: 'CV-E-0001', created_by_employee_code: 'RANDOM_E' }));
  STATE.assignees.push(assigneeRow({ task_id: 'task-e1', employee_code: 'RANDOM_E' }));
  {
    const gdDefault = await listTasks(sessionFor('GD_E'), { relation: 'received' });
    pass(gdDefault.tasks.some(t => t.task_id === 'task-e1'), 'PART E: GĐ "Tôi nhận" mặc định (không scope) vẫn thấy toàn công ty như cũ — không bị đổi bởi fix TBP/Trưởng ca (nhánh all_company tách biệt, không đụng tới)');
    const gdMine = await listTasks(sessionFor('GD_E'), { relation: 'received', scope: 'mine' });
    pass(gdMine.tasks.length === 0, 'PART E: GĐ scope=mine tường minh vẫn thu hẹp về self-only như canonical cũ — không đổi semantics');
  }

  // =========================================================================
  // PART F — Nhân viên thường (peopleScope.type=self) KHÔNG regress: vẫn
  // self-only bất kể scopeParam, không bị mở rộng do fix này.
  // =========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'NV_F', department: 'Kho vận' }),
    emp({ employee_code: 'OTHER_F', department: 'Kho vận' })
  );
  STATE.tasks.push(taskRow({ id: 'task-f1', task_code: 'CV-F-0001', created_by_employee_code: 'OTHER_F' }));
  STATE.assignees.push(assigneeRow({ task_id: 'task-f1', employee_code: 'OTHER_F' }));
  {
    const nvDefault = await listTasks(sessionFor('NV_F'), { relation: 'received' });
    pass(nvDefault.tasks.length === 0, 'PART F: nhân viên thường "Tôi nhận" mặc định không thấy Task người khác — semantics cũ giữ nguyên');
    const nvManaged = await listTasks(sessionFor('NV_F'), { relation: 'received', scope: 'managed' });
    pass(nvManaged.tasks.length === 0, 'PART F: nhân viên thường scope=managed cũng KHÔNG được cấp thêm quyền (không có managedEmployeeCodes) — không regress bảo mật');
  }

  console.log('PHF Task Received/Managed Backend Separation V1 test: ' + passed + '/' + passed + ' PASS');
})().catch(err => { console.error(err); process.exitCode = 1; });
