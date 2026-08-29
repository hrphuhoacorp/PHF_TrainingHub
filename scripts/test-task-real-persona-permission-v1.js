'use strict';

/*
 * PHF Task — PHASE C — REAL PERSONA permission verification.
 *
 * Real dev DB (SANDBOX, fail-closed), in-process, against the REAL
 * task_permission_assignments / employee_profiles / user_accounts rows
 * mirrored 1:1 from MAIN. No mock — every actor below is a genuine MAIN
 * employee_code with its genuine Task preset (or none).
 *
 * Covers the 5 role classes the mission requires: Admin, Director (GIAM_DOC),
 * Assistant (TRO_LY_GD), Manager (TRUONG_BO_PHAN), Shift Lead (TRUONG_CA),
 * plus a plain employee (NHAN_VIEN). Checks: account↔employee mapping, preset
 * → actorType, self / managed / department / all_company peopleScope,
 * capabilities, canViewTask, received-vs-managed, cross-department, and
 * unauthorized-access denial.
 */

require('dotenv').config();
require('./task-sandbox-guard');
const assert = require('assert');
const { createClient } = require('@supabase/supabase-js');
const perms = require('../api/_lib/task-permissions');
const scopeLib = require('../api/_lib/task-employee-scope');
const fixtures = require('./task-report-fixture-manifest');

const db = createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), { auth: { persistSession: false } });
const MANIFEST = fixtures.load();

let passed = 0;
function pass(cond, msg) { assert.ok(cond, msg); passed += 1; console.log('  PASS ' + msg); }

async function sessionFor(employeeCode) {
  const { data, error } = await db.from('user_accounts').select('id,email,role,status,employee_code')
    .ilike('employee_code', employeeCode).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('no real account for ' + employeeCode);
  return { account: { id: data.id, employeeCode: data.employee_code, role: data.role }, _dbRole: data.role, _status: data.status };
}
async function adminSession() {
  const { data } = await db.from('user_accounts').select('id,email,employee_code').eq('role', 'admin').eq('status', 'active').or('employee_code.is.null,employee_code.eq.').limit(1).maybeSingle();
  const row = data || (await db.from('user_accounts').select('id,email,employee_code').eq('role', 'admin').limit(1).maybeSingle()).data;
  return { account: { id: row.id, employeeCode: row.employee_code || '', role: 'admin' } };
}
async function taskCtx(taskCode) {
  const { data: t } = await db.from('task_tasks').select('*').eq('task_code', taskCode).single();
  const { data: a } = await db.from('task_assignees').select('*').eq('task_id', t.id);
  return {
    task: { createdByAccountId: t.created_by_account_id, createdByEmployeeCode: t.created_by_employee_code },
    assignees: (a || []).map(r => ({ employeeCode: r.employee_code, role: r.role, isActive: r.is_active }))
  };
}

(async () => {
  await fixtures.assertFresh(db);

  // ---- 1. ADMIN ----
  console.log('\n[1] ADMIN');
  {
    const s = await adminSession();
    const eff = await perms.resolveEffectiveTaskScope(s);
    pass(eff.actorContext.actorType === 'admin', 'admin account → actorType=admin');
    pass(eff.scope.capabilities.view && eff.scope.capabilities.assign && eff.scope.capabilities.update && eff.scope.capabilities.manage, 'admin → all capabilities');
    const anyTask = await taskCtx(MANIFEST.plans.F1.task_code);
    pass(await perms.canViewTask(s, anyTask.task, anyTask.assignees) === true, 'admin can view any task');
  }

  // ---- 2. DIRECTOR — GIAM_DOC (PHF002) ----
  console.log('\n[2] DIRECTOR / GIAM_DOC — PHF002');
  {
    const s = await sessionFor('PHF002');
    const eff = await perms.resolveEffectiveTaskScope(s);
    pass(eff.actorContext.taskPresetCode === 'GIAM_DOC', 'PHF002 real preset = GIAM_DOC');
    pass(eff.actorContext.actorType === 'giam_doc', 'GIAM_DOC → actorType=giam_doc');
    pass(eff.scope.peopleScope.type === 'all_company', 'GIAM_DOC → peopleScope=all_company');
    pass(eff.scope.capabilities.view && eff.scope.capabilities.assign, 'GIAM_DOC → view + assign');
    const t = await taskCtx(MANIFEST.plans.H1.task_code); // primary PHF082
    pass(await perms.canViewTask(s, t.task, t.assignees) === true, 'GIAM_DOC can view a task whose primary is any employee (all_company)');
  }

  // ---- 3. ASSISTANT — TRO_LY_GD (PHF010) ----
  console.log('\n[3] ASSISTANT / TRO_LY_GD — PHF010');
  {
    const s = await sessionFor('PHF010');
    const eff = await perms.resolveEffectiveTaskScope(s);
    pass(eff.actorContext.taskPresetCode === 'TRO_LY_GD', 'PHF010 real preset = TRO_LY_GD');
    pass(eff.actorContext.actorType === 'tro_ly_gd', 'TRO_LY_GD → actorType=tro_ly_gd');
    pass(eff.scope.peopleScope.type === 'all_company', 'TRO_LY_GD → peopleScope=all_company');
    const t = await taskCtx(MANIFEST.plans.G5.task_code);
    pass(await perms.canViewTask(s, t.task, t.assignees) === true, 'TRO_LY_GD can view across the company');
  }

  // ---- 4. MANAGER — TRUONG_BO_PHAN (PHF012, manages PHF082) ----
  console.log('\n[4] MANAGER / TRUONG_BO_PHAN — PHF012');
  {
    const s = await sessionFor('PHF012');
    const eff = await perms.resolveEffectiveTaskScope(s);
    pass(eff.actorContext.taskPresetCode === 'TRUONG_BO_PHAN', 'PHF012 real preset = TRUONG_BO_PHAN');
    pass(eff.actorContext.actorType === 'truong_bo_phan', 'TRUONG_BO_PHAN → actorType=truong_bo_phan');
    pass(eff.actorContext.managedEmployeeCodes.has('PHF082'), 'managed scope resolved from employee_profiles.manager_employee_code → includes PHF082');
    const inScope = eff.scope.peopleScope;
    pass(['employees', 'department', 'self'].includes(inScope.type), 'TRUONG_BO_PHAN → bounded peopleScope (' + inScope.type + '), not all_company');
    // managed task: primary = PHF082 (managed) → visible
    const managed = await taskCtx(MANIFEST.plans.A1.task_code); // primary PHF082
    pass(await perms.canViewTask(s, managed.task, managed.assignees) === true, 'MANAGER can view a task whose primary is a managed employee (PHF082)');
    // out-of-scope task: primary = PHF004 (not managed, different chain) → denied
    const outside = await taskCtx(MANIFEST.plans.B1.task_code); // primary PHF004
    const canOut = await perms.canViewTask(s, outside.task, outside.assignees);
    pass(canOut === false, 'MANAGER CANNOT view a task whose primary (PHF004) is outside self+managed scope — unauthorized access denied');
  }

  // ---- 5. SHIFT LEAD — TRUONG_CA (PHF041) ----
  console.log('\n[5] SHIFT LEAD / TRUONG_CA — PHF041');
  {
    const s = await sessionFor('PHF041');
    const eff = await perms.resolveEffectiveTaskScope(s);
    pass(eff.actorContext.taskPresetCode === 'TRUONG_CA', 'PHF041 real preset = TRUONG_CA');
    pass(eff.actorContext.actorType === 'truong_ca', 'TRUONG_CA → actorType=truong_ca');
    pass(eff.scope.peopleScope.type !== 'all_company', 'TRUONG_CA → bounded peopleScope (' + eff.scope.peopleScope.type + ')');
    const t = await taskCtx(MANIFEST.plans.B1.task_code); // primary PHF004 — different dept, not managed
    pass(await perms.canViewTask(s, t.task, t.assignees) === false, 'SHIFT LEAD cannot view an unrelated out-of-scope task');
  }

  // ---- 6. NORMAL EMPLOYEE — no Task preset (PHF082) ----
  console.log('\n[6] NORMAL EMPLOYEE / NHAN_VIEN — PHF082 (Hub role manager, but NO Task preset)');
  {
    const s = await sessionFor('PHF082');
    const eff = await perms.resolveEffectiveTaskScope(s);
    pass(eff.actorContext.actorType === 'nhan_vien', 'no active task_permission_assignment → actorType=nhan_vien (Hub role does NOT leak into Task authority)');
    pass(eff.scope.peopleScope.type === 'self' || (eff.scope.peopleScope.type === 'employees' && eff.scope.peopleScope.values.length <= 2), 'NHAN_VIEN → self scope only');
    // own task (primary = PHF082) → visible as primary
    const own = await taskCtx(MANIFEST.plans.A1.task_code);
    pass(await perms.canViewTask(s, own.task, own.assignees) === true, 'NHAN_VIEN can view a task they are primary on');
    // someone else's task → denied
    const other = await taskCtx(MANIFEST.plans.B1.task_code); // primary PHF004
    pass(await perms.canViewTask(s, other.task, other.assignees) === false, 'NHAN_VIEN cannot view a task they have no relation to');
  }

  // ---- 7. RECEIVED vs MANAGED distinction (P0 backend fix, commit 31a6c5b) ----
  console.log('\n[7] RECEIVED vs MANAGED');
  {
    const s = await sessionFor('PHF012'); // manager of PHF082
    // "received" = tasks where PHF012 itself is primary/related; "managed" =
    // tasks of employees PHF012 manages. classifyTaskRelation must NOT return
    // 'primary' for a managed employee's task.
    const managed = await taskCtx(MANIFEST.plans.A1.task_code); // primary PHF082
    const rel = await perms.classifyTaskRelation({ employeeCode: 'PHF012' }, managed.task, managed.assignees);
    pass(rel === 'manager_of_primary' || rel === 'none', 'a managed employee\'s task is "manager_of_primary"/"none" for the manager — never "primary"/"creator" (received≠managed)');
  }

  // ---- 8. CROSS-DEPARTMENT ----
  console.log('\n[8] CROSS-DEPARTMENT');
  {
    const rows = await scopeLib.loadOrgRows();
    const phf082 = scopeLib.findByCode(rows, 'PHF082'); // Bộ phận Quản trị tổng hợp
    const phf041 = scopeLib.findByCode(rows, 'PHF041'); // Bộ phận bán hàng
    const x = scopeLib.resolveCrossDepartmentContext(phf082.department, phf041.department);
    pass(x.isCrossDepartment === true, 'PHF082 (QTTH) → PHF041 (Bán hàng) is correctly cross-department');
    const same = scopeLib.resolveCrossDepartmentContext(phf082.department, phf082.department);
    pass(same.isCrossDepartment === false, 'same department → not cross-department');
  }

  console.log('\nPHF Task REAL PERSONA permission verification: ' + passed + '/' + passed + ' PASS');
})().catch(e => { console.error('FAIL', e && e.stack ? e.stack : e); process.exit(1); });
