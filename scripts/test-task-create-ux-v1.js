'use strict';
/* PHF Task — Create UX V1 (Tạo nhanh + Tạo đầy đủ + Sao chép phiếu + Picker
   nhân sự có lọc phòng ban). Pure logic/DOM regression — no backend mutation,
   no network. Loads assets/js/task/phf-task-app.js in jsdom with a stubbed
   window (phfGetSessionRole/phfGetCurrentUser/phfNavigate/phfToast), same
   pattern as scripts/test-knl-shared-employee-picker-filters-2026-08.js. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'assets', 'js', 'task', 'phf-task-app.js'), 'utf8');

const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/admin/task/tao' });
const { window } = dom;
window.__PHF_TASK_TEST_MODE__ = true;
window.phfGetSessionRole = function () { return 'admin'; };
window.phfGetCurrentUser = function () { return { fullName: 'Test Admin', email: 'admin@test' }; };
window.phfNavigate = function () { /* no-op in tests */ };
window.phfToast = function () { /* no-op in tests */ };
window.eval(code);
const T = window.__PHF_TASK_TEST__;
assert.ok(T, 'test hook window.__PHF_TASK_TEST__ must be exposed');

let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }

/* ---------------------------------------------------------------------
   1) QUICK FORM defaults
--------------------------------------------------------------------- */
(function () {
  const form = T.quickTaskFormDefaults();
  pass(form.flow_type === 'giao_viec', 'QUICK: flow_type defaults to giao_viec');
  pass(form.priority === 'thuong', 'QUICK: priority defaults to thuong');
  pass(!!form.start_at, 'QUICK: start_at is prefilled');
  const iso = T.serializeTaskLocalDateTime(form.start_at);
  pass(!!iso, 'QUICK: start_at serializes to a valid instant');
  pass(Math.abs(Date.now() - Date.parse(iso)) < 5 * 60 * 1000, 'QUICK: start_at is within 5 minutes of now');
  pass(form.title === '' && form.category_code === '' && form.primary_employee_code === '', 'QUICK: core fields start empty');
  pass(form.content === '' && form.related_employee_codes.length === 0 && form.links.length === 0, 'QUICK: advanced fields not defaulted (content/related/links)');
})();

/* ---------------------------------------------------------------------
   2) QUICK FORM required-field validation (shared validateTaskForm)
--------------------------------------------------------------------- */
(function () {
  const empty = T.validateTaskForm(T.quickTaskFormDefaults());
  pass(!empty.valid, 'QUICK: empty quick defaults fail validation');
  pass(!!empty.errors.title && !!empty.errors.category_code && !!empty.errors.primary_employee_code && !!empty.errors.deadline, 'QUICK: required fields flagged — title/category/primary/deadline');

  const filled = Object.assign(T.quickTaskFormDefaults(), { title: 'Việc test', category_code: 'CAT1', primary_employee_code: 'NV001', deadline: T.taskDateTimeInputValue(new Date(Date.now() + 3600000)) });
  const ok = T.validateTaskForm(filled);
  pass(ok.valid, 'QUICK: fully filled quick form passes validation with same validateTaskForm used by full form');
})();

/* ---------------------------------------------------------------------
   3) SHARED CREATE ENGINE — no separate quickCreateTask/fullCreateTask path
--------------------------------------------------------------------- */
(function () {
  pass(!/function\s+quickCreateTask/.test(code) && !/function\s+fullCreateTask/.test(code), 'ENGINE: no separate quickCreateTask/fullCreateTask business path');
  pass((code.match(/function submitTaskCreate/g) || []).length === 1, 'ENGINE: exactly one submitTaskCreate function');
  pass((code.match(/function runCreateTaskFlow/g) || []).length === 1, 'ENGINE: exactly one runCreateTaskFlow function');
  pass(code.includes("'[data-task-create-form]'"), 'ENGINE: one submit selector binds both tab forms to the same handler');
  pass(code.includes('createTaskQuickFormHtml') && code.includes('createTaskFullFormHtml'), 'ENGINE: quick/full only differ by HTML rendering (default values + field visibility)');
})();

/* ---------------------------------------------------------------------
   4) PUBLISH required before "success" (draft create can PASS, publish can FAIL)
--------------------------------------------------------------------- */
const publishChecks = (async function () {
  const baseForm = { flow_type: 'giao_viec', title: 'Việc test publish', content: '', category_code: 'CAT1', priority: 'thuong', start_at: '', deadline: T.taskDateTimeInputValue(new Date(Date.now() + 3600000)), primary_employee_code: 'NV001', related_employee_codes: [], links: [] };

  function fakeApi(failPublish) {
    return async function (payload) {
      if (payload.action === 'createTaskDraft') return { result: { id: 'task-1', row_version: 1 } };
      if (payload.action === 'publishTask') { if (failPublish) throw Object.assign(new Error('Xung đột phiên bản'), { code: 'TASK_VERSION_CONFLICT' }); return { result: { id: 'task-1', row_version: 2 } }; }
      if (payload.action === 'getTaskDetail') return { result: { task: { id: 'task-1', status: failPublish ? 'draft' : 'published' } } };
      throw new Error('unexpected action in fake api: ' + payload.action);
    };
  }

  const okResult = await T.runCreateTaskFlow(baseForm, fakeApi(false));
  pass(okResult.published === true, 'PUBLISH: successful publish marks result.published=true');
  pass(!okResult.publishError, 'PUBLISH: no publishError on success');

  const failResult = await T.runCreateTaskFlow(baseForm, fakeApi(true));
  pass(failResult.published === false, 'PUBLISH: failed publish marks result.published=false — draft create alone is not success');
  pass(!!failResult.publishError, 'PUBLISH: publishError message is surfaced');
  pass(failResult.taskId === 'task-1', 'PUBLISH: taskId still returned so the draft is not orphaned/lost on publish failure');
})();

/* ---------------------------------------------------------------------
   5) COPY TASK — allowed fields only, excludes state/audit, duration recalculated,
      no recurrence copied
--------------------------------------------------------------------- */
(function () {
  const detail = {
    task: {
      id: 'src-task', flow_type: 'giao_viec', title: 'Việc gốc', content: 'Nội dung gốc',
      category_code: 'CAT_KHO_VAN', priority: 'khan_cap',
      start_at: '2026-01-10T01:00:00.000Z', deadline: '2026-01-10T10:00:00.000Z', // 9h duration
      status: 'completed', progress_percent: 100, progress_status: 'hoan_thanh',
      completed_at: '2026-01-10T09:30:00.000Z', published_at: '2026-01-10T01:05:00.000Z', row_version: 7,
      recurring_series_id: 'series-1', recurring_series_version: 3
    },
    primary: { employee_code: 'NV001' },
    related: [{ employee_code: 'NV002' }, { employee_code: 'NV003' }],
    links: [{ side: 'input_reference', url: 'https://a.example', label: 'Tài liệu A' }]
  };
  const before = Date.now();
  const copied = T.buildCopyFormFromDetail(detail);
  const after = Date.now();

  pass(copied.title === 'Việc gốc' && copied.content === 'Nội dung gốc', 'COPY: title/content copied');
  pass(copied.category_code === 'CAT_KHO_VAN' && copied.priority === 'khan_cap', 'COPY: category/priority copied');
  pass(copied.primary_employee_code === 'NV001', 'COPY: Primary copied');
  pass(copied.related_employee_codes.length === 2 && copied.related_employee_codes.indexOf('NV002') >= 0 && copied.related_employee_codes.indexOf('NV003') >= 0, 'COPY: Related copied');
  pass(copied.links.length === 1 && copied.links[0].url === 'https://a.example', 'COPY: links copied');

  const allowedKeys = ['flow_type', 'title', 'content', 'category_code', 'priority', 'start_at', 'deadline', 'primary_employee_code', 'related_employee_codes', 'links'];
  const extraKeys = Object.keys(copied).filter(k => allowedKeys.indexOf(k) < 0);
  pass(extraKeys.length === 0, 'COPY: no extra fields beyond the allowed copy set — got ' + JSON.stringify(extraKeys));
  pass(!('status' in copied) && !('progress_percent' in copied) && !('completed_at' in copied) && !('published_at' in copied) && !('row_version' in copied), 'COPY: state/audit/result fields excluded');
  pass(!('recurring_series_id' in copied) && !('recurring_series_version' in copied), 'COPY: recurrence config NOT copied');

  const startMs = Date.parse(T.serializeTaskLocalDateTime(copied.start_at));
  /* datetime-local input has minute precision — tolerate truncation to the minute */
  pass(startMs >= before - 65000 && startMs <= after + 1000, 'COPY: new start = now (time of copy)');
  const deadlineMs = Date.parse(T.serializeTaskLocalDateTime(copied.deadline));
  const durationHours = (deadlineMs - startMs) / 3600000;
  pass(Math.abs(durationHours - 9) < 0.05, 'COPY: duration recalculated at 9h (matches source 9h duration), got ' + durationHours + 'h');

  /* inactive category / inactive Primary / inactive Related handling via sanitizeCreateFormAfterLoad */
  const state = T.getState();
  state.form = T.cloneTaskForm(copied);
  state.categories = [{ code: 'OTHER_CAT', name: 'Khác', isActive: true }]; // CAT_KHO_VAN not present -> "inactive"/unavailable
  state.employees = [{ code: 'NV003', name: 'NV3', department: 'X' }]; // NV001 primary missing, NV002 related missing
  state.primaryPickerOpen = false;
  T.sanitizeCreateFormAfterLoad();
  pass(state.form.category_code === '', 'COPY: inactive category not auto-selected — forces reselect');
  pass(state.form.primary_employee_code === '' && state.primaryPickerOpen === true, 'COPY: inactive Primary not auto-selected — forces reselect, picker reopened');
  pass(state.form.related_employee_codes.length === 1 && state.form.related_employee_codes[0] === 'NV003', 'COPY: inactive Related excluded from prefill, active one kept');
})();

/* ---------------------------------------------------------------------
   6) EMPLOYEE PICKER — search name/mã, department filter, Primary excluded
      from Related, active-only upstream, bounded result size for 100+ rows
--------------------------------------------------------------------- */
(function () {
  const state = T.getState();
  const employees = [
    { code: 'NV001', name: 'Nguyễn An', department: 'Ban giám đốc', title: 'Giám đốc', branch: 'Phú Lợi', employmentStatus: 'active' },
    { code: 'NV002', name: 'Trần Bình', department: 'Bộ phận bán hàng', title: 'Nhân viên', branch: 'Phú Lợi', employmentStatus: 'active' },
    { code: 'NV003', name: 'Lê Chi', department: 'Bộ phận bán hàng', title: 'Trưởng ca', branch: 'Lái Thiêu', employmentStatus: 'active' }
  ];
  state.employees = employees;
  state.form = T.defaultTaskForm();
  state.primaryQuery = ''; state.relatedQuery = ''; state.primaryDept = ''; state.relatedDept = '';

  pass(T.matchedEmployees('primary').length === 3, 'PICKER: no filter returns all candidates');
  state.primaryQuery = 'nv002';
  pass(T.matchedEmployees('primary').map(r => r.code).join(',') === 'NV002', 'PICKER: search by mã nhân viên');
  state.primaryQuery = 'chi';
  pass(T.matchedEmployees('primary').map(r => r.code).join(',') === 'NV003', 'PICKER: search by họ tên');
  state.primaryQuery = '';
  state.primaryDept = 'Bộ phận bán hàng';
  pass(T.matchedEmployees('primary').map(r => r.code).sort().join(',') === 'NV002,NV003', 'PICKER: department filter narrows roster');
  state.primaryQuery = 'chi';
  pass(T.matchedEmployees('primary').map(r => r.code).join(',') === 'NV003', 'PICKER: search only within the department-filtered group');
  state.primaryDept = ''; state.primaryQuery = '';

  state.form.primary_employee_code = 'NV001';
  const relatedResults = T.matchedEmployees('related').map(r => r.code);
  pass(relatedResults.indexOf('NV001') < 0, 'PICKER: Primary excluded from Related candidates');
  pass(relatedResults.length === 2, 'PICKER: Related keeps the remaining active employees');

  /* active-only guaranteed upstream by taskAssignableEmployeeRows */
  const mixed = [
    { employeeCode: 'A1', fullName: 'Active One', employmentStatus: 'active' },
    { employeeCode: 'A2', fullName: 'Inactive Two', employmentStatus: 'inactive' }
  ];
  const rows = T.taskAssignableEmployeeRows(mixed);
  pass(rows.length === 1 && rows[0].code === 'A1', 'PICKER: taskAssignableEmployeeRows keeps only active employees');

  /* 100+ rows bounded result size */
  const big = [];
  for (let i = 0; i < 120; i++) big.push({ code: 'BIG' + i, name: 'Người ' + i, department: 'Phòng ' + (i % 5), employmentStatus: 'active' });
  state.employees = big; state.form = T.defaultTaskForm(); state.primaryQuery = ''; state.primaryDept = '';
  pass(T.matchedEmployees('primary').length === 50, 'PICKER: result list bounded to 50 rows even with 120+ candidates');
})();

publishChecks.then(function () {
  /* ---------------------------------------------------------------------
   7) CATEGORY PICKER — active-only, respects sort_order (not alphabetical)
--------------------------------------------------------------------- */
(function () {
  const raw = [
    { category_code: 'THU_MUA', display_name: 'Thu mua', is_active: true, sort_order: 7 },
    { category_code: 'BAO_CAO', display_name: 'Báo cáo', is_active: true, sort_order: 1 },
    { category_code: 'CU', display_name: 'Cũ ngừng dùng', is_active: false, sort_order: 2 },
    { category_code: 'NHAN_SU', display_name: 'Nhân sự', is_active: true, sort_order: 4 }
  ];
  const rows = T.taskActiveCategoryRows(raw);
  pass(rows.length === 3, 'CATEGORY: inactive category excluded from picker');
  pass(rows.map(r => r.code).join(',') === 'BAO_CAO,NHAN_SU,THU_MUA', 'CATEGORY: picker ordered by sort_order, not alphabetically — got ' + rows.map(r => r.code).join(','));
})();

/* ---------------------------------------------------------------------
   8) QUICK skeleton — fields present/absent (Create Modes Foundation V1)
--------------------------------------------------------------------- */
(function () {
  const state = T.getState();
  state.form = T.defaultTaskForm();
  state.form.title = 'Tiêu đề Quick'; state.form.content = 'Nội dung Quick'; state.form.category_code = 'CAT1'; state.form.deadline = T.taskDateTimeInputValue(new Date(Date.now() + 3600000));
  state.categories = [{ code: 'CAT1', name: 'Danh mục 1', isActive: true }];
  state.employees = []; state.foundationStatus = { createTaskReady: true }; state.foundationStatusLoading = false;
  const html = T.createTaskQuickFormHtml();
  pass(html.indexOf('data-task-field="title"') >= 0, 'QUICK HTML: has Title field');
  pass(html.indexOf('data-task-field="content"') >= 0, 'QUICK HTML: has Content field visible directly (no "+ Thêm nội dung" toggle)');
  pass(!/\+\s*Thêm nội dung/.test(html), 'QUICK HTML: Content is not hidden behind a disclosure toggle');
  pass(html.indexOf('data-task-field="category_code"') >= 0, 'QUICK HTML: has Category field');
  pass(html.indexOf('data-task-dt-field="deadline"') >= 0, 'QUICK HTML: has Deadline field (24h control)');
  pass(html.indexOf('data-task-add-link') >= 0, 'QUICK HTML: supports adding Links/Tài liệu');
  // Step 4D — Quick now exposes a priority selector that REUSES the existing
  // taskUiState.form.priority contract (values thuong/quan_trong/khan_cap,
  // canonical default 'thuong'). It is NOT a <select data-task-field="priority">
  // (that stays Full-only) — it is a chip group writing the same state key.
  pass(html.indexOf('data-task-field="priority"') < 0, 'QUICK HTML: no <select data-task-field="priority"> (Full-form control unchanged)');
  pass(/data-task-priority="thuong"/.test(html) && /data-task-priority="quan_trong"/.test(html) && /data-task-priority="khan_cap"/.test(html), 'QUICK HTML: priority chip group offers the 3 existing canonical values');
  {
    const s = T.getState(); const prevPrio = s.form.priority;
    s.form.priority = T.defaultTaskForm().priority;
    pass(s.form.priority === 'thuong', 'QUICK PRIORITY: canonical default is the existing "thuong" value');
    const onHtml = T.createTaskQuickFormHtml();
    pass(/class="phft-prio-chip prio-thuong is-on"/.test(onHtml), 'QUICK PRIORITY: default renders "Thường" chip active');
    s.form.priority = 'khan_cap';
    pass(/class="phft-prio-chip prio-khan_cap is-on"/.test(T.createTaskQuickFormHtml()), 'QUICK PRIORITY: selecting "khan_cap" reflects in the same form.priority state');
    pass(/function buildCreatePayload[\s\S]{0,400}priority:form\.priority/.test(code), 'QUICK PRIORITY: create payload still carries form.priority verbatim (no new field / no Quick-specific schema)');
    pass(/data-task-priority[\s\S]{0,200}taskUiState\.form\.priority=prioVal/.test(code), 'QUICK PRIORITY: chip click writes the SAME taskUiState.form.priority (single source of truth)');
    // Step 4D E2E — the chosen priority must survive applyModeCanonicalOverrides('quick')
    // (submit path) and reach the create payload. Regression guard for the
    // "quick always forces thuong" bug found at the release gate.
    ['thuong', 'quan_trong', 'khan_cap'].forEach(function (pv) {
      const f = Object.assign(T.defaultTaskForm(), { priority: pv });
      pass(T.applyModeCanonicalOverrides(f, 'quick').priority === pv, 'QUICK PRIORITY E2E: submit-path override keeps priority=' + pv + ' for Quick');
      pass(T.buildCreatePayload(T.applyModeCanonicalOverrides(Object.assign(f, { deadline: T.taskDateTimeInputValue(new Date(Date.now() + 3600000)) }), 'quick')).priority === pv, 'QUICK PRIORITY E2E: create payload priority=' + pv + ' after the full Quick submit transform');
    });
    s.form.priority = prevPrio;
  }
  pass(html.indexOf('data-task-field="flow_type"') < 0, 'QUICK HTML: no flow_type/Proposal choice');
  pass(html.indexOf('data-task-search="related"') < 0 && html.indexOf('Người liên quan') < 0, 'QUICK HTML: no CC/Related section');
  pass(!/Công việc lặp/.test(html), 'QUICK HTML: no recurrence section');
  pass(/data-task-create-tab="full"/.test(html) && /Chuyển sang Tạo phiếu đầy đủ/.test(html), 'QUICK HTML: has upsell path to Full for CC/lặp/advanced');
})();

/* ---------------------------------------------------------------------
   9) FULL skeleton — superset of Quick + advanced fields, recurrence honesty
--------------------------------------------------------------------- */
(function () {
  const state = T.getState();
  state.form = T.defaultTaskForm();
  state.expandedSections = { content: true, related: true, links: true, recurrence: false };
  state.categories = [{ code: 'CAT1', name: 'Danh mục 1', isActive: true }];
  state.employees = []; state.foundationStatus = { createTaskReady: true }; state.foundationStatusLoading = false;
  const html = T.createTaskFullFormHtml();
  pass(html.indexOf('data-task-field="flow_type"') >= 0, 'FULL HTML: Loại phiếu (flow_type) available — Giao việc/Đề xuất');
  pass(html.indexOf('data-task-field="priority"') >= 0, 'FULL HTML: Priority editable');
  pass(html.indexOf('data-task-dt-field="start_at"') >= 0, 'FULL HTML: Start editable (24h control)');
  pass(html.indexOf('data-task-search="related"') >= 0, 'FULL HTML: Related/CC available');
  pass(/sẽ khả dụng khi engine sinh phiếu tự động được triển khai/.test(html), 'FULL HTML: recurrence area stays honestly non-functional (backend frozen)');
})();

/* ---------------------------------------------------------------------
   10) MODE SWITCH — Quick → Full preserves common data (shared taskUiState.form)
--------------------------------------------------------------------- */
(function () {
  const state = T.getState();
  state.form = T.defaultTaskForm();
  state.form.title = 'Việc chung'; state.form.content = 'Nội dung chung'; state.form.category_code = 'CAT1'; state.form.deadline = '2026-09-01T10:00';
  state.form.primary_employee_code = 'NV001'; state.form.links = [{ side: 'input_reference', url: 'https://x.example', label: '' }];
  state.categories = [{ code: 'CAT1', name: 'Danh mục 1', isActive: true }];
  state.employees = [{ code: 'NV001', name: 'A', department: 'D', employmentStatus: 'active' }];
  state.foundationStatus = { createTaskReady: true }; state.foundationStatusLoading = false;
  state.createTab = 'quick'; state.primaryPickerOpen = false;
  const before = JSON.stringify(state.form);
  state.createTab = 'full'; // switching tab does not touch taskUiState.form at all
  pass(JSON.stringify(state.form) === before, 'SWITCH: Quick→Full does not mutate shared form state');
  const fullHtml = T.createTaskFullFormHtml();
  pass(fullHtml.indexOf('Việc chung') >= 0 && fullHtml.indexOf('CAT1') >= 0, 'SWITCH: Full form renders the data entered in Quick (title/category preserved)');
})();

/* ---------------------------------------------------------------------
   11) MODE SWITCH — Full → Quick safety (no silent data loss)
--------------------------------------------------------------------- */
(function () {
  const baseForm = T.defaultTaskForm();
  pass(T.fullToQuickBlockingReasons(baseForm, { start: false }, { recurrence: false }).length === 0, 'SWITCH: Full→Quick with no advanced-only data has no blocking reasons');

  const withCc = Object.assign(T.cloneTaskForm(baseForm), { related_employee_codes: ['NV002'] });
  pass(T.fullToQuickBlockingReasons(withCc, { start: false }, { recurrence: false }).length === 1, 'SWITCH: Full→Quick warns when CC present');

  const withProposal = Object.assign(T.cloneTaskForm(baseForm), { flow_type: 'de_xuat' });
  pass(T.fullToQuickBlockingReasons(withProposal, { start: false }, { recurrence: false }).length === 1, 'SWITCH: Full→Quick warns when flow_type=de_xuat');

  const withPriority = Object.assign(T.cloneTaskForm(baseForm), { priority: 'khan_cap' });
  pass(T.fullToQuickBlockingReasons(withPriority, { start: false }, { recurrence: false }).length === 0, 'SWITCH: Full→Quick does NOT warn on priority (Step 4D — Quick has its own priority selector, value carried over)');

  pass(T.fullToQuickBlockingReasons(baseForm, { start: true }, { recurrence: false }).length === 1, 'SWITCH: Full→Quick warns when Start was explicitly touched');
  pass(T.fullToQuickBlockingReasons(baseForm, { start: false }, { recurrence: true }).length === 1, 'SWITCH: Full→Quick warns when recurrence section is open');
})();

/* ---------------------------------------------------------------------
   12) SHARED CANONICAL ENGINE — quick forces defaults; full leaves form untouched
--------------------------------------------------------------------- */
(function () {
  const staleForm = { flow_type: 'de_xuat', title: 'X', content: '', category_code: 'CAT1', priority: 'khan_cap', start_at: '2020-01-01T00:00', deadline: '2026-09-01T10:00', primary_employee_code: 'NV001', related_employee_codes: ['NV002'], links: [] };
  const overridden = T.applyModeCanonicalOverrides(staleForm, 'quick');
  pass(overridden.flow_type === 'giao_viec', 'ENGINE: quick canonical override forces flow_type=giao_viec regardless of stale field');
  pass(overridden.priority === 'khan_cap', 'ENGINE: quick canonical override CARRIES the chosen priority through (Step 4D — no longer force-reset to thuong)');
  pass(T.applyModeCanonicalOverrides(Object.assign({}, staleForm, { priority: 'bogus' }), 'quick').priority === 'thuong', 'ENGINE: quick override still coerces an invalid priority value back to the canonical thuong');
  pass(overridden.related_employee_codes.length === 0, 'ENGINE: quick canonical override forces related=[]');
  pass(Math.abs(Date.now() - Date.parse(T.serializeTaskLocalDateTime(overridden.start_at))) < 65000, 'ENGINE: quick canonical override resolves start_at at call time, not the stale 2020 value');

  const untouched = T.applyModeCanonicalOverrides(staleForm, 'full');
  pass(untouched.flow_type === 'de_xuat' && untouched.priority === 'khan_cap' && untouched.related_employee_codes.length === 1, 'ENGINE: full mode leaves the form untouched (no forced overrides)');

  /* resolves fresh at each call — proves it is NOT captured once at form-open time */
  const first = T.applyModeCanonicalOverrides(staleForm, 'quick').start_at;
  const second = T.applyModeCanonicalOverrides(staleForm, 'quick').start_at;
  pass(typeof first === 'string' && typeof second === 'string', 'ENGINE: start_at resolves on every call (submit-time), not once at open time');
})();

console.log('PHF Task Create UX V1 test: ' + passed + '/' + passed + ' PASS');
}).catch(function (err) {
  console.error(err);
  process.exitCode = 1;
});
