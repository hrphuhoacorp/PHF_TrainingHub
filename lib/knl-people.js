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
    department: row.department || '',
    branch: row.branch || '',
    status: row.employee_status || ''
  };
}

async function listKnlPeople(session, filters = {}) {
  ensureDb();
  const resolved = await resolveActorGrant(session);
  requireAccessKnl(resolved);
  if (!resolved.capabilities.view_people) fail('Tài khoản chưa được cấp quyền xem Nhân sự KNL.', 403, 'KNL_VIEW_PEOPLE_DENIED');

  let query = supabase.from(SOURCE_TABLE).select('employee_code,employee_name,title,department,branch,employee_status').order('employee_name', { ascending: true }).limit(2000);
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

module.exports = { listKnlPeople };
