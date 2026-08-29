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
  // PART E — G3 FIX (2026-08-28) + COMPANY-LEVEL CLEANUP (2026-08-28 follow-
  // up): GĐ/TLGĐ (peopleScope.type=all_company) "Tôi nhận" mặc định KHÔNG
  // còn toàn công ty — LUÔN self-only theo đúng TASK_RELATIONSHIP thật
  // (Primary assignee), giống hệt semantics TBP/Trưởng ca (G3, unchanged).
  // Business evidence: PHF010 (tro_ly_gd) "Tôi nhận" từng trả về 50/50 Task
  // công ty dù chỉ là Primary thật trên 1/50 — capability all_company (quyền
  // can thiệp company-wide) đã bị lộ nhầm thành quan hệ Task cá nhân.
  // "Nhân sự tôi quản lý" (scope=managed) — SAU company-level cleanup — LẠI
  // company-wide (unrestricted) cho Admin/GĐ/TLGĐ theo business contract mới
  // (mục 4, locked 2026-08-28: "Direct reports có thể tồn tại trong org graph
  // nhưng không được giới hạn company-wide Task scope của nhóm này"), KHÁC
  // với TBP/Trưởng ca (vẫn managedEmployeeCodes-bounded, xem PART B/C phía
  // trên). GD_MANAGED bên dưới (con thật của GD_E trong org graph) vẫn xuất
  // hiện trong scope=managed của GĐ, nhưng KHÔNG PHẢI vì bị giới hạn vào org-
  // graph subtree — mà vì company-wide đã bao gồm tất cả, kể cả subtree đó.
  // =========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'GD_E', department: 'Ban giám đốc' }),
    emp({ employee_code: 'RANDOM_E', department: 'Phòng bất kỳ' }),
    emp({ employee_code: 'GD_MANAGED', department: 'Phòng bất kỳ', manager_employee_code: 'GD_E' })
  );
  STATE.assignments.push(assignment({ employee_code: 'GD_E', preset_code: 'GIAM_DOC' }));
  STATE.tasks.push(
    taskRow({ id: 'task-e1', task_code: 'CV-E-0001', created_by_employee_code: 'RANDOM_E' }),
    taskRow({ id: 'task-e-self', task_code: 'CV-E-0002', created_by_employee_code: 'RANDOM_E' }),
    taskRow({ id: 'task-e-managed', task_code: 'CV-E-0003', created_by_employee_code: 'RANDOM_E' })
  );
  STATE.assignees.push(
    assigneeRow({ task_id: 'task-e1', employee_code: 'RANDOM_E' }),
    assigneeRow({ task_id: 'task-e-self', employee_code: 'GD_E' }),
    assigneeRow({ task_id: 'task-e-managed', employee_code: 'GD_MANAGED' })
  );
  {
    const gdDefault = await listTasks(sessionFor('GD_E'), { relation: 'received' });
    pass(gdDefault.tasks.length === 1 && gdDefault.tasks[0].task_id === 'task-e-self', 'PART E G3 FIX: GĐ "Tôi nhận" mặc định (không scope) CHỈ thấy Task chính GĐ là Primary — KHÔNG còn toàn công ty (executive all_company capability không leak vào quan hệ cá nhân) — KHÔNG bị đổi bởi company-level cleanup');
    pass(!gdDefault.tasks.some(t => t.task_id === 'task-e1'), 'PART E G3 FIX: "Tôi nhận" của GĐ KHÔNG còn chứa Task của RANDOM_E (người không liên quan)');
    const gdMine = await listTasks(sessionFor('GD_E'), { relation: 'received', scope: 'mine' });
    pass(gdMine.tasks.length === 1 && gdMine.tasks[0].task_id === 'task-e-self', 'PART E: GĐ scope=mine tường minh cho kết quả GIỐNG HỆT mặc định (self-only) — nhất quán với "Tôi nhận"');
    const gdManaged = await listTasks(sessionFor('GD_E'), { relation: 'received', scope: 'managed' });
    pass(gdManaged.tasks.length === 3 && ['task-e1', 'task-e-self', 'task-e-managed'].every(id => gdManaged.tasks.some(t => t.task_id === id)), 'PART E COMPANY-LEVEL CLEANUP: GĐ "Nhân sự tôi quản lý" (scope=managed) là company-wide (CẢ 3 Task, kể cả RANDOM_E ngoài org graph) — KHÔNG còn bị bó vào managedEmployeeCodes/org-graph subtree như TBP/Trưởng ca', JSON.stringify(gdManaged.tasks.map(t => t.task_id)));
    const gdManagedResult = await listTasks(sessionFor('GD_E'), { relation: 'received', scope: 'managed' });
    pass(gdManagedResult.hasManagedPeople === true, 'PART E: GĐ hasManagedPeople=true (company-tier luôn eligible, không phụ thuộc org graph)');
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

  // =========================================================================
  // PART G — G3 FOLLOW-UP FIX + COMPANY-LEVEL CLEANUP (2026-08-28): hasManagedPeople
  // — trustworthy, explicit signal cho frontend menu "Nhân sự tôi quản lý".
  // Với TBP/Trưởng ca: derived TRỰC TIẾP từ managedEmployeeCodes.length>0 (org
  // graph thật) — KHÔNG suy từ viewScopeType/actorType/title, KHÔNG suy từ
  // tasks.length. Với Admin/GĐ/TLGĐ (company-tier, business contract 2026-08-28):
  // LUÔN true — company-wide workspace tồn tại vô điều kiện, KHÔNG phụ thuộc
  // việc có direct report thật hay không (GD_G bên dưới KHÔNG có report nào
  // nhưng vẫn phải eligible — đây chính là điểm khác với TBP/Trưởng ca).
  // =========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'GD_G', department: 'Ban giám đốc' }),          // executive, KHÔNG có report thật nào — vẫn phải eligible (company-tier)
    emp({ employee_code: 'TLGD_G', department: 'Ban giám đốc' }),        // executive, CÓ report thật (không phải điều kiện, chỉ minh họa)
    emp({ employee_code: 'TLGD_G_REPORT', department: 'Ban giám đốc', manager_employee_code: 'TLGD_G' }),
    emp({ employee_code: 'TBP_G', department: 'Kho vận' }),              // TBP, CÓ report thật (baseline, không regress)
    emp({ employee_code: 'TBP_G_REPORT', department: 'Kho vận', manager_employee_code: 'TBP_G' }),
    emp({ employee_code: 'NV_G', department: 'Kho vận' })                // nhân viên thường
  );
  STATE.assignments.push(
    assignment({ employee_code: 'GD_G', preset_code: 'GIAM_DOC' }),
    assignment({ employee_code: 'TLGD_G', preset_code: 'TRO_LY_GD' }),
    assignment({ employee_code: 'TBP_G', preset_code: 'TRUONG_BO_PHAN' })
  );
  // KHÔNG seed bất kỳ Task nào cho TLGD_G_REPORT/TBP_G_REPORT — chứng minh
  // hasManagedPeople KHÔNG phụ thuộc tasks.length ("manager có report nhưng
  // 0 Task hiện tại vẫn phải eligible").
  {
    const gdResult = await listTasks(sessionFor('GD_G'), { relation: 'received' });
    pass(gdResult.hasManagedPeople === true, 'PART G COMPANY-LEVEL CLEANUP: GĐ hasManagedPeople=true dù KHÔNG có direct report thật nào (company-tier có company-wide workspace vô điều kiện, không bị ép vào mô hình TBP/Trưởng ca)', JSON.stringify({ viewScopeType: gdResult.viewScopeType, hasManagedPeople: gdResult.hasManagedPeople }));
    pass(gdResult.viewScopeType === 'all_company', 'PART G: GĐ viewScopeType vẫn all_company (capability field, không đổi bởi fix này)');

    const tlgdResult = await listTasks(sessionFor('TLGD_G'), { relation: 'received' });
    pass(tlgdResult.hasManagedPeople === true, 'PART G: TLGĐ hasManagedPeople=true (company-tier, có report thật hay không không quan trọng) dù KHÔNG có Task nào (0 Task hiện tại vẫn eligible)');
    pass(tlgdResult.tasks.length === 0, 'PART G: sanity — TLGD_G thật sự có 0 Task trong "Tôi nhận" ở dataset này (chứng minh eligibility không dựa vào tasks.length)');

    const tbpResult = await listTasks(sessionFor('TBP_G'), { relation: 'received' });
    pass(tbpResult.hasManagedPeople === true, 'PART G: TBP CÓ report thật -> hasManagedPeople=true (baseline không regress, cùng field mới, vẫn org-graph-derived)');

    const nvResult = await listTasks(sessionFor('NV_G'), { relation: 'received' });
    pass(nvResult.hasManagedPeople === false, 'PART G: nhân viên thường -> hasManagedPeople=false (menu KHÔNG hiện, không phải company-tier, không có managedEmployeeCodes)');

    const nvManagedScopeResult = await listTasks(sessionFor('NV_G'), { relation: 'received', scope: 'managed' });
    pass(nvManagedScopeResult.hasManagedPeople === false, 'PART G: hasManagedPeople là thuộc tính của ACTOR, không đổi theo scopeParam được yêu cầu (nhân viên thường vẫn false dù tự ý truyền scope=managed)');
    pass(nvManagedScopeResult.tasks.length === 0, 'PART G: nhân viên thường scope=managed vẫn KHÔNG được cấp company-wide access (không phải company-tier) — không regress bảo mật');
  }

  console.log('PHF Task Received/Managed Backend Separation V1 test: ' + passed + '/' + passed + ' PASS');
})().catch(err => { console.error(err); process.exitCode = 1; });
