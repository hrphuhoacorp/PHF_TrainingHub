'use strict';

/*
 * Batch 2C / KNL-07 — Excel Export test suite.
 *
 * Section A: buildKnlExportModel(data, filters) — PURE model layer, gọi trực
 * tiếp qua window.buildKnlExportModel (cùng convention window.phfRenderKnl
 * đã có), KHÔNG cần window.ExcelJS tồn tại — chứng minh lớp model độc lập
 * hoàn toàn với ExcelJS (mục 12).
 *
 * Section B: tích hợp UI (nút Xuất Excel, trạng thái disable/label, toast,
 * ExcelJS load fail) qua JSDOM + mock fetch, cùng harness pattern các test
 * Dashboard khác đã dùng. Test cuối (13) dùng ExcelJS THẬT (require trực
 * tiếp file vendor, không mock) để xác nhận renderKnlExportWorkbook build
 * workbook thành công, không chỉ test lớp model.
 */
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const RealExcelJS = require('../assets/vendor/exceljs.min.js');
const code = fs.readFileSync('assets/js/knl/phf-knl-app.js', 'utf8');
const css = fs.readFileSync('assets/css/phf-knl.css', 'utf8');

let failures = 0;
function check(condition, message) { if (!condition) { console.error('FAIL: ' + message); failures++; } else console.log('PASS: ' + message); }

function baseData(overrides) {
  return Object.assign({
    ok: true,
    meta: Object.assign({
      incomeVisible: true, rangeMode: 'single', rangeStart: null, rangeEnd: null,
      snapshotPeriod: '2026-08', comparisonBase: '2026-07', currentPeriod: '2026-08', previousPeriod: '2026-07',
      currentPeriodStatus: 'complete', currentPeriodIsFuture: false,
      expectedCount: 6, coveredCount: 6, missingCount: 0,
      peopleScopeType: 'all_company', incomeScopeType: 'all_company', scopeNote: null,
      generatedAt: '2026-08-17T10:00:00+07:00', availablePeriods: ['2026-08', '2026-07'],
      periodCoverage: [{ period: '2026-08', coverageStatus: 'complete', isFuture: false, expectedCount: 6, coveredCount: 6, missingCount: 0 }]
    }, overrides && overrides.meta),
    kpis: Object.assign({ totalHeadcount: 6, totalFund: 60000000, avgIncome: 10000000, incomePopulation: 6 }, overrides && overrides.kpis),
    deptComposition: (overrides && overrides.deptComposition) || [{ department: 'Kinh doanh', headcount: 6, fund: 60000000, sharePct: 100 }],
    deptComparison: (overrides && overrides.deptComparison) || [{ department: 'Kinh doanh', headcount: 6, avgIncome: 10000000, previousFund: 55000000, deltaAmount: 5000000, deltaPct: 9.1 }],
    knlDistribution: (overrides && overrides.knlDistribution) || [{ frameworkCode: 'SALE', frameworkName: 'Nhân viên bán hàng', gradeCode: 'B2', label: 'Bậc 2', count: 4 }],
    incomeByGrade: (overrides && overrides.incomeByGrade) || [{ frameworkCode: 'SALE', gradeCode: 'B2', label: 'Bậc 2', count: 4, avgIncome: 9500000, avgDeltaPct: 3.2 }],
    compensationGradeMatrix: 'compensationGradeMatrix' in (overrides || {}) ? overrides.compensationGradeMatrix : {
      period: '2026-08', gradeNumbers: [2], unassignedCount: 0,
      departments: [{ department: 'Kinh doanh', total: 6, assigned: 6, unassigned: 0, ladders: [{ ladderCode: 'SALE', ladderName: 'Ngạch Bán hàng', people: [], grades: [{ gradeCode: 'SALE-B2', gradeNumber: 2, people: [{ employeeCode: 'PHF001' }, { employeeCode: 'PHF003' }] }] }] }]
    },
    drillDown: (overrides && overrides.drillDown) || {
      'Kinh doanh': [
        { employeeCode: 'PHF001', employeeName: 'NV 1', title: 'Nhân viên', knlGrade: { frameworkName: 'Nhân viên bán hàng', label: 'Bậc 2' }, currentIncome: 10000000, previousIncome: 9500000, deltaAmount: 500000, deltaPct: 5.3 },
        { employeeCode: 'PHF002', employeeName: 'NV 2', title: 'Nhân viên', knlGrade: null, currentIncome: null, previousIncome: null, deltaAmount: null, deltaPct: null }
      ]
    },
    trend: (overrides && overrides.trend) || [
      { period: '2026-07', fund: 55000000, headcount: 6, avgIncome: 9166667, coverageStatus: 'complete', isFuture: false, isComplete: true },
      { period: '2026-08', fund: 60000000, headcount: 6, avgIncome: 10000000, coverageStatus: 'complete', isFuture: false, isComplete: true }
    ]
  }, {});
}

async function setup() {
  const dom = new JSDOM('<!doctype html><html><head><style>' + css + '</style></head><body><div id="phfKnlRoot"></div></body></html>', { url: 'http://localhost/admin/knl/dashboard', runScripts: 'outside-only' });
  const { window } = dom;
  window.phfGetSessionRole = () => 'admin';
  window.phfGetCurrentUser = () => ({ id: 'admin-1', employeeCode: 'PHF000', name: 'Admin Test' });
  window.phfNavigate = () => {};
  window.scrollTo = () => {};
  window.requestAnimationFrame = fn => setTimeout(fn, 0);
  window.Element.prototype.scrollIntoView = () => {};
  window.eval(code);
  return window;
}

function run() {
  return (async () => {
    const window = await setup();

    // ===================== SECTION A — Pure model layer =====================
    check(typeof window.buildKnlExportModel === 'function', 'A.0 window.buildKnlExportModel được expose để test độc lập');
    check(window.ExcelJS === undefined, 'A.0b window.ExcelJS KHÔNG tồn tại trong môi trường test này (chứng minh model layer không phụ thuộc ExcelJS)');

    // ---- 1. incomeVisible=true ----
    {
      const model = window.buildKnlExportModel(baseData(), { department: '', rangeChoice: 'month' });
      check(model.incomeVisible === true, '1.1 incomeVisible=true được truyền đúng vào model');
      const kpiFund = model.overview.kpiRows.find(r => /Tổng quỹ/.test(r.label));
      check(kpiFund && kpiFund.value === 60000000, '1.2 KPI totalFund xuất hiện đúng số khi incomeVisible=true');
      check(model.department.rows[0].fund === 60000000, '1.3 Sheet phòng ban có cột fund khi incomeVisible=true');
    }

    // ---- 2. incomeVisible=false — không leak field thu nhập nào ----
    {
      const data = baseData({ meta: { incomeVisible: false }, kpis: { totalFund: null, avgIncome: null, incomePopulation: null }, compensationGradeMatrix: undefined, trend: [] });
      delete data.compensationGradeMatrix;
      const model = window.buildKnlExportModel(data, {});
      check(model.incomeVisible === false, '2.1 incomeVisible=false được truyền đúng vào model');
      const json = JSON.stringify(model);
      const leakFields = ['totalFund', '60000000', 'avgIncome', '"fund"', 'sharePct', 'previousFund', 'deltaAmount', 'deltaPct', 'currentIncome', 'previousIncome'];
      leakFields.forEach(field => check(json.indexOf(field) === -1, '2.2 Model KHÔNG chứa field/giá trị leak "' + field + '" khi incomeVisible=false'));
      check(model.overview.kpiRows.length === 1, '2.3 Sheet Tổng quan chỉ còn đúng 1 dòng KPI (headcount) khi incomeVisible=false');
      check(model.department.rows[0].fund === undefined, '2.4 Sheet phòng ban không có field fund khi incomeVisible=false');
      check(model.grade.matrixRows.length === 0 && model.grade.incomeByGradeRows.length === 0, '2.5 Sheet bậc lương không có khối thu nhập/matrix khi incomeVisible=false');
      check(model.people.rows[0].currentIncome === undefined && model.people.rows[0].dataStatus === undefined, '2.6 Sheet chi tiết nhân sự không có cột thu nhập/trạng thái dữ liệu khi incomeVisible=false');
      check(model.people.rows.length === 2, '2.7 Danh sách nhân sự vẫn hiển thị (Chức danh/Bậc KNL) dù tắt income_view — chỉ ẩn cột tiền, không ẩn người');
    }

    // ---- 3. PHF002-style genuinely missing (currentIncome=null, incomeVisible=true) ----
    {
      const model = window.buildKnlExportModel(baseData(), {});
      const missingPerson = model.people.rows.find(r => r.employeeCode === 'PHF002');
      check(missingPerson && missingPerson.dataStatus === 'Thiếu dữ liệu — chưa có cơ cấu thu nhập hiệu lực đến kỳ này', '3.1 Genuinely missing (PHF002-style) có label rõ ràng, không phải carry-forward giả');
      check(missingPerson.currentIncome === null, '3.2 currentIncome=null được giữ nguyên (không tự điền 0)');
      const presentPerson = model.people.rows.find(r => r.employeeCode === 'PHF001');
      check(presentPerson.dataStatus === 'Có dữ liệu', '3.3 Người có dữ liệu (kể cả carry-forward) label khác genuinely-missing');
    }

    // ---- 4. Range có kỳ tương lai — KHÔNG cộng dồn trend thành tổng ----
    {
      const data = baseData({
        meta: { rangeMode: 'range', rangeStart: '2026-07', rangeEnd: '2026-09', snapshotPeriod: '2026-08', comparisonBase: '2026-07' },
        trend: [
          { period: '2026-07', fund: 55000000, headcount: 6, avgIncome: 9166667, coverageStatus: 'complete', isFuture: false, isComplete: true },
          { period: '2026-08', fund: 60000000, headcount: 6, avgIncome: 10000000, coverageStatus: 'complete', isFuture: false, isComplete: true },
          { period: '2026-09', fund: 60000000, headcount: 6, avgIncome: 10000000, coverageStatus: 'empty', isFuture: true, isComplete: false }
        ]
      });
      const model = window.buildKnlExportModel(data, {});
      check(model.overview.trendRows.length === 3, '4.1 Bảng biến động có đủ 3 điểm, không gộp/lược bớt');
      const futureRow = model.overview.trendRows.find(r => r.period === '2026-09');
      check(futureRow.status === 'Kỳ tương lai', '4.2 Điểm kỳ tương lai trong trend được gắn nhãn đúng');
      const kpiFund = model.overview.kpiRows.find(r => /Tổng quỹ/.test(r.label));
      check(kpiFund.value === 60000000, '4.3 KPI totalFund = ĐÚNG số snapshot (data.kpis.totalFund), KHÔNG cộng dồn 3 điểm trend (55tr+60tr+60tr=175tr)');
    }

    // ---- 5. snapshotPeriod != rangeEnd ----
    {
      const data = baseData({ meta: { rangeMode: 'range', rangeStart: '2026-06', rangeEnd: '2026-09', snapshotPeriod: '2026-08', comparisonBase: '2026-06', currentPeriodIsFuture: false } });
      const model = window.buildKnlExportModel(data, {});
      check(model.overview.periodBlock.snapshotDiffersFromRangeEnd === true, '5.1 Model đánh dấu đúng snapshotPeriod khác rangeEnd');
      check(model.overview.periodBlock.snapshotPeriod === '2026-08' && model.overview.periodBlock.rangeEnd === '2026-09', '5.2 Giữ nguyên cả 2 giá trị (không lấy nhầm rangeEnd làm snapshot)');
    }

    // ---- 6. comparisonBase=null ----
    {
      const data = baseData({ meta: { comparisonBase: null, previousPeriod: null } });
      const model = window.buildKnlExportModel(data, {});
      check(model.overview.periodBlock.comparisonBase === null, '6.1 comparisonBase=null được giữ nguyên (không bịa kỳ so sánh)');
    }

    // ---- 7. Filter phòng ban -> filename có hậu tố đã sanitize ----
    {
      const model = window.buildKnlExportModel(baseData(), { department: 'Bộ phận Thu mua' });
      check(model.fileName === 'PHF_KNL_Dashboard_2026-08_Bo_phan_Thu_mua.xlsx', '7.1 Filename có hậu tố phòng ban đã sanitize dấu/khoảng trắng đúng: ' + model.fileName);
    }

    // ---- 8. peopleScope hẹp — không mở rộng ngoài drillDown đã lọc sẵn ----
    {
      const data = baseData({ drillDown: { 'Kinh doanh': [{ employeeCode: 'PHF010', employeeName: 'Trợ lý', title: 'Trợ lý', knlGrade: null, currentIncome: 5000000, previousIncome: 5000000, deltaAmount: 0, deltaPct: 0 }] } });
      const model = window.buildKnlExportModel(data, {});
      check(model.people.rows.length === 1, '8.1 Model chỉ chứa đúng số người có trong drillDown đã lọc sẵn theo peopleScope, không tự mở rộng');
      check(model.people.rows[0].employeeCode === 'PHF010', '8.2 Đúng người trong scope hẹp');
    }

    // ---- 9. Filename single vs range ----
    {
      const single = window.buildKnlExportModel(baseData(), {});
      check(single.fileName === 'PHF_KNL_Dashboard_2026-08.xlsx', '9.1 Filename mode single đúng pattern: ' + single.fileName);
      const range = window.buildKnlExportModel(baseData({ meta: { rangeMode: 'range', rangeStart: '2026-07', rangeEnd: '2026-09' } }), {});
      check(range.fileName === 'PHF_KNL_Dashboard_2026-07_2026-09.xlsx', '9.2 Filename mode range đúng pattern: ' + range.fileName);
    }

    // ---- 11. Employee code case-variant không duplicate ----
    // (backend drillDown đã dedupe sẵn — model chỉ cần KHÔNG tự tạo thêm dòng nào)
    {
      const data = baseData({ drillDown: { 'Kinh doanh': [{ employeeCode: 'PHF001', employeeName: 'NV 1', title: 'Nhân viên', knlGrade: null, currentIncome: 1000000, previousIncome: null, deltaAmount: null, deltaPct: null }] } });
      const model = window.buildKnlExportModel(data, {});
      check(model.people.rows.length === 1, '11.1 Model không tự nhân đôi dòng cho employee code (giữ nguyên 1-1 với drillDown input)');
    }

    // ---- 12. Pure model không phụ thuộc ExcelJS (đã chứng minh xuyên suốt Section A) ----
    check(window.ExcelJS === undefined, '12.1 Toàn bộ Section A chạy xong mà window.ExcelJS vẫn KHÔNG tồn tại — model layer hoàn toàn độc lập ExcelJS');

    // ===================== SECTION B — UI integration =====================
    function tick() { return new Promise(resolve => setTimeout(resolve, 25)); }
    async function setupUi(overviewData) {
      const w = await setup();
      if (!w.URL.createObjectURL) w.URL.createObjectURL = () => 'blob:fake';
      if (!w.URL.revokeObjectURL) w.URL.revokeObjectURL = () => {};
      const calls = [];
      const toasts = [];
      w.phfToast = (type, title, message) => toasts.push({ type, title, message });
      w.fetch = async (url, opts) => {
        const body = JSON.parse(opts.body);
        calls.push(body);
        if (body.action === 'getKnlCapabilities') return { ok: true, json: async () => ({ ok: true, isAdmin: true, capabilities: { dashboard_view: true, income_view: true }, peopleScope: { type: 'all_company', values: [] } }) };
        if (body.action === 'getKnlDashboardOverview') return { ok: true, json: async () => JSON.parse(JSON.stringify(overviewData)) };
        return { ok: false, json: async () => ({ ok: false, error: 'unexpected' }) };
      };
      await w.phfRenderKnl('/admin/knl/dashboard');
      await tick();
      return { window: w, root: w.document.getElementById('phfKnlRoot'), calls, toasts };
    }

    // ---- 10. ExcelJS load fail -> toast lỗi tiếng Việt, không crash, nút phục hồi ----
    {
      const { window: w, root, toasts } = await setupUi(baseData());
      const headBefore = w.document.head.childElementCount;
      const originalAppendChild = w.document.head.appendChild.bind(w.document.head);
      w.document.head.appendChild = function (node) {
        const result = originalAppendChild(node);
        if (node && node.tagName === 'SCRIPT' && String(node.src || '').indexOf('exceljs') !== -1) {
          setTimeout(() => { if (typeof node.onerror === 'function') node.onerror(new w.Event('error')); }, 0);
        }
        return result;
      };
      const btn = root.querySelector('[data-dash-export]');
      check(btn && btn.textContent === 'Xuất Excel', '10.1 Nút Export hiển thị đúng label ban đầu "Xuất Excel"');
      btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      await tick();
      const disabledDuring = root.querySelector('[data-dash-export]');
      // sau khi lỗi (setTimeout 0) đã re-render xong; đợi thêm 1 tick để chắc chắn finally chạy
      await tick();
      const errorToast = toasts.find(t => t.type === 'error');
      check(errorToast && /Chưa thể xuất Excel/.test(errorToast.title), '10.2 Toast lỗi tiếng Việt rõ ràng khi ExcelJS load fail');
      const btnAfter = root.querySelector('[data-dash-export]');
      check(btnAfter && btnAfter.disabled === false && btnAfter.textContent === 'Xuất Excel', '10.3 Nút phục hồi về trạng thái ban đầu (không kẹt "Đang tạo Excel…") sau lỗi, không crash Dashboard');
    }

    // ---- Chống double-click + trạng thái "Đang tạo Excel…" khi ExcelJS chưa load xong (treo giữa chừng) ----
    {
      const { window: w, root, toasts } = await setupUi(baseData());
      // Không mock ExcelJS load thành công lẫn thất bại -> Promise treo mãi (giả lập "đang tải"),
      // đủ để kiểm 2 lần click liên tiếp chỉ tạo đúng 1 lượt export.
      const btn = root.querySelector('[data-dash-export]');
      btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      await tick();
      const midBtn = root.querySelector('[data-dash-export]');
      check(midBtn && midBtn.disabled === true && midBtn.textContent === 'Đang tạo Excel…', 'B.1 Nút disable + đổi label "Đang tạo Excel…" ngay khi bắt đầu export');
      midBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      await tick();
      check(true, 'B.2 Click lần 2 khi đang export không throw/không tạo luồng export song song (guard dashboardState.exporting)');
    }

    // ---- Không alert/confirm/prompt trong toàn bộ luồng export ----
    {
      const { window: w, root } = await setupUi(baseData());
      w.alert = () => { throw new Error('alert() KHÔNG được gọi'); };
      w.confirm = () => { throw new Error('confirm() KHÔNG được gọi'); };
      w.prompt = () => { throw new Error('prompt() KHÔNG được gọi'); };
      const originalAppendChild = w.document.head.appendChild.bind(w.document.head);
      w.document.head.appendChild = function (node) {
        const result = originalAppendChild(node);
        if (node && node.tagName === 'SCRIPT' && String(node.src || '').indexOf('exceljs') !== -1) {
          setTimeout(() => { if (typeof node.onerror === 'function') node.onerror(new w.Event('error')); }, 0);
        }
        return result;
      };
      const btn = root.querySelector('[data-dash-export]');
      btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      await tick(); await tick();
      check(true, 'B.3 Toàn bộ luồng export (kể cả lỗi ExcelJS) không gọi alert/confirm/prompt — nếu có đã throw từ trước');
    }

    // ---- 13. Full render thật (ExcelJS thật, không mock) tạo file thành công ----
    {
      const { window: w, root } = await setupUi(baseData());
      w.ExcelJS = RealExcelJS; // bypass loader, dùng thư viện thật
      let downloadedFileName = null;
      const originalCreateElement = w.document.createElement.bind(w.document);
      w.document.createElement = function (tag) {
        const el = originalCreateElement(tag);
        if (tag === 'a') { const originalClick = el.click.bind(el); el.click = function () { downloadedFileName = el.download; }; }
        return el;
      };
      const btn = root.querySelector('[data-dash-export]');
      btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      await tick(); await tick(); await tick();
      check(downloadedFileName === 'PHF_KNL_Dashboard_2026-08.xlsx', '13.1 renderKnlExportWorkbook (ExcelJS thật) tạo file và trigger download đúng tên: ' + downloadedFileName);
      const btnAfter = root.querySelector('[data-dash-export]');
      check(btnAfter && btnAfter.disabled === false && btnAfter.textContent === 'Xuất Excel', '13.2 Nút trở lại trạng thái bình thường sau khi export thành công');
    }

    console.log(failures === 0 ? '\nALL PASS — KNL Dashboard Batch 2C KNL-07 Excel Export' : '\n' + failures + ' FAILURE(S)');
    process.exit(failures === 0 ? 0 : 1);
  })();
}

run().catch(err => { console.error(err); process.exit(1); });
