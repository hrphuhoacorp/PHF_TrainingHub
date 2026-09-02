'use strict';

// Official READ-ONLY Task API cho phf-hr-api — KHÔNG phải /diag/dev-probe
// (probe chỉ trả count, dùng cho connectivity check; đây là API nghiệp vụ
// thật trả dữ liệu thật). Chỉ SELECT — không export bất kỳ hàm ghi nào
// (không insert/update/delete/rpc) trong file này.
//
// Gate 11 — TARGET: PostgreSQL phf_hr, schema `task` (KHÔNG còn Supabase
// PHF-HR-DEV). Dùng chung withTaskReadTransaction() từ lib/db.js — cùng
// pattern role-boundary (SET LOCAL ROLE phf_hr_app) đã CLOSED ở write path,
// không phát minh cơ chế truy cập DB mới. Response shape giữ NGUYÊN 100% so
// với bản Supabase trước đó — đây là thay đổi nguồn dữ liệu phía sau, không
// phải thay đổi contract.
//
// Timeout: statement_timeout đặt trong withTaskReadTransaction() (mặc định
// 8000ms, giữ đúng giá trị QUERY_TIMEOUT_MS cũ), thay cho AbortController
// phía Supabase client trước đây — cùng mục đích (không treo request nếu DB
// chậm/không phản hồi), khác cơ chế do đổi client.

const { withTaskReadTransaction } = require('./db');

const QUERY_TIMEOUT_MS = 8000;

class TaskReadError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

// Ánh xạ lỗi Postgres (SQLSTATE) -> HTTP status rõ ràng, KHÔNG lộ nguyên văn
// thông báo lỗi nội bộ (tên bảng/cột/constraint) ra ngoài. Log đầy đủ ở
// server-side (caller chịu trách nhiệm log), response cho client chỉ có mã
// lỗi + câu ngắn gọn. Giữ đúng 4 TaskReadError code cũ (TASK_SCHEMA_MISSING/
// TASK_PERMISSION_DENIED/TASK_READ_TIMEOUT/TASK_READ_ERROR) — không đổi
// error contract khi đổi DB client.
function mapPgError(error) {
  if (!error) return null;
  const code = String((error && error.code) || '');
  if (code === '42P01') {
    return new TaskReadError('Bảng PHF Task chưa sẵn sàng trên PostgreSQL.', 503, 'TASK_SCHEMA_MISSING');
  }
  if (code === '42501') {
    return new TaskReadError('Thiếu quyền truy cập dữ liệu Task trên PostgreSQL.', 500, 'TASK_PERMISSION_DENIED');
  }
  if (code === '57014') {
    return new TaskReadError('Truy vấn Task PostgreSQL quá thời gian chờ.', 504, 'TASK_READ_TIMEOUT');
  }
  return new TaskReadError('Lỗi đọc dữ liệu PHF Task.', 500, 'TASK_READ_ERROR');
}

// GET /v1/task/categories — response schema:
//   { data: [{ categoryCode, displayName, description, color, isActive, sortOrder }], count }
// Chỉ trả category đang active — khớp đúng hành vi listTaskCategories() phía
// app chính (api/_lib/task-core.js), không lộ category đã ngừng dùng qua API
// đọc chung này (nếu cần xem cả inactive, đó là màn hình Admin riêng, không
// thuộc phạm vi API foundation này).
async function listTaskCategories(config) {
  let rows;
  try {
    rows = await withTaskReadTransaction(config, async (client) => {
      const result = await client.query(
        `SELECT category_code, display_name, description, color, is_active, sort_order
           FROM task.categories
          WHERE is_active = true
          ORDER BY sort_order ASC`
      );
      return result.rows;
    }, { timeoutMs: QUERY_TIMEOUT_MS });
  } catch (err) {
    const mapped = mapPgError(err);
    throw mapped || err;
  }

  const mappedRows = (rows || []).map((r) => ({
    categoryCode: r.category_code,
    displayName: r.display_name,
    description: r.description,
    color: r.color,
    isActive: r.is_active,
    sortOrder: r.sort_order,
  }));
  return { data: mappedRows, count: mappedRows.length };
}

// GET /v1/task/tasks — response schema:
//   { data: [{ id, taskCode, flowType, status, title, categoryCode, priority,
//              startAt, deadline, progressPercent, progressStatus,
//              createdByEmployeeCode, createdAt, updatedAt, rowVersion }], count }
// KHÔNG trả "content" (nội dung chi tiết task) trong list — đúng nguyên tắc
// list nhẹ/summary, giống pattern list-vs-detail đã có ở task-core.js.
// Giới hạn cứng 200 dòng/lần gọi — API foundation, chưa có phân trang thật.
//
// KHÔNG wire vào server.js (dead code từ khi tạo — comment gốc đã ghi rõ
// đây là bản "flat, actor-blind/over-broad" bị audit từ chối làm route
// thật, thay bằng executeResolvedTaskQuery() descriptor-aware). Gate 11
// chỉ đổi DB client cho nhất quán trong file, KHÔNG tự ý wire route mới —
// việc wire route nằm ngoài phạm vi "repoint read path", cần GO riêng.
async function listTasks(config) {
  let rows;
  try {
    rows = await withTaskReadTransaction(config, async (client) => {
      const result = await client.query(
        `SELECT id, task_code, flow_type, status, title, category_code, priority,
                start_at, deadline, progress_percent, progress_status,
                created_by_employee_code, created_at, updated_at, row_version
           FROM task.tasks
          ORDER BY created_at DESC
          LIMIT 200`
      );
      return result.rows;
    }, { timeoutMs: QUERY_TIMEOUT_MS });
  } catch (err) {
    const mapped = mapPgError(err);
    throw mapped || err;
  }

  const mappedRows = (rows || []).map((r) => ({
    id: r.id,
    taskCode: r.task_code,
    flowType: r.flow_type,
    status: r.status,
    title: r.title,
    categoryCode: r.category_code,
    priority: r.priority,
    startAt: r.start_at,
    deadline: r.deadline,
    progressPercent: r.progress_percent,
    progressStatus: r.progress_status,
    createdByEmployeeCode: r.created_by_employee_code,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    rowVersion: r.row_version,
  }));
  return { data: mappedRows, count: mappedRows.length };
}

// GET /v1/task/tasks/:id — SINGLE-TASK READ FOUNDATION (2026-08-27).
//
// Mục đích: state source cho seam validate/authorize của main app (task-core.js
// style: loadTaskRow()+loadAssignees()) khi task sống trên phf_hr (không phải
// Supabase) — bắt buộc trước khi wire bất kỳ lifecycle operation nào ngoài
// createTaskDraft (phát hiện 2026-08-27: publishTask/updateTaskProgress/
// cancelTask/... đều cần đọc lại state hiện tại để authorize TRƯỚC khi ghi,
// và state đó phải đọc đúng từ nơi task thật sự tồn tại).
//
// Response shape CỐ Ý raw snake_case (KHÔNG camelCase như listTasks/
// listTaskCategories ở trên) — vì mục đích DUY NHẤT của endpoint này là hội
// tụ 1:1 với shape mà task-core.js's loadTaskRow()/loadAssignees() (Supabase,
// `select('*')`) đã trả từ trước tới giờ, để logic authorization hiện có
// (actorOwnsTask() đọc taskRow.created_by_account_id/created_by_employee_code,
// v.v.) dùng lại được NGUYÊN VẸN qua adapter, không cần viết lại 1 dòng
// business rule/permission logic nào ở đây — endpoint này KHÔNG chứa bất kỳ
// authorization/permission logic gì, chỉ trả state thô (đúng nguyên tắc đã
// CLOSED từ S3B: authorization luôn chạy Ở MAIN APP).
//
// { task: <row đầy đủ từ task.tasks, SELECT *>,
//   assignees: [<row đầy đủ từ task.assignees, SELECT *>, ...],
//   comments/links/events: <row đầy đủ, SELECT *> } (thêm 2026-08-27, xem
//   getTaskById() bên dưới — additive, KHÔNG đổi 2 field task/assignees đã
//   có, caller cũ (bridgeGetTaskById, chỉ đọc task/assignees) không bị ảnh
//   hưởng).
// task = null nếu không tìm thấy -> caller (route) trả 404 TASK_NOT_FOUND,
// KHÔNG throw lỗi DB giả (không tìm thấy KHÔNG phải lỗi DB).
//
// comments/links/events thêm vào (2026-08-27) làm state source cho
// getTaskDetailViaServer() phía main app (xem api/_lib/task-server-
// integration.js) — GIỐNG hệt lý do assignees đã có: trả raw rows, KHÔNG
// filter/enrich/authorize gì ở đây (link "đã xóa" vẫn trả nguyên, main app
// tự lọc bằng events — đúng nguyên tắc "endpoint này KHÔNG chứa business
// logic" đã CLOSED phía trên).
async function getTaskById(config, taskId) {
  let result;
  try {
    result = await withTaskReadTransaction(config, async (client) => {
      const taskResult = await client.query(
        'SELECT * FROM task.tasks WHERE id = $1',
        [taskId]
      );
      const task = taskResult.rows[0] || null;
      if (!task) return { task: null, assignees: [], comments: [], links: [], events: [], attachments: [], recurrence: null, cancel_request: null };

      const [assigneesResult, commentsResult, linksResult, eventsResult, attachmentsResult] = await Promise.all([
        client.query('SELECT * FROM task.assignees WHERE task_id = $1', [taskId]),
        client.query('SELECT * FROM task.comments WHERE task_id = $1 ORDER BY created_at ASC', [taskId]),
        client.query('SELECT * FROM task.links WHERE task_id = $1 ORDER BY created_at ASC', [taskId]),
        client.query('SELECT * FROM task.events WHERE task_id = $1 ORDER BY occurred_at DESC', [taskId]),
        // FILE ATTACHMENT V1 (2026-08-31, additive) — ACTIVE rows only, safe
        // projection ONLY. stored_object_key / checksum_sha256 / deleted_* are
        // deliberately NOT selected so the on-disk object key never leaves this
        // service on the read path (download resolves the key internally via
        // task-write.getTaskAttachmentForDownload and streams bytes only).
        client.query(
          `SELECT id, original_filename, mime_type, extension, size_bytes,
                  uploaded_by_employee_code, uploaded_by_account_id, created_at
             FROM task.attachments
            WHERE task_id = $1 AND status = 'active'
            ORDER BY created_at ASC`,
          [taskId]
        ),
      ]);

      // Proposal V2 (2026-08-29, additive) — chỉ query thêm khi flow_type=
      // 'de_xuat' (KHÔNG đụng response shape cho Giao việc bình thường).
      if (task.flow_type === 'de_xuat') {
        const proposalResult = await client.query('SELECT * FROM task.proposal_decisions WHERE proposal_task_id = $1', [taskId]);
        task.proposal_decision = proposalResult.rows[0] || null;
      }

      // SOURCE OF WORK (2026-09-01, additive) — was this giao_viec Task
      // produced by accepting a Proposal? Used by the detail DTO's creation-
      // time "Tự giao" classification. Cheap indexed reverse lookup.
      const proposalGenRes = await client.query(
        'SELECT 1 FROM task.proposal_decisions WHERE generated_task_id = $1 LIMIT 1',
        [taskId]
      );
      task.proposal_generated = proposalGenRes.rowCount > 0;

      // RECURRENCE V1 (2026-08-31, additive) — a compact, NON-technical
      // recognition summary for Task Detail, present ONLY when this Task
      // belongs to a recurrence series (task.recurring_series_id set — that is
      // true for BOTH the truthfully-claimed initial Task and every
      // scheduler-generated Task). The recurrence RULE is the single source of
      // truth for frequency + finite count. NO ids / version / internal fields
      // are surfaced. Any failure here degrades to `recurrence: null` and never
      // breaks Task Detail.
      let recurrence = null;
      if (task.recurring_series_id) {
        try {
          const ruleRes = await client.query(
            `SELECT frequency, weekday, day_of_month, status, end_condition_type, max_occurrences
               FROM task.recurrence_rules WHERE id = $1`,
            [task.recurring_series_id]
          );
          const rule = ruleRes.rows[0];
          if (rule) {
            let remaining = null;
            if (rule.end_condition_type === 'after_count' && rule.max_occurrences != null) {
              const genRes = await client.query(
                `SELECT count(*)::int AS n FROM task.recurrence_occurrences
                  WHERE rule_id = $1 AND status = 'generated' AND is_initial = false`,
                [task.recurring_series_id]
              );
              remaining = Math.max(0, Number(rule.max_occurrences) - genRes.rows[0].n);
            }
            recurrence = {
              frequency: rule.frequency,               // 'weekly' | 'monthly'
              weekday: rule.weekday || null,            // 'T2'..'CN' for weekly
              day_of_month: rule.day_of_month || null,  // 1..31 for monthly
              rule_active: rule.status === 'active',
              remaining_occurrences: remaining,         // null => indefinite / not finite
            };
          }
        } catch (_recErr) {
          recurrence = null;
        }
      }

      // CANCEL POLICY V1 (2026-08-31, additive) — the PENDING "Yêu cầu hủy" for
      // this Task, if any (non-technical: status/reason/who/when). Guarded by
      // to_regclass so it is a single no-op query until the schema patch
      // (migrations/phf_hr_task_cancel_request_v1.sql) is applied, and never
      // breaks Task Detail.
      let cancelRequest = null;
      try {
        const crRes = await client.query(
          `SELECT id, status, reason, requested_by_employee_code, requested_at,
                  decided_by_employee_code, decided_at, decision_note
             FROM task.cancel_requests
            WHERE to_regclass('task.cancel_requests') IS NOT NULL
              AND task_id = $1 AND status = 'pending'
            ORDER BY requested_at DESC LIMIT 1`,
          [taskId]
        );
        cancelRequest = crRes.rows[0] || null;
      } catch (_crErr) {
        cancelRequest = null;
      }

      return {
        task,
        assignees: assigneesResult.rows,
        comments: commentsResult.rows,
        links: linksResult.rows,
        events: eventsResult.rows,
        attachments: attachmentsResult.rows,
        recurrence,
        cancel_request: cancelRequest,
      };
    }, { timeoutMs: QUERY_TIMEOUT_MS });
  } catch (err) {
    const mapped = mapPgError(err);
    throw mapped || err;
  }
  return result;
}

module.exports = { listTaskCategories, listTasks, getTaskById, TaskReadError };
