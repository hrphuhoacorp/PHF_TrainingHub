'use strict';
/* Regression test — entry point cho "Áp dụng lại mẫu" trên route THẬT.
 *
 * Lịch sử: bản đầu (2026-08-14) test này XÁC NHẬN sự tồn tại của nút "⇄ Áp dụng
 * lại mẫu" trên toolbar "Phiếu đánh giá tháng" (thêm sau khi phát hiện wizard 8
 * bước không có entry point nào trong app thật).
 *
 * Workstream A UI reorg (2026-08-14, quyết định nghiệp vụ chốt cuối) — wizard 8
 * bước độc lập ĐÃ DISSOLVE vào màn "Mẫu Checklist" (nút "Sửa Bảng tổng điểm" +
 * modal 3 bước "Cập nhật Phiếu tháng hiện có"). Entry point cũ trên "Phiếu đánh
 * giá tháng" bị RÚT LẠI theo đúng brief (không giữ 2 cửa vào cùng một nghiệp vụ):
 *   - Bỏ nút "⇄ Áp dụng lại mẫu" khỏi toolbar Phiếu đánh giá tháng.
 *   - Bỏ mục "Áp dụng lại mẫu" khỏi sidebar admin.
 *   - Route cũ /admin/checklist/ap-dung-lai-mau redirect an toàn sang
 *     /admin/checklist/mau (xem normalizeAdminRetroRoute()).
 * Bài test này giờ xác nhận ĐÚNG các thay đổi trên, cộng với toàn bộ regression
 * gốc (A0-A2, B0-B3, C1-C2: các nút/route khác không bị ảnh hưởng) vẫn giữ
 * nguyên. Coverage nghiệp vụ đầy đủ của "Sửa Bảng tổng điểm"/3-bước cập nhật
 * phiếu tháng nằm ở scripts/test-checklist-template-score-editor-2026-08.js,
 * cũng đi qua route thật (window.phfRenderChecklist), không gọi thẳng hàm.
 *
 * Chạy: node scripts/test-checklist-retro-entrypoint-real-route-2026-08.js
 */
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
function click(window, el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
function tick(n) { return new Promise(resolve => setTimeout(resolve, n || 30)); }
function response(data) { return { ok: true, status: 200, json: async () => data }; }

const DEFINITION_V1 = {
  templateType: 'checklist_detail',
  groups: [{ code: 'G1', name: 'Nhóm 1', children: [] }],
  totalRows: [
    { id: 'r1', code: 'CT-01', name: 'Lập phiếu', target: 5, unit: 'phiếu', weight: 50, source: { type: 'manual' } },
    { id: 'r2', code: 'CT-02', name: 'Tuân thủ Checklist', target: 100, unit: 'điểm', weight: 50, source: { type: 'checklist_total' } }
  ]
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
  window.__phfLocalData = {
    checklistTemplates: [{
      templateKey: 'nv-marketing', code: 'NV-MKT', name: 'Nhân viên Media Marketing', groupName: 'Marketing',
      templateType: 'checklist_detail', hasChecklist: true, source: '', note: '', status: 'active',
      version: 'v1', effectiveDate: '2026-01-01', updatedAt: '2026-01-01T00:00:00Z',
      definition: DEFINITION_V1,
      versions: [{ version: 'v1', effectiveDate: '2026-01-01', reason: 'seed', sourceVersion: '', changeType: 'sync', createdAt: '2026-01-01T00:00:00Z', definition: DEFINITION_V1 }]
    }],
    checklistTemplatesReady: true,
    checklistTemplatesError: ''
  };
  window.fetch = async (url, opts) => {
    try {
      const body = opts && opts.body ? JSON.parse(opts.body) : {};
      if (body.action === 'listChecklistMonthly') return response({ ok: true, forms: [], reviewerCandidates: [], period: null });
    } catch (_e) {}
    return response({ ok: true });
  };
  window.eval(code);
  return dom;
}

(async () => {
  // =========================================================================
  // A. Route thật /admin/checklist/phieu-danh-gia-thang -> entry point cũ đã bị
  //    rút lại, các nút/toolbar khác không đổi.
  // =========================================================================
  {
    const dom = await buildDom('/admin/checklist/phieu-danh-gia-thang');
    const { window } = dom;
    await window.phfRenderChecklist('/admin/checklist/phieu-danh-gia-thang');
    await tick(30);
    const root = window.document.getElementById('phfChecklistRoot');

    check(!!root.querySelector('.phfck-monthly-panel'), 'A0. Route thật vẽ đúng workspace Phiếu đánh giá tháng (không phải màn khác)');
    const marketingBtn = [...root.querySelectorAll('button')].find(b => b.textContent.includes('Cập nhật tiêu chí tháng'));
    check(!!marketingBtn, 'A1. Nút "Cập nhật tiêu chí tháng" (đã có từ trước) vẫn hiện trên route thật');
    const syncBtn = root.querySelector('[data-phfck-monthly-recovery]');
    check(!!syncBtn && syncBtn.textContent.includes('Kiểm tra & Đồng bộ phiếu'), 'A2. Nút "Kiểm tra & Đồng bộ phiếu" (đã có từ trước) vẫn hiện trên route thật');

    check(!root.querySelector('[data-phfck-view="retro"]'), 'A3. Nút "⇄ Áp dụng lại mẫu" KHÔNG còn trên toolbar Phiếu đánh giá tháng (entry point rút lại theo quyết định UI reorg)');
    check(!root.innerHTML.includes('Áp dụng lại mẫu'), 'A4. Không còn chuỗi "Áp dụng lại mẫu" ở đâu trên route Phiếu đánh giá tháng');
  }

  // =========================================================================
  // B. Regression — "Kiểm tra & Đồng bộ phiếu" không bị đổi hành vi.
  // =========================================================================
  {
    const dom = await buildDom('/admin/checklist/phieu-danh-gia-thang');
    const { window } = dom;
    window.fetch = async (url, opts) => {
      const body = opts && opts.body ? JSON.parse(opts.body) : {};
      if (body.action === 'listChecklistMonthly') return response({ ok: true, forms: [], reviewerCandidates: [], period: null });
      if (body.action === 'inspectChecklistMonthlyRecovery') return response({ ok: true, counts: { existing: 0 }, groups: { readyToCreate: [] }, period: { month: '2026-08' } });
      return response({ ok: true });
    };
    window.eval(code);
    await window.phfRenderChecklist('/admin/checklist/phieu-danh-gia-thang');
    await tick(30);
    const root = window.document.getElementById('phfChecklistRoot');
    const syncBtn = root.querySelector('[data-phfck-monthly-recovery]');
    check(!!syncBtn, 'B0. Nút Đồng bộ phiếu có mặt trước khi test regression');
    click(window, syncBtn);
    await tick(50);
    check(window.location.pathname === '/admin/checklist/phieu-danh-gia-thang', 'B1. Bấm "Kiểm tra & Đồng bộ phiếu" KHÔNG điều hướng đi đâu khác (hành vi cũ giữ nguyên)');
    check(!!root.querySelector('.phfck-recovery-modal'), 'B2. Bấm "Kiểm tra & Đồng bộ phiếu" vẫn mở đúng modal Recovery Center cũ');
    check(!root.querySelector('.phfck-retro-steps'), 'B3. Wizard 8 bước cũ KHÔNG bị mở nhầm khi dùng công cụ Đồng bộ phiếu (route/menu đã bị gỡ)');
  }

  // =========================================================================
  // C. Regression — /admin/checklist/mau (Mẫu Checklist) vẫn vẽ đúng, sidebar
  //    không còn mục "Áp dụng lại mẫu", route cũ redirect an toàn.
  // =========================================================================
  {
    const dom = await buildDom('/admin/checklist/mau');
    const { window } = dom;
    await window.phfRenderChecklist('/admin/checklist/mau');
    await tick(30);
    const root = window.document.getElementById('phfChecklistRoot');
    check(root.textContent.includes('Mẫu Checklist'), 'C1. Route thật /admin/checklist/mau vẫn vẽ đúng màn Mẫu Checklist');
    check(!root.querySelector('.phfck-retro-steps'), 'C2. Màn Mẫu Checklist không tự động mở wizard 8 bước cũ');
    const sidebarRetro = root.querySelector('.phfck-sidebar [data-phfck-view="retro"]');
    check(!sidebarRetro, 'C3. Mục sidebar "Áp dụng lại mẫu" đã được gỡ (không còn route/menu riêng cho wizard cũ)');

    await window.phfRenderChecklist('/admin/checklist/ap-dung-lai-mau');
    await tick(30);
    check(window.location.pathname === '/admin/checklist/mau', 'C4. Route cũ /admin/checklist/ap-dung-lai-mau redirect an toàn sang /admin/checklist/mau (không 404, không mồ côi trang wizard cũ)');
  }

  console.log('\n' + passes + ' passed, ' + failures + ' failed.');
  process.exit(failures ? 1 : 0);
})();
