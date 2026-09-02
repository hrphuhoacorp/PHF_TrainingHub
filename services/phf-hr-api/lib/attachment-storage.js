'use strict';

// PHF HR — Gate 5 Attachment/Evidence: filesystem layer THUẦN TÚY, KHÔNG chạm
// DB (KHÔNG require './db', KHÔNG require 'pg'). Chỉ dùng Node core: fs,
// crypto, path, stream — KHÔNG thêm npm dependency, đúng convention
// "zero dependency" đã ghi trong chính server.js.
//
// ATTACHMENT_ROOT: module KHÔNG tự đọc process.env — mọi hàm nhận root qua
// tham số (caller ở tầng trên, vd server.js/task-write.js sau này, tự đọc
// config và truyền vào) — KHÔNG hardcode "/home/phf-storage" ở đây.
//
// THIẾT KẾ RACE-SAFE (G5.2 targeted correction — CLOSED, xem
// G5_2_IDEMPOTENCY_RACE_CORRECTION_REPORT):
//   1. Temp file LUÔN unique-per-request (crypto.randomUUID(), KHÔNG bao giờ
//      derive từ idempotencyKey) — loại bỏ hoàn toàn khả năng 2 request đụng
//      độ ở bước ghi tạm.
//   2. Quyền sở hữu final path được xác lập DUY NHẤT qua fs.open(path,'wx')
//      (O_CREAT|O_EXCL — atomic create-if-absent THẬT ở tầng OS, KHÁC
//      fs.rename() vốn LÀ atomic-REPLACE, KHÔNG PHẢI atomic-create-if-absent).
//      Chỉ request claim THÀNH CÔNG mới được publish (rename temp->final).
//   3. Request thua (EEXIST) KHÔNG BAO GIỜ rename/unlink vào final path của
//      request khác — nó CHỈ được dọn temp file CỦA CHÍNH NÓ.
//   4. Module này KHÔNG BIẾT gì về DB — reclaimStaleClaim() BẮT BUỘC nhận
//      dbRowAbsentConfirmed=true từ caller (DB-layer, sau khi tự SELECT xác
//      nhận không có metadata row nào) — module tự VẪN kiểm tra lại
//      staleness (mtime) trước khi cho phép unlink, đòi hỏi CẢ HAI điều
//      kiện (caller xác nhận + module tự xác nhận), KHÔNG tự suy "file cũ =
//      mồ côi" chỉ dựa 1 phía.
//
// Error model: mọi lỗi throw ra là attachmentStorageError(code, message,
// {cause, detail}) — message PUBLIC-SAFE (KHÔNG chứa absolute OS path); path
// thật (nếu cần debug) nằm ở err.detail, KHÔNG phải err.message. Module này
// KHÔNG tự quyết HTTP status/envelope — đó là việc của route layer (G5.5).

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { Transform, pipeline } = require('stream');
const { promisify } = require('util');
const pipelineAsync = promisify(pipeline);

const { STALE_CLAIM_GRACE_MS } = require('./attachment-policy');

const TMP_DIR_NAME = '.tmp';
const TMP_FILE_SUFFIX = '.part';

// UUID chuẩn (8-4-4-4-12 hex), case-insensitive — verbatim regex đã dùng
// nhất quán trong lib/task-write.js cho idempotencyKey validate.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Employee code format: uppercase alnum + underscore, khớp mọi mã đã thấy
// trong repo (PHF001, PARITY_TEST_E07, TEST_B46_HTTP_ACTOR...).
const EMPLOYEE_CODE_RE = /^[A-Z0-9_]{1,64}$/;

// ATTACHMENT ACTOR IDENTITY (2026-09-02) — the object-key actor segment is a
// TYPED, path-safe representation so an Admin-only actor (accountId present,
// employeeCode = '') can upload without ambiguity vs an employee actor:
//   employeeCode -> "EMP_<CODE>"   (CODE already matches EMPLOYEE_CODE_RE)
//   accountId    -> "ACC_<ID>"     (ID normalized/validated below)
// Priority: employeeCode first, else accountId, else reject. The two prefixes
// can never collide (EMP_ vs ACC_) and neither can contain '/', '\', '..',
// spaces or a null byte — every allowed char is in the validating regex.
// Account ids seen in this repo: Supabase auth UUIDs (hex + '-') and the
// synthetic system-cron ids ("system-task-recurrence-cron"). Both match.
const ACCOUNT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function buildActorSegment({ actorEmployeeCode, actorAccountId }) {
  const emp = String(actorEmployeeCode || '').trim();
  if (emp) {
    if (!EMPLOYEE_CODE_RE.test(emp)) {
      throw attachmentStorageError('ATTACHMENT_STORAGE_INVALID_ACTOR', 'actorEmployeeCode không hợp lệ.');
    }
    return `EMP_${emp}`;
  }
  const acc = String(actorAccountId || '').trim();
  if (acc) {
    if (!ACCOUNT_ID_RE.test(acc)) {
      throw attachmentStorageError('ATTACHMENT_STORAGE_INVALID_ACTOR', 'actorAccountId không hợp lệ.');
    }
    return `ACC_${acc}`;
  }
  throw attachmentStorageError('ATTACHMENT_STORAGE_INVALID_ACTOR', 'Thiếu danh tính người thao tác (employeeCode hoặc accountId).');
}

function attachmentStorageError(code, message, extra) {
  const err = new Error(message);
  err.code = code;
  if (extra && extra.cause) err.cause = extra.cause;
  if (extra && extra.detail) err.detail = extra.detail;
  return err;
}

// ---------------------------------------------------------------------------
// Object key / path safety
// ---------------------------------------------------------------------------

// Deterministic, KHÔNG chứa original filename (đúng OBJECT_KEY_DESIGN đã
// CLOSED). Validate CẢ 3 thành phần bằng allowlist-regex TRƯỚC khi build
// string — '../', path separator, null byte, hay bất kỳ ký tự lạ nào đều
// KHÔNG thể khớp regex nên tự động bị chặn, không cần blocklist riêng.
function buildObjectKey({ taskId, actorEmployeeCode, actorAccountId, idempotencyKey }) {
  const taskIdStr = String(taskId || '');
  const keyStr = String(idempotencyKey || '');

  if (!UUID_RE.test(taskIdStr)) {
    throw attachmentStorageError('ATTACHMENT_STORAGE_INVALID_TASK_ID', 'taskId không hợp lệ.');
  }
  // Typed, path-safe actor segment (EMP_<code> / ACC_<accountId>). Throws
  // ATTACHMENT_STORAGE_INVALID_ACTOR when neither identity is present/valid.
  const actorSegment = buildActorSegment({ actorEmployeeCode, actorAccountId });
  if (!UUID_RE.test(keyStr)) {
    throw attachmentStorageError('ATTACHMENT_STORAGE_INVALID_IDEMPOTENCY_KEY', 'idempotencyKey không hợp lệ.');
  }

  return `tasks/${taskIdStr}/${actorSegment}/${keyStr}`;
}

// Defense-in-depth: dù objectKey chỉ có thể sinh ra từ buildObjectKey() (đã
// allowlist-validate), VẪN xác nhận lại resolved path nằm dưới root tuyệt
// đối trước khi trả về — "Không tin sanitize một lớp" (chỉ định tường minh).
function resolveFinalPath(root, objectKey) {
  const resolvedRoot = path.resolve(String(root || ''));
  const finalPath = path.resolve(resolvedRoot, objectKey);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (finalPath !== resolvedRoot && !finalPath.startsWith(rootWithSep)) {
    throw attachmentStorageError('ATTACHMENT_STORAGE_PATH_ESCAPE', 'Đường dẫn lưu trữ không hợp lệ.', {
      detail: { objectKey },
    });
  }
  return finalPath;
}

// ---------------------------------------------------------------------------
// Temp file — LUÔN unique-per-request (crypto.randomUUID()), KHÔNG BAO GIỜ
// derive từ idempotencyKey (đúng G5.2 correction — loại race ở bước ghi tạm).
// ---------------------------------------------------------------------------
function createTempPath(root) {
  const resolvedRoot = path.resolve(String(root || ''));
  return path.join(resolvedRoot, TMP_DIR_NAME, `${crypto.randomUUID()}${TMP_FILE_SUFFIX}`);
}

function isOwnedTempPath(root, tempPath) {
  const resolvedRoot = path.resolve(String(root || ''));
  const tmpDir = path.join(resolvedRoot, TMP_DIR_NAME);
  const resolvedTemp = path.resolve(String(tempPath || ''));
  return path.dirname(resolvedTemp) === tmpDir && resolvedTemp.endsWith(TMP_FILE_SUFFIX);
}

// ---------------------------------------------------------------------------
// Streaming write — SHA256 + byte-count THẬT trong lúc stream, KHÔNG buffer
// toàn bộ file vào RAM, KHÔNG tin Content-Length khai báo — abort ngay khi
// byte THẬT vượt maxBytes.
// ---------------------------------------------------------------------------
async function streamToTempFile(readable, tempPath, { maxBytes }) {
  await fsp.mkdir(path.dirname(tempPath), { recursive: true });

  const hash = crypto.createHash('sha256');
  let byteSize = 0;

  const counter = new Transform({
    transform(chunk, _enc, callback) {
      byteSize += chunk.length;
      if (byteSize > maxBytes) {
        callback(attachmentStorageError('ATTACHMENT_STORAGE_TOO_LARGE', 'File vượt quá dung lượng cho phép.'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  // 'wx' — temp path đã unique-per-request (đảm bảo bởi createTempPath), 'wx'
  // ở đây là defense-in-depth (fail loud nếu tình huống không thể xảy ra
  // theo lý thuyết lại xảy ra), KHÔNG phải cơ chế chính chống race (đó là
  // claimFinalPath() bên dưới, trên FINAL path, không phải temp path).
  const writeStream = fs.createWriteStream(tempPath, { flags: 'wx' });

  try {
    await pipelineAsync(readable, counter, writeStream);
  } catch (err) {
    await cleanupTempFile(tempPath);
    if (err && err.code && String(err.code).startsWith('ATTACHMENT_STORAGE_')) throw err;
    throw attachmentStorageError('ATTACHMENT_STORAGE_WRITE_FAILED', 'Không ghi được file tạm.', { cause: err });
  }

  return { tempPath, sha256: hash.digest('hex'), byteSize };
}

// Chỉ được gọi cho temp file — KHÔNG dùng hàm này cho final path (xem
// COMPENSATION / OWNERSHIP — final path có quy tắc unlink RIÊNG, nghiêm ngặt
// hơn, ở reclaimStaleClaim()).
async function cleanupTempFile(tempPath) {
  try {
    await fsp.unlink(tempPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return; // đã không còn tồn tại — không phải lỗi
    throw attachmentStorageError('ATTACHMENT_STORAGE_WRITE_FAILED', 'Không dọn được file tạm.', { cause: err });
  }
}

// ---------------------------------------------------------------------------
// Exclusive final-path claim — CHÍNH LÀ cơ chế chống race duy nhất cho final
// path. fs.open(path,'wx') = O_CREAT|O_EXCL, atomic create-if-absent THẬT ở
// tầng OS — request claim THÀNH CÔNG mới được publish (rename temp->final).
// ---------------------------------------------------------------------------
async function claimFinalPath(finalPath) {
  await fsp.mkdir(path.dirname(finalPath), { recursive: true });

  let handle;
  try {
    handle = await fsp.open(finalPath, 'wx');
  } catch (err) {
    if (err && err.code === 'EEXIST') return { claimed: false };
    throw attachmentStorageError('ATTACHMENT_STORAGE_WRITE_FAILED', 'Không claim được vị trí lưu trữ.', { cause: err });
  }
  await handle.close();
  return { claimed: true };
}

// CHỈ gọi SAU KHI claimFinalPath() trả claimed:true cho ĐÚNG finalPath này —
// contract theo docs, module không tự giữ token/state để enforce cứng (giữ
// module ở dạng function thuần, stateless), nhưng rename() tại thời điểm
// này AN TOÀN vì không request nào khác có thể đã claim cùng finalPath
// (fs.open('wx') đã loại trừ điều đó ở bước claim).
async function publishTempToFinal(tempPath, finalPath) {
  try {
    await fsp.rename(tempPath, finalPath);
  } catch (err) {
    throw attachmentStorageError('ATTACHMENT_STORAGE_WRITE_FAILED', 'Không publish được file vào vị trí lưu trữ cuối.', { cause: err });
  }
}

// ---------------------------------------------------------------------------
// Stale-claim inspection — CHỈ phân loại (absent/fresh/stale) dựa trên mtime,
// KHÔNG BIẾT và KHÔNG ĐƯỢC biết gì về DB. Caller (DB-layer) tự quyết định có
// gọi reclaimStaleClaim() hay không dựa trên kết quả này CỘNG với việc DB
// xác nhận không có metadata row.
// ---------------------------------------------------------------------------
async function inspectFinalPath(finalPath, options) {
  const graceMs = (options && Number.isFinite(options.graceMs)) ? options.graceMs : STALE_CLAIM_GRACE_MS;
  let stat;
  try {
    stat = await fsp.stat(finalPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return { status: 'absent' };
    throw attachmentStorageError('ATTACHMENT_STORAGE_READ_FAILED', 'Không đọc được trạng thái vị trí lưu trữ.', { cause: err });
  }
  const ageMs = Date.now() - stat.mtimeMs;
  return { status: ageMs > graceMs ? 'stale' : 'fresh', mtimeMs: stat.mtimeMs, ageMs };
}

// ---------------------------------------------------------------------------
// Reclaim — invariant BẮT BUỘC (G5.2 correction, chỉ định tường minh lượt
// này): module KHÔNG được tự suy "file cũ = mồ côi" chỉ từ 1 phía. Yêu cầu
// CẢ HAI: (a) caller xác nhận tường minh dbRowAbsentConfirmed===true (DB-
// layer đã tự SELECT và xác nhận không có metadata row nào cho key này), VÀ
// (b) module tự kiểm tra lại mtime và xác nhận status==='stale'. Thiếu 1
// trong 2 -> throw ATTACHMENT_STORAGE_RECLAIM_NOT_ALLOWED, KHÔNG unlink.
// ---------------------------------------------------------------------------
async function reclaimStaleClaim({ finalPath, dbRowAbsentConfirmed, graceMs }) {
  if (dbRowAbsentConfirmed !== true) {
    throw attachmentStorageError(
      'ATTACHMENT_STORAGE_RECLAIM_NOT_ALLOWED',
      'Reclaim yêu cầu xác nhận tường minh từ DB-layer rằng không có metadata row nào cho vị trí này.'
    );
  }
  const inspection = await inspectFinalPath(finalPath, { graceMs });
  if (inspection.status !== 'stale') {
    throw attachmentStorageError(
      'ATTACHMENT_STORAGE_RECLAIM_NOT_ALLOWED',
      'Vị trí lưu trữ không đủ điều kiện stale (còn mới hoặc không tồn tại) — từ chối reclaim.'
    );
  }
  try {
    await fsp.unlink(finalPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return { reclaimed: true }; // đã biến mất (dọn bởi nơi khác) — coi như thành công
    throw attachmentStorageError('ATTACHMENT_STORAGE_WRITE_FAILED', 'Không dọn được vị trí lưu trữ cũ.', { cause: err });
  }
  return { reclaimed: true };
}

// KHÔNG có hàm removePhysical()/deleteFinal() generic nào khác trong module
// này — CHỈ CÓ reclaimStaleClaim() (2 điều kiện bắt buộc ở trên) là đường
// DUY NHẤT để unlink 1 final path. HTTP logical-remove (status='pending_delete'
// trong DB) KHÔNG bao giờ gọi bất kỳ hàm xóa vật lý nào ở tầng route — đúng
// G5.1 quyết định #6 "Physical cleanup là worker/job riêng sau".

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------
async function statFinalPath(finalPath) {
  try {
    return await fsp.stat(finalPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw attachmentStorageError('ATTACHMENT_STORAGE_OBJECT_NOT_FOUND', 'Không tìm thấy đối tượng lưu trữ.');
    }
    throw attachmentStorageError('ATTACHMENT_STORAGE_READ_FAILED', 'Không đọc được đối tượng lưu trữ.', { cause: err });
  }
}

// Trả thẳng fs.ReadStream — lỗi (nếu object biến mất giữa statFinalPath() và
// lúc gọi hàm này) sẽ emit qua sự kiện 'error' của stream, caller (route
// layer G5.5) tự xử lý — createReadStream() không throw đồng bộ.
function createFinalReadStream(finalPath) {
  return fs.createReadStream(finalPath);
}

module.exports = {
  TMP_DIR_NAME,
  buildActorSegment,
  buildObjectKey,
  resolveFinalPath,
  createTempPath,
  isOwnedTempPath,
  streamToTempFile,
  cleanupTempFile,
  claimFinalPath,
  publishTempToFinal,
  inspectFinalPath,
  reclaimStaleClaim,
  statFinalPath,
  createFinalReadStream,
};
