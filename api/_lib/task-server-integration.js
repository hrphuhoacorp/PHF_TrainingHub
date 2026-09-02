'use strict';

// PHF Task — Main App integration entrypoint cho phf-hr-api (North Star:
// PostgreSQL phf_hr là source-of-truth cuối cùng). TẮT MẶC ĐỊNH tuyệt đối
// (PHF_TASK_SERVER_WRITE_ENABLED phải ='true' tường minh) — khi tắt, hành vi
// Production KHÔNG đổi 1 dòng nào (api/data.js vẫn gọi thẳng task-core.js
// như trước file này tồn tại).
//
// Pilot: CHỈ createTaskDraft (data-independent — task mới không phụ thuộc
// task cũ có tồn tại ở phf_hr hay không, khác các lifecycle operation trên
// task đã có sẵn). Quyết định 2026-08-27: KHÔNG backfill Task cũ từ Supabase
// — sau cutover, phf_hr là nguồn duy nhất cho Task MỚI. Lifecycle operation
// trên task hiện có (cancel/update/complete/...) CHƯA wire ở đây — cùng lý
// do data-dependency, chờ pattern này được xác nhận đúng qua pilot rồi mới
// mở rộng đồng loạt.
//
// Seam reuse (KHÔNG duplicate business logic): validate+authorize dùng
// NGUYÊN VẸN resolveAndValidateCreateDraftInput() export từ task-core.js
// (refactor seam 2026-08-27, không đổi 1 rule nào) — module này chỉ đổi
// bước "persist" cuối cùng, từ Supabase RPC sang phf-hr-api HTTP.

const {
  resolveAndValidateCreateDraftInput,
  resolveAndAuthorizePublish,
  resolveAndAuthorizeUpdateProgress,
  checkTaskProgressThrottle,
  resolveAndAuthorizeComplete,
  resolveAndAuthorizeUpdateCapability,
  resolveAndAuthorizeDirectCancel,
  resolveAndAuthorizeAttachmentUpload,
  resolveAttachmentManageBasis,
  resolveAndAuthorizeView,
  resolveCrossDepartmentNotificationRecipient,
  resolveCancelRequestReviewerRecipients,
  resolveTaskDepartmentSnapshot,
  resolveAndAuthorizeSetPermissionAssignment,
  resolveAndAuthorizeCreatePermissionGrant,
  resolveAndAuthorizeRevokePermissionGrant,
  requireTaskAdmin,
  validateCategoryCode,
  validateCategoryName,
  validateCategoryActiveFlag,
  validateCategorySortOrder,
  assembleTaskDetailDto,
} = require('./task-core');
const { resolveActorContext, loadOrgRows } = require('./task-employee-scope');
const { canAssignTaskTo, canAddTaskRelated, resolveTaskViewerAuthority, canProposeTo, listProposalRecipientEmployees } = require('./task-permissions');
const { bridgeGetTaskDetail, bridgeListTaskCategories, bridgeListTasks } = require('./task-read-bridge');
const {
  bridgeCreateDraftTask,
  bridgeGetTaskById,
  bridgePublishTask,
  bridgeAcceptTaskProposal,
  bridgeRequestTaskCancel,
  bridgeDecideTaskCancelRequest,
  bridgeRejectTaskProposal,
  bridgeCancelTaskProposal,
  bridgeUpdateTaskProgress,
  bridgeCompleteTask,
  bridgeReopenTask,
  bridgeCancelTask,
  bridgeChangeTaskDeadline,
  bridgeTransferTaskPrimary,
  bridgeAddTaskRelated,
  bridgeRemoveTaskRelated,
  bridgeAddTaskComment,
  bridgeAddTaskLink,
  bridgeRemoveTaskLink,
  bridgeSetTaskPermissionAssignment,
  bridgeCreateTaskCategory,
  bridgeRenameTaskCategory,
  bridgeSetTaskCategoryActive,
  bridgeReorderTaskCategory,
  bridgeDeleteTaskCategoryIfUnused,
  bridgeCreateTaskPermissionGrant,
  bridgeRevokeTaskPermissionGrant,
  bridgeEmitTaskNotification,
  bridgeUploadTaskAttachment,
  bridgeRemoveTaskAttachment,
  bridgeDownloadTaskAttachment,
} = require('./task-write-bridge');

function isServerWriteEnabled() {
  return String(process.env.PHF_TASK_SERVER_WRITE_ENABLED || '').trim().toLowerCase() === 'true';
}

// Response shape: bridgeCreateDraftTask() trả thẳng row Postgres
// (`INSERT ... RETURNING *`, snake_case) — cùng shape (không camelCase) với
// task-core.js's Supabase RPC hôm nay, vì cả 2 cùng schema `task.tasks`/
// `task_tasks` mirror nhau. KHÔNG remap field ở đây (tránh "sửa vì đoán" —
// nếu phát hiện field lệch thật qua regression, sửa CHÍNH XÁC field đó, có
// evidence, không đoán trước).
// TASK_CREATE_CATEGORY_SUPABASE_DEPENDENCY fix (2026-08-29) — đường ViaServer
// (Giao việc thường + tự giao) validate category qua canonical PostgreSQL
// task.categories (bridgeListTaskCategories → phf-hr-api → task.categories),
// KHÔNG qua categoryActive() Supabase task_categories. Cùng nguồn dữ liệu +
// cùng ngữ nghĩa với validateProposalCategory() (LOCKED Phương án A).
//
// Endpoint /v1/task/categories chỉ trả category is_active=true → "không có
// trong list" nghĩa là KHÔNG tồn tại HOẶC đã ngừng dùng → gộp về
// TASK_CATEGORY_NOT_FOUND (HTTP 400). Business rule "category inactive bị từ
// chối khi tạo task" VẪN được giữ nguyên — chỉ khác mã lỗi ở nhánh inactive
// (categoryActive() Supabase trả TASK_CATEGORY_INACTIVE), cùng HTTP 400,
// cùng thông điệp người dùng. Đây là đánh đổi đã chấp nhận, đồng nhất với
// tiền lệ Proposal V2 trên chính đường đọc này.
async function validateGiaoViecCategoryViaBridge(categoryCode) {
  const categoriesResult = await bridgeListTaskCategories();
  const found = (categoriesResult.categories || []).find(
    (c) => c && c.category_code === categoryCode && c.is_active === true
  );
  if (!found) {
    const e = new Error('Category không tồn tại hoặc đã ngừng dùng: ' + categoryCode);
    e.statusCode = 400;
    e.code = 'TASK_CATEGORY_NOT_FOUND';
    throw e;
  }
}

async function createTaskDraftViaServer(session, input) {
  const v = await resolveAndValidateCreateDraftInput(session, input, {
    validateCategory: validateGiaoViecCategoryViaBridge,
  });
  return bridgeCreateDraftTask({
    flowType: v.flowType,
    title: v.title,
    content: v.content,
    categoryCode: v.categoryCode,
    priority: v.priority,
    startAt: v.startAt,
    deadline: v.deadline,
    primaryEmployeeCode: v.primaryEmployeeCode || undefined,
    idempotencyKey: v.idempotencyKey || undefined,
    actorEmployeeCode: v.actorContext.employeeCode,
    actorAccountId: v.actorContext.accountId,
  });
}

// Pilot #2: publishTask — state source = bridgeGetTaskById() (phf_hr, KHÔNG
// Supabase — quyết định đã khóa: "Không dùng Supabase làm fallback cho task
// đã sinh trên phf_hr"). Authorize dùng NGUYÊN VẸN resolveAndAuthorizePublish()
// (seam mới export từ task-core.js, cùng lý do reuse như pilot #1).
//
// CROSS-DEPARTMENT NOTIFICATION GAP — ĐÃ ĐÓNG (2026-08-27). Trước đây
// sourceDepartment/targetDepartment gửi cứng null (KHÔNG resolve), và không
// gọi notification nào. Nay: department snapshot tự resolve ở main app
// (resolveTaskDepartmentSnapshot() — actorContext.department + department
// của primary ACTIVE tại thời điểm publish, đọc qua loadOrgRows(), ĐÚNG
// thiết kế S3B mục 6.3 đã CLOSED, vì phf_hr KHÔNG có bảng employee_profiles
// để tự làm việc này như Supabase RPC/trigger). Notification recipient dùng
// LẠI NGUYÊN VẸN resolveCrossDepartmentNotificationRecipient() (seam tách
// từ applyCrossDepartmentPublishSideEffects() gốc — KHÔNG duplicate rule),
// ghi qua bridgeEmitTaskNotification() (route mới :notify trên phf-hr-api).
// Best-effort/non-blocking — GIỐNG HỆT semantics emitTaskNotificationSafe()
// bên Supabase path: lỗi emit KHÔNG BAO GIỜ làm hỏng response publish đã
// thành công thật.
async function publishTaskViaServer(session, taskId, expectedRowVersion) {
  const { task: current, assignees } = await bridgeGetTaskById(taskId);
  const actorContext = await resolveAndAuthorizePublish(session, current);
  const activePrimary = (assignees || []).find(a => a.role === 'primary' && a.is_active);
  const orgRows = await loadOrgRows();
  const { sourceDepartment, targetDepartment } = resolveTaskDepartmentSnapshot(actorContext, activePrimary ? activePrimary.employee_code : null, orgRows);
  const published = await bridgePublishTask(taskId, expectedRowVersion, sourceDepartment, targetDepartment, actorContext.employeeCode, actorContext.accountId);
  try {
    const recipient = await resolveCrossDepartmentNotificationRecipient(actorContext, taskId, published, assignees);
    if (recipient) {
      await bridgeEmitTaskNotification(taskId, recipient.recipientEmployeeCode, recipient.title, recipient.message, recipient.targetPath, recipient.dedupeKey);
    }
  } catch (notifyError) {
    console.warn('[PHF Task Server] cross-department notification thất bại (bỏ qua, không ảnh hưởng publish):', notifyError && notifyError.message ? notifyError.message : notifyError);
  }
  return published;
}

// =============================================================================
// GROUP: progress / deadline / cancel / reopen / complete / transfer / related
// / comment / link — TẤT CẢ dùng chung 1 pattern: bridgeGetTaskById() (state
// từ phf_hr) → seam authorize tương ứng (export từ task-core.js, KHÔNG
// duplicate) → bridge<Verb>() persist. Regression chạy sau MỖI hàm thêm vào,
// không gộp GO riêng từng hàm — đúng chỉ đạo BROAD GO.
// =============================================================================

// updateTaskProgress — throttle (Layer 1) PHẢI chạy TRƯỚC bridgeGetTaskById
// (I/O) để giữ đúng nguyên tắc CONTAINMENT gốc (throttle rẻ nhất, chặn sớm
// nhất, trước bất kỳ I/O nào — kể cả I/O sang phf-hr-api).
async function updateTaskProgressViaServer(session, taskId, expectedRowVersion, progressPercent, progressStatus) {
  const actorContext = await resolveActorContext(session);
  checkTaskProgressThrottle(actorContext, taskId);
  const { task: current, assignees } = await bridgeGetTaskById(taskId);
  await resolveAndAuthorizeUpdateProgress(actorContext, current, assignees, expectedRowVersion);
  return bridgeUpdateTaskProgress(taskId, expectedRowVersion, progressPercent, progressStatus, actorContext.employeeCode, actorContext.accountId);
}

async function completeTaskViaServer(session, taskId, expectedRowVersion, resultText) {
  const { assignees } = await bridgeGetTaskById(taskId);
  const actorContext = await resolveAndAuthorizeComplete(session, assignees);
  return bridgeCompleteTask(taskId, expectedRowVersion, resultText, actorContext.employeeCode, actorContext.accountId);
}

async function reopenTaskViaServer(session, taskId, expectedRowVersion, reason) {
  const { task: current, assignees } = await bridgeGetTaskById(taskId);
  const actorContext = await resolveAndAuthorizeUpdateCapability(session, current, () => Promise.resolve(assignees));
  return bridgeReopenTask(taskId, expectedRowVersion, reason, actorContext.employeeCode, actorContext.accountId, actorContext.interventionBasis);
}

async function cancelTaskViaServer(session, taskId, expectedRowVersion, reason) {
  const { task: current, assignees } = await bridgeGetTaskById(taskId);
  // CANCEL POLICY V1 — direct cancel = creator / management only. An active
  // primary is rejected here (TASK_CANCEL_REQUEST_REQUIRED) and must use
  // requestTaskCancelViaServer instead. Same gate the DTO's actions.cancel uses.
  const actorContext = await resolveAndAuthorizeDirectCancel(session, current, () => Promise.resolve(assignees));
  return bridgeCancelTask(taskId, expectedRowVersion, reason, actorContext.employeeCode, actorContext.accountId, actorContext.interventionBasis);
}

// -----------------------------------------------------------------------------
// CANCEL POLICY V1 — "Yêu cầu hủy" request flow (PostgreSQL-only, no Legacy).
// Authorization mirrors resolveTaskViewerAuthority exactly:
//   submit   -> the current active primary (actions.request_cancel)
//   approve  -> a direct-cancel basis (creator / management), which is also
//               stamped as interventionBasis for the canonical cancel
//   reject   -> same as approve
//   withdraw -> the requester of the pending request
// -----------------------------------------------------------------------------
async function requestTaskCancelViaServer(session, taskId, reason) {
  if (!reason || !String(reason).trim()) proposalFail('Lý do là bắt buộc khi gửi yêu cầu hủy.', 400, 'TASK_CANCEL_REQUEST_REASON_REQUIRED');
  const { task: current, assignees } = await bridgeGetTaskById(taskId);
  if (!current) proposalFail('Không tìm thấy công việc.', 404, 'TASK_NOT_FOUND');
  const actorContext = await resolveActorContext(session);
  const viewer = await resolveTaskViewerAuthority(session, current, assignees);
  if (!viewer || !viewer.actions || viewer.actions.request_cancel !== true) {
    proposalFail('Chỉ người phụ trách chính mới gửi được yêu cầu hủy.', 403, 'TASK_CANCEL_REQUEST_ACTOR_DENIED');
  }
  // MANAGEMENT NOTIFICATION V1 — a pending cancel request is the one V1 event
  // with a genuine management decision. Resolve the canonical reviewer
  // recipient(s) (active primary's manager-of-record with real Task authority)
  // and pass them through; the creator is always notified in-transaction.
  // NOT a broadcast to every admin/executive with company-wide visibility.
  let reviewerRecipients = [];
  try {
    reviewerRecipients = await resolveCancelRequestReviewerRecipients(
      actorContext,
      (assignees || []).map((a) => ({
        employee_code: a.employeeCode || a.employee_code,
        role: a.role,
        is_active: a.isActive === true || a.is_active === true,
      })),
      current && (current.created_by_employee_code || current.createdByEmployeeCode)
    );
  } catch (_e) { reviewerRecipients = []; } // notification resolution never blocks the request
  return bridgeRequestTaskCancel(taskId, reason, actorContext.employeeCode, actorContext.accountId, reviewerRecipients);
}

async function decideTaskCancelRequestViaServer(session, taskId, decision, opts) {
  const options = opts || {};
  const { task: current, assignees } = await bridgeGetTaskById(taskId);
  if (!current) proposalFail('Không tìm thấy công việc.', 404, 'TASK_NOT_FOUND');
  const actorContext = await resolveActorContext(session);

  if (decision === 'withdraw') {
    const detail = await bridgeGetTaskDetail(taskId);
    const cr = detail && detail.cancel_request;
    if (!cr || cr.status !== 'pending') proposalFail('Không tìm thấy yêu cầu hủy đang chờ.', 404, 'TASK_CANCEL_REQUEST_NOT_FOUND');
    const me = String(actorContext.employeeCode || '').trim().toUpperCase();
    if (!me || me !== String(cr.requested_by_employee_code || '').trim().toUpperCase()) {
      proposalFail('Chỉ người đã gửi yêu cầu mới rút được yêu cầu hủy.', 403, 'TASK_CANCEL_REQUEST_ACTOR_DENIED');
    }
    return bridgeDecideTaskCancelRequest(taskId, 'withdraw', {
      note: options.note, actorEmployeeCode: actorContext.employeeCode, actorAccountId: actorContext.accountId,
    });
  }

  // approve | reject -> must hold a direct-cancel basis (creator / management).
  const authed = await resolveAndAuthorizeDirectCancel(session, current, () => Promise.resolve(assignees));
  return bridgeDecideTaskCancelRequest(taskId, decision, {
    note: options.note,
    expectedRowVersion: options.expectedRowVersion,
    interventionBasis: authed.interventionBasis,
    actorEmployeeCode: authed.employeeCode,
    actorAccountId: authed.accountId,
  });
}
function approveTaskCancelRequestViaServer(session, taskId, opts) { return decideTaskCancelRequestViaServer(session, taskId, 'approve', opts); }
function rejectTaskCancelRequestViaServer(session, taskId, opts) { return decideTaskCancelRequestViaServer(session, taskId, 'reject', opts); }
function withdrawTaskCancelRequestViaServer(session, taskId, opts) { return decideTaskCancelRequestViaServer(session, taskId, 'withdraw', opts); }

async function changeTaskDeadlineViaServer(session, taskId, expectedRowVersion, newDeadline, reason) {
  const { task: current, assignees } = await bridgeGetTaskById(taskId);
  const actorContext = await resolveAndAuthorizeUpdateCapability(session, current, () => Promise.resolve(assignees));
  return bridgeChangeTaskDeadline(taskId, expectedRowVersion, newDeadline, reason, actorContext.employeeCode, actorContext.accountId, actorContext.interventionBasis);
}

// transferTaskPrimary — canAssignTaskTo() (task-permissions.js) KHÔNG được
// đưa vào seam dùng chung (chỉ riêng operation này cần) — gọi trực tiếp,
// giống hệt cách task-core.js gốc làm, KHÔNG duplicate logic bên trong nó.
async function transferTaskPrimaryViaServer(session, taskId, expectedRowVersion, newPrimaryEmployeeCode, reason) {
  const { task: current, assignees } = await bridgeGetTaskById(taskId);
  const actorContext = await resolveAndAuthorizeUpdateCapability(session, current, () => Promise.resolve(assignees));
  const allowedTarget = await canAssignTaskTo(session, newPrimaryEmployeeCode);
  if (!allowedTarget) {
    const err = new Error('Người phụ trách mới nằm ngoài phạm vi giao việc của bạn.');
    err.code = 'TASK_TRANSFER_TARGET_DENIED';
    err.statusCode = 403;
    throw err;
  }
  return bridgeTransferTaskPrimary(taskId, expectedRowVersion, newPrimaryEmployeeCode, reason, actorContext.employeeCode, actorContext.accountId, actorContext.interventionBasis);
}

// addTaskRelated — canAddTaskRelated() (peopleScope, KHÁC canAssignTaskTo)
// + check "không thêm chính primary làm related" — đọc verbatim task-core.js,
// giữ đúng thứ tự: authorize update-capability trước, rồi mới validate target.
async function addTaskRelatedViaServer(session, taskId, targetEmployeeCode) {
  const { task: current, assignees } = await bridgeGetTaskById(taskId);
  const actorContext = await resolveAndAuthorizeUpdateCapability(session, current, () => Promise.resolve(assignees));
  const target = String(targetEmployeeCode || '').trim().toUpperCase();
  const activePrimary = (assignees || []).find(a => a.role === 'primary' && a.is_active);
  if (activePrimary && activePrimary.employee_code === target) {
    const err = new Error('Không thể thêm primary hiện hành làm related.');
    err.code = 'TASK_RELATED_IS_PRIMARY';
    err.statusCode = 400;
    throw err;
  }
  const allowedTarget = await canAddTaskRelated(session, target);
  if (!allowedTarget) {
    const err = new Error('Nhân sự này nằm ngoài phạm vi của bạn.');
    err.code = 'TASK_RELATED_TARGET_DENIED';
    err.statusCode = 403;
    throw err;
  }
  return bridgeAddTaskRelated(taskId, target, actorContext.employeeCode, actorContext.accountId, actorContext.interventionBasis);
}

async function removeTaskRelatedViaServer(session, taskId, targetEmployeeCode) {
  const { task: current, assignees } = await bridgeGetTaskById(taskId);
  const actorContext = await resolveAndAuthorizeUpdateCapability(session, current, () => Promise.resolve(assignees));
  return bridgeRemoveTaskRelated(taskId, targetEmployeeCode, actorContext.employeeCode, actorContext.accountId, actorContext.interventionBasis);
}

async function addTaskCommentViaServer(session, taskId, body) {
  const { task: current, assignees } = await bridgeGetTaskById(taskId);
  const actorContext = await resolveAndAuthorizeView(session, current, assignees);
  return bridgeAddTaskComment(taskId, body, actorContext.employeeCode, actorContext.accountId);
}

async function addTaskLinkViaServer(session, taskId, side, url, label) {
  const { task: current, assignees } = await bridgeGetTaskById(taskId);
  const actorContext = await resolveAndAuthorizeView(session, current, assignees);
  return bridgeAddTaskLink(taskId, side, url, label, actorContext.employeeCode, actorContext.accountId);
}

async function removeTaskLinkViaServer(session, taskId, linkId) {
  const { task: current, assignees } = await bridgeGetTaskById(taskId);
  const actorContext = await resolveAndAuthorizeView(session, current, assignees);
  return bridgeRemoveTaskLink(taskId, linkId, actorContext.employeeCode, actorContext.accountId);
}

// =============================================================================
// GROUP: category CRUD / permission assignment / permission grant — target
// datastore = phf_hr (không phải Task cụ thể nào, nên KHÔNG dùng
// bridgeGetTaskById()). Seam reuse giống hệt nguyên tắc trên: authorize +
// validate input NGUYÊN VẸN từ task-core.js (requireTaskAdmin/
// validateCategory*/resolveAndAuthorize*), chỉ đổi bước persist cuối sang
// bridge<Verb>() thay vì Supabase.
// =============================================================================

async function createTaskCategoryViaServer(session, categoryCode, displayName) {
  const actorContext = await requireTaskAdmin(session);
  const validCode = validateCategoryCode(categoryCode);
  const validName = validateCategoryName(displayName);
  return bridgeCreateTaskCategory(validCode, validName, actorContext.employeeCode, actorContext.accountId);
}

async function renameTaskCategoryViaServer(session, categoryCode, displayName) {
  const actorContext = await requireTaskAdmin(session);
  const validCode = validateCategoryCode(categoryCode);
  const validName = validateCategoryName(displayName);
  return bridgeRenameTaskCategory(validCode, validName, actorContext.employeeCode, actorContext.accountId);
}

async function setTaskCategoryActiveViaServer(session, categoryCode, isActive) {
  const actorContext = await requireTaskAdmin(session);
  const validCode = validateCategoryCode(categoryCode);
  const validActive = validateCategoryActiveFlag(isActive);
  return bridgeSetTaskCategoryActive(validCode, validActive, actorContext.employeeCode, actorContext.accountId);
}

async function reorderTaskCategoryViaServer(session, categoryCode, sortOrder) {
  const actorContext = await requireTaskAdmin(session);
  const validCode = validateCategoryCode(categoryCode);
  const validSortOrder = validateCategorySortOrder(sortOrder);
  return bridgeReorderTaskCategory(validCode, validSortOrder, actorContext.employeeCode, actorContext.accountId);
}

// deleteTaskCategoryIfUnusedViaServer — KHÔNG truyền actor (đúng contract
// bridgeDeleteTaskCategoryIfUnused()/lib/task-write.js: xóa category không
// ghi audit column nào, xem task-core.js's deleteTaskCategory() gốc cũng
// không truyền actor vào RPC). "Còn dùng hay không" được check ATOMIC ở
// phf-hr-api (advisory lock trong transaction), KHÔNG kiểm tra trước ở đây
// — đúng chỉ đạo gốc tránh race condition check-rồi-xóa rời 2 bước.
async function deleteTaskCategoryIfUnusedViaServer(session, categoryCode) {
  await requireTaskAdmin(session);
  const validCode = validateCategoryCode(categoryCode);
  return bridgeDeleteTaskCategoryIfUnused(validCode);
}

async function setTaskPermissionAssignmentViaServer(session, input) {
  const { admin, employeeCode, presetCode, reason, accountId } = await resolveAndAuthorizeSetPermissionAssignment(session, input);
  return bridgeSetTaskPermissionAssignment(accountId, employeeCode, presetCode, reason, admin.employeeCode, admin.accountId);
}

async function createTaskPermissionGrantViaServer(session, input) {
  const { admin, granteeEmployeeCode, peopleScope, reason } = await resolveAndAuthorizeCreatePermissionGrant(session, input);
  return bridgeCreateTaskPermissionGrant(granteeEmployeeCode, peopleScope, reason, admin.employeeCode, admin.accountId);
}

// revokeTaskPermissionGrantViaServer — KHÔNG đọc existing grant từ Supabase
// (khác revokeTaskPermissionGrant() gốc) — datastore đang ghi là phf_hr, và
// phf-hr-api's revokeTaskPermissionGrant() đã tự làm ĐÚNG check này (exists/
// grant_type==='extend'/is_active===true, cùng error code verbatim) trên
// chính phf_hr, xem ghi chú tại resolveAndAuthorizeRevokePermissionGrant().
async function revokeTaskPermissionGrantViaServer(session, grantId, reason) {
  const resolved = await resolveAndAuthorizeRevokePermissionGrant(session, grantId, reason);
  return bridgeRevokeTaskPermissionGrant(resolved.grantId, resolved.reason, resolved.admin.employeeCode, resolved.admin.accountId);
}

// =============================================================================
// GROUP: attachment upload/remove — FILE ATTACHMENT V1 AUTHORIZATION (2026-08-31).
// Attachments are greenfield on phf_hr (never existed on the Supabase Task path
// — see services/phf-hr-api/lib/attachment-service.js). The phf-hr-api routes
// only check the service token; the business authorization is enforced HERE,
// once, reusing the canonical resolvers:
//   UPLOAD  -> resolveAndAuthorizeAttachmentUpload (creator/assigner OR active
//              primary OR authorised management). Plain viewer / CC / proposer-
//              by-status-alone -> TASK_ATTACHMENT_UPLOAD_DENIED (403).
//   REMOVE  -> the uploader of that specific attachment, OR
//              resolveAttachmentManageBasis (creator/assigner OR authorised
//              management — a bare active primary is NOT enough). Otherwise
//              TASK_ATTACHMENT_REMOVE_DENIED (403). Actor must also be able to
//              VIEW the task.
// =============================================================================

function attachmentAuthzError(message, code) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = 403;
  return err;
}

function sameEmployeeCode(a, b) {
  return String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase()
    && String(a || '').trim() !== '';
}

async function uploadTaskAttachmentViaServer(session, taskId, fileBuffer, options) {
  const { task: current, assignees } = await bridgeGetTaskById(taskId);
  if (!current) {
    const err = new Error('Không tìm thấy task.');
    err.code = 'TASK_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }
  const actorContext = await resolveAndAuthorizeAttachmentUpload(session, current, () => Promise.resolve(assignees));
  // ATTACHMENT ACTOR IDENTITY (2026-09-02) — forward BOTH identifiers, parity
  // with every other Task write route. An Admin-only actor has employeeCode ''
  // and only accountId; the storage object-key + metadata use whichever is
  // present (employeeCode first).
  return bridgeUploadTaskAttachment(taskId, fileBuffer, {
    filename: options && options.filename,
    mimeType: options && options.mimeType,
    idempotencyKey: options && options.idempotencyKey,
    actorEmployeeCode: actorContext.employeeCode,
    actorAccountId: actorContext.accountId,
  });
}

async function removeTaskAttachmentViaServer(session, taskId, attachmentId, reason) {
  const detail = await bridgeGetTaskDetail(taskId);
  if (!detail || !detail.task) {
    const err = new Error('Không tìm thấy task.');
    err.code = 'TASK_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }
  // Actor must at least be able to view the task.
  const actorContext = await resolveAndAuthorizeView(session, detail.task, detail.assignees);
  const manageBasis = await resolveAttachmentManageBasis(session, detail.task, detail.assignees);
  const target = (detail.attachments || []).find(a => a.id === attachmentId);
  const isUploader = !!target && (
    sameEmployeeCode(target.uploaded_by_employee_code, actorContext.employeeCode)
    || (!!target.uploaded_by_account_id && !!actorContext.accountId
        && String(target.uploaded_by_account_id).trim() === String(actorContext.accountId).trim())
  );
  if (!manageBasis && !isUploader) {
    throw attachmentAuthzError('Không có quyền gỡ tệp đính kèm này.', 'TASK_ATTACHMENT_REMOVE_DENIED');
  }
  return bridgeRemoveTaskAttachment(taskId, attachmentId, reason, actorContext.employeeCode, actorContext.accountId);
}

// FILE ATTACHMENT V1 — DOWNLOAD. Anyone who can VIEW the task may download any
// of its active attachments. Authorization is enforced here (phf-hr-api trusts
// the service token); the raw phf-hr-api response (stream + Content-Type +
// Content-Disposition + Content-Length) is handed back to the HTTP endpoint to
// pipe. The on-disk object key is never in that response — phf-hr-api resolves
// it internally and streams bytes only.
async function downloadTaskAttachmentViaServer(session, taskId, attachmentId) {
  const detail = await bridgeGetTaskDetail(taskId);
  if (!detail || !detail.task) {
    const err = new Error('Không tìm thấy task.');
    err.code = 'TASK_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }
  await resolveAndAuthorizeView(session, detail.task, detail.assignees);
  return bridgeDownloadTaskAttachment(taskId, attachmentId);
}

// =============================================================================
// READ — getTaskDetailViaServer (2026-08-27). Cờ RIÊNG
// (PHF_TASK_READ_BRIDGE_GETDETAIL_ENABLED, xem task-read-bridge.js) —
// KHÔNG dùng chung với isServerWriteEnabled()/isBridgeEnabled() khác, đúng
// nguyên tắc "1 cờ / 1 rủi ro" đã áp dụng cho mọi bridge khác trong dự án.
// Authorize dùng NGUYÊN VẸN resolveAndAuthorizeView() (seam đã có, cùng seam
// addTaskComment/addTaskLink/attachment dùng). Lắp ráp DTO dùng NGUYÊN VẸN
// assembleTaskDetailDto() (seam tách từ getTaskDetail() gốc — enrich
// assignee/lọc link đã xóa/category fallback GIỐNG HỆT, KHÔNG viết lại).
// category: lấy qua bridgeListTaskCategories() (đã có sẵn từ Phase 6, cùng
// datastore phf_hr với task) thay vì Supabase — giữ đúng nguyên tắc "task
// sống ở đâu thì category tham chiếu cũng đọc từ đó", KHÔNG trộn nguồn.
async function getTaskDetailViaServer(session, taskId) {
  const detail = await bridgeGetTaskDetail(taskId);
  if (!detail || !detail.task) {
    const err = new Error('Không tìm thấy task.');
    err.code = 'TASK_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }
  await resolveAndAuthorizeView(session, detail.task, detail.assignees);
  const [categoriesResult, orgRows, viewer] = await Promise.all([
    bridgeListTaskCategories(),
    loadOrgRows(),
    resolveTaskViewerAuthority(session, detail.task, detail.assignees),
  ]);
  const categoryDtoObj = (categoriesResult.categories || []).find(c => c.category_code === detail.task.category_code) || null;
  return assembleTaskDetailDto(detail.task, detail.assignees, detail.comments, detail.links, detail.events, categoryDtoObj, orgRows, viewer, detail.recurrence, detail.cancel_request, detail.attachments);
}

// =============================================================================
// READ — listTaskEventsViaServer (2026-08-28, MANAGED_SCOPE_UI_DATA_MISMATCH /
// TIMELINE→DETAIL fix). The legacy task-core.js::listTaskEvents authorizes via
// listTasks() then reads task.events from SUPABASE — but when the read bridge
// is on, listTasks()/getTaskDetail() serve throwaway/phf_hr, so every Timeline
// row pointed at a Supabase task_id that getTaskDetail (bridge) then 404s.
// This version keeps BOTH the authorized task set AND the events on the SAME
// datastore as getTaskDetail: authorized tasks via bridgeListTasks(), events
// per-task via the existing single-task read bridge (bridgeGetTaskDetail →
// .events). No new phf-hr-api route, Phase B/C untouched. Same permission
// contract as before ("authorization = the task set listTasks() returns for
// this relation/scope"). DTO shape is byte-identical to the legacy version.
//
// Timeline Foundation V1 limit is preserved and made explicit: events are
// gathered from the newest TIMELINE_TASK_FANOUT tasks in scope (created_at
// desc, as bridgeListTasks already orders), then the newest `limit` events.
// =============================================================================
const TIMELINE_TASK_FANOUT = 60;

async function listTaskEventsViaServer(session, params) {
  const input = params || {};
  const eventLimit = Math.min(200, Math.max(1, Number(input.limit) || 100));

  const taskListResult = await bridgeListTasks(session, {
    relation: input.relation, statusFilter: 'all', scope: input.scope, limit: 200, offset: 0,
  });
  const tasks = Array.isArray(taskListResult.tasks) ? taskListResult.tasks : [];
  const base = {
    relation: taskListResult.relation, scope: taskListResult.scope,
    viewScopeType: taskListResult.viewScopeType, requesterActorType: taskListResult.requesterActorType,
  };
  if (!tasks.length) return Object.assign({ events: [] }, base);

  const orgRows = await loadOrgRows();
  const peopleByCode = new Map((orgRows || []).map(p => [String(p.employeeCode || '').toUpperCase(), p]));
  const actorInfo = (ec) => {
    const key = String(ec || '').toUpperCase();
    const p = peopleByCode.get(key);
    return { employee_code: key, full_name: p ? p.fullName : '' };
  };

  const scanTasks = tasks.slice(0, TIMELINE_TASK_FANOUT);
  const perTask = await Promise.all(scanTasks.map((t) =>
    bridgeGetTaskDetail(t.task_id)
      .then((d) => ({ t, events: (d && Array.isArray(d.events)) ? d.events : [] }))
      .catch(() => ({ t, events: [] }))
  ));

  const merged = [];
  for (const { t, events } of perTask) {
    for (const e of events) {
      merged.push({
        id: e.id,
        task_id: e.task_id,
        task_code: t.task_code || '',
        task_title: t.title || '',
        event_type: e.event_type,
        actor: actorInfo(e.actor_employee_code),
        payload: e.payload || {},
        reason: e.reason || null,
        occurred_at: e.occurred_at,
      });
    }
  }
  merged.sort((a, b) => String(b.occurred_at || '').localeCompare(String(a.occurred_at || '')));
  return Object.assign({ events: merged.slice(0, eventLimit) }, base);
}

// =============================================================================
// PROPOSAL V2 (2026-08-29, LOCKED Phương án A) — PostgreSQL-ONLY, KHÔNG phụ
// thuộc isServerWriteEnabled()/PHF_TASK_SERVER_WRITE_ENABLED (cờ đó chỉ gate
// cutover CỦA GIAO VIỆC — Proposal chưa từng có Legacy Supabase để
// "cutover", chỉ có 1 đường xây thẳng trên phf_hr). Mọi hàm dưới đây LUÔN
// gọi bridge*(), KHÔNG có nhánh Legacy nào — nếu bridge tắt
// (PHF_TASK_WRITE_BRIDGE_ENABLED != 'true'), lỗi TASK_WRITE_BRIDGE_DISABLED
// nổi lên tự nhiên (đúng ý — không có gì để fallback về).
//
// Category validation dùng bridgeListTaskCategories() (PostgreSQL, đã có sẵn
// từ Phase 6/getTaskDetailViaServer) — KHÔNG gọi resolveAndValidateCreateDraftInput()/
// categoryActive() (task-core.js, Supabase task_categories). Đây CHÍNH LÀ
// quyết định đã LOCKED để tránh lặp lại mismatch TASK_CREATE_CATEGORY_
// SUPABASE_DEPENDENCY (= DEFERRED, KHÔNG sửa ở gate này, chỉ áp dụng seam
// MỚI riêng cho Proposal).
// =============================================================================

function proposalFail(message, statusCode, code) {
  const e = new Error(message);
  e.statusCode = statusCode || 400;
  e.code = code || 'TASK_PROPOSAL_INVALID';
  throw e;
}

async function validateProposalCategory(categoryCodeRaw) {
  const categoryCode = String(categoryCodeRaw || '').trim().toUpperCase();
  if (!categoryCode) proposalFail('Category là bắt buộc.', 400, 'TASK_CATEGORY_REQUIRED');
  const categoriesResult = await bridgeListTaskCategories();
  const found = (categoriesResult.categories || []).find((c) => c.category_code === categoryCode);
  if (!found || found.is_active !== true) proposalFail('Category không tồn tại hoặc đã ngừng dùng: ' + categoryCode, 400, 'TASK_CATEGORY_NOT_FOUND');
  return categoryCode;
}

// createTaskProposalViaServer — SEAM RIÊNG cho Proposal (KHÔNG dùng
// resolveAndValidateCreateDraftInput() của Giao việc — seam đó kéo theo
// categoryActive() Supabase). canProposeTo() (task-permissions.js::
// resolveProposalRecipientEmployeeCodes, EFFECTIVE assign capability) là
// permission gate DUY NHẤT cho recipient — KHÔNG dùng canAssignTaskTo()/
// assignScope của Giao việc. create+publish gộp làm 1 lệnh gọi (Proposal
// không có khái niệm "sửa draft trước khi gửi" ở V1 — gửi ngay khi tạo).
async function createTaskProposalViaServer(session, input) {
  const actorContext = await resolveActorContext(session);
  const title = String((input && input.title) || '').trim();
  if (!title) proposalFail('Tiêu đề là bắt buộc.', 400, 'TASK_TITLE_REQUIRED');
  const categoryCode = await validateProposalCategory(input && input.categoryCode);
  const priority = String((input && input.priority) || 'thuong').trim() || 'thuong';
  if (!['thuong', 'quan_trong', 'khan_cap'].includes(priority)) proposalFail('priority không hợp lệ.', 400, 'TASK_PRIORITY_INVALID');
  const startAt = (input && input.startAt) || null;
  const deadline = input && input.deadline;
  if (!deadline) proposalFail('Deadline là bắt buộc.', 400, 'TASK_DEADLINE_REQUIRED');
  if (startAt && new Date(startAt).getTime() > new Date(deadline).getTime()) proposalFail('Ngày bắt đầu không được sau deadline.', 400, 'TASK_DATE_ORDER_INVALID');

  const recipientEmployeeCode = String((input && input.recipientEmployeeCode) || '').trim().toUpperCase();
  if (!recipientEmployeeCode) proposalFail('Người nhận đề xuất là bắt buộc.', 400, 'TASK_PROPOSAL_RECIPIENT_REQUIRED');
  const allowedRecipient = await canProposeTo(session, recipientEmployeeCode);
  if (!allowedRecipient) proposalFail('Người này hiện không có quyền Giao việc — không thể đề xuất.', 403, 'TASK_PROPOSAL_RECIPIENT_DENIED');

  const draft = await bridgeCreateDraftTask({
    flowType: 'de_xuat', title, content: (input && input.content) || '', categoryCode, priority, startAt, deadline,
    actorEmployeeCode: actorContext.employeeCode, actorAccountId: actorContext.accountId,
  });
  return bridgePublishTask(draft.id, draft.row_version, undefined, undefined, actorContext.employeeCode, actorContext.accountId, recipientEmployeeCode);
}

// acceptTaskProposalViaServer — actor phải là recipient (enforce THẬT ở
// phf-hr-api, xem lib/task-write.js::acceptTaskProposal — app layer ở đây
// chỉ validate category (Postgres source, KHÔNG Supabase) + Primary bằng
// ĐÚNG canAssignTaskTo() hiện có (LOCK "Người Accept chọn Primary theo
// normal Task assign permission hiện có" — KHÔNG viết gate mới).
async function acceptTaskProposalViaServer(session, proposalTaskId, input) {
  const actorContext = await resolveActorContext(session);
  const categoryCode = await validateProposalCategory(input && input.categoryCode);
  const primaryEmployeeCode = String((input && input.primaryEmployeeCode) || '').trim().toUpperCase();
  if (!primaryEmployeeCode) proposalFail('Người phụ trách chính (Primary) là bắt buộc.', 400, 'TASK_PRIMARY_REQUIRED');
  const allowedPrimary = await canAssignTaskTo(session, primaryEmployeeCode);
  if (!allowedPrimary) proposalFail('Không có quyền giao Primary cho nhân sự này.', 403, 'TASK_ASSIGN_DENIED');

  return bridgeAcceptTaskProposal(proposalTaskId, {
    title: input && input.title, content: input && input.content, categoryCode,
    priority: input && input.priority, startAt: input && input.startAt, deadline: input && input.deadline,
    primaryEmployeeCode,
  }, actorContext.employeeCode, actorContext.accountId);
}

async function rejectTaskProposalViaServer(session, proposalTaskId, reason) {
  const actorContext = await resolveActorContext(session);
  if (!reason || !String(reason).trim()) proposalFail('Lý do từ chối là bắt buộc.', 400, 'TASK_PROPOSAL_REJECT_REASON_REQUIRED');
  return bridgeRejectTaskProposal(proposalTaskId, reason, actorContext.employeeCode, actorContext.accountId);
}

async function cancelTaskProposalViaServer(session, proposalTaskId, reason) {
  const actorContext = await resolveActorContext(session);
  if (!reason || !String(reason).trim()) proposalFail('Lý do hủy là bắt buộc.', 400, 'TASK_PROPOSAL_CANCEL_REASON_REQUIRED');
  return bridgeCancelTaskProposal(proposalTaskId, reason, actorContext.employeeCode, actorContext.accountId);
}

// getTaskDetailProposalAwareViaServer (2026-08-29, fix phát hiện qua E2E
// thật) — getTaskDetailViaServer() thường (bên dưới) authorize view bằng
// resolveAndAuthorizeView() = Permission Contract V1 CỦA GIAO VIỆC (creator/
// active primary/related/peopleScope-qua-primary). Proposal (flow_type=
// 'de_xuat') CHƯA CÓ Primary active ở trạng thái pending — recipient KHÔNG
// BAO GIỜ pass được rule đó, dù họ CHÍNH LÀ người cần xem để quyết định
// Accept/Reject. Đây KHÔNG phải lỗi Permission Contract V1 (rule đó đúng
// cho Giao việc, đơn giản chưa từng có khái niệm "recipient của Proposal").
// Hàm RIÊNG này: nếu flow_type='de_xuat' -> authorize bằng ĐÚNG identity đã
// dùng cho accept/reject/cancel (recipient HOẶC creator HOẶC admin) — KHÔNG
// đụng resolveAndAuthorizeView()/canViewTask() (Permission Contract V1,
// KHÓA). Nếu flow_type='giao_viec' (vd Task sinh ra sau Accept) -> dùng lại
// NGUYÊN VẸN resolveAndAuthorizeView() như bình thường, không đổi 1 rule.
async function getTaskDetailProposalAwareViaServer(session, taskId) {
  const detail = await bridgeGetTaskDetail(taskId);
  if (!detail || !detail.task) {
    const err = new Error('Không tìm thấy task.');
    err.code = 'TASK_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }
  if (detail.task.flow_type === 'de_xuat') {
    const pd = detail.task.proposal_decision;
    const actorContext = await resolveActorContext(session);
    const me = String(actorContext.employeeCode || '').trim().toUpperCase();
    const isAdmin = actorContext.actorType === 'admin';
    const isRecipient = !!pd && !!me && me === String(pd.recipient_employee_code || '').trim().toUpperCase();
    const isCreator = !!pd && !!me && me === String(pd.created_by_employee_code || '').trim().toUpperCase();
    if (!isAdmin && !isRecipient && !isCreator) {
      const err = new Error('Không có quyền xem đề xuất này.');
      err.code = 'TASK_VIEW_DENIED';
      err.statusCode = 403;
      throw err;
    }
  } else {
    await resolveAndAuthorizeView(session, detail.task, detail.assignees);
  }
  const [categoriesResult, orgRows, viewer] = await Promise.all([
    bridgeListTaskCategories(),
    loadOrgRows(),
    resolveTaskViewerAuthority(session, detail.task, detail.assignees),
  ]);
  const categoryDtoObj = (categoriesResult.categories || []).find((c) => c.category_code === detail.task.category_code) || null;
  return assembleTaskDetailDto(detail.task, detail.assignees, detail.comments, detail.links, detail.events, categoryDtoObj, orgRows, viewer, detail.recurrence, detail.cancel_request, detail.attachments);
}

// listProposalRecipientEmployeesViaServer — population cho recipient picker
// (Employee/Permission data, KHÔNG phải Task data — hợp lệ đọc Supabase qua
// chính task-permissions.js::listProposalRecipientEmployees(), KHÔNG cần
// bridge nào, giống hệt listTaskAssignableEmployees() hiện có cho Giao việc).
async function listProposalRecipientEmployeesViaServer(session) {
  return listProposalRecipientEmployees(session);
}

// =============================================================================
// OPEN GAP — CROSS-DEPARTMENT NOTIFICATION (2026-08-27, tường minh, chưa đóng)
// =============================================================================
// publishTaskViaServer() KHÔNG gọi applyCrossDepartmentPublishSideEffects()
// (hàm gốc trong task-core.js, ghi vào Supabase task_notifications). Lý do:
// phf-hr-api (lib/task-write.js) hiện KHÔNG export bất kỳ hàm notification
// nào — không có bảng/route notification tương đương trên phf_hr. Hệ quả cụ
// thể: Task publish qua đường server (flag ON) cho 1 task cross-department
// sẽ KHÔNG tạo notification nào cho manager phòng nhận — người đó phải tự
// vào xem Task, không được báo chủ động.
// KHÔNG "hack" side-effect Supabase vào path này (đúng chỉ đạo — sẽ tạo lại
// đúng vấn đề "ghi 2 nơi" mà toàn bộ nỗ lực migration này đang tránh).
// Đóng gap này cần 1 gate riêng: thiết kế + build notification write path
// trên phf_hr (bảng + route + emit function), sau đó publishTaskViaServer()
// mới gọi tới. KHÔNG chặn việc mở rộng các operation khác — publish/notify
// là 1 cặp business event độc lập với progress/cancel/complete/... vốn
// không bao giờ tạo notification (đã xác nhận ở B.1/Phase 4B forensic
// trước đó: chỉ publishTask tạo notification, không operation nào khác).

module.exports = {
  isServerWriteEnabled,
  createTaskDraftViaServer,
  publishTaskViaServer,
  updateTaskProgressViaServer,
  completeTaskViaServer,
  reopenTaskViaServer,
  cancelTaskViaServer,
  requestTaskCancelViaServer,
  decideTaskCancelRequestViaServer,
  approveTaskCancelRequestViaServer,
  rejectTaskCancelRequestViaServer,
  withdrawTaskCancelRequestViaServer,
  changeTaskDeadlineViaServer,
  transferTaskPrimaryViaServer,
  addTaskRelatedViaServer,
  removeTaskRelatedViaServer,
  addTaskCommentViaServer,
  addTaskLinkViaServer,
  removeTaskLinkViaServer,
  createTaskCategoryViaServer,
  renameTaskCategoryViaServer,
  setTaskCategoryActiveViaServer,
  reorderTaskCategoryViaServer,
  deleteTaskCategoryIfUnusedViaServer,
  setTaskPermissionAssignmentViaServer,
  createTaskPermissionGrantViaServer,
  revokeTaskPermissionGrantViaServer,
  uploadTaskAttachmentViaServer,
  removeTaskAttachmentViaServer,
  downloadTaskAttachmentViaServer,
  getTaskDetailViaServer,
  listTaskEventsViaServer,
  createTaskProposalViaServer,
  acceptTaskProposalViaServer,
  rejectTaskProposalViaServer,
  cancelTaskProposalViaServer,
  listProposalRecipientEmployeesViaServer,
  getTaskDetailProposalAwareViaServer,
};
