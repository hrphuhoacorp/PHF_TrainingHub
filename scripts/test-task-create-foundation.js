'use strict';

/*
 * PHF Task — Category + Create Task Foundation — official mock/unit suite.
 *
 * MOCK TEST — KHÔNG PHẢI OFFICIAL DATA VERIFICATION. Supabase/Postgres bị
 * thay bằng in-memory stub; các RPC (task_create_draft, task_add_related,
 * task_add_link, task_delete_category_if_unused) CHƯA tồn tại trên Production
 * — mock responder bên dưới MÔ PHỎNG lại đúng logic đã audit/trích từ
 * scripts/PHF_TASK_CATEGORY_CREATE_FOUNDATION_1.70.0.sql để verify tầng
 * ORCHESTRATION (task-core.js): validate input, gọi đúng RPC với đúng tham
 * số, map lỗi đúng — KHÔNG phải verify lại chính SQL đó (SQL đã audit bằng
 * cách trích dẫn nguồn canonical, không viết mới từ trí nhớ). Zero DB thật,
 * zero network. Không gọi Production write ở bất kỳ đâu trong file này.
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
  try { await promiseFactory(); } catch (error) {
    if (checker) assert.ok(checker(error), message + ' — unexpected error: ' + (error && error.message) + ' (' + (error && error.code) + ')');
    pass(true, message); return;
  }
  assert.fail(message + ' — did not throw');
}
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

let idSeq = 0;
function makeQuery(rows, mode, payload) {
  const filters = [];
  let orderSpec = null;
  let limitN = null;
  function applyFilters(list) { return list.filter(row => filters.every(test => test(row))); }
  function execute() {
    if (mode === 'select') {
      let result = applyFilters(rows);
      if (orderSpec) result = result.slice().sort((a, b) => {
        const av = a[orderSpec.field], bv = b[orderSpec.field];
        const cmp = av > bv ? 1 : av < bv ? -1 : 0;
        return orderSpec.ascending ? cmp : -cmp;
      });
      if (limitN != null) result = result.slice(0, limitN);
      return { data: clone(result), error: null };
    }
    if (mode === 'insert') {
      const items = Array.isArray(payload) ? payload : [payload];
      const inserted = items.map(item => { const row = Object.assign({ id: 'mock-id-' + (++idSeq) }, item); rows.push(row); return row; });
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
    maybeSingle() { const { data, error } = execute(); const arr = Array.isArray(data) ? data : (data ? [data] : []); return Promise.resolve({ data: arr[0] || null, error }); },
    single() {
      const { data, error } = execute(); const arr = Array.isArray(data) ? data : (data ? [data] : []);
      if (!arr.length) return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
      return Promise.resolve({ data: arr[0], error });
    },
    then(resolve, reject) { try { resolve(execute()); } catch (error) { (reject || (() => {}))(error); } }
  };
  return builder;
}
function tableRouter(rows) {
  return {
    select() { return makeQuery(rows, 'select'); },
    insert(payload) { return makeQuery(rows, 'insert', payload); },
    update(payload) { return makeQuery(rows, 'update', payload); }
  };
}

const STATE = { employees: [], assignments: [], grants: [], categories: [], tasks: [], assignees: [], links: [], events: [], accounts: [] };
const rpcCalls = [];
let SIMULATE_V1_ONLY_SCHEMA = false;

function resetState() {
  STATE.employees.length = 0; STATE.assignments.length = 0; STATE.grants.length = 0; STATE.categories.length = 0;
  STATE.tasks.length = 0; STATE.assignees.length = 0; STATE.links.length = 0; STATE.events.length = 0; STATE.accounts.length = 0;
  rpcCalls.length = 0;
  // task-employee-scope.js cache loadOrgRows() 30s — phải invalidate mỗi
  // resetState() nếu không nhóm test sau đọc nhầm STATE.employees cũ.
  if (require.cache[scopePath]) require.cache[scopePath].exports.invalidateOrgCache();
}

// Mô phỏng lại đúng invariant của task_create_draft/task_add_related/
// task_add_link/task_delete_category_if_unused theo nguồn đã trích trong
// PHF_TASK_CATEGORY_CREATE_FOUNDATION_1.70.0.sql — KHÔNG phải test lại SQL
// thật, mà cho orchestration layer (task-core.js) 1 backend giả hợp lý để
// verify nó gọi đúng RPC, đúng tham số, và xử lý đúng lỗi trả về.
function rpcResponder(fnName, params) {
  if (fnName === 'task_create_draft') {
    if (!params.p_deadline) return { data: null, error: { message: 'TASK_DEADLINE_REQUIRED' } };
    if (params.p_start_at && new Date(params.p_start_at) > new Date(params.p_deadline)) return { data: null, error: { message: 'TASK_DATE_ORDER_INVALID' } };
    const category = STATE.categories.find(c => c.category_code === params.p_category_code);
    if (!category) return { data: null, error: { message: 'TASK_CATEGORY_NOT_FOUND' } };
    if (!category.is_active) return { data: null, error: { message: 'TASK_CATEGORY_INACTIVE' } };
    const task = { id: 'task-' + (++idSeq), flow_type: params.p_flow_type, status: 'draft', title: params.p_title, content: params.p_content || '', category_code: params.p_category_code, priority: params.p_priority, start_at: params.p_start_at, deadline: params.p_deadline, created_by_employee_code: params.p_actor_employee_code, row_version: 1 };
    STATE.tasks.push(task);
    if (params.p_primary_employee_code) STATE.assignees.push({ id: 'as-' + (++idSeq), task_id: task.id, employee_code: params.p_primary_employee_code, role: 'primary', is_active: true, assigned_by_employee_code: params.p_actor_employee_code });
    return { data: task, error: null };
  }
  if (fnName === 'task_add_related') {
    const target = String(params.p_target_employee_code || '').toUpperCase();
    if (!target) return { data: null, error: { message: 'TASK_RELATED_TARGET_REQUIRED' } };
    const isPrimary = STATE.assignees.some(a => a.task_id === params.p_task_id && a.employee_code === target && a.role === 'primary' && a.is_active);
    if (isPrimary) return { data: null, error: { message: 'TASK_RELATED_IS_PRIMARY' } };
    const existing = STATE.assignees.find(a => a.task_id === params.p_task_id && a.employee_code === target && a.role === 'related' && a.is_active);
    if (existing) return { data: existing, error: null }; // idempotent — không tạo thêm dòng trùng
    const row = { id: 'as-' + (++idSeq), task_id: params.p_task_id, employee_code: target, role: 'related', is_active: true, assigned_by_employee_code: params.p_actor_employee_code };
    STATE.assignees.push(row);
    return { data: row, error: null };
  }
  if (fnName === 'task_add_link') {
    const row = { id: 'link-' + (++idSeq), task_id: params.p_task_id, side: params.p_side, url: params.p_url, label: params.p_label || null, added_by_employee_code: params.p_actor_employee_code };
    STATE.links.push(row);
    return { data: row, error: null };
  }
  if (fnName === 'task_delete_category_if_unused') {
    const codeVal = String(params.p_category_code || '').toUpperCase();
    const inUse = STATE.tasks.some(t => t.category_code === codeVal);
    if (inUse) return { data: null, error: { message: 'TASK_CATEGORY_IN_USE' } };
    const before = STATE.categories.length;
    STATE.categories = STATE.categories.filter(c => c.category_code !== codeVal);
    if (STATE.categories.length === before) return { data: null, error: { message: 'TASK_CATEGORY_NOT_FOUND' } };
    return { data: true, error: null };
  }
  return null;
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
            if (table === 'task_permission_grants') return makeQuery(STATE.grants, 'select');
            if (table === 'task_categories') return tableRouter(STATE.categories);
            if (table === 'task_tasks') return tableRouter(STATE.tasks);
            if (table === 'task_assignees') return tableRouter(STATE.assignees);
            if (table === 'task_links') return tableRouter(STATE.links);
            if (table === 'task_events') return tableRouter(STATE.events);
            throw new Error('Unexpected table in mock client: ' + table);
          },
          rpc(fnName, params) {
            rpcCalls.push({ fnName, params: clone(params) });
            // Simula schema Production HIỆN TẠI (chỉ có task_create_draft V1,
            // 9 tham số) — nếu caller gửi kèm p_idempotency_key (V2, migration
            // 1.71.0 CHƯA apply), PostgREST thật sẽ trả PGRST202 "could not
            // find the function". Dùng để test callTaskCreateDraftRpc() tự
            // dò lại KHÔNG kèm key — KHÔNG được phá luồng tạo Task hiện tại.
            if (SIMULATE_V1_ONLY_SCHEMA && fnName === 'task_create_draft' && Object.prototype.hasOwnProperty.call(params, 'p_idempotency_key')) {
              return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.task_create_draft(...) in the schema cache' } });
            }
            const forced = rpcResponder(fnName, params);
            if (forced) return Promise.resolve(forced);
            return Promise.resolve({ data: Object.assign({ id: 'rpc-row-' + (++idSeq) }, params), error: null });
          }
        };
      }
    }
  };
  require.cache[employeeMasterPath] = { id: employeeMasterPath, filename: employeeMasterPath, loaded: true, exports: { loadCanonicalEmployeeProfiles() { return Promise.resolve({ rows: clone(STATE.employees), ready: true }); } } };
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { listHubAccountSummaries() { return Promise.resolve(clone(STATE.accounts)); } } };
  const scope = require(scopePath);
  const permissions = require(permissionsPath);
  const core = require(corePath);
  Module._resolveFilename = originalResolve;
  return { scope, permissions, core };
}

function emp(overrides) { return Object.assign({ employee_code: '', full_name: '', department: '', title: '', position: '', branch: '', manager_employee_code: '', employment_status: 'active' }, overrides); }
function assignment(overrides) { return Object.assign({ id: 'assign-' + (++idSeq), account_id: '', employee_code: '', preset_code: 'NHAN_VIEN', effective_from: '2020-01-01T00:00:00.000Z', effective_to: null, is_active: true, reason: 'seed', updated_at: new Date().toISOString() }, overrides); }
function cat(overrides) { return Object.assign({ category_code: '', display_name: '', description: '', color: '#64748B', is_active: true, sort_order: 1, updated_at: new Date().toISOString() }, overrides); }
function sessionFor(employeeCode) { return Object.freeze({ sub: 'sess-' + employeeCode, employeeCode, role: 'manager' }); }
function adminSession(accountId) { return Object.freeze({ sub: accountId, account: { id: accountId, role: 'admin', name: 'Admin QA' } }); }

(async () => {
  const { permissions, core } = loadWithMocks();
  const { canAssignTaskTo } = permissions;
  const { createTaskDraft, createTaskCategory, deleteTaskCategory, listTaskCategories, listAdminTaskCategories, addTaskRelated, addTaskLink } = core;

  // ===========================================================================
  // CATEGORY — 13 seed definitions correctness (golden check against the
  // migration SQL text itself, no DB involved).
  // ===========================================================================
  {
    const fs = require('fs');
    const sqlPath = path.join(ROOT, 'scripts', 'PHF_TASK_CATEGORY_CREATE_FOUNDATION_1.70.0.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    const expected = [
      ['BAO_CAO', 'Báo cáo', 1], ['TAI_CHINH', 'Tài chính', 2], ['KHO_VAN', 'Kho vận', 3],
      ['NHAN_SU', 'Nhân sự', 4], ['KINH_DOANH', 'Kinh doanh', 5], ['CONG_VIEC_TONG_THE', 'Công việc tổng thể', 6],
      ['THU_MUA', 'Thu mua', 7], ['CHAM_SOC_KHACH_HANG', 'Chăm sóc khách hàng', 8], ['DU_AN', 'Dự án', 9],
      ['PHAT_SINH_KHAC', 'Phát sinh khác', 10], ['DAO_TAO', 'Đào tạo', 11], ['SUA_CHUA', 'Sửa chữa', 12], ['THANH_TOAN', 'Thanh toán', 13]
    ];
    pass(expected.length === 13, 'CATEGORY seed: đúng 13 danh mục chính thức');
    const codes = expected.map(e => e[0]);
    pass(new Set(codes).size === 13, 'CATEGORY seed: 13 mã category_code không trùng nhau');
    expected.forEach(([codeVal, name, order]) => {
      pass(sql.includes("('" + codeVal + "', '" + name + "', true, " + order + ")"), 'CATEGORY seed: "' + name + '" đúng mã ' + codeVal + ' và sort_order ' + order);
    });
    pass(sql.includes('on conflict (category_code) do nothing'), 'CATEGORY seed: idempotent (on conflict do nothing) — chạy lại không tạo trùng');
  }

  // CATEGORY — used vs unused delete rule, audit identity
  resetState();
  STATE.categories.push(cat({ category_code: 'CAT_UNUSED', display_name: 'Chưa dùng', sort_order: 1 }));
  STATE.categories.push(cat({ category_code: 'CAT_USED', display_name: 'Đã dùng', sort_order: 2 }));
  STATE.tasks.push({ id: 'task-x', category_code: 'CAT_USED' });
  {
    const admin = adminSession('admin-cat-1');
    await deleteTaskCategory(admin, 'CAT_UNUSED');
    pass(!STATE.categories.some(c => c.category_code === 'CAT_UNUSED'), 'CATEGORY: danh mục CHƯA từng dùng được xóa vật lý');
    await rejects(
      () => deleteTaskCategory(admin, 'CAT_USED'),
      error => error && error.code === 'TASK_CATEGORY_IN_USE',
      'CATEGORY: danh mục ĐÃ từng dùng KHÔNG được xóa vật lý (TASK_CATEGORY_IN_USE)'
    );
    pass(STATE.categories.some(c => c.category_code === 'CAT_USED'), 'CATEGORY: danh mục đã dùng vẫn còn nguyên sau khi từ chối xóa');
  }

  // CATEGORY — inactive không selectable ở listTaskCategories (danh sách tạo Task)
  resetState();
  STATE.categories.push(cat({ category_code: 'CAT_ACTIVE', display_name: 'Đang dùng', is_active: true, sort_order: 1 }));
  STATE.categories.push(cat({ category_code: 'CAT_INACTIVE', display_name: 'Ngừng dùng', is_active: false, sort_order: 2 }));
  STATE.employees.push(emp({ employee_code: 'NV_CAT', full_name: 'NV bất kỳ' }));
  {
    const result = await listTaskCategories(sessionFor('NV_CAT'));
    const codesShown = result.categories.map(c => c.category_code);
    pass(codesShown.includes('CAT_ACTIVE') && !codesShown.includes('CAT_INACTIVE'), 'CATEGORY: danh mục inactive KHÔNG xuất hiện trong picker tạo Task mới');
  }

  // CATEGORY — audit identity trên createTaskCategory
  resetState();
  {
    const admin = adminSession('admin-cat-2');
    const { category } = await createTaskCategory(admin, { categoryCode: 'CAT_NEW', displayName: 'Danh mục mới' });
    pass(category.category_code === 'CAT_NEW', 'CATEGORY: tạo mới thành công qua Admin');
    const stored = STATE.categories.find(c => c.category_code === 'CAT_NEW');
    pass(stored.created_by_account_id === 'admin-cat-2' && !stored.created_by_employee_code, 'CATEGORY: audit identity ghi đúng account_id cho actor Admin (employee_code rỗng đúng model)');
  }

  // ===========================================================================
  // CREATE TASK
  // ===========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'TBP_CREATOR', full_name: 'TBP tạo việc' }),
    emp({ employee_code: 'STAFF_ACTIVE', full_name: 'NV active', manager_employee_code: 'TBP_CREATOR' }),
    emp({ employee_code: 'STAFF_INACTIVE', full_name: 'NV nghỉ việc', employment_status: 'inactive' })
  );
  STATE.assignments.push(assignment({ employee_code: 'TBP_CREATOR', preset_code: 'TRUONG_BO_PHAN' }));
  STATE.categories.push(cat({ category_code: 'CAT_OK', display_name: 'OK', is_active: true }));
  STATE.categories.push(cat({ category_code: 'CAT_OFF', display_name: 'Ngừng', is_active: false }));
  {
    const session = sessionFor('TBP_CREATOR');
    await rejects(
      () => createTaskDraft(session, { flowType: 'giao_viec', title: 'T', categoryCode: '', priority: 'thuong', deadline: '2026-09-01T01:00:00.000Z', primaryEmployeeCode: 'STAFF_ACTIVE' }),
      error => error && error.code === 'TASK_CATEGORY_REQUIRED',
      'CREATE TASK: category bắt buộc'
    );
    await rejects(
      () => createTaskDraft(session, { flowType: 'giao_viec', title: 'T', categoryCode: 'CAT_KHONG_TON_TAI', priority: 'thuong', deadline: '2026-09-01T01:00:00.000Z', primaryEmployeeCode: 'STAFF_ACTIVE' }),
      error => error && error.code === 'TASK_CATEGORY_NOT_FOUND',
      'CREATE TASK: category không tồn tại bị từ chối'
    );
    await rejects(
      () => createTaskDraft(session, { flowType: 'giao_viec', title: 'T', categoryCode: 'CAT_OFF', priority: 'thuong', deadline: '2026-09-01T01:00:00.000Z', primaryEmployeeCode: 'STAFF_ACTIVE' }),
      error => error && error.code === 'TASK_CATEGORY_INACTIVE',
      'CREATE TASK: category inactive bị từ chối'
    );
    await rejects(
      () => createTaskDraft(session, { flowType: 'giao_viec', title: '', categoryCode: 'CAT_OK', priority: 'thuong', deadline: '2026-09-01T01:00:00.000Z', primaryEmployeeCode: 'STAFF_ACTIVE' }),
      error => error && error.code === 'TASK_TITLE_REQUIRED',
      'CREATE TASK: title bắt buộc'
    );
    await rejects(
      () => createTaskDraft(session, { flowType: 'giao_viec', title: 'T', categoryCode: 'CAT_OK', priority: 'thuong', primaryEmployeeCode: 'STAFF_ACTIVE' }),
      error => error && error.code === 'TASK_DEADLINE_REQUIRED',
      'CREATE TASK: deadline bắt buộc'
    );
    await rejects(
      () => createTaskDraft(session, { flowType: 'giao_viec', title: 'T', categoryCode: 'CAT_OK', priority: 'thuong', startAt: '2026-09-02T00:00:00.000Z', deadline: '2026-09-01T00:00:00.000Z', primaryEmployeeCode: 'STAFF_ACTIVE' }),
      error => error && error.code === 'TASK_DATE_ORDER_INVALID',
      'CREATE TASK: deadline trước start bị từ chối'
    );
    await rejects(
      () => createTaskDraft(session, { flowType: 'giao_viec', title: 'T', categoryCode: 'CAT_OK', priority: 'thuong', deadline: '2026-09-01T01:00:00.000Z', primaryEmployeeCode: 'STAFF_INACTIVE' }),
      error => error && error.code === 'TASK_ASSIGN_DENIED',
      'CREATE TASK: Primary inactive bị từ chối (không assign được cho người đã nghỉ)'
    );

    const created = await createTaskDraft(session, { flowType: 'giao_viec', title: 'Việc thật', categoryCode: 'CAT_OK', priority: 'thuong', startAt: '2026-09-01T01:00:00.000Z', deadline: '2026-09-02T01:00:00.000Z', primaryEmployeeCode: 'STAFF_ACTIVE' });
    pass(created.status === 'draft' && created.category_code === 'CAT_OK', 'CREATE TASK: tạo thành công đúng field khi hợp lệ');
    pass(created.created_by_employee_code === 'TBP_CREATOR', 'CREATE TASK: actor identity ghi đúng (không suy từ HR title — TBP_CREATOR không có title nào được dùng để quyết định)');

    // IDEMPOTENCY SIGNATURE FALLBACK (Task Code + Idempotency Foundation V1) —
    // migration 1.71.0 CHƯA apply Production; createTaskDraft() giờ LUÔN gửi
    // p_idempotency_key. Phải tự dò lại KHÔNG kèm key nếu RPC báo "function
    // not found" (PGRST202) — KHÔNG được phá luồng tạo Task hiện tại đang chạy
    // thật trên schema V1 (9 tham số).
    SIMULATE_V1_ONLY_SCHEMA = true;
    const beforeFallbackCalls = rpcCalls.length;
    const createdViaFallback = await createTaskDraft(session, { flowType: 'giao_viec', title: 'Việc qua fallback', categoryCode: 'CAT_OK', priority: 'thuong', deadline: '2026-09-01T01:00:00.000Z', primaryEmployeeCode: 'STAFF_ACTIVE', idempotencyKey: '11111111-2222-3333-4444-555555555555' });
    pass(createdViaFallback.status === 'draft' && createdViaFallback.title === 'Việc qua fallback', 'IDEMPOTENCY FALLBACK: create vẫn thành công khi RPC Production chỉ còn chữ ký V1 (chưa apply 1.71.0)');
    const fallbackCalls = rpcCalls.slice(beforeFallbackCalls);
    pass(fallbackCalls.length === 2 && fallbackCalls[0].fnName === 'task_create_draft' && fallbackCalls[1].fnName === 'task_create_draft', 'IDEMPOTENCY FALLBACK: đúng 2 lần gọi task_create_draft — lần 1 kèm key (từ chối), lần 2 không kèm key (thành công)');
    pass(Object.prototype.hasOwnProperty.call(fallbackCalls[0].params, 'p_idempotency_key') && !Object.prototype.hasOwnProperty.call(fallbackCalls[1].params, 'p_idempotency_key'), 'IDEMPOTENCY FALLBACK: lần gọi lại loại bỏ đúng p_idempotency_key, giữ nguyên các tham số khác');
    SIMULATE_V1_ONLY_SCHEMA = false;
  }

  // CREATE TASK — unauthorized assignment (NHAN_VIEN chỉ assign self)
  resetState();
  STATE.employees.push(emp({ employee_code: 'NV_SELF', full_name: 'NV thường' }), emp({ employee_code: 'NV_OTHER', full_name: 'Đồng nghiệp' }));
  STATE.categories.push(cat({ category_code: 'CAT_OK', is_active: true }));
  {
    await rejects(
      () => createTaskDraft(sessionFor('NV_SELF'), { flowType: 'giao_viec', title: 'T', categoryCode: 'CAT_OK', priority: 'thuong', deadline: '2026-09-01T01:00:00.000Z', primaryEmployeeCode: 'NV_OTHER' }),
      error => error && error.code === 'TASK_ASSIGN_DENIED',
      'CREATE TASK: NHAN_VIEN không được giao việc cho người khác (unauthorized assignment)'
    );
  }

  // CREATE TASK — cross-department allowed, peer manager allowed
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'TBP_X', full_name: 'TBP phòng X', department: 'Phòng X' }),
    emp({ employee_code: 'STAFF_Y', full_name: 'NV phòng Y (không thuộc quản lý TBP_X)', department: 'Phòng Y' }),
    emp({ employee_code: 'TBP_Z', full_name: 'TBP khác (peer manager)', department: 'Phòng Z' })
  );
  STATE.assignments.push(assignment({ employee_code: 'TBP_X', preset_code: 'TRUONG_BO_PHAN' }));
  STATE.assignments.push(assignment({ employee_code: 'TBP_Z', preset_code: 'TRUONG_BO_PHAN' }));
  STATE.categories.push(cat({ category_code: 'CAT_OK', is_active: true }));
  {
    pass((await canAssignTaskTo(sessionFor('TBP_X'), 'STAFF_Y')) === true, 'CROSS-DEPARTMENT: TBP giao được cho NV khác phòng ban (assignScope=all_company)');
    const created = await createTaskDraft(sessionFor('TBP_X'), { flowType: 'giao_viec', title: 'Việc liên phòng ban', categoryCode: 'CAT_OK', priority: 'thuong', deadline: '2026-09-01T01:00:00.000Z', primaryEmployeeCode: 'STAFF_Y' });
    pass(created.status === 'draft', 'CROSS-DEPARTMENT: Task liên phòng ban tạo thành công, có hiệu lực ngay, không cần TBP phòng Y duyệt');
    pass((await canAssignTaskTo(sessionFor('TBP_X'), 'TBP_Z')) === true, 'PEER MANAGER: TBP giao được cho TBP khác (giao ngang cấp cho phép, không block)');
  }

  // ===========================================================================
  // RELATED / CC
  // ===========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'CREATOR_R', full_name: 'Người tạo' }),
    emp({ employee_code: 'PRIMARY_R', full_name: 'Primary' }),
    emp({ employee_code: 'CC1', full_name: 'CC 1' }),
    emp({ employee_code: 'CC2', full_name: 'CC 2 khác phòng xa' }),
    emp({ employee_code: 'CC_INACTIVE', full_name: 'CC nghỉ việc', employment_status: 'inactive' })
  );
  STATE.tasks.push({ id: 'task-r', status: 'draft', row_version: 1, created_by_account_id: null, created_by_employee_code: 'CREATOR_R' });
  STATE.assignees.push({ id: 'as-r1', task_id: 'task-r', employee_code: 'PRIMARY_R', role: 'primary', is_active: true });
  {
    await addTaskRelated(sessionFor('CREATOR_R'), 'task-r', 'CC1');
    pass(STATE.assignees.some(a => a.task_id === 'task-r' && a.employee_code === 'CC1' && a.role === 'related'), 'RELATED: thêm CC thành công');
    await addTaskRelated(sessionFor('CREATOR_R'), 'task-r', 'CC2');
    pass(STATE.assignees.filter(a => a.role === 'related' && a.is_active).length === 2, 'RELATED: nhiều CC cùng lúc được cho phép, bất kỳ ai active toàn công ty');

    await rejects(
      () => addTaskRelated(sessionFor('CREATOR_R'), 'task-r', 'CC_INACTIVE'),
      error => error && error.code === 'TASK_RELATED_TARGET_DENIED',
      'RELATED: CC inactive bị từ chối'
    );
    await rejects(
      () => addTaskRelated(sessionFor('CREATOR_R'), 'task-r', 'PRIMARY_R'),
      error => error && error.code === 'TASK_RELATED_IS_PRIMARY',
      'RELATED: không thể thêm chính Primary hiện hành làm CC'
    );

    const beforeCount = STATE.assignees.filter(a => a.role === 'related' && a.is_active).length;
    await addTaskRelated(sessionFor('CREATOR_R'), 'task-r', 'CC1');
    const afterCount = STATE.assignees.filter(a => a.role === 'related' && a.is_active).length;
    pass(beforeCount === afterCount, 'RELATED: thêm lại cùng 1 CC là idempotent — không tạo dòng trùng');

    pass(rpcCalls.filter(c => c.fnName === 'task_add_related').length === 3, 'RELATED: orchestration gọi đúng RPC task_add_related — CC1, CC2, và lần thêm lại CC1 (3 lần); CC_INACTIVE/PRIMARY_R bị chặn ở JS trước khi tới RPC nên không tính');
  }

  // RELATED != Primary responsibility — CC không tự có quyền Hoàn thành Task
  // (đã verify ở scripts/test-task-permission-v1.js LIFECYCLE; xác nhận lại
  // ở đây rằng completeTask/updateTaskProgress chỉ chấp nhận đúng Primary
  // hiện hành, không có nhánh nào cho role='related').
  //
  // TEST_MAINTENANCE (2026-08-27, seam refactor — integration-neutral, xem
  // task-server-integration.js): logic primary-check được tách khỏi
  // completeTask() vào seam resolveAndAuthorizeComplete() (dùng chung cho
  // cả path Supabase lẫn phf-hr-api, KHÔNG duplicate business rule) — kiểm
  // tra chuyển sang đúng hàm chứa logic thật hôm nay, giữ nguyên Ý ĐỊNH gốc
  // của assertion (không có nhánh role='related' nào cho phép complete).
  {
    const coreSource = require('fs').readFileSync(path.join(ROOT, 'api', '_lib', 'task-core.js'), 'utf8');
    const seamFn = coreSource.slice(coreSource.indexOf('async function resolveAndAuthorizeComplete'), coreSource.indexOf('async function categoryActive'));
    pass(seamFn.includes("role === 'primary'") && !seamFn.includes("role === 'related'"), 'RELATED: resolveAndAuthorizeComplete() (dùng bởi completeTask) chỉ kiểm tra role primary — CC không complete thay được chỉ vì có quan hệ related');
  }

  // ===========================================================================
  // LINK
  // ===========================================================================
  resetState();
  STATE.employees.push(emp({ employee_code: 'CREATOR_L', full_name: 'Người tạo' }));
  STATE.tasks.push({ id: 'task-l', status: 'draft', row_version: 1, created_by_account_id: null, created_by_employee_code: 'CREATOR_L' });
  STATE.assignees.push({ id: 'as-l1', task_id: 'task-l', employee_code: 'CREATOR_L', role: 'primary', is_active: true });
  {
    await addTaskLink(sessionFor('CREATOR_L'), 'task-l', 'input_reference', 'https://example.com/doc', 'Tài liệu A');
    pass(STATE.links.length === 1, 'LINK: thêm link hợp lệ thành công');
    await rejects(
      () => addTaskLink(sessionFor('CREATOR_L'), 'task-l', 'input_reference', 'not-a-valid-url', ''),
      error => error && error.code === 'TASK_LINK_URL_INVALID',
      'LINK: URL không hợp lệ (không http/https) bị từ chối, không gọi RPC'
    );
    await rejects(
      () => addTaskLink(sessionFor('CREATOR_L'), 'task-l', 'invalid_side', 'https://example.com', ''),
      error => error && error.code === 'TASK_LINK_SIDE_INVALID',
      'LINK: side không hợp lệ bị từ chối'
    );
  }

  // ===========================================================================
  // ATOMICITY — chiến lược partial-write hiện tại (createTaskDraft atomic qua
  // RPC; addRelated/addLink là supplement rời sau đó, CÓ THỂ fail độc lập).
  // Test này xác nhận ĐÚNG THỰC TRẠNG (không phải RPC transaction lồng nhau)
  // để tài liệu hóa rủi ro partial-write cho báo cáo, không giả định đã có
  // orchestration RPC lớn hơn.
  // ===========================================================================
  {
    const coreSource = require('fs').readFileSync(path.join(ROOT, 'api', '_lib', 'task-core.js'), 'utf8');
    pass(coreSource.includes("supabase.rpc('task_create_draft'"), 'ATOMICITY: createTaskDraft tự atomic qua RPC (task + primary trong 1 transaction) — qua callTaskCreateDraftRpc() (Create Hardening/Task Code V1: wrapper tự fallback bỏ p_idempotency_key nếu RPC V2 chưa apply, vẫn gọi đúng 1 RPC task_create_draft, KHÔNG tách 2 lời gọi)');
    pass(!coreSource.includes("callRpc('task_create_draft_with_supplements'"), 'ATOMICITY: chưa có RPC orchestration lớn gộp create+related+link — xác nhận đúng thực trạng hiện tại (client tự retry qua persistTaskSupplements/retryTaskSupplements ở phf-task-app.js, không giả vờ đã atomic)');
  }

  console.log('PHF Task Category + Create Foundation mock test: ' + passed + '/' + passed + ' PASS');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
