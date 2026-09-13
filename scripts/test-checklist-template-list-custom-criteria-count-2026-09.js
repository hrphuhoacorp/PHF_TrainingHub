'use strict';
/*
 * Regression — Checklist "Mẫu Checklist" list card criterion count.
 *
 * PROD bug: a custom/web-created template's list-card "Tiêu chí" count fell through to
 * SALES_TEMPLATE_GROUPS (46) whenever the template id was unknown to the built-in ids,
 * because templateListMeta() computed count from baseTemplateGroups(item.id) BEFORE ever
 * consulting the template's own DB override (the exact source the detail view already uses
 * via selectedTemplateGroups()). Fix: count from override.groups when present; for a custom
 * template with no override, count is 0 — never the Sales fallback.
 *
 * vm-sandbox loading real source (same convention as
 * scripts/test-checklist-template-list-current-version-2026-09.js).
 *   node scripts/test-checklist-template-list-custom-criteria-count-2026-09.js
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

function group(childCount) {
  var items = [];
  for (var i = 0; i < childCount; i++) items.push(['C' + i, 'Nội dung ' + i, 1]);
  return { code: 'G1', name: 'Nhóm 1', children: [{ code: 'C', name: 'Con', items: items }] };
}

const data = {
  checklistTemplatesReady: true,
  checklistTemplatesError: '',
  checklistTemplates: [
    // Custom template with a real 6-criterion definition (must show 6, not 46).
    { templateKey:'mktvideo3-1-nhan-vien-mkt-video', code:'MKTVIDEO3-1', name:'Nhân viên MKT Video', groupName:'Marketing', templateType:'checklist_detail',
      hasChecklist:true, source:'Tạo trực tiếp trên web', note:'', status:'active',
      version:'MKTVIDEO3-1-1.1', effectiveDate:'2026-08-01', updatedAt:'2026-08-01T00:00:00Z',
      definition:{templateType:'checklist_detail',groups:[group(6)],totalRows:[]},
      versions:[] },
    // Obsolete custom template with NO definition/override at all (must show 0, never Sales' 46).
    { templateKey:'mktvideo-nhan-vien-mkt-video-content-creator', code:'MKTVIDEO', name:'MKT Video (cũ)', groupName:'Marketing', templateType:'checklist_detail',
      hasChecklist:true, source:'Tạo trực tiếp trên web', note:'', status:'active',
      version:'', effectiveDate:'', updatedAt:'2026-07-01T00:00:00Z',
      definition:null,
      versions:[] },
    // Custom template with an explicit empty group definition (must show 0).
    { templateKey:'mv-mkt-video-nhan-vien-mkt-video-content-creator', code:'MV-MKT-VIDEO', name:'MKT Video (test)', groupName:'Marketing', templateType:'checklist_detail',
      hasChecklist:true, source:'Tạo trực tiếp trên web', note:'', status:'active',
      version:'', effectiveDate:'', updatedAt:'2026-07-02T00:00:00Z',
      definition:{templateType:'checklist_detail',groups:[],totalRows:[]},
      versions:[] },
    // Real built-in Sales template — legitimate count must be unchanged.
    { templateKey:'nv-ban-hang', code:'BH', name:'Nhân viên bán hàng', groupName:'Bán hàng', templateType:'checklist_detail',
      hasChecklist:true, source:'', note:'', status:'active',
      version:'', effectiveDate:'', updatedAt:'2026-08-01T00:00:00Z',
      definition:null,
      versions:[] }
  ]
};
sandbox.__phfLocalData = data;
api.hydrateChecklistTemplatesFromDatabase(data);
api.templateUiState.group = 'all';
api.templateUiState.query = '';

const html = api.templateCardsHtml();
function rowFor(id) { return html.split('data-phfck-template-detail="' + id + '"')[0].split('<tr').pop(); }

const salesCriteriaCountMatch = html.match(/phfck-template-count">(\d+)<\/strong>[\s\S]*?data-phfck-template-detail="nv-ban-hang"/);
const salesCount = salesCriteriaCountMatch ? Number(salesCriteriaCountMatch[1]) : NaN;

const mktRow = rowFor('mktvideo3-1-nhan-vien-mkt-video');
check(/phfck-template-count">6<\/strong>/.test(mktRow), 'custom template with 6 criteria shows 6, not fallback count');

const obsolete1Row = rowFor('mktvideo-nhan-vien-mkt-video-content-creator');
check(/phfck-template-count">0<\/strong>/.test(obsolete1Row), 'custom template with no definition shows 0, not Sales fallback (46)');

const obsolete2Row = rowFor('mv-mkt-video-nhan-vien-mkt-video-content-creator');
check(/phfck-template-count">0<\/strong>/.test(obsolete2Row), 'custom template with 0 criteria shows 0');

const bhRow = rowFor('nv-ban-hang');
check(salesCount > 0, 'Sales template shows its own legitimate (non-zero) count');
check(new RegExp('phfck-template-count">' + salesCount + '</strong>').test(bhRow), 'real Sales built-in template count is unchanged (not forced to 0)');

console.log('\n' + (failures ? (failures + ' FAIL') : 'ALL PASS'));
process.exit(failures ? 1 : 0);
