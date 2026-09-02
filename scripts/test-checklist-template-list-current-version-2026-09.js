'use strict';
/*
 * Regression — Checklist "Mẫu Checklist" list: Phiên bản + Hiệu lực must both come from the
 * SAME current_version of the DB template row.
 *
 * PROD bug: row showed "Phiên bản: BH-1.0" (hardcoded fallback) + "Hiệu lực: 2026-09-01"
 * (the template's current effective_date) — mixed old label + new date.
 *
 * vm-sandbox loading real source (same convention as
 * scripts/test-checklist-monthly-department-filter-ui.js).
 *   node scripts/test-checklist-template-list-current-version-2026-09.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const filePath = 'assets/js/checklist/phf-checklist-app.js';
const src = fs.readFileSync(path.join(root, filePath), 'utf8');

let failures = 0;
function check(c, m) { if (!c) { console.error('FAIL: ' + m); failures++; } else console.log('PASS: ' + m); }

const marker = '\n})();';
const idx = src.lastIndexOf(marker);
const expose = "\n  window.__tlTest={templateCardsHtml:templateCardsHtml,hydrateChecklistTemplatesFromDatabase:hydrateChecklistTemplatesFromDatabase,checklistTemplateDbState:checklistTemplateDbState,templateUiState:templateUiState};\n";
const testSrc = src.slice(0, idx) + expose + src.slice(idx);

const noop = function(){};
const store = {};
const sandbox = {};
sandbox.window = sandbox; sandbox.console = console;
sandbox.addEventListener = noop; sandbox.removeEventListener = noop; sandbox.dispatchEvent = noop;
sandbox.PHF_BUILD_INFO = { version:'test', fingerprint:'test' };
sandbox.document = { documentElement:{setAttribute:noop,getAttribute:()=>null}, addEventListener:noop, removeEventListener:noop,
  querySelector:()=>null, querySelectorAll:()=>[], getElementById:()=>null,
  createElement:()=>({style:{},setAttribute:noop,addEventListener:noop,classList:{add:noop,remove:noop}}),
  body:{classList:{add:noop,remove:noop}}, readyState:'complete' };
sandbox.location = { pathname:'/admin/checklist/mau', search:'', hash:'', origin:'http://localhost' };
sandbox.history = { pushState:noop, replaceState:noop, state:null };
sandbox.localStorage = { getItem:k=>Object.prototype.hasOwnProperty.call(store,k)?store[k]:null, setItem:(k,v)=>{store[k]=String(v);}, removeItem:k=>{delete store[k];} };
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
const api = ctx.window.__tlTest;

const data = {
  checklistTemplatesReady: true,
  checklistTemplatesError: '',
  checklistTemplates: [
    { templateKey:'nv-ban-hang', code:'BH', name:'Nhân viên bán hàng', groupName:'Bán hàng', templateType:'score_summary',
      hasChecklist:true, source:'', note:'', status:'active',
      version:'BH-2.0', effectiveDate:'2026-09-01', updatedAt:'2026-09-01T00:00:00Z',
      definition:{templateType:'score_summary',groups:[],totalRows:[{id:'a',code:'a',name:'a',target:1,unit:'',weight:100,source:{type:'manual'}}]},
      versions:[
        { version:'BH-1.0', effectiveDate:'2026-07-18', reason:'seed', sourceVersion:'', changeType:'sync', createdAt:'2026-07-18T00:00:00Z', definition:{} },
        { version:'BH-2.0', effectiveDate:'2026-09-01', reason:'seed', sourceVersion:'BH-1.0', changeType:'retro-copy', createdAt:'2026-09-01T00:00:00Z', definition:{} }
      ] },
    { templateKey:'nv-kho', code:'NVK', name:'Nhân viên Kho & Sơ chế', groupName:'Kho', templateType:'checklist_detail',
      hasChecklist:true, source:'', note:'', status:'active',
      version:'NVK-1.0', effectiveDate:'2026-08-01', updatedAt:'2026-08-01T00:00:00Z',
      definition:{templateType:'checklist_detail',groups:[],totalRows:[{id:'x',code:'x',name:'x',target:1,unit:'',weight:100,source:{type:'checklist_total'}}]},
      versions:[ { version:'NVK-1.0', effectiveDate:'2026-08-01', reason:'seed', sourceVersion:'', changeType:'sync', createdAt:'2026-08-01T00:00:00Z', definition:{} } ] }
  ]
};
sandbox.__phfLocalData = data;
api.hydrateChecklistTemplatesFromDatabase(data);
api.templateUiState.group = 'all';
api.templateUiState.query = '';

const html = api.templateCardsHtml();
// isolate the Nhân viên bán hàng row
const bhRow = html.split('data-phfck-template-detail="nv-ban-hang"')[0].split('<tr').pop();
const khoRow = html.split('data-phfck-template-detail="nv-kho"')[0].split('<tr').pop();

check(/phfck-template-version-chip">BH-2\.0</.test(bhRow), 'BH row version chip = BH-2.0 (current_version), not BH-1.0');
check(!/phfck-template-version-chip">BH-1\.0</.test(bhRow), 'BH row does NOT show BH-1.0');
check(bhRow.includes('2026-09-01'), 'BH row effective = 2026-09-01 (BH-2.0 version effective date)');
check(!bhRow.includes('2026-07-18'), 'BH row does NOT show BH-1.0 effective date');
check(bhRow.includes('Đang áp dụng'), 'BH row status still "Đang áp dụng"');

check(/phfck-template-version-chip">NVK-1\.0</.test(khoRow), 'other template (nv-kho) still renders version NVK-1.0');
check(khoRow.includes('2026-08-01'), 'nv-kho effective = its own version date 2026-08-01');

console.log('\n' + (failures ? (failures + ' FAIL') : 'ALL PASS'));
process.exit(failures ? 1 : 0);
