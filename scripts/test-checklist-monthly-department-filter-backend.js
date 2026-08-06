'use strict';
/*
 * Regression test — exportMonthlyData() phải nhận thêm filter `department`
 * (lọc theo current_department, không phải department snapshot đóng băng),
 * kết hợp AND với branch/status/query hiện có, và không được để "UI lọc đúng
 * nhưng Excel xuất rộng hơn" (build 1432-monthly-department-filter-counter-
 * sync). File vẫn phải giữ cả branch/department snapshot LẪN
 * currentBranch/currentDepartment/currentTitle trên mỗi dòng xuất.
 *
 * Cùng convention mock-Supabase (chặn @supabase/supabase-js qua Module._load)
 * với scripts/test-checklist-monthly-current-org-backend.js. Không kết nối
 * DB thật, không ghi gì xuống store.
 *
 * File này KHÔNG được gọi tự động ở bất kỳ đâu - chỉ chạy thủ công:
 *   node scripts/test-checklist-monthly-department-filter-backend.js
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

const PERIOD = '2026-08';
const BH = 'Bộ phận bán hàng', KT = 'Bộ phận Tài chính Kế toán';
const store = {
  checklist_monthly_periods: [],
  checklist_monthly_forms: [
    // PHF092/PHF041-like: dept Bán hàng cả snapshot lẫn current, branch snapshot 'Phú Lợi' -> current 'Lái Thiêu'.
    { id: 'F-PHF092', period_month: PERIOD, employee_code: 'PHF092', employee_name: 'Huỳnh Nhật Toàn', department: BH, title: 'Nhân viên', branch: 'Phú Lợi', status: 'waiting_self', template_id: 'nv-ban-hang', template_version: 'BH-1.0', template_snapshot: { version: { definition: { totalRows: [[1, 'HQCV-TEST', 'Tiêu chí test', 10, 'điểm', 100, 'Không']] } } }, checklist_score: 100, reviewer_id: '', reviewer_code: '', reviewer_name: '', updated_at: '2026-08-01T00:00:00Z' },
    { id: 'F-PHF041', period_month: PERIOD, employee_code: 'PHF041', employee_name: 'Đặng Thị Diễm', department: BH, title: 'Trưởng ca', branch: 'Phú Lợi', status: 'draft', template_id: 'truong-ca-ban-hang', template_version: 'TCP-BH-1.0', template_snapshot: { version: { definition: { totalRows: [[1, 'HQCV-TEST', 'Tiêu chí test', 10, 'điểm', 100, 'Không']] } } }, checklist_score: 100, reviewer_id: '', reviewer_code: '', reviewer_name: '', updated_at: '2026-08-01T00:00:00Z' },
    // Kế toán, cùng branch hiện tại Lái Thiêu như 2 dòng trên -> phải KHÔNG lẫn khi filter department=Bán hàng.
    { id: 'F-KT1', period_month: PERIOD, employee_code: 'PHF100', employee_name: 'Lê Thị Kế', department: KT, title: 'Kế toán viên', branch: 'Lái Thiêu', status: 'waiting_self', template_id: 'ke-toan', template_version: 'KT-1.0', template_snapshot: { version: { definition: { totalRows: [[1, 'HQCV-TEST', 'Tiêu chí test', 10, 'điểm', 100, 'Không']] } } }, checklist_score: 100, reviewer_id: '', reviewer_code: '', reviewer_name: '', updated_at: '2026-08-01T00:00:00Z' },
    // Bán hàng nhưng phòng ban đã ĐỔI (snapshot Bán hàng -> current Kế toán) để test lọc theo current, không phải snapshot.
    { id: 'F-MOVE', period_month: PERIOD, employee_code: 'PHF200', employee_name: 'Trần Văn Chuyển', department: BH, title: 'Nhân viên', branch: 'Phú Lợi', status: 'waiting_self', template_id: 'nv-ban-hang', template_version: 'BH-1.0', template_snapshot: { version: { definition: { totalRows: [[1, 'HQCV-TEST', 'Tiêu chí test', 10, 'điểm', 100, 'Không']] } } }, checklist_score: 100, reviewer_id: '', reviewer_code: '', reviewer_name: '', updated_at: '2026-08-01T00:00:00Z' }
  ],
  checklist_employee_assignments: [
    { employee_key: 'phf092', employee_id: 'id-phf092', employee_code: 'PHF092', employee_name: 'Huỳnh Nhật Toàn', department: BH, title: 'Nhân viên', branch: 'Lái Thiêu', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', effective_date: '2026-08-01' },
    { employee_key: 'phf041', employee_id: 'id-phf041', employee_code: 'PHF041', employee_name: 'Đặng Thị Diễm', department: BH, title: 'Trưởng ca', branch: 'Lái Thiêu', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', effective_date: '2026-08-01' },
    { employee_key: 'phf100', employee_id: 'id-phf100', employee_code: 'PHF100', employee_name: 'Lê Thị Kế', department: KT, title: 'Kế toán viên', branch: 'Lái Thiêu', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', effective_date: '2026-01-01' },
    // current_department đã chuyển sang Kế toán, khác snapshot Bán hàng trên form.
    { employee_key: 'phf200', employee_id: 'id-phf200', employee_code: 'PHF200', employee_name: 'Trần Văn Chuyển', department: KT, title: 'Kế toán viên', branch: 'Phú Lợi', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', effective_date: '2026-08-02' }
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
const monthlyLib = require(path.join(__dirname, '..', 'lib', 'checklist-monthly.js'));
Module._load = originalLoad;

const ADMIN_SESSION = { role: 'admin', account: { id: 'admin-1', name: 'Test Admin' }, sub: 'admin-1' };

const results = [];
async function record(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log('✓ PASS -', name); }
  catch (err) { results.push({ name, pass: false }); console.log('✗ FAIL -', name, '\n   ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n   ') : err)); }
}

async function main() {
  console.log('=== Regression test: exportMonthlyData() filter department (current, không phải snapshot) ===\n');

  const exportBH = await monthlyLib.exportMonthlyData(ADMIN_SESSION, { month: PERIOD, department: BH });
  await record('8a. department="Bộ phận bán hàng": thấy PHF092 và PHF041', async () => {
    const codes = exportBH.forms.map(f => f.employeeCode);
    assert.ok(codes.includes('PHF092') && codes.includes('PHF041'));
  });
  await record('8b. department="Bộ phận bán hàng": KHÔNG thấy PHF100 (current_department=Kế toán, khác branch filter không áp dụng ở đây)', async () => {
    assert.ok(!exportBH.forms.some(f => f.employeeCode === 'PHF100'));
  });
  await record('8c. department="Bộ phận bán hàng": PHF200 KHÔNG xuất hiện dù snapshot department là Bán hàng, vì current_department đã đổi sang Kế toán', async () => {
    assert.ok(!exportBH.forms.some(f => f.employeeCode === 'PHF200'), 'phải lọc theo current_department, không phải department snapshot đóng băng trên form');
  });

  const exportBHLaiThieu = await monthlyLib.exportMonthlyData(ADMIN_SESSION, { month: PERIOD, department: BH, branch: 'Lái Thiêu' });
  await record('8d. department="Bán hàng" + branch="Lái Thiêu" (AND): đúng 2 dòng PHF092+PHF041, không lẫn PHF100 (khác phòng ban, cùng branch)', async () => {
    const codes = exportBHLaiThieu.forms.map(f => f.employeeCode).sort();
    assert.deepStrictEqual(codes, ['PHF041', 'PHF092']);
  });

  const exportKT = await monthlyLib.exportMonthlyData(ADMIN_SESSION, { month: PERIOD, department: KT });
  await record('8e. department="Kế toán": thấy PHF100 (current+snapshot đều Kế toán) và PHF200 (current đã chuyển sang Kế toán dù snapshot vẫn Bán hàng)', async () => {
    const codes = exportKT.forms.map(f => f.employeeCode).sort();
    assert.deepStrictEqual(codes, ['PHF100', 'PHF200']);
  });

  await record('8f. Mỗi dòng xuất vẫn giữ RIÊNG cả snapshot (department/branch) LẪN current (currentDepartment/currentBranch) - không gộp/ghi đè nhau', async () => {
    const row = exportKT.forms.find(f => f.employeeCode === 'PHF200');
    assert.strictEqual(row.department, BH, 'snapshot department trên phiếu vẫn phải là Bán hàng (đóng băng)');
    assert.strictEqual(row.currentDepartment, KT, 'currentDepartment phải là Kế toán (tổ chức hiện tại)');
    assert.strictEqual(row.branch, 'Phú Lợi', 'snapshot branch giữ nguyên');
    assert.strictEqual(row.currentBranch, 'Phú Lợi');
  });

  await record('8g. filters trả về trong response phản ánh đúng department đã lọc', async () => {
    assert.strictEqual(exportKT.filters.department, KT);
  });

  await record('8h. Không filter department (mặc định "Tất cả phòng ban"): thấy đủ cả 4 người', async () => {
    const exportAll = await monthlyLib.exportMonthlyData(ADMIN_SESSION, { month: PERIOD });
    const codes = exportAll.forms.map(f => f.employeeCode).sort();
    assert.deepStrictEqual(codes, ['PHF041', 'PHF092', 'PHF100', 'PHF200']);
  });

  await record('9. checklist_monthly_forms trong store hoàn toàn không bị thay đổi bởi exportMonthlyData (chỉ đọc, không ghi đè branch/department/title)', async () => {
    assert.deepStrictEqual(store.checklist_monthly_forms, formsBefore);
  });

  const failed = results.filter(r => !r.pass);
  console.log('\n=== Kết quả ===');
  console.log(results.length - failed.length + '/' + results.length + ' bước PASS.');
  console.log('\nToàn bộ chạy trên mock trong bộ nhớ — không có ghi nào xuống database thật.');
  console.log('Chạy thủ công khi cần: node scripts/test-checklist-monthly-department-filter-backend.js');
  if (failed.length) process.exit(1);
}

main();
