'use strict';

/*
 * PHF TASK — IN-APP NOTIFICATION V1 read/mark API (Company PostgreSQL only).
 *
 * task.notifications is canonical (Phase 2). NO Supabase.
 *
 * Every entry point is SCOPED to a single recipient_employee_code — resolved by
 * the MAIN APP from the authenticated session and passed in. This layer never
 * accepts a "list anyone's" call and never re-derives identity. A user can
 * therefore never read or mark another employee's notification.
 *
 * This layer returns RAW rows (list) / counts (mark). The safe DTO projection
 * AND the current-Task-visibility privacy filter are the main app's job
 * (api/_lib/task-notifications.js) because they need the permission engine.
 *
 * Until migrations/phf_hr_task_notification_v1.sql is applied, hasSchema() is
 * false and every call throws TASK_NOTIFICATION_SCHEMA_MISSING (503) — a
 * truthful unavailable state, never a Supabase fallback.
 */

const { withTaskReadTransaction, withTaskWriteTransaction } = require('./db');

const QUERY_TIMEOUT_MS = 8000;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
const MAX_MARK_IDS = 200;

class TaskNotificationError extends Error {
  constructor(message, statusCode, code) { super(message); this.statusCode = statusCode; this.code = code; }
}

function mapPgError(error) {
  if (!error) return null;
  const code = String((error && error.code) || '');
  if (code === '42P01' || code === '42703') {
    return new TaskNotificationError('Schema Thông báo PHF Task chưa được cài đặt trên PostgreSQL.', 503, 'TASK_NOTIFICATION_SCHEMA_MISSING');
  }
  if (code === '42501') return new TaskNotificationError('Thiếu quyền truy cập Thông báo trên PostgreSQL.', 500, 'TASK_NOTIFICATION_PERMISSION_DENIED');
  if (code === '57014') return new TaskNotificationError('Truy vấn Thông báo quá thời gian chờ.', 504, 'TASK_NOTIFICATION_TIMEOUT');
  return new TaskNotificationError('Lỗi đọc dữ liệu Thông báo PHF Task.', 500, 'TASK_NOTIFICATION_READ_ERROR');
}

function normEmp(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
// account id is an opaque UUID — trim only, NEVER uppercase (employee-code and
// account-id normalisation stay separate, see handover §11).
function normAcct(v) { return String(v == null ? '' : v).trim(); }

// DUAL IDENTITY (handover §10). The MAIN APP resolves the authenticated session
// into { recipientEmployeeCode, recipientAccountId } (either may be empty) and
// passes BOTH through. A row is in scope if it matches the non-empty employee
// code OR the non-empty account id — so an account-only Admin (employeeCode='')
// is scoped purely by recipient_account_id, a normal employee purely by
// recipient_employee_code, and a session carrying both sees either. At least
// one identity must be present or the call is rejected (never a full scan).
function resolveRecipientIdentity(params) {
  const employeeCode = normEmp(params && params.recipientEmployeeCode);
  const accountId = normAcct(params && params.recipientAccountId);
  if (!employeeCode && !accountId) {
    throw new TaskNotificationError('recipientEmployeeCode hoặc recipientAccountId là bắt buộc.', 400, 'TASK_NOTIFICATION_RECIPIENT_REQUIRED');
  }
  return { employeeCode, accountId };
}

// Shared dual-identity predicate. $1 = employeeCode ('' when absent),
// $2 = accountId ('' when absent). A row matching both identities matches once.
const IDENTITY_WHERE =
  `( ($1::text <> '' AND recipient_employee_code = $1)
     OR ($2::text <> '' AND recipient_account_id = $2) )`;

let _schema = null;
async function hasSchema(client) {
  if (_schema !== null) return _schema;
  const r = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema='task' AND table_name='notifications' AND column_name='event_id'`
  );
  _schema = r.rows[0].n > 0;
  return _schema;
}
function _resetSchemaCache() { _schema = null; }

// GET /v1/task/notifications?recipientEmployeeCode=&limit=
// -> { data: [ <raw row> ], count, taskRelations: [ <lightweight relation> ] }
//
// taskRelations is the MINIMUM the main app's canViewTask() needs to re-check
// current Task visibility for each notification — creator identity + the active
// assignee summary — fetched in TWO batch queries (task_id = ANY(...)) in the
// same read transaction. This replaces the previous per-notification full Task
// Detail bridge call (N+1: ~30 heavy reads per list). NO comments / events /
// links / attachments / proposal reads. Privacy logic is unchanged and still
// lives in canViewTask(); this only changes how it is fed.
async function listNotificationsForRecipient(config, params) {
  const { employeeCode, accountId } = resolveRecipientIdentity(params);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params && params.limit) || DEFAULT_LIMIT));

  let result;
  try {
    result = await withTaskReadTransaction(config, async (client) => {
      if (!(await hasSchema(client))) throw new TaskNotificationError('', 503, 'TASK_NOTIFICATION_SCHEMA_MISSING');
      const r = await client.query(
        `SELECT id, event_code, task_id, title, message, target_path, priority, created_at, read_at
           FROM task.notifications
          WHERE ${IDENTITY_WHERE}
          ORDER BY created_at DESC, id DESC
          LIMIT $3`,
        [employeeCode, accountId, limit]
      );
      const rows = r.rows;

      const taskIds = [...new Set(rows.map((n) => n.task_id).filter(Boolean))];
      let taskRelations = [];
      if (taskIds.length) {
        const [tasksRes, assigneesRes] = await Promise.all([
          client.query(
            `SELECT id, created_by_account_id, created_by_employee_code
               FROM task.tasks WHERE id = ANY($1::uuid[])`,
            [taskIds]
          ),
          client.query(
            `SELECT task_id, employee_code, role, is_active
               FROM task.assignees WHERE task_id = ANY($1::uuid[])`,
            [taskIds]
          ),
        ]);
        const assigneesByTask = new Map();
        for (const a of assigneesRes.rows) {
          if (!assigneesByTask.has(a.task_id)) assigneesByTask.set(a.task_id, []);
          assigneesByTask.get(a.task_id).push({ employee_code: a.employee_code, role: a.role, is_active: a.is_active });
        }
        taskRelations = tasksRes.rows.map((t) => ({
          task_id: t.id,
          created_by_account_id: t.created_by_account_id,
          created_by_employee_code: t.created_by_employee_code,
          assignees: assigneesByTask.get(t.id) || [],
        }));
      }
      return { rows, taskRelations };
    }, { timeoutMs: QUERY_TIMEOUT_MS });
  } catch (err) {
    if (err instanceof TaskNotificationError) throw err;
    throw mapPgError(err) || err;
  }
  return { data: result.rows, count: result.rows.length, taskRelations: result.taskRelations };
}

// POST /v1/task/notifications:markRead  { recipientEmployeeCode, ids: [] }
// -> { marked: <int> }   (only rows owned by that recipient AND still unread)
async function markNotificationsRead(config, params) {
  const { employeeCode, accountId } = resolveRecipientIdentity(params);
  const ids = [...new Set((Array.isArray(params && params.ids) ? params.ids : [])
    .map((x) => String(x || '').trim()).filter(Boolean))].slice(0, MAX_MARK_IDS);
  if (!ids.length) throw new TaskNotificationError('Chưa chọn thông báo cần đánh dấu.', 400, 'TASK_NOTIFICATION_ID_REQUIRED');

  try {
    return await withTaskWriteTransaction(config, async (client) => {
      if (!(await hasSchema(client))) throw new TaskNotificationError('', 503, 'TASK_NOTIFICATION_SCHEMA_MISSING');
      const r = await client.query(
        `UPDATE task.notifications
            SET read_at = now()
          WHERE id = ANY($3::uuid[])
            AND ${IDENTITY_WHERE}
            AND read_at IS NULL`,
        [employeeCode, accountId, ids]
      );
      return { marked: r.rowCount };
    });
  } catch (err) {
    if (err instanceof TaskNotificationError) throw err;
    throw mapPgError(err) || err;
  }
}

// POST /v1/task/notifications:markAllRead  { recipientEmployeeCode }
// -> { marked: <int> }
async function markAllNotificationsRead(config, params) {
  const { employeeCode, accountId } = resolveRecipientIdentity(params);
  try {
    return await withTaskWriteTransaction(config, async (client) => {
      if (!(await hasSchema(client))) throw new TaskNotificationError('', 503, 'TASK_NOTIFICATION_SCHEMA_MISSING');
      const r = await client.query(
        `UPDATE task.notifications SET read_at = now()
          WHERE ${IDENTITY_WHERE} AND read_at IS NULL`,
        [employeeCode, accountId]
      );
      return { marked: r.rowCount };
    });
  } catch (err) {
    if (err instanceof TaskNotificationError) throw err;
    throw mapPgError(err) || err;
  }
}

module.exports = {
  listNotificationsForRecipient,
  markNotificationsRead,
  markAllNotificationsRead,
  TaskNotificationError,
  _resetSchemaCache,
};
