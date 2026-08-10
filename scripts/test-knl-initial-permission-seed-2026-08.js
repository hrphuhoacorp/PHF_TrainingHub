'use strict';
/*
 * Regression test for the classification POLICY used by
 * scripts/phf-knl-initial-permission-seed-2026-08.js (the one-time initial
 * KNL permission baseline seed). Pure function test — does not touch
 * Production, does not call upsertKnlPermissionGrant.
 */
require('dotenv').config();
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'fake-secret-key';
const assert = require('assert');
const { classify, SALES_DEPARTMENT } = require('./phf-knl-initial-permission-seed-2026-08.js');
const { SALES_ALL_BRANCHES_DEPARTMENT } = require('../lib/knl-scope');

assert.strictEqual(SALES_DEPARTMENT, SALES_ALL_BRANCHES_DEPARTMENT, 'seed script and lib/knl-scope.js must agree on the real Sales department string — they must never drift apart');

function acc(overrides) { return Object.assign({ id: 'acc-1', name: 'Test', employee_code: 'PHF001', role: 'learner', status: 'active' }, overrides); }
function prof(overrides) { return Object.assign({ title: 'Nhân viên', department: 'Kho', employment_status: 'active' }, overrides); }

// CASE: Admin account -> SKIP, no grant row (relies on admin_recovery path).
assert.strictEqual(classify(acc({ role: 'admin' }), prof()).classification, 'ADMIN_SKIP', 'admin accounts must never get a grant row seeded (income_view override risk)');

// CASE: no employee_code -> SKIP.
assert.strictEqual(classify(acc({ employee_code: '' }), prof()).classification, 'NO_EMPLOYEE_CODE_SKIP');

// CASE: inactive account -> SKIP.
assert.strictEqual(classify(acc({ status: 'inactive' }), prof()).classification, 'INACTIVE_ACCOUNT_SKIP');

// CASE: no active profile -> SKIP.
assert.strictEqual(classify(acc(), null).classification, 'NO_ACTIVE_PROFILE_SKIP');
assert.strictEqual(classify(acc(), prof({ employment_status: 'inactive' })).classification, 'NO_ACTIVE_PROFILE_SKIP');

// CASE: Trưởng ca in the real Sales department -> sales_all_branches, dynamic, no employee list.
{
  const result = classify(acc(), prof({ title: 'Trưởng ca', department: SALES_DEPARTMENT }));
  assert.strictEqual(result.classification, 'TRUONG_CA_SALES');
  assert.strictEqual(result.presetCode, 'TRUONG_CA_CHTR');
  assert.deepStrictEqual(result.peopleScope, { type: 'sales_all_branches', values: [] });
  assert.strictEqual(result.capabilities.income_view, undefined, 'income_view must never be set true by the seed');
}

// CASE: Trưởng ca in a NON-sales department must NOT get sales_all_branches (title alone is not enough).
{
  const result = classify(acc(), prof({ title: 'Trưởng ca', department: 'Bộ phận kho vận' }));
  assert.notStrictEqual(result.classification, 'TRUONG_CA_SALES', 'sales_all_branches must require BOTH the Sales department AND the Trưởng ca title, not title alone');
}

// CASE: TBP-style title -> department scope, using the REAL department string, not a snapshot/guess.
{
  const result = classify(acc(), prof({ title: 'QTTH/HCNS – Trưởng bộ phận', department: 'Bộ phận Quản trị tổng hợp' }));
  assert.strictEqual(result.classification, 'TBP');
  assert.strictEqual(result.presetCode, 'TRUONG_BO_PHAN');
  assert.deepStrictEqual(result.peopleScope, { type: 'department', values: ['Bộ phận Quản trị tổng hợp'] });
}

// CASE: Giám đốc title -> all_company view, but still no income_view/manage capabilities.
{
  const result = classify(acc(), prof({ title: 'Giám đốc điều hành', department: 'Ban giám đốc' }));
  assert.strictEqual(result.classification, 'GIAM_DOC');
  assert.deepStrictEqual(result.peopleScope, { type: 'all_company', values: [] });
  assert.strictEqual(result.capabilities.manage_framework, undefined);
  assert.strictEqual(result.capabilities.manage_permissions, undefined);
}

// CASE (Acceptance 5/6/7): the 3 named exception accounts get NO special-casing anywhere in
// this file (never referenced by employee_code) — a "Quản lý"/generic title in Ban giám đốc
// falls into the same default bucket as any other regular employee: self scope only.
['PHF010', 'PHF004', 'PHF032'].forEach(code => {
  const result = classify(acc({ employee_code: code }), prof({ title: 'Quản lý', department: 'Ban giám đốc' }));
  assert.strictEqual(result.classification, 'EMPLOYEE_SELF', code + ' must resolve through the generic default policy, not a hard-coded exception');
  assert.deepStrictEqual(result.peopleScope, { type: 'self', values: [] }, code + ' must never auto-receive a broader scope than self');
  assert.strictEqual(result.capabilities.income_view, undefined, code + ' must never auto-receive income_view');
});

// CASE: plain employee with no special title -> self scope (baseline default).
{
  const result = classify(acc(), prof());
  assert.strictEqual(result.classification, 'EMPLOYEE_SELF');
  assert.strictEqual(result.presetCode, 'NHAN_VIEN');
  assert.deepStrictEqual(result.peopleScope, { type: 'self', values: [] });
}

console.log('PASS KNL initial permission seed 2026-08: classification policy matches PHF-approved baseline for every required case, including the 3 named exceptions resolving through the generic default (no hard-coded scope).');
