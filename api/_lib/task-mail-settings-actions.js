'use strict';

/*
 * PHF Task — MAIL V1 Increment 2 — Admin Mail Settings actions (Vercel).
 *
 * ADMIN-ONLY. Reuses the existing Task admin gate (requireTaskAdmin from
 * task-core.js — the same one that guards category CRUD). Non-admin sessions
 * are rejected before any bridge call, so a non-admin can neither read
 * recipients nor change weekly settings nor preview the report.
 *
 * Persistence is 100% server-side in Company PostgreSQL phf_hr
 * (task.mail_settings / task.mail_recipients) via the mail bridge. No Supabase.
 * No hardcoded emails. This module NEVER sends mail; the preview only renders.
 *
 * Function names == the dispatch action names (api/data.js + server.js), per
 * the parity harness convention.
 */

const { requireTaskAdmin } = require('./task-core');
const {
  bridgeGetMailSettings,
  bridgeSetWeeklyReportEnabled,
  bridgeAddMailRecipient,
  bridgeSetMailRecipientEnabled,
  bridgeRemoveMailRecipient,
} = require('./task-mail-bridge');
const { previewWeeklyReport } = require('./task-weekly-report');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function fail(message, statusCode, code) {
  const e = new Error(message); e.statusCode = statusCode || 400; e.code = code || 'TASK_MAIL_SETTINGS_INVALID';
  return e;
}
function normEmail(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

async function taskMailSettingsGet(session) {
  await requireTaskAdmin(session);
  return bridgeGetMailSettings();
}

async function taskMailSetWeeklyEnabled(session, enabled) {
  const actor = await requireTaskAdmin(session);
  return bridgeSetWeeklyReportEnabled(!!enabled, { employeeCode: actor.employeeCode, accountId: actor.accountId });
}

async function taskMailAddRecipient(session, input) {
  const actor = await requireTaskAdmin(session);
  const email = normEmail(input && input.email);
  if (!EMAIL_RE.test(email)) throw fail('Email không hợp lệ.', 400, 'MAIL_RECIPIENT_EMAIL_INVALID');
  const label = String((input && input.label) || '').trim().slice(0, 200) || undefined;
  return bridgeAddMailRecipient(email, label, { employeeCode: actor.employeeCode, accountId: actor.accountId });
}

async function taskMailSetRecipientEnabled(session, input) {
  await requireTaskAdmin(session);
  const id = String((input && input.id) || '').trim();
  if (!id) throw fail('Thiếu id người nhận.', 400, 'MAIL_RECIPIENT_ID_REQUIRED');
  return bridgeSetMailRecipientEnabled(id, !!(input && input.enabled));
}

async function taskMailRemoveRecipient(session, input) {
  await requireTaskAdmin(session);
  const id = String((input && input.id) || '').trim();
  if (!id) throw fail('Thiếu id người nhận.', 400, 'MAIL_RECIPIENT_ID_REQUIRED');
  return bridgeRemoveMailRecipient(id);
}

// Admin-only. Renders the weekly report HTML from LIVE canonical data.
// NEVER enqueues, NEVER sends.
async function taskMailWeeklyPreview(session) {
  await requireTaskAdmin(session);
  return previewWeeklyReport({});
}

module.exports = {
  taskMailSettingsGet,
  taskMailSetWeeklyEnabled,
  taskMailAddRecipient,
  taskMailSetRecipientEnabled,
  taskMailRemoveRecipient,
  taskMailWeeklyPreview,
};
