'use strict';
/* KNL-06 — Framework Assignment Bulk UI (minimum spec, verdict C: REAL BULK
 * GAP — position assignment confirmed not to propagate to employees, see
 * spec+trace note). DOM-only regression: mounts the real "Gán & áp dụng" →
 * "Gán cho nhân sự" page, drives the new "Nhiều nhân sự" target-type mode
 * against a mocked fetch, and asserts: multi-select + dedupe, preview
 * classification (READY/UPDATE/REACTIVATE/PRIMARY_CONFLICT_RISK) from
 * already-loaded read-only data (no extra API call), stale-preview guard at
 * confirm-time, sequential (not Promise.all) per-row writes reusing the
 * EXISTING saveKnlFrameworkAssignment action only, partial-success handling,
 * per-row error mapping, double-submit guard via the shared confirm-modal
 * primitive, no native popups, Vietnamese-only labels, and that the existing
 * single-employee / position flows are unchanged. No backend file is
 * touched by this workstream — only assets/js/knl/phf-knl-app.js. */
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const rawCode = fs.readFileSync('assets/js/knl/phf-knl-app.js', 'utf8');
const css = fs.readFileSync('assets/css/phf-knl.css', 'utf8');
const EXPORT_MARKER = /\}\)\(\);\s*$/;
if (!EXPORT_MARKER.test(rawCode)) throw new Error('Expected file to end with "})();" — update injection marker.');
const code = rawCode.replace(EXPORT_MARKER,
  'window.__assignmentState=assignmentState;' +
  'window.__bulkAssignState=bulkAssignState;' +
  'window.__renderAssignmentBody=renderAssignmentBody;' +
  'window.__getAssignmentTargetTypeMode=function(){return assignmentTargetTypeMode;};' +
  '\n})();');

let passed = 0;
function check(cond, msg) { assert.ok(cond, msg); passed++; console.log('PASS', msg); }

function makeDom() {
  const dom = new JSDOM('<!doctype html><html><head><style>' + css + '</style></head><body><div id="root"><div data-knl-body></div></div></body></html>', { url: 'http://localhost/admin/knl/gan-ap-dung', runScripts: 'outside-only' });
  const { window } = dom;
  window.phfGetSessionRole = () => 'admin';
  window.phfGetCurrentUser = () => ({ id: 'admin-1', employeeCode: 'PHF000', name: 'Admin' });
  window.eval(code);
  return dom;
}

function installQueueFetch(window, log) {
  const queue = [];
  window.fetch = (url, opts) => {
    const body = JSON.parse(opts.body);
    if (log) log.push({ action: body.action, body, at: Date.now() });
    return new Promise((resolve, reject) => {
      queue.push({
        action: body.action, body,
        resolve: (respBody) => resolve({ ok: true, json: async () => Object.assign({ ok: true }, respBody) }),
        reject: (message, code) => reject(Object.assign(new Error(message), { code }))
      });
    });
  };
  return queue;
}

function fixtureFrameworks() {
  return [{ id: 'fw1', code: 'KNL01', name: 'Khung Bán hàng', status: 'active', versions: [{ id: 'v1', versionNumber: 1, status: 'published', isLocked: true }] }];
}
function fixturePeople() {
  return [
    { employeeCode: 'E1', employeeName: 'Nhân viên Một', title: 'Nhân viên' },
    { employeeCode: 'E2', employeeName: 'Nhân viên Hai', title: 'Nhân viên' },
    { employeeCode: 'E3', employeeName: 'Nhân viên Ba', title: 'Nhân viên' },
    { employeeCode: 'E4', employeeName: 'Nhân viên Bốn', title: 'Nhân viên' }
  ];
}
/* E2: đã có assignment ACTIVE đúng v1 -> UPDATE. E3: đã có assignment
 * INACTIVE đúng v1 -> REACTIVATE. E4: đã có primary ACTIVE khác version (v0)
 * -> chọn primary=true cho v1 sẽ PRIMARY_CONFLICT_RISK. E1: chưa có gì -> READY. */
function fixtureAssignments() {
  return [
    { id: 'a2', targetType: 'employee', employeeCode: 'E2', versionId: 'v1', isPrimary: false, status: 'active', frameworkCode: 'KNL01', frameworkName: 'Khung Bán hàng', versionNumber: 1 },
    { id: 'a3', targetType: 'employee', employeeCode: 'E3', versionId: 'v1', isPrimary: false, status: 'inactive', frameworkCode: 'KNL01', frameworkName: 'Khung Bán hàng', versionNumber: 1 },
    { id: 'a4', targetType: 'employee', employeeCode: 'E4', versionId: 'v0', isPrimary: true, status: 'active', frameworkCode: 'KNL01', frameworkName: 'Khung Bán hàng', versionNumber: 1 }
  ];
}
function mountAssignmentPage(window) {
  const root = window.document.getElementById('root');
  window.__assignmentState.subTab = 'gan-cho-nhan-su';
  window.__assignmentState.targets = { people: fixturePeople(), positions: [{ positionRef: 'pos1', position: 'Nhân viên', department: 'Bộ phận bán hàng', branch: 'Phú Lợi' }], organizationConflict: null };
  window.__assignmentState.frameworks = fixtureFrameworks();
  window.__assignmentState.assignments = fixtureAssignments();
  window.__assignmentState.loading = false;
  window.__renderAssignmentBody(root);
  return root;
}
function switchToBulkMode(window, root) {
  const typeSelect = root.querySelector('[data-knl-target-type]');
  typeSelect.value = 'bulk';
  typeSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
  return typeSelect;
}
function checkBulkPerson(window, root, code, checked) {
  const row = root.querySelector('[data-knl-bulk-person-row][data-code="' + code + '"]');
  const input = row.querySelector('input');
  input.checked = checked;
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
}
function fillCommonFields(window, root) {
  const fwSelect = root.querySelector('[data-knl-assign-framework]'), verSelect = root.querySelector('[data-knl-assign-version]');
  fwSelect.value = 'fw1'; fwSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
  verSelect.value = 'v1';
  root.querySelector('[data-knl-assign-reason]').value = 'Gán hàng loạt theo đợt onboarding 08/2026';
}

(async () => {
  /* ---- TEST A: render + mode toggle ---- */
  {
    const dom = makeDom(); const window = dom.window;
    installQueueFetch(window);
    const root = mountAssignmentPage(window);
    const typeSelect = root.querySelector('[data-knl-target-type]');
    check(typeSelect.innerHTML.includes('Nhiều nhân sự'), 'A1. Option "Nhiều nhân sự" render trong Đối tượng');
    check(root.querySelector('[data-knl-employee-target]').hidden === false, 'A2. Mặc định vẫn ở chế độ Nhân sự cụ thể (không regression)');
    switchToBulkMode(window, root);
    check(root.querySelector('[data-knl-bulk-target]').hidden === false, 'A3. Chọn "Nhiều nhân sự" hiện đúng block multi-select');
    check(root.querySelector('[data-knl-employee-target]').hidden === true && root.querySelector('[data-knl-position-target]').hidden === true, 'A4. Ẩn đúng 2 block Nhân sự cụ thể/Vị trí khi ở chế độ bulk');
    const submitBtn = root.querySelector('[data-knl-assignment-form] button[type="submit"]');
    check(submitBtn.textContent === 'Xem trước', 'A5. Nút submit đổi nhãn thành "Xem trước" ở chế độ bulk');
    check(window.__getAssignmentTargetTypeMode() === 'bulk', 'A6. State mode phản ánh đúng "bulk"');
  }

  /* ---- TEST B: multi-select + dedupe + count ---- */
  {
    const dom = makeDom(); const window = dom.window;
    installQueueFetch(window);
    const root = mountAssignmentPage(window);
    switchToBulkMode(window, root);
    checkBulkPerson(window, root, 'E1', true);
    checkBulkPerson(window, root, 'E2', true);
    check(root.querySelector('[data-knl-bulk-selected-count]').textContent === 'Đã chọn 2 nhân sự', 'B1. Đếm đúng số nhân sự đã chọn');
    checkBulkPerson(window, root, 'E1', false);
    check(root.querySelector('[data-knl-bulk-selected-count]').textContent === 'Đã chọn 1 nhân sự', 'B2. Bỏ chọn cập nhật đúng count');
    check(window.__bulkAssignState.selectedCodes.join(',') === 'E2', 'B3. State selectedCodes đúng sau chọn/bỏ chọn');
  }

  /* ---- TEST C: preview classification (READY/UPDATE/REACTIVATE/PRIMARY_CONFLICT_RISK) ---- */
  let domC, rootC;
  {
    const dom = makeDom(); const window = dom.window;
    const queue = installQueueFetch(window);
    const root = mountAssignmentPage(window);
    switchToBulkMode(window, root);
    ['E1', 'E2', 'E3', 'E4'].forEach(code => checkBulkPerson(window, root, code, true));
    fillCommonFields(window, root);
    root.querySelector('[name="assignRole"][value="primary"]').checked = true;
    const form = root.querySelector('[data-knl-assignment-form]');
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    check(queue.length === 0, 'C1. Bấm "Xem trước" KHÔNG gọi API nào (preview thuần read-only từ data đã có)');
    const p = window.__bulkAssignState.preview;
    check(!!p && p.rows.length === 4, 'C2. Preview có đúng 4 dòng đã chọn');
    const byCode = {}; p.rows.forEach(r => byCode[r.employeeCode] = r.cls);
    check(byCode.E1 === 'READY', 'C3. E1 (chưa có assignment) -> Sẵn sàng');
    check(byCode.E2 === 'UPDATE', 'C4. E2 (đã có active cùng version) -> Đã có, sẽ cập nhật');
    check(byCode.E3 === 'REACTIVATE', 'C5. E3 (đã có inactive cùng version) -> Đang ngưng, sẽ kích hoạt lại');
    check(byCode.E4 === 'PRIMARY_CONFLICT_RISK', 'C6. E4 (đã có primary active version khác, chọn primary mới) -> nguy cơ xung đột Bộ chính');
    const html = root.querySelector('[data-knl-body]').innerHTML;
    check(html.includes('Sẵn sàng: 1') && html.includes('Đã có — sẽ cập nhật: 1') && html.includes('Đang ngưng — sẽ kích hoạt lại: 1') && html.includes('Có nguy cơ xung đột Bộ chính: 1'), 'C7. Bảng tổng hợp preview hiển thị đúng số lượng từng loại');
    check(!/PROVISIONAL|CONFIRMED|is_primary|target_ref/.test(html), 'C8. Không leak technical field/enum lên preview');
    domC = dom; rootC = root;
  }

  /* ---- TEST D: đổi cấu hình sau preview -> Xác nhận bị chặn, không write, phải Xem trước lại ---- */
  {
    const window = domC.window, root = rootC;
    const queue = installQueueFetch(window);
    root.querySelector('[data-knl-assign-reason]').value = 'Lý do đã đổi sau khi xem trước';
    const confirmBtn = root.querySelector('[data-knl-bulk-confirm]');
    confirmBtn.click();
    check(queue.length === 0, 'D1. Đổi cấu hình sau preview rồi bấm Xác nhận KHÔNG gọi API nào');
    check(window.__bulkAssignState.preview === null, 'D2. Preview cũ bị hủy, buộc phải Xem trước lại');
    check(root.querySelector('[data-knl-body]').innerHTML.includes('Cấu hình hoặc danh sách đã thay đổi'), 'D3. Thông báo rõ ràng yêu cầu Xem trước lại (Việt hóa)');
  }

  /* ---- TEST E: submit thật — tuần tự (không Promise.all), partial success, per-row error, summary, no native popup ---- */
  {
    const dom = makeDom(); const window = dom.window;
    const queue = installQueueFetch(window);
    const root = mountAssignmentPage(window);
    switchToBulkMode(window, root);
    ['E1', 'E2'].forEach(code => checkBulkPerson(window, root, code, true));
    fillCommonFields(window, root);
    const form = root.querySelector('[data-knl-assignment-form]');
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    const confirmBtn = root.querySelector('[data-knl-bulk-confirm]');
    confirmBtn.click();
    const modalConfirm = window.document.querySelector('[data-modal-confirm]');
    check(!!modalConfirm, 'E1. Modal xác nhận nội bộ hiển thị (không dùng confirm() gốc)');
    modalConfirm.click();
    await new Promise(r => setTimeout(r, 5));
    check(queue.length === 1, 'E2. Chỉ gửi ĐÚNG 1 request đầu tiên trước — chứng minh tuần tự (KHÔNG Promise.all bắn đồng thời N request)');
    check(queue[0].action === 'saveKnlFrameworkAssignment', 'E3. Dùng đúng action ghi hiện có, không phải API bulk mới');
    check(queue[0].body.assignment.targetType === 'employee' && queue[0].body.assignment.targetRef === 'E1', 'E4. Row đầu đúng target E1');
    queue[0].resolve({ assignment: {} });
    await new Promise(r => setTimeout(r, 5));
    check(queue.length === 2, 'E5. Chỉ sau khi row 1 xong mới gửi tiếp row 2 (tuần tự đúng nghĩa)');
    check(queue[1].body.assignment.targetRef === 'E2', 'E6. Row 2 đúng target E2');
    queue[1].reject('Nhân sự đã có Bộ KNL chính đang áp dụng.', '23505');
    await new Promise(r => setTimeout(r, 5));
    check(queue.length === 3 && queue[2].action === 'listKnlFrameworkAssignments', 'E6b. Sau khi batch xong tự refresh lại danh sách "Đang áp dụng" (không API bulk mới, dùng đúng action đọc hiện có)');
    queue[2].resolve({ assignments: [] });
    await new Promise(r => setTimeout(r, 5));
    const finalHtml = root.querySelector('[data-knl-body]').innerHTML;
    check(finalHtml.includes('1/2 nhân sự đã gán thành công') && finalHtml.includes('1 nhân sự chưa xử lý được'), 'E7. Summary đúng partial-success (1 thành công, 1 thất bại)');
    check(finalHtml.includes('Nhân sự đã có Bộ KNL chính đang áp dụng'), 'E8. Lỗi per-row map đúng thông điệp Việt hóa, không leo raw constraint');
    check(!/23505|knl_assignment_primary_target_uq/.test(finalHtml), 'E9. Không leak mã lỗi/constraint kỹ thuật lên UI');
    check(window.__bulkAssignState.results.rows.length === 2 && window.__bulkAssignState.results.rows[0].status === 'success' && window.__bulkAssignState.results.rows[1].status === 'failed', 'E10. Per-row result lưu đúng trạng thái riêng biệt (partial, không fail toàn batch)');
  }

  /* ---- TEST F: double-submit guard qua modal confirm (settled one-shot) ---- */
  {
    const dom = makeDom(); const window = dom.window;
    const queue = installQueueFetch(window);
    const root = mountAssignmentPage(window);
    switchToBulkMode(window, root);
    checkBulkPerson(window, root, 'E1', true);
    fillCommonFields(window, root);
    root.querySelector('[data-knl-assignment-form]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    root.querySelector('[data-knl-bulk-confirm]').click();
    const modalConfirm = window.document.querySelector('[data-modal-confirm]');
    modalConfirm.click();
    modalConfirm.click();
    await new Promise(r => setTimeout(r, 5));
    check(queue.length === 1, 'F1. Bấm xác nhận 2 lần liên tiếp chỉ chạy batch đúng 1 lần (double-submit guard của modal)');
    queue[0].resolve({ assignment: {} });
  }

  /* ---- TEST G: flow đơn Nhân sự cụ thể KHÔNG regression ---- */
  {
    const dom = makeDom(); const window = dom.window;
    const queue = installQueueFetch(window);
    const root = mountAssignmentPage(window);
    const fwSelect = root.querySelector('[data-knl-assign-framework]'), verSelect = root.querySelector('[data-knl-assign-version]');
    fwSelect.value = 'fw1'; fwSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    verSelect.value = 'v1';
    root.querySelector('[name="employeeRef"]').value = 'E1';
    root.querySelector('[data-knl-assign-reason]').value = 'Gán riêng cho 1 nhân sự';
    root.querySelector('[data-knl-assignment-form]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 5));
    check(queue.length === 1 && queue[0].action === 'saveKnlFrameworkAssignment', 'G1. Flow đơn Nhân sự cụ thể vẫn gọi thẳng 1 lần, không đi qua preview/bulk engine');
    check(queue[0].body.assignment.targetType === 'employee' && queue[0].body.assignment.targetRef === 'E1', 'G2. Payload flow đơn employee giữ nguyên như trước');
  }

  /* ---- TEST H: flow đơn Vị trí tổ chức KHÔNG regression ---- */
  {
    const dom = makeDom(); const window = dom.window;
    const queue = installQueueFetch(window);
    const root = mountAssignmentPage(window);
    const typeSelect = root.querySelector('[data-knl-target-type]');
    typeSelect.value = 'position'; typeSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    check(root.querySelector('[data-knl-position-target]').hidden === false, 'H1. Chọn "Vị trí tổ chức" vẫn hiện đúng block vị trí (không regression)');
    const fwSelect = root.querySelector('[data-knl-assign-framework]'), verSelect = root.querySelector('[data-knl-assign-version]');
    fwSelect.value = 'fw1'; fwSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    verSelect.value = 'v1';
    root.querySelector('[name="positionRef"]').value = 'pos1';
    root.querySelector('[data-knl-assign-reason]').value = 'Gán theo vị trí tổ chức';
    root.querySelector('[data-knl-assignment-form]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 5));
    check(queue.length === 1 && queue[0].body.assignment.targetType === 'position' && queue[0].body.assignment.targetRef === 'pos1', 'H2. Flow đơn Vị trí vẫn gọi đúng payload cũ, không đổi hành vi position (vẫn KHÔNG tự propagate xuống nhân sự — không thuộc scope sửa ở đây)');
  }

  /* ---- TEST K: KNL-13 — wording đã Việt hóa, không còn "Vị trí organization" ---- */
  {
    const dom = makeDom(); const window = dom.window;
    installQueueFetch(window);
    const root = mountAssignmentPage(window);
    const html = root.querySelector('[data-knl-body]').innerHTML;
    check(html.includes('Vị trí tổ chức'), 'K1. (KNL-13) "Vị trí tổ chức" hiển thị đúng chỗ (option + note)');
    check(!html.includes('Vị trí organization'), 'K2. (KNL-13) Không còn user-facing "Vị trí organization" (English leak) trong DOM đã render');
    check(!/Vị trí organization/.test(rawCode), 'K3. (KNL-13) Không còn "Vị trí organization" trong toàn bộ source (đã thay bằng "Vị trí tổ chức")');
  }

  /* ---- TEST I: static checks — không Promise.all unbounded, không API mới, không native popup, Việt hóa ---- */
  {
    const bulkBlock = (rawCode.match(/async function runBulkAssignment[\s\S]*?\n\}/) || [''])[0];
    check(bulkBlock.length > 0, 'I1. (sanity) tìm thấy hàm runBulkAssignment trong source');
    check(!/Promise\.all\(/.test(bulkBlock), 'I2. runBulkAssignment KHÔNG dùng Promise.all (đúng yêu cầu không bắn đồng thời không giới hạn)');
    check(/for\s*\(var i=0;i<preview\.rows\.length;i\+\+\)/.test(bulkBlock) && /await apiPost\('saveKnlFrameworkAssignment'/.test(bulkBlock), 'I3. Vòng lặp tuần tự await từng row, dùng đúng action ghi hiện có');
    check(!/alert\(|confirm\(|window\.prompt\(/.test(bulkBlock), 'I4. runBulkAssignment không gọi native alert/confirm/prompt');
    const bindBulkBlock = (rawCode.match(/var bulkConfirm=root\.querySelector[\s\S]*?bindCompetencyAssignEvents\(root\);/) || [''])[0];
    check(!/\balert\(|\bconfirm\(|window\.prompt\(/.test(bindBulkBlock), 'I5. Toàn bộ binding bulk mới không dùng native alert/confirm/prompt (dùng openKnlConfirmModal)');
    check(/'saveKnlFrameworkAssignment'/.test(rawCode) && !/action:\s*'bulkSaveKnlFrameworkAssignment'|'saveKnlFrameworkAssignmentBulk'/.test(rawCode), 'I6. Không có action/API bulk mới nào được thêm — chỉ tái dùng saveKnlFrameworkAssignment hiện có');
    check(/Nhiều nhân sự/.test(rawCode) && /Đã có — sẽ cập nhật/.test(rawCode) && /Đang ngưng — sẽ kích hoạt lại/.test(rawCode) && /Có nguy cơ xung đột Bộ chính/.test(rawCode), 'I7. Toàn bộ label bulk 100% tiếng Việt');
  }

  console.log('\nKNL Framework Assignment Bulk UI:', passed, 'checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
