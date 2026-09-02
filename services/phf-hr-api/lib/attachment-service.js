'use strict';

// PHF HR — Gate 5.5 Attachment orchestration. Ghép lib/attachment-storage.js
// (filesystem, G5.3 CLOSED) và lib/task-write.js attachment primitives (DB,
// G5.4 CLOSED) thành 1 luồng an toàn cho upload/remove/download. Module này
// KHÔNG thêm business rule mới, KHÔNG nới bất kỳ invariant nào đã CLOSED ở
// G5.1/G5.2/G5.3/G5.4 — nó chỉ QUYẾT ĐỊNH THỨ TỰ GỌI 2 tầng kia.
//
// Filesystem transaction và Postgres transaction KHÔNG PHẢI 1 distributed
// transaction — không có 2-phase-commit nào ở đây. Boundary xử lý rõ ràng
// bằng invariant sẵn có: reclaimStaleClaim() (lib/attachment-storage.js) là
// đường DUY NHẤT được phép unlink 1 final path, và nó CHỈ chạy khi (a) DB-
// layer tự SELECT xác nhận không có metadata row cho object key này, VÀ (b)
// bản thân file đã "stale" (> STALE_CLAIM_GRACE_MS). Xem "DB FAILURE SAU KHI
// PUBLISH" bên dưới — đây CHÍNH LÀ lý do STALE_CLAIM_GRACE_MS/reclaimStaleClaim
// tồn tại, KHÔNG phải 1 contradiction cần HOLD.

const path = require('path');
const storage = require('./attachment-storage');
const taskWrite = require('./task-write');
const { isAllowedMime, isAllowedMimeExtensionPair, MAX_FILE_SIZE, MAX_ACTIVE_ATTACHMENTS_PER_TASK } = require('./attachment-policy');

// Tối đa số lần thử claim final path trong 1 lượt gọi uploadAttachment().
// 2 là đủ cho luồng "loser phát hiện stale -> reclaim -> retry claim thành
// công"; nếu vẫn thua sau 2 lần (tranh chấp dồn dập bất thường), trả lỗi
// retryable cho caller thay vì loop vô hạn.
const MAX_CLAIM_ATTEMPTS = 2;

function orchestrationError(code, message, extra) {
  const err = new Error(message);
  err.code = code;
  if (extra && extra.cause) err.cause = extra.cause;
  if (extra && extra.detail) err.detail = extra.detail;
  return err;
}

async function safeCleanupTempFile(tempPath) {
  try {
    await storage.cleanupTempFile(tempPath);
  } catch (_err) {
    // best-effort — lỗi dọn temp không được che lấp lỗi chính đang throw
  }
}

// path.extname() thuần Node core, KHÔNG thêm dependency. Trả '' (falsy) nếu
// filename không có phần mở rộng — caller (uploadAttachment) tự throw.
function deriveExtension(filename) {
  const ext = path.extname(String(filename || ''));
  return ext ? ext.slice(1).toLowerCase() : '';
}

// ---------------------------------------------------------------------------
// uploadAttachment — xem UPLOAD ORCHESTRATION CONTRACT (mục 11 handoff).
//
// Input: { config, storageRoot, taskId, actorEmployeeCode, idempotencyKey,
//          originalFilename, mimeType, readableStream }
//
// Thứ tự: validate policy (KHÔNG chạm FS/DB) -> buildObjectKey (thuần,
// KHÔNG chạm FS/DB) -> replay lookup DB (TRƯỚC khi stream, đúng G5.2) ->
// nếu chưa có: stream vào temp -> claimAndPublish (claim/publish/DB-create,
// có retry cho loser/stale-reclaim).
// ---------------------------------------------------------------------------
async function uploadAttachment(config, params) {
  const {
    storageRoot,
    taskId,
    actorEmployeeCode,
    idempotencyKey,
    originalFilename,
    mimeType,
    readableStream,
  } = params || {};

  const root = storageRoot && String(storageRoot).trim();
  if (!root) throw orchestrationError('ATTACHMENT_ORCHESTRATION_STORAGE_ROOT_REQUIRED', 'Thiếu cấu hình thư mục lưu trữ.');

  const filename = originalFilename && String(originalFilename).trim();
  if (!filename) throw orchestrationError('ATTACHMENT_ORCHESTRATION_FILENAME_REQUIRED', 'Thiếu tên file gốc.');

  if (!isAllowedMime(mimeType)) throw orchestrationError('ATTACHMENT_ORCHESTRATION_MIME_INVALID', 'Định dạng file không được hỗ trợ.');

  const ext = deriveExtension(filename);
  if (!ext) throw orchestrationError('ATTACHMENT_ORCHESTRATION_EXTENSION_REQUIRED', 'Không xác định được phần mở rộng file.');

  // FILE ATTACHMENT V1 — the filename extension must match the declared MIME
  // (both already known to be in the allowlist via isAllowedMime above). This
  // is the "do not trust the filename alone" cross-check: a mismatched pair
  // (e.g. an executable renamed .pdf, or a .pdf sent as image/jpeg) is rejected
  // before a single byte is streamed or a claim is made.
  if (!isAllowedMimeExtensionPair(mimeType, ext)) {
    throw orchestrationError('ATTACHMENT_ORCHESTRATION_MIME_EXTENSION_MISMATCH', 'Phần mở rộng tệp không khớp với định dạng khai báo.');
  }

  if (!readableStream) throw orchestrationError('ATTACHMENT_ORCHESTRATION_STREAM_REQUIRED', 'Thiếu dữ liệu file.');

  // buildObjectKey tự validate taskId/actorEmployeeCode/idempotencyKey bằng
  // allowlist-regex (ATTACHMENT_STORAGE_INVALID_*) — KHÔNG lặp lại validate
  // ở đây, tránh 2 nguồn sự thật cho cùng 1 rule.
  const objectKey = storage.buildObjectKey({ taskId, actorEmployeeCode, idempotencyKey });
  const finalPath = storage.resolveFinalPath(root, objectKey);

  // A. Replay — DB đã có row cho object key này (request lặp lại/y hệt
  // trước đó đã thành công) -> trả thẳng winner, KHÔNG stream/upload lại,
  // KHÔNG tạo duplicate event.
  const existing = await taskWrite.findTaskAttachmentByObjectKey(config, { storedObjectKey: objectKey });
  if (existing) return { attachment: existing, replayed: true };

  // FILE ATTACHMENT V1 — per-task soft cap. Checked AFTER the replay lookup (a
  // retry of an already-recorded upload must still succeed) and BEFORE
  // streaming (so a 4 MB body is never accepted just to be rejected). Not a
  // hard transactional guarantee — a tiny overshoot under simultaneous uploads
  // is accepted for V1; nothing is ever pre-deleted to make room.
  const activeCount = await taskWrite.countActiveTaskAttachments(config, { taskId });
  if (activeCount >= MAX_ACTIVE_ATTACHMENTS_PER_TASK) {
    throw orchestrationError(
      'ATTACHMENT_ORCHESTRATION_LIMIT_REACHED',
      'Công việc đã đạt giới hạn ' + MAX_ACTIVE_ATTACHMENTS_PER_TASK + ' tệp đính kèm. Hãy gỡ bớt tệp cũ trước khi thêm mới.'
    );
  }

  // B. Fresh upload — stream vào temp file unique-per-request. Byte thật +
  // checksum tính trong lúc stream (streamToTempFile tự abort + tự dọn temp
  // của chính nó nếu vượt MAX_FILE_SIZE — KHÔNG cần orchestrator lặp lại).
  const tempPath = storage.createTempPath(root);
  const { sha256, byteSize } = await storage.streamToTempFile(readableStream, tempPath, { maxBytes: MAX_FILE_SIZE });

  if (!(byteSize > 0)) {
    await safeCleanupTempFile(tempPath);
    throw orchestrationError('ATTACHMENT_ORCHESTRATION_EMPTY_FILE', 'File rỗng, không được chấp nhận.');
  }

  return claimAndPublish({
    config,
    root,
    objectKey,
    finalPath,
    tempPath,
    taskId,
    actorEmployeeCode,
    filename,
    mimeType,
    ext,
    byteSize,
    checksum: sha256,
  });
}

// ---------------------------------------------------------------------------
// claimAndPublish — vòng claim/publish/DB-create, xử lý C/D/E của mục 11.
// ---------------------------------------------------------------------------
async function claimAndPublish(ctx) {
  const { config, root, objectKey, finalPath, tempPath, taskId, actorEmployeeCode, filename, mimeType, ext, byteSize, checksum } = ctx;

  for (let attempt = 1; attempt <= MAX_CLAIM_ATTEMPTS; attempt += 1) {
    const claim = await storage.claimFinalPath(finalPath);

    if (claim.claimed) {
      try {
        await storage.publishTempToFinal(tempPath, finalPath);
      } catch (err) {
        // rename thất bại -> tempPath của ta vẫn còn nguyên (rename không
        // partial-move) -> dọn temp của chính ta. Final path (claim rỗng do
        // fs.open('wx') tạo ra) là orphan sẽ được reclaim sau (stale +
        // DB-absent) — KHÔNG tự unlink ở đây, đúng "reclaimStaleClaim là
        // đường unlink duy nhất".
        await safeCleanupTempFile(tempPath);
        throw err;
      }

      // ---- E. DB FAILURE SAU KHI PUBLISH PHYSICAL FINAL ----
      // File vật lý đã ở final path (đã publish xong, không còn temp để
      // dọn). Nếu createTaskAttachmentMetadata() throw (mất kết nối DB,
      // lỗi ràng buộc bất ngờ, ...), ta KHÔNG được tự unlink final path —
      // đó là hành vi generic-delete bị cấm tường minh. Đây CHÍNH LÀ tình
      // huống STALE_CLAIM_GRACE_MS/reclaimStaleClaim() được thiết kế để xử
      // lý: file trở thành "orphan claim", sau STALE_CLAIM_GRACE_MS một
      // request retry VỚI CÙNG idempotencyKey (=> cùng objectKey, deterministic)
      // sẽ đi vào nhánh loser bên dưới, tự xác nhận DB row vẫn absent, tự
      // thấy claim đã stale, và gọi reclaimStaleClaim() (2-guard) trước khi
      // claim lại. Không có contradiction — đây là compensation hợp lệ DUY
      // NHẤT với contract CLOSED hiện tại: compensation trì hoãn qua retry
      // idempotent, không phải unlink đồng bộ ngay tại request đã fail.
      try {
        const attachment = await taskWrite.createTaskAttachmentMetadata(config, {
          taskId,
          originalFilename: filename,
          storedObjectKey: objectKey,
          mimeType,
          extension: ext,
          sizeBytes: byteSize,
          checksumSha256: checksum,
          uploadedByEmployeeCode: actorEmployeeCode,
        });
        return { attachment, replayed: false };
      } catch (err) {
        throw orchestrationError(
          'ATTACHMENT_ORCHESTRATION_METADATA_FAILED_AFTER_PUBLISH',
          'Đã lưu file nhưng không ghi được thông tin đính kèm — vui lòng thử lại sau.',
          { cause: err, detail: { objectKey } }
        );
      }
    }

    // ---- C. Claim loser ----
    // Tuyệt đối không overwrite/unlink final path của người khác.
    const winner = await taskWrite.findTaskAttachmentByObjectKey(config, { storedObjectKey: objectKey });
    if (winner) {
      await safeCleanupTempFile(tempPath);
      return { attachment: winner, replayed: true };
    }

    const inspection = await storage.inspectFinalPath(finalPath);

    if (inspection.status === 'fresh') {
      // Có 1 request khác đang publish/ghi metadata cho đúng object key này
      // (chưa đủ stale). KHÔNG chạm file của họ — trả lỗi retryable.
      await safeCleanupTempFile(tempPath);
      throw orchestrationError(
        'ATTACHMENT_ORCHESTRATION_UPLOAD_IN_PROGRESS',
        'Đính kèm này đang được xử lý bởi 1 yêu cầu khác, vui lòng thử lại sau.',
        { detail: { objectKey } }
      );
    }

    if (inspection.status === 'stale') {
      // DB đã tự xác nhận absent (winner lookup ở trên trả null) VÀ storage
      // tự xác nhận stale (mtime) -> đủ 2 điều kiện bắt buộc của
      // reclaimStaleClaim(). Reclaim xong thì retry claim ở vòng lặp kế.
      try {
        await storage.reclaimStaleClaim({ finalPath, dbRowAbsentConfirmed: true });
      } catch (err) {
        await safeCleanupTempFile(tempPath);
        throw err;
      }
    }
    // status === 'absent' (file biến mất giữa lúc claim thua và inspect,
    // vd bị reclaim bởi tiến trình khác) -> không cần làm gì thêm, vòng lặp
    // kế sẽ tự claim lại — tempPath của ta vẫn còn nguyên để publish.
  }

  await safeCleanupTempFile(tempPath);
  throw orchestrationError(
    'ATTACHMENT_ORCHESTRATION_UPLOAD_IN_PROGRESS',
    'Không thể hoàn tất upload do tranh chấp vị trí lưu trữ, vui lòng thử lại.',
    { detail: { objectKey } }
  );
}

// ---------------------------------------------------------------------------
// removeAttachment — REMOVE ORCHESTRATION CONTRACT (mục 12 handoff): logical
// remove ĐÃ CLOSED là active -> pending_delete trong DB, KHÔNG chạm
// filesystem (physical cleanup là worker/job riêng, ngoài phạm vi G5.5).
// Hàm này là pass-through TƯỜNG MINH sang lib/task-write.js — orchestrator
// không "phát minh" thêm bước nào ở đây, đúng chỉ định "không phát minh
// cleanup worker trong G5.5".
// ---------------------------------------------------------------------------
async function removeAttachment(config, params) {
  return taskWrite.removeTaskAttachment(config, params);
}

// ---------------------------------------------------------------------------
// downloadAttachment — DOWNLOAD ORCHESTRATION CONTRACT (mục 13 handoff):
// chỉ lấy metadata 'active' -> resolve final path an toàn -> stat -> mở read
// stream. KHÔNG mutate DB trong path này (kể cả khi physical object mất),
// KHÔNG ghi download event.
// ---------------------------------------------------------------------------
async function downloadAttachment(config, params) {
  const { taskId, attachmentId, storageRoot } = params || {};

  const root = storageRoot && String(storageRoot).trim();
  if (!root) throw orchestrationError('ATTACHMENT_ORCHESTRATION_STORAGE_ROOT_REQUIRED', 'Thiếu cấu hình thư mục lưu trữ.');

  // Chỉ trả metadata status='active' — pending_delete/không tồn tại đều gộp
  // chung TASK_ATTACHMENT_NOT_FOUND (không tiết lộ đã từng tồn tại), đúng
  // hợp đồng đã CLOSED của lib/task-write.js.
  const attachment = await taskWrite.getTaskAttachmentForDownload(config, { taskId, attachmentId });

  const finalPath = storage.resolveFinalPath(root, attachment.stored_object_key);
  // statFinalPath throw ATTACHMENT_STORAGE_OBJECT_NOT_FOUND nếu file vật lý
  // mất dù DB nói active — lỗi kỹ thuật riêng, KHÔNG mutate DB ở đây.
  const stat = await storage.statFinalPath(finalPath);
  const stream = storage.createFinalReadStream(finalPath);

  return { attachment, stream, stat };
}

module.exports = {
  uploadAttachment,
  removeAttachment,
  downloadAttachment,
};
