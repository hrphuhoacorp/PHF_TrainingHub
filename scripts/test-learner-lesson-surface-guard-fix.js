'use strict';
/* Regression: fix phfLearnerLessonSurfaceIsActive() bo sung nhanh prefix-match
   cho URL co slug (/hv/bai-hoc/<slug>), khac phuc bug "Xac nhan thong tin xong
   khong vao Buoc 1" khi phfConfirmInfoAndContinue() dieu huong qua window.phfGo
   (bi URL Router doi pathname sang dang co slug TRUOC khi go()/render() chay).
   Chay that production source (khong viet lai logic rieng, khong dung browser
   / Supabase that) bang vm sandbox, giong pattern cua
   scripts/test-training-hub-common-program.js. */

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
  sandbox.setTimeout = (fn) => { try { fn(); } catch (e) {} return 0; }; // chay dong bo de test khong can cho that
  sandbox.setInterval = () => 0;
  sandbox.clearTimeout = () => {};
  sandbox.clearInterval = () => {};
  sandbox.CustomEvent = class { constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; } };
  sandbox.fetch = () => Promise.reject(new Error('fetch not stubbed for this test'));

  // Cac id form/DOM production co dung that trong flow duoc test - stub gia tri
  // hop le de phfValidateInfoForm() pass; moi id khac tra ve null giong DOM that
  // (khong de fakeEl mac dinh lam gia False-positive cho cac khoi optional nhu
  // BMTT paper / phone-form khac).
  const knownElements = {
    fullName: fakeEl({ value: 'Nguyen Van A' }),
    phone: fakeEl({ value: '0901234567' }),
    position: fakeEl({ value: 'Nhân viên bán hàng' }),
    department: fakeEl({ value: 'Bán hàng' }),
    branch: fakeEl({ value: 'CN01' }),
    studyStartDate: fakeEl({ value: '2026-09-01' }),
    dob: fakeEl({ value: '1999-01-01' }),
    mainLesson: fakeEl(),
    miniStatus: fakeEl(),
    contextTitle: fakeEl(),
    contextSub: fakeEl(),
    contextAction: fakeEl(),
    phaseStrip: fakeEl(),
    todoSub: fakeEl(),
    todoList: fakeEl()
  };
  // Cac id lien quan BMTT/chu ky rieng phai tra ve null that su (khong duoc
  // fakeEl mac dinh lam gia false-positive cho cac nhanh logic optional).
  const nullElements = { phfBmtPaper: true };
  sandbox.document = {
    getElementById(id) {
      if (knownElements[id]) return knownElements[id];
      if (nullElements[id]) return null;
      // Moi id UI shell khac (progress bar, right rail, v.v.) khong thuoc pham
      // vi test - tra ve fakeEl chung de render() khong crash vi DOM gia lap
      // thieu, khong anh huong logic dang duoc kiem chung (guard slug/path).
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
  // Cac ham UI/shell ngoai pham vi file dang test (dinh nghia trong app.js/
  // shell chinh, khong load o day) - stub no-op de render() khong crash vi
  // thieu DOM/shell that; khong lien quan logic dang duoc kiem chung.
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

function lessonSlug(item, idx) {
  const base = String((item && (item.id || item.lessonId || item.slug || item.key)) || '').trim();
  const raw = base || ('new-sales-gd' + (Number(item && item.stage || 0) + 1) + '-bai-' + String(Number(idx) + 1).padStart(2, '0'));
  return raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

let passCount = 0;
function ok(label) { passCount++; console.log('  ✓ PASS - ' + label); }

console.log('\n=== Regression: fix phfLearnerLessonSurfaceIsActive() - deep-link slug URL ===');
console.log('(chay that source production trong sandbox vm, khong dung Supabase/browser that)\n');

// ---------------------------------------------------------------------------
// TEST 1: unit-check bo lai dung ham san xuat cho tung dang path.
// ---------------------------------------------------------------------------
(function test1_pathVariants() {
  const sandbox = buildSandbox();
  const w = sandbox.window;
  const lessons = w.PHF_LESSONS;
  const slugIdx1 = lessonSlug(lessons[1], 1);

  sandbox.location.pathname = '/hv/bai-hoc';
  assert.strictEqual(w.phfLearnerLessonSurfaceIsActive(), true, 'Path tran /hv/bai-hoc phai van la true (khong duoc regressions)');

  sandbox.location.pathname = '/hv/bai-hoc/' + slugIdx1;
  assert.strictEqual(w.phfLearnerLessonSurfaceIsActive(), true, 'Path co slug /hv/bai-hoc/<slug> phai duoc coi la dang o be mat hoc (day la fix chinh)');

  sandbox.location.pathname = '/hv/checklist';
  assert.strictEqual(w.phfLearnerLessonSurfaceIsActive(), false, 'Route khac (vd /hv/checklist) khong duoc coi la dang o be mat hoc');

  sandbox.location.pathname = '/hv/bai-hoc-khac';
  assert.strictEqual(w.phfLearnerLessonSurfaceIsActive(), false, 'Route gan giong nhung khac hoan toan (vd /hv/bai-hoc-khac) khong duoc khop nham');

  ok('TEST 1 - phfLearnerLessonSurfaceIsActive() dung cho ca 4 dang path (bare / slug / route khac / route gan giong)');
})();

// ---------------------------------------------------------------------------
// Helper: dung profile hoc vien Ban hang, GD1 (departments:["all"]) nen khong
// bi chan boi departmentLessonBoundary; tap trung dung vao guard slug/path.
// ---------------------------------------------------------------------------
function setupLearner(sandbox, opts) {
  const w = sandbox.window;
  const employeeId = (opts && opts.employeeId) || 'E-CONFIRM-TEST';
  const progress = (opts && opts.progress) || {};
  w.phfGetAuthenticatedUser = () => ({ employeeId: employeeId, hubAssignmentStatus: 'active' });
  w.phfGetCurrentUser = () => ({ employeeId: employeeId, hubAssignmentStatus: 'active' });
  w.phfUserRole = () => 'learner';
  w.phfNotice = function () {}; // khong lien quan pham vi fix - chi tranh crash do UI toast stub thieu DOM that
  w.phfToast = function () {};
  w.__phfLocalData = {
    employees: [{ id: employeeId, department: 'Bán hàng', phone: '0901234567' }],
    progress: progress,
    activityLog: [], testResults: []
  };
  sandbox.localStorage.setItem('phfEmployeeId', employeeId);
  sandbox.localStorage.setItem('phfEmployeeProfile', JSON.stringify({ id: employeeId, phone: '0901234567', fullName: 'Nguyen Van A' }));
  return employeeId;
}

// ---------------------------------------------------------------------------
// TEST 2: deep-link /hv/bai-hoc/<slug> (mo phong URL Router da doi pathname
// TRUOC khi go() chay, dung nhu that trong bug that) -> xac nhan thong tin ->
// PHAI vao Buoc 1 (index 2). Day la kich ban dung goc cua bug.
// ---------------------------------------------------------------------------
async function test2_confirmInfoDeepLink() {
  const sandbox = buildSandbox();
  const w = sandbox.window;
  const lessons = w.PHF_LESSONS;
  const employeeId = setupLearner(sandbox, { progress: {} });

  // Nguoi dung dang o man thong tin (index 1) qua deep-link co slug - dung
  // dung ham san xuat go() (khong tu viet current=1) de dat trang thai ban dau.
  sandbox.location.pathname = '/hv/bai-hoc';
  assert.strictEqual(w.go(1), undefined, 'go(1) tu index 0 (GD1, chua co gi hoan thanh) phai duoc phep vi la buoc ke tiep hop le');
  assert.strictEqual(w.phfCurrentLessonIndex, 1, 'Sau go(1), phai dang o index 1 (man thong tin)');

  // Router da doi URL sang dang co slug cua CHINH man dang xem (mo phong dung
  // trang thai thuc te khi vao bang deep-link / PWA khoi phuc URL cu).
  sandbox.location.pathname = '/hv/bai-hoc/' + lessonSlug(lessons[1], 1);

  // Stub fetch: gia lap Supabase DEV luu thanh cong va tra lai progress moi.
  let saveCallCount = 0;
  sandbox.fetch = (url, opts) => {
    assert.strictEqual(url, '/api/data');
    const body = JSON.parse(opts.body);
    assert.strictEqual(body.type, 'profile-confirmed');
    saveCallCount++;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        data: {
          employees: [{ id: employeeId, department: 'Bán hàng', phone: '0901234567' }],
          progress: {
            [employeeId]: {
              currentPage: 'lesson:2',
              unlockedSteps: [],
              completedPages: Array.from(new Set(['lesson:0', 'lesson:1', ...(body.completedPages || [])])),
              lastUpdatedAt: new Date().toISOString()
            }
          },
          activityLog: [], testResults: []
        },
        receipt: { progressSaved: true }
      })
    });
  };

  const result = await w.phfConfirmInfoAndContinue();

  assert.strictEqual(result, true, 'phfConfirmInfoAndContinue() phai tra ve true (luu thanh cong)');
  assert.strictEqual(saveCallCount, 1, 'Chi duoc goi POST /api/data dung 1 lan cho 1 lan bam xac nhan (khong duplicate request)');
  assert.strictEqual(w.phfCurrentLessonIndex, 2, 'SAU FIX: dieu huong phai thuc su chuyen sang index 2 (Buoc 1) du URL da co slug truoc khi go() chay - day la trong tam cua fix');
  assert.strictEqual(w.phfCurrentLessonKey, 'lesson:2', 'phfCurrentLessonKey phai dong bo voi index moi');

  ok('TEST 2 - Deep-link co slug + xac nhan thong tin: dieu huong thanh cong vao Buoc 1 (index 2), dung 1 lan goi luu, khong con bi "nuot" lang le nhu bug cu');
}

// ---------------------------------------------------------------------------
// TEST 3: /hv/bai-hoc tran (khong slug) van hoat dong binh thuong - khong
// duoc regressions boi fix.
// ---------------------------------------------------------------------------
function test3_barePathStillWorks() {
  const sandbox = buildSandbox();
  const w = sandbox.window;
  setupLearner(sandbox, { progress: {} });
  sandbox.location.pathname = '/hv/bai-hoc';

  w.go(1);
  assert.strictEqual(w.phfCurrentLessonIndex, 1, 'Path tran /hv/bai-hoc: go(1) phai hoat dong nhu truoc (khong regressions)');

  ok('TEST 3 - /hv/bai-hoc tran (khong slug) van dieu huong binh thuong sau fix');
}

// ---------------------------------------------------------------------------
// TEST 4: Tiep tuc / Quay lai giua cac bai hoc khac (index cao hon, khong lien
// quan man xac nhan thong tin) van hoat dong dung tren URL co slug.
// ---------------------------------------------------------------------------
function test4_continueBackOtherLessons() {
  const sandbox = buildSandbox();
  const w = sandbox.window;
  // GD1 (index 0..42) deu departments:["all"] - da hoan thanh lien tuc 0..2 de
  // duoc phep tiep tuc sang 3, roi quay lai 2.
  setupLearner(sandbox, {
    progress: {
      'E-CONFIRM-TEST': {
        currentPage: 'lesson:2',
        completedPages: ['lesson:0', 'lesson:1', 'lesson:2'],
        unlockedSteps: [],
        lastUpdatedAt: new Date().toISOString()
      }
    }
  });
  const lessons = w.PHF_LESSONS;
  sandbox.location.pathname = '/hv/bai-hoc/' + lessonSlug(lessons[2], 2);

  w.go(3); // "Tiep tuc" sang bai ke tiep, tren URL dang co slug cua bai 2.
  assert.strictEqual(w.phfCurrentLessonIndex, 3, 'Tren URL co slug: "Tiep tuc" (go sang index+1) phai hoat dong dung');

  sandbox.location.pathname = '/hv/bai-hoc/' + lessonSlug(lessons[3], 3);
  w.go(2); // "Quay lai" bai truoc.
  assert.strictEqual(w.phfCurrentLessonIndex, 2, 'Tren URL co slug: "Quay lai" (go sang index-1, xem lai bai da qua) phai hoat dong dung');

  ok('TEST 4 - "Tiep tuc" va "Quay lai" giua cac bai hoc khac van hoat dong dung tren URL co slug');
}

// ---------------------------------------------------------------------------
// TEST 5: Refresh (F5) ngay tai URL co slug (khong qua buoc go() nao truoc do
// trong phien nay - mo phong load lai trang) van duoc coi la dang o be mat
// hoc va cho phep dieu huong tiep.
// ---------------------------------------------------------------------------
function test5_refreshAtSlugUrl() {
  const sandbox = buildSandbox();
  const w = sandbox.window;
  setupLearner(sandbox, {
    progress: {
      'E-CONFIRM-TEST': {
        currentPage: 'lesson:1',
        completedPages: ['lesson:0'],
        unlockedSteps: [],
        lastUpdatedAt: new Date().toISOString()
      }
    }
  });
  const lessons = w.PHF_LESSONS;
  // "Refresh": sandbox moi hoan toan, location.pathname da la dang co slug
  // NGAY TU DAU (mo phong F5 tai URL nay), chua co go() nao chay truoc do.
  sandbox.location.pathname = '/hv/bai-hoc/' + lessonSlug(lessons[1], 1);

  assert.strictEqual(w.phfLearnerLessonSurfaceIsActive(), true, 'Refresh tai URL co slug: guard phai nhan dung la dang o be mat hoc');
  w.go(1);
  assert.strictEqual(w.phfCurrentLessonIndex, 1, 'Refresh tai URL co slug: go() van render/dieu huong dung, khong bi nuot lang le');

  ok('TEST 5 - Refresh (F5) tai URL co slug van render dung, khong bi ket vi guard qua chat');
}

// ---------------------------------------------------------------------------
// TEST 6: Khong tao duplicate trong completedPages khi luu progress nhieu lan
// (markCompleted goi lai nhieu lan cho cung 1 lesson, vd do setTimeout hau-
// dieu-huong trong guardedGo). Dung dung ham san xuat getLocalCompletedSet/
// markCompleted qua export phfB16LearningGate.quizRuntime.
// ---------------------------------------------------------------------------
function test6_noDuplicateProgress() {
  const sandbox = buildSandbox();
  const w = sandbox.window;
  setupLearner(sandbox, { progress: {} });
  const gate = w.phfB16LearningGate;
  gate.markCompleted(1);
  gate.markCompleted(1); // goi lai lan 2 - mo phong duplicate call.
  gate.markCompleted(1); // goi lai lan 3.

  const set = gate.quizRuntime.getLocalCompletedSet();
  const count = Array.from(set).filter(function (x) { return x === 'lesson:1'; }).length;
  assert.strictEqual(count, 1, 'markCompleted() goi lap lai nhieu lan cho cung 1 lesson khong duoc tao duplicate trong tap completedPages');

  const raw = JSON.parse(sandbox.localStorage.getItem('phfGateCompletedPagesByEmployee') || '{}');
  const arr = raw[Object.keys(raw)[0]] || [];
  const dupCount = arr.filter(function (x) { return x === 'lesson:1'; }).length;
  assert.strictEqual(dupCount, 1, 'Du lieu luu cuc bo (phfGateCompletedPagesByEmployee) cung khong duoc co ban ghi lesson:1 lap lai');

  ok('TEST 6 - markCompleted() goi lap lai nhieu lan khong tao duplicate trong completedPages (ca in-memory Set va local storage)');
}

(async function main() {
  await test2_confirmInfoDeepLink();
  test3_barePathStillWorks();
  test4_continueBackOtherLessons();
  test5_refreshAtSlugUrl();
  test6_noDuplicateProgress();
  console.log('\n=== KET QUA: ' + passCount + '/6 nhom test PASS ===\n');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
