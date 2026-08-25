'use strict';

/*
 * PHF Task — CALENDAR FOUNDATION V1 (+ V1.1 start_at contract completion) —
 * static/behavioral assertions, jsdom, no network, no real DB. Loads the
 * REAL production file via window.eval (same harness pattern as
 * scripts/test-task-cancel-v4.js / test-task-progress-ui-g12b.js). Covers:
 * month grid generation (Monday-first, 42 cells, muted outside days, today
 * marker), deadline-based date mapping, overdue classification parity with
 * the existing Task List rule, scope/filter payload mapping, task-click open
 * behavior (quick panel + real Task Detail, no second detail implementation),
 * and — source-level, since this file has no real-DB harness — that
 * listTasks() in api/_lib/task-core.js actually returns start_at alongside
 * every field it returned before (V1.1: start_at was fetched via select('*')
 * but dropped from the row mapping; now added back, purely additively).
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

function newWindow() {
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/admin/task' });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = function () { return 'admin'; };
  window.phfGetCurrentUser = function () { return { fullName: 'Demo QA', employeeCode: 'DEMO_QA' }; };
  window.phfNavigate = function () { };
  window.phfToast = function () { };
  window.fetch = function () { throw new Error('unstubbed fetch() call'); };
  window.eval(TASK_APP_SRC);
  return window;
}
function click(window, root, selector) {
  const el = root.querySelector(selector);
  assert.ok(el, 'click target must exist: ' + selector);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}
function isoAt(daysFromNow, hour) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour == null ? 10 : hour, 0, 0, 0);
  return d.toISOString();
}

(async () => {
  // ---- A. Route wiring ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    pass(T.taskCalendarPath() === '/admin/task/lich', 'A1: calendar path resolves under current role home');
    const route = T.parseTaskRoute('/admin/task/lich');
    pass(route.view === 'calendar', 'A2: parseTaskRoute recognizes the calendar path');
  }

  // ---- B. Month grid shape: Monday-first, 42 cells, today marker ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const state = T.getState();
    const cal = state.calendar;
    const html = T.taskCalendarMonthGridHtml([]);
    pass(html.includes('Thứ 2') && html.includes('Chủ nhật'), 'B1: weekday header present, Monday first');
    const weekdayOrder = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
    let lastIdx = -1, orderOk = true;
    weekdayOrder.forEach(label => { const idx = html.indexOf('<span>' + label + '</span>'); if (idx <= lastIdx) orderOk = false; lastIdx = idx; });
    pass(orderOk, 'B2: weekday labels appear in Mon..Sun order');
    const cellCount = (html.match(/class="phft-cal-day/g) || []).length;
    pass(cellCount === 42, 'B3: month grid renders exactly 42 day cells (6 full weeks)');
    pass(html.includes('is-today'), 'B4: today cell is marked (test runs on a real "today")');
    pass((html.match(/is-outside/g) || []).length > 0, 'B5: prior/next-month days are muted (is-outside present for a non-Jan-1-anchored month)');
  }

  // ---- C. Deadline-based date mapping; no start_at rendering ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const task = { task_id: 't1', task_code: 'CV-1', title: 'Fixture A', status: 'published', deadline: isoAt(2), priority: 'thuong', progress_percent: 0, primary: { full_name: 'A' }, created_by: { full_name: 'B' } };
    const html = T.taskCalendarMonthGridHtml([task]);
    pass(html.includes('data-task-cal-open="t1"'), 'C1: task with a deadline is placed on the calendar');
    const noDate = { task_id: 't2', task_code: 'CV-2', title: 'No date', status: 'published', deadline: null };
    const html2 = T.taskCalendarMonthGridHtml([task, noDate]);
    pass(!html2.includes('data-task-cal-open="t2"'), 'C2: task without any usable date is excluded, not invented a date for');
  }

  // ---- D. Overdue classification parity with the Task List rule ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const overdueTask = { status: 'in_progress', deadline: isoAt(-1) };
    const futureTask = { status: 'in_progress', deadline: isoAt(5) };
    const completedPastTask = { status: 'completed', deadline: isoAt(-3) };
    const draftPastTask = { status: 'draft', deadline: isoAt(-3) };
    pass(T.taskCalendarIsOverdue(overdueTask) === true, 'D1: active status + past deadline => overdue');
    pass(T.taskCalendarIsOverdue(futureTask) === false, 'D2: active status + future deadline => not overdue');
    pass(T.taskCalendarIsOverdue(completedPastTask) === false, 'D3: completed status excluded from overdue even if deadline passed (matches Task List rule)');
    pass(T.taskCalendarIsOverdue(draftPastTask) === false, 'D4: draft status excluded from overdue (matches Task List rule)');
    pass(T.taskCalendarVariant({ status: 'completed', deadline: isoAt(-3) }, '2000-01-01') === 'completed', 'D5: completed variant regardless of deadline');
    pass(T.taskCalendarVariant({ status: 'cancelled', deadline: isoAt(-3) }, '2000-01-01') === 'cancelled', 'D6: cancelled variant regardless of deadline');
    pass(T.taskCalendarVariant(overdueTask, '2000-01-01') === 'overdue', 'D7: overdue variant matches isOverdue');
    pass(T.taskCalendarVariant({ status: 'published', deadline: null }, '2000-01-01') === 'not_started', 'D8: published with no deadline => not_started');
  }

  // ---- E. Summary counts derive from the same loaded/filtered dataset ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const todayKey = T.taskCalendarDateKey(new Date());
    const rows = [
      { status: 'in_progress', deadline: isoAt(-1) },   // overdue
      { status: 'in_progress', deadline: isoAt(0) },     // due today
      { status: 'in_progress', deadline: isoAt(2) },     // due soon (<=3 days)
      { status: 'published', deadline: isoAt(20) },       // not_started (far future, still published)
      { status: 'completed', deadline: isoAt(-5) }        // completed, not counted in any attention bucket
    ];
    const counts = T.taskCalendarSummaryCounts(rows, todayKey);
    pass(counts.overdue === 1, 'E1: overdue count = 1');
    pass(counts.today === 1, 'E2: due-today count = 1');
    pass(counts.soon === 1, 'E3: due-soon count = 1');
    pass(counts.not_started === 1, 'E4: not-started count = 1');
  }

  // ---- F. Scope/filter mapping: "Nhân sự tôi quản lý" maps to relation=received + scope=managed ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const state = T.getState();
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    state.view = 'calendar'; state.calendar.relation = 'managed';
    let captured = null;
    window.fetch = function (url, options) {
      captured = JSON.parse(options.body);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: { tasks: [] } }) });
    };
    await T.loadTaskCalendar(root);
    pass(!!captured, 'F1: calendar load triggered a real listTasks call');
    pass(captured.action === 'listTasks', 'F2: action=listTasks (reuses the existing read path, no new backend action)');
    pass(captured.relation === 'received', 'F3: relation="managed" (UI) maps to backend relation="received" (the real listTasks contract)');
    pass(captured.scope === 'managed', 'F4: scope="managed" carries the manager-scope expansion, matching resolveEffectiveTaskScope()');
  }
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const state = T.getState();
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    state.view = 'calendar'; state.calendar.relation = 'assigned';
    let captured = null;
    window.fetch = function (url, options) { captured = JSON.parse(options.body); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: { tasks: [] } }) }); };
    await T.loadTaskCalendar(root);
    pass(captured.relation === 'assigned', 'F5: relation="assigned" passes through unchanged (already a valid backend relation)');
    pass(captured.scope === undefined, 'F6: no scope param sent for non-managed relations');
  }

  // ---- G. Task click opens a quick panel with "Mở phiếu" -> real Task Detail (no second detail impl) ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const state = T.getState();
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    const task = { task_id: 'tq1', task_code: 'CV-Q1', title: 'Quick panel fixture', status: 'in_progress', deadline: isoAt(1), priority: 'khan_cap', progress_percent: 40, primary: { full_name: 'Nguyen Van A' }, created_by: { full_name: 'Tran Thi B' } };
    state.view = 'calendar'; state.calendar.tasks = [task];
    root.innerHTML = T.shellFrame(T.taskCalendarHtml());
    T.bindShell(root);
    click(window, root, '[data-task-cal-open="tq1"]');
    root.innerHTML = T.shellFrame(T.taskCalendarHtml());
    T.bindShell(root);
    pass(state.calendar.quickTaskId === 'tq1', 'G1: clicking a calendar chip opens the quick panel for that task');
    pass(root.innerHTML.includes('Quick panel fixture') && root.innerHTML.includes('Mở phiếu'), 'G2: quick panel shows task summary and an "Mở phiếu" action');
    let navigatedTo = '';
    window.phfNavigate = function (p) { navigatedTo = p; };
    click(window, root, '[data-task-cal-open-detail="tq1"]');
    pass(navigatedTo === T.taskDetailPath('tq1'), 'G3: "Mở phiếu" navigates to the EXISTING real Task Detail route, not a second detail implementation');
    pass(state.calendar.quickTaskId === '', 'G4: quick panel closes after navigating to detail');
  }

  // ---- H. Week/Day/List are clearly placeholder, not silently "working" ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const state = T.getState();
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    state.view = 'calendar';
    let toasted = '';
    window.phfToast = function (type, title, msg) { toasted = msg; };
    root.innerHTML = T.shellFrame(T.taskCalendarHtml());
    T.bindShell(root);
    pass(root.innerHTML.includes('data-task-cal-view="week"') && root.innerHTML.includes('sắp có'), 'H1: Week view button present and labeled as not-yet-implemented');
    click(window, root, '[data-task-cal-view="week"]');
    pass(!!toasted, 'H2: clicking a placeholder view surfaces a real "not implemented" notice instead of silently doing nothing or faking a view');
    pass(state.calendar.view === 'month', 'H3: view state stays on month — placeholder click never switches into a fake/broken view');
  }

  // ---- I. Backend contract (source-level, no live DB harness in this file):
  // listTasks() row mapping returns start_at, and every field it returned
  // before this gate is still present (purely additive change). ----
  {
    const coreSource = readSrc('api/_lib/task-core.js');
    const mapStart = coreSource.indexOf('const tasks = taskRows.map(t => {');
    assert.ok(mapStart >= 0, 'I0: listTasks() row-mapping block must exist in task-core.js');
    const mapEnd = coreSource.indexOf('});', mapStart);
    const mapBlock = coreSource.slice(mapStart, mapEnd);
    pass(/start_at:\s*t\.start_at/.test(mapBlock), 'I1: listTasks() row mapping includes start_at: t.start_at');
    ['task_id: t.id', 'task_code: t.task_code', 'title: t.title', 'flow_type: t.flow_type', 'status: t.status', 'priority: t.priority', 'deadline: t.deadline', 'category_code: t.category_code', 'progress_percent: t.progress_percent', 'progress_status: t.progress_status', 'is_cross_department: t.is_cross_department', 'source_department: t.source_department', 'target_department: t.target_department', 'row_version: t.row_version'].forEach(field => {
      pass(mapBlock.includes(field), 'I2: pre-existing field preserved — ' + field);
    });
    pass(mapBlock.includes("select('*')") === false, 'I3 sanity: mapBlock slice is the mapping body, not the query builder (no select(\'*\') text bled in)');
  }

  console.log(`PHF Task Calendar Foundation V1 test: ${passed}/${passed} PASS`);
})().catch(err => { console.error('FAIL', err); process.exit(1); });
