'use strict';
/*
 * Regression — Business rule change: "Đồng bộ kỳ" no longer gates opening a monthly
 * period on self_open_at (deadline). PROD symptom: period 2026-09 had 33 draft forms
 * (reviewer+template already set) stuck because self_open_at was misconfigured to a
 * future date (2026-10-01) and syncMonthlyCycle() only called openMonthly() when
 * now>=Date.parse(effectiveWindow.selfOpenAt).
 *
 * Approved rule: self_open_at/self_due_at become pure SLA/deadline metadata (late/
 * on-time labeling + audit only). They must NEVER gate:
 *   - triggering the open itself (syncMonthlyCycle -> openMonthly), or
 *   - a self-evaluation save/submit (selfEditWindow().canEdit).
 * The RPC open_checklist_monthly_period's all-or-nothing missing-reviewer/missing-
 * template safety net (scripts/PHF_CHECKLIST_MONTHLY_OPEN_1.27.sql) is UNCHANGED and
 * is faithfully re-implemented here as a fake RPC (not modified) to prove the app
 * layer still respects it.
 *
 * In-memory only. @supabase/supabase-js is stubbed. No real Supabase, no real network,
 * no PROD DB touched.
 *   node scripts/test-checklist-monthly-self-open-no-gate-2026-09.js
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

// Far-future period so effectiveWindow.selfOpenAt (always "next month, day X") is
// guaranteed to be in the future relative to whatever real clock runs this script —
// this reproduces the exact PROD shape (self_open_at ahead of "now") without faking Date.
const FAR_YEAR = new Date().getFullYear() + 5;
const PERIOD = FAR_YEAR + '-09';
const TPL = { id: 'tpl-a', v: 'V1' };

function baseForm(id, employeeCode, over) {
  return Object.assign({
    id, period_id: 'p-main', period_month: PERIOD, status: 'draft',
    employee_id: 'e-' + employeeCode, employee_code: employeeCode, employee_name: 'NV ' + employeeCode,
    department: 'Phòng KD', title: 'Nhân viên', branch: '',
    reviewer_id: 'e-RV', reviewer_code: 'RV01', reviewer_name: 'Người thẩm định',
    template_id: TPL.id, template_version: TPL.v,
    template_snapshot: { template: { name: 'Mẫu A' }, version: { version_no: TPL.v, definition: { totalRows: [{ code: 'C1', content: 'Doanh số', target: 10, weight: 100, unit: '' }] } } },
    score_policy_snapshot: { selfWeight: 1, reviewWeight: 2 }, score_formula_version: 'v0',
    checklist_score: 100, self_answers: {}, review_answers: {}, final_score: null,
    self_saved_at: null, self_submitted_at: null, review_saved_at: null, review_submitted_at: null, reviewed_by: null,
    pilot_opened_at: null, admin_exception_open: false, updated_at: '2020-01-01T00:00:00Z'
  }, over || {});
}
function assignmentRow(employeeCode, over) {
  return Object.assign({
    employee_key: employeeCode.toLowerCase(), employee_id: 'e-' + employeeCode, employee_code: employeeCode, employee_name: 'NV ' + employeeCode,
    department: 'Phòng KD', title: 'Nhân viên', branch: '',
    manager_id: 'e-RV', manager_code: 'RV01', manager_name: 'Người thẩm định',
    employee_status: 'Đang làm việc', template_id: TPL.id, template_version: TPL.v,
    effective_date: '2020-01-01', updated_at: '2020-01-01T00:00:00Z'
  }, over || {});
}

let store;
function emptyStore() {
  store = {
    checklist_monthly_periods: [],
    checklist_monthly_forms: [],
    checklist_monthly_form_history: [],
    checklist_employee_assignments: [],
    checklist_employee_assignment_history: [],
    checklist_templates: [{ template_key: TPL.id, name: 'Mẫu A', status: 'active', updated_at: '2020-01-01T00:00:00Z' }],
    checklist_template_versions: [{ template_key: TPL.id, version_no: TPL.v, effective_date: '2020-01-01', created_at: '2020-01-01T00:00:00Z', definition: { totalRows: [{ code: 'C1', content: 'Doanh số', target: 10, weight: 100, unit: '' }] } }],
    checklist_violation_records: [],
    checklist_monthly_score_policies: [],
    checklist_monthly_score_policy_history: [],
    checklist_system_settings: [],
    checklist_monthly_period_overrides: [],
    checklist_monthly_kpi_configs: []
  };
}
// Main scenario: period draft, 2 openable drafts (reviewer+template ok) + 4 forms
// already past draft (waiting_self/waiting_review/reviewed/locked) that must stay put.
function resetMainStore() {
  emptyStore();
  store.checklist_monthly_periods.push({ id: 'p-main', period_month: PERIOD, status: 'draft', synced_at: null, cycle_policy_snapshot: null, self_open_at: null, self_due_at: null, review_open_at: null, review_due_at: null, scheduled_lock_at: null });
  store.checklist_monthly_forms.push(
    baseForm('f1', 'E01'),
    baseForm('f2', 'E02'),
    baseForm('f3', 'E03', { status: 'waiting_self', self_submitted_at: null, updated_at: '2020-02-01T00:00:00Z' }),
    baseForm('f4', 'E04', { status: 'waiting_review', self_submitted_at: '2020-02-01T00:00:00Z', updated_at: '2020-02-01T00:00:00Z' }),
    baseForm('f5', 'E05', { status: 'reviewed', self_submitted_at: '2020-02-01T00:00:00Z', review_submitted_at: '2020-02-02T00:00:00Z', updated_at: '2020-02-02T00:00:00Z' }),
    baseForm('f6', 'E06', { status: 'locked', self_submitted_at: '2020-02-01T00:00:00Z', review_submitted_at: '2020-02-02T00:00:00Z', updated_at: '2020-02-03T00:00:00Z' })
  );
  ['E01', 'E02', 'E03', 'E04', 'E05', 'E06'].forEach(code => store.checklist_employee_assignments.push(assignmentRow(code)));
}
// Missing-reviewer scenario: one draft form has no reviewer, and its assignment also has
// no manager -> reconcile cannot repair it -> RPC must block the ENTIRE open.
function resetMissingReviewerStore() {
  emptyStore();
  store.checklist_monthly_periods.push({ id: 'p-mr', period_month: PERIOD, status: 'draft', synced_at: null, cycle_policy_snapshot: null });
  store.checklist_monthly_forms.push(
    baseForm('g1', 'E11'),
    baseForm('g2', 'E12', { reviewer_id: '', reviewer_code: '', reviewer_name: '' })
  );
  store.checklist_monthly_forms.forEach(f => f.period_id = 'p-mr');
  store.checklist_employee_assignments.push(assignmentRow('E11'));
  store.checklist_employee_assignments.push(assignmentRow('E12', { manager_id: '', manager_code: '', manager_name: '' }));
}
// Missing-template scenario: one draft form has blank template fields.
function resetMissingTemplateStore() {
  emptyStore();
  store.checklist_monthly_periods.push({ id: 'p-mt', period_month: PERIOD, status: 'draft', synced_at: null, cycle_policy_snapshot: null });
  store.checklist_monthly_forms.push(
    baseForm('h1', 'E21'),
    baseForm('h2', 'E22', { template_id: '', template_version: '' })
  );
  store.checklist_monthly_forms.forEach(f => f.period_id = 'p-mt');
  store.checklist_employee_assignments.push(assignmentRow('E21'));
  store.checklist_employee_assignments.push(assignmentRow('E22'));
}
// Case 6/7 scenario: one waiting_self form, period.self_due_at far in the PAST.
function resetSelfSaveStore(periodStatus) {
  emptyStore();
  store.checklist_monthly_periods.push({ id: 'p-self', period_month: PERIOD, status: periodStatus, self_open_at: '2000-01-01T00:00:00+07:00', self_due_at: '2000-01-02T23:59:00+07:00' });
  store.checklist_monthly_forms.push(baseForm('s1', 'E31', { period_id: 'p-self', status: 'waiting_self' }));
  store.checklist_employee_assignments.push(assignmentRow('E31'));
}

class FakeQuery {
  constructor(t) { this.table = t; this.filters = []; this._single = null; this._limit = null; this._patch = null; this._insert = null; }
  select() { return this; }
  eq(c, v) { this.filters.push(r => String(r[c]) === String(v)); return this; }
  neq(c, v) { this.filters.push(r => String(r[c]) !== String(v)); return this; }
  in(c, a) { const s = new Set((a || []).map(String)); this.filters.push(r => s.has(String(r[c]))); return this; }
  gte(c, v) { this.filters.push(r => String(r[c] || '') >= String(v)); return this; }
  lte(c, v) { this.filters.push(r => String(r[c] || '') <= String(v)); return this; }
  order() { return this; }
  limit(n) { this._limit = n; return this; }
  range() { return this; }
  maybeSingle() { this._single = 'maybe'; return this; }
  single() { this._single = 'strict'; return this; }
  update(p) { this._patch = p; return this; }
  insert(rows) { this._insert = Array.isArray(rows) ? rows : [rows]; return this; }
  then(res, rej) {
    const table = store[this.table] || (store[this.table] = []);
    if (this._insert) { this._insert.forEach(row => table.push(clone(row))); return Promise.resolve({ data: clone(this._insert), error: null }).then(res, rej); }
    const matched = table.filter(r => this.filters.every(f => f(r)));
    if (this._patch) matched.forEach(r => Object.assign(r, this._patch));
    let rows = clone(matched);
    if (this._limit != null) rows = rows.slice(0, this._limit);
    let p;
    if (this._single === 'maybe') p = { data: rows[0] || null, error: null };
    else if (this._single === 'strict') p = rows.length ? { data: rows[0], error: null } : { data: null, error: { message: 'no rows' } };
    else p = { data: rows, error: null };
    return Promise.resolve(p).then(res, rej);
  }
}

const rpcCalls = [];
function fakeOpenChecklistMonthlyPeriod(p) {
  // Faithful re-implementation of scripts/PHF_CHECKLIST_MONTHLY_OPEN_1.27.sql — NOT modified,
  // mirrored here so the app-layer orchestration (syncMonthlyCycle/openMonthly) can be tested
  // offline against the exact same all-or-nothing safety contract.
  const period = store.checklist_monthly_periods.find(x => x.period_month === p.p_period_month);
  if (!period) return { ok: false, code: 'PERIOD_NOT_FOUND', message: 'Chưa có kỳ đánh giá để mở.' };
  if (period.status === 'locked') return { ok: false, code: 'PERIOD_LOCKED', message: 'Kỳ đánh giá đã khóa.' };
  if (period.status === 'open') return { ok: true, alreadyOpen: true, total: store.checklist_monthly_forms.filter(f => f.period_id === period.id).length };
  const forms = store.checklist_monthly_forms.filter(f => f.period_id === period.id && f.status !== 'cancelled');
  if (!forms.length) return { ok: false, code: 'NO_FORMS', message: 'Kỳ này chưa có phiếu để mở.' };
  const missingReviewer = forms.filter(f => !f.reviewer_id && !f.reviewer_code).length;
  if (missingReviewer > 0) return { ok: false, code: 'MISSING_REVIEWER', message: 'Còn ' + missingReviewer + ' phiếu chưa có người thẩm định.', missingReviewer };
  const missingTemplate = forms.filter(f => !f.template_id || !f.template_version).length;
  if (missingTemplate > 0) return { ok: false, code: 'MISSING_TEMPLATE', message: 'Còn ' + missingTemplate + ' phiếu chưa đủ mẫu hoặc phiên bản.', missingTemplate };
  forms.filter(f => f.status === 'draft').forEach(f => { f.status = 'waiting_self'; f.updated_at = new Date().toISOString(); });
  Object.assign(period, { status: 'open', opened_at: new Date().toISOString(), opened_by: p.p_actor_id || '', opened_by_name: p.p_actor_name || '' });
  return { ok: true, alreadyOpen: false, total: forms.length };
}
async function fakeRpc(name, p) {
  rpcCalls.push({ name, p });
  if (name === 'phf_create_checklist_monthly') {
    return { data: { ok: true, created: 0, skipped: (p.p_forms || []).length }, error: null };
  }
  if (name === 'change_checklist_monthly_reviewer') {
    const f = store.checklist_monthly_forms.find(x => x.id === p.p_form_id);
    const before = { reviewerId: f.reviewer_id, reviewerCode: f.reviewer_code, reviewerName: f.reviewer_name };
    f.reviewer_id = p.p_reviewer_id; f.reviewer_code = p.p_reviewer_code; f.reviewer_name = p.p_reviewer_name;
    return { data: { ok: true, before, after: { reviewerId: f.reviewer_id, reviewerCode: f.reviewer_code, reviewerName: f.reviewer_name } }, error: null };
  }
  if (name === 'open_checklist_monthly_period') {
    return { data: fakeOpenChecklistMonthlyPeriod(p), error: null };
  }
  if (name === 'phf_save_checklist_monthly_self') {
    const f = store.checklist_monthly_forms.find(x => x.id === p.p_form_id);
    if (!f) return { data: { ok: false, code: 'CHECKLIST_MONTHLY_SELF_NOT_FOUND' }, error: null };
    if (p.p_expected_updated_at && f.updated_at !== p.p_expected_updated_at) return { data: { ok: false, code: 'CHECKLIST_MONTHLY_SELF_STALE' }, error: null };
    Object.assign(f, p.p_patch, { updated_at: new Date().toISOString() });
    return { data: { ok: true, form: clone(f) }, error: null };
  }
  return { data: null, error: { message: 'unmocked rpc ' + name } };
}
const orig = Module._load;
Module._load = function (req) {
  if (req === '@supabase/supabase-js') return { createClient: () => ({ from: t => new FakeQuery(t), rpc: (n, p) => fakeRpc(n, p) }) };
  return orig.apply(this, arguments);
};
const lib = require(path.join(__dirname, '..', 'api', '_lib', 'checklist-monthly.js'));
Module._load = orig;

const ADMIN = { role: 'admin', account: { id: 'admin-1', name: 'Admin Test' }, sub: 'admin-1' };
const EMPLOYEE_E31 = { role: 'user', account: { id: 'e-E31', name: 'NV E31' }, sub: 'e-E31', employeeCode: 'E31', employeeId: 'e-E31' };
let fails = 0;
async function rec(name, fn) { try { await fn(); console.log('PASS -', name); } catch (e) { fails++; console.log('FAIL -', name, '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n  ') : e)); } }
function formsOf(periodId) { return store.checklist_monthly_forms.filter(f => f.period_id === periodId); }
function byId(id) { return store.checklist_monthly_forms.find(f => f.id === id); }

async function main() {
  // ---------- CASE 1 — future self_open_at no longer blocks the open ----------
  await rec('CASE 1 — manual sync (automatic:false) with self_open_at in the FUTURE still opens the period via RPC', async () => {
    resetMainStore(); rpcCalls.length = 0;
    const out = await lib.syncMonthlyCycle(ADMIN, { month: PERIOD, automatic: false });
    assert.ok(Date.parse(out.window.selfOpenAt) > Date.now(), 'sanity: effectiveWindow.selfOpenAt really is in the future');
    assert.ok(rpcCalls.some(c => c.name === 'open_checklist_monthly_period'), 'openMonthly RPC was invoked despite future self_open_at');
    assert.strictEqual(out.opened, true, 'syncMonthlyCycle reports opened:true');
    assert.strictEqual(store.checklist_monthly_periods.find(x => x.id === 'p-main').status, 'open', 'period flipped to open');
  });

  // ---------- CASE 2 — eligible drafts (reviewer+template) -> waiting_self ----------
  await rec('CASE 2 — draft forms with reviewer+template transition to waiting_self', async () => {
    resetMainStore();
    await lib.syncMonthlyCycle(ADMIN, { month: PERIOD, automatic: false });
    assert.strictEqual(byId('f1').status, 'waiting_self');
    assert.strictEqual(byId('f2').status, 'waiting_self');
  });

  // ---------- CASE 3 — one form missing reviewer/template blocks the ENTIRE open ----------
  await rec('CASE 3a — one draft missing REVIEWER blocks entire open (RPC MISSING_REVIEWER), no form changes', async () => {
    resetMissingReviewerStore();
    const before = clone(store.checklist_monthly_forms);
    const out = await lib.syncMonthlyCycle(ADMIN, { month: PERIOD, automatic: false });
    assert.strictEqual(out.opened, false, 'opened:false');
    assert.ok(out.warnings.some(w => w.code === 'MISSING_REVIEWER'), 'MISSING_REVIEWER surfaced as warning (existing catch behavior, unchanged)');
    assert.deepStrictEqual(store.checklist_monthly_forms.map(f => f.status), before.map(f => f.status), 'no form status changed');
    assert.strictEqual(store.checklist_monthly_periods.find(x => x.id === 'p-mr').status, 'draft', 'period stays draft');
  });
  await rec('CASE 3b — one draft missing TEMPLATE/VERSION blocks entire open (RPC MISSING_TEMPLATE), no form changes', async () => {
    resetMissingTemplateStore();
    const before = clone(store.checklist_monthly_forms);
    let threw = null;
    try { await lib.syncMonthlyCycle(ADMIN, { month: PERIOD, automatic: false }); } catch (e) { threw = e; }
    // MISSING_TEMPLATE is not one of the codes syncMonthlyCycle() softens into a warning
    // (only MISSING_REVIEWER is) — this is PRE-EXISTING behavior, untouched by this change.
    // The safety property under test is preserved either way: nothing transitions.
    assert.ok(threw, 'syncMonthlyCycle propagates the block (pre-existing behavior, not modified here)');
    assert.deepStrictEqual(store.checklist_monthly_forms.map(f => f.status), before.map(f => f.status), 'no form status changed');
    assert.strictEqual(store.checklist_monthly_periods.find(x => x.id === 'p-mt').status, 'draft', 'period stays draft');
  });

  // ---------- CASE 4 — forms already past draft are NOT touched ----------
  await rec('CASE 4 — waiting_self/waiting_review/reviewed/locked forms untouched by sync', async () => {
    resetMainStore();
    const before = { f3: clone(byId('f3')), f4: clone(byId('f4')), f5: clone(byId('f5')), f6: clone(byId('f6')) };
    await lib.syncMonthlyCycle(ADMIN, { month: PERIOD, automatic: false });
    assert.deepStrictEqual(byId('f3'), before.f3, 'f3 (waiting_self) byte-identical');
    assert.deepStrictEqual(byId('f4'), before.f4, 'f4 (waiting_review) byte-identical');
    assert.deepStrictEqual(byId('f5'), before.f5, 'f5 (reviewed) byte-identical');
    assert.deepStrictEqual(byId('f6'), before.f6, 'f6 (locked) byte-identical');
  });

  // ---------- CASE 5 — template_id/template_version/template_snapshot unchanged ----------
  await rec('CASE 5 — template_id/template_version/template_snapshot byte-for-byte unchanged after sync/open', async () => {
    resetMainStore();
    const beforeTpl = { id: byId('f1').template_id, v: byId('f1').template_version, snap: clone(byId('f1').template_snapshot) };
    await lib.syncMonthlyCycle(ADMIN, { month: PERIOD, automatic: false });
    assert.strictEqual(byId('f1').status, 'waiting_self');
    assert.strictEqual(byId('f1').template_id, beforeTpl.id);
    assert.strictEqual(byId('f1').template_version, beforeTpl.v);
    assert.deepStrictEqual(byId('f1').template_snapshot, beforeTpl.snap);
  });

  // ---------- CASE 6 — self_due_at in the past still allows save/submit (late, not blocked) ----------
  await rec('CASE 6 — self_due_at far in the past: saveMyMonthly still succeeds (late flag only, canEdit not blocked)', async () => {
    resetSelfSaveStore('open');
    const periodRow = store.checklist_monthly_periods[0];
    assert.ok(Date.now() > Date.parse(periodRow.self_due_at), 'sanity: self_due_at really is in the past');
    const out = await lib.saveMyMonthly(EMPLOYEE_E31, { formId: 's1', answers: { C1: { value: '5' } }, submit: true });
    assert.strictEqual(out.saved, true);
    assert.strictEqual(out.form.status, 'waiting_review', 'submit succeeded despite being past self_due_at');
    assert.strictEqual(out.selfLate.late, true, 'flagged late');
    assert.ok(out.selfLate.lateDays >= 1, 'lateDays computed (got ' + out.selfLate.lateDays + ')');
  });

  // ---------- CASE 7 — period locked still blocks save/submit ----------
  await rec('CASE 7 — period status=locked: saveMyMonthly still blocked (CHECKLIST_MONTHLY_PERIOD_LOCKED, unchanged)', async () => {
    resetSelfSaveStore('locked');
    let threw = null;
    try { await lib.saveMyMonthly(EMPLOYEE_E31, { formId: 's1', answers: { C1: { value: '5' } }, submit: true }); } catch (e) { threw = e; }
    assert.ok(threw && threw.code === 'CHECKLIST_MONTHLY_PERIOD_LOCKED', 'blocked with CHECKLIST_MONTHLY_PERIOD_LOCKED, got ' + (threw && threw.code));
    assert.strictEqual(byId('s1').status, 'waiting_self', 'form untouched');
  });

  // ---------- CASE 8 — review flow (B4 quá hạn vẫn thẩm định được) fully unaffected ----------
  await rec('CASE 8 — reviewWindowState(): past review_due_at + period NOT locked -> still canReview=true (non-regression, zero lines changed)', () => {
    const past = { reviewOpenAt: '2000-01-01T00:00:00+07:00', reviewDueAt: '2000-01-04T23:59:00+07:00' };
    const w = lib.reviewWindowState(past, { status: 'waiting_review', self_submitted_at: '2000-01-02T09:00:00+07:00' }, 'open');
    assert.strictEqual(w.canReview, true, 'still reviewable past due when period open');
    assert.strictEqual(w.state, 'overdue');
    assert.ok(w.late === true && w.lateDays >= 1);
    const wLocked = lib.reviewWindowState(past, { status: 'waiting_review', self_submitted_at: '2000-01-02T09:00:00+07:00' }, 'locked');
    assert.strictEqual(wLocked.canReview, false, 'still blocked once period locked (unchanged rule)');
  });

  console.log(fails ? ('\n' + fails + ' FAIL') : '\nALL PASS');
  process.exit(fails ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
