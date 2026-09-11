'use strict';
/*
 * Regression — Checklist Criterion Simplify V1 — Part D (Scorecard "Sửa Bảng tổng điểm"
 * auto-activate-on-save) + Part F verification (existing monthly-form snapshot safety —
 * this file only proves no retroactive-apply call happens; the snapshot-preserved test
 * itself lives in test-checklist-criterion-simplify-v1-part-e.js next to the fix it guards).
 *
 * Covers spec items 7, 8, 12 (frontend half) from the task spec's Part H:
 *  7. Scorecard save -> internally creates+promotes current config in ONE orchestrated
 *     action -> no separate pending-activation click required (current_version promoted
 *     after a single tseConfirmSaveAndApply() call; no second explicit activate call).
 *  8. Historical superseded version does NOT render as actionable "pending activation"
 *     (reproduces the exact KTT 2.1/2.2 contradiction scenario).
 *  12. (frontend half) No retroactive-apply action is invoked as a side effect of the
 *      scorecard save — only 'checklistRetroCopyVersion' and 'activateChecklistTemplateVersion'
 *      are called; 'checklistRetroDryRunApply'/'checklistRetroApply'/
 *      'checklistRetroApplyReviewedForm' are never invoked.
 *
 * Real assets/js/checklist/phf-checklist-app.js is loaded in a vm sandbox (same convention
 * as scripts/test-checklist-criterion-admin-2026-09.js). `fetch` is bridged directly into
 * the REAL api/_lib/checklist-template-retroactive-service.js (copyTemplateVersion/
 * activateTemplateVersion — both UNCHANGED, do-not-touch files per the task's scope
 * boundary) with @supabase/supabase-js stubbed in-memory. Zero network/DB I/O.
 *
 *   node scripts/test-checklist-criterion-simplify-v1-part-d.js
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
// In-memory fake Supabase — enough tables for copyTemplateVersion/activateTemplateVersion
// (checklist_templates, checklist_template_versions, checklist_employee_assignments,
// checklist_employee_assignment_history) plus phf_save_checklist_assignments RPC.
// ---------------------------------------------------------------------------
const OLD_DEF = { templateType: 'score_summary', groups: [], totalRows: [
  { id: 'r1', code: 'BH-TUAN-THU', name: 'Tuân thủ tiêu chuẩn công việc', target: 100, unit: 'điểm', weight: 70, source: { type: 'manual' } },
  { id: 'r2', code: 'BH-CAP-TREN', name: 'Công việc cấp trên giao', target: 10, unit: 'điểm', weight: 30, source: { type: 'manual' } }
] };
let store, rpcCalls;
function resetStore() {
  store = {
    checklist_templates: [{ template_key: 'tc-tse-test', code: 'TTSE', name: 'Mẫu kiểm thử Bảng tổng điểm', group_name: 'Kiểm thử', template_type: 'score_summary', has_checklist: false, source: '', note: '', status: 'active', current_version: 'TTSE-1.0', effective_date: '2026-07-01', updated_at: '2026-07-01T00:00:00.000Z' }],
    checklist_template_versions: [{ template_key: 'tc-tse-test', version_no: 'TTSE-1.0', effective_date: '2026-07-01', reason: 'Khởi tạo mẫu kiểm thử', source_version: '', change_type: 'sync', definition: OLD_DEF, created_at: '2026-07-01T00:00:00.000Z' }],
    checklist_employee_assignments: [
      { id: 'a-e01', employee_key: 'e01', employee_id: 'id-e01', employee_code: 'E01', employee_name: 'NV Một', department: 'KD', title: 'NV', position: '', branch: '', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', leave_until: null, status_note: '', template_id: 'tc-tse-test', template_version: 'TTSE-1.0', effective_date: '2026-07-01', reason: 'seed', updated_at: '2026-07-01T00:00:00.000Z', created_at: '2026-07-01T00:00:00.000Z' }
    ],
    checklist_employee_assignment_history: []
  };
  rpcCalls = [];
}
class FakeQuery {
  constructor(t) { this.table = t; this.filters = []; this._single = null; this._order = []; this._limit = null; this._patch = null; }
  select() { return this; }
  eq(c, v) { this.filters.push(r => String(r[c]) === String(v)); return this; }
  neq(c, v) { this.filters.push(r => String(r[c]) !== String(v)); return this; }
  in(c, a) { const s = new Set((a || []).map(String)); this.filters.push(r => s.has(String(r[c]))); return this; }
  gte() { return this; } lte() { return this; }
  order(c, o) { this._order.push({ c, asc: !(o && o.ascending === false) }); return this; }
  limit(n) { this._limit = n; return this; }
  range(a, b) { this._range = [a, b]; return this; }
  maybeSingle() { this._single = 'maybe'; return this; }
  single() { this._single = 'strict'; return this; }
  update(p) { this._patch = p; return this; }
  then(res, rej) {
    const table = store[this.table] || (store[this.table] = []);
    const matchedRefs = table.filter(r => this.filters.every(f => f(r)));
    if (this._patch) matchedRefs.forEach(r => Object.assign(r, this._patch));
    let rows = clone(matchedRefs);
    this._order.forEach(o => { rows.sort((a, b) => { const x = a[o.c], y = b[o.c]; return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1); }); });
    if (this._range) rows = rows.slice(this._range[0], this._range[1] + 1);
    else if (this._limit != null) rows = rows.slice(0, this._limit);
    let p;
    if (this._single === 'maybe') p = { data: rows[0] || null, error: null };
    else if (this._single === 'strict') p = rows.length ? { data: rows[0], error: null } : { data: null, error: { message: 'no rows' } };
    else p = { data: rows, error: null };
    return Promise.resolve(p).then(res, rej);
  }
}
async function fakeRpc(name, params) {
  rpcCalls.push({ name, params: clone(params) });
  if (name === 'phf_copy_checklist_template_version') {
    const key = params.p_template_key, ver = params.p_new_version;
    const existing = store.checklist_template_versions.find(v => v.template_key === key && v.version_no === ver);
    if (!existing) {
      store.checklist_template_versions.push({ template_key: key, version_no: ver, effective_date: params.p_effective_date, reason: params.p_reason, source_version: params.p_source_version, change_type: 'retro-copy', definition: clone(params.p_definition_override), created_at: new Date().toISOString() });
    }
    return { data: { ok: true, templateKey: key, version: ver }, error: null };
  }
  if (name === 'phf_save_checklist_template') {
    const key = params.p_template.template_key, ver = params.p_version.version_no;
    const tpl = store.checklist_templates.find(t => t.template_key === key);
    if (!tpl) return { data: { ok: false, code: 'NOT_FOUND' }, error: null };
    const existing = store.checklist_template_versions.find(v => v.template_key === key && v.version_no === ver);
    if (!existing) store.checklist_template_versions.push({ template_key: key, version_no: ver, effective_date: params.p_version.effective_date, reason: params.p_version.reason, source_version: params.p_version.source_version, change_type: params.p_version.change_type, definition: params.p_version.definition, created_at: params.p_version.created_at });
    tpl.current_version = ver; tpl.effective_date = params.p_template.effective_date; tpl.updated_at = new Date().toISOString();
    return { data: { ok: true, templateKey: key, version: ver }, error: null };
  }
  if (name === 'phf_save_checklist_assignments') {
    // saveChecklistAssignments() (api/_lib/checklist-assignments.js, real code) normalizes
    // rows to SNAKE_CASE before calling this RPC (employee_key/template_version/...), then
    // does a SEPARATE select('*') read-back from checklist_employee_assignments afterward —
    // so this mock must actually mutate the store row, not just report counts.
    let saved = 0, changed = 0;
    (params.p_rows || []).forEach(item => {
      const cur = store.checklist_employee_assignments.find(r => r.employee_key === item.employee_key);
      saved++; if (!cur) return;
      if (String(cur.template_version) !== String(item.template_version)) {
        changed++;
        store.checklist_employee_assignment_history.push({ employee_key: item.employee_key, previous_data: clone(cur), template_version: item.template_version, reason: item.reason, changed_at: new Date().toISOString() });
        cur.template_version = item.template_version; cur.effective_date = item.effective_date; cur.reason = item.reason; cur.updated_at = item.updated_at || new Date().toISOString();
      }
    });
    return { data: { saved, changed }, error: null };
  }
  return { data: null, error: { message: 'unmocked rpc ' + name } };
}
const origLoad = Module._load;
Module._load = function (req) {
  if (req === '@supabase/supabase-js') return { createClient: () => ({ from: t => new FakeQuery(t), rpc: (n, p) => fakeRpc(n, p) }) };
  return origLoad.apply(this, arguments);
};
const templatesLib = require(path.join(root, 'api', '_lib', 'checklist-templates.js'));
const retroSvc = require(path.join(root, 'api', '_lib', 'checklist-template-retroactive-service.js'));
Module._load = origLoad;

const ADMIN = { role: 'admin', account: { id: 'admin-1', name: 'Admin Test' }, sub: 'admin-1' };

// checklistRetroApiCall in the frontend posts {action, input} to /api/data. Bridge fetch
// straight into the REAL retroactive-service functions (untouched file) — same action-name
// mapping server.js uses (checklistRetroCopyVersion -> copyTemplateVersion,
// activateChecklistTemplateVersion -> activateTemplateVersion). Also records every action
// name invoked, so item 12 (no retroactive auto-apply) can assert on it directly.
let actionLog = [];
async function fetchBridge(url, opts) {
  let body = {};
  try { body = JSON.parse((opts && opts.body) || '{}'); } catch (_) {}
  const action = body.action; actionLog.push(action);
  try {
    let data;
    if (action === 'checklistRetroCopyVersion') data = await retroSvc.copyTemplateVersion(ADMIN, { templateKey: body.input.templateKey, sourceVersion: body.input.sourceVersion, newVersion: body.input.newVersion, effectiveDate: body.input.effectiveDate, reason: body.input.reason, definition: body.input.definition });
    else if (action === 'checklistRetroPreviewDiff') data = retroSvc.previewDiff(ADMIN, body.input);
    else if (action === 'activateChecklistTemplateVersion') data = await retroSvc.activateTemplateVersion(ADMIN, body.input);
    else if (action === 'checklistRetroDryRunApply') data = await retroSvc.dryRunRetroactiveApply(ADMIN, body.input);
    else if (action === 'checklistRetroApply') data = await retroSvc.retroactiveApply(ADMIN, body.input);
    else if (action === 'checklistRetroApplyReviewedForm') data = await retroSvc.retroactiveApplyReviewedForm(ADMIN, body.input);
    else return { ok: false, status: 400, json: async () => ({ ok: false, error: 'unknown action: ' + action }) };
    return { ok: true, status: 200, json: async () => Object.assign({ ok: true }, data) };
  } catch (error) {
    return { ok: true, status: error.statusCode || 500, json: async () => ({ ok: false, error: error.message, code: error.code || '' }) };
  }
}

const filePath = 'assets/js/checklist/phf-checklist-app.js';
const src = fs.readFileSync(path.join(root, filePath), 'utf8');
const marker = '\n})();';
const idx = src.lastIndexOf(marker);
const expose = "\n  window.__tseTest={\n" +
  "    tseOpen:tseOpen, getTseState:function(){return checklistTseState;},\n" +
  "    tseSyncRowsFromDom:tseSyncRowsFromDom, tseOpenPreview:tseOpenPreview,\n" +
  "    tseConfirmSaveAndApply:tseConfirmSaveAndApply, tsePendingActivationVersion:tsePendingActivationVersion,\n" +
  "    tseActivateBannerHtml:tseActivateBannerHtml, checklistTotalScoreTabHtml:checklistTotalScoreTabHtml,\n" +
  "    templateCatalog:templateCatalog, templateUiState:templateUiState,\n" +
  "    ensureChecklistTemplatesHydrated:ensureChecklistTemplatesHydrated,\n" +
  "    checklistTemplateDbState:checklistTemplateDbState, waitForPreview:function(){return new Promise(function(r){setTimeout(r,0);});}\n" +
  "  };\n";
const testSrc = src.slice(0, idx) + expose + src.slice(idx);
const compiled = new vm.Script(testSrc, { filename: filePath });

function makeLocalStorage() {
  const data = {};
  return { getItem: k => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; } };
}
function makeSandbox() {
  const noop = function () {};
  const sandbox = {};
  sandbox.window = sandbox; sandbox.console = console;
  sandbox.addEventListener = noop; sandbox.removeEventListener = noop; sandbox.dispatchEvent = noop;
  sandbox.PHF_BUILD_INFO = { version: 'test', fingerprint: 'test' };
  // Minimal recursive fake DOM node — checklistToast() (called directly by
  // tseConfirmSaveAndApply, unlike the click-handler-only toasts other offline tests never
  // exercise) walks host.querySelector('.phfck-toast')/toast.querySelector('button')/
  // addEventListener/appendChild/classList/remove. A bare {} stub throws on the first
  // unimplemented call, which the outer .catch() in tseConfirmSaveAndApply then silently
  // swallows — masking the real assertion under test. Make every node self-sufficient.
  function fakeNode() {
    var node = {
      className: '', style: {}, dataset: {},
      setAttribute: noop, getAttribute: () => null, removeAttribute: noop,
      appendChild: noop, remove: noop,
      addEventListener: noop, removeEventListener: noop,
      classList: { add: noop, remove: noop, contains: () => false, toggle: noop },
      querySelector: () => fakeNode(), querySelectorAll: () => [],
      set innerHTML(_v) {}, get innerHTML() { return ''; }
    };
    return node;
  }
  sandbox.document = {
    documentElement: { setAttribute: noop, getAttribute: () => null }, addEventListener: noop, removeEventListener: noop,
    // checklistToast() (called directly by tseConfirmSaveAndApply) does
    // document.querySelector('[data-phfck-toast-host]') -> document.createElement('div') ->
    // document.body.appendChild(host) -> host.querySelector('.phfck-toast') — needs a body
    // with a working appendChild and a createElement stub with a working querySelector, or
    // it throws (a harness gap, not app behavior) and gets silently swallowed by the outer
    // .catch() in tseConfirmSaveAndApply, masking the real assertion under test.
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    createElement: () => fakeNode(),
    body: { classList: { add: noop, remove: noop }, appendChild: noop }, readyState: 'complete'
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
  win.__tseTest.templateUiState.selectedId = 'tc-tse-test';
  win.__tseTest.ensureChecklistTemplatesHydrated();
  return win.__tseTest;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // -------------------------------------------------------------------
  // ITEM 7 — one orchestrated save promotes current_version + repoints assignments,
  // no separate activate call needed.
  // -------------------------------------------------------------------
  await rec('ITEM 7 — tseConfirmSaveAndApply(): ONE call creates the version AND promotes current_version + repoints assignments', async () => {
    resetStore(); actionLog = [];
    const api = await hydratedTab();
    api.tseOpen('tc-tse-test');
    const state = api.getTseState();
    assert.strictEqual(state.sourceVersion, 'TTSE-1.0');
    // simulate editing a row's weight (still respects the existing tse rows structure)
    state.rows[0].weight = 60; state.rows[1].weight = 40;
    api.tseOpenPreview();
    await sleep(80); // let the (mocked, in-process) preview diff call resolve
    assert.ok(state.preview, 'preview resolved before confirming');
    const beforeCurrentVersion = store.checklist_templates[0].current_version;
    assert.strictEqual(beforeCurrentVersion, 'TTSE-1.0');
    actionLog = []; // isolate the save+apply orchestration from the preceding preview-diff call
    const activateResult = await api.tseConfirmSaveAndApply('2026-09-15', 'Điều chỉnh trọng số quý 3 theo QĐ BGĐ');
    assert.ok(activateResult, 'tseConfirmSaveAndApply resolved with the activation result (no exception): ' + state.publishError);
    // ONE call to the UI orchestration function -> BOTH effects already happened:
    assert.notStrictEqual(store.checklist_templates[0].current_version, beforeCurrentVersion, 'current_version was promoted');
    assert.strictEqual(store.checklist_templates[0].current_version, state.newVersion, 'current_version now equals the newly created version');
    const asg = store.checklist_employee_assignments.find(r => r.employee_code === 'E01');
    assert.strictEqual(asg.template_version, state.newVersion, 'the employee assignment was repointed to the new version in the SAME orchestrated action');
    // exactly the two actions we expect were called — no separate manual "activate" click needed
    // (no tseActivateOpen/checklistTseActivateModalHtml/data-phfck-tse-activate-confirm involved)
    assert.deepStrictEqual(actionLog, ['checklistRetroCopyVersion', 'activateChecklistTemplateVersion'], 'exactly one copy + one activate call, nothing else');
  });

  await rec('ITEM 7b — retrying tseConfirmSaveAndApply after state.published already exists does NOT re-copy the version', async () => {
    resetStore(); actionLog = [];
    const api = await hydratedTab();
    api.tseOpen('tc-tse-test');
    const state = api.getTseState();
    state.rows[0].weight = 60; state.rows[1].weight = 40;
    api.tseOpenPreview(); await sleep(80);
    // simulate step 1 (copy) already succeeded once in a prior attempt
    state.newVersion = 'TTSE-2.0';
    state.published = { ok: true, templateKey: 'tc-tse-test', version: 'TTSE-2.0' };
    store.checklist_template_versions.push({ template_key: 'tc-tse-test', version_no: 'TTSE-2.0', effective_date: '2026-09-15', reason: 'already copied once', source_version: 'TTSE-1.0', change_type: 'retro-copy', definition: OLD_DEF, created_at: new Date().toISOString() });
    const versionCountBefore = store.checklist_template_versions.length;
    actionLog = []; // only care about actions from the retry attempt itself
    await api.tseConfirmSaveAndApply('2026-09-15', 'Điều chỉnh trọng số quý 3 theo QĐ BGĐ');
    assert.strictEqual(store.checklist_template_versions.length, versionCountBefore, 'no duplicate version row created on retry');
    assert.deepStrictEqual(actionLog, ['activateChecklistTemplateVersion'], 'retry skips the copy step entirely, only activates');
  });

  // -------------------------------------------------------------------
  // ITEM 8 — historical superseded version does not render as actionable pending activation
  // -------------------------------------------------------------------
  await rec('ITEM 8 — KTT 2.1/2.2 scenario: a stale non-current version never renders the "pending activation" banner', async () => {
    resetStore();
    // Reproduce the exact contradiction: template row's local cache has TWO versions,
    // current_version already promoted to the LATER one via the ce*/cePublish path, but an
    // OLDER version created earlier via the (formerly two-step) tse flow is still sitting in
    // version history with no matching current_version — this used to render as "TTSE-1.5
    // đã được tạo nhưng chưa kích hoạt" alongside a page that already reads "đang áp dụng
    // TTSE-2.0", a direct product contradiction.
    store.checklist_template_versions.push({ template_key: 'tc-tse-test', version_no: 'TTSE-1.5', effective_date: '2026-08-01', reason: 'superseded scorecard save', source_version: 'TTSE-1.0', change_type: 'retro-copy', definition: OLD_DEF, created_at: '2026-08-01T00:00:00.000Z' });
    store.checklist_template_versions.push({ template_key: 'tc-tse-test', version_no: 'TTSE-2.0', effective_date: '2026-08-15', reason: 'later cePublish save', source_version: 'TTSE-1.5', change_type: 'web-criteria-admin', definition: OLD_DEF, created_at: '2026-08-15T00:00:00.000Z' });
    store.checklist_templates[0].current_version = 'TTSE-2.0'; // ce*/cePublish already promoted this
    const api = await hydratedTab();
    const info = api.tsePendingActivationVersion('tc-tse-test');
    assert.strictEqual(info, null, 'tsePendingActivationVersion() no longer flags the stale TTSE-1.5 as pending');
    const bannerHtml = api.tseActivateBannerHtml('tc-tse-test');
    assert.strictEqual(bannerHtml, '', 'the pending-activation banner never renders in the normal flow');
    assert.ok(!bannerHtml.includes('Kích hoạt phiên bản'), 'no "Kích hoạt phiên bản" call-to-action leaks through');
    const item = api.templateCatalog().find(x => x.id === 'tc-tse-test');
    const tabHtml = item ? api.checklistTotalScoreTabHtml(item) : '';
    assert.ok(!tabHtml.includes('chưa kích hoạt'), 'the "Bảng tổng điểm" tab never shows the contradictory "chưa kích hoạt" copy for a stale version');
  });

  // -------------------------------------------------------------------
  // ITEM 12 (frontend half) — no retroactive-apply action is auto-invoked by the save
  // -------------------------------------------------------------------
  await rec('ITEM 12 — scorecard save never auto-invokes checklistRetroDryRunApply/checklistRetroApply/checklistRetroApplyReviewedForm', async () => {
    resetStore(); actionLog = [];
    const api = await hydratedTab();
    api.tseOpen('tc-tse-test');
    const state = api.getTseState();
    state.rows[0].weight = 55; state.rows[1].weight = 45;
    api.tseOpenPreview(); await sleep(80);
    await api.tseConfirmSaveAndApply('2026-09-15', 'Điều chỉnh trọng số quý 3 theo QĐ BGĐ');
    const forbidden = ['checklistRetroDryRunApply', 'checklistRetroApply', 'checklistRetroApplyReviewedForm'];
    forbidden.forEach(name => assert.ok(!actionLog.includes(name), name + ' must never be invoked automatically by a normal save'));
  });

  console.log('\n' + passed + ' passed, ' + failures + ' failed.');
  if (failures) process.exit(1);
}

main().catch(e => { console.error('UNCAUGHT', e); process.exit(1); });
