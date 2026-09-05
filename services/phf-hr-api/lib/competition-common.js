'use strict';

// PHF HR — Chương trình thi đua (Competition) V1 · shared server helpers.
//
// Batch C1: phf-hr-api service layer for Company PostgreSQL phf_hr /
// competition.* (DEV target phf_hr_e2e). Reuses the Task runtime-identity
// pattern verbatim — every DB call goes through withTaskWriteTransaction /
// withTaskReadTransaction from ./db (BEGIN -> SET LOCAL ROLE phf_hr_app ->
// work -> COMMIT/ROLLBACK). No new DB access mechanism, no Supabase here.
//
// Identity: phf-hr-api NEVER resolves identity itself. It receives a verified
// `actor` object across the service-token boundary (resolved on the Vercel
// side against the People Master) and trusts only that. The client can never
// supply the authoritative actor.

const { withTaskWriteTransaction, withTaskReadTransaction } = require('./db');

// ---- error contract -------------------------------------------------------
class CompetitionError extends Error {
  constructor(code, message, statusCode) {
    super(message || code);
    this.code = code;
    this.statusCode = statusCode || 400;
    this.isCompetitionError = true;
  }
}
function cErr(code, message, statusCode) { return new CompetitionError(code, message, statusCode); }

// Postgres SQLSTATE -> CompetitionError (never leak table/column/constraint text)
function mapPgError(err) {
  const code = String((err && err.code) || '');
  const raw = String((err && err.message) || '');
  // guard/trigger RAISEs surface as P0001 with a stable PREFIX: token
  if (code === 'P0001') {
    const m = raw.match(/^([A-Z_]+):/);
    if (m) return cErr(m[1], raw.replace(/\s+CONTEXT:[\s\S]*$/, ''), 409);
  }
  if (code === '23505') return cErr('COMPETITION_DUPLICATE', 'Bản ghi trùng.', 409);
  if (code === '23503') return cErr('COMPETITION_FK_VIOLATION', 'Tham chiếu không hợp lệ.', 409);
  if (code === '23514') return cErr('COMPETITION_CHECK_VIOLATION', 'Dữ liệu không hợp lệ.', 400);
  if (code === '42P01') return cErr('COMPETITION_SCHEMA_MISSING', 'Schema competition chưa sẵn sàng.', 503);
  if (code === '42501') return cErr('COMPETITION_PERMISSION_DENIED', 'Thiếu quyền truy cập dữ liệu Competition.', 500);
  if (code === '57014') return cErr('COMPETITION_READ_TIMEOUT', 'Truy vấn Competition quá thời gian chờ.', 504);
  return null;
}

async function readTx(config, fn) {
  try { return await withTaskReadTransaction(config, fn); }
  catch (err) { throw mapPgError(err) || err; }
}
async function writeTx(config, fn) {
  try { return await withTaskWriteTransaction(config, fn); }
  catch (err) { throw mapPgError(err) || err; }
}

// ---- actor -------------------------------------------------------------
// A verified actor from the Vercel identity layer. `accountId` OR
// `employeeCode` may be empty (account-only / employee-only sessions) but not
// both. systemRole is the PHF HR session role ('admin'|'manager'|'learner').
function assertActor(actor) {
  if (!actor || typeof actor !== 'object') throw cErr('COMPETITION_ACTOR_REQUIRED', 'Thiếu actor đã xác thực.', 401);
  const accountId = String(actor.accountId || '').trim();
  const employeeCode = String(actor.employeeCode || '').trim();
  if (!accountId && !employeeCode) throw cErr('COMPETITION_ACTOR_REQUIRED', 'Actor không có định danh.', 401);
  return {
    accountId, employeeCode,
    displayName: actor.displayName ? String(actor.displayName) : null,
    department: actor.department ? String(actor.department) : null,
    branch: actor.branch ? String(actor.branch) : null,
    title: actor.title ? String(actor.title) : null,
    systemRole: String(actor.systemRole || 'learner'),
  };
}

// audit actor token for *_history.actor_* columns (employeeCode preferred)
function auditActor(a) {
  return {
    account_id: a.accountId || null,
    employee_code: a.employeeCode || null,
    display_name: a.displayName || null,
  };
}

// same-person test — server-authoritative self-review / self-award block.
// True if actor matches the row by EITHER account_id or employee_code.
function isSamePerson(a, rowAccountId, rowEmployeeCode) {
  const acc = String(rowAccountId || '').trim();
  const emp = String(rowEmployeeCode || '').trim();
  if (a.accountId && acc && a.accountId === acc) return true;
  if (a.employeeCode && emp && a.employeeCode === emp) return true;
  return false;
}

function cleanText(v) {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? null : s;
}

module.exports = {
  CompetitionError, cErr, mapPgError, readTx, writeTx,
  assertActor, auditActor, isSamePerson, cleanText,
};
