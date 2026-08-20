'use strict';

/*
 * PHF Task — nguồn scope Nhân sự/Tổ chức DUY NHẤT cho domain Task.
 * Độc lập hoàn toàn với lib/checklist-scope.js và lib/knl-scope.js — không
 * import chéo, chỉ học pattern subjectMatchesScope() thuần túy đã chứng minh
 * ở 2 module đó (PHF TASK V1 Phase 1B — kiến trúc guard: không port code cũ,
 * không tạo user/auth riêng, không duplicate Organization Master).
 *
 * Nguồn dữ liệu tổ chức: bảng employee_profiles (Organization Master, hậu
 * PHF_ORG_MASTER_CUTOVER_1.50.7) — CÙNG bảng lib/org-directory.js và
 * lib/knl-scope.js đang dùng làm "CURRENT ORGANIZATION". Task KHÔNG tự tạo
 * bảng nhân sự riêng, KHÔNG cho Admin Task sửa department/title/manager tại
 * đây (rule A.1 — sai thì sửa ở Quản trị nhân sự).
 *
 * SALES_ALL_BRANCHES_DEPARTMENT/BRANCHES lấy đúng giá trị đã verify thật trên
 * Production ở lib/knl-scope.js (2026-08-11 KNL Initial Permission Seed) —
 * không đoán lại, nhưng khai báo hằng số RIÊNG cho Task domain (không import
 * chéo sang lib/knl-scope.js, đúng yêu cầu "implementation riêng").
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const configured = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const supabase = configured
  ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

const SOURCE_TABLE = 'employee_profiles';
const CACHE_TTL_MS = 30000;
const MAX_CHAIN_DEPTH = 12;

const SALES_ALL_BRANCHES_DEPARTMENT = 'Bộ phận bán hàng';
const SALES_ALL_BRANCHES_BRANCHES = Object.freeze(['Phú Lợi', 'Ngô Quyền', 'Lái Thiêu']);

const ACTOR_TYPES = Object.freeze(['admin', 'giam_doc', 'tro_ly_gd', 'truong_bo_phan', 'truong_ca', 'nhan_vien']);

/*
 * AUTHORITY SOURCE HIERARCHY (Foundation Audit Correction, mục 2) — đã trace
 * lib/employee-master.js, lib/org-directory.js, lib/org-master-cutover.js,
 * scripts/PHF_HR_EMPLOYEE_PROFILE_V1_1.46.2.sql:16 ("title = Chức danh;
 * position = Chức vụ. Permission presets are neither.") và user_accounts.role:
 *
 *   1) session.role === 'admin' (user_accounts.role) — CANONICAL, chỉ phân
 *      biệt được admin/không-admin, KHÔNG phân biệt được Giám đốc/Trợ lý
 *      GĐ/TBP/Trưởng ca.
 *   2) employee_profiles.manager_employee_code (HR management relationship)
 *      — CANONICAL cho quan hệ quản lý (dùng ở resolveManagedEmployeeCodes),
 *      không dùng để phân loại actor type.
 *   3) employee_profiles.title + position — FREE-TEXT do Admin nhập tay,
 *      KHÔNG có enum/check constraint, KHÔNG đồng bộ HRIS tự động. Đây là
 *      NGUỒN DUY NHẤT còn lại để phân biệt giam_doc/tro_ly_gd/truong_bo_phan/
 *      truong_ca — dùng làm FALLBACK CÓ KIỂM SOÁT (token-subset, xem
 *      matchActorTypeByOrgText), không phải nguồn đáng tin tuyệt đối.
 *
 * GIỚI HẠN ĐÃ BIẾT (không giả vờ có canonical source): lib/org-directory.js
 * (ROLE_PRESET_HINTS, dòng ~34-43) từng trace Production thật và ghi nhận 4
 * tài khoản giữ quyền Trợ lý GĐ có title thực tế là "Quản lý" — KHÔNG chứa
 * "trợ lý"/"giám đốc" nên fallback title ở đây SẼ KHÔNG nhận diện được các
 * tài khoản đó (rơi về nhan_vien). Task KHÔNG tự thêm "quản lý" làm alias
 * (quá chung chung — "quản lý kho"/"quản lý ca" dễ false-positive sang
 * TBP/Trưởng ca). Hướng xử lý cho các case biệt lệ này: Admin cấp
 * task_permission_grants (grant_type=extend, capabilities giống base
 * tro_ly_gd) cho đúng account đó, HOẶC sửa title/position tại Quản trị nhân
 * sự cho khớp thực tế — KHÔNG sửa ở Task (rule A.1: sai thì sửa ở nguồn HR).
 *
 * Token-subset (không phải contiguous-substring): "Trợ lý Ban Giám đốc" vẫn
 * khớp hint tro_ly_gd vì tập token {tro,ly,giam,doc} ⊆ {tro,ly,ban,giam,doc}
 * — đổi display title chèn thêm từ ở giữa KHÔNG làm mất quyền ngoài ý muốn.
 * Thứ tự hint CỐ Ý: tro_ly_gd trước giam_doc để "trợ lý giám đốc" không bị
 * match nhầm thành "giám đốc" trần (giam_doc cũng là tập con của tro_ly_gd).
 */
const ACTOR_TYPE_TITLE_HINTS = Object.freeze([
  { actorType: 'tro_ly_gd', labels: ['trợ lý giám đốc', 'trợ lý gd'] },
  { actorType: 'giam_doc', labels: ['giám đốc'] },
  { actorType: 'truong_bo_phan', labels: ['trưởng bộ phận'] },
  { actorType: 'truong_ca', labels: ['trưởng ca'] }
]);

function text(value) { return String(value == null ? '' : value).trim(); }
function code(value) { return text(value).toUpperCase(); }
function fail(message, statusCode, errorCode) {
  const e = new Error(message);
  e.statusCode = statusCode || 400;
  e.code = errorCode || 'TASK_SCOPE_INVALID';
  throw e;
}
function ensureDb() { if (!supabase) fail('Supabase chưa được cấu hình cho PHF Task.', 503, 'SUPABASE_NOT_CONFIGURED'); }

function throwDb(error) {
  if (!error) return;
  const errCode = text(error.code);
  const message = text(error.message);
  if (errCode === 'PGRST205' || errCode === '42P01' || /relation .* does not exist/i.test(message) || /Could not find the table/i.test(message)) {
    fail('Bảng employee_profiles chưa sẵn sàng cho PHF Task đọc scope tổ chức.', 503, 'TASK_ORG_SOURCE_UNAVAILABLE');
  }
  throw error;
}

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

function tokenSet(value) {
  return new Set(normalizeScopeText(value).split(/\s+/).filter(Boolean));
}
function hasAllTokens(haystackSet, label) {
  const needed = tokenSet(label);
  for (const t of needed) { if (!haystackSet.has(t)) return false; }
  return needed.size > 0;
}

// Đọc CẢ title lẫn position (2 field free-text độc lập, xem ghi chú authority
// hierarchy phía trên) — token-subset trên hợp của cả 2, gap-tolerant với từ
// chèn thêm ở giữa (VD "Trợ lý Ban Giám đốc").
function matchActorTypeByOrgText(title, position) {
  const haystack = tokenSet(text(title) + ' ' + text(position));
  if (!haystack.size) return null;
  const hint = ACTOR_TYPE_TITLE_HINTS.find(h => h.labels.some(label => hasAllTokens(haystack, label)));
  return hint ? hint.actorType : null;
}

let cachedRows = null;
let cachedAt = 0;

async function loadOrgRows() {
  ensureDb();
  const now = Date.now();
  if (cachedRows && (now - cachedAt) < CACHE_TTL_MS) return cachedRows;
  const { data, error } = await supabase.from(SOURCE_TABLE)
    .select('employee_code,full_name,department,title,position,branch,manager_employee_code,employment_status')
    .limit(2000);
  if (error) throwDb(error);
  cachedRows = (data || []).map(r => ({
    employeeCode: code(r.employee_code),
    fullName: text(r.full_name),
    department: text(r.department),
    title: text(r.title),
    position: text(r.position),
    branch: text(r.branch),
    managerCode: code(r.manager_employee_code),
    status: text(r.employment_status) || 'active'
  }));
  cachedAt = now;
  return cachedRows;
}

function invalidateOrgCache() { cachedRows = null; cachedAt = 0; }

function findByCode(rows, employeeCode) {
  const target = code(employeeCode);
  if (!target) return null;
  return rows.find(r => r.employeeCode === target) || null;
}

/*
 * actorType KHÔNG bao giờ đọc từ task_permission_grants — luôn suy trực tiếp
 * từ HR theo đúng thứ tự authority ở ghi chú ACTOR_TYPE_TITLE_HINTS phía
 * trên: (1) session.role='admin' canonical, rồi (2) fallback title+position
 * free-text (GIỚI HẠN ĐÃ BIẾT: không phủ được mọi biến thể thực tế). Đúng
 * công thức "HR Base Scope + HR Management Relationship + Task Exceptions" —
 * Task Exception không được dùng để dựng lại actor type (rule C.4).
 */
function classifyActorType(session, orgRecord) {
  const sessionRole = text(session && session.role).toLowerCase();
  if (sessionRole === 'admin') return 'admin';
  const byText = matchActorTypeByOrgText(orgRecord && orgRecord.title, orgRecord && orgRecord.position);
  return byText || 'nhan_vien';
}

/*
 * Quan hệ quản lý trực tiếp/gián tiếp của TBP — quét XUÔI chuỗi
 * manager_employee_code của toàn bộ nhân sự bắt đầu từ actor (BFS theo từng
 * tầng), bounded bởi MAX_CHAIN_DEPTH giống lib/org-directory.js để an toàn
 * trước dữ liệu lỗi tạo vòng lặp.
 */
function resolveManagedEmployeeCodes(actorEmployeeCode, rows) {
  const root = code(actorEmployeeCode);
  const managed = new Set();
  let frontier = new Set([root]);
  for (let depth = 0; depth < MAX_CHAIN_DEPTH && frontier.size; depth++) {
    const next = new Set();
    rows.forEach(r => {
      if (frontier.has(r.managerCode) && r.employeeCode && !managed.has(r.employeeCode) && r.employeeCode !== root) {
        managed.add(r.employeeCode);
        next.add(r.employeeCode);
      }
    });
    frontier = next;
  }
  return managed;
}

async function resolveActorContext(session) {
  const employeeCode = code(
    (session && session.employeeCode) ||
    (session && session.employee_code) ||
    (session && session.account && session.account.employeeCode) ||
    (session && session.account && session.account.employee_code)
  );
  if (!employeeCode) fail('Phiên làm việc thiếu employee_code — không thể xác định danh tính PHF Task.', 401, 'TASK_IDENTITY_REQUIRED');
  const rows = await loadOrgRows();
  const record = findByCode(rows, employeeCode);
  const actorType = classifyActorType(session, record);
  const managedEmployeeCodes = actorType === 'truong_bo_phan' ? resolveManagedEmployeeCodes(employeeCode, rows) : new Set();
  return {
    employeeCode,
    fullName: (record && record.fullName) || text(session && session.account && session.account.name),
    department: (record && record.department) || '',
    branch: (record && record.branch) || '',
    title: (record && record.title) || '',
    managerCode: (record && record.managerCode) || '',
    status: (record && record.status) || 'active',
    actorType,
    managedEmployeeCodes
  };
}

function isSalesAllBranchesSubject(subject) {
  return normalizeScopeText(subject && subject.department) === NORMALIZED_SALES_DEPARTMENT &&
    NORMALIZED_SALES_BRANCHES.has(normalizeScopeText(subject && subject.branch));
}

module.exports = {
  ACTOR_TYPES,
  SALES_ALL_BRANCHES_DEPARTMENT,
  SALES_ALL_BRANCHES_BRANCHES,
  normalizeScopeText,
  loadOrgRows,
  invalidateOrgCache,
  findByCode,
  classifyActorType,
  matchActorTypeByOrgText,
  resolveManagedEmployeeCodes,
  resolveActorContext,
  isSalesAllBranchesSubject
};
