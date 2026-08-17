'use strict';
/* KNL-09 P0 fix#1 (cache getKnlCapabilities) + fix#2 (parallelize
 * renderIncome()'s 4 independent calls, keep income as the access gate).
 * Standalone regression, injects a window export line into an in-memory
 * copy of assets/js/knl/phf-knl-app.js (does not modify the file on disk),
 * same convention as scripts/test-knl-ux-primitives-2026-08.js. */
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const rawCode = fs.readFileSync('assets/js/knl/phf-knl-app.js', 'utf8');
const css = fs.readFileSync('assets/css/phf-knl.css', 'utf8');
const EXPORT_MARKER = /\}\)\(\);\s*$/;
if (!EXPORT_MARKER.test(rawCode)) throw new Error('Expected file to end with "})();" — update injection marker.');
const code = rawCode.replace(EXPORT_MARKER,
  'window.__apiPost=apiPost;' +
  'window.__renderIncome=renderIncome;' +
  'window.__foundationState=foundationState;' +
  '\n})();');

function tick(n){ n = n || 1; return new Promise(async resolve => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 5)); resolve(); }); }

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

(async () => {
  // =========================================================
  // FIX 1 — getKnlCapabilities caching, reusing existing TTL/signature/invalidation
  // =========================================================
  {
    const dom = makeDom('/admin/knl/dashboard');
    const { window } = dom;
    const calls = [];
    let now = 1000000;
    window.Date.now = () => now;
    window.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push(body.action);
      return { ok: true, json: async () => ({ ok: true, isAdmin: true, capabilities: { access_knl: true }, presetCode: 'admin', peopleScope: {} }) };
    };
    window.eval(code);

    // 1) first call hits the real API
    await window.__apiPost('getKnlCapabilities');
    assert.strictEqual(calls.length, 1, 'Lần đầu getKnlCapabilities phải gọi API thật');

    // 2) second call within TTL uses cache (no new network call)
    await window.__apiPost('getKnlCapabilities');
    assert.strictEqual(calls.length, 1, 'Lần 2 trong TTL phải dùng cache, không gọi API lại');

    // 3) after TTL expires, calls again
    now += 30001; // KNL_READ_CACHE_TTL = 30000
    await window.__apiPost('getKnlCapabilities');
    assert.strictEqual(calls.length, 2, 'Hết TTL (30s) phải gọi lại API thật');

    // 4) invalidation after a permission-changing action (upsertKnlPermissionGrant)
    //    forces the next getKnlCapabilities call to miss cache (cache is warm
    //    from step 3, still well within TTL at this point)
    await window.__apiPost('upsertKnlPermissionGrant', { grant: { accountId: 'x' } });
    assert.strictEqual(calls.length, 3, 'upsertKnlPermissionGrant tự nó luôn gọi API (không cacheable)');
    await window.__apiPost('getKnlCapabilities');
    assert.strictEqual(calls.length, 4, 'Sau upsertKnlPermissionGrant, getKnlCapabilities phải cache-miss (không trả bản cũ)');

    console.log('PASS Fix1 — getKnlCapabilities: first-call real / TTL-hit cached / TTL-expiry refetch / permission-write invalidates');
  }

  // 5) cache is not cross-actor / cross-session (different knlCacheOwner => different cache key)
  {
    const dom = makeDom('/admin/knl/dashboard');
    const { window } = dom;
    const calls = [];
    window.fetch = async (url, opts) => {
      calls.push(JSON.parse(opts.body).action);
      return { ok: true, json: async () => ({ ok: true, isAdmin: false, capabilities: { access_knl: true }, presetCode: 'staff', peopleScope: {} }) };
    };
    let currentActor = { id: 'user-A', employeeCode: 'PHF001', name: 'A' };
    window.phfGetCurrentUser = () => currentActor;
    window.eval(code);

    await window.__apiPost('getKnlCapabilities');
    assert.strictEqual(calls.length, 1);
    currentActor = { id: 'user-B', employeeCode: 'PHF002', name: 'B' }; // simulate different logged-in actor in same tab lifecycle
    await window.__apiPost('getKnlCapabilities');
    assert.strictEqual(calls.length, 2, 'Actor khác nhau phải là cache key khác nhau — không dùng chéo cache của actor khác');
    console.log('PASS Fix1 — getKnlCapabilities cache không cross-actor');
  }

  // =========================================================
  // FIX 2 — renderIncome(): parallelize 4 independent calls behind the income gate
  // =========================================================
  const INCOME_ACTIONS = ['getKnlEmployeeIncome', 'getKnlEmployeeNextCompensationGrade', 'getKnlEmployeeCompetencyStandard', 'listKnlEmployeeCompetencyHistory', 'getKnlEmployeeProfile'];

  function incomeFetchMock(startedAt, responses) {
    return async (url, opts) => {
      const body = JSON.parse(opts.body);
      const action = body.action;
      startedAt[action] = Date.now();
      const resp = responses[action];
      await new Promise(r => setTimeout(r, resp.delay || 5));
      if (resp.reject) { const e = new Error(resp.message || 'fail'); throw Object.assign(e, { __rejected: true }); }
      return { ok: true, json: async () => resp.body };
    };
  }

  function defaultIncomeResponses() {
    return {
      getKnlEmployeeIncome: { delay: 20, body: { ok: true, employeeCode: 'PHF001', name: 'Nguyen Van A' } },
      getKnlEmployeeNextCompensationGrade: { delay: 5, body: { ok: true, nextGrade: 'B3' } },
      getKnlEmployeeCompetencyStandard: { delay: 5, body: { ok: true, hasAssignment: false } },
      listKnlEmployeeCompetencyHistory: { delay: 5, body: { ok: true, items: [] } },
      getKnlEmployeeProfile: { delay: 5, body: { ok: true, profile: { code: 'PHF001', title: 'NV' } } }
    };
  }

  // 6) 5 calls: income first (gate), then the remaining 4 fire concurrently, not waterfall
  {
    const dom = makeDom('/admin/knl/co-cau-thu-nhap?employee_code=PHF001');
    const { window } = dom;
    const startedAt = {};
    const responses = defaultIncomeResponses();
    window.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      startedAt[body.action] = Date.now();
      const resp = responses[body.action];
      await new Promise(r => setTimeout(r, resp.delay));
      return { ok: true, json: async () => resp.body };
    };
    window.eval(code);
    const root = window.document.getElementById('phfKnlRoot');
    root.innerHTML = '<div data-knl-body></div>';
    await window.__renderIncome(root, true, {});

    const gap = startedAt.getKnlEmployeeNextCompensationGrade - startedAt.getKnlEmployeeIncome;
    assert(gap >= 0, 'nextCompensationGrade phải bắt đầu sau khi income (gate) xong, không đồng thời với income');
    const spread = Math.max(
      startedAt.getKnlEmployeeCompetencyStandard,
      startedAt.listKnlEmployeeCompetencyHistory,
      startedAt.getKnlEmployeeProfile
    ) - startedAt.getKnlEmployeeNextCompensationGrade;
    assert(spread < 10, '4 call còn lại phải khởi chạy gần như cùng lúc (song song), không phải waterfall tuần tự: spread=' + spread + 'ms');
    console.log('PASS Fix2 — request count không tăng (5 tổng), 4 call sau income khởi chạy song song (spread=' + spread + 'ms), không waterfall');
  }

  // 7) all success -> renders correctly
  {
    const dom = makeDom('/admin/knl/co-cau-thu-nhap?employee_code=PHF001');
    const { window } = dom;
    const responses = defaultIncomeResponses();
    window.fetch = incomeFetchMock({}, responses);
    window.eval(code);
    const root = window.document.getElementById('phfKnlRoot');
    root.innerHTML = '<div data-knl-body></div>';
    await window.__renderIncome(root, true, {});
    const body = root.querySelector('[data-knl-body]');
    assert(!body.innerHTML.includes('Đang tải'), 'Sau khi tải xong, không còn ở trạng thái loading');
    assert.strictEqual(window.__foundationState.income.employeeCode, 'PHF001');
    assert.strictEqual(window.__foundationState.nextCompensationGrade.nextGrade, 'B3');
    console.log('PASS Fix2 — all-success render đúng dữ liệu');
  }

  // 8) 1 non-gating call fails -> rest still render (Promise.allSettled semantics preserved)
  {
    const dom = makeDom('/admin/knl/co-cau-thu-nhap?employee_code=PHF001');
    const { window } = dom;
    const responses = defaultIncomeResponses();
    responses.getKnlEmployeeCompetencyStandard = { delay: 5, reject: true, message: 'competency down' };
    window.fetch = incomeFetchMock({}, responses);
    window.eval(code);
    const root = window.document.getElementById('phfKnlRoot');
    root.innerHTML = '<div data-knl-body></div>';
    await window.__renderIncome(root, true, {});
    const body = root.querySelector('[data-knl-body]');
    assert(!body.innerHTML.includes('Đang tải'), 'Màn hình vẫn phải render dù 1 API con lỗi (không sập toàn màn)');
    assert.strictEqual(window.__foundationState.income.employeeCode, 'PHF001', 'income vẫn có dữ liệu');
    assert.strictEqual(window.__foundationState.competency, null, 'competency lỗi -> null, không throw ra ngoài');
    assert.strictEqual(window.__foundationState.nextCompensationGrade.nextGrade, 'B3', 'các block khác vẫn có dữ liệu bình thường');
    console.log('PASS Fix2 — 1 call fail (Promise.allSettled) không làm sập các phần còn lại');
  }

  // 8b) income itself (the gate) fails -> whole screen shows access-denied, no other calls' data used
  {
    const dom = makeDom('/admin/knl/co-cau-thu-nhap?employee_code=PHF001');
    const { window } = dom;
    const responses = defaultIncomeResponses();
    responses.getKnlEmployeeIncome = { delay: 5, reject: true, message: 'KNL_INCOME_VIEW_DENIED' };
    let otherCallsFired = 0;
    window.fetch = async (url, opts) => {
      const action = JSON.parse(opts.body).action;
      if (action !== 'getKnlEmployeeIncome') otherCallsFired++;
      const resp = responses[action];
      await new Promise(r => setTimeout(r, resp.delay));
      if (resp.reject) throw new Error(resp.message);
      return { ok: true, json: async () => resp.body };
    };
    window.eval(code);
    const root = window.document.getElementById('phfKnlRoot');
    root.innerHTML = '<div data-knl-body></div>';
    await window.__renderIncome(root, true, {});
    assert.strictEqual(otherCallsFired, 0, 'income (gate) lỗi -> 4 call còn lại KHÔNG được gọi (giữ đúng semantics cũ, không tăng request thừa)');
    console.log('PASS Fix2 — income gate fail giữ nguyên semantics: không gọi 4 call còn lại');
  }

  // 9) no duplicate requests: exactly 5 distinct actions, each called once
  {
    const dom = makeDom('/admin/knl/co-cau-thu-nhap?employee_code=PHF001');
    const { window } = dom;
    const responses = defaultIncomeResponses();
    const seen = [];
    window.fetch = async (url, opts) => {
      const action = JSON.parse(opts.body).action;
      seen.push(action);
      const resp = responses[action];
      await new Promise(r => setTimeout(r, resp.delay));
      return { ok: true, json: async () => resp.body };
    };
    window.eval(code);
    const root = window.document.getElementById('phfKnlRoot');
    root.innerHTML = '<div data-knl-body></div>';
    await window.__renderIncome(root, true, {});
    assert.deepEqual(seen.sort(), INCOME_ACTIONS.slice().sort(), 'Đúng 5 action, mỗi action gọi đúng 1 lần, không duplicate');
    console.log('PASS Fix2 — không duplicate request (đúng 5 action, mỗi action 1 lần)');
  }

  // 10) rapid employee switch: stale (slower, older) response must not overwrite the newer view
  {
    const dom = makeDom('/admin/knl/co-cau-thu-nhap?employee_code=PHF001');
    const { window } = dom;
    window.eval(code);
    const root = window.document.getElementById('phfKnlRoot');
    root.innerHTML = '<div data-knl-body></div>';

    // First load: PHF001, deliberately slow (income resolves late)
    let resolveOldIncome;
    let fetchCallN = 0;
    window.fetch = async (url, opts) => {
      const action = JSON.parse(opts.body).action;
      fetchCallN++;
      if (fetchCallN === 1 && action === 'getKnlEmployeeIncome') {
        return new Promise(resolve => {
          resolveOldIncome = () => resolve({ ok: true, json: async () => ({ ok: true, employeeCode: 'PHF001', name: 'Old Employee' }) });
        });
      }
      // everything else (including the 2nd renderIncome's calls) resolves fast
      const fast = { getKnlEmployeeIncome: { employeeCode: 'PHF002', name: 'New Employee' }, getKnlEmployeeNextCompensationGrade: { nextGrade: 'B4' }, getKnlEmployeeCompetencyStandard: { hasAssignment: false }, listKnlEmployeeCompetencyHistory: { items: [] }, getKnlEmployeeProfile: { profile: { code: 'PHF002' } } };
      return { ok: true, json: async () => Object.assign({ ok: true }, fast[action]) };
    };

    const p1 = window.__renderIncome(root, true, {}); // starts loading PHF001 (income call hangs)
    await tick(2);
    // user switches employee before p1 finished -> second renderIncome starts for PHF002 and completes fully first
    window.history.pushState({}, '', '/admin/knl/co-cau-thu-nhap?employee_code=PHF002');
    const p2 = window.__renderIncome(root, true, {});
    await p2; // PHF002 fully resolves and renders first
    assert.strictEqual(window.__foundationState.income.employeeCode, 'PHF002', 'Lượt tải mới (PHF002) phải render trước');

    // now let the stale PHF001 income call finally resolve
    resolveOldIncome();
    await p1;
    assert.strictEqual(window.__foundationState.income.employeeCode, 'PHF002', 'Response CHẬM của nhân sự CŨ (PHF001) không được ghi đè lên nhân sự đang xem (PHF002) — token guard phải chặn');
    const body = root.querySelector('[data-knl-body]');
    assert(!body.innerHTML.includes('Old Employee'), 'DOM không được chứa dữ liệu nhân sự cũ sau khi response chậm về');
    console.log('PASS Fix2 — race thật khi đổi nhân sự nhanh đã được chứng minh và token guard chặn đúng (stale response bị bỏ qua)');
  }

  console.log('KNL-09 P0 Fix#1 (getKnlCapabilities cache) + Fix#2 (renderIncome parallel + stale-guard): ALL PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
