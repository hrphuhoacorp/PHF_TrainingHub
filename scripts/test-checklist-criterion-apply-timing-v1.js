'use strict';
/*
 * Regression — Checklist Criterion Apply-Timing V1.
 *
 * Confirmed PROD problem this closes: Admin saves new criteria via Quản lý tiêu chí ("Lưu &
 * áp dụng"). The retroactive-apply decision for the CURRENT PERIOD's already-created monthly
 * forms (GREEN/YELLOW/ORANGE classification, checklistRetroClassifyCurrentPeriod /
 * applyChecklistMonthlyRetroactiveScope — both already built and tested in
 * scripts/test-checklist-retroactive-current-period-v1.js and
 * scripts/test-checklist-retro-decision-ui-v1.js) used to be offered as a SEPARATE follow-up
 * AFTER the version was already saved and a generic "Đã cập nhật tiêu chí Checklist." toast
 * had effectively already happened — an Admin who skipped/missed that follow-up could walk
 * away believing employees already have the new criteria when they don't.
 *
 * This file covers the restructure: the apply-timing decision (ceClassifyCurrentPeriod,
 * folded into ceSaveAndApply/cePreviewHtml/ceTimingSectionHtml) is now surfaced INSIDE the
 * same confirm modal, BEFORE the version is saved — not a bolt-on afterward — and the final
 * success message (ceFinishApplyTiming) states the real, concrete outcome (counts, month)
 * instead of a generic "updated" message. Reuses the EXACT existing retroactive engine
 * (classifyChecklistMonthlyRetroactiveScope/applyChecklistMonthlyRetroactiveScope in
 * api/_lib/checklist-monthly.js) — the only backend change is a new mode:'all' on
 * applyChecklistMonthlyRetroactiveScope that applies GREEN (safe, no reset) and
 * YELLOW/ORANGE (reset) in a single call, so "Áp dụng ngay" only needs one round-trip
 * regardless of which tiers are present.
 *
 * Convention: same offline pattern as scripts/test-checklist-criterion-admin-ux-v2.js
 * (real frontend source in a vm sandbox, checklistToast/phfNotice stubbed) combined with
 * scripts/test-checklist-retroactive-current-period-v1.js's in-memory Supabase fixture for
 * api/_lib/checklist-monthly.js — both real backend libs (checklist-templates.js AND
 * checklist-monthly.js) are required under ONE shared fake-Supabase store so the frontend's
 * fetch calls exercise the real classify/apply/save code paths end-to-end. No real Supabase
 * project, no network, no PROD/SANDBOX database touched anywhere in this file.
 *
 *   node scripts/test-checklist-criterion-apply-timing-v1.js
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
  catch (e) { failures++; console.error('FAIL: ' + name + '\n  ' + (e && e.message ? e.message : e) + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n  ') : '')); }
}

// ---------------------------------------------------------------------------
// Dynamic "current period" — todayIso() inside the real frontend source uses the real local
// clock (no Date override exists anywhere in this codebase's test suite), so the fixture's
// current period is computed the same way at test-run time, and the "next period" the same
// way scoreShiftMonth() computes it (calendar month rollover, UTC-based).
// ---------------------------------------------------------------------------
const NOW = new Date();
const CURRENT_PERIOD = NOW.getFullYear() + '-' + String(NOW.getMonth() + 1).padStart(2, '0');
function nextPeriodOf(pm) {
  const parts = String(pm).split('-').map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1 + 1, 1));
  return String(d.getUTCFullYear()).padStart(4, '0') + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}
const NEXT_PERIOD = nextPeriodOf(CURRENT_PERIOD);

const TPL = 'ktt-apply-timing-v1';
const V1_DEF = {
  templateType: 'checklist_detail',
  groups: [{ code: 'G1', name: 'Nhóm 1', children: [{ code: 'C1', name: 'Nhóm con 1', items: [
    ['KTT-01', 'Tiêu chí một', 1],
    ['KTT-02', 'Tiêu chí hai', 2]
  ] }] }],
  totalRows: [[1, 'CT-01', 'Tuân thủ tiêu chuẩn Checklist', 100, 'điểm', 100, 'Không', { type: 'checklist_total' }, 'CT-01']]
};
function snap(ver, def) { return { template: { name: 'Mẫu kiểm thử Apply Timing' }, version: { version_no: ver, definition: clone(def) } }; }

function baseAssignment(code, name) {
  return { employee_key: code.toLowerCase(), employee_id: 'id-' + code.toLowerCase(), employee_code: code, employee_name: name,
    department: 'KTT', title: 'Kế toán trưởng', branch: '', manager_id: 'id-mgr', manager_code: 'MGR1', manager_name: 'Quản lý',
    employee_status: 'Đang làm việc', template_id: TPL, template_version: 'KTT-2.2', effective_date: '2026-07-01', updated_at: '2026-07-01T00:00:00.000Z' };
}
function baseForm(id, code, name, extra) {
  return Object.assign({
    id, period_id: 'per-current', period_month: CURRENT_PERIOD, employee_id: 'id-' + code.toLowerCase(), employee_code: code, employee_name: name,
    status: 'draft', template_id: TPL, template_version: 'KTT-2.2', template_snapshot: snap('KTT-2.2', V1_DEF),
    self_answers: {}, self_note: '', self_saved_at: null, self_submitted_at: null, self_total_score: null,
    review_answers: {}, review_note: '', checklist_review_score: null, checklist_review_reason: '', review_total_score: null,
    review_saved_at: null, review_submitted_at: null, reviewed_by: null, reviewed_by_code: null, reviewed_by_name: null,
    reviewed_as_override: false, review_override_reason: '', final_score: null, score_calculated_at: null, admin_exception_open: false,
    updated_at: '2026-07-05T00:00:00.000Z'
  }, extra || {});
}

function freshStore(periodStatus) {
  return {
    checklist_templates: [{ template_key: TPL, code: 'KTT', name: 'Mẫu kiểm thử Apply Timing', group_name: 'Kiểm thử',
      template_type: 'checklist_detail', has_checklist: true, source: '', note: '', status: 'active', current_version: 'KTT-2.2',
      effective_date: '2026-07-01', updated_at: '2026-07-01T00:00:00.000Z' }],
    checklist_template_versions: [{ template_key: TPL, version_no: 'KTT-2.2', effective_date: '2026-07-01',
      reason: 'Khởi tạo mẫu kiểm thử', source_version: '', change_type: 'sync', definition: clone(V1_DEF), created_at: '2026-07-01T00:00:00.000Z' }],
    checklist_employee_assignments: [baseAssignment('E50', 'NV Năm Mươi'), baseAssignment('E51', 'NV Năm Mốt'), baseAssignment('E52', 'NV Năm Hai')],
    checklist_employee_assignment_history: [],
    checklist_monthly_periods: [{ id: 'per-current', period_month: CURRENT_PERIOD, status: periodStatus || 'open' }],
    checklist_monthly_forms: [
      baseForm('f-green', 'E50', 'NV Năm Mươi'),
      baseForm('f-yellow', 'E51', 'NV Năm Mốt', { status: 'waiting_review', self_answers: { C1: { value: '8' } }, self_note: 'Đã hoàn thành', self_saved_at: '2026-08-05T00:00:00.000Z', self_submitted_at: '2026-08-05T00:00:00.000Z', self_total_score: 80 }),
      baseForm('f-orange', 'E52', 'NV Năm Hai', { status: 'reviewed', self_answers: { C1: { value: '9' } }, self_note: 'Vượt chỉ tiêu', self_saved_at: '2026-08-06T00:00:00.000Z', self_submitted_at: '2026-08-06T00:00:00.000Z', self_total_score: 90,
        review_answers: { C1: { value: '9' } }, review_note: 'Xác nhận đúng', checklist_review_score: 90, checklist_review_reason: 'Đạt', review_total_score: 90,
        review_saved_at: '2026-08-07T00:00:00.000Z', review_submitted_at: '2026-08-07T00:00:00.000Z', reviewed_by: 'id-mgr', reviewed_by_code: 'MGR1', reviewed_by_name: 'Quản lý',
        final_score: 90, score_calculated_at: '2026-08-07T00:00:00.000Z' })
    ],
    checklist_monthly_form_history: [],
    checklist_violation_records: [],
    checklist_monthly_score_policies: [],
    checklist_monthly_kpi_configs: []
  };
}
let store, rpcCalls;
function resetStore(periodStatus) { store = freshStore(periodStatus); rpcCalls = []; }
function onlyGreenStore() {
  resetStore('open');
  store.checklist_monthly_forms = store.checklist_monthly_forms.filter(f => f.id === 'f-green');
  store.checklist_employee_assignments = store.checklist_employee_assignments.filter(a => a.employee_code === 'E50');
}

class FakeQuery {
  constructor(t) { this.table = t; this.filters = []; this._single = null; this._limit = null; this._patch = null; this._insert = null; this._order = []; }
  select() { return this; }
  eq(c, v) { this.filters.push(r => String(r[c]) === String(v)); return this; }
  neq(c, v) { this.filters.push(r => String(r[c]) !== String(v)); return this; }
  in(c, a) { const s = new Set((a || []).map(String)); this.filters.push(r => s.has(String(r[c]))); return this; }
  not(c, op, val) { if (op === 'in') { const set = new Set(String(val).replace(/[()"]/g, '').split(',').map(s => s.trim())); this.filters.push(r => !set.has(String(r[c]))); } return this; }
  gte(c, v) { this.filters.push(r => String(r[c] || '') >= String(v)); return this; }
  lte(c, v) { this.filters.push(r => String(r[c] || '') <= String(v)); return this; }
  order(c, o) { this._order.push({ c, asc: !(o && o.ascending === false) }); return this; }
  limit(n) { this._limit = n; return this; }
  range() { return this; }
  maybeSingle() { this._single = 'maybe'; return this; }
  single() { this._single = 'strict'; return this; }
  update(p) { this._patch = p; return this; }
  insert(rows) { this._insert = Array.isArray(rows) ? rows : [rows]; return this; }
  then(res, rej) {
    const table = store[this.table] || (store[this.table] = []);
    if (this._insert) { this._insert.forEach(r => table.push(clone(Object.assign({ id: r.id || ('hist-' + Math.random().toString(36).slice(2, 8)) }, r)))); return Promise.resolve({ data: clone(this._insert), error: null }).then(res, rej); }
    const matched = table.filter(r => this.filters.every(f => f(r)));
    if (this._patch) matched.forEach(r => Object.assign(r, this._patch));
    let rows = clone(matched);
    this._order.forEach(o => { rows.sort((a, b) => { const x = a[o.c], y = b[o.c]; return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1); }); });
    if (this._limit != null) rows = rows.slice(0, this._limit);
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
    if (expected && String(expected) !== String(tpl.updated_at)) return { data: null, error: { message: 'CHECKLIST_TEMPLATE_STALE: mẫu đã thay đổi ở nơi khác' } };
    const existing = store.checklist_template_versions.find(v => v.template_key === key && v.version_no === ver);
    if (existing) {
      const same = JSON.stringify(existing.definition) === JSON.stringify(params.p_version.definition);
      if (!same) return { data: null, error: { message: 'CHECKLIST_TEMPLATE_VERSION_IMMUTABLE: version exists with different content' } };
    } else {
      store.checklist_template_versions.push({ template_key: key, version_no: ver, effective_date: params.p_version.effective_date, reason: params.p_version.reason, source_version: params.p_version.source_version, change_type: params.p_version.change_type, definition: clone(params.p_version.definition), created_at: params.p_version.created_at });
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
const monthlyLib = require(path.join(root, 'api', '_lib', 'checklist-monthly.js'));
Module._load = orig;

const ADMIN = { role: 'admin', account: { id: 'admin-1', name: 'Admin Test' }, sub: 'admin-1' };

function formById(id) { return store.checklist_monthly_forms.find(f => f.id === id); }
function historyFor(id) { return store.checklist_monthly_form_history.filter(h => h.form_id === id); }

// ---------------------------------------------------------------------------
// vm sandbox — real frontend source, checklistToast/phfNotice captured (not neutered) so
// success/error message CONTENT can be asserted (items 13/14/15), same convention as
// scripts/test-checklist-criterion-admin-ux-v2.js otherwise.
// ---------------------------------------------------------------------------
const filePath = 'assets/js/checklist/phf-checklist-app.js';
const src = fs.readFileSync(path.join(root, filePath), 'utf8');
const marker = '\n})();';
const idx = src.lastIndexOf(marker);
const expose = "\n  checklistToast=function(type,title,message,sticky){window.__toasts.push({type:type,title:title,message:message,sticky:sticky});};\n" +
  "  window.__ceTest={\n" +
  "    ceOpen:ceOpen, ceAddCriterion:ceAddCriterion, ceCommitAddFormRaw:ceCommitAddFormRaw,\n" +
  "    ceHasSemanticChange:ceHasSemanticChange, ceSaveAndApply:ceSaveAndApply,\n" +
  "    getPendingCePublish:function(){return pendingCePublish;},\n" +
  "    setPendingCePublishRetro:function(patch){if(pendingCePublish&&pendingCePublish.retro)Object.assign(pendingCePublish.retro,patch);},\n" +
  "    ceCriterionList:ceCriterionList, cePublish:cePublish, getCeState:function(){return checklistCeState;},\n" +
  "    checklistCeEditorHtml:checklistCeEditorHtml, cePreviewHtml:cePreviewHtml, ceTimingSectionHtml:ceTimingSectionHtml,\n" +
  "    ceTimingSubmitDisabled:ceTimingSubmitDisabled, ceFinishApplyTiming:ceFinishApplyTiming,\n" +
  "    ceClassifyCurrentPeriod:ceClassifyCurrentPeriod,\n" +
  "    templateCatalog:templateCatalog, templateUiState:templateUiState,\n" +
  "    ensureChecklistTemplatesHydrated:ensureChecklistTemplatesHydrated, nextTemplateVersion:nextTemplateVersion,\n" +
  "    flattenCriteria:flattenCriteria, checklistTemplateDbState:checklistTemplateDbState,\n" +
  "    getRetroDecisionState:function(){return checklistRetroDecisionState;},\n" +
  "    todayIso:todayIso, reportMonthLabel:reportMonthLabel,\n" +
  "    getToasts:function(){return __toasts;}, getNotices:function(){return __notices;}\n" +
  "  };\n";
const testSrc = src.slice(0, idx) + expose + src.slice(idx);
const compiled = new vm.Script(testSrc, { filename: filePath });

function makeLocalStorage() {
  const data = {};
  return { getItem: k => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; } };
}
let fetchRouteOverride = null;
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
  sandbox.localStorage = makeLocalStorage(); sandbox.sessionStorage = makeLocalStorage();
  sandbox.navigator = { userAgent: 'node-test' };
  sandbox.matchMedia = null;
  sandbox.MutationObserver = function () { return { observe: noop, disconnect: noop }; };
  sandbox.fetch = fetchBridge;
  sandbox.URL = URL; sandbox.setTimeout = setTimeout; sandbox.clearTimeout = clearTimeout;
  sandbox.requestAnimationFrame = fn => setTimeout(fn, 0);
  sandbox.CSS = { escape: v => String(v) };
  sandbox.__phfLocalData = null;
  sandbox.__toasts = []; sandbox.__notices = [];
  sandbox.phfNotice = function (msg) { sandbox.__notices.push(msg); };
  const ctx = vm.createContext(sandbox);
  compiled.runInContext(ctx);
  return ctx.window;
}
async function fetchBridge(url, opts) {
  let body = {};
  try { body = JSON.parse((opts && opts.body) || '{}'); } catch (_) {}
  const action = body.action;
  if (fetchRouteOverride) {
    const overridden = await fetchRouteOverride(action, body.input || {});
    if (overridden !== undefined) return overridden;
  }
  try {
    if (action === 'saveChecklistTemplate') { const result = await templatesLib.saveChecklistTemplate(ADMIN, body.template); return { ok: true, status: 200, json: async () => Object.assign({ ok: true }, result) }; }
    if (action === 'checklistRetroClassifyCurrentPeriod') { const result = await monthlyLib.classifyChecklistMonthlyRetroactiveScope(ADMIN, body.input); return { ok: true, status: 200, json: async () => Object.assign({ ok: true }, result) }; }
    if (action === 'checklistRetroApplyCurrentPeriod') { const result = await monthlyLib.applyChecklistMonthlyRetroactiveScope(ADMIN, body.input); return { ok: true, status: 200, json: async () => Object.assign({ ok: true }, result) }; }
    return { ok: false, status: 400, json: async () => ({ ok: false, message: 'unknown action: ' + action }) };
  } catch (error) {
    return { ok: false, status: error.statusCode || 500, json: async () => ({ ok: false, message: error.message, code: error.code || '' }) };
  }
}
async function hydratedTab() {
  const listing = await templatesLib.listChecklistTemplates();
  const win = makeSandbox();
  win.__phfLocalData = { checklistTemplatesReady: true, checklistTemplates: clone(listing.templates) };
  win.__ceTest.templateUiState.selectedId = TPL;
  win.__ceTest.ensureChecklistTemplatesHydrated();
  return win.__ceTest;
}
function makeFieldWrap() {
  const msg = { hidden: true, textContent: '' };
  const classes = {};
  return { classList: { add: c => { classes[c] = true; }, remove: c => { delete classes[c]; }, contains: c => !!classes[c] }, querySelector: sel => (sel === '.phfck-field-error' ? msg : null), _msg: msg };
}
function makeCeAddFormModal(values) {
  values = values || {};
  const fields = { group: { value: values.groupVal != null ? values.groupVal : '' }, groupName: { value: values.groupName != null ? values.groupName : '' }, content: { value: values.content != null ? values.content : '' }, factor: { value: values.factor != null ? String(values.factor) : '1' }, reason: { value: values.reason != null ? values.reason : '' } };
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
const REAL_CHANGE = { groupVal: 'G1::C1', content: 'Kiểm tra sổ quỹ hàng ngày', factor: 2, reason: 'Apply-timing V1 test — thêm tiêu chí' };

async function main() {
  // -------------------------------------------------------------------
  // ITEMS 1/2/16 — timing decision surfaced BEFORE the version is saved (primary flow, not a
  // post-save follow-up), default choice is "now", and the zero-net-change guard still blocks
  // BEFORE classify even runs when nothing actually changed.
  // -------------------------------------------------------------------
  await rec('ITEM 1 — real change: ceSaveAndApply classifies and surfaces the timing choice BEFORE any version is created (no new version row yet)', async () => {
    resetStore('open');
    const api = await hydratedTab();
    api.ceOpen(TPL);
    const versionsBefore = store.checklist_template_versions.length;
    const outcome = await api.ceSaveAndApply(null, makeCeAddFormModal(REAL_CHANGE));
    assert.strictEqual(outcome.ok, true, JSON.stringify(outcome));
    assert.strictEqual(store.checklist_template_versions.length, versionsBefore, 'classify ran, but the version itself is NOT created yet — decision comes first, save comes after confirm');
    const pending = api.getPendingCePublish();
    assert.ok(pending.retro, 'classification result attached to the pending publish');
    assert.strictEqual(pending.retro.offerTiming, true, 'GREEN+YELLOW+ORANGE forms exist for the current period -> timing choice must be offered');
    assert.strictEqual(pending.retro.periodMonth, CURRENT_PERIOD);
  });
  await rec('ITEM 2 — default timing choice is "now" (Áp dụng ngay), pre-selected in the rendered modal', async () => {
    resetStore('open');
    const api = await hydratedTab();
    api.ceOpen(TPL);
    await api.ceSaveAndApply(null, makeCeAddFormModal(REAL_CHANGE));
    const pending = api.getPendingCePublish();
    assert.strictEqual(pending.retro.choice, 'now');
    const html = api.cePreviewHtml(pending);
    assert.ok(/value="now"[^>]*data-phfck-ce-timing-choice checked/.test(html), 'the "now" radio is checked by default');
    assert.ok(!/value="next"[^>]*data-phfck-ce-timing-choice checked/.test(html), '"next" radio is NOT checked by default');
  });
  await rec('ITEM 16 — no semantic change -> blocked before classify even runs; no timing dialog, no version created', async () => {
    resetStore('open');
    const api = await hydratedTab();
    api.ceOpen(TPL);
    const versionsBefore = store.checklist_template_versions.length;
    const outcome = await api.ceSaveAndApply(null, makeCeAddFormModal({ groupVal: 'G1::C1', content: '', factor: '', reason: 'không đổi gì cả, đủ dài' }));
    assert.strictEqual(outcome.ok, false); assert.strictEqual(outcome.reason, 'no-change');
    assert.strictEqual(store.checklist_template_versions.length, versionsBefore, 'no new version');
    assert.strictEqual(api.getPendingCePublish(), null, 'no pending publish staged — never reached the classify/timing step at all');
  });

  // -------------------------------------------------------------------
  // ITEMS 3/4/5 — Apply-now + GREEN: template promoted AND the current form's snapshot
  // updated in place, no duplicate row, new criterion actually present in the form snapshot.
  // -------------------------------------------------------------------
  await rec('ITEMS 3/4/5 — Apply-now (GREEN-only fixture): template promoted, form updated in place (same id, no duplicate row), new criterion present in the form snapshot', async () => {
    onlyGreenStore();
    const api = await hydratedTab();
    api.ceOpen(TPL);
    const formCountBefore = store.checklist_monthly_forms.length;
    const outcome = await api.ceSaveAndApply(null, makeCeAddFormModal(REAL_CHANGE));
    assert.strictEqual(outcome.ok, true, JSON.stringify(outcome));
    const pending = api.getPendingCePublish();
    assert.strictEqual(pending.retro.choice, 'now');
    assert.strictEqual(pending.retro.counts.green, 1); assert.strictEqual(pending.retro.counts.yellow, 0); assert.strictEqual(pending.retro.counts.orange, 0);
    const appliedCe = await api.cePublish(pending.state);
    const criterionCount = api.ceCriterionList(appliedCe).length;
    await api.ceFinishApplyTiming(null, appliedCe, pending, criterionCount);
    assert.strictEqual(store.checklist_templates.find(x => x.template_key === TPL).current_version, appliedCe.version, 'template promoted to the new version');
    assert.strictEqual(store.checklist_monthly_forms.length, formCountBefore, 'NO duplicate form row created');
    const form = formById('f-green');
    assert.strictEqual(form.id, 'f-green', 'same form id — updated in place');
    assert.strictEqual(form.template_version, appliedCe.version, 'form snapshot updated to the new version');
    const flat = api.flattenCriteria(form.template_snapshot.version.definition.groups);
    assert.ok(flat.some(c => c.content === 'Kiểm tra sổ quỹ hàng ngày'), 'the newly-added criterion is actually present in the employee\'s monthly form snapshot — the real PROD gap this closes');
    const notices = api.getNotices();
    assert.ok(notices.some(m => m.indexOf('áp dụng cho') >= 0), 'a concrete apply-now success message was shown');
  });

  // -------------------------------------------------------------------
  // ITEMS 6/7 — Apply-now + YELLOW: warning + explicit confirm required before mutation;
  // reset behavior correct; pre-reset self data preserved in history before_data.
  // -------------------------------------------------------------------
  await rec('ITEM 6 — Apply-now + YELLOW present: warning shown, submit stays disabled until confirmed, then reset (waiting_self, self cleared) after confirmation', async () => {
    resetStore('open');
    const api = await hydratedTab();
    api.ceOpen(TPL);
    await api.ceSaveAndApply(null, makeCeAddFormModal(REAL_CHANGE));
    const pending = api.getPendingCePublish();
    assert.ok(pending.retro.counts.yellow >= 1, 'fixture has a YELLOW form');
    assert.strictEqual(api.ceTimingSubmitDisabled(pending), true, 'submit disabled until the YELLOW/ORANGE confirm checkbox is ticked');
    const html = api.cePreviewHtml(pending);
    // Fixture has BOTH yellow and orange -> the mixed/orange-tier (stronger) warning wins;
    // it still names the yellow count and warns about redoing self-evaluation.
    assert.ok(/đánh giá/.test(html) && /phiếu đã tự đánh giá/.test(html), 'YELLOW (mixed with ORANGE) warning copy present');
    assert.ok(/disabled/.test(html.slice(html.indexOf('data-phfck-apply-ce') - 20)), 'the Lưu & áp dụng button itself is disabled while unconfirmed');
    api.setPendingCePublishRetro({ confirmed: true });
    assert.strictEqual(api.ceTimingSubmitDisabled(pending), false, 'submit re-enabled once confirmed');
    const appliedCe = await api.cePublish(pending.state);
    const criterionCount = api.ceCriterionList(appliedCe).length;
    await api.ceFinishApplyTiming(null, appliedCe, pending, criterionCount);
    const yellow = formById('f-yellow');
    assert.strictEqual(yellow.status, 'waiting_self', 'YELLOW form reset back to waiting_self');
    assert.deepStrictEqual(yellow.self_answers, {}, 'self answers cleared');
    assert.strictEqual(yellow.template_version, appliedCe.version, 'YELLOW form also gets the new snapshot as part of Apply-now');
  });
  await rec('ITEM 7 — YELLOW reset: pre-reset self-evaluation data preserved in checklist_monthly_form_history.before_data', async () => {
    resetStore('open');
    const api = await hydratedTab();
    api.ceOpen(TPL);
    const preYellow = clone(formById('f-yellow'));
    await api.ceSaveAndApply(null, makeCeAddFormModal(REAL_CHANGE));
    const pending = api.getPendingCePublish();
    api.setPendingCePublishRetro({ confirmed: true });
    const appliedCe = await api.cePublish(pending.state);
    await api.ceFinishApplyTiming(null, appliedCe, pending, api.ceCriterionList(appliedCe).length);
    const hy = historyFor('f-yellow');
    assert.strictEqual(hy.length, 1);
    assert.strictEqual(hy[0].action, 'retroactive_apply_current_period_reset');
    assert.deepStrictEqual(hy[0].before_data.selfAnswers, preYellow.self_answers, 'exact pre-reset self_answers preserved in history');
    assert.strictEqual(hy[0].before_data.selfTotalScore, preYellow.self_total_score);
  });

  // -------------------------------------------------------------------
  // ITEMS 8/9 — Apply-now + ORANGE: stronger warning, explicit confirm, pre-reset review data
  // preserved.
  // -------------------------------------------------------------------
  await rec('ITEM 8 — Apply-now + ORANGE present: stronger warning copy mentions "thẩm định", still gated on the same confirm checkbox', async () => {
    resetStore('open');
    const api = await hydratedTab();
    api.ceOpen(TPL);
    await api.ceSaveAndApply(null, makeCeAddFormModal(REAL_CHANGE));
    const pending = api.getPendingCePublish();
    assert.ok(pending.retro.counts.orange >= 1, 'fixture has an ORANGE form');
    const html = api.cePreviewHtml(pending);
    assert.ok(/thẩm định/.test(html), 'ORANGE warning mentions thẩm định (review)');
    assert.strictEqual(api.ceTimingSubmitDisabled(pending), true);
  });
  await rec('ITEM 9 — ORANGE reset: pre-reset review/reviewer/score data preserved in history before_data', async () => {
    resetStore('open');
    const api = await hydratedTab();
    api.ceOpen(TPL);
    const preOrange = clone(formById('f-orange'));
    await api.ceSaveAndApply(null, makeCeAddFormModal(REAL_CHANGE));
    const pending = api.getPendingCePublish();
    api.setPendingCePublishRetro({ confirmed: true });
    const appliedCe = await api.cePublish(pending.state);
    await api.ceFinishApplyTiming(null, appliedCe, pending, api.ceCriterionList(appliedCe).length);
    const ho = historyFor('f-orange');
    assert.strictEqual(ho.length, 1);
    assert.deepStrictEqual(ho[0].before_data.reviewAnswers, preOrange.review_answers);
    assert.strictEqual(ho[0].before_data.finalScore, preOrange.final_score);
    assert.strictEqual(ho[0].before_data.reviewedByCode, preOrange.reviewed_by_code);
    const orange = formById('f-orange');
    assert.strictEqual(orange.status, 'waiting_self'); assert.strictEqual(orange.reviewed_by, null); assert.strictEqual(orange.final_score, null);
  });

  // -------------------------------------------------------------------
  // ITEM 10 — LOCKED current period: timing choice never offered, forms never touched, UI
  // never dishonestly claims an apply happened.
  // -------------------------------------------------------------------
  await rec('ITEM 10 — current period LOCKED: classify reports periodLocked, no timing choice offered, forms stay byte-for-byte unchanged, honest "locked" message shown', async () => {
    resetStore('locked');
    const api = await hydratedTab();
    api.ceOpen(TPL);
    const beforeForms = clone(store.checklist_monthly_forms);
    const outcome = await api.ceSaveAndApply(null, makeCeAddFormModal(REAL_CHANGE));
    assert.strictEqual(outcome.ok, true);
    const pending = api.getPendingCePublish();
    assert.strictEqual(pending.retro.periodLocked, true);
    assert.strictEqual(pending.retro.offerTiming, false, 'no timing choice offered for a locked period');
    const html = api.cePreviewHtml(pending);
    assert.ok(!/data-phfck-ce-timing-choice/.test(html), 'no radio choice rendered at all when the period is locked');
    const appliedCe = await api.cePublish(pending.state);
    await api.ceFinishApplyTiming(null, appliedCe, pending, api.ceCriterionList(appliedCe).length);
    assert.deepStrictEqual(store.checklist_monthly_forms, beforeForms, 'locked-period forms completely untouched — version save never mutates a locked form');
    assert.strictEqual(store.checklist_monthly_form_history.length, 0, 'no retroactive-apply history written for a locked period');
    const notices = api.getNotices();
    assert.ok(notices.some(m => /khóa/.test(m)), 'success message honestly states the period is locked, not a false "applied" claim');
  });

  // -------------------------------------------------------------------
  // ITEM 11 — "Chỉ áp dụng từ kỳ tiếp theo": template version promoted, current period's form
  // snapshot verified byte-for-byte UNCHANGED.
  // -------------------------------------------------------------------
  await rec('ITEM 11 — "Chỉ áp dụng từ kỳ tiếp theo": version promoted but the current-period form snapshot is byte-for-byte unchanged', async () => {
    resetStore('open');
    const api = await hydratedTab();
    api.ceOpen(TPL);
    const beforeGreen = clone(formById('f-green')), beforeYellow = clone(formById('f-yellow')), beforeOrange = clone(formById('f-orange'));
    await api.ceSaveAndApply(null, makeCeAddFormModal(REAL_CHANGE));
    const pending = api.getPendingCePublish();
    api.setPendingCePublishRetro({ choice: 'next' });
    const appliedCe = await api.cePublish(pending.state);
    assert.notStrictEqual(store.checklist_templates.find(x => x.template_key === TPL).current_version, 'KTT-2.2', 'template version DID get promoted');
    await api.ceFinishApplyTiming(null, appliedCe, pending, api.ceCriterionList(appliedCe).length);
    assert.deepStrictEqual(formById('f-green'), beforeGreen, 'GREEN form byte-for-byte unchanged');
    assert.deepStrictEqual(formById('f-yellow'), beforeYellow, 'YELLOW form byte-for-byte unchanged');
    assert.deepStrictEqual(formById('f-orange'), beforeOrange, 'ORANGE form byte-for-byte unchanged');
    assert.strictEqual(store.checklist_monthly_form_history.length, 0, 'no retroactive-apply call made at all for "next period"');
  });

  // -------------------------------------------------------------------
  // ITEM 12 — a subsequently-created form for the NEXT period resolves to the new
  // current_version (via buildMonthlyCreationState, the same resolver createMonthly() uses).
  // -------------------------------------------------------------------
  await rec('ITEM 12 — next-period form resolution (buildMonthlyCreationState) uses the newly-promoted current_version', async () => {
    resetStore('open');
    const api = await hydratedTab();
    api.ceOpen(TPL);
    await api.ceSaveAndApply(null, makeCeAddFormModal(REAL_CHANGE));
    const pending = api.getPendingCePublish();
    api.setPendingCePublishRetro({ choice: 'next' });
    const appliedCe = await api.cePublish(pending.state);
    await api.ceFinishApplyTiming(null, appliedCe, pending, api.ceCriterionList(appliedCe).length);
    const prepared = await monthlyLib.buildMonthlyCreationState(NEXT_PERIOD);
    const row = prepared.rows.find(r => r.employee_code === 'E50');
    assert.ok(row, 'E50 resolves for the next period');
    assert.strictEqual(row.template_version, appliedCe.version, 'next-period form resolution picks up the newly-promoted current_version');
  });

  // -------------------------------------------------------------------
  // ITEMS 13/14 — success messages state the REAL computed result, not just generic text.
  // -------------------------------------------------------------------
  await rec('ITEM 13 — apply-now success message contains the actual affected-form count and the actual current month', async () => {
    resetStore('open');
    const api = await hydratedTab();
    api.ceOpen(TPL);
    await api.ceSaveAndApply(null, makeCeAddFormModal(REAL_CHANGE));
    const pending = api.getPendingCePublish();
    api.setPendingCePublishRetro({ confirmed: true }); // yellow+orange present -> needs explicit confirm
    const appliedCe = await api.cePublish(pending.state);
    const criterionCount = api.ceCriterionList(appliedCe).length;
    await api.ceFinishApplyTiming(null, appliedCe, pending, criterionCount);
    const monthLabel = CURRENT_PERIOD.split('-')[1] + '/' + CURRENT_PERIOD.split('-')[0];
    const notices = api.getNotices();
    assert.ok(notices.some(m => m.indexOf('Đã cập nhật ' + criterionCount + ' tiêu chí') >= 0 && m.indexOf('áp dụng cho 3 phiếu') >= 0 && m.indexOf(monthLabel) >= 0), 'message states the real criterion count (' + criterionCount + '), real applied-form count (3: green+yellow+orange), and the real current month (' + monthLabel + '): ' + JSON.stringify(notices));
  });
  await rec('ITEM 14 — next-period success message states the actual next period', async () => {
    resetStore('open');
    const api = await hydratedTab();
    api.ceOpen(TPL);
    await api.ceSaveAndApply(null, makeCeAddFormModal(REAL_CHANGE));
    const pending = api.getPendingCePublish();
    api.setPendingCePublishRetro({ choice: 'next' });
    const appliedCe = await api.cePublish(pending.state);
    await api.ceFinishApplyTiming(null, appliedCe, pending, api.ceCriterionList(appliedCe).length);
    const nextLabel = NEXT_PERIOD.split('-')[1] + '/' + NEXT_PERIOD.split('-')[0];
    const notices = api.getNotices();
    assert.ok(notices.some(m => m.indexOf(nextLabel) >= 0), 'message states the real next period (' + nextLabel + '): ' + JSON.stringify(notices));
  });

  // -------------------------------------------------------------------
  // ITEM 15 — simulated failure of the retroactive-apply step AFTER a successful version-save
  // must NOT produce a false "full success" message, and must leave a reachable retry path.
  // -------------------------------------------------------------------
  await rec('ITEM 15 — Phase 2 (apply) fails after Phase 1 (version save) succeeds: no false-success message, honest partial-failure message shown, retry path reachable (checklistRetroDecisionState re-opened)', async () => {
    resetStore('open');
    const api = await hydratedTab();
    api.ceOpen(TPL);
    await api.ceSaveAndApply(null, makeCeAddFormModal(REAL_CHANGE));
    const pending = api.getPendingCePublish();
    api.setPendingCePublishRetro({ confirmed: true });
    const appliedCe = await api.cePublish(pending.state);
    const versionAfterPhase1 = store.checklist_templates.find(x => x.template_key === TPL).current_version;
    assert.notStrictEqual(versionAfterPhase1, 'KTT-2.2', 'Phase 1 (version save) already succeeded and is safely persisted');
    let applyCallCount = 0;
    fetchRouteOverride = async (action) => {
      if (action === 'checklistRetroApplyCurrentPeriod') { applyCallCount++; return { ok: false, status: 500, json: async () => ({ ok: false, message: 'mất kết nối máy chủ (giả lập)' }) }; }
      return undefined; // fall through to the real routing for classify (used by the retry re-open)
    };
    try {
      const criterionCount = api.ceCriterionList(appliedCe).length;
      // root=null: same "no DOM in this offline harness" convention used everywhere else in
      // this file — checklistRetroOfferCurrentPeriod (the retry mechanism) still runs its
      // classify call and still sets checklistRetroDecisionState with root=null, it only
      // skips the appendSubmodal() DOM render, exactly like every other call site here.
      await api.ceFinishApplyTiming(null, appliedCe, pending, criterionCount);
      const toasts = api.getToasts();
      const notices = api.getNotices();
      assert.strictEqual(applyCallCount, 1, 'the apply step really was attempted exactly once');
      assert.ok(!notices.some(m => /và áp dụng cho/.test(m)), 'NO message claims forms were actually applied — that would be a false success');
      assert.ok(toasts.some(x => x.type === 'error' && /chưa áp dụng được/.test(x.message)), 'an honest partial-failure toast was shown: ' + JSON.stringify(toasts));
      assert.strictEqual(store.checklist_templates.find(x => x.template_key === TPL).current_version, versionAfterPhase1, 'the already-saved version is untouched/still safe despite Phase 2 failing');
      assert.strictEqual(store.checklist_monthly_form_history.length, 0, 'no history rows were written by the failed attempt');
      assert.ok(api.getRetroDecisionState(), 'reachable retry path: the existing retro-decision mechanism was re-opened (checklistRetroDecisionState populated) so Admin can retry the apply without redoing the version save');
    } finally {
      fetchRouteOverride = null;
    }
  });

  // -------------------------------------------------------------------
  // Backend — mode:'all' (the single-call extension backing "Áp dụng ngay" when GREEN and
  // YELLOW/ORANGE both exist): green gets the safe (no-reset) patch, yellow/orange get reset,
  // all in one applyChecklistMonthlyRetroactiveScope call; locked period still hard-refused.
  // -------------------------------------------------------------------
  await rec('Backend — mode:"all" applies GREEN (no reset) + YELLOW/ORANGE (reset) together in ONE call', async () => {
    resetStore('open');
    // Bump the template to a new version first (mirrors real usage: mode:'all' is only ever
    // called AFTER cePublish already promoted current_version) — otherwise the GREEN form's
    // snapshot already matches the "target" and is correctly skipped as unchanged (see the
    // existing 'skipped-unchanged' guard, untouched by this change).
    store.checklist_template_versions.push({ template_key: TPL, version_no: 'KTT-2.3', effective_date: '2026-09-01', reason: 'bump', source_version: 'KTT-2.2', change_type: 'web-criteria-admin', definition: clone(V1_DEF), created_at: '2026-09-01T00:00:00.000Z' });
    store.checklist_templates.find(x => x.template_key === TPL).current_version = 'KTT-2.3';
    const out = await monthlyLib.applyChecklistMonthlyRetroactiveScope(ADMIN, { templateId: TPL, periodMonth: CURRENT_PERIOD, mode: 'all', reason: 'Apply-timing V1 — áp dụng ngay tất cả các mức' });
    assert.strictEqual(out.appliedCount, 3, 'all 3 forms (green+yellow+orange) applied in one call');
    const green = formById('f-green'), yellow = formById('f-yellow'), orange = formById('f-orange');
    assert.strictEqual(green.status, 'draft', 'GREEN: status untouched (no reset — no data to lose)');
    assert.strictEqual(yellow.status, 'waiting_self', 'YELLOW: reset');
    assert.strictEqual(orange.status, 'waiting_self', 'ORANGE: reset');
    assert.strictEqual(historyFor('f-green')[0].action, 'retroactive_apply_current_period_safe');
    assert.strictEqual(historyFor('f-yellow')[0].action, 'retroactive_apply_current_period_reset');
  });
  await rec('Backend — mode:"all" on a LOCKED period is still refused exactly like "safe"/"reset"', async () => {
    resetStore('locked');
    let threw = null;
    try { await monthlyLib.applyChecklistMonthlyRetroactiveScope(ADMIN, { templateId: TPL, periodMonth: CURRENT_PERIOD, mode: 'all', reason: 'thử áp dụng lên kỳ đã khóa' }); } catch (e) { threw = e; }
    assert.ok(threw && threw.code === 'CHECKLIST_MONTHLY_RETRO_SCOPE_PERIOD_LOCKED');
  });

  console.log('\n' + passed + ' passed, ' + failures + ' failed.');
  if (failures) process.exit(1);
}

main().catch(e => { console.error('UNCAUGHT', e); process.exit(1); });
