'use strict';

// PHF Task — RECURRENCE V1 main-app action layer (2026-08-31, LOCAL ONLY).
//
// Sits between api/data.js dispatch and api/_lib/task-recurrence-bridge.js —
// exactly the role api/_lib/task-server-integration.js plays for every other
// Task write:
//   1. resolve the authenticated identity (resolveActorContext)
//   2. run the SAME permission gate the create/assign UI already runs
//      (canAssignTaskTo — you may create a recurring Task only for someone you
//      may assign a normal Task to)
//   3. for :run — resolve the ACTIVE employee set from People Master and pass
//      it down as activePrimaryCodes; NEVER let the engine default to
//      "everyone active" in production
//   4. forward to the bridge; map/normalise nothing the engine already owns.
//
// Company PostgreSQL is the only datastore. No Supabase, no mail, no
// in-app notification, no cron — those are explicitly out of scope for V1.

const { resolveActorContext, loadOrgRows, findByCode } = require('./task-employee-scope');
const { canAssignTaskTo } = require('./task-permissions');
const datemath = require('./task-recurrence');
const {
  bridgeCreateRecurrenceRule,
  bridgeUpdateRecurrenceRule,
  bridgeTransitionRecurrenceRule,
  bridgeListRecurrenceRules,
  bridgeRunRecurrence,
} = require('./task-recurrence-bridge');

function text(v) { return String(v == null ? '' : v).trim(); }
function code(v) { return text(v).toUpperCase(); }
function fail(message, statusCode, errorCode) {
  const e = new Error(message);
  e.statusCode = statusCode || 400;
  e.code = errorCode || 'TASK_RECURRENCE_INPUT_INVALID';
  throw e;
}

// The V1 business contract exposes ONLY these frequencies in the UI — daily /
// yearly stay unreachable even though the date engine supports them.
const UI_FREQUENCIES = new Set(['weekly', 'monthly']);
const WEEKDAYS = new Set(['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']);
const DURATION_DAYS_ALLOWED = new Set([1, 2, 3, 5, 7]);
const MAX_REPEAT_COUNT = 200; // mirrors RECURRENCE_MAX_OCCURRENCES in the engine

// api/data.js dispatch hands us the whitelisted camelCase payload produced by
// taskRecurrenceInput() (title/content/categoryCode/priority/primaryEmployeeCode/
// relatedEmployeeCodes/frequency/weekday/dayOfMonth/startDate/startTime/
// durationDays/endDate/reason). Turn it into the exact shape
// services/phf-hr-api/lib/task-recurrence.js::validateRuleInput() expects.
// Anything the engine already validates (start hour range, weekday membership,
// end-date ordering, month-day 1..31, category existence) is left for the
// engine — we only shape + reject what the V1 UI contract forbids.
function normalizeRuleInput(payload) {
  const p = payload || {};
  const frequency = text(p.frequency);
  if (!UI_FREQUENCIES.has(frequency)) fail('Chu kỳ lặp không hợp lệ (chỉ hỗ trợ Hàng tuần / Hàng tháng).', 400, 'RECURRENCE_FREQUENCY_INVALID');

  const startDateKey = text(p.startDate);
  if (!datemath.isValidDateKey(startDateKey)) fail('Ngày bắt đầu không hợp lệ (yêu cầu YYYY-MM-DD).', 400, 'RECURRENCE_START_DATE_INVALID');

  const timeParts = text(p.startTime).match(/^(\d{1,2}):(\d{2})$/);
  if (!timeParts) fail('Giờ bắt đầu không hợp lệ (yêu cầu HH:MM).', 400, 'RECURRENCE_START_HOUR_INVALID');
  const startHour = Number(timeParts[1]);
  const startMinute = Number(timeParts[2]);

  // V1 keeps duration simple: a whole number of days (default 1). The engine
  // preserves whatever durationMs we pass on every generated occurrence.
  const durationDays = p.durationDays == null || p.durationDays === '' ? 1 : Number(p.durationDays);
  if (!DURATION_DAYS_ALLOWED.has(durationDays)) fail('Thời lượng mỗi lần không hợp lệ.', 400, 'RECURRENCE_DURATION_INVALID');

  const out = {
    title: text(p.title),
    content: text(p.content),
    categoryCode: code(p.categoryCode),
    priority: text(p.priority) || 'thuong',
    primaryEmployeeCode: code(p.primaryEmployeeCode),
    relatedEmployeeCodes: Array.isArray(p.relatedEmployeeCodes)
      ? Array.from(new Set(p.relatedEmployeeCodes.map(code).filter(Boolean))) : [],
    startDateKey,
    startHour,
    startMinute,
    durationMs: durationDays * 24 * 60 * 60 * 1000,
    frequency,
    weekday: null,
    dayOfMonth: null,
    endConditionType: 'never',
    endDateKey: null,
    maxOccurrences: null,
    reason: text(p.reason) || undefined,
    // FIRST-OCCURRENCE CLAIM — the Task the Full Create flow just published,
    // to be linked as occurrence #1 (create only; the engine ignores it on
    // update). Only honoured when the claim is truthful (see engine).
    initialTaskId: text(p.initialTaskId) || undefined,
  };

  if (frequency === 'weekly') {
    out.weekday = code(p.weekday);
    if (!WEEKDAYS.has(out.weekday)) fail('Thứ trong tuần không hợp lệ.', 400, 'RECURRENCE_WEEKDAY_INVALID');
  } else {
    out.dayOfMonth = Number(p.dayOfMonth);
    if (!Number.isInteger(out.dayOfMonth) || out.dayOfMonth < 1 || out.dayOfMonth > 31) {
      fail('Ngày trong tháng phải từ 1 đến 31.', 400, 'RECURRENCE_DAY_OF_MONTH_INVALID');
    }
  }

  // "Số lần lặp" (optional). Blank/null => indefinite (end_condition 'never').
  // A value => 'after_count' with N future Tasks. Positive integer only.
  const rawN = p.repeatCount;
  if (rawN !== null && rawN !== undefined && String(rawN).trim() !== '') {
    const n = Number(rawN);
    if (!Number.isInteger(n) || String(rawN).trim() !== String(n) || n < 1 || n > MAX_REPEAT_COUNT) {
      fail('Số lần lặp phải là số nguyên dương (tối đa ' + MAX_REPEAT_COUNT + ').', 400, 'RECURRENCE_MAX_OCCURRENCES_INVALID');
    }
    out.endConditionType = 'after_count';
    out.maxOccurrences = n;
  }
  return out;
}

// One place that decides "may this session manage this rule". V1: the creator,
// the current manager, or an admin. (Matches the dual-track creator/manager
// pattern the rule schema itself uses.)
function assertCanManageRule(actorContext, ruleRow) {
  if (actorContext.actorType === 'admin') return;
  const mine = (
    (actorContext.employeeCode && code(ruleRow && ruleRow.created_by_employee_code) === actorContext.employeeCode) ||
    (actorContext.employeeCode && code(ruleRow && ruleRow.manager_employee_code) === actorContext.employeeCode) ||
    (actorContext.accountId && text(ruleRow && ruleRow.created_by_account_id) === actorContext.accountId)
  );
  if (!mine) fail('Bạn không có quyền quản lý lịch lặp này.', 403, 'RECURRENCE_MANAGE_DENIED');
}

async function findRuleOrThrow(ruleId) {
  const { rules } = await bridgeListRecurrenceRules({});
  const rule = (rules || []).find((r) => r && r.id === ruleId);
  if (!rule) fail('Không tìm thấy lịch lặp.', 404, 'RECURRENCE_RULE_NOT_FOUND');
  return rule;
}

function dcol(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  return String(v).slice(0, 10);
}

// Best-effort "Lần chạy kế tiếp" for the management view — pure date math, no
// DB. Returns 'YYYY-MM-DD' or null. Paused/ended rules have no next run.
function computeNextRunDateKey(rule) {
  try {
    if (!rule || rule.status !== 'active') return null;
    // finite "Số lần lặp" already exhausted -> no next run (rule will auto-end)
    if (rule.max_occurrences !== null && rule.max_occurrences !== undefined
        && Number(rule.generated_future_count || 0) >= Number(rule.max_occurrences)) return null;
    const engineRule = rule.frequency === 'weekly'
      ? { frequency: 'weekly' }
      : { frequency: 'monthly', monthlyMode: 'fixed_day', dayOfMonth: rule.day_of_month };
    const anchor = dcol(rule.anchor_date);
    const todayKey = datemath.formatDateKey(
      new Date(Date.now() + 7 * 3600 * 1000).getUTCFullYear(),
      new Date(Date.now() + 7 * 3600 * 1000).getUTCMonth() + 1,
      new Date(Date.now() + 7 * 3600 * 1000).getUTCDate()
    );
    let cursor = datemath.firstOccurrenceDateKey(engineRule, anchor);
    const lastGen = dcol(rule.last_generated_date);
    const guard = 600;
    for (let i = 0; i < guard; i++) {
      const afterLastGen = !lastGen || datemath.compareDateKey(cursor, lastGen) > 0;
      const notPast = datemath.compareDateKey(cursor, todayKey) >= 0;
      if (afterLastGen && (notPast || !lastGen)) {
        if (rule.end_condition_type === 'on_date' && rule.end_date && datemath.compareDateKey(cursor, dcol(rule.end_date)) > 0) return null;
        return cursor;
      }
      if (rule.end_condition_type === 'on_date' && rule.end_date && datemath.compareDateKey(cursor, dcol(rule.end_date)) > 0) return null;
      cursor = datemath.nextOccurrenceDateKey(engineRule, cursor);
    }
    return null;
  } catch (_e) {
    return null;
  }
}

const FREQ_LABEL = { weekly: 'Hàng tuần', monthly: 'Hàng tháng' };
const WEEKDAY_LABEL = { T2: 'Thứ 2', T3: 'Thứ 3', T4: 'Thứ 4', T5: 'Thứ 5', T6: 'Thứ 6', T7: 'Thứ 7', CN: 'Chủ nhật' };
const STATUS_LABEL = { active: 'Đang hoạt động', paused: 'Tạm dừng', ended: 'Đã dừng' };

function toManagementView(rule, peopleByCode, actorContext) {
  const primary = peopleByCode.get(code(rule.primary_employee_code));
  let cycle = FREQ_LABEL[rule.frequency] || rule.frequency;
  if (rule.frequency === 'weekly') cycle += ' — ' + (WEEKDAY_LABEL[code(rule.weekday)] || rule.weekday);
  else if (rule.frequency === 'monthly') cycle += ' — ngày ' + rule.day_of_month;
  // "Số lần lặp" — concise ending info. remaining = N - future Tasks generated
  // (skips never counted; see engine). null max_occurrences => indefinite.
  const maxOcc = (rule.max_occurrences === null || rule.max_occurrences === undefined) ? null : Number(rule.max_occurrences);
  const generatedFuture = Number(rule.generated_future_count || 0);
  const remainingOccurrences = maxOcc === null ? null : Math.max(0, maxOcc - generatedFuture);
  if (maxOcc !== null && rule.status !== 'ended') cycle += ' · còn ' + remainingOccurrences + ' lần';
  const canManage = actorContext.actorType === 'admin'
    || code(rule.created_by_employee_code) === actorContext.employeeCode
    || code(rule.manager_employee_code) === actorContext.employeeCode;
  return {
    id: rule.id,
    title: rule.title,
    content: rule.content || '',
    category_code: code(rule.category_code),
    priority: rule.priority || 'thuong',
    related_employee_codes: Array.isArray(rule.related_employee_codes) ? rule.related_employee_codes.map(code) : [],
    primary_employee_code: code(rule.primary_employee_code),
    primary_employee_name: primary ? (primary.fullName || primary.full_name || '') : '',
    cycle,
    frequency: rule.frequency,
    weekday: rule.weekday || null,
    day_of_month: rule.day_of_month || null,
    start_time: String(rule.start_hour).padStart(2, '0') + ':' + String(rule.start_minute).padStart(2, '0'),
    anchor_date: dcol(rule.anchor_date),
    end_date: dcol(rule.end_date),
    next_run_date: computeNextRunDateKey(rule),
    generated_count: Number(rule.generated_count || 0),
    generated_future_count: generatedFuture,
    repeat_count: maxOcc,
    remaining_occurrences: remainingOccurrences,
    status: rule.status,
    status_label: STATUS_LABEL[rule.status] || rule.status,
    can_edit: canManage && rule.status !== 'ended',
    can_pause: canManage && rule.status === 'active',
    can_resume: canManage && rule.status === 'paused',
    can_stop: canManage && rule.status !== 'ended',
  };
}

// ---------------------------------------------------------------------------
// Public actions — mirror api/data.js dispatch naming (…TaskRecurrence…).
// ---------------------------------------------------------------------------

async function createTaskRecurrence(session, payload) {
  const actorContext = await resolveActorContext(session);
  const input = normalizeRuleInput(payload);
  if (!input.primaryEmployeeCode) fail('Chưa chọn người nhận chính.', 400, 'RECURRENCE_PRIMARY_REQUIRED');
  const allowed = await canAssignTaskTo(session, input.primaryEmployeeCode);
  if (!allowed) fail('Người nhận chính nằm ngoài phạm vi giao việc của bạn.', 403, 'RECURRENCE_PRIMARY_DENIED');
  return bridgeCreateRecurrenceRule(input, actorContext.employeeCode, actorContext.accountId);
}

async function updateTaskRecurrence(session, ruleId, payload) {
  const actorContext = await resolveActorContext(session);
  const rule = await findRuleOrThrow(ruleId);
  assertCanManageRule(actorContext, rule);
  const input = normalizeRuleInput(payload);
  if (!input.primaryEmployeeCode) fail('Chưa chọn người nhận chính.', 400, 'RECURRENCE_PRIMARY_REQUIRED');
  const allowed = await canAssignTaskTo(session, input.primaryEmployeeCode);
  if (!allowed) fail('Người nhận chính nằm ngoài phạm vi giao việc của bạn.', 403, 'RECURRENCE_PRIMARY_DENIED');
  return bridgeUpdateRecurrenceRule(ruleId, input, actorContext.employeeCode, actorContext.accountId);
}

async function transitionTaskRecurrence(session, ruleId, kind, reason) {
  if (kind !== 'pause' && kind !== 'resume' && kind !== 'stop') fail('Thao tác không hợp lệ.', 400, 'RECURRENCE_TRANSITION_INVALID');
  const actorContext = await resolveActorContext(session);
  const rule = await findRuleOrThrow(ruleId);
  assertCanManageRule(actorContext, rule);
  return bridgeTransitionRecurrenceRule(ruleId, kind, reason, actorContext.employeeCode, actorContext.accountId);
}
function pauseTaskRecurrence(session, ruleId, reason) { return transitionTaskRecurrence(session, ruleId, 'pause', reason); }
function resumeTaskRecurrence(session, ruleId, reason) { return transitionTaskRecurrence(session, ruleId, 'resume', reason); }
function stopTaskRecurrence(session, ruleId, reason) { return transitionTaskRecurrence(session, ruleId, 'stop', reason); }

async function listTaskRecurrence(session, filter) {
  const actorContext = await resolveActorContext(session);
  const f = { status: (filter && filter.status) || undefined };
  // Non-admin only ever sees the rules they created OR manage — the SAME
  // ownership test assertCanManageRule() uses. We fetch unfiltered and narrow
  // in-process (rule set is small) so a manager who is not the creator still
  // sees the rules they are authorised to manage; a plain employee still sees
  // only their own. Admin sees all.
  const [{ rules }, orgRows] = await Promise.all([bridgeListRecurrenceRules(f), loadOrgRows()]);
  const peopleByCode = new Map((orgRows || []).map((r) => [code(r.employeeCode), r]));
  let visible = rules || [];
  if (actorContext.actorType !== 'admin') {
    visible = visible.filter((r) =>
      code(r.created_by_employee_code) === actorContext.employeeCode ||
      code(r.manager_employee_code) === actorContext.employeeCode);
  }
  return { rules: visible.map((r) => toManagementView(r, peopleByCode, actorContext)) };
}

// :run — the idempotent scheduler entrypoint. LOCAL/manual only in V1 (VPS OS
// cron is a later explicit gate). Admin-only from the app. The ACTIVE employee
// set is resolved HERE and passed down — the engine must never default to
// "everyone active" (phf_hr has no org data of its own).
async function runTaskRecurrence(session, options) {
  const actorContext = await resolveActorContext(session);
  if (actorContext.actorType !== 'admin') fail('Chỉ Admin mới được chạy sinh phiếu lịch lặp.', 403, 'RECURRENCE_RUN_DENIED');
  const orgRows = await loadOrgRows();
  const activePrimaryCodes = (orgRows || [])
    .filter((r) => text(r.status).toLowerCase() === 'active')
    .map((r) => code(r.employeeCode))
    .filter(Boolean);
  if (!activePrimaryCodes.length) fail('Không resolve được danh sách nhân sự đang làm việc — hủy chạy để tránh sinh phiếu sai.', 409, 'RECURRENCE_ACTIVE_SET_EMPTY');
  const o = options || {};
  return bridgeRunRecurrence({
    ruleId: o.ruleId || undefined,
    activePrimaryCodes,
    activeCategoryCodes: null, // engine still validates each category against task.categories.is_active
    nowMs: Number.isFinite(Number(o.nowMs)) ? Number(o.nowMs) : undefined,
    maxCatchupPerRule: Number.isInteger(o.maxCatchupPerRule) ? o.maxCatchupPerRule : undefined,
    maxTotalPerRun: Number.isInteger(o.maxTotalPerRun) ? o.maxTotalPerRun : undefined,
  });
}

module.exports = {
  createTaskRecurrence,
  updateTaskRecurrence,
  transitionTaskRecurrence,
  pauseTaskRecurrence,
  resumeTaskRecurrence,
  stopTaskRecurrence,
  listTaskRecurrence,
  runTaskRecurrence,
  // exposed for tests
  normalizeRuleInput,
  computeNextRunDateKey,
};
