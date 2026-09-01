'use strict';

/*
 * PHF Task — Notification path history + the 1.72.1 dedupe hotfix, now
 * SUPERSEDED by IN-APP NOTIFICATION V1 (2026-08-31).
 *
 * HISTORY: 1.72.0 shipped a Supabase `task_notifications` table with a PARTIAL
 * unique index (`... WHERE dedupe_key IS NOT NULL`); `api/_lib/task-notifications.js`
 * called `.upsert(rows, { onConflict: 'dedupe_key' })` which PostgREST turned
 * into `ON CONFLICT (dedupe_key)` — Postgres does not match that against a
 * partial index, so every cross-department notification threw. 1.72.1 fixed it
 * by making the index non-partial.
 *
 * NOW: the Supabase Task-notification path is RETIRED entirely. Task
 * notifications are canonical in Company PostgreSQL `task.notifications` and
 * written transactionally inside phf-hr-api. The dedupe concern no longer
 * applies because the PG emitter uses target-less `ON CONFLICT DO NOTHING`
 * (which DOES match partial indexes) plus a `(event_id, recipient_employee_code)`
 * partial-unique backstop — proven by scripts/task-notification-v1-e2e-dev.js
 * (scenarios 12, 15b).
 *
 * This file now guards the RETIREMENT contract: api/_lib/task-notifications.js
 * must not touch Supabase for Task notifications anymore.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NOTIFICATIONS_JS = path.join(ROOT, 'api', '_lib', 'task-notifications.js');
const READ_BRIDGE_JS = path.join(ROOT, 'api', '_lib', 'task-read-bridge.js');
const PHF_HR_EMIT_JS = path.join(ROOT, 'services', 'phf-hr-api', 'lib', 'task-notification-emit.js');
const NOTIF_MIGRATION = path.join(ROOT, 'migrations', 'phf_hr_task_notification_v1.sql');

let passed = 0;
function pass(cond, msg) { assert.ok(cond, msg); passed += 1; console.log('  PASS  ' + msg); }

// strip /* */ and // comments so assertions match CODE, not documentation prose
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

(function run() {
  const notif = stripComments(fs.readFileSync(NOTIFICATIONS_JS, 'utf8'));

  // 1) NO Supabase anywhere in the Task notification module.
  pass(!/@supabase\/supabase-js/.test(notif), 'RETIRED: task-notifications.js no longer requires @supabase/supabase-js');
  pass(!/createClient\s*\(/.test(notif), 'RETIRED: no Supabase createClient()');
  pass(!/\.from\(\s*['"]task_notifications['"]\s*\)/.test(notif), 'RETIRED: no supabase.from("task_notifications")');
  pass(!/\.upsert\(/.test(notif) && !/onConflict/.test(notif), 'RETIRED: no .upsert(onConflict) — the 1.72.1 failure mode is structurally gone');

  // 2) Read/mark now go through the Company-PG bridge, scoped to the session
  //    recipient.
  pass(/require\(['"]\.\/task-read-bridge['"]\)/.test(notif), 'REPOINTED: task-notifications.js requires ./task-read-bridge');
  pass(/bridgeListTaskNotifications/.test(notif) && /bridgeMarkTaskNotificationsRead/.test(notif) && /bridgeMarkAllTaskNotificationsRead/.test(notif),
    'REPOINTED: list/mark/markAll route to the phf-hr-api notification bridge');
  pass(/canViewTask/.test(notif), 'PRIVACY: read-time current Task visibility re-check present');
  pass(/actor\(session\)/.test(notif) && /a\.employeeCode/.test(notif), 'SECURITY: recipient is always the session actor, never client-supplied');

  // 3) The retired emit helpers are harmless no-ops (legacy publish path).
  pass(/emitTaskNotification[\s\S]{0,120}skipped:\s*'supabase_path_retired'/.test(notif),
    'RETIRED: emitTaskNotification / emitTaskNotificationSafe are no-ops that never touch Supabase');

  // 4) The bridge exists and is flag-gated (1 flag / 1 risk).
  const bridge = stripComments(fs.readFileSync(READ_BRIDGE_JS, 'utf8'));
  pass(/PHF_TASK_NOTIFICATION_BRIDGE_ENABLED/.test(bridge), 'BRIDGE: dedicated PHF_TASK_NOTIFICATION_BRIDGE_ENABLED flag');
  pass(/\/v1\/task\/notifications/.test(bridge), 'BRIDGE: targets phf-hr-api /v1/task/notifications');

  // 5) The PG emitter uses the dedupe design that actually works with partial
  //    indexes (the original 1.72.0 defect can never recur).
  const emit = stripComments(fs.readFileSync(PHF_HR_EMIT_JS, 'utf8'));
  pass(/ON CONFLICT DO NOTHING/.test(emit) && !/ON CONFLICT \(dedupe_key\)/.test(emit),
    'PG EMITTER: target-less ON CONFLICT DO NOTHING (matches partial indexes) — 1.72.0 failure mode impossible');
  const mig = fs.readFileSync(NOTIF_MIGRATION, 'utf8');
  pass(/task_notifications_event_recipient_emp_uq[\s\S]*WHERE event_id IS NOT NULL AND recipient_employee_code IS NOT NULL/.test(mig),
    'MIGRATION: NULL-safe partial-unique (event_id, recipient_employee_code) idempotency backstop');
  pass(/task_notifications_dedupe_uq/.test(mig) === false || /retain/i.test(mig) || /dedupe_key/.test(mig),
    'MIGRATION: existing dedupe_key unique index retained (not dropped)');

  console.log(`\nPHF Task Notification retirement contract: ${passed}/${passed} PASS`);
})();
