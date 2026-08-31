'use strict';

/*
 * PHF Task — Reporting V2 (Tổng quan & Báo cáo, Gate V2-R1: Tổng quan).
 *
 * FRESH implementation, native PostgreSQL — NOT a copy of task-reporting.js
 * (the old Supabase-direct engine, kept untouched, still backing "Báo cáo"
 * tab today). Only the well-tested, DB-agnostic period/date-window math is
 * re-derived here (same ICT UTC+7 convention as the old engine and
 * Calendar/Timeline V1 — a pure-function convention, not "the engine").
 *
 * ONE ENGINE for Dashboard + Tổng quan: this module is the ONLY place
 * Overview aggregation logic lives. The old "Trang chủ" static shell is
 * being replaced BY this module's output (dashboardHtml() in
 * phf-task-app.js now renders getTaskOverviewV2() data) — there is no
 * second, Dashboard-specific aggregation anywhere.
 *
 * Data source: api/_lib/task-overview-read-bridge.js -> phf-hr-api ->
 * PostgreSQL `task.*`. NEVER calls Supabase.
 *
 * Authorization: 100% delegated to the bridge's descriptor builder (which
 * calls task-core.js::resolveAuthorizedTaskEmployeeScope(), the canonical,
 * single source — see that file's header comment). This module receives an
 * ALREADY-authorized task population and only aggregates/filters it — it
 * makes no scope/permission decision of its own.
 */

const { isOverviewBridgeEnabled, bridgeFetchOverviewPopulation } = require('./task-overview-read-bridge');
const { loadOrgRows } = require('./task-employee-scope');

const REPORT_V2_CONTRACT_VERSION = 1;
const ICT_OFFSET_MS = 7 * 3600 * 1000; // Asia/Ho_Chi_Minh, fixed UTC+7, no DST — same convention as task-reporting.js/Calendar/Timeline
const DUE_SOON_MS = 3 * 86400000;
const DRILLDOWN_LIMIT_MAX = 100;
const TOP_LIST_LIMIT = 10;
const PERIOD_TYPES = new Set(['day', 'week', 'month', 'year']);
const METRIC_IDS = new Set(['open', 'overdue', 'due_soon', 'completed_in_period', 'workload']);
const UNASSIGNED_DEPARTMENT_LABEL = '(Chưa xác định)';

function text(value) { return String(value == null ? '' : value).trim(); }
function fail(message, statusCode, errorCode) {
  const e = new Error(message);
  e.statusCode = statusCode || 400;
  e.code = errorCode || 'TASK_OVERVIEW_V2_INVALID';
  throw e;
}

// ---------------------------------------------------------------------------
// PERIOD CONTRACT — same half-open [start, endExclusive) / ICT-anchored
// convention as task-reporting.js's resolvePeriodWindow(), re-derived (not
// imported — this module must never depend on the Supabase-coupled file).
// ---------------------------------------------------------------------------
function parseAnchorDate(anchorDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(anchorDate));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return { y, mo, d };
}
function ictMidnightUtcMs(y, mo, d) { return Date.UTC(y, mo - 1, d, 0, 0, 0) - ICT_OFFSET_MS; }
function mondayOffsetFromDate(y, mo, d) {
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return (dow + 6) % 7;
}
function todayIctYmd() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const map = {}; p.forEach((x) => { map[x.type] = x.value; });
  return map.year + '-' + map.month + '-' + map.day;
}
function resolvePeriodWindow(periodType, anchorDate) {
  const type = PERIOD_TYPES.has(text(periodType)) ? text(periodType) : 'month';
  const parsed = parseAnchorDate(anchorDate) || parseAnchorDate(todayIctYmd());
  const { y, mo, d } = parsed;
  let startMs, endMs;
  if (type === 'day') { startMs = ictMidnightUtcMs(y, mo, d); endMs = ictMidnightUtcMs(y, mo, d + 1); }
  else if (type === 'week') {
    const offset = mondayOffsetFromDate(y, mo, d);
    startMs = ictMidnightUtcMs(y, mo, d - offset); endMs = ictMidnightUtcMs(y, mo, d - offset + 7);
  } else if (type === 'month') { startMs = ictMidnightUtcMs(y, mo, 1); endMs = ictMidnightUtcMs(y, mo + 1, 1); }
  else { startMs = ictMidnightUtcMs(y, 1, 1); endMs = ictMidnightUtcMs(y + 1, 1, 1); }
  return { type, start: new Date(startMs).toISOString(), endExclusive: new Date(endMs).toISOString(), timezone: 'Asia/Ho_Chi_Minh' };
}
function inWindow(iso, period) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= new Date(period.start).getTime() && t < new Date(period.endExclusive).getTime();
}

// ---------------------------------------------------------------------------
// METRIC PREDICATES — LOCKED semantics (Tổng quan & Báo cáo V2, 2026-08-29
// business decision). Draft is ALREADY excluded upstream (the bridge's
// descriptor always sets excludeDraft:true for relation='received' —
// task-core.js::resolveAuthorizedTaskEmployeeScope()) — never re-checked
// here. Cancelled is NEVER matched by any predicate below (only
// published/in_progress/completed states appear in any predicate's
// condition) — included in the raw population only for status_breakdown.
// ---------------------------------------------------------------------------
function isOpenRow(t) { return t.status === 'published' || t.status === 'in_progress'; }
function isOverdueRow(t, nowMs) { return isOpenRow(t) && !!t.deadline && new Date(t.deadline).getTime() < nowMs; }
function isDueSoonRow(t, nowMs) {
  if (!isOpenRow(t) || !t.deadline) return false;
  const diff = new Date(t.deadline).getTime() - nowMs;
  return diff >= 0 && diff <= DUE_SOON_MS;
}
function isCompletedInPeriodRow(t, period) { return t.status === 'completed' && inWindow(t.completed_at, period); }
// self-task: Primary === người tạo. Cả 2 field đã có sẵn trên mỗi row (population
// executor SELECT cả created_by_employee_code lẫn primary join) — không cần
// query thêm. LOCKED: self-task tính workload, KHÔNG tính KPI performance cá
// nhân (Person analysis loại self-task khỏi completed_on_time/late/on_time_rate
// theo người — KHÔNG loại khỏi Overview/Department/Category vì đó là số liệu
// tổng hợp, không phải "performance cá nhân").
function isSelfTaskRow(t) { return !!t.primary_employee_code && t.primary_employee_code === t.created_by_employee_code; }

function predicateForMetric(metricId, ctx, nowMs) {
  if (metricId === 'open') return (t) => isOpenRow(t);
  if (metricId === 'overdue') return (t) => isOverdueRow(t, nowMs);
  if (metricId === 'due_soon') return (t) => isDueSoonRow(t, nowMs);
  // 'workload' — LOCKED: cancelled không tính workload. Không phải 1 trong 4
  // Overview KPI, nhưng dùng CÙNG cơ chế drilldown cho Person/Department/
  // Category "tổng số việc" (Primary attribution) — không tạo nhánh code
  // riêng cho "workload drilldown".
  if (metricId === 'workload') return (t) => t.status !== 'cancelled';
  return (t) => isCompletedInPeriodRow(t, ctx.period); // 'completed_in_period'
}

// ---------------------------------------------------------------------------
// CONTEXT — resolved ONCE per request (population fetch is the only network
// call), threaded into summary/breakdown/top-lists/drilldown.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// DASHBOARD FILTERS (UI/UX Step 2, 2026-08-30) — a PURE post-authorization
// narrowing of the already-authorized Overview population. Applied ONCE in
// resolveOverviewContext() so EVERY consumer (KPI summary / trend / department
// / Top-5 / drill-down) sees the SAME filtered ctx.tasks — panels can never
// silently diverge. NEVER widens scope: bridgeFetchOverviewPopulation() (the
// authorization boundary) is unchanged; we only drop rows from its result.
// Supported dims map 1:1 to fields already present on every population row
// (+ Primary's department via the org index). 'priority' is intentionally
// absent — it is not in the Overview population (task-overview-query-executor
// does not SELECT it); the frontend surfaces that as "chưa hỗ trợ", not a
// silent no-op.
// ---------------------------------------------------------------------------
const OVERVIEW_FILTER_STATUSES = new Set(['published', 'in_progress', 'completed', 'cancelled']);
function normalizeOverviewFilters(raw) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const department = text(f.department);
  const employeeCode = text(f.employee_code).toUpperCase();
  const categoryCode = text(f.category_code).toUpperCase();
  const status = OVERVIEW_FILTER_STATUSES.has(text(f.status)) ? text(f.status) : '';
  const active = !!(department || employeeCode || categoryCode || status);
  return { department, employeeCode, categoryCode, status, active };
}
async function applyOverviewFilters(tasks, rawFilters) {
  const f = normalizeOverviewFilters(rawFilters);
  if (!f.active) return { tasks, filters: f };
  const orgIndex = f.department ? await orgIndexByCode() : null;
  const filtered = tasks.filter((t) => {
    if (f.status && t.status !== f.status) return false;
    if (f.employeeCode && text(t.primary_employee_code).toUpperCase() !== f.employeeCode) return false;
    if (f.categoryCode && text(t.category_code).toUpperCase() !== f.categoryCode) return false;
    if (f.department && primaryDepartmentOf(t, orgIndex) !== f.department) return false;
    return true;
  });
  return { tasks: filtered, filters: f };
}

async function resolveOverviewContext(session, input) {
  if (!isOverviewBridgeEnabled()) {
    fail('Tổng quan (Reporting V2) chưa được bật trên môi trường này.', 503, 'TASK_OVERVIEW_V2_DISABLED');
  }
  const params = input || {};
  const periodInput = params.period || {};
  const period = resolvePeriodWindow(periodInput.type, periodInput.anchor_date);
  const { tasks, effectiveScope } = await bridgeFetchOverviewPopulation(session);
  const { tasks: filteredTasks, filters } = await applyOverviewFilters(tasks, params.filters);
  return { tasks: filteredTasks, effectiveScope, period, filters };
}

let orgIndexCache = null, orgIndexCachedAt = 0;
async function orgIndexByCode() {
  const now = Date.now();
  if (orgIndexCache && (now - orgIndexCachedAt) < 30000) return orgIndexCache;
  const rows = await loadOrgRows();
  const map = new Map();
  rows.forEach((p) => map.set(p.employeeCode, p));
  orgIndexCache = map; orgIndexCachedAt = now;
  return map;
}

// Primary's department — ALWAYS the attribution used for department grouping
// and cross-department rows (LOCKED: "kết quả chính thuộc department của
// Primary"). task.source_department/target_department stay available as a
// separate tag (is_cross_department) but never re-group a row.
function primaryDepartmentOf(t, orgIndex) {
  const person = t.primary_employee_code ? orgIndex.get(t.primary_employee_code) : null;
  return (person && person.department) ? person.department : UNASSIGNED_DEPARTMENT_LABEL;
}

function toOverviewRowShape(t, orgIndex) {
  const person = t.primary_employee_code ? orgIndex.get(t.primary_employee_code) : null;
  return {
    task_id: t.task_id, task_code: t.task_code, title: t.title, status: t.status, deadline: t.deadline,
    completed_at: t.completed_at || null, // Step 2 drawer/Top-5 "Hoàn thành dd/mm" — presentation only
    // Cross-department attribution: ALWAYS the Primary's own department (org
    // lookup by primary_employee_code) — never task.source_department/
    // target_department. Those raw fields stay available as a separate
    // dimension (is_cross_department tag) but never re-attribute the row.
    primary_employee_code: t.primary_employee_code || '',
    primary_full_name: person ? person.fullName : '',
    primary_department: person ? person.department : '',
    is_cross_department: t.is_cross_department === true,
  };
}

// ---------------------------------------------------------------------------
// SUMMARY (6 KPI slots) — getTaskOverviewV2
// ---------------------------------------------------------------------------
function computeSummary(ctx) {
  const nowMs = Date.now();
  let open = 0, overdue = 0, dueSoon = 0, completedInPeriod = 0, onTimeCount = 0, determinableCount = 0;
  ctx.tasks.forEach((t) => {
    if (isOpenRow(t)) open++;
    if (isOverdueRow(t, nowMs)) overdue++;
    if (isDueSoonRow(t, nowMs)) dueSoon++;
    if (isCompletedInPeriodRow(t, ctx.period)) {
      completedInPeriod++;
      if (t.on_time === true) { onTimeCount++; determinableCount++; }
      else if (t.on_time === false) { determinableCount++; }
    }
  });
  // completed_on_time / completed_in_period × 100 — LOCKED formula. Denominator
  // is "completed_in_period tasks whose on_time outcome is determinable" (same
  // safe-division discipline as the old engine's on_time_rate) — 0/undetermined
  // -> null, rendered as "—" client-side, never NaN/Infinity.
  const onTimeRate = determinableCount ? Math.round((onTimeCount / determinableCount) * 1000) / 10 : null;

  return {
    report_contract_version: REPORT_V2_CONTRACT_VERSION,
    period: ctx.period,
    effective_scope: ctx.effectiveScope,
    metrics: {
      open: { metric_id: 'open', value: open },
      overdue: { metric_id: 'overdue', value: overdue },
      due_soon: { metric_id: 'due_soon', value: dueSoon },
      completed_in_period: { metric_id: 'completed_in_period', value: completedInPeriod },
      on_time_rate: { value: onTimeRate },
      // "Điểm nghẽn cần chú ý" — KPI slot #6 trong KPI V1 LOCKED, nhưng KHÔNG
      // có công thức nào được LOCKED cùng đợt (khác 5 metric trên) và KHÔNG
      // nằm trong danh sách ACCEPTANCE V2-R1 cần PASS. Cố tình KHÔNG tự bịa
      // công thức — trả về value:null + needs_decision:true để UI hiện rõ
      // "Chưa xác định" thay vì 1 con số sai. Xem final report gate này.
      attention_needed: { value: null, needs_decision: true },
    },
  };
}

function statusBreakdown(ctx) {
  const nowMs = Date.now();
  const buckets = { not_started: 0, in_progress: 0, overdue: 0, completed: 0, cancelled: 0 };
  ctx.tasks.forEach((t) => {
    if (t.status === 'cancelled') { buckets.cancelled++; return; }
    if (t.status === 'completed') { buckets.completed++; return; }
    if (isOverdueRow(t, nowMs)) { buckets.overdue++; return; } // published/in_progress past deadline
    if (t.status === 'published') { buckets.not_started++; return; }
    if (t.status === 'in_progress') { buckets.in_progress++; }
  });
  return buckets;
}

async function topOverdue(ctx) {
  const nowMs = Date.now();
  const orgIndex = await orgIndexByCode();
  return ctx.tasks.filter((t) => isOverdueRow(t, nowMs))
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()) // most overdue (earliest deadline) first
    .slice(0, TOP_LIST_LIMIT).map((t) => toOverviewRowShape(t, orgIndex));
}
async function topDueSoon(ctx) {
  const nowMs = Date.now();
  const orgIndex = await orgIndexByCode();
  return ctx.tasks.filter((t) => isDueSoonRow(t, nowMs))
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()) // soonest first
    .slice(0, TOP_LIST_LIMIT).map((t) => toOverviewRowShape(t, orgIndex));
}

async function getTaskOverviewV2(session, input) {
  const ctx = await resolveOverviewContext(session, input);
  const summary = computeSummary(ctx);
  const status_breakdown = statusBreakdown(ctx);
  const [top_overdue, top_due_soon] = await Promise.all([topOverdue(ctx), topDueSoon(ctx)]);
  return Object.assign({}, summary, { status_breakdown, top_overdue, top_due_soon });
}

// ---------------------------------------------------------------------------
// GROUP AGGREGATION — canonical primitive shared by Person/Department/
// Category analysis (Báo cáo V2). ONE function, 3 different groupKeyFn —
// KHÔNG viết 3 vòng lặp tính riêng cho 3 chiều (tránh 3 công thức có thể lệch
// nhau). Cùng predicate (isOpenRow/isOverdueRow/isDueSoonRow/
// isCompletedInPeriodRow) computeSummary() đã dùng — never a 2nd definition.
//
// excludeSelfTaskFromPerformance=true CHỈ dùng cho Person analysis (LOCKED:
// "self-task không tính KPI performance cá nhân" — self-task bị loại HOÀN
// TOÀN khỏi phần completed_in_period/on_time/late của CHÍNH người đó, giữ
// đúng tinh thần "performance cá nhân" là thứ self-task không được tính vào,
// không chỉ riêng on_time_rate). Department/Category là số liệu tổng hợp,
// KHÔNG phải "performance cá nhân" — self-task vẫn tính bình thường ở đó,
// giống Overview-level on_time_rate.
// ---------------------------------------------------------------------------
function newGroupBucket() {
  return { workload: 0, open: 0, overdue: 0, due_soon: 0, completed_in_period: 0, completed_on_time: 0, completed_late: 0 };
}
function finalizeGroupBucket(key, bucket) {
  const determinable = bucket.completed_on_time + bucket.completed_late;
  return Object.assign({ key }, bucket, {
    on_time_rate: determinable ? Math.round((bucket.completed_on_time / determinable) * 1000) / 10 : null,
  });
}
function aggregateByGroup(tasks, groupKeyFn, ctx, nowMs, excludeSelfTaskFromPerformance) {
  const map = new Map();
  tasks.forEach((t) => {
    const key = groupKeyFn(t);
    if (key == null) return; // row has no Primary at all (shouldn't happen — population is always assignee_in on Primary) — skip rather than guess
    if (!map.has(key)) map.set(key, newGroupBucket());
    const bucket = map.get(key);
    // LOCKED: cancelled không tính workload. Workload = mọi task khác cancelled
    // mà người/phòng/loại này là Primary — bất kể trạng thái mở/hoàn thành.
    if (t.status !== 'cancelled') bucket.workload++;
    if (isOpenRow(t)) bucket.open++;
    if (isOverdueRow(t, nowMs)) bucket.overdue++;
    if (isDueSoonRow(t, nowMs)) bucket.due_soon++;
    if (isCompletedInPeriodRow(t, ctx.period)) {
      if (excludeSelfTaskFromPerformance && isSelfTaskRow(t)) return; // LOCKED self-task exclusion — skip entirely, not just on_time_rate
      bucket.completed_in_period++;
      if (t.on_time === true) bucket.completed_on_time++;
      else if (t.on_time === false) bucket.completed_late++;
    }
  });
  return map;
}

// ---------------------------------------------------------------------------
// PERSON ANALYSIS — getTaskReportV2PersonAnalysis. Primary attribution only
// (LOCKED: "Primary là attribution chính") — KHÔNG fan-out theo Related, nên
// 1 Task luôn cộng vào đúng 1 người, KHÔNG BAO GIỜ double-count.
// ---------------------------------------------------------------------------
async function getTaskReportV2PersonAnalysis(session, input) {
  const ctx = await resolveOverviewContext(session, input);
  const nowMs = Date.now();
  const orgIndex = await orgIndexByCode();
  const groups = aggregateByGroup(ctx.tasks, (t) => t.primary_employee_code || null, ctx, nowMs, true);
  const people = Array.from(groups.entries()).map(([employeeCode, bucket]) => {
    const person = orgIndex.get(employeeCode);
    return Object.assign(finalizeGroupBucket(employeeCode, bucket), {
      employee_code: employeeCode,
      full_name: person ? person.fullName : '',
      department: person ? person.department : UNASSIGNED_DEPARTMENT_LABEL,
    });
  }).sort((a, b) => b.workload - a.workload);
  return { report_contract_version: REPORT_V2_CONTRACT_VERSION, period: ctx.period, effective_scope: ctx.effectiveScope, people };
}

// ---------------------------------------------------------------------------
// DEPARTMENT ANALYSIS — getTaskReportV2DepartmentAnalysis. Group key =
// Primary's own department (primaryDepartmentOf) — cross-department Task
// attributed ONCE to Primary's department (LOCKED), never split to 2 rows.
// ---------------------------------------------------------------------------
async function getTaskReportV2DepartmentAnalysis(session, input) {
  const ctx = await resolveOverviewContext(session, input);
  const nowMs = Date.now();
  const orgIndex = await orgIndexByCode();
  const groups = aggregateByGroup(ctx.tasks, (t) => primaryDepartmentOf(t, orgIndex), ctx, nowMs, false);
  const departments = Array.from(groups.entries())
    .map(([department, bucket]) => Object.assign(finalizeGroupBucket(department, bucket), { department }))
    .sort((a, b) => b.workload - a.workload);
  return { report_contract_version: REPORT_V2_CONTRACT_VERSION, period: ctx.period, effective_scope: ctx.effectiveScope, departments };
}

// ---------------------------------------------------------------------------
// CATEGORY ANALYSIS — getTaskReportV2CategoryAnalysis. display_name qua
// bridgeListTaskCategories() (task-read-bridge.js) — ĐÃ PostgreSQL-native,
// ĐÃ có test riêng (test-task-read-bridge-field-parity-v1.js) — tái sử dụng
// NGUYÊN VẸN, KHÔNG viết thêm 1 endpoint category thứ 2.
// ---------------------------------------------------------------------------
async function getTaskReportV2CategoryAnalysis(session, input) {
  const ctx = await resolveOverviewContext(session, input);
  const nowMs = Date.now();
  const groups = aggregateByGroup(ctx.tasks, (t) => t.category_code || null, ctx, nowMs, false);
  let categoryInfoByCode = new Map();
  try {
    const { bridgeListTaskCategories } = require('./task-read-bridge');
    const { categories } = await bridgeListTaskCategories();
    categoryInfoByCode = new Map((categories || []).map((c) => [c.category_code, c]));
  } catch (e) { /* category display_name is presentation-only — a lookup failure must not break the report itself */ }
  const categoriesOut = Array.from(groups.entries())
    .map(([categoryCode, bucket]) => {
      const info = categoryInfoByCode.get(categoryCode);
      return Object.assign(finalizeGroupBucket(categoryCode, bucket), {
        category_code: categoryCode,
        display_name: info ? info.display_name : categoryCode,
      });
    })
    .sort((a, b) => b.workload - a.workload);
  return { report_contract_version: REPORT_V2_CONTRACT_VERSION, period: ctx.period, effective_scope: ctx.effectiveScope, categories: categoriesOut };
}

// ---------------------------------------------------------------------------
// TREND — getTaskReportV2Trend. DAY: not bucketed (trend_supported=false).
// WEEK/MONTH: daily buckets. YEAR: 12 monthly buckets. Same bucket-splitting
// idea as the old engine, re-derived (pure date math, no Supabase coupling).
// ---------------------------------------------------------------------------
function subBucketWindows(periodType, period) {
  const startMs = new Date(period.start).getTime();
  const endMs = new Date(period.endExclusive).getTime();
  if (periodType === 'week' || periodType === 'month') {
    const buckets = [];
    let cursor = startMs;
    while (cursor < endMs) {
      const next = Math.min(cursor + 86400000, endMs);
      buckets.push({ start: new Date(cursor).toISOString(), endExclusive: new Date(next).toISOString() });
      cursor = next;
    }
    return buckets;
  }
  if (periodType === 'year') {
    const startDate = new Date(startMs + ICT_OFFSET_MS);
    const y = startDate.getUTCFullYear();
    const buckets = [];
    for (let m = 0; m < 12; m++) {
      buckets.push({ start: new Date(ictMidnightUtcMs(y, m + 1, 1)).toISOString(), endExclusive: new Date(ictMidnightUtcMs(y, m + 2, 1)).toISOString() });
    }
    return buckets;
  }
  return [];
}
// overdue_in_period — tái dùng NGUYÊN VẸN isOverdueRow() đã LOCKED, chỉ thêm
// 1 chiều bucket-theo-deadline (KHÔNG phát minh semantic overdue mới: task
// hiện đang quá hạn thật, có deadline rơi vào ngày/tháng bucket đó).
function bucketTrend(tasks, buckets, nowMs) {
  return buckets.map((b) => {
    let created = 0, completed = 0, onTime = 0, late = 0, overdue = 0;
    tasks.forEach((t) => {
      if (inWindow(t.created_at, b)) created++;
      if (t.status === 'completed' && inWindow(t.completed_at, b)) {
        completed++;
        if (t.on_time === true) onTime++; else if (t.on_time === false) late++;
      }
      if (isOverdueRow(t, nowMs) && inWindow(t.deadline, b)) overdue++;
    });
    return { start: b.start, end_exclusive: b.endExclusive, created_in_period: created, completed_in_period: completed, completed_on_time: onTime, completed_late: late, overdue_in_period: overdue };
  });
}
// TIME-CONTEXT ALIGNMENT (2026-08-29) — Xu hướng dùng ĐÚNG period đang chọn
// trên Tổng quan (KHÔNG còn cửa sổ 30-ngày cố định độc lập) — cùng
// resolveOverviewContext()/period mà KPI/Department/Top5 đã dùng, 1 time-
// context duy nhất cho cả màn. Day period KHÔNG có granularity giờ trong
// kiến trúc hiện tại -> trend_supported:false (báo limitation, KHÔNG tự
// phát minh hourly data) — hành vi này vốn đã đúng LOCKED rule, không đổi.
async function getTaskReportV2Trend(session, input) {
  const ctx = await resolveOverviewContext(session, input);
  const nowMs = Date.now();

  if (ctx.period.type === 'day') {
    return { report_contract_version: REPORT_V2_CONTRACT_VERSION, period: ctx.period, effective_scope: ctx.effectiveScope, trend_supported: false, buckets: [] };
  }
  const buckets = subBucketWindows(ctx.period.type, ctx.period);
  return { report_contract_version: REPORT_V2_CONTRACT_VERSION, period: ctx.period, effective_scope: ctx.effectiveScope, trend_supported: true, buckets: bucketTrend(ctx.tasks, buckets, nowMs) };
}

// ---------------------------------------------------------------------------
// DRILLDOWN — listTaskOverviewV2Drilldown. Reuses the EXACT SAME predicate
// functions as computeSummary()/aggregateByGroup() (predicateForMetric) — KPI
// count and drilldown total_count can never diverge (same invariant the old
// engine proved for Report V1, re-established here for V2). Dùng CHUNG 1
// action cho cả Tổng quan (không filter dimension) VÀ Báo cáo V2 (filter
// employee_code/department/category_code — click từ Person/Department/
// Category table) — KHÔNG có action drilldown thứ 2.
// ---------------------------------------------------------------------------
async function listTaskOverviewV2Drilldown(session, input) {
  const params = input || {};
  const metricId = text(params.metric_id);
  if (!METRIC_IDS.has(metricId)) fail('metric_id không hợp lệ hoặc không hỗ trợ drill-down.', 400, 'TASK_OVERVIEW_V2_METRIC_INVALID');

  const ctx = await resolveOverviewContext(session, params);
  const nowMs = Date.now();
  const orgIndex = await orgIndexByCode();
  const predicate = predicateForMetric(metricId, ctx, nowMs);
  const employeeCodeFilter = text(params.employee_code).toUpperCase();
  const departmentFilter = text(params.department);
  const categoryCodeFilter = text(params.category_code).toUpperCase();
  // Person-analysis drilldown (metric_id thuộc completion) phải khớp ĐÚNG
  // self-task exclusion mà getTaskReportV2PersonAnalysis() dùng — nếu không,
  // KPI-người và drilldown-người sẽ lệch nhau (đúng invariant đã ghi ở trên).
  const excludeSelfTask = !!employeeCodeFilter && metricId === 'completed_in_period';

  const matched = ctx.tasks.filter((t) => {
    if (!predicate(t)) return false;
    if (excludeSelfTask && isSelfTaskRow(t)) return false;
    if (employeeCodeFilter && text(t.primary_employee_code).toUpperCase() !== employeeCodeFilter) return false;
    if (departmentFilter && primaryDepartmentOf(t, orgIndex) !== departmentFilter) return false;
    if (categoryCodeFilter && text(t.category_code).toUpperCase() !== categoryCodeFilter) return false;
    return true;
  });

  const totalCount = matched.length;
  const limit = Math.min(DRILLDOWN_LIMIT_MAX, Math.max(1, Number(params.limit) || 20));
  const offset = Math.max(0, Math.trunc(Number(params.offset)) || 0);
  const page = matched.slice(offset, offset + limit).map((t) => toOverviewRowShape(t, orgIndex));

  return {
    report_contract_version: REPORT_V2_CONTRACT_VERSION,
    metric_id: metricId,
    total_count: totalCount,
    limit, offset,
    has_more: offset + limit < totalCount,
    tasks: page,
  };
}

module.exports = {
  getTaskOverviewV2,
  listTaskOverviewV2Drilldown,
  getTaskReportV2PersonAnalysis,
  getTaskReportV2DepartmentAnalysis,
  getTaskReportV2CategoryAnalysis,
  getTaskReportV2Trend,
  // exported for targeted unit testing only:
  resolvePeriodWindow,
  isOpenRow,
  isOverdueRow,
  isDueSoonRow,
  isCompletedInPeriodRow,
  isSelfTaskRow,
  REPORT_V2_CONTRACT_VERSION,
};
