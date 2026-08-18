'use strict';
/*
 * PHF Checklist — Annual Result Report "Cả năm" (Phase 2, 2026-08-18).
 * Real-route JSDOM UI test: /admin/checklist/bao-cao -> tab "Điểm Checklist"
 * -> mode "Cả năm". Same technique as scripts/test-checklist-template-score-
 * editor-2026-08.js (window.eval code thật + window.phfRenderChecklist() +
 * click DOM thật) - KHÔNG gọi thẳng hàm component.
 *
 * Chạy: node scripts/test-checklist-annual-result-ui-2026-08.js
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

const ANNUAL_PAYLOAD = {
  ok: true, year: '2026',
  periods: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'],
  employees: [
    {
      employeeCode: 'PHF060', employeeName: 'Nguyễn Thiên Trúc', department: 'Bán hàng', branch: 'Phú Lợi',
      periods: {
        '2026-01': { hasResult: true, resultState: 'SCORED', score: 98.73 },
        '2026-02': { hasResult: true, resultState: 'SCORED', score: 0 }, // SCORED=0 phải hiện "0", không phải "—"
        '2026-03': { hasResult: true, resultState: 'NO_ASSESSMENT', score: null },
        '2026-04': { hasResult: true, resultState: 'PROBATION', score: null },
        '2026-05': { hasResult: true, resultState: 'NO_DATA', score: null },
        '2026-06': { hasResult: false, resultState: null, score: null }, // không có kết quả authoritative
        '2026-07': { hasResult: true, resultState: 'SCORED', score: 100 },
        '2026-08': { hasResult: false, resultState: null, score: null },
        '2026-09': { hasResult: false, resultState: null, score: null },
        '2026-10': { hasResult: false, resultState: null, score: null },
        '2026-11': { hasResult: false, resultState: null, score: null },
        '2026-12': { hasResult: false, resultState: null, score: null }
      },
      average: 66.24, scoredMonthCount: 3
    },
    {
      employeeCode: 'PHF999', employeeName: 'Không Có Điểm Nào', department: 'Kế toán', branch: 'Ngô Quyền',
      periods: { '2026-01': { hasResult: true, resultState: 'PROBATION', score: null } },
      average: null, scoredMonthCount: 0
    }
  ],
  scope: { role: 'admin', grant: null, count: 2 }, generatedAt: '2026-08-18T00:00:00.000Z', generatedBy: 'Admin'
};

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
  // ==== 1. Real route -> Điểm Checklist tab -> Cả năm mode, real fetch payload ====
  const dom = await buildDom('/admin/checklist/bao-cao');
  const { window } = dom;
  const calls = [];
  window.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body); calls.push(body);
    if (body.action === 'getChecklistAnnualResultReport') return response(ANNUAL_PAYLOAD);
    if (body.action === 'getChecklistMonthlyReport') return response({ ok: true, month: '2026-08', periods: [], forms: [], violations: [], trend: [], repeatSuggestions: [], repeatPolicy: {}, scope: { role: 'admin', grant: null, count: 0, canExport: true } });
    if (body.action === 'getChecklistViolationWorkflowSummary') return response({ ok: true, canView: false });
    return response({ ok: true });
  };

  await window.phfRenderChecklist('/admin/checklist/bao-cao');
  await tick();
  const root = window.document.getElementById('phfChecklistRoot');

  // Click "Điểm Checklist" top tab
  const scoreTabBtn = [...root.querySelectorAll('[data-phfck-report-view]')].find(b => b.getAttribute('data-phfck-report-view') === 'checklist-score');
  check(!!scoreTabBtn, 'Tab "Điểm Checklist" tồn tại trong Báo cáo');
  scoreTabBtn.click();
  await tick();

  // Click "Cả năm" mode tab
  const annualBtn = [...root.querySelectorAll('[data-phfck-score-mode]')].find(b => b.getAttribute('data-phfck-score-mode') === 'annual');
  check(!!annualBtn, 'Tab "Cả năm" tồn tại trong Điểm Checklist');
  annualBtn.click();
  await tick(50);

  const annualCall = calls.find(c => c.action === 'getChecklistAnnualResultReport');
  check(!!annualCall, 'Đã gọi action getChecklistAnnualResultReport khi mở tab Cả năm');

  const table = root.querySelector('.phfck-score-period-table');
  check(!!table, 'Bảng Cả năm được render');
  const html = root.innerHTML;

  // ==== 2. Header có T1..T12 và cột Bình quân ====
  check(/>T1</.test(html) && /T12/.test(html), 'Header có cột T1..T12');
  check(/Bình quân/.test(html), 'Header có cột Bình quân');

  // ==== 3/4/5/6/7. Result-state display rules ====
  check(html.includes('98.73'), 'SCORED hiển thị đúng số (98.73)');
  // SCORED=0 phải hiện "0.00" (checklistScoreValueHtml dùng toFixed(2)) - KHÔNG được là "—"/rỗng.
  const rows = [...table.querySelectorAll('tbody tr')];
  const phf060Row = rows.find(r => r.textContent.includes('PHF060'));
  check(!!phf060Row, 'Có dòng PHF060');
  const cellsText = [...phf060Row.querySelectorAll('td')].map(td => td.textContent.trim());
  check(cellsText[4] === '98.73', 'T1 (SCORED 98.73) hiển thị đúng số, cell=' + cellsText[4]);
  check(cellsText[5] === '0.00', 'T2 SCORED=0 hiển thị "0.00", KHÔNG phải "—"/rỗng, cell=' + cellsText[5]);
  check(cellsText[6] === 'Không đánh giá', 'T3 NO_ASSESSMENT hiển thị "Không đánh giá", cell=' + cellsText[6]);
  check(cellsText[7] === 'Thử việc', 'T4 PROBATION hiển thị "Thử việc", cell=' + cellsText[7]);
  check(cellsText[8] === '—', 'T5 NO_DATA hiển thị "—", cell=' + cellsText[8]);
  check(cellsText[9] === '—', 'T6 (không có kết quả authoritative) hiển thị "—", cell=' + cellsText[9]);

  // ==== 8. Bình quân đúng công thức (chỉ SCORED, kể cả 0) ====
  check(cellsText[cellsText.length - 1] === '66.24', 'Bình quân PHF060 hiển thị đúng giá trị backend trả (66.24, chỉ tính tháng SCORED)');
  const phf999Row = rows.find(r => r.textContent.includes('PHF999'));
  const p999Cells = [...phf999Row.querySelectorAll('td')].map(td => td.textContent.trim());
  check(p999Cells[p999Cells.length - 1] === '—', 'Nhân sự không có tháng SCORED nào -> Bình quân hiển thị "—", KHÔNG phải "0"');

  // ==== 9. Không lộ enum/UUID/technical field name ra HTML hiển thị ====
  const leakPatterns = [/SCORED/, /NO_ASSESSMENT/, /PROBATION\b.*enum/i, /BASELINE_IMPORT/, /source_batch_id/, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, /resultState/, /hasResult/];
  leakPatterns.forEach(re => check(!re.test(html), 'Không lộ pattern kỹ thuật ' + re + ' ra HTML'));
  check(!html.includes('employee_code'), 'Không lộ tên field kỹ thuật employee_code (snake_case) ra HTML');

  // ==== filters present (Năm/Phòng ban/Chi nhánh/Tìm/Làm mới) ====
  check(!!root.querySelector('[data-phfck-score-annual-year]'), 'Có bộ lọc Năm');
  check(!!root.querySelector('[data-phfck-score-annual-department]'), 'Có bộ lọc Phòng ban');
  check(!!root.querySelector('[data-phfck-score-annual-branch]'), 'Có bộ lọc Chi nhánh');
  check(!!root.querySelector('[data-phfck-score-annual-search]'), 'Có ô tìm kiếm');
  check(!!root.querySelector('[data-phfck-score-annual-reload]'), 'Có nút Làm mới');

  // ==== no native alert/confirm/prompt used by this feature (structural: not in new code block) ====
  const newCodeStart = code.indexOf('function checklistScoreAnnualYearValue');
  const newCodeEnd = code.indexOf('function checklistScoreDashboardHtml');
  const newCode = code.slice(newCodeStart, newCodeEnd);
  check(!/\balert\(|\bconfirm\(|\bprompt\(/.test(newCode), 'Code mới không dùng alert()/confirm()/prompt() native');

  // ==== 10. Empty state ====
  {
    const dom2 = await buildDom('/admin/checklist/bao-cao');
    dom2.window.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.action === 'getChecklistAnnualResultReport') return response({ ok: true, year: '2026', periods: [], employees: [], scope: { role: 'admin', grant: null, count: 0 } });
      return response({ ok: true, forms: [], violations: [], trend: [], repeatSuggestions: [], scope: { canExport: true } });
    };
    dom2.window.eval(code);
    await dom2.window.phfRenderChecklist('/admin/checklist/bao-cao');
    await tick();
    const root2 = dom2.window.document.getElementById('phfChecklistRoot');
    [...root2.querySelectorAll('[data-phfck-report-view]')].find(b => b.getAttribute('data-phfck-report-view') === 'checklist-score').click();
    await tick();
    [...root2.querySelectorAll('[data-phfck-score-mode]')].find(b => b.getAttribute('data-phfck-score-mode') === 'annual').click();
    await tick(50);
    check(/Chưa có kết quả trong phạm vi đang xem/.test(root2.innerHTML), 'Empty state tiếng Việt rõ ràng khi không có kết quả');
  }

  // ==== W/X. Existing "Hiện tại"/"Theo kỳ" vẫn hoạt động không đổi ====
  {
    const dom3 = await buildDom('/admin/checklist/bao-cao');
    dom3.window.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.action === 'getChecklistCurrentScoreReport') return response({ ok: true, month: '2026-08', employees: [{ employeeCode: 'PHF001', employeeName: 'A', department: 'D', branch: 'B', currentScore: 95, violationCount: 0, managerName: '', hasMonthlyForm: false }], summary: { total: 1, averageScore: 95, belowThresholdCount: 0, cleanCount: 1 }, scope: { role: 'admin', grant: null, count: 1 } });
      if (body.action === 'getChecklistScorePeriodReport') return response({ ok: true, fromMonth: '2026-08', toMonth: '2026-08', periods: ['2026-08'], employees: [{ employeeCode: 'PHF001', employeeName: 'A', periods: { '2026-08': { hasForm: true, formId: 'f1', status: 'locked', checklistScore: 95, selfTotalScore: 95, reviewTotalScore: 95, finalScore: 95, department: 'D', branch: 'B', title: '', reviewerName: '', reviewSubmittedAt: '', templateId: '', templateVersion: '' } } }], scope: { role: 'admin', grant: null, count: 1 } });
      return response({ ok: true, forms: [], violations: [], trend: [], repeatSuggestions: [], scope: { canExport: true } });
    };
    dom3.window.eval(code);
    await dom3.window.phfRenderChecklist('/admin/checklist/bao-cao');
    await tick();
    const root3 = dom3.window.document.getElementById('phfChecklistRoot');
    [...root3.querySelectorAll('[data-phfck-report-view]')].find(b => b.getAttribute('data-phfck-report-view') === 'checklist-score').click();
    await tick(50);
    check(root3.innerHTML.includes('95.00') || root3.innerHTML.includes('95'), '"Hiện tại" mode vẫn render đúng điểm hiện tại (không bị Phase 2 ảnh hưởng)');

    const periodBtn = [...root3.querySelectorAll('[data-phfck-score-mode]')].find(b => b.getAttribute('data-phfck-score-mode') === 'period');
    periodBtn.click();
    await tick(50);
    check(root3.innerHTML.includes('PHF001') && root3.innerHTML.includes('A'), '"Theo kỳ" mode vẫn render đúng dữ liệu form-based (không bị Phase 2 ảnh hưởng)');
  }

  console.log('\n' + passes + ' passed, ' + failures + ' failed.');
  process.exitCode = failures ? 1 : 0;
})().catch(e => { console.error('FATAL', e && e.stack || e); process.exitCode = 1; });
