'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const surfaces = [
  { name: 'server.js', file: path.join(root, 'server.js') },
  { name: 'api/data.js', file: path.join(root, 'api', 'data.js') }
];
// TEST DRIFT FIX (Phase 1.5 mục 6): expectedActions trước đây chỉ liệt kê 15
// action lifecycle gốc (Batch 2). Từ đó runtime đã wire thêm 10 action
// permission/category/people (listTaskAssignableEmployees...setTaskCategoryActive)
// vào TASK_ACTION_MANIFEST của cả api/data.js và server.js, nhưng test chưa
// cập nhật theo — test tự fail vì lệch với chính runtime đã parity thật giữa
// 2 file, KHÔNG phải vì runtime bị lệch nhau. Cập nhật danh sách này khớp
// đúng TASK_ACTION_MANIFEST hiện tại (xem api/data.js dòng /* TASK_API_WIRING_START */).
// TEST DRIFT FIX (Category + Create Task Foundation): thêm deleteTaskCategory
// và reorderTaskCategory — 2 action mới cho Cài đặt (xóa danh mục chưa dùng,
// sắp xếp thứ tự), wire local, chưa gọi write thật (RPC/cột phụ thuộc CHƯA
// apply Production).
// TEST DRIFT FIX (2026-08-29, Task release prep): thêm 5 action Proposal V2
// (listProposalRecipientEmployees/createTaskProposal/acceptTaskProposal/
// rejectTaskProposal/cancelTaskProposal — PostgreSQL-only, LOCKED Phương án A)
// + 6 action Overview/Report V2 (getTaskOverviewV2/listTaskOverviewV2Drilldown/
// getTaskReportV2{Person,Department,Category}Analysis/getTaskReportV2Trend).
// Cả api/data.js và server.js đều đã wire đủ — cập nhật golden list cho khớp
// runtime hiện tại (parity thật giữa 2 file), KHÔNG hạ assertion.
const expectedActions = [
  'listTaskAssignableEmployees', 'listTaskAdminPeople', 'saveTaskPermissionAssignment',
  'createTaskPermissionGrant', 'revokeTaskPermissionGrant',
  'listTaskCategories', 'listAdminTaskCategories',
  'createTaskCategory', 'renameTaskCategory', 'setTaskCategoryActive',
  'deleteTaskCategory', 'reorderTaskCategory', 'checkTaskFoundationStatus',
  'createTaskDraft', 'updateTaskDraft', 'deleteTaskDraft', 'publishTask', 'getTaskDetail',
  'listProposalRecipientEmployees', 'createTaskProposal', 'acceptTaskProposal', 'rejectTaskProposal', 'cancelTaskProposal',
  'updateTaskProgress', 'completeTask', 'reopenTask', 'cancelTask',
  'changeTaskDeadline', 'transferTaskPrimary', 'addTaskRelated',
  'removeTaskRelated', 'addTaskComment', 'addTaskLink', 'removeTaskLink',
  'listMyTaskNotifications', 'markTaskNotificationRead', 'markAllTaskNotificationsRead',
  'listTasks', 'listTaskEvents',
  'getTaskReportSummary', 'getTaskReportCategoryAnalysis', 'getTaskReportPersonAnalysis', 'getTaskReportTrend', 'listTaskReportDrilldown',
  'getTaskOverviewV2', 'getTaskReportV2Bundle', 'listTaskOverviewV2Drilldown',
  'getTaskReportV2PersonAnalysis', 'getTaskReportV2DepartmentAnalysis', 'getTaskReportV2CategoryAnalysis', 'getTaskReportV2Trend',
  // RECURRENCE V1 (2026-08-31) — Company-PostgreSQL-only recurrence rules
  // ("Công việc lặp" + "Lịch lặp"). Impl: api/_lib/task-recurrence-actions.js.
  'createTaskRecurrence', 'updateTaskRecurrence', 'pauseTaskRecurrence', 'resumeTaskRecurrence', 'stopTaskRecurrence', 'listTaskRecurrence', 'runTaskRecurrence',
  // CANCEL POLICY V1 (2026-08-31) — PostgreSQL-only "Yêu cầu hủy" flow.
  // Impl: api/_lib/task-server-integration.js (…ViaServer).
  'requestTaskCancel', 'approveTaskCancelRequest', 'rejectTaskCancelRequest', 'withdrawTaskCancelRequest'
];
const actorFields = ['actor_employee_code', 'actor_role', 'actor_scope', 'is_admin', 'permission_flags'];
let passed = 0;

function pass(condition, message) {
  assert.ok(condition, message);
  passed += 1;
}

function wiringBlock(source) {
  const match = source.match(/\/\* TASK_API_WIRING_START \*\/([\s\S]*?)\/\* TASK_API_WIRING_END \*\//);
  assert.ok(match, 'Missing TASK API wiring markers');
  return match[1];
}

function createHarness(source) {
  const calls = [];
  const context = {};
  for (const action of expectedActions) {
    context[action] = async (...args) => {
      calls.push({ action, args });
      if (context.failAction === action) throw context.failError;
      return { action, accepted: true };
    };
  }
  vm.createContext(context);
  vm.runInContext(wiringBlock(source) + '\nthis.dispatch = dispatchTaskAction; this.manifest = Array.from(TASK_ACTION_MANIFEST);', context);
  return { calls, dispatch: context.dispatch, manifest: context.manifest, context };
}

const sourceBySurface = new Map(surfaces.map(surface => [surface.name, fs.readFileSync(surface.file, 'utf8')]));
const harnesses = new Map();
for (const surface of surfaces) {
  const source = sourceBySurface.get(surface.name);
  const harness = createHarness(source);
  harnesses.set(surface.name, harness);
  pass(JSON.stringify(harness.manifest) === JSON.stringify(expectedActions), surface.name + ' action manifest mismatch');
  pass(!actorFields.some(field => wiringBlock(source).includes(field)), surface.name + ' trusts client actor authority');
  pass(!wiringBlock(source).includes('...payload'), surface.name + ' forwards raw payload with object spread');
  const callIndex = source.lastIndexOf('const taskDispatch = await dispatchTaskAction(session, payload);');
  const fallbackIndex = source.indexOf('authorizePayload(session, payload)', callIndex);
  pass(callIndex > source.indexOf('TASK_API_WIRING_END') && fallbackIndex > callIndex, surface.name + ' Task dispatch must run before legacy data fallback');
}
pass(JSON.stringify(harnesses.get('server.js').manifest) === JSON.stringify(harnesses.get('api/data.js').manifest), 'Task action parity mismatch');

const session = Object.freeze({ sub: 'session-user', employeeCode: 'NV001', role: 'manager' });
const payloads = {
  listTaskAssignableEmployees: {},
  listTaskAdminPeople: {},
  saveTaskPermissionAssignment: { employee_code:'NV002', preset_code:'TRUONG_BO_PHAN', reason:'Gán preset' },
  createTaskPermissionGrant: { grantee_employee_code:'NV002', grant_type:'extend', people_scope:{ type:'employees', values:['NV003'] }, capabilities:{}, reason:'Mở rộng scope' },
  revokeTaskPermissionGrant: { grant_id:'grant-1', reason:'Thu hồi' },
  listTaskCategories: {},
  listAdminTaskCategories: {},
  createTaskCategory: { category_code:'CAT3', display_name:'Danh mục 3' },
  renameTaskCategory: { category_code:'CAT3', display_name:'Danh mục đổi tên' },
  setTaskCategoryActive: { category_code:'CAT3', is_active:false },
  deleteTaskCategory: { category_code:'CAT3' },
  reorderTaskCategory: { category_code:'CAT3', sort_order:2 },
  checkTaskFoundationStatus: {},
  createTaskDraft: { flow_type:'giao_viec', title:'T', content:'C', category_code:'CAT', priority:'thuong', start_at:'2026-08-20', deadline:'2026-08-21', primary_employee_code:'NV002' },
  updateTaskDraft: { task_id:'task-1', expected_row_version:7, title:'T2', content:'C2', category_code:'CAT2', priority:'khan_cap', start_at:null, deadline:'2026-08-22' },
  deleteTaskDraft: { task_id:'task-1', expected_row_version:7 },
  publishTask: { task_id:'task-1', expected_row_version:7 },
  getTaskDetail: { task_id:'task-1' },
  listProposalRecipientEmployees: {},
  createTaskProposal: { title:'Đề xuất', content:'Nội dung', category_code:'CAT1', priority:'thuong', start_at:'2026-08-20', deadline:'2026-08-25', recipient_employee_code:'NV002' },
  acceptTaskProposal: { proposal_task_id:'prop-1', title:'T', content:'C', category_code:'CAT2', priority:'quan_trong', start_at:null, deadline:'2026-08-26', primary_employee_code:'NV003' },
  rejectTaskProposal: { proposal_task_id:'prop-1', reason:'Không phù hợp' },
  cancelTaskProposal: { proposal_task_id:'prop-1', reason:'Rút đề xuất' },
  updateTaskProgress: { task_id:'task-1', expected_row_version:7, progress_percent:50, progress_status:'Đang thực hiện' },
  completeTask: { task_id:'task-1', expected_row_version:7, result_text:'Done' },
  reopenTask: { task_id:'task-1', expected_row_version:7, reason:'Reopen' },
  cancelTask: { task_id:'task-1', expected_row_version:7, reason:'Cancel' },
  changeTaskDeadline: { task_id:'task-1', expected_row_version:7, new_deadline:'2026-08-25', reason:'Plan' },
  transferTaskPrimary: { task_id:'task-1', expected_row_version:7, new_primary_employee_code:'NV003', reason:'Transfer' },
  addTaskRelated: { task_id:'task-1', target_employee_code:'NV004' },
  removeTaskRelated: { task_id:'task-1', target_employee_code:'NV004' },
  addTaskComment: { task_id:'task-1', body:'Comment' },
  addTaskLink: { task_id:'task-1', side:'input_reference', url:'https://example.com', label:'Ref' },
  removeTaskLink: { task_id:'task-1', link_id:'link-1' },
  listMyTaskNotifications: { limit: 20 },
  markTaskNotificationRead: { id:'notif-1', ids:null },
  markAllTaskNotificationsRead: {},
  listTasks: { relation:'received', status_filter:'in_progress', scope:'managed', search:'CV-2608', limit:20, offset:40 },
  listTaskEvents: { relation:'received', scope:'managed', limit:50 },
  getTaskReportSummary: { relation:'received', scope:'managed', period:{type:'month',anchor_date:'2026-08-25'}, category_code:'CAT1' },
  getTaskReportCategoryAnalysis: { relation:'received', scope:'managed', period:{type:'month',anchor_date:'2026-08-25'}, category_code:'CAT1' },
  getTaskReportPersonAnalysis: { relation:'received', scope:'managed', period:{type:'month',anchor_date:'2026-08-25'}, category_code:'CAT1' },
  getTaskReportTrend: { relation:'received', scope:'managed', period:{type:'month',anchor_date:'2026-08-25'}, category_code:'CAT1' },
  listTaskReportDrilldown: { relation:'received', scope:'managed', period:{type:'month',anchor_date:'2026-08-25'}, category_code:'CAT1', metric_id:'currently_overdue', employee_code:'NV002', limit:20, offset:0 },
  getTaskOverviewV2: { period:{type:'month',anchor_date:'2026-08-25'} },
  getTaskReportV2Bundle: { period:{type:'month',anchor_date:'2026-08-25'}, sections:['overview','trend','department'] },
  listTaskOverviewV2Drilldown: { period:{type:'month',anchor_date:'2026-08-25'}, metric_id:'currently_overdue', employee_code:'NV002', department:'Kinh doanh', category_code:'CAT1', limit:20, offset:0 },
  getTaskReportV2PersonAnalysis: { period:{type:'month',anchor_date:'2026-08-25'} },
  getTaskReportV2DepartmentAnalysis: { period:{type:'month',anchor_date:'2026-08-25'} },
  getTaskReportV2CategoryAnalysis: { period:{type:'month',anchor_date:'2026-08-25'} },
  getTaskReportV2Trend: { period:{type:'month',anchor_date:'2026-08-25'} },
  createTaskRecurrence: { title:'CV lặp tuần', content:'Nội dung', category_code:'CAT1', priority:'thuong', primary_employee_code:'NV002', frequency:'weekly', weekday:'T2', start_date:'2026-09-07', start_time:'08:00', duration_days:1 },
  updateTaskRecurrence: { rule_id:'rule-1', title:'CV lặp tuần', content:'Nội dung', category_code:'CAT1', priority:'thuong', primary_employee_code:'NV002', frequency:'weekly', weekday:'T2', start_date:'2026-09-07', start_time:'08:00', duration_days:1 },
  pauseTaskRecurrence: { rule_id:'rule-1', reason:'Tạm dừng' },
  resumeTaskRecurrence: { rule_id:'rule-1', reason:'Chạy lại' },
  stopTaskRecurrence: { rule_id:'rule-1', reason:'Kết thúc' },
  listTaskRecurrence: { status:'active' },
  runTaskRecurrence: { rule_id:'rule-1' },
  requestTaskCancel: { task_id:'task-1', reason:'Xin hủy vì trùng việc' },
  approveTaskCancelRequest: { task_id:'task-1', expected_row_version:7, note:'Đồng ý hủy' },
  rejectTaskCancelRequest: { task_id:'task-1', note:'Chưa đủ cơ sở' },
  withdrawTaskCancelRequest: { task_id:'task-1', note:'Tự rút lại' }
};
const expectedCoreArgs = {
  listTaskAssignableEmployees: [],
  listTaskAdminPeople: [],
  saveTaskPermissionAssignment: [{ employeeCode:'NV002', presetCode:'TRUONG_BO_PHAN', reason:'Gán preset' }],
  createTaskPermissionGrant: [{ granteeEmployeeCode:'NV002', grantType:'extend', peopleScope:{ type:'employees', values:['NV003'] }, capabilities:{}, reason:'Mở rộng scope' }],
  revokeTaskPermissionGrant: ['grant-1', 'Thu hồi'],
  listTaskCategories: [],
  listAdminTaskCategories: [],
  createTaskCategory: [{ categoryCode:'CAT3', displayName:'Danh mục 3' }],
  renameTaskCategory: ['CAT3', 'Danh mục đổi tên'],
  setTaskCategoryActive: ['CAT3', false],
  deleteTaskCategory: ['CAT3'],
  reorderTaskCategory: ['CAT3', 2],
  checkTaskFoundationStatus: [],
  createTaskDraft: [{ flowType:'giao_viec', title:'T', content:'C', categoryCode:'CAT', priority:'thuong', startAt:'2026-08-20', deadline:'2026-08-21', primaryEmployeeCode:'NV002' }],
  updateTaskDraft: ['task-1', 7, { title:'T2', content:'C2', categoryCode:'CAT2', priority:'khan_cap', startAt:null, deadline:'2026-08-22' }],
  deleteTaskDraft: ['task-1', 7],
  publishTask: ['task-1', 7],
  getTaskDetail: ['task-1'],
  listProposalRecipientEmployees: [],
  createTaskProposal: [{ title:'Đề xuất', content:'Nội dung', categoryCode:'CAT1', priority:'thuong', startAt:'2026-08-20', deadline:'2026-08-25', recipientEmployeeCode:'NV002' }],
  acceptTaskProposal: ['prop-1', { title:'T', content:'C', categoryCode:'CAT2', priority:'quan_trong', startAt:null, deadline:'2026-08-26', primaryEmployeeCode:'NV003' }],
  rejectTaskProposal: ['prop-1', 'Không phù hợp'],
  cancelTaskProposal: ['prop-1', 'Rút đề xuất'],
  updateTaskProgress: ['task-1', 7, 50, 'Đang thực hiện'],
  completeTask: ['task-1', 7, 'Done'],
  reopenTask: ['task-1', 7, 'Reopen'],
  cancelTask: ['task-1', 7, 'Cancel'],
  changeTaskDeadline: ['task-1', 7, '2026-08-25', 'Plan'],
  transferTaskPrimary: ['task-1', 7, 'NV003', 'Transfer'],
  addTaskRelated: ['task-1', 'NV004'],
  removeTaskRelated: ['task-1', 'NV004'],
  addTaskComment: ['task-1', 'Comment'],
  addTaskLink: ['task-1', 'input_reference', 'https://example.com', 'Ref'],
  removeTaskLink: ['task-1', 'link-1'],
  listMyTaskNotifications: [{ limit: 20 }],
  markTaskNotificationRead: [{ id:'notif-1', ids:null }],
  markAllTaskNotificationsRead: [],
  listTasks: [{ relation:'received', statusFilter:'in_progress', scope:'managed', search:'CV-2608', limit:20, offset:40 }],
  listTaskEvents: [{ relation:'received', scope:'managed', limit:50 }],
  getTaskReportSummary: [{ relation:'received', scope:'managed', period:{type:'month',anchor_date:'2026-08-25'}, category_code:'CAT1' }],
  getTaskReportCategoryAnalysis: [{ relation:'received', scope:'managed', period:{type:'month',anchor_date:'2026-08-25'}, category_code:'CAT1' }],
  getTaskReportPersonAnalysis: [{ relation:'received', scope:'managed', period:{type:'month',anchor_date:'2026-08-25'}, category_code:'CAT1' }],
  getTaskReportTrend: [{ relation:'received', scope:'managed', period:{type:'month',anchor_date:'2026-08-25'}, category_code:'CAT1' }],
  listTaskReportDrilldown: [{ relation:'received', scope:'managed', period:{type:'month',anchor_date:'2026-08-25'}, category_code:'CAT1', metric_id:'currently_overdue', employee_code:'NV002', limit:20, offset:0 }],
  getTaskOverviewV2: [{ period:{type:'month',anchor_date:'2026-08-25'} }],
  getTaskReportV2Bundle: [{ period:{type:'month',anchor_date:'2026-08-25'}, sections:['overview','trend','department'] }],
  listTaskOverviewV2Drilldown: [{ period:{type:'month',anchor_date:'2026-08-25'}, metric_id:'currently_overdue', employee_code:'NV002', department:'Kinh doanh', category_code:'CAT1', limit:20, offset:0 }],
  getTaskReportV2PersonAnalysis: [{ period:{type:'month',anchor_date:'2026-08-25'} }],
  getTaskReportV2DepartmentAnalysis: [{ period:{type:'month',anchor_date:'2026-08-25'} }],
  getTaskReportV2CategoryAnalysis: [{ period:{type:'month',anchor_date:'2026-08-25'} }],
  getTaskReportV2Trend: [{ period:{type:'month',anchor_date:'2026-08-25'} }],
  createTaskRecurrence: [{ title:'CV lặp tuần', content:'Nội dung', categoryCode:'CAT1', priority:'thuong', primaryEmployeeCode:'NV002', frequency:'weekly', weekday:'T2', startDate:'2026-09-07', startTime:'08:00', durationDays:1 }],
  updateTaskRecurrence: ['rule-1', { title:'CV lặp tuần', content:'Nội dung', categoryCode:'CAT1', priority:'thuong', primaryEmployeeCode:'NV002', frequency:'weekly', weekday:'T2', startDate:'2026-09-07', startTime:'08:00', durationDays:1 }],
  pauseTaskRecurrence: ['rule-1', 'Tạm dừng'],
  resumeTaskRecurrence: ['rule-1', 'Chạy lại'],
  stopTaskRecurrence: ['rule-1', 'Kết thúc'],
  listTaskRecurrence: [{ status:'active' }],
  runTaskRecurrence: [{ ruleId:'rule-1' }],
  requestTaskCancel: ['task-1', 'Xin hủy vì trùng việc'],
  approveTaskCancelRequest: ['task-1', { expectedRowVersion:7, note:'Đồng ý hủy' }],
  rejectTaskCancelRequest: ['task-1', { note:'Chưa đủ cơ sở' }],
  withdrawTaskCancelRequest: ['task-1', { note:'Tự rút lại' }]
};

(async () => {
  for (const surface of surfaces) {
    const harness = harnesses.get(surface.name);
    for (const action of expectedActions) {
      const before = harness.calls.length;
      const payload = {
        action,
        ...payloads[action],
        actor_employee_code:'ATTACKER', actor_role:'admin', actor_scope:'all', is_admin:true, permission_flags:['all'],
        raw_db_row:{status:'completed'}
      };
      const response = await harness.dispatch(session, payload);
      pass(response.handled === true, surface.name + ' did not handle ' + action);
      const call = harness.calls[before];
      assert.strictEqual(call.action, action, surface.name + ' mapped wrong core function for ' + action);
      assert.strictEqual(call.args[0], session, surface.name + ' did not forward authenticated session for ' + action);
      pass(
        JSON.stringify(call.args.slice(1)) === JSON.stringify(expectedCoreArgs[action]),
        surface.name + ' forwarded wrong payload fields for ' + action
      );
    }
  }

  const serverHarness = harnesses.get('server.js');
  const createCall = serverHarness.calls.find(call => call.action === 'createTaskDraft');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(createCall.args[1])), {
    flowType:'giao_viec', title:'T', content:'C', categoryCode:'CAT', priority:'thuong',
    startAt:'2026-08-20', deadline:'2026-08-21', primaryEmployeeCode:'NV002'
  });
  pass(true, 'createTaskDraft payload whitelist');
  const updateCall = serverHarness.calls.find(call => call.action === 'updateTaskDraft');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(updateCall.args[3])), {
    title:'T2', content:'C2', categoryCode:'CAT2', priority:'khan_cap', startAt:null, deadline:'2026-08-22'
  });
  pass(true, 'updateTaskDraft payload whitelist');

  for (const surface of surfaces) {
    const harness = harnesses.get(surface.name);
    const before = harness.calls.length;
    await assert.rejects(
      () => harness.dispatch(session, { action:'deleteTaskDatabase', actor_role:'admin' }),
      error => error && error.code === 'TASK_ACTION_INVALID' && error.statusCode === 400
    );
    pass(harness.calls.length === before, surface.name + ' unknown Task action reached core');
    const unrelated = await harness.dispatch(session, { action:'saveChecklistTemplate' });
    pass(unrelated.handled === false, surface.name + ' intercepted unrelated action');
    const coreError = Object.assign(new Error('Version conflict'), { statusCode:409, code:'TASK_VERSION_CONFLICT' });
    harness.context.failAction = 'publishTask';
    harness.context.failError = coreError;
    await assert.rejects(
      () => harness.dispatch(session, { action:'publishTask', task_id:'task-1', expected_row_version:7 }),
      error => error === coreError
    );
    harness.context.failAction = '';
    harness.context.failError = null;
    pass(true, surface.name + ' swallowed Task Core business error');
  }

  const coreSource = fs.readFileSync(path.join(root, 'api', '_lib', 'task-core.js'), 'utf8');
  // Notification actions live in api/_lib/task-notifications.js (dedicated
  // module, mirrors api/_lib/knl-notifications.js domain-isolation
  // convention) — NOT task-core.js. Report actions live in
  // api/_lib/task-reporting.js (Report-03, same domain-isolation
  // convention). Check the union of all real implementation files, not a
  // single hardcoded path.
  const notificationsSource = fs.readFileSync(path.join(root, 'api', '_lib', 'task-notifications.js'), 'utf8');
  const reportingSource = fs.readFileSync(path.join(root, 'api', '_lib', 'task-reporting.js'), 'utf8');
  // Proposal V2 (task-server-integration.js, PostgreSQL-only) + Overview/Report
  // V2 (task-reporting-v2.js) actions live in their own modules — same
  // domain-isolation convention. Include them in the union so the export
  // check stays real as the surface grows.
  const serverIntegrationSource = fs.readFileSync(path.join(root, 'api', '_lib', 'task-server-integration.js'), 'utf8');
  const reportingV2Source = fs.readFileSync(path.join(root, 'api', '_lib', 'task-reporting-v2.js'), 'utf8');
  // RECURRENCE V1 (2026-08-31) — recurrence actions live in their own module
  // (same domain-isolation convention). Include it in the union.
  const recurrenceActionsSource = fs.readFileSync(path.join(root, 'api', '_lib', 'task-recurrence-actions.js'), 'utf8');
  const implementationSource = coreSource + '\n' + notificationsSource + '\n' + reportingSource + '\n' + serverIntegrationSource + '\n' + reportingV2Source + '\n' + recurrenceActionsSource;
  // Một số action wire qua seam ...ViaServer()/...Legacy() (Proposal V2,
  // read-bridge dual-path) — implementation identifier là <action>ViaServer,
  // không phải bare <action>. Chấp nhận cả 2 dạng.
  for (const action of expectedActions) pass(new RegExp('\\b' + action + '(ViaServer|Legacy)?\\b').test(implementationSource), 'Task Core/Notifications export missing ' + action);
  console.log('PHF Task API parity: ' + passed + '/' + passed + ' PASS');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
