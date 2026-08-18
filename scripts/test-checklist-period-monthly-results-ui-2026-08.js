'use strict';
/*
 * Hotfix "Theo kỳ" (2026-08-18) — Real-route JSDOM UI test cho Điểm cuối đọc
 * checklist_monthly_results. Cùng kỹ thuật với scripts/test-checklist-annual-
 * result-ui-2026-08.js (window.eval code thật + window.phfRenderChecklist() +
 * click DOM thật, KHÔNG gọi thẳng hàm component).
 *
 * Chạy: node scripts/test-checklist-period-monthly-results-ui-2026-08.js
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

const PERIODS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
function emptyCell(dept, branch) { return { hasForm: false, formId: null, status: '', checklistScore: null, selfTotalScore: null, reviewTotalScore: null, finalScore: null, department: dept, branch: branch, title: '', reviewerName: '', reviewSubmittedAt: '', templateId: '', templateVersion: '', resultState: null }; }
function periodsWith(overrides, dept, branch) {
  const out = {};
  PERIODS.forEach(m => { out[m] = overrides[m] ? { ...emptyCell(dept, branch), ...overrides[m] } : emptyCell(dept, branch); });
  return out;
}

const PERIOD_PAYLOAD = {
  ok: true, fromMonth: '2026-01', toMonth: '2026-07', periods: PERIODS,
  employees: [
    {
      employeeCode: 'PHF084', employeeName: 'Nguyễn Văn Tám Tư',
      periods: periodsWith({ '2026-07': { hasForm: true, formId: 'F-084-07', status: 'waiting_self', resultState: 'SCORED', finalScore: 0 } }, 'Bán hàng', 'Ngô Quyền')
    },
    {
      employeeCode: 'PHF018', employeeName: 'Trần Thị Mười Tám',
      periods: periodsWith({ '2026-04': { resultState: 'NO_ASSESSMENT', finalScore: null } }, 'Bán hàng', 'Phú Lợi')
    },
    {
      employeeCode: 'PHF091', employeeName: 'Phạm Văn Chín Mốt',
      periods: periodsWith({ '2026-07': { resultState: 'PROBATION', finalScore: null } }, 'Bán hàng', 'Ngô Quyền')
    },
    {
      employeeCode: 'PHF092', employeeName: 'Võ Thị Chín Hai',
      periods: periodsWith({ '2026-07': { resultState: 'NO_DATA', finalScore: null } }, 'Bán hàng', 'Phú Lợi')
    },
    {
      employeeCode: 'PHF060', employeeName: 'Lê Thị Sáu Mươi',
      periods: periodsWith({ '2026-07': { hasForm: true, formId: 'F-060-07', status: 'locked', checklistScore: 100, selfTotalScore: 90, reviewTotalScore: 92, finalScore: 91.33, resultState: null } }, 'Bán hàng', 'Ngô Quyền')
    }
  ],
  scope: { role: 'admin', grant: null, count: 5 }, generatedAt: '2026-08-18T00:00:00.000Z', generatedBy: 'Admin'
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

function rowCellsByCode(root, code) {
  const rows = [...root.querySelectorAll('tbody tr')];
  const row = rows.find(r => r.textContent.includes(code));
  return row ? [...row.querySelectorAll('td')].map(td => td.textContent.trim()) : null;
}

(async () => {
  const dom = await buildDom('/admin/checklist/bao-cao');
  const { window } = dom;
  const calls = [];
  window.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body); calls.push(body);
    if (body.action === 'getChecklistScorePeriodReport') return response(PERIOD_PAYLOAD);
    if (body.action === 'getChecklistMonthlyReport') return response({ ok: true, month: '2026-08', periods: [], forms: [], violations: [], trend: [], repeatSuggestions: [], repeatPolicy: {}, scope: { role: 'admin', grant: null, count: 0, canExport: true } });
    if (body.action === 'getChecklistViolationWorkflowSummary') return response({ ok: true, canView: false });
    return response({ ok: true });
  };

  await window.phfRenderChecklist('/admin/checklist/bao-cao');
  await tick();
  const root = window.document.getElementById('phfChecklistRoot');

  [...root.querySelectorAll('[data-phfck-report-view]')].find(b => b.getAttribute('data-phfck-report-view') === 'checklist-score').click();
  await tick();
  const periodBtn = [...root.querySelectorAll('[data-phfck-score-mode]')].find(b => b.getAttribute('data-phfck-score-mode') === 'period');
  check(!!periodBtn, 'Tab "Theo kỳ" tồn tại trong Điểm Checklist');
  periodBtn.click();
  await tick(50);

  const periodCall = calls.find(c => c.action === 'getChecklistScorePeriodReport');
  check(!!periodCall, 'Đã gọi action getChecklistScorePeriodReport khi mở tab Theo kỳ');

  const table = root.querySelector('.phfck-score-period-table');
  check(!!table, 'Bảng Theo kỳ được render');

  // ==== Chế độ mặc định "Chỉ điểm cuối" (7 kỳ > 4 -> cols=1/kỳ) ====
  {
    const c084 = rowCellsByCode(root, 'PHF084');
    check(!!c084, 'Có dòng PHF084');
    check(c084[8] === '0.00', 'B: PHF084/2026-07 SCORED=0 -> Điểm cuối = "0.00" (KHÔNG phải "—"), cell=' + (c084 && c084[8]));

    const c018 = rowCellsByCode(root, 'PHF018');
    check(c018[5] === 'Không đánh giá', 'C: PHF018/2026-04 NO_ASSESSMENT -> "Không đánh giá", cell=' + (c018 && c018[5]));

    const c091 = rowCellsByCode(root, 'PHF091');
    check(c091[8] === 'Thử việc', 'D: PHF091/2026-07 PROBATION -> "Thử việc", cell=' + (c091 && c091[8]));

    const c092 = rowCellsByCode(root, 'PHF092');
    check(c092[8] === '—', 'E: PHF092/2026-07 NO_DATA -> "—", cell=' + (c092 && c092[8]));

    const c060 = rowCellsByCode(root, 'PHF060');
    check(c060[8] === '91.33', 'G: PHF060/2026-07 (live thật, không có monthly_result) -> vẫn 91.33 như cũ, không regression, cell=' + (c060 && c060[8]));
  }

  // ==== Toggle "Đầy đủ" (cols=3/kỳ: Tự đánh / Thẩm định / Điểm cuối) ====
  {
    const fullBtn = [...root.querySelectorAll('[data-phfck-score-period-view]')].find(b => b.getAttribute('data-phfck-score-period-view') === 'full');
    check(!!fullBtn, 'Có nút chuyển "Đầy đủ"');
    fullBtn.click();
    await tick(30);
    const c084 = rowCellsByCode(root, 'PHF084');
    // header: Mã NV, Họ tên, rồi mỗi kỳ 3 cột (Tự đánh, Thẩm định, Điểm cuối) x 7 kỳ -> kỳ 07 = cột thứ 3
    const period07StartIdx = 2 + 6 * 3;
    check(c084[period07StartIdx] === '—', 'F: "Đầy đủ" - PHF084/07 baseline có shell form rỗng -> Tự đánh vẫn "—", cell=' + c084[period07StartIdx]);
    check(c084[period07StartIdx + 1] === '—', 'F: "Đầy đủ" - PHF084/07 -> Thẩm định vẫn "—", cell=' + c084[period07StartIdx + 1]);
    check(c084[period07StartIdx + 2] === '0.00', 'F: "Đầy đủ" - PHF084/07 -> Điểm cuối vẫn lấy monthly_result "0.00" (không giả lập workflow), cell=' + c084[period07StartIdx + 2]);
  }

  // ==== Không lộ enum/technical field ra HTML ====
  const html = root.innerHTML;
  const leakPatterns = [/SCORED/, /NO_ASSESSMENT/, /\bPROBATION\b/, /\bNO_DATA\b/, /resultState/, /hasForm/, /employee_code/];
  leakPatterns.forEach(re => check(!re.test(html), 'Không lộ pattern kỹ thuật ' + re + ' ra HTML'));

  // ==== H/I. "Hiện tại" vẫn hoạt động không regression ====
  {
    const dom2 = await buildDom('/admin/checklist/bao-cao');
    dom2.window.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.action === 'getChecklistCurrentScoreReport') return response({ ok: true, month: '2026-08', employees: [{ employeeCode: 'PHF001', employeeName: 'A', department: 'D', branch: 'B', currentScore: 95, violationCount: 0, managerName: '', hasMonthlyForm: false }], summary: { total: 1, averageScore: 95, belowThresholdCount: 0, cleanCount: 1 }, scope: { role: 'admin', grant: null, count: 1 } });
      return response({ ok: true, forms: [], violations: [], trend: [], repeatSuggestions: [], scope: { canExport: true } });
    };
    dom2.window.eval(code);
    await dom2.window.phfRenderChecklist('/admin/checklist/bao-cao');
    await tick();
    const root2 = dom2.window.document.getElementById('phfChecklistRoot');
    [...root2.querySelectorAll('[data-phfck-report-view]')].find(b => b.getAttribute('data-phfck-report-view') === 'checklist-score').click();
    await tick(50);
    check(root2.innerHTML.includes('95.00') || root2.innerHTML.includes('95'), 'H: "Hiện tại" mode vẫn render đúng điểm hiện tại (không bị hotfix Theo kỳ ảnh hưởng)');
  }

  console.log('\n' + passes + ' passed, ' + failures + ' failed.');
  process.exitCode = failures ? 1 : 0;
})().catch(e => { console.error('FATAL', e && e.stack || e); process.exitCode = 1; });
