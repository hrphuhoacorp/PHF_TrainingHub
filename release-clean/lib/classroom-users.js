'use strict';

const { readData } = require('./db');
const { listHubAccountSummaries } = require('./auth');

function text(value) { return String(value == null ? '' : value).trim(); }
function norm(value) { return text(value).toLowerCase(); }
function digits(value) { return text(value).replace(/\D/g, ''); }
function pick(obj, keys) {
  for (const key of keys) {
    const value = obj && obj[key];
    if (value !== undefined && value !== null && text(value)) return text(value);
  }
  return '';
}
function employeeId(employee) { return pick(employee, ['id','employeeId','employee_id']); }
function employeeCode(employee) { return pick(employee, ['employeeCode','employee_code','code']); }
function employeeName(employee) { return pick(employee, ['fullName','full_name','name']); }
function employeeEmail(employee) { return pick(employee, ['email','personalEmail','personal_email','workEmail','work_email']); }
function employeePhone(employee) { return pick(employee, ['phone','phoneNumber','phone_number','mobile']); }

function safeUser(account, employee) {
  return {
    accountId: text(account.id),
    employeeId: employeeId(employee) || text(account.employeeId),
    employeeCode: employeeCode(employee) || text(account.employeeCode),
    fullName: employeeName(employee) || text(account.name) || text(account.email) || 'Nhân sự',
    email: employeeEmail(employee) || text(account.email),
    phone: employeePhone(employee) || text(account.phone),
    role: text(account.role) || 'learner',
    status: text(account.status) || 'active',
    accountType: text(account.accountType) || 'employee',
    trainingAudience: text(account.trainingAudience),
    defaultProgram: text(account.defaultProgram),
    hubAssignmentStatus: text(account.hubAssignmentStatus) || 'not_activated',
    department: pick(employee, ['department','departmentName','department_name','team']),
    position: pick(employee, ['position','positionName','position_name','roleName','jobTitle','job_title']),
    branch: pick(employee, ['branch','branchName','branch_name','location','store'])
  };
}

async function listClassroomUsers(session) {
  const role = norm(session && session.role);
  if (!['admin','manager'].includes(role)) {
    const error = new Error('Tài khoản không có quyền xem danh sách nhân sự Classroom.');
    error.code = 'CLASSROOM_USER_LIST_FORBIDDEN';
    error.statusCode = 403;
    throw error;
  }

  const [data, accounts] = await Promise.all([
    readData({ role: session.role, activityLimit: 1 }),
    listHubAccountSummaries()
  ]);
  const employees = Array.isArray(data && data.employees) ? data.employees : [];
  const byId = new Map();
  const byCode = new Map();
  const byEmail = new Map();
  const byPhone = new Map();
  employees.forEach(employee => {
    const id = employeeId(employee); if (id) byId.set(id, employee);
    const code = norm(employeeCode(employee)); if (code) byCode.set(code, employee);
    const email = norm(employeeEmail(employee)); if (email) byEmail.set(email, employee);
    const phone = digits(employeePhone(employee)); if (phone) byPhone.set(phone, employee);
  });

  const seen = new Set();
  const users = [];
  (accounts || []).forEach(account => {
    if (!account) return;
    if (norm(account.accountType) !== 'employee') return;
    if (norm(account.status) !== 'active') return;
    if (!['new_sales','phf_class'].includes(norm(account.defaultProgram))) return;
    const employee = byId.get(text(account.employeeId)) ||
      byCode.get(norm(account.employeeCode)) ||
      byEmail.get(norm(account.email)) ||
      byPhone.get(digits(account.phone));
    if (!employee) return;
    const user = safeUser(account, employee);
    const key = user.accountId || user.employeeId;
    if (!key || seen.has(key)) return;
    seen.add(key);
    users.push(user);
  });

  users.sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'));
  return users;
}

module.exports = { listClassroomUsers };
