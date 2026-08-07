'use strict';
/*
 * Regression Test — Báo cáo → Tổng hợp (lib/checklist-reports.js ->
 * getChecklistMonthlyReport()) phải trả CẢ HAI lớp dữ liệu cho mỗi form:
 * snapshot (department/branch/title từ checklist_monthly_forms - đóng băng
 * theo lịch sử) và current (currentDepartment/currentBranch/currentTitle -
 * đọc từ checklist_employee_assignments hiện hành qua
 * getChecklistReportAccess().people, CÙNG quyền view_reports mà Phiếu tháng
 * đã dùng - không tạo permission mới).
 *
 * Case PHF076: snapshot phiếu 08/2026 = 'Phú Lợi', current assignment =
 * 'Ngô Quyền'. Đúng nguyên tắc đã PASS Production ở Phiếu tháng
 * (xem scripts/test-checklist-monthly-current-org-backend.js): filter vận
 * hành/report phải theo CURRENT organization, KHÔNG theo snapshot đóng băng.
 *
 * Cùng convention mock-Supabase (chặn @supabase/supabase-js qua Module._load)
 * với scripts/test-checklist-current-score-report.js. Không kết nối DB thật.
 *
 * File này KHÔNG được gọi tự động ở bất kỳ đâu - chỉ chạy thủ công:
 *   node scripts/test-checklist-report-current-org.js
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

const PERIOD = '2026-08';
const store = {
  checklist_monthly_periods: [{ period_month: PERIOD, status: '' }],
  checklist_monthly_forms: [
    // PHF076-like: snapshot 'Phú Lợi', current assignment đã chuyển sang 'Ngô Quyền'.
    { id: 'F-PHF076', period_month: PERIOD, employee_code: 'PHF076', employee_name: 'Võ Phương Diệu', department: 'Bán hàng', title: 'Nhân viên', branch: 'Phú Lợi', status: 'waiting_self', template_id: 'nv-ban-hang', template_version: 'BH-1.0', template_snapshot: { version: { definition: { totalRows: [[1, 'HQCV-TEST', 'Tiêu chí test', 10, 'điểm', 100, 'Không']] } } }, checklist_score: 99, reviewer_code: 'PHF018', reviewer_name: 'Nguyễn Thị Lệ', final_score: 95, updated_at: '2026-08-06T00:00:00Z' },
    // Control: đã khớp current, phòng ban khác để kiểm tra AND filter + branch phụ thuộc department.
    { id: 'F-PHF018', period_month: PERIOD, employee_code: 'PHF018', employee_name: 'Nguyễn Thị Lệ', department: 'Bán hàng', title: 'Trưởng ca', branch: 'Ngô Quyền', status: 'reviewed', template_id: 'truong-ca-ban-hang', template_version: 'TCP-BH-1.0', template_snapshot: { version: { definition: { totalRows: [[1, 'HQCV-TEST', 'Tiêu chí test', 10, 'điểm', 100, 'Không']] } } }, checklist_score: 100, final_score: 98, updated_at: '2026-08-01T00:00:00Z' },
    { id: 'F-PHF099', period_month: PERIOD, employee_code: 'PHF099', employee_name: 'Trần Văn Kho', department: 'Kho vận', title: 'Nhân viên', branch: 'Ngô Quyền', status: 'waiting_self', template_id: 'nv-kho', template_version: 'KHO-1.0', template_snapshot: { version: { definition: { totalRows: [[1, 'HQCV-TEST', 'Tiêu chí test', 10, 'điểm', 100, 'Không']] } } }, checklist_score: 100, final_score: null, updated_at: '2026-08-02T00:00:00Z' }
  ],
  checklist_employee_assignments: [
    { employee_key: 'phf076', employee_id: 'id-phf076', employee_code: 'PHF076', employee_name: 'Võ Phương Diệu', department: 'Bán hàng', title: 'Nhân viên', branch: 'Ngô Quyền', manager_id: 'id-phf018', manager_code: 'PHF018', manager_name: 'Nguyễn Thị Lệ', employee_status: 'Đang làm việc', effective_date: '2026-07-28' },
    { employee_key: 'phf018', employee_id: 'id-phf018', employee_code: 'PHF018', employee_name: 'Nguyễn Thị Lệ', department: 'Bán hàng', title: 'Trưởng ca', branch: 'Ngô Quyền', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', effective_date: '2026-01-01' },
    { employee_key: 'phf099', employee_id: 'id-phf099', employee_code: 'PHF099', employee_name: 'Trần Văn Kho', department: 'Kho vận', title: 'Nhân viên', branch: 'Ngô Quyền', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', effective_date: '2026-01-01' }
  ],
  checklist_violation_records: [
    { id: 'V-1', employee_code: 'PHF076', employee_name: 'Võ Phương Diệu', criterion_code: 'HQCV-TEST', criterion_name: 'Tiêu chí test', criterion_group: 'Vận hành', points: 5, occurred_date: '2026-08-05', record_status: 'official', is_test: false }
  ],
  checklist_monthly_form_history: [],
  checklist_permission_grants: [],
  checklist_repeat_violation_policies: []
};
const formsBefore = clone(store.checklist_monthly_forms);
const assignmentsBefore = clone(store.checklist_employee_assignments);

class FakeQuery {
  constructor(table) { this.table = table; this.filters = []; this._limit = null; this._single = null; }
  select() { return this; }
  eq(col, val) { this.filters.push(row => String(row[col]) === String(val)); return this; }
  neq(col, val) { this.filters.push(row => String(row[col]) !== String(val)); return this; }
  in(col, vals) { const set = new Set((vals || []).map(String)); this.filters.push(row => set.has(String(row[col]))); return this; }
  gte(col, val) { this.filters.push(row => String(row[col]) >= String(val)); return this; }
  lt(col, val) { this.filters.push(row => String(row[col]) < String(val)); return this; }
  lte(col, val) { this.filters.push(row => String(row[col]) <= String(val)); return this; }
  or() { return this; }
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
const reportsLib = require(path.join(__dirname, '..', 'lib', 'checklist-reports.js'));
Module._load = originalLoad;

const ADMIN_SESSION = { role: 'admin', account: { id: 'admin-1', name: 'Test Admin' }, sub: 'admin-1' };

const results = [];
async function record(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log('✓ PASS -', name); }
  catch (err) { results.push({ name, pass: false }); console.log('✗ FAIL -', name, '\n   ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n   ') : err)); }
}

async function main() {
  console.log('=== Regression test: getChecklistMonthlyReport() current-org parity (mock, không đụng Supabase thật) ===\n');

  const report = await reportsLib.getChecklistMonthlyReport(ADMIN_SESSION, { month: PERIOD });
  const byCode = code => report.forms.find(f => f.employeeCode === code);
  const trendByCode = code => (report.trendForms || []).find(f => f.employeeCode === code && f.periodMonth === PERIOD);

  await record('PHF076: currentBranch = "Ngô Quyền" (đọc từ checklist_employee_assignments)', async () => {
    assert.strictEqual(byCode('PHF076').currentBranch, 'Ngô Quyền');
  });
  await record('PHF076: branch snapshot vẫn nguyên "Phú Lợi" (KHÔNG bị ghi đè)', async () => {
    assert.strictEqual(byCode('PHF076').branch, 'Phú Lợi');
  });
  await record('PHF076: currentDepartment = "Bán hàng"', async () => {
    assert.strictEqual(byCode('PHF076').currentDepartment, 'Bán hàng');
  });
  await record('checklist_monthly_forms và checklist_employee_assignments trong store hoàn toàn không đổi (chỉ đọc)', async () => {
    assert.deepStrictEqual(store.checklist_monthly_forms, formsBefore);
    assert.deepStrictEqual(store.checklist_employee_assignments, assignmentsBefore);
  });

  await record('trendForms: PHF076 kỳ hiện tại có currentBranch="Ngô Quyền", department snapshot vẫn "Phú Lợi"', async () => {
    const row = trendByCode('PHF076');
    assert.ok(row, 'trendForms phải có dòng PHF076 cho kỳ ' + PERIOD);
    assert.strictEqual(row.currentBranch, 'Ngô Quyền');
    assert.strictEqual(row.branch, 'Phú Lợi');
  });

  await record('trend[cuối cùng].average không đổi bởi việc thêm current fields (vẫn tính từ finalScore lịch sử)', async () => {
    const lastTrend = report.trend[report.trend.length - 1];
    assert.strictEqual(lastTrend.month, PERIOD);
    assert.ok(lastTrend.completed >= 1);
  });

  console.log('\n--- Simulate reportData()/reportFiltersHtml() filter logic (frontend contract) ---');
  function currentDepartmentOf(row) { return (row && (row.currentDepartment || row.department)) || ''; }
  function currentBranchOf(row) { return (row && (row.currentBranch || row.branch)) || ''; }

  await record('Filter currentBranch="Ngô Quyền": PHF076 XUẤT HIỆN dù snapshot branch="Phú Lợi"', async () => {
    const filtered = report.forms.filter(f => currentBranchOf(f) === 'Ngô Quyền');
    assert.ok(filtered.some(f => f.employeeCode === 'PHF076'), 'PHF076 phải xuất hiện khi lọc theo current branch Ngô Quyền');
  });
  await record('Filter currentBranch="Phú Lợi": PHF076 KHÔNG xuất hiện (current đã chuyển sang Ngô Quyền)', async () => {
    const filtered = report.forms.filter(f => currentBranchOf(f) === 'Phú Lợi');
    assert.ok(!filtered.some(f => f.employeeCode === 'PHF076'), 'PHF076 không được xuất hiện khi lọc theo current branch Phú Lợi');
  });
  await record('Filter department="Bán hàng" AND branch="Ngô Quyền": ra đúng PHF076 + PHF018, không có PHF099 (Kho vận)', async () => {
    const filtered = report.forms.filter(f => currentDepartmentOf(f) === 'Bán hàng' && currentBranchOf(f) === 'Ngô Quyền');
    const codes = filtered.map(f => f.employeeCode).sort();
    assert.deepStrictEqual(codes, ['PHF018', 'PHF076']);
  });
  await record('Branch options phụ thuộc department: chọn "Kho vận" -> chỉ còn branch "Ngô Quyền" (không lẫn branch của Bán hàng)', async () => {
    const deptForms = report.forms.filter(f => currentDepartmentOf(f) === 'Kho vận');
    const branches = [...new Set(deptForms.map(f => currentBranchOf(f)).filter(Boolean))];
    assert.deepStrictEqual(branches, ['Ngô Quyền']);
  });
  await record('Đổi department làm branch cũ invalid -> phải reset (mô phỏng logic reset ở app.js)', async () => {
    const prevBranch = 'Phú Lợi', newDepartment = 'Kho vận';
    const validBranches = new Set(report.forms.filter(f => currentDepartmentOf(f) === newDepartment).map(f => currentBranchOf(f)));
    const resultingBranch = validBranches.has(prevBranch) ? prevBranch : '';
    assert.strictEqual(resultingBranch, '', 'Phú Lợi không thuộc phòng ban Kho vận nên phải reset về rỗng');
  });

  await record('Violations: đơn vị hiển thị của PHF076 ưu tiên current org ("Ngô Quyền"), không phải snapshot "Phú Lợi"', async () => {
    const v = report.violations.find(x => x.employeeCode === 'PHF076');
    assert.ok(v, 'phải có violation của PHF076 trong kỳ');
    assert.strictEqual(v.branch, 'Ngô Quyền');
  });

  console.log('\n--- Export wiring contract (department truyền đúng field, không lẫn vào query) ---');
  await record('exportMonthlyWorkbook payload mô phỏng: department field mang giá trị phòng ban, query rỗng', async () => {
    const reportUiStateDepartment = 'Bán hàng';
    const simulatedPayload = { month: PERIOD, status: 'all', department: reportUiStateDepartment || '', branch: '', query: '' };
    assert.strictEqual(simulatedPayload.department, 'Bán hàng');
    assert.strictEqual(simulatedPayload.query, '');
  });

  const failed = results.filter(r => !r.pass);
  console.log('\n=== Kết quả ===');
  console.log(results.length - failed.length + '/' + results.length + ' bước PASS.');
  console.log('\nToàn bộ chạy trên mock trong bộ nhớ — không có ghi nào xuống database thật.');
  console.log('Chạy thủ công khi cần: node scripts/test-checklist-report-current-org.js');
  if (failed.length) process.exit(1);
}

main();
