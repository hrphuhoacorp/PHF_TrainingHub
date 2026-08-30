'use strict';

/*
 * PHF Task — Report/Dashboard V1 backend aggregation engine (Report-03).
 *
 * NO permission policy defined here — every query is bounded by
 * resolveAuthorizedTaskScope() (task-core.js), the SAME resolver listTasks()
 * itself uses (extracted once, Report-02 mục 2 — no 3rd duplicate of that
 * branching). REPORT_SET(actor) ⊆ AUTHORIZED_TASK_SET(actor) holds by
 * construction: every query below carries that resolved constraint as a
 * hard WHERE, never a post-hoc filter.
 *
 * Grain discipline (Report-02 mục COUNTING_GRAINS, BR-11 LOCKED):
 *   TASK-GRAIN        — task_tasks rows, one per task. Backs every core KPI.
 *   PERSON-TASK-GRAIN  — task_assignees rows. Backs workload only. Fan-out
 *                        (1 task, N assignees) is CORRECT here, never used
 *                        for task counts.
 *   EVENT-GRAIN        — task_events rows. Backs completion attribution,
 *                        reopen counts. Independent of the other two grains.
 * These are always queried SEPARATELY — never one fan-out join serving all
 * three (that's exactly the double-counting risk Report-01/02 flagged).
 *
 * Aggregation approach: PostgREST (Supabase's REST layer) has no GROUP BY in
 * its query-builder API — only single-value count()/head requests. Getting
 * true SQL-level GROUP BY without a migration would require a new RPC/view,
 * forbidden this gate. So: fetch the COMPLETE authorized+filtered task-grain
 * population per request (bounded at 5000 — the same bound listTasks()
 * already uses internally for its own assignee-resolution query, not a new
 * arbitrary number, and NOT the 200-row UI-pagination cap Report-01
 * rejected for aggregation), then aggregate exactly in Node. This is
 * numerically EXACT for V1's real data volume — never truncated/approximate
 * — and never ships raw rows to the browser (only the aggregate numbers
 * cross the API boundary). Flagged in the Report-03 report as a scale
 * boundary for a future gate (composite indexes / a real RPC), not a
 * correctness gap today.
 *
 * KPI/drilldown invariant (Report-02 mục 18): every metric_id's row-level
 * predicate is a SINGLE function in METRIC_PREDICATES, applied identically
 * by both the aggregation path (count) and the drilldown path (list) — so
 * "KPI count == drilldown total_count" holds by construction, not by two
 * independently-written queries hoped to agree.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { resolveActorContext, loadOrgRows } = require('./task-employee-scope');
const { resolveEffectiveTaskScopeForActorContext } = require('./task-permissions');
const {
  resolveAuthorizedTaskScope,
  TASK_LIST_RELATIONS,
  TASK_LIST_SCOPES,
  TASKS_TABLE,
  ASSIGNEES_TABLE,
  EVENTS_TABLE,
  CATEGORIES_TABLE
} = require('./task-core');

const configured = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const supabase = configured
  ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

const REPORT_CONTRACT_VERSION = 1;
const TASK_POPULATION_LIMIT = 5000; // same bound listTasks() already uses internally, not a new number
const DRILLDOWN_LIMIT_MAX = 100;    // separate, smaller page-size cap for list UI — not the population bound above
const ICT_OFFSET_MS = 7 * 3600 * 1000; // Asia/Ho_Chi_Minh, fixed UTC+7, no DST — same convention already proven in Calendar V1.2/Timeline V1

function text(value) { return String(value == null ? '' : value).trim(); }
function code(value) { return text(value).toUpperCase(); }
function fail(message, statusCode, errorCode) {
  const e = new Error(message);
  e.statusCode = statusCode || 400;
  e.code = errorCode || 'TASK_REPORT_INVALID';
  throw e;
}
function ensureDb() { if (!supabase) fail('Supabase chưa được cấu hình cho PHF Task Report.', 503, 'SUPABASE_NOT_CONFIGURED'); }
function throwDb(error) {
  if (!error) return;
  const errCode = text(error.code);
  const message = text(error.message);
  if (errCode === 'PGRST205' || errCode === '42P01' || /relation .* does not exist/i.test(message) || /Could not find the table/i.test(message)) {
    fail('Schema PHF Task Report chưa sẵn sàng.', 503, 'TASK_SCHEMA_MISSING');
  }
  fail('Lỗi hệ thống PHF Task Report: ' + message, 500, 'TASK_REPORT_DB_ERROR');
}

// ---------------------------------------------------------------------------
// PERIOD CONTRACT — Report-02 mục 6, BR-04. Half-open [start, endExclusive).
// Client sends {type, anchor_date} ONLY — never raw start/end (Report-02
// rationale: arbitrary client-supplied ranges could straddle timezone
// boundaries inconsistently across components; a canonical {type, anchor}
// pair is fully server-resolved, zero ambiguity).
// ---------------------------------------------------------------------------
const PERIOD_TYPES = new Set(['day', 'week', 'month', 'year']);

function parseAnchorDate(anchorDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(anchorDate));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return { y, mo, d };
}
// ICT midnight of (y, mo, d) expressed as a UTC instant. Date.UTC() normalizes
// out-of-range day/month components exactly like the Date constructor
// (e.g. day=32 rolls into next month) — safe to pass d+1/mo+1 directly.
function ictMidnightUtcMs(y, mo, d) {
  return Date.UTC(y, mo - 1, d, 0, 0, 0) - ICT_OFFSET_MS;
}
// Weekday of a Y-M-D calendar date is timezone-independent pure calendar
// arithmetic (2026-08-25 is a Tuesday regardless of timezone) — safe to
// compute via a UTC-anchored probe Date.
function mondayOffsetFromDate(y, mo, d) {
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  return (dow + 6) % 7; // days since Monday
}
function resolvePeriodWindow(periodType, anchorDate) {
  const type = text(periodType);
  if (!PERIOD_TYPES.has(type)) fail('period_type không hợp lệ.', 400, 'TASK_REPORT_PERIOD_TYPE_INVALID');
  const parsed = parseAnchorDate(anchorDate);
  if (!parsed) fail('anchor_date không hợp lệ.', 400, 'TASK_REPORT_PERIOD_ANCHOR_INVALID');
  const { y, mo, d } = parsed;
  let startMs, endMs;
  if (type === 'day') {
    startMs = ictMidnightUtcMs(y, mo, d);
    endMs = ictMidnightUtcMs(y, mo, d + 1);
  } else if (type === 'week') {
    // BR-04 LOCKED: Monday -> Sunday (window end exclusive = next Monday).
    const offset = mondayOffsetFromDate(y, mo, d);
    startMs = ictMidnightUtcMs(y, mo, d - offset);
    endMs = ictMidnightUtcMs(y, mo, d - offset + 7);
  } else if (type === 'month') {
    startMs = ictMidnightUtcMs(y, mo, 1);
    endMs = ictMidnightUtcMs(y, mo + 1, 1);
  } else {
    startMs = ictMidnightUtcMs(y, 1, 1);
    endMs = ictMidnightUtcMs(y + 1, 1, 1);
  }
  return { type, start: new Date(startMs).toISOString(), endExclusive: new Date(endMs).toISOString(), timezone: 'Asia/Ho_Chi_Minh' };
}
function inWindow(iso, period) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= new Date(period.start).getTime() && t < new Date(period.endExclusive).getTime();
}

// ---------------------------------------------------------------------------
// REPORT CONTEXT — resolved ONCE per request, threaded into every query in
// that request (summary/category/person/trend/drilldown all share the SAME
// instance — never re-resolved per sub-query).
// ---------------------------------------------------------------------------
async function resolveReportContext(session, input) {
  ensureDb();
  const params = input || {};
  const actorContext = await resolveActorContext(session);
  const { scope } = await resolveEffectiveTaskScopeForActorContext(actorContext);
  const relation = text(params.relation);
  if (!TASK_LIST_RELATIONS.has(relation)) fail('Góc nhìn (relation) không hợp lệ.', 400, 'TASK_LIST_RELATION_INVALID');
  const scopeParam = TASK_LIST_SCOPES.has(text(params.scope)) ? text(params.scope) : '';
  const periodInput = params.period || {};
  const period = resolvePeriodWindow(periodInput.type, periodInput.anchor_date);
  const categoryCode = params.category_code ? code(params.category_code) : '';
  const employeeCode = params.employee_code ? code(params.employee_code) : '';
  const authorizedScope = await resolveAuthorizedTaskScope(actorContext, scope, relation, scopeParam);
  return { actorContext, scope, relation, scopeParam, period, categoryCode, employeeCode, authorizedScope };
}

// ---------------------------------------------------------------------------
// TASK-GRAIN fetch — the ONLY place task_tasks is queried for report
// purposes. Bounded, complete (not paginated/truncated) for the authorized+
// filtered population. Category filter applied here (server-side, not a
// client-side narrowing of an already-fetched broader set).
// ---------------------------------------------------------------------------
async function fetchAuthorizedTaskRows(ctx) {
  if (ctx.authorizedScope.mode === 'empty') return [];
  let q = supabase.from(TASKS_TABLE).select('*').eq('flow_type', ctx.authorizedScope.flowType);
  if (ctx.authorizedScope.mode === 'assignee_in') {
    q = q.in('id', ctx.authorizedScope.taskIds);
    if (ctx.authorizedScope.excludeDraft) q = q.neq('status', 'draft');
    if (ctx.authorizedScope.crossDepartmentOnly) q = q.eq('is_cross_department', true);
  } else {
    // creator_eq — exact creator identity of THIS actor (see task-core.js
    // listTasks()): employee identity when present, account identity for an
    // account-only actor (Admin without an employee profile). Never a wildcard.
    const creatorEmp = code(ctx.authorizedScope.creatorEmployeeCode);
    const creatorAcct = text(ctx.authorizedScope.creatorAccountId);
    if (creatorEmp) q = q.eq('created_by_employee_code', creatorEmp);
    else if (creatorAcct) q = q.eq('created_by_account_id', creatorAcct);
    else return [];
  }
  if (ctx.categoryCode) q = q.eq('category_code', ctx.categoryCode);
  const { data, error } = await q.limit(TASK_POPULATION_LIMIT);
  if (error) throwDb(error);
  return data || [];
}

function isOverdueRow(task, nowMs) {
  return (task.status === 'published' || task.status === 'in_progress') && !!task.deadline && new Date(task.deadline).getTime() < nowMs;
}

// ---------------------------------------------------------------------------
// METRIC PREDICATES — canonical, single source of truth per metric_id.
// Same functions back both aggregation (counted) and drilldown (listed).
// completed_on_time/completed_late are NOT here — they need an async
// EVENT-GRAIN join (final completion event) and are computed by
// resolveFinalCompletionOutcomes() below, shared the same way.
// ---------------------------------------------------------------------------
const METRIC_IDS = new Set(['created_in_period', 'not_started', 'in_progress', 'completed_in_period', 'completed_on_time', 'completed_late', 'currently_overdue', 'average_progress']);
const SYNC_METRIC_PREDICATES = {
  created_in_period: (t, ctx) => inWindow(t.created_at, ctx.period),
  not_started: (t) => t.status === 'published',
  in_progress: (t, ctx) => t.status === 'in_progress' && !isOverdueRow(t, ctx.nowMs),
  currently_overdue: (t, ctx) => isOverdueRow(t, ctx.nowMs),
  completed_in_period: (t, ctx) => t.status === 'completed' && inWindow(t.completed_at, ctx.period)
};

// ---------------------------------------------------------------------------
// FINAL COMPLETION INTEGRITY (mục 6, BR-05) — for a task currently
// status='completed', task.completed_at IS the final completion timestamp
// BY CONSTRUCTION (task_complete RPC sets completed_at+inserts the
// 'completion' event atomically; task_reopen RPC unconditionally nulls
// completed_at+inserts 'reopen' atomically — no code path can leave a stale
// completed_at on a currently-completed row). The event carries the actor
// and the on_time flag the row itself doesn't have. Cross-checked, not
// blindly trusted: if the latest 'completion' event's payload.completed_at
// doesn't match the row within a small clock-precision tolerance, the task
// is EXCLUDED from on_time/late/attribution and flagged in
// data_integrity_warnings — never silently guessed, never DB-mutated.
// ---------------------------------------------------------------------------
const COMPLETION_MISMATCH_TOLERANCE_MS = 2000;

async function fetchLatestCompletionEvents(taskIds) {
  if (!taskIds.length) return new Map();
  const { data, error } = await supabase.from(EVENTS_TABLE).select('*').in('task_id', taskIds).eq('event_type', 'completion').order('occurred_at', { ascending: false });
  if (error) throwDb(error);
  const map = new Map();
  (data || []).forEach(e => { if (!map.has(e.task_id)) map.set(e.task_id, e); }); // first occurrence per task_id = latest, since ordered desc
  return map;
}
function crossCheckFinalCompletion(task, event) {
  if (!event || !event.payload || !event.payload.completed_at) return { ok: false, reason: 'MISSING_COMPLETION_EVENT' };
  const rowMs = new Date(task.completed_at).getTime();
  const eventMs = new Date(event.payload.completed_at).getTime();
  if (!Number.isFinite(rowMs) || !Number.isFinite(eventMs) || Math.abs(rowMs - eventMs) > COMPLETION_MISMATCH_TOLERANCE_MS) {
    return { ok: false, reason: 'COMPLETION_EVENT_MISMATCH' };
  }
  return { ok: true, event };
}
// Returns { onTimeTasks, lateTasks, warnings, eventByTaskId } for the given
// completed-in-period task rows. Shared by summary/category aggregation AND
// drilldown for completed_on_time/completed_late — same function, not two
// hand-rolled implementations (KPI/drilldown invariant).
async function resolveFinalCompletionOutcomes(completedInPeriodTasks) {
  const taskIds = completedInPeriodTasks.map(t => t.id);
  const eventByTaskId = await fetchLatestCompletionEvents(taskIds);
  const onTimeTasks = [], lateTasks = [], warnings = [];
  completedInPeriodTasks.forEach(t => {
    const check = crossCheckFinalCompletion(t, eventByTaskId.get(t.id));
    if (!check.ok) { warnings.push({ task_id: t.id, task_code: t.task_code, reason: check.reason }); return; }
    const onTime = check.event.payload.on_time === true;
    (onTime ? onTimeTasks : lateTasks).push(t);
  });
  return { onTimeTasks, lateTasks, warnings, eventByTaskId };
}

// ---------------------------------------------------------------------------
// SUMMARY — getTaskReportSummary
// ---------------------------------------------------------------------------
async function getTaskReportSummary(session, input) {
  const ctx = await resolveReportContext(session, input);
  const rows = await fetchAuthorizedTaskRows(ctx);
  const nowMs = Date.now();
  const predicateCtx = { period: ctx.period, nowMs };

  const counts = { created_in_period: 0, not_started: 0, in_progress: 0, currently_overdue: 0 };
  let activeProgressSum = 0, activeProgressCount = 0;
  const completedInPeriodTasks = [];
  rows.forEach(t => {
    if (SYNC_METRIC_PREDICATES.created_in_period(t, predicateCtx)) counts.created_in_period++;
    if (SYNC_METRIC_PREDICATES.not_started(t, predicateCtx)) counts.not_started++;
    if (SYNC_METRIC_PREDICATES.in_progress(t, predicateCtx)) counts.in_progress++;
    if (SYNC_METRIC_PREDICATES.currently_overdue(t, predicateCtx)) counts.currently_overdue++;
    if (t.status === 'published' || t.status === 'in_progress') { activeProgressSum += Number(t.progress_percent) || 0; activeProgressCount++; }
    if (SYNC_METRIC_PREDICATES.completed_in_period(t, predicateCtx)) completedInPeriodTasks.push(t);
  });

  const { onTimeTasks, lateTasks, warnings } = await resolveFinalCompletionOutcomes(completedInPeriodTasks);
  const onTimeRateDenominator = onTimeTasks.length + lateTasks.length;

  // Attention V1 (mục 7 / BR locked thresholds): due_soon=3 days, stale=7
  // days, reopen_count = raw only (no boolean flag — locked decision C).
  const activeRows = rows.filter(t => t.status === 'published' || t.status === 'in_progress');
  const DUE_SOON_MS = 3 * 86400000, STALE_MS = 7 * 86400000;
  const dueSoonCount = activeRows.filter(t => {
    if (isOverdueRow(t, nowMs) || !t.deadline) return false;
    const diff = new Date(t.deadline).getTime() - nowMs;
    return diff > 0 && diff <= DUE_SOON_MS;
  }).length;
  const staleCount = activeRows.filter(t => {
    const ref = t.last_progress_at || t.created_at;
    return !ref || (nowMs - new Date(ref).getTime()) > STALE_MS;
  }).length;
  const reopenCountByTask = await fetchReopenCounts(activeRows.map(t => t.id));
  const totalReopenCount = Array.from(reopenCountByTask.values()).reduce((a, b) => a + b, 0);

  return {
    report_contract_version: REPORT_CONTRACT_VERSION,
    period: ctx.period,
    metrics: {
      created_in_period: { metric_id: 'created_in_period', value: counts.created_in_period, kind: 'period_flow' },
      not_started: { metric_id: 'not_started', value: counts.not_started, kind: 'current_state' },
      in_progress: { metric_id: 'in_progress', value: counts.in_progress, kind: 'current_state' },
      completed_in_period: { metric_id: 'completed_in_period', value: completedInPeriodTasks.length, kind: 'period_flow' },
      completed_on_time: { metric_id: 'completed_on_time', value: onTimeTasks.length, kind: 'period_flow' },
      completed_late: { metric_id: 'completed_late', value: lateTasks.length, kind: 'period_flow' },
      currently_overdue: { metric_id: 'currently_overdue', value: counts.currently_overdue, kind: 'current_state', period_relevance: 'none' },
      average_progress: { metric_id: 'average_progress', value: activeProgressCount ? (activeProgressSum / activeProgressCount) : null, kind: 'current_state', population: 'active_only' },
      on_time_rate: { value: onTimeRateDenominator ? (onTimeTasks.length / onTimeRateDenominator) : null, kind: 'derived', numerator: 'completed_on_time', denominator: 'completed_on_time+completed_late' }
    },
    attention: {
      currently_overdue_count: counts.currently_overdue,
      due_soon_count: dueSoonCount,
      due_soon_threshold_days: 3,
      stale_count: staleCount,
      stale_threshold_days: 7,
      reopen_count_total: totalReopenCount
    },
    data_integrity_warnings: warnings
  };
}

async function fetchReopenCounts(taskIds) {
  if (!taskIds.length) return new Map();
  const { data, error } = await supabase.from(EVENTS_TABLE).select('task_id').in('task_id', taskIds).eq('event_type', 'reopen');
  if (error) throwDb(error);
  const map = new Map();
  (data || []).forEach(e => map.set(e.task_id, (map.get(e.task_id) || 0) + 1));
  return map;
}

// ---------------------------------------------------------------------------
// CATEGORY ANALYSIS — getTaskReportCategoryAnalysis
// ---------------------------------------------------------------------------
async function getTaskReportCategoryAnalysis(session, input) {
  const ctx = await resolveReportContext(session, input);
  const rows = await fetchAuthorizedTaskRows(ctx); // ctx.categoryCode, if set, already narrows this — matches drilldown behavior
  const nowMs = Date.now();
  const predicateCtx = { period: ctx.period, nowMs };

  const byCategory = new Map();
  rows.forEach(t => {
    const key = code(t.category_code);
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(t);
  });
  if (!byCategory.size) return { report_contract_version: REPORT_CONTRACT_VERSION, period: ctx.period, categories: [] };

  const categoryCodes = Array.from(byCategory.keys());
  const { data: categoryRows, error: catError } = await supabase.from(CATEGORIES_TABLE).select('category_code,display_name,is_active').in('category_code', categoryCodes);
  if (catError) throwDb(catError);
  const categoryInfoByCode = new Map((categoryRows || []).map(c => [code(c.category_code), c]));

  const allCompletedInPeriod = [];
  const perCategoryComputed = categoryCodes.map(catCode => {
    const catRows = byCategory.get(catCode);
    const counts = { created_in_period: 0, not_started: 0, in_progress: 0, currently_overdue: 0 };
    let progressSum = 0, progressCount = 0;
    const completedInPeriodTasks = [];
    catRows.forEach(t => {
      if (SYNC_METRIC_PREDICATES.created_in_period(t, predicateCtx)) counts.created_in_period++;
      if (SYNC_METRIC_PREDICATES.not_started(t, predicateCtx)) counts.not_started++;
      if (SYNC_METRIC_PREDICATES.in_progress(t, predicateCtx)) counts.in_progress++;
      if (SYNC_METRIC_PREDICATES.currently_overdue(t, predicateCtx)) counts.currently_overdue++;
      if (t.status === 'published' || t.status === 'in_progress') { progressSum += Number(t.progress_percent) || 0; progressCount++; }
      if (SYNC_METRIC_PREDICATES.completed_in_period(t, predicateCtx)) { completedInPeriodTasks.push(t); allCompletedInPeriod.push(t); }
    });
    return { catCode, counts, progressSum, progressCount, completedInPeriodTasks };
  });

  const { onTimeTasks, lateTasks, warnings } = await resolveFinalCompletionOutcomes(allCompletedInPeriod);
  const onTimeIds = new Set(onTimeTasks.map(t => t.id)), lateIds = new Set(lateTasks.map(t => t.id));

  const categories = perCategoryComputed.map(entry => {
    const info = categoryInfoByCode.get(entry.catCode);
    const onTimeCount = entry.completedInPeriodTasks.filter(t => onTimeIds.has(t.id)).length;
    const lateCount = entry.completedInPeriodTasks.filter(t => lateIds.has(t.id)).length;
    return {
      category_code: entry.catCode,
      display_name: info ? info.display_name : entry.catCode, // FK-protected — resolvable even if category later deactivated; falls back to code only if truly unresolvable (shouldn't happen given the FK)
      is_active: info ? info.is_active === true : null,
      metrics: {
        created_in_period: { metric_id: 'created_in_period', value: entry.counts.created_in_period, kind: 'period_flow' }, // BR locked headline
        not_started: { metric_id: 'not_started', value: entry.counts.not_started, kind: 'current_state' },
        in_progress: { metric_id: 'in_progress', value: entry.counts.in_progress, kind: 'current_state' },
        completed_in_period: { metric_id: 'completed_in_period', value: entry.completedInPeriodTasks.length, kind: 'period_flow' },
        completed_on_time: { metric_id: 'completed_on_time', value: onTimeCount, kind: 'period_flow' },
        completed_late: { metric_id: 'completed_late', value: lateCount, kind: 'period_flow' },
        currently_overdue: { metric_id: 'currently_overdue', value: entry.counts.currently_overdue, kind: 'current_state', period_relevance: 'none' },
        average_progress: { metric_id: 'average_progress', value: entry.progressCount ? (entry.progressSum / entry.progressCount) : null, kind: 'current_state', population: 'active_only' }
      }
    };
  });

  return { report_contract_version: REPORT_CONTRACT_VERSION, period: ctx.period, categories, data_integrity_warnings: warnings };
}

// ---------------------------------------------------------------------------
// PERSON ANALYSIS (workload + performance) — getTaskReportPersonAnalysis
// Separate grains/queries per Report-02 mục 9/10 — never mixed.
// ---------------------------------------------------------------------------
function classifyInvolvement(task, assigneeRow) {
  const creator = code(task.created_by_employee_code);
  const employee = code(assigneeRow.employee_code);
  if (assigneeRow.role === 'primary') return employee === creator ? 'self' : 'assigned';
  return 'coordinator'; // role === 'related'
}

async function fetchActiveAssignees(taskIds) {
  if (!taskIds.length) return [];
  const { data, error } = await supabase.from(ASSIGNEES_TABLE).select('*').in('task_id', taskIds).eq('is_active', true);
  if (error) throwDb(error);
  return data || [];
}

function getPersonWorkload(rows, assigneeRows, peopleByCode) {
  if (!rows.length) return [];
  const taskById = new Map(rows.map(t => [t.id, t]));

  const byEmployee = new Map();
  (assigneeRows || []).forEach(a => {
    const task = taskById.get(a.task_id);
    if (!task) return; // assignee row for a task outside this population (e.g. category-filtered out) — never surfaced
    const involvement = classifyInvolvement(task, a);
    const employeeCode = code(a.employee_code);
    if (!byEmployee.has(employeeCode)) byEmployee.set(employeeCode, { employee_code: employeeCode, total: 0, primary_count: 0, coordinator_count: 0, self_task_count: 0, breakdown: [] });
    const bucket = byEmployee.get(employeeCode);
    bucket.total++;
    if (involvement === 'coordinator') bucket.coordinator_count++; else bucket.primary_count++;
    if (involvement === 'self') bucket.self_task_count++;
    bucket.breakdown.push({
      task_id: task.id, task_code: task.task_code, title: task.title,
      workload_role: involvement === 'coordinator' ? 'coordinator' : 'primary',
      self_task: involvement === 'self',
      status: task.status, deadline: task.deadline
    });
  });

  return Array.from(byEmployee.values()).map(bucket => {
    const person = peopleByCode.get(bucket.employee_code);
    return Object.assign({ full_name: person ? person.fullName : '', department: person ? person.department : '' }, bucket);
  });
}

// self_task_computed may already be attached (getTaskReportPersonAnalysis
// flags the full `rows` array once, up front, before filtering) — only
// fetch active assignees again if it genuinely isn't there yet (the
// listTaskReportDrilldown caller passes unflagged task-grain rows).
async function ensureSelfTaskFlags(rows) {
  if (!rows.length || rows.every(t => typeof t.self_task_computed === 'boolean')) return rows;
  const assigneeRows = await fetchActiveAssignees(rows.map(t => t.id));
  const activePrimaryByTask = new Map();
  assigneeRows.forEach(a => { if (a.role === 'primary' && a.is_active) activePrimaryByTask.set(a.task_id, code(a.employee_code)); });
  rows.forEach(t => { t.self_task_computed = activePrimaryByTask.get(t.id) === code(t.created_by_employee_code); });
  return rows;
}

// ---------------------------------------------------------------------------
// CANONICAL PERFORMANCE ATTRIBUTION (Report-04A fix) — the ONE place that
// decides "which employee does this completed task's performance count
// toward". Used by BOTH getPersonPerformance() (aggregation) AND
// listTaskReportDrilldown() (employee-scoped completion drilldown) so the
// two can never diverge again. Attribution is the FINAL completion event's
// actor_employee_code — NEVER "any active assignee" (that was the
// coordinator-leakage bug: a coordinator on a task someone else completed
// used to leak into that coordinator's employee-scoped drilldown even
// though they never appear in the Performance panel for it). Self-task is
// excluded here exactly once, matching the locked BR-02/BR-08 policy.
// ---------------------------------------------------------------------------
async function resolvePerformanceAttribution(completedInPeriodTasks) {
  await ensureSelfTaskFlags(completedInPeriodTasks);
  const { onTimeTasks, lateTasks, warnings, eventByTaskId } = await resolveFinalCompletionOutcomes(completedInPeriodTasks);
  const onTimeIds = new Set(onTimeTasks.map(t => t.id)), lateIds = new Set(lateTasks.map(t => t.id));
  const actorByTaskId = new Map();
  completedInPeriodTasks.forEach(t => {
    if (t.self_task_computed) return; // BR-02/BR-08 LOCKED: self-task excluded from performance attribution
    if (!onTimeIds.has(t.id) && !lateIds.has(t.id)) return; // mismatch-excluded, already in warnings
    const event = eventByTaskId.get(t.id);
    actorByTaskId.set(t.id, code(event.actor_employee_code));
  });
  return { actorByTaskId, onTimeTasks, lateTasks, warnings };
}

async function getPersonPerformance(ctx, rows, peopleByCode) {
  const predicateCtx = { period: ctx.period, nowMs: Date.now() };
  const completedInPeriodTasks = rows.filter(t => SYNC_METRIC_PREDICATES.completed_in_period(t, predicateCtx));
  if (!completedInPeriodTasks.length) return { people: [], warnings: [] };
  const { actorByTaskId, onTimeTasks, lateTasks, warnings } = await resolvePerformanceAttribution(completedInPeriodTasks);
  const onTimeIds = new Set(onTimeTasks.map(t => t.id)), lateIds = new Set(lateTasks.map(t => t.id));

  const byEmployee = new Map();
  actorByTaskId.forEach((actorEmployeeCode, taskId) => {
    if (!byEmployee.has(actorEmployeeCode)) byEmployee.set(actorEmployeeCode, { employee_code: actorEmployeeCode, completed_in_period: 0, completed_on_time: 0, completed_late: 0 });
    const bucket = byEmployee.get(actorEmployeeCode);
    bucket.completed_in_period++;
    if (onTimeIds.has(taskId)) bucket.completed_on_time++; else if (lateIds.has(taskId)) bucket.completed_late++;
  });

  const people = Array.from(byEmployee.values()).map(bucket => {
    const person = peopleByCode.get(bucket.employee_code);
    return Object.assign({ full_name: person ? person.fullName : '', completion_rate: 'DEFERRED' }, bucket);
  });
  return { people, warnings };
}

async function getTaskReportPersonAnalysis(session, input) {
  const ctx = await resolveReportContext(session, input);
  const rows = await fetchAuthorizedTaskRows(ctx);
  const taskIds = rows.map(t => t.id);
  const [assigneeRows, orgRows] = await Promise.all([fetchActiveAssignees(taskIds), loadOrgRows()]);
  const peopleByCode = new Map(orgRows.map(p => [code(p.employeeCode), p]));

  // self_task computed once from the SAME assignee fetch used for workload
  // (active primary row's employee_code == created_by_employee_code) —
  // reuses the identical formula listTasks() already established
  // (task-core.js self_task mapping), just recomputed here since raw
  // task_tasks rows don't carry a precomputed self_task field.
  const activePrimaryByTask = new Map();
  assigneeRows.forEach(a => { if (a.role === 'primary' && a.is_active) activePrimaryByTask.set(a.task_id, code(a.employee_code)); });
  rows.forEach(t => { t.self_task_computed = activePrimaryByTask.get(t.id) === code(t.created_by_employee_code); });

  const workload = getPersonWorkload(rows, assigneeRows, peopleByCode);
  const performance = await getPersonPerformance(ctx, rows, peopleByCode);

  return {
    report_contract_version: REPORT_CONTRACT_VERSION,
    period: ctx.period,
    workload,
    performance: performance.people,
    data_integrity_warnings: performance.warnings
  };
}

// ---------------------------------------------------------------------------
// TREND — getTaskReportTrend. DAY: no sub-day trend (trend_supported=false,
// nothing in BR-03 asks for hourly detail). WEEK: 7 daily buckets. MONTH:
// daily buckets (BR locked decision E). YEAR: 12 monthly buckets. Only
// period-flow metrics are bucketed (current-state metrics like
// currently_overdue/average_progress are not forced into historical
// buckets — semantically unsound per Report-02).
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
    // Split into ICT calendar months within [start, endExclusive).
    const startDate = new Date(startMs + ICT_OFFSET_MS); // shift to read ICT Y/M fields via UTC getters
    const y = startDate.getUTCFullYear();
    const buckets = [];
    for (let m = 0; m < 12; m++) {
      const bStart = ictMidnightUtcMs(y, m + 1, 1);
      const bEnd = ictMidnightUtcMs(y, m + 2, 1);
      buckets.push({ start: new Date(bStart).toISOString(), endExclusive: new Date(bEnd).toISOString() });
    }
    return buckets;
  }
  return [];
}

async function getTaskReportTrend(session, input) {
  const ctx = await resolveReportContext(session, input);
  if (ctx.period.type === 'day') {
    return { report_contract_version: REPORT_CONTRACT_VERSION, period: ctx.period, trend_supported: false, buckets: [] };
  }
  const rows = await fetchAuthorizedTaskRows(ctx);
  const buckets = subBucketWindows(ctx.period.type, ctx.period);
  const allCompletedForOutcomes = rows.filter(t => t.status === 'completed' && t.completed_at);
  const { onTimeTasks, lateTasks } = await resolveFinalCompletionOutcomes(allCompletedForOutcomes);
  const onTimeIds = new Set(onTimeTasks.map(t => t.id)), lateIds = new Set(lateTasks.map(t => t.id));

  const bucketed = buckets.map(b => {
    let created = 0, completed = 0, onTime = 0, late = 0;
    rows.forEach(t => {
      if (inWindow(t.created_at, b)) created++;
      if (t.status === 'completed' && inWindow(t.completed_at, b)) {
        completed++;
        if (onTimeIds.has(t.id)) onTime++;
        else if (lateIds.has(t.id)) late++;
      }
    });
    return {
      start: b.start, end_exclusive: b.endExclusive,
      created_in_period: created, completed_in_period: completed, completed_on_time: onTime, completed_late: late
    };
  });

  return { report_contract_version: REPORT_CONTRACT_VERSION, period: ctx.period, trend_supported: true, buckets: bucketed };
}

// ---------------------------------------------------------------------------
// DRILLDOWN — listTaskReportDrilldown. Reuses the SAME predicates/outcome
// resolver as aggregation (KPI/drilldown invariant).
// ---------------------------------------------------------------------------
function toDrilldownTaskShape(t) {
  return {
    task_id: t.id, task_code: t.task_code, title: t.title, status: t.status, priority: t.priority,
    deadline: t.deadline, category_code: t.category_code, progress_percent: t.progress_percent,
    primary_employee_code: null, created_by_employee_code: t.created_by_employee_code
  };
}

async function listTaskReportDrilldown(session, input) {
  const params = input || {};
  const metricId = text(params.metric_id);
  if (!METRIC_IDS.has(metricId) || metricId === 'average_progress') {
    fail('metric_id không hợp lệ hoặc không hỗ trợ drill-down.', 400, 'TASK_REPORT_METRIC_INVALID');
  }
  const ctx = await resolveReportContext(session, params);
  const rows = await fetchAuthorizedTaskRows(ctx);
  const nowMs = Date.now();
  const predicateCtx = { period: ctx.period, nowMs };

  let matched;
  let warnings = [];
  const isCompletionOutcomeMetric = metricId === 'completed_in_period' || metricId === 'completed_on_time' || metricId === 'completed_late';

  if (isCompletionOutcomeMetric && ctx.employeeCode) {
    // Report-04A fix: an employee-scoped completion drilldown (clicked from
    // the Person Performance panel) MUST use the exact same attribution
    // semantics as getPersonPerformance() — the FINAL completion event's
    // actor_employee_code, self-task excluded — never "any active assignee
    // (primary or coordinator)". Matching on "any active assignee" let a
    // mere coordinator's employee_code pull in a task someone else actually
    // completed (coordinator leakage), breaking the "Performance count ==
    // drilldown total_count" invariant. resolvePerformanceAttribution() is
    // the SAME function the aggregation path calls — never two independent
    // implementations of "who does this completion count toward".
    const completedInPeriod = rows.filter(t => SYNC_METRIC_PREDICATES.completed_in_period(t, predicateCtx));
    const attribution = await resolvePerformanceAttribution(completedInPeriod);
    warnings = attribution.warnings;
    const onTimeIds = new Set(attribution.onTimeTasks.map(t => t.id));
    const lateIds = new Set(attribution.lateTasks.map(t => t.id));
    const attributedTasks = completedInPeriod.filter(t => attribution.actorByTaskId.get(t.id) === ctx.employeeCode);
    if (metricId === 'completed_on_time') matched = attributedTasks.filter(t => onTimeIds.has(t.id));
    else if (metricId === 'completed_late') matched = attributedTasks.filter(t => lateIds.has(t.id));
    else matched = attributedTasks; // completed_in_period
  } else if (metricId === 'completed_on_time' || metricId === 'completed_late') {
    const completedInPeriod = rows.filter(t => SYNC_METRIC_PREDICATES.completed_in_period(t, predicateCtx));
    const outcome = await resolveFinalCompletionOutcomes(completedInPeriod);
    warnings = outcome.warnings;
    matched = metricId === 'completed_on_time' ? outcome.onTimeTasks : outcome.lateTasks;
  } else {
    matched = rows.filter(t => SYNC_METRIC_PREDICATES[metricId](t, predicateCtx));
  }

  // Non-completion metrics (created_in_period/not_started/in_progress/
  // currently_overdue) keep the ORIGINAL "any active assignee" employee
  // filter — this is task-grain/workload-adjacent territory, not the
  // Person Performance panel, so the coordinator-leakage fix above does not
  // apply here (no Performance-count invariant is being claimed for these).
  if (ctx.employeeCode && !isCompletionOutcomeMetric) {
    const taskIds = matched.map(t => t.id);
    if (!taskIds.length) matched = [];
    else {
      const { data: assigneeRows, error } = await supabase.from(ASSIGNEES_TABLE).select('task_id').in('task_id', taskIds).eq('is_active', true).eq('employee_code', ctx.employeeCode);
      if (error) throwDb(error);
      const allowedIds = new Set((assigneeRows || []).map(a => a.task_id));
      matched = matched.filter(t => allowedIds.has(t.id));
    }
  }

  const totalCount = matched.length;
  const limit = Math.min(DRILLDOWN_LIMIT_MAX, Math.max(1, Number(params.limit) || 50));
  const offset = Math.max(0, Math.trunc(Number(params.offset)) || 0);
  const page = matched.slice(offset, offset + limit).map(toDrilldownTaskShape);

  return {
    report_contract_version: REPORT_CONTRACT_VERSION,
    metric_id: metricId,
    total_count: totalCount,
    limit, offset,
    has_more: offset + limit < totalCount,
    tasks: page,
    data_integrity_warnings: warnings
  };
}

module.exports = {
  getTaskReportSummary,
  getTaskReportCategoryAnalysis,
  getTaskReportPersonAnalysis,
  getTaskReportTrend,
  listTaskReportDrilldown,
  // exported for targeted unit testing only:
  resolvePeriodWindow,
  isOverdueRow,
  classifyInvolvement,
  crossCheckFinalCompletion,
  resolvePerformanceAttribution,
  METRIC_IDS
};
