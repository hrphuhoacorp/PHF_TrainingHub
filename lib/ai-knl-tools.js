'use strict';

/* PHF AI Sandbox - KNL READ-ONLY adapter cho DeepSeek tool-calling.
   Dung LAI dung listKnlPeople() (lib/knl-people.js) - adapter DUY NHAT ma
   frontend KNL va api/data.js duoc phep di qua, tu resolve quyen qua
   resolveActorGrant()/requireAccessKnl()/view_people (lib/knl-permissions.js).
   KHONG tao permission engine moi, KHONG tu query Supabase.
   KNL Step 2 (danh gia nang luc, gap nang luc, M1-M4) CHUA ton tai trong he
   thong (xem TRACE report) - tool nay KHONG bia diem assessment/gap, tra
   assessment:null tuong minh de model khong tu suy dien. */

const { listKnlPeople } = require('./knl-people');

const MAX_EMPLOYEE_CODE_CHARS = 32;
const MIN_LIMIT = 1;
const MAX_LIMIT = 10;
const DEFAULT_SEARCH_LIMIT = 5;
const MAX_FILTER_CHARS = 80;

function cleanEmployeeCode(value) {
  return String(value == null ? '' : value).trim().slice(0, MAX_EMPLOYEE_CODE_CHARS).toUpperCase();
}
function cleanFilter(value) {
  return String(value == null ? '' : value).trim().slice(0, MAX_FILTER_CHARS);
}
function clampLimit(value, fallback) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, parsed));
}

function publicKnlProfile(row) {
  return {
    employeeCode: row.employeeCode || '',
    employeeName: row.employeeName || '',
    title: row.title || '',
    department: row.department || '',
    branch: row.branch || '',
    status: row.status || ''
  };
}

async function getKnlProfile(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const employeeCode = cleanEmployeeCode(input.employeeCode);
  const asOf = new Date().toISOString();
  if (!employeeCode) return { found: false, employeeCode: '', asOf, profile: null, assessment: null };

  const result = await listKnlPeople(session, { search: employeeCode });
  const people = Array.isArray(result.people) ? result.people : [];
  const match = people.find(p => String(p.employeeCode || '').toUpperCase() === employeeCode);
  if (!match) return { found: false, employeeCode, asOf, profile: null, assessment: null };

  return {
    found: true,
    employeeCode,
    asOf,
    profile: publicKnlProfile(match),
    assessment: null
  };
}

// Tim nhieu nguoi trong pham vi Khung nang luc theo ten/ma - dung LAI
// listKnlPeople() (lib/knl-people.js), giong pattern search_employees.
async function searchKnlPeople(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const limit = clampLimit(input.limit, DEFAULT_SEARCH_LIMIT);
  const search = cleanFilter(input.query);
  const department = cleanFilter(input.department);
  const branch = cleanFilter(input.branch);

  const result = await listKnlPeople(session, { search, department, branch });
  const people = Array.isArray(result.people) ? result.people : [];

  return {
    asOf: new Date().toISOString(),
    total: result.total || people.length,
    people: people.slice(0, limit).map(publicKnlProfile)
  };
}

module.exports = { getKnlProfile, searchKnlPeople };
