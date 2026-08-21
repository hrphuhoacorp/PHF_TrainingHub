'use strict';

/*
 * PHF Task — permission/scope engine. Tách 2 trục độc lập theo đúng Phase 1B
 * Design (mục C "Effective Scope Algorithm"):
 *   - people_scope: "thấy/giao được cho những nhân sự nào" (view/assign gate).
 *   - relation-to-task: "được làm gì trên MỘT task cụ thể" (creator/primary/
 *     related/manager-of-current-primary) — CỘNG THÊM vào scope, không thay thế.
 *
 * task_permission_grants CHỈ dùng để MỞ RỘNG (extend) / HẠN CHẾ (restrict) /
 * ỦY QUYỀN TẠM THỜI (delegation) trên nền base scope suy từ HR — KHÔNG bao giờ
 * là nguồn duy nhất định nghĩa actor type (khác lib/knl-permissions.js, nơi
 * preset_code chính là nguồn gán quyền toàn bộ).
 *
 * manager_of_primary là DERIVED authorization relation — KHÔNG lưu bảng quan
 * hệ riêng (Correction Gate mục 7). Resolve real-time từ primary hiện hành +
 * employee_profiles.manager_employee_code tại đúng thời điểm kiểm tra.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const {
  resolveActorContext,
  normalizeScopeText,
  isSalesAllBranchesSubject,
  loadOrgRows,
  findByCode
} = require('./task-employee-scope');

const configured = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const supabase = configured
  ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

const GRANTS_TABLE = 'task_permission_grants';

const CAPABILITY_KEYS = Object.freeze(['view', 'assign', 'update', 'manage']);
const TASK_SCOPE_TYPES = Object.freeze(new Set(['self', 'department', 'branch', 'employees', 'sales_all_branches_task', 'all_company']));

function text(value) { return String(value == null ? '' : value).trim(); }
function code(value) { return text(value).toUpperCase(); }
function fail(message, statusCode, errorCode) {
  const e = new Error(message);
  e.statusCode = statusCode || 400;
  e.code = errorCode || 'TASK_PERMISSION_DENIED';
  throw e;
}
function ensureDb() { if (!supabase) fail('Supabase chưa được cấu hình cho PHF Task.', 503, 'SUPABASE_NOT_CONFIGURED'); }

function throwDb(error) {
  if (!error) return;
  const errCode = text(error.code);
  const message = text(error.message);
  if (errCode === 'PGRST205' || errCode === '42P01' || /relation .* does not exist/i.test(message) || /Could not find the table/i.test(message)) {
    fail('Bảng phân quyền PHF Task (task_permission_grants) chưa được tạo trên Supabase. Vui lòng chạy scripts/PHF_TASK_PERMISSIONS_1.66.1.sql rồi thử lại.', 503, 'TASK_SCHEMA_MISSING');
  }
  throw error;
}

/*
 * Base scope suy trực tiếp từ HR (actorType) — KHÔNG đọc task_permission_grants
 * ở bước này. TBP/Trưởng ca không mặc định toàn công ty (an toàn nhất theo
 * rule đã chốt). Admin/Giám đốc/Trợ lý GĐ ĐỀU xem + giao việc toàn công ty
 * mặc định (Foundation Audit Correction mục 1 — business rule LOCKED: "Trợ
 * lý Giám đốc mặc định được giao việc toàn công ty", không cần Task
 * Exception cho assign). "view ≠ assign" (rule F.6) vẫn áp dụng ở
 * capability manage: Trợ lý GĐ KHÔNG mặc định quản lý Task Permission/Task
 * Settings — chỉ Admin mới có manage=true.
 */
function resolveBaseTaskScope(actorContext) {
  switch (actorContext.actorType) {
    case 'admin':
      return { capabilities: { view: true, assign: true, update: true, manage: true }, peopleScope: { type: 'all_company', values: [] } };
    case 'giam_doc':
      return { capabilities: { view: true, assign: true, update: true, manage: false }, peopleScope: { type: 'all_company', values: [] } };
    case 'tro_ly_gd':
      return { capabilities: { view: true, assign: true, update: true, manage: false }, peopleScope: { type: 'all_company', values: [] } };
    case 'truong_bo_phan':
      return {
        capabilities: { view: true, assign: true, update: true, manage: false },
        peopleScope: { type: 'employees', values: [actorContext.employeeCode, ...actorContext.managedEmployeeCodes] }
      };
    case 'truong_ca':
      return { capabilities: { view: true, assign: true, update: true, manage: false }, peopleScope: { type: 'sales_all_branches_task', values: [] } };
    case 'nhan_vien':
    default:
      return { capabilities: { view: true, assign: true, update: true, manage: false }, peopleScope: { type: 'self', values: [actorContext.employeeCode] } };
  }
}

function subjectMatchesTaskScope(subject, scopeValue) {
  const raw = scopeValue && typeof scopeValue === 'object' ? scopeValue : {};
  const type = String(raw.type || 'self').toLowerCase();
  if (!TASK_SCOPE_TYPES.has(type)) return false;
  if (type === 'all_company') return true;
  if (type === 'sales_all_branches_task') return isSalesAllBranchesSubject(subject);
  const values = (Array.isArray(raw.values) ? raw.values : []).map(normalizeScopeText).filter(Boolean);
  if (type === 'self' || type === 'employees') {
    return values.includes(normalizeScopeText(subject && subject.employeeCode));
  }
  if (type === 'department') return values.includes(normalizeScopeText(subject && subject.department));
  if (type === 'branch') return values.includes(normalizeScopeText(subject && subject.branch));
  return false;
}

async function loadActiveGrants(employeeCode) {
  ensureDb();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase.from(GRANTS_TABLE)
    .select('*')
    .eq('grantee_employee_code', code(employeeCode))
    .eq('is_active', true)
    .lte('effective_from', nowIso)
    .limit(200);
  if (error) throwDb(error);
  return (data || []).filter(g => !g.effective_to || text(g.effective_to) >= nowIso);
}

/*
 * extend: OR vào capabilities (bật thêm quyền), union values vào scope.
 * restrict: AND-NOT vào capabilities (chỉ được tắt bớt, không tự bật thêm),
 *   KHÔNG đổi people_scope ở Batch 1 (restrict theo scope cần task thật để
 *   kiểm chứng hành vi subtract — để lại phase implement CRUD, không invent
 *   semantics chưa có test case thật).
 * delegation: xử lý giống extend (đã bị loadActiveGrants lọc theo effective
 *   window nên tự hết hiệu lực đúng lúc, không cần logic riêng ở đây).
 */
function applyGrant(scope, grant) {
  const next = {
    capabilities: Object.assign({}, scope.capabilities),
    peopleScope: { type: scope.peopleScope.type, values: (scope.peopleScope.values || []).slice() }
  };
  const grantCaps = (grant && grant.capabilities) || {};
  CAPABILITY_KEYS.forEach(key => {
    if (typeof grantCaps[key] !== 'boolean') return;
    if (grant.grant_type === 'restrict') {
      if (grantCaps[key] === false) next.capabilities[key] = false;
    } else if (grantCaps[key] === true) {
      next.capabilities[key] = true;
    }
  });
  const grantScope = (grant && grant.people_scope) || {};
  if (grant.grant_type === 'extend' || grant.grant_type === 'delegation') {
    if (grantScope.type === 'all_company') {
      next.peopleScope = { type: 'all_company', values: [] };
    } else if (next.peopleScope.type !== 'all_company' && Array.isArray(grantScope.values) && grantScope.values.length) {
      const mergedType = next.peopleScope.type === 'sales_all_branches_task' ? next.peopleScope.type : 'employees';
      next.peopleScope = { type: mergedType, values: Array.from(new Set(next.peopleScope.values.concat(grantScope.values))) };
    }
  }
  return next;
}

async function resolveEffectiveTaskScope(session) {
  const actorContext = await resolveActorContext(session);
  let scope = resolveBaseTaskScope(actorContext);
  const grants = await loadActiveGrants(actorContext.employeeCode);
  // restrict áp trước, extend/delegation áp sau — hạn chế không bị extend sau đó ghi đè ngầm.
  const ordered = grants.slice().sort((a, b) => (a.grant_type === 'restrict' ? 0 : 1) - (b.grant_type === 'restrict' ? 0 : 1));
  ordered.forEach(grant => { scope = applyGrant(scope, grant); });
  return { actorContext, scope, grants };
}

function requireTaskCapability(effectiveScope, capability) {
  if (CAPABILITY_KEYS.indexOf(capability) === -1) fail('Capability PHF Task không hợp lệ: ' + capability, 400, 'TASK_CAPABILITY_INVALID');
  if (!effectiveScope.scope.capabilities[capability]) {
    fail('Không có quyền "' + capability + '" trong PHF Task.', 403, 'TASK_CAPABILITY_DENIED');
  }
}

/*
 * task = { createdByEmployeeCode }, assignees = [{ employeeCode, role, isActive }].
 * Chỉ nhận object thuần (không tự query task_tasks) — giữ Batch 1 tách biệt
 * khỏi CRUD Task thật, theo đúng phạm vi "permission core" của batch này.
 */
async function classifyTaskRelation(actorEmployeeCode, task, assignees) {
  const me = code(actorEmployeeCode);
  if (code(task && task.createdByEmployeeCode) === me) return 'creator';
  const list = assignees || [];
  const activePrimary = list.find(a => a.role === 'primary' && a.isActive);
  if (activePrimary && code(activePrimary.employeeCode) === me) return 'primary';
  const activeRelated = list.find(a => a.role === 'related' && a.isActive && code(a.employeeCode) === me);
  if (activeRelated) return 'related';
  if (activePrimary) {
    const rows = await loadOrgRows();
    const primaryRecord = findByCode(rows, activePrimary.employeeCode);
    if (primaryRecord && code(primaryRecord.managerCode) === me) return 'manager_of_primary';
  }
  return 'none';
}

// manager_of_primary CHỈ view — không approve, không tự thêm related, không
// giữ quyền sau khi primary đổi phòng ban (Correction Gate mục 7).
const RELATION_VIEW_ALLOWED = new Set(['creator', 'primary', 'related', 'manager_of_primary']);

async function canViewTask(session, task, assignees) {
  const { actorContext, scope } = await resolveEffectiveTaskScope(session);
  const relation = await classifyTaskRelation(actorContext.employeeCode, task, assignees);
  if (RELATION_VIEW_ALLOWED.has(relation)) return true;
  if (!scope.capabilities.view) return false;
  const activePrimary = (assignees || []).find(a => a.role === 'primary' && a.isActive);
  if (!activePrimary) return false;
  const rows = await loadOrgRows();
  const primarySubject = findByCode(rows, activePrimary.employeeCode) || { employeeCode: code(activePrimary.employeeCode) };
  return subjectMatchesTaskScope(primarySubject, scope.peopleScope);
}

async function canAssignTaskTo(session, targetEmployeeCode) {
  const { actorContext, scope } = await resolveEffectiveTaskScope(session);
  // Self-task luôn được phép (rule G.12) — độc lập với capability "assign",
  // vì actor có thể chưa/không có capability assign (VD Nhân viên ngoài
  // self-task) nhưng vẫn phải tự nhắc việc được.
  if (code(targetEmployeeCode) === actorContext.employeeCode) return true;
  if (!scope.capabilities.assign) return false;
  const rows = await loadOrgRows();
  const targetSubject = findByCode(rows, targetEmployeeCode) || { employeeCode: code(targetEmployeeCode) };
  return subjectMatchesTaskScope(targetSubject, scope.peopleScope);
}

module.exports = {
  CAPABILITY_KEYS,
  TASK_SCOPE_TYPES,
  resolveBaseTaskScope,
  subjectMatchesTaskScope,
  loadActiveGrants,
  applyGrant,
  resolveEffectiveTaskScope,
  requireTaskCapability,
  classifyTaskRelation,
  canViewTask,
  canAssignTaskTo
};
