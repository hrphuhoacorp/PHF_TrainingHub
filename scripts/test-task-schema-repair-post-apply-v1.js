'use strict';

/*
 * PHF Task — SCHEMA REPAIR POST-APPLY VERIFICATION — PREPARED FOR THE NEXT
 * GATE, DO NOT RUN YET.
 *
 * This script requires ALL THREE of the following to already be applied to
 * canonical DEV (byhpcexmjzqpctyvfczd):
 *   1. scripts/PHF_TASK_FOUNDATION_CORRECTION_REPAIR_1.74.0.sql
 *   2. scripts/PHF_TASK_PERMISSION_HARDENING_1.73.0.sql
 *   3. scripts/PHF_TASK_PERMISSION_HARDENING_FIX_1.75.0.sql (gate:
 *      PHF_TASK_PERMISSION_HARDENING_1_73_FIX3_DRAFT_EVENT_CASCADE — fixes a
 *      REAL live post-apply FAIL: task_events also cascades from a draft
 *      delete when the draft has a comment, since addTaskComment() inserts
 *      a matching task_events row too; 1.73.0 alone only fixed the
 *      task_comments side of this)
 * (see PHF_TASK_SCHEMA_REPAIR_PRE_GO_LIVE_V1 gate report for the exact
 * SQL-Editor package and execution order). Running this before all three
 * are applied will fail at the first comment-insert / delete-draft /
 * draft-with-comment assertion — that failure is expected and not a new
 * regression, it just means the SQL has not been pasted into the Supabase
 * SQL Editor yet.
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
// PHASE B (2026-08-28): post-incident, the canonical PHF Task dev/test target
// is the SANDBOX project — NOT MAIN (byhpcexmjzqpctyvfczd). The migrations this
// script verifies must be re-applied to SANDBOX (deployer SQL package) before
// this runs green there. Fail-closed on any non-sandbox target; to re-verify a
// migration landed on MAIN, do it deliberately outside this script.
require('./task-sandbox-guard');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const core = require('../api/_lib/task-core');
const perms = require('../api/_lib/task-permissions');

let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }
function session(employeeCode) { return { account: { employeeCode } }; }
function adminSession(accountId) { return { account: { id: accountId, role: 'admin', employeeCode: '' } }; }
async function taskByCode(taskCode) { const { data, error } = await supabase.from('task_tasks').select('*').eq('task_code', taskCode).single(); if (error) throw error; return data; }
async function assigneesFor(taskId) { const { data } = await supabase.from('task_assignees').select('*').eq('task_id', taskId); return data || []; }
function relationTaskFrom(row) { return { createdByAccountId: row.created_by_account_id, createdByEmployeeCode: row.created_by_employee_code }; }
function toRelAssignees(rows) { return (rows || []).map(r => ({ employeeCode: r.employee_code, role: r.role, isActive: r.is_active })); }
function futureDeadline(hours) { return new Date(Date.now() + hours * 3600e3).toISOString(); }

(async () => {
  // =======================================================================
  // PRIOR LEFTOVER FIXTURE CLEANUP — exact recorded IDs only (no title-based
  // broad scan/delete), positively identified against the exact titles this
  // gate's own prior runs used, cleaned up ONLY through the normal
  // authorized draft-delete lifecycle (core.deleteTaskDraft as the real
  // creator) — never a raw delete, and never touching anything not still
  // status='draft'. Debris from earlier mis-targeted-project / pre-1.75-fix
  // attempts of THIS SAME gate:
  //   9d525da3-4986-4a80-91a0-9d09076734e9 (CV-2608-0060, '[SCHEMA-REPAIR-
  //     TEST] draft-with-comment-delete') — the FAIL fixture that triggered
  //     FIX 3 (1.75.0); still draft, still has its comment (be32f933-901a-
  //     4345-acac-7c2f8a8a8400) and event (0042fc6b-2762-4220-8bfc-
  //     17ce747211e4) attached, exactly as left by the rolled-back FAIL.
  //   01408612-f246-42de-b1c7-a5e7a5d76f56 ('[PERMISSION-HARDENING-TEST]
  //     post-apply-delete-draft') — stray draft from the earlier wrong-
  //     project attempt (task_delete_draft did not exist there yet, so this
  //     draft's own delete call never ran).
  // The 2 already-cancelled '[PERMISSION-HARDENING-TEST] post-apply-
  // published-delete-denied' duplicates (15242a9f-5833-46fa-aa40-
  // 6f712c0be924, 8fc8559d-1ed3-49ce-bd97-9814b1b4dd32) are LEFT ALONE —
  // cancelled/non-draft, hard-delete is correctly forbidden (LOCK 4), not a
  // bug, not this gate's job to remove.
  // =======================================================================
  {
    const leftoverIds = [
      { id: '9d525da3-4986-4a80-91a0-9d09076734e9', expectedTitle: '[SCHEMA-REPAIR-TEST] draft-with-comment-delete' },
      { id: '01408612-f246-42de-b1c7-a5e7a5d76f56', expectedTitle: '[PERMISSION-HARDENING-TEST] post-apply-delete-draft' }
    ];
    for (const fx of leftoverIds) {
      const { data: row } = await supabase.from('task_tasks').select('id, title, status, row_version').eq('id', fx.id).maybeSingle();
      if (!row) { pass(true, `LEFTOVER CLEANUP: ${fx.id} already absent — nothing to do`); continue; }
      pass(row.title === fx.expectedTitle, `LEFTOVER CLEANUP: ${fx.id} positively identified by exact title match before touching it`);
      if (row.status !== 'draft') { pass(true, `LEFTOVER CLEANUP: ${fx.id} is status='${row.status}' (not draft) — correctly left untouched, hard-delete forbidden by design`); continue; }
      const cleaned = await core.deleteTaskDraft(session('PHF010'), row.id, row.row_version);
      pass(cleaned && cleaned.deleted === true, `LEFTOVER CLEANUP: ${fx.id} removed via the normal authorized draft-delete lifecycle (creator=PHF010, real RPC round-trip) — proves FIX 3 (1.75.0) also resolves this exact real leftover, not just a fresh synthetic fixture`);
    }
  }

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
  // DRAFT WITH COMMENT(S) — FIX 2 + FIX 3 regression coverage. task_comments
  // AND task_events are BOTH ON DELETE CASCADE from task_tasks, and
  // addTaskComment() inserts into BOTH tables — so deleting a draft with a
  // comment must cascade cleanly through both, with no orphan in either.
  // This is the EXACT scenario that FAILED live before FIX 3 (1.75.0):
  // 'PHF Task: bảng task_events là append-only — không cho phép DELETE'.
  // =======================================================================
  {
    const draftWithComment = await core.createTaskDraft(session('PHF010'), {
      flowType: 'giao_viec', title: '[SCHEMA-REPAIR-TEST] draft-with-comment-delete-fix3',
      content: 'FIX 2 + FIX 3 regression — draft with an existing comment (and its matching event) must still be deletable atomically.',
      categoryCode: 'NHAN_SU', priority: 'thuong', startAt: null, deadline: futureDeadline(48), primaryEmployeeCode: 'PHF010'
    });
    const commentOnDraft = await core.addTaskComment(session('PHF010'), draftWithComment.id, '[SCHEMA-REPAIR-TEST] comment on a draft, before delete');
    pass(!!commentOnDraft && !!commentOnDraft.id, 'FIX2: comment insert on a DRAFT task succeeds (addTaskComment has no draft/published gate)');

    const eventForComment = await supabase.from('task_events').select('id').eq('task_id', draftWithComment.id).eq('event_type', 'comment').maybeSingle();
    pass(!!eventForComment.data && !!eventForComment.data.id, 'FIX3: confirms addTaskComment() also inserted a matching task_events row (event_type=comment) — this is the exact fixture shape that FAILED before FIX 3');
    const eventId = eventForComment.data.id;

    const deleteWithCommentResult = await core.deleteTaskDraft(session('PHF010'), draftWithComment.id, draftWithComment.row_version);
    pass(deleteWithCommentResult && deleteWithCommentResult.deleted === true, 'FIX3 DRAFT-WITH-COMMENT-AND-EVENT DELETE TEST: draft delete succeeds atomically even though it has a comment AND its matching event — this is the exact call that raised "task_events là append-only" before FIX 3 (1.75.0)');

    const taskRecheckAfterCascade = await supabase.from('task_tasks').select('id').eq('id', draftWithComment.id).maybeSingle();
    pass(!taskRecheckAfterCascade.data, 'FIX2/3: task row genuinely gone');
    const commentRecheckAfterCascade = await supabase.from('task_comments').select('id').eq('id', commentOnDraft.id).maybeSingle();
    pass(!commentRecheckAfterCascade.data, 'FIX2: comment row genuinely gone too — CASCADE actually completed, no orphan comment left behind');
    const eventRecheckAfterCascade = await supabase.from('task_events').select('id').eq('id', eventId).maybeSingle();
    pass(!eventRecheckAfterCascade.data, 'FIX3: event row genuinely gone too — CASCADE actually completed through task_events as well, no orphan event left behind');
  }

  // =======================================================================
  // STANDALONE task_events UPDATE/DELETE — must remain denied outside any
  // draft-delete transaction (FIX 3 regression: the new bypass must be
  // scoped to task_delete_draft()'s own transaction, not a general opening).
  // Also doubles as "published task event history remains intact": A5
  // (CV-2608-0011) is a real, pre-existing NON-draft fixture.
  // =======================================================================
  {
    const A5 = await taskByCode('CV-2608-0011');
    pass(A5.status !== 'draft', 'FIX3: A5 (CV-2608-0011) confirmed NOT a draft — this is a real published-task history check, not a fresh throwaway fixture');
    const { data: existingEvents } = await supabase.from('task_events').select('id').eq('task_id', A5.id).limit(1);
    pass(Array.isArray(existingEvents) && existingEvents.length === 1, 'FIX3: A5 has at least one existing real event row to test against');
    const targetEventId = existingEvents[0].id;

    const directEventUpdate = await supabase.from('task_events').update({ event_type: 'tampered' }).eq('id', targetEventId).select('*');
    pass(!!directEventUpdate.error, 'FIX3: direct standalone UPDATE on an existing task_events row is DENIED (append-only, no draft-delete transaction in progress)');

    const directEventDelete = await supabase.from('task_events').delete().eq('id', targetEventId).select('*');
    pass(!!directEventDelete.error, 'FIX3: direct standalone DELETE on an existing task_events row on a PUBLISHED task is DENIED — published task event history remains intact');

    const eventStillThere = await supabase.from('task_events').select('id').eq('id', targetEventId).maybeSingle();
    pass(!!eventStillThere.data, 'FIX3: event row genuinely survived both attack attempts, unchanged');
  }

  // =======================================================================
  // ACCOUNT-ONLY CREATOR AUTHORIZATION — FIX 1 regression coverage. Proves
  // the OLD single-column `<>` comparison's NULL-fail-open bug (any actor
  // could delete an account-only-created draft, since NULL <> anything is
  // NULL and PL/pgSQL `if NULL` never enters the raise branch) is closed,
  // using direct RPC calls (service-role client — bypasses the JS-layer
  // actorOwnsTask() check entirely) to test the SQL-layer check in isolation.
  // =======================================================================
  {
    const adminRow = (await supabase.from('user_accounts').select('id').eq('role', 'admin').limit(1).single()).data;
    const acctDraft = await core.createTaskDraft(adminSession(adminRow.id), {
      flowType: 'giao_viec', title: '[SCHEMA-REPAIR-TEST] account-only-creator-delete',
      content: 'FIX 1 regression — account-only creator (created_by_employee_code IS NULL) deletes own draft.',
      categoryCode: 'NHAN_SU', priority: 'thuong', startAt: null, deadline: futureDeadline(48), primaryEmployeeCode: 'PHF010'
    });
    pass(!acctDraft.created_by_employee_code && acctDraft.created_by_account_id === adminRow.id, 'FIX1: fixture genuinely account-only creator — created_by_employee_code IS NULL, created_by_account_id = real admin account id');

    const forgedEmployee = await supabase.rpc('task_delete_draft', { p_task_id: acctDraft.id, p_expected_row_version: acctDraft.row_version, p_actor_account_id: null, p_actor_employee_code: 'PHF082' });
    pass(!!forgedEmployee.error && /TASK_DELETE_DRAFT_NOT_CREATOR/.test(forgedEmployee.error.message || ''), 'FIX1 NULL-FAIL-OPEN REGRESSION: direct RPC call supplying only an unrelated employee_code (the row has no employee_code to match against) is DENIED, not silently allowed — this is exactly the shape of the old bug');

    const forgedAccount = await supabase.rpc('task_delete_draft', { p_task_id: acctDraft.id, p_expected_row_version: acctDraft.row_version, p_actor_account_id: '00000000-0000-0000-0000-000000000000', p_actor_employee_code: null });
    pass(!!forgedAccount.error && /TASK_DELETE_DRAFT_NOT_CREATOR/.test(forgedAccount.error.message || ''), 'FIX1: direct RPC call with a WRONG account_id (not the real creator) is denied — a forged account identity does not bypass');

    const stillThereAfterForgery = await supabase.from('task_tasks').select('id').eq('id', acctDraft.id).maybeSingle();
    pass(!!stillThereAfterForgery.data, 'FIX1: fixture survived both forged-identity attempts');

    await assert.rejects(() => core.deleteTaskDraft(session('PHF082'), acctDraft.id, acctDraft.row_version), e => e.code === 'TASK_DELETE_DRAFT_DENIED');
    pass(true, 'FIX1: unrelated employee session denied at the JS layer (actorOwnsTask) before ever reaching the RPC');

    const acctDeleteResult = await core.deleteTaskDraft(adminSession(adminRow.id), acctDraft.id, acctDraft.row_version);
    pass(acctDeleteResult && acctDeleteResult.deleted === true, 'FIX1 ACCOUNT-ONLY-CREATOR TEST: the real account-only creator (Admin) deletes their own draft successfully end-to-end');
    const acctRecheck = await supabase.from('task_tasks').select('id').eq('id', acctDraft.id).maybeSingle();
    pass(!acctRecheck.data, 'FIX1: account-only-creator fixture genuinely gone after the authorized delete');
  }

  // =======================================================================
  // COMMENTS — real INSERT/UPDATE/DELETE against the repaired schema.
  // =======================================================================
  {
    const A5 = await taskByCode('CV-2608-0011'); // primary=PHF004, coordinators include PHF082
    pass(A5.status !== 'draft', 'FIX3: A5 confirmed NOT a draft — the following comment append-only checks are a real published-task history regression, not a synthetic case');
    const inserted = await core.addTaskComment(session('PHF082'), A5.id, '[PERMISSION-HARDENING-TEST] post-apply coordinator comment');
    pass(!!inserted && !!inserted.id, 'COMMENT: coordinator INSERT succeeds (LOCK 1 existing capability, now unblocked by the schema repair)');

    const directUpdate = await supabase.from('task_comments').update({ body: 'tampered' }).eq('id', inserted.id).select('*');
    pass(!!directUpdate.error, 'COMMENT: direct UPDATE on an existing comment is rejected by the append-only trigger (LOCK 5) — published task comment history remains intact');

    const directDelete = await supabase.from('task_comments').delete().eq('id', inserted.id).select('*');
    pass(!!directDelete.error, 'COMMENT: direct DELETE on an existing comment is rejected by the append-only trigger (LOCK 5) — published task comment history remains intact');

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
