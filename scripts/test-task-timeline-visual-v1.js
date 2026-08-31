'use strict';
/* PHF Task — UI/UX Step 7 Timeline operational-polish visual contract.
   jsdom, no backend. Asserts: day grouping + count, timeline rail dot,
   actor/verb/task-code/title hierarchy, action tone mapping, before→after
   diff line (only when real payload fields exist), unknown-event neutral
   fallback, labelled filters, whole-row → Task detail nav preserved,
   no scope/order change. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'assets', 'js', 'task', 'phf-task-app.js'), 'utf8');

const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/admin/task/dong-thoi-gian' });
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

const at = (offsetMs) => new Date(Date.now() - offsetMs).toISOString();
const ev = (o) => Object.assign({
  id: 'e1', task_id: 'task-1', task_code: 'CV-2608-0287', task_title: 'Tổng hợp công việc cuối tuần',
  actor: { full_name: 'Trần Gia Bảo Ngọc', employee_code: 'PHF082' },
  event_type: 'published', payload: {}, occurred_at: at(0),
}, o || {});

/* ---- 1) day grouping + count + label ---- */
{
  const events = [
    ev({ id: 'a', occurred_at: at(1000) }),
    ev({ id: 'b', occurred_at: at(2000) }),
    ev({ id: 'c', occurred_at: at(26 * 3600e3) }), // yesterday
  ];
  const html = T.taskTimelineGroupedHtml(events);
  pass(/phft-timeline-day-label"><span>Hôm nay<\/span><span class="phft-tl-day-count">2 hoạt động<\/span>/.test(html), 'DAY GROUP: "Hôm nay" header with a quiet "2 hoạt động" count');
  pass(/<span>Hôm qua<\/span><span class="phft-tl-day-count">1 hoạt động<\/span>/.test(html), 'DAY GROUP: "Hôm qua" header with a quiet "1 hoạt động" count');
  pass(html.indexOf('Hôm nay') < html.indexOf('Hôm qua'), 'DAY GROUP: newest group first (order preserved, never re-sorted)');
}

/* ---- 2) timeline rail + tone dot ---- */
{
  const html = T.taskTimelineItemHtml(ev({ event_type: 'transfer', payload: { from_employee_code: 'PHF082', to_employee_code: 'PHF073' } }));
  pass(/<span class="phft-tl-rail"><i class="phft-tl-dot"><\/i><\/span>/.test(html), 'RAIL: each event has a rail with a dot');
  pass(/class="phft-tl-item tone-purple"/.test(html), 'TONE: transfer (people change) → purple');
}
{
  pass(/tone-blue/.test(T.taskTimelineItemHtml(ev({ event_type: 'published' }))), 'TONE: published/assign → blue');
  pass(/tone-orange/.test(T.taskTimelineItemHtml(ev({ event_type: 'deadline_change' }))), 'TONE: deadline change → orange');
  pass(/tone-green/.test(T.taskTimelineItemHtml(ev({ event_type: 'completion' }))), 'TONE: completion → green');
  pass(/tone-red/.test(T.taskTimelineItemHtml(ev({ event_type: 'cancel' }))), 'TONE: cancel → red');
  pass(/tone-gray/.test(T.taskTimelineItemHtml(ev({ event_type: 'comment' }))), 'TONE: comment/note → neutral gray');
  pass(/tone-gray/.test(T.taskTimelineItemHtml(ev({ event_type: 'some_future_type' }))), 'TONE: unknown event_type → honest neutral gray (no invented meaning)');
}

/* ---- 3) row hierarchy: actor / verb / code / title on their own elements ---- */
{
  const html = T.taskTimelineItemHtml(ev({ event_type: 'transfer', payload: { from_employee_code: 'PHF082', to_employee_code: 'PHF073' } }));
  pass(/<b class="phft-tl-actor">Trần Gia Bảo Ngọc<\/b>/.test(html), 'HIERARCHY: actor in its own bold element');
  pass(/<span class="phft-tl-verb">đã chuyển người phụ trách<\/span>/.test(html), 'HIERARCHY: humanised verb in its own element');
  pass(/<b class="phft-tl-code">CV-2608-0287<\/b>/.test(html), 'HIERARCHY: task code in its own accent element');
  pass(/<span class="phft-tl-title">Tổng hợp công việc cuối tuần<\/span>/.test(html), 'HIERARCHY: task title on its own line (not one long sentence)');
  pass(html.indexOf('phft-tl-act') < html.indexOf('phft-tl-task'), 'HIERARCHY: "actor did what" line renders above the task identity line');
}

/* ---- 4) before → after diff line, ONLY from real payload ---- */
{
  pass(/phft-tl-diff">25%<i>→<\/i>60%<\/span>/.test(T.taskTimelineMetadataHtml(ev({ event_type: 'progress', payload: { old_percent: 25, new_percent: 60 } }))), 'DIFF: progress 25% → 60% from payload');
  pass(/phft-tl-diff">PHF082<i>→<\/i>PHF073<\/span>/.test(T.taskTimelineMetadataHtml(ev({ event_type: 'transfer', payload: { from_employee_code: 'PHF082', to_employee_code: 'PHF073' } }))), 'DIFF: primary PHF082 → PHF073');
  pass(/phft-tl-diff">Thường<i>→<\/i>Quan trọng<\/span>/.test(T.taskTimelineMetadataHtml(ev({ event_type: 'priority_change', payload: { old_priority: 'thuong', new_priority: 'quan_trong' } }))), 'DIFF: priority humanised via existing TASK_PRIORITY_LABELS');
  pass(T.taskTimelineMetadataHtml(ev({ event_type: 'progress', payload: {} })) === '', 'DIFF: no payload fields → no fabricated diff (empty string)');
  pass(/phft-tl-reason">Lý do: Khách yêu cầu lùi lịch<\/span>/.test(T.taskTimelineMetadataHtml(ev({ event_type: 'deadline_change', reason: 'Khách yêu cầu lùi lịch', payload: {} }))), 'DIFF: free-text reason rendered as muted secondary text');
}

/* ---- 5) labelled filters, scope preserved ---- */
{
  const state = T.getState(); state.view = 'timeline';
  const html = T.taskTimelineHtml();
  pass(/phft-tl-filter"><span>Phạm vi<\/span>/.test(html) && /data-task-timeline-relation/.test(html), 'FILTER: scope filter kept, now labelled "Phạm vi"');
  pass(/phft-tl-filter"><span>Loại hoạt động<\/span>/.test(html) && /data-task-timeline-activity/.test(html), 'FILTER: activity-type filter kept, labelled "Loại hoạt động"');
  pass(!/type="search"|data-task-timeline-search/.test(html), 'FILTER: no client-only search over the partial (limit 150) event population');
}

/* ---- 6) whole-row navigation to the EXISTING Task detail ---- */
{
  const state = T.getState();
  const root2 = window.document.getElementById('phfTaskRoot');
  T.bindShell(root2);
  state.view = 'timeline'; state.timeline.events = [ev({ task_id: 'go-here' })];
  root2.innerHTML = T.shellFrame(T.taskTimelineHtml());
  T.bindShell(root2);
  let navTo = '';
  window.phfNavigate = (p) => { navTo = p; };
  const li = root2.querySelector('[data-task-timeline-open="go-here"]');
  li.click();
  pass(navTo === T.taskDetailPath('go-here'), 'NAV: clicking a timeline row opens the existing real Task detail route (no second detail engine)');
}

/* ---- 7) empty + missing-actor still render ---- */
{
  pass(T.taskTimelineGroupedHtml([]).includes('Chưa có hoạt động công việc phù hợp'), 'EMPTY: message stays inside the activity panel');
  pass(T.taskTimelineItemHtml(ev({ actor: { employee_code: 'PHF099', full_name: '' } })).includes('PHF099'), 'FALLBACK: actor falls back to employee_code when name is empty');
}

console.log('PHF Task — Timeline operational-polish visual contract (Step 7): ' + passed + '/' + passed + ' PASS');
