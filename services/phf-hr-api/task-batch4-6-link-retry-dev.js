'use strict';

// PHF HR — Batch 4-6 TARGETED RETRY: addTaskLink + removeTaskLink ONLY, DEV-only,
// chạy TRÊN SERVER (KHÔNG chạy được từ local checkout — thiếu PHF_HR_DB_*
// credentials/network path).
//
// LÝ DO CÓ FILE RIÊNG (KHÔNG dùng lại task-batch4-6-real-db-verify-dev.js):
// script đầy đủ đó chạy TUẦN TỰ STEP 1->7 trên fixture cố định qua
// idempotencyKey — nhưng STEP 2 (addTaskRelated)/STEP 4 (addTaskComment)/
// STEP 7 (setTaskPermissionAssignment) KHÔNG có idempotency guard ở tầng
// harness (đúng vì source-of-truth addTaskComment/setTaskPermissionAssignment
// tự thân KHÔNG idempotent theo thiết kế RPC gốc) — chạy lại nguyên script sẽ
// tạo thêm 1 related-assignment mới (STEP2) rồi remove lại (STEP3), 1 comment
// MỚI (STEP4), và 1 permission-assignment-history entry MỚI (STEP7) — đúng
// những gì GO lượt này CẤM ("KHÔNG chạy lại STEP 1-4/7"). File này CHỈ chạm
// task.links + event liên quan link, KHÔNG đụng gì khác.
//
// Fixture: dùng ĐÚNG task_id đã có sẵn từ lần chạy trước (KHÔNG tạo mới,
// KHÔNG publish lại, KHÔNG đổi primary/related/comment/permission).
//
// Cách chạy (TRÊN SERVER, xem EXACT_NEXT_STEP trong báo cáo bàn giao — KHÔNG
// tự chạy ở đây):
//   cd /opt/phf-hr/phf-hr-api && node task-batch4-6-link-retry-dev.js

const { loadConfig } = require('./lib/config');
const { addTaskLink, removeTaskLink } = require('./lib/task-write');
const { Pool } = require('pg');

const TASK_ID = process.env.PHF_HR_LINK_RETRY_TASK_ID || '4df12823-4f44-4cb1-885f-09db14de9952';
const ACTOR = 'TEST_B46_ACTOR';
const LINK_URL = 'https://example.test/batch4-6-real-db-verify';
const LINK_SIDE = 'input_reference';
const LINK_LABEL = 'TEST_B46_LINK';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, detail !== undefined ? JSON.stringify(detail) : '');
  if (!ok) process.exitCode = 1;
}

// Read-only snapshot — Pool riêng của script, KHÔNG đụng pool nội bộ lib/db.js
// (module đó cố ý không export pool). Luôn ROLLBACK, không bao giờ COMMIT.
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
    try { await client.query('ROLLBACK'); } catch (e2) {}
    throw err;
  } finally {
    client.release();
  }
}

async function readLinks(config, taskId) {
  return snapshot(config, 'SELECT id, side, url, label, related_event_id FROM task.links WHERE task_id = $1 ORDER BY created_at ASC', [taskId]);
}
async function readLinkEvents(config, taskId) {
  return snapshot(
    config,
    "SELECT event_type, actor_employee_code, actor_account_id, payload, occurred_at FROM task.events WHERE task_id = $1 AND event_type = 'link' ORDER BY occurred_at ASC",
    [taskId]
  );
}

async function main() {
  const config = loadConfig();
  console.log('CONFIG_SUMMARY', config.summary);
  if (!config.ok) {
    console.error('CONFIG_INVALID — dừng ngay, KHÔNG thử kết nối.', config.errors);
    process.exit(1);
  }
  console.log('TARGET_TASK_ID', TASK_ID);

  // ===========================================================================
  // STEP 5 — addTaskLink (fresh insert) + idempotent replay
  // ===========================================================================
  const linksBefore = await readLinks(config, TASK_ID);
  const linkEventsBefore = await readLinkEvents(config, TASK_ID);
  console.log('BEFORE_links', JSON.stringify(linksBefore));
  console.log('BEFORE_linkEvents', JSON.stringify(linkEventsBefore));

  let linkFirst;
  try {
    linkFirst = await addTaskLink(config, { taskId: TASK_ID, side: LINK_SIDE, url: LINK_URL, label: LINK_LABEL, actorEmployeeCode: ACTOR });
  } catch (err) {
    record('STEP5_addTaskLink', false, { taskId: TASK_ID, linksBefore, message: err.message, code: err.code });
    console.error('STEP5_FAILED_STOP — KHÔNG chạy STEP 6.');
    if (snapshotPool) await snapshotPool.end();
    process.exit(1);
    return;
  }
  const linksAfterFirst = await readLinks(config, TASK_ID);
  const linkEventsAfterFirst = await readLinkEvents(config, TASK_ID);
  const step5Ok = linksAfterFirst.length === linksBefore.length + 1 && !!linkFirst.related_event_id;
  record('STEP5_addTaskLink', step5Ok, {
    taskId: TASK_ID, writeResult: linkFirst, linksBefore, linksAfterFirst, linkEventsAfterFirst,
  });
  if (!step5Ok) {
    console.error('STEP5_FAILED_STOP (shape không đúng kỳ vọng) — KHÔNG chạy STEP 6.');
    if (snapshotPool) await snapshotPool.end();
    process.exit(1);
    return;
  }

  let linkSecond;
  try {
    linkSecond = await addTaskLink(config, { taskId: TASK_ID, side: LINK_SIDE, url: LINK_URL, label: LINK_LABEL, actorEmployeeCode: ACTOR });
  } catch (err) {
    record('STEP5_idempotentReplay', false, { taskId: TASK_ID, message: err.message, code: err.code });
    console.error('STEP5_IDEMPOTENT_REPLAY_FAILED_STOP — KHÔNG chạy STEP 6 (state link không chắc chắn).');
    if (snapshotPool) await snapshotPool.end();
    process.exit(1);
    return;
  }
  const linksAfterSecond = await readLinks(config, TASK_ID);
  const linkEventsAfterSecond = await readLinkEvents(config, TASK_ID);
  const sameLinkId = linkSecond.id === linkFirst.id;
  const noDuplicateRow = linksAfterSecond.length === linksAfterFirst.length;
  const noDuplicateEvent = linkEventsAfterSecond.length === linkEventsAfterFirst.length;
  record('STEP5_idempotentReplay', sameLinkId && noDuplicateRow && noDuplicateEvent, {
    sameLinkId, noDuplicateRow, noDuplicateEvent, linksAfterSecond, linkEventsAfterSecond,
  });

  // ===========================================================================
  // STEP 6 — removeTaskLink (linkFirst.id)
  // ===========================================================================
  const linksBeforeRemove = linksAfterSecond;
  let removedLink;
  try {
    removedLink = await removeTaskLink(config, { taskId: TASK_ID, linkId: linkFirst.id, actorEmployeeCode: ACTOR });
  } catch (err) {
    record('STEP6_removeTaskLink', false, { taskId: TASK_ID, linkId: linkFirst.id, linksBeforeRemove, message: err.message, code: err.code });
    if (snapshotPool) await snapshotPool.end();
    process.exit(1);
    return;
  }
  const linksAfterRemove = await readLinks(config, TASK_ID);
  const linkEventsAfterRemove = await readLinkEvents(config, TASK_ID);
  const linkRowStillExistsUnchanged = linksAfterRemove.find((l) => l.id === linkFirst.id);
  const rowCountUnchanged = linksAfterRemove.length === linksBeforeRemove.length; // KHÔNG hard-delete -> count không đổi
  const removeLinkEvent = linkEventsAfterRemove
    .filter((e) => e.payload && e.payload.action === 'remove' && e.payload.link_id === linkFirst.id)
    .pop();
  const step6Ok = removedLink.removed === true && removedLink.link_id === linkFirst.id && !!linkRowStillExistsUnchanged && rowCountUnchanged && !!removeLinkEvent;
  record('STEP6_removeTaskLink', step6Ok, {
    taskId: TASK_ID, linkId: linkFirst.id, writeResult: removedLink,
    linksBeforeRemove, linksAfterRemove, rowCountUnchanged, linkRowStillExistsUnchanged, removeLinkEvent,
  });

  // ===========================================================================
  // FINAL STATE
  // ===========================================================================
  console.log('FINAL_LINK_STATE', JSON.stringify(linksAfterRemove, null, 2));
  console.log('FINAL_LINK_EVENTS', JSON.stringify(linkEventsAfterRemove, null, 2));

  const allPass = results.every((r) => r.ok);
  console.log('BATCH4_6_LINK_RETRY_OVERALL', allPass ? 'PASS' : 'FAIL', `(${results.filter((r) => r.ok).length}/${results.length})`);

  if (snapshotPool) await snapshotPool.end();
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('BATCH4_6_LINK_RETRY_UNCAUGHT_ERROR', err.message, err.stack);
  process.exit(1);
});
