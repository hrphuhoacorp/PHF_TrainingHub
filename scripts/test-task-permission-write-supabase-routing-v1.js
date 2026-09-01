'use strict';

/*
 * PHF Task — PERMISSION WRITE HYBRID ROUTING LOCK (Step 2, 2026-08-31).
 *
 * NO network, NO DB. Proves that api/data.js routes the 3 Task PERMISSION
 * write actions to the Supabase-MAIN legacy path REGARDLESS of
 * PHF_TASK_SERVER_WRITE_ENABLED, while Task BUSINESS writes stay flag-gated
 * to Company PostgreSQL.
 *
 * Why this matters: api/_lib/task-permissions.js reads
 * task_permission_assignments / task_permission_grants from Supabase MAIN
 * unconditionally (no read-bridge, no flag). If permission WRITES went to
 * Company PostgreSQL (flag ON) they would silently no-op against the
 * Supabase read path — verified live 2026-08-31 (PG permission tables empty).
 *
 *   node scripts/test-task-permission-write-supabase-routing-v1.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_SRC = fs.readFileSync(path.join(ROOT, 'api/data.js'), 'utf8');
const PERM_SRC = fs.readFileSync(path.join(ROOT, 'api/_lib/task-permissions.js'), 'utf8');
let passed = 0;
function pass(cond, msg) { assert.ok(cond, msg); passed += 1; console.log('  PASS  ' + msg); }

function fnBody(src, name) {
  const m = src.match(new RegExp('async function ' + name + '\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}'));
  assert.ok(m, 'could not locate function ' + name + ' in api/data.js');
  return m[1];
}

// ---------------------------------------------------------------------------
// 1. STATIC — the 3 permission write wrappers are pinned to *Legacy
// ---------------------------------------------------------------------------
const permWrappers = ['saveTaskPermissionAssignment', 'createTaskPermissionGrant', 'revokeTaskPermissionGrant'];
for (const name of permWrappers) {
  const body = fnBody(DATA_SRC, name);
  pass(/Legacy\s*\(/.test(body), name + ': calls the *Legacy (Supabase MAIN) implementation');
  pass(body.indexOf('isTaskServerWriteEnabled') === -1, name + ': does NOT consult isTaskServerWriteEnabled() (not flag-gated)');
  pass(body.indexOf('ViaServer(') === -1, name + ': does NOT call the *ViaServer (Company PostgreSQL) path');
}

// ---------------------------------------------------------------------------
// 2. STATIC — Task BUSINESS writes remain flag-gated to Company PostgreSQL
// ---------------------------------------------------------------------------
for (const name of ['createTaskDraft', 'publishTask', 'updateTaskProgress', 'completeTask', 'cancelTask', 'createTaskCategory']) {
  const body = fnBody(DATA_SRC, name);
  pass(/if\s*\(isTaskServerWriteEnabled\(\)\)\s*return\s+\w+ViaServer/.test(body), name + ': STILL flag-gated `if (isTaskServerWriteEnabled()) return …ViaServer` — business routing UNCHANGED');
}

// ---------------------------------------------------------------------------
// 3. STATIC — the hybrid-lock rationale is documented in code + handover
// ---------------------------------------------------------------------------
pass(/HYBRID ROUTING LOCK/.test(DATA_SRC), 'api/data.js carries the "HYBRID ROUTING LOCK" comment block');
pass(fs.existsSync(path.join(ROOT, 'PHF_HR_TASK_PERMISSION_HYBRID_LOCK_2026-08-31.md')), 'handover note PHF_HR_TASK_PERMISSION_HYBRID_LOCK_2026-08-31.md exists');
pass(/future permission-cutover infrastructure|future-cutover infrastructure/.test(DATA_SRC), 'api/data.js notes the *ViaServer imports are intentionally-retained future-cutover infra');

// ---------------------------------------------------------------------------
// 4. STATIC — permission READ path is still Supabase MAIN (unconditional)
// ---------------------------------------------------------------------------
pass(/createClient\(/.test(PERM_SRC) && /@supabase\/supabase-js/.test(PERM_SRC), 'task-permissions.js still uses the Supabase client for permission reads');
pass(/ASSIGNMENTS_TABLE\s*=\s*'task_permission_assignments'/.test(PERM_SRC) && /GRANTS_TABLE\s*=\s*'task_permission_grants'/.test(PERM_SRC), 'task-permissions.js reads the Supabase tables task_permission_assignments / task_permission_grants');
pass(PERM_SRC.indexOf("require('./task-write-bridge')") === -1 && PERM_SRC.indexOf("require('./task-read-bridge')") === -1 && PERM_SRC.indexOf('task-server-integration') === -1, 'task-permissions.js has NO bridge / server-integration dependency (reads never hit Company PostgreSQL)');

// ---------------------------------------------------------------------------
// 5. FUNCTIONAL — eval each wrapper with stubs, assert routing under BOTH
//    flag states.
// ---------------------------------------------------------------------------
function evalWrapper(name) {
  const src = DATA_SRC.match(new RegExp('async function ' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}'))[0];
  const calls = [];
  const sandbox = {
    isTaskServerWriteEnabled: () => sandbox.__flag === true,
    saveTaskPermissionAssignmentLegacy: (...a) => { calls.push(['legacy', a]); return { via: 'supabase-main' }; },
    createTaskPermissionGrantLegacy: (...a) => { calls.push(['legacy', a]); return { via: 'supabase-main' }; },
    revokeTaskPermissionGrantLegacy: (...a) => { calls.push(['legacy', a]); return { via: 'supabase-main' }; },
    setTaskPermissionAssignmentViaServer: (...a) => { calls.push(['viaServer', a]); return { via: 'company-pg' }; },
    createTaskPermissionGrantViaServer: (...a) => { calls.push(['viaServer', a]); return { via: 'company-pg' }; },
    revokeTaskPermissionGrantViaServer: (...a) => { calls.push(['viaServer', a]); return { via: 'company-pg' }; },
    __flag: false
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function(Object.keys(sandbox).join(','), src + '\n return ' + name + ';');
  const fn = factory(...Object.keys(sandbox).map(k => sandbox[k]));
  return { fn, calls, sandbox };
}

(async () => {
  for (const flag of [false, true]) {
    {
      const { fn, calls, sandbox } = evalWrapper('saveTaskPermissionAssignment');
      sandbox.__flag = flag;
      const r = await fn({ sess: 1 }, { employeeCode: 'PHF010', presetCode: 'TRUONG_CA', reason: 'r' });
      pass(calls.length === 1 && calls[0][0] === 'legacy' && r.via === 'supabase-main', 'saveTaskPermissionAssignment -> Supabase MAIN legacy (flag=' + flag + ')');
    }
    {
      const { fn, calls, sandbox } = evalWrapper('createTaskPermissionGrant');
      sandbox.__flag = flag;
      await fn({}, { granteeEmployeeCode: 'PHF010' });
      pass(calls.length === 1 && calls[0][0] === 'legacy', 'createTaskPermissionGrant -> Supabase MAIN legacy (flag=' + flag + ')');
    }
    {
      const { fn, calls, sandbox } = evalWrapper('revokeTaskPermissionGrant');
      sandbox.__flag = flag;
      await fn({}, 'grant-1', 'reason');
      pass(calls.length === 1 && calls[0][0] === 'legacy', 'revokeTaskPermissionGrant -> Supabase MAIN legacy (flag=' + flag + ')');
    }
  }
  console.log('\nALL ' + passed + ' ASSERTIONS PASSED');
})().catch(err => { console.error(err); process.exit(1); });
