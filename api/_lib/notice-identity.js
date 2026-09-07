'use strict';

// PHF HR — THÔNG BÁO QUẢN TRỊ V1 · Batch 01 identity resolver.
//
// Same principle as PHF Task / Competition / QTTH: on local :3000 the module
// resolves the real logged-in user from the PHF HR People Master (Supabase
// MAIN in prod / PHF-HR-DEV project in local parity), reusing the exact Task
// session/People-Master helpers. This module creates NO user master of its own
// and NEVER writes back to People Master. Employment status / job title /
// department / branch are READ-ONLY reference here.
//
// The module is PUBLIC-READ: every authenticated PHF HR account resolves to a
// valid viewer actor. MANAGE authority ("Quản trị nội dung") is decided
// SERVER-AUTHORITATIVELY inside phf-hr-api against notice.notice_permissions —
// this module never infers it from title / position / department / another
// module's role.

const {
  loadOrgRows, findByCode,
  resolveSessionEmployeeCode, resolveSessionAccountRole, resolveSessionAccountId,
} = require('./task-employee-scope');
const { getAccountById } = require('./auth');

class NoticeIdentityError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode || 401;
    this.code = code || 'NOTICE_IDENTITY_ERROR';
  }
}
function fail(message, statusCode, code) { throw new NoticeIdentityError(message, statusCode, code); }
function text(v) { return v == null ? '' : String(v).trim(); }

async function assertAccountActive(accountId) {
  if (!accountId) return;
  let account = null;
  try { account = await getAccountById(accountId); } catch (e) { return; }
  if (account && text(account.status || 'active').toLowerCase() !== 'active') {
    fail('Tài khoản không còn hoạt động.', 403, 'NOTICE_IDENTITY_INACTIVE');
  }
}

// Resolve the VERIFIED notice actor for the current PHF HR session.
// Shape matches phf-hr-api's assertActor(): { accountId, employeeCode, displayName, systemRole }
async function resolveNoticeActor(session) {
  if (!session) fail('Chưa đăng nhập.', 401, 'NOTICE_SESSION_REQUIRED');

  if (resolveSessionAccountRole(session) === 'admin') {
    const accountId = resolveSessionAccountId(session);
    if (!accountId) fail('Phiên Admin thiếu account_id canonical.', 401, 'NOTICE_ACCOUNT_IDENTITY_REQUIRED');
    await assertAccountActive(accountId);
    const account = (session && session.account) || {};
    return {
      accountId, employeeCode: '',
      displayName: text(account.name || account.email) || 'Admin',
      systemRole: 'admin',
    };
  }

  const employeeCode = resolveSessionEmployeeCode(session);
  if (!employeeCode) fail('Phiên làm việc thiếu employee_code — không thể xác định danh tính nhân viên.', 401, 'NOTICE_IDENTITY_REQUIRED');

  const rows = await loadOrgRows();
  const record = findByCode(rows, employeeCode);
  if (!record) fail('Tài khoản chưa được liên kết với hồ sơ thật trong People Master.', 403, 'NOTICE_EMPLOYEE_NOT_FOUND');
  if (text(record.status || 'active').toLowerCase() !== 'active') {
    fail('Nhân sự không còn hoạt động — không thể truy cập Thông báo Quản trị.', 403, 'NOTICE_IDENTITY_INACTIVE');
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

module.exports = { NoticeIdentityError, resolveNoticeActor };
