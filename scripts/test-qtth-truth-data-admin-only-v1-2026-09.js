'use strict';
/* PHF HR — QTTH Truth Data (Payroll/Accounting/BHXH/Processing Cost) ·
 * Admin-only authorization · offline unit checks (no DB, no network).
 *
 * Verifies the SERVER-SIDE guard directly (not the UI): every Truth Data
 * HANDLERS[action] in services/phf-hr-api/lib/qtth-service.js must reject a
 * non-Admin actor (manager, learner, dev-operator flag set) BEFORE any DB
 * call — requireTruthDataAdmin() is synchronous and throws first — and must
 * NEVER accept qtth.permission_manager_grant as a substitute for
 * actor.systemRole === 'admin'.
 *
 * Positive (Admin-allowed) path is NOT re-verified here against a live DB;
 * requireTruthDataAdmin() is a synchronous `requireAdmin(actor)` call with no
 * side effects for an admin actor, so allowing it through is a pure
 * pass-through unchanged from the pre-fix code path for real Admins.
 *
 * Run: node scripts/test-qtth-truth-data-admin-only-v1-2026-09.js
 */
const assert = require('assert');
let pass = 0;
function ok(name, fn) { try { fn(); console.log('  PASS ' + name); pass++; } catch (e) { console.error('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; } }

console.log('QTTH Truth Data — Admin-only authorization offline checks');

const svc = require('../services/phf-hr-api/lib/qtth-service');
const FAKE_CONFIG = {}; // never reached if the guard rejects synchronously first

// One representative action per Truth Data source.
const TRUTH_DATA_PROBES = [
  ['payroll.status', {}],
  ['accounting.status', {}],
  ['bhxh.status', {}],
  ['processingCost.status', {}],
];

for (const [action, params] of TRUTH_DATA_PROBES) {
  ok(action + ' rejects a delegated (non-admin) permission-manager-shaped actor', () => {
    // NOTE: this actor has no DB-backed grant row to check against — the point
    // is requireTruthDataAdmin() must reject on actor.systemRole alone, before
    // ever querying qtth.permission_manager_grant.
    const actor = { accountId: 'ACC_1', employeeCode: 'PHF001', systemRole: 'manager', displayName: 'Non-Admin Manager' };
    const handler = svc.HANDLERS[action];
    assert.ok(typeof handler === 'function', 'handler missing: ' + action);
    return handler(FAKE_CONFIG, actor, params).then(
      () => { throw new Error('should have rejected a non-admin actor'); },
      (e) => assert.strictEqual(e.code, 'QTTH_ADMIN_REQUIRED')
    );
  });

  ok(action + ' rejects a _devOperator (dev allow-list) non-admin actor', () => {
    // _devOperator elevates Phân quyền management (requirePermissionManager)
    // but must NEVER elevate Truth Data — confirms requireTruthDataAdmin()
    // ignores actor._devOperator entirely.
    const actor = { accountId: 'ACC_2', employeeCode: 'PHF002', systemRole: 'manager', displayName: 'Dev Operator', _devOperator: true };
    const handler = svc.HANDLERS[action];
    return handler(FAKE_CONFIG, actor, params).then(
      () => { throw new Error('should have rejected a _devOperator non-admin actor'); },
      (e) => assert.strictEqual(e.code, 'QTTH_ADMIN_REQUIRED')
    );
  });

  ok(action + ' rejects a plain learner actor', () => {
    const actor = { accountId: 'ACC_3', employeeCode: 'PHF003', systemRole: 'learner', displayName: 'Learner' };
    const handler = svc.HANDLERS[action];
    return handler(FAKE_CONFIG, actor, params).then(
      () => { throw new Error('should have rejected a learner actor'); },
      (e) => assert.strictEqual(e.code, 'QTTH_ADMIN_REQUIRED')
    );
  });
}

// qtth.bootstrap: canManageTruthData must be strictly tied to systemRole==='admin',
// independent of canManagePermissions (Phân quyền delegation stays untouched).
ok('qtth.bootstrap: non-admin, no dev lock -> canManageTruthData=false even though DB grant is not checked for admin-only', () => {
  delete process.env.QTTH_DEV_ACCESS_ALLOW;
  const actor = { accountId: 'ACC_4', employeeCode: 'PHF004', systemRole: 'manager', displayName: 'Manager' };
  // qtth.bootstrap for a non-admin DOES read DB (permission_manager_grant +
  // module_permission) to compute canManagePermissions/canView* — so this
  // probe only checks the shape/branch logic is present in source, not a live
  // DB call. Instead assert the FUNCTION SOURCE ties canManageTruthData to
  // `admin` and never to `row.mgr` (the grant lookup result).
  const src = svc.HANDLERS['qtth.bootstrap'].toString();
  assert.ok(/canManageTruthData:\s*admin\b/.test(src), 'canManageTruthData must be assigned directly from `admin`, not from a grant/devOperator variable');
  assert.ok(!/canManageTruthData:\s*(canManagePermissions|row\.mgr|devOperator|dg\.operator)/.test(src), 'canManageTruthData must never be derived from permission_manager_grant/_devOperator/dev allow-list');
});

ok('qtth.bootstrap: dev-locked branches hardcode canManageTruthData=false', () => {
  const src = svc.HANDLERS['qtth.bootstrap'].toString();
  const falseCount = (src.match(/canManageTruthData:\s*false/g) || []).length;
  assert.strictEqual(falseCount, 2, 'both dev-lock branches (denied + allow-listed operator) must hardcode canManageTruthData:false');
});

console.log(pass + (process.exitCode ? ' passed (with failures)' : ' checks passed'));
