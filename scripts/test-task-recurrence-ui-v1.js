'use strict';
/* PHF Task — RECURRENCE V1 FRONTEND (Increment 3 + 4) — jsdom DOM/logic
   regression. NO backend, NO network. Loads assets/js/task/phf-task-app.js in
   jsdom (same harness as scripts/test-task-create-ux-v1.js) and asserts:
     A. Full Create "Công việc lặp" controls (none/weekly/monthly, field
        reveal, month-end helper, no daily/yearly, Quick + Proposal clean)
     B. "Lịch lặp" management view renders the listTaskRecurrence DTO +
        per-flag actions + edit "future only" copy + stop confirmation copy
     C. buildRecurrencePayload maps the form + recurrence sub-form correctly
   Run: node scripts/test-task-recurrence-ui-v1.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'assets', 'js', 'task', 'phf-task-app.js'), 'utf8');
const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/admin/task/tao' });
const { window } = dom;
window.__PHF_TASK_TEST_MODE__ = true;
window.phfGetSessionRole = function () { return 'admin'; };
window.phfGetCurrentUser = function () { return { fullName: 'Test Admin', email: 'admin@test' }; };
window.phfNavigate = function () {};
window.phfToast = function () {};
window.eval(code);
const T = window.__PHF_TASK_TEST__;
assert.ok(T, 'window.__PHF_TASK_TEST__ must be exposed');

let passed = 0;
function pass(cond, msg) { assert.ok(cond, msg); passed += 1; }

/* ------------------------------------------------------------------ */
/* A. FULL CREATE — "Công việc lặp"                                    */
/* ------------------------------------------------------------------ */
(function () {
  const st = T.getState();
  st.form = T.defaultTaskForm();
  pass(st.form.recurrence && st.form.recurrence.mode === 'none', 'A0: default recurrence.mode is none');

  // default render: segmented control present, no detail fields
  let html = T.taskRecurrenceSectionHtml();
  pass(/data-task-recurrence-mode="none"/.test(html) && /data-task-recurrence-mode="weekly"/.test(html) && /data-task-recurrence-mode="monthly"/.test(html), 'A1: none/weekly/monthly segmented control rendered');
  pass(!/data-task-recurrence-field=/.test(html), 'A2: mode=none hides all recurrence detail fields');
  pass(!/data-task-recurrence-mode="daily"/.test(html) && !/data-task-recurrence-mode="yearly"/.test(html) && !/Hàng ngày/.test(html) && !/Hàng năm/.test(html), 'A3: daily/yearly never exposed');
  pass(!/end_date|Ngày kết thúc|Kết thúc lịch/.test(html), 'A4: no end-date control in V1');

  // weekly reveals weekday + start date + start time
  st.form.recurrence.mode = 'weekly';
  html = T.taskRecurrenceSectionHtml();
  pass(/data-task-recurrence-field="weekday"/.test(html) && /data-task-recurrence-field="start_date"/.test(html) && /data-task-recurrence-field="start_time"/.test(html), 'A5: weekly reveals weekday + start date + start time');
  pass(!/data-task-recurrence-field="day_of_month"/.test(html), 'A5b: weekly does NOT show day-of-month');
  pass(!/ngày cuối cùng của tháng/.test(html), 'A5c: weekly has no month-end helper');

  // monthly reveals day 1-31 + start + time + helper
  st.form.recurrence.mode = 'monthly';
  html = T.taskRecurrenceSectionHtml();
  pass(/data-task-recurrence-field="day_of_month"/.test(html) && /data-task-recurrence-field="start_date"/.test(html) && /data-task-recurrence-field="start_time"/.test(html), 'A6: monthly reveals day-of-month + start date + start time');
  pass(/<option value="31">31<\/option>/.test(html), 'A6b: monthly day supports 31');
  pass(/Nếu tháng không có ngày này, hệ thống sẽ chạy vào ngày cuối cùng của tháng\./.test(html), 'A6c: month-end helper text visible verbatim');

  // switch back to none hides details
  st.form.recurrence.mode = 'none';
  html = T.taskRecurrenceSectionHtml();
  pass(!/data-task-recurrence-field=/.test(html), 'A7: switching back to Không lặp hides detail fields');

  // Proposal: no recurrence controls
  st.form = T.defaultTaskForm();
  st.form.flow_type = 'de_xuat';
  html = T.taskRecurrenceSectionHtml();
  pass(!/data-task-recurrence-mode=/.test(html) && /Giao việc/.test(html), 'A8: Proposal (de_xuat) shows no recurrence controls');
  const fullHtml = T.createTaskFullFormHtml();
  pass(!/data-task-recurrence-mode="weekly"/.test(fullHtml), 'A8b: Full form for Proposal has no active recurrence controls');

  // Quick Create: no recurrence controls at all
  st.form = T.quickTaskFormDefaults();
  const quickHtml = T.createTaskQuickFormHtml();
  pass(!/data-task-recurrence/.test(quickHtml) && !/Công việc lặp/.test(quickHtml), 'A9: Quick Create has no recurrence controls');

  // Full form (giao_viec) embeds the section
  st.form = T.defaultTaskForm();
  const full2 = T.createTaskFullFormHtml();
  pass(/Công việc lặp/.test(full2) && /data-task-recurrence-mode="weekly"/.test(full2), 'A10: Full Create (Giao việc) embeds real recurrence controls');

  // "Số lần lặp" (finite repeat count) — same optional field for weekly + monthly
  st.form = T.defaultTaskForm();
  pass(st.form.recurrence.repeat_count === '', 'A11: default repeat_count is blank (indefinite)');
  // helper must sit INSIDE the "Số lần lặp" cell (directly under its input),
  // not after the grid / under "Giờ bắt đầu".
  function helperUnderRepeat(html) {
    const d = new (require('jsdom').JSDOM)('<!doctype html><body>' + html + '</body>').window.document;
    const input = d.querySelector('[data-task-recurrence-field="repeat_count"]');
    const note = d.querySelector('[data-task-recurrence-repeat-note]');
    if (!input || !note) return false;
    const cell = input.closest('label');
    return !!cell && cell.contains(note) && /Để trống nếu muốn lặp đến khi chủ động dừng\./.test(note.textContent)
      && input.compareDocumentPosition(note) & 0x04; // note follows input in the cell
  }
  st.form.recurrence.mode = 'weekly';
  let wkH = T.taskRecurrenceSectionHtml();
  pass(/data-task-recurrence-field="repeat_count"/.test(wkH) && /Số lần lặp/.test(wkH) && /Để trống nếu muốn lặp đến khi chủ động dừng\./.test(wkH), 'A12: weekly shows "Số lần lặp" + helper verbatim');
  pass(!/Số tuần/.test(wkH), 'A12b: not labelled "Số tuần"');
  pass(helperUnderRepeat(wkH), 'A12c: weekly — helper is a child of the "Số lần lặp" cell, right under its input');
  st.form.recurrence.mode = 'monthly';
  let moH = T.taskRecurrenceSectionHtml();
  pass(/data-task-recurrence-field="repeat_count"/.test(moH) && /Số lần lặp/.test(moH) && /Để trống nếu muốn lặp đến khi chủ động dừng\./.test(moH), 'A13: monthly shows the SAME "Số lần lặp" field + helper');
  pass(!/Số tháng/.test(moH), 'A13b: not labelled "Số tháng"');
  pass(helperUnderRepeat(moH), 'A13c: monthly — helper is a child of the "Số lần lặp" cell, right under its input');
  // the standalone "Để trống…" <p> after the grid must be gone
  pass(!/<p class="phft-field-hint">Để trống nếu muốn lặp/.test(wkH) && !/<p class="phft-field-hint">Để trống nếu muốn lặp/.test(moH), 'A13d: no orphan helper <p> after the grid');
})();

/* ------------------------------------------------------------------ */
/* B. "LỊCH LẶP" MANAGEMENT VIEW                                        */
/* ------------------------------------------------------------------ */
(function () {
  const st = T.getState();
  st.recurrenceManage = {
    loading: false, error: '', saving: false, confirmStop: null, editing: null,
    rules: [
      { id: 'r-active', title: 'Báo cáo tuần', content: '', category_code: 'CAT1', priority: 'thuong',
        related_employee_codes: [], primary_employee_code: 'NV002', primary_employee_name: 'Nguyễn A',
        cycle: 'Hàng tuần · Thứ 2', frequency: 'weekly', weekday: 'T2', day_of_month: null, start_time: '08:00',
        anchor_date: '2026-09-07', end_date: null, next_run_date: '2026-09-14', generated_count: 3,
        status: 'active', status_label: 'Đang hoạt động', can_edit: true, can_pause: true, can_resume: false, can_stop: true },
      { id: 'r-paused', title: 'Kiểm kho tháng', content: '', category_code: 'CAT2', priority: 'quan_trong',
        related_employee_codes: [], primary_employee_code: 'NV003', primary_employee_name: 'Trần B',
        cycle: 'Hàng tháng · Ngày 31', frequency: 'monthly', weekday: null, day_of_month: 31, start_time: '09:30',
        anchor_date: '2026-08-31', end_date: null, next_run_date: null, generated_count: 1,
        status: 'paused', status_label: 'Tạm dừng', can_edit: true, can_pause: false, can_resume: true, can_stop: true },
      { id: 'r-ended', title: 'Việc cũ', content: '', category_code: 'CAT1', priority: 'thuong',
        related_employee_codes: [], primary_employee_code: 'NV004', primary_employee_name: 'Lê C',
        cycle: 'Hàng tuần · Thứ 6', frequency: 'weekly', weekday: 'T6', day_of_month: null, start_time: '07:00',
        anchor_date: '2026-07-01', end_date: null, next_run_date: null, generated_count: 5,
        status: 'ended', status_label: 'Đã dừng', can_edit: false, can_pause: false, can_resume: false, can_stop: false }
    ]
  };
  let html = T.taskRecurrenceManageHtml();
  pass(/Lịch lặp/.test(html) && /Tên công việc/.test(html) && /Người nhận chính/.test(html) && /Chu kỳ/.test(html) && /Lần chạy kế tiếp/.test(html) && /Trạng thái/.test(html) && /Thao tác/.test(html), 'B1: management table renders the business columns');
  pass(/Báo cáo tuần/.test(html) && /Nguyễn A/.test(html) && /Hàng tuần · Thứ 2/.test(html) && /2026-09-14/.test(html), 'B2: active DTO row rendered');
  // active row: pause + edit + stop, NO resume
  const activeCell = html.split('data-task-recurrence-row="r-active"')[1].split('</tr>')[0];
  pass(/data-task-recurrence-manage-open="r-active"/.test(activeCell) && /data-task-recurrence-manage-action="pause"/.test(activeCell) && /data-task-recurrence-manage-action="stop"/.test(activeCell) && !/data-task-recurrence-manage-action="resume"/.test(activeCell), 'B3: active row has Edit/Pause/Stop, not Resume');
  const pausedCell = html.split('data-task-recurrence-row="r-paused"')[1].split('</tr>')[0];
  pass(/data-task-recurrence-manage-action="resume"/.test(pausedCell) && !/data-task-recurrence-manage-action="pause"/.test(pausedCell), 'B4: paused row has Resume, not Pause');
  const endedCell = html.split('data-task-recurrence-row="r-ended"')[1].split('</tr>')[0];
  pass(!/data-task-recurrence-manage-action="resume"/.test(endedCell) && !/data-task-recurrence-manage-open/.test(endedCell) && !/data-task-recurrence-manage-action=/.test(endedCell), 'B5: ended row has no resume/edit/create-future actions');
  pass(/Đã dừng/.test(endedCell), 'B5b: ended status label = "Đã dừng"');

  // stop confirmation copy
  st.recurrenceManage.confirmStop = 'r-active';
  html = T.taskRecurrenceManageHtml();
  pass(/Dừng lịch lặp này\?/.test(html) && /Các công việc đã được tạo trước đó sẽ không bị ảnh hưởng\./.test(html), 'B6: stop confirmation says generated Tasks unaffected (verbatim)');
  pass(/data-task-recurrence-stop-confirm="r-active"/.test(html) && /data-task-recurrence-stop-cancel/.test(html), 'B6b: stop confirm/cancel buttons present');
  st.recurrenceManage.confirmStop = null;

  // editor: future-only copy + fields
  T.openTaskRecurrenceEditor({ }, 'r-paused');
  pass(st.recurrenceManage.editing && st.recurrenceManage.editing.id === 'r-paused', 'B7: openTaskRecurrenceEditor loads the rule');
  html = T.taskRecurrenceEditorHtml(st.recurrenceManage.editing, st.recurrenceManage);
  pass(/Thay đổi chỉ áp dụng cho các kỳ chưa được tạo\./.test(html), 'B8: edit copy says future occurrences only (verbatim)');
  pass(/data-task-recurrence-edit-field="day_of_month"/.test(html) && /data-task-recurrence-edit-field="start_date"/.test(html) && /data-task-recurrence-edit-field="start_time"/.test(html) && /data-task-recurrence-edit-field="title"/.test(html), 'B8b: editor exposes title + schedule fields (monthly)');
  pass(/ngày cuối cùng của tháng/.test(html), 'B8c: monthly editor shows month-end helper');
  // editor for a rule that cannot be edited -> no-op
  st.recurrenceManage.editing = null;
  T.openTaskRecurrenceEditor({}, 'r-ended');
  pass(st.recurrenceManage.editing === null, 'B9: cannot open editor for an ended (can_edit=false) rule');
})();

/* ------------------------------------------------------------------ */
/* C. INTEGRATION — buildRecurrencePayload + validation                */
/* ------------------------------------------------------------------ */
(function () {
  const form = { title: 'CV lặp', content: 'ND', category_code: 'CAT1', priority: 'quan_trong', primary_employee_code: 'NV002', related_employee_codes: ['NV003'] };

  const weekly = T.buildRecurrencePayload(form, { mode: 'weekly', weekday: 'T4', day_of_month: 1, start_date: '2026-09-02', start_time: '08:30' });
  pass(weekly.action === 'createTaskRecurrence' && weekly.frequency === 'weekly' && weekly.weekday === 'T4' && weekly.day_of_month === undefined, 'C1: weekly payload — weekday preserved, no day_of_month');
  pass(weekly.start_date === '2026-09-02' && weekly.start_time === '08:30' && weekly.duration_days === 1, 'C1b: weekly payload — start date/time + duration_days=1');
  pass(weekly.title === 'CV lặp' && weekly.primary_employee_code === 'NV002' && weekly.category_code === 'CAT1' && weekly.priority === 'quan_trong' && JSON.stringify(weekly.related_employee_codes) === JSON.stringify(['NV003']), 'C1c: Task business fields reused from the form (no duplication)');

  const monthly = T.buildRecurrencePayload(form, { mode: 'monthly', weekday: 'T2', day_of_month: '31', start_date: '2026-09-15', start_time: '07:00' });
  pass(monthly.frequency === 'monthly' && monthly.day_of_month === 31 && monthly.weekday === undefined, 'C2: monthly payload — day 31 preserved as number 31, no weekday');

  pass(T.validateTaskRecurrenceInput({ mode: 'weekly', weekday: 'T2', start_date: '2026-09-02', start_time: '08:00' }) === '', 'C3: valid weekly passes client check');
  pass(!!T.validateTaskRecurrenceInput({ mode: 'daily', start_date: '2026-09-02', start_time: '08:00' }), 'C3b: daily rejected by client check');
  pass(!!T.validateTaskRecurrenceInput({ mode: 'monthly', day_of_month: 0, start_date: '2026-09-02', start_time: '08:00' }), 'C3c: monthly day 0 rejected');
  pass(!!T.validateTaskRecurrenceInput({ mode: 'weekly', weekday: 'T2', start_date: '', start_time: '08:00' }), 'C3d: missing start date rejected');

  // no Supabase / no recurrence pre-create hint in the client bundle
  pass(!/supabase/i.test(T.buildRecurrencePayload.toString()) && !/pre.?create/i.test(T.buildRecurrencePayload.toString()), 'C4: buildRecurrencePayload has no Supabase / pre-create logic');
})();

/* ------------------------------------------------------------------ */
/* D. TASK DETAIL — recurrence recognition badge                       */
/* ------------------------------------------------------------------ */
(function () {
  const badge = T.taskRecurrenceDetailBadgeHtml;
  // normal (non-recurring) Task -> nothing
  pass(badge({ task: { task_code: 'CV-1' } }) === '', 'D1: non-recurring Task -> no badge');
  pass(badge({ task: {}, recurrence: null }) === '', 'D1b: recurrence:null -> no badge');
  pass(badge({}) === '' && badge(undefined) === '', 'D1c: missing source -> no badge');

  // weekly, indefinite (initial claimed OR scheduler-generated: same DTO field)
  let h = badge({ task: {}, recurrence: { frequency: 'weekly', weekday: 'T2', day_of_month: null, rule_active: true, remaining_occurrences: null } });
  pass(/↻ Công việc lặp · Hàng tuần/.test(h) && !/còn/.test(h), 'D2: weekly badge copy "↻ Công việc lặp · Hàng tuần", no count when indefinite');

  // monthly
  h = badge({ task: {}, recurrence: { frequency: 'monthly', weekday: null, day_of_month: 31, rule_active: true, remaining_occurrences: null } });
  pass(/↻ Công việc lặp · Hàng tháng/.test(h), 'D3: monthly badge copy "↻ Công việc lặp · Hàng tháng"');

  // finite -> "· còn N lần"
  h = badge({ task: {}, recurrence: { frequency: 'weekly', weekday: 'T2', day_of_month: null, rule_active: true, remaining_occurrences: 3 } });
  pass(/↻ Công việc lặp · Hàng tuần · còn 3 lần/.test(h), 'D4: finite count appended truthfully "· còn 3 lần"');
  h = badge({ task: {}, recurrence: { frequency: 'monthly', weekday: null, day_of_month: 15, rule_active: false, remaining_occurrences: 0 } });
  pass(/· còn 0 lần/.test(h), 'D4b: remaining 0 shown truthfully (not hidden)');

  // no technical IDs anywhere in the badge, even if the DTO carried some
  h = badge({ task: {}, recurrence: { frequency: 'weekly', weekday: 'T2', remaining_occurrences: 2, rule_id: 'RID', occurrence_id: 'OID', recurring_series_id: 'SID', recurring_series_version: 7 } });
  pass(!/RID|OID|SID|series_id|rule_id|version|[0-9a-f]{8}-[0-9a-f]{4}/.test(h), 'D5: badge exposes no rule_id / occurrence_id / series_id / version');

  // unknown frequency -> nothing (defensive)
  pass(badge({ task: {}, recurrence: { frequency: 'daily', remaining_occurrences: 3 } }) === '', 'D6: unknown frequency -> no badge');

  // placement: rendered right after "Mã phiếu", inside .phft-task-code, before content <p>
  const st = T.getState();
  st.detail = { task: { task_code: 'CV-2608-9', title: 'Kiểm kho', content: 'x', status: 'published', row_version: 3, flow_type: 'giao_viec' }, category: {}, related: [], links: [], viewer: null,
    recurrence: { frequency: 'weekly', weekday: 'T2', day_of_month: null, rule_active: true, remaining_occurrences: 5 } };
  st.partialErrors = [];
  const detailHtml = T.detailContentHtml(st.detail, []);
  pass(/↻ Công việc lặp · Hàng tuần · còn 5 lần/.test(detailHtml), 'D7: badge appears in the real Task Detail render');
  const d = new (require('jsdom').JSDOM)('<!doctype html><body>' + detailHtml + '</body>').window.document;
  const codeLine = d.querySelector('.phft-task-code:not(.phft-recurrence-detail)');
  const badgeEl = d.querySelector('.phft-recurrence-detail');
  pass(codeLine && badgeEl && (codeLine.compareDocumentPosition(badgeEl) & 0x04), 'D7b: badge sits right after the "Mã phiếu" line');
  pass(/Mã phiếu/.test(codeLine.textContent), 'D7c: the preceding line is indeed "Mã phiếu"');

  // normal Task in the real render -> no badge element at all
  st.detail = { task: { task_code: 'CV-2608-1', title: 'Việc thường', content: 'y', status: 'published', row_version: 1, flow_type: 'giao_viec' }, category: {}, related: [], links: [], viewer: null };
  pass(!/phft-recurrence-detail/.test(T.detailContentHtml(st.detail, [])), 'D8: normal Task Detail render has no recurrence badge');
})();

console.log('PHF Task Recurrence UI (Increment 3+4): ' + passed + '/' + passed + ' PASS');
