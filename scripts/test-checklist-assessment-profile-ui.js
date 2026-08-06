'use strict';
/* Structural regression for UX-01 Batch 3 - "Hồ sơ đánh giá" (shared
   learner/manager UI + routes for getChecklistAssessmentProfile, added on
   top of the Batch 1/2 backend in lib/checklist-monthly.js).

   Same source-scanning approach as scripts/test-checklist-permissions-tab-guard.js
   and the reasoning in its header applies here too: the render logic lives
   inside one large IIFE (assets/js/checklist/phf-checklist-app.js) with no
   jsdom dependency in this project, so this test asserts the exact wiring
   that makes the feature safe (route registration, learner/manager branch
   separation, no client-side target for learner, request-token race guard,
   owner-scoped reset, 403 fallback-to-self) rather than driving a real DOM
   render. Manual click-through per the batch handoff report is still
   required to verify actual rendered behaviour.

   File này KHÔNG được gọi tự động ở bất kỳ đâu - chỉ chạy thủ công:
     node scripts/test-checklist-assessment-profile-ui.js
*/
const fs = require('fs');
const path = require('path');

const appPath = path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js');
const routerPath = path.resolve(__dirname, '..', 'assets/js/phf-url-router.js');
const learnerAppPath = path.resolve(__dirname, '..', 'assets/js/phf-learner-app.js');
const app = fs.readFileSync(appPath, 'utf8');
const router = fs.readFileSync(routerPath, 'utf8');
const learnerApp = fs.readFileSync(learnerAppPath, 'utf8');

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}
function fnBody(source, name, paramsPattern) {
  const re = new RegExp('function ' + name + '\\(' + (paramsPattern || '[^)]*') + '\\)\\{([\\s\\S]*?)\\n  \\}');
  const m = source.match(re);
  return m ? m[1] : null;
}

// ---------- A/B/C. Routes registered path-based, F5-safe ----------
check(/'\/hv\/checklist\/ho-so-danh-gia':Object\.freeze\(\{area:'learner',screen:'checklist-assessment-profile',roles:\['learner'\]\}\)/.test(router),
  'A. ROUTE_REGISTRY has /hv/checklist/ho-so-danh-gia scoped to role learner');
check(/'\/ql\/checklist\/ho-so-danh-gia':Object\.freeze\(\{area:'manager',screen:'checklist-assessment-profile',roles:\['manager'\]\}\)/.test(router),
  'B. ROUTE_REGISTRY has /ql/checklist/ho-so-danh-gia scoped to role manager');
check(!/'\/admin\/checklist\/ho-so-danh-gia'/.test(router), 'F. ROUTE_REGISTRY has no admin route for the assessment profile screen');
const routeMapMatch = router.match(/window\.PHF_ROUTE_MAP=Object\.freeze\(\{([\s\S]*?)\}\);/);
check(!!routeMapMatch, 'C0. PHF_ROUTE_MAP block found');
if (routeMapMatch) {
  const body = routeMapMatch[1];
  check(/learner:\[[^\]]*'\/hv\/checklist\/ho-so-danh-gia'/.test(body), 'C. PHF_ROUTE_MAP.learner includes the learner assessment-profile path (F5/deep-link safe)');
  check(/management:\[[^\]]*'\/ql\/checklist\/ho-so-danh-gia'/.test(body), 'C. PHF_ROUTE_MAP.management includes the manager assessment-profile path (F5/deep-link safe)');
  check(/checklist:\[[^\]]*'\/hv\/checklist\/ho-so-danh-gia'[^\]]*'\/ql\/checklist\/ho-so-danh-gia'/.test(body), 'C. PHF_ROUTE_MAP.checklist bucket includes both new paths');
}
// Dispatcher itself is unchanged (still the generic /hv|ql|admin/checklist prefix regex) -
// adding registry entries is enough; assert the regex was not narrowed/duplicated.
check(/\/\^\\\/\(\?:admin\|ql\|hv\)\\\/checklist\(\?:\\\/\|\$\)\/\.test\(path\)/.test(router),
  'A/B. Router dispatch regex for /hv|ql|admin/checklist prefix is unchanged (new routes ride the existing dispatcher)');

// ---------- Training Hub bulk-load skip stays aligned with the new routes ----------
check(/path === '\/ql\/checklist\/ho-so-danh-gia' \|\| path === '\/hv\/checklist\/ho-so-danh-gia'/.test(learnerApp),
  'phfChecklistRoleWorkspaceIsActive() includes both new routes (avoids an unnecessary Training Hub scope=staff load)');

// ---------- D/E/F. Menu wiring per role ----------
check(/data-phfck-open-assessment-profile>🗎 Hồ sơ đánh giá<\/button>/.test(app),
  'D. Learner personal page renders a single "Hồ sơ đánh giá" entry-point button (no scattered menus)');
check(/item\('assessment-profile','🗎','Hồ sơ đánh giá','Tiêu chuẩn, điểm và lịch sử theo kỳ',grant\.capabilities&&grant\.capabilities\.view_monthly===true\)/.test(app),
  'E. managerSidebarHtml() renders the "Hồ sơ đánh giá" item gated on grant.capabilities.view_monthly (backend still re-checks)');
// managerSidebarHtml() is hidden entirely on mobile (isMobileWorkspace()?''.:managerSidebarHtml(data),
// see roleWorkspaceContentHtml) - the sidebar item alone is unreachable on phones. There must
// also be an in-content entry point (same pattern already used for "Xem báo cáo") that survives
// on mobile, gated the same way as the sidebar item.
check(/data-phfck-manager-section="assessment-profile">🗎 Hồ sơ đánh giá<\/button>/.test(app),
  'E. A second, in-content entry point (mirroring the "Xem báo cáo" quick action) exists so mobile managers - where the sidebar is hidden - can still reach the screen');
const adminMenuMatch = app.match(/function adminMenu\(\)\{([\s\S]*?)\n  \}/);
check(!!adminMenuMatch, 'F0. adminMenu() found');
if (adminMenuMatch) check(!/ho-so-danh-gia|assessment-profile|Hồ sơ đánh giá/.test(adminMenuMatch[1]), 'F. adminMenu() has no entry for the assessment profile screen');
const adminDashboardMatch = app.match(/function adminDashboard\([^)]*\)\{([\s\S]*?)\n  \}/);
check(!!adminDashboardMatch, 'F1. adminDashboard() found');
if (adminDashboardMatch) check(!/assessmentProfileHtml|assessment-profile/.test(adminDashboardMatch[1]), 'F. adminDashboard() never calls into the assessment profile renderer');

// ---------- G/H. Target selector only for manager, sourced from allowedTargets ----------
const periodBarBody = fnBody(app, 'assessmentProfilePeriodBarHtml', '\\s*data,isManager\\s*');
check(!!periodBarBody, 'G0. assessmentProfilePeriodBarHtml() found');
if (periodBarBody) check(/\(isManager\?assessmentProfileTargetPickerHtml\(data\):''\)/.test(periodBarBody),
  'G. Target picker is only rendered when isManager is true - learner branch never mounts it');
check(/roleWorkspaceContentHtml[\s\S]{0,2000}cleanPath\(path\)==='\/hv\/checklist\/ho-so-danh-gia'\)return '<main class="phfck-role-main">'\+assessmentProfileHtml\(path\)\+'<\/main>'/.test(app),
  'G. Learner route renders assessmentProfileHtml(path) directly (routeRole is always learner for /hv/*, so isManager is structurally false there)');
const targetListBody = fnBody(app, 'assessmentProfileTargetListHtml', '\\s*data\\s*');
check(!!targetListBody && /data\.allowedTargets/.test(targetListBody), 'H. Target list is built from data.allowedTargets (server-scoped), not a separately fetched company-wide list');
check(!!targetListBody && !/getChecklistRoleWorkspace|fetchLatestChecklistPeopleData|checklistEmployees\(\)/.test(targetListBody),
  'H. Target list does not pull from the broader people/company datasets (no "load everyone then filter" pattern)');

// ---------- I/J. Payload construction: manager may send targetEmployeeCode, learner never does ----------
const loaderBody = fnBody(app, 'loadAssessmentProfile', '\\s*root,options\\s*');
check(!!loaderBody, 'I0. loadAssessmentProfile() found');
if (loaderBody) {
  check(/var targetCode=isManager\?\(options\.targetEmployeeCode!=null\?String\(options\.targetEmployeeCode\)\.toUpperCase\(\):assessmentProfileUiState\.selectedTargetCode\):'';/.test(loaderBody),
    'I. targetCode is only ever sourced from state/options when isManager is true; forced to \'\' otherwise');
  check(/if\(isManager&&targetCode\)payload\.targetEmployeeCode=targetCode;/.test(loaderBody),
    'I/J. payload.targetEmployeeCode is only attached when isManager && targetCode is truthy - learner payload never contains it');
  check(!/targetEmployeeId/.test(loaderBody), 'Loader never sends targetEmployeeId (spec: only targetEmployeeCode needed)');
}

// ---------- K. Request race guard ----------
if (loaderBody) {
  check(/var token=\(assessmentProfileUiState\.requestToken\|\|0\)\+1;/.test(loaderBody) && /assessmentProfileUiState\.requestToken=token;/.test(loaderBody),
    'K. Every load increments a shared requestToken before the fetch starts');
  check(/function isCurrent\(\)\{return assessmentProfileUiState\.ownerKey===ownerKey&&assessmentProfileUiState\.requestToken===token;\}/.test(loaderBody),
    'K. isCurrent() re-checks both ownerKey and requestToken');
  check((loaderBody.match(/if\(!isCurrent\(\)\)return false;/g) || []).length >= 2,
    'K. Both the success and the error branch bail out via isCurrent() before mutating state (stale response cannot overwrite a newer selection)');
}

// ---------- L. Logout/login + role-switch reset ----------
check(/function resetAssessmentProfileForOwner\(ownerKey\)\{/.test(app), 'L0. resetAssessmentProfileForOwner() exists');
const resetOwnerBody = fnBody(app, 'resetRoleWorkspaceForOwner', '\\s*ownerKey\\s*');
check(!!resetOwnerBody && /resetAssessmentProfileForOwner\(ownerKey\);/.test(resetOwnerBody),
  'L. resetRoleWorkspaceForOwner() (the single identity-change hook already used for logout/login and learner<->manager switches) also resets assessmentProfileUiState');

// ---------- M/N. Score/standard status wording ----------
const scoreHtmlBody = fnBody(app, 'assessmentProfileScoreHtml', '\\s*currentScore\\s*');
check(!!scoreHtmlBody, 'M0. assessmentProfileScoreHtml() found');
if (scoreHtmlBody) {
  const notStartedBranch = scoreHtmlBody.match(/if\(status==='not_started'\)body=([^;]*);/);
  check(!!notStartedBranch && !/assessmentProfileScoreCardsHtml/.test(notStartedBranch[1]),
    'M. not_started branch never calls assessmentProfileScoreCardsHtml() - no fake 0 score rendered');
  check(/Chưa bắt đầu tự đánh giá/.test(scoreHtmlBody), 'M. not_started renders the correct empty-state label');
}
const standardHtmlBody = fnBody(app, 'assessmentProfileStandardHtml', '\\s*standard\\s*');
check(!!standardHtmlBody && /status==='expected'&&data\)body='<div class="phfck-role-note is-warning"><b>Dự kiến áp dụng<\/b><p>Tiêu chuẩn có thể thay đổi trước khi phiếu được tạo\.<\/p><\/div>'/.test(standardHtmlBody),
  'N. expected standard renders an explicit "Dự kiến áp dụng" label + caveat, not presented as the official standard');

// ---------- O/P. Independent standard/history error handling ----------
const bodyHtmlBody = fnBody(app, 'assessmentProfileBodyHtml', '');
check(!!bodyHtmlBody, 'O0. assessmentProfileBodyHtml() found');
if (bodyHtmlBody) {
  check(/assessmentProfileStandardHtml\(data\.standard\)\+assessmentProfileScoreHtml\(data\.currentScore\)/.test(bodyHtmlBody) && /assessmentProfileHistoryHtml\(data\.history\)/.test(bodyHtmlBody),
    'O/P. assessmentProfileBodyHtml() always renders standard AND history unconditionally in the same pass - one section\'s status can never suppress the other');
}
check(/if\(history\.status==='error'\)return/.test(app) && /Chưa tải được lịch sử điểm/.test(app),
  'P. History renders its own dedicated error panel instead of silently disappearing');
check(!!standardHtmlBody && /Chưa tải được tiêu chuẩn áp dụng/.test(standardHtmlBody) && /status==='unassigned'/.test(standardHtmlBody),
  'O. Standard renders its own dedicated error panel (separate from unassigned/expected) instead of silently disappearing');

// ---------- Q. Statistics are backend-sourced, not recomputed client-side ----------
const historyHtmlBody = fnBody(app, 'assessmentProfileHistoryHtml', '\\s*history\\s*');
check(!!historyHtmlBody && /stats\.average/.test(historyHtmlBody) && /stats\.maximum/.test(historyHtmlBody) && /stats\.minimum/.test(historyHtmlBody) && /stats\.countedPeriods/.test(historyHtmlBody),
  'Q. History statistics read directly from history.statistics (server-computed)');
check(!!historyHtmlBody && !/reduce\(/.test(historyHtmlBody) && !/Math\.max\(|Math\.min\(/.test(historyHtmlBody),
  'Q. No client-side average/max/min recomputation over records (no reduce/Math.max/Math.min)');

// ---------- R. Scope revocation (403/404) on a chosen target ----------
if (loaderBody) {
  check(/if\(isManager&&targetCode&&\(status===403\|\|status===404\)\)\{/.test(loaderBody),
    'R0. Catch block special-cases 403/404 while viewing a non-self target');
  check(/checklistToast\('error','Không thể mở hồ sơ nhân viên này'/.test(loaderBody),
    'R. A clear permission-error toast is shown on 403/404 for a chosen target');
  check(/return loadAssessmentProfile\(root,\{month:month,year:year,targetEmployeeCode:''\}\);/.test(loaderBody),
    'R. On 403/404 the UI falls back to self, which re-fetches allowedTargets fresh (no stale scope kept)');
  check(/assessmentProfileUiState\.data=null;\s*\n\s*assessmentProfileUiState\.loaded=false;/.test(loaderBody),
    'R. Generic (non-fallback) failure path clears stale data instead of leaving the previous person\'s data on screen');
}

// ---------- S. No regressions in neighboring, previously-shipped routes/sections ----------
check(/'\/ql\/checklist\/bao-cao':Object\.freeze\(\{area:'manager',screen:'checklist-reports',roles:\['manager'\]\}\)/.test(router), 'S. Existing /ql/checklist/bao-cao route untouched');
check(/'\/ql\/checklist\/phan-quyen':Object\.freeze\(\{area:'manager',screen:'checklist-permissions',roles:\['manager'\]\}\)/.test(router), 'S. Existing /ql/checklist/phan-quyen route untouched');
check(/var allowed=\['overview','my-work','people','violations','reviews','reports','permissions','assessment-profile'\];/.test(app),
  'S. managerSectionFromLocation() keeps all previously-allowed sections plus the new one (no section silently dropped)');
check(/if\(section==='reports'\)return reportsHtml\(\);/.test(app), 'S. Existing reports section dispatch untouched');
check(/if\(section==='permissions'\)return isAssistantWebOperator\(\)\?settingsHtml\(\):permissionAccessDeniedHtml\(\);/.test(app), 'S. Existing permissions section dispatch/guard untouched');

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL PASS'));
process.exit(failures ? 1 : 0);
