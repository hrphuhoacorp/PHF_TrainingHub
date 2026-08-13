'use strict';
/*
 * PHF correction (2026-08-13): backend round-trip test (scripts/test-knl-
 * dashboard-view-capability-roundtrip-2026-08.js) đã PASS — vấn đề KHÔNG phải
 * backend persistence. Trace lại đúng UI state/save boundary: nút "Lưu" hiện
 * đang render TRƯỚC (phía trên) section "6. Thiết lập nâng cao" trong DOM,
 * khiến người dùng hiểu nhầm Advanced là 1 khối tách biệt/tự lưu riêng.
 *
 * Test DOM thật (jsdom) chạy đúng file production assets/js/knl/phf-knl-app.js
 * (không phải bản chép tay) — mô phỏng NGUYÊN VẸN thao tác PHF mô tả:
 *   chọn Tiên -> mở "Thiết lập nâng cao" -> tick "Xem Dashboard KNL" -> bấm
 *   nút Lưu (nay đã chuyển xuống CUỐI form, sau Advanced) -> đọc payload thật
 *   gửi lên upsertKnlPermissionGrant -> giả lập reload (grant trả về từ
 *   response) -> giả lập F5 (listKnlPermissionGrants mới) -> verify checkbox
 *   vẫn checked.
 *
 * Test cả 1 capability CŨ (income_view) trong cùng Advanced để chứng minh
 * đây không phải vấn đề riêng của dashboard_view.
 *
 * Chạy thủ công: node scripts/test-knl-permission-advanced-save-boundary-2026-08.js
 */
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync('assets/js/knl/phf-knl-app.js', 'utf8');

const ACCOUNT_ID = 'acct-phf010';
function tienAccount() {
  return { id: ACCOUNT_ID, role: 'learner', name: 'Nguyễn Thủy Tiên', email: 'tien@phf.local', employeeCode: 'PHF010', position: 'Trợ lý Giám đốc', department: 'Ban giám đốc', branch: 'Phú Lợi' };
}
function tienGrant(overrides) {
  return Object.assign({
    id: 'grant-phf010', accountId: ACCOUNT_ID, employeeCode: 'PHF010', employeeName: 'Nguyễn Thủy Tiên',
    presetCode: 'TRUONG_BO_PHAN',
    capabilities: {
      access_knl: true, view_people: true, propose: false, agree_proposal: false, approve: false,
      manage_framework: false, manage_permissions: false, income_view: true, view_proposals: false, dashboard_view: false,
      incomeScope: { type: 'department', values: ['Bộ phận thu mua', 'Bộ phận Gói quà & Chế biến', 'Bộ phận bán hàng', 'Bộ phận bán hàng Online'] }
    },
    peopleScope: { type: 'department', values: ['Bộ phận thu mua', 'Bộ phận Gói quà & Chế biến', 'Bộ phận bán hàng', 'Bộ phận bán hàng Online'], reservedEmployees: [] },
    reason: 'Khoi tao quyen theo ho so ban dau', isActive: true, updatedAt: new Date().toISOString(), updatedByName: 'Admin'
  }, overrides || {});
}

function jsonResponse(obj) { return { ok: true, json: async () => obj }; }
function click(window, el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }

async function setupDom(persistedGrant) {
  const dom = new JSDOM('<!doctype html><html><body><div id="phfKnlRoot"></div></body></html>', { url: 'http://localhost/admin/knl/phan-quyen', runScripts: 'outside-only' });
  const { window } = dom;
  const savedCalls = [];
  let grantState = JSON.parse(JSON.stringify(persistedGrant));
  window.phfGetSessionRole = () => 'admin';
  window.phfGetCurrentUser = () => ({ id: 'admin1', email: 'admin@phf.local', accountId: 'admin1' });
  window.phfNavigate = () => {};
  window.confirm = () => true;
  window.alert = () => {};
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.scrollTo = () => {};
  window.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body), action = body.action;
    if (action === 'getKnlCapabilities') return jsonResponse({ ok: true, isAdmin: true, capabilities: { manage_permissions: true }, presetCode: 'ADMIN_RECOVERY', peopleScope: { type: 'all_company', values: [] } });
    if (action === 'listKnlPermissionGrants') return jsonResponse({ ok: true, grants: [JSON.parse(JSON.stringify(grantState))], presets: [{ code: 'CUSTOM', name: 'Tùy chỉnh', capabilities: {}, peopleScope: { type: 'self', values: [] } }, { code: 'TRUONG_BO_PHAN', name: 'Trưởng bộ phận', capabilities: {}, peopleScope: { type: 'employees', values: [] } }], scopeTypes: ['self', 'sales_all_branches', 'department', 'employees', 'all_company'], capabilityKeys: Object.keys(grantState.capabilities).filter(k => typeof grantState.capabilities[k] === 'boolean') });
    if (action === 'listKnlAccountsForPermission') return jsonResponse({ ok: true, accounts: [tienAccount()] });
    if (action === 'upsertKnlPermissionGrant') {
      savedCalls.push(JSON.parse(JSON.stringify(body.grant)));
      grantState = Object.assign({}, grantState, {
        capabilities: Object.assign({}, body.grant.capabilities),
        peopleScope: Object.assign({}, body.grant.peopleScope),
        presetCode: body.grant.presetCode, reason: body.grant.reason, isActive: body.grant.isActive
      });
      return jsonResponse({ ok: true, grant: JSON.parse(JSON.stringify(grantState)) });
    }
    if (action === 'listKnlPeople') return jsonResponse({ ok: true, people: [], total: 0, peopleScope: { type: 'department', values: [] }, truncated: false });
    return jsonResponse({ ok: false, error: 'unhandled action ' + action });
  };
  window.eval(code);
  await window.phfRenderKnl('/admin/knl/phan-quyen');
  await new Promise(r => setTimeout(r, 20));
  return { window, root: window.document.getElementById('phfKnlRoot'), savedCalls, getGrantState: () => grantState };
}

function openAdvancedAndGetCheckbox(window, root, capKey) {
  const selectBtn = root.querySelector('[data-knl-select-account]');
  assert(selectBtn, 'account picker must list Tiên so Admin can select her (data-knl-select-account)');
  click(window, selectBtn);
  const details = root.querySelector('[data-knl-advanced]');
  assert(details, '"Thiết lập nâng cao" <details> must be present after selecting an account');
  details.open = true;
  details.dispatchEvent(new window.Event('toggle'));
  const box = root.querySelector('[data-knl-adv-cap="' + capKey + '"]');
  assert(box, 'capability checkbox for "' + capKey + '" must exist inside Advanced');
  return box;
}

function saveButtonPosition(root) {
  const saveBtn = root.querySelector('[data-knl-save-grant]');
  const advanced = root.querySelector('[data-knl-advanced]');
  assert(saveBtn, 'a single Save CTA (data-knl-save-grant) must exist');
  assert(advanced, 'Advanced section must exist');
  // DOCUMENT_POSITION_FOLLOWING (4) nghĩa là advanced đứng SAU saveBtn trong DOM.
  const rel = saveBtn.compareDocumentPosition(advanced);
  return (rel & 4) ? 'save-before-advanced' : 'save-after-advanced';
}

async function clickSaveAndWait(window, saveBtn) {
  click(window, saveBtn);
  await new Promise(r => setTimeout(r, 30));
}

(async () => {
  // ===== 0. UX FIX BẮT BUỘC: 1 save boundary duy nhất, CTA nằm SAU Advanced =====
  {
    const { window, root } = await setupDom(tienGrant());
    const btn = root.querySelector('[data-knl-select-account]');
    click(window, btn);
    const saveButtons = root.querySelectorAll('[data-knl-save-grant]');
    assert.strictEqual(saveButtons.length, 1, 'form phải có ĐÚNG 1 nút Lưu (không có save riêng cho Advanced)');
    assert.strictEqual(saveButtonPosition(root), 'save-after-advanced', 'nút Lưu phải nằm SAU "6. Thiết lập nâng cao" trong DOM (cuối toàn bộ form), không còn ở trước như trước fix');
    const btnText = saveButtons[0].textContent.trim();
    assert.strictEqual(btnText, 'Lưu thay đổi', 'label nút Lưu cuối form phải là "Lưu thay đổi"');
    const cancelBtn = root.querySelector('[data-knl-cancel-grant]');
    assert(cancelBtn, 'phải có nút "Hủy" cạnh "Lưu thay đổi" ở cuối form');
    assert.strictEqual(cancelBtn.textContent.trim(), 'Hủy', 'label nút hủy phải là "Hủy"');
  }
  console.log('PASS 0: Form Phân quyền có ĐÚNG 1 save boundary "Hủy | Lưu thay đổi" nằm SAU "Thiết lập nâng cao", không còn CTA riêng phía trước Advanced');

  // ===== A-H. dashboard_view: draft state ngay khi tick -> Lưu cuối form -> reload -> F5 =====
  {
    const { window, root, savedCalls, getGrantState } = await setupDom(tienGrant()); // A. load grant dashboard_view=false
    const box = openAdvancedAndGetCheckbox(window, root, 'dashboard_view'); // B. mở Advanced
    assert.strictEqual(box.checked, false, 'A. checkbox phải load đúng trạng thái ban đầu dashboard_view=false');
    box.checked = true;
    box.dispatchEvent(new window.Event('change', { bubbles: true })); // C. tick dashboard_view=true
    const saveBtn = root.querySelector('[data-knl-save-grant]');
    await clickSaveAndWait(window, saveBtn); // E. bấm Lưu thay đổi cuối form
    assert.strictEqual(savedCalls.length, 1, 'Lưu phải gọi upsertKnlPermissionGrant đúng 1 lần');
    assert.strictEqual(savedCalls[0].capabilities.dashboard_view, true, 'D/E. payload gửi lên PHẢI mang dashboard_view=true — draft state lúc tick đã đúng là state Save đọc, không phải state tạm khác');
    assert.strictEqual(getGrantState().capabilities.dashboard_view, true, 'F. sau khi Lưu, "reload" (state phía server mock) phải phản ánh dashboard_view=true');
    const boxAfterSave = root.querySelector('[data-knl-adv-cap="dashboard_view"]');
    assert.strictEqual(boxAfterSave.checked, true, 'G. sau render lại (không F5), checkbox dashboard_view phải VẪN checked — đây chính xác là điểm PHF báo bị mất tick');

    // H. F5 thật: DOM/window hoàn toàn mới, chỉ còn dữ liệu đã persist ở "backend" (getGrantState()).
    const { window: window2, root: root2 } = await setupDom(getGrantState());
    const selectBtn2 = root2.querySelector('[data-knl-select-account]');
    click(window2, selectBtn2);
    const details2 = root2.querySelector('[data-knl-advanced]');
    details2.open = true; details2.dispatchEvent(new window2.Event('toggle'));
    const boxAfterReload = root2.querySelector('[data-knl-adv-cap="dashboard_view"]');
    assert.strictEqual(boxAfterReload.checked, true, 'H. F5 (DOM/window hoàn toàn mới, đọc lại từ dữ liệu đã lưu) -> dashboard_view VẪN true');
  }
  console.log('PASS A-H: dashboard_view — draft state ngay lúc tick = true, payload Lưu đúng, render lại vẫn checked, F5 vẫn true');

  // ===== Capability CŨ (income_view) trong cùng Advanced — baseline so sánh =====
  {
    const { window, root, savedCalls, getGrantState } = await setupDom(tienGrant({ capabilities: Object.assign({}, tienGrant().capabilities, { income_view: false }) }));
    const box = openAdvancedAndGetCheckbox(window, root, 'income_view');
    assert.strictEqual(box.checked, false, 'income_view load đúng trạng thái ban đầu false');
    box.checked = true;
    box.dispatchEvent(new window.Event('change', { bubbles: true }));
    const saveBtn = root.querySelector('[data-knl-save-grant]');
    await clickSaveAndWait(window, saveBtn);
    assert.strictEqual(savedCalls.length, 1);
    assert.strictEqual(savedCalls[0].capabilities.income_view, true, 'capability CŨ income_view cũng đi qua ĐÚNG cùng draft state (payload Lưu mang income_view=true)');
    const boxAfterSave = root.querySelector('[data-knl-adv-cap="income_view"]');
    assert.strictEqual(boxAfterSave.checked, true, 'income_view sau render lại vẫn checked — cùng hành vi với dashboard_view, chứng minh đây KHÔNG phải lỗi riêng của 1 capability nào');

    const { window: window2, root: root2 } = await setupDom(getGrantState());
    const selectBtn2 = root2.querySelector('[data-knl-select-account]');
    click(window2, selectBtn2);
    const details2 = root2.querySelector('[data-knl-advanced]');
    details2.open = true; details2.dispatchEvent(new window2.Event('toggle'));
    const boxAfterReload = root2.querySelector('[data-knl-adv-cap="income_view"]');
    assert.strictEqual(boxAfterReload.checked, true, 'income_view F5 (DOM mới) vẫn true');
  }
  console.log('PASS baseline income_view: cùng đường draft-state/save như dashboard_view, round-trip đúng qua UI thật (không riêng dashboard_view)');

  // ===== Không đổi permission contract khác khi chỉ tick dashboard_view =====
  {
    const original = tienGrant();
    const { window, root, savedCalls } = await setupDom(original);
    const box = openAdvancedAndGetCheckbox(window, root, 'dashboard_view');
    box.checked = true;
    box.dispatchEvent(new window.Event('change', { bubbles: true }));
    const saveBtn = root.querySelector('[data-knl-save-grant]');
    await clickSaveAndWait(window, saveBtn);
    const sent = savedCalls[0];
    assert.deepStrictEqual(sent.capabilities.incomeScope, original.capabilities.incomeScope, 'incomeScope không bị đụng khi chỉ tick dashboard_view');
    assert.deepStrictEqual(sent.peopleScope, original.peopleScope, 'peopleScope không bị đụng khi chỉ tick dashboard_view');
    assert.strictEqual(sent.presetCode, original.presetCode, 'preset không bị đổi khi chỉ tick dashboard_view');
    ['access_knl', 'view_people', 'income_view', 'propose', 'agree_proposal', 'approve', 'manage_framework', 'manage_permissions', 'view_proposals'].forEach(k => {
      assert.strictEqual(sent.capabilities[k], original.capabilities[k], 'capability "' + k + '" không bị đổi khi chỉ tick dashboard_view');
    });
  }
  console.log('PASS: chỉ tick dashboard_view KHÔNG làm thay đổi incomeScope/peopleScope/preset/các capability khác của Tiên');

  console.log('\nALL PASS');
})().catch(e => { console.error(e); process.exit(1); });
