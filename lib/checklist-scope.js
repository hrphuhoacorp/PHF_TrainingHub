'use strict';

/*
 * SOURCE OF TRUTH duy nhất cho "một nhân sự (subject) có thuộc một scope
 * phân quyền Checklist hay không". Trước AR-05, lib/checklist-permissions.js
 * (view_monthly/review_monthly/view_reports/export_data) và
 * lib/checklist-violations.js (view_violations/record_violation) mỗi bên tự
 * viết một bản matcher riêng, lệch nhau dần theo thời gian (không hiểu
 * 'employees' số nhiều, không parse tag department::/branch::, chuẩn hóa dấu
 * tiếng Việt khác nhau) - gây Silent Denial cho Ghi nhận lỗi/Nhật ký lỗi dù
 * grant hợp lệ (AR-04). Từ nay chỉ còn một hàm subjectMatchesScope() ở đây;
 * cả hai file trên đều require từ module này, không ai tự giữ bản sao.
 *
 * Hàm ở đây chỉ SO KHỚP lúc đọc - không throw khi type/values không hợp lệ
 * (trả về false = không khớp), để một dòng dữ liệu hỏng không làm sập cả
 * lượt lọc danh sách. Việc validate nghiêm ngặt lúc LƯU quyền (bắt buộc
 * type nằm trong SCOPE_TYPES, bắt buộc values khi cần...) vẫn là trách
 * nhiệm riêng của normalizeGrant()/scope() trong checklist-permissions.js -
 * đó là kiểm tra đầu vào lúc ghi, khác với so khớp lúc đọc ở đây.
 */

const SCOPE_TYPES = Object.freeze(new Set([
  'none', 'all_company', 'direct_reports', 'department', 'branch', 'department_branch', 'employees'
]));

function normalizeScopeText(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
}

const DEPARTMENT_KEYWORD_PATTERN = /ban hang|kho|marketing|hcns|qtth|ke toan|goi qua|thu mua|online|cskh/;

function subjectMatchesScope(subject, scopeValue, identity) {
  const raw = scopeValue && typeof scopeValue === 'object' ? scopeValue : {};
  const type = String(raw.type || 'none').toLowerCase();
  const rawValues = Array.isArray(raw.values) ? raw.values : [];
  const person = subject || {};
  const id = identity || {};

  if (type === 'all_company') return true;
  if (type === 'none') return false;
  if (!SCOPE_TYPES.has(type)) return false;

  if (type === 'direct_reports') {
    return Boolean(
      (id.id && String(person.manager_id || '') === String(id.id)) ||
      (id.employeeCode && String(person.manager_code || '').toUpperCase() === String(id.employeeCode).toUpperCase())
    );
  }

  const values = rawValues.map(normalizeScopeText);

  if (type === 'employees') {
    return values.includes(normalizeScopeText(person.employee_code)) || values.includes(normalizeScopeText(person.employee_id));
  }
  if (type === 'department') return values.includes(normalizeScopeText(person.department));
  if (type === 'branch') return values.includes(normalizeScopeText(person.branch));

  // type === 'department_branch'
  const department = normalizeScopeText(person.department);
  const branch = normalizeScopeText(person.branch);
  const taggedDepartments = rawValues
    .filter(v => /^department::/i.test(v))
    .map(v => normalizeScopeText(String(v).replace(/^department::/i, '')));
  const taggedBranches = rawValues
    .filter(v => /^branch::/i.test(v))
    .map(v => normalizeScopeText(String(v).replace(/^branch::/i, '')));
  if (taggedDepartments.length || taggedBranches.length) {
    return (!taggedDepartments.length || taggedDepartments.includes(department)) &&
           (!taggedBranches.length || taggedBranches.includes(branch));
  }
  if (!values.length) return false;
  const departmentValues = values.filter(v => DEPARTMENT_KEYWORD_PATTERN.test(v));
  const branchValues = values.filter(v => !departmentValues.includes(v));
  return (!departmentValues.length || departmentValues.includes(department)) &&
         (!branchValues.length || branchValues.includes(branch));
}

module.exports = { SCOPE_TYPES, normalizeScopeText, subjectMatchesScope };
