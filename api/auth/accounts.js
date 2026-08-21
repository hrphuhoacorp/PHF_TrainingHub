'use strict';

/*
 * Gom 5 Serverless Function riêng lẻ (list/create/update/delete/sync) + bổ sung
 * reset-password (đã có logic trong server.js nhưng thiếu endpoint trên Vercel)
 * thành 1 function duy nhất để không vượt giới hạn 12 Serverless Function của
 * gói Vercel Hobby. Toàn bộ logic nghiệp vụ và guard bên dưới được copy nguyên
 * trạng từ server.js (requireWebOperatorSession/assertAccountMutationAllowed,
 * dòng 36-59) để hai đường deploy (Node/Render và Vercel) khớp nhau, không còn
 * lệch quyền như trước khi gộp.
 */

const { assertSameOrigin, assertJsonContentType, assertContentLength } = require('../_lib/request-guard');
const {
  requireSession,
  createAccountByAdmin,
  updateAccountByAdmin,
  deleteAccountByAdmin,
  listAccountsForAdmin,
  syncAccounts,
  resetPasswordByAdmin,
  getAccountById,
  clearCookieHeader
} = require('../_lib/auth');
const { requireChecklistWebOperator, isChecklistWebOperator } = require('../_lib/checklist-permissions');
const { send, sendError, requestBody } = require('../_lib/api-response');

async function requireWebOperatorSession(req) {
  const session = await requireSession(req, ['manager', 'admin']);
  await requireChecklistWebOperator(session);
  return session;
}

async function assertAccountMutationAllowed(session, input = {}, targetId = '') {
  if (session.role === 'admin') return;
  const requestedRole = String(input.role || '').trim().toLowerCase();
  const requestedType = String(input.accountType || input.account_type || '').trim().toLowerCase();
  if (requestedRole === 'admin' || requestedType === 'system_admin') {
    const error = new Error('Trợ lý điều hành không được tạo hoặc nâng tài khoản thành Admin hệ thống.');
    error.statusCode = 403; error.code = 'ADMIN_ACCOUNT_PROTECTED'; throw error;
  }
  if (targetId) {
    const target = await getAccountById(targetId);
    if (!target) { const error = new Error('Không tìm thấy tài khoản cần xử lý.'); error.statusCode = 404; error.code = 'ACCOUNT_NOT_FOUND'; throw error; }
    if (String(target.role || '').toLowerCase() === 'admin' || String(target.accountType || target.metadata?.accountType || '').toLowerCase() === 'system_admin') {
      const error = new Error('Trợ lý điều hành không được sửa tài khoản Admin hệ thống.'); error.statusCode = 403; error.code = 'ADMIN_ACCOUNT_PROTECTED'; throw error;
    }
    const targetSession = { role: target.role, sub: target.id, account: target, employeeCode: target.employeeCode, employeeId: target.employeeId, email: target.email };
    if (await isChecklistWebOperator(targetSession)) {
      const error = new Error('Chỉ Admin hệ thống được sửa tài khoản Trợ lý Giám đốc – Điều hành web.'); error.statusCode = 403; error.code = 'ASSISTANT_ACCOUNT_PROTECTED'; throw error;
    }
  }
}

// --- Mỗi hàm dưới đây giữ nguyên đúng logic của file gốc tương ứng ---

async function handleList(req, res) {
  await requireWebOperatorSession(req);
  const accounts = await listAccountsForAdmin();
  return send(res, 200, { ok: true, accounts });
}

async function handleCreate(req, res, body) {
  assertSameOrigin(req); assertJsonContentType(req); assertContentLength(req);
  const session = await requireWebOperatorSession(req);
  await assertAccountMutationAllowed(session, body.account || body);
  const result = await createAccountByAdmin(body.account || body);
  return send(res, 201, { ok: true, user: result.account, temporaryPassword: result.temporaryPassword });
}

async function handleUpdate(req, res, body) {
  assertSameOrigin(req); assertJsonContentType(req); assertContentLength(req);
  const session = await requireWebOperatorSession(req);
  await assertAccountMutationAllowed(session, body.account || body, body.accountId);
  const user = await updateAccountByAdmin(body.accountId, body.account || body);
  const reauthRequired = String(session.sub || '') === String(user.id || '') &&
    (session.email !== user.email || session.role !== user.role || user.status !== 'active');
  if (reauthRequired) res.setHeader('Set-Cookie', clearCookieHeader());
  return send(res, 200, { ok: true, user, reauthRequired });
}

async function handleDelete(req, res, body) {
  assertSameOrigin(req); assertJsonContentType(req); assertContentLength(req);
  const session = await requireWebOperatorSession(req);
  await assertAccountMutationAllowed(session, {}, body.accountId);
  const user = await deleteAccountByAdmin(body.accountId, session);
  return send(res, 200, { ok: true, user });
}

async function handleResetPassword(req, res, body) {
  assertSameOrigin(req); assertJsonContentType(req); assertContentLength(req);
  const session = await requireWebOperatorSession(req);
  await assertAccountMutationAllowed(session, {}, body.accountId);
  const result = await resetPasswordByAdmin(body.accountId);
  return send(res, 200, { ok: true, user: result.account, temporaryPassword: result.temporaryPassword });
}

async function handleSync(req, res, body) {
  assertSameOrigin(req); assertJsonContentType(req); assertContentLength(req);
  await requireSession(req, ['admin']);
  const accounts = await syncAccounts(body.accounts || []);
  return send(res, 200, { ok: true, count: accounts.length });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const action = String((req.query && req.query.action) || 'list').trim();
      if (action !== 'list') {
        res.setHeader('Allow', 'GET, POST');
        return send(res, 405, { ok: false, error: 'Phương thức không được hỗ trợ.', code: 'METHOD_NOT_ALLOWED' });
      }
      return await handleList(req, res);
    }
    if (req.method === 'POST') {
      const body = requestBody(req);
      const action = String(body.action || '').trim();
      if (action === 'create') return await handleCreate(req, res, body);
      if (action === 'update') return await handleUpdate(req, res, body);
      if (action === 'delete') return await handleDelete(req, res, body);
      if (action === 'sync') return await handleSync(req, res, body);
      if (action === 'reset-password') return await handleResetPassword(req, res, body);
      return send(res, 400, { ok: false, error: 'Thao tác tài khoản không hợp lệ.', code: 'ACCOUNT_ACTION_INVALID' });
    }
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { ok: false, error: 'Phương thức không được hỗ trợ.', code: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    return sendError(res, error);
  }
};
