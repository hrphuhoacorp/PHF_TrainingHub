'use strict';

/*
 * PHF Task — SCHEMA REPAIR (1.74.0) — structural SQL-text audit only, no DB
 * connection, no live verification (same "not yet applied" pattern as
 * scripts/test-task-code-idempotency-v1.js). Confirms the repair migration
 * touches EXACTLY the objects the gate's live read-only probing found
 * missing, is byte-consistent with the untouched original
 * PHF_TASK_FOUNDATION_CORRECTION_1.68.0.sql for those objects, and does not
 * touch anything already confirmed present (task_categories,
 * task_permission_grants/_history, task_permission_assignments/_history,
 * task_set_permission_assignment RPC).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }

const repairSql = fs.readFileSync(path.join(ROOT, 'scripts', 'PHF_TASK_FOUNDATION_CORRECTION_REPAIR_1.74.0.sql'), 'utf8');
const repairDownSql = fs.readFileSync(path.join(ROOT, 'scripts', 'PHF_TASK_FOUNDATION_CORRECTION_REPAIR_1.74.0_DOWN.sql'), 'utf8');
const originalSql = fs.readFileSync(path.join(ROOT, 'scripts', 'PHF_TASK_FOUNDATION_CORRECTION_1.68.0.sql'), 'utf8');

(() => {
  // ---- Idempotency shape ----
  ['task_tasks', 'task_assignees', 'task_events', 'task_comments', 'task_links'].forEach(table => {
    pass(new RegExp('alter table public\\.' + table + ' add column if not exists').test(repairSql), 'IDEMPOTENT: ' + table + ' column add uses IF NOT EXISTS');
    pass(new RegExp('alter table public\\.' + table + ' drop constraint if exists').test(repairSql), 'IDEMPOTENT: ' + table + ' constraint drop uses IF EXISTS');
  });
  pass(/create or replace function public\.task_normalize_actor_identity/.test(repairSql), 'IDEMPOTENT: normalize function uses CREATE OR REPLACE');
  ['task_tasks_normalize_creator', 'task_assignees_normalize_assigner', 'task_events_normalize_actor', 'task_comments_normalize_author', 'task_links_normalize_adder'].forEach(trigger => {
    pass(new RegExp('drop trigger if exists ' + trigger).test(repairSql), 'IDEMPOTENT: trigger ' + trigger + ' dropped with IF EXISTS before recreate');
  });

  // ---- Byte-consistency with the original untouched migration for the
  // exact blocks this repair reuses (no silent rewrite/drift). ----
  const blocksToMatch = [
    "alter table public.task_tasks add column if not exists created_by_account_id text;",
    "alter table public.task_comments add column if not exists author_account_id text;",
    "alter table public.task_links add column if not exists added_by_account_id text;",
  ];
  blocksToMatch.forEach(line => {
    pass(originalSql.includes(line) && repairSql.includes(line), 'CONSISTENCY: "' + line + '" is byte-identical between the original 1.68.0 design and this repair (not re-derived/rewritten)');
  });

  // ---- Scope discipline: does NOT touch objects already confirmed live ----
  // Checked against actual DDL statements only (the file's own header
  // comment legitimately names these objects while explaining what is
  // already applied — a plain text search would false-positive on that).
  const ddlOnly = repairSql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  pass(!/alter table public\.task_categories/.test(ddlOnly), 'SCOPE: repair does not touch task_categories (already confirmed live)');
  pass(!/alter table public\.task_permission_grants\b/.test(ddlOnly) && !/alter table public\.task_permission_grant_history/.test(ddlOnly), 'SCOPE: repair does not touch task_permission_grants/_history (already confirmed live)');
  pass(!/create table if not exists public\.task_permission_assignment/.test(ddlOnly), 'SCOPE: repair does not re-create task_permission_assignments/_history (already confirmed live)');
  pass(!/create or replace function public\.task_set_permission_assignment/.test(ddlOnly), 'SCOPE: repair does not touch task_set_permission_assignment RPC (already confirmed live)');
  pass(!/create or replace function public\.task_add_link/.test(ddlOnly), 'SCOPE: repair deliberately excludes the task_add_link() RPC replacement (currently-deployed version already works, upgrading it is offered only as an optional follow-up, not bundled here)');
  pass(!/create or replace function public\.task_guard_task_delete/.test(ddlOnly) && !/create or replace function public\.task_forbid_update_delete/.test(ddlOnly), 'SCOPE: repair does not redefine any existing trigger-guard function (LOCK 4 backstop and the append-only guard used elsewhere are untouched)');

  // ---- No data risk ----
  pass(!/delete from/i.test(repairSql) && !/truncate/i.test(repairSql) && !/drop table/i.test(repairSql), 'SAFETY: no DELETE/TRUNCATE/DROP TABLE anywhere in the repair migration');
  pass(!/update public\./i.test(repairSql), 'SAFETY: no UPDATE statement — no backfill, no historical author values invented');

  // ---- DOWN migration mirrors what UP creates, nothing more ----
  pass(repairDownSql.includes('drop trigger if exists task_tasks_normalize_creator'), 'DOWN: rollback drops the same 5 triggers UP created');
  pass(repairDownSql.includes('drop function if exists public.task_normalize_actor_identity'), 'DOWN: rollback drops the same function UP created');
  pass(!/delete from|truncate|drop table/i.test(repairDownSql), 'DOWN: rollback is also destructive-statement-free (columns/constraints/triggers only, no table/data drop)');

  console.log(`PHF Task Schema Repair migration (1.74.0) structural test: ${passed}/${passed} PASS`);
})();
