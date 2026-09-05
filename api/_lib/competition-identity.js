'use strict';

// PHF HR — Chương trình thi đua (Competition) V1 · Batch C2 identity resolver.
//
// LOCKED (operator, 2026-09-04): on local :3000, Competition MUST resolve the
// real logged-in user from the PHF HR People Master — SAME PRINCIPLE as PHF
// Task, reusing its exact session/People-Master helpers (no second identity
// mechanism). Competition creates NO user master of its own. SYN/file-account
// identities are NEVER used as the runtime identity of this path — they exist
// only in the Batch C1 automated test harness (scripts/test-competition-c1-*).
//
// Participant eligibility = user_accounts.status='active' AND
// employee_profiles.employment_status='active'. Job title/position and
// department are PROFILE fields, read-only here — Competition never writes
// back to People Master. All Competition AUTHORITY (participant is implicit;
// reviewer level, Competition Admin, view_participation_progress) comes
// exclusively from Competition's own grant tables — this module never infers
// permission from title/position/department.

const {
  loadOrgRows, findByCode,
  resolveSessionEmployeeCode, resolveSessionAccountRole, resolveSessionAccountId,
} = require('./task-employee-scope');
const { getAccountById } = require('./auth');

class CompetitionIdentityError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode || 401;
    this.code = code || 'COMPETITION_IDENTITY_ERROR';
  }
}
function fail(message, statusCode, code) { throw new CompetitionIdentityError(message, statusCode, code); }

function text(v) { return v == null ? '' : String(v).trim(); }

// Re-verify the account is still active. Session issuance already required an
// active account; this is defence-in-depth for a session that has outlived a
// mid-session deactivation. A lookup failure does NOT fail the request (same
// tolerance PHF Task applies — the session itself remains the primary gate);
// only an EXPLICIT status !== 'active' blocks.
async function assertAccountActive(accountId) {
  if (!accountId) return;
  let account = null;
  try { account = await getAccountById(accountId); } catch (e) { return; }
  if (account && text(account.status || 'active').toLowerCase() !== 'active') {
    fail('Tài khoản không còn hoạt động — không thể tham gia Chương trình thi đua.', 403, 'COMPETITION_IDENTITY_INACTIVE');
  }
}

// Resolve the VERIFIED Competition actor for the current PHF HR session.
// Returned shape matches what phf-hr-api's assertActor() expects (Batch C1):
//   { accountId, employeeCode, displayName, department, branch, title, systemRole }
async function resolveCompetitionActor(session) {
  if (!session) fail('Chưa đăng nhập.', 401, 'COMPETITION_SESSION_REQUIRED');

  if (resolveSessionAccountRole(session) === 'admin') {
    const accountId = resolveSessionAccountId(session);
    if (!accountId) fail('Phiên Admin thiếu account_id canonical.', 401, 'COMPETITION_ACCOUNT_IDENTITY_REQUIRED');
    await assertAccountActive(accountId);
    const account = (session && session.account) || {};
    return {
      accountId, employeeCode: '',
      displayName: text(account.name || account.email) || 'Admin',
      department: '', branch: '', title: '',
      systemRole: 'admin',
    };
  }

  const employeeCode = resolveSessionEmployeeCode(session);
  if (!employeeCode) fail('Phiên làm việc thiếu employee_code — không thể xác định danh tính nhân viên.', 401, 'COMPETITION_IDENTITY_REQUIRED');

  const rows = await loadOrgRows();
  const record = findByCode(rows, employeeCode);
  if (!record) fail('Tài khoản chưa được liên kết với hồ sơ thật trong People Master.', 403, 'COMPETITION_EMPLOYEE_NOT_FOUND');
  if (text(record.status || 'active').toLowerCase() !== 'active') {
    fail('Nhân sự không còn hoạt động — không thể tham gia Chương trình thi đua.', 403, 'COMPETITION_IDENTITY_INACTIVE');
  }

  const accountId = resolveSessionAccountId(session);
  await assertAccountActive(accountId);

  return {
    accountId,
    employeeCode: record.employeeCode,
    displayName: record.fullName || text(session && session.account && session.account.name),
    department: record.department || '',
    branch: record.branch || '',
    title: record.title || record.position || '',
    systemRole: resolveSessionAccountRole(session) === 'manager' ? 'manager' : 'learner',
  };
}

module.exports = { CompetitionIdentityError, resolveCompetitionActor };
