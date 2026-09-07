'use strict';

/*
 * PHF Task — Timeline (Dòng thời gian) executor.
 *
 * Sibling of task-query-executor.js (Task List) and task-overview-query-executor.js
 * (Reporting V2) — NOT a modification of either. Replaces the read-bridge
 * Timeline fan-out (1 listTasks + up to TIMELINE_TASK_FANOUT full
 * bridgeGetTaskDetail reads + JS merge/sort, see
 * api/_lib/task-server-integration.js::listTaskEventsViaDetailFanout) with:
 *
 *   1 signed RESOLVED_TASK_QUERY_DESCRIPTOR_V1  (the SAME descriptor the Task
 *     List path builds — same signature / TTL / nonce / relation / scope /
 *     mode / excludeDraft / employeeCodes)
 *   -> executeResolvedTaskQuery() VERBATIM  (the canonical authorised-task-set
 *      resolver — reused, not reimplemented, so the visible task set is
 *      provably identical to what "Tôi nhận / Tôi giao / Nhân sự tôi quản lý"
 *      would return)
 *   -> ONE bounded task.events query over the newest TIMELINE_TASK_FANOUT of
 *      those task ids, ordered occurred_at DESC in SQL, limited to eventLimit.
 *
 * Business contract preserved exactly:
 *   - Timeline meaning: activity of the tasks the actor is authorised to see.
 *   - Visible task set: whatever executeResolvedTaskQuery() returns for this
 *     relation/scope, then the newest TIMELINE_TASK_FANOUT (identical to the
 *     old code's tasks.slice(0, TIMELINE_TASK_FANOUT)).
 *   - Ordering: occurred_at DESC (SQL), id DESC tie-break for determinism.
 *   - Event types / labels / payload / occurred_at: passed through untouched.
 *   - actor display name is enriched LOCALLY in the main app (org data), same
 *     as the Task List bridge — this file only returns actorEmployeeCode.
 *
 * Target: PostgreSQL phf_hr, schema `task` — same withTaskReadTransaction()
 * (lib/db.js) as every other read path here. No new index (uses the existing
 * task_events_task_idx (task_id, occurred_at DESC)). No schema change.
 */

const { withTaskReadTransaction } = require('./db');
const { executeResolvedTaskQuery } = require('./task-query-executor');

const TIMELINE_TASK_FANOUT = 60; // Timeline Foundation V1 bound — unchanged
const EVENT_HARD_CAP = 200;      // matches the old listTaskEventsViaServer cap

function wrapDbError(error) {
  const e = new Error('TASK_TIMELINE_QUERY_EXECUTOR_DB_ERROR: ' + (error && error.message));
  e.code = 'TASK_TIMELINE_QUERY_EXECUTOR_DB_ERROR';
  return e;
}

async function executeResolvedTaskTimelineQuery(config, descriptor, signingSecret, opts) {
  const eventLimit = Math.min(EVENT_HARD_CAP, Math.max(1, Number(opts && opts.eventLimit) || 100));

  // AUTHORISED TASK SET — reuse the Task List resolver unchanged. It performs
  // the signature/TTL/nonce check and the full relation/scope/mode WHERE, and
  // orders by created_at DESC. Anything it rejects, it throws (statusCode 401).
  const listResult = await executeResolvedTaskQuery(config, descriptor, signingSecret);

  const base = {
    relation: listResult.relation,
    scope: listResult.scope,
    viewScopeType: listResult.viewScopeType,
    requesterActorType: listResult.requesterActorType,
  };

  const tasks = (Array.isArray(listResult.data) ? listResult.data : []).slice(0, TIMELINE_TASK_FANOUT);
  if (!tasks.length) return Object.assign({ events: [] }, base);

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const ids = tasks.map((t) => t.id);

  let rows;
  try {
    rows = await withTaskReadTransaction(config, async (client) => {
      const r = await client.query(
        `SELECT e.id, e.task_id, e.event_type, e.actor_employee_code,
                e.payload, e.reason, e.occurred_at
           FROM task.events e
          WHERE e.task_id = ANY($1::uuid[])
          ORDER BY e.occurred_at DESC, e.id DESC
          LIMIT $2`,
        [ids, eventLimit]
      );
      return r.rows;
    });
  } catch (err) {
    if (err && err.code === 'TASK_TIMELINE_QUERY_EXECUTOR_DB_ERROR') throw err;
    throw wrapDbError(err);
  }

  const events = rows.map((e) => {
    const t = taskById.get(e.task_id) || {};
    return {
      id: e.id,
      taskId: e.task_id,
      taskCode: t.taskCode || '',
      taskTitle: t.title || '',
      eventType: e.event_type,
      actorEmployeeCode: e.actor_employee_code || '',
      payload: e.payload || {},
      reason: e.reason || null,
      occurredAt: e.occurred_at,
    };
  });

  return Object.assign({ events }, base);
}

module.exports = { executeResolvedTaskTimelineQuery, TIMELINE_TASK_FANOUT };
