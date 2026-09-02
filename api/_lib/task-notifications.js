'use strict';

/*
 * PHF TASK — IN-APP NOTIFICATION V1 read/mark (main-app layer).
 *
 * ARCHITECTURE LOCK: canonical datastore = Company PostgreSQL `task.notifications`
 * via phf-hr-api. NO Supabase — no read, no write, no dual-anything, no silent
 * fallback. If the Company-PG notification service is unavailable this module
 * returns a truthful error state.
 *
 * This file replaces the retired Supabase path (which used
 * `supabase.from('task_notifications')` + `.upsert(onConflict:'dedupe_key')`).
 * The write path is now transactional inside phf-hr-api
 * (services/phf-hr-api/lib/task-notification-emit.js, proven by
 * scripts/task-notification-v1-e2e-dev.js 31/31) — this module is read/mark only.
 *
 * SECURITY: the recipient is ALWAYS the current session's own identity —
 * resolved by actor() into { employeeCode, accountId } straight from the
 * authenticated session. The client cannot request or mark another user's rows;
 * this module never forwards a client-supplied identity and the phf-hr-api
 * routes are scoped to that same dual identity.
 *
 * DUAL IDENTITY (handover §10): canonical Task identity deliberately supports an
 * account-only Admin (session.role='admin', account.id set, employeeCode='').
 *   A. employeeCode present  -> scope by employee code (+ account id if also set)
 *   B. only accountId present -> scope by account id
 *   C. neither                -> TASK_NOTIFICATION_IDENTITY_NOT_LINKED (409)
 *   D. valid identity, 0 rows -> 200 { notifications: [], unreadCount: 0 }
 * Admin is NEVER required to have an employee code.
 *
 * PRIVACY: a user may have legitimately received a notification and LATER lost
 * permission to view that Task. At read time we (a) confirm the session is the
 * recipient and (b) re-check CURRENT Task visibility; a notification whose Task
 * is no longer viewable is OMITTED from the list entirely (V1 preferred).
 * Historical title/message is never shown to someone who can no longer view it.
 *
 * PERFORMANCE (Phase 3C): the CURRENT-visibility re-check is fed by a batch
 * relation projection returned by the notification-read bridge (creator id +
 * active-assignee summary, two `task_id = ANY(...)` queries) — NOT one full
 * Task Detail read per notification. canViewTask() stays the single source of
 * the visibility decision; only its input changed.
 */

const { canViewTask } = require('./task-permissions');
const {
  isNotificationBridgeEnabled,
  bridgeListTaskNotifications,
  bridgeMarkTaskNotificationsRead,
  bridgeMarkAllTaskNotificationsRead,
} = require('./task-read-bridge');

function text(value) { return String(value == null ? '' : value).trim(); }
function code(value) { return text(value).toUpperCase(); }
function fail(message, statusCode = 400, errorCode = 'TASK_NOTIFICATION_INVALID') {
  const error = new Error(message); error.statusCode = statusCode; error.code = errorCode; throw error;
}

function actor(session) {
  return {
    id: text(session && (session.account && session.account.id || session.sub)) || null,
    employeeCode: code(session && (session.employeeCode || session.employee_code
      || (session.account && (session.account.employeeCode || session.account.employee_code)))),
  };
}

// Resolve the session into the dual-identity scope forwarded to the bridge.
// Throws TASK_NOTIFICATION_IDENTITY_NOT_LINKED only when NEITHER a real employee
// code NOR a valid authenticated account id is present (handover §10 case C).
function resolveNotificationIdentity(session) {
  const a = actor(session);
  const identity = { employeeCode: a.employeeCode || '', accountId: a.id || '' };
  if (!identity.employeeCode && !identity.accountId) {
    fail('Tài khoản chưa liên kết danh tính PHF Task.', 409, 'TASK_NOTIFICATION_IDENTITY_NOT_LINKED');
  }
  return identity;
}

function ensureAvailable() {
  if (!isNotificationBridgeEnabled()) {
    fail('Thông báo PHF Task chưa sẵn sàng (dịch vụ Company PostgreSQL chưa bật).', 503, 'TASK_NOTIFICATION_UNAVAILABLE');
  }
}

// Safe DTO — every row returned is already confirmed VIEWABLE, so task fields
// are always present. NEVER exposes event_id / dedupe_key / recipient_* /
// intervention basis / any internal technical field.
function publicNotification(row) {
  return {
    id: row.id,
    eventCode: row.event_code || '',
    taskId: row.task_id || '',
    title: row.title || '',
    message: row.message || '',
    targetPath: row.target_path || '',
    createdAt: row.created_at || '',
    readAt: row.read_at || '',
    status: row.read_at ? 'read' : 'unread',
  };
}

/*
 * listMyTaskNotifications — newest-first, capped. Filters out any notification
 * whose Task the CURRENT session can no longer view. unreadCount is computed
 * from the FILTERED (visible) set — the badge reflects what the user can act on.
 */
async function listMyTaskNotifications(session, options) {
  ensureAvailable();
  const identity = resolveNotificationIdentity(session);
  const limit = Math.min(50, Math.max(1, Number(options && options.limit) || 30));

  const { notifications: rawRows, taskRelations } = await bridgeListTaskNotifications(identity, limit);

  // Lightweight relation projection from the notification-read bridge — the
  // MINIMUM canViewTask() needs (creator identity + active-assignee summary),
  // one batch query per side, NOT a full Task Detail call per notification.
  const relByTask = new Map();
  for (const rel of (taskRelations || [])) {
    if (!rel || !rel.task_id) continue;
    relByTask.set(String(rel.task_id), {
      relationTask: {
        createdByAccountId: text(rel.created_by_account_id),
        createdByEmployeeCode: code(rel.created_by_employee_code),
      },
      assignees: (rel.assignees || []).map((r) => ({
        employeeCode: code(r.employee_code), role: text(r.role),
        isActive: r.is_active === true,
      })),
    });
  }

  // Current Task visibility re-check, deduped per task_id. FAIL-CLOSED: a task
  // with no relation row (deleted / not projected) is omitted, exactly as the
  // old bridgeGetTaskDetail 404/error path did.
  const visibleByTask = new Map();
  async function taskVisible(taskId) {
    if (!taskId) return false;
    const key = String(taskId);
    if (visibleByTask.has(key)) return visibleByTask.get(key);
    let ok = false;
    try {
      const rel = relByTask.get(key);
      if (rel) ok = await canViewTask(session, rel.relationTask, rel.assignees);
    } catch (_e) {
      ok = false; // fail-closed: any error deciding visibility -> omit the notification
    }
    visibleByTask.set(key, ok);
    return ok;
  }

  const out = [];
  for (const row of rawRows) {
    if (!(await taskVisible(row.task_id))) continue; // privacy: omit entirely
    out.push(publicNotification(row));
  }
  return { notifications: out, unreadCount: out.filter((n) => n.status === 'unread').length };
}

async function markTaskNotificationRead(session, input) {
  ensureAvailable();
  const identity = resolveNotificationIdentity(session);
  const ids = (Array.isArray(input && input.ids) ? input.ids : [input && input.id]).map(text).filter(Boolean);
  if (!ids.length) fail('Chưa chọn thông báo cần đánh dấu.', 400, 'TASK_NOTIFICATION_ID_REQUIRED');
  // scoped to the session identity inside phf-hr-api -> cannot mark another user's row
  return bridgeMarkTaskNotificationsRead(identity, ids);
}

async function markAllTaskNotificationsRead(session) {
  ensureAvailable();
  const identity = resolveNotificationIdentity(session);
  return bridgeMarkAllTaskNotificationsRead(identity);
}

/*
 * emitTaskNotification / emitTaskNotificationSafe — RETIRED Supabase writers.
 * The write path is now transactional inside phf-hr-api. The legacy Supabase
 * publish path (api/_lib/task-core.js::publishTask, only reachable with
 * PHF_TASK_SERVER_WRITE_ENABLED OFF) called emitTaskNotificationSafe for the
 * cross-department case; it now becomes a no-op (that path is transitional and
 * PROD publishes via publishTaskViaServer -> bridgeEmitTaskNotification -> PG).
 * Kept as exported no-ops so nothing crashes; they NEVER touch Supabase.
 */
async function emitTaskNotification() { return { created: 0, skipped: 'supabase_path_retired' }; }
async function emitTaskNotificationSafe() { return { created: 0, skipped: 'supabase_path_retired' }; }

module.exports = {
  listMyTaskNotifications,
  markTaskNotificationRead,
  markAllTaskNotificationsRead,
  isNotificationBridgeEnabled,
  emitTaskNotification,
  emitTaskNotificationSafe,
  // exported for tests
  publicNotification,
};
