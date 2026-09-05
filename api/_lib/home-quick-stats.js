'use strict';

/*
 * PHF HR Home — "Số liệu nhanh" bounded aggregate reads.
 *
 * Two tiny authenticated, aggregate-only endpoints for the Home widget. Both
 * return a single number and NOTHING else — no rows, no employee/form
 * identities, no scores. Neither widens access to the underlying tables.
 *
 *  - getActiveEmployeeCount()        -> { count }
 *      Canonical current-employee source already used by Checklist
 *      (checklist-monthly-results-service.js::loadActiveEmployeeIndex):
 *      employee_profiles rows whose employment_status = 'active'. The count is
 *      computed server-side here, deduplicated by normalized employee_code.
 *      Only the code column of the active rows is read (the exact shape the
 *      Checklist service already reads) — never the full roster to the browser.
 *
 *  - getChecklistMonthlyFormCount({ month }) -> { month, count }
 *      One bounded count(*) over checklist_monthly_forms for period_month =
 *      the given month (default: current month, Asia/Ho_Chi_Minh). That table
 *      holds one live "phiếu" row per employee per period; history/snapshot
 *      rows live in checklist_monthly_form_history, so a raw count never
 *      inflates. head:true — zero rows transferred.
 *
 * Same Supabase MAIN client + env vars the rest of api/_lib already uses.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const configured = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const db = configured
  ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

function fail(message, statusCode, code) {
  const e = new Error(message);
  e.statusCode = statusCode || 500;
  e.code = code || 'HOME_QUICK_STATS_ERROR';
  return e;
}
function requireDb() {
  if (!db) throw fail('Supabase chưa được cấu hình.', 503, 'SUPABASE_NOT_CONFIGURED');
}
function currentIctMonth() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' })
    .format(new Date()).slice(0, 7);
}

async function getActiveEmployeeCount() {
  requireDb();
  const { data, error } = await db.from('employee_profiles')
    .select('employee_code')
    .eq('employment_status', 'active')
    .limit(5000);
  if (error) throw fail('Không đọc được danh sách nhân sự đang làm việc.', 502, 'ACTIVE_EMPLOYEE_COUNT_READ_FAILED');
  const seen = new Set();
  (data || []).forEach((r) => {
    const c = String(r && r.employee_code != null ? r.employee_code : '').trim().toUpperCase();
    if (c) seen.add(c);
  });
  return { count: seen.size };
}

async function getChecklistMonthlyFormCount(input) {
  requireDb();
  const raw = String((input && input.month) || '').trim();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : currentIctMonth();
  const { count, error } = await db.from('checklist_monthly_forms')
    .select('id', { count: 'exact', head: true })
    .eq('period_month', month);
  if (error) throw fail('Không đọc được số phiếu Checklist tháng.', 502, 'CHECKLIST_MONTHLY_FORM_COUNT_READ_FAILED');
  return { month, count: Number(count || 0) };
}

module.exports = { getActiveEmployeeCount, getChecklistMonthlyFormCount };
