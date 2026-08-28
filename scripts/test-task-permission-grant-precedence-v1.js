'use strict';

/*
 * PHF Task — PERMISSION GRANT PRECEDENCE FIX V1.
 * Gate: PHF_TASK_PERMISSION_GRANT_PRECEDENCE_FIX_V1
 *
 * Proves the locked business rule "RESTRICT MUST WIN OVER EXTEND on any
 * shared dimension, independent of row/creation order" against the fixed
 * applyGrant()/resolveEffectiveTaskScopeFromGrants() (api/_lib/task-
 * permissions.js). Part A is pure/synchronous (no DB, no fixtures) using
 * synthetic actorContext/grants/orgRows. Part B is real dev DB, in-process,
 * using PHF012 as the live subject (same fixture pattern already used by
 * scripts/test-task-permission-hardening-v1.js and scripts/test-task-schema-
 * repair-post-apply-v1.js), tagged [PERMISSION-GRANT-PRECEDENCE-TEST],
 * cleaned up exactly (temporary grant IDs only) at the end of every block.
 */

const assert = require('assert');
require('dotenv').config();
require('./task-sandbox-guard'); // fail-closed: refuse to run unless SUPABASE_URL === PHF_HR sandbox
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const perms = require('../api/_lib/task-permissions');
const { loadOrgRows } = require('../api/_lib/task-employee-scope');
const core = require('../api/_lib/task-core');
const fixtures = require('./task-report-fixture-manifest');
const MANIFEST = fixtures.load();
// A task whose primary is PHF004 and stays PHF004 (no transfer), used as the
// "outside the [PHF082] restriction" subject. Resolved by role from the manifest.
const PRIMARY_PHF004_CODE = MANIFEST.plans.B1.task_code; // completed_late, primary=PHF004, no coordinators

let passed = 0;
let liveIds = []; // module-scope so the fail-path cleanup handler can always reach whatever is in-flight
function pass(condition, message) { assert.ok(condition, message); passed += 1; }
function session(employeeCode) { return { account: { employeeCode } }; }

// ===========================================================================
// PART A — pure algorithm unit tests, synthetic data, no DB.
// ===========================================================================
const ORG_ROWS = [
  { employeeCode: 'PHF012', status: 'active', department: 'Bộ phận Quản trị tổng hợp', branch: 'Phú Lợi' },
  { employeeCode: 'PHF082', status: 'active', department: 'Bộ phận bán hàng', branch: 'Phú Lợi' },
  { employeeCode: 'PHF099', status: 'active', department: 'Bộ phận bán hàng', branch: 'Bình Dương' },
  { employeeCode: 'PHF100', status: 'active', department: 'Bộ phận Quản trị tổng hợp', branch: 'Phú Lợi' }
];
const BASE_ACTOR = { employeeCode: 'PHF012', actorType: 'truong_bo_phan', managedEmployeeCodes: new Set(['PHF082']) };

function baseScope() {
  return perms.resolveBaseTaskScope(BASE_ACTOR); // {view,assign,update,manage:true/false...}, peopleScope=employees:[PHF012,PHF082]
}
function grant(overrides) {
  return Object.assign({ grant_type: 'extend', capabilities: {}, people_scope: { type: 'self', values: [] } }, overrides);
}

(async () => {
  // -------------------------------------------------------------------
  // 1. No grants -> base preset unchanged.
  // -------------------------------------------------------------------
  {
    const result = perms.resolveEffectiveTaskScopeFromGrants(BASE_ACTOR, [], null, ORG_ROWS);
    const base = baseScope();
    pass(JSON.stringify(result.scope) === JSON.stringify(base), '1. NO GRANTS: effective scope byte-identical to base preset scope');
  }

  // -------------------------------------------------------------------
  // 2. Extend only: base denied/narrow -> extend opens exactly intended capability/scope.
  // -------------------------------------------------------------------
  {
    const g = grant({ grant_type: 'extend', capabilities: { manage: true }, people_scope: { type: 'all_company', values: [] } });
    const result = perms.resolveEffectiveTaskScopeFromGrants(BASE_ACTOR, [g], null, ORG_ROWS);
    pass(result.scope.capabilities.manage === true, '2. EXTEND ONLY: manage capability opened (base preset has manage=false for truong_bo_phan)');
    pass(result.scope.peopleScope.type === 'all_company', '2. EXTEND ONLY: peopleScope broadened to exactly all_company as the extend specified');
  }

  // -------------------------------------------------------------------
  // 3. Restrict only: base allowed -> restrict removes exactly intended capability/scope.
  // -------------------------------------------------------------------
  {
    const g = grant({ grant_type: 'restrict', capabilities: { view: false }, people_scope: { type: 'all_company', values: [] } });
    const result = perms.resolveEffectiveTaskScopeFromGrants(BASE_ACTOR, [g], null, ORG_ROWS);
    pass(result.scope.capabilities.view === false, '3. RESTRICT ONLY: view capability removed (base preset has view=true)');
    pass(result.scope.capabilities.update === true, '3. RESTRICT ONLY: unrelated update capability untouched');
    pass(result.scope.peopleScope.type === 'employees' && result.scope.peopleScope.values.sort().join(',') === 'PHF012,PHF082', '3. RESTRICT ONLY (all_company people_scope = identity): peopleScope unchanged from base, exactly as documented — restrict people_scope=all_company narrows nothing');
  }

  // -------------------------------------------------------------------
  // 4. Extend + Restrict SAME capability -> final = restricted.
  // -------------------------------------------------------------------
  {
    const gExtend = grant({ grant_type: 'extend', capabilities: { view: true } });
    const gRestrict = grant({ grant_type: 'restrict', capabilities: { view: false } });
    const result = perms.resolveEffectiveTaskScopeFromGrants(BASE_ACTOR, [gExtend, gRestrict], null, ORG_ROWS);
    pass(result.scope.capabilities.view === false, '4. EXTEND+RESTRICT SAME CAPABILITY: final view=false — restrict wins (locked business rule)');
  }

  // -------------------------------------------------------------------
  // 5. Insert/order inversion -> identical final result (pure-algorithm proof; live DB proof in Part B).
  // -------------------------------------------------------------------
  {
    const gExtend = grant({ grant_type: 'extend', capabilities: { view: true }, people_scope: { type: 'all_company', values: [] } });
    const gRestrict = grant({ grant_type: 'restrict', capabilities: { view: false }, people_scope: { type: 'employees', values: ['PHF082'] } });
    const r1 = perms.resolveEffectiveTaskScopeFromGrants(BASE_ACTOR, [gRestrict, gExtend], null, ORG_ROWS); // restrict-first row order
    const r2 = perms.resolveEffectiveTaskScopeFromGrants(BASE_ACTOR, [gExtend, gRestrict], null, ORG_ROWS); // extend-first row order
    pass(JSON.stringify(r1.scope) === JSON.stringify(r2.scope), '5. ROW-ORDER INDEPENDENCE (pure): identical final scope regardless of array/row order');
    pass(r1.scope.capabilities.view === false, '5. ROW-ORDER INDEPENDENCE: restrict still wins in both orders');
  }

  // -------------------------------------------------------------------
  // 6. Different capability: extend view=true + restrict assign=false -> view true, assign false.
  // -------------------------------------------------------------------
  {
    const gExtend = grant({ grant_type: 'extend', capabilities: { view: true, manage: true } });
    const gRestrict = grant({ grant_type: 'restrict', capabilities: { assign: false } });
    const result = perms.resolveEffectiveTaskScopeFromGrants(BASE_ACTOR, [gExtend, gRestrict], null, ORG_ROWS);
    pass(result.scope.capabilities.view === true, '6. DIFFERENT CAPABILITY: view remains true (extend, not touched by restrict)');
    pass(result.scope.capabilities.manage === true, '6. DIFFERENT CAPABILITY: manage remains true (extend, not touched by restrict)');
    pass(result.scope.capabilities.assign === false, '6. DIFFERENT CAPABILITY: assign correctly narrowed to false by restrict — no cross-capability interference');
  }

  // -------------------------------------------------------------------
  // 7. People scope: extend all_company + restrict employees subset -> final must NOT remain all_company.
  // -------------------------------------------------------------------
  {
    const gExtend = grant({ grant_type: 'extend', people_scope: { type: 'all_company', values: [] } });
    const gRestrict = grant({ grant_type: 'restrict', people_scope: { type: 'employees', values: ['PHF082', 'PHF099'] } });
    const result = perms.resolveEffectiveTaskScopeFromGrants(BASE_ACTOR, [gExtend, gRestrict], null, ORG_ROWS);
    pass(result.scope.peopleScope.type !== 'all_company', '7. PEOPLE SCOPE CONFLICT: final scope type is NOT all_company — restrict narrowed it');
    pass(result.scope.peopleScope.type === 'employees' && result.scope.peopleScope.values.sort().join(',') === 'PHF082,PHF099', '7. PEOPLE SCOPE CONFLICT: final scope is the EXACT intersection (all_company ∩ [PHF082,PHF099] = [PHF082,PHF099])');
  }

  // -------------------------------------------------------------------
  // 8. People scope reverse row order -> same result.
  // -------------------------------------------------------------------
  {
    const gExtend = grant({ grant_type: 'extend', people_scope: { type: 'all_company', values: [] } });
    const gRestrict = grant({ grant_type: 'restrict', people_scope: { type: 'employees', values: ['PHF082', 'PHF099'] } });
    const r1 = perms.resolveEffectiveTaskScopeFromGrants(BASE_ACTOR, [gRestrict, gExtend], null, ORG_ROWS);
    const r2 = perms.resolveEffectiveTaskScopeFromGrants(BASE_ACTOR, [gExtend, gRestrict], null, ORG_ROWS);
    pass(JSON.stringify(r1.scope.peopleScope) === JSON.stringify(r2.scope.peopleScope), '8. PEOPLE SCOPE ROW-ORDER INDEPENDENCE: identical peopleScope regardless of row order');
  }

  // -------------------------------------------------------------------
  // 9. Multiple extends: deterministic union/broadening.
  // -------------------------------------------------------------------
  {
    const g1 = grant({ grant_type: 'extend', people_scope: { type: 'employees', values: ['PHF099'] } });
    const g2 = grant({ grant_type: 'extend', people_scope: { type: 'employees', values: ['PHF100'] } });
    const r1 = perms.resolveEffectiveTaskScopeFromGrants(BASE_ACTOR, [g1, g2], null, ORG_ROWS);
    const r2 = perms.resolveEffectiveTaskScopeFromGrants(BASE_ACTOR, [g2, g1], null, ORG_ROWS);
    // Compare SET CONTENT, not array order — Array.from(new Set(...)) preserves
    // insertion order, so [g1,g2] vs [g2,g1] can legitimately produce the same
    // values in a different array order; that is not a row-order-dependence bug.
    pass(r1.scope.peopleScope.type === r2.scope.peopleScope.type && r1.scope.peopleScope.values.slice().sort().join(',') === r2.scope.peopleScope.values.slice().sort().join(','), '9. MULTIPLE EXTENDS: union order-independent (same SET content regardless of row order)');
    pass(r1.scope.peopleScope.values.slice().sort().join(',') === 'PHF012,PHF082,PHF099,PHF100', '9. MULTIPLE EXTENDS: union contains base + both extends, nothing lost');
  }

  // -------------------------------------------------------------------
  // 10. Multiple restricts: deterministic narrowing.
  // -------------------------------------------------------------------
  {
    const gExtend = grant({ grant_type: 'extend', people_scope: { type: 'all_company', values: [] } });
    const r1restrict = grant({ grant_type: 'restrict', people_scope: { type: 'employees', values: ['PHF012', 'PHF082', 'PHF099'] } });
    const r2restrict = grant({ grant_type: 'restrict', people_scope: { type: 'employees', values: ['PHF082', 'PHF099', 'PHF100'] } });
    const r1 = perms.resolveEffectiveTaskScopeFromGrants(BASE_ACTOR, [gExtend, r1restrict, r2restrict], null, ORG_ROWS);
    const r2 = perms.resolveEffectiveTaskScopeFromGrants(BASE_ACTOR, [gExtend, r2restrict, r1restrict], null, ORG_ROWS);
    pass(JSON.stringify(r1.scope.peopleScope) === JSON.stringify(r2.scope.peopleScope), '10. MULTIPLE RESTRICTS: identical result regardless of restrict-vs-restrict order');
    pass(r1.scope.peopleScope.values.sort().join(',') === 'PHF082,PHF099', '10. MULTIPLE RESTRICTS: final = intersection of BOTH restricts (PHF082,PHF099 — the common subset)');
  }

  console.log(`Part A (pure algorithm): ${passed}/${passed} PASS so far`);

  // ===========================================================================
  // PART B — real dev DB, live fixtures, tagged [PERMISSION-GRANT-PRECEDENCE-TEST].
  // ===========================================================================
  const orgRows = await loadOrgRows();
  async function insertGrant(overrides) {
    const nowIso = new Date().toISOString();
    const row = Object.assign({
      grantee_employee_code: 'PHF012',
      is_active: true,
      effective_from: nowIso,
      effective_to: null,
      reason: '[PERMISSION-GRANT-PRECEDENCE-TEST] fixture',
      created_by_employee_code: 'PHF010'
    }, overrides);
    const { data, error } = await supabase.from('task_permission_grants').insert(row).select('*').single();
    if (error) throw error;
    return data;
  }
  // Canonical revoke IS soft (is_active=false) — see
  // PHF_TASK_SERVICE_ROLE_PRIVILEGES_1.72.2.sql: service_role has NO DELETE on
  // task_permission_grants by design. Prefer a real hard DELETE when the
  // environment grants it (SANDBOX parity package), fall back to the canonical
  // soft revoke otherwise — either way the fixture stops affecting scope.
  async function deleteGrants(ids) {
    for (const id of ids) {
      const res = await supabase.from('task_permission_grants').delete().eq('id', id).select('*');
      if (!res.error) continue;
      if (res.error.code !== '42501') throw res.error;
      const soft = await supabase.from('task_permission_grants').update({ is_active: false }).eq('id', id).select('*');
      if (soft.error) throw soft.error;
    }
  }
  async function currentActivePhf012Grants() {
    const { data } = await supabase.from('task_permission_grants').select('id').eq('grantee_employee_code', 'PHF012').eq('is_active', true);
    return data || [];
  }

  // -------------------------------------------------------------------
  // BASELINE capture before creating any live fixture this gate.
  // -------------------------------------------------------------------
  const baselinePre = await perms.resolveEffectiveTaskScope(session('PHF012'));
  pass(baselinePre.scope.peopleScope.type === 'employees' && baselinePre.grants.length === 0, 'BASELINE PRE: PHF012 clean baseline confirmed (employees:[PHF012,PHF082], zero active grants) before this gate creates anything');

  // -------------------------------------------------------------------
  // 5-LIVE / 8-LIVE. Row-order independence + people-scope conflict, live DB,
  // insert order literally reversed between the two sub-cases.
  // -------------------------------------------------------------------
  {
    // Case 1: restrict inserted FIRST, extend inserted SECOND.
    const restrictFirst = await insertGrant({ grant_type: 'restrict', capabilities: { view: false }, people_scope: { type: 'employees', values: ['PHF082'] } });
    const extendSecond = await insertGrant({ grant_type: 'extend', capabilities: { view: true }, people_scope: { type: 'all_company', values: [] } });
    liveIds = [restrictFirst.id, extendSecond.id];
    const resultA = await perms.resolveEffectiveTaskScope(session('PHF012'));
    pass(resultA.scope.capabilities.view === false, '5-LIVE (restrict-row-first): view=false, restrict wins over the later-inserted extend');
    pass(resultA.scope.peopleScope.type === 'employees' && resultA.scope.peopleScope.values.join(',') === 'PHF082', '7/8-LIVE (restrict-row-first): peopleScope narrowed to the intersection (all_company ∩ [PHF082] = [PHF082]), NOT all_company');
    await deleteGrants(liveIds);

    // Case 2: SAME two grants, insert order REVERSED — extend FIRST, restrict SECOND.
    const extendFirst = await insertGrant({ grant_type: 'extend', capabilities: { view: true }, people_scope: { type: 'all_company', values: [] } });
    const restrictSecond = await insertGrant({ grant_type: 'restrict', capabilities: { view: false }, people_scope: { type: 'employees', values: ['PHF082'] } });
    liveIds = [extendFirst.id, restrictSecond.id];
    const resultB = await perms.resolveEffectiveTaskScope(session('PHF012'));
    pass(resultB.scope.capabilities.view === false, '5-LIVE (extend-row-first): view=false — IDENTICAL result to restrict-row-first, insertion order genuinely does not matter live');
    pass(resultB.scope.peopleScope.type === 'employees' && resultB.scope.peopleScope.values.join(',') === 'PHF082', '7/8-LIVE (extend-row-first): peopleScope narrowed identically regardless of insert order');
    await deleteGrants(liveIds);
    liveIds = [];
  }

  // -------------------------------------------------------------------
  // 11. Inactive grant -> no effect.
  // -------------------------------------------------------------------
  {
    const inactiveRestrict = await insertGrant({ grant_type: 'restrict', capabilities: { view: false }, is_active: false });
    liveIds = [inactiveRestrict.id];
    const result = await perms.resolveEffectiveTaskScope(session('PHF012'));
    pass(result.scope.capabilities.view === true, '11. INACTIVE GRANT: is_active=false restrict has ZERO effect — view remains true');
    pass(result.grants.length === 0, '11. INACTIVE GRANT: loadActiveGrants correctly excludes it entirely (not even loaded)');
    await deleteGrants(liveIds);
    liveIds = [];
  }

  // -------------------------------------------------------------------
  // 12. Expired grant -> no effect.
  // -------------------------------------------------------------------
  {
    const pastIso = new Date(Date.now() - 3600e3).toISOString();
    const expiredRestrict = await insertGrant({ grant_type: 'restrict', capabilities: { view: false }, effective_from: new Date(Date.now() - 7200e3).toISOString(), effective_to: pastIso });
    liveIds = [expiredRestrict.id];
    const result = await perms.resolveEffectiveTaskScope(session('PHF012'));
    pass(result.scope.capabilities.view === true, '12. EXPIRED GRANT: effective_to in the past has ZERO effect — view remains true');
    pass(result.grants.length === 0, '12. EXPIRED GRANT: loadActiveGrants correctly excludes it (effective_to < now)');
    await deleteGrants(liveIds);
    liveIds = [];
  }

  // -------------------------------------------------------------------
  // 13. Grant targeted to another actor -> no effect.
  // -------------------------------------------------------------------
  {
    const otherActorRestrict = await insertGrant({ grantee_employee_code: 'PHF082', grant_type: 'restrict', capabilities: { view: false } });
    liveIds = [otherActorRestrict.id];
    const resultPHF012 = await perms.resolveEffectiveTaskScope(session('PHF012'));
    pass(resultPHF012.scope.capabilities.view === true, '13. GRANT TO ANOTHER ACTOR: a restrict targeted at PHF082 has ZERO effect on PHF012');
    pass(resultPHF012.grants.length === 0, '13. GRANT TO ANOTHER ACTOR: loadActiveGrants(PHF012) does not return PHF082-targeted rows');
    const resultPHF082 = await perms.resolveEffectiveTaskScope(session('PHF082'));
    pass(resultPHF082.scope.capabilities.view === false, '13. GRANT TO ANOTHER ACTOR (control): the SAME grant correctly DOES apply to its real target, PHF082');
    await deleteGrants(liveIds);
    liveIds = [];
  }

  // -------------------------------------------------------------------
  // 14. Client payload cannot spoof a grant (real action handler, non-admin).
  // -------------------------------------------------------------------
  {
    await assert.rejects(
      () => core.createTaskPermissionGrant(session('PHF082'), { granteeEmployeeCode: 'PHF082', grantType: 'extend', capabilities: { view: true, assign: true, update: true, manage: true }, peopleScope: { type: 'all_company' }, reason: 'self-granted all_company via payload — precedence gate regression' }),
      e => e.code === 'TASK_PERMISSION_ADMIN_REQUIRED'
    );
    pass(true, '14. CLIENT SPOOF: a non-admin actor cannot create ANY permission grant via the real action handler (createTaskPermissionGrant), extend or restrict');
  }

  // -------------------------------------------------------------------
  // AUTHORIZATION SURFACE PARITY — one real negative live test proving a
  // task denied by effective restrict does not leak through listTasks/
  // getTaskDetail/canViewTask, all 3 of which share the SAME
  // resolveEffectiveTaskScope() choke point also used by Calendar/Timeline/
  // Report (resolveAuthorizedTaskScope() — see api/_lib/task-core.js
  // comment "Report KHÔNG được tạo bản duplicate thứ 3... để cả listTasks()
  // và Report engine dùng chung" — single code path, not per-surface logic).
  // -------------------------------------------------------------------
  {
    const B1 = (await supabase.from('task_tasks').select('*').eq('task_code', PRIMARY_PHF004_CODE).single()).data; // primary=PHF004 (manifest B1)
    const b1Assignees = (await supabase.from('task_assignees').select('*').eq('task_id', B1.id)).data || [];
    const relTask = { createdByAccountId: B1.created_by_account_id, createdByEmployeeCode: B1.created_by_employee_code };
    const relAssignees = b1Assignees.map(r => ({ employeeCode: r.employee_code, role: r.role, isActive: r.is_active }));

    const preExtend = await insertGrant({ grant_type: 'extend', capabilities: { view: true }, people_scope: { type: 'all_company', values: [] } });
    const preRestrict = await insertGrant({ grant_type: 'restrict', capabilities: {}, people_scope: { type: 'employees', values: ['PHF082'] } }); // narrows PHF012's view to PHF082 only, excluding B1's primary PHF004
    liveIds = [preExtend.id, preRestrict.id];

    pass(await perms.canViewTask(session('PHF012'), relTask, relAssignees) === false, 'PARITY 1/canViewTask: PHF012 correctly DENIED view on B1 (primary=PHF004, outside the restricted [PHF082] boundary) despite the broader extend also being active');

    const listResult = await core.listTasks(session('PHF012'), { relation: 'received' });
    const leaked = (listResult.tasks || []).some(t => t.id === B1.id || t.task_code === PRIMARY_PHF004_CODE);
    pass(!leaked, 'PARITY 2/listTasks (also covers Calendar/Timeline/Report — same resolveAuthorizedTaskScope() choke point): B1 does NOT leak through the list surface for PHF012');

    await assert.rejects(() => core.getTaskDetail(session('PHF012'), B1.id), e => e.statusCode === 403 || e.statusCode === 404);
    pass(true, 'PARITY 3/getTaskDetail: direct-ID access to B1 is DENIED for PHF012, not just filtered out of listing');

    await deleteGrants(liveIds);
    liveIds = [];
  }

  // -------------------------------------------------------------------
  // FINAL CLEANUP VERIFICATION + BASELINE POST.
  // -------------------------------------------------------------------
  const remaining = await currentActivePhf012Grants();
  pass(remaining.length === 0, 'CLEANUP: zero ACTIVE task_permission_grants remain for PHF012 — every temporary fixture this gate created has been revoked (hard DELETE where granted, canonical soft is_active=false otherwise)');

  const baselinePost = await perms.resolveEffectiveTaskScope(session('PHF012'));
  pass(JSON.stringify(baselinePost.scope) === JSON.stringify(baselinePre.scope), 'BASELINE POST: PHF012 effective scope byte-identical to the PRE-gate baseline — actor genuinely returned to exactly where it started');

  const reportFixtureCount = await fixtures.liveReportFixtureCount(supabase);
  pass(reportFixtureCount === MANIFEST.counts.created, MANIFEST.counts.created + ' [REPORT-UI-TEST] fixtures untouched by this gate (manifest-derived)');

  console.log(`PHF Task Permission Grant Precedence Fix V1: ${passed}/${passed} PASS`);
})().catch(async err => {
  console.error('FAIL', err);
  try {
    if (liveIds.length) {
      for (const id of liveIds) {
        const r = await supabase.from('task_permission_grants').delete().eq('id', id).select('*');
        if (r.error && r.error.code === '42501') await supabase.from('task_permission_grants').update({ is_active: false }).eq('id', id);
      }
      console.error('FAIL-PATH CLEANUP: revoked in-flight fixture grant IDs:', liveIds);
    }
  } catch (cleanupErr) {
    console.error('FAIL-PATH CLEANUP ALSO FAILED (manual check required):', cleanupErr);
  }
  process.exit(1);
});
