'use strict';

// PHF HR — Gate 5 Attachment/Evidence: policy constants, TẬP TRUNG DUY NHẤT
// (G5.1 quyết định #4 — "Thiết kế tập trung/configurable... Không hardcode
// policy lặp lại nhiều nơi"). lib/attachment-storage.js và (sau này) route/
// DB-layer đều PHẢI import từ đây, KHÔNG tự định nghĩa lại giá trị.
//
// Initial technical contract theo G5.1 quyết định #4 — CHƯA phải business
// contract cuối cùng, chỉ là default kỹ thuật ban đầu (tham khảo
// api/_lib/checklist-evidence.js — domain khác, cùng giá trị, KHÔNG phải
// trùng hợp mà là điểm khởi đầu nhất quán được Technical Lead xác nhận).

// FILE ATTACHMENT V1 (2026-08-31, business decision LOCKED): effective V1
// ceiling is 4 MB/file — the practical limit of the current Vercel serverless
// bridge (raw-binary body). Direct-to-VPS large-file upload is explicitly NOT
// in V1. The streaming counter in attachment-storage.js aborts on the real
// byte count crossing this, and task-write.js re-checks it as a DB backstop.
const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4 MB

// DOCX / XLSX (OOXML) added for V1 (business decision LOCKED). HEIC is NOT in
// V1. Everything outside this list is rejected up-front.
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const ALLOWED_MIME = Object.freeze([
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf', DOCX_MIME, XLSX_MIME,
]);
const ALLOWED_MIME_SET = new Set(ALLOWED_MIME);

// Canonical extension(s) per allowed MIME. The declared Content-Type and the
// filename extension must BOTH be in the allowlist AND agree with each other —
// "do not trust the filename alone" (a .exe renamed .pdf fails the pairing, and
// a real .pdf sent with Content-Type image/jpeg fails it too).
const MIME_EXTENSIONS = Object.freeze({
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
  [DOCX_MIME]: ['docx'],
  [XLSX_MIME]: ['xlsx'],
});

function isAllowedMime(mimeType) {
  return ALLOWED_MIME_SET.has(String(mimeType || '').trim().toLowerCase());
}

function normalizeExtension(extension) {
  return String(extension || '').trim().toLowerCase().replace(/^\./, '');
}

// true only when `mimeType` is an allowed MIME AND `extension` is one of the
// canonical extensions for exactly that MIME.
function isAllowedMimeExtensionPair(mimeType, extension) {
  const list = MIME_EXTENSIONS[String(mimeType || '').trim().toLowerCase()];
  if (!list) return false;
  return list.includes(normalizeExtension(extension));
}

// G5.2 correction — grace window trước khi 1 final-path claim bị coi là
// stale/bỏ hoang (xem lib/attachment-storage.js inspectFinalPath/reclaimStaleClaim).
const STALE_CLAIM_GRACE_MS = 60000;

// FILE ATTACHMENT V1 (2026-08-31, business decision LOCKED) — per-task soft cap
// on ACTIVE (non-removed) attachments. Checked before an upload streams; a
// small overshoot under concurrent uploads is acceptable for V1 (no pre-delete
// of older attachments, ever). Removing an attachment frees a slot.
const MAX_ACTIVE_ATTACHMENTS_PER_TASK = 20;

module.exports = {
  MAX_FILE_SIZE,
  ALLOWED_MIME,
  DOCX_MIME,
  XLSX_MIME,
  MIME_EXTENSIONS,
  isAllowedMime,
  normalizeExtension,
  isAllowedMimeExtensionPair,
  STALE_CLAIM_GRACE_MS,
  MAX_ACTIVE_ATTACHMENTS_PER_TASK,
};
