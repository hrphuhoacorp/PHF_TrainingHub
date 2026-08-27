'use strict';

// TEST/MOCK HARNESS cho server.js — Batch 1 route wiring (3 route write-path
// mới). KHÔNG DB thật, KHÔNG HTTP thật (không mở port/socket nào — dùng
// server.emit('request', fakeReq, fakeRes) để gọi thẳng request handler nội
// bộ, giống hệt cách http.createServer(cb) đăng ký listener 'request', chỉ
// khác là trigger thủ công thay vì qua network thật). KHÔNG sửa server.js/
// lib/task-write.js/lib/db.js — chỉ require rồi test.
//
// Kỹ thuật mock: inject fake module './lib/task-write' vào require.cache
// TRƯỚC khi require server.js, để server.js gọi spy function thay vì DB-layer
// thật — không Pool/pg nào từng được tạo trong toàn bộ file test này.
//
// Chạy: node test-server-route-mock-harness.js

const assert = require('assert');

const SERVER_JS_PATH = require.resolve('./server.js');
const TASK_WRITE_PATH = require.resolve('./lib/task-write.js');

const MOCK_CONFIG = {
  SERVICE_TOKEN: 'mock-service-token-not-real-0123456789abcdef',
  DESCRIPTOR_SIGNING_SECRET: '',
};

function makeFakeTaskWriteModule(overrides) {
  const calls = [];
  function makeFn(name) {
    return async function (config, args) {
      calls.push({ name, config, args });
      const behavior = overrides[name];
      if (!behavior) throw new Error(`HARNESS_SPY_NOT_CONFIGURED_FOR_${name}`);
      if (behavior.throwCode) {
        const err = new Error(behavior.throwCode);
        err.code = behavior.throwCode;
        throw err;
      }
      return behavior.return;
    };
  }
  return {
    calls,
    mod: {
      updateTaskProgress: makeFn('updateTaskProgress'),
      completeTask: makeFn('completeTask'),
      reopenTask: makeFn('reopenTask'),
      cancelTask: makeFn('cancelTask'),
      changeTaskDeadline: makeFn('changeTaskDeadline'),
      createDraftTask: makeFn('createDraftTask'),
      publishTask: makeFn('publishTask'),
      transferTaskPrimary: makeFn('transferTaskPrimary'),
      addTaskRelated: makeFn('addTaskRelated'),
      removeTaskRelated: makeFn('removeTaskRelated'),
      addTaskComment: makeFn('addTaskComment'),
      addTaskLink: makeFn('addTaskLink'),
      removeTaskLink: makeFn('removeTaskLink'),
      setTaskPermissionAssignment: makeFn('setTaskPermissionAssignment'),
      // Gate 12 — Category CRUD + Exception-grant CRUD route wiring.
      createTaskCategory: makeFn('createTaskCategory'),
      renameTaskCategory: makeFn('renameTaskCategory'),
      setTaskCategoryActive: makeFn('setTaskCategoryActive'),
      reorderTaskCategory: makeFn('reorderTaskCategory'),
      deleteTaskCategoryIfUnused: makeFn('deleteTaskCategoryIfUnused'),
      createTaskPermissionGrant: makeFn('createTaskPermissionGrant'),
      revokeTaskPermissionGrant: makeFn('revokeTaskPermissionGrant'),
    },
  };
}

function loadCreateServerWithFakeTaskWrite(fakeMod) {
  delete require.cache[SERVER_JS_PATH];
  const original = require.cache[TASK_WRITE_PATH];
  require.cache[TASK_WRITE_PATH] = { id: TASK_WRITE_PATH, filename: TASK_WRITE_PATH, loaded: true, exports: fakeMod };
  const { createServer } = require(SERVER_JS_PATH);
  if (original) require.cache[TASK_WRITE_PATH] = original;
  else delete require.cache[TASK_WRITE_PATH];
  return createServer;
}

function makeFakeReq(method, url, bodyObj, headers) {
  const bodyStr = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
  const buf = Buffer.from(bodyStr, 'utf8');
  return {
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
}

function makeFakeRes() {
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const listeners = {};
  const res = {
    statusCode: 200,
    headersSent: false,
    _body: null,
    done,
    writeHead(status) {
      this.statusCode = status;
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

async function sendRequest(server, method, url, bodyObj, headers) {
  const req = makeFakeReq(method, url, bodyObj, headers);
  const res = makeFakeRes();
  server.emit('request', req, res);
  await res.done;
  return { statusCode: res.statusCode, body: res._body ? JSON.parse(res._body) : null };
}

function authHeader() {
  return { authorization: 'Bearer ' + MOCK_CONFIG.SERVICE_TOKEN };
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`, detail !== undefined ? detail : '');
}

(async () => {
  // =========================================================================
  // 1) updateProgress — success path: method/path match, body parsing, actor
  // nested-object mapping, rowVersion mapping, đúng function được gọi, response shape
  // =========================================================================
  {
    const { mod, calls } = makeFakeTaskWriteModule({
      updateTaskProgress: { return: { id: 'task-1', row_version: 6, status: 'in_progress' } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server,
      'POST',
      '/v1/task/tasks/task-1:updateProgress',
      { expectedRowVersion: 5, progressPercent: 40, progressStatus: 'dang_thuc_hien', actor: { employeeCode: 'PHF001' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'updateTaskProgress');
    record(
      'updateProgress_SUCCESS_route_and_mapping',
      statusCode === 200 &&
        body.ok === true &&
        body.data.row_version === 6 &&
        call &&
        call.args.taskId === 'task-1' &&
        call.args.expectedRowVersion === 5 &&
        call.args.progressPercent === 40 &&
        call.args.progressStatus === 'dang_thuc_hien' &&
        call.args.actorEmployeeCode === 'PHF001' &&
        call.args.actorAccountId === undefined &&
        calls.length === 1,
      { statusCode, body, callArgs: call && call.args, totalCalls: calls.length }
    );
  }

  // =========================================================================
  // 2) complete — success, actor có cả accountId
  // =========================================================================
  {
    const { mod, calls } = makeFakeTaskWriteModule({
      completeTask: { return: { id: 'task-2', row_version: 4, status: 'completed' } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server,
      'POST',
      '/v1/task/tasks/task-2:complete',
      { expectedRowVersion: 3, resultText: 'Xong.', actor: { employeeCode: '', accountId: 'acct-999' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'completeTask');
    record(
      'complete_SUCCESS_route_and_actor_accountId_mapping',
      statusCode === 200 &&
        body.ok === true &&
        body.data.status === 'completed' &&
        call &&
        call.args.taskId === 'task-2' &&
        call.args.resultText === 'Xong.' &&
        call.args.actorAccountId === 'acct-999' &&
        calls.length === 1,
      { statusCode, body, callArgs: call && call.args }
    );
  }

  // =========================================================================
  // 3) reopen — success
  // =========================================================================
  {
    const { mod, calls } = makeFakeTaskWriteModule({
      reopenTask: { return: { id: 'task-3', row_version: 5, status: 'in_progress' } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server,
      'POST',
      '/v1/task/tasks/task-3:reopen',
      { expectedRowVersion: 4, reason: 'Sai kết quả.', actor: { employeeCode: 'PHF002' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'reopenTask');
    record(
      'reopen_SUCCESS_route_and_mapping',
      statusCode === 200 && body.ok === true && call && call.args.reason === 'Sai kết quả.' && calls.length === 1,
      { statusCode, body, callArgs: call && call.args }
    );
  }

  // =========================================================================
  // 3b) cancel — success + full mapping (path :id, actor, expectedRowVersion, reason)
  // =========================================================================
  {
    const { mod, calls } = makeFakeTaskWriteModule({
      cancelTask: { return: { id: 'task-6', row_version: 9, status: 'cancelled' } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server,
      'POST',
      '/v1/task/tasks/task-6:cancel',
      { expectedRowVersion: 8, reason: 'Khách hủy đơn.', actor: { employeeCode: 'PHF003' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'cancelTask');
    record(
      'cancel_SUCCESS_route_and_mapping',
      statusCode === 200 &&
        body.ok === true &&
        body.data.status === 'cancelled' &&
        call &&
        call.args.taskId === 'task-6' &&
        call.args.expectedRowVersion === 8 &&
        call.args.reason === 'Khách hủy đơn.' &&
        call.args.actorEmployeeCode === 'PHF003' &&
        calls.length === 1,
      { statusCode, body, callArgs: call && call.args }
    );
  }

  // =========================================================================
  // 3c) changeDeadline — success + full mapping (kể cả newDeadline)
  // =========================================================================
  {
    const { mod, calls } = makeFakeTaskWriteModule({
      changeTaskDeadline: { return: { id: 'task-7', row_version: 3, deadline_version: 2 } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server,
      'POST',
      '/v1/task/tasks/task-7:changeDeadline',
      { expectedRowVersion: 2, newDeadline: '2026-09-10T00:00:00.000Z', reason: 'Khách hàng dời lịch.', actor: { employeeCode: 'PHF004' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'changeTaskDeadline');
    record(
      'changeDeadline_SUCCESS_route_and_mapping',
      statusCode === 200 &&
        body.ok === true &&
        body.data.deadline_version === 2 &&
        call &&
        call.args.taskId === 'task-7' &&
        call.args.newDeadline === '2026-09-10T00:00:00.000Z' &&
        call.args.reason === 'Khách hàng dời lịch.' &&
        calls.length === 1,
      { statusCode, body, callArgs: call && call.args }
    );
  }

  // =========================================================================
  // 3d) body.taskId (nếu có) KHÔNG được dùng — path :id vẫn authoritative
  // =========================================================================
  {
    const { mod, calls } = makeFakeTaskWriteModule({
      cancelTask: { return: { id: 'task-8', status: 'cancelled' } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    await sendRequest(
      server,
      'POST',
      '/v1/task/tasks/task-8:cancel',
      { taskId: 'task-DIFFERENT-999', expectedRowVersion: 1, reason: 'x', actor: {} },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'cancelTask');
    record('cancel_pathId_authoritative_bodyTaskId_ignored', call && call.args.taskId === 'task-8', { callArgs: call && call.args });
  }

  // =========================================================================
  // 4) đúng function được gọi — updateProgress route KHÔNG được gọi nhầm completeTask/reopenTask
  // =========================================================================
  {
    const { mod, calls } = makeFakeTaskWriteModule({
      updateTaskProgress: { return: { id: 'task-4' } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    await sendRequest(server, 'POST', '/v1/task/tasks/task-4:updateProgress', { expectedRowVersion: 1, progressPercent: 1, progressStatus: 'dang_thuc_hien', actor: {} }, authHeader());
    const calledNames = calls.map((c) => c.name);
    record('updateProgress_calls_ONLY_updateTaskProgress', calledNames.length === 1 && calledNames[0] === 'updateTaskProgress', { calledNames });
  }

  // =========================================================================
  // 5) auth — thiếu Bearer token -> 401 UNAUTHORIZED, envelope đúng, KHÔNG gọi spy
  // =========================================================================
  {
    const { mod, calls } = makeFakeTaskWriteModule({ updateTaskProgress: { return: {} } });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(server, 'POST', '/v1/task/tasks/task-5:updateProgress', { expectedRowVersion: 1, progressPercent: 1, progressStatus: 'dang_thuc_hien', actor: {} }, {});
    record('auth_MISSING_TOKEN_401', statusCode === 401 && body.ok === false && body.code === 'UNAUTHORIZED' && calls.length === 0, { statusCode, body, calls: calls.length });
  }

  // =========================================================================
  // 6) auth — sai token -> 401, KHÔNG gọi spy
  // =========================================================================
  {
    const { mod, calls } = makeFakeTaskWriteModule({ updateTaskProgress: { return: {} } });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server,
      'POST',
      '/v1/task/tasks/task-5:updateProgress',
      { expectedRowVersion: 1, progressPercent: 1, progressStatus: 'dang_thuc_hien', actor: {} },
      { authorization: 'Bearer sai-token-hoan-toan' }
    );
    record('auth_WRONG_TOKEN_401', statusCode === 401 && body.ok === false && body.code === 'UNAUTHORIZED' && calls.length === 0, { statusCode, body });
  }

  // =========================================================================
  // 7) 8 error mappings — verify TASK_WRITE_ERROR_STATUS đúng cho cả 8 mã
  // (dùng chung route updateProgress vì logic mapping nằm trong helper dùng
  // chung cho cả 3 route — không cần lặp qua từng route để verify bảng mapping).
  // =========================================================================
  {
    const EXPECTED_STATUS = {
      TASK_NOT_FOUND: 404,
      TASK_VERSION_CONFLICT: 409,
      TASK_NOT_ACTIVE: 409,
      TASK_PROGRESS_PERCENT_INVALID: 400,
      TASK_PROGRESS_STATUS_INVALID: 400,
      TASK_COMPLETION_RESULT_REQUIRED: 400,
      TASK_NOT_COMPLETED: 409,
      TASK_REOPEN_REASON_REQUIRED: 400,
    };
    let allOk = true;
    const detail = {};
    for (const [code, expectedStatus] of Object.entries(EXPECTED_STATUS)) {
      const { mod } = makeFakeTaskWriteModule({ updateTaskProgress: { throwCode: code } });
      const createServer = loadCreateServerWithFakeTaskWrite(mod);
      const server = createServer(MOCK_CONFIG);
      const { statusCode, body } = await sendRequest(
        server,
        'POST',
        '/v1/task/tasks/task-x:updateProgress',
        { expectedRowVersion: 1, progressPercent: 1, progressStatus: 'dang_thuc_hien', actor: { employeeCode: 'X' } },
        authHeader()
      );
      const ok = statusCode === expectedStatus && body.ok === false && body.code === code;
      detail[code] = { statusCode, expectedStatus, bodyCode: body.code, ok };
      if (!ok) allOk = false;
    }
    record('ERROR_MAPPING_all_8_codes', allOk, detail);
  }

  // =========================================================================
  // 7b) 7 error mappings Batch 2 mới — verify qua route cancel (khác route 7a
  // dùng updateProgress, để đồng thời xác nhận route cancel cũng nối đúng vào
  // handleTaskWriteOperation dùng chung, không phải hàm mapping riêng khác).
  // =========================================================================
  {
    const EXPECTED_STATUS_BATCH2 = {
      TASK_DRAFT_USE_DELETE: 409,
      TASK_ALREADY_CANCELLED: 409,
      TASK_MUST_REOPEN_BEFORE_CANCEL: 409,
      TASK_CANCEL_REASON_REQUIRED: 400,
      TASK_CANCELLED_IMMUTABLE: 409,
      TASK_DEADLINE_REQUIRED: 400,
      TASK_DEADLINE_REASON_REQUIRED: 400,
    };
    let allOk = true;
    const detail = {};
    for (const [code, expectedStatus] of Object.entries(EXPECTED_STATUS_BATCH2)) {
      const { mod } = makeFakeTaskWriteModule({ cancelTask: { throwCode: code } });
      const createServer = loadCreateServerWithFakeTaskWrite(mod);
      const server = createServer(MOCK_CONFIG);
      const { statusCode, body } = await sendRequest(
        server,
        'POST',
        '/v1/task/tasks/task-x:cancel',
        { expectedRowVersion: 1, reason: 'x', actor: { employeeCode: 'X' } },
        authHeader()
      );
      const ok = statusCode === expectedStatus && body.ok === false && body.code === code;
      detail[code] = { statusCode, expectedStatus, bodyCode: body.code, ok };
      if (!ok) allOk = false;
    }
    record('ERROR_MAPPING_batch2_7_new_codes', allOk, detail);
  }

  // =========================================================================
  // 8) mã lỗi KHÔNG có trong bảng -> 500 TASK_WRITE_ERROR (không lộ chi tiết)
  // =========================================================================
  {
    const { mod } = makeFakeTaskWriteModule({ updateTaskProgress: { throwCode: 'SOME_UNEXPECTED_DB_ERROR_DETAIL' } });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server,
      'POST',
      '/v1/task/tasks/task-x:updateProgress',
      { expectedRowVersion: 1, progressPercent: 1, progressStatus: 'dang_thuc_hien', actor: { employeeCode: 'X' } },
      authHeader()
    );
    record(
      'UNKNOWN_ERROR_CODE_falls_back_to_500_no_leak',
      statusCode === 500 && body.ok === false && body.code === 'TASK_WRITE_ERROR' && body.message !== 'SOME_UNEXPECTED_DB_ERROR_DETAIL',
      { statusCode, body }
    );
  }

  // =========================================================================
  // Batch 3 — create (POST /v1/task/tasks:create) — KHÔNG có :id (draft chưa
  // tồn tại trước khi tạo), mapping đầy đủ field + actor + optional field.
  // =========================================================================
  {
    // CD1) success — full field mapping, actor.employeeCode
    const { mod, calls } = makeFakeTaskWriteModule({
      createDraftTask: { return: { id: 'task-new-1', status: 'draft', task_code: 'CV-2608-0010' } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server,
      'POST',
      '/v1/task/tasks:create',
      {
        flowType: 'giao_viec', title: 'Việc A', content: 'Nội dung A', categoryCode: 'CAT1', priority: 'thuong',
        startAt: '2026-08-25T00:00:00Z', deadline: '2026-09-01T00:00:00Z',
        primaryEmployeeCode: 'PHF002', idempotencyKey: '11111111-1111-1111-1111-111111111111',
        actor: { employeeCode: 'PHF001' },
      },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'createDraftTask');
    record(
      'create_SUCCESS_full_field_mapping',
      statusCode === 200 && body.ok === true && body.data.task_code === 'CV-2608-0010' &&
        call && call.args.flowType === 'giao_viec' && call.args.title === 'Việc A' && call.args.content === 'Nội dung A' &&
        call.args.categoryCode === 'CAT1' && call.args.priority === 'thuong' && call.args.startAt === '2026-08-25T00:00:00Z' &&
        call.args.deadline === '2026-09-01T00:00:00Z' && call.args.primaryEmployeeCode === 'PHF002' &&
        call.args.idempotencyKey === '11111111-1111-1111-1111-111111111111' && call.args.actorEmployeeCode === 'PHF001' &&
        calls.length === 1,
      { statusCode, body, callArgs: call && call.args }
    );
  }

  {
    // CD2) actor mapping — accountId thay vì employeeCode
    const { mod, calls } = makeFakeTaskWriteModule({
      createDraftTask: { return: { id: 'task-new-2', status: 'draft' } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    await sendRequest(
      server, 'POST', '/v1/task/tasks:create',
      { flowType: 'de_xuat', title: 'x', categoryCode: 'CAT1', priority: 'thuong', deadline: '2026-09-01T00:00:00Z', actor: { accountId: 'acct-777' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'createDraftTask');
    record('create_actor_accountId_mapping', call && call.args.actorAccountId === 'acct-777' && call.args.actorEmployeeCode === undefined, { callArgs: call && call.args });
  }

  {
    // CD3) optional primary/idempotency KHÔNG truyền -> mapping undefined,
    // route KHÔNG tự suy đoán/mặc định giá trị nào khác (để DB-layer tự xử lý).
    const { mod, calls } = makeFakeTaskWriteModule({
      createDraftTask: { return: { id: 'task-new-3', status: 'draft' } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    await sendRequest(
      server, 'POST', '/v1/task/tasks:create',
      { flowType: 'giao_viec', title: 'x', categoryCode: 'CAT1', priority: 'thuong', deadline: '2026-09-01T00:00:00Z', actor: { employeeCode: 'PHF001' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'createDraftTask');
    record(
      'create_optional_primary_idempotency_mapping_undefined',
      call && call.args.primaryEmployeeCode === undefined && call.args.idempotencyKey === undefined,
      { callArgs: call && call.args }
    );
  }

  {
    // CD4) auth thiếu Bearer -> 401, DB-layer KHÔNG được gọi
    const { mod, calls } = makeFakeTaskWriteModule({ createDraftTask: { return: {} } });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server, 'POST', '/v1/task/tasks:create',
      { flowType: 'giao_viec', title: 'x', categoryCode: 'CAT1', priority: 'thuong', deadline: '2026-09-01T00:00:00Z', actor: {} },
      {}
    );
    record('create_auth_MISSING_TOKEN_401_noCall', statusCode === 401 && body.ok === false && body.code === 'UNAUTHORIZED' && calls.length === 0, { statusCode, body });
  }

  {
    // CD5) auth sai token -> 401, DB-layer KHÔNG được gọi
    const { mod, calls } = makeFakeTaskWriteModule({ createDraftTask: { return: {} } });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server, 'POST', '/v1/task/tasks:create',
      { flowType: 'giao_viec', title: 'x', categoryCode: 'CAT1', priority: 'thuong', deadline: '2026-09-01T00:00:00Z', actor: {} },
      { authorization: 'Bearer sai-token-hoan-toan' }
    );
    record('create_auth_WRONG_TOKEN_401_noCall', statusCode === 401 && body.ok === false && body.code === 'UNAUTHORIZED' && calls.length === 0, { statusCode, body });
  }

  {
    // CD6) 5 mã lỗi Batch 3 mới — verify qua route create (đủ để chứng minh
    // bảng mapping mới nối đúng vào helper dùng chung, không cần lặp per-route).
    const EXPECTED_STATUS_BATCH3 = {
      TASK_DATE_ORDER_INVALID: 400,
      TASK_CATEGORY_NOT_FOUND: 400,
      TASK_CATEGORY_INACTIVE: 400,
      TASK_NOT_DRAFT: 409,
      TASK_PRIMARY_REQUIRED: 400,
    };
    let allOk = true;
    const detail = {};
    for (const [code, expectedStatus] of Object.entries(EXPECTED_STATUS_BATCH3)) {
      const { mod } = makeFakeTaskWriteModule({ createDraftTask: { throwCode: code } });
      const createServer = loadCreateServerWithFakeTaskWrite(mod);
      const server = createServer(MOCK_CONFIG);
      const { statusCode, body } = await sendRequest(
        server, 'POST', '/v1/task/tasks:create',
        { flowType: 'giao_viec', title: 'x', categoryCode: 'CAT1', priority: 'thuong', deadline: '2026-09-01T00:00:00Z', actor: { employeeCode: 'X' } },
        authHeader()
      );
      const ok = statusCode === expectedStatus && body.ok === false && body.code === code;
      detail[code] = { statusCode, expectedStatus, bodyCode: body.code, ok };
      if (!ok) allOk = false;
    }
    record('ERROR_MAPPING_batch3_5_new_codes', allOk, detail);
  }

  {
    // CD7) TASK_DEADLINE_REQUIRED tái dùng từ Batch 2 — verify KHÔNG duplicate
    // key mới nào trong bảng mapping (vẫn map đúng 400 qua route create).
    const { mod } = makeFakeTaskWriteModule({ createDraftTask: { throwCode: 'TASK_DEADLINE_REQUIRED' } });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server, 'POST', '/v1/task/tasks:create',
      { flowType: 'giao_viec', title: 'x', categoryCode: 'CAT1', priority: 'thuong', deadline: null, actor: { employeeCode: 'X' } },
      authHeader()
    );
    record('create_TASK_DEADLINE_REQUIRED_reused_batch2_code', statusCode === 400 && body.code === 'TASK_DEADLINE_REQUIRED', { statusCode, body });
  }

  // =========================================================================
  // Batch 3 — publish (POST /v1/task/tasks/:id:publish) — path :id authoritative,
  // department snapshot mapping từ body, actor mapping.
  // =========================================================================
  {
    // P1) success — full mapping kể cả sourceDepartment/targetDepartment
    const { mod, calls } = makeFakeTaskWriteModule({
      publishTask: { return: { id: 'task-pub-1', status: 'published', row_version: 2, source_department: 'Kinh doanh', target_department: 'Kỹ thuật', is_cross_department: true } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server, 'POST', '/v1/task/tasks/task-pub-1:publish',
      { expectedRowVersion: 1, sourceDepartment: 'Kinh doanh', targetDepartment: 'Kỹ thuật', actor: { employeeCode: 'PHF001' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'publishTask');
    record(
      'publish_SUCCESS_route_and_mapping',
      statusCode === 200 && body.ok === true && body.data.status === 'published' &&
        call && call.args.taskId === 'task-pub-1' && call.args.expectedRowVersion === 1 &&
        call.args.sourceDepartment === 'Kinh doanh' && call.args.targetDepartment === 'Kỹ thuật' &&
        call.args.actorEmployeeCode === 'PHF001' && calls.length === 1,
      { statusCode, body, callArgs: call && call.args }
    );
  }

  {
    // P2) path :id authoritative — body.taskId (nếu có) bị bỏ qua
    const { mod, calls } = makeFakeTaskWriteModule({
      publishTask: { return: { id: 'task-pub-2', status: 'published' } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    await sendRequest(
      server, 'POST', '/v1/task/tasks/task-pub-2:publish',
      { taskId: 'task-DIFFERENT-999', expectedRowVersion: 1, actor: {} },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'publishTask');
    record('publish_pathId_authoritative_bodyTaskId_ignored', call && call.args.taskId === 'task-pub-2', { callArgs: call && call.args });
  }

  {
    // P3) sourceDepartment/targetDepartment KHÔNG truyền -> mapping undefined
    // (KHÔNG tự đoán/mặc định giá trị nào — DB-layer tự xử lý null).
    const { mod, calls } = makeFakeTaskWriteModule({
      publishTask: { return: { id: 'task-pub-3', status: 'published' } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    await sendRequest(
      server, 'POST', '/v1/task/tasks/task-pub-3:publish',
      { expectedRowVersion: 1, actor: { employeeCode: 'PHF001' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'publishTask');
    record(
      'publish_departmentSnapshot_undefined_when_not_provided',
      call && call.args.sourceDepartment === undefined && call.args.targetDepartment === undefined,
      { callArgs: call && call.args }
    );
  }

  {
    // P4) actor mapping — accountId thay vì employeeCode
    const { mod, calls } = makeFakeTaskWriteModule({
      publishTask: { return: { id: 'task-pub-4', status: 'published' } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    await sendRequest(
      server, 'POST', '/v1/task/tasks/task-pub-4:publish',
      { expectedRowVersion: 1, actor: { employeeCode: '', accountId: 'acct-555' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'publishTask');
    record('publish_actor_accountId_mapping', call && call.args.actorAccountId === 'acct-555', { callArgs: call && call.args });
  }

  {
    // P5) auth thiếu Bearer -> 401, DB-layer KHÔNG được gọi
    const { mod, calls } = makeFakeTaskWriteModule({ publishTask: { return: {} } });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(server, 'POST', '/v1/task/tasks/task-pub-5:publish', { expectedRowVersion: 1, actor: {} }, {});
    record('publish_auth_MISSING_TOKEN_401_noCall', statusCode === 401 && body.ok === false && body.code === 'UNAUTHORIZED' && calls.length === 0, { statusCode, body });
  }

  {
    // P6) auth sai token -> 401, DB-layer KHÔNG được gọi
    const { mod, calls } = makeFakeTaskWriteModule({ publishTask: { return: {} } });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server, 'POST', '/v1/task/tasks/task-pub-5:publish',
      { expectedRowVersion: 1, actor: {} },
      { authorization: 'Bearer sai-token-hoan-toan' }
    );
    record('publish_auth_WRONG_TOKEN_401_noCall', statusCode === 401 && body.ok === false && body.code === 'UNAUTHORIZED' && calls.length === 0, { statusCode, body });
  }

  {
    // P7) error mappings publish — TASK_NOT_FOUND/TASK_VERSION_CONFLICT (dùng
    // chung) + TASK_NOT_DRAFT/TASK_PRIMARY_REQUIRED (Batch 3 mới) qua chính route publish.
    const EXPECTED_STATUS_PUBLISH = {
      TASK_NOT_FOUND: 404,
      TASK_VERSION_CONFLICT: 409,
      TASK_NOT_DRAFT: 409,
      TASK_PRIMARY_REQUIRED: 400,
    };
    let allOk = true;
    const detail = {};
    for (const [code, expectedStatus] of Object.entries(EXPECTED_STATUS_PUBLISH)) {
      const { mod } = makeFakeTaskWriteModule({ publishTask: { throwCode: code } });
      const createServer = loadCreateServerWithFakeTaskWrite(mod);
      const server = createServer(MOCK_CONFIG);
      const { statusCode, body } = await sendRequest(
        server, 'POST', '/v1/task/tasks/task-pub-x:publish',
        { expectedRowVersion: 1, actor: { employeeCode: 'X' } },
        authHeader()
      );
      const ok = statusCode === expectedStatus && body.ok === false && body.code === code;
      detail[code] = { statusCode, expectedStatus, bodyCode: body.code, ok };
      if (!ok) allOk = false;
    }
    record('ERROR_MAPPING_publish_4_codes', allOk, detail);
  }

  {
    // P8) unmatched verb ":publish" trên path khác vẫn không nuốt nhầm route create/publish khác id
    const { mod, calls } = makeFakeTaskWriteModule({});
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(server, 'POST', '/v1/task/tasks/task-1:unknownVerb', {}, authHeader());
    record('batch3_unmatched_verb_still_404', statusCode === 404 && body.error === 'NOT_FOUND' && calls.length === 0, { statusCode, body });
  }

  // =========================================================================
  // Batch 4 — transferPrimary (POST /v1/task/tasks/:id:transferPrimary)
  // =========================================================================
  {
    // TP1) success — full mapping
    const { mod, calls } = makeFakeTaskWriteModule({
      transferTaskPrimary: { return: { id: 'task-tp-1', row_version: 3 } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server, 'POST', '/v1/task/tasks/task-tp-1:transferPrimary',
      { expectedRowVersion: 2, newPrimaryEmployeeCode: 'PHF002', reason: 'Đổi người phụ trách.', actor: { employeeCode: 'PHF001' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'transferTaskPrimary');
    record(
      'transferPrimary_SUCCESS_route_and_mapping',
      statusCode === 200 && body.ok === true && body.data.row_version === 3 &&
        call && call.args.taskId === 'task-tp-1' && call.args.expectedRowVersion === 2 &&
        call.args.newPrimaryEmployeeCode === 'PHF002' && call.args.reason === 'Đổi người phụ trách.' &&
        call.args.actorEmployeeCode === 'PHF001' && calls.length === 1,
      { statusCode, body, callArgs: call && call.args }
    );
  }

  {
    // TP2) path :id authoritative
    const { mod, calls } = makeFakeTaskWriteModule({ transferTaskPrimary: { return: { id: 'task-tp-2' } } });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    await sendRequest(
      server, 'POST', '/v1/task/tasks/task-tp-2:transferPrimary',
      { taskId: 'DIFFERENT', expectedRowVersion: 1, newPrimaryEmployeeCode: 'X', reason: 'x', actor: {} },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'transferTaskPrimary');
    record('transferPrimary_pathId_authoritative', call && call.args.taskId === 'task-tp-2', { callArgs: call && call.args });
  }

  {
    // TP3) error mapping — 4 mã mới Batch 4
    const EXPECTED = { TASK_TRANSFER_REASON_REQUIRED: 400, TASK_TRANSFER_TARGET_REQUIRED: 400, TASK_PRIMARY_NOT_FOUND: 409, TASK_TRANSFER_SAME_EMPLOYEE: 400 };
    let allOk = true; const detail = {};
    for (const [code, expectedStatus] of Object.entries(EXPECTED)) {
      const { mod } = makeFakeTaskWriteModule({ transferTaskPrimary: { throwCode: code } });
      const createServer = loadCreateServerWithFakeTaskWrite(mod);
      const server = createServer(MOCK_CONFIG);
      const { statusCode, body } = await sendRequest(
        server, 'POST', '/v1/task/tasks/task-x:transferPrimary',
        { expectedRowVersion: 1, newPrimaryEmployeeCode: 'X', reason: 'x', actor: { employeeCode: 'X' } },
        authHeader()
      );
      const ok = statusCode === expectedStatus && body.ok === false && body.code === code;
      detail[code] = { statusCode, expectedStatus, bodyCode: body.code, ok };
      if (!ok) allOk = false;
    }
    record('ERROR_MAPPING_transferPrimary_4_codes', allOk, detail);
  }

  // =========================================================================
  // Batch 4 — addRelated (POST /v1/task/tasks/:id:addRelated)
  // =========================================================================
  {
    const { mod, calls } = makeFakeTaskWriteModule({
      addTaskRelated: { return: { id: 'assignee-1', employee_code: 'PHF002', role: 'related' } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server, 'POST', '/v1/task/tasks/task-ar-1:addRelated',
      { targetEmployeeCode: 'PHF002', actor: { employeeCode: 'PHF001' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'addTaskRelated');
    record(
      'addRelated_SUCCESS_route_and_mapping',
      statusCode === 200 && body.ok === true && call && call.args.taskId === 'task-ar-1' &&
        call.args.targetEmployeeCode === 'PHF002' && call.args.actorEmployeeCode === 'PHF001' && calls.length === 1,
      { statusCode, body, callArgs: call && call.args }
    );
  }

  {
    const EXPECTED = { TASK_RELATED_TARGET_REQUIRED: 400, TASK_RELATED_IS_PRIMARY: 400 };
    let allOk = true; const detail = {};
    for (const [code, expectedStatus] of Object.entries(EXPECTED)) {
      const { mod } = makeFakeTaskWriteModule({ addTaskRelated: { throwCode: code } });
      const createServer = loadCreateServerWithFakeTaskWrite(mod);
      const server = createServer(MOCK_CONFIG);
      const { statusCode, body } = await sendRequest(server, 'POST', '/v1/task/tasks/task-x:addRelated', { targetEmployeeCode: 'X', actor: { employeeCode: 'X' } }, authHeader());
      const ok = statusCode === expectedStatus && body.ok === false && body.code === code;
      detail[code] = { statusCode, expectedStatus, bodyCode: body.code, ok };
      if (!ok) allOk = false;
    }
    record('ERROR_MAPPING_addRelated_2_codes', allOk, detail);
  }

  // =========================================================================
  // Batch 4 — removeRelated (POST /v1/task/tasks/:id:removeRelated) — KHÔNG
  // có expectedRowVersion trong mapping (source không có CAS).
  // =========================================================================
  {
    const { mod, calls } = makeFakeTaskWriteModule({
      removeTaskRelated: { return: { id: 'assignee-2', employee_code: 'PHF002', is_active: false } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server, 'POST', '/v1/task/tasks/task-rr-1:removeRelated',
      { targetEmployeeCode: 'PHF002', actor: { employeeCode: 'PHF001' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'removeTaskRelated');
    record(
      'removeRelated_SUCCESS_route_and_mapping_noCAS',
      statusCode === 200 && body.ok === true && call && call.args.taskId === 'task-rr-1' &&
        call.args.targetEmployeeCode === 'PHF002' && !Object.prototype.hasOwnProperty.call(call.args, 'expectedRowVersion') && calls.length === 1,
      { statusCode, body, callArgs: call && call.args }
    );
  }

  {
    const { mod } = makeFakeTaskWriteModule({ removeTaskRelated: { throwCode: 'TASK_RELATED_NOT_FOUND' } });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(server, 'POST', '/v1/task/tasks/task-x:removeRelated', { targetEmployeeCode: 'X', actor: { employeeCode: 'X' } }, authHeader());
    record('removeRelated_NOT_FOUND_mapping', statusCode === 404 && body.code === 'TASK_RELATED_NOT_FOUND', { statusCode, body });
  }

  // =========================================================================
  // Batch 5 — addComment (POST /v1/task/tasks/:id:addComment) — KHÔNG có
  // expectedRowVersion (source không có CAS).
  // =========================================================================
  {
    const { mod, calls } = makeFakeTaskWriteModule({
      addTaskComment: { return: { id: 'comment-1', body: 'Nội dung.' } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server, 'POST', '/v1/task/tasks/task-ac-1:addComment',
      { body: 'Nội dung.', actor: { employeeCode: 'PHF001' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'addTaskComment');
    record(
      'addComment_SUCCESS_route_and_mapping',
      statusCode === 200 && body.ok === true && call && call.args.taskId === 'task-ac-1' && call.args.body === 'Nội dung.' && calls.length === 1,
      { statusCode, body, callArgs: call && call.args }
    );
  }

  {
    const { mod } = makeFakeTaskWriteModule({ addTaskComment: { throwCode: 'TASK_COMMENT_BODY_REQUIRED' } });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(server, 'POST', '/v1/task/tasks/task-x:addComment', { body: '  ', actor: { employeeCode: 'X' } }, authHeader());
    record('addComment_BODY_REQUIRED_mapping', statusCode === 400 && body.code === 'TASK_COMMENT_BODY_REQUIRED', { statusCode, body });
  }

  // =========================================================================
  // Batch 5 — addLink (POST /v1/task/tasks/:id:addLink)
  // =========================================================================
  {
    const { mod, calls } = makeFakeTaskWriteModule({
      addTaskLink: { return: { id: 'link-1', related_event_id: 'evt-1' } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server, 'POST', '/v1/task/tasks/task-al-1:addLink',
      { side: 'input_reference', url: 'https://x.test', label: 'Tài liệu', actor: { employeeCode: 'PHF001' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'addTaskLink');
    record(
      'addLink_SUCCESS_route_and_mapping',
      statusCode === 200 && body.ok === true && call && call.args.taskId === 'task-al-1' &&
        call.args.side === 'input_reference' && call.args.url === 'https://x.test' && call.args.label === 'Tài liệu' && calls.length === 1,
      { statusCode, body, callArgs: call && call.args }
    );
  }

  // =========================================================================
  // Batch 5 — removeLink (POST /v1/task/tasks/:id:removeLink) — KHÔNG có
  // expectedRowVersion (source không có CAS).
  // =========================================================================
  {
    const { mod, calls } = makeFakeTaskWriteModule({
      removeTaskLink: { return: { removed: true, link_id: 'link-1' } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server, 'POST', '/v1/task/tasks/task-rl-1:removeLink',
      { linkId: 'link-1', actor: { employeeCode: 'PHF001' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'removeTaskLink');
    record(
      'removeLink_SUCCESS_route_and_mapping',
      statusCode === 200 && body.ok === true && body.data.removed === true && call && call.args.taskId === 'task-rl-1' && call.args.linkId === 'link-1' && calls.length === 1,
      { statusCode, body, callArgs: call && call.args }
    );
  }

  {
    const { mod } = makeFakeTaskWriteModule({ removeTaskLink: { throwCode: 'TASK_LINK_NOT_FOUND' } });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(server, 'POST', '/v1/task/tasks/task-x:removeLink', { linkId: 'missing', actor: { employeeCode: 'X' } }, authHeader());
    record('removeLink_NOT_FOUND_mapping', statusCode === 404 && body.code === 'TASK_LINK_NOT_FOUND', { statusCode, body });
  }

  // =========================================================================
  // Batch 6 — setPermissionAssignment (POST /v1/task/permission-assignments:set)
  // KHÔNG có path :id (không task-scoped) — verify args KHÔNG có taskId nào.
  // =========================================================================
  {
    const { mod, calls } = makeFakeTaskWriteModule({
      setTaskPermissionAssignment: { return: { id: 'assign-1', employee_code: 'PHF002', preset_code: 'TRUONG_CA' } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server, 'POST', '/v1/task/permission-assignments:set',
      { targetEmployeeCode: 'PHF002', presetCode: 'TRUONG_CA', reason: 'Bổ nhiệm.', actor: { employeeCode: 'PHF_ADMIN' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'setTaskPermissionAssignment');
    record(
      'setPermissionAssignment_SUCCESS_noTaskId_route_and_mapping',
      statusCode === 200 && body.ok === true && call &&
        call.args.targetEmployeeCode === 'PHF002' && call.args.presetCode === 'TRUONG_CA' && call.args.reason === 'Bổ nhiệm.' &&
        call.args.actorEmployeeCode === 'PHF_ADMIN' && !Object.prototype.hasOwnProperty.call(call.args, 'taskId') && calls.length === 1,
      { statusCode, body, callArgs: call && call.args }
    );
  }

  {
    const EXPECTED = {
      TASK_PERMISSION_ASSIGNMENT_TARGET_REQUIRED: 400,
      TASK_PERMISSION_PRESET_INVALID: 400,
      TASK_PERMISSION_REASON_REQUIRED: 400,
      TASK_PERMISSION_ACTOR_REQUIRED: 401,
    };
    let allOk = true; const detail = {};
    for (const [code, expectedStatus] of Object.entries(EXPECTED)) {
      const { mod } = makeFakeTaskWriteModule({ setTaskPermissionAssignment: { throwCode: code } });
      const createServer = loadCreateServerWithFakeTaskWrite(mod);
      const server = createServer(MOCK_CONFIG);
      const { statusCode, body } = await sendRequest(
        server, 'POST', '/v1/task/permission-assignments:set',
        { targetEmployeeCode: 'X', presetCode: 'NHAN_VIEN', reason: 'x', actor: { employeeCode: 'X' } },
        authHeader()
      );
      const ok = statusCode === expectedStatus && body.ok === false && body.code === code;
      detail[code] = { statusCode, expectedStatus, bodyCode: body.code, ok };
      if (!ok) allOk = false;
    }
    record('ERROR_MAPPING_setPermissionAssignment_4_codes', allOk, detail);
  }

  {
    // auth thiếu Bearer -> 401, DB-layer KHÔNG được gọi (route KHÔNG task-id-scoped)
    const { mod, calls } = makeFakeTaskWriteModule({ setTaskPermissionAssignment: { return: {} } });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(server, 'POST', '/v1/task/permission-assignments:set', { targetEmployeeCode: 'X', presetCode: 'NHAN_VIEN', reason: 'x', actor: {} }, {});
    record('setPermissionAssignment_auth_MISSING_TOKEN_401_noCall', statusCode === 401 && body.ok === false && body.code === 'UNAUTHORIZED' && calls.length === 0, { statusCode, body });
  }

  {
    // auth sai token -> 401, DB-layer KHÔNG được gọi
    const { mod, calls } = makeFakeTaskWriteModule({ setTaskPermissionAssignment: { return: {} } });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server, 'POST', '/v1/task/permission-assignments:set',
      { targetEmployeeCode: 'X', presetCode: 'NHAN_VIEN', reason: 'x', actor: {} },
      { authorization: 'Bearer sai-token-hoan-toan' }
    );
    record('setPermissionAssignment_auth_WRONG_TOKEN_401_noCall', statusCode === 401 && body.ok === false && body.code === 'UNAUTHORIZED' && calls.length === 0, { statusCode, body });
  }

  {
    // unknown error code -> 500 an toàn, không lộ chi tiết (qua route mới)
    const { mod } = makeFakeTaskWriteModule({ transferTaskPrimary: { throwCode: 'SOME_UNEXPECTED_DB_ERROR_DETAIL' } });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server, 'POST', '/v1/task/tasks/task-x:transferPrimary',
      { expectedRowVersion: 1, newPrimaryEmployeeCode: 'X', reason: 'x', actor: { employeeCode: 'X' } },
      authHeader()
    );
    record(
      'batch4_6_UNKNOWN_ERROR_CODE_falls_back_to_500_no_leak',
      statusCode === 500 && body.ok === false && body.code === 'TASK_WRITE_ERROR' && body.message !== 'SOME_UNEXPECTED_DB_ERROR_DETAIL',
      { statusCode, body }
    );
  }

  {
    // unmatched verb mới vẫn 404, không nuốt nhầm route khác
    const { mod, calls } = makeFakeTaskWriteModule({});
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(server, 'POST', '/v1/task/permission-assignments:unknownVerb', {}, authHeader());
    record('batch4_6_unmatched_permissionAssignments_verb_404', statusCode === 404 && body.error === 'NOT_FOUND' && calls.length === 0, { statusCode, body });
  }

  // =========================================================================
  // 9) path không khớp verb nào -> vẫn 404 NOT_FOUND như cũ (không bị route mới nuốt nhầm)
  // =========================================================================
  {
    const { mod, calls } = makeFakeTaskWriteModule({});
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(server, 'POST', '/v1/task/tasks/task-1:unknownVerb', {}, authHeader());
    record('unmatched_verb_falls_through_to_404', statusCode === 404 && body.error === 'NOT_FOUND' && calls.length === 0, { statusCode, body });
  }

  // =========================================================================
  // 10) route cũ KHÔNG regression — GET /healthz vẫn hoạt động, đúng shape cũ (không có ok/data)
  // =========================================================================
  {
    const { mod } = makeFakeTaskWriteModule({});
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(server, 'GET', '/healthz', undefined, {});
    record('healthz_route_no_regression', statusCode === 200 && body.status === 'ok' && body.service === 'phf-hr-api' && body.ok === undefined, { statusCode, body });
  }

  // =========================================================================
  // Gate 12 — Category CRUD route wiring
  // =========================================================================
  {
    const { mod, calls } = makeFakeTaskWriteModule({
      createTaskCategory: { return: { category_code: 'CAT1', display_name: 'Cat One', is_active: true } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server, 'POST', '/v1/task/categories:create',
      { categoryCode: 'CAT1', displayName: 'Cat One', actor: { accountId: 'admin-acct-1' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'createTaskCategory');
    record(
      'gate12_categoryCreate_SUCCESS_route_and_mapping',
      statusCode === 200 && body.ok === true && body.data.category_code === 'CAT1' &&
        call && call.args.categoryCode === 'CAT1' && call.args.displayName === 'Cat One' &&
        call.args.actorAccountId === 'admin-acct-1' && call.args.actorEmployeeCode === undefined &&
        calls.length === 1,
      { statusCode, body, callArgs: call && call.args }
    );
  }

  {
    const { mod, calls } = makeFakeTaskWriteModule({
      renameTaskCategory: { return: { category_code: 'CAT1', display_name: 'Renamed' } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server, 'POST', '/v1/task/categories/CAT1:rename',
      { displayName: 'Renamed', actor: { accountId: 'admin-acct-1' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'renameTaskCategory');
    record(
      'gate12_categoryRename_SUCCESS_path_code_authoritative',
      statusCode === 200 && body.ok === true && call && call.args.categoryCode === 'CAT1' && calls.length === 1,
      { statusCode, body, callArgs: call && call.args }
    );
  }

  {
    const { mod, calls } = makeFakeTaskWriteModule({
      setTaskCategoryActive: { return: { category_code: 'CAT1', is_active: false } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server, 'POST', '/v1/task/categories/CAT1:setActive',
      { isActive: false, actor: { accountId: 'admin-acct-1' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'setTaskCategoryActive');
    record(
      'gate12_categorySetActive_SUCCESS',
      statusCode === 200 && body.ok === true && body.data.is_active === false &&
        call && call.args.isActive === false && calls.length === 1,
      { statusCode, body, callArgs: call && call.args }
    );
  }

  {
    const { mod, calls } = makeFakeTaskWriteModule({
      reorderTaskCategory: { return: { category_code: 'CAT1', sort_order: 3 } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server, 'POST', '/v1/task/categories/CAT1:reorder',
      { sortOrder: 3, actor: { accountId: 'admin-acct-1' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'reorderTaskCategory');
    record(
      'gate12_categoryReorder_SUCCESS',
      statusCode === 200 && body.ok === true && call && call.args.sortOrder === 3 && calls.length === 1,
      { statusCode, body, callArgs: call && call.args }
    );
  }

  {
    const { mod, calls } = makeFakeTaskWriteModule({
      deleteTaskCategoryIfUnused: { return: { deleted: true, category_code: 'CAT1' } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(server, 'POST', '/v1/task/categories/CAT1:delete', {}, authHeader());
    const call = calls.find((c) => c.name === 'deleteTaskCategoryIfUnused');
    record(
      'gate12_categoryDelete_SUCCESS_no_actor_needed',
      statusCode === 200 && body.ok === true && body.data.deleted === true &&
        call && call.args.categoryCode === 'CAT1' && Object.keys(call.args).length === 1 && calls.length === 1,
      { statusCode, body, callArgs: call && call.args }
    );
  }

  {
    // Verifies the newly-added TASK_CATEGORY_IN_USE -> 409 mapping actually wires through.
    const { mod, calls } = makeFakeTaskWriteModule({
      deleteTaskCategoryIfUnused: { throwCode: 'TASK_CATEGORY_IN_USE' },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(server, 'POST', '/v1/task/categories/CAT1:delete', {}, authHeader());
    record(
      'gate12_categoryDelete_IN_USE_maps_409',
      statusCode === 409 && body.ok === false && body.code === 'TASK_CATEGORY_IN_USE' && calls.length === 1,
      { statusCode, body }
    );
  }

  {
    // Option C (Technical Lead): Gate12's resource-addressed category lookups
    // throw the DISTINCT TASK_CATEGORY_RESOURCE_NOT_FOUND (404), never the
    // shared TASK_CATEGORY_NOT_FOUND (400, Batch-3 createDraftTask contract —
    // see the separate create_TASK_DEADLINE_REQUIRED-style test elsewhere in
    // this file that still asserts 400 for that code, untouched).
    const { mod, calls } = makeFakeTaskWriteModule({
      renameTaskCategory: { throwCode: 'TASK_CATEGORY_RESOURCE_NOT_FOUND' },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(server, 'POST', '/v1/task/categories/NOPE:rename', { displayName: 'x' }, authHeader());
    record(
      'gate12_categoryResourceNotFound_maps_404_distinct_from_batch3_code',
      statusCode === 404 && body.ok === false && body.code === 'TASK_CATEGORY_RESOURCE_NOT_FOUND' && calls.length === 1,
      { statusCode, body }
    );
  }

  {
    const { mod, calls } = makeFakeTaskWriteModule({});
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(server, 'POST', '/v1/task/categories:unknownVerb', {}, authHeader());
    record('gate12_categories_unmatched_verb_404', statusCode === 404 && body.error === 'NOT_FOUND' && calls.length === 0, { statusCode, body });
  }

  // =========================================================================
  // Gate 12 — Exception-grant CRUD route wiring
  // =========================================================================
  {
    const { mod, calls } = makeFakeTaskWriteModule({
      createTaskPermissionGrant: { return: { id: 'grant-1', is_active: true, created_by_employee_code: null } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server, 'POST', '/v1/task/permission-grants:create',
      {
        granteeEmployeeCode: 'PHF010',
        peopleScope: { type: 'employees', values: ['PHF010'] },
        reason: 'Test grant',
        actor: { accountId: 'admin-acct-1' }, // Admin actor, no employeeCode — same case Gate12 DB-layer verified
      },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'createTaskPermissionGrant');
    record(
      'gate12_grantCreate_SUCCESS_admin_actorEmployeeCode_undefined',
      statusCode === 200 && body.ok === true && body.data.id === 'grant-1' &&
        call && call.args.granteeEmployeeCode === 'PHF010' && call.args.actorAccountId === 'admin-acct-1' &&
        call.args.actorEmployeeCode === undefined && calls.length === 1,
      { statusCode, body, callArgs: call && call.args }
    );
  }

  {
    const { mod, calls } = makeFakeTaskWriteModule({
      revokeTaskPermissionGrant: { return: { revoked: true, grant_id: 'grant-1' } },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(
      server, 'POST', '/v1/task/permission-grants/grant-1:revoke',
      { reason: 'Cleanup', actor: { accountId: 'admin-acct-1' } },
      authHeader()
    );
    const call = calls.find((c) => c.name === 'revokeTaskPermissionGrant');
    record(
      'gate12_grantRevoke_SUCCESS_path_id_authoritative',
      statusCode === 200 && body.ok === true && call && call.args.grantId === 'grant-1' && calls.length === 1,
      { statusCode, body, callArgs: call && call.args }
    );
  }

  {
    const { mod, calls } = makeFakeTaskWriteModule({
      revokeTaskPermissionGrant: { throwCode: 'TASK_PERMISSION_GRANT_NOT_FOUND' },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(server, 'POST', '/v1/task/permission-grants/nope:revoke', { reason: 'x' }, authHeader());
    record(
      'gate12_grantNotFound_maps_404',
      statusCode === 404 && body.ok === false && body.code === 'TASK_PERMISSION_GRANT_NOT_FOUND' && calls.length === 1,
      { statusCode, body }
    );
  }

  {
    const { mod, calls } = makeFakeTaskWriteModule({
      revokeTaskPermissionGrant: { throwCode: 'TASK_PERMISSION_GRANT_ALREADY_REVOKED' },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(server, 'POST', '/v1/task/permission-grants/grant-1:revoke', { reason: 'x' }, authHeader());
    record(
      'gate12_grantAlreadyRevoked_maps_409',
      statusCode === 409 && body.ok === false && body.code === 'TASK_PERMISSION_GRANT_ALREADY_REVOKED' && calls.length === 1,
      { statusCode, body }
    );
  }

  {
    // Technical-Lead-decided codes (no source equivalent) -> 400, verified end-to-end.
    const { mod, calls } = makeFakeTaskWriteModule({
      createTaskPermissionGrant: { throwCode: 'TASK_PERMISSION_GRANT_SCOPE_REQUIRED' },
    });
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(server, 'POST', '/v1/task/permission-grants:create', { granteeEmployeeCode: 'PHF010', reason: 'x' }, authHeader());
    record(
      'gate12_grantScopeRequired_maps_400',
      statusCode === 400 && body.ok === false && body.code === 'TASK_PERMISSION_GRANT_SCOPE_REQUIRED' && calls.length === 1,
      { statusCode, body }
    );
  }

  {
    const { mod, calls } = makeFakeTaskWriteModule({});
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(server, 'POST', '/v1/task/permission-grants:unknownVerb', {}, authHeader());
    record('gate12_permissionGrants_unmatched_verb_404', statusCode === 404 && body.error === 'NOT_FOUND' && calls.length === 0, { statusCode, body });
  }

  {
    // auth-denied must still be enforced identically for every new Gate12 route.
    const { mod, calls } = makeFakeTaskWriteModule({});
    const createServer = loadCreateServerWithFakeTaskWrite(mod);
    const server = createServer(MOCK_CONFIG);
    const { statusCode, body } = await sendRequest(server, 'POST', '/v1/task/categories:create', { categoryCode: 'X', displayName: 'X' }, {});
    record('gate12_categoryCreate_NO_AUTH_401', statusCode === 401 && body.ok === false && calls.length === 0, { statusCode, body });
  }

  const allPass = results.every((r) => r.pass);
  console.log('OVERALL', allPass ? 'PASS' : 'FAIL', `(${results.filter((r) => r.pass).length}/${results.length})`);
  process.exit(allPass ? 0 : 1);
})();
