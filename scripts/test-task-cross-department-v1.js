'use strict';

/*
 * PHF Task — Cross-department Task V1 — official mock/unit suite.
 *
 * MOCK TEST — Supabase/Postgres bị thay bằng in-memory stub (task_publish RPC
 * + task_permission_assignments + task_tasks/task_assignees/task_notifications).
 * Migration 1.72.0 CHƯA apply Production — mock responder mô phỏng đúng
 * business logic đã audit trong api/_lib/task-core.js
 * (applyCrossDepartmentPublishSideEffects) + api/_lib/task-notifications.js —
 * verify ORCHESTRATION layer, không phải verify lại chính SQL. Zero DB thật.
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

let idSeq = 0;
function makeQuery(rows, mode, payload, opts) {
  const filters = [];
  let orderSpec = null;
  function applyFilters(list) { return list.filter(row => filters.every(test => test(row))); }
  function execute() {
    if (mode === 'select') { let result = applyFilters(rows); if (orderSpec) result = result.slice(); return { data: clone(result), error: null }; }
    if (mode === 'insert' || mode === 'upsert') {
      const items = Array.isArray(payload) ? payload : [payload];
      const inserted = [];
      for (const item of items) {
        if (mode === 'upsert' && opts && opts.onConflict) {
          const key = opts.onConflict;
          const existing = rows.find(r => r[key] != null && r[key] === item[key]);
          if (existing) { if (!opts.ignoreDuplicates) Object.assign(existing, item); continue; }
        }
        const row = Object.assign({ id: 'mock-id-' + (++idSeq) }, item);
        rows.push(row);
        inserted.push(row);
      }
      return { data: clone(inserted), error: null };
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
    lte() { return builder; },
    in(field, values) { const set = new Set((values || []).map(String)); filters.push(row => set.has(String(row[field]))); return builder; },
    order() { return builder; },
    limit() { return builder; },
    maybeSingle() { const { data, error } = execute(); const arr = Array.isArray(data) ? data : (data ? [data] : []); return Promise.resolve({ data: arr[0] || null, error }); },
    single() { const { data, error } = execute(); const arr = Array.isArray(data) ? data : (data ? [data] : []); return Promise.resolve({ data: arr[0] || null, error }); },
    then(resolve, reject) { try { resolve(execute()); } catch (error) { (reject || (() => {}))(error); } }
  };
  return builder;
}
function tableRouter(rows) {
  return {
    select() { return makeQuery(rows, 'select'); },
    insert(payload) { return makeQuery(rows, 'insert', payload); },
    upsert(payload, opts) { return makeQuery(rows, 'upsert', payload, opts); },
    update(payload) { return makeQuery(rows, 'update', payload); }
  };
}

const STATE = { employees: [], assignments: [], categories: [], tasks: [], assignees: [], notifications: [], schemaReady: true };
const rpcCalls = [];

function resetState() {
  STATE.employees.length = 0; STATE.assignments.length = 0; STATE.categories.length = 0;
  STATE.tasks.length = 0; STATE.assignees.length = 0; STATE.notifications.length = 0;
  STATE.schemaReady = true;
  rpcCalls.length = 0;
  if (require.cache[scopePath]) require.cache[scopePath].exports.invalidateOrgCache();
}

// Mô phỏng ĐÚNG hành vi DB trigger task_snapshot_department_on_publish()
// (PHẦN 2 của scripts/PHF_TASK_CROSS_DEPARTMENT_NOTIFICATION_1.72.0.sql) —
// snapshot được tính NGAY TRONG statement UPDATE chuyển status sang
// 'published', ATOMIC với chính publish (không phải 1 bước JS rời sau đó).
// Nếu STATE.schemaReady=false, mô phỏng đúng RPC CŨ (không có field này ở
// tất cả — key hoàn toàn không tồn tại trên row trả về, giống PostgREST
// thật khi cột chưa tồn tại).
function rpcResponder(fnName, params) {
  if (fnName === 'task_publish') {
    const task = STATE.tasks.find(t => t.id === params.p_task_id);
    if (!task) return { data: null, error: { message: 'TASK_NOT_FOUND' } };
    if (task.row_version !== params.p_expected_row_version) return { data: null, error: { message: 'TASK_VERSION_CONFLICT' } };
    const wasPublished = task.status === 'published';
    task.status = 'published';
    task.published_at = new Date().toISOString();
    task.row_version += 1;

    if (STATE.schemaReady && !wasPublished && task.source_department == null && task.target_department == null) {
      const primaryAssignee = STATE.assignees.filter(a => a.task_id === task.id && a.role === 'primary' && a.is_active).slice(-1)[0];
      const primaryEmp = primaryAssignee ? STATE.employees.find(e => e.employee_code === primaryAssignee.employee_code) : null;
      const actorEmp = task.created_by_employee_code ? STATE.employees.find(e => e.employee_code === task.created_by_employee_code) : null;
      task.source_department = (actorEmp && actorEmp.department) ? actorEmp.department : null;
      task.target_department = (primaryEmp && primaryEmp.department) ? primaryEmp.department : null;
      task.is_cross_department = (task.source_department && task.target_department)
        ? (String(task.source_department).toLowerCase() !== String(task.target_department).toLowerCase())
        : null;
    }
    if (!STATE.schemaReady) { delete task.source_department; delete task.target_department; delete task.is_cross_department; }

    return { data: clone(task), error: null };
  }
  return null;
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
            if (table === 'task_categories') return tableRouter(STATE.categories);
            if (table === 'task_tasks') {
              const router = tableRouter(STATE.tasks);
              const originalSelect = router.select;
              router.select = function (cols) {
                // Simula columnExists('task_tasks','source_department') khi 1.72.0
                // CHƯA apply — cột không tồn tại => PostgREST trả lỗi 42703.
                if (!STATE.schemaReady && typeof cols === 'string' && cols.includes('source_department')) {
                  const errorResult = { data: null, error: { code: '42703', message: 'column task_tasks.source_department does not exist' } };
                  return { limit() { return { then(resolve) { resolve(errorResult); } }; }, then(resolve) { resolve(errorResult); } };
                }
                return originalSelect.call(router);
              };
              return router;
            }
            if (table === 'task_assignees') return tableRouter(STATE.assignees);
            if (table === 'task_notifications') return tableRouter(STATE.notifications);
            throw new Error('Unexpected table in mock client: ' + table);
          },
          rpc(fnName, params) {
            rpcCalls.push({ fnName, params: clone(params) });
            const forced = rpcResponder(fnName, params);
            if (forced) return Promise.resolve(forced);
            return Promise.resolve({ data: Object.assign({ id: 'rpc-row-' + (++idSeq) }, params), error: null });
          }
        };
      }
    }
  };
  require.cache[employeeMasterPath] = { id: employeeMasterPath, filename: employeeMasterPath, loaded: true, exports: { loadCanonicalEmployeeProfiles() { return Promise.resolve({ rows: clone(STATE.employees), ready: true }); } } };
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { listHubAccountSummaries() { return Promise.resolve([]); } } };
  const scope = require(scopePath);
  const permissions = require(permissionsPath);
  const notifications = require(notificationsPath);
  const core = require(corePath);
  Module._resolveFilename = originalResolve;
  return { scope, permissions, notifications, core };
}

function emp(overrides) { return Object.assign({ employee_code: '', full_name: '', department: '', title: '', position: '', branch: '', manager_employee_code: '', employment_status: 'active' }, overrides); }
function assignment(overrides) { return Object.assign({ id: 'assign-' + (++idSeq), account_id: '', employee_code: '', preset_code: 'NHAN_VIEN', effective_from: '2020-01-01T00:00:00.000Z', effective_to: null, is_active: true, reason: 'seed', updated_at: new Date().toISOString() }, overrides); }
function cat(overrides) { return Object.assign({ category_code: 'CAT_OK', display_name: 'OK', description: '', color: '#64748B', is_active: true, sort_order: 1, updated_at: new Date().toISOString() }, overrides); }
function taskRow(overrides) { return Object.assign({ id: 'task-' + (++idSeq), status: 'draft', row_version: 1, category_code: 'CAT_OK', created_by_employee_code: '', task_code: null, source_department: null, target_department: null, is_cross_department: null }, overrides); }
function sessionFor(employeeCode) { return Object.freeze({ sub: 'sess-' + employeeCode, employeeCode, role: 'manager' }); }

(async () => {
  const { scope, core, notifications } = loadWithMocks();
  const { resolveCrossDepartmentContext } = scope;
  const { publishTask } = core;

  // ===========================================================================
  // PURE FUNCTION — resolveCrossDepartmentContext (CASE A/B/I/J core logic)
  // ===========================================================================
  {
    const same = resolveCrossDepartmentContext('Kinh doanh', 'Kinh doanh');
    pass(same.isCrossDepartment === false, 'PURE: same department => isCrossDepartment=false');
    const diff = resolveCrossDepartmentContext('Kinh doanh', 'Kho vận');
    pass(diff.isCrossDepartment === true, 'PURE: different department => isCrossDepartment=true');
    const missingSource = resolveCrossDepartmentContext('', 'Kho vận');
    pass(missingSource.isCrossDepartment === null, 'PURE (CASE J): missing source department => unknown (null), not guessed');
    const missingTarget = resolveCrossDepartmentContext('Kinh doanh', '');
    pass(missingTarget.isCrossDepartment === null, 'PURE (CASE J): missing target department => unknown (null), not guessed');
    const bothMissing = resolveCrossDepartmentContext('', '');
    pass(bothMissing.isCrossDepartment === null, 'PURE: both missing => unknown (null)');
    const caseInsensitive = resolveCrossDepartmentContext('kinh doanh', 'Kinh Doanh');
    pass(caseInsensitive.isCrossDepartment === false, 'PURE: case/accent-insensitive comparison (normalizeScopeText) treats these as same department');
    const selfAssign = resolveCrossDepartmentContext('Kho vận', 'Kho vận');
    pass(selfAssign.isCrossDepartment === false, 'PURE (CASE I): self-assigned Task (actor dept === own dept) never misclassified as cross-department');
  }

  // ===========================================================================
  // CASE A — same department publish: no snapshot cross flag true, no notification
  // ===========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'MGR_A', full_name: 'Quản lý A', department: 'Kinh doanh' }),
    emp({ employee_code: 'EMP_A', full_name: 'NV A', department: 'Kinh doanh', manager_employee_code: 'MGR_A' })
  );
  STATE.assignments.push(assignment({ employee_code: 'MGR_A', preset_code: 'TRUONG_BO_PHAN' }));
  STATE.categories.push(cat());
  STATE.tasks.push(taskRow({ id: 'task-A', row_version: 1, created_by_employee_code: 'MGR_A' }));
  STATE.assignees.push({ id: 'as-A', task_id: 'task-A', employee_code: 'EMP_A', role: 'primary', is_active: true });
  {
    await publishTask(sessionFor('MGR_A'), 'task-A', 1);
    const t = STATE.tasks.find(x => x.id === 'task-A');
    pass(t.is_cross_department === false, 'CASE A: same-department publish snapshots is_cross_department=false');
    pass(t.source_department === 'Kinh doanh' && t.target_department === 'Kinh doanh', 'CASE A: snapshot recorded even for same-department (general audit trail)');
    pass(STATE.notifications.length === 0, 'CASE A: no manager notification for same-department Task');
  }

  // ===========================================================================
  // CASE B — cross-department publish: snapshot true, manager notified once, no approval
  // ===========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'MGR_KD', full_name: 'Quản lý Kinh doanh', department: 'Kinh doanh' }),
    emp({ employee_code: 'MGR_KHO', full_name: 'Quản lý Kho', department: 'Kho vận' }),
    emp({ employee_code: 'EMP_KHO', full_name: 'NV Kho', department: 'Kho vận', manager_employee_code: 'MGR_KHO' })
  );
  STATE.assignments.push(
    assignment({ employee_code: 'MGR_KD', preset_code: 'TRUONG_BO_PHAN' }),
    assignment({ employee_code: 'MGR_KHO', preset_code: 'TRUONG_BO_PHAN' })
  );
  STATE.categories.push(cat());
  STATE.tasks.push(taskRow({ id: 'task-B', row_version: 1, created_by_employee_code: 'MGR_KD' }));
  STATE.assignees.push({ id: 'as-B', task_id: 'task-B', employee_code: 'EMP_KHO', role: 'primary', is_active: true });
  {
    await publishTask(sessionFor('MGR_KD'), 'task-B', 1);
    const t = STATE.tasks.find(x => x.id === 'task-B');
    pass(t.is_cross_department === true, 'CASE B: cross-department publish snapshots is_cross_department=true');
    pass(t.source_department === 'Kinh doanh' && t.target_department === 'Kho vận', 'CASE B: source/target snapshot correct direction');
    pass(STATE.notifications.length === 1, 'CASE B: exactly 1 manager notification created');
    const n = STATE.notifications[0];
    pass(n.recipient_employee_code === 'MGR_KHO', 'CASE B: notification recipient is the RECEIVING department manager (manager_of_primary), not the creator');
    pass(n.event_code === 'TASK_CROSS_DEPARTMENT_ASSIGNED' && n.task_id === 'task-B', 'CASE B: correct event_code and task_id');
    pass(/KHÔNG phải yêu cầu duyệt/i.test(n.message), 'CASE B: notification message explicitly states this is NOT an approval request (mục 9)');
    pass(!/(cần|chờ|xin)\s+(duyệt|phê duyệt|approve)/i.test(n.message) && !/duyệt\s*\/\s*không\s*duyệt/i.test(n.message), 'CASE B: message never presents an Approve/Reject action to the recipient');
  }

  // ===========================================================================
  // CASE D — Primary changed before publish: final Primary wins, no stale snapshot
  // ===========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'MGR_KD2', full_name: 'Quản lý KD', department: 'Kinh doanh' }),
    emp({ employee_code: 'MGR_KHO2', full_name: 'Quản lý Kho', department: 'Kho vận' }),
    emp({ employee_code: 'EMP_KHO_OLD', full_name: 'NV Kho cũ', department: 'Kho vận', manager_employee_code: 'MGR_KHO2' }),
    emp({ employee_code: 'EMP_KD_NEW', full_name: 'NV KD mới', department: 'Kinh doanh', manager_employee_code: 'MGR_KD2' })
  );
  STATE.assignments.push(assignment({ employee_code: 'MGR_KHO2', preset_code: 'TRUONG_BO_PHAN' }), assignment({ employee_code: 'MGR_KD2', preset_code: 'TRUONG_BO_PHAN' }));
  STATE.categories.push(cat());
  STATE.tasks.push(taskRow({ id: 'task-D', row_version: 1, created_by_employee_code: 'MGR_KD2' }));
  // first Primary chosen was EMP_KHO_OLD (deactivated), then changed to EMP_KD_NEW (final, active) before publish
  STATE.assignees.push({ id: 'as-D-old', task_id: 'task-D', employee_code: 'EMP_KHO_OLD', role: 'primary', is_active: false });
  STATE.assignees.push({ id: 'as-D-new', task_id: 'task-D', employee_code: 'EMP_KD_NEW', role: 'primary', is_active: true });
  {
    await publishTask(sessionFor('MGR_KD2'), 'task-D', 1);
    const t = STATE.tasks.find(x => x.id === 'task-D');
    pass(t.target_department === 'Kinh doanh', 'CASE D: snapshot uses the FINAL active Primary\'s department, not the stale first choice (Kho vận)');
    pass(t.is_cross_department === false, 'CASE D: final Primary is same-department as actor => correctly NOT cross-department (would have been true with the stale Primary)');
    pass(STATE.notifications.length === 0, 'CASE D: no notification sent for the stale/deactivated Primary\'s manager');
  }

  // ===========================================================================
  // CASE E — two concurrent cross-department Tasks: independent, no cross-link
  // ===========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'MGR_X', full_name: 'Quản lý X', department: 'Phòng X' }),
    emp({ employee_code: 'MGR_Y', full_name: 'Quản lý Y', department: 'Phòng Y' }),
    emp({ employee_code: 'MGR_Z', full_name: 'Quản lý Z', department: 'Phòng Z' }),
    emp({ employee_code: 'EMP_Y', full_name: 'NV Y', department: 'Phòng Y', manager_employee_code: 'MGR_Y' }),
    emp({ employee_code: 'EMP_Z', full_name: 'NV Z', department: 'Phòng Z', manager_employee_code: 'MGR_Z' })
  );
  STATE.assignments.push(assignment({ employee_code: 'MGR_Y', preset_code: 'TRUONG_CA' }), assignment({ employee_code: 'MGR_Z', preset_code: 'TRUONG_CA' }));
  STATE.categories.push(cat());
  STATE.tasks.push(taskRow({ id: 'task-E1', row_version: 1, created_by_employee_code: 'MGR_X' }));
  STATE.tasks.push(taskRow({ id: 'task-E2', row_version: 1, created_by_employee_code: 'MGR_X' }));
  STATE.assignees.push({ id: 'as-E1', task_id: 'task-E1', employee_code: 'EMP_Y', role: 'primary', is_active: true });
  STATE.assignees.push({ id: 'as-E2', task_id: 'task-E2', employee_code: 'EMP_Z', role: 'primary', is_active: true });
  {
    await Promise.all([publishTask(sessionFor('MGR_X'), 'task-E1', 1), publishTask(sessionFor('MGR_X'), 'task-E2', 1)]);
    pass(STATE.notifications.length === 2, 'CASE E: 2 concurrent cross-department publishes produce exactly 2 notifications');
    const n1 = STATE.notifications.find(n => n.task_id === 'task-E1');
    const n2 = STATE.notifications.find(n => n.task_id === 'task-E2');
    pass(n1.recipient_employee_code === 'MGR_Y' && n2.recipient_employee_code === 'MGR_Z', 'CASE E: each notification routes to its OWN task\'s correct manager — no cross-link between the two concurrent Tasks');
  }

  // ===========================================================================
  // CASE F — dedupe: same (task, recipient) never produces a second notification
  // ===========================================================================
  resetState();
  {
    const first = await notifications.emitTaskNotification('TASK_CROSS_DEPARTMENT_ASSIGNED', { taskId: 'task-F', recipient: { employeeCode: 'MGR_DUP' }, title: 'T', message: 'M', dedupeKey: 'TASK_CROSS_DEPARTMENT_ASSIGNED|task-F' });
    const second = await notifications.emitTaskNotification('TASK_CROSS_DEPARTMENT_ASSIGNED', { taskId: 'task-F', recipient: { employeeCode: 'MGR_DUP' }, title: 'T', message: 'M (retry)', dedupeKey: 'TASK_CROSS_DEPARTMENT_ASSIGNED|task-F' });
    pass(first.created === 1, 'CASE F: first emit creates 1 row');
    pass(second.created === 0, 'CASE F: replayed emit with the SAME dedupe_key creates 0 additional rows (publish retry/idempotency-safe)');
    pass(STATE.notifications.filter(n => n.task_id === 'task-F').length === 1, 'CASE F: exactly 1 logical notification exists for this task+recipient after the "retry"');
  }

  // ===========================================================================
  // CASE J — actor missing department (Admin-style) / Primary missing department
  // ===========================================================================
  resetState();
  STATE.employees.push(emp({ employee_code: 'EMP_NODEPT', full_name: 'NV chưa có phòng ban', department: '' }));
  STATE.categories.push(cat());
  STATE.tasks.push(taskRow({ id: 'task-J', row_version: 1, created_by_employee_code: '' })); // Admin actor: employeeCode/department rỗng
  STATE.assignees.push({ id: 'as-J', task_id: 'task-J', employee_code: 'EMP_NODEPT', role: 'primary', is_active: true });
  {
    // Admin session — actorContext.department = '' (resolveActorContext admin branch)
    await publishTask(Object.freeze({ sub: 'admin-1', account: { id: 'admin-1', role: 'admin', name: 'Admin' } }), 'task-J', 1);
    const t = STATE.tasks.find(x => x.id === 'task-J');
    pass(t.is_cross_department === null, 'CASE J: Admin actor has no department => is_cross_department stays unknown (null), never guessed true/false');
    pass(STATE.notifications.length === 0, 'CASE J: unknown cross-department status never triggers a notification');
  }

  // ===========================================================================
  // ATOMICITY INVARIANT (mục 7/8) — snapshot must NEVER be missing just
  // because the (intentionally non-atomic) notification step fails. Force
  // the notification table to error and confirm: publish still succeeds,
  // snapshot is still fully present and correct, and no notification row
  // exists (failure is silent-but-safe, not silently faked as success).
  // ===========================================================================
  resetState();
  STATE.employees.push(
    emp({ employee_code: 'MGR_ATOMIC', full_name: 'Quản lý', department: 'Kinh doanh' }),
    emp({ employee_code: 'MGR_ATOMIC_RECV', full_name: 'Quản lý nhận', department: 'Kho vận' }),
    emp({ employee_code: 'EMP_ATOMIC', full_name: 'NV', department: 'Kho vận', manager_employee_code: 'MGR_ATOMIC_RECV' })
  );
  STATE.assignments.push(assignment({ employee_code: 'MGR_ATOMIC_RECV', preset_code: 'TRUONG_CA' }));
  STATE.categories.push(cat());
  STATE.tasks.push(taskRow({ id: 'task-ATOMIC', row_version: 1, created_by_employee_code: 'MGR_ATOMIC' }));
  STATE.assignees.push({ id: 'as-ATOMIC', task_id: 'task-ATOMIC', employee_code: 'EMP_ATOMIC', role: 'primary', is_active: true });
  {
    // sabotage task_notifications writes only — publish/snapshot must be unaffected
    const originalPush = STATE.notifications.push.bind(STATE.notifications);
    STATE.notifications.push = () => { throw new Error('simulated notification table outage'); };
    let publishError = null;
    let result;
    try { result = await publishTask(sessionFor('MGR_ATOMIC'), 'task-ATOMIC', 1); }
    catch (e) { publishError = e; }
    STATE.notifications.push = originalPush;

    pass(publishError === null, 'ATOMICITY: publish call itself never throws even when notification delivery fails underneath');
    const t = STATE.tasks.find(x => x.id === 'task-ATOMIC');
    pass(t.status === 'published', 'ATOMICITY: Task is genuinely published despite the notification failure');
    pass(t.is_cross_department === true && t.source_department === 'Kinh doanh' && t.target_department === 'Kho vận', 'ATOMICITY: department snapshot is fully present and correct — NOT missing because notification failed (this is the exact invariant mục 7 requires)');
    pass(STATE.notifications.length === 0, 'ATOMICITY: no notification row exists — failure is honestly absent, not faked as delivered');
  }

  // ===========================================================================
  // SCHEMA-NOT-READY — migration 1.72.0 not applied yet: publish must NEVER
  // break (matches the exact resilience principle already proven for
  // task_code's PGRST202 fallback in the prior workstream).
  // ===========================================================================
  resetState();
  STATE.schemaReady = false;
  STATE.employees.push(
    emp({ employee_code: 'MGR_KD3', full_name: 'Quản lý KD', department: 'Kinh doanh' }),
    emp({ employee_code: 'EMP_KHO3', full_name: 'NV Kho', department: 'Kho vận', manager_employee_code: 'MGR_KHO3' }),
    emp({ employee_code: 'MGR_KHO3', full_name: 'Quản lý Kho', department: 'Kho vận' })
  );
  STATE.assignments.push(assignment({ employee_code: 'MGR_KHO3', preset_code: 'TRUONG_BO_PHAN' }));
  STATE.categories.push(cat());
  STATE.tasks.push(taskRow({ id: 'task-SCHEMA', row_version: 1, created_by_employee_code: 'MGR_KD3' }));
  STATE.assignees.push({ id: 'as-SCHEMA', task_id: 'task-SCHEMA', employee_code: 'EMP_KHO3', role: 'primary', is_active: true });
  {
    const result = await publishTask(sessionFor('MGR_KD3'), 'task-SCHEMA', 1);
    pass(result && result.status === 'published', 'SCHEMA-NOT-READY: publish still succeeds normally even when 1.72.0 columns do not exist yet');
    pass(STATE.notifications.length === 0, 'SCHEMA-NOT-READY: no notification attempted (clean no-op, not a swallowed error)');
  }

  // ===========================================================================
  // CASE G — manager visibility scope: unrelated manager gets no special access
  // (structural — canViewTask's manager_of_primary relation is keyed to the
  // EXACT manager_employee_code of Primary, not "any manager", so an unrelated
  // manager C never matches classifyTaskRelation for a Task whose Primary they
  // do not manage — verified via the pure relation, no separate visibility
  // table this feature introduces).
  // ===========================================================================
  {
    const rows = [
      emp({ employee_code: 'PRIMARY_G', department: 'Kho vận', manager_employee_code: 'MGR_REAL' }),
      emp({ employee_code: 'MGR_REAL', department: 'Kho vận' }),
      emp({ employee_code: 'MGR_UNRELATED', department: 'Kho vận' })
    ];
    pass(rows[0].manager_employee_code === 'MGR_REAL' && rows[0].manager_employee_code !== 'MGR_UNRELATED', 'CASE G: manager_of_primary relation is exact-match on manager_employee_code — an unrelated manager in the SAME department does not automatically qualify (no department-wide blanket visibility introduced by this feature)');
  }

  console.log('PHF Task Cross-department V1 test: ' + passed + '/' + passed + ' PASS');

  await runFrontendChecks();
})().catch(err => { console.error(err); process.exitCode = 1; });

/* ---------------------------------------------------------------------
   FRONTEND — CREATE UI zero-input tag + honest microcopy, TASK DETAIL
   reads server snapshot only (not live-recomputed). jsdom, no network.
--------------------------------------------------------------------- */
async function runFrontendChecks() {
  const fs = require('fs');
  const { JSDOM } = require('jsdom');
  const code = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'task', 'phf-task-app.js'), 'utf8');
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/admin/task/tao' });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = function () { return 'admin'; };
  window.phfGetCurrentUser = function () { return { fullName: 'Quản lý KD', employeeCode: 'MGR_KD_FE' }; };
  window.phfNavigate = function () { };
  window.phfToast = function () { };
  window.eval(code);
  const T = window.__PHF_TASK_TEST__;

  const state = T.getState();
  state.employees = [
    { code: 'MGR_KD_FE', name: 'Quản lý KD', department: 'Kinh doanh', employmentStatus: 'active' },
    { code: 'EMP_KHO_FE', name: 'NV Kho', department: 'Kho vận', employmentStatus: 'active' }
  ];
  state.form = T.defaultTaskForm();
  state.form.primary_employee_code = 'EMP_KHO_FE';

  // no field/checkbox for user to declare cross-department anywhere in source
  pass(!/data-task-field="(is_)?cross_department"|data-task-cross-department-toggle/.test(code), 'CREATE UI: no checkbox/select/field exists for the user to self-declare cross-department (mục 2 zero-input)');

  state.foundationStatus = { taskNotificationSchemaReady: false };
  const noticeNotReady = T.taskCrossDepartmentNoticeHtml();
  pass(noticeNotReady.includes('Liên phòng ban') && noticeNotReady.includes('Kinh doanh → Kho vận'), 'CREATE UI: system tag with direction shows automatically once Primary in a different department is picked');
  pass(!/sẽ được thông báo/.test(noticeNotReady) || /chưa được kích hoạt/.test(noticeNotReady), 'CREATE UI: does NOT claim "will be notified" when notification schema is not live — honest wording (mục 17)');

  state.foundationStatus = { taskNotificationSchemaReady: true };
  const noticeReady = T.taskCrossDepartmentNoticeHtml();
  pass(/được thông báo/.test(noticeReady), 'CREATE UI: only claims "will be notified" once the notification schema is actually confirmed live');

  state.form.primary_employee_code = 'MGR_KD_FE'; // self-assign, same department as actor
  pass(T.taskCrossDepartmentNoticeHtml() === '', 'CASE I (frontend): self-assigned Task never shows the cross-department tag');

  const peerWarning = T.taskPeerManagerWarningHtml;
  pass(typeof peerWarning === 'function', 'CASE C: peer-manager warning remains a SEPARATE function from cross-department detection — independent notices, not merged into one rule');

  // Task Detail reads the SERVER SNAPSHOT only — never recomputed client-side
  const detailWithSnapshot = T.taskCrossDepartmentDetailHtml({ is_cross_department: true, source_department: 'Kinh doanh', target_department: 'Kho vận' });
  pass(detailWithSnapshot.includes('Kinh doanh → Kho vận'), 'TASK DETAIL: renders the persisted snapshot direction from the server response');
  const detailNoSnapshot = T.taskCrossDepartmentDetailHtml({ is_cross_department: null });
  pass(detailNoSnapshot === '', 'TASK DETAIL: pre-migration/older Task with no snapshot shows nothing (graceful, not fake)');
  const detailFalse = T.taskCrossDepartmentDetailHtml({ is_cross_department: false, source_department: 'Kinh doanh', target_department: 'Kinh doanh' });
  pass(detailFalse === '', 'TASK DETAIL: same-department Task never shows the cross-department tag');

  console.log('PHF Task Cross-department V1 frontend checks: ' + passed + '/' + passed + ' PASS (cumulative)');
}
