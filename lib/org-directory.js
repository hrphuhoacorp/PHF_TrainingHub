'use strict';

/* PHF Organization Directory - lop doc CANONICAL cho cau hoi co cau to
   chuc thong thuong: ho ten/ma nhan vien/chuc danh/phong ban/chi nhanh/
   quan ly truc tiep/bao cao cho ai/thanh vien don vi. Day la thong tin
   DUNG CHUNG theo chinh sach PHF da chot (batch "Organization Directory +
   Natural Conversation Hardening") - MO CHO CA 3 ROLE da dang nhap (admin/
   manager/learner), KHONG yeu cau grant Checklist (view_reports) hay KNL
   (view_people).

   Nguon du lieu: checklist_employee_assignments - CUNG bang KNL dang dung
   lam "CURRENT ORGANIZATION" (xem lib/knl-people.js). KHONG tao bang/
   migration moi. Day la duong doc THU BA, doc lap - KHONG dong den
   lib/checklist-permissions.js hay lib/knl-permissions.js, KHONG lam thay
   doi permission cua man hinh Bao cao Checklist hay man hinh Nhan su KNL.

   AN TOAN DU LIEU: bang nguon nay VON KHONG co field luong/thu nhap/BHXH/
   danh gia ca nhan (xem schema scripts/PHF_CHECKLIST_ASSIGNMENTS_1.7.77.sql)
   - publicPerson() o day van liet ke whitelist ro rang de tuong lai neu doi
   nguon van khong vo tinh leak. Cac loai du lieu nhay cam (luong/BHXH/danh
   gia chi tiet/quyen quan tri he thong/secrets) KHONG di qua module nay va
   VAN theo dung permission hien co cua tung module rieng.

   CHUA CHUNG MINH ho phu 100% nhan vien PHF (bang do Admin nhap/import thu
   cong, khong co dong bo HRIS tu dong) - moi ham o day tra ve du lieu
   nhung KHONG bao gio tu suy ra day la toan bo cong ty; noi goi (lib/
   ai-employee-tools.js) phai gan evidence/scope note ro rang khi dua vao
   AI.

   CROSS-REFERENCE checklist_permission_grants (batch "Organization Directory
   Trace + Preset Fallback"): da xac nhan bang du lieu Production that (script
   trace mot lan, khong luu lai - xem PR/commit message) rang 4 tai khoan giu
   preset TRO_LY_GD co title thuc te la "Quan ly" (KHONG PHAI "Tro ly Giam
   doc") - day la nguyen nhan chinh khien search theo title="Tro ly Giam doc"
   ra rong dung logic. searchOrgPeople() o duoi doc THEM (khong ghi, khong
   goi lib/checklist-permissions.js - do la module quyet dinh QUYEN, khac voi
   viec chi doc preset_code cong khai lam TIN HIEU BO SUNG o day) bang
   checklist_permission_grants CHI khi: (a) tham so title khop 1 trong so cac
   nhan dien vai tro quan ly da biet (ROLE_PRESET_HINTS), VA (b) chi dung nhu
   FALLBACK khi title-text-search ra rong, HOAC de phat hien CONFLICTED khi 2
   nguon doc lap (title text vs preset) tra ve 2 tap nguoi KHAC NHAU. Preset
   KHONG BAO GIO duoc coi la chuc danh that - noi goi phai gan evidence.note
   ro rang day la tin hieu tu quyen duoc cap, khong phai truong title. */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const configured = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const supabase = configured
  ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const SOURCE_TABLE = 'checklist_employee_assignments';
const INACTIVE_STATUS = 'Đã nghỉ việc';
const RESULT_LIMIT = 1000;
const MAX_CHAIN_DEPTH = 12;
const CACHE_TTL_MS = 30000; // giam so lan query lap khi 1 luot AI goi nhieu tool lien tiep (vd management chain)

function text(value) { return String(value == null ? '' : value).trim(); }
function fail(message, statusCode = 400, code = 'ORG_DIRECTORY_INVALID') { const e = new Error(message); e.statusCode = statusCode; e.code = code; throw e; }
function ensureDb() { if (!supabase) fail('Supabase chưa được cấu hình để đọc cơ cấu tổ chức.', 503, 'SUPABASE_NOT_CONFIGURED'); }
function ensureSession(session) { if (!session) fail('Phiên làm việc không hợp lệ.', 401, 'ORG_DIRECTORY_SESSION_REQUIRED'); }
function normalizeText(value) {
  return String(value == null ? '' : value).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Whitelist AN TOAN co chu dich - xem ghi chu dau file.
function publicPerson(row) {
  if (!row) return null;
  return {
    employeeCode: row.employee_code || '',
    employeeName: row.employee_name || '',
    title: row.title || '',
    department: row.department || '',
    branch: row.branch || '',
    managerCode: row.manager_code || '',
    managerName: row.manager_name || '',
    employeeStatus: row.employee_status || ''
  };
}

let cachedRows = null;
let cachedAt = 0;

async function loadDirectoryRows() {
  ensureDb();
  const now = Date.now();
  if (cachedRows && (now - cachedAt) < CACHE_TTL_MS) return cachedRows;
  const { data, error } = await supabase.from(SOURCE_TABLE)
    .select('employee_id,employee_code,employee_name,department,title,branch,manager_id,manager_code,manager_name,employee_status')
    .neq('employee_status', INACTIVE_STATUS)
    .order('employee_name', { ascending: true })
    .limit(2000);
  if (error) throw error;
  cachedRows = data || [];
  cachedAt = now;
  return cachedRows;
}

// ROLE_PRESET_HINTS - xem ghi chu dau file. CHI 3 preset "vai tro quan ly"
// da xac nhan co y nghia lam tin hieu chuc danh bo sung (TRO_LY_GD/
// TRUONG_BO_PHAN/TRUONG_CA_BH) - CO Y KHONG dua QUAN_LY_TRUC_TIEP/
// CHI_XEM_BAO_CAO/TUY_CHINH vao day vi do la preset ve MUC QUYEN chung
// chung, khong tuong ung 1 chuc danh cu the nao (tranh false-positive fallback
// cho tu khoa "quan ly" qua rong).
const ROLE_PRESET_HINTS = [
  { presetCode: 'TRO_LY_GD', labels: ['trợ lý giám đốc', 'trợ lý gd', 'trợ lý'] },
  { presetCode: 'TRUONG_BO_PHAN', labels: ['trưởng bộ phận'] },
  { presetCode: 'TRUONG_CA_BH', labels: ['trưởng ca bán hàng', 'trưởng ca'] }
];
const PRESET_GRANTS_TABLE = 'checklist_permission_grants';

function matchRolePresetHint(titleQuery) {
  const norm = normalizeText(titleQuery);
  if (!norm) return null;
  return ROLE_PRESET_HINTS.find(hint => hint.labels.some(label => {
    const labelNorm = normalizeText(label);
    return norm.includes(labelNorm) || labelNorm.includes(norm);
  })) || null;
}

// loadActivePresetGrants: doc THO tu checklist_permission_grants - CHI lay
// employee_code + preset_code cua grant DANG HIEU LUC hom nay. Khong doc
// capabilities/scope, khong goi lib/checklist-permissions.js - khong lam
// quyet dinh QUYEN gi o day, chi lay danh sach ma nhan vien lam tin hieu.
async function loadActivePresetGrants(presetCode) {
  ensureDb();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.from(PRESET_GRANTS_TABLE)
    .select('employee_code,preset_code,is_active,effective_from,effective_to')
    .eq('is_active', true)
    .eq('preset_code', presetCode)
    .lte('effective_from', today)
    .limit(200);
  if (error) throw error;
  // Loc lai client-side (is_active/preset_code/effective_from/effective_to)
  // dau du truy van da loc - phong truong hop nguon du lieu tra thua dong
  // (vd test double), khong tin tuong hoan toan vao filter phia server cho
  // 1 danh sach dung lam tin hieu bo sung anh huong toi cau tra loi AI.
  return (data || []).filter(r => r.is_active === true && text(r.preset_code) === presetCode && text(r.effective_from) <= today && (!r.effective_to || text(r.effective_to) >= today));
}

function findByCode(rows, code) {
  const upper = text(code).toUpperCase();
  if (!upper) return null;
  return rows.find(r => text(r.employee_code).toUpperCase() === upper) || null;
}
function findByNameLoose(rows, name) {
  const norm = normalizeText(name);
  if (!norm) return [];
  return rows.filter(r => normalizeText(r.employee_name).includes(norm));
}

// resolvePerson: nhan employeeCode CHINH XAC hoac ten tu do. Neu ten khop
// NHIEU nguoi -> tra ambiguous:true kem candidates (KHONG tu doan 1 nguoi -
// noi goi/AI phai hoi lai nguoi dung, dung yeu cau nghiep vu "chi hoi lai
// khi thuc su ambiguous").
function resolvePerson(rows, args) {
  const code = text(args && args.employeeCode);
  if (code) {
    const match = findByCode(rows, code);
    return match ? { found: true, ambiguous: false, person: match } : { found: false, ambiguous: false, person: null };
  }
  const name = text((args && (args.name || args.employeeName)) || '');
  if (!name) return { found: false, ambiguous: false, person: null };
  const matches = findByNameLoose(rows, name);
  if (!matches.length) return { found: false, ambiguous: false, person: null };
  if (matches.length > 1) return { found: false, ambiguous: true, person: null, candidates: matches.slice(0, 8) };
  return { found: true, ambiguous: false, person: matches[0] };
}

async function searchOrgPeople(session, args = {}) {
  ensureSession(session);
  const rows = await loadDirectoryRows();
  const nameQuery = normalizeText(args.name || args.query);
  const employeeCode = text(args.employeeCode).toUpperCase();
  const department = normalizeText(args.department);
  const title = normalizeText(args.title);
  const branch = normalizeText(args.branch);
  const managerQuery = normalizeText(args.manager);

  // Tach rieng cac dieu kien KHONG lien quan title de dung chung cho ca
  // nhanh title-text va nhanh preset-fallback/conflict ben duoi - dam bao
  // department/branch/manager/name filter deu duoc ap dung nhat quan cho
  // ca 2 nguon, khong chi rieng nhanh title.
  function matchesNonTitleFilters(row) {
    if (employeeCode && text(row.employee_code).toUpperCase() !== employeeCode) return false;
    if (department && normalizeText(row.department) !== department) return false;
    if (branch && normalizeText(row.branch) !== branch) return false;
    if (managerQuery && !normalizeText(row.manager_name).includes(managerQuery) && normalizeText(row.manager_code) !== managerQuery) return false;
    if (nameQuery) {
      const haystack = normalizeText([row.employee_code, row.employee_name, row.title, row.department, row.branch].join(' '));
      if (!haystack.includes(nameQuery)) return false;
    }
    return true;
  }

  const titleFiltered = rows.filter(row => matchesNonTitleFilters(row) && (!title || normalizeText(row.title).includes(title)));

  // Preset cross-reference: CHI kich hoat khi tham so title khop 1 nhan
  // dien vai tro quan ly da biet (xem ROLE_PRESET_HINTS). Dung de (a) lam
  // FALLBACK khi title-text-search ra rong, hoac (b) phat hien CONFLICTED
  // khi 2 nguon doc lap lech nhau - KHONG bao gio am tham thay the ket qua
  // title-text khi 2 nguon da khop nhau.
  const rawTitleQuery = text(args.title);
  const roleHint = rawTitleQuery ? matchRolePresetHint(rawTitleQuery) : null;
  let presetInfo = null;
  if (roleHint) {
    const grants = await loadActivePresetGrants(roleHint.presetCode);
    const grantCodes = new Set(grants.map(g => text(g.employee_code).toUpperCase()));
    const presetFiltered = rows.filter(row => grantCodes.has(text(row.employee_code).toUpperCase()) && matchesNonTitleFilters(row));
    const titleCodes = new Set(titleFiltered.map(r => text(r.employee_code).toUpperCase()));
    const presetCodesSet = new Set(presetFiltered.map(r => text(r.employee_code).toUpperCase()));
    const sameSet = titleCodes.size === presetCodesSet.size && [...titleCodes].every(c => presetCodesSet.has(c));
    presetInfo = {
      presetCode: roleHint.presetCode,
      people: presetFiltered,
      isFallback: titleFiltered.length === 0 && presetFiltered.length > 0,
      isConflict: titleFiltered.length > 0 && presetFiltered.length > 0 && !sameSet
    };
  }

  const useFallback = !!(presetInfo && presetInfo.isFallback);
  const resultRows = useFallback ? presetInfo.people : titleFiltered;
  const limit = Math.min(20, Math.max(1, Number(args.limit) || 10));

  return {
    asOf: new Date().toISOString(),
    total: resultRows.length,
    people: resultRows.slice(0, limit).map(publicPerson),
    titleSource: useFallback ? 'permission_grant_preset' : 'title_field',
    conflict: (presetInfo && presetInfo.isConflict) ? {
      presetCode: presetInfo.presetCode,
      titlePeople: titleFiltered.map(publicPerson),
      presetPeople: presetInfo.people.map(publicPerson)
    } : null
  };
}

async function getEmployeeProfile(session, args = {}) {
  ensureSession(session);
  const rows = await loadDirectoryRows();
  const resolved = resolvePerson(rows, args);
  const asOf = new Date().toISOString();
  if (resolved.ambiguous) return { asOf, found: false, ambiguous: true, candidates: resolved.candidates.map(publicPerson), person: null };
  if (!resolved.found) return { asOf, found: false, ambiguous: false, person: null };
  return { asOf, found: true, ambiguous: false, person: publicPerson(resolved.person) };
}

async function getManagerOf(session, args = {}) {
  ensureSession(session);
  const rows = await loadDirectoryRows();
  const resolved = resolvePerson(rows, args);
  const asOf = new Date().toISOString();
  if (resolved.ambiguous) return { asOf, found: false, ambiguous: true, candidates: resolved.candidates.map(publicPerson), employee: null, manager: null };
  if (!resolved.found) return { asOf, found: false, ambiguous: false, employee: null, manager: null };
  const employee = publicPerson(resolved.person);
  const managerCode = text(resolved.person.manager_code);
  const managerRow = managerCode ? findByCode(rows, managerCode) : null;
  const manager = managerRow
    ? publicPerson(managerRow)
    : (resolved.person.manager_name ? { employeeCode: managerCode, employeeName: resolved.person.manager_name, title: '', department: '', branch: '', managerCode: '', managerName: '', employeeStatus: '' } : null);
  return { asOf, found: true, ambiguous: false, employee, manager };
}

async function getDirectReports(session, args = {}) {
  ensureSession(session);
  const rows = await loadDirectoryRows();
  const resolved = resolvePerson(rows, args);
  const asOf = new Date().toISOString();
  if (resolved.ambiguous) return { asOf, found: false, ambiguous: true, candidates: resolved.candidates.map(publicPerson), manager: null, reports: [] };
  if (!resolved.found) return { asOf, found: false, ambiguous: false, manager: null, reports: [] };
  const manager = publicPerson(resolved.person);
  const code = text(resolved.person.employee_code).toUpperCase();
  const reports = code ? rows.filter(r => text(r.manager_code).toUpperCase() === code) : [];
  return { asOf, found: true, ambiguous: false, manager, reports: reports.map(publicPerson) };
}

// managementChain: di chuyen doc theo manager_code tu duoi len - co guard
// chong vong lap du lieu (seen set) va gioi han do sau (MAX_CHAIN_DEPTH),
// khong bao gio treo neu du lieu quan ly bi nhap vong.
async function getManagementChain(session, args = {}) {
  ensureSession(session);
  const rows = await loadDirectoryRows();
  const resolved = resolvePerson(rows, args);
  const asOf = new Date().toISOString();
  if (resolved.ambiguous) return { asOf, found: false, ambiguous: true, candidates: resolved.candidates.map(publicPerson), employee: null, chain: [] };
  if (!resolved.found) return { asOf, found: false, ambiguous: false, employee: null, chain: [] };

  const chain = [];
  const seen = new Set();
  let current = resolved.person;
  let depth = 0;
  let truncated = false;
  while (current && text(current.manager_code) && depth < MAX_CHAIN_DEPTH) {
    const managerCode = text(current.manager_code).toUpperCase();
    if (seen.has(managerCode)) break;
    seen.add(managerCode);
    const managerRow = findByCode(rows, managerCode);
    if (managerRow) {
      chain.push(publicPerson(managerRow));
      current = managerRow;
    } else {
      if (current.manager_name) chain.push({ employeeCode: managerCode, employeeName: current.manager_name, title: '', department: '', branch: '', managerCode: '', managerName: '', employeeStatus: '' });
      current = null;
    }
    depth++;
  }
  if (depth >= MAX_CHAIN_DEPTH && current && text(current.manager_code)) truncated = true;
  return { asOf, found: true, ambiguous: false, employee: publicPerson(resolved.person), chain, truncated };
}

async function getDepartmentDirectory(session, args = {}) {
  ensureSession(session);
  const rows = await loadDirectoryRows();
  const department = text(args.department);
  const asOf = new Date().toISOString();
  if (!department) return { asOf, department: '', available: false, total: 0, members: [], titles: [] };
  const norm = normalizeText(department);
  const members = rows.filter(r => normalizeText(r.department) === norm);
  const titles = [...new Set(members.map(m => text(m.title)).filter(Boolean))];
  return { asOf, department, available: members.length > 0, total: members.length, members: members.slice(0, RESULT_LIMIT).map(publicPerson), titles };
}

async function getBranchDirectory(session, args = {}) {
  ensureSession(session);
  const rows = await loadDirectoryRows();
  const branch = text(args.branch);
  const asOf = new Date().toISOString();
  if (!branch) return { asOf, branch: '', available: false, total: 0, members: [], titles: [] };
  const norm = normalizeText(branch);
  const members = rows.filter(r => normalizeText(r.branch) === norm);
  const titles = [...new Set(members.map(m => text(m.title)).filter(Boolean))];
  return { asOf, branch, available: members.length > 0, total: members.length, members: members.slice(0, RESULT_LIMIT).map(publicPerson), titles };
}

module.exports = {
  searchOrgPeople,
  getEmployeeProfile,
  getManagerOf,
  getDirectReports,
  getManagementChain,
  getDepartmentDirectory,
  getBranchDirectory
};
