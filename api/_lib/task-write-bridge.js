'use strict';

// PHF Task WRITE-path bridge — api/data.js/task-core.js (KHÔNG ĐỔI) → HTTPS
// server-to-server → phf-hr-api → PostgreSQL phf_hr (North Star: Task server
// source-of-truth). Cùng pattern với api/_lib/task-read-bridge.js (đã CLOSED
// cho READ) — KHÔNG phát minh cơ chế mới, chỉ áp lại cho WRITE.
//
// TẮT MẶC ĐỊNH tuyệt đối (PHF_TASK_WRITE_BRIDGE_ENABLED phải ='true' tường
// minh) — nếu KHÔNG bật, module này KHÔNG được require ở bất kỳ đường chạy
// thật nào (chưa wire vào api/data.js/task-core.js trong gate này — đó là
// bước "mở khóa có kiểm soát" RIÊNG, cần xác nhận thêm trước khi chạm
// api/data.js). File này CHỈ LÀ CHUẨN BỊ (Phase 3 — Integration Foundation),
// KHÔNG đổi hành vi Production nào khi tồn tại nhưng chưa được gọi.
//
// KHÔNG tự chạy authorization/permission ở đây — đúng nguyên tắc S3B đã
// CLOSED (authorization LUÔN chạy Ở MAIN APP, tức task-core.js/
// task-permissions.js, TRƯỚC KHI gọi module này). Module này chỉ forward
// request đã được main app validate/authorize xong sang phf-hr-api, và map
// response/error về ĐÚNG shape mà task-core.js's caller (api/data.js) đang
// mong đợi hôm nay — để khi (và chỉ khi) được wire, hành vi phía trên KHÔNG
// cần đổi.
//
// Error contract: phf-hr-api trả { ok:false, code, message } (S3B đã CLOSED,
// error code verbatim với RPC gốc cho phần overlap) — throw lại đúng Error
// có .code/.statusCode để caller xử lý y hệt cách task-core.js's fail()ném
// lỗi hôm nay (không đổi presentation layer).
//
// Actor identity: caller (task-core.js) PHẢI tự resolveActorContext() và
// truyền actorEmployeeCode/actorAccountId — module này KHÔNG tự tra cứu lại
// (đúng S3B mục 6.2).

const PHF_HR_API_BASE_URL = String(process.env.PHF_HR_API_BASE_URL || '').trim().replace(/\/$/, '');
const PHF_HR_API_SERVICE_TOKEN = String(process.env.PHF_HR_API_SERVICE_TOKEN || '').trim();
const BRIDGE_TIMEOUT_MS = 8000;

function isWriteBridgeEnabled() {
  return String(process.env.PHF_TASK_WRITE_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function bridgeFail(message, statusCode, errorCode) {
  const e = new Error(message);
  e.statusCode = statusCode || 502;
  e.code = errorCode || 'TASK_WRITE_BRIDGE_ERROR';
  throw e;
}

function actorPayload(actorEmployeeCode, actorAccountId, interventionBasis) {
  return {
    employeeCode: actorEmployeeCode || undefined,
    accountId: actorAccountId || undefined,
    // Defence-in-depth marker for lifecycle intervention (LOCKED AUTHORITY
    // RULE 2026-08-28). Main app is the authorization authority; phf-hr-api
    // refuses a lifecycle mutation that arrives without a recognised basis.
    interventionBasis: interventionBasis || undefined,
  };
}

// callWriteRoute(path, body) → data (object) trên thành công; throw Error
// (.code/.statusCode khớp verbatim với server) trên lỗi. KHÔNG bao giờ trả
// về response thô chưa unwrap — caller luôn nhận đúng "data" hoặc exception,
// giống style task-core.js's fail()/return pattern hôm nay.
async function callWriteRoute(path, body) {
  preflightCheck();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(PHF_HR_API_BASE_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PHF_HR_API_SERVICE_TOKEN },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') bridgeFail('phf-hr-api không phản hồi kịp thời (timeout).', 504, 'TASK_WRITE_BRIDGE_TIMEOUT');
    bridgeFail('Không kết nối được phf-hr-api: ' + err.message, 502, 'TASK_WRITE_BRIDGE_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }

  let parsed;
  try {
    parsed = await response.json();
  } catch (err) {
    bridgeFail('phf-hr-api trả response không phải JSON hợp lệ.', 502, 'TASK_WRITE_BRIDGE_BAD_RESPONSE');
  }

  unwrapOrThrow(response.ok, parsed, response.status);
  return parsed.data;
}

// unwrapOrThrow — dùng chung cho cả JSON write route lẫn upload (raw binary
// body) vì cả 2 trả cùng envelope { ok:false, code, message }. Verbatim
// pass-through error code/message — S3B contract yêu cầu KHÔNG đổi wording.
function unwrapOrThrow(httpOk, parsed, httpStatus) {
  if (!httpOk || (parsed && parsed.ok === false)) {
    const code = (parsed && parsed.code) || 'TASK_WRITE_BRIDGE_UPSTREAM_ERROR';
    const message = (parsed && parsed.message) || ('phf-hr-api trả lỗi HTTP ' + httpStatus);
    bridgeFail(message, httpStatus, code);
  }
}

function preflightCheck() {
  if (!isWriteBridgeEnabled()) {
    bridgeFail('PHF_TASK_WRITE_BRIDGE_ENABLED chưa bật — module này chưa được phép gọi.', 500, 'TASK_WRITE_BRIDGE_DISABLED');
  }
  if (!PHF_HR_API_BASE_URL || !PHF_HR_API_SERVICE_TOKEN) {
    bridgeFail('PHF_TASK_WRITE_BRIDGE_ENABLED=true nhưng thiếu PHF_HR_API_BASE_URL hoặc PHF_HR_API_SERVICE_TOKEN trong env.', 500, 'TASK_WRITE_BRIDGE_MISCONFIGURED');
  }
}

// -----------------------------------------------------------------------
// Attachment upload/remove/download — Gate 5.6 contract, đọc verbatim
// services/phf-hr-api/server.js dòng 841-916. Upload dùng RAW BINARY BODY
// (KHÔNG multipart/form-data), metadata qua HTTP header — KHÁC hẳn pattern
// JSON body của mọi operation khác trong file này, nên KHÔNG dùng lại
// callWriteRoute(). Download là GET, trả file stream trực tiếp (không phải
// envelope {ok,data}) — caller nhận về {statusCode, headers, stream} thô,
// tự quyết định pipe đi đâu (KHÔNG buffer toàn bộ file vào memory ở đây).
// -----------------------------------------------------------------------

async function bridgeUploadTaskAttachment(taskId, fileBuffer, options) {
  preflightCheck();
  const { filename, mimeType, actorEmployeeCode, actorAccountId, idempotencyKey } = options || {};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(PHF_HR_API_BASE_URL + `/v1/task/tasks/${encodeURIComponent(taskId)}:uploadAttachment`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + PHF_HR_API_SERVICE_TOKEN,
        'Content-Type': mimeType || 'application/octet-stream',
        'Content-Length': String(fileBuffer.length),
        'X-Attachment-Filename': encodeURIComponent(filename || ''),
        'X-Attachment-Actor-Employee-Code': actorEmployeeCode || '',
        'X-Attachment-Actor-Account-Id': actorAccountId || '',
        'X-Attachment-Idempotency-Key': idempotencyKey || '',
      },
      body: fileBuffer,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') bridgeFail('phf-hr-api không phản hồi kịp thời khi upload (timeout).', 504, 'TASK_WRITE_BRIDGE_TIMEOUT');
    bridgeFail('Không kết nối được phf-hr-api khi upload: ' + err.message, 502, 'TASK_WRITE_BRIDGE_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }

  let parsed;
  try { parsed = await response.json(); } catch (err) { bridgeFail('phf-hr-api trả response upload không phải JSON hợp lệ.', 502, 'TASK_WRITE_BRIDGE_BAD_RESPONSE'); }
  unwrapOrThrow(response.ok, parsed, response.status);
  return parsed.data;
}

async function bridgeRemoveTaskAttachment(taskId, attachmentId, reason, actorEmployeeCode, actorAccountId) {
  return callWriteRoute(`/v1/task/tasks/${encodeURIComponent(taskId)}:removeAttachment`, {
    attachmentId, reason,
    actor: { employeeCode: actorEmployeeCode || undefined, accountId: actorAccountId || undefined },
  });
}

// SINGLE TASK READ FOUNDATION (2026-08-27) — GET /v1/task/tasks/:id, state
// source cho seam validate/authorize của lifecycle operation trên task sống
// ở phf_hr. Trả { task, assignees } raw snake_case (KHÔNG remap ở đây —
// caller là task-server-integration.js, tự quyết cách dùng, giữ đúng
// nguyên tắc "adapter không chứa business logic"). task=null nếu không tìm
// thấy (KHÔNG throw TASK_NOT_FOUND ở tầng bridge — để caller tự quyết xử
// lý not-found theo đúng ngữ cảnh operation, giống hệt cách loadTaskRow()
// bên task-core.js throw TASK_NOT_FOUND CHỈ ở nơi gọi nó cần, không phải
// nguyên tắc chung của mọi read).
async function bridgeGetTaskById(taskId) {
  preflightCheck();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(PHF_HR_API_BASE_URL + `/v1/task/tasks/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + PHF_HR_API_SERVICE_TOKEN },
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') bridgeFail('phf-hr-api không phản hồi kịp thời khi đọc task (timeout).', 504, 'TASK_WRITE_BRIDGE_TIMEOUT');
    bridgeFail('Không kết nối được phf-hr-api khi đọc task: ' + err.message, 502, 'TASK_WRITE_BRIDGE_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 404) return { task: null, assignees: [] };

  let parsed;
  try { parsed = await response.json(); } catch (err) { bridgeFail('phf-hr-api trả response đọc task không phải JSON hợp lệ.', 502, 'TASK_WRITE_BRIDGE_BAD_RESPONSE'); }
  if (!response.ok) {
    const code = (parsed && parsed.error) || 'TASK_WRITE_BRIDGE_UPSTREAM_ERROR';
    const message = (parsed && parsed.message) || ('phf-hr-api trả lỗi HTTP ' + response.status);
    bridgeFail(message, response.status, code);
  }
  return parsed.data;
}

// GET route — KHÔNG dùng callWriteRoute (đó là POST-only). Trả về response
// thô (không parse JSON — đây là file binary) để caller tự pipe/stream tiếp,
// tránh buffer file lớn vào memory ở tầng bridge.
async function bridgeDownloadTaskAttachment(taskId, attachmentId) {
  preflightCheck();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(PHF_HR_API_BASE_URL + `/v1/task/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}`, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + PHF_HR_API_SERVICE_TOKEN },
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') bridgeFail('phf-hr-api không phản hồi kịp thời khi download (timeout).', 504, 'TASK_WRITE_BRIDGE_TIMEOUT');
    bridgeFail('Không kết nối được phf-hr-api khi download: ' + err.message, 502, 'TASK_WRITE_BRIDGE_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let parsed;
    try { parsed = await response.json(); } catch (_e) { parsed = null; }
    unwrapOrThrow(false, parsed, response.status);
  }
  return response; // caller: response.body (stream) / response.headers (content-type, filename...)
}

// -----------------------------------------------------------------------
// 1 hàm / 1 operation — mapping args → body ĐÚNG shape server.js kỳ vọng
// (đã đọc verbatim từ services/phf-hr-api/server.js, không đoán field name).
// path :id authoritative — KHÔNG gửi taskId trong body (server bỏ qua nếu
// có, nhưng không gửi cho rõ ràng, tránh hiểu lầm có mismatch-check).
// -----------------------------------------------------------------------

async function bridgeCreateDraftTask(params) {
  const { flowType, title, content, categoryCode, priority, startAt, deadline, primaryEmployeeCode, idempotencyKey, actorEmployeeCode, actorAccountId } = params;
  return callWriteRoute('/v1/task/tasks:create', {
    flowType, title, content, categoryCode, priority, startAt, deadline, primaryEmployeeCode, idempotencyKey,
    actor: actorPayload(actorEmployeeCode, actorAccountId),
  });
}

// sourceDepartment/targetDepartment: PHẢI được CALLER (task-core.js, phía
// main app) tự resolve TRƯỚC khi gọi hàm này — actorContext.department +
// department của primary ACTIVE tại thời điểm publish qua loadOrgRows() —
// đúng thiết kế S3B mục 6.3 đã CLOSED (phf-hr-api KHÔNG tự lookup
// employee_profiles vì bảng đó không tồn tại ở phf_hr). KHÔNG tự suy đoán ở
// đây nếu caller không truyền — để nguyên undefined/null, phf-hr-api tự xử
// lý "thiếu field -> null, không block publish" theo đúng contract đã CLOSED.
// recipientEmployeeCode — Proposal V2 (2026-08-29), optional. Chỉ có ý
// nghĩa khi Task đang publish có flow_type='de_xuat' (phf-hr-api tự bỏ qua
// field này cho 'giao_viec', xem services/phf-hr-api/lib/task-write.js).
// KHÔNG đổi 4 tham số đầu — giữ nguyên contract cũ cho mọi call site Giao
// việc hiện có (undefined không ảnh hưởng gì tới publish Giao việc).
async function bridgePublishTask(taskId, expectedRowVersion, sourceDepartment, targetDepartment, actorEmployeeCode, actorAccountId, recipientEmployeeCode) {
  return callWriteRoute(`/v1/task/tasks/${encodeURIComponent(taskId)}:publish`, {
    expectedRowVersion, sourceDepartment, targetDepartment, recipientEmployeeCode,
    actor: actorPayload(actorEmployeeCode, actorAccountId),
  });
}

// -----------------------------------------------------------------------
// PROPOSAL V2 (2026-08-29, LOCKED Phương án A — PostgreSQL-only, KHÔNG phụ
// thuộc PHF_TASK_SERVER_WRITE_ENABLED) — 3 route mới trên phf-hr-api, cùng
// path style ":id:verb" như mọi route task-id-scoped khác. :id =
// proposal_task_id (Proposal gốc, task.tasks.id có flow_type='de_xuat').
// -----------------------------------------------------------------------
async function bridgeAcceptTaskProposal(proposalTaskId, input, actorEmployeeCode, actorAccountId) {
  const { title, content, categoryCode, priority, startAt, deadline, primaryEmployeeCode } = input || {};
  return callWriteRoute(`/v1/task/tasks/${encodeURIComponent(proposalTaskId)}:acceptProposal`, {
    title, content, categoryCode, priority, startAt, deadline, primaryEmployeeCode,
    actor: actorPayload(actorEmployeeCode, actorAccountId),
  });
}

async function bridgeRejectTaskProposal(proposalTaskId, reason, actorEmployeeCode, actorAccountId) {
  return callWriteRoute(`/v1/task/tasks/${encodeURIComponent(proposalTaskId)}:rejectProposal`, {
    reason, actor: actorPayload(actorEmployeeCode, actorAccountId),
  });
}

async function bridgeCancelTaskProposal(proposalTaskId, reason, actorEmployeeCode, actorAccountId) {
  return callWriteRoute(`/v1/task/tasks/${encodeURIComponent(proposalTaskId)}:cancelProposal`, {
    reason, actor: actorPayload(actorEmployeeCode, actorAccountId),
  });
}

async function bridgeUpdateTaskProgress(taskId, expectedRowVersion, progressPercent, progressStatus, actorEmployeeCode, actorAccountId) {
  return callWriteRoute(`/v1/task/tasks/${encodeURIComponent(taskId)}:updateProgress`, {
    expectedRowVersion, progressPercent, progressStatus, actor: actorPayload(actorEmployeeCode, actorAccountId),
  });
}

async function bridgeCompleteTask(taskId, expectedRowVersion, resultText, actorEmployeeCode, actorAccountId) {
  return callWriteRoute(`/v1/task/tasks/${encodeURIComponent(taskId)}:complete`, {
    expectedRowVersion, resultText, actor: actorPayload(actorEmployeeCode, actorAccountId),
  });
}

async function bridgeReopenTask(taskId, expectedRowVersion, reason, actorEmployeeCode, actorAccountId, interventionBasis) {
  return callWriteRoute(`/v1/task/tasks/${encodeURIComponent(taskId)}:reopen`, {
    expectedRowVersion, reason, actor: actorPayload(actorEmployeeCode, actorAccountId, interventionBasis),
  });
}

async function bridgeCancelTask(taskId, expectedRowVersion, reason, actorEmployeeCode, actorAccountId, interventionBasis) {
  return callWriteRoute(`/v1/task/tasks/${encodeURIComponent(taskId)}:cancel`, {
    expectedRowVersion, reason, actor: actorPayload(actorEmployeeCode, actorAccountId, interventionBasis),
  });
}

// CANCEL POLICY V1 — "Yêu cầu hủy" request flow. PostgreSQL-only.
async function bridgeRequestTaskCancel(taskId, reason, actorEmployeeCode, actorAccountId, reviewerRecipients) {
  return callWriteRoute(`/v1/task/tasks/${encodeURIComponent(taskId)}:requestCancel`, {
    reason,
    actor: actorPayload(actorEmployeeCode, actorAccountId),
    // IN-APP NOTIFICATION V1 — management reviewer(s) the main app resolved
    // canonically (task-core.resolveCancelRequestReviewerRecipients). Optional;
    // the creator is always notified in-transaction regardless.
    reviewerRecipients: Array.isArray(reviewerRecipients) && reviewerRecipients.length ? reviewerRecipients : undefined,
  });
}
// decision: 'approve' | 'reject' | 'withdraw'. opts: { note?, expectedRowVersion?,
// interventionBasis?, actorEmployeeCode, actorAccountId }.
async function bridgeDecideTaskCancelRequest(taskId, decision, opts) {
  const o = opts || {};
  return callWriteRoute(`/v1/task/tasks/${encodeURIComponent(taskId)}:decideCancelRequest`, {
    decision, note: o.note, expectedRowVersion: o.expectedRowVersion,
    actor: actorPayload(o.actorEmployeeCode, o.actorAccountId, o.interventionBasis),
  });
}

async function bridgeChangeTaskDeadline(taskId, expectedRowVersion, newDeadline, reason, actorEmployeeCode, actorAccountId, interventionBasis) {
  return callWriteRoute(`/v1/task/tasks/${encodeURIComponent(taskId)}:changeDeadline`, {
    expectedRowVersion, newDeadline, reason, actor: actorPayload(actorEmployeeCode, actorAccountId, interventionBasis),
  });
}

async function bridgeTransferTaskPrimary(taskId, expectedRowVersion, newPrimaryEmployeeCode, reason, actorEmployeeCode, actorAccountId, interventionBasis) {
  return callWriteRoute(`/v1/task/tasks/${encodeURIComponent(taskId)}:transferPrimary`, {
    expectedRowVersion, newPrimaryEmployeeCode, reason, actor: actorPayload(actorEmployeeCode, actorAccountId, interventionBasis),
  });
}

async function bridgeAddTaskRelated(taskId, targetEmployeeCode, actorEmployeeCode, actorAccountId, interventionBasis) {
  return callWriteRoute(`/v1/task/tasks/${encodeURIComponent(taskId)}:addRelated`, {
    targetEmployeeCode, actor: actorPayload(actorEmployeeCode, actorAccountId, interventionBasis),
  });
}

async function bridgeRemoveTaskRelated(taskId, targetEmployeeCode, actorEmployeeCode, actorAccountId, interventionBasis) {
  return callWriteRoute(`/v1/task/tasks/${encodeURIComponent(taskId)}:removeRelated`, {
    targetEmployeeCode, actor: actorPayload(actorEmployeeCode, actorAccountId, interventionBasis),
  });
}

async function bridgeAddTaskComment(taskId, body, actorEmployeeCode, actorAccountId) {
  return callWriteRoute(`/v1/task/tasks/${encodeURIComponent(taskId)}:addComment`, {
    body, actor: actorPayload(actorEmployeeCode, actorAccountId),
  });
}

async function bridgeAddTaskLink(taskId, side, url, label, actorEmployeeCode, actorAccountId) {
  return callWriteRoute(`/v1/task/tasks/${encodeURIComponent(taskId)}:addLink`, {
    side, url, label, actor: actorPayload(actorEmployeeCode, actorAccountId),
  });
}

async function bridgeRemoveTaskLink(taskId, linkId, actorEmployeeCode, actorAccountId) {
  return callWriteRoute(`/v1/task/tasks/${encodeURIComponent(taskId)}:removeLink`, {
    linkId, actor: actorPayload(actorEmployeeCode, actorAccountId),
  });
}

// -----------------------------------------------------------------------
// Batch 6 + Gate 12 — permission assignment / category CRUD / permission
// grant. Đọc verbatim từ services/phf-hr-api/server.js dòng 737-837 — các
// route này KHÔNG dùng `actor: {employeeCode, accountId}` lồng nhau như
// Batch 1-5, mà gửi actorAccountId/actorEmployeeCode PHẲNG ở top-level body
// (đã đọc đúng, không suy đoán theo pattern trên).
// -----------------------------------------------------------------------

async function bridgeSetTaskPermissionAssignment(targetAccountId, targetEmployeeCode, presetCode, reason, actorEmployeeCode, actorAccountId) {
  return callWriteRoute('/v1/task/permission-assignments:set', {
    targetAccountId, targetEmployeeCode, presetCode, reason, actorAccountId, actorEmployeeCode,
  });
}

// bridgeEmitTaskNotification — đóng OPEN GAP cross-department notification
// (2026-08-27). recipientEmployeeCode/title/message/targetPath/dedupeKey
// PHẢI đã được resolve xong bởi caller (task-server-integration.js dùng lại
// resolveCrossDepartmentNotificationRecipient() từ task-core.js) — bridge
// này chỉ forward, KHÔNG tự quyết ai nhận (đúng nguyên tắc "notification
// follows permission scope" đã CLOSED, xem api/_lib/task-notifications.js).
async function bridgeEmitTaskNotification(taskId, recipientEmployeeCode, title, message, targetPath, dedupeKey) {
  return callWriteRoute(`/v1/task/tasks/${encodeURIComponent(taskId)}:notify`, {
    recipientEmployeeCode, title, message, targetPath, dedupeKey,
  });
}

async function bridgeCreateTaskCategory(categoryCode, displayName, actorEmployeeCode, actorAccountId) {
  return callWriteRoute('/v1/task/categories:create', {
    categoryCode, displayName, actorAccountId, actorEmployeeCode,
  });
}

async function bridgeRenameTaskCategory(categoryCode, displayName, actorEmployeeCode, actorAccountId) {
  return callWriteRoute(`/v1/task/categories/${encodeURIComponent(categoryCode)}:rename`, {
    displayName, actorAccountId, actorEmployeeCode,
  });
}

async function bridgeSetTaskCategoryActive(categoryCode, isActive, actorEmployeeCode, actorAccountId) {
  return callWriteRoute(`/v1/task/categories/${encodeURIComponent(categoryCode)}:setActive`, {
    isActive, actorAccountId, actorEmployeeCode,
  });
}

async function bridgeReorderTaskCategory(categoryCode, sortOrder, actorEmployeeCode, actorAccountId) {
  return callWriteRoute(`/v1/task/categories/${encodeURIComponent(categoryCode)}:reorder`, {
    sortOrder, actorAccountId, actorEmployeeCode,
  });
}

// KHÔNG có actor — deleteTaskCategoryIfUnused không ghi audit column nào
// (đọc verbatim server.js dòng 803-808, KHÔNG tự thêm actor không có căn cứ).
async function bridgeDeleteTaskCategoryIfUnused(categoryCode) {
  return callWriteRoute(`/v1/task/categories/${encodeURIComponent(categoryCode)}:delete`, {});
}

async function bridgeCreateTaskPermissionGrant(granteeEmployeeCode, peopleScope, reason, actorEmployeeCode, actorAccountId) {
  return callWriteRoute('/v1/task/permission-grants:create', {
    granteeEmployeeCode, peopleScope, reason, actorAccountId, actorEmployeeCode,
  });
}

async function bridgeRevokeTaskPermissionGrant(grantId, reason, actorEmployeeCode, actorAccountId) {
  return callWriteRoute(`/v1/task/permission-grants/${encodeURIComponent(grantId)}:revoke`, {
    reason, actorAccountId, actorEmployeeCode,
  });
}

module.exports = {
  isWriteBridgeEnabled,
  bridgeCreateDraftTask,
  bridgePublishTask,
  bridgeUpdateTaskProgress,
  bridgeCompleteTask,
  bridgeReopenTask,
  bridgeCancelTask,
  bridgeRequestTaskCancel,
  bridgeDecideTaskCancelRequest,
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
  bridgeGetTaskById,
  bridgeAcceptTaskProposal,
  bridgeRejectTaskProposal,
  bridgeCancelTaskProposal,
};
