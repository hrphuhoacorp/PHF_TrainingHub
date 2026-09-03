'use strict';

/*
 * PHF TASK — MAIL CONTRACT V1 — pure decision layer (no I/O, no DB).
 *
 * ONE job: given a lifecycle event + its already-loaded context, decide
 *   { send: boolean, templateKey, recipientEmployeeCode, reason }
 * according to the LOCKED Mail Contract V1 business rules. Every caller in
 * services/phf-hr-api/lib/task-write.js / task-recurrence.js runs its decision
 * through here so the rules live in exactly one place and are unit-tested
 * (scripts/test-task-mail-contract-v1.js) with zero infrastructure.
 *
 * NOT decided here: whether the recipient has a valid email / is active (that
 * is the Vercel drainer's job — a missing email is logged as skipped, never a
 * business failure), and whether the outbox schema/flag is on (task-mail-emit).
 *
 * Contract summary (see the task brief for the authoritative text):
 *   1  NEW TASK              -> primary assignee, unless assigner == primary
 *   2  NEW PROPOSAL          -> proposal recipient, unless creator == recipient
 *   3  PROPOSAL ACCEPTED     -> new task's primary (treated as NEW TASK)
 *   4  DEADLINE earlier      -> primary; later / start-only -> NO
 *   5  TRANSFER primary      -> NEW primary only, ALWAYS (no self suppression)
 *   10 COMPLETED on time     -> assigner
 *   11 COMPLETED late        -> assigner, distinct "Hoàn thành trễ" template
 *   14 DIRECT CANCEL         -> primary assignee
 *   15 REOPEN / RESTORE      -> primary assignee
 *   18 MONTHLY recurrence    -> generated occurrence's primary, unless self
 *   everything else          -> NO MAIL
 */

const TEMPLATE_KEYS = Object.freeze({
  TASK_NEW: 'TASK_NEW',
  PROPOSAL_NEW: 'PROPOSAL_NEW',
  TASK_DEADLINE_EARLIER: 'TASK_DEADLINE_EARLIER',
  TASK_TRANSFERRED: 'TASK_TRANSFERRED',
  TASK_COMPLETED: 'TASK_COMPLETED',
  TASK_COMPLETED_LATE: 'TASK_COMPLETED_LATE',
  TASK_CANCELLED: 'TASK_CANCELLED',
  TASK_REOPENED: 'TASK_REOPENED',
});
const ALL_TEMPLATE_KEYS = Object.freeze(Object.values(TEMPLATE_KEYS));

function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
function no(reason) { return { send: false, reason: reason }; }
function yes(templateKey, recipientEmployeeCode) {
  return { send: true, templateKey: templateKey, recipientEmployeeCode: up(recipientEmployeeCode) };
}

/*
 * sameIdentity — the "self-assignment exception". Two identities are the same
 * person when their employee_code matches (canonical), OR — for an account-only
 * actor with no employee code — when their account id matches. An actor that
 * carries NEITHER can never equal a recipient (recipients are always employees).
 *
 * Used ONLY by: new task creation (rule 1), new proposal where creator ==
 * recipient (rule 2), and a monthly recurrence occurrence where creator ==
 * primary (rule 18). It is deliberately NOT applied to TRANSFER (rule 5) —
 * a primary-assignee change always mails the new primary.
 */
function sameIdentity(a, b) {
  const ae = up(a && (a.employeeCode || a.employee_code));
  const be = up(b && (b.employeeCode || b.employee_code));
  if (ae && be) return ae === be;
  const aa = String((a && (a.accountId || a.account_id)) || '').trim();
  const ba = String((b && (b.accountId || b.account_id)) || '').trim();
  if (aa && ba) return aa === ba;
  return false;
}

// --- 1 / 3 / 18 : NEW TASK (real assignment) --------------------------------
// ctx: { primaryEmployeeCode, assigner: { employeeCode?, accountId? } }
function decideNewTask(ctx) {
  const primary = up(ctx && ctx.primaryEmployeeCode);
  if (!primary) return no('no_primary');
  if (sameIdentity(ctx.assigner, { employeeCode: primary })) return no('self_assigned');
  return yes(TEMPLATE_KEYS.TASK_NEW, primary);
}

// --- 2 : NEW PROPOSAL ------------------------------------------------------
// ctx: { recipientEmployeeCode, creator: { employeeCode?, accountId? } }
function decideNewProposal(ctx) {
  const recipient = up(ctx && ctx.recipientEmployeeCode);
  if (!recipient) return no('no_recipient');
  if (sameIdentity(ctx.creator, { employeeCode: recipient })) return no('creator_is_recipient');
  return yes(TEMPLATE_KEYS.PROPOSAL_NEW, recipient);
}

// --- 4 : DEADLINE CHANGE ------------------------------------------------------
// ctx: { oldDeadline, newDeadline, primaryEmployeeCode }
// MAIL only when the NEW deadline is strictly EARLIER than the old one.
// Later / equal / unparseable / start-date-only -> NO.
function decideDeadlineChange(ctx) {
  const primary = up(ctx && ctx.primaryEmployeeCode);
  if (!primary) return no('no_primary');
  const oldMs = Date.parse(ctx && ctx.oldDeadline);
  const newMs = Date.parse(ctx && ctx.newDeadline);
  if (!Number.isFinite(oldMs) || !Number.isFinite(newMs)) return no('deadline_unparseable');
  if (newMs >= oldMs) return no('deadline_not_earlier');
  return yes(TEMPLATE_KEYS.TASK_DEADLINE_EARLIER, primary);
}

// --- 5 : TRANSFER PRIMARY ---------------------------------------------------
// ctx: { newPrimaryEmployeeCode }
// Whenever the primary assignee changes -> MAIL=YES to the NEW primary, ALWAYS.
// NEVER the old primary. NO self-suppression: even if the actor transfers the
// task to themselves, the new primary still gets the mail (approved contract).
function decideTransfer(ctx) {
  const newPrimary = up(ctx && ctx.newPrimaryEmployeeCode);
  if (!newPrimary) return no('no_new_primary');
  return yes(TEMPLATE_KEYS.TASK_TRANSFERRED, newPrimary);
}

// --- 10 / 11 : COMPLETION ---------------------------------------------------
// ctx: { assignerEmployeeCode, onTime: boolean, actor: {...} }
// Recipient is the ASSIGNER (task creator). If the assigner completed their own
// task there is no one else to tell -> NO.
function decideCompletion(ctx) {
  const assigner = up(ctx && ctx.assignerEmployeeCode);
  if (!assigner) return no('no_assigner');
  if (sameIdentity(ctx.actor, { employeeCode: assigner })) return no('assigner_is_actor');
  return yes(
    ctx && ctx.onTime === false ? TEMPLATE_KEYS.TASK_COMPLETED_LATE : TEMPLATE_KEYS.TASK_COMPLETED,
    assigner
  );
}

// --- 14 : DIRECT CANCEL ---------------------------------------------------
// ctx: { primaryEmployeeCode, actor: {...} }
function decideDirectCancel(ctx) {
  const primary = up(ctx && ctx.primaryEmployeeCode);
  if (!primary) return no('no_primary');
  if (sameIdentity(ctx.actor, { employeeCode: primary })) return no('actor_is_primary');
  return yes(TEMPLATE_KEYS.TASK_CANCELLED, primary);
}

// --- 15 : REOPEN / RESTORE ------------------------------------------------
// ctx: { primaryEmployeeCode, actor: {...} }
function decideReopen(ctx) {
  const primary = up(ctx && ctx.primaryEmployeeCode);
  if (!primary) return no('no_primary');
  if (sameIdentity(ctx.actor, { employeeCode: primary })) return no('actor_is_primary');
  return yes(TEMPLATE_KEYS.TASK_REOPENED, primary);
}

// --- 18 : RECURRENCE occurrence -------------------------------------------
// ctx: { frequency, primaryEmployeeCode, creator: {...} }
// DAILY / WEEKLY generated occurrences  -> NO MAIL.
// MONTHLY generated occurrences         -> primary, unless primary == creator.
function decideRecurrenceOccurrence(ctx) {
  const freq = String((ctx && ctx.frequency) || '').trim().toLowerCase();
  if (freq !== 'monthly') return no('frequency_' + (freq || 'unknown'));
  return decideNewTask({ primaryEmployeeCode: ctx && ctx.primaryEmployeeCode, assigner: ctx && ctx.creator });
}

module.exports = {
  TEMPLATE_KEYS,
  ALL_TEMPLATE_KEYS,
  sameIdentity,
  decideNewTask,
  decideNewProposal,
  decideDeadlineChange,
  decideTransfer,
  decideCompletion,
  decideDirectCancel,
  decideReopen,
  decideRecurrenceOccurrence,
};
