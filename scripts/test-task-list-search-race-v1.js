'use strict';
/*
 * PHF Task — TASK LIST search / filter RACE GUARD (2026-09-07).
 *
 * loadTaskList() is fired by tab switch, scope/status filter and the 400 ms
 * search debounce. Without a guard a slower earlier response can land after a
 * newer one and repaint the list with stale rows. The guard: every load takes
 * the next token (taskListLoadToken); a response whose token is no longer
 * current is dropped — no state write, no render. loadMoreTaskList() shares the
 * counter so a filter change mid-"Xem thêm" also drops the in-flight page.
 *
 * jsdom, no network, no DB. fetch() is replaced with a manually-resolved queue
 * so response order can be inverted on purpose.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'assets/js/task/phf-task-app.js'), 'utf8');
let passed = 0;
function pass(c, m) { assert.ok(c, m); passed += 1; }

function makeWindow() {
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>',
    { runScripts: 'outside-only', url: 'http://localhost/ql/task/toi-nhan' });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = () => 'manager';
  window.phfGetCurrentUser = () => ({ fullName: 'QA', employeeCode: 'PHF012', id: 'acc-1', role: 'manager' });
  window.phfGetAuthenticatedUser = window.phfGetCurrentUser;
  window.phfNavigate = () => {};
  window.phfToast = () => {};
  window.scrollTo = () => {};

  const all = [];
  window.fetch = function (url, opts) {
    let resolve;
    const p = new Promise((r) => { resolve = r; });
    const body = JSON.parse((opts && opts.body) || '{}');
    all.push({
      body,
      settle(rows, hasMore) {
        resolve({ ok: true, json: async () => ({ ok: true, result: { tasks: rows, hasMore: !!hasMore, viewScopeType: 'self', requesterActorType: 'nhan_vien', hasManagedPeople: false, canManageTaskPermissions: false } }) });
      },
      settleError() { resolve({ ok: false, status: 500, json: async () => ({ ok: false, error: 'boom', code: 'X' }) }); },
    });
    return p;
  };
  window.eval(SRC);
  const T = window.__PHF_TASK_TEST__;
  const st = T.getState();
  const root = window.document.getElementById('phfTaskRoot');
  st.view = 'list';
  st.list = Object.assign(T.defaultTaskListState(), { relation: 'received' });
  st.managedScopeHydrated = true;
  // only the listTasks requests matter here
  const listReqs = () => all.filter((r) => r.body.action === 'listTasks');
  return { window, T, st, root, listReqs };
}

const row = (id) => ({ task_id: id, task_code: id, title: id, status: 'in_progress', deadline: '2026-09-30T10:00:00Z', priority: 'thuong' });
const ids = (st) => st.list.tasks.map((t) => t.task_id).join(',');

async function main() {
  /* ===== 1. out-of-order search responses ===== */
  {
    const { T, st, root, listReqs } = makeWindow();
    st.list.search = 'abc';
    const p1 = T.loadTaskList(root);
    st.list.search = 'abcd';
    const p2 = T.loadTaskList(root);
    pass(listReqs().length === 2, '1: two listTasks requests are in flight');

    listReqs()[1].settle([row('ABCD-1'), row('ABCD-2')], false); // newer resolves first
    await p2;
    pass(ids(st) === 'ABCD-1,ABCD-2', '1b: newer response populated the list');

    listReqs()[0].settle([row('ABC-1'), row('ABC-2'), row('ABC-3')], true); // stale resolves later
    await p1;
    pass(ids(st) === 'ABCD-1,ABCD-2', '1c: stale earlier response did NOT overwrite the newer list');
    pass(st.list.hasMore === false, '1d: stale response did not flip hasMore');
    pass(st.list.loading === false, '1e: loading cleared');
  }

  /* ===== 2. stale ERROR must not clobber a good newer list ===== */
  {
    const { T, st, root, listReqs } = makeWindow();
    const p1 = T.loadTaskList(root);
    const p2 = T.loadTaskList(root);
    listReqs()[1].settle([row('GOOD-1')], false);
    await p2;
    listReqs()[0].settleError();
    await p1.catch(() => {});
    pass(st.list.error === '' && ids(st) === 'GOOD-1',
      '2: a late stale request that errors cannot replace a good newer list with an error/empty state');
  }

  /* ===== 3. filter change during "Xem thêm" drops the stale page ===== */
  {
    const { T, st, root, listReqs } = makeWindow();
    const p0 = T.loadTaskList(root);
    listReqs()[0].settle([row('P1-1'), row('P1-2')], true);
    await p0;
    pass(st.list.tasks.length === 2 && st.list.hasMore === true, '3: first page loaded, hasMore');

    const pMore = T.loadMoreTaskList(root);
    st.list.statusFilter = 'completed';
    const pNew = T.loadTaskList(root);

    listReqs().slice(-1)[0].settle([row('DONE-1')], false); // fresh page-0 resolves first
    await pNew;
    listReqs()[1].settle([row('P2-1'), row('P2-2')], true); // stale "load more" resolves last
    await pMore;

    pass(ids(st) === 'DONE-1', '3b: stale "Xem thêm" page was not appended on top of the new filtered list');
    pass(st.list.loadingMore === false, '3c: loadingMore was cleared, not left stuck');
  }

  /* ===== 4. normal single load still works ===== */
  {
    const { T, st, root, listReqs } = makeWindow();
    const p = T.loadTaskList(root);
    listReqs()[0].settle([row('N-1'), row('N-2')], true);
    await p;
    pass(ids(st) === 'N-1,N-2' && st.list.hasMore === true && st.list.loadedOnce === true,
      '4: an un-raced load populates the list normally (no regression)');
  }

  console.log('PHF Task list search race guard V1: ' + passed + '/' + passed + ' PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
