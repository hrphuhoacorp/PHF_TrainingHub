'use strict';

// TEST/MOCK HARNESS cho lib/attachment-service.js (Gate 5.5 orchestration).
// KHÔNG DB thật, KHÔNG /home/phf-storage thật, KHÔNG deploy, KHÔNG route.
//
// Kỹ thuật mock giống 2 harness đã CLOSED trước đó, kết hợp cả hai:
//   - DB: inject module 'pg' giả vào require.cache TRƯỚC khi require
//     lib/attachment-service.js (giống test-task-write-mock-harness.js) —
//     script-driven fake client, mỗi bước phải khớp đúng SQL kỳ vọng.
//   - Filesystem: dùng 1 thư mục temp CÔ LẬP do chính OS cấp
//     (fs.mkdtempSync(os.tmpdir())) làm storageRoot — filesystem THẬT nhưng
//     hoàn toàn tách biệt khỏi mọi đường dẫn production (giống
//     test-attachment-storage-mock-harness.js), tự dọn sạch sau khi chạy.
//
// RACE tests (8/9/14/15/16 trong checklist G5.5) KHÔNG dùng Promise.all()/
// setTimeout hy vọng đúng thứ tự interleave — thay vào đó DỰNG SẴN trạng
// thái final-path (pre-existing file, mtime cũ giả lập stale) rồi gọi
// uploadAttachment() 1 lần, chứng minh orchestrator phản ứng ĐÚNG với từng
// trạng thái quan sát được — deterministic, không flaky.
//
// Chạy: node test-attachment-service-mock-harness.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

const DB_JS_PATH = require.resolve('./lib/db.js');
const TASK_WRITE_JS_PATH = require.resolve('./lib/task-write.js');
const SERVICE_JS_PATH = require.resolve('./lib/attachment-service.js');

const storage = require('./lib/attachment-storage');

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass: !!pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`, detail !== undefined ? detail : '');
}

// ---------------------------------------------------------------------------
// Fake pg client — verbatim kỹ thuật từ test-task-write-mock-harness.js.
// ---------------------------------------------------------------------------
function makeFakeClient(script) {
  const calls = [];
  let step = 0;
  return {
    calls,
    async query(sql, params) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      const rule = script[step];
      calls.push({ step, sql: normalized, params });
      step += 1;
      if (!rule) throw new Error(`HARNESS_UNEXPECTED_EXTRA_QUERY: "${normalized}"`);
      if (!rule.expect.test(normalized)) {
        throw new Error(`HARNESS_QUERY_MISMATCH at step ${step - 1}: expected /${rule.expect}/ got "${normalized}"`);
      }
      if (rule.error) throw rule.error;
      return rule.result || { rows: [], rowCount: 0 };
    },
    release() {
      calls.push({ step: 'release' });
    },
    _remainingSteps: () => script.length - step,
  };
}

function makeFakePgModule(client) {
  function FakePool() {
    return { connect: async () => client, on: () => {} };
  }
  return { Pool: FakePool };
}

function loadServiceWithFakePg(client) {
  const pgPath = require.resolve('pg');
  delete require.cache[DB_JS_PATH];
  delete require.cache[TASK_WRITE_JS_PATH];
  delete require.cache[SERVICE_JS_PATH];
  const originalPgEntry = require.cache[pgPath];
  require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: makeFakePgModule(client) };
  const service = require(SERVICE_JS_PATH);
  if (originalPgEntry) require.cache[pgPath] = originalPgEntry;
  else delete require.cache[pgPath];
  return service;
}

const MOCK_CONFIG = {
  PHF_HR_DB_HOST: 'mock-host-not-real',
  PHF_HR_DB_PORT: 5432,
  PHF_HR_DB_NAME: 'mock-db-not-real',
  PHF_HR_DB_RUNTIME_USER: 'mock-user-not-real',
  PHF_HR_DB_RUNTIME_PASSWORD: 'mock-password-not-real',
};

// ---------------------------------------------------------------------------
// Spy trên lib/attachment-storage.js — module attachment-service.js gọi
// storage.<fn>(...) qua property access mỗi lần (KHÔNG destructure ở đầu
// file), nên monkeypatch property trên object module (cùng 1 instance do
// require cache) chặn được lời gọi thật sự từ attachment-service.js.
// ---------------------------------------------------------------------------
function spyOnStorage(names) {
  const originals = {};
  const calls = {};
  names.forEach((name) => {
    originals[name] = storage[name];
    calls[name] = 0;
    storage[name] = (...args) => {
      calls[name] += 1;
      return originals[name](...args);
    };
  });
  return {
    calls,
    restore() {
      names.forEach((name) => { storage[name] = originals[name]; });
    },
  };
}

// ---------------------------------------------------------------------------
// Query regex — verbatim từ test-task-write-mock-harness.js (Gate 5.4).
// ---------------------------------------------------------------------------
const SELECT_ATTACHMENT_BY_OBJECT_KEY = /^SELECT \* FROM task\.attachments WHERE stored_object_key = \$1 LIMIT 1$/;
const INSERT_ATTACHMENTS = /^INSERT INTO task\.attachments \(/;
const SELECT_ATTACHMENT_FOR_UPDATE = /^SELECT id, status FROM task\.attachments WHERE id = \$1 AND task_id = \$2 FOR UPDATE$/;
const UPDATE_ATTACHMENTS = /^UPDATE task\.attachments/;
const SELECT_ATTACHMENT_FOR_DOWNLOAD = /^SELECT \* FROM task\.attachments WHERE id = \$1 AND task_id = \$2 AND status = 'active' LIMIT 1$/;
const INSERT_EVENTS_GENERIC = /^INSERT INTO task\.events/;
const BEGIN = /^BEGIN$/;
const SET_ROLE = /^SET LOCAL ROLE phf_hr_app$/;
const COMMIT = /^COMMIT$/;
const ROLLBACK = /^ROLLBACK$/;

function findNullSteps() {
  return [
    { expect: BEGIN, result: {} },
    { expect: SET_ROLE, result: {} },
    { expect: SELECT_ATTACHMENT_BY_OBJECT_KEY, result: { rows: [], rowCount: 0 } },
    { expect: COMMIT, result: {} },
  ];
}
function countActiveSteps(n) {
  return [
    { expect: BEGIN, result: {} },
    { expect: SET_ROLE, result: {} },
    { expect: /^SELECT count\(\*\)::int AS n FROM task\.attachments WHERE task_id = \$1 AND status = 'active'$/, result: { rows: [{ n: n || 0 }] } },
    { expect: COMMIT, result: {} },
  ];
}
function findFoundSteps(row) {
  return [
    { expect: BEGIN, result: {} },
    { expect: SET_ROLE, result: {} },
    { expect: SELECT_ATTACHMENT_BY_OBJECT_KEY, result: { rows: [row], rowCount: 1 } },
    { expect: COMMIT, result: {} },
  ];
}
function insertAttachmentSteps(row) {
  return [
    { expect: BEGIN, result: {} },
    { expect: SET_ROLE, result: {} },
    { expect: INSERT_ATTACHMENTS, result: { rows: [row], rowCount: 1 } },
    { expect: INSERT_EVENTS_GENERIC, result: { rowCount: 1 } },
    { expect: COMMIT, result: {} },
  ];
}

function bufferReadable(buf) {
  return Readable.from(buf);
}

function trackedReadable(buf) {
  let touched = false;
  const readable = new Readable({
    read() {
      touched = true;
      this.push(buf);
      this.push(null);
    },
  });
  return { readable, wasTouched: () => touched };
}

function erroringReadable(message) {
  return new Readable({
    read() {
      process.nextTick(() => this.destroy(new Error(message)));
    },
  });
}

function sha256Of(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function listTmpDirFiles(root) {
  const tmpDir = path.join(root, storage.TMP_DIR_NAME);
  if (!fs.existsSync(tmpDir)) return [];
  return fs.readdirSync(tmpDir);
}

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'phf-attachment-service-g55-'));

function uuid() {
  return crypto.randomUUID();
}

(async () => {
  // =========================================================================
  // UPLOAD
  // =========================================================================

  // 1) Fresh success
  {
    const taskId = uuid();
    const idempotencyKey = uuid();
    const actor = 'PHF001';
    const filename = 'minh-chung.jpg';
    const content = Buffer.from('phf-g5.5-fresh-upload-content');
    const objectKey = storage.buildObjectKey({ taskId, actorEmployeeCode: actor, idempotencyKey });

    const client = makeFakeClient([
      ...findNullSteps(),
      ...countActiveSteps(),
      ...insertAttachmentSteps({ id: 'att-fresh-1', task_id: taskId, status: 'active', stored_object_key: objectKey }),
    ]);
    const service = loadServiceWithFakePg(client);

    const out = await service.uploadAttachment(MOCK_CONFIG, {
      storageRoot: ROOT, taskId, actorEmployeeCode: actor, idempotencyKey,
      originalFilename: filename, mimeType: 'image/jpeg', readableStream: bufferReadable(content),
    });

    const finalPath = storage.resolveFinalPath(ROOT, objectKey);
    const insertCall = client.calls.find((c) => INSERT_ATTACHMENTS.test(c.sql));
    record(
      'upload_1_fresh_success',
      out.replayed === false &&
        out.attachment.id === 'att-fresh-1' &&
        fs.existsSync(finalPath) &&
        fs.readFileSync(finalPath).equals(content) &&
        insertCall.params[5] === content.length &&
        insertCall.params[6] === sha256Of(content) &&
        client._remainingSteps() === 0 &&
        listTmpDirFiles(ROOT).length === 0,
      { out }
    );
  }

  // 2) Replay — DB row already exists -> KHÔNG stream/upload lại
  {
    const taskId = uuid();
    const idempotencyKey = uuid();
    const actor = 'PHF001';
    const objectKey = storage.buildObjectKey({ taskId, actorEmployeeCode: actor, idempotencyKey });
    const winner = { id: 'att-replay-1', task_id: taskId, status: 'active', stored_object_key: objectKey };

    const client = makeFakeClient(findFoundSteps(winner));
    const service = loadServiceWithFakePg(client);

    const { readable, wasTouched } = trackedReadable(Buffer.from('should-not-be-read'));
    const out = await service.uploadAttachment(MOCK_CONFIG, {
      storageRoot: ROOT, taskId, actorEmployeeCode: actor, idempotencyKey,
      originalFilename: 'x.png', mimeType: 'image/png', readableStream: readable,
    });

    record(
      'upload_2_replay_noStreamNoDuplicateEvent',
      out.replayed === true && out.attachment.id === 'att-replay-1' &&
        wasTouched() === false && client._remainingSteps() === 0,
      { out }
    );
  }

  // 2b) FILE ATTACHMENT V1 — per-task cap. 20 active -> reject BEFORE streaming.
  {
    const taskId = uuid();
    const idempotencyKey = uuid();
    const actor = 'PHF001';

    const client = makeFakeClient([...findNullSteps(), ...countActiveSteps(20)]);
    const service = loadServiceWithFakePg(client);

    const { readable, wasTouched } = trackedReadable(Buffer.from('should-not-be-read'));
    let error;
    try {
      await service.uploadAttachment(MOCK_CONFIG, {
        storageRoot: ROOT, taskId, actorEmployeeCode: actor, idempotencyKey,
        originalFilename: 'over-limit.pdf', mimeType: 'application/pdf', readableStream: readable,
      });
    } catch (e) { error = e; }

    record(
      'upload_2b_perTaskCap_reject_noStream',
      error && error.code === 'ATTACHMENT_ORCHESTRATION_LIMIT_REACHED' && wasTouched() === false &&
        client._remainingSteps() === 0 && listTmpDirFiles(ROOT).length === 0,
      { code: error && error.code }
    );
  }

  // 3) Empty file reject
  {
    const taskId = uuid();
    const idempotencyKey = uuid();
    const actor = 'PHF001';

    const client = makeFakeClient([...findNullSteps(), ...countActiveSteps()]);
    const service = loadServiceWithFakePg(client);

    let error;
    try {
      await service.uploadAttachment(MOCK_CONFIG, {
        storageRoot: ROOT, taskId, actorEmployeeCode: actor, idempotencyKey,
        originalFilename: 'empty.png', mimeType: 'image/png', readableStream: bufferReadable(Buffer.alloc(0)),
      });
    } catch (e) { error = e; }

    record(
      'upload_3_emptyFile_reject_tempCleaned',
      error && error.code === 'ATTACHMENT_ORCHESTRATION_EMPTY_FILE' && listTmpDirFiles(ROOT).length === 0,
      { code: error && error.code }
    );
  }

  // 4) MIME reject — fail trước khi chạm DB/FS
  {
    const taskId = uuid();
    const idempotencyKey = uuid();
    const actor = 'PHF001';

    const client = makeFakeClient([]);
    const service = loadServiceWithFakePg(client);

    let error;
    try {
      await service.uploadAttachment(MOCK_CONFIG, {
        storageRoot: ROOT, taskId, actorEmployeeCode: actor, idempotencyKey,
        originalFilename: 'x.zip', mimeType: 'application/zip', readableStream: bufferReadable(Buffer.from('x')),
      });
    } catch (e) { error = e; }

    record(
      'upload_4_mimeInvalid_noDbNoFsCall',
      error && error.code === 'ATTACHMENT_ORCHESTRATION_MIME_INVALID' && client.calls.length === 0,
      { code: error && error.code }
    );
  }

  // 5) Over-size stream abort (byte thật, KHÔNG dựa Content-Length)
  {
    const taskId = uuid();
    const idempotencyKey = uuid();
    const actor = 'PHF001';
    const { MAX_FILE_SIZE } = require('./lib/attachment-policy');
    const oversized = Buffer.alloc(MAX_FILE_SIZE + 1024, 7);

    const client = makeFakeClient([...findNullSteps(), ...countActiveSteps()]);
    const service = loadServiceWithFakePg(client);

    let error;
    try {
      await service.uploadAttachment(MOCK_CONFIG, {
        storageRoot: ROOT, taskId, actorEmployeeCode: actor, idempotencyKey,
        originalFilename: 'big.pdf', mimeType: 'application/pdf', readableStream: bufferReadable(oversized),
      });
    } catch (e) { error = e; }

    record(
      'upload_5_overSize_abort_tempCleaned',
      error && error.code === 'ATTACHMENT_STORAGE_TOO_LARGE' && listTmpDirFiles(ROOT).length === 0,
      { code: error && error.code }
    );
  }

  // 6) Temp cleanup khi readable stream tự lỗi giữa chừng
  {
    const taskId = uuid();
    const idempotencyKey = uuid();
    const actor = 'PHF001';

    const client = makeFakeClient([...findNullSteps(), ...countActiveSteps()]);
    const service = loadServiceWithFakePg(client);

    let error;
    try {
      await service.uploadAttachment(MOCK_CONFIG, {
        storageRoot: ROOT, taskId, actorEmployeeCode: actor, idempotencyKey,
        originalFilename: 'x.png', mimeType: 'image/png', readableStream: erroringReadable('stream boom'),
      });
    } catch (e) { error = e; }

    record(
      'upload_6_streamFailure_tempCleaned',
      !!error && listTmpDirFiles(ROOT).length === 0,
      { code: error && error.code }
    );
  }

  // 8/9) Claim loser — KHÔNG overwrite, KHÔNG unlink winner (fresh in-flight claim)
  {
    const taskId = uuid();
    const idempotencyKey = uuid();
    const actor = 'PHF001';
    const objectKey = storage.buildObjectKey({ taskId, actorEmployeeCode: actor, idempotencyKey });
    const finalPath = storage.resolveFinalPath(ROOT, objectKey);
    const winnerContent = Buffer.from('winner-owns-this-final-path');
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    fs.writeFileSync(finalPath, winnerContent); // simulate concurrent in-flight claim, fresh mtime

    const client = makeFakeClient([...findNullSteps(), ...countActiveSteps(), ...findNullSteps()]);
    const service = loadServiceWithFakePg(client);

    let error;
    try {
      await service.uploadAttachment(MOCK_CONFIG, {
        storageRoot: ROOT, taskId, actorEmployeeCode: actor, idempotencyKey,
        originalFilename: 'loser.jpg', mimeType: 'image/jpeg', readableStream: bufferReadable(Buffer.from('loser-content')),
      });
    } catch (e) { error = e; }

    record(
      'upload_8_9_claimLoser_freshInFlight_noOverwriteNoUnlink',
      error && error.code === 'ATTACHMENT_ORCHESTRATION_UPLOAD_IN_PROGRESS' &&
        fs.readFileSync(finalPath).equals(winnerContent) &&
        listTmpDirFiles(ROOT).length === 0,
      { code: error && error.code }
    );
  }

  // 10) Claim loser — DB winner xuất hiện đúng lúc re-check (concurrent request đã publish xong)
  {
    const taskId = uuid();
    const idempotencyKey = uuid();
    const actor = 'PHF001';
    const objectKey = storage.buildObjectKey({ taskId, actorEmployeeCode: actor, idempotencyKey });
    const finalPath = storage.resolveFinalPath(ROOT, objectKey);
    const winnerContent = Buffer.from('winner-already-published-and-recorded');
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    fs.writeFileSync(finalPath, winnerContent);
    const winnerRow = { id: 'att-winner-10', task_id: taskId, status: 'active', stored_object_key: objectKey };

    const client = makeFakeClient([...findNullSteps(), ...countActiveSteps(), ...findFoundSteps(winnerRow)]);
    const service = loadServiceWithFakePg(client);

    const out = await service.uploadAttachment(MOCK_CONFIG, {
      storageRoot: ROOT, taskId, actorEmployeeCode: actor, idempotencyKey,
      originalFilename: 'loser2.jpg', mimeType: 'image/jpeg', readableStream: bufferReadable(Buffer.from('loser2-content')),
    });

    record(
      'upload_10_claimLoser_dbWinnerAppearsOnRecheck_returnsWinner',
      out.replayed === true && out.attachment.id === 'att-winner-10' &&
        fs.readFileSync(finalPath).equals(winnerContent) &&
        listTmpDirFiles(ROOT).length === 0 && client._remainingSteps() === 0,
      { out }
    );
  }

  // 11) DB metadata failure SAU KHI publish physical final — KHÔNG unlink, physical file đứng nguyên
  let orphanFinalPath, orphanContent, orphanTaskId, orphanIdempotencyKey, orphanActor;
  {
    const taskId = uuid();
    const idempotencyKey = uuid();
    const actor = 'PHF001';
    const objectKey = storage.buildObjectKey({ taskId, actorEmployeeCode: actor, idempotencyKey });
    const finalPath = storage.resolveFinalPath(ROOT, objectKey);
    const content = Buffer.from('published-then-db-fails-orphan');

    const client = makeFakeClient([
      ...findNullSteps(),
      ...countActiveSteps(),
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: INSERT_ATTACHMENTS, error: Object.assign(new Error('connection lost'), { code: 'ECONNRESET' }) },
      { expect: ROLLBACK, result: {} },
    ]);
    const service = loadServiceWithFakePg(client);

    let error;
    try {
      await service.uploadAttachment(MOCK_CONFIG, {
        storageRoot: ROOT, taskId, actorEmployeeCode: actor, idempotencyKey,
        originalFilename: 'orphan.jpg', mimeType: 'image/jpeg', readableStream: bufferReadable(content),
      });
    } catch (e) { error = e; }

    record(
      'upload_11_dbFailureAfterPublish_noUnlink_fileStandsAsOrphan',
      error && error.code === 'ATTACHMENT_ORCHESTRATION_METADATA_FAILED_AFTER_PUBLISH' &&
        error.cause && error.cause.code === 'ECONNRESET' &&
        error.detail && error.detail.objectKey === objectKey &&
        fs.existsSync(finalPath) && fs.readFileSync(finalPath).equals(content) &&
        listTmpDirFiles(ROOT).length === 0,
      { code: error && error.code }
    );

    orphanFinalPath = finalPath;
    orphanContent = content;
    orphanTaskId = taskId;
    orphanIdempotencyKey = idempotencyKey;
    orphanActor = actor;
  }

  // 12) Compensation qua retry — SAU grace, DB vẫn xác nhận absent -> reclaim -> claim lại -> publish -> DB create OK
  {
    const { STALE_CLAIM_GRACE_MS } = require('./lib/attachment-policy');
    const staleMtime = new Date(Date.now() - STALE_CLAIM_GRACE_MS - 5000);
    fs.utimesSync(orphanFinalPath, staleMtime, staleMtime);

    const objectKey = storage.buildObjectKey({ taskId: orphanTaskId, actorEmployeeCode: orphanActor, idempotencyKey: orphanIdempotencyKey });
    const newContent = Buffer.from('retry-after-grace-succeeds');

    const client = makeFakeClient([
      ...findNullSteps(), // replay check
      ...countActiveSteps(), // per-task cap check
      ...findNullSteps(), // loser re-check (winner still absent) -> triggers reclaim
      ...insertAttachmentSteps({ id: 'att-recovered-12', task_id: orphanTaskId, status: 'active', stored_object_key: objectKey }),
    ]);
    const service = loadServiceWithFakePg(client);

    const out = await service.uploadAttachment(MOCK_CONFIG, {
      storageRoot: ROOT, taskId: orphanTaskId, actorEmployeeCode: orphanActor, idempotencyKey: orphanIdempotencyKey,
      originalFilename: 'recovered.jpg', mimeType: 'image/jpeg', readableStream: bufferReadable(newContent),
    });

    record(
      'upload_12_staleOrphan_reclaimedViaRetry_thenPublishesNewContent',
      out.replayed === false && out.attachment.id === 'att-recovered-12' &&
        fs.readFileSync(orphanFinalPath).equals(newContent) &&
        !fs.readFileSync(orphanFinalPath).equals(orphanContent) &&
        listTmpDirFiles(ROOT).length === 0 && client._remainingSteps() === 0,
      { out }
    );
  }

  // 13) 23505 DB race trên chính claim-winner của mình -> self-heal, KHÔNG duplicate logical result
  {
    const taskId = uuid();
    const idempotencyKey = uuid();
    const actor = 'PHF001';
    const objectKey = storage.buildObjectKey({ taskId, actorEmployeeCode: actor, idempotencyKey });
    const finalPath = storage.resolveFinalPath(ROOT, objectKey);
    const content = Buffer.from('race-23505-content');

    const client = makeFakeClient([
      ...findNullSteps(),
      ...countActiveSteps(),
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: INSERT_ATTACHMENTS, error: Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }) },
      { expect: ROLLBACK, result: {} },
      ...findFoundSteps({ id: 'att-race-winner-13', task_id: taskId, status: 'active', stored_object_key: objectKey }),
    ]);
    const service = loadServiceWithFakePg(client);

    const out = await service.uploadAttachment(MOCK_CONFIG, {
      storageRoot: ROOT, taskId, actorEmployeeCode: actor, idempotencyKey,
      originalFilename: 'race.jpg', mimeType: 'image/jpeg', readableStream: bufferReadable(content),
    });

    record(
      'upload_13_dbUniqueRace_selfHeals_noDuplicateEvent',
      out.attachment.id === 'att-race-winner-13' &&
        fs.existsSync(finalPath) && client._remainingSteps() === 0,
      { out }
    );
  }

  // 16) Stale claim NHƯNG DB row exists -> KHÔNG reclaim (DB-winner check thắng trước inspect)
  {
    const taskId = uuid();
    const idempotencyKey = uuid();
    const actor = 'PHF001';
    const objectKey = storage.buildObjectKey({ taskId, actorEmployeeCode: actor, idempotencyKey });
    const finalPath = storage.resolveFinalPath(ROOT, objectKey);
    const existingContent = Buffer.from('stale-but-has-db-row-must-not-reclaim');
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    fs.writeFileSync(finalPath, existingContent);
    const { STALE_CLAIM_GRACE_MS } = require('./lib/attachment-policy');
    const staleMtime = new Date(Date.now() - STALE_CLAIM_GRACE_MS - 5000);
    fs.utimesSync(finalPath, staleMtime, staleMtime);
    const winnerRow = { id: 'att-winner-16', task_id: taskId, status: 'active', stored_object_key: objectKey };

    const client = makeFakeClient([...findNullSteps(), ...countActiveSteps(), ...findFoundSteps(winnerRow)]);
    const service = loadServiceWithFakePg(client);
    const spy = spyOnStorage(['reclaimStaleClaim']);

    const out = await service.uploadAttachment(MOCK_CONFIG, {
      storageRoot: ROOT, taskId, actorEmployeeCode: actor, idempotencyKey,
      originalFilename: 'x.jpg', mimeType: 'image/jpeg', readableStream: bufferReadable(Buffer.from('irrelevant')),
    });
    spy.restore();

    record(
      'upload_16_staleClaim_dbRowExists_neverReclaims',
      out.replayed === true && out.attachment.id === 'att-winner-16' &&
        spy.calls.reclaimStaleClaim === 0 &&
        fs.readFileSync(finalPath).equals(existingContent),
      { out, calls: spy.calls }
    );
  }

  // 17) Path traversal rejected — invalid taskId/actor/idempotencyKey chặn TRƯỚC FS/DB
  {
    const client = makeFakeClient([]);
    const service = loadServiceWithFakePg(client);

    let error;
    try {
      await service.uploadAttachment(MOCK_CONFIG, {
        storageRoot: ROOT, taskId: '../../../etc/passwd', actorEmployeeCode: 'PHF001', idempotencyKey: uuid(),
        originalFilename: 'x.jpg', mimeType: 'image/jpeg', readableStream: bufferReadable(Buffer.from('x')),
      });
    } catch (e) { error = e; }

    record(
      'upload_17_pathTraversal_rejected_noDbNoFsCall',
      error && error.code === 'ATTACHMENT_STORAGE_INVALID_TASK_ID' && client.calls.length === 0,
      { code: error && error.code }
    );
  }

  // 18) Checksum/size từ bytes thật (không phải giá trị caller tự khai)
  {
    const taskId = uuid();
    const idempotencyKey = uuid();
    const actor = 'PHF001';
    const content = Buffer.from('checksum-must-come-from-actual-bytes-streamed');
    const expectedSha = sha256Of(content);
    const objectKey = storage.buildObjectKey({ taskId, actorEmployeeCode: actor, idempotencyKey });

    const client = makeFakeClient([
      ...findNullSteps(),
      ...countActiveSteps(),
      ...insertAttachmentSteps({ id: 'att-checksum-18', task_id: taskId, status: 'active', stored_object_key: objectKey }),
    ]);
    const service = loadServiceWithFakePg(client);

    await service.uploadAttachment(MOCK_CONFIG, {
      storageRoot: ROOT, taskId, actorEmployeeCode: actor, idempotencyKey,
      originalFilename: 'x.jpg', mimeType: 'image/jpeg', readableStream: bufferReadable(content),
    });

    const insertCall = client.calls.find((c) => INSERT_ATTACHMENTS.test(c.sql));
    record(
      'upload_18_checksumSize_fromActualBytes',
      insertCall.params[5] === content.length && insertCall.params[6] === expectedSha,
      { params: insertCall.params }
    );
  }

  // =========================================================================
  // REMOVE
  // =========================================================================

  // 19/20) active -> pending_delete qua DB primitive, KHÔNG chạm storage layer, KHÔNG DELETE SQL
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SELECT_ATTACHMENT_FOR_UPDATE, result: { rows: [{ id: 'att-r1', status: 'active' }], rowCount: 1 } },
      { expect: UPDATE_ATTACHMENTS, result: { rows: [{ id: 'att-r1', status: 'pending_delete', deleted_by_employee_code: 'PHF001' }], rowCount: 1 } },
      { expect: INSERT_EVENTS_GENERIC, result: { rowCount: 1 } },
      { expect: COMMIT, result: {} },
    ]);
    const service = loadServiceWithFakePg(client);
    const spy = spyOnStorage(['claimFinalPath', 'reclaimStaleClaim', 'statFinalPath', 'createFinalReadStream', 'publishTempToFinal']);

    const out = await service.removeAttachment(MOCK_CONFIG, { taskId: 't1', attachmentId: 'att-r1', actorEmployeeCode: 'PHF001', reason: 'Nhầm file.' });
    spy.restore();

    const noDelete = client.calls.filter((c) => c.sql && /^DELETE/i.test(c.sql)).length === 0;
    const noStorageTouch = Object.values(spy.calls).every((n) => n === 0);
    record(
      'remove_19_20_pendingDelete_noPhysicalTouch_noHardDelete',
      out.status === 'pending_delete' && noDelete && noStorageTouch,
      { out, calls: spy.calls }
    );
  }

  // 21) already removed giữ error contract
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SELECT_ATTACHMENT_FOR_UPDATE, result: { rows: [{ id: 'att-r2', status: 'pending_delete' }], rowCount: 1 } },
      { expect: ROLLBACK, result: {} },
    ]);
    const service = loadServiceWithFakePg(client);

    let error;
    try {
      await service.removeAttachment(MOCK_CONFIG, { taskId: 't1', attachmentId: 'att-r2', actorEmployeeCode: 'PHF001' });
    } catch (e) { error = e; }

    record('remove_21_alreadyRemoved_errorContractPreserved', error && error.code === 'TASK_ATTACHMENT_ALREADY_REMOVED', { code: error && error.code });
  }

  // =========================================================================
  // DOWNLOAD
  // =========================================================================

  // 22/25) active -> stream đúng final object, KHÔNG ghi download event
  {
    const taskId = uuid();
    const attachmentId = uuid();
    const idempotencyKey = uuid();
    const actor = 'PHF001';
    const objectKey = storage.buildObjectKey({ taskId, actorEmployeeCode: actor, idempotencyKey });
    const finalPath = storage.resolveFinalPath(ROOT, objectKey);
    const content = Buffer.from('download-active-object-content');
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    fs.writeFileSync(finalPath, content);

    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SELECT_ATTACHMENT_FOR_DOWNLOAD, result: { rows: [{ id: attachmentId, task_id: taskId, status: 'active', stored_object_key: objectKey }], rowCount: 1 } },
      { expect: COMMIT, result: {} },
    ]);
    const service = loadServiceWithFakePg(client);

    const out = await service.downloadAttachment(MOCK_CONFIG, { taskId, attachmentId, storageRoot: ROOT });
    const streamed = await readAll(out.stream);
    const noEventInsert = client.calls.filter((c) => INSERT_EVENTS_GENERIC.test(c.sql)).length === 0;

    record(
      'download_22_25_activeStreamsCorrectObject_noDownloadEvent',
      streamed.equals(content) && out.attachment.id === attachmentId && noEventInsert && client._remainingSteps() === 0,
      { size: streamed.length }
    );
  }

  // 23) pending_delete/not found -> không mở filesystem
  {
    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SELECT_ATTACHMENT_FOR_DOWNLOAD, result: { rows: [], rowCount: 0 } },
      { expect: ROLLBACK, result: {} },
    ]);
    const service = loadServiceWithFakePg(client);
    const spy = spyOnStorage(['resolveFinalPath', 'statFinalPath', 'createFinalReadStream']);

    let error;
    try {
      await service.downloadAttachment(MOCK_CONFIG, { taskId: 't1', attachmentId: 'missing-or-pending-delete', storageRoot: ROOT });
    } catch (e) { error = e; }
    spy.restore();

    const noFsTouch = Object.values(spy.calls).every((n) => n === 0);
    record(
      'download_23_notFoundOrPendingDelete_noFilesystemOpen',
      error && error.code === 'TASK_ATTACHMENT_NOT_FOUND' && noFsTouch,
      { code: error && error.code, calls: spy.calls }
    );
  }

  // 24) physical object missing -> fail sạch, KHÔNG mutate DB
  {
    const taskId = uuid();
    const attachmentId = uuid();
    const objectKey = 'tasks/' + taskId + '/PHF001/' + uuid();

    const client = makeFakeClient([
      { expect: BEGIN, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SELECT_ATTACHMENT_FOR_DOWNLOAD, result: { rows: [{ id: attachmentId, task_id: taskId, status: 'active', stored_object_key: objectKey }], rowCount: 1 } },
      { expect: COMMIT, result: {} },
    ]);
    const service = loadServiceWithFakePg(client);

    let error;
    try {
      await service.downloadAttachment(MOCK_CONFIG, { taskId, attachmentId, storageRoot: ROOT });
    } catch (e) { error = e; }

    record(
      'download_24_physicalObjectMissing_failsClean_noDbMutation',
      error && error.code === 'ATTACHMENT_STORAGE_OBJECT_NOT_FOUND' && client._remainingSteps() === 0,
      { code: error && error.code }
    );
  }

  // =========================================================================
  // Cleanup + summary
  // =========================================================================
  fs.rmSync(ROOT, { recursive: true, force: true });

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${total} PASS`);
  if (passed !== total) {
    console.log('FAILED:', results.filter((r) => !r.pass).map((r) => r.name));
    process.exitCode = 1;
  }
})().catch((err) => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  console.error('HARNESS_CRASH', err);
  process.exitCode = 1;
});
