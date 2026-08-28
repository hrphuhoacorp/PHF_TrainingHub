'use strict';

/*
 * PHF Task — PHASE C — remove test users / test identities / test permission
 * rows from the SANDBOX real-parity baseline. SANDBOX only (fail-closed).
 * MAIN is never touched by this script (it has no MAIN client at all).
 *
 * KEEPS the [REPORT-UI-TEST] demo corpus and every real MAIN persona.
 *
 * What it removes (all verified test-only against a live MAIN read earlier —
 * see PHF_HR_REAL_IDENTITY_PARITY_PHASE_C_*.md):
 *   - task_permission_grants        : ALL rows  (MAIN has 0 — every SANDBOX row is a test/gate artifact)
 *   - task_permission_assignments   : the 4 PARITY_TEST_* rows (the 9 real rows share MAIN's exact UUIDs — kept)
 *   - user_accounts                 : the 4 *@test.local / LOCAL-PARITY-ADMIN rows
 *   - employee_profiles             : the 13 ZTEST-* / PARITY_TEST_E* rows
 *   - employees (legacy Hub table)  : the 2 rows not present in MAIN
 *   - task_tasks CV-2608-0001/0002  : created by PARITY_TEST_E07/E09 — cancelled
 *       (cannot be hard-deleted: published + task_events append-only + LOCK 4;
 *        no FK from task_tasks.created_by_employee_code to employee_profiles,
 *        so the orphan text code is harmless — documented exception).
 *   - stray [PROGRESS-*]/[PERMISSION-*]/[PHASEB-*] leftover single tasks are
 *       left alone (real-persona PHF010, self-cleaning suites, not test users).
 */

require('dotenv').config();
require('./task-sandbox-guard');
const { createClient } = require('@supabase/supabase-js');
const db = createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), { auth: { persistSession: false } });

const APPLY = process.argv.includes('--apply');
const TEST_EC = ['ZTEST-MGR', 'ZTEST-SUBJ', 'LOCAL-PARITY-ADMIN',
  'PARITY_TEST_E01', 'PARITY_TEST_E02', 'PARITY_TEST_E03', 'PARITY_TEST_E04', 'PARITY_TEST_E05',
  'PARITY_TEST_E06', 'PARITY_TEST_E07', 'PARITY_TEST_E08', 'PARITY_TEST_E09', 'PARITY_TEST_E10'];
const TEST_TASK_CODES = ['CV-2608-0001', 'CV-2608-0002'];

const log = (...a) => console.log((APPLY ? '[APPLY] ' : '[DRY]  ') + a.join(' '));

(async () => {
  // ---- 0. safety: confirm the demo corpus is intact and real ----
  const { count: corpus } = await db.from('task_tasks').select('id', { count: 'exact', head: true }).ilike('title', '%[REPORT-UI-TEST]%');
  log('demo corpus [REPORT-UI-TEST] tasks =', corpus, '(must stay untouched)');

  // ---- 1. cancel the 2 test-user-created tasks ----
  for (const codeStr of TEST_TASK_CODES) {
    const { data: t } = await db.from('task_tasks').select('id,status,row_version,created_by_employee_code,created_by_account_id').eq('task_code', codeStr).maybeSingle();
    if (!t) { log(codeStr, 'absent'); continue; }
    if (t.status === 'cancelled') { log(codeStr, 'already cancelled'); continue; }
    if (!APPLY) { log(codeStr, 'would cancel (status=' + t.status + ', by ' + t.created_by_employee_code + ')'); continue; }
    const { error } = await db.from('task_tasks').update({ status: 'cancelled', updated_at: new Date().toISOString(), row_version: t.row_version + 1 }).eq('id', t.id);
    log(codeStr, error ? ('cancel ERR ' + error.code) : 'cancelled');
    if (!error) {
      await db.from('task_assignees').update({ is_active: false }).eq('task_id', t.id);
    }
  }

  // ---- 2. task_permission_grants — clear ALL (MAIN has 0) ----
  const { data: grants } = await db.from('task_permission_grants').select('id,grantee_employee_code');
  log('task_permission_grants to remove =', (grants || []).length, '(MAIN has 0)');
  if (APPLY) for (const g of (grants || [])) {
    const { error } = await db.from('task_permission_grants').delete().eq('id', g.id);
    if (error) { await db.from('task_permission_grants').update({ is_active: false }).eq('id', g.id); }
  }

  // ---- 3. task_permission_assignments — the 4 test rows only ----
  const { data: asg } = await db.from('task_permission_assignments').select('id,employee_code').in('employee_code', TEST_EC);
  log('task_permission_assignments (test) to remove =', (asg || []).map(r => r.employee_code).join(','));
  if (APPLY) for (const a of (asg || [])) {
    const { error } = await db.from('task_permission_assignments').delete().eq('id', a.id);
    if (error) { await db.from('task_permission_assignments').update({ is_active: false }).eq('id', a.id); }
  }

  // ---- 4. user_accounts — test rows ----
  const { data: accts } = await db.from('user_accounts').select('id,email,employee_code')
    .or('email.ilike.%@test.local,employee_code.in.(' + TEST_EC.join(',') + ')');
  log('user_accounts (test) to remove =', (accts || []).map(r => r.email).join(', '));
  if (APPLY) for (const ac of (accts || [])) {
    const { error } = await db.from('user_accounts').delete().eq('id', ac.id);
    if (error) log('  user_accounts', ac.email, 'delete ERR', error.code, error.message);
  }

  // ---- 5. employee_profiles — test rows ----
  const { data: profs } = await db.from('employee_profiles').select('id,employee_code').in('employee_code', TEST_EC);
  log('employee_profiles (test) to remove =', (profs || []).map(r => r.employee_code).join(','));
  if (APPLY) for (const p of (profs || [])) {
    const { error } = await db.from('employee_profiles').delete().eq('id', p.id);
    if (error) log('  employee_profiles', p.employee_code, 'delete ERR', error.code, error.message);
  }

  // ---- 6. employees (legacy Hub table) — rows not in MAIN ----
  //   handled by the caller which has the MAIN id list; here we only drop the
  //   obvious ZTEST rows by full_name pattern to avoid deleting anything real.
  const { data: hub } = await db.from('employees').select('id,full_name').or('full_name.ilike.ZTEST%,full_name.ilike.%parity test%,full_name.ilike.local-parity%');
  log('employees (legacy Hub, test) to remove =', (hub || []).map(r => r.full_name).join(', ') || '(none by pattern)');
  if (APPLY) for (const h of (hub || [])) {
    const { error } = await db.from('employees').delete().eq('id', h.id);
    if (error) log('  employees', h.full_name, 'delete ERR', error.code);
  }

  log('DONE.', APPLY ? 'Applied.' : 'Dry run — pass --apply to execute.');
})().catch(e => { console.error('FATAL', e && e.message ? e.message : e); process.exit(1); });
