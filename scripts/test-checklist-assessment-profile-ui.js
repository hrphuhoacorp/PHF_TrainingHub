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
const cssPath = path.resolve(__dirname, '..', 'assets/css/phf-checklist.css');
const app = fs.readFileSync(appPath, 'utf8');
const router = fs.readFileSync(routerPath, 'utf8');
const learnerApp = fs.readFileSync(learnerAppPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

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

// ---------- D/E/F. Menu wiring across the 4 account classes ----------
// Hotfix 1 (post-4369349): the original single action button computed its target via
// routeRole(currentRouteKey()) - correct in isolation, but it was reachable from the
// SAME fallback branch a manager-role account with no Checklist grant also renders
// (hasManagementAccess=false at /ql/checklist), sending that account to
// /ql/checklist/ho-so-danh-gia where assessmentProfileHtml() was never reached.
// Hotfix 2 (post-5fcfe4b): business call confirmed "Hồ sơ đánh giá applies to every
// non-Admin account" - a manager with no Checklist grant must ALSO get the personal
// tabs + a working self-view Assessment Profile at /ql/checklist/ho-so-danh-gia (no
// picker, no manager sidebar), not just "no dead end" like hotfix 1 left it. Gating
// must therefore key off routeRole(path) + whether a real Checklist grant is present
// (checklistManagerWorkspaceActive/isChecklistPersonalExperience), never routeRole
// alone - and the personal base path must follow the account's own role namespace
// (/hv for learner, /ql for manager) rather than a hardcoded /hv.
check(/function checklistHasManagementAccess\(\)\{return !!\(roleWorkspaceState\.data&&roleWorkspaceState\.data\.grant\);\}/.test(app),
  'D0. checklistHasManagementAccess() is the single source for "does this account have a real Checklist grant"');
check(/function checklistManagerWorkspaceActive\(path\)\{return routeRole\(path\)==='manager'&&checklistHasManagementAccess\(\);\}/.test(app),
  'D0. checklistManagerWorkspaceActive(path) = routeRole==='+"'manager'"+' AND a real grant - not routeRole alone');
check(/function isChecklistPersonalExperience\(path\)\{if\(routeRole\(path\)==='admin'\)return false;return !checklistManagerWorkspaceActive\(path\);\}/.test(app),
  'D0. isChecklistPersonalExperience(path): learner=true, manager-no-grant=true, manager-with-grant=false, admin=false (matches the confirmed business matrix)');
check(/function checklistPersonalBasePath\(path\)\{return routeRole\(path\)==='manager'\?'\/ql\/checklist':'\/hv\/checklist';\}/.test(app),
  'D0. checklistPersonalBasePath(path) follows the account\'s own role namespace (/ql for manager, /hv for learner) - never rewrites manager to /hv');
// UX-01 Batch 4B: Batch 4A's separate .phfck-personal-nav (light-card CSS that
// never matched the manager sidebar's actual dark/sticky/full-height look, per
// visual QA) is gone. Manager sidebar and personal nav now share ONE item
// renderer (checklistNavItemHtml) and ONE shell renderer (checklistSidebarShellHtml)
// - personal only supplies different config (2 items, no head-scope/foot/admin-link).
// No route/state/loader change - click handler, data-phfck-learner-tab attribute,
// and target paths are byte-identical to before.
check(/function checklistNavItemHtml\(opts\)\{/.test(app), 'D1a. checklistNavItemHtml() shared item renderer exists');
check(/function checklistSidebarShellHtml\(opts\)\{/.test(app), 'D1b. checklistSidebarShellHtml() shared shell renderer exists');
const personalTabsBody = fnBody(app, 'personalChecklistTabsHtml', '\\s*path\\s*');
check(!!personalTabsBody, 'D1. personalChecklistTabsHtml() found');
if (personalTabsBody) {
  check(/var base=checklistPersonalBasePath\(path\)/.test(personalTabsBody),
    'D. Tab bar computes its base path from checklistPersonalBasePath(path) - /hv for a learner session, /ql for a manager-no-grant session');
  check(!/phfck-people-scope-chips|phfck-people-scope-tabs|phfck-personal-nav-list|phfck-personal-nav-icon/.test(personalTabsBody),
    'D. Personal nav reuses neither the old pill-filter classes NOR its own Batch 4A .phfck-personal-nav-list/-icon classes anymore');
  check(/checklistNavItemHtml\(\{active:active==='my-checklist',navAttr:'data-phfck-learner-tab',navValue:base,/.test(personalTabsBody) && /checklistNavItemHtml\(\{active:active==='assessment-profile',navAttr:'data-phfck-learner-tab',navValue:base\+'\/ho-so-danh-gia',/.test(personalTabsBody),
    'D. Both nav items are built via checklistNavItemHtml() - the SAME renderer managerSidebarHtml() uses - with the same literal, precomputed target paths (not recomputed at click time)');
  check(/checklistSidebarShellHtml\(\{/.test(personalTabsBody) && /modifierClass:'phfck-personal-sidebar'/.test(personalTabsBody),
    'D. Personal nav is wrapped via checklistSidebarShellHtml() - the SAME shell renderer managerSidebarHtml() uses - not a separate <aside> markup');
  check(/ariaCurrent:true/.test(personalTabsBody),
    'D. Personal items opt into aria-current="page" via the shared renderer\'s ariaCurrent flag (Part 13 - active state not color-only); manager items don\'t pass it, so manager DOM is unaffected');
  check(/'Bảng điểm hiện tại'/.test(personalTabsBody) && !/'Checklist của tôi'/.test(personalTabsBody),
    'D. Nav item is relabelled "Bảng điểm hiện tại" (was "Checklist của tôi")');
}
// ---------- U. Executable byte-equivalence proof: shared renderer output for
// manager-shaped input must match the exact pre-Batch-4B item()/violationItem()/
// sidebar-assembly template, character for character. This is a REAL execution
// (Node vm sandbox), not a source-pattern guess - the strongest evidence available
// in this project's no-jsdom testing convention that "manager sidebar không đổi".
const vm = require('vm');
function extractFnSource(source, name) {
  const re = new RegExp('function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n  \\}');
  const m = source.match(re);
  return m ? m[0] : null;
}
const navItemSrc = extractFnSource(app, 'checklistNavItemHtml');
const shellSrc = extractFnSource(app, 'checklistSidebarShellHtml');
check(!!navItemSrc, 'U0. checklistNavItemHtml() source extracted for sandbox execution');
check(!!shellSrc, 'U0. checklistSidebarShellHtml() source extracted for sandbox execution');
if (navItemSrc && shellSrc) {
  const escSrc = "function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c];});}";
  const sandbox = {};
  vm.createContext(sandbox);
  try {
    vm.runInContext(escSrc + '\n' + navItemSrc + '\n' + shellSrc, sandbox);
    const itemActiveWithBadge = sandbox.checklistNavItemHtml({active: true, navAttr: 'data-phfck-manager-section', navValue: 'people', icon: '♙', label: 'Nhân sự', description: 'Danh sách được xem · Cần thẩm định', badge: 5});
    const expectedItemActiveWithBadge = '<button type="button" class="active" data-phfck-manager-section="people"><span class="phfck-nav-icon" aria-hidden="true">♙</span><span><b>Nhân sự<i class="phfck-nav-badge">5</i></b><small>Danh sách được xem · Cần thẩm định</small></span></button>';
    check(itemActiveWithBadge === expectedItemActiveWithBadge, 'U. checklistNavItemHtml() output for an active, badged manager item is byte-identical to the pre-Batch-4B item() template');

    const itemInactiveNoBadge = sandbox.checklistNavItemHtml({active: false, navAttr: 'data-phfck-manager-violation-view', navValue: 'log', icon: '☷', label: 'Nhật ký lỗi', description: 'Xem, lọc và rà bản ghi trong phạm vi'});
    const expectedItemInactiveNoBadge = '<button type="button" class="" data-phfck-manager-violation-view="log"><span class="phfck-nav-icon" aria-hidden="true">☷</span><span><b>Nhật ký lỗi</b><small>Xem, lọc và rà bản ghi trong phạm vi</small></span></button>';
    check(itemInactiveNoBadge === expectedItemInactiveNoBadge, 'U. checklistNavItemHtml() output for an inactive violationItem() (no badge, no ariaCurrent) is byte-identical to the pre-Batch-4B violationItem() template');

    const itemVisibleFalse = sandbox.checklistNavItemHtml({visible: false, navAttr: 'data-phfck-manager-section', navValue: 'reports', icon: '▥', label: 'Báo cáo', description: 'x'});
    check(itemVisibleFalse === '', 'U. checklistNavItemHtml() still returns \'\' when visible:false (capability-gated items disappear exactly as before)');

    const personalActiveItem = sandbox.checklistNavItemHtml({active: true, navAttr: 'data-phfck-learner-tab', navValue: '/hv/checklist', icon: '▦', label: 'Bảng điểm hiện tại', description: 'Điểm, phiếu và việc cần xử lý', ariaCurrent: true});
    const expectedPersonalActiveItem = '<button type="button" class="active" aria-current="page" data-phfck-learner-tab="/hv/checklist"><span class="phfck-nav-icon" aria-hidden="true">▦</span><span><b>Bảng điểm hiện tại</b><small>Điểm, phiếu và việc cần xử lý</small></span></button>';
    check(personalActiveItem === expectedPersonalActiveItem, 'U. checklistNavItemHtml() correctly adds aria-current="page" ONLY when the caller opts in (personal items) - proves manager (which never opts in) cannot get this attribute added');

    const shellOutput = sandbox.checklistSidebarShellHtml({modifierClass: 'phfck-manager-sidebar', dataAttr: 'data-phfck-manager-sidebar', headHtml: '<div class="phfck-sidebar-head"><small>KHU VỰC QUẢN LÝ</small><strong>Khu Test</strong></div>', navAriaLabel: 'Menu quản lý Checklist', itemsHtml: 'ITEMS', extraHtml: 'EXTRA', footHtml: '<div class="phfck-sidebar-foot phfck-manager-scope-card">FOOT</div>'});
    const expectedShellOutput = '<aside class="phfck-sidebar phfck-manager-sidebar" data-phfck-manager-sidebar><div class="phfck-sidebar-head"><small>KHU VỰC QUẢN LÝ</small><strong>Khu Test</strong></div><nav class="phfck-nav" aria-label="Menu quản lý Checklist">ITEMSEXTRA</nav><div class="phfck-sidebar-foot phfck-manager-scope-card">FOOT</div></aside>';
    check(shellOutput === expectedShellOutput, 'U. checklistSidebarShellHtml() output with manager-shaped config is byte-identical to the pre-Batch-4B manager <aside>...</aside> assembly (same class list, same boolean data-attr syntax, same head/nav/extra/foot order)');

    const personalShellOutput = sandbox.checklistSidebarShellHtml({modifierClass: 'phfck-personal-sidebar', dataAttr: 'data-phfck-personal-sidebar', headHtml: '<div class="phfck-sidebar-head"><small>KHU VỰC CÁ NHÂN</small><strong>Checklist</strong></div>', navAriaLabel: 'Khu vực cá nhân', itemsHtml: 'ITEMS'});
    check(personalShellOutput === '<aside class="phfck-sidebar phfck-personal-sidebar" data-phfck-personal-sidebar><div class="phfck-sidebar-head"><small>KHU VỰC CÁ NHÂN</small><strong>Checklist</strong></div><nav class="phfck-nav" aria-label="Khu vực cá nhân">ITEMS</nav></aside>',
      'U. checklistSidebarShellHtml() with personal config (no extra/foot) omits them cleanly and uses the SAME .phfck-sidebar base class as manager - not a separate container');
  } catch (err) {
    check(false, 'U. Sandbox execution of the extracted renderer functions did not throw: ' + (err && err.message));
  }
}
check(!/Checklist của tôi/.test(app), 'D1b. The literal string "Checklist của tôi" no longer appears anywhere in the file (QA concern: stale title left where it would confuse) - renamed to "Bảng điểm hiện tại" everywhere in scope');
const roleWorkspaceBody = fnBody(app, 'roleWorkspaceContentHtml', '\\s*path\\s*');
check(!!roleWorkspaceBody, 'D2. roleWorkspaceContentHtml() found');
if (roleWorkspaceBody) {
  check(/var isPersonalExperience=isChecklistPersonalExperience\(path\),personalBase=checklistPersonalBasePath\(path\);/.test(roleWorkspaceBody),
    'D. isPersonalExperience/personalBase are computed once via the shared helpers right after the manager-with-grant early return');
  check(/if\(isPersonalExperience\)\{/.test(roleWorkspaceBody),
    'D. Personal-experience branch is now an explicit if-block (learner OR manager-no-grant), not folded into a single ternary-laden return');
  check(/cleanPath\(path\)===personalBase\+'\/ho-so-danh-gia'\)return '<div class="phfck-personal-layout">'\+personalNavHtml\+'<main class="phfck-role-main phfck-personal-screen">'\+assessmentProfileHtml\(path\)\+'<\/main><\/div>';/.test(roleWorkspaceBody),
    'B/G. A manager with no grant at /ql/checklist/ho-so-danh-gia still reaches assessmentProfileHtml() directly, now wrapped in the two-column .phfck-personal-layout shell alongside the nav');
  check(/return '<div class="phfck-personal-layout">'\+personalNavHtml\+'<main class="phfck-role-main phfck-personal-screen"><section class="phfck-role-heading">/.test(roleWorkspaceBody),
    'D. The base personal-Checklist (renamed "Bảng điểm hiện tại") page is also wrapped with the nav in the same two-column shell for both learner and manager-no-grant');
  check((roleWorkspaceBody.match(/personalNavHtml/g) || []).length >= 2,
    'D. personalChecklistTabsHtml(path) is computed once (personalNavHtml) and reused for both personal-experience pages, not recomputed per branch');
}
check(/isManager=checklistManagerWorkspaceActive\(currentRouteKey\(\)\)/.test(app),
  'B. loadAssessmentProfile() derives isManager from checklistManagerWorkspaceActive(), not a bare routeRole check - a manager-no-grant account can never trigger the manager-only payload/picker branches');
check(/isManager=checklistManagerWorkspaceActive\(path\)/.test(app),
  'B. assessmentProfileHtml() derives its isManager framing (kicker text, "← Tổng quan" button) the same way - a manager-no-grant account gets the NHÂN VIÊN framing, not a "← Tổng quan" button pointing at a workspace they don\'t have');
check(!/data-phfck-open-assessment-profile/.test(app), 'D3. The old single action button/handler (root cause of hotfix 1\'s ambiguous mount) is fully removed, not just unused');
check(!/data-phfck-assessment-profile-back/.test(app), 'D4. The old redundant "back to Checklist của tôi" button/handler is removed (superseded by the tab bar)');
const learnerTabHandlerMatch = app.match(/var learnerTab=e\.target\.closest\('\[data-phfck-learner-tab\]'\);\s*\n\s*if\(learnerTab\)\{([^}]*)\}/);
check(!!learnerTabHandlerMatch, 'D5. data-phfck-learner-tab click handler found');
if (learnerTabHandlerMatch) {
  check(/learnerTab\.getAttribute\('data-phfck-learner-tab'\)/.test(learnerTabHandlerMatch[1]),
    'D. Tab click handler navigates using the button\'s own literal path attribute, not a recomputed routeRole()-based guess');
  check(/window\.phfNavigate\(learnerTabTarget\)/.test(learnerTabHandlerMatch[1]),
    'D. Tab click handler uses window.phfNavigate() (the real router), not a local pushState+render shortcut');
}
check(/item\('assessment-profile','🗎','Hồ sơ đánh giá','Tiêu chuẩn, điểm và lịch sử theo kỳ',grant\.capabilities&&grant\.capabilities\.view_monthly===true\)/.test(app),
  'E. managerSidebarHtml() renders the "Hồ sơ đánh giá" item gated on grant.capabilities.view_monthly (backend still re-checks)');
// Caught during this hotfix's own QA pass: naively simplifying title() to a single
// isChecklistPersonalExperience branch silently dropped the "Hồ sơ đánh giá · Quản lý"
// tab title for a manager WITH a real grant, because managerSectionFromLocation(path)
// matches 'assessment-profile' purely from the path string regardless of grant status.
// The manager-with-grant case must be checked (via checklistManagerWorkspaceActive)
// BEFORE the personal-experience branch, not folded into it.
const titleBody = fnBody(app, 'title', '\\s*path\\s*');
check(!!titleBody, 'D6. title() found');
if (titleBody) {
  check(/checklistManagerWorkspaceActive\(path\)&&managerSectionFromLocation\(path\)==='assessment-profile'\)return 'Hồ sơ đánh giá · Quản lý';/.test(titleBody),
    'D. title() keeps a dedicated "Hồ sơ đánh giá · Quản lý" case for a manager WITH a real grant, checked before the shared personal-experience branch');
}
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
// UX-01 Batch 4A: standalone "Kỳ xem" toolbar card (previously a full-width panel
// holding just one month input) removed - period input + target picker now render
// inside assessmentProfileIdentityHtml()'s panel-head, per the polish spec's
// "ghép vào card thông tin nhân sự" option. Same input, same data-phfck-assessment-profile-period
// attribute, same change handler - only the wrapping markup moved.
check(!/function assessmentProfilePeriodBarHtml/.test(app), 'G0. The standalone assessmentProfilePeriodBarHtml() toolbar function is removed (period/target controls merged into the identity card)');
const identityBody = fnBody(app, 'assessmentProfileIdentityHtml', '\\s*data,isManager\\s*');
check(!!identityBody, 'G0b. assessmentProfileIdentityHtml() found');
if (identityBody) {
  check(/data-phfck-assessment-profile-period/.test(identityBody), 'G. Period <input type="month"> now renders inside the identity card header (same data-phfck-assessment-profile-period attribute, unchanged)');
  check(/\(isManager\?assessmentProfileTargetPickerHtml\(data\):''\)/.test(identityBody),
    'G. Target picker is only rendered when isManager is true - learner/manager-no-grant branch never mounts it');
}
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
// Manager-WITH-grant pipeline must be byte-identical to before this UI-polish batch -
// it never touches managerSidebarHtml/managerSectionContentHtml/.phfck-manager-layout.
check(/if\(hasManagementAccess&&routeRole\(path\)==='manager'\)return '<div class="phfck-manager-layout">'\+\(isMobileWorkspace\(\)\?'':managerSidebarHtml\(data\)\)\+'<main class="phfck-role-main phfck-manager-screen" data-phfck-manager-content>'\+managerSectionContentHtml\(path,data\)\+'<\/main><\/div>';/.test(app),
  'C. Manager-with-grant early return in roleWorkspaceContentHtml() is untouched - still the very first check, still renders managerSidebarHtml() unchanged');

// ---------- T. UI-polish specific: empty state, and CSS isolation ----------
const scoreHtmlBodyForEmpty = fnBody(app, 'assessmentProfileScoreHtml', '\\s*currentScore\\s*');
check(/function assessmentProfileEmptyHtml\(icon,titleText,text\)\{/.test(app), 'T0. assessmentProfileEmptyHtml() compact icon empty-state helper exists');
if (scoreHtmlBodyForEmpty) {
  check(/status==='not_started'\)body=assessmentProfileEmptyHtml\(/.test(scoreHtmlBodyForEmpty), 'T. not_started uses the compact icon empty state (Part 8: "không để khoảng trắng lớn")');
  check(/else body=assessmentProfileEmptyHtml\(/.test(scoreHtmlBodyForEmpty), 'T. none/default status also uses the compact icon empty state');
  check(!/phfck-permission-empty/.test(scoreHtmlBodyForEmpty), 'T. Score empty states no longer reuse the shared .phfck-permission-empty class (kept isolated from Nhân sự/Phân quyền styling)');
}
// ---------- V. UX-01 Batch 4B - shared sidebar CSS, dead Batch 4A CSS removed ----------
// CSS isolation: the shared item/shell renderer must not redefine widely-used
// selectors also relied on by other modules - it EXTENDS existing manager rules
// (adding .phfck-personal-layout/.phfck-personal-sidebar to the same selector
// list) rather than duplicating their declarations a second time.
// .phfck-nav{...} and .phfck-people-scope-chips{...} both pre-date this batch
// with their own pre-existing occurrence counts (base rule + scoped overrides
// elsewhere in the file) - personal now DELIBERATELY reuses .phfck-nav (that is
// the whole point of Batch 4B), so the requirement is simply that no NEW,
// separate .phfck-nav{...} declaration block was added - the class is consumed,
// not redefined.
// Bare top-level ".phfck-nav{...}" definitions only (not compound descendant
// selectors like ".phfck-personal-sidebar .phfck-nav{...}", which are legitimate
// scoped overrides, not redefinitions of the base rule).
const bareNavBraceCount = (css.match(/(?:^|[};])\s*\.phfck-nav\{/g) || []).length;
const chipsBraceCount = (css.match(/\.phfck-people-scope-chips\{/g) || []).length;
check(bareNavBraceCount === 2, 'V. Bare .phfck-nav{...} base-rule definitions unchanged from before this batch (2) - personal nav consumes the existing rule via a scoped compound selector, does not redefine the base rule itself');
check(chipsBraceCount === 3, 'V. .phfck-people-scope-chips{...} occurrence count unchanged (3) - not touched by this batch either');
check(!/\.phfck-personal-nav\{|\.phfck-personal-nav-list\{|\.phfck-personal-nav-icon\{/.test(css),
  'V. Batch 4A\'s separate .phfck-personal-nav/-list/-icon rules are fully deleted, not left as dead CSS (Part 7)');
check(!/\.phfck-personal-nav-list|\.phfck-personal-nav-icon/.test(app),
  'V. No JS markup references the old .phfck-personal-nav-list/-icon classes anymore');
check(/\.phfck-manager-layout,\.phfck-personal-layout\{display:grid;grid-template-columns:260px minmax\(0,1fr\);min-height:calc\(100vh - 104px\);align-items:start;background:transparent\}/.test(css),
  'V. .phfck-personal-layout is merged into the SAME grid rule as .phfck-manager-layout (one declaration block, two selectors) - not a cloned rule with identical CSS (Part 5 explicitly forbids that)');
check(/\.phfck-manager-layout>\.phfck-role-main,\.phfck-personal-layout>\.phfck-role-main\{width:auto;max-width:none;margin:0;padding:28px 30px 48px;min-width:0\}/.test(css),
  'V. The role-main width/margin reset (fixes the width:min(1420px,...)+margin:0 auto conflict) is shared via the same merged selector, not duplicated with different values');
check(/@media\(max-width:1100px\)\{\.phfck-manager-layout,\.phfck-personal-layout\{grid-template-columns:220px minmax\(0,1fr\)\}/.test(css),
  'V. The 1100px breakpoint column-width override is shared between manager and personal (same 220px, not a separate personal value)');
check(/\.phfck-manager-sidebar,\.phfck-personal-sidebar\{position:static;height:auto\}/.test(css),
  'V. Mobile position:static override is shared between manager and personal sidebars (personal sidebar cannot end up sticky and cover footer content on mobile)');
check(/\.phfck-manager-sidebar\{z-index:4\}/.test(css) && !/\.phfck-personal-sidebar\{z-index/.test(css),
  'V. Manager\'s z-index:4 modifier is untouched and NOT applied to personal (manager keeps its own distinct modifier, proving the merge only shares what both need)');
check(!/\.phfck-learner-tabs\.phfck-people-scope-chips/.test(css), 'V. Dead .phfck-learner-tabs.phfck-people-scope-chips rule (Batch 4A pill-tab look) removed, not left as unused CSS');
check(!/\.phfck-assessment-profile-toolbar\{/.test(css), 'V. Dead .phfck-assessment-profile-toolbar rule (near-empty full-width "Kỳ xem" card) removed after the control moved into the identity card');
check(/\.phfck-personal-sidebar \.phfck-nav\{flex-direction:row/.test(css),
  'V. Mobile-only override converts the personal nav to a horizontal row (Part 6 mobileMode) - scoped to .phfck-personal-sidebar .phfck-nav so manager (JS-hidden on mobile anyway) is unaffected');

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL PASS'));
process.exit(failures ? 1 : 0);
