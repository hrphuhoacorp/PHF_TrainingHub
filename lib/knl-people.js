'use strict';

/*
 * KNL People Adapter (mục 3 của yêu cầu) — lớp DUY NHẤT mà frontend KNL và
 * api/data.js được phép đi qua để đọc danh sách nhân sự. KHÔNG gọi thẳng
 * lib/checklist-*.js từ nơi khác. Nguồn dữ liệu hiện tại là
 * checklist_employee_assignments (CURRENT ORGANIZATION, không snapshot —
 * mục 4), CHỈ ĐỌC — KNL không tạo/sửa/xóa nhân sự.
 *
 * Nếu sau này PHF đổi nguồn master nhân sự: chỉ sửa file này, KHÔNG phải
 * viết lại màn Nhân sự KNL hay lib/knl-permissions.js.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { subjectMatchesScope, normalizeScopeText } = require('./knl-scope');
const { resolveActorGrant, requireAccessKnl } = require('./knl-permissions');

const configured = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const supabase = configured
  ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

const SOURCE_TABLE = 'checklist_employee_assignments';
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
    .select('employee_id,employee_code,employee_name,title,position,department,branch,manager_id,manager_code,manager_name,employee_status')
    .order('employee_name', { ascending: true }).limit(2000);
  if (error) throw error;
  return data || [];
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

  let query = supabase.from(SOURCE_TABLE).select('employee_code,employee_name,title,position,department,branch,employee_status').order('employee_name', { ascending: true }).limit(2000);
  const statusFilter = text(filters.status).toLowerCase() || 'active';
  if (statusFilter === 'active') query = query.neq('employee_status', INACTIVE_STATUS);
  else if (statusFilter === 'inactive') query = query.eq('employee_status', INACTIVE_STATUS);
  // 'all' => không lọc trạng thái

  const { data, error } = await query;
  if (error) throw error;

  const inScope = (data || []).filter(row => subjectMatchesScope(row, resolved.peopleScope, resolved.identity));

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

  return {
    people: filtered.slice(0, RESULT_LIMIT).map(publicPerson),
    total: filtered.length,
    peopleScope: resolved.peopleScope,
    truncated: filtered.length > RESULT_LIMIT
  };
}

module.exports = { listKnlPeople, listKnlAssignmentTargets, resolveKnlAssignmentTarget, positionRef };
