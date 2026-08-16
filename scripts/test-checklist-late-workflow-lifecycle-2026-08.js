'use strict';
/* Regression — Root cause #2 (2026-08-16): Admin mở tab "Đi trễ", module mount THÀNH CÔNG
 * (wizard "Nhập file → Kiểm tra dữ liệu → Đối soát → Xem lại → Phê duyệt" hiện đầy đủ), rồi
 * SAU ĐÓ tự nhiên biến mất về placeholder "Đang tải công cụ đối soát BCC…" — vì một async
 * task KHÔNG LIÊN QUAN (fetchViolationWorkspaceSnapshot(), khởi động từ
 * initializeViolationsView() lúc vào route, không phải ensureLateWorkflowModule()) resolve
 * TRỄ hơn, và initializeViolationsView() -> refreshViolationWorkspace() ->
 * renderViolationWorkspace() rebuild lại workspace.outerHTML MÀ KHÔNG gọi lại
 * syncLateWorkflowMount() cho node mới.
 *
 * Fix (kiến trúc, không timeout/polling/retry):
 *   1) renderViolationWorkspace() — nguồn rebuild DÙNG CHUNG cho mọi caller — tự gọi
 *      syncLateWorkflowMount(root) ngay sau workspace.outerHTML=violationsHtml() khi
 *      mode==='late'. Một nơi duy nhất chịu trách nhiệm.
 *   2) loadLatePointsPolicy() không còn tự viết workspace.innerHTML=violationsHtml() riêng —
 *      đi qua renderViolationWorkspace() để hưởng cùng lifecycle invariant.
 *
 * Test này dùng ĐÚNG pattern jsdom+window.eval+window.phfRenderChecklist() của
 * test-checklist-late-workflow-integration-2026-08.js (module stub sẵn để tách biệt khỏi
 * timing tải script — race đó đã có test riêng ở
 * test-checklist-late-workflow-mount-race-2026-08.js, KHÔNG lặp lại ở đây).
 *
 * Chạy: node scripts/test-checklist-late-workflow-lifecycle-2026-08.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const appPath = path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js');
const cssPath = path.resolve(__dirname, '..', 'assets/css/phf-checklist.css');
const code = fs.readFileSync(appPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

let failures = 0, passes = 0;
function check(condition, message) { if (!condition) { console.error('FAIL: ' + message); failures++; } else { passes++; } }
function click(window, el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
function tick(n) { return new Promise(resolve => setTimeout(resolve, n || 30)); }
function response(data) { return { ok: true, status: 200, json: async () => data }; }
/* Cả checklistWorkspace lẫn getChecklistLatePointsPolicy đều là async task độc lập có thể
 * trigger renderViolationWorkspace() sau khi resolve — GATE CẢ HAI trong mọi test, chỉ mở
 * đúng gate đang được kiểm để cô lập từng kịch bản, endpoint còn lại treo vĩnh viễn (vô hại,
 * không assertion nào phụ thuộc nó). */
function makeGatedFetch() {
  let resolveWorkspace, resolvePolicy;
  const workspaceGate = new Promise(resolve => { resolveWorkspace = resolve; });
  const policyGate = new Promise(resolve => { resolvePolicy = resolve; });
  const fetchImpl = async (url, opts) => {
    if (String(url).includes('checklistWorkspace')) { await workspaceGate; return response({ employees: [], checklistTemplates: [], checklistTemplatesReady: true }); }
    if (String(url).includes('checklistPeople')) return response({ employees: [] });
    if (opts && String(opts.body || '').includes('getChecklistLatePointsPolicy')) { await policyGate; return response({ policy: { levels: [] } }); }
    return response({ ok: true });
  };
  return { fetchImpl, resolveWorkspace, resolvePolicy };
}

/* buildDom nhận thêm 1 callback fetchImpl tuỳ chỉnh để mỗi test tự kiểm soát timing của
 * fetchViolationWorkspaceSnapshot() (endpoint checklistWorkspace) — mô phỏng chính xác
 * "network trả 200 nhưng TRỄ hơn thời điểm module đã mount xong" đã audit. */
async function buildDom(fetchImpl) {
  const dom = new JSDOM(
    '<!doctype html><html><head><style>' + css + '</style></head><body><div id="phfChecklistRoot"></div></body></html>',
    { url: 'http://localhost/admin/checklist/ghi-nhan-loi?view=create', runScripts: 'outside-only' }
  );
  const { window } = dom;
  window.phfGetSessionRole = () => 'admin';
  window.phfGetCurrentUser = () => ({ id: 'admin-1', employeeCode: 'PHF000', name: 'Admin', fullName: 'Quản trị viên' });
  window.phfGetAuthenticatedUser = window.phfGetCurrentUser;
  window.requestAnimationFrame = fn => setTimeout(fn, 0);
  window.requestIdleCallback = fn => setTimeout(fn, 0);
  window.scrollTo = () => {};
  // employees:[] ngay từ đầu (không đợi fetch) để checklistPeopleDataReady()===true, mô
  // phỏng đúng bối cảnh thật: dữ liệu nhân sự đã có sẵn từ trước, chỉ riêng
  // fetchViolationWorkspaceSnapshot() (background refresh) mới resolve trễ — khớp đúng
  // network evidence user chụp (không phải màn hình "đang tải danh sách nhân sự").
  window.__phfLocalData = { employees: [], checklistAssignments: [], checklistAssignmentsReady: true, checklistTemplates: [], checklistTemplatesReady: true, checklistTemplatesError: '' };
  const lateWfCalls = [];
  window.__lateWfCalls = lateWfCalls;
  window.PhfChecklistLateWorkflow = {
    mount: function (node, ctx) { lateWfCalls.push({ type: 'mount', node: node, ctx: ctx }); node.setAttribute('data-test-mounted', '1'); },
    unmount: function () { lateWfCalls.push({ type: 'unmount' }); }
  };
  window.fetch = fetchImpl;
  window.eval(code);
  return { dom, lateWfCalls };
}

(async () => {
  // =========================================================================
  // 1. RACE THẬT #2: initializeViolationsView() (qua fetchViolationWorkspaceSnapshot ->
  //    checklistWorkspace) resolve TRỄ hơn lúc module đã mount xong (wizard đã hiện) — phải
  //    remount lại đúng vào node mới, KHÔNG được để trắng/kẹt placeholder vĩnh viễn.
  // =========================================================================
  {
    const { fetchImpl, resolveWorkspace } = makeGatedFetch();
    const { dom, lateWfCalls } = await buildDom(fetchImpl);
    const { window } = dom;

    // Vào route -> updateAdminView() -> initializeViolationsView() khởi động
    // fetchViolationWorkspaceSnapshot() nhưng CHƯA resolve (workspaceGate đang treo).
    // getChecklistLatePointsPolicy cũng đang treo (policyGate) để không gây nhiễu.
    await window.phfRenderChecklist('/admin/checklist/ghi-nhan-loi?view=create');
    await tick(30);
    const root = window.document.getElementById('phfChecklistRoot');

    // Admin click vào tab Đi trễ TRONG LÚC checklistWorkspace vẫn đang treo — mount vẫn phải
    // thành công bình thường (không phụ thuộc fetch đó).
    click(window, root.querySelector('[data-phfck-violation-tab="late"]'));
    await tick(30);

    check(lateWfCalls.filter(c => c.type === 'mount').length === 1, '1a. Module mount thành công lần đầu (wizard hiện) trước khi checklistWorkspace resolve');
    const firstMountedNode = root.querySelector('[data-phfck-latewf-mount]');
    check(!!firstMountedNode && firstMountedNode.getAttribute('data-test-mounted') === '1', '1b. Node đầu tiên thực sự nhận mount (wizard đang hiển thị)');

    // Bây giờ checklistWorkspace mới resolve (đúng bug đã audit: TRỄ hơn mount) ->
    // initializeViolationsView() -> refreshViolationWorkspace() -> renderViolationWorkspace()
    // rebuild lại workspace.
    resolveWorkspace();
    await tick(50);

    check(!firstMountedNode.isConnected, '1c. Node đầu tiên bị gỡ khỏi DOM sau khi checklistWorkspace resolve trễ (điều kiện race #2 đã tái hiện)');
    const mountCalls = lateWfCalls.filter(c => c.type === 'mount');
    check(mountCalls.length === 2, '1d. mount() được gọi LẠI đúng 1 lần nữa (tổng 2 lần) — renderViolationWorkspace() đã tự remount, không bỏ mặc placeholder treo vĩnh viễn');
    const secondNode = root.querySelector('[data-phfck-latewf-mount]');
    check(mountCalls[1] && mountCalls[1].node === secondNode && secondNode !== firstMountedNode, '1e. Lần mount thứ hai đúng vào node MỚI (khác node cũ đã detach)');
    check(secondNode.getAttribute('data-test-mounted') === '1', '1f. Node mới thực sự nhận mount — Late Workflow hiển thị lại, không kẹt placeholder');
  }

  // =========================================================================
  // 2. loadLatePointsPolicy() hoàn tất khi mode='late' -> rebuild qua renderViolationWorkspace()
  //    (không còn tự viết workspace.innerHTML riêng) -> Late Workflow vẫn mount đúng.
  // =========================================================================
  {
    const { fetchImpl, resolveWorkspace, resolvePolicy } = makeGatedFetch();
    const { dom, lateWfCalls } = await buildDom(fetchImpl);
    const { window } = dom;

    await window.phfRenderChecklist('/admin/checklist/ghi-nhan-loi?view=create');
    await tick(30);
    const root = window.document.getElementById('phfChecklistRoot');

    click(window, root.querySelector('[data-phfck-violation-tab="late"]'));
    await tick(30);
    check(lateWfCalls.filter(c => c.type === 'mount').length === 1, '2a. Module mount lần đầu bình thường (checklistWorkspace + loadLatePointsPolicy đang treo)');
    const firstNode = root.querySelector('[data-phfck-latewf-mount]');

    resolvePolicy();
    await tick(40);

    const mountCalls = lateWfCalls.filter(c => c.type === 'mount');
    check(mountCalls.length === 2, '2b. loadLatePointsPolicy() hoàn tất -> renderViolationWorkspace() rebuild -> mount lại lần 2 (không bỏ mặc)');
    check(mountCalls[1] && mountCalls[1].node !== firstNode, '2c. Mount lần 2 vào node mới do renderViolationWorkspace() tạo ra');
  }

  // =========================================================================
  // 3. Không mount thừa khi KHÔNG ở mode 'late': rời tab Đi trễ trước, sau đó
  //    checklistWorkspace mới resolve -> renderViolationWorkspace() rebuild bình thường,
  //    KHÔNG được tự ý mount lại Late Workflow (vì mode đã đổi).
  // =========================================================================
  {
    const { fetchImpl, resolveWorkspace } = makeGatedFetch();
    const { dom, lateWfCalls } = await buildDom(fetchImpl);
    const { window } = dom;

    await window.phfRenderChecklist('/admin/checklist/ghi-nhan-loi?view=create');
    await tick(30);
    const root = window.document.getElementById('phfChecklistRoot');

    click(window, root.querySelector('[data-phfck-violation-tab="late"]'));
    await tick(30);
    check(lateWfCalls.filter(c => c.type === 'mount').length === 1, '3a. Mount lần đầu khi vào Đi trễ');

    click(window, root.querySelector('[data-phfck-violation-tab="quick"]'));
    await tick(30);
    check(lateWfCalls.some(c => c.type === 'unmount'), '3b. Rời tab -> unmount() được gọi (hành vi cũ, không đổi)');
    lateWfCalls.length = 0;

    resolveWorkspace();
    await tick(50);

    check(lateWfCalls.filter(c => c.type === 'mount').length === 0, '3c. checklistWorkspace resolve trễ khi đã KHÔNG còn ở mode late -> renderViolationWorkspace() không mount thừa Late Workflow');
    check(!root.querySelector('[data-phfck-latewf-shell]'), '3d. Không có shell Đi trễ nào tái xuất hiện trong DOM sau rebuild khi đang ở tab Nhập nhanh');
  }

  // =========================================================================
  // 4. Không double-mount cùng một node: fix #1 (renderViolationWorkspace() tự gọi
  //    syncLateWorkflowMount() ngay sau outerHTML) khiến MỖI lần click tab "Đi trễ" giờ gọi
  //    syncLateWorkflowMount() 2 LẦN cho cùng 1 node — 1 lần đồng bộ ngay trong
  //    renderViolationWorkspace(), 1 lần nữa qua rAF sẵn có trong click-handler (dòng
  //    'if(vm===late){...requestAnimationFrame(syncLateWorkflowMount)}'). Cờ
  //    data-phfck-latewf-mounted phải chặn đúng lần gọi thừa đó, không double-mount.
  // =========================================================================
  {
    // Gate cả 2 endpoint (không resolve) để cô lập ĐÚNG kịch bản "1 click sinh 2 lời gọi
    // syncLateWorkflowMount() cho cùng 1 node" — không để checklistWorkspace/loadLatePointsPolicy
    // resolve xen vào tạo thêm remount hợp lệ (đã test riêng ở case 1/2), tránh nhiễu phép đếm.
    const { fetchImpl } = makeGatedFetch();
    const { dom, lateWfCalls } = await buildDom(fetchImpl);
    const { window } = dom;

    await window.phfRenderChecklist('/admin/checklist/ghi-nhan-loi?view=create');
    await tick(30);
    const root = window.document.getElementById('phfChecklistRoot');

    click(window, root.querySelector('[data-phfck-violation-tab="late"]'));
    // Đợi đủ để CẢ HAI lời gọi syncLateWorkflowMount() (đồng bộ trong renderViolationWorkspace
    // + rAF trong click-handler) đều đã chạy xong cho CÙNG 1 node ban đầu.
    await tick(50);

    const node = root.querySelector('[data-phfck-latewf-mount]');
    check(node.getAttribute('data-phfck-latewf-mounted') === '1', '4a. Node hiện tại đã được đánh dấu mounted');
    check(lateWfCalls.filter(c => c.type === 'mount').length === 1,
      '4b. Không double-mount vào cùng 1 node dù syncLateWorkflowMount() bị gọi 2 lần cho cùng 1 lần click (đồng bộ trong renderViolationWorkspace() + rAF cũ) — cờ data-phfck-latewf-mounted chặn đúng lần gọi thừa');
  }

  console.log('\n' + passes + ' passed, ' + failures + ' failed.');
  if (failures > 0) process.exit(1);
})().catch(err => { console.error('FATAL', err); process.exit(1); });
