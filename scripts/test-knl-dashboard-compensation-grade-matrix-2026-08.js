'use strict';

/*
 * Backend contract/security regression for Dashboard compensation-grade matrix.
 * In-memory Supabase only: no production/external access.
 *
 * Effective Snapshot / Carry-Forward (cập nhật): E6 chỉ có row OFFICIAL ở
 * 2026-07, không có row 2026-08 — ĐÃ TỪNG là "unassigned" trong ma trận
 * 08/2026 dưới logic exact-period cũ, giờ carry-forward đúng từ 07/2026 nên
 * PHẢI resolve thành assigned (không đổi gì thật sự, nên không được coi là
 * "thiếu"). Test cũ cho '2026-09' (kỳ hoàn toàn không ai ghi dòng mới,
 * period > mọi dữ liệu) trước đây expect ma trận trống — giờ carry-forward
 * đúng từ 08/2026, KHÔNG còn trống; test đã tách thành 2: 1 kỳ THẬT SỰ
 * trước mọi dữ liệu ('2026-01', vẫn phải trống — không có gì để carry-forward
 * từ trước khi hệ thống có dữ liệu) + 1 assertion mới xác nhận carry-forward
 * hoạt động đúng cho '2026-09'. July vẫn giữ nguyên "không được áp ngược dữ
 * liệu August" — đây chính là ranh giới an toàn bắt buộc của resolver
 * (payroll_period <= selectedPeriod), không đổi.
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const assert = require('assert');
const supabasePath = require.resolve('@supabase/supabase-js');
const peoplePath = require.resolve('../api/_lib/knl-people');
const permissionsPath = require.resolve('../api/_lib/knl-permissions');
const scopePath = require.resolve('../api/_lib/knl-scope');
const dashboardPath = require.resolve('../api/_lib/knl-dashboard');

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function employee(code, name, department, title, branch = 'Chi nhánh 1') {
  return { employee_id: 'id-' + code, employee_code: code, full_name: name, title, position: title, department, branch, manager_employee_code: '', employment_status: 'active' };
}
function official(code, period, ladderCode, ladderName, gradeNumber, referenceTotal) {
  return {
    employee_code: code,
    payroll_period: period,
    employment_type: 'OFFICIAL',
    compensation_grade_id: 'grade-' + ladderCode + '-' + gradeNumber,
    structure_snapshot: {
      ladderCode,
      ladderName,
      gradeCode: ladderCode + '-B' + gradeNumber,
      gradeNumber,
      versionId: 'version-' + period + '-' + ladderCode,
      versionNumber: period === '2026-08' ? 2 : 1,
      effectivePeriod: period
    },
    reference_total: referenceTotal
  };
}

const EMPLOYEES = [
  employee('E1', 'An', 'Kinh doanh', 'Nhân viên bán hàng'),
  employee('e1', 'An bản trùng', 'Kinh doanh', 'Nhân viên bán hàng'),
  employee('E2', 'Bình', 'Kinh doanh', 'Nhân viên bán hàng'),
  employee('E3', 'Chi', 'Kinh doanh', 'Trưởng nhóm'),
  employee('E4', 'Dung', 'Kinh doanh', 'Nhân viên online'),
  employee('E5', 'Giang', 'Kho vận', 'Nhân viên kho'),
  employee('E6', 'Hà', 'Kho vận', 'Nhân viên kho'),
  employee('E7', 'Khanh', 'Kho vận', 'Thử việc'),
  employee('E8', 'Lan', 'Tài chính', 'Kế toán')
];

const ASSIGNMENTS = [
  official('E1', '2026-07', 'SALE', 'Ngạch Bán hàng', 3, 9000000),
  official('E1', '2026-08', 'SALE', 'Ngạch Bán hàng', 1, 9500000),
  official('E2', '2026-08', 'SALE', 'Ngạch Bán hàng', 3, 10000000),
  official('E3', '2026-08', 'SALE', 'Ngạch Bán hàng', 5, 12000000),
  official('E4', '2026-08', 'ONLINE', 'Ngạch Bán hàng Online', 5, 11000000),
  official('E5', '2026-08', 'WAREHOUSE', 'Ngạch Nhân viên Kho', 8, 10500000),
  official('E6', '2026-07', 'WAREHOUSE', 'Ngạch Nhân viên Kho', 1, 8500000),
  {
    employee_code: 'E7', payroll_period: '2026-07', employment_type: 'PROBATION',
    compensation_grade_id: null, structure_snapshot: { employmentType: 'PROBATION' }, reference_total: 6500000
  },
  {
    employee_code: 'E7', payroll_period: '2026-08', employment_type: 'PROBATION',
    compensation_grade_id: null, structure_snapshot: { employmentType: 'PROBATION' }, reference_total: 6800000
  },
  official('E8', '2026-08', 'FIN', 'Ngạch Kế toán', 3, 14000000)
];

const COMPETENCY = EMPLOYEES.map((row, index) => ({
  employee_code: row.employee_code,
  is_active: true,
  grade_snapshot: { frameworkCode: index % 2 ? 'FW_B' : 'FW_A', frameworkName: 'Bộ KNL', gradeCode: index % 2 ? 'B2' : 'B1', label: index % 2 ? 'Bậc 2' : 'Bậc 1' }
}));

const STATE = { grants: [], employees: clone(EMPLOYEES), assignments: clone(ASSIGNMENTS).map(r => Object.assign({ status: 'ACTIVE' }, r)), competency: clone(COMPETENCY), queries: [] };

function tableFactory(table, rows) {
  const filters = [];
  let inFilter = null;
  let limitN = null;
  let singleMode = false;
  const query = {
    select(columns) { STATE.queries.push({ table, columns: String(columns || '*') }); return query; },
    eq(field, value) { filters.push(row => String(row[field]) === String(value)); return query; },
    in(field, values) { inFilter = { field, values: values.map(value => String(value).toUpperCase()) }; STATE.queries.push({ table, inField: field, inValues: inFilter.values.slice() }); return query; },
    order() { return query; },
    limit(value) { limitN = value; return query; },
    maybeSingle() { singleMode = true; return query; },
    then(resolve, reject) {
      try {
        let result = rows.filter(row => filters.every(filter => filter(row)));
        if (inFilter) result = result.filter(row => inFilter.values.includes(String(row[inFilter.field]).toUpperCase()));
        if (limitN != null) result = result.slice(0, limitN);
        resolve({ data: clone(singleMode ? (result[0] || null) : result), error: null });
      } catch (error) { (reject || (reason => Promise.reject(reason)))(error); }
    }
  };
  return query;
}

function buildSupabaseMock() {
  return {
    createClient() {
      return {
        from(table) {
          if (table === 'knl_permission_grants') return tableFactory(table, STATE.grants);
          if (table === 'employee_profiles') return tableFactory(table, STATE.employees);
          if (table === 'knl_employee_compensation_assignments') return tableFactory(table, STATE.assignments);
          if (table === 'knl_employee_competency_assignments') return tableFactory(table, STATE.competency);
          throw new Error('Unexpected table: ' + table);
        }
      };
    }
  };
}

function loadDashboardWithMock() {
  const originalCache = require.cache[supabasePath];
  [peoplePath, permissionsPath, scopePath, dashboardPath].forEach(path => delete require.cache[path]);
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
  const dashboard = require(dashboardPath);
  if (originalCache) require.cache[supabasePath] = originalCache;
  else delete require.cache[supabasePath];
  return dashboard;
}

function grant(id, capabilities, peopleScope = { type: 'all_company', values: [] }) {
  STATE.grants.push({ id: 'grant-' + id, account_id: id, is_active: true, preset_code: 'CUSTOM', capabilities, people_scope: peopleScope });
}
function session(id, role = 'learner') { return { role, account: { id, employeeCode: id.toUpperCase() }, employeeCode: id.toUpperCase() }; }
function findDepartment(matrix, name) { return matrix.departments.find(row => row.department === name); }
function findLadder(department, code) { return department.ladders.find(row => row.ladderCode === code); }
function findGrade(ladder, number) { return ladder.grades.find(row => row.gradeNumber === number); }
function codes(people) { return people.map(row => String(row.employeeCode).toUpperCase()).sort(); }

grant('director', { dashboard_view: true, income_view: true, incomeScope: { type: 'all_company', values: [] } });
grant('tien', { dashboard_view: true, income_view: true, incomeScope: { type: 'department', values: ['Kinh doanh'] } });
grant('no-income', { dashboard_view: true, income_view: false });
grant('no-dashboard', { dashboard_view: false, income_view: true, incomeScope: { type: 'all_company', values: [] } });
grant('employee', { dashboard_view: true, income_view: false }, { type: 'self', values: [] });

const { getKnlDashboardOverview } = loadDashboardWithMock();

async function run() {
  STATE.queries.length = 0;
  await assert.rejects(() => getKnlDashboardOverview(session('no-dashboard')), error => error && error.statusCode === 403 && error.code === 'KNL_DASHBOARD_VIEW_DENIED');
  assert.strictEqual(STATE.queries.some(query => query.table === 'knl_employee_compensation_assignments'), false, 'No dashboard_view must stop before compensation query');

  STATE.queries.length = 0;
  const noIncome = await getKnlDashboardOverview(session('no-income'));
  const noIncomeJson = JSON.stringify(noIncome);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(noIncome, 'compensationGradeMatrix'), false, 'No income_view must omit compensationGradeMatrix');
  assert.strictEqual(STATE.queries.some(query => query.table === 'knl_employee_compensation_assignments'), false, 'No income_view must not query compensation assignments');
  assert(!noIncomeJson.includes('ladderCode') && !noIncomeJson.includes('ladderName') && !noIncomeJson.includes('compensationGradeMatrix'), 'No-income payload must not contain ladder/compensation-grade fields');

  const admin = await getKnlDashboardOverview(session('admin-1', 'admin'));
  const director = await getKnlDashboardOverview(session('director'));
  assert.deepStrictEqual(director.compensationGradeMatrix, admin.compensationGradeMatrix, 'Director all_company grant must match admin recovery scope');
  assert.deepStrictEqual(admin.compensationGradeMatrix.gradeNumbers, [1, 3, 5, 8], 'Dynamic grade headers must contain only actual grade numbers, sorted');
  assert.strictEqual(admin.compensationGradeMatrix.unassignedCount, 0, 'E6 has no 2026-08 row but carries forward its 2026-07 OFFICIAL grade unchanged — must NOT be unassigned');
  assert.strictEqual(admin.compensationGradeMatrix.departments.reduce((sum, row) => sum + row.total, 0), 7, 'Official matrix population excludes probation and case-variant duplicate');
  assert(admin.compensationGradeMatrix.departments.every(row => row.assigned + row.unassigned === row.total), 'Every department must reconcile assigned + unassigned = total');

  const sales = findDepartment(admin.compensationGradeMatrix, 'Kinh doanh');
  const warehouse = findDepartment(admin.compensationGradeMatrix, 'Kho vận');
  assert.strictEqual(sales.ladders.length, 2, 'Multi-ladder department must preserve separate ladder rows');
  assert.strictEqual(warehouse.ladders.length, 1, 'Single-ladder department must stay direct');
  assert.deepStrictEqual(codes(findGrade(findLadder(warehouse, 'WAREHOUSE'), 1).people), ['E6'], 'E6 must appear in WAREHOUSE grade 1 via carry-forward from its 2026-07 assignment, not vanish from the matrix');
  assert.deepStrictEqual(codes(findGrade(findLadder(warehouse, 'WAREHOUSE'), 8).people), ['E5'], 'E5 (explicit 2026-08 row) must still resolve normally alongside the carried-forward E6');
  assert.deepStrictEqual(codes(findGrade(findLadder(sales, 'SALE'), 5).people), ['E3'], 'SALE grade 5 must contain only E3');
  assert.deepStrictEqual(codes(findGrade(findLadder(sales, 'ONLINE'), 5).people), ['E4'], 'ONLINE grade 5 must contain only E4');
  assert.strictEqual(codes(findGrade(findLadder(sales, 'SALE'), 1).people).filter(code => code === 'E1').length, 1, 'Case-variant employee code must be deduped');
  assert(!admin.compensationGradeMatrix.departments.some(row => row.ladders.some(ladder => ladder.people.some(person => person.employeeCode === 'E7'))), 'PROBATION must not appear in a grade/ladder cell');

  const publicPerson = findGrade(findLadder(sales, 'SALE'), 1).people[0];
  assert.deepStrictEqual(Object.keys(publicPerson).sort(), ['employeeCode', 'employeeName', 'title'], 'Quick-panel person payload must expose only the approved fields');
  assert(!JSON.stringify(admin.compensationGradeMatrix).includes('reference_total') && !JSON.stringify(admin.compensationGradeMatrix).includes('baseSalary'), 'Matrix contract must not expose salary amounts');

  STATE.queries.length = 0;
  const tien = await getKnlDashboardOverview(session('tien'));
  assert.deepStrictEqual(tien.compensationGradeMatrix.departments.map(row => row.department), ['Kinh doanh'], 'Income scope narrower than peopleScope must drive the matrix');
  assert.strictEqual(tien.compensationGradeMatrix.departments[0].total, 4, 'Tien scope count must reconcile to four unique sales employees');
  assert.strictEqual(tien.compensationGradeMatrix.departments[0].assigned, 4, 'All four sales employees have exact-period grades');
  const tienCompensationQuery = STATE.queries.find(query => query.table === 'knl_employee_compensation_assignments' && query.inField === 'employee_code');
  assert.deepStrictEqual(tienCompensationQuery.inValues.sort(), ['E1','E2','E3','E4'], 'Compensation DB query itself must contain only incomeScope employee codes, not company-wide codes');

  const craftedDepartment = await getKnlDashboardOverview(session('tien'), { department: 'Tài chính' });
  assert.deepStrictEqual(craftedDepartment.compensationGradeMatrix.gradeNumbers, [], 'Crafted out-of-scope department must return no grade columns');
  assert.deepStrictEqual(craftedDepartment.compensationGradeMatrix.departments, [], 'Crafted out-of-scope department must not fall back to company data');
  const craftedBranch = await getKnlDashboardOverview(session('tien'), { branch: 'Chi nhánh ngoài scope' });
  assert.deepStrictEqual(craftedBranch.compensationGradeMatrix.departments, [], 'Crafted out-of-scope branch must not leak');
  const craftedTitle = await getKnlDashboardOverview(session('tien'), { title: 'Giám đốc ngoài scope' });
  assert.deepStrictEqual(craftedTitle.compensationGradeMatrix.departments, [], 'Crafted out-of-scope title must not leak');
  const craftedTuple = await getKnlDashboardOverview(session('tien'), { ladderCode: 'FIN', gradeNumber: 3 });
  assert.deepStrictEqual(craftedTuple.compensationGradeMatrix.departments.map(row => row.department), ['Kinh doanh'], 'Crafted ladder/grade fields must not expand the backend-scoped dataset');

  const july = await getKnlDashboardOverview(session('tien'), { period: '2026-07' });
  assert.strictEqual(july.compensationGradeMatrix.period, '2026-07', 'Requested period must be preserved exactly');
  assert.deepStrictEqual(july.compensationGradeMatrix.gradeNumbers, [3], 'July must use July snapshot and must not apply August grades backwards');
  assert.deepStrictEqual(codes(findGrade(findLadder(findDepartment(july.compensationGradeMatrix, 'Kinh doanh'), 'SALE'), 3).people), ['E1'], 'July grade tuple must resolve E1 only');
  assert.strictEqual(july.compensationGradeMatrix.unassignedCount, 3, 'July must not silently use each employee latest assignment');
  // Kỳ THẬT SỰ trước mọi dữ liệu (2026-01, trước cả 2026-07) — không có gì để
  // carry-forward, ma trận phải trống thật, không bịa.
  const beforeAnyData = await getKnlDashboardOverview(session('tien'), { period: '2026-01' });
  assert.strictEqual(beforeAnyData.compensationGradeMatrix.period, '2026-01', 'Requested period must be preserved exactly');
  assert.deepStrictEqual(beforeAnyData.compensationGradeMatrix.gradeNumbers, [], 'Period before any data exists must have no invented grade headers — nothing to carry-forward from');
  assert.deepStrictEqual(beforeAnyData.compensationGradeMatrix.departments.every(row => row.assigned === 0), true, 'Period before any data exists: everyone genuinely unassigned, not a carry-forward gap');

  // 2026-09 — không ai ghi dòng mới, nhưng 2026-08 vẫn <= 2026-09 nên PHẢI
  // carry-forward đúng (đây chính là rule đã chốt: không đổi gì = tiếp tục
  // phản ánh cơ cấu cũ, KHÔNG phải "thiếu dữ liệu").
  const carriedForward = await getKnlDashboardOverview(session('tien'), { period: '2026-09' });
  assert.strictEqual(carriedForward.compensationGradeMatrix.period, '2026-09', 'Requested period must be preserved exactly');
  assert.deepStrictEqual(carriedForward.compensationGradeMatrix.gradeNumbers, [1, 3, 5], 'No-change month must carry forward the same grades as the last real change (2026-08), not go empty');
  assert.deepStrictEqual(codes(findGrade(findLadder(findDepartment(carriedForward.compensationGradeMatrix, 'Kinh doanh'), 'SALE'), 1).people), ['E1'], 'E1 must carry forward its 2026-08 grade (1) into 2026-09, not lose it');
  assert.strictEqual(carriedForward.compensationGradeMatrix.unassignedCount, 0, '2026-09 must be fully resolved via carry-forward — nobody genuinely missing');

  const employeePayload = await getKnlDashboardOverview(session('employee'));
  assert.strictEqual(Object.prototype.hasOwnProperty.call(employeePayload, 'compensationGradeMatrix'), false, 'Direct employee endpoint call must not receive compensation grades');

  console.log('ALL PASS — Dashboard compensation grade matrix backend/security');
}

run().catch(error => { console.error(error); process.exit(1); });
