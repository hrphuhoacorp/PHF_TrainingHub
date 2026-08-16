'use strict';
/* Workstream B (vòng cuối) — kiểm tra việc gắn module mới vào phf-checklist-app.js:
 *   A) DOM thật (jsdom + window.eval, cùng pattern test-checklist-retro-wizard-ui-2026-08.js)
 *      cho route Admin /admin/checklist/ghi-nhan-loi?view=create - đủ đơn giản để lái toàn bộ
 *      qua window.phfRenderChecklist() không cần mock getChecklistRoleWorkspace (canUseLateViolation
 *      chỉ phụ thuộc role(), không phụ thuộc dữ liệu async).
 *   B) Structural (source-scanning) cho phần Trưởng ca / route quản lý - lái được route manager
 *      thật đòi hỏi mock toàn bộ chuỗi async getChecklistRoleWorkspace/requestAnimationFrame mà
 *      chưa có tiền lệ trong repo (xem scripts/test-checklist-permissions-tab-guard.js đã chọn
 *      đúng cách này cho lý do tương tự) - đảm bảo đúng wiring không bị revert nhầm.
 * Chạy: node scripts/test-checklist-late-workflow-integration-2026-08.js
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
  // Stub module để không phụ thuộc script injection thật (JSDOM outside-only không tự chạy
  // script[src] động) - test này chỉ kiểm tra WIRING (app chính gọi mount/unmount đúng lúc,
  // đúng ctx), hành vi bên trong module đã được kiểm chứng riêng ở
  // scripts/test-checklist-late-workflow-module-2026-08.js.
  window.__lateWfCalls = [];
  window.PhfChecklistLateWorkflow = {
    mount: function (node, ctx) { window.__lateWfCalls.push({ type: 'mount', ctx: ctx }); node.setAttribute('data-test-mounted', '1'); },
    unmount: function () { window.__lateWfCalls.push({ type: 'unmount' }); }
  };
  window.eval(code);
  return dom;
}

(async () => {
  // =========================================================================
  // 1. Admin: tab "Đi trễ" hiển thị đúng, KHÔNG còn tab con nào (Nhập thủ công đã RETIRED
  //    2026-08-15) — chỉ mount thẳng module đối soát BCC với ctx.isAdmin=true. Lái qua ROUTE
  //    THẬT (window.phfRenderChecklist), không gọi thẳng violationLateHtml()/component nào —
  //    đúng kỷ luật test đã thiết lập từ các vòng trước.
  // =========================================================================
  {
    const dom = await buildDom();
    const { window } = dom;
    window.fetch = async (url, opts) => {
      if (String(url).includes('checklistWorkspace')) return response({ people: [], templates: [] });
      if (String(url).includes('checklistPeople')) return response({ employees: [] });
      return response({ ok: true });
    };
    await window.phfRenderChecklist('/admin/checklist/ghi-nhan-loi?view=create');
    await tick(60);
    const root = window.document.getElementById('phfChecklistRoot');

    check(!!root.querySelector('[data-phfck-violation-tab="late"]'), '1a. Admin thấy tab "Đi trễ" trong Ghi nhận lỗi');
    click(window, root.querySelector('[data-phfck-violation-tab="late"]'));
    await tick(60);

    check(!!root.querySelector('[data-phfck-latewf-shell="admin"]'), '1b. Vào Đi trễ hiện shell Admin');
    check(!root.querySelector('[data-phfck-late-inner-tab]'), '1c. KHÔNG còn bất kỳ tab-switcher nào (data-phfck-late-inner-tab đã bị gỡ hẳn khỏi DOM) — chỉ còn 1 mode duy nhất nên không cần tab con nữa');
    check(!root.querySelector('[data-phfck-late-add],[data-phfck-late-submit],[data-phfck-late-review],[data-phfck-late-confirm],[data-phfck-late-draft],[data-phfck-late-template],[data-phfck-late-upload],[data-phfck-late-export]'),
      '1d. Công cụ "Nhập thủ công" thật sự KHÔNG THỂ TRUY CẬP qua route thật — không có bất kỳ phần tử data-phfck-late-* nào của công cụ đó trong DOM (không chỉ ẩn bằng CSS)');
    check(!root.textContent.includes('Ghi nhận đi trễ theo danh sách') && !root.textContent.includes('Nhập dồn'), '1e. Không còn text/tiêu đề nào của công cụ thủ công cũ hiển thị trong DOM');
    check(!!root.querySelector('[data-phfck-latewf-mount]'), '1f. Có container mount cho module đối soát BCC (đường DUY NHẤT còn lại để ghi nhận Đi trễ qua Admin)');

    await tick(30);
    const mountCall = window.__lateWfCalls.find(c => c.type === 'mount');
    check(!!mountCall, '1g. window.PhfChecklistLateWorkflow.mount() được gọi khi vào Đi trễ');
    check(mountCall && mountCall.ctx.isAdmin === true, '1h. ctx.isAdmin=true khi Admin vào khu vực Đi trễ');
    check(mountCall && mountCall.ctx.canRecord === true, '1i. ctx.canRecord=true cho Admin (Admin luôn được ghi nhận)');
  }

  // =========================================================================
  // 2. Rời hẳn khu vực Đi trễ rồi quay lại -> vẫn chỉ có module đối soát BCC, không có đường nào
  //    hồi sinh lại tab/công cụ thủ công cũ (real-route round-trip, không chỉ lần render đầu).
  // =========================================================================
  {
    const dom = await buildDom();
    const { window } = dom;
    window.fetch = async () => response({ ok: true });
    await window.phfRenderChecklist('/admin/checklist/ghi-nhan-loi?view=create');
    await tick(60);
    const root = window.document.getElementById('phfChecklistRoot');
    click(window, root.querySelector('[data-phfck-violation-tab="late"]'));
    await tick(60);
    click(window, root.querySelector('[data-phfck-violation-tab="quick"]'));
    await tick(60);
    window.__lateWfCalls.length = 0;
    click(window, root.querySelector('[data-phfck-violation-tab="late"]'));
    await tick(60);
    check(!!root.querySelector('[data-phfck-latewf-mount]'), '2a. Mount container module mới xuất hiện trở lại sau round-trip');
    check(!root.querySelector('[data-phfck-late-inner-tab],[data-phfck-late-add]'), '2b. Round-trip KHÔNG hồi sinh lại tab-switcher hay công cụ thủ công cũ');
    check(window.__lateWfCalls.some(c => c.type === 'mount'), '2c. mount() được gọi lại khi quay về Đi trễ');
  }

  // =========================================================================
  // 3. Rời hẳn khu vực "Đi trễ" (chuyển tab quick) -> unmount, và các tab khác (Nhập nhanh/
  //    Ghi nhận chi tiết/Ghi nhận nhiều ngày) không hề bị ảnh hưởng bởi thay đổi lần này.
  // =========================================================================
  {
    const dom = await buildDom();
    const { window } = dom;
    window.fetch = async () => response({ ok: true });
    await window.phfRenderChecklist('/admin/checklist/ghi-nhan-loi?view=create');
    await tick(60);
    const root = window.document.getElementById('phfChecklistRoot');
    check(!!root.querySelector('[data-phfck-violation-tab="quick"]'), '3a. Tab "Nhập nhanh" vẫn tồn tại');
    check(!!root.querySelector('[data-phfck-violation-tab="detail"]'), '3b. Tab "Ghi nhận chi tiết" vẫn tồn tại');
    check(!!root.querySelector('[data-phfck-violation-tab="multi"]'), '3c. Tab "Ghi nhận nhiều ngày" vẫn tồn tại');

    click(window, root.querySelector('[data-phfck-violation-tab="late"]'));
    await tick(60);
    window.__lateWfCalls.length = 0;
    click(window, root.querySelector('[data-phfck-violation-tab="quick"]'));
    await tick(60);
    check(window.__lateWfCalls.some(c => c.type === 'unmount'), '3d. Rời hẳn Đi trễ sang "Nhập nhanh" -> unmount() module mới được gọi (không rò rỉ listener/state)');
    check(!root.querySelector('[data-phfck-latewf-shell]'), '3e. Không còn shell Đi trễ nào trong DOM sau khi chuyển tab');
  }

  console.log('\n' + passes + ' passed (jsdom, phần Admin), ' + failures + ' failed so far.');

  // =========================================================================
  // B) Structural — phần Trưởng ca / route quản lý (xem lý do ở đầu file).
  // =========================================================================
  // Step 2A (2026-08-16): business owner đảo ngược quyết định cũ — khu/tab "Đi trễ" riêng CHỈ
  // dành cho Admin. Manager/Trưởng ca dù có record+record_scope KHÔNG còn thấy tab này (họ ghi
  // DITRE qua đúng flow "Ghi nhận lỗi" Nhập nhanh/Chi tiết/Nhiều ngày của Step 1, không đổi).
  const gateFnBody = (code.match(/function canUseLateWorkflowArea\(\)\{([\s\S]*?)\}/) || [])[1] || '';
  check(gateFnBody.trim() === 'return canUseLateViolation();',
    '5a. canUseLateWorkflowArea() CHỈ còn return canUseLateViolation() (Admin-only) — không còn nhánh role()===\'manager\'&&canRecordViolationNow()');
  check(!gateFnBody.includes('canRecordViolationNow'),
    '5a2. canUseLateWorkflowArea() không còn đọc canRecordViolationNow() — hàm đó vẫn tồn tại nguyên vẹn ở nơi khác cho flow Ghi nhận lỗi DITRE, chỉ không còn dùng làm điều kiện mở tab Đi trễ riêng');
  const tabsBody = (code.match(/function violationTabsHtml\(\)\{([\s\S]*?)\n  \}/) || [])[1] || '';
  check(tabsBody.includes('canUseLateWorkflowArea()'),
    '5b. violationTabsHtml() vẫn gate tab "Đi trễ" bằng canUseLateWorkflowArea() (wiring không đổi) — kết hợp với 5a nghĩa là tab CHỈ hiện cho Admin, Manager có record cũng không còn thấy');
  check(/if\(!canUseLateViolation\(\)\)\{[\s\S]{0,260}?data-phfck-latewf-mount/.test(code),
    '5c. violationLateHtml() render riêng nhánh non-admin: KHÔNG có tab con, KHÔNG có violationLateManualToolHtml(), chỉ có mount container');
  const nonAdminBranch = (code.match(/function violationLateHtml\(\)\{[\s\S]*?if\(!canUseLateViolation\(\)\)\{([\s\S]*?)\n    \}/) || [])[1] || '';
  check(!nonAdminBranch.includes('violationLateManualToolHtml') && !nonAdminBranch.includes('phfck-latewf-innertabs'),
    '5d. Nhánh Trưởng ca không gọi violationLateManualToolHtml() và không có tab-switcher (đúng yêu cầu "chỉ thấy Ghi nhận phát hiện")');

  // Nhánh Admin (2026-08-15): "Nhập thủ công" đã RETIRED — violationLateHtml() TOÀN BỘ (cả 2
  // nhánh admin/non-admin) không còn gọi violationLateManualToolHtml() ở đâu cả, dù hàm đó vẫn
  // còn tồn tại trong file (giữ lại làm dead code, xem ghi chú RETIRED ngay phía trên định nghĩa
  // hàm) — grep-guard xác nhận lời gọi DUY NHẤT còn sót là bên trong comment giải thích.
  const violationLateHtmlBody = (code.match(/function violationLateHtml\(\)\{([\s\S]*?)\n  \}/) || [])[1] || '';
  check(!!violationLateHtmlBody, '5i. violationLateHtml() exists');
  check(!violationLateHtmlBody.includes('violationLateManualToolHtml()'),
    '5j. violationLateHtml() (cả 2 nhánh) KHÔNG còn bất kỳ lời gọi violationLateManualToolHtml() nào — công cụ thủ công thật sự unreachable qua route thật, không chỉ ẩn UI');
  check(!violationLateHtmlBody.includes('data-phfck-late-inner-tab') && !violationLateHtmlBody.includes('phfck-latewf-innertabs'),
    '5k. violationLateHtml() không còn render tab-switcher nào (chỉ 1 mode duy nhất)');
  check(code.includes('function violationLateManualToolHtml()'),
    '5l. violationLateManualToolHtml() vẫn còn tồn tại trong source (retired = đánh dấu unreachable, KHÔNG xóa hẳn, giảm rủi ro đứt gãy tham chiếu chéo với writeViolationExcel()/importLateCsv())');
  check(/function updateManagerSectionView\(root,path\)\{[\s\S]*?syncLateWorkflowMount\(root\);/.test(code),
    '5e. updateManagerSectionView() (route Trưởng ca /ql/checklist) gọi syncLateWorkflowMount(root) sau mỗi lần render nội dung');
  check(/function updateAdminView\(root,path\)\{[\s\S]*?syncLateWorkflowMount\(root\);/.test(code),
    '5f. updateAdminView() (route Admin) cũng gọi syncLateWorkflowMount(root)');
  check(/vm==='late'&&!canUseLateWorkflowArea\(\)/.test(code),
    '5g. Click handler tab Đi trễ chặn lại bằng canUseLateWorkflowArea() — sau Step 2A đây chính là chặn Admin-only (không chỉ ẩn nút, còn chặn cả khi vm bị set thủ công/crafted)');
  check(code.includes("checklistToast('warning','Không có quyền truy cập','Chức năng Đi trễ chỉ dành cho Admin.',true)"),
    '5g2. Message cảnh báo click-guard đã cập nhật đúng rule mới: "Chức năng Đi trễ chỉ dành cho Admin." (không còn nhắc "tài khoản được cấp quyền ghi nhận lỗi")');
  check(/violationUiState\.mode==='late'&&!canUseLateWorkflowArea\(\)\)violationUiState\.mode='quick';/.test(code),
    '5h. Guard khởi tạo view (fallback cho state/URL cũ mode=\'late\' của Manager) vẫn dùng canUseLateWorkflowArea() — sau Step 2A tự động fallback về \'quick\' cho MỌI non-Admin, kể cả Manager có record_scope, không cần code fallback mới');

  // buildLateWorkflowCtx(): capability/scope luôn đọc từ nguồn đã có (violationEligibleEmployees,
  // canRecordViolationNow, currentSessionEmployeeCode) - không tự phát minh scope/capability mới.
  const ctxBody = (code.match(/function buildLateWorkflowCtx\(\)\{([\s\S]*?)\n  \}/) || [])[1] || '';
  check(!!ctxBody, '6a. buildLateWorkflowCtx() exists');
  check(ctxBody.includes('canUseLateViolation()') && ctxBody.includes('canRecordViolationNow()'),
    '6b. buildLateWorkflowCtx() dùng đúng 2 nguồn capability đã có (canUseLateViolation/canRecordViolationNow), không tự suy role mới');
  check(ctxBody.includes('violationEligibleEmployees()'),
    '6c. Danh sách nhân sự truyền cho module mới lấy từ violationEligibleEmployees() đã lọc theo scope sẵn có (không tự lọc lại)');
  check(!/hardcoded|TRUONG_CA_BH/.test(ctxBody), '6d. Không hardcode preset cụ thể trong ctx');

  // syncLateWorkflowMount(): idempotent mount/unmount, không mount lặp trên cùng node.
  const syncBody = (code.match(/function syncLateWorkflowMount\(root\)\{([\s\S]*?)\n  \}/) || [])[1] || '';
  check(!!syncBody, '7a. syncLateWorkflowMount() exists');
  check(syncBody.includes("getAttribute('data-phfck-latewf-mounted')==='1'"), '7b. Có guard chống mount lặp lại trên cùng 1 node (idempotent)');
  check(syncBody.includes('window.PhfChecklistLateWorkflow.unmount()'), '7c. Khi không còn mount-node trong DOM thì gọi unmount() (dọn dẹp khi rời khu vực Đi trễ)');

  // Không có action approve nào bị gọi từ đường dẫn wiring app chính (chỉ module mới được gọi
  // approveChecklistLateEvents - grep toàn file app chính để chắc chắn).
  check(!code.includes('approveChecklistLateEvents'), '8a. phf-checklist-app.js (app chính) không tự gọi approveChecklistLateEvents ở bất kỳ đâu - chỉ module mới (phf-checklist-late-workflow.js) làm việc này');

  // Không có ngôn ngữ quota cưỡng chế nào được thêm vào app chính do thay đổi lần này.
  ['Hết quota', 'Vượt quota nên tự trừ', 'Bị chặn do quota'].forEach(p => {
    check(!code.includes(p), '8b. Không có cụm cấm "' + p + '" trong phf-checklist-app.js');
  });

  console.log('\n' + passes + ' passed total, ' + failures + ' failed.');
  if (failures > 0) process.exit(1);
})();
