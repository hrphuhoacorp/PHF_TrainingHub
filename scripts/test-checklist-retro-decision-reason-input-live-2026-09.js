'use strict';
/*
 * PHF Checklist — "Cập nhật Phiếu tháng <kỳ>" decision modal (checklistRetroDecisionState,
 * Phase 2B 2026-09-11) — REAL-DOM regression for the disabled-apply-button bug (2026-09-13).
 *
 * PROD incident: template ke-toan-doanh-thu-cnpt, kỳ 2026-09, PHF008. Modal opened with
 * headline "1 phiếu chưa có dữ liệu — an toàn để cập nhật.", Admin typed a >=10-char reason
 * into the "Lý do" field, but the "Áp dụng cho kỳ Tháng 09/2026" button stayed disabled and
 * no apply request was ever sent.
 *
 * Root cause: checklistRetroDecisionHtml() computes the button's `disabled` attribute from
 * checklistRetroDecisionState.reason at RENDER time only. Unlike the sibling "Áp dụng bản cập
 * nhật" modal (checklistTseActivateModalHtml / data-phfck-tse-activate-reason), which has a
 * matching document.addEventListener('input',...) branch that live-syncs state.reason and
 * toggles the confirm button's `.disabled` on every keystroke, this decision modal had NO such
 * branch. The typed text only ever reached checklistRetroDecisionState.reason inside the
 * apply-button's OWN click handler — but a `disabled` HTML button never dispatches `click` at
 * all, so state.reason could never be populated by user interaction: the button was disabled
 * from the moment it was born and could never become enabled again, no matter how long a
 * reason was typed.
 *
 * This test drives the REAL rendered DOM node exactly the way a browser does: mount the modal
 * via the actual checklistRetroDecisionRerender()/appendSubmodal() path, type into the actual
 * <input data-phfck-retro-decision-reason> node, dispatch a REAL 'input' Event on it (never
 * mutate JS state directly), and assert against the REAL button node's `.disabled` property —
 * not a re-rendered HTML string. This is the class of test that scripts/test-checklist-retro-
 * decision-ui-v1.js could not catch, because it only asserts on manually-rendered HTML after
 * manually mutating state (see its "after filling a valid reason..." case), never on what the
 * real DOM event wiring actually does with real user keystrokes.
 *
 *   node scripts/test-checklist-retro-decision-reason-input-live-2026-09.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const appPath = path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js');
const code = fs.readFileSync(appPath, 'utf8');

let failures = 0, passes = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else { passes++; console.log('PASS: ' + message); }
}
function tick(n) { return new Promise(resolve => setTimeout(resolve, n || 20)); }

// Expose just enough internal state to arrange the scenario without going through the full
// "Sửa Bảng tổng điểm" save/publish flow (already covered end-to-end elsewhere) — this file's
// job is narrowly the reason-input <-> disabled-button wiring for the decision modal itself.
const marker = '\n})();';
const idx = code.lastIndexOf(marker);
const expose = "\n  window.__retroDecisionLive={\n" +
  "    rerender:checklistRetroDecisionRerender,\n" +
  "    setState:function(v){checklistRetroDecisionState=v;},\n" +
  "    getState:function(){return checklistRetroDecisionState;}\n" +
  "  };\n";
const testCode = code.slice(0, idx) + expose + code.slice(idx);

async function buildDom() {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><div id="phfChecklistRoot"></div></body></html>',
    { url: 'http://localhost/admin/checklist/bang-tong-diem', runScripts: 'outside-only' }
  );
  const { window } = dom;
  window.phfGetSessionRole = () => 'admin';
  window.phfGetCurrentUser = () => ({ id: 'admin-1', employeeCode: 'PHF000', name: 'Admin' });
  window.phfGetAuthenticatedUser = window.phfGetCurrentUser;
  window.requestAnimationFrame = fn => setTimeout(fn, 0);
  window.requestIdleCallback = fn => setTimeout(fn, 0);
  window.scrollTo = () => {};
  window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
  window.eval(testCode);
  return dom;
}

async function main() {
  const dom = await buildDom();
  const { window } = dom;
  const api = window.__retroDecisionLive;

  // Same shape checklistRetroOfferCurrentPeriod builds for the GREEN tier (PHF008's case:
  // 1 form, no self/review data yet -> "an toàn để cập nhật").
  api.setState({
    templateId: 'ke-toan-doanh-thu-cnpt', periodMonth: '2026-09',
    cls: { green: { count: 1, codes: ['PHF008'] }, yellow: { count: 0 }, orange: { count: 0 } },
    applying: false, applyError: '', reason: ''
  });
  api.rerender();
  await tick();

  const root = window.document.getElementById('phfChecklistRoot');
  const modal = root.querySelector('.phfck-retro-decision-modal');
  check(!!modal, 'Real decision modal mounted via checklistRetroDecisionRerender()/appendSubmodal()');
  check(/1 phi.u ch.a c. d. li.u.*an to.n .. c.p nh.t/.test(modal.textContent.normalize('NFC')) || /an toàn để cập nhật/.test(modal.textContent),
    'GREEN headline "1 phiếu chưa có dữ liệu — an toàn để cập nhật." rendered (matches PROD incident copy)');

  const reasonInput = modal.querySelector('[data-phfck-retro-decision-reason]');
  const applyBtn = modal.querySelector('[data-phfck-retro-decision-apply]');
  check(!!reasonInput, 'Real reason <input> rendered');
  check(!!applyBtn, 'Real "Áp dụng cho kỳ..." button rendered');
  check(!!applyBtn && applyBtn.disabled === true, 'Button starts disabled (no reason typed yet) — matches PROD before the bug manifests');

  // THE REAL REPRODUCTION: type a real, sufficiently long reason into the real input and
  // dispatch a real 'input' event — exactly what a browser does on every keystroke. Never
  // mutate checklistRetroDecisionState.reason directly (that would just re-hide the bug).
  reasonInput.value = 'Đã kiểm tra kỹ, áp dụng cho kỳ hiện tại theo yêu cầu Ban Giám đốc';
  reasonInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();

  check(applyBtn.disabled === false,
    'BUG REPRODUCTION / FIX VERIFICATION: after typing a >=10-char reason and firing a real input event, the real button node is no longer disabled (PROD bug: stayed disabled forever)');
  check(api.getState().reason === reasonInput.value,
    'checklistRetroDecisionState.reason is synced from the real input as the admin types, not only inside the (unreachable-while-disabled) click handler');

  // Live hint text: shown while too short, cleared once long enough (UX requirement — explain
  // the disabling rule instead of a silent disabled button).
  reasonInput.value = 'quá ngắn';
  reasonInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  const hintShort = modal.querySelector('[data-phfck-retro-decision-reason-hint]');
  check(!!hintShort && /tối thiểu 10 ký tự/.test(hintShort.textContent), 'Short reason: live hint explains the 10-character minimum instead of leaving the button silently disabled');
  check(applyBtn.disabled === true, 'Button re-disables live when the reason is shortened back below 10 chars');

  reasonInput.value = 'Đủ dài để bật nút áp dụng lại lần nữa';
  reasonInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  check(applyBtn.disabled === false, 'Button re-enables live once the reason is long enough again');
  const hintLong = modal.querySelector('[data-phfck-retro-decision-reason-hint]');
  check(!!hintLong && hintLong.textContent.trim() === '', 'Hint clears once the reason satisfies the minimum length');

  // Now that the button is genuinely enabled, the real click must actually reach the handler
  // and fire the real backend action (proves the deadlock is broken end-to-end, not just the
  // disabled flag).
  let applyCalled = false;
  window.fetch = async (url, opts) => {
    const body = JSON.parse((opts && opts.body) || '{}');
    if (body.action === 'checklistRetroApplyCurrentPeriod') {
      applyCalled = true;
      check(body.input && body.input.reason === reasonInput.value, 'Real click sends the exact reason the admin typed');
      return { ok: true, status: 200, json: async () => ({ ok: true, appliedCount: 1, skippedCount: 0, items: [] }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  applyBtn.click();
  await tick(50);
  check(applyCalled, 'Real click on the now-enabled button reaches checklistRetroApplyCurrentPeriod (PROD bug: never reachable because the button never enabled)');

  console.log('\n=== Kết quả ===');
  console.log(passes + '/' + (passes + failures) + ' bước PASS.');
  if (failures) process.exitCode = 1;
}
main().catch(e => { console.error('LỖI KHÔNG MONG ĐỢI:', e); process.exitCode = 1; });
