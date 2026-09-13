'use strict';

/*
 * Training Hub — Canonical Department Catalog V1 (Batch A: foundation only).
 *
 * Đây là danh mục phòng ban CHUẨN duy nhất được công nhận cho employee_profiles
 * (People Master) — 9 phòng ban thật đang tồn tại trên PROD MAIN, xác nhận qua
 * audit read-only trước đó. KHÔNG được thêm/đoán thêm phòng ban nào khác ở đây
 * (không fuzzy match) — mọi tên chưa có trong danh sách này phải được từ chối
 * ở tầng ghi (saveProfile/ensureProfileFromAccount), không tự suy ra.
 *
 * Batch A chỉ dựng nền tảng: catalog + validate/resolve khi GHI vào
 * employee_profiles. Learner gate (phf-learning-gate.js) và /api/data CHƯA bị
 * đụng tới ở batch này — vẫn tiếp tục dùng DEPARTMENT_ALIASES string-alias như
 * cũ cho tới batch sau.
 */

const DEPARTMENTS = Object.freeze([
  { key: 'dept_ban_giam_doc', displayName: 'Ban giám đốc' },
  { key: 'dept_ban_hang', displayName: 'Bộ phận bán hàng' },
  { key: 'dept_ban_hang_online', displayName: 'Bộ phận bán hàng Online' },
  { key: 'dept_goi_qua_che_bien', displayName: 'Bộ phận Gói quà & Chế biến' },
  { key: 'dept_kho_van', displayName: 'Bộ phận kho vận' },
  { key: 'dept_quan_tri_tong_hop', displayName: 'Bộ phận Quản trị tổng hợp' },
  { key: 'dept_tai_chinh_ke_toan', displayName: 'Bộ phận Tài chính Kế toán' },
  { key: 'dept_thu_mua', displayName: 'Bộ phận thu mua' },
  { key: 'dept_truyen_thong_quang_cao', displayName: 'Bộ phận Truyền thông quảng cáo' }
]);

const BY_KEY = new Map(DEPARTMENTS.map(d => [d.key, d]));

function normalizeDisplayName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Exact-match-only lookup (trim + collapse whitespace + case-fold). KHÔNG
// fuzzy, KHÔNG alias nhãn ngắn ở đây — "Bán hàng" (ngắn) KHÔNG khớp
// "Bộ phận bán hàng" qua hàm này, đúng yêu cầu "reject non-catalog values".
const BY_NORMALIZED_DISPLAY_NAME = new Map(
  DEPARTMENTS.map(d => [normalizeDisplayName(d.displayName), d])
);

function listDepartments() {
  return DEPARTMENTS.map(d => ({ ...d }));
}

function getDepartmentByKey(key) {
  const found = BY_KEY.get(String(key || '').trim());
  return found ? { ...found } : null;
}

function isValidDepartmentKey(key) {
  return BY_KEY.has(String(key || '').trim());
}

// Trả về department canonical {key, displayName} nếu tên khớp CHÍNH XÁC (sau
// trim/collapse-space/case-fold) một trong 9 phòng ban chuẩn; null nếu không
// khớp (bao gồm cả nhãn ngắn cũ như "Bán hàng" — cố ý, không tự suy đoán).
function resolveDepartmentByDisplayName(name) {
  const found = BY_NORMALIZED_DISPLAY_NAME.get(normalizeDisplayName(name));
  return found ? { ...found } : null;
}

class DepartmentCatalogError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DepartmentCatalogError';
    this.statusCode = 400;
    this.code = 'EMPLOYEE_DEPARTMENT_INVALID';
  }
}

// Dùng ở MỌI nơi ghi department vào employee_profiles. Rỗng -> cho phép (chưa
// gán phòng ban), không rỗng nhưng không khớp catalog -> NÉM LỖI (reject),
// không tự map/fuzzy. Trả về {department, departmentKey} để caller set thẳng
// vào patch/row — department luôn là displayName CHUẨN (không phải giá trị
// admin gõ), departmentKey luôn khớp catalog hoặc null nếu để trống.
function resolveDepartmentForWrite(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return { department: '', departmentKey: null };
  const match = resolveDepartmentByDisplayName(value);
  if (!match) {
    throw new DepartmentCatalogError(
      'Phòng ban "' + value + '" không có trong danh mục chuẩn. Vui lòng chọn đúng một trong các phòng ban đã được công nhận.'
    );
  }
  return { department: match.displayName, departmentKey: match.key };
}

module.exports = {
  DEPARTMENTS,
  DepartmentCatalogError,
  listDepartments,
  getDepartmentByKey,
  isValidDepartmentKey,
  resolveDepartmentByDisplayName,
  resolveDepartmentForWrite
};
