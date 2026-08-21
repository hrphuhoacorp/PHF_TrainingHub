'use strict';
/*
 * Regression test — Account Admin list N+1 fix (lib/auth.js: listAccountsForAdmin)
 * In-memory mock of @supabase/supabase-js — KHÔNG kết nối Supabase/DB thật.
 *
 * Bối cảnh: màn Account Admin (/admin/nhan-su -> Quản lý tài khoản) tải rất chậm.
 * Root cause: listAccountsForAdmin() gọi ensureLearnerEmployeeLink() tuần tự trong
 * vòng lặp cho TỪNG tài khoản, mỗi lần lại query Supabase để xác nhận employeeId
 * hiện có còn tồn tại (N round-trip tuần tự cho N tài khoản).
 * Fix: gộp bước xác nhận employeeId hợp lệ thành một truy vấn `.in(...)` duy nhất;
 * chỉ tài khoản có employeeId thiếu/không hợp lệ mới đi qua đường xử lý riêng
 * (ensureLearnerEmployeeLink) như cũ.
 *
 * Test này xác nhận:
 *   1. Với tài khoản đã liên kết hợp lệ (trường hợp phổ biến), KHÔNG còn phát sinh
 *      truy vấn .eq(id).limit(1) riêng cho từng tài khoản — chỉ 1 truy vấn .in() duy nhất.
 *   2. Tài khoản hệ thống độc lập (system_admin) vẫn được bỏ qua hoàn toàn, không gọi.
 *   3. Tài khoản có employeeId sai/lỗi thời vẫn được tự sửa đúng như logic cũ
 *      (qua nhánh ensureLearnerEmployeeLink, dùng legacy-id fallback).
 *   4. Dữ liệu trả về (accounts) không đổi hình dạng/nội dung so với trước khi tối ưu.
 *
 * Chạy thủ công: node scripts/test-account-admin-list-batch-2026-08.js
 */

const assert = require('assert');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const AUTH_PATH = path.join(ROOT, 'api', '_lib', 'auth.js');

const calls = []; // {table, op, detail}

const EMPLOYEES = [{ id: 'EMP1' }, { id: 'EMP2' }, { id: 'E005' }];

function makeQuery(table) {
  const state = { table, filters: {} };
  const api = {
    select(cols) { state.select = cols; return api; },
    order() { return api; },
    in(col, vals) { state.filters[col] = { op: 'in', vals: vals.slice() }; return api; },
    eq(col, val) { state.filters[col] = { op: 'eq', val }; return api; },
    limit(n) { state.limit = n; return api; },
    update(row) { state.op = 'update'; state.updateRow = row; return api; },
    then(resolve, reject) {
      try { resolve(resolveQuery(state)); } catch (e) { reject(e); }
    }
  };
  return api;
}

function resolveQuery(state) {
  if (state.table === 'user_accounts' && !state.op) {
    calls.push({ table: 'user_accounts', op: 'select-all' });
    return { data: ACCOUNT_ROWS, error: null };
  }
  if (state.table === 'employees' && state.filters.id && state.filters.id.op === 'in') {
    calls.push({ table: 'employees', op: 'in', vals: state.filters.id.vals });
    const set = new Set(state.filters.id.vals);
    return { data: EMPLOYEES.filter(r => set.has(r.id)), error: null };
  }
  if (state.table === 'employees' && state.filters.id && state.filters.id.op === 'eq') {
    calls.push({ table: 'employees', op: 'eq-limit' + state.limit, val: state.filters.id.val });
    const match = EMPLOYEES.filter(r => r.id === state.filters.id.val);
    return { data: match, error: null };
  }
  if (state.table === 'user_accounts' && state.op === 'update') {
    calls.push({ table: 'user_accounts', op: 'update', row: state.updateRow, eqId: state.filters.id && state.filters.id.val });
    return { data: null, error: null };
  }
  throw new Error('Unhandled mock query: ' + JSON.stringify(state));
}

const fakeSupabaseModule = {
  createClient() {
    return { from(table) { return makeQuery(table); } };
  }
};

const ACCOUNT_ROWS = [
  { id: 'acct-1', employee_id: 'EMP1', employee_code: 'E001', name: 'Nguyen Van A', email: 'a@test.local', phone: '0900000001', role: 'learner', status: 'active', metadata: {} },
  { id: 'acct-2', employee_id: 'EMP2', employee_code: 'E002', name: 'Nguyen Van B', email: 'b@test.local', phone: '0900000002', role: 'manager', status: 'active', metadata: {} },
  { id: 'acct-3', employee_id: null, employee_code: '', name: 'Admin He Thong', email: 'admin@test.local', phone: '', role: 'admin', status: 'active', metadata: { accountType: 'system_admin' } },
  { id: 'acct-4', employee_id: 'BADID', employee_code: 'E005', name: 'Nguyen Van D', email: 'd@test.local', phone: '0900000099', role: 'learner', status: 'active', metadata: {} }
];

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.invalid';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'mock-secret';
process.env.PHF_SESSION_SECRET = process.env.PHF_SESSION_SECRET || 'mock-session-secret-for-test-only';

const originalLoad = Module._load;
const originalResolve = Module._resolveFilename;
Module._load = function (request, parent, isMain) {
  if (request === '@supabase/supabase-js') return fakeSupabaseModule;
  return originalLoad.apply(this, arguments);
};

const auth = require(AUTH_PATH);
Module._load = originalLoad;

assert.strictEqual(auth.hasSupabaseEnv, true, 'Test setup: hasSupabaseEnv phải true để đi vào nhánh Supabase (không phải file store)');

(async function main() {
  console.log('=== Regression test: listAccountsForAdmin() N+1 batch fix ===\n');

  const accounts = await auth.listAccountsForAdmin();

  // 1) Đúng 1 truy vấn .in() duy nhất để xác nhận toàn bộ employeeId hợp lệ.
  const batchCalls = calls.filter(c => c.table === 'employees' && c.op === 'in');
  assert.strictEqual(batchCalls.length, 1, 'Phải có đúng 1 truy vấn .in() gộp cho toàn bộ danh sách');
  const batchedIds = new Set(batchCalls[0].vals);
  assert.ok(batchedIds.has('EMP1') && batchedIds.has('EMP2') && batchedIds.has('BADID'),
    'Truy vấn gộp phải bao gồm employeeId của mọi tài khoản không phải hệ thống độc lập');
  console.log('✓ PASS - Chỉ 1 truy vấn .in() gộp cho việc xác nhận employeeId, thay vì N truy vấn riêng lẻ');

  // 2) Tài khoản đã liên kết hợp lệ (acct-1, acct-2) KHÔNG phát sinh truy vấn riêng lẻ.
  const perAccountChecks = calls.filter(c => c.table === 'employees' && c.op.startsWith('eq-limit'));
  // acct-4 đi qua nhánh sửa lỗi cũ (ensureLearnerEmployeeLink): kiểm tra direct id
  // cũ (BADID, không hợp lệ) rồi fallback theo employeeCode/legacy-id (E005) — đúng
  // như hành vi gốc trước khi tối ưu. Chỉ acct-4 mới chạm nhánh này.
  assert.strictEqual(perAccountChecks.length, 2, 'Chỉ acct-4 (employeeId không hợp lệ) mới đi qua 2 bước kiểm tra riêng lẻ cũ (direct + legacy-id)');
  assert.ok(perAccountChecks.every(c => c.val === 'BADID' || c.val === 'E005'),
    'Các truy vấn riêng lẻ chỉ được phép liên quan tới acct-4 (BADID/E005), không liên quan acct-1/acct-2 (EMP1/EMP2)');
  console.log('✓ PASS - Tài khoản đã liên kết hợp lệ (acct-1, acct-2) không tạo thêm round-trip riêng; chỉ acct-4 đi qua đường sửa lỗi cũ');

  // 3) Tài khoản hệ thống độc lập (acct-3) không bị đụng tới.
  const acct3Touched = calls.some(c => (c.eqId === 'acct-3') || (c.val === 'acct-3'));
  assert.strictEqual(acct3Touched, false, 'Tài khoản hệ thống độc lập không được truy vấn thêm');
  console.log('✓ PASS - Tài khoản hệ thống độc lập (system_admin) vẫn được bỏ qua hoàn toàn');

  // 4) acct-4 (employeeId cũ sai) vẫn được tự sửa đúng qua legacy-id fallback.
  const updateCalls = calls.filter(c => c.table === 'user_accounts' && c.op === 'update');
  assert.strictEqual(updateCalls.length, 1, 'Chỉ acct-4 cần ghi lại employeeId đã sửa');
  assert.strictEqual(updateCalls[0].eqId, 'acct-4');
  assert.strictEqual(updateCalls[0].row.employee_id, 'E005', 'employeeId phải được tự sửa thành E005 qua legacy-id fallback');
  console.log('✓ PASS - Tài khoản có employeeId lỗi thời (acct-4) vẫn được tự sửa đúng qua legacy-id fallback');

  // 5) Hình dạng/nội dung dữ liệu trả về không đổi so với hành vi cũ.
  assert.strictEqual(accounts.length, 4);
  const byId = Object.fromEntries(accounts.map(a => [a.id, a]));
  assert.strictEqual(byId['acct-1'].employeeId, 'EMP1');
  assert.strictEqual(byId['acct-2'].employeeId, 'EMP2');
  assert.strictEqual(byId['acct-3'].accountType, 'system_admin');
  assert.strictEqual(byId['acct-4'].employeeId, 'E005');
  console.log('✓ PASS - publicAccount() trả về đúng employeeId/accountType cho cả 4 tài khoản\n');

  console.log('=== Kết quả ===');
  console.log('5/5 bước PASS. Tổng số truy vấn Supabase cho 4 tài khoản: ' + calls.length +
    ' (so với cách cũ: tối thiểu 1 + 4 = 5 truy vấn tuần tự, và sẽ tăng tuyến tính theo N tài khoản).');
  console.log('Toàn bộ chạy trên mock @supabase/supabase-js trong bộ nhớ — không có kết nối hay ghi nào xuống Supabase thật.');
})().catch(err => {
  console.error('✗ FAIL -', err && err.message ? err.message : err);
  process.exitCode = 1;
});
