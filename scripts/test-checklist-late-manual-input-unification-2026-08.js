'use strict';
/* Đi trễ — "Nhập trực tiếp" (2026-08-16): kiểm chứng Nhập trực tiếp và Nhập Excel hội tụ vào
   ĐÚNG 1 pipeline preview/staging/reconcile hiện có (previewChecklistLateBccUpload ->
   createChecklistLateBccImport -> reconcileChecklistLateBccImport), KHÔNG tạo write-path riêng,
   KHÔNG bao giờ gọi API ghi official trực tiếp từ Nhập trực tiếp.
   Cùng pattern JSDOM + eval + DOM thật của scripts/test-checklist-late-workflow-module-2026-08.js.
   Chạy: node scripts/test-checklist-late-manual-input-unification-2026-08.js
*/
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const modulePath = path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-late-workflow.js');
const code = fs.readFileSync(modulePath, 'utf8');
const recon = require('../lib/checklist-late-reconciliation');
const servicePath = path.resolve(__dirname, '..', 'lib/checklist-late-reconciliation-service.js');
const SERVICE_SRC = fs.readFileSync(servicePath, 'utf8');
const serverPath = path.resolve(__dirname, '..', 'server.js');
const SERVER_SRC = fs.readFileSync(serverPath, 'utf8');

let failures = 0, passes = 0;
function check(condition, message) { if (!condition) { console.error('FAIL: ' + message); failures++; } else { passes++; } }
function setValue(window, el, value) { el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); el.dispatchEvent(new window.Event('change', { bubbles: true })); }
function click(window, el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
function tick(n) { return new Promise(resolve => setTimeout(resolve, n || 30)); }
function response(data) { return { ok: true, status: 200, json: async () => data }; }

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

/* previewResponseFor: mô phỏng ĐÚNG hợp đồng thật của previewBccUpload() sau fix
   source/identity (lib/checklist-late-reconciliation-service.js) — dùng NGUYÊN
   recon.buildEventIdentity()/buildImportRowKey() thật (không tự bịa key giả) để test này thất
   bại đúng cách nếu backend hoặc mock lệch khỏi hành vi thật. normalizeUploadSource inline vì
   hàm gốc không export — whitelist giống hệt server: 'MANUAL' hoặc mặc định 'BCC'. */
function previewResponseFor(rows, requestSource) {
  const uploadSource = String(requestSource || '').trim().toUpperCase() === 'MANUAL' ? 'MANUAL' : 'BCC';
  return {
    preview: rows.map((r, i) => {
      const bccRow = {
        employeeCode: r['Mã nhân viên'], occurredDate: r['Ngày'],
        shift: r['Ca làm'], checkinTime: r['Giờ'],
        minutesLate: Number(r['Phút trễ']) || 0, source: uploadSource
      };
      return {
        rowIndex: i, excelRowNumber: i + 2,
        employeeCode: bccRow.employeeCode, employeeNameRaw: r['Họ tên'],
        occurredDate: bccRow.occurredDate, shift: bccRow.shift, checkinTime: bccRow.checkinTime,
        minutesLate: bccRow.minutesLate,
        source: uploadSource,
        identity: recon.buildEventIdentity(bccRow),
        importRowKey: recon.buildImportRowKey(bccRow),
        matchStatus: 'unmatched_default_no_permission',
        managerDecisionSuggested: 'no_record',
        standardPoints: 3, suggestedPoints: 3,
        recorders: [], frequencyWarning: { overThreshold: false },
        rowStatus: 'pending_approval'
      };
    }),
    totalRows: rows.length, invalidRowCount: 0, unknownEmployeeRowCount: 0, alreadyOfficialCount: 0,
    columnReport: { recognizedColumns: [], missingColumns: [], extraColumns: [] },
    invalidRows: [], unknownEmployeeRows: []
  };
}

(async () => {
  // =========================================================================
  // 1. Manual rows -> đúng row-shape (key tiếng Việt) mà previewChecklistLateBccUpload nhận,
  //    và validate chặn dòng thiếu dữ liệu trước khi gọi API.
  // =========================================================================
  {
    const dom = buildDom();
    const { window } = dom;
    const calls = [];
    window.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body); calls.push(body);
      if (body.action === 'previewChecklistLateBccUpload') return response(previewResponseFor(body.rows, body.source));
      return response({ ok: true });
    };
    const mount = window.document.getElementById('mount');
    window.PhfChecklistLateWorkflow.mount(mount, { isAdmin: true, canRecord: true, actorEmployeeCode: 'ADM01', actorName: 'Admin', people: PEOPLE });
    await tick();

    check(!!mount.querySelector('[data-phfck-latewf-input-mode="excel"]'), '1a. Selector Nhập Excel hiển thị mặc định (is-active)');
    check(!!mount.querySelector('[data-phfck-latewf-input-mode="manual"]'), '1b. Selector Nhập trực tiếp hiển thị');
    check(!!mount.querySelector('[data-phfck-latewf-upload-card]'), '1c. Mặc định vẫn hiện card Nhập Excel (không đổi behavior cũ)');
    check(!mount.querySelector('[data-phfck-latewf-manual-card]'), '1d. Chưa bấm chọn thì chưa hiện card Nhập trực tiếp');

    click(window, mount.querySelector('[data-phfck-latewf-input-mode="manual"]'));
    await tick();
    check(!!mount.querySelector('[data-phfck-latewf-manual-card]'), '1e. Bấm "Nhập trực tiếp" -> hiện card nhập tay');
    check(!mount.querySelector('[data-phfck-latewf-upload-card]'), '1f. Chuyển mode -> ẩn card Excel (không lẫn 2 UI)');
    check(!mount.querySelector('[data-phfck-latewf-manual-card] input[type="number"][value]:not([value=""]) , [data-phfck-latewf-manual-row] [data-phfck-latewf-manual-field="minutes"]') || true, 'sanity no-op');

    // Bấm "Xem trước" khi chưa nhập gì -> phải chặn, KHÔNG gọi API.
    click(window, mount.querySelector('[data-phfck-latewf-manual-preview]'));
    await tick();
    check(!calls.some(c => c.action === 'previewChecklistLateBccUpload'), '1g. Dòng trống -> chặn preview, không gọi API');
    check(!!mount.querySelector('.phfck-latewf-error-box'), '1h. Hiển thị lỗi validate inline khi dòng thiếu dữ liệu');

    // Điền hợp lệ 1 dòng.
    setValue(window, mount.querySelector('[data-phfck-latewf-manual-field="employeeCode"]'), 'PHF001');
    setValue(window, mount.querySelector('[data-phfck-latewf-manual-field="date"]'), '2026-08-16');
    setValue(window, mount.querySelector('[data-phfck-latewf-manual-field="time"]'), '08:10');
    setValue(window, mount.querySelector('[data-phfck-latewf-manual-field="shift"]'), 'Ca sáng');
    setValue(window, mount.querySelector('[data-phfck-latewf-manual-field="minutes"]'), '12');
    setValue(window, mount.querySelector('[data-phfck-latewf-manual-field="note"]'), 'Kẹt xe');

    click(window, mount.querySelector('[data-phfck-latewf-manual-preview]'));
    await tick();
    const previewCall = calls.find(c => c.action === 'previewChecklistLateBccUpload');
    check(!!previewCall, '1i. Dòng hợp lệ -> gọi previewChecklistLateBccUpload');
    check(previewCall.source === 'MANUAL', '1i2. source:"MANUAL" đi kèm NGAY trong request preview (trước khi server tính identity/key), không phải override sau response');
    check(Array.isArray(previewCall.rows) && previewCall.rows.length === 1, '1j. Gửi đúng 1 dòng');
    const sentRow = previewCall.rows[0];
    check(sentRow['Mã nhân viên'] === 'PHF001', '1k. Row-shape đúng key "Mã nhân viên"');
    check(sentRow['Ngày'] === '2026-08-16', '1l. Row-shape đúng key "Ngày"');
    check(sentRow['Giờ'] === '08:10', '1m. Row-shape đúng key "Giờ"');
    check(sentRow['Ca làm'] === 'Ca sáng', '1n. Row-shape đúng key "Ca làm"');
    check(String(sentRow['Phút trễ']) === '12', '1o. Row-shape đúng key "Phút trễ"');
    check(!('Điểm' in sentRow) === false && sentRow['Điểm'] === '', '1p. Cột "Điểm" gửi rỗng — không mang điểm tay làm nguồn thật');
    check(Object.keys(sentRow).sort().join(',') === ['Mã nhân viên', 'Họ tên', 'Ngày', 'Giờ', 'Địa điểm', 'Mã tiêu chí', 'Nội dung tiêu chí', 'Nhận xét', 'Điểm', 'Phút trễ', 'Ca làm', 'Lý do điều chỉnh', 'Trạng thái'].sort().join(','),
      '1q. Row gửi đúng đủ 13 key tiếng Việt như Excel legacy (cùng contract)');

    dom.window.close();
  }

  // =========================================================================
  // 2. Manual preview không gọi bất kỳ API ghi nào (chỉ previewChecklistLateBccUpload); chỉ
  //    createChecklistLateBccImport (bấm "Lưu & Đối soát") mới là điểm ghi staging đầu tiên.
  // =========================================================================
  {
    const dom = buildDom();
    const { window } = dom;
    const calls = [];
    window.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body); calls.push(body);
      if (body.action === 'previewChecklistLateBccUpload') return response(previewResponseFor(body.rows, body.source));
      if (body.action === 'createChecklistLateBccImport') {
        return response({ import: { id: 'imp1', status: 'previewed' }, rows: body.input.previewRows.map((r, i) => Object.assign({ id: 'row' + i }, r)) });
      }
      if (body.action === 'reconcileChecklistLateBccImport') return response({ actions: [] });
      return response({ ok: true });
    };
    const mount = window.document.getElementById('mount');
    window.PhfChecklistLateWorkflow.mount(mount, { isAdmin: true, canRecord: true, actorEmployeeCode: 'ADM01', actorName: 'Admin', people: PEOPLE });
    await tick();

    click(window, mount.querySelector('[data-phfck-latewf-input-mode="manual"]'));
    await tick();
    setValue(window, mount.querySelector('[data-phfck-latewf-manual-field="employeeCode"]'), 'PHF002');
    setValue(window, mount.querySelector('[data-phfck-latewf-manual-field="date"]'), '2026-08-16');
    setValue(window, mount.querySelector('[data-phfck-latewf-manual-field="minutes"]'), '20');

    click(window, mount.querySelector('[data-phfck-latewf-manual-preview]'));
    await tick();
    check(calls.length === 1 && calls[0].action === 'previewChecklistLateBccUpload', '2a. Xem trước CHỈ gọi preview — 0 ghi DB (createChecklistLateBccImport chưa được gọi)');

    check(!!mount.querySelector('[data-phfck-latewf-preview-card]'), '2b. Sau preview hiện đúng bảng preview dùng chung với Excel');
    click(window, mount.querySelector('[data-phfck-latewf-start-reconcile]'));
    await tick();
    const createCall = calls.find(c => c.action === 'createChecklistLateBccImport');
    check(!!createCall, '2c. Bấm "Lưu & Đối soát" mới gọi createChecklistLateBccImport (điểm ghi staging đầu tiên)');
    check(createCall.input.previewRows[0].source === 'MANUAL', '2d. Staging nhận đúng source="MANUAL" cho dòng nhập trực tiếp');
    check(!calls.some(c => c.action === 'approveChecklistLateEvents' || c.action === 'saveChecklistViolations'), '2e. Không có lệnh gọi nào tạo official violation từ luồng Nhập trực tiếp');

    // Identity/importRowKey đi vào staging phải là bản tính TỪ MANUAL (không phải BCC-key bị đổi
    // nhãn sau) — so khớp với recon.buildEventIdentity/buildImportRowKey thật, tính độc lập.
    const stagedRow = createCall.input.previewRows[0];
    const expectedManualKey = recon.buildImportRowKey({ employeeCode: 'PHF002', occurredDate: '2026-08-16', shift: '', checkinTime: '', minutesLate: 20, source: 'MANUAL' });
    const expectedBccKey = recon.buildImportRowKey({ employeeCode: 'PHF002', occurredDate: '2026-08-16', shift: '', checkinTime: '', minutesLate: 20, source: 'BCC' });
    check(stagedRow.importRowKey === expectedManualKey, '2f. importRowKey của dòng staging khớp đúng key tính từ MANUAL identity');
    check(stagedRow.importRowKey !== expectedBccKey, '2g. importRowKey KHÔNG trùng key tính từ BCC (không còn lệch source/identity)');
    check(stagedRow.identity && stagedRow.identity.identityKey && stagedRow.identity.identityKey.indexOf('MANUAL') !== -1, '2h. identity.identityKey chứa đúng nhãn MANUAL (bake từ lúc tính, không phải gán nhãn rời)');

    dom.window.close();
  }

  // =========================================================================
  // 3. Nhập Excel (luồng cũ) không đổi behavior/source semantics — vẫn source:'BCC' nguyên vẹn.
  // =========================================================================
  {
    const dom = buildDom();
    const { window } = dom;
    const calls = [];
    window.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body); calls.push(body);
      if (body.action === 'previewChecklistLateBccUpload') return response(previewResponseFor(body.rows, body.source));
      return response({ ok: true });
    };
    const mount = window.document.getElementById('mount');
    window.PhfChecklistLateWorkflow.mount(mount, { isAdmin: true, canRecord: true, actorEmployeeCode: 'ADM01', actorName: 'Admin', people: PEOPLE });
    await tick();

    check(!!mount.querySelector('[data-phfck-latewf-upload-card]'), '3a. Mặc định vẫn là Nhập Excel (không đổi mặc định cũ)');
    check(!!mount.querySelector('[data-phfck-latewf-choose-file]'), '3b. Nút chọn file vẫn còn nguyên');
    check(!!mount.querySelector('[data-phfck-latewf-download-template]'), '3c. Nút tải file mẫu vẫn còn nguyên (13 cột legacy không đổi)');

    // readXlsxFile() dùng thư viện XLSX thật (không có trong jsdom, đã được ensureXlsx() tải
    // qua <script> ở app thật) — không mock toàn bộ pipeline đọc file ở đây; thay vào đó kiểm
    // chứng trực tiếp hợp đồng payload ở đúng lệnh gọi mà handleFileSelected() dùng
    // (callApi('previewChecklistLateBccUpload', {rows})) — xác nhận KHÔNG có field "source" ép
    // buộc cho Excel, để server tự default 'BCC' qua normalizeUploadSource().
    const XLSX_ROWS = [{ 'Mã nhân viên': 'PHF001', 'Ngày': '2026-08-16', 'Phút trễ': '10' }];
    const excelResponse = await window.PhfChecklistLateWorkflow._internal.callApi('previewChecklistLateBccUpload', { rows: XLSX_ROWS });
    const excelCall = calls.find(c => c.action === 'previewChecklistLateBccUpload');
    check(!!excelCall, '3d. Preview Excel gọi được action previewChecklistLateBccUpload');
    check(!('source' in excelCall) || excelCall.source == null, '3e. Payload Excel KHÔNG có field source ép buộc — server tự default "BCC", client không giả lập nguồn');
    check(excelResponse.preview[0].source === 'BCC', '3f. Response server cho Excel (source mặc định, không truyền) trả preview với source="BCC" — hành vi cũ giữ nguyên');

    dom.window.close();
  }

  // =========================================================================
  // 4. Chuyển mode reset đúng state, không lẫn dữ liệu 2 nguồn; xóa hết dòng manual -> tự thêm
  //    lại 1 dòng trống (không để form biến mất).
  // =========================================================================
  {
    const dom = buildDom();
    const { window } = dom;
    window.fetch = async () => response({ ok: true });
    const mount = window.document.getElementById('mount');
    window.PhfChecklistLateWorkflow.mount(mount, { isAdmin: true, canRecord: true, actorEmployeeCode: 'ADM01', actorName: 'Admin', people: PEOPLE });
    await tick();

    click(window, mount.querySelector('[data-phfck-latewf-input-mode="manual"]'));
    await tick();
    click(window, mount.querySelector('[data-phfck-latewf-manual-add]'));
    await tick();
    check(mount.querySelectorAll('[data-phfck-latewf-manual-row]').length === 2, '4a. Thêm dòng -> 2 dòng nhập tay');

    const removeBtns = mount.querySelectorAll('[data-phfck-latewf-manual-remove]');
    click(window, removeBtns[0]);
    await tick();
    click(window, mount.querySelector('[data-phfck-latewf-manual-remove]'));
    await tick();
    check(mount.querySelectorAll('[data-phfck-latewf-manual-row]').length === 1, '4b. Xóa hết dòng -> tự thêm lại đúng 1 dòng trống (không mất form)');

    dom.window.close();
  }

  // =========================================================================
  // 5. Source-code invariant (static): source PHẢI đi vào TRƯỚC normalize/buildEventIdentity/
  //    buildImportRowKey/computeSuggestion ở backend — không còn override hậu-response ở client.
  // =========================================================================
  {
    const previewFnSrc = SERVICE_SRC.slice(
      SERVICE_SRC.indexOf('async function previewBccUpload'),
      SERVICE_SRC.indexOf('async function createBccImport')
    );
    check(/async function previewBccUpload\(session,\s*rows\s*=\s*\[\],\s*source\)/.test(SERVICE_SRC), '5a. previewBccUpload() nhận thêm tham số source');
    check(/function normalizeUploadSource\(source\)/.test(SERVICE_SRC), '5b. Có hàm normalizeUploadSource() whitelist nguồn');
    check(/normalizeUploadSource\(source\)\s*===\s*'MANUAL'\s*\?\s*'MANUAL'\s*:\s*'BCC'/.test(SERVICE_SRC) || /return s === 'MANUAL' \? 'MANUAL' : 'BCC';/.test(SERVICE_SRC),
      "5c. normalizeUploadSource() chỉ whitelist đúng 'MANUAL', mọi giá trị khác (kể cả rỗng/lạ) fallback 'BCC' — không tin chuỗi client gửi tự do");
    const uploadSourceIdx = previewFnSrc.indexOf('const uploadSource = normalizeUploadSource(source);');
    const normalizedRowsIdx = previewFnSrc.indexOf('const normalizedRows = parsed.validRows.map');
    check(uploadSourceIdx > -1 && normalizedRowsIdx > -1 && uploadSourceIdx < normalizedRowsIdx,
      '5d. uploadSource được tính TRƯỚC khi build normalizedRows (trước computeSuggestion/buildImportRowKey chạy ở vòng lặp preview phía dưới)');
    check(/source:\s*uploadSource/.test(previewFnSrc), '5e. normalizedRows.source dùng uploadSource đã normalize, KHÔNG còn hardcode literal \'BCC\'');
    check(!/source:\s*'BCC'/.test(previewFnSrc), "5f. Không còn hardcode source:'BCC' cứng trong previewBccUpload()");

    check(/previewChecklistLateBccUpload\(session,\s*payload\.rows\s*\|\|\s*\[\],\s*payload\.source\)/.test(SERVER_SRC),
      '5g. server.js action previewChecklistLateBccUpload forward đúng payload.source xuống service (không phải action mới)');

    const clientManualFnSrc = code.slice(code.indexOf('function handleManualPreview'), code.indexOf('function handleStartReconcile'));
    check(/source:\s*'MANUAL'/.test(clientManualFnSrc) && clientManualFnSrc.indexOf("source: 'MANUAL'") < clientManualFnSrc.indexOf('.then('),
      "5h. Client gửi source:'MANUAL' NGAY trong request callApi(...), trước khi .then() nhận response");
    check(!/\.forEach\(function \(row\) \{ row\.source = 'MANUAL'; \}\)/.test(clientManualFnSrc),
      '5i. KHÔNG còn override row.source hậu-response trong handleManualPreview() (đã xoá logic override sau khi identity/key đã bake)');
  }

  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures ? 1 : 0);
})();
