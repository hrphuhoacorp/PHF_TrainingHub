'use strict';
/* PHF Task — RECURRENCE V1 "Số lần lặp" — pure unit regression (no DB, no net).
   Covers the count decision + validation across all three layers:
     - engine recurrenceCountState() + validateRuleInput('after_count')
     - main-app normalizeRuleInput() repeat_count -> after_count / maxOccurrences
     - frontend validateTaskRecurrenceInput() repeat_count rejection + UI copy
   The DB-backed finite-generation behaviour lives in
   scripts/task-recurrence-repeat-count-e2e-dev.js (needs the migration). */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const engine = require(path.join(ROOT, 'services/phf-hr-api/lib/task-recurrence'));
const actions = require(path.join(ROOT, 'api/_lib/task-recurrence-actions'));

let pass = 0;
function ok(c, m) { assert.ok(c, m); pass += 1; }

// ---- engine.recurrenceCountState (the pure product rule) --------------------
(function () {
  ok(engine.recurrenceCountState(null, 7).finite === false, 'null N => indefinite');
  ok(engine.recurrenceCountState(undefined, 0).finite === false, 'undefined N => indefinite');
  const a = engine.recurrenceCountState(3, 0);
  ok(a.finite && a.max === 3 && a.remaining === 3 && a.exhausted === false, 'N=3, 0 done => 3 remaining');
  ok(engine.recurrenceCountState(3, 2).remaining === 1, 'N=3, 2 done => 1 remaining');
  ok(engine.recurrenceCountState(3, 3).exhausted === true && engine.recurrenceCountState(3, 3).remaining === 0, 'N=3, 3 done => exhausted');
  ok(engine.recurrenceCountState(3, 5).exhausted === true && engine.recurrenceCountState(3, 5).remaining === 0, 'N=3, 5 done (over) => exhausted, remaining clamped 0');
  ok(engine.recurrenceCountState(1, 0).remaining === 1 && engine.recurrenceCountState(1, 1).exhausted, 'N=1 boundary');
  ok(engine.RECURRENCE_MAX_OCCURRENCES === 200, 'documented upper bound = 200');
})();

// ---- engine.validateRuleInput — after_count --------------------------------
function baseEngineInput(extra) {
  return Object.assign({
    title: 't', categoryCode: 'C', primaryEmployeeCode: 'P', startDateKey: '2026-01-05',
    startHour: 8, startMinute: 0, durationMs: 86400000, frequency: 'weekly', weekday: 'T2',
  }, extra || {});
}
(function () {
  const okv = engine.validateRuleInput(baseEngineInput({ endConditionType: 'after_count', maxOccurrences: 3 }));
  ok(okv.endConditionType === 'after_count' && okv.maxOccurrences === 3, 'engine: after_count + N=3 accepted');
  const never = engine.validateRuleInput(baseEngineInput({}));
  ok(never.endConditionType === 'never' && never.maxOccurrences === null, 'engine: default never, maxOccurrences null');
  for (const bad of [0, -1, 1.5, 201, 'x', null]) {
    let threw = null;
    try { engine.validateRuleInput(baseEngineInput({ endConditionType: 'after_count', maxOccurrences: bad })); }
    catch (e) { threw = e.code; }
    ok(threw === 'RECURRENCE_MAX_OCCURRENCES_INVALID', 'engine: after_count rejects ' + JSON.stringify(bad) + ' (' + threw + ')');
  }
  const onDate = engine.validateRuleInput(baseEngineInput({ endConditionType: 'on_date', endDateKey: '2026-06-01' }));
  ok(onDate.maxOccurrences === null, 'engine: on_date keeps maxOccurrences null');
})();

// ---- actions.normalizeRuleInput — repeat_count -> after_count --------------
function basePayload(extra) {
  return Object.assign({
    title: 't', categoryCode: 'C', primaryEmployeeCode: 'P', frequency: 'weekly', weekday: 'T2',
    startDate: '2026-01-05', startTime: '08:00', durationDays: 1,
  }, extra || {});
}
(function () {
  const blank = actions.normalizeRuleInput(basePayload({}));
  ok(blank.endConditionType === 'never' && blank.maxOccurrences === null, 'actions: no repeat_count => never / null (indefinite)');
  const n3 = actions.normalizeRuleInput(basePayload({ repeatCount: 3 }));
  ok(n3.endConditionType === 'after_count' && n3.maxOccurrences === 3, 'actions: repeatCount 3 => after_count / 3');
  const n1 = actions.normalizeRuleInput(basePayload({ repeatCount: '1' }));
  ok(n1.maxOccurrences === 1, 'actions: repeatCount "1" (string) => 1');
  const empty = actions.normalizeRuleInput(basePayload({ repeatCount: '' }));
  ok(empty.endConditionType === 'never' && empty.maxOccurrences === null, 'actions: repeatCount "" => indefinite');
  for (const bad of [0, -2, 2.5, 201, 'abc']) {
    let threw = null;
    try { actions.normalizeRuleInput(basePayload({ repeatCount: bad })); } catch (e) { threw = e.code; }
    ok(threw === 'RECURRENCE_MAX_OCCURRENCES_INVALID', 'actions: repeatCount ' + JSON.stringify(bad) + ' rejected (' + threw + ')');
  }
})();

// ---- frontend validateTaskRecurrenceInput + UI copy (jsdom) ---------------
(function () {
  const code = fs.readFileSync(path.join(ROOT, 'assets/js/task/phf-task-app.js'), 'utf8');
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/admin/task/tao' });
  dom.window.__PHF_TASK_TEST_MODE__ = true;
  dom.window.phfGetSessionRole = () => 'admin';
  dom.window.phfGetCurrentUser = () => ({ fullName: 'A', email: 'a@a' });
  dom.window.phfNavigate = () => {}; dom.window.phfToast = () => {};
  dom.window.eval(code);
  const T = dom.window.__PHF_TASK_TEST__;
  const base = { mode: 'weekly', weekday: 'T2', start_date: '2026-01-05', start_time: '08:00' };
  ok(T.defaultTaskRecurrence().repeat_count === '', 'FE: default repeat_count is blank');
  ok(T.validateTaskRecurrenceInput(Object.assign({}, base)) === '', 'FE: blank repeat_count OK (indefinite)');
  ok(T.validateTaskRecurrenceInput(Object.assign({}, base, { repeat_count: 3 })) === '', 'FE: repeat_count 3 OK');
  ok(T.validateTaskRecurrenceInput(Object.assign({}, base, { repeat_count: 1 })) === '', 'FE: repeat_count 1 OK');
  for (const bad of [0, -1, 2.5, 201, 'x']) {
    ok(!!T.validateTaskRecurrenceInput(Object.assign({}, base, { repeat_count: bad })), 'FE: repeat_count ' + JSON.stringify(bad) + ' rejected');
  }
  const form = { title: 't', primary_employee_code: 'P', category_code: 'C', priority: 'thuong', related_employee_codes: [] };
  ok(T.buildRecurrencePayload(form, Object.assign({}, base, { repeat_count: 3 }), 'task-1').repeat_count === 3, 'FE: buildRecurrencePayload sends repeat_count 3');
  ok(T.buildRecurrencePayload(form, Object.assign({}, base, { repeat_count: '' }), 'task-1').repeat_count === undefined, 'FE: buildRecurrencePayload omits blank repeat_count');
  const st = T.getState(); st.form = T.defaultTaskForm();
  st.form.recurrence.mode = 'weekly';
  let html = T.taskRecurrenceSectionHtml();
  ok(/data-task-recurrence-field="repeat_count"/.test(html) && /Số lần lặp/.test(html) && /Để trống nếu muốn lặp đến khi chủ động dừng\./.test(html), 'FE: weekly shows "Số lần lặp" + helper (verbatim)');
  ok(!/Số tuần/.test(html), 'FE: weekly not labelled "Số tuần"');
  st.form.recurrence.mode = 'monthly';
  html = T.taskRecurrenceSectionHtml();
  ok(/data-task-recurrence-field="repeat_count"/.test(html) && /Số lần lặp/.test(html) && /Để trống nếu muốn lặp đến khi chủ động dừng\./.test(html), 'FE: monthly shows the SAME "Số lần lặp" field + helper');
  ok(!/Số tháng/.test(html), 'FE: monthly not labelled "Số tháng"');
})();

console.log('PHF Task Recurrence "So lan lap" unit: ' + pass + '/' + pass + ' PASS');
