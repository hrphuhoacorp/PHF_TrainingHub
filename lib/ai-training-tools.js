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

const LESSON_DATA_FILE = path.join(__dirname, '..', 'assets', 'data', 'phf-lessons-new-sales.js');

// GIAI DOAN 1 - HOI NHAP CHUNG: theo chot nghiep vu, day la chuong trinh
// dung chung cho MOI phong ban/nhan vien moi phu hop chuong trinh hoi nhap.
// ROOT CAUSE thuc su cua bug "43 != 120" (fix batch nay): ban dau adapter
// nay coi CA FILE la rieng cua Ban hang va gia dinh stage 0 = "chung" theo
// VI TRI - gia dinh do TRUNG HOP dung nhung khong bam vao du lieu that.
// Kiem lai truc tiep du lieu (assets/data/phf-lessons-new-sales.js) moi
// thay tung bai da tu khai bao ro pham vi qua field `departments`: 43 bai
// Giai doan 1 co departments=["all"], 77 bai Giai doan 2-5 co
// departments=["Bán hàng"] - DAY moi la nguon xac dinh chuan, khong phai vi
// tri stage. Adapter nay gio doc dung field `departments` thay vi doan qua
// stage index, de neu sau nay PHF them bai gan the phong ban khac (vd
// "Kho") thi tu dong dung ma khong can sua code them.
const COMMON_TAG = 'all';
const COMMON_STAGE_LABEL = 'Giai đoạn 1 - Hội nhập chung';
// Cau hoi khong neu phong ban -> mac dinh xet chuong trinh Ban hang (chuong
// trinh DUY NHAT hien co du lieu chuyen mon that trong Training Hub) nhung
// luon danh dau isDefault=true de buildStructuredResult neu ro day la gia
// dinh, khong phai cau hoi that ve Ban hang.
const DEFAULT_DEPARTMENT_TAG = 'Bán hàng';

// Nhan hien thi than thien cho tung tag phong ban XUAT HIEN THAT trong du
// lieu bai hoc (khac PROGRAM_LABELS o tren - do la nhan cho emp.programId
// cua tai khoan Training Hub, khong lien quan gating noi dung chuong trinh
// o day). Alias la cach noi tu do (khong dau, thuong) map ve dung 1 tag.
const DEPARTMENT_PROGRAM_LABEL = {
  'Bán hàng': 'Nhân viên bán hàng',
  'Quà tặng': 'Nhân viên quà tặng',
  'Kho': 'Nhân viên kho',
  'Online': 'Nhân viên online',
  'Trưởng cửa hàng': 'Trưởng cửa hàng'
};
const DEPARTMENT_TAG_ALIASES = {
  'Bán hàng': ['ban hang', 'nhan vien ban hang', 'kinh doanh', 'sales'],
  'Quà tặng': ['qua tang', 'nhan vien qua tang', 'gift'],
  'Kho': ['kho', 'nhan vien kho', 'warehouse'],
  'Online': ['online', 'nhan vien online'],
  'Trưởng cửa hàng': ['truong cua hang', 'quan ly cua hang', 'store lead', 'truong ca']
};

let cachedCurriculum = null;

function cleanEmployeeCode(value) {
  return String(value == null ? '' : value).trim().slice(0, MAX_EMPLOYEE_CODE_CHARS).toUpperCase();
}

function normalizeKey(value) {
  return String(value == null ? '' : value).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// GD1/GD4/GD5 (viet tat noi bo trong du lieu bai hoc goc) -> "Giai đoạn N"
// day du - chi ap dung cho nhan/label dua ra AI/nguoi dung, KHONG dong toi
// du lieu goc frontend Training Hub dang dung (assets/data/phf-lessons-new-sales.js).
function expandStageAbbrev(text) {
  return String(text == null ? '' : text).replace(/\bGĐ\s*(\d+)/gi, 'Giai đoạn $1');
}

// Doc file tinh window.PHF_LESSONS_NEW_SALES = [...] bang regex + JSON.parse
// (file la IIFE gan vao window, khong phai CommonJS module nen khong the
// require() thang) - CHI trich metadata tung bai (stage/badge/departments),
// bo qua body/sample/today/remember (noi dung HTML day du, khong can cho
// tool nay va se qua nang cho ngu canh model).
function loadCurriculum() {
  if (cachedCurriculum) return cachedCurriculum;
  let lessons = [];
  try {
    const raw = fs.readFileSync(LESSON_DATA_FILE, 'utf8');
    const match = raw.match(/window\.PHF_LESSONS_NEW_SALES\s*=\s*(\[[\s\S]*?\]);\s*\n\s*window\.PHF_LESSONS\s*=/);
    if (match) {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) {
        lessons = parsed.map(l => ({
          stage: Number(l.stage) || 0,
          badge: expandStageAbbrev(l.badge || ''),
          departments: Array.isArray(l.departments) ? l.departments.map(d => String(d == null ? '' : d).trim()).filter(Boolean) : [],
          title: String(l.title || '').trim(),
          sub: String(l.sub || '').trim()
        }));
      }
    }
  } catch (error) { lessons = []; }
  cachedCurriculum = lessons;
  return cachedCurriculum;
}

function isCommonLesson(lesson) { return lesson.departments.some(d => d.toLowerCase() === COMMON_TAG); }
function lessonAppliesToTag(lesson, tag) { return lesson.departments.some(d => d.toLowerCase() === tag.toLowerCase()); }

function stagesSummary(lessons) {
  const byStage = new Map();
  lessons.forEach(l => {
    if (!byStage.has(l.stage)) byStage.set(l.stage, { stage: l.stage, badge: l.badge || `Giai đoạn ${l.stage + 1}`, lessonCount: 0 });
    byStage.get(l.stage).lessonCount += 1;
  });
  return [...byStage.values()].sort((a, b) => a.stage - b.stage);
}

// Nhan dien tag phong ban tu input tu do - CHI khop dung 1 tag THAT xuat
// hien trong du lieu bai hoc (truc tiep hoac qua alias cach noi thong
// thuong), KHONG doan gan giong. Input rong -> mac dinh DEFAULT_DEPARTMENT_TAG
// nhung danh dau isDefault=true de buildStructuredResult tra loi co dieu
// kien dung khi cau hoi khong neu ro phong ban.
function resolveDepartmentTag(rawInput) {
  const trimmed = String(rawInput == null ? '' : rawInput).trim();
  if (!trimmed) return { tag: DEFAULT_DEPARTMENT_TAG, matched: false, isDefault: true };
  const norm = normalizeKey(trimmed);
  const knownTags = Object.keys(DEPARTMENT_PROGRAM_LABEL);
  for (const tag of knownTags) {
    if (normalizeKey(tag) === norm) return { tag, matched: true, isDefault: false };
  }
  for (const tag of knownTags) {
    if ((DEPARTMENT_TAG_ALIASES[tag] || []).some(alias => norm.includes(alias))) {
      return { tag, matched: true, isDefault: false };
    }
  }
  return { tag: null, matched: false, isDefault: false };
}

/* Tong quan chuong trinh dao tao - dung cho cau hoi kieu "nhan vien moi
   phai hoc tong bao nhieu bai / chuong trinh hoi nhap gom nhung gi". Chi tra
   so luong bai/giai doan, KHONG tra noi dung tung bai.

   ROOT CAUSE cu (fix batch nay): ham nay truoc day tra thang tong so bai
   cua 1 chuong trinh duy nhat (mac dinh Ban hang = 120 bai) roi de model tu
   dien giai cho MOI phong ban - dung la nguyen nhan cau "nhan vien phong Ke
   toan phai hoc bao nhieu bai" bi tra loi nham thanh 120. Ham nay gio tra
   RIENG commonLessons (loc theo departments=["all"] that trong du lieu, bat
   ke phong ban hoi) va specialization (chi co khi tag phong ban khop VA co
   bai nao gan tag do that), de buildStructuredResult khong the gop nham 2
   con so nay lam mot. */
async function getTrainingProgramOverview(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const rawInput = String(input.programId || input.department || '').trim();
  const resolved = resolveDepartmentTag(rawInput);
  const asOf = new Date().toISOString();

  const lessons = loadCurriculum();
  const commonLessons = lessons.filter(isCommonLesson);
  const commonCount = commonLessons.length;

  let specialization = null;
  if (resolved.tag) {
    const specLessons = lessons.filter(l => lessonAppliesToTag(l, resolved.tag));
    if (specLessons.length) {
      specialization = {
        programId: resolved.tag,
        programLabel: DEPARTMENT_PROGRAM_LABEL[resolved.tag] || resolved.tag,
        lessonCount: specLessons.length,
        stages: stagesSummary(specLessons),
        totalWithCommon: commonCount + specLessons.length
      };
    }
  }

  return {
    asOf,
    requestedInput: rawInput,
    matchedProgram: resolved.matched,
    isDefaultAssumption: resolved.isDefault,
    commonStageLabel: COMMON_STAGE_LABEL,
    commonLessons: commonCount,
    commonAppliesToAllDepartments: true,
    specialization,
    available: commonCount > 0
  };
}

const MAX_LESSON_RESULTS = 8;
const MAX_KEYWORD_CHARS = 80;

// Tim bai hoc THEO TU KHOA trong title/sub (metadata da co san, KHONG doc
// noi dung HTML body) - dung cho AI goi y khoa hoc lien quan mot ky nang
// (Batch 2, PHAN 4 "Training Connection"). Day la GOI Y cua AI dua tren
// khop tu khoa trong ten bai, KHONG PHAI mapping competency->training
// chinh thuc (hien chua ton tai trong he thong) - SYSTEM_PROMPT phai gan
// nhan ro AI RECOMMENDATION, khong duoc noi la mapping KNL chinh thuc.
async function searchTrainingLessonsByKeyword(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const keyword = String(input.keyword || '').trim().slice(0, MAX_KEYWORD_CHARS);
  const asOf = new Date().toISOString();
  if (!keyword) return { asOf, keyword: '', matches: [] };

  const rawInput = String(input.programId || input.department || '').trim();
  const resolved = resolveDepartmentTag(rawInput);
  const lessons = loadCurriculum();
  const scoped = resolved.tag
    ? lessons.filter(l => isCommonLesson(l) || lessonAppliesToTag(l, resolved.tag))
    : lessons;

  const normKeyword = normalizeKey(keyword);
  const matches = scoped
    .filter(l => normalizeKey(l.title).includes(normKeyword) || normalizeKey(l.sub).includes(normKeyword))
    .slice(0, MAX_LESSON_RESULTS)
    .map(l => ({ title: l.title, sub: l.sub, badge: l.badge, stage: l.stage }));

  return { asOf, keyword, programTag: resolved.tag || '', matches };
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

module.exports = { getTrainingProgramOverview, getMyTrainingProgress, getEmployeeTrainingProgress, searchTrainingLessonsByKeyword };
