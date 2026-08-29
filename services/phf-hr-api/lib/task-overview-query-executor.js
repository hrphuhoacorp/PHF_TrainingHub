'use strict';

/*
 * PHF Task — Reporting V2 (Tổng quan) executor for
 * RESOLVED_TASK_OVERVIEW_QUERY_DESCRIPTOR_V1.
 *
 * Sibling of task-query-executor.js (Task List), NOT a modification of it —
 * different payload shape (no mode/relation/scope/pagination — Overview
 * always wants the FULL authorized population, bounded, unpaginated, same
 * TASK_POPULATION_LIMIT bound the old Supabase report engine used), so a
 * separate verify+execute pair avoids retrofitting list-specific fields
 * (mode/offset/limit) onto a query that has none of those concepts.
 *
 * CHỈ verify chữ ký + TTL + nonce rồi thực thi ĐÚNG scope mà main app đã
 * resolve sẵn (employeeCodes null|[]|[...]) — KHÔNG tự suy luận permission ở
 * đây (anti-expansion invariant, same as task-query-executor.js).
 *
 * Target: PostgreSQL phf_hr, schema `task` — same withTaskReadTransaction()
 * (lib/db.js) as every other read path here, no second DB-access mechanism.
 */

const crypto = require('crypto');
const { withTaskReadTransaction } = require('./db');

const seenNonces = new Set(); // separate from task-query-executor.js's set — different descriptor namespace, no cross-talk needed
const TASK_POPULATION_LIMIT = 5000; // same bound the old Supabase report engine used (task-reporting.js TASK_POPULATION_LIMIT) — not a new number

function canonicalSortedJson(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function verifyOverviewDescriptor(descriptor, signingSecret) {
  if (!descriptor || typeof descriptor !== 'object') return { ok: false, reason: 'DESCRIPTOR_MISSING' };
  // effectiveScope is a LOCAL-ONLY UI label the main app attaches after
  // signing (see task-overview-query-descriptor-builder.js) — never part of
  // the wire payload sent here, but strip defensively if a caller forwards
  // it by mistake so it never silently changes the signature computation.
  const { signature, effectiveScope, ...rest } = descriptor;
  if (!signature) return { ok: false, reason: 'SIGNATURE_MISSING' };

  const expected = crypto.createHmac('sha256', signingSecret).update(canonicalSortedJson(rest)).digest('hex');
  const sigBuf = Buffer.from(String(signature), 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: 'SIGNATURE_INVALID' };
  }
  if (!descriptor.expiresAt || new Date(descriptor.expiresAt).getTime() < Date.now()) {
    return { ok: false, reason: 'DESCRIPTOR_EXPIRED' };
  }
  if (!descriptor.nonce || seenNonces.has(descriptor.nonce)) {
    return { ok: false, reason: 'NONCE_REPLAY_OR_MISSING' };
  }
  if (typeof descriptor.flowType !== 'string' || !descriptor.flowType) {
    return { ok: false, reason: 'FLOW_TYPE_INVALID' };
  }
  if (descriptor.employeeCodes !== null && !Array.isArray(descriptor.employeeCodes)) {
    return { ok: false, reason: 'EMPLOYEE_CODES_INVALID' };
  }
  seenNonces.add(descriptor.nonce);
  return { ok: true };
}

function wrapDbError(error) {
  const e = new Error('TASK_OVERVIEW_QUERY_EXECUTOR_DB_ERROR: ' + (error && error.message));
  e.code = 'TASK_OVERVIEW_QUERY_EXECUTOR_DB_ERROR';
  return e;
}

const EMPTY_RESULT = { tasks: [], completionEvents: [] };

async function executeResolvedTaskOverviewQuery(config, descriptor, signingSecret) {
  const verified = verifyOverviewDescriptor(descriptor, signingSecret);
  if (!verified.ok) {
    const err = new Error('DESCRIPTOR_REJECTED: ' + verified.reason);
    err.code = verified.reason;
    err.statusCode = 401;
    throw err;
  }

  if (Array.isArray(descriptor.employeeCodes) && !descriptor.employeeCodes.length) {
    return EMPTY_RESULT;
  }

  try {
    return await withTaskReadTransaction(config, async (client) => {
      const whereClauses = ['t.flow_type = $1'];
      const params = [descriptor.flowType];

      if (descriptor.employeeCodes !== null) {
        params.push(descriptor.employeeCodes);
        whereClauses.push(`t.id IN (
          SELECT task_id FROM task.assignees
           WHERE role = 'primary' AND is_active = true AND employee_code = ANY($${params.length}::text[])
        )`);
      }
      if (descriptor.excludeDraft) whereClauses.push(`t.status <> 'draft'`);

      params.push(TASK_POPULATION_LIMIT);
      const limitParamIdx = params.length;

      const taskSql = `
        SELECT t.id, t.task_code, t.title, t.status, t.deadline, t.completed_at,
               t.category_code, t.created_by_employee_code, t.is_cross_department,
               t.source_department, t.target_department, t.created_at, t.row_version,
               pa.employee_code AS primary_employee_code
          FROM task.tasks t
          LEFT JOIN task.assignees pa
            ON pa.task_id = t.id AND pa.role = 'primary' AND pa.is_active = true
         WHERE ${whereClauses.join(' AND ')}
         ORDER BY t.created_at DESC
         LIMIT $${limitParamIdx}`;

      let taskRows;
      try {
        const result = await client.query(taskSql, params);
        taskRows = result.rows;
      } catch (err) {
        throw wrapDbError(err);
      }
      if (!taskRows.length) return EMPTY_RESULT;

      const completedIds = taskRows.filter((r) => r.status === 'completed').map((r) => r.id);
      let completionEvents = [];
      if (completedIds.length) {
        try {
          const eventsResult = await client.query(
            `SELECT task_id, payload, occurred_at
               FROM task.events
              WHERE task_id = ANY($1::uuid[]) AND event_type = 'completion'
              ORDER BY occurred_at DESC`,
            [completedIds]
          );
          completionEvents = eventsResult.rows;
        } catch (err) {
          throw wrapDbError(err);
        }
      }

      return {
        tasks: taskRows.map((r) => ({
          id: r.id,
          taskCode: r.task_code,
          title: r.title,
          status: r.status,
          deadline: r.deadline,
          completedAt: r.completed_at,
          categoryCode: r.category_code,
          createdByEmployeeCode: r.created_by_employee_code,
          isCrossDepartment: r.is_cross_department,
          sourceDepartment: r.source_department,
          targetDepartment: r.target_department,
          createdAt: r.created_at,
          rowVersion: r.row_version,
          primaryEmployeeCode: r.primary_employee_code,
        })),
        completionEvents: completionEvents.map((e) => ({
          taskId: e.task_id,
          payload: e.payload,
          occurredAt: e.occurred_at,
        })),
      };
    });
  } catch (err) {
    if (err && err.code === 'TASK_OVERVIEW_QUERY_EXECUTOR_DB_ERROR') throw err;
    throw wrapDbError(err);
  }
}

module.exports = { executeResolvedTaskOverviewQuery, verifyOverviewDescriptor };
