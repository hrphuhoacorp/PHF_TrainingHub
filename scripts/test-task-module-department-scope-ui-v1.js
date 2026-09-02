'use strict';
/* PHF Task — MODULE-LEVEL DEPARTMENT SCOPE V1 — permission editor UI (jsdom).
   No backend, no network. Loads assets/js/task/phf-task-app.js in jsdom (same
   harness as scripts/test-task-recurrence-ui-v1.js) and asserts the
   "Phạm vi bổ sung trong Task" section: helper copy, empty state, chips +
   remove, the "+ Thêm phòng ban" picker (own department disabled), payload
   shape, validation, and that it does NOT change the People Master department
   wording. Also: the advanced "Ngoại lệ nâng cao" Extend control no longer
   offers a department option (dedicated section owns it).
   Run: node scripts/test-task-module-department-scope-ui-v1.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'assets', 'js', 'task', 'phf-task-app.js'), 'utf8');
const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/admin/task/nhan-su' });
const { window } = dom;
window.__PHF_TASK_TEST_MODE__ = true;
window.phfGetSessionRole = function () { return 'admin'; };
window.phfGetCurrentUser = function () { return { fullName: 'Admin QA', email: 'admin@test' }; };
window.phfNavigate = function () {};
window.phfToast = function () {};
window.eval(code);
const T = window.__PHF_TASK_TEST__;
assert.ok(T, 'test hook exposed');

let passed = 0;
function pass(cond, msg) { assert.ok(cond, msg); passed += 1; console.log('  ok - ' + msg); }

function personFixture(overrides) {
  return Object.assign({
    employee_code: 'PHF038', full_name: 'Gấm', department: 'Gói quà', primary_department: 'Gói quà',
    title: 'NV Gói quà', position: 'NV Gói quà', branch: '', employment_status: 'active',
    employment_status_label: 'Đang làm', account_status: 'active', account_status_label: 'Đang hoạt động',
    task_preset_code: 'NHAN_VIEN', task_preset_source: 'default', task_role_label: 'Nhân viên',
    base_scope_type: 'self', base_scope_label: 'Bản thân', effective_scope_label: 'Bản thân',
    base_capabilities: { view: true, assign: true, update: true, manage: false },
    capabilities: { view: true, assign: true, update: true, manage: false },
    active_grants: [], has_active_grant: false, active_grant_count: 0,
    additional_task_departments: [], department_scope_grants: [], department_scope_supported: true,
    permission_adjustment: { can_create_extend: true, can_set_base_preset: true, supported_scope_types: ['department', 'employees', 'all_company'] }
  }, overrides || {});
}
function seedPeople(people) {
  T.getState().adminPeople = { people: people, summary: { total: people.length, active: people.length, inactive: 0, with_account: people.length }, permissionSchemaReady: true };
}

/* ---- A. editor renders the dedicated section ------------------------------ */
(function () {
  seedPeople([
    personFixture(),
    personFixture({ employee_code: 'KHO01', full_name: 'Kho A', department: 'Kho', primary_department: 'Kho' }),
    personFixture({ employee_code: 'BH01', full_name: 'Bán hàng A', department: 'Bán hàng', primary_department: 'Bán hàng' })
  ]);
  const st = T.getState();
  st.permissionEditor = { employeeCode: 'PHF038', basePresetCode: 'NHAN_VIEN', scopeType: 'employees', employeeCodes: [], departments: [], reason: '', advancedOpen: false, techOpen: false, deptScopeOpen: false };
  let html = T.taskPermissionEditorHtml();
  pass(/Phạm vi bổ sung trong Task/.test(html), 'A1: editor shows the "Phạm vi bổ sung trong Task" section');
  pass(/Chỉ mở rộng phạm vi trong PHF Task, không thay đổi phòng ban nhân sự gốc\./.test(html), 'A2: helper copy verbatim');
  pass(/Chưa có phạm vi bổ sung\./.test(html), 'A3: empty state when no department grants');
  pass(/Phòng ban nhân sự gốc \(People Master\): Gói quà/.test(html), 'A4: shows the canonical primary department, labelled as People Master truth');
  pass(/data-task-permission-deptscope-toggle/.test(html) && /\+ Thêm phòng ban/.test(html), 'A5: "+ Thêm phòng ban" trigger present');
  pass(!/data-task-permission-departments/.test(html), 'A6: department multi-select hidden until opened');
  // advanced Extend control must NOT offer department
  st.permissionEditor.advancedOpen = true;
  html = T.taskPermissionEditorHtml();
  const advSelect = (html.split('data-task-permission-scope-type')[1] || '').split('</select>')[0];
  pass(!/value="department"/.test(advSelect), 'A7: "Ngoại lệ nâng cao" Extend dropdown has no department option (dedicated section owns it)');
})();

/* ---- B. opened picker: options, own-dept disabled ------------------------- */
(function () {
  const st = T.getState();
  st.permissionEditor.deptScopeOpen = true;
  st.permissionEditor.advancedOpen = false;
  const html = T.taskPermissionEditorHtml();
  pass(/data-task-permission-departments/.test(html), 'B1: multi-select rendered when deptScopeOpen');
  const sel = html.split('data-task-permission-departments')[1].split('</select>')[0];
  pass(/value="Kho"/.test(sel) && /value="Bán hàng"/.test(sel), 'B2: options come from the shared department list (Kho, Bán hàng)');
  pass(/value="Gói quà"[^>]*disabled/.test(sel) && /phòng ban gốc/.test(sel), 'B3: the person\'s own primary department is disabled ("phòng ban gốc")');
  pass(/data-task-permission-deptscope-save/.test(html) && /data-task-permission-deptscope-cancel/.test(html), 'B4: save + cancel actions present');
})();

/* ---- C. chips + remove when grants exist -------------------------------- */
(function () {
  seedPeople([personFixture({
    additional_task_departments: ['Kho', 'Bán hàng'],
    department_scope_grants: [{ id: 'grant-x', grant_type: 'extend', is_active: true, can_revoke: true, people_scope: { type: 'department', values: ['Kho', 'Bán hàng'] }, people_scope_label: 'Theo phòng ban (2)' }]
  })]);
  const st = T.getState();
  st.permissionEditor = { employeeCode: 'PHF038', basePresetCode: 'NHAN_VIEN', scopeType: 'employees', employeeCodes: [], departments: [], reason: '', advancedOpen: false, techOpen: false, deptScopeOpen: false };
  const html = T.taskPermissionEditorHtml();
  pass(/phft-chip">Kho</.test(html) && /phft-chip">Bán hàng</.test(html), 'C1: current department scope rendered as chips');
  pass(/data-task-permission-deptscope-revoke="grant-x"/.test(html), 'C2: remove (revoke) button per grant');
  pass(!/Chưa có phạm vi bổ sung/.test(html), 'C3: empty state gone when a grant exists');
})();

/* ---- D. payload + validation ------------------------------------------- */
(function () {
  const editor = { employeeCode: 'PHF038', departments: ['Kho', ' Bán hàng '], reason: 'điều phối liên phòng ban' };
  const payload = T.buildTaskPermissionDepartmentScopePayload(editor);
  pass(payload.action === 'createTaskPermissionGrant' && payload.grant_type === 'extend', 'D1: payload is a createTaskPermissionGrant / extend');
  pass(payload.people_scope.type === 'department' && JSON.stringify(payload.people_scope.values) === JSON.stringify(['Kho', 'Bán hàng']), 'D2: people_scope.type=department, trimmed values');
  pass(JSON.stringify(payload.capabilities) === '{}', 'D3: no capability change in the payload');
  pass(payload.reason === 'điều phối liên phòng ban', 'D4: reason carried through');
  pass(T.validateTaskPermissionDepartmentScope({ departments: ['Kho'], reason: '' }) !== '', 'D5: reason required');
  pass(T.validateTaskPermissionDepartmentScope({ departments: [], reason: 'x' }) !== '', 'D6: at least one department required');
  pass(T.validateTaskPermissionDepartmentScope({ departments: ['Kho'], reason: 'x' }) === '', 'D7: valid input passes');
})();

/* ---- E. RENDER-RULE GATE — the picker-hidden defect ------------------- */
function editorFor(code, presetCode) {
  T.getState().permissionEditor = { employeeCode: code, basePresetCode: presetCode || 'NHAN_VIEN', scopeType: 'employees', employeeCodes: [], departments: [], reason: '', advancedOpen: false, techOpen: false, deptScopeOpen: false };
}
(function () {
  // E1 — PHF082-equivalent: normal ACTIVE "Nhân viên", base self scope,
  //      People Master dept "Bộ phận Quản trị tổng hợp". Picker MUST show.
  seedPeople([
    personFixture({ employee_code: 'PHF082', full_name: 'Lý Minh Phước', department: 'Bộ phận Quản trị tổng hợp', primary_department: 'Bộ phận Quản trị tổng hợp' }),
    personFixture({ employee_code: 'BH01', full_name: 'Bán hàng A', department: 'Bán hàng', primary_department: 'Bán hàng' }),
    personFixture({ employee_code: 'KHO01', full_name: 'Kho A', department: 'Kho', primary_department: 'Kho' })
  ]);
  editorFor('PHF082');
  let html = T.taskPermissionEditorHtml();
  pass(/Phạm vi bổ sung trong Task/.test(html) && /data-task-permission-deptscope-toggle/.test(html) && /\+ Thêm phòng ban/.test(html), 'E1: PHF082-equivalent (active "Nhân viên", base self) — "+ Thêm phòng ban" IS shown');
  pass(/Phòng ban nhân sự gốc \(People Master\): Bộ phận Quản trị tổng hợp/.test(html), 'E1b: People Master primary department shown read-only, unchanged');
  pass(!/Vai trò nền đã phủ toàn công ty/.test(html) && !/không còn hoạt động/.test(html), 'E1c: the misleading "covers all company / inactive" hint is NOT shown for a normal active employee');
  pass(T.taskPermissionDepartmentScopeEligible({ employment_status: 'active', base_scope_type: 'self' }, {}) === true, 'E1d: eligibility helper — active + base self => eligible');

  // E2 — Trưởng bộ phận / Trưởng ca: base scope 'employees', label
  //      "Nhóm nhân sự quản lý (N)", has managed people. Picker MUST still show
  //      (must NOT be hidden because of the managed graph / label).
  seedPeople([
    personFixture({ employee_code: 'PHF010', full_name: 'Đặng Thị Diễm', department: 'Bán hàng', primary_department: 'Bán hàng',
      task_preset_code: 'TRUONG_CA', task_role_label: 'Trưởng ca', base_scope_type: 'employees',
      base_scope_label: 'Nhóm nhân sự quản lý (4)', effective_scope_label: 'Nhóm nhân sự quản lý (4)', department_scope_supported: true,
      permission_adjustment: { can_create_extend: true, can_set_base_preset: true, supported_scope_types: ['department', 'employees', 'all_company'] } }),
    personFixture({ employee_code: 'KHO01', full_name: 'Kho A', department: 'Kho', primary_department: 'Kho' })
  ]);
  editorFor('PHF010', 'TRUONG_CA');
  html = T.taskPermissionEditorHtml();
  pass(/data-task-permission-deptscope-toggle/.test(html), 'E2: Trưởng ca with managed people + "Nhóm nhân sự quản lý" label — picker still shown (not hidden by effective scope / label)');

  // E3 — genuine all-company base role: picker hidden, honest message.
  seedPeople([personFixture({ employee_code: 'GD01', task_preset_code: 'GIAM_DOC', task_role_label: 'Giám đốc',
    base_scope_type: 'all_company', base_scope_label: 'Toàn công ty', effective_scope_label: 'Toàn công ty', department_scope_supported: false,
    permission_adjustment: { can_create_extend: false, can_set_base_preset: true, supported_scope_types: [] } })]);
  editorFor('GD01', 'GIAM_DOC');
  html = T.taskPermissionEditorHtml();
  pass(/Phạm vi bổ sung trong Task/.test(html) && !/data-task-permission-deptscope-toggle/.test(html), 'E3: genuine all-company base — "+ Thêm phòng ban" hidden');
  pass(/Vai trò nền đã phủ toàn công ty — không cần cấp phạm vi bổ sung\./.test(html), 'E3b: honest all-company hint (not the ambiguous OR-message)');

  // E4 — inactive employee: picker hidden, inactive message.
  seedPeople([personFixture({ employee_code: 'X99', employment_status: 'inactive', employment_status_label: 'Nghỉ việc', department_scope_supported: false })]);
  editorFor('X99');
  html = T.taskPermissionEditorHtml();
  pass(!/data-task-permission-deptscope-toggle/.test(html) && /Nhân sự đã nghỉ việc/.test(html), 'E4: inactive employee — picker hidden with an inactive-specific hint');
  pass(T.taskPermissionDepartmentScopeEligible({ employment_status: 'inactive', base_scope_type: 'self' }, {}) === false, 'E4b: eligibility helper — inactive => not eligible');

  // E5 — DTO predates department_scope_supported (stale backend): fall back to
  //      base_scope_type + can_create_extend, still show for a normal employee.
  const stale = personFixture({ employee_code: 'PHF082' });
  delete stale.department_scope_supported;
  seedPeople([stale, personFixture({ employee_code: 'BH01', department: 'Bán hàng', primary_department: 'Bán hàng' })]);
  editorFor('PHF082');
  html = T.taskPermissionEditorHtml();
  pass(/data-task-permission-deptscope-toggle/.test(html), 'E5: DTO without department_scope_supported — picker still shown via canonical base_scope_type fallback');
})();

/* ---- F. main table surfaces the additional scope ---------------------- */
(function () {
  const html = T.adminPeopleTableHtml([personFixture({ additional_task_departments: ['Kho', 'Bán hàng'] })]);
  pass(/\+ phòng ban Task: Kho, Bán hàng/.test(html), 'F1: "Phạm vi phụ trách" cell notes the additional Task departments');
  const plain = T.adminPeopleTableHtml([personFixture()]);
  pass(!/phòng ban Task:/.test(plain), 'F2: no note when there is no additional scope');
})();

console.log('\nPHF Task MODULE-LEVEL DEPARTMENT SCOPE UI V1: ' + passed + '/' + passed + ' PASS');
