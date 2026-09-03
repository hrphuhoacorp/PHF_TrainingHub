'use strict';

/*
 * PHF Task — RECURRENCE V1 (company PostgreSQL `phf_hr`, schema `task`).
 *
 * PostgreSQL-only. No Supabase. No mail. No in-app notification. The only
 * hook for a future Notification/Mail phase is the canonical
 * `task.events (event_type='recurring_generated')` row this engine writes
 * once per generated Task.
 *
 * Two layers of duplicate protection (both mandatory, independent):
 *   L1  task.recurrence_occurrences UNIQUE (rule_id, occurrence_date)
 *   L2  task.tasks.create_idempotency_key = uuidv5(rule_id + '|' + occurrence_date)
 *       (deterministic — a mid-transaction crash after the task INSERT cannot
 *        double-insert on the next run).
 *
 * Reuses the pure date-math engine verbatim (task-recurrence-datemath.js,
 * a synced copy of api/_lib/task-recurrence.js — parity proven by
 * scripts/test-task-recurrence-datemath-parity-v1.js).
 *
 * Timezone: Asia/Ho_Chi_Minh (UTC+7, no DST). occurrence_date is a VN-local
 * calendar date; scheduled_start_at is the corresponding UTC instant.
 */

const crypto = require('crypto');
const { withTaskWriteTransaction } = require('./db');
const datemath = require('./task-recurrence-datemath');
const notify = require('./task-notification-emit');

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const WEEKDAYS = new Set(['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']);
// "Hàng ngày" V1 = every calendar day. The pure date-math engine models daily
// as "these weekdays" — every day is all seven. No per-weekday selection is
// exposed for daily in V1 (that is a later increment if ever needed).
const DAILY_WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const PRIORITIES = new Set(['thuong', 'quan_trong', 'khan_cap']);
// "Số lần lặp" upper bound. No lifetime cap existed before this (generateDue
// only had per-run caps). 200 ≈ ~4y weekly / ~16y monthly, inside smallint and
// the datemath 100k-iteration guard. Widened schema CHECK enforces 1..200 too.
const RECURRENCE_MAX_OCCURRENCES = 200;

function rcErr(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}
function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function upper(v) { return text(v).toUpperCase(); }
function auditToken(employeeCode, accountId) { return text(employeeCode) || text(accountId) || ''; }

// node-postgres returns a DATE column as a local-midnight JS Date. Normalise
// any DATE-column value (Date | 'YYYY-MM-DD...' | null) to a 'YYYY-MM-DD' key
// the pure date-math engine understands. Uses local getters — a local-midnight
// Date's Y/M/D is the calendar date regardless of the process timezone.
function dateColToKey(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  }
  return String(v).slice(0, 10);
}

// ---------------------------------------------------------------------------
// Timezone helpers — VN-local <-> UTC.
// ---------------------------------------------------------------------------
function vnTodayDateKey(nowMs) {
  const d = new Date((nowMs === undefined ? Date.now() : nowMs) + VN_OFFSET_MS);
  return datemath.formatDateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
function vnWallToUtcIso(dateKey, hour, minute) {
  const { year, month, day } = datemath.parseDateKey(dateKey);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - VN_OFFSET_MS).toISOString();
}
// VN-local calendar date ('YYYY-MM-DD') of a UTC instant (Date | ISO string).
function vnDateKeyOfInstant(instant) {
  const ms = instant instanceof Date ? instant.getTime() : Date.parse(instant);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms + VN_OFFSET_MS);
  return datemath.formatDateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
function occurrencePeriod(dateKey) { return dateKey.slice(0, 7); } // 'YYYY-MM'

// ---------------------------------------------------------------------------
// Deterministic UUIDv5 for the L2 task idempotency key.
// namespace: a fixed random UUID for the PHF recurrence domain.
// ---------------------------------------------------------------------------
const RECURRENCE_NS = 'b6f1c0d2-3e4a-45b6-8c7d-9e0f1a2b3c4d';
function uuidv5(name, namespace) {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = crypto.createHash('sha1').update(nsBytes).update(Buffer.from(name, 'utf8')).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function taskIdempotencyKey(ruleId, occurrenceDate) {
  return uuidv5(String(ruleId) + '|' + String(occurrenceDate), RECURRENCE_NS);
}

// ---------------------------------------------------------------------------
// Validation for rule create / update input.
// ---------------------------------------------------------------------------
function validateRuleInput(input) {
  const i = input || {};
  const out = {
    title: text(i.title),
    content: text(i.content),
    categoryCode: upper(i.categoryCode),
    priority: PRIORITIES.has(text(i.priority)) ? text(i.priority) : 'thuong',
    primaryEmployeeCode: upper(i.primaryEmployeeCode),
    relatedEmployeeCodes: Array.isArray(i.relatedEmployeeCodes)
      ? Array.from(new Set(i.relatedEmployeeCodes.map(upper).filter(Boolean))) : [],
    startDateKey: text(i.startDateKey),
    startHour: Number(i.startHour),
    startMinute: Number(i.startMinute),
    durationMs: Number(i.durationMs),
    frequency: text(i.frequency),
    weekday: i.weekday ? upper(i.weekday) : null,
    dayOfMonth: i.dayOfMonth === null || i.dayOfMonth === undefined ? null : Number(i.dayOfMonth),
    endConditionType: text(i.endConditionType) || 'never',
    endDateKey: i.endDateKey ? text(i.endDateKey) : null,
    maxOccurrences: (i.maxOccurrences === null || i.maxOccurrences === undefined || i.maxOccurrences === '') ? null : Number(i.maxOccurrences),
  };
  if (!out.title) throw rcErr('RECURRENCE_TITLE_REQUIRED');
  if (!out.categoryCode) throw rcErr('RECURRENCE_CATEGORY_REQUIRED');
  if (!out.primaryEmployeeCode) throw rcErr('RECURRENCE_PRIMARY_REQUIRED');
  if (!datemath.isValidDateKey(out.startDateKey)) throw rcErr('RECURRENCE_START_DATE_INVALID');
  if (!Number.isInteger(out.startHour) || out.startHour < 0 || out.startHour > 23) throw rcErr('RECURRENCE_START_HOUR_INVALID');
  if (!Number.isInteger(out.startMinute) || out.startMinute < 0 || out.startMinute > 59) throw rcErr('RECURRENCE_START_MINUTE_INVALID');
  if (!Number.isInteger(out.durationMs) || out.durationMs <= 0) throw rcErr('RECURRENCE_DURATION_INVALID');
  if (out.frequency !== 'daily' && out.frequency !== 'weekly' && out.frequency !== 'monthly') throw rcErr('RECURRENCE_FREQUENCY_INVALID');
  if (out.frequency === 'daily') {
    out.weekday = null;
    out.dayOfMonth = null;
  } else if (out.frequency === 'weekly') {
    if (!WEEKDAYS.has(out.weekday)) throw rcErr('RECURRENCE_WEEKDAY_INVALID');
    out.dayOfMonth = null;
  } else {
    if (!Number.isInteger(out.dayOfMonth) || out.dayOfMonth < 1 || out.dayOfMonth > 31) throw rcErr('RECURRENCE_DAY_OF_MONTH_INVALID');
    out.weekday = null;
  }
  if (out.endConditionType !== 'never' && out.endConditionType !== 'on_date' && out.endConditionType !== 'after_count') throw rcErr('RECURRENCE_END_CONDITION_INVALID');
  if (out.endConditionType === 'on_date') {
    if (!datemath.isValidDateKey(out.endDateKey)) throw rcErr('RECURRENCE_END_DATE_INVALID');
    if (datemath.compareDateKey(out.endDateKey, out.startDateKey) < 0) throw rcErr('RECURRENCE_END_BEFORE_START');
    out.maxOccurrences = null;
  } else if (out.endConditionType === 'after_count') {
    // "Số lần lặp" — N FUTURE Tasks. Positive integer only; the engine (not the
    // schema) enforces "skips do not consume N" (see generateDueForRule).
    if (!Number.isInteger(out.maxOccurrences) || out.maxOccurrences < 1 || out.maxOccurrences > RECURRENCE_MAX_OCCURRENCES) {
      throw rcErr('RECURRENCE_MAX_OCCURRENCES_INVALID');
    }
    out.endDateKey = null;
  } else {
    out.endDateKey = null;
    out.maxOccurrences = null;
  }
  // Anchor: weekly -> first date on/after start matching weekday; monthly -> start date itself.
  if (out.frequency === 'weekly') {
    let cursor = out.startDateKey;
    for (let n = 0; n < 7 && datemath.weekdayCodeOfDateKey(cursor) !== out.weekday; n++) {
      cursor = datemath.addDaysToDateKey(cursor, 1);
    }
    out.anchorDateKey = cursor;
  } else {
    out.anchorDateKey = out.startDateKey;
  }
  return out;
}

function ruleToEngineShape(row) {
  if (row.frequency === 'daily') return { frequency: 'daily', weekdays: DAILY_WEEKDAYS.slice() };
  return row.frequency === 'weekly'
    ? { frequency: 'weekly' }
    : { frequency: 'monthly', monthlyMode: 'fixed_day', dayOfMonth: row.day_of_month };
}

// ---------------------------------------------------------------------------
// "Số lần lặp" (finite repeat count) — PURE decision, no DB. maxOccurrences =
// N (the number of FUTURE Tasks to generate) or null (indefinite).
// generatedFutureCount = how many status='generated' occurrences with
// is_initial=false already exist. Skipped occurrences (pause / primary_inactive
// / category_inactive / repeat_count_reached) are NEVER in that count — that is
// the product rule: N means Tasks actually generated, not date slots elapsed.
// ---------------------------------------------------------------------------
function recurrenceCountState(maxOccurrences, generatedFutureCount) {
  const max = (maxOccurrences === null || maxOccurrences === undefined || maxOccurrences === '') ? null : Number(maxOccurrences);
  if (!Number.isInteger(max)) return { finite: false, max: null, remaining: null, exhausted: false };
  const done = Math.max(0, Math.trunc(Number(generatedFutureCount) || 0));
  return { finite: true, max, remaining: Math.max(0, max - done), exhausted: done >= max };
}

// Feature flag for the "Số lần lặp" schema patch
// (migrations/phf_hr_task_recurrence_v1_repeat_count.sql:
// recurrence_rules.max_occurrences + recurrence_occurrences.is_initial). Until
// the deployer applies it, the engine runs EXACTLY as before — no finite count,
// no is_initial marker — so every pre-existing recurrence path stays green.
// Cached for the life of the process (schema does not change under a run).
let _repeatCountSchema = null;
async function hasRepeatCountSchema(client) {
  if (_repeatCountSchema !== null) return _repeatCountSchema;
  const r = await client.query(
    `SELECT
       count(*) FILTER (WHERE table_name = 'recurrence_rules' AND column_name = 'max_occurrences')      AS a,
       count(*) FILTER (WHERE table_name = 'recurrence_occurrences' AND column_name = 'is_initial')      AS b
     FROM information_schema.columns WHERE table_schema = 'task'`
  );
  _repeatCountSchema = Number(r.rows[0].a) > 0 && Number(r.rows[0].b) > 0;
  return _repeatCountSchema;
}

async function countGeneratedFutureOccurrences(client, ruleId) {
  if (!(await hasRepeatCountSchema(client))) return 0;
  const r = await client.query(
    `SELECT count(*)::int AS n FROM task.recurrence_occurrences
      WHERE rule_id = $1 AND status = 'generated' AND is_initial = false`,
    [ruleId]
  );
  return r.rows[0].n;
}

// Auto-end a rule inside an open txn + append the 'end' history row. Returns the
// updated rule row, or null if it was already ended. Used by generation (Số
// lần lặp reached) and by updateRule (limit lowered below the count).
async function endRuleInTxn(client, ruleId, beforeRow, reason, actorAccountId, actorEmployeeCode) {
  const after = (await client.query(
    `UPDATE task.recurrence_rules SET status='ended', ended_at=now(), updated_at=now()
      WHERE id = $1 AND status <> 'ended' RETURNING *`,
    [ruleId]
  )).rows[0];
  if (!after) return null;
  await client.query(
    `INSERT INTO task.recurrence_rule_history (rule_id, action, before_data, after_data, reason, changed_by_account_id, changed_by_employee_code)
     VALUES ($1, 'end', $2::jsonb, $3::jsonb, $4, $5, $6)`,
    [ruleId, JSON.stringify(beforeRow || {}), JSON.stringify(after), reason || null, actorAccountId || null, actorEmployeeCode || null]
  );
  return after;
}

// ===========================================================================
// STORE — rule CRUD + lifecycle. Every mutating call opens its own
// withTaskWriteTransaction and writes a task.recurrence_rule_history row.
// ===========================================================================

// FIRST-OCCURRENCE CLAIM (2026-08-31) — when the Full Create flow creates a
// normal Task and THEN this rule, the Task it just published IS the rule's
// first occurrence. Passing input.initialTaskId lets createRule() claim that
// Task as occurrence #1 IN THE SAME TRANSACTION, so the scheduler never
// generates a duplicate Task for that same date.
//
// The claim is applied ONLY when it is truthful: the Task must exist, be a
// published giao_viec created by this same actor, not already belong to a
// series, AND its VN-local start date must equal the rule's computed first
// occurrence date. Otherwise the Task stays a normal standalone Task and the
// rule generates its own first occurrence later (both are then independent —
// which is correct, the user chose different dates). NO recurring_generated
// event is emitted for the initial Task — the recurrence engine did not
// create it; the occurrence row + linkage columns are the truthful audit.
async function claimInitialOccurrence(client, rule, initialTaskId, hasRepeatCount) {
  const firstDateKey = datemath.firstOccurrenceDateKey(ruleToEngineShape(rule), dateColToKey(rule.anchor_date));
  const t = await client.query(
    `SELECT id, flow_type, status, start_at, recurring_series_id,
            created_by_employee_code, created_by_account_id
       FROM task.tasks WHERE id = $1 FOR UPDATE`,
    [initialTaskId]
  );
  if (t.rowCount === 0) return { claimed: false, reason: 'task_not_found', firstDateKey };
  const task = t.rows[0];
  if (task.flow_type !== 'giao_viec') return { claimed: false, reason: 'not_giao_viec', firstDateKey };
  if (task.status !== 'published') return { claimed: false, reason: 'not_published', firstDateKey };
  if (task.recurring_series_id) return { claimed: false, reason: 'already_in_series', firstDateKey };
  const sameCreator = (
    (text(rule.created_by_employee_code) && text(task.created_by_employee_code) &&
      upper(rule.created_by_employee_code) === upper(task.created_by_employee_code)) ||
    (text(rule.created_by_account_id) && text(rule.created_by_account_id) === text(task.created_by_account_id))
  );
  if (!sameCreator) return { claimed: false, reason: 'creator_mismatch', firstDateKey };
  const taskDateKey = vnDateKeyOfInstant(task.start_at);
  if (taskDateKey !== firstDateKey) return { claimed: false, reason: 'date_mismatch', firstDateKey, taskDateKey };

  const scheduledStartIso = vnWallToUtcIso(firstDateKey, rule.start_hour, rule.start_minute);
  const ins = hasRepeatCount
    ? await client.query(
      `INSERT INTO task.recurrence_occurrences
         (rule_id, occurrence_date, occurrence_index, status, scheduled_start_at, is_catchup,
          is_initial, generated_task_id, generated_at, rule_version_at_claim)
       VALUES ($1, $2, 1, 'generated', $3, false, true, $4, now(), $5)
       ON CONFLICT (rule_id, occurrence_date) DO NOTHING
       RETURNING id`,
      [rule.id, firstDateKey, scheduledStartIso, initialTaskId, rule.rule_version]
    )
    : await client.query(
      `INSERT INTO task.recurrence_occurrences
         (rule_id, occurrence_date, occurrence_index, status, scheduled_start_at, is_catchup,
          generated_task_id, generated_at, rule_version_at_claim)
       VALUES ($1, $2, 1, 'generated', $3, false, $4, now(), $5)
       ON CONFLICT (rule_id, occurrence_date) DO NOTHING
       RETURNING id`,
      [rule.id, firstDateKey, scheduledStartIso, initialTaskId, rule.rule_version]
    );
  if (ins.rowCount === 0) return { claimed: false, reason: 'occurrence_exists', firstDateKey };
  await client.query(
    `UPDATE task.tasks
        SET recurring_series_id = $2, recurring_series_version = $3,
            scheduled_occurrence_at = $4, occurrence_period = $5
      WHERE id = $1 AND recurring_series_id IS NULL`,
    [initialTaskId, rule.id, rule.rule_version, scheduledStartIso, occurrencePeriod(firstDateKey)]
  );
  return { claimed: true, firstDateKey, occurrenceDate: firstDateKey, taskId: initialTaskId };
}

async function createRule(config, input, actor) {
  const v = validateRuleInput(input);
  const initialTaskId = text(input && input.initialTaskId) || null;
  const token = auditToken(actor && actor.employeeCode, actor && actor.accountId);
  if (!token) throw rcErr('RECURRENCE_ACTOR_REQUIRED');
  return withTaskWriteTransaction(config, async (client) => {
    const cat = await client.query('SELECT is_active FROM task.categories WHERE category_code = $1 FOR SHARE', [v.categoryCode]);
    if (cat.rowCount === 0) throw rcErr('TASK_CATEGORY_NOT_FOUND');
    if (cat.rows[0].is_active !== true) throw rcErr('TASK_CATEGORY_INACTIVE');
    const hasRC = await hasRepeatCountSchema(client);
    if (v.endConditionType === 'after_count' && !hasRC) throw rcErr('RECURRENCE_MAX_OCCURRENCES_UNSUPPORTED');
    const inserted = hasRC
      ? await client.query(
        `INSERT INTO task.recurrence_rules (
           title, content, category_code, priority, primary_employee_code, related_employee_codes,
           anchor_date, start_hour, start_minute, duration_ms,
           frequency, weekday, day_of_month, end_condition_type, end_date, max_occurrences,
           status, rule_version,
           created_by_account_id, created_by_employee_code, manager_account_id, manager_employee_code
         ) VALUES ($1,$2,$3,$4,$5,$6, $7,$8,$9,$10, $11,$12,$13,$14,$15,$16, 'active', 1, $17,$18,$17,$18)
         RETURNING *`,
        [
          v.title, v.content, v.categoryCode, v.priority, v.primaryEmployeeCode, v.relatedEmployeeCodes,
          v.anchorDateKey, v.startHour, v.startMinute, v.durationMs,
          v.frequency, v.weekday, v.dayOfMonth, v.endConditionType, v.endDateKey, v.maxOccurrences,
          (actor && text(actor.accountId)) || null, (actor && text(actor.employeeCode)) || null,
        ]
      )
      : await client.query(
        `INSERT INTO task.recurrence_rules (
           title, content, category_code, priority, primary_employee_code, related_employee_codes,
           anchor_date, start_hour, start_minute, duration_ms,
           frequency, weekday, day_of_month, end_condition_type, end_date,
           status, rule_version,
           created_by_account_id, created_by_employee_code, manager_account_id, manager_employee_code
         ) VALUES ($1,$2,$3,$4,$5,$6, $7,$8,$9,$10, $11,$12,$13,$14,$15, 'active', 1, $16,$17,$16,$17)
         RETURNING *`,
        [
          v.title, v.content, v.categoryCode, v.priority, v.primaryEmployeeCode, v.relatedEmployeeCodes,
          v.anchorDateKey, v.startHour, v.startMinute, v.durationMs,
          v.frequency, v.weekday, v.dayOfMonth, v.endConditionType, v.endDateKey,
          (actor && text(actor.accountId)) || null, (actor && text(actor.employeeCode)) || null,
        ]
      );
    const rule = inserted.rows[0];
    let initialClaim = null;
    if (initialTaskId) {
      initialClaim = await claimInitialOccurrence(client, rule, initialTaskId, hasRC);
    }
    const afterData = Object.assign({}, rule, initialClaim ? { initial_occurrence_claim: initialClaim } : {});
    await client.query(
      `INSERT INTO task.recurrence_rule_history (rule_id, action, before_data, after_data, reason, changed_by_account_id, changed_by_employee_code)
       VALUES ($1, 'create', '{}'::jsonb, $2::jsonb, $3, $4, $5)`,
      [rule.id, JSON.stringify(afterData), text(input && input.reason) || null, (actor && text(actor.accountId)) || null, (actor && text(actor.employeeCode)) || null]
    );
    rule.initial_occurrence_claim = initialClaim;
    return rule;
  });
}

async function updateRule(config, ruleId, input, actor) {
  const v = validateRuleInput(input);
  return withTaskWriteTransaction(config, async (client) => {
    const cur = await client.query('SELECT * FROM task.recurrence_rules WHERE id = $1 FOR UPDATE', [ruleId]);
    if (cur.rowCount === 0) throw rcErr('RECURRENCE_RULE_NOT_FOUND');
    const before = cur.rows[0];
    if (before.status === 'ended') throw rcErr('RECURRENCE_RULE_ENDED');
    const cat = await client.query('SELECT is_active FROM task.categories WHERE category_code = $1 FOR SHARE', [v.categoryCode]);
    if (cat.rowCount === 0) throw rcErr('TASK_CATEGORY_NOT_FOUND');
    if (cat.rows[0].is_active !== true) throw rcErr('TASK_CATEGORY_INACTIVE');
    const hasRC = await hasRepeatCountSchema(client);
    if (v.endConditionType === 'after_count' && !hasRC) throw rcErr('RECURRENCE_MAX_OCCURRENCES_UNSUPPORTED');
    const updated = hasRC
      ? await client.query(
        `UPDATE task.recurrence_rules SET
           title=$2, content=$3, category_code=$4, priority=$5, primary_employee_code=$6, related_employee_codes=$7,
           anchor_date=$8, start_hour=$9, start_minute=$10, duration_ms=$11,
           frequency=$12, weekday=$13, day_of_month=$14, end_condition_type=$15, end_date=$16, max_occurrences=$17,
           rule_version = rule_version + 1, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [
          ruleId, v.title, v.content, v.categoryCode, v.priority, v.primaryEmployeeCode, v.relatedEmployeeCodes,
          v.anchorDateKey, v.startHour, v.startMinute, v.durationMs,
          v.frequency, v.weekday, v.dayOfMonth, v.endConditionType, v.endDateKey, v.maxOccurrences,
        ]
      )
      : await client.query(
        `UPDATE task.recurrence_rules SET
           title=$2, content=$3, category_code=$4, priority=$5, primary_employee_code=$6, related_employee_codes=$7,
           anchor_date=$8, start_hour=$9, start_minute=$10, duration_ms=$11,
           frequency=$12, weekday=$13, day_of_month=$14, end_condition_type=$15, end_date=$16,
           rule_version = rule_version + 1, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [
          ruleId, v.title, v.content, v.categoryCode, v.priority, v.primaryEmployeeCode, v.relatedEmployeeCodes,
          v.anchorDateKey, v.startHour, v.startMinute, v.durationMs,
          v.frequency, v.weekday, v.dayOfMonth, v.endConditionType, v.endDateKey,
        ]
      );
    const after = updated.rows[0];
    await client.query(
      `INSERT INTO task.recurrence_rule_history (rule_id, action, before_data, after_data, reason, changed_by_account_id, changed_by_employee_code)
       VALUES ($1, 'update', $2::jsonb, $3::jsonb, $4, $5, $6)`,
      [ruleId, JSON.stringify(before), JSON.stringify(after), text(input && input.reason) || null,
        (actor && text(actor.accountId)) || null, (actor && text(actor.employeeCode)) || null]
    );
    // "Số lần lặp" lowered to <= the number of FUTURE Tasks already generated?
    // Then there is nothing left to generate — end the rule safely. Generated
    // Tasks and occurrence rows are NEVER touched. Editing otherwise applies to
    // future ungenerated occurrences only (the engine re-plans from the rule
    // each run; occurrences already claimed keep rule_version_at_claim).
    const cs = recurrenceCountState(after.max_occurrences, await countGeneratedFutureOccurrences(client, ruleId));
    if (cs.finite && cs.exhausted) {
      const ended = await endRuleInTxn(client, ruleId, after, 'auto: Số lần lặp đã đạt sau khi chỉnh sửa',
        (actor && text(actor.accountId)) || null, (actor && text(actor.employeeCode)) || null);
      if (ended) return ended;
    }
    return after;
  });
}

async function transitionRule(config, ruleId, kind, input, actor) {
  // kind: 'pause' | 'resume' | 'stop'. input.nowMs (optional) lets tests
  // time-travel the pause window; production always passes the real clock.
  return withTaskWriteTransaction(config, async (client) => {
    const cur = await client.query('SELECT * FROM task.recurrence_rules WHERE id = $1 FOR UPDATE', [ruleId]);
    if (cur.rowCount === 0) throw rcErr('RECURRENCE_RULE_NOT_FOUND');
    const before = cur.rows[0];
    const today = vnTodayDateKey(input && input.nowMs !== undefined ? input.nowMs : undefined);
    let sql, params, action;
    if (kind === 'pause') {
      if (before.status !== 'active') throw rcErr('RECURRENCE_RULE_NOT_ACTIVE');
      action = 'pause';
      sql = `UPDATE task.recurrence_rules SET status='paused', paused_from=$2, paused_to=NULL, updated_at=now() WHERE id=$1 RETURNING *`;
      params = [ruleId, today];
    } else if (kind === 'resume') {
      if (before.status !== 'paused') throw rcErr('RECURRENCE_RULE_NOT_PAUSED');
      action = 'resume';
      // MULTI-PAUSE HARDENING: materialise every scheduled occurrence that fell
      // inside the just-finished pause window [paused_from, resumeDate) as a
      // persisted skipped/paused row BEFORE flipping back to active. Once these
      // rows exist, a later pause cycle (which overwrites paused_from/paused_to)
      // can never let this window's occurrences reappear as catch-up — the
      // generator excludes them via existingOccurrenceDateKeys. UNIQUE(rule_id,
      // occurrence_date) + ON CONFLICT DO NOTHING makes repeated resume/retry
      // idempotent. NO Task is created for these rows; NO future rows.
      const pausedFromKey = dateColToKey(before.paused_from);
      if (pausedFromKey && datemath.compareDateKey(pausedFromKey, today) < 0) {
        const windowPlan = datemath.generateOccurrencePlan({
          rule: ruleToEngineShape(before),
          anchorDateKey: dateColToKey(before.anchor_date),
          endCondition: before.end_condition_type === 'on_date'
            ? { type: 'on_date', endDateKey: dateColToKey(before.end_date) }
            : { type: 'never' },
          scanUntilDateKeyInclusive: datemath.addDaysToDateKey(today, -1), // exclusive of the resume date
          existingOccurrenceDateKeys: [],
          skippedDateKeys: [], pauseWindows: [],
          startHour: 0, startMinute: 0, durationMs: 1, // unused — scheduled_start_at computed below
          nowDateKeyForCatchup: today,
        }).filter((p) => datemath.compareDateKey(p.dateKey, pausedFromKey) >= 0);
        for (const p of windowPlan) {
          await client.query(
            `INSERT INTO task.recurrence_occurrences
               (rule_id, occurrence_date, occurrence_index, status, scheduled_start_at, is_catchup, rule_version_at_claim, skip_reason)
             VALUES ($1, $2, $3, 'skipped', $4, false, $5, 'paused')
             ON CONFLICT (rule_id, occurrence_date) DO NOTHING`,
            [ruleId, p.dateKey, p.occurrenceIndex,
              vnWallToUtcIso(p.dateKey, before.start_hour, before.start_minute), before.rule_version]
          );
        }
      }
      // paused_to = resumeDate -> window [paused_from, resumeDate) closed.
      sql = `UPDATE task.recurrence_rules SET status='active', paused_to=$2, updated_at=now() WHERE id=$1 RETURNING *`;
      params = [ruleId, today];
    } else if (kind === 'stop') {
      if (before.status === 'ended') throw rcErr('RECURRENCE_RULE_ALREADY_ENDED');
      action = 'end';
      sql = `UPDATE task.recurrence_rules SET status='ended', ended_at=now(), updated_at=now() WHERE id=$1 RETURNING *`;
      params = [ruleId];
    } else {
      throw rcErr('RECURRENCE_TRANSITION_INVALID');
    }
    const after = (await client.query(sql, params)).rows[0];
    await client.query(
      `INSERT INTO task.recurrence_rule_history (rule_id, action, before_data, after_data, reason, changed_by_account_id, changed_by_employee_code)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)`,
      [ruleId, action, JSON.stringify(before), JSON.stringify(after), text(input && input.reason) || null,
        (actor && text(actor.accountId)) || null, (actor && text(actor.employeeCode)) || null]
    );
    return after;
  });
}

async function listRules(config, filter) {
  return withTaskWriteTransaction(config, async (client) => {
    const hasRC = await hasRepeatCountSchema(client);
    const where = [];
    const params = [];
    if (filter && filter.status) { params.push(filter.status); where.push(`status = $${params.length}`); }
    if (filter && filter.createdByEmployeeCode) { params.push(upper(filter.createdByEmployeeCode)); where.push(`upper(created_by_employee_code) = $${params.length}`); }
    const futureCountExpr = hasRC
      ? `(SELECT count(*)::int FROM task.recurrence_occurrences o WHERE o.rule_id = r.id AND o.status = 'generated' AND o.is_initial = false)`
      : `0`;
    const rows = (await client.query(
      `SELECT r.*,
              (SELECT count(*)::int FROM task.recurrence_occurrences o WHERE o.rule_id = r.id AND o.status = 'generated') AS generated_count,
              ${futureCountExpr} AS generated_future_count,
              (SELECT max(o.occurrence_date) FROM task.recurrence_occurrences o WHERE o.rule_id = r.id AND o.status = 'generated') AS last_generated_date
         FROM task.recurrence_rules r
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY r.created_at DESC
         LIMIT 500`,
      params
    )).rows;
    return { rules: rows };
  });
}

// ===========================================================================
// GENERATION ENGINE — the idempotent scheduler entrypoint.
// ===========================================================================

/*
 * generateDue(config, options) — safe to call repeatedly / concurrently.
 * options: { nowMs?, maxCatchupPerRule = 50, maxTotalPerRun = 200,
 *            activePrimaryCodes?: string[] | null, activeCategoryCodes?: string[] | null }
 *
 * activePrimaryCodes / activeCategoryCodes are OPTIONAL allow-lists resolved
 * by the CALLER (the main app has employee_profiles + can pass the set of
 * currently-active employee codes; the run endpoint may also pass the active
 * category codes). When null, the engine treats primary as active and only
 * validates the category against task.categories.is_active (which it can read
 * locally). This mirrors publishTask()'s "department params resolved upstream"
 * pattern — phf_hr has no org data.
 */
async function generateDue(config, options) {
  const opts = options || {};
  const nowMs = opts.nowMs === undefined ? Date.now() : opts.nowMs;
  const todayKey = vnTodayDateKey(nowMs);
  const maxCatchupPerRule = Number.isInteger(opts.maxCatchupPerRule) ? opts.maxCatchupPerRule : 50;
  const maxTotalPerRun = Number.isInteger(opts.maxTotalPerRun) ? opts.maxTotalPerRun : 200;
  const activePrimary = Array.isArray(opts.activePrimaryCodes) ? new Set(opts.activePrimaryCodes.map(upper)) : null;
  const activeCategory = Array.isArray(opts.activeCategoryCodes) ? new Set(opts.activeCategoryCodes.map(upper)) : null;

  const summary = { runAt: new Date(nowMs).toISOString(), todayVn: todayKey, rulesScanned: 0, generated: 0, skipped: 0, alreadyClaimed: 0, byRule: [] };

  // Snapshot of active rule ids (each processed in its own transaction so one
  // bad rule cannot abort the whole run).
  const ruleIds = await withTaskWriteTransaction(config, async (client) => {
    const r = await client.query(`SELECT id FROM task.recurrence_rules WHERE status = 'active' ORDER BY created_at ASC`);
    return r.rows.map((x) => x.id);
  });

  let totalThisRun = 0;
  for (const ruleId of ruleIds) {
    if (totalThisRun >= maxTotalPerRun) break;
    summary.rulesScanned += 1;
    const ruleResult = await generateDueForRule(config, ruleId, {
      todayKey, nowMs, maxOccurrences: Math.min(maxCatchupPerRule, maxTotalPerRun - totalThisRun),
      activePrimary, activeCategory,
    });
    totalThisRun += ruleResult.generated + ruleResult.skipped;
    summary.generated += ruleResult.generated;
    summary.skipped += ruleResult.skipped;
    summary.alreadyClaimed += ruleResult.alreadyClaimed;
    if (ruleResult.generated || ruleResult.skipped || ruleResult.alreadyClaimed) summary.byRule.push(ruleResult);
  }
  return summary;
}

/*
 * runRule — generate due occurrences for ONE rule only. Same idempotent
 * contract as generateDue(). Used by the :run endpoint's per-rule path and by
 * tests that need to exercise a single rule in isolation. options mirror
 * generateDue: { nowMs?, maxOccurrences = 50, activePrimaryCodes?, activeCategoryCodes? }.
 */
async function runRule(config, ruleId, options) {
  const opts = options || {};
  const nowMs = opts.nowMs === undefined ? Date.now() : opts.nowMs;
  return generateDueForRule(config, ruleId, {
    todayKey: vnTodayDateKey(nowMs),
    nowMs,
    maxOccurrences: Number.isInteger(opts.maxOccurrences) ? opts.maxOccurrences : 50,
    activePrimary: Array.isArray(opts.activePrimaryCodes) ? new Set(opts.activePrimaryCodes.map(upper)) : null,
    activeCategory: Array.isArray(opts.activeCategoryCodes) ? new Set(opts.activeCategoryCodes.map(upper)) : null,
  });
}

async function generateDueForRule(config, ruleId, ctx) {
  const result = { ruleId, generated: 0, skipped: 0, alreadyClaimed: 0, occurrences: [] };

  // 1. Read a consistent rule snapshot + existing occurrence dates (short txn,
  //    FOR UPDATE serialises against updateRule / transitionRule).
  const snap = await withTaskWriteTransaction(config, async (client) => {
    const r = await client.query(`SELECT * FROM task.recurrence_rules WHERE id = $1 FOR UPDATE`, [ruleId]);
    if (r.rowCount === 0 || r.rows[0].status !== 'active') return null;
    const rule = r.rows[0];
    const existing = (await client.query(
      `SELECT occurrence_date::text AS d FROM task.recurrence_occurrences WHERE rule_id = $1`, [ruleId]
    )).rows.map((x) => x.d);
    const generatedFutureCount = await countGeneratedFutureOccurrences(client, ruleId);
    return { rule, existing, generatedFutureCount };
  });
  if (!snap) return result;
  const { rule, existing } = snap;

  // "Số lần lặp" gate — count = FUTURE Tasks generated (is_initial=false).
  // Skipped occurrences never count. If the rule is finite and already at/over
  // its limit, it should be ended — end it now (a prior run or edit left it
  // active) and generate nothing further.
  let repeatCounted = snap.generatedFutureCount;
  const repeatState0 = recurrenceCountState(rule.max_occurrences, repeatCounted);
  if (repeatState0.finite && repeatState0.exhausted) {
    await withTaskWriteTransaction(config, (c) =>
      endRuleInTxn(c, ruleId, rule, 'auto: Số lần lặp đã đạt', rule.created_by_account_id, rule.created_by_employee_code));
    result.ruleEnded = true;
    return result;
  }
  ctx.repeatMax = repeatState0.finite ? repeatState0.max : null;

  // 2. Pure date-math: which occurrences are due (<= today VN)?
  //    Pause windows are NOT passed here: every paused occurrence is already a
  //    persisted 'skipped'/'paused' row (written by transitionRule on resume),
  //    so it lands in `existing` and is excluded. This is single-sourced and
  //    survives any number of later pause/resume cycles — see MULTI-PAUSE
  //    HARDENING in transitionRule().
  const plan = datemath.generateOccurrencePlan({
    rule: ruleToEngineShape(rule),
    anchorDateKey: dateColToKey(rule.anchor_date),
    endCondition: rule.end_condition_type === 'on_date'
      ? { type: 'on_date', endDateKey: dateColToKey(rule.end_date) }
      : { type: 'never' },
    scanUntilDateKeyInclusive: ctx.todayKey,
    existingOccurrenceDateKeys: existing,
    skippedDateKeys: [],
    pauseWindows: [],
    startHour: 0, startMinute: 0, durationMs: 1, // unused here — we compute start/deadline ourselves (VN offset)
    nowDateKeyForCatchup: ctx.todayKey,
  });

  // 3. Generate each planned occurrence, ascending, capped by the per-run cap
  //    AND (when finite) by "Số lần lặp". Only status='generated' consumes the
  //    count — a skipped occurrence (primary_inactive / category_inactive /
  //    paused / repeat_count_reached) never does.
  for (const p of plan) {
    if (result.generated + result.skipped >= ctx.maxOccurrences) break;
    if (ctx.repeatMax !== null && repeatCounted >= ctx.repeatMax) break;
    const one = await generateOneOccurrence(config, rule, p, ctx);
    if (one.outcome === 'generated') {
      result.generated += 1;
      repeatCounted += 1;
      if (one.ruleEnded) { result.ruleEnded = true; }
      result.occurrences.push(one);
      if (ctx.repeatMax !== null && repeatCounted >= ctx.repeatMax) { result.ruleEnded = true; break; }
      continue;
    }
    if (one.outcome === 'skipped') { result.skipped += 1; }
    else if (one.outcome === 'already') { result.alreadyClaimed += 1; }
    else if (one.outcome === 'rule_inactive') { break; }
    result.occurrences.push(one);
  }
  return result;
}

async function generateOneOccurrence(config, rule, planItem, ctx) {
  const occurrenceDate = planItem.dateKey;
  const scheduledStartIso = vnWallToUtcIso(occurrenceDate, rule.start_hour, rule.start_minute);
  // Only generate when the scheduled instant has actually passed.
  if (new Date(scheduledStartIso).getTime() > ctx.nowMs) {
    return { occurrenceDate, outcome: 'not_due', scheduledStartIso };
  }
  const startIso = scheduledStartIso;
  const deadlineIso = new Date(new Date(startIso).getTime() + Number(rule.duration_ms)).toISOString();
  const isCatchup = !!planItem.isCatchup;

  return withTaskWriteTransaction(config, async (client) => {
    // Lock the rule row FIRST — serialises ALL generation for this rule across
    // processes (a later VPS cron every 5 min could overlap a manual :run), so
    // the "Số lần lặp" count check below is race-free and the auto-end can be
    // atomic with the final generation.
    const hasRC = await hasRepeatCountSchema(client);
    const live = (await client.query(
      hasRC
        ? `SELECT status, max_occurrences, rule_version FROM task.recurrence_rules WHERE id = $1 FOR UPDATE`
        : `SELECT status, rule_version FROM task.recurrence_rules WHERE id = $1 FOR UPDATE`,
      [rule.id]
    )).rows[0];
    if (!live || live.status !== 'active') return { occurrenceDate, outcome: 'rule_inactive' };
    const ruleVersion = live.rule_version;

    // "Số lần lặp" — how many FUTURE Tasks already generated (skips excluded)?
    let repeatMax = (!hasRC || live.max_occurrences === null || live.max_occurrences === undefined) ? null : Number(live.max_occurrences);
    let alreadyGenerated = 0;
    if (repeatMax !== null) {
      alreadyGenerated = await countGeneratedFutureOccurrences(client, rule.id);
      if (alreadyGenerated >= repeatMax) {
        // Nothing left to generate. End the rule; do NOT claim this date.
        await endRuleInTxn(client, rule.id, rule, 'auto: Số lần lặp đã đạt', rule.created_by_account_id, rule.created_by_employee_code);
        return { occurrenceDate, outcome: 'limit_reached', ruleEnded: true };
      }
    }

    // L1 CLAIM — atomic. ON CONFLICT DO NOTHING => already handled elsewhere.
    const claim = await client.query(
      `INSERT INTO task.recurrence_occurrences
         (rule_id, occurrence_date, occurrence_index, status, scheduled_start_at, is_catchup, rule_version_at_claim)
       VALUES ($1, $2, $3, 'pending', $4, $5, $6)
       ON CONFLICT (rule_id, occurrence_date) DO NOTHING
       RETURNING id`,
      [rule.id, occurrenceDate, planItem.occurrenceIndex, scheduledStartIso, isCatchup, ruleVersion]
    );
    if (claim.rowCount === 0) {
      // Someone else claimed it. If it is still 'pending' (crash), leave it —
      // a later run reconciles. Report and move on.
      return { occurrenceDate, outcome: 'already' };
    }
    const occurrenceId = claim.rows[0].id;

    // 2. Validate primary active + category active.
    let skipReason = null;
    if (ctx.activePrimary && !ctx.activePrimary.has(upper(rule.primary_employee_code))) skipReason = 'primary_inactive';
    if (!skipReason) {
      const cat = await client.query('SELECT is_active FROM task.categories WHERE category_code = $1 FOR SHARE', [rule.category_code]);
      if (cat.rowCount === 0 || cat.rows[0].is_active !== true) skipReason = 'category_inactive';
      else if (ctx.activeCategory && !ctx.activeCategory.has(upper(rule.category_code))) skipReason = 'category_inactive';
    }
    if (skipReason) {
      await client.query(
        `UPDATE task.recurrence_occurrences SET status='skipped', skip_reason=$2 WHERE id=$1`,
        [occurrenceId, skipReason]
      );
      return { occurrenceDate, outcome: 'skipped', skipReason };
    }

    // 3. Create the canonical Task (published, independent). L2 idempotency key.
    const idemKey = taskIdempotencyKey(rule.id, occurrenceDate);
    const creatorEmp = text(rule.created_by_employee_code) || null;
    const creatorAcc = text(rule.created_by_account_id) || null;
    const token = auditToken(rule.created_by_employee_code, rule.created_by_account_id);

    // L2 replay guard — a previous run may have inserted the task then crashed
    // before finalising this occurrence row (which we just re-claimed fresh
    // after that row was... no: L1 conflict would have fired. This guards the
    // narrower window where the occurrence row was deleted/never committed but
    // the task committed — defensive, cheap).
    const replay = await client.query(
      `SELECT id, task_code FROM task.tasks WHERE create_idempotency_key = $1 LIMIT 1`, [idemKey]
    );
    let taskRow;
    if (replay.rowCount > 0) {
      taskRow = replay.rows[0];
    } else {
      const taskCode = (await client.query('SELECT task.task_next_code(now()) AS code')).rows[0].code;
      const period = occurrencePeriod(occurrenceDate);
      const inserted = await client.query(
        `INSERT INTO task.tasks (
           flow_type, status, title, content, category_code, priority,
           start_at, deadline, created_by_employee_code, created_by_account_id,
           task_code, create_idempotency_key, published_at,
           recurring_series_id, recurring_series_version, scheduled_occurrence_at, occurrence_period
         ) VALUES ('giao_viec', 'published', $1, $2, $3, $4,
                   $5, $6, $7, $8,
                   $9, $10, now(),
                   $11, $12, $13, $14)
         RETURNING id, task_code`,
        [
          rule.title, rule.content || '', rule.category_code, rule.priority,
          startIso, deadlineIso, creatorEmp, creatorAcc,
          taskCode, idemKey,
          rule.id, ruleVersion, scheduledStartIso, period,
        ]
      );
      taskRow = inserted.rows[0];

      // primary assignee
      await client.query(
        `INSERT INTO task.assignees (task_id, employee_code, role, assigned_by_employee_code, assigned_by_account_id)
         VALUES ($1, $2, 'primary', $3, $4)`,
        [taskRow.id, upper(rule.primary_employee_code), token, creatorAcc]
      );
      // related (CC) — snapshot from the rule; caller-supplied active list filters if present
      for (const rc of (rule.related_employee_codes || [])) {
        if (ctx.activePrimary && !ctx.activePrimary.has(upper(rc))) continue;
        if (upper(rc) === upper(rule.primary_employee_code)) continue;
        await client.query(
          `INSERT INTO task.assignees (task_id, employee_code, role, assigned_by_employee_code, assigned_by_account_id)
           VALUES ($1, $2, 'related', $3, $4)`,
          [taskRow.id, upper(rc), token, creatorAcc]
        );
      }
      // lifecycle event (normal published) + the recurrence hook event (once)
      await client.query(
        `INSERT INTO task.events (task_id, event_type, actor_employee_code, actor_account_id, payload)
         VALUES ($1, 'published', $2, $3, jsonb_build_object('flow_type','giao_viec','source','recurrence'))`,
        [taskRow.id, token, creatorAcc]
      );
      const recurEvent = await client.query(
        `INSERT INTO task.events (task_id, event_type, actor_employee_code, actor_account_id, payload)
         VALUES ($1, 'recurring_generated', $2, $3, $4::jsonb) RETURNING id`,
        [taskRow.id, token, creatorAcc, JSON.stringify({
          rule_id: rule.id, occurrence_date: occurrenceDate, occurrence_index: planItem.occurrenceIndex,
          is_catchup: isCatchup, scheduled_start_at: scheduledStartIso,
        })]
      );

      // IN-APP NOTIFICATION V1 — a scheduler-generated occurrence -> its
      // primary. No actor exclusion: the generation is system/scheduled, not a
      // user action. In-transaction with the recurring_generated event. A
      // schema-gated no-op before migrations/phf_hr_task_notification_v1.sql.
      if (await notify.hasNotificationV1Schema(client)) {
        const m = notify.messageFor('TASK_RECURRING_GENERATED', rule.title);
        await notify.emitEventNotifications({
          client,
          eventId: recurEvent.rows[0] && recurEvent.rows[0].id,
          eventCode: 'TASK_RECURRING_GENERATED',
          taskId: taskRow.id,
          title: m.title,
          message: m.message,
          targetPath: notify.targetPathFor(taskRow.id),
          priority: 'Trung bình',
          recipients: [{ employeeCode: upper(rule.primary_employee_code) }],
          actor: {},
        });
      }
    }

    // 4. Finalise the occurrence.
    await client.query(
      `UPDATE task.recurrence_occurrences SET status='generated', generated_task_id=$2, generated_at=now() WHERE id=$1`,
      [occurrenceId, taskRow.id]
    );
    // Auto-end when THIS generation was the Nth future Task ("Số lần lặp"
    // reached) — atomic with the generation; existing Tasks untouched.
    let ruleEnded = false;
    if (repeatMax !== null && (alreadyGenerated + 1) >= repeatMax) {
      await endRuleInTxn(client, rule.id, rule, 'auto: Số lần lặp đã đạt', rule.created_by_account_id, rule.created_by_employee_code);
      ruleEnded = true;
    }
    return { occurrenceDate, outcome: 'generated', taskId: taskRow.id, taskCode: taskRow.task_code, isCatchup, ruleEnded };
  });
}

module.exports = {
  // store
  createRule,
  updateRule,
  transitionRule,
  listRules,
  // engine
  generateDue,
  runRule,
  // helpers exposed for tests
  validateRuleInput,
  recurrenceCountState,
  vnTodayDateKey,
  vnWallToUtcIso,
  vnDateKeyOfInstant,
  taskIdempotencyKey,
  RECURRENCE_NS,
  RECURRENCE_MAX_OCCURRENCES,
  DAILY_WEEKDAYS,
};
