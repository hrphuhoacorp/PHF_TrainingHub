'use strict';

/*
 * PHF Task organization adapter.
 *
 * employee_profiles remains canonical for employee identity, employment
 * status, department, branch, title and the live manager graph. It is not an
 * authority source for Task roles. Authenticated account role is consulted
 * only for the system-admin short circuit; every other Task role is supplied
 * by task_permission_assignments in lib/task-permissions.js.
 */

const { loadCanonicalEmployeeProfiles } = require('./employee-master');

const CACHE_TTL_MS = 30000;
const MAX_CHAIN_DEPTH = 12;

const SALES_ALL_BRANCHES_DEPARTMENT = 'Bộ phận bán hàng';
const SALES_ALL_BRANCHES_BRANCHES = Object.freeze(['Phú Lợi', 'Ngô Quyền', 'Lái Thiêu']);
const ACTOR_TYPES = Object.freeze(['admin', 'giam_doc', 'tro_ly_gd', 'truong_bo_phan', 'truong_ca', 'nhan_vien']);
const TASK_PRESET_TO_ACTOR_TYPE = Object.freeze({
  GIAM_DOC: 'giam_doc',
  TRO_LY_GD: 'tro_ly_gd',
  TRUONG_BO_PHAN: 'truong_bo_phan',
  TRUONG_CA: 'truong_ca',
  NHAN_VIEN: 'nhan_vien'
});

function text(value) { return String(value == null ? '' : value).trim(); }
function code(value) { return text(value).toUpperCase(); }
function fail(message, statusCode, errorCode) {
  const error = new Error(message);
  error.statusCode = statusCode || 400;
  error.code = errorCode || 'TASK_SCOPE_INVALID';
  throw error;
}
function throwDb(error) {
  if (!error) return;
  const errorCode = text(error.code);
  const message = text(error.message);
  if (errorCode === 'PGRST205' || errorCode === '42P01' || /relation .* does not exist/i.test(message) || /Could not find the table/i.test(message)) {
    fail('Bảng employee_profiles chưa sẵn sàng cho PHF Task đọc cơ cấu tổ chức.', 503, 'TASK_ORG_SOURCE_UNAVAILABLE');
  }
  throw error;
}

function normalizeScopeText(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

const NORMALIZED_SALES_BRANCHES = new Set(SALES_ALL_BRANCHES_BRANCHES.map(normalizeScopeText));
const NORMALIZED_SALES_DEPARTMENT = normalizeScopeText(SALES_ALL_BRANCHES_DEPARTMENT);

let cachedRows = null;
let cachedAt = 0;

async function loadOrgRows() {
  const now = Date.now();
  if (cachedRows && (now - cachedAt) < CACHE_TTL_MS) return cachedRows;
  let source;
  try {
    source = await loadCanonicalEmployeeProfiles('employee_code,full_name,department,title,position,branch,manager_employee_code,employment_status');
  } catch (error) {
    throwDb(error);
  }
  if (!source || source.ready !== true) fail('Bảng employee_profiles chưa sẵn sàng cho PHF Task đọc cơ cấu tổ chức.', 503, 'TASK_ORG_SOURCE_UNAVAILABLE');
  cachedRows = (source.rows || []).slice(0, 2000).map(row => ({
    employeeCode: code(row.employee_code),
    fullName: text(row.full_name),
    department: text(row.department),
    title: text(row.title),
    position: text(row.position),
    branch: text(row.branch),
    managerCode: code(row.manager_employee_code),
    status: text(row.employment_status) || 'active'
  }));
  cachedAt = now;
  return cachedRows;
}

function invalidateOrgCache() { cachedRows = null; cachedAt = 0; }
function findByCode(rows, employeeCode) {
  const target = code(employeeCode);
  if (!target) return null;
  return (rows || []).find(row => row.employeeCode === target) || null;
}

function resolveSessionEmployeeCode(session) {
  const account = session && session.account;
  if (account && typeof account === 'object') return code(account.employeeCode || account.employee_code);
  return code(session && (session.employeeCode || session.employee_code));
}

function resolveSessionAccountRole(session) {
  const account = session && session.account;
  if (account && typeof account === 'object') return text(account.role).toLowerCase();
  return text(session && session.role).toLowerCase();
}

function resolveSessionAccountId(session) {
  const account = session && session.account;
  return text(account && account.id || session && session.sub);
}

/* Hub manager/learner never maps to a Task preset. */
function classifyActorType(session) {
  return resolveSessionAccountRole(session) === 'admin' ? 'admin' : 'nhan_vien';
}

function resolveManagedEmployeeCodes(actorEmployeeCode, rows) {
  const root = code(actorEmployeeCode);
  const managed = new Set();
  let frontier = new Set([root]);
  for (let depth = 0; depth < MAX_CHAIN_DEPTH && frontier.size; depth++) {
    const next = new Set();
    (rows || []).forEach(row => {
      if (frontier.has(row.managerCode) && row.employeeCode && !managed.has(row.employeeCode) && row.employeeCode !== root) {
        managed.add(row.employeeCode);
        next.add(row.employeeCode);
      }
    });
    frontier = next;
  }
  return managed;
}

// G3 fix (2026-08-28) — managedEmployeeCodes phải phản ánh ĐÚNG org graph
// thật (manager_employee_code trong employee_profiles) cho MỌI actorType có
// employeeCode thật và thực sự có cấp dưới trực tiếp, KHÔNG chỉ TBP/Trưởng
// ca. GĐ/TLGĐ (giam_doc/tro_ly_gd) cũng là 1 node thật trong org chart và có
// thể có direct report thật (bằng chứng: PHF010 Trợ lý GĐ quản lý trực tiếp
// 8 người) — trước fix, managedEmployeeCodes của họ luôn bị hard-code rỗng,
// khiến "Nhân sự tôi quản lý" (scope=managed) không có real peopleScope nào
// để dùng và rơi về nhánh capability all_company (xem resolveAuthorizedTaskScope
// ở task-core.js — fix riêng, cùng gate G3). KHÔNG đổi cho 'admin' (không có
// employeeCode thật, không phải 1 node trong org chart) hay 'nhan_vien' (giữ
// nguyên rỗng — về mặt tổ chức nhân viên thường không có cấp dưới; nếu có dữ
// liệu graph thật resolveManagedEmployeeCodes() vẫn trả rỗng tự nhiên, nên
// việc gate theo actorType ở đây chỉ là docs-as-code, không tự cấp quyền).
const MANAGED_GRAPH_ACTOR_TYPES = new Set(['truong_bo_phan', 'truong_ca', 'giam_doc', 'tro_ly_gd']);

function resolveActorContextForRecord(session, record, rows, presetCode) {
  if (!record || !record.employeeCode) fail('Không tìm thấy hồ sơ thật trong People Master.', 403, 'TASK_EMPLOYEE_NOT_FOUND');
  const employeeCode = code(record.employeeCode);
  const sessionActorType = classifyActorType(session);
  const normalizedPreset = code(presetCode || 'NHAN_VIEN');
  const actorType = sessionActorType === 'admin'
    ? 'admin'
    : (TASK_PRESET_TO_ACTOR_TYPE[normalizedPreset] || 'nhan_vien');
  return {
    accountId: resolveSessionAccountId(session),
    employeeCode,
    fullName: record.fullName || text(session && session.account && session.account.name),
    department: record.department,
    branch: record.branch,
    title: record.title,
    managerCode: record.managerCode,
    status: record.status,
    actorType,
    taskPresetCode: actorType === 'admin' ? 'ADMIN_SYSTEM' : (TASK_PRESET_TO_ACTOR_TYPE[normalizedPreset] ? normalizedPreset : 'NHAN_VIEN'),
    managedEmployeeCodes: MANAGED_GRAPH_ACTOR_TYPES.has(actorType) ? resolveManagedEmployeeCodes(employeeCode, rows) : new Set()
  };
}

function applyTaskPresetToActorContext(actorContext, presetCode, rows) {
  if (!actorContext || actorContext.actorType === 'admin') return actorContext;
  const normalizedPreset = code(presetCode || 'NHAN_VIEN');
  const actorType = TASK_PRESET_TO_ACTOR_TYPE[normalizedPreset] || 'nhan_vien';
  return Object.assign({}, actorContext, {
    actorType,
    taskPresetCode: TASK_PRESET_TO_ACTOR_TYPE[normalizedPreset] ? normalizedPreset : 'NHAN_VIEN',
    managedEmployeeCodes: MANAGED_GRAPH_ACTOR_TYPES.has(actorType)
      ? resolveManagedEmployeeCodes(actorContext.employeeCode, rows)
      : new Set()
  });
}

async function resolveActorContext(session) {
  if (resolveSessionAccountRole(session) === 'admin') {
    const accountId = resolveSessionAccountId(session);
    if (!accountId) fail('Phiên Admin thiếu account_id canonical cho PHF Task.', 401, 'TASK_ACCOUNT_IDENTITY_REQUIRED');
    const account = session && session.account || {};
    return {
      accountId,
      employeeCode: '',
      fullName: text(account.name || account.email) || 'Admin',
      department: '',
      branch: '',
      title: '',
      managerCode: '',
      status: 'system',
      actorType: 'admin',
      taskPresetCode: 'ADMIN_SYSTEM',
      managedEmployeeCodes: new Set()
    };
  }

  const employeeCode = resolveSessionEmployeeCode(session);
  if (!employeeCode) fail('Phiên làm việc thiếu employee_code — không thể xác định danh tính nhân viên PHF Task.', 401, 'TASK_IDENTITY_REQUIRED');
  const rows = await loadOrgRows();
  const record = findByCode(rows, employeeCode);
  if (!record) fail('Tài khoản chưa được liên kết với hồ sơ thật trong People Master.', 403, 'TASK_EMPLOYEE_NOT_FOUND');
  return resolveActorContextForRecord(session, record, rows, 'NHAN_VIEN');
}

/*
 * resolveCrossDepartmentContext — Cross-department Task V1 mục 2/13: ZERO
 * INPUT, tự nhận diện thuần từ department THẬT của actor (người giao) vs
 * department THẬT của Primary tại thời điểm gọi — KHÔNG có field cho user tự
 * khai. Deterministic 3 trạng thái, KHÔNG đoán khi thiếu dữ liệu:
 *   - isCrossDepartment === true  : 2 department khác nhau, đều xác định.
 *   - isCrossDepartment === false : 2 department giống nhau, đều xác định.
 *   - isCrossDepartment === null  : thiếu department 1 hoặc cả 2 bên (actor
 *     không có department thật — vd Admin — hoặc Primary chưa có department
 *     trong People Master) — KHÔNG được suy diễn true/false trong trường hợp
 *     này (mục 13: "unknown source department => cross-department status =
 *     unknown/not-derived chứ không đoán").
 * Pure function — không tự load dữ liệu, nhận đúng 2 chuỗi department thật đã
 * resolve từ nguồn canonical (employee_profiles qua loadOrgRows/resolveActorContext).
 */
function resolveCrossDepartmentContext(sourceDepartment, targetDepartment) {
  const source = text(sourceDepartment);
  const target = text(targetDepartment);
  if (!source || !target) {
    return { isCrossDepartment: null, sourceDepartment: source || null, targetDepartment: target || null };
  }
  return {
    isCrossDepartment: normalizeScopeText(source) !== normalizeScopeText(target),
    sourceDepartment: source,
    targetDepartment: target
  };
}

function isSalesAllBranchesSubject(subject) {
  return normalizeScopeText(subject && subject.department) === NORMALIZED_SALES_DEPARTMENT &&
    NORMALIZED_SALES_BRANCHES.has(normalizeScopeText(subject && subject.branch));
}

module.exports = {
  ACTOR_TYPES,
  TASK_PRESET_TO_ACTOR_TYPE,
  SALES_ALL_BRANCHES_DEPARTMENT,
  SALES_ALL_BRANCHES_BRANCHES,
  normalizeScopeText,
  loadOrgRows,
  invalidateOrgCache,
  findByCode,
  resolveSessionEmployeeCode,
  resolveSessionAccountRole,
  resolveSessionAccountId,
  classifyActorType,
  resolveManagedEmployeeCodes,
  resolveActorContextForRecord,
  applyTaskPresetToActorContext,
  resolveActorContext,
  isSalesAllBranchesSubject,
  resolveCrossDepartmentContext
};
