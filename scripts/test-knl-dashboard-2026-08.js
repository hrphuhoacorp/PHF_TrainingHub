'use strict';
/*
 * Dashboard KNL Gate 2 — regression cho lib/knl-dashboard.js:getKnlDashboardOverview.
 * Cùng kỹ thuật mock Supabase in-memory với scripts/test-knl-people-income-gate-2026-08.js
 * (KHÔNG chạm Production thật). Case tối thiểu theo mục T của yêu cầu Gate 2:
 *   1. Admin: full aggregation
 *   2. "Giám đốc" (custom grant all_company, view-only theo thiết kế — dashboard
 *      không có action ghi nào để kiểm view-only riêng, endpoint tự thân read-only)
 *   3. Tiên: chỉ đúng incomeScope, không thấy phòng ngoài scope, tổng quỹ/bình
 *      quân/tỷ trọng đều chỉ từ allowed dataset
 *   4. User ngoài scope (không có dashboard_view): bị chặn 403
 *   5. Empty data: không crash
 *   6. Missing KNL: không crash, m3plus luôn null, missingKnl đếm đúng
 *   7. Previous-month missing: biến động null, không fake
 *   8. income_view off: không trả salary aggregation
 *   9. Direct API call ngoài scope: backend vẫn chặn (incomeScopeAllows y hệt path cũ)
 *
 * Chạy thủ công: node scripts/test-knl-dashboard-2026-08.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const peoplePath = require.resolve('../lib/knl-people');
const permissionsPath = require.resolve('../lib/knl-permissions');
const scopePath = require.resolve('../lib/knl-scope');
const dashboardPath = require.resolve('../lib/knl-dashboard');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

function makeTableFactory(rows) {
  return function tableQuery() {
    const filters = [];
    let mode = 'select', orderSpecs = [], limitN = null, singleMode = null, inFilter = null, insertPayload = null, updatePayload = null;
    const q = {
      select() { return q; },
      eq(f, v) { filters.push(r => String(r[f]) === String(v)); return q; },
      in(f, values) { inFilter = { f, values: values.map(String) }; return q; },
      order(f, o) { orderSpecs.push({ f, asc: !(o && o.ascending === false) }); return q; },
      limit(n) { limitN = n; return q; },
      maybeSingle() { singleMode = 'maybe'; return q; },
      single() { singleMode = 'single'; return q; },
      insert(p) { mode = 'insert'; insertPayload = p; return q; },
      update(p) { mode = 'update'; updatePayload = p; return q; },
      then(resolve, reject) {
        try {
          if (mode === 'insert') {
            const list = Array.isArray(insertPayload) ? insertPayload : [insertPayload];
            const inserted = list.map(obj => { const row = Object.assign({ id: 'gen-' + Math.random().toString(36).slice(2), created_at: new Date().toISOString(), is_active: true }, obj); rows.push(row); return row; });
            resolve({ data: clone(singleMode ? inserted[0] : inserted), error: null }); return;
          }
          if (mode === 'update') {
            const matched = rows.filter(r => filters.every(fn => fn(r)));
            matched.forEach(r => Object.assign(r, updatePayload));
            resolve({ data: clone(singleMode ? (matched[0] || null) : matched), error: null }); return;
          }
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

const EMPLOYEES = [
  { employee_id: 'e-002', employee_code: 'PHF002', full_name: 'Trần Thu Thủy', title: 'Giám đốc', position: null, department: 'Ban giám đốc', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_id: 'e-010', employee_code: 'PHF010', full_name: 'Nguyễn Thủy Tiên', title: 'Trợ lý Giám đốc', position: 'Quản lý', department: 'Ban giám đốc', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_id: 'e-051', employee_code: 'PHF051', full_name: 'Trịnh Thị Ngọc Linh', title: 'Trưởng bộ phận', position: null, department: 'Bộ phận thu mua', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_id: 'e-052', employee_code: 'PHF052', full_name: 'Đỗ Văn Bình', title: 'Nhân viên', position: null, department: 'Bộ phận thu mua', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_id: 'e-036', employee_code: 'PHF036', full_name: 'Trần Trung Hải', title: 'Nhân viên', position: null, department: 'Bộ phận Gói quà & Chế biến', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_id: 'e-034', employee_code: 'PHF034', full_name: 'Nguyễn Duy Hải', title: 'Trưởng bộ phận', position: null, department: 'Bộ phận kho vận', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' }
];

const COMPENSATION = [
  { employee_code: 'PHF051', payroll_period: '2026-07', reference_total: 10000000 },
  { employee_code: 'PHF051', payroll_period: '2026-08', reference_total: 11000000 },
  { employee_code: 'PHF052', payroll_period: '2026-08', reference_total: 9000000 },
  // PHF036 chỉ có kỳ hiện tại, KHÔNG có kỳ trước -> biến động phải null, không fake.
  { employee_code: 'PHF036', payroll_period: '2026-08', reference_total: 8000000 },
  { employee_code: 'PHF034', payroll_period: '2026-07', reference_total: 12000000 },
  { employee_code: 'PHF034', payroll_period: '2026-08', reference_total: 12500000 }
];

const COMPETENCY = [
  { employee_code: 'PHF051', is_active: true, grade_snapshot: { frameworkCode: 'KNL_THU_MUA', frameworkName: 'Thu mua', gradeCode: 'B3', label: 'Bậc 3' } },
  { employee_code: 'PHF034', is_active: true, grade_snapshot: { frameworkCode: 'KNL_KHO', frameworkName: 'Kho vận', gradeCode: 'B4', label: 'Bậc 4' } }
  // PHF052/PHF036 CỐ Ý không có assignment active -> case "Missing KNL".
];

const STATE = { grants: [], grantHistory: [], employees: EMPLOYEES, assignments: clone(COMPENSATION), competency: clone(COMPETENCY) };

function buildSupabaseMock() {
  return {
    createClient() {
      return {
        from(table) {
          if (table === 'knl_permission_grants') return makeTableFactory(STATE.grants)();
          if (table === 'knl_permission_grant_history') return makeTableFactory(STATE.grantHistory)();
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
  const originalCache = require.cache[supabasePath];
  [peoplePath, permissionsPath, scopePath, dashboardPath].forEach(p => delete require.cache[p]);
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
  const permissions = require(permissionsPath);
  const dashboard = require(dashboardPath);
  Module._resolveFilename = originalResolve;
  if (originalCache) require.cache[supabasePath] = originalCache; else delete require.cache[supabasePath];
  return { permissions, dashboard };
}

const { permissions, dashboard } = loadLibsWithMock();
const { upsertKnlPermissionGrant } = permissions;
const { getKnlDashboardOverview } = dashboard;

function session(role, opts) { opts = opts || {}; return { role, account: { id: opts.id || '', name: opts.name || '' }, employeeCode: opts.employeeCode || '' }; }
async function grant(accountId, employeeCode, employeeName, presetCode, capabilities, peopleScope) {
  return upsertKnlPermissionGrant(session('admin', { id: 'u-admin' }), { accountId, employeeCode, employeeName, presetCode, capabilities, peopleScope, reason: 'Dashboard Gate 2 test fixture' });
}

let failures = 0;
function check(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); failures++; } else console.log('PASS: ' + msg); }

async function run() {
  // ========== 1. Admin: full aggregation ==========
  const adminSession = session('admin', { id: 'u-admin' });
  const adminDash = await getKnlDashboardOverview(adminSession, {});
  check(adminDash.meta.incomeVisible === true, '1.1 Admin: incomeVisible=true');
  check(adminDash.kpis.totalHeadcount === EMPLOYEES.length, '1.2 Admin: totalHeadcount = toàn bộ nhân sự active (' + EMPLOYEES.length + ')');
  check(adminDash.kpis.totalFund === 11000000 + 9000000 + 8000000 + 12500000, '1.3 Admin: totalFund = tổng quỹ kỳ hiện tại (2026-08) toàn công ty');
  check(adminDash.kpis.m3plus === null, '1.4 Admin: kpis.m3plus luôn null (STOP normalize M1-M5 đã chốt với PHF)');
  check(adminDash.meta.isFullCompanyIncome === true, '1.5 Admin: isFullCompanyIncome=true -> KHÔNG có scopeNote giới hạn');

  // ========== 2. "Giám đốc" — custom grant all_company, dashboard_view thủ công ==========
  await grant('acct-phf002', 'PHF002', 'Trần Thu Thủy', 'CUSTOM',
    { access_knl: true, view_people: true, income_view: true, dashboard_view: true, incomeScope: { type: 'all_company', values: [] } },
    { type: 'all_company', values: [] });
  const gdSession = session('learner', { id: 'acct-phf002', employeeCode: 'PHF002' });
  const gdDash = await getKnlDashboardOverview(gdSession, {});
  check(gdDash.kpis.totalHeadcount === EMPLOYEES.length, '2.1 Giám đốc (all_company): totalHeadcount = toàn công ty');
  check(gdDash.kpis.totalFund === adminDash.kpis.totalFund, '2.2 Giám đốc (all_company): totalFund khớp Admin (cùng phạm vi toàn công ty)');
  check(gdDash.meta.isFullCompanyIncome === true, '2.3 Giám đốc: isFullCompanyIncome=true (incomeScope.type=all_company)');

  // ========== 3. Tiên — incomeScope + peopleScope giới hạn 2 phòng ban Kinh doanh ==========
  await grant('acct-phf010', 'PHF010', 'Nguyễn Thủy Tiên', 'CUSTOM',
    { access_knl: true, view_people: true, income_view: true, dashboard_view: true, incomeScope: { type: 'department', values: ['Bộ phận thu mua', 'Bộ phận Gói quà & Chế biến'] } },
    { type: 'department', values: ['Bộ phận thu mua', 'Bộ phận Gói quà & Chế biến'] });
  const tienSession = session('learner', { id: 'acct-phf010', employeeCode: 'PHF010' });
  const tienDash = await getKnlDashboardOverview(tienSession, {});
  const tienDepts = tienDash.deptComparison.map(d => d.department).sort();
  check(tienDepts.join(',') === 'Bộ phận Gói quà & Chế biến,Bộ phận thu mua', '3.1 Tiên: deptComparison CHỈ chứa đúng 2 phòng ban trong incomeScope, không thấy "Bộ phận kho vận"/"Ban giám đốc"');
  check(tienDash.kpis.totalHeadcount === 3, '3.2 Tiên: totalHeadcount = 3 (PHF051+PHF052+PHF036, đúng peopleScope)');
  check(tienDash.kpis.totalFund === 11000000 + 9000000 + 8000000, '3.3 Tiên: totalFund CHỈ tính trên dataset incomeScope cho phép (không lẫn PHF034/kho vận)');
  check(tienDash.meta.isFullCompanyIncome === false, '3.4 Tiên: isFullCompanyIncome=false (incomeScope.type=department, không phải all_company)');
  check(tienDash.meta.scopeNote === 'Tỷ trọng trong phạm vi được xem', '3.5 Tiên: label tỷ trọng phải ghi rõ "trong phạm vi được xem" (mục D), KHÔNG ngầm hiểu là toàn công ty');
  const tienDeptSum = tienDash.deptComposition.reduce((s, d) => s + (d.fund || 0), 0);
  const tienShareSum = tienDash.deptComposition.reduce((s, d) => s + (d.sharePct || 0), 0);
  check(tienDeptSum === tienDash.kpis.totalFund, '3.6 Tiên: tổng fund các phòng ban composition khớp KPI tổng quỹ (không leak công ty)');
  check(Math.round(tienShareSum) === 100, '3.7 Tiên: tổng sharePct các phòng ban trong scope = 100% (mẫu số là dataset được phép xem, không phải toàn công ty)');

  // ========== 4. User ngoài scope (không có dashboard_view) -> 403 ==========
  await grant('acct-phf005', 'PHF005', 'Nguyễn Minh Nhật', 'TRUONG_BO_PHAN',
    { access_knl: true, view_people: true, income_view: false },
    { type: 'department', values: ['Bộ phận thu mua'] });
  const noDashSession = session('learner', { id: 'acct-phf005', employeeCode: 'PHF005' });
  const r4 = await getKnlDashboardOverview(noDashSession, {}).then(() => ({ ok: true })).catch(e => ({ ok: false, code: e.code }));
  check(r4.ok === false && r4.code === 'KNL_DASHBOARD_VIEW_DENIED', '4.1 Account KHÔNG có dashboard_view -> 403 KNL_DASHBOARD_VIEW_DENIED, không lấy được aggregate nào');

  // ========== 5. Empty data (nhân sự có dashboard_view nhưng peopleScope rỗng thực tế) — không crash ==========
  await grant('acct-empty', 'EMPTYX', 'Empty Scope Tester', 'CUSTOM',
    { access_knl: true, view_people: true, income_view: true, dashboard_view: true, incomeScope: { type: 'department', values: ['Phòng không tồn tại'] } },
    { type: 'department', values: ['Phòng không tồn tại'] });
  const emptySession = session('learner', { id: 'acct-empty', employeeCode: 'EMPTYX' });
  const emptyDash = await getKnlDashboardOverview(emptySession, {}).then(d => ({ ok: true, d })).catch(e => ({ ok: false, e }));
  check(emptyDash.ok === true, '5.1 Empty data (phạm vi rỗng thực tế): getKnlDashboardOverview KHÔNG throw/crash');
  check(emptyDash.ok && emptyDash.d.kpis.totalHeadcount === 0 && emptyDash.d.kpis.totalFund === 0, '5.2 Empty data: KPI trả 0 hợp lệ, không phải lỗi hay giá trị bịa');
  check(emptyDash.ok && emptyDash.d.deptComparison.length === 0 && emptyDash.d.trend.length === 0, '5.3 Empty data: các bảng/mảng đều rỗng [], không fake dòng nào');

  // ========== 6. Missing KNL — không crash, m3plus luôn null, missingKnl đếm đúng ==========
  check(tienDash.kpis.m3plus === null, '6.1 Tiên: kpis.m3plus vẫn null (không tự quy đổi dù đủ quyền xem)');
  check(tienDash.actionStats.missingKnl === 2, '6.2 Tiên: missingKnl = 2 (PHF052 + PHF036 chưa có assignment active) — đúng trong phạm vi peopleScope');
  const missingInsight = tienDash.insights.find(i => i.code === 'MISSING_KNL');
  check(!!missingInsight && /2 nhân sự/.test(missingInsight.message), '6.3 Insight "Cần xem thêm" nêu đúng số lượng thiếu KNL, wording không kết luận đúng/sai');

  // ========== 7. Previous-month missing — biến động null, không fake ==========
  const goiQuaRow = tienDash.deptComparison.find(d => d.department === 'Bộ phận Gói quà & Chế biến');
  check(!!goiQuaRow && goiQuaRow.previousFund === null && goiQuaRow.deltaAmount === null && goiQuaRow.deltaPct === null, '7.1 Phòng ban chỉ có 1 kỳ (PHF036, không có kỳ trước): previousFund/deltaAmount/deltaPct đều null, KHÔNG suy diễn/fake biến động');
  const phf036Drill = (tienDash.drillDown['Bộ phận Gói quà & Chế biến'] || []).find(r => r.employeeCode === 'PHF036');
  check(!!phf036Drill && phf036Drill.previousIncome === null && phf036Drill.deltaPct === null, '7.2 Drill-down PHF036: previousIncome/deltaPct null (đúng — không có kỳ trước trong dữ liệu)');

  // ========== 8. income_view off — không trả salary aggregation ==========
  await grant('acct-phf005b', 'PHF005B', 'No Income View Tester', 'CUSTOM',
    { access_knl: true, view_people: true, income_view: false, dashboard_view: true },
    { type: 'department', values: ['Bộ phận thu mua'] });
  const noIncomeSession = session('learner', { id: 'acct-phf005b', employeeCode: 'PHF005B' });
  const noIncomeDash = await getKnlDashboardOverview(noIncomeSession, {});
  check(noIncomeDash.meta.incomeVisible === false, '8.1 income_view=false: meta.incomeVisible=false');
  check(noIncomeDash.kpis.totalFund === null && noIncomeDash.kpis.avgIncome === null, '8.2 income_view=false: totalFund/avgIncome đều null, KHÔNG trả salary aggregation nào');
  check(noIncomeDash.deptComparison.every(d => d.fund === null && d.avgIncome === null), '8.3 income_view=false: mọi dòng "So sánh phòng ban" cột thu nhập đều null (không leak qua field khác)');
  check(noIncomeDash.incomeByGrade.length === 0 && noIncomeDash.trend.length === 0, '8.4 income_view=false: "Thu nhập theo bậc KNL" và "Xu hướng" đều rỗng, không tính ngầm');
  check(noIncomeDash.kpis.totalHeadcount === 2, '8.5 income_view=false: headcount (peopleScope) vẫn tính bình thường — độc lập với income_view (mục C)');

  // ========== 9. Direct call ngoài incomeScope vẫn bị chặn ở data layer (không phải chỉ UI) ==========
  const outsideDash = await getKnlDashboardOverview(tienSession, { department: 'Bộ phận kho vận' });
  check(outsideDash.deptComparison.length === 0 && outsideDash.kpis.totalHeadcount === 0, '9.1 Tiên filter theo phòng ban NGOÀI peopleScope ("Bộ phận kho vận") -> trả rỗng, backend tự lọc lại theo scope, KHÔNG mở option ngoài scope dù filter truyền tay');

  console.log(failures === 0 ? '\nALL PASS' : '\n' + failures + ' FAILURE(S)');
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
