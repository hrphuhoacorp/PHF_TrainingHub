'use strict';
/* PHF HR — QTTH Batch 01 · offline checks (no DB, no network).
 * Verifies: action manifests are consistent Vercel<->phf-hr-api; the bridge is
 * OFF by default and fails closed; the roster merge/warning + capability guard
 * pure logic in the module app; period math. Run: node scripts/qtth-batch01-offline-checks.js
 */
const assert = require('assert');
let pass = 0;
function ok(name, fn) { try { fn(); console.log('  PASS ' + name); pass++; } catch (e) { console.error('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; } }

console.log('QTTH Batch 01 — offline checks');

// 1. bridge OFF by default, fails closed
ok('qtth bridge disabled by default', () => {
  delete process.env.PHF_QTTH_BRIDGE_ENABLED;
  const { isQtthBridgeEnabled, callQtthAction } = require('../api/_lib/qtth-bridge');
  assert.strictEqual(isQtthBridgeEnabled(), false);
  return callQtthAction('qtth.bootstrap', { accountId: 'x' }, {})
    .then(() => { throw new Error('should have thrown'); })
    .catch((e) => { assert.strictEqual(e.code, 'QTTH_BRIDGE_DISABLED'); });
});

// 2. phf-hr-api service action manifest covers every remote the Vercel layer calls
ok('Vercel <-> phf-hr-api action parity', () => {
  const svc = require('../services/phf-hr-api/lib/qtth-service');
  const remotes = new Set([
    'qtth.bootstrap', 'qtth.permissions.list', 'qtth.permissions.set', 'qtth.permissionManager.set',
    'qtth.dict.list', 'qtth.dict.upsert', 'qtth.classification.list', 'qtth.classification.set',
    'qtth.classification.bulkSet', 'qtth.classification.inheritMonth',
    'qtth.history.permission', 'qtth.history.classification',
  ]);
  for (const r of remotes) assert.ok(svc.ACTIONS.indexOf(r) >= 0, 'phf-hr-api missing handler: ' + r);
  for (const a of svc.ACTIONS) assert.ok(remotes.has(a), 'phf-hr-api has an unexpected handler: ' + a);
});

// 3. service authorization: non-admin non-manager rejected
ok('qtth-service rejects a non-authorized actor', () => {
  const svc = require('../services/phf-hr-api/lib/qtth-service');
  const fakeConfig = {};
  // dispatch resolves actor first (no DB), then requirePermissionManager which
  // hits DB — so stub is not possible offline; instead assert unknown-action + bad-actor paths.
  return Promise.all([
    svc.dispatch(fakeConfig, null, 'qtth.bootstrap', {}).then(() => { throw new Error('no actor should fail'); }, (e) => assert.strictEqual(e.code, 'QTTH_ACTOR_REQUIRED')),
    svc.dispatch(fakeConfig, { accountId: 'a' }, 'qtth.nope', {}).then(() => { throw new Error('unknown action should fail'); }, (e) => assert.strictEqual(e.code, 'QTTH_ACTION_UNKNOWN')),
  ]);
});

// 4. module app pure logic
ok('module app route + menu + guard logic', () => {
  const path = require('path');
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'qtth', 'phf-qtth-app.js'), 'utf8');
  // load the IIFE in a minimal window sandbox
  const window = { location: { pathname: '/admin/qtth/phan-quyen' } };
  const document = { getElementById: () => null, createElement: () => ({ style: {}, appendChild() {} }), body: { classList: { add() {} } }, addEventListener() {} };
  const fn = new Function('window', 'document', src + '\nreturn window.__phfQtthTestHooks;');
  const h = fn(window, document);
  assert.strictEqual(h.screenForPath('/admin/qtth'), '');
  assert.strictEqual(h.screenForPath('/ql/qtth/van-hanh'), 'van-hanh');
  assert.strictEqual(h.screenForPath('/hv/qtth/phan-quyen'), 'phan-quyen');
  assert.deepStrictEqual(h.menuModel({ canViewQtth: true }).map((x) => x.key), ['qtth']);
  assert.deepStrictEqual(h.menuModel({ canViewQtth: true, canViewOperations: true, canManagePermissions: true }).map((x) => x.key), ['qtth', 'van-hanh', 'phan-quyen']);
  assert.strictEqual(h.firstAllowed({ canViewOperations: true }), 'van-hanh');
  assert.strictEqual(h.firstAllowed({ canManagePermissions: true, canViewQtth: true }), 'phan-quyen');
  assert.strictEqual(h.firstAllowed({}), '');
  assert.strictEqual(h.prevPeriod('2026-01'), '2025-12');
  assert.strictEqual(h.prevPeriod('2026-09'), '2026-08');
  assert.ok(/^20\d{2}-(0[1-9]|1[0-2])$/.test(h.currentPeriod()));

  // Batch 01B — classification cells must render as text, never leak raw markup.
  const unset = h.classifiedCell('');
  assert.ok(unset.indexOf('<span class="phf-qtth-chip is-unset">Chưa phân loại</span>') === 0, 'unset chip must be real markup: ' + unset);
  assert.ok(unset.indexOf('&lt;') < 0, 'unset chip must not be escaped');
  const named = h.classifiedCell('Phú Lợi <x>');
  assert.ok(named.indexOf('&lt;x&gt;') >= 0, 'dictionary name must be escaped inside the chip: ' + named);
  assert.ok(named.indexOf('<span class="phf-qtth-chip">') === 0, 'named chip wrapper must be real markup');
  assert.strictEqual(h.staffKindCell('direct'), '<span class="phf-qtth-chip is-kind">Trực tiếp</span>');
  assert.ok(h.staffKindCell(null).indexOf('Chưa xác định') >= 0 && h.staffKindCell(null).indexOf('&lt;') < 0);
});

// 5. QTTH_ACTION_MANIFEST from qtth-actions matches what dispatch handles
ok('qtth-actions manifest is complete', () => {
  const { QTTH_ACTION_MANIFEST } = require('../api/_lib/qtth-actions');
  ['qtthBootstrap', 'qtthListRoster', 'qtthSetPermission', 'qtthSetClassification', 'qtthBulkSetClassification', 'qtthInheritMonth', 'qtthUpsertDictionary', 'qtthSetPermissionManager', 'qtthPermissionHistory', 'qtthClassificationHistory', 'qtthListDictionaries']
    .forEach((a) => assert.ok(QTTH_ACTION_MANIFEST.indexOf(a) >= 0, 'manifest missing ' + a));
});

// 6. migration shape
ok('migration declares schema, grants, history append-only guard, monthly period', () => {
  const fs = require('fs');
  const path = require('path');
  const up = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'phf_hr_qtth_foundation_v1.sql'), 'utf8');
  const down = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'phf_hr_qtth_foundation_v1_DOWN.sql'), 'utf8');
  assert.ok(/CREATE SCHEMA IF NOT EXISTS qtth/.test(up));
  assert.ok(/GRANT USAGE ON SCHEMA qtth TO phf_hr_app/.test(up));
  assert.ok(/block_history_mutation/.test(up));
  assert.ok(/period\s+text NOT NULL CHECK \(period ~ '\^20/.test(up));
  assert.ok(/staff_kind\s+text CHECK \(staff_kind IN \('direct','indirect'\)\)/.test(up));
  assert.ok(!/\n\s*ALTER DEFAULT PRIVILEGES/.test(up), 'must not use ALTER DEFAULT PRIVILEGES');
  assert.ok(/DROP TABLE IF EXISTS qtth\.classification_history/.test(down));
});

console.log('\n' + pass + ' checks passed' + (process.exitCode ? ' (with failures)' : ''));
