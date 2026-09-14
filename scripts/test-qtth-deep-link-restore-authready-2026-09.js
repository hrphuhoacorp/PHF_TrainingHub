'use strict';
/* PHF HR — QTTH deep-link restore-after-auth · offline regression check.
 *
 * Root cause (see conversation record): direct/cold navigation to an
 * /admin|ql|hv/qtth/* deep link (F5, pasted URL, fresh tab) goes through
 * phf-url-router.js's phfRestoreLastRouteAfterAuth(), which — for any target
 * NOT matched by the "light auth ready" exception — awaits the heavier
 * window.phfWhenAppReady() (full Training Hub dataset) instead of the
 * lightweight window.phfWhenAuthReady() (session only). If that heavier wait
 * is slower than phf-server-auth.js's 7s ROUTE_RESTORE_TIMEOUT watchdog, the
 * restore silently falls back to Home, discarding the deep link — BEFORE the
 * QTTH module's own canManageTruthData/canManagePermissions guard ever runs.
 * Checklist was already exempted from this; QTTH was not. This test proves
 * the regex extension puts QTTH (including Truth Data sub-paths) on the same
 * lightweight path, without touching any authorization logic.
 *
 * This is a static/source-level check (no DOM/browser harness required) —
 * it extracts the literal regex from the router source and exercises it
 * directly, the same way the fix itself is a single regex change.
 *
 * Run: node scripts/test-qtth-deep-link-restore-authready-2026-09.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
let pass = 0;
function ok(name, fn) { try { fn(); console.log('  PASS ' + name); pass++; } catch (e) { console.error('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; } }

console.log('QTTH deep-link restore (phfWhenAuthReady exception) — offline checks');

const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'phf-url-router.js'), 'utf8');

ok('old checklistTarget identifier is gone (clean rename, no dangling reference)', () => {
  assert.ok(!/checklistTarget/.test(src), 'checklistTarget should no longer appear in the source');
});

ok('lightAuthReadyTarget regex is present in phfRestoreLastRouteAfterAuth', () => {
  assert.ok(/var lightAuthReadyTarget=/.test(src), 'expected the renamed variable to be declared');
});

// Extract the exact regex literal the fix declares, so this test breaks if
// the pattern is ever edited without updating this coverage.
const m = src.match(/var lightAuthReadyTarget=(\/[^;]+\/)\.test\(/);
assert.ok(m, 'could not locate the lightAuthReadyTarget regex literal in source');
// eslint-disable-next-line no-eval
const REGEX = eval(m[1]);

ok('matches /admin/qtth (bare)', () => assert.ok(REGEX.test('/admin/qtth')));
ok('matches /admin/qtth/truth-data', () => assert.ok(REGEX.test('/admin/qtth/truth-data')));
ok('matches /admin/qtth/truth-data/payroll', () => assert.ok(REGEX.test('/admin/qtth/truth-data/payroll')));
ok('matches /admin/qtth/truth-data/accounting', () => assert.ok(REGEX.test('/admin/qtth/truth-data/accounting')));
ok('matches /admin/qtth/phan-quyen', () => assert.ok(REGEX.test('/admin/qtth/phan-quyen')));
ok('matches /ql/qtth/truth-data', () => assert.ok(REGEX.test('/ql/qtth/truth-data')));
ok('matches /hv/qtth', () => assert.ok(REGEX.test('/hv/qtth')));
ok('still matches /admin/checklist (Checklist exception preserved)', () => assert.ok(REGEX.test('/admin/checklist')));
ok('still matches /ql/checklist/phieu-danh-gia-thang (Checklist sub-path preserved)', () => assert.ok(REGEX.test('/ql/checklist/phieu-danh-gia-thang')));

ok('does NOT match unrelated modules (/admin/thi-dua)', () => assert.ok(!REGEX.test('/admin/thi-dua')));
ok('does NOT match unrelated modules (/admin/home)', () => assert.ok(!REGEX.test('/admin/home')));
ok('does NOT match a path that merely CONTAINS "qtth" as a substring (/admin/not-qtth-related)', () => assert.ok(!REGEX.test('/admin/not-qtth-related')));

console.log(pass + (process.exitCode ? ' passed (with failures)' : ' checks passed'));
