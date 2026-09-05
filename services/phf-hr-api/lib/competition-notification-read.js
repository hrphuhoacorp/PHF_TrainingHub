'use strict';

// PHF HR — Chương trình thi đua (Competition) V1 · NOTIFICATION read/mark.
//
// Read-scoped strictly to the calling actor's own identity (recipient_account_id
// OR recipient_employee_code = actor) — the SAME dual-identity WHERE clause
// pattern used everywhere else in this module (competition-submissions.js
// listMySubmissions, competition-review.js anonymousQueue). A Competition
// notification's recipient IS the access-control boundary: nobody but the
// exact recipient (participant on their own submission, or the reviewer who
// held/holds the assignment) is ever a legitimate reader of a given row, so
// no further per-row visibility re-check is needed beyond the recipient match
// itself (unlike PHF Task, where many people can be able to view one task and
// a later permission change can revoke that for someone who already has a
// notification about it).

const { readTx, writeTx, cErr } = require('./competition-common');

function publicNotification(row) {
  return {
    id: row.id,
    eventCode: row.event_code,
    submissionId: row.submission_id,
    title: row.title,
    message: row.message,
    targetPath: row.target_path,
    priority: row.priority,
    createdAt: row.created_at,
    readAt: row.read_at,
    status: row.read_at ? 'read' : 'unread',
  };
}

async function listMyCompetitionNotifications(config, actor, params) {
  const limit = Math.min(50, Math.max(1, Number(params && params.limit) || 30));
  return readTx(config, async (client) => {
    const r = await client.query(
      `SELECT * FROM competition.notifications
        WHERE ( ($1 <> '' AND recipient_account_id = $1) OR ($2 <> '' AND recipient_employee_code = $2) )
        ORDER BY created_at DESC
        LIMIT $3`,
      [actor.accountId || '', actor.employeeCode || '', limit]);
    const notifications = r.rows.map(publicNotification);
    return { notifications, unreadCount: notifications.filter((n) => n.status === 'unread').length };
  });
}

async function markCompetitionNotificationRead(config, actor, params) {
  const ids = (Array.isArray(params && params.ids) ? params.ids : [params && params.id])
    .map((v) => String(v || '').trim()).filter(Boolean);
  if (!ids.length) throw cErr('COMPETITION_NOTIFICATION_ID_REQUIRED', 'Chưa chọn thông báo cần đánh dấu.', 400);
  return writeTx(config, async (client) => {
    const r = await client.query(
      `UPDATE competition.notifications SET read_at = COALESCE(read_at, now())
        WHERE id = ANY($1::uuid[])
          AND ( ($2 <> '' AND recipient_account_id = $2) OR ($3 <> '' AND recipient_employee_code = $3) )
        RETURNING id`,
      [ids, actor.accountId || '', actor.employeeCode || '']);
    return { updated: r.rowCount };
  });
}

async function markAllCompetitionNotificationsRead(config, actor) {
  return writeTx(config, async (client) => {
    const r = await client.query(
      `UPDATE competition.notifications SET read_at = now()
        WHERE read_at IS NULL
          AND ( ($1 <> '' AND recipient_account_id = $1) OR ($2 <> '' AND recipient_employee_code = $2) )
        RETURNING id`,
      [actor.accountId || '', actor.employeeCode || '']);
    return { updated: r.rowCount };
  });
}

module.exports = {
  publicNotification,
  listMyCompetitionNotifications,
  markCompetitionNotificationRead,
  markAllCompetitionNotificationsRead,
};
