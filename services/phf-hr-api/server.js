'use strict';

// PHF HR API — skeleton foundation (TASK-SERVER-02D).
//
// Mục đích vòng này: chứng minh đường kết nối
//   browser → /api/data (KHÔNG ĐỔI) → [tương lai] phf-hr-api → Supabase DEV
// hoạt động thật, với auth server-to-service riêng — KHÔNG wire bất kỳ
// business logic Task nào vào đây. Không dùng framework (Express...) — giữ
// đúng convention "zero dependency" của repo chính (server.js gốc cũng dùng
// http thuần).
//
// KHÔNG chạy service này production/deploy trong bước này — chỉ local test.

const http = require('http');
const { loadConfig } = require('./lib/config');
const logger = require('./lib/logger');
const { requireServiceToken } = require('./lib/auth-middleware');
const { probeTaskRead } = require('./lib/supabase-dev');
const { listTaskCategories, getTaskById, TaskReadError } = require('./lib/task-read');
// IN-APP NOTIFICATION V1 — read/mark (Company PG only). Recipient identity is
// resolved by the MAIN APP from the session and passed in; this layer is
// scoped to that one employee and never lists/marks anyone else's rows.
const {
  listNotificationsForRecipient,
  markNotificationsRead,
  markAllNotificationsRead,
  TaskNotificationError,
} = require('./lib/task-notification-read');
const { executeResolvedTaskQuery } = require('./lib/task-query-executor');
const { executeResolvedTaskOverviewQuery } = require('./lib/task-overview-query-executor');
const {
  updateTaskProgress, completeTask, reopenTask, cancelTask, changeTaskDeadline,
  createDraftTask, publishTask,
  transferTaskPrimary, addTaskRelated, removeTaskRelated,
  addTaskComment, addTaskLink, removeTaskLink,
  setTaskPermissionAssignment,
  // Gate 12 — Category CRUD + Exception-grant CRUD. Route wiring below follows
  // the same pattern as every prior batch (Bearer service token only, no
  // in-service authorization, actor passed through verbatim).
  createTaskCategory, renameTaskCategory, setTaskCategoryActive,
  reorderTaskCategory, deleteTaskCategoryIfUnused,
  createTaskPermissionGrant, revokeTaskPermissionGrant,
  emitTaskNotification,
  // Proposal V2 (2026-08-29, LOCAL/THROWAWAY ONLY) — accept/reject/cancel
  // trên task.proposal_decisions (xem lib/task-write.js). publishTask ở
  // trên KHÔNG đổi tên/param cũ, chỉ nhận thêm recipientEmployeeCode
  // (optional, chỉ dùng khi flow_type='de_xuat').
  acceptTaskProposal, rejectTaskProposal, cancelTaskProposal,
} = require('./lib/task-write');
// PHF Task — RECURRENCE V1 (2026-08-31, LOCAL ONLY). The engine + schema are
// LOCKED (services/phf-hr-api/lib/task-recurrence.js +
// migrations/phf_hr_task_recurrence_v1.sql, real-DB matrix 31/31 PASS on the
// throwaway phf_hr_e2e). These routes are a THIN 1:1 mapping to that proven
// engine — NO business logic, NO re-validation at the route layer, same
// discipline as every batch below. Company PostgreSQL only, never Supabase.
const {
  createRule: createRecurrenceRule,
  updateRule: updateRecurrenceRule,
  transitionRule: transitionRecurrenceRule,
  listRules: listRecurrenceRules,
  generateDue: generateRecurrenceDue,
  runRule: runRecurrenceRule,
} = require('./lib/task-recurrence');
// PHF Task — CANCEL POLICY V1 (2026-08-31). PostgreSQL-only "Yêu cầu hủy"
// request flow (migrations/phf_hr_task_cancel_request_v1.sql). Same thin-route
// discipline as every batch below; authorization decided upstream.
const {
  submitCancelRequest: submitTaskCancelRequest,
  decideCancelRequest: decideTaskCancelRequest,
} = require('./lib/task-cancel-request');
// Gate 5.6 — attachment orchestration (G5.5 CLOSED, hash
// fd58d08a393c70f0e70fdb699292006a32847ad09564fb00a96d383b83f297b0). Route
// layer CHỈ gọi orchestrator, KHÔNG tự chạm filesystem/DB attachment nào.
const { uploadAttachment, removeAttachment, downloadAttachment } = require('./lib/attachment-service');
const { MAX_FILE_SIZE } = require('./lib/attachment-policy');

// Batch 1-6 write-path route matcher — path style ":id:verb" (custom-method,
// KHÔNG phải "/id/verb") theo đúng S3B contract authoritative (KHÔNG dùng
// biến thể "/progress" từng ghi ở S4 implementation planning — S3B có
// precedence). ([^/:]+) chặn '/' và ':' trong id, khớp UUID.
// TASK_CREATE_RE không có capture group — create KHÔNG có :id (chưa có
// task nào để định danh trước khi tạo), đúng contract "POST /v1/task/tasks:create".
const TASK_UPDATE_PROGRESS_RE = /^\/v1\/task\/tasks\/([^/:]+):updateProgress$/;
const TASK_COMPLETE_RE = /^\/v1\/task\/tasks\/([^/:]+):complete$/;
const TASK_REOPEN_RE = /^\/v1\/task\/tasks\/([^/:]+):reopen$/;
const TASK_CANCEL_RE = /^\/v1\/task\/tasks\/([^/:]+):cancel$/;
const TASK_CHANGE_DEADLINE_RE = /^\/v1\/task\/tasks\/([^/:]+):changeDeadline$/;
const TASK_CREATE_RE = /^\/v1\/task\/tasks:create$/;
const TASK_PUBLISH_RE = /^\/v1\/task\/tasks\/([^/:]+):publish$/;

// Proposal V2 (2026-08-29, LOCAL/THROWAWAY ONLY) — resource identifier là
// proposal_task_id (= task.tasks.id của Proposal gốc, flow_type='de_xuat'),
// cùng path style ":id:verb" như mọi route task-id-scoped khác.
const TASK_PROPOSAL_ACCEPT_RE = /^\/v1\/task\/tasks\/([^/:]+):acceptProposal$/;
const TASK_PROPOSAL_REJECT_RE = /^\/v1\/task\/tasks\/([^/:]+):rejectProposal$/;

// CANCEL POLICY V1 — same ":id:verb" custom-method style. :id = task id.
const TASK_REQUEST_CANCEL_RE = /^\/v1\/task\/tasks\/([^/:]+):requestCancel$/;
const TASK_DECIDE_CANCEL_REQUEST_RE = /^\/v1\/task\/tasks\/([^/:]+):decideCancelRequest$/;
const TASK_PROPOSAL_CANCEL_RE = /^\/v1\/task\/tasks\/([^/:]+):cancelProposal$/;

// Batch 4-6 — verb đặt tên theo ĐÚNG transformation rule đã dùng nhất quán
// từ Batch 3 (tên hàm task-write.js bỏ tiền tố/hậu tố "Task", camelCase phần
// còn lại: createDraftTask -> :create, publishTask -> :publish). Áp dụng máy
// móc cho 6 hàm còn task-id-scoped: transferTaskPrimary -> :transferPrimary,
// addTaskRelated -> :addRelated, removeTaskRelated -> :removeRelated,
// addTaskComment -> :addComment, addTaskLink -> :addLink, removeTaskLink ->
// :removeLink. KHÔNG có tài liệu S3B riêng cho Batch 4-6 route path (khác
// create/publish vốn có handoff CLOSED tường minh) — đây là suy ra NHẤT
// QUÁN từ 1 rule cơ giới đã CLOSED, không phải business contract mới.
const TASK_TRANSFER_PRIMARY_RE = /^\/v1\/task\/tasks\/([^/:]+):transferPrimary$/;
const TASK_ADD_RELATED_RE = /^\/v1\/task\/tasks\/([^/:]+):addRelated$/;
const TASK_REMOVE_RELATED_RE = /^\/v1\/task\/tasks\/([^/:]+):removeRelated$/;
const TASK_ADD_COMMENT_RE = /^\/v1\/task\/tasks\/([^/:]+):addComment$/;
const TASK_ADD_LINK_RE = /^\/v1\/task\/tasks\/([^/:]+):addLink$/;
const TASK_REMOVE_LINK_RE = /^\/v1\/task\/tasks\/([^/:]+):removeLink$/;

// Cross-department notification (2026-08-27, đóng OPEN GAP) — cùng path
// style ":id:verb" như mọi write route task-id-scoped khác. Main app
// (publishTaskViaServer()) tự resolve recipient/title/message/dedupeKey
// (resolveCrossDepartmentNotificationRecipient()) TRƯỚC khi gọi route này —
// route/DB-layer chỉ ghi, không tự quyết ai nhận (xem lib/task-write.js's
// emitTaskNotification()).
const TASK_NOTIFY_RE = /^\/v1\/task\/tasks\/([^/:]+):notify$/;

// setTaskPermissionAssignment KHÔNG có taskId (gán preset cho 1 người, không
// gắn với Task cụ thể nào — đúng signature task-write.js/RPC nguồn) nên
// KHÔNG thể dùng path "/v1/task/tasks/:id:verb". Route dưới đây là 1 RESOURCE
// PATH MỚI (chưa từng có tiền lệ Batch 1-3) — đây LÀ điểm cần xác nhận rõ
// ràng trước deploy, xem BATCH_4_6_ROUTE_WIRING_REPORT mục "NEW_RESOURCE_PATH".
const TASK_PERMISSION_ASSIGNMENT_SET_RE = /^\/v1\/task\/permission-assignments:set$/;

// Gate 12 — Category CRUD + Exception-grant CRUD. Neither resource is
// task-id-scoped, so path style mirrors TASK_PERMISSION_ASSIGNMENT_SET_RE
// above (the only existing precedent for a non-task-scoped write resource),
// not the "/v1/task/tasks/:id:verb" style. :code / :id below are the
// resource's own identifier (category_code / grant id), same role as :id
// plays for tasks.
const TASK_CATEGORY_CREATE_RE = /^\/v1\/task\/categories:create$/;
const TASK_CATEGORY_RENAME_RE = /^\/v1\/task\/categories\/([^/:]+):rename$/;
const TASK_CATEGORY_SET_ACTIVE_RE = /^\/v1\/task\/categories\/([^/:]+):setActive$/;
const TASK_CATEGORY_REORDER_RE = /^\/v1\/task\/categories\/([^/:]+):reorder$/;
const TASK_CATEGORY_DELETE_RE = /^\/v1\/task\/categories\/([^/:]+):delete$/;
const TASK_PERMISSION_GRANT_CREATE_RE = /^\/v1\/task\/permission-grants:create$/;
const TASK_PERMISSION_GRANT_REVOKE_RE = /^\/v1\/task\/permission-grants\/([^/:]+):revoke$/;

// RECURRENCE V1 — resource path `/v1/task/recurrence`, same non-task-scoped
// convention as `/v1/task/categories` / `/v1/task/permission-grants`. `:id` is
// the rule's own id. `:run` is the idempotent scheduler entrypoint (custom
// method, same ":verb" style as everywhere else). [^/:]+ blocks '/' and ':'
// so `:pause` / `:resume` / `:stop` / `:run` never collide with the bare
// `/:id` (PATCH) or the collection (`/recurrence`) routes.
const TASK_RECURRENCE_COLLECTION_RE = /^\/v1\/task\/recurrence$/;      // POST create | GET list
const TASK_RECURRENCE_RUN_RE = /^\/v1\/task\/recurrence:run$/;         // POST — generate due occurrences
const TASK_RECURRENCE_ITEM_RE = /^\/v1\/task\/recurrence\/([^/:]+)$/;  // PATCH — edit (future occurrences only)
const TASK_RECURRENCE_PAUSE_RE = /^\/v1\/task\/recurrence\/([^/:]+):pause$/;
const TASK_RECURRENCE_RESUME_RE = /^\/v1\/task\/recurrence\/([^/:]+):resume$/;
const TASK_RECURRENCE_STOP_RE = /^\/v1\/task\/recurrence\/([^/:]+):stop$/;

// Gate 5.6 — attachment routes, path đã CLOSED ở G5.2 (KHÔNG redesign):
// upload/remove dùng custom-method ":verb" style giống Batch 1-6; download
// là GET resource path THẬT (không phải custom-method) vì đây là đọc 1 object
// cụ thể theo id, không phải 1 action — đúng phân biệt REST đã dùng nhất
// quán trong repo (GET /v1/task/categories cũng là resource path, không có ":").
const TASK_UPLOAD_ATTACHMENT_RE = /^\/v1\/task\/tasks\/([^/:]+):uploadAttachment$/;
const TASK_REMOVE_ATTACHMENT_RE = /^\/v1\/task\/tasks\/([^/:]+):removeAttachment$/;
const TASK_DOWNLOAD_ATTACHMENT_RE = /^\/v1\/task\/tasks\/([^/:]+)\/attachments\/([^/:]+)$/;
// SINGLE TASK READ FOUNDATION (2026-08-27) — [^/:]+ chặn cả '/' lẫn ':' nên
// KHÔNG khớp nhầm path download (.../attachments/...) hay bất kỳ custom-
// method POST nào (...:verb) — chỉ khớp đúng GET /v1/task/tasks/<id> trần.
const TASK_GET_BY_ID_RE = /^\/v1\/task\/tasks\/([^/:]+)$/;

// Gate 5.6 — status map cho lỗi attachment, audit verbatim từ 3 module đã
// CLOSED (attachment-policy.js/attachment-storage.js/attachment-service.js/
// task-write.js phần attachment). KHÔNG invent code mới — chỉ gán statusCode
// cho code ĐÃ tồn tại. Message của các error này (attachmentStorageError/
// orchestrationError) đã tự PUBLIC-SAFE theo thiết kế gốc (không chứa OS
// path/SQL detail) — route chỉ forward err.message nguyên văn, KHÔNG thêm xử
// lý gì khác.
const ATTACHMENT_ERROR_STATUS = {
  // attachment-storage.js (ATTACHMENT_STORAGE_*)
  ATTACHMENT_STORAGE_INVALID_TASK_ID: 400,
  ATTACHMENT_STORAGE_INVALID_ACTOR: 400,
  ATTACHMENT_STORAGE_INVALID_IDEMPOTENCY_KEY: 400,
  ATTACHMENT_STORAGE_PATH_ESCAPE: 400,
  ATTACHMENT_STORAGE_TOO_LARGE: 400,
  ATTACHMENT_STORAGE_OBJECT_NOT_FOUND: 404,
  ATTACHMENT_STORAGE_WRITE_FAILED: 500,
  ATTACHMENT_STORAGE_READ_FAILED: 500,
  ATTACHMENT_STORAGE_RECLAIM_NOT_ALLOWED: 500,
  // attachment-service.js (ATTACHMENT_ORCHESTRATION_*)
  ATTACHMENT_ORCHESTRATION_STORAGE_ROOT_REQUIRED: 500,
  ATTACHMENT_ORCHESTRATION_FILENAME_REQUIRED: 400,
  ATTACHMENT_ORCHESTRATION_MIME_INVALID: 400,
  ATTACHMENT_ORCHESTRATION_EXTENSION_REQUIRED: 400,
  ATTACHMENT_ORCHESTRATION_MIME_EXTENSION_MISMATCH: 400,
  ATTACHMENT_ORCHESTRATION_STREAM_REQUIRED: 400,
  ATTACHMENT_ORCHESTRATION_EMPTY_FILE: 400,
  ATTACHMENT_ORCHESTRATION_UPLOAD_IN_PROGRESS: 409,
  ATTACHMENT_ORCHESTRATION_LIMIT_REACHED: 409,
  ATTACHMENT_ORCHESTRATION_METADATA_FAILED_AFTER_PUBLISH: 500,
  // task-write.js (TASK_ATTACHMENT_*)
  TASK_ATTACHMENT_TASK_ID_REQUIRED: 400,
  TASK_ATTACHMENT_ID_REQUIRED: 400,
  TASK_ATTACHMENT_OBJECT_KEY_REQUIRED: 400,
  TASK_ATTACHMENT_FILENAME_REQUIRED: 400,
  TASK_ATTACHMENT_EXTENSION_REQUIRED: 400,
  TASK_ATTACHMENT_MIME_INVALID: 400,
  TASK_ATTACHMENT_MIME_EXTENSION_MISMATCH: 400,
  TASK_ATTACHMENT_SIZE_INVALID: 400,
  TASK_ATTACHMENT_TOO_LARGE: 400,
  TASK_ATTACHMENT_CHECKSUM_INVALID: 400,
  TASK_ATTACHMENT_ACTOR_REQUIRED: 401,
  TASK_ATTACHMENT_NOT_FOUND: 404,
  TASK_ATTACHMENT_ALREADY_REMOVED: 409,
};

// Copy nguyên giá trị từ RPC_ERROR_MAP (api/_lib/task-core.js) — KHÔNG import
// trực tiếp file đó (thuộc main app, không nằm trong Docker image của
// phf-hr-api, và bị cấm sửa) — chỉ lấy đúng statusCode cho đúng các mã đã
// audit verbatim khớp S3A/S3B, KHÔNG thêm/đổi mã nào. 8 mã đầu = Batch 1
// (không đổi), 7 mã kế = Batch 2, 5 mã kế = Batch 3, 13 mã cuối = Batch 4-6
// mới thêm (TASK_NOT_FOUND/TASK_VERSION_CONFLICT/TASK_NOT_ACTIVE dùng
// chung, không lặp lại).
const TASK_WRITE_ERROR_STATUS = {
  TASK_NOT_FOUND: 404,
  TASK_VERSION_CONFLICT: 409,
  TASK_NOT_ACTIVE: 409,
  TASK_PROGRESS_PERCENT_INVALID: 400,
  TASK_PROGRESS_STATUS_INVALID: 400,
  TASK_COMPLETION_RESULT_REQUIRED: 400,
  TASK_NOT_COMPLETED: 409,
  TASK_REOPEN_REASON_REQUIRED: 400,
  TASK_DRAFT_USE_DELETE: 409,
  TASK_ALREADY_CANCELLED: 409,
  TASK_MUST_REOPEN_BEFORE_CANCEL: 409,
  TASK_CANCEL_REASON_REQUIRED: 400,
  TASK_CANCELLED_IMMUTABLE: 409,
  TASK_DEADLINE_REQUIRED: 400,
  TASK_DEADLINE_REASON_REQUIRED: 400,
  TASK_DATE_ORDER_INVALID: 400,
  TASK_CATEGORY_NOT_FOUND: 400,
  TASK_CATEGORY_INACTIVE: 400,
  TASK_NOT_DRAFT: 409,
  TASK_PRIMARY_REQUIRED: 400,
  TASK_TRANSFER_REASON_REQUIRED: 400,
  TASK_TRANSFER_TARGET_REQUIRED: 400,
  TASK_PRIMARY_NOT_FOUND: 409,
  TASK_TRANSFER_SAME_EMPLOYEE: 400,
  TASK_RELATED_TARGET_REQUIRED: 400,
  TASK_RELATED_IS_PRIMARY: 400,
  TASK_RELATED_NOT_FOUND: 404,
  TASK_COMMENT_BODY_REQUIRED: 400,
  TASK_LINK_NOT_FOUND: 404,
  TASK_PERMISSION_ASSIGNMENT_TARGET_REQUIRED: 400,
  TASK_PERMISSION_PRESET_INVALID: 400,
  TASK_PERMISSION_REASON_REQUIRED: 400,
  TASK_PERMISSION_ACTOR_REQUIRED: 401,

  // Defence-in-depth backstop for the LOCKED AUTHORITY RULE (2026-08-28) —
  // a non-creator lifecycle mutation arrived without a recognised intervention
  // basis stamped by the main-app authorization gate
  // (api/_lib/task-permissions.js). Mirrors TASK_UPDATE_DENIED's 403.
  TASK_INTERVENTION_AUTHORITY_REQUIRED: 403,

  // Gate 12 — Category CRUD. 11 of these 15 have direct evidence in
  // api/_lib/task-core.js (exact code+status match at its fail() call
  // sites); the 4 *_GRANT_*_REQUIRED codes were explicit Technical Lead
  // decisions (don't exist in task-core.js at all — Gate12's task-write.js
  // introduced them as new names, not a verbatim port).
  //
  // TASK_CATEGORY_NOT_FOUND is intentionally kept at 400 here, UNCHANGED
  // from before Gate12 — this is the Batch-3 createDraftTask contract
  // (category referenced in a create-task body doesn't exist -> bad input
  // field, real-DB-verified, has its own passing regression test:
  // ERROR_MAPPING_batch3_5_new_codes). Gate12's Category CRUD functions
  // (rename/setActive/reorder/delete, all resource-addressed by :code) were
  // corrected in lib/task-write.js to throw the DISTINCT
  // TASK_CATEGORY_RESOURCE_NOT_FOUND instead of reusing this code — Technical
  // Lead Option C, chosen specifically to avoid a single error-code string
  // needing two different statuses depending on caller.
  TASK_CATEGORY_CODE_INVALID: 400,
  TASK_CATEGORY_NAME_REQUIRED: 400,
  TASK_CATEGORY_CODE_EXISTS: 409,
  TASK_CATEGORY_RESOURCE_NOT_FOUND: 404, // Gate12 Category CRUD only (:code resource lookup) — distinct from TASK_CATEGORY_NOT_FOUND
  TASK_CATEGORY_ACTIVE_INVALID: 400,
  TASK_CATEGORY_SORT_ORDER_INVALID: 400,
  TASK_CATEGORY_IN_USE: 409,

  // Gate 12 — Exception-grant CRUD.
  TASK_PERMISSION_GRANT_GRANTEE_REQUIRED: 400, // Technical Lead decision — no source equivalent
  TASK_PERMISSION_GRANT_SCOPE_REQUIRED: 400, // Technical Lead decision — no source equivalent
  TASK_PERMISSION_GRANT_REASON_REQUIRED: 400, // Technical Lead decision — no source equivalent
  TASK_PERMISSION_GRANT_ACTOR_REQUIRED: 400, // Technical Lead decision — no source equivalent
  TASK_PERMISSION_GRANT_ID_INVALID: 400,
  TASK_PERMISSION_GRANT_NOT_FOUND: 404,
  TASK_PERMISSION_REVOKE_TYPE_NOT_SUPPORTED: 400,
  TASK_PERMISSION_GRANT_ALREADY_REVOKED: 409,

  // Cross-department notification (2026-08-27) — mirror của
  // TASK_PERMISSION_GRANT_*_REQUIRED style (Technical decision, không có
  // source-of-truth Supabase tương đương vì Supabase path không validate qua
  // route HTTP riêng — emitTaskNotification() nội bộ chỉ return {created:0}
  // khi thiếu field, KHÔNG throw; route/DB-layer phf_hr này chặt chẽ hơn vì
  // là entrypoint HTTP công khai, cần phản hồi lỗi rõ ràng cho caller).
  TASK_NOTIFICATION_RECIPIENT_REQUIRED: 400,
  TASK_NOTIFICATION_TITLE_REQUIRED: 400,
  TASK_NOTIFICATION_MESSAGE_REQUIRED: 400,

  // Proposal V2 (2026-08-29, LOCAL/THROWAWAY ONLY) — new codes, no Supabase
  // RPC equivalent (this is a brand-new PostgreSQL-only write path, see
  // migrations/phf_hr_task_proposal_v2.sql). TASK_NOT_FOUND/TASK_PRIMARY_
  // REQUIRED/TASK_TITLE_REQUIRED/TASK_DEADLINE_REQUIRED/TASK_DATE_ORDER_
  // INVALID/TASK_CATEGORY_NOT_FOUND/TASK_CATEGORY_INACTIVE reuse the exact
  // codes+statuses already mapped above (acceptTaskProposal validates the
  // new Task with the same invariants as createDraftTask).
  TASK_PROPOSAL_RECIPIENT_REQUIRED: 400,
  TASK_PROPOSAL_NOT_FOUND: 404,
  TASK_PROPOSAL_ALREADY_DECIDED: 409,
  TASK_PROPOSAL_ACTOR_DENIED: 403,
  TASK_PROPOSAL_REJECT_REASON_REQUIRED: 400,

  // CANCEL POLICY V1 (2026-08-31)
  TASK_CANCEL_REQUEST_REASON_REQUIRED: 400,
  TASK_CANCEL_REQUEST_PENDING_EXISTS: 409,
  TASK_CANCEL_REQUEST_NOT_FOUND: 404,
  TASK_CANCEL_REQUEST_ALREADY_DECIDED: 409,
  TASK_CANCEL_REQUEST_ACTOR_DENIED: 403,
  TASK_CANCEL_REQUEST_DECISION_INVALID: 400,
  TASK_CANCEL_REQUEST_UNSUPPORTED: 409,
  TASK_CANCEL_REQUEST_REQUIRED: 403,
  TASK_PROPOSAL_CANCEL_REASON_REQUIRED: 400,
};

// RECURRENCE V1 — every code below is thrown verbatim by
// services/phf-hr-api/lib/task-recurrence.js (rcErr()). TASK_CATEGORY_NOT_FOUND
// / TASK_CATEGORY_INACTIVE are reused from TASK_WRITE_ERROR_STATUS (the engine
// validates the category against task.categories exactly like createDraftTask).
const RECURRENCE_ERROR_STATUS = {
  RECURRENCE_TITLE_REQUIRED: 400,
  RECURRENCE_CATEGORY_REQUIRED: 400,
  RECURRENCE_PRIMARY_REQUIRED: 400,
  RECURRENCE_START_DATE_INVALID: 400,
  RECURRENCE_START_HOUR_INVALID: 400,
  RECURRENCE_START_MINUTE_INVALID: 400,
  RECURRENCE_DURATION_INVALID: 400,
  RECURRENCE_FREQUENCY_INVALID: 400,
  RECURRENCE_WEEKDAY_INVALID: 400,
  RECURRENCE_DAY_OF_MONTH_INVALID: 400,
  RECURRENCE_END_CONDITION_INVALID: 400,
  RECURRENCE_END_DATE_INVALID: 400,
  RECURRENCE_END_BEFORE_START: 400,
  RECURRENCE_MAX_OCCURRENCES_INVALID: 400,
  RECURRENCE_MAX_OCCURRENCES_UNSUPPORTED: 409,
  RECURRENCE_ACTOR_REQUIRED: 401,
  RECURRENCE_RULE_NOT_FOUND: 404,
  RECURRENCE_RULE_ENDED: 409,
  RECURRENCE_RULE_NOT_ACTIVE: 409,
  RECURRENCE_RULE_NOT_PAUSED: 409,
  RECURRENCE_RULE_ALREADY_ENDED: 409,
  RECURRENCE_TRANSITION_INVALID: 400,
};

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('BODY_TOO_LARGE'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(Object.assign(new Error('BODY_NOT_JSON'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

// Envelope { ok:false, code, message } — riêng cho 3 route Batch 1 write-path
// (khác envelope { error } của route đọc hiện có — theo đúng chỉ định
// Technical Lead cho riêng nhóm route mới này, KHÔNG đổi route cũ).
function sendTaskWriteError(res, statusCode, code, message) {
  return sendJson(res, statusCode, { ok: false, code, message });
}

// Success envelope { ok:true, data } — đối xứng với error envelope đã chỉ
// định tường minh (ok discriminant) — KHÔNG có đặc tả success schema riêng
// từ S3B trong lượt này, chọn hình thức tối thiểu nhất quán với error
// envelope thay vì phát minh cấu trúc khác không có căn cứ.
async function handleTaskWriteOperation(config, res, path, operationFn, args) {
  try {
    const result = await operationFn(config, args);
    return sendJson(res, 200, { ok: true, data: result });
  } catch (err) {
    const statusCode = TASK_WRITE_ERROR_STATUS[err.code];
    if (statusCode) {
      logger.warn('task_write_rejected', { path, code: err.code });
      return sendTaskWriteError(res, statusCode, err.code, err.message);
    }
    // KHÔNG lộ chi tiết DB/internal ra ngoài — chỉ log server-side.
    logger.error('task_write_unexpected_error', { path, message: err.message });
    return sendTaskWriteError(res, 500, 'TASK_WRITE_ERROR', 'Lỗi hệ thống khi ghi Task.');
  }
}

// RECURRENCE V1 — same success/error envelope as handleTaskWriteOperation
// ({ ok:true, data } / { ok:false, code, message }). operationFn is invoked
// with no `config`-prepended contract: caller passes a zero-arg thunk that
// already closed over config + args, because the engine's signatures vary
// (createRule(config,input,actor) vs generateDue(config,options) …).
async function handleRecurrenceOperation(res, path, thunk) {
  try {
    const result = await thunk();
    return sendJson(res, 200, { ok: true, data: result });
  } catch (err) {
    const statusCode = RECURRENCE_ERROR_STATUS[err.code] || TASK_WRITE_ERROR_STATUS[err.code];
    if (statusCode) {
      logger.warn('recurrence_rejected', { path, code: err.code });
      return sendTaskWriteError(res, statusCode, err.code, err.message);
    }
    logger.error('recurrence_unexpected_error', { path, message: err.message });
    return sendTaskWriteError(res, 500, 'RECURRENCE_ERROR', 'Lỗi hệ thống khi xử lý lịch lặp.');
  }
}

// Gate 5.6 — error mapper riêng cho attachment routes (upload/remove/
// download-trước-headers). Cùng envelope { ok:false, code, message } đã dùng
// cho task write-path — KHÔNG phát minh envelope mới.
function sendAttachmentError(res, path, err) {
  const statusCode = ATTACHMENT_ERROR_STATUS[err.code];
  if (statusCode) {
    logger.warn('attachment_operation_rejected', { path, code: err.code });
    return sendTaskWriteError(res, statusCode, err.code, err.message);
  }
  // Unknown -> safe 500, KHÔNG lộ err.message (có thể chứa cause/detail nội
  // bộ với typed error KHÔNG nằm trong ATTACHMENT_ERROR_STATUS) — khác hẳn
  // nhánh known-code ở trên (message của các code đã biết ĐÃ public-safe
  // theo thiết kế gốc từng module).
  logger.error('attachment_operation_unexpected_error', { path, code: err.code, message: err.message });
  return sendTaskWriteError(res, 500, 'ATTACHMENT_ERROR', 'Lỗi hệ thống khi xử lý đính kèm.');
}

// Whitelist tường minh — KHÔNG BAO GIỜ trả stored_object_key/finalPath/
// tempPath/absolute filesystem path ra ngoài (đã chỉ định tường minh ở G5.6
// UPLOAD ROUTE mục 8). Dùng chung cho cả response upload lẫn remove.
function publicAttachmentView(attachment) {
  return {
    id: attachment.id,
    taskId: attachment.task_id,
    originalFilename: attachment.original_filename,
    mimeType: attachment.mime_type,
    extension: attachment.extension,
    sizeBytes: attachment.size_bytes,
    checksumSha256: attachment.checksum_sha256,
    uploadedByEmployeeCode: attachment.uploaded_by_employee_code,
    status: attachment.status,
    createdAt: attachment.created_at,
    deletedAt: attachment.deleted_at || null,
    deletedByEmployeeCode: attachment.deleted_by_employee_code || null,
  };
}

// RFC 5987 filename* + ASCII fallback filename — an toàn cho tên file có dấu
// tiếng Việt/ký tự đặc biệt, KHÔNG thêm dependency ngoài Node core.
function buildContentDisposition(originalFilename) {
  const raw = String(originalFilename || 'attachment');
  const asciiFallback = raw.replace(/["\\]/g, '_').replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(raw)}`;
}

async function handleAttachmentUpload(config, res, path, args) {
  try {
    const { attachment, replayed } = await uploadAttachment(config, args);
    return sendJson(res, 200, { ok: true, data: Object.assign(publicAttachmentView(attachment), { replayed: !!replayed }) });
  } catch (err) {
    return sendAttachmentError(res, path, err);
  }
}

async function handleAttachmentRemove(config, res, path, args) {
  try {
    const attachment = await removeAttachment(config, args);
    return sendJson(res, 200, { ok: true, data: publicAttachmentView(attachment) });
  } catch (err) {
    return sendAttachmentError(res, path, err);
  }
}

// Download KHÔNG dùng handleTaskWriteOperation (không phải JSON response) —
// tự pipe stream. Lỗi TRƯỚC writeHead() (lookup DB/stat file thất bại) ->
// vẫn an toàn gửi JSON error envelope. Lỗi SAU khi đã writeHead() (đọc file
// lỗi giữa chừng) -> KHÔNG được gửi thêm JSON, HTTP response đã bắt đầu
// (header framing không cho phép đổi ý) — CHỈ res.destroy() để cắt kết nối,
// client nhận response không đầy đủ (đúng giới hạn giao thức HTTP, KHÔNG
// phải bug) — log server-side đầy đủ để debug.
async function handleAttachmentDownload(config, res, path, args) {
  let attachment;
  let stream;
  let stat;
  try {
    ({ attachment, stream, stat } = await downloadAttachment(config, args));
  } catch (err) {
    return sendAttachmentError(res, path, err);
  }

  res.writeHead(200, {
    'Content-Type': attachment.mime_type,
    'Content-Disposition': buildContentDisposition(attachment.original_filename),
    'Content-Length': stat.size,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });

  stream.on('error', (streamErr) => {
    logger.error('attachment_download_stream_error_after_headers_sent', { path, message: streamErr.message });
    res.destroy(streamErr);
  });
  stream.pipe(res);
}

function createServer(config) {
  const authCheck = requireServiceToken(config.SERVICE_TOKEN);
  const startedAt = Date.now();
  // Gate 5.6A — PHF_HR_ATTACHMENT_ROOT nay là validated config field
  // (lib/config.js: bắt buộc non-empty, absolute, normalized, không phải
  // filesystem root — loadConfig() đã FAIL BOOT ở main() nếu thiếu/sai,
  // KHÔNG cần server.js tự validate lại). KHÔNG đọc process.env trực tiếp ở
  // đây nữa — chỉ dùng giá trị đã qua loadConfig(), đúng chỉ định G5.6A.
  const attachmentStorageRoot = config.PHF_HR_ATTACHMENT_ROOT;

  const server = http.createServer(async (req, res) => {
    const requestStart = Date.now();
    const url = new URL(req.url, 'http://internal');
    const path = url.pathname;

    res.on('finish', () => {
      logger.info('request', {
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: Date.now() - requestStart,
      });
    });

    try {
      // ---------------------------------------------------------------
      // GET /healthz — liveness, PUBLIC, không đụng DB (kỳ vọng luôn nhanh,
      // dùng cho health check probe/load balancer sau này trên server).
      // ---------------------------------------------------------------
      if (req.method === 'GET' && path === '/healthz') {
        return sendJson(res, 200, {
          status: 'ok',
          service: 'phf-hr-api',
          uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
          target: 'PHF-HR-DEV',
        });
      }

      // ---------------------------------------------------------------
      // GET /diag/dev-probe — readiness/connectivity probe, YÊU CẦU Bearer
      // token riêng của service (không phải session cookie người dùng).
      // Đọc-only, chứng minh kết nối Supabase DEV hoạt động thật.
      // ---------------------------------------------------------------
      if (req.method === 'GET' && path === '/diag/dev-probe') {
        const auth = authCheck(req);
        if (!auth.authorized) {
          logger.warn('auth_denied', { path, reason: auth.reason });
          return sendJson(res, 401, { error: auth.reason });
        }
        const result = await probeTaskRead(config);
        return sendJson(res, 200, result);
      }

      // ---------------------------------------------------------------
      // GET /v1/task/categories — Official Task Read API. Bearer bắt buộc,
      // chỉ SELECT. KHÔNG CORS (browser gọi thẳng tự bị chặn same-origin).
      // ---------------------------------------------------------------
      if (req.method === 'GET' && path === '/v1/task/categories') {
        const auth = authCheck(req);
        if (!auth.authorized) {
          logger.warn('auth_denied', { path, reason: auth.reason });
          return sendJson(res, 401, { error: auth.reason });
        }
        const result = await listTaskCategories(config);
        return sendJson(res, 200, result);
      }

      // ---------------------------------------------------------------
      // IN-APP NOTIFICATION V1 — Company-PG read/mark. Bearer service token
      // only (server-to-service, like every route). The MAIN APP has already
      // authorised the session and resolves `recipientEmployeeCode` from it —
      // this route is scoped to that one employee and can neither list nor
      // mark anyone else's rows.
      //   GET  /v1/task/notifications?recipientEmployeeCode=&limit=
      //   POST /v1/task/notifications:markRead     { recipientEmployeeCode, ids }
      //   POST /v1/task/notifications:markAllRead  { recipientEmployeeCode }
      // ---------------------------------------------------------------
      {
        const isNotifList = req.method === 'GET' && path === '/v1/task/notifications';
        const isNotifMark = req.method === 'POST' && path === '/v1/task/notifications:markRead';
        const isNotifMarkAll = req.method === 'POST' && path === '/v1/task/notifications:markAllRead';
        if (isNotifList || isNotifMark || isNotifMarkAll) {
          const auth = authCheck(req);
          if (!auth.authorized) {
            logger.warn('auth_denied', { path, reason: auth.reason });
            return sendJson(res, 401, { error: auth.reason });
          }
          try {
            if (isNotifList) {
              const result = await listNotificationsForRecipient(config, {
                recipientEmployeeCode: url.searchParams.get('recipientEmployeeCode'),
                recipientAccountId: url.searchParams.get('recipientAccountId'),
                limit: url.searchParams.get('limit'),
              });
              return sendJson(res, 200, result);
            }
            const body = await readJsonBody(req, 65536);
            if (isNotifMark) {
              const result = await markNotificationsRead(config, { recipientEmployeeCode: body.recipientEmployeeCode, recipientAccountId: body.recipientAccountId, ids: body.ids });
              return sendJson(res, 200, { ok: true, data: result });
            }
            const result = await markAllNotificationsRead(config, { recipientEmployeeCode: body.recipientEmployeeCode, recipientAccountId: body.recipientAccountId });
            return sendJson(res, 200, { ok: true, data: result });
          } catch (err) {
            if (err instanceof TaskNotificationError) {
              logger.warn('task_notification_rejected', { path, code: err.code });
              return sendTaskWriteError(res, err.statusCode || 500, err.code, err.message || err.code);
            }
            logger.error('task_notification_unexpected_error', { path, message: err && err.message });
            return sendTaskWriteError(res, 500, 'TASK_NOTIFICATION_ERROR', 'Lỗi hệ thống khi xử lý Thông báo.');
          }
        }
      }

      // ---------------------------------------------------------------
      // GET /v1/task/tasks/:id — SINGLE TASK READ FOUNDATION (2026-08-27).
      // Bearer bắt buộc, chỉ SELECT. Trả state THÔ (raw snake_case, không
      // camelCase như /v1/task/categories) — mục đích DUY NHẤT là làm state
      // source cho seam validate/authorize phía main app (xem comment đầy đủ
      // trong lib/task-read.js::getTaskById()). KHÔNG chứa authorization/
      // permission logic gì ở route này — main app tự quyết dùng state trả
      // về ra sao, đúng nguyên tắc S3B đã CLOSED.
      // Đặt TRƯỚC route download (:id/attachments/:attachmentId) vì đó là
      // path cụ thể hơn — path.match() cả 2 regex đều anchor ^...$ nên không
      // xung đột, thứ tự không ảnh hưởng, nhưng đặt route ngắn hơn trước cho
      // dễ đọc.
      // ---------------------------------------------------------------
      {
        const getTaskMatch = req.method === 'GET' ? path.match(TASK_GET_BY_ID_RE) : null;
        if (getTaskMatch) {
          const auth = authCheck(req);
          if (!auth.authorized) {
            logger.warn('auth_denied', { path, reason: auth.reason });
            return sendJson(res, 401, { error: auth.reason });
          }
          const result = await getTaskById(config, getTaskMatch[1]);
          if (!result.task) {
            return sendJson(res, 404, { error: 'TASK_NOT_FOUND', message: 'Không tìm thấy task.' });
          }
          return sendJson(res, 200, { data: result });
        }
      }

      // ---------------------------------------------------------------
      // GET /v1/task/tasks/:id/attachments/:attachmentId — Gate 5.6 download.
      // Resource path THẬT (không phải custom-method ":verb") — path :id +
      // :attachmentId authoritative, KHÔNG có body. Stream response — xem
      // handleAttachmentDownload() cho chi tiết boundary lỗi trước/sau
      // writeHead().
      // ---------------------------------------------------------------
      {
        const downloadMatch = req.method === 'GET' ? path.match(TASK_DOWNLOAD_ATTACHMENT_RE) : null;
        if (downloadMatch) {
          const auth = authCheck(req);
          if (!auth.authorized) {
            logger.warn('auth_denied', { path, reason: auth.reason });
            return sendJson(res, 401, { error: auth.reason });
          }
          return handleAttachmentDownload(config, res, path, {
            taskId: downloadMatch[1],
            attachmentId: downloadMatch[2],
            storageRoot: attachmentStorageRoot,
          });
        }
      }

      // ---------------------------------------------------------------
      // POST /v1/task/tasks — Descriptor-aware Task Read (thay hoàn toàn
      // GET flat "SELECT * FROM task_tasks LIMIT 200" trước đây — bản flat
      // đã bị audit xác nhận actor-blind/over-broad, KHÔNG được phép tồn
      // tại song song làm fallback). Yêu cầu 2 lớp xác thực độc lập:
      //   (1) Bearer SERVICE_TOKEN — server nào được phép gọi (như cũ).
      //   (2) RESOLVED_TASK_QUERY_DESCRIPTOR_V1 ký HMAC — request cụ thể
      //       này có được main app resolve/ký hợp lệ hay không.
      // FAIL-CLOSED tuyệt đối: bất kỳ lỗi nào ở (1), (2), body malformed,
      // hay thiếu DESCRIPTOR_SIGNING_SECRET ở tầng config → trả lỗi rõ ràng,
      // KHÔNG BAO GIỜ fallback về trả toàn bộ/1 phần task_tasks.
      // ---------------------------------------------------------------
      if (req.method === 'POST' && path === '/v1/task/tasks') {
        const auth = authCheck(req);
        if (!auth.authorized) {
          logger.warn('auth_denied', { path, reason: auth.reason });
          return sendJson(res, 401, { error: auth.reason });
        }
        if (!config.DESCRIPTOR_SIGNING_SECRET) {
          logger.error('descriptor_signing_secret_missing', { path });
          return sendJson(res, 500, { error: 'DESCRIPTOR_SIGNING_SECRET_NOT_CONFIGURED' });
        }
        let body;
        try {
          body = await readJsonBody(req, 65536);
        } catch (err) {
          return sendJson(res, err.statusCode || 400, { error: err.message || 'BODY_INVALID' });
        }
        const descriptor = body && body.descriptor;
        if (!descriptor || typeof descriptor !== 'object') {
          return sendJson(res, 400, { error: 'DESCRIPTOR_MISSING' });
        }
        try {
          const result = await executeResolvedTaskQuery(config, descriptor, config.DESCRIPTOR_SIGNING_SECRET);
          return sendJson(res, 200, result);
        } catch (err) {
          logger.warn('descriptor_rejected_or_query_failed', { path, code: err.code, message: err.message });
          return sendJson(res, err.statusCode || 400, { error: err.code || 'TASK_QUERY_FAILED', message: err.message });
        }
      }

      // ---------------------------------------------------------------
      // POST /v1/task/overview — Reporting V2 (Tổng quan) population read.
      // Sibling of "POST /v1/task/tasks" above — SAME 2-layer auth (Bearer
      // service token + HMAC-signed RESOLVED_TASK_OVERVIEW_QUERY_DESCRIPTOR_V1),
      // SAME fail-closed contract, DIFFERENT payload shape (see
      // task-overview-query-executor.js header comment for why this is a
      // sibling file, not a modification of task-query-executor.js).
      // ---------------------------------------------------------------
      if (req.method === 'POST' && path === '/v1/task/overview') {
        const auth = authCheck(req);
        if (!auth.authorized) {
          logger.warn('auth_denied', { path, reason: auth.reason });
          return sendJson(res, 401, { error: auth.reason });
        }
        if (!config.DESCRIPTOR_SIGNING_SECRET) {
          logger.error('descriptor_signing_secret_missing', { path });
          return sendJson(res, 500, { error: 'DESCRIPTOR_SIGNING_SECRET_NOT_CONFIGURED' });
        }
        let body;
        try {
          body = await readJsonBody(req, 65536);
        } catch (err) {
          return sendJson(res, err.statusCode || 400, { error: err.message || 'BODY_INVALID' });
        }
        const descriptor = body && body.descriptor;
        if (!descriptor || typeof descriptor !== 'object') {
          return sendJson(res, 400, { error: 'DESCRIPTOR_MISSING' });
        }
        try {
          const result = await executeResolvedTaskOverviewQuery(config, descriptor, config.DESCRIPTOR_SIGNING_SECRET);
          return sendJson(res, 200, result);
        } catch (err) {
          logger.warn('overview_descriptor_rejected_or_query_failed', { path, code: err.code, message: err.message });
          return sendJson(res, err.statusCode || 400, { error: err.code || 'TASK_OVERVIEW_QUERY_FAILED', message: err.message });
        }
      }

      // ---------------------------------------------------------------
      // Batch 1 + Batch 2 write-path — POST /v1/task/tasks/:id:updateProgress
      // |:complete|:reopen|:cancel|:changeDeadline
      // S3B contract (authoritative): Bearer service token (auth SERVER-TO-
      // SERVICE, giống mọi route khác) — KHÔNG tự resolve session, KHÔNG
      // chạy lại permission/scope logic (đã chạy Ở MAIN APP trước khi gọi
      // bridge này). taskId lấy từ path :id (nguồn xác thực định danh
      // resource của route) — body.taskId (nếu client gửi kèm) KHÔNG được
      // dùng để override/so khớp, KHÔNG có mismatch-check nào được thêm mới
      // (đúng chỉ định "giữ mapping tối thiểu, không tự thêm business
      // behavior mới" — nếu cần precedence khác, đây là điểm cần GO riêng).
      // ---------------------------------------------------------------
      if (req.method === 'POST') {
        const updateProgressMatch = path.match(TASK_UPDATE_PROGRESS_RE);
        const completeMatch = path.match(TASK_COMPLETE_RE);
        const reopenMatch = path.match(TASK_REOPEN_RE);
        const cancelMatch = path.match(TASK_CANCEL_RE);
        const changeDeadlineMatch = path.match(TASK_CHANGE_DEADLINE_RE);
        const createMatch = path.match(TASK_CREATE_RE);
        const publishMatch = path.match(TASK_PUBLISH_RE);
        const transferPrimaryMatch = path.match(TASK_TRANSFER_PRIMARY_RE);
        const addRelatedMatch = path.match(TASK_ADD_RELATED_RE);
        const removeRelatedMatch = path.match(TASK_REMOVE_RELATED_RE);
        const addCommentMatch = path.match(TASK_ADD_COMMENT_RE);
        const addLinkMatch = path.match(TASK_ADD_LINK_RE);
        const removeLinkMatch = path.match(TASK_REMOVE_LINK_RE);
        const notifyMatch = path.match(TASK_NOTIFY_RE);
        const setPermissionAssignmentMatch = path.match(TASK_PERMISSION_ASSIGNMENT_SET_RE);
        const categoryCreateMatch = path.match(TASK_CATEGORY_CREATE_RE);
        const categoryRenameMatch = path.match(TASK_CATEGORY_RENAME_RE);
        const categorySetActiveMatch = path.match(TASK_CATEGORY_SET_ACTIVE_RE);
        const categoryReorderMatch = path.match(TASK_CATEGORY_REORDER_RE);
        const categoryDeleteMatch = path.match(TASK_CATEGORY_DELETE_RE);
        const permissionGrantCreateMatch = path.match(TASK_PERMISSION_GRANT_CREATE_RE);
        const permissionGrantRevokeMatch = path.match(TASK_PERMISSION_GRANT_REVOKE_RE);
        const proposalAcceptMatch = path.match(TASK_PROPOSAL_ACCEPT_RE);
        const proposalRejectMatch = path.match(TASK_PROPOSAL_REJECT_RE);
        const proposalCancelMatch = path.match(TASK_PROPOSAL_CANCEL_RE);
        const requestCancelMatch = path.match(TASK_REQUEST_CANCEL_RE);
        const decideCancelRequestMatch = path.match(TASK_DECIDE_CANCEL_REQUEST_RE);

        if (
          updateProgressMatch || completeMatch || reopenMatch || cancelMatch || changeDeadlineMatch || createMatch || publishMatch ||
          transferPrimaryMatch || addRelatedMatch || removeRelatedMatch || addCommentMatch || addLinkMatch || removeLinkMatch ||
          notifyMatch ||
          setPermissionAssignmentMatch ||
          categoryCreateMatch || categoryRenameMatch || categorySetActiveMatch || categoryReorderMatch || categoryDeleteMatch ||
          permissionGrantCreateMatch || permissionGrantRevokeMatch ||
          proposalAcceptMatch || proposalRejectMatch || proposalCancelMatch ||
          requestCancelMatch || decideCancelRequestMatch
        ) {
          const auth = authCheck(req);
          if (!auth.authorized) {
            logger.warn('auth_denied', { path, reason: auth.reason });
            return sendTaskWriteError(res, 401, 'UNAUTHORIZED', auth.reason);
          }

          let body;
          try {
            body = await readJsonBody(req, 65536);
          } catch (err) {
            return sendTaskWriteError(res, err.statusCode || 400, 'BODY_INVALID', err.message || 'BODY_INVALID');
          }
          body = body || {};
          const actor = body.actor || {};

          if (updateProgressMatch) {
            const args = {
              taskId: updateProgressMatch[1],
              expectedRowVersion: body.expectedRowVersion,
              actorEmployeeCode: actor.employeeCode,
              actorAccountId: actor.accountId,
              progressPercent: body.progressPercent,
              progressStatus: body.progressStatus,
            };
            return handleTaskWriteOperation(config, res, path, updateTaskProgress, args);
          }

          if (completeMatch) {
            const args = {
              taskId: completeMatch[1],
              expectedRowVersion: body.expectedRowVersion,
              actorEmployeeCode: actor.employeeCode,
              actorAccountId: actor.accountId,
              resultText: body.resultText,
            };
            return handleTaskWriteOperation(config, res, path, completeTask, args);
          }

          if (reopenMatch) {
            const args = {
              taskId: reopenMatch[1],
              expectedRowVersion: body.expectedRowVersion,
              actorEmployeeCode: actor.employeeCode,
              actorAccountId: actor.accountId,
              interventionBasis: actor.interventionBasis,
              reason: body.reason,
            };
            return handleTaskWriteOperation(config, res, path, reopenTask, args);
          }

          if (cancelMatch) {
            const args = {
              taskId: cancelMatch[1],
              expectedRowVersion: body.expectedRowVersion,
              actorEmployeeCode: actor.employeeCode,
              actorAccountId: actor.accountId,
              interventionBasis: actor.interventionBasis,
              reason: body.reason,
            };
            return handleTaskWriteOperation(config, res, path, cancelTask, args);
          }

          if (changeDeadlineMatch) {
            const args = {
              taskId: changeDeadlineMatch[1],
              expectedRowVersion: body.expectedRowVersion,
              actorEmployeeCode: actor.employeeCode,
              actorAccountId: actor.accountId,
              interventionBasis: actor.interventionBasis,
              newDeadline: body.newDeadline,
              reason: body.reason,
            };
            return handleTaskWriteOperation(config, res, path, changeTaskDeadline, args);
          }

          // Batch 3 — POST /v1/task/tasks:create — mapping tối thiểu, KHÔNG
          // validate lại business logic ở route (deadline/category/idempotency
          // đã enforce trong createDraftTask DB-layer, verbatim từ RPC nguồn).
          if (createMatch) {
            const args = {
              flowType: body.flowType,
              title: body.title,
              content: body.content,
              categoryCode: body.categoryCode,
              priority: body.priority,
              startAt: body.startAt,
              deadline: body.deadline,
              primaryEmployeeCode: body.primaryEmployeeCode,
              idempotencyKey: body.idempotencyKey,
              actorEmployeeCode: actor.employeeCode,
              actorAccountId: actor.accountId,
            };
            return handleTaskWriteOperation(config, res, path, createDraftTask, args);
          }

          // Batch 3 — POST /v1/task/tasks/:id:publish — path :id authoritative
          // (đúng convention Batch 1-2, body.taskId nếu có KHÔNG được dùng).
          // sourceDepartment/targetDepartment: đã CLOSED — main app resolve
          // (actorContext.department + department của primary active tại thời
          // điểm publish qua loadOrgRows() bên phía main app) rồi truyền
          // xuống nguyên văn; phf-hr-api KHÔNG tự lookup employee_profiles
          // (bảng không tồn tại ở phf_hr). Thiếu field nào -> null, KHÔNG
          // block publish (đúng contract đã CLOSED).
          if (publishMatch) {
            const args = {
              taskId: publishMatch[1],
              expectedRowVersion: body.expectedRowVersion,
              actorEmployeeCode: actor.employeeCode,
              actorAccountId: actor.accountId,
              sourceDepartment: body.sourceDepartment,
              targetDepartment: body.targetDepartment,
              // Proposal V2 — chỉ có ý nghĩa khi task flow_type='de_xuat';
              // publishTask() tự bỏ qua field này cho flow_type='giao_viec'
              // (xem lib/task-write.js). undefined nếu caller không gửi.
              recipientEmployeeCode: body.recipientEmployeeCode,
            };
            return handleTaskWriteOperation(config, res, path, publishTask, args);
          }

          // Proposal V2 — POST /v1/task/tasks/:id:acceptProposal|
          // :rejectProposal|:cancelProposal. :id = proposal_task_id (Proposal
          // gốc). Mapping tối thiểu 1:1 với tham số task-write.js, KHÔNG
          // validate lại business logic ở route (đúng convention mọi route
          // write khác trong file này).
          if (proposalAcceptMatch) {
            const args = {
              proposalTaskId: proposalAcceptMatch[1],
              actorEmployeeCode: actor.employeeCode,
              actorAccountId: actor.accountId,
              title: body.title,
              content: body.content,
              categoryCode: body.categoryCode,
              priority: body.priority,
              startAt: body.startAt,
              deadline: body.deadline,
              primaryEmployeeCode: body.primaryEmployeeCode,
            };
            return handleTaskWriteOperation(config, res, path, acceptTaskProposal, args);
          }

          if (proposalRejectMatch) {
            const args = {
              proposalTaskId: proposalRejectMatch[1],
              actorEmployeeCode: actor.employeeCode,
              actorAccountId: actor.accountId,
              reason: body.reason,
            };
            return handleTaskWriteOperation(config, res, path, rejectTaskProposal, args);
          }

          if (proposalCancelMatch) {
            const args = {
              proposalTaskId: proposalCancelMatch[1],
              actorEmployeeCode: actor.employeeCode,
              actorAccountId: actor.accountId,
              reason: body.reason,
            };
            return handleTaskWriteOperation(config, res, path, cancelTaskProposal, args);
          }

          // CANCEL POLICY V1 — POST /v1/task/tasks/:id:requestCancel
          // (active primary submits) and :decideCancelRequest (body.decision =
          // approve | reject | withdraw). Authorization + interventionBasis are
          // resolved by the main app; this route maps 1:1.
          if (requestCancelMatch) {
            const args = {
              taskId: requestCancelMatch[1],
              reason: body.reason,
              actorEmployeeCode: actor.employeeCode,
              actorAccountId: actor.accountId,
              // IN-APP NOTIFICATION V1 — the authorised direct-cancel reviewers,
              // resolved by the MAIN APP's permission graph and passed through
              // 1:1 (this route never derives authority). Optional; the creator
              // is always notified regardless (resolved in-transaction).
              reviewerRecipients: Array.isArray(body.reviewerRecipients) ? body.reviewerRecipients : undefined,
            };
            return handleTaskWriteOperation(config, res, path, submitTaskCancelRequest, args);
          }

          if (decideCancelRequestMatch) {
            const args = {
              taskId: decideCancelRequestMatch[1],
              decision: body.decision,
              note: body.note,
              expectedRowVersion: body.expectedRowVersion,
              interventionBasis: actor.interventionBasis,
              actorEmployeeCode: actor.employeeCode,
              actorAccountId: actor.accountId,
            };
            return handleTaskWriteOperation(config, res, path, decideTaskCancelRequest, args);
          }

          // Batch 4 — POST /v1/task/tasks/:id:transferPrimary — path :id
          // authoritative. Mapping 1:1 tham số task-write.js transferTaskPrimary
          // (đã real-DB verify PASS), KHÔNG validate lại business logic ở route.
          if (transferPrimaryMatch) {
            const args = {
              taskId: transferPrimaryMatch[1],
              expectedRowVersion: body.expectedRowVersion,
              actorEmployeeCode: actor.employeeCode,
              actorAccountId: actor.accountId,
              interventionBasis: actor.interventionBasis,
              newPrimaryEmployeeCode: body.newPrimaryEmployeeCode,
              reason: body.reason,
            };
            return handleTaskWriteOperation(config, res, path, transferTaskPrimary, args);
          }

          // Batch 4 — POST /v1/task/tasks/:id:addRelated
          if (addRelatedMatch) {
            const args = {
              taskId: addRelatedMatch[1],
              targetEmployeeCode: body.targetEmployeeCode,
              actorEmployeeCode: actor.employeeCode,
              actorAccountId: actor.accountId,
              interventionBasis: actor.interventionBasis,
            };
            return handleTaskWriteOperation(config, res, path, addTaskRelated, args);
          }

          // Batch 4 — POST /v1/task/tasks/:id:removeRelated — KHÔNG có
          // expectedRowVersion (source-of-truth removeTaskRelated không có CAS).
          if (removeRelatedMatch) {
            const args = {
              taskId: removeRelatedMatch[1],
              targetEmployeeCode: body.targetEmployeeCode,
              actorEmployeeCode: actor.employeeCode,
              actorAccountId: actor.accountId,
              interventionBasis: actor.interventionBasis,
            };
            return handleTaskWriteOperation(config, res, path, removeTaskRelated, args);
          }

          // Batch 5 — POST /v1/task/tasks/:id:addComment — KHÔNG có
          // expectedRowVersion (source-of-truth addTaskComment không có CAS).
          if (addCommentMatch) {
            const args = {
              taskId: addCommentMatch[1],
              body: body.body,
              actorEmployeeCode: actor.employeeCode,
              actorAccountId: actor.accountId,
            };
            return handleTaskWriteOperation(config, res, path, addTaskComment, args);
          }

          // Batch 5 — POST /v1/task/tasks/:id:addLink
          if (addLinkMatch) {
            const args = {
              taskId: addLinkMatch[1],
              side: body.side,
              url: body.url,
              label: body.label,
              actorEmployeeCode: actor.employeeCode,
              actorAccountId: actor.accountId,
            };
            return handleTaskWriteOperation(config, res, path, addTaskLink, args);
          }

          // Batch 5 — POST /v1/task/tasks/:id:removeLink — KHÔNG có
          // expectedRowVersion (source-of-truth removeTaskLink không có CAS).
          if (removeLinkMatch) {
            const args = {
              taskId: removeLinkMatch[1],
              linkId: body.linkId,
              actorEmployeeCode: actor.employeeCode,
              actorAccountId: actor.accountId,
            };
            return handleTaskWriteOperation(config, res, path, removeTaskLink, args);
          }

          // Cross-department notification (2026-08-27) — POST
          // /v1/task/tasks/:id:notify. recipientAccountId/recipientEmployeeCode/
          // title/message/targetPath/priority/dedupeKey ĐÃ được main app tự
          // resolve xong (resolveCrossDepartmentNotificationRecipient()) —
          // route này KHÔNG tự quyết ai nhận, chỉ pass-through + ghi.
          if (notifyMatch) {
            const args = {
              taskId: notifyMatch[1],
              recipientAccountId: body.recipientAccountId,
              recipientEmployeeCode: body.recipientEmployeeCode,
              title: body.title,
              message: body.message,
              targetPath: body.targetPath,
              priority: body.priority,
              dedupeKey: body.dedupeKey,
            };
            return handleTaskWriteOperation(config, res, path, emitTaskNotification, args);
          }

          // Batch 6 — POST /v1/task/permission-assignments:set — KHÔNG có
          // taskId (setTaskPermissionAssignment gán preset cho 1 người, không
          // gắn Task cụ thể — đúng source RPC). target là account HOẶC
          // employee (ít nhất 1), KHÔNG phải path :id — route path này KHÔNG
          // có tiền lệ Batch 1-3, xem ghi chú tại TASK_PERMISSION_ASSIGNMENT_SET_RE.
          if (setPermissionAssignmentMatch) {
            const args = {
              targetAccountId: body.targetAccountId,
              targetEmployeeCode: body.targetEmployeeCode,
              presetCode: body.presetCode,
              reason: body.reason,
              actorAccountId: actor.accountId,
              actorEmployeeCode: actor.employeeCode,
            };
            return handleTaskWriteOperation(config, res, path, setTaskPermissionAssignment, args);
          }

          // Gate 12 — POST /v1/task/categories:create — no :code (category
          // doesn't exist yet). Mapping 1:1 to createTaskCategory params,
          // same minimal-mapping discipline as every batch above (no
          // business-logic re-validation at the route layer).
          if (categoryCreateMatch) {
            const args = {
              categoryCode: body.categoryCode,
              displayName: body.displayName,
              actorAccountId: actor.accountId,
              actorEmployeeCode: actor.employeeCode,
            };
            return handleTaskWriteOperation(config, res, path, createTaskCategory, args);
          }

          // Gate 12 — POST /v1/task/categories/:code:rename — path :code
          // authoritative (same convention as :id for tasks); body.categoryCode
          // (if sent) is NOT used to override/mismatch-check.
          if (categoryRenameMatch) {
            const args = {
              categoryCode: categoryRenameMatch[1],
              displayName: body.displayName,
              actorAccountId: actor.accountId,
              actorEmployeeCode: actor.employeeCode,
            };
            return handleTaskWriteOperation(config, res, path, renameTaskCategory, args);
          }

          // Gate 12 — POST /v1/task/categories/:code:setActive
          if (categorySetActiveMatch) {
            const args = {
              categoryCode: categorySetActiveMatch[1],
              isActive: body.isActive,
              actorAccountId: actor.accountId,
              actorEmployeeCode: actor.employeeCode,
            };
            return handleTaskWriteOperation(config, res, path, setTaskCategoryActive, args);
          }

          // Gate 12 — POST /v1/task/categories/:code:reorder
          if (categoryReorderMatch) {
            const args = {
              categoryCode: categoryReorderMatch[1],
              sortOrder: body.sortOrder,
              actorAccountId: actor.accountId,
              actorEmployeeCode: actor.employeeCode,
            };
            return handleTaskWriteOperation(config, res, path, reorderTaskCategory, args);
          }

          // Gate 12 — POST /v1/task/categories/:code:delete — deleteTaskCategoryIfUnused
          // only takes categoryCode (no actor — it does not write any audit
          // column, see lib/task-write.js), so no actor mapping here.
          if (categoryDeleteMatch) {
            const args = { categoryCode: categoryDeleteMatch[1] };
            return handleTaskWriteOperation(config, res, path, deleteTaskCategoryIfUnused, args);
          }

          // Gate 12 — POST /v1/task/permission-grants:create — no :id (grant
          // doesn't exist yet). peopleScope passed through verbatim as an
          // object (main app has already resolved/validated its shape,
          // same "no re-validation at route layer" discipline as everywhere
          // else in this file).
          if (permissionGrantCreateMatch) {
            const args = {
              granteeEmployeeCode: body.granteeEmployeeCode,
              peopleScope: body.peopleScope,
              reason: body.reason,
              actorAccountId: actor.accountId,
              actorEmployeeCode: actor.employeeCode,
            };
            return handleTaskWriteOperation(config, res, path, createTaskPermissionGrant, args);
          }

          // Gate 12 — POST /v1/task/permission-grants/:id:revoke — path :id
          // authoritative (grant id).
          if (permissionGrantRevokeMatch) {
            const args = {
              grantId: permissionGrantRevokeMatch[1],
              reason: body.reason,
              actorAccountId: actor.accountId,
              actorEmployeeCode: actor.employeeCode,
            };
            return handleTaskWriteOperation(config, res, path, revokeTaskPermissionGrant, args);
          }
        }
      }

      // ---------------------------------------------------------------
      // POST /v1/task/tasks/:id:uploadAttachment — Gate 5.6, contract CLOSED
      // ở G5.2: RAW BINARY BODY, KHÔNG multipart/form-data. Metadata qua
      // header, KHÔNG readJsonBody() — req chính là readable stream, truyền
      // NGUYÊN VĂN vào uploadAttachment() (KHÔNG buffer). Content-Length chỉ
      // fail-fast nếu VƯỢT MAX_FILE_SIZE (KHÔNG tin tuyệt đối — byte thật do
      // attachment-service tự đếm trong lúc stream, đúng G5.2/G5.3).
      // ---------------------------------------------------------------
      {
        const uploadMatch = req.method === 'POST' ? path.match(TASK_UPLOAD_ATTACHMENT_RE) : null;
        if (uploadMatch) {
          const auth = authCheck(req);
          if (!auth.authorized) {
            logger.warn('auth_denied', { path, reason: auth.reason });
            return sendTaskWriteError(res, 401, 'UNAUTHORIZED', auth.reason);
          }

          const contentLengthHeader = req.headers['content-length'];
          if (contentLengthHeader !== undefined) {
            const declaredLength = Number(contentLengthHeader);
            if (Number.isFinite(declaredLength) && declaredLength > MAX_FILE_SIZE) {
              return sendAttachmentError(res, path, Object.assign(new Error('File vượt quá dung lượng cho phép.'), { code: 'ATTACHMENT_STORAGE_TOO_LARGE' }));
            }
          }

          let originalFilename = '';
          try {
            originalFilename = decodeURIComponent(String(req.headers['x-attachment-filename'] || ''));
          } catch (_decodeErr) {
            return sendAttachmentError(res, path, Object.assign(new Error('Tên file không hợp lệ.'), { code: 'ATTACHMENT_ORCHESTRATION_FILENAME_REQUIRED' }));
          }

          return handleAttachmentUpload(config, res, path, {
            storageRoot: attachmentStorageRoot,
            taskId: uploadMatch[1],
            actorEmployeeCode: req.headers['x-attachment-actor-employee-code'] || '',
            idempotencyKey: req.headers['x-attachment-idempotency-key'] || '',
            originalFilename,
            mimeType: req.headers['content-type'] || '',
            readableStream: req,
          });
        }
      }

      // ---------------------------------------------------------------
      // POST /v1/task/tasks/:id:removeAttachment — Gate 5.6. Body JSON nhỏ,
      // readJsonBody() dùng được (khác upload). path :id authoritative =
      // taskId. KHÔNG filesystem unlink (đúng G5.1 quyết định #6 — orchestrator
      // removeAttachment() là pass-through logical remove thuần DB).
      // ---------------------------------------------------------------
      {
        const removeAttachmentMatch = req.method === 'POST' ? path.match(TASK_REMOVE_ATTACHMENT_RE) : null;
        if (removeAttachmentMatch) {
          const auth = authCheck(req);
          if (!auth.authorized) {
            logger.warn('auth_denied', { path, reason: auth.reason });
            return sendTaskWriteError(res, 401, 'UNAUTHORIZED', auth.reason);
          }

          let body;
          try {
            body = await readJsonBody(req, 65536);
          } catch (err) {
            return sendTaskWriteError(res, err.statusCode || 400, 'BODY_INVALID', err.message || 'BODY_INVALID');
          }
          body = body || {};
          const actor = body.actor || {};

          return handleAttachmentRemove(config, res, path, {
            taskId: removeAttachmentMatch[1],
            attachmentId: body.attachmentId,
            reason: body.reason,
            actorEmployeeCode: actor.employeeCode,
          });
        }
      }

      // ---------------------------------------------------------------
      // RECURRENCE V1 — POST /v1/task/recurrence (create)
      //                 GET  /v1/task/recurrence?status=&createdByEmployeeCode=
      //                 PATCH /v1/task/recurrence/:id (edit — future only)
      //                 POST /v1/task/recurrence/:id:pause|:resume|:stop
      //                 POST /v1/task/recurrence:run (idempotent scheduler)
      // Bearer service token only (auth SERVER-TO-SERVICE like every route).
      // The main app has already resolved identity, permission scope AND — for
      // :run — the ACTIVE employee/category sets, which it passes verbatim as
      // activePrimaryCodes / activeCategoryCodes. phf_hr has no org data, so
      // this route MUST NOT default to "everyone active".
      // ---------------------------------------------------------------
      {
        const isRecurrenceRoute = (
          path === '/v1/task/recurrence' || path === '/v1/task/recurrence:run' ||
          TASK_RECURRENCE_ITEM_RE.test(path) || TASK_RECURRENCE_PAUSE_RE.test(path) ||
          TASK_RECURRENCE_RESUME_RE.test(path) || TASK_RECURRENCE_STOP_RE.test(path)
        );
        if (isRecurrenceRoute) {
          const auth = authCheck(req);
          if (!auth.authorized) {
            logger.warn('auth_denied', { path, reason: auth.reason });
            return sendTaskWriteError(res, 401, 'UNAUTHORIZED', auth.reason);
          }

          // GET list — the only non-body verb.
          if (req.method === 'GET' && TASK_RECURRENCE_COLLECTION_RE.test(path)) {
            const filter = {
              status: url.searchParams.get('status') || undefined,
              createdByEmployeeCode: url.searchParams.get('createdByEmployeeCode') || undefined,
            };
            return handleRecurrenceOperation(res, path, () => listRecurrenceRules(config, filter));
          }

          if (req.method !== 'POST' && req.method !== 'PATCH') {
            return sendTaskWriteError(res, 405, 'METHOD_NOT_ALLOWED', 'Method không hỗ trợ cho route lịch lặp.');
          }

          let body;
          try {
            body = await readJsonBody(req, 65536);
          } catch (bodyErr) {
            return sendTaskWriteError(res, bodyErr.statusCode || 400, 'BODY_INVALID', bodyErr.message || 'BODY_INVALID');
          }
          body = body || {};
          const actor = { employeeCode: (body.actor && body.actor.employeeCode) || undefined, accountId: (body.actor && body.actor.accountId) || undefined };

          if (req.method === 'POST' && TASK_RECURRENCE_COLLECTION_RE.test(path)) {
            return handleRecurrenceOperation(res, path, () => createRecurrenceRule(config, body, actor));
          }

          if (req.method === 'POST' && TASK_RECURRENCE_RUN_RE.test(path)) {
            // Single-rule path (body.ruleId) OR global sweep. activePrimaryCodes
            // / activeCategoryCodes are pass-through allow-lists (see engine
            // header) — null when the caller cannot resolve them.
            const opts = {
              nowMs: Number.isFinite(Number(body.nowMs)) ? Number(body.nowMs) : undefined,
              activePrimaryCodes: Array.isArray(body.activePrimaryCodes) ? body.activePrimaryCodes : null,
              activeCategoryCodes: Array.isArray(body.activeCategoryCodes) ? body.activeCategoryCodes : null,
              maxCatchupPerRule: Number.isInteger(body.maxCatchupPerRule) ? body.maxCatchupPerRule : undefined,
              maxTotalPerRun: Number.isInteger(body.maxTotalPerRun) ? body.maxTotalPerRun : undefined,
            };
            if (body.ruleId) {
              return handleRecurrenceOperation(res, path, () => runRecurrenceRule(config, body.ruleId, {
                nowMs: opts.nowMs,
                maxOccurrences: opts.maxCatchupPerRule,
                activePrimaryCodes: opts.activePrimaryCodes,
                activeCategoryCodes: opts.activeCategoryCodes,
              }));
            }
            return handleRecurrenceOperation(res, path, () => generateRecurrenceDue(config, opts));
          }

          const patchMatch = req.method === 'PATCH' ? path.match(TASK_RECURRENCE_ITEM_RE) : null;
          if (patchMatch) {
            return handleRecurrenceOperation(res, path, () => updateRecurrenceRule(config, patchMatch[1], body, actor));
          }

          const pauseMatch = path.match(TASK_RECURRENCE_PAUSE_RE);
          const resumeMatch = path.match(TASK_RECURRENCE_RESUME_RE);
          const stopMatch = path.match(TASK_RECURRENCE_STOP_RE);
          if (req.method === 'POST' && (pauseMatch || resumeMatch || stopMatch)) {
            const kind = pauseMatch ? 'pause' : resumeMatch ? 'resume' : 'stop';
            const ruleId = (pauseMatch || resumeMatch || stopMatch)[1];
            const input = { reason: body.reason, nowMs: Number.isFinite(Number(body.nowMs)) ? Number(body.nowMs) : undefined };
            return handleRecurrenceOperation(res, path, () => transitionRecurrenceRule(config, ruleId, kind, input, actor));
          }

          return sendTaskWriteError(res, 404, 'NOT_FOUND', 'Route lịch lặp không khớp.');
        }
      }

      return sendJson(res, 404, { error: 'NOT_FOUND' });
    } catch (err) {
      if (err instanceof TaskReadError) {
        logger.warn('task_read_error', { path, code: err.code, statusCode: err.statusCode, message: err.message });
        return sendJson(res, err.statusCode, { error: err.code, message: err.message });
      }
      logger.error('unhandled_request_error', { path, message: err.message });
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'INTERNAL_ERROR' });
      }
    }
  });

  return server;
}

function main() {
  const config = loadConfig();

  logger.info('boot_config', config.summary);

  if (!config.ok) {
    for (const e of config.errors) logger.error('boot_config_invalid', { message: e });
    logger.error('boot_aborted', { reason: 'Config validation failed — xem boot_config_invalid ở trên.' });
    process.exit(1);
  }

  const server = createServer(config);

  server.listen(config.PORT, config.BIND_HOST, () => {
    logger.info('listening', { port: config.PORT, bindHost: config.BIND_HOST });
  });

  // Graceful shutdown — đóng server sạch, không cắt ngang request đang chạy.
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown_start', { signal });
    server.close(() => {
      logger.info('shutdown_complete', {});
      process.exit(0);
    });
    setTimeout(() => {
      logger.warn('shutdown_forced', { reason: 'timeout 5s' });
      process.exit(1);
    }, 5000).unref();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', (err) => {
    logger.error('uncaught_exception', { message: err.message, stack: err.stack });
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled_rejection', { message: reason && reason.message ? reason.message : String(reason) });
  });

  return server;
}

if (require.main === module) {
  main();
}

module.exports = { createServer, main };
