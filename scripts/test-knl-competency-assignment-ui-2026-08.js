'use strict';
/* KNL-06 residual close-out — Competency Grade Assignment minimum UI (P0
 * completion blocker). Backend (lib/knl-competency.js, server.js, api/data.js)
 * was already live in Production before this workstream and is untouched.
 * DOM-only regression: mounts the real "Gán & áp dụng" assignment page,
 * drives the new "Gán bậc năng lực" sub-tab against a mocked fetch, and
 * asserts: current-state display (has/has-not assignment), framework →
 * version → grade cascade + prefill from current assignment, submit payload
 * shape, stale-response guard, double-submit guard, error passthrough
 * (backend already returns friendly Vietnamese text — UI must not re-map),
 * cache invalidation registration, and no native alert/confirm/prompt. */
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const rawCode = fs.readFileSync('assets/js/knl/phf-knl-app.js', 'utf8');
const css = fs.readFileSync('assets/css/phf-knl.css', 'utf8');
const EXPORT_MARKER = /\}\)\(\);\s*$/;
if (!EXPORT_MARKER.test(rawCode)) throw new Error('Expected file to end with "})();" — update injection marker.');
const code = rawCode.replace(EXPORT_MARKER,
  'window.__assignmentState=assignmentState;' +
  'window.__competencyAssignState=competencyAssignState;' +
  'window.__renderAssignmentBody=renderAssignmentBody;' +
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

/* FIFO queue fetch: mỗi lệnh gọi fetch được xếp hàng riêng biệt (không keyed
 * theo action) để test được thứ tự resolve KHÔNG theo thứ tự gọi — cần thiết
 * cho stale-response guard (đổi nhân sự nhanh, response cũ về sau). */
function installQueueFetch(window, log) {
  const queue = [];
  window.fetch = (url, opts) => {
    const body = JSON.parse(opts.body);
    if (log) log.push({ action: body.action, body: body, at: Date.now() });
    return new Promise((resolve, reject) => {
      queue.push({
        action: body.action, body: body,
        resolve: (respBody) => resolve({ ok: true, json: async () => Object.assign({ ok: true }, respBody) }),
        reject: (message, code) => reject(Object.assign(new Error(message), { code: code }))
      });
    });
  };
  return queue;
}

function baseFrameworks() {
  return [{ id: 'fw1', code: 'KNL01', name: 'Khung Bán hàng', status: 'active', versions: [{ id: 'v1', versionNumber: 1, status: 'RELEASED' }] }];
}
function basePeople() {
  return [
    { employeeCode: 'E1', employeeName: 'Nhân viên Một', title: 'Nhân viên' },
    { employeeCode: 'E2', employeeName: 'Nhân viên Hai', title: 'Trưởng ca' }
  ];
}
function mountAssignmentPage(window) {
  const root = window.document.getElementById('root');
  window.__assignmentState.subTab = 'bac-nang-luc';
  window.__assignmentState.targets = { people: basePeople(), positions: [], organizationConflict: null };
  window.__assignmentState.frameworks = baseFrameworks();
  window.__assignmentState.loading = false;
  window.__renderAssignmentBody(root);
  return root;
}

(async () => {
  /* ---- TEST A: nhân viên chưa có bậc năng lực (Case 1) ---- */
  {
    const dom = makeDom(); const window = dom.window;
    const queue = installQueueFetch(window);
    const root = mountAssignmentPage(window);
    check(!!root.querySelector('[data-comp-employee-select]'), 'A1. Section "Gán bậc năng lực" render employee select');
    const empSelect = root.querySelector('[data-comp-employee-select]');
    empSelect.value = 'E1';
    empSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    check(queue.length === 1 && queue[0].action === 'getKnlEmployeeCompetencyStandard', 'A2. Chọn nhân sự gọi đúng getKnlEmployeeCompetencyStandard');
    check(queue[0].body.employeeCode === 'E1', 'A3. Request đúng employeeCode đã chọn');
    queue[0].resolve({ employeeCode: 'E1', hasAssignment: false });
    await new Promise(r => setTimeout(r, 5));
    const html = root.querySelector('[data-knl-body]').innerHTML;
    check(html.includes('chưa có bậc năng lực nào được gán'), 'A4. Case 1 hiển thị đúng — chưa có assignment');
    check(!!root.querySelector('[data-comp-assign-form]'), 'A5. Form gán vẫn hiển thị dù chưa có assignment (tạo mới)');
  }

  /* ---- TEST B: nhân viên đã có bậc PROVISIONAL — prefill đúng ---- */
  let domB, rootB, queueB;
  {
    const dom = makeDom(); const window = dom.window;
    const queue = installQueueFetch(window);
    const root = mountAssignmentPage(window);
    const empSelect = root.querySelector('[data-comp-employee-select]');
    empSelect.value = 'E2';
    empSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    check(queue.length === 1, 'B1. Đổi nhân sự gọi 1 request getKnlEmployeeCompetencyStandard');
    queue[0].resolve({
      employeeCode: 'E2', hasAssignment: true,
      assignment: { frameworkVersionId: 'v1', competencyGradeId: 'g2', status: 'PROVISIONAL', effectiveFrom: '2026-08-01' },
      framework: { code: 'KNL01', name: 'Khung Bán hàng', versionNumber: 1 },
      currentGrade: { code: 'B2', number: 2, label: 'Bậc 2' }
    });
    await new Promise(r => setTimeout(r, 5));
    const summaryHtml = root.querySelector('[data-knl-body]').innerHTML;
    check(summaryHtml.includes('Khung Bán hàng') && summaryHtml.includes('Bậc 2') && summaryHtml.includes('Tạm thời') && summaryHtml.includes('2026-08-01'), 'B2. Khối "Bậc năng lực hiện tại" hiển thị đúng framework/bậc/trạng thái/ngày');
    check(/phfk-competency-current"><div class="phfk-section-head"><div><small>BẬC NĂNG LỰC HIỆN TẠI<\/small>/.test(summaryHtml), 'B2b. (fix#1) Nhãn "BẬC NĂNG LỰC HIỆN TẠI" dùng đúng pattern .phfk-section-head > div > small (khớp typography chuẩn KNL), không phải <small> trần trong .phfk-panel');
    check(queue.length === 2 && queue[1].action === 'getKnlGradeMatrix' && queue[1].body.versionId === 'v1', 'B3. Prefill tự động gọi getKnlGradeMatrix đúng version hiện tại');
    queue[1].resolve({ grades: [{ id: 'g1', gradeCode: 'B1', gradeNumber: 1, label: 'Bậc 1', sortOrder: 1 }, { id: 'g2', gradeCode: 'B2', gradeNumber: 2, label: 'Bậc 2', sortOrder: 2 }], requirements: [] });
    await new Promise(r => setTimeout(r, 5));
    const fwSelect = root.querySelector('[data-comp-assign-framework]'), verSelect = root.querySelector('[data-comp-assign-version]'), gradeSelect = root.querySelector('[data-comp-assign-grade]'), statusSelect = root.querySelector('[data-comp-assign-status]');
    check(fwSelect.value === 'fw1', 'B4. Prefill đúng Bộ KNL hiện tại');
    check(verSelect.value === 'v1', 'B5. Prefill đúng phiên bản hiện tại');
    check(gradeSelect.value === 'g2', 'B6. Prefill đúng bậc hiện tại');
    check(statusSelect.value === 'PROVISIONAL', 'B7. Prefill đúng trạng thái hiện tại (Tạm thời)');
    domB = dom; rootB = root; queueB = queue;
  }

  /* ---- TEST C: submit CONFIRM (PROVISIONAL -> CONFIRMED) đúng payload ---- */
  {
    const window = domB.window, root = rootB, queue = queueB;
    const statusSelect = root.querySelector('[data-comp-assign-status]');
    statusSelect.value = 'CONFIRMED';
    root.querySelector('[data-comp-assign-reason]').value = 'Xác nhận theo kết quả đánh giá quý 3/2026';
    const form = root.querySelector('[data-comp-assign-form]');
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 5));
    check(queue.length === 3 && queue[2].action === 'setKnlEmployeeCompetencyAssignment', 'C1. Submit gọi đúng setKnlEmployeeCompetencyAssignment');
    const payload = queue[2].body;
    check(payload.employeeCode === 'E2' && payload.frameworkVersionId === 'v1' && payload.competencyGradeId === 'g2' && payload.status === 'CONFIRMED', 'C2. Payload đúng employeeCode/version/grade/status=CONFIRMED');
    check(typeof payload.effectiveFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.effectiveFrom), 'C3. effectiveFrom mặc định đúng định dạng ngày hôm nay');
    check(payload.reason === 'Xác nhận theo kết quả đánh giá quý 3/2026', 'C4. Lý do được gửi đúng khi Xác nhận (CONFIRM cần reason)');
    const submitBtn = form.querySelector('button[type="submit"]');
    check(submitBtn.disabled === true, 'C5. Nút Lưu bị khóa (busy) trong lúc chờ phản hồi — chống double-submit');
    queue[2].resolve({ assignment: {} });
    await new Promise(r => setTimeout(r, 10));
    check(queue.length === 4 && queue[3].action === 'getKnlEmployeeCompetencyStandard', 'C6. Sau khi lưu thành công, tự refresh lại current assignment');
  }

  /* ---- TEST D: double-submit guard qua nút bị disable ---- */
  {
    const dom = makeDom(); const window = dom.window;
    const queue = installQueueFetch(window);
    const root = mountAssignmentPage(window);
    root.querySelector('[data-comp-employee-select]').value = 'E1';
    root.querySelector('[data-comp-employee-select]').dispatchEvent(new window.Event('change', { bubbles: true }));
    queue[0].resolve({ employeeCode: 'E1', hasAssignment: false });
    await new Promise(r => setTimeout(r, 5));
    const fwSelect = root.querySelector('[data-comp-assign-framework]'), verSelect = root.querySelector('[data-comp-assign-version]'), gradeSelect = root.querySelector('[data-comp-assign-grade]');
    fwSelect.value = 'fw1'; fwSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    verSelect.value = 'v1'; verSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    check(queue.length === 2 && queue[1].action === 'getKnlGradeMatrix', 'D1. Chọn phiên bản tự load danh sách bậc');
    queue[1].resolve({ grades: [{ id: 'g1', gradeCode: 'B1', gradeNumber: 1, label: 'Bậc 1', sortOrder: 1 }], requirements: [] });
    await new Promise(r => setTimeout(r, 5));
    gradeSelect.value = 'g1';
    root.querySelector('[data-comp-assign-reason]').value = 'Gán bậc khởi tạo';
    const form = root.querySelector('[data-comp-assign-form]'), btn = form.querySelector('button[type="submit"]');
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    check(queue.length === 3 && queue[2].action === 'setKnlEmployeeCompetencyAssignment', 'D2. Submit lần 1 gọi API');
    btn.click();
    check(queue.length === 3, 'D3. Click nút Lưu lần 2 khi đang busy KHÔNG tạo thêm request (double-submit guard)');
    queue[2].resolve({ assignment: {} });
    await new Promise(r => setTimeout(r, 10));
  }

  /* ---- TEST E: stale-response guard khi đổi nhân sự nhanh ---- */
  {
    const dom = makeDom(); const window = dom.window;
    const queue = installQueueFetch(window);
    const root = mountAssignmentPage(window);
    const empSelect = root.querySelector('[data-comp-employee-select]');
    empSelect.value = 'E1'; empSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    empSelect.value = 'E2'; empSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    check(queue.length === 2, 'E1. Đổi nhân sự nhanh phát 2 request độc lập');
    /* Resolve response THỨ 2 (E2) trước, response THỨ 1 (E1, đã stale) về sau */
    queue[1].resolve({ employeeCode: 'E2', hasAssignment: false });
    await new Promise(r => setTimeout(r, 5));
    queue[0].resolve({ employeeCode: 'E1', hasAssignment: true, assignment: { frameworkVersionId: 'v1', competencyGradeId: 'g1', status: 'CONFIRMED', effectiveFrom: '2020-01-01' }, framework: { code: 'KNL01', name: 'Khung Bán hàng', versionNumber: 1 }, currentGrade: { code: 'B1', number: 1, label: 'Bậc 1' } });
    await new Promise(r => setTimeout(r, 5));
    check(window.__competencyAssignState.selectedCode === 'E2', 'E2. Nhân sự đang chọn vẫn là E2 (không bị response cũ ghi đè)');
    check(window.__competencyAssignState.current.employeeCode === 'E2', 'E3. Response cũ (E1) về muộn KHÔNG ghi đè current của E2 đang xem');
  }

  /* ---- TEST F: error từ backend hiển thị nguyên văn (đã Việt hóa sẵn), không native popup ---- */
  {
    const dom = makeDom(); const window = dom.window;
    const queue = installQueueFetch(window);
    const root = mountAssignmentPage(window);
    let alertCalled = false; window.alert = () => { alertCalled = true; };
    const empSelect = root.querySelector('[data-comp-employee-select]');
    empSelect.value = 'E1'; empSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    queue[0].reject('Không thể chọn ngày hiệu lực trước ngày bắt đầu của giai đoạn đang áp dụng. Sửa 1 giai đoạn đã đóng là nghiệp vụ khác, chưa hỗ trợ.', 'KNL_COMPETENCY_RETROACTIVE_BEYOND_CURRENT_PERIOD');
    await new Promise(r => setTimeout(r, 5));
    const html = root.querySelector('[data-knl-body]').innerHTML;
    check(html.includes('Không thể chọn ngày hiệu lực trước ngày bắt đầu'), 'F1. Lỗi backend (đã map friendly ở lib/knl-competency.js) hiển thị nguyên văn, UI không tự map lại');
    check(!html.includes('KNL_COMPETENCY_RETROACTIVE_BEYOND_CURRENT_PERIOD'), 'F2. Không leak mã lỗi kỹ thuật lên UI');
    check(alertCalled === false, 'F3. Không dùng window.alert()');
  }

  /* ---- TEST H: đổi Phiên bản reset dropdown Bậc NGAY (loading + disabled) trước khi có response ---- */
  {
    const dom = makeDom(); const window = dom.window;
    const queue = installQueueFetch(window);
    const root = mountAssignmentPage(window);
    root.querySelector('[data-comp-employee-select]').value = 'E1';
    root.querySelector('[data-comp-employee-select]').dispatchEvent(new window.Event('change', { bubbles: true }));
    queue[0].resolve({ employeeCode: 'E1', hasAssignment: false });
    await new Promise(r => setTimeout(r, 5));
    const fwSelect = root.querySelector('[data-comp-assign-framework]'), verSelect = root.querySelector('[data-comp-assign-version]'), gradeSelect = root.querySelector('[data-comp-assign-grade]');
    fwSelect.value = 'fw1'; fwSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    verSelect.value = 'v1'; verSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    /* Kiểm tra NGAY (không await) — reset phải xảy ra đồng bộ trước khi request resolve */
    check(gradeSelect.disabled === true, 'H1. (fix#2) Dropdown Bậc bị khóa NGAY khi đổi Phiên bản, trước khi có response');
    check(gradeSelect.innerHTML.includes('Đang tải'), 'H2. (fix#2) Dropdown Bậc hiển thị "Đang tải…" NGAY, không còn option của trạng thái trước');
    check(queue.length === 2 && queue[1].action === 'getKnlGradeMatrix', 'H3. Request getKnlGradeMatrix đã được gửi song song với việc reset UI');
    queue[1].resolve({ grades: [{ id: 'g1', gradeCode: 'B1', gradeNumber: 1, label: 'Bậc 1', sortOrder: 1 }], requirements: [] });
    await new Promise(r => setTimeout(r, 5));
    check(gradeSelect.disabled === false, 'H4. Sau khi có response thành công, dropdown Bậc được mở khóa lại');
    check(gradeSelect.querySelectorAll('option').length === 2 && gradeSelect.innerHTML.includes('Bậc 1') && !gradeSelect.innerHTML.includes('Đang tải'), 'H5. Chỉ option của phiên bản mới được render, không còn "Đang tải…"/option cũ');
  }

  /* ---- TEST I: đổi Phiên bản 2 lần nhanh — response cũ (đến trễ) KHÔNG được ghi đè kết quả của lần chọn sau ---- */
  {
    const dom = makeDom(); const window = dom.window;
    const queue = installQueueFetch(window);
    const root = mountAssignmentPage(window);
    window.__assignmentState.frameworks = [{ id: 'fw1', code: 'KNL01', name: 'Khung Bán hàng', status: 'active', versions: [{ id: 'v1', versionNumber: 1, status: 'RELEASED' }, { id: 'v2', versionNumber: 2, status: 'RELEASED' }] }];
    window.__renderAssignmentBody(root);
    root.querySelector('[data-comp-employee-select]').value = 'E1';
    root.querySelector('[data-comp-employee-select]').dispatchEvent(new window.Event('change', { bubbles: true }));
    queue[0].resolve({ employeeCode: 'E1', hasAssignment: false });
    await new Promise(r => setTimeout(r, 5));
    const fwSelect = root.querySelector('[data-comp-assign-framework]'), verSelect = root.querySelector('[data-comp-assign-version]'), gradeSelect = root.querySelector('[data-comp-assign-grade]');
    fwSelect.value = 'fw1'; fwSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    verSelect.value = 'v1'; verSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    verSelect.value = 'v2'; verSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    check(queue.length === 3 && queue[1].body.versionId === 'v1' && queue[2].body.versionId === 'v2', 'I1. Đổi version 2 lần phát đúng 2 request tương ứng v1 rồi v2');
    /* Resolve v2 (mới nhất) TRƯỚC, v1 (cũ, đã stale) về SAU */
    queue[2].resolve({ grades: [{ id: 'g9', gradeCode: 'B9', gradeNumber: 9, label: 'Bậc 9 (v2)', sortOrder: 9 }], requirements: [] });
    await new Promise(r => setTimeout(r, 5));
    check(gradeSelect.innerHTML.includes('Bậc 9 (v2)') && gradeSelect.disabled === false, 'I2. Response v2 (mới nhất) render đúng, dropdown mở khóa');
    queue[1].resolve({ grades: [{ id: 'g1', gradeCode: 'B1', gradeNumber: 1, label: 'Bậc 1 (v1, STALE)', sortOrder: 1 }], requirements: [] });
    await new Promise(r => setTimeout(r, 5));
    check(!gradeSelect.innerHTML.includes('STALE') && gradeSelect.innerHTML.includes('Bậc 9 (v2)'), 'I3. (fix#2) Response v1 đến trễ KHÔNG ghi đè lại option của v2 đang hiển thị (stale-response guard cho grade select)');
    check(window.__competencyAssignState.gradesVersionId === 'v2', 'I4. State gradesVersionId vẫn giữ đúng version đang chọn (v2), không bị response cũ ghi đè');
  }

  /* ---- TEST J: lỗi khi load Bậc — không được giữ lại option cũ ---- */
  {
    const dom = makeDom(); const window = dom.window;
    const queue = installQueueFetch(window);
    const root = mountAssignmentPage(window);
    root.querySelector('[data-comp-employee-select]').value = 'E1';
    root.querySelector('[data-comp-employee-select]').dispatchEvent(new window.Event('change', { bubbles: true }));
    queue[0].resolve({ employeeCode: 'E1', hasAssignment: false });
    await new Promise(r => setTimeout(r, 5));
    const fwSelect = root.querySelector('[data-comp-assign-framework]'), verSelect = root.querySelector('[data-comp-assign-version]'), gradeSelect = root.querySelector('[data-comp-assign-grade]');
    fwSelect.value = 'fw1'; fwSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    verSelect.value = 'v1'; verSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    queue[1].resolve({ grades: [{ id: 'g1', gradeCode: 'B1', gradeNumber: 1, label: 'Bậc 1', sortOrder: 1 }], requirements: [] });
    await new Promise(r => setTimeout(r, 5));
    check(gradeSelect.innerHTML.includes('Bậc 1'), 'J1. (setup) Đã có option Bậc 1 hiển thị từ v1 trước khi test lỗi');
    /* Đổi sang phiên bản khác rồi để request lỗi — không được giữ lại "Bậc 1" cũ */
    verSelect.innerHTML += '<option value="v-broken">v-broken</option>';
    verSelect.value = 'v-broken'; verSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    queue[2].reject('Không thể tải danh sách bậc. Vui lòng thử lại.', 'KNL_COMPETENCY_GRADE_LOAD_FAILED');
    await new Promise(r => setTimeout(r, 5));
    check(gradeSelect.disabled === true, 'J2. (fix#2) Lỗi tải Bậc -> dropdown bị khóa, không cho chọn giá trị mơ hồ');
    check(!gradeSelect.innerHTML.includes('Bậc 1'), 'J3. (fix#2) Lỗi tải Bậc KHÔNG giữ lại option "Bậc 1" của version trước (không restore option cũ)');
    check(gradeSelect.innerHTML.includes('Không tải được'), 'J4. Hiển thị trạng thái lỗi rõ ràng trên chính dropdown');
  }

  /* ---- TEST G: static checks — cache invalidation, không native popup trong flow mới ---- */
  {
    const invalidatingSetLiteral = (rawCode.match(/KNL_INVALIDATING_ACTIONS\s*=\s*new Set\(\[[^\]]*\]\)/) || [''])[0];
    check(invalidatingSetLiteral.includes("'setKnlEmployeeCompetencyAssignment'"), 'G1. setKnlEmployeeCompetencyAssignment được đăng ký invalidate cache (Dashboard/khác không đọc dữ liệu cũ)');
    check(rawCode.includes("data-comp-assign-subtab") === false, 'G2. (sanity) không có leftover selector nhầm tên'); // guard against copy-paste typo
    const compBlock = (rawCode.match(/function bindCompetencyAssignEvents[\s\S]*?\n\}/) || [''])[0];
    check(!/\balert\(|\bconfirm\(|\bwindow\.prompt\(/.test(compBlock), 'G3. bindCompetencyAssignEvents không gọi alert()/confirm()/prompt()');
    check(/Tạm thời/.test(rawCode) && /Đã xác nhận/.test(rawCode), 'G4. Trạng thái Việt hóa (Tạm thời/Đã xác nhận), không leak PROVISIONAL/CONFIRMED lên label UI');
  }

  console.log('\nKNL Competency Assignment UI:', passed, 'checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
