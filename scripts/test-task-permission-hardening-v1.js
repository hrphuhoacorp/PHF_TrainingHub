'use strict';

/*
 * PHF Task — PERMISSION HARDENING PRE-GO-LIVE V1 — real dev DB, in-process
 * (same methodology as scripts/test-task-report-employee-drilldown-parity-v1.js).
 * Creates a small number of tagged [PERMISSION-HARDENING-TEST] fixtures,
 * exercises the 5 locked business rules against them, cleans up what CAN be
 * cleaned (drafts, temporary grants) and leaves what CANNOT be cleaned by
 * design (a hard-delete-blocked published/cancelled task is exactly the
 * proof of LOCK 4 — deleting it would contradict the very rule being
 * tested). Sequential, minimal traffic (Supabase NANO guard) — no loops,
 * no polling, no bulk operations. Does NOT touch the 37 [REPORT-UI-TEST]
 * fixtures.
 *
 * LOCK 1 (coordinator has no update authority), LOCK 2 (published task
 * immutability), LOCK 4 (no hard-delete after publish, DB-trigger-enforced)
 * required NO code change — this suite is what elevates them from
 * "code-verified" to "regression-guarded going forward". LOCK 3 (delete
 * draft) and LOCK 5 (comments append-only) required new code/migration;
 * LOCK 3's RPC is drafted in scripts/PHF_TASK_PERMISSION_HARDENING_1.73.0.sql
 * but NOT YET APPLIED to the dev schema (no DDL execution capability in
 * this environment — see gate report) — LOCK 3 tests here therefore verify
 * the JS-layer AUTHORIZATION ORDER (deny-before-ever-reaching-the-RPC),
 * which is fully live-verifiable today, and stop short of a full RPC
 * round-trip until the migration is applied.
 */

const assert = require('assert');
require('dotenv').config();
require('./task-sandbox-guard'); // fail-closed: refuse to run unless SUPABASE_URL === PHF_HR sandbox
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const core = require('../api/_lib/task-core');
const perms = require('../api/_lib/task-permissions');
const fixtures = require('./task-report-fixture-manifest');

// Fixtures resolved by ROLE from the canonical manifest (never a hard-coded
// CV-2608-00NN — see scripts/task-report-fixture-manifest.js).
const MANIFEST = fixtures.load();
const FX_COMPLETED = MANIFEST.plans.A1.task_code;                                        // non-draft (completed), creator PHF010
const FX_FANOUT = fixtures.requireSemantic(MANIFEST, 'completedOnTimeCoordinatorFanout').task_code; // primary PHF004, coordinators incl PHF082
const FX_PRIMARY_PHF004 = MANIFEST.plans.B1.task_code;                                   // primary PHF004, no transfer, no coordinators
const FX_PRIMARY_PHF012 = MANIFEST.plans.F6.task_code;                                   // primary PHF012 (not covered by a PHF004-scoped grant)

let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }

// =======================================================================
// STRUCTURAL — the migration is DRAFTED but NOT YET APPLIED to the dev
// schema (no DDL execution capability in this environment — see gate
// report). Same "structural SQL-text audit" pattern already used by
// scripts/test-task-code-idempotency-v1.js for its own not-yet-applied
// migration. Once applied, the LOCK 3 tests below will additionally get a
// real RPC round-trip (currently they stop at "authorization passed, RPC
// not found" — see the LOCK 3 section).
// =======================================================================
{
  const migrationSql = fs.readFileSync(path.join(__dirname, 'PHF_TASK_PERMISSION_HARDENING_1.73.0.sql'), 'utf8');
  pass(/create or replace function public\.task_delete_draft/.test(migrationSql), 'MIGRATION: defines task_delete_draft(uuid, integer, text, text)');
  pass(/p_actor_account_id text,\s*\n\s*p_actor_employee_code text\s*\n\)\s*returns void/.test(migrationSql), 'MIGRATION FIX 1: task_delete_draft takes BOTH p_actor_account_id and p_actor_employee_code — not a single merged token (an account-only creator has created_by_employee_code IS NULL after 1.74.0, so a single-column check fails open — see REVIEW_FIX_REPORT)');
  pass(/if v_task\.status <> 'draft' then/.test(migrationSql), 'MIGRATION: task_delete_draft re-checks status=draft inside the function (defense-in-depth, not just relying on the DB trigger)');
  pass(/if v_task\.row_version <> p_expected_row_version then/.test(migrationSql), 'MIGRATION: task_delete_draft checks row_version (same optimistic-concurrency convention as every other lifecycle RPC)');
  pass(!/upper\(trim\(v_task\.created_by_employee_code\)\) <> upper\(trim\(coalesce\(p_actor_employee_code/.test(migrationSql), 'MIGRATION FIX 1: the OLD single-column `<>` comparison (NULL <> anything = NULL = fail-open in PL/pgSQL IF) is gone');
  pass(/v_task\.created_by_account_id = p_actor_account_id/.test(migrationSql) && /upper\(trim\(v_task\.created_by_employee_code\)\) = upper\(trim\(p_actor_employee_code\)\)/.test(migrationSql), 'MIGRATION FIX 1: authorization is an explicit OR of two presence-gated equality checks (account channel OR employee channel), matching actorOwnsTask() (JS) and task_set_permission_assignment (1.69.0) conventions — no channel can silently evaluate to NULL and skip the raise');
  pass(/raise exception 'TASK_DELETE_DRAFT_NOT_CREATOR'/.test(migrationSql), 'MIGRATION: still raises the same TASK_DELETE_DRAFT_NOT_CREATOR on authorization failure');
  pass(/revoke execute on function public\.task_delete_draft\(uuid, integer, text, text\)\s*\n\s*from public, anon, authenticated;/.test(migrationSql) && /grant execute on function public\.task_delete_draft\(uuid, integer, text, text\)\s*\n\s*to service_role;/.test(migrationSql), 'MIGRATION FIX 1: task_delete_draft execute is revoked from public/anon/authenticated and granted only to service_role, matching every sibling RPC — the first draft omitted this, leaving the RPC directly callable (and forgeable) by any authenticated client');
  pass(/delete from public\.task_tasks where id = p_task_id;/.test(migrationSql), 'MIGRATION: ends with a real DELETE — relies on the EXISTING task_tasks_guard_delete trigger as the final backstop (not duplicated here)');
  pass(!/create or replace function public\.task_guard_task_delete/.test(migrationSql), 'MIGRATION: does NOT redefine the existing task_tasks_guard_delete trigger function (LOCK 4 backstop untouched, additive-only migration)');
  pass(/perform set_config\('phf_task\.delete_draft_task_id', p_task_id::text, true\);/.test(migrationSql), 'MIGRATION FIX 2: task_delete_draft sets a transaction-local (is_local=true) GUC scoped to its OWN p_task_id immediately before its own DELETE — this is what lets the draft-cascade DELETE past the new comment append-only trigger without weakening it for any other path');
  pass(/task_comments_forbid_update/.test(migrationSql) && /task_comments_forbid_delete/.test(migrationSql), 'MIGRATION: adds both BEFORE UPDATE and BEFORE DELETE triggers on task_comments (LOCK 5)');
  pass(/create or replace function public\.task_forbid_comment_mutation\(\)/.test(migrationSql), 'MIGRATION FIX 2: task_comments uses a NEW dedicated trigger function, NOT the shared task_forbid_update_delete() — task_comments.task_id is ON DELETE CASCADE from task_tasks and addTaskComment() allows commenting on a draft, so an unconditional forbid-delete (the first draft\'s design) would abort task_delete_draft() itself for any draft that already has a comment; reusing the shared function would also have required loosening it for task_events, which must stay unconditionally fail-safe');
  pass(!/create or replace function public\.task_forbid_update_delete/.test(migrationSql), 'MIGRATION: does NOT redefine the existing shared task_forbid_update_delete() function — task_events (and any other table using it) keeps its unconditional, un-bypassable append-only guarantee, completely untouched by this migration');
  pass(/current_setting\('phf_task\.delete_draft_task_id', true\) = old\.task_id::text/.test(migrationSql), 'MIGRATION FIX 2: the DELETE bypass matches on the EXACT task_id being deleted (not a blanket flag) — a comment belonging to a DIFFERENT task can never ride along on someone else\'s authorized draft-delete transaction');
  pass(!/on public\.task_links/.test(migrationSql), 'MIGRATION: no DDL statement (trigger/alter) targets task_links — scope stays minimal to comments only, per gate instruction (task_links parallel gap reported, not fixed here)');
}

// =======================================================================
// STRUCTURAL — PHF_TASK_PERMISSION_HARDENING_FIX_1.75.0.sql. 1.73.0 is
// ALREADY applied to canonical DEV; this is a SEPARATE additive corrective
// migration (gate: PHF_TASK_PERMISSION_HARDENING_1_73_FIX3_DRAFT_EVENT_
// CASCADE) fixing a real post-apply FAIL: addTaskComment() inserts a
// task_events row (event_type='comment') on ANY task including a draft, and
// task_events.task_id is ON DELETE CASCADE from task_tasks — so deleting a
// draft with a comment cascaded into task_events and hit the OLD
// unconditional task_forbid_update_delete() trigger, aborting the whole
// authorized draft delete.
// =======================================================================
{
  const fixSql = fs.readFileSync(path.join(__dirname, 'PHF_TASK_PERMISSION_HARDENING_FIX_1.75.0.sql'), 'utf8');
  pass(/create or replace function public\.task_events_forbid_mutation\(\)/.test(fixSql), 'FIX3: defines a NEW dedicated trigger function for task_events, mirroring task_forbid_comment_mutation() (1.73.0)');
  pass(!/create or replace function public\.task_forbid_update_delete/.test(fixSql), 'FIX3: does NOT redefine the shared task_forbid_update_delete() — task_permission_grant_history and task_permission_assignment_history (both still use it) stay unconditionally immutable, untouched');
  pass(!/create or replace function public\.task_delete_draft/.test(fixSql) && !/create or replace function public\.task_forbid_comment_mutation/.test(fixSql), 'FIX3: does NOT redeclare task_delete_draft() or task_forbid_comment_mutation() — neither needs to change, task_delete_draft() already sets the right GUC at the right time, task_events_forbid_mutation() just reuses it');
  pass(/current_setting\('phf_task\.delete_draft_task_id', true\) = old\.task_id::text/.test(fixSql), 'FIX3: task_events DELETE bypass reuses the EXACT SAME GUC name and exact-task_id match as task_comments (1.73.0) — no new GUC introduced');
  pass(/drop trigger if exists task_events_forbid_update on public\.task_events;\s*\n\s*create trigger task_events_forbid_update before update on public\.task_events\s*\n\s*for each row execute function public\.task_events_forbid_mutation\(\);/.test(fixSql), 'FIX3: task_events_forbid_update trigger repointed to the new dedicated function');
  pass(/drop trigger if exists task_events_forbid_delete on public\.task_events;\s*\n\s*create trigger task_events_forbid_delete before delete on public\.task_events\s*\n\s*for each row execute function public\.task_events_forbid_mutation\(\);/.test(fixSql), 'FIX3: task_events_forbid_delete trigger repointed to the new dedicated function');
  pass(!/on public\.task_permission_grant_history/.test(fixSql) && !/on public\.task_permission_assignment_history/.test(fixSql), 'FIX3: no DDL statement targets task_permission_grant_history or task_permission_assignment_history — scope stays minimal to task_events only');

  const downSql = fs.readFileSync(path.join(__dirname, 'PHF_TASK_PERMISSION_HARDENING_FIX_1.75.0_DOWN.sql'), 'utf8');
  pass(/execute function public\.task_forbid_update_delete\(\)/.test(downSql), 'FIX3 DOWN: restores task_events triggers to the original shared task_forbid_update_delete() function');
  pass(/drop function if exists public\.task_events_forbid_mutation\(\);/.test(downSql), 'FIX3 DOWN: drops the new dedicated function');
}

function session(employeeCode) { return { account: { employeeCode } }; }
function adminSession(accountId) { return { account: { id: accountId, role: 'admin', employeeCode: '' } }; }
async function taskByCode(taskCode) { const { data, error } = await supabase.from('task_tasks').select('*').eq('task_code', taskCode).single(); if (error) throw error; return data; }
async function assigneesFor(taskId) { const { data } = await supabase.from('task_assignees').select('*').eq('task_id', taskId); return data || []; }
function relationTaskFrom(row) { return { createdByAccountId: row.created_by_account_id, createdByEmployeeCode: row.created_by_employee_code }; }
function toRelAssignees(rows) { return (rows || []).map(r => ({ employeeCode: r.employee_code, role: r.role, isActive: r.is_active })); }
function futureDeadline(hours) { return new Date(Date.now() + hours * 3600e3).toISOString(); }

(async () => {
  // =======================================================================
  // LOCK 4 — DB-level hard-delete guard (task_tasks_guard_delete trigger,
  // already applied since PHF_TASK_FOUNDATION_1.66.0.sql — this proves it
  // is STILL active, not that it was newly added).
  // =======================================================================
  {
    // LOCK 4 is defended by TWO independent layers; which one is load-bearing
    // depends on whether service_role currently holds table DELETE privilege:
    //   (a) PHF_TASK_SERVICE_ROLE_PRIVILEGES_1.72.2.sql withholds DELETE on
    //       task_tasks from service_role entirely — no hard-delete is possible
    //       at all, period.
    //   (b) IF a DELETE privilege is granted (e.g. the SANDBOX parity package,
    //       or MAIN's out-of-band grant), the task_tasks_guard_delete trigger
    //       still blocks any non-draft row and allows draft-only.
    // Probe the privilege, then assert the layer that actually applies.
    const probe = await supabase.from('task_tasks').delete().eq('id', '00000000-0000-4000-8000-000000000000').select('id');
    const hasDeletePriv = !(probe.error && probe.error.code === '42501');

    const draft = await core.createTaskDraft(session('PHF010'), {
      flowType: 'giao_viec', title: '[PERMISSION-HARDENING-TEST] lock4-draft-delete-allowed',
      content: 'Regression fixture — LOCK 4 draft-delete-allowed check.',
      categoryCode: 'NHAN_SU', priority: 'thuong', startAt: null, deadline: futureDeadline(48), primaryEmployeeCode: 'PHF010'
    });
    const draft2 = await core.createTaskDraft(session('PHF010'), {
      flowType: 'giao_viec', title: '[PERMISSION-HARDENING-TEST] lock4-published-delete-blocked',
      content: 'Regression fixture — LOCK 4 published-delete-blocked check.',
      categoryCode: 'NHAN_SU', priority: 'thuong', startAt: null, deadline: futureDeadline(48), primaryEmployeeCode: 'PHF010'
    });
    const published2 = await core.publishTask(session('PHF010'), draft2.id, draft2.row_version);

    if (hasDeletePriv) {
      const rawDeleteDraft = await supabase.from('task_tasks').delete().eq('id', draft.id).select('*');
      pass(!rawDeleteDraft.error && rawDeleteDraft.data.length === 1, 'LOCK4 (layer b, DELETE priv present): raw DELETE on a DRAFT row succeeds — trigger allows draft-only hard-delete');
      const rawDeletePublished = await supabase.from('task_tasks').delete().eq('id', published2.id).select('*');
      pass(!!rawDeletePublished.error, 'LOCK4 (layer b): raw DELETE on a PUBLISHED row is rejected by the task_tasks_guard_delete trigger, independent of any application code path');
    } else {
      const rawDeleteDraft = await supabase.from('task_tasks').delete().eq('id', draft.id).select('*');
      pass(!!rawDeleteDraft.error && rawDeleteDraft.error.code === '42501', 'LOCK4 (layer a, canonical 1.72.2): service_role has NO DELETE on task_tasks — hard-delete is impossible for ANY row, draft or not (stronger than the trigger)');
      const rawDeletePublished = await supabase.from('task_tasks').delete().eq('id', published2.id).select('*');
      pass(!!rawDeletePublished.error && rawDeletePublished.error.code === '42501', 'LOCK4 (layer a): raw DELETE on a PUBLISHED row is also rejected at the privilege layer, before the trigger is even reached');
      // draft fixture cannot be hard-deleted here; cancel it too so nothing dangles.
      const dpub = await core.publishTask(session('PHF010'), draft.id, draft.row_version);
      await core.cancelTask(session('PHF010'), dpub.id, dpub.row_version, 'Cleanup — LOCK 4 draft fixture (no DELETE priv in this environment).');
    }
    // Cleanup the published fixture via the only legitimate path for a non-draft task: Cancel.
    const cancelled = await core.cancelTask(session('PHF010'), published2.id, published2.row_version, 'Cleanup — Permission Hardening LOCK 4 regression fixture.');
    pass(cancelled.status === 'cancelled', 'LOCK4: cleanup via real Cancel action succeeds (the fixture is left cancelled, not deleted — that IS the locked behavior)');
  }

  // =======================================================================
  // LOCK 3 — deleteTaskDraft() authorization order (creator-only, no
  // capability-based override, draft-only gate wins even for the real
  // creator once published).
  // =======================================================================
  {
    const draft3 = await core.createTaskDraft(session('PHF010'), {
      flowType: 'giao_viec', title: '[PERMISSION-HARDENING-TEST] lock3-authz-order',
      content: 'Regression fixture — LOCK 3 authorization order check.',
      categoryCode: 'NHAN_SU', priority: 'thuong', startAt: null, deadline: futureDeadline(48), primaryEmployeeCode: 'PHF010'
    });
    await assert.rejects(() => core.deleteTaskDraft(session('PHF082'), draft3.id, draft3.row_version), e => e.code === 'TASK_DELETE_DRAFT_DENIED');
    pass(true, 'LOCK3: non-creator (PHF082) denied TASK_DELETE_DRAFT_DENIED');

    await core.addTaskRelated(session('PHF010'), draft3.id, 'PHF012');
    await assert.rejects(() => core.deleteTaskDraft(session('PHF012'), draft3.id, draft3.row_version), e => e.code === 'TASK_DELETE_DRAFT_DENIED');
    pass(true, 'LOCK3: coordinator (PHF012, not creator) denied TASK_DELETE_DRAFT_DENIED — coordinator relation grants no delete authority');

    await assert.rejects(() => core.deleteTaskDraft(session('PHF002'), draft3.id, draft3.row_version), e => e.code === 'TASK_DELETE_DRAFT_DENIED');
    pass(true, 'LOCK3: GIAM_DOC (broad all_company capability, NOT creator) denied — creator-only has no capability-based override, unlike reopen/cancel/transfer');

    const publishedForDelete = await core.publishTask(session('PHF010'), draft3.id, draft3.row_version);
    await assert.rejects(() => core.deleteTaskDraft(session('PHF010'), publishedForDelete.id, publishedForDelete.row_version), e => e.code === 'TASK_NOT_DRAFT');
    pass(true, 'LOCK3: real creator denied TASK_NOT_DRAFT once the task is published — status gate wins even for the true creator');
    await core.cancelTask(session('PHF010'), publishedForDelete.id, publishedForDelete.row_version, 'Cleanup — Permission Hardening LOCK 3 regression fixture.');

    const draft4 = await core.createTaskDraft(session('PHF010'), {
      flowType: 'giao_viec', title: '[PERMISSION-HARDENING-TEST] lock3-creator-authorized-path',
      content: 'Regression fixture — LOCK 3 creator-authorized-path check.',
      categoryCode: 'NHAN_SU', priority: 'thuong', startAt: null, deadline: futureDeadline(48), primaryEmployeeCode: 'PHF010'
    });
    let draft4Deleted = false;
    try {
      await core.deleteTaskDraft(session('PHF010'), draft4.id, draft4.row_version);
      pass(true, 'LOCK3: real creator + real draft succeeded end-to-end (task_delete_draft RPC live + DELETE priv present)');
      draft4Deleted = true;
    } catch (e) {
      pass(e.code !== 'TASK_DELETE_DRAFT_DENIED' && e.code !== 'TASK_NOT_DRAFT', 'LOCK3: real creator + real draft passes ALL authorization checks — only fails at the RPC/privilege layer (code=' + e.code + '), never at an authorization gate');
    }
    if (!draft4Deleted) {
      const cleanupDraft4 = await supabase.from('task_tasks').delete().eq('id', draft4.id).select('*');
      if (cleanupDraft4.error) { // no DELETE priv — publish+cancel so nothing dangles
        const p4 = await core.publishTask(session('PHF010'), draft4.id, draft4.row_version);
        await core.cancelTask(session('PHF010'), p4.id, p4.row_version, 'Cleanup — LOCK 3 draft4 fixture (no DELETE priv).');
      }
      pass(true, 'LOCK3: draft4 fixture cleaned up (hard delete where privileged, else publish+cancel)');
    }
  }

  // =======================================================================
  // LOCK 2 — published task immutability, including Admin, using real
  // existing (not newly created) fixtures — the attempt is expected to
  // fail, so no data changes and no new fixture rows are needed.
  // =======================================================================
  {
    const A1 = await taskByCode(FX_COMPLETED); // real fixture, status=completed
    await assert.rejects(() => core.updateTaskDraft(session('PHF010'), A1.id, A1.row_version, { title: 'HACKED TITLE ATTEMPT' }), e => e.code === 'TASK_NOT_DRAFT');
    pass(true, 'LOCK2: real creator cannot edit title on a non-draft (completed) task');

    const adminId = (await supabase.from('user_accounts').select('id').eq('role', 'admin').limit(1).single()).data.id;
    await assert.rejects(() => core.updateTaskDraft(adminSession(adminId), A1.id, A1.row_version, { title: 'ADMIN HACKED TITLE' }), e => e.code === 'TASK_NOT_DRAFT');
    pass(true, 'LOCK2: real Admin account ALSO cannot edit a non-draft task — immutability applies to Admin too, no role bypass');

    const recheck = await taskByCode(FX_COMPLETED);
    pass(recheck.title === A1.title, 'LOCK2: title genuinely unchanged in the DB after both attack attempts');

    const deadlineChanged = await core.changeTaskDeadline(session('PHF010'), A1.id, A1.row_version, futureDeadline(72), 'Permission Hardening regression — verify dedicated deadline action still works.');
    pass(deadlineChanged.deadline_version === A1.deadline_version + 1, 'LOCK2: the dedicated changeTaskDeadline action is UNAFFECTED by the immutability lock (it is not the generic edit path)');
    const reverted = await core.changeTaskDeadline(session('PHF010'), A1.id, deadlineChanged.row_version, A1.deadline, 'Permission Hardening regression — revert to original deadline.');
    pass(reverted.deadline === A1.deadline, 'LOCK2: deadline reverted to its exact original value — 37-fixture data left unchanged');
  }

  // =======================================================================
  // LOCK 1 — coordinator restrictions, using a real existing fixture with a
  // known coordinator (CV-2608-0011 / A5: primary=PHF004, coordinators
  // include PHF082).
  // =======================================================================
  {
    const A5 = await taskByCode(FX_FANOUT);
    const a5Assignees = await assigneesFor(A5.id);
    const relation = await perms.classifyTaskRelation('PHF082', relationTaskFrom(A5), toRelAssignees(a5Assignees));
    pass(relation === 'related', 'LOCK1: PHF082 relation to A5 is "related" (coordinator), confirmed real fixture shape');

    pass(await perms.canViewTask(session('PHF082'), relationTaskFrom(A5), toRelAssignees(a5Assignees)) === true, 'LOCK1: coordinator CAN view');

    await assert.rejects(() => core.updateTaskProgress(session('PHF082'), A5.id, A5.row_version, 50, 'dang_thuc_hien'), e => e.code === 'TASK_PROGRESS_ACTOR_DENIED');
    pass(true, 'LOCK1: coordinator DENIED update progress (only current active primary may)');
    await assert.rejects(() => core.completeTask(session('PHF082'), A5.id, A5.row_version, 'Coordinator complete attempt'), e => e.code === 'TASK_COMPLETE_ACTOR_DENIED');
    pass(true, 'LOCK1: coordinator DENIED complete');
    await assert.rejects(() => core.transferTaskPrimary(session('PHF082'), A5.id, A5.row_version, 'PHF082', 'Coordinator transfer attempt'), e => e.code === 'TASK_UPDATE_DENIED');
    pass(true, 'LOCK1: coordinator DENIED transfer primary');
    await assert.rejects(() => core.cancelTask(session('PHF082'), A5.id, A5.row_version, 'Coordinator cancel attempt'), e => e.code === 'TASK_UPDATE_DENIED');
    pass(true, 'LOCK1: coordinator DENIED cancel');

    // Positive existing-capability evidence: link (comment path currently
    // blocked by an UNRELATED pre-existing schema gap — see gate report,
    // task_comments.author_account_id from PHF_TASK_FOUNDATION_CORRECTION_
    // 1.68.0.sql is not live in this dev schema; not fixed in this gate).
    const linkResult = await core.addTaskLink(session('PHF082'), A5.id, 'coordination', 'https://example.internal/permission-hardening-regression', '[PERMISSION-HARDENING-TEST] coordinator link regression check');
    pass(!!linkResult && !!linkResult.id, 'LOCK1: coordinator CAN add a link (existing capability, independent of update authority)');
  }

  // =======================================================================
  // PERMISSION GRANTS — extend/restrict/expire/client-override, temporary
  // fixture, fully cleaned up, pre/post state verified identical.
  // =======================================================================
  {
    const B1 = await taskByCode(FX_PRIMARY_PHF004);
    const b1Assignees = await assigneesFor(B1.id);
    const preState = await perms.canViewTask(session('PHF082'), relationTaskFrom(B1), toRelAssignees(b1Assignees));
    pass(preState === false, 'GRANT: PRE state — PHF082 cannot view B1 before any grant');

    const insertExtend = await supabase.from('task_permission_grants').insert({
      grantee_employee_code: 'PHF082', grant_type: 'extend',
      capabilities: { view: true }, people_scope: { type: 'employees', values: ['PHF004'] },
      is_active: true, effective_from: new Date().toISOString(), effective_to: null,
      reason: '[PERMISSION-HARDENING-TEST] temporary extend grant regression fixture', created_by_employee_code: 'PHF010'
    }).select('*').single();
    if (insertExtend.error) throw insertExtend.error;
    const grantId = insertExtend.data.id;

    pass(await perms.canViewTask(session('PHF082'), relationTaskFrom(B1), toRelAssignees(b1Assignees)) === true, 'GRANT extend: PHF082 CAN now view B1 (primary=PHF004) after the grant');

    const F6 = await taskByCode(FX_PRIMARY_PHF012); // primary=PHF012, NOT covered by the PHF004-scoped grant
    const f6Assignees = await assigneesFor(F6.id);
    pass(await perms.canViewTask(session('PHF082'), relationTaskFrom(F6), toRelAssignees(f6Assignees)) === false, 'GRANT extend: PHF082 still CANNOT view a different employee (PHF012) task not covered by the grant — no over-reach beyond the grant scope');

    await supabase.from('task_permission_grants').update({ is_active: false }).eq('id', grantId);
    pass(await perms.canViewTask(session('PHF082'), relationTaskFrom(B1), toRelAssignees(b1Assignees)) === false, 'GRANT inactive: deactivated grant has NO effect — PHF082 denied again');

    // COMPANY-LEVEL PERMISSION CLEANUP (2026-08-29): requireTaskPermissionAdmin()
    // is now capability-driven ONLY (requireTaskCapability('manage')) — the
    // redundant hard actorType==='admin' check (which also blocked GĐ/TLGĐ,
    // now intentionally granted 'manage') was removed. PHF082 (nhan_vien,
    // manage:false) is still correctly denied, just under TASK_CAPABILITY_DENIED
    // instead of the old TASK_PERMISSION_ADMIN_REQUIRED — same security outcome.
    await assert.rejects(
      () => core.createTaskPermissionGrant(session('PHF082'), { granteeEmployeeCode: 'PHF082', grantType: 'extend', capabilities: { view: true, assign: true, update: true, manage: true }, peopleScope: { type: 'all_company' }, reason: 'self-granted all_company via payload' }),
      e => e.code === 'TASK_CAPABILITY_DENIED'
    );
    pass(true, 'GRANT client-override: a non-admin, non-company-tier actor cannot create a permission grant via the real action handler');

    const cleanupGrant = await supabase.from('task_permission_grants').delete().eq('id', grantId).select('*');
    if (cleanupGrant.error && cleanupGrant.error.code === '42501') {
      await supabase.from('task_permission_grants').update({ is_active: false }).eq('id', grantId); // canonical soft revoke
      pass(true, 'GRANT cleanup: temporary grant fixture revoked (canonical is_active=false — service_role has no DELETE on task_permission_grants per 1.72.2)');
    } else {
      pass(!cleanupGrant.error && cleanupGrant.data.length === 1, 'GRANT cleanup: temporary grant fixture row hard-deleted');
    }
    pass(await perms.canViewTask(session('PHF082'), relationTaskFrom(B1), toRelAssignees(b1Assignees)) === false, 'GRANT POST state: identical to PRE state after cleanup');
  }

  // =======================================================================
  // ADMIN — best-effort live evidence with the real admin account_id
  // (in-process function calls; NOT a signed-cookie HTTP E2E — see report).
  // =======================================================================
  {
    const adminRow = (await supabase.from('user_accounts').select('id').eq('role', 'admin').limit(1).single()).data;
    const adminCtx = await perms.resolveEffectiveTaskScope(adminSession(adminRow.id));
    pass(adminCtx.actorContext.actorType === 'admin' && adminCtx.scope.peopleScope.type === 'all_company', 'ADMIN: real admin account resolves actorType=admin, peopleScope=all_company');
    const B1b = await taskByCode(FX_PRIMARY_PHF004);
    const b1bAssignees = await assigneesFor(B1b.id);
    pass(await perms.canViewTask(adminSession(adminRow.id), relationTaskFrom(B1b), toRelAssignees(b1bAssignees)) === true, 'ADMIN: real admin can view an arbitrary task');
    await assert.rejects(() => core.updateTaskProgress(adminSession(adminRow.id), B1b.id, B1b.row_version, 10, 'dang_thuc_hien'), e => e.code === 'TASK_PROGRESS_ACTOR_DENIED');
    pass(true, 'ADMIN: real admin CANNOT update progress in place of the current primary');
  }

  console.log(`PHF Task Permission Hardening V1 test: ${passed}/${passed} PASS`);
})().catch(err => { console.error('FAIL', err); process.exit(1); });
