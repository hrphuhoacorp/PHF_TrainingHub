'use strict';
/*
 * Regression Test — Backend: listMonthly() / exportMonthlyData() phải trả
 * current_branch/current_department/current_title (đọc từ
 * checklist_employee_assignments) và exportMonthlyData() phải LỌC theo
 * current_branch, không phải theo branch snapshot đóng băng trên
 * checklist_monthly_forms — đúng nguyên tắc "filter theo tổ chức hiện tại,
 * không phải theo lịch sử" (case PHF076: snapshot 'Phú Lợi', current
 * 'Ngô Quyền').
 *
 * Đồng thời khẳng định field snapshot (branch/department/title) trên chính
 * form KHÔNG bị đổi bởi các hàm này — chỉ đọc thêm, không ghi đè.
 *
 * Cùng convention mock-Supabase (chặn @supabase/supabase-js qua Module._load)
 * với scripts/test-checklist-monthly-reviewer-sync.js. Không kết nối DB thật.
 *
 * File này KHÔNG được gọi tự động ở bất kỳ đâu - chỉ chạy thủ công:
 *   node scripts/test-checklist-monthly-current-org-backend.js
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

const PERIOD = '2026-08';
const store = {
  checklist_monthly_periods: [],
  checklist_monthly_forms: [
    // PHF076-like: snapshot 'Phú Lợi', chuyển sang 'Ngô Quyền' SAU khi phiếu đã tạo.
    { id: 'F-PHF076', period_month: PERIOD, employee_code: 'PHF076', employee_name: 'Võ Phương Diệu', department: 'Bộ phận bán hàng', title: 'Nhân viên', branch: 'Phú Lợi', status: 'waiting_self', template_id: 'nv-ban-hang', template_version: 'BH-1.0', template_snapshot: { version: { definition: { totalRows: [[1, 'HQCV-TEST', 'Tiêu chí test', 10, 'điểm', 100, 'Không']] } } }, checklist_score: 99, reviewer_id: 'id-phf018', reviewer_code: 'PHF018', reviewer_name: 'Nguyễn Thị Lệ', updated_at: '2026-08-06T00:00:00Z' },
    // Control: snapshot đã khớp current, không có mismatch.
    { id: 'F-PHF018', period_month: PERIOD, employee_code: 'PHF018', employee_name: 'Nguyễn Thị Lệ', department: 'Bộ phận bán hàng', title: 'Trưởng ca', branch: 'Ngô Quyền', status: 'waiting_self', template_id: 'truong-ca-ban-hang', template_version: 'TCP-BH-1.0', template_snapshot: { version: { definition: { totalRows: [[1, 'HQCV-TEST', 'Tiêu chí test', 10, 'điểm', 100, 'Không']] } } }, checklist_score: 100, reviewer_id: '', reviewer_code: '', reviewer_name: '', updated_at: '2026-08-01T00:00:00Z' }
  ],
  checklist_employee_assignments: [
    { employee_key: 'phf076', employee_id: 'id-phf076', employee_code: 'PHF076', employee_name: 'Võ Phương Diệu', department: 'Bộ phận bán hàng', title: 'Nhân viên', branch: 'Ngô Quyền', manager_id: 'id-phf018', manager_code: 'PHF018', manager_name: 'Nguyễn Thị Lệ', employee_status: 'Đang làm việc', effective_date: '2026-07-28' },
    { employee_key: 'phf018', employee_id: 'id-phf018', employee_code: 'PHF018', employee_name: 'Nguyễn Thị Lệ', department: 'Bộ phận bán hàng', title: 'Trưởng ca', branch: 'Ngô Quyền', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', effective_date: '2026-01-01' }
  ],
  checklist_violation_records: [],
  checklist_monthly_form_history: [],
  checklist_permission_grants: []
};
const formsBefore = clone(store.checklist_monthly_forms);

class FakeQuery {
  constructor(table) { this.table = table; this.filters = []; this._limit = null; this._single = null; }
  select() { return this; }
  eq(col, val) { this.filters.push(row => String(row[col]) === String(val)); return this; }
  neq(col, val) { this.filters.push(row => String(row[col]) !== String(val)); return this; }
  in(col, vals) { const set = new Set((vals || []).map(String)); this.filters.push(row => set.has(String(row[col]))); return this; }
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
    const rows = this._rows();
    if (this._single === 'maybe') return Promise.resolve({ data: rows[0] || null, error: null }).then(resolve, reject);
    if (this._single === 'strict') return Promise.resolve(rows.length ? { data: rows[0], error: null } : { data: null, error: { message: 'No rows found' } }).then(resolve, reject);
    return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  }
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@supabase/supabase-js') {
    return { createClient: () => ({ from: (table) => new FakeQuery(table), rpc: () => Promise.resolve({ data: { ok: true }, error: null }) }) };
  }
  return originalLoad.apply(this, arguments);
};
const monthlyLib = require(path.join(__dirname, '..', 'api', '_lib', 'checklist-monthly.js'));
Module._load = originalLoad;

const ADMIN_SESSION = { role: 'admin', account: { id: 'admin-1', name: 'Test Admin' }, sub: 'admin-1' };

const results = [];
async function record(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log('✓ PASS -', name); }
  catch (err) { results.push({ name, pass: false }); console.log('✗ FAIL -', name, '\n   ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n   ') : err)); }
}

async function main() {
  console.log('=== Regression test: listMonthly()/exportMonthlyData() current-org fields (mock, không đụng Supabase thật) ===\n');

  const listResult = await monthlyLib.listMonthly(ADMIN_SESSION, { month: PERIOD });
  const phf076 = listResult.forms.find(f => f.employee_code === 'PHF076');
  const phf018 = listResult.forms.find(f => f.employee_code === 'PHF018');

  await record('listMonthly: PHF076 current_branch = "Ngô Quyền" (đọc từ checklist_employee_assignments)', async () => {
    assert.strictEqual(phf076.current_branch, 'Ngô Quyền');
  });
  await record('listMonthly: PHF076 branch snapshot vẫn nguyên "Phú Lợi" (KHÔNG bị listMonthly ghi đè)', async () => {
    assert.strictEqual(phf076.branch, 'Phú Lợi');
    const before = formsBefore.find(f => f.id === 'F-PHF076');
    assert.strictEqual(before.branch, 'Phú Lợi', 'sanity: mock gốc cũng phải là Phú Lợi');
  });
  await record('listMonthly: PHF076 organization_mismatch = true', async () => {
    assert.strictEqual(phf076.organization_mismatch, true);
  });
  await record('listMonthly: PHF076 organization_source = "checklist_employee_assignments"', async () => {
    assert.strictEqual(phf076.organization_source, 'checklist_employee_assignments');
  });
  await record('listMonthly: PHF018 (đã khớp) current_branch = branch = "Ngô Quyền", organization_mismatch = false', async () => {
    assert.strictEqual(phf018.current_branch, 'Ngô Quyền');
    assert.strictEqual(phf018.branch, 'Ngô Quyền');
    assert.strictEqual(phf018.organization_mismatch, false);
  });
  await record('listMonthly: current_department/current_title cũng được trả cho PHF076', async () => {
    assert.strictEqual(phf076.current_department, 'Bộ phận bán hàng');
    assert.strictEqual(phf076.current_title, 'Nhân viên');
  });

  // ---------- exportMonthlyData: filter branch phải theo current, không theo snapshot ----------
  const exportNQ = await monthlyLib.exportMonthlyData(ADMIN_SESSION, { month: PERIOD, branch: 'Ngô Quyền' });
  await record('exportMonthlyData: lọc branch="Ngô Quyền" (current) THẤY PHF076 dù snapshot="Phú Lợi"', async () => {
    assert.ok(exportNQ.forms.some(f => f.employeeCode === 'PHF076'), 'PHF076 phải có trong kết quả xuất khi lọc theo current_branch Ngô Quyền');
  });
  await record('exportMonthlyData: PHF076 trong kết quả xuất vẫn giữ branch (snapshot) = "Phú Lợi" và currentBranch = "Ngô Quyền"', async () => {
    const row = exportNQ.forms.find(f => f.employeeCode === 'PHF076');
    assert.strictEqual(row.branch, 'Phú Lợi');
    assert.strictEqual(row.currentBranch, 'Ngô Quyền');
    assert.strictEqual(row.currentDepartment, 'Bộ phận bán hàng');
  });

  const exportPL = await monthlyLib.exportMonthlyData(ADMIN_SESSION, { month: PERIOD, branch: 'Phú Lợi' });
  await record('exportMonthlyData: lọc branch="Phú Lợi" (current) KHÔNG thấy PHF076 (current đã chuyển sang Ngô Quyền)', async () => {
    assert.ok(!exportPL.forms.some(f => f.employeeCode === 'PHF076'), 'PHF076 không được xuất hiện khi lọc theo current_branch Phú Lợi, dù snapshot khớp');
  });

  await record('checklist_monthly_forms trong store hoàn toàn không bị thay đổi bởi cả 2 hàm (chỉ đọc)', async () => {
    assert.deepStrictEqual(store.checklist_monthly_forms, formsBefore);
  });

  const failed = results.filter(r => !r.pass);
  console.log('\n=== Kết quả ===');
  console.log(results.length - failed.length + '/' + results.length + ' bước PASS.');
  console.log('\nToàn bộ chạy trên mock trong bộ nhớ — không có ghi nào xuống database thật.');
  console.log('Chạy thủ công khi cần: node scripts/test-checklist-monthly-current-org-backend.js');
  if (failed.length) process.exit(1);
}

main();
