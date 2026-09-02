'use strict';
/*
 * Regression Test
 * Checklist Monthly — reconcileMissingMonthlyReviewers
 * In-memory only
 * No Production Database
 * Safe for future verification
 *
 * Kiểm tra patch: "Đồng bộ kỳ hiện tại" phải cập nhật lại người thẩm định khi quản lý
 * trực tiếp đã đổi, thay vì chỉ bỏ qua vì phiếu đã có sẵn bất kỳ giá trị reviewer nào
 * (lib/checklist-monthly.js, hàm reconcileMissingMonthlyReviewers).
 *
 * Toàn bộ chạy trên dữ liệu mock trong bộ nhớ (chặn @supabase/supabase-js bằng
 * Module._load), KHÔNG kết nối Supabase thật, KHÔNG đổi logic nghiệp vụ nào khác.
 *
 * File này KHÔNG được gọi tự động ở bất kỳ đâu — chỉ chạy thủ công:
 *   node scripts/test-checklist-monthly-reviewer-sync.js
 */

const assert = require('assert');
const path = require('path');
const Module = require('module');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function nextId(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 8); }

// ---------- 1. Dữ liệu mock ----------
const PERIOD = '2026-08';

const store = {
  checklist_employee_assignments: [
    { employee_key: 'nv001', employee_id: 'id-nv001', employee_code: 'NV001', employee_name: 'Nhân Viên 1', manager_id: 'MGR-NEW-ID', manager_code: 'MGR-NEW', manager_name: 'Quản Lý Mới', employee_status: 'Đang làm việc', effective_date: '2026-01-01', updated_at: '2026-01-01T00:00:00Z' },
    { employee_key: 'nv002', employee_id: 'id-nv002', employee_code: 'NV002', employee_name: 'Nhân Viên 2', manager_id: 'MGR-NEW-ID', manager_code: 'MGR-NEW', manager_name: 'Quản Lý Mới', employee_status: 'Đang làm việc', effective_date: '2026-01-01', updated_at: '2026-01-01T00:00:00Z' },
    // NV003: phân công hiện hành KHÔNG có quản lý (case 3).
    { employee_key: 'nv003', employee_id: 'id-nv003', employee_code: 'NV003', employee_name: 'Nhân Viên 3', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', effective_date: '2026-01-01', updated_at: '2026-01-01T00:00:00Z' },
    { employee_key: 'nv004', employee_id: 'id-nv004', employee_code: 'NV004', employee_name: 'Nhân Viên 4', manager_id: 'MGR-NEW-ID', manager_code: 'MGR-NEW', manager_name: 'Quản Lý Mới', employee_status: 'Đang làm việc', effective_date: '2026-01-01', updated_at: '2026-01-01T00:00:00Z' },
    { employee_key: 'nv005', employee_id: 'id-nv005', employee_code: 'NV005', employee_name: 'Nhân Viên 5', manager_id: 'MGR-NEW-ID', manager_code: 'MGR-NEW', manager_name: 'Quản Lý Mới', employee_status: 'Đang làm việc', effective_date: '2026-01-01', updated_at: '2026-01-01T00:00:00Z' },
    { employee_key: 'nv006', employee_id: 'id-nv006', employee_code: 'NV006', employee_name: 'Nhân Viên 6', manager_id: 'MGR-NEW-ID', manager_code: 'MGR-NEW', manager_name: 'Quản Lý Mới', employee_status: 'Đang làm việc', effective_date: '2026-01-01', updated_at: '2026-01-01T00:00:00Z' }
  ],
  checklist_employee_assignment_history: [],
  checklist_monthly_forms: [
    // Case 1: reviewer cũ khác quản lý hiện hành, KHÔNG có override tường minh -> phải cập nhật.
    { id: 'f1', period_month: PERIOD, status: 'draft', employee_code: 'NV001', employee_name: 'Nhân Viên 1', reviewer_id: 'MGR-OLD-ID', reviewer_code: 'MGR-OLD', reviewer_name: 'Quản Lý Cũ' },
    // Case 2: reviewer rỗng, có quản lý hợp lệ -> phải gán.
    { id: 'f2', period_month: PERIOD, status: 'draft', employee_code: 'NV002', employee_name: 'Nhân Viên 2', reviewer_id: '', reviewer_code: '', reviewer_name: '' },
    // Case 3: phân công không có quản lý, phiếu đang có reviewer -> giữ nguyên, không gọi RPC.
    { id: 'f3', period_month: PERIOD, status: 'draft', employee_code: 'NV003', employee_name: 'Nhân Viên 3', reviewer_id: 'MGR-OLD-ID', reviewer_code: 'MGR-OLD', reviewer_name: 'Quản Lý Cũ' },
    // Case 4: reviewer đã khớp đầy đủ -> không gọi RPC.
    { id: 'f4', period_month: PERIOD, status: 'draft', employee_code: 'NV004', employee_name: 'Nhân Viên 4', reviewer_id: 'MGR-NEW-ID', reviewer_code: 'MGR-NEW', reviewer_name: 'Quản Lý Mới' },
    // Case 5: reviewer_id đúng nhưng reviewer_code/name thiếu -> phải đồng bộ đầy đủ.
    { id: 'f5', period_month: PERIOD, status: 'draft', employee_code: 'NV005', employee_name: 'Nhân Viên 5', reviewer_id: 'MGR-NEW-ID', reviewer_code: '', reviewer_name: '' },
    // Case 6 (Bug B): Admin đã đổi người thẩm định tường minh (PHF042) khác quản lý snapshot (MGR-NEW)
    // -> reconcile PHẢI tôn trọng override, KHÔNG ghi đè.
    { id: 'f6', period_month: PERIOD, status: 'draft', employee_code: 'NV006', employee_name: 'Nhân Viên 6', reviewer_id: 'PHF042-ID', reviewer_code: 'PHF042', reviewer_name: 'Nguyễn Hoàng Khang' }
  ],
  checklist_monthly_form_history: [
    // f1: chỉ có auto-sync trước đó -> KHÔNG phải override tường minh -> vẫn được reconcile.
    { id: 'h1', form_id: 'f1', action: 'change_reviewer', reason: 'Hệ thống đồng bộ người thẩm định theo phân công hiệu lực của kỳ ' + PERIOD + '.', after_data: { reviewerCode: 'MGR-OLD', reviewerId: 'MGR-OLD-ID' }, changed_at: '2026-08-01T00:00:00Z' },
    // f6: sự kiện change_reviewer gần nhất là Admin nhập lý do -> override tường minh còn hiệu lực.
    { id: 'h6', form_id: 'f6', action: 'change_reviewer', reason: 'Admin đổi sang quản lý mới theo yêu cầu nghiệp vụ', after_data: { reviewerCode: 'PHF042', reviewerId: 'PHF042-ID' }, changed_at: '2026-08-05T09:00:00Z' }
  ]
};

const formsBefore = clone(store.checklist_monthly_forms);

// ---------- 2. Fake Supabase query builder ----------
class FakeQuery {
  constructor(table) { this.table = table; this.filters = []; this._limit = null; this._single = null; }
  select() { return this; }
  eq(col, val) { this.filters.push(row => String(row[col]) === String(val)); return this; }
  neq(col, val) { this.filters.push(row => String(row[col]) !== String(val)); return this; }
  in(col, arr) { const set = new Set((arr || []).map(String)); this.filters.push(row => set.has(String(row[col]))); return this; }
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
    const rows = this._rows();
    if (this._single === 'maybe') return Promise.resolve({ data: rows[0] || null, error: null }).then(resolve, reject);
    if (this._single === 'strict') return Promise.resolve(rows.length ? { data: rows[0], error: null } : { data: null, error: { message: 'No rows found' } }).then(resolve, reject);
    return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  }
}

// ---------- 3. Fake RPC change_checklist_monthly_reviewer ----------
const rpcCalls = [];
async function fakeRpc(name, p) {
  if (name !== 'change_checklist_monthly_reviewer') return { data: null, error: { message: 'RPC không được mock: ' + name } };
  rpcCalls.push(clone(p));
  const form = store.checklist_monthly_forms.find(f => f.id === p.p_form_id);
  if (!form) return { data: { ok: false, code: 'CHECKLIST_MONTHLY_FORM_NOT_FOUND' }, error: null };
  const before = { reviewer_id: form.reviewer_id, reviewer_code: form.reviewer_code, reviewer_name: form.reviewer_name };
  form.reviewer_id = p.p_reviewer_id; form.reviewer_code = p.p_reviewer_code; form.reviewer_name = p.p_reviewer_name;
  return { data: { ok: true, before, after: { reviewer_id: form.reviewer_id, reviewer_code: form.reviewer_code, reviewer_name: form.reviewer_name } }, error: null };
}

// ---------- 4. Chặn @supabase/supabase-js trước khi nạp module thật ----------
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@supabase/supabase-js') {
    return { createClient: () => ({ from: (table) => new FakeQuery(table), rpc: (name, params) => fakeRpc(name, params) }) };
  }
  return originalLoad.apply(this, arguments);
};
const monthlyLib = require(path.join(__dirname, '..', 'api', '_lib', 'checklist-monthly.js'));
Module._load = originalLoad;

const ADMIN_SESSION = { role: 'admin', account: { id: 'admin-1', name: 'Test Admin' }, sub: 'admin-1' };

// ---------- 5. Bộ chạy test ----------
const results = [];
async function record(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log('✓ PASS -', name); }
  catch (err) { results.push({ name, pass: false }); console.log('✗ FAIL -', name, '\n   ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n   ') : err)); }
}

function formById(id) { return store.checklist_monthly_forms.find(f => f.id === id); }
function rpcCallFor(formId) { return rpcCalls.find(c => c.p_form_id === formId); }

async function main() {
  console.log('=== Regression test: reconcileMissingMonthlyReviewers (mock, không đụng Supabase thật) ===\n');

  const result = await monthlyLib.reconcileMissingMonthlyReviewers(ADMIN_SESSION, PERIOD);

  await record('Case 1 — reviewer cũ khác quản lý hiện hành -> cập nhật đúng người mới', async () => {
    const f1 = formById('f1');
    assert.strictEqual(f1.reviewer_id, 'MGR-NEW-ID');
    assert.strictEqual(f1.reviewer_code, 'MGR-NEW');
    assert.strictEqual(f1.reviewer_name, 'Quản Lý Mới');
    const call = rpcCallFor('f1');
    assert.ok(call, 'Phải gọi RPC change_checklist_monthly_reviewer cho f1.');
    assert.strictEqual(call.p_reason, 'Hệ thống đồng bộ người thẩm định theo phân công hiệu lực của kỳ ' + PERIOD + '.');
  });

  await record('Case 2 — reviewer rỗng, có quản lý hợp lệ -> gán đúng người', async () => {
    const f2 = formById('f2');
    assert.strictEqual(f2.reviewer_id, 'MGR-NEW-ID');
    assert.strictEqual(f2.reviewer_code, 'MGR-NEW');
    assert.ok(rpcCallFor('f2'), 'Phải gọi RPC cho f2.');
  });

  await record('Case 3 — phân công không có quản lý, phiếu đang có reviewer -> giữ nguyên, KHÔNG gọi RPC', async () => {
    const f3 = formById('f3'), f3Before = formsBefore.find(f => f.id === 'f3');
    assert.deepStrictEqual({ reviewer_id: f3.reviewer_id, reviewer_code: f3.reviewer_code, reviewer_name: f3.reviewer_name },
      { reviewer_id: f3Before.reviewer_id, reviewer_code: f3Before.reviewer_code, reviewer_name: f3Before.reviewer_name });
    assert.ok(!rpcCallFor('f3'), 'Không được gọi RPC cho f3.');
    assert.ok(!result.warnings.some(w => w.employeeCode === 'NV003'), 'Không được sinh cảnh báo sai cho f3 vì phiếu đã có reviewer.');
  });

  await record('Case 4 — reviewer đã khớp đầy đủ -> KHÔNG gọi RPC (tránh gọi thừa)', async () => {
    const f4 = formById('f4');
    assert.strictEqual(f4.reviewer_id, 'MGR-NEW-ID');
    assert.ok(!rpcCallFor('f4'), 'Không được gọi RPC cho f4 vì đã đúng người thẩm định hiện hành.');
  });

  await record('Case 5 — reviewer_id đúng nhưng reviewer_code/name thiếu -> vẫn gọi RPC để đồng bộ đầy đủ', async () => {
    const f5 = formById('f5');
    assert.strictEqual(f5.reviewer_code, 'MGR-NEW');
    assert.strictEqual(f5.reviewer_name, 'Quản Lý Mới');
    assert.ok(rpcCallFor('f5'), 'Phải gọi RPC cho f5 dù reviewer_id đã đúng, vì code/name chưa khớp.');
  });

  await record('Case 6 (Bug B) — Admin override tường minh khác quản lý snapshot -> KHÔNG ghi đè, KHÔNG gọi RPC', async () => {
    const f6 = formById('f6'), f6Before = formsBefore.find(f => f.id === 'f6');
    assert.deepStrictEqual({ reviewer_id: f6.reviewer_id, reviewer_code: f6.reviewer_code, reviewer_name: f6.reviewer_name },
      { reviewer_id: f6Before.reviewer_id, reviewer_code: f6Before.reviewer_code, reviewer_name: f6Before.reviewer_name });
    assert.ok(!rpcCallFor('f6'), 'Không được gọi RPC cho f6 vì phiếu đã có override tường minh của Admin.');
    assert.ok((result.skippedOverride || []).some(x => x.formId === 'f6'), 'f6 phải nằm trong skippedOverride.');
    assert.strictEqual(result.overrideRespected, 1);
  });

  await record('Tổng số phiếu được cập nhật (updated) = 3 (f1, f2, f5); f3, f4, f6 không tính', async () => {
    assert.strictEqual(result.updated, 3);
    const ids = result.changed.map(x => x.formId).sort();
    assert.deepStrictEqual(ids, ['f1', 'f2', 'f5']);
  });

  console.log('\n=== Kết quả ===');
  const passed = results.filter(r => r.pass).length;
  console.log(passed + '/' + results.length + ' bước PASS.');
  console.log('\nToàn bộ chạy trên mock trong bộ nhớ — không có ghi nào xuống database thật.');
  console.log('Chạy thủ công khi cần: node scripts/test-checklist-monthly-reviewer-sync.js');

  if (results.some(r => !r.pass)) process.exitCode = 1;
}

main().catch(err => { console.error('LỖI KHÔNG MONG ĐỢI:', err); process.exitCode = 1; });
