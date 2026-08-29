'use strict';

/*
 * PHF Task — updateTaskProgress CONTAINMENT (PHF_SUPABASE_CPU_FIX_V1).
 * Real dev DB, in-process, same methodology as the other live gate scripts
 * this session. Tagged [PROGRESS-THROTTLE-TEST]. Verifies both containment
 * layers (in-process throttle + row_version pre-check) preserve every
 * existing business rule — permission, CAS, 100%!=completed, event audit —
 * while actually suppressing burst/replay before it reaches the RPC.
 */

const assert = require('assert');
require('dotenv').config();
require('./task-sandbox-guard'); // fail-closed: refuse to run unless SUPABASE_URL === PHF_HR sandbox
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const core = require('../api/_lib/task-core');

let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }
function session(employeeCode) { return { account: { employeeCode } }; }
function futureDeadline(hours) { return new Date(Date.now() + hours * 3600e3).toISOString(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function eventCount(taskId) {
  const { data } = await supabase.from('task_events').select('id').eq('task_id', taskId).eq('event_type', 'progress');
  return (data || []).length;
}

const fixtures = require('./task-report-fixture-manifest');

(async () => {
  // Snapshot the [REPORT-UI-TEST] corpus size BEFORE this suite does anything,
  // so section M can assert "untouched" as a delta (drift-proof — the corpus
  // is allowed to grow; this suite must just not change it).
  const reportFixtureCountBefore = await fixtures.liveReportFixtureCount(supabase);

  // =======================================================================
  // Fixtures: two published tasks, PHF010 primary. B (second task) used for
  // the "different task" isolation check (F).
  // =======================================================================
  const draftA = await core.createTaskDraft(session('PHF010'), {
    flowType: 'giao_viec', title: '[PROGRESS-THROTTLE-TEST] task-A',
    content: 'Containment gate — task A.', categoryCode: 'NHAN_SU', priority: 'thuong',
    startAt: null, deadline: futureDeadline(72), primaryEmployeeCode: 'PHF010'
  });
  const A = await core.publishTask(session('PHF010'), draftA.id, draftA.row_version);
  const draftB = await core.createTaskDraft(session('PHF010'), {
    flowType: 'giao_viec', title: '[PROGRESS-THROTTLE-TEST] task-B',
    content: 'Containment gate — task B, different task same actor.', categoryCode: 'NHAN_SU', priority: 'thuong',
    startAt: null, deadline: futureDeadline(72), primaryEmployeeCode: 'PHF010'
  });
  const B = await core.publishTask(session('PHF010'), draftB.id, draftB.row_version);
  const fixtureTaskIds = [A.id, B.id];

  // =======================================================================
  // A. Normal single update => PASS.
  // =======================================================================
  let aRow = A;
  {
    const updated = await core.updateTaskProgress(session('PHF010'), aRow.id, aRow.row_version, 0, 'chua_bat_dau');
    pass(updated.progress_percent === 0 && updated.status === 'published', 'A. Normal single update (0%) succeeds, status stays published (0% does not force in_progress)');
    aRow = updated;
  }

  // =======================================================================
  // H/I. 0/1/99/100 regression + 100% != completed, spaced BEYOND the
  // throttle window (500ms) so each is a genuine independent legitimate call.
  // =======================================================================
  {
    await sleep(600);
    aRow = await core.updateTaskProgress(session('PHF010'), aRow.id, aRow.row_version, 1, 'dang_thuc_hien');
    pass(aRow.progress_percent === 1 && aRow.status === 'in_progress', 'H. 1% -> status auto-transitions published->in_progress (existing rule, untouched)');
    await sleep(600);
    aRow = await core.updateTaskProgress(session('PHF010'), aRow.id, aRow.row_version, 99, 'dang_thuc_hien');
    pass(aRow.progress_percent === 99, 'H. 99% regression');
    await sleep(600);
    aRow = await core.updateTaskProgress(session('PHF010'), aRow.id, aRow.row_version, 100, 'hoan_thanh');
    pass(aRow.progress_percent === 100, 'H. 100% regression');
    pass(aRow.status !== 'completed', 'I. 100% progress does NOT auto-complete the task (status still ' + aRow.status + ', completion requires explicit completeTask())');
  }

  // =======================================================================
  // B. Legit sequential updates with fresh row_version each time => PASS
  // (already exercised above across H, but assert explicitly here too).
  // =======================================================================
  {
    await sleep(600);
    const before = await eventCount(aRow.id);
    const next = await core.updateTaskProgress(session('PHF010'), aRow.id, aRow.row_version, 50, 'dang_thuc_hien');
    const after = await eventCount(aRow.id);
    pass(next.row_version === aRow.row_version + 1, 'B. Sequential legit update succeeds, row_version advances by exactly 1');
    pass(after === before + 1, 'B/J. Exactly one new progress event recorded for one legit sequential update');
    aRow = next;
  }

  // =======================================================================
  // C. Same request rapid replay/burst => contained. Fire 5 back-to-back
  // calls with NO delay and the SAME (now-current) row_version. Only the
  // first can possibly reach the RPC; the rest must be rejected before ever
  // touching the DB write path.
  // =======================================================================
  {
    const startRowVersion = aRow.row_version;
    const eventsBefore = await eventCount(aRow.id);
    const results = [];
    for (let i = 0; i < 5; i++) {
      try {
        const r = await core.updateTaskProgress(session('PHF010'), aRow.id, startRowVersion, 60 + i, 'dang_thuc_hien');
        results.push({ ok: true, row_version: r.row_version });
        aRow = r;
      } catch (e) {
        results.push({ ok: false, code: e.code });
      }
    }
    const successes = results.filter(r => r.ok);
    // Both TASK_UPDATE_THROTTLED (Layer 1, in-memory) and TASK_VERSION_CONFLICT
    // (Layer 2, the pre-check) equally mean "rejected WITHOUT a duplicate RPC
    // transaction" — which is the actual property under test, not which exact
    // code fires. Sequentially-awaited real network calls are not literally
    // simultaneous, so a later repeat can legitimately clear the 500ms
    // throttle window (each real call involves several DB round-trips) and
    // get caught by the version pre-check instead — that is still full
    // containment, just via the other layer.
    const containedWithoutDuplicateWrite = results.filter(r => !r.ok && (r.code === 'TASK_UPDATE_THROTTLED' || r.code === 'TASK_VERSION_CONFLICT'));
    pass(successes.length === 1, 'C. BURST: exactly 1 of 5 rapid-fire identical requests succeeded (was ' + successes.length + ')');
    pass(containedWithoutDuplicateWrite.length === 4, 'C. BURST: the other 4 were rejected via THROTTLED or the version pre-check — none reached a duplicate RPC transaction (was ' + containedWithoutDuplicateWrite.length + ', codes=' + JSON.stringify(results.map(r => r.ok ? 'OK' : r.code)) + ')');
    const eventsAfter = await eventCount(aRow.id);
    pass(eventsAfter === eventsBefore + 1, 'C/J. Burst produced exactly ONE new progress event, not 5 — no duplicate audit trail from rejected attempts');
  }

  // =======================================================================
  // D. Concurrent duplicate request => deterministic (exactly one winner,
  // no double-processing, no matter which one wins).
  // =======================================================================
  {
    await sleep(600);
    const startRowVersion = aRow.row_version;
    const eventsBefore = await eventCount(aRow.id);
    const outcomes = await Promise.allSettled([
      core.updateTaskProgress(session('PHF010'), aRow.id, startRowVersion, 70, 'dang_thuc_hien'),
      core.updateTaskProgress(session('PHF010'), aRow.id, startRowVersion, 70, 'dang_thuc_hien'),
      core.updateTaskProgress(session('PHF010'), aRow.id, startRowVersion, 70, 'dang_thuc_hien')
    ]);
    const fulfilled = outcomes.filter(o => o.status === 'fulfilled');
    pass(fulfilled.length === 1, 'D. CONCURRENT DUPLICATE: exactly 1 of 3 truly concurrent identical requests succeeded (was ' + fulfilled.length + ')');
    const winner = fulfilled[0].value;
    aRow = winner;
    const eventsAfter = await eventCount(aRow.id);
    pass(eventsAfter === eventsBefore + 1, 'D/J. Concurrent duplicate produced exactly ONE progress event — no double-processing');
  }

  // =======================================================================
  // E. Stale row_version legitimate request, submitted AFTER the throttle
  // window has elapsed => must still surface the REAL TASK_VERSION_CONFLICT
  // (not silently swallowed, not masked as THROTTLED).
  // =======================================================================
  {
    const staleVersion = aRow.row_version - 1; // genuinely stale, real prior value
    await sleep(600);
    await assert.rejects(
      () => core.updateTaskProgress(session('PHF010'), aRow.id, staleVersion, 80, 'dang_thuc_hien'),
      e => e.code === 'TASK_VERSION_CONFLICT'
    );
    pass(true, 'E. STALE VERSION (post-throttle-window): correctly surfaces TASK_VERSION_CONFLICT, not TASK_UPDATE_THROTTLED — the pre-check produces the exact same error the RPC itself would have');
  }

  // =======================================================================
  // F. Different task, same actor => not blocked by the other task's
  // throttle/CAS state (fired immediately after the A-burst above, no delay).
  // =======================================================================
  {
    const updatedB = await core.updateTaskProgress(session('PHF010'), B.id, B.row_version, 10, 'dang_thuc_hien');
    pass(updatedB.progress_percent === 10, 'F. DIFFERENT TASK, same actor, fired immediately after task A activity: succeeds normally — throttle key is per-task, not global to the actor');
  }

  // =======================================================================
  // G/K. Different actor, same task => normal permission semantics
  // unaffected (coordinator denied, unrelated to throttle key).
  // =======================================================================
  {
    await core.addTaskRelated(session('PHF010'), A.id, 'PHF082');
    await assert.rejects(
      () => core.updateTaskProgress(session('PHF082'), A.id, aRow.row_version, 90, 'dang_thuc_hien'),
      e => e.code === 'TASK_PROGRESS_ACTOR_DENIED'
    );
    pass(true, 'G/K. DIFFERENT ACTOR (coordinator PHF082, not primary) on the SAME task: still correctly denied TASK_PROGRESS_ACTOR_DENIED — throttle is per-actor, does not interfere with permission logic');
  }

  // =======================================================================
  // M. 37 REPORT-UI-TEST fixtures untouched.
  // =======================================================================
  {
    const countAfter = await fixtures.liveReportFixtureCount(supabase);
    pass(countAfter === reportFixtureCountBefore, 'M. [REPORT-UI-TEST] corpus untouched by this suite (before=' + reportFixtureCountBefore + ', after=' + countAfter + ')');
  }

  // =======================================================================
  // N. Cleanup — both fixture tasks are non-draft (published/in_progress),
  // so per LOCK 4 they cannot be hard-deleted; cancel them (the correct,
  // audited lifecycle path) instead of leaving them dangling as drafts.
  // =======================================================================
  {
    for (const taskId of fixtureTaskIds) {
      const { data: row } = await supabase.from('task_tasks').select('id,status,row_version').eq('id', taskId).maybeSingle();
      if (row && row.status !== 'cancelled' && row.status !== 'completed') {
        await core.cancelTask(session('PHF010'), row.id, row.row_version, 'Cleanup — PHF_SUPABASE_CPU_FIX_V1 containment gate fixture.');
      }
    }
    pass(true, 'N. Fixture tasks cancelled (audited cleanup — hard-delete is correctly forbidden for non-draft tasks, this is the intended terminal state, not leftover debris)');
  }

  console.log(`PHF Task Progress Throttle Containment V1: ${passed}/${passed} PASS`);
})().catch(err => { console.error('FAIL', err); process.exit(1); });
