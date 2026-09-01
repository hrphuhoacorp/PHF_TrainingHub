'use strict';

/*
 * PHF Task — "Nhân sự & phân quyền" SIMPLIFY (Step 2, 2026-08-31).
 *
 * jsdom, NO network, NO real DB. Same harness pattern as
 * scripts/test-task-permission-hardening-ui-v1.js — evals the runtime bundle
 * source in a window with __PHF_TASK_TEST_MODE__ and asserts the rendered
 * DOM of the simplified screen.
 *
 * Proves:
 *   - default table = exactly the 6 simplified columns; the 4 capability
 *     columns + "Nguồn quyền" + "Mapping Checklist" are NOT in the default
 *     table head.
 *   - the technical info is still reachable (per-row "Chi tiết kỹ thuật"
 *     disclosure renders preset source / caps / checklist / grants).
 *   - default filter bar = Vai trò Task / Phòng ban / Trạng thái / Tìm kiếm;
 *     account-status / Nguồn quyền / Mapping Checklist only appear after the
 *     "Bộ lọc nâng cao" disclosure is opened — no filtering capability lost.
 *   - "Điều chỉnh quyền" editor: identity + Vai trò Task selector + READ-ONLY
 *     "Phạm vi phụ trách" preview + reason + save; Extend/grant UI is under
 *     "Ngoại lệ nâng cao". The base-preset scope preview stays read-only (no
 *     inline control that rewrites the preset's derived scope). Additional
 *     Task DEPARTMENT scope has its own dedicated "Phạm vi bổ sung trong Task"
 *     section (module-only; never changes the People Master department or the
 *     base preset) — MODULE-LEVEL DEPARTMENT SCOPE V1, 2026-09-01.
 *   - default NHAN_VIEN: a person with task_preset_source='default' still
 *     renders (no explicit assignment required) and the preset selector
 *     offers "Nhân viên" to return an elevated person to default.
 *
 *   node scripts/test-task-people-permissions-simplify-v1.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const TASK_APP_SRC = fs.readFileSync(path.join(ROOT, 'assets/js/task/phf-task-app.js'), 'utf8');
let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; console.log('  PASS  ' + message); }

function newWindow() {
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/admin/task/nhan-su' });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = function () { return 'admin'; };
  window.phfGetCurrentUser = function () { return { fullName: 'Demo QA', employeeCode: 'DEMO_QA' }; };
  window.phfNavigate = function () {};
  window.phfToast = function () {};
  window.fetch = function () { throw new Error('unstubbed fetch() call'); };
  window.eval(TASK_APP_SRC);
  return window;
}

function person(overrides) {
  return Object.assign({
    employee_code: 'PHF999', full_name: 'Nguyễn Văn Nhân', department: 'Bộ phận bán hàng',
    title: 'Nhân viên bán hàng', position: '', branch: 'Lái Thiêu', manager_employee_code: 'PHF010',
    employment_status: 'active', employment_status_label: 'Đang làm',
    has_account: true, account_status: 'active', account_status_label: 'Đang hoạt động',
    task_actor_type: 'nhan_vien', task_preset_code: 'NHAN_VIEN', task_preset_source: 'default',
    task_role_label: 'Nhân viên', task_assignment: null,
    base_scope_type: 'self', base_scope_label: 'Bản thân',
    base_capabilities: { view: true, assign: true, update: true, manage: false },
    effective_scope_type: 'self', effective_scope_label: 'Bản thân',
    capabilities: { view: true, assign: true, update: true, manage: false },
    has_active_grant: false, active_grant_count: 0, active_grants: [],
    can_receive_new_tasks: true,
    checklist_mapping_status: 'chua_gan', checklist_mapping_status_label: 'Chưa gán',
    checklist_role_label: '', checklist_proposed_preset: '', checklist_mapping_note: '',
    permission_adjustment: { can_create_extend: true, supported_scope_types: ['employees', 'all_company'], can_set_base_preset: true }
  }, overrides || {});
}

(async () => {
  const window = newWindow();
  const T = window.__PHF_TASK_TEST__;
  const state = T.getState();

  // ---- table: exactly the 6 simplified columns ----
  {
    const people = [person(), person({ employee_code: 'PHF010', full_name: 'Đặng Thị Diễm', task_actor_type: 'truong_ca', task_preset_code: 'TRUONG_CA', task_preset_source: 'assignment', task_role_label: 'Trưởng ca', effective_scope_label: 'Nhóm nhân sự quản lý (4)', base_scope_label: 'Nhóm nhân sự quản lý (4)' })];
    const html = T.adminPeopleTableHtml(people);
    const headMatch = html.match(/<thead>[\s\S]*?<\/thead>/)[0];
    const ths = (headMatch.match(/<th>[^<]*<\/th>/g) || []).map(s => s.replace(/<\/?th>/g, ''));
    pass(JSON.stringify(ths) === JSON.stringify(['Nhân sự', 'Phòng ban / Chức danh', 'Trạng thái', 'Vai trò Task', 'Phạm vi phụ trách', 'Thao tác']), 'default table head = exactly the 6 simplified columns: ' + JSON.stringify(ths));
    pass(!/<th>Xem<\/th>|<th>Giao việc<\/th>|<th>Cập nhật<\/th>|<th>Quản trị<\/th>/.test(headMatch), 'no capability columns (Xem/Giao việc/Cập nhật/Quản trị) in default table head');
    pass(headMatch.indexOf('Mapping Checklist') === -1 && headMatch.indexOf('Nguồn quyền') === -1, 'no "Mapping Checklist" / "Nguồn quyền" column in default table head');
    pass(html.indexOf('Đặng Thị Diễm') !== -1 && html.indexOf('Nhóm nhân sự quản lý (4)') !== -1, 'row shows Vai trò Task + engine-derived Phạm vi phụ trách');
    pass(html.indexOf('data-task-permission-open="PHF999"') !== -1, 'row has "Điều chỉnh" action for a person who can be edited');
    pass(html.indexOf('data-task-people-detail-toggle="PHF999"') !== -1, 'row has "Chi tiết kỹ thuật" per-row disclosure toggle');
  }

  // ---- per-row technical detail still available ----
  {
    state.peopleDetailOpen = { PHF999: true };
    const html = T.adminPeopleTableHtml([person({ has_active_grant: true, active_grant_count: 1, active_grants: [{ id: 'g1', grant_type: 'extend', people_scope: { type: 'employees', values: ['PHF001'] }, people_scope_label: 'Nhóm nhân sự quản lý (1)', capabilities: {}, reason: 'x', is_active: true, can_revoke: true }] })]);
    pass(html.indexOf('phft-people-detail-row') !== -1, 'expanded row renders the technical detail sub-row');
    pass(html.indexOf('Nguồn quyền') !== -1 && html.indexOf('Mapping Checklist') !== -1, 'detail sub-row surfaces "Nguồn quyền" + "Mapping Checklist" (moved, not deleted)');
    pass(/Xem\s*✓|Giao việc\s*✓|Cập nhật\s*✓|Quản trị/.test(html), 'detail sub-row surfaces effective view/assign/update/manage capability');
    pass(html.indexOf('Ngoại lệ đang hiệu lực') !== -1, 'detail sub-row surfaces exception grants');
    state.peopleDetailOpen = {};
  }

  // ---- filters: default 4, technical behind "Bộ lọc nâng cao" ----
  {
    state.peopleAdvancedOpen = false;
    const collapsed = T.adminPeopleFiltersHtml([person()]);
    for (const f of ['role', 'department', 'employmentStatus', 'search']) {
      pass(collapsed.indexOf('data-task-people-filter="' + f + '"') !== -1, 'default filter present: ' + f);
    }
    pass(collapsed.indexOf('data-task-people-filter="accountStatus"') === -1 && collapsed.indexOf('data-task-people-filter="permissionSource"') === -1 && collapsed.indexOf('data-task-people-filter="checklistStatus"') === -1, 'technical filters (accountStatus/permissionSource/checklistStatus) NOT in the default filter bar');
    pass(collapsed.indexOf('data-task-people-advanced-toggle') !== -1, '"Bộ lọc nâng cao" disclosure toggle present');

    state.peopleAdvancedOpen = true;
    const expanded = T.adminPeopleFiltersHtml([person()]);
    for (const f of ['accountStatus', 'permissionSource', 'checklistStatus']) {
      pass(expanded.indexOf('data-task-people-filter="' + f + '"') !== -1, 'advanced filter available after opening disclosure: ' + f);
    }
    state.peopleAdvancedOpen = false;
    // no filtering capability lost — filterAdminPeople still honours every field
    const rows = [person({ employee_code: 'A', account_status: 'locked' }), person({ employee_code: 'B', account_status: 'active' })];
    pass(T.filterAdminPeople(rows, Object.assign(T.defaultPeopleFilters(), { accountStatus: 'locked' })).length === 1, 'account-status filtering still works even though the control is behind "nâng cao"');
  }

  // ---- editor: identity + role selector + read-only scope preview + reason ----
  {
    state.adminPeople = { people: [person({ employee_code: 'PHF010', full_name: 'Đặng Thị Diễm', task_preset_code: 'TRUONG_CA', task_actor_type: 'truong_ca', task_role_label: 'Trưởng ca', effective_scope_label: 'Nhóm nhân sự quản lý (4)' })] };
    state.permissionEditor = { employeeCode: 'PHF010', basePresetCode: 'TRUONG_CA', scopeType: 'employees', employeeCodes: [], reason: '', advancedOpen: false, techOpen: false };
    const html = T.taskPermissionEditorHtml();
    pass(html.indexOf('phft-permission-identity') !== -1 && html.indexOf('Đặng Thị Diễm') !== -1, 'editor A: Nhân sự identity block');
    pass(html.indexOf('data-task-base-preset') !== -1 && html.indexOf('>Trưởng ca<') !== -1 && html.indexOf('>Nhân viên<') !== -1, 'editor B: Vai trò Task selector with the 5 presets incl "Nhân viên"');
    pass(html.indexOf('phft-permission-scope-preview') !== -1 && html.indexOf('Nhóm nhân sự quản lý (4)') !== -1, 'editor C: read-only "Phạm vi phụ trách" preview shows engine-derived scope');
    pass(html.indexOf('sơ đồ quản lý trực tiếp trong People Master') !== -1, 'editor C: scope hint explains Trưởng ca scope = manager graph');
    pass(html.indexOf('Trưởng ca + chọn phòng ban') === -1 && !/data-task-permission-departments/.test(html.split('phft-permission-scope-preview')[1].split('phft-dept-scope')[0]), 'editor: the read-only "Phạm vi phụ trách" preview has no inline control that rewrites the preset scope');
    pass(html.indexOf('Phạm vi bổ sung trong Task') !== -1 && html.indexOf('không thay đổi phòng ban nhân sự gốc') !== -1, 'editor: additional Task department scope lives in its own dedicated, clearly-labelled section (MODULE-LEVEL DEPARTMENT SCOPE V1)');
    pass(html.indexOf('data-task-permission-reason') !== -1, 'editor D: mandatory reason textarea retained');
    pass(html.indexOf('data-task-base-preset-save') !== -1, 'editor E: "Lưu vai trò" save action');
    pass(html.indexOf('data-task-permission-adv-toggle') !== -1 && html.indexOf('Ngoại lệ nâng cao') !== -1, 'editor: Extend/grant UI is behind "Ngoại lệ nâng cao"');
    pass(html.indexOf('data-task-permission-scope-type') === -1, 'editor: Extend scope-type control is hidden until "Ngoại lệ nâng cao" is opened');

    state.permissionEditor.advancedOpen = true;
    const opened = T.taskPermissionEditorHtml();
    pass(opened.indexOf('data-task-permission-scope-type') !== -1 && opened.indexOf('data-task-permission-save') !== -1, 'editor: opening "Ngoại lệ nâng cao" reveals the existing Extend controls (unchanged hooks)');
    state.permissionEditor.techOpen = true;
    const tech = T.taskPermissionEditorHtml();
    pass(tech.indexOf('Quyền nền') !== -1 && tech.indexOf('Quyền hiệu lực') !== -1, 'editor: "Chi tiết kỹ thuật" shows base vs effective capability');
  }

  // ---- default NHAN_VIEN: no explicit row required to render ----
  {
    const html = T.adminPeopleTableHtml([person({ task_preset_source: 'default' })]);
    pass(html.indexOf('Nguyễn Văn Nhân') !== -1 && html.indexOf('Mặc định') !== -1, 'a person with NO explicit assignment (task_preset_source=default) still renders as "Nhân viên · Mặc định"');
    pass(T.taskPresetScopeHint('NHAN_VIEN').indexOf('Bản thân') === 0, 'scope hint for Nhân viên = "Bản thân"');
    pass(T.taskPresetScopeHint('GIAM_DOC').indexOf('Toàn công ty') === 0 && T.taskPresetScopeHint('TRO_LY_GD').indexOf('Toàn công ty') === 0, 'scope hint for GĐ / Trợ lý GĐ = "Toàn công ty"');
  }

  // ---- breadcrumb + checklist warning wording preserved (regression) ----
  {
    state.adminPeople = { people: [person()], summary: { total: 1, active: 1, inactive: 0, with_account: 1 }, checklistReferenceReady: false, permissionSchemaReady: true };
    state.adminPeopleLoading = false; state.adminPeopleError = '';
    const html = T.adminPeopleHtml();
    pass(html.indexOf('PHF TASK / NHÂN SỰ &amp; PHÂN QUYỀN') !== -1, 'breadcrumb unchanged (acceptance regression)');
    pass(html.indexOf('Gợi ý ánh xạ từ Checklist') !== -1, 'checklist warning wording unchanged (acceptance regression)');
  }

  console.log('\nALL ' + passed + ' ASSERTIONS PASSED');
})().catch(err => { console.error(err); process.exit(1); });
