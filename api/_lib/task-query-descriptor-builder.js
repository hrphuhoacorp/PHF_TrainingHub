'use strict';

/*
 * PHF Task — RESOLVED_TASK_QUERY_DESCRIPTOR_V1 builder + signer.
 *
 * LOCAL ONLY prototype — CHƯA wire vào task-read-bridge.js/api/data.js nào.
 * Implement đúng schema đã khoá ở vòng thiết kế "PERMISSION PARITY MATRIX"
 * trước đó (mục 9 — Descriptor Design), KHÔNG tự phát minh field mới.
 *
 * KHÔNG sửa task-core.js/task-permissions.js/task-employee-scope.js — chỉ
 * REUSE resolveEffectiveTaskScope() nguyên vẹn để lấy peopleScope đã resolve
 * xong (đây là "main app tính xong quyền" theo đúng kiến trúc đã chốt), rồi
 * áp lại ĐÚNG branching logic mà resolveAuthorizedTaskScope()
 * (task-core.js:1556) dùng để chọn mode/creatorEmployeeCode/
 * assigneeEmployeeCodes. Phần branching này không được export riêng từ
 * task-core.js nên phải duplicate tối thiểu ở đây — rủi ro lệch đồng bộ nếu
 * task-core.js đổi đã được ghi nhận công khai từ vòng thiết kế trước.
 *
 * ĐÃ SỬA (2026-08-27): nhánh `peopleScope.type === 'employees'` từng thiếu
 * điều kiện `!scopeParam` (mặc định tab "Tôi nhận" không truyền scope) trong
 * check `scopeParam === 'mine'`, khiến scopeParam rỗng rơi vào nhánh else
 * (self+managed, over-broad) thay vì self-only — đúng bug self+managed đã
 * fix ở task-core.js commit 31a6c5b nhưng chưa từng áp lại ở đây. Nay khớp
 * 100% với task-core.js::resolveAuthorizedTaskScope() — xem
 * scripts/test-task-query-descriptor-builder-scope-fix.js cho regression.
 */

const crypto = require('crypto');
const { resolveEffectiveTaskScope } = require('./task-permissions');

const TASK_LIST_RELATIONS = new Set(['received', 'assigned', 'proposal_sent', 'proposal_received']);
const TASK_LIST_STATUS_FILTERS = new Set(['all', 'in_progress', 'overdue', 'completed']);
const TASK_LIST_SCOPES = new Set(['mine', 'managed', 'cross_department', 'all_company']);
const DESCRIPTOR_TTL_MS = 15000;
// COMPANY-LEVEL PERMISSION CLEANUP (2026-08-28) — khớp 100% với
// task-core.js::COMPANY_TIER_ACTOR_TYPES (xem comment gốc ở đó).
const COMPANY_TIER_ACTOR_TYPES = new Set(['admin', 'giam_doc', 'tro_ly_gd']);

function text(v) { return String(v == null ? '' : v).trim(); }

function invalid(message, code, statusCode) {
  const err = new Error(message);
  err.code = code;
  // Client input errors must surface as 4xx, not a generic 500 — the dispatch
  // catch site defaults to INTERNAL_ERROR when statusCode is absent. Mirrors
  // task-core.js::listTasks()'s fail('...', 400, ...).
  err.statusCode = statusCode || 400;
  throw err;
}

// 'managed' is a UI-level relation alias for the "Nhân sự tôi quản lý" view.
// The backend contract only knows received/assigned/proposal_* ; the managed
// workspace is (relation='received', scope='managed'). Resolve the alias to
// that canonical pair BEFORE validation — identical authorization, no new
// relation type, no manager-graph change. Keeps the API symmetric with the
// frontend, which carries 'managed' as list.relation.
function normalizeRelationScope(rawRelation, rawScope) {
  let relation = text(rawRelation);
  let scope = text(rawScope);
  if (relation === 'managed') {
    relation = 'received';
    if (!scope) scope = 'managed';
  }
  return { relation, scope };
}

function canonicalSortedJson(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/*
 * buildResolvedTaskQueryDescriptor(session, params, { signingSecret })
 * → { ...descriptor fields, signature }
 *
 * Descriptor mang KẾT QUẢ ĐÃ RESOLVE (employeeCodes cụ thể hoặc null=không
 * giới hạn theo đúng điều kiện actorType) — KHÔNG mang actorType/role để
 * phf-hr-api tự diễn giải (anti-expansion invariant đã chốt).
 */
async function buildResolvedTaskQueryDescriptor(session, params, options) {
  const signingSecret = options && options.signingSecret;
  if (!signingSecret) invalid('signingSecret bắt buộc để ký descriptor.', 'DESCRIPTOR_SIGNING_SECRET_REQUIRED');

  const { actorContext, scope } = await resolveEffectiveTaskScope(session);
  const input = params || {};

  const { relation, scope: scopeInput } = normalizeRelationScope(input.relation, input.scope);
  if (!TASK_LIST_RELATIONS.has(relation)) invalid('Góc nhìn (relation) không hợp lệ.', 'TASK_LIST_RELATION_INVALID');
  const statusFilter = TASK_LIST_STATUS_FILTERS.has(text(input.statusFilter)) ? text(input.statusFilter) : 'all';
  const scopeParam = TASK_LIST_SCOPES.has(scopeInput) ? scopeInput : '';
  const search = text(input.search).slice(0, 100);
  const limit = Math.min(200, Math.max(1, Number(input.limit) || 50));
  const offset = Math.min(5000, Math.max(0, Math.trunc(Number(input.offset)) || 0));

  const isReceivedLike = relation === 'received' || relation === 'proposal_received';
  const flowType = (relation === 'proposal_sent' || relation === 'proposal_received') ? 'de_xuat' : 'giao_viec';

  let mode;
  let creatorEmployeeCode = null;
  let creatorAccountId = null;
  let assigneeEmployeeCodes = null;

  if (isReceivedLike) {
    mode = 'assignee_in';
    if (relation === 'proposal_received') {
      assigneeEmployeeCodes = [actorContext.employeeCode];
    } else if (scopeParam === 'managed' || scopeParam === 'cross_department') {
      if (COMPANY_TIER_ACTOR_TYPES.has(actorContext.actorType)) {
        // COMPANY-LEVEL CLEANUP (2026-08-28) — Admin/GĐ/TLGĐ "Nhân sự tôi
        // quản lý" = company-wide (null), khớp 100% với task-core.js —
        // KHÔNG bó vào managedEmployeeCodes/org-graph subtree.
        assigneeEmployeeCodes = null;
      } else {
        // TBP/Trưởng ca — LUÔN managedEmployeeCodes thật (org graph), khớp
        // 100% với task-core.js::resolveAuthorizedTaskScope()
        // (taskRelationshipOnly:true).
        assigneeEmployeeCodes = Array.from(actorContext.managedEmployeeCodes || []);
      }
    } else if (scopeParam === 'mine' || !scopeParam) {
      // "Tôi nhận" mặc định — LUÔN self-only bất kể peopleScope.type (self/
      // employees/all_company) — G3 root cause: executive all_company
      // capability KHÔNG được leak vào quan hệ Task cá nhân "Tôi nhận".
      assigneeEmployeeCodes = [actorContext.employeeCode];
    } else if (scopeParam === 'all_company' && COMPANY_TIER_ACTOR_TYPES.has(actorContext.actorType)) {
      assigneeEmployeeCodes = null;
    } else if (scope.peopleScope.type === 'employees') {
      // Khớp đúng branching đã fix ở task-core.js::resolveAuthorizedTaskScope()
      // (commit 31a6c5b, P0 "Tôi nhận" self-only fix) — scopeParam rỗng (mặc
      // định tab "Tôi nhận", không truyền scope) PHẢI rơi vào self-only, không
      // rơi vào nhánh else (self+managed, over-broad). Đây chính là bug đã ghi
      // nhận trong comment đầu file — nay đồng bộ lại, không còn 2 bản lệch nhau.
      assigneeEmployeeCodes = (scope.peopleScope.values && scope.peopleScope.values.length) ? scope.peopleScope.values.slice() : [actorContext.employeeCode];
    } else {
      assigneeEmployeeCodes = [actorContext.employeeCode];
    }
  } else {
    mode = 'creator_eq';
    // Exact creator identity of THIS actor. An actor with a real employee
    // profile is matched by employee_code; an account-only actor (Admin with no
    // employee identity, actorContext.employeeCode = '') is matched by
    // account_id. Both are carried so the executor picks whichever identity the
    // actor actually has — never a wildcard, and Admin A can never match Admin
    // B (account ids are unique per account).
    creatorEmployeeCode = actorContext.employeeCode || '';
    creatorAccountId = actorContext.accountId || null;
  }

  const now = Date.now();
  const ttlMs = Number.isFinite(options && options.ttlMs) ? options.ttlMs : DESCRIPTOR_TTL_MS;
  const descriptor = {
    requesterEmployeeCode: actorContext.employeeCode || '',
    requesterActorType: actorContext.actorType,
    mode,
    creatorEmployeeCode,
    creatorAccountId,
    assigneeEmployeeCodes,
    flowType,
    requirePrimaryRoleActive: true,
    excludeDraft: isReceivedLike,
    crossDepartmentOnly: scopeParam === 'cross_department',
    statusFilter,
    search,
    offset,
    limit,
    relation,
    scope: scopeParam || 'default',
    viewScopeType: scope.peopleScope.type,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    nonce: crypto.randomBytes(16).toString('hex'),
  };

  const signature = crypto.createHmac('sha256', signingSecret).update(canonicalSortedJson(descriptor)).digest('hex');

  // hasManagedPeople/canManageTaskPermissions (2026-08-29) — UI capability
  // signals, computed the SAME way as task-core.js::listTasks() (mục "G3
  // FOLLOW-UP + COMPANY-LEVEL CLEANUP", cùng actorContext/scope đã resolve ở
  // trên). KHÔNG phải một phần của query descriptor (không ảnh hưởng SQL nào
  // phf-hr-api chạy) nên KHÔNG đưa vào phần được ký/gửi qua mạng — chỉ để
  // task-read-bridge.js đọc cục bộ rồi tự tách ra trước khi POST. Trước bản
  // sửa này 2 field bị thiếu hoàn toàn ở nhánh bridge (bridgeListTasks()
  // không set), khiến frontend (result.hasManagedPeople===true) luôn false
  // cho MỌI actorType kể cả admin — menu "Nhân sự tôi quản lý" bị ẩn sai.
  const hasManagedPeople = COMPANY_TIER_ACTOR_TYPES.has(actorContext.actorType)
    || !!(actorContext.managedEmployeeCodes && actorContext.managedEmployeeCodes.size > 0);
  const canManageTaskPermissions = scope.capabilities.manage === true;

  return Object.assign({}, descriptor, { signature, hasManagedPeople, canManageTaskPermissions });
}

module.exports = { buildResolvedTaskQueryDescriptor, canonicalSortedJson };
