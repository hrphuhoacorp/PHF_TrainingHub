'use strict';

/*
 * PHF TASK — 'managed' relation alias + effective peopleScope resolver.
 * ---------------------------------------------------------------------------
 * ROOT CAUSE of the reported 500: listTasks({relation:'managed'}) — 'managed'
 * is a UI-level relation the backend contract never had (only received/
 * assigned/proposal_*). The bridged path (task-query-descriptor-builder.js)
 * threw via invalid() WITHOUT setting .statusCode, so request-guard's
 * publicError() fell through to a generic 500 INTERNAL_ERROR (dropping the
 * real TASK_LIST_RELATION_INVALID code). The managed peopleScope resolver
 * itself was fine — (relation='received', scope='managed') already returned
 * the correct managed people.
 *
 * MINIMAL FIX (no permission-contract / manager-graph / preset change):
 *   1. normalizeRelationScope(): 'managed' -> (relation='received',
 *      scope='managed') BEFORE validation, on BOTH the legacy (task-core.js)
 *      and bridged (task-query-descriptor-builder.js) paths.
 *   2. invalid() now sets .statusCode (default 400) so a genuinely bad
 *      relation returns a clean 400, matching task-core.js::listTasks().
 *
 * Backend proof runs against the local parity server. jsdom proves the
 * "Nhân sự tôi quản lý" menu appears from the real (unchanged) hydration.
 *
 *   node scripts/test-task-managed-relation-alias-v1.js
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.PHF_TASK_LOCAL_BASE || 'http://127.0.0.1:3000';
const PW = 'LocalParity#2026';
const ROOT = path.resolve(__dirname, '..');
let PASS = 0, FAIL = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + name); }
  else { FAIL++; fails.push(name + (detail ? ' -> ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); }
}

async function login(email) {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PW }) });
  const sc = r.headers.get('set-cookie') || '';
  const j = await r.json();
  if (!j.ok) throw new Error('login ' + email + ': ' + JSON.stringify(j));
  return sc.split(',').map(s => s.split(';')[0].trim()).filter(s => /=/.test(s)).join('; ');
}
async function api(cookie, payload) {
  const r = await fetch(BASE + '/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(payload) });
  let j; try { j = await r.json(); } catch (e) { j = {}; }
  return { status: r.status, ok: j.ok === true, code: j.code || '', result: j.result };
}
const prims = res => [...new Set((res && res.tasks || []).map(t => t.primary && t.primary.employee_code))].sort();

(async () => {
  // ================= 1. UNIT — descriptor builder normalisation ==============
  console.log('\n[1] descriptor builder unit');
  const builderSrc = fs.readFileSync(path.join(ROOT, 'api/_lib/task-query-descriptor-builder.js'), 'utf8');
  ok(/function normalizeRelationScope/.test(builderSrc) && /relation === 'managed'/.test(builderSrc), 'builder: normalizeRelationScope resolves the managed alias');
  ok(/err\.statusCode = statusCode \|\| 400/.test(builderSrc), 'builder: invalid() now stamps a 4xx statusCode (no silent 500)');
  const coreSrc = fs.readFileSync(path.join(ROOT, 'api/_lib/task-core.js'), 'utf8');
  ok(/function normalizeTaskListRelationScope/.test(coreSrc), 'task-core: legacy listTasks() gets the same managed-alias normalisation (parity)');

  // ================= 2. BACKEND — PHF034 managed relation ===================
  console.log('\n[2] backend — PHF034 (truong_bo_phan, quản lý PHF073 + PHF005)');
  const c34 = await login('nguyenhai1372005@gmail.com');
  const m = await api(c34, { action: 'listTasks', relation: 'managed', statusFilter: 'all', limit: 200 });
  ok(m.status === 200 && m.ok, 'PHF034 listTasks(relation:"managed") = 200 (was 500)', m.status + ' ' + m.code);
  ok(JSON.stringify(prims(m.result)) === JSON.stringify(['PHF005', 'PHF073']), 'managed people = exactly PHF005 + PHF073', JSON.stringify(prims(m.result)));
  ok(m.result.viewScopeType === 'employees' && m.result.requesterActorType === 'truong_bo_phan', 'viewScopeType=employees, requesterActorType=truong_bo_phan (menu-hydration signal correct)', JSON.stringify({ v: m.result.viewScopeType, a: m.result.requesterActorType }));

  const canon = await api(c34, { action: 'listTasks', relation: 'received', scope: 'managed', statusFilter: 'all', limit: 200 });
  ok(canon.result.tasks.length === m.result.tasks.length && JSON.stringify(prims(canon.result)) === JSON.stringify(prims(m.result)),
    'relation:"managed" ≡ relation:"received"+scope:"managed" (identical authorization contract)', m.result.tasks.length + ' vs ' + canon.result.tasks.length);

  const ev = await api(c34, { action: 'listTaskEvents', relation: 'managed', limit: 50 });
  ok(ev.status === 200 && ev.ok, 'PHF034 listTaskEvents(relation:"managed") = 200 (alias covers the timeline path too)', ev.status);

  const bad = await api(c34, { action: 'listTasks', relation: 'not_a_relation', statusFilter: 'all' });
  ok(bad.status === 400 && bad.code === 'TASK_LIST_RELATION_INVALID', 'genuinely-invalid relation -> clean 400 TASK_LIST_RELATION_INVALID (not 500)', bad.status + ' ' + bad.code);

  // ================= 3. BACKEND — no scope leak =============================
  console.log('\n[3] backend — unrelated personas do NOT see PHF034 managed people');
  const c12 = await login('thanglv150917@gmail.com'); // PHF012 TBP QTTH -> PHF082 only
  const m12 = await api(c12, { action: 'listTasks', relation: 'managed', statusFilter: 'all', limit: 200 });
  ok(m12.status === 200 && prims(m12.result).every(x => x === 'PHF082') && !prims(m12.result).includes('PHF073') && !prims(m12.result).includes('PHF005'),
    'PHF012 managed = only PHF082 (no PHF073/PHF005 leak, cross-department)', JSON.stringify(prims(m12.result)));
  const c18 = await login('lenguyen.phf.3979@gmail.com'); // PHF018 TrCa BH -> PHF020/076/079
  const m18 = await api(c18, { action: 'listTasks', relation: 'managed', statusFilter: 'all', limit: 200 });
  ok(m18.status === 200 && !prims(m18.result).includes('PHF073') && !prims(m18.result).includes('PHF005'),
    'PHF018 managed = only PHF020/076/079 (no PHF073/PHF005 leak, same-then-different-dept)', JSON.stringify(prims(m18.result)));
  const c73 = await login('nguyenhuynhphuochuy31052003@gmail.com'); // PHF073 plain NV
  const m73 = await api(c73, { action: 'listTasks', relation: 'managed', statusFilter: 'all', limit: 200 });
  ok(m73.status === 200 && m73.result.viewScopeType === 'self', 'PHF073 (plain NV) relation:"managed" -> viewScopeType=self (alias does NOT grant NV a manager scope)', m73.result.viewScopeType);
  const target = (m.result.tasks || [])[0];
  if (target) {
    const cOther = await login('havietnguyenthanh0210@gmail.com'); // PHF071 TCKT, unrelated
    const d = await api(cOther, { action: 'getTaskDetail', task_id: target.task_id });
    ok(!d.ok && d.code === 'TASK_VIEW_DENIED', 'unrelated PHF071 (other dept) getTaskDetail on a PHF034 managed task -> TASK_VIEW_DENIED', d.status + ' ' + d.code);
  }

  // ================= 4. FRONTEND — "Nhân sự tôi quản lý" menu appears =======
  console.log('\n[4] frontend (jsdom) — menu hydration from the real listTasks response');
  const { JSDOM } = require('jsdom');
  const appSrc = fs.readFileSync(path.join(ROOT, 'assets/js/task/phf-task-app.js'), 'utf8');
  function fe(listResponse) {
    const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/ql/task/nhan' });
    const w = dom.window;
    w.__PHF_TASK_TEST_MODE__ = true;
    w.phfGetSessionRole = () => 'manager';
    w.phfGetCurrentUser = () => ({ fullName: 'Nguyễn Duy Hải', employeeCode: 'PHF034' });
    w.phfNavigate = () => {}; w.phfToast = () => {};
    w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: listResponse }) });
    w.eval(appSrc);
    return { T: w.__PHF_TASK_TEST__, root: w.document.getElementById('phfTaskRoot') };
  }
  async function hydrate(listResponse, relation) {
    const { T, root } = fe(listResponse);
    const st = T.getState();
    st.list.relation = relation;
    const before = T.taskManagerScopeAvailable();
    await T.loadTaskList(root);
    return { T, st, before };
  }

  // PHF034-shaped response (exactly what the fixed backend returns)
  const a = await hydrate({ tasks: [], relation: 'received', scope: 'managed', viewScopeType: 'employees', requesterActorType: 'truong_bo_phan', hasManagedPeople: true, hasMore: false }, 'managed');
  ok(a.before === false, 'menu hidden before any list load (fail-closed default)');
  ok(a.st.hasManagedScope === true, 'after a real PHF034 listTasks response -> hasManagedScope hydrates true');
  ok(a.T.taskManagerScopeAvailable() === true, 'taskManagerScopeAvailable() = true for PHF034');
  const visibleChildren = a.T.taskNavVisibleChildren(a.T.NAV_ITEMS.find(i => i.key === 'viec-cua-toi')).map(c => c.key);
  ok(visibleChildren.includes('nhan-su-toi-quan-ly'), '"Nhân sự tôi quản lý" nav child rendered for PHF034', JSON.stringify(visibleChildren));

  // plain NV response -> menu stays hidden (never force-shown)
  const nv = await hydrate({ tasks: [], relation: 'received', scope: 'default', viewScopeType: 'self', requesterActorType: 'nhan_vien', hasMore: false }, 'received');
  ok(nv.st.hasManagedScope === false && nv.T.taskManagerScopeAvailable() === false, 'plain NV response -> menu stays hidden (scope not hydrated, not force-shown)');
  const nvVisible = nv.T.taskNavVisibleChildren(nv.T.NAV_ITEMS.find(i => i.key === 'viec-cua-toi')).map(c => c.key);
  ok(!nvVisible.includes('nhan-su-toi-quan-ly'), 'plain NV -> "Nhân sự tôi quản lý" NOT in nav', JSON.stringify(nvVisible));

  console.log('\n==== MANAGED RELATION ALIAS: PASS=' + PASS + ' FAIL=' + FAIL + ' ====');
  if (FAIL) { console.log('FAILURES:\n - ' + fails.join('\n - ')); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(2); });
