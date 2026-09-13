'use strict';
/* Regression: department-alias mismatch bug (case PHF100 Lê Thúy Loan).
   Root cause: lesson content (assets/data/phf-lessons-new-sales.js) tags
   GĐ2-5 with the short label "Bán hàng", while People Master returns the
   canonical org-catalog label "Bộ phận bán hàng" for the learner's real
   department. lessonAllowedForDepartment() used to exact-match strings, so
   the mismatch made departmentLessonBoundary() cap right at the end of GĐ1
   (index 42) even after 43/43 completion, permanently blocking GĐ2 content
   that already exists (77 lessons tagged "Bán hàng").

   Fix: a small, explicit alias map (DEPARTMENT_ALIASES) + normalizeDepartmentLabel()
   in phf-learning-gate.js, used by lessonAllowedForDepartment() before
   comparing. No fuzzy matching — only the confirmed pair "Bán hàng" <->
   "Bộ phận bán hàng".

   Chạy thật source production trong sandbox vm (không dùng Supabase/browser
   thật), giống pattern của scripts/test-training-hub-common-program.js và
   scripts/test-learner-lesson-surface-guard-fix.js. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); }
  };
}

function fakeEl(initial) {
  const el = Object.assign({
    value: '', textContent: '', innerHTML: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    appendChild() {}, insertBefore() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, remove() {}
  }, initial || {});
  return el;
}

function makeSandbox() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  sandbox.self = sandbox;
  sandbox.console = Object.assign({}, console, { info() {}, warn() {} });
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.dispatchEvent = () => {};
  sandbox.localStorage = makeStorage();
  sandbox.sessionStorage = makeStorage();
  sandbox.navigator = { clipboard: { writeText: () => {} } };
  sandbox.location = { pathname: '/hv/bai-hoc', search: '', href: 'https://phf.local/hv/bai-hoc' };
  sandbox.URLSearchParams = URLSearchParams;
  sandbox.MutationObserver = class { observe() {} disconnect() {} };
  sandbox.requestAnimationFrame = (fn) => 0;
  sandbox.setTimeout = (fn) => { try { fn(); } catch (e) {} return 0; };
  sandbox.setInterval = () => 0;
  sandbox.clearTimeout = () => {};
  sandbox.clearInterval = () => {};
  sandbox.CustomEvent = class { constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; } };
  sandbox.fetch = () => Promise.reject(new Error('fetch not stubbed for this test'));

  const knownElements = {
    mainLesson: fakeEl(),
    miniStatus: fakeEl(),
    contextTitle: fakeEl(),
    contextSub: fakeEl(),
    contextAction: fakeEl(),
    phaseStrip: fakeEl(),
    todoSub: fakeEl(),
    todoList: fakeEl()
  };
  const nullElements = { phfBmtPaper: true };
  sandbox.document = {
    getElementById(id) {
      if (knownElements[id]) return knownElements[id];
      if (nullElements[id]) return null;
      return fakeEl();
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    createElement() { return fakeEl(); },
    createTextNode() { return {}; },
    head: { appendChild() {} },
    body: { classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }
  };
  sandbox.SHOW_COMPANY_INTRO = true;
  sandbox.__phfTrainingEntryReady = false;
  sandbox.phfSetMainNavActive = function () {};
  sandbox.phfEnsureSharedShell = function () {};
  return sandbox;
}

function loadFile(sandbox, relPath) {
  const full = path.join(ROOT, relPath);
  const src = fs.readFileSync(full, 'utf8');
  vm.runInContext(src, sandbox.__vmContext, { filename: relPath });
}

function buildSandbox() {
  const sandbox = makeSandbox();
  const ctx = vm.createContext(sandbox);
  sandbox.__vmContext = ctx;
  loadFile(sandbox, 'assets/data/phf-lessons-new-sales.js');
  loadFile(sandbox, 'assets/js/phf-learner-app.js');
  loadFile(sandbox, 'assets/js/phf-learning-gate.js');
  return sandbox;
}

// employeeDepartment = giá trị THẬT trả về từ People Master (canonical, có
// thể lệch với nhãn ngắn gắn trên lesson content — đúng bản chất bug).
function setupLearner(sandbox, opts) {
  const w = sandbox.window;
  const employeeId = (opts && opts.employeeId) || 'PHF100';
  const department = (opts && opts.department) || 'Bộ phận bán hàng';
  const progress = (opts && opts.progress) || {};
  const testResults = (opts && opts.testResults) || [];
  w.phfGetAuthenticatedUser = () => ({ employeeId: employeeId, hubAssignmentStatus: 'active' });
  w.phfGetCurrentUser = () => ({ employeeId: employeeId, hubAssignmentStatus: 'active' });
  w.phfUserRole = () => 'learner';
  w.phfNotice = function () {};
  w.phfToast = function () {};
  w.__phfLocalData = {
    employees: [{ id: employeeId, department: department, phone: '0901234567' }],
    progress: progress,
    testResults: testResults,
    activityLog: []
  };
  sandbox.localStorage.setItem('phfEmployeeId', employeeId);
  sandbox.localStorage.setItem('phfEmployeeProfile', JSON.stringify({ id: employeeId, phone: '0901234567', fullName: 'Lê Thúy Loan' }));
  return employeeId;
}

let passCount = 0;
function ok(label) { passCount++; console.log('  ✓ PASS - ' + label); }

console.log('\n=== Regression: Training Hub department alias bug (case PHF100 Lê Thúy Loan) ===');
console.log('(chạy thật source production trong sandbox vm, không dùng Supabase/browser thật)\n');

// ---------------------------------------------------------------------------
// TEST 1: audit dữ liệu lesson thật — chỉ có đúng 2 nhãn ("all" và "Bán
// hàng"), xác nhận phạm vi alias cần thiết đúng như đã audit (không cần alias
// nào khác, không được tự thêm fuzzy match ngoài phạm vi này).
// ---------------------------------------------------------------------------
(function test1_auditLessonDepartmentTags() {
  const sandbox = buildSandbox();
  const lessons = sandbox.window.PHF_LESSONS;
  const tags = new Set();
  lessons.forEach(function (l) {
    (Array.isArray(l.departments) ? l.departments : []).forEach(function (d) { tags.add(d); });
  });
  assert.deepStrictEqual(Array.from(tags).sort(), ['all', 'Bán hàng'].sort(),
    'Dữ liệu lesson hiện tại chỉ được có đúng 2 nhãn "all" và "Bán hàng" — nếu khác, cần audit lại alias map thay vì giả định');
  ok('TEST 1 - Audit: lesson data chỉ dùng "all" + "Bán hàng", đúng phạm vi alias tối thiểu đã xác nhận');
})();

// ---------------------------------------------------------------------------
// TEST 2: unit-check lessonAllowedForDepartment()/departmentLessonBoundary()
// qua đúng export phfB16LearningGate — canonical "Bộ phận bán hàng" phải
// khớp lesson tag "Bán hàng" sau fix, và ranh giới phòng ban phải mở hết
// (không còn bị chặn ở cuối GĐ1).
// ---------------------------------------------------------------------------
(function test2_normalizedMatch() {
  const sandbox = buildSandbox();
  const w = sandbox.window;
  const gate = w.phfB16LearningGate;
  const lessons = w.PHF_LESSONS;
  const gd2FirstIdx = lessons.findIndex(function (l) { return Array.isArray(l.departments) && l.departments.indexOf('Bán hàng') >= 0; });
  assert.ok(gd2FirstIdx > 0, 'phải tìm được lesson đầu tiên gắn nhãn "Bán hàng" (đầu GĐ2)');

  assert.strictEqual(gate.lessonAllowedForDepartment(lessons[gd2FirstIdx], 'Bộ phận bán hàng'), true,
    'Lesson gắn "Bán hàng" phải được coi là hợp lệ với department canonical "Bộ phận bán hàng" (đây là fix chính)');
  // Không được để lệch ngược lại: nhãn ngắn cũ vẫn phải tự khớp chính nó.
  assert.strictEqual(gate.lessonAllowedForDepartment(lessons[gd2FirstIdx], 'Bán hàng'), true,
    'Lesson gắn "Bán hàng" vẫn phải khớp đúng nếu department là chính nhãn ngắn (không regressions)');
  // Phòng ban không liên quan vẫn phải bị chặn đúng như cũ (không nới lỏng quá tay).
  assert.strictEqual(gate.lessonAllowedForDepartment(lessons[gd2FirstIdx], 'Bộ phận kho vận'), false,
    'Lesson gắn "Bán hàng" vẫn phải bị chặn với phòng ban không liên quan (không được nới lỏng ngoài phạm vi alias)');

  setupLearner(sandbox, { department: 'Bộ phận bán hàng' });
  const boundary = gate.departmentLessonBoundary(lessons);
  assert.strictEqual(boundary, lessons.length - 1,
    'Với department canonical "Bộ phận bán hàng", ranh giới phòng ban phải MỞ HẾT (không còn bị chặn ở cuối GĐ1 index 42)');

  ok('TEST 2 - lessonAllowedForDepartment()/departmentLessonBoundary() khớp đúng normalize, không nới lỏng ngoài phạm vi alias');
})();

// ---------------------------------------------------------------------------
// TEST 3: mô phỏng ĐÚNG case PHF100 — GĐ1 đã hoàn tất 43/43 (kể cả bài kiểm
// tra ngắn giữa GĐ1), department thật là "Bộ phận bán hàng" — bài đầu GĐ2
// (lesson tagged "Bán hàng") phải cho phép mở, KHÔNG được render màn "Chương
// trình chuyên môn ... đang được cập nhật".
// ---------------------------------------------------------------------------
(function test3_phf100EndToEnd() {
  const sandbox = buildSandbox();
  const w = sandbox.window;
  const lessons = w.PHF_LESSONS;
  const gd1LastIdx = lessons.findIndex(function (l) {
    return !(Array.isArray(l.departments) && l.departments.indexOf('all') >= 0);
  }) - 1;
  assert.strictEqual(gd1LastIdx, 42, 'GĐ1 (lesson tagged "all") phải có đúng 43 bài (index 0..42) — khớp báo cáo PROD 43/43');
  const gd2FirstIdx = gd1LastIdx + 1;

  const completedPages = [];
  for (let i = 0; i <= gd1LastIdx; i++) completedPages.push('lesson:' + i);

  const employeeId = setupLearner(sandbox, {
    department: 'Bộ phận bán hàng', // canonical, đúng như People Master trả về thật
    progress: {
      PHF100: {
        currentPage: 'lesson:' + gd1LastIdx,
        completedPages: completedPages,
        lastUpdatedAt: new Date().toISOString()
      }
    },
    // Bài kiểm tra ngắn nằm trong GĐ1 (index 22 và 42 theo SHORT_TESTS) phải
    // đã đạt 100/100 để khớp đúng "GĐ1 = 100%, 43/43" như báo cáo PROD.
    testResults: [
      { page: 'short-gd1-review', key: 'short-gd1-review', employeeId: 'PHF100', score: 100, passScore: 100, status: 'passed' },
      { page: 'short-day1-afternoon', key: 'short-day1-afternoon', employeeId: 'PHF100', score: 100, passScore: 100, status: 'passed' }
    ]
  });

  const maxAllowed = w.phfB16LearningGate.computeMaxAllowed();
  assert.strictEqual(maxAllowed, gd2FirstIdx,
    'Sau khi hoàn tất 43/43 GĐ1 (kể cả bài kiểm tra ngắn), hệ thống phải cho phép mở đúng bài đầu GĐ2 (index ' + gd2FirstIdx + ') — không cần chờ sang ngày hôm sau');

  w.go(gd2FirstIdx);
  assert.strictEqual(w.phfCurrentLessonIndex, gd2FirstIdx,
    'go(' + gd2FirstIdx + ') (bài đầu GĐ2, gắn nhãn "Bán hàng") phải được phép mở với department canonical "Bộ phận bán hàng"');

  const mainHtml = String(sandbox.document.getElementById('mainLesson').innerHTML || '');
  assert.ok(!/đang được cập nhật/i.test(mainHtml),
    'KHÔNG được render màn "Chương trình chuyên môn ... đang được cập nhật" — nội dung GĐ2 đã tồn tại và đúng phòng ban (chỉ lệch nhãn, đã fix)');

  ok('TEST 3 - Case PHF100: GĐ1 43/43 xong trong ngày -> bài đầu GĐ2 mở ngay, không hiện màn "đang được cập nhật"');
})();

// ---------------------------------------------------------------------------
// TEST 4: không regressions — department THẬT SỰ không có nội dung tương ứng
// (không phải lỗi alias) vẫn phải bị chặn đúng như cũ (bảo toàn hành vi chặn
// hợp lệ, chỉ sửa đúng case lệch nhãn đã xác nhận).
// ---------------------------------------------------------------------------
(function test4_unrelatedDepartmentStillBlocked() {
  const sandbox = buildSandbox();
  const w = sandbox.window;
  const lessons = w.PHF_LESSONS;
  const gd2FirstIdx = lessons.findIndex(function (l) { return Array.isArray(l.departments) && l.departments.indexOf('Bán hàng') >= 0; });
  const completedPages = [];
  for (let i = 0; i < gd2FirstIdx; i++) completedPages.push('lesson:' + i);

  const employeeId = setupLearner(sandbox, {
    department: 'Bộ phận kho vận', // phòng ban thật KHÔNG liên quan tới "Bán hàng"
    progress: { 'E-KHO': { currentPage: 'lesson:' + (gd2FirstIdx - 1), completedPages: completedPages, lastUpdatedAt: new Date().toISOString() } },
    testResults: [
      { page: 'short-gd1-review', key: 'short-gd1-review', employeeId: 'E-KHO', score: 100, passScore: 100, status: 'passed' },
      { page: 'short-day1-afternoon', key: 'short-day1-afternoon', employeeId: 'E-KHO', score: 100, passScore: 100, status: 'passed' }
    ],
    employeeId: 'E-KHO'
  });
  sandbox.localStorage.setItem('phfEmployeeId', 'E-KHO');

  const boundary = w.phfB16LearningGate.departmentLessonBoundary(lessons);
  assert.strictEqual(boundary, gd2FirstIdx - 1,
    'Phòng ban thật không liên quan (Bộ phận kho vận) vẫn phải bị chặn đúng ở cuối GĐ1 — không được nới lỏng ngoài phạm vi alias "Bán hàng"<->"Bộ phận bán hàng"');

  ok('TEST 4 - Không regressions: phòng ban không liên quan vẫn bị chặn đúng như trước fix');
})();

console.log('\n=== KẾT QUẢ: ' + passCount + '/4 nhóm test PASS ===\n');
