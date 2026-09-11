'use strict';
/*
 * Regression — Checklist Criterion Simplify V1 — Phase 2B: retroactive-apply DECISION for
 * the CURRENT PERIOD's already-created monthly forms, after Criterion Admin / Bảng tổng
 * điểm "Lưu & áp dụng" succeeds.
 *
 * Backend under test: classifyChecklistMonthlyRetroactiveScope() + applyChecklistMonthlyRetroactiveScope()
 * (api/_lib/checklist-monthly.js). NOT a new engine — reuses buildMonthlyCreationState()
 * (already used by resnapshotMonthlyDraftTemplate) to resolve the effective template/version
 * per employee, and the same checklist_monthly_forms columns used by saveMyMonthly/
 * saveMonthlyReview to detect "has self data" / "has review data".
 *
 * Same offline convention as scripts/test-checklist-monthly-form-version-override-2026-09.js:
 * real checklist-monthly.js loaded with @supabase/supabase-js stubbed in-memory. Zero
 * network/DB I/O; nothing here ever touches PROD or SANDBOX.
 *
 *   node scripts/test-checklist-retroactive-current-period-v1.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';
const assert = require('assert');
const path = require('path');
const Module = require('module');
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

const TPL = 'ktt-test';
const V1_DEF = { templateType: 'score_summary', groups: [], totalRows: [{ id: 'C1', code: 'C1', name: 'Doanh số', target: 10, unit: '', weight: 100, source: { type: 'manual' } }] };
const V2_DEF = { templateType: 'score_summary', groups: [], totalRows: [{ id: 'C1', code: 'C1', name: 'Doanh số (đã cập nhật)', target: 12, unit: '', weight: 100, source: { type: 'manual' } }] };
const OTHER_TPL = 'other-tpl';
const OTHER_DEF = { templateType: 'score_summary', groups: [], totalRows: [{ id: 'X', code: 'X', name: 'X', target: 1, unit: '', weight: 100, source: { type: 'manual' } }] };

function snap(ver, def) { return { template: { name: 'KTT test' }, version: { version_no: ver, definition: clone(def) } }; }

function freshStore() {
  return {
    checklist_templates: [{ template_key: TPL, id: 'tpl-1', updated_at: '2026-01-01T00:00:00Z', current_version: 'V2' }, { template_key: OTHER_TPL, id: 'tpl-2', updated_at: '2026-01-01T00:00:00Z', current_version: 'O1' }],
    checklist_template_versions: [
      { template_key: TPL, version_no: 'V1', effective_date: '2026-01-01', created_at: '2026-01-01T00:00:00Z', definition: V1_DEF },
      { template_key: TPL, version_no: 'V2', effective_date: '2026-02-01', created_at: '2026-02-01T00:00:00Z', definition: V2_DEF },
      { template_key: OTHER_TPL, version_no: 'O1', effective_date: '2026-01-01', created_at: '2026-01-01T00:00:00Z', definition: OTHER_DEF }
    ],
    checklist_employee_assignments: [
      { employee_key: 'e50', employee_id: 'id-e50', employee_code: 'E50', employee_name: 'NV Năm Mươi', department: 'KTT', title: 'Kế toán trưởng', branch: '', manager_id: 'id-mgr', manager_code: 'MGR1', manager_name: 'Quản lý', employee_status: 'Đang làm việc', template_id: TPL, template_version: 'V1', effective_date: '2026-01-01', updated_at: '2026-01-01T00:00:00Z' },
      { employee_key: 'e51', employee_id: 'id-e51', employee_code: 'E51', employee_name: 'NV Năm Mốt', department: 'KTT', title: 'NV', branch: '', manager_id: 'id-mgr', manager_code: 'MGR1', manager_name: 'Quản lý', employee_status: 'Đang làm việc', template_id: TPL, template_version: 'V1', effective_date: '2026-01-01', updated_at: '2026-01-01T00:00:00Z' },
      { employee_key: 'e52', employee_id: 'id-e52', employee_code: 'E52', employee_name: 'NV Năm Hai', department: 'KTT', title: 'NV', branch: '', manager_id: 'id-mgr', manager_code: 'MGR1', manager_name: 'Quản lý', employee_status: 'Đang làm việc', template_id: TPL, template_version: 'V1', effective_date: '2026-01-01', updated_at: '2026-01-01T00:00:00Z' },
      { employee_key: 'e60', employee_id: 'id-e60', employee_code: 'E60', employee_name: 'NV Khác Mẫu', department: 'X', title: 'NV', branch: '', manager_id: 'id-mgr', manager_code: 'MGR1', manager_name: 'Quản lý', employee_status: 'Đang làm việc', template_id: OTHER_TPL, template_version: 'O1', effective_date: '2026-01-01', updated_at: '2026-01-01T00:00:00Z' }
    ],
    checklist_employee_assignment_history: [],
    checklist_monthly_periods: [
      { id: 'per-2026-03', period_month: '2026-03', status: 'open' },
      { id: 'per-2026-04', period_month: '2026-04', status: 'locked' }
    ],
    checklist_monthly_forms: [
      // GREEN — no self data at all.
      { id: 'f-green', period_id: 'per-2026-03', period_month: '2026-03', employee_id: 'id-e50', employee_code: 'E50', employee_name: 'NV Năm Mươi', status: 'draft', template_id: TPL, template_version: 'V1', template_snapshot: snap('V1', V1_DEF), self_answers: {}, self_saved_at: null, self_submitted_at: null, review_answers: {}, review_saved_at: null, review_submitted_at: null, reviewed_by: null, final_score: null, updated_at: '2026-03-01T00:00:00Z' },
      // YELLOW — self-evaluated, not reviewed.
      { id: 'f-yellow', period_id: 'per-2026-03', period_month: '2026-03', employee_id: 'id-e51', employee_code: 'E51', employee_name: 'NV Năm Mốt', status: 'waiting_review', template_id: TPL, template_version: 'V1', template_snapshot: snap('V1', V1_DEF), self_answers: { C1: { value: '8' } }, self_note: 'Đã hoàn thành doanh số', self_saved_at: '2026-03-05T00:00:00Z', self_submitted_at: '2026-03-05T00:00:00Z', self_total_score: 80, review_answers: {}, review_note: '', checklist_review_score: null, checklist_review_reason: '', review_total_score: null, review_saved_at: null, review_submitted_at: null, reviewed_by: null, reviewed_by_code: null, reviewed_by_name: null, reviewed_as_override: false, review_override_reason: '', final_score: null, score_calculated_at: null, admin_exception_open: false, updated_at: '2026-03-05T00:00:00Z' },
      // ORANGE — already reviewed.
      { id: 'f-orange', period_id: 'per-2026-03', period_month: '2026-03', employee_id: 'id-e52', employee_code: 'E52', employee_name: 'NV Năm Hai', status: 'reviewed', template_id: TPL, template_version: 'V1', template_snapshot: snap('V1', V1_DEF), self_answers: { C1: { value: '9' } }, self_note: 'Vượt chỉ tiêu', self_saved_at: '2026-03-06T00:00:00Z', self_submitted_at: '2026-03-06T00:00:00Z', self_total_score: 90, review_answers: { C1: { value: '9' } }, review_note: 'Xác nhận đúng số liệu', checklist_review_score: 90, checklist_review_reason: 'Đạt', review_total_score: 90, review_saved_at: '2026-03-07T00:00:00Z', review_submitted_at: '2026-03-07T00:00:00Z', reviewed_by: 'id-mgr', reviewed_by_code: 'MGR1', reviewed_by_name: 'Quản lý', reviewed_as_override: false, review_override_reason: '', final_score: 90, score_calculated_at: '2026-03-07T00:00:00Z', admin_exception_open: false, updated_at: '2026-03-07T00:00:00Z' },
      // Control — SAME template, DIFFERENT (locked) period. Must never be touched.
      { id: 'f-locked-period', period_id: 'per-2026-04', period_month: '2026-04', employee_id: 'id-e50', employee_code: 'E50', employee_name: 'NV Năm Mươi', status: 'draft', template_id: TPL, template_version: 'V1', template_snapshot: snap('V1', V1_DEF), self_answers: {}, self_saved_at: null, self_submitted_at: null, review_answers: {}, review_saved_at: null, review_submitted_at: null, reviewed_by: null, final_score: null, updated_at: '2026-04-01T00:00:00Z' },
      // Control — DIFFERENT template, SAME period. Must never be touched.
      { id: 'f-other-template', period_id: 'per-2026-03', period_month: '2026-03', employee_id: 'id-e60', employee_code: 'E60', employee_name: 'NV Khác Mẫu', status: 'draft', template_id: OTHER_TPL, template_version: 'O1', template_snapshot: snap('O1', OTHER_DEF), self_answers: {}, self_saved_at: null, self_submitted_at: null, review_answers: {}, review_saved_at: null, review_submitted_at: null, reviewed_by: null, final_score: null, updated_at: '2026-03-01T00:00:00Z' }
    ],
    checklist_monthly_form_history: [],
    checklist_monthly_score_policies: [],
    checklist_monthly_kpi_configs: []
  };
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
let store;
const orig = Module._load;
Module._load = function (req) {
  if (req === '@supabase/supabase-js') return { createClient: () => ({ from: t => new FakeQuery(t), rpc: async () => ({ data: null, error: { message: 'no rpc' } }) }) };
  return orig.apply(this, arguments);
};
const lib = require(path.join(__dirname, '..', 'api', '_lib', 'checklist-monthly.js'));
Module._load = orig;

const ADMIN = { role: 'admin', account: { id: 'admin-1', name: 'Admin Test' }, sub: 'admin-1' };
const USER = { role: 'user', account: { id: 'u-1', name: 'User' } };
let fails = 0, passes = 0;
async function rec(name, fn) { try { await fn(); console.log('PASS -', name); passes++; } catch (e) { fails++; console.log('FAIL -', name, '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n  ') : e)); } }
function formById(id) { return store.checklist_monthly_forms.find(f => f.id === id); }
function historyFor(id) { return store.checklist_monthly_form_history.filter(h => h.form_id === id); }

async function main() {
  // ---------------------------------------------------------------------
  // ITEM 1 — classify: correct GREEN/YELLOW/ORANGE counts for the current period, scoped to
  // this template only (E60/other-tpl and the locked-period E50 form must NOT be counted).
  // ---------------------------------------------------------------------
  await rec('ITEM 1 — classify returns 1 green / 1 yellow / 1 orange, scoped to template+period, period not locked', async () => {
    store = freshStore();
    const cls = await lib.classifyChecklistMonthlyRetroactiveScope(ADMIN, { templateId: TPL, periodMonth: '2026-03' });
    assert.strictEqual(cls.periodLocked, false);
    assert.strictEqual(cls.totalAffected, 3);
    assert.strictEqual(cls.green.count, 1); assert.deepStrictEqual(cls.green.codes, ['E50']);
    assert.strictEqual(cls.yellow.count, 1); assert.deepStrictEqual(cls.yellow.codes, ['E51']);
    assert.strictEqual(cls.orange.count, 1); assert.deepStrictEqual(cls.orange.codes, ['E52']);
  });

  // ---------------------------------------------------------------------
  // ITEM 5 — locked period: classify returns periodLocked:true with zero counts (silent skip
  // signal for the FE); apply against that period is a genuine refusal, not a silent no-op.
  // ---------------------------------------------------------------------
  await rec('ITEM 5a — classify on a LOCKED period returns periodLocked:true, zero counts', async () => {
    store = freshStore();
    const cls = await lib.classifyChecklistMonthlyRetroactiveScope(ADMIN, { templateId: TPL, periodMonth: '2026-04' });
    assert.strictEqual(cls.periodLocked, true);
    assert.strictEqual(cls.totalAffected, 0);
  });
  await rec('ITEM 5b — apply on a LOCKED period is REFUSED (throws), form untouched', async () => {
    store = freshStore();
    const before = clone(formById('f-locked-period'));
    let threw = null;
    try { await lib.applyChecklistMonthlyRetroactiveScope(ADMIN, { templateId: TPL, periodMonth: '2026-04', mode: 'safe', reason: 'thử áp dụng lên kỳ đã khóa' }); } catch (e) { threw = e; }
    assert.ok(threw && threw.code === 'CHECKLIST_MONTHLY_RETRO_SCOPE_PERIOD_LOCKED', threw && threw.code);
    assert.deepStrictEqual(formById('f-locked-period'), before, 'locked-period form completely untouched');
  });

  // ---------------------------------------------------------------------
  // ITEM 2/3 — YELLOW: no mutation happens merely from classifying; explicit 'reset' apply
  // only touches the YELLOW+ORANGE forms of the SAME template+period, nothing else.
  // ---------------------------------------------------------------------
  await rec('ITEM 2 — classify alone never mutates any form', async () => {
    store = freshStore();
    const before = clone(store.checklist_monthly_forms);
    await lib.classifyChecklistMonthlyRetroactiveScope(ADMIN, { templateId: TPL, periodMonth: '2026-03' });
    assert.deepStrictEqual(store.checklist_monthly_forms, before);
  });

  await rec('ITEM 3/4 — apply mode "reset" updates ONLY yellow+orange forms of this template+period; green/other-template/other-period forms untouched', async () => {
    store = freshStore();
    const beforeGreen = clone(formById('f-green')), beforeOtherTpl = clone(formById('f-other-template')), beforeLockedPeriod = clone(formById('f-locked-period'));
    const out = await lib.applyChecklistMonthlyRetroactiveScope(ADMIN, { templateId: TPL, periodMonth: '2026-03', mode: 'reset', reason: 'Cập nhật tiêu chí quý 3, yêu cầu đánh giá lại' });
    assert.strictEqual(out.appliedCount, 2);
    const yellow = formById('f-yellow');
    assert.strictEqual(yellow.template_version, 'V2', 'yellow form gets the new snapshot');
    assert.strictEqual(yellow.status, 'waiting_self', 'yellow form reset back to waiting_self');
    assert.deepStrictEqual(yellow.self_answers, {}, 'self answers cleared');
    assert.strictEqual(yellow.self_saved_at, null); assert.strictEqual(yellow.self_submitted_at, null);
    const orange = formById('f-orange');
    assert.strictEqual(orange.template_version, 'V2');
    assert.strictEqual(orange.status, 'waiting_self', 'reviewed form also reset back to waiting_self');
    assert.deepStrictEqual(orange.review_answers, {}); assert.strictEqual(orange.reviewed_by, null); assert.strictEqual(orange.final_score, null);
    assert.strictEqual(orange.review_submitted_at, null); assert.strictEqual(orange.self_submitted_at, null);
    // Controls — untouched.
    assert.deepStrictEqual(formById('f-green'), beforeGreen, 'green form untouched by a RESET apply (not in scope of reset)');
    assert.deepStrictEqual(formById('f-other-template'), beforeOtherTpl, 'a form of a DIFFERENT template is never touched');
    assert.deepStrictEqual(formById('f-locked-period'), beforeLockedPeriod, 'a form in a DIFFERENT (locked) period is never touched');
    // Reviewer assignment itself is not part of "redo" — preserved.
    assert.strictEqual(orange.reviewed_by_code, null, 'reviewed_by_code cleared by reset');
  });

  // ---------------------------------------------------------------------
  // ITEM 7 — audit/history entries: reset apply writes one history row per affected form with
  // before/after state, actor, reason, timestamp.
  // ---------------------------------------------------------------------
  await rec('ITEM 7 — history entries recorded per affected form with before/after + actor + reason', async () => {
    store = freshStore();
    await lib.applyChecklistMonthlyRetroactiveScope(ADMIN, { templateId: TPL, periodMonth: '2026-03', mode: 'reset', reason: 'Cập nhật tiêu chí quý 3, yêu cầu đánh giá lại' });
    const hy = historyFor('f-yellow'), ho = historyFor('f-orange');
    assert.strictEqual(hy.length, 1); assert.strictEqual(ho.length, 1);
    assert.strictEqual(hy[0].action, 'retroactive_apply_current_period_reset');
    assert.strictEqual(hy[0].before_data.templateVersion, 'V1'); assert.strictEqual(hy[0].after_data.templateVersion, 'V2');
    assert.strictEqual(hy[0].after_data.status, 'waiting_self');
    assert.strictEqual(hy[0].reason, 'Cập nhật tiêu chí quý 3, yêu cầu đánh giá lại');
    assert.strictEqual(hy[0].changed_by, 'admin-1'); assert.ok(hy[0].changed_at);
    assert.strictEqual(hy[0].employee_code, 'E51');
    assert.strictEqual(ho[0].employee_code, 'E52');
  });

  // ---------------------------------------------------------------------
  // ITEM 9 — audit-history completeness: a RESET (yellow/orange) apply must capture the FULL
  // pre-reset self/review data in before_data, since the live form's own columns are about to
  // be wiped and this history row is the only place that data survives afterwards.
  // ---------------------------------------------------------------------
  await rec('ITEM 9a — YELLOW reset: before_data preserves the exact OLD self_* fields that were on the form', async () => {
    store = freshStore();
    const preYellow = clone(formById('f-yellow'));
    await lib.applyChecklistMonthlyRetroactiveScope(ADMIN, { templateId: TPL, periodMonth: '2026-03', mode: 'reset', reason: 'Cập nhật tiêu chí quý 3, yêu cầu đánh giá lại' });
    const hy = historyFor('f-yellow');
    assert.strictEqual(hy.length, 1);
    const bd = hy[0].before_data;
    assert.deepStrictEqual(bd.selfAnswers, preYellow.self_answers, 'before_data.selfAnswers matches the exact pre-reset self_answers');
    assert.strictEqual(bd.selfNote, preYellow.self_note);
    assert.strictEqual(bd.selfSavedAt, preYellow.self_saved_at);
    assert.strictEqual(bd.selfSubmittedAt, preYellow.self_submitted_at);
    assert.strictEqual(bd.selfTotalScore, preYellow.self_total_score);
    assert.strictEqual(bd.status, preYellow.status);
    assert.strictEqual(bd.templateVersion, preYellow.template_version);
    assert.deepStrictEqual(bd.templateSnapshot, preYellow.template_snapshot, 'before_data preserves the prior template snapshot');
    // Live form itself is genuinely reset (already covered by ITEM 3/4, re-confirmed here).
    const liveYellow = formById('f-yellow');
    assert.strictEqual(liveYellow.status, 'waiting_self');
    assert.deepStrictEqual(liveYellow.self_answers, {});
    assert.strictEqual(liveYellow.self_saved_at, null);
  });

  await rec('ITEM 9b — ORANGE reset: before_data preserves the exact OLD review_*/reviewer/score fields', async () => {
    store = freshStore();
    const preOrange = clone(formById('f-orange'));
    await lib.applyChecklistMonthlyRetroactiveScope(ADMIN, { templateId: TPL, periodMonth: '2026-03', mode: 'reset', reason: 'Cập nhật tiêu chí quý 3, yêu cầu đánh giá lại' });
    const ho = historyFor('f-orange');
    assert.strictEqual(ho.length, 1);
    const bd = ho[0].before_data;
    assert.deepStrictEqual(bd.reviewAnswers, preOrange.review_answers, 'before_data.reviewAnswers matches the exact pre-reset review_answers');
    assert.strictEqual(bd.reviewNote, preOrange.review_note);
    assert.strictEqual(bd.checklistReviewScore, preOrange.checklist_review_score);
    assert.strictEqual(bd.checklistReviewReason, preOrange.checklist_review_reason);
    assert.strictEqual(bd.reviewTotalScore, preOrange.review_total_score);
    assert.strictEqual(bd.reviewSavedAt, preOrange.review_saved_at);
    assert.strictEqual(bd.reviewSubmittedAt, preOrange.review_submitted_at);
    assert.strictEqual(bd.reviewedBy, preOrange.reviewed_by);
    assert.strictEqual(bd.reviewedByCode, preOrange.reviewed_by_code);
    assert.strictEqual(bd.reviewedByName, preOrange.reviewed_by_name);
    assert.strictEqual(bd.reviewedAsOverride, preOrange.reviewed_as_override);
    assert.strictEqual(bd.reviewOverrideReason, preOrange.review_override_reason);
    assert.strictEqual(bd.finalScore, preOrange.final_score);
    assert.strictEqual(bd.scoreCalculatedAt, preOrange.score_calculated_at);
    assert.strictEqual(bd.adminExceptionOpen, preOrange.admin_exception_open);
    // Also still carries the old self_* data (orange forms have self data too, by definition).
    assert.deepStrictEqual(bd.selfAnswers, preOrange.self_answers);
    // Live form itself is genuinely reset.
    const liveOrange = formById('f-orange');
    assert.strictEqual(liveOrange.status, 'waiting_self');
    assert.strictEqual(liveOrange.reviewed_by, null);
    assert.strictEqual(liveOrange.final_score, null);
  });

  await rec('ITEM 9c — GREEN safe-apply history stays compact: before_data has NO self/review-answer blobs', async () => {
    store = freshStore();
    await lib.applyChecklistMonthlyRetroactiveScope(ADMIN, { templateId: TPL, periodMonth: '2026-03', mode: 'safe', reason: 'Cập nhật mẫu chụp cho phiếu chưa có dữ liệu' });
    const hg = historyFor('f-green');
    assert.strictEqual(hg.length, 1);
    const bd = hg[0].before_data;
    const keys = Object.keys(bd).sort();
    assert.deepStrictEqual(keys, ['status', 'templateId', 'templateVersion'], 'GREEN/safe before_data stays exactly the pre-existing compact shape');
    assert.ok(!('selfAnswers' in bd) && !('reviewAnswers' in bd) && !('templateSnapshot' in bd), 'no answer blobs or snapshot leak into the compact safe-mode history entry');
  });

  // ---------------------------------------------------------------------
  // ITEM 1b — SAFE apply: only GREEN forms touched, no reset needed (no data to lose), still
  // writes history.
  // ---------------------------------------------------------------------
  await rec('ITEM 1b — apply mode "safe" updates ONLY the green form, keeps status, still writes history', async () => {
    store = freshStore();
    const out = await lib.applyChecklistMonthlyRetroactiveScope(ADMIN, { templateId: TPL, periodMonth: '2026-03', mode: 'safe', reason: 'Cập nhật mẫu chụp cho phiếu chưa có dữ liệu' });
    assert.strictEqual(out.appliedCount, 1);
    const green = formById('f-green');
    assert.strictEqual(green.template_version, 'V2');
    assert.strictEqual(green.status, 'draft', 'safe apply never changes status');
    // Yellow/orange untouched by a SAFE apply.
    assert.strictEqual(formById('f-yellow').template_version, 'V1');
    assert.strictEqual(formById('f-orange').template_version, 'V1');
    const hg = historyFor('f-green');
    assert.strictEqual(hg.length, 1); assert.strictEqual(hg[0].action, 'retroactive_apply_current_period_safe');
  });

  // ---------------------------------------------------------------------
  // ITEM 6 — "chỉ áp dụng kỳ tiếp theo" / cancel = simply never calling apply. Forms remain
  // byte-for-byte identical (the classify-only test above already proves this; this test makes
  // the "no apply call at all" contract explicit end-to-end).
  // ---------------------------------------------------------------------
  await rec('ITEM 6 — no apply call at all -> every form in the period stays byte-for-byte identical', async () => {
    store = freshStore();
    const before = clone(store.checklist_monthly_forms);
    await lib.classifyChecklistMonthlyRetroactiveScope(ADMIN, { templateId: TPL, periodMonth: '2026-03' });
    // Admin looks at the decision, picks "chỉ áp dụng cho kỳ đồng bộ tiếp theo" -> FE never
    // calls applyChecklistMonthlyRetroactiveScope. Nothing here does either.
    assert.deepStrictEqual(store.checklist_monthly_forms, before);
  });

  // ---------------------------------------------------------------------
  // Guardrails — reason too short, invalid mode, non-admin, missing templateId.
  // ---------------------------------------------------------------------
  await rec('reason < 10 chars -> rejected before any write', async () => {
    store = freshStore();
    let threw = null;
    try { await lib.applyChecklistMonthlyRetroactiveScope(ADMIN, { templateId: TPL, periodMonth: '2026-03', mode: 'safe', reason: 'ngắn' }); } catch (e) { threw = e; }
    assert.ok(threw && threw.code === 'CHECKLIST_MONTHLY_RETRO_SCOPE_REASON_REQUIRED');
    assert.strictEqual(formById('f-green').template_version, 'V1');
  });
  await rec('invalid mode -> rejected', async () => {
    store = freshStore();
    let threw = null;
    try { await lib.applyChecklistMonthlyRetroactiveScope(ADMIN, { templateId: TPL, periodMonth: '2026-03', mode: 'bogus', reason: 'lý do hợp lệ đủ dài' }); } catch (e) { threw = e; }
    assert.ok(threw && threw.code === 'CHECKLIST_MONTHLY_RETRO_SCOPE_MODE_INVALID');
  });
  await rec('non-admin -> rejected on classify and apply', async () => {
    store = freshStore();
    let threw1 = null, threw2 = null;
    try { await lib.classifyChecklistMonthlyRetroactiveScope(USER, { templateId: TPL, periodMonth: '2026-03' }); } catch (e) { threw1 = e; }
    try { await lib.applyChecklistMonthlyRetroactiveScope(USER, { templateId: TPL, periodMonth: '2026-03', mode: 'safe', reason: 'lý do hợp lệ đủ dài' }); } catch (e) { threw2 = e; }
    assert.ok(threw1, 'classify must throw for non-admin'); assert.ok(threw2, 'apply must throw for non-admin');
    assert.strictEqual(formById('f-green').template_version, 'V1');
  });

  // ---------------------------------------------------------------------
  // ITEM 8 (structural half) — normal monthly sync/creation paths (createMonthly/
  // syncMonthlyCycle) never call the new apply codepath — they only ever create NEW forms,
  // they never reach back into existing ones via this mechanism.
  // ---------------------------------------------------------------------
  await rec('ITEM 8 — createMonthly()/syncMonthlyCycle() source never calls applyChecklistMonthlyRetroactiveScope', () => {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'api', '_lib', 'checklist-monthly.js'), 'utf8');
    const createFn = src.slice(src.indexOf('async function createMonthly'), src.indexOf('async function openMonthly('));
    assert.ok(!/applyChecklistMonthlyRetroactiveScope/.test(createFn), 'createMonthly() body never references the new apply function');
    const syncStart = src.indexOf('async function syncMonthlyCycle');
    if (syncStart >= 0) {
      const syncFn = src.slice(syncStart, syncStart + 4000);
      assert.ok(!/applyChecklistMonthlyRetroactiveScope\(/.test(syncFn.split('\n').slice(0, 60).join('\n')), 'syncMonthlyCycle() does not call the new apply function either');
    }
  });

  console.log('\n=== Kết quả ===');
  console.log(passes + '/' + (passes + fails) + ' bước PASS.');
  if (fails) process.exitCode = 1;
}
main().catch(e => { console.error('LỖI KHÔNG MONG ĐỢI:', e); process.exitCode = 1; });
