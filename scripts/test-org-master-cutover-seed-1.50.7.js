'use strict';

/* Contract/regression tests for lib/org-master-cutover.js — pure logic,
   no Supabase/DB dependency, safe to run anytime (does not touch
   Production). Covers the guarantees PHF required for the bootstrap seed:
   exhaustive status mapping (no invented labels), manager resolution that
   stops rather than guesses, and conflict-safe idempotent classification. */

const assert = require('assert');
const { mapEmploymentStatus, resolveManager, buildUniverse, classifySeedRow } = require('../lib/org-master-cutover');

function t(name, fn) { try { fn(); console.log('PASS', name); } catch (e) { console.error('FAIL', name, '-', e.message); process.exitCode = 1; } }

t('mapEmploymentStatus: exact traced values map correctly', () => {
  assert.deepStrictEqual(mapEmploymentStatus('Đang làm việc'), { ok: true, status: 'active' });
  assert.deepStrictEqual(mapEmploymentStatus('Đã nghỉ việc'), { ok: true, status: 'inactive' });
});

t('mapEmploymentStatus: unknown value is refused, not guessed', () => {
  const r = mapEmploymentStatus('Tạm nghỉ thai sản');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, null);
});

t('mapEmploymentStatus: empty value is refused', () => {
  assert.strictEqual(mapEmploymentStatus('').ok, false);
});

const sampleRows = [
  { employee_code: 'A001', employee_name: 'Nguyen Van A', manager_code: '', manager_name: '' },
  { employee_code: 'A002', employee_name: 'Tran Thi B', manager_code: 'A001', manager_name: 'Nguyen Van A' },
  { employee_code: 'A003', employee_name: 'Le Van C', manager_code: '', manager_name: 'Nguyen Van A' },
  { employee_code: 'A004', employee_name: 'Pham Thi D', manager_code: 'ZZZZ', manager_name: 'Ghost Manager' },
  { employee_code: 'A005', employee_name: 'Nguyen Van A', manager_code: '', manager_name: '' }, // duplicate name of A001
  { employee_code: 'A006', employee_name: 'Hoang E', manager_code: '', manager_name: 'Nguyen Van A' } // now ambiguous vs A001/A005
];

t('resolveManager: manager_code present and valid resolves directly', () => {
  const { universeByCode, nameIndex } = buildUniverse(sampleRows);
  const r = resolveManager(sampleRows[1], universeByCode, nameIndex);
  assert.deepStrictEqual(r, { resolved: true, via: 'manager_code', managerEmployeeCode: 'A001' });
});

t('resolveManager: no manager_code and no manager_name is resolved as none (nothing to guess)', () => {
  const { universeByCode, nameIndex } = buildUniverse(sampleRows);
  const r = resolveManager(sampleRows[0], universeByCode, nameIndex);
  assert.deepStrictEqual(r, { resolved: true, via: 'none', managerEmployeeCode: '' });
});

t('resolveManager: manager_code set but not found in universe is unresolved, never falls back to name', () => {
  const { universeByCode, nameIndex } = buildUniverse(sampleRows);
  const r = resolveManager(sampleRows[3], universeByCode, nameIndex);
  assert.strictEqual(r.resolved, false);
});

t('resolveManager: manager_name alone, unique match, resolves via name fallback', () => {
  const twoRowUniverse = [sampleRows[0], sampleRows[2]];
  const { universeByCode, nameIndex } = buildUniverse(twoRowUniverse);
  const r = resolveManager(sampleRows[2], universeByCode, nameIndex);
  assert.deepStrictEqual(r, { resolved: true, via: 'manager_name_unique', managerEmployeeCode: 'A001' });
});

t('resolveManager: manager_name ambiguous (2+ candidates) is unresolved — must STOP, never guess', () => {
  const { universeByCode, nameIndex } = buildUniverse(sampleRows);
  const r = resolveManager(sampleRows[5], universeByCode, nameIndex);
  assert.strictEqual(r.resolved, false);
  assert.ok(/ambiguous/.test(r.reason));
});

t('classifySeedRow: no existing profile -> SEED', () => {
  const target = { department: 'D', title: 'T', branch: 'B', managerEmployeeCode: 'A001', employmentStatus: 'active' };
  assert.strictEqual(classifySeedRow(target, null).bucket, 'SEED');
});

t('classifySeedRow: existing profile with all-empty org fields -> SEED (nothing to protect)', () => {
  const target = { department: 'D', title: 'T', branch: 'B', managerEmployeeCode: 'A001', employmentStatus: 'active' };
  const existing = { department: '', title: '', branch: '', managerEmployeeCode: '', employmentStatus: 'active' };
  assert.strictEqual(classifySeedRow(target, existing).bucket, 'SEED');
});

t('classifySeedRow: existing profile matches target exactly -> UNCHANGED, idempotent', () => {
  const target = { department: 'D', title: 'T', branch: 'B', managerEmployeeCode: 'A001', employmentStatus: 'active' };
  const existing = { department: 'D', title: 'T', branch: 'B', managerEmployeeCode: 'A001', employmentStatus: 'active' };
  assert.strictEqual(classifySeedRow(target, existing).bucket, 'UNCHANGED');
});

t('classifySeedRow: existing non-empty org value differs from target -> CONFLICT, never overwritten', () => {
  const target = { department: 'D2', title: 'T', branch: 'B', managerEmployeeCode: 'A001', employmentStatus: 'active' };
  const existing = { department: 'D1', title: 'T', branch: 'B', managerEmployeeCode: 'A001', employmentStatus: 'active' };
  const result = classifySeedRow(target, existing);
  assert.strictEqual(result.bucket, 'CONFLICT');
  assert.strictEqual(result.diffs[0].field, 'department');
});

t('classifySeedRow: existing customized (non-default) status differing from target -> CONFLICT, not silently flipped', () => {
  const target = { department: '', title: '', branch: '', managerEmployeeCode: '', employmentStatus: 'active' };
  const existing = { department: '', title: '', branch: '', managerEmployeeCode: '', employmentStatus: 'inactive' };
  assert.strictEqual(classifySeedRow(target, existing).bucket, 'CONFLICT');
});

t('classifySeedRow: default status (never customized) + target differs -> SEED, safe to update', () => {
  const target = { department: '', title: '', branch: '', managerEmployeeCode: '', employmentStatus: 'inactive' };
  const existing = { department: '', title: '', branch: '', managerEmployeeCode: '', employmentStatus: 'active' };
  assert.strictEqual(classifySeedRow(target, existing).bucket, 'SEED');
});

if (process.exitCode) { console.error('\nSome tests FAILED'); } else { console.log('\nAll org-master-cutover-seed tests PASSED'); }
