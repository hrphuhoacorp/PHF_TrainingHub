'use strict';

// Test cho getTaskDetailViaServer() trong api/_lib/task-server-integration.js
// (READ integration, 2026-08-27 — GET single-task detail qua phf_hr, cờ
// RIÊNG PHF_TASK_READ_BRIDGE_GETDETAIL_ENABLED). Mock-only qua require.cache:
// task-core.js (assembleTaskDetailDto, resolveAndAuthorizeView),
// task-employee-scope.js (loadOrgRows), task-read-bridge.js
// (bridgeGetTaskDetail/bridgeListTaskCategories). KHÔNG DB/network thật.

const integrationPath = require.resolve('../api/_lib/task-server-integration');
const taskCorePath = require.resolve('../api/_lib/task-core');
const employeeScopePath = require.resolve('../api/_lib/task-employee-scope');
const permissionsPath = require.resolve('../api/_lib/task-permissions');
const writeBridgePath = require.resolve('../api/_lib/task-write-bridge');
const readBridgePath = require.resolve('../api/_lib/task-read-bridge');

let PASS = 0, FAIL = 0;
function check(name, cond) { if (cond) PASS++; else { FAIL++; console.error('FAIL:', name); } }

function setup(overrides = {}) {
  delete require.cache[integrationPath];
  delete require.cache[taskCorePath];
  delete require.cache[employeeScopePath];
  delete require.cache[permissionsPath];
  delete require.cache[writeBridgePath];
  delete require.cache[readBridgePath];

  const calls = { authorizeView: [], loadOrgRows: 0, bridgeGetTaskDetail: [], bridgeListTaskCategories: 0, assemble: [], viewerAuthority: [], bridgeListTasks: [] };

  require.cache[taskCorePath] = {
    id: taskCorePath, filename: taskCorePath, loaded: true,
    exports: {
      resolveAndAuthorizeView: async (session, current, assignees) => {
        calls.authorizeView.push({ session, current, assignees });
        if (overrides.authorizeViewThrows) throw overrides.authorizeViewThrows;
        return { employeeCode: 'PHF010', accountId: null };
      },
      assembleTaskDetailDto: (task, assignees, comments, links, events, categoryDtoObj, orgRows, viewer) => {
        calls.assemble.push({ task, assignees, comments, links, events, categoryDtoObj, orgRows, viewer });
        return { task, assignees, comments, links, events, category: categoryDtoObj, orgRowsCount: (orgRows || []).length, viewer: viewer || null };
      },
    },
  };
  require.cache[employeeScopePath] = {
    id: employeeScopePath, filename: employeeScopePath, loaded: true,
    exports: { loadOrgRows: async () => { calls.loadOrgRows++; return overrides.orgRows || [{ employeeCode: 'PHF010', fullName: 'A' }]; } },
  };
  require.cache[permissionsPath] = {
    id: permissionsPath, filename: permissionsPath, loaded: true,
    exports: {
      resolveTaskViewerAuthority: async (session, task, assignees) => {
        calls.viewerAuthority.push({ session, task, assignees });
        if (overrides.viewerAuthorityThrows) throw overrides.viewerAuthorityThrows;
        return overrides.viewerAuthority !== undefined ? overrides.viewerAuthority : {
          relation: 'primary', is_creator: false, is_active_primary: true,
          managed_view_only: false, intervention_basis: 'active_primary',
          actions: { view: true, comment: true, update_progress: true, complete: true },
        };
      },
    },
  };
  require.cache[writeBridgePath] = { id: writeBridgePath, filename: writeBridgePath, loaded: true, exports: {} };
  require.cache[readBridgePath] = {
    id: readBridgePath, filename: readBridgePath, loaded: true,
    exports: {
      bridgeGetTaskDetail: async (taskId) => {
        calls.bridgeGetTaskDetail.push(taskId);
        if (overrides.bridgeGetTaskDetailThrows) throw overrides.bridgeGetTaskDetailThrows;
        if (overrides.detailFailTaskIds && overrides.detailFailTaskIds.includes(taskId)) throw new Error('bridge detail failed for ' + taskId);
        if (overrides.detailByTaskId && overrides.detailByTaskId[taskId] !== undefined) return overrides.detailByTaskId[taskId];
        return overrides.detailResult !== undefined ? overrides.detailResult : {
          task: { id: taskId, category_code: 'KHN', row_version: 2 },
          assignees: [{ role: 'primary', is_active: true, employee_code: 'PHF010' }],
          comments: [{ id: 'c1' }],
          links: [{ id: 'l1' }],
          events: [{ id: 'e-' + taskId, task_id: taskId, event_type: 'published', actor_employee_code: 'PHF002', occurred_at: '2026-08-2' + taskId.slice(-1) + 'T00:00:00Z', payload: {}, reason: null }],
        };
      },
      bridgeListTaskCategories: async () => {
        calls.bridgeListTaskCategories++;
        return overrides.categoriesResult || { categories: [{ category_code: 'KHN', display_name: 'Kho Hàng Nhập' }] };
      },
      bridgeListTasks: async (session, params) => {
        calls.bridgeListTasks.push(params);
        return overrides.listTasksResult !== undefined ? overrides.listTasksResult : {
          tasks: [
            { task_id: 'T1', task_code: 'CV-1', title: 'Task 1' },
            { task_id: 'T2', task_code: 'CV-2', title: 'Task 2' },
          ],
          relation: params.relation, scope: params.scope || 'default',
          viewScopeType: 'employees', requesterActorType: 'truong_bo_phan',
        };
      },
    },
  };

  const integration = require(integrationPath);
  return { integration, calls };
}

async function run() {
  // ---- happy path ----
  {
    const { integration, calls } = setup();
    const out = await integration.getTaskDetailViaServer({}, 't1');
    check('getTaskDetailViaServer: bridgeGetTaskDetail gọi đúng taskId', calls.bridgeGetTaskDetail[0] === 't1');
    check('getTaskDetailViaServer: authorize dùng resolveAndAuthorizeView với task/assignees từ bridge', calls.authorizeView.length === 1 && calls.authorizeView[0].current.id === 't1');
    check('getTaskDetailViaServer: category tra ra đúng từ bridgeListTaskCategories theo category_code', calls.assemble[0].categoryDtoObj.category_code === 'KHN');
    check('getTaskDetailViaServer: orgRows từ loadOrgRows được truyền vào assemble', calls.loadOrgRows === 1 && calls.assemble[0].orgRows.length === 1);
    check('getTaskDetailViaServer: trả đúng kết quả assembleTaskDetailDto', out.task.id === 't1' && out.comments[0].id === 'c1');
    check('getTaskDetailViaServer: resolveTaskViewerAuthority gọi với task/assignees từ bridge', calls.viewerAuthority.length === 1 && calls.viewerAuthority[0].task.id === 't1' && calls.viewerAuthority[0].assignees[0].employee_code === 'PHF010');
    check('getTaskDetailViaServer: viewer authority chảy vào assemble + DTO', calls.assemble[0].viewer && calls.assemble[0].viewer.intervention_basis === 'active_primary' && out.viewer.actions.comment === true);
  }

  // ---- task not found (404 từ bridge -> task:null) ----
  {
    const { integration, calls } = setup({ detailResult: { task: null, assignees: [], comments: [], links: [], events: [] } });
    try { await integration.getTaskDetailViaServer({}, 'missing'); check('phải throw', false); }
    catch (e) { check('getTaskDetailViaServer: task null -> TASK_NOT_FOUND, KHÔNG gọi authorize', e.code === 'TASK_NOT_FOUND' && e.statusCode === 404 && calls.authorizeView.length === 0); }
  }

  // ---- view denied -> KHÔNG gọi category/org lookup ----
  {
    const err = Object.assign(new Error('deny'), { code: 'TASK_VIEW_DENIED', statusCode: 403 });
    const { integration, calls } = setup({ authorizeViewThrows: err });
    try { await integration.getTaskDetailViaServer({}, 't1'); check('phải throw', false); }
    catch (e) { check('getTaskDetailViaServer: view denied -> error pass-through, KHÔNG gọi loadOrgRows/categories', e.code === 'TASK_VIEW_DENIED' && calls.loadOrgRows === 0 && calls.bridgeListTaskCategories === 0); }
  }

  // ---- category không tồn tại trong danh sách -> categoryDtoObj null (assembleTaskDetailDto tự fallback) ----
  {
    const { integration, calls } = setup({ categoriesResult: { categories: [] } });
    await integration.getTaskDetailViaServer({}, 't1');
    check('getTaskDetailViaServer: category không tìm thấy -> truyền null cho assemble (fallback nằm trong seam)', calls.assemble[0].categoryDtoObj === null);
  }

  // =========================================================================
  // listTaskEventsViaServer — datastore-consistency fix (2026-08-28).
  // Authorized set AND events both from the bridge (phf_hr), so every Timeline
  // row's task_id resolves through the bridged getTaskDetail.
  // =========================================================================
  {
    const { integration, calls } = setup();
    const out = await integration.listTaskEventsViaServer({}, { relation: 'received', scope: 'managed', limit: 100 });
    check('listTaskEventsViaServer: authorized set via bridgeListTasks (not Supabase)', calls.bridgeListTasks.length === 1 && calls.bridgeListTasks[0].scope === 'managed');
    check('listTaskEventsViaServer: events fetched per-task via bridgeGetTaskDetail', calls.bridgeGetTaskDetail.length === 2 && calls.bridgeGetTaskDetail.includes('T1') && calls.bridgeGetTaskDetail.includes('T2'));
    check('listTaskEventsViaServer: every event task_id is from the bridged task set', out.events.length === 2 && out.events.every(e => ['T1', 'T2'].includes(e.task_id)));
    check('listTaskEventsViaServer: DTO shape parity (task_code/task_title/actor/occurred_at)', out.events[0].task_code === 'CV-2' && out.events[0].task_title === 'Task 2' && out.events[0].actor && typeof out.events[0].occurred_at === 'string');
    check('listTaskEventsViaServer: sorted occurred_at desc', out.events[0].occurred_at >= out.events[1].occurred_at);
    check('listTaskEventsViaServer: passthrough relation/scope/viewScopeType', out.relation === 'received' && out.scope === 'managed' && out.viewScopeType === 'employees');
  }
  {
    const { integration, calls } = setup({ listTasksResult: { tasks: [], relation: 'received', scope: 'default', viewScopeType: 'self', requesterActorType: 'nhan_vien' } });
    const out = await integration.listTaskEventsViaServer({}, { relation: 'received', limit: 50 });
    check('listTaskEventsViaServer: empty authorized set -> no per-task fetch, empty events', out.events.length === 0 && calls.bridgeGetTaskDetail.length === 0);
  }
  {
    // one task's detail fetch fails -> that task contributes 0 events, others unaffected
    const { integration } = setup({ detailFailTaskIds: ['T1'] });
    const out = await integration.listTaskEventsViaServer({}, { relation: 'received', scope: 'managed', limit: 100 });
    check('listTaskEventsViaServer: per-task fetch failure is contained (T2 still present, no throw)', out.events.length === 1 && out.events[0].task_id === 'T2');
  }
  {
    const { integration } = setup();
    const out = await integration.listTaskEventsViaServer({}, { relation: 'received', scope: 'managed', limit: 1 });
    check('listTaskEventsViaServer: honours limit', out.events.length === 1);
  }

  console.log(`\n${PASS}/${PASS + FAIL} PASS`);
  if (FAIL > 0) process.exit(1);
}

run().catch((err) => { console.error('HARNESS_CRASH', err); process.exit(1); });
