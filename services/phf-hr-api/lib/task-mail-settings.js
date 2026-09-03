'use strict';

/*
 * PHF TASK — MAIL V1 Increment 2 — mail settings + weekly-report recipients.
 *
 * Canonical store: task.mail_settings (singleton id=1) + task.mail_recipients
 * (migrations/phf_hr_task_mail_settings_v1.sql). Reached only via the service
 * bridge (Vercel Admin UI -> phf-hr-api). No names/emails are hardcoded — the
 * recipient list is 100% admin-managed.
 *
 * This module touches NOTHING transactional (no outbox, no lifecycle).
 */

const { withTaskReadTransaction, withTaskWriteTransaction } = require('./db');

class TaskMailSettingsError extends Error {
  constructor(code, message, statusCode) {
    super(message || code);
    this.code = code;
    this.statusCode = statusCode || 400;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normEmail(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
function normLabel(v) { const s = String(v == null ? '' : v).trim(); return s ? s.slice(0, 200) : null; }

async function hasSchema(client) {
  const r = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema='task' AND table_name='mail_settings'`
  );
  return r.rows[0].n > 0;
}
function requireSchema(has) {
  if (!has) throw new TaskMailSettingsError('MAIL_SETTINGS_SCHEMA_MISSING', 'Chưa áp dụng migration cấu hình email (phf_hr_task_mail_settings_v1.sql).', 503);
}

async function getMailSettings(config) {
  return withTaskReadTransaction(config, async (client) => {
    if (!(await hasSchema(client))) {
      return { schemaReady: false, weeklyReportEnabled: false, recipients: [] };
    }
    const s = await client.query(`SELECT weekly_report_enabled, updated_at FROM task.mail_settings WHERE id = 1`);
    const r = await client.query(
      `SELECT id, email, label, is_enabled, created_at FROM task.mail_recipients ORDER BY created_at ASC, email ASC`
    );
    return {
      schemaReady: true,
      weeklyReportEnabled: !!(s.rows[0] && s.rows[0].weekly_report_enabled),
      updatedAt: s.rows[0] ? s.rows[0].updated_at : null,
      recipients: r.rows.map((row) => ({
        id: row.id, email: row.email, label: row.label || '',
        isEnabled: !!row.is_enabled, createdAt: row.created_at,
      })),
    };
  });
}

async function setWeeklyReportEnabled(config, { enabled, actorEmployeeCode, actorAccountId }) {
  return withTaskWriteTransaction(config, async (client) => {
    requireSchema(await hasSchema(client));
    await client.query(
      `UPDATE task.mail_settings
          SET weekly_report_enabled = $1, updated_at = now(),
              updated_by_employee_code = $2, updated_by_account_id = $3
        WHERE id = 1`,
      [!!enabled, actorEmployeeCode || null, actorAccountId || null]
    );
    return { weeklyReportEnabled: !!enabled };
  });
}

async function addRecipient(config, { email, label, actorEmployeeCode, actorAccountId }) {
  const e = normEmail(email);
  if (!EMAIL_RE.test(e)) throw new TaskMailSettingsError('MAIL_RECIPIENT_EMAIL_INVALID', 'Email không hợp lệ.', 400);
  return withTaskWriteTransaction(config, async (client) => {
    requireSchema(await hasSchema(client));
    const res = await client.query(
      `INSERT INTO task.mail_recipients (email, label, created_by_employee_code, created_by_account_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
         SET label = COALESCE(EXCLUDED.label, task.mail_recipients.label),
             is_enabled = true, updated_at = now()
       RETURNING id, email, label, is_enabled`,
      [e, normLabel(label), actorEmployeeCode || null, actorAccountId || null]
    );
    const row = res.rows[0];
    return { recipient: { id: row.id, email: row.email, label: row.label || '', isEnabled: !!row.is_enabled } };
  });
}

async function setRecipientEnabled(config, { id, enabled }) {
  const rid = String(id || '').trim();
  if (!rid) throw new TaskMailSettingsError('MAIL_RECIPIENT_ID_REQUIRED', 'Thiếu id người nhận.', 400);
  return withTaskWriteTransaction(config, async (client) => {
    requireSchema(await hasSchema(client));
    const res = await client.query(
      `UPDATE task.mail_recipients SET is_enabled = $2, updated_at = now() WHERE id = $1
       RETURNING id, email, is_enabled`,
      [rid, !!enabled]
    );
    if (res.rowCount === 0) throw new TaskMailSettingsError('MAIL_RECIPIENT_NOT_FOUND', 'Không tìm thấy người nhận.', 404);
    const row = res.rows[0];
    return { recipient: { id: row.id, email: row.email, isEnabled: !!row.is_enabled } };
  });
}

// Hard delete — matches the existing task.categories "Xóa" convention for an
// unused config row. A normal toggle uses setRecipientEnabled (soft).
async function removeRecipient(config, { id }) {
  const rid = String(id || '').trim();
  if (!rid) throw new TaskMailSettingsError('MAIL_RECIPIENT_ID_REQUIRED', 'Thiếu id người nhận.', 400);
  return withTaskWriteTransaction(config, async (client) => {
    requireSchema(await hasSchema(client));
    const res = await client.query(`DELETE FROM task.mail_recipients WHERE id = $1 RETURNING id, email`, [rid]);
    if (res.rowCount === 0) throw new TaskMailSettingsError('MAIL_RECIPIENT_NOT_FOUND', 'Không tìm thấy người nhận.', 404);
    return { removed: res.rows[0] };
  });
}

// enabled recipients only — used by the weekly report generator (Vercel).
async function listActiveRecipients(config) {
  return withTaskReadTransaction(config, async (client) => {
    if (!(await hasSchema(client))) return { schemaReady: false, weeklyReportEnabled: false, recipients: [] };
    const s = await client.query(`SELECT weekly_report_enabled FROM task.mail_settings WHERE id = 1`);
    const r = await client.query(
      `SELECT email, label FROM task.mail_recipients WHERE is_enabled = true ORDER BY email ASC`
    );
    return {
      schemaReady: true,
      weeklyReportEnabled: !!(s.rows[0] && s.rows[0].weekly_report_enabled),
      recipients: r.rows.map((x) => ({ email: x.email, label: x.label || '' })),
    };
  });
}

module.exports = {
  TaskMailSettingsError,
  getMailSettings,
  setWeeklyReportEnabled,
  addRecipient,
  setRecipientEnabled,
  removeRecipient,
  listActiveRecipients,
};
