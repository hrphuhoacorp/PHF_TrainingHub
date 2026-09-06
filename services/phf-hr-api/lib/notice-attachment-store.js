'use strict';

// PHF HR — THÔNG BÁO QUẢN TRỊ V1 · Batch 02 · attachment filesystem layer.
//
// REUSES the existing PHF secure attachment storage primitives
// (lib/attachment-storage.js — race-safe claim/publish, traversal-guarded
// resolveFinalPath, streamed reads). It does NOT re-implement storage; it only
// supplies a notice-scoped object key and the small MIME/type allow-list.
//
//   object key: notice/<noticeId>/<attachmentId>     (both server-generated UUIDs)
//   root      : config.PHF_HR_ATTACHMENT_ROOT         (same root as Task attachments)
//
// No public/unauthenticated URL: bytes only ever leave through the
// service-token /v1/notice channel (base64), which is itself reached only via
// an authenticated PHF HR session -> api/data -> bridge.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const storage = require('./attachment-storage');

const MAX_BYTES = 4 * 1024 * 1024; // §19 — 4 MB, matches the /v1/notice body cap
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// business file type -> allowed mime prefixes + extensions (image / pdf / word / excel)
const FILE_TYPES = {
  image: { mimes: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'], exts: ['.png', '.jpg', '.jpeg', '.gif', '.webp'] },
  pdf: { mimes: ['application/pdf'], exts: ['.pdf'] },
  word: { mimes: ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], exts: ['.doc', '.docx'] },
  excel: { mimes: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], exts: ['.xls', '.xlsx'] },
};

class NoticeAttachmentError extends Error {
  constructor(code, message, statusCode) { super(message || code); this.code = code; this.statusCode = statusCode || 400; this.isNoticeError = true; }
}
function err(code, m, s) { return new NoticeAttachmentError(code, m, s); }

function classify(fileName, mimeType) {
  const ext = (String(fileName || '').match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
  const mime = String(mimeType || '').toLowerCase().split(';')[0].trim();
  for (const t of Object.keys(FILE_TYPES)) {
    const spec = FILE_TYPES[t];
    if (spec.exts.indexOf(ext) >= 0 && (!mime || spec.mimes.indexOf(mime) >= 0)) return t;
    if (mime && spec.mimes.indexOf(mime) >= 0 && (!ext || spec.exts.indexOf(ext) >= 0)) return t;
  }
  throw err('NOTICE_ATTACH_TYPE', 'Chỉ nhận ảnh, PDF, Word hoặc Excel (đuôi tệp phải khớp định dạng).', 400);
}

function objectKey(noticeId, attachmentId) {
  if (!UUID_RE.test(String(noticeId)) || !UUID_RE.test(String(attachmentId))) throw err('NOTICE_ATTACH_KEY', 'Định danh tệp không hợp lệ.', 400);
  return 'notice/' + noticeId + '/' + attachmentId;
}

// Write a base64 payload to the store. Returns { attachmentId, fileType, byteSize }.
async function putFile(root, noticeId, fileName, mimeType, base64) {
  if (!root || !String(root).trim()) throw err('NOTICE_ATTACH_STORE', 'Thiếu cấu hình thư mục lưu trữ tệp.', 500);
  const fileType = classify(fileName, mimeType);
  let buf;
  try { buf = Buffer.from(String(base64 || ''), 'base64'); } catch (e) { buf = null; }
  if (!buf || !buf.length) throw err('NOTICE_ATTACH_EMPTY', 'Tệp rỗng hoặc không hợp lệ.', 400);
  if (buf.length > MAX_BYTES) throw err('NOTICE_ATTACH_TOO_LARGE', 'Tệp vượt quá 4 MB.', 413);

  const attachmentId = crypto.randomUUID();
  const finalPath = storage.resolveFinalPath(root, objectKey(noticeId, attachmentId));
  const claim = await storage.claimFinalPath(finalPath);
  if (!claim.claimed) throw err('NOTICE_ATTACH_STORE', 'Không claim được vị trí lưu trữ.', 500);
  const tmp = storage.createTempPath(root);
  await fsp.mkdir(path.dirname(tmp), { recursive: true });
  await fsp.writeFile(tmp, buf);
  await storage.publishTempToFinal(tmp, finalPath);
  return { attachmentId, fileType, byteSize: buf.length };
}

// Read an attachment back as base64. Returns { base64, byteSize }.
async function getFile(root, noticeId, attachmentId) {
  const finalPath = storage.resolveFinalPath(root, objectKey(noticeId, attachmentId));
  let st;
  try { st = await storage.statFinalPath(finalPath); }
  catch (e) { throw err('NOTICE_ATTACH_NOT_FOUND', 'Không tìm thấy tệp.', 404); }
  const buf = await fsp.readFile(finalPath);
  return { base64: buf.toString('base64'), byteSize: st.size };
}

module.exports = { putFile, getFile, classify, MAX_BYTES, FILE_TYPES, NoticeAttachmentError };
