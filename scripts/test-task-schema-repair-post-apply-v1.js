'use strict';

/*
 * PHF Task — SCHEMA REPAIR POST-APPLY VERIFICATION — PREPARED FOR THE NEXT
 * GATE, DO NOT RUN YET.
 *
 * This script requires BOTH of the following to already be applied to the
 * dev Supabase schema:
 *   1. scripts/PHF_TASK_FOUNDATION_CORRECTION_REPAIR_1.74.0.sql
 *   2. scripts/PHF_TASK_PERMISSION_HARDENING_1.73.0.sql
 * (see PHF_TASK_SCHEMA_REPAIR_PRE_GO_LIVE_V1 gate report for the exact
 * SQL-Editor package and execution order). Running this BEFORE either is
 * applied will fail immediately at the first comment-insert / delete-draft
 * assertion — that failure is expected and not a regression, it just means
 * the SQL has not been pasted into the Supabase SQL Editor yet.
 *
 * Real dev DB, in-process, same methodology as
 * scripts/test-task-permission-hardening-v1.js. Creates a small number of
 * tagged [PERMISSION-HARDENING-TEST] / [SCHEMA-REPAIR-TEST] fixtures,
 * cleans up everything that CAN be cleaned, leaves only what LOCK 4 itself
 * forbids removing (a cancelled task). Does not touch the 37
 * [REPORT-UI-TEST] fixtures. Sequential, minimal traffic (Supabase NANO
 * guard).
 */

const assert = require('assert');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const core = require('../api/_lib/task-core');
const perms = require('../api/_lib/task-permissions');

let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }
function session(employeeCode) { return { account: { employeeCode } }; }
async function taskByCode(taskCode) { const { data, error } = await supabase.from('task_tasks').select('*').eq('task_code', taskCode).single(); if (error) throw error; return data; }
async function assigneesFor(taskId) { const { data } = await supabase.from('task_assignees').select('*').eq('task_id', taskId); return data || []; }
function relationTaskFrom(row) { return { createdByAccountId: row.created_by_account_id, createdByEmployeeCode: row.created_by_employee_code }; }
function toRelAssignees(rows) { return (rows || []).map(r => ({ employeeCode: r.employee_code, role: r.role, isActive: r.is_active })); }
function futureDeadline(hours) { return new Date(Date.now() + hours * 3600e3).toISOString(); }

(async () => {
  // =======================================================================
  // DELETE DRAFT — real RPC round-trip (this is what could NOT be tested
  // in the Permission Hardening gate — the RPC did not exist yet).
  // =======================================================================
  {
    const draft = await core.createTaskDraft(session('PHF010'), {
      flowType: 'giao_viec', title: '[PERMISSION-HARDENING-TEST] post-apply-delete-draft',
      content: 'Post-apply verification — real deleteTaskDraft RPC round-trip.',
      categoryCode: 'NHAN_SU', priority: 'thuong', startAt: null, deadline: futureDeadline(48), primaryEmployeeCode: 'PHF010'
    });
    await assert.rejects(() => core.deleteTaskDraft(session('PHF082'), draft.id, draft.row_version), e => e.code === 'TASK_DELETE_DRAFT_DENIED');
    pass(true, 'DRAFT_DELETE: non-creator denied');

    const publishedDraft = await core.createTaskDraft(session('PHF010'), {
      flowType: 'giao_viec', title: '[PERMISSION-HARDENING-TEST] post-apply-published-delete-denied',
      content: 'Post-apply verification — published task delete still denied.',
      categoryCode: 'NHAN_SU', priority: 'thuong', startAt: null, deadline: futureDeadline(48), primaryEmployeeCode: 'PHF010'
    });
    const published = await core.publishTask(session('PHF010'), publishedDraft.id, publishedDraft.row_version);
    await assert.rejects(() => core.deleteTaskDraft(session('PHF010'), published.id, published.row_version), e => e.code === 'TASK_NOT_DRAFT');
    pass(true, 'DRAFT_DELETE: published task denied');
    await core.cancelTask(session('PHF010'), published.id, published.row_version, 'Cleanup — schema repair post-apply fixture.');

    const result = await core.deleteTaskDraft(session('PHF010'), draft.id, draft.row_version);
    pass(result && result.deleted === true, 'DRAFT_DELETE: creator deletes own draft -> PASS, real RPC round-trip succeeded');
    const recheck = await supabase.from('task_tasks').select('id').eq('id', draft.id).maybeSingle();
    pass(!recheck.data, 'DRAFT_DELETE: task row genuinely gone from task_tasks after the real delete');
  }

  // =======================================================================
  // COMMENTS — real INSERT/UPDATE/DELETE against the repaired schema.
  // =======================================================================
  {
    const A5 = await taskByCode('CV-2608-0011'); // primary=PHF004, coordinators include PHF082
    const inserted = await core.addTaskComment(session('PHF082'), A5.id, '[PERMISSION-HARDENING-TEST] post-apply coordinator comment');
    pass(!!inserted && !!inserted.id, 'COMMENT: coordinator INSERT succeeds (LOCK 1 existing capability, now unblocked by the schema repair)');

    const directUpdate = await supabase.from('task_comments').update({ body: 'tampered' }).eq('id', inserted.id).select('*');
    pass(!!directUpdate.error, 'COMMENT: direct UPDATE on an existing comment is rejected by the append-only trigger (LOCK 5)');

    const directDelete = await supabase.from('task_comments').delete().eq('id', inserted.id).select('*');
    pass(!!directDelete.error, 'COMMENT: direct DELETE on an existing comment is rejected by the append-only trigger (LOCK 5)');

    const detail = await core.getTaskDetail(session('PHF010'), A5.id);
    pass(Array.isArray(detail.comments) && detail.comments.some(c => c.id === inserted.id), 'COMMENT: normal read/render (getTaskDetail) still shows the comment unaffected by the new triggers');
  }

  // =======================================================================
  // 37 REPORT-UI-TEST fixtures untouched.
  // =======================================================================
  {
    const { data } = await supabase.from('task_tasks').select('id').ilike('title', '%[REPORT-UI-TEST]%');
    pass(data.length === 37, '37 [REPORT-UI-TEST] fixtures still present, untouched by schema repair verification');
  }

  // =======================================================================
  // GRANT RESTRICT — dedicated live fixture (section 6, distinct from the
  // shared-code-path inference the Permission Hardening gate relied on for
  // extend).
  // =======================================================================
  {
    const B1 = await taskByCode('CV-2608-0013'); // primary=PHF004
    const b1Assignees = await assigneesFor(B1.id);
    // PRE state: PHF012 (TRUONG_BO_PHAN, peopleScope=self+managed[PHF082]) cannot view B1 (primary=PHF004, not in PHF012's managed set).
    const preState = await perms.canViewTask(session('PHF012'), relationTaskFrom(B1), toRelAssignees(b1Assignees));
    pass(preState === false, 'GRANT_RESTRICT: PRE state — PHF012 cannot view B1 (primary=PHF004, outside managed scope) before any grant');

    // Give PHF012 a temporary EXTEND to view all_company first, so there is something real for a RESTRICT to reduce.
    const nowIso = new Date().toISOString();
    const extendInsert = await supabase.from('task_permission_grants').insert({
      grantee_employee_code: 'PHF012', grant_type: 'extend',
      capabilities: { view: true }, people_scope: { type: 'all_company', values: [] },
      is_active: true, effective_from: nowIso, effective_to: null,
      reason: '[PERMISSION-HARDENING-TEST] grant-restrict fixture — base extend', created_by_employee_code: 'PHF010'
    }).select('*').single();
    if (extendInsert.error) throw extendInsert.error;
    const extendId = extendInsert.data.id;
    const afterExtend = await perms.canViewTask(session('PHF012'), relationTaskFrom(B1), toRelAssignees(b1Assignees));
    pass(afterExtend === true, 'GRANT_RESTRICT: PHF012 CAN view B1 after the base extend-to-all_company grant');

    // Now RESTRICT PHF012's view capability entirely (capabilities.view=false via restrict) -- verify it overrides the extend.
    const restrictInsert = await supabase.from('task_permission_grants').insert({
      grantee_employee_code: 'PHF012', grant_type: 'restrict',
      capabilities: { view: false }, people_scope: { type: 'self', values: [] },
      is_active: true, effective_from: nowIso, effective_to: null,
      reason: '[PERMISSION-HARDENING-TEST] grant-restrict fixture — reduces view', created_by_employee_code: 'PHF010'
    }).select('*').single();
    if (restrictInsert.error) throw restrictInsert.error;
    const restrictId = restrictInsert.data.id;

    const afterRestrict = await perms.canViewTask(session('PHF012'), relationTaskFrom(B1), toRelAssignees(b1Assignees));
    pass(afterRestrict === false, 'GRANT_RESTRICT: view capability correctly reduced to false, overriding the earlier extend (restrict wins by design, see applyGrant() ordering)');

    // Not-affecting-other-dimension check: PHF012's OWN update capability (independent of view) should be unaffected -- verify via resolveEffectiveTaskScope directly.
    const scopeAfterRestrict = await perms.resolveEffectiveTaskScope(session('PHF012'));
    pass(scopeAfterRestrict.scope.capabilities.update === true, 'GRANT_RESTRICT: restricting ONLY view capability does not affect the unrelated update capability (no over-reach beyond the intended dimension)');

    // Cleanup both fixture grants.
    const cleanupRestrict = await supabase.from('task_permission_grants').delete().eq('id', restrictId).select('*');
    const cleanupExtend = await supabase.from('task_permission_grants').delete().eq('id', extendId).select('*');
    pass(!cleanupRestrict.error && !cleanupExtend.error, 'GRANT_RESTRICT: both temporary fixture grants removed');

    const postState = await perms.canViewTask(session('PHF012'), relationTaskFrom(B1), toRelAssignees(b1Assignees));
    pass(postState === false, 'GRANT_RESTRICT: POST state identical to PRE state (canViewTask=false) after cleanup');
  }

  console.log(`PHF Task Schema Repair post-apply verification: ${passed}/${passed} PASS`);
})().catch(err => { console.error('FAIL', err); process.exit(1); });
