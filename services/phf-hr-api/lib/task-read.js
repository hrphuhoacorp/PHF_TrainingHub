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

module.exports = { listTaskCategories, listTasks, TaskReadError };
