'use strict';
/*
 * Regression — Checklist Criterion Simplify V1 — Part A (Criterion Admin UX simplification)
 * + Part B (inline "+ Thêm nhóm nội dung") + Part C (discontinue safety, re-verified).
 *
 * Covers spec items 1, 2, 3, 4, 5, 6 (Part H of the task spec):
 *  1. Add criterion -> Lưu & áp dụng -> appears in current applied criteria.
 *  2. Edit criterion -> current config reflects edit.
 *  3. Discontinue criterion -> removed from current config, historical version intact.
 *  4. Add new group "Vận hành" -> save succeeds -> criterion can belong to it -> current
 *     config renders it.
 *  5. Duplicate structural group/child (g.code===c.code) -> UI renders one clean label,
 *     not "X / X".
 *  6. Criterion Admin normal workflow exposes no publish/activate requirement in visible
 *     copy/labels (absence of "Phát hành phiên bản mới"/"Kích hoạt phiên bản" in the
 *     rendered HTML of checklistCeEditorHtml()/cePreviewHtml()).
 *
 * Same offline convention as scripts/test-checklist-criterion-admin-2026-09.js: real
 * assets/js/checklist/phf-checklist-app.js loaded in a vm sandbox, real api/_lib/
 * checklist-templates.js backend with @supabase/supabase-js stubbed in-memory. No real
 * Supabase project, no network, no PROD database touched anywhere in this file.
 *
 *   node scripts/test-checklist-criterion-simplify-v1-part-ab.js
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
      template_key: 'tc-ab-test', code: 'TAB', name: 'Mẫu kiểm thử Part A/B',
      group_name: 'Kiểm thử', template_type: 'checklist_detail', has_checklist: true,
      source: '', note: '', status: 'active', current_version: 'TAB-1.0',
      effective_date: '2026-07-01', updated_at: '2026-07-01T00:00:00.000Z'
    }],
    checklist_template_versions: [{
      template_key: 'tc-ab-test', version_no: 'TAB-1.0', effective_date: '2026-07-01',
      reason: 'Khởi tạo mẫu kiểm thử', source_version: '', change_type: 'sync',
      definition: {
        templateType: 'checklist_detail',
        groups: [{ code: 'G1', name: 'Nhóm 1', children: [{ code: 'C1', name: 'Nhóm con 1', items: [
          ['TAB-01', 'Tiêu chí một', 1],
          ['TAB-02', 'Tiêu chí hai', 2]
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
    tpl.updated_at = new Date(Date.now() + rpcCalls.length).toISOString();
    return { data: { ok: true, templateKey: key, version: ver }, error: null };
  }
  return { data: null, error: { message: 'unmocked rpc ' + name } };
}

const orig = Module._load;
Module._load = function (req) {
  if (req === '@supabase/supabase-js') return { createClient: () => ({ from: t => new FakeQuery(t), rpc: (n, p) => fakeRpc(n, p) }) };
  return orig.apply(this, arguments);
};
const templatesLib = require(path.join(root, 'api', '_lib', 'checklist-templates.js'));
Module._load = orig;

const ADMIN = { role: 'admin', account: { id: 'admin-1', name: 'Admin Test' }, sub: 'admin-1' };

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
  "    ceMoveCriterion:ceMoveCriterion, ceAddGroup:ceAddGroup, ceGroupChildLabel:ceGroupChildLabel,\n" +
  "    ceValidateSession:ceValidateSession, ceIsHardDeletable:ceIsHardDeletable, ceCriterionList:ceCriterionList,\n" +
  "    cePublish:cePublish, getCeState:function(){return checklistCeState;},\n" +
  "    checklistCeEditorHtml:checklistCeEditorHtml, cePreviewHtml:cePreviewHtml,\n" +
  "    templateCatalog:templateCatalog, templateUiState:templateUiState,\n" +
  "    ensureChecklistTemplatesHydrated:ensureChecklistTemplatesHydrated, nextTemplateVersion:nextTemplateVersion,\n" +
  "    flattenCriteria:flattenCriteria, checklistTemplateDbState:checklistTemplateDbState,\n" +
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
async function fetchBridge(url, opts) {
  let body = {};
  try { body = JSON.parse((opts && opts.body) || '{}'); } catch (_) {}
  const action = body.action;
  try {
    if (action === 'saveChecklistTemplate') {
      const result = await templatesLib.saveChecklistTemplate(ADMIN, body.template);
      return { ok: true, status: 200, json: async () => Object.assign({ ok: true }, result) };
    }
    return { ok: false, status: 400, json: async () => ({ ok: false, message: 'unknown action: ' + action }) };
  } catch (error) {
    return { ok: false, status: error.statusCode || 500, json: async () => ({ ok: false, message: error.message, code: error.code || '' }) };
  }
}
async function hydratedTab() {
  const listing = await templatesLib.listChecklistTemplates();
  const win = makeSandbox();
  win.__phfLocalData = { checklistTemplatesReady: true, checklistTemplates: clone(listing.templates) };
  win.__ceTest.templateUiState.selectedId = 'tc-ab-test';
  win.__ceTest.ensureChecklistTemplatesHydrated();
  return win.__ceTest;
}
function api_flatten(groups) {
  const out = [];
  (groups || []).forEach(g => (g.children || []).forEach(c => (c.items || []).forEach(i => out.push(String(i[0])))));
  return out;
}
async function publish(api, state, reason) {
  state.newVersion = api.nextTemplateVersion(state.oldVersion);
  state.effectiveDate = '2026-09-15'; state.reason = reason || 'Kiểm thử';
  return api.cePublish(state);
}

async function main() {
  // -------------------------------------------------------------------
  // ITEM 1 — add criterion -> Lưu & áp dụng -> appears in current applied criteria
  // -------------------------------------------------------------------
  await rec('ITEM 1 — add criterion, Lưu & áp dụng, appears in current applied config', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('tc-ab-test');
    const res = api.ceAddCriterion(state, { groupCode: 'G1', childCode: 'C1', code: 'TAB-03', content: 'Tiêu chí mới', factor: 1 });
    assert.strictEqual(res.ok, true, JSON.stringify(res.errors || []));
    await publish(api, state, 'ITEM 1 thêm tiêu chí mới');
    const fresh = await templatesLib.listChecklistTemplates();
    const row = fresh.templates.find(t => t.templateKey === 'tc-ab-test');
    const current = row.versions.find(v => v.version === row.version);
    assert.ok(api_flatten(current.definition.groups).includes('TAB-03'), 'current applied config contains TAB-03');
  });

  // -------------------------------------------------------------------
  // ITEM 2 — edit criterion -> current config reflects edit
  // -------------------------------------------------------------------
  await rec('ITEM 2 — edit criterion content, current config reflects the edit', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('tc-ab-test');
    const res = api.ceEditCriterion(state, 'TAB-02', { content: 'Tiêu chí hai (đã sửa)', factor: 5 });
    assert.strictEqual(res.ok, true, JSON.stringify(res.errors || []));
    await publish(api, state, 'ITEM 2 sửa nội dung');
    const fresh = await templatesLib.listChecklistTemplates();
    const row = fresh.templates.find(t => t.templateKey === 'tc-ab-test');
    const current = row.versions.find(v => v.version === row.version);
    const item = current.definition.groups[0].children[0].items.find(i => i[0] === 'TAB-02');
    assert.strictEqual(item[1], 'Tiêu chí hai (đã sửa)');
    assert.strictEqual(item[2], 5);
  });

  // -------------------------------------------------------------------
  // ITEM 3 — discontinue -> removed from current config, historical version intact
  // -------------------------------------------------------------------
  await rec('ITEM 3 — discontinue criterion: removed from current config, historical version unchanged', async () => {
    resetStore();
    const api = await hydratedTab();
    const before = clone(store.checklist_template_versions.find(v => v.version_no === 'TAB-1.0').definition);
    const state = api.ceOpen('tc-ab-test');
    const ok = api.ceDiscontinueCriterion(state, 'TAB-01');
    assert.strictEqual(ok, true);
    await publish(api, state, 'ITEM 3 ngưng áp dụng TAB-01');
    const fresh = await templatesLib.listChecklistTemplates();
    const row = fresh.templates.find(t => t.templateKey === 'tc-ab-test');
    const current = row.versions.find(v => v.version === row.version);
    assert.ok(!api_flatten(current.definition.groups).includes('TAB-01'), 'current config no longer has TAB-01');
    const historical = row.versions.find(v => v.version === 'TAB-1.0');
    assert.deepStrictEqual(historical.definition, before, 'historical TAB-1.0 definition is byte-for-byte unchanged (no hard-delete/history mutation)');
  });

  // -------------------------------------------------------------------
  // ITEM 4 — add new group "Vận hành" -> save succeeds -> criterion can belong to it
  // -> current config renders it
  // -------------------------------------------------------------------
  await rec('ITEM 4 — ceAddGroup("Vận hành"), assign a criterion to it, publish, current config renders it', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('tc-ab-test');
    const before = clone(state.groups);
    const gres = api.ceAddGroup(state, { name: 'Vận hành' });
    assert.strictEqual(gres.ok, true, JSON.stringify(gres.errors || []));
    assert.strictEqual(state.groups.length, before.length + 1, 'a new group was appended to the in-session working set');
    const newGroup = state.groups[state.groups.length - 1];
    assert.strictEqual(newGroup.name, 'Vận hành');
    assert.strictEqual(newGroup.code, gres.code);
    assert.strictEqual(newGroup.children.length, 1, 'new group auto-clones exactly one child (flat mental model)');
    assert.strictEqual(newGroup.children[0].code, newGroup.code, 'auto-created child shares the group code (drives the duplicate-label fix)');
    // group only exists in-session until publish — not sent to the backend yet.
    assert.strictEqual(store.checklist_template_versions.length, 1, 'no version written yet — group is session-only pre-publish');
    const cres = api.ceAddCriterion(state, { groupCode: newGroup.code, childCode: newGroup.children[0].code, code: 'TAB-VH-01', content: 'Vệ sinh khu vực vận hành', factor: 2 });
    assert.strictEqual(cres.ok, true, JSON.stringify(cres.errors || []));
    await publish(api, state, 'ITEM 4 thêm nhóm Vận hành');
    const fresh = await templatesLib.listChecklistTemplates();
    const row = fresh.templates.find(t => t.templateKey === 'tc-ab-test');
    const current = row.versions.find(v => v.version === row.version);
    const vhGroup = current.definition.groups.find(g => g.name === 'Vận hành');
    assert.ok(vhGroup, 'current applied config renders the new "Vận hành" group');
    assert.ok(api_flatten(current.definition.groups).includes('TAB-VH-01'), 'current applied config contains the criterion assigned to the new group');
  });

  await rec('ITEM 4b — ceAddGroup rejects empty name and duplicate group name; codes stay collision-free within one session', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('tc-ab-test');
    const empty = api.ceAddGroup(state, { name: '' });
    assert.strictEqual(empty.ok, false, 'empty name rejected');
    const dup = api.ceAddGroup(state, { name: 'Nhóm 1' });
    assert.strictEqual(dup.ok, false, 'duplicate group name (case-insensitive) rejected');
    const first = api.ceAddGroup(state, { name: 'Vận hành' });
    assert.strictEqual(first.ok, true);
    const second = api.ceAddGroup(state, { name: 'Vận hành 2' });
    assert.strictEqual(second.ok, true);
    assert.notStrictEqual(first.code, second.code, 'two groups never collide on the generated code');
  });

  // -------------------------------------------------------------------
  // ITEM 5 — duplicate structural group/child renders one clean label
  // -------------------------------------------------------------------
  await rec('ITEM 5 — g.code===c.code renders a single clean label, not "Tên / Tên"', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('tc-ab-test');
    const gres = api.ceAddGroup(state, { name: 'Vận hành' });
    assert.strictEqual(gres.ok, true);
    const g = state.groups.find(x => x.code === gres.code), c = g.children[0];
    assert.strictEqual(api.ceGroupChildLabel(g, c), 'Vận hành', 'ceGroupChildLabel collapses to a single name when g.code===c.code');
    assert.notStrictEqual(api.ceGroupChildLabel(g, c), 'Vận hành / Vận hành');
    // also assert via the ORIGINAL structural group (G1/C1, distinct names) that the
    // fix does NOT collapse genuinely different group/child names.
    const g1 = state.groups.find(x => x.code === 'G1'), c1 = g1.children[0];
    assert.strictEqual(api.ceGroupChildLabel(g1, c1), 'Nhóm 1 / Nhóm con 1', 'distinct group/child names are still shown as "Group / Child"');
    // render the actual editor HTML and confirm no "Vận hành / Vận hành" duplicate string appears
    const cres = api.ceAddCriterion(state, { groupCode: g.code, childCode: c.code, code: 'TAB-VH-02', content: 'Kiểm tra vận hành', factor: 1 });
    assert.strictEqual(cres.ok, true);
    const html = api.checklistCeEditorHtml();
    assert.ok(!html.includes('Vận hành / Vận hành'), 'rendered criteria table never shows the duplicate "Vận hành / Vận hành" label');
    assert.ok(html.includes('>Vận hành<'), 'rendered criteria table shows the clean single-name label for the new group');
  });

  // -------------------------------------------------------------------
  // ITEM 6 — normal workflow exposes no publish/activate jargon in visible copy
  // -------------------------------------------------------------------
  await rec('ITEM 6 — checklistCeEditorHtml()/cePreviewHtml() never render "Phát hành phiên bản mới" or "Kích hoạt phiên bản"', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('tc-ab-test');
    api.ceAddCriterion(state, { groupCode: 'G1', childCode: 'C1', code: 'TAB-06', content: 'Tiêu chí kiểm tra copy', factor: 1 });
    const editorHtml = api.checklistCeEditorHtml();
    assert.ok(!editorHtml.includes('Phát hành phiên bản mới'), 'editor HTML has no "Phát hành phiên bản mới"');
    assert.ok(!editorHtml.includes('Kích hoạt phiên bản'), 'editor HTML has no "Kích hoạt phiên bản"');
    assert.ok(editorHtml.includes('Lưu & áp dụng'), 'editor HTML uses the simplified "Lưu & áp dụng" label');
    state.newVersion = api.nextTemplateVersion(state.oldVersion); state.effectiveDate = '2026-09-15'; state.reason = 'ITEM 6';
    const previewHtml = api.cePreviewHtml({ templateId: state.templateId, oldVersion: state.oldVersion, newVersion: state.newVersion, effectiveDate: state.effectiveDate, reason: state.reason, state: state });
    assert.ok(!previewHtml.includes('Phát hành phiên bản mới'), 'preview HTML has no "Phát hành phiên bản mới"');
    assert.ok(!previewHtml.includes('Kích hoạt phiên bản'), 'preview HTML has no "Kích hoạt phiên bản"');
    assert.ok(previewHtml.includes('Lưu & áp dụng'), 'preview HTML CTA uses the simplified "Lưu & áp dụng" label');
  });

  console.log('\n' + passed + ' passed, ' + failures + ' failed.');
  if (failures) process.exit(1);
}

main().catch(e => { console.error('UNCAUGHT', e); process.exit(1); });
