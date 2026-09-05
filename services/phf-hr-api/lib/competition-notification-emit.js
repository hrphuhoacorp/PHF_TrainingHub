'use strict';

// PHF HR — Chương trình thi đua (Competition) V1 · NOTIFICATION write helper.
//
// ARCHITECTURE: standalone competition.notifications (Company PostgreSQL,
// phf_hr_e2e in DEV). Mirrors task-notification-emit.js's SHAPE (runs inside
// the caller's own transaction, ON CONFLICT (dedupe_key) DO NOTHING, never
// throws to block the business write) but is its own module/table — NOT a
// reuse of task.notifications (see migration header for why).
//
// Called from competition-submissions.js (reviewAction / adminOverride) and
// competition-review.js (assignForSubmission / ensureHighAssignment /
// manualReassign / returnAssignmentsForRevokedReviewer) — always with the
// SAME `client` already inside their withTaskWriteTransaction() call.
//
// RECIPIENT RESOLUTION is always done by the CALLER from data already in
// scope (submission author columns, assignment reviewer columns, or the
// acting actor) — this module never invents a recipient and never selects
// author-identifying columns for a reviewer-facing notification.

const EVENT_CODES = Object.freeze(new Set([
  'COMPETITION_SUBMISSION_APPROVED',
  'COMPETITION_SUBMISSION_UPGRADED',
  'COMPETITION_SUBMISSION_REVISION_REQUESTED',
  'COMPETITION_SUBMISSION_REJECTED',
  'COMPETITION_SUBMISSION_ADJUSTED',
  'COMPETITION_REVIEW_ASSIGNED',
]));
const PRIORITIES = new Set(['Trung bình', 'Cao', 'Khẩn']);

function trim(v) { return String(v == null ? '' : v).trim(); }

/*
 * emitCompetitionNotifications({ client, eventCode, submissionId, title,
 *   message, targetPath, priority, recipients, actor, dedupeKey })
 *
 * recipients: [{ accountId?, employeeCode? }, ...] — pre-resolved by caller.
 * actor: { accountId?, employeeCode? } — excluded from recipients (never
 *   notify someone for their own action).
 * dedupeKey: REQUIRED base string, business-event-identity keyed by the
 *   caller (e.g. `cmp:<submissionId>:<eventCode>:<toLevel|outcome>`). This
 *   function appends the per-recipient identity so retries of the SAME
 *   action never spam duplicates, while a genuinely new subsequent event
 *   still creates a new row.
 *
 * Never throws — a notification failure must never block the submission /
 * assignment write it is attached to. Returns { created } (0 on any skip).
 */
async function emitCompetitionNotifications(params) {
  const { client } = params || {};
  if (!client) return { created: 0, skipped: 'no_client' };
  try {
    const eventCode = trim(params.eventCode).toUpperCase();
    if (!EVENT_CODES.has(eventCode)) return { created: 0, skipped: 'event_code' };

    const title = trim(params.title);
    const message = trim(params.message);
    if (!title || !message) return { created: 0, skipped: 'content' };

    const priority = PRIORITIES.has(trim(params.priority)) ? trim(params.priority) : 'Trung bình';
    const targetPath = trim(params.targetPath) || null;
    const submissionId = trim(params.submissionId) || null;
    const dedupeBase = trim(params.dedupeKey);
    if (!dedupeBase) return { created: 0, skipped: 'dedupe_key_required' };

    const actorAcc = trim(params.actor && params.actor.accountId);
    const actorEmp = trim(params.actor && params.actor.employeeCode);

    const seen = new Set();
    const recipients = [];
    for (const r of (params.recipients || [])) {
      const acc = trim(r && r.accountId);
      const emp = trim(r && r.employeeCode);
      if (!acc && !emp) continue;
      if (actorAcc && acc && acc === actorAcc) continue;
      if (actorEmp && emp && emp === actorEmp) continue;
      const key = emp || ('acc:' + acc);
      if (seen.has(key)) continue;
      seen.add(key);
      recipients.push({ accountId: acc || null, employeeCode: emp || null, identityKey: key });
    }
    if (!recipients.length) return { created: 0, skipped: 'recipient' };

    let created = 0;
    for (const r of recipients) {
      const res = await client.query(
        `INSERT INTO competition.notifications
           (recipient_account_id, recipient_employee_code, event_code, submission_id,
            title, message, target_path, priority, dedupe_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (dedupe_key) DO NOTHING
         RETURNING id`,
        [r.accountId, r.employeeCode, eventCode, submissionId, title, message, targetPath, priority,
          dedupeBase + '|' + r.identityKey]);
      created += res.rowCount;
    }
    return { created };
  } catch (e) {
    // never let a notification failure block the business write it is attached to
    return { created: 0, skipped: 'error', error: e && e.message };
  }
}

module.exports = { EVENT_CODES, emitCompetitionNotifications };
