'use strict';

// PHF HR — Batch 1 + Batch 2 + Batch 3 write-path DB layer.
// Batch 1: update_progress, complete, reopen.
// Batch 2: cancel, change_deadline.
// Batch 3: create_draft V2, publish.
//
// Dịch NGUYÊN VĂN logic đã audit verbatim ở S3A từ
// scripts/PHF_TASK_CORE_RPC_1.67.0.sql (task_update_progress, task_complete,
// task_reopen, task_cancel, task_change_deadline) sang SQL chạy trực tiếp qua
// node-postgres, vì các RPC PL/pgSQL
// đó KHÔNG được port sang phf_hr (S4 quyết định move-to-API cho phần phụ
// thuộc user_accounts/employee_profiles không tồn tại ở phf_hr) — file này
// LÀ phần "move to API" đó cho 3 operation Batch 1.
//
// KHÔNG kiểm tra authorization/scope ở đây — đúng nguyên tắc đã ghi ngay
// trong file RPC gốc ("Permission/scope KHÔNG được kiểm tra trong các
// function này — đó là trách nhiệm của lib/task-permissions.js, gọi TRƯỚC
// khi RPC được gọi"). Function ở đây chỉ enforce data invariant thuần tuý
// (row_version CAS, state-machine hợp lệ, field bắt buộc) — giống hệt RPC gốc.
//
// Actor identity: theo S3B mục 6.2 (đã CLOSED) — main app resolve 1 lần/
// request rồi gửi CẢ 2 field actorEmployeeCode/actorAccountId (1 trong 2 có
// thể rỗng) xuống đây, KHÔNG tự tra cứu lại. task.events có 2 cột riêng
// (actor_employee_code NOT NULL, actor_account_id nullable — 1.68.0
// correction trong migration Gate S2) — cột actor_employee_code vẫn phải
// non-empty (CHECK constraint task_events_actor_ck), nên áp dụng đúng fallback
// pattern actorAuditToken() đã có sẵn trong api/_lib/task-core.js
// (employeeCode || accountId) cho cột đó, đồng thời ghi thêm actor_account_id
// riêng khi có — không suy đoán khác đi.
//
// Error contract: throw đúng NGUYÊN VĂN các mã lỗi đã có trong RAISE
// EXCEPTION của RPC gốc (TASK_NOT_FOUND, TASK_VERSION_CONFLICT,
// TASK_NOT_ACTIVE, TASK_PROGRESS_PERCENT_INVALID, TASK_PROGRESS_STATUS_INVALID,
// TASK_COMPLETION_RESULT_REQUIRED, TASK_NOT_COMPLETED,
// TASK_REOPEN_REASON_REQUIRED) — khớp 100% với RPC_ERROR_MAP trong
// api/_lib/task-core.js (không đổi wording/thêm mã mới).
//
// PARITY GAP FIX (đã CLOSED, Technical Lead duyệt qua 2 lượt):
//   Gap 1 — integer boundary: expectedRowVersion/progressPercent nay được
//     normalize qua normalizeInteger() (chỉ chấp nhận number nguyên hoặc
//     numeric-string thuần chữ số, KHÔNG dùng parseInt() kiểu "5abc"->5).
//     progressPercent: normalize fail hoặc ngoài 0..100 -> TASK_PROGRESS_
//     PERCENT_INVALID (chỉ định tường minh của Technical Lead).
//     expectedRowVersion: FINAL CONTRACT (Technical Lead quyết định chính
//     thức) — normalize fail (decimal, NaN, Infinity, non-numeric string,
//     bất kỳ giá trị malformed nào khác) -> throw TASK_VERSION_CONFLICT
//     TƯỜNG MINH ngay khi normalize fail, KHÔNG dựa vào so sánh raw-value
//     "tình cờ" lệch nữa, KHÔNG tạo error code thứ 9 (NEW_ERROR_CODE_ALLOWED
//     = NO). Đây là quyết định cuối cùng cho Batch 1, không còn bỏ ngỏ.
//   Gap 2 — timestamp payload: completion/reopen event payload nay dùng
//     jsonb_build_object(...) NGAY TRONG SQL (qua CTE kết hợp UPDATE+INSERT
//     trong 1 statement), lấy completed_at/deadline trực tiếp từ row vừa
//     UPDATE — Postgres tự serialize timestamptz->jsonb, KHÔNG dùng
//     JSON.stringify(Date)/toISOString() nào ở phía JS cho các giá trị này.
//     progress payload KHÔNG có timestamp nào (chỉ percent/status) nên KHÔNG
//     cần đổi cấu trúc — giữ nguyên JS-side JSON.stringify như cũ.

const { withTaskWriteTransaction } = require('./db');

function resolveAuditToken(actorEmployeeCode, actorAccountId) {
  const emp = actorEmployeeCode && String(actorEmployeeCode).trim();
  if (emp) return emp;
  const acc = actorAccountId && String(actorAccountId).trim();
  return acc || '';
}

function taskWriteError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

// Chỉ chấp nhận: (a) JS number nguyên thật (Number.isInteger), hoặc (b)
// string chỉ gồm chữ số (có thể có dấu trừ đầu) sau khi trim — KHÔNG chấp
// nhận decimal ("5.5"), KHÔNG chấp nhận chuỗi lẫn ký tự ("5abc"), KHÔNG dùng
// parseInt() (parseInt("5abc") === 5 — chính xác kiểu lọt mà yêu cầu cấm).
// Trả về undefined nếu KHÔNG normalize được — caller tự quyết hành vi tiếp
// theo, hàm này không tự suy đoán fallback.
function normalizeInteger(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isSafeInteger(n)) return n;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// task_update_progress — published/in_progress only; published + percent>0 tự
// chuyển in_progress. 100% KHÔNG tự complete (giữ nguyên rule gốc).
// ---------------------------------------------------------------------------
async function updateTaskProgress(config, params) {
  const { taskId, expectedRowVersion, actorEmployeeCode, actorAccountId, progressPercent, progressStatus } = params;

  return withTaskWriteTransaction(config, async (client) => {
    const current = await client.query('SELECT * FROM task.tasks WHERE id = $1 FOR UPDATE', [taskId]);
    if (current.rowCount === 0) throw taskWriteError('TASK_NOT_FOUND');
    const task = current.rows[0];

    // expectedRowVersion: xem ghi chú Gap 1 ở đầu file — normalize khi được,
    // KHÔNG tự quyết mapping khác cho case malformed (giữ nguyên so sánh RAW).
    const normalizedExpectedRowVersion = normalizeInteger(expectedRowVersion);
    if (normalizedExpectedRowVersion === undefined) throw taskWriteError('TASK_VERSION_CONFLICT');
    if (task.row_version !== normalizedExpectedRowVersion) throw taskWriteError('TASK_VERSION_CONFLICT');

    if (task.status !== 'published' && task.status !== 'in_progress') throw taskWriteError('TASK_NOT_ACTIVE');

    const normalizedPercent = normalizeInteger(progressPercent);
    if (normalizedPercent === undefined || normalizedPercent < 0 || normalizedPercent > 100) {
      throw taskWriteError('TASK_PROGRESS_PERCENT_INVALID');
    }
    if (['chua_bat_dau', 'dang_thuc_hien', 'hoan_thanh'].indexOf(progressStatus) === -1) {
      throw taskWriteError('TASK_PROGRESS_STATUS_INVALID');
    }

    const oldPercent = task.progress_percent;
    const oldStatus = task.status;
    const newStatus = task.status === 'published' && normalizedPercent > 0 ? 'in_progress' : task.status;

    const updated = await client.query(
      `UPDATE task.tasks
          SET progress_percent = $1, progress_status = $2, last_progress_at = now(),
              status = $3, updated_at = now(), row_version = row_version + 1
        WHERE id = $4
        RETURNING *`,
      [normalizedPercent, progressStatus, newStatus, taskId]
    );
    const updatedTask = updated.rows[0];

    const auditToken = resolveAuditToken(actorEmployeeCode, actorAccountId);
    await client.query(
      `INSERT INTO task.events (task_id, event_type, actor_employee_code, actor_account_id, payload)
       VALUES ($1, 'progress', $2, $3, $4)`,
      [
        taskId,
        auditToken,
        actorAccountId || null,
        JSON.stringify({
          old_percent: oldPercent,
          new_percent: normalizedPercent,
          old_lifecycle_status: oldStatus,
          new_lifecycle_status: newStatus,
        }),
      ]
    );

    return updatedTask;
  });
}

// ---------------------------------------------------------------------------
// task_complete — explicit only, published/in_progress -> completed.
// completed_at LUÔN server time (now()) — không nhận từ client.
// UPDATE + INSERT event gộp 1 statement (CTE) để jsonb_build_object phía SQL
// tự serialize completed_at/deadline (timestamptz) — KHÔNG qua JS formatter.
// ---------------------------------------------------------------------------
async function completeTask(config, params) {
  const { taskId, expectedRowVersion, actorEmployeeCode, actorAccountId, resultText } = params;

  return withTaskWriteTransaction(config, async (client) => {
    const current = await client.query('SELECT * FROM task.tasks WHERE id = $1 FOR UPDATE', [taskId]);
    if (current.rowCount === 0) throw taskWriteError('TASK_NOT_FOUND');
    const task = current.rows[0];

    const normalizedExpectedRowVersion = normalizeInteger(expectedRowVersion);
    if (normalizedExpectedRowVersion === undefined) throw taskWriteError('TASK_VERSION_CONFLICT');
    if (task.row_version !== normalizedExpectedRowVersion) throw taskWriteError('TASK_VERSION_CONFLICT');

    if (task.status !== 'published' && task.status !== 'in_progress') throw taskWriteError('TASK_NOT_ACTIVE');
    if (!resultText || String(resultText).trim() === '') throw taskWriteError('TASK_COMPLETION_RESULT_REQUIRED');

    const auditToken = resolveAuditToken(actorEmployeeCode, actorAccountId);
    const updated = await client.query(
      `WITH updated AS (
         UPDATE task.tasks
            SET status = 'completed', completed_at = now(), progress_percent = 100,
                progress_status = 'hoan_thanh', updated_at = now(), row_version = row_version + 1
          WHERE id = $1
          RETURNING *
       ), inserted_event AS (
         INSERT INTO task.events (task_id, event_type, actor_employee_code, actor_account_id, payload)
         SELECT id, 'completion', $2, $3,
                jsonb_build_object(
                  'result_text', $4::text,
                  'completed_at', completed_at,
                  'on_time', completed_at <= deadline,
                  'deadline', deadline
                )
           FROM updated
         RETURNING 1
       )
       SELECT * FROM updated`,
      [taskId, auditToken, actorAccountId || null, resultText]
    );
    const updatedTask = updated.rows[0];

    return updatedTask;
  });
}

// ---------------------------------------------------------------------------
// task_reopen — completed -> in_progress. reason bắt buộc (rule N.19 gốc).
// UPDATE + INSERT event gộp 1 statement (CTE) — previous_completed_at truyền
// vào jsonb_build_object với cast ::timestamptz, Postgres tự serialize.
// ---------------------------------------------------------------------------
async function reopenTask(config, params) {
  const { taskId, expectedRowVersion, actorEmployeeCode, actorAccountId, reason } = params;

  return withTaskWriteTransaction(config, async (client) => {
    const current = await client.query('SELECT * FROM task.tasks WHERE id = $1 FOR UPDATE', [taskId]);
    if (current.rowCount === 0) throw taskWriteError('TASK_NOT_FOUND');
    const task = current.rows[0];

    const normalizedExpectedRowVersion = normalizeInteger(expectedRowVersion);
    if (normalizedExpectedRowVersion === undefined) throw taskWriteError('TASK_VERSION_CONFLICT');
    if (task.row_version !== normalizedExpectedRowVersion) throw taskWriteError('TASK_VERSION_CONFLICT');

    if (task.status !== 'completed') throw taskWriteError('TASK_NOT_COMPLETED');
    if (!reason || String(reason).trim() === '') throw taskWriteError('TASK_REOPEN_REASON_REQUIRED');

    const prevCompletedAt = task.completed_at;
    const auditToken = resolveAuditToken(actorEmployeeCode, actorAccountId);

    const updated = await client.query(
      `WITH updated AS (
         UPDATE task.tasks
            SET status = 'in_progress', completed_at = null, updated_at = now(), row_version = row_version + 1
          WHERE id = $1
          RETURNING *
       ), inserted_event AS (
         INSERT INTO task.events (task_id, event_type, actor_employee_code, actor_account_id, payload, reason)
         SELECT id, 'reopen', $2, $3,
                jsonb_build_object('previous_completed_at', $4::timestamptz),
                $5
           FROM updated
         RETURNING 1
       )
       SELECT * FROM updated`,
      [taskId, auditToken, actorAccountId || null, prevCompletedAt, reason]
    );
    const updatedTask = updated.rows[0];

    return updatedTask;
  });
}

// ---------------------------------------------------------------------------
// task_cancel — mọi status trừ draft/cancelled. completed muốn cancel phải
// reopen trước (conservative). draft dùng hard-delete riêng, không qua đây.
// Event payload chỉ có previous_status (text, không timestamp) nên giữ
// 2-statement đơn giản (giống updateTaskProgress) — không cần CTE gộp.
// ---------------------------------------------------------------------------
async function cancelTask(config, params) {
  const { taskId, expectedRowVersion, actorEmployeeCode, actorAccountId, reason } = params;

  return withTaskWriteTransaction(config, async (client) => {
    const current = await client.query('SELECT * FROM task.tasks WHERE id = $1 FOR UPDATE', [taskId]);
    if (current.rowCount === 0) throw taskWriteError('TASK_NOT_FOUND');
    const task = current.rows[0];

    const normalizedExpectedRowVersion = normalizeInteger(expectedRowVersion);
    if (normalizedExpectedRowVersion === undefined) throw taskWriteError('TASK_VERSION_CONFLICT');
    if (task.row_version !== normalizedExpectedRowVersion) throw taskWriteError('TASK_VERSION_CONFLICT');

    if (task.status === 'draft') throw taskWriteError('TASK_DRAFT_USE_DELETE');
    if (task.status === 'cancelled') throw taskWriteError('TASK_ALREADY_CANCELLED');
    if (task.status === 'completed') throw taskWriteError('TASK_MUST_REOPEN_BEFORE_CANCEL');
    if (!reason || String(reason).trim() === '') throw taskWriteError('TASK_CANCEL_REASON_REQUIRED');

    const prevStatus = task.status;

    const updated = await client.query(
      `UPDATE task.tasks
          SET status = 'cancelled', cancelled_at = now(), cancel_reason = $1, updated_at = now(), row_version = row_version + 1
        WHERE id = $2
        RETURNING *`,
      [reason, taskId]
    );
    const updatedTask = updated.rows[0];

    const auditToken = resolveAuditToken(actorEmployeeCode, actorAccountId);
    await client.query(
      `INSERT INTO task.events (task_id, event_type, actor_employee_code, actor_account_id, payload, reason)
       VALUES ($1, 'cancel', $2, $3, $4, $5)`,
      [taskId, auditToken, actorAccountId || null, JSON.stringify({ previous_status: prevStatus }), reason]
    );

    return updatedTask;
  });
}

// ---------------------------------------------------------------------------
// task_change_deadline — cancelled task immutable. reason bắt buộc. Giữ
// nguyên deadline cũ trong event payload (rule K.22 — "không mất deadline
// cũ"). UPDATE + INSERT event gộp 1 statement (CTE) — old_deadline/
// new_deadline qua jsonb_build_object phía SQL, Postgres tự serialize
// timestamptz (đúng Gap 2 pattern đã CLOSED cho completeTask/reopenTask).
// ---------------------------------------------------------------------------
async function changeTaskDeadline(config, params) {
  const { taskId, expectedRowVersion, actorEmployeeCode, actorAccountId, newDeadline, reason } = params;

  return withTaskWriteTransaction(config, async (client) => {
    const current = await client.query('SELECT * FROM task.tasks WHERE id = $1 FOR UPDATE', [taskId]);
    if (current.rowCount === 0) throw taskWriteError('TASK_NOT_FOUND');
    const task = current.rows[0];

    const normalizedExpectedRowVersion = normalizeInteger(expectedRowVersion);
    if (normalizedExpectedRowVersion === undefined) throw taskWriteError('TASK_VERSION_CONFLICT');
    if (task.row_version !== normalizedExpectedRowVersion) throw taskWriteError('TASK_VERSION_CONFLICT');

    if (task.status === 'cancelled') throw taskWriteError('TASK_CANCELLED_IMMUTABLE');
    // RPC gốc chỉ check "p_new_deadline is null" — KHÔNG validate format/kiểu
    // ở PL/pgSQL (PostgREST tự ép kiểu timestamptz ở boundary, giống hệt gap
    // đã ghi nhận cho expectedRowVersion/integer ở Batch 1). Ở đây chỉ kiểm
    // tra tương đương "null" cho JS (null/undefined/chuỗi rỗng) — KHÔNG tự
    // thêm validate định dạng ngày mới ngoài phạm vi Batch 2 đã giao.
    if (newDeadline === null || newDeadline === undefined || newDeadline === '') {
      throw taskWriteError('TASK_DEADLINE_REQUIRED');
    }
    if (!reason || String(reason).trim() === '') throw taskWriteError('TASK_DEADLINE_REASON_REQUIRED');

    const oldDeadline = task.deadline;
    const oldDeadlineVersion = task.deadline_version;
    const auditToken = resolveAuditToken(actorEmployeeCode, actorAccountId);

    const updated = await client.query(
      `WITH updated AS (
         UPDATE task.tasks
            SET deadline = $2::timestamptz, deadline_version = deadline_version + 1,
                updated_at = now(), row_version = row_version + 1
          WHERE id = $1
          RETURNING *
       ), inserted_event AS (
         INSERT INTO task.events (task_id, event_type, actor_employee_code, actor_account_id, payload, reason)
         SELECT id, 'deadline_change', $3, $4,
                jsonb_build_object(
                  'old_deadline', $5::timestamptz,
                  'new_deadline', deadline,
                  'old_deadline_version', $6::integer,
                  'new_deadline_version', deadline_version
                ),
                $7
           FROM updated
         RETURNING 1
       )
       SELECT * FROM updated`,
      [taskId, newDeadline, auditToken, actorAccountId || null, oldDeadline, oldDeadlineVersion, reason]
    );
    const updatedTask = updated.rows[0];

    return updatedTask;
  });
}

// Cùng regex verbatim đã dùng ở api/_lib/task-core.js createTaskDraft() (dòng
// idempotencyKey) — UUID sai định dạng normalize thành null và ÂM THẦM bỏ
// qua (không lỗi), GIỮ NGUYÊN hành vi nguồn, không tự "cải thiện" thành
// validate chặt hơn (chỉ định tường minh ở handoff Batch 3 mục 9).
const IDEMPOTENCY_KEY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function normalizeIdempotencyKey(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return IDEMPOTENCY_KEY_UUID_RE.test(str) ? str : null;
}

// ---------------------------------------------------------------------------
// task_create_draft V2 — dịch nguyên văn từ PHẦN 5
// scripts/PHF_TASK_CODE_IDEMPOTENCY_1.71.0.sql (bản 10-tham-số, KHÔNG dùng
// bản 9-tham-số cũ trong PHF_TASK_CORE_RPC_1.67.0.sql).
//
// Thứ tự bắt buộc giữ nguyên (đúng RPC nguồn): (1) idempotency replay lookup
// TRƯỚC mọi validate nghiệp vụ, (2) deadline required + start_at<=deadline,
// (3) category tồn tại + active (FOR SHARE backstop chống race Admin toggle),
// (4) task_next_code() cấp mã, (5) INSERT task + bắt unique_violation (race
// backstop) tự replay thay vì lỗi 500, (6) INSERT primary nếu có — KHÔNG ghi
// event nào cho draft (đúng contract Foundation hiện hữu).
// ---------------------------------------------------------------------------
async function createDraftTask(config, params) {
  const {
    flowType, title, content, categoryCode, priority,
    startAt, deadline, primaryEmployeeCode, idempotencyKey,
    actorEmployeeCode, actorAccountId,
  } = params;

  const auditToken = resolveAuditToken(actorEmployeeCode, actorAccountId);
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);

  return withTaskWriteTransaction(config, async (client) => {
    if (normalizedIdempotencyKey !== null) {
      const replay = await client.query(
        `SELECT * FROM task.tasks WHERE created_by_employee_code = $1 AND create_idempotency_key = $2 LIMIT 1`,
        [auditToken, normalizedIdempotencyKey]
      );
      if (replay.rowCount > 0) return replay.rows[0];
    }

    if (deadline === null || deadline === undefined || deadline === '') {
      throw taskWriteError('TASK_DEADLINE_REQUIRED');
    }
    if (startAt !== null && startAt !== undefined && startAt !== '' && new Date(startAt).getTime() > new Date(deadline).getTime()) {
      throw taskWriteError('TASK_DATE_ORDER_INVALID');
    }

    const category = await client.query(
      `SELECT is_active FROM task.categories WHERE category_code = $1 FOR SHARE`,
      [categoryCode]
    );
    if (category.rowCount === 0) throw taskWriteError('TASK_CATEGORY_NOT_FOUND');
    if (category.rows[0].is_active !== true) throw taskWriteError('TASK_CATEGORY_INACTIVE');

    const nextCode = await client.query('SELECT task.task_next_code(now()) AS code');
    const taskCode = nextCode.rows[0].code;

    let task;
    try {
      const inserted = await client.query(
        `INSERT INTO task.tasks (
           flow_type, status, title, content, category_code, priority,
           start_at, deadline, created_by_employee_code, task_code, create_idempotency_key
         ) VALUES ($1, 'draft', $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [flowType, title, content || '', categoryCode, priority, startAt || null, deadline, auditToken, taskCode, normalizedIdempotencyKey]
      );
      task = inserted.rows[0];
    } catch (err) {
      if (err.code === '23505' && normalizedIdempotencyKey !== null) {
        const replay = await client.query(
          `SELECT * FROM task.tasks WHERE created_by_employee_code = $1 AND create_idempotency_key = $2 LIMIT 1`,
          [auditToken, normalizedIdempotencyKey]
        );
        if (replay.rowCount > 0) return replay.rows[0];
      }
      throw err;
    }

    if (primaryEmployeeCode && String(primaryEmployeeCode).trim() !== '') {
      await client.query(
        `INSERT INTO task.assignees (task_id, employee_code, role, assigned_by_employee_code)
         VALUES ($1, $2, 'primary', $3)`,
        [task.id, primaryEmployeeCode, auditToken]
      );
    }

    return task;
  });
}

// ---------------------------------------------------------------------------
// task_publish — draft -> published, đúng 1 active primary bắt buộc. Dịch
// nguyên văn từ scripts/PHF_TASK_CORE_RPC_1.67.0.sql mục 1.
//
// DEPARTMENT SNAPSHOT (source_department/target_department/is_cross_department)
// — trigger gốc task_snapshot_department_on_publish() KHÔNG được port sang
// phf_hr (đọc public.employee_profiles, bảng KHÔNG tồn tại ở phf_hr — xác
// nhận verbatim trong comment migrations/phf_hr_task_foundation_v1.sql dòng
// 522-529: "main app already has org data via loadOrgRows() and could set
// these 3 fields itself before/at publish — a DECISION for the follow-up
// write-path gate"). Batch 3 (gate này) hiện thực hoá đúng quyết định đó:
// sourceDepartment/targetDepartment nhận vào như tham số ĐÃ ĐƯỢC RESOLVE bởi
// caller (main app, có quyền truy cập employee_profiles) — KHÔNG tự gọi
// loadOrgRows() ở đây (phf-hr-api cô lập khỏi Supabase/main app, không có
// đường nào để gọi). Điều kiện SET "CHỈ KHI source_department IS NULL" trong
// SQL bên dưới thay thế đúng guard "NEW.source_department IS NULL AND
// NEW.target_department IS NULL" của trigger gốc. Nếu caller không truyền (2
// tham số undefined/null) — 3 cột giữ NULL, đúng hành vi "1.72.0 chưa apply"
// đã có tiền lệ ở applyCrossDepartmentPublishSideEffects() (no-op sạch,
// không đoán). is_cross_department tính bằng lower-case so sánh, đúng
// nguyên văn trigger gốc (không unaccent-fold, giới hạn đã ghi nhận công
// khai ở nguồn).
// ---------------------------------------------------------------------------
async function publishTask(config, params) {
  const { taskId, expectedRowVersion, actorEmployeeCode, actorAccountId, sourceDepartment, targetDepartment } = params;

  return withTaskWriteTransaction(config, async (client) => {
    const current = await client.query('SELECT * FROM task.tasks WHERE id = $1 FOR UPDATE', [taskId]);
    if (current.rowCount === 0) throw taskWriteError('TASK_NOT_FOUND');
    const task = current.rows[0];

    const normalizedExpectedRowVersion = normalizeInteger(expectedRowVersion);
    if (normalizedExpectedRowVersion === undefined) throw taskWriteError('TASK_VERSION_CONFLICT');
    if (task.row_version !== normalizedExpectedRowVersion) throw taskWriteError('TASK_VERSION_CONFLICT');

    if (task.status !== 'draft') throw taskWriteError('TASK_NOT_DRAFT');

    const primaryCount = await client.query(
      `SELECT count(*)::int AS count FROM task.assignees WHERE task_id = $1 AND role = 'primary' AND is_active = true`,
      [taskId]
    );
    if (primaryCount.rows[0].count !== 1) throw taskWriteError('TASK_PRIMARY_REQUIRED');

    const normalizedSourceDept = sourceDepartment && String(sourceDepartment).trim() !== '' ? String(sourceDepartment).trim() : null;
    const normalizedTargetDept = targetDepartment && String(targetDepartment).trim() !== '' ? String(targetDepartment).trim() : null;
    let isCrossDepartment = null;
    if (normalizedSourceDept !== null && normalizedTargetDept !== null) {
      isCrossDepartment = normalizedSourceDept.toLowerCase() !== normalizedTargetDept.toLowerCase();
    }

    const auditToken = resolveAuditToken(actorEmployeeCode, actorAccountId);

    const updated = await client.query(
      `WITH updated AS (
         UPDATE task.tasks
            SET status = 'published', published_at = now(), updated_at = now(), row_version = row_version + 1,
                source_department = CASE WHEN source_department IS NULL THEN $2::text ELSE source_department END,
                target_department = CASE WHEN source_department IS NULL THEN $3::text ELSE target_department END,
                is_cross_department = CASE WHEN source_department IS NULL THEN $4::boolean ELSE is_cross_department END
          WHERE id = $1
          RETURNING *
       ), inserted_event AS (
         INSERT INTO task.events (task_id, event_type, actor_employee_code, actor_account_id, payload)
         SELECT id, 'published', $5, $6, jsonb_build_object('flow_type', flow_type)
           FROM updated
         RETURNING 1
       )
       SELECT * FROM updated`,
      [taskId, normalizedSourceDept, normalizedTargetDept, isCrossDepartment, auditToken, actorAccountId || null]
    );

    return updated.rows[0];
  });
}

// ---------------------------------------------------------------------------
// task_transfer_primary — A->B atomic. Dịch nguyên văn từ
// scripts/PHF_TASK_CORE_RPC_1.67.0.sql mục 7. Nếu B đang active related, tự
// deactivate related trước khi promote lên primary (tránh vi phạm unique
// index "1 active assignment/employee"). Payload không có timestamp nào ->
// giữ 2-statement đơn giản (giống cancelTask), KHÔNG cần CTE gộp.
// ---------------------------------------------------------------------------
async function transferTaskPrimary(config, params) {
  const { taskId, expectedRowVersion, actorEmployeeCode, actorAccountId, newPrimaryEmployeeCode, reason } = params;

  return withTaskWriteTransaction(config, async (client) => {
    const current = await client.query('SELECT * FROM task.tasks WHERE id = $1 FOR UPDATE', [taskId]);
    if (current.rowCount === 0) throw taskWriteError('TASK_NOT_FOUND');
    const task = current.rows[0];

    const normalizedExpectedRowVersion = normalizeInteger(expectedRowVersion);
    if (normalizedExpectedRowVersion === undefined) throw taskWriteError('TASK_VERSION_CONFLICT');
    if (task.row_version !== normalizedExpectedRowVersion) throw taskWriteError('TASK_VERSION_CONFLICT');

    if (task.status !== 'published' && task.status !== 'in_progress') throw taskWriteError('TASK_NOT_ACTIVE');
    if (!reason || String(reason).trim() === '') throw taskWriteError('TASK_TRANSFER_REASON_REQUIRED');
    const newPrimary = newPrimaryEmployeeCode && String(newPrimaryEmployeeCode).trim();
    if (!newPrimary) throw taskWriteError('TASK_TRANSFER_TARGET_REQUIRED');

    const primaryRow = await client.query(
      `SELECT employee_code FROM task.assignees WHERE task_id = $1 AND role = 'primary' AND is_active = true FOR UPDATE`,
      [taskId]
    );
    const oldPrimary = primaryRow.rowCount > 0 ? primaryRow.rows[0].employee_code : null;
    if (oldPrimary === null) throw taskWriteError('TASK_PRIMARY_NOT_FOUND');
    if (oldPrimary === newPrimary) throw taskWriteError('TASK_TRANSFER_SAME_EMPLOYEE');

    const deactivatedRelated = await client.query(
      `UPDATE task.assignees SET is_active = false, deactivated_at = now()
        WHERE task_id = $1 AND employee_code = $2 AND role = 'related' AND is_active = true`,
      [taskId, newPrimary]
    );
    const wasActiveRelated = deactivatedRelated.rowCount > 0;

    await client.query(
      `UPDATE task.assignees SET is_active = false, deactivated_at = now()
        WHERE task_id = $1 AND role = 'primary' AND is_active = true`,
      [taskId]
    );

    const auditToken = resolveAuditToken(actorEmployeeCode, actorAccountId);
    await client.query(
      `INSERT INTO task.assignees (task_id, employee_code, role, is_active, assigned_by_employee_code)
       VALUES ($1, $2, 'primary', true, $3)`,
      [taskId, newPrimary, auditToken]
    );

    const updated = await client.query(
      `UPDATE task.tasks SET updated_at = now(), row_version = row_version + 1 WHERE id = $1 RETURNING *`,
      [taskId]
    );
    const updatedTask = updated.rows[0];

    await client.query(
      `INSERT INTO task.events (task_id, event_type, actor_employee_code, actor_account_id, payload, reason)
       VALUES ($1, 'transfer', $2, $3, $4, $5)`,
      [
        taskId,
        auditToken,
        actorAccountId || null,
        JSON.stringify({ from_employee_code: oldPrimary, to_employee_code: newPrimary, was_active_related: wasActiveRelated }),
        reason,
      ]
    );

    return updatedTask;
  });
}

// ---------------------------------------------------------------------------
// task_add_related — child row + assignment event atomic và idempotent.
// Dịch nguyên văn từ scripts/PHF_TASK_CORE_RPC_1.67.0.sql mục 8. Advisory
// lock serialize cùng logical target. Nếu gặp row active hợp lệ nhưng thiếu
// event (implementation cũ fail giữa 2 call rời — KHÔNG xảy ra trên phf_hr
// vốn luôn atomic, nhưng vẫn dịch nguyên nhánh recovery để verbatim parity),
// RPC bổ sung đúng event còn thiếu thay vì insert duplicate assignment.
// ---------------------------------------------------------------------------
async function addTaskRelated(config, params) {
  const { taskId, targetEmployeeCode, actorEmployeeCode, actorAccountId } = params;

  const target = targetEmployeeCode ? String(targetEmployeeCode).trim().toUpperCase() : '';

  return withTaskWriteTransaction(config, async (client) => {
    if (!target) throw taskWriteError('TASK_RELATED_TARGET_REQUIRED');

    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`task-related|${taskId}|${target}`]);

    const primaryCheck = await client.query(
      `SELECT 1 FROM task.assignees WHERE task_id = $1 AND employee_code = $2 AND role = 'primary' AND is_active = true`,
      [taskId, target]
    );
    if (primaryCheck.rowCount > 0) throw taskWriteError('TASK_RELATED_IS_PRIMARY');

    const auditToken = resolveAuditToken(actorEmployeeCode, actorAccountId);

    const existingRelated = await client.query(
      `SELECT * FROM task.assignees WHERE task_id = $1 AND employee_code = $2 AND role = 'related' AND is_active = true
        ORDER BY assigned_at DESC LIMIT 1 FOR UPDATE`,
      [taskId, target]
    );

    if (existingRelated.rowCount > 0) {
      const assignee = existingRelated.rows[0];
      const existingEvent = await client.query(
        `SELECT e.id FROM task.events e
          WHERE e.task_id = $1 AND e.event_type = 'assignment'
            AND e.payload->>'action' = 'add' AND e.payload->>'role' = 'related' AND e.payload->>'employee_code' = $2
            AND (e.payload->>'assignee_id' = $3::text OR (e.payload->>'assignee_id' IS NULL AND e.occurred_at >= $4::timestamptz))
          ORDER BY e.occurred_at ASC LIMIT 1`,
        [taskId, target, assignee.id, assignee.assigned_at]
      );
      if (existingEvent.rowCount === 0) {
        await client.query(
          `INSERT INTO task.events (task_id, event_type, actor_employee_code, actor_account_id, payload)
           VALUES ($1, 'assignment', $2, $3, $4)`,
          [
            taskId,
            auditToken,
            actorAccountId || null,
            JSON.stringify({ action: 'add', role: 'related', employee_code: target, assignee_id: assignee.id, recovered_missing_audit: true }),
          ]
        );
      }
      return assignee;
    }

    const inserted = await client.query(
      `INSERT INTO task.assignees (task_id, employee_code, role, assigned_by_employee_code)
       VALUES ($1, $2, 'related', $3) RETURNING *`,
      [taskId, target, auditToken]
    );
    const assignee = inserted.rows[0];

    await client.query(
      `INSERT INTO task.events (task_id, event_type, actor_employee_code, actor_account_id, payload)
       VALUES ($1, 'assignment', $2, $3, $4)`,
      [
        taskId,
        auditToken,
        actorAccountId || null,
        JSON.stringify({ action: 'add', role: 'related', employee_code: target, assignee_id: assignee.id }),
      ]
    );

    return assignee;
  });
}

// ---------------------------------------------------------------------------
// removeTaskRelated — dịch nguyên văn removeTaskRelated() trong
// api/_lib/task-core.js (KHÔNG phải RPC — nguồn gốc "2 call rời" vì
// PostgREST chỉ gửi 1 statement/network call; ở đây gộp vào
// withTaskWriteTransaction để đạt ĐÚNG Ý ĐỊNH atomicity gốc, KHÔNG đổi 1
// business rule/validate/error code nào — xem migrations/
// phf_hr_task_foundation_v1.sql "Moving them keeps one language/test surface
// (JS)... native pg client, which can wrap BEGIN/.../COMMIT itself"). KHÔNG
// có CAS/row_version — nguồn gốc không có tham số này.
// ---------------------------------------------------------------------------
async function removeTaskRelated(config, params) {
  const { taskId, targetEmployeeCode, actorEmployeeCode, actorAccountId } = params;

  const target = targetEmployeeCode ? String(targetEmployeeCode).trim().toUpperCase() : '';

  return withTaskWriteTransaction(config, async (client) => {
    const updated = await client.query(
      `UPDATE task.assignees SET is_active = false, deactivated_at = now()
        WHERE task_id = $1 AND employee_code = $2 AND role = 'related' AND is_active = true
        RETURNING *`,
      [taskId, target]
    );
    if (updated.rowCount === 0) throw taskWriteError('TASK_RELATED_NOT_FOUND');
    const assignee = updated.rows[0];

    const auditToken = resolveAuditToken(actorEmployeeCode, actorAccountId);
    await client.query(
      `INSERT INTO task.events (task_id, event_type, actor_employee_code, actor_account_id, payload)
       VALUES ($1, 'assignment', $2, $3, $4)`,
      [taskId, auditToken, actorAccountId || null, JSON.stringify({ action: 'remove', role: 'related', employee_code: target })]
    );

    return assignee;
  });
}

// ---------------------------------------------------------------------------
// addTaskComment — dịch nguyên văn addTaskComment() trong api/_lib/
// task-core.js (KHÔNG phải RPC, "2 call rời" gốc — gộp transaction cùng lý
// do removeTaskRelated ở trên). task.comments KHÔNG có DB trigger
// append-only (KHÁC task.events) — GAP đã biết từ nguồn, giữ nguyên, KHÔNG
// tự thêm trigger/migration ở đây.
// ---------------------------------------------------------------------------
async function addTaskComment(config, params) {
  const { taskId, body, actorEmployeeCode, actorAccountId } = params;

  const trimmed = body ? String(body).trim() : '';

  return withTaskWriteTransaction(config, async (client) => {
    if (!trimmed) throw taskWriteError('TASK_COMMENT_BODY_REQUIRED');

    const auditToken = resolveAuditToken(actorEmployeeCode, actorAccountId);
    const inserted = await client.query(
      `INSERT INTO task.comments (task_id, author_employee_code, author_account_id, body)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [taskId, auditToken, actorAccountId || null, trimmed]
    );
    const comment = inserted.rows[0];

    await client.query(
      `INSERT INTO task.events (task_id, event_type, actor_employee_code, actor_account_id, payload)
       VALUES ($1, 'comment', $2, $3, $4)`,
      [taskId, auditToken, actorAccountId || null, JSON.stringify({ comment_id: comment.id })]
    );

    return comment;
  });
}

// ---------------------------------------------------------------------------
// task_add_link — link + audit event + related_event_id atomic. Dịch nguyên
// văn từ scripts/PHF_TASK_CORE_RPC_1.67.0.sql mục 9. Exact active logical
// link của cùng actor là idempotent. Row legacy thiếu audit được nối lại
// bằng related_event_id (nhánh recovery giữ nguyên cho verbatim parity, xem
// ghi chú addTaskRelated ở trên). side/url validate (LINK_SIDES/isValidUrl)
// là main-app pre-check trong task-core.js — KHÔNG port ở DB-layer, đúng
// nguyên tắc "permission/input validation phía main app đã chạy TRƯỚC khi
// gọi bridge" (giống flowType/title không port ở createDraftTask).
// ---------------------------------------------------------------------------
async function addTaskLink(config, params) {
  const { taskId, side, url, label, actorEmployeeCode, actorAccountId } = params;

  const normalizedLabel = label && String(label).trim() !== '' ? String(label).trim() : null;
  const normalizedUrl = String(url).trim();
  const auditToken = resolveAuditToken(actorEmployeeCode, actorAccountId);

  return withTaskWriteTransaction(config, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `task-link|${taskId}|${side}|${normalizedUrl}|${normalizedLabel || ''}|${auditToken}`,
    ]);

    const existing = await client.query(
      `SELECT l.* FROM task.links l
        WHERE l.task_id = $1 AND l.side = $2 AND trim(l.url) = $3
          AND coalesce(trim(l.label), '') = coalesce($4, '')
          AND l.added_by_employee_code = $5
          AND NOT EXISTS (
            SELECT 1 FROM task.events removed
             WHERE removed.task_id = $1 AND removed.event_type = 'link'
               AND removed.payload->>'action' = 'remove' AND removed.payload->>'link_id' = l.id::text
          )
        ORDER BY l.created_at DESC LIMIT 1 FOR UPDATE`,
      [taskId, side, normalizedUrl, normalizedLabel, auditToken]
    );

    if (existing.rowCount > 0) {
      let link = existing.rows[0];
      let eventId = link.related_event_id;

      if (!eventId) {
        const foundEvent = await client.query(
          `SELECT e.id FROM task.events e
            WHERE e.task_id = $1 AND e.event_type = 'link' AND e.payload->>'action' = 'add' AND e.payload->>'link_id' = $2::text
            ORDER BY e.occurred_at ASC LIMIT 1`,
          [taskId, link.id]
        );
        if (foundEvent.rowCount > 0) eventId = foundEvent.rows[0].id;
      }

      if (!eventId) {
        const recoveryEvent = await client.query(
          `INSERT INTO task.events (task_id, event_type, actor_employee_code, actor_account_id, payload)
           VALUES ($1, 'link', $2, $3, $4) RETURNING id`,
          [
            taskId,
            auditToken,
            actorAccountId || null,
            JSON.stringify({ action: 'add', link_id: link.id, side: link.side, url: link.url, recovered_missing_audit: true }),
          ]
        );
        eventId = recoveryEvent.rows[0].id;
      }

      if (link.related_event_id !== eventId) {
        const relinked = await client.query(
          `UPDATE task.links SET related_event_id = $2 WHERE id = $1 RETURNING *`,
          [link.id, eventId]
        );
        link = relinked.rows[0];
      }

      return link;
    }

    const inserted = await client.query(
      `INSERT INTO task.links (task_id, side, url, label, added_by_employee_code)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [taskId, side, normalizedUrl, normalizedLabel, auditToken]
    );
    let link = inserted.rows[0];

    const newEvent = await client.query(
      `INSERT INTO task.events (task_id, event_type, actor_employee_code, actor_account_id, payload)
       VALUES ($1, 'link', $2, $3, $4) RETURNING id`,
      [taskId, auditToken, actorAccountId || null, JSON.stringify({ action: 'add', link_id: link.id, side: link.side, url: link.url })]
    );

    const relinked = await client.query(
      `UPDATE task.links SET related_event_id = $2 WHERE id = $1 RETURNING *`,
      [link.id, newEvent.rows[0].id]
    );
    link = relinked.rows[0];

    return link;
  });
}

// ---------------------------------------------------------------------------
// removeTaskLink — dịch nguyên văn removeTaskLink() trong api/_lib/
// task-core.js (KHÔNG phải RPC — "Xóa" = event action='remove', KHÔNG
// hard-delete/update row task.links, giữ đúng "không làm mất dấu rằng link
// từng tồn tại"). Gộp transaction cùng lý do removeTaskRelated ở trên.
// ---------------------------------------------------------------------------
async function removeTaskLink(config, params) {
  const { taskId, linkId, actorEmployeeCode, actorAccountId } = params;

  return withTaskWriteTransaction(config, async (client) => {
    const found = await client.query('SELECT * FROM task.links WHERE id = $1 AND task_id = $2', [linkId, taskId]);
    if (found.rowCount === 0) throw taskWriteError('TASK_LINK_NOT_FOUND');
    const link = found.rows[0];

    const auditToken = resolveAuditToken(actorEmployeeCode, actorAccountId);
    await client.query(
      `INSERT INTO task.events (task_id, event_type, actor_employee_code, actor_account_id, payload)
       VALUES ($1, 'link', $2, $3, $4)`,
      [taskId, auditToken, actorAccountId || null, JSON.stringify({ action: 'remove', link_id: link.id, side: link.side, url: link.url })]
    );

    return { removed: true, link_id: link.id };
  });
}

// ---------------------------------------------------------------------------
// task_set_permission_assignment — dịch nguyên văn từ
// scripts/PHF_TASK_PERMISSION_V1_TARGETED_1.69.0.sql PHẦN 3 (verbatim từ
// PHF_TASK_FOUNDATION_CORRECTION_1.68.0.sql dòng 208-291). UPSERT/REPLACE:
// deactivate mọi assignment active cũ khớp account_id HOẶC employee_code
// (ghi history 'deactivate' cho từng dòng), rồi insert 1 dòng active mới
// (ghi history 'assign'). KHÔNG có CAS/row_version — nguồn không có tham số
// này. Permission/scope (Admin-only) KHÔNG kiểm tra ở đây — đúng nguyên tắc
// đã ghi trong chính RPC gốc, main app enforce TRƯỚC khi gọi (
// requireTaskPermissionAdmin() trong api/_lib/task-core.js) — KHÔNG tự thêm
// authorization/tự mở scope ở phf-hr-api.
// ---------------------------------------------------------------------------
const TASK_PERMISSION_PRESET_CODES = ['GIAM_DOC', 'TRO_LY_GD', 'TRUONG_BO_PHAN', 'TRUONG_CA', 'NHAN_VIEN'];

async function setTaskPermissionAssignment(config, params) {
  const { targetAccountId, targetEmployeeCode, presetCode, reason, actorAccountId, actorEmployeeCode } = params;

  const normTargetAccountId = targetAccountId && String(targetAccountId).trim() !== '' ? String(targetAccountId).trim() : null;
  const normTargetEmployeeCode = targetEmployeeCode && String(targetEmployeeCode).trim() !== '' ? String(targetEmployeeCode).trim().toUpperCase() : null;
  if (normTargetAccountId === null && normTargetEmployeeCode === null) throw taskWriteError('TASK_PERMISSION_ASSIGNMENT_TARGET_REQUIRED');

  const normPresetCode = presetCode && String(presetCode).trim() !== '' ? String(presetCode).trim().toUpperCase() : null;
  if (normPresetCode === null || TASK_PERMISSION_PRESET_CODES.indexOf(normPresetCode) === -1) {
    throw taskWriteError('TASK_PERMISSION_PRESET_INVALID');
  }

  const normReason = reason && String(reason).trim() !== '' ? String(reason).trim() : null;
  if (normReason === null) throw taskWriteError('TASK_PERMISSION_REASON_REQUIRED');

  const normActorAccountId = actorAccountId && String(actorAccountId).trim() !== '' ? String(actorAccountId).trim() : null;
  const normActorEmployeeCode = actorEmployeeCode && String(actorEmployeeCode).trim() !== '' ? String(actorEmployeeCode).trim().toUpperCase() : null;
  if (normActorAccountId === null && normActorEmployeeCode === null) throw taskWriteError('TASK_PERMISSION_ACTOR_REQUIRED');

  return withTaskWriteTransaction(config, async (client) => {
    const nowResult = await client.query('SELECT now() AS now');
    const vNow = nowResult.rows[0].now;

    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `task-base-preset|${normTargetAccountId || ''}|${normTargetEmployeeCode || ''}`,
    ]);

    const deactivated = await client.query(
      `UPDATE task.permission_assignments
          SET is_active = false, effective_to = $1::timestamptz, updated_at = $1::timestamptz
        WHERE is_active = true AND (
          ($2::text IS NOT NULL AND account_id = $2) OR
          ($3::text IS NOT NULL AND upper(employee_code) = $3)
        )
        RETURNING *`,
      [vNow, normTargetAccountId, normTargetEmployeeCode]
    );

    for (const previous of deactivated.rows) {
      await client.query(
        `INSERT INTO task.permission_assignment_history (
           assignment_id, action, before_data, after_data, reason, changed_by_account_id, changed_by_employee_code
         ) VALUES ($1, 'deactivate', $2, $3, $4, $5, $6)`,
        [
          previous.id,
          JSON.stringify(previous),
          JSON.stringify({ is_active: false, effective_to: vNow }),
          normReason,
          normActorAccountId,
          normActorEmployeeCode,
        ]
      );
    }

    const inserted = await client.query(
      `INSERT INTO task.permission_assignments (
         account_id, employee_code, preset_code, effective_from, effective_to,
         is_active, reason, assigned_by_account_id, assigned_by_employee_code
       ) VALUES ($1, $2, $3, $4::timestamptz, NULL, true, $5, $6, $7)
       RETURNING *`,
      [normTargetAccountId, normTargetEmployeeCode, normPresetCode, vNow, normReason, normActorAccountId, normActorEmployeeCode]
    );
    const assignment = inserted.rows[0];

    await client.query(
      `INSERT INTO task.permission_assignment_history (
         assignment_id, action, before_data, after_data, reason, changed_by_account_id, changed_by_employee_code
       ) VALUES ($1, 'assign', $2, $3, $4, $5, $6)`,
      [assignment.id, '{}', JSON.stringify(assignment), normReason, normActorAccountId, normActorEmployeeCode]
    );

    return assignment;
  });
}

module.exports = {
  updateTaskProgress,
  completeTask,
  reopenTask,
  cancelTask,
  changeTaskDeadline,
  createDraftTask,
  publishTask,
  transferTaskPrimary,
  addTaskRelated,
  removeTaskRelated,
  addTaskComment,
  addTaskLink,
  removeTaskLink,
  setTaskPermissionAssignment,
};
