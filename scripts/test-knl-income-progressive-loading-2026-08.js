'use strict';
/* KNL-09B — Income Profile Performance/Loading Closure.
 * Patch1: loại bỏ blank flash (loading -> blank -> loading).
 * Patch2: capabilities + income (+ profile) bắt đầu song song thay vì
 * waterfall tuần tự, không bypass permission.
 * Patch3: progressive render — header/section cập nhật độc lập ngay khi
 * từng request resolve, không đợi cả 5 API xong mới paint 1 lần.
 * Standalone regression, injects a window export line into an in-memory
 * copy of assets/js/knl/phf-knl-app.js (does not modify the file on disk),
 * same convention as the other KNL-09/KNL-08 test files. */
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const rawCode = fs.readFileSync('assets/js/knl/phf-knl-app.js', 'utf8');
const css = fs.readFileSync('assets/css/phf-knl.css', 'utf8');
const EXPORT_MARKER = /\}\)\(\);\s*$/;
if (!EXPORT_MARKER.test(rawCode)) throw new Error('Expected file to end with "})();" — update injection marker.');
const code = rawCode.replace(EXPORT_MARKER,
  'window.__foundationState=foundationState;' +
  '\n})();');

function tick(n) { n = n || 1; return new Promise(async resolve => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 3)); resolve(); }); }

function makeDom(path) {
  const dom = new JSDOM('<!doctype html><html><head><style>' + css + '</style></head><body><div id="phfKnlRoot"></div></body></html>', { url: 'http://localhost' + path, runScripts: 'outside-only' });
  const { window } = dom;
  window.phfGetSessionRole = () => 'admin';
  window.phfGetCurrentUser = () => ({ id: 'admin-1', employeeCode: 'PHF000', name: 'Admin' });
  window.phfNavigate = () => {};
  window.scrollTo = () => {};
  window.requestAnimationFrame = fn => setTimeout(fn, 0);
  return dom;
}

function defaultResponses(employeeCode, name) {
  return {
    getKnlCapabilities: { delay: 5, body: { ok: true, isAdmin: true, capabilities: { access_knl: true, income_view: true }, presetCode: 'admin', peopleScope: {} } },
    getKnlEmployeeIncome: { delay: 15, body: { ok: true, employeeCode: employeeCode, current: { employeeCode: employeeCode, employeeName: name, employmentType: 'OFFICIAL', ladderCode: 'A', gradeCode: 'B2', versionNumber: 1, payrollPeriod: '2026-08', baseSalary: 10000000, hqcv: 1000000, totalReferenceIncome: 11000000, extraAllowances: [] }, history: [] } },
    getKnlEmployeeProfile: { delay: 5, body: { ok: true, profile: { employeeCode: employeeCode, fullName: name, title: 'NV', employmentStatus: 'ACTIVE' } } },
    getKnlEmployeeNextCompensationGrade: { delay: 15, body: { ok: true, hasCurrentGrade: false } },
    getKnlEmployeeCompetencyStandard: { delay: 15, body: { ok: true, hasAssignment: false } },
    listKnlEmployeeCompetencyHistory: { delay: 15, body: { ok: true, periods: [] } }
  };
}

function installFetch(window, responses, log) {
  window.fetch = async (url, opts) => {
    const action = JSON.parse(opts.body).action;
    if (log) log.push({ action: action, at: Date.now() });
    const resp = responses[action];
    if (!resp) throw new Error('unexpected action ' + action);
    await new Promise(r => setTimeout(r, resp.delay || 5));
    if (resp.reject) { const e = new Error(resp.message || 'fail'); e.code = resp.code; throw e; }
    return { ok: true, json: async () => resp.body };
  };
}

/* Deterministic control: mỗi action chỉ resolve/reject khi test chủ động
 * gọi resolvers[action](result)/rejecters[action](err) — không phụ thuộc
 * setTimeout/độ trễ tương đối (đã thấy jitter thật trong môi trường sandbox
 * làm sai lệch thứ tự resolve theo delay cấu hình), tránh flaky test. */
function installControlledFetch(window, log) {
  const resolvers = {}, rejecters = {}, callCount = {};
  window.fetch = (url, opts) => {
    const action = JSON.parse(opts.body).action;
    callCount[action] = (callCount[action] || 0) + 1;
    if (log) log.push({ action: action, at: Date.now() });
    return new Promise((resolve, reject) => {
      resolvers[action] = (body) => resolve({ ok: true, json: async () => body });
      rejecters[action] = (message, code) => { const e = new Error(message); e.code = code; reject(e); };
    });
  };
  return { resolvers: resolvers, rejecters: rejecters, callCount: callCount };
}

function navPath(employeeCode) {
  return '/admin/knl/co-cau-thu-nhap' + (employeeCode ? '?employee_code=' + employeeCode : '');
}
async function goIncome(window, employeeCode) {
  const path = navPath(employeeCode);
  window.history.pushState({}, '', path);
  return window.phfRenderKnl(path.split('?')[0]);
}

(async () => {
  // ---------- 1) No blank flash: shell/body innerHTML never goes empty between two loading states ----------
  {
    const dom = makeDom('/admin/knl/dashboard');
    const { window } = dom;
    const responses = defaultResponses('PHF001', 'Nguyen Van A');
    installFetch(window, responses);
    window.eval(code);
    const root = window.document.getElementById('phfKnlRoot');

    // first nav: mounts the shell (cold start)
    await window.phfRenderKnl('/admin/knl/dashboard');
    await tick(5);

    // second nav: switch into income route — this is the path that used to blank-flash
    const writes = [];
    const p2 = goIncome(window, 'PHF001');
    // sample body.innerHTML repeatedly while the load is in flight
    for (let i = 0; i < 8; i++) {
      const body = root.querySelector('[data-knl-body]');
      writes.push(body ? body.innerHTML : '<<no shell>>');
      await tick(1);
    }
    await p2;
    const blankHits = writes.filter(w => w.trim() === '' || w === '<<no shell>>').length;
    assert.strictEqual(blankHits, 0, 'body.innerHTML không được rỗng/mất shell ở bất kỳ thời điểm nào khi mở income route (Patch 1): ' + JSON.stringify(writes.map(w => w.length)));
    console.log('PASS Patch1 — không còn loading → blank → loading khi mở income route');
  }

  // ---------- 2) capabilities + income bắt đầu song song ----------
  {
    const dom = makeDom('/admin/knl/co-cau-thu-nhap?employee_code=PHF001');
    const { window } = dom;
    const responses = defaultResponses('PHF001', 'Nguyen Van A');
    const log = [];
    installFetch(window, responses, log);
    window.eval(code);
    const root = window.document.getElementById('phfKnlRoot');
    await goIncome(window, 'PHF001');

    const capAt = log.find(e => e.action === 'getKnlCapabilities').at;
    const incomeAt = log.find(e => e.action === 'getKnlEmployeeIncome').at;
    const spread = Math.abs(incomeAt - capAt);
    assert(spread < 10, 'getKnlCapabilities và getKnlEmployeeIncome phải bắt đầu gần như cùng lúc (Patch 2), spread=' + spread + 'ms');
    console.log('PASS Patch2 — capabilities + income khởi chạy song song (spread=' + spread + 'ms)');
  }

  // ---------- 3) permission denied (capabilities reject) không leak income đã fetch ----------
  {
    const dom = makeDom('/admin/knl/co-cau-thu-nhap?employee_code=PHF001');
    const { window } = dom;
    const responses = defaultResponses('PHF001', 'Nguyen Van A');
    const ctrl = installControlledFetch(window);
    window.eval(code);
    const root = window.document.getElementById('phfKnlRoot');
    const p = goIncome(window, 'PHF001');
    await tick(1);
    // income resolves FIRST with real data, THEN capabilities rejects — must never leak.
    ctrl.resolvers.getKnlEmployeeIncome(responses.getKnlEmployeeIncome.body);
    await tick(1);
    ctrl.rejecters.getKnlCapabilities('KNL_ACCESS_DENIED', 'KNL_ACCESS_DENIED');
    await p;

    assert.strictEqual(window.__foundationState.income, null, 'capabilities deny -> income đã fetch (dù resolve trước) KHÔNG được ghi vào foundationState');
    const body = root.querySelector('[data-knl-body]') || root;
    assert(body.innerHTML.includes('KNL_ACCESS_DENIED') || root.innerHTML.includes('KNL_ACCESS_DENIED'), 'Phải hiện access-denied, không hiện dữ liệu income');
    console.log('PASS Patch2 — capabilities deny không leak dữ liệu income đã fetch song song (kể cả khi income resolve trước)');
  }

  // ---------- 4) header/content đầu tiên render trước khi tất cả API hoàn tất ----------
  {
    const dom = makeDom('/admin/knl/co-cau-thu-nhap?employee_code=PHF001');
    const { window } = dom;
    const responses = defaultResponses('PHF001', 'Nguyen Van A');
    installFetch(window, responses);
    window.eval(code);
    const root = window.document.getElementById('phfKnlRoot');
    await window.phfRenderKnl('/admin/knl/dashboard'); // warm the shell first (đúng kịch bản thật: đã ở trong KNL, bấm sang income)
    await tick(5);
    const ctrl = installControlledFetch(window); // switch to manual control for the income nav itself
    const p = goIncome(window, 'PHF001');
    await tick(1); // no response resolved yet at all
    const body = root.querySelector('[data-knl-body]');
    assert(body && body.innerHTML.length > 0, 'Phải có nội dung (skeleton) hiện ngay, không chờ API');
    assert(body.innerHTML.includes('Đang tải'), 'Skeleton phải có loading state rõ ràng cho các phần chưa có dữ liệu');
    ctrl.resolvers.getKnlCapabilities(responses.getKnlCapabilities.body);
    ctrl.resolvers.getKnlEmployeeProfile(responses.getKnlEmployeeProfile.body);
    ctrl.resolvers.getKnlEmployeeIncome(responses.getKnlEmployeeIncome.body); // income gates nextGrade/competency/history — they only fire after this
    await tick(1);
    ctrl.resolvers.getKnlEmployeeNextCompensationGrade(responses.getKnlEmployeeNextCompensationGrade.body);
    ctrl.resolvers.getKnlEmployeeCompetencyStandard(responses.getKnlEmployeeCompetencyStandard.body);
    ctrl.resolvers.listKnlEmployeeCompetencyHistory(responses.listKnlEmployeeCompetencyHistory.body);
    await p;
    console.log('PASS Patch3 — header/skeleton render trước khi API hoàn tất');
  }

  // ---------- 5) profile resolve trước → header update ngay, không chờ income ----------
  {
    const dom = makeDom('/admin/knl/co-cau-thu-nhap?employee_code=PHF001');
    const { window } = dom;
    const responses = defaultResponses('PHF001', 'Nguyen Thi Profile');
    const ctrl = installControlledFetch(window);
    window.eval(code);
    const root = window.document.getElementById('phfKnlRoot');
    const p = goIncome(window, 'PHF001');
    await tick(1);
    ctrl.resolvers.getKnlCapabilities(responses.getKnlCapabilities.body);
    await tick(1);
    ctrl.resolvers.getKnlEmployeeProfile(responses.getKnlEmployeeProfile.body); // profile resolves, income still pending
    await tick(1);
    const body = root.querySelector('[data-knl-body]');
    assert(body.innerHTML.includes('Nguyen Thi Profile'), 'Header phải hiện tên từ profile ngay khi profile resolve, không chờ income');
    assert(body.innerHTML.includes('Đang tải dữ liệu thu nhập'), 'Phần income vẫn phải còn ở trạng thái loading lúc này');
    // finish the rest so the outer promise resolves cleanly
    ctrl.resolvers.getKnlEmployeeIncome(responses.getKnlEmployeeIncome.body);
    await tick(1);
    ctrl.resolvers.getKnlEmployeeNextCompensationGrade(responses.getKnlEmployeeNextCompensationGrade.body);
    ctrl.resolvers.getKnlEmployeeCompetencyStandard(responses.getKnlEmployeeCompetencyStandard.body);
    ctrl.resolvers.listKnlEmployeeCompetencyHistory(responses.listKnlEmployeeCompetencyHistory.body);
    await p;
    console.log('PASS Patch3 — profile resolve trước → header cập nhật ngay, không chờ income');
  }

  // ---------- 6) income resolve trước → income section update ngay ----------
  {
    const dom = makeDom('/admin/knl/co-cau-thu-nhap?employee_code=PHF001');
    const { window } = dom;
    const responses = defaultResponses('PHF001', 'Nguyen Van A');
    const ctrl = installControlledFetch(window);
    window.eval(code);
    const root = window.document.getElementById('phfKnlRoot');
    const p = goIncome(window, 'PHF001');
    await tick(1);
    ctrl.resolvers.getKnlCapabilities(responses.getKnlCapabilities.body);
    await tick(1);
    ctrl.resolvers.getKnlEmployeeIncome(responses.getKnlEmployeeIncome.body); // income resolves, profile/nextGrade/competency/history still pending
    await tick(1);
    const body = root.querySelector('[data-knl-body]');
    assert(/11[.,]000[.,]000/.test(body.innerHTML), 'Phần cơ cấu thu nhập phải render ngay khi income resolve, không chờ profile/nextGrade/competency/history');
    ctrl.resolvers.getKnlEmployeeProfile(responses.getKnlEmployeeProfile.body);
    ctrl.resolvers.getKnlEmployeeNextCompensationGrade(responses.getKnlEmployeeNextCompensationGrade.body);
    ctrl.resolvers.getKnlEmployeeCompetencyStandard(responses.getKnlEmployeeCompetencyStandard.body);
    ctrl.resolvers.listKnlEmployeeCompetencyHistory(responses.listKnlEmployeeCompetencyHistory.body);
    await p;
    console.log('PASS Patch3 — income resolve trước → income section cập nhật ngay');
  }

  // ---------- 7) một sub-call fail → section khác vẫn render (không xóa cả hồ sơ) ----------
  {
    const dom = makeDom('/admin/knl/co-cau-thu-nhap?employee_code=PHF001');
    const { window } = dom;
    const responses = defaultResponses('PHF001', 'Nguyen Van A');
    responses.getKnlEmployeeCompetencyStandard = { delay: 5, reject: true, message: 'competency service down' };
    installFetch(window, responses);
    window.eval(code);
    const root = window.document.getElementById('phfKnlRoot');
    await goIncome(window, 'PHF001');
    await tick(10);
    const body = root.querySelector('[data-knl-body]');
    assert(!body.innerHTML.includes('competency service down'), 'Lỗi kỹ thuật không được leak ra UI');
    assert(window.__foundationState.income && window.__foundationState.income.current, 'income vẫn có dữ liệu dù competency lỗi');
    assert.strictEqual(window.__foundationState.competency, null, 'competency lỗi -> null (section riêng xử lý gracefully), không throw/crash');
    assert(body.innerHTML.length > 200, 'Phần còn lại của hồ sơ (income/nextGrade/history/header) vẫn phải render đầy đủ, không bị xóa trắng');
    console.log('PASS Patch3 — 1 sub-request fail (competency) không xóa cả hồ sơ, phần khác vẫn dùng được');
  }

  // ---------- 8) rapid employee switch: response cũ không update BẤT KỲ section nào ----------
  {
    const dom = makeDom('/admin/knl/co-cau-thu-nhap?employee_code=PHF001');
    const { window } = dom;
    window.eval(code);
    const root = window.document.getElementById('phfKnlRoot');

    let oldResolvers = {};
    window.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body), action = body.action;
      // getKnlCapabilities is shared/cached across navigations (fix#1, by
      // design) — hanging it forever would wedge BOTH navs on the same
      // pending promise (not a real scenario: capabilities always resolves
      // eventually in production). Resolve it normally every time here;
      // only the per-employee calls (keyed by employeeCode payload, so
      // PHF001 vs PHF002 never collide) simulate a slow/still-in-flight
      // request from before the switch.
      if (action === 'getKnlCapabilities') {
        await new Promise(r => setTimeout(r, 5));
        return { ok: true, json: async () => defaultResponses('PHF001', 'x').getKnlCapabilities.body };
      }
      if (body.employeeCode === 'PHF001') {
        return new Promise(resolve => { oldResolvers[action] = () => resolve({ ok: true, json: async () => oldBody(action) }); });
      }
      // PHF002 (the new, active navigation): resolves fast and completely first.
      await new Promise(r => setTimeout(r, 5));
      return { ok: true, json: async () => newBody(action) };
    };
    function oldBody(action) {
      const r = defaultResponses('PHF001', 'OLD Employee')[action];
      return r.body;
    }
    function newBody(action) {
      const r = defaultResponses('PHF002', 'NEW Employee')[action];
      return r.body;
    }

    const p1 = goIncome(window, 'PHF001'); // income/profile hang, gated nextGrade/competency/history never fire
    await tick(3);
    const p2 = goIncome(window, 'PHF002'); // fresh nav, everything resolves fast
    await p2;

    assert.strictEqual(window.__foundationState.income.employeeCode, 'PHF002', 'income phải là của PHF002 (lượt mới)');
    assert.strictEqual(window.__foundationState.profile.employeeCode, 'PHF002', 'profile phải là của PHF002');
    const body = root.querySelector('[data-knl-body]');
    assert(body.innerHTML.includes('NEW Employee'), 'DOM phải hiện dữ liệu PHF002');

    // now let ALL of PHF001's hung requests finally resolve, one by one
    Object.keys(oldResolvers).forEach(k => { if (k !== '__started') oldResolvers[k](); });
    await p1;
    await tick(3);

    assert.strictEqual(window.__foundationState.income.employeeCode, 'PHF002', 'Response chậm của PHF001 KHÔNG được ghi đè income của PHF002');
    assert.strictEqual(window.__foundationState.profile.employeeCode, 'PHF002', 'Response chậm của PHF001 KHÔNG được ghi đè profile của PHF002');
    const bodyAfter = root.querySelector('[data-knl-body]');
    assert(!bodyAfter.innerHTML.includes('OLD Employee'), 'DOM không được chứa dữ liệu PHF001 sau khi response chậm về');
    console.log('PASS — rapid employee switch: response cũ (mọi section) không update bất kỳ phần nào sau khi đã chuyển sang nhân sự mới');
  }

  // ---------- 9) không duplicate API / request count không tăng ----------
  {
    const dom = makeDom('/admin/knl/co-cau-thu-nhap?employee_code=PHF001');
    const { window } = dom;
    const responses = defaultResponses('PHF001', 'Nguyen Van A');
    const log = [];
    installFetch(window, responses, log);
    window.eval(code);
    const root = window.document.getElementById('phfKnlRoot');
    await goIncome(window, 'PHF001');

    const counts = {};
    log.forEach(e => { counts[e.action] = (counts[e.action] || 0) + 1; });
    const expected = ['getKnlCapabilities', 'getKnlEmployeeIncome', 'getKnlEmployeeProfile', 'getKnlEmployeeNextCompensationGrade', 'getKnlEmployeeCompetencyStandard', 'listKnlEmployeeCompetencyHistory'];
    expected.forEach(a => assert.strictEqual(counts[a], 1, a + ' phải gọi đúng 1 lần, thực tế: ' + (counts[a] || 0)));
    assert.strictEqual(log.length, 6, 'Tổng request phải đúng 6 (không tăng so với thiết kế cũ: 1 capabilities + 5 income-flow)');
    console.log('PASS — không duplicate API, đúng 6 request tổng (không tăng)');
  }

  console.log('KNL-09B Income Profile Performance/Loading Closure: ALL PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
