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
 *   - department         : nhân sự cùng phòng ban do Admin gán (Trưởng bộ phận, legacy)
 *   - employees          : danh sách nhân sự cụ thể do Admin gán trực tiếp
 *                           (Trưởng bộ phận, batch "KNL Permission Audit") - nhiều
 *                           TBP có thể cùng liệt kê chung 1 mã NV (many-to-many tự
 *                           nhiên qua nhiều row độc lập, không cần bảng join). Cùng
 *                           pattern đã chạy thật ở lib/checklist-scope.js (REFERENCE
 *                           ONLY - không import chéo, chỉ tham khảo cách match).
 *   - all_company        : toàn công ty (Trợ lý GĐ trở lên)
 *
 * Hàm subjectMatchesScope() chỉ SO KHỚP lúc đọc - không throw khi scope hỏng,
 * trả về false (không khớp) để một dòng dữ liệu lỗi không làm sập cả danh sách.
 * Validate nghiêm ngặt lúc LƯU quyền là trách nhiệm của lib/knl-permissions.js.
 * Hàm này CHỈ đọc scopeValue.type/scopeValue.values - tuyệt đối không đọc
 * scopeValue.reservedEmployees (kho lưu trữ danh sách TBP cũ khi đổi role,
 * xem lib/knl-permissions.js scope()) - danh sách bảo lưu không được phép
 * tham gia chấm quyền dưới bất kỳ hình thức nào.
 */

const KNL_SCOPE_TYPES = Object.freeze(new Set(['self', 'sales_all_branches', 'department', 'employees', 'all_company']));

// Đã chốt cứng trong yêu cầu nghiệp vụ (mục 6.B) — không phải giá trị Admin tự
// cấu hình. 2026-08-11 KNL Initial Permission Seed: trace trực tiếp
// employee_profiles (Organization Master, hậu Cutover 1.50.7) cho thấy giá trị
// department thật là 'Bộ phận bán hàng' (không phải 'Bán hàng' trần) — mọi
// department khác trong master hiện hành đều có tiền tố "Bộ phận "/"Ban ", đây
// là quy ước đặt tên mới sau cutover, không phải biến thể tùy ý. Sửa lại đúng
// chuỗi thật để khớp nghiệp vụ gốc (phòng Bán hàng, không đoán chuỗi mới) —
// không phải đổi business rule. SALES_ALL_BRANCHES_BRANCHES đã verify khớp
// 100% với 3 chi nhánh thật đang có nhân sự tại phòng này, giữ nguyên.
const SALES_ALL_BRANCHES_DEPARTMENT = 'Bộ phận bán hàng';
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

  if (type === 'employees') {
    const values = (Array.isArray(raw.values) ? raw.values : []).map(normalizeScopeText).filter(Boolean);
    if (!values.length) return false;
    return values.includes(normalizeScopeText(person.employee_code));
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
