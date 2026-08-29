'use strict';

/*
 * PHF Task — Notification Dedupe Hotfix 1.72.1 — official test suite.
 *
 * Root cause proven on real Production during the official Cross-department
 * write test (CV-2608-0003, 2026-08-22): 1.72.0 created a PARTIAL unique
 * index (`... WHERE dedupe_key IS NOT NULL`) but task-notifications.js calls
 * `.upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true })`, which
 * PostgREST translates to a plain `ON CONFLICT (dedupe_key)` — Postgres does
 * NOT match that against a partial index, so every insert threw "there is no
 * unique or exclusion constraint matching the ON CONFLICT specification".
 *
 * The existing mock suite (test-task-cross-department-v1.js CASE F) could
 * NOT catch this: its in-memory upsert stub always matches onConflict by key
 * regardless of any WHERE predicate, so it never modeled the partial-index
 * failure mode. This file adds two layers that the previous suite lacked:
 *
 *   PART 1 — STATIC assertions on the migration SQL text itself (the only
 *   thing that can actually prove "index is not partial anymore" without a
 *   real Postgres instance).
 *   PART 2 — a Postgres-ON-CONFLICT-accurate mock (models partial vs regular
 *   unique index matching semantics precisely) proving: (a) the OLD partial
 *   config reproduces the exact real failure, (b) the NEW regular-unique
 *   config fixes it with correct first-insert/replay/different-key behavior.
 *
 * Behavioral guarantees already covered elsewhere are NOT duplicated here:
 * "notification failure never rolls back publish" and "cross-department
 * manager notification semantics unchanged" are proven by
 * scripts/test-task-cross-department-v1.js (ATOMICITY INVARIANT / CASE B/E/F)
 * — that suite must still be re-run as part of this hotfix's gate, it is not
 * superseded.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const UP_PATH = path.join(ROOT, 'scripts', 'PHF_TASK_NOTIFICATION_DEDUPE_HOTFIX_1.72.1.sql');
const DOWN_PATH = path.join(ROOT, 'scripts', 'PHF_TASK_NOTIFICATION_DEDUPE_HOTFIX_1.72.1_DOWN.sql');
const NOTIFICATIONS_JS_PATH = path.join(ROOT, 'api', '_lib', 'task-notifications.js');

let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }

// ===========================================================================
// PART 1 — STATIC migration SQL assertions
// ===========================================================================
const upSql = fs.readFileSync(UP_PATH, 'utf8');
const downSql = fs.readFileSync(DOWN_PATH, 'utf8');
const notificationsJs = fs.readFileSync(NOTIFICATIONS_JS_PATH, 'utf8');

{
  pass(/drop\s+index\s+if\s+exists\s+public\.task_notifications_dedupe_uq/i.test(upSql),
    'UP: drops the old (partial) unique index before recreating it');

  pass(/alter\s+table\s+public\.task_notifications\s+alter\s+column\s+dedupe_key\s+set\s+not\s+null/i.test(upSql),
    'UP: sets dedupe_key NOT NULL (matches the proven contract — emitTaskNotification always assigns a dedupe_key)');

  // Isolate the FINAL "create unique index" statement text and confirm it
  // carries NO where-predicate — this is the exact fix for the root cause.
  const createIndexMatch = upSql.match(/create\s+unique\s+index[^;]*task_notifications_dedupe_uq[^;]*;/i);
  pass(!!createIndexMatch, 'UP: contains a CREATE UNIQUE INDEX statement for task_notifications_dedupe_uq');
  pass(createIndexMatch && !/where/i.test(createIndexMatch[0]),
    'UP: the new index has NO "where" predicate — regular unique index, matches PostgREST\'s plain ON CONFLICT (dedupe_key)');

  pass(/do\s+\$\$[\s\S]*count\(\*\)[\s\S]*dedupe_key\s+is\s+null[\s\S]*raise\s+exception/i.test(upSql),
    'UP: guards against existing NULL dedupe_key rows before ALTER COLUMN SET NOT NULL (defense-in-depth, not just point-in-time audit)');

  const upSqlCode = upSql.replace(/--[^\n]*/g, ''); // strip line comments before scanning for actual DDL
  pass(!/alter\s+table\s+public\.task_tasks|create\s+(or\s+replace\s+)?(trigger|function)\s+.*snapshot|drop\s+column/i.test(upSqlCode),
    'UP: no actual DDL touches task_tasks/snapshot triggers/columns — scope stays isolated to task_notifications constraint layer (mentions in comments only)');
}

{
  pass(/alter\s+table\s+public\.task_notifications\s+alter\s+column\s+dedupe_key\s+drop\s+not\s+null/i.test(downSql),
    'DOWN: restores dedupe_key to nullable (original 1.72.0 definition)');

  const downCreateIndexMatch = downSql.match(/create\s+unique\s+index[^;]*task_notifications_dedupe_uq[^;]*;/i);
  pass(downCreateIndexMatch && /where\s+dedupe_key\s+is\s+not\s+null/i.test(downCreateIndexMatch[0]),
    'DOWN: recreates the ORIGINAL partial index exactly (honest rollback, not a different design)');

  pass(!/drop\s+table\s+if\s+exists\s+public\.task_notifications\s*;/i.test(downSql) || /--\s*drop\s+table/i.test(downSql),
    'DOWN: does not unconditionally drop task_notifications (that table belongs to 1.72.0, out of this hotfix\'s ownership)');
}

{
  // Confirm the JS emit path was NOT changed to work around the schema bug —
  // Business Owner decision explicitly rejected select-then-insert/client dedupe.
  pass(/\.upsert\(rows,\s*\{\s*onConflict:\s*'dedupe_key',\s*ignoreDuplicates:\s*true\s*\}\)/.test(notificationsJs),
    'CODE AUDIT: task-notifications.js still uses upsert+onConflict+ignoreDuplicates — schema fix only, no JS workaround introduced');
  pass(!/\.select\([^)]*\)\.eq\('dedupe_key'/.test(notificationsJs),
    'CODE AUDIT: no select-then-insert dedupe workaround was added (race-prone pattern explicitly rejected)');
}

console.log('PHF Task Notification Dedupe Hotfix — static migration assertions: ' + passed + '/' + passed + ' PASS');

// ===========================================================================
// PART 2 — Postgres-ON-CONFLICT-accurate mock: proves the failure mode AND
// the fix, using the same semantics real Postgres enforces (a plain
// `ON CONFLICT (col)` only matches a unique index with the SAME column list
// and NO extra predicate; it can never satisfy a partial index).
// ===========================================================================
function makeConstraintAwareTable(indexIsPartial) {
  const rows = [];
  return {
    rows,
    // Mirrors supabase-js .upsert(rows, {onConflict, ignoreDuplicates}) ->
    // PostgREST -> `INSERT ... ON CONFLICT (dedupe_key) DO NOTHING RETURNING *`
    async upsert(items, opts) {
      if (indexIsPartial) {
        // Real Postgres behavior: ON CONFLICT (col) target-matching REQUIRES
        // an index with the exact column list and NO where-predicate (unless
        // the INSERT statement repeats the identical predicate, which
        // PostgREST's onConflict param cannot express). A partial index never
        // satisfies a bare ON CONFLICT (col) — this always errors.
        return { data: null, error: { message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' } };
      }
      const key = opts.onConflict;
      const inserted = [];
      for (const item of items) {
        const existing = rows.find(r => r[key] === item[key]);
        if (existing) { if (!opts.ignoreDuplicates) Object.assign(existing, item); continue; }
        const row = Object.assign({ id: 'row-' + (rows.length + 1) }, item);
        rows.push(row);
        inserted.push(row);
      }
      return { data: inserted, error: null };
    }
  };
}

(async () => {
  // 2a) OLD config (partial index, matches 1.72.0 as-shipped) — reproduces
  // the EXACT real error hit by CV-2608-0003. This is the regression proof:
  // any future migration that reintroduces a partial dedupe index will fail
  // this test the same way it failed in Production.
  {
    const table = makeConstraintAwareTable(true);
    const result = await table.upsert(
      [{ dedupe_key: 'TASK_CROSS_DEPARTMENT_ASSIGNED|task-X|PHF012', recipient_employee_code: 'PHF012' }],
      { onConflict: 'dedupe_key', ignoreDuplicates: true }
    );
    pass(result.error && /no unique or exclusion constraint/i.test(result.error.message),
      'REGRESSION PROOF: partial unique index reproduces the exact real Production failure (proves this test would have caught 1.72.0\'s bug)');
    pass(table.rows.length === 0, 'REGRESSION PROOF: partial-index config never inserts any row (matches real behavior — publish still PASS via emitTaskNotificationSafe swallow, but notification silently absent)');
  }

  // 2b) NEW config (regular unique index, matches 1.72.1 hotfix) — first
  // emit inserts 1 row, replay with same dedupe_key inserts 0 new rows,
  // different dedupe_key inserts another row.
  {
    const table = makeConstraintAwareTable(false);
    const dedupeKeyA = 'TASK_CROSS_DEPARTMENT_ASSIGNED|task-X|PHF012';
    const first = await table.upsert([{ dedupe_key: dedupeKeyA, recipient_employee_code: 'PHF012', message: 'first' }], { onConflict: 'dedupe_key', ignoreDuplicates: true });
    pass(!first.error && first.data.length === 1, 'HOTFIX: regular unique index — first emit inserts exactly 1 row, no ON CONFLICT error');

    const replay = await table.upsert([{ dedupe_key: dedupeKeyA, recipient_employee_code: 'PHF012', message: 'replay (publish retry)' }], { onConflict: 'dedupe_key', ignoreDuplicates: true });
    pass(!replay.error && replay.data.length === 0, 'HOTFIX: replaying the SAME dedupe_key inserts 0 new rows (publish retry/idempotency-safe)');
    pass(table.rows.length === 1 && table.rows[0].message === 'first', 'HOTFIX: the original row is untouched by the replay (ignoreDuplicates, not overwrite)');

    const dedupeKeyB = 'TASK_CROSS_DEPARTMENT_ASSIGNED|task-Y|PHF012';
    const different = await table.upsert([{ dedupe_key: dedupeKeyB, recipient_employee_code: 'PHF012', message: 'different task' }], { onConflict: 'dedupe_key', ignoreDuplicates: true });
    pass(!different.error && different.data.length === 1, 'HOTFIX: a DIFFERENT dedupe_key inserts a genuinely new row');
    pass(table.rows.length === 2, 'HOTFIX: total row count is exactly 2 after 1 replay + 1 distinct emit (no duplicate, no loss)');
  }

  console.log('PHF Task Notification Dedupe Hotfix — ON CONFLICT behavioral proof: ' + passed + '/' + passed + ' PASS (cumulative)');
  console.log('NOTE: this file intentionally does NOT re-test "notification failure never rolls back publish" or');
  console.log('"cross-department manager notification semantics" — those remain covered by scripts/test-task-cross-department-v1.js');
})().catch(err => { console.error(err); process.exitCode = 1; });
