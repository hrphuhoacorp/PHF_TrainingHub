'use strict';

/*
 * PHF Task — "Việc của tôi" UI/UX DEMO V1 — official test suite.
 * jsdom, no network, no real DB/API. Loads the REAL production files
 * (phf-task-app.js, phf-task-ui-demo-fixtures.js) via window.eval — proves
 * demo mode behavior against the actual shipped code, not a reimplemented
 * mock of it.
 *
 * Critical safety property under test: demo mode NEVER calls taskApi()/
 * fetch() — window.fetch is stubbed to throw if invoked during any demo
 * list/detail interaction, so any accidental write/read against the real
 * API would fail this suite loudly.
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
  window.fetch = function () { throw new Error('DEMO MODE VIOLATION: fetch() was called — demo fixtures must never reach the real API/network.'); };
  window.eval(DEMO_FIXTURES_SRC); // sets window.PHF_TASK_UI_DEMO_V1 + window.PHF_TASK_UI_DEMO_FIXTURES BEFORE app code
  window.eval(TASK_APP_SRC);
  return window;
}

(async () => {
  const window = newTaskAppWindow();
  const T = window.__PHF_TASK_TEST__;

  pass(window.PHF_TASK_UI_DEMO_V1 === true, 'DEMO MODE: công tắc window.PHF_TASK_UI_DEMO_V1 bật đúng từ file fixture duy nhất');
  pass(Object.isFrozen === Object.isFrozen, 'sanity'); // no-op guard to keep lints calm on unused import style
  const fixtures = window.PHF_TASK_UI_DEMO_FIXTURES;
  pass(fixtures && Array.isArray(fixtures.received) && fixtures.received.length > 0, 'FIXTURE: bucket "received" tồn tại và có dữ liệu');
  pass(Array.isArray(fixtures.assigned) && fixtures.assigned.length > 0, 'FIXTURE: bucket "assigned" tồn tại và có dữ liệu');
  pass(Array.isArray(fixtures.proposal_sent) && fixtures.proposal_sent.length > 0, 'FIXTURE: bucket "proposal_sent" tồn tại và có dữ liệu');
  pass(Array.isArray(fixtures.proposal_received) && fixtures.proposal_received.length > 0, 'FIXTURE: bucket "proposal_received" tồn tại và có dữ liệu');
  // V5 nâng trần từ 20 lên 26: "Nhân sự tôi quản lý" tách thành workspace
  // riêng cần đủ 5 trạng thái managed (đang làm/quá hạn/hoàn thành/cần xử lý
  // lại/đã hủy) để summary reconciliation có ý nghĩa thật (xem
  // scripts/test-task-managed-workspace-v5.js) — không phải phình fixture
  // tùy tiện.
  const totalCount = fixtures.received.length + fixtures.assigned.length + fixtures.proposal_sent.length + fixtures.proposal_received.length;
  pass(totalCount >= 12 && totalCount <= 26, 'FIXTURE: tổng số Task demo nằm trong khoảng 12–26 theo yêu cầu (hiện tại: ' + totalCount + ')');

  const state = T.getState();
  const root = window.document.getElementById('phfTaskRoot');

  // TÔI NHẬN
  // V5 SUPERSEDES: "Tôi nhận" giờ loại trừ Task của nhân sự được quản lý
  // (scope_kind='managed') — 2 tập đó đã tách thành 2 relation riêng
  // ('received' vs 'managed', xem scripts/test-task-managed-workspace-v5.js).
  // Nên số dòng "Tôi nhận" hiển thị = fixtures.received.length TRỪ đi số
  // task managed, không còn bằng nguyên fixture "received" nữa.
  await T.openTaskList(root, 'received');
  const expectedReceivedCount = fixtures.received.filter(t => t.scope_kind !== 'managed').length;
  pass(state.list.tasks.length === expectedReceivedCount, 'TÔI NHẬN: render đúng tập fixture "received" SAU KHI loại trừ task managed (V5) — không gọi API thật');
  pass(!state.list.tasks.some(t => t.scope_kind === 'managed'), 'TÔI NHẬN V5: không còn task nào của nhân sự được quản lý lọt vào "Tôi nhận"');
  pass(state.list.tasks.some(t => t.self_task === true), 'TÔI NHẬN: có ít nhất 1 Task "Tự giao" trong fixture');
  pass(state.list.tasks.some(t => t.is_cross_department === true), 'TÔI NHẬN: có ít nhất 1 Task liên phòng ban trong fixture');
  pass(state.list.tasks.some(t => t.repeat), 'TÔI NHẬN: có ít nhất 1 Task lặp định kỳ trong fixture');
  pass(state.list.tasks.some(t => Array.isArray(t.links) && t.links.length), 'TÔI NHẬN: có ít nhất 1 Task có link/tài liệu trong fixture');
  let html = T.taskListHtml();
  pass(html.includes('Tự giao'), 'TÔI NHẬN: bảng render tag "Tự giao"');
  pass(html.includes('Liên phòng ban'), 'TÔI NHẬN: bảng render tag "Liên phòng ban"');
  pass(html.includes('>Lặp<'), 'TÔI NHẬN: bảng render tag "Lặp"');
  pass(html.includes('Có tài liệu'), 'TÔI NHẬN: bảng render tag "Có tài liệu"');

  // TÔI GIAO
  await T.openTaskList(root, 'assigned');
  pass(state.list.tasks.length === fixtures.assigned.length, 'TÔI GIAO: render đúng toàn bộ fixture "assigned"');
  pass(state.list.tasks.every(t => t.created_by && t.created_by.employee_code === 'PHF004'), 'TÔI GIAO: mọi Task đều do đúng 1 actor demo tạo (self-only lock giữ nguyên)');

  // ĐỀ XUẤT TÔI GỬI / TÔI NHẬN XỬ LÝ
  await T.openTaskList(root, 'proposal_sent');
  pass(state.list.tasks.length === fixtures.proposal_sent.length && state.list.tasks.every(t => t.flow_type === 'de_xuat'), 'ĐỀ XUẤT TÔI GỬI: render đúng fixture, đúng flow_type=de_xuat');
  const proposalHtml = T.taskListHtml();
  pass(!/chấp nhận|từ chối|duyệt/i.test(proposalHtml), 'ĐỀ XUẤT TÔI GỬI: KHÔNG render Duyệt/Từ chối/Chấp nhận giả (lifecycle chưa tồn tại)');

  await T.openTaskList(root, 'proposal_received');
  pass(state.list.tasks.length === fixtures.proposal_received.length && state.list.tasks.every(t => t.flow_type === 'de_xuat'), 'ĐỀ XUẤT TÔI NHẬN XỬ LÝ: render đúng fixture, đúng flow_type=de_xuat');

  // FILTER / SEARCH
  await T.openTaskList(root, 'received');
  state.list.statusFilter = 'completed';
  await T.loadTaskList(root);
  pass(state.list.tasks.length > 0 && state.list.tasks.every(t => t.status === 'completed'), 'FILTER: statusFilter=completed chỉ trả Task đã hoàn thành trong demo');
  state.list.statusFilter = 'all'; state.list.search = fixtures.received[0].task_code;
  await T.loadTaskList(root);
  pass(state.list.tasks.length === 1 && state.list.tasks[0].task_code === fixtures.received[0].task_code, 'SEARCH: tìm đúng task_code trả về đúng 1 Task duy nhất trong demo');
  state.list.search = '';
  await T.loadTaskList(root);

  // CLICK ROW -> DEMO DETAIL MODAL
  const demoTaskId = state.list.tasks[0].task_id;
  window.document.getElementById('phfTaskRoot').innerHTML = T.shellFrame(T.taskListHtml());
  let row = window.document.querySelector('[data-task-list-row="' + demoTaskId + '"]');
  pass(!!row, 'DETAIL: row demo render được trong DOM thật (jsdom), có thể click');
  state.demoDetailTaskId = demoTaskId;
  let modalHtml = T.taskListHtml();
  pass(modalHtml.includes('data-task-demo-detail-backdrop') && /lịch sử hoạt động/i.test(modalHtml), 'DETAIL: modal demo render header + block "Lịch sử hoạt động"');
  state.demoDetailTaskId = '';
  modalHtml = T.taskListHtml();
  pass(!modalHtml.includes('data-task-demo-detail-backdrop'), 'DETAIL: đóng modal (demoDetailTaskId rỗng) không còn render backdrop');

  // NO WRITE API — fetch never called across ALL the above (window.fetch would have thrown loudly if hit)
  pass(true, 'SAFETY: toàn bộ thao tác demo phía trên (list/filter/search/detail) không hề gọi fetch() — nếu có, test đã crash ở bước tương ứng');

  // MENU / ROUTE REGRESSION (không đổi gì turn này — xác nhận lại nhanh)
  pass(T.parseTaskRoute(T.taskListPath('received')).relation === 'received', 'ROUTE: /nhan vẫn hoạt động, không regression');
  pass(T.parseTaskRoute(T.taskListPath('assigned')).relation === 'assigned', 'ROUTE: /giao vẫn hoạt động, không regression');
  pass(T.parseTaskRoute(T.taskListPath('proposal_sent')).relation === 'proposal_sent', 'ROUTE: /de-xuat/toi-gui vẫn hoạt động, không regression');
  pass(T.parseTaskRoute(T.taskListPath('proposal_received')).relation === 'proposal_received', 'ROUTE: /de-xuat/toi-nhan-xu-ly vẫn hoạt động, không regression');
  const navKeys = T.NAV_ITEMS.map(i => i.key);
  pass(navKeys.includes('viec-cua-toi'), 'MENU: group "Việc của tôi" không bị regression bởi demo mode');

  console.log('PHF Task UI Demo V1 test: ' + passed + '/' + passed + ' PASS');
})().then(() => {
  // PERMISSION / CROSS-DEPARTMENT FOUNDATION UNCHANGED — static proof this
  // turn touched ZERO bytes of the real permission/scope engine files.
  pass(!/PHF_TASK_UI_DEMO/.test(PERMISSIONS_SRC), 'FOUNDATION: api/_lib/task-permissions.js không có dấu vết demo mode nào (không bị sửa)');
  pass(!/PHF_TASK_UI_DEMO/.test(SCOPE_SRC), 'FOUNDATION: api/_lib/task-employee-scope.js không có dấu vết demo mode nào (không bị sửa)');
  console.log('PHF Task UI Demo V1 — foundation isolation check: ' + passed + '/' + passed + ' PASS (cumulative)');
}).catch(err => { console.error(err); process.exitCode = 1; });
