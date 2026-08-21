'use strict';
/* Workstream A — item 7: audit thực thi (không phải khẳng định thủ công) gate
   "connection-gate" (validateScoredDefinition trong lib/checklist-templates.js)
   chạy trên ĐÚNG definition mà app thật đang dùng cho từng mẫu trong
   CHECKLIST_TEMPLATE_CATALOG (assets/js/checklist/phf-checklist-app.js), tái
   dựng definition giống hệt templateRecordForDatabase() (groups=baseTemplateGroups(id),
   totalRows=effectiveTotalRows(id), templateType=item.templateType||(item.hasChecklist
   ?'checklist_detail':'score_summary')).

   Chạy: node scripts/test-checklist-connection-gate-audit-2026-08.js
*/
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { validateScoredDefinition, requiresChecklistTotalRow, isChecklistTotalRow } = require('../lib/checklist-templates');

const appPath = path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js');
const code = fs.readFileSync(appPath, 'utf8');

const dom = new JSDOM('<!doctype html><html><body><div id="phfChecklistRoot"></div></body></html>', { url: 'http://localhost/admin/checklist', runScripts: 'outside-only' });
const { window } = dom;
window.phfGetSessionRole = () => 'admin';
window.phfGetCurrentUser = () => ({ id: 'admin-1', employeeCode: 'PHF000', name: 'Admin' });
window.requestAnimationFrame = fn => setTimeout(fn, 0);
window.fetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
// templateCatalog()/baseTemplateGroups()/effectiveTotalRows() live inside the file's own
// IIFE closure and are not exposed on window - a second, separate window.eval() call cannot
// see them. Inject the extraction probe INSIDE the IIFE by splicing it right before the
// file's own closing "})();" so it shares the same closure scope.
const probe = 'window.__phfckCatalog=templateCatalog();window.__phfckDefinitionFor=function(id){var item=templateCatalog().find(function(x){return x.id===id;});return {templateType:(item&&item.templateType)||((item&&item.hasChecklist)?"checklist_detail":"score_summary"),groups:baseTemplateGroups(id),totalRows:effectiveTotalRows(id)};};\n';
const marker = code.lastIndexOf('})();');
if (marker < 0) throw new Error('Không tìm thấy })(); cuối file để chèn probe.');
const patchedCode = code.slice(0, marker) + probe + code.slice(marker);
window.eval(patchedCode);

const catalog = window.__phfckCatalog;
console.log('Tổng số mẫu trong CHECKLIST_TEMPLATE_CATALOG (kể cả tùy biến đã lưu localStorage, ở đây rỗng nên = built-in): ' + catalog.length);
console.log('');

const rows = [];
catalog.forEach(item => {
  const definition = window.__phfckDefinitionFor(item.id);
  const requires = requiresChecklistTotalRow(definition);
  const hasTotalRow = (definition.totalRows || []).some(isChecklistTotalRow);
  let gateResult = 'N/A (không yêu cầu)';
  let gateError = '';
  try {
    validateScoredDefinition(definition);
    gateResult = 'PASS';
  } catch (e) {
    gateResult = 'FAIL';
    gateError = e.code + ': ' + e.message;
  }
  rows.push({ id: item.id, name: item.name, hasChecklist: item.hasChecklist, requires, hasTotalRow, gateResult, gateError });
});

console.log('id'.padEnd(24) + 'hasChecklist'.padEnd(14) + 'requiresGate'.padEnd(14) + 'hasChecklistTotalRow'.padEnd(22) + 'validateScoredDefinition()');
rows.forEach(r => {
  console.log(
    r.id.padEnd(24) + String(r.hasChecklist).padEnd(14) + String(r.requires).padEnd(14) + String(r.hasTotalRow).padEnd(22) +
    (r.gateResult === 'FAIL' ? 'FAIL — ' + r.gateError : r.gateResult)
  );
});

const requiring = rows.filter(r => r.requires);
const passing = rows.filter(r => r.requires && r.gateResult === 'PASS');
const failing = rows.filter(r => r.requires && r.gateResult === 'FAIL');
const notRequiring = rows.filter(r => !r.requires);

console.log('');
console.log('=== TỔNG KẾT ===');
console.log('Số mẫu kích hoạt gate (requiresChecklistTotalRow=true): ' + requiring.length + '/' + rows.length);
console.log('  - PASS (đã có dòng checklist_total hợp lệ): ' + passing.map(r => r.id).join(', ') || '(không có)');
console.log('  - FAIL (thiếu dòng checklist_total — sẽ bị validateScoredDefinition() chặn nếu lưu lại qua saveOne()/saveChecklistTemplateLibrary): ' + failing.map(r => r.id).join(', ') || '(không có)');
console.log('Số mẫu KHÔNG kích hoạt gate: ' + notRequiring.length + ' → ' + (notRequiring.map(r => r.id).join(', ') || '(không có)'));

// False-positive check: a template that genuinely has no Checklist groups/detail type
// must NOT trigger the gate requirement, and must validate cleanly with a plain manual row.
const nonChecklistDefinition = { templateType: 'score_summary', groups: [], totalRows: [{ code: 'X', target: 100, weight: 100, source: { type: 'manual' } }] };
const falsePositiveTriggered = requiresChecklistTotalRow(nonChecklistDefinition);
let falsePositiveValidates = true, falsePositiveError = '';
try { validateScoredDefinition(nonChecklistDefinition); } catch (e) { falsePositiveValidates = false; falsePositiveError = e.message; }
console.log('');
console.log('Kiểm tra false-positive (mẫu templateType=score_summary, groups=[], không dùng Checklist):');
console.log('  requiresChecklistTotalRow() = ' + falsePositiveTriggered + ' (kỳ vọng false)');
console.log('  validateScoredDefinition() = ' + (falsePositiveValidates ? 'PASS (đúng, không bị chặn)' : 'FAIL — ' + falsePositiveError));

// FINAL SANITY GATE (2026-08-14): bản remediation tự động (dòng checklist_total
// 10% + co giãn tỉ lệ) đã bị RÚT LẠI vì không có bằng chứng nguồn cho con số
// 10%. Cả 19/19 mẫu dùng Checklist scoring nay đều PHẢI FAIL gate — đây là kỳ
// vọng ĐÚNG, không phải hồi quy: mẫu chỉ hết FAIL sau khi Admin tự nhập trọng
// số qua wizard /admin/checklist/ap-dung-lai-mau, không phải qua seed cứng.
const ALL_19_TEMPLATES_REQUIRING_ADMIN_INPUT = ['tbp-thu-mua', 'nv-online', 'ke-toan-tong-hop', 'ke-toan-chi-phi-cnpt', 'ke-toan-doanh-thu-cnpt', 'ke-toan-truong', 'tro-ly-1-ngoc', 'tro-ly-2-tien', 'tro-ly-3-vinh', 'qtth-hcns-thang', 'qtth-hcns-nhan-vien', 'nv-goi-qua', 'tbp-goi-qua', 'tbp-marketing', 'nv-marketing', 'nv-kho', 'tbp-kho', 'nv-ban-hang', 'truong-ca-ban-hang'];
const ok = !falsePositiveTriggered && falsePositiveValidates &&
  ALL_19_TEMPLATES_REQUIRING_ADMIN_INPUT.every(id => failing.some(r => r.id === id));

console.log('');
console.log(ok ? 'KẾT LUẬN: gate hoạt động đúng — không false-positive trên mẫu không dùng Checklist, và cả 19 mẫu chưa có Admin cấu hình trọng số qua wizard đều FAIL đúng như kỳ vọng (chờ Admin, không tự remediate bằng số mặc định).' : 'KẾT LUẬN: CẦN XEM LẠI — có sai lệch so với kỳ vọng.');
process.exitCode = ok ? 0 : 1;
