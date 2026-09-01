'use strict';

/*
 * PHF Task — Reporting V2 (Tổng quan) — RESOLVED_TASK_OVERVIEW_QUERY_DESCRIPTOR_V1
 * builder + signer.
 *
 * ONE SOURCE OF AUTHORIZATION: reuses task-core.js::resolveAuthorizedTaskEmployeeScope()
 * — the PURE decision extraction (no Supabase side effect) of the SAME
 * branching listTasks() uses — NOT a 3rd duplicate of that branching (the
 * task-query-descriptor-builder.js copy already documents that risk; this
 * file avoids repeating it by calling the canonical function directly,
 * in-process, same Node runtime as task-core.js).
 *
 * BUSINESS DECISION LOCKED (2026-08-29, Tổng quan & Báo cáo V2): relation
 * "Tôi nhận" (population source for Overview) is ALWAYS relationship-only —
 * taskRelationshipOnly:true is HARD-CODED here, never parameterized by the
 * caller. Company-tier (Admin/GĐ/TLGĐ) company-wide view is expressed via
 * scope='managed' (already-existing, already-correct semantic — see
 * task-core.js COMPANY_TIER_ACTOR_TYPES branch), auto-selected below, NOT by
 * relaxing "Tôi nhận" itself.
 *
 * Scope auto-selection (no scope/relation/actor wording surfaces to UI,
 * per instruction 6): peopleScope.type==='self' (nhân_vien) -> 'mine'
 * (self-only, same result either way for a plain employee); anything else
 * (TBP/Trưởng ca 'employees', Admin/GĐ/TLGĐ 'all_company') -> 'managed'
 * (their full authorized management view). This mirrors exactly the
 * existing taskManagerScopeAvailable()/hasManagedPeople signal already
 * proven correct for the Task workspace nav.
 */

const crypto = require('crypto');
const { resolveEffectiveTaskScope } = require('./task-permissions');
const { resolveAuthorizedTaskEmployeeScope, deriveTaskNavAuthoritySignals } = require('./task-core');

const DESCRIPTOR_TTL_MS = 15000;

function canonicalSortedJson(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/*
 * buildResolvedTaskOverviewQueryDescriptor(session, { signingSecret })
 * -> { ...descriptor fields, signature, effectiveScope }
 *
 * effectiveScope ('self'|'managed') is returned alongside the signed
 * descriptor for the CALLER (bridge) to label the UI's "Phạm vi được phép
 * xem" in plain Vietnamese — it is NOT part of the signed/transmitted
 * payload (phf-hr-api does not need it to run the query).
 */
async function buildResolvedTaskOverviewQueryDescriptor(session, options) {
  const signingSecret = options && options.signingSecret;
  if (!signingSecret) {
    const err = new Error('signingSecret bắt buộc để ký descriptor Tổng quan.');
    err.code = 'DESCRIPTOR_SIGNING_SECRET_REQUIRED';
    err.statusCode = 400;
    throw err;
  }

  const { actorContext, scope } = await resolveEffectiveTaskScope(session);
  const effectiveScope = scope.peopleScope.type === 'self' ? 'self' : 'managed';
  // navSignals — local-only (like effectiveScope): reused by the Overview
  // bundle so the default landing route needs no separate managed-scope probe.
  // SAME pure derivation listTasks() uses (task-core.js) — cannot drift.
  const navSignals = deriveTaskNavAuthoritySignals(actorContext, scope);
  const scopeParam = effectiveScope === 'self' ? 'mine' : 'managed';

  const decision = resolveAuthorizedTaskEmployeeScope(actorContext, scope, 'received', scopeParam, { taskRelationshipOnly: true });
  // relation='received' is always received-like -> decision.mode is always
  // 'employee_codes' here (never 'creator_eq' — that branch is only hit for
  // relation !== received/proposal_received, which this builder never passes).
  //
  // LOCKED REPORT_SCOPE (PHF_TASK_HANDOVER_TO_NEW_CLAUDE_BEFORE_REPORT_04.md §4):
  // "TBP/Trưởng ca -> `employees` peopleScope (SELF + transitive managed subtree)".
  // resolveAuthorizedTaskEmployeeScope(scopeParam='managed') returns
  // managedEmployeeCodes ONLY (subtree, SELF dropped) — that is the correct
  // semantic for the Task LIST "Nhân sự tôi quản lý" tab (manager view, NOT
  // recipient) and MUST NOT change there. But Reporting V2 has no separate "Tôi
  // nhận" surface to carry the self portion, so it silently lost the actor's own
  // tasks. Union SELF back in for the 'employees' peopleScope by using the FULL
  // authorized scope.peopleScope.values — never wider than that. Nhân_viên
  // ('self' -> [self]) and Admin/GĐ/TLGĐ ('all_company' -> null) are unchanged.
  let employeeCodes = decision.employeeCodes;
  if (scope.peopleScope.type === 'employees') {
    const authorized = Array.isArray(scope.peopleScope.values) ? scope.peopleScope.values : [];
    employeeCodes = Array.from(new Set(authorized.filter(Boolean)));
  }

  const now = Date.now();
  const descriptor = {
    requesterEmployeeCode: actorContext.employeeCode || '',
    requesterActorType: actorContext.actorType,
    flowType: decision.flowType,
    employeeCodes, // null = company-wide, [] = empty population, [...] = bounded
    excludeDraft: decision.excludeDraft,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + DESCRIPTOR_TTL_MS).toISOString(),
    nonce: crypto.randomBytes(16).toString('hex'),
  };

  const signature = crypto.createHmac('sha256', signingSecret).update(canonicalSortedJson(descriptor)).digest('hex');
  return Object.assign({}, descriptor, { signature, effectiveScope, navSignals });
}

module.exports = { buildResolvedTaskOverviewQueryDescriptor, canonicalSortedJson };
