'use strict';
/*
 * Regression — Checklist Criterion Simplify V1 — Phase 2B frontend orchestration.
 *
 * Covers the "check -> warn -> decide" UX added to assets/js/checklist/phf-checklist-app.js:
 * checklistRetroOfferCurrentPeriod() (calls checklistRetroClassifyCurrentPeriod, decides
 * whether to open the new GREEN/YELLOW/ORANGE decision modal) and checklistRetroDecisionHtml()
 * (renders the modal's copy/choices for each tier).
 *
 * Same convention as scripts/test-checklist-criterion-admin-2026-09.js: real frontend source
 * loaded in a vm sandbox (no jsdom needed for this orchestration-level test — no click
 * simulation), with a small set of extra names exposed on window.__retroTest right before the
 * closing IIFE. Zero network I/O — fetch is a local stub answering exactly the action this
 * phase adds.
 *
 *   node scripts/test-checklist-retro-decision-ui-v1.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');

let failures = 0, passed = 0;
async function rec(name, fn) {
  try { await fn(); console.log('PASS: ' + name); passed++; }
  catch (e) { failures++; console.error('FAIL: ' + name + '\n  ' + (e && e.message ? e.message : e)); }
}

const filePath = 'assets/js/checklist/phf-checklist-app.js';
const src = fs.readFileSync(path.join(root, filePath), 'utf8');
const marker = '\n})();';
const idx = src.lastIndexOf(marker);
const expose = "\n  window.__retroTest={\n" +
  "    offer:checklistRetroOfferCurrentPeriod, html:checklistRetroDecisionHtml,\n" +
  "    getState:function(){return checklistRetroDecisionState;}, setState:function(v){checklistRetroDecisionState=v;}\n" +
  "  };\n";
const testSrc = src.slice(0, idx) + expose + src.slice(idx);
const compiled = new vm.Script(testSrc, { filename: filePath });

function makeLocalStorage() { const data = {}; return { getItem: k => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; } }; }
let lastFetchBody = null, fetchResponder = async () => ({ ok: true });
function makeSandbox() {
  const noop = function () {};
  const sandbox = {};
  sandbox.window = sandbox; sandbox.console = console;
  sandbox.addEventListener = noop; sandbox.removeEventListener = noop; sandbox.dispatchEvent = noop;
  sandbox.PHF_BUILD_INFO = { version: 'test', fingerprint: 'test' };
  sandbox.document = {
    documentElement: { setAttribute: noop, getAttribute: () => null }, addEventListener: noop, removeEventListener: noop,
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    createElement: () => ({ style: {}, setAttribute: noop, addEventListener: noop, classList: { add: noop, remove: noop } }),
    body: { classList: { add: noop, remove: noop } }, readyState: 'complete'
  };
  sandbox.location = { pathname: '/admin/checklist/mau-checklist', search: '', hash: '', origin: 'http://localhost' };
  sandbox.history = { pushState: noop, replaceState: noop, state: null };
  sandbox.localStorage = makeLocalStorage(); sandbox.sessionStorage = makeLocalStorage();
  sandbox.navigator = { userAgent: 'node-test' };
  sandbox.matchMedia = null;
  sandbox.MutationObserver = function () { return { observe: noop, disconnect: noop }; };
  sandbox.fetch = async (url, opts) => {
    lastFetchBody = JSON.parse((opts && opts.body) || '{}');
    return fetchResponder(lastFetchBody);
  };
  sandbox.URL = URL; sandbox.setTimeout = setTimeout; sandbox.clearTimeout = clearTimeout;
  sandbox.requestAnimationFrame = fn => setTimeout(fn, 0);
  sandbox.CSS = { escape: v => String(v) };
  sandbox.__phfLocalData = null;
  const ctx = vm.createContext(sandbox);
  compiled.runInContext(ctx);
  return ctx.window;
}
function ok(cls) { return async () => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, cls) }); }

async function main() {
  await rec('classify returns totalAffected 0 -> offer resolves false, no decision state opened, no modal to render', async () => {
    const win = makeSandbox();
    fetchResponder = ok({ templateId: 'ktt-test', periodMonth: '2026-03', periodLocked: false, totalAffected: 0, green: { count: 0 }, yellow: { count: 0 }, orange: { count: 0 } });
    win.__retroTest.setState(null);
    const offered = await win.__retroTest.offer(null, 'ktt-test');
    assert.strictEqual(offered, false);
    assert.strictEqual(win.__retroTest.getState(), null);
    assert.strictEqual(lastFetchBody.action, 'checklistRetroClassifyCurrentPeriod');
    assert.strictEqual(lastFetchBody.input.templateId, 'ktt-test');
    assert.ok(/^\d{4}-\d{2}$/.test(lastFetchBody.input.periodMonth), 'periodMonth sent as YYYY-MM (current month)');
  });

  await rec('periodLocked:true -> offer resolves false regardless of counts (hard stop preserved)', async () => {
    const win = makeSandbox();
    fetchResponder = ok({ periodLocked: true, totalAffected: 0, green: { count: 0 }, yellow: { count: 0 }, orange: { count: 0 } });
    const offered = await win.__retroTest.offer(null, 'ktt-test');
    assert.strictEqual(offered, false);
    assert.strictEqual(win.__retroTest.getState(), null);
  });

  await rec('GREEN tier: offer resolves true, modal copy says "an toàn để cập nhật", default choice is next-sync-only, apply button mode=safe', async () => {
    const win = makeSandbox();
    fetchResponder = ok({ templateId: 'ktt-test', periodMonth: '2026-03', periodLocked: false, totalAffected: 3, green: { count: 3, codes: ['E1', 'E2', 'E3'] }, yellow: { count: 0 }, orange: { count: 0 } });
    const offered = await win.__retroTest.offer(null, 'ktt-test');
    assert.strictEqual(offered, true);
    const state = win.__retroTest.getState();
    assert.ok(state, 'decision state opened');
    const html = win.__retroTest.html();
    assert.ok(html.includes('3 phiếu chưa có dữ liệu'), 'GREEN headline mentions the count');
    assert.ok(html.includes('an toàn để cập nhật'), 'GREEN plain-language copy present');
    assert.ok(html.includes('Chỉ áp dụng cho kỳ đồng bộ tiếp theo'), 'safe default choice present');
    assert.ok(html.includes('data-phfck-retro-decision-apply="safe"'), 'apply action wired to mode=safe for GREEN');
    assert.ok(!/version|snapshot|RPC|kích hoạt/i.test(html), 'no version/snapshot/RPC/activation terminology leaks into GREEN copy');
  });

  await rec('YELLOW tier: copy warns about redo self-evaluation, apply mode=reset, no default-apply (reason required, disabled until filled)', async () => {
    const win = makeSandbox();
    fetchResponder = ok({ templateId: 'ktt-test', periodMonth: '2026-03', periodLocked: false, totalAffected: 2, green: { count: 0 }, yellow: { count: 2, codes: ['E1', 'E2'] }, orange: { count: 0 } });
    await win.__retroTest.offer(null, 'ktt-test');
    const html = win.__retroTest.html();
    assert.ok(html.includes('2 nhân viên đã tự đánh giá theo mẫu cũ'), 'YELLOW headline mentions the count');
    assert.ok(html.includes('cần đánh giá lại'), 'YELLOW copy warns about redo');
    assert.ok(html.includes('data-phfck-retro-decision-apply="reset"'), 'apply action wired to mode=reset for YELLOW');
    assert.ok(html.includes('disabled') && html.includes('data-phfck-retro-decision-apply'), 'apply button starts disabled until a reason is entered (no default-apply for YELLOW)');
    assert.ok(!/version|snapshot|RPC|kích hoạt/i.test(html), 'no version/snapshot/RPC/activation terminology leaks into YELLOW copy');
  });

  await rec('mixed YELLOW+ORANGE: strongest (ORANGE) warning shown, counts reflect BOTH tiers, apply still mode=reset', async () => {
    const win = makeSandbox();
    fetchResponder = ok({ templateId: 'ktt-test', periodMonth: '2026-03', periodLocked: false, totalAffected: 5, green: { count: 0 }, yellow: { count: 2, codes: ['E1', 'E2'] }, orange: { count: 3, codes: ['E3', 'E4', 'E5'] } });
    await win.__retroTest.offer(null, 'ktt-test');
    const html = win.__retroTest.html();
    assert.ok(html.includes('2 phiếu đã tự đánh giá, 3 phiếu đã thẩm định'), 'mixed counts shown together (both tiers reflected, not just the strongest)');
    assert.ok(html.includes('làm lại đánh giá/thẩm định'), 'ORANGE-tier stronger warning language present');
    assert.ok(html.includes('data-phfck-retro-decision-apply="reset"'));
  });

  await rec('after filling a valid reason (>=10 chars), the apply button is no longer disabled', async () => {
    const win = makeSandbox();
    fetchResponder = ok({ templateId: 'ktt-test', periodMonth: '2026-03', periodLocked: false, totalAffected: 1, green: { count: 1, codes: ['E1'] }, yellow: { count: 0 }, orange: { count: 0 } });
    await win.__retroTest.offer(null, 'ktt-test');
    const state = win.__retroTest.getState();
    state.reason = 'Cập nhật tiêu chí quý 3 theo quyết định Ban Giám đốc';
    const html = win.__retroTest.html();
    const btnMatch = html.match(/<button type="button" class="[^"]*" [^>]*data-phfck-retro-decision-apply="safe"[^>]*>/);
    assert.ok(btnMatch, 'apply button found');
    assert.ok(!/disabled/.test(btnMatch[0]), 'apply button enabled once reason is >=10 chars');
  });

  await rec('a fetch/permission error during classify never throws — offer resolves false (fails safe, save already completed)', async () => {
    const win = makeSandbox();
    fetchResponder = async () => { throw new Error('network down'); };
    const offered = await win.__retroTest.offer(null, 'ktt-test');
    assert.strictEqual(offered, false);
  });

  // -------------------------------------------------------------------
  // Structural — the trigger points call checklistRetroOfferCurrentPeriod, and the
  // old post-publish wizard modal is only ever shown when NOT offered (no double-modal,
  // no automatic silent apply anywhere in either "Lưu & áp dụng" success path).
  // -------------------------------------------------------------------
  await rec('structural: cePublish success handler calls checklistRetroOfferCurrentPeriod (Criterion Admin gets the same decision point)', () => {
    const applyCeBlock = src.slice(src.indexOf('var applyCe=e.target.closest'), src.indexOf('var editCriterion=e.target.closest'));
    assert.ok(/await cePublish\(checklistCeState\)/.test(applyCeBlock));
    assert.ok(/checklistRetroOfferCurrentPeriod\(root,appliedCe\.templateId\)/.test(applyCeBlock), 'applyCe handler offers the current-period decision after a successful publish');
  });
  await rec('structural: tseConfirmSaveAndApply calls checklistRetroOfferCurrentPeriod; checklistTsePostPublishHtml only shown when NOT offered', () => {
    const fnStart = src.indexOf('function tseConfirmSaveAndApply');
    const fnBody = src.slice(fnStart, fnStart + 3200);
    assert.ok(/checklistRetroOfferCurrentPeriod\(root,state\.templateId\)/.test(fnBody));
    assert.ok(/if\(!offered\)appendSubmodal\(root,checklistTsePostPublishHtml\(\)\)/.test(fnBody), 'old wizard-offer modal only appended when the new decision was NOT offered (no double-modal)');
  });
  await rec('structural: normal save never calls the APPLY action directly — only the CLASSIFY action; the apply action name only appears inside the new decision-modal click handler', () => {
    const applyActionOccurrences = (src.match(/checklistRetroApplyCurrentPeriod/g) || []).length;
    // Exactly one call site: inside the retro-decision-apply click handler (explicit admin action).
    assert.strictEqual(applyActionOccurrences, 1, 'checklistRetroApplyCurrentPeriod referenced exactly once in the whole file — only from the explicit apply-button click handler, never from a save/publish/sync path');
    const idx2 = src.indexOf('checklistRetroApplyCurrentPeriod');
    const context = src.slice(Math.max(0, idx2 - 400), idx2 + 50);
    assert.ok(/data-phfck-retro-decision-apply/.test(context), 'the one call site is inside the explicit apply-button handler');
  });

  console.log('\n' + passed + ' PASS, ' + failures + ' FAIL');
  if (failures > 0) process.exit(1);
}
main().catch(err => { console.error('CRASH', err); process.exit(1); });
