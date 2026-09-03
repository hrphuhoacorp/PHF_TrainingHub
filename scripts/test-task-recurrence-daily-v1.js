'use strict';
/*
 * PHF Task — RECURRENCE V1 — "Hàng ngày" (daily) coverage.
 *
 * Pure / no-DB. Proves the daily frequency addition end to end at every layer
 * that can be exercised without a live Postgres:
 *   - services/phf-hr-api/lib/task-recurrence.js  validateRuleInput + ruleToEngineShape
 *   - services/phf-hr-api/lib/task-recurrence-datemath.js  daily plan (incl. weekends)
 *   - api/_lib/task-recurrence-actions.js  normalizeRuleInput + computeNextRunDateKey + toManagementView (via view)
 *   - assets/js/task/phf-task-app.js  buildRecurrencePayload + validateTaskRecurrenceInput + section HTML (jsdom)
 *
 * The DB-backed matrix (idempotency retry, pause no-backfill, edit future-only,
 * permission preservation, inactive recipient) is already covered generically by
 * scripts/test-task-recurrence-realdb-v1.js — daily reuses the exact same code
 * paths as weekly/monthly below the frequency branch, so those are not re-proven
 * per-frequency here.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const engine = require(path.join(ROOT, 'services/phf-hr-api/lib/task-recurrence'));
const datemath = require(path.join(ROOT, 'services/phf-hr-api/lib/task-recurrence-datemath'));
const actions = require(path.join(ROOT, 'api/_lib/task-recurrence-actions'));

let pass = 0;
function ok(c, m) { assert.ok(c, m); pass += 1; }

/* ---- 1. engine.validateRuleInput — daily --------------------------------- */
function baseEngineInput(extra) {
  return Object.assign({
    title: 't', categoryCode: 'C', primaryEmployeeCode: 'P', startDateKey: '2026-09-05',
    startHour: 8, startMinute: 0, durationMs: 86400000, frequency: 'daily',
  }, extra || {});
}
(function () {
  const v = engine.validateRuleInput(baseEngineInput({ weekday: 'T2', dayOfMonth: 15 }));
  ok(v.frequency === 'daily', 'engine: daily accepted');
  ok(v.weekday === null && v.dayOfMonth === null, 'engine: daily nulls weekday + dayOfMonth even if passed');
  ok(v.anchorDateKey === '2026-09-05', 'engine: daily anchor = start date itself (no weekday snapping)');

  const finite = engine.validateRuleInput(baseEngineInput({ endConditionType: 'after_count', maxOccurrences: 5 }));
  ok(finite.endConditionType === 'after_count' && finite.maxOccurrences === 5, 'engine: daily + "Số lần lặp" N=5 accepted');

  let threw = null;
  try { engine.validateRuleInput(baseEngineInput({ frequency: 'yearly' })); } catch (e) { threw = e.code; }
  ok(threw === 'RECURRENCE_FREQUENCY_INVALID', 'engine: yearly still rejected');
})();

/* ---- 2. datemath — daily plan includes every calendar day (weekends too) - */
(function () {
  const rule = { frequency: 'daily', weekdays: engine.DAILY_WEEKDAYS.slice() };
  ok(Array.isArray(engine.DAILY_WEEKDAYS) && engine.DAILY_WEEKDAYS.length === 7, 'engine.DAILY_WEEKDAYS = all seven');
  // 2026-09-05 is a Saturday; plan the week — every day must appear, no gaps.
  const plan = datemath.generateOccurrencePlan({
    rule, anchorDateKey: '2026-09-05', endCondition: { type: 'never' },
    scanUntilDateKeyInclusive: '2026-09-11',
    existingOccurrenceDateKeys: [], skippedDateKeys: [], pauseWindows: [],
    startHour: 8, startMinute: 0, durationMs: 86400000, nowDateKeyForCatchup: '2026-09-11',
  });
  const dates = plan.map((p) => p.dateKey);
  assert.deepStrictEqual(dates, ['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']);
  ok(true, 'datemath: daily plan = 7 consecutive calendar days incl. Sat/Sun');
  ok(datemath.nextOccurrenceDateKey(rule, '2026-09-30') === '2026-10-01', 'datemath: daily rolls month boundary +1 day');
  ok(datemath.firstOccurrenceDateKey(rule, '2026-09-05') === '2026-09-05', 'datemath: daily first occurrence = anchor');
})();

/* ---- 3. VN timezone boundary for a daily occurrence --------------------- */
(function () {
  // 08:00 VN wall on 2026-09-05 -> 2026-09-05T01:00:00Z; back to VN date = same day.
  const iso = engine.vnWallToUtcIso('2026-09-05', 8, 0);
  ok(iso === '2026-09-05T01:00:00.000Z', 'tz: 08:00 VN -> 01:00Z same calendar day');
  ok(engine.vnDateKeyOfInstant(iso) === '2026-09-05', 'tz: instant maps back to the VN date, no drift');
  // 00:30 VN wall -> previous UTC day, but VN date must stay 2026-09-05.
  const early = engine.vnWallToUtcIso('2026-09-05', 0, 30);
  ok(early === '2026-09-04T17:30:00.000Z' && engine.vnDateKeyOfInstant(early) === '2026-09-05', 'tz: pre-07:00 VN wall keeps the VN date');
})();

/* ---- 4. idempotency key deterministic + per-date ----------------------- */
(function () {
  const k1 = engine.taskIdempotencyKey('rule-1', '2026-09-05');
  const k2 = engine.taskIdempotencyKey('rule-1', '2026-09-05');
  const k3 = engine.taskIdempotencyKey('rule-1', '2026-09-06');
  ok(k1 === k2, 'idempotency: same rule+date => same key (retry-safe)');
  ok(k1 !== k3, 'idempotency: different date => different key');
})();

/* ---- 5. actions.normalizeRuleInput — daily ---------------------------- */
function basePayload(extra) {
  return Object.assign({
    title: 't', categoryCode: 'C', primaryEmployeeCode: 'P', frequency: 'daily',
    startDate: '2026-09-05', startTime: '08:00', durationDays: 1,
  }, extra || {});
}
(function () {
  const d = actions.normalizeRuleInput(basePayload({ weekday: 'T3', dayOfMonth: 9 }));
  ok(d.frequency === 'daily' && d.weekday === null && d.dayOfMonth === null, 'actions: daily => weekday/dayOfMonth null (ignores stray input)');
  const dn = actions.normalizeRuleInput(basePayload({ repeatCount: 4 }));
  ok(dn.frequency === 'daily' && dn.endConditionType === 'after_count' && dn.maxOccurrences === 4, 'actions: daily + repeatCount 4');
  let threw = null;
  try { actions.normalizeRuleInput(basePayload({ frequency: 'yearly' })); } catch (e) { threw = e.code; }
  ok(threw === 'RECURRENCE_FREQUENCY_INVALID', 'actions: yearly rejected');
})();

/* ---- 6. computeNextRunDateKey — daily rule ---------------------------- */
(function () {
  const todayVn = new Date(Date.now() + 7 * 3600 * 1000);
  const todayKey = todayVn.getUTCFullYear() + '-' + String(todayVn.getUTCMonth() + 1).padStart(2, '0') + '-' + String(todayVn.getUTCDate()).padStart(2, '0');
  const rule = {
    status: 'active', frequency: 'daily', weekday: null, day_of_month: null,
    anchor_date: '2026-01-01', end_condition_type: 'never', end_date: null,
    max_occurrences: null, generated_future_count: 0, last_generated_date: null,
  };
  const next = actions.computeNextRunDateKey(rule);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(next), 'actions: daily computeNextRunDateKey returns a real date (not null / not a throw)');
  const next2 = actions.computeNextRunDateKey(Object.assign({}, rule, { anchor_date: todayKey }));
  ok(next2 === todayKey, 'actions: daily rule anchored today -> next run today');
})();

/* ---- 7. frontend — buildRecurrencePayload + validate + section (jsdom) - */
(function () {
  const code = fs.readFileSync(path.join(ROOT, 'assets/js/task/phf-task-app.js'), 'utf8');
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/hv/task/tao' });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = function () { return 'admin'; };
  window.phfGetCurrentUser = function () { return { fullName: 'Test', email: 't@test' }; };
  window.phfNavigate = function () {};
  window.phfToast = function () {};
  window.eval(code);
  const T = window.__PHF_TASK_TEST__;

  const form = { title: 'CV', content: '', category_code: 'C', priority: 'thuong', primary_employee_code: 'NV1', related_employee_codes: [] };
  const p = T.buildRecurrencePayload(form, { mode: 'daily', weekday: 'T4', day_of_month: '9', start_date: '2026-09-05', start_time: '06:15' });
  ok(p.frequency === 'daily' && p.weekday === undefined && p.day_of_month === undefined, 'FE: daily payload carries no weekday / day_of_month');
  ok(p.start_date === '2026-09-05' && p.start_time === '06:15' && p.duration_days === 1, 'FE: daily payload start date/time + duration_days=1');

  ok(T.validateTaskRecurrenceInput({ mode: 'daily', start_date: '2026-09-05', start_time: '06:15' }) === '', 'FE: valid daily passes client check');
  ok(!!T.validateTaskRecurrenceInput({ mode: 'daily', start_date: '', start_time: '06:15' }), 'FE: daily still needs a start date');
  ok(!!T.validateTaskRecurrenceInput({ mode: 'yearly', start_date: '2026-09-05', start_time: '06:15' }), 'FE: yearly still rejected');

  const st = T.getState();
  st.form = T.defaultTaskForm();
  st.form.recurrence.mode = 'daily';
  const html = T.taskRecurrenceSectionHtml();
  ok(/data-task-recurrence-mode="daily"/.test(html) && /Hàng ngày/.test(html), 'FE: section exposes the "Hàng ngày" segment');
  ok(/data-task-recurrence-field="start_date"/.test(html) && !/data-task-recurrence-field="weekday"/.test(html) && !/data-task-recurrence-field="day_of_month"/.test(html), 'FE: daily section shows start date only, no weekday / day picker');
  ok(T.taskRecurrenceFrequencyLabel({ frequency: 'daily' }) === 'Hàng ngày', 'FE: taskRecurrenceFrequencyLabel(daily) = "Hàng ngày"');
})();

console.log('PHF Task Recurrence DAILY V1: ' + pass + '/' + pass + ' PASS');
