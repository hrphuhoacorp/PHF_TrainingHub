'use strict';
const { requireSession } = require('./_lib/auth');
const { streamChecklistEvidenceDownload } = require('./_lib/checklist-evidence');
const { sendError } = require('./_lib/api-response');

/**
 * Branded evidence viewer: GET /evidence/:id (rewritten by vercel.json to
 * /api/evidence?id=:id - a flat function, not api/evidence/[id].js, because
 * this project's other API routes all use flat files + query params
 * (api/data.js, etc.) and that's the pattern verified to actually deploy
 * here). Chỉ nhận evidence id từ query (đến từ URL path qua rewrite) -
 * không tin storage_path/signed URL từ client. Session bắt buộc, quyền xem
 * dùng lại đúng logic action='view' trong lib/checklist-violations.js (xem
 * lib/checklist-evidence.js resolveChecklistEvidenceForDownload). Server tự
 * tạo signed URL Supabase ngắn hạn và pipe thẳng file về - thanh địa chỉ
 * trình duyệt luôn giữ domain PHF, signed URL Supabase không bao giờ lộ ra
 * response.
 */
module.exports = async function handler(req, res) {
  try {
    if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
      res.setHeader('Allow', 'GET, HEAD');
      const error = new Error('Phương thức không được hỗ trợ.');
      error.statusCode = 405;
      error.code = 'METHOD_NOT_ALLOWED';
      throw error;
    }
    const session = await requireSession(req, ['learner', 'manager', 'admin']);
    const id = String((req.query && req.query.id) || '').trim();
    await streamChecklistEvidenceDownload(req, res, session, id);
  } catch (error) {
    sendError(res, error);
  }
};
