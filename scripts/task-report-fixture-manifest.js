'use strict';

/*
 * PHF Task — canonical Report/Progress fixture manifest reader (Phase B).
 *
 * Single source of truth for every Task report/progress regression that needs
 * the [REPORT-UI-TEST] fixture corpus. Produced by
 * scripts/test-task-report-ui-fixture-seed-today.js.
 *
 * Tests MUST look fixtures up by ROLE here — never a hard-coded CV-2608-00NN
 * literal, never a magic total count. task_code is DB-assigned and the corpus
 * is allowed to grow; only the SEMANTIC composition is contractual.
 *
 * Usage:
 *   const fx = require('./task-report-fixture-manifest');
 *   const m = fx.load();                       // throws if missing/malformed
 *   await fx.assertFresh(supabase);            // throws if DB != manifest
 *   const a5 = m.semantic.completedOnTimeCoordinatorFanout;
 *   const before = await fx.liveReportFixtureCount(supabase);
 *   ... run the thing under test ...
 *   assert.strictEqual(await fx.liveReportFixtureCount(supabase), before); // "untouched"
 */

const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.join(__dirname, 'test-task-report-ui-fixture-seed-today.result.json');
const DEFAULT_MARKER = '[REPORT-UI-TEST]';
const RESEED_HINT = 'Run:  node scripts/test-task-report-ui-fixture-seed-today.js  (against SANDBOX) to (re)create the corpus and its manifest.';

function load() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error('TASK_FIXTURE_MANIFEST_MISSING: ' + MANIFEST_PATH + ' not found. ' + RESEED_HINT);
  }
  let m;
  try {
    m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (e) {
    throw new Error('TASK_FIXTURE_MANIFEST_MALFORMED: ' + e.message + '. ' + RESEED_HINT);
  }
  if (!m || !m.seededAt || !m.counts || !m.semantic || !m.plans || !Array.isArray(m.created)) {
    throw new Error('TASK_FIXTURE_MANIFEST_STALE_SHAPE: manifest predates the Phase B canonical shape (needs seededAt/counts/semantic/plans/created). ' + RESEED_HINT);
  }
  m.marker = m.marker || DEFAULT_MARKER;
  return m;
}

async function liveReportFixtureCount(supabase, marker) {
  const mk = marker || DEFAULT_MARKER;
  const { count, error } = await supabase
    .from('task_tasks')
    .select('id', { count: 'exact', head: true })
    .ilike('title', '%' + mk + '%');
  if (error) throw new Error('TASK_FIXTURE_COUNT_QUERY_FAILED: ' + error.code + ' ' + error.message);
  return count;
}

// Throws unless the live DB corpus matches the manifest exactly (count + every
// recorded task_code still present). This is what turns "expected failure due
// to drift" into a deterministic, self-healing check: reseed => manifest and DB
// move together; tests keep passing.
async function assertFresh(supabase) {
  const m = load();
  const live = await liveReportFixtureCount(supabase, m.marker);
  if (live !== m.counts.created) {
    throw new Error(
      'TASK_FIXTURE_MANIFEST_OUT_OF_SYNC: manifest records ' + m.counts.created +
      ' fixtures, DB has ' + live + ' with marker ' + m.marker + '. ' + RESEED_HINT
    );
  }
  const codes = m.created.map(c => c.task_code).filter(Boolean);
  const { data, error } = await supabase.from('task_tasks').select('task_code').in('task_code', codes);
  if (error) throw new Error('TASK_FIXTURE_VERIFY_QUERY_FAILED: ' + error.code + ' ' + error.message);
  const present = new Set((data || []).map(r => r.task_code));
  const missing = codes.filter(c => !present.has(c));
  if (missing.length) {
    throw new Error('TASK_FIXTURE_MANIFEST_OUT_OF_SYNC: manifest task_codes missing from DB: ' + missing.join(', ') + '. ' + RESEED_HINT);
  }
  return m;
}

function requireSemantic(m, key) {
  const v = m.semantic[key];
  if (!v || !v.task_code) {
    throw new Error('TASK_FIXTURE_SEMANTIC_MISSING: no fixture for semantic role "' + key + '". ' + RESEED_HINT);
  }
  return v;
}

module.exports = { load, liveReportFixtureCount, assertFresh, requireSemantic, MANIFEST_PATH, DEFAULT_MARKER };
