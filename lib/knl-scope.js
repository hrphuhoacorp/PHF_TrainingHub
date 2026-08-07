'use strict';

/*
 * SOURCE OF TRUTH duy nhất cho "một nhân sự (subject) có thuộc phạm vi phân
 * quyền KNL của một actor hay không". Độc lập hoàn toàn với
 * lib/checklist-scope.js — KNL không tái sử dụng scope engine của Checklist,
 * chỉ tham khảo cấu trúc (xem PHF HR – KNL Step 1, mục 3 "REFERENCE ONLY").
 *
 * KNL_SCOPE_TYPES đã CHỐT nghiệp vụ (mục 6 của yêu cầu), không mở rộng tự do:
 *   - self               : chỉ chính người đó (Nhân viên)
 *   - sales_all_branches : nhân sự phòng "Bán hàng" của CẢ 3 chi nhánh đã chốt,
 *                           KHÔNG giới hạn theo chi nhánh của actor (Trưởng ca/CHT)
 *   - department         : nhân sự cùng phòng ban do Admin gán (Trưởng bộ phận)
 *   - all_company        : toàn công ty (Trợ lý GĐ trở lên)
 *
 * Hàm subjectMatchesScope() chỉ SO KHỚP lúc đọc - không throw khi scope hỏng,
 * trả về false (không khớp) để một dòng dữ liệu lỗi không làm sập cả danh sách.
 * Validate nghiêm ngặt lúc LƯU quyền là trách nhiệm của lib/knl-permissions.js.
 */

const KNL_SCOPE_TYPES = Object.freeze(new Set(['self', 'sales_all_branches', 'department', 'all_company']));

// Đã chốt cứng trong yêu cầu nghiệp vụ (mục 6.B) — không phải giá trị Admin tự cấu hình.
const SALES_ALL_BRANCHES_DEPARTMENT = 'Bán hàng';
const SALES_ALL_BRANCHES_BRANCHES = Object.freeze(['Phú Lợi', 'Ngô Quyền', 'Lái Thiêu']);

function normalizeScopeText(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
}

const NORMALIZED_SALES_BRANCHES = new Set(SALES_ALL_BRANCHES_BRANCHES.map(normalizeScopeText));
const NORMALIZED_SALES_DEPARTMENT = normalizeScopeText(SALES_ALL_BRANCHES_DEPARTMENT);

function subjectMatchesScope(subject, scopeValue, identity) {
  const raw = scopeValue && typeof scopeValue === 'object' ? scopeValue : {};
  const type = String(raw.type || 'self').toLowerCase();
  const person = subject || {};
  const id = identity || {};

  if (!KNL_SCOPE_TYPES.has(type)) return false;
  if (type === 'all_company') return true;

  if (type === 'self') {
    return Boolean(id.employeeCode && normalizeScopeText(person.employee_code) === normalizeScopeText(id.employeeCode));
  }

  if (type === 'sales_all_branches') {
    return normalizeScopeText(person.department) === NORMALIZED_SALES_DEPARTMENT &&
      NORMALIZED_SALES_BRANCHES.has(normalizeScopeText(person.branch));
  }

  if (type === 'department') {
    const values = (Array.isArray(raw.values) ? raw.values : []).map(normalizeScopeText).filter(Boolean);
    if (!values.length) return false;
    return values.includes(normalizeScopeText(person.department));
  }

  return false;
}

module.exports = {
  KNL_SCOPE_TYPES,
  SALES_ALL_BRANCHES_DEPARTMENT,
  SALES_ALL_BRANCHES_BRANCHES,
  normalizeScopeText,
  subjectMatchesScope
};
