'use strict';
/*
 * Regression — Recovery Center "Thiếu assignment" false positive (2026-09-13, PHF093).
 *
 * PROD case: PHF093 has a valid CURRENT assignment (checklist_employee_assignments) effective
 * 2026-09-01 with template_id=mktvideo3-1-nhan-vien-mkt-video / template_version=MKTVIDEO3-1-1.1
 * — but also a checklist_employee_assignment_history row dated 2026-09-11 (still <= the
 * September period end) with template_id='' / template_version='' (a blank/transitional state,
 * whose previous_data also carries the blank state). assignmentSnapshotsAt()'s old comparator
 * sorted candidates by effective_date DESC first, then _source_rank — so the later-dated, blank
 * HISTORY row outranked the genuinely-valid CURRENT row for the "as of period end" snapshot,
 * and Recovery Center (api/_lib/checklist-recovery.js inspectMonthlyRecovery) reported her as
 * "Thiếu assignment" despite the real assignment being completely valid.
 *
 * Fix: resolveAssignmentSnapshots() (extracted pure core of assignmentSnapshotsAt(), no DB
 * calls) now sorts by _source_rank DESC FIRST (current=3 > history=2 > previous_data=1), and
 * only uses effective_date (then _changed_at) to break ties WITHIN the same rank. Since add()
 * already excludes any candidate whose effective_date > cutoffDate before it ever reaches the
 * pool, a current-table row always wins once it is itself effective by the cutoff — exactly
 * matching "current-table assignment must take precedence over history whenever the current row
 * is effective by cutoff". When the current row is NOT yet effective as of an earlier cutoff, it
 * is excluded from the pool entirely (unchanged), so legitimate historical reconstruction from
 * older cutoffs is preserved.
 *
 * This test calls the REAL exported resolveAssignmentSnapshots() directly (in-memory, no
 * Supabase) with rows shaped exactly like PHF093's real PROD case.
 *
 *   node scripts/test-checklist-recovery-assignment-shadow-2026-09.js
 */
const assert = require('assert');
const { resolveAssignmentSnapshots } = require('../api/_lib/checklist-monthly');

let passed = 0, failures = 0;
function check(name, fn) {
  try { fn(); console.log('PASS: ' + name); passed++; }
  catch (e) { failures++; console.error('FAIL: ' + name + '\n  ' + (e && e.message ? e.message : e)); }
}

function currentRow(overrides) {
  return Object.assign({
    employee_key: 'phf093', employee_id: 'EMP093', employee_code: 'PHF093', employee_name: 'Nguyễn Vương Thu Minh',
    department: 'Marketing', title: 'Nhân viên MKT Video', branch: '', manager_id: '', manager_code: '', manager_name: '',
    employee_status: 'Đang làm việc', template_id: 'mktvideo3-1-nhan-vien-mkt-video', template_version: 'MKTVIDEO3-1-1.1',
    effective_date: '2026-09-01', reason: 'gán mẫu theo vị trí', updated_at: '2026-09-01T02:00:00.000Z'
  }, overrides || {});
}
function blankHistoryRow(overrides) {
  return Object.assign({
    employee_key: 'phf093', employee_id: 'EMP093', employee_code: 'PHF093', employee_name: 'Nguyễn Vương Thu Minh',
    department: 'Marketing', title: '', branch: '', manager_id: '', manager_code: '', manager_name: '',
    employee_status: 'Đang làm việc', template_id: '', template_version: '',
    effective_date: '2026-09-11', changed_at: '2026-09-11T03:00:00.000Z',
    previous_data: { employee_key: 'phf093', employee_code: 'PHF093', template_id: '', template_version: '', effective_date: '2026-09-11', employee_status: 'Đang làm việc' }
  }, overrides || {});
}

// -----------------------------------------------------------------------
// 1) THE PROD CASE — current assignment effective 2026-09-01 with a stale BLANK history row
//    effective 2026-09-11 (still <= period end). Current assignment must win.
// -----------------------------------------------------------------------
check('current assignment (2026-09-01, valid template) beats stale blank history (2026-09-11) for September recovery — the exact PHF093 PROD case', () => {
  const snapshots = resolveAssignmentSnapshots(
    [currentRow()],
    [blankHistoryRow()],
    '2026-09-30' // cutoff = end of September period
  );
  const phf093 = snapshots.find(s => s.employee_code === 'PHF093');
  assert.ok(phf093, 'PHF093 snapshot resolved');
  assert.strictEqual(phf093.template_id, 'mktvideo3-1-nhan-vien-mkt-video', 'winning snapshot is the CURRENT valid assignment, not the blank history row');
  assert.strictEqual(phf093.template_version, 'MKTVIDEO3-1-1.1');
  assert.strictEqual(phf093._source_rank, 3, 'winning candidate is source_rank 3 (current table)');
});

// -----------------------------------------------------------------------
// 2) Cutoff BEFORE the current assignment's own effective date — the current row is not yet
//    effective as of that cutoff (excluded by add()'s existing filter), so a legitimate earlier
//    history row may still win. Historical reconstruction must be preserved.
// -----------------------------------------------------------------------
check('cutoff before current assignment effective date -> current row excluded (not yet effective), earlier history legitimately wins', () => {
  const earlierHistory = blankHistoryRow({
    template_id: 'nv-marketing', template_version: 'NV-MKT-1.0', // a real earlier assignment, not blank, for contrast
    effective_date: '2026-08-01', changed_at: '2026-08-01T01:00:00.000Z',
    previous_data: null
  });
  const snapshots = resolveAssignmentSnapshots(
    [currentRow()], // effective 2026-09-01 — NOT yet effective as of an August cutoff
    [earlierHistory],
    '2026-08-31'
  );
  const phf093 = snapshots.find(s => s.employee_code === 'PHF093');
  assert.ok(phf093, 'a snapshot is still resolved from history for the earlier cutoff');
  assert.strictEqual(phf093.template_id, 'nv-marketing', 'the earlier, legitimate history row is used — current row correctly excluded because it is not effective yet as of this cutoff');
  assert.strictEqual(phf093._source_rank, 2);
});

// -----------------------------------------------------------------------
// 3) Same rank (multiple history rows, no current row) — the LATEST effective valid history row
//    still wins via the effective_date tie-break within that rank.
// -----------------------------------------------------------------------
check('same source rank, multiple history rows -> latest effective_date within that rank still wins', () => {
  const older = blankHistoryRow({ template_id: 'nv-marketing', template_version: 'NV-MKT-1.0', effective_date: '2026-09-02', changed_at: '2026-09-02T00:00:00.000Z', previous_data: null });
  const newer = blankHistoryRow({ template_id: 'nv-marketing', template_version: 'NV-MKT-1.1', effective_date: '2026-09-15', changed_at: '2026-09-15T00:00:00.000Z', previous_data: null });
  const snapshots = resolveAssignmentSnapshots([], [older, newer], '2026-09-30');
  const phf093 = snapshots.find(s => s.employee_code === 'PHF093');
  assert.ok(phf093);
  assert.strictEqual(phf093.template_version, 'NV-MKT-1.1', 'the later-dated history row within the same rank wins, not the older one');
});

// -----------------------------------------------------------------------
// 4) previous_data (rank 1) never outranks a real current row (rank 3), even with a much later
//    embedded date — same mechanism as case 1, isolated to the previous_data path specifically.
// -----------------------------------------------------------------------
check('previous_data embedded in a history row (rank 1) never outranks a valid current-table row (rank 3), regardless of its own effective_date', () => {
  const historyWithFarFutureIshPreviousData = {
    employee_key: 'phf093', employee_code: 'PHF093', employee_name: 'Nguyễn Vương Thu Minh',
    employee_status: 'Đang làm việc', template_id: 'nv-marketing', template_version: 'NV-MKT-1.0',
    effective_date: '2026-09-20', changed_at: '2026-09-20T00:00:00.000Z',
    previous_data: { employee_key: 'phf093', employee_code: 'PHF093', employee_status: 'Đang làm việc', template_id: '', template_version: '', effective_date: '2026-09-25' }
  };
  const snapshots = resolveAssignmentSnapshots([currentRow()], [historyWithFarFutureIshPreviousData], '2026-09-30');
  const phf093 = snapshots.find(s => s.employee_code === 'PHF093');
  assert.strictEqual(phf093._source_rank, 3);
  assert.strictEqual(phf093.template_id, 'mktvideo3-1-nhan-vien-mkt-video');
});

// -----------------------------------------------------------------------
// 5) No regression: an employee with ONLY a current row (no history at all) — the normal,
//    overwhelmingly common case — still resolves correctly.
// -----------------------------------------------------------------------
check('no regression: employee with only a current assignment row (no history) resolves normally', () => {
  const other = currentRow({ employee_key: 'phf200', employee_id: 'EMP200', employee_code: 'PHF200', template_id: 'nv-marketing', template_version: 'NV-MKT-1.0' });
  const snapshots = resolveAssignmentSnapshots([other], [], '2026-09-30');
  const s = snapshots.find(x => x.employee_code === 'PHF200');
  assert.ok(s);
  assert.strictEqual(s.template_id, 'nv-marketing');
});

// -----------------------------------------------------------------------
// 6) No regression: multiple different employees resolve independently (one shadowed case
//    doesn't affect another employee's resolution).
// -----------------------------------------------------------------------
check('no regression: multiple employees resolve independently — a shadowed case for one does not affect another', () => {
  const phf093Current = currentRow();
  const phf093StaleHistory = blankHistoryRow();
  const phf200Current = currentRow({ employee_key: 'phf200', employee_id: 'EMP200', employee_code: 'PHF200', template_id: 'nv-marketing', template_version: 'NV-MKT-1.0' });
  const snapshots = resolveAssignmentSnapshots([phf093Current, phf200Current], [phf093StaleHistory], '2026-09-30');
  assert.strictEqual(snapshots.length, 2);
  const phf093 = snapshots.find(s => s.employee_code === 'PHF093'), phf200 = snapshots.find(s => s.employee_code === 'PHF200');
  assert.strictEqual(phf093.template_id, 'mktvideo3-1-nhan-vien-mkt-video');
  assert.strictEqual(phf200.template_id, 'nv-marketing');
});

// -----------------------------------------------------------------------
// 7) No regression: a row with an invalid/malformed effective_date is still excluded entirely
//    (existing regex + cutoff guard in add() is untouched by this fix).
// -----------------------------------------------------------------------
check('no regression: malformed effective_date is still excluded from the candidate pool (add() guard unchanged)', () => {
  const malformed = currentRow({ employee_key: 'phf300', employee_id: 'EMP300', employee_code: 'PHF300', effective_date: '2026-09-01T00:00:00.000Z' });
  const snapshots = resolveAssignmentSnapshots([malformed], [], '2026-09-30');
  assert.strictEqual(snapshots.find(s => s.employee_code === 'PHF300'), undefined, 'a non-plain-date effective_date must still be rejected, exactly as before');
});

console.log('\n' + passed + ' PASS, ' + failures + ' FAIL');
if (failures > 0) process.exit(1);
