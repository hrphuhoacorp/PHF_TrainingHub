'use strict';

// Test cho api/_lib/task-server-integration.js — pilot createTaskDraft qua
// phf-hr-api. Mock-only: task-core.js's resolveAndValidateCreateDraftInput
// và task-write-bridge.js's bridgeCreateDraftTask đều bị mock qua
// require.cache — KHÔNG DB/network thật.

const assert = require('assert');

const integrationPath = require.resolve('../api/_lib/task-server-integration');
const taskCorePath = require.resolve('../api/_lib/task-core');
const writeBridgePath = require.resolve('../api/_lib/task-write-bridge');
const employeeScopePath = require.resolve('../api/_lib/task-employee-scope');

let PASS = 0, FAIL = 0;
function check(name, cond) { if (cond) PASS++; else { FAIL++; console.error('FAIL:', name); } }

function setup({
  validateResult, validateThrows, bridgeResult, bridgeThrows, authorizeResult, authorizeThrows,
  getTaskByIdResult, publishResult, publishThrows, orgRows,
  departmentSnapshotResult, notificationRecipientResult, notificationRecipientThrows, notifyThrows,
}) {
  delete require.cache[integrationPath];
  delete require.cache[taskCorePath];
  delete require.cache[writeBridgePath];
  delete require.cache[employeeScopePath];

  const validateCalls = [];
  const authorizeCalls = [];
  const departmentSnapshotCalls = [];
  const notificationRecipientCalls = [];
  require.cache[taskCorePath] = {
    id: taskCorePath, filename: taskCorePath, loaded: true,
    exports: {
      resolveAndValidateCreateDraftInput: async (session, input) => {
        validateCalls.push({ session, input });
        if (validateThrows) throw validateThrows;
        return validateResult;
      },
      resolveAndAuthorizePublish: async (session, current) => {
        authorizeCalls.push({ session, current });
        if (authorizeThrows) throw authorizeThrows;
        return authorizeResult;
      },
      resolveTaskDepartmentSnapshot: (actorContext, primaryEmployeeCode, rows) => {
        departmentSnapshotCalls.push({ actorContext, primaryEmployeeCode, rows });
        return departmentSnapshotResult || { sourceDepartment: null, targetDepartment: null };
      },
      resolveCrossDepartmentNotificationRecipient: async (actorContext, taskId, publishedRow, assigneeRows) => {
        notificationRecipientCalls.push({ actorContext, taskId, publishedRow, assigneeRows });
        if (notificationRecipientThrows) throw notificationRecipientThrows;
        return notificationRecipientResult !== undefined ? notificationRecipientResult : null;
      },
    },
  };

  require.cache[employeeScopePath] = {
    id: employeeScopePath, filename: employeeScopePath, loaded: true,
    exports: {
      loadOrgRows: async () => orgRows || [],
    },
  };

  const bridgeCalls = [];
  const getTaskByIdCalls = [];
  const publishCalls = [];
  const notifyCalls = [];
  require.cache[writeBridgePath] = {
    id: writeBridgePath, filename: writeBridgePath, loaded: true,
    exports: {
      bridgeCreateDraftTask: async (params) => {
        bridgeCalls.push(params);
        if (bridgeThrows) throw bridgeThrows;
        return bridgeResult;
      },
      bridgeGetTaskById: async (taskId) => {
        getTaskByIdCalls.push(taskId);
        return getTaskByIdResult;
      },
      bridgePublishTask: async (...args) => {
        publishCalls.push(args);
        if (publishThrows) throw publishThrows;
        return publishResult;
      },
      bridgeEmitTaskNotification: async (...args) => {
        notifyCalls.push(args);
        if (notifyThrows) throw notifyThrows;
        return { created: 1 };
      },
    },
  };

  const integration = require(integrationPath);
  return { integration, validateCalls, bridgeCalls, authorizeCalls, getTaskByIdCalls, publishCalls, departmentSnapshotCalls, notificationRecipientCalls, notifyCalls };
}

async function run() {
  // Case 1 — flag helper mặc định tắt.
  {
    delete process.env.PHF_TASK_SERVER_WRITE_ENABLED;
    const { integration } = setup({ validateResult: {}, bridgeResult: {} });
    check('isServerWriteEnabled() = false mặc định', integration.isServerWriteEnabled() === false);
    process.env.PHF_TASK_SERVER_WRITE_ENABLED = 'true';
    check('isServerWriteEnabled() = true khi set đúng', integration.isServerWriteEnabled() === true);
    delete process.env.PHF_TASK_SERVER_WRITE_ENABLED;
  }

  // Case 2 — happy path: validate() gọi ĐÚNG 1 lần với session/input gốc,
  // bridge() nhận ĐÚNG field đã validate (không tự thêm/bớt field).
  {
    const validateResult = {
      actorContext: { employeeCode: 'PHF010', accountId: null },
      flowType: 'giao_viec', title: 'Test', content: 'noi dung',
      categoryCode: 'CONG_VIEC_TONG_THE', priority: 'thuong',
      startAt: null, deadline: '2026-09-01T00:00:00Z',
      primaryEmployeeCode: 'PHF082', idempotencyKey: 'abc-123',
    };
    const bridgeResult = { id: 't1', task_code: 'CV-2609-0001', status: 'draft', priority: 'thuong' };
    const { integration, validateCalls, bridgeCalls } = setup({ validateResult, bridgeResult });

    const session = { account: { employeeCode: 'PHF010' } };
    const input = { flowType: 'giao_viec', title: 'Test' };
    const result = await integration.createTaskDraftViaServer(session, input);

    check('resolveAndValidateCreateDraftInput được gọi đúng 1 lần với session/input gốc',
      validateCalls.length === 1 && validateCalls[0].session === session && validateCalls[0].input === input);
    check('bridgeCreateDraftTask nhận đúng actorEmployeeCode/actorAccountId từ actorContext đã validate',
      bridgeCalls[0].actorEmployeeCode === 'PHF010' && bridgeCalls[0].actorAccountId === null);
    check('bridgeCreateDraftTask nhận đúng field đã validate (flowType/title/categoryCode/priority/deadline/primaryEmployeeCode/idempotencyKey)',
      bridgeCalls[0].flowType === 'giao_viec' && bridgeCalls[0].title === 'Test' &&
      bridgeCalls[0].categoryCode === 'CONG_VIEC_TONG_THE' && bridgeCalls[0].priority === 'thuong' &&
      bridgeCalls[0].deadline === '2026-09-01T00:00:00Z' && bridgeCalls[0].primaryEmployeeCode === 'PHF082' &&
      bridgeCalls[0].idempotencyKey === 'abc-123');
    check('KHÔNG gọi persist nào khác ngoài bridgeCreateDraftTask (đúng 1 call)', bridgeCalls.length === 1);
    check('trả về ĐÚNG response từ bridge, không tự remap/fabricate field', result === bridgeResult);
  }

  // Case 3 — primaryEmployeeCode/idempotencyKey rỗng -> gửi undefined
  // (KHÔNG gửi '' hay null tường minh gây hiểu lầm khác semantics gốc).
  {
    const validateResult = {
      actorContext: { employeeCode: 'PHF002', accountId: 'acc-1' },
      flowType: 'de_xuat', title: 'Test2', content: '',
      categoryCode: 'NHAN_SU', priority: 'khan_cap',
      startAt: null, deadline: '2026-09-02T00:00:00Z',
      primaryEmployeeCode: '', idempotencyKey: null,
    };
    const { integration, bridgeCalls } = setup({ validateResult, bridgeResult: {} });
    await integration.createTaskDraftViaServer({}, {});
    check('primaryEmployeeCode rỗng -> undefined (không phải "" hay null)', bridgeCalls[0].primaryEmployeeCode === undefined);
    check('idempotencyKey null -> undefined', bridgeCalls[0].idempotencyKey === undefined);
    check('actorAccountId truyền đúng khi actorContext có accountId', bridgeCalls[0].actorAccountId === 'acc-1');
  }

  // Case 4 — validate() throw (business validation fail) -> KHÔNG bao giờ
  // gọi bridge (fail-fast trước persist, giống hệt task-core.js hôm nay).
  {
    const err = Object.assign(new Error('Tiêu đề là bắt buộc.'), { code: 'TASK_TITLE_REQUIRED', statusCode: 400 });
    const { integration, bridgeCalls } = setup({ validateThrows: err, bridgeResult: {} });
    try {
      await integration.createTaskDraftViaServer({}, {});
      check('PHẢI throw khi validate fail', false);
    } catch (thrown) {
      check('error code pass-through nguyên vẹn từ validate()', thrown.code === 'TASK_TITLE_REQUIRED');
      check('KHÔNG gọi bridge khi validate đã fail (fail-fast, không persist)', bridgeCalls.length === 0);
    }
  }

  // Case 5 — bridge() throw (upstream phf-hr-api lỗi) -> pass-through nguyên vẹn.
  {
    const validateResult = {
      actorContext: { employeeCode: 'PHF010', accountId: null },
      flowType: 'giao_viec', title: 'T', content: '', categoryCode: 'C', priority: 'thuong',
      startAt: null, deadline: '2026-09-01T00:00:00Z', primaryEmployeeCode: '', idempotencyKey: null,
    };
    const err = Object.assign(new Error('Category không tồn tại.'), { code: 'TASK_CATEGORY_NOT_FOUND', statusCode: 400 });
    const { integration } = setup({ validateResult, bridgeThrows: err });
    try {
      await integration.createTaskDraftViaServer({}, {});
      check('PHẢI throw khi bridge fail', false);
    } catch (thrown) {
      check('error code pass-through nguyên vẹn từ bridge()', thrown.code === 'TASK_CATEGORY_NOT_FOUND');
    }
  }

  // =====================================================================
  // publishTaskViaServer — pilot #2
  // =====================================================================

  // Case 6 — happy path: getTaskById() -> authorize() -> resolve department
  // snapshot -> bridgePublishTask() -> resolve notification recipient ->
  // bridgeEmitTaskNotification(), ĐÚNG THỨ TỰ, dùng state từ phf_hr (KHÔNG
  // Supabase). Cross-department notification GAP đã ĐÓNG (2026-08-27) —
  // sourceDepartment/targetDepartment nay được resolve thật, KHÔNG còn null
  // cứng.
  {
    const assignees = [{ role: 'primary', is_active: true, employee_code: 'PHF082' }];
    const getTaskByIdResult = { task: { id: 't1', status: 'draft', created_by_employee_code: 'PHF002', row_version: 1 }, assignees };
    const authorizeResult = { employeeCode: 'PHF002', accountId: null };
    const publishResult = { id: 't1', status: 'published', row_version: 2, is_cross_department: true, source_department: 'Kinh doanh', target_department: 'Kho vận' };
    const departmentSnapshotResult = { sourceDepartment: 'Kinh doanh', targetDepartment: 'Kho vận' };
    const notificationRecipientResult = { recipientEmployeeCode: 'PHF001', title: 'Việc mới', message: 'msg', targetPath: '/x', dedupeKey: 'k1' };
    const { integration, getTaskByIdCalls, authorizeCalls, publishCalls, departmentSnapshotCalls, notificationRecipientCalls, notifyCalls } =
      setup({ getTaskByIdResult, authorizeResult, publishResult, departmentSnapshotResult, notificationRecipientResult });

    const session = { account: { employeeCode: 'PHF002' } };
    const result = await integration.publishTaskViaServer(session, 't1', 1);

    check('bridgeGetTaskById được gọi đúng 1 lần với đúng taskId', getTaskByIdCalls.length === 1 && getTaskByIdCalls[0] === 't1');
    check('resolveAndAuthorizePublish nhận ĐÚNG task row từ bridgeGetTaskById (KHÔNG phải từ nguồn khác)',
      authorizeCalls.length === 1 && authorizeCalls[0].current === getTaskByIdResult.task && authorizeCalls[0].session === session);
    check('resolveTaskDepartmentSnapshot nhận đúng primaryEmployeeCode từ assignees (active primary)',
      departmentSnapshotCalls.length === 1 && departmentSnapshotCalls[0].primaryEmployeeCode === 'PHF082');
    check('bridgePublishTask nhận đúng taskId/expectedRowVersion/actor từ actorContext đã authorize',
      publishCalls.length === 1 && publishCalls[0][0] === 't1' && publishCalls[0][1] === 1 &&
      publishCalls[0][4] === 'PHF002' && publishCalls[0][5] === null);
    check('sourceDepartment/targetDepartment nay resolve THẬT (gap đã đóng, KHÔNG còn null cứng)',
      publishCalls[0][2] === 'Kinh doanh' && publishCalls[0][3] === 'Kho vận');
    check('resolveCrossDepartmentNotificationRecipient nhận ĐÚNG published row + assignees gốc',
      notificationRecipientCalls.length === 1 && notificationRecipientCalls[0].publishedRow === publishResult && notificationRecipientCalls[0].assigneeRows === assignees);
    check('bridgeEmitTaskNotification được gọi với đúng recipient/title/message/targetPath/dedupeKey đã resolve',
      notifyCalls.length === 1 && notifyCalls[0][0] === 't1' && notifyCalls[0][1] === 'PHF001' &&
      notifyCalls[0][2] === 'Việc mới' && notifyCalls[0][3] === 'msg' && notifyCalls[0][4] === '/x' && notifyCalls[0][5] === 'k1');
    check('trả về ĐÚNG response từ bridgePublishTask', result === publishResult);
  }

  // Case 6b — recipient null (không cross-department, hoặc không đủ điều
  // kiện) -> KHÔNG gọi bridgeEmitTaskNotification, publish vẫn PASS bình thường.
  {
    const { integration, notifyCalls } = setup({
      getTaskByIdResult: { task: { id: 't1', status: 'draft' }, assignees: [] },
      authorizeResult: { employeeCode: 'PHF002', accountId: null },
      publishResult: { id: 't1', status: 'published', row_version: 2, is_cross_department: false },
      notificationRecipientResult: null,
    });
    const result = await integration.publishTaskViaServer({}, 't1', 1);
    check('recipient null -> KHÔNG gọi bridgeEmitTaskNotification', notifyCalls.length === 0);
    check('publish vẫn trả về đúng kết quả', result.status === 'published');
  }

  // Case 6c — notification emit THROW (vd phf-hr-api lỗi) -> best-effort,
  // publish KHÔNG bị ảnh hưởng, response publish vẫn trả về bình thường
  // (GIỐNG HỆT semantics emitTaskNotificationSafe() bên Supabase path).
  {
    const notifyThrows = Object.assign(new Error('upstream lỗi'), { code: 'TASK_WRITE_BRIDGE_UPSTREAM_ERROR' });
    const publishResult = { id: 't1', status: 'published', row_version: 2, is_cross_department: true, source_department: 'A', target_department: 'B' };
    const { integration, notifyCalls } = setup({
      getTaskByIdResult: { task: { id: 't1', status: 'draft' }, assignees: [] },
      authorizeResult: { employeeCode: 'PHF002', accountId: null },
      publishResult,
      notificationRecipientResult: { recipientEmployeeCode: 'PHF001', title: 't', message: 'm', targetPath: '/x', dedupeKey: 'k' },
      notifyThrows,
    });
    const result = await integration.publishTaskViaServer({}, 't1', 1);
    check('notify throw -> KHÔNG throw ra ngoài, publish response vẫn trả về nguyên vẹn', result === publishResult);
    check('bridgeEmitTaskNotification đã ĐƯỢC gọi (throw xảy ra bên trong, không phải bị bỏ qua trước đó)', notifyCalls.length === 1);
  }

  // Case 6d — resolveCrossDepartmentNotificationRecipient THROW -> cũng
  // best-effort, KHÔNG làm hỏng publish (try/catch bao trọn cả seam resolve
  // LẪN persist notify, đúng semantics applyCrossDepartmentPublishSideEffects
  // gốc — 1 try/catch duy nhất bao hết side-effect).
  {
    const recipientThrows = new Error('org data lookup lỗi');
    const publishResult = { id: 't1', status: 'published', row_version: 2 };
    const { integration, notifyCalls } = setup({
      getTaskByIdResult: { task: { id: 't1', status: 'draft' }, assignees: [] },
      authorizeResult: { employeeCode: 'PHF002', accountId: null },
      publishResult,
      notificationRecipientThrows: recipientThrows,
    });
    const result = await integration.publishTaskViaServer({}, 't1', 1);
    check('resolveCrossDepartmentNotificationRecipient throw -> KHÔNG làm hỏng publish', result === publishResult);
    check('KHÔNG gọi bridgeEmitTaskNotification khi resolve đã throw trước đó', notifyCalls.length === 0);
  }

  // Case 7 — task không tồn tại trên phf_hr (task=null) -> authorize() nhận
  // current=null, PHẢI throw TASK_NOT_FOUND TRƯỚC KHI gọi bridgePublishTask
  // (fail-fast, không publish task không tồn tại).
  {
    const notFoundErr = Object.assign(new Error('Không tìm thấy task.'), { code: 'TASK_NOT_FOUND', statusCode: 404 });
    const { integration, authorizeCalls, publishCalls } = setup({
      getTaskByIdResult: { task: null, assignees: [] },
      authorizeThrows: notFoundErr,
    });
    try {
      await integration.publishTaskViaServer({}, 'not-exist', 1);
      check('PHẢI throw khi task không tồn tại trên phf_hr', false);
    } catch (err) {
      check('throw đúng TASK_NOT_FOUND', err.code === 'TASK_NOT_FOUND');
      check('authorize được gọi với current=null (đúng, không tự chế data)', authorizeCalls[0].current === null);
      check('KHÔNG gọi bridgePublishTask khi authorize đã fail (fail-fast)', publishCalls.length === 0);
    }
  }

  // Case 8 — authorize fail (không đủ quyền) -> KHÔNG gọi publish.
  {
    const denyErr = Object.assign(new Error('Không có quyền.'), { code: 'TASK_ASSIGN_DENIED', statusCode: 403 });
    const { integration, publishCalls } = setup({
      getTaskByIdResult: { task: { id: 't1', status: 'draft' }, assignees: [] },
      authorizeThrows: denyErr,
    });
    try {
      await integration.publishTaskViaServer({}, 't1', 1);
      check('PHẢI throw khi authorize fail', false);
    } catch (err) {
      check('error pass-through nguyên vẹn từ authorize()', err.code === 'TASK_ASSIGN_DENIED');
      check('KHÔNG gọi bridgePublishTask khi authorize fail', publishCalls.length === 0);
    }
  }

  // Case 9 — publish fail (vd version conflict) -> pass-through nguyên vẹn.
  {
    const conflictErr = Object.assign(new Error('Phiên bản đã thay đổi.'), { code: 'TASK_VERSION_CONFLICT', statusCode: 409 });
    const { integration } = setup({
      getTaskByIdResult: { task: { id: 't1', status: 'draft' }, assignees: [] },
      authorizeResult: { employeeCode: 'PHF002', accountId: null },
      publishThrows: conflictErr,
    });
    try {
      await integration.publishTaskViaServer({}, 't1', 1);
      check('PHẢI throw khi publish fail', false);
    } catch (err) {
      check('error pass-through nguyên vẹn từ bridgePublishTask', err.code === 'TASK_VERSION_CONFLICT');
    }
  }

  console.log(`\n${PASS}/${PASS + FAIL} PASS`);
  if (FAIL > 0) process.exit(1);
}

run().catch((err) => { console.error('HARNESS_CRASH', err); process.exit(1); });
