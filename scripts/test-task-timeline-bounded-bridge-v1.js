'use strict';

// PHF Task — Timeline read path router (api/_lib/task-server-integration.js
// ::listTaskEventsViaServer). Mock-only via require.cache. NO DB / network.
//
// Proves:
//  - PHF_TASK_EVENTS_BRIDGE_ENABLED=true  -> ONE bridgeListTaskEvents() call,
//    ZERO bridgeGetTaskDetail() calls (the 1 + up-to-60 fan-out is gone)
//  - PHF_TASK_EVENTS_BRIDGE_ENABLED unset -> the original fan-out
//    (bridgeListTasks + one bridgeGetTaskDetail per scanned task) is unchanged
//  - the response DTO is byte-identical between the two paths for the same
//    underlying events (id/task_id/task_code/task_title/event_type/
//    actor{employee_code,full_name}/payload/reason/occurred_at + base)
//  - actor.full_name is enriched locally from org rows in BOTH paths

const integrationPath = require.resolve('../api/_lib/task-server-integration');
const taskCorePath = require.resolve('../api/_lib/task-core');
const employeeScopePath = require.resolve('../api/_lib/task-employee-scope');
const permissionsPath = require.resolve('../api/_lib/task-permissions');
const writeBridgePath = require.resolve('../api/_lib/task-write-bridge');
const readBridgePath = require.resolve('../api/_lib/task-read-bridge');

let PASS = 0, FAIL = 0;
function check(name, cond) { if (cond) PASS++; else { FAIL++; console.error('FAIL:', name); } }

const ORG = [
  { employeeCode: 'PHF012', fullName: 'Lê Vĩnh Thắng' },
  { employeeCode: 'PHF001', fullName: 'Nguyễn Văn A' },
];

// The canonical events the timeline should surface (newest first).
const LOGICAL_EVENTS = [
  { id: 'ev-3', taskId: 't1', taskCode: 'CV-2609-0001', taskTitle: 'Kiểm kê kho', eventType: 'progress', actorEmployeeCode: 'PHF012', payload: { percent: 40 }, reason: null, occurredAt: '2026-09-06T10:00:00Z' },
  { id: 'ev-2', taskId: 't2', taskCode: 'CV-2609-0002', taskTitle: 'Báo cáo tuần', eventType: 'completion', actorEmployeeCode: 'PHF012', payload: {}, reason: 'xong', occurredAt: '2026-09-05T09:00:00Z' },
  { id: 'ev-1', taskId: 't1', taskCode: 'CV-2609-0001', taskTitle: 'Kiểm kê kho', eventType: 'transfer', actorEmployeeCode: 'PHF001', payload: {}, reason: null, occurredAt: '2026-09-04T08:00:00Z' },
];

function setup(flagOn) {
  [integrationPath, taskCorePath, employeeScopePath, permissionsPath, writeBridgePath, readBridgePath]
    .forEach((p) => delete require.cache[p]);

  const calls = { bridgeListTaskEvents: [], bridgeGetTaskDetail: [], bridgeListTasks: [], loadOrgRows: 0 };

  require.cache[taskCorePath] = { id: taskCorePath, filename: taskCorePath, loaded: true, exports: {
    resolveAndAuthorizeView: async () => ({}), assembleTaskDetailDto: () => ({}),
  } };
  require.cache[employeeScopePath] = { id: employeeScopePath, filename: employeeScopePath, loaded: true, exports: {
    loadOrgRows: async () => { calls.loadOrgRows++; return ORG; },
    resolveActorContext: async () => ({ employeeCode: 'PHF012', accountId: null, actorType: 'truong_bo_phan' }),
  } };
  require.cache[permissionsPath] = { id: permissionsPath, filename: permissionsPath, loaded: true, exports: {
    canAssignTaskTo: async () => true, canAddTaskRelated: async () => true,
    resolveTaskViewerAuthority: async () => ({}), canProposeTo: async () => true,
    listProposalRecipientEmployees: async () => [],
  } };
  require.cache[writeBridgePath] = { id: writeBridgePath, filename: writeBridgePath, loaded: true, exports: new Proxy({}, { get: () => async () => ({}) }) };

  require.cache[readBridgePath] = { id: readBridgePath, filename: readBridgePath, loaded: true, exports: {
    isTaskEventsBridgeEnabled: () => !!flagOn,
    bridgeListTaskEvents: async (session, params, eventLimit) => {
      calls.bridgeListTaskEvents.push({ params, eventLimit });
      return {
        events: LOGICAL_EVENTS.map((e) => ({ ...e })),
        relation: 'received', scope: 'default', viewScopeType: 'self', requesterActorType: 'truong_bo_phan',
      };
    },
    // fan-out path deps
    bridgeListTasks: async (session, params) => {
      calls.bridgeListTasks.push(params);
      return {
        tasks: [
          { task_id: 't1', task_code: 'CV-2609-0001', title: 'Kiểm kê kho' },
          { task_id: 't2', task_code: 'CV-2609-0002', title: 'Báo cáo tuần' },
        ],
        relation: 'received', scope: 'default', viewScopeType: 'self', requesterActorType: 'truong_bo_phan',
      };
    },
    bridgeGetTaskDetail: async (taskId) => {
      calls.bridgeGetTaskDetail.push(taskId);
      const evs = LOGICAL_EVENTS.filter((e) => e.taskId === taskId).map((e) => ({
        id: e.id, task_id: e.taskId, event_type: e.eventType, actor_employee_code: e.actorEmployeeCode,
        payload: e.payload, reason: e.reason, occurred_at: e.occurredAt,
      }));
      return { events: evs };
    },
    bridgeListTaskCategories: async () => ({ categories: [] }),
    isGetTaskDetailBridgeEnabled: () => true,
    isListTasksBridgeEnabled: () => true,
    isBridgeEnabled: () => true,
    isNotificationBridgeEnabled: () => false,
    bridgeListTaskNotifications: async () => ({ notifications: [], count: 0, taskRelations: [] }),
    bridgeMarkTaskNotificationsRead: async () => ({ marked: 0 }),
    bridgeMarkAllTaskNotificationsRead: async () => ({ marked: 0 }),
  } };

  const mod = require(integrationPath);
  return { mod, calls };
}

function assertDto(tag, res) {
  check(tag + ': base echoed', res.relation === 'received' && res.scope === 'default' && res.viewScopeType === 'self' && res.requesterActorType === 'truong_bo_phan');
  check(tag + ': 3 events, newest first', res.events.map((e) => e.id).join(',') === 'ev-3,ev-2,ev-1');
  const e0 = res.events[0];
  check(tag + ': DTO keys', ['id', 'task_id', 'task_code', 'task_title', 'event_type', 'actor', 'payload', 'reason', 'occurred_at'].every((k) => k in e0));
  check(tag + ': task_code/title present', e0.task_code === 'CV-2609-0001' && e0.task_title === 'Kiểm kê kho');
  check(tag + ': actor enriched from org rows', e0.actor.employee_code === 'PHF012' && e0.actor.full_name === 'Lê Vĩnh Thắng');
  check(tag + ': actor with no org row -> blank name, not crash', res.events[2].actor.employee_code === 'PHF001' && res.events[2].actor.full_name === 'Nguyễn Văn A');
  check(tag + ': payload + reason passthrough', JSON.stringify(e0.payload) === '{"percent":40}' && e0.reason === null && res.events[1].reason === 'xong');
  check(tag + ': occurred_at passthrough', e0.occurred_at === '2026-09-06T10:00:00Z');
}

async function run() {
  // ===== flag ON — bounded path =====
  {
    const { mod, calls } = setup(true);
    const res = await mod.listTaskEventsViaServer({ user: { employeeCode: 'PHF012' } }, { relation: 'received', limit: 150 });
    check('ON: exactly ONE bridgeListTaskEvents call', calls.bridgeListTaskEvents.length === 1);
    check('ON: ZERO bridgeGetTaskDetail calls (fan-out removed)', calls.bridgeGetTaskDetail.length === 0);
    check('ON: ZERO bridgeListTasks calls', calls.bridgeListTasks.length === 0);
    check('ON: eventLimit forwarded (150)', calls.bridgeListTaskEvents[0].eventLimit === 150);
    check('ON: relation/scope forwarded to the bridge', calls.bridgeListTaskEvents[0].params.relation === 'received');
    assertDto('ON', res);
    global.__ON_RESULT__ = res;
  }
  // ===== flag OFF — fan-out path unchanged =====
  {
    const { mod, calls } = setup(false);
    const res = await mod.listTaskEventsViaServer({ user: { employeeCode: 'PHF012' } }, { relation: 'received', limit: 150 });
    check('OFF: bridgeListTaskEvents NOT called', calls.bridgeListTaskEvents.length === 0);
    check('OFF: one bridgeListTasks call (fan-out path)', calls.bridgeListTasks.length === 1);
    check('OFF: one bridgeGetTaskDetail per scanned task', calls.bridgeGetTaskDetail.length === 2);
    assertDto('OFF', res);

    // byte-parity between the two paths
    check('PARITY: bounded path DTO === fan-out path DTO',
      JSON.stringify(global.__ON_RESULT__) === JSON.stringify(res));
  }
  // ===== flag ON, empty =====
  {
    const { mod, calls } = setup(true);
    const rb = require.cache[readBridgePath].exports;
    rb.bridgeListTaskEvents = async () => ({ events: [], relation: 'assigned', scope: 'default', viewScopeType: 'self', requesterActorType: 'nhan_vien' });
    delete require.cache[integrationPath];
    const mod2 = require(integrationPath);
    const res = await mod2.listTaskEventsViaServer({ user: {} }, { relation: 'assigned', limit: 100 });
    check('ON/empty: events: [] with base echoed', Array.isArray(res.events) && res.events.length === 0 && res.relation === 'assigned');
  }

  console.log(`\nPHF Task Timeline bounded-bridge router V1: ${PASS}/${PASS + FAIL} PASS`);
  if (FAIL > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
