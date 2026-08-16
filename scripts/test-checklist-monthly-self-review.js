'use strict';
/*
 * Regression Test
 * Checklist Monthly — Self Review & Review workflow
 * In-memory only
 * No Production Database
 * Safe for future verification
 *
 * Kiểm tra saveMyMonthly / saveMonthlyReview (lib/checklist-monthly.js) — luồng tự đánh
 * giá và thẩm định phiếu tháng: chuyển trạng thái, chặn vượt trọng số, chặn nhân viên tự
 * sửa điểm tiêu chí tự động, optimistic-lock expected_updated_at, chặn sửa phiếu đã
 * reviewed/locked, chặn thẩm định ngoài phạm vi được cấp.
 *
 * Toàn bộ chạy trên dữ liệu mock trong bộ nhớ (chặn @supabase/supabase-js và
 * lib/checklist-permissions bằng Module._load theo đường dẫn thật), KHÔNG kết nối
 * Supabase thật, KHÔNG đổi logic nghiệp vụ nào trong lib/checklist-monthly.js.
 *
 * Dùng period_month = tháng hiện tại (tính động) + ghi đè cửa sổ chu kỳ rộng hết
 * tháng, để test không phụ thuộc vào ngày chạy thật trong tháng.
 *
 * File này KHÔNG được gọi tự động ở bất kỳ đâu — chỉ chạy thủ công:
 *   node scripts/test-checklist-monthly-self-review.js
 */

const assert = require('assert');
const path = require('path');
const Module = require('module');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
// QUAN TRỌNG: lib/checklist-monthly.js:92 (periodDateTime) tính cửa sổ tự đánh giá/thẩm
// định vào THÁNG KẾ TIẾP của period_month (nextMonth) — đây là quy tắc nghiệp vụ hiện có,
// không phải bug. Test phải chọn period_month = tháng liền trước tháng hiện tại để cửa sổ
// (rơi vào tháng hiện tại) luôn bao trùm thời điểm chạy test, không phụ thuộc ngày chạy.
function ymOffset(ym, offset) { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 7); }
const ACTION_MONTH = new Date().toISOString().slice(0, 7);
const PERIOD = ymOffset(ACTION_MONTH, -1);
const NOW_ISO = new Date().toISOString();

function baseDefinition() {
  return {
    totalRows: [
      ['1', 'AUTO-C1', 'Tuân thủ Checklist', '100', '%', 50, '', 'Checklist'],
      ['2', 'MAN-C1', 'Thái độ làm việc', '10', 'điểm', 50, '', 'Nhập đánh giá']
    ]
  };
}
function baseSnapshot() { return { template: { department: 'Test' }, version: { version_no: 'T-1.0', definition: baseDefinition() } }; }

// ---------- 1. Dữ liệu mock ----------
const store = {
  checklist_monthly_forms: [
    // f-self: waiting_self, dùng cho case 1/2/3/5.
    { id: 'f-self', period_id: 'p1', period_month: PERIOD, status: 'waiting_self', employee_code: 'NV001', employee_id: 'id-nv001', employee_name: 'Nhân Viên 1', reviewer_id: 'ADM1-ID', reviewer_code: 'ADM1', reviewer_name: 'Admin Test', template_snapshot: baseSnapshot(), checklist_score: 100, self_answers: {}, review_answers: {}, updated_at: NOW_ISO, pilot_opened_at: null },
    // f-review: waiting_review, reviewer là admin (assigned) -> case 4.
    { id: 'f-review', period_id: 'p1', period_month: PERIOD, status: 'waiting_review', employee_code: 'NV002', employee_id: 'id-nv002', employee_name: 'Nhân Viên 2', reviewer_id: 'ADM1-ID', reviewer_code: 'ADM1', reviewer_name: 'Admin Test', template_snapshot: baseSnapshot(), checklist_score: 100, self_answers: { 'MAN-C1': { value: '8' } }, self_submitted_at: NOW_ISO, review_answers: {}, updated_at: NOW_ISO },
    // f-reviewed: đã thẩm định xong -> case 6a (chặn tự đánh giá lại).
    { id: 'f-reviewed', period_id: 'p1', period_month: PERIOD, status: 'reviewed', employee_code: 'NV003', employee_id: 'id-nv003', employee_name: 'Nhân Viên 3', reviewer_id: 'ADM1-ID', reviewer_code: 'ADM1', reviewer_name: 'Admin Test', template_snapshot: baseSnapshot(), checklist_score: 100, self_answers: { 'MAN-C1': { value: '1' } }, review_answers: { 'MAN-C1': { value: '1' } }, self_total_score:80, review_total_score:90, final_score:86.67, score_formula_version:'persisted-test', updated_at: NOW_ISO },
    // f-locked: đã khóa -> case 6b (chặn thẩm định lại).
    { id: 'f-locked', period_id: 'p1', period_month: PERIOD, status: 'locked', employee_code: 'NV004', employee_id: 'id-nv004', employee_name: 'Nhân Viên 4', reviewer_id: 'ADM1-ID', reviewer_code: 'ADM1', reviewer_name: 'Admin Test', template_snapshot: baseSnapshot(), checklist_score: 100, self_answers: {}, review_answers: {}, self_total_score:70, review_total_score:80, final_score:76.67, score_formula_version:'persisted-test', updated_at: NOW_ISO },
    // f-outscope: waiting_review, reviewer KHÔNG phải người gọi -> case 7.
    { id: 'f-outscope', period_id: 'p1', period_month: PERIOD, status: 'waiting_review', employee_code: 'NV005', employee_id: 'id-nv005', employee_name: 'Nhân Viên 5', reviewer_id: 'OTHER-ID', reviewer_code: 'OTHER', reviewer_name: 'Người Khác', template_snapshot: baseSnapshot(), checklist_score: 100, self_answers: { 'MAN-C1': { value: '8' } }, self_submitted_at: NOW_ISO, review_answers: {}, updated_at: NOW_ISO }
  ],
  checklist_monthly_periods: [
    { id: 'p1', period_month: PERIOD, status: 'open' },
    { id: 'p-expired', period_month: PERIOD, status: 'open', self_due_at: '2020-01-01T00:00:00.000Z' }
  ],
  checklist_monthly_form_history: [],
  checklist_violation_records: [],
  checklist_system_settings: [],
  // Ghi đè cửa sổ chu kỳ rộng hết tháng để test không phụ thuộc ngày chạy thật.
  checklist_monthly_period_overrides: [
    { period_month: PERIOD, self_start_day: 1, self_end_day: 31, review_start_day: 1, review_end_day: 31, lock_day: 31, lock_time: '23:59', reason: 'test-wide-window' }
  ]
};

const formsBefore = clone(store.checklist_monthly_forms);

// ---------- 2. Fake Supabase query builder ----------
class FakeQuery {
  constructor(table) { this.table = table; this.filters = []; this._limit = null; this._single = null; this._operation = 'read'; this._payload = null; }
  select() { return this; }
  update(payload) { this._operation = 'update'; this._payload = clone(payload); return this; }
  insert(payload) { this._operation = 'insert'; this._payload = clone(payload); return this; }
  eq(col, val) { this.filters.push(row => String(row[col]) === String(val)); return this; }
  neq(col, val) { this.filters.push(row => String(row[col]) !== String(val)); return this; }
  is(col, val) { this.filters.push(row => val === null ? (row[col] == null) : row[col] === val); return this; }
  in(col, vals) { this.filters.push(row => vals.includes(row[col])); return this; }
  gte(col, val) { this.filters.push(row => String(row[col]) >= String(val)); return this; }
  lte(col, val) { this.filters.push(row => String(row[col]) <= String(val)); return this; }
  order() { return this; }
  limit(n) { this._limit = n; return this; }
  range() { return this; }
  maybeSingle() { this._single = 'maybe'; return this; }
  single() { this._single = 'strict'; return this; }
  _rows() {
    let rows = clone(store[this.table] || []);
    this.filters.forEach(f => { rows = rows.filter(f); });
    if (this._limit != null) rows = rows.slice(0, this._limit);
    return rows;
  }
  then(resolve, reject) {
    if (this._operation === 'insert') {
      const inserted = (Array.isArray(this._payload) ? this._payload : [this._payload]).map(row => clone(row));
      store[this.table] = store[this.table] || [];
      store[this.table].push(...inserted);
      return Promise.resolve({ data: inserted, error: null }).then(resolve, reject);
    }
    if (this._operation === 'update') {
      const source = store[this.table] || [], updated = [];
      source.forEach(row => { if (this.filters.every(f => f(row))) { Object.assign(row, clone(this._payload)); updated.push(clone(row)); } });
      const data = this._single ? (updated[0] || null) : updated;
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    }
    const rows = this._rows();
    if (this._single === 'maybe') return Promise.resolve({ data: rows[0] || null, error: null }).then(resolve, reject);
    if (this._single === 'strict') return Promise.resolve(rows.length ? { data: rows[0], error: null } : { data: null, error: { message: 'No rows found' } }).then(resolve, reject);
    return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  }
}

// ---------- 3. Fake RPC ----------
const rpcCalls = [];
async function fakeRpc(name, p) {
  rpcCalls.push({ name, params: clone(p) });
  if (name === 'phf_save_checklist_monthly_self' || name === 'phf_save_checklist_monthly_review') {
    const form = store.checklist_monthly_forms.find(f => f.id === p.p_form_id);
    if (!form) return { data: { ok: false, code: 'CHECKLIST_MONTHLY_FORM_NOT_FOUND' }, error: null };
    Object.assign(form, p.p_patch);
    return { data: { ok: true, form: clone(form) }, error: null };
  }
  return { data: null, error: { message: 'RPC không được mock: ' + name } };
}

// ---------- 4. Fake lib/checklist-permissions (chỉ phần saveMonthlyReview thật sự dùng) ----------
let reviewAccessOverride = null; // cho phép từng test-case điều chỉnh phạm vi được cấp
const fakePermissions = {
  async getChecklistMonthlyReviewAccess(session) {
    if (reviewAccessOverride) return reviewAccessOverride;
    return { grant: null, canReview: false, people: [] };
  },
  async getChecklistExportAccess() { return { role: 'admin', people: [] }; }
};

// ---------- 5. Chặn require() theo đường dẫn thật ----------
const ROOT = path.join(__dirname, '..');
const SUPABASE_JS = '@supabase/supabase-js';
const PERMISSIONS_PATH = path.join(ROOT, 'lib', 'checklist-permissions.js');
const originalLoad = Module._load;
const originalResolve = Module._resolveFilename;
Module._load = function (request, parent, isMain) {
  if (request === SUPABASE_JS) {
    return { createClient: () => ({ from: (table) => new FakeQuery(table), rpc: (name, params) => fakeRpc(name, params) }) };
  }
  if (request !== '.' && request !== '..' && /[\/\\]/.test(request)) {
    try { if (originalResolve.call(Module, request, parent, isMain) === PERMISSIONS_PATH) return fakePermissions; } catch (e) {}
  }
  return originalLoad.apply(this, arguments);
};
const monthlyLib = require(path.join(__dirname, '..', 'lib', 'checklist-monthly.js'));
Module._load = originalLoad;

const ADMIN_SESSION = { role: 'admin', employeeCode: 'ADM1', account: { id: 'ADM1-ID', name: 'Admin Test', employeeCode: 'ADM1' }, sub: 'ADM1-ID' };
const LEARNER_SESSION = { role: 'learner', employeeCode: 'NV001', employeeId: 'id-nv001', account: { id: 'id-nv001', name: 'Nhân Viên 1' }, sub: 'id-nv001' };
const OUTSIDE_MANAGER_SESSION = { role: 'manager', employeeCode: 'MGR-X', employeeId: 'id-mgrx', account: { id: 'id-mgrx', name: 'Quản Lý Khác' }, sub: 'id-mgrx' };

// ---------- 6. Bộ chạy test ----------
const results = [];
async function record(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log('✓ PASS -', name); }
  catch (err) { results.push({ name, pass: false }); console.log('✗ FAIL -', name, '\n   ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n   ') : err)); }
}
function formById(id) { return store.checklist_monthly_forms.find(f => f.id === id); }
async function expectFail(promise, codeSubstring) {
  try { await promise; throw new Error('Lẽ ra phải fail nhưng lại thành công.'); }
  catch (err) {
    if (err.message === 'Lẽ ra phải fail nhưng lại thành công.') throw err;
    assert.ok(String(err.code || '').includes(codeSubstring) || String(err.message || '').includes(codeSubstring), 'Sai mã lỗi. Nhận được: ' + (err.code || err.message));
  }
}

async function main() {
  console.log('=== Regression test: Checklist Monthly Self/Review (mock, không đụng Supabase thật) ===\n');
  console.log('Kỳ dùng để test: ' + PERIOD + ' (tính động theo ngày chạy, cửa sổ chu kỳ đã ghi đè rộng hết tháng)\n');

  await record('1) Phiếu waiting_self: lưu + nộp tự đánh giá hợp lệ -> chuyển waiting_review', async () => {
    const draft = await monthlyLib.saveMyMonthly(LEARNER_SESSION, { formId: 'f-self', expectedUpdatedAt: formById('f-self').updated_at, answers: { 'MAN-C1': { value: '7' } }, submit: false });
    assert.strictEqual(draft.form.status, 'waiting_self');
    assert.strictEqual(draft.form.self_answers['MAN-C1'].value, '7');
    const res = await monthlyLib.saveMyMonthly(LEARNER_SESSION, { formId: 'f-self', expectedUpdatedAt: formById('f-self').updated_at, answers: { 'MAN-C1': { value: '8' } }, submit: true });
    assert.strictEqual(res.saved, true);
    assert.strictEqual(res.submitted, true);
    assert.strictEqual(formById('f-self').status, 'waiting_review');
    assert.strictEqual(store.checklist_monthly_form_history.slice(-1)[0].action, 'submit_self_review');
  });

  await record('1b) Phiếu waiting_review còn hạn: nhân viên sửa, lưu và gửi lại được', async () => {
    const session = { role: 'learner', employeeCode: 'NV002', employeeId: 'id-nv002', account: { id: 'id-nv002', name: 'Nhân Viên 2' }, sub: 'id-nv002' };
    const beforeSubmittedAt = formById('f-review').self_submitted_at;
    const saved = await monthlyLib.saveMyMonthly(session, { formId: 'f-review', expectedUpdatedAt: formById('f-review').updated_at, answers: { 'MAN-C1': { value: '7' } }, submit: false });
    assert.strictEqual(saved.form.status, 'waiting_review');
    assert.strictEqual(saved.form.self_answers['MAN-C1'].value, '7');
    assert.notStrictEqual(saved.form.self_submitted_at, beforeSubmittedAt);
    assert.strictEqual(store.checklist_monthly_form_history.slice(-1)[0].action, 'update_self_review');
    const resent = await monthlyLib.saveMyMonthly(session, { formId: 'f-review', expectedUpdatedAt: formById('f-review').updated_at, answers: { 'MAN-C1': { value: '8' } }, submit: true });
    assert.strictEqual(resent.form.status, 'waiting_review');
    assert.strictEqual(resent.form.self_answers['MAN-C1'].value, '8');
    assert.strictEqual(store.checklist_monthly_form_history.slice(-1)[0].action, 'resubmit_self_review');
  });

  await record('1c) waiting_self và waiting_review quá self_due_at: backend chặn mọi lưu/gửi', async () => {
    const expiredSelf = { id: 'f-expired-self', period_id: 'p-expired', period_month: PERIOD, status: 'waiting_self', employee_code: 'NV009', employee_id: 'id-nv009', employee_name: 'NV 9', template_snapshot: baseSnapshot(), checklist_score: 100, self_answers: {}, updated_at: NOW_ISO };
    const expiredReview = { id: 'f-expired-review', period_id: 'p-expired', period_month: PERIOD, status: 'waiting_review', employee_code: 'NV010', employee_id: 'id-nv010', employee_name: 'NV 10', template_snapshot: baseSnapshot(), checklist_score: 100, self_answers: { 'MAN-C1': { value: '8' } }, self_submitted_at: NOW_ISO, updated_at: NOW_ISO };
    store.checklist_monthly_forms.push(expiredSelf, expiredReview);
    await expectFail(monthlyLib.saveMyMonthly({ role: 'learner', employeeCode: 'NV009', employeeId: 'id-nv009' }, { formId: expiredSelf.id, expectedUpdatedAt: expiredSelf.updated_at, answers: { 'MAN-C1': { value: '8' } }, submit: false }), 'CHECKLIST_MONTHLY_SELF_WINDOW_CLOSED');
    await expectFail(monthlyLib.saveMyMonthly({ role: 'learner', employeeCode: 'NV010', employeeId: 'id-nv010' }, { formId: expiredReview.id, expectedUpdatedAt: expiredReview.updated_at, answers: { 'MAN-C1': { value: '9' } }, submit: true }), 'CHECKLIST_MONTHLY_SELF_WINDOW_CLOSED');
  });

  await record('2) Actual vượt Target -> bị backend chặn CHECKLIST_MONTHLY_SELF_OVER_TARGET', async () => {
    const form = { id: 'f-over', period_id: 'p1', period_month: PERIOD, status: 'waiting_self', employee_code: 'NV006', employee_id: 'id-nv006', employee_name: 'Nhân Viên 6', template_snapshot: baseSnapshot(), checklist_score: 100, self_answers: {}, updated_at: NOW_ISO };
    store.checklist_monthly_forms.push(form);
    const session = { role: 'learner', employeeCode: 'NV006', employeeId: 'id-nv006', sub: 'id-nv006' };
    await expectFail(monthlyLib.saveMyMonthly(session, { formId: 'f-over', expectedUpdatedAt: form.updated_at, answers: { 'MAN-C1': { value: '11' } }, submit: false }), 'CHECKLIST_MONTHLY_SELF_OVER_TARGET');
  });

  await record('3) Tiêu chí Checklist tự động (AUTO-C1) không được nhân viên gửi điểm tay', async () => {
    const form = { id: 'f-auto', period_id: 'p1', period_month: PERIOD, status: 'waiting_self', employee_code: 'NV007', employee_id: 'id-nv007', employee_name: 'Nhân Viên 7', template_snapshot: baseSnapshot(), checklist_score: 100, self_answers: {}, updated_at: NOW_ISO };
    store.checklist_monthly_forms.push(form);
    const session = { role: 'learner', employeeCode: 'NV007', employeeId: 'id-nv007', sub: 'id-nv007' };
    await monthlyLib.saveMyMonthly(session, { formId: 'f-auto', expectedUpdatedAt: form.updated_at, answers: { 'AUTO-C1': { value: '999' }, 'MAN-C1': { value: '10' } }, submit: false });
    const call = rpcCalls.filter(c => c.name === 'phf_save_checklist_monthly_self').pop();
    assert.ok(!Object.prototype.hasOwnProperty.call(call.params.p_patch.self_answers, 'AUTO-C1'), 'Không được cho phép nhân viên tự ghi điểm tiêu chí Checklist tự động.');
    assert.ok(Object.prototype.hasOwnProperty.call(call.params.p_patch.self_answers, 'MAN-C1'), 'Tiêu chí nhập tay hợp lệ vẫn phải được lưu.');
  });

  await record('3b) Checklist realtime refresh self_total_score cho waiting_self và waiting_review', async () => {
    const liveSelf = { id: 'f-live-self', period_id: 'p1', period_month: PERIOD, status: 'waiting_self', employee_code: 'NV011', employee_id: 'id-nv011', employee_name: 'NV 11', template_snapshot: baseSnapshot(), checklist_score: 100, self_answers: { 'MAN-C1': { value: '10' } }, review_answers: {}, updated_at: NOW_ISO };
    const liveReview = { id: 'f-live-review', period_id: 'p1', period_month: PERIOD, status: 'waiting_review', employee_code: 'NV012', employee_id: 'id-nv012', employee_name: 'NV 12', template_snapshot: baseSnapshot(), checklist_score: 100, self_answers: { 'MAN-C1': { value: '10' } }, review_answers: {}, self_submitted_at: NOW_ISO, updated_at: NOW_ISO };
    store.checklist_monthly_forms.push(liveSelf, liveReview);
    store.checklist_violation_records.push(
      { id: 'v-live-self', employee_code: 'NV011', is_test: false, record_status: 'official', points: 10, occurred_date: PERIOD + '-15' },
      { id: 'v-live-review', employee_code: 'NV012', is_test: false, record_status: 'official', points: 10, occurred_date: PERIOD + '-15' }
    );
    const selfRead = await monthlyLib.myMonthlyForm({ role: 'learner', employeeCode: 'NV011', employeeId: 'id-nv011' }, { month: PERIOD });
    const reviewRead = await monthlyLib.myMonthlyForm({ role: 'learner', employeeCode: 'NV012', employeeId: 'id-nv012' }, { month: PERIOD });
    assert.strictEqual(selfRead.form.checklist_score, 90);
    assert.strictEqual(selfRead.form.self_total_score, 95);
    assert.strictEqual(reviewRead.form.checklist_score, 90);
    assert.strictEqual(reviewRead.form.self_total_score, 95);
  });

  await record('4) Phiếu waiting_review: người thẩm định hợp lệ lưu được, chuyển đúng trạng thái', async () => {
    const before = formById('f-review').updated_at;
    const res = await monthlyLib.saveMonthlyReview(ADMIN_SESSION, { formId: 'f-review', expectedUpdatedAt: before, answers: { 'MAN-C1': { value: '9' } }, checklistScore: 100, submit: true });
    assert.strictEqual(res.saved, true);
    assert.strictEqual(formById('f-review').status, 'reviewed');
  });

  await record('5) expected_updated_at cũ -> bị chặn lost update (CHECKLIST_MONTHLY_SELF_STALE)', async () => {
    const form = { id: 'f-stale', period_id: 'p1', period_month: PERIOD, status: 'waiting_self', employee_code: 'NV008', employee_id: 'id-nv008', employee_name: 'Nhân Viên 8', template_snapshot: baseSnapshot(), checklist_score: 100, self_answers: {}, updated_at: NOW_ISO };
    store.checklist_monthly_forms.push(form);
    const session = { role: 'learner', employeeCode: 'NV008', employeeId: 'id-nv008', sub: 'id-nv008' };
    await expectFail(monthlyLib.saveMyMonthly(session, { formId: 'f-stale', expectedUpdatedAt: '2020-01-01T00:00:00.000Z', answers: { 'MAN-C1': { value: '10' } }, submit: false }), 'CHECKLIST_MONTHLY_SELF_STALE');
  });

  await record('6a) Phiếu đã reviewed -> không cho tự đánh giá lại (CHECKLIST_MONTHLY_NOT_WAITING_SELF)', async () => {
    const session = { role: 'learner', employeeCode: 'NV003', employeeId: 'id-nv003', sub: 'id-nv003' };
    await expectFail(monthlyLib.saveMyMonthly(session, { formId: 'f-reviewed', expectedUpdatedAt: formById('f-reviewed').updated_at, answers: { 'MAN-C1': { value: '10' } }, submit: false }), 'CHECKLIST_MONTHLY_NOT_WAITING_SELF');
  });

  await record('6b) Phiếu đã locked -> không cho thẩm định lại (CHECKLIST_MONTHLY_NOT_WAITING_REVIEW)', async () => {
    await expectFail(monthlyLib.saveMonthlyReview(ADMIN_SESSION, { formId: 'f-locked', expectedUpdatedAt: formById('f-locked').updated_at, answers: { 'MAN-C1': { value: '10' } }, checklistScore: 100, submit: false }), 'CHECKLIST_MONTHLY_NOT_WAITING_REVIEW');
  });

  await record('7) Người không có quyền / ngoài phạm vi -> không được thẩm định (CHECKLIST_MONTHLY_REVIEW_SCOPE_REVOKED)', async () => {
    reviewAccessOverride = { grant: { presetCode: 'TRUONG_BO_PHAN' }, canReview: true, people: [{ employeeId: 'someone-else', employeeCode: 'KHAC' }] };
    try {
      await expectFail(monthlyLib.saveMonthlyReview(OUTSIDE_MANAGER_SESSION, { formId: 'f-outscope', expectedUpdatedAt: formById('f-outscope').updated_at, answers: { 'MAN-C1': { value: '10' } }, checklistScore: 100, submit: false }), 'CHECKLIST_MONTHLY_REVIEW_SCOPE_REVOKED');
    } finally { reviewAccessOverride = null; }
  });

  await record('8) reviewed/locked luôn trả totals đã lưu, không tính lại từ answers', async () => {
    const reviewed=monthlyLib.withScoreSummary(formById('f-reviewed'));
    const locked=monthlyLib.withScoreSummary(formById('f-locked'));
    assert.deepStrictEqual([reviewed.self_total_score,reviewed.review_total_score,reviewed.final_score],[80,90,86.67]);
    assert.deepStrictEqual([locked.self_total_score,locked.review_total_score,locked.final_score],[70,80,76.67]);
    assert.strictEqual(reviewed.score_summary.persisted,true);
    assert.strictEqual(locked.score_summary.persisted,true);
  });

  await record('9) Quá hạn maximum dùng Target và lưu nguồn/formula version', async () => {
    const form={template_snapshot:baseSnapshot()};
    const maximum=monthlyLib.overdueSelfAnswers(form,'max')['MAN-C1'];
    const zero=monthlyLib.overdueSelfAnswers(form,'zero')['MAN-C1'];
    assert.strictEqual(maximum.value,'10');
    assert.strictEqual(maximum.effectiveActual,10);
    assert.strictEqual(maximum.target,10);
    assert.strictEqual(maximum.source,'overdue_maximum');
    assert.ok(maximum.formulaVersion);
    assert.strictEqual(zero.value,'0');
    assert.strictEqual(zero.source,'overdue_zero');
  });

  await record('10) API export giữ nguyên totals/formula của phiếu reviewed', async () => {
    const payload=await monthlyLib.exportMonthlyData(ADMIN_SESSION,{month:PERIOD});
    const reviewed=payload.forms.find(item=>item.id==='f-reviewed');
    assert.ok(reviewed);
    assert.deepStrictEqual([reviewed.selfTotalScore,reviewed.reviewTotalScore,reviewed.finalScore],[80,90,86.67]);
    assert.strictEqual(reviewed.formulaVersion,'persisted-test');
  });

  console.log('\n=== Kết quả ===');
  const passed = results.filter(r => r.pass).length;
  console.log(passed + '/' + results.length + ' bước PASS.');
  console.log('\nToàn bộ chạy trên mock trong bộ nhớ — không có ghi nào xuống database thật.');
  console.log('Chạy thủ công khi cần: node scripts/test-checklist-monthly-self-review.js');

  if (results.some(r => !r.pass)) process.exitCode = 1;
}

main().catch(err => { console.error('LỖI KHÔNG MONG ĐỢI:', err); process.exitCode = 1; });
