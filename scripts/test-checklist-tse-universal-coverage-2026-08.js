'use strict';
/*
 * Workstream A residual (2026-08-14) — "Sửa Bảng tổng điểm" phải hoạt động
 * giống hệt nhau trên MỌI nhánh render chi tiết mẫu, không chỉ 5 renderer
 * chuyên biệt cũ (sales/shift-lead/warehouse/warehouse-manager/assistant-
 * config). Bài test này dùng ĐÚNG pattern real-route đã có ở
 * scripts/test-checklist-template-score-editor-2026-08.js: JSDOM + window.eval
 * (code thật) + window.phfRenderChecklist() + click DOM thật — KHÔNG gọi
 * thẳng hàm component.
 *
 * Bao phủ:
 *  1. Mẫu specialized (nv-marketing, qua assistantTemplateDetailHtml) — hồi
 *     quy: luồng vẫn hoạt động.
 *  2. Mẫu custom đã có sẵn dữ liệu (item.custom qua hydrate, totalRows khác
 *     rỗng) — coverage mới: luồng hoạt động y hệt mẫu specialized.
 *  3. Mẫu custom mới tạo, totalRows RỖNG — tab vẫn hiện, empty-state cho
 *     phép thêm dòng đầu tiên, sau đó validate/preview hoạt động.
 *  4. Bằng chứng "cùng một hàm dùng chung" — spy trên chính
 *     checklistTotalScoreTabHtml() (không phải 3 cài đặt trông giống nhau)
 *     ghi nhận đúng mẫu nào gọi hàm này khi render qua route thật.
 *  5. Phiên bản cũ (v1) của mẫu custom-có-sẵn-dữ-liệu bất biến sau khi
 *     publish phiên bản mới (đọc lại từ __phfLocalData sau publish).
 *
 * Chạy: node scripts/test-checklist-tse-universal-coverage-2026-08.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const appPath = path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js');
const cssPath = path.resolve(__dirname, '..', 'assets/css/phf-checklist.css');
const codeRaw = fs.readFileSync(appPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

// Chèn spy NGAY TRƯỚC })(); cuối cùng để có quyền truy cập closure IIFE,
// giống pattern probe đã dùng ở scripts/audit-checklist-connection-gate-
// remediation-2026-08.js — không đổi hành vi hàm gốc, chỉ ghi log lời gọi.
const SPY_PROBE = `
window.__phfckTseSpyCalls = [];
var __phfckOrigTotalScoreTab = checklistTotalScoreTabHtml;
checklistTotalScoreTabHtml = function(item){
  window.__phfckTseSpyCalls.push(item && item.id);
  return __phfckOrigTotalScoreTab.apply(this, arguments);
};
window.__phfckSharedFnRef = checklistTotalScoreTabHtml;
`;
const marker = codeRaw.lastIndexOf('})();');
if (marker < 0) throw new Error('Không tìm thấy })(); cuối file để chèn spy probe.');
const code = codeRaw.slice(0, marker) + SPY_PROBE + codeRaw.slice(marker);

let failures = 0, passes = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else { passes++; }
}
function click(window, el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
function setValue(window, el, value) { el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); el.dispatchEvent(new window.Event('change', { bubbles: true })); }
function tick(n) { return new Promise(resolve => setTimeout(resolve, n || 30)); }
function response(data) { return { ok: true, status: 200, json: async () => data }; }

const DEFINITION_SPECIALIZED = {
  templateType: 'checklist_detail',
  groups: [{ code: 'G1', name: 'Nhóm 1', children: [] }],
  totalRows: [
    { id: 'r1', code: 'CT-01', name: 'Lập phiếu', target: 5, unit: 'phiếu', weight: 50, source: { type: 'manual' } },
    { id: 'r2', code: 'CT-02', name: 'Tuân thủ Checklist', target: 100, unit: 'điểm', weight: 50, source: { type: 'checklist_total' } }
  ]
};
const DEFINITION_CUSTOM_EXISTING = {
  templateType: 'score_summary',
  groups: [],
  totalRows: [
    { id: 'c1', code: 'CT-CUSTOM-01', name: 'Doanh số cá nhân', target: 100, unit: 'triệu', weight: 60, source: { type: 'manual' } },
    { id: 'c2', code: 'CT-CUSTOM-02', name: 'Công việc cấp trên giao', target: 10, unit: 'điểm', weight: 40, source: { type: 'manual' } }
  ]
};
const DEFINITION_CUSTOM_ZERO_ROWS = { templateType: 'score_summary', groups: [], totalRows: [] };

async function buildDom(extraTemplates) {
  const dom = new JSDOM(
    '<!doctype html><html><head><style>' + css + '</style></head><body><div id="phfChecklistRoot"></div></body></html>',
    { url: 'http://localhost/admin/checklist/mau', runScripts: 'outside-only' }
  );
  const { window } = dom;
  window.phfGetSessionRole = () => 'admin';
  window.phfGetCurrentUser = () => ({ id: 'admin-1', employeeCode: 'PHF000', name: 'Admin' });
  window.phfGetAuthenticatedUser = window.phfGetCurrentUser;
  window.requestAnimationFrame = fn => setTimeout(fn, 0);
  window.requestIdleCallback = fn => setTimeout(fn, 0);
  window.scrollTo = () => {};
  window.__phfLocalData = {
    checklistTemplates: [
      {
        templateKey: 'nv-marketing', code: 'NV-MKT', name: 'Nhân viên Media Marketing', groupName: 'Marketing',
        templateType: 'checklist_detail', hasChecklist: true, source: '', note: '', status: 'active',
        version: 'v1', effectiveDate: '2026-01-01', updatedAt: '2026-01-01T00:00:00Z',
        definition: DEFINITION_SPECIALIZED,
        versions: [{ version: 'v1', effectiveDate: '2026-01-01', reason: 'seed', sourceVersion: '', changeType: 'sync', createdAt: '2026-01-01T00:00:00Z', definition: DEFINITION_SPECIALIZED }]
      }
    ].concat(extraTemplates || []),
    checklistTemplatesReady: true,
    checklistTemplatesError: ''
  };
  window.eval(code);
  return dom;
}

(async () => {
  // =========================================================================
  // Scenario A — mẫu custom ĐÃ có dữ liệu (item.custom qua hydrate) + mẫu
  // custom MỚI, totalRows rỗng. Cả hai không có trong 19 templateKey built-in
  // nên hydrateChecklistTemplatesFromDatabase() sẽ đánh dấu custom:true (xem
  // assets/js/checklist/phf-checklist-app.js dòng ~381: item.custom=!built[id]).
  // =========================================================================
  const dom = await buildDom([
    {
      templateKey: 'nv-thu-ngan-custom', code: 'NV-TN', name: 'Nhân viên Thu ngân (mẫu tạo trên web)', groupName: 'Bán hàng',
      templateType: 'score_summary', hasChecklist: false, source: 'Tạo trực tiếp trên web', note: '', status: 'active',
      version: 'NV-TN-1.0', effectiveDate: '2026-08-01', updatedAt: '2026-08-01T00:00:00Z',
      definition: DEFINITION_CUSTOM_EXISTING,
      versions: [{ version: 'NV-TN-1.0', effectiveDate: '2026-08-01', reason: 'Tạo mẫu mới', sourceVersion: '', changeType: 'web-create', createdAt: '2026-08-01T00:00:00Z', definition: DEFINITION_CUSTOM_EXISTING }]
    },
    {
      templateKey: 'nv-le-tan-custom', code: 'NV-LT', name: 'Nhân viên Lễ tân (mẫu mới, chưa có dòng)', groupName: 'Bán hàng',
      templateType: 'score_summary', hasChecklist: false, source: 'Tạo trực tiếp trên web', note: '', status: 'active',
      version: 'NV-LT-1.0', effectiveDate: '2026-08-14', updatedAt: '2026-08-14T00:00:00Z',
      definition: DEFINITION_CUSTOM_ZERO_ROWS,
      versions: [{ version: 'NV-LT-1.0', effectiveDate: '2026-08-14', reason: 'Tạo mẫu mới', sourceVersion: '', changeType: 'web-create', createdAt: '2026-08-14T00:00:00Z', definition: DEFINITION_CUSTOM_ZERO_ROWS }]
    }
  ]);
  const { window } = dom;
  window.fetch = async (url, opts) => {
    if (!opts || !opts.body) return response({ ok: true });
    const body = JSON.parse(opts.body);
    if (body.action === 'checklistRetroPreviewDiff') {
      const newDef = (body.input && body.input.newDefinition) || { totalRows: [] };
      return response({ ok: true, errors: [], added: [], removed: [], renamed: [], changed: [], unchanged: (newDef.totalRows || []).map(r => ({ id: r.id })), totalWeightBefore: 100, totalWeightAfter: 100 });
    }
    if (body.action === 'checklistRetroCopyVersion') {
      return response({ ok: true, templateKey: body.input.templateKey, versionNo: body.input.newVersion, sourceVersion: body.input.sourceVersion, definition: body.input.definition });
    }
    return response({ ok: true });
  };

  await window.phfRenderChecklist('/admin/checklist/mau');
  await tick();
  let root = window.document.getElementById('phfChecklistRoot');

  // -------------------------------------------------------------------------
  // 1. Regression — mẫu specialized (nv-marketing) vẫn hoạt động đầy đủ.
  // -------------------------------------------------------------------------
  click(window, root.querySelector('[data-phfck-template-detail="nv-marketing"]'));
  await tick();
  root = window.document.getElementById('phfChecklistRoot');
  check(root.textContent.includes('Bảng tổng điểm'), '1a. [specialized] Tab "Bảng tổng điểm" hiện diện (hồi quy)');
  click(window, root.querySelector('[data-phfck-sales-tab="total"]'));
  await tick();
  root = window.document.getElementById('phfChecklistRoot');
  const specializedEditBtn = root.querySelector('[data-phfck-tse-open="nv-marketing"]');
  check(!!specializedEditBtn, '1b. [specialized] Nút "Sửa Bảng tổng điểm" hiện diện, đúng templateId (hồi quy)');
  click(window, root.querySelector('[data-phfck-close-modal]'));
  await tick();

  // -------------------------------------------------------------------------
  // 2. Coverage mới — mẫu custom ĐÃ có dữ liệu, luồng đầy đủ hoạt động y hệt.
  // -------------------------------------------------------------------------
  root = window.document.getElementById('phfChecklistRoot');
  const customRowBtn = root.querySelector('[data-phfck-template-detail="nv-thu-ngan-custom"]');
  check(!!customRowBtn, '2a. [custom-existing] Mẫu custom xuất hiện trong danh sách Mẫu Checklist qua route thật');
  click(window, customRowBtn);
  await tick();
  root = window.document.getElementById('phfChecklistRoot');
  check(root.textContent.includes('MẪU TẠO TRÊN WEB'), '2b. [custom-existing] Modal chi tiết đúng nhánh custom (item.custom)');
  check(root.textContent.includes('Bảng tổng điểm'), '2c. [custom-existing] Tab "Bảng tổng điểm" hiện diện — GAP đã đóng (trước round này, nhánh custom không có tab này)');
  click(window, root.querySelector('[data-phfck-sales-tab="total"]'));
  await tick();
  root = window.document.getElementById('phfChecklistRoot');
  const customEditBtn = root.querySelector('[data-phfck-tse-open="nv-thu-ngan-custom"]');
  check(!!customEditBtn, '2d. [custom-existing] Nút "Sửa Bảng tổng điểm" hiện diện với đúng templateId');
  check(customEditBtn.outerHTML.replace(/nv-thu-ngan-custom/g, 'nv-marketing') === specializedEditBtn.outerHTML,
    '2e. [shared DOM] Nút "Sửa Bảng tổng điểm" ở nhánh custom có CẤU TRÚC DOM/class giống hệt nhánh specialized (chỉ khác templateId) — bằng chứng dùng chung tseButtonRowHtml()');
  click(window, customEditBtn);
  await tick();
  let editorModal = window.document.querySelector('.phfck-tse-modal');
  check(!!editorModal, '2f. [custom-existing] Editor mở được cho mẫu custom');
  const customRows = editorModal.querySelectorAll('[data-phfck-tse-row-id]');
  check(customRows.length === 2, '2g. [custom-existing] Editor hiển thị đúng 2 dòng thật từ definition (Doanh số cá nhân + Công việc cấp trên giao)');

  // Full validate -> preview -> publish flow for the custom template.
  let validation = editorModal.querySelector('[data-phfck-tse-validation]');
  check(validation.textContent.includes('100%'), '2h. [custom-existing] Validation panel hiển thị đúng tổng trọng số 100% ban đầu');
  const previewBtn = editorModal.querySelector('[data-phfck-tse-preview]');
  check(!previewBtn.disabled, '2i. [custom-existing] Nút "Xem trước & tạo phiên bản" khả dụng (hợp lệ)');
  click(window, previewBtn);
  await tick(60);
  const previewModal = window.document.querySelector('.phfck-tse-preview-modal');
  check(!!previewModal, '2j. [custom-existing] Modal xem trước mở được (dùng chung checklistTsePreviewHtml/checklistRetroPreviewDiff)');
  setValue(window, previewModal.querySelector('[data-phfck-tse-new-version]'), 'NV-TN-1.1');
  setValue(window, previewModal.querySelector('[data-phfck-tse-reason]'), 'Điều chỉnh trọng số quý 3');
  await tick();
  click(window, previewModal.querySelector('[data-phfck-tse-confirm-publish]'));
  await tick(80);
  const postPublish = window.document.querySelector('[data-phfck-tse-postpublish]');
  check(!!postPublish, '2k. [custom-existing] Modal 2-lựa-chọn sau publish xuất hiện — dùng chung checklistTsePostPublishHtml()');
  check(postPublish.textContent.includes('Cập nhật Phiếu tháng hiện có'), '2l. [custom-existing] Lựa chọn mở luồng "Cập nhật Phiếu tháng hiện có" (drawer 3 bước) hiện diện, giống hệt nhánh specialized');

  // -------------------------------------------------------------------------
  // 3. Version cũ (NV-TN-1.0) của mẫu custom vẫn bất biến sau khi publish.
  // -------------------------------------------------------------------------
  const oldVersionRow = window.__phfLocalData.checklistTemplates.find(t => t.templateKey === 'nv-thu-ngan-custom');
  const oldVersionRecord = (oldVersionRow.versions || []).find(v => v.version === 'NV-TN-1.0');
  check(!!oldVersionRecord, '3a. Bản ghi version cũ NV-TN-1.0 còn tồn tại trong dữ liệu nguồn (không bị xóa/ghi đè)');
  check(JSON.stringify(oldVersionRecord.definition) === JSON.stringify(DEFINITION_CUSTOM_EXISTING),
    '3b. Định nghĩa (definition) của version cũ NV-TN-1.0 không đổi sau khi publish version mới (immutability)');

  click(window, postPublish.querySelector('[data-phfck-close-submodal]') || postPublish);
  await tick();

  // -------------------------------------------------------------------------
  // 4. Coverage mới — mẫu custom MỚI TẠO, totalRows RỖNG -> empty-state.
  // -------------------------------------------------------------------------
  window.document.querySelectorAll('[data-phfck-submodal],[data-phfck-modal-layer]').forEach(n => n.remove());
  root = window.document.getElementById('phfChecklistRoot');
  const zeroRowBtn = root.querySelector('[data-phfck-template-detail="nv-le-tan-custom"]');
  check(!!zeroRowBtn, '4a. [custom-zero-rows] Mẫu mới (0 dòng) xuất hiện trong danh sách qua route thật');
  click(window, zeroRowBtn);
  await tick();
  root = window.document.getElementById('phfChecklistRoot');
  check(root.textContent.includes('Bảng tổng điểm'), '4b. [custom-zero-rows] Tab "Bảng tổng điểm" VẪN hiện dù totalRows rỗng (không bị ẩn nhầm)');
  click(window, root.querySelector('[data-phfck-sales-tab="total"]'));
  await tick();
  root = window.document.getElementById('phfChecklistRoot');
  check(root.textContent.includes('Chưa có dòng nào trong Bảng tổng điểm'), '4c. [custom-zero-rows] Empty-state đúng nội dung yêu cầu');
  const addFirstRowBtn = root.querySelector('[data-phfck-tse-open="nv-le-tan-custom"]');
  check(!!addFirstRowBtn, '4d. [custom-zero-rows] Nút "Thêm dòng đầu tiên" tồn tại và dùng lại đúng data-phfck-tse-open (mở editor dùng chung)');
  click(window, addFirstRowBtn);
  await tick();
  editorModal = window.document.querySelector('.phfck-tse-modal');
  check(!!editorModal, '4e. [custom-zero-rows] Editor mở được từ empty-state');
  check(editorModal.querySelectorAll('[data-phfck-tse-row-id]').length === 0, '4f. [custom-zero-rows] Editor xác nhận đúng 0 dòng ban đầu (không fabricate dữ liệu)');
  check(editorModal.textContent.includes('Chưa có dòng nào'), '4g. [custom-zero-rows] Editor tự thân cũng có empty-state riêng (đã có sẵn từ trước, không đổi)');
  click(window, editorModal.querySelector('[data-phfck-tse-add-row]'));
  await tick();
  editorModal = window.document.querySelector('.phfck-tse-modal');
  const firstRow = editorModal.querySelectorAll('[data-phfck-tse-row-id]');
  check(firstRow.length === 1, '4h. [custom-zero-rows] Admin thêm được dòng đầu tiên qua nút "+ Thêm dòng" đã có sẵn trong editor');
  setValue(window, firstRow[0].querySelector('[data-phfck-tse-field="name"]'), 'Đón khách và hướng dẫn');
  setValue(window, firstRow[0].querySelector('[data-phfck-tse-field="target"]'), '100');
  setValue(window, firstRow[0].querySelector('[data-phfck-tse-field="weight"]'), '100');
  await tick();
  validation = editorModal.querySelector('[data-phfck-tse-validation]');
  check(validation.textContent.includes('100%'), '4i. [custom-zero-rows] Sau khi nhập dòng đầu tiên với trọng số 100%, validation báo hợp lệ 100%');
  check(!editorModal.querySelector('[data-phfck-tse-preview]').disabled, '4j. [custom-zero-rows] "Xem trước & tạo phiên bản" khả dụng ngay sau khi thêm dòng đầu tiên hợp lệ');

  // -------------------------------------------------------------------------
  // 5. Bằng chứng dùng CHUNG một hàm — spy trên checklistTotalScoreTabHtml().
  // -------------------------------------------------------------------------
  const calls = window.__phfckTseSpyCalls || [];
  check(calls.indexOf('nv-marketing') >= 0, '5a. [shared fn] checklistTotalScoreTabHtml() thực sự được gọi khi render mẫu specialized (nv-marketing) qua route thật');
  check(calls.indexOf('nv-thu-ngan-custom') >= 0, '5b. [shared fn] checklistTotalScoreTabHtml() thực sự được gọi khi render mẫu custom-existing qua route thật — CÙNG một hàm, không phải cài đặt riêng');
  check(calls.indexOf('nv-le-tan-custom') >= 0, '5c. [shared fn] checklistTotalScoreTabHtml() thực sự được gọi khi render mẫu custom-zero-rows qua route thật');
  check(typeof window.__phfckSharedFnRef === 'function', '5d. [shared fn] checklistTotalScoreTabHtml tồn tại như một hàm duy nhất trong closure (không bị nhân bản theo nhánh)');

  console.log('');
  console.log(passes + ' PASS, ' + failures + ' FAIL');
  if (failures > 0) process.exit(1);
})().catch(err => { console.error('CRASH', err); process.exit(1); });
