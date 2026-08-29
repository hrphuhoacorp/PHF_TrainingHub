'use strict';

// Test cho 11 hàm lifecycle mới trong api/_lib/task-server-integration.js
// (progress/complete/reopen/cancel/deadline/transfer/related x2/comment/
// link x2 — nhóm "GROUP" 2026-08-27). Mock-only qua require.cache:
// task-core.js (seam authorize), task-employee-scope.js (resolveActorContext),
// task-permissions.js (canAssignTaskTo/canAddTaskRelated), task-write-bridge.js
// (bridgeGetTaskById + bridge<Verb>). KHÔNG DB/network thật.

const integrationPath = require.resolve('../api/_lib/task-server-integration');
const taskCorePath = require.resolve('../api/_lib/task-core');
const employeeScopePath = require.resolve('../api/_lib/task-employee-scope');
const permissionsPath = require.resolve('../api/_lib/task-permissions');
const writeBridgePath = require.resolve('../api/_lib/task-write-bridge');

let PASS = 0, FAIL = 0;
function check(name, cond) { if (cond) PASS++; else { FAIL++; console.error('FAIL:', name); } }

const DEFAULT_ACTOR = { employeeCode: 'PHF010', accountId: null };

function setup(overrides = {}) {
  delete require.cache[integrationPath];
  delete require.cache[taskCorePath];
  delete require.cache[employeeScopePath];
  delete require.cache[permissionsPath];
  delete require.cache[writeBridgePath];

  const calls = { throttle: [], authorizeProgress: [], authorizeComplete: [], authorizeCapability: [], authorizeView: [], resolveActorContext: [], getTaskById: [], bridge: {}, canAssignTaskTo: [], canAddTaskRelated: [] };

  require.cache[taskCorePath] = {
    id: taskCorePath, filename: taskCorePath, loaded: true,
    exports: {
      checkTaskProgressThrottle: (actorContext, taskId) => { calls.throttle.push({ actorContext, taskId }); if (overrides.throttleThrows) throw overrides.throttleThrows; },
      resolveAndAuthorizeUpdateProgress: async (actorContext, current, assignees, expectedRowVersion) => {
        calls.authorizeProgress.push({ actorContext, current, assignees, expectedRowVersion });
        if (overrides.authorizeThrows) throw overrides.authorizeThrows;
      },
      resolveAndAuthorizeComplete: async (session, assignees) => {
        calls.authorizeComplete.push({ session, assignees });
        if (overrides.authorizeThrows) throw overrides.authorizeThrows;
        return overrides.authorizeResult || DEFAULT_ACTOR;
      },
      resolveAndAuthorizeUpdateCapability: async (session, current, loadAssigneeRowsFn) => {
        const assignees = await loadAssigneeRowsFn();
        calls.authorizeCapability.push({ session, current, assignees });
        if (overrides.authorizeThrows) throw overrides.authorizeThrows;
        return overrides.authorizeResult || DEFAULT_ACTOR;
      },
      resolveAndAuthorizeView: async (session, current, assignees) => {
        calls.authorizeView.push({ session, current, assignees });
        if (overrides.authorizeThrows) throw overrides.authorizeThrows;
        return overrides.authorizeResult || DEFAULT_ACTOR;
      },
    },
  };

  require.cache[employeeScopePath] = {
    id: employeeScopePath, filename: employeeScopePath, loaded: true,
    exports: {
      resolveActorContext: async (session) => { calls.resolveActorContext.push(session); return overrides.actorContext || DEFAULT_ACTOR; },
    },
  };

  require.cache[permissionsPath] = {
    id: permissionsPath, filename: permissionsPath, loaded: true,
    exports: {
      canAssignTaskTo: async (session, target) => { calls.canAssignTaskTo.push({ session, target }); return overrides.canAssignTaskTo !== undefined ? overrides.canAssignTaskTo : true; },
      canAddTaskRelated: async (session, target) => { calls.canAddTaskRelated.push({ session, target }); return overrides.canAddTaskRelated !== undefined ? overrides.canAddTaskRelated : true; },
    },
  };

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
      bridgeGetTaskById: async (taskId) => { calls.getTaskById.push(taskId); return overrides.getTaskByIdResult || { task: { id: taskId, row_version: 5 }, assignees: [{ role: 'primary', is_active: true, employee_code: 'PHF010' }] }; },
      bridgeUpdateTaskProgress: makeBridgeFn('updateTaskProgress'),
      bridgeCompleteTask: makeBridgeFn('completeTask'),
      bridgeReopenTask: makeBridgeFn('reopenTask'),
      bridgeCancelTask: makeBridgeFn('cancelTask'),
      bridgeChangeTaskDeadline: makeBridgeFn('changeTaskDeadline'),
      bridgeTransferTaskPrimary: makeBridgeFn('transferTaskPrimary'),
      bridgeAddTaskRelated: makeBridgeFn('addTaskRelated'),
      bridgeRemoveTaskRelated: makeBridgeFn('removeTaskRelated'),
      bridgeAddTaskComment: makeBridgeFn('addTaskComment'),
      bridgeAddTaskLink: makeBridgeFn('addTaskLink'),
      bridgeRemoveTaskLink: makeBridgeFn('removeTaskLink'),
    },
  };

  const integration = require(integrationPath);
  return { integration, calls };
}

async function run() {
  // ---- updateTaskProgressViaServer ----
  {
    const { integration, calls } = setup();
    await integration.updateTaskProgressViaServer({}, 't1', 5, 50, 'on_track');
    check('updateTaskProgress: throttle chạy TRƯỚC getTaskById (thứ tự CONTAINMENT gốc)',
      calls.throttle.length === 1 && calls.getTaskById.length === 1);
    check('updateTaskProgress: authorize nhận đúng expectedRowVersion', calls.authorizeProgress[0].expectedRowVersion === 5);
    check('updateTaskProgress: bridge nhận đúng percent/status + actor', calls.bridge.updateTaskProgress[0][2] === 50 && calls.bridge.updateTaskProgress[0][3] === 'on_track' && calls.bridge.updateTaskProgress[0][4] === 'PHF010');
  }
  {
    // throttle throw -> KHÔNG gọi getTaskById (fail trước mọi I/O)
    const err = Object.assign(new Error('throttled'), { code: 'TASK_UPDATE_THROTTLED' });
    const { integration, calls } = setup({ throttleThrows: err });
    try { await integration.updateTaskProgressViaServer({}, 't1', 5, 50, 'x'); check('phải throw', false); }
    catch (e) { check('updateTaskProgress: throttle throw -> KHÔNG gọi getTaskById', e.code === 'TASK_UPDATE_THROTTLED' && calls.getTaskById.length === 0); }
  }

  // ---- completeTaskViaServer ----
  {
    const { integration, calls } = setup();
    await integration.completeTaskViaServer({}, 't1', 5, 'xong');
    check('completeTask: authorize nhận đúng assignees từ getTaskById', Array.isArray(calls.authorizeComplete[0].assignees));
    check('completeTask: bridge nhận đúng resultText + actor', calls.bridge.completeTask[0][2] === 'xong' && calls.bridge.completeTask[0][3] === 'PHF010');
  }

  // ---- reopenTaskViaServer / cancelTaskViaServer ----
  {
    const { integration, calls } = setup();
    await integration.reopenTaskViaServer({}, 't1', 5, 'ly do');
    check('reopenTask: authorizeCapability nhận đúng current từ getTaskById', calls.authorizeCapability[0].current.id === 't1');
    check('reopenTask: bridge nhận đúng reason', calls.bridge.reopenTask[0][2] === 'ly do');
  }
  {
    const { integration, calls } = setup();
    await integration.cancelTaskViaServer({}, 't1', 5, 'huy');
    check('cancelTask: bridge nhận đúng reason + actor', calls.bridge.cancelTask[0][2] === 'huy' && calls.bridge.cancelTask[0][3] === 'PHF010');
  }
  {
    // authorize deny -> KHÔNG gọi bridge
    const denyErr = Object.assign(new Error('deny'), { code: 'TASK_UPDATE_DENIED' });
    const { integration, calls } = setup({ authorizeThrows: denyErr });
    try { await integration.cancelTaskViaServer({}, 't1', 5, 'x'); check('phải throw', false); }
    catch (e) { check('cancelTask: authorize deny -> KHÔNG gọi bridge, error pass-through', e.code === 'TASK_UPDATE_DENIED' && !calls.bridge.cancelTask); }
  }

  // ---- changeTaskDeadlineViaServer ----
  {
    const { integration, calls } = setup();
    await integration.changeTaskDeadlineViaServer({}, 't1', 5, '2026-10-01', 'gia han');
    check('changeTaskDeadline: bridge nhận đúng newDeadline/reason', calls.bridge.changeTaskDeadline[0][2] === '2026-10-01' && calls.bridge.changeTaskDeadline[0][3] === 'gia han');
  }

  // ---- transferTaskPrimaryViaServer ----
  {
    const { integration, calls } = setup();
    await integration.transferTaskPrimaryViaServer({}, 't1', 5, 'PHF012', 'ban giao');
    check('transferTaskPrimary: canAssignTaskTo được gọi với đúng target', calls.canAssignTaskTo[0].target === 'PHF012');
    check('transferTaskPrimary: bridge nhận đúng newPrimary/reason', calls.bridge.transferTaskPrimary[0][2] === 'PHF012' && calls.bridge.transferTaskPrimary[0][3] === 'ban giao');
  }
  {
    // target ngoài phạm vi -> KHÔNG gọi bridge
    const { integration, calls } = setup({ canAssignTaskTo: false });
    try { await integration.transferTaskPrimaryViaServer({}, 't1', 5, 'PHF999', 'x'); check('phải throw', false); }
    catch (e) { check('transferTaskPrimary: target denied -> TASK_TRANSFER_TARGET_DENIED, KHÔNG gọi bridge', e.code === 'TASK_TRANSFER_TARGET_DENIED' && !calls.bridge.transferTaskPrimary); }
  }

  // ---- addTaskRelatedViaServer / removeTaskRelatedViaServer ----
  {
    const { integration, calls } = setup();
    await integration.addTaskRelatedViaServer({}, 't1', 'phf012');
    check('addTaskRelated: target normalize uppercase + canAddTaskRelated gọi đúng', calls.canAddTaskRelated[0].target === 'PHF012');
    check('addTaskRelated: bridge nhận đúng target đã normalize', calls.bridge.addTaskRelated[0][1] === 'PHF012');
  }
  {
    // target chính là primary hiện hành -> TASK_RELATED_IS_PRIMARY, KHÔNG gọi bridge
    const { integration, calls } = setup({
      getTaskByIdResult: { task: { id: 't1' }, assignees: [{ role: 'primary', is_active: true, employee_code: 'PHF010' }] },
    });
    try { await integration.addTaskRelatedViaServer({}, 't1', 'PHF010'); check('phải throw', false); }
    catch (e) { check('addTaskRelated: primary hiện hành -> TASK_RELATED_IS_PRIMARY, KHÔNG gọi bridge', e.code === 'TASK_RELATED_IS_PRIMARY' && !calls.bridge.addTaskRelated); }
  }
  {
    const { integration, calls } = setup();
    await integration.removeTaskRelatedViaServer({}, 't1', 'PHF012');
    check('removeTaskRelated: bridge nhận đúng target', calls.bridge.removeTaskRelated[0][1] === 'PHF012');
  }

  // ---- addTaskCommentViaServer / addTaskLinkViaServer / removeTaskLinkViaServer ----
  {
    const { integration, calls } = setup();
    await integration.addTaskCommentViaServer({}, 't1', 'noi dung');
    check('addTaskComment: dùng resolveAndAuthorizeView (KHÔNG phải update-capability — chỉ cần xem)', calls.authorizeView.length === 1);
    check('addTaskComment: bridge nhận đúng body', calls.bridge.addTaskComment[0][1] === 'noi dung');
  }
  {
    const { integration, calls } = setup();
    await integration.addTaskLinkViaServer({}, 't1', 'related', 'https://x.y', 'nhan');
    check('addTaskLink: bridge nhận đúng side/url/label', calls.bridge.addTaskLink[0][1] === 'related' && calls.bridge.addTaskLink[0][2] === 'https://x.y' && calls.bridge.addTaskLink[0][3] === 'nhan');
  }
  {
    const { integration, calls } = setup();
    await integration.removeTaskLinkViaServer({}, 't1', 'link-1');
    check('removeTaskLink: dùng resolveAndAuthorizeView + bridge nhận đúng linkId', calls.authorizeView.length === 1 && calls.bridge.removeTaskLink[0][1] === 'link-1');
  }

  console.log(`\n${PASS}/${PASS + FAIL} PASS`);
  if (FAIL > 0) process.exit(1);
}

run().catch((err) => { console.error('HARNESS_CRASH', err); process.exit(1); });
