'use strict';
/* AR-05 regression: subjectMatchesScope() la SOURCE OF TRUTH duy nhat cho
   viec "nhan su co thuoc scope phan quyen nay khong" - dung chung boi
   lib/checklist-permissions.js (view_monthly/review_monthly/view_reports/
   export_data) VA lib/checklist-violations.js (view_violations/
   record_violation) tu sau AR-05. Truoc do moi file tu viet mot ban rieng,
   lech nhau ve 'employees' (so nhieu) va tag department::/branch:: -> Silent
   Denial cho Ghi nhan loi/Nhat ky loi (AR-04).

   File nay test THANG lib/checklist-scope.js, khong qua Supabase/mock DB -
   du lieu la fixture nhan su thuc te ve HINH DANG (khop dung du lieu
   Production tagged that xac minh o AR-04), khong phai du lieu gia cu lay
   lai tu file test khac. */

const { subjectMatchesScope } = require('../lib/checklist-scope');

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}

// Nhan su fixture - hinh dang giong Production that (department co dau,
// nhieu chi nhanh, co nguoi ngoai pham vi de kiem tra khong lo).
const NV001_SALES_PHU_LOI = { employee_code: 'NV001', employee_id: 'id-001', department: 'Bộ phận bán hàng', branch: 'Phú Lợi', manager_id: 'mgr-tc01', manager_code: 'TC01' };
const NV002_SALES_NGO_QUYEN = { employee_code: 'NV002', employee_id: 'id-002', department: 'Bộ phận bán hàng', branch: 'Ngô Quyền', manager_id: 'mgr-tc01', manager_code: 'TC01' };
const NV003_WAREHOUSE_PHU_LOI = { employee_code: 'NV003', employee_id: 'id-003', department: 'Kho', branch: 'Phú Lợi', manager_id: 'mgr-ql01', manager_code: 'QL01' };
const NV004_SALES_THU_DAU_MOT = { employee_code: 'NV004', employee_id: 'id-004', department: 'Bộ phận bán hàng', branch: 'Thủ Dầu Một', manager_id: 'mgr-ql01', manager_code: 'QL01' };

console.log('== 1. department_branch (tagged, dung hinh dang Production that - TRUONG_CA_BH) ==');
{
  const scope = { type: 'department_branch', values: ['department::Bộ phận bán hàng', 'branch::Phú Lợi', 'branch::Ngô Quyền', 'branch::Lái Thiêu'] };
  check(subjectMatchesScope(NV001_SALES_PHU_LOI, scope, {}) === true, 'NV001 (Ban hang/Phu Loi, co trong tag) -> khop');
  check(subjectMatchesScope(NV002_SALES_NGO_QUYEN, scope, {}) === true, 'NV002 (Ban hang/Ngo Quyen, co trong tag) -> khop');
  check(subjectMatchesScope(NV003_WAREHOUSE_PHU_LOI, scope, {}) === false, 'NV003 (Kho, sai phong ban) -> KHONG khop (khong lo)');
  check(subjectMatchesScope(NV004_SALES_THU_DAU_MOT, scope, {}) === false, 'NV004 (Ban hang nhung sai chi nhanh Thu Dau Mot, ngoai tag) -> KHONG khop (khong lo)');
}

console.log('== 2. employees (so nhieu - dung chuan) ==');
{
  const scope = { type: 'employees', values: ['NV001', 'NV002'] };
  check(subjectMatchesScope(NV001_SALES_PHU_LOI, scope, {}) === true, 'NV001 co trong danh sach employees -> khop');
  check(subjectMatchesScope(NV002_SALES_NGO_QUYEN, scope, {}) === true, 'NV002 co trong danh sach employees -> khop');
  check(subjectMatchesScope(NV003_WAREHOUSE_PHU_LOI, scope, {}) === false, 'NV003 khong trong danh sach -> KHONG khop');
}

console.log('== 3. department ==');
{
  const scope = { type: 'department', values: ['Bộ phận bán hàng'] };
  check(subjectMatchesScope(NV001_SALES_PHU_LOI, scope, {}) === true, 'NV001 dung phong ban -> khop');
  check(subjectMatchesScope(NV003_WAREHOUSE_PHU_LOI, scope, {}) === false, 'NV003 (Kho) sai phong ban -> KHONG khop');
}

console.log('== 4. branch ==');
{
  const scope = { type: 'branch', values: ['Phú Lợi'] };
  check(subjectMatchesScope(NV001_SALES_PHU_LOI, scope, {}) === true, 'NV001 dung chi nhanh -> khop');
  check(subjectMatchesScope(NV002_SALES_NGO_QUYEN, scope, {}) === false, 'NV002 sai chi nhanh -> KHONG khop');
}

console.log('== 5. direct_reports ==');
{
  const scope = { type: 'direct_reports', values: [] };
  check(subjectMatchesScope(NV001_SALES_PHU_LOI, scope, { employeeCode: 'TC01' }) === true, 'NV001 bao cao cho TC01 -> khop khi identity = TC01');
  check(subjectMatchesScope(NV003_WAREHOUSE_PHU_LOI, scope, { employeeCode: 'TC01' }) === false, 'NV003 bao cao cho QL01, khong phai TC01 -> KHONG khop');
  check(subjectMatchesScope(NV001_SALES_PHU_LOI, scope, { id: 'mgr-tc01' }) === true, 'Khop qua manager_id khi identity dung id (khong chi employeeCode)');
}

console.log('== 6. all_company ==');
{
  const scope = { type: 'all_company', values: [] };
  check(subjectMatchesScope(NV001_SALES_PHU_LOI, scope, {}) === true, 'all_company khop moi nhan su - NV001');
  check(subjectMatchesScope(NV003_WAREHOUSE_PHU_LOI, scope, {}) === true, 'all_company khop moi nhan su - NV003');
}

console.log('== 7. legacy "employee" (so it, khong con la type chuan sau AR-05) ==');
{
  // Truoc AR-05, hoc-vien role hardcode scopeType='employee' (so it). Sau
  // AR-05, khong noi nao trong code con phat sinh gia tri nay - nhung neu du
  // lieu cu/hong con sot lai type nay, matcher phai TU CHOI AN TOAN, khong
  // duoc vo tinh khop nham sang 'employees' hay throw lam sap request.
  const scope = { type: 'employee', values: ['NV001'] };
  check(subjectMatchesScope(NV001_SALES_PHU_LOI, scope, {}) === false, 'type "employee" (so it, khong hop le) -> KHONG khop, tu choi an toan, khong throw');
}

console.log('== 8. department_branch malformed -> FAIL dung (tu choi, khong throw, khong lo) ==');
{
  const scopeNullValues = { type: 'department_branch', values: null };
  check(subjectMatchesScope(NV001_SALES_PHU_LOI, scopeNullValues, {}) === false, 'values=null (khong phai mang) -> KHONG khop');

  const scopeNoValues = { type: 'department_branch' };
  check(subjectMatchesScope(NV001_SALES_PHU_LOI, scopeNoValues, {}) === false, 'thieu key values -> KHONG khop');

  const scopeGarbage = { type: 'department_branch', values: ['##khong-phai-phong-ban-hay-chi-nhanh##'] };
  check(subjectMatchesScope(NV001_SALES_PHU_LOI, scopeGarbage, {}) === false, 'values la chuoi rac, khong tag, khong khop tu khoa phong ban -> KHONG khop');

  const scopeNull = null;
  check(subjectMatchesScope(NV001_SALES_PHU_LOI, scopeNull, {}) === false, 'scopeValue = null hoan toan -> KHONG khop (khong throw)');
}

if (failures) {
  console.error('\n' + failures + ' check(s) failed.');
  process.exit(1);
}
console.log('\nAll checks passed.');
