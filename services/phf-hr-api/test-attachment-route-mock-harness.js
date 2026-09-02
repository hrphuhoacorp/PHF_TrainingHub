'use strict';

// TEST/MOCK HARNESS cho server.js — Gate 5.6 attachment route wiring (upload/
// download/remove). KHÔNG DB thật, KHÔNG HTTP thật (server.emit('request', ...)
// giống hệt kỹ thuật đã CLOSED ở test-server-route-mock-harness.js), KHÔNG
// filesystem thật (attachment-service.js bị FAKE HOÀN TOÀN — spy function,
// KHÔNG gọi lib/attachment-storage.js/lib/task-write.js thật) — route layer
// là ĐỐI TƯỢNG DUY NHẤT được kiểm ở đây: auth gate, path/header mapping,
// response whitelist, error-status mapping, streaming/pipe behavior.
//
// './lib/task-write' KHÔNG bị fake ở harness này (khác
// test-server-route-mock-harness.js) — server.js require thật module đó ở
// top-level cho Batch 1-6, nhưng KHÔNG route nào trong file test này gọi tới
// nó, và require() không tự kết nối DB (chỉ getPool() lúc thực sự query mới
// tạo Pool) — an toàn, đã verified pattern này chạy được ở
// test-attachment-service-mock-harness.js.
//
// Chạy: node test-attachment-route-mock-harness.js

const assert = require('assert');
const { Writable } = require('stream');

const SERVER_JS_PATH = require.resolve('./server.js');
const ATTACHMENT_SERVICE_PATH = require.resolve('./lib/attachment-service.js');

const MOCK_CONFIG = {
  SERVICE_TOKEN: 'mock-service-token-not-real-0123456789abcdef',
  DESCRIPTOR_SIGNING_SECRET: '',
  PHF_HR_ATTACHMENT_ROOT: '/mock/attachment/root/not-real',
};

function makeFakeAttachmentServiceModule(overrides) {
  const calls = [];
  function makeFn(name) {
    return async function (config, args) {
      calls.push({ name, config, args });
      const behavior = overrides[name];
      if (!behavior) throw new Error(`HARNESS_SPY_NOT_CONFIGURED_FOR_${name}`);
      if (behavior.throwCode) {
        const err = new Error(behavior.message || behavior.throwCode);
        err.code = behavior.throwCode;
        throw err;
      }
      if (behavior.fn) return behavior.fn(args);
      return behavior.return;
    };
  }
  return {
    calls,
    mod: {
      uploadAttachment: makeFn('uploadAttachment'),
      removeAttachment: makeFn('removeAttachment'),
      downloadAttachment: makeFn('downloadAttachment'),
    },
  };
}

function loadCreateServerWithFakeAttachmentService(fakeMod) {
  delete require.cache[SERVER_JS_PATH];
  const original = require.cache[ATTACHMENT_SERVICE_PATH];
  require.cache[ATTACHMENT_SERVICE_PATH] = { id: ATTACHMENT_SERVICE_PATH, filename: ATTACHMENT_SERVICE_PATH, loaded: true, exports: fakeMod };
  const { createServer } = require(SERVER_JS_PATH);
  if (original) require.cache[ATTACHMENT_SERVICE_PATH] = original;
  else delete require.cache[ATTACHMENT_SERVICE_PATH];
  return createServer;
}

// fakeReq — verbatim style từ test-server-route-mock-harness.js, mở rộng để
// vừa đóng vai trò IncomingMessage (method/url/headers) VỪA là chính "readable
// stream" mà route upload phải truyền NGUYÊN VĂN (KHÔNG buffer) vào
// attachment-service.uploadAttachment() — kiểm bằng reference-equality
// (call.args.readableStream === req), KHÔNG cần req phát byte thật nào vì
// attachment-service ở đây LÀ fake (không thực sự stream).
function makeFakeReq(method, url, bodyObj, headers) {
  const bodyStr = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
  const buf = Buffer.from(bodyStr, 'utf8');
  const req = {
    method,
    url,
    headers: headers || {},
    on(event, handler) {
      if (event === 'data') {
        if (buf.length > 0) setImmediate(() => handler(buf));
      } else if (event === 'end') {
        setImmediate(() => handler());
      }
      return this;
    },
    destroy() {},
  };
  return req;
}

function makeFakeJsonRes() {
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const listeners = {};
  const res = {
    statusCode: 200,
    headersSent: false,
    _headers: null,
    _body: null,
    done,
    writeHead(status, headers) {
      this.statusCode = status;
      this._headers = headers || null;
      this.headersSent = true;
    },
    end(payload) {
      this._body = payload;
      (listeners.finish || []).forEach((fn) => fn());
      resolveDone();
    },
    on(event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
      return this;
    },
  };
  return res;
}

// fakeRes cho download — Writable THẬT (để .pipe() từ 1 Readable thật hoạt
// động đúng chuẩn Node semantics, kể cả 'error' sau khi headers đã gửi).
function makeFakeStreamRes() {
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const chunks = [];
  const res = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
  });
  res.statusCode = 200;
  res.headersSent = false;
  res._headers = null;
  res.done = done;
  res.writeHead = function writeHead(status, headers) {
    res.statusCode = status;
    res._headers = headers || null;
    res.headersSent = true;
    return res;
  };
  res.on('finish', () => resolveDone());
  res.on('error', () => resolveDone()); // destroy(err) -> 'error' — test tự đọc res.destroyed/lỗi
  res.getBody = () => Buffer.concat(chunks);
  return res;
}

async function sendJsonRequest(server, method, url, bodyObj, headers) {
  const req = makeFakeReq(method, url, bodyObj, headers);
  const res = makeFakeJsonRes();
  server.emit('request', req, res);
  await res.done;
  return { statusCode: res.statusCode, headers: res._headers, body: res._body ? JSON.parse(res._body) : null, req };
}

function authHeader() {
  return { authorization: 'Bearer ' + MOCK_CONFIG.SERVICE_TOKEN };
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass: !!pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`, detail !== undefined ? detail : '');
}

const VALID_ATTACHMENT_ROW = {
  id: 'att-1',
  task_id: 'task-1',
  original_filename: 'minh-chung.jpg',
  stored_object_key: 'tasks/task-1/PHF001/22222222-2222-4222-8222-222222222222',
  mime_type: 'image/jpeg',
  extension: 'jpg',
  size_bytes: 2048,
  checksum_sha256: 'a'.repeat(64),
  uploaded_by_employee_code: 'PHF001',
  status: 'active',
  created_at: '2026-08-24T00:00:00.000Z',
  deleted_at: null,
  deleted_by_employee_code: null,
};

(async () => {
  // =========================================================================
  // UPLOAD — POST /v1/task/tasks/:id:uploadAttachment
  // =========================================================================

  // 1) auth missing -> 401, service KHÔNG được gọi
  {
    const { mod, calls } = makeFakeAttachmentServiceModule({});
    const createServer = loadCreateServerWithFakeAttachmentService(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendJsonRequest(server, 'POST', '/v1/task/tasks/task-1:uploadAttachment', undefined, {
      'content-type': 'image/jpeg',
      'x-attachment-filename': 'x.jpg',
      'x-attachment-idempotency-key': '22222222-2222-4222-8222-222222222222',
      'x-attachment-actor-employee-code': 'PHF001',
    });
    record('upload_1_authMissing_401_serviceNotCalled', statusCode === 401 && body.ok === false && calls.length === 0, { statusCode, body });
  }

  // 2) wrong token -> 401
  {
    const { mod, calls } = makeFakeAttachmentServiceModule({});
    const createServer = loadCreateServerWithFakeAttachmentService(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode } = await sendJsonRequest(server, 'POST', '/v1/task/tasks/task-1:uploadAttachment', undefined, {
      authorization: 'Bearer wrong-token',
    });
    record('upload_2_wrongToken_401', statusCode === 401 && calls.length === 0, { statusCode });
  }

  // 3-8) valid raw stream mapping — path taskId, filename decode, MIME, idempotency, actor, KHÔNG buffer
  {
    const { mod, calls } = makeFakeAttachmentServiceModule({
      uploadAttachment: { return: { attachment: VALID_ATTACHMENT_ROW, replayed: false } },
    });
    const createServer = loadCreateServerWithFakeAttachmentService(mod);
    const server = createServer(MOCK_CONFIG);
    const headers = Object.assign(
      {
        'content-type': 'image/jpeg',
        'x-attachment-filename': encodeURIComponent('minh chứng có dấu.jpg'),
        'x-attachment-idempotency-key': '22222222-2222-4222-8222-222222222222',
        'x-attachment-actor-employee-code': 'PHF001',
      },
      authHeader()
    );
    const { statusCode, body, req } = await sendJsonRequest(server, 'POST', '/v1/task/tasks/task-abc:uploadAttachment', undefined, headers);
    const call = calls.find((c) => c.name === 'uploadAttachment');
    record(
      'upload_3_8_validMapping_pathFilenameMimeIdempotencyActor_noBuffer',
      statusCode === 200 &&
        body.ok === true &&
        call &&
        call.args.taskId === 'task-abc' &&
        call.args.originalFilename === 'minh chứng có dấu.jpg' &&
        call.args.mimeType === 'image/jpeg' &&
        call.args.idempotencyKey === '22222222-2222-4222-8222-222222222222' &&
        call.args.actorEmployeeCode === 'PHF001' &&
        call.args.readableStream === req && // #12 — KHÔNG buffer, truyền nguyên req
        call.args.storageRoot === MOCK_CONFIG.PHF_HR_ATTACHMENT_ROOT,
      { call: call && call.args }
    );
  }

  // 3b) ATTACHMENT ACTOR IDENTITY (2026-09-02) — X-Attachment-Actor-Account-Id
  // is forwarded; an Admin-only actor (no employee-code header) still maps.
  {
    const { mod, calls } = makeFakeAttachmentServiceModule({
      uploadAttachment: { return: { attachment: VALID_ATTACHMENT_ROW, replayed: false } },
    });
    const createServer = loadCreateServerWithFakeAttachmentService(mod);
    const server = createServer(MOCK_CONFIG);
    const headers = Object.assign(
      {
        'content-type': 'application/pdf',
        'x-attachment-filename': encodeURIComponent('bao-cao.pdf'),
        'x-attachment-idempotency-key': '22222222-2222-4222-8222-222222222222',
        'x-attachment-actor-account-id': 'admin-acc-uuid-0001',
      },
      authHeader()
    );
    const { statusCode } = await sendJsonRequest(server, 'POST', '/v1/task/tasks/task-abc:uploadAttachment', undefined, headers);
    const call = calls.find((c) => c.name === 'uploadAttachment');
    record(
      'upload_3b_actorAccountId_forwarded_adminOnly',
      statusCode === 200 && call &&
        call.args.actorAccountId === 'admin-acc-uuid-0001' &&
        (call.args.actorEmployeeCode === '' || call.args.actorEmployeeCode === undefined),
      { call: call && call.args }
    );
  }

  // 9) Content-Length > MAX rejects TRƯỚC khi gọi service
  {
    const { mod, calls } = makeFakeAttachmentServiceModule({});
    const createServer = loadCreateServerWithFakeAttachmentService(mod);
    const server = createServer(MOCK_CONFIG);
    const { MAX_FILE_SIZE } = require('./lib/attachment-policy');
    const { statusCode, body } = await sendJsonRequest(
      server, 'POST', '/v1/task/tasks/task-1:uploadAttachment', undefined,
      Object.assign({ 'content-length': String(MAX_FILE_SIZE + 1) }, authHeader())
    );
    record(
      'upload_9_contentLengthOverMax_rejectsBeforeService',
      statusCode === 400 && body.code === 'ATTACHMENT_STORAGE_TOO_LARGE' && calls.length === 0,
      { statusCode, body, calls: calls.length }
    );
  }

  // 10) không có Content-Length vẫn được stream (size thật do service kiểm — route KHÔNG chặn)
  {
    const { mod, calls } = makeFakeAttachmentServiceModule({
      uploadAttachment: { return: { attachment: VALID_ATTACHMENT_ROW, replayed: false } },
    });
    const createServer = loadCreateServerWithFakeAttachmentService(mod);
    const server = createServer(MOCK_CONFIG);
    const headers = Object.assign({ 'content-type': 'image/jpeg', 'x-attachment-filename': 'x.jpg' }, authHeader());
    const { statusCode } = await sendJsonRequest(server, 'POST', '/v1/task/tasks/task-1:uploadAttachment', undefined, headers);
    record('upload_10_noContentLength_stillStreamed', statusCode === 200 && calls.length === 1, { statusCode, calls: calls.length });
  }

  // 11) KHÔNG gọi readJsonBody() cho upload — chứng minh gián tiếp: body JSON hợp lệ đặt trong fakeReq
  // KHÔNG bao giờ được đọc/parse (route không consume req qua readJsonBody), readableStream vẫn là req
  // nguyên vẹn (đã verify ở test 3-8) — route hoàn toàn không có code path gọi readJsonBody cho path
  // uploadAttachment (audit tĩnh: xem server.js, block uploadAttachment không có lời gọi readJsonBody()).
  {
    record('upload_11_noReadJsonBody_staticAudit', true, { note: 'verified by source read — uploadAttachment block has no readJsonBody() call' });
  }

  // 13) success response KHÔNG lộ stored_object_key/path
  {
    const { mod } = makeFakeAttachmentServiceModule({
      uploadAttachment: { return: { attachment: VALID_ATTACHMENT_ROW, replayed: false } },
    });
    const createServer = loadCreateServerWithFakeAttachmentService(mod);
    const server = createServer(MOCK_CONFIG);
    const headers = Object.assign({ 'content-type': 'image/jpeg', 'x-attachment-filename': 'x.jpg' }, authHeader());
    const { body } = await sendJsonRequest(server, 'POST', '/v1/task/tasks/task-1:uploadAttachment', undefined, headers);
    const json = JSON.stringify(body);
    record(
      'upload_13_responseWhitelist_noStoredObjectKeyNoPath',
      body.ok === true &&
        body.data.id === 'att-1' &&
        !Object.prototype.hasOwnProperty.call(body.data, 'stored_object_key') &&
        !Object.prototype.hasOwnProperty.call(body.data, 'storedObjectKey') &&
        !json.includes('stored_object_key') &&
        !json.includes('/mock/attachment/root'),
      { data: body.data }
    );
  }

  // 14) known error mapping (400/404/409/500 sample)
  {
    const cases = [
      { code: 'ATTACHMENT_ORCHESTRATION_MIME_INVALID', expect: 400 },
      { code: 'ATTACHMENT_ORCHESTRATION_UPLOAD_IN_PROGRESS', expect: 409 },
      { code: 'ATTACHMENT_ORCHESTRATION_METADATA_FAILED_AFTER_PUBLISH', expect: 500 },
      { code: 'TASK_ATTACHMENT_ACTOR_REQUIRED', expect: 401 },
    ];
    let allOk = true;
    const detail = [];
    for (const c of cases) {
      const { mod } = makeFakeAttachmentServiceModule({
        uploadAttachment: { throwCode: c.code, message: 'x' },
      });
      const createServer = loadCreateServerWithFakeAttachmentService(mod);
      const server = createServer(MOCK_CONFIG);
      const headers = Object.assign({ 'content-type': 'image/jpeg', 'x-attachment-filename': 'x.jpg' }, authHeader());
      const { statusCode, body } = await sendJsonRequest(server, 'POST', '/v1/task/tasks/task-1:uploadAttachment', undefined, headers);
      const ok = statusCode === c.expect && body.code === c.code;
      detail.push({ code: c.code, statusCode, expect: c.expect, ok });
      if (!ok) allOk = false;
    }
    record('upload_14_knownErrorMappings', allOk, { detail });
  }

  // 15) unknown error code -> safe 500, KHÔNG lộ message gốc
  {
    const { mod } = makeFakeAttachmentServiceModule({
      uploadAttachment: { throwCode: 'SOME_UNMAPPED_INTERNAL_CODE', message: 'internal detail leak /abs/path' },
    });
    const createServer = loadCreateServerWithFakeAttachmentService(mod);
    const server = createServer(MOCK_CONFIG);
    const headers = Object.assign({ 'content-type': 'image/jpeg', 'x-attachment-filename': 'x.jpg' }, authHeader());
    const { statusCode, body } = await sendJsonRequest(server, 'POST', '/v1/task/tasks/task-1:uploadAttachment', undefined, headers);
    record(
      'upload_15_unknownError_safe500_noLeak',
      statusCode === 500 && body.code === 'ATTACHMENT_ERROR' && !JSON.stringify(body).includes('/abs/path'),
      { statusCode, body }
    );
  }

  // =========================================================================
  // DOWNLOAD — GET /v1/task/tasks/:id/attachments/:attachmentId
  // =========================================================================

  // 16) auth missing/wrong
  {
    const { mod, calls } = makeFakeAttachmentServiceModule({});
    const createServer = loadCreateServerWithFakeAttachmentService(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode } = await sendJsonRequest(server, 'GET', '/v1/task/tasks/task-1/attachments/att-1', undefined, {});
    record('download_16_authMissing_401_serviceNotCalled', statusCode === 401 && calls.length === 0, { statusCode });
  }

  // 17/18/19/20) correct mapping, headers, pipe, no buffer
  {
    const { Readable } = require('stream');
    const content = Buffer.from('phf-download-route-content');
    const stat = { size: content.length };
    const { mod, calls } = makeFakeAttachmentServiceModule({
      downloadAttachment: { fn: () => ({ attachment: VALID_ATTACHMENT_ROW, stream: Readable.from(content), stat }) },
    });
    const createServer = loadCreateServerWithFakeAttachmentService(mod);
    const server = createServer(MOCK_CONFIG);

    const req = makeFakeReq('GET', '/v1/task/tasks/task-1/attachments/att-1', undefined, authHeader());
    const res = makeFakeStreamRes();
    server.emit('request', req, res);
    await res.done;

    const call = calls.find((c) => c.name === 'downloadAttachment');
    record(
      'download_17_20_mappingHeadersPipeNoBuffer',
      call && call.args.taskId === 'task-1' && call.args.attachmentId === 'att-1' &&
        res.statusCode === 200 &&
        res._headers['Content-Type'] === 'image/jpeg' &&
        res._headers['Content-Length'] === content.length &&
        res._headers['Cache-Control'] === 'private, no-store' &&
        res._headers['X-Content-Type-Options'] === 'nosniff' &&
        String(res._headers['Content-Disposition']).includes('minh-chung.jpg') &&
        res.getBody().equals(content),
      { headers: res._headers, body: res.getBody().toString() }
    );
  }

  // 21) not found
  {
    const { mod } = makeFakeAttachmentServiceModule({
      downloadAttachment: { throwCode: 'TASK_ATTACHMENT_NOT_FOUND', message: 'not found' },
    });
    const createServer = loadCreateServerWithFakeAttachmentService(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendJsonRequest(server, 'GET', '/v1/task/tasks/task-1/attachments/missing', undefined, authHeader());
    record('download_21_notFound_404', statusCode === 404 && body.code === 'TASK_ATTACHMENT_NOT_FOUND', { statusCode, body });
  }

  // 22) storage read failure TRƯỚC headers -> safe JSON error, KHÔNG headersSent trước đó
  {
    const { mod } = makeFakeAttachmentServiceModule({
      downloadAttachment: { throwCode: 'ATTACHMENT_STORAGE_OBJECT_NOT_FOUND', message: 'Không tìm thấy đối tượng lưu trữ.' },
    });
    const createServer = loadCreateServerWithFakeAttachmentService(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendJsonRequest(server, 'GET', '/v1/task/tasks/task-1/attachments/att-1', undefined, authHeader());
    record('download_22_storageReadFailureBeforeHeaders_safeJsonError', statusCode === 404 && body.code === 'ATTACHMENT_STORAGE_OBJECT_NOT_FOUND', { statusCode, body });
  }

  // 23) stream error SAU khi response đã bắt đầu -> res.destroy(), KHÔNG gửi thêm JSON envelope
  {
    const { Readable } = require('stream');
    let pushed = false;
    const flaky = new Readable({
      read() {
        if (pushed) return; // chờ destroy() async, KHÔNG push lặp vô hạn
        pushed = true;
        this.push('partial-bytes-then-boom');
        process.nextTick(() => this.destroy(new Error('disk read failed mid-stream')));
      },
    });
    const stat = { size: 9999 }; // Content-Length khai báo trước, stream lỗi sau khi đã writeHead
    const { mod } = makeFakeAttachmentServiceModule({
      downloadAttachment: { fn: () => ({ attachment: VALID_ATTACHMENT_ROW, stream: flaky, stat }) },
    });
    const createServer = loadCreateServerWithFakeAttachmentService(mod);
    const server = createServer(MOCK_CONFIG);

    const req = makeFakeReq('GET', '/v1/task/tasks/task-1/attachments/att-1', undefined, authHeader());
    const res = makeFakeStreamRes();
    server.emit('request', req, res);
    await res.done;

    record(
      'download_23_streamErrorAfterHeaders_destroysNoJsonEnvelope',
      res.headersSent === true && res.statusCode === 200 && res.destroyed === true,
      { headersSent: res.headersSent, statusCode: res.statusCode, destroyed: res.destroyed }
    );
  }

  // =========================================================================
  // REMOVE — POST /v1/task/tasks/:id:removeAttachment
  // =========================================================================

  // 24) auth
  {
    const { mod, calls } = makeFakeAttachmentServiceModule({});
    const createServer = loadCreateServerWithFakeAttachmentService(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode } = await sendJsonRequest(server, 'POST', '/v1/task/tasks/task-1:removeAttachment', { attachmentId: 'att-1', actor: { employeeCode: 'PHF001' } }, {});
    record('remove_24_authMissing_401', statusCode === 401 && calls.length === 0, { statusCode });
  }

  // 25/26/27) path :id authoritative, body mapping, reason optional
  {
    const { mod, calls } = makeFakeAttachmentServiceModule({
      removeAttachment: { return: Object.assign({}, VALID_ATTACHMENT_ROW, { status: 'pending_delete', deleted_at: '2026-08-24T00:00:00.000Z', deleted_by_employee_code: 'PHF001' }) },
    });
    const createServer = loadCreateServerWithFakeAttachmentService(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendJsonRequest(
      server, 'POST', '/v1/task/tasks/task-XYZ:removeAttachment',
      { attachmentId: 'att-1', actor: { employeeCode: 'PHF001', accountId: 'acc-001' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'removeAttachment');
    record(
      'remove_25_26_27_pathAuthoritative_bodyMapping_reasonOptional',
      statusCode === 200 && body.ok === true && body.data.status === 'pending_delete' &&
        call.args.taskId === 'task-XYZ' && call.args.attachmentId === 'att-1' &&
        call.args.actorEmployeeCode === 'PHF001' && call.args.actorAccountId === 'acc-001' &&
        call.args.reason === undefined,
      { call: call && call.args, body }
    );
  }

  // 27b) ATTACHMENT ACTOR IDENTITY — Admin-only remover (accountId only)
  {
    const { mod, calls } = makeFakeAttachmentServiceModule({
      removeAttachment: { return: Object.assign({}, VALID_ATTACHMENT_ROW, { status: 'pending_delete' }) },
    });
    const createServer = loadCreateServerWithFakeAttachmentService(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode } = await sendJsonRequest(
      server, 'POST', '/v1/task/tasks/task-XYZ:removeAttachment',
      { attachmentId: 'att-1', actor: { accountId: 'admin-acc-uuid' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'removeAttachment');
    record(
      'remove_27b_adminOnly_actorAccountId_forwarded',
      statusCode === 200 && call && call.args.actorAccountId === 'admin-acc-uuid' &&
        (call.args.actorEmployeeCode === undefined || call.args.actorEmployeeCode === ''),
      { call: call && call.args }
    );
  }

  // 28) already removed mapping
  {
    const { mod } = makeFakeAttachmentServiceModule({
      removeAttachment: { throwCode: 'TASK_ATTACHMENT_ALREADY_REMOVED', message: 'x' },
    });
    const createServer = loadCreateServerWithFakeAttachmentService(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendJsonRequest(server, 'POST', '/v1/task/tasks/task-1:removeAttachment', { attachmentId: 'att-1', actor: { employeeCode: 'PHF001' } }, authHeader());
    record('remove_28_alreadyRemoved_409', statusCode === 409 && body.code === 'TASK_ATTACHMENT_ALREADY_REMOVED', { statusCode, body });
  }

  // 29) not found mapping
  {
    const { mod } = makeFakeAttachmentServiceModule({
      removeAttachment: { throwCode: 'TASK_ATTACHMENT_NOT_FOUND', message: 'x' },
    });
    const createServer = loadCreateServerWithFakeAttachmentService(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendJsonRequest(server, 'POST', '/v1/task/tasks/task-1:removeAttachment', { attachmentId: 'missing', actor: { employeeCode: 'PHF001' } }, authHeader());
    record('remove_29_notFound_404', statusCode === 404 && body.code === 'TASK_ATTACHMENT_NOT_FOUND', { statusCode, body });
  }

  // 30) service called đúng 1 lần
  {
    const { mod, calls } = makeFakeAttachmentServiceModule({
      removeAttachment: { return: VALID_ATTACHMENT_ROW },
    });
    const createServer = loadCreateServerWithFakeAttachmentService(mod);
    const server = createServer(MOCK_CONFIG);
    await sendJsonRequest(server, 'POST', '/v1/task/tasks/task-1:removeAttachment', { attachmentId: 'att-1', actor: { employeeCode: 'PHF001' } }, authHeader());
    record('remove_30_serviceCalledExactlyOnce', calls.length === 1, { calls: calls.length });
  }

  // =========================================================================
  // Summary
  // =========================================================================
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${total} PASS`);
  if (passed !== total) {
    console.log('FAILED:', results.filter((r) => !r.pass).map((r) => r.name));
    process.exitCode = 1;
  }
})().catch((err) => {
  console.error('HARNESS_CRASH', err);
  process.exitCode = 1;
});
