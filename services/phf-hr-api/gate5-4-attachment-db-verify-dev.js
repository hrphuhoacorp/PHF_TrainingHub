'use strict';

// PHF HR — Gate 5.4 REAL DB verification, DB-layer ONLY (KHÔNG filesystem,
// KHÔNG HTTP, KHÔNG require lib/attachment-storage.js ở bất kỳ đâu trong
// file này — đúng FILESYSTEM GUARD của GO). Chạy tay bởi deployer/Technical
// Lead TRÊN SERVER, sau khi task-write.js + attachment-policy.js đã được
// transfer lên /opt/phf-hr/phf-hr-api (CHƯA xảy ra tại thời điểm viết file
// này — xem báo cáo bàn giao kèm theo, đây là lý do harness này CHƯA được
// tự chạy).
//
// Verify đúng 4 primitive Gate 5.4:
//   findTaskAttachmentByObjectKey, createTaskAttachmentMetadata,
//   removeTaskAttachment, getTaskAttachmentForDownload
// qua STEP 0-8 đã thiết kế trong GO — dùng createDraftTask/publishTask
// (đã REAL-DB PASS từ Batch 3) để tự tạo fixture TEST MỚI, KHÔNG dùng
// business task thật.
//
// FAIL-FAST: mỗi STEP kiểm tra kỳ vọng NGAY, dừng process.exit(1) tức thì
// nếu sai lệch — KHÔNG chạy tiếp STEP phụ thuộc, KHÔNG tự retry.
//
// Cách chạy (TRÊN SERVER, từ root phf-hr-api, SAU KHI đã deploy G5.4 code):
//   cd /opt/phf-hr/phf-hr-api && node gate5-4-attachment-db-verify-dev.js

const crypto = require('crypto');
const { loadConfig } = require('./lib/config');
const {
  createDraftTask,
  publishTask,
  findTaskAttachmentByObjectKey,
  createTaskAttachmentMetadata,
  removeTaskAttachment,
  getTaskAttachmentForDownload,
} = require('./lib/task-write');

const FIXTURE_IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000540'; // deterministic, valid UUID hex
const CATEGORY_CODE = 'PHAT_SINH_KHAC'; // category TEST-safe đã dùng nhất quán ở Batch 3/4-6 E2E trước đó
const ACTOR = 'TEST_G5_DB_ACTOR';
const ATTACHMENT_IDEMPOTENCY_SUFFIX = '00000000-0000-4000-8000-000000000504';

const FIXTURE_BYTES = Buffer.from('[TEST] gate5-real-db.pdf fixture bytes — Gate 5.4 DB-layer verification');
const CHECKSUM_SHA256 = crypto.createHash('sha256').update(FIXTURE_BYTES).digest('hex');
const SIZE_BYTES = 128; // theo đúng GO — KHÔNG dùng FIXTURE_BYTES.length (DB-layer không cần khớp file thật)

let currentStep = 'INIT';
function stop(detail) {
  console.error(`${currentStep}_FAIL_STOP`, JSON.stringify(detail));
  process.exit(1);
}

function assertStep(condition, detail) {
  if (!condition) stop(detail);
}

async function main() {
  const config = loadConfig();
  console.log('CONFIG_SUMMARY', config.summary);
  if (!config.ok) {
    console.error('CONFIG_INVALID', config.errors);
    process.exit(1);
  }

  // ===========================================================================
  // STEP 0 — fixture TEST task (createDraftTask + publishTask, đã REAL-DB PASS
  // từ Batch 3 — idempotencyKey cố định nên chạy lại vẫn an toàn/replay-safe).
  // ===========================================================================
  currentStep = 'STEP0_fixture';
  let draft;
  try {
    draft = await createDraftTask(config, {
      flowType: 'giao_viec',
      title: '[TEST] Gate 5.4 attachment DB-layer verify',
      content: '[TEST ONLY] Gate 5.4',
      categoryCode: CATEGORY_CODE,
      priority: 'thuong',
      startAt: null,
      deadline: '2026-12-31T00:00:00Z',
      primaryEmployeeCode: 'TEST_G5_DB_PRIMARY',
      idempotencyKey: FIXTURE_IDEMPOTENCY_KEY,
      actorEmployeeCode: ACTOR,
    });
  } catch (err) {
    stop({ message: err.message, code: err.code });
    return;
  }
  let taskId = draft.id;
  let rowVersion = draft.row_version;
  console.log('STEP0_draft', { id: draft.id, task_code: draft.task_code, status: draft.status, row_version: draft.row_version });

  if (draft.status === 'draft') {
    let published;
    try {
      published = await publishTask(config, {
        taskId, expectedRowVersion: rowVersion, actorEmployeeCode: ACTOR,
        sourceDepartment: null, targetDepartment: null,
      });
    } catch (err) {
      stop({ message: err.message, code: err.code });
      return;
    }
    rowVersion = published.row_version;
    console.log('STEP0_published', { id: published.id, status: published.status, row_version: published.row_version });
  } else {
    console.log('STEP0_alreadyPublished_fromPreviousRun', { id: draft.id, status: draft.status });
  }
  console.log('FIXTURE_TASK_ID', taskId);

  const storedObjectKey = `tasks/${taskId}/${ACTOR}/${ATTACHMENT_IDEMPOTENCY_SUFFIX}`;
  console.log('FIXTURE_STORED_OBJECT_KEY', storedObjectKey);

  // ===========================================================================
  // STEP 1 — replay lookup BEFORE (expected null)
  // ===========================================================================
  currentStep = 'STEP1_lookupBefore';
  const before = await findTaskAttachmentByObjectKey(config, { storedObjectKey });
  console.log('STEP1_result', before);
  assertStep(before === null, { got: before });
  console.log('STEP1_PASS');

  // ===========================================================================
  // STEP 2 — CREATE METADATA
  // ===========================================================================
  currentStep = 'STEP2_createMetadata';
  const created = await createTaskAttachmentMetadata(config, {
    taskId,
    originalFilename: '[TEST] gate5-real-db.pdf',
    storedObjectKey,
    mimeType: 'application/pdf',
    extension: 'pdf',
    sizeBytes: SIZE_BYTES,
    checksumSha256: CHECKSUM_SHA256,
    uploadedByEmployeeCode: ACTOR,
  });
  console.log('STEP2_result', created);
  assertStep(
    created && created.id && created.task_id === taskId && created.original_filename === '[TEST] gate5-real-db.pdf' &&
      created.stored_object_key === storedObjectKey && created.mime_type === 'application/pdf' &&
      created.extension === 'pdf' && Number(created.size_bytes) === SIZE_BYTES &&
      created.checksum_sha256 === CHECKSUM_SHA256 && created.uploaded_by_employee_code === ACTOR &&
      created.status === 'active' && created.deleted_at === null,
    { created }
  );
  const attachmentId = created.id;
  console.log('STEP2_PASS', { attachmentId });

  // ===========================================================================
  // STEP 3 — replay lookup AFTER
  // ===========================================================================
  currentStep = 'STEP3_lookupAfter';
  const after = await findTaskAttachmentByObjectKey(config, { storedObjectKey });
  console.log('STEP3_result', after);
  assertStep(after && after.id === attachmentId, { after, expectedId: attachmentId });
  console.log('STEP3_PASS');

  // ===========================================================================
  // STEP 4 — UNIQUE/IDEMPOTENCY REPLAY (gọi createTaskAttachmentMetadata lần 2)
  // ===========================================================================
  currentStep = 'STEP4_idempotentReplay';
  const replay = await createTaskAttachmentMetadata(config, {
    taskId,
    originalFilename: '[TEST] gate5-real-db.pdf',
    storedObjectKey,
    mimeType: 'application/pdf',
    extension: 'pdf',
    sizeBytes: SIZE_BYTES,
    checksumSha256: CHECKSUM_SHA256,
    uploadedByEmployeeCode: ACTOR,
  });
  console.log('STEP4_result', replay);
  assertStep(replay && replay.id === attachmentId, { replay, expectedId: attachmentId });
  console.log('STEP4_PASS — row winner đúng id, KHÔNG suy diễn filesystem ownership từ kết quả này.');

  // ===========================================================================
  // STEP 5 — DOWNLOAD METADATA ACTIVE
  // ===========================================================================
  currentStep = 'STEP5_downloadActive';
  const downloadOk = await getTaskAttachmentForDownload(config, { taskId, attachmentId });
  console.log('STEP5_result_correctTaskId', downloadOk);
  assertStep(downloadOk && downloadOk.id === attachmentId, { downloadOk });

  let wrongTaskIdErr;
  try {
    await getTaskAttachmentForDownload(config, { taskId: '00000000-0000-4000-8000-000000000999', attachmentId });
  } catch (err) {
    wrongTaskIdErr = err;
  }
  console.log('STEP5_result_wrongTaskId', { code: wrongTaskIdErr && wrongTaskIdErr.code });
  assertStep(wrongTaskIdErr && wrongTaskIdErr.code === 'TASK_ATTACHMENT_NOT_FOUND', { code: wrongTaskIdErr && wrongTaskIdErr.code });
  console.log('STEP5_PASS');

  // ===========================================================================
  // STEP 6 — REMOVE
  // ===========================================================================
  currentStep = 'STEP6_remove';
  const removed = await removeTaskAttachment(config, {
    taskId, attachmentId, reason: '[TEST] Gate 5.4 remove verification', actorEmployeeCode: ACTOR,
  });
  console.log('STEP6_result', removed);
  assertStep(
    removed && removed.status === 'pending_delete' && removed.deleted_at !== null && removed.deleted_by_employee_code === ACTOR,
    { removed }
  );
  console.log('STEP6_PASS');

  // ===========================================================================
  // STEP 7 — DOWNLOAD AFTER REMOVE (expected NOT_FOUND)
  // ===========================================================================
  currentStep = 'STEP7_downloadAfterRemove';
  let afterRemoveErr;
  try {
    await getTaskAttachmentForDownload(config, { taskId, attachmentId });
  } catch (err) {
    afterRemoveErr = err;
  }
  console.log('STEP7_result', { code: afterRemoveErr && afterRemoveErr.code });
  assertStep(afterRemoveErr && afterRemoveErr.code === 'TASK_ATTACHMENT_NOT_FOUND', { code: afterRemoveErr && afterRemoveErr.code });
  console.log('STEP7_PASS');

  // ===========================================================================
  // STEP 8 — REMOVE AGAIN (expected ALREADY_REMOVED)
  // ===========================================================================
  currentStep = 'STEP8_removeAgain';
  let removeAgainErr;
  try {
    await removeTaskAttachment(config, { taskId, attachmentId, actorEmployeeCode: ACTOR });
  } catch (err) {
    removeAgainErr = err;
  }
  console.log('STEP8_result', { code: removeAgainErr && removeAgainErr.code });
  assertStep(removeAgainErr && removeAgainErr.code === 'TASK_ATTACHMENT_ALREADY_REMOVED', { code: removeAgainErr && removeAgainErr.code });
  console.log('STEP8_PASS');

  console.log('GATE5_4_REAL_DB_VERIFY_OVERALL PASS', {
    taskId, attachmentId, storedObjectKey, checksumSha256: CHECKSUM_SHA256,
  });
  process.exit(0);
}

main().catch((err) => {
  console.error('GATE5_4_REAL_DB_VERIFY_UNCAUGHT_ERROR', err.message, err.stack);
  process.exit(1);
});
