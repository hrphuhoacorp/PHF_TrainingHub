'use strict';

/*
 * PHF Task — phf-hr-api executor cho RESOLVED_TASK_QUERY_DESCRIPTOR_V1.
 *
 * CHỈ verify chữ ký + TTL + nonce rồi thực thi ĐÚNG query mà main app đã
 * resolve sẵn trong descriptor — KHÔNG tự suy luận permission, KHÔNG đọc
 * requesterActorType để quyết định mở/thu hẹp gì (chỉ pass-through vào
 * response metadata, đúng anti-expansion invariant đã chốt). KHÔNG đổi ở
 * Gate 11 — verifyDescriptor() giữ nguyên 100% byte-for-byte so với bản cũ.
 *
 * Gate 11 — TARGET: PostgreSQL phf_hr, schema `task` (KHÔNG còn Supabase
 * PHF-HR-DEV). Cùng withTaskReadTransaction() (lib/db.js) dùng bởi
 * task-read.js — không phát minh cơ chế truy cập DB thứ hai. Mọi WHERE
 * clause trước đây do PostgREST filter builder (.eq/.in/.gte/.lt/.or) tạo ra
 * nay viết trực tiếp bằng SQL tham số hoá ($1,$2,...) — tương đương ngữ
 * nghĩa, KHÔNG string-concat giá trị người dùng vào SQL text ở bất kỳ đâu.
 *
 * CHƯA wire vào server.js/route HTTP nào (giữ nguyên trạng thái "LOCAL ONLY,
 * chỉ gọi trực tiếp qua function call từ script test" từ bản gốc — Gate 11
 * chỉ đổi DB client, KHÔNG tự ý wire route mới, việc đó cần GO riêng).
 */

const crypto = require('crypto');
const { withTaskReadTransaction } = require('./db');

// In-memory — chỉ đủ cho 1 lần chạy test local (không phải nonce store thật
// cho production, đã ghi nhận là blocker riêng từ vòng thiết kế trước).
// KHÔNG đổi ở Gate 11 — vẫn cùng giới hạn đã biết, không port sang DB.
const seenNonces = new Set();

function canonicalSortedJson(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function verifyDescriptor(descriptor, signingSecret) {
  if (!descriptor || typeof descriptor !== 'object') return { ok: false, reason: 'DESCRIPTOR_MISSING' };
  const { signature, ...rest } = descriptor;
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
  if (descriptor.mode !== 'creator_eq' && descriptor.mode !== 'assignee_in') {
    return { ok: false, reason: 'MODE_INVALID' };
  }
  seenNonces.add(descriptor.nonce);
  return { ok: true };
}

function wrapDbError(error) {
  const e = new Error('TASK_QUERY_EXECUTOR_DB_ERROR: ' + (error && error.message));
  e.code = 'TASK_QUERY_EXECUTOR_DB_ERROR';
  return e;
}

function emptyResult(descriptor) {
  return {
    data: [], count: 0,
    relation: descriptor.relation, scope: descriptor.scope,
    viewScopeType: descriptor.viewScopeType, requesterActorType: descriptor.requesterActorType,
    offset: descriptor.offset, limit: descriptor.limit, hasMore: false,
  };
}

// ILIKE với dấu escape mặc định của Postgres là backslash — cùng ngữ nghĩa
// escape %,_ như bản PostgREST .ilike() cũ, không cần ESCAPE clause riêng.
function escapeLikePattern(value) {
  return String(value).replace(/[%_]/g, (c) => '\\' + c);
}

async function executeResolvedTaskQuery(config, descriptor, signingSecret) {
  const verified = verifyDescriptor(descriptor, signingSecret);
  if (!verified.ok) {
    const err = new Error('DESCRIPTOR_REJECTED: ' + verified.reason);
    err.code = verified.reason;
    err.statusCode = 401;
    throw err;
  }

  try {
    return await withTaskReadTransaction(config, async (client) => {
      const whereClauses = ['flow_type = $1'];
      const params = [descriptor.flowType];

      if (descriptor.mode === 'creator_eq') {
        params.push(descriptor.creatorEmployeeCode || '');
        whereClauses.push(`created_by_employee_code = $${params.length}`);
      } else {
        if (descriptor.assigneeEmployeeCodes !== null) {
          if (!Array.isArray(descriptor.assigneeEmployeeCodes) || !descriptor.assigneeEmployeeCodes.length) {
            return emptyResult(descriptor);
          }
          const assigneeResult = await client.query(
            `SELECT DISTINCT task_id
               FROM task.assignees
              WHERE role = 'primary' AND is_active = true
                AND employee_code = ANY($1::text[])
              LIMIT 5000`,
            [descriptor.assigneeEmployeeCodes]
          );
          const taskIds = assigneeResult.rows.map((r) => r.task_id);
          if (!taskIds.length) return emptyResult(descriptor);
          params.push(taskIds);
          whereClauses.push(`id = ANY($${params.length}::uuid[])`);
        }
        if (descriptor.excludeDraft) whereClauses.push(`status <> 'draft'`);
        if (descriptor.crossDepartmentOnly) whereClauses.push(`is_cross_department = true`);
      }

      if (descriptor.statusFilter === 'completed') {
        whereClauses.push(`status = 'completed'`);
      } else if (descriptor.statusFilter === 'in_progress') {
        params.push(new Date().toISOString());
        whereClauses.push(`status IN ('published', 'in_progress')`);
        whereClauses.push(`deadline >= $${params.length}`);
      } else if (descriptor.statusFilter === 'overdue') {
        params.push(new Date().toISOString());
        whereClauses.push(`status IN ('published', 'in_progress')`);
        whereClauses.push(`deadline < $${params.length}`);
      }

      if (descriptor.search) {
        const pattern = '%' + escapeLikePattern(descriptor.search) + '%';
        params.push(pattern);
        const searchParamIdx = params.length;
        whereClauses.push(`(task_code ILIKE $${searchParamIdx} OR title ILIKE $${searchParamIdx})`);
      }

      // Range xin (limit+1) dòng để phát hiện hasMore, giữ đúng ngữ nghĩa
      // .range(offset, offset+limit) cũ (inclusive cả 2 đầu = limit+1 dòng).
      params.push(descriptor.limit + 1);
      const limitParamIdx = params.length;
      params.push(descriptor.offset);
      const offsetParamIdx = params.length;

      const taskSql = `
        SELECT id, task_code, flow_type, status, title, priority, deadline,
               created_by_employee_code, is_cross_department, source_department,
               target_department, created_at, row_version
          FROM task.tasks
         WHERE ${whereClauses.join(' AND ')}
         ORDER BY created_at DESC, id ASC
         LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`;

      let pageRows;
      try {
        const result = await client.query(taskSql, params);
        pageRows = result.rows;
      } catch (err) {
        throw wrapDbError(err);
      }

      const hasMore = !!(pageRows && pageRows.length > descriptor.limit);
      const taskRows = hasMore ? pageRows.slice(0, descriptor.limit) : (pageRows || []);
      if (!taskRows.length) return emptyResult(descriptor);

      const ids = taskRows.map((t) => t.id);
      let primaryRows;
      try {
        const primaryResult = await client.query(
          `SELECT task_id, employee_code
             FROM task.assignees
            WHERE role = 'primary' AND is_active = true
              AND task_id = ANY($1::uuid[])`,
          [ids]
        );
        primaryRows = primaryResult.rows;
      } catch (err) {
        throw wrapDbError(err);
      }
      const primaryByTaskId = new Map((primaryRows || []).map((r) => [r.task_id, r.employee_code]));

      return {
        data: taskRows.map((t) => ({
          id: t.id,
          taskCode: t.task_code,
          flowType: t.flow_type,
          status: t.status,
          title: t.title,
          priority: t.priority,
          deadline: t.deadline,
          createdByEmployeeCode: t.created_by_employee_code,
          primaryEmployeeCode: primaryByTaskId.get(t.id) || null,
          isCrossDepartment: t.is_cross_department,
          sourceDepartment: t.source_department,
          targetDepartment: t.target_department,
          rowVersion: t.row_version,
        })),
        count: taskRows.length,
        relation: descriptor.relation,
        scope: descriptor.scope,
        viewScopeType: descriptor.viewScopeType,
        requesterActorType: descriptor.requesterActorType,
        offset: descriptor.offset,
        limit: descriptor.limit,
        hasMore,
      };
    });
  } catch (err) {
    if (err && err.code === 'TASK_QUERY_EXECUTOR_DB_ERROR') throw err;
    throw wrapDbError(err);
  }
}

module.exports = { executeResolvedTaskQuery, verifyDescriptor };
