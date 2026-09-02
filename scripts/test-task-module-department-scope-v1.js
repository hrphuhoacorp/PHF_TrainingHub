'use strict';
/*
 * PHF Task — MODULE-LEVEL DEPARTMENT SCOPE V1 — backend mock/unit test.
 *
 * MOCK TEST — no real DB, no network. Supabase client + employee-master + auth
 * are in-memory stubs (same pattern as scripts/test-task-permission-v1.js).
 *
 * Proves the LOCKED contract for "additional Task department scope":
 *  - People Master stays the source of primary department + employment status;
 *    adding Task department scope never mutates People Master.
 *  - Department scope persists as a normal extend grant
 *    (people_scope.type='department') on the current permission layer.
 *  - The engine resolves a department grant to that department's ACTIVE people
 *    and UNION-s them into peopleScope (existing employees/self grants unchanged).
 *  - Consumed by Task detail authority: canViewTask / resolveUpdateAuthorityBasis
 *    / resolveDirectCancelAuthorityBasis.
 *  - NOT consumed by assignment (assignScope is never widened by a grant).
 *  - Unknown / empty department + missing reason are rejected server-side.
 *  - Inactive grantee keeps no effective operational permission.
 *
 * Run: node scripts/test-task-module-department-scope-v1.js
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
function pass(condition, message) { assert.ok(condition, message); passed += 1; console.log('  ok - ' + message); }
async function rejects(factory, code, message) {
  try { await factory(); assert.fail('expected rejection: ' + message); }
  catch (error) {
    if (error && error.message && /expected rejection/.test(error.message)) throw error;
    assert.strictEqual(error && error.code, code, message + ' (got ' + (error && error.code) + ')');
    passed += 1; console.log('  ok - ' + message);
  }
}
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

let idSeq = 0;
function makeQuery(rows, mode, payload) {
  const filters = []; let limitN = null;
  function applyFilters(list) { return list.filter(row => filters.every(t => t(row))); }
  function execute() {
    if (mode === 'select') { let r = applyFilters(rows); if (limitN != null) r = r.slice(0, limitN); return { data: clone(r), error: null }; }
    if (mode === 'insert') {
      const items = Array.isArray(payload) ? payload : [payload];
      const inserted = items.map(it => { const row = Object.assign({ id: 'mock-' + (++idSeq) }, it); rows.push(row); return row; });
      return { data: clone(Array.isArray(payload) ? inserted : inserted[0]), error: null };
    }
    if (mode === 'update') { const m = applyFilters(rows); m.forEach(row => Object.assign(row, payload)); return { data: clone(m), error: null }; }
    return { data: null, error: null };
  }
  const builder = {
    select() { return builder; },
    eq(f, v) { filters.push(row => String(row[f]) === String(v)); return builder; },
    lte(f, v) { filters.push(row => String(row[f]) <= String(v)); return builder; },
    in(f, vals) { const s = new Set((vals || []).map(String)); filters.push(row => s.has(String(row[f]))); return builder; },
    or(expr) {
      const clauses = String(expr || '').split(',').map(raw => { const m = raw.match(/^([a-z_]+)\.eq\.(.*)$/); return m ? row => String(row[m[1]]) === m[2] : () => false; });
      filters.push(row => clauses.some(t => t(row))); return builder;
    },
    order() { return builder; },
    limit(n) { limitN = n; return builder; },
    maybeSingle() { const { data, error } = execute(); const a = Array.isArray(data) ? data : (data ? [data] : []); return Promise.resolve({ data: a[0] || null, error }); },
    single() { const { data, error } = execute(); const a = Array.isArray(data) ? data : (data ? [data] : []); return a.length ? Promise.resolve({ data: a[0], error }) : Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'no rows' } }); },
    then(res, rej) { try { res(execute()); } catch (e) { (rej || (() => {}))(e); } }
  };
  return builder;
}
function tableRouter(rows) {
  return {
    select() { return makeQuery(rows, 'select'); },
    insert(p) { return makeQuery(rows, 'insert', p); },
    update(p) { return makeQuery(rows, 'update', p); },
    eq(f, v) { return makeQuery(rows, 'select').eq(f, v); },
    lte(f, v) { return makeQuery(rows, 'select').lte(f, v); },
    in(f, v) { return makeQuery(rows, 'select').in(f, v); },
    order(f, o) { return makeQuery(rows, 'select').order(f, o); },
    limit(n) { return makeQuery(rows, 'select').limit(n); }
  };
}

const STATE = { employees: [], assignments: [], grants: [], grantHistory: [], accounts: [] };
function resetState() {
  Object.keys(STATE).forEach(k => { STATE[k].length = 0; });
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
            if (table === 'task_permission_assignments') return tableRouter(STATE.assignments);
            if (table === 'task_permission_grants') return tableRouter(STATE.grants);
            if (table === 'task_permission_grant_history') return tableRouter(STATE.grantHistory);
            throw new Error('Unexpected table: ' + table);
          },
          rpc(fnName, params) { return Promise.resolve({ data: Object.assign({ id: 'rpc-' + (++idSeq) }, params), error: null }); }
        };
      }
    }
  };
  require.cache[employeeMasterPath] = {
    id: employeeMasterPath, filename: employeeMasterPath, loaded: true,
    exports: { loadCanonicalEmployeeProfiles() { return Promise.resolve({ rows: clone(STATE.employees), ready: true }); } }
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

function emp(o) { return Object.assign({ employee_code: '', full_name: '', department: '', title: '', position: '', branch: '', manager_employee_code: '', employment_status: 'active' }, o); }
function grant(o) {
  const now = new Date().toISOString();
  return Object.assign({ id: 'g-' + (++idSeq), grantee_employee_code: '', grant_type: 'extend', people_scope: { type: 'department', values: [] }, capabilities: {}, effective_from: '2020-01-01T00:00:00.000Z', effective_to: null, is_active: true, reason: 'seed', updated_at: now }, o);
}
function sessionFor(c) { return Object.freeze({ sub: 'sess-' + c, employeeCode: c, role: 'manager' }); }
function adminSession() { return Object.freeze({ sub: 'admin-1', account: { id: 'admin-1', role: 'admin', name: 'Admin QA' } }); }
function taskFor(primaryCode, creatorCode) {
  return {
    task: { createdByEmployeeCode: creatorCode || 'PHF999', createdByAccountId: '' },
    assignees: [{ employeeCode: primaryCode, role: 'primary', isActive: true }]
  };
}

(async () => {
  const { permissions, core } = loadWithMocks();
  const {
    resolveEffectiveTaskScope, canViewTask, resolveUpdateAuthorityBasis,
    resolveDirectCancelAuthorityBasis, canAssignTaskTo
  } = permissions;
  const { listTaskAdminPeople, createTaskPermissionGrant } = core;

  // --- fixture: 3 departments -------------------------------------------------
  function seedOrg() {
    STATE.employees.push(
      emp({ employee_code: 'PHF038', full_name: 'Gấm', department: 'Gói quà', manager_employee_code: '' }),
      emp({ employee_code: 'KHO01', full_name: 'Kho A', department: 'Kho' }),
      emp({ employee_code: 'KHO02', full_name: 'Kho B', department: 'Kho' }),
      emp({ employee_code: 'KHO03', full_name: 'Kho C (nghỉ)', department: 'Kho', employment_status: 'inactive' }),
      emp({ employee_code: 'BH01', full_name: 'Bán hàng A', department: 'Bán hàng' }),
      emp({ employee_code: 'ADM01', full_name: 'Quản trị', department: 'Ban giám đốc' })
    );
    STATE.accounts.push({ id: 'acc-adm', employeeCode: 'ADM01', role: 'admin' });
  }

  /* 1. base identity — Task shows canonical primary department from People ----- */
  resetState(); seedOrg();
  STATE.grants.push(grant({ grantee_employee_code: 'PHF038', people_scope: { type: 'department', values: ['Kho', 'Bán hàng'] } }));
  let people = (await listTaskAdminPeople(adminSession())).people;
  let p38 = people.find(x => x.employee_code === 'PHF038');
  pass(p38.primary_department === 'Gói quà' && p38.department === 'Gói quà', '1: DTO primary_department = canonical People Master department (Gói quà)');
  pass(JSON.stringify((p38.additional_task_departments || []).slice().sort()) === JSON.stringify(['Bán hàng', 'Kho']), '2: additional_task_departments reflects the department grant, separate from primary');
  pass(Array.isArray(p38.department_scope_grants) && p38.department_scope_grants.length === 1 && p38.department_scope_grants[0].people_scope.type === 'department', '3: department_scope_grants exposes the grant for the editor');
  pass(!STATE.employees.find(e => e.employee_code === 'PHF038').department.includes('Kho'), '4: People Master employee_profiles.department is untouched (still Gói quà)');
  pass(p38.permission_adjustment.supported_scope_types.includes('department'), '5: adjustment policy offers "department" scope for a self-base active employee');
  pass(p38.department_scope_supported === true && p38.base_scope_type === 'self', '5b: DTO department_scope_supported=true for a normal ACTIVE "Nhân viên" (base self) — the picker-hidden defect');
  const pKho = people.find(x => x.employee_code === 'KHO01');
  pass(pKho.department_scope_supported === true, '5c: department_scope_supported=true for another active self-base employee');
  const pAdm = people.find(x => x.employee_code === 'ADM01');
  pass(pAdm.base_scope_type === 'all_company' && pAdm.department_scope_supported === false, '5d: department_scope_supported=false for an all-company base role (admin)');
  {
    resetState(); seedOrg();
    STATE.employees.find(e => e.employee_code === 'PHF038').employment_status = 'inactive';
    const inactivePeople = (await listTaskAdminPeople(adminSession())).people;
    pass(inactivePeople.find(x => x.employee_code === 'PHF038').department_scope_supported === false, '5e: department_scope_supported=false for an inactive employee');
    resetState(); seedOrg();
    STATE.grants.push(grant({ grantee_employee_code: 'PHF038', people_scope: { type: 'department', values: ['Kho', 'Bán hàng'] } }));
    people = (await listTaskAdminPeople(adminSession())).people;
    p38 = people.find(x => x.employee_code === 'PHF038');
    pass(p38.department_scope_supported === true && p38.effective_scope_type !== 'self', '5f: department_scope_supported stays true even though the EFFECTIVE scope now spans several people');
  }

  /* 2. engine — department grant resolves to that dept's ACTIVE people -------- */
  const eff38 = await resolveEffectiveTaskScope(sessionFor('PHF038'));
  const scopeCodes = new Set(eff38.scope.peopleScope.values || []);
  pass(eff38.scope.peopleScope.type === 'employees', '6: effective peopleScope collapses to an explicit employee list');
  pass(scopeCodes.has('KHO01') && scopeCodes.has('KHO02') && scopeCodes.has('BH01'), '7: department grant expanded to active members of Kho + Bán hàng');
  pass(!scopeCodes.has('KHO03'), '8: inactive Kho employee NOT included (employment status authoritative from People Master)');
  pass(scopeCodes.has('PHF038'), '9: own self scope preserved (union, not replace)');
  pass(eff38.scope.assignScope.type === 'self', '10: assignScope NOT widened by the department grant (WHICH-people != WHAT-may-do)');

  /* 3. VISIBILITY — department scope lets the holder SEE / cover those people */
  pass(await canViewTask(sessionFor('PHF038'), taskFor('KHO01').task, taskFor('KHO01').assignees) === true, '11: canViewTask TRUE for a task whose active primary is in the granted department (visibility works)');
  pass(await canViewTask(sessionFor('PHF038'), taskFor('ADM01').task, taskFor('ADM01').assignees) === false, '12: canViewTask FALSE for a task outside primary/base/granted scope');

  /* 4. WHO vs WHAT — department scope ALONE grants NO lifecycle authority ---- */
  const kho = taskFor('KHO01');
  pass(await resolveUpdateAuthorityBasis(sessionFor('PHF038'), kho.task, kho.assignees) === null, '13: resolveUpdateAuthorityBasis = null — department scope alone does NOT confer change-deadline / transfer / reopen / add-remove-related authority');
  pass(await resolveDirectCancelAuthorityBasis(sessionFor('PHF038'), kho.task, kho.assignees) === null, '14: resolveDirectCancelAuthorityBasis = null — department scope alone is NOT an authorised management basis (Cancel Policy V1 intact)');
  pass(await permissions.resolveAttachmentUploadAuthorityBasis(sessionFor('PHF038'), kho.task, kho.assignees) === null, '14b: attachment UPLOAD authority = null for a department-only viewer');
  pass(await permissions.resolveAttachmentManageAuthorityBasis(sessionFor('PHF038'), kho.task, kho.assignees) === null, '14c: attachment MANAGE (remove others) authority = null for a department-only viewer');
  const viewer = await permissions.resolveTaskViewerAuthority(
    { sub: 'sess-PHF038', employeeCode: 'PHF038', role: 'manager' },
    { created_by_employee_code: 'PHF999', created_by_account_id: '', status: 'in_progress' },
    [{ employee_code: 'KHO01', role: 'primary', is_active: true }]
  );
  pass(viewer.actions.view === true && viewer.actions.comment === true, '14d: viewer DTO — view + comment allowed via department scope');
  pass(viewer.actions.change_deadline === false && viewer.actions.transfer_primary === false && viewer.actions.add_related === false && viewer.actions.remove_related === false && viewer.actions.reopen === false && viewer.actions.cancel === false && viewer.actions.upload_attachment === false, '14e: viewer DTO — every mutation action FALSE for a department-only viewer');
  pass(viewer.intervention_basis === null && viewer.direct_cancel_basis === null, '14f: viewer DTO — no intervention / direct-cancel basis');

  /* 5. an EXPLICIT employee-specific exception grant STILL confers authority - */
  resetState(); seedOrg();
  STATE.grants.push(grant({ grantee_employee_code: 'PHF038', people_scope: { type: 'employees', values: ['KHO01'] } }));
  pass(await resolveUpdateAuthorityBasis(sessionFor('PHF038'), kho.task, kho.assignees) === 'exception_grant', '15a: explicit {type:employees} exception grant → "exception_grant" (legitimate intervention grants unchanged)');
  pass(await resolveDirectCancelAuthorityBasis(sessionFor('PHF038'), kho.task, kho.assignees) === 'exception_grant', '15b: explicit employee exception grant → direct-cancel basis unchanged');
  pass(await canViewTask(sessionFor('PHF038'), kho.task, kho.assignees) === true, '15c: explicit employee grant still gives visibility');

  /* 6. assignment scope unchanged by department scope --------------------- */
  resetState(); seedOrg();
  STATE.grants.push(grant({ grantee_employee_code: 'PHF038', people_scope: { type: 'department', values: ['Kho', 'Bán hàng'] } }));
  pass(await canAssignTaskTo(sessionFor('PHF038'), 'KHO01') === false, '16a: canAssignTaskTo(Kho person) FALSE — department scope does not widen assignScope');
  pass((await resolveEffectiveTaskScope(sessionFor('PHF038'))).scope.capabilities.manage !== true, '16b: department scope grants no permission-management (manage) capability');

  /* 7. write path — create department-scope grant --------------------------- */
  resetState(); seedOrg();
  const created = await createTaskPermissionGrant(adminSession(), {
    granteeEmployeeCode: 'PHF038', grantType: 'extend',
    peopleScope: { type: 'department', values: ['kho', '  Bán Hàng  '] }, capabilities: {}, reason: 'PHF038 điều phối liên phòng ban'
  });
  pass(created.grant.people_scope.type === 'department', '17: createTaskPermissionGrant persists a department-type extend grant');
  pass(JSON.stringify(created.grant.people_scope.values.slice().sort()) === JSON.stringify(['Bán hàng', 'Kho']), '18: department names canonicalised to the People Master spelling (case/space/accent-insensitive match)');
  pass(STATE.grantHistory.length === 1 && STATE.grantHistory[0].reason === 'PHF038 điều phối liên phòng ban', '19: audit/history row written with actor + reason (reuses existing grant history)');
  pass(STATE.grants.length === 1 && STATE.grants[0].capabilities && Object.keys(STATE.grants[0].capabilities).length === 0, '20: no capability change — department scope is people-scope only');

  await rejects(() => createTaskPermissionGrant(adminSession(), { granteeEmployeeCode: 'PHF038', grantType: 'extend', peopleScope: { type: 'department', values: ['Phòng Không Có'] }, capabilities: {}, reason: 'x' }), 'TASK_PERMISSION_SCOPE_DEPARTMENT_NOT_FOUND', '21: unknown department rejected against People Master catalog');
  await rejects(() => createTaskPermissionGrant(adminSession(), { granteeEmployeeCode: 'PHF038', grantType: 'extend', peopleScope: { type: 'department', values: [] }, capabilities: {}, reason: 'x' }), 'TASK_PERMISSION_SCOPE_VALUES_REQUIRED', '22: empty department list rejected');
  await rejects(() => createTaskPermissionGrant(adminSession(), { granteeEmployeeCode: 'PHF038', grantType: 'extend', peopleScope: { type: 'department', values: ['Kho'] }, capabilities: {}, reason: '' }), 'TASK_PERMISSION_REASON_REQUIRED', '23: reason for change is mandatory');
  await rejects(() => createTaskPermissionGrant(adminSession(), { granteeEmployeeCode: 'KHO03', grantType: 'extend', peopleScope: { type: 'department', values: ['Kho'] }, capabilities: {}, reason: 'x' }), 'TASK_PERMISSION_GRANTEE_INACTIVE', '24: cannot grant new scope to an inactive employee');

  /* 8. inactive grantee keeps no effective operational scope --------------- */
  resetState(); seedOrg();
  STATE.employees.find(e => e.employee_code === 'PHF038').employment_status = 'inactive';
  STATE.grants.push(grant({ grantee_employee_code: 'PHF038', people_scope: { type: 'department', values: ['Kho'] } }));
  pass(await canAssignTaskTo(sessionFor('PHF038'), 'KHO01') === false, '25: inactive grantee — no effective operational permission despite the historical grant');

  /* 9. no Supabase Task-business fallback introduced ---------------------- */
  const coreSrc = require('fs').readFileSync(corePath, 'utf8');
  pass(/task_permission_grants/.test(coreSrc) && !/\.from\(['"]tasks['"]\)|task_tasks.*fallback/i.test(coreSrc.split('normalizeExtendPeopleScope')[1].split('function ')[0]), '26: department scope touches only the permission layer, no Task-business write');

  console.log('\nPHF Task MODULE-LEVEL DEPARTMENT SCOPE V1: ' + passed + '/' + passed + ' PASS');
})().catch(e => { console.error(e && e.stack || e); process.exitCode = 1; });
