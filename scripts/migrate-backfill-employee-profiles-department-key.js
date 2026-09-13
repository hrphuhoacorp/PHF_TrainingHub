'use strict';
/*
 * PHF Training Hub — Batch A backfill: employee_profiles.department_key.
 *
 * Reads every employee_profiles row with department_key IS NULL and a
 * non-empty `department`. For each, resolves department via the canonical
 * catalog (api/_lib/department-catalog.js) using an EXACT match only (trim +
 * collapse whitespace + case-fold) — no fuzzy matching. Rows that match one
 * of the 9 canonical display names get department_key set. Rows that don't
 * match (e.g. a stray legacy short label) are left untouched and reported
 * separately for manual follow-up — never guessed.
 *
 * Idempotent: only ever touches rows where department_key IS NULL, so it is
 * safe to run more than once. Writes ONLY to employee_profiles.department_key
 * — never to `employees` or `user_accounts` (explicit constraint).
 *
 * Usage (real run against a live Supabase project):
 *   node scripts/migrate-backfill-employee-profiles-department-key.js
 * (requires SUPABASE_URL / SUPABASE_SECRET_KEY in the environment — this
 * script does not embed or fetch credentials itself)
 *
 * This module also exports runBackfill(client) so it can be unit-tested
 * against a fake/mock Supabase client (see
 * scripts/test-department-catalog-foundation.js) without touching any real
 * database.
 */
require('dotenv').config();
const { resolveDepartmentByDisplayName } = require('../api/_lib/department-catalog');

// client: an object shaped like a (very small subset of) the Supabase JS
// client — { from(table) => { select(cols) => Promise<{data,error}> ,
// update(patch) => { eq(col,val) => Promise<{error}> } } }.
async function runBackfill(client) {
  const summary = { scanned: 0, updated: 0, skippedAlreadySet: 0, skippedEmpty: 0, unmatched: [] };

  const { data: rows, error } = await client.from('employee_profiles').select('id, employee_code, department, department_key');
  if (error) throw error;

  for (const row of rows || []) {
    summary.scanned++;
    if (row.department_key) { summary.skippedAlreadySet++; continue; }
    const raw = String(row.department || '').trim();
    if (!raw) { summary.skippedEmpty++; continue; }

    const match = resolveDepartmentByDisplayName(raw);
    if (!match) {
      summary.unmatched.push({ id: row.id, employeeCode: row.employee_code, department: raw });
      continue;
    }

    const { error: updateError } = await client
      .from('employee_profiles')
      .update({ department_key: match.key })
      .eq('id', row.id);
    if (updateError) throw updateError;
    summary.updated++;
  }

  return summary;
}

async function main() {
  const { createClient } = require('@supabase/supabase-js');
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SECRET_KEY || '').trim();
  if (!url || !key) {
    console.error('Thiếu SUPABASE_URL / SUPABASE_SECRET_KEY trong môi trường. Không chạy backfill.');
    process.exit(1);
  }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const summary = await runBackfill(client);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.unmatched.length) {
    console.warn('\n' + summary.unmatched.length + ' dòng KHÔNG khớp catalog chuẩn (cần rà soát thủ công, không tự map):');
    summary.unmatched.forEach(u => console.warn('  - id=' + u.id + ' employeeCode=' + u.employeeCode + ' department="' + u.department + '"'));
  }
}

module.exports = { runBackfill };

if (require.main === module) {
  main().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1); });
}
