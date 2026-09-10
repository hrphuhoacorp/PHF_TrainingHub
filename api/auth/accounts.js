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
  completeAccountPeopleMaster,
  deleteAccountByAdmin,
  listAccountsForAdmin,
  syncAccounts,
  resetPasswordByAdmin,
  getAccountById,
  clearCookieHeader
} = require('../_lib/auth');
const { requireChecklistWebOperator, isChecklistWebOperator } = require('../_lib/checklist-permissions');
const { send, sendError, requestBody } = require('../_lib/api-response');
const { auditEmit } = require('../_lib/audit-emit');

// Safe projection of an account for the audit before/after JSON — identity +
// lifecycle fields ONLY. NEVER the password / temp password / hash / salt.
function acctSnap(a) {
  if (!a) return null;
  return {
    id: a.id || '', email: a.email || '', name: a.name || '',
    role: a.role || '', status: a.status || '',
    employeeCode: a.employeeCode || '', accountType: a.accountType || '',
  };
}
// Emit 0..N audit rows for one account mutation. Distinct semantics (role,
// access lock/unlock) get their own row; remaining field changes get one
// bounded ACCOUNT_UPDATE. Never throws (auditEmit is fail-open).
async function emitAccountAudit(req, session, kind, before, after, extraMeta) {
  const b = acctSnap(before), a = acctSnap(after);
  const target = a || b || {};
  const common = {
    module: 'account', result: 'success', object_type: 'account',
    object_id: target.id || null, object_label: target.email || target.name || target.id || null,
  };
  if (kind === 'create') {
    return auditEmit(req, session, { ...common, action: 'ACCOUNT_CREATE', after: a, metadata: extraMeta || null });
  }
  if (kind === 'delete') {
    return auditEmit(req, session, { ...common, action: 'ACCOUNT_DELETE', before: b, metadata: extraMeta || null });
  }
  if (kind === 'reset-password') {
    return auditEmit(req, session, { ...common, action: 'ACCOUNT_PASSWORD_RESET', metadata: { note: 'temp password issued (value never logged)' } });
  }
  // update: derive specific events
  const emits = [];
  if (b && a && b.role !== a.role) {
    emits.push(auditEmit(req, session, { ...common, action: 'ACCOUNT_ROLE_CHANGE', before: { role: b.role }, after: { role: a.role } }));
  }
  if (b && a && b.status !== a.status) {
    const wasActive = b.status === 'active', nowActive = a.status === 'active';
    if (wasActive && !nowActive) emits.push(auditEmit(req, session, { ...common, action: 'ACCOUNT_ACCESS_LOCK', before: { status: b.status }, after: { status: a.status } }));
    else if (!wasActive && nowActive) emits.push(auditEmit(req, session, { ...common, action: 'ACCOUNT_ACCESS_UNLOCK', before: { status: b.status }, after: { status: a.status } }));
    else emits.push(auditEmit(req, session, { ...common, action: 'ACCOUNT_UPDATE', before: { status: b.status }, after: { status: a.status } }));
  }
  const otherChanged = b && a && (b.email !== a.email || b.name !== a.name || b.employeeCode !== a.employeeCode);
  if (otherChanged || !b) {
    emits.push(auditEmit(req, session, { ...common, action: 'ACCOUNT_UPDATE', before: b, after: a }));
  }
  return Promise.all(emits);
}

// PHF SYSTEM V1 — "Quản trị tài khoản" is SYSTEM ADMIN ONLY. Every account
// operation (list / create / update / lock-unlock / role / reset-password /
// delete) now requires session.role === 'admin' at the API layer, matching the
// Admin-only route guard. The previous manager + Trợ lý GD (TRO_LY_GD) path is
// intentionally removed. Root-admin / last-admin / self-delete / anti-escalation
// safeguards live in _lib/auth.js and are unchanged.
async function requireWebOperatorSession(req) {
  return requireSession(req, ['admin']);
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
  const result = await createAccountByAdmin(body.account || body, session);
  await emitAccountAudit(req, session, 'create', null, result.account, { accountType: result.account && result.account.accountType });
  return send(res, 201, { ok: true, user: result.account, temporaryPassword: result.temporaryPassword, peopleMaster: result.peopleMaster });
}

async function handleUpdate(req, res, body) {
  assertSameOrigin(req); assertJsonContentType(req); assertContentLength(req);
  const session = await requireWebOperatorSession(req);
  await assertAccountMutationAllowed(session, body.account || body, body.accountId);
  const before = await getAccountById(body.accountId);
  const user = await updateAccountByAdmin(body.accountId, body.account || body, session);
  await emitAccountAudit(req, session, 'update', before, user);
  const reauthRequired = String(session.sub || '') === String(user.id || '') &&
    (session.email !== user.email || session.role !== user.role || user.status !== 'active');
  if (reauthRequired) res.setHeader('Set-Cookie', clearCookieHeader());
  return send(res, 200, { ok: true, user, reauthRequired });
}

// "Hoàn tất hồ sơ nhân sự" — People Master repair action. Deliberately NOT an
// account-field update: only reads the account (SELECT, already granted) and
// creates the missing employee_profiles row if needed. See auth.js
// completeAccountPeopleMaster for why this must never go through
// updateAccountByAdmin (that requires UPDATE privilege on user_accounts,
// a permission surface this action has no reason to touch).
async function handleCompletePeopleMaster(req, res, body) {
  assertSameOrigin(req); assertJsonContentType(req); assertContentLength(req);
  const session = await requireWebOperatorSession(req);
  await assertAccountMutationAllowed(session, {}, body.accountId);
  const result = await completeAccountPeopleMaster(body.accountId, session);
  return send(res, 200, { ok: true, user: result.account, peopleMaster: result.peopleMaster });
}

async function handleDelete(req, res, body) {
  assertSameOrigin(req); assertJsonContentType(req); assertContentLength(req);
  const session = await requireWebOperatorSession(req);
  await assertAccountMutationAllowed(session, {}, body.accountId);
  const user = await deleteAccountByAdmin(body.accountId, session);
  await emitAccountAudit(req, session, 'delete', user, null);
  return send(res, 200, { ok: true, user });
}

async function handleResetPassword(req, res, body) {
  assertSameOrigin(req); assertJsonContentType(req); assertContentLength(req);
  const session = await requireWebOperatorSession(req);
  await assertAccountMutationAllowed(session, {}, body.accountId);
  const result = await resetPasswordByAdmin(body.accountId);
  await emitAccountAudit(req, session, 'reset-password', null, result.account);
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
      if (action === 'complete-people-master') return await handleCompletePeopleMaster(req, res, body);
      return send(res, 400, { ok: false, error: 'Thao tác tài khoản không hợp lệ.', code: 'ACCOUNT_ACTION_INVALID' });
    }
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { ok: false, error: 'Phương thức không được hỗ trợ.', code: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    return sendError(res, error);
  }
};
