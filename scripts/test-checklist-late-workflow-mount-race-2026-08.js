'use strict';
/* Regression — race condition fix (2026-08-16): Admin mở tab "Đi trễ" thấy spinner
 * "Đang tải công cụ đối soát BCC…" rồi module không bao giờ mount, vì
 * ensureLateWorkflowModule() (tải script/CSS qua network) resolve CHẬM hơn một lần
 * re-render khác của cùng root (vd loadLatePointsPolicy() ghi lại workspace.innerHTML
 * khi đang ở mode 'late') khiến node ban đầu bị gỡ khỏi DOM trước khi module kịp mount.
 *
 * Test này KHÔNG stub sẵn window.PhfChecklistLateWorkflow (khác với
 * test-checklist-late-workflow-integration-2026-08.js) để ensureLateWorkflowModule()
 * đi đúng nhánh tiêm <script data-phfck-latewf-script> thật và trả về promise CHƯA
 * resolve — cho phép test tự kiểm soát chính xác thời điểm "script tải xong" bằng
 * cách dispatch sự kiện load thủ công, dựng lại đúng race điều kiện đã audit.
 *
 * Chạy: node scripts/test-checklist-late-workflow-mount-race-2026-08.js
 */
const assert = require('assert');
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

async function buildDom() {
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
  window.__phfLocalData = { checklistTemplates: [], checklistTemplatesReady: true, checklistTemplatesError: '' };
  // CỐ Ý KHÔNG stub window.PhfChecklistLateWorkflow ở đây — xem giải thích đầu file.
  window.fetch = async (url) => {
    if (String(url).includes('checklistWorkspace')) return response({ people: [], templates: [] });
    if (String(url).includes('checklistPeople')) return response({ employees: [] });
    return response({ ok: true });
  };
  window.eval(code);
  return dom;
}

/* Giả lập ĐÚNG bug thật: loadLatePointsPolicy() (Admin) gọi thẳng
 * workspace.innerHTML=violationsHtml() khi tải xong bảng mức Đi trễ - một lệnh thay DOM
 * TRỰC TIẾP, KHÔNG đi qua render()/updateAdminView() nên KHÔNG tự động gọi lại
 * syncLateWorkflowMount() cho node mới. Dùng đúng DOM API (replaceWith một node mount mới
 * tinh, chưa có data-phfck-latewf-mounted) để mô phỏng CHÍNH XÁC hiệu ứng đó mà không cần
 * gọi lại pipeline render đầy đủ của app (pipeline đó tự gọi syncLateWorkflowMount() nên sẽ
 * không tái hiện đúng bug - đã xác nhận khi viết test này). */
function detachMountNodeWithFreshReplacement(window, node) {
  const fresh = window.document.createElement('div');
  fresh.setAttribute('data-phfck-latewf-mount', '');
  fresh.className = node.className;
  fresh.innerHTML = '<div class="phfck-latewf-boot" role="status" aria-live="polite">Đang tải công cụ đối soát BCC…</div>';
  node.replaceWith(fresh);
  return fresh;
}

/* Giả lập script <script data-phfck-latewf-script> đã "tải xong": gán
 * window.PhfChecklistLateWorkflow (mô phỏng module thật vừa định nghĩa xong) RỒI dispatch
 * sự kiện 'load' trên đúng thẻ script mà ensureLateWorkflowModule() đã tiêm vào <head> —
 * đúng thứ tự một script thật load qua network sẽ làm (định nghĩa global trước, fire load
 * event sau khi engine chạy xong script). */
function resolveInjectedLateWorkflowScript(window, lateWfCalls) {
  window.PhfChecklistLateWorkflow = {
    mount: function (node, ctx) { lateWfCalls.push({ type: 'mount', node: node, ctx: ctx }); node.setAttribute('data-test-mounted', '1'); },
    unmount: function () { lateWfCalls.push({ type: 'unmount' }); }
  };
  const scriptEl = window.document.querySelector('script[data-phfck-latewf-script]');
  assert(scriptEl, 'test setup: <script data-phfck-latewf-script> phải tồn tại trong <head> trước khi giả lập load xong');
  scriptEl.dispatchEvent(new window.Event('load'));
}

(async () => {
  // =========================================================================
  // 1. RACE THẬT: node ban đầu bị detach (do 1 lần re-render khác của cùng root xảy ra
  //    TRƯỚC khi script late-workflow "tải xong") — module phải mount vào node MỚI, không
  //    được bỏ cuộc/để spinner treo vĩnh viễn.
  // =========================================================================
  {
    const dom = await buildDom();
    const { window } = dom;
    const lateWfCalls = [];

    await window.phfRenderChecklist('/admin/checklist/ghi-nhan-loi?view=create');
    await tick(30);
    const root = window.document.getElementById('phfChecklistRoot');

    click(window, root.querySelector('[data-phfck-violation-tab="late"]'));
    await tick(30);

    const originalNode = root.querySelector('[data-phfck-latewf-mount]');
    check(!!originalNode, '1a. Node mount ban đầu tồn tại sau khi vào tab Đi trễ');
    check(originalNode.getAttribute('data-phfck-latewf-mounted') === '1', '1b. Node ban đầu đã được đánh dấu data-phfck-latewf-mounted (chống double-mount)');

    // Script late-workflow CHƯA "tải xong" — mô phỏng ĐÚNG bug thật: loadLatePointsPolicy()
    // thay workspace.innerHTML trực tiếp (không qua render pipeline) TRƯỚC khi script
    // network resolve (đúng race đã audit).
    const newNode = detachMountNodeWithFreshReplacement(window, originalNode);
    await tick(10);

    check(!originalNode.isConnected, '1c. Node ban đầu đã bị gỡ khỏi DOM (điều kiện race)');
    check(!!newNode && newNode !== originalNode, '1d. Có node mount MỚI, khác node cũ');
    check(newNode.getAttribute('data-phfck-latewf-mounted') !== '1', '1e. Node mới CHƯA được đánh dấu mounted (chưa ai mount vào)');

    // Bây giờ script mới "tải xong" — resolve promise của ensureLateWorkflowModule().
    resolveInjectedLateWorkflowScript(window, lateWfCalls);
    await tick(30);

    const mountCalls = lateWfCalls.filter(c => c.type === 'mount');
    check(mountCalls.length === 1, '1f. mount() được gọi ĐÚNG 1 LẦN sau khi script resolve trễ (không bỏ cuộc, không double-mount)');
    check(mountCalls[0] && mountCalls[0].node === newNode, '1g. mount() được gọi với NODE MỚI (không phải node cũ đã detach) — đây là fix chính');
    check(newNode.getAttribute('data-test-mounted') === '1', '1h. Node mới thực sự nhận được mount (đánh dấu data-test-mounted)');
    check(!originalNode.getAttribute('data-test-mounted'), '1i. Node cũ (đã detach) không nhận mount nào — không rò rỉ mount vào node chết');
  }

  // =========================================================================
  // 2. Không regression: node cũ vẫn connected khi script resolve (đường thường, không có
  //    re-render chen ngang) — vẫn mount đúng 1 lần vào ĐÚNG node cũ như hành vi gốc.
  // =========================================================================
  {
    const dom = await buildDom();
    const { window } = dom;
    const lateWfCalls = [];

    await window.phfRenderChecklist('/admin/checklist/ghi-nhan-loi?view=create');
    await tick(30);
    const root = window.document.getElementById('phfChecklistRoot');

    click(window, root.querySelector('[data-phfck-violation-tab="late"]'));
    await tick(30);

    const node = root.querySelector('[data-phfck-latewf-mount]');
    check(!!node && node.isConnected, '2a. Node mount tồn tại và vẫn connected (không có re-render chen ngang)');

    resolveInjectedLateWorkflowScript(window, lateWfCalls);
    await tick(30);

    const mountCalls = lateWfCalls.filter(c => c.type === 'mount');
    check(mountCalls.length === 1, '2b. mount() được gọi đúng 1 lần (không double-mount) khi không có race');
    check(mountCalls[0] && mountCalls[0].node === node, '2c. mount() dùng đúng node gốc khi không có race (không đổi hành vi cũ)');
  }

  // =========================================================================
  // 3. Không loop vô hạn / không double-mount: nếu tại thời điểm re-query, node mới CŨNG
  //    đã bị đánh dấu mounted (giả định 1 lượt syncLateWorkflowMount khác đã claim nó
  //    trước) — code chỉ re-query ĐÚNG MỘT LẦN rồi bỏ cuộc êm, không throw, không mount
  //    chồng, không tự tìm tiếp/lặp.
  // =========================================================================
  {
    const dom = await buildDom();
    const { window } = dom;
    const lateWfCalls = [];

    await window.phfRenderChecklist('/admin/checklist/ghi-nhan-loi?view=create');
    await tick(30);
    const root = window.document.getElementById('phfChecklistRoot');

    click(window, root.querySelector('[data-phfck-violation-tab="late"]'));
    await tick(30);

    const originalNode = root.querySelector('[data-phfck-latewf-mount]');
    const newNode = detachMountNodeWithFreshReplacement(window, originalNode);
    newNode.setAttribute('data-phfck-latewf-mounted', '1'); // giả định đã bị claim bởi nơi khác
    await tick(10);

    let threw = null;
    try {
      resolveInjectedLateWorkflowScript(window, lateWfCalls);
      await tick(30);
    } catch (err) { threw = err; }

    check(!threw, '3a. Không throw exception khi node mới cũng đã được đánh dấu mounted sẵn');
    check(lateWfCalls.filter(c => c.type === 'mount').length === 0,
      '3b. Không mount chồng vào node đã bị claim — re-query đúng 1 lần rồi bỏ cuộc êm, không tự tìm tiếp/loop');
  }

  console.log('\n' + passes + ' passed, ' + failures + ' failed.');
  if (failures > 0) process.exit(1);
})().catch(err => { console.error('FATAL', err); process.exit(1); });
