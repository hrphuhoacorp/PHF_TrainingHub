'use strict';

// Test cho 10 hàm còn lại trong api/_lib/task-server-integration.js (23/23):
// category CRUD x5, permission assignment x1, permission grant x2, attachment
// upload/remove x2 (nhóm "GROUP" 2026-08-27, batch 14-23). Mock-only qua
// require.cache: task-core.js (seam authorize/validate), task-write-bridge.js
// (bridge<Verb>). KHÔNG DB/network thật.

const integrationPath = require.resolve('../api/_lib/task-server-integration');
const taskCorePath = require.resolve('../api/_lib/task-core');
const employeeScopePath = require.resolve('../api/_lib/task-employee-scope');
const permissionsPath = require.resolve('../api/_lib/task-permissions');
const writeBridgePath = require.resolve('../api/_lib/task-write-bridge');

let PASS = 0, FAIL = 0;
function check(name, cond) { if (cond) PASS++; else { FAIL++; console.error('FAIL:', name); } }

const DEFAULT_ADMIN = { employeeCode: 'PHF001', accountId: 'acc-1' };

function setup(overrides = {}) {
  delete require.cache[integrationPath];
  delete require.cache[taskCorePath];
  delete require.cache[employeeScopePath];
  delete require.cache[permissionsPath];
  delete require.cache[writeBridgePath];

  const calls = {
    requireTaskAdmin: [], validateCategoryCode: [], validateCategoryName: [],
    validateCategoryActiveFlag: [], validateCategorySortOrder: [],
    resolveAssignment: [], resolveCreateGrant: [], resolveRevokeGrant: [],
    authorizeView: [], getTaskById: [], bridge: {},
  };

  require.cache[taskCorePath] = {
    id: taskCorePath, filename: taskCorePath, loaded: true,
    exports: {
      requireTaskAdmin: async (session) => { calls.requireTaskAdmin.push(session); if (overrides.requireTaskAdminThrows) throw overrides.requireTaskAdminThrows; return overrides.actorContext || DEFAULT_ADMIN; },
      validateCategoryCode: (v) => { calls.validateCategoryCode.push(v); if (overrides.validateCategoryCodeThrows) throw overrides.validateCategoryCodeThrows; return String(v || '').toUpperCase(); },
      validateCategoryName: (v) => { calls.validateCategoryName.push(v); if (overrides.validateCategoryNameThrows) throw overrides.validateCategoryNameThrows; return v; },
      validateCategoryActiveFlag: (v) => { calls.validateCategoryActiveFlag.push(v); if (overrides.validateCategoryActiveFlagThrows) throw overrides.validateCategoryActiveFlagThrows; return v; },
      validateCategorySortOrder: (v) => { calls.validateCategorySortOrder.push(v); if (overrides.validateCategorySortOrderThrows) throw overrides.validateCategorySortOrderThrows; return Number(v); },
      resolveAndAuthorizeSetPermissionAssignment: async (session, input) => {
        calls.resolveAssignment.push({ session, input });
        if (overrides.resolveAssignmentThrows) throw overrides.resolveAssignmentThrows;
        return overrides.resolveAssignmentResult || { admin: DEFAULT_ADMIN, employeeCode: 'PHF012', presetCode: 'STANDARD', reason: 'ly do', accountId: 'acc-12' };
      },
      resolveAndAuthorizeCreatePermissionGrant: async (session, input) => {
        calls.resolveCreateGrant.push({ session, input });
        if (overrides.resolveCreateGrantThrows) throw overrides.resolveCreateGrantThrows;
        return overrides.resolveCreateGrantResult || { admin: DEFAULT_ADMIN, granteeEmployeeCode: 'PHF012', peopleScope: { type: 'all_company', values: [] }, reason: 'ly do' };
      },
      resolveAndAuthorizeRevokePermissionGrant: async (session, grantId, reason) => {
        calls.resolveRevokeGrant.push({ session, grantId, reason });
        if (overrides.resolveRevokeGrantThrows) throw overrides.resolveRevokeGrantThrows;
        return overrides.resolveRevokeGrantResult || { admin: DEFAULT_ADMIN, grantId: 'grant-1', reason: 'thu hoi' };
      },
      resolveAndAuthorizeView: async (session, current, assignees) => {
        calls.authorizeView.push({ session, current, assignees });
        if (overrides.authorizeViewThrows) throw overrides.authorizeViewThrows;
        return overrides.authorizeViewResult || { employeeCode: 'PHF010', accountId: null };
      },
    },
  };

  require.cache[employeeScopePath] = { id: employeeScopePath, filename: employeeScopePath, loaded: true, exports: { resolveActorContext: async () => DEFAULT_ADMIN } };
  require.cache[permissionsPath] = { id: permissionsPath, filename: permissionsPath, loaded: true, exports: { canAssignTaskTo: async () => true, canAddTaskRelated: async () => true } };

  function makeBridgeFn(name) {
    return async (...args) => {
      calls.bridge[name] = calls.bridge[name] || [];
      calls.bridge[name].push(args);
      if (overrides.bridgeThrows) throw overrides.bridgeThrows;
      return (overrides.bridgeResults && overrides.bridgeResults[name]) || { ok: true, name };
    };
  }
  require.cache[writeBridgePath] = {
    id: writeBridgePath, filename: writeBridgePath, loaded: true,
    exports: {
      bridgeGetTaskById: async (taskId) => { calls.getTaskById.push(taskId); return overrides.getTaskByIdResult || { task: { id: taskId }, assignees: [] }; },
      bridgeCreateTaskCategory: makeBridgeFn('createTaskCategory'),
      bridgeRenameTaskCategory: makeBridgeFn('renameTaskCategory'),
      bridgeSetTaskCategoryActive: makeBridgeFn('setTaskCategoryActive'),
      bridgeReorderTaskCategory: makeBridgeFn('reorderTaskCategory'),
      bridgeDeleteTaskCategoryIfUnused: makeBridgeFn('deleteTaskCategoryIfUnused'),
      bridgeSetTaskPermissionAssignment: makeBridgeFn('setTaskPermissionAssignment'),
      bridgeCreateTaskPermissionGrant: makeBridgeFn('createTaskPermissionGrant'),
      bridgeRevokeTaskPermissionGrant: makeBridgeFn('revokeTaskPermissionGrant'),
      bridgeUploadTaskAttachment: makeBridgeFn('uploadTaskAttachment'),
      bridgeRemoveTaskAttachment: makeBridgeFn('removeTaskAttachment'),
    },
  };

  const integration = require(integrationPath);
  return { integration, calls };
}

async function run() {
  // ---- createTaskCategoryViaServer ----
  {
    const { integration, calls } = setup();
    await integration.createTaskCategoryViaServer({}, 'khn', 'Kho Hàng Nhập');
    check('createTaskCategory: admin required', calls.requireTaskAdmin.length === 1);
    check('createTaskCategory: category code+name validate được gọi', calls.validateCategoryCode.length === 1 && calls.validateCategoryName.length === 1);
    check('createTaskCategory: bridge nhận đúng code (đã validate/uppercase) + actor', calls.bridge.createTaskCategory[0][0] === 'KHN' && calls.bridge.createTaskCategory[0][2] === 'PHF001' && calls.bridge.createTaskCategory[0][3] === 'acc-1');
  }
  {
    // không phải admin -> KHÔNG gọi bridge
    const err = Object.assign(new Error('deny'), { code: 'TASK_CATEGORY_ADMIN_REQUIRED' });
    const { integration, calls } = setup({ requireTaskAdminThrows: err });
    try { await integration.createTaskCategoryViaServer({}, 'x', 'y'); check('phải throw', false); }
    catch (e) { check('createTaskCategory: not-admin -> KHÔNG gọi bridge, error pass-through', e.code === 'TASK_CATEGORY_ADMIN_REQUIRED' && !calls.bridge.createTaskCategory); }
  }

  // ---- renameTaskCategoryViaServer ----
  {
    const { integration, calls } = setup();
    await integration.renameTaskCategoryViaServer({}, 'khn', 'Kho Hàng Nhập Mới');
    check('renameTaskCategory: bridge nhận đúng displayName', calls.bridge.renameTaskCategory[0][1] === 'Kho Hàng Nhập Mới');
  }

  // ---- setTaskCategoryActiveViaServer ----
  {
    const { integration, calls } = setup();
    await integration.setTaskCategoryActiveViaServer({}, 'khn', false);
    check('setTaskCategoryActive: validateCategoryActiveFlag được gọi', calls.validateCategoryActiveFlag.length === 1);
    check('setTaskCategoryActive: bridge nhận đúng isActive', calls.bridge.setTaskCategoryActive[0][1] === false);
  }

  // ---- reorderTaskCategoryViaServer ----
  {
    const { integration, calls } = setup();
    await integration.reorderTaskCategoryViaServer({}, 'khn', 3);
    check('reorderTaskCategory: validateCategorySortOrder được gọi', calls.validateCategorySortOrder.length === 1);
    check('reorderTaskCategory: bridge nhận đúng sortOrder', calls.bridge.reorderTaskCategory[0][1] === 3);
  }

  // ---- deleteTaskCategoryIfUnusedViaServer ----
  {
    const { integration, calls } = setup();
    await integration.deleteTaskCategoryIfUnusedViaServer({}, 'khn');
    check('deleteTaskCategoryIfUnused: bridge KHÔNG nhận actor (đúng contract không audit column)', calls.bridge.deleteTaskCategoryIfUnused[0].length === 1);
  }

  // ---- setTaskPermissionAssignmentViaServer ----
  {
    const { integration, calls } = setup();
    await integration.setTaskPermissionAssignmentViaServer({}, { employeeCode: 'phf012', presetCode: 'standard', reason: 'ly do' });
    check('setTaskPermissionAssignment: seam resolveAndAuthorizeSetPermissionAssignment được gọi', calls.resolveAssignment.length === 1);
    check('setTaskPermissionAssignment: bridge nhận đúng accountId/employeeCode/presetCode/reason/actor',
      calls.bridge.setTaskPermissionAssignment[0][0] === 'acc-12' &&
      calls.bridge.setTaskPermissionAssignment[0][1] === 'PHF012' &&
      calls.bridge.setTaskPermissionAssignment[0][2] === 'STANDARD' &&
      calls.bridge.setTaskPermissionAssignment[0][3] === 'ly do' &&
      calls.bridge.setTaskPermissionAssignment[0][4] === 'PHF001' &&
      calls.bridge.setTaskPermissionAssignment[0][5] === 'acc-1');
  }
  {
    const err = Object.assign(new Error('inactive'), { code: 'TASK_PERMISSION_GRANTEE_INACTIVE' });
    const { integration, calls } = setup({ resolveAssignmentThrows: err });
    try { await integration.setTaskPermissionAssignmentViaServer({}, {}); check('phải throw', false); }
    catch (e) { check('setTaskPermissionAssignment: seam throw -> KHÔNG gọi bridge', e.code === 'TASK_PERMISSION_GRANTEE_INACTIVE' && !calls.bridge.setTaskPermissionAssignment); }
  }

  // ---- createTaskPermissionGrantViaServer ----
  {
    const { integration, calls } = setup();
    await integration.createTaskPermissionGrantViaServer({}, { granteeEmployeeCode: 'phf012', peopleScope: { type: 'all_company' }, reason: 'ly do' });
    check('createTaskPermissionGrant: seam resolveAndAuthorizeCreatePermissionGrant được gọi', calls.resolveCreateGrant.length === 1);
    check('createTaskPermissionGrant: bridge nhận đúng grantee/peopleScope/reason/actor',
      calls.bridge.createTaskPermissionGrant[0][0] === 'PHF012' &&
      calls.bridge.createTaskPermissionGrant[0][1].type === 'all_company' &&
      calls.bridge.createTaskPermissionGrant[0][2] === 'ly do' &&
      calls.bridge.createTaskPermissionGrant[0][3] === 'PHF001');
  }

  // ---- revokeTaskPermissionGrantViaServer ----
  {
    const { integration, calls } = setup();
    await integration.revokeTaskPermissionGrantViaServer({}, 'grant-1', 'thu hoi');
    check('revokeTaskPermissionGrant: seam resolveAndAuthorizeRevokePermissionGrant được gọi (KHÔNG tự đọc existing từ Supabase)', calls.resolveRevokeGrant.length === 1);
    check('revokeTaskPermissionGrant: bridge nhận đúng grantId/reason/actor',
      calls.bridge.revokeTaskPermissionGrant[0][0] === 'grant-1' &&
      calls.bridge.revokeTaskPermissionGrant[0][1] === 'thu hoi' &&
      calls.bridge.revokeTaskPermissionGrant[0][2] === 'PHF001');
  }
  {
    const err = Object.assign(new Error('not found'), { code: 'TASK_PERMISSION_GRANT_NOT_FOUND' });
    const { integration, calls } = setup({ resolveRevokeGrantThrows: err });
    try { await integration.revokeTaskPermissionGrantViaServer({}, 'x', 'y'); check('phải throw', false); }
    catch (e) { check('revokeTaskPermissionGrant: seam throw -> KHÔNG gọi bridge', e.code === 'TASK_PERMISSION_GRANT_NOT_FOUND' && !calls.bridge.revokeTaskPermissionGrant); }
  }

  // ---- uploadTaskAttachmentViaServer ----
  {
    const { integration, calls } = setup();
    const buf = Buffer.from('hello');
    await integration.uploadTaskAttachmentViaServer({}, 't1', buf, { filename: 'a.pdf', mimeType: 'application/pdf', idempotencyKey: 'idem-1' });
    check('uploadTaskAttachment: dùng resolveAndAuthorizeView (giống addTaskComment/addTaskLink)', calls.authorizeView.length === 1);
    check('uploadTaskAttachment: bridge nhận đúng taskId/buffer/options', calls.bridge.uploadTaskAttachment[0][0] === 't1' && calls.bridge.uploadTaskAttachment[0][1] === buf && calls.bridge.uploadTaskAttachment[0][2].filename === 'a.pdf' && calls.bridge.uploadTaskAttachment[0][2].actorEmployeeCode === 'PHF010');
  }
  {
    const err = Object.assign(new Error('deny'), { code: 'TASK_VIEW_DENIED' });
    const { integration, calls } = setup({ authorizeViewThrows: err });
    try { await integration.uploadTaskAttachmentViaServer({}, 't1', Buffer.from('x'), {}); check('phải throw', false); }
    catch (e) { check('uploadTaskAttachment: view denied -> KHÔNG gọi bridge', e.code === 'TASK_VIEW_DENIED' && !calls.bridge.uploadTaskAttachment); }
  }

  // ---- removeTaskAttachmentViaServer ----
  {
    const { integration, calls } = setup();
    await integration.removeTaskAttachmentViaServer({}, 't1', 'att-1', 'sai file');
    check('removeTaskAttachment: dùng resolveAndAuthorizeView', calls.authorizeView.length === 1);
    check('removeTaskAttachment: bridge nhận đúng taskId/attachmentId/reason/actor', calls.bridge.removeTaskAttachment[0][0] === 't1' && calls.bridge.removeTaskAttachment[0][1] === 'att-1' && calls.bridge.removeTaskAttachment[0][2] === 'sai file' && calls.bridge.removeTaskAttachment[0][3] === 'PHF010');
  }

  console.log(`\n${PASS}/${PASS + FAIL} PASS`);
  if (FAIL > 0) process.exit(1);
}

run().catch((err) => { console.error('HARNESS_CRASH', err); process.exit(1); });
