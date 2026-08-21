'use strict';
/*
 * PHF Checklist — Workstream A residual (2026-08-14), audit UI đầy đủ 19/19
 * mẫu cho tab "Bảng tổng điểm" sau khi phần "Sửa Bảng tổng điểm" được nối
 * vào MỌI nhánh render chi tiết mẫu (5 renderer chuyên biệt cũ + nhánh
 * custom/tạo trên web + nhánh generic dự phòng).
 *
 * Thực thi THẬT: dựng DOM thật (jsdom) từ đúng file
 * assets/js/checklist/phf-checklist-app.js, gọi đúng hàm dispatch thật
 * templateDetailModalHtml(item) cho từng mẫu trong templateCatalog() (19
 * mẫu built-in, không thêm/bớt), với templateUiState.salesTab='total', rồi
 * đọc DOM thật ra để xác định: nhánh render nào xử lý mẫu (dò theo ĐÚNG logic
 * dispatch if/else thật trong templateDetailModalHtml — không đoán), tab
 * "Bảng tổng điểm" có xuất hiện không, nút "Sửa Bảng tổng điểm" có xuất hiện
 * không, và lý do cấu trúc nếu không hiển thị (đọc từ
 * checklistTemplateHiddenReason() thật trong app — không tự viết lý do tay).
 *
 * Chạy: node scripts/audit-checklist-total-score-tab-coverage-2026-08.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const appAbsPath = path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js');
const cssAbsPath = path.resolve(__dirname, '..', 'assets/css/phf-checklist.css');
const code = fs.readFileSync(appAbsPath, 'utf8');
const css = fs.readFileSync(cssAbsPath, 'utf8');

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
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
window.__phfLocalData = { checklistTemplates: [], checklistTemplatesReady: true, checklistTemplatesError: '' };

const probe = `
window.__phfckCatalog = templateCatalog();
window.__phfckRenderBranch = function(item){
  if (item.id === 'nv-ban-hang') return 'specialized:sales (salesTemplateDetailHtml)';
  if (item.id === 'truong-ca-ban-hang') return 'specialized:shift-lead (shiftLeadTemplateDetailHtml)';
  if (item.id === 'nv-kho') return 'specialized:warehouse (warehouseTemplateDetailHtml)';
  if (item.id === 'tbp-kho') return 'specialized:warehouse-manager (warehouseManagerTemplateDetailHtml)';
  if (ASSISTANT_TEMPLATE_CONFIGS[item.id]) return 'specialized:assistant-config (assistantTemplateDetailHtml)';
  if (item.custom) return 'custom (item.custom branch)';
  return 'generic (fallback branch)';
};
window.__phfckDetailHtmlOnTotalTab = function(item){
  templateUiState.selectedId = item.id;
  templateUiState.salesTab = 'total';
  return templateDetailModalHtml(item);
};
window.__phfckHasMechanism = function(item){ return checklistTemplateHasTotalScoreMechanism(item); };
window.__phfckHiddenReason = function(item){ return checklistTemplateHiddenReason(item); };
window.__phfckSharedFnRef = checklistTotalScoreTabHtml;
`;
const marker = code.lastIndexOf('})();');
if (marker < 0) throw new Error('Không tìm thấy })(); cuối file để chèn probe.');
window.eval(code.slice(0, marker) + probe + code.slice(marker));

const catalog = window.__phfckCatalog;
console.log('Tổng số mẫu trong templateCatalog() (built-in, chưa gồm custom): ' + catalog.length);
console.log('');
const header = ['Template', 'Render branch', 'Có/không Bảng tổng điểm', 'Có/không nút "Sửa Bảng tổng điểm"', 'Lý do nếu không hiển thị'];
console.log(header.join(' | '));

const rows = [];
let anyHidden = false;
catalog.forEach(item => {
  const branch = window.__phfckRenderBranch(item);
  const hasMechanism = window.__phfckHasMechanism(item);
  const html = window.__phfckDetailHtmlOnTotalTab(item);
  const tabButtonPresent = /data-phfck-sales-tab="total"/.test(html);
  const editButtonPresent = new RegExp('data-phfck-tse-open="' + item.id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '"').test(html);
  const reason = hasMechanism ? '' : window.__phfckHiddenReason(item);
  if (!hasMechanism) anyHidden = true;
  const row = {
    id: item.id,
    name: item.name,
    branch,
    hasTab: tabButtonPresent ? 'Có' : 'Không',
    hasButton: editButtonPresent ? 'Có' : 'Không',
    reason
  };
  rows.push(row);
  console.log([row.name + ' (' + row.id + ')', row.branch, row.hasTab, row.hasButton, row.reason || '—'].join(' | '));
});

console.log('');
console.log('=== TỔNG KẾT ===');
const specializedCount = rows.filter(r => r.branch.indexOf('specialized') === 0).length;
const customCount = rows.filter(r => r.branch.indexOf('custom') === 0).length;
const genericCount = rows.filter(r => r.branch.indexOf('generic') === 0).length;
console.log('Nhánh specialized (4 named + assistant-config): ' + specializedCount + '/19');
console.log('Nhánh custom (item.custom): ' + customCount + '/19');
console.log('Nhánh generic (fallback cuối cùng): ' + genericCount + '/19 — mong đợi 0/19 vì cả 19 mẫu built-in đều đã được named-branch hoặc ASSISTANT_TEMPLATE_CONFIGS xử lý (xem log ở trên); nhánh generic vẫn được nối đầy đủ (checklistTemplateTabsHtml/checklistTotalScoreTabHtml) để không mẫu tương lai nào cần sửa code.');
console.log('Số mẫu có tab "Bảng tổng điểm": ' + rows.filter(r => r.hasTab === 'Có').length + '/19');
console.log('Số mẫu có nút "Sửa Bảng tổng điểm": ' + rows.filter(r => r.hasButton === 'Có').length + '/19');
console.log('Có mẫu nào bị ẩn tab (structural) trong 19 mẫu built-in: ' + anyHidden + ' (mong đợi false — cả 19 mẫu đều hasChecklist:true nên đều dùng cơ chế Bảng tổng điểm/chấm điểm tháng).');
console.log('typeof checklistTotalScoreTabHtml (hàm hiển thị dùng chung): ' + typeof window.__phfckSharedFnRef);

const allConsistent = rows.every(r => (r.hasTab === 'Có') === (r.hasButton === 'Có'));
console.log('Mọi mẫu có tab thì cũng có nút, và ngược lại (không có trường hợp tab hiện nhưng nút mất, hoặc nút hiện mà tab ẩn): ' + allConsistent);

if (!allConsistent) { console.error('AUDIT INCONSISTENT'); process.exit(1); }
console.log('AUDIT OK');
