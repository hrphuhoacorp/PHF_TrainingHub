'use strict';

/*
 * PHF TASK — IN-APP NOTIFICATION V1 write helper (Company PostgreSQL only).
 *
 * ARCHITECTURE LOCK: Task notifications live ONLY in Company PG
 * (task.notifications). No Supabase, ever. No dual-write. No worker/cron/queue.
 *
 * This module is called by the lifecycle write functions (lib/task-write.js,
 * lib/task-cancel-request.js, lib/task-recurrence.js) INSIDE their existing
 * withTaskWriteTransaction() — it takes the transaction `client`, never opens
 * its own. So the task.events row and its notification rows commit together or
 * not at all.
 *
 * Until migrations/phf_hr_task_notification_v1.sql is applied, hasNotificationV1Schema()
 * is false and emit* is a silent no-op — every pre-existing gate stays green.
 *
 * RECIPIENT RESOLUTION happens in the CALLER (which has the task row + active
 * assignees already loaded in the same transaction, or — for cancel_request
 * reviewers — is passed a list resolved by the main-app authority graph). This
 * module never invents recipients and never reads permission/role data.
 *
 * IDENTITY MODEL: V1 recipients are always identified by employee_code
 * (task.assignees has no account_id; the creator may additionally carry an
 * account id). dedupe_key is the primary idempotency key; the partial unique
 * (event_id, recipient_employee_code) is the structural backstop.
 */

// V1 event codes (whitelist — enforced here AND by the widened DB CHECK).
const V1_EVENT_CODES = Object.freeze(new Set([
  'TASK_PUBLISHED',
  'TASK_ASSIGNED',
  'TASK_TRANSFERRED',
  'TASK_COMMENTED',
  'TASK_DEADLINE_CHANGED',
  'TASK_COMPLETED',
  'TASK_REOPENED',
  'TASK_CANCELLED',
  'TASK_CANCEL_REQUESTED',
  'TASK_CANCEL_REQUEST_DECIDED',
  'TASK_RECURRING_GENERATED',
  // legacy, still valid:
  'TASK_CROSS_DEPARTMENT_ASSIGNED',
]));

const PRIORITIES = new Set(['Trung bình', 'Cao', 'Khẩn']);

let _schema = null;
async function hasNotificationV1Schema(client) {
  if (_schema !== null) return _schema;
  const r = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = 'task' AND table_name = 'notifications' AND column_name = 'event_id'`
  );
  _schema = r.rows[0].n > 0;
  return _schema;
}
// test seam
function _resetSchemaCache() { _schema = null; }

function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
function tnbTrim(v) { return String(v == null ? '' : v).trim(); }

/*
 * dedupeRecipients — collapse a mixed list of { employeeCode?, accountId? } to
 * unique identities, EXCLUDING the actor (never notify someone for their own
 * action). Identity key prefers employee_code (canonical — matches
 * task.assignees + the existing knl/checklist convention: never a display name).
 */
function dedupeRecipients(recipients, actor) {
  const actorEmp = up(actor && (actor.employeeCode || actor.actorEmployeeCode));
  const actorAcc = tnbTrim(actor && (actor.accountId || actor.actorAccountId));
  const seen = new Set();
  const out = [];
  for (const r of recipients || []) {
    const emp = up(r && (r.employeeCode || r.employee_code));
    const acc = tnbTrim(r && (r.accountId || r.account_id));
    if (!emp && !acc) continue;
    if (actorEmp && emp && emp === actorEmp) continue;
    if (actorAcc && acc && acc === actorAcc) continue;
    const key = emp || ('acc:' + acc);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ employeeCode: emp || null, accountId: acc || null, identityKey: key });
  }
  return out;
}

/*
 * emitEventNotifications — INSERT one task.notifications row per resolved
 * recipient, in the caller's transaction. Idempotent (ON CONFLICT DO NOTHING
 * against both dedupe_key and the (event_id, recipient_employee_code) partial
 * unique). A no-op before the V1 schema patch.
 *
 * params:
 *   client        — the in-transaction pg client (REQUIRED)
 *   eventId       — task.events.id this notification is derived from (REQUIRED
 *                   for V1 events; null only for the legacy cross-dept path)
 *   eventCode     — one of V1_EVENT_CODES
 *   taskId        — task.tasks.id
 *   title, message— short, non-sensitive strings (Vietnamese)
 *   targetPath    — deep link, e.g. '/task?task=<id>'  (nullable)
 *   priority      — 'Trung bình' | 'Cao' | 'Khẩn'  (default 'Trung bình')
 *   recipients    — [{ employeeCode?, accountId? }, ...]  (pre-resolved by caller)
 *   actor         — { employeeCode?, accountId? }  — excluded from recipients
 *
 * returns { created: <int>, skipped?: <reason> }
 */
async function emitEventNotifications(params) {
  const { client } = params || {};
  if (!client) throw new Error('emitEventNotifications: client (transaction) required');
  if (!(await hasNotificationV1Schema(client))) return { created: 0, skipped: 'schema' };

  const eventCode = up(params.eventCode);
  if (!V1_EVENT_CODES.has(eventCode)) return { created: 0, skipped: 'event_code' };

  const taskId = tnbTrim(params.taskId) || null;
  const eventId = tnbTrim(params.eventId) || null;
  const title = tnbTrim(params.title);
  const message = tnbTrim(params.message);
  if (!title || !message) return { created: 0, skipped: 'content' };

  const priority = PRIORITIES.has(tnbTrim(params.priority)) ? tnbTrim(params.priority) : 'Trung bình';
  const targetPath = tnbTrim(params.targetPath) || null;

  const recipients = dedupeRecipients(params.recipients, params.actor);
  if (!recipients.length) return { created: 0, skipped: 'recipient' };

  // dedupe_key: for V1 events keyed on the event id (one event -> one row per
  // identity, forever). Legacy cross-dept passes its own dedupeKey.
  const dedupeBase = tnbTrim(params.dedupeKey) || (eventId ? ('evt:' + eventId) : (eventCode + '|' + taskId));

  let created = 0;
  for (const r of recipients) {
    const res = await client.query(
      `INSERT INTO task.notifications
         (recipient_account_id, recipient_employee_code, event_code, event_id, task_id,
          title, message, target_path, priority, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        r.accountId, r.employeeCode, eventCode, eventId, taskId,
        title, message, targetPath, priority,
        dedupeBase + '|' + r.identityKey,
      ]
    );
    created += res.rowCount;
  }
  return { created };
}

/*
 * loadActiveAssignees — one SELECT of the task's ACTIVE assignees, returned as
 * { activePrimary: 'CODE'|null, activeRelated: ['CODE', ...] }. Callers that
 * already have this data in-transaction should pass it instead of re-querying.
 */
async function loadActiveAssignees(client, taskId) {
  const r = await client.query(
    `SELECT employee_code, role FROM task.assignees WHERE task_id = $1 AND is_active = true`,
    [taskId]
  );
  let activePrimary = null;
  const activeRelated = [];
  for (const row of r.rows) {
    if (row.role === 'primary') activePrimary = up(row.employee_code);
    else if (row.role === 'related') activeRelated.push(up(row.employee_code));
  }
  return { activePrimary, activeRelated };
}

// Compact, non-sensitive Vietnamese copy. The task title is included (the
// recipient is a current participant at write time); the READ layer (later
// phase) MUST re-check current Task visibility before exposing this.
function shortTitle(taskTitle) {
  const t = tnbTrim(taskTitle);
  return t.length > 80 ? t.slice(0, 77) + '…' : t;
}
const MESSAGES = {
  TASK_PUBLISHED: (t) => ({ title: 'Công việc mới', message: 'Bạn được giao công việc «' + shortTitle(t) + '».' }),
  TASK_ASSIGNED: (t) => ({ title: 'Được thêm vào công việc', message: 'Bạn được thêm vào công việc «' + shortTitle(t) + '».' }),
  TASK_TRANSFERRED: (t) => ({ title: 'Nhận bàn giao công việc', message: 'Bạn được chuyển làm người phụ trách chính của «' + shortTitle(t) + '».' }),
  TASK_COMMENTED: (t) => ({ title: 'Bình luận mới', message: 'Có bình luận mới trong công việc «' + shortTitle(t) + '».' }),
  TASK_DEADLINE_CHANGED: (t) => ({ title: 'Đổi hạn chót', message: 'Hạn chót của công việc «' + shortTitle(t) + '» đã thay đổi.' }),
  TASK_COMPLETED: (t) => ({ title: 'Công việc đã hoàn thành', message: 'Công việc «' + shortTitle(t) + '» đã được báo hoàn thành.' }),
  TASK_REOPENED: (t) => ({ title: 'Công việc mở lại', message: 'Công việc «' + shortTitle(t) + '» đã được mở lại.' }),
  TASK_CANCELLED: (t) => ({ title: 'Công việc đã hủy', message: 'Công việc «' + shortTitle(t) + '» đã bị hủy.' }),
  TASK_CANCEL_REQUESTED: (t) => ({ title: 'Yêu cầu hủy công việc', message: 'Có yêu cầu hủy công việc «' + shortTitle(t) + '» cần xem xét.' }),
  TASK_CANCEL_REQUEST_DECIDED: (t) => ({ title: 'Kết quả yêu cầu hủy', message: 'Yêu cầu hủy công việc «' + shortTitle(t) + '» đã được xử lý.' }),
  TASK_RECURRING_GENERATED: (t) => ({ title: 'Công việc định kỳ mới', message: 'Một kỳ mới của công việc «' + shortTitle(t) + '» đã được tạo và giao cho bạn.' }),
};
function messageFor(eventCode, taskTitle) {
  const fn = MESSAGES[up(eventCode)];
  return fn ? fn(taskTitle) : { title: 'Thông báo công việc', message: 'Có cập nhật trong một công việc của bạn.' };
}

function targetPathFor(taskId) {
  return taskId ? ('/task?task=' + encodeURIComponent(taskId)) : null;
}

module.exports = {
  V1_EVENT_CODES,
  hasNotificationV1Schema,
  emitEventNotifications,
  loadActiveAssignees,
  dedupeRecipients,
  messageFor,
  targetPathFor,
  _resetSchemaCache,
};
