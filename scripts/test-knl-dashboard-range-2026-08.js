'use strict';

/*
 * Batch 2B Phase 1 — Dashboard KNL range/quý semantics (backend only, chưa
 * có UI picker). Đối tượng test: resolveRangeWindow() (pure date logic) +
 * getKnlDashboardOverview() ở mode 'range' (lib/knl-dashboard.js). Trong
 * mock, KHÔNG chạm Production. Periods tính tương đối theo đồng hồ host thật
 * (ym helper) trừ nhóm A dùng nowYm cố định để kiểm date-math chính xác.
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

function assignmentsForPeriod(period, codes, total) {
  return codes.map(code => ({ employee_code: code, payroll_period: period, reference_total: total, status: 'ACTIVE' }));
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

const { getKnlDashboardOverview, resolveRangeWindow } = loadLibsWithMock();

let failures = 0;
function check(condition, message) { if (!condition) { console.error('FAIL: ' + message); failures++; } else console.log('PASS: ' + message); }
function checkThrowsCode(fn, expectedCode, message) {
  try { fn(); check(false, message + ' (không throw)'); }
  catch (e) { check(e && e.code === expectedCode, message + ' (code=' + (e && e.code) + ', expected=' + expectedCode + ')'); }
}

async function run() {
  // ================= NHÓM A — resolveRangeWindow() pure date-math (nowYm cố định) =================
  const NOW = '2026-08-17'.slice(0, 7); // 2026-08

  check(resolveRangeWindow({}, NOW).mode === 'single', 'A.1 Không có periodFrom/periodTo/rangePreset -> mode single (backward-compat)');
  check(resolveRangeWindow({ period: '2026-08' }, NOW).mode === 'single', 'A.2 Chỉ có filters.period (legacy) -> vẫn mode single, không bị range-mode nuốt');

  const last3 = resolveRangeWindow({ rangePreset: 'last3' }, NOW);
  check(last3.mode === 'range' && last3.rangeStart === '2026-06' && last3.rangeEnd === '2026-08', 'A.3 last3 = 3 tháng gần nhất tính đến nowYm (06,07,08)');

  const qCurrent = resolveRangeWindow({ rangePreset: 'quarter_current' }, NOW);
  check(qCurrent.rangeStart === '2026-07' && qCurrent.rangeEnd === '2026-09', 'A.4 quarter_current: tháng 08/2026 thuộc Q3 (07-09)');

  const qPrev = resolveRangeWindow({ rangePreset: 'quarter_previous' }, NOW);
  check(qPrev.rangeStart === '2026-04' && qPrev.rangeEnd === '2026-06', 'A.5 quarter_previous: quý trước Q3/2026 là Q2 (04-06)');

  const qBoundary = resolveRangeWindow({ rangePreset: 'quarter_previous' }, '2026-01');
  check(qBoundary.rangeStart === '2025-10' && qBoundary.rangeEnd === '2025-12', 'A.6 quarter_previous qua ranh giới năm: Q1/2026 -> quý trước là Q4/2025');

  const custom = resolveRangeWindow({ periodFrom: '2026-03', periodTo: '2026-05' }, NOW);
  check(custom.mode === 'range' && custom.rangeStart === '2026-03' && custom.rangeEnd === '2026-05', 'A.7 Tuỳ chỉnh (periodFrom/periodTo tường minh, không rangePreset) -> custom ngầm định');

  checkThrowsCode(() => resolveRangeWindow({ periodFrom: '2026-05', periodTo: '2026-03' }, NOW), 'KNL_DASHBOARD_RANGE_INVALID', 'A.8 from > to phải reject, không tự hoán đổi');
  checkThrowsCode(() => resolveRangeWindow({ periodFrom: '2025-01', periodTo: '2026-06' }, NOW), 'KNL_DASHBOARD_RANGE_TOO_LONG', 'A.9 range 18 tháng (>12) phải reject');
  checkThrowsCode(() => resolveRangeWindow({ rangePreset: 'nope' }, NOW), 'KNL_DASHBOARD_RANGE_INVALID', 'A.10 rangePreset không hợp lệ phải reject');
  checkThrowsCode(() => resolveRangeWindow({ periodFrom: '2026-06' }, NOW), 'KNL_DASHBOARD_RANGE_INVALID', 'A.11 custom thiếu periodTo phải reject, không âm thầm suy diễn 1 đầu');

  const exactly12 = resolveRangeWindow({ periodFrom: '2025-09', periodTo: '2026-08' }, NOW);
  check(exactly12.mode === 'range', 'A.12 Range đúng 12 tháng (biên trần) vẫn được chấp nhận, không bị reject nhầm');

  // ================= NHÓM B — tích hợp qua getKnlDashboardOverview (mock DB, ym tương đối) =================
  const M0 = ym(0), M1 = ym(-1), M2 = ym(-2), M3 = ym(-3), FUTURE = ym(1);

  // ---- B.1 Backward-compat: mode single vẫn y nguyên hành vi cũ + field range mới là alias ----
  STATE.assignments = [].concat(assignmentsForPeriod(M1, ALL_CODES, 10000000), assignmentsForPeriod(M0, ALL_CODES, 11000000));
  const bSingle = await getKnlDashboardOverview(session('director'));
  check(bSingle.meta.rangeMode === 'single', 'B.1.1 Không truyền range field -> meta.rangeMode=single');
  check(bSingle.meta.rangeStart === null && bSingle.meta.rangeEnd === null, 'B.1.2 mode single -> rangeStart/rangeEnd=null');
  check(bSingle.meta.snapshotPeriod === bSingle.meta.currentPeriod, 'B.1.3 snapshotPeriod là alias đúng bằng currentPeriod (legacy) ở mode single');
  check(bSingle.meta.comparisonBase === bSingle.meta.previousPeriod, 'B.1.4 comparisonBase là alias đúng bằng previousPeriod (legacy) ở mode single');
  check(Array.isArray(bSingle.meta.periodCoverage) && bSingle.meta.periodCoverage.length === 1 && bSingle.meta.periodCoverage[0].period === M0, 'B.1.5 mode single -> periodCoverage[] có đúng 1 phần tử của currentPeriod');
  check(bSingle.kpis.totalFund === 6 * 11000000, 'B.1.6 KPI totalFund không đổi so với hành vi cũ (6 người x 11tr)');

  // ---- B.2 3-month custom range: đủ 3 kỳ complete, snapshot=cuối, comparisonBase=đầu ----
  STATE.assignments = [].concat(
    assignmentsForPeriod(M2, ALL_CODES, 9000000),
    assignmentsForPeriod(M1, ALL_CODES, 10000000),
    assignmentsForPeriod(M0, ALL_CODES, 12000000)
  );
  const b2 = await getKnlDashboardOverview(session('director'), { periodFrom: M2, periodTo: M0 });
  check(b2.meta.rangeMode === 'range' && b2.meta.rangeStart === M2 && b2.meta.rangeEnd === M0, 'B.2.1 3-month range resolve đúng rangeStart/rangeEnd');
  check(b2.meta.snapshotPeriod === M0, 'B.2.2 snapshotPeriod = kỳ cuối hợp lệ (M0, complete)');
  check(b2.meta.comparisonBase === M2, 'B.2.3 comparisonBase = kỳ ĐẦU range (M2), không phải kỳ liền trước (M1) — biến động đầu-cuối range');
  check(b2.kpis.totalFund === 6 * 12000000, 'B.2.4 KPI snapshot = đúng số của kỳ cuối M0 (không cộng dồn 3 kỳ)');
  const deptB2 = b2.deptComparison.find(d => d.department === 'Kinh doanh');
  check(deptB2.deltaPct != null && Math.round(deptB2.deltaPct * 10) / 10 === Math.round(((12000000 - 9000000) / 9000000) * 1000) / 10, 'B.2.5 deltaPct = (cuối-đầu)/đầu của cả range, không phải so kỳ liền trước');
  check(b2.meta.periodCoverage.length === 3, 'B.2.6 periodCoverage[] liệt kê đủ 3 kỳ trong range');
  check(b2.meta.periodCoverage.every(p => p.coverageStatus === 'complete'), 'B.2.7 cả 3 kỳ trong range đều complete (đúng dữ liệu fixture)');

  // ---- B.3 Partial thật (carry-forward-proof) ở đầu range, resolve về sau ----
  // LƯU Ý carry-forward: dưới rule mới, coveredCount là ĐƠN ĐIỆU KHÔNG GIẢM
  // theo thời gian (nếu kỳ A complete thì mọi kỳ sau A cũng complete, vì
  // carry-forward chỉ CỘNG THÊM độ phủ, không bao giờ mất đi) — nên kịch bản
  // "complete → partial → complete" xen giữa range KHÔNG CÒN khả dĩ (đây
  // chính là hệ quả đúng của rule, không phải hạn chế test). Kịch bản còn có
  // ý nghĩa: 3/6 mã CHƯA TỪNG được gán trước M0 (genuinely missing, không có
  // gì để carry-forward) -> cả M2 lẫn M1 đều partial thật, chỉ M0 (có đủ 6/6
  // row tường minh) mới complete -> comparisonBase=null trung thực (không có
  // kỳ complete thứ 2 nào để so sánh), không bịa delta.
  const PARTIAL_EARLY_CODES = ALL_CODES.slice(0, 3);
  STATE.assignments = [].concat(
    assignmentsForPeriod(M2, PARTIAL_EARLY_CODES, 9000000),
    assignmentsForPeriod(M1, PARTIAL_EARLY_CODES, 10000000), // 3 mã còn lại chưa từng được gán tới đây
    assignmentsForPeriod(M0, ALL_CODES, 12000000) // M0: cả 6 mã lần đầu có row tường minh
  );
  const b3 = await getKnlDashboardOverview(session('director'), { periodFrom: M2, periodTo: M0 });
  const midCoverageM1 = b3.meta.periodCoverage.find(p => p.period === M1);
  const midCoverageM2 = b3.meta.periodCoverage.find(p => p.period === M2);
  check(midCoverageM1 && midCoverageM1.coverageStatus === 'partial' && midCoverageM1.coveredCount === 3, 'B.3.1 Kỳ M1 (3/6, 3 mã genuinely chưa từng gán) tự mang coverageStatus=partial thật, không phải carry-forward gap');
  check(midCoverageM2 && midCoverageM2.coverageStatus === 'partial' && midCoverageM2.coveredCount === 3, 'B.3.1b Kỳ M2 cũng partial cùng lý do (đơn điệu — không thể complete rồi lại partial)');
  check(b3.meta.snapshotPeriod === M0, 'B.3.2 snapshotPeriod = M0 (kỳ complete duy nhất, 6/6 tường minh)');
  check(b3.meta.comparisonBase === null, 'B.3.3 comparisonBase=null trung thực — không có kỳ complete thứ 2 nào trong range để so sánh, KHÔNG bịa delta');
  check(b3.kpis.totalFund === 6 * 12000000, 'B.3.4 KPI snapshot đúng M0 (6/6 tường minh)');

  // ---- B.4 Range end là tương lai: snapshot không bao giờ nhảy vào future ----
  STATE.assignments = [].concat(
    assignmentsForPeriod(M0, ALL_CODES, 11000000),
    assignmentsForPeriod(FUTURE, ALL_CODES, 99000000) // đủ 6/6 nhưng là kỳ tương lai
  );
  const b4 = await getKnlDashboardOverview(session('director'), { periodFrom: M0, periodTo: FUTURE });
  check(b4.meta.snapshotPeriod === M0, 'B.4.1 rangeEnd là kỳ tương lai (dù 100% coverage) -> snapshot KHÔNG bao giờ chọn kỳ đó');
  const futureCoverage = b4.meta.periodCoverage.find(p => p.period === FUTURE);
  check(futureCoverage && futureCoverage.isFuture === true && futureCoverage.coverageStatus !== undefined, 'B.4.2 Kỳ tương lai vẫn xuất hiện trong roster, tự mang isFuture=true');
  check(b4.kpis.totalFund === 6 * 11000000, 'B.4.3 KPI totalFund lấy đúng kỳ M0, hoàn toàn không dùng số liệu kỳ tương lai (chặn rủi ro hiểu nhầm giảm/tăng quỹ mạnh)');

  // ---- B.5 Không có kỳ complete nào trong range: fallback an toàn, không crash ----
  STATE.assignments = assignmentsForPeriod(M0, ALL_CODES.slice(0, 2), 5000000); // 2/6 duy nhất, trong range M2..M0
  const b5 = await getKnlDashboardOverview(session('director'), { periodFrom: M2, periodTo: M0 });
  check(b5.meta.snapshotPeriod === M0, 'B.5.1 Không kỳ nào complete -> fallback = kỳ có data muộn nhất TRONG range (M0)');
  check(b5.meta.currentPeriodStatus === 'partial', 'B.5.2 Fallback được gắn nhãn thật (partial), không giả complete');
  check(b5.meta.comparisonBase === null, 'B.5.3 comparisonBase=null khi không có kỳ complete nào để so sánh, không bịa delta');
  check(b5.kpis.totalHeadcount >= 0 && !Number.isNaN(b5.kpis.totalHeadcount), 'B.5.4 Không crash, vẫn trả KPI shape hợp lệ');

  // ---- B.6 Range hoàn toàn trắng dữ liệu (KHÔNG có bất kỳ ACTIVE row nào,
  // trong lẫn ngoài range) -> snapshot=null, an toàn tuyệt đối. ----
  STATE.assignments = [];
  const b6 = await getKnlDashboardOverview(session('director'), { periodFrom: M2, periodTo: M0 });
  check(b6.meta.snapshotPeriod === null, 'B.6.1 Không có bất kỳ dữ liệu nào -> snapshotPeriod=null');
  check(b6.meta.comparisonBase === null, 'B.6.2 comparisonBase=null khi snapshot=null');
  check(b6.kpis.totalFund === 0, 'B.6.3 totalFund=0 an toàn (không null-crash) khi snapshot rỗng');
  check(b6.meta.periodCoverage.every(p => p.coverageStatus === 'empty'), 'B.6.4 Toàn bộ roster tự báo empty trung thực, không giả vờ có dữ liệu');

  // ---- B.6b (carry-forward mới) Dữ liệu có TRƯỚC rangeStart (ngoài range
  // được hỏi) vẫn PHẢI carry-forward vào trong range — resolver không bị
  // giới hạn bởi biên range, chỉ bị giới hạn bởi payroll_period<=selectedPeriod. ----
  STATE.assignments = assignmentsForPeriod(ym(-6), ALL_CODES, 8000000); // 6 tháng trước M2, ngoài range được hỏi
  const b6b = await getKnlDashboardOverview(session('director'), { periodFrom: M2, periodTo: M0 });
  check(b6b.meta.snapshotPeriod === M0, 'B.6b.1 Dữ liệu 6 tháng trước range vẫn carry-forward đúng vào M0 (kỳ cuối range) — resolver không bị chặn bởi biên range');
  check(b6b.kpis.totalFund === 6 * 8000000, 'B.6b.2 KPI snapshot dùng đúng số carry-forward từ xa (8tr/người), không phải 0/không tính');
  check(b6b.meta.periodCoverage.every(p => p.coverageStatus === 'complete'), 'B.6b.3 Toàn bộ roster trong range đều complete nhờ carry-forward từ trước rangeStart');

  // ---- B.7 Permission/income scope không đổi ở mode range ----
  STATE.assignments = [].concat(assignmentsForPeriod(M2, ALL_CODES, 9000000), assignmentsForPeriod(M0, ALL_CODES, 12000000));
  const b7 = await getKnlDashboardOverview(session('noincome'), { periodFrom: M2, periodTo: M0 });
  check(b7.meta.incomeVisible === false, 'B.7.1 income_view=false vẫn tôn trọng đúng ở mode range');
  check(b7.kpis.totalFund === null && b7.kpis.avgIncome === null, 'B.7.2 income_view=false -> mọi field thu nhập vẫn null ở mode range, không leak qua range path mới');
  check(b7.meta.periodCoverage.length === 3, 'B.7.3 periodCoverage[] vẫn tính đúng (dựa trên incomeByEmployeeCodes rỗng khi income_view=false) không throw');
  check(b7.trend.length === 0, 'B.7.4 trend rỗng khi income_view=false, không đổi hành vi cũ');
  const dResult = await getKnlDashboardOverview(session('director'), { periodFrom: M2, periodTo: M0, department: 'Bộ phận không tồn tại' });
  check(dResult.meta.rangeMode === 'range', 'B.7.5 Filter UI (department) không phá logic range, vẫn resolve đúng rangeMode');

  // ---- B.8 Trend mang completeness theo từng điểm (additive, không đổi field
  // cũ) — cùng fixture "3 mã chưa từng gán trước M0" như B.3 (carry-forward-
  // proof: M1 partial thật, không phải carry-forward gap). Đồng thời xác
  // nhận trend.fund tại M1 chỉ tính đúng 3 người CÓ resolve (không cộng
  // khống người còn lại), và headcount phản ánh đúng carry-forward khi có. ----
  STATE.assignments = [].concat(
    assignmentsForPeriod(M2, PARTIAL_EARLY_CODES, 9000000),
    assignmentsForPeriod(M1, PARTIAL_EARLY_CODES, 10000000), // 3 mã còn lại chưa từng được gán
    assignmentsForPeriod(M0, ALL_CODES, 12000000)
  );
  const b8 = await getKnlDashboardOverview(session('director'), { periodFrom: M2, periodTo: M0 });
  check(b8.trend.length === 3, 'B.8.1 trend vẫn có đủ 3 điểm như trước (field cũ không đổi)');
  const trendM1 = b8.trend.find(t => t.period === M1);
  check(trendM1 && trendM1.coverageStatus === 'partial' && trendM1.isComplete === false, 'B.8.2 Điểm trend của kỳ partial thật (M1, 3/6 genuinely chưa gán) tự mang coverageStatus/isComplete đúng, không vẽ liền mạch không phân biệt');
  check(trendM1 && trendM1.headcount === 3 && trendM1.fund === 3 * 10000000, 'B.8.2b Trend M1 chỉ cộng đúng 3 người resolve được, không cộng khống 3 người còn lại (genuinely missing, không carry-forward được)');
  const trendM0 = b8.trend.find(t => t.period === M0);
  check(trendM0 && trendM0.coverageStatus === 'complete' && typeof trendM0.fund === 'number', 'B.8.3 Điểm trend complete vẫn giữ đủ field cũ (fund/headcount/avgIncome) cộng thêm completeness mới');
  check(b8.trend.every(t => 'coverageStatus' in t && 'isFuture' in t && 'isComplete' in t), 'B.8.4 Mọi điểm trend đều có đủ 3 field completeness mới');

  // ---- B.8b (carry-forward mới) Trend PHẢI carry-forward đúng — 1 tháng
  // không ai ghi dòng mới vẫn phải hiện đúng số carry-forward, không tụt
  // về 0/biến mất khỏi biểu đồ. ----
  STATE.assignments = [].concat(
    assignmentsForPeriod(M2, ALL_CODES, 9000000),
    assignmentsForPeriod(M0, ALL_CODES, 12000000) // M1: không ai ghi dòng mới, phải carry-forward từ M2
  );
  const b8b = await getKnlDashboardOverview(session('director'), { periodFrom: M2, periodTo: M0 });
  const trendM1b = b8b.trend.find(t => t.period === M1);
  check(trendM1b && trendM1b.isComplete === true && trendM1b.headcount === 6, 'B.8b.1 Tháng không ai đổi gì (M1) vẫn carry-forward đủ 6/6 người, KHÔNG tụt/biến mất khỏi trend');
  check(trendM1b && trendM1b.fund === 6 * 9000000, 'B.8b.2 Quỹ tại M1 = đúng số carry-forward từ M2 (9tr/người), không phải 0 hay giả định sai');

  console.log(failures === 0 ? '\nALL PASS — KNL Dashboard Batch 2B Phase 1 range/quý backend semantics' : '\n' + failures + ' FAILURE(S)');
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(err => { console.error(err); process.exit(1); });
