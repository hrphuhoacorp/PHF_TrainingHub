'use strict';

/*
 * KNL People Adapter (mục 3 của yêu cầu) — lớp DUY NHẤT mà frontend KNL và
 * api/data.js được phép đi qua để đọc danh sách nhân sự. KHÔNG gọi thẳng
 * lib/checklist-*.js từ nơi khác. Nguồn dữ liệu là public.employee_profiles
 * (Organization Master, kể từ Organization Master Cutover 1.50.7 — trước đó
 * là checklist_employee_assignments). CHỈ ĐỌC — KNL không tạo/sửa/xóa nhân sự.
 * Compensation cũng đi qua đúng adapter này (loadKnlOrganizationRows).
 *
 * employee_status ở đây vẫn là nhãn tiếng Việt ("Đang làm việc"/"Đã nghỉ
 * việc") để không đổi hợp đồng với UI/lib hiện có — được ánh xạ ngược từ
 * employee_profiles.employment_status ('active'/'inactive').
 *
 * Nếu sau này PHF đổi nguồn master nhân sự: chỉ sửa file này, KHÔNG phải
 * viết lại màn Nhân sự KNL hay lib/knl-permissions.js.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { subjectMatchesScope, normalizeScopeText } = require('./knl-scope');
const { resolveActorGrant, requireAccessKnl, incomeScopeAllows } = require('./knl-permissions');

const configured = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const supabase = configured
  ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

const SOURCE_TABLE = 'employee_profiles';
const ACTIVE_STATUS = 'Đang làm việc';
const INACTIVE_STATUS = 'Đã nghỉ việc';
const RESULT_LIMIT = 1000;

function text(value) { return String(value == null ? '' : value).trim(); }
function fail(message, statusCode = 400, code = 'KNL_PEOPLE_INVALID') { const error = new Error(message); error.statusCode = statusCode; error.code = code; throw error; }
function ensureDb() { if (!supabase) fail('Supabase chưa được cấu hình để đọc nguồn nhân sự.', 503, 'SUPABASE_NOT_CONFIGURED'); }

function publicPerson(row = {}) {
  return {
    employeeCode: row.employee_code || '',
    employeeName: row.employee_name || '',
    title: row.title || '',
    position: row.position || '',
    department: row.department || '',
    branch: row.branch || '',
    status: row.employee_status || ''
  };
}

function positionRef(row = {}) {
  const position = text(row.position);
  if (!position) return '';
  const canonical = [text(row.department), position, text(row.branch)].map(value => value.toUpperCase()).join('|');
  return 'orgpos:' + crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 24);
}

async function loadKnlOrganizationRows() {
  ensureDb();
  const { data, error } = await supabase.from(SOURCE_TABLE)
    .select('employee_id,employee_code,full_name,title,position,department,branch,manager_employee_code,employment_status')
    .order('full_name', { ascending: true }).limit(2000);
  if (error) throw error;
  const rows = data || [];
  const byCode = new Map(rows.map(r => [text(r.employee_code).toUpperCase(), r]));
  return rows.map(r => {
    const manager = byCode.get(text(r.manager_employee_code).toUpperCase());
    return {
      employee_id: r.employee_id || '',
      employee_code: r.employee_code || '',
      employee_name: r.full_name || '',
      title: r.title || '',
      position: r.position || '',
      department: r.department || '',
      branch: r.branch || '',
      manager_code: r.manager_employee_code || '',
      manager_name: manager ? manager.full_name : '',
      employee_status: r.employment_status === 'inactive' ? INACTIVE_STATUS : ACTIVE_STATUS
    };
  });
}

async function listKnlAssignmentTargets() {
  const rows = await loadKnlOrganizationRows();
  const active = rows.filter(row => text(row.employee_status) !== INACTIVE_STATUS);
  const positions = [];
  active.forEach(row => {
    const ref = positionRef(row);
    if (!ref || positions.some(item => item.positionRef === ref)) return;
    positions.push({ positionRef:ref, position:text(row.position), title:text(row.title), department:text(row.department), branch:text(row.branch) });
  });
  return {
    people: active.map(row => ({ ...publicPerson(row), managerCode:text(row.manager_code), managerName:text(row.manager_name) })),
    positions,
    organizationConflict: positions.length ? null : { code:'KNL_ORG_POSITION_UNAVAILABLE', message:'Nguồn organization hiện chưa có position riêng; không suy chức danh title thành vị trí.' }
  };
}

async function resolveKnlAssignmentTarget(targetType, targetRef) {
  const directory = await listKnlAssignmentTargets();
  if (targetType === 'employee') {
    const code = text(targetRef).toUpperCase();
    const person = directory.people.find(row => text(row.employeeCode).toUpperCase() === code);
    if (!person) fail('Mã nhân viên không tồn tại trong nguồn organization hiện hành.', 400, 'KNL_ASSIGNMENT_EMPLOYEE_NOT_FOUND');
    return { targetType:'employee', targetRef:code, employeeCode:code, positionRef:null, snapshot:person };
  }
  if (targetType === 'position') {
    const position = directory.positions.find(row => row.positionRef === text(targetRef));
    if (!position) fail(directory.organizationConflict?.message || 'Vị trí không tồn tại trong nguồn organization hiện hành.', 409, directory.organizationConflict?.code || 'KNL_ASSIGNMENT_POSITION_NOT_FOUND');
    return { targetType:'position', targetRef:position.positionRef, employeeCode:null, positionRef:position.positionRef, snapshot:position };
  }
  fail('Loại đối tượng gán KNL không hợp lệ.', 400, 'KNL_ASSIGNMENT_TARGET_INVALID');
}

async function listKnlPeople(session, filters = {}) {
  ensureDb();
  const resolved = await resolveActorGrant(session);
  requireAccessKnl(resolved);
  if (!resolved.capabilities.view_people) fail('Tài khoản chưa được cấp quyền xem Nhân sự KNL.', 403, 'KNL_VIEW_PEOPLE_DENIED');

  const rows = await loadKnlOrganizationRows();
  const statusFilter = text(filters.status).toLowerCase() || 'active';
  const statusScoped = statusFilter === 'active' ? rows.filter(row => text(row.employee_status) !== INACTIVE_STATUS)
    : statusFilter === 'inactive' ? rows.filter(row => text(row.employee_status) === INACTIVE_STATUS)
    : rows; // 'all' => không lọc trạng thái

  const inScope = statusScoped.filter(row => subjectMatchesScope(row, resolved.peopleScope, resolved.identity));

  const search = normalizeScopeText(filters.search);
  const department = normalizeScopeText(filters.department);
  const branch = normalizeScopeText(filters.branch);
  const filtered = inScope.filter(row => {
    if (department && normalizeScopeText(row.department) !== department) return false;
    if (branch && normalizeScopeText(row.branch) !== branch) return false;
    if (search) {
      const haystack = normalizeScopeText(row.employee_code) + ' ' + normalizeScopeText(row.employee_name);
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  /* canViewIncome (2026-08-12, "Xem thu nhập" per-row fix): field BỔ SUNG,
   * KHÔNG thay filter/scope hiện có. Tính bằng ĐÚNG incomeScopeAllows() dùng
   * thật ở getKnlEmployeeIncome (lib/knl-permissions.js) — không phải suy
   * diễn riêng, không merge peopleScope với incomeScope, chỉ chấm ĐỘC LẬP
   * trên từng row đã lọc theo peopleScope như cũ. Admin -> true qua nhánh
   * admin_recovery trong incomeScopeAllows; account có income_view=false ->
   * false tuyệt đối cho mọi row. */
  return {
    people: filtered.slice(0, RESULT_LIMIT).map(row => {
      const person = publicPerson(row);
      person.canViewIncome = incomeScopeAllows(resolved, { employeeCode: row.employee_code, department: row.department, branch: row.branch, title: row.title });
      return person;
    }),
    total: filtered.length,
    peopleScope: resolved.peopleScope,
    truncated: filtered.length > RESULT_LIMIT
  };
}

/* employeeCode của actor PHẢI đọc từ session.account.employeeCode — KHÔNG
 * session.employeeId (đó là internal linked-employee id, vd "hv-xxxx", khác
 * hoàn toàn mã hiển thị "PHF012", xem lib/auth.js readSession()). Đây là
 * đúng bug đã sửa trong lib/knl-competency.js:actor() ngày 2026-08-11 —
 * lib/knl-permissions.js actor() vẫn còn pattern cũ (đã flag riêng, chưa sửa
 * vì thuộc permission model) nên KHÔNG dùng resolved.identity để tự nhận
 * diện self ở đây, chỉ dùng cho xác định phạm vi khi xem NGƯỜI KHÁC. */
function selfIdentity(session) {
  return { employeeCode: text(session?.employeeCode || session?.employee_code || session?.account?.employeeCode || session?.account?.employee_code).toUpperCase() };
}

/* Hồ sơ cá nhân đầy đủ cho màn "KNL của tôi" — self luôn xem được (mirror
 * đúng self-path của getKnlEmployeeCompetencyAssignment/getKnlEmployeeIncome,
 * KHÔNG cần capability nào); xem người khác qua đúng view_people/peopleScope
 * hiện hành, không invent scope mới. */
async function getKnlEmployeeProfile(session, input = {}) {
  ensureDb();
  const self = selfIdentity(session);
  const employeeCode = text(input.employeeCode || self.employeeCode).toUpperCase();
  if (!employeeCode) fail('Không xác định được mã nhân viên.', 409, 'KNL_EMPLOYEE_CODE_REQUIRED');
  if (employeeCode !== self.employeeCode) {
    const resolved = await resolveActorGrant(session);
    requireAccessKnl(resolved);
    if (!resolved.capabilities.view_people) fail('Không có quyền xem hồ sơ nhân sự này.', 403, 'KNL_PEOPLE_VIEW_DENIED');
    const rows = await loadKnlOrganizationRows();
    const person = rows.find(r => text(r.employee_code).toUpperCase() === employeeCode);
    if (!person || !subjectMatchesScope(person, resolved.peopleScope, resolved.identity)) fail('Không có quyền xem hồ sơ nhân sự này.', 403, 'KNL_PEOPLE_VIEW_DENIED');
  }
  const { data, error } = await supabase.from('employee_profiles')
    .select('employee_code,full_name,title,position,department,branch,employment_status,avatar_url,hire_date')
    .eq('employee_code', employeeCode).maybeSingle();
  if (error) throw error;
  if (!data) fail('Không tìm thấy hồ sơ nhân sự.', 404, 'KNL_EMPLOYEE_NOT_FOUND');
  return {
    employeeCode: data.employee_code || employeeCode,
    fullName: data.full_name || '',
    title: data.title || '',
    position: data.position || '',
    department: data.department || '',
    branch: data.branch || '',
    employmentStatus: data.employment_status || '',
    avatarUrl: data.avatar_url || '',
    hireDate: data.hire_date || ''
  };
}

// Server-only consumers (reconciliation/compensation authorization) may read
// the raw current organization through this adapter. It is deliberately not
// exposed as an API action and never writes the source table.
module.exports = { listKnlPeople, listKnlAssignmentTargets, resolveKnlAssignmentTarget, loadKnlOrganizationRows, positionRef, getKnlEmployeeProfile };
