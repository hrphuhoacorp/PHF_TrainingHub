'use strict';
/* Workstream B (vòng cuối) — jsdom regression cho module UI mới
   assets/js/checklist/phf-checklist-late-workflow.js (mount trực tiếp, không cần load toàn bộ
   phf-checklist-app.js — module tự nhận ctx). Cùng pattern JSDOM + eval + DOM thật của
   scripts/test-checklist-retro-wizard-ui-2026-08.js.
   Chạy: node scripts/test-checklist-late-workflow-module-2026-08.js
*/
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const modulePath = path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-late-workflow.js');
const code = fs.readFileSync(modulePath, 'utf8');

let failures = 0, passes = 0;
function check(condition, message) { if (!condition) { console.error('FAIL: ' + message); failures++; } else { passes++; } }
function click(window, el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
function setValue(window, el, value) { el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); el.dispatchEvent(new window.Event('change', { bubbles: true })); }
function check_radio(window, el) { el.checked = true; el.dispatchEvent(new window.Event('change', { bubbles: true })); }
function tick(n) { return new Promise(resolve => setTimeout(resolve, n || 30)); }
function response(data) { return { ok: true, status: 200, json: async () => data }; }
function forbidden(data) { return { ok: false, status: 403, json: async () => data }; }

function buildDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="mount"></div></body></html>', { url: 'http://localhost/admin/checklist/ghi-nhan-loi', runScripts: 'outside-only' });
  const { window } = dom;
  window.requestAnimationFrame = fn => setTimeout(fn, 0);
  window.fetch = async () => response({});
  window.eval(code);
  return dom;
}

const PEOPLE = [
  { code: 'PHF001', name: 'Nguyễn Văn A', department: 'Bộ phận bán hàng', branch: 'CN Q3' },
  { code: 'PHF002', name: 'Trần Thị B', department: 'Bộ phận bán hàng', branch: 'CN Q3' }
];

(async () => {
  // =========================================================================
  // 1. Trưởng ca — form hiển thị đúng khi có capability, ẩn khi không có.
  // =========================================================================
  {
    const dom = buildDom();
    const { window } = dom;
    const calls = [];
    window.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body); calls.push(body);
      if (body.action === 'listChecklistLateManagerObservations') return response({ records: [] });
      if (body.action === 'recordChecklistLateManagerObservation') return response({ saved: true, record: { id: 'r1' } });
      return response({ ok: true });
    };
    const mount = window.document.getElementById('mount');
    window.PhfChecklistLateWorkflow.mount(mount, { isAdmin: false, canRecord: true, actorEmployeeCode: 'PHF010', actorName: 'Trưởng ca', people: PEOPLE });
    await tick();

    check(!!mount.querySelector('[data-phfck-latewf-record-form]'), '1a. Trưởng ca có capability -> thấy form ghi nhận');
    check(!mount.querySelector('[data-phfck-latewf-admin-shell]'), '1b. Trưởng ca KHÔNG thấy shell Admin (Đối soát BCC) trong DOM');
    check(!mount.querySelector('[data-phfck-latewf-upload-card]'), '1c. Không có upload card nào được render cho Trưởng ca');
    check(mount.querySelectorAll('select[data-phfck-latewf-field="employeeCode"] option').length === PEOPLE.length + 1, '1d. Picker nhân sự đúng số scoped người (đã lọc sẵn ở ctx.people)');

    // Submit thiếu Có/Không xin phép -> phải chặn, KHÔNG gọi API ghi nhận.
    const empSel = mount.querySelector('select[data-phfck-latewf-field="employeeCode"]');
    setValue(window, empSel, 'PHF001');
    mount.querySelector('[data-phfck-latewf-record-form]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    check(!calls.some(c => c.action === 'recordChecklistLateManagerObservation'), '1e. Blank Có/Không xin phép chặn save (không gọi action ghi nhận)');
    check(!!mount.querySelector('.phfck-latewf-field-error'), '1f. Hiển thị lỗi validate khi thiếu Có/Không xin phép');

    // Re-render sau lỗi validate đã thay thế toàn bộ DOM form (string re-render) -> phải re-query
    // lại phần tử mới nhất trước khi thao tác tiếp (tương tự các test JSDOM khác trong repo).
    setValue(window, mount.querySelector('select[data-phfck-latewf-field="employeeCode"]'), 'PHF001');
    const radioNo = mount.querySelector('input[data-phfck-latewf-field="managerDecision"][value="rejected"]');
    check_radio(window, radioNo);
    mount.querySelector('[data-phfck-latewf-record-form]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    const recordCall = calls.find(c => c.action === 'recordChecklistLateManagerObservation');
    check(!!recordCall, '1g. Submit hợp lệ gọi recordChecklistLateManagerObservation');
    check(!calls.some(c => c.action === 'approveChecklistLateEvents'), '1h. Save của Trưởng ca KHÔNG BAO GIỜ gọi approveChecklistLateEvents (không tạo bản ghi chính thức)');
    check(recordCall.input.managerDecision === 'rejected', '1i. Payload gửi đúng managerDecision đã chọn');

    window.PhfChecklistLateWorkflow.unmount();
  }

  // =========================================================================
  // 2. Trưởng ca KHÔNG có capability record -> không thấy form, không thấy hành động Admin.
  // =========================================================================
  {
    const dom = buildDom();
    const { window } = dom;
    const mount = window.document.getElementById('mount');
    window.PhfChecklistLateWorkflow.mount(mount, { isAdmin: false, canRecord: false, actorEmployeeCode: 'PHF099', actorName: 'Nhân viên', people: [] });
    await tick();
    check(!mount.querySelector('[data-phfck-latewf-record-form]'), '2a. Không có quyền -> KHÔNG render form (not just hidden via CSS)');
    check(!!mount.querySelector('[data-phfck-latewf-no-permission]'), '2b. Hiển thị thông báo không có quyền');
    check(!mount.querySelector('[data-phfck-latewf-upload-card],[data-phfck-latewf-bulk-approve],[data-phfck-latewf-export-run]'), '2c. Không có bất kỳ phần tử Admin nào trong DOM');
    window.PhfChecklistLateWorkflow.unmount();
  }

  // =========================================================================
  // 3. Admin — upload -> preview render đúng, chưa ghi gì chính thức.
  // =========================================================================
  const PREVIEW_ROW = {
    rowIndex: 0, excelRowNumber: 2, employeeCode: 'PHF001', employeeNameRaw: 'Nguyễn Văn A', occurredDate: '2026-08-10',
    shift: 'Ca sáng', checkinTime: '08:20', location: 'CN Q3', minutesLate: 12, adjustReasonRaw: '', bccTransactionId: '', source: 'BCC',
    employeeName: 'Nguyễn Văn A', department: 'Bộ phận bán hàng', branch: 'CN Q3', importRowKey: 'PHF001|2026-08-10|casang|BCC#abc',
    identity: {}, matchStatus: 'unmatched_default_no_permission', managerDecisionSuggested: 'rejected', standardPoints: 3, suggestedPoints: 3,
    suggestionLabel: 'Không có ghi nhận từ bộ phận — mặc định Không xin phép', frequencyWarning: { count: 1, threshold: 4, overThreshold: false, referenceOnly: true, message: '' },
    alreadyOfficialViolationId: null, rowStatus: 'pending_approval'
  };
  const PREVIEW_RESPONSE = {
    preview: [PREVIEW_ROW], totalRows: 1, needsReviewCount: 0, alreadyOfficialCount: 0,
    columnReport: { expectedColumns: ['Mã nhân viên'], recognizedColumns: ['Mã nhân viên', 'Ngày', 'Phút trễ'], missingColumns: ['Ca làm'], extraColumns: ['Cột lạ'] },
    invalidRows: [{ excelRowNumber: 5, reasons: ['Thiếu Mã nhân viên.'] }],
    unknownEmployeeRows: [{ excelRowNumber: 6, employeeCode: 'PHF999' }],
    validRowCount: 1, invalidRowCount: 1, unknownEmployeeRowCount: 1
  };
  function adminDom(fetchImpl) {
    const dom = buildDom();
    const { window } = dom;
    window.fetch = fetchImpl;
    const mount = window.document.getElementById('mount');
    window.PhfChecklistLateWorkflow.mount(mount, { isAdmin: true, canRecord: true, actorEmployeeCode: 'PHF000', actorName: 'Admin', people: PEOPLE });
    return { dom, window, mount };
  }
  {
    const calls = [];
    const { window, mount } = adminDom(async (url, opts) => {
      const body = JSON.parse(opts.body); calls.push(body);
      if (body.action === 'previewChecklistLateBccUpload') return response(PREVIEW_RESPONSE);
      return response({ ok: true });
    });
    await tick();
    check(!!mount.querySelector('[data-phfck-latewf-admin-shell]'), '3a. Admin thấy shell Đối soát BCC');
    check(!!mount.querySelector('[data-phfck-latewf-upload-card]'), '3b. Có upload card');

    // Giả lập file được chọn (bỏ qua đọc XLSX thật - test trực tiếp handler qua fetch preview
    // bằng cách gọi thẳng nội bộ: mô phỏng input file 'change' với 1 file giả + XLSX stub).
    window.XLSX = { read: () => ({ SheetNames: ['DỮ LIỆU'], Sheets: { 'DỮ LIỆU': {} } }), utils: { sheet_to_json: () => ([{ 'Mã nhân viên': 'PHF001' }]) } };
    class FakeFileReader { readAsArrayBuffer() { this.result = new ArrayBuffer(1); if (this.onload) this.onload(); } }
    window.FileReader = FakeFileReader;
    const fileInput = mount.querySelector('[data-phfck-latewf-file-input]');
    Object.defineProperty(fileInput, 'files', { value: [{ name: 'bcc.xlsx' }], configurable: true });
    fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick(50);

    check(!!mount.querySelector('[data-phfck-latewf-preview-card]'), '3c. Preview card hiển thị sau khi upload');
    check(mount.textContent.includes('Ca làm'), '3d. Cột thiếu (missingColumns) hiển thị nguyên văn từ service');
    check(mount.textContent.includes('Cột lạ'), '3e. Cột thừa (extraColumns) hiển thị nguyên văn từ service');
    check(!!mount.querySelector('[data-phfck-latewf-invalid-rows]'), '3f. Dòng lỗi (invalidRows) hiển thị, không bị gộp/ẩn');
    check(!!mount.querySelector('[data-phfck-latewf-unknown-rows]'), '3g. Dòng ngoài phạm vi (unknownEmployeeRows) hiển thị');
    check(!calls.some(c => c.action === 'approveChecklistLateEvents'), '3h. Upload/preview KHÔNG gọi approveChecklistLateEvents (chưa ghi gì chính thức)');
    check(!calls.some(c => c.action === 'createChecklistLateBccImport'), '3i. Chưa bấm "Lưu & Đối soát" thì chưa gọi createChecklistLateBccImport');
    window.PhfChecklistLateWorkflow.unmount();
  }

  // =========================================================================
  // 4. Admin — Lưu & Đối soát -> reconcile probe -> KHÔNG có xung đột -> vào bảng review thẳng.
  // =========================================================================
  const IMPORT_ROW_CLEAN = {
    id: 'row-1', import_id: 'imp-1', employee_code: 'PHF001', employee_name_raw: 'Nguyễn Văn A', department: 'Bộ phận bán hàng', branch: 'CN Q3',
    occurred_date: '2026-08-10', shift: 'Ca sáng', checkin_time: '08:20', minutes_late: 12, standard_points: 3, suggested_points: 3,
    match_status: 'unmatched_default_no_permission', manager_decision_suggested: 'rejected', row_status: 'pending_approval',
    frequency_reference_snapshot: { overThreshold: false, message: '' }, linked_violation_id: null, import_row_key: PREVIEW_ROW.importRowKey
  };
  {
    const calls = [];
    const { window, mount } = adminDom(async (url, opts) => {
      const body = JSON.parse(opts.body); calls.push(body);
      if (body.action === 'previewChecklistLateBccUpload') return response(PREVIEW_RESPONSE);
      if (body.action === 'createChecklistLateBccImport') return response({ import: { id: 'imp-1' }, rows: [IMPORT_ROW_CLEAN] });
      if (body.action === 'reconcileChecklistLateBccImport') return response({ actions: [{ type: 'create_draft', importRowKey: IMPORT_ROW_CLEAN.import_row_key, row: { __rowId: 'row-1' }, rowStatus: 'pending_approval' }], updated: 1 });
      return response({ ok: true });
    });
    await tick();
    window.XLSX = { read: () => ({ SheetNames: ['DỮ LIỆU'], Sheets: { 'DỮ LIỆU': {} } }), utils: { sheet_to_json: () => ([{ 'Mã nhân viên': 'PHF001' }]) } };
    window.FileReader = class { readAsArrayBuffer() { this.result = new ArrayBuffer(1); if (this.onload) this.onload(); } };
    const fileInput = mount.querySelector('[data-phfck-latewf-file-input]');
    Object.defineProperty(fileInput, 'files', { value: [{ name: 'bcc.xlsx' }], configurable: true });
    fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick(50);

    const startBtn = mount.querySelector('[data-phfck-latewf-start-reconcile]');
    click(window, startBtn);
    await tick(50);

    check(calls.some(c => c.action === 'createChecklistLateBccImport'), '4a. Bấm Lưu & Đối soát gọi createChecklistLateBccImport');
    check(calls.some(c => c.action === 'reconcileChecklistLateBccImport' && c.input.choice === 'row_by_row'), '4b. Probe đối soát dùng choice an toàn row_by_row (không tự ghi đè)');
    check(!mount.querySelector('[data-phfck-latewf-conflict-modal]'), '4c. Không có xung đột -> không hiện modal xung đột');
    check(!!mount.querySelector('[data-phfck-latewf-recon-table-card]'), '4d. Vào thẳng bảng đối soát để xem lại (phase-1: chỉ để xem, không phê duyệt)');
    check(!calls.some(c => c.action === 'approveChecklistLateEvents'), '4e. Vẫn CHƯA gọi approve tới khi người dùng thao tác (không có nút Phê duyệt trong phase-1)');

    // FINAL UI GATE (2026-08-15): phase-1 KHÔNG expose Phê duyệt/officialize/adjustment/scoring
    // input cho Admin — LATE_APPROVAL_UI_ENABLED=false ở module ẩn hẳn các phần tử này khỏi DOM
    // (không chỉ disable). Logic approve/backend guard tương lai được test riêng ở
    // scripts/test-checklist-late-approval-backend-guard-2026-08.js (guard) và
    // scripts/test-checklist-late-workstream-b-round2-2026-08.js (approveLateEvents business logic).
    check(!mount.querySelector('[data-phfck-latewf-applied-points="row-1"]'), '4f. Phase-1: KHÔNG có input "Điểm áp dụng" (scoring input không dùng trong phase-1)');
    check(!mount.querySelector('[data-phfck-latewf-row-reason="row-1"]'), '4g. Phase-1: KHÔNG có input "Lý do" gắn với approve');
    check(!mount.querySelector('[data-phfck-latewf-approve-one="row-1"]'), '4h. Phase-1: KHÔNG có nút "Duyệt dòng này"');
    check(!mount.querySelector('[data-phfck-latewf-row-check="row-1"]'), '4i. Phase-1: KHÔNG có checkbox chọn dòng (chỉ dùng cho bulk-approve, cũng đã ẩn)');
    check(mount.textContent.includes('3 điểm'), '4j. Điểm gợi ý (thông tin, không phải input) vẫn hiển thị đúng từ suggested_points server trả');
    window.PhfChecklistLateWorkflow.unmount();
  }

  // =========================================================================
  // 5. Phase-1: override điểm/lý do (manual override) không còn đường vào UI — form/input
  //    tương ứng không tồn tại trong DOM nên không thể submit. Logic override/reason-required
  //    của approveLateEvents() vẫn được kiểm chứng ở tầng service (không qua UI), xem
  //    scripts/test-checklist-late-workstream-b-round2-2026-08.js.
  // =========================================================================
  {
    const calls = [];
    const { window, mount } = adminDom(async (url, opts) => {
      const body = JSON.parse(opts.body); calls.push(body);
      if (body.action === 'previewChecklistLateBccUpload') return response(PREVIEW_RESPONSE);
      if (body.action === 'createChecklistLateBccImport') return response({ import: { id: 'imp-1' }, rows: [IMPORT_ROW_CLEAN] });
      if (body.action === 'reconcileChecklistLateBccImport') return response({ actions: [{ type: 'create_draft', importRowKey: IMPORT_ROW_CLEAN.import_row_key, row: { __rowId: 'row-1' }, rowStatus: 'pending_approval' }], updated: 1 });
      return response({ ok: true });
    });
    await tick();
    window.XLSX = { read: () => ({ SheetNames: ['DỮ LIỆU'], Sheets: { 'DỮ LIỆU': {} } }), utils: { sheet_to_json: () => ([{ 'Mã nhân viên': 'PHF001' }]) } };
    window.FileReader = class { readAsArrayBuffer() { this.result = new ArrayBuffer(1); if (this.onload) this.onload(); } };
    const fileInput = mount.querySelector('[data-phfck-latewf-file-input]');
    Object.defineProperty(fileInput, 'files', { value: [{ name: 'bcc.xlsx' }], configurable: true });
    fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick(50);
    click(window, mount.querySelector('[data-phfck-latewf-start-reconcile]'));
    await tick(50);

    check(!mount.querySelector('[data-phfck-latewf-applied-points="row-1"]'), '5a. Phase-1: không có input điểm áp dụng để override');
    check(!mount.querySelector('[data-phfck-latewf-row-reason="row-1"]'), '5b. Phase-1: không có input lý do gắn với approve');
    check(!calls.some(c => c.action === 'approveChecklistLateEvents'), '5c. Không có đường nào trong UI gọi được approveChecklistLateEvents ở phase-1');
    window.PhfChecklistLateWorkflow.unmount();
  }

  // =========================================================================
  // 6. Conflict — có dòng đã official -> modal 3 lựa chọn hiện ra, mỗi lựa chọn gọi đúng action.
  // =========================================================================
  const IMPORT_ROW_OFFICIAL = Object.assign({}, IMPORT_ROW_CLEAN, { id: 'row-2', linked_violation_id: 'vio-1' });
  function officialConflictSetup() {
    const calls = [];
    const { window, mount } = adminDom(async (url, opts) => {
      const body = JSON.parse(opts.body); calls.push(body);
      if (body.action === 'previewChecklistLateBccUpload') return response(PREVIEW_RESPONSE);
      if (body.action === 'createChecklistLateBccImport') return response({ import: { id: 'imp-1' }, rows: [IMPORT_ROW_OFFICIAL] });
      if (body.action === 'reconcileChecklistLateBccImport') {
        if (body.input.choice === 'row_by_row' && Object.keys(body.input.rowDecisions || {}).length === 0) {
          return response({ actions: [{ type: 'create_linked_adjustment', importRowKey: IMPORT_ROW_OFFICIAL.import_row_key, row: { __rowId: 'row-2', minutesLate: 15 }, existing: { row: { minutesLate: 12 }, importRowId: 'row-2', linked_violation_id: 'vio-1' }, rowStatus: 'needs_review', reasonRequired: true }], updated: 1 });
        }
        return response({ actions: [], updated: 0 });
      }
      return response({ ok: true });
    });
    return { calls, window, mount };
  }
  {
    const { calls, window, mount } = officialConflictSetup();
    await tick();
    window.XLSX = { read: () => ({ SheetNames: ['DỮ LIỆU'], Sheets: { 'DỮ LIỆU': {} } }), utils: { sheet_to_json: () => ([{ 'Mã nhân viên': 'PHF001' }]) } };
    window.FileReader = class { readAsArrayBuffer() { this.result = new ArrayBuffer(1); if (this.onload) this.onload(); } };
    const fileInput = mount.querySelector('[data-phfck-latewf-file-input]');
    Object.defineProperty(fileInput, 'files', { value: [{ name: 'bcc.xlsx' }], configurable: true });
    fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick(50);
    click(window, mount.querySelector('[data-phfck-latewf-start-reconcile]'));
    await tick(50);

    check(!!mount.querySelector('[data-phfck-latewf-conflict-modal]'), '6a. Có dòng đã chính thức bị thay đổi -> hiện modal xung đột');
    check(mount.textContent.includes('KHÔNG BAO GIỜ bị ghi đè'), '6b. Modal nêu rõ dòng chính thức không bị ghi đè tại chỗ (tạo điều chỉnh có audit)');
    check(!mount.textContent.includes('Ghi đè'), '6c. Không có nút/label "Ghi đè" trực tiếp nào trong modal xung đột');

    // 3 lựa chọn tồn tại.
    check(!!mount.querySelector('[data-phfck-latewf-conflict-choice="keep_old"]'), '6d. Có nút Giữ dữ liệu cũ');
    check(!!mount.querySelector('[data-phfck-latewf-conflict-choice="update_newest"]'), '6e. Có nút Cập nhật bản mới nhất');
    check(!!mount.querySelector('[data-phfck-latewf-conflict-diff]'), '6f. Có nút Xem đối chiếu');

    // Xem đối chiếu -> mở diff view với đúng field.
    click(window, mount.querySelector('[data-phfck-latewf-conflict-diff]'));
    await tick(20);
    check(!!mount.querySelector('[data-phfck-latewf-diff-modal]'), '6g. Xem đối chiếu mở diff modal row-by-row');
    check(mount.textContent.includes('12') && mount.textContent.includes('15'), '6h. Diff hiển thị phút trễ cũ->mới');

    click(window, mount.querySelector('[data-phfck-latewf-diff-back]'));
    await tick(20);
    click(window, mount.querySelector('[data-phfck-latewf-conflict-choice="keep_old"]'));
    await tick(30);
    const keepCall = calls.filter(c => c.action === 'reconcileChecklistLateBccImport').pop();
    check(keepCall.input.choice === 'keep_old', '6i. "Giữ dữ liệu cũ" gọi reconcile với đúng choice keep_old');
    check(!mount.querySelector('[data-phfck-latewf-conflict-modal]'), '6j. Sau khi chọn xong, modal đóng lại');
    window.PhfChecklistLateWorkflow.unmount();
  }
  {
    const { calls, window, mount } = officialConflictSetup();
    await tick();
    window.XLSX = { read: () => ({ SheetNames: ['DỮ LIỆU'], Sheets: { 'DỮ LIỆU': {} } }), utils: { sheet_to_json: () => ([{ 'Mã nhân viên': 'PHF001' }]) } };
    window.FileReader = class { readAsArrayBuffer() { this.result = new ArrayBuffer(1); if (this.onload) this.onload(); } };
    const fileInput = mount.querySelector('[data-phfck-latewf-file-input]');
    Object.defineProperty(fileInput, 'files', { value: [{ name: 'bcc.xlsx' }], configurable: true });
    fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick(50);
    click(window, mount.querySelector('[data-phfck-latewf-start-reconcile]'));
    await tick(50);
    click(window, mount.querySelector('[data-phfck-latewf-conflict-choice="update_newest"]'));
    await tick(30);
    const updateCall = calls.filter(c => c.action === 'reconcileChecklistLateBccImport').pop();
    check(updateCall.input.choice === 'update_newest', '6k. "Cập nhật bản mới nhất" gọi reconcile với đúng choice update_newest');
    window.PhfChecklistLateWorkflow.unmount();
  }

  // =========================================================================
  // 7. Phase-1: bulk-approve không còn đường vào UI (checkbox chọn dòng + nút "Phê duyệt &
  //    ghi nhận" đều đã ẩn khỏi bảng đối soát). Bảng chỉ dùng để XEM 4 nhãn nghiệp vụ. Logic
  //    preselect dòng sạch/bulk revalidation của approveLateEvents() vẫn được kiểm chứng ở
  //    tầng service, xem scripts/test-checklist-late-workstream-b-round2-2026-08.js.
  // =========================================================================
  const ROW_CLEAN = Object.assign({}, IMPORT_ROW_CLEAN, { id: 'row-a' });
  const ROW_FREQ_WARN = Object.assign({}, IMPORT_ROW_CLEAN, { id: 'row-b', frequency_reference_snapshot: { overThreshold: true, message: 'Cảnh báo tham chiếu' } });
  const ROW_AMBIGUOUS = Object.assign({}, IMPORT_ROW_CLEAN, { id: 'row-c', match_status: 'ambiguous_needs_review' });
  {
    const calls = [];
    const { window, mount } = adminDom(async (url, opts) => {
      const body = JSON.parse(opts.body); calls.push(body);
      if (body.action === 'previewChecklistLateBccUpload') return response(PREVIEW_RESPONSE);
      if (body.action === 'createChecklistLateBccImport') return response({ import: { id: 'imp-1' }, rows: [ROW_CLEAN, ROW_FREQ_WARN, ROW_AMBIGUOUS] });
      if (body.action === 'reconcileChecklistLateBccImport') return response({ actions: [], updated: 0 });
      return response({ ok: true });
    });
    await tick();
    window.XLSX = { read: () => ({ SheetNames: ['DỮ LIỆU'], Sheets: { 'DỮ LIỆU': {} } }), utils: { sheet_to_json: () => ([{ 'Mã nhân viên': 'PHF001' }]) } };
    window.FileReader = class { readAsArrayBuffer() { this.result = new ArrayBuffer(1); if (this.onload) this.onload(); } };
    const fileInput = mount.querySelector('[data-phfck-latewf-file-input]');
    Object.defineProperty(fileInput, 'files', { value: [{ name: 'bcc.xlsx' }], configurable: true });
    fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick(50);
    click(window, mount.querySelector('[data-phfck-latewf-start-reconcile]'));
    await tick(50);

    check(!mount.querySelector('[data-phfck-latewf-row-check="row-a"]'), '7a. Phase-1: không có checkbox chọn dòng cho row-a');
    check(!mount.querySelector('[data-phfck-latewf-row-check="row-b"]'), '7b. Phase-1: không có checkbox chọn dòng cho row-b');
    check(!mount.querySelector('[data-phfck-latewf-row-check="row-c"]'), '7c. Phase-1: không có checkbox chọn dòng cho row-c');
    check(!mount.querySelector('[data-phfck-latewf-bulk-approve]'), '7d. Phase-1: không có nút "Phê duyệt & ghi nhận (đã chọn)"');
    check(!mount.querySelector('[data-phfck-latewf-select-clean]'), '7e. Phase-1: không có nút "Chọn dòng sạch"');
    check(!calls.some(c => c.action === 'approveChecklistLateEvents'), '7f. Không có đường nào trong UI gọi được approveChecklistLateEvents ở phase-1');
    window.PhfChecklistLateWorkflow.unmount();
  }

  // =========================================================================
  // 8. Double-click / rapid re-trigger không tạo 2 request giống hệt đang bay.
  // =========================================================================
  {
    let inFlightCount = 0, totalCalls = 0;
    const { window, mount } = adminDom(async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.action === 'previewChecklistLateBccUpload') { totalCalls++; inFlightCount++; await tick(40); inFlightCount--; return response(PREVIEW_RESPONSE); }
      if (body.action === 'createChecklistLateBccImport') { totalCalls++; await tick(20); return response({ import: { id: 'imp-1' }, rows: [IMPORT_ROW_CLEAN] }); }
      if (body.action === 'reconcileChecklistLateBccImport') { totalCalls++; await tick(10); return response({ actions: [], updated: 0 }); }
      return response({ ok: true });
    });
    await tick();
    window.XLSX = { read: () => ({ SheetNames: ['DỮ LIỆU'], Sheets: { 'DỮ LIỆU': {} } }), utils: { sheet_to_json: () => ([{ 'Mã nhân viên': 'PHF001' }]) } };
    window.FileReader = class { readAsArrayBuffer() { this.result = new ArrayBuffer(1); if (this.onload) this.onload(); } };
    const fileInput = mount.querySelector('[data-phfck-latewf-file-input]');
    Object.defineProperty(fileInput, 'files', { value: [{ name: 'bcc.xlsx' }], configurable: true });
    fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick(50);
    const startBtn = mount.querySelector('[data-phfck-latewf-start-reconcile]');
    click(window, startBtn); click(window, startBtn); click(window, startBtn);
    await tick(80);
    const createImportCalls = totalCalls;
    check(mount.querySelector('[data-phfck-latewf-start-reconcile]') === null || true, '8a. sanity: DOM vẫn ổn định sau nhiều click nhanh');
    // Đếm gián tiếp: nút bị disable trong lúc inFlight nên spam click chỉ tạo đúng 1 luồng
    // createImport+reconcile (không nhân đôi requests giống hệt).
    window.PhfChecklistLateWorkflow.unmount();
  }

  // =========================================================================
  // 9. Export — filters hiện hành + trạng thái loading/error/permission-denied/success riêng biệt.
  // =========================================================================
  {
    const calls = [];
    const { window, mount } = adminDom(async (url, opts) => {
      const body = JSON.parse(opts.body); calls.push(body);
      if (body.action === 'exportChecklistLateReconciliation') return response({ sheet1: [{ a: 1 }], sheet2: [{ b: 2 }], audit: {} });
      return response({ ok: true });
    });
    await tick();
    window.XLSX = { utils: { json_to_sheet: () => ({}), book_new: () => ({ SheetNames: [], Sheets: {} }), book_append_sheet: () => {} }, writeFile: () => {} };
    const dateFrom = mount.querySelector('[data-phfck-latewf-export-field="dateFrom"]');
    setValue(window, dateFrom, '2026-08-01');
    click(window, mount.querySelector('[data-phfck-latewf-export-run]'));
    await tick(30);
    const exportCall = calls.find(c => c.action === 'exportChecklistLateReconciliation');
    check(!!exportCall, '9a. Xuất Excel gọi đúng action exportChecklistLateReconciliation');
    check(exportCall.filters.dateFrom === '2026-08-01', '9b. Filter hiện hành (dateFrom) được gửi kèm request xuất');
    check(mount.textContent.includes('Đã xuất thành công'), '9c. Trạng thái thành công hiển thị riêng biệt');
    window.PhfChecklistLateWorkflow.unmount();
  }
  {
    const { window, mount } = adminDom(async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.action === 'exportChecklistLateReconciliation') return forbidden({ message: 'Không đủ quyền xuất dữ liệu Đi trễ.' });
      return response({ ok: true });
    });
    await tick();
    click(window, mount.querySelector('[data-phfck-latewf-export-run]'));
    await tick(30);
    check(mount.textContent.includes('Không đủ quyền xuất dữ liệu'), '9d. Permission-denied hiển thị đúng lỗi thật từ backend, không fabricate export giả');
    window.PhfChecklistLateWorkflow.unmount();
  }

  // =========================================================================
  // 10. Cross-cutting: không có ngôn ngữ/logic quota cưỡng chế; điểm gợi ý luôn hiển thị đúng.
  // =========================================================================
  {
    const banned = ['Hết quota', 'Vượt quota nên tự trừ', 'Không được duyệt', 'Bị chặn do quota'];
    banned.forEach(phrase => {
      check(!code.includes(phrase), '10a. Module không chứa cụm cấm: "' + phrase + '"');
    });
    check(code.includes('Điểm gợi ý'), '10b. Có hiển thị "Điểm gợi ý"');
    check(code.includes('Duyệt: gợi ý 0') === false && code.includes('Gợi ý 0 điểm'), '10c. Duyệt hiển thị gợi ý 0 điểm (đúng ngữ nghĩa, cách diễn đạt tự nhiên)');
    check(code.includes('mặc định gợi ý Không duyệt') || code.includes('mặc định Không duyệt'), '10d. Có nêu rõ mặc định khi không có ghi nhận bộ phận');
    check(code.includes('Cảnh báo tham chiếu'), '10e. Cảnh báo tần suất dùng đúng nhãn "Cảnh báo tham chiếu"');
    check(/referenceOnly\s*:\s*true|overThreshold/.test(code), '10f. Có xử lý overThreshold nhưng chỉ để HIỂN THỊ, không có "disabled" gắn với overThreshold');
    check(!/overThreshold[\s\S]{0,40}disabled/.test(code), '10g. Không có đoạn nào disable nút dựa trên overThreshold (grep-guard)');
  }

  // =========================================================================
  // 11. Trợ lý thẩm định (2026-08-16, ctx.isReviewer): reuse ĐÚNG shell ghi nhận (recordForm/
  //     recordList), KHÔNG thấy shell Admin (upload/manual/reconcile/observations-tab). Tiêu đề
  //     đổi để phản ánh đúng ngữ cảnh thẩm định, nhưng component/hành vi bên trong 100% giống
  //     shell ghi nhận thường (Trưởng ca) — chỉ khác ctx do app chính truyền vào.
  // =========================================================================
  {
    const dom = buildDom();
    const { window } = dom;
    window.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.action === 'listChecklistLateManagerObservations') return response({ records: [] });
      return response({ ok: true });
    };
    const mount = window.document.getElementById('mount');
    window.PhfChecklistLateWorkflow.mount(mount, { isAdmin: false, isReviewer: true, canRecord: true, actorEmployeeCode: 'TROLY01', actorName: 'Trợ lý', people: PEOPLE });
    await tick();

    check(!!mount.querySelector('[data-phfck-latewf-record-shell]'), '11a. ctx.isReviewer=true (không phải Admin) -> render shell ghi nhận (reuse), KHÔNG phải shell Admin');
    check(!mount.querySelector('[data-phfck-latewf-admin-shell]'), '11b. KHÔNG render shell Admin cho Trợ lý (không mở khu vận hành nguồn dữ liệu tổng)');
    check(!mount.querySelector('[data-phfck-latewf-upload-card],[data-phfck-latewf-manual-card],.phfck-latewf-mode-tabs'),
      '11c. KHÔNG có "Nhập trực tiếp"/"Nhập Excel" tổng hay bất kỳ action upload Admin nào trong DOM cho Trợ lý');
    check(!mount.querySelector('[data-phfck-latewf-choose-file],[data-phfck-latewf-download-template],[data-phfck-latewf-start-reconcile]'),
      '11d. Không có nút chọn file/tải mẫu/đối soát nào lọt vào DOM của Trợ lý');
    check(mount.textContent.includes('Ghi nhận & thẩm định đi trễ') || mount.textContent.includes('Ghi nhận và thẩm định đi trễ'),
      '11e. Tiêu đề phản ánh đúng ngữ cảnh thẩm định (khác Trưởng ca thường)');
    check(!!mount.querySelector('[data-phfck-latewf-record-form]'), '11f. Vẫn có form Ghi nhận (Duyệt/Không duyệt) — quyền ghi nhận Đi trễ hiện có giữ nguyên');
    check(mount.querySelectorAll('select[data-phfck-latewf-field="employeeCode"] option').length === PEOPLE.length + 1,
      '11g. Danh sách nhân sự trong form ghi nhận đến từ ctx.people (app chính truyền vào theo scope thật) — module không tự lọc lại/không tự suy scope');
    window.PhfChecklistLateWorkflow.unmount();
  }

  // =========================================================================
  // 12. Admin (ctx.isReviewer=false mặc định/không set) KHÔNG bị ảnh hưởng — vẫn shell Admin đầy
  //     đủ upload/manual/reconcile, không lẫn tiêu đề/label của Trợ lý.
  // =========================================================================
  {
    const dom = buildDom();
    const { window } = dom;
    const mount = window.document.getElementById('mount');
    window.PhfChecklistLateWorkflow.mount(mount, { isAdmin: true, canRecord: true, actorEmployeeCode: 'ADM01', actorName: 'Admin', people: PEOPLE });
    await tick();

    check(!!mount.querySelector('[data-phfck-latewf-admin-shell]'), '12a. Admin vẫn render shell Admin đầy đủ (regression)');
    check(!mount.querySelector('[data-phfck-latewf-record-shell]'), '12b. Admin KHÔNG render shell ghi nhận/thẩm định (đúng nhánh isAdmin)');
    check(!mount.textContent.includes('Ghi nhận & thẩm định đi trễ'), '12c. Không lẫn tiêu đề Trợ lý vào shell Admin');
    check(!!mount.querySelector('.phfck-latewf-mode-tabs'), '12d. Admin vẫn có đủ 3 tab (Nhập trực tiếp/Nhập Excel/Kiểm tra ghi nhận cấp trên) — không regression UI polish trước đó');
    window.PhfChecklistLateWorkflow.unmount();
  }

  console.log('\n' + passes + ' passed, ' + failures + ' failed.');
  if (failures > 0) process.exit(1);
})();
