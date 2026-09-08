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
// Real-browser model of the "jump": replacing the WHOLE Task subtree
// (root.innerHTML) tears out the header+sidebar that sit ABOVE the viewport, so
// page height collapses and the browser clamps window scrollY toward 0. The
// 2026-09-07 structural fix instead swaps ONLY <main> on a same-screen refresh
// — the shell stays mounted, height is preserved, and scrollY never moves.
// So: hooking root.innerHTML zeroes y (collapse); hooking .phft-main.innerHTML
// does NOT (shell above holds the height).
function scrollableWindow() {
  const w = newWindow();
  let y = 0, sh = 100000; // tall page by default
  const calls = [];
  const rootSets = []; const mainSets = [];
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
    set(v) { rootSets.push(1); y = 0; desc.set.call(this, v); }, // full subtree gone -> clamp to ~0
  });
  // Every time renderTaskRoot() does a FULL mount it creates a fresh <main>;
  // re-hook it so a partial swap of its innerHTML is observable but height-safe.
  function hookMain() {
    const m = root.querySelector('.phft-main');
    if (!m || m.__phfHooked) return;
    m.__phfHooked = true;
    Object.defineProperty(m, 'innerHTML', {
      configurable: true,
      get() { return desc.get.call(this); },
      set(v) { mainSets.push(1); desc.set.call(this, v); }, // shell above stays -> no clamp
    });
  }
  return {
    w, calls, root, hookMain,
    setScroll: (n) => { y = n; },
    setPageHeight: (n) => { sh = n; },
    get y() { return y; },
    get rootSets() { return rootSets.length; },
    get mainSets() { return mainSets.length; },
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

/* ================= Part B — scroll stability (STRUCTURAL, 2026-09-07) =======
   The fix is now structural: a same-screen re-render swaps ONLY <main>, leaving
   the shell mounted, so window scroll is never disturbed and no snapshot /
   restore / retry is involved. These tests assert that contract. */
(function () {
  const h = scrollableWindow();
  const T = h.w.__PHF_TASK_TEST__;
  const st = T.getState();
  const root = h.w.document.getElementById('phfTaskRoot');

  st.view = 'detail'; st.taskId = 't1'; st.detail = DETAIL; st.detailLoading = false; st.detailError = ''; st.partialErrors = [];

  // baseline: first render of this context -> a FULL shell mount
  T.renderTaskRoot(root);
  h.hookMain();
  pass(h.rootSets === 1, 'B(6): first render performs one full shell mount');
  const rootSetsAfterFirst = h.rootSets;
  const callsAfterFirst = h.calls.length;

  // 7 + 8 — user scrolls deep, then a late async re-render of the SAME task
  h.setScroll(820);
  T.renderTaskRoot(root);
  pass(h.rootSets === rootSetsAfterFirst, 'B(7): same-task re-render does NOT rebuild the whole shell (no root.innerHTML swap)');
  pass(h.mainSets >= 1, 'B(7b): same-task re-render updates only <main>');
  pass(h.calls.length === callsAfterFirst, 'B(7c): no scrollTo() needed — the scroll was never disturbed');
  pass(h.y === 820, 'B(8): scroll position is exactly preserved after the refresh (got ' + h.y + ')');

  // 9 — repeated late loads never move the scroll and never rebuild the shell
  T.renderTaskRoot(root);
  T.renderTaskRoot(root);
  T.renderTaskRoot(root);
  pass(h.y === 820, 'B(9): repeated late re-renders do not move the scroll (got ' + h.y + ')');
  pass(h.rootSets === rootSetsAfterFirst, 'B(9b): repeated late re-renders never rebuild the shell');

  // 9c — a short page: with a structural swap the browser keeps whatever scroll
  // is still valid; nothing in the app fights it or drifts it.
  h.setScroll(250); h.setPageHeight(300);
  T.renderTaskRoot(root);
  pass(h.y === 250 && h.rootSets === rootSetsAfterFirst, 'B(9c): short page — no forced scroll, no shell rebuild (got ' + h.y + ')');
  h.setPageHeight(100000);

  // 10 — navigating to a DIFFERENT task: full shell mount, and the previous
  // task's position is NOT reimposed (real nav has already scrolled to top).
  h.setScroll(0);
  st.taskId = 't2'; st.detail = Object.assign({}, DETAIL, { task: Object.assign({}, DETAIL.task, { id: 't2', task_code: 'CV-2609-0043' }) });
  const callsBeforeNavRender = h.calls.length;
  T.renderTaskRoot(root);
  h.hookMain();
  pass(h.rootSets === rootSetsAfterFirst + 1, 'B(10): different-task render performs a full shell mount');
  pass(h.y === 0, 'B(10b): different-task render does NOT restore the previous task\'s scroll');
  pass(h.calls.length === callsBeforeNavRender, 'B(10c): no scroll-restore call fired on the context switch');

  // 10d — a later same-task(t2) refresh is back on the structural fast path
  h.setScroll(150);
  const rootSetsBeforeT2Refresh = h.rootSets;
  T.renderTaskRoot(root);
  pass(h.y === 150 && h.rootSets === rootSetsBeforeT2Refresh, 'B(10d): new task also gets the partial-swap fast path (got ' + h.y + ')');
})();

/* ================= Part B — shell-signature change forces a full mount ===== */
(function () {
  const h = scrollableWindow();
  const T = h.w.__PHF_TASK_TEST__;
  const st = T.getState();
  const root = h.w.document.getElementById('phfTaskRoot');
  st.view = 'list'; st.taskId = ''; st.list = Object.assign(st.list || {}, { relation: 'received', loadedOnce: true, error: '', tasks: [] });
  st.managedScopeHydrated = true;

  T.renderTaskRoot(root); h.hookMain();
  const baseRootSets = h.rootSets;
  h.setScroll(400);
  // same relation -> partial swap
  T.renderTaskRoot(root);
  pass(h.rootSets === baseRootSets, 'B(13): list refresh with an unchanged shell takes the partial path');
  // relation switch changes the sidebar highlight -> must rebuild the shell
  st.list.relation = 'assigned';
  T.renderTaskRoot(root);
  pass(h.rootSets === baseRootSets + 1, 'B(13b): switching Tôi nhận -> Tôi giao rebuilds the shell (nav highlight is a shell input)');
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
  pass(/STRUCTURAL PARTIAL UPDATE/.test(SRC) && /main\.innerHTML\s*=\s*body/.test(SRC),
    'B(12b): renderTaskRoot has the structural partial-update path (swap <main>, keep the shell)');
})();

console.log('PHF Task Detail content card + scroll stability V1: ' + passed + '/' + passed + ' PASS');
