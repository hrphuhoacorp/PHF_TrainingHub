'use strict';

/*
 * PHF HR — Account Impersonation V1.
 * Admin xem PHF HR đúng như một tài khoản Học viên (learner) hoặc Quản lý
 * (manager) thật đang thấy, để phân biệt lỗi hệ thống với UX khó hiểu.
 * CHỈ XEM: mọi hành động ghi bị chặn tập trung tại requireSession()
 * (api/_lib/auth.js) khi session.impersonating === true — file này chỉ lo
 * việc bắt đầu/kết thúc phiên giả lập, không tự chặn ghi thêm lần nữa.
 *
 * Session model: phf_session của Admin thật KHÔNG BAO GIỜ bị thay thế. Một
 * cookie riêng phf_impersonate (HttpOnly, signed, TTL 60 phút) chỉ giữ
 * {actorId, targetId}. readSession() overlay hai cookie lại thành một session
 * hiệu lực (effective) mà account/role/employeeId là của người bị giả lập,
 * còn session.actor luôn là Admin thật (audit/security).
 */

const { assertSameOrigin, assertJsonContentType } = require('../_lib/request-guard');
const {
  requireSession,
  readSession,
  listAccountsForAdmin,
  startImpersonation,
  impersonationCookieHeader,
  clearImpersonationCookieHeader,
  IMPERSONATABLE_ROLES
} = require('../_lib/auth');
const { send, sendError, requestBody } = require('../_lib/api-response');
const { auditEmit } = require('../_lib/audit-emit');

function candidateProjection(a) {
  return {
    id: a.id,
    employeeId: a.employeeId || '',
    employeeCode: a.employeeCode || '',
    name: a.name || '',
    role: a.role || '',
    branch: a.branch || '',
    department: a.department || '',
    position: a.position || '',
    hubAssignmentStatus: a.hubAssignmentStatus || ''
  };
}

module.exports = async function handler(req, res) {
  try {
    assertSameOrigin(req);

    if (req.method === 'GET') {
      const role = String(req.query?.role || '').trim().toLowerCase();
      if (!IMPERSONATABLE_ROLES.includes(role)) {
        return send(res, 400, { ok: false, error: 'Vai trò không hợp lệ. Chỉ hỗ trợ learner hoặc manager.', code: 'IMPERSONATION_ROLE_UNSUPPORTED' });
      }
      // Admin thật (chưa giả lập ai) mới được mở màn chọn tài khoản — nếu
      // đang giả lập, role hiệu lực không còn là admin nên requireSession tự
      // 403, đúng nghiệp vụ "phải Thoát giả lập trước khi giả lập người khác".
      await requireSession(req, ['admin']);
      const accounts = await listAccountsForAdmin();
      const candidates = accounts
        .filter(a => a.role === role && a.status === 'active')
        .map(candidateProjection);
      return send(res, 200, { ok: true, role, candidates });
    }

    if (req.method === 'POST') {
      assertJsonContentType(req);
      const payload = requestBody(req);
      const action = String(payload.action || '').trim();

      if (action === 'start') {
        const session = await requireSession(req, ['admin']);
        const accountId = String(payload.accountId || '').trim();
        if (!accountId) {
          return send(res, 400, { ok: false, error: 'Thiếu tài khoản cần giả lập.', code: 'IMPERSONATION_TARGET_REQUIRED' });
        }
        const { token, target } = await startImpersonation(session, accountId);
        res.setHeader('Set-Cookie', impersonationCookieHeader(token));
        await auditEmit(req, session, {
          module: 'account', action: 'IMPERSONATION_START', result: 'success',
          object_type: 'account', object_id: target.id, object_label: target.employeeCode || target.name || target.id,
          metadata: { targetRole: target.role }
        });
        return send(res, 200, { ok: true, impersonating: true, account: target });
      }

      if (action === 'stop') {
        // Idempotent theo thiết kế: cho phép gọi kể cả khi phiên/hiệu lực
        // giả lập đã hết hạn hoặc không hợp lệ — chỉ đơn thuần xoá cookie.
        // KHÔNG đụng tới phf_session của Admin thật.
        let session = null;
        try { session = await readSession(req); } catch (_e) { session = null; }
        res.setHeader('Set-Cookie', clearImpersonationCookieHeader());
        if (session && session.impersonating) {
          await auditEmit(req, session, {
            module: 'account', action: 'IMPERSONATION_STOP', result: 'success',
            object_type: 'account', object_id: session.account.id, object_label: session.account.employeeCode || session.account.name || session.account.id,
            actor: { actor_account_id: session.actor && session.actor.id, actor_name: session.actor && (session.actor.name || session.actor.email) }
          });
        }
        return send(res, 200, { ok: true, impersonating: false });
      }

      return send(res, 400, { ok: false, error: 'Thao tác giả lập không hợp lệ.', code: 'IMPERSONATION_ACTION_INVALID' });
    }

    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { ok: false, error: 'Phương thức không được hỗ trợ.', code: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    return sendError(res, error);
  }
};
