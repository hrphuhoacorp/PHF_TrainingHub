'use strict';

/*
 * PHF TASK — MAIL CONTRACT V1 enqueue helper (Company PostgreSQL only).
 *
 * ARCHITECTURE LOCK: mail is a SECONDARY channel. This module INSERTs a
 * task.mail_outbox row inside the CALLER's existing withTaskWriteTransaction()
 * — it takes the transaction `client`, never opens its own. So the business
 * row (task.events etc.) and the outbox row commit together or not at all.
 * A separate Vercel drainer resolves the recipient email (People Master),
 * renders, and sends via Brevo. phf-hr-api NEVER sends mail and never reaches
 * Supabase/Brevo.
 *
 * DOUBLE-GATED no-op — nothing is enqueued unless BOTH are true:
 *   1. the task.mail_outbox table exists (migrations/phf_hr_task_mail_v1.sql
 *      applied) — hasMailV1Schema()
 *   2. PHF_TASK_MAIL_OUTBOX_ENABLED === 'true' in the service env
 * Before either, enqueue* is a silent no-op and every pre-existing gate stays
 * green. An enqueue failure is swallowed and logged (see the caller wrapper)
 * — a mail-outbox problem must NEVER roll back a task write. Because the
 * INSERT is ON CONFLICT DO NOTHING it is retry/replay safe even in-transaction.
 *
 * RECIPIENT + SEND DECISION happen in the CALLER via lib/task-mail-contract.js
 * (pure, unit-tested). This module only persists an already-decided row.
 */

const logger = require('./logger');
const { ALL_TEMPLATE_KEYS } = require('./task-mail-contract');

const TEMPLATE_SET = new Set(ALL_TEMPLATE_KEYS);

let _schema = null;
async function hasMailV1Schema(client) {
  if (_schema !== null) return _schema;
  const r = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'task' AND table_name = 'mail_outbox'`
  );
  _schema = r.rows[0].n > 0;
  return _schema;
}
function _resetSchemaCache() { _schema = null; }

function isMailOutboxEnabled() {
  return String(process.env.PHF_TASK_MAIL_OUTBOX_ENABLED || '').trim().toLowerCase() === 'true';
}

function tnbTrim(v) { return String(v == null ? '' : v).trim(); }
function up(v) { return tnbTrim(v).toUpperCase(); }

/*
 * enqueueMail — INSERT one task.mail_outbox row, in the caller's transaction.
 * Returns { enqueued: 0|1, skipped?: <reason> }. NEVER throws for a business
 * reason — only a genuine SQL error propagates (and the caller wrapper
 * swallows even that). Idempotent: ON CONFLICT DO NOTHING against
 * task_mail_outbox_dedupe_uq AND task_mail_outbox_event_recipient_uq.
 *
 * params:
 *   client                 — the in-transaction pg client (REQUIRED)
 *   businessEventId         — task.events.id the mail derives from (nullable)
 *   eventCode               — short lifecycle code, e.g. 'TASK_COMPLETED'
 *   taskId                  — task.tasks.id (nullable)
 *   templateKey             — one of task-mail-contract TEMPLATE_KEYS
 *   recipientEmployeeCode   — resolved by the caller's contract decision
 *   payload                 — jsonb snapshot the template needs (see below)
 *   dedupeKey               — optional explicit key; otherwise derived
 */
async function enqueueMail(params) {
  const { client } = params || {};
  if (!client) throw new Error('enqueueMail: client (transaction) required');
  if (!isMailOutboxEnabled()) return { enqueued: 0, skipped: 'flag' };
  if (!(await hasMailV1Schema(client))) return { enqueued: 0, skipped: 'schema' };

  const templateKey = tnbTrim(params.templateKey);
  if (!TEMPLATE_SET.has(templateKey)) return { enqueued: 0, skipped: 'template_key' };

  const recipient = up(params.recipientEmployeeCode);
  if (!recipient) return { enqueued: 0, skipped: 'recipient' };

  const eventCode = up(params.eventCode) || 'TASK_EVENT';
  const businessEventId = tnbTrim(params.businessEventId) || null;
  const taskId = tnbTrim(params.taskId) || null;
  const payload = params.payload && typeof params.payload === 'object' ? params.payload : {};

  const dedupeKey = tnbTrim(params.dedupeKey)
    || (businessEventId ? ('evt:' + businessEventId + '|' + recipient)
                        : (templateKey + '|' + (taskId || 'no-task') + '|' + recipient));

  const res = await client.query(
    `INSERT INTO task.mail_outbox
       (business_event_id, event_code, task_id, recipient_employee_code, channel,
        template_key, payload, dedupe_key)
     VALUES ($1, $2, $3, $4, 'email', $5, $6::jsonb, $7)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [businessEventId, eventCode, taskId, recipient, templateKey, JSON.stringify(payload), dedupeKey]
  );
  return { enqueued: res.rowCount };
}

/*
 * safeEnqueueMail — the wrapper every lifecycle caller uses. Swallows ANY
 * error (SQL included) so a mail-outbox problem can never roll back or fail a
 * task write. The business event + outbox row are NOT one atomic unit (unlike
 * the in-app notification): mail is strictly best-effort and a lost enqueue is
 * acceptable, a rolled-back task write is not.
 *
 * IMPORTANT: because we catch here, the enclosing transaction can still be
 * marked aborted by Postgres if the INSERT itself errored mid-statement. To
 * keep that impossible we wrap the INSERT in a SAVEPOINT.
 */
async function safeEnqueueMail(client, params) {
  if (!client) return { enqueued: 0, skipped: 'no_client' };
  try {
    await client.query('SAVEPOINT phf_mail_enqueue');
    const r = await enqueueMail(Object.assign({ client }, params));
    await client.query('RELEASE SAVEPOINT phf_mail_enqueue');
    return r;
  } catch (err) {
    try { await client.query('ROLLBACK TO SAVEPOINT phf_mail_enqueue'); } catch (_e) { /* noop */ }
    try { await client.query('RELEASE SAVEPOINT phf_mail_enqueue'); } catch (_e) { /* noop */ }
    logger.warn('task_mail_enqueue_failed', {
      message: err && err.message,
      eventCode: params && params.eventCode,
      templateKey: params && params.templateKey,
    });
    return { enqueued: 0, skipped: 'error' };
  }
}

module.exports = {
  hasMailV1Schema,
  isMailOutboxEnabled,
  enqueueMail,
  safeEnqueueMail,
  _resetSchemaCache,
};
