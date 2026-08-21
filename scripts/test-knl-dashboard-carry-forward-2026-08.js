'use strict';

/*
 * Effective Snapshot / Carry-Forward — test matrix canonical, đầy đủ 12 mục
 * bắt buộc theo business rule đã chốt (supersede Gate 2 "exact-period"):
 * "nếu sang kỳ mới nhân sự không có thay đổi thì trạng thái/bậc/cơ cấu thu
 * nhập có hiệu lực trước đó phải tiếp tục được phản ánh — không được coi là
 * thiếu dữ liệu chỉ vì không có assignment row đúng tháng đang xem."
 *
 * Canonical resolver: lib/knl-dashboard.js:resolveEffectiveCompensationMap —
 * chỉ status=ACTIVE, chỉ payroll_period<=selectedPeriod, chọn payroll_period
 * lớn nhất. Dùng chung cho KPI/matrix/coverage/trend/range — file này xác
 * nhận CẢ 4 điểm cùng đồng bộ số liệu, không lệch nhau.
 *
 * In-memory Supabase mock only — KHÔNG chạm Production, KHÔNG migration,
 * KHÔNG copy/materialize row nào (chỉ đọc read-time).
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const peoplePath = require.resolve('../api/_lib/knl-people');
const permissionsPath = require.resolve('../api/_lib/knl-permissions');
const scopePath = require.resolve('../api/_lib/knl-scope');
const dashboardPath = require.resolve('../api/_lib/knl-dashboard');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function ym(offsetMonths) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offsetMonths);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  return y + '-' + (m < 10 ? '0' + m : '' + m);
}

function makeTableFactory(rows) {
  return function tableQuery() {
    const filters = [];
    let orderSpecs = [], limitN = null, inFilter = null, singleMode = null;
    const q = {
      select() { return q; },
      eq(f, v) { filters.push(r => String(r[f]) === String(v)); return q; },
      in(f, values) { inFilter = { f, values: values.map(String) }; return q; },
      order(f, o) { orderSpecs.push({ f, asc: !(o && o.ascending === false) }); return q; },
      limit(n) { limitN = n; return q; },
      maybeSingle() { singleMode = 'maybe'; return q; },
      single() { singleMode = 'single'; return q; },
      then(resolve, reject) {
        try {
          let matched = rows.filter(r => filters.every(fn => fn(r)));
          if (inFilter) matched = matched.filter(r => inFilter.values.includes(String(r[inFilter.f])));
          orderSpecs.forEach(spec => { matched = matched.slice().sort((a, b) => (a[spec.f] < b[spec.f] ? -1 : a[spec.f] > b[spec.f] ? 1 : 0) * (spec.asc ? 1 : -1)); });
          if (limitN != null) matched = matched.slice(0, limitN);
          if (singleMode) { resolve({ data: clone(matched[0] || null), error: null }); return; }
          resolve({ data: clone(matched), error: null });
        } catch (e) { (reject || (err => Promise.reject(err)))(e); }
      }
    };
    return q;
  };
}

const EMPLOYEES = [];
for (let i = 1; i <= 6; i++) EMPLOYEES.push({ employee_id: 'e-' + i, employee_code: 'SALE' + String(i).padStart(2, '0'), full_name: 'NV ' + i, title: 'Nhân viên', position: null, department: 'Kinh doanh', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' });
const ALL_CODES = EMPLOYEES.map(e => e.employee_code);

function officialAssignment(code, period, opts) {
  opts = opts || {};
  const gradeNumber = opts.gradeNumber || 2;
  const ladderCode = opts.ladderCode || 'SALE';
  return {
    employee_code: code, payroll_period: period, employment_type: 'OFFICIAL', status: opts.status || 'ACTIVE',
    compensation_grade_id: 'grade-' + ladderCode + '-' + gradeNumber,
    structure_snapshot: { ladderCode, ladderName: 'Ngạch ' + ladderCode, gradeCode: ladderCode + '-B' + gradeNumber, gradeNumber, versionId: 'v-' + period, versionNumber: 1, effectivePeriod: period },
    reference_total: opts.total || 10000000
  };
}
function assignmentsForPeriod(period, codes, total) {
  return codes.map(code => officialAssignment(code, period, { total }));
}

const STATE = { grants: [], employees: EMPLOYEES, assignments: [], competency: [] };

function buildSupabaseMock() {
  return {
    createClient() {
      return {
        from(table) {
          if (table === 'knl_permission_grants') return makeTableFactory(STATE.grants)();
          if (table === 'employee_profiles') return makeTableFactory(STATE.employees)();
          if (table === 'knl_employee_compensation_assignments') return makeTableFactory(STATE.assignments)();
          if (table === 'knl_employee_competency_assignments') return makeTableFactory(STATE.competency)();
          throw new Error('Unexpected table in mock: ' + table);
        },
        rpc() { throw new Error('RPC not mocked (write path out of scope)'); }
      };
    }
  };
}

function loadLibsWithMock() {
  const Module = require('module');
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === '@supabase/supabase-js') return supabasePath;
    return originalResolve.call(this, request, ...rest);
  };
  try {
    [peoplePath, permissionsPath, scopePath, dashboardPath].forEach(p => delete require.cache[p]);
    require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
    return require(dashboardPath);
  } finally {
    Module._resolveFilename = originalResolve;
  }
}

function grant(id, capabilities, peopleScope = { type: 'all_company', values: [] }) {
  STATE.grants.push({ id: 'grant-' + id, account_id: id, is_active: true, preset_code: 'CUSTOM', capabilities, people_scope: peopleScope });
}
function session(id) { return { role: 'learner', account: { id, employeeCode: id.toUpperCase() }, employeeCode: id.toUpperCase() }; }

grant('director', { dashboard_view: true, income_view: true, incomeScope: { type: 'all_company', values: [] } });
grant('noincome', { dashboard_view: true, income_view: false });

const { getKnlDashboardOverview } = loadLibsWithMock();

let failures = 0;
function check(condition, message) { if (!condition) { console.error('FAIL: ' + message); failures++; } else console.log('PASS: ' + message); }

function findDepartment(matrix, name) { return matrix.departments.find(row => row.department === name); }
function findLadder(department, code) { return department.ladders.find(row => row.ladderCode === code); }
function findGrade(ladder, number) { return ladder.grades.find(row => row.gradeNumber === number); }

async function run() {
  const M2 = ym(-2), M1 = ym(-1), M0 = ym(0);

  // ===== 1. 08 có row, 09 không đổi → 09 carry-forward 08 =====
  STATE.assignments = assignmentsForPeriod(M1, ALL_CODES, 10000000);
  const t1 = await getKnlDashboardOverview(session('director'), { period: M0 });
  check(t1.meta.currentPeriodStatus === 'complete', '1.1 Kỳ M0 (không ai ghi dòng mới) vẫn complete nhờ carry-forward từ M1');
  check(t1.kpis.totalFund === 6 * 10000000, '1.2 KPI totalFund tại M0 = đúng số carry-forward từ M1, không phải 0');
  check(t1.kpis.totalHeadcount === 6, '1.3 totalHeadcount không đổi (headcount đến từ Organization Master, độc lập compensation)');

  // ===== 2. Carry-forward nhiều tháng liên tiếp (chỉ 1 row rất xa, carry qua nhiều kỳ) =====
  STATE.assignments = assignmentsForPeriod(ym(-5), ALL_CODES, 7000000);
  const t2a = await getKnlDashboardOverview(session('director'), { period: ym(-3) });
  const t2b = await getKnlDashboardOverview(session('director'), { period: ym(-1) });
  const t2c = await getKnlDashboardOverview(session('director'), { period: M0 });
  check(t2a.kpis.totalFund === 6 * 7000000 && t2b.kpis.totalFund === 6 * 7000000 && t2c.kpis.totalFund === 6 * 7000000, '2.1 Carry-forward xuyên suốt nhiều kỳ liên tiếp (2,4,5 tháng sau) đều ra đúng số gốc, không suy giảm/mất dữ liệu');
  check(t2a.meta.currentPeriodStatus === 'complete' && t2b.meta.currentPeriodStatus === 'complete' && t2c.meta.currentPeriodStatus === 'complete', '2.2 Mọi kỳ carry-forward xa đều được đánh complete đúng');

  // ===== 3. Genuinely missing (chưa từng có ACTIVE assignment nào) =====
  STATE.assignments = assignmentsForPeriod(M1, ALL_CODES.slice(0, 4), 10000000); // 2 người chưa từng được gán
  const t3 = await getKnlDashboardOverview(session('director'), { period: M0 });
  check(t3.meta.currentPeriodStatus === 'partial' && t3.meta.coveredCount === 4 && t3.meta.missingCount === 2, '3.1 2 người chưa từng có ACTIVE assignment nào -> genuinely missing thật, không carry-forward được, coverage phản ánh đúng 4/6');
  const missingDrillDown = t3.drillDown['Kinh doanh'].find(r => r.employeeCode === 'SALE05');
  check(missingDrillDown && missingDrillDown.currentIncome === null, '3.2 Người genuinely missing hiển thị currentIncome=null, không bịa số 0 hay carry-forward giả');

  // ===== 4. VOIDED không được dùng làm nguồn carry-forward =====
  STATE.assignments = [
    officialAssignment('SALE01', M1, { total: 10000000, status: 'VOIDED' }), // đã bị void, KHÔNG được carry-forward
    ...assignmentsForPeriod(M1, ALL_CODES.slice(1), 10000000) // 5 người còn lại vẫn ACTIVE bình thường
  ];
  const t4 = await getKnlDashboardOverview(session('director'), { period: M0 });
  check(t4.meta.coveredCount === 5 && t4.meta.missingCount === 1, '4.1 Row VOIDED của SALE01 KHÔNG được dùng carry-forward — SALE01 tính là missing dù có row lịch sử (đã void)');
  const voidedDrillDown = t4.drillDown['Kinh doanh'].find(r => r.employeeCode === 'SALE01');
  check(voidedDrillDown && voidedDrillDown.currentIncome === null, '4.2 SALE01 (chỉ có row VOIDED) hiển thị currentIncome=null, không lộ số liệu đã bị void');

  // ===== 5. Correction X→Y: sau correction, xem lại kỳ X không còn thấy structure sai =====
  // Mô phỏng đúng effect của knl_correct_employee_compensation_period(): void
  // source tại X, tạo target ACTIVE tại Y (copy nội dung). Dashboard xem lại
  // kỳ X sau correction phải KHÔNG còn thấy SALE01 ở X (đã void), và kỳ Y trở
  // đi phải thấy đúng structure đã copy.
  STATE.assignments = [
    officialAssignment('SALE01', M1, { total: 9500000, status: 'VOIDED', gradeNumber: 3 }), // source đã bị correction void
    officialAssignment('SALE01', M0, { total: 9500000, status: 'ACTIVE', gradeNumber: 3 }), // target ACTIVE, copy nguyên nội dung
    ...assignmentsForPeriod(M1, ALL_CODES.slice(1), 10000000),
    ...assignmentsForPeriod(M0, ALL_CODES.slice(1), 10000000)
  ];
  const t5Before = await getKnlDashboardOverview(session('director'), { period: M1 }); // xem lại kỳ NGUỒN sau correction
  const t5After = await getKnlDashboardOverview(session('director'), { period: M0 }); // xem kỳ ĐÍCH
  check(t5Before.meta.coveredCount === 5 && t5Before.meta.missingCount === 1, '5.1 Sau correction, xem lại kỳ nguồn (M1) không còn thấy SALE01 (source đã VOIDED) — tự sửa lịch sử đúng ý đồ correction');
  check(t5After.meta.coveredCount === 6 && t5After.meta.missingCount === 0, '5.2 Kỳ đích (M0) thấy đủ 6/6 — SALE01 đã có ACTIVE record đúng tại kỳ mới');
  const t5Grade = findGrade(findLadder(findDepartment(t5After.compensationGradeMatrix, 'Kinh doanh'), 'SALE'), 3);
  check(t5Grade && t5Grade.people.some(p => p.employeeCode === 'SALE01'), '5.3 Grade matrix tại kỳ đích phản ánh đúng structure đã copy từ correction (grade 3)');

  // ===== 6. Nhiều historical rows → chọn đúng latest <= period, không chọn nhầm row cũ hơn =====
  STATE.assignments = [
    officialAssignment('SALE01', ym(-6), { total: 8000000, gradeNumber: 1 }),
    officialAssignment('SALE01', M2, { total: 9000000, gradeNumber: 2 }),
    officialAssignment('SALE01', M1, { total: 9500000, gradeNumber: 3 }),
    ...assignmentsForPeriod(ym(-6), ALL_CODES.slice(1), 8000000)
  ];
  const t6 = await getKnlDashboardOverview(session('director'), { period: M0 });
  const t6Person = t6.drillDown['Kinh doanh'].find(r => r.employeeCode === 'SALE01');
  check(t6Person && t6Person.currentIncome === 9500000, '6.1 Với 3 historical row (xa/giữa/gần), phải chọn ĐÚNG row gần nhất <= M0 (9.5tr, kỳ M1), không chọn nhầm row cũ hơn (8tr/9tr)');
  const t6Grade = findGrade(findLadder(findDepartment(t6.compensationGradeMatrix, 'Kinh doanh'), 'SALE'), 3);
  check(t6Grade && t6Grade.people.some(p => p.employeeCode === 'SALE01'), '6.2 Grade matrix cũng chọn đúng bậc của row gần nhất (grade 3), không phải grade 1/2 của row cũ hơn');

  // ===== 7. Grade/framework snapshot giữ nguyên row lịch sử (không tự cập nhật theo bảng lương mới nhất) =====
  STATE.assignments = [officialAssignment('SALE01', M1, { total: 9000000, gradeNumber: 2, ladderCode: 'SALE' })];
  const t7 = await getKnlDashboardOverview(session('director'), { period: M0 });
  const t7Person = t7.drillDown['Kinh doanh'].find(r => r.employeeCode === 'SALE01');
  check(t7Person && t7Person.currentIncome === 9000000, '7.1 Carry-forward giữ NGUYÊN số tiền đã đóng băng trên row lịch sử (9tr), không tự tính lại theo bảng lương hiện hành');
  const t7Grade = findGrade(findLadder(findDepartment(t7.compensationGradeMatrix, 'Kinh doanh'), 'SALE'), 2);
  check(t7Grade && t7Grade.people.some(p => p.employeeCode === 'SALE01'), '7.2 Grade matrix carry-forward giữ nguyên gradeNumber=2 từ structure_snapshot lịch sử, không đọc lại grade master hiện hành');

  // ===== 8. KPI/matrix/trend/coverage cùng headcount (không lệch nhau) =====
  STATE.assignments = [].concat(
    assignmentsForPeriod(M2, ALL_CODES.slice(0, 5), 10000000), // 5/6, 1 người (SALE06) chưa từng gán
  );
  const t8 = await getKnlDashboardOverview(session('director'), { period: M0 });
  const matrixAssignedTotal = findDepartment(t8.compensationGradeMatrix, 'Kinh doanh').assigned;
  const trendLast = t8.trend[t8.trend.length - 1];
  check(t8.meta.coveredCount === 5, '8.1 coverage.coveredCount = 5 (carry-forward từ M2)');
  check(t8.kpis.incomePopulation === 5, '8.2 KPI incomePopulation cũng = 5, khớp với coverage');
  check(matrixAssignedTotal === 5, '8.3 Grade matrix assigned cũng = 5, khớp KPI/coverage (không lệch số người)');
  check(trendLast && trendLast.headcount === 5, '8.4 Điểm trend cuối (M0) cũng headcount=5, khớp cả 3 điểm trên — không có read-path nào lệch nhau');

  // ===== 9. Range/quý không PARTIAL giả khi carry-forward hợp lệ toàn range =====
  STATE.assignments = assignmentsForPeriod(M2, ALL_CODES, 9000000); // chỉ 1 kỳ, carry-forward xuyên suốt range
  const t9 = await getKnlDashboardOverview(session('director'), { periodFrom: M2, periodTo: M0 });
  check(t9.meta.periodCoverage.every(p => p.coverageStatus === 'complete'), '9.1 Toàn bộ periodCoverage[] trong range đều complete nhờ carry-forward, không có PARTIAL giả nào');
  check(t9.meta.snapshotPeriod === M0 && t9.kpis.totalFund === 6 * 9000000, '9.2 snapshotPeriod=M0, KPI đúng carry-forward, không bị coi range thiếu dữ liệu');

  // ===== 10. Không lấy future row cho past period =====
  STATE.assignments = [
    officialAssignment('SALE01', M0, { total: 9000000, gradeNumber: 2 }),
    officialAssignment('SALE01', ym(3), { total: 20000000, gradeNumber: 9 }) // row tương lai, KHÔNG được áp ngược
  ];
  const t10 = await getKnlDashboardOverview(session('director'), { period: M0 });
  const t10Person = t10.drillDown['Kinh doanh'].find(r => r.employeeCode === 'SALE01');
  check(t10Person && t10Person.currentIncome === 9000000, '10.1 Xem kỳ M0 phải lấy đúng row M0 (9tr), KHÔNG được lấy row tương lai (20tr) áp ngược về quá khứ');
  const t10Grade9 = findGrade(findLadder(findDepartment(t10.compensationGradeMatrix, 'Kinh doanh'), 'SALE'), 9);
  check(!t10Grade9, '10.2 Grade 9 (chỉ tồn tại ở row tương lai) không được xuất hiện khi xem M0');

  // ===== 11. Single-month backward compatibility (không truyền range field) =====
  STATE.assignments = assignmentsForPeriod(M1, ALL_CODES, 10000000);
  const t11 = await getKnlDashboardOverview(session('director'));
  check(t11.meta.rangeMode === 'single', '11.1 Không truyền periodFrom/periodTo/rangePreset -> mode single (backward-compat contract không đổi)');
  check(t11.meta.currentPeriod === t11.meta.snapshotPeriod, '11.2 currentPeriod (field legacy) và snapshotPeriod (field mới) khớp nhau ở mode single');

  // ===== 12. Income permission/scope không đổi =====
  STATE.assignments = assignmentsForPeriod(M1, ALL_CODES, 10000000);
  const t12NoIncome = await getKnlDashboardOverview(session('noincome'), { period: M0 });
  check(t12NoIncome.meta.incomeVisible === false, '12.1 income_view=false vẫn tôn trọng đúng dưới carry-forward — không bị nới quyền');
  check(t12NoIncome.kpis.totalFund === null && t12NoIncome.kpis.avgIncome === null, '12.2 income_view=false -> mọi field thu nhập vẫn null dù carry-forward có resolve được dữ liệu bên dưới');
  check(Object.prototype.hasOwnProperty.call(t12NoIncome, 'compensationGradeMatrix') === false, '12.3 income_view=false -> compensationGradeMatrix vẫn bị loại hoàn toàn khỏi response');

  console.log(failures === 0 ? '\nALL PASS — KNL Dashboard Effective Snapshot / Carry-Forward test matrix (12/12)' : '\n' + failures + ' FAILURE(S)');
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(err => { console.error(err); process.exit(1); });
