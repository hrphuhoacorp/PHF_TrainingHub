'use strict';

/* PHF AI Sandbox - Classroom READ-ONLY adapter cho DeepSeek tool-calling.
   Dung LAI dung listClasses()/getClass() (lib/classroom-db.js) va
   getLearning() (lib/classroom-learning.js) - CUNG ham, CUNG permission
   engine (publicForSession(), enrollmentFor()) ma man Classroom that dang
   dung. KHONG tu query Supabase, KHONG tu doc classroom_* table.

   Luu y ve pham vi (xem TRACE report): Classroom hien khong co scope theo
   phong ban/chi nhanh cho role manager (manager thay moi lop khong phai
   draft, dung y het khi ho tu vao UI Classroom that) - adapter nay PHAN
   ANH DUNG hanh vi co san cua he thong, KHONG tu thu hep hay mo rong
   permission business hien huu. */

const { listClasses, getClass } = require('./classroom-db');
const { getLearning } = require('./classroom-learning');
const { getChecklistReportAccess } = require('./checklist-permissions');

const MIN_LIMIT = 1;
const MAX_LIMIT = 10;
const DEFAULT_SEARCH_LIMIT = 5;
const MAX_FILTER_CHARS = 80;
const MAX_CLASS_ID_CHARS = 80;

function cleanFilter(value) {
  return String(value == null ? '' : value).trim().slice(0, MAX_FILTER_CHARS);
}
function cleanClassId(value) {
  return String(value == null ? '' : value).trim().slice(0, MAX_CLASS_ID_CHARS);
}
function clampLimit(value, fallback) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, parsed));
}
function normalizeText(value) {
  return String(value == null ? '' : value).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function publicClassSummary(cls) {
  return {
    classId: cls.id,
    classCode: cls.classCode || '',
    className: cls.className || '',
    status: cls.status || '',
    startAt: cls.startAt || '',
    endAt: cls.endAt || '',
    enrolledCount: Array.isArray(cls.enrollments) ? cls.enrollments.length : 0,
    sessionCount: Array.isArray(cls.sessions) ? cls.sessions.length : 0
  };
}

// Tim lop Classroom theo ten/ma - dung cho cau hoi kieu "lop Ky nang ban
// hang co nhung ai", hoac buoc dau de lay classId truoc khi goi
// get_classroom_class_learning(). KHONG tra chi tiet bai hoc/tien do o day
// (tranh fan-out goi getLearning() cho tung lop trong danh sach).
async function searchClassroomClasses(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const limit = clampLimit(input.limit, DEFAULT_SEARCH_LIMIT);
  const query = normalizeText(cleanFilter(input.query));

  const classes = await listClasses(session);
  const filtered = classes.filter(c => {
    if (!query) return true;
    const haystack = normalizeText([c.className, c.classCode].join(' '));
    return haystack.includes(query);
  });

  return {
    asOf: new Date().toISOString(),
    total: filtered.length,
    classes: filtered.slice(0, limit).map(publicClassSummary)
  };
}

// Tien do hoc cua 1 lop - can classId (lay tu search_classroom_classes o
// luot goi truoc). getLearning() tu phan biet learner (chi thay tien do
// cua chinh minh, throw 403 neu chua ghi danh) voi admin/manager (thay
// tong hop tat ca hoc vien trong lop, dung hanh vi UI that).
async function getClassroomClassLearning(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const classId = cleanClassId(input.classId);
  const asOf = new Date().toISOString();
  if (!classId) return { found: false, classId: '', asOf, learning: null };

  const cls = await getClass(session, classId);
  const learning = await getLearning(session, classId);

  const base = {
    found: true,
    classId,
    className: cls.className || '',
    asOf
  };

  if (Array.isArray(learning.learnerSummaries)) {
    // Enrollment chi co employeeId (dang emp-xxx), khong co ten - tra cuu
    // ten qua checklist_employee_assignments (nguon actor da duoc phep xem
    // qua getChecklistReportAccess, khong mo quyen moi) de tra loi de doc
    // hon. Neu khong co grant bao cao Checklist hoac khong khop, giu
    // employeeName rong - KHONG bia ten.
    let nameById = new Map();
    try {
      const access = await getChecklistReportAccess(session);
      (access.people || []).forEach(p => { if (p.employeeId) nameById.set(String(p.employeeId), p.employeeName || ''); });
    } catch (error) { /* khong co quyen bao cao Checklist - bo qua enrich ten, khong chan ket qua roster */ }

    return {
      ...base,
      mode: 'roster',
      learnerSummaries: learning.learnerSummaries.map(s => ({
        employeeId: s.enrollment?.employeeId || '',
        employeeName: nameById.get(String(s.enrollment?.employeeId || '')) || '',
        totalLessons: s.totalLessons,
        requiredLessons: s.requiredLessons,
        completedRequired: s.completedRequired,
        percent: s.percent,
        status: s.status
      }))
    };
  }

  return {
    ...base,
    mode: 'self',
    summary: learning.summary || null
  };
}

module.exports = { searchClassroomClasses, getClassroomClassLearning };
