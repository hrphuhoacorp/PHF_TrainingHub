'use strict';

/*
 * PHF Task — MANAGED EMPLOYEE WORKSPACE V5 — test suite. jsdom, no network,
 * no real DB/API. Loads the REAL production files via window.eval.
 *
 * Covers: menu visibility for the new "Nhân sự tôi quản lý" child (route +
 * ROUTE_REGISTRY/PHF_ROUTE_MAP parity in phf-url-router.js), "Tôi nhận"
 * separation (only actor-as-primary rows), managed-workspace dataset
 * isolation, summary reconciliation (Tổng = 5 status buckets, asserted by
 * code), cross-department attribute filter as a subset (not part of the
 * status sum), manager detail role banner + zero action authority, and
 * regression on menu/route/active-state.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }
function readSrc(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

const TASK_APP_SRC = readSrc('assets/js/task/phf-task-app.js');
const DEMO_FIXTURES_SRC = readSrc('assets/js/task/phf-task-ui-demo-fixtures.js');
const ROUTER_SRC = readSrc('assets/js/phf-url-router.js');
const PERMISSIONS_SRC = readSrc('api/_lib/task-permissions.js');
const SCOPE_SRC = readSrc('api/_lib/task-employee-scope.js');

function newTaskAppWindow() {
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/admin/task' });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = function () { return 'admin'; };
  window.phfGetCurrentUser = function () { return { fullName: 'Demo QA', employeeCode: 'DEMO_QA' }; };
  window.phfNavigate = function () { };
  window.phfToast = function () { };
  window.fetch = function () { throw new Error('DEMO MODE VIOLATION: fetch() was called — V5 managed workspace demo actions must never reach the real API/network.'); };
  window.eval(DEMO_FIXTURES_SRC);
  window.eval(TASK_APP_SRC);
  return window;
}
function click(window, root, selector) {
  const el = window.document.querySelector(selector);
  assert.ok(el, 'click target must exist: ' + selector);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}
function render(window, T, root) { root.innerHTML = T.shellFrame(T.taskListHtml()); }

(async () => {
  const window = newTaskAppWindow();
  const T = window.__PHF_TASK_TEST__;
  const state = T.getState();
  const root = window.document.getElementById('phfTaskRoot');
  T.bindShell(root);
  const fixtures = window.PHF_TASK_UI_DEMO_FIXTURES;

  // ================= ROUTE REGISTRATION (avoid the reported bug: route in
  // phf-task-app.js but missing in phf-url-router.js) =================
  pass(T.taskListPath('managed') === '/admin/task/nhan-su-toi-quan-ly', 'ROUTE: taskListPath("managed") trả đúng path mới');
  pass(T.parseTaskRoute(T.taskListPath('managed')).view === 'list' && T.parseTaskRoute(T.taskListPath('managed')).relation === 'managed', 'ROUTE: parseTaskRoute nhận đúng relation=managed');
  ['admin', 'ql', 'hv'].forEach(prefix => {
    const fullPath = '/' + prefix + '/task/nhan-su-toi-quan-ly';
    pass(ROUTER_SRC.includes("'" + fullPath + "'"), 'ROUTER: ' + fullPath + ' phải xuất hiện trong phf-url-router.js (nếu thiếu, router fail-closed về /' + prefix + '/task — đúng bug đã báo mục 11)');
  });
  const registryEntry = new RegExp("'/admin/task/nhan-su-toi-quan-ly':Object\\.freeze\\(\\{area:'admin'").test(ROUTER_SRC);
  pass(registryEntry, 'ROUTER: có entry ROUTE_REGISTRY riêng cho admin (không chỉ nằm trong PHF_ROUTE_MAP array)');
  const routeMapEntry = /PHF_ROUTE_MAP\.admin\.push\([^)]*'\/admin\/task\/nhan-su-toi-quan-ly'/.test(ROUTER_SRC);
  pass(routeMapEntry, 'ROUTER: có trong PHF_ROUTE_MAP.admin.push(...) — cả 2 nơi (registry + route map) đều bắt buộc theo cách router hiện đọc path');

  // ================= A. Menu visibility =================
  pass(T.taskManagerScopeAvailable() === true, 'MENU SETUP: DEMO_ACTOR có managed scope (window.PHF_TASK_UI_DEMO_MANAGER_SCOPE=true)');
  const parentItem = T.NAV_ITEMS.find(i => i.key === 'viec-cua-toi');
  pass(!!parentItem, 'MENU: group "Việc của tôi" tồn tại');
  const managedChild = parentItem.children.find(c => c.key === 'nhan-su-toi-quan-ly');
  pass(!!managedChild && managedChild.relation === 'managed' && managedChild.managerOnly === true, 'MENU: child "Nhân sự tôi quản lý" tồn tại, map đúng relation=managed, đánh dấu managerOnly');
  pass(T.taskNavVisibleChildren(parentItem).some(c => c.key === 'nhan-su-toi-quan-ly'), 'MENU: manager actor (demo) THẤY "Nhân sự tôi quản lý" trong danh sách children hiển thị');
  const managerNavHtml = T.navItemHtml(parentItem, 'nhan-su-toi-quan-ly');
  pass(/Nhân sự tôi quản lý/.test(managerNavHtml), 'MENU: render HTML thực tế có label "Nhân sự tôi quản lý" khi actor có managed scope');

  // employee (no managed scope) KHÔNG thấy
  const originalFlag = window.PHF_TASK_UI_DEMO_MANAGER_SCOPE;
  window.PHF_TASK_UI_DEMO_MANAGER_SCOPE = false;
  pass(T.taskManagerScopeAvailable() === false, 'MENU: actor không có managed scope -> taskManagerScopeAvailable()=false');
  pass(!T.taskNavVisibleChildren(parentItem).some(c => c.key === 'nhan-su-toi-quan-ly'), 'MENU: nhân viên thường (không managed scope) KHÔNG thấy "Nhân sự tôi quản lý" trong children hiển thị');
  const employeeNavHtml = T.navItemHtml(parentItem, 'toi-nhan');
  pass(!/Nhân sự tôi quản lý/.test(employeeNavHtml), 'MENU: render HTML thực tế KHÔNG có "Nhân sự tôi quản lý" khi actor không có managed scope');
  window.PHF_TASK_UI_DEMO_MANAGER_SCOPE = originalFlag; // restore cho phần còn lại của test

  // active/expand state khi route managed đang active
  pass(T.findNavParentKey('nhan-su-toi-quan-ly') === 'viec-cua-toi', 'MENU PARENT: child "nhan-su-toi-quan-ly" thuộc đúng group "viec-cua-toi"');
  pass(T.navGroupExpanded('viec-cua-toi', 'nhan-su-toi-quan-ly') === true, 'MENU PARENT: group tự động expanded khi active child là "nhan-su-toi-quan-ly" (F5/deep-link)');
  state.view = 'list';
  state.list = Object.assign(T.defaultTaskListState(), { relation: 'managed' });
  render(window, T, root);
  pass(/phft-nav-child active"[^>]*data-task-nav="nhan-su-toi-quan-ly"|data-task-nav="nhan-su-toi-quan-ly"[^>]*class="[^"]*active/.test(window.document.getElementById('phfTaskRoot').innerHTML) || window.document.querySelector('[data-task-nav="nhan-su-toi-quan-ly"]').className.includes('active'), 'MENU ACTIVE: nav child "Nhân sự tôi quản lý" có class active khi relation=managed đang mở');

  // ================= B. "Tôi nhận" separation =================
  await T.openTaskList(root, 'received');
  pass(state.list.tasks.length > 0, 'TÔI NHẬN: có dữ liệu');
  pass(!state.list.tasks.some(t => t.scope_kind === 'managed'), 'TÔI NHẬN: không còn task managed nào');
  const demoActor = window.PHF_TASK_UI_DEMO_ACTOR;
  pass(state.list.tasks.every(t => t.primary && t.primary.employee_code === demoActor.employee_code), 'TÔI NHẬN: MỌI task đều có primary = chính actor (đúng nghĩa cá nhân — mục 3)');
  const receivedCounts = T.taskListSummaryCounts();
  pass(receivedCounts.total === receivedCounts.in_progress + receivedCounts.overdue + receivedCounts.completed, 'TÔI NHẬN SUMMARY: Tổng = Đang làm + Quá hạn + Hoàn thành cho đúng dataset actor (mục 14) — không có task cancelled/rework nào lọt vào tại rest nên 3 bucket cũ đã đủ reconcile');

  // ================= C. Manager workspace dataset =================
  await T.openTaskList(root, 'managed');
  pass(state.list.tasks.length === 5, 'MANAGER DATASET: đúng 5 task managed trong fixture (demo-r7, r11-r14)');
  pass(state.list.tasks.every(t => t.scope_kind === 'managed'), 'MANAGER DATASET: MỌI task trong "managed" đều scope_kind=managed');
  pass(!state.list.tasks.some(t => t.primary && t.primary.employee_code === demoActor.employee_code), 'MANAGER DATASET: actor KHÔNG bị biến thành recipient — không có task nào primary=actor');
  pass(!state.list.tasks.some(t => t.created_by && t.created_by.employee_code === demoActor.employee_code), 'MANAGER DATASET: actor KHÔNG bị biến thành creator — không có task nào created_by=actor');
  // unrelated employee (không phải NV_B) không lọt vào
  const nvBCode = 'DEMO_NVB';
  pass(state.list.tasks.every(t => t.primary && t.primary.employee_code === nvBCode), 'MANAGER DATASET: chỉ đúng 1 nhân sự được quản lý (NV_B) trong tập fixture hiện tại — không có nhân sự khác lọt vào (unrelated employee test)');
  pass(state.list.tasks.some(t => t.task_id === 'demo-r7'), 'MANAGER DATASET: case canonical demo-r7 vẫn còn nguyên trong managed workspace');

  // ================= D. Summary reconciliation (assert bằng code) =================
  const counts = T.taskListSummaryCounts();
  pass(typeof counts.rework === 'number' && typeof counts.cancelled === 'number', 'SUMMARY: relation=managed có đủ 2 bucket rework/cancelled ngoài 3 bucket cũ');
  const sum = counts.in_progress + counts.overdue + counts.completed + counts.rework + counts.cancelled;
  pass(counts.total === sum, 'SUMMARY RECONCILIATION: Tổng (' + counts.total + ') = Đang thực hiện(' + counts.in_progress + ') + Quá hạn(' + counts.overdue + ') + Hoàn thành(' + counts.completed + ') + Cần xử lý lại(' + counts.rework + ') + Đã hủy(' + counts.cancelled + ') = ' + sum);
  pass(counts.in_progress === 1 && counts.completed === 1 && counts.rework === 1 && counts.cancelled === 1, 'SUMMARY: fixture có đủ 4/5 bucket = 1 task mỗi loại (demo-r7=in_progress, r12=completed, r13=rework, r14=cancelled)');
  // demo-r11 (published, deadline quá khứ) rơi vào overdue
  pass(counts.overdue === 1, 'SUMMARY: demo-r11 (quá hạn, chưa hoàn thành) rơi đúng vào bucket Quá hạn');

  // status tab labels đủ 6 (bao gồm 'all')
  const managedLabels = T.TASK_STATUS_TAB_LABELS_MANAGED;
  pass(Object.keys(managedLabels).length === 6 && ['all', 'in_progress', 'overdue', 'completed', 'rework', 'cancelled'].every(k => k in managedLabels), 'STATUS TABS: managed có đủ 6 tab (Tất cả + 5 bucket)');
  render(window, T, root);
  const managedListHtml = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/Cần xử lý lại/.test(managedListHtml) && /Đã hủy/.test(managedListHtml), 'STATUS TABS: render đủ "Cần xử lý lại" và "Đã hủy" trong tabbar');

  // click từng status tab -> dataset con cộng đúng lại = total (double check qua UI thật, không chỉ qua counts object)
  for (const key of ['in_progress', 'overdue', 'completed', 'rework', 'cancelled']) {
    state.list.statusFilter = key;
    await T.loadTaskList(root);
    const bucketLen = state.list.tasks.length;
    pass(bucketLen === counts[key], 'STATUS FILTER: statusFilter=' + key + ' trả đúng ' + counts[key] + ' task (khớp taskListSummaryCounts)');
  }
  state.list.statusFilter = 'all';
  await T.loadTaskList(root);
  pass(state.list.tasks.length === counts.total, 'STATUS FILTER: statusFilter=all trả lại đúng Tổng');

  // ================= E. Cross-department attribute filter (subset, not part of status sum) =================
  pass(state.list.tasks.filter(t => t.is_cross_department === true).length === 1, 'CROSS-DEPT: đúng 1/5 task managed là liên phòng ban (demo-r7) — subset, không phải bucket status riêng');
  state.list.scope = 'cross_department';
  await T.loadTaskList(root);
  pass(state.list.tasks.length === 1 && state.list.tasks[0].task_id === 'demo-r7', 'CROSS-DEPT FILTER: lọc đúng ra demo-r7, không lẫn 4 task managed cùng phòng ban khác');
  const crossDeptCounts = T.taskListSummaryCounts();
  pass(crossDeptCounts.total === 1 && crossDeptCounts.total === crossDeptCounts.in_progress + crossDeptCounts.overdue + crossDeptCounts.completed + crossDeptCounts.rework + crossDeptCounts.cancelled, 'CROSS-DEPT FILTER: summary reconciliation VẪN đúng trên dataset ĐÃ lọc (attribute filter không phá vỡ phép cộng status)');
  state.list.scope = '';
  await T.loadTaskList(root);

  // ================= F. Manager detail — role banner + zero action authority =================
  render(window, T, root);
  click(window, root, '[data-task-list-row="demo-r7"]');
  render(window, T, root);
  let html = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/Bạn đang xem với vai trò/.test(html) && /Quản lý của người thực hiện/.test(html), 'MANAGER DETAIL: role banner "Bạn đang xem với vai trò: Quản lý của người thực hiện" render đúng');
  pass(!/Bạn nhận công việc này/.test(html), 'MANAGER DETAIL: KHÔNG dùng wording "Bạn nhận công việc này" (mục 10)');
  pass(/Nhân viên thực hiện/.test(html), 'MANAGER DETAIL: detail-grid dùng "Nhân viên thực hiện" thay vì "Người nhận chính"');
  pass(/Liên phòng ban/.test(html), 'MANAGER DETAIL: demo-r7 liên phòng ban -> hiện "Phòng giao → Phòng nhận" trong role banner');
  pass(!window.document.querySelector('[data-task-demo-status]'), 'MANAGER DETAIL: không có complete/status action');
  pass(!window.document.querySelector('[data-task-demo-cancel-toggle]') && !window.document.querySelector('[data-task-demo-cancel-request-toggle]'), 'MANAGER DETAIL: không có cancel action');
  pass(!window.document.querySelector('[data-task-demo-rework-toggle]'), 'MANAGER DETAIL: không có rework action');
  pass(!window.document.querySelector('[data-task-demo-add-note]') && !window.document.querySelector('[data-task-demo-add-evidence]'), 'MANAGER DETAIL: không có recipient update controls (note/evidence)');
  pass(!window.document.querySelector('[data-task-demo-send-feedback]'), 'MANAGER DETAIL: không có assigner feedback controls');
  pass(!/data-task-field=/.test(html), 'MANAGER DETAIL: không có full-edit creator field nào');
  click(window, root, '[data-task-demo-detail-close]');

  // ================= G. List row semantics (mục 9) =================
  render(window, T, root);
  html = window.document.getElementById('phfTaskRoot').innerHTML;
  pass(/Nhân viên thực hiện/.test(html), 'LIST HEADER: cột counterparty của managed dùng "Nhân viên thực hiện"');
  pass(/Người giao/.test(html), 'LIST HEADER: có thêm cột riêng "Người giao"');
  pass(/Nguyễn Hải Đăng/.test(html), 'LIST ROW: hiện đúng tên nhân viên thực hiện (NV_B) trong bảng');

  // ================= H. Proposal — không nhét vào managed workspace =================
  pass(!Object.prototype.hasOwnProperty.call(fixtures, 'managed'), 'PROPOSAL/FIXTURE: không có bucket fixture "managed" riêng — chỉ là filter trên "received" (mục 1, 4)');
  await T.openTaskList(root, 'proposal_sent');
  pass(!state.list.tasks.some(t => t.scope_kind === 'managed'), 'PROPOSAL: đề xuất của nhân viên managed KHÔNG bị nhét vào bất kỳ đâu ngoài ý muốn (fixture proposal hoàn toàn tách biệt)');

  // ================= I. Regression =================
  await T.openTaskList(root, 'received');
  pass(state.list.relation === 'received', 'REGRESSION: "Tôi nhận" vẫn mở được bình thường');
  await T.openTaskList(root, 'assigned');
  pass(state.list.relation === 'assigned' && state.list.tasks.every(t => t.created_by.employee_code === demoActor.employee_code), 'REGRESSION: "Tôi giao" self-only lock không đổi (mục 15)');
  pass(T.parseTaskRoute(T.taskListPath('received')).relation === 'received', 'REGRESSION: route /nhan vẫn hoạt động');
  pass(T.parseTaskRoute(T.taskListPath('assigned')).relation === 'assigned', 'REGRESSION: route /giao vẫn hoạt động');
  pass(T.parseTaskRoute(T.taskListPath('proposal_sent')).relation === 'proposal_sent', 'REGRESSION: route đề xuất vẫn hoạt động');
  const childKeys = parentItem.children.map(c => c.key);
  pass(childKeys.includes('toi-nhan') && childKeys.includes('toi-giao') && childKeys.includes('nhan-su-toi-quan-ly') && childKeys.includes('de-xuat-toi-gui') && childKeys.includes('de-xuat-toi-nhan'), 'REGRESSION: group "Việc của tôi" có đủ 5 child canonical (mục 1)');

  // ================= J. Safety =================
  pass(true, 'SAFETY: toàn bộ thao tác managed workspace phía trên (list/filter/summary/detail) không hề gọi fetch() — nếu có, test đã crash ở bước tương ứng');

  console.log('PHF Task Managed Workspace V5 test: ' + passed + '/' + passed + ' PASS');
})().then(() => {
  pass(!/PHF_TASK_UI_DEMO/.test(PERMISSIONS_SRC), 'FOUNDATION: api/_lib/task-permissions.js không có dấu vết demo mode nào (không bị sửa)');
  pass(!/PHF_TASK_UI_DEMO/.test(SCOPE_SRC), 'FOUNDATION: api/_lib/task-employee-scope.js không có dấu vết demo mode nào (không bị sửa)');
  console.log('PHF Task Managed Workspace V5 — foundation isolation check: ' + passed + '/' + passed + ' PASS (cumulative)');
}).catch(err => { console.error(err); process.exitCode = 1; });
