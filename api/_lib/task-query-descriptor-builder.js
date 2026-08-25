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
 * áp lại ĐÚNG branching logic mà listTasks() (task-core.js:1440-1520) dùng
 * để chọn mode/creatorEmployeeCode/assigneeEmployeeCodes. Phần branching này
 * không được export riêng từ task-core.js nên phải duplicate tối thiểu ở
 * đây — rủi ro lệch đồng bộ nếu task-core.js đổi đã được ghi nhận công khai
 * từ vòng thiết kế trước, không phải phát hiện mới ở đây.
 */

const crypto = require('crypto');
const { resolveEffectiveTaskScope } = require('./task-permissions');

const TASK_LIST_RELATIONS = new Set(['received', 'assigned', 'proposal_sent', 'proposal_received']);
const TASK_LIST_STATUS_FILTERS = new Set(['all', 'in_progress', 'overdue', 'completed']);
const TASK_LIST_SCOPES = new Set(['mine', 'managed', 'cross_department', 'all_company']);
const DESCRIPTOR_TTL_MS = 15000;

function text(v) { return String(v == null ? '' : v).trim(); }

function invalid(message, code) {
  const err = new Error(message);
  err.code = code;
  throw err;
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

  const relation = text(input.relation);
  if (!TASK_LIST_RELATIONS.has(relation)) invalid('Góc nhìn (relation) không hợp lệ.', 'TASK_LIST_RELATION_INVALID');
  const statusFilter = TASK_LIST_STATUS_FILTERS.has(text(input.statusFilter)) ? text(input.statusFilter) : 'all';
  const scopeParam = TASK_LIST_SCOPES.has(text(input.scope)) ? text(input.scope) : '';
  const search = text(input.search).slice(0, 100);
  const limit = Math.min(200, Math.max(1, Number(input.limit) || 50));
  const offset = Math.min(5000, Math.max(0, Math.trunc(Number(input.offset)) || 0));

  const isReceivedLike = relation === 'received' || relation === 'proposal_received';
  const flowType = (relation === 'proposal_sent' || relation === 'proposal_received') ? 'de_xuat' : 'giao_viec';

  let mode;
  let creatorEmployeeCode = null;
  let assigneeEmployeeCodes = null;

  if (isReceivedLike) {
    mode = 'assignee_in';
    if (relation === 'proposal_received') {
      assigneeEmployeeCodes = [actorContext.employeeCode];
    } else if (scope.peopleScope.type === 'all_company') {
      assigneeEmployeeCodes = (scopeParam === 'mine') ? [actorContext.employeeCode] : null;
    } else if (scope.peopleScope.type === 'employees') {
      const managed = Array.from(actorContext.managedEmployeeCodes || []);
      if (scopeParam === 'mine') assigneeEmployeeCodes = [actorContext.employeeCode];
      else if (scopeParam === 'managed' || scopeParam === 'cross_department') assigneeEmployeeCodes = managed;
      else assigneeEmployeeCodes = (scope.peopleScope.values && scope.peopleScope.values.length) ? scope.peopleScope.values.slice() : [actorContext.employeeCode];
    } else {
      assigneeEmployeeCodes = [actorContext.employeeCode];
    }
  } else {
    mode = 'creator_eq';
    creatorEmployeeCode = actorContext.employeeCode;
  }

  const now = Date.now();
  const ttlMs = Number.isFinite(options && options.ttlMs) ? options.ttlMs : DESCRIPTOR_TTL_MS;
  const descriptor = {
    requesterEmployeeCode: actorContext.employeeCode || '',
    requesterActorType: actorContext.actorType,
    mode,
    creatorEmployeeCode,
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
  return Object.assign({}, descriptor, { signature });
}

module.exports = { buildResolvedTaskQueryDescriptor, canonicalSortedJson };
