'use strict';

// PHF HR — PHASE B3: real-DB verify của 14 write operation trên phf_hr_verify.
//
// HARD SAFETY GUARD: script này CHỈ chạy nếu PHF_HR_DB_NAME=phf_hr_verify
// (exact match) — không có cách nào (kể cả lỗi thao tác) khiến script này
// vô tình ghi vào phf_hr thật. Không cần confirm tay gì thêm ngoài env var
// này, nhưng nếu env var sai/thiếu, script abort ngay dòng đầu, không chạm
// DB nào cả.
//
// Chạy: PHF_HR_DB_HOST=... PHF_HR_DB_PORT=5432 PHF_HR_DB_NAME=phf_hr_verify \
//       PHF_HR_DB_RUNTIME_USER=phf_hr_runtime PHF_HR_DB_RUNTIME_PASSWORD=... \
//       node phf-hr-verify-b3-14-ops-dev.js
//
// KHÔNG dùng .env của service thật — truyền env var trực tiếp trên dòng lệnh
// để không có nguy cơ .env bị đổi/nhầm.

if (process.env.PHF_HR_DB_NAME !== 'phf_hr_verify') {
  console.error(
    `ABORT: PHF_HR_DB_NAME phải đúng "phf_hr_verify" (hiện tại: "${process.env.PHF_HR_DB_NAME || '(trống)'}"). ` +
    `Script này CHỈ được phép chạy trên DB verify, không bao giờ trên phf_hr thật.`
  );
  process.exit(1);
}

const config = {
  PHF_HR_DB_HOST: process.env.PHF_HR_DB_HOST,
  PHF_HR_DB_PORT: Number(process.env.PHF_HR_DB_PORT || 5432),
  PHF_HR_DB_NAME: process.env.PHF_HR_DB_NAME,
  PHF_HR_DB_RUNTIME_USER: process.env.PHF_HR_DB_RUNTIME_USER,
  PHF_HR_DB_RUNTIME_PASSWORD: process.env.PHF_HR_DB_RUNTIME_PASSWORD,
};
for (const k of ['PHF_HR_DB_HOST', 'PHF_HR_DB_RUNTIME_USER', 'PHF_HR_DB_RUNTIME_PASSWORD']) {
  if (!config[k]) {
    console.error(`ABORT: thiếu env ${k}.`);
    process.exit(1);
  }
}

const tw = require('./lib/task-write');
const { withTaskReadTransaction } = require('./lib/db');

const RUN_TAG = `PHF_HR_DBVERIFY_${new Date().toISOString().replace(/[:.]/g, '-')}_${Math.random().toString(36).slice(2, 8)}`;

const ACTOR_EMP_A = { actorEmployeeCode: 'ZVERIFY-EMP-A', actorAccountId: null };
const ACTOR_EMP_B = { actorEmployeeCode: 'ZVERIFY-EMP-B', actorAccountId: null };
const ACTOR_ADMIN = { actorEmployeeCode: null, actorAccountId: `zverify-admin-${RUN_TAG}` };

const results = [];
function record(name, pass, expected, actual, extra) {
  results.push({ name, pass, expected, actual, extra });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`, { expected, actual, ...(extra || {}) });
}

async function main() {
  console.log(`RUN_TAG = ${RUN_TAG}`);
  // category_code CHECK constraint: chỉ chấp nhận [A-Z0-9_], KHÔNG có dấu gạch ngang
  let categoryCode = `ZVCAT_${RUN_TAG.replace(/-/g, '_')}`.slice(0, 30).toUpperCase();
  const fixtureTaskIds = []; // để cleanup cuối, mọi thứ phải end ở 'cancelled'

  // --- Fixture category (không dùng 13 category thật) ---
  const category = await tw.createTaskCategory(config, {
    categoryCode,
    displayName: `[${RUN_TAG}] Verify Category`,
    ...ACTOR_ADMIN,
  });
  record('setup_createTaskCategory', category.category_code === categoryCode, categoryCode, category.category_code);

  // ===== T1: create_draft(ADMIN) -> publish -> progress -> comment -> add_link(ADMIN)
  //          -> remove_link -> add_related(ADMIN) -> remove_related -> transfer_primary(ADMIN)
  //          -> change_deadline -> cancel(cleanup) =====
  const idemKey1 = `11111111-1111-1111-1111-${Date.now().toString().padStart(12, '0')}`.slice(0, 36);
  const FIXTURE_DEADLINE = '2099-06-30T00:00:00.000Z';
  let t1 = await tw.createDraftTask(config, {
    flowType: 'giao_viec',
    title: `[${RUN_TAG}] T1`,
    categoryCode,
    deadline: FIXTURE_DEADLINE,
    primaryEmployeeCode: ACTOR_EMP_A.actorEmployeeCode,
    idempotencyKey: idemKey1,
    ...ACTOR_ADMIN,
  });
  fixtureTaskIds.push(t1.id);
  record('1_createDraftTask', t1.status === 'draft', 'draft', t1.status);

  // Idempotency replay check
  const t1Replay = await tw.createDraftTask(config, {
    flowType: 'giao_viec',
    title: `[${RUN_TAG}] T1`,
    categoryCode,
    deadline: FIXTURE_DEADLINE,
    primaryEmployeeCode: ACTOR_EMP_A.actorEmployeeCode,
    idempotencyKey: idemKey1,
    ...ACTOR_ADMIN,
  });
  record('1b_createDraftTask_replay_no_duplicate', t1Replay.id === t1.id, t1.id, t1Replay.id);

  // Finding 1 check: primary assignee assigned_by_account_id phải khớp ACTOR_ADMIN
  const assigneesT1 = await withTaskReadTransaction(config, (c) =>
    c.query('select * from task.assignees where task_id = $1 and role = $2', [t1.id, 'primary'])
  );
  const primaryRow = assigneesT1.rows[0];
  record(
    '1c_FINDING1_createDraftTask_assigned_by_account_id',
    primaryRow && primaryRow.assigned_by_account_id === ACTOR_ADMIN.actorAccountId,
    ACTOR_ADMIN.actorAccountId,
    primaryRow && primaryRow.assigned_by_account_id
  );

  t1 = await tw.publishTask(config, {
    taskId: t1.id,
    expectedRowVersion: t1.row_version,
    sourceDepartment: `ZVERIFY-DEPT-SRC-${RUN_TAG}`.slice(0, 40),
    targetDepartment: `ZVERIFY-DEPT-DST-${RUN_TAG}`.slice(0, 40),
    ...ACTOR_EMP_A,
  });
  record('2_publishTask', t1.status === 'published', 'published', t1.status);

  t1 = await tw.updateTaskProgress(config, {
    taskId: t1.id,
    expectedRowVersion: t1.row_version,
    progressPercent: 40,
    progressStatus: 'dang_thuc_hien',
    ...ACTOR_EMP_A,
  });
  record('3_updateTaskProgress', t1.progress_percent === 40 && t1.status === 'in_progress', 40, t1.progress_percent);

  const comment = await tw.addTaskComment(config, { taskId: t1.id, body: `[${RUN_TAG}] comment`, ...ACTOR_EMP_B });
  record('4_addTaskComment', !!comment.id, 'row inserted', comment.id);

  const link = await tw.addTaskLink(config, {
    taskId: t1.id, side: 'coordination', url: `https://verify.local/${RUN_TAG}`, label: 'verify-link', ...ACTOR_ADMIN,
  });
  record('5_addTaskLink', !!link.id, 'row inserted', link.id);
  record(
    '5b_FINDING1_addTaskLink_added_by_account_id',
    link.added_by_account_id === ACTOR_ADMIN.actorAccountId,
    ACTOR_ADMIN.actorAccountId,
    link.added_by_account_id
  );

  await tw.removeTaskLink(config, { taskId: t1.id, linkId: link.id, ...ACTOR_EMP_A });
  const removeLinkEvent = await withTaskReadTransaction(config, (c) =>
    c.query(
      `select * from task.events where task_id=$1 and event_type='link' and payload->>'action'='remove' order by occurred_at desc limit 1`,
      [t1.id]
    )
  );
  record('6_removeTaskLink_event', removeLinkEvent.rowCount === 1, 1, removeLinkEvent.rowCount);

  const related = await tw.addTaskRelated(config, { taskId: t1.id, targetEmployeeCode: ACTOR_EMP_B.actorEmployeeCode, ...ACTOR_ADMIN });
  record('7_addTaskRelated', related.role === 'related' && related.is_active, true, related.is_active);
  record(
    '7b_FINDING1_addTaskRelated_assigned_by_account_id',
    related.assigned_by_account_id === ACTOR_ADMIN.actorAccountId,
    ACTOR_ADMIN.actorAccountId,
    related.assigned_by_account_id
  );

  await tw.removeTaskRelated(config, { taskId: t1.id, targetEmployeeCode: ACTOR_EMP_B.actorEmployeeCode, ...ACTOR_EMP_A });
  const relatedAfter = await withTaskReadTransaction(config, (c) =>
    c.query('select is_active from task.assignees where id=$1', [related.id])
  );
  record('8_removeTaskRelated', relatedAfter.rows[0].is_active === false, false, relatedAfter.rows[0].is_active);

  t1 = await tw.transferTaskPrimary(config, {
    taskId: t1.id, expectedRowVersion: t1.row_version, newPrimaryEmployeeCode: ACTOR_EMP_B.actorEmployeeCode,
    reason: `[${RUN_TAG}] verify transfer`, ...ACTOR_ADMIN,
  });
  const newPrimaryRow = await withTaskReadTransaction(config, (c) =>
    c.query(`select * from task.assignees where task_id=$1 and role='primary' and is_active=true`, [t1.id])
  );
  record('9_transferTaskPrimary', newPrimaryRow.rows[0].employee_code === ACTOR_EMP_B.actorEmployeeCode, ACTOR_EMP_B.actorEmployeeCode, newPrimaryRow.rows[0].employee_code);
  record(
    '9b_FINDING1_transferTaskPrimary_assigned_by_account_id',
    newPrimaryRow.rows[0].assigned_by_account_id === ACTOR_ADMIN.actorAccountId,
    ACTOR_ADMIN.actorAccountId,
    newPrimaryRow.rows[0].assigned_by_account_id
  );

  t1 = await tw.changeTaskDeadline(config, {
    taskId: t1.id, expectedRowVersion: t1.row_version, newDeadline: '2099-12-31T00:00:00.000Z', reason: `[${RUN_TAG}] verify deadline`, ...ACTOR_EMP_B,
  });
  record('10_changeTaskDeadline', new Date(t1.deadline).getUTCFullYear() === 2099, 2099, new Date(t1.deadline).getUTCFullYear());

  // ===== Permission assignment (độc lập, không gắn task) =====
  const perm = await tw.setTaskPermissionAssignment(config, {
    targetEmployeeCode: ACTOR_EMP_A.actorEmployeeCode,
    presetCode: 'NHAN_VIEN',
    reason: `[${RUN_TAG}] verify permission`,
    ...ACTOR_ADMIN,
  });
  record('11_setTaskPermissionAssignment', perm.is_active === true, true, perm.is_active);

  // ===== T2: create -> publish -> cancel =====
  t1 = await tw.cancelTask(config, { taskId: t1.id, expectedRowVersion: t1.row_version, reason: `[${RUN_TAG}] cleanup T1`, ...ACTOR_EMP_A });
  record('T1_cleanup_cancel', t1.status === 'cancelled', 'cancelled', t1.status);

  let t2 = await tw.createDraftTask(config, {
    title: `[${RUN_TAG}] T2`, categoryCode, primaryEmployeeCode: ACTOR_EMP_A.actorEmployeeCode,
    idempotencyKey: `22222222-2222-2222-2222-${Date.now().toString().padStart(12, '0')}`.slice(0, 36),
    ...ACTOR_EMP_A,
  });
  fixtureTaskIds.push(t2.id);
  t2 = await tw.publishTask(config, { taskId: t2.id, expectedRowVersion: t2.row_version, sourceDepartment: 'ZVERIFY-DEPT', targetDepartment: 'ZVERIFY-DEPT', ...ACTOR_EMP_A });
  t2 = await tw.cancelTask(config, { taskId: t2.id, expectedRowVersion: t2.row_version, reason: `[${RUN_TAG}] verify cancel`, ...ACTOR_EMP_B });
  record('12_cancelTask', t2.status === 'cancelled', 'cancelled', t2.status);

  // ===== T3: create -> publish -> complete -> reopen -> cancel(cleanup) =====
  let t3 = await tw.createDraftTask(config, {
    title: `[${RUN_TAG}] T3`, categoryCode, primaryEmployeeCode: ACTOR_EMP_A.actorEmployeeCode,
    idempotencyKey: `33333333-3333-3333-3333-${Date.now().toString().padStart(12, '0')}`.slice(0, 36),
    ...ACTOR_EMP_A,
  });
  fixtureTaskIds.push(t3.id);
  t3 = await tw.publishTask(config, { taskId: t3.id, expectedRowVersion: t3.row_version, sourceDepartment: 'ZVERIFY-DEPT', targetDepartment: 'ZVERIFY-DEPT', ...ACTOR_EMP_A });
  t3 = await tw.completeTask(config, { taskId: t3.id, expectedRowVersion: t3.row_version, resultText: `[${RUN_TAG}] verify complete`, ...ACTOR_EMP_A });
  record('13_completeTask', t3.status === 'completed', 'completed', t3.status);

  t3 = await tw.reopenTask(config, { taskId: t3.id, expectedRowVersion: t3.row_version, reason: `[${RUN_TAG}] verify reopen`, ...ACTOR_EMP_B });
  record('14_reopenTask', t3.status !== 'completed', '!completed', t3.status);

  t3 = await tw.cancelTask(config, { taskId: t3.id, expectedRowVersion: t3.row_version, reason: `[${RUN_TAG}] cleanup T3`, ...ACTOR_EMP_A });
  record('T3_cleanup_cancel', t3.status === 'cancelled', 'cancelled', t3.status);

  // Category fixture: deactivate (không xoá được — còn 3 task cancelled tham chiếu, đúng thiết kế)
  await tw.setTaskCategoryActive(config, { categoryCode, isActive: false, ...ACTOR_ADMIN });
  record('cleanup_category_deactivated', true, 'is_active=false', 'done');

  const failed = results.filter((r) => !r.pass);
  console.log('\n=== SUMMARY ===');
  console.log(`RUN_TAG=${RUN_TAG}`);
  console.log(`OPERATIONS_PASS = ${results.length - failed.length}/${results.length}`);
  console.log(`FIXTURE_TASK_IDS (đều đã cancelled) = ${fixtureTaskIds.join(', ')}`);
  console.log(`FIXTURE_CATEGORY = ${categoryCode} (inactive)`);
  if (failed.length) {
    console.log('FAILED:', failed.map((f) => f.name));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('SCRIPT_ERROR', err);
  process.exitCode = 1;
});
