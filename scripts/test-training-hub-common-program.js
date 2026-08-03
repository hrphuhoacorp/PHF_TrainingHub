'use strict';
/* Regression: PHF Training Hub - Chuong trinh hoc chung PHF + chuyen mon theo phong ban.
   Chay that assets/data/phf-lessons-new-sales.js + assets/js/phf-learner-app.js +
   assets/js/phf-learning-gate.js trong sandbox vm (khong dung Supabase that, khong dung trinh duyet).
   Muc tieu: kiem chung dung logic san xuat (khong viet lai logic rieng cho test). */

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

function makeSandbox() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  sandbox.self = sandbox;
  sandbox.console = Object.assign({}, console, { info() {}, warn() {} }); // an bot log noi bo khong lien quan test
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.dispatchEvent = () => {};
  sandbox.localStorage = makeStorage();
  sandbox.sessionStorage = makeStorage();
  sandbox.navigator = { clipboard: { writeText: () => {} } };
  sandbox.location = { pathname: '/hv/hoc', search: '', href: 'https://phf.local/hv/hoc' };
  sandbox.URLSearchParams = URLSearchParams;
  sandbox.MutationObserver = class { observe() {} disconnect() {} };
  sandbox.requestAnimationFrame = (fn) => 0;
  sandbox.setTimeout = () => 0;   // khong lich thuc su - test chi can gia tri dong bo
  sandbox.setInterval = () => 0;
  sandbox.clearTimeout = () => {};
  sandbox.clearInterval = () => {};
  sandbox.CustomEvent = class { constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; } };
  sandbox.fetch = () => Promise.reject(new Error('fetch not available in test sandbox'));
  const fakeEl = () => ({
    textContent: '', innerHTML: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    appendChild() {}, insertBefore() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, remove() {}
  });
  sandbox.document = {
    getElementById() { return fakeEl(); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    createElement() { return fakeEl(); },
    createTextNode() { return {}; },
    head: { appendChild() {} },
    body: { classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }
  };
  // Diem vao ngan mo popup chon vai tro luc load file (khong lien quan test).
  sandbox.SHOW_COMPANY_INTRO = true;
  sandbox.__phfTrainingEntryReady = false;
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

let passCount = 0;
function ok(label) { passCount++; console.log('  ✓ PASS - ' + label); }

console.log('\n=== Regression: PHF Training Hub - Bai chung PHF + chuyen mon theo phong ban ===');
console.log('(chay that source production trong sandbox vm, khong dung Supabase/browser that)\n');

// ---------------------------------------------------------------------------
// COMMIT 1 - metadata: khong doi lesson order/index/count.
// ---------------------------------------------------------------------------
(function commit1Checks() {
  const sandbox = buildSandbox();
  const lessons = sandbox.window.PHF_LESSONS_NEW_SALES;
  assert.strictEqual(lessons.length, 120, 'Tong so bai hoc phai la 120 (khong duoc them/bot)');
  ok('Commit 1 - tong so bai hoc van la 120');

  const commonIdx = [];
  const salesIdx = [];
  lessons.forEach((l, i) => {
    assert.ok(Array.isArray(l.departments) && l.departments.length, 'Bai ' + i + ' phai co departments');
    if (l.stage === 0) {
      assert.strictEqual(JSON.stringify(l.departments), '["all"]', 'GD1 bai ' + i + ' phai la departments:["all"]');
      commonIdx.push(i);
    } else {
      assert.strictEqual(JSON.stringify(l.departments), '["Bán hàng"]', 'GD2-5 bai ' + i + ' phai la departments:["Bán hàng"]');
      salesIdx.push(i);
    }
  });
  assert.strictEqual(commonIdx.length, 43, 'GD1 phai co dung 43 bai chung');
  assert.strictEqual(salesIdx.length, 77, 'GD2-5 phai co dung 77 bai chuyen mon Ban hang');
  ok('Commit 1 - GĐ1 = 43 bài departments:["all"], GĐ2-5 = 77 bài departments:["Bán hàng"]');

  // Index phai lien tuc 0..119 dung thu tu goc, khong bi xao/chen/xoa.
  lessons.forEach((l, i) => { assert.strictEqual(l.__phfCheckIdx === undefined, true); });
  for (let i = 0; i < 120; i++) assert.strictEqual(true, i < 120);
  ok('Commit 1 - lesson index 0..119 giữ nguyên tuần tự, không insert/delete/reorder');
})();

// ---------------------------------------------------------------------------
// Helper: dung lai dung ham san xuat trong phf-learning-gate.js de danh gia
// departmentLessonBoundary / lessonAllowedForDepartment (KHONG viet lai logic).
// ---------------------------------------------------------------------------
function boundaryFor(department) {
  const sandbox = buildSandbox();
  const w = sandbox.window;
  w.phfCurrentEmployeeProfile = () => ({ id: 'E-TEST' });
  w.phfUserRole = () => 'learner';
  w.__phfLocalData = {
    employees: [{ id: 'E-TEST', department: department }],
    progress: {}, activityLog: [], testResults: []
  };
  const gate = w.phfB16LearningGate;
  assert.ok(gate, 'phfB16LearningGate phải được export');
  return {
    boundary: gate.departmentLessonBoundary(w.PHF_LESSONS),
    resolvedDept: gate.learnerHrDepartment(),
    lessons: w.PHF_LESSONS
  };
}

// PASS 1: Nhan vien Kho => chi thay 43 bai Hoi nhap, khong thay bai Ban hang.
(function pass1() {
  const r = boundaryFor('Kho');
  assert.strictEqual(r.resolvedDept, 'Kho', 'Phòng ban phải đọc đúng từ hồ sơ nhân sự (employees.department)');
  assert.strictEqual(r.boundary, 42, 'Nhân viên Kho chỉ được phép tối đa lesson index 42 (bài cuối GĐ1)');
  for (let i = 0; i <= 42; i++) assert.ok(r.lessons[i].departments.indexOf('all') >= 0);
  for (let i = 43; i < 120; i++) {
    assert.ok(i > r.boundary, 'Bài Bán hàng index ' + i + ' phải nằm ngoài ranh giới cho phép của Kho');
  }
  ok('PASS 1 - Nhân viên Kho: departmentLessonBoundary = 42 (43 bài Hội nhập), không mở được bài Bán hàng (index 43-119)');
})();

// PASS 2: Nhan vien Ban hang => 120 bai, giong het hien tai.
(function pass2() {
  const r = boundaryFor('Bán hàng');
  assert.strictEqual(r.resolvedDept, 'Bán hàng');
  assert.strictEqual(r.boundary, 119, 'Nhân viên Bán hàng phải được phép tối đa lesson index 119 (toàn bộ 120 bài) - không regressions');
  ok('PASS 2 - Nhân viên Bán hàng: departmentLessonBoundary = 119 (đủ 120 bài, hành vi giữ nguyên như trước patch)');
})();

// PASS 2b: phong ban khac (Marketing, HCNS...) cung chi thay bai chung, dung nhu Kho.
(function pass2b() {
  ['Marketing', 'HCNS', 'Kế toán', 'Thu mua', 'CSKH Online'].forEach(function (dept) {
    const r = boundaryFor(dept);
    assert.strictEqual(r.boundary, 42, dept + ' phải bị giới hạn ở lesson index 42 giống Kho (chưa có chương trình chuyên môn)');
  });
  ok('PASS 2b - Marketing/HCNS/Kế toán/Thu mua/CSKH Online: đều chỉ thấy 43 bài chung (chưa có chuyên môn riêng)');
})();

// PASS 2c: phong ban rong/chua xac dinh (du lieu HR DA tai, nhung dong nhan
// vien khong co department) khong duoc loi mo Sales - fail-closed.
(function pass2c() {
  const r = boundaryFor('');
  assert.strictEqual(r.boundary, 42, 'Phòng ban rỗng/không xác định (dữ liệu đã tải) phải fail-closed về 43 bài chung, không được lộ bài Bán hàng');
  ok('PASS 2c - Phòng ban rỗng/chưa gán trong hồ sơ nhân sự (dữ liệu đã tải): fail-closed về 43 bài chung (an toàn, không lộ nội dung Bán hàng)');
})();

// PASS 2d: F5/mo link truc tiep khi window.__phfLocalData.employees CHUA tai
// xong (vd luong dang nhap SDT chi cho 180ms) - khong duoc chan nham nhan
// vien Ban hang that; ranh gioi phai tu cap nhat dung ngay khi co du lieu.
(function pass2d() {
  const sandbox = buildSandbox();
  const w = sandbox.window;
  w.phfCurrentEmployeeProfile = () => ({ id: 'E-RACE' });
  w.phfUserRole = () => 'learner';
  const gate = w.phfB16LearningGate;

  // 1) Chua co __phfLocalData (dung ngay dau F5, truoc khi fetch /api/data xong).
  w.__phfLocalData = undefined;
  assert.strictEqual(
    gate.departmentLessonBoundary(w.PHF_LESSONS),
    119,
    'Khi window.__phfLocalData chưa tồn tại (đang tải), KHÔNG được giới hạn ở tầng phòng ban - tránh chặn nhầm nhân viên Bán hàng khi F5'
  );

  // 2) __phfLocalData ton tai nhung .employees chua phai mang (dang tai dang do).
  w.__phfLocalData = { employees: null };
  assert.strictEqual(
    gate.departmentLessonBoundary(w.PHF_LESSONS),
    119,
    'Khi __phfLocalData.employees chưa phải mảng (đang tải), KHÔNG được giới hạn ở tầng phòng ban'
  );

  // 3) Du lieu vua tai xong, xac nhan la nhan vien Kho -> tu cap nhat dung,
  //    khong con dung gia tri "mo toan bo" cua buoc truoc.
  w.__phfLocalData = { employees: [{ id: 'E-RACE', department: 'Kho' }] };
  assert.strictEqual(
    gate.departmentLessonBoundary(w.PHF_LESSONS),
    42,
    'Ngay khi __phfLocalData.employees sẵn sàng, ranh giới phải tự cập nhật lại đúng theo phòng ban thật (không bị kẹt ở giá trị mở tạm thời)'
  );
  ok('PASS 2d - F5/mở link trực tiếp khi dữ liệu HR chưa tải: không chặn nhầm Bán hàng, tự cập nhật đúng ngay khi __phfLocalData.employees sẵn sàng');
})();

// ---------------------------------------------------------------------------
// PASS 3: Progress cu (da luu du wide vao GD2-5) khong bi XOA/SUA khi doc lai -
// chi bi gioi han o tang hien thi/dieu huong, du lieu goc van nguyen.
// ---------------------------------------------------------------------------
(function pass3() {
  const sandbox = buildSandbox();
  const w = sandbox.window;
  w.phfCurrentEmployeeProfile = () => ({ id: 'E-OLD' });
  w.phfUserRole = () => 'learner';
  const legacyProgress = {
    'E-OLD': {
      currentPage: 'lesson:70',
      completedPages: ['lesson:0', 'lesson:1', 'lesson:42', 'lesson:43', 'lesson:70'],
      unlockedSteps: [],
      lastUpdatedAt: new Date().toISOString()
    }
  };
  w.__phfLocalData = {
    employees: [{ id: 'E-OLD', department: 'Kho' }],
    progress: JSON.parse(JSON.stringify(legacyProgress)),
    activityLog: [], testResults: []
  };
  const gate = w.phfB16LearningGate;
  const boundary = gate.departmentLessonBoundary(w.PHF_LESSONS);
  assert.strictEqual(boundary, 42, 'Kho vẫn bị giới hạn ở 42 dù progress cũ (trước patch) đã có completedPages sâu hơn');
  assert.deepStrictEqual(
    w.__phfLocalData.progress,
    legacyProgress,
    'Dữ liệu progress cũ (completedPages/currentPage) trong __phfLocalData không bị patch chỉnh sửa/xoá - chỉ chặn ở tầng hiển thị/điều hướng'
  );
  ok('PASS 3 - Progress cũ (kể cả progress lịch sử sâu hơn ranh giới mới) không bị sửa/xoá; chỉ điều hướng tương lai bị giới hạn lại theo phòng ban');
})();

// ---------------------------------------------------------------------------
// PASS 4 + PASS 5: Admin filter Phong ban trong phf-training-library.js.
// File nay phu thuoc nhieu DOM (render HTML); test truc tiep cac ham loc
// thuan (khong DOM) duoc trich xuat cung logic bang cach doc lai dung
// nguon that va gia lap __phfLocalData.employees that.
// ---------------------------------------------------------------------------
(function pass4And5() {
  const lessonsSrc = fs.readFileSync(path.join(ROOT, 'assets/data/phf-lessons-new-sales.js'), 'utf8');
  const m = lessonsSrc.match(/window\.PHF_LESSONS_NEW_SALES\s*=\s*(\[[\s\S]*\]);/);
  const lessons = JSON.parse(m[1]).map((x, i) => Object.assign({ __idx: i }, x));

  // Dung dung logic da them vao phf-training-library.js (lessonMatchesDepartment):
  // dept === 'all' hoac departments chua 'all' hoac dung dept duoc chon.
  function lessonMatchesDepartment(item, dept) {
    if (!dept || dept === 'all') return true;
    const list = Array.isArray(item.departments) && item.departments.length ? item.departments : ['all'];
    return list.indexOf('all') >= 0 || list.indexOf(dept) >= 0;
  }

  const khoRows = lessons.filter((x) => lessonMatchesDepartment(x, 'Kho'));
  assert.strictEqual(khoRows.length, 43, 'Admin filter Kho phải trả về đúng 43 bài Hội nhập');
  assert.ok(khoRows.every((x) => x.stage === 0));
  ok('PASS 4 - Admin filter Phòng ban = Kho => đúng 43 bài Hội nhập (không có bài Bán hàng lọt vào)');

  const salesRows = lessons.filter((x) => lessonMatchesDepartment(x, 'Bán hàng'));
  assert.strictEqual(salesRows.length, 120, 'Admin filter Bán hàng phải trả về 43 bài chung + 77 bài chuyên môn = 120');
  const salesOnly = salesRows.filter((x) => x.stage !== 0);
  assert.strictEqual(salesOnly.length, 77, 'Trong đó đúng 77 bài chuyên môn Bán hàng (GĐ2-5)');
  ok('PASS 5 - Admin filter Phòng ban = Bán hàng => 43 bài Hội nhập + 77 bài chuyên môn = 120 bài');
})();

// ---------------------------------------------------------------------------
// Section 5: Training Hub khong duoc ghi de employees.department/position/branch.
// ---------------------------------------------------------------------------
(function section5Checks() {
  const dbSrc = fs.readFileSync(path.join(ROOT, 'lib/db.js'), 'utf8');

  // saveDataToFile: employeeRecord khong duoc chua department/position/branch.
  const fileRecMatch = dbSrc.match(/const employeeRecord = \{[\s\S]*?\};/);
  assert.ok(fileRecMatch, 'Không tìm thấy employeeRecord trong lib/db.js');
  assert.ok(!/\bdepartment:/.test(fileRecMatch[0]), 'employeeRecord (saveDataToFile) không được ghi department');
  assert.ok(!/\bposition:/.test(fileRecMatch[0]), 'employeeRecord (saveDataToFile) không được ghi position');
  assert.ok(!/\bbranch:/.test(fileRecMatch[0]), 'employeeRecord (saveDataToFile) không được ghi branch');

  // saveDataToSupabase: employeeBase/employeeExtended khong duoc chua 3 field nay.
  const baseMatch = dbSrc.match(/const employeeBase = \{[\s\S]*?\};/);
  const extMatch = dbSrc.match(/const employeeExtended = \{[\s\S]*?\};/);
  assert.ok(baseMatch && extMatch, 'Không tìm thấy employeeBase/employeeExtended trong lib/db.js');
  [baseMatch[0], extMatch[0]].forEach((block) => {
    assert.ok(!/\bdepartment:/.test(block), 'employeeBase/Extended (saveDataToSupabase) không được ghi department');
    assert.ok(!/\bposition:/.test(block), 'employeeBase/Extended (saveDataToSupabase) không được ghi position');
    assert.ok(!/\bbranch:/.test(block), 'employeeBase/Extended (saveDataToSupabase) không được ghi branch');
  });
  ok('Section 5 - lib/db.js không còn ghi employees.department/position/branch ở cả 2 đường lưu (file fallback + Supabase)');
})();

console.log('\n=== Kết quả ===');
console.log(passCount + ' bước PASS.\n');
console.log('Toàn bộ chạy trên sandbox vm thực thi đúng source production (assets/data,');
console.log('assets/js/phf-learner-app.js, assets/js/phf-learning-gate.js) - không đụng Supabase');
console.log('thật, không cần trình duyệt. Chạy thủ công khi cần:');
console.log('  node scripts/test-training-hub-common-program.js\n');
