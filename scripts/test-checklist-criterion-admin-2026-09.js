'use strict';
/*
 * Regression — Checklist Criterion Admin V1 (Tiêu chuẩn Checklist CRUD workspace)
 *
 * Covers CASE 1-10 from the task spec:
 *  1. Add a criterion in the workspace -> publish -> new version has it, refetch confirms.
 *  2. Edit an existing criterion's content -> publish -> new version reflects edit; OLD
 *     version (fetched explicitly) byte-for-byte unchanged for that criterion.
 *  3. Invalid factor (<=0) rejected client-side (ceAddCriterion/ceEditCriterion) AND
 *     backend-side (validateGroupsDefinition via saveOne).
 *  4. Add then remove (same session, never published) -> not sent to backend at all.
 *  5. Hard-delete a previously-published code is disallowed by the UI model
 *     (ceIsHardDeletable===false); backend does NOT reject a normal next version that
 *     simply omits a previously-published code (discontinuation is legitimate).
 *  6. Discontinue a used criterion -> new version doesn't have it; old version
 *     (fetched directly) still has it, unchanged.
 *  7. Reorder -> publish -> refetch (fresh listChecklistTemplates()) -> order persisted.
 *  8. Simulated backend failure during publish -> no success path, session data intact.
 *  9. Duplicate criterion code within one new version's groups -> backend rejects,
 *     RPC never called.
 *  10. Concurrency: two separate browser "tabs" (separate vm sandboxes sharing the same
 *      backend store) -> second publish with a stale local snapshot hits
 *      CHECKLIST_TEMPLATE_STALE, same as the existing direct-edit/tse flows.
 *
 * In-memory only. @supabase/supabase-js stubbed (same convention as
 * scripts/test-checklist-template-activation-2026-09.js) — NO real Supabase project is
 * ever contacted, regardless of the fake URL/key below. Frontend logic is loaded via a
 * vm sandbox running the real assets/js/checklist/phf-checklist-app.js source (same
 * convention as scripts/test-checklist-monthly-version-override-ui-2026-09.js), with
 * `fetch` bridged directly into the real api/_lib/checklist-templates.js functions
 * (saveOne/saveChecklistTemplate) running against the same stubbed in-memory store —
 * i.e. a real end-to-end exercise of frontend-builds-payload -> backend-validates ->
 * backend-persists, with zero network/database I/O.
 *
 *   node scripts/test-checklist-criterion-admin-2026-09.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const root = path.resolve(__dirname, '..');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

let failures = 0, passed = 0;
function check(c, m) { if (!c) { console.error('FAIL: ' + m); failures++; } else { passed++; console.log('PASS: ' + m); } }
async function rec(name, fn) {
  try { await fn(); console.log('PASS: ' + name); passed++; }
  catch (e) { failures++; console.error('FAIL: ' + name + '\n  ' + (e && e.message ? e.message : e) + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n  ') : '')); }
}

// ---------------------------------------------------------------------------
// In-memory fake Supabase (checklist_templates / checklist_template_versions only)
// ---------------------------------------------------------------------------
let store, rpcCalls;
function resetStore() {
  store = {
    checklist_templates: [{
      template_key: 'tc-criteria-test', code: 'TCT', name: 'Mẫu kiểm thử CRUD tiêu chí',
      group_name: 'Kiểm thử', template_type: 'checklist_detail', has_checklist: true,
      source: '', note: '', status: 'active', current_version: 'TCT-1.0',
      effective_date: '2026-07-01', updated_at: '2026-07-01T00:00:00.000Z'
    }],
    checklist_template_versions: [{
      template_key: 'tc-criteria-test', version_no: 'TCT-1.0', effective_date: '2026-07-01',
      reason: 'Khởi tạo mẫu kiểm thử', source_version: '', change_type: 'sync',
      definition: {
        templateType: 'checklist_detail',
        groups: [{ code: 'G1', name: 'Nhóm 1', children: [{ code: 'C1', name: 'Nhóm con 1', items: [
          ['TCT-01', 'Tiêu chí một', 1],
          ['TCT-02', 'Tiêu chí hai', 2]
        ] }] }],
        totalRows: [[1, 'CT-01', 'Tuân thủ tiêu chuẩn Checklist', 100, 'điểm', 100, 'Không', { type: 'checklist_total' }, 'CT-01']]
      },
      created_at: '2026-07-01T00:00:00.000Z'
    }]
  };
  rpcCalls = [];
}

class FakeQuery {
  constructor(t) { this.table = t; this.filters = []; this._single = null; this._order = []; }
  select() { return this; }
  eq(c, v) { this.filters.push(r => String(r[c]) === String(v)); return this; }
  in(c, a) { const s = new Set((a || []).map(String)); this.filters.push(r => s.has(String(r[c]))); return this; }
  order(c, o) { this._order.push({ c, asc: !(o && o.ascending === false) }); return this; }
  maybeSingle() { this._single = 'maybe'; return this; }
  single() { this._single = 'strict'; return this; }
  then(res, rej) {
    const table = store[this.table] || (store[this.table] = []);
    let rows = clone(table.filter(r => this.filters.every(f => f(r))));
    this._order.forEach(o => { rows.sort((a, b) => { const x = a[o.c], y = b[o.c]; return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1); }); });
    let p;
    if (this._single === 'maybe') p = { data: rows[0] || null, error: null };
    else if (this._single === 'strict') p = rows.length ? { data: rows[0], error: null } : { data: null, error: { message: 'no rows' } };
    else p = { data: rows, error: null };
    return Promise.resolve(p).then(res, rej);
  }
}
async function fakeRpc(name, params) {
  rpcCalls.push({ name, params: clone(params) });
  if (name === 'phf_save_checklist_template') {
    const key = params.p_template.template_key, ver = params.p_version.version_no;
    const tpl = store.checklist_templates.find(t => t.template_key === key);
    if (!tpl) return { data: null, error: { message: 'NOT_FOUND' } };
    const expected = params.p_template.expected_updated_at;
    if (expected && String(expected) !== String(tpl.updated_at)) {
      return { data: null, error: { message: 'CHECKLIST_TEMPLATE_STALE: mẫu đã thay đổi ở nơi khác' } };
    }
    const existing = store.checklist_template_versions.find(v => v.template_key === key && v.version_no === ver);
    if (existing) {
      const same = JSON.stringify(existing.definition) === JSON.stringify(params.p_version.definition);
      if (!same) return { data: null, error: { message: 'CHECKLIST_TEMPLATE_VERSION_IMMUTABLE: version exists with different content' } };
    } else {
      store.checklist_template_versions.push({
        template_key: key, version_no: ver, effective_date: params.p_version.effective_date,
        reason: params.p_version.reason, source_version: params.p_version.source_version,
        change_type: params.p_version.change_type, definition: clone(params.p_version.definition),
        created_at: params.p_version.created_at
      });
    }
    tpl.current_version = ver; tpl.effective_date = params.p_template.effective_date;
    tpl.updated_at = new Date(Date.now() + rpcCalls.length).toISOString(); // strictly monotonic across calls
    return { data: { ok: true, templateKey: key, version: ver }, error: null };
  }
  return { data: null, error: { message: 'unmocked rpc ' + name } };
}

// ---------------------------------------------------------------------------
// Require the REAL backend lib with @supabase/supabase-js stubbed (offline).
// ---------------------------------------------------------------------------
const orig = Module._load;
Module._load = function (req) {
  if (req === '@supabase/supabase-js') return { createClient: () => ({ from: t => new FakeQuery(t), rpc: (n, p) => fakeRpc(n, p) }) };
  return orig.apply(this, arguments);
};
const templatesLib = require(path.join(root, 'api', '_lib', 'checklist-templates.js'));
Module._load = orig;

const ADMIN = { role: 'admin', account: { id: 'admin-1', name: 'Admin Test' }, sub: 'admin-1' };

async function fetchBridge(url, opts) {
  let body = {};
  try { body = JSON.parse((opts && opts.body) || '{}'); } catch (_) {}
  const action = body.action;
  try {
    if (action === 'saveChecklistTemplate') {
      const result = await templatesLib.saveChecklistTemplate(ADMIN, body.template);
      return { ok: true, status: 200, json: async () => Object.assign({ ok: true }, result) };
    }
    if (action === 'saveChecklistTemplateLibrary') {
      const result = await templatesLib.saveChecklistTemplateLibrary(ADMIN, body.templates);
      return { ok: true, status: 200, json: async () => Object.assign({ ok: true }, result) };
    }
    return { ok: false, status: 400, json: async () => ({ ok: false, message: 'unknown action: ' + action }) };
  } catch (error) {
    return { ok: false, status: error.statusCode || 500, json: async () => ({ ok: false, message: error.message, code: error.code || '' }) };
  }
}

// ---------------------------------------------------------------------------
// vm sandbox loading the REAL frontend source, one factory per "browser tab".
// ---------------------------------------------------------------------------
const filePath = 'assets/js/checklist/phf-checklist-app.js';
const src = fs.readFileSync(path.join(root, filePath), 'utf8');
const marker = '\n})();';
const idx = src.lastIndexOf(marker);
const expose = "\n  window.__ceTest={\n" +
  "    ceOpen:ceOpen, ceAddCriterion:ceAddCriterion, ceEditCriterion:ceEditCriterion,\n" +
  "    ceDiscontinueCriterion:ceDiscontinueCriterion, ceRemoveDraftCriterion:ceRemoveDraftCriterion,\n" +
  "    ceMoveCriterion:ceMoveCriterion, ceMoveGroup:ceMoveGroup, ceMoveChild:ceMoveChild,\n" +
  "    ceValidateSession:ceValidateSession, ceIsHardDeletable:ceIsHardDeletable, ceCriterionList:ceCriterionList,\n" +
  "    cePublish:cePublish, getCeState:function(){return checklistCeState;},\n" +
  "    templateCatalog:templateCatalog, templateUiState:templateUiState,\n" +
  "    ensureChecklistTemplatesHydrated:ensureChecklistTemplatesHydrated, nextTemplateVersion:nextTemplateVersion,\n" +
  "    flattenCriteria:flattenCriteria, checklistTemplateDbState:checklistTemplateDbState,\n" +
  "    buildBulkImportPayload:buildBulkImportPayload, confirmBulkImport:confirmBulkImport,\n" +
  "    effectiveTemplateVersion:effectiveTemplateVersion, selectedTemplateGroups:selectedTemplateGroups\n" +
  "  };\n";
const testSrc = src.slice(0, idx) + expose + src.slice(idx);
const compiled = new vm.Script(testSrc, { filename: filePath });

function makeLocalStorage() {
  const data = {};
  return {
    getItem: k => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; }
  };
}
function makeSandbox() {
  const noop = function () {};
  const sandbox = {};
  sandbox.window = sandbox; sandbox.console = console;
  sandbox.addEventListener = noop; sandbox.removeEventListener = noop; sandbox.dispatchEvent = noop;
  sandbox.PHF_BUILD_INFO = { version: 'test', fingerprint: 'test' };
  sandbox.document = {
    documentElement: { setAttribute: noop, getAttribute: () => null }, addEventListener: noop, removeEventListener: noop,
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    createElement: () => ({ style: {}, setAttribute: noop, addEventListener: noop, classList: { add: noop, remove: noop } }),
    body: { classList: { add: noop, remove: noop } }, readyState: 'complete'
  };
  sandbox.location = { pathname: '/admin/checklist/mau-checklist', search: '', hash: '', origin: 'http://localhost' };
  sandbox.history = { pushState: noop, replaceState: noop, state: null };
  sandbox.localStorage = makeLocalStorage();
  sandbox.sessionStorage = makeLocalStorage();
  sandbox.navigator = { userAgent: 'node-test' };
  sandbox.matchMedia = null;
  sandbox.MutationObserver = function () { return { observe: noop, disconnect: noop }; };
  sandbox.fetch = fetchBridge;
  sandbox.URL = URL; sandbox.setTimeout = setTimeout; sandbox.clearTimeout = clearTimeout;
  sandbox.requestAnimationFrame = fn => setTimeout(fn, 0);
  sandbox.CSS = { escape: v => String(v) };
  sandbox.__phfLocalData = null;
  const ctx = vm.createContext(sandbox);
  compiled.runInContext(ctx);
  return ctx.window;
}
async function hydratedTab() {
  const listing = await templatesLib.listChecklistTemplates();
  const win = makeSandbox();
  win.__phfLocalData = { checklistTemplatesReady: true, checklistTemplates: clone(listing.templates) };
  win.__ceTest.templateUiState.selectedId = 'tc-criteria-test';
  win.__ceTest.ensureChecklistTemplatesHydrated();
  return win.__ceTest;
}
function api_flatten(groups) {
  const out = [];
  (groups || []).forEach(g => (g.children || []).forEach(c => (c.items || []).forEach(i => out.push(String(i[0])))));
  return out;
}

async function main() {
  // -------------------------------------------------------------------
  // CASE 1 — add a criterion, publish, refetch confirms
  // -------------------------------------------------------------------
  await rec('CASE 1 — add criterion in workspace, publish, new version persisted (refetch confirms)', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('tc-criteria-test');
    const res = api.ceAddCriterion(state, { groupCode: 'G1', childCode: 'C1', code: 'TCT-03', content: 'Tiêu chí mới CASE 1', factor: 1 });
    assert.strictEqual(res.ok, true, 'ceAddCriterion should succeed: ' + JSON.stringify(res.errors || []));
    state.effectiveDate = '2026-09-15'; state.reason = 'CASE 1 thêm tiêu chí mới'; state.newVersion = api.nextTemplateVersion(state.oldVersion);
    const payload = await api.cePublish(state);
    assert.ok(payload.version, 'publish returned a version');
    // refetch straight from the backend (fresh read, not the in-memory frontend cache)
    const fresh = await templatesLib.listChecklistTemplates();
    const row = fresh.templates.find(t => t.templateKey === 'tc-criteria-test');
    const currentVersion = row.versions.find(v => v.version === row.version);
    assert.ok(api_flatten(currentVersion.definition.groups).includes('TCT-03'), 'new current version contains TCT-03');
  });

  // -------------------------------------------------------------------
  // CASE 2 — edit content, publish; old version fetched directly is unchanged
  // -------------------------------------------------------------------
  await rec('CASE 2 — edit criterion content, publish; OLD version fetched directly is byte-for-byte unchanged', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('tc-criteria-test');
    const before = clone(store.checklist_template_versions.find(v => v.version_no === 'TCT-1.0').definition);
    const res = api.ceEditCriterion(state, 'TCT-02', { content: 'Tiêu chí hai (đã sửa)', factor: 3 });
    assert.strictEqual(res.ok, true, 'ceEditCriterion should succeed: ' + JSON.stringify(res.errors || []));
    state.effectiveDate = '2026-09-16'; state.reason = 'CASE 2 sửa nội dung'; state.newVersion = api.nextTemplateVersion(state.oldVersion);
    await api.cePublish(state);
    const fresh = await templatesLib.listChecklistTemplates();
    const row = fresh.templates.find(t => t.templateKey === 'tc-criteria-test');
    const newVer = row.versions.find(v => v.version === row.version);
    const editedItem = newVer.definition.groups[0].children[0].items.find(i => i[0] === 'TCT-02');
    assert.strictEqual(editedItem[1], 'Tiêu chí hai (đã sửa)', 'new version reflects edited content');
    assert.strictEqual(editedItem[2], 3, 'new version reflects edited factor');
    const oldVer = row.versions.find(v => v.version === 'TCT-1.0');
    assert.deepStrictEqual(oldVer.definition, before, 'OLD version TCT-1.0 definition is byte-for-byte unchanged');
  });

  // -------------------------------------------------------------------
  // CASE 3 — invalid factor rejected client-side AND backend-side
  // -------------------------------------------------------------------
  await rec('CASE 3a — client-side: ceAddCriterion rejects factor=0 and factor=-1', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('tc-criteria-test');
    const zero = api.ceAddCriterion(state, { groupCode: 'G1', childCode: 'C1', code: 'TCT-BAD1', content: 'x', factor: 0 });
    const neg = api.ceAddCriterion(state, { groupCode: 'G1', childCode: 'C1', code: 'TCT-BAD2', content: 'x', factor: -1 });
    assert.strictEqual(zero.ok, false, 'factor=0 rejected');
    assert.strictEqual(neg.ok, false, 'factor=-1 rejected');
    assert.ok(zero.errors.some(e => e.key === 'factor'), 'factor=0 error is keyed to factor field');
  });
  await rec('CASE 3b — backend: saveOne/validateGroupsDefinition rejects factor<=0 even if client guard is bypassed', async () => {
    resetStore();
    const badDefinition = {
      templateType: 'checklist_detail',
      groups: [{ code: 'G1', name: 'Nhóm 1', children: [{ code: 'C1', name: 'Nhóm con 1', items: [['TCT-BAD', 'x', 0]] }] }],
      totalRows: store.checklist_template_versions[0].definition.totalRows
    };
    await assert.rejects(
      () => templatesLib.saveChecklistTemplate(ADMIN, { templateKey: 'tc-criteria-test', code: 'TCT', name: 'Mẫu kiểm thử CRUD tiêu chí', groupName: 'Kiểm thử', templateType: 'checklist_detail', hasChecklist: true, status: 'active', version: 'TCT-9.1', effectiveDate: '2026-09-20', reason: 'bad factor', definition: badDefinition }),
      /CHECKLIST_TEMPLATE_CRITERION_FACTOR_INVALID|hệ số/i,
      'backend rejects factor<=0'
    );
  });

  // -------------------------------------------------------------------
  // CASE 4 — add then remove in same session -> never sent to backend
  // -------------------------------------------------------------------
  await rec('CASE 4 — add-then-remove-before-publish never reaches the backend at all', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('tc-criteria-test');
    const addRes = api.ceAddCriterion(state, { groupCode: 'G1', childCode: 'C1', code: 'TCT-TEMP', content: 'Sẽ bị xóa', factor: 1 });
    assert.strictEqual(addRes.ok, true);
    assert.ok(api.ceCriterionList(state).some(c => c.code === 'TCT-TEMP'), 'code present right after add');
    assert.strictEqual(api.ceIsHardDeletable(state, 'TCT-TEMP'), true, 'a code added this session (never published) is hard-deletable');
    const removed = api.ceRemoveDraftCriterion(state, 'TCT-TEMP');
    assert.strictEqual(removed, true, 'remove-draft succeeds for a session-added code');
    assert.ok(!api.ceCriterionList(state).some(c => c.code === 'TCT-TEMP'), 'code fully gone from the working set');
    // publish whatever remains (no TCT-TEMP) and confirm the backend never saw it
    const rpcCountBefore = rpcCalls.length;
    state.effectiveDate = '2026-09-17'; state.reason = 'CASE 4 add-then-remove'; state.newVersion = api.nextTemplateVersion(state.oldVersion);
    await api.cePublish(state);
    assert.ok(rpcCalls.length > rpcCountBefore, 'publish did make exactly one RPC call for the remaining (unrelated) session');
    const lastRpc = rpcCalls[rpcCalls.length - 1];
    assert.ok(!JSON.stringify(lastRpc.params.p_version.definition).includes('TCT-TEMP'), 'TCT-TEMP never appears in any payload sent to the backend');
  });

  // -------------------------------------------------------------------
  // CASE 5 — hard-delete disallowed for a previously-published code (UI model);
  // backend does NOT reject a normal next version that simply omits it.
  // -------------------------------------------------------------------
  await rec('CASE 5 — UI model disallows hard delete of a previously-published code; backend allows omission (discontinuation)', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('tc-criteria-test');
    assert.strictEqual(api.ceIsHardDeletable(state, 'TCT-01'), false, 'TCT-01 (published in TCT-1.0) is NOT hard-deletable');
    const hardRemoveAttempt = api.ceRemoveDraftCriterion(state, 'TCT-01');
    assert.strictEqual(hardRemoveAttempt, false, 'ceRemoveDraftCriterion refuses to hard-remove a published code');
    assert.ok(api.ceCriterionList(state).some(c => c.code === 'TCT-01'), 'TCT-01 still present after refused hard-delete attempt');
    // now build a "normal next version" payload that simply omits TCT-01 (as a plain object,
    // simulating what a legitimate discontinuation looks like on the wire) and confirm the
    // BACKEND does not throw for the omission itself.
    const omittingDefinition = clone(store.checklist_template_versions[0].definition);
    omittingDefinition.groups[0].children[0].items = omittingDefinition.groups[0].children[0].items.filter(i => i[0] !== 'TCT-01');
    await templatesLib.saveChecklistTemplate(ADMIN, { templateKey: 'tc-criteria-test', code: 'TCT', name: 'Mẫu kiểm thử CRUD tiêu chí', groupName: 'Kiểm thử', templateType: 'checklist_detail', hasChecklist: true, status: 'active', version: 'TCT-2.0', effectiveDate: '2026-09-18', reason: 'CASE 5 discontinue via omission', definition: omittingDefinition });
    // no throw = pass; also confirm it actually persisted this way
    const row = store.checklist_templates.find(t => t.template_key === 'tc-criteria-test');
    assert.strictEqual(row.current_version, 'TCT-2.0');
  });

  // -------------------------------------------------------------------
  // CASE 6 — discontinue a used criterion; old version unaffected
  // -------------------------------------------------------------------
  await rec('CASE 6 — discontinue used criterion via workspace; new version excludes it, old version keeps it unchanged', async () => {
    resetStore();
    const api = await hydratedTab();
    const before = clone(store.checklist_template_versions.find(v => v.version_no === 'TCT-1.0').definition);
    const state = api.ceOpen('tc-criteria-test');
    assert.strictEqual(api.ceIsHardDeletable(state, 'TCT-01'), false);
    const ok = api.ceDiscontinueCriterion(state, 'TCT-01');
    assert.strictEqual(ok, true, 'discontinue succeeds for a published code');
    assert.ok(!api.ceCriterionList(state).some(c => c.code === 'TCT-01'), 'TCT-01 excluded from the working set');
    state.effectiveDate = '2026-09-19'; state.reason = 'CASE 6 ngưng áp dụng TCT-01'; state.newVersion = api.nextTemplateVersion(state.oldVersion);
    await api.cePublish(state);
    const fresh = await templatesLib.listChecklistTemplates();
    const row = fresh.templates.find(t => t.templateKey === 'tc-criteria-test');
    const newVer = row.versions.find(v => v.version === row.version);
    assert.ok(!api_flatten(newVer.definition.groups).includes('TCT-01'), 'new current version does not have TCT-01');
    const oldVer = row.versions.find(v => v.version === 'TCT-1.0');
    assert.deepStrictEqual(oldVer.definition, before, 'old version TCT-1.0 still has TCT-01, unchanged');
  });

  // -------------------------------------------------------------------
  // CASE 7 — reorder, publish, refetch (simulate reload), order persisted
  // -------------------------------------------------------------------
  await rec('CASE 7 — reorder criteria within a child, publish, refetch confirms new order persisted from DB', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('tc-criteria-test');
    assert.deepStrictEqual(Array.from(api.ceCriterionList(state).map(c => c.code)), ['TCT-01', 'TCT-02'], 'initial order TCT-01, TCT-02');
    const moved = api.ceMoveCriterion(state, 'TCT-02', 'up');
    assert.strictEqual(moved, true);
    assert.deepStrictEqual(Array.from(api.ceCriterionList(state).map(c => c.code)), ['TCT-02', 'TCT-01'], 'in-session order now TCT-02, TCT-01');
    state.effectiveDate = '2026-09-20'; state.reason = 'CASE 7 sắp xếp lại'; state.newVersion = api.nextTemplateVersion(state.oldVersion);
    await api.cePublish(state);
    // simulate a reload: fresh backend read, fresh sandbox/tab, fresh hydration
    const api2 = await hydratedTab();
    const state2 = api2.ceOpen('tc-criteria-test');
    assert.deepStrictEqual(Array.from(api2.ceCriterionList(state2).map(c => c.code)), ['TCT-02', 'TCT-01'], 'order TCT-02, TCT-01 persisted from DB after simulated reload');
  });

  // -------------------------------------------------------------------
  // CASE 8 — simulated backend failure during publish: no success path, data intact
  // -------------------------------------------------------------------
  await rec('CASE 8 — backend failure during publish: cePublish rejects, no version written, session data intact', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('tc-criteria-test');
    api.ceEditCriterion(state, 'TCT-01', { content: 'Sẽ không bao giờ được lưu', factor: 5 });
    // bypass the UI guard and inject an invalid item directly (simulates "something got past
    // the client validation" / a corrupt definition) so the BACKEND is what rejects the save.
    state.groups[0].children[0].items.push(['', 'thiếu mã', 1]);
    state.effectiveDate = '2026-09-21'; state.reason = 'CASE 8 sẽ lỗi'; state.newVersion = api.nextTemplateVersion(state.oldVersion);
    const versionCountBefore = store.checklist_template_versions.length;
    const currentVersionBefore = store.checklist_templates.find(t => t.template_key === 'tc-criteria-test').current_version;
    await assert.rejects(() => api.cePublish(state), /CHECKLIST_TEMPLATE_CRITERION_CODE_REQUIRED|mã tiêu chí/i, 'cePublish rejects on backend validation failure');
    assert.strictEqual(store.checklist_template_versions.length, versionCountBefore, 'no new version row was written');
    assert.strictEqual(store.checklist_templates.find(t => t.template_key === 'tc-criteria-test').current_version, currentVersionBefore, 'current_version unchanged');
    // the admin's edit is still sitting in the in-memory workspace, recoverable (not reset/lost)
    const stillThere = api.ceCriterionList(state).find(c => c.code === 'TCT-01');
    assert.strictEqual(stillThere.content, 'Sẽ không bao giờ được lưu', 'edit still present in workspace after failed publish');
  });

  // -------------------------------------------------------------------
  // CASE 9 — duplicate criterion code within one new version's groups
  // -------------------------------------------------------------------
  await rec('CASE 9 — duplicate criterion code in one version payload is rejected by validateGroupsDefinition; RPC never called', async () => {
    resetStore();
    const rpcCountBefore = rpcCalls.length;
    const dupDefinition = {
      templateType: 'checklist_detail',
      groups: [{ code: 'G1', name: 'Nhóm 1', children: [{ code: 'C1', name: 'Nhóm con 1', items: [['DUP-01', 'a', 1], ['DUP-01', 'b', 1]] }] }],
      totalRows: store.checklist_template_versions[0].definition.totalRows
    };
    let caughtDup = null;
    try {
      await templatesLib.saveChecklistTemplate(ADMIN, { templateKey: 'tc-criteria-test', code: 'TCT', name: 'Mẫu kiểm thử CRUD tiêu chí', groupName: 'Kiểm thử', templateType: 'checklist_detail', hasChecklist: true, status: 'active', version: 'TCT-9.9', effectiveDate: '2026-09-22', reason: 'dup test', definition: dupDefinition });
    } catch (e) { caughtDup = e; }
    assert.ok(caughtDup, 'duplicate code payload was rejected (threw)');
    assert.strictEqual(caughtDup.code, 'CHECKLIST_TEMPLATE_CRITERION_DUPLICATE_CODE', 'rejected with the correct error code');
    assert.strictEqual(rpcCalls.length, rpcCountBefore, 'RPC was never called — validation happens before the RPC');
  });
  check(typeof templatesLib.validateGroupsDefinition === 'function', 'checklist-templates.js exports validateGroupsDefinition()');

  // -------------------------------------------------------------------
  // CASE 10 — concurrency: stale expected_updated_at still rejected (unchanged behavior)
  // -------------------------------------------------------------------
  await rec('CASE 10 — two-tab concurrency: second publish with a stale local snapshot hits CHECKLIST_TEMPLATE_STALE', async () => {
    resetStore();
    const tabA = await hydratedTab();
    const tabB = await hydratedTab(); // hydrated from the SAME initial backend snapshot, independent JS realm
    const stateA = tabA.ceOpen('tc-criteria-test');
    tabA.ceEditCriterion(stateA, 'TCT-01', { content: 'Sửa từ tab A', factor: 1 });
    stateA.effectiveDate = '2026-09-23'; stateA.reason = 'Tab A publish trước'; stateA.newVersion = tabA.nextTemplateVersion(stateA.oldVersion);
    await tabA.cePublish(stateA); // advances backend updated_at; tabB's cached snapshot is now stale

    const stateB = tabB.ceOpen('tc-criteria-test'); // tabB's checklistTemplateDbState is untouched by tab A's publish
    tabB.ceEditCriterion(stateB, 'TCT-02', { content: 'Sửa từ tab B (đụng độ)', factor: 1 });
    stateB.effectiveDate = '2026-09-24'; stateB.reason = 'Tab B publish sau (stale)'; stateB.newVersion = tabB.nextTemplateVersion(stateB.oldVersion);
    let caught = null;
    try { await tabB.cePublish(stateB); } catch (e) { caught = e; }
    assert.ok(caught, 'tab B publish threw');
    assert.match(String(caught.code || caught.message || ''), /CHECKLIST_TEMPLATE_STALE/, 'stale error surfaced to the caller');
  });

  console.log('\n' + passed + ' passed, ' + failures + ' failed.');
  if (failures) process.exit(1);
}

main().catch(e => { console.error('UNCAUGHT', e); process.exit(1); });
