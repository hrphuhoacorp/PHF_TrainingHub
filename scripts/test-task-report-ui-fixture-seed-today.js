'use strict';

/*
 * PHF Task — REPORT UI REVIEW FIXTURE SEED (TODAY-SAFE) — TEST FIXTURE
 * CREATION ONLY. Every fixture created by this script uses ONLY real
 * legitimate write-path functions from api/_lib/task-core.js (same RPCs the
 * production UI calls) — no direct INSERT/UPDATE into business tables, no
 * timestamp manipulation, no RLS/trigger bypass.
 *
 * ACCEPTED LIMITATION (locked by the previous HOLD gate,
 * PHF_TASK_REPORT_UI_REVIEW_FIXTURE_SEED): created_at/published_at/
 * completed_at/cancelled_at/last_progress_at/task_events.occurred_at are all
 * DB-column `default now()` with NO RPC parameter to override them anywhere
 * in scripts/PHF_TASK_CORE_RPC_1.67.0.sql. So every fixture here lands on
 * TODAY (~2026-08-25). This script does NOT attempt a multi-month spread and
 * does NOT attempt genuine >7-day "stale" fixtures — both explicitly
 * deferred, not silently faked.
 *
 * Every task title carries the "[REPORT-UI-TEST]" marker for exact later
 * cleanup. Runs strictly sequentially (no Promise.all fixture storm) per the
 * Supabase load guard.
 */

require('dotenv').config();
require('./task-sandbox-guard'); // fail-closed: refuse to run unless SUPABASE_URL === PHF_HR sandbox
const path = require('path');
const core = require(path.join(__dirname, '..', 'api', '_lib', 'task-core'));

const MARKER = '[REPORT-UI-TEST]';
const CREATOR_MAIN = 'PHF010';   // Ban giám đốc, TRO_LY_GD preset — broad assign scope
const CREATOR_CROSSDEPT2 = 'PHF002'; // Ban giám đốc, GIAM_DOC preset — used for the 2nd cross-dept case for creator variety
const PERSON_A = 'PHF082'; // Bộ phận Quản trị tổng hợp — moderate workload, mostly on-time
const PERSON_B = 'PHF004'; // Ban giám đốc — higher workload, mix overdue/late
const PERSON_C = 'PHF012'; // Bộ phận Quản trị tổng hợp — own primary tasks + coordinator participation
const PERSON_D = 'PHF010'; // self-task heavy (same account as CREATOR_MAIN)

function session(employeeCode) { return { account: { employeeCode } }; }
function hoursFromNow(h) { return new Date(Date.now() + h * 3600e3).toISOString(); }
function daysFromNow(d) { return hoursFromNow(d * 24); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// -----------------------------------------------------------------------
// 36-fixture PRE-SEED PLAN (see gate report for the full rationale) — every
// bucket below is mutually exclusive by final lifecycle state, deliberately
// distributed across category/person/self-task/coordinator/cross-dept.
// -----------------------------------------------------------------------
const FIXTURES = [
  // ---- A. COMPLETED ON TIME (6) ----
  { id: 'A1', category: 'KINH_DOANH', creator: CREATOR_MAIN, primary: PERSON_A, deadlineHours: 48, finalState: 'completed_on_time' },
  { id: 'A2', category: 'KINH_DOANH', creator: CREATOR_MAIN, primary: PERSON_D, deadlineHours: 72, finalState: 'completed_on_time', selfTask: true },
  { id: 'A3', category: 'CHAM_SOC_KHACH_HANG', creator: CREATOR_MAIN, primary: PERSON_C, deadlineHours: 24, finalState: 'completed_on_time', selfTask: true },
  { id: 'A4', category: 'CHAM_SOC_KHACH_HANG', creator: CREATOR_MAIN, primary: PERSON_A, deadlineHours: 120, finalState: 'completed_on_time', coordinators: [PERSON_C], crossDept: true },
  { id: 'A5', category: 'BAO_CAO', creator: CREATOR_MAIN, primary: PERSON_B, deadlineHours: 96, finalState: 'completed_on_time', coordinators: [PERSON_C, PERSON_A] },
  { id: 'A6', category: 'BAO_CAO', creator: CREATOR_MAIN, primary: PERSON_B, deadlineHours: 72, finalState: 'transfer_complete_on_time', transferTo: PERSON_C },
  // ---- B. COMPLETED LATE (4) ----
  { id: 'B1', category: 'NHAN_SU', creator: CREATOR_MAIN, primary: PERSON_B, deadlineHours: -1, finalState: 'completed_late' },
  { id: 'B2', category: 'NHAN_SU', creator: CREATOR_MAIN, primary: PERSON_A, deadlineHours: -2, finalState: 'completed_late' },
  { id: 'B3', category: 'DAO_TAO', creator: CREATOR_MAIN, primary: PERSON_C, deadlineHours: -3, finalState: 'completed_late', coordinators: [PERSON_A] },
  { id: 'B4', category: 'DAO_TAO', creator: CREATOR_MAIN, primary: PERSON_B, deadlineHours: -0.5, finalState: 'completed_late' },
  // ---- C. COMPLETE -> REOPEN -> COMPLETE (2) ----
  { id: 'C1', category: 'DAO_TAO', creator: CREATOR_MAIN, primary: PERSON_A, deadlineHours: 24, finalState: 'reopen_complete_once' },
  { id: 'C2', category: 'KHO_VAN', creator: CREATOR_MAIN, primary: PERSON_B, deadlineHours: -1, finalState: 'reopen_complete_multiple' },
  // ---- D. COMPLETE -> REOPEN -> CANCEL (1) ----
  { id: 'D1', category: 'KHO_VAN', creator: CREATOR_MAIN, primary: PERSON_C, deadlineHours: 48, finalState: 'reopen_cancel' },
  // ---- E. CANCELLED, no prior completion (2) ----
  { id: 'E1', category: 'KHO_VAN', creator: CREATOR_MAIN, primary: PERSON_A, deadlineHours: 72, finalState: 'cancelled' },
  { id: 'E2', category: 'THU_MUA', creator: CREATOR_MAIN, primary: PERSON_D, deadlineHours: 72, finalState: 'cancelled', selfTask: true },
  // ---- F. CURRENTLY OVERDUE (6: 3 published@0%, 3 in_progress) ----
  { id: 'F1', category: 'THU_MUA', creator: CREATOR_MAIN, primary: PERSON_A, deadlineHours: -24, finalState: 'active_not_started' },
  { id: 'F2', category: 'THU_MUA', creator: CREATOR_CROSSDEPT2, primary: PERSON_A, deadlineHours: -48, finalState: 'active_not_started', crossDept: true },
  { id: 'F3', category: 'TAI_CHINH', creator: CREATOR_MAIN, primary: PERSON_C, deadlineHours: -12, finalState: 'active_not_started' },
  { id: 'F4', category: 'TAI_CHINH', creator: CREATOR_MAIN, primary: PERSON_A, deadlineHours: -6, finalState: 'active_in_progress', progress: 20, selfTask: false },
  { id: 'F5', category: 'DU_AN', creator: CREATOR_MAIN, primary: PERSON_B, deadlineHours: -72, finalState: 'active_in_progress', progress: 40, coordinators: [PERSON_C] },
  { id: 'F6', category: 'DU_AN', creator: CREATOR_MAIN, primary: PERSON_C, deadlineHours: -5, finalState: 'active_in_progress', progress: 60 },
  // ---- G. DUE SOON (5: 2 published@0%, 3 in_progress) ----
  { id: 'G1', category: 'CONG_VIEC_TONG_THE', creator: CREATOR_MAIN, primary: PERSON_A, deadlineHours: 24, finalState: 'active_not_started' },
  { id: 'G2', category: 'KINH_DOANH', creator: CREATOR_MAIN, primary: PERSON_B, deadlineHours: 48, finalState: 'active_not_started' },
  { id: 'G3', category: 'KINH_DOANH', creator: CREATOR_MAIN, primary: PERSON_C, deadlineHours: 24, finalState: 'active_in_progress', progress: 30 },
  { id: 'G4', category: 'KINH_DOANH', creator: CREATOR_MAIN, primary: PERSON_A, deadlineHours: 48, finalState: 'active_in_progress', progress: 50, coordinators: [PERSON_C] },
  { id: 'G5', category: 'KINH_DOANH', creator: CREATOR_MAIN, primary: PERSON_B, deadlineHours: 72, finalState: 'active_in_progress', progress: 70 },
  // ---- H. IN-PROGRESS MID-RANGE, not overdue/due-soon (4) ----
  { id: 'H1', category: 'KINH_DOANH', creator: CREATOR_MAIN, primary: PERSON_A, deadlineHours: 240, finalState: 'active_in_progress', progress: 25 },
  { id: 'H2', category: 'CHAM_SOC_KHACH_HANG', creator: CREATOR_MAIN, primary: PERSON_B, deadlineHours: 192, finalState: 'active_in_progress', progress: 50 },
  { id: 'H3', category: 'CHAM_SOC_KHACH_HANG', creator: CREATOR_MAIN, primary: PERSON_C, deadlineHours: 288, finalState: 'active_in_progress', progress: 75 },
  { id: 'H4', category: 'CHAM_SOC_KHACH_HANG', creator: CREATOR_MAIN, primary: PERSON_D, deadlineHours: 216, finalState: 'active_in_progress', progress: 60, selfTask: true },
  // ---- I. PUBLISHED, not started (5) ----
  { id: 'I1', category: 'NHAN_SU', creator: CREATOR_MAIN, primary: PERSON_A, deadlineHours: 360, finalState: 'active_not_started' },
  { id: 'I2', category: 'BAO_CAO', creator: CREATOR_MAIN, primary: PERSON_B, deadlineHours: 432, finalState: 'active_not_started' },
  { id: 'I3', category: 'BAO_CAO', creator: CREATOR_MAIN, primary: PERSON_C, deadlineHours: 480, finalState: 'active_not_started' },
  { id: 'I4', category: 'BAO_CAO', creator: CREATOR_MAIN, primary: PERSON_D, deadlineHours: 336, finalState: 'active_not_started', selfTask: true },
  { id: 'I5', category: 'NHAN_SU', creator: CREATOR_MAIN, primary: PERSON_A, deadlineHours: 408, finalState: 'active_not_started' },
  // ---- J. PROGRESS=100% BUT NOT COMPLETED (1) — critical Report semantic check ----
  { id: 'J1', category: 'KINH_DOANH', creator: CREATOR_MAIN, primary: PERSON_A, deadlineHours: 144, finalState: 'active_in_progress', progress: 100 },
  // ---- K. DRAFT, never published (1) — proves drafts stay excluded from reports ----
  { id: 'K1', category: 'KINH_DOANH', creator: CREATOR_MAIN, primary: PERSON_A, deadlineHours: 168, finalState: 'draft' }
];

async function createPublished(spec) {
  const draft = await core.createTaskDraft(session(spec.creator), {
    flowType: 'giao_viec',
    title: MARKER + ' ' + spec.id + ' — Report UI review fixture',
    content: 'Fixture nội bộ phục vụ review PHF Task Report Dashboard (' + spec.id + '). Không phải công việc thật.',
    categoryCode: spec.category,
    priority: 'thuong',
    startAt: null,
    deadline: hoursFromNow(spec.deadlineHours),
    primaryEmployeeCode: spec.primary
  });
  const published = await core.publishTask(session(spec.creator), draft.id, draft.row_version);
  return published;
}

async function addCoordinators(spec, taskRow) {
  let row = taskRow;
  for (const coordCode of (spec.coordinators || [])) {
    await core.addTaskRelated(session(spec.creator), row.id, coordCode);
    row = await core.getTaskDetail(session(spec.creator), row.id).then(d => d.task);
  }
  return row;
}

async function progressActor(spec, taskRow, percent) {
  const primaryCode = taskRow.__currentPrimary || spec.primary;
  const updated = await core.updateTaskProgress(session(primaryCode), taskRow.id, taskRow.row_version, percent, percent >= 100 ? 'dang_thuc_hien' : 'dang_thuc_hien');
  updated.__currentPrimary = primaryCode;
  return updated;
}
async function completeActor(spec, taskRow, resultText) {
  const primaryCode = taskRow.__currentPrimary || spec.primary;
  const updated = await core.completeTask(session(primaryCode), taskRow.id, taskRow.row_version, resultText || 'Hoàn thành fixture review.');
  updated.__currentPrimary = primaryCode;
  return updated;
}
async function reopenActor(spec, taskRow, reason) {
  const updated = await core.reopenTask(session(spec.creator), taskRow.id, taskRow.row_version, reason || 'Reopen fixture review.');
  updated.__currentPrimary = taskRow.__currentPrimary || spec.primary;
  return updated;
}
async function cancelActor(spec, taskRow, reason) {
  return core.cancelTask(session(spec.creator), taskRow.id, taskRow.row_version, reason || 'Cancel fixture review.');
}

async function driveFixture(spec) {
  if (spec.finalState === 'draft') {
    // Never published — proves drafts stay excluded from report population.
    const draft = await core.createTaskDraft(session(spec.creator), {
      flowType: 'giao_viec',
      title: MARKER + ' ' + spec.id + ' — Report UI review fixture (draft)',
      content: 'Fixture nội bộ (' + spec.id + ') — bản nháp, không publish.',
      categoryCode: spec.category,
      priority: 'thuong',
      startAt: null,
      deadline: hoursFromNow(spec.deadlineHours),
      primaryEmployeeCode: spec.primary
    });
    return { id: draft.id, task_code: draft.task_code, status: draft.status, row_version: draft.row_version };
  }
  let row = await createPublished(spec);
  row.__currentPrimary = spec.primary;
  row = await addCoordinators(spec, row);
  row.__currentPrimary = spec.primary;

  switch (spec.finalState) {
    case 'completed_on_time':
    case 'completed_late':
      row = await completeActor(spec, row);
      break;
    case 'transfer_complete_on_time': {
      row = await core.transferTaskPrimary(session(spec.creator), row.id, row.row_version, spec.transferTo, 'Transfer fixture review — chuyển người phụ trách để kiểm tra person-performance attribution.');
      row.__currentPrimary = spec.transferTo;
      row = await completeActor(spec, row);
      break;
    }
    case 'reopen_complete_once':
      row = await completeActor(spec, row);
      row = await reopenActor(spec, row);
      row = await completeActor(spec, row, 'Hoàn thành lại sau reopen (fixture).');
      break;
    case 'reopen_complete_multiple':
      row = await completeActor(spec, row);
      row = await reopenActor(spec, row);
      row = await completeActor(spec, row, 'Hoàn thành lại lần 2 (fixture).');
      row = await reopenActor(spec, row);
      row = await completeActor(spec, row, 'Hoàn thành lại lần 3 (fixture).');
      break;
    case 'reopen_cancel':
      row = await completeActor(spec, row);
      row = await reopenActor(spec, row);
      row = await cancelActor(spec, row);
      break;
    case 'cancelled':
      row = await cancelActor(spec, row);
      break;
    case 'active_not_started':
      // status stays 'published' — no progress call, deadline drives overdue/due-soon.
      break;
    case 'active_in_progress':
      row = await progressActor(spec, row, spec.progress);
      break;
    default:
      throw new Error('Unknown finalState: ' + spec.finalState);
  }
  return row;
}

function toRecord(spec, finalRow) {
  return { planId: spec.id, task_id: finalRow.id, task_code: finalRow.task_code, status: finalRow.status, finalState: spec.finalState, deadlineHours: spec.deadlineHours, category: spec.category, primary: spec.primary, creator: spec.creator, selfTask: !!spec.selfTask, coordinators: spec.coordinators || [], crossDept: !!spec.crossDept };
}

// ---------------------------------------------------------------------
// CANONICAL MANIFEST — single source of truth every Task report/progress
// regression reads from (scripts/task-report-fixture-manifest.js). Tests
// derive fixtures by ROLE from `plans` / `counts` / `semantic` — never a
// hard-coded CV-2608-00NN literal or a magic total count (task_code is
// DB-assigned; the corpus may grow).
// ---------------------------------------------------------------------
function writeManifest(created, failed) {
  const byFinalState = {}, byStatus = {}, byCategory = {}, plans = {};
  for (const c of created) {
    byFinalState[c.finalState] = (byFinalState[c.finalState] || 0) + 1;
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    byCategory[c.category] = (byCategory[c.category] || 0) + 1;
    plans[c.planId] = c;
  }
  const nonDraftCategoryCounts = {};
  for (const c of created) if (c.status !== 'draft') nonDraftCategoryCounts[c.category] = (nonDraftCategoryCounts[c.category] || 0) + 1;
  const largestCategory = Object.keys(nonDraftCategoryCounts).sort((a, b) => nonDraftCategoryCounts[b] - nonDraftCategoryCounts[a])[0] || null;
  const firstWith = pred => created.find(pred) || null;
  const semantic = {
    completedOnTime: firstWith(c => c.finalState === 'completed_on_time' && !c.coordinators.length && !c.selfTask),
    completedOnTimeSelfTask: firstWith(c => c.finalState === 'completed_on_time' && c.selfTask),
    completedOnTimeCoordinatorFanout: firstWith(c => c.finalState === 'completed_on_time' && c.coordinators.length >= 2),
    completedLate: firstWith(c => c.finalState === 'completed_late'),
    reopenedThenCompleted: firstWith(c => c.finalState === 'reopen_complete_once' || c.finalState === 'reopen_complete_multiple'),
    reopenedThenCancelled: firstWith(c => c.finalState === 'reopen_cancel'),
    cancelledNoPriorCompletion: firstWith(c => c.finalState === 'cancelled'),
    currentlyOverdue: firstWith(c => (c.status === 'published' || c.status === 'in_progress') && c.deadlineHours < 0),
    draft: firstWith(c => c.status === 'draft'),
    progress100NotCompleted: plans.J1 || null,
    transferredThenCompleted: firstWith(c => c.finalState === 'transfer_complete_on_time'),
  };
  require('fs').writeFileSync(
    path.join(__dirname, 'test-task-report-ui-fixture-seed-today.result.json'),
    JSON.stringify({ marker: MARKER, seededAt: new Date().toISOString(), counts: { created: created.length, failed: failed.length, byStatus, byFinalState, byCategory, nonDraftCategoryCounts, largestCategory }, semantic, plans, created, failed }, null, 2)
  );
  console.log('\nWrote scripts/test-task-report-ui-fixture-seed-today.result.json (canonical manifest: counts + semantic + plans)');
}

// Idempotent: matches already-seeded [REPORT-UI-TEST] rows to plans by the
// " <planId> — " marker in the title, only creates the MISSING plans, then
// rewrites the canonical manifest from the full set. Safe to re-run; never
// duplicates. `--rebuild-manifest-only` skips creation entirely.
async function main() {
  const manifestOnly = process.argv.includes('--rebuild-manifest-only');
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), { auth: { persistSession: false } });

  const { data: existingRows, error: exErr } = await supabase
    .from('task_tasks').select('id,task_code,status,title').ilike('title', '%' + MARKER + '%');
  if (exErr) throw new Error('existing-fixture query failed: ' + exErr.code + ' ' + exErr.message);
  const byPlan = new Map();
  for (const r of (existingRows || [])) {
    const m = /\]\s*([A-Z]\d+)\s*—/.exec(r.title);
    if (m && !byPlan.has(m[1])) byPlan.set(m[1], r);
  }
  console.log('Existing [REPORT-UI-TEST] rows: ' + (existingRows || []).length + '  (matched plans: ' + [...byPlan.keys()].sort().join(',') + ')');

  const created = [], failed = [];
  for (const spec of FIXTURES) {
    const hit = byPlan.get(spec.id);
    if (hit) { created.push(toRecord(spec, { id: hit.id, task_code: hit.task_code, status: hit.status })); continue; }
    if (manifestOnly) { failed.push({ planId: spec.id, reason: 'MISSING', message: 'not seeded and --rebuild-manifest-only set' }); continue; }
    try {
      const finalRow = await driveFixture(spec);
      created.push(toRecord(spec, finalRow));
      console.log('OK  ' + spec.id + '  ' + finalRow.task_code + '  status=' + finalRow.status);
    } catch (error) {
      failed.push({ planId: spec.id, reason: (error && error.code) || 'ERR', message: (error && error.message) || String(error) });
      console.log('FAIL ' + spec.id + '  ' + ((error && error.message) || error));
    }
    await sleep(120);
  }

  console.log('\n=== SEED SUMMARY ===  created/reused=' + created.length + '/' + FIXTURES.length + '  failed=' + failed.length);
  if (failed.length) console.log('FAILED:', JSON.stringify(failed, null, 2));
  writeManifest(created, failed);
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
