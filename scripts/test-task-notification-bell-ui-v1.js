'use strict';

/*
 * PHF Task — IN-APP NOTIFICATION V1 topbar bell + dropdown panel (jsdom).
 * No network. Proves the bell UI contract:
 *   - bell sits immediately LEFT of the avatar/user cluster in .phft-topbar
 *   - badge hidden when unread=0, shows count, ">99" -> "99+"
 *   - click bell opens the dropdown panel; click outside / a row closes it
 *   - "Đánh dấu đã đọc tất cả" action; empty state; item click -> mark + navigate
 *   - the same component renders for every Task role (admin / manager / learner)
 * Backend list/mark + privacy are proven by scripts/task-notification-v1-e2e-dev.js.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
function pass(cond, msg) { assert.ok(cond, msg); passed += 1; console.log('  PASS  ' + msg); }
const TASK_APP_SRC = fs.readFileSync(path.join(ROOT, 'assets/js/task/phf-task-app.js'), 'utf8');

function newWindow(role) {
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/ql/task' });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = function () { return role || 'manager'; };
  window.phfGetCurrentUser = function () { return { fullName: 'QA', employeeCode: 'PHF001', role: role || 'manager' }; };
  window.__phfNav = [];
  window.phfNavigate = function (p) { window.__phfNav.push(p); };
  window.phfToast = function () {};
  window.fetch = function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true, result: { notifications: [], unreadCount: 0 } }); } }); };
  window.eval(TASK_APP_SRC);
  return window;
}

const SAMPLE = [
  { id: 'n1', eventCode: 'TASK_COMMENTED', taskId: 'task-1', title: 'Bình luận mới', message: 'Có bình luận mới trong công việc «A».', targetPath: '/task?task=task-1', createdAt: new Date().toISOString(), readAt: '', status: 'unread' },
  { id: 'n2', eventCode: 'TASK_PUBLISHED', taskId: 'task-2', title: 'Công việc mới', message: 'Bạn được giao công việc «B».', targetPath: '/task?task=task-2', createdAt: new Date(Date.now() - 3600000).toISOString(), readAt: new Date().toISOString(), status: 'read' },
];

(async () => {
  const w = newWindow('manager');
  const T = w.__PHF_TASK_TEST__;

  // ---- [1] bell position: LEFT of avatar in the topbar ----
  {
    T.setNotifState({ items: [], unread: 0, open: false });
    const shell = T.shellFrame('<div></div>');
    const bellIdx = shell.indexOf('phft-notif-wrap');
    const avatarIdx = shell.indexOf('phft-user-avatar');
    pass(bellIdx !== -1 && avatarIdx !== -1 && bellIdx < avatarIdx, '[1] notification bell is rendered immediately LEFT of the avatar/user cluster');
    pass(shell.indexOf('phft-topbar') !== -1 && shell.indexOf('phft-top-actions') < shell.indexOf('phft-user-avatar'), '[1b] bell lives inside .phft-top-actions of the existing topbar (no sidebar item, no new header)');
  }

  // ---- [2] badge: hidden at 0, count, 99+ ----
  {
    T.setNotifState({ unread: 0 });
    pass(T.taskNotifBellHtml().indexOf('phft-notif-badge') === -1, '[2] badge hidden when unread = 0');
    T.setNotifState({ unread: 5 });
    pass(/phft-notif-badge[^>]*>5<\/span>/.test(T.taskNotifBellHtml()), '[2b] badge shows the exact unread count');
    T.setNotifState({ unread: 250 });
    pass(T.taskNotifBellHtml().indexOf('>99+<') !== -1 && T.phftNotifBadgeText(250) === '99+', '[2c] unread > 99 renders "99+"');
  }

  // ---- [3] panel: hidden by default, opens on state, empty state ----
  {
    T.setNotifState({ items: [], unread: 0, open: false, loaded: true, loading: false });
    pass(/data-task-notif-panel hidden/.test(T.taskNotifPanelHtml()), '[3] panel hidden when open=false');
    T.setNotifState({ open: true });
    const p = T.taskNotifPanelHtml();
    pass(p.indexOf('data-task-notif-panel hidden') === -1 && p.indexOf('Thông báo') !== -1, '[3b] panel visible with title "Thông báo" when open');
    pass(p.indexOf('Chưa có thông báo nào') !== -1, '[3c] empty state when no notifications');
  }

  // ---- [4] populated panel: rows, unread styling, mark-all action ----
  {
    T.setNotifState({ items: JSON.parse(JSON.stringify(SAMPLE)), unread: 1, open: true, loaded: true });
    const p = T.taskNotifPanelHtml();
    pass((p.match(/data-task-notif-item=/g) || []).length === 2, '[4] one row per notification');
    pass(/class="phft-notif-item unread"[^>]*data-task-notif-item="n1"/.test(p), '[4b] unread row visually marked (.unread)');
    pass(/data-task-notif-item="n2"(?![^>]*unread)/.test(p) || p.indexOf('class="phft-notif-item"') !== -1, '[4c] read row not marked unread');
    pass(p.indexOf('data-task-notif-mark-all') !== -1 && p.indexOf('Đánh dấu đã đọc tất cả') !== -1, '[4d] "Đánh dấu đã đọc tất cả" shown when there are unread');
    pass(p.indexOf('TASK_COMMENTED') === -1 && p.indexOf('TASK_PUBLISHED') === -1, '[4e] technical event codes are NEVER rendered in the panel');
    T.setNotifState({ unread: 0 });
    pass(T.taskNotifPanelHtml().indexOf('data-task-notif-mark-all') === -1, '[4f] mark-all hidden when nothing unread');
  }

  // ---- [5] interaction: open, mark-all, item click -> navigate ----
  {
    const root = w.document.getElementById('phfTaskRoot');
    T.setNotifState({ items: JSON.parse(JSON.stringify(SAMPLE)), unread: 1, open: false, loaded: true, loading: false });
    // render the shell so the DOM has the wrap + handlers
    root.innerHTML = '<div class="phf-task-root-shell">' + T.shellFrame('<div></div>') + '</div>';
    T.bindShell(root);

    const bell = root.querySelector('[data-task-notif-toggle]');
    pass(!!bell, '[5] bell button present in the DOM');
    bell.click();
    pass(T.getNotifState().open === true && root.querySelector('[data-task-notif-panel]').hasAttribute('hidden') === false, '[5b] clicking the bell opens the panel');

    const markAll = root.querySelector('[data-task-notif-mark-all]');
    markAll.click();
    pass(T.getNotifState().unread === 0 && T.getNotifState().items.every(function (i) { return i.status === 'read'; }), '[5c] "mark all" optimistically clears unread + marks every row read');

    // re-open + click an item
    T.setNotifState({ items: JSON.parse(JSON.stringify(SAMPLE)), unread: 1, open: true });
    T.renderTaskNotif(root);
    const item = root.querySelector('[data-task-notif-item="n1"]');
    const navBefore = w.__phfNav.length;
    item.click();
    pass(w.__phfNav.length === navBefore + 1 && /task_id=task-1/.test(w.__phfNav[w.__phfNav.length - 1]), '[5d] clicking a row navigates to that Task detail');
    pass(T.getNotifState().open === false, '[5e] clicking a row closes the panel');
    const n1 = T.getNotifState().items.filter(function (i) { return i.id === 'n1'; })[0];
    pass(n1.status === 'read' && T.getNotifState().unread === 0, '[5f] clicking a row optimistically marks it read');
  }

  // ---- [7] loading hardening: error/retry state + spinner always clears ----
  {
    T.setNotifState({ items: [], unread: 0, open: true, loaded: false, loading: false, error: true });
    const p = T.taskNotifPanelHtml();
    pass(p.indexOf('data-task-notif-retry') !== -1 && p.indexOf('Không tải được thông báo') !== -1,
      '[7] on error with no items the panel shows a truthful "Thử lại" (retry) state, not an endless spinner');

    // a request that rejects (timeout/network) must clear loading and set error
    const rw = newWindow('manager');
    const RT = rw.__PHF_TASK_TEST__;
    rw.fetch = function () { return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); };
    const rr = rw.document.getElementById('phfTaskRoot');
    rr.innerHTML = '<div class="phf-task-root-shell">' + RT.shellFrame('<div></div>') + '</div>';
    RT.bindShell(rr);
    await RT.loadTaskNotifications(rr, true);
    const st = RT.getNotifState();
    pass(st.loading === false && st.error === true,
      '[7b] a rejected/timed-out notification request clears loading and flips to error (no stuck "Đang tải…")');
    pass(RT.taskNotifPanelHtml().indexOf('Đang tải') === -1, '[7c] panel no longer renders the loading state after a failed load');

    // retry after error: a now-succeeding fetch clears the error and loads
    rw.fetch = function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true, result: { notifications: [], unreadCount: 0 } }); } }); };
    await RT.loadTaskNotifications(rr, true);
    const st2 = RT.getNotifState();
    pass(st2.loading === false && st2.error === false && st2.loaded === true, '[7d] retry after an error succeeds and clears the error state');
  }

  // ---- [6] same component for every Task role ----
  {
    ['admin', 'manager', 'learner'].forEach(function (role) {
      const rw = newWindow(role);
      const RT = rw.__PHF_TASK_TEST__;
      RT.setNotifState({ items: [], unread: 3, open: false });
      const shell = RT.shellFrame('<div></div>');
      pass(shell.indexOf('phft-notif-wrap') !== -1 && shell.indexOf('data-task-notif-toggle') !== -1, '[6] ' + role + ' renders the exact same bell component');
    });
  }

  console.log('\n==== NOTIFICATION_BELL_UI_V1  PASS=' + passed + ' ====');
})().catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
