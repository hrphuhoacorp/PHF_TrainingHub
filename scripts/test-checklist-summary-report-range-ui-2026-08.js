'use strict';
/*
 * Regression test — Báo cáo → Tổng hợp UI, mở rộng "Từ tháng/Đến tháng"
 * (assets/js/checklist/phf-checklist-app.js, 2026-08-19). Real-route JSDOM UI
 * test: window.eval code thật + window.phfRenderChecklist() + DOM thật, KHÔNG
 * gọi thẳng hàm component (cùng kỹ thuật với scripts/test-checklist-period-
 * monthly-results-ui-2026-08.js).
 *
 * Chạy: node scripts/test-checklist-summary-report-range-ui-2026-08.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const appPath = path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js');
const cssPath = path.resolve(__dirname, '..', 'assets/css/phf-checklist.css');
const code = fs.readFileSync(appPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

let failures = 0, passes = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else { passes++; console.log('PASS: ' + message); }
}
function tick(n) { return new Promise(resolve => setTimeout(resolve, n || 30)); }
function response(data) { return { ok: true, status: 200, json: async () => data }; }
function errorResponse(message, code_) { return { ok: false, status: 400, json: async () => ({ ok: false, message, code: code_ }) }; }

// forms: PHF001 (2026-07, reviewed, final=90) + PHF002 (2026-08, waiting_review, override
// SCORED=50 - KHÔNG hoàn thành dù finalScore!=null). PHF003: KHÔNG có phiếu (monthly_result-only,
// chỉ có trong scoreEntries) - đúng hợp đồng backend getChecklistMonthlyReport() sau 2026-08-19.
function summaryPayload(fromMonth, toMonth) {
  return {
    ok: true, month: toMonth, fromMonth, toMonth,
    periods: [{ month: toMonth, status: '' }],
    forms: [
      { id: 'F1', periodMonth: '2026-07', employeeCode: 'PHF001', employeeName: 'Một', department: 'Bán hàng', title: 'Nhân viên', branch: 'Ngô Quyền', currentDepartment: 'Bán hàng', currentBranch: 'Ngô Quyền', currentTitle: 'Nhân viên', reviewerCode: '', reviewerName: '', templateId: 'nv-ban-hang', templateVersion: 'BH-1.0', checklistScore: 90, checklistReviewScore: 90, selfTotalScore: 90, reviewTotalScore: 90, finalScore: 90, resultState: null, formulaVersion: '', status: 'reviewed', selfSubmittedAt: '2026-07-01T00:00:00Z', reviewSubmittedAt: '2026-07-02T00:00:00Z', reviewedAsOverride: false, reviewOverrideReason: '', overdueApplied: false, overdueMode: '', overdueSource: '', adminException: false, exceptionOpen: false, exceptionReason: '', historyCount: 0 },
      { id: 'F2', periodMonth: '2026-08', employeeCode: 'PHF002', employeeName: 'Hai', department: 'Bán hàng', title: 'Nhân viên', branch: 'Phú Lợi', currentDepartment: 'Bán hàng', currentBranch: 'Phú Lợi', currentTitle: 'Nhân viên', reviewerCode: '', reviewerName: '', templateId: 'nv-ban-hang', templateVersion: 'BH-1.0', checklistScore: 0, checklistReviewScore: 0, selfTotalScore: null, reviewTotalScore: null, finalScore: 50, resultState: 'SCORED', formulaVersion: '', status: 'waiting_review', selfSubmittedAt: '2026-08-01T00:00:00Z', reviewSubmittedAt: '', reviewedAsOverride: false, reviewOverrideReason: '', overdueApplied: false, overdueMode: '', overdueSource: '', adminException: false, exceptionOpen: false, exceptionReason: '', historyCount: 0 }
    ],
    violations: [],
    trend: [{ month: '2026-06', total: 0, completed: 0, average: 0 }, { month: '2026-07', total: 1, completed: 1, average: 90 }, { month: '2026-08', total: 1, completed: 0, average: 0 }],
    trendForms: [],
    scoreEntries: [
      { employeeCode: 'PHF001', periodMonth: '2026-07', currentDepartment: 'Bán hàng', currentBranch: 'Ngô Quyền', finalScore: 90 },
      { employeeCode: 'PHF002', periodMonth: '2026-08', currentDepartment: 'Bán hàng', currentBranch: 'Phú Lợi', finalScore: 50 },
      { employeeCode: 'PHF003', periodMonth: '2026-08', currentDepartment: 'Bán hàng', currentBranch: 'Ngô Quyền', finalScore: 70 }
    ],
    repeatSuggestions: [], repeatPolicy: { effectiveFromPeriod: '2026-08', monthlyWarningCount: 2, trainingOccurrenceCount: 3, trainingWindowMonths: 3, source: 'default' },
    scope: { role: 'admin', grant: null, count: 3, canExport: true }, generatedAt: '2026-08-19T00:00:00.000Z', generatedBy: 'Admin'
  };
}

async function buildDom(startPath) {
  const dom = new JSDOM(
    '<!doctype html><html><head><style>' + css + '</style></head><body><div id="phfChecklistRoot"></div></body></html>',
    { url: 'http://localhost' + startPath, runScripts: 'outside-only' }
  );
  const { window } = dom;
  window.phfGetSessionRole = () => 'admin';
  window.phfGetCurrentUser = () => ({ id: 'admin-1', employeeCode: 'PHF000', name: 'Admin' });
  window.phfGetAuthenticatedUser = window.phfGetCurrentUser;
  window.requestAnimationFrame = fn => setTimeout(fn, 0);
  window.requestIdleCallback = fn => setTimeout(fn, 0);
  window.scrollTo = () => {};
  window.__phfLocalData = { checklistTemplates: [], checklistTemplatesReady: true, checklistTemplatesError: '' };
  window.fetch = async () => response({ ok: true });
  window.eval(code);
  return dom;
}

(async () => {
  const dom = await buildDom('/admin/checklist/bao-cao');
  const { window } = dom;
  const calls = [];
  let nextReportResponse = response(summaryPayload('2026-07', '2026-08'));
  window.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body); calls.push(body);
    if (body.action === 'getChecklistMonthlyReport') return nextReportResponse;
    if (body.action === 'getChecklistViolationWorkflowSummary') return response({ ok: true, canView: false });
    return response({ ok: true });
  };

  await window.phfRenderChecklist('/admin/checklist/bao-cao');
  await tick(50);
  const root = window.document.getElementById('phfChecklistRoot');

  const fromInput = root.querySelector('[data-phfck-report-from]');
  const toInput = root.querySelector('[data-phfck-report-to]');
  check(!!fromInput && fromInput.type === 'month', 'Có input "Từ tháng" (type=month)');
  check(!!toInput && toInput.type === 'month', 'Có input "Đến tháng" (type=month)');
  check(fromInput && fromInput.value === '2026-07', 'Input "Từ tháng" đúng giá trị 2026-07, thực tế=' + (fromInput && fromInput.value));
  check(toInput && toInput.value === '2026-08', 'Input "Đến tháng" đúng giá trị 2026-08, thực tế=' + (toInput && toInput.value));
  check(!root.querySelector('[data-phfck-report-period]'), 'Select "Kỳ đánh giá" (1 tháng) cũ KHÔNG còn tồn tại');

  const html1 = root.innerHTML;
  check(html1.includes('từ tháng 07/2026 đến tháng 08/2026'), 'Tiêu đề hiển thị đúng nhãn khoảng "từ tháng 07/2026 đến tháng 08/2026" khi Từ tháng != Đến tháng');

  const kpiCards = [...root.querySelectorAll('.phfck-exec-kpis article')];
  const completionCard = kpiCards.find(a => a.textContent.includes('Hoàn thành đánh giá'));
  const avgCard = kpiCards.find(a => a.textContent.includes('Điểm trung bình'));
  check(!!completionCard && completionCard.textContent.includes('1/2'), 'KPI Hoàn thành đánh giá = 1/2 (chỉ PHF001 reviewed có final_score - form-based, không bị monthly_result "làm giả")');
  check(!!avgCard && avgCard.textContent.includes('70.0'), 'KPI Điểm trung bình = 70.0 (bình quân employee-month 90,50,70 của scoreEntries - gồm cả PHF003 không có phiếu), thực tế="' + (avgCard && avgCard.textContent) + '"');

  await record_singleMonth();
  await record_rangeChange();
  await record_invalidRangeError();
  await record_noLeak();
  await record_workflowSummaryRange();

  async function record_workflowSummaryRange() {
    calls.length = 0;
    nextReportResponse = response(summaryPayload('2026-07', '2026-08'));
    let workflowCall = null;
    const dom3 = await buildDom('/admin/checklist/bao-cao');
    dom3.window.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.action === 'getChecklistMonthlyReport') return response(summaryPayload('2026-07', '2026-08'));
      if (body.action === 'getChecklistViolationWorkflowSummary') { workflowCall = body; return response({ ok: true, canView: true, month: '2026-08', fromMonth: '2026-07', toMonth: '2026-08', summary: { total: 3, official: 3, cancelled: 0, waitingEmployee: 1, inExplanation: 0, waitingAdmin: 0, overdue: 1, dueSoon: 0, open: 1 }, scope: { scopeType: 'all_company', count: null } }); }
      return response({ ok: true });
    };
    await dom3.window.phfRenderChecklist('/admin/checklist/bao-cao');
    await tick(50);
    const root3 = dom3.window.document.getElementById('phfChecklistRoot');
    // Lần gọi ĐẦU (khi vào route) dùng range mặc định (chưa có reportUiState.fromMonth/toMonth) -
    // giống hệt hành vi cũ. Sau khi getChecklistMonthlyReport() trả về (đã set reportUiState.
    // fromMonth=2026-07/toMonth=2026-08 từ payload), bấm "Làm mới" để bắt lần gọi SAU - đây mới là
    // lần cần kiểm tra: panel phải theo ĐÚNG range đã resolve, không còn mặc định hôm nay.
    workflowCall = null;
    const reloadBtn = root3.querySelector('[data-phfck-report-reload]');
    check(!!reloadBtn, 'Có nút "Làm mới" để trigger lại workflow summary theo range đã resolve');
    reloadBtn.click();
    await tick(50);
    check(!!workflowCall, 'Panel "Tình trạng xử lý ghi nhận lỗi" đã gọi getChecklistViolationWorkflowSummary');
    check(workflowCall && workflowCall.fromMonth === '2026-07' && workflowCall.toMonth === '2026-08', 'Panel gửi ĐÚNG cả fromMonth/toMonth của range đang chọn (trước đây chỉ gửi Đến tháng), thực tế fromMonth=' + (workflowCall && workflowCall.fromMonth) + ' toMonth=' + (workflowCall && workflowCall.toMonth));
    check(root3.innerHTML.includes('Kỳ từ tháng 07/2026 đến tháng 08/2026'), 'Nhãn panel hiển thị ĐÚNG cả khoảng (không còn ngụ ý chỉ 1 tháng)');
  }

  async function record_singleMonth() {
    const dom2 = await buildDom('/admin/checklist/bao-cao');
    dom2.window.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.action === 'getChecklistMonthlyReport') return response(summaryPayload('2026-08', '2026-08'));
      if (body.action === 'getChecklistViolationWorkflowSummary') return response({ ok: true, canView: false });
      return response({ ok: true });
    };
    await dom2.window.phfRenderChecklist('/admin/checklist/bao-cao');
    await tick(50);
    const root2 = dom2.window.document.getElementById('phfChecklistRoot');
    check(root2.innerHTML.includes('tháng 08/2026') && !root2.innerHTML.toLowerCase().includes('từ tháng 08/2026 đến'), 'fromMonth===toMonth: nhãn tiêu đề giữ nguyên dạng đơn "tháng 08/2026" (tương thích 100% hành vi cũ)');
  }

  async function record_rangeChange() {
    calls.length = 0;
    nextReportResponse = response(summaryPayload('2026-07', '2026-09'));
    toInput.value = '2026-09';
    toInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick(50);
    const call = calls.find(c => c.action === 'getChecklistMonthlyReport');
    check(!!call, 'Đổi "Đến tháng" -> gọi lại getChecklistMonthlyReport');
    check(call && call.toMonth === '2026-09', 'Payload gửi đúng toMonth=2026-09, thực tế=' + (call && call.toMonth));
    check(call && call.fromMonth === '2026-07', 'fromMonth GIỮ NGUYÊN 2026-07 khi chỉ đổi Đến tháng, thực tế=' + (call && call.fromMonth));
  }

  async function record_invalidRangeError() {
    calls.length = 0;
    nextReportResponse = errorResponse('Từ tháng phải nhỏ hơn hoặc bằng Đến tháng.', 'CHECKLIST_REPORT_RANGE_INVALID');
    const fromInput2 = root.querySelector('[data-phfck-report-from]');
    fromInput2.value = '2026-12';
    fromInput2.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick(50);
    const toastHost = window.document.querySelector('[data-phfck-toast-host]');
    check(!!toastHost && toastHost.textContent.includes('Từ tháng phải nhỏ hơn hoặc bằng Đến tháng.'), 'Lỗi range từ backend (from>to) hiển thị qua toast ĐÚNG message thật (dữ liệu cũ vẫn hiển thị, không bị nuốt lỗi), thực tế="' + (toastHost && toastHost.textContent) + '"');
  }

  async function record_noLeak() {
    const leakPatterns = [/\bSCORED\b/, /\bNO_ASSESSMENT\b/, /\bresultState\b/, /\bhasForm\b/, /\bresult_only\b/, /employee_code/];
    leakPatterns.forEach(re => check(!re.test(root.innerHTML), 'Không lộ pattern kỹ thuật ' + re + ' ra HTML'));
  }

  console.log('\n=== Kết quả ===');
  console.log(passes + '/' + (passes + failures) + ' bước PASS.');
  console.log('Chạy thủ công khi cần: node scripts/test-checklist-summary-report-range-ui-2026-08.js');
  if (failures) process.exit(1);
})();
