'use strict';
/*
 * PHF Checklist — Apply-Timing V1 REAL-DOM-CLICK reproduction + FAIL-CLOSED hardening
 * (2026-09-12).
 *
 * PROD incident: Admin edited "Kế toán trưởng" criteria via /admin/checklist/mau ->
 * Quản lý tiêu chí, saw the confirmation screen (ĐANG ÁP DỤNG / SAU KHI LƯU / NGÀY HIỆU
 * LỰC / SỐ TIÊU CHÍ — this exact field set only exists in cePreviewHtml(), confirming the
 * Admin was in the Quản lý tiêu chí (ce*) flow, not the separate "Sửa Bảng tổng điểm" (tse*)
 * flow), clicked "Lưu & áp dụng", and the version published IMMEDIATELY with no Apply-Timing
 * choice ever shown — current-period forms (PHF071) were left on the old snapshot with zero
 * retroactive_apply_current_period_* history rows.
 *
 * Root cause: ceClassifyCurrentPeriod silently swallowed ANY classify failure into
 * retro=null, rendering identically to the legitimate "nothing to apply" case, and the
 * confirm button still published the version regardless.
 *
 * Fix under test: ceClassifyCurrentPeriod now always resolves p.retro to a non-null object
 * that distinguishes: (A) success + affected forms, (B) success + zero affected forms (a.k.a
 * scenario "C" below), (C) classify failed -> retro.classifyFailed=true, which now renders a
 * visible warning ("Chưa kiểm tra được ảnh hưởng lên Phiếu tháng...") in the SAME confirm
 * modal and BLOCKS the real "Lưu & áp dụng" button from publishing at all.
 *
 * Every step below is a REAL jsdom .click()/change dispatched at a REAL DOM node, handled by
 * the ACTUAL delegated document click/change listeners that run in PROD. ceSaveAndApply,
 * ceClassifyCurrentPeriod, cePublish and ceFinishApplyTiming are NEVER called directly by
 * this file.
 *
 *   node scripts/test-checklist-apply-timing-real-dom-click-v1.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const appPath = path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js');
const cssPath = path.resolve(__dirname, '..', 'assets/css/phf-checklist.css');
const code = fs.readFileSync(appPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

let failures = 0, passes = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else { passes++; console.log('PASS: ' + message); }
}
function tick(n) { return new Promise(resolve => setTimeout(resolve, n || 30)); }
function response(data) { return { ok: true, status: 200, json: async () => data }; }

const TPL = 'ke-toan-truong';
const KTT_ITEMS = [
  ['KTT-01', 'Kiem tra so quy hang ngay', 1],
  ['KTT-02', 'Doi chieu chung tu ke toan', 1],
  ['KTT-03', 'Bao cao thue dung han', 2],
  ['KTT-04', 'Kiem soat cong no', 1],
  ['KTT-05', 'Doi soat ngan hang', 1],
  ['KTT-06', 'Quan ly tai san co dinh', 1],
  ['KTT-07', 'Bao cao tai chinh thang', 1],
  ['KTT-08', 'Luu tru chung tu', 1]
];
const KTT_DEFINITION = {
  templateType: 'checklist_detail',
  groups: [{ code: 'G1', name: 'Nhom 1', children: [{ code: 'C1', name: 'Nhom con 1', items: KTT_ITEMS }] }],
  totalRows: [[1, 'CT-01', 'Tuan thu tieu chuan Checklist', 100, 'diem', 100, 'Khong', { type: 'checklist_total' }, 'CT-01']]
};
const KTT_ROW = {
  templateKey: TPL, name: 'Kế toán trưởng', groupName: 'Kế toán', hasChecklist: true,
  templateType: 'checklist_detail', source: 'Hệ thống', note: '', status: 'active',
  version: 'KTT 2.8', effectiveDate: '2026-09-01', updatedAt: '2026-09-01T00:00:00.000Z',
  versions: [{ version: 'KTT 2.8', effectiveDate: '2026-09-01' }],
  definition: KTT_DEFINITION
};

async function buildDom() {
  const dom = new JSDOM(
    '<!doctype html><html><head><style>' + css + '</style></head><body><div id="phfChecklistRoot"></div></body></html>',
    { url: 'http://localhost/admin/checklist/mau', runScripts: 'outside-only' }
  );
  const { window } = dom;
  window.phfGetSessionRole = () => 'admin';
  window.phfGetCurrentUser = () => ({ id: 'admin-1', employeeCode: 'PHF000', name: 'Admin' });
  window.phfGetAuthenticatedUser = window.phfGetCurrentUser;
  window.requestAnimationFrame = fn => setTimeout(fn, 0);
  window.requestIdleCallback = fn => setTimeout(fn, 0);
  window.scrollTo = () => {};
  window.__phfLocalData = { checklistTemplatesReady: true, checklistTemplates: [KTT_ROW] };
  window.eval(code);
  return dom;
}

// classifyMode: 'success' (1 GREEN form, offerTiming true) | 'fail' (classify request rejects
// -> must trigger fail-closed) | 'zero' (classify succeeds but 0 affected forms)
function makeFetch(calls, classifyMode) {
  return async (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    if (method === 'GET' && String(url).indexOf('checklistTemplates=1') >= 0) {
      calls.push({ action: '__GET_checklistTemplates__' });
      return response({ ok: true, checklistTemplatesReady: true, checklistTemplates: [KTT_ROW] });
    }
    let body = {};
    try { body = JSON.parse((opts && opts.body) || '{}'); } catch (_) {}
    const action = body.action;
    calls.push({ action, input: body.input || body });
    if (action === 'saveChecklistTemplate') {
      const tpl = body.template || {};
      return response({ ok: true, template: Object.assign({}, KTT_ROW, { version: tpl.version, effectiveDate: tpl.effectiveDate, definition: tpl.definition }) });
    }
    if (action === 'checklistRetroClassifyCurrentPeriod') {
      if (classifyMode === 'fail') throw new Error('mat ket noi mang (gia lap)');
      if (classifyMode === 'zero') {
        return response({ ok: true, templateId: TPL, periodMonth: body.input.periodMonth, periodLocked: false, totalAffected: 0,
          green: { count: 0, formIds: [], codes: [] }, yellow: { count: 0, formIds: [], codes: [] }, orange: { count: 0, formIds: [], codes: [] } });
      }
      return response({ ok: true, templateId: TPL, periodMonth: body.input.periodMonth, periodLocked: false, totalAffected: 1,
        green: { count: 1, formIds: ['f-phf071'], codes: ['PHF071'] }, yellow: { count: 0, formIds: [], codes: [] }, orange: { count: 0, formIds: [], codes: [] } });
    }
    if (action === 'checklistRetroApplyCurrentPeriod') {
      return response({ ok: true, templateId: TPL, periodMonth: body.input.periodMonth, mode: 'all', appliedCount: 1, skippedCount: 0, items: [{ formId: 'f-phf071', employeeCode: 'PHF071', outcome: 'applied' }] });
    }
    return response({ ok: true });
  };
}

async function driveToConfirmModal(window, calls, classifyMode) {
  window.fetch = makeFetch(calls, classifyMode);
  await window.phfRenderChecklist('/admin/checklist/mau');
  await tick(30);
  const root = window.document.getElementById('phfChecklistRoot');

  const openBtn = root.querySelector('[data-phfck-template-detail="' + TPL + '"]');
  check(!!openBtn, 'Real "Quản lý"/"Xem" row-action button exists for Kế toán trưởng');
  openBtn.click();
  await tick(30);

  const manageBtn = root.querySelector('[data-phfck-manage-criteria]');
  check(!!manageBtn, 'Real "☰ Quản lý tiêu chí" button exists after selecting the template');
  manageBtn.click();
  await tick(30);

  // Edit an EXISTING criterion via the real "Sửa" row UI (not the add-new-criterion form).
  const editBtn = root.querySelector('[data-phfck-ce-edit]');
  check(!!editBtn, 'Real "Sửa" button exists on a criterion row');
  const code = editBtn.getAttribute('data-phfck-ce-edit');
  editBtn.click();
  await tick(10);
  const row = root.querySelector('[data-phfck-ce-row="' + code + '"]');
  const contentField = row.querySelector('[data-phfck-ce-edit-content]');
  check(!!contentField, 'Real edit-content textarea rendered for the row being edited');
  contentField.value = 'Kiem tra so quy hang ngay (da sua loi chinh ta)';
  const saveEditBtn = row.querySelector('[data-phfck-ce-save-edit="' + code + '"]');
  check(!!saveEditBtn, 'Real "Lưu" (save-edit) button exists on the editing row');
  saveEditBtn.click();
  await tick(10);

  const reasonField = root.querySelector('[data-phfck-ce-reason]');
  check(!!reasonField, 'Reason textarea rendered');
  reasonField.value = 'Sua loi chinh ta trong noi dung tieu chi KTT-01';

  const previewBtn = root.querySelector('[data-phfck-ce-preview]');
  check(!!previewBtn, 'Real "Lưu & áp dụng" button (criteria editor) exists');
  const saveCallsBefore = calls.filter(c => c.action === 'saveChecklistTemplate').length;
  previewBtn.click();
  await tick(50);
  check(calls.filter(c => c.action === 'saveChecklistTemplate').length === saveCallsBefore,
    'Clicking "Lưu & áp dụng" in the criteria editor does NOT publish the version yet (classify-before-save)');

  const confirmModal = root.querySelector('.phfck-direct-preview');
  check(!!confirmModal, 'Confirmation modal (cePreviewHtml) rendered with ĐANG ÁP DỤNG/SAU KHI LƯU/SỐ TIÊU CHÍ fields');
  if (confirmModal) {
    const summaryText = confirmModal.textContent;
    check(/ĐANG ÁP DỤNG/.test(summaryText) && /SAU KHI LƯU/.test(summaryText) && /SỐ TIÊU CHÍ/.test(summaryText),
      'Confirmation modal shows the exact PROD-reported field labels (ĐANG ÁP DỤNG/SAU KHI LƯU/SỐ TIÊU CHÍ)');
  }
  return root;
}

async function main() {
  // -----------------------------------------------------------------------
  // SCENARIO A — classify succeeds, 1 GREEN form affected. Real timing-choice radios must
  // render, default "Áp dụng ngay" selected, publish must wait for the confirm click, and
  // Apply-now must publish + call the real retroactive-apply backend action.
  // (Also serves as the "Apply now" regression case.)
  // -----------------------------------------------------------------------
  {
    const dom = await buildDom();
    const calls = [];
    const root = await driveToConfirmModal(dom.window, calls, 'success');

    const confirmModal = root.querySelector('.phfck-direct-preview');
    const timingRadios = confirmModal.querySelectorAll('input[data-phfck-ce-timing-choice]');
    check(timingRadios.length === 2, 'SCENARIO A (classify OK): both real timing-choice radios ("now"/"next") are rendered');
    const nowRadio = confirmModal.querySelector('input[data-phfck-ce-timing-choice][value="now"]');
    check(!!nowRadio && nowRadio.checked, 'SCENARIO A: "Áp dụng ngay cho kỳ hiện tại" is the default selection');
    check(!calls.some(c => c.action === 'saveChecklistTemplate'), 'SCENARIO A: version NOT saved yet before the Admin confirms the timing choice');

    const applyBtn = confirmModal.querySelector('[data-phfck-apply-ce]');
    check(!!applyBtn && !applyBtn.disabled, 'Real confirm-modal "Lưu & áp dụng" button (data-phfck-apply-ce) exists and is enabled');
    applyBtn.click();
    await tick(80);

    check(calls.some(c => c.action === 'saveChecklistTemplate'), 'SCENARIO A / APPLY-NOW REGRESSION: version WAS published after confirming');
    check(calls.some(c => c.action === 'checklistRetroApplyCurrentPeriod'), 'SCENARIO A / APPLY-NOW REGRESSION: retroactive apply WAS called through the real click path, reaching the real backend action');
  }

  // -----------------------------------------------------------------------
  // SCENARIO D — "Chỉ áp dụng từ kỳ tiếp theo" (next period), driven via a real radio click +
  // change event on the actual rendered input, not by mutating state directly.
  // -----------------------------------------------------------------------
  {
    const dom = await buildDom();
    const calls = [];
    const root = await driveToConfirmModal(dom.window, calls, 'success');
    const confirmModal = root.querySelector('.phfck-direct-preview');
    const nextRadio = confirmModal.querySelector('input[data-phfck-ce-timing-choice][value="next"]');
    check(!!nextRadio, 'NEXT-PERIOD REGRESSION: real "Chỉ áp dụng từ kỳ tiếp theo" radio exists');
    nextRadio.checked = true;
    nextRadio.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await tick(20);

    const applyBtn = root.querySelector('[data-phfck-apply-ce]');
    check(!!applyBtn && !applyBtn.disabled, 'NEXT-PERIOD REGRESSION: confirm button still enabled after switching to "next"');
    applyBtn.click();
    await tick(80);

    check(calls.some(c => c.action === 'saveChecklistTemplate'), 'NEXT-PERIOD REGRESSION: version WAS published');
    check(!calls.some(c => c.action === 'checklistRetroApplyCurrentPeriod'), 'NEXT-PERIOD REGRESSION: retroactive apply backend action NOT called when "next period" is chosen');
  }

  // -----------------------------------------------------------------------
  // SCENARIO B — classify FAILS (network/transient error). FAIL-CLOSED must kick in: a clear
  // warning is shown in the SAME confirm modal, the button is blocked, and publishing must
  // NOT happen at all — no cePublish call, no version, no retro-apply call.
  // -----------------------------------------------------------------------
  {
    const dom = await buildDom();
    const calls = [];
    const root = await driveToConfirmModal(dom.window, calls, 'fail');
    const confirmModal = root.querySelector('.phfck-direct-preview');

    const timingRadios = confirmModal.querySelectorAll('input[data-phfck-ce-timing-choice]');
    check(timingRadios.length === 0, 'SCENARIO B (classify FAILS): no timing-choice radios rendered (this is NOT the "nothing to apply" case)');
    const warningText = confirmModal.textContent;
    check(/Chưa kiểm tra được ảnh hưởng lên Phiếu tháng/.test(warningText) && /Vui lòng thử lại/.test(warningText),
      'SCENARIO B: the real rendered confirm modal shows the mandatory warning text: ' + JSON.stringify(warningText.slice(0, 400)));

    const applyBtn = confirmModal.querySelector('[data-phfck-apply-ce]');
    check(!!applyBtn, 'Real confirm-modal "Lưu & áp dụng" button still exists');
    check(!!applyBtn && applyBtn.disabled, 'SCENARIO B: the real button is DISABLED (fail-closed) — an Admin cannot publish through the normal click path');

    applyBtn.click(); // native semantics: .click() on a disabled button is a no-op
    await tick(80);
    check(!calls.some(c => c.action === 'saveChecklistTemplate'), 'SCENARIO B: version NOT published — clicking the disabled button published nothing');
    check(!calls.some(c => c.action === 'checklistRetroApplyCurrentPeriod'), 'SCENARIO B: retroactive apply backend action NOT called');

    // Defense-in-depth: even if the disabled attribute were ever bypassed (e.g. a stale DOM
    // reference), the handler itself must still refuse to publish. Force the click through by
    // clearing the disabled flag on the real node, then dispatch a real click event again.
    applyBtn.disabled = false;
    applyBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await tick(80);
    check(!calls.some(c => c.action === 'saveChecklistTemplate'), 'SCENARIO B (defense-in-depth): even after forcibly re-enabling the button and re-dispatching a real click, the handler itself still refuses to call saveChecklistTemplate');
    check(!calls.some(c => c.action === 'checklistRetroApplyCurrentPeriod'), 'SCENARIO B (defense-in-depth): retroactive apply still never called');
  }

  // -----------------------------------------------------------------------
  // SCENARIO C — classify succeeds with ZERO affected current-period forms. This is the
  // legitimate "nothing to apply" case and must remain unaffected by the fail-closed change:
  // publish proceeds normally, no timing choice is required.
  // -----------------------------------------------------------------------
  {
    const dom = await buildDom();
    const calls = [];
    const root = await driveToConfirmModal(dom.window, calls, 'zero');
    const confirmModal = root.querySelector('.phfck-direct-preview');

    const timingRadios = confirmModal.querySelectorAll('input[data-phfck-ce-timing-choice]');
    check(timingRadios.length === 0, 'SCENARIO C (classify OK, 0 affected): no timing-choice radios rendered — nothing to choose between');
    check(!/Chưa kiểm tra được ảnh hưởng/.test(confirmModal.textContent), 'SCENARIO C: NO fail-closed warning shown — this is a legitimate empty result, not a failure');

    const applyBtn = confirmModal.querySelector('[data-phfck-apply-ce]');
    check(!!applyBtn && !applyBtn.disabled, 'SCENARIO C: confirm button is enabled — publishing is allowed with zero affected forms');
    applyBtn.click();
    await tick(80);

    check(calls.some(c => c.action === 'saveChecklistTemplate'), 'SCENARIO C: version publishes normally');
    check(!calls.some(c => c.action === 'checklistRetroApplyCurrentPeriod'), 'SCENARIO C: retroactive apply not called — genuinely nothing to apply');
  }

  console.log('\n=== Kết quả ===');
  console.log(passes + '/' + (passes + failures) + ' bước PASS.');
  if (failures) process.exitCode = 1;
}
main().catch(e => { console.error('LỖI KHÔNG MONG ĐỢI:', e); process.exitCode = 1; });
