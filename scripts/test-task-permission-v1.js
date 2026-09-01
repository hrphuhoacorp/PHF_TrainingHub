'use strict';

/*
 * PHF Task Permission V1 — official mock/unit test suite.
 *
 * MOCK TEST — KHÔNG PHẢI OFFICIAL DATA VERIFICATION. Toàn bộ Supabase client
 * (@supabase/supabase-js), People Master reader (api/_lib/employee-master.js)
 * và auth (api/_lib/auth.js) đều bị thay bằng in-memory stub bên dưới. Không
 * có kết nối DB thật, không ghi dữ liệu thật ở bất kỳ đâu trong file này.
 * Xác minh chính thức trên dữ liệu thật (RPC/schema/OFFICIAL DATA
 * VERIFICATION) vẫn phải làm riêng, sau khi migration Foundation Correction
 * được áp dụng — xem PHF_TASK_PERMISSION_V1_PHASE_1_5 report.
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
const corePath = require.resolve(path.join(ROOT, 'api', '_lib', 'task-core'));

let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }
async function rejects(promiseFactory, checker, message) {
  try {
    await promiseFactory();
  } catch (error) {
    if (checker) assert.ok(checker(error), message + ' — unexpected error: ' + (error && error.message));
    pass(true, message);
    return;
  }
  assert.fail(message + ' — did not throw');
}

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

// ---------------------------------------------------------------------------
// In-memory Supabase-like table mock — supports exactly the chain shapes
// used by task-core.js / task-permissions.js (select/insert/update, eq/lte/
// in/or, order, limit, maybeSingle/single, and plain await/then).
// ---------------------------------------------------------------------------
let idSeq = 0;
function makeQuery(rows, mode, payload) {
  const filters = [];
  let orderSpec = null;
  let limitN = null;

  function applyFilters(list) { return list.filter(row => filters.every(test => test(row))); }

  function execute() {
    if (mode === 'select') {
      let result = applyFilters(rows);
      if (orderSpec) {
        result = result.slice().sort((a, b) => {
          const av = a[orderSpec.field], bv = b[orderSpec.field];
          const cmp = av > bv ? 1 : av < bv ? -1 : 0;
          return orderSpec.ascending ? cmp : -cmp;
        });
      }
      if (limitN != null) result = result.slice(0, limitN);
      return { data: clone(result), error: null };
    }
    if (mode === 'insert') {
      const items = Array.isArray(payload) ? payload : [payload];
      const inserted = items.map(item => {
        const row = Object.assign({ id: 'mock-id-' + (++idSeq) }, item);
        rows.push(row);
        return row;
      });
      return { data: clone(Array.isArray(payload) ? inserted : inserted[0]), error: null };
    }
    if (mode === 'update') {
      const matched = applyFilters(rows);
      matched.forEach(row => Object.assign(row, payload));
      return { data: clone(matched), error: null };
    }
    return { data: null, error: null };
  }

  const builder = {
    select() { return builder; },
    eq(field, value) { filters.push(row => String(row[field]) === String(value)); return builder; },
    lte(field, value) { filters.push(row => String(row[field]) <= String(value)); return builder; },
    in(field, values) { const set = new Set((values || []).map(String)); filters.push(row => set.has(String(row[field]))); return builder; },
    or(expression) {
      const clauses = String(expression || '').split(',').map(raw => {
        const match = raw.match(/^([a-z_]+)\.eq\.(.*)$/);
        return match ? row => String(row[match[1]]) === match[2] : () => false;
      });
      filters.push(row => clauses.some(test => test(row)));
      return builder;
    },
    order(field, opts) { orderSpec = { field, ascending: !opts || opts.ascending !== false }; return builder; },
    limit(n) { limitN = n; return builder; },
    maybeSingle() {
      const { data, error } = execute();
      const arr = Array.isArray(data) ? data : (data ? [data] : []);
      return Promise.resolve({ data: arr[0] || null, error });
    },
    single() {
      const { data, error } = execute();
      const arr = Array.isArray(data) ? data : (data ? [data] : []);
      if (!arr.length) return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
      return Promise.resolve({ data: arr[0], error });
    },
    then(resolve, reject) {
      try { resolve(execute()); } catch (error) { (reject || (() => {}))(error); }
    }
  };
  return builder;
}

const STATE = { employees: [], assignments: [], grants: [], grantHistory: [], tasks: [], assignees: [], accounts: [] };
const rpcCalls = [];
let rpcResponder = null; // (fnName, params) => { data, error } | null (null = default success echo)

function resetState() {
  STATE.employees.length = 0;
  STATE.assignments.length = 0;
  STATE.grants.length = 0;
  STATE.grantHistory.length = 0;
  STATE.tasks.length = 0;
  STATE.assignees.length = 0;
  STATE.accounts.length = 0;
  rpcCalls.length = 0;
  rpcResponder = null;
  // task-employee-scope.js caches loadOrgRows() for 30s — must invalidate or
  // the next test group reads stale rows from the previous STATE.employees.
  if (require.cache[scopePath]) require.cache[scopePath].exports.invalidateOrgCache();
}

function loadWithMocks() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === '@supabase/supabase-js') return supabasePath;
    return originalResolve.call(this, request, ...rest);
  };
  [supabasePath, employeeMasterPath, authPath, scopePath, permissionsPath, corePath].forEach(p => { delete require.cache[p]; });

  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: {
      createClient() {
        return {
          from(table) {
            if (table === 'task_permission_assignments') return makeQuery(STATE.assignments, 'select');
            if (table === 'task_permission_grants') return tableRouter(STATE.grants);
            if (table === 'task_permission_grant_history') return tableRouter(STATE.grantHistory);
            if (table === 'task_tasks') return tableRouter(STATE.tasks);
            if (table === 'task_assignees') return tableRouter(STATE.assignees);
            throw new Error('Unexpected table in mock client: ' + table);
          },
          rpc(fnName, params) {
            rpcCalls.push({ fnName, params: clone(params) });
            if (rpcResponder) {
              const forced = rpcResponder(fnName, params);
              if (forced) return Promise.resolve(forced);
            }
            return Promise.resolve({ data: Object.assign({ id: 'rpc-row-' + (++idSeq) }, params), error: null });
          }
        };
      }
    }
  };

  // task_permission_assignments needs insert/update support too (not used by
  // task-permissions.js directly today, but keep parity with real table shape).
  function tableRouter(rows) {
    return {
      select() { return makeQuery(rows, 'select'); },
      insert(payload) { return makeQuery(rows, 'insert', payload); },
      update(payload) { return makeQuery(rows, 'update', payload); },
      eq(field, value) { return makeQuery(rows, 'select').eq(field, value); },
      lte(field, value) { return makeQuery(rows, 'select').lte(field, value); },
      in(field, values) { return makeQuery(rows, 'select').in(field, values); },
      order(field, opts) { return makeQuery(rows, 'select').order(field, opts); },
      limit(n) { return makeQuery(rows, 'select').limit(n); }
    };
  }

  require.cache[employeeMasterPath] = {
    id: employeeMasterPath, filename: employeeMasterPath, loaded: true,
    exports: {
      loadCanonicalEmployeeProfiles() { return Promise.resolve({ rows: clone(STATE.employees), ready: true }); }
    }
  };
  require.cache[authPath] = {
    id: authPath, filename: authPath, loaded: true,
    exports: { listHubAccountSummaries() { return Promise.resolve(clone(STATE.accounts)); } }
  };

  const scope = require(scopePath);
  const permissions = require(permissionsPath);
  const core = require(corePath);
  Module._resolveFilename = originalResolve;
  return { scope, permissions, core };
}

function emp(overrides) {
  return Object.assign({
    employee_code: '', full_name: '', department: '', title: '', position: '',
    branch: '', manager_employee_code: '', employment_status: 'active'
  }, overrides);
}
function assignment(overrides) {
  const now = new Date().toISOString();
  return Object.assign({
    id: 'assign-' + (++idSeq), account_id: '', employee_code: '', preset_code: 'NHAN_VIEN',
    effective_from: '2020-01-01T00:00:00.000Z', effective_to: null, is_active: true,
    reason: 'seed', updated_at: now
  }, overrides);
}
function sessionFor(employeeCode) { return Object.freeze({ sub: 'sess-' + employeeCode, employeeCode, role: 'manager' }); }
function adminSession(accountId) { return Object.freeze({ sub: accountId, account: { id: accountId, role: 'admin', name: 'Admin QA' } }); }

(async () => {
  const { permissions, core } = loadWithMocks();
  const {
    resolveEffectiveTaskScope, resolveBaseTaskScope, canViewTask, canUpdateTask,
    resolveUpdateAuthorityBasis, resolveDirectCancelAuthorityBasis, canAssignTaskTo, canAddTaskRelated, listTaskAssignableEmployees,
    resolveAttachmentUploadAuthorityBasis, resolveAttachmentManageAuthorityBasis, resolveTaskViewerAuthority
  } = permissions;
  const {
    createTaskPermissionGrant, saveTaskPermissionAssignment, reopenTask, cancelTask,
    completeTask, addTaskRelated, resolveAndAuthorizeAttachmentUpload, resolveAttachmentManageBasis
  } = core;

  // =========================================================================
  // ROLE
  // =========================================================================
  resetState();
  STATE.employees.push(emp({ employee_code: 'NV_NOASSIGN', full_name: 'Chưa gán preset' }));
  {
    const { actorContext } = await resolveEffectiveTaskScope(sessionFor('NV_NOASSIGN'));
    pass(actorContext.actorType === 'nhan_vien', 'ROLE: no assignment => NHAN_VIEN');
  }

  resetState();
  STATE.employees.push(emp({ employee_code: 'TITLE_TRAP', full_name: 'Bẫy chức danh', title: 'Trưởng bộ phận' }));
  {
    const { actorContext } = await resolveEffectiveTaskScope(sessionFor('TITLE_TRAP'));
    pass(actorContext.actorType === 'nhan_vien', 'ROLE: HR title "Trưởng bộ phận" nhưng no assignment => vẫn NHAN_VIEN (không suy role từ title)');
  }

  resetState();
  {
    const { actorContext, scope } = await resolveEffectiveTaskScope(adminSession('admin-acc-1'));
    pass(actorContext.actorType === 'admin', 'ROLE: Admin bypass — actorType=admin');
    pass(scope.capabilities.view && scope.capabilities.assign && scope.capabilities.update && scope.capabilities.manage, 'ROLE: Admin có đủ 4 capability');
    pass(scope.peopleScope.type === 'all_company' && scope.assignScope.type === 'all_company', 'ROLE: Admin scope = all_company cả hai chiều');
  }

  resetState();
  STATE.employees.push(emp({ employee_code: 'GD1', full_name: 'Giám đốc QA' }));
  STATE.assignments.push(assignment({ employee_code: 'GD1', preset_code: 'GIAM_DOC' }));
  {
    const { actorContext, scope } = await resolveEffectiveTaskScope(sessionFor('GD1'));
    pass(actorContext.actorType === 'giam_doc', 'ROLE: GĐ preset resolved');
    pass(scope.peopleScope.type === 'all_company' && scope.assignScope.type === 'all_company', 'ROLE: GĐ = all_company');
  }

  resetState();
  STATE.employees.push(emp({ employee_code: 'TL1', full_name: 'Trợ lý GĐ QA' }));
  STATE.assignments.push(assignment({ employee_code: 'TL1', preset_code: 'TRO_LY_GD' }));
  {
    const { actorContext, scope } = await resolveEffectiveTaskScope(sessionFor('TL1'));
    pass(actorContext.actorType === 'tro_ly_gd', 'ROLE: TL GĐ preset resolved');
    pass(scope.peopleScope.type === 'all_company' && scope.assignScope.type === 'all_company', 'ROLE: TL GĐ = all_company');
  }

  {
    const tbpScope = resolveBaseTaskScope({ actorType: 'truong_bo_phan', employeeCode: 'X', managedEmployeeCodes: new Set(['A', 'B']) });
    const tcScope = resolveBaseTaskScope({ actorType: 'truong_ca', employeeCode: 'X', managedEmployeeCodes: new Set(['A', 'B']) });
    pass(JSON.stringify(tbpScope.capabilities) === JSON.stringify(tcScope.capabilities), 'ROLE: TBP/TC parity — capabilities giống hệt nhau');
    pass(JSON.stringify(tbpScope.assignScope) === JSON.stringify(tcScope.assignScope), 'ROLE: TBP/TC parity — assignScope giống hệt nhau');
    pass(JSON.stringify(tbpScope.peopleScope) === JSON.stringify(tcScope.peopleScope), 'ROLE: TBP/TC parity — peopleScope giống hệt nhau (cùng employeeCode/managed)');
  }

  // =========================================================================
  // SCOPE
  // =========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'TBP1', full_name: 'TBP QA', department: 'Kho' }),
    emp({ employee_code: 'SUB1', full_name: 'Cấp dưới trực tiếp', department: 'Kho', manager_employee_code: 'TBP1' }),
    emp({ employee_code: 'SUB2', full_name: 'Cấp dưới khác phòng', department: 'Bán hàng', manager_employee_code: 'SUB1' }),
    emp({ employee_code: 'OUT1', full_name: 'Ngoài phạm vi', department: 'Thu mua' }),
    emp({ employee_code: 'OUT_INACTIVE', full_name: 'Đã nghỉ', employment_status: 'inactive' })
  );
  STATE.assignments.push(assignment({ employee_code: 'TBP1', preset_code: 'TRUONG_BO_PHAN' }));
  {
    const assignOut1 = await canAssignTaskTo(sessionFor('TBP1'), 'OUT1');
    pass(assignOut1 === true, 'SCOPE: TBP assign được nhân viên active toàn công ty (kể cả ngoài phòng ban)');
    const assignInactive = await canAssignTaskTo(sessionFor('TBP1'), 'OUT_INACTIVE');
    pass(assignInactive === false, 'SCOPE/EMPLOYEE: inactive employee không assignable');

    const viewOut1Task = { createdByAccountId: '', createdByEmployeeCode: 'ADMINX' };
    const viewOut1Assignees = [{ employeeCode: 'OUT1', role: 'primary', isActive: true }];
    const canViewOut1 = await canViewTask(sessionFor('TBP1'), viewOut1Task, viewOut1Assignees);
    pass(canViewOut1 === false, 'SCOPE: assignScope != peopleScope — TBP được assign OUT1 nhưng KHÔNG được view Task của OUT1');

    const managedTask = { createdByAccountId: '', createdByEmployeeCode: 'ADMINX' };
    const managedAssignees = [{ employeeCode: 'SUB2', role: 'primary', isActive: true }];
    const canViewManagedCrossDept = await canViewTask(sessionFor('TBP1'), managedTask, managedAssignees);
    pass(canViewManagedCrossDept === true, 'SCOPE: TBP xem được Task của nhân viên trong chuỗi quản lý dù khác phòng ban (cross-department)');

    pass((await canViewTask(sessionFor('TBP1'), { createdByAccountId: '', createdByEmployeeCode: 'ADMINX' }, [{ employeeCode: 'OUT1', role: 'primary', isActive: true }])) === false,
      'SCOPE: TBP/TC không view-all (không thấy Task ngoài phạm vi quản lý)');
  }

  // manager_of_primary gap fix — section 3
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'MGR_NOPRESET', full_name: 'HR manager, không có Task preset' }),
    emp({ employee_code: 'SUB_A', full_name: 'Báo cáo cho MGR_NOPRESET', manager_employee_code: 'MGR_NOPRESET' }),
    emp({ employee_code: 'TBP2', full_name: 'TBP có preset' }),
    emp({ employee_code: 'SUB_B', full_name: 'Báo cáo cho TBP2', manager_employee_code: 'TBP2' })
  );
  STATE.assignments.push(assignment({ employee_code: 'TBP2', preset_code: 'TRUONG_BO_PHAN' }));
  {
    const taskA = { createdByAccountId: '', createdByEmployeeCode: 'SOMEONE_ELSE' };
    const assigneesA = [{ employeeCode: 'SUB_A', role: 'primary', isActive: true }];
    const viewByPlainManager = await canViewTask(sessionFor('MGR_NOPRESET'), taskA, assigneesA);
    pass(viewByPlainManager === false, 'GAP FIX: HR manager relation + NHAN_VIEN preset => KHÔNG auto manager-view');

    const taskB = { createdByAccountId: '', createdByEmployeeCode: 'SOMEONE_ELSE' };
    const assigneesB = [{ employeeCode: 'SUB_B', role: 'primary', isActive: true }];
    const viewByTbp = await canViewTask(sessionFor('TBP2'), taskB, assigneesB);
    pass(viewByTbp === true, 'GAP FIX: cùng relation + TBP preset => manager-view PASS');
  }

  resetState();
  STATE.employees.push(emp({ employee_code: 'NV2', full_name: 'NV thường' }), emp({ employee_code: 'NV3', full_name: 'Đồng nghiệp' }));
  {
    pass((await canAssignTaskTo(sessionFor('NV2'), 'NV2')) === true, 'SCOPE: Nhân viên assign self => PASS');
    pass((await canAssignTaskTo(sessionFor('NV2'), 'NV3')) === false, 'SCOPE: Nhân viên assign người khác => FAIL (chỉ assign self)');
  }

  // =========================================================================
  // UPDATE
  // =========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'CREATOR1', full_name: 'Người tạo' }),
    emp({ employee_code: 'PRIMARY1', full_name: 'Primary' }),
    emp({ employee_code: 'OUTSIDER1', full_name: 'Người ngoài scope' })
  );
  STATE.tasks.push({ id: 'task-1', status: 'published', row_version: 3, created_by_account_id: null, created_by_employee_code: 'CREATOR1' });
  STATE.assignees.push({ id: 'as-1', task_id: 'task-1', employee_code: 'PRIMARY1', role: 'primary', is_active: true });
  {
    // creator authority PASS — reopen reaches RPC even though creator has no elevated scope
    rpcCalls.length = 0;
    await reopenTask(sessionFor('CREATOR1'), 'task-1', 3, 'Lý do mở lại');
    pass(rpcCalls.some(c => c.fnName === 'task_reopen'), 'UPDATE: creator authority PASS — reopen bởi creator (NHAN_VIEN) vẫn tới được RPC');

    // non-creator ngoài scope => FAIL
    await rejects(
      () => reopenTask(sessionFor('OUTSIDER1'), 'task-1', 3, 'Lý do'),
      error => error && error.code === 'TASK_UPDATE_DENIED' && error.statusCode === 403,
      'UPDATE: non-creator ngoài scope => reopen FAIL (TASK_UPDATE_DENIED)'
    );

    // reopen reason required — simulate the RPC-side (Postgres) rejection và
    // xác nhận throwRpc map đúng lỗi ra JS; đây là biên phía JS/RPC-mapping,
    // KHÔNG phải xác minh business rule bên trong SQL thật (cần OFFICIAL DATA
    // VERIFICATION riêng sau migration).
    rpcResponder = (fnName) => fnName === 'task_reopen' ? { data: null, error: { message: 'TASK_REOPEN_REASON_REQUIRED' } } : null;
    await rejects(
      () => reopenTask(sessionFor('CREATOR1'), 'task-1', 3, ''),
      error => error && error.code === 'TASK_REOPEN_REASON_REQUIRED' && error.statusCode === 400,
      'UPDATE: reopen reason required — RPC error mapped đúng qua throwRpc'
    );
    rpcResponder = null;

    // cancel ngoài scope => FAIL cùng cơ chế
    await rejects(
      () => cancelTask(sessionFor('OUTSIDER1'), 'task-1', 3, 'Hủy'),
      error => error && error.code === 'TASK_UPDATE_DENIED',
      'UPDATE: non-creator ngoài scope => cancel FAIL'
    );
  }

  // =========================================================================
  // UPDATE — MANAGED-VIEW INTERVENTION BOUNDARY (LOCKED AUTHORITY RULE 2026-08-28)
  // A TBP/TC seeing a Task only because its primary is in their managed tree
  // gets VIEW + COMMENT, never lifecycle intervention (M1/T1 fix).
  // =========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'MGR_X', full_name: 'TBP quản lý SUB_M' }),
    emp({ employee_code: 'SUB_M', full_name: 'Nhân viên do MGR_X quản lý', manager_employee_code: 'MGR_X' }),
    emp({ employee_code: 'GD_Z', full_name: 'Giám đốc' }),
    emp({ employee_code: 'CREATOR_Q', full_name: 'Quản lý phòng khác tạo Task' })
  );
  STATE.assignments.push(
    assignment({ employee_code: 'MGR_X', preset_code: 'TRUONG_BO_PHAN' }),
    assignment({ employee_code: 'GD_Z', preset_code: 'GIAM_DOC' })
  );
  STATE.tasks.push({ id: 'task-mv', status: 'in_progress', row_version: 7, created_by_account_id: null, created_by_employee_code: 'CREATOR_Q' });
  STATE.assignees.push({ id: 'as-mv', task_id: 'task-mv', employee_code: 'SUB_M', role: 'primary', is_active: true });
  {
    const mvTask = { createdByAccountId: '', createdByEmployeeCode: 'CREATOR_Q' };
    const mvAssignees = [{ employeeCode: 'SUB_M', role: 'primary', isActive: true }];

    pass((await canViewTask(sessionFor('MGR_X'), mvTask, mvAssignees)) === true,
      'BOUNDARY: MGR_X vẫn XEM được Task của nhân sự mình quản lý (follow)');
    pass((await canUpdateTask(sessionFor('MGR_X'), mvTask, mvAssignees)) === false,
      'BOUNDARY: managed relationship KHÔNG đủ để can thiệp — canUpdateTask=false');
    pass((await resolveUpdateAuthorityBasis(sessionFor('MGR_X'), mvTask, mvAssignees)) === null,
      'BOUNDARY: resolveUpdateAuthorityBasis(MGR_X) = null');

    await rejects(
      () => cancelTask(sessionFor('MGR_X'), 'task-mv', 7, 'Hủy hộ'),
      error => error && error.code === 'TASK_UPDATE_DENIED' && error.statusCode === 403,
      'BOUNDARY: MGR_X cancel Task của SUB_M (do người khác tạo) => TASK_UPDATE_DENIED'
    );
    await rejects(
      () => reopenTask(sessionFor('MGR_X'), 'task-mv', 7, 'Mở lại hộ'),
      error => error && error.code === 'TASK_UPDATE_DENIED',
      'BOUNDARY: MGR_X reopen Task của SUB_M => TASK_UPDATE_DENIED'
    );

    // Executive authority — GĐ can intervene on the same Task.
    pass((await resolveUpdateAuthorityBasis(sessionFor('GD_Z'), mvTask, mvAssignees)) === 'executive_authority',
      'BOUNDARY: GĐ có basis executive_authority trên chính Task đó');
    rpcCalls.length = 0;
    await cancelTask(sessionFor('GD_Z'), 'task-mv', 7, 'GĐ hủy');
    pass(rpcCalls.some(c => c.fnName === 'task_cancel'), 'BOUNDARY: GĐ cancel Task của SUB_M => tới RPC (Rule A giữ nguyên)');

    // Current primary acting on their own Task — task relationship.
    pass((await resolveUpdateAuthorityBasis(sessionFor('SUB_M'), mvTask, mvAssignees)) === 'active_primary',
      'BOUNDARY: primary hiện hành có basis active_primary trên Task của chính mình');

    // CANCEL POLICY V1 — resolveDirectCancelAuthorityBasis drops active_primary,
    // keeps management bases.
    pass((await resolveDirectCancelAuthorityBasis(sessionFor('SUB_M'), mvTask, mvAssignees)) === null,
      'CANCEL POLICY V1: active primary is NOT a direct canceller (basis null)');
    pass((await resolveDirectCancelAuthorityBasis(sessionFor('GD_Z'), mvTask, mvAssignees)) === 'executive_authority',
      'CANCEL POLICY V1: executive still has a direct-cancel basis');
    pass((await resolveDirectCancelAuthorityBasis(sessionFor('MGR_X'), mvTask, mvAssignees)) === null,
      'CANCEL POLICY V1: plain manager has no direct-cancel basis');
    await rejects(
      () => cancelTask(sessionFor('SUB_M'), 'task-mv', 7, 'Tôi muốn hủy việc của mình'),
      error => error && error.code === 'TASK_CANCEL_REQUEST_REQUIRED' && error.statusCode === 403,
      'CANCEL POLICY V1: active primary direct cancelTask() => TASK_CANCEL_REQUEST_REQUIRED (403)'
    );
    rpcCalls.length = 0;
    await cancelTask(sessionFor('GD_Z'), 'task-mv', 7, 'GĐ vẫn hủy trực tiếp được');
    pass(rpcCalls.some(c => c.fnName === 'task_cancel'), 'CANCEL POLICY V1: executive direct cancel still reaches task_cancel RPC');

    // A grant that only re-states the managed tree does NOT widen beyond base
    // scope => still no intervention (locked rule: "BEYOND their base scope").
    STATE.grants.push({
      id: 'grant-redundant', grantee_employee_code: 'MGR_X', grant_type: 'extend', is_active: true,
      effective_from: '2020-01-01T00:00:00.000Z', effective_to: null,
      people_scope: { type: 'employees', values: ['SUB_M'] }, capabilities: {}
    });
    if (require.cache[scopePath]) require.cache[scopePath].exports.invalidateOrgCache();
    pass((await resolveUpdateAuthorityBasis(sessionFor('MGR_X'), mvTask, mvAssignees)) === null,
      'BOUNDARY: grant chỉ lặp lại managed tree => vẫn KHÔNG có quyền can thiệp');

    // A grant naming someone OUTSIDE the managed tree DOES confer intervention
    // over that specific person (explicit, deliberate authorization).
    STATE.employees.push(emp({ employee_code: 'OUT_P', full_name: 'Nhân sự ngoài chuỗi quản lý MGR_X' }));
    STATE.grants.push({
      id: 'grant-explicit', grantee_employee_code: 'MGR_X', grant_type: 'extend', is_active: true,
      effective_from: '2020-01-01T00:00:00.000Z', effective_to: null,
      people_scope: { type: 'employees', values: ['OUT_P'] }, capabilities: {}
    });
    if (require.cache[scopePath]) require.cache[scopePath].exports.invalidateOrgCache();
    const outTask = { createdByAccountId: '', createdByEmployeeCode: 'CREATOR_Q' };
    const outAssignees = [{ employeeCode: 'OUT_P', role: 'primary', isActive: true }];
    pass((await resolveUpdateAuthorityBasis(sessionFor('MGR_X'), outTask, outAssignees)) === 'exception_grant',
      'BOUNDARY: exception grant nêu đích danh người NGOÀI managed tree => basis exception_grant');
  }

  // =========================================================================
  // LIFECYCLE
  // =========================================================================
  resetState();
  STATE.employees.push(emp({ employee_code: 'CREATOR2', full_name: 'Người tạo khác' }), emp({ employee_code: 'PRIMARY2', full_name: 'Primary trực tiếp' }));
  STATE.tasks.push({ id: 'task-2', status: 'in_progress', row_version: 5, created_by_account_id: null, created_by_employee_code: 'CREATOR2' });
  STATE.assignees.push({ id: 'as-2', task_id: 'task-2', employee_code: 'PRIMARY2', role: 'primary', is_active: true });
  {
    rpcCalls.length = 0;
    await completeTask(sessionFor('PRIMARY2'), 'task-2', 5, 'Đã xong');
    pass(rpcCalls.some(c => c.fnName === 'task_complete'), 'LIFECYCLE: Primary complete => gọi task_complete trực tiếp, không có bước duyệt trung gian trong JS');
    pass(!rpcCalls.some(c => c.fnName !== 'task_complete'), 'LIFECYCLE: completeTask không gọi thêm RPC nào khác (không có creator-approval step)');

    await rejects(
      () => completeTask(sessionFor('CREATOR2'), 'task-2', 5, 'Đã xong'),
      error => error && error.code === 'TASK_COMPLETE_ACTOR_DENIED',
      'LIFECYCLE: creator KHÔNG phải primary thì không được bấm Hoàn thành thay (Primary Complete trực tiếp, không phải creator)'
    );

    // CANCEL POLICY V1 — the primary of task-2 cannot direct-cancel; the
    // creator still can.
    await rejects(
      () => cancelTask(sessionFor('PRIMARY2'), 'task-2', 5, 'Xin hủy'),
      error => error && error.code === 'TASK_CANCEL_REQUEST_REQUIRED' && error.statusCode === 403,
      'CANCEL POLICY V1: PRIMARY2 direct cancelTask() => TASK_CANCEL_REQUEST_REQUIRED'
    );
    rpcCalls.length = 0;
    await cancelTask(sessionFor('CREATOR2'), 'task-2', 5, 'Người tạo hủy');
    pass(rpcCalls.some(c => c.fnName === 'task_cancel'), 'CANCEL POLICY V1: creator direct cancel still works (task_cancel RPC)');
  }

  // =========================================================================
  // FILE ATTACHMENT V1 — upload / manage authority (2026-08-31)
  // =========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'ATT_CREATOR', full_name: 'Người giao' }),
    emp({ employee_code: 'ATT_PRIMARY', full_name: 'Người phụ trách' }),
    emp({ employee_code: 'ATT_CC', full_name: 'Người liên quan' }),
    emp({ employee_code: 'ATT_STRANGER', full_name: 'Người ngoài' }),
    emp({ employee_code: 'ATT_GD', full_name: 'Giám đốc' })
  );
  STATE.assignments.push(assignment({ employee_code: 'ATT_GD', preset_code: 'GIAM_DOC' }));
  STATE.tasks.push({ id: 'att-task', status: 'in_progress', row_version: 2, created_by_account_id: null, created_by_employee_code: 'ATT_CREATOR' });
  STATE.assignees.push(
    { id: 'att-as-1', task_id: 'att-task', employee_code: 'ATT_PRIMARY', role: 'primary', is_active: true },
    { id: 'att-as-2', task_id: 'att-task', employee_code: 'ATT_CC', role: 'related', is_active: true }
  );
  {
    const taskRow = { id: 'att-task', status: 'in_progress', row_version: 2, created_by_account_id: null, created_by_employee_code: 'ATT_CREATOR' };
    const assigneeRows = [
      { employee_code: 'ATT_PRIMARY', role: 'primary', is_active: true },
      { employee_code: 'ATT_CC', role: 'related', is_active: true },
    ];
    const loadAssignees = () => Promise.resolve(assigneeRows);
    const relAssignees = assigneeRows.map(a => ({ employeeCode: a.employee_code, role: a.role, isActive: a.is_active }));
    const relTask = { createdByAccountId: null, createdByEmployeeCode: 'ATT_CREATOR' };

    // UPLOAD — creator
    const c1 = await resolveAndAuthorizeAttachmentUpload(sessionFor('ATT_CREATOR'), taskRow, loadAssignees);
    pass(c1.interventionBasis === 'creator', 'ATTACHMENT: creator/assigner được upload (basis creator)');
    // UPLOAD — active primary
    const c2 = await resolveAndAuthorizeAttachmentUpload(sessionFor('ATT_PRIMARY'), taskRow, loadAssignees);
    pass(c2.interventionBasis === 'active_primary', 'ATTACHMENT: active primary được upload (basis active_primary)');
    // UPLOAD — management (Giám đốc)
    const c3 = await resolveAndAuthorizeAttachmentUpload(sessionFor('ATT_GD'), taskRow, loadAssignees);
    pass(c3.interventionBasis === 'executive_authority', 'ATTACHMENT: Giám đốc được upload (basis executive_authority)');
    // UPLOAD — plain related/CC denied
    await rejects(
      () => resolveAndAuthorizeAttachmentUpload(sessionFor('ATT_CC'), taskRow, loadAssignees),
      e => e && e.code === 'TASK_ATTACHMENT_UPLOAD_DENIED' && e.statusCode === 403,
      'ATTACHMENT: CC/related thuần -> TASK_ATTACHMENT_UPLOAD_DENIED'
    );
    // UPLOAD — unrelated stranger denied
    await rejects(
      () => resolveAndAuthorizeAttachmentUpload(sessionFor('ATT_STRANGER'), taskRow, loadAssignees),
      e => e && e.code === 'TASK_ATTACHMENT_UPLOAD_DENIED',
      'ATTACHMENT: người ngoài -> TASK_ATTACHMENT_UPLOAD_DENIED (proposer-by-status-alone cũng rơi vào nhánh này)'
    );

    // canonical resolver (task-permissions) mirrors the seam
    pass((await resolveAttachmentUploadAuthorityBasis(sessionFor('ATT_PRIMARY'), relTask, relAssignees)) === 'active_primary',
      'ATTACHMENT: resolveAttachmentUploadAuthorityBasis(active primary) = active_primary');

    // MANAGE (remove-other) — bare active primary is NOT enough
    pass((await resolveAttachmentManageBasis(sessionFor('ATT_PRIMARY'), taskRow, assigneeRows)) === null,
      'ATTACHMENT: active primary KHÔNG có manage basis (chỉ được gỡ file của chính mình)');
    pass((await resolveAttachmentManageBasis(sessionFor('ATT_CREATOR'), taskRow, assigneeRows)) === 'creator',
      'ATTACHMENT: creator có manage basis');
    pass((await resolveAttachmentManageBasis(sessionFor('ATT_GD'), taskRow, assigneeRows)) === 'executive_authority',
      'ATTACHMENT: Giám đốc có manage basis (executive_authority)');
    pass((await resolveAttachmentManageBasis(sessionFor('ATT_CC'), taskRow, assigneeRows)) === null,
      'ATTACHMENT: CC/related không có manage basis');
    pass((await resolveAttachmentManageAuthorityBasis(sessionFor('ATT_CC'), relTask, relAssignees)) === null,
      'ATTACHMENT: resolveAttachmentManageAuthorityBasis(CC) = null');

    // DTO — viewer authority flags derive from the SAME resolvers
    const vPrimary = await resolveTaskViewerAuthority(sessionFor('ATT_PRIMARY'), taskRow, [
      { employee_code: 'ATT_PRIMARY', role: 'primary', is_active: true },
      { employee_code: 'ATT_CC', role: 'related', is_active: true },
    ]);
    pass(vPrimary.actions.upload_attachment === true && vPrimary.attachment_upload_basis === 'active_primary' && vPrimary.attachment_manage_basis === null,
      'ATTACHMENT DTO: active primary -> upload_attachment=true, manage_basis=null');
    const vCc = await resolveTaskViewerAuthority(sessionFor('ATT_CC'), taskRow, [
      { employee_code: 'ATT_PRIMARY', role: 'primary', is_active: true },
      { employee_code: 'ATT_CC', role: 'related', is_active: true },
    ]);
    pass(vCc.actions.upload_attachment === false && vCc.attachment_upload_basis === null,
      'ATTACHMENT DTO: CC/related -> upload_attachment=false');
    const vCreator = await resolveTaskViewerAuthority(sessionFor('ATT_CREATOR'), taskRow, [
      { employee_code: 'ATT_PRIMARY', role: 'primary', is_active: true },
    ]);
    pass(vCreator.actions.upload_attachment === true && vCreator.attachment_manage_basis === 'creator' && vCreator.actor_employee_code === 'ATT_CREATOR',
      'ATTACHMENT DTO: creator -> upload=true, manage_basis=creator, actor_employee_code stamped');
  }

  // delegation not exposed
  resetState();
  STATE.employees.push(emp({ employee_code: 'NV4', full_name: 'NV bất kỳ' }));
  {
    await rejects(
      () => createTaskPermissionGrant(adminSession('admin-acc-2'), { granteeEmployeeCode: 'NV4', grantType: 'delegation', reason: 'thử delegation' }),
      error => error && error.code === 'TASK_PERMISSION_GRANT_TYPE_NOT_SUPPORTED',
      'LIFECYCLE: delegation not exposed — createTaskPermissionGrant từ chối grantType=delegation'
    );
  }

  // =========================================================================
  // EMPLOYEE
  // =========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'TBP3', full_name: 'TBP QA 3' }),
    emp({ employee_code: 'GONE1', full_name: 'Đã nghỉ việc', employment_status: 'inactive' })
  );
  STATE.assignments.push(assignment({ employee_code: 'TBP3', preset_code: 'TRUONG_BO_PHAN' }));
  {
    pass((await canAssignTaskTo(sessionFor('TBP3'), 'GONE1')) === false, 'EMPLOYEE: inactive employee không assignable');
    const listResult = await listTaskAssignableEmployees(sessionFor('TBP3'));
    pass(!listResult.employees.some(row => row.employeeCode === 'GONE1'), 'EMPLOYEE: listTaskAssignableEmployees loại trừ nhân viên inactive');
    pass(listResult.requesterActorType === 'truong_bo_phan', 'EMPLOYEE: listTaskAssignableEmployees trả kèm requesterActorType đúng (phục vụ peer-manager warning)');

    await rejects(
      () => createTaskPermissionGrant(adminSession('admin-acc-3'), { granteeEmployeeCode: 'GONE1', grantType: 'extend', peopleScope: { type: 'all_company' }, reason: 'thử' }),
      error => error && error.code === 'TASK_PERMISSION_GRANTEE_INACTIVE',
      'EMPLOYEE: inactive employee không nhận grant mới'
    );
    await rejects(
      () => saveTaskPermissionAssignment(adminSession('admin-acc-3'), { employeeCode: 'GONE1', presetCode: 'NHAN_VIEN', reason: 'thử' }),
      error => error && error.code === 'TASK_PERMISSION_GRANTEE_INACTIVE',
      'EMPLOYEE: inactive employee không nhận preset assignment mới'
    );
  }

  // =========================================================================
  // GRANT
  // =========================================================================
  resetState();
  STATE.employees.push(emp({ employee_code: 'NV5', full_name: 'NV nhận grant' }), emp({ employee_code: 'NV6', full_name: 'Được mở rộng tới' }));
  {
    await rejects(
      () => createTaskPermissionGrant(adminSession('admin-acc-4'), { granteeEmployeeCode: 'NV5', grantType: 'restrict', reason: 'thử restrict' }),
      error => error && error.code === 'TASK_PERMISSION_GRANT_TYPE_NOT_SUPPORTED',
      'GRANT: extend only — grantType=restrict bị từ chối'
    );
    await rejects(
      () => createTaskPermissionGrant(adminSession('admin-acc-4'), { granteeEmployeeCode: 'NV5', grantType: 'extend', capabilities: { manage: true }, peopleScope: { type: 'all_company' }, reason: 'thử capability' }),
      error => error && error.code === 'TASK_PERMISSION_CAPABILITY_NOT_SUPPORTED',
      'GRANT: không mở capability — capabilities object non-empty bị từ chối'
    );

    const { grant } = await createTaskPermissionGrant(adminSession('admin-acc-4'), {
      granteeEmployeeCode: 'NV5', grantType: 'extend', peopleScope: { type: 'employees', values: ['NV6'] }, reason: 'Mở rộng peopleScope'
    });
    pass(!!grant && grant.grant_type === 'extend', 'GRANT: extend grant tạo thành công (mock insert)');

    const { scope: baseScope } = await resolveEffectiveTaskScope(sessionFor('NV5'));
    pass(baseScope.assignScope.type === 'self' && baseScope.assignScope.values.length === 1 && baseScope.assignScope.values[0] === 'NV5',
      'GRANT: không đổi assignScope — vẫn self sau khi grant peopleScope');
    pass(baseScope.peopleScope.values.includes('NV6'), 'GRANT: peopleScope được extend đúng như grant');
  }

  // =========================================================================
  // RELATED / CC — business rule CHỐT ở Tạo phiếu V1 mục 4: CC = bất kỳ
  // active employee toàn công ty, không giới hạn theo peopleScope/assignScope.
  // =========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'TBP4', full_name: 'TBP QA 4' }),
    emp({ employee_code: 'SUB_C', full_name: 'Quản lý bởi TBP4', manager_employee_code: 'TBP4' }),
    emp({ employee_code: 'OUT2', full_name: 'Ngoài phạm vi quản lý' }),
    emp({ employee_code: 'OUT_INACTIVE2', full_name: 'Ngoài phạm vi, đã nghỉ', employment_status: 'inactive' })
  );
  STATE.assignments.push(assignment({ employee_code: 'TBP4', preset_code: 'TRUONG_BO_PHAN' }));
  {
    pass((await canAddTaskRelated(sessionFor('TBP4'), 'OUT2')) === true, 'RELATED/CC: TBP thêm được OUT2 làm CC dù ngoài peopleScope quản lý — CC toàn công ty theo business rule mới');
    pass((await canAddTaskRelated(sessionFor('TBP4'), 'SUB_C')) === true, 'RELATED/CC: TBP vẫn thêm được SUB_C (trong phạm vi quản lý) làm CC');
    pass((await canAddTaskRelated(sessionFor('TBP4'), 'OUT_INACTIVE2')) === false, 'RELATED/CC: employee inactive không được chọn làm CC dù toàn công ty được mở');
  }

  resetState();
  STATE.employees.push(
    emp({ employee_code: 'NV_CC1', full_name: 'NV bất kỳ' }),
    emp({ employee_code: 'FAR_DEPT', full_name: 'Người khác phòng ban xa' })
  );
  {
    pass((await canAddTaskRelated(sessionFor('NV_CC1'), 'FAR_DEPT')) === true, 'RELATED/CC: NHAN_VIEN thường cũng thêm được bất kỳ ai active làm CC (không giới hạn theo preset của actor)');
  }

  resetState();
  STATE.employees.push(
    emp({ employee_code: 'CREATOR3', full_name: 'NV tự tạo task' }),
    emp({ employee_code: 'PRIMARY3', full_name: 'Primary' }),
    emp({ employee_code: 'COLLEAGUE1', full_name: 'Đồng nghiệp khác' }),
    emp({ employee_code: 'OUTSIDER2', full_name: 'Người ngoài, không có update authority' })
  );
  STATE.tasks.push({ id: 'task-3', status: 'draft', row_version: 1, created_by_account_id: null, created_by_employee_code: 'CREATOR3' });
  STATE.assignees.push({ id: 'as-3', task_id: 'task-3', employee_code: 'PRIMARY3', role: 'primary', is_active: true });
  {
    // creator (dù NHAN_VIEN) thêm CC bất kỳ ai active — target-eligibility không còn là bottleneck.
    await addTaskRelated(sessionFor('CREATOR3'), 'task-3', 'COLLEAGUE1');
    pass(true, 'RELATED/CC: creator (NHAN_VIEN) thêm được đồng nghiệp bất kỳ làm CC — target không còn bị giới hạn bởi peopleScope self');

    // Nhưng người KHÔNG có update-authority trên Task đó (không phải creator,
    // không match peopleScope của primary) vẫn KHÔNG được thêm CC — canAddTaskRelated
    // chỉ quyết định TARGET có hợp lệ hay không, còn quyền SỬA Task vẫn do
    // requireUpdateAuthority() gác ở task-core.js, không bị nới theo rule CC mới.
    await rejects(
      () => addTaskRelated(sessionFor('OUTSIDER2'), 'task-3', 'COLLEAGUE1'),
      error => error && error.code === 'TASK_UPDATE_DENIED',
      'RELATED/CC: mở rộng target-eligibility KHÔNG mở rộng quyền sửa Task — người ngoài update-authority vẫn bị chặn ở requireUpdateAuthority trước khi chạm tới target check'
    );
  }

  console.log('PHF Task Permission V1 mock test: ' + passed + '/' + passed + ' PASS');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
