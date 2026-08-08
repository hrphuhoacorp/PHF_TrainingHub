'use strict';

/* PHF AI Sandbox - Training Hub READ-ONLY adapter cho DeepSeek tool-calling.
   Nguon du lieu tien do: readData() (lib/db.js), CUNG ham ma api/data.js
   dang dung - KHONG tu query Supabase moi. Luon truyen employeeId cu the
   khi hoi 1 nguoi (readData({employeeId}) da tu .eq('id',employeeId) o
   ca 2 runtime Supabase/file) - KHONG BAO GIO goi readData() khong
   employeeId roi tu loc, vi payload khong loc se la toan bo tien do cong
   ty (xem TRACE report).

   Crosswalk employeeCode (PHF032, dung o Checklist/KNL) -> employeeId
   (emp-xxx, dung o Training Hub) DI QUA getChecklistReportAccess()
   (lib/checklist-permissions.js) - CUNG nguon, CUNG quyen (scope theo
   phong ban/chi nhanh cho manager, 403 neu chua co grant xem bao cao) ma
   search_employees/get_employee_profile dang dung. KHONG tu doc
   user_accounts (chua ma nhay cam hon nhu email/phone).

   Chuong trinh hoc (chuong trinh hoi nhap, danh sach bai/giai doan) KHONG
   co bang du lieu rieng - nguon chuan DUY NHAT la file tinh
   assets/data/phf-lessons-new-sales.js (chinh frontend Training Hub dang
   dung, xem assets/js/phf-training-library.js). Adapter nay CHI doc
   metadata (stage/badge/dem so bai), KHONG doc/tra ve noi dung HTML/body
   cua tung bai (qua lon, khong lien quan cau hoi tien do). */

const fs = require('fs');
const path = require('path');
const { readData } = require('./db');
const { getChecklistReportAccess } = require('./checklist-permissions');

const MAX_EMPLOYEE_CODE_CHARS = 32;
const MAX_TEST_RESULTS_RETURNED = 12;

// Nhan hien thi chuong trinh - mirror dung y het assets/js/phf-training-library.js
// (chi la nhan, khong phai nguon du lieu tien do).
const PROGRAM_LABELS = {
  new_sales: 'Nhân viên bán hàng',
  new_gift: 'Nhân viên quà tặng',
  new_warehouse: 'Nhân viên kho',
  new_online: 'Nhân viên online',
  new_store_lead: 'Trưởng cửa hàng'
};

const LESSON_DATA_FILES = {
  new_sales: path.join(__dirname, '..', 'assets', 'data', 'phf-lessons-new-sales.js')
};

const cachedCurriculumByProgram = new Map();

function cleanEmployeeCode(value) {
  return String(value == null ? '' : value).trim().slice(0, MAX_EMPLOYEE_CODE_CHARS).toUpperCase();
}

// Doc file tinh window.PHF_LESSONS_NEW_SALES = [...] bang regex + JSON.parse
// (file la IIFE gan vao window, khong phai CommonJS module nen khong the
// require() thang) - CHI trich metadata tung bai (stage/badge/title), bo
// qua body/sample/today/remember (noi dung HTML day du, khong can cho tool
// nay va se qua nang cho ngu canh model).
function loadCurriculum(programId) {
  if (cachedCurriculumByProgram.has(programId)) return cachedCurriculumByProgram.get(programId);
  const filePath = LESSON_DATA_FILES[programId];
  let result = { ok: false, lessons: [] };
  if (filePath) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const match = raw.match(/window\.PHF_LESSONS_NEW_SALES\s*=\s*(\[[\s\S]*?\]);\s*\n\s*window\.PHF_LESSONS\s*=/);
      if (match) {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed)) {
          result = {
            ok: true,
            lessons: parsed.map(l => ({ stage: Number(l.stage) || 0, badge: String(l.badge || ''), title: String(l.title || ''), nav: String(l.nav || '') }))
          };
        }
      }
    } catch (error) {
      result = { ok: false, lessons: [] };
    }
  }
  cachedCurriculumByProgram.set(programId, result);
  return result;
}

function buildProgramOverview(programId) {
  const curriculum = loadCurriculum(programId);
  if (!curriculum.ok || !curriculum.lessons.length) return { ok: false, programId, totalLessons: 0, stages: [] };
  const byStage = new Map();
  curriculum.lessons.forEach(l => {
    const key = l.stage;
    if (!byStage.has(key)) byStage.set(key, { stage: key, badge: l.badge || `Giai đoạn ${key + 1}`, lessonCount: 0 });
    byStage.get(key).lessonCount += 1;
  });
  return {
    ok: true,
    programId,
    totalLessons: curriculum.lessons.length,
    stages: [...byStage.values()].sort((a, b) => a.stage - b.stage)
  };
}

/* Tong quan chuong trinh dao tao - dung cho cau hoi kieu "nhan vien moi
   phai hoc tong bao nhieu bai / chuong trinh hoi nhap gom nhung gi".
   Chi tra so luong bai/giai doan, KHONG tra noi dung tung bai. */
async function getTrainingProgramOverview(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const programId = String(input.programId || 'new_sales').trim().toLowerCase() || 'new_sales';
  const asOf = new Date().toISOString();
  const overview = buildProgramOverview(programId);
  return {
    asOf,
    programId,
    programLabel: PROGRAM_LABELS[programId] || programId,
    available: overview.ok,
    totalLessons: overview.totalLessons,
    stages: overview.stages
  };
}

async function readProgressFor(employeeId, employeeCodeForOutput) {
  const asOf = new Date().toISOString();
  if (!employeeId) return { found: false, employeeId: '', employeeCode: employeeCodeForOutput || '', asOf, progress: null };

  const data = await readData({ employeeId });
  const emp = Array.isArray(data.employees) ? data.employees[0] : null;
  if (!emp) return { found: false, employeeId, employeeCode: employeeCodeForOutput || '', asOf, progress: null };

  const prog = (data.progress || {})[employeeId] || null;
  const tests = (Array.isArray(data.testResults) ? data.testResults : [])
    .filter(t => String(t.employeeId || '') === employeeId)
    .sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')))
    .slice(0, MAX_TEST_RESULTS_RETURNED)
    .map(t => ({ page: t.page || '', score: t.score, passScore: t.passScore, status: t.status || '', savedAt: t.savedAt || '' }));

  return {
    found: true,
    employeeId,
    employeeCode: employeeCodeForOutput || '',
    asOf,
    fullName: emp.fullName || '',
    programId: emp.programId || 'new_sales',
    programLabel: PROGRAM_LABELS[emp.programId] || emp.programId || '',
    progress: {
      currentPage: prog?.currentPage || '',
      unlockedSteps: Array.isArray(prog?.unlockedSteps) ? prog.unlockedSteps : [],
      completedPagesCount: Array.isArray(prog?.completedPages) ? prog.completedPages.length : 0,
      lastUpdatedAt: prog?.lastUpdatedAt || ''
    },
    testResults: tests
  };
}

// Tien do dao tao CUA CHINH nguoi dang hoi - moi role deu goi duoc, khong
// can crosswalk (session da co san employeeId).
async function getMyTrainingProgress(session) {
  const employeeId = String(session?.employeeId || session?.account?.employeeId || '').trim();
  return readProgressFor(employeeId, String(session?.employeeCode || session?.account?.employeeCode || ''));
}

// Tien do dao tao CUA NGUOI KHAC theo ma nhan vien - CHI trong pham vi
// getChecklistReportAccess() da scope san cho actor (giong het
// get_employee_profile). Neu actor chua co quyen xem bao cao Checklist,
// ham goc tu throw 403 - de nguyen loi nay lan len (executeToolCall da xu
// ly nhu tool error, KHONG tu bat roi tra du lieu thay the).
async function getEmployeeTrainingProgress(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const employeeCode = cleanEmployeeCode(input.employeeCode);
  const asOf = new Date().toISOString();
  if (!employeeCode) return { found: false, employeeCode: '', asOf, progress: null };

  const access = await getChecklistReportAccess(session);
  const people = Array.isArray(access.people) ? access.people : [];
  const match = people.find(p => String(p.employeeCode || '').toUpperCase() === employeeCode);
  if (!match || !match.employeeId) return { found: false, employeeCode, asOf, progress: null };

  return readProgressFor(String(match.employeeId), employeeCode);
}

module.exports = { getTrainingProgramOverview, getMyTrainingProgress, getEmployeeTrainingProgress };
