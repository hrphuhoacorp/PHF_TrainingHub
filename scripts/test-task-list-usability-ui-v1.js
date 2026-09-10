'use strict';
/* PHF Task — TASK LIST USABILITY V1 (2026-09-10) — jsdom UI/logic regression
   (no backend, no net). Loads the REAL production file via window.eval (same
   harness pattern as test-task-cancel-request-usability-ui-v1.js).

   Covers the parts of the UX lock this file can prove WITHOUT a live DB:
     B. deadline readability labels (pure display-derived function)
     C. Filter V1 — workspace-aware field availability, payload builder,
        active-count, panel open/apply/clear round-trip, wire params sent to
        listTasks()
     rework tab genuinely gone from the real (non-demo) status-label map
   A (smart ORDER BY) is covered at the SQL level by
   services/phf-hr-api/test-task-list-usability-v1.js — there is no
   client-side sort to test here (the server does the ordering). */
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

/* ---- B. Deadline readability label ---- */
(function () {
  pass(T.taskListDeadlineLabel(-2) === 'Quá hạn 2 ngày', 'B1: -2 days -> "Quá hạn 2 ngày"');
  pass(T.taskListDeadlineLabel(0) === 'Hôm nay', 'B2: 0 days -> "Hôm nay"');
  pass(T.taskListDeadlineLabel(1) === 'Ngày mai', 'B3: 1 day -> "Ngày mai"');
  pass(T.taskListDeadlineLabel(3) === 'Còn 3 ngày', 'B4: 3 days -> "Còn 3 ngày"');
  pass(T.taskListDeadlineLabel(30) === '', 'B5: far future (30 days) -> no label at all ("không cần chip màu mè")');

  const soon = new Date(Date.now() + 2 * 86400000).toISOString();
  const html = T.taskListDeadlineHtml({ deadline: soon, status: 'in_progress' });
  pass(/phft-dl-label/.test(html), 'B6: active Task with a near deadline renders the small label');
  const far = new Date(Date.now() + 90 * 86400000).toISOString();
  const htmlFar = T.taskListDeadlineHtml({ deadline: far, status: 'in_progress' });
  pass(!/phft-dl-label/.test(htmlFar), 'B7: far-future active Task renders the plain date, no label');
  const completedNear = T.taskListDeadlineHtml({ deadline: soon, status: 'completed' });
  pass(!/phft-dl-label/.test(completedNear), 'B8: completed Task never gets a readability label (not open work)');
  pass(/—/.test(T.taskListDeadlineHtml({ deadline: null, status: 'in_progress' })), 'B9: no-deadline row keeps the existing "—" placeholder unchanged');
})();

/* ---- C. Filter V1 — workspace-aware field availability ---- */
(function () {
  pass(JSON.stringify(T.taskListFilterFieldsForRelation('received').sort()) === JSON.stringify(['category', 'creator', 'deadline', 'priority'].sort()), 'C1: received -> priority/category/deadline/creator, NO primary (self-only scope)');
  pass(JSON.stringify(T.taskListFilterFieldsForRelation('assigned').sort()) === JSON.stringify(['category', 'deadline', 'priority', 'primary'].sort()), 'C2: assigned -> priority/category/deadline/primary, NO creator (always self)');
  pass(JSON.stringify(T.taskListFilterFieldsForRelation('managed').sort()) === JSON.stringify(['category', 'creator', 'deadline', 'primary', 'priority'].sort()), 'C3: managed -> all 5 fields (both creator and primary useful)');
  pass(T.taskListFilterFieldEnabled('received', 'primary') === false, 'C4: taskListFilterFieldEnabled(received, primary) = false');
  pass(T.taskListFilterFieldEnabled('assigned', 'creator') === false, 'C5: taskListFilterFieldEnabled(assigned, creator) = false');
  pass(T.taskListFilterFieldEnabled('managed', 'creator') === true && T.taskListFilterFieldEnabled('managed', 'primary') === true, 'C6: managed enables both');
})();

/* ---- C. Filter V1 — payload builder (mirrors api/data.js whitelist) ---- */
(function () {
  const empty = T.taskListFiltersPayload(T.defaultTaskListFilters());
  pass(Object.keys(empty).length === 0, 'C7: empty filters -> empty payload (nothing sent as an empty-string filter)');
  const full = T.taskListFiltersPayload({ priority: 'khan_cap', category: 'BAO_CAO', creator: 'PHF001', primary: 'PHF080', deadlineFrom: '2026-09-01T00:00:00.000Z', deadlineTo: '2026-09-30T23:59:59.000Z' });
  pass(full.priority_filter === 'khan_cap' && full.category_filter === 'BAO_CAO' && full.creator_filter === 'PHF001' && full.primary_filter === 'PHF080' && full.deadline_from && full.deadline_to, 'C8: every field maps to its api/data.js wire key exactly');
})();

/* ---- C. Filter V1 — active count ---- */
(function () {
  pass(T.taskListFilterCount(T.defaultTaskListFilters(), 'received') === 0, 'C9: no filters active -> count 0');
  const f = { priority: 'khan_cap', category: 'BAO_CAO', creator: 'PHF001', primary: 'PHF080', deadlineFrom: '', deadlineTo: '' };
  pass(T.taskListFilterCount(f, 'received') === 3, 'C10: on relation=received, primary is NOT counted (field disabled there) — priority+category+creator = 3');
  pass(T.taskListFilterCount(f, 'managed') === 4, 'C11: on relation=managed, primary DOES count — priority+category+creator+primary = 4');
})();

/* ---- C. Filter V1 — panel open/apply/clear round-trip ---- */
(function () {
  const st = T.getState();
  st.list = Object.assign(T.defaultTaskListState(), { relation: 'managed' });
  const root = { querySelector: () => null }; // renderTaskRoot no-ops safely without a real DOM root in these state-only checks
  T.openTaskListFilterPanel(root);
  pass(st.list.filterOpen === true, 'C12: openTaskListFilterPanel sets filterOpen=true');
  pass(JSON.stringify(st.list.filterDraft) === JSON.stringify(T.defaultTaskListFilters()), 'C13: filterDraft starts as a copy of the current (empty) filters');

  st.list.filterDraft.priority = 'khan_cap';
  st.list.filterDraft.creator = 'PHF010';
  T.applyTaskListFilters(root);
  pass(st.list.filterOpen === false, 'C14: applyTaskListFilters closes the panel');
  pass(st.list.filters.priority === 'khan_cap' && st.list.filters.creator === 'PHF010', 'C15: applyTaskListFilters commits the draft into the real filters');

  T.clearTaskListFilters(root);
  pass(JSON.stringify(st.list.filters) === JSON.stringify(T.defaultTaskListFilters()), 'C16: clearTaskListFilters resets to defaults ("Xóa lọc")');
  pass(st.list.filterOpen === false, 'C17: clearTaskListFilters also closes the panel');
})();

/* ---- C. Filter panel HTML — button badge + panel fields per workspace ---- */
(function () {
  const st = T.getState();
  st.list = Object.assign(T.defaultTaskListState(), { relation: 'managed', filters: { priority: 'khan_cap', category: '', creator: '', primary: '', deadlineFrom: '', deadlineTo: '' } });
  let btn = T.taskListFilterButtonHtml();
  pass(/phft-lf-count">1</.test(btn), 'C18: button shows active-count badge "1"');
  pass(/Xóa lọc/.test(btn), 'C19: inline "Xóa lọc" appears next to the button when count>0');

  st.list.filters = T.defaultTaskListFilters();
  btn = T.taskListFilterButtonHtml();
  pass(!/phft-lf-count/.test(btn), 'C20: no badge when count=0');
  pass(!/data-task-list-filter-clear/.test(btn), 'C21: no inline "Xóa lọc" when count=0');

  st.list.filterOpen = true;
  st.list.filterDraft = T.defaultTaskListFilters();
  st.list.filterPeople = { loading: false, loaded: true, rows: [{ code: 'PHF010', name: 'Nguyễn Văn A' }] };
  const panel = T.taskListFilterPanelHtml();
  pass(/Ưu tiên/.test(panel) && /Danh mục/.test(panel) && /Deadline từ ngày/.test(panel) && /Đến ngày/.test(panel), 'C22: managed panel renders priority/category/deadline-range fields');
  pass(/Người giao/.test(panel) && /Người phụ trách/.test(panel), 'C23: managed panel renders BOTH creator and primary fields');
  pass(/Áp dụng/.test(panel) && /Đóng/.test(panel), 'C24: panel has Apply + Close actions');

  st.list.relation = 'received';
  const panelReceived = T.taskListFilterPanelHtml();
  pass(/Người giao/.test(panelReceived), 'C25: received panel still shows "Người giao" (creator)');
  pass(!/Người phụ trách/.test(panelReceived), 'C26: received panel omits "Người phụ trách" (Primary is always the actor there)');

  st.list.relation = 'assigned';
  const panelAssigned = T.taskListFilterPanelHtml();
  pass(!/Người giao/.test(panelAssigned), 'C27: assigned panel omits "Người giao" (creator is always the actor there)');
  pass(/Người phụ trách/.test(panelAssigned), 'C28: assigned panel shows "Người phụ trách" (Primary)');

  st.list.filterOpen = false;
  pass(T.taskListFilterPanelHtml() === '', 'C29: panel renders nothing at all when closed (no stray markup)');
})();

/* ---- rework control genuinely removed from the real status-tab map ---- */
(function () {
  pass(!('rework' in T.TASK_STATUS_TAB_LABELS_MANAGED), 'REWORK1: "rework" key is gone from TASK_STATUS_TAB_LABELS_MANAGED');
  pass(Object.keys(T.TASK_STATUS_TAB_LABELS_MANAGED).length === 5, 'REWORK2: managed status tabs = 5 (Tất cả + 4 real buckets)');
  pass('cancelled' in T.TASK_STATUS_TAB_LABELS_MANAGED, 'REWORK3: "cancelled" tab stays and is real (backend-supported) — see backend mock harness for WHERE-clause proof');
})();

console.log('PHF Task List Usability UI V1 (jsdom): ' + passed + '/' + passed + ' PASS');
