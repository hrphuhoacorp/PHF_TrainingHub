'use strict';
/*
 * Regression — per-form version override UI markers (CASE 15/16).
 *
 * - version_overridden form  -> "Điều chỉnh thủ công" badge, NO "Mẫu chụp khác phân công
 *   hiện tại" warning, NO "Cập nhật mẫu" button.
 * - version_override_eligible form -> "Điều chỉnh phiên bản" button.
 * - normal assignment-driven matching form -> no manual-override badge.
 *
 * vm-sandbox loading real source (same convention as
 * scripts/test-checklist-monthly-department-filter-ui.js).
 *   node scripts/test-checklist-monthly-version-override-ui-2026-09.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const filePath = 'assets/js/checklist/phf-checklist-app.js';
const src = fs.readFileSync(path.join(root, filePath), 'utf8');

let failures = 0;
function check(c, m) { if (!c) { console.error('FAIL: ' + m); failures++; } else console.log('PASS: ' + m); }

// ---- source-scan: backend action + route + retro engine reuse
const monthlyLib = fs.readFileSync(path.join(root, 'api/_lib/checklist-monthly.js'), 'utf8');
check(monthlyLib.includes("require('./checklist-template-retroactive')") && monthlyLib.includes('classifyFormForApply'), 'checklist-monthly.js reuses classifyFormForApply from the canonical retro engine (no second remap engine)');
check(monthlyLib.includes("action:'manual_version_override'"), "history action 'manual_version_override' written");
check(!/checklist_employee_assignments[^;]*\.update\(/.test(monthlyLib.split('async function overrideMonthlyFormVersion')[1].split('function exportStatus')[0]), 'overrideMonthlyFormVersion never updates checklist_employee_assignments');
check(fs.readFileSync(path.join(root, 'server.js'), 'utf8').includes("'overrideChecklistMonthlyFormVersion'") && fs.readFileSync(path.join(root, 'api/data.js'), 'utf8').includes("'overrideChecklistMonthlyFormVersion'"), 'action routed in BOTH server.js and api/data.js (Production parity)');

// ---- render markers via vm sandbox
const marker = '\n})();';
const idx = src.lastIndexOf(marker);
const expose = "\n  window.__ovTest={monthlyUiState:monthlyUiState,monthlyFormsHtml:monthlyFormsHtml};\n";
const testSrc = src.slice(0, idx) + expose + src.slice(idx);

const noop = function(){};
const sandbox = {};
sandbox.window = sandbox; sandbox.console = console;
sandbox.addEventListener = noop; sandbox.removeEventListener = noop; sandbox.dispatchEvent = noop;
sandbox.PHF_BUILD_INFO = { version: 'test', fingerprint: 'test' };
sandbox.document = { documentElement:{setAttribute:noop,getAttribute:()=>null}, addEventListener:noop, removeEventListener:noop,
  querySelector:()=>null, querySelectorAll:()=>[], getElementById:()=>null,
  createElement:()=>({style:{},setAttribute:noop,addEventListener:noop,classList:{add:noop,remove:noop}}),
  body:{classList:{add:noop,remove:noop}}, readyState:'complete' };
sandbox.location = { pathname:'/admin/checklist/phieu-danh-gia-thang', search:'', hash:'', origin:'http://localhost' };
sandbox.history = { pushState:noop, replaceState:noop, state:null };
sandbox.localStorage = { getItem:()=>null, setItem:noop, removeItem:noop };
sandbox.navigator = { userAgent:'node-test' };
sandbox.matchMedia = null;
sandbox.MutationObserver = function(){ return { observe:noop, disconnect:noop }; };
sandbox.fetch = ()=>Promise.resolve({ ok:true, json:()=>Promise.resolve({}) });
sandbox.URL = URL; sandbox.setTimeout = setTimeout; sandbox.clearTimeout = clearTimeout;
sandbox.requestAnimationFrame = fn => setTimeout(fn,0);
sandbox.CSS = { escape:v=>String(v) };
sandbox.__phfLocalData = null;
const ctx = vm.createContext(sandbox);
new vm.Script(testSrc, { filename: filePath }).runInContext(ctx);
const api = ctx.window.__ovTest;

api.monthlyUiState.status = 'all';
api.monthlyUiState.period = { status: 'open' };
api.monthlyUiState.forms = [
  { id:'f-override', employee_name:'Châu Quỳnh Như', employee_code:'PHF078', period_month:'2026-09', status:'draft',
    template_id:'nv-ban-hang', template_version:'BH-1.0', current_template_id:'nv-ban-hang', current_template_version:'BH-2.0',
    reviewer_code:'PHF042', reviewer_name:'Nguyễn Hoàng Khang', checklist_score:100, final_score:null,
    version_overridden:true, template_outdated:false, template_repairable:false, version_override_eligible:true },
  { id:'f-normal', employee_name:'Lý Minh Phước', employee_code:'PHF082', period_month:'2026-09', status:'draft',
    template_id:'nv-ban-hang', template_version:'BH-2.0', current_template_id:'nv-ban-hang', current_template_version:'BH-2.0',
    reviewer_code:'PHF042', reviewer_name:'Nguyễn Hoàng Khang', checklist_score:100, final_score:null,
    version_overridden:false, template_outdated:false, template_repairable:false, version_override_eligible:true },
  { id:'f-locked', employee_name:'NV Khóa', employee_code:'PHF099', period_month:'2026-09', status:'locked',
    template_id:'nv-ban-hang', template_version:'BH-2.0', reviewer_code:'PHF042', reviewer_name:'X', checklist_score:100, final_score:90,
    version_overridden:false, version_override_eligible:false }
];
const html = api.monthlyFormsHtml();

// CASE 15
const overrideRow = html.split('data-phfck-monthly-menu="f-override"')[0].split('<tr>').pop();
check(html.includes('Điều chỉnh thủ công'), 'CASE 15: "Điều chỉnh thủ công" badge shown for version_overridden form');
check(html.includes('Phiếu: BH-1.0 · Phân công hiện tại: BH-2.0'), 'CASE 15: shows "Phiếu: BH-1.0 · Phân công hiện tại: BH-2.0"');
check(!/f-override[\s\S]*?Mẫu chụp khác phân công hiện tại[\s\S]*?<\/td>/.test(html) || !html.slice(html.indexOf('f-override'), html.indexOf('f-normal')).includes('Mẫu chụp khác phân công'), 'CASE 15: overridden form does NOT show the mismatch/corruption warning');

// CASE 16
check((html.match(/Điều chỉnh thủ công/g) || []).length === 1, 'CASE 16: normal matching form does NOT show manual-override badge (only 1 total)');

// button presence
check((html.match(/data-phfck-monthly-version-override="f-override"/g) || []).length === 1, '"Điều chỉnh phiên bản" button on eligible overridden form');
check((html.match(/data-phfck-monthly-version-override="f-normal"/g) || []).length === 1, '"Điều chỉnh phiên bản" button on eligible normal form');
check(!html.includes('data-phfck-monthly-version-override="f-locked"'), 'no "Điều chỉnh phiên bản" button on locked form (not eligible)');

console.log('\n' + (failures ? (failures + ' FAIL') : 'ALL PASS'));
process.exit(failures ? 1 : 0);
