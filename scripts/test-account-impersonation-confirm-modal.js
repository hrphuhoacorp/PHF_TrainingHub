'use strict';
/*
 * PROD bug fix verification — Account Impersonation confirm modal buttons.
 * Root cause: phfImpersonateStart() called the shared phfConfirm(message,
 * title, tone, okText) helper with a 4th arg meant to be a CANCEL label, but
 * that position is okText, and phfConfirm always hardcodes cancelText to
 * "Quay lại" — so the dialog rendered "Quay lại" / "Hủy" instead of a real
 * confirm button. Fixed by calling phfDialog(...) directly with explicit
 * {okText, cancelText}.
 *
 * This is a pure DOM/string-label bug — no server involved — so this test
 * loads the real file into jsdom and asserts on the rendered button text and
 * click behavior, instead of hitting a running server.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'phf-account-admin-safe.js'), 'utf8');

async function withDom(run) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const { window } = dom;
  window.fetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
  dom.window.eval(SOURCE);
  try { await run(window, dom); } finally { window.close(); }
}

let passCount = 0, failCount = 0;
async function record(name, fn) {
  try { await fn(); console.log('  PASS -', name); passCount++; }
  catch (e) { console.error('  FAIL -', name, '\n       ', e && e.stack || e); failCount++; }
}

(async () => {
  await record('1) Modal renders exactly 2 buttons: primary "Bắt đầu giả lập" + cancel "Hủy"', async () => {
    await withDom(async (window) => {
      window.phfImpersonateStart('acct-test-id', 'Nguyễn Văn A');
      await new Promise(r => setTimeout(r, 20));
      const modal = window.document.getElementById('phfSystemModal');
      assert.ok(modal, 'modal phải được render');
      const buttons = Array.from(modal.querySelectorAll('.phf-modal-actions button'));
      assert.strictEqual(buttons.length, 2, 'phải có đúng 2 nút');
      const texts = buttons.map(b => b.textContent.trim());
      assert.ok(texts.includes('Bắt đầu giả lập'), 'phải có nút "Bắt đầu giả lập": ' + JSON.stringify(texts));
      assert.ok(texts.includes('Hủy'), 'phải có nút "Hủy": ' + JSON.stringify(texts));
      assert.ok(!texts.includes('Quay lại'), 'KHÔNG được còn nút "Quay lại": ' + JSON.stringify(texts));
      const primary = modal.querySelector('.phf-modal-btn.primary');
      assert.strictEqual(primary.textContent.trim(), 'Bắt đầu giả lập', 'nút primary phải là "Bắt đầu giả lập"');
      // jsdom's runScripts:"outside-only" does not execute inline onclick=""
      // handler attributes, so verify wiring statically here; tests 2/3 below
      // invoke window.closePhfModal(...) directly to exercise the exact same
      // function those onclick attributes call, which is what a real click
      // triggers in a browser.
      assert.strictEqual(primary.getAttribute('onclick'), 'closePhfModal(true)');
      const cancelBtn = buttons.find(b => b.textContent.trim() === 'Hủy');
      assert.strictEqual(cancelBtn.getAttribute('onclick'), 'closePhfModal(false)');
    });
  });

  await record('2) Bấm "Bắt đầu giả lập" -> gọi POST /api/auth/accounts action=impersonate-start', async () => {
    await withDom(async (window) => {
      let capturedUrl = null, capturedBody = null;
      window.fetch = async (url, opts) => {
        capturedUrl = url; capturedBody = opts && opts.body ? JSON.parse(opts.body) : null;
        return { ok: true, json: async () => ({ ok: true, impersonating: true, account: { role: 'learner' } }) };
      };
      window.phfImpersonateStart('acct-test-id', 'Nguyễn Văn A');
      await new Promise(r => setTimeout(r, 20));
      assert.ok(window.document.getElementById('phfSystemModal'), 'modal phải đang mở trước khi bấm');
      window.closePhfModal(true); // = onclick của nút primary "Bắt đầu giả lập"
      await new Promise(r => setTimeout(r, 20));
      assert.ok(!window.document.getElementById('phfSystemModal'), 'popup phải đóng sau khi xác nhận');
      assert.strictEqual(capturedUrl, '/api/auth/accounts');
      assert.strictEqual(capturedBody.action, 'impersonate-start');
      assert.strictEqual(capturedBody.accountId, 'acct-test-id');
    });
  });

  await record('3) Bấm "Hủy" -> đóng popup, KHÔNG gọi fetch (không tạo impersonation)', async () => {
    await withDom(async (window) => {
      let fetchCalled = false;
      window.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({ ok: true }) }; };
      window.phfImpersonateStart('acct-test-id', 'Nguyễn Văn A');
      await new Promise(r => setTimeout(r, 20));
      assert.ok(window.document.getElementById('phfSystemModal'), 'modal phải đang mở trước khi bấm');
      window.closePhfModal(false); // = onclick của nút "Hủy"
      await new Promise(r => setTimeout(r, 20));
      assert.ok(!window.document.getElementById('phfSystemModal'), 'popup phải đóng sau khi bấm Hủy');
      assert.strictEqual(fetchCalled, false, 'không được gọi fetch khi Hủy');
    });
  });

  console.log(`\n${passCount} PASS, ${failCount} FAIL`);
  process.exit(failCount ? 1 : 0);
})().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1); });
