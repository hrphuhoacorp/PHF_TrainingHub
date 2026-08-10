'use strict';

/* PHF Organization Master Cutover — one-time bootstrap seed, 1.50.7.
   NOT EXECUTED YET. Requires scripts/PHF_ORG_MASTER_CUTOVER_1.50.7.sql to
   already be applied in Production (new columns must exist) before this
   can run at all — it will fail loudly (42703) otherwise, which is the
   correct behavior, not a bug.

   checklist_employee_assignments is used exactly once here as the
   bootstrap source, per PHF's decision. It is never read again by this
   script after this run. Seed rules (PHF-approved, do not re-derive):
     department  <- checklist.department
     title       <- checklist.title
     branch      <- checklist.branch (including the 5 accepted branch
                     conflicts: PHF041, PHF042, PHF076, PHF084, PHF092 —
                     checklist value wins as bootstrap baseline only)
     manager     <- resolved employee_code (via lib/org-master-cutover
                     resolveManager); never a bare display name
     employment_status <- STATUS_MAP (lib/org-master-cutover), exhaustive
                     of the 2 distinct values traced in Production
                     ("Đang làm việc"/"Đã nghỉ việc"); anything else is
                     refused, not guessed
     position    <- left null; no verified source exists yet
   ADMIN is excluded (not a real employee). PHF046 and PHF065 (traced: real
   employees in checklist with no employee_profiles row yet) get
   ensureProfile() — creates ONLY an employee_profiles row, never a new
   employee/account/checklist assignment.

   Writes exclusively through lib/employee-master.js#saveProfile (same path
   the Employee Master admin UI and the 2b02d43 hire-date load used).
   Idempotent and conflict-safe: a profile whose org fields already hold a
   different non-empty value is recorded as CONFLICT and never overwritten
   (see classifySeedRow in lib/org-master-cutover.js).

   Safety default: DRY RUN. Pass --apply to actually write. Even with
   --apply this only ever touches public.employee_profiles (+ its own
   employee_master_history) — checklist_employee_assignments, user_accounts
   and public.employees are read-only throughout. */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { saveProfile, ensureProfile } = require('../lib/employee-master');
const { text, code, mapEmploymentStatus, resolveManager, buildUniverse, classifySeedRow } = require('../lib/org-master-cutover');

const url = String(process.env.SUPABASE_URL || '').trim();
const secret = String(process.env.SUPABASE_SECRET_KEY || '').trim();
if (!url || !secret) { console.error('Missing Supabase env'); process.exit(1); }
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

const APPLY = process.argv.includes('--apply');
const SESSION = { role: 'admin', sub: 'system-org-master-cutover-1.50.7', account: { id: 'system-org-master-cutover-1.50.7', name: 'PHF Organization Master Cutover — bootstrap seed' } };
const REASON = 'Organization Master Cutover bootstrap — one-time seed từ checklist_employee_assignments (PHF-approved, checklist ngừng làm organization owner sau bước này).';

async function run() {
  const checklist = await db.from('checklist_employee_assignments').select('employee_code,employee_name,department,title,branch,manager_code,manager_name,employee_status');
  if (checklist.error) throw checklist.error;
  const { universe, universeByCode, nameIndex } = buildUniverse(checklist.data);

  const profiles = await db.from('employee_profiles').select('employee_code,department,title,branch,manager_employee_code,employment_status');
  if (profiles.error) {
    if (profiles.error.code === '42703') { console.error('Org columns missing — run scripts/PHF_ORG_MASTER_CUTOVER_1.50.7.sql in Production first.'); process.exit(1); }
    throw profiles.error;
  }
  const profileByCode = new Map(profiles.data.map(r => [code(r.employee_code), r]));

  const plan = { SEED: [], UNCHANGED: [], CONFLICT: [], UNRESOLVED_MANAGER: [], UNKNOWN_STATUS: [] };

  for (const row of universe) {
    const employeeCode = code(row.employee_code);
    const statusResult = mapEmploymentStatus(row.employee_status);
    const managerResult = resolveManager(row, universeByCode, nameIndex);
    if (!managerResult.resolved) { plan.UNRESOLVED_MANAGER.push({ code: employeeCode, name: row.employee_name, reason: managerResult.reason }); continue; }
    if (!statusResult.ok) { plan.UNKNOWN_STATUS.push({ code: employeeCode, name: row.employee_name, reason: statusResult.reason }); continue; }

    const target = { department: text(row.department), title: text(row.title), branch: text(row.branch), managerEmployeeCode: managerResult.managerEmployeeCode, employmentStatus: statusResult.status };
    const existingRow = profileByCode.get(employeeCode);
    const existing = existingRow ? { department: existingRow.department, title: existingRow.title, branch: existingRow.branch, managerEmployeeCode: existingRow.manager_employee_code, employmentStatus: existingRow.employment_status } : null;
    const classification = classifySeedRow(target, existing);

    if (classification.bucket === 'CONFLICT') { plan.CONFLICT.push({ code: employeeCode, name: row.employee_name, diffs: classification.diffs }); continue; }
    if (classification.bucket === 'UNCHANGED') { plan.UNCHANGED.push({ code: employeeCode }); continue; }
    plan.SEED.push({ code: employeeCode, name: row.employee_name, target, hasExistingProfile: !!existingRow });
  }

  console.log('=== PLAN (dry run unless --apply) ===');
  console.log('SEED (will write):', plan.SEED.length);
  console.log('UNCHANGED (matches target already):', plan.UNCHANGED.length);
  console.log('CONFLICT (existing value differs, skipped — needs PHF manual resolution):', plan.CONFLICT.length, plan.CONFLICT);
  console.log('UNRESOLVED_MANAGER (skipped, never guessed):', plan.UNRESOLVED_MANAGER.length, plan.UNRESOLVED_MANAGER);
  console.log('UNKNOWN_STATUS (skipped, value outside traced STATUS_MAP):', plan.UNKNOWN_STATUS.length, plan.UNKNOWN_STATUS);

  if (!APPLY) { console.log('\nDRY RUN — no writes performed. Re-run with --apply to write plan.SEED rows.'); return plan; }

  const written = [];
  for (const item of plan.SEED) {
    if (!item.hasExistingProfile) await ensureProfile({ employeeCode: item.code, fullName: item.name });
    const { profile } = await saveProfile(SESSION, { employeeCode: item.code, fullName: item.name, department: item.target.department, title: item.target.title, branch: item.target.branch, managerEmployeeCode: item.target.managerEmployeeCode, employmentStatus: item.target.employmentStatus, reason: REASON });
    written.push(profile.employee_code);
  }
  console.log('\n=== APPLIED ===');
  console.log('written:', written.length, written);
  return plan;
}

run().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
