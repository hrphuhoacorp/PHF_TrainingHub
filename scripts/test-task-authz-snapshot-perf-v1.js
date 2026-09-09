'use strict';

/*
 * PHF Task — PERF FIX V1 acceptance: REQUEST-SCOPED AUTHORIZATION SNAPSHOT.
 *
 * Proves the measurable invariant, not just "green":
 *
 *   For a Task-detail open by a NON-admin actor, the permission store
 *   (task_permission_assignments + task_permission_grants on Supabase MAIN) is
 *   read exactly ONCE per request (2 queries) instead of 3-5x (6-10 queries).
 *
 * Method: load @supabase/supabase-js as a counting stub (same Module._load
 * override pattern as test-task-permission-v1.js), then drive the exact
 * authorization sequence getTaskDetailViaServer() runs:
 *     resolveEffectiveTaskScope(session)            [NEW: once, explicit]
 *     resolveAndAuthorizeView(..., effective)       -> canViewTask(..., effective)
 *     resolveTaskViewerAuthority(..., effective)    -> canViewTask / resolveUpdateAuthorityBasis
 *                                                     / resolveDirectCancelAuthorityBasis (all w/ effective)
 *
 * BEFORE numbers come from the origin/main (8e443ab) copies of the 3 files,
 * loaded side-by-side under the SAME stub. No DB, no network, no fixtures.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://sandbox-stub.supabase.co';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'stub';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const realSupabase = require.resolve('@supabase/supabase-js');

// ---- counting Supabase stub -------------------------------------------------
const counters = { assignments: 0, grants: 0, orgFetch: 0, other: 0 };
function makeQuery(table) {
  const q = {
    _table: table,
    select() { return q; },
    eq() { return q; },
    in() { return q; },
    lte() { return q; },
    gte() { return q; },
    lt() { return q; },
    or() { return q; },
    order() { return q; },
    limit() { return Promise.resolve({ data: [], error: null }); },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    then(res) { return Promise.resolve({ data: [], error: null }).then(res); },
  };
  return q;
}
const stubClient = {
  from(table) {
    if (table === 'task_permission_assignments') counters.assignments++;
    else if (table === 'task_permission_grants') counters.grants++;
    else counters.other++;
    return makeQuery(table);
  },
};
const stub = { createClient: () => stubClient };

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@supabase/supabase-js') return stub;
  return origLoad.apply(this, arguments);
};

// ---- stub People Master (employee-master) so loadOrgRows() is deterministic -
// Two active employees: an actor (primary of the task) and a manager.
const ORG = {
  ready: true,
  rows: [
    { employee_code: 'PHF900', full_name: 'Actor Primary', department: 'Bộ phận bán hàng', title: 'NV', position: '', branch: 'Phú Lợi', manager_employee_code: 'PHF901', employment_status: 'active' },
    { employee_code: 'PHF901', full_name: 'Manager', department: 'Bộ phận bán hàng', title: 'TBP', position: '', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  ],
};
const emPath = require.resolve('../api/_lib/employee-master');
require(emPath);
require.cache[emPath].exports.loadCanonicalEmployeeProfiles = async () => { counters.orgFetch++; return ORG; };

// auth.listHubAccountSummaries — used only by proposal path, stub empty.
const authPath = require.resolve('../api/_lib/auth');
require(authPath);
require.cache[authPath].exports.listHubAccountSummaries = async () => [];

// ---------------------------------------------------------------------------
function freshRequire(files) {
  // wipe the 3 target modules + their scope/perm siblings from cache so a
  // second load re-reads from disk
  Object.keys(require.cache)
    .filter(k => /api[\\/]_lib[\\/]task-(permissions|core|server-integration|employee-scope|read-bridge)\.js$/.test(k))
    .forEach(k => { delete require.cache[k]; });
  // re-stub employee-master + auth after cache wipe of dependents
  require.cache[emPath].exports.loadCanonicalEmployeeProfiles = async () => { counters.orgFetch++; return ORG; };
  require.cache[authPath].exports.listHubAccountSummaries = async () => [];
  return require(files);
}

let PERSONA = 'A_denied_manager_of_primary';
const TASK_ROW = { created_by_account_id: 'acc-someone-else', created_by_employee_code: 'PHF800' };
const ASSIGNEES = [{ employee_code: 'PHF900', role: 'primary', is_active: true }];
function sessionForPersona() {
  // A: actor = PHF901 (manager of the primary), no Task authority -> canView=false
  // B: actor = PHF900 (the active primary itself), not the creator -> canView=true, full RTVA path
  return PERSONA === 'B_active_primary_not_creator'
    ? { account: { id: 'acc-primary', role: 'user', employeeCode: 'PHF900', name: 'Actor Primary' } }
    : { account: { id: 'acc-mgr', role: 'user', employeeCode: 'PHF901', name: 'Manager' } };
}

async function measure(label, permModulePath, useSnapshot) {
  counters.assignments = 0; counters.grants = 0; counters.orgFetch = 0; counters.other = 0;
  const perms = freshRequire(permModulePath);
  const SESSION = sessionForPersona();
  const relTask = { createdByAccountId: TASK_ROW.created_by_account_id, createdByEmployeeCode: TASK_ROW.created_by_employee_code };
  const relAssignees = ASSIGNEES.map(r => ({ employeeCode: r.employee_code, role: r.role, isActive: r.is_active }));

  if (useSnapshot) {
    const eff = await perms.resolveEffectiveTaskScope(SESSION);
    let scopeResolves = 1;
    await perms.canViewTask(SESSION, relTask, relAssignees, eff);
    await perms.resolveTaskViewerAuthority(SESSION, TASK_ROW, ASSIGNEES, eff);
    return { label, queries: counters.assignments + counters.grants, assignments: counters.assignments, grants: counters.grants, scopeResolves };
  }
  // BEFORE: the pre-fix call sites had no snapshot arg — canViewTask +
  // resolveTaskViewerAuthority each re-resolved from scratch, and RTVA
  // re-resolved 3-4x more internally.
  await perms.canViewTask(SESSION, relTask, relAssignees);
  await perms.resolveTaskViewerAuthority(SESSION, TASK_ROW, ASSIGNEES);
  return { label, queries: counters.assignments + counters.grants, assignments: counters.assignments, grants: counters.grants };
}

(async () => {
  // Materialize origin/main baseline: full copy of api/_lib, then overwrite the
  // 3 target files with their 8e443ab versions. baseDir lives inside the
  // worktree so ../node_modules resolves; cleaned up at the end.
  const baseDir = path.join(ROOT, 'scripts', '.baseline-tmp-' + process.pid);
  fs.mkdirSync(path.join(baseDir, 'api'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'api', '_lib'), path.join(baseDir, 'api', '_lib'), { recursive: true });
  for (const f of ['task-permissions.js', 'task-core.js', 'task-server-integration.js']) {
    const content = execFileSync('git', ['show', `8e443ab:api/_lib/${f}`], { cwd: ROOT, maxBuffer: 1 << 24 });
    fs.writeFileSync(path.join(baseDir, 'api', '_lib', f), content);
  }
  // deterministic stubs for the baseline copy's People Master + account source
  fs.writeFileSync(path.join(baseDir, 'api', '_lib', 'employee-master.js'),
    `module.exports = { loadCanonicalEmployeeProfiles: async () => { global.__PHF_ORG_FETCH__ = (global.__PHF_ORG_FETCH__||0)+1; return ${JSON.stringify(ORG)}; } };`);
  fs.writeFileSync(path.join(baseDir, 'api', '_lib', 'auth.js'),
    `module.exports = { listHubAccountSummaries: async () => [] };`);

  const baseP = path.join(baseDir, 'api', '_lib', 'task-permissions.js');
  const curP = path.resolve(ROOT, 'api', '_lib', 'task-permissions.js');

  const rows = [];
  // Persona A: viewer denied (manager_of_primary, no authority) — canView=false,
  // so RTVA short-circuits update/cancel basis. BEFORE = 3 scope resolves.
  PERSONA = 'A_denied_manager_of_primary';
  rows.push(['A  manager_of_primary, no authority (canView=false)',
    await measure('before', baseP, false), await measure('after', curP, true)]);
  // Persona B: active primary, NOT creator — canView=true, not creator, so RTVA
  // ALSO runs resolveUpdateAuthorityBasis + resolveDirectCancelAuthorityBasis.
  // BEFORE = 5 scope resolves = 10 permission-store queries. Worst case.
  PERSONA = 'B_active_primary_not_creator';
  rows.push(['B  active primary, not creator (full RTVA path)',
    await measure('before', baseP, false), await measure('after', curP, true)]);

  try { fs.rmSync(baseDir, { recursive: true, force: true }); } catch (e) {}

  console.log('\n  Permission-store reads (task_permission_assignments + task_permission_grants) per Task-detail authorization sequence:\n');
  let ok = true;
  for (const [label, b, a] of rows) {
    const red = b.queries ? Math.round((1 - a.queries / b.queries) * 100) : 0;
    console.log(`   ${label}`);
    console.log(`     BEFORE (8e443ab): ${b.assignments} + ${b.grants} = ${b.queries}`);
    console.log(`     AFTER  (perf v1): ${a.assignments} + ${a.grants} = ${a.queries}   (-${red}%)\n`);
    if (!(a.queries === 2 && a.assignments === 1 && a.grants === 1)) ok = false;
    if (!(a.queries < b.queries)) ok = false;
  }
  assert.ok(rows[0][1].queries === 6, 'Persona A BEFORE = 6');
  assert.ok(rows[1][1].queries === 10, 'Persona B BEFORE = 10 (worst case, matches audit)');
  assert.ok(ok, 'every persona: AFTER = exactly 2 (1 assignment + 1 grant), and reduced');

  console.log('  test-task-authz-snapshot-perf-v1: PASS (query-count invariant proven)\n');
})().catch(e => { console.error('HARNESS_CRASH', e); process.exit(1); });
