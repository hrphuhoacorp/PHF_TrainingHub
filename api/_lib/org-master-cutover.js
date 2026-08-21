'use strict';

/* Pure, DB-free logic for the Organization Master Cutover bootstrap seed
   (checklist_employee_assignments -> employee_profiles, one-time only).
   Kept separate from the seed script so it can be unit-tested without
   touching Production. See scripts/PHF_ORG_MASTER_CUTOVER_1.50.7.sql and
   scripts/phf-org-master-seed-from-checklist-1.50.7.js.

   STATUS_MAP is exhaustive of the distinct public.checklist_employee_
   assignments.employee_status values traced in Production on 2026-08-10
   (38x "Đang làm việc", 2x "Đã nghỉ việc" — no other value observed). Any
   value outside this map is refused, never guessed. */

const STATUS_MAP = { 'Đang làm việc': 'active', 'Đã nghỉ việc': 'inactive' };

function text(value) { return String(value == null ? '' : value).trim(); }
function code(value) { return text(value).toUpperCase(); }
function normName(value) { return text(value).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

function mapEmploymentStatus(checklistStatus) {
  const key = text(checklistStatus);
  if (Object.prototype.hasOwnProperty.call(STATUS_MAP, key)) return { ok: true, status: STATUS_MAP[key] };
  return { ok: false, status: null, reason: 'UNKNOWN_STATUS_VALUE:' + key };
}

// nameIndex: Map<normalizedName, employeeCode[]> built from the same universe as universeByCode.
function resolveManager(row, universeByCode, nameIndex) {
  const managerCode = code(row.manager_code);
  const managerName = text(row.manager_name);
  if (!managerCode && !managerName) return { resolved: true, via: 'none', managerEmployeeCode: '' };
  if (managerCode) {
    if (universeByCode.has(managerCode)) return { resolved: true, via: 'manager_code', managerEmployeeCode: managerCode };
    return { resolved: false, reason: 'manager_code not found in universe: ' + managerCode };
  }
  const matches = nameIndex.get(normName(managerName)) || [];
  if (matches.length === 1) return { resolved: true, via: 'manager_name_unique', managerEmployeeCode: matches[0] };
  return { resolved: false, reason: matches.length === 0 ? 'manager_name matches nobody' : ('manager_name ambiguous (' + matches.length + ' matches)') };
}

function buildUniverse(checklistRows) {
  const universe = checklistRows.filter(r => code(r.employee_code) !== 'ADMIN');
  const universeByCode = new Map(universe.map(r => [code(r.employee_code), r]));
  const nameIndex = new Map();
  universe.forEach(r => {
    const key = normName(r.employee_name);
    if (!nameIndex.has(key)) nameIndex.set(key, []);
    nameIndex.get(key).push(code(r.employee_code));
  });
  return { universe, universeByCode, nameIndex };
}

// existing: current employee_profiles row (or null-ish) with department/title/branch/managerEmployeeCode/employmentStatus.
// target: bootstrap values computed from checklist for this employee_code.
// ORG_DEFAULT_EMPTY fields (department/title/branch/managerEmployeeCode) default to '' on create;
// employmentStatus defaults to 'active' on create, so it needs its own untouched-vs-customized read.
function classifySeedRow(target, existing) {
  const orgFields = ['department', 'title', 'branch', 'managerEmployeeCode'];
  if (!existing) return { bucket: 'SEED', diffs: [] };

  const orgDiffs = orgFields.filter(f => text(existing[f]) && text(existing[f]) !== text(target[f]));
  if (orgDiffs.length) return { bucket: 'CONFLICT', diffs: orgDiffs.map(f => ({ field: f, existing: existing[f], target: target[f] })) };

  const statusCustomized = text(existing.employmentStatus) && text(existing.employmentStatus) !== 'active';
  if (statusCustomized && text(existing.employmentStatus) !== text(target.employmentStatus)) {
    return { bucket: 'CONFLICT', diffs: [{ field: 'employmentStatus', existing: existing.employmentStatus, target: target.employmentStatus }] };
  }

  const orgUnset = orgFields.every(f => !text(existing[f]));
  const anyOrgTarget = orgFields.some(f => text(target[f]));
  if (orgUnset && anyOrgTarget) return { bucket: 'SEED', diffs: [] };

  const matches = orgFields.every(f => text(existing[f]) === text(target[f])) && text(existing.employmentStatus) === text(target.employmentStatus);
  return { bucket: matches ? 'UNCHANGED' : 'SEED', diffs: [] };
}

module.exports = { STATUS_MAP, text, code, normName, mapEmploymentStatus, resolveManager, buildUniverse, classifySeedRow };
