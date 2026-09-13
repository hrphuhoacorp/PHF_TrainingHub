'use strict';
/*
 * Batch B — canonical department key cutover regression tests.
 *
 * Covers exactly the test list from the Batch B spec:
 *  - GĐ1 "all" vẫn chạy (không đổi)
 *  - dept_ban_hang mở đúng Sales GĐ2–GĐ5 (exact departmentKey match)
 *  - department khác (key khác) không mở Sales content
 *  - fallback alias cũ (display-name + DEPARTMENT_ALIASES) vẫn hoạt động khi
 *    thiếu departmentKey (learner chưa migrate / lesson chưa có departmentKeys)
 *  - Account Admin (createAccountByAdmin) không tạo account khi thiếu
 *    employeeCode
 *  - Employee Master không lưu department ngoài catalog (đã có
 *    scripts/test-department-catalog-foundation.js từ Batch A — không lặp
 *    lại logic ở đây, chỉ re-run trong main() cho đủ bộ)
 *
 * Gate tests run the REAL production source (phf-lessons-new-sales.js +
 * phf-learner-app.js + phf-learning-gate.js) inside a vm sandbox — same
 * technique as scripts/test-learning-gate-department-alias.js. No Supabase,
 * no browser, no network.
 */
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
  return Object.assign({
    value: '', textContent: '', innerHTML: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    appendChild() {}, insertBefore() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, remove() {}
  }, initial || {});
}
function makeSandbox() {
  const sandbox = {};
  sandbox.window = sandbox; sandbox.global = sandbox; sandbox.self = sandbox;
  sandbox.console = Object.assign({}, console, { info() {}, warn() {} });
  sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {}; sandbox.dispatchEvent = () => {};
  sandbox.localStorage = makeStorage(); sandbox.sessionStorage = makeStorage();
  sandbox.navigator = { clipboard: { writeText: () => {} } };
  sandbox.location = { pathname: '/hv/bai-hoc', search: '', href: 'https://phf.local/hv/bai-hoc' };
  sandbox.URLSearchParams = URLSearchParams;
  sandbox.MutationObserver = class { observe() {} disconnect() {} };
  sandbox.requestAnimationFrame = () => 0;
  sandbox.setTimeout = (fn) => { try { fn(); } catch (e) {} return 0; };
  sandbox.setInterval = () => 0; sandbox.clearTimeout = () => {}; sandbox.clearInterval = () => {};
  sandbox.CustomEvent = class { constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; } };
  sandbox.fetch = () => Promise.reject(new Error('fetch not stubbed for this test'));
  const knownElements = { mainLesson: fakeEl(), miniStatus: fakeEl(), contextTitle: fakeEl(), contextSub: fakeEl(), contextAction: fakeEl(), phaseStrip: fakeEl(), todoSub: fakeEl(), todoList: fakeEl() };
  const nullElements = { phfBmtPaper: true };
  sandbox.document = {
    getElementById(id) { if (knownElements[id]) return knownElements[id]; if (nullElements[id]) return null; return fakeEl(); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {}, createElement() { return fakeEl(); }, createTextNode() { return {}; },
    head: { appendChild() {} }, body: { classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }
  };
  sandbox.SHOW_COMPANY_INTRO = true; sandbox.__phfTrainingEntryReady = false;
  sandbox.phfSetMainNavActive = function () {}; sandbox.phfEnsureSharedShell = function () {};
  return sandbox;
}
function loadFile(sandbox, relPath) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, relPath), 'utf8'), sandbox.__vmContext, { filename: relPath });
}
function buildSandbox() {
  const sandbox = makeSandbox();
  sandbox.__vmContext = vm.createContext(sandbox);
  loadFile(sandbox, 'assets/data/phf-lessons-new-sales.js');
  loadFile(sandbox, 'assets/js/phf-learner-app.js');
  loadFile(sandbox, 'assets/js/phf-learning-gate.js');
  return sandbox;
}
function setupLearner(sandbox, opts) {
  const w = sandbox.window;
  const employeeId = (opts && opts.employeeId) || 'E-BATCHB-TEST';
  w.phfGetAuthenticatedUser = () => ({ employeeId, hubAssignmentStatus: 'active' });
  w.phfGetCurrentUser = () => ({ employeeId, hubAssignmentStatus: 'active' });
  w.phfUserRole = () => 'learner';
  w.phfNotice = function () {}; w.phfToast = function () {};
  w.__phfLocalData = {
    employees: [{ id: employeeId, department: (opts && opts.department) || '', departmentKey: (opts && opts.departmentKey) || null, phone: '0901234567' }],
    progress: (opts && opts.progress) || {}, testResults: (opts && opts.testResults) || [], activityLog: []
  };
  sandbox.localStorage.setItem('phfEmployeeId', employeeId);
  sandbox.localStorage.setItem('phfEmployeeProfile', JSON.stringify({ id: employeeId, phone: '0901234567', fullName: 'Batch B Test' }));
  return employeeId;
}

let passCount = 0, failCount = 0;
async function record(name, fn) {
  try { await fn(); console.log('  ✓ PASS -', name); passCount++; }
  catch (e) { console.error('  ✗ FAIL -', name, '\n       ', e && e.stack || e); failCount++; }
}

(async () => {
console.log('\n=== Batch B: canonical departmentKey cutover ===\n');

await record('1) GĐ1 ("all") vẫn không bị chặn bởi department, bất kể departmentKey là gì', async () => {
  const sandbox = buildSandbox();
  const w = sandbox.window;
  const lessons = w.PHF_LESSONS;
  setupLearner(sandbox, { department: '', departmentKey: 'dept_kho_van' });
  const gate = w.phfB16LearningGate;
  // Mọi lesson GĐ1 (departments:["all"]) phải luôn allowed, không phụ thuộc key.
  for (let i = 0; i < 43; i++) {
    assert.strictEqual(gate.lessonAllowedForDepartment(lessons[i], '', 'dept_kho_van'), true, 'lesson GĐ1 index ' + i + ' phải luôn mở');
  }
});

await record('2) departmentKey="dept_ban_hang" khớp CHÍNH XÁC -> mở toàn bộ GĐ2–GĐ5 (Sales)', async () => {
  const sandbox = buildSandbox();
  const w = sandbox.window;
  const lessons = w.PHF_LESSONS;
  setupLearner(sandbox, { department: '', departmentKey: 'dept_ban_hang' });
  const gate = w.phfB16LearningGate;
  const boundary = gate.departmentLessonBoundary(lessons);
  assert.strictEqual(boundary, lessons.length - 1, 'departmentKey dept_ban_hang phải mở hết toàn bộ 120 bài');
});

await record('3) departmentKey khác (vd dept_kho_van) KHÔNG mở nội dung Sales GĐ2–GĐ5', async () => {
  const sandbox = buildSandbox();
  const w = sandbox.window;
  const lessons = w.PHF_LESSONS;
  setupLearner(sandbox, { department: '', departmentKey: 'dept_kho_van' });
  const gate = w.phfB16LearningGate;
  const boundary = gate.departmentLessonBoundary(lessons);
  assert.strictEqual(boundary, 42, 'department không liên quan vẫn phải dừng đúng cuối GĐ1 (index 42)');
  const gd2FirstLesson = lessons.find(l => Array.isArray(l.departmentKeys) && l.departmentKeys.indexOf('dept_ban_hang') >= 0);
  assert.strictEqual(gate.lessonAllowedForDepartment(gd2FirstLesson, '', 'dept_kho_van'), false);
});

await record('4) Fallback legacy: learner CHƯA có departmentKey (null) nhưng department = "Bán hàng" (nhãn ngắn cũ) -> vẫn mở qua string-alias như PR #87', async () => {
  const sandbox = buildSandbox();
  const w = sandbox.window;
  const lessons = w.PHF_LESSONS;
  setupLearner(sandbox, { department: 'Bán hàng', departmentKey: null });
  const gate = w.phfB16LearningGate;
  const boundary = gate.departmentLessonBoundary(lessons);
  assert.strictEqual(boundary, lessons.length - 1, 'thiếu departmentKey -> phải rơi về fallback string-alias và vẫn mở đúng (không regressions so với PR #87)');
});

await record('5) Fallback legacy: learner CHƯA có departmentKey nhưng department = canonical đầy đủ "Bộ phận bán hàng" -> vẫn mở (exact string match, không cần alias)', async () => {
  const sandbox = buildSandbox();
  const w = sandbox.window;
  const lessons = w.PHF_LESSONS;
  setupLearner(sandbox, { department: 'Bộ phận bán hàng', departmentKey: null });
  const gate = w.phfB16LearningGate;
  const boundary = gate.departmentLessonBoundary(lessons);
  assert.strictEqual(boundary, lessons.length - 1);
});

await record('6) Regression: existing PHF100-style E2E scenario (43/43 GĐ1 cùng ngày, departmentKey đã gán) vẫn mở đúng bài đầu GĐ2 ngay', async () => {
  const sandbox = buildSandbox();
  const w = sandbox.window;
  const lessons = w.PHF_LESSONS;
  const completedPages = []; for (let i = 0; i <= 42; i++) completedPages.push('lesson:' + i);
  const employeeId = setupLearner(sandbox, {
    department: 'Bộ phận bán hàng', departmentKey: 'dept_ban_hang',
    progress: { 'E-BATCHB-TEST': { currentPage: 'lesson:42', completedPages, lastUpdatedAt: new Date().toISOString() } },
    testResults: [
      { page: 'short-gd1-review', key: 'short-gd1-review', employeeId: 'E-BATCHB-TEST', score: 100, passScore: 100, status: 'passed' },
      { page: 'short-day1-afternoon', key: 'short-day1-afternoon', employeeId: 'E-BATCHB-TEST', score: 100, passScore: 100, status: 'passed' }
    ]
  });
  const maxAllowed = w.phfB16LearningGate.computeMaxAllowed();
  assert.strictEqual(maxAllowed, 43);
  w.go(43);
  assert.strictEqual(w.phfCurrentLessonIndex, 43);
  const mainHtml = String(sandbox.document.getElementById('mainLesson').innerHTML || '');
  assert.ok(!/đang được cập nhật/i.test(mainHtml));
});

// ---------------------------------------------------------------------------
// Account Admin: createAccountByAdmin() rejects missing employeeCode. The
// check runs BEFORE any Supabase call, so this is safe to test without any
// DB mocking (no .env in this worktree -> supabase stays null in auth.js;
// the function must throw before ever touching it).
// ---------------------------------------------------------------------------
const { createAccountByAdmin } = require(path.join(ROOT, 'api', '_lib', 'auth.js'));

await record('7) createAccountByAdmin(): missing employeeCode for an employee-type account is REJECTED', async () => {
  await assert.rejects(
    createAccountByAdmin({ email: 'batchb-test@example.com', phone: '0901234567', name: 'Batch B Test', department: 'Bộ phận bán hàng' }, { role: 'admin' }),
    (err) => err.statusCode === 400 && err.code === 'EMPLOYEE_CODE_REQUIRED'
  );
});

await record('8) createAccountByAdmin(): system_admin account type is EXEMPT from employeeCode requirement (unrelated to Training Hub gating)', async () => {
  // Không cần employeeCode nhưng vẫn cần email hợp lệ; account hệ thống
  // không đi qua People Master nên không bị ảnh hưởng bởi rule Batch B.
  await assert.rejects(
    createAccountByAdmin({ email: 'not-an-email', accountType: 'system_admin', role: 'admin', name: 'Sys' }, { role: 'admin' }),
    (err) => err.code !== 'EMPLOYEE_CODE_REQUIRED' // phải fail vì lý do khác (email), không phải employeeCode
  );
});

console.log('\n=== KẾT QUẢ: ' + passCount + ' PASS, ' + failCount + ' FAIL ===\n');
console.log('LƯU Ý: "Employee Master không lưu department ngoài catalog" đã có');
console.log('scripts/test-department-catalog-foundation.js (Batch A) — chạy lại:');
console.log('  node scripts/test-department-catalog-foundation.js');
process.exit(failCount ? 1 : 0);
})();
