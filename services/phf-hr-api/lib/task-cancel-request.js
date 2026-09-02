'use strict';

/*
 * PHF Task — CANCEL POLICY V1 (company PostgreSQL `phf_hr`, schema `task`).
 *
 * PostgreSQL-only. No Supabase. Mirrors the Proposal V2 pattern: one mutable
 * `task.cancel_requests` row per request (state machine pending -> approved |
 * rejected | withdrawn), the full audit in `task.events`
 * (`cancel_request` / `cancel_request_decision`).
 *
 * Authorization is decided by the MAIN APP (api/_lib/task-permissions.js) and
 * passed down as params.interventionBasis — this layer only backstops it
 * (approve/reject need a management basis; withdraw needs the requester).
 *
 * migrations/phf_hr_task_cancel_request_v1.sql — deployer applies. Until then
 * hasCancelRequestSchema() is false and every entry point throws
 * TASK_CANCEL_REQUEST_UNSUPPORTED (509-ish; mapped 409 at the route).
 */

const { withTaskWriteTransaction } = require('./db');
const notify = require('./task-notification-emit');

// IN-APP NOTIFICATION V1 — in-transaction emit wrapper (see lib/task-write.js
// for the identical rationale). No-op until the notification schema patch.
async function emitCancelRequestNotification(client, opts) {
  if (!(await notify.hasNotificationV1Schema(client))) return { created: 0, skipped: 'schema' };
  const eventId = typeof opts.getEventId === 'function' ? opts.getEventId() : (opts.eventId || null);
  const recipients = typeof opts.resolveRecipients === 'function' ? await opts.resolveRecipients() : (opts.recipients || []);
  const m = notify.messageFor(opts.eventCode, opts.taskTitle);
  return notify.emitEventNotifications({
    client,
    eventId,
    eventCode: opts.eventCode,
    taskId: opts.taskId,
    title: m.title,
    message: m.message,
    targetPath: notify.targetPathFor(opts.taskId),
    priority: opts.priority || 'Trung bình',
    recipients,
    actor: { employeeCode: opts.actorEmployeeCode, accountId: opts.actorAccountId },
  });
}

const MANAGEMENT_CANCEL_BASES = new Set(['creator', 'system_admin', 'executive_authority', 'exception_grant']);
const ACTIVE_TASK_STATUSES = new Set(['published', 'in_progress']);

function crErr(code) { const e = new Error(code); e.code = code; return e; }
function tok(emp, acc) { const e = emp && String(emp).trim(); if (e) return e; const a = acc && String(acc).trim(); return a || ''; }
function upperTok(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
function normInt(v) { const n = Number(v); return Number.isInteger(n) ? n : undefined; }

let _schema = null;
async function hasCancelRequestSchema(client) {
  if (_schema !== null) return _schema;
  const r = await client.query(
    `SELECT count(*) FILTER (WHERE table_name = 'cancel_requests') AS t,
            count(*) FILTER (WHERE table_name = 'events' AND column_name = 'event_type') AS e
       FROM information_schema.columns WHERE table_schema = 'task'`
  );
  // table present + (defensively) the widened event_type CHECK; we can't read
  // the CHECK cheaply, so just require the table — the migration ships both.
  _schema = Number(r.rows[0].t) > 0;
  return _schema;
}

// Non-technical view for the Task Detail DTO + action responses.
function publicView(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,                       // pending | approved | rejected | withdrawn
    reason: row.reason,
    requested_by_employee_code: row.requested_by_employee_code || null,
    requested_at: row.requested_at,
    decided_by_employee_code: row.decided_by_employee_code || null,
    decided_at: row.decided_at || null,
    decision_note: row.decision_note || null,
  };
}

async function getPendingForTask(client, taskId) {
  const r = await client.query(
    `SELECT * FROM task.cancel_requests WHERE task_id = $1 AND status = 'pending' LIMIT 1`, [taskId]
  );
  return r.rows[0] || null;
}

// ---------------------------------------------------------------------------
// SUBMIT — the active primary asks for cancellation. Reason mandatory. Task
// must exist and be active (published / in_progress). At most one pending.
// ---------------------------------------------------------------------------
async function submitCancelRequest(config, params) {
  const { taskId, reason, actorEmployeeCode, actorAccountId, reviewerRecipients } = params || {};
  if (!reason || String(reason).trim() === '') throw crErr('TASK_CANCEL_REQUEST_REASON_REQUIRED');
  return withTaskWriteTransaction(config, async (client) => {
    if (!(await hasCancelRequestSchema(client))) throw crErr('TASK_CANCEL_REQUEST_UNSUPPORTED');
    const t = await client.query(
      'SELECT id, status, title, created_by_employee_code, created_by_account_id FROM task.tasks WHERE id = $1 FOR UPDATE',
      [taskId]
    );
    if (t.rowCount === 0) throw crErr('TASK_NOT_FOUND');
    const task = t.rows[0];
    if (task.status === 'draft') throw crErr('TASK_DRAFT_USE_DELETE');
    if (task.status === 'cancelled') throw crErr('TASK_ALREADY_CANCELLED');
    if (task.status === 'completed') throw crErr('TASK_MUST_REOPEN_BEFORE_CANCEL');
    if (!ACTIVE_TASK_STATUSES.has(task.status)) throw crErr('TASK_NOT_ACTIVE');

    if (await getPendingForTask(client, taskId)) throw crErr('TASK_CANCEL_REQUEST_PENDING_EXISTS');

    const auditToken = tok(actorEmployeeCode, actorAccountId);
    let inserted;
    try {
      inserted = await client.query(
        `INSERT INTO task.cancel_requests (task_id, status, reason, requested_by_employee_code, requested_by_account_id)
         VALUES ($1, 'pending', $2, $3, $4) RETURNING *`,
        [taskId, String(reason).trim(), actorEmployeeCode || null, actorAccountId || null]
      );
    } catch (e) {
      // racing double-submit -> unique partial index violation
      if (e && e.code === '23505') throw crErr('TASK_CANCEL_REQUEST_PENDING_EXISTS');
      throw e;
    }
    const row = inserted.rows[0];
    const crEvent = await client.query(
      `INSERT INTO task.events (task_id, event_type, actor_employee_code, actor_account_id, payload, reason)
       VALUES ($1, 'cancel_request', $2, $3, $4::jsonb, $5) RETURNING id`,
      [taskId, auditToken, actorAccountId || null, JSON.stringify({ cancel_request_id: row.id, action: 'submit' }), String(reason).trim()]
    );

    // IN-APP NOTIFICATION V1 — cancel_request -> creator/assigner (always,
    // resolvable in-transaction) + any authorised direct-cancel reviewers the
    // MAIN APP resolved from its permission graph and passed in
    // (reviewerRecipients). This layer NEVER derives reviewer authority itself.
    await emitCancelRequestNotification(client, {
      getEventId: () => crEvent.rows[0] && crEvent.rows[0].id,
      eventCode: 'TASK_CANCEL_REQUESTED', taskId, taskTitle: task.title,
      priority: 'Cao',
      recipients: [
        { employeeCode: task.created_by_employee_code, accountId: task.created_by_account_id },
        ...(Array.isArray(reviewerRecipients) ? reviewerRecipients.map((r) => ({
          employeeCode: r && (r.employeeCode || r.employee_code),
          accountId: r && (r.accountId || r.account_id),
        })) : []),
      ],
      actorEmployeeCode, actorAccountId,
    });

    return publicView(row);
  });
}

// ---------------------------------------------------------------------------
// DECIDE — approve | reject | withdraw. Authorization is done upstream; this
// backstops: approve/reject need a management basis; withdraw needs the
// requester identity. APPROVE routes through the canonical cancel lifecycle
// IN THE SAME TRANSACTION (identical UPDATE + `cancel` event as task_cancel).
// ---------------------------------------------------------------------------
async function decideCancelRequest(config, params) {
  const { taskId, decision, actorEmployeeCode, actorAccountId, expectedRowVersion, note, interventionBasis } = params || {};
  if (['approve', 'reject', 'withdraw'].indexOf(decision) < 0) throw crErr('TASK_CANCEL_REQUEST_DECISION_INVALID');
  return withTaskWriteTransaction(config, async (client) => {
    if (!(await hasCancelRequestSchema(client))) throw crErr('TASK_CANCEL_REQUEST_UNSUPPORTED');
    const cr = await client.query(
      `SELECT * FROM task.cancel_requests WHERE task_id = $1 AND status = 'pending' FOR UPDATE`, [taskId]
    );
    if (cr.rowCount === 0) throw crErr('TASK_CANCEL_REQUEST_NOT_FOUND');
    const request = cr.rows[0];
    const auditToken = tok(actorEmployeeCode, actorAccountId);

    if (decision === 'withdraw') {
      const same = (
        (request.requested_by_employee_code && upperTok(request.requested_by_employee_code) === upperTok(actorEmployeeCode)) ||
        (request.requested_by_account_id && String(request.requested_by_account_id) === String(actorAccountId || ''))
      );
      if (!same) throw crErr('TASK_CANCEL_REQUEST_ACTOR_DENIED');
    } else {
      const basis = interventionBasis && String(interventionBasis).trim();
      if (!basis || !MANAGEMENT_CANCEL_BASES.has(basis)) throw crErr('TASK_CANCEL_REQUEST_ACTOR_DENIED');
    }

    const t = await client.query('SELECT * FROM task.tasks WHERE id = $1 FOR UPDATE', [taskId]);
    if (t.rowCount === 0) throw crErr('TASK_NOT_FOUND');
    const task = t.rows[0];

    const finalStatus = decision === 'approve' ? 'approved' : (decision === 'reject' ? 'rejected' : 'withdrawn');

    let cancelledTask = null;
    if (decision === 'approve') {
      // Canonical cancel — same invariants as task_cancel / lib task-write.cancelTask.
      if (task.status === 'draft') throw crErr('TASK_DRAFT_USE_DELETE');
      if (task.status === 'cancelled') throw crErr('TASK_ALREADY_CANCELLED');
      if (task.status === 'completed') throw crErr('TASK_MUST_REOPEN_BEFORE_CANCEL');
      const evrv = normInt(expectedRowVersion);
      if (evrv === undefined || task.row_version !== evrv) throw crErr('TASK_VERSION_CONFLICT');
      const prevStatus = task.status;
      const upd = await client.query(
        `UPDATE task.tasks
            SET status = 'cancelled', cancelled_at = now(), cancel_reason = $1, updated_at = now(), row_version = row_version + 1
          WHERE id = $2 RETURNING *`,
        [request.reason, taskId]
      );
      cancelledTask = upd.rows[0];
      const canonicalCancelEvent = await client.query(
        `INSERT INTO task.events (task_id, event_type, actor_employee_code, actor_account_id, payload, reason)
         VALUES ($1, 'cancel', $2, $3, $4::jsonb, $5) RETURNING id`,
        [taskId, auditToken, actorAccountId || null, JSON.stringify({ previous_status: prevStatus, source: 'cancel_request', cancel_request_id: request.id }), request.reason]
      );
      // IN-APP NOTIFICATION V1 — approve == a real cancellation -> active
      // primary + active related (minus actor), same as a direct cancel.
      await emitCancelRequestNotification(client, {
        getEventId: () => canonicalCancelEvent.rows[0] && canonicalCancelEvent.rows[0].id,
        eventCode: 'TASK_CANCELLED', taskId, taskTitle: task.title,
        resolveRecipients: async () => {
          const { activePrimary, activeRelated } = await notify.loadActiveAssignees(client, taskId);
          return [
            ...(activePrimary ? [{ employeeCode: activePrimary }] : []),
            ...activeRelated.map((c) => ({ employeeCode: c })),
          ];
        },
        actorEmployeeCode, actorAccountId,
      });
    }

    const updatedReq = await client.query(
      `UPDATE task.cancel_requests
          SET status = $2, decided_by_employee_code = $3, decided_by_account_id = $4, decided_at = now(),
              decision_note = $5, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [request.id, finalStatus, actorEmployeeCode || null, actorAccountId || null, (note && String(note).trim()) || null]
    );
    const decisionEvent = await client.query(
      `INSERT INTO task.events (task_id, event_type, actor_employee_code, actor_account_id, payload, reason)
       VALUES ($1, 'cancel_request_decision', $2, $3, $4::jsonb, $5) RETURNING id`,
      [taskId, auditToken, actorAccountId || null,
        JSON.stringify({ cancel_request_id: request.id, decision, final_status: finalStatus, intervention_basis: interventionBasis || null }),
        (note && String(note).trim()) || (decision === 'approve' ? request.reason : null)]
    );

    // IN-APP NOTIFICATION V1 — decision -> the requester (minus actor: a
    // self-withdraw notifies nobody).
    await emitCancelRequestNotification(client, {
      getEventId: () => decisionEvent.rows[0] && decisionEvent.rows[0].id,
      eventCode: 'TASK_CANCEL_REQUEST_DECIDED', taskId, taskTitle: task.title,
      recipients: [{
        employeeCode: request.requested_by_employee_code,
        accountId: request.requested_by_account_id,
      }],
      actorEmployeeCode, actorAccountId,
    });

    return { cancel_request: publicView(updatedReq.rows[0]), task: cancelledTask };
  });
}

module.exports = { submitCancelRequest, decideCancelRequest, hasCancelRequestSchema, MANAGEMENT_CANCEL_BASES };
