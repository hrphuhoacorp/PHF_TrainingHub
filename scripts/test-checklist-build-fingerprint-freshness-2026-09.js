'use strict';
/*
 * Regression — cache-bust fingerprint freshness (2026-09-13 incident).
 *
 * PROD incident: PR #79/#80/#81 all changed assets/js/checklist/phf-checklist-app.js but none
 * bumped build-info.json's top-level version/fingerprint. vercel.json serves /assets/js/:path*
 * and /assets/css/:path* with Cache-Control: public, max-age=31536000, immutable; index.html's
 * window.phfAssetUrl() cache-busts every checklist asset URL with ?v=<this fingerprint>. Since
 * the fingerprint never changed, the asset URL stayed byte-identical across 3 real deploys, so
 * browsers that had already cached it kept serving the pre-fix bundle indefinitely — even
 * though the server-side deploy and the underlying JS fix were both genuinely correct. Real
 * Admin evidence: brand-new templates created strictly AFTER PR #81's deploy went Ready still
 * hit the bug PR #81 fixed, while direct function-level tests against the same merged source
 * passed 12/12 (those tests execute the file directly — no concept of HTTP caching).
 *
 * This check does NOT (and cannot) verify that every future JS/CSS change bumps the
 * fingerprint — that would need a git-diff-aware release gate, which is out of scope here
 * ("do not build a large framework"). It only asserts two cheap, concrete things:
 *   1. The specific stale value from this incident is gone (proves THIS bump happened).
 *   2. fingerprint follows the '<version>-<slug>' convention build-info.json already uses
 *      throughout its history, so the next person bumping it does it in the expected shape
 *      (window.phfAssetUrl() just concatenates it into a URL — nothing enforces the shape).
 *
 *   node scripts/test-checklist-build-fingerprint-freshness-2026-09.js
 */
const assert = require('assert');
const path = require('path');

const buildInfo = require(path.resolve(__dirname, '..', 'build-info.json'));

let failures = 0, passed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS: ' + name); passed++; }
  catch (e) { failures++; console.error('FAIL: ' + name + '\n  ' + (e && e.message ? e.message : e)); }
}

const STALE_VERSION = '1.70.5';
const STALE_FINGERPRINT = '1.70.5-notice-uiux-final';

check('build-info.json has non-empty top-level version/fingerprint/builtAt (consumed by window.phfAssetUrl() in index.html)', () => {
  assert.ok(typeof buildInfo.version === 'string' && buildInfo.version.trim(), 'version must be a non-empty string');
  assert.ok(typeof buildInfo.fingerprint === 'string' && buildInfo.fingerprint.trim(), 'fingerprint must be a non-empty string');
  assert.ok(typeof buildInfo.builtAt === 'string' && buildInfo.builtAt.trim(), 'builtAt must be a non-empty string');
});

check('version/fingerprint are no longer the stale values from the 2026-09-13 cache-bust incident (PR #79/#80/#81 never bumped them)', () => {
  assert.notStrictEqual(buildInfo.version, STALE_VERSION, 'version still equals the pre-incident stale value — checklist JS changes will keep being served from an immutable-cached stale bundle');
  assert.notStrictEqual(buildInfo.fingerprint, STALE_FINGERPRINT, 'fingerprint still equals the pre-incident stale value — the cache-busted asset URL has not actually changed');
});

check('fingerprint follows this file\'s own "<version>-<slug>" convention (e.g. "1.70.5-notice-uiux-final") so window.phfAssetUrl()\'s ?v= query stays a meaningful, unique cache key', () => {
  assert.ok(buildInfo.fingerprint.indexOf(buildInfo.version) === 0, 'fingerprint should start with the current version, e.g. "' + buildInfo.version + '-<slug>"');
  assert.ok(/^[0-9a-z.\-]+$/i.test(buildInfo.fingerprint), 'fingerprint should stay URL-query-safe (letters, digits, dots, hyphens only) — it is concatenated directly into an asset URL by phfAssetUrl()');
});

console.log('\n' + passed + ' PASS, ' + failures + ' FAIL');
if (failures > 0) process.exit(1);
