'use strict';

// PHF HR — Batch 4-6 REAL DB verification harness, DEV-only, chạy TRÊN SERVER
// (KHÔNG chạy được từ local checkout — thiếu PHF_HR_DB_* credentials/network
// path, xác nhận qua loadConfig() thật ở phiên chuẩn bị script này).
//
// Cùng pattern task-write-db-connection-test-dev.js đã dùng ở Batch 1-3:
// require thẳng ./lib/config + ./lib/task-write (server-adapted path, root
// tại /opt/phf-hr/phf-hr-api, KHÔNG có prefix services/phf-hr-api/...).
// KHÔNG hardcode credential nào — mọi thứ đọc từ .env qua loadConfig().
// KHÔNG log secret/token/password (chỉ console.log(config.summary) vốn đã
// tự mask theo lib/config.js).
//
// Verify 7 function Batch 4-6 qua ĐÚNG application write-path thật
// (lib/task-write.js, qua withTaskWriteTransaction — KHÔNG raw SQL cho phần
// write): transferTaskPrimary, addTaskRelated, removeTaskRelated,
// addTaskComment, addTaskLink, removeTaskLink, setTaskPermissionAssignment.
//
// FIXTURE: tự tạo 1 Task TEST riêng qua chính application path đã real-DB
// verify PASS ở Batch 3 (createDraftTask + publishTask) — KHÔNG dùng lại
// fixture cũ nào (79fc8787.../02b2a4b5.../17061037... đều published/cancelled,
// không phù hợp cho chuỗi thao tác mới). idempotencyKey CỐ ĐỊNH để script
// chạy lại nhiều lần KHÔNG tạo task trùng (đúng contract idempotency đã
// verify PASS ở Batch 3).
//
// KHÔNG raw INSERT/UPDATE/DELETE vào task.* — mọi write đều qua application
// function thật. KHÔNG reset dữ liệu bằng raw SQL. Snapshot BEFORE/AFTER
// dùng 1 Pool RIÊNG của chính script này (lib/db.js cố ý KHÔNG export pool
// nội bộ — xem comment đầu lib/db.js) — mỗi snapshot tự BEGIN/SET LOCAL ROLE
// phf_hr_app/SELECT/ROLLBACK, KHÔNG BAO GIỜ COMMIT từ snapshot helper (chỉ
// đọc, không ghi).
//
// STATE KHÔNG ĐẢO NGƯỢC được tạo bởi script này (đọc kỹ trước khi chạy):
//   - task.permission_assignments: 1 dòng active mới cho employee_code
//     TEST_B46_PERMISSION_TARGET (preset cuối = TRUONG_CA) — KHÔNG có "xóa
//     assignment" nào trong RPC gốc, chỉ deactivate-and-replace. Nếu muốn
//     dọn dẹp sau này, gọi lại setTaskPermissionAssignment với preset_code=
//     'NHAN_VIEN' (đúng cách RPC gốc mô tả "Reset về NHAN_VIEN không cần API
//     riêng").
//   - Task TEST cố định (TEST_B46_IDEMPOTENCY_KEY) sẽ ở trạng thái published,
//     primary=TEST_B46_PRIMARY_B, KHÔNG related nào active, 1 comment, 0 link
//     active (đã remove) sau khi script chạy xong lần đầu.
//
// Cách chạy (TRÊN SERVER, xem EXACT_NEXT_STEP trong báo cáo bàn giao kèm
// theo — KHÔNG tự chạy ở đây):
//   cd /opt/phf-hr/phf-hr-api && node task-batch4-6-real-db-verify-dev.js

const { loadConfig } = require('./lib/config');
const {
  createDraftTask,
  publishTask,
  transferTaskPrimary,
  addTaskRelated,
  removeTaskRelated,
  addTaskComment,
  addTaskLink,
  removeTaskLink,
  setTaskPermissionAssignment,
} = require('./lib/task-write');
const { Pool } = require('pg');

const ACTOR = 'TEST_B46_ACTOR';
const PRIMARY_A = 'TEST_B46_PRIMARY_A';
const PRIMARY_B = 'TEST_B46_PRIMARY_B';
const RELATED_C = 'TEST_B46_RELATED_C';
const PERMISSION_TARGET = 'TEST_B46_PERMISSION_TARGET';
const PERMISSION_ADMIN = 'TEST_B46_PERMISSION_ADMIN';
const CREATE_IDEMPOTENCY_KEY = '00000000-0000-4000-8000-0000000004b6';
const DEADLINE_ISO = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, detail !== undefined ? JSON.stringify(detail) : '');
  if (!ok) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Read-only snapshot — Pool riêng của harness, KHÔNG dùng pool nội bộ của
// lib/db.js (module đó cố ý không export pool cho bất kỳ ai khác gọi write
// trực tiếp). Snapshot CHỈ SELECT, luôn ROLLBACK, không bao giờ COMMIT.
// ---------------------------------------------------------------------------
let snapshotPool = null;
function getSnapshotPool(config) {
  if (snapshotPool) return snapshotPool;
  snapshotPool = new Pool({
    host: config.PHF_HR_DB_HOST,
    port: config.PHF_HR_DB_PORT,
    database: config.PHF_HR_DB_NAME,
    user: config.PHF_HR_DB_RUNTIME_USER,
    password: config.PHF_HR_DB_RUNTIME_PASSWORD,
    max: 2,
  });
  return snapshotPool;
}

async function snapshot(config, sql, params) {
  const pool = getSnapshotPool(config);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE phf_hr_app');
    const result = await client.query(sql, params || []);
    await client.query('ROLLBACK');
    return result.rows;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (e2) {
      // best-effort, chỉ để không leak connection ở trạng thái transaction dở
    }
    throw err;
  } finally {
    client.release();
  }
}

async function findActiveCategory(config) {
  const rows = await snapshot(config, 'SELECT category_code FROM task.categories WHERE is_active = true ORDER BY category_code LIMIT 1');
  if (!rows.length) throw new Error('NO_ACTIVE_CATEGORY_FOUND — task.categories chưa có category active nào, không tạo được fixture Task.');
  return rows[0].category_code;
}

async function readAssignees(config, taskId) {
  return snapshot(config, 'SELECT id, employee_code, role, is_active FROM task.assignees WHERE task_id = $1 ORDER BY assigned_at ASC', [taskId]);
}

async function readEvents(config, taskId) {
  return snapshot(config, 'SELECT event_type, actor_employee_code, actor_account_id, payload, reason, occurred_at FROM task.events WHERE task_id = $1 ORDER BY occurred_at ASC', [taskId]);
}

async function readComments(config, taskId) {
  return snapshot(config, 'SELECT id, author_employee_code, body, created_at FROM task.comments WHERE task_id = $1 ORDER BY created_at ASC', [taskId]);
}

async function readLinks(config, taskId) {
  return snapshot(config, 'SELECT id, side, url, label, related_event_id FROM task.links WHERE task_id = $1 ORDER BY created_at ASC', [taskId]);
}

async function readPermissionAssignments(config, employeeCode) {
  return snapshot(
    config,
    'SELECT id, employee_code, preset_code, is_active, effective_from, effective_to FROM task.permission_assignments WHERE upper(employee_code) = upper($1) ORDER BY effective_from ASC',
    [employeeCode]
  );
}

async function readPermissionHistory(config, assignmentIds) {
  if (!assignmentIds.length) return [];
  return snapshot(
    config,
    'SELECT assignment_id, action, reason, changed_by_employee_code, changed_at FROM task.permission_assignment_history WHERE assignment_id = ANY($1::uuid[]) ORDER BY changed_at ASC',
    [assignmentIds]
  );
}

async function main() {
  const config = loadConfig();
  console.log('CONFIG_SUMMARY', config.summary);
  if (!config.ok) {
    console.error('CONFIG_INVALID — dừng ngay, KHÔNG thử kết nối.', config.errors);
    process.exit(1);
  }

  // ===========================================================================
  // FIXTURE — tạo Task TEST qua đúng application path (createDraftTask ->
  // publishTask), đã real-DB verify PASS ở Batch 3. idempotencyKey cố định
  // để rerun an toàn (replay, KHÔNG tạo task trùng, KHÔNG lỗi).
  // ===========================================================================
  let categoryCode;
  try {
    categoryCode = await findActiveCategory(config);
  } catch (err) {
    record('FIXTURE_FIND_ACTIVE_CATEGORY', false, { message: err.message });
    process.exit(1);
    return;
  }
  record('FIXTURE_FIND_ACTIVE_CATEGORY', true, { categoryCode });

  let draft;
  try {
    draft = await createDraftTask(config, {
      flowType: 'giao_viec',
      title: '[TEST_BATCH4_6] Server harness fixture',
      content: '[TEST ONLY] Batch 4-6 real DB verification',
      categoryCode,
      priority: 'thuong',
      startAt: null,
      deadline: DEADLINE_ISO,
      primaryEmployeeCode: PRIMARY_A,
      idempotencyKey: CREATE_IDEMPOTENCY_KEY,
      actorEmployeeCode: ACTOR,
    });
  } catch (err) {
    record('FIXTURE_CREATE_DRAFT', false, { message: err.message, code: err.code });
    process.exit(1);
    return;
  }
  record('FIXTURE_CREATE_DRAFT', true, { id: draft.id, task_code: draft.task_code, status: draft.status, row_version: draft.row_version });

  const taskId = draft.id;
  let currentRowVersion = draft.row_version;
  let currentPrimary = PRIMARY_A;

  if (draft.status === 'draft') {
    let published;
    try {
      published = await publishTask(config, {
        taskId,
        expectedRowVersion: currentRowVersion,
        actorEmployeeCode: ACTOR,
        sourceDepartment: 'TEST_B46_SOURCE_DEPT',
        targetDepartment: 'TEST_B46_TARGET_DEPT',
      });
    } catch (err) {
      record('FIXTURE_PUBLISH', false, { taskId, message: err.message, code: err.code });
      process.exit(1);
      return;
    }
    currentRowVersion = published.row_version;
    record('FIXTURE_PUBLISH', true, { taskId, status: published.status, row_version: currentRowVersion });
  } else {
    // Idempotency replay từ lần chạy trước — task đã published sẵn, đọc
    // row_version thật hiện tại thay vì giả định.
    record('FIXTURE_ALREADY_PUBLISHED_FROM_PREVIOUS_RUN', true, { taskId, status: draft.status, row_version: currentRowVersion });
    const assigneesNow = await readAssignees(config, taskId);
    const activePrimaryNow = assigneesNow.find((a) => a.role === 'primary' && a.is_active);
    if (activePrimaryNow) currentPrimary = activePrimaryNow.employee_code;
  }

  // ===========================================================================
  // STEP 1 — TRANSFER PRIMARY (currentPrimary -> PRIMARY_B)
  // ===========================================================================
  if (currentPrimary !== PRIMARY_B) {
    const before = await readAssignees(config, taskId);
    let transferred;
    try {
      transferred = await transferTaskPrimary(config, {
        taskId,
        expectedRowVersion: currentRowVersion,
        actorEmployeeCode: ACTOR,
        newPrimaryEmployeeCode: PRIMARY_B,
        reason: '[TEST] Batch 4-6 real DB verify — transfer primary.',
      });
      currentRowVersion = transferred.row_version;
      currentPrimary = PRIMARY_B;
    } catch (err) {
      record('STEP1_transferTaskPrimary', false, { taskId, before, message: err.message, code: err.code });
      console.error('STEP1_FAILED_STOP — KHÔNG chạy STEP 2 (phụ thuộc trạng thái primary).');
      process.exit(1);
      return;
    }
    const after = await readAssignees(config, taskId);
    const events = await readEvents(config, taskId);
    const transferEvent = events.filter((e) => e.event_type === 'transfer').pop();
    const oldPrimaryInactive = after.find((a) => a.employee_code === before.find((b) => b.role === 'primary' && b.is_active).employee_code && a.role === 'primary');
    const newPrimaryActive = after.find((a) => a.employee_code === PRIMARY_B && a.role === 'primary' && a.is_active);
    record('STEP1_transferTaskPrimary', true, {
      taskId,
      before,
      writeResult: { row_version: transferred.row_version, status: transferred.status },
      after,
      oldPrimaryDeactivated: !!oldPrimaryInactive && oldPrimaryInactive.is_active === false,
      newPrimaryActive: !!newPrimaryActive,
      transferEvent,
    });
  } else {
    record('STEP1_transferTaskPrimary_SKIPPED_alreadyPrimaryB_fromPreviousRun', true, { taskId, currentPrimary });
  }

  // ===========================================================================
  // STEP 2 — ADD RELATED (RELATED_C) — chạy 2 lần để chứng minh idempotent
  // (lần 2 KHÔNG insert assignee mới, chỉ return đúng row đã có).
  // ===========================================================================
  const relatedBefore = await readAssignees(config, taskId);
  let relatedFirst;
  try {
    relatedFirst = await addTaskRelated(config, { taskId, targetEmployeeCode: RELATED_C, actorEmployeeCode: ACTOR });
  } catch (err) {
    record('STEP2_addTaskRelated_first', false, { taskId, relatedBefore, message: err.message, code: err.code });
    console.error('STEP2_FAILED_STOP — KHÔNG chạy STEP 3 (phụ thuộc related vừa thêm).');
    process.exit(1);
    return;
  }
  const relatedAfterFirst = await readAssignees(config, taskId);
  record('STEP2_addTaskRelated_first', true, { taskId, relatedBefore, writeResult: relatedFirst, relatedAfterFirst });

  let relatedSecond;
  try {
    relatedSecond = await addTaskRelated(config, { taskId, targetEmployeeCode: RELATED_C, actorEmployeeCode: ACTOR });
  } catch (err) {
    record('STEP2b_addTaskRelated_idempotentReplay', false, { taskId, message: err.message, code: err.code });
  } finally {
    if (relatedSecond) {
      const relatedAfterSecond = await readAssignees(config, taskId);
      const noDuplicateRow = relatedAfterSecond.filter((a) => a.employee_code === RELATED_C && a.role === 'related').length === 1;
      record('STEP2b_addTaskRelated_idempotentReplay', relatedSecond.id === relatedFirst.id && noDuplicateRow, {
        sameAssigneeId: relatedSecond.id === relatedFirst.id,
        noDuplicateRow,
      });
    }
  }

  const relatedEvents = (await readEvents(config, taskId)).filter((e) => e.event_type === 'assignment' && e.payload && e.payload.employee_code === RELATED_C);
  record('STEP2c_addTaskRelated_eventCount_exactlyOne', relatedEvents.length === 1, { relatedEvents });

  // ===========================================================================
  // STEP 3 — REMOVE RELATED (RELATED_C)
  // ===========================================================================
  const removeRelatedBefore = await readAssignees(config, taskId);
  let removed;
  try {
    removed = await removeTaskRelated(config, { taskId, targetEmployeeCode: RELATED_C, actorEmployeeCode: ACTOR });
  } catch (err) {
    record('STEP3_removeTaskRelated', false, { taskId, removeRelatedBefore, message: err.message, code: err.code });
  }
  if (removed) {
    const removeRelatedAfter = await readAssignees(config, taskId);
    const events = await readEvents(config, taskId);
    const removeEvent = events.filter((e) => e.event_type === 'assignment' && e.payload && e.payload.action === 'remove' && e.payload.employee_code === RELATED_C).pop();
    const nowInactive = removeRelatedAfter.find((a) => a.employee_code === RELATED_C && a.role === 'related');
    record('STEP3_removeTaskRelated', nowInactive && nowInactive.is_active === false && !!removeEvent, {
      taskId, removeRelatedBefore, writeResult: removed, removeRelatedAfter, removeEvent,
    });
  }

  // ===========================================================================
  // STEP 4 — ADD COMMENT
  // ===========================================================================
  const commentsBefore = await readComments(config, taskId);
  let comment;
  try {
    comment = await addTaskComment(config, { taskId, body: '[TEST] Batch 4-6 real DB verify — comment.', actorEmployeeCode: ACTOR });
  } catch (err) {
    record('STEP4_addTaskComment', false, { taskId, commentsBefore, message: err.message, code: err.code });
  }
  if (comment) {
    const commentsAfter = await readComments(config, taskId);
    const events = await readEvents(config, taskId);
    const commentEvent = events.filter((e) => e.event_type === 'comment' && e.payload && e.payload.comment_id === comment.id).pop();
    record('STEP4_addTaskComment', commentsAfter.length === commentsBefore.length + 1 && !!commentEvent, {
      taskId, commentsBefore: commentsBefore.length, writeResult: comment, commentsAfter: commentsAfter.length, commentEvent,
    });
  }

  // ===========================================================================
  // STEP 5 — ADD LINK — chạy 2 lần để chứng minh idempotent (cùng actor/side/
  // url/label -> lần 2 return CÙNG link, KHÔNG insert link mới).
  // ===========================================================================
  const linksBefore = await readLinks(config, taskId);
  let linkFirst;
  try {
    linkFirst = await addTaskLink(config, {
      taskId, side: 'input_reference', url: 'https://example.test/batch4-6-real-db-verify', label: 'TEST_B46_LINK', actorEmployeeCode: ACTOR,
    });
  } catch (err) {
    record('STEP5_addTaskLink_first', false, { taskId, linksBefore, message: err.message, code: err.code });
    console.error('STEP5_FAILED_STOP — KHÔNG chạy STEP 6 (phụ thuộc link vừa thêm).');
  }
  if (linkFirst) {
    const linksAfterFirst = await readLinks(config, taskId);
    record('STEP5_addTaskLink_first', linksAfterFirst.length === linksBefore.length + 1 && !!linkFirst.related_event_id, {
      taskId, linksBefore: linksBefore.length, writeResult: linkFirst, linksAfterFirst: linksAfterFirst.length,
    });

    let linkSecond;
    try {
      linkSecond = await addTaskLink(config, {
        taskId, side: 'input_reference', url: 'https://example.test/batch4-6-real-db-verify', label: 'TEST_B46_LINK', actorEmployeeCode: ACTOR,
      });
    } catch (err) {
      record('STEP5b_addTaskLink_idempotentReplay', false, { taskId, message: err.message, code: err.code });
    }
    if (linkSecond) {
      const linksAfterSecond = await readLinks(config, taskId);
      record('STEP5b_addTaskLink_idempotentReplay', linkSecond.id === linkFirst.id && linksAfterSecond.length === linksAfterFirst.length, {
        sameLinkId: linkSecond.id === linkFirst.id, noDuplicateRow: linksAfterSecond.length === linksAfterFirst.length,
      });
    }

    // ===========================================================================
    // STEP 6 — REMOVE LINK (linkFirst.id) — chỉ ghi event 'remove', KHÔNG
    // hard-delete/update row task.links (đúng source-of-truth).
    // ===========================================================================
    const linksBeforeRemove = await readLinks(config, taskId);
    let removedLink;
    try {
      removedLink = await removeTaskLink(config, { taskId, linkId: linkFirst.id, actorEmployeeCode: ACTOR });
    } catch (err) {
      record('STEP6_removeTaskLink', false, { taskId, linksBeforeRemove, message: err.message, code: err.code });
    }
    if (removedLink) {
      const linksAfterRemove = await readLinks(config, taskId);
      const linkRowStillExistsUnchanged = linksAfterRemove.find((l) => l.id === linkFirst.id);
      const events = await readEvents(config, taskId);
      const removeLinkEvent = events.filter((e) => e.event_type === 'link' && e.payload && e.payload.action === 'remove' && e.payload.link_id === linkFirst.id).pop();
      record('STEP6_removeTaskLink_eventOnly_noRowMutation', removedLink.removed === true && !!linkRowStillExistsUnchanged && !!removeLinkEvent, {
        taskId, writeResult: removedLink, linkRowStillExistsUnchanged, removeLinkEvent,
      });
    }
  } else {
    record('STEP6_removeTaskLink_SKIPPED_step5Failed', false, { reason: 'STEP5 addTaskLink thất bại, không có link để remove.' });
  }

  // ===========================================================================
  // STEP 7 — SET PERMISSION ASSIGNMENT — gán NHAN_VIEN trước rồi
  // TRUONG_CA sau, để chứng minh nhánh deactivate-cũ + assign-mới thật.
  // KHÔNG kiểm tra Admin/authorization ở đây (đúng nguyên tắc DB-layer
  // không tự thêm authorization — main app enforce trước khi gọi).
  // ===========================================================================
  const permBefore = await readPermissionAssignments(config, PERMISSION_TARGET);
  let assign1;
  try {
    assign1 = await setTaskPermissionAssignment(config, {
      targetEmployeeCode: PERMISSION_TARGET,
      presetCode: 'NHAN_VIEN',
      reason: '[TEST] Batch 4-6 real DB verify — assign 1.',
      actorEmployeeCode: PERMISSION_ADMIN,
    });
  } catch (err) {
    record('STEP7_setTaskPermissionAssignment_first', false, { permBefore, message: err.message, code: err.code });
    process.exit(1);
    return;
  }
  const permAfterFirst = await readPermissionAssignments(config, PERMISSION_TARGET);
  record('STEP7_setTaskPermissionAssignment_first', assign1.preset_code === 'NHAN_VIEN' && assign1.is_active === true, {
    permBefore, writeResult: assign1, permAfterFirst,
  });

  let assign2;
  try {
    assign2 = await setTaskPermissionAssignment(config, {
      targetEmployeeCode: PERMISSION_TARGET,
      presetCode: 'TRUONG_CA',
      reason: '[TEST] Batch 4-6 real DB verify — assign 2 (replace).',
      actorEmployeeCode: PERMISSION_ADMIN,
    });
  } catch (err) {
    record('STEP7b_setTaskPermissionAssignment_replace', false, { message: err.message, code: err.code });
  }
  if (assign2) {
    const permAfterSecond = await readPermissionAssignments(config, PERMISSION_TARGET);
    const oldOneDeactivated = permAfterSecond.find((r) => r.id === assign1.id);
    const newOneActive = permAfterSecond.find((r) => r.id === assign2.id);
    const history = await readPermissionHistory(config, [assign1.id, assign2.id]);
    const hasDeactivateAction = history.some((h) => h.assignment_id === assign1.id && h.action === 'deactivate');
    const hasAssignActions = history.filter((h) => h.action === 'assign').length === 2;
    record(
      'STEP7b_setTaskPermissionAssignment_replace_historyCorrect',
      assign2.preset_code === 'TRUONG_CA' && !!oldOneDeactivated && oldOneDeactivated.is_active === false &&
        !!newOneActive && newOneActive.is_active === true && hasDeactivateAction && hasAssignActions,
      { writeResult: assign2, permAfterSecond, history }
    );
  }

  // ===========================================================================
  // AFTER ALL 7 — read-only tổng kết
  // ===========================================================================
  const finalAssignees = await readAssignees(config, taskId);
  const finalEvents = await readEvents(config, taskId);
  const finalComments = await readComments(config, taskId);
  const finalLinks = await readLinks(config, taskId);
  const finalPermission = await readPermissionAssignments(config, PERMISSION_TARGET);

  console.log('FINAL_STATE_SUMMARY', JSON.stringify({
    taskId,
    finalAssignees,
    eventCount: finalEvents.length,
    eventTypes: finalEvents.map((e) => e.event_type),
    finalComments,
    finalLinks,
    finalPermissionAssignments: finalPermission,
  }, null, 2));

  const allPass = results.every((r) => r.ok);
  console.log('BATCH4_6_REAL_DB_VERIFY_OVERALL', allPass ? 'PASS' : 'FAIL', `(${results.filter((r) => r.ok).length}/${results.length})`);

  if (snapshotPool) await snapshotPool.end();
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('BATCH4_6_REAL_DB_VERIFY_UNCAUGHT_ERROR', err.message, err.stack);
  process.exit(1);
});
