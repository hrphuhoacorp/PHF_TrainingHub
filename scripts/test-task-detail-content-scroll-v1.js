'use strict';
/*
 * PHF Task — TASK DETAIL "Nội dung công việc" card + SCROLL-STABILITY on
 * same-screen hydration/re-render.  jsdom, no network, no DB.
 *
 * Part A — the canonical Task body gets its own prominent, read-first card
 *          (no data-model change, no second source of truth, empty handled).
 * Part B — renderTaskRoot() rebuilds the whole subtree via root.innerHTML on
 *          every re-render; a LATE async re-render (probe resolving, detail
 *          refresh after a lifecycle action) must NOT throw a scrolled-down
 *          reader back to the top. Intentional navigation (different task /
 *          screen) is NOT forced to keep the old position.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'assets/js/task/phf-task-app.js'), 'utf8');
let passed = 0;
function pass(c, m) { assert.ok(c, m); passed += 1; }

function newWindow() {
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>',
    { runScripts: 'outside-only', url: 'http://localhost/hv/task/chi-tiet/t1' });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = function () { return 'manager'; };
  window.phfGetCurrentUser = function () { return { fullName: 'QA', employeeCode: 'PHF012', id: 'acc-1', role: 'manager' }; };
  window.phfGetAuthenticatedUser = window.phfGetCurrentUser;
  window.phfNavigate = function () {};
  window.phfToast = function () {};
  window.fetch = function () { throw new Error('unstubbed fetch'); };
  window.eval(SRC);
  return window;
}

// A window whose window scroll is fully observable (jsdom has no layout).
// The root's innerHTML setter is hooked to simulate the real browser behaviour:
// tearing down the subtree collapses page height and clamps window scrollY
// toward 0 — which is exactly the jump renderTaskRoot() must undo.
function scrollableWindow() {
  const w = newWindow();
  let y = 0, sh = 100000; // tall page by default
  const calls = [];
  Object.defineProperty(w, 'pageYOffset', { get: () => y, configurable: true });
  Object.defineProperty(w, 'scrollY', { get: () => y, configurable: true });
  Object.defineProperty(w, 'innerHeight', { get: () => 800, configurable: true });
  Object.defineProperty(w.document.documentElement, 'scrollHeight', { get: () => sh, configurable: true });
  Object.defineProperty(w.document.body, 'scrollHeight', { get: () => sh, configurable: true });
  w.scrollTo = function (a, b) {
    const ny = (a && typeof a === 'object') ? a.top : b;
    y = Math.max(0, Math.min(Number(ny) || 0, Math.max(0, sh - 800)));
    calls.push(y);
  };
  const root = w.document.getElementById('phfTaskRoot');
  const desc = Object.getOwnPropertyDescriptor(w.Element.prototype, 'innerHTML');
  Object.defineProperty(root, 'innerHTML', {
    configurable: true,
    get() { return desc.get.call(this); },
    set(v) { y = 0; desc.set.call(this, v); }, // browser clamps scrollY to ~0 while the old subtree is gone
  });
  return {
    w, calls, root,
    setScroll: (n) => { y = n; },
    setPageHeight: (n) => { sh = n; },
    get y() { return y; },
  };
}

const DETAIL = {
  task: {
    id: 't1', task_id: 't1', task_code: 'CV-2609-0042', status: 'in_progress', row_version: 3,
    title: 'Kiểm kê kho cuối tháng', flow_type: 'giao_viec', priority: 'quan_trong',
    content: 'Đếm toàn bộ hàng trong kho lạnh.\nĐối chiếu với phần mềm.\nBáo cáo chênh lệch trước 17h.',
    progress_percent: 40, deadline: '2026-09-30T10:00:00.000Z', start_at: '2026-09-01T01:00:00.000Z',
  },
  category: { display_name: 'Báo cáo' },
  primary: { full_name: 'Nguyễn Văn A' },
  related: [], links: [], comments: [], events: [],
  viewer: { managed_view_only: false, actions: { view: true, comment: true, update_progress: true, complete: true } },
};

/* ================= Part A — content card ================= */
(function () {
  const T = newWindow().__PHF_TASK_TEST__;

  const html = T.detailContentHtml(DETAIL, []);
  pass(/phft-detail-content/.test(html) && /Nội dung công việc/.test(html), 'A1: Task Detail renders a "Nội dung công việc" card');
  pass(/phft-detail-content-body/.test(html)
    && html.indexOf('Đếm toàn bộ hàng trong kho lạnh.') >= 0
    && html.indexOf('Báo cáo chênh lệch trước 17h.') >= 0, 'A2: canonical task.content is shown verbatim in the card body');

  // card sits AFTER the hero and BEFORE the support/comments/lifecycle blocks
  const iHero = html.indexOf('phft-detail-hero');
  const iCard = html.indexOf('phft-detail-content');
  const iSupport = html.indexOf('phft-detail-support');
  const iComments = html.indexOf('phft-comment');
  pass(iHero >= 0 && iCard > iHero && iSupport > iCard && (iComments < 0 || iComments > iCard),
    'A2b: content card is placed right after the hero, before support/discussion/lifecycle');

  // no duplicate source of truth — body no longer lives inside the hero
  pass(!/phft-hero-desc/.test(html), 'A2c: task body is not also rendered as the old hero paragraph (single card)');

  // empty / missing content
  const emptyHtml = T.detailContentHtml(Object.assign({}, DETAIL, { task: Object.assign({}, DETAIL.task, { content: '' }) }), []);
  pass(/phft-detail-content/.test(emptyHtml) && /phft-detail-content-empty/.test(emptyHtml) && /chưa mô tả chi tiết/.test(emptyHtml),
    'A3: empty content -> clean hint card, not a blank card');
  const noContentHtml = T.detailContentHtml({ task: { id: 't1', title: 'x', status: 'published', flow_type: 'giao_viec' }, category: {}, related: [], links: [] }, []);
  pass(/phft-detail-content-empty/.test(noContentHtml), 'A3b: missing content field -> still renders the hint, no crash');
  pass(T.taskDetailContentCardHtml({}) && T.taskDetailContentCardHtml(null), 'A3c: helper tolerates {} / null task');

  // no permission / data-source change: helper reads ONLY task.content
  const fn = T.taskDetailContentCardHtml.toString();
  pass(/task\s*&&\s*task\.content|task\.content/.test(fn) && !/viewer|permission|api|fetch|scope/i.test(fn),
    'A4: content card derives from task.content only — no viewer/permission/API branch, no new field');
  const before = JSON.stringify(DETAIL.viewer);
  T.detailContentHtml(DETAIL, []);
  pass(JSON.stringify(DETAIL.viewer) === before, 'A4b: rendering does not mutate the viewer/permission object');

  // existing detail structure still present
  pass(/phft-detail-hero/.test(html) && /phft-vitals/.test(html) && /Người thực hiện chính/.test(html)
    && /Tài liệu \/ Link/.test(html) && /phft-detail-tech/.test(html),
    'A5: hero, vitals, related/links and technical sections still render');
  pass(html.indexOf('Kiểm kê kho cuối tháng') >= 0, 'A5b: title semantics unchanged (still the page/hero heading)');
})();

/* ================= Part B — scroll stability ================= */
(function () {
  const h = scrollableWindow();
  const T = h.w.__PHF_TASK_TEST__;
  const st = T.getState();
  const root = h.w.document.getElementById('phfTaskRoot');

  st.view = 'detail'; st.taskId = 't1'; st.detail = DETAIL; st.detailLoading = false; st.detailError = ''; st.partialErrors = [];

  // establish the baseline render (first render of this context -> no restore)
  T.renderTaskRoot(root);
  const callsAfterFirst = h.calls.length;

  // 6 + 7 + 8 — user scrolls down, then a late async re-render of the SAME task
  h.setScroll(820);
  T.renderTaskRoot(root);
  pass(h.calls.length > callsAfterFirst, 'B(7): same-task re-render issued a scroll restore');
  pass(Math.abs(h.y - 820) <= 2, 'B(8): scroll position preserved within tolerance after hydration re-render (got ' + h.y + ')');

  // 9 — several more late loads must not progressively drift the scroll
  T.renderTaskRoot(root);
  T.renderTaskRoot(root);
  T.renderTaskRoot(root);
  pass(Math.abs(h.y - 820) <= 2, 'B(9): repeated late re-renders do not move the scroll (got ' + h.y + ')');

  // 8b — content momentarily shorter than the scroll (cold-load card): keep the
  // intent and finish the restore on the next tall render, no drift.
  h.setScroll(820);
  h.setPageHeight(300);           // page now shorter than 820 + viewport
  T.renderTaskRoot(root);
  pass(h.y <= 300, 'B(8b): short page clamps the restore to its own max (got ' + h.y + ')');
  h.setPageHeight(100000);        // content is tall again
  T.renderTaskRoot(root);
  pass(Math.abs(h.y - 820) <= 2, 'B(8b2): once content is tall again the original position is restored (got ' + h.y + ')');

  // 10 — navigating to a DIFFERENT task is not forced back to the old position
  h.setScroll(0);                 // (real nav scrolls to top before content settles)
  st.taskId = 't2'; st.detail = Object.assign({}, DETAIL, { task: Object.assign({}, DETAIL.task, { id: 't2', task_code: 'CV-2609-0043' }) });
  const callsBeforeNavRender = h.calls.length;
  T.renderTaskRoot(root);
  pass(h.y === 0, 'B(10): different-task render does NOT restore the previous task\'s scroll (stays where nav put it)');
  pass(h.calls.length === callsBeforeNavRender, 'B(10b): no scroll-restore call fired on the context switch');

  // and a later same-task(t2) re-render starts a fresh baseline (no stale 820)
  h.setScroll(150);
  T.renderTaskRoot(root);
  pass(Math.abs(h.y - 150) <= 2, 'B(10c): new task gets its own fresh scroll baseline');
})();

/* ================= Part B — contract / regression guards ================= */
(function () {
  const w = newWindow();
  pass(typeof w.phfRenderTask === 'function', 'B(11): navigation entrypoint window.phfRenderTask still present');
  pass(/phfTaskNavigating\s*=\s*true/.test(SRC) && /finally\s*\{[^}]*phfTaskNavigating\s*=\s*false/.test(SRC),
    'B(11b): navigation arms + always disarms the scroll-suppression flag (finally)');
  pass(/window\.scrollTo\(\{top:0,left:0,behavior:'auto'\}\)/.test(SRC),
    'B(11c): intentional navigation still scrolls to top (Back/Forward + route change contract unchanged)');
  pass(/if\(!taskUiState\.detail\)taskUiState\.detailLoading=true;/.test(SRC),
    'B(12): reloadTaskDetail keeps current content on a refresh (loading screen only on cold load)');
})();

console.log('PHF Task Detail content card + scroll stability V1: ' + passed + '/' + passed + ' PASS');
