'use strict';
/* PHF Task — UI/UX Step 6 Calendar month-view visual contract (frontend).
   Loads assets/js/task/phf-task-app.js in jsdom, asserts the presentation
   contract: only Month view, 7-cell weekday header, fixed equal-size day
   cells (task content cannot stretch a row), compact truncated task chips,
   bounded "+N công việc" overflow, today / outside-month markers, no
   role-specific calendar renderer. No backend, no network, no mutation. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'assets', 'js', 'task', 'phf-task-app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets', 'css', 'phf-task.css'), 'utf8');

const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/admin/task/lich' });
const { window } = dom;
window.__PHF_TASK_TEST_MODE__ = true;
window.phfGetSessionRole = () => 'admin';
window.phfGetCurrentUser = () => ({ fullName: 'Test Admin', email: 'admin@test' });
window.phfNavigate = () => {};
window.phfToast = () => {};
window.eval(code);
const T = window.__PHF_TASK_TEST__;
assert.ok(T, 'test hook window.__PHF_TASK_TEST__ must be exposed');

let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }

const isoIn = (days, h) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h || 9, 0, 0, 0); return d.toISOString(); };
const mkTask = (i, days) => ({
  task_id: 't' + i, task_code: 'CV-' + i,
  title: 'Công việc rất dài cần được cắt ngắn trong ô ngày ' + i,
  status: 'in_progress', priority: 'thuong', deadline: isoIn(days, 8 + (i % 6)),
  primary: { full_name: 'NV ' + i }, created_by: { full_name: 'QL' },
});

/* ---- 1) Month is the only view ---- */
{
  const state = T.getState();
  state.view = 'calendar';
  const html = T.taskCalendarHtml();
  pass(!/data-task-cal-view="(week|day|list)"/.test(html), 'VIEW: no Week/Day/List placeholder buttons');
  pass(!/sắp có/.test(html), 'VIEW: no "sắp có" roadmap text');
  pass(/Xem theo tháng/.test(html), 'VIEW: static month indicator present');
}

/* ---- 2) weekday header — exactly 7 cells, Mon..Sun ---- */
{
  const html = T.taskCalendarMonthGridHtml([]);
  const wd = html.match(/<div class="phft-cal-weekdays">([\s\S]*?)<\/div>/)[1];
  pass((wd.match(/<span>/g) || []).length === 7, 'WEEKDAY: header row has exactly 7 cells');
  pass(/<span>Thứ 2<\/span>[\s\S]*<span>Chủ nhật<\/span>/.test(wd), 'WEEKDAY: Monday first, Sunday last');
  // Sat/Sun differentiation is done in CSS via :nth-child (no markup change)
  pass(/\.phft-cal-weekdays span:nth-child\(6\)\{[^}]*color:var\(--phft-blue\)/.test(css), 'WEEKDAY: Saturday gets a blue cue (CSS nth-child(6))');
  pass(/\.phft-cal-weekdays span:nth-child\(7\)\{[^}]*color:#b93b3b/.test(css), 'WEEKDAY: Sunday gets a restrained red cue (CSS nth-child(7))');
}

/* ---- 3) HARD LOCK — day cells are a fixed equal size ---- */
{
  pass(/\.phft-cal-grid\{[^}]*grid-auto-rows:128px/.test(css), 'GEOMETRY: .phft-cal-grid uses a fixed grid-auto-rows');
  pass(/\.phft-cal-day\{[^}]*height:128px[^}]*overflow:hidden/.test(css), 'GEOMETRY: .phft-cal-day has a fixed height + overflow:hidden (content cannot stretch it)');
  pass(/\.phft-cal-events\{[^}]*overflow-y:auto/.test(css), 'GEOMETRY: the events area scrolls INSIDE the fixed cell');
  // an "expanded" day must not add height — it only removes the slice; CSS clips
  const state = T.getState();
  state.calendar = Object.assign(T.defaultTaskCalendarState(), {});
  const many = [];
  for (let i = 1; i <= 9; i++) many.push(mkTask(i, 3));
  const collapsed = T.taskCalendarMonthGridHtml(many);
  state.calendar.expandedDay = null;
  const c1 = (collapsed.match(/height:128px|grid-auto-rows:128px/g) || []); // sanity: css-driven, markup unchanged
  pass(/class="phft-cal-day/.test(collapsed), 'GEOMETRY: day markup unchanged (size is CSS-owned, not inline per-day)');
  pass(!/style="[^"]*height/.test(collapsed), 'GEOMETRY: no inline per-day height that could vary by task count');
}

/* ---- 4) task chip is compact + truncated ---- */
{
  const html = T.taskCalendarMonthGridHtml([mkTask(1, 2)]);
  pass(/class="phft-cal-event [^"]*"[^>]*>/.test(html) && /<span>Công việc rất dài/.test(html), 'CHIP: task title rendered inside a .phft-cal-event chip');
  pass(/\.phft-cal-event span\{[^}]*white-space:nowrap[^}]*\}/.test(css) && /text-overflow:ellipsis/.test(css.match(/\.phft-cal-event span\{[^}]*\}/)[0]), 'CHIP: chip text truncates (nowrap + ellipsis), it does not wrap/grow');
}

/* ---- 5) bounded overflow indicator "+N công việc" ---- */
{
  const many = [];
  for (let i = 1; i <= 7; i++) many.push(mkTask(i, 4));
  const state = T.getState();
  state.calendar = Object.assign(T.defaultTaskCalendarState(), {});
  const html = T.taskCalendarMonthGridHtml(many);
  pass(/data-task-cal-expand-day="[^"]+">\+4 công việc<\/button>/.test(html), 'OVERFLOW: shows "+N công việc" once past the visible limit (7 entries, 3 shown → +4)');
  pass((html.match(/class="phft-cal-event /g) || []).length === 3, 'OVERFLOW: only the first 3 chips render in the collapsed cell');
}

/* ---- 6) today + outside-month markers, count badge ---- */
{
  const html = T.taskCalendarMonthGridHtml([mkTask(1, 0)]);
  pass(/class="phft-cal-day[^"]*is-today/.test(html), 'TODAY: today cell marked .is-today');
  pass(/<small>Hôm nay<\/small>/.test(html), 'TODAY: "Hôm nay" label present');
  pass((html.match(/is-outside/g) || []).length > 0, 'OUTSIDE: previous/next-month days keep .is-outside (same cell size)');
  pass(/class="phft-cal-count"[^>]*>1<\/span>/.test(html), 'SIGNAL: a day with tasks shows a compact count badge');
  pass(/class="phft-cal-day[^"]*has-tasks/.test(html), 'SIGNAL: a day with tasks gets .has-tasks (styled, not resized)');
}

/* ---- 7) no role-specific calendar renderer ---- */
{
  pass(!/function taskCalendar\w*Admin|function taskCalendar\w*Tbp|function taskCalendar\w*Manager/i.test(code), 'ROLE: single shared calendar renderer — no role-specific variant');
}

/* ---- 8) KPI strip stays real + semantic ---- */
{
  const html = T.taskCalendarHtml();
  ['Quá hạn', 'Hôm nay', 'Sắp tới hạn', 'Chưa bắt đầu'].forEach(l => pass(html.includes('<span>' + l + '</span>'), 'KPI: real metric kept — ' + l));
  pass(/phft-cal-summary-tile is-overdue tone-red/.test(html), 'KPI: Quá hạn tile → red tone');
  pass(/phft-cal-summary-tile is-soon tone-orange/.test(html), 'KPI: Sắp tới hạn tile → orange tone');
}

console.log('PHF Task — Calendar month-view visual contract (Step 6): ' + passed + '/' + passed + ' PASS');
