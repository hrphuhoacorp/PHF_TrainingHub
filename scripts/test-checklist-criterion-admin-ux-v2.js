'use strict';
/*
 * Regression — Checklist Criterion Admin UX V2 (fixes the confirmed PROD bug: admin adds a
 * criterion to ke-toan-truong, clicks "Lưu & áp dụng", a real new version is created (KTT
 * 2.3) but its definition is materially identical to the prior version — the intended new
 * criterion never made it in, because the old UI required a SEPARATE "+ Thêm tiêu chí"
 * click to commit the mini-form into session state before "Lưu & áp dụng" would read it).
 *
 * This batch:
 *  A/B. "Lưu & áp dụng" itself auto-captures whatever is currently filled in the visible
 *       add-criterion mini-form (ceSaveAndApply/ceReadAddFormRaw/ceCommitAddFormRaw) — no
 *       separate required commit click. UX V2 follow-up: the optional "+ Thêm tiêu chí khác"
 *       staging button has been removed entirely (confusing in manual testing, no clear
 *       feedback) — one add flow = one criterion; ceCommitAddFormRaw is still exercised
 *       directly by these tests (it also backs the auto-capture path), it's just no longer
 *       wired to a standalone button/click handler in the UI.
 *  C.   Criterion code and group code are both auto-generated (ceSlugifyCriterionCode,
 *       reusing the same style as the pre-existing ceSlugifyGroupCode), collision-safe.
 *  D.   No manual "Ngày hiệu lực" in the normal flow — auto-set to today (state.effectiveDate,
 *       set once at ceOpen and left alone).
 *  E.   "+ Tạo nhóm mới..." is now inline in the "Thuộc nhóm" dropdown of the SAME form (no
 *       separate competing "+ Thêm nhóm nội dung" mini-form any more).
 *  F.   Zero-net-change guard (ceHasSemanticChange) — no real change -> no RPC, no new
 *       version, "Chưa có thay đổi để áp dụng." This is the guard that directly closes the
 *       PROD bug class: an intended-but-uncommitted add now either gets captured for real
 *       (A/B) or, if truly nothing changed, blocks the save outright instead of silently
 *       publishing a no-op version.
 *  G.   Action column layout polish (↑ ↓ Sửa ⋯) — no behavior change (covered by regression
 *       items 10/11 here; full suite re-run separately, see below).
 *
 * Covers spec items 1-9, 12, 16 directly here. Items 10/11/13/14/15 are covered by RE-RUNNING
 * the pre-existing, untouched test files (they exercise ceEditCriterion/ceDiscontinueCriterion
 * /checklistRetroOfferCurrentPeriod/checklist-monthly.js directly — see the operator's test
 * run log for their pass/fail, not duplicated here to avoid fragmenting coverage).
 *
 * Same offline convention as scripts/test-checklist-criterion-simplify-v1-part-ab.js: real
 * assets/js/checklist/phf-checklist-app.js loaded in a vm sandbox, real api/_lib/
 * checklist-templates.js backend with @supabase/supabase-js stubbed in-memory. checklistToast
 * is stubbed to a no-op the same way scripts/test-checklist-monthly-lock-incomplete-ui-2026-09.js
 * does, since the real implementation needs a fuller DOM than this offline harness builds.
 * No real Supabase project, no network, no PROD database touched anywhere in this file.
 *
 *   node scripts/test-checklist-criterion-admin-ux-v2.js
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
// In-memory fake Supabase (checklist_templates / checklist_template_versions only) — a
// "ke-toan-truong"-shaped fixture (2 existing criteria in one group) mirrors the confirmed
// PROD scenario (KTT 2.2 -> intended-2.3).
// ---------------------------------------------------------------------------
let store, rpcCalls;
function resetStore() {
  store = {
    checklist_templates: [{
      template_key: 'ktt-ux-v2-test', code: 'KTT', name: 'Mẫu kiểm thử Kế toán trưởng',
      group_name: 'Kiểm thử', template_type: 'checklist_detail', has_checklist: true,
      source: '', note: '', status: 'active', current_version: 'KTT-2.2',
      effective_date: '2026-07-01', updated_at: '2026-07-01T00:00:00.000Z'
    }],
    checklist_template_versions: [{
      template_key: 'ktt-ux-v2-test', version_no: 'KTT-2.2', effective_date: '2026-07-01',
      reason: 'Khởi tạo mẫu kiểm thử', source_version: '', change_type: 'sync',
      definition: {
        templateType: 'checklist_detail',
        groups: [{ code: 'G1', name: 'Nhóm 1', children: [{ code: 'C1', name: 'Nhóm con 1', items: [
          ['KTT-01', 'Tiêu chí một', 1],
          ['KTT-02', 'Tiêu chí hai', 2]
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
// vm sandbox loading the REAL frontend source, one factory per "browser tab". checklistToast
// is neutered to a no-op (same technique as
// scripts/test-checklist-monthly-lock-incomplete-ui-2026-09.js) since the real implementation
// needs a fuller DOM (toast host, button, requestAnimationFrame-driven classlist) than this
// offline harness constructs — none of the assertions below depend on toast *rendering*,
// only on the control-flow decisions (blocked vs proceeded) that precede it.
// ---------------------------------------------------------------------------
const filePath = 'assets/js/checklist/phf-checklist-app.js';
const src = fs.readFileSync(path.join(root, filePath), 'utf8');
const marker = '\n})();';
const idx = src.lastIndexOf(marker);
const expose = "\n  checklistToast=function(){};\n  window.__ceTest={\n" +
  "    ceOpen:ceOpen, ceAddCriterion:ceAddCriterion, ceEditCriterion:ceEditCriterion,\n" +
  "    ceDiscontinueCriterion:ceDiscontinueCriterion, ceRemoveDraftCriterion:ceRemoveDraftCriterion,\n" +
  "    ceMoveCriterion:ceMoveCriterion, ceMoveGroup:ceMoveGroup, ceMoveChild:ceMoveChild,\n" +
  "    ceAddGroup:ceAddGroup, ceGroupChildLabel:ceGroupChildLabel, ceSlugifyCriterionCode:ceSlugifyCriterionCode,\n" +
  "    ceExistingCriterionCodes:ceExistingCriterionCodes, ceHasSemanticChange:ceHasSemanticChange,\n" +
  "    ceReadAddFormRaw:ceReadAddFormRaw, ceAddFormRawIsBlank:ceAddFormRawIsBlank, ceCommitAddFormRaw:ceCommitAddFormRaw,\n" +
  "    ceSaveAndApply:ceSaveAndApply, getPendingCePublish:function(){return pendingCePublish;},\n" +
  "    ceValidateSession:ceValidateSession, ceIsHardDeletable:ceIsHardDeletable, ceCriterionList:ceCriterionList,\n" +
  "    cePublish:cePublish, getCeState:function(){return checklistCeState;},\n" +
  "    checklistCeEditorHtml:checklistCeEditorHtml, cePreviewHtml:cePreviewHtml,\n" +
  "    templateCatalog:templateCatalog, templateUiState:templateUiState,\n" +
  "    ensureChecklistTemplatesHydrated:ensureChecklistTemplatesHydrated, nextTemplateVersion:nextTemplateVersion,\n" +
  "    flattenCriteria:flattenCriteria, checklistTemplateDbState:checklistTemplateDbState,\n" +
  "    effectiveTemplateVersion:effectiveTemplateVersion, selectedTemplateGroups:selectedTemplateGroups,\n" +
  "    todayIso:todayIso\n" +
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
  win.__ceTest.templateUiState.selectedId = 'ktt-ux-v2-test';
  win.__ceTest.ensureChecklistTemplatesHydrated();
  return win.__ceTest;
}
function api_flatten(groups) {
  const out = [];
  (groups || []).forEach(g => (g.children || []).forEach(c => (c.items || []).forEach(i => out.push(String(i[0])))));
  return out;
}
function currentVersionRow(fresh) {
  const row = fresh.templates.find(t => t.templateKey === 'ktt-ux-v2-test');
  return row.versions.find(v => v.version === row.version);
}

// ---------------------------------------------------------------------------
// Fake DOM fixture for the "Thêm tiêu chí mới" mini-form + "Lý do thay đổi" field, exactly
// the set of selectors ceReadAddFormRaw/ceSaveAndApply/showInlineValidation/
// clearInlineValidation touch. Modeled after the same targeted-fixture style used by
// scripts/test-checklist-monthly-lock-incomplete-ui-2026-09.js's makeFakeRoot().
// ---------------------------------------------------------------------------
function makeFieldWrap() {
  const msg = { hidden: true, textContent: '' };
  const classes = {};
  return {
    classList: {
      add: c => { classes[c] = true; },
      remove: c => { delete classes[c]; },
      contains: c => !!classes[c]
    },
    querySelector: sel => (sel === '.phfck-field-error' ? msg : null),
    _msg: msg
  };
}
function makeCeAddFormModal(values) {
  values = values || {};
  const fields = {
    group: { value: values.groupVal != null ? values.groupVal : '' },
    groupName: { value: values.groupName != null ? values.groupName : '' },
    content: { value: values.content != null ? values.content : '' },
    factor: { value: values.factor != null ? String(values.factor) : '1' },
    reason: { value: values.reason != null ? values.reason : '' }
  };
  const addSummaryUl = { innerHTML: '' };
  const addSummary = { hidden: true, querySelector: sel => (sel === 'ul' ? addSummaryUl : null) };
  const wraps = { group: makeFieldWrap(), groupName: makeFieldWrap(), content: makeFieldWrap(), factor: makeFieldWrap(), reason: makeFieldWrap() };
  return {
    fields, wraps, addSummary,
    querySelector(sel) {
      if (sel === '[data-phfck-ce-add-group]') return fields.group;
      if (sel === '[data-phfck-ce-add-group-name]') return fields.groupName;
      if (sel === '[data-phfck-ce-add-content]') return fields.content;
      if (sel === '[data-phfck-ce-add-factor]') return fields.factor;
      if (sel === '[data-phfck-ce-reason]') return fields.reason;
      if (sel === '[data-phfck-ce-add-summary]') return addSummary;
      if (sel === '[data-phfck-edit-summary]') return null;
      const m = /^\[data-phfck-field-wrap="([a-zA-Z]+)"\]$/.exec(sel);
      if (m) return wraps[m[1]] || null;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '.is-invalid') return Object.keys(wraps).map(k => wraps[k]).filter(w => w.classList.contains('is-invalid'));
      if (sel === '.phfck-field-error') return Object.keys(wraps).map(k => wraps[k]._msg);
      return [];
    }
  };
}

async function main() {
  // -------------------------------------------------------------------
  // ITEM 1 (core regression) — fill the visible form, click "Lưu & áp dụng" directly, with
  // NO intermediate "+ Thêm tiêu chí khác" click. This is exactly the PROD KTT-2.3 scenario
  // inverted: here the criterion DOES make it into the published version.
  // -------------------------------------------------------------------
  await rec('ITEM 1 — visible form filled, ceSaveAndApply (== "Lưu & áp dụng") with NO prior add-button click -> criterion persisted', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('ktt-ux-v2-test');
    const modal = makeCeAddFormModal({ groupVal: 'G1::C1', content: 'Kiểm tra sổ quỹ hàng ngày', factor: 2, reason: 'ITEM 1 — thêm tiêu chí không bấm nút phụ' });
    const outcome = await api.ceSaveAndApply(null, modal);
    assert.strictEqual(outcome.ok, true, 'ok:' + JSON.stringify(outcome));
    assert.ok(api.ceCriterionList(state).some(c => c.content === 'Kiểm tra sổ quỹ hàng ngày'), 'criterion is in session state after Save, without any intermediate add click');
    const pending = api.getPendingCePublish();
    assert.ok(pending, 'pendingCePublish set (preview stage reached)');
    await api.cePublish(pending.state);
    const fresh = await templatesLib.listChecklistTemplates();
    const current = currentVersionRow(fresh);
    assert.ok(current.definition.groups.some(g => g.children.some(c => c.items.some(i => i[1] === 'Kiểm tra sổ quỹ hàng ngày'))), 'published current version contains the auto-captured criterion — THE core PROD bug fix');
  });

  // -------------------------------------------------------------------
  // ITEM 2 — create a new group + a criterion in that group, in ONE form session, ONE save.
  // -------------------------------------------------------------------
  await rec('ITEM 2 — "+ Tạo nhóm mới..." + criterion in one session, one save -> both persisted together, exactly one new version', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('ktt-ux-v2-test');
    const versionsBefore = store.checklist_template_versions.length;
    const modal = makeCeAddFormModal({ groupVal: '__new__', groupName: 'Ngân quỹ', content: 'Đối chiếu quỹ tiền mặt cuối ngày', factor: 3, reason: 'ITEM 2 — nhóm mới + tiêu chí mới' });
    const outcome = await api.ceSaveAndApply(null, modal);
    assert.strictEqual(outcome.ok, true, JSON.stringify(outcome));
    assert.ok(state.groups.some(g => g.name === 'Ngân quỹ'), 'new group "Ngân quỹ" exists in session');
    await api.cePublish(api.getPendingCePublish().state);
    assert.strictEqual(store.checklist_template_versions.length, versionsBefore + 1, 'exactly ONE new version row written for the combined group+criterion change');
    const fresh = await templatesLib.listChecklistTemplates();
    const current = currentVersionRow(fresh);
    const newGroup = current.definition.groups.find(g => g.name === 'Ngân quỹ');
    assert.ok(newGroup, 'current version renders the new group');
    assert.ok(api_flatten(current.definition.groups).some(code => current.definition.groups.some(g => g.name === 'Ngân quỹ' && g.children.some(c => c.items.some(i => i[1] === 'Đối chiếu quỹ tiền mặt cuối ngày')))), 'criterion landed inside the new group');
  });

  // -------------------------------------------------------------------
  // ITEM 3 — the newly created group is immediately selectable/usable in the SAME session:
  // add a SECOND criterion into the just-created group before saving.
  // -------------------------------------------------------------------
  await rec('ITEM 3 — group created via ceCommitAddFormRaw is immediately reusable for a second criterion in the same session (no duplicate group)', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('ktt-ux-v2-test');
    const first = api.ceCommitAddFormRaw(state, { groupVal: '__new__', groupName: 'Vận hành', content: 'Tiêu chí vận hành 1', factor: 1 });
    assert.strictEqual(first.ok, true, JSON.stringify(first.errors || []));
    const newGroup = state.groups.find(g => g.name === 'Vận hành');
    assert.ok(newGroup, 'group created');
    const second = api.ceCommitAddFormRaw(state, { groupVal: newGroup.code + '::' + newGroup.children[0].code, groupName: '', content: 'Tiêu chí vận hành 2', factor: 2 });
    assert.strictEqual(second.ok, true, JSON.stringify(second.errors || []));
    const groupsNamedVanHanh = state.groups.filter(g => g.name === 'Vận hành');
    assert.strictEqual(groupsNamedVanHanh.length, 1, 'exactly one "Vận hành" group — reused, not duplicated');
    assert.strictEqual(groupsNamedVanHanh[0].children[0].items.length, 2, 'both criteria landed in the same child of the same session-created group');
  });

  // -------------------------------------------------------------------
  // ITEM 4/5 — criterion code and group code auto-generated, collision-safe.
  // -------------------------------------------------------------------
  await rec('ITEM 4/5a — two new criteria added without any code -> distinct auto-generated codes, never colliding with each other or existing codes', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('ktt-ux-v2-test');
    const r1 = api.ceAddCriterion(state, { groupCode: 'G1', childCode: 'C1', content: 'Kiểm tra hóa đơn đầu vào', factor: 1 });
    const r2 = api.ceAddCriterion(state, { groupCode: 'G1', childCode: 'C1', content: 'Kiểm tra hóa đơn đầu ra', factor: 1 });
    assert.strictEqual(r1.ok, true, JSON.stringify(r1.errors || []));
    assert.strictEqual(r2.ok, true, JSON.stringify(r2.errors || []));
    assert.ok(r1.code, 'criterion 1 got a non-empty auto-generated code');
    assert.ok(r2.code, 'criterion 2 got a non-empty auto-generated code');
    assert.notStrictEqual(r1.code, r2.code, 'the two auto-generated codes never collide');
    assert.notStrictEqual(r1.code, 'KTT-01'); assert.notStrictEqual(r1.code, 'KTT-02');
    assert.notStrictEqual(r2.code, 'KTT-01'); assert.notStrictEqual(r2.code, 'KTT-02');
  });
  await rec('ITEM 4/5b — ceSlugifyCriterionCode collides on purpose (forced) -> resolver appends a numeric suffix instead of reusing the taken code', async () => {
    resetStore();
    const api = await hydratedTab();
    const existing = { 'G1_KIEM_TRA_SO_QUY': true };
    const generated = api.ceSlugifyCriterionCode('Kiểm tra sổ quỹ', 'G1', existing);
    assert.notStrictEqual(generated, 'G1_KIEM_TRA_SO_QUY', 'when the natural slug is already taken, a distinct code is produced');
    assert.ok(!existing[generated], 'the produced code is not one of the already-existing codes');
  });
  await rec('ITEM 5c — ceAddGroup: two different new group names in one session never collide on generated code (regression, still true post-refactor)', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('ktt-ux-v2-test');
    const g1 = api.ceAddGroup(state, { name: 'Ngân quỹ' });
    const g2 = api.ceAddGroup(state, { name: 'Ngân quỹ 2' });
    assert.strictEqual(g1.ok, true); assert.strictEqual(g2.ok, true);
    assert.notStrictEqual(g1.code, g2.code, 'two new groups never collide on the generated code');
  });

  // -------------------------------------------------------------------
  // ITEM 6 — no manual criterion code required/rendered in the normal flow.
  // -------------------------------------------------------------------
  await rec('ITEM 6 — rendered add-criterion form has NO code input; omitting code in ceAddCriterion still works', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('ktt-ux-v2-test');
    const html = api.checklistCeEditorHtml();
    assert.ok(!html.includes('data-phfck-ce-add-code'), 'no manual criterion-code input rendered in the normal add flow');
    assert.ok(!/Mã tiêu chí\s*<em>\*<\/em>/.test(html), 'no required "Mã tiêu chí" label in the add-criterion block');
    const res = api.ceAddCriterion(state, { groupCode: 'G1', childCode: 'C1', content: 'Tiêu chí không cần mã tay', factor: 1 });
    assert.strictEqual(res.ok, true, 'omitting code entirely still succeeds: ' + JSON.stringify(res.errors || []));
    assert.ok(res.code, 'a code was still auto-assigned');
  });

  // -------------------------------------------------------------------
  // ITEM 7 — no manual effective_date in the normal flow; auto-set date is sane.
  // -------------------------------------------------------------------
  await rec('ITEM 7 — rendered form has NO effective-date input; a save still succeeds with a sane auto-set effective date (today)', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('ktt-ux-v2-test');
    const html = api.checklistCeEditorHtml();
    assert.ok(!html.includes('data-phfck-ce-effective'), 'no manual effective-date input rendered in the normal flow');
    assert.strictEqual(state.effectiveDate, api.todayIso(), 'ceOpen already auto-set effectiveDate to today');
    const modal = makeCeAddFormModal({ groupVal: 'G1::C1', content: 'Tiêu chí ngày hiệu lực tự động', factor: 1, reason: 'ITEM 7 — ngày hiệu lực tự động' });
    const outcome = await api.ceSaveAndApply(null, modal);
    assert.strictEqual(outcome.ok, true, JSON.stringify(outcome));
    const applied = await api.cePublish(api.getPendingCePublish().state);
    assert.strictEqual(applied.effectiveDate, api.todayIso(), 'published effectiveDate is today, auto-set with no manual input');
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(applied.effectiveDate), 'effectiveDate is a well-formed YYYY-MM-DD date');
  });

  // -------------------------------------------------------------------
  // UX V2 follow-up — "+ Thêm tiêu chí khác" staging button removed entirely (confusing in
  // manual testing, no clear feedback). One add flow = one criterion. ceCommitAddFormRaw
  // itself is untouched (still backs the ceSaveAndApply auto-capture path) — only the
  // standalone button/click-handler wiring it to a manual "stage now" action is gone.
  // -------------------------------------------------------------------
  await rec('UX V2 follow-up — "+ Thêm tiêu chí khác" button no longer rendered; auto-capture on Lưu & áp dụng still works', async () => {
    resetStore();
    const api = await hydratedTab();
    api.ceOpen('ktt-ux-v2-test');
    const html = api.checklistCeEditorHtml();
    assert.ok(!html.includes('data-phfck-ce-add-submit'), 'no "+ Thêm tiêu chí khác" button rendered in the add-criterion form');
    assert.ok(!html.includes('Thêm tiêu chí khác'), 'no "Thêm tiêu chí khác" label rendered anywhere in the editor');
    // Auto-capture on Save must still work with the button gone (regression for the actual PROD fix).
    const modal = makeCeAddFormModal({ groupVal: 'G1::C1', content: 'Tiêu chí sau khi bỏ nút phụ', factor: 2, reason: 'UX V2 follow-up — bỏ nút Thêm tiêu chí khác' });
    const outcome = await api.ceSaveAndApply(null, modal);
    assert.strictEqual(outcome.ok, true, 'Lưu & áp dụng still auto-captures the visible form with no staging button present: ' + JSON.stringify(outcome));
    const applied = await api.cePublish(api.getPendingCePublish().state);
    const flat = api.flattenCriteria(applied.groups);
    assert.ok(flat.some(c => c.content === 'Tiêu chí sau khi bỏ nút phụ'), 'the auto-captured criterion made it into the published payload');
  });

  // -------------------------------------------------------------------
  // ITEM 8 — zero net change: no new version, no current_version change, blocking message,
  // zero calls to the underlying save/persist function.
  // -------------------------------------------------------------------
  await rec('ITEM 8 — "Lưu & áp dụng" with nothing actually changed -> blocked, NO new version, NO RPC call', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('ktt-ux-v2-test');
    assert.strictEqual(api.ceHasSemanticChange(state), false, 'freshly opened session (no edits) has no semantic change');
    const versionsBefore = store.checklist_template_versions.length;
    const currentVersionBefore = store.checklist_templates.find(t => t.template_key === 'ktt-ux-v2-test').current_version;
    const rpcCountBefore = rpcCalls.length;
    const modal = makeCeAddFormModal({ groupVal: 'G1::C1', content: '', factor: '', reason: 'ITEM 8 — không đổi gì cả' }); // blank add-form, only reason filled
    const outcome = await api.ceSaveAndApply(null, modal);
    assert.strictEqual(outcome.ok, false, 'save is blocked');
    assert.strictEqual(outcome.reason, 'no-change', 'blocked specifically as "no-change" (zero-net-change guard)');
    assert.strictEqual(store.checklist_template_versions.length, versionsBefore, 'NO new version row created');
    assert.strictEqual(store.checklist_templates.find(t => t.template_key === 'ktt-ux-v2-test').current_version, currentVersionBefore, 'current_version untouched');
    assert.strictEqual(rpcCalls.length, rpcCountBefore, 'zero calls to the underlying save/persist RPC');
    assert.strictEqual(api.getPendingCePublish(), null, 'no pending publish was staged — the preview step was never reached');
  });

  // -------------------------------------------------------------------
  // ITEM 9 — a real semantic change -> exactly ONE new version (not zero, not multiple).
  // -------------------------------------------------------------------
  await rec('ITEM 9 — a real change -> exactly ONE new version created (guards both under- and over-publishing)', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('ktt-ux-v2-test');
    const versionsBefore = store.checklist_template_versions.length;
    const modal = makeCeAddFormModal({ groupVal: 'G1::C1', content: 'Đối chiếu công nợ phải thu cuối tháng', factor: 2, reason: 'ITEM 9 — thay đổi thật' });
    const outcome = await api.ceSaveAndApply(null, modal);
    assert.strictEqual(outcome.ok, true, JSON.stringify(outcome));
    await api.cePublish(api.getPendingCePublish().state);
    assert.strictEqual(store.checklist_template_versions.length, versionsBefore + 1, 'exactly one new version row created for one real change');
  });

  // -------------------------------------------------------------------
  // ITEM 10 — edit-criterion regression (unchanged mechanics).
  // -------------------------------------------------------------------
  await rec('ITEM 10 — ceEditCriterion regression: edit content/factor, publish, current config reflects it', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('ktt-ux-v2-test');
    const res = api.ceEditCriterion(state, 'KTT-02', { content: 'Tiêu chí hai (đã sửa V2)', factor: 4 });
    assert.strictEqual(res.ok, true, JSON.stringify(res.errors || []));
    state.reason = 'ITEM 10 sửa nội dung'; state.newVersion = api.nextTemplateVersion(state.oldVersion);
    await api.cePublish(state);
    const fresh = await templatesLib.listChecklistTemplates();
    const current = currentVersionRow(fresh);
    const item = current.definition.groups[0].children[0].items.find(i => i[0] === 'KTT-02');
    assert.strictEqual(item[1], 'Tiêu chí hai (đã sửa V2)');
    assert.strictEqual(item[2], 4);
  });

  // -------------------------------------------------------------------
  // ITEM 11 — discontinue regression + immutability preserved.
  // -------------------------------------------------------------------
  await rec('ITEM 11 — ceDiscontinueCriterion regression: removed from current config, historical version byte-for-byte unchanged', async () => {
    resetStore();
    const api = await hydratedTab();
    const before = clone(store.checklist_template_versions.find(v => v.version_no === 'KTT-2.2').definition);
    const state = api.ceOpen('ktt-ux-v2-test');
    const ok = api.ceDiscontinueCriterion(state, 'KTT-01');
    assert.strictEqual(ok, true);
    state.reason = 'ITEM 11 ngưng áp dụng'; state.newVersion = api.nextTemplateVersion(state.oldVersion);
    await api.cePublish(state);
    const fresh = await templatesLib.listChecklistTemplates();
    const current = currentVersionRow(fresh);
    assert.ok(!api_flatten(current.definition.groups).includes('KTT-01'), 'current config no longer has KTT-01');
    const historical = store.checklist_template_versions.find(v => v.version_no === 'KTT-2.2');
    assert.deepStrictEqual(historical.definition, before, 'historical KTT-2.2 definition byte-for-byte unchanged');
  });

  // -------------------------------------------------------------------
  // ITEM 12 — reorder still triggers a new version through the Part F guard (order IS a
  // semantic change; the zero-net-change guard must NOT falsely treat it as a no-op).
  // -------------------------------------------------------------------
  await rec('ITEM 12 — reorder-only change (no content/factor/group change) is NOT treated as zero-net-change; still creates exactly one new version', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('ktt-ux-v2-test');
    assert.deepStrictEqual(Array.from(api.ceCriterionList(state).map(c => c.code)), ['KTT-01', 'KTT-02']);
    const moved = api.ceMoveCriterion(state, 'KTT-02', 'up');
    assert.strictEqual(moved, true);
    assert.deepStrictEqual(Array.from(api.ceCriterionList(state).map(c => c.code)), ['KTT-02', 'KTT-01']);
    assert.strictEqual(api.ceHasSemanticChange(state), true, 'reorder IS detected as a semantic change by the Part F guard');
    const versionsBefore = store.checklist_template_versions.length;
    const modal = makeCeAddFormModal({ groupVal: 'G1::C1', content: '', factor: '', reason: 'ITEM 12 — chỉ sắp xếp lại' });
    const outcome = await api.ceSaveAndApply(null, modal);
    assert.strictEqual(outcome.ok, true, 'reorder-only save proceeds (not blocked as no-change): ' + JSON.stringify(outcome));
    await api.cePublish(api.getPendingCePublish().state);
    assert.strictEqual(store.checklist_template_versions.length, versionsBefore + 1, 'exactly one new version created for the reorder');
    const fresh = await templatesLib.listChecklistTemplates();
    const current = currentVersionRow(fresh);
    assert.deepStrictEqual(api_flatten(current.definition.groups), ['KTT-02', 'KTT-01'], 'new order persisted');
  });

  // -------------------------------------------------------------------
  // ITEM 16 (partial, this file's share) — invalid auto-captured form blocks Save with the
  // SAME validation errors ceAddCriterion would give (content filled, factor cleared).
  // -------------------------------------------------------------------
  await rec('Auto-capture surfaces validation errors instead of silently dropping or silently succeeding (content filled, factor invalid)', async () => {
    resetStore();
    const api = await hydratedTab();
    const state = api.ceOpen('ktt-ux-v2-test');
    const modal = makeCeAddFormModal({ groupVal: 'G1::C1', content: 'Tiêu chí thiếu hệ số hợp lệ', factor: '0', reason: 'reason ok' });
    const outcome = await api.ceSaveAndApply(null, modal);
    assert.strictEqual(outcome.ok, false);
    assert.strictEqual(outcome.reason, 'invalid-add-form', 'blocked specifically because the auto-captured form is invalid');
    assert.ok(!api.ceCriterionList(state).some(c => c.content === 'Tiêu chí thiếu hệ số hợp lệ'), 'invalid criterion never entered session state');
    assert.strictEqual(modal.addSummary.hidden, false, 'error summary made visible');
    assert.strictEqual(modal.wraps.factor.classList.contains('is-invalid'), true, 'factor field flagged invalid');
  });

  console.log('\n' + passed + ' passed, ' + failures + ' failed.');
  if (failures) process.exit(1);
}

main().catch(e => { console.error('UNCAUGHT', e); process.exit(1); });
