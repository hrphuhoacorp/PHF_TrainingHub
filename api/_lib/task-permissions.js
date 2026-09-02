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
  findByCode,
  TASK_PRESET_TO_ACTOR_TYPE,
  // Proposal V2 recipient gate (2026-08-29 fix) — cùng primitive
  // listTaskAdminPeople() dùng để enumerate "mọi người + effective scope
  // của họ, kể cả Admin xác định qua account role chứ không qua preset".
  resolveActorContextForRecord
} = require('./task-employee-scope');
// listHubAccountSummaries — account/role data (user_accounts), KHÔNG phải
// Task data — cùng nguồn listTaskAdminPeople() (api/_lib/task-core.js) đã
// dùng để map employeeCode -> account.role, cần để phát hiện Admin (Admin
// KHÔNG có row trong task_permission_assignments — actorType='admin' xác
// định thuần qua account.role, xem task-employee-scope.js::resolveActorContext).
// KHÔNG có circular require (auth.js không require lại module này).
const { listHubAccountSummaries } = require('./auth');

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

/*
 * peopleScope = phạm vi VIEW/UPDATE (ai được xem/can thiệp Task của họ).
 * assignScope = phạm vi ASSIGN (được giao Task mới cho ai) — TÁCH RIÊNG theo
 * Permission Matrix V1 (Phase 1): TBP/Trưởng ca được giao Task cho TOÀN BỘ
 * nhân viên active công ty, nhưng KHÔNG vì vậy mà tự động xem/sửa được Task
 * của người ngoài phạm vi quản lý của họ. Mặc định assignScope = peopleScope
 * trừ khi role cần tách riêng (TBP/Trưởng ca, Nhân viên).
 */
function resolveBaseTaskScope(actorContext) {
  switch (actorContext.actorType) {
    case 'admin':
      return { capabilities: { view: true, assign: true, update: true, manage: true }, peopleScope: { type: 'all_company', values: [] }, assignScope: { type: 'all_company', values: [] } };
    case 'giam_doc':
    case 'tro_ly_gd':
      // COMPANY-LEVEL PERMISSION CLEANUP (2026-08-29, business owner
      // correction) — Admin = Giám đốc = Trợ lý Giám đốc trên "Nhân sự &
      // phân quyền" (manage capability = quyền xem/điều chỉnh Task
      // permission assignment/grant của người khác). Đây là canonical
      // preset-level (actorType), KHÔNG special-case theo tên/account cụ
      // thể — mọi actor có preset GIAM_DOC/TRO_LY_GD đều được, bất kể là
      // Tiên/Vinh/Ngọc hay bất kỳ ai được gán preset này sau này. "Cài đặt"
      // (task category admin) vẫn giữ nguyên actorType==='admin' riêng
      // (task-core.js createTaskCategory/etc.) — KHÔNG bị ảnh hưởng bởi
      // dòng này, đó là gate hoàn toàn tách biệt.
      return { capabilities: { view: true, assign: true, update: true, manage: true }, peopleScope: { type: 'all_company', values: [] }, assignScope: { type: 'all_company', values: [] } };
    case 'truong_bo_phan':
    case 'truong_ca': {
      // Permission preset V1 của Trưởng bộ phận và Trưởng ca giống hệt nhau
      // (2 identity khác nhau, cùng 1 preset) — KHÔNG hard-code Trưởng ca theo
      // "Bộ phận bán hàng × 3 chi nhánh" nữa (implementation gap đã sửa).
      const peopleScope = { type: 'employees', values: [actorContext.employeeCode, ...actorContext.managedEmployeeCodes] };
      return {
        capabilities: { view: true, assign: true, update: true, manage: false },
        peopleScope,
        assignScope: { type: 'all_company', values: [] }
      };
    }
    case 'nhan_vien':
    default:
      return { capabilities: { view: true, assign: true, update: true, manage: false }, peopleScope: { type: 'self', values: [actorContext.employeeCode] }, assignScope: { type: 'self', values: [actorContext.employeeCode] } };
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

/*
 * scopeToEmployeeSet — resolves ANY peopleScope descriptor to the concrete
 * set of active employee_codes it currently matches, using the same org
 * snapshot (orgRows) and the same per-subject matcher (isSalesAllBranchesSubject/
 * normalizeScopeText) already used elsewhere in this file. This is the
 * primitive that makes RESTRICT's peopleScope narrowing exact (real set
 * intersection) instead of symbolic — required because 'department'/'branch'/
 * 'all_company'/'sales_all_branches_task' are not themselves employee lists.
 */
function scopeToEmployeeSet(scopeValue, orgRows) {
  const raw = scopeValue && typeof scopeValue === 'object' ? scopeValue : {};
  const type = String(raw.type || 'self').toLowerCase();
  const activeRows = (orgRows || []).filter(isActiveEmployee);
  if (type === 'all_company') return new Set(activeRows.map(row => code(row.employeeCode)));
  if (type === 'sales_all_branches_task') return new Set(activeRows.filter(isSalesAllBranchesSubject).map(row => code(row.employeeCode)));
  if (type === 'department') {
    const values = (Array.isArray(raw.values) ? raw.values : []).map(normalizeScopeText).filter(Boolean);
    return new Set(activeRows.filter(row => values.includes(normalizeScopeText(row.department))).map(row => code(row.employeeCode)));
  }
  if (type === 'branch') {
    const values = (Array.isArray(raw.values) ? raw.values : []).map(normalizeScopeText).filter(Boolean);
    return new Set(activeRows.filter(row => values.includes(normalizeScopeText(row.branch))).map(row => code(row.employeeCode)));
  }
  // 'self' / 'employees' — already an explicit employee_code list.
  return new Set((Array.isArray(raw.values) ? raw.values : []).map(code).filter(Boolean));
}

/*
 * intersectPeopleScope — RESTRICT narrowing = literal set intersection
 * between the scope accumulated so far and the restrict grant's own
 * people_scope, both resolved to concrete employee_codes via scopeToEmployeeSet
 * (org-data-based, not symbolic type matching — a department-vs-employees
 * intersection is resolved correctly, not skipped). Result always collapses
 * to an explicit {type:'employees', values:[...]} — exact, never a guess.
 *
 * type='all_company' on a restrict is the mathematical IDENTITY element for
 * intersection (matches everyone -> narrows nothing) — this is the
 * documented convention for a "capability-only" restrict grant that must
 * NOT touch peopleScope at all (see PHF_TASK_PERMISSION_GRANT_PRECEDENCE_
 * FIX_V1_REPORT, contract clarification: use people_scope:{type:'all_company',
 * values:[]} for a capability-only restrict going forward, NOT {type:'self',
 * values:[]} — the latter would now genuinely narrow to nobody, since it is
 * a real, distinct scope type, not a sentinel).
 */
function intersectPeopleScope(currentScope, restrictScopeValue, orgRows) {
  const restrictType = String(restrictScopeValue && restrictScopeValue.type || '').toLowerCase();
  if (!TASK_SCOPE_TYPES.has(restrictType) || restrictType === 'all_company') return currentScope;
  const currentSet = scopeToEmployeeSet(currentScope, orgRows);
  const restrictSet = scopeToEmployeeSet(restrictScopeValue, orgRows);
  const narrowedValues = Array.from(currentSet).filter(c => restrictSet.has(c));
  return { type: 'employees', values: narrowedValues };
}

function applyGrant(scope, grant, orgRows) {
  const next = {
    capabilities: Object.assign({}, scope.capabilities),
    peopleScope: { type: scope.peopleScope.type, values: (scope.peopleScope.values || []).slice() },
    // Grant V1 chỉ extend peopleScope (VIEW/UPDATE) — assignScope giữ nguyên
    // theo base preset, không bị grant chồng lên.
    assignScope: scope.assignScope
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
    } else if (next.peopleScope.type !== 'all_company') {
      // MODULE-LEVEL DEPARTMENT SCOPE V1 (2026-09-01) — an EXTEND grant's own
      // people_scope descriptor (employees | department | branch) is resolved
      // to the concrete set of ACTIVE employee_codes it currently matches
      // (via the same scopeToEmployeeSet() the RESTRICT path already uses) and
      // UNION-ed into the running peopleScope. This keeps the accumulated
      // scope an explicit employee list — the exact shape RESTRICT
      // intersection collapses to — and finally makes a
      // {type:'department', values:[...]} extend grant resolve to that
      // department's people instead of being coerced into literal codes.
      // Backward compatible: for {type:'employees'|'self'} scopeToEmployeeSet
      // returns the value list verbatim, so existing grants behave identically.
      const addCodes = scopeToEmployeeSet(grantScope, orgRows);
      if (addCodes.size) {
        const mergedType = next.peopleScope.type === 'sales_all_branches_task' ? next.peopleScope.type : 'employees';
        next.peopleScope = {
          type: mergedType,
          values: Array.from(new Set((next.peopleScope.values || []).map(code).concat(Array.from(addCodes))))
        };
      }
    }
  } else if (grant.grant_type === 'restrict') {
    next.peopleScope = intersectPeopleScope(next.peopleScope, grantScope, orgRows);
  }
  return next;
}

/*
 * RESTRICT MUST WIN over EXTEND on any dimension they both target (locked
 * business rule). This is enforced by a two-PHASE application, NOT by
 * sorting individual grants into one combined order: ALL extend/delegation
 * grants apply first (broadening only — union for peopleScope, OR-into-true
 * for capabilities, both commutative/associative, so the relative order
 * among extends never matters), THEN ALL restrict grants apply
 * (narrowing only — intersection for peopleScope, AND-into-false for
 * capabilities, both also commutative/associative, so the relative order
 * among restricts never matters either). Applying every restrict strictly
 * AFTER every extend is what makes restrict authoritative on a shared
 * dimension regardless of each grant's row/creation order — the previous
 * design applied restrict-then-extend (sorted, but in the WRONG phase
 * order) so a later-applied extend silently re-broadened whatever a
 * restrict had just narrowed. Fixed here — see PHF_TASK_PERMISSION_GRANT_
 * PRECEDENCE_FIX_V1_REPORT.
 */
// WHO vs WHAT (MODULE-LEVEL DEPARTMENT SCOPE V1 — authority-leak fix,
// 2026-09-01). A grant whose people_scope.type is 'department' (or 'branch')
// is VISIBILITY-only: it widens peopleScope so the holder can see / cover
// those people, but it must NOT by itself confer lifecycle-intervention
// authority (change deadline / transfer / reopen / direct cancel / attachment
// manage). Only base scope plus grants that name people explicitly
// ('employees'/'self') or open everything ('all_company'/
// 'sales_all_branches_task') feed the parallel "authority" people scope that
// resolveUpdate/DirectCancelAuthorityBasis() compares the primary against.
// VISIBILITY-only grant scope types — a grant whose people_scope.type is one
// of these widens who the holder can see/cover but confers NO lifecycle
// intervention authority on its own. Everything else (explicit 'employees'/
// 'self' lists, 'all_company', 'sales_all_branches_task', or an unrecognised/
// legacy type) is treated as authority-conferring — i.e. the pre-existing
// behaviour is preserved for every grant shape except the new module-level
// department/branch VISIBILITY scope.
const VISIBILITY_ONLY_GRANT_SCOPE_TYPES = Object.freeze(new Set(['department', 'branch']));

function grantConfersInterventionAuthority(grant) {
  if (!grant) return false;
  if (grant.grant_type === 'restrict') return true; // restrict must always still narrow the authority scope
  const type = String(grant.people_scope && grant.people_scope.type || '').toLowerCase();
  return !VISIBILITY_ONLY_GRANT_SCOPE_TYPES.has(type);
}

function resolveEffectiveTaskScopeFromGrants(actorContext, grants, assignment, orgRows) {
  let scope = resolveBaseTaskScope(actorContext);
  const allGrants = grants || [];
  const broadening = allGrants.filter(grant => grant && grant.grant_type !== 'restrict');
  const narrowing = allGrants.filter(grant => grant && grant.grant_type === 'restrict');
  broadening.forEach(grant => { scope = applyGrant(scope, grant, orgRows); });
  narrowing.forEach(grant => { scope = applyGrant(scope, grant, orgRows); });

  // Parallel authority-only people scope — base + only authority-conferring
  // grants (department/branch VISIBILITY grants are deliberately excluded).
  // Same two-phase extend-then-restrict application as the visibility scope.
  // Returned as a SIBLING of `scope` (not a property on it) so `scope` stays
  // byte-identical to the base preset when there are no grants.
  let authorityScope = resolveBaseTaskScope(actorContext);
  broadening.filter(grantConfersInterventionAuthority).forEach(grant => { authorityScope = applyGrant(authorityScope, grant, orgRows); });
  narrowing.forEach(grant => { authorityScope = applyGrant(authorityScope, grant, orgRows); });

  return { actorContext, scope, authorityPeopleScope: authorityScope.peopleScope, assignment: assignment || null, grants: allGrants };
}

async function resolveEffectiveTaskScopeForActorContext(actorContext) {
  if (actorContext.actorType === 'admin') return resolveEffectiveTaskScopeFromGrants(actorContext, [], null, []);
  const [assignment, grants, orgRows] = await Promise.all([
    loadActiveTaskAssignment(actorContext),
    loadActiveGrants(actorContext.employeeCode),
    loadOrgRows()
  ]);
  const effectiveActor = applyTaskPresetToActorContext(actorContext, assignment && assignment.preset_code || 'NHAN_VIEN', orgRows);
  return resolveEffectiveTaskScopeFromGrants(effectiveActor, grants, assignment, orgRows);
}

async function resolveEffectiveTaskScopesForActorContexts(actorContexts) {
  ensureDb();
  const contexts = Array.isArray(actorContexts) ? actorContexts : [];
  const nonAdmins = contexts.filter(context => context && context.actorType !== 'admin');
  if (!nonAdmins.length) return contexts.map(context => resolveEffectiveTaskScopeFromGrants(context, [], null, []));
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
    if (context.actorType === 'admin') return resolveEffectiveTaskScopeFromGrants(context, [], null, []);
    const assignment = selectCurrentAssignment(assignmentRows, context, nowIso);
    const effectiveActor = applyTaskPresetToActorContext(context, assignment && assignment.preset_code || 'NHAN_VIEN', orgRows);
    const grants = activeGrants.filter(grant => code(grant.grantee_employee_code) === code(context.employeeCode));
    return resolveEffectiveTaskScopeFromGrants(effectiveActor, grants, assignment, orgRows);
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

const RELATION_VIEW_ALLOWED = new Set(['creator', 'primary', 'related']);
// manager_of_primary chỉ là RELATION (từ employee_profiles.manager_employee_code),
// KHÔNG tự cấp quyền xem — actor phải có Task authority quản lý phù hợp
// (TBP/Trưởng ca/GĐ/TL GĐ/Admin) mới được hưởng quyền manager-view (Phase 1.5,
// đóng gap: NHÂN VIÊN thường không được auto-view chỉ vì trùng manager_employee_code).
const MANAGER_VIEW_ACTOR_TYPES = new Set(['truong_bo_phan', 'truong_ca', 'giam_doc', 'tro_ly_gd']);

async function canViewTask(session, task, assignees) {
  const { actorContext, scope } = await resolveEffectiveTaskScope(session);
  if (actorContext.actorType === 'admin') return true;
  const relation = await classifyTaskRelation(actorContext, task, assignees);
  if (RELATION_VIEW_ALLOWED.has(relation)) return true;
  if (relation === 'manager_of_primary' && MANAGER_VIEW_ACTOR_TYPES.has(actorContext.actorType) && scope.capabilities.view) return true;
  if (!scope.capabilities.view) return false;
  const activePrimary = (assignees || []).find(assignee => assignee.role === 'primary' && assignee.isActive);
  if (!activePrimary) return false;
  const rows = await loadOrgRows();
  const primarySubject = findByCode(rows, activePrimary.employeeCode) || { employeeCode: code(activePrimary.employeeCode) };
  return subjectMatchesTaskScope(primarySubject, scope.peopleScope);
}

/*
 * INTERVENTION AUTHORITY — LOCKED AUTHORITY RULE (2026-08-28).
 * ---------------------------------------------------------------------------
 * CAPABILITY != PEOPLE_SCOPE != TASK_RELATIONSHIP.
 *
 * Lifecycle intervention on a Task the actor did NOT create (reopen / cancel /
 * change deadline / transfer primary / add-remove related) may ONLY be
 * authorised by ONE of:
 *   1. system ADMIN;
 *   2. company-wide executive authority — GIAM_DOC / TRO_LY_GD;
 *   3. TASK RELATIONSHIP — the actor is this Task's own current active primary;
 *   4. an EXPLICIT exception grant (extend / delegation) that widens the
 *      actor's people scope BEYOND their base preset scope to include this
 *      primary.
 *
 * A TRUONG_BO_PHAN / TRUONG_CA who can see the Task ONLY because its primary
 * sits in their managed tree gets VIEW + COMMENT (follow) — NEVER intervention.
 * The managed relationship alone confers no lifecycle authority. That is why
 * branch (4) compares the primary against the BASE preset scope: a match that
 * exists only in the base managed/self scope is explicitly rejected; only a
 * match that an exception grant added on top counts.
 *
 * Creators are authorised at the call site (actorOwnsTask) before this runs.
 *
 * resolveUpdateAuthorityBasis() returns the winning basis string (or null);
 * canUpdateTask() is the boolean view of the same decision. task-core.js's
 * resolveAndAuthorizeUpdateCapability() stamps the basis onto actorContext so
 * the write-bridge can forward it to phf-hr-api as a defence-in-depth marker
 * (services/phf-hr-api/lib/task-write.js — same rule, enforced once here).
 */
const INTERVENTION_EXECUTIVE_ACTOR_TYPES = Object.freeze(new Set(['giam_doc', 'tro_ly_gd']));
const TASK_INTERVENTION_BASES = Object.freeze(new Set(['system_admin', 'executive_authority', 'active_primary', 'exception_grant', 'creator']));

async function resolveUpdateAuthorityBasis(session, task, assignees) {
  const { actorContext, scope, authorityPeopleScope } = await resolveEffectiveTaskScope(session);
  if (actorContext.actorType === 'admin') return 'system_admin';
  if (!scope.capabilities.update) return null;

  const activePrimary = (assignees || []).find(assignee => assignee.role === 'primary' && assignee.isActive);
  if (!activePrimary) return null;
  const primaryCode = code(activePrimary.employeeCode);

  // (3) TASK RELATIONSHIP — current primary acting on their own Task.
  if (actorContext.employeeCode && primaryCode === code(actorContext.employeeCode)) return 'active_primary';

  const rows = await loadOrgRows();
  const primarySubject = findByCode(rows, activePrimary.employeeCode) || { employeeCode: primaryCode };

  // (2) company-wide executive authority (ADMIN already handled above).
  if (INTERVENTION_EXECUTIVE_ACTOR_TYPES.has(actorContext.actorType)) {
    return subjectMatchesTaskScope(primarySubject, authorityPeopleScope || scope.peopleScope) ? 'executive_authority' : null;
  }

  // (4) explicit exception grant beyond base scope. Base (managed-tree / self)
  // membership is NOT sufficient — that is the M1 defect this rule closes.
  const baseScope = resolveBaseTaskScope(actorContext);
  const inBaseScope = subjectMatchesTaskScope(primarySubject, baseScope.peopleScope);
  // WHO vs WHAT — compare against the AUTHORITY people scope, not the
  // visibility peopleScope. A department/branch VISIBILITY grant widens who
  // the actor can SEE/cover but must not, on its own, confer lifecycle
  // intervention authority (MODULE-LEVEL DEPARTMENT SCOPE V1 authority-leak
  // fix). Explicit employee / all_company exception grants still match here
  // unchanged — they feed authorityPeopleScope.
  const inAuthorityScope = subjectMatchesTaskScope(primarySubject, authorityPeopleScope || scope.peopleScope);
  if (inAuthorityScope && !inBaseScope) return 'exception_grant';

  return null;
}

async function canUpdateTask(session, task, assignees) {
  return !!(await resolveUpdateAuthorityBasis(session, task, assignees));
}

// CANCEL POLICY V1 (2026-08-31) — a basis that authorises a DIRECT
// "Hủy công việc". Same architecture as resolveUpdateAuthorityBasis, MINUS the
// "current active primary acting on their own Task" shortcut: an active primary
// (or a proposer) is never a direct canceller unless they SEPARATELY hold an
// authorised management basis (system_admin / executive_authority /
// exception_grant). The creator/assigner is handled by the caller's
// actorOwnsTask shortcut (basis 'creator'). A plain active primary must use
// the "Yêu cầu hủy" request flow instead.
async function resolveDirectCancelAuthorityBasis(session, task, assignees) {
  const { actorContext, scope, authorityPeopleScope } = await resolveEffectiveTaskScope(session);
  if (actorContext.actorType === 'admin') return 'system_admin';
  if (!scope.capabilities.update) return null;

  const activePrimary = (assignees || []).find(assignee => assignee.role === 'primary' && assignee.isActive);
  if (!activePrimary) return null;
  const primaryCode = code(activePrimary.employeeCode);

  // (NOTE) deliberately NO "primaryCode === actorContext.employeeCode -> allow"
  // branch here — that is exactly the case Cancel Policy V1 routes to the
  // request flow. Fall through to the management-authority checks, which DO
  // still apply even when the actor happens to also be the active primary.
  const rows = await loadOrgRows();
  const primarySubject = findByCode(rows, activePrimary.employeeCode) || { employeeCode: primaryCode };

  if (INTERVENTION_EXECUTIVE_ACTOR_TYPES.has(actorContext.actorType)) {
    return subjectMatchesTaskScope(primarySubject, authorityPeopleScope || scope.peopleScope) ? 'executive_authority' : null;
  }

  const baseScope = resolveBaseTaskScope(actorContext);
  const inBaseScope = subjectMatchesTaskScope(primarySubject, baseScope.peopleScope);
  // WHO vs WHAT — compare against the AUTHORITY people scope, not the
  // visibility peopleScope. A department/branch VISIBILITY grant widens who
  // the actor can SEE/cover but must not, on its own, confer lifecycle
  // intervention authority (MODULE-LEVEL DEPARTMENT SCOPE V1 authority-leak
  // fix). Explicit employee / all_company exception grants still match here
  // unchanged — they feed authorityPeopleScope.
  const inAuthorityScope = subjectMatchesTaskScope(primarySubject, authorityPeopleScope || scope.peopleScope);
  if (inAuthorityScope && !inBaseScope) return 'exception_grant';

  return null;
}

/*
 * FILE ATTACHMENT V1 (2026-08-31) — canonical attachment authority resolvers.
 * Deliberately NOT a new role model: they delegate to the exact same
 * resolveUpdateAuthorityBasis / resolveDirectCancelAuthorityBasis decisions
 * already used for lifecycle edit and direct-cancel, so UI flags and backend
 * enforcement can never diverge.
 *
 *   UPLOAD  = creator/assigner  OR  current active primary  OR  authorised
 *             management basis (system_admin / executive_authority /
 *             exception_grant).  == resolveUpdateAuthorityBasis (+ creator
 *             shortcut handled by the caller via classifyTaskRelation).
 *
 *   MANAGE  (remove someone else's attachment) = creator/assigner OR authorised
 *             management basis ONLY — a bare active primary is NOT enough (they
 *             may still remove their OWN upload; that per-row check is done at
 *             the call site against uploaded_by_employee_code). == the
 *             direct-cancel basis set.
 *
 * `task` here is the SAME { createdByAccountId, createdByEmployeeCode } +
 * relation-assignees shape the two delegates already expect.
 */
async function resolveAttachmentUploadAuthorityBasis(session, task, assignees) {
  return resolveUpdateAuthorityBasis(session, task, assignees);
}

async function resolveAttachmentManageAuthorityBasis(session, task, assignees) {
  return resolveDirectCancelAuthorityBasis(session, task, assignees);
}

function toViewerAssignees(rows) {
  return (rows || []).map(r => ({
    employeeCode: code(r && (r.employeeCode !== undefined ? r.employeeCode : r.employee_code)),
    role: text(r && r.role),
    isActive: (r && (r.isActive !== undefined ? r.isActive : r.is_active)) === true
  }));
}

/*
 * resolveTaskViewerAuthority — backend-computed explicit per-action
 * capabilities for the Task detail DTO. The frontend gates buttons on this
 * instead of guessing from Hub role. Every flag mirrors exactly the
 * server-side gate that would run if the action were attempted:
 *   - update_progress / complete   -> current active primary only
 *   - cancel / change_deadline / transfer_primary / add_related /
 *     remove_related / reopen      -> creator OR resolveUpdateAuthorityBasis()
 *   - comment                      -> any viewer (managed follow included, G4)
 *   - delete_draft                 -> creator only
 * managed_view_only == true is the read-only "đang theo dõi" mode: viewer is
 * manager_of_primary with no intervention authority.
 */
async function resolveTaskViewerAuthority(session, taskRow, assigneeRows) {
  const { actorContext } = await resolveEffectiveTaskScope(session);
  const relationTask = {
    createdByAccountId: text(taskRow && (taskRow.created_by_account_id !== undefined ? taskRow.created_by_account_id : taskRow.createdByAccountId)),
    createdByEmployeeCode: code(taskRow && (taskRow.created_by_employee_code !== undefined ? taskRow.created_by_employee_code : taskRow.createdByEmployeeCode))
  };
  const assignees = toViewerAssignees(assigneeRows);
  const status = text(taskRow && taskRow.status);
  const activeStatus = status === 'published' || status === 'in_progress';

  const isAdmin = actorContext.actorType === 'admin';
  const relation = isAdmin ? 'admin' : await classifyTaskRelation(actorContext, relationTask, assignees);
  const isCreator = relation === 'creator';
  const activePrimary = assignees.find(a => a.role === 'primary' && a.isActive);
  const isActivePrimary = !!(activePrimary && actorContext.employeeCode && activePrimary.employeeCode === code(actorContext.employeeCode));

  const canView = isAdmin ? true : await canViewTask(session, relationTask, assignees);
  const updateBasis = canView ? (isCreator ? 'creator' : await resolveUpdateAuthorityBasis(session, relationTask, assignees)) : null;
  const canUpdate = !!updateBasis;

  // CANCEL POLICY V1 — DIRECT cancel = creator OR an authorised management
  // basis (system_admin / executive_authority / exception_grant). A plain
  // active primary is excluded and gets the request flow instead.
  const directCancelBasis = canView
    ? (isCreator ? 'creator' : await resolveDirectCancelAuthorityBasis(session, relationTask, assignees))
    : null;
  const canDirectCancel = !!directCancelBasis;
  const canRequestCancel = isActivePrimary && !canDirectCancel;

  // FILE ATTACHMENT V1 — upload authority is exactly the lifecycle-edit
  // authority (creator / active primary / management); manage-other authority
  // is exactly the direct-cancel basis set (creator / management, NOT a bare
  // active primary). Same resolvers, no divergence from enforcement.
  const attachmentUploadBasis = updateBasis;      // 'creator' | 'active_primary' | 'system_admin' | 'executive_authority' | 'exception_grant' | null
  const attachmentManageBasis = directCancelBasis; // 'creator' | 'system_admin' | 'executive_authority' | 'exception_grant' | null
  const canUploadAttachment = !!attachmentUploadBasis && status !== 'draft' && status !== 'cancelled';

  return {
    relation,
    is_creator: isCreator,
    is_active_primary: isActivePrimary,
    is_related: relation === 'related',
    managed_view_only: relation === 'manager_of_primary' && !canUpdate,
    intervention_basis: updateBasis || null,
    direct_cancel_basis: directCancelBasis || null,
    attachment_upload_basis: attachmentUploadBasis || null,
    attachment_manage_basis: attachmentManageBasis || null,
    // the caller's own employee code — needed by assembleTaskDetailDto to set
    // per-row can_remove (uploader may always remove their own upload). Not
    // sensitive: it is the identity of the very actor receiving this DTO.
    actor_employee_code: actorContext.employeeCode || null,
    // the caller's own account id — parity with actor_employee_code, so
    // assembleTaskDetailDto can set can_remove for an account-only (Admin)
    // uploader removing their own upload.
    actor_account_id: actorContext.accountId || null,
    actions: {
      upload_attachment: canUploadAttachment,
      view: canView,
      comment: canView,
      update_progress: isActivePrimary && activeStatus,
      complete: isActivePrimary && activeStatus,
      cancel: canDirectCancel && activeStatus,
      request_cancel: canRequestCancel && activeStatus,
      review_cancel_request: canDirectCancel && activeStatus,
      change_deadline: canUpdate && status !== 'cancelled' && status !== 'draft',
      transfer_primary: canUpdate && activeStatus,
      add_related: canUpdate && activeStatus,
      remove_related: canUpdate && activeStatus,
      reopen: canUpdate && status === 'completed',
      edit_draft: (isCreator || canUpdate) && status === 'draft',
      delete_draft: isCreator && status === 'draft'
    }
  };
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
  return subjectMatchesTaskScope(targetSubject, scope.assignScope || scope.peopleScope);
}

/*
 * canAddTaskRelated — Related business rule nay đã CHỐT (Tạo phiếu V1 mục
 * 4): Người liên quan = CC. Được chọn NHIỀU người, bất kỳ nhân sự ACTIVE
 * toàn công ty — không giới hạn theo peopleScope/assignScope của actor.
 * Đây là quyết định business rõ ràng (thay thế conservative HOLD trước đó ở
 * Phase 1.5), vì CC chỉ mang tính thông báo/theo dõi — KHÔNG chịu trách
 * nhiệm chính, KHÔNG tính trễ/KPI, KHÔNG được xem như đồng Primary, KHÔNG
 * được hoàn thành thay người chính (enforce ở completeTask/updateTaskProgress
 * — chỉ primary hiện hành mới gọi được, related không có quyền này dù có
 * capability update). Actor vẫn phải là active employee hoặc Admin, và vẫn
 * phải có quyền cập nhật Task đó (creator hoặc capability update qua
 * requireUpdateAuthority ở call site) trước khi được thêm CC — hàm này chỉ
 * xác định TARGET có hợp lệ để làm CC hay không, không tự cấp quyền sửa Task.
 */
async function canAddTaskRelated(session, targetEmployeeCode) {
  const { actorContext } = await resolveEffectiveTaskScope(session);
  if (actorContext.actorType !== 'admin' && !isActiveEmployee(actorContext)) return false;
  const rows = await loadOrgRows();
  const targetSubject = findByCode(rows, targetEmployeeCode);
  if (!targetSubject || !isActiveEmployee(targetSubject)) return false;
  return true;
}

// Chỉ dùng để phát hiện "giao ngang cấp" (Tạo phiếu V1 mục 9) — map rẻ
// employeeCode -> actorType hiện hành, KHÔNG resolve grant/scope đầy đủ như
// resolveEffectiveTaskScopesForActorContexts (không cần cho việc này, tránh
// N query không cần thiết trên danh sách assignable có thể dài).
async function loadActiveActorTypesByEmployee() {
  ensureDb();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase.from(ASSIGNMENTS_TABLE).select('employee_code,preset_code').eq('is_active', true).lte('effective_from', nowIso);
  if (error) throwDb(error, ASSIGNMENTS_TABLE);
  const map = new Map();
  (data || []).forEach(row => {
    const actorType = TASK_PRESET_TO_ACTOR_TYPE[code(row.preset_code)];
    if (actorType) map.set(code(row.employee_code), actorType);
  });
  return map;
}

async function listTaskAssignableEmployees(session) {
  const { actorContext, scope } = await resolveEffectiveTaskScope(session);
  if (actorContext.actorType !== 'admin' && !isActiveEmployee(actorContext)) return { employees: [], requesterActorType: actorContext.actorType };
  const assignScope = scope.assignScope || scope.peopleScope;
  const [rows, actorTypeByEmployee] = await Promise.all([loadOrgRows(), loadActiveActorTypesByEmployee()]);
  const employees = rows.filter(subject => {
    if (!subject.employeeCode || !isActiveEmployee(subject)) return false;
    if (actorContext.actorType === 'admin') return true;
    if (subject.employeeCode === actorContext.employeeCode) return true;
    return !!scope.capabilities.assign && subjectMatchesTaskScope(subject, assignScope);
  }).map(subject => ({
    employeeCode: subject.employeeCode,
    fullName: subject.fullName,
    department: subject.department,
    title: subject.title,
    position: subject.position,
    branch: subject.branch,
    managerEmployeeCode: subject.managerCode,
    employmentStatus: 'active',
    taskActorType: actorTypeByEmployee.get(subject.employeeCode) || 'nhan_vien'
  })).sort((left, right) => left.fullName.localeCompare(right.fullName, 'vi'));
  return { employees, requesterActorType: actorContext.actorType };
}

// ---------------------------------------------------------------------------
// PROPOSAL V2 (2026-08-29, FIX theo Business Owner correction) —
// resolveProposalRecipientEmployeeCodes(): recipient population = "bất kỳ
// active employee nào có EFFECTIVE quyền Giao việc theo Permission Contract
// V1 hiện hành" — KHÔNG hard-code theo 4 preset cố định (bản trước SAI vì bỏ
// qua exception grant restrict/extend + bỏ sót Admin không giữ preset nào).
// Đây vẫn là permission gate HOÀN TOÀN RIÊNG (KHÔNG reuse assignScope của
// actor đang GỌI — population chỉ phụ thuộc effective scope của TARGET).
//
// "Effective quyền Giao việc" = scope.capabilities.assign === true VÀ
// scope.assignScope.type !== 'self' (tức có thể assign cho người KHÁC ngoài
// chính mình — assignScope không bao giờ bị grant nới rộng theo comment
// applyGrant() ở trên, "Grant V1 chỉ extend peopleScope... assignScope giữ
// nguyên theo base preset" — nên population thực chất = 4 preset TBP/
// Trưởng ca/GĐ/TLGĐ + Admin CÓ capabilities.assign=true, TRỪ KHI 1 restrict
// grant tắt capabilities.assign=false cho riêng người đó — đây chính là
// phần "EFFECTIVE" mà bản cũ bỏ sót). Employee (assignScope luôn 'self')
// KHÔNG BAO GIỜ lọt vào population này dù grant gì đi nữa.
//
// Cách xác định Admin: Admin KHÔNG có row trong task_permission_assignments
// (actorType='admin' xác định thuần qua account.role, xem task-employee-
// scope.js::resolveActorContext — employeeCode CHỈ tồn tại nếu account đó
// được liên kết với 1 hồ sơ People Master thật). Dùng lại ĐÚNG pattern
// listTaskAdminPeople() (api/_lib/task-core.js) đã có sẵn cho việc này: map
// account.employeeCode -> account.role qua listHubAccountSummaries()
// (user_accounts — Account/HR data, KHÔNG phải Task data), rồi
// resolveActorContextForRecord() cho từng active employee (admin nếu account
// role=admin, else placeholder 'nhan_vien' — preset THẬT được
// resolveEffectiveTaskScopesForActorContexts() tự tra lại từ
// task_permission_assignments bên trong, applyTaskPresetToActorContext() bỏ
// qua actorType='admin' — Admin KHÔNG bị ghi đè bởi preset).
// ---------------------------------------------------------------------------
async function resolveProposalRecipientEmployeeCodes() {
  const [orgRows, accounts] = await Promise.all([loadOrgRows(), listHubAccountSummaries()]);
  const accountByEmployee = new Map();
  (accounts || []).forEach(account => {
    const employeeCode = code(account && account.employeeCode);
    if (employeeCode && !accountByEmployee.has(employeeCode)) accountByEmployee.set(employeeCode, account);
  });

  const activeRows = orgRows.filter(isActiveEmployee);
  const actorContexts = activeRows.map(person => {
    const account = accountByEmployee.get(code(person.employeeCode));
    return resolveActorContextForRecord(
      { account: { id: account ? account.id : '', role: account ? account.role : '' } },
      person,
      orgRows
    );
  });

  let effectiveRows;
  try {
    effectiveRows = await resolveEffectiveTaskScopesForActorContexts(actorContexts);
  } catch (error) {
    // Fail-closed: nếu schema permission chưa sẵn sàng (TASK_SCHEMA_MISSING),
    // population rỗng thay vì throw ra ngoài — picker/canProposeTo() tự xử
    // lý "không có ai" đúng nghĩa, không phải lỗi 500 cho 1 tính năng phụ
    // (recipient discovery), giữ nguyên hành vi fail-closed đã có ở
    // listTaskAssignableEmployees()/canAssignTaskTo() khi actor không active.
    if (error && error.code === 'TASK_SCHEMA_MISSING') return new Set();
    throw error;
  }

  const codes = new Set();
  effectiveRows.forEach(effective => {
    const actorContext = effective && effective.actorContext;
    const scope = effective && effective.scope;
    if (!actorContext || !actorContext.employeeCode || !scope) return;
    const assignScopeType = scope.assignScope && scope.assignScope.type;
    const hasEffectiveAssign = scope.capabilities && scope.capabilities.assign === true && assignScopeType && assignScopeType !== 'self';
    if (hasEffectiveAssign) codes.add(code(actorContext.employeeCode));
  });
  return codes;
}

// listProposalRecipientEmployees — population cho recipient picker. Loại bỏ
// chính actor (không tự đề xuất cho chính mình — CHECK
// task_proposal_decisions_recipient_not_creator_ck ở DB backstop lại lần
// nữa, xem migrations/phf_hr_task_proposal_v2.sql).
async function listProposalRecipientEmployees(session) {
  const { actorContext } = await resolveEffectiveTaskScope(session);
  if (actorContext.actorType !== 'admin' && !isActiveEmployee(actorContext)) {
    return { employees: [], requesterActorType: actorContext.actorType };
  }
  const [rows, validCodes] = await Promise.all([loadOrgRows(), resolveProposalRecipientEmployeeCodes()]);
  const selfCode = code(actorContext.employeeCode);
  const employees = rows.filter(subject => {
    if (!subject.employeeCode || !isActiveEmployee(subject)) return false;
    if (code(subject.employeeCode) === selfCode) return false;
    return validCodes.has(code(subject.employeeCode));
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
  return { employees, requesterActorType: actorContext.actorType };
}

// canProposeTo — server-side re-validate (KHÔNG tin picker phía client), gọi
// TRƯỚC khi publishTask(flow_type='de_xuat') ở write bridge. Tương đương vai
// trò canAssignTaskTo() cho Giao việc, nhưng population hoàn toàn khác
// (không dùng assignScope của actor).
async function canProposeTo(session, targetEmployeeCode) {
  const { actorContext } = await resolveEffectiveTaskScope(session);
  if (actorContext.actorType !== 'admin' && !isActiveEmployee(actorContext)) return false;
  if (code(targetEmployeeCode) === code(actorContext.employeeCode)) return false;
  const rows = await loadOrgRows();
  const targetSubject = findByCode(rows, targetEmployeeCode);
  if (!targetSubject || !isActiveEmployee(targetSubject)) return false;
  const validCodes = await resolveProposalRecipientEmployeeCodes();
  return validCodes.has(code(targetEmployeeCode));
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
  scopeToEmployeeSet,
  intersectPeopleScope,
  resolveEffectiveTaskScopeFromGrants,
  resolveEffectiveTaskScopeForActorContext,
  resolveEffectiveTaskScopesForActorContexts,
  resolveEffectiveTaskScope,
  requireTaskCapability,
  classifyTaskRelation,
  canViewTask,
  canUpdateTask,
  resolveUpdateAuthorityBasis,
  resolveDirectCancelAuthorityBasis,
  resolveAttachmentUploadAuthorityBasis,
  resolveAttachmentManageAuthorityBasis,
  resolveTaskViewerAuthority,
  TASK_INTERVENTION_BASES,
  canAssignTaskTo,
  canAddTaskRelated,
  listTaskAssignableEmployees,
  resolveProposalRecipientEmployeeCodes,
  listProposalRecipientEmployees,
  canProposeTo
};
