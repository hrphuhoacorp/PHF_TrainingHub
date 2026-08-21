'use strict';
/* Workstream A3 (2026-08-14, ORIGINAL) — wizard 8 bước "Áp dụng lại mẫu" độc lập,
   route riêng /admin/checklist/ap-dung-lai-mau.
   ---------------------------------------------------------------------------
   Workstream A UI reorg (2026-08-14, SUPERSEDES the above) — theo quyết định
   nghiệp vụ chốt cuối, wizard 8 bước độc lập đã dissolve vào màn "Mẫu Checklist"
   (nút "Sửa Bảng tổng điểm" + modal 3 bước "Cập nhật Phiếu tháng hiện có" trong
   templatesHtml()). Route /admin/checklist/ap-dung-lai-mau KHÔNG còn render trang
   wizard cũ — nó redirect an toàn sang /admin/checklist/mau (xem
   normalizeAdminRetroRoute() trong assets/js/checklist/phf-checklist-app.js).

   checklistRetroWizardHtml() và toàn bộ state/hàm crw* bên dưới nó trong file
   nguồn KHÔNG bị xóa (vẫn là engine thật đứng sau UI mới), nhưng bài test cũ ở
   file này click thẳng vào các data-phfck-retro-* của TRANG WIZARD ĐỘC LẬP —
   route đó không còn tồn tại trong app thật nữa nên các assertion cũ (bước 1-8
   qua route riêng) không còn phản ánh đường đi thật của người dùng và ĐÃ ĐƯỢC
   THAY THẾ bởi bài test mới, bao phủ ĐẦY ĐỦ cùng nghiệp vụ (copy version, edit
   Bảng tổng điểm, validate, preview diff thật, publish không mutate version cũ,
   3 bước Cập nhật Phiếu tháng hiện có với dry-run/apply/reviewed-form/locked-
   cancelled-exclusion thật, permission 403, idempotency) NHƯNG đi qua đúng route
   thật /admin/checklist/mau:
     scripts/test-checklist-template-score-editor-2026-08.js

   File này giờ chỉ còn giữ lại đúng 1 việc: xác nhận route cũ không còn là một
   trang mồ côi (orphaned) - nó phải redirect an toàn, không 404, không còn hiện
   lại trang wizard 8 bước cũ.
   Chạy: node scripts/test-checklist-retro-wizard-ui-2026-08.js
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
  else { passes++; }
}
function tick(n) { return new Promise(resolve => setTimeout(resolve, n || 30)); }
function response(data) { return { ok: true, status: 200, json: async () => data }; }

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
  // 1. Direct/deep-link navigation to the old standalone wizard route.
  {
    const dom = await buildDom('/admin/checklist/ap-dung-lai-mau');
    const { window } = dom;
    await window.phfRenderChecklist('/admin/checklist/ap-dung-lai-mau');
    await tick();
    check(window.location.pathname === '/admin/checklist/mau', '1a. Old route redirects (history.replaceState) to /admin/checklist/mau instead of dead-ending');
    const root = window.document.getElementById('phfChecklistRoot');
    check(!root.querySelector('.phfck-retro-steps'), '1b. Old standalone 8-step wizard stepper is NOT rendered (no orphaned page)');
    check(!root.innerHTML.includes('data-phfck-retro-do-copy'), '1c. No leftover wizard controls in the DOM after redirect');
    check(root.innerHTML.includes('Mẫu Checklist'), '1d. Templates screen renders as the safe redirect target');
  }

  // 2. Re-navigating away and back still redirects consistently (no stale state).
  {
    const dom = await buildDom('/admin/checklist');
    const { window } = dom;
    await window.phfRenderChecklist('/admin/checklist');
    await tick();
    await window.phfRenderChecklist('/admin/checklist/ap-dung-lai-mau');
    await tick();
    check(window.location.pathname === '/admin/checklist/mau', '2a. Redirect also fires correctly when navigating from another admin view (not just fresh load)');
  }

  console.log('');
  console.log(passes + ' PASS, ' + failures + ' FAIL');
  process.exitCode = failures ? 1 : 0;
})();
