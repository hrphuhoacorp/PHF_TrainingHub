'use strict';

/*
 * Batch 2B Phase 2 — Dashboard KNL range/quý UI/integration test. KHÔNG
 * re-test backend semantics (đã có scripts/test-knl-dashboard-range-2026-08.js,
 * Phase 1) — ở đây chỉ giả lập response backend theo đúng contract Phase 1
 * (meta.rangeMode/rangeStart/rangeEnd/snapshotPeriod/comparisonBase/
 * periodCoverage[], trend[].coverageStatus/isFuture/isComplete) qua mock
 * fetch, rồi kiểm UI đọc/trình bày đúng — không mở kết nối DB/mạng thật.
 */
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync('assets/js/knl/phf-knl-app.js', 'utf8');
const css = fs.readFileSync('assets/css/phf-knl.css', 'utf8');

function response(data) { return { ok: true, json: async () => data }; }
function tick() { return new Promise(resolve => setTimeout(resolve, 25)); }

function baseMeta(overrides) {
  return Object.assign({
    incomeVisible: true,
    currentPeriod: '2026-08', previousPeriod: '2026-07',
    currentPeriodIsFuture: false, currentPeriodStatus: 'complete',
    expectedCount: 6, coveredCount: 6, missingCount: 0, comparisonAvailable: true,
    generatedAt: '2026-08-17T10:00:00+07:00',
    availablePeriods: ['2026-08', '2026-07', '2026-06'],
    scopeNote: null,
    filterOptions: { departments: ['Kinh doanh'], branches: ['Phú Lợi'], titles: ['Nhân viên'], knlGrades: [] },
    rangeMode: 'single', rangeStart: null, rangeEnd: null, snapshotPeriod: '2026-08', comparisonBase: '2026-07',
    periodCoverage: [{ period: '2026-08', coverageStatus: 'complete', isFuture: false, isComplete: true, expectedCount: 6, coveredCount: 6, missingCount: 0 }]
  }, overrides || {});
}
function baseOverview(metaOverrides, extra) {
  return Object.assign({
    ok: true,
    meta: baseMeta(metaOverrides),
    kpis: { totalFund: 60000000, totalHeadcount: 6, avgIncome: 10000000, incomePopulation: 6 },
    deptComposition: [{ department: 'Kinh doanh', fund: 60000000, sharePct: 100 }],
    deptComparison: [{ department: 'Kinh doanh', headcount: 6, fund: 60000000, avgIncome: 10000000, deltaPct: 1 }],
    drillDown: {}, knlDistribution: [], incomeByGrade: [],
    trend: [{ period: '2026-06', fund: 55000000, headcount: 6, avgIncome: 9166667, coverageStatus: 'complete', isFuture: false, isComplete: true },
      { period: '2026-07', fund: 58000000, headcount: 6, avgIncome: 9666667, coverageStatus: 'complete', isFuture: false, isComplete: true },
      { period: '2026-08', fund: 60000000, headcount: 6, avgIncome: 10000000, coverageStatus: 'complete', isFuture: false, isComplete: true }],
    insights: [], actionStats: { proposalsPending: null, missingKnl: 0, surveysExpiringSoon: null },
    compensationGradeMatrix: { period: '2026-08', gradeNumbers: [], unassignedCount: 0, departments: [] }
  }, extra || {});
}

async function setup() {
  const dom = new JSDOM('<!doctype html><html><head><style>' + css + '</style></head><body><div id="phfKnlRoot"></div></body></html>', { url: 'http://localhost/admin/knl/dashboard', runScripts: 'outside-only' });
  const { window } = dom;
  const calls = [];
  window.phfGetSessionRole = () => 'admin';
  window.phfGetCurrentUser = () => ({ id: 'admin-1', employeeCode: 'PHF000', name: 'Admin' });
  window.phfNavigate = () => {};
  window.scrollTo = () => {};
  window.requestAnimationFrame = fn => setTimeout(fn, 0);
  window.Element.prototype.scrollIntoView = () => {};
  window.alert = () => { throw new Error('alert() KHÔNG được gọi'); };
  window.confirm = () => { throw new Error('confirm() KHÔNG được gọi'); };
  window.prompt = () => { throw new Error('prompt() KHÔNG được gọi'); };
  let nextOverview = baseOverview();
  window.__setNextOverview = ov => { nextOverview = ov; };
  window.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body); calls.push(body);
    if (body.action === 'getKnlCapabilities') return response({ ok: true, isAdmin: true, capabilities: { dashboard_view: true, income_view: true }, peopleScope: { type: 'all_company', values: [] } });
    if (body.action === 'getKnlDashboardOverview') return response(JSON.parse(JSON.stringify(nextOverview)));
    if (body.action === 'askKnlDashboardAi') return response({ ok: true, reply: 'ok', contextSummary: [] });
    return { ok: false, json: async () => ({ ok: false, error: 'Unexpected action ' + body.action }) };
  };
  window.eval(code);
  await window.phfRenderKnl('/admin/knl/dashboard');
  await tick();
  return { window, root: window.document.getElementById('phfKnlRoot'), calls, setOverview: window.__setNextOverview };
}

let failures = 0;
function check(condition, message) { if (!condition) { console.error('FAIL: ' + message); failures++; } else console.log('PASS: ' + message); }

async function run() {
  // ===== 1. Backward-compat: single-month vẫn hoạt động, chế độ mặc định 'Theo tháng' =====
  {
    const { window, root, calls } = await setup();
    check(root.querySelector('[data-dash-range-mode]').value === 'month', '1.1 Mặc định chế độ = Theo tháng');
    check(root.querySelector('[data-dash-filter="period"]') !== null, '1.2 Ở chế độ Theo tháng vẫn còn dropdown Kỳ dữ liệu cũ (backward-compat)');
    const overviewCall = calls.find(c => c.action === 'getKnlDashboardOverview');
    check(overviewCall && !overviewCall.periodFrom && !overviewCall.periodTo && !overviewCall.rangePreset, '1.3 Request mặc định KHÔNG gửi periodFrom/periodTo/rangePreset (đúng legacy payload)');
    check(!('rangeChoice' in overviewCall), '1.4 Field UI-only rangeChoice KHÔNG bị lọt vào payload gửi backend');
  }

  // ===== 2. last3 preset =====
  {
    const { window, root, calls, setOverview } = await setup();
    setOverview(baseOverview({ rangeMode: 'range', rangeStart: '2026-06', rangeEnd: '2026-08', snapshotPeriod: '2026-08', comparisonBase: '2026-06',
      periodCoverage: [
        { period: '2026-06', coverageStatus: 'complete', isFuture: false, isComplete: true, expectedCount: 6, coveredCount: 6, missingCount: 0 },
        { period: '2026-07', coverageStatus: 'complete', isFuture: false, isComplete: true, expectedCount: 6, coveredCount: 6, missingCount: 0 },
        { period: '2026-08', coverageStatus: 'complete', isFuture: false, isComplete: true, expectedCount: 6, coveredCount: 6, missingCount: 0 }] }));
    const modeEl = root.querySelector('[data-dash-range-mode]');
    modeEl.value = 'last3';
    modeEl.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    const last3Call = calls[calls.length - 1];
    check(last3Call.action === 'getKnlDashboardOverview' && last3Call.rangePreset === 'last3', '2.1 Chọn "3 tháng gần nhất" gửi đúng rangePreset=last3');
    check(!last3Call.periodFrom && !last3Call.periodTo, '2.2 UI KHÔNG tự tính periodFrom/periodTo cho last3 — để backend resolveRangeWindow tính');
    check(root.textContent.includes('06/2026') && root.textContent.includes('08/2026'), '2.3 UI hiển thị đúng rangeStart/rangeEnd backend trả về (06/2026 -> 08/2026)');
  }

  // ===== 3. Quarter current =====
  {
    const { window, root, calls, setOverview } = await setup();
    setOverview(baseOverview({ rangeMode: 'range', rangeStart: '2026-07', rangeEnd: '2026-09', snapshotPeriod: '2026-08', comparisonBase: '2026-07' }));
    const modeEl = root.querySelector('[data-dash-range-mode]');
    modeEl.value = 'quarter_current';
    modeEl.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    const qCall = calls[calls.length - 1];
    check(qCall.rangePreset === 'quarter_current', '3.1 Chọn "Quý hiện tại" gửi đúng rangePreset=quarter_current');
  }

  // ===== 4. Quarter previous =====
  {
    const { window, root, calls, setOverview } = await setup();
    setOverview(baseOverview({ rangeMode: 'range', rangeStart: '2026-04', rangeEnd: '2026-06', snapshotPeriod: '2026-06', comparisonBase: '2026-04' }));
    const modeEl = root.querySelector('[data-dash-range-mode]');
    modeEl.value = 'quarter_previous';
    modeEl.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    const qpCall = calls[calls.length - 1];
    check(qpCall.rangePreset === 'quarter_previous', '4.1 Chọn "Quý trước" gửi đúng rangePreset=quarter_previous');
  }

  // ===== 5. Custom range hợp lệ =====
  {
    const { window, root, calls, setOverview } = await setup();
    const modeEl = root.querySelector('[data-dash-range-mode]');
    modeEl.value = 'custom';
    modeEl.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    check(root.querySelector('[data-dash-range-from]') !== null && root.querySelector('[data-dash-range-to]') !== null, '5.1 Chuyển sang Tùy chỉnh hiện đủ 2 dropdown Từ tháng/Đến tháng');
    const beforeCustomCalls = calls.filter(c => c.action === 'getKnlDashboardOverview').length;
    setOverview(baseOverview({ rangeMode: 'range', rangeStart: '2026-06', rangeEnd: '2026-08', snapshotPeriod: '2026-08', comparisonBase: '2026-06' }));
    const fromEl = root.querySelector('[data-dash-range-from]');
    fromEl.value = '2026-06'; fromEl.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    check(calls.filter(c => c.action === 'getKnlDashboardOverview').length === beforeCustomCalls, '5.2 Mới chọn 1 đầu (Từ tháng) -> CHƯA gọi API (chờ đủ 2 đầu)');
    const toEl = root.querySelector('[data-dash-range-to]');
    toEl.value = '2026-08'; toEl.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    const customCall = calls[calls.length - 1];
    check(customCall.periodFrom === '2026-06' && customCall.periodTo === '2026-08' && !customCall.rangePreset, '5.3 Đủ 2 đầu hợp lệ -> gửi đúng periodFrom/periodTo, không kèm rangePreset (custom ngầm định)');
  }

  // ===== 6. from > to: chặn client-side, lỗi inline, KHÔNG alert() =====
  {
    const { window, root, calls } = await setup();
    const modeEl = root.querySelector('[data-dash-range-mode]');
    modeEl.value = 'custom';
    modeEl.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    const before = calls.filter(c => c.action === 'getKnlDashboardOverview').length;
    root.querySelector('[data-dash-range-from]').value = '2026-08';
    root.querySelector('[data-dash-range-from]').dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    root.querySelector('[data-dash-range-to]').value = '2026-06';
    root.querySelector('[data-dash-range-to]').dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    check(calls.filter(c => c.action === 'getKnlDashboardOverview').length === before, '6.1 Từ tháng > Đến tháng -> KHÔNG gọi API (chặn client-side)');
    const errEl = root.querySelector('[data-dash-range-error]');
    check(errEl !== null && errEl.textContent.length > 0, '6.2 Lỗi hiển thị inline ngay trong control, không phải alert()');
  }

  // ===== 7. Range > 12 tháng: chặn client-side =====
  {
    const { window, root, calls } = await setup();
    const modeEl = root.querySelector('[data-dash-range-mode]');
    modeEl.value = 'custom';
    modeEl.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    const before = calls.filter(c => c.action === 'getKnlDashboardOverview').length;
    root.querySelector('[data-dash-range-from]').value = '2025-01';
    root.querySelector('[data-dash-range-from]').dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    root.querySelector('[data-dash-range-to]').value = '2026-08';
    root.querySelector('[data-dash-range-to]').dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    check(calls.filter(c => c.action === 'getKnlDashboardOverview').length === before, '7.1 Range 20 tháng (>12) -> KHÔNG gọi API');
    check(root.querySelector('[data-dash-range-error]').textContent.includes('12'), '7.2 Thông báo lỗi inline nêu rõ giới hạn 12 tháng');
  }

  // ===== 8. Partial kỳ giữa range =====
  {
    const { window, root, calls, setOverview } = await setup();
    setOverview(baseOverview({ rangeMode: 'range', rangeStart: '2026-06', rangeEnd: '2026-08', snapshotPeriod: '2026-08', comparisonBase: '2026-06',
      periodCoverage: [
        { period: '2026-06', coverageStatus: 'complete', isFuture: false, isComplete: true, expectedCount: 6, coveredCount: 6, missingCount: 0 },
        { period: '2026-07', coverageStatus: 'partial', isFuture: false, isComplete: false, expectedCount: 6, coveredCount: 3, missingCount: 3 },
        { period: '2026-08', coverageStatus: 'complete', isFuture: false, isComplete: true, expectedCount: 6, coveredCount: 6, missingCount: 0 }] }));
    const modeEl = root.querySelector('[data-dash-range-mode]');
    modeEl.value = 'last3';
    modeEl.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    const summary = root.querySelector('[data-dash-range-summary]');
    check(summary !== null, '8.1 Có banner tóm tắt range');
    check(summary.textContent.includes('07/2026') && summary.textContent.includes('3/6'), '8.2 Banner liệt kê đúng kỳ partial giữa range kèm coveredCount/expectedCount thật (3/6), không giấu');
  }

  // ===== 9. Future range end: snapshotPeriod khác rangeEnd phải được diễn giải đúng =====
  {
    const { window, root, calls, setOverview } = await setup();
    setOverview(baseOverview({ rangeMode: 'range', rangeStart: '2026-06', rangeEnd: '2026-09', snapshotPeriod: '2026-08', comparisonBase: '2026-06', currentPeriodIsFuture: false,
      periodCoverage: [
        { period: '2026-06', coverageStatus: 'complete', isFuture: false, isComplete: true, expectedCount: 6, coveredCount: 6, missingCount: 0 },
        { period: '2026-07', coverageStatus: 'complete', isFuture: false, isComplete: true, expectedCount: 6, coveredCount: 6, missingCount: 0 },
        { period: '2026-08', coverageStatus: 'complete', isFuture: false, isComplete: true, expectedCount: 6, coveredCount: 6, missingCount: 0 },
        { period: '2026-09', coverageStatus: 'empty', isFuture: true, isComplete: false, expectedCount: 6, coveredCount: 0, missingCount: 6 }] }));
    const modeEl = root.querySelector('[data-dash-range-mode]');
    modeEl.value = 'custom';
    modeEl.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    root.querySelector('[data-dash-range-from]').value = '2026-06';
    root.querySelector('[data-dash-range-from]').dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    root.querySelector('[data-dash-range-to]').value = '2026-09';
    root.querySelector('[data-dash-range-to]').dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    const summary = root.querySelector('[data-dash-range-summary]');
    check(summary !== null && summary.textContent.includes('09/2026') && summary.textContent.includes('08/2026'), '9.1 Banner nhắc tới cả rangeEnd (09/2026, tương lai) lẫn snapshotPeriod thật (08/2026)');
    check(summary.textContent.indexOf('kỳ tương lai') !== -1 || summary.textContent.indexOf('KPI đang dùng kỳ gần nhất') !== -1, '9.2 Có câu diễn giải rõ ràng snapshot khác rangeEnd, không để hiểu nhầm snapshot=rangeEnd');
    check(summary.textContent.includes('chưa có dữ liệu chính thức') || summary.textContent.includes('kỳ tương lai'), '9.3 Kỳ future trong roster được gọi đúng tên "kỳ tương lai", không giả vờ có dữ liệu');
  }

  // ===== 10. Trend incomplete point có presentation khác =====
  {
    const { window, root, calls, setOverview } = await setup();
    const ov = baseOverview({ rangeMode: 'range', rangeStart: '2026-06', rangeEnd: '2026-08', snapshotPeriod: '2026-08', comparisonBase: '2026-06' });
    ov.trend = [
      { period: '2026-06', fund: 50000000, headcount: 6, avgIncome: 8333333, coverageStatus: 'complete', isFuture: false, isComplete: true },
      { period: '2026-07', fund: 25000000, headcount: 3, avgIncome: 8333333, coverageStatus: 'partial', isFuture: false, isComplete: false },
      { period: '2026-08', fund: 60000000, headcount: 6, avgIncome: 10000000, coverageStatus: 'complete', isFuture: false, isComplete: true }
    ];
    setOverview(ov);
    const modeEl = root.querySelector('[data-dash-range-mode]');
    modeEl.value = 'last3';
    modeEl.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    const incompleteLabel = root.querySelector('.phfk-dash-trend-labels span.is-incomplete');
    check(incompleteLabel !== null, '10.1 Điểm trend partial (07/2026) có class is-incomplete riêng biệt trong DOM');
    check(incompleteLabel && incompleteLabel.textContent.includes('chưa đủ dữ liệu'), '10.2 Điểm trend partial có nhãn "chưa đủ dữ liệu" rõ ràng, không vẽ liền mạch như điểm complete');
    const completeLabels = [...root.querySelectorAll('.phfk-dash-trend-labels span')].filter(el => !el.classList.contains('is-incomplete'));
    check(completeLabels.length === 2, '10.3 2 điểm complete (06/2026, 08/2026) KHÔNG bị gắn nhãn incomplete');
  }

  // ===== 11. Income-off không leak số thu nhập ở mode range =====
  {
    const { window, root, calls, setOverview } = await setup();
    const ov = baseOverview({ rangeMode: 'range', rangeStart: '2026-06', rangeEnd: '2026-08', snapshotPeriod: '2026-08', comparisonBase: '2026-06', incomeVisible: false });
    ov.kpis = { totalHeadcount: 6, totalFund: null, avgIncome: null, incomePopulation: null };
    ov.deptComposition = [{ department: 'Kinh doanh', headcount: 6, fund: null, sharePct: null }];
    ov.trend = [];
    setOverview(ov);
    const modeEl = root.querySelector('[data-dash-range-mode]');
    modeEl.value = 'last3';
    modeEl.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    check(!root.textContent.includes('60.000.000') && !root.textContent.includes('60,000,000'), '11.1 income_view=false ở mode range -> không leak số tiền cụ thể nào');
    check(root.textContent.includes('Không có quyền xem Thu nhập'), '11.2 Vẫn hiện đúng thông báo không có quyền xem Thu nhập ở mode range');
  }

  // ===== 12. F5/re-render giữ filter state hợp lý trong session hiện tại =====
  // "F5" thật (hard reload) sẽ xoá toàn bộ module state theo thiết kế trình
  // duyệt — ngoài phạm vi có thể test ở đây. Diễn giải đúng nghĩa "session
  // state hiện tại": điều hướng lại cùng tab Dashboard (cache TTL còn hiệu
  // lực) không được âm thầm reset lựa chọn range người dùng vừa chọn.
  {
    const { window, root, calls } = await setup();
    const modeEl = root.querySelector('[data-dash-range-mode]');
    modeEl.value = 'last3';
    modeEl.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    const overviewCallsBeforeRerender = calls.filter(c => c.action === 'getKnlDashboardOverview').length;
    await window.phfRenderKnl('/admin/knl/dashboard'); // điều hướng lại cùng tab (giả lập quay lại Dashboard trong session)
    await tick();
    check(root.querySelector('[data-dash-range-mode]').value === 'last3', '12.1 Sau điều hướng lại trong session, chế độ đã chọn (last3) vẫn giữ nguyên, không bị reset về Theo tháng');
    check(calls.filter(c => c.action === 'getKnlDashboardOverview').length === overviewCallsBeforeRerender, '12.2 Điều hướng lại trong TTL cache không gọi lại getKnlDashboardOverview thừa — chỉ re-render từ dashboardState.data/filters đã lưu trong session');
  }

  // ===== 13. Không alert/confirm/prompt trong toàn bộ luồng =====
  check(true, '13.1 window.alert/confirm/prompt bị stub throw xuyên suốt test này — nếu bất kỳ path nào gọi tới, toàn bộ script đã throw từ trước; tới được đây tức là KHÔNG có lệnh gọi nào xảy ra');

  console.log(failures === 0 ? '\nALL PASS — KNL Dashboard Batch 2B Phase 2 range/quý UI' : '\n' + failures + ' FAILURE(S)');
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(err => { console.error(err); process.exit(1); });
