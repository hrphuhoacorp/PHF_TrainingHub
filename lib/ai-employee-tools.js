'use strict';

/* PHF AI Sandbox - Organization Directory adapter cho DeepSeek tool-calling.
   Nguon danh tinh: lib/org-directory.js (canonical, doc lap voi Checklist/
   KNL - xem ghi chu dau file do). Day la thong tin co cau to chuc DUNG
   CHUNG (ho ten/chuc danh/phong ban/chi nhanh/quan ly truc tiep/bao cao cho
   ai), MO CHO CA 3 ROLE (admin/manager/learner) theo chinh sach PHF da chot
   - KHONG con yeu cau grant Checklist view_reports nhu truoc batch nay.
   Du lieu nhay cam (luong/BHXH/danh gia ca nhan/quyen quan tri he thong)
   KHONG di qua file nay va KHONG bi anh huong - van theo dung permission
   rieng cua tung module (Checklist/KNL/Training). KHONG tao permission
   engine moi, KHONG tu query Supabase - moi ham o day chi la lop mong goi
   lai lib/org-directory.js.

   Gioi han da biet (ke thua tu nguon checklist_employee_assignments): nhan
   vien chua tung duoc Admin nhap vao bang phan cong nay se KHONG xuat hien
   - bang nay la nguon nhan su rong nhat he thong dang co, nhung CHUA co
   bang chung bao phu 100% nhan vien PHF. */

const orgDirectory = require('./org-directory');

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

// publicEmployee: reshape publicPerson() cua org-directory.js sang dung
// contract da co san cho AI/UI (field "employeeStatus" giu nguyen, KHONG
// them managerCode/managerName vao day de khong doi shape cac cau tra loi
// list/profile da co - 2 field do chi dung o cac tool quan he moi ben duoi).
function publicEmployee(p) {
  if (!p) return null;
  return {
    employeeCode: p.employeeCode || '',
    employeeName: p.employeeName || '',
    title: p.title || '',
    department: p.department || '',
    branch: p.branch || '',
    employeeStatus: p.employeeStatus || ''
  };
}

async function searchEmployees(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const limit = clampLimit(input.limit, DEFAULT_SEARCH_LIMIT);
  const result = await orgDirectory.searchOrgPeople(session, {
    name: cleanFilter(input.query || input.name),
    employeeCode: cleanEmployeeCode(input.employeeCode),
    department: cleanFilter(input.department),
    branch: cleanFilter(input.branch),
    title: cleanFilter(input.title),
    manager: cleanFilter(input.manager),
    limit
  });
  return {
    asOf: result.asOf,
    total: result.total,
    employees: (result.people || []).map(publicEmployee)
  };
}

async function getEmployeeProfile(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const employeeCode = cleanEmployeeCode(input.employeeCode);
  const asOf = new Date().toISOString();
  if (!employeeCode) return { found: false, employeeCode: '', asOf, profile: null };

  const result = await orgDirectory.getEmployeeProfile(session, { employeeCode });
  if (!result.found) return { found: false, employeeCode, asOf: result.asOf, profile: null };
  return { found: true, employeeCode, asOf: result.asOf, profile: publicEmployee(result.person) };
}

function cleanPersonRef(input) {
  return {
    employeeCode: cleanEmployeeCode(input.employeeCode),
    name: cleanFilter(input.name || input.employeeName)
  };
}

// getEmployeeManager: "A bao cao cho ai / ai quan ly A". Chap nhan
// employeeCode CHINH XAC hoac name tu do - neu name khop nhieu nguoi, tra
// ambiguous:true kem candidates de AI hoi lai (khong tu doan 1 nguoi).
async function getEmployeeManager(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const ref = cleanPersonRef(input);
  if (!ref.employeeCode && !ref.name) return { asOf: new Date().toISOString(), found: false, ambiguous: false, employee: null, manager: null };
  const result = await orgDirectory.getManagerOf(session, ref);
  return {
    asOf: result.asOf, found: result.found, ambiguous: result.ambiguous,
    candidates: (result.candidates || []).map(publicEmployee),
    employee: publicEmployee(result.employee),
    manager: result.manager ? publicEmployee(result.manager) : null
  };
}

// getDirectReportsOf: "ai bao cao cho B / B quan ly nhung ai".
async function getDirectReportsOf(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const ref = cleanPersonRef(input);
  if (!ref.employeeCode && !ref.name) return { asOf: new Date().toISOString(), found: false, ambiguous: false, manager: null, reports: [] };
  const result = await orgDirectory.getDirectReports(session, ref);
  return {
    asOf: result.asOf, found: result.found, ambiguous: result.ambiguous,
    candidates: (result.candidates || []).map(publicEmployee),
    manager: publicEmployee(result.manager),
    reports: (result.reports || []).map(publicEmployee)
  };
}

// getManagementChainOf: "tuyen quan ly cua A tu duoi len tren".
async function getManagementChainOf(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const ref = cleanPersonRef(input);
  if (!ref.employeeCode && !ref.name) return { asOf: new Date().toISOString(), found: false, ambiguous: false, employee: null, chain: [] };
  const result = await orgDirectory.getManagementChain(session, ref);
  return {
    asOf: result.asOf, found: result.found, ambiguous: result.ambiguous,
    candidates: (result.candidates || []).map(publicEmployee),
    employee: publicEmployee(result.employee),
    chain: (result.chain || []).map(publicEmployee),
    truncated: !!result.truncated
  };
}

async function getDepartmentDirectory(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const result = await orgDirectory.getDepartmentDirectory(session, { department: cleanFilter(input.department) });
  return {
    asOf: result.asOf, department: result.department, available: result.available,
    total: result.total, members: (result.members || []).map(publicEmployee), titles: result.titles || []
  };
}

async function getBranchDirectory(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const result = await orgDirectory.getBranchDirectory(session, { branch: cleanFilter(input.branch) });
  return {
    asOf: result.asOf, branch: result.branch, available: result.available,
    total: result.total, members: (result.members || []).map(publicEmployee), titles: result.titles || []
  };
}

module.exports = {
  searchEmployees,
  getEmployeeProfile,
  getEmployeeManager,
  getDirectReportsOf,
  getManagementChainOf,
  getDepartmentDirectory,
  getBranchDirectory
};
