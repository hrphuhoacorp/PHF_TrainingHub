'use strict';

const crypto = require('crypto');

// Server-to-service Bearer auth — KHÔNG liên quan session cookie người dùng
// (auth.js của app chính). Đây là secret RIÊNG cho lời gọi máy-tới-máy giữa
// (tương lai) api/data.js và phf-hr-api, tách biệt hoàn toàn khỏi
// CHECKLIST_CRON_SECRET và mọi secret khác — đúng nguyên tắc least-privilege
// đã chốt trong TASK-SERVER-02C (mỗi service 1 secret riêng).

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) {
    // vẫn chạy timingSafeEqual trên cặp cùng độ dài để tránh leak độ dài qua
    // thời gian phản hồi ở mức thô — so với chính nó, luôn trả false sau đó.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function extractBearerToken(req) {
  const header = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

function requireServiceToken(expectedToken) {
  return function authMiddleware(req) {
    const provided = extractBearerToken(req);
    if (!provided) {
      return { authorized: false, reason: 'MISSING_BEARER_TOKEN' };
    }
    if (!timingSafeEqualStr(provided, expectedToken)) {
      return { authorized: false, reason: 'INVALID_BEARER_TOKEN' };
    }
    return { authorized: true };
  };
}

module.exports = { requireServiceToken, extractBearerToken };
