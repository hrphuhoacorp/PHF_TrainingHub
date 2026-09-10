'use strict';
/* PHF Task — CANCEL REQUEST USABILITY V1 (2026-09-10) — jsdom UI/logic
   regression (no backend, no net). Loads the REAL production file via
   window.eval (same harness pattern as test-task-cancel-policy-v1.js).

   Covers the UX direction lock:
     - exactly one new entrypoint "Yêu cầu cần xử lý" under "Việc của tôi"
     - badge shows the live pending count, hidden when 0
     - route round-trips (taskPendingCancelPath <-> parseTaskRoute)
     - the list page renders mã việc/tên việc/người yêu cầu/lý do/thời gian/
       trạng thái/Xem, and is empty-safe / error-safe / loading-safe
     - taskCancelRequestSectionHtml() is covered by test-task-cancel-policy-v1.js
       (panel relocation + history) — not duplicated here. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'assets', 'js', 'task', 'phf-task-app.js'), 'utf8');
const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/admin/task' });
const { window } = dom;
window.__PHF_TASK_TEST_MODE__ = true;
window.phfGetSessionRole = () => 'admin';
window.phfGetCurrentUser = () => ({ fullName: 'A', email: 'a@a' });
window.phfNavigate = () => {}; window.phfToast = () => {};
window.eval(code);
const T = window.__PHF_TASK_TEST__;
assert.ok(T, '__PHF_TASK_TEST__ exposed');
let passed = 0;
function pass(c, m) { assert.ok(c, m); passed += 1; }

/* ---- A. exactly one new entrypoint, in "Việc của tôi", correct copy -------- */
(function () {
  const group = T.NAV_ITEMS.find((i) => i.key === 'viec-cua-toi');
  pass(!!group, 'A0: "Việc của tôi" group still exists');
  const matches = group.children.filter((c) => c.key === 'yeu-cau-huy');
  pass(matches.length === 1, 'A1: exactly ONE "yeu-cau-huy" entrypoint');
  const item = matches[0];
  pass(item.label === 'Yêu cầu cần xử lý', 'A2: label = "Yêu cầu cần xử lý"');
  pass(item.desc === 'Yêu cầu hủy công việc', 'A3: subtitle = "Yêu cầu hủy công việc"');
  pass(!item.managerOnly, 'A4: visible to every actor, not gated like "Nhân sự tôi quản lý"');
})();

/* ---- B. badge: hidden at 0, visible with count, capped at 99+ -------------- */
(function () {
  T.setPendingCancelBadgeState({ count: 0 });
  let html = T.taskNavItemsHtml();
  pass(!/phft-nav-badge/.test(html), 'B1: count=0 -> no badge rendered at all');

  T.setPendingCancelBadgeState({ count: 3 });
  html = T.taskNavItemsHtml();
  pass(/data-task-nav="yeu-cau-huy"[^]*?phft-nav-badge">3</.test(html), 'B2: count=3 -> badge shows "3" on the right entrypoint');
  pass(/Yêu cầu hủy công việc/.test(html), 'B3: subtitle renders in the sidebar too');

  T.setPendingCancelBadgeState({ count: 140 });
  html = T.taskNavItemsHtml();
  pass(/phft-nav-badge">99\+</.test(html), 'B4: count=140 -> capped display "99+"');

  // every OTHER child must render exactly as before (no accidental badge/desc leak)
  T.setPendingCancelBadgeState({ count: 5 });
  html = T.taskNavItemsHtml();
  const receivedBtn = /<button[^>]*data-task-nav="toi-nhan"[^>]*>[\s\S]*?<\/button>/.exec(html)[0];
  pass(!/phft-nav-badge/.test(receivedBtn) && !/<small>/.test(receivedBtn), 'B5: "Tôi nhận" (no badge/desc field) unaffected — single-line as before');

  T.setPendingCancelBadgeState({ count: 0, loading: false, loaded: false, loadedAt: 0, error: false });
})();

/* ---- C. route round-trip ---------------------------------------------------- */
(function () {
  const p = T.taskPendingCancelPath();
  pass(p === '/admin/task/yeu-cau-huy', 'C1: taskPendingCancelPath() under /admin');
  const route = T.parseTaskRoute(p);
  pass(route.view === 'pending-cancel', 'C2: parseTaskRoute() resolves the route back to view=pending-cancel');
})();

/* ---- D. active nav key highlights the entrypoint while on the page --------- */
(function () {
  const st = T.getState();
  const prevView = st.view;
  st.view = 'pending-cancel';
  pass(T.taskActiveNavKey() === 'yeu-cau-huy', 'D1: taskActiveNavKey() === "yeu-cau-huy" while viewing the inbox');
  st.view = prevView;
})();

/* ---- E. list page: columns + row content ------------------------------------ */
(function () {
  const st = T.getState();
  st.pendingCancel = {
    loading: false, error: '', loadedOnce: true,
    requests: [{
      task_id: 't1', task_code: 'CV-2609-0001', title: 'Kiểm kho tuần',
      requested_by: { employee_code: 'PHF082', full_name: 'Nguyễn Văn A' },
      reason: 'Trùng với checklist đã có', requested_at: '2026-09-10T02:00:00Z', status: 'pending',
    }],
  };
  const html = T.taskPendingCancelListHtml();
  pass(/Yêu cầu cần xử lý/.test(html) && /Yêu cầu hủy công việc/.test(html), 'E1: page header + subtitle');
  pass(/CV-2609-0001/.test(html), 'E2: mã phiếu column');
  pass(/Kiểm kho tuần/.test(html), 'E3: tên công việc column');
  pass(/Nguyễn Văn A/.test(html), 'E4: người yêu cầu column (full name, not bare code)');
  pass(/Trùng với checklist đã có/.test(html), 'E5: lý do column');
  pass(/Đang chờ xử lý/.test(html), 'E6: trạng thái column');
  pass(/data-task-list-row="t1"/.test(html), 'E7: row is click-to-open (reuses the existing list-row navigation, no new click plumbing)');
})();

/* ---- F. list page: empty / loading / error states never crash -------------- */
(function () {
  const st = T.getState();
  st.pendingCancel = { loading: false, error: '', loadedOnce: true, requests: [] };
  let html = T.taskPendingCancelListHtml();
  pass(/Không có yêu cầu hủy nào/.test(html), 'F1: empty state has a truthful message');

  st.pendingCancel = { loading: true, error: '', loadedOnce: false, requests: [] };
  html = T.taskPendingCancelListHtml();
  pass(/Đang tải danh sách yêu cầu hủy/.test(html), 'F2: loading state');

  st.pendingCancel = { loading: false, error: 'Không kết nối được máy chủ.', loadedOnce: true, requests: [] };
  html = T.taskPendingCancelListHtml();
  pass(/Không tải được danh sách/.test(html) && /Không kết nối được máy chủ/.test(html), 'F3: error state surfaces the real message');
})();

/* ---- G. requester with no full_name falls back to employee_code ------------ */
(function () {
  const row = { task_id: 't2', task_code: 'CV-2', title: 'X', requested_by: { employee_code: 'PHF090', full_name: '' }, reason: 'r', requested_at: '2026-09-10T02:00:00Z' };
  const html = T.taskPendingCancelRowHtml(row);
  pass(/PHF090/.test(html), 'G1: falls back to employee_code when full_name is empty (never a blank cell)');
})();

console.log('PHF Task Cancel Request Usability UI V1 (jsdom): ' + passed + '/' + passed + ' PASS');
