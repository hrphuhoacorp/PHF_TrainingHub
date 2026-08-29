'use strict';
/* PHF Task — Create Hardening V1: employee picker search-first, 24h time
   control, and structural/concurrency-safety regressions. Pure logic/DOM —
   no backend mutation, no real network (window.fetch is mocked). */
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
window.phfNavigate = function () { };
window.phfToast = function () { };
window.eval(code);
const T = window.__PHF_TASK_TEST__;
assert.ok(T, 'test hook window.__PHF_TASK_TEST__ must be exposed');

let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }

/* ---------------------------------------------------------------------
   1) EMPLOYEE PICKER — search-first (blank search + "Tất cả phòng ban" => no list)
--------------------------------------------------------------------- */
(function () {
  const state = T.getState();
  state.employees = [
    { code: 'NV001', name: 'Nguyễn An', department: 'Ban giám đốc', employmentStatus: 'active' },
    { code: 'NV002', name: 'Trần Bình', department: 'Bộ phận bán hàng', employmentStatus: 'active' }
  ];
  state.form = T.defaultTaskForm();
  state.primaryQuery = ''; state.primaryDept = ''; state.relatedQuery = ''; state.relatedDept = '';
  state.employeesLoading = false; state.employeesError = '';

  pass(T.taskPickerShouldShowResults('primary') === false, 'PICKER: blank search + all departments => shouldShowResults=false');
  const blankHtml = T.employeeResultsHtml('primary');
  pass(blankHtml.indexOf('data-task-pick-primary') < 0, 'PICKER: blank search + all departments => no employee options rendered');
  pass(/chọn phòng ban để hiện danh sách/.test(blankHtml), 'PICKER: blank state shows a clear prompt instead of an empty/silent list');

  state.primaryDept = 'Ban giám đốc';
  pass(T.taskPickerShouldShowResults('primary') === true, 'PICKER: department selected => shouldShowResults=true');
  pass(T.employeeResultsHtml('primary').indexOf('NV001') >= 0, 'PICKER: department selected => results rendered');
  state.primaryDept = '';

  state.primaryQuery = 'an';
  pass(T.taskPickerShouldShowResults('primary') === true, 'PICKER: search entered => shouldShowResults=true');
  pass(T.employeeResultsHtml('primary').indexOf('NV001') >= 0, 'PICKER: search entered => matching results rendered');
})();

/* ---------------------------------------------------------------------
   2) 24H TIME — parser never accepts/emits AM/PM/SA/CH, deterministic across locale
--------------------------------------------------------------------- */
(function () {
  pass(T.combineTaskDateTimeParts('2026-08-22', '23', '59') === '2026-08-22T23:59', '24H: valid 23:59 combines correctly');
  pass(T.combineTaskDateTimeParts('2026-08-22', '00', '00') === '2026-08-22T00:00', '24H: valid 00:00 combines correctly');
  pass(T.combineTaskDateTimeParts('2026-08-22', '24', '00') === '', '24H: hour=24 rejected (not a valid 24h hour)');
  pass(T.combineTaskDateTimeParts('2026-08-22', '-1', '00') === '', '24H: negative hour rejected');
  pass(T.combineTaskDateTimeParts('2026-08-22', '10', '60') === '', '24H: minute=60 rejected');
  pass(T.combineTaskDateTimeParts('2026-08-22', '5.5', '00') === '', '24H: non-integer hour rejected');
  pass(T.combineTaskDateTimeParts('2026-08-22', '', '30') === '', '24H: missing hour rejected');
  pass(T.combineTaskDateTimeParts('', '10', '30') === '', '24H: missing date rejected');

  const display = T.taskDateTimeDisplayVN('2026-08-22T17:30');
  pass(display === '22/08/2026 17:30', '24H: display format is dd/mm/yyyy HH:mm — got ' + display);
  const displayLateNight = T.taskDateTimeDisplayVN('2026-08-22T23:05');
  pass(!/AM|PM|SA|CH/i.test(displayLateNight), '24H: 23:05 never renders as an AM/PM/SA/CH 12h equivalent — got ' + displayLateNight);

  const state = T.getState();
  state.form = T.defaultTaskForm(); state.form.deadline = '2026-08-22T23:05';
  const fieldHtml = T.taskDateTimeFieldHtml('deadline', 'Hạn hoàn thành', true);
  pass(fieldHtml.indexOf('type="datetime-local"') < 0, '24H: control does NOT use native <input type="datetime-local"> (source of AM/PM/SA/CH under some locales)');
  pass(fieldHtml.indexOf('type="date"') >= 0, '24H: control uses a locale-neutral date part');
  pass((fieldHtml.match(/type="number"/g) || []).length === 2, '24H: control uses two number inputs (hour 00-23, minute 00-59)');
  pass(!/AM|PM|SA|CH/i.test(fieldHtml), '24H: rendered control markup contains no AM/PM/SA/CH tokens');
  pass(fieldHtml.indexOf('max="23"') >= 0 && fieldHtml.indexOf('max="59"') >= 0, '24H: hour capped at 23, minute capped at 59 at the input level');

  pass(code.indexOf('input type="datetime-local"') < 0, '24H: no native <input type="datetime-local"> rendered anywhere left in Create Task source');
})();

/* ---------------------------------------------------------------------
   3) TASK CODE — no client-side MAX+1/counter logic introduced this pass
      (task_code implementation itself is design-only per Create Hardening V1
      mục 5/8 — not built yet, so the only thing to guard is that nothing
      half-baked was added client-side).
--------------------------------------------------------------------- */
(function () {
  /* Task Code + Idempotency Foundation V1 (later pass) legitimately introduced
     task_code as a DISPLAY-only field (detail view + quick-success banner),
     sourced strictly from the server response — never generated/allocated
     client-side. Guard the invariant that actually matters: no MAX+1/counter
     logic, and every "task_code" reference in source reads from a server
     response object, never assigns a client-computed sequence to it. */
  pass(!/max\s*\([^)]*\)\s*\+\s*1/i.test(code), 'TASK CODE: no MAX(...)+1 style client-side sequence logic anywhere in Create Task source');
  pass(!/task_code\s*=\s*['"]CV-/.test(code), 'TASK CODE: no hardcoded/client-fabricated CV- prefix assembly — task_code always comes from the server response');
  pass(!/created\.task_code\s*\|\|\s*['"]CV-/.test(code), 'TASK CODE: no client-side fallback that fabricates a code when the server does not return one (must show "pending", never invent a code)');
})();

/* ---------------------------------------------------------------------
   4) TASK IDS — server-returned only, never client-generated
--------------------------------------------------------------------- */
(function () {
  const m = code.match(/async function runCreateTaskFlow\(input,apiCall,onPhase,attemptKey\)\{[\s\S]*?\n\}/);
  assert.ok(m, 'runCreateTaskFlow source must be found for structural audit');
  const body = m[0];
  pass(body.indexOf('created.id||created.task_id') >= 0, 'ENGINE: taskId is read from the server response (created.id/created.task_id) only');
  pass(!/Date\.now\(\)|Math\.random\(\)/.test(body), 'ENGINE: runCreateTaskFlow never fabricates an id client-side (no Date.now()/Math.random())');
  pass(body.indexOf('persistTaskSupplements(taskId') >= 0, 'ENGINE: Related/Link supplements use the same server-returned taskId');
  pass(body.indexOf("action:'publishTask',task_id:taskId") >= 0, 'ENGINE: publish uses the same server-returned taskId');
  pass(body.indexOf("action:'getTaskDetail',task_id:taskId") >= 0, 'ENGINE: detail read-back uses the same server-returned taskId');
})();

/* ---------------------------------------------------------------------
   5) CONCURRENT create() calls do not share/cross-contaminate task state
      (engine-level: runCreateTaskFlow keeps taskId in a local var, not on
      shared taskUiState — proven by running two concurrent calls with
      distinct fake backends and checking no cross-over).
--------------------------------------------------------------------- */
(async function () {
  function fakeApiFor(taskId) {
    return async function (payload) {
      if (payload.action === 'createTaskDraft') { await new Promise(r => setTimeout(r, 5)); return { result: { id: taskId, row_version: 1 } }; }
      if (payload.action === 'publishTask') { assert.strictEqual(payload.task_id, taskId, 'publishTask must target the taskId returned to THIS call, not another concurrent call'); return { result: { id: taskId, row_version: 2 } }; }
      if (payload.action === 'getTaskDetail') { assert.strictEqual(payload.task_id, taskId, 'getTaskDetail must target the taskId returned to THIS call, not another concurrent call'); return { result: { task: { id: taskId, status: 'published' } } }; }
      throw new Error('unexpected action ' + payload.action);
    };
  }
  const form = { flow_type: 'giao_viec', title: 'X', content: '', category_code: 'CAT1', priority: 'thuong', start_at: '', deadline: T.taskDateTimeInputValueParts ? '2026-09-01T10:00' : '2026-09-01T10:00', primary_employee_code: 'NV001', related_employee_codes: [], links: [] };
  const [resultA, resultB] = await Promise.all([
    T.runCreateTaskFlow(form, fakeApiFor('task-A')),
    T.runCreateTaskFlow(form, fakeApiFor('task-B'))
  ]);
  pass(resultA.taskId === 'task-A' && resultB.taskId === 'task-B', 'CONCURRENCY: two concurrent runCreateTaskFlow calls resolve to their OWN distinct taskId — Task A and Task B stay independent');
})().then(function () {

/* ---------------------------------------------------------------------
   6) DOUBLE-SUBMIT — same-form double click does not fire a second create
      request (client-side lock via taskUiState.submitting).
--------------------------------------------------------------------- */
return (async function () {
  const state = T.getState();
  let createDraftCalls = 0, publishCalls = 0, detailCalls = 0;
  window.fetch = async function (url, options) {
    const payload = JSON.parse(options.body);
    let body;
    if (payload.action === 'createTaskDraft') { createDraftCalls++; await new Promise(r => setTimeout(r, 10)); body = { ok: true, result: { id: 'dbl-task', row_version: 1 } }; }
    else if (payload.action === 'publishTask') { publishCalls++; body = { ok: true, result: { id: 'dbl-task', row_version: 2 } }; }
    else if (payload.action === 'getTaskDetail') { detailCalls++; body = { ok: true, result: { task: { id: 'dbl-task', status: 'published' } } }; }
    else body = { ok: true, result: {} };
    return { ok: true, json: async () => body };
  };

  state.view = 'create'; state.createTab = 'quick';
  state.form = T.defaultTaskForm();
  state.form.title = 'Double click test'; state.form.category_code = 'CAT1'; state.form.primary_employee_code = 'NV001';
  state.form.deadline = '2026-09-01T10:00';
  state.categories = [{ code: 'CAT1', name: 'Danh mục 1', isActive: true }];
  state.employees = [{ code: 'NV001', name: 'A', department: 'D', employmentStatus: 'active' }];
  state.foundationStatus = { createTaskReady: true }; state.foundationStatusLoading = false;
  state.submitting = false; state.quickSuccess = null;

  const rootEl = window.document.getElementById('phfTaskRoot');
  const p1 = T.submitTaskCreate(rootEl);
  const p2 = T.submitTaskCreate(rootEl); // fired synchronously right after — simulates a double click
  await Promise.all([p1, p2]);

  pass(createDraftCalls === 1, 'DOUBLE-SUBMIT: a same-tick second submitTaskCreate call does NOT fire a second createTaskDraft request — got ' + createDraftCalls + ' call(s)');
  pass(publishCalls === 1, 'DOUBLE-SUBMIT: publish also fires exactly once');
})();

}).then(function () {
  console.log('PHF Task Create Hardening V1 test: ' + passed + '/' + passed + ' PASS');
}).catch(function (err) {
  console.error(err);
  process.exitCode = 1;
});
