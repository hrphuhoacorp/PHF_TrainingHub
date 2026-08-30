'use strict';

/*
 * PHF Task — PROD REGRESSION: Proposal (Đề xuất) "Hạn hoàn thành" bị xóa
 * trắng khi bấm "Gửi đề xuất" → validate báo "Chọn deadline."
 *
 * ROOT CAUSE (proven): trong bindShell() root.oninput, handler control ngày-
 * giờ 24h dùng
 *     event.target.closest('[data-task-dt-field="' + dtField + '"]')
 * để tìm WRAPPER <div>. Nhưng các <input> con (date/hour/minute) CŨNG mang
 * attr data-task-dt-field (để đọc dtField từ event.target), nên closest()
 * khớp CHÍNH <input> đó. querySelector các part trên 1 <input> luôn trả
 * null → combineTaskDateTimeParts('','','') === '' → taskUiState.form[dtField]
 * bị set = '' mỗi lần gõ. Quick form không lộ bug vì có chip "Cuối ngày/…";
 * Full form (bắt buộc cho Đề xuất) không có chip → deadline không bao giờ
 * vào state.
 *
 * FIX: ràng 'div' vào selector — closest('div[data-task-dt-field="…"]') bỏ
 * qua <input>, bắt đúng wrapper <div>.
 *
 * jsdom, no network, no DB. Loads the REAL shipped file via window.eval.
 *   node scripts/test-task-proposal-deadline-persist-v1.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const TASK_APP_SRC = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'task', 'phf-task-app.js'), 'utf8');

let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }

function newWindow() {
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/admin/task/tao' });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = function () { return 'admin'; };
  window.phfGetCurrentUser = function () { return { fullName: 'QA', employeeCode: 'QA' }; };
  window.phfNavigate = function () { };
  window.phfToast = function () { };
  window.fetch = function () { throw new Error('no network in this test'); };
  window.eval(TASK_APP_SRC);
  return window;
}

function setPart(window, root, field, part, value) {
  const el = root.querySelector('[data-task-dt-field="' + field + '"][data-task-dt-part="' + part + '"]');
  assert.ok(el, 'dt input must exist: ' + field + '/' + part);
  el.value = value;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
}

(function () {
  const window = newWindow();
  const T = window.__PHF_TASK_TEST__;
  assert.ok(T, 'test hook exposed');
  const state = T.getState();
  const root = window.document.getElementById('phfTaskRoot');
  T.bindShell(root);

  /* ============================================================
     A) HANDLER — gõ date+hour+minute vào control 24h phải đẩy
        đúng chuỗi canonical vào taskUiState.form (đây là điểm fix).
     ============================================================ */
  state.form = T.defaultTaskForm();
  state.form.flow_type = 'de_xuat';
  state.form.start_at = '2026-08-20T08:00';
  root.innerHTML =
    '<form data-task-create-form>' +
    T.taskDateTimeFieldHtml('start_at', 'Bắt đầu', true) +
    T.taskDateTimeFieldHtml('deadline', 'Hạn hoàn thành', true) +
    '</form>';

  setPart(window, root, 'deadline', 'date', '2026-09-01');
  setPart(window, root, 'deadline', 'hour', '14');
  setPart(window, root, 'deadline', 'minute', '30');

  pass(state.form.deadline === '2026-09-01T14:30',
    'A1: gõ deadline date/giờ/phút → taskUiState.form.deadline = "2026-09-01T14:30" (trước fix: "" → "Chọn deadline.") — got ' + JSON.stringify(state.form.deadline));

  // sửa deadline KHÔNG được đụng vào start_at
  pass(state.form.start_at === '2026-08-20T08:00',
    'A2: chỉnh deadline không làm lệch start_at — got ' + JSON.stringify(state.form.start_at));

  // đổi start_at qua chính control đó cũng phải vào state, và không đụng deadline
  setPart(window, root, 'start_at', 'date', '2026-08-25');
  setPart(window, root, 'start_at', 'hour', '9');
  setPart(window, root, 'start_at', 'minute', '15');
  pass(state.form.start_at === '2026-08-25T09:15', 'A3: start_at cũng đi qua cùng handler và persist đúng — got ' + JSON.stringify(state.form.start_at));
  pass(state.form.deadline === '2026-09-01T14:30', 'A4: chỉnh start_at không xóa deadline — got ' + JSON.stringify(state.form.deadline));

  // hiển thị 24h dưới ô cũng phải cập nhật (không còn "Chưa chọn")
  const display = root.querySelector('[data-task-dt-display="deadline"]');
  pass(display && /01\/09\/2026 14:30/.test(display.textContent), 'A5: dòng hiển thị 24h dưới ô deadline cập nhật đúng — got ' + (display && display.textContent));

  /* ============================================================
     B) VALIDATION — form Đề xuất với deadline vừa nhập phải hợp lệ
        (không còn errors.deadline).
     ============================================================ */
  state.form.title = 'Đề xuất mua thiết bị';
  state.form.category_code = 'CAT1';
  state.form.primary_employee_code = 'PHF002';
  const checked = T.validateTaskForm(state.form);
  pass(!checked.errors.deadline, 'B1: validateTaskForm không còn báo lỗi deadline — got ' + JSON.stringify(checked.errors.deadline));
  pass(checked.valid, 'B2: toàn form Đề xuất hợp lệ — errors=' + JSON.stringify(checked.errors));

  /* ============================================================
     C) PAYLOAD — runCreateProposalFlow gửi đúng deadline ISO 1 lần.
     ============================================================ */
  const calls = [];
  const fakeCall = async function (payload) {
    calls.push(payload);
    if (payload.action === 'createTaskProposal') return { result: { id: 'prop-1', task_code: 'CV-2609-0001', row_version: 1 } };
    if (payload.action === 'getTaskDetail') return { result: { task: { id: 'prop-1', status: 'published' } } };
    throw new Error('unexpected action ' + payload.action);
  };
  return T.runCreateTaskFlow(checked.form, fakeCall).then(function (result) {
    const createCalls = calls.filter(c => c.action === 'createTaskProposal');
    pass(createCalls.length === 1, 'C1: đúng 1 request createTaskProposal (không nhân đôi) — got ' + createCalls.length);
    const expectedIso = T.serializeTaskLocalDateTime('2026-09-01T14:30');
    pass(createCalls[0].deadline === expectedIso, 'C2: payload.deadline = ISO của "2026-09-01T14:30" (' + expectedIso + ') — got ' + createCalls[0].deadline);
    pass(!!expectedIso && !/NaN|Invalid/.test(String(expectedIso)), 'C3: deadline ISO hợp lệ, không lệch timezone thành NaN/Invalid');
    pass(result.taskId === 'prop-1' && result.published === true, 'C4: proposal tạo xong, published=true');
  }).then(function () {

    /* ============================================================
       D) REGRESSION — Giao việc (full form) + chip deadline không hỏng.
       ============================================================ */
    // D1: full-form giao_viec, deadline qua composite control
    state.form = T.defaultTaskForm();
    state.form.flow_type = 'giao_viec';
    root.innerHTML = '<form data-task-create-form>' + T.taskDateTimeFieldHtml('deadline', 'Hạn hoàn thành', true) + '</form>';
    setPart(window, root, 'deadline', 'date', '2026-10-05');
    setPart(window, root, 'deadline', 'hour', '17');
    setPart(window, root, 'deadline', 'minute', '00');
    pass(state.form.deadline === '2026-10-05T17:00', 'D1: Giao việc — composite deadline vẫn persist — got ' + JSON.stringify(state.form.deadline));

    // D2: chip "Cuối ngày hôm nay" (đường tắt quick) vẫn set deadline
    state.form = T.quickTaskFormDefaults();
    state.view = 'create'; state.createTab = 'quick';
    root.innerHTML = T.createTaskHtml ? '<div>' + '</div>' : '';
    // gọi thẳng handler click chip qua bindShell: render quick form
    state.categories = [{ code: 'CAT1', name: 'DM1', isActive: true }];
    root.innerHTML = T.shellFrame(T.createTaskHtml());
    const chip = root.querySelector('[data-task-quick-deadline="eod"]');
    pass(!!chip, 'D2-setup: chip "Cuối ngày hôm nay" render trong quick form');
    chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    pass(/^\d{4}-\d{2}-\d{2}T23:59$/.test(state.form.deadline), 'D2: chip deadline vẫn hoạt động — got ' + JSON.stringify(state.form.deadline));

    /* ============================================================
       E) invalid input vẫn báo đúng loại lỗi (không "nuốt").
       ============================================================ */
    state.form = T.defaultTaskForm();
    state.form.flow_type = 'de_xuat';
    root.innerHTML = '<form data-task-create-form>' + T.taskDateTimeFieldHtml('deadline', 'Hạn hoàn thành', true) + '</form>';
    setPart(window, root, 'deadline', 'date', '2026-09-01');
    setPart(window, root, 'deadline', 'hour', '25'); // giờ không hợp lệ
    setPart(window, root, 'deadline', 'minute', '30');
    pass(state.form.deadline === '', 'E1: giờ ngoài 0–23 → combined "" (không bịa giá trị)');
    const bad = T.validateTaskForm(Object.assign(T.defaultTaskForm(), { flow_type: 'de_xuat', title: 'x', category_code: 'CAT1', primary_employee_code: 'PHF002', deadline: '' }));
    pass(bad.errors.deadline === 'Chọn deadline.', 'E2: deadline rỗng vẫn chặn submit đúng thông điệp (không bypass required)');

    console.log('\nPHF Task — Proposal deadline persist V1: ' + passed + '/' + passed + ' PASS');
  });
})().catch(function (err) {
  console.error('\nFAIL:', err && err.message);
  process.exit(1);
});
