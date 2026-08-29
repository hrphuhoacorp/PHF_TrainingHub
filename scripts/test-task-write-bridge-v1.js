'use strict';

// Test cho api/_lib/task-write-bridge.js (Phase 3 — Integration Foundation,
// NEW file, feature-flag mặc định OFF, CHƯA wire vào api/data.js/task-core.js
// nào). Mock-only: global.fetch bị thay bằng fake, không network/DB thật.
//
// Mục đích: (1) chứng minh mặc định TẮT tuyệt đối (an toàn ngay cả khi ai đó
// lỡ require file này ở đâu đó trước khi có GO wire thật); (2) mapping path/
// body đúng verbatim với services/phf-hr-api/server.js (đã đọc trực tiếp,
// không đoán field name); (3) error pass-through giữ nguyên code/message.

const assert = require('assert');

const bridgePath = require.resolve('../api/_lib/task-write-bridge');

let PASS = 0, FAIL = 0;
function check(name, cond) { if (cond) PASS++; else { FAIL++; console.error('FAIL:', name); } }

function freshBridge() {
  delete require.cache[bridgePath];
  return require(bridgePath);
}

async function run() {
  // -------------------------------------------------------------------
  // Case 1 — mặc định TẮT: gọi bất kỳ hàm nào cũng throw TASK_WRITE_BRIDGE_DISABLED,
  // KHÔNG bao giờ chạm network (không set global.fetch ở case này — nếu code
  // lỡ gọi fetch thật sẽ tự crash rõ ràng thay vì âm thầm pass).
  // -------------------------------------------------------------------
  {
    delete process.env.PHF_TASK_WRITE_BRIDGE_ENABLED;
    delete process.env.PHF_HR_API_BASE_URL;
    delete process.env.PHF_HR_API_SERVICE_TOKEN;
    const bridge = freshBridge();
    check('isWriteBridgeEnabled() = false khi env chưa set', bridge.isWriteBridgeEnabled() === false);
    try {
      await bridge.bridgeCancelTask('t1', 1, 'ly do', 'PHF010', null);
      check('PHẢI throw khi bridge tắt', false);
    } catch (err) {
      check('throw đúng TASK_WRITE_BRIDGE_DISABLED khi tắt', err.code === 'TASK_WRITE_BRIDGE_DISABLED');
    }
  }

  // -------------------------------------------------------------------
  // Case 2 — bật cờ nhưng thiếu config -> TASK_WRITE_BRIDGE_MISCONFIGURED.
  // -------------------------------------------------------------------
  {
    process.env.PHF_TASK_WRITE_BRIDGE_ENABLED = 'true';
    delete process.env.PHF_HR_API_BASE_URL;
    delete process.env.PHF_HR_API_SERVICE_TOKEN;
    const bridge = freshBridge();
    try {
      await bridge.bridgeCancelTask('t1', 1, 'ly do', 'PHF010', null);
      check('PHẢI throw khi thiếu config', false);
    } catch (err) {
      check('throw đúng TASK_WRITE_BRIDGE_MISCONFIGURED khi thiếu base URL/token', err.code === 'TASK_WRITE_BRIDGE_MISCONFIGURED');
    }
  }

  // -------------------------------------------------------------------
  // Case 3 — bật đủ, mock fetch: xác nhận path + body ĐÚNG verbatim với
  // server.js cho từng operation (đã đọc trực tiếp source, không đoán).
  // -------------------------------------------------------------------
  function setupEnabled(responder) {
    process.env.PHF_TASK_WRITE_BRIDGE_ENABLED = 'true';
    process.env.PHF_HR_API_BASE_URL = 'https://fake-hr-api.internal';
    process.env.PHF_HR_API_SERVICE_TOKEN = 'fake-token';
    const bridge = freshBridge();
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push({ url, method: opts.method, headers: opts.headers, body });
      return responder(url, body);
    };
    return { bridge, calls, restore: () => { global.fetch = originalFetch; } };
  }

  function okResponse(data) { return { ok: true, json: async () => ({ ok: true, data }) }; }
  function errResponse(status, code, message) { return { ok: false, status, json: async () => ({ ok: false, code, message }) }; }

  {
    const { bridge, calls, restore } = setupEnabled(() => okResponse({ id: 't1' }));
    try {
      await bridge.bridgeCreateDraftTask({
        flowType: 'giao_viec', title: 'T', content: '', categoryCode: 'NHAN_SU', priority: 'thuong',
        startAt: null, deadline: '2026-09-01T00:00:00Z', primaryEmployeeCode: 'PHF082', idempotencyKey: 'abc',
        actorEmployeeCode: 'PHF002', actorAccountId: null,
      });
      check('createDraftTask -> đúng path :create', calls[0].url.endsWith('/v1/task/tasks:create'));
      check('createDraftTask -> actor mapping đúng', calls[0].body.actor.employeeCode === 'PHF002');
      check('createDraftTask -> Authorization header Bearer đúng token', calls[0].headers.Authorization === 'Bearer fake-token');

      await bridge.bridgePublishTask('t1', 3, 'Ban giám đốc', 'Kinh doanh', 'PHF002', null);
      check('publishTask -> đúng path :publish', calls[1].url.endsWith('/v1/task/tasks/t1:publish'));
      check('publishTask -> sourceDepartment/targetDepartment truyền đúng (S3B mục 6.3)',
        calls[1].body.sourceDepartment === 'Ban giám đốc' && calls[1].body.targetDepartment === 'Kinh doanh');

      await bridge.bridgeUpdateTaskProgress('t1', 2, 50, 'on_track', 'PHF082', null);
      check('updateTaskProgress -> đúng path :updateProgress + field', calls[2].url.endsWith(':updateProgress') && calls[2].body.progressPercent === 50);

      await bridge.bridgeCompleteTask('t1', 2, 'xong roi', 'PHF082', null);
      check('completeTask -> đúng path :complete + resultText', calls[3].url.endsWith(':complete') && calls[3].body.resultText === 'xong roi');

      await bridge.bridgeReopenTask('t1', 3, 'ly do reopen', 'PHF002', null);
      check('reopenTask -> đúng path :reopen + reason', calls[4].url.endsWith(':reopen') && calls[4].body.reason === 'ly do reopen');

      await bridge.bridgeCancelTask('t1', 4, 'ly do cancel', 'PHF002', null);
      check('cancelTask -> đúng path :cancel + reason', calls[5].url.endsWith(':cancel') && calls[5].body.reason === 'ly do cancel');

      await bridge.bridgeChangeTaskDeadline('t1', 5, '2026-10-01T00:00:00Z', 'gia han', 'PHF002', null);
      check('changeTaskDeadline -> đúng path + newDeadline/reason', calls[6].url.endsWith(':changeDeadline') && calls[6].body.newDeadline === '2026-10-01T00:00:00Z' && calls[6].body.reason === 'gia han');

      await bridge.bridgeTransferTaskPrimary('t1', 6, 'PHF012', 'ban giao', 'PHF002', null);
      check('transferTaskPrimary -> đúng path + newPrimaryEmployeeCode/reason', calls[7].url.endsWith(':transferPrimary') && calls[7].body.newPrimaryEmployeeCode === 'PHF012');

      await bridge.bridgeAddTaskRelated('t1', 'PHF010', 'PHF002', null);
      check('addTaskRelated -> đúng path + targetEmployeeCode, KHÔNG có expectedRowVersion (source-of-truth không CAS)',
        calls[8].url.endsWith(':addRelated') && calls[8].body.targetEmployeeCode === 'PHF010' && calls[8].body.expectedRowVersion === undefined);

      await bridge.bridgeRemoveTaskRelated('t1', 'PHF010', 'PHF002', null);
      check('removeTaskRelated -> đúng path + targetEmployeeCode', calls[9].url.endsWith(':removeRelated') && calls[9].body.targetEmployeeCode === 'PHF010');

      await bridge.bridgeAddTaskComment('t1', 'noi dung comment', 'PHF002', null);
      check('addTaskComment -> đúng path + body field (không trùng tên với request body ngoài)', calls[10].url.endsWith(':addComment') && calls[10].body.body === 'noi dung comment');

      await bridge.bridgeAddTaskLink('t1', 'related', 'https://x.y', 'nhan', 'PHF002', null);
      check('addTaskLink -> đúng path + side/url/label', calls[11].url.endsWith(':addLink') && calls[11].body.side === 'related' && calls[11].body.url === 'https://x.y' && calls[11].body.label === 'nhan');

      await bridge.bridgeRemoveTaskLink('t1', 'link-1', 'PHF002', null);
      check('removeTaskLink -> đúng path + linkId', calls[12].url.endsWith(':removeLink') && calls[12].body.linkId === 'link-1');

      await bridge.bridgeSetTaskPermissionAssignment(null, 'PHF012', 'TRUONG_BO_PHAN', 'gan quyen', 'PHF002', null);
      check('setTaskPermissionAssignment -> đúng path, actor PHẲNG (không lồng trong actor:{})',
        calls[13].url.endsWith('/v1/task/permission-assignments:set') && calls[13].body.actorEmployeeCode === 'PHF002' && calls[13].body.actor === undefined);

      await bridge.bridgeCreateTaskCategory('DAO_TAO', 'Đào tạo', 'PHF002', null);
      check('createTaskCategory -> đúng path :create + categoryCode/displayName', calls[14].url.endsWith('/v1/task/categories:create') && calls[14].body.categoryCode === 'DAO_TAO');

      await bridge.bridgeRenameTaskCategory('DAO_TAO', 'Đào tạo nội bộ', 'PHF002', null);
      check('renameTaskCategory -> path :code:rename + displayName', calls[15].url.endsWith('/v1/task/categories/DAO_TAO:rename') && calls[15].body.displayName === 'Đào tạo nội bộ');

      await bridge.bridgeSetTaskCategoryActive('DAO_TAO', false, 'PHF002', null);
      check('setTaskCategoryActive -> path :code:setActive + isActive', calls[16].url.endsWith(':setActive') && calls[16].body.isActive === false);

      await bridge.bridgeReorderTaskCategory('DAO_TAO', 5, 'PHF002', null);
      check('reorderTaskCategory -> path :code:reorder + sortOrder', calls[17].url.endsWith(':reorder') && calls[17].body.sortOrder === 5);

      await bridge.bridgeDeleteTaskCategoryIfUnused('DAO_TAO');
      check('deleteTaskCategoryIfUnused -> path :code:delete, KHÔNG có actor field nào (không ghi audit column)',
        calls[18].url.endsWith(':delete') && calls[18].body.actorEmployeeCode === undefined && calls[18].body.actorAccountId === undefined);

      await bridge.bridgeCreateTaskPermissionGrant('PHF050', { type: 'employees', values: ['PHF050', 'PHF051'] }, 'ho tro tam thoi', 'PHF002', null);
      check('createTaskPermissionGrant -> path :create + peopleScope truyền nguyên vẹn', calls[19].url.endsWith('/v1/task/permission-grants:create') && calls[19].body.peopleScope.values.length === 2);

      await bridge.bridgeRevokeTaskPermissionGrant('grant-1', 'het han', 'PHF002', null);
      check('revokeTaskPermissionGrant -> path :id:revoke + reason', calls[20].url.endsWith('/v1/task/permission-grants/grant-1:revoke') && calls[20].body.reason === 'het han');

      check('tổng số HTTP call đúng bằng số operation đã gọi (không gọi thừa/thiếu)', calls.length === 21);
    } finally {
      restore();
    }
  }

  // -------------------------------------------------------------------
  // Case 4 — error pass-through: code/message/status verbatim từ server.
  // -------------------------------------------------------------------
  {
    const { bridge, restore } = setupEnabled(() => errResponse(409, 'TASK_VERSION_CONFLICT', 'Phiên bản đã thay đổi.'));
    try {
      await bridge.bridgeCancelTask('t1', 1, 'ly do', 'PHF002', null);
      check('PHẢI throw khi server trả ok:false', false);
    } catch (err) {
      check('error code pass-through verbatim', err.code === 'TASK_VERSION_CONFLICT');
      check('error message pass-through verbatim', err.message === 'Phiên bản đã thay đổi.');
      check('error statusCode pass-through verbatim', err.statusCode === 409);
    } finally {
      restore();
    }
  }

  // -------------------------------------------------------------------
  // Case 5 — attachment upload/remove/download (raw-binary body pattern,
  // KHÁC hẳn JSON body của mọi operation khác — đọc verbatim server.js
  // dòng 841-916, không đoán header name).
  // -------------------------------------------------------------------
  {
    process.env.PHF_TASK_WRITE_BRIDGE_ENABLED = 'true';
    process.env.PHF_HR_API_BASE_URL = 'https://fake-hr-api.internal';
    process.env.PHF_HR_API_SERVICE_TOKEN = 'fake-token';
    const bridge = freshBridge();
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      calls.push({ url, method: opts.method, headers: opts.headers, body: opts.body });
      if (opts.method === 'GET') {
        return { ok: true, status: 200, headers: new Map([['content-type', 'application/pdf']]), body: 'FAKE_STREAM' };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, data: { attachmentId: 'att-1' } }) };
    };
    try {
      const buf = Buffer.from('fake file bytes');
      await bridge.bridgeUploadTaskAttachment('t1', buf, {
        filename: 'bao cao.pdf', mimeType: 'application/pdf', actorEmployeeCode: 'PHF002', idempotencyKey: 'idem-1',
      });
      check('uploadAttachment -> đúng path :uploadAttachment', calls[0].url.endsWith(':uploadAttachment'));
      check('uploadAttachment -> body chính là Buffer (raw binary, KHÔNG JSON.stringify)', Buffer.isBuffer(calls[0].body) && calls[0].body.equals(buf));
      check('uploadAttachment -> Content-Type = mimeType thật, KHÔNG phải application/json', calls[0].headers['Content-Type'] === 'application/pdf');
      check('uploadAttachment -> X-Attachment-Filename đã encodeURIComponent', calls[0].headers['X-Attachment-Filename'] === encodeURIComponent('bao cao.pdf'));
      check('uploadAttachment -> X-Attachment-Actor-Employee-Code đúng', calls[0].headers['X-Attachment-Actor-Employee-Code'] === 'PHF002');
      check('uploadAttachment -> Content-Length đúng bytes thật', calls[0].headers['Content-Length'] === String(buf.length));

      await bridge.bridgeRemoveTaskAttachment('t1', 'att-1', 'sai file', 'PHF002');
      check('removeAttachment -> đúng path + body JSON đúng field (khác upload)', calls[1].url.endsWith(':removeAttachment') && JSON.parse(calls[1].body).attachmentId === 'att-1');

      const dl = await bridge.bridgeDownloadTaskAttachment('t1', 'att-1');
      check('downloadAttachment -> GET method, đúng path /attachments/:id', calls[2].method === 'GET' && calls[2].url.endsWith('/t1/attachments/att-1'));
      check('downloadAttachment -> trả về response thô (không parse JSON), caller tự pipe stream', dl.body === 'FAKE_STREAM');
    } finally {
      global.fetch = originalFetch;
    }
  }

  // -------------------------------------------------------------------
  // Case 6 — bridgeGetTaskById (SINGLE TASK READ FOUNDATION).
  // -------------------------------------------------------------------
  {
    process.env.PHF_TASK_WRITE_BRIDGE_ENABLED = 'true';
    process.env.PHF_HR_API_BASE_URL = 'https://fake-hr-api.internal';
    process.env.PHF_HR_API_SERVICE_TOKEN = 'fake-token';
    const bridge = freshBridge();
    const calls = [];
    const originalFetch = global.fetch;

    global.fetch = async (url, opts) => {
      calls.push({ url, method: opts.method, headers: opts.headers });
      return { ok: true, status: 200, json: async () => ({ data: { task: { id: 't1', row_version: 2 }, assignees: [{ role: 'primary' }] } }) };
    };
    try {
      const out = await bridge.bridgeGetTaskById('t1');
      check('getTaskById -> GET method, đúng path /v1/task/tasks/:id', calls[0].method === 'GET' && calls[0].url.endsWith('/v1/task/tasks/t1'));
      check('getTaskById -> unwrap parsed.data đúng (task+assignees)', out.task.id === 't1' && out.task.row_version === 2 && out.assignees[0].role === 'primary');
    } finally { global.fetch = originalFetch; }

    global.fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: 'TASK_NOT_FOUND', message: 'Không tìm thấy task.' }) });
    try {
      const out = await bridge.bridgeGetTaskById('not-exist');
      check('getTaskById -> 404 trả {task:null, assignees:[]}, KHÔNG throw (caller tự quyết xử lý not-found)', out.task === null && Array.isArray(out.assignees) && out.assignees.length === 0);
    } finally { global.fetch = originalFetch; }

    global.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'TASK_READ_ERROR', message: 'Lỗi hệ thống.' }) });
    try {
      await bridge.bridgeGetTaskById('t1');
      check('getTaskById -> PHẢI throw khi lỗi thật (không phải 404)', false);
    } catch (err) {
      check('getTaskById -> error khác 404 vẫn throw đúng code/message (envelope {error,message} của read-route)', err.code === 'TASK_READ_ERROR' && err.statusCode === 500);
    } finally { global.fetch = originalFetch; }
  }

  delete process.env.PHF_TASK_WRITE_BRIDGE_ENABLED;
  delete process.env.PHF_HR_API_BASE_URL;
  delete process.env.PHF_HR_API_SERVICE_TOKEN;

  console.log(`\n${PASS}/${PASS + FAIL} PASS`);
  if (FAIL > 0) process.exit(1);
}

run().catch((err) => { console.error('HARNESS_CRASH', err); process.exit(1); });
