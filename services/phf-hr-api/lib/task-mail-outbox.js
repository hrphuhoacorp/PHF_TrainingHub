'use strict';

/*
 * PHF TASK — MAIL CONTRACT V1 — outbox read/claim/mark for the Vercel drainer.
 *
 * The drainer (api/_lib/task-mail-drain.js on Vercel) calls these over the
 * service bridge. It has NO direct phf_hr connection, so all outbox state
 * transitions run here as phf_hr_app inside withTaskWriteTransaction().
 *
 * State machine:  pending --claim--> claimed --mark--> sent | skipped | failed
 *                 failed  --claim--> claimed   (bounded retry)
 *                 claimed (stale lease) --claim--> claimed   (re-lease)
 *
 * DUPLICATE-SAFE: claiming sets status='claimed' + claimed_at=now() atomically
 * (UPDATE ... WHERE status IN ('pending','failed') OR stale-lease ... RETURNING).
 * Two concurrent drainers can never both get the same row. mark* only acts on
 * rows still in 'claimed' — a late mark from a crashed drainer that already had
 * its lease stolen is a no-op.
 */

const { withTaskReadTransaction, withTaskWriteTransaction } = require('./db');

class TaskMailOutboxError extends Error {
  constructor(code, message, statusCode) {
    super(message || code);
    this.code = code;
    this.statusCode = statusCode || 400;
  }
}

const MAX_ATTEMPTS = 5;
const STALE_LEASE_MS = 10 * 60 * 1000; // 10 min — a claimed row untouched this long is re-claimable
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function clampLimit(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

async function hasSchema(client) {
  const r = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema='task' AND table_name='mail_outbox'`
  );
  return r.rows[0].n > 0;
}

/*
 * claimOutboxBatch — lease up to `limit` deliverable rows. Returns the full
 * row payload the drainer needs (no task re-read — payload was snapshotted at
 * enqueue). Rows already at attempt_count >= MAX_ATTEMPTS are moved to a
 * terminal 'failed' and NOT returned.
 */
async function claimOutboxBatch(config, { limit } = {}) {
  return withTaskWriteTransaction(config, async (client) => {
    if (!(await hasSchema(client))) return { claimed: [], skipped: 'schema' };
    const n = clampLimit(limit);

    // retire exhausted rows first (terminal failed, keep last_error).
    await client.query(
      `UPDATE task.mail_outbox
          SET status='failed', claimed_at=NULL
        WHERE status IN ('pending','failed','claimed')
          AND attempt_count >= $1
          AND status <> 'failed'`,
      [MAX_ATTEMPTS]
    );

    const staleCutoff = new Date(Date.now() - STALE_LEASE_MS).toISOString();
    const res = await client.query(
      `WITH pick AS (
         SELECT id FROM task.mail_outbox
          WHERE (
                  status IN ('pending','failed')
                  OR (status='claimed' AND claimed_at IS NOT NULL AND claimed_at < $2::timestamptz)
                )
            AND attempt_count < $1
          ORDER BY created_at ASC
          LIMIT $3
          FOR UPDATE SKIP LOCKED
       )
       UPDATE task.mail_outbox o
          SET status='claimed', claimed_at=now(), attempt_count = o.attempt_count + 1
         FROM pick
        WHERE o.id = pick.id
       RETURNING o.id, o.business_event_id, o.event_code, o.task_id,
                 o.recipient_employee_code, o.template_key, o.payload,
                 o.attempt_count, o.dedupe_key, o.created_at`,
      [MAX_ATTEMPTS, staleCutoff, n]
    );
    return { claimed: res.rows };
  });
}

/*
 * markOutbox — terminal transition for one claimed row.
 *   outcome: 'sent' | 'skipped' | 'failed'
 *   reason:  free text (skip reason / provider error) — stored in last_error
 * A row NOT in 'claimed' is left untouched (returns { updated: 0 }).
 */
async function markOutbox(config, { id, outcome, reason } = {}) {
  const oid = String(id || '').trim();
  if (!oid) throw new TaskMailOutboxError('MAIL_OUTBOX_ID_REQUIRED', 'id bắt buộc.', 400);
  if (!['sent', 'skipped', 'failed'].includes(outcome)) {
    throw new TaskMailOutboxError('MAIL_OUTBOX_OUTCOME_INVALID', 'outcome không hợp lệ.', 400);
  }
  return withTaskWriteTransaction(config, async (client) => {
    if (!(await hasSchema(client))) return { updated: 0, skipped: 'schema' };
    const note = reason == null ? null : String(reason).slice(0, 2000);
    const res = await client.query(
      `UPDATE task.mail_outbox
          SET status = $2,
              claimed_at = NULL,
              sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END,
              last_error = CASE WHEN $2 = 'sent' THEN NULL ELSE $3 END
        WHERE id = $1 AND status = 'claimed'
       RETURNING id, status`,
      [oid, outcome, note]
    );
    return { updated: res.rowCount, row: res.rows[0] || null };
  });
}

// batch convenience — one txn, ordered.
async function markOutboxBatch(config, marks) {
  const list = Array.isArray(marks) ? marks : [];
  const out = [];
  for (const m of list) {
    // eslint-disable-next-line no-await-in-loop
    out.push(await markOutbox(config, m));
  }
  return { results: out };
}

/*
 * enqueueWeeklyReportRows — INCREMENT 2. The Vercel weekly-report generator has
 * already rendered ONE report snapshot; this inserts one task.mail_outbox row
 * per enabled recipient, reusing the SAME outbox + drainer + Brevo path as
 * transactional mail (no second delivery architecture).
 *
 * A weekly row differs from a transactional row only in shape:
 *   business_event_id = NULL, event_code = template_key = 'WEEKLY_REPORT',
 *   recipient_employee_code = 'WEEKLY_REPORT' (sentinel — the real address is
 *   payload.to; the drainer's WEEKLY_REPORT branch sends payload.to/subject/html
 *   directly and does NOT touch People Master),
 *   dedupe_key = 'weekly:<periodStartDateKey>:<normalised email>'.
 *
 * Idempotent: ON CONFLICT DO NOTHING against task_mail_outbox_dedupe_uq — one
 * report period + recipient = at most one row, forever. Re-running the
 * generator for the same period is a no-op.
 *
 * params: { periodKey: 'YYYY-MM-DD', periodLabel, subject, html, recipients: [{ email, label? }] }
 * returns { schemaReady, inserted, skippedExisting, total }
 */
async function enqueueWeeklyReportRows(config, params) {
  const p = params || {};
  const periodKey = String(p.periodKey || '').trim();
  const subject = String(p.subject || '').trim();
  const html = String(p.html || '');
  const recipients = Array.isArray(p.recipients) ? p.recipients : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodKey)) throw new TaskMailOutboxError('WEEKLY_PERIOD_KEY_INVALID', 'periodKey không hợp lệ.', 400);
  if (!subject || !html) throw new TaskMailOutboxError('WEEKLY_CONTENT_REQUIRED', 'Thiếu subject/html báo cáo tuần.', 400);

  return withTaskWriteTransaction(config, async (client) => {
    if (!(await hasSchema(client))) return { schemaReady: false, inserted: 0, skippedExisting: 0, total: 0 };
    let inserted = 0;
    let seen = 0;
    const done = new Set();
    for (const rc of recipients) {
      const email = String((rc && rc.email) || '').trim().toLowerCase();
      if (!email || done.has(email)) continue;
      done.add(email);
      seen += 1;
      const dedupeKey = 'weekly:' + periodKey + ':' + email;
      const payload = {
        to: email,
        recipient_label: String((rc && rc.label) || '') || null,
        subject,
        html,
        period_key: periodKey,
        period_label: String(p.periodLabel || '') || null,
      };
      // eslint-disable-next-line no-await-in-loop
      const res = await client.query(
        `INSERT INTO task.mail_outbox
           (business_event_id, event_code, task_id, recipient_employee_code, channel,
            template_key, payload, dedupe_key)
         VALUES (NULL, 'WEEKLY_REPORT', NULL, 'WEEKLY_REPORT', 'email',
                 'WEEKLY_REPORT', $1::jsonb, $2)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [JSON.stringify(payload), dedupeKey]
      );
      inserted += res.rowCount;
    }
    return { schemaReady: true, inserted, skippedExisting: seen - inserted, total: seen };
  });
}

async function outboxStats(config) {
  return withTaskReadTransaction(config, async (client) => {
    if (!(await hasSchema(client))) return { schema: false };
    const r = await client.query(
      `SELECT status, count(*)::int AS n FROM task.mail_outbox GROUP BY status`
    );
    const by = {};
    for (const row of r.rows) by[row.status] = row.n;
    return { schema: true, byStatus: by };
  });
}

module.exports = {
  TaskMailOutboxError,
  MAX_ATTEMPTS,
  claimOutboxBatch,
  markOutbox,
  markOutboxBatch,
  enqueueWeeklyReportRows,
  outboxStats,
};
