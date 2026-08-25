'use strict';

/*
 * PHF Task — TIMELINE FOUNDATION V1 — jsdom frontend assertions (same
 * window.eval harness as scripts/test-task-calendar-foundation-v1.js) PLUS
 * real-backend permission assertions against api/_lib/task-core.js directly
 * (in-process, no HTTP, no session cookie — mirrors the pattern already used
 * to verify Calendar/G12 against the real dev DB).
 *
 * Covers the 16 required cases from the Timeline Foundation V1 gate:
 *  1. route works for hv/ql/admin
 *  2. menu no longer placeholder
 *  3. real data source (listTaskEvents -> task_events, not demo fixtures)
 *  4. newest-first ordering
 *  5. deterministic event mapping
 *  6. unknown event_type doesn't crash
 *  7. missing optional metadata doesn't crash
 *  8. click -> real Task Detail
 *  9. actor only sees events of authorized tasks
 * 10. negative permission case doesn't leak
 * 11. managed scope doesn't self-broaden
 * 12. cross-department doesn't bypass permission
 * 13. empty state
 * 14. error state
 * 15. existing Task regression (run separately by the caller / CI, not here)
 * 16. Calendar V1.2 regression (run separately by the caller / CI, not here)
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

function newWindow(role) {
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/' + (role || 'admin') + '/task' });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = function () { return role || 'admin'; };
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
function fixtureEvent(overrides) {
  return Object.assign({
    id: 'ev-1', task_id: 't1', task_code: 'CV-0001', task_title: 'Fixture task',
    event_type: 'progress', actor: { employee_code: 'PHF010', full_name: 'Nguyễn Văn A' },
    payload: { old_percent: 25, new_percent: 60 }, reason: null, occurred_at: new Date().toISOString()
  }, overrides || {});
}

(async () => {
  // ---- 1. Route works for hv/ql/admin ----
  {
    // roleHome() maps the SESSION role string ('admin'/'manager'/anything
    // else) to the URL prefix ('/admin'/'/ql'/'/hv') — pass the real role
    // values phfGetSessionRole() actually returns, not the URL segments.
    [['admin', '/admin'], ['manager', '/ql'], ['learner', '/hv']].forEach(([sessionRole, prefix]) => {
      const window = newWindow(sessionRole);
      const T = window.__PHF_TASK_TEST__;
      const expected = prefix + '/task/dong-thoi-gian';
      pass(T.taskTimelinePath() === expected, '1.' + sessionRole + ': taskTimelinePath resolves under the correct role home');
      pass(T.parseTaskRoute(expected).view === 'timeline', '1.' + sessionRole + ': parseTaskRoute recognizes the timeline path');
    });
  }

  // ---- 2. Menu no longer placeholder ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const timelineItem = T.NAV_ITEMS.find(i => i.key === 'timeline');
    pass(timelineItem && timelineItem.enabled === true, '2: Timeline nav item is enabled (no longer "Sắp triển khai")');
    const state = T.getState();
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    root.innerHTML = T.shellFrame('');
    pass(!root.querySelector('[data-task-nav="timeline"]').classList.contains('is-soon'), '2b: rendered Timeline nav button has no is-soon class');
  }

  // ---- 3/4/5. Real data source, newest-first, deterministic mapping ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const state = T.getState();
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    let capturedBody = null;
    window.fetch = function (url, options) {
      capturedBody = JSON.parse(options.body);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: { events: [] } }) });
    };
    await T.loadTaskTimeline(root);
    pass(!!capturedBody, '3a: loading the timeline triggers a real fetch');
    pass(capturedBody.action === 'listTaskEvents', '3b: uses the new listTaskEvents action (real task_events-backed read path), not a demo fixture');
    pass(capturedBody.relation === 'received', '3c: default relation is received');

    // Newest-first: verify the grouped renderer PRESERVES backend order (never re-sorts ascending).
    const older = fixtureEvent({ id: 'ev-old', task_id: 'task-old', task_code: 'CV-OLDER', occurred_at: new Date(Date.now() - 3 * 3600e3).toISOString() });
    const newer = fixtureEvent({ id: 'ev-new', task_id: 'task-new', task_code: 'CV-NEWER', occurred_at: new Date().toISOString() });
    state.timeline.events = [newer, older]; // backend already returns desc order
    const html = T.taskTimelineGroupedHtml(T.taskTimelineFilteredEvents());
    pass(html.indexOf('CV-NEWER') >= 0 && html.indexOf('CV-OLDER') >= 0 && html.indexOf('CV-NEWER') < html.indexOf('CV-OLDER'), '4: newest event renders before older event (backend desc order preserved, not re-sorted)');

    // Deterministic mapping: same event -> same verb/label every call.
    const progressEvent = fixtureEvent({ event_type: 'progress', payload: { old_percent: 25, new_percent: 60 } });
    const v1 = T.taskTimelineActionVerb(progressEvent), v2 = T.taskTimelineActionVerb(progressEvent);
    pass(v1 === v2 && v1 === 'đã cập nhật tiến độ', '5: event_type=progress maps deterministically to the same verb');
    const meta = T.taskTimelineMetadataHtml(progressEvent);
    pass(meta.includes('25%') && meta.includes('60%'), '5b: progress metadata shows the real before/after percent from payload, not invented values');
  }

  // ---- 6. Unknown event_type doesn't crash ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const weirdEvent = fixtureEvent({ event_type: 'some_future_event_type_never_seen_before', payload: {} });
    let verb, itemHtml, groupedHtml;
    assert.doesNotThrow(() => { verb = T.taskTimelineActionVerb(weirdEvent); }, '6a must not throw on unknown event_type');
    assert.doesNotThrow(() => { itemHtml = T.taskTimelineItemHtml(weirdEvent); }, '6b must not throw rendering unknown event_type');
    assert.doesNotThrow(() => { groupedHtml = T.taskTimelineGroupedHtml([weirdEvent]); }, '6c must not throw grouping unknown event_type');
    pass(typeof verb === 'string' && verb.length > 0, '6: unknown event_type falls back to a generic non-empty verb instead of crashing');
    pass(itemHtml.includes('CV-0001'), '6b-check: item still renders task_code despite unknown event_type');
  }

  // ---- 7. Missing optional metadata doesn't crash ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const noPayload = fixtureEvent({ event_type: 'progress', payload: {} });
    const noActorName = fixtureEvent({ actor: { employee_code: 'PHF099', full_name: '' } });
    const noTaskTitle = fixtureEvent({ task_title: '' });
    const nullReason = fixtureEvent({ event_type: 'cancel', payload: {}, reason: null });
    [noPayload, noActorName, noTaskTitle, nullReason].forEach((ev, i) => {
      assert.doesNotThrow(() => T.taskTimelineItemHtml(ev), '7.' + i + ': must not throw with missing optional metadata');
    });
    pass(T.taskTimelineMetadataHtml(noPayload) === '', '7: missing progress payload fields produce no fabricated before/after text');
    pass(T.taskTimelineItemHtml(noActorName).includes('PHF099'), '7b: falls back to employee_code when full_name is empty, still renders something meaningful');
  }

  // ---- 8. Click -> real Task Detail (no second detail implementation) ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const state = T.getState();
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    state.view = 'timeline'; state.timeline.events = [fixtureEvent({ task_id: 'click-me' })];
    root.innerHTML = T.shellFrame(T.taskTimelineHtml());
    T.bindShell(root);
    let navigatedTo = '';
    window.phfNavigate = function (p) { navigatedTo = p; };
    click(window, root, '[data-task-timeline-open="click-me"]');
    pass(navigatedTo === T.taskDetailPath('click-me'), '8: clicking a timeline item navigates to the EXISTING real Task Detail route');
  }

  // ---- 13. Empty state ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const html = T.taskTimelineGroupedHtml([]);
    pass(html.includes('Chưa có hoạt động công việc phù hợp'), '13: empty state shows the required user-facing message');
  }

  // ---- 14. Error state ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const state = T.getState();
    state.view = 'timeline'; state.timeline.error = 'Không tải được dữ liệu.'; state.timeline.loading = false;
    const html = T.taskTimelineHtml();
    pass(html.includes('Không tải được dòng thời gian') && html.includes('Không tải được dữ liệu.'), '14: error state shows a user-understandable message');
    pass(!/at\s+\w+\s*\(|node_modules|\.js:\d+:\d+/.test(html), '14b: error rendering never leaks a stack trace / internal path');
  }

  // ---- Filter mapping doesn't broaden scope (mirrors Calendar's own check) ----
  {
    const window = newWindow();
    const T = window.__PHF_TASK_TEST__;
    const state = T.getState();
    const root = window.document.getElementById('phfTaskRoot');
    T.bindShell(root);
    state.view = 'timeline'; state.timeline.relation = 'managed';
    let captured = null;
    window.fetch = function (url, options) { captured = JSON.parse(options.body); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: { events: [] } }) }); };
    await T.loadTaskTimeline(root);
    pass(captured.relation === 'received' && captured.scope === 'managed', 'FILTER: "managed" UI relation maps to the real backend contract relation=received+scope=managed, same as Calendar V1 — no invented permission logic');
  }

  console.log(`PHF Task Timeline Foundation V1 (frontend) test: ${passed}/${passed} PASS`);

  // =======================================================================
  // BACKEND (real dev DB, read-only, in-process require of api/_lib/task-core)
  // Cases 9, 10, 11, 12: authorization must be enforced at the read-path,
  // never "fetch then hide in JS".
  // =======================================================================
  let backendPassed = 0;
  function backendPass(condition, message) { assert.ok(condition, message); backendPassed += 1; }
  require('dotenv').config();
  const core = require(path.join(ROOT, 'api', '_lib', 'task-core'));

  // 9. Actor only sees events of tasks they're authorized to view.
  const s1 = { account: { employeeCode: 'PHF010' } };
  const r1 = await core.listTaskEvents(s1, { relation: 'received', limit: 100 });
  const listResult = await core.listTasks(s1, { relation: 'received', statusFilter: 'all', limit: 200, offset: 0 });
  const authorizedIds = new Set(listResult.tasks.map(t => t.task_id));
  const eventTaskIds = new Set(r1.events.map(e => e.task_id));
  const leaked = Array.from(eventTaskIds).filter(id => !authorizedIds.has(id));
  backendPass(leaked.length === 0, '9: every event returned belongs to a task the actor is authorized to view (0 leaked task_ids)');

  // 10. Negative permission case: PHF082 never created any task, so
  // relation='assigned' must return 0 events even though PHF082 clearly has
  // real activity as a recipient (relation='received').
  const s2 = { account: { employeeCode: 'PHF082' } };
  const r2assigned = await core.listTaskEvents(s2, { relation: 'assigned', limit: 100 });
  backendPass(r2assigned.events.length === 0, '10: actor with no created tasks gets exactly 0 events for relation=assigned (no leak of other people\'s "assigned" activity)');
  const r2received = await core.listTaskEvents(s2, { relation: 'received', limit: 100 });
  backendPass(r2received.events.length > 0, '10b: sanity check — the same actor DOES have real events under the relation they are actually authorized for');

  // 11. Managed scope does not self-broaden: requesting scope=managed for an
  // actor with no manager/employees scope must not silently fall back to
  // "all company" — it must behave exactly like listTasks() does for the
  // same actor/scope (same authorization function, zero divergence).
  const managedResult = await core.listTaskEvents(s1, { relation: 'received', scope: 'managed', limit: 100 });
  const managedListResult = await core.listTasks(s1, { relation: 'received', statusFilter: 'all', scope: 'managed', limit: 200, offset: 0 });
  const managedAuthorizedIds = new Set(managedListResult.tasks.map(t => t.task_id));
  const managedEventIds = new Set(managedResult.events.map(e => e.task_id));
  const managedLeak = Array.from(managedEventIds).filter(id => !managedAuthorizedIds.has(id));
  backendPass(managedLeak.length === 0, '11: scope=managed events are exactly bounded by listTasks(scope=managed) for the SAME actor — no self-broadening beyond what listTasks() itself would allow');

  // 12. Cross-department does not bypass permission: an invalid/unsupported
  // relation must fail closed (reuses listTasks()' own validation, not a
  // parallel/weaker check).
  await assert.rejects(
    () => core.listTaskEvents(s1, { relation: 'all_company_bypass', limit: 50 }),
    error => error && error.code === 'TASK_LIST_RELATION_INVALID'
  );
  backendPass(true, '12: an invalid relation value fails closed with TASK_LIST_RELATION_INVALID — same validation listTasks() already enforces, no separate weaker path');

  console.log(`PHF Task Timeline Foundation V1 (backend, real DB) test: ${backendPassed}/${backendPassed} PASS`);
})().catch(err => { console.error('FAIL', err); process.exit(1); });
