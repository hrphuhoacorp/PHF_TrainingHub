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
const { listTaskCategories, TaskReadError } = require('./lib/task-read');
const { executeResolvedTaskQuery } = require('./lib/task-query-executor');
const {
  updateTaskProgress, completeTask, reopenTask, cancelTask, changeTaskDeadline,
  createDraftTask, publishTask,
  transferTaskPrimary, addTaskRelated, removeTaskRelated,
  addTaskComment, addTaskLink, removeTaskLink,
  setTaskPermissionAssignment,
} = require('./lib/task-write');

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

// setTaskPermissionAssignment KHÔNG có taskId (gán preset cho 1 người, không
// gắn với Task cụ thể nào — đúng signature task-write.js/RPC nguồn) nên
// KHÔNG thể dùng path "/v1/task/tasks/:id:verb". Route dưới đây là 1 RESOURCE
// PATH MỚI (chưa từng có tiền lệ Batch 1-3) — đây LÀ điểm cần xác nhận rõ
// ràng trước deploy, xem BATCH_4_6_ROUTE_WIRING_REPORT mục "NEW_RESOURCE_PATH".
const TASK_PERMISSION_ASSIGNMENT_SET_RE = /^\/v1\/task\/permission-assignments:set$/;

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

function createServer(config) {
  const authCheck = requireServiceToken(config.SERVICE_TOKEN);
  const startedAt = Date.now();

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
        const setPermissionAssignmentMatch = path.match(TASK_PERMISSION_ASSIGNMENT_SET_RE);

        if (
          updateProgressMatch || completeMatch || reopenMatch || cancelMatch || changeDeadlineMatch || createMatch || publishMatch ||
          transferPrimaryMatch || addRelatedMatch || removeRelatedMatch || addCommentMatch || addLinkMatch || removeLinkMatch ||
          setPermissionAssignmentMatch
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
            };
            return handleTaskWriteOperation(config, res, path, publishTask, args);
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
