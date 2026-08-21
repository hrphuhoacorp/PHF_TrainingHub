'use strict';
/*
 * PHF Checklist — Workstream A (2026-08-14), bảng audit đầy đủ 19/19 mẫu.
 * Thực thi THẬT (không phải mô tả tay): dựng definition "trước" từ git HEAD
 * (baseline trước khi bắt đầu toàn bộ Workstream A — trước cả 6 mẫu đã fix ở
 * phiên trước) và definition "sau" từ file làm việc hiện tại (đã remediate cả
 * 13 mẫu còn lại), chạy CÙNG MỘT hàm validateScoredDefinition()/
 * requiresChecklistTotalRow() (lib/checklist-templates.js) trên cả hai, và in
 * bảng so sánh. Không phỏng đoán số liệu — mọi con số trọng số/PASS/FAIL đều
 * đọc trực tiếp từ definition thật được app dựng ra (baseTemplateGroups()/
 * effectiveTotalRows() trong assets/js/checklist/phf-checklist-app.js).
 *
 * Chạy: node scripts/audit-checklist-connection-gate-remediation-2026-08.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { JSDOM } = require('jsdom');
const { validateScoredDefinition, requiresChecklistTotalRow, isChecklistTotalRow, rowSourceType } = require('../api/_lib/checklist-templates');
const { rowWeight } = require('../api/_lib/checklist-template-retroactive');

const appRelPath = 'assets/js/checklist/phf-checklist-app.js';
const appAbsPath = path.resolve(__dirname, '..', appRelPath);

function extractDefinitions(code) {
  const dom = new JSDOM('<!doctype html><html><body><div id="phfChecklistRoot"></div></body></html>', { url: 'http://localhost/admin/checklist', runScripts: 'outside-only' });
  const { window } = dom;
  window.phfGetSessionRole = () => 'admin';
  window.phfGetCurrentUser = () => ({ id: 'admin-1', employeeCode: 'PHF000', name: 'Admin' });
  window.requestAnimationFrame = fn => setTimeout(fn, 0);
  window.fetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
  const probe = 'window.__phfckCatalog=templateCatalog();window.__phfckDefinitionFor=function(id){var item=templateCatalog().find(function(x){return x.id===id;});return {templateType:(item&&item.templateType)||((item&&item.hasChecklist)?"checklist_detail":"score_summary"),groups:baseTemplateGroups(id),totalRows:effectiveTotalRows(id)};};\n';
  const marker = code.lastIndexOf('})();');
  if (marker < 0) throw new Error('Không tìm thấy })(); cuối file để chèn probe.');
  const patched = code.slice(0, marker) + probe + code.slice(marker);
  window.eval(patched);
  const catalog = window.__phfckCatalog;
  const map = {};
  catalog.forEach(item => { map[item.id] = window.__phfckDefinitionFor(item.id); });
  return map;
}

function evaluate(def) {
  const requires = requiresChecklistTotalRow(def);
  const hasRow = (def.totalRows || []).some(isChecklistTotalRow);
  const totalWeight = (def.totalRows || []).reduce((s, r) => s + rowWeight(r), 0);
  let gate = 'N/A';
  try { validateScoredDefinition(def); gate = 'PASS'; } catch (e) { gate = 'FAIL(' + e.code + ')'; }
  return { requires, hasRow, totalWeight: Math.round(totalWeight * 100) / 100, gate };
}

const currentCode = fs.readFileSync(appAbsPath, 'utf8');
let baselineCode;
try {
  baselineCode = execSync('git show HEAD:' + JSON.stringify(appRelPath).replace(/^"|"$/g, ''), { cwd: path.resolve(__dirname, '..'), maxBuffer: 1024 * 1024 * 50 }).toString('utf8');
} catch (e) {
  console.error('Không đọc được git HEAD của ' + appRelPath + ': ' + e.message);
  process.exit(1);
}

const beforeDefs = extractDefinitions(baselineCode);
const afterDefs = extractDefinitions(currentCode);

// FINAL SANITY GATE (2026-08-14): remediation tự động (checklist_total 10%
// + co giãn tỉ lệ) đã bị RÚT LẠI cho toàn bộ 19 mẫu — không tìm được bằng
// chứng nguồn cho con số 10% (xem ghi chú đầu file lib/checklist-template-
// total-row-remediation.js). Không còn mẫu nào "đã fix ở phiên trước"; cả
// 19 mẫu quay lại đúng lỗi gốc (thiếu dòng checklist_total) và ở nguyên
// trạng thái đó cho tới khi Admin tự cấu hình qua wizard.
const ALREADY_FIXED_PRIOR_SESSION = [];
const REMEDIATED_THIS_SESSION = [];
const NEEDS_ADMIN_INPUT_VIA_WIZARD = ['nv-marketing', 'tbp-marketing', 'ke-toan-tong-hop', 'ke-toan-chi-phi-cnpt', 'ke-toan-doanh-thu-cnpt', 'ke-toan-truong', 'nv-ban-hang', 'truong-ca-ban-hang', 'nv-kho', 'tbp-kho', 'tro-ly-1-ngoc', 'tro-ly-2-tien', 'tro-ly-3-vinh', 'qtth-hcns-thang', 'qtth-hcns-nhan-vien', 'nv-goi-qua', 'tbp-goi-qua', 'nv-online', 'tbp-thu-mua'];

const ids = Object.keys(afterDefs).sort();
console.log('LƯU Ý: cột "trước" ở bảng này là baseline git HEAD (' + execSync('git rev-parse --short HEAD', { cwd: path.resolve(__dirname, '..') }).toString().trim() + '). Sau FINAL SANITY GATE (2026-08-14), seed FE của cả 19 mẫu đã được RÚT LẠI về đúng trạng thái HEAD (không có dòng checklist_total, trọng số gốc) vì không tìm được bằng chứng nguồn cho trọng số 10% từng gán tự động. "Trước" và "sau" vì vậy PHẢI giống hệt nhau cho cả 19 mẫu — đây là bằng chứng revert đã áp dụng đúng, không phải một lỗi.');
console.log('');
const header = ['Template/version', 'Dùng Checklist scoring?', 'checklist_total trước', 'Tổng trọng số trước', 'Tổng trọng số sau', 'Gate trước→sau', 'Hành động đề xuất', 'Số Phiếu tháng dự kiến bị ảnh hưởng'];
console.log(header.join(' | '));

const rows = [];
ids.forEach(id => {
  const before = evaluate(beforeDefs[id]);
  const after = evaluate(afterDefs[id]);
  const needsAdminInput = NEEDS_ADMIN_INPUT_VIA_WIZARD.indexOf(id) >= 0;
  const action = needsAdminInput
    ? 'FAIL — chờ Admin cấu hình qua wizard /admin/checklist/ap-dung-lai-mau (nhập trọng số tường minh; engine không tự chọn số)'
    : 'Không dùng Checklist scoring — không cần dòng checklist_total';
  const gateArrow = before.gate + ' → ' + after.gate;
  const row = {
    id,
    usesChecklist: after.requires ? 'Có' : 'Không',
    hadRowBefore: before.hasRow ? 'Có' : 'Chưa có',
    weightBefore: before.totalWeight,
    weightAfter: after.totalWeight,
    gateArrow,
    action,
    formsAffected: 'không xác định được — không có DB local/dev để truy vấn'
  };
  rows.push(row);
  console.log([row.id, row.usesChecklist, row.hadRowBefore, row.weightBefore, row.weightAfter, row.gateArrow, row.action, row.formsAffected].join(' | '));
});

console.log('');
// Sau khi rút lại remediation tự động, "đạt yêu cầu" của audit này KHÔNG còn
// là "gate PASS" (điều đó bây giờ cần Admin, không phải seed) mà là: (a) mọi
// mẫu cần dòng checklist_total đều FAIL đúng như baseline HEAD — chứng minh
// seed đã revert sạch, không còn trọng số tự chọn nào sống sót; và (b) before
// và after giống hệt nhau tuyệt đối cho mọi mẫu (proof-of-no-diff).
const requiringIds = ids.filter(id => evaluate(afterDefs[id]).requires);
const allStillFail = requiringIds.every(id => evaluate(afterDefs[id]).gate !== 'PASS');
const allUnchanged = ids.every(id => {
  const b = evaluate(beforeDefs[id]), a = evaluate(afterDefs[id]);
  return b.hasRow === a.hasRow && Math.abs(b.totalWeight - a.totalWeight) < 0.0001 && b.gate === a.gate;
});
console.log('=== TỔNG KẾT ===');
console.log('Tổng số mẫu: ' + ids.length);
console.log('Số mẫu kích hoạt gate (cần dòng checklist_total): ' + requiringIds.length);
console.log('Tất cả mẫu cần gate vẫn FAIL đúng baseline (không còn remediation tự động nào): ' + allStillFail);
console.log('Trước và sau giống hệt nhau cho mọi mẫu (proof-of-no-diff, seed đã revert sạch): ' + allUnchanged);
process.exitCode = (allStillFail && allUnchanged) ? 0 : 1;
