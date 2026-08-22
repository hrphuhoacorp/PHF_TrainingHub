'use strict';

/*
 * PHF Task permission engine.
 *
 * Effective permission = canonical base preset assignment + exception grants.
 * Admin is the only short circuit and is identified by authenticated account
 * role. Hub manager/learner and People Master title never select a Task role.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const {
  resolveActorContext,
  applyTaskPresetToActorContext,
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

const ASSIGNMENTS_TABLE = 'task_permission_assignments';
const GRANTS_TABLE = 'task_permission_grants';
const TASK_PRESET_CODES = Object.freeze(['GIAM_DOC', 'TRO_LY_GD', 'TRUONG_BO_PHAN', 'TRUONG_CA', 'NHAN_VIEN']);
const CAPABILITY_KEYS = Object.freeze(['view', 'assign', 'update', 'manage']);
const TASK_SCOPE_TYPES = Object.freeze(new Set(['self', 'department', 'branch', 'employees', 'sales_all_branches_task', 'all_company']));

function text(value) { return String(value == null ? '' : value).trim(); }
function code(value) { return text(value).toUpperCase(); }
function isActiveEmployee(subject) { return text(subject && subject.status).toLowerCase() === 'active'; }
function fail(message, statusCode, errorCode) {
  const error = new Error(message);
  error.statusCode = statusCode || 400;
  error.code = errorCode || 'TASK_PERMISSION_DENIED';
  throw error;
}
function ensureDb() {
  if (!supabase) fail('Supabase chưa được cấu hình cho PHF Task.', 503, 'SUPABASE_NOT_CONFIGURED');
}
function throwDb(error, tableName) {
  if (!error) return;
  const errorCode = text(error.code);
  const message = text(error.message);
  if (errorCode === 'PGRST205' || errorCode === '42P01' || /relation .* does not exist/i.test(message) || /Could not find the table/i.test(message)) {
    fail('Schema phân quyền PHF Task chưa đầy đủ (' + (tableName || 'Task Permission') + '). Cần áp dụng migration Foundation Correction trên môi trường LOCAL.', 503, 'TASK_SCHEMA_MISSING');
  }
  throw error;
}
function isCurrentlyEffective(row, nowIso) {
  return row && row.is_active === true && text(row.effective_from) <= nowIso && (!row.effective_to || text(row.effective_to) >= nowIso);
}
function identityMatches(row, actorContext) {
  if (!row || !actorContext) return false;
  const accountMatch = text(actorContext.accountId) && text(row.account_id) === text(actorContext.accountId);
  const employeeMatch = code(actorContext.employeeCode) && code(row.employee_code) === code(actorContext.employeeCode);
  return !!(accountMatch || employeeMatch);
}
function selectCurrentAssignment(rows, actorContext, nowIso) {
  return (rows || [])
    .filter(row => isCurrentlyEffective(row, nowIso) && identityMatches(row, actorContext))
    .sort((left, right) => {
      const leftAccount = text(left.account_id) === text(actorContext.accountId) ? 1 : 0;
      const rightAccount = text(right.account_id) === text(actorContext.accountId) ? 1 : 0;
      return rightAccount - leftAccount || text(right.effective_from).localeCompare(text(left.effective_from)) || text(right.updated_at).localeCompare(text(left.updated_at));
    })[0] || null;
}

function resolveBaseTaskScope(actorContext) {
  switch (actorContext.actorType) {
    case 'admin':
      return { capabilities: { view: true, assign: true, update: true, manage: true }, peopleScope: { type: 'all_company', values: [] } };
    case 'giam_doc':
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
  if (type === 'self' || type === 'employees') return values.includes(normalizeScopeText(subject && subject.employeeCode));
  if (type === 'department') return values.includes(normalizeScopeText(subject && subject.department));
  if (type === 'branch') return values.includes(normalizeScopeText(subject && subject.branch));
  return false;
}

async function loadActiveTaskAssignment(actorContext) {
  if (actorContext && actorContext.actorType === 'admin') return null;
  ensureDb();
  const nowIso = new Date().toISOString();
  let query = supabase.from(ASSIGNMENTS_TABLE).select('*').eq('is_active', true).lte('effective_from', nowIso);
  const accountId = text(actorContext && actorContext.accountId);
  const employeeCode = code(actorContext && actorContext.employeeCode);
  if (!accountId && !employeeCode) return null;
  if (accountId && employeeCode) query = query.or('account_id.eq.' + accountId + ',employee_code.eq.' + employeeCode);
  else if (accountId) query = query.eq('account_id', accountId);
  else query = query.eq('employee_code', employeeCode);
  const { data, error } = await query.limit(50);
  if (error) throwDb(error, ASSIGNMENTS_TABLE);
  return selectCurrentAssignment(data || [], actorContext, nowIso);
}

async function loadActiveGrants(employeeCode) {
  const target = code(employeeCode);
  if (!target) return [];
  ensureDb();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase.from(GRANTS_TABLE)
    .select('*')
    .eq('grantee_employee_code', target)
    .eq('is_active', true)
    .lte('effective_from', nowIso)
    .limit(200);
  if (error) throwDb(error, GRANTS_TABLE);
  return (data || []).filter(grant => !grant.effective_to || text(grant.effective_to) >= nowIso);
}

function applyGrant(scope, grant) {
  const next = {
    capabilities: Object.assign({}, scope.capabilities),
    peopleScope: { type: scope.peopleScope.type, values: (scope.peopleScope.values || []).slice() }
  };
  const grantCaps = grant && grant.capabilities || {};
  CAPABILITY_KEYS.forEach(key => {
    if (typeof grantCaps[key] !== 'boolean') return;
    if (grant.grant_type === 'restrict') {
      if (grantCaps[key] === false) next.capabilities[key] = false;
    } else if (grantCaps[key] === true) next.capabilities[key] = true;
  });
  const grantScope = grant && grant.people_scope || {};
  if (grant.grant_type === 'extend' || grant.grant_type === 'delegation') {
    if (grantScope.type === 'all_company') {
      next.peopleScope = { type: 'all_company', values: [] };
    } else if (next.peopleScope.type !== 'all_company' && Array.isArray(grantScope.values) && grantScope.values.length) {
      const mergedType = next.peopleScope.type === 'sales_all_branches_task' ? next.peopleScope.type : 'employees';
      next.peopleScope = { type: mergedType, values: Array.from(new Set(next.peopleScope.values.concat(grantScope.values.map(code)))) };
    }
  }
  return next;
}

function resolveEffectiveTaskScopeFromGrants(actorContext, grants, assignment) {
  let scope = resolveBaseTaskScope(actorContext);
  const ordered = (grants || []).slice().sort((left, right) => (left.grant_type === 'restrict' ? 0 : 1) - (right.grant_type === 'restrict' ? 0 : 1));
  ordered.forEach(grant => { scope = applyGrant(scope, grant); });
  return { actorContext, scope, assignment: assignment || null, grants: grants || [] };
}

async function resolveEffectiveTaskScopeForActorContext(actorContext) {
  if (actorContext.actorType === 'admin') return resolveEffectiveTaskScopeFromGrants(actorContext, [], null);
  const [assignment, grants, orgRows] = await Promise.all([
    loadActiveTaskAssignment(actorContext),
    loadActiveGrants(actorContext.employeeCode),
    loadOrgRows()
  ]);
  const effectiveActor = applyTaskPresetToActorContext(actorContext, assignment && assignment.preset_code || 'NHAN_VIEN', orgRows);
  return resolveEffectiveTaskScopeFromGrants(effectiveActor, grants, assignment);
}

async function resolveEffectiveTaskScopesForActorContexts(actorContexts) {
  ensureDb();
  const contexts = Array.isArray(actorContexts) ? actorContexts : [];
  const nonAdmins = contexts.filter(context => context && context.actorType !== 'admin');
  if (!nonAdmins.length) return contexts.map(context => resolveEffectiveTaskScopeFromGrants(context, [], null));
  const nowIso = new Date().toISOString();
  const employeeCodes = Array.from(new Set(nonAdmins.map(context => code(context.employeeCode)).filter(Boolean)));
  const [assignmentResult, grantResult, orgRows] = await Promise.all([
    supabase.from(ASSIGNMENTS_TABLE).select('*').eq('is_active', true).lte('effective_from', nowIso).limit(5000),
    supabase.from(GRANTS_TABLE).select('*').in('grantee_employee_code', employeeCodes).eq('is_active', true).lte('effective_from', nowIso).limit(5000),
    loadOrgRows()
  ]);
  if (assignmentResult.error) throwDb(assignmentResult.error, ASSIGNMENTS_TABLE);
  if (grantResult.error) throwDb(grantResult.error, GRANTS_TABLE);
  const assignmentRows = assignmentResult.data || [];
  const activeGrants = (grantResult.data || []).filter(grant => !grant.effective_to || text(grant.effective_to) >= nowIso);
  return contexts.map(context => {
    if (context.actorType === 'admin') return resolveEffectiveTaskScopeFromGrants(context, [], null);
    const assignment = selectCurrentAssignment(assignmentRows, context, nowIso);
    const effectiveActor = applyTaskPresetToActorContext(context, assignment && assignment.preset_code || 'NHAN_VIEN', orgRows);
    const grants = activeGrants.filter(grant => code(grant.grantee_employee_code) === code(context.employeeCode));
    return resolveEffectiveTaskScopeFromGrants(effectiveActor, grants, assignment);
  });
}

async function resolveEffectiveTaskScope(session) {
  const actorContext = await resolveActorContext(session);
  return resolveEffectiveTaskScopeForActorContext(actorContext);
}

function requireTaskCapability(effectiveScope, capability) {
  if (!CAPABILITY_KEYS.includes(capability)) fail('Capability PHF Task không hợp lệ: ' + capability, 400, 'TASK_CAPABILITY_INVALID');
  if (!effectiveScope.scope.capabilities[capability]) fail('Không có quyền "' + capability + '" trong PHF Task.', 403, 'TASK_CAPABILITY_DENIED');
}

function actorIdentity(actorOrEmployeeCode) {
  if (actorOrEmployeeCode && typeof actorOrEmployeeCode === 'object') {
    return { accountId: text(actorOrEmployeeCode.accountId), employeeCode: code(actorOrEmployeeCode.employeeCode) };
  }
  return { accountId: '', employeeCode: code(actorOrEmployeeCode) };
}

async function classifyTaskRelation(actorOrEmployeeCode, task, assignees) {
  const actor = actorIdentity(actorOrEmployeeCode);
  const creatorAccountId = text(task && task.createdByAccountId);
  const creatorEmployeeCode = code(task && task.createdByEmployeeCode);
  if ((actor.accountId && creatorAccountId === actor.accountId) || (actor.employeeCode && creatorEmployeeCode === actor.employeeCode)) return 'creator';
  const list = assignees || [];
  const activePrimary = list.find(assignee => assignee.role === 'primary' && assignee.isActive);
  if (activePrimary && code(activePrimary.employeeCode) === actor.employeeCode) return 'primary';
  if (list.some(assignee => assignee.role === 'related' && assignee.isActive && code(assignee.employeeCode) === actor.employeeCode)) return 'related';
  if (activePrimary && actor.employeeCode) {
    const rows = await loadOrgRows();
    const primaryRecord = findByCode(rows, activePrimary.employeeCode);
    if (primaryRecord && code(primaryRecord.managerCode) === actor.employeeCode) return 'manager_of_primary';
  }
  return 'none';
}

const RELATION_VIEW_ALLOWED = new Set(['creator', 'primary', 'related', 'manager_of_primary']);

async function canViewTask(session, task, assignees) {
  const { actorContext, scope } = await resolveEffectiveTaskScope(session);
  if (actorContext.actorType === 'admin') return true;
  const relation = await classifyTaskRelation(actorContext, task, assignees);
  if (RELATION_VIEW_ALLOWED.has(relation)) return true;
  if (!scope.capabilities.view) return false;
  const activePrimary = (assignees || []).find(assignee => assignee.role === 'primary' && assignee.isActive);
  if (!activePrimary) return false;
  const rows = await loadOrgRows();
  const primarySubject = findByCode(rows, activePrimary.employeeCode) || { employeeCode: code(activePrimary.employeeCode) };
  return subjectMatchesTaskScope(primarySubject, scope.peopleScope);
}

async function canAssignTaskTo(session, targetEmployeeCode) {
  const { actorContext, scope } = await resolveEffectiveTaskScope(session);
  if (actorContext.actorType !== 'admin' && !isActiveEmployee(actorContext)) return false;
  const rows = await loadOrgRows();
  const targetSubject = findByCode(rows, targetEmployeeCode);
  if (!targetSubject || !isActiveEmployee(targetSubject)) return false;
  if (actorContext.actorType === 'admin') return true;
  if (code(targetEmployeeCode) === actorContext.employeeCode) return true;
  if (!scope.capabilities.assign) return false;
  return subjectMatchesTaskScope(targetSubject, scope.peopleScope);
}

async function listTaskAssignableEmployees(session) {
  const { actorContext, scope } = await resolveEffectiveTaskScope(session);
  if (actorContext.actorType !== 'admin' && !isActiveEmployee(actorContext)) return [];
  const rows = await loadOrgRows();
  return rows.filter(subject => {
    if (!subject.employeeCode || !isActiveEmployee(subject)) return false;
    if (actorContext.actorType === 'admin') return true;
    if (subject.employeeCode === actorContext.employeeCode) return true;
    return !!scope.capabilities.assign && subjectMatchesTaskScope(subject, scope.peopleScope);
  }).map(subject => ({
    employeeCode: subject.employeeCode,
    fullName: subject.fullName,
    department: subject.department,
    title: subject.title,
    position: subject.position,
    branch: subject.branch,
    managerEmployeeCode: subject.managerCode,
    employmentStatus: 'active'
  })).sort((left, right) => left.fullName.localeCompare(right.fullName, 'vi'));
}

module.exports = {
  ASSIGNMENTS_TABLE,
  GRANTS_TABLE,
  TASK_PRESET_CODES,
  CAPABILITY_KEYS,
  TASK_SCOPE_TYPES,
  selectCurrentAssignment,
  resolveBaseTaskScope,
  subjectMatchesTaskScope,
  loadActiveTaskAssignment,
  loadActiveGrants,
  applyGrant,
  resolveEffectiveTaskScopeFromGrants,
  resolveEffectiveTaskScopeForActorContext,
  resolveEffectiveTaskScopesForActorContexts,
  resolveEffectiveTaskScope,
  requireTaskCapability,
  classifyTaskRelation,
  canViewTask,
  canAssignTaskTo,
  listTaskAssignableEmployees
};
