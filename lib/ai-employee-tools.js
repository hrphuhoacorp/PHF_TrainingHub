'use strict';

/* PHF AI Sandbox - Employee READ-ONLY adapter cho DeepSeek tool-calling.
   Nguon danh tinh: checklist_employee_assignments qua
   getChecklistReportAccess() (lib/checklist-permissions.js) - CUNG ham,
   CUNG quyen voi get_checklist_lowest_employees (lib/ai-checklist-tools.js)
   va man Bao cao Checklist. KHONG tao permission engine moi, KHONG tu
   query Supabase. Xem TRACE report (Employee Identity) cho ly do chon
   nguon nay va gioi han da biet (nhan vien chi co trong Training Hub,
   chua tung duoc phan Checklist, se khong xuat hien o day). */

const { getChecklistReportAccess } = require('./checklist-permissions');

const MIN_LIMIT = 1;
const MAX_LIMIT = 10;
const DEFAULT_SEARCH_LIMIT = 5;
const MAX_FILTER_CHARS = 80;
const MAX_EMPLOYEE_CODE_CHARS = 32;

function cleanFilter(value) {
  return String(value == null ? '' : value).trim().slice(0, MAX_FILTER_CHARS);
}
function cleanEmployeeCode(value) {
  return String(value == null ? '' : value).trim().slice(0, MAX_EMPLOYEE_CODE_CHARS).toUpperCase();
}
function clampLimit(value, fallback) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, parsed));
}
function normalizeText(value) {
  return String(value == null ? '' : value)
    .trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Output whitelist CO CHU DICH: khong bao gio forward phone/email/salary/
// CCCD/auth - nguon publicAssignment() von da khong co cac field nay, o day
// chi pick ro rang de tuong lai neu nguon doi shape van khong vo tinh leak.
function publicEmployee(row) {
  return {
    employeeCode: row.employeeCode || '',
    employeeName: row.employeeName || '',
    title: row.title || '',
    department: row.department || '',
    branch: row.branch || '',
    employeeStatus: row.employeeStatus || ''
  };
}

async function searchEmployees(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const limit = clampLimit(input.limit, DEFAULT_SEARCH_LIMIT);
  const query = normalizeText(cleanFilter(input.query));
  const department = cleanFilter(input.department);
  const branch = cleanFilter(input.branch);

  const access = await getChecklistReportAccess(session);
  const people = Array.isArray(access.people) ? access.people : [];

  const filtered = people.filter(p => {
    if (department && normalizeText(p.department) !== normalizeText(department)) return false;
    if (branch && normalizeText(p.branch) !== normalizeText(branch)) return false;
    if (query) {
      const haystack = normalizeText([p.employeeCode, p.employeeName, p.department, p.branch, p.title].join(' '));
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  return {
    asOf: new Date().toISOString(),
    total: filtered.length,
    employees: filtered.slice(0, limit).map(publicEmployee)
  };
}

async function getEmployeeProfile(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const employeeCode = cleanEmployeeCode(input.employeeCode);
  const asOf = new Date().toISOString();
  if (!employeeCode) return { found: false, employeeCode: '', asOf, profile: null };

  const access = await getChecklistReportAccess(session);
  const people = Array.isArray(access.people) ? access.people : [];
  const match = people.find(p => String(p.employeeCode || '').toUpperCase() === employeeCode);
  if (!match) return { found: false, employeeCode, asOf, profile: null };

  return { found: true, employeeCode, asOf, profile: publicEmployee(match) };
}

module.exports = { searchEmployees, getEmployeeProfile };
