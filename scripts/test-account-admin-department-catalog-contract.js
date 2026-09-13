'use strict';
/*
 * Regression: Account Admin "Tạo tài khoản" form contract for the canonical
 * department catalog + required Mã NV label.
 *
 * ROOT CAUSE (PROD): renderAccounts() calls loadAccountsFromServer(false)
 * WITHOUT awaiting it, then immediately builds accountForm() (and therefore
 * the #phfAcctSafeDept <select>) from whatever DEPARTMENT_CATALOG holds AT
 * THAT INSTANT — which is still [] on the very first render, since the
 * fetch hasn't resolved yet. refreshAccounts() (called once the fetch DOES
 * resolve) only patches #phfAcctSafeRows/#phfAcctSafeLogs/#phfSysacHud — it
 * never touches the create-account form, so the already-rendered empty
 * <select> is never refilled. Only a full re-render (leaving the screen and
 * coming back) accidentally "fixed" it, because DEPARTMENT_CATALOG was
 * already cached by then.
 *
 * This test loads the REAL file into jsdom, defers the fetch response by
 * one microtask (so the first synchronous render genuinely sees an empty
 * catalog, exactly like PROD), and asserts the <select> ends up correctly
 * populated once the response lands.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'phf-account-admin-safe.js'), 'utf8');

const CANONICAL_DEPARTMENTS = [
  { key: 'dept_ban_giam_doc', displayName: 'Ban giám đốc' },
  { key: 'dept_ban_hang', displayName: 'Bộ phận bán hàng' },
  { key: 'dept_ban_hang_online', displayName: 'Bộ phận bán hàng Online' },
  { key: 'dept_goi_qua_che_bien', displayName: 'Bộ phận Gói quà & Chế biến' },
  { key: 'dept_kho_van', displayName: 'Bộ phận kho vận' },
  { key: 'dept_quan_tri_tong_hop', displayName: 'Bộ phận Quản trị tổng hợp' },
  { key: 'dept_tai_chinh_ke_toan', displayName: 'Bộ phận Tài chính Kế toán' },
  { key: 'dept_thu_mua', displayName: 'Bộ phận thu mua' },
  { key: 'dept_truyen_thong_quang_cao', displayName: 'Bộ phận Truyền thông quảng cáo' }
];

async function withDom(run) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', url: 'http://localhost/admin/nhan-su/tai-khoan' });
  const { window } = dom;
  window.phfGetSessionRole = () => 'admin';
  window.phfGetCurrentUser = () => ({ role: 'admin' });
  window.phfAlert = async () => true;
  window.phfConfirm = async () => true;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.PHFAppShell = { activateHr() {} };
  dom.window.eval(SOURCE);
  try { await run(window, dom); } finally { window.close(); }
}

let passCount = 0, failCount = 0;
async function record(name, fn) {
  try { await fn(); console.log('  ✓ PASS -', name); passCount++; }
  catch (e) { console.error('  ✗ FAIL -', name, '\n       ', e && e.stack || e); failCount++; }
}

(async () => {
console.log('\n=== Account Admin form contract: Mã NV required label + department catalog hydration ===\n');

await record('1) "Mã NV" label shows the required asterisk for employee accounts', async () => {
  await withDom(async (window) => {
    // fetch never resolves in this test — we only need the initial synchronous render.
    window.fetch = () => new Promise(() => {});
    window.phfRenderAccountAdminSafe();
    const label = Array.from(window.document.querySelectorAll('label')).find(l => l.textContent.trim().startsWith('Mã NV'));
    assert.ok(label, 'phải tìm thấy label Mã NV');
    assert.ok(/\*/.test(label.innerHTML), 'label Mã NV phải hiển thị dấu * bắt buộc');
  });
});

await record('2) Department <select> is empty on the very first synchronous render (reproduces the PROD symptom before the fix would matter)', async () => {
  await withDom(async (window) => {
    let resolveFetch;
    window.fetch = () => new Promise((resolve) => { resolveFetch = resolve; });
    window.phfRenderAccountAdminSafe();
    const sel = window.document.getElementById('phfAcctSafeDept');
    assert.ok(sel, 'select Phòng ban phải tồn tại ngay từ render đầu tiên');
    assert.strictEqual(sel.options.length, 0, 'trước khi API trả lời, catalog phải đang rỗng (đúng bản chất bug — không phải giả định sai)');
    resolveFetch({ ok: true, json: async () => ({ ok: true, accounts: [], departmentCatalog: CANONICAL_DEPARTMENTS }) });
  });
});

await record('3) FIX: once the API response lands, the <select> is populated with exactly the 9 canonical departments, no free-text option', async () => {
  await withDom(async (window) => {
    window.fetch = () => Promise.resolve({ ok: true, json: async () => ({ ok: true, accounts: [], departmentCatalog: CANONICAL_DEPARTMENTS }) });
    window.phfRenderAccountAdminSafe();
    // Cho microtask của fetch/json()/.then chạy hết.
    await new Promise(r => setTimeout(r, 20));
    const sel = window.document.getElementById('phfAcctSafeDept');
    assert.ok(sel, 'select Phòng ban phải còn tồn tại');
    const optionTexts = Array.from(sel.options).map(o => o.textContent.trim());
    assert.strictEqual(optionTexts.length, 9, 'phải có đúng 9 lựa chọn: ' + JSON.stringify(optionTexts));
    CANONICAL_DEPARTMENTS.forEach(d => assert.ok(optionTexts.includes(d.displayName), 'thiếu phòng ban: ' + d.displayName));
    assert.ok(!optionTexts.some(t => /nhập mới/i.test(t)), 'KHÔNG được có lựa chọn "Nhập mới" (free text)');
  });
});

await record('4) Regression guard: system_admin account type still hides the employee-only fields (Mã NV included) unchanged', async () => {
  await withDom(async (window) => {
    window.fetch = () => Promise.resolve({ ok: true, json: async () => ({ ok: true, accounts: [], departmentCatalog: CANONICAL_DEPARTMENTS }) });
    window.phfRenderAccountAdminSafe();
    await new Promise(r => setTimeout(r, 20));
    const typeSelect = window.document.getElementById('phfAcctSafeType');
    assert.ok(typeSelect, 'select loại tài khoản phải tồn tại');
    typeSelect.value = 'system_admin';
    window.phfAcctToggleAccountType();
    const employeeOnlyFields = window.document.querySelectorAll('.phf-employee-only');
    assert.ok(employeeOnlyFields.length > 0);
    employeeOnlyFields.forEach(el => assert.strictEqual(el.style.display, 'none', 'các trường chỉ-dành-cho-nhân-viên (gồm Mã NV) phải bị ẩn khi chọn Tài khoản hệ thống'));
  });
});

console.log('\n=== KẾT QUẢ: ' + passCount + ' PASS, ' + failCount + ' FAIL ===\n');
process.exit(failCount ? 1 : 0);
})();
