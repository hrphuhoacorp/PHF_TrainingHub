'use strict';

/*
 * PHF Task — IN-APP NOTIFICATION V1 read path (main-app layer), mock.
 * No network, no DB. Mocks api/_lib/task-read-bridge + api/_lib/task-permissions
 * via require.cache. Proves:
 *   - list returns only the session's own rows (recipient = actor, never client)
 *   - DUAL IDENTITY (handover §10): account-only Admin (employeeCode='') is
 *     scoped by accountId; normal employee by employeeCode; a session with both
 *     is scoped by both; neither -> TASK_NOTIFICATION_IDENTITY_NOT_LINKED (409)
 *   - safe DTO — no event_id / dedupe_key / recipient_* / internal fields
 *   - PRIVACY: a notification whose Task is no longer viewable is OMITTED
 *   - unreadCount is computed from the VISIBLE set
 *   - mark one / mark all are scoped to the session identity
 *   - the client cannot spoof recipientAccountId / recipientEmployeeCode
 *   - service unavailable -> truthful error, never a Supabase fallback
 *   - the module never touches Supabase
 */

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const notifPath = require.resolve(path.join(ROOT, 'api', '_lib', 'task-notifications'));
const bridgePath = require.resolve(path.join(ROOT, 'api', '_lib', 'task-read-bridge'));
const permPath = require.resolve(path.join(ROOT, 'api', '_lib', 'task-permissions'));

let passed = 0;
function pass(cond, msg) { assert.ok(cond, msg); passed += 1; console.log('  PASS  ' + msg); }
async function rejects(fn, code, msg) {
  try { await fn(); } catch (e) { assert.ok(e && e.code === code, msg + ' — got ' + (e && e.code)); passed += 1; console.log('  PASS  ' + msg); return; }
  assert.fail(msg + ' — did not throw');
}

const EMP_NOTIFS = [
  { id: 'a1', event_code: 'TASK_COMMENTED', task_id: 'T1', title: 'Bình luận mới', message: 'Có bình luận mới trong công việc «A».', target_path: '/task?task=T1', priority: 'Trung bình', created_at: '2026-08-31T10:00:00Z', read_at: null,
    event_id: 'ev-1', dedupe_key: 'evt:ev-1|P1', recipient_employee_code: 'P1', recipient_account_id: null },
  { id: 'a2', event_code: 'TASK_PUBLISHED', task_id: 'T2', title: 'Công việc mới', message: 'x', target_path: '/task?task=T2', priority: 'Trung bình', created_at: '2026-08-31T09:00:00Z', read_at: '2026-08-31T09:30:00Z',
    event_id: 'ev-2', dedupe_key: 'evt:ev-2|P1', recipient_employee_code: 'P1', recipient_account_id: null },
  { id: 'a3', event_code: 'TASK_CANCELLED', task_id: 'T3-lost', title: 'Công việc đã hủy', message: 'y', target_path: '/task?task=T3-lost', priority: 'Trung bình', created_at: '2026-08-31T08:00:00Z', read_at: null,
    event_id: 'ev-3', dedupe_key: 'evt:ev-3|P1', recipient_employee_code: 'P1', recipient_account_id: null },
];
// account-only rows (recipient_employee_code NULL, recipient_account_id set)
const ADMIN_ACCOUNT_ID = 'b3f2a1c0-1111-2222-3333-444455556666';
const ADMIN_NOTIFS = [
  { id: 'd1', event_code: 'TASK_COMPLETED', task_id: 'T9', title: 'Công việc hoàn thành', message: 'z', target_path: '/task?task=T9', priority: 'Trung bình', created_at: '2026-08-31T11:00:00Z', read_at: null,
    event_id: 'ev-9', dedupe_key: 'evt:ev-9|' + ADMIN_ACCOUNT_ID, recipient_employee_code: null, recipient_account_id: ADMIN_ACCOUNT_ID },
];

// Lightweight relation projection the phf-hr-api notification-read route now
// returns (creator identity + active-assignee summary — NO full Task Detail).
const TASK_REL = {
  T1: { task_id: 'T1', created_by_account_id: null, created_by_employee_code: 'P1', assignees: [{ employee_code: 'P1', role: 'primary', is_active: true }] },
  T2: { task_id: 'T2', created_by_account_id: null, created_by_employee_code: 'P1', assignees: [] },
  'T3-lost': { task_id: 'T3-lost', created_by_account_id: null, created_by_employee_code: 'SOMEONE', assignees: [] },
  T9: { task_id: 'T9', created_by_account_id: ADMIN_ACCOUNT_ID, created_by_employee_code: null, assignees: [] },
};

function load(over) {
  over = over || {};
  delete require.cache[notifPath];
  delete require.cache[bridgePath];
  delete require.cache[permPath];

  const calls = { list: [], markIds: [], markAll: [], detail: [] };
  const rowsFor = (identity) => {
    // emulate phf-hr-api dual-identity scoping: match non-empty employeeCode OR non-empty accountId
    const emp = String((identity && identity.employeeCode) || '').toUpperCase();
    const acc = String((identity && identity.accountId) || '');
    const all = over.notifs || EMP_NOTIFS.concat(ADMIN_NOTIFS);
    return all.filter((n) =>
      (emp && String(n.recipient_employee_code || '').toUpperCase() === emp) ||
      (acc && String(n.recipient_account_id || '') === acc));
  };
  const relationsFor = (rows) => {
    if (over.relations) return over.relations(rows);
    const ids = [...new Set(rows.map((n) => n.task_id).filter(Boolean))];
    return ids.map((id) => TASK_REL[id]).filter(Boolean); // missing id -> omitted (fail-closed)
  };

  require.cache[bridgePath] = {
    id: bridgePath, filename: bridgePath, loaded: true,
    exports: {
      isNotificationBridgeEnabled: () => over.enabled !== false,
      bridgeListTaskNotifications: async (identity, limit) => {
        calls.list.push({ identity, limit });
        const r = rowsFor(identity);
        return { notifications: r, count: r.length, taskRelations: relationsFor(r) };
      },
      bridgeMarkTaskNotificationsRead: async (identity, ids) => { calls.markIds.push({ identity, ids }); const owned = rowsFor(identity).filter((n) => ids.includes(n.id)); return { marked: owned.length }; },
      bridgeMarkAllTaskNotificationsRead: async (identity) => { calls.markAll.push({ identity }); return { marked: rowsFor(identity).filter((n) => !n.read_at).length }; },
      // Must NEVER be called by the read path any more (Phase 3C). Kept as a
      // trap so an accidental regression to the N+1 path fails the test loudly.
      bridgeGetTaskDetail: async (taskId) => { calls.detail.push(taskId); throw new Error('bridgeGetTaskDetail must not be called by notification read'); },
    },
  };
  require.cache[permPath] = {
    id: permPath, filename: permPath, loaded: true,
    exports: {
      canViewTask: async (session, relationTask, assignees) => {
        if (session && session.role === 'admin') return true; // account-only Admin sees all
        const me = 'P1';
        if (relationTask.createdByEmployeeCode === me) return true;
        return (assignees || []).some((a) => a.employeeCode === me && a.isActive);
      },
    },
  };
  const notif = require(notifPath);
  return { notif, calls };
}

const session = { employeeCode: 'P1', account: { id: 'acc-1', employeeCode: 'P1' } };
const adminSession = { sub: ADMIN_ACCOUNT_ID, role: 'admin', account: { id: ADMIN_ACCOUNT_ID, employeeCode: '' } };

(async () => {
  // ---- list: recipient = session actor, privacy filter, safe DTO ----
  {
    const { notif, calls } = load();
    const out = await notif.listMyTaskNotifications(session, { limit: 30 });
    pass(calls.list.length === 1 && calls.list[0].identity.employeeCode === 'P1' && calls.list[0].identity.accountId === 'acc-1',
      'D: list identity is the SESSION actor { employeeCode:P1, accountId:acc-1 }, never client-supplied');
    pass(out.notifications.length === 2, 'PRIVACY: the notification whose Task (T3-lost) is no longer viewable is OMITTED from the list');
    pass(!out.notifications.some((n) => n.taskId === 'T3-lost'), 'PRIVACY: T3-lost never appears');
    pass(out.unreadCount === 1, 'unreadCount counts only VISIBLE unread rows (a1), not the omitted a3');
    const dto = out.notifications[0];
    pass(!('event_id' in dto) && !('dedupe_key' in dto) && !('recipient_employee_code' in dto) && !('recipient_account_id' in dto),
      'DTO: no event_id / dedupe_key / recipient_* technical fields');
    pass(JSON.stringify(Object.keys(dto).sort()) === JSON.stringify(['createdAt', 'eventCode', 'id', 'message', 'readAt', 'status', 'targetPath', 'taskId', 'title'].sort()),
      'DTO: exactly the 9 safe fields, nothing more');
    pass(dto.status === 'unread' && out.notifications[1].status === 'read', 'DTO: status derived from read_at (unread / read)');
    pass(calls.detail.length === 0, 'PERF: the visibility re-check uses the batch relation projection — bridgeGetTaskDetail is NEVER called');
  }

  // ---- PERF: 30 notifications / 30 distinct tasks -> 1 list call, 0 detail calls ----
  {
    const many = [];
    const rels = [];
    for (let i = 0; i < 30; i += 1) {
      const tid = 'PT' + i;
      many.push({ id: 'p' + i, event_code: 'TASK_COMMENTED', task_id: tid, title: 't' + i, message: 'm', target_path: '/task?task=' + tid, priority: 'Trung bình', created_at: '2026-08-31T10:' + String(i).padStart(2, '0') + ':00Z', read_at: null, recipient_employee_code: 'P1', recipient_account_id: null });
      rels.push({ task_id: tid, created_by_account_id: null, created_by_employee_code: 'P1', assignees: [] });
    }
    const { notif, calls } = load({ notifs: many, relations: () => rels });
    const out = await notif.listMyTaskNotifications(session, { limit: 30 });
    pass(calls.list.length === 1 && calls.detail.length === 0 && out.notifications.length === 30,
      'PERF: 30 rows / 30 distinct task_ids -> exactly 1 notification-list call and 0 bridgeGetTaskDetail calls');
  }

  // ---- A: account-only Admin -> list succeeds, NOT 409 ----
  {
    const { notif, calls } = load();
    const out = await notif.listMyTaskNotifications(adminSession, {});
    pass(calls.list[0].identity.employeeCode === '' && calls.list[0].identity.accountId === ADMIN_ACCOUNT_ID,
      'A: account-only Admin resolves to { employeeCode:"", accountId:<uuid> } (not rejected)');
    pass(out.notifications.length === 1 && out.notifications[0].taskId === 'T9',
      'C: account-only notification (recipient_account_id set, recipient_employee_code NULL) is readable by the correct Admin');
    pass(calls.list[0].identity.accountId === ADMIN_ACCOUNT_ID && calls.list[0].identity.accountId === ADMIN_ACCOUNT_ID.toLowerCase(),
      'account UUID is NOT uppercased');
  }

  // ---- B: account-only Admin with no rows -> 200 [], unreadCount 0 ----
  {
    const { notif } = load({ notifs: EMP_NOTIFS });
    const out = await notif.listMyTaskNotifications(adminSession, {});
    pass(Array.isArray(out.notifications) && out.notifications.length === 0 && out.unreadCount === 0,
      'B: valid Admin identity but zero matching rows -> { notifications:[], unreadCount:0 } (never 409)');
  }

  // ---- E: a row matching both identities appears once ----
  {
    const bothRow = [{ id: 'm1', event_code: 'TASK_COMMENTED', task_id: 'T1', title: 't', message: 'm', target_path: '/task?task=T1', priority: 'Trung bình', created_at: '2026-08-31T12:00:00Z', read_at: null, recipient_employee_code: 'P1', recipient_account_id: 'acc-1' }];
    const { notif } = load({ notifs: bothRow });
    const out = await notif.listMyTaskNotifications(session, {});
    pass(out.notifications.length === 1, 'E: a row matching BOTH employeeCode and accountId is returned exactly once');
  }

  // ---- newest first ----
  {
    const { notif } = load();
    const out = await notif.listMyTaskNotifications(session, {});
    pass(out.notifications[0].createdAt > out.notifications[1].createdAt, 'list: newest-first order preserved from the bridge');
  }

  // ---- D-employee + F/G: mark one / mark all scoped to session identity ----
  {
    const { notif, calls } = load();
    await notif.markTaskNotificationRead(session, { id: 'a1' });
    pass(calls.markIds[0].identity.employeeCode === 'P1' && calls.markIds[0].ids[0] === 'a1',
      'D: markRead scoped to the SESSION identity (P1)');
    await notif.markAllTaskNotificationsRead(session);
    pass(calls.markAll[0].identity.employeeCode === 'P1', 'G: markAll scoped to the SESSION identity (P1)');
  }
  {
    const { notif, calls } = load();
    // F: account-only Admin marks own row; another account's row untouched
    const r = await notif.markTaskNotificationRead(adminSession, { id: 'd1' });
    pass(r.marked === 1 && calls.markIds[0].identity.accountId === ADMIN_ACCOUNT_ID,
      'F: account-only Admin marks their own account-scoped row (marked=1)');
    const r2 = await notif.markTaskNotificationRead(adminSession, { id: 'a1' });
    pass(r2.marked === 0, "F: Admin cannot mark an employee-scoped row that isn't theirs (marked=0)");
  }

  // ---- H: client cannot spoof recipient identity ----
  {
    const { notif, calls } = load();
    await notif.listMyTaskNotifications(
      Object.assign({}, session, { recipientAccountId: ADMIN_ACCOUNT_ID, recipientEmployeeCode: 'ZZZ' }),
      { recipientAccountId: ADMIN_ACCOUNT_ID, ids: ['d1'], limit: 30 }
    );
    pass(calls.list[0].identity.employeeCode === 'P1' && calls.list[0].identity.accountId === 'acc-1',
      'H: client-supplied recipientAccountId / recipientEmployeeCode are ignored — scope stays the session actor');
  }

  // ---- unavailable -> truthful error, no Supabase fallback ----
  {
    const { notif } = load({ enabled: false });
    await rejects(() => notif.listMyTaskNotifications(session, {}), 'TASK_NOTIFICATION_UNAVAILABLE', 'unavailable: list throws TASK_NOTIFICATION_UNAVAILABLE (truthful, no fallback)');
    await rejects(() => notif.markTaskNotificationRead(session, { id: 'a1' }), 'TASK_NOTIFICATION_UNAVAILABLE', 'unavailable: markRead throws TASK_NOTIFICATION_UNAVAILABLE');
    await rejects(() => notif.markAllTaskNotificationsRead(session), 'TASK_NOTIFICATION_UNAVAILABLE', 'unavailable: markAll throws TASK_NOTIFICATION_UNAVAILABLE');
  }

  // ---- identity not linked (case C: neither employeeCode nor accountId) ----
  {
    const { notif } = load();
    await rejects(() => notif.listMyTaskNotifications({ account: {} }, {}), 'TASK_NOTIFICATION_IDENTITY_NOT_LINKED', 'C: no employee code AND no account id -> TASK_NOTIFICATION_IDENTITY_NOT_LINKED');
    await rejects(() => notif.markAllTaskNotificationsRead({ account: {} }), 'TASK_NOTIFICATION_IDENTITY_NOT_LINKED', 'C: markAll with no identity -> 409');
  }

  // ---- I: fail-closed — a Task with NO relation row (deleted / not projected) is omitted ----
  {
    // projection omits T1 entirely -> must be treated as not-viewable
    const { notif, calls } = load({ relations: (rows) => [...new Set(rows.map((n) => n.task_id))].filter((id) => id !== 'T1').map((id) => TASK_REL[id]).filter(Boolean) });
    const out = await notif.listMyTaskNotifications(session, {});
    pass(!out.notifications.some((n) => n.taskId === 'T1'), 'I: a Task missing from the relation projection is OMITTED (fail-closed), never shown');
    pass(calls.detail.length === 0, 'I: still no fallback to bridgeGetTaskDetail for the missing task');
  }

  // ---- PRIVACY EQUIVALENCE: canViewTask sees the SAME inputs as the old detail path ----
  {
    let seen = null;
    const { notif } = load();
    require.cache[permPath].exports.canViewTask = async (s, relationTask, assignees) => {
      if (relationTask.createdByEmployeeCode === 'P1' && assignees.length) seen = { relationTask, assignees };
      return relationTask.createdByEmployeeCode === 'P1';
    };
    delete require.cache[notifPath];
    const out = await require(notifPath).listMyTaskNotifications(session, {});
    pass(seen && seen.relationTask.createdByEmployeeCode === 'P1' && seen.relationTask.createdByAccountId === '' &&
      seen.assignees[0].employeeCode === 'P1' && seen.assignees[0].role === 'primary' && seen.assignees[0].isActive === true,
      'PRIVACY EQUIVALENCE: canViewTask receives { createdByAccountId, createdByEmployeeCode } + normalised assignees, same shape as before');
    pass(out.notifications.length === 2, 'PRIVACY EQUIVALENCE: same visible set (T1, T2) as the pre-Phase-3C decision');
  }

  // ---- retired emit helpers are harmless no-ops ----
  {
    const { notif } = load();
    const r = await notif.emitTaskNotificationSafe('TASK_CROSS_DEPARTMENT_ASSIGNED', {});
    pass(r.created === 0 && r.skipped === 'supabase_path_retired', 'emitTaskNotificationSafe is a retired no-op (never touches Supabase)');
  }

  // ---- no Supabase anywhere in the module source ----
  {
    const src = require('fs').readFileSync(notifPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    pass(!/@supabase\/supabase-js/.test(src) && !/createClient\s*\(/.test(src) && !/\.from\(\s*['"]task_notifications['"]/.test(src) && !/\.upsert\(/.test(src),
      'SOURCE: task-notifications.js has no Supabase client, no supabase.from("task_notifications"), no .upsert()');
  }

  console.log('\n==== NOTIFICATION_READ_V1  PASS=' + passed + ' ====');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
