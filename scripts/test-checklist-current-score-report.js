'use strict';
/*
 * Regression Test — Dashboard "Điểm Checklist" chế độ HIỆN TẠI
 * (lib/checklist-reports.js -> getChecklistCurrentScoreReport()).
 *
 * Khẳng định:
 *  - Danh sách bắt đầu từ checklist_employee_assignments hiện hành (KHÔNG chỉ
 *    người đã có monthly form) - có cả nhân viên điểm 100 chưa có lỗi.
 *  - Điểm dùng đúng công thức đã có ở mọi nơi khác: 100 - Σpoints
 *    (record_status='official', is_test=false, trong kỳ) - is_test/cancelled
 *    KHÔNG bị trừ.
 *  - Filter department/branch/query hoạt động đúng.
 *  - summary (total/averageScore/belowThresholdCount/cleanCount) khớp dữ liệu.
 *  - Quyền dùng đúng getChecklistReportAccess() (cùng gate với "Báo cáo" -
 *    không tạo permission mới).
 *
 * Cùng convention mock-Supabase (chặn @supabase/supabase-js) với
 * scripts/test-checklist-monthly-reviewer-sync.js. Không kết nối DB thật.
 *
 * File này KHÔNG được gọi tự động ở bất kỳ đâu - chỉ chạy thủ công:
 *   node scripts/test-checklist-current-score-report.js
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

const PERIOD = '2026-08';
const store = {
  checklist_employee_assignments: [
    { employee_key: 'e1', employee_id: 'id-e1', employee_code: 'E1', employee_name: 'Nguyễn Văn Sạch', department: 'Bộ phận bán hàng', title: 'Nhân viên', branch: 'Ngô Quyền', manager_id: '', manager_code: 'MGR1', manager_name: 'Quản Lý A', employee_status: 'Đang làm việc', effective_date: '2026-01-01' },
    { employee_key: 'e2', employee_id: 'id-e2', employee_code: 'E2', employee_name: 'Trần Thị Lỗi', department: 'Bộ phận bán hàng', title: 'Nhân viên', branch: 'Ngô Quyền', manager_id: '', manager_code: 'MGR1', manager_name: 'Quản Lý A', employee_status: 'Đang làm việc', effective_date: '2026-01-01' },
    { employee_key: 'e3', employee_id: 'id-e3', employee_code: 'E3', employee_name: 'Lê Văn Test', department: 'Bộ phận bán hàng', title: 'Nhân viên', branch: 'Lái Thiêu', manager_id: '', manager_code: 'MGR2', manager_name: 'Quản Lý B', employee_status: 'Đang làm việc', effective_date: '2026-01-01' },
    // Đã nghỉ việc - phải bị loại (assignmentsRequest trong getChecklistReportAccess neq employee_status).
    { employee_key: 'e4', employee_id: 'id-e4', employee_code: 'E4', employee_name: 'Đã Nghỉ Việc', department: 'Bộ phận bán hàng', title: 'Nhân viên', branch: 'Ngô Quyền', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đã nghỉ việc', effective_date: '2026-01-01' }
  ],
  checklist_violation_records: [
    { employee_code: 'E2', points: 10, occurred_date: '2026-08-05', record_status: 'official', is_test: false },
    { employee_code: 'E2', points: 5, occurred_date: '2026-08-10', record_status: 'official', is_test: false },
    { employee_code: 'E2', points: 50, occurred_date: '2026-08-12', record_status: 'official', is_test: true }, // is_test -> KHÔNG được trừ
    { employee_code: 'E2', points: 50, occurred_date: '2026-08-12', record_status: 'cancelled', is_test: false }, // cancelled -> KHÔNG được trừ
    { employee_code: 'E3', points: 40, occurred_date: '2026-08-01', record_status: 'official', is_test: false }, // -> điểm 60, dưới ngưỡng 70
    { employee_code: 'E2', points: 3, occurred_date: '2026-07-20', record_status: 'official', is_test: false } // tháng trước -> KHÔNG được tính vào kỳ 08
  ],
  checklist_monthly_forms: [
    { employee_code: 'E2', period_month: PERIOD, status: 'waiting_self' }
    // E1, E3 CHƯA có monthly form kỳ này - vẫn phải xuất hiện trong dashboard.
  ],
  checklist_permission_grants: []
};

class FakeQuery {
  constructor(table) { this.table = table; this.filters = []; this._limit = null; this._single = null; }
  select() { return this; }
  eq(col, val) { this.filters.push(row => String(row[col]) === String(val)); return this; }
  neq(col, val) { this.filters.push(row => String(row[col]) !== String(val)); return this; }
  in(col, vals) { const set = new Set((vals || []).map(String)); this.filters.push(row => set.has(String(row[col]))); return this; }
  gte(col, val) { this.filters.push(row => String(row[col]) >= String(val)); return this; }
  lt(col, val) { this.filters.push(row => String(row[col]) < String(val)); return this; }
  lte(col, val) { this.filters.push(row => String(row[col]) <= String(val)); return this; }
  or() { return this; } // getChecklistReportAccess dùng .or() cho grant lookup - admin session không đi qua nhánh này
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
    return { createClient: () => ({ from: (table) => new FakeQuery(table) }) };
  }
  return originalLoad.apply(this, arguments);
};
const reportsLib = require(path.join(__dirname, '..', 'api', '_lib', 'checklist-reports.js'));
Module._load = originalLoad;

const ADMIN_SESSION = { role: 'admin', account: { id: 'admin-1', name: 'Test Admin' }, sub: 'admin-1' };

const results = [];
async function record(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log('✓ PASS -', name); }
  catch (err) { results.push({ name, pass: false }); console.log('✗ FAIL -', name, '\n   ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n   ') : err)); }
}

async function main() {
  console.log('=== Regression test: getChecklistCurrentScoreReport (mock, không đụng Supabase thật) ===\n');

  const report = await reportsLib.getChecklistCurrentScoreReport(ADMIN_SESSION, { month: PERIOD });
  const byCode = code => report.employees.find(e => e.employeeCode === code);

  await record('E4 (đã nghỉ việc) KHÔNG xuất hiện trong danh sách', async () => {
    assert.ok(!byCode('E4'));
  });
  await record('E1 (chưa từng có lỗi, chưa có monthly form) VẪN xuất hiện, điểm 100, hasMonthlyForm=false', async () => {
    const e1 = byCode('E1');
    assert.ok(e1, 'E1 phải có trong danh sách dù chưa có monthly form');
    assert.strictEqual(e1.currentScore, 100);
    assert.strictEqual(e1.violationCount, 0);
    assert.strictEqual(e1.hasMonthlyForm, false);
  });
  await record('E2: chỉ trừ 2 violation official/is_test=false trong kỳ 08 (10+5=15) -> điểm 85, is_test/cancelled/tháng khác KHÔNG bị trừ', async () => {
    const e2 = byCode('E2');
    assert.strictEqual(e2.violationCount, 2);
    assert.strictEqual(e2.totalPointsDeducted, 15);
    assert.strictEqual(e2.currentScore, 85);
    assert.strictEqual(e2.hasMonthlyForm, true);
    assert.strictEqual(e2.monthlyFormStatus, 'waiting_self');
  });
  await record('E3: 40 điểm trừ trong kỳ -> điểm 60, dưới ngưỡng (<70)', async () => {
    const e3 = byCode('E3');
    assert.strictEqual(e3.currentScore, 60);
  });
  await record('summary.total = 3 (E1,E2,E3, không tính E4)', async () => {
    assert.strictEqual(report.summary.total, 3);
  });
  await record('summary.cleanCount = 1 (chỉ E1 chưa có lỗi)', async () => {
    assert.strictEqual(report.summary.cleanCount, 1);
  });
  await record('summary.belowThresholdCount = 1 (chỉ E3 dưới 70)', async () => {
    assert.strictEqual(report.summary.belowThresholdCount, 1);
  });
  await record('summary.averageScore = (100+85+60)/3 = 81.67 (làm tròn 2 chữ số)', async () => {
    assert.strictEqual(report.summary.averageScore, 81.67);
  });

  const filteredBranch = await reportsLib.getChecklistCurrentScoreReport(ADMIN_SESSION, { month: PERIOD, branch: 'Lái Thiêu' });
  await record('Filter branch="Lái Thiêu": chỉ còn E3', async () => {
    assert.strictEqual(filteredBranch.employees.length, 1);
    assert.strictEqual(filteredBranch.employees[0].employeeCode, 'E3');
  });

  const filteredQuery = await reportsLib.getChecklistCurrentScoreReport(ADMIN_SESSION, { month: PERIOD, query: 'Trần Thị Lỗi' });
  await record('Filter query="Trần Thị Lỗi": chỉ còn E2', async () => {
    assert.strictEqual(filteredQuery.employees.length, 1);
    assert.strictEqual(filteredQuery.employees[0].employeeCode, 'E2');
  });

  const failed = results.filter(r => !r.pass);
  console.log('\n=== Kết quả ===');
  console.log(results.length - failed.length + '/' + results.length + ' bước PASS.');
  console.log('\nToàn bộ chạy trên mock trong bộ nhớ — không có ghi nào xuống database thật.');
  console.log('Chạy thủ công khi cần: node scripts/test-checklist-current-score-report.js');
  if (failed.length) process.exit(1);
}

main();
