'use strict';
/*
 * PHF KNL — Initial Permission Baseline (2026-08). ONE-TIME seed.
 *
 * Source of truth: user_accounts + employee_profiles (Organization Master).
 * Does NOT read checklist_permission_grants (traced separately: only 7 broad
 * grants, no direct_reports/employees-level relationships worth bootstrapping
 * from — see 2026-08-11 KNL Permission Clean trace report).
 *
 * Classification policy (PHF-approved, see "PHF KNL — INITIAL PERMISSION SEED
 * SAU KHI PERMISSION CLEAN"):
 *   - role='admin' in user_accounts          -> SKIP (admin_recovery path in
 *                                                lib/knl-permissions.js already
 *                                                grants full access; creating a
 *                                                grant row here would risk an
 *                                                accidental income_view=false
 *                                                override, see resolveAdminIncomeViewOverride).
 *   - no employee_code / no active profile / inactive account -> SKIP.
 *   - department === 'Bộ phận bán hàng' AND title contains 'Trưởng ca'
 *                                              -> preset TRUONG_CA_CHTR,
 *                                                 peopleScope sales_all_branches
 *                                                 (dynamic, all 3 branches, no
 *                                                 materialized employee list —
 *                                                 multiple Trưởng ca naturally
 *                                                 share the same sales roster).
 *   - title matches /Trưởng phòng|Trưởng nhóm|Trưởng bộ phận/
 *                                              -> preset TRUONG_BO_PHAN,
 *                                                 peopleScope department =
 *                                                 [their own real department
 *                                                 string, dynamic not snapshot].
 *   - title contains 'Giám đốc'                -> preset TRO_LY_GD (matches
 *                                                 all_company view/access,
 *                                                 income_view stays false).
 *   - everyone else (incl. the 3 named exception accounts — never referenced
 *     by employee_code in this script, they simply fall into this default
 *     bucket like anyone else) -> preset NHAN_VIEN, peopleScope self.
 *
 * income_view / incomeScope / manage_framework / manage_permissions /
 * propose / agree_proposal / approve: NEVER set true by this seed for anyone.
 * Admin configures those manually afterward via Phân quyền KNL.
 *
 * Idempotent: any account_id with an existing ACTIVE knl_permission_grants row
 * is skipped entirely (never upserted/overwritten), regardless of how it got
 * there (this run or a prior one, or Admin's own manual configuration).
 *
 * Usage: node scripts/phf-knl-initial-permission-seed-2026-08.js --preview
 *        node scripts/phf-knl-initial-permission-seed-2026-08.js --write
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { upsertKnlPermissionGrant } = require('../lib/knl-permissions');

const url = String(process.env.SUPABASE_URL || '').trim();
const secret = String(process.env.SUPABASE_SECRET_KEY || '').trim();
if (!url || !secret) { console.error('Missing Supabase Production environment.'); process.exit(1); }
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

const REASON = 'PHF KNL initial permission baseline 2026-08';
const SYSTEM_SESSION = { role: 'admin', account: { id: 'system-knl-initial-seed-2026-08', name: 'PHF KNL Initial Permission Baseline' } };
const TBP_TITLE_PATTERN = /Trưởng phòng|Trưởng nhóm|Trưởng bộ phận/i;
const SALES_DEPARTMENT = 'Bộ phận bán hàng';

function text(v) { return String(v == null ? '' : v).trim(); }

function classify(account, profile) {
  if (String(account.role).toLowerCase() === 'admin') return { classification: 'ADMIN_SKIP' };
  const code = text(account.employee_code).toUpperCase();
  if (!code) return { classification: 'NO_EMPLOYEE_CODE_SKIP' };
  if (account.status !== 'active') return { classification: 'INACTIVE_ACCOUNT_SKIP' };
  if (!profile || profile.employment_status !== 'active') return { classification: 'NO_ACTIVE_PROFILE_SKIP' };
  const title = text(profile.title);
  const department = text(profile.department);
  if (department === SALES_DEPARTMENT && /Trưởng ca/i.test(title)) {
    return { classification: 'TRUONG_CA_SALES', presetCode: 'TRUONG_CA_CHTR', capabilities: { access_knl: true, view_people: true }, peopleScope: { type: 'sales_all_branches', values: [] } };
  }
  if (TBP_TITLE_PATTERN.test(title)) {
    return { classification: 'TBP', presetCode: 'TRUONG_BO_PHAN', capabilities: { access_knl: true, view_people: true }, peopleScope: { type: 'department', values: [department] } };
  }
  if (/Giám đốc/i.test(title)) {
    return { classification: 'GIAM_DOC', presetCode: 'TRO_LY_GD', capabilities: { access_knl: true, view_people: true }, peopleScope: { type: 'all_company', values: [] } };
  }
  return { classification: 'EMPLOYEE_SELF', presetCode: 'NHAN_VIEN', capabilities: { access_knl: true, view_people: true }, peopleScope: { type: 'self', values: [] } };
}

module.exports = { classify, SALES_DEPARTMENT, TBP_TITLE_PATTERN };

async function main() {
  const mode = process.argv.includes('--write') ? 'write' : 'preview';

  const [accRes, profRes, grantRes] = await Promise.all([
    db.from('user_accounts').select('id,name,email,employee_code,role,status'),
    db.from('employee_profiles').select('employee_code,title,department,branch,employment_status'),
    db.from('knl_permission_grants').select('account_id').eq('is_active', true),
  ]);
  for (const r of [accRes, profRes, grantRes]) if (r.error) throw r.error;
  const accounts = accRes.data || [], profiles = profRes.data || [];
  const profByCode = new Map(profiles.map(p => [text(p.employee_code).toUpperCase(), p]));
  const existingGrantAccountIds = new Set((grantRes.data || []).map(g => g.account_id));

  const plan = [];
  accounts.forEach(a => {
    const profile = profByCode.get(text(a.employee_code).toUpperCase());
    const result = classify(a, profile);
    plan.push({ account: a, profile, ...result });
  });

  const counts = {};
  plan.forEach(p => { counts[p.classification] = (counts[p.classification] || 0) + 1; });

  const alreadyGranted = plan.filter(p => existingGrantAccountIds.has(p.account.id));
  const toWrite = plan.filter(p => p.capabilities && !existingGrantAccountIds.has(p.account.id));

  console.log('=== PREVIEW: PHF KNL Initial Permission Baseline 2026-08 ===');
  console.log('Total user_accounts:', accounts.length);
  console.log('Classification counts:', counts);
  console.log('Accounts that already have an active KNL grant (will be SKIPPED, never overwritten):', alreadyGranted.length);
  alreadyGranted.forEach(p => console.log('  SKIP (existing grant):', p.account.email, p.account.employee_code));
  console.log('\nAccounts to be seeded this run:', toWrite.length);
  ['TRUONG_CA_SALES', 'TBP', 'GIAM_DOC'].forEach(cls => {
    const rows = toWrite.filter(p => p.classification === cls);
    if (rows.length) {
      console.log('\n' + cls + ' (' + rows.length + '):');
      rows.forEach(p => console.log('  ', p.account.email, p.account.employee_code, p.profile.department, p.profile.title));
    }
  });
  console.log('\nEMPLOYEE_SELF count (incl. any of the 3 named exception accounts, not special-cased in code):', toWrite.filter(p => p.classification === 'EMPLOYEE_SELF').length);
  console.log('ADMIN_SKIP:', plan.filter(p => p.classification === 'ADMIN_SKIP').length, '(no grant row created — relies on existing admin_recovery path)');
  console.log('NO_ACTIVE_PROFILE_SKIP:', plan.filter(p => p.classification === 'NO_ACTIVE_PROFILE_SKIP').length);
  console.log('INACTIVE_ACCOUNT_SKIP:', plan.filter(p => p.classification === 'INACTIVE_ACCOUNT_SKIP').length);
  console.log('NO_EMPLOYEE_CODE_SKIP:', plan.filter(p => p.classification === 'NO_EMPLOYEE_CODE_SKIP').length);

  ['PHF010', 'PHF004', 'PHF032'].forEach(code => {
    const row = plan.find(p => text(p.account.employee_code).toUpperCase() === code);
    console.log('\nNamed exception ' + code + ':', row ? { classification: row.classification, peopleScope: row.peopleScope, willWrite: toWrite.includes(row) } : 'NOT FOUND');
  });

  if (mode === 'preview') { console.log('\n(Preview only — pass --write to actually create grants.)'); return; }

  console.log('\n=== WRITING ===');
  const created = [];
  for (const p of toWrite) {
    const { grant } = await upsertKnlPermissionGrant(SYSTEM_SESSION, {
      accountId: p.account.id,
      employeeCode: p.account.employee_code,
      employeeName: p.account.name,
      presetCode: p.presetCode,
      capabilities: p.capabilities,
      peopleScope: p.peopleScope,
      reason: REASON,
    });
    created.push({ accountId: p.account.id, employeeCode: p.account.employee_code, classification: p.classification, grantId: grant.id });
  }
  console.log('Created', created.length, 'grants.');
  console.log('Skipped (already had a grant):', alreadyGranted.length);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
