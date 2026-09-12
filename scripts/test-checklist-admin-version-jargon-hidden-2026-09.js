'use strict';
/*
 * Regression — Admin UX cleanup (2026-09-12): hide technical Checklist template-version
 * jargon (e.g. "TBP-HCNS-1.3", "BH-2.0") from routine Admin operations while:
 *  - keeping template name / effective date / operational status visible,
 *  - rendering template updatedAt as "Cập nhật gần nhất",
 *  - distinguishing "Đã cập nhật theo mẫu hiện tại" vs "Chưa áp dụng thay đổi mới cho kỳ này"
 *    on the monthly form list using the existing template_outdated/version_overridden fields
 *    (never inventing an "applied at" timestamp),
 *  - still auto-generating the internal version string (nextTemplateVersion) instead of
 *    asking Admin to type/understand it (Bảng tổng điểm "Sửa" flow),
 *  - leaving raw versions intact in audit/history/import-export contracts.
 *
 * vm-sandbox loading real source (same convention as
 * scripts/test-checklist-template-list-current-version-2026-09.js).
 *   node scripts/test-checklist-admin-version-jargon-hidden-2026-09.js
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
const expose = "\n  window.__jargonTest={" +
  "monthlyFormsHtml:monthlyFormsHtml,monthlyUiState:monthlyUiState," +
  "assignmentVersionSummary:assignmentVersionSummary,assignmentTemplateOptions:assignmentTemplateOptions," +
  "hydrateChecklistTemplatesFromDatabase:hydrateChecklistTemplatesFromDatabase,checklistTemplateDbState:checklistTemplateDbState," +
  "tseOpen:tseOpen,getTseState:function(){return checklistTseState;}," +
  "checklistTsePreviewHtml:checklistTsePreviewHtml,tseActivateBannerHtml:tseActivateBannerHtml," +
  "nextTemplateVersion:nextTemplateVersion,templateById:templateById," +
  "cePreviewHtml:cePreviewHtml" +
  "};\n";
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
const api = ctx.window.__jargonTest;

const data = {
  checklistTemplatesReady: true,
  checklistTemplatesError: '',
  checklistTemplates: [
    { templateKey:'nv-ban-hang', code:'BH', name:'Nhân viên bán hàng', groupName:'Bán hàng', templateType:'score_summary',
      hasChecklist:true, source:'', note:'', status:'active',
      version:'BH-2.0', effectiveDate:'2026-09-01', updatedAt:'2026-09-01T02:00:00Z',
      definition:{templateType:'score_summary',groups:[],totalRows:[{id:'a',code:'a',name:'a',target:1,unit:'',weight:100,source:{type:'manual'}}]},
      versions:[
        { version:'BH-1.0', effectiveDate:'2026-07-18', reason:'Bản đầu tiên', sourceVersion:'', changeType:'sync', createdAt:'2026-07-18T00:00:00Z', definition:{} },
        { version:'BH-2.0', effectiveDate:'2026-09-01', reason:'Cập nhật trọng số', sourceVersion:'BH-1.0', changeType:'retro-copy', createdAt:'2026-09-01T00:00:00Z', definition:{} }
      ] }
  ]
};
sandbox.__phfLocalData = data;
api.hydrateChecklistTemplatesFromDatabase(data);

// ---------------------------------------------------------------------------
// 1. Assignment popup summary (assignmentVersionSummary) — no raw version string,
//    template name + plain effective-date wording remain.
// ---------------------------------------------------------------------------
const summaryHtml = api.assignmentVersionSummary('nv-ban-hang', '2026-09-05');
check(!/BH-2\.0/.test(summaryHtml) && !/BH-1\.0/.test(summaryHtml), '1a. assignmentVersionSummary() does not expose raw version string');
check(summaryHtml.includes('Nhân viên bán hàng'), '1b. assignmentVersionSummary() shows template name');
check(summaryHtml.includes('01/09/2026') || summaryHtml.includes('hiệu lực'), '1c. assignmentVersionSummary() shows plain effective-date wording');

// ---------------------------------------------------------------------------
// 2. Assignment template <select> options — no raw version string in option text.
// ---------------------------------------------------------------------------
const optionsHtml = api.assignmentTemplateOptions('', '2026-09-05');
check(!/BH-2\.0/.test(optionsHtml) && !/BH-1\.0/.test(optionsHtml), '2a. assignmentTemplateOptions() option labels do not expose raw version string');
check(optionsHtml.includes('Nhân viên bán hàng'), '2b. assignmentTemplateOptions() still shows template name');

// ---------------------------------------------------------------------------
// 3. Phiếu đánh giá tháng list — status wording distinguishes applied vs not applied;
//    raw version never shown; form updated_at (if shown) is labeled "Phiếu cập nhật gần nhất".
// ---------------------------------------------------------------------------
api.monthlyUiState.status = 'all';
api.monthlyUiState.period = { status:'open' };
api.monthlyUiState.forms = [
  { id:'f-uptodate', employee_name:'Nguyễn Văn A', employee_code:'PHF001', period_month:'2026-09', status:'draft',
    template_id:'nv-ban-hang', template_version:'BH-2.0', current_template_id:'nv-ban-hang', current_template_version:'BH-2.0',
    reviewer_code:'PHF042', reviewer_name:'Quản lý', checklist_score:100, final_score:null, updated_at:'2026-09-05T03:00:00Z',
    version_overridden:false, template_outdated:false, template_repairable:false, version_override_eligible:true },
  { id:'f-outdated', employee_name:'Trần Thị B', employee_code:'PHF002', period_month:'2026-09', status:'draft',
    template_id:'nv-ban-hang', template_version:'BH-1.0', current_template_id:'nv-ban-hang', current_template_version:'BH-2.0',
    reviewer_code:'PHF042', reviewer_name:'Quản lý', checklist_score:100, final_score:null, updated_at:'2026-09-02T03:00:00Z',
    version_overridden:false, template_outdated:true, template_repairable:true, version_override_eligible:true }
];
const monthlyHtml = api.monthlyFormsHtml();
check(!/BH-2\.0/.test(monthlyHtml) && !/BH-1\.0/.test(monthlyHtml), '3a. monthlyFormsHtml() never exposes raw template-version string');
check(monthlyHtml.includes('Nhân viên bán hàng'), '3b. monthlyFormsHtml() shows human-readable template name');
check(monthlyHtml.includes('Đã cập nhật theo mẫu hiện tại'), '3c. up-to-date form shows "Đã cập nhật theo mẫu hiện tại"');
check(monthlyHtml.includes('Chưa áp dụng thay đổi mới cho kỳ này'), '3d. outdated form shows "Chưa áp dụng thay đổi mới cho kỳ này"');
check(!monthlyHtml.includes('Mẫu cập nhật') && !monthlyHtml.includes('Đã áp dụng lúc'), '3e. form updated_at is never mislabeled as "Mẫu cập nhật"/"Đã áp dụng lúc"');
check(/Phiếu cập nhật gần nhất:/.test(monthlyHtml), '3f. form updated_at (when present) is labeled only "Phiếu cập nhật gần nhất"');

// ---------------------------------------------------------------------------
// 4. Bảng tổng điểm "Sửa" flow — internal version string is auto-generated (via the
//    existing nextTemplateVersion() helper, at save time — see tseOpenPreview()/
//    tseConfirmSaveAndApply() in phf-checklist-app.js) rather than typed by Admin,
//    and never rendered as raw text in the preview dialog.
// ---------------------------------------------------------------------------
api.tseOpen('nv-ban-hang');
const tseState = api.getTseState();
check(tseState.newVersion === '', '4a. tseOpen() does not pre-fill any version for Admin to see/edit');
tseState.newVersion = api.nextTemplateVersion(tseState.sourceVersion);
check(!!tseState.newVersion && tseState.newVersion !== tseState.sourceVersion, '4b. nextTemplateVersion() (the same auto-generation helper used at save time) produces a valid internal version for the save payload');
tseState.preview = { added:[], removed:[], changed:[], renamed:[], totalWeightBefore:100, totalWeightAfter:100 };
const tsePreviewHtml = api.checklistTsePreviewHtml();
check(!tsePreviewHtml.includes(tseState.newVersion) && !tsePreviewHtml.includes('BH-2.0'), '4c. tse preview dialog never renders the auto-generated version string as raw text');
check(!/data-phfck-tse-new-version/.test(tsePreviewHtml), '4d. tse preview dialog has no manual "Phiên bản mới" input for Admin to fill in');

// ---------------------------------------------------------------------------
// 5. cePreviewHtml() — Apply-timing V1 batch criterion-edit confirmation modal (2026-09-12
//    PROD incident: this modal, opened right before "Lưu & áp dụng", still exposed the raw
//    technical version codes p.oldVersion/p.newVersion via ĐANG ÁP DỤNG/SAU KHI LƯU — a
//    sibling surface that PR #72's directEditPreviewHtml() fix did not reach). Fixed to the
//    same plain-language convention: no raw version cards, only ÁP DỤNG TỪ + SỐ TIÊU CHÍ.
// ---------------------------------------------------------------------------
const cePreview = api.cePreviewHtml({
  templateId: 'nv-ban-hang', oldVersion: 'BH-1.0', newVersion: 'BH-2.0',
  effectiveDate: '2026-09-12', reason: 'Sua loi chinh ta trong noi dung tieu chi',
  state: { groups: [{ code: 'G1', name: 'Nhóm 1', children: [{ code: 'C1', name: 'Nhóm con 1', items: [['C1-01', 'Tiêu chí 1', 1]] }] }] },
  retro: null
});
check(!/BH-1\.0/.test(cePreview) && !/BH-2\.0/.test(cePreview), '5a. cePreviewHtml() does not expose raw old/new version strings');
check(!/ĐANG ÁP DỤNG/.test(cePreview), '5b. cePreviewHtml() no longer shows "ĐANG ÁP DỤNG"');
check(!/SAU KHI LƯU/.test(cePreview), '5c. cePreviewHtml() no longer shows "SAU KHI LƯU"');
check(/ÁP DỤNG TỪ/.test(cePreview), '5d. cePreviewHtml() shows plain-language "ÁP DỤNG TỪ"');
check(/SỐ TIÊU CHÍ/.test(cePreview) && /\b1\b/.test(cePreview), '5e. cePreviewHtml() still shows the criterion count');

console.log('\n' + (failures ? (failures + ' FAIL') : 'ALL PASS'));
process.exit(failures ? 1 : 0);
