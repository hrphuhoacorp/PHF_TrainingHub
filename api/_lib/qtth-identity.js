'use strict';

// PHF HR — QUẢN TRỊ TỔNG HỢP (QTTH) V1 · Batch 01 identity resolver.
//
// Same principle as PHF Task / Competition: on local :3000 QTTH resolves the
// real logged-in user from the PHF HR People Master (Supabase MAIN), reusing
// the exact Task session/People-Master helpers. QTTH creates NO user master of
// its own and NEVER writes back to People Master. Employment status, job title,
// department are READ-ONLY reference here.
//
// QTTH authority (system Admin, "quản lý phân quyền", can_view_qtth /
// can_view_operations) is decided SERVER-AUTHORITATIVELY inside phf-hr-api
// against qtth.* grant tables — this module never infers permission from
// title / position / department / Task / Competition.

const {
  loadOrgRows, findByCode,
  resolveSessionEmployeeCode, resolveSessionAccountRole, resolveSessionAccountId,
} = require('./task-employee-scope');
const { getAccountById } = require('./auth');

class QtthIdentityError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode || 401;
    this.code = code || 'QTTH_IDENTITY_ERROR';
  }
}
function fail(message, statusCode, code) { throw new QtthIdentityError(message, statusCode, code); }
function text(v) { return v == null ? '' : String(v).trim(); }

async function assertAccountActive(accountId) {
  if (!accountId) return;
  let account = null;
  try { account = await getAccountById(accountId); } catch (e) { return; }
  if (account && text(account.status || 'active').toLowerCase() !== 'active') {
    fail('Tài khoản không còn hoạt động.', 403, 'QTTH_IDENTITY_INACTIVE');
  }
}

// Resolve the VERIFIED QTTH actor for the current PHF HR session.
// Shape matches what phf-hr-api's assertActor() expects:
//   { accountId, employeeCode, displayName, systemRole }
async function resolveQtthActor(session) {
  if (!session) fail('Chưa đăng nhập.', 401, 'QTTH_SESSION_REQUIRED');

  if (resolveSessionAccountRole(session) === 'admin') {
    const accountId = resolveSessionAccountId(session);
    if (!accountId) fail('Phiên Admin thiếu account_id canonical.', 401, 'QTTH_ACCOUNT_IDENTITY_REQUIRED');
    await assertAccountActive(accountId);
    const account = (session && session.account) || {};
    return {
      accountId, employeeCode: '',
      displayName: text(account.name || account.email) || 'Admin',
      systemRole: 'admin',
    };
  }

  const employeeCode = resolveSessionEmployeeCode(session);
  if (!employeeCode) fail('Phiên làm việc thiếu employee_code — không thể xác định danh tính nhân viên.', 401, 'QTTH_IDENTITY_REQUIRED');

  const rows = await loadOrgRows();
  const record = findByCode(rows, employeeCode);
  if (!record) fail('Tài khoản chưa được liên kết với hồ sơ thật trong People Master.', 403, 'QTTH_EMPLOYEE_NOT_FOUND');
  if (text(record.status || 'active').toLowerCase() !== 'active') {
    fail('Nhân sự không còn hoạt động — không thể truy cập QTTH.', 403, 'QTTH_IDENTITY_INACTIVE');
  }

  const accountId = resolveSessionAccountId(session);
  await assertAccountActive(accountId);

  return {
    accountId,
    employeeCode: record.employeeCode,
    displayName: record.fullName || text(session && session.account && session.account.name),
    systemRole: resolveSessionAccountRole(session) === 'manager' ? 'manager' : 'learner',
  };
}

module.exports = { QtthIdentityError, resolveQtthActor };
