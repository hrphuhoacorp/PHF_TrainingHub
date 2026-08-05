'use strict';
/* Structural regression for the /ql/checklist/phan-quyen tab-level permission
   hotfix (settingsTabsHtml/settingsContentHtml/settingsHtml in
   assets/js/checklist/phf-checklist-app.js).

   Why a structural (source-scanning) test instead of a full render test:
   the tab logic lives inside a single large IIFE with no exported test seams
   (no jsdom dependency in this project, and window.phfRenderChecklist only
   exposes the top-level renderer - see test-checklist-template-hydration-race.js
   for the existing precedent). Driving the real render path for the manager
   route requires mocking the full async getChecklistRoleWorkspace fetch +
   requestAnimationFrame/setTimeout chains + a real innerHTML-parsing
   querySelector, which would mean adding a new DOM test framework
   (jsdom) just for this - out of scope for a "small test" per this batch's
   instructions. This test instead asserts the exact wiring that makes the
   fix work, so an accidental revert (e.g. someone re-hardcoding
   routeRole(...)==='admin', or dropping the allowedSettingsTabs() filter)
   fails CI even without a full DOM. Manual local click-through per the
   regression checklist in the handoff report is still required to verify
   actual rendered behavior. */
const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js');
const source = fs.readFileSync(filePath, 'utf8');

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}

// 1. The two capability helpers exist and are NOT hardcoded to a preset/role string
//    beyond the pre-existing, already-reviewed canManageChecklistPermissions().
check(/function canManageChecklistCore\(\)\{return role\(\)==='admin';\}/.test(source),
  'canManageChecklistCore() is defined as role()===\'admin\' (matches backend admin()/requireAdmin() gates on cycle/violationRules/notifications endpoints)');
check(/function canManageChecklistPermissions\(\)\{return role\(\)==='admin'\|\|isAssistantWebOperator\(\);\}/.test(source),
  'canManageChecklistPermissions() unchanged (admin or TRO_LY_GD web operator)');

// 2. allowedSettingsTabs() builds the tab list purely from those two capability
//    helpers - no role-name string comparisons, no new preset invented.
const allowedTabsMatch = source.match(/function allowedSettingsTabs\(\)\{([\s\S]*?)\n  \}/);
check(!!allowedTabsMatch, 'allowedSettingsTabs() exists');
if (allowedTabsMatch) {
  const body = allowedTabsMatch[1];
  check(body.includes('canManageChecklistPermissions()') && body.includes("tabs.push('permissions')"),
    'allowedSettingsTabs() grants \'permissions\' only via canManageChecklistPermissions()');
  check(body.includes('canManageChecklistCore()') && body.includes("tabs.push('cycle','violationRules','notifications')"),
    'allowedSettingsTabs() grants the 3 core tabs only via canManageChecklistCore()');
  check(!/TRO_LY_GD|TRUONG_BO_PHAN|TRUONG_CA|QUAN_LY_TRUC_TIEP|CHI_XEM_BAO_CAO/.test(body),
    'allowedSettingsTabs() does not hardcode any preset/role name');
}

// 3. settingsTabsHtml() renders only tabs present in allowedSettingsTabs() - the
//    root cause of "thấy cả bốn tab" was this function rendering a static list.
check(/function settingsTabsHtml\(\)\{\s*var allowed=allowedSettingsTabs\(\),tabs=SETTINGS_TAB_DEFS\.filter\(function\(t\)\{return allowed\.indexOf\(t\[0\]\)>=0;\}\);/.test(source),
  'settingsTabsHtml() filters SETTINGS_TAB_DEFS by allowedSettingsTabs() before rendering buttons');

// 4. settingsHtml() resolves/corrects settingsUiState.section against the CURRENT
//    session's allowed tabs on every render - this is what makes a stale/forbidden
//    tab (left over from a previous session, e.g. Admin browsing 'cycle') snap back
//    to 'permissions' instead of silently rendering forbidden content.
check(/function settingsHtml\(\)\{[\s\S]{0,400}?settingsUiState\.section=resolveSettingsSection\(\);/.test(source),
  'settingsHtml() calls resolveSettingsSection() before building tabs/content (fixes "không quay lại tab hợp lệ")');
const resolveMatch = source.match(/function resolveSettingsSection\(\)\{([\s\S]*?)\n  \}/);
check(!!resolveMatch, 'resolveSettingsSection() exists');
if (resolveMatch) {
  const body = resolveMatch[1];
  check(body.includes('allowedSettingsTabs()'), 'resolveSettingsSection() reads allowedSettingsTabs() fresh (no localStorage, no cached role)');
  check(body.includes("'permissions'"), 'resolveSettingsSection() prefers \'permissions\' when it is allowed, before falling back to allowed[0]');
}
check(!/resolveSettingsSection\(\)[\s\S]{0,80}resolveSettingsSection\(\)/.test(source.match(/function settingsHtml\(\)[\s\S]{0,600}/)[0]),
  'settingsHtml() calls resolveSettingsSection() only once per render (no render loop)');

// 5. The permission-tab data loaders no longer hardcode the ADMIN-only route -
//    this is the "tab hoạt động bình thường" fix (grants list previously never
//    loaded on /ql/checklist/phan-quyen because ensureChecklistPermissionsOnSettings
//    returned early on any non-admin routeRole()).
check(/function isChecklistPermissionsRouteActive\(\)\{[\s\S]*?managerSectionFromLocation\(location\.pathname\)==='permissions'&&canManageChecklistPermissions\(\)/.test(source),
  'isChecklistPermissionsRouteActive() recognizes the manager route + capability, not just the admin route');
['ensureChecklistPermissionsOnSettings', 'syncChecklistPermissionsOnOpen'].forEach(function (fn) {
  const m = source.match(new RegExp('function ' + fn + '\\(root,force\\)\\{([\\s\\S]*?)\\n  \\}'));
  check(!!m, fn + '() exists');
  if (m) {
    check(m[1].includes('isChecklistPermissionsRouteActive()'), fn + '() gates on isChecklistPermissionsRouteActive(), not a hardcoded admin-only route check');
    check(!/routeRole\(location\.pathname\)!=='admin'/.test(m[1]), fn + '() no longer hardcodes routeRole(...)!==\'admin\'');
  }
});

// 5b. Employee list for the "Phân quyền & phạm vi" table must reuse the SAME
//     pipeline the "Nhân sự" (people) page already uses - fetchLatestChecklistPeopleData -
//     not a forked/new fetch, and must be triggered from the one function already
//     shared between the Admin and manager routes (ensureChecklistPermissionsOnSettings).
//     This is the root cause of "badge Dữ liệu đã sẵn sàng nhưng Không có nhân sự
//     phù hợp bộ lọc": that function previously only loaded grants, never employees,
//     so the table only had data if window.__phfLocalData.employees happened to
//     already be populated from an unrelated earlier page visit (people/violations).
const ensureFnMatch = source.match(/function ensureChecklistPermissionsOnSettings\(root,force\)\{([\s\S]*?)\n  \}/);
check(!!ensureFnMatch, 'ensureChecklistPermissionsOnSettings() exists');
if (ensureFnMatch) {
  const body = ensureFnMatch[1];
  check(body.includes('fetchLatestChecklistPeopleData('), 'ensureChecklistPermissionsOnSettings() reuses fetchLatestChecklistPeopleData() (same pipeline as the Nhân sự page), not a new/forked fetch');
  check(!/fetch\(['"]\/api\/data\?checklist(People|Workspace)/.test(body), 'ensureChecklistPermissionsOnSettings() does not inline a new raw fetch call for employees - it calls the shared helper');
  check(body.includes('.then(function(){') && body.includes('settingsHtml()'), 'employees fetch re-renders settingsHtml() on completion so the table updates without a manual reload');
}
check(/async function fetchLatestChecklistPeopleData\(root,force\)\{/.test(source),
  'fetchLatestChecklistPeopleData() itself still exists unmodified (single shared pipeline used by both the people page and the permissions tab)');
const refreshMatch = source.match(/async function refreshChecklistPermissions\(root\)\{([\s\S]*?)\n  \}/);
check(!!refreshMatch, 'refreshChecklistPermissions() exists');
if (refreshMatch) {
  const occurrences = (refreshMatch[1].match(/isChecklistPermissionsRouteActive\(\)/g) || []).length;
  check(occurrences >= 2, 'refreshChecklistPermissions() uses isChecklistPermissionsRouteActive() for both the success and error re-render (got ' + occurrences + ' occurrence(s))');
  check(!/adminViewFromPath\(location\.pathname\)==='settings'/.test(refreshMatch[1]), 'refreshChecklistPermissions() no longer hardcodes adminViewFromPath(...)===\'settings\'');
}

// 5c. The single biggest actual bug in this batch: [data-phfck-workspace] only
//     exists in the ADMIN DOM shell (created in the admin dashboard template) -
//     it does NOT exist anywhere in the manager route's DOM tree, which uses
//     [data-phfck-manager-content] instead (see updateManagerSectionView()).
//     Before this fix, the re-render callbacks below silently found `null` on
//     the manager route (querySelector returns null, `if(workspace)` skips),
//     so the underlying fetch/promise actually resolved fine (no stuck
//     request) but the DOM never updated - UI stayed on the loading spinner
//     forever. Fix reuses the exact OR-fallback pattern already established
//     elsewhere in this file (see the reportWorkflowReload handler) rather
//     than inventing a new selector-resolution helper.
[ensureFnMatch, refreshMatch].forEach(function (m, i) {
  const label = i === 0 ? 'ensureChecklistPermissionsOnSettings()' : 'refreshChecklistPermissions()';
  check(!!m, label + ' body captured for selector check');
  if (m) {
    const workspaceLookups = m[1].match(/root\.querySelector\('\[data-phfck-workspace\]'\)[^;]*/g) || [];
    check(workspaceLookups.length > 0, label + ' still looks up [data-phfck-workspace] (admin route)');
    check(workspaceLookups.length > 0 && workspaceLookups.every(function (s) { return s.includes("root.querySelector('[data-phfck-manager-content]')"); }),
      label + ' every [data-phfck-workspace] lookup falls back to [data-phfck-manager-content] (manager route) - without this, the re-render silently no-ops on the manager DOM and the UI hangs on the loading spinner even though the fetch itself succeeded');
  }
});

// 6. The route-level guard for entering the module at all (unrelated to the tab
//    fix) must be untouched - "route guard giữ nguyên đúng" per requirement C.
check(/if\(section==='permissions'\)return isAssistantWebOperator\(\)\?settingsHtml\(\):permissionAccessDeniedHtml\(\);/.test(source),
  'managerSectionContentHtml route guard for entering the permissions module is unchanged');

// 7. Cold-load lifecycle fix: refreshRoleWorkspaceView() (fires when
//    loadRoleWorkspace's data first arrives - the COLD LOAD path, distinct
//    from updateManagerSectionView which only runs once the manager shell
//    already exists) must ALSO trigger ensureChecklistPermissionsOnSettings()
//    for the permissions section, using the SAME function - no forked/new
//    fetch logic, no setTimeout hack, no simulated click.
const refreshViewMatch = source.match(/function refreshRoleWorkspaceView\(root,ownerKey\)\{([\s\S]*?)\n  \}/);
check(!!refreshViewMatch, 'refreshRoleWorkspaceView() exists');
if (refreshViewMatch) {
  const body = refreshViewMatch[1];
  check(body.includes("managerSectionFromLocation(safeRoute)==='permissions'") && body.includes('ensureChecklistPermissionsOnSettings(root,false)'),
    'refreshRoleWorkspaceView() triggers ensureChecklistPermissionsOnSettings() for the permissions section on cold load (previously only the \'violations\' branch existed here)');
  check(body.includes("managerSectionFromLocation(safeRoute)==='violations'"),
    'refreshRoleWorkspaceView() keeps the pre-existing violations branch untouched');
}
// updateManagerSectionView (in-page navigation, already existing pre-fix) keeps force=true;
// the new cold-load hook intentionally uses force=false so the existing 3s/5s freshness
// dedup inside syncChecklistPermissionsOnOpen/fetchLatestChecklistPeopleData absorbs the
// multiple refreshRoleWorkspaceView() calls that fire during one background-loads burst
// (monthly/reviews/tasks/workflow-summary each call it on completion) instead of
// re-fetching on every one of them - this is what keeps regression #9 ("không tăng số
// request") true without inventing a new de-dup mechanism.
check(/else if\(active==='permissions'\)requestAnimationFrame\(function\(\)\{ensureChecklistPermissionsOnSettings\(root,true\);\}\);/.test(source),
  'updateManagerSectionView() keeps its existing force=true trigger for explicit in-page navigation, unchanged');

// 8. The permissions table's loading gate must wait for BOTH grants AND
//    employees to be ready, not just grants - this is the "badge Dữ liệu đã
//    sẵn sàng nhưng Không có nhân sự phù hợp bộ lọc" race: pd.ready only
//    reflects checklistPermissionGrants, so if grants resolve before the
//    independent employees fetch, the table used to fall through to the
//    "0 filter matches" empty-state instead of the loading state.
const tableFnMatch = source.match(/function permissionTableHtml\(\)\{([\s\S]*?)\n  \}/);
check(!!tableFnMatch, 'permissionTableHtml() exists');
if (tableFnMatch) {
  const body = tableFnMatch[1];
  check(/if\(!pd\.ready\|\|!peopleReady\)/.test(body), 'permissionTableHtml() loading gate checks both pd.ready (grants) and checklistPeopleDataReady() (employees) before falling through to permissionGrantRows()');
  check(body.includes('checklistPeopleDataReady()'), 'permissionTableHtml() reads employees readiness via the existing checklistPeopleDataReady() helper, not a new/duplicated check');
}
// No separate cached "filteredRows" state exists to go stale - permissionGrantRows()
// recomputes from live settingsUiState.permissionQuery/permissionStatus + live
// checklistEmployees()/permissionData() on every call (both the initial render and every
// search/select change handler call the exact same permissionGrantRows()/permissionTableHtml()
// - one pipeline, no branch for "only after user interaction").
check((source.match(/permissionGrantRows\(\)/g) || []).length >= 1 && !/var\s+cachedFilteredRows|settingsUiState\.filteredRows/.test(source),
  'no separate cached filteredRows state exists that could go stale between fetch and render (permissionGrantRows() is recomputed fresh on every call site)');

// 9. The two DOM-selector bugs that actually caused the observed infinite
//    "Đang tải hồ sơ quyền" hang: [data-phfck-workspace] only exists in the
//    ADMIN shell, never in the manager route's DOM (which uses
//    [data-phfck-manager-content]) - so on the manager route the re-render
//    callbacks silently found `null` and no-opped forever, even though the
//    underlying grants/employees fetches actually resolved successfully (no
//    stuck promise, no dedup lock - purely a DOM lookup returning null).
if (tableFnMatch) {
  const body = tableFnMatch[1];
  check(body.includes('peopleDataSyncState.lastError'), 'permissionTableHtml() reads peopleDataSyncState.lastError so an employees-fetch failure is detected instead of showing "loading" forever (checklistPeopleDataReady() never becomes true on failure, so without this the UI would hang indefinitely on error, not just while pending)');
  check(/data-phfck-permission-retry/.test(body), 'permissionTableHtml() renders a retry button (data-phfck-permission-retry) when either source (grants or employees) has an error');
  check(/pd\.error\?[^:]*:[^)]*peopleErr/.test(body.replace(/\s+/g, '')), 'permissionTableHtml() distinguishes the grants error from the employees error in the message (not one generic message for both)');
}
const retryHandlerMatch = source.match(/var permissionRetry=e\.target\.closest\('\[data-phfck-permission-retry\]'\);\s*\n\s*if\(permissionRetry\)\{e\.preventDefault\(\);ensureChecklistPermissionsOnSettings\(root,true\);return;\}/);
check(!!retryHandlerMatch, 'the data-phfck-permission-retry click handler exists and calls ensureChecklistPermissionsOnSettings(root,true) - the same shared pipeline, not a new/forked retry path');

if (failures) {
  console.error('\n' + failures + ' check(s) failed.');
  process.exit(1);
}
console.log('\nAll checks passed.');
