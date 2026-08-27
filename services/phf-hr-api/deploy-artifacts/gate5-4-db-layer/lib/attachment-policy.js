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

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const ALLOWED_MIME_SET = new Set(ALLOWED_MIME);

function isAllowedMime(mimeType) {
  return ALLOWED_MIME_SET.has(String(mimeType || '').trim().toLowerCase());
}

// G5.2 correction — grace window trước khi 1 final-path claim bị coi là
// stale/bỏ hoang (xem lib/attachment-storage.js inspectFinalPath/reclaimStaleClaim).
const STALE_CLAIM_GRACE_MS = 60000;

module.exports = {
  MAX_FILE_SIZE,
  ALLOWED_MIME,
  isAllowedMime,
  STALE_CLAIM_GRACE_MS,
};
