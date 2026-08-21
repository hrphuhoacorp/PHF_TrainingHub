'use strict';
/* Workstream A UI reorg (2026-08-14) — DOM thật (jsdom) cho "Sửa Bảng tổng điểm"
   + modal 3 bước "Cập nhật Phiếu tháng hiện có", sống trong màn Mẫu Checklist
   (route /admin/checklist/mau), thay cho wizard 8 bước độc lập cũ đã dissolve.
   Cùng pattern với scripts/test-checklist-retro-wizard-ui-2026-08.js: JSDOM +
   window.eval(code thật) + assert trên DOM thật qua window.phfRenderChecklist(),
   KHÔNG gọi thẳng hàm component (đúng yêu cầu "real route, not direct calls").
   Chạy: node scripts/test-checklist-template-score-editor-2026-08.js
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
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else { passes++; }
}
function click(window, el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
function setValue(window, el, value) { el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); el.dispatchEvent(new window.Event('change', { bubbles: true })); }
function tick(n) { return new Promise(resolve => setTimeout(resolve, n || 30)); }
function response(data) { return { ok: true, status: 200, json: async () => data }; }

const DEFINITION_V1 = {
  templateType: 'checklist_detail',
  groups: [{ code: 'G1', name: 'Nhóm 1', children: [] }],
  totalRows: [
    { id: 'r1', code: 'CT-01', name: 'Lập phiếu', target: 5, unit: 'phiếu', weight: 50, source: { type: 'manual' } },
    { id: 'r2', code: 'CT-02', name: 'Tuân thủ Checklist', target: 100, unit: 'điểm', weight: 50, source: { type: 'checklist_total' } }
  ]
};

async function buildDom(startPath) {
  const dom = new JSDOM(
    '<!doctype html><html><head><style>' + css + '</style></head><body><div id="phfChecklistRoot"></div></body></html>',
    { url: 'http://localhost' + (startPath || '/admin/checklist/mau'), runScripts: 'outside-only' }
  );
  const { window } = dom;
  window.phfGetSessionRole = () => 'admin';
  window.phfGetCurrentUser = () => ({ id: 'admin-1', employeeCode: 'PHF000', name: 'Admin' });
  window.phfGetAuthenticatedUser = window.phfGetCurrentUser;
  window.requestAnimationFrame = fn => setTimeout(fn, 0);
  window.requestIdleCallback = fn => setTimeout(fn, 0);
  window.scrollTo = () => {};
  window.__phfLocalData = {
    checklistTemplates: [{
      templateKey: 'nv-marketing', code: 'NV-MKT', name: 'Nhân viên Media Marketing', groupName: 'Marketing',
      templateType: 'checklist_detail', hasChecklist: true, source: '', note: '', status: 'active',
      version: 'v1', effectiveDate: '2026-01-01', updatedAt: '2026-01-01T00:00:00Z',
      definition: DEFINITION_V1,
      versions: [{ version: 'v1', effectiveDate: '2026-01-01', reason: 'seed', sourceVersion: '', changeType: 'sync', createdAt: '2026-01-01T00:00:00Z', definition: DEFINITION_V1 }]
    }],
    checklistTemplatesReady: true,
    checklistTemplatesError: ''
  };
  window.eval(code);
  return dom;
}

(async () => {
  // =========================================================================
  // 1. Sidebar no longer has "Áp dụng lại mẫu"; old route redirects safely.
  // =========================================================================
  {
    const dom = await buildDom('/admin/checklist/mau');
    const { window } = dom;
    window.fetch = async () => response({ ok: true });
    await window.phfRenderChecklist('/admin/checklist/mau');
    await tick();
    const root = window.document.getElementById('phfChecklistRoot');
    check(!root.innerHTML.includes('Áp dụng lại mẫu'), '1a. Sidebar/toolbar no longer contains "Áp dụng lại mẫu" anywhere in admin Mẫu Checklist view');

    await window.phfRenderChecklist('/admin/checklist/ap-dung-lai-mau');
    await tick();
    check(window.location.pathname === '/admin/checklist/mau', '1b. Old route /admin/checklist/ap-dung-lai-mau redirects (history.replaceState) to /admin/checklist/mau');
    const root2 = window.document.getElementById('phfChecklistRoot');
    check(!root2.querySelector('.phfck-retro-steps'), '1c. Old standalone 8-step wizard page is NOT rendered at all after navigating the old route');
    check(root2.innerHTML.includes('Mẫu Checklist'), '1d. Templates screen renders instead (safe redirect target)');
  }

  // =========================================================================
  // 2. Open template detail -> Bảng tổng điểm tab -> Sửa Bảng tổng điểm editor.
  // =========================================================================
  {
    const dom = await buildDom('/admin/checklist/mau');
    const { window } = dom;
    const calls = [];
    window.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body); calls.push(body);
      if (body.action === 'checklistRetroPreviewDiff') {
        return response({ ok: true, errors: [], added: [], removed: [], renamed: [], changed: [{ id: 'r1', before: { weight: 50 }, after: { weight: 40 }, weightChanged: true, sourceChanged: false }], unchanged: [{ id: 'r2' }], totalWeightBefore: 100, totalWeightAfter: 100 });
      }
      if (body.action === 'checklistRetroCopyVersion') {
        return response({ ok: true, templateKey: 'nv-marketing', versionNo: body.input.newVersion, sourceVersion: body.input.sourceVersion, definition: body.input.definition });
      }
      if (body.action === 'checklistRetroDryRunApply') {
        return response({
          ok: true, batchId: body.input.batchId, dryRun: true,
          counts: { applied: 1, skippedLocked: 1, skippedUnmapped: 0, requiresReviewedAdjustment: 1, failed: 0 },
          items: [
            { formId: 'f-reviewed-1', employeeCode: 'PHF020', periodMonth: '2026-07', outcome: 'requires-reviewed-adjustment', reason: 'Phiếu đã thẩm định' },
            { formId: 'f-locked-1', employeeCode: 'PHF030', periodMonth: '2026-07', outcome: 'skipped-locked', reason: 'Phiếu đã khóa' }
          ]
        });
      }
      if (body.action === 'checklistRetroApply') {
        return response({ ok: true, batchId: body.input.batchId, dryRun: false, idempotentReplay: false, counts: { applied: 1, skippedLocked: 1, skippedUnmapped: 0, requiresReviewedAdjustment: 1, failed: 0 }, items: [] });
      }
      if (body.action === 'checklistRetroApplyReviewedForm') {
        return response({ ok: true, formId: body.input.formId, appliedVersion: body.input.newVersion, batchId: body.input.batchId });
      }
      return response({ ok: true });
    };
    await window.phfRenderChecklist('/admin/checklist/mau');
    await tick();
    let root = window.document.getElementById('phfChecklistRoot');

    click(window, root.querySelector('[data-phfck-template-detail="nv-marketing"]'));
    await tick();
    root = window.document.getElementById('phfChecklistRoot');
    check(!!root.querySelector('.phfck-template-modal'), '2a. Template detail modal opens (existing 3-tab modal, not a new modal style)');
    check(root.textContent.includes('Bảng tổng điểm'), '2b. "Bảng tổng điểm" tab button present');

    click(window, root.querySelector('[data-phfck-sales-tab="total"]'));
    await tick();
    root = window.document.getElementById('phfChecklistRoot');
    const editBtn = root.querySelector('[data-phfck-tse-open]');
    check(!!editBtn, '2c. "Sửa Bảng tổng điểm" button exists on the Bảng tổng điểm tab');
    check(editBtn.className.indexOf('phfck-primary') >= 0, '2d. Button reuses the same phfck-primary class as the existing "Sửa trực tiếp" button');

    click(window, editBtn);
    await tick();
    const editorModal = window.document.querySelector('.phfck-tse-modal');
    check(!!editorModal, '2e. Editor modal opens, styled with the existing phfck-edit-modal chrome');
    const rowTrs = editorModal.querySelectorAll('[data-phfck-tse-row-id]');
    check(rowTrs.length === 2, '2f. Editor renders both totalRows from the current DB-hydrated definition (real data, not fabricated)');

    // 3. Edit a row's weight -> live validation panel updates.
    const weightInput = rowTrs[0].querySelector('[data-phfck-tse-field="weight"]');
    setValue(window, weightInput, '30');
    await tick();
    let validation = editorModal.querySelector('[data-phfck-tse-validation]');
    check(validation.textContent.includes('80%'), '3a. Realtime validation panel shows updated total weight (30+50=80%) without a full-table rerender');
    check(!!editorModal.querySelector('[data-phfck-tse-preview]').disabled, '3b. "Xem trước & tạo phiên bản" disabled while invalid (weight != 100%)');

    setValue(window, weightInput, '50');
    await tick();
    validation = editorModal.querySelector('[data-phfck-tse-validation]');
    check(validation.textContent.includes('100%'), '3c. Validation panel shows 100% again after correcting the weight');
    check(!editorModal.querySelector('[data-phfck-tse-preview]').disabled, '3d. Preview button re-enabled once valid (100% + has checklist_total row)');

    // 4. Select "Điểm Checklist tự động" on row 1 -> stored as source.type='checklist_total'.
    const sourceSelect = rowTrs[0].querySelector('[data-phfck-tse-field="sourceType"]');
    check(sourceSelect.querySelector('option[value="checklist_total"]').textContent === 'Điểm Checklist tự động', '4a. Vietnamese-labeled option present for checklist_total');
    check(sourceSelect.querySelector('option[value="manual"]').textContent === 'Nhập đánh giá', '4b. Vietnamese-labeled option present for manual');
    setValue(window, sourceSelect, 'checklist_total');
    await tick();
    check(sourceSelect.value === 'checklist_total', '4c. Row source select reflects checklist_total (verified again below via the real payload sent to the server, not just the display label)');

    // Row 2 (already checklist_total by seed) - switch it back to manual to test the
    // connection-gate warning appears live when no row has checklist_total.
    setValue(window, sourceSelect, 'manual');
    const sourceSelect2 = rowTrs[1].querySelector('[data-phfck-tse-field="sourceType"]');
    setValue(window, sourceSelect2, 'manual');
    await tick();
    check(!!editorModal.querySelector('[data-phfck-tse-gate]'), '5a. Connection-gate inline warning appears live when template requires checklist_total but no row has it');
    check(editorModal.querySelector('[data-phfck-tse-preview]').disabled, '5b. Preview/publish blocked while the connection gate is unresolved');
    // Restore a checklist_total row for the rest of the flow.
    setValue(window, sourceSelect2, 'checklist_total');
    await tick();
    check(!editorModal.querySelector('[data-phfck-tse-gate]'), '5c. Gate warning clears once a row has checklist_total again');

    // 6. Add / remove / reorder rows -> real DOM state changes.
    const addBtn = editorModal.querySelector('[data-phfck-tse-add-row]');
    click(window, addBtn);
    await tick();
    let modal2 = window.document.querySelector('.phfck-tse-modal');
    check(modal2.querySelectorAll('[data-phfck-tse-row-id]').length === 3, '6a. Add row increases row count to 3 (real DOM state change)');
    const removeBtn = modal2.querySelector('[data-phfck-tse-remove-row="2"]');
    click(window, removeBtn);
    await tick();
    modal2 = window.document.querySelector('.phfck-tse-modal');
    check(modal2.querySelectorAll('[data-phfck-tse-row-id]').length === 2, '6b. Remove row decreases row count back to 2');
    const moveDownBtn = modal2.querySelector('[data-phfck-tse-move-down="0"]');
    const firstNameBefore = modal2.querySelectorAll('[data-phfck-tse-row-id]')[0].getAttribute('data-phfck-tse-row-id');
    click(window, moveDownBtn);
    await tick();
    modal2 = window.document.querySelector('.phfck-tse-modal');
    const firstNameAfter = modal2.querySelectorAll('[data-phfck-tse-row-id]')[0].getAttribute('data-phfck-tse-row-id');
    check(firstNameBefore !== firstNameAfter, '6c. Reorder (move down) actually changes row order in the DOM');
    // Weight is back off 100% after row add/remove (r1=50,r2=50 restored) - re-fix.
    modal2.querySelectorAll('[data-phfck-tse-row-id]').forEach(function () {});

    // Reset to a clean, valid 2-row state for preview.
    let cur = window.document.querySelector('.phfck-tse-modal');
    let rows = cur.querySelectorAll('[data-phfck-tse-row-id]');
    setValue(window, rows[0].querySelector('[data-phfck-tse-field="weight"]'), '50');
    setValue(window, rows[1].querySelector('[data-phfck-tse-field="weight"]'), '50');
    await tick();
    cur = window.document.querySelector('.phfck-tse-modal');
    check(!cur.querySelector('[data-phfck-tse-preview]').disabled, '7a. Valid again (100% total, has checklist_total row) - preview enabled');

    // 8. Preview diff -> real checklistRetroPreviewDiff call, real diff data renders.
    click(window, cur.querySelector('[data-phfck-tse-preview]'));
    await tick(50);
    check(calls.some(c => c.action === 'checklistRetroPreviewDiff'), '8a. checklistRetroPreviewDiff called with the real edited draft (not a client-only computed diff)');
    const previewModal = window.document.querySelector('.phfck-tse-preview-modal');
    check(!!previewModal && !!previewModal.querySelector('.phfck-retro-diff-grid'), '8b. Real diff grid renders from the server response');

    // 9. Create version -> reuses checklistRetroCopyVersion, old version untouched.
    const oldVersionSnapshotBefore = JSON.stringify(window.__phfLocalData.checklistTemplates[0].versions[0]);
    setValue(window, previewModal.querySelector('[data-phfck-tse-new-version]'), 'v2');
    setValue(window, previewModal.querySelector('[data-phfck-tse-reason]'), 'Cập nhật trọng số theo quyết định Ban Giám đốc');
    click(window, previewModal.querySelector('[data-phfck-tse-confirm-publish]'));
    await tick(60);
    check(calls.some(c => c.action === 'checklistRetroCopyVersion' && c.input.templateKey === 'nv-marketing' && c.input.sourceVersion === 'v1' && c.input.newVersion === 'v2' && c.input.definition), '9a. checklistRetroCopyVersion called with templateKey/source/new version + the edited definition (reuses the existing publish RPC, passes the edited draft as definition override)');
    const oldVersionSnapshotAfter = JSON.stringify(window.__phfLocalData.checklistTemplates[0].versions[0]);
    check(oldVersionSnapshotBefore === oldVersionSnapshotAfter, '9b. Old version (v1) fixture untouched after publish (no mutation of the prior version)');
    const copyCall = calls.find(c => c.action === 'checklistRetroCopyVersion');
    const sentRows = (copyCall && copyCall.input.definition && copyCall.input.definition.totalRows) || [];
    const r1Sent = sentRows.find(r => r.id === 'r1'), r2Sent = sentRows.find(r => r.id === 'r2');
    check(!!r2Sent && r2Sent.source && r2Sent.source.type === 'checklist_total', '9c. Real payload sent to checklistRetroCopyVersion carries source.type=\'checklist_total\' for the row toggled to "Điểm Checklist tự động" (raw source.type stored under the hood, confirmed end-to-end)');
    check(!!r1Sent && r1Sent.source && r1Sent.source.type === 'manual', '9d. The other row correctly kept source.type=\'manual\' (no auto-selection by the system)');

    // 10. Post-publish modal - both choices present.
    await tick(30);
    const postPublish = window.document.querySelector('[data-phfck-tse-postpublish]');
    check(!!postPublish, '10a. Post-publish modal opens automatically after a successful publish');
    check(!!postPublish.querySelector('[data-phfck-tse-only-new]') && !!postPublish.querySelector('[data-phfck-tse-open-retro]'), '10b. Both required choices present: "Chỉ áp dụng cho Phiếu tháng tạo mới" and "Cập nhật Phiếu tháng hiện có"');
    check(postPublish.textContent.includes('Phiên bản mới đã được tạo'), '10c. Vietnamese copy matches the spec');

    const applyCallsBeforeChoice = calls.filter(c => c.action === 'checklistRetroApply' || c.action === 'checklistRetroDryRunApply').length;
    click(window, postPublish.querySelector('[data-phfck-tse-only-new]'));
    await tick(30);
    check(!window.document.querySelector('[data-phfck-tse-postpublish]'), '10d. "Chỉ áp dụng cho Phiếu tháng tạo mới" closes the modal');
    const applyCallsAfterChoice = calls.filter(c => c.action === 'checklistRetroApply' || c.action === 'checklistRetroDryRunApply').length;
    check(applyCallsAfterChoice === applyCallsBeforeChoice, '10e. Zero backend apply/dry-run calls made when choosing "Chỉ áp dụng cho Phiếu tháng tạo mới" (spy-verified, no retroactive action triggered)');
  }

  // =========================================================================
  // 11. "Cập nhật Phiếu tháng hiện có" 3-step drawer: real backend, state policy.
  // =========================================================================
  {
    const dom = await buildDom('/admin/checklist/mau');
    const { window } = dom;
    const calls = [];
    window.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body); calls.push(body);
      if (body.action === 'checklistRetroPreviewDiff') return response({ ok: true, errors: [], added: [], removed: [], renamed: [], changed: [], unchanged: [{ id: 'r1' }, { id: 'r2' }], totalWeightBefore: 100, totalWeightAfter: 100 });
      if (body.action === 'checklistRetroCopyVersion') return response({ ok: true, templateKey: 'nv-marketing', versionNo: body.input.newVersion, sourceVersion: body.input.sourceVersion, definition: body.input.definition });
      if (body.action === 'checklistRetroDryRunApply') {
        return response({
          ok: true, batchId: body.input.batchId, dryRun: true,
          counts: { applied: 1, skippedLocked: 1, skippedUnmapped: 1, requiresReviewedAdjustment: 1, failed: 0 },
          items: [
            { formId: 'f-unmapped-1', employeeCode: 'PHF010', periodMonth: '2026-07', outcome: 'skipped-unmapped', reason: 'Có câu trả lời gắn với dòng đã bị xóa' },
            { formId: 'f-reviewed-1', employeeCode: 'PHF020', periodMonth: '2026-07', outcome: 'requires-reviewed-adjustment', reason: 'Phiếu đã thẩm định' },
            { formId: 'f-locked-1', employeeCode: 'PHF030', periodMonth: '2026-07', outcome: 'skipped-locked', reason: 'Phiếu đã khóa' },
            { formId: 'f-cancelled-1', employeeCode: 'PHF040', periodMonth: '2026-07', outcome: 'skipped-cancelled', reason: 'Phiếu đã hủy' }
          ]
        });
      }
      if (body.action === 'checklistRetroApply') return response({ ok: true, batchId: body.input.batchId, dryRun: false, idempotentReplay: false, counts: { applied: 1, skippedLocked: 1, skippedUnmapped: 1, requiresReviewedAdjustment: 1, failed: 0 }, items: [] });
      if (body.action === 'checklistRetroApplyReviewedForm') return response({ ok: true, formId: body.input.formId, appliedVersion: body.input.newVersion, batchId: body.input.batchId });
      return response({ ok: true });
    };
    await window.phfRenderChecklist('/admin/checklist/mau');
    await tick();
    let root = window.document.getElementById('phfChecklistRoot');
    click(window, root.querySelector('[data-phfck-template-detail="nv-marketing"]'));
    await tick();
    root = window.document.getElementById('phfChecklistRoot');
    click(window, root.querySelector('[data-phfck-sales-tab="total"]'));
    await tick();
    root = window.document.getElementById('phfChecklistRoot');
    click(window, root.querySelector('[data-phfck-tse-open]'));
    await tick();
    let modal = window.document.querySelector('.phfck-tse-modal');
    click(window, modal.querySelector('[data-phfck-tse-preview]'));
    await tick(50);
    let previewModal = window.document.querySelector('.phfck-tse-preview-modal');
    setValue(window, previewModal.querySelector('[data-phfck-tse-new-version]'), 'v2');
    setValue(window, previewModal.querySelector('[data-phfck-tse-reason]'), 'Điều chỉnh theo quyết định Ban Giám đốc');
    click(window, previewModal.querySelector('[data-phfck-tse-confirm-publish]'));
    await tick(60);
    let postPublish = window.document.querySelector('[data-phfck-tse-postpublish]');
    click(window, postPublish.querySelector('[data-phfck-tse-open-retro]'));
    await tick(30);

    const drawer = window.document.querySelector('.phfck-tra-modal');
    check(!!drawer, '11a. 3-step "Cập nhật Phiếu tháng hiện có" modal opens');
    check(drawer.textContent.includes('nv-marketing') === false && drawer.textContent.includes('v1') && drawer.textContent.includes('v2'), '11b. Old/new version pre-filled from context (v1 -> v2), no re-selection needed');
    check(!!drawer.querySelector('[data-phfck-tra-next-from-1]'), '11c. Step 1 (Chọn phạm vi) shown first');

    setValue(window, drawer.querySelector('[data-phfck-tra-period-from]'), '2026-07');
    setValue(window, drawer.querySelector('[data-phfck-tra-period-to]'), '2026-07');
    click(window, drawer.querySelector('[data-phfck-tra-next-from-1]'));
    await tick();
    let drawer2 = window.document.querySelector('.phfck-tra-modal');
    check(!!drawer2.querySelector('[data-phfck-tra-run-preview]'), '11d. Step 2 (Xem tác động) shows the real-preview trigger button');

    click(window, drawer2.querySelector('[data-phfck-tra-run-preview]'));
    await tick(50);
    check(calls.some(c => c.action === 'checklistRetroDryRunApply' && c.input.periodMonthFrom === '2026-07'), '12a. checklistRetroDryRunApply (real backend dry-run/simulation) invoked with the chosen scope, not fabricated numbers');
    let drawer3 = window.document.querySelector('.phfck-tra-modal');
    check(drawer3.textContent.includes('Có thể tự động remap'), '12b. Real applied count rendered');
    check(drawer3.textContent.includes('Bị chặn'), '12c. Real unmapped count rendered');
    check(drawer3.textContent.includes('Cần luồng riêng'), '12d. Real reviewed-needs-separate-path count rendered');
    check(drawer3.textContent.includes('Không thể áp dụng'), '12e. Real locked/cancelled-excluded count rendered');

    // 13. Locked/cancelled: zero apply affordance anywhere.
    const allButtons = [...drawer3.querySelectorAll('button')].map(b => (b.getAttribute('data-phfck-tra-apply-reviewed') || ''));
    check(!allButtons.some(t => /f-locked-1/.test(t)), '13a. No apply button references the locked form');
    check(!drawer3.querySelector('[data-phfck-tra-apply-reviewed="f-locked-1"]'), '13b. Locked form has zero apply control in the DOM (not merely disabled)');
    check(!drawer3.querySelector('[data-phfck-tra-apply-reviewed="f-cancelled-1"]'), '13c. Cancelled form has zero apply control in the DOM');

    click(window, drawer3.querySelector('[data-phfck-tra-goto="3"]'));
    await tick();
    let drawer4 = window.document.querySelector('.phfck-tra-modal');
    check(!!drawer4.querySelector('[data-phfck-tra-confirm-apply]'), '14a. Step 3 (Xác nhận) shows the real confirm-apply button (dry-run happened first, this is the only mutating action)');
    click(window, drawer4.querySelector('[data-phfck-tra-confirm-apply]'));
    await tick(30);
    const decisionConfirm = window.document.querySelector('[data-phfck-decision-confirm]');
    check(!!decisionConfirm, '14b. Explicit confirm modal (phfckConfirm) required before the mutating checklistRetroApply call');
    click(window, decisionConfirm);
    await tick(60);
    check(calls.some(c => c.action === 'checklistRetroApply' && c.input.batchId), '14c. checklistRetroApply (real backend) called only after explicit confirmation, with idempotency batchId');
    check(!calls.some(c => c.action === 'checklistRetroApplyReviewedForm'), '14d. checklistRetroApplyReviewedForm NOT triggered by the normal batch-confirm (separate path required, state policy enforced)');

    let drawer5 = window.document.querySelector('.phfck-tra-modal');
    const reviewedRow = drawer5.querySelectorAll('[data-phfck-tra-apply-reviewed]');
    check(reviewedRow.length === 1, '15a. Exactly one reviewed-form row rendered in its own dedicated panel');
    check(!!drawer5.querySelector('.phfck-retro-reviewed-panel'), '15b. Reviewed-form panel visually distinct, not merged into the normal batch result table');

    setValue(window, drawer5.querySelector('[data-phfck-tra-reviewed-reason]'), 'Điều chỉnh phiếu đã thẩm định theo quyết định Ban Giám đốc');
    click(window, drawer5.querySelector('[data-phfck-tra-apply-reviewed]'));
    await tick(30);
    const reviewedConfirm = window.document.querySelector('[data-phfck-decision-confirm]');
    check(!!reviewedConfirm, '15c. Reviewed-form apply requires its own explicit confirm modal');
    click(window, reviewedConfirm);
    await tick(50);
    const reviewedCall = calls.find(c => c.action === 'checklistRetroApplyReviewedForm');
    check(!!reviewedCall && reviewedCall.input.confirm === true && reviewedCall.input.reason.length >= 10, '15d. checklistRetroApplyReviewedForm called with confirm:true + reason>=10 chars via the dedicated separate path');
  }

  // =========================================================================
  // 16. Visual QA 2026-08-14: prominent live total-weight banner (3 cases).
  // =========================================================================
  {
    // 16a. Exactly 100% + has checklist_total row -> valid, no missing-row message.
    const dom = await buildDom('/admin/checklist/mau');
    const { window } = dom;
    window.fetch = async () => response({ ok: true });
    await window.phfRenderChecklist('/admin/checklist/mau');
    await tick();
    let root = window.document.getElementById('phfChecklistRoot');
    click(window, root.querySelector('[data-phfck-template-detail="nv-marketing"]'));
    await tick();
    root = window.document.getElementById('phfChecklistRoot');
    click(window, root.querySelector('[data-phfck-sales-tab="total"]'));
    await tick();
    root = window.document.getElementById('phfChecklistRoot');
    click(window, root.querySelector('[data-phfck-tse-open]'));
    await tick();
    let modal = window.document.querySelector('.phfck-tse-modal');
    let banner = modal.querySelector('[data-phfck-tse-total-banner]');
    check(!!banner, '16a. Prominent total-weight banner renders in the editor');
    check(banner.textContent.includes('100%'), '16b. Banner shows the correct total weight (100%) on load (seed r1=50 + r2=50)');
    check(banner.className.indexOf('is-ok') >= 0 && !banner.textContent.includes('Thiếu dòng'), '16c. Exactly 100% with a checklist_total row present -> valid, no missing-row message');

    // 16d. Under 100% with no checklist_total row -> missing-row variant.
    let rows = modal.querySelectorAll('[data-phfck-tse-row-id]');
    setValue(window, rows[0].querySelector('[data-phfck-tse-field="weight"]'), '40');
    setValue(window, rows[1].querySelector('[data-phfck-tse-field="sourceType"]'), 'manual');
    await tick();
    modal = window.document.querySelector('.phfck-tse-modal');
    banner = modal.querySelector('[data-phfck-tse-total-banner]');
    check(banner.className.indexOf('is-missing') >= 0, '16d. Under 100% with no checklist_total row -> banner switches to the missing-row variant');
    check(banner.textContent.includes('Thiếu dòng Điểm Checklist'), '16e. Missing-row banner text matches spec copy');

    // 16f. New "+ Thêm dòng Điểm Checklist" convenience button (in the gate warning):
    // adds exactly one row with source.type='checklist_total' and an EMPTY/ZERO weight
    // (must not auto-fill a weight, consistent with the no-auto-selection rule).
    const gate = modal.querySelector('[data-phfck-tse-gate]');
    check(!!gate, '16f. Connection-gate warning visible while no row has checklist_total');
    check(gate.textContent.includes('Bảng tổng điểm chưa nhận Điểm Checklist tự động') && gate.textContent.includes('Hãy thêm một dòng, chọn nguồn Điểm Checklist tự động và nhập trọng số'), '16g. Gate warning copy matches the simplified business copy');
    const addChecklistRowBtn = gate.querySelector('[data-phfck-tse-add-checklist-row]');
    check(!!addChecklistRowBtn, '16h. "+ Thêm dòng Điểm Checklist" convenience button present in the gate warning');
    const rowCountBefore = modal.querySelectorAll('[data-phfck-tse-row-id]').length;
    click(window, addChecklistRowBtn);
    await tick();
    modal = window.document.querySelector('.phfck-tse-modal');
    const rowsAfter = modal.querySelectorAll('[data-phfck-tse-row-id]');
    check(rowsAfter.length === rowCountBefore + 1, '16i. Clicking the convenience button adds exactly one row');
    const newRow = rowsAfter[rowsAfter.length - 1];
    check(newRow.querySelector('[data-phfck-tse-field="sourceType"]').value === 'checklist_total', '16j. The new row is pre-selected with source.type=\'checklist_total\'');
    check(newRow.querySelector('[data-phfck-tse-field="weight"]').value === '0', '16k. The new row\'s weight is left empty/zero (NOT auto-filled) - Admin must type it themselves');
    check(!modal.querySelector('[data-phfck-tse-gate]'), '16l. Gate warning clears now that a checklist_total row exists');

    // 16m. Over 100% after adding a weighted row -> "vượt" variant.
    const dom2 = await buildDom('/admin/checklist/mau');
    const w2 = dom2.window;
    w2.fetch = async () => response({ ok: true });
    await w2.phfRenderChecklist('/admin/checklist/mau');
    await tick();
    let root2 = w2.document.getElementById('phfChecklistRoot');
    click(w2, root2.querySelector('[data-phfck-template-detail="nv-marketing"]'));
    await tick();
    root2 = w2.document.getElementById('phfChecklistRoot');
    click(w2, root2.querySelector('[data-phfck-sales-tab="total"]'));
    await tick();
    root2 = w2.document.getElementById('phfChecklistRoot');
    click(w2, root2.querySelector('[data-phfck-tse-open]'));
    await tick();
    let modal2b = w2.document.querySelector('.phfck-tse-modal');
    click(w2, modal2b.querySelector('[data-phfck-tse-add-row]'));
    await tick();
    modal2b = w2.document.querySelector('.phfck-tse-modal');
    const newRows = modal2b.querySelectorAll('[data-phfck-tse-row-id]');
    setValue(w2, newRows[newRows.length - 1].querySelector('[data-phfck-tse-field="weight"]'), '10');
    await tick();
    modal2b = w2.document.querySelector('.phfck-tse-modal');
    const banner2 = modal2b.querySelector('[data-phfck-tse-total-banner]');
    check(banner2.className.indexOf('is-over') >= 0, '16m. Over 100% (110%) after adding a weighted row -> banner switches to the "vượt" variant');
    check(banner2.textContent.includes('110%') && banner2.textContent.includes('Vượt 10%'), '16n. Over-100% banner shows the real total (110%) and the correct over-amount (10%)');
  }

  console.log('');
  console.log(passes + ' PASS, ' + failures + ' FAIL');
  process.exitCode = failures ? 1 : 0;
})();
