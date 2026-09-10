'use strict';
/* PHF Task — TASK LIST EXPORT EXCEL V1 (2026-09-10) — jsdom logic/UI regression.

   Proves the "Xuất Excel" button on the Task list:
     A. PURE deadline-status derivation + export model builder (no ExcelJS, no net)
     B. taskExportFetchAllRows — export goes through the SAME signed listTasks()
        contract: workspace + search + Filter V1 forwarded verbatim, every page,
        NOT limited to the UI page size, capped only by the pre-existing
        descriptor-builder offset ceiling (and it says so honestly).
     C. exportTaskListExcel wiring — button markup, loading state, empty/error paths
     D. one real end-to-end workbook render (vendored ExcelJS) — headers/dates/
        numeric overdue-days come out usable
     E. Training Hub file (assets/js/phf-evaluation.js) is byte-for-byte untouched

   Harness pattern mirrors scripts/test-task-list-usability-ui-v1.js and
   scripts/test-knl-dashboard-export-2026-08.js. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { JSDOM } = require('jsdom');
const RealExcelJS = require('../assets/vendor/exceljs.min.js');

const ROOT = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'task', 'phf-task-app.js'), 'utf8');

let passed = 0;
function pass(c, m) { assert.ok(c, m); passed += 1; console.log('PASS: ' + m); }

const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/admin/task' });
const W = dom.window;
W.__PHF_TASK_TEST_MODE__ = true;
W.phfGetSessionRole = () => 'admin';
W.phfGetCurrentUser = () => ({ fullName: 'A', email: 'a@a' });
W.phfNavigate = () => {};
W.phfToast = () => {};
W.eval(code);
const T = W.__PHF_TASK_TEST__;
assert.ok(T, '__PHF_TASK_TEST__ exposed');

const DAY = 86400000;
const NOW = Date.parse('2026-09-10T00:00:00Z');

const ALLOWED_PAYLOAD_KEYS = new Set([
  'action', 'relation', 'status_filter', 'scope', 'search', 'limit', 'offset',
  'priority_filter', 'category_filter', 'creator_filter', 'primary_filter', 'deadline_from', 'deadline_to',
]);

function withFetch(pages) {
  const calls = [];
  let i = 0;
  W.fetch = async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    const page = pages[Math.min(i, pages.length - 1)];
    i += 1;
    return { ok: true, json: async () => ({ ok: true, result: page }) };
  };
  return calls;
}
function mkRows(n, offset) { return Array.from({ length: n }, (_, k) => ({ task_code: 'CV-' + (offset + k), title: 't', status: 'in_progress', deadline: null })); }

function sectionA() {
  const s = T.taskExportDeadlineStatus;
  let r = s({ status: 'in_progress', deadline: new Date(NOW - 5 * DAY).toISOString() }, NOW);
  pass(r.label === 'Quá hạn' && r.overdueDays === 5, 'A1: active past deadline -> "Quá hạn", overdueDays=5 (numeric)');
  r = s({ status: 'published', deadline: new Date(NOW + 3 * DAY).toISOString() }, NOW);
  pass(r.label === 'Chưa đến hạn' && r.overdueDays === 0, 'A2: active before deadline -> "Chưa đến hạn", 0');
  r = s({ status: 'completed', deadline: '2026-06-10T00:00:00Z', completed_at: '2026-06-08T00:00:00Z' }, NOW);
  pass(r.label === 'Hoàn thành đúng hạn' && r.overdueDays === 0, 'A3: completed before deadline stays "Hoàn thành đúng hạn" even though today > deadline');
  r = s({ status: 'completed', deadline: '2026-06-10T00:00:00Z', completed_at: '2026-06-13T00:00:00Z' }, NOW);
  pass(r.label === 'Quá hạn' && r.overdueDays === 3, 'A4: completed after deadline -> "Quá hạn", days = completed - deadline = 3');
  r = s({ status: 'completed', deadline: '2026-06-10T00:00:00Z', completed_at: null }, NOW);
  pass(r.label === 'Hoàn thành (không rõ thời điểm)' && r.overdueDays === null, 'A5: completed w/o completed_at -> honest distinct label, overdueDays=null (NOT guessed overdue by today)');
  r = s({ status: 'in_progress', deadline: null }, NOW);
  pass(r.label === 'Không có deadline' && r.overdueDays === null, 'A6: no deadline -> "Không có deadline", null');
  r = s({ status: 'cancelled', deadline: new Date(NOW - 30 * DAY).toISOString() }, NOW);
  pass(r.label === 'Đã hủy' && r.overdueDays === null, 'A7: cancelled -> "Đã hủy", null');
  r = s({ status: 'completed', deadline: '2026-06-10T00:00:00Z', completedAt: '2026-06-13T00:00:00Z' }, NOW);
  pass(r.label === 'Quá hạn' && r.overdueDays === 3, 'A8: completedAt (camelCase, bridge shape) also accepted');

  const cat = (x) => (x.category_code === 'BAO_CAO' ? 'Báo cáo' : x.category_code || '');
  const rows = [
    { task_code: 'CV-1', title: 'Việc A', status: 'in_progress', priority: 'khan_cap', category_code: 'BAO_CAO', created_at: '2026-09-01T00:00:00Z', deadline: new Date(NOW - 2 * DAY).toISOString(), completed_at: null, created_by: { full_name: 'Người Giao', department: 'Phòng KD' }, primary: { full_name: 'Người Làm', department: 'Phòng Kho' } },
    { task_code: 'CV-2', title: 'Việc B', status: 'completed', priority: 'thuong', category_code: 'KHAC', created_at: '2026-08-01T00:00:00Z', deadline: '2026-08-20T00:00:00Z', completed_at: '2026-08-18T00:00:00Z', created_by: { full_name: 'Sếp', department: 'Phòng KD' }, primary: null },
  ];
  const model = T.buildTaskExportModel(rows, cat, NOW);
  pass(JSON.stringify(model.headers) === JSON.stringify(T.TASK_EXPORT_HEADERS), 'A9: model headers === TASK_EXPORT_HEADERS');
  pass(model.headers.join('|') === 'Mã công việc|Tên công việc|Người giao|Người phụ trách chính|Phòng ban|Danh mục|Ưu tiên|Ngày tạo|Hạn hoàn thành|Ngày hoàn thành|Trạng thái|Tình trạng deadline|Số ngày quá hạn', 'A10: exact 13-column Vietnamese order matches the spec');
  const r0 = model.rows[0];
  pass(r0[0] === 'CV-1' && r0[1] === 'Việc A', 'A11: row0 code + title');
  pass(r0[2] === 'Người Giao' && r0[3] === 'Người Làm', 'A12: "Người giao"=creator, "Người phụ trách chính"=primary');
  pass(r0[4] === 'Phòng Kho', 'A13: "Phòng ban" from the PRIMARY (holder of the overdue work)');
  pass(r0[5] === 'Báo cáo', 'A14: "Danh mục" humanised via the passed category-label fn');
  pass(r0[6] === 'Khẩn cấp', 'A15: "Ưu tiên" Vietnamese label');
  pass(r0[7] === '01/09/2026' && r0[8] === '08/09/2026', 'A16: dates rendered dd/mm/yyyy');
  pass(r0[9] === '', 'A17: "Ngày hoàn thành" blank when not completed');
  pass(r0[10] === 'Đang thực hiện', 'A18: "Trạng thái" Vietnamese label');
  pass(r0[11] === 'Quá hạn' && r0[12] === 2 && typeof r0[12] === 'number', 'A19: "Tình trạng deadline"=Quá hạn, "Số ngày quá hạn"=2 (number)');
  const r1 = model.rows[1];
  pass(r1[4] === 'Phòng KD', 'A20: "Phòng ban" falls back to creator dept when no primary');
  pass(r1[9] === '18/08/2026' && r1[10] === 'Hoàn thành' && r1[11] === 'Hoàn thành đúng hạn' && r1[12] === 0, 'A21: completed-before-deadline row fully consistent');
  pass(/^PHF_Task_toi-nhan_\d{8}_\d{4}\.xlsx$/.test(T.taskExportFileName({ relation: 'received' })), 'A22: file name PHF_Task_<workspace>_<stamp>.xlsx');
  pass(T.taskExportDateDdMmYyyy('') === '' && T.taskExportDateDdMmYyyy(null) === '' && T.taskExportDateDdMmYyyy('nope') === '', 'A23: date formatter null/blank/garbage-safe');
}

async function sectionB() {
  let calls = withFetch([{ tasks: [], hasMore: false }]);
  await T.taskExportFetchAllRows({ relation: 'managed', scope: '', statusFilter: 'all', search: '', filters: T.defaultTaskListFilters() });
  pass(calls[0].relation === 'received' && calls[0].scope === 'managed', 'B1: managed workspace -> relation=received, scope=managed (same as loadTaskList)');

  calls = withFetch([{ tasks: [], hasMore: false }]);
  await T.taskExportFetchAllRows({ relation: 'managed', scope: 'cross_department', statusFilter: 'all', search: '', filters: T.defaultTaskListFilters() });
  pass(calls[0].scope === 'cross_department', 'B2: cross_department scope forwarded');

  calls = withFetch([{ tasks: mkRows(200, 0), hasMore: true }, { tasks: mkRows(10, 200), hasMore: false }]);
  const filters = Object.assign(T.defaultTaskListFilters(), { priority: 'khan_cap', category: 'BAO_CAO', deadlineFrom: '2026-09-01T00:00:00.000Z' });
  await T.taskExportFetchAllRows({ relation: 'received', scope: '', statusFilter: 'all', search: 'CV-2608', filters });
  pass(calls.length === 2, 'B3a: paged past the first page (2 requests)');
  pass(calls.every((c) => c.search === 'CV-2608'), 'B3b: current search sent on EVERY page');
  pass(calls.every((c) => c.priority_filter === 'khan_cap' && c.category_filter === 'BAO_CAO' && c.deadline_from), 'B3c: current Filter V1 values sent on EVERY page');

  calls = withFetch([{ tasks: mkRows(200, 0), hasMore: true }, { tasks: mkRows(200, 200), hasMore: true }, { tasks: mkRows(30, 400), hasMore: false }]);
  let out = await T.taskExportFetchAllRows({ relation: 'received', scope: '', statusFilter: 'all', search: '', filters: T.defaultTaskListFilters() });
  pass(out.rows.length === 430 && out.capped === false, 'B4a: 430 rows across 3 pages — far past the 50-row UI page, no truncation');
  pass(calls.every((c) => c.limit === T.TASK_EXPORT_PAGE_SIZE), 'B4b: every request uses limit=TASK_EXPORT_PAGE_SIZE (200)');
  pass(calls[1].offset === 200 && calls[2].offset === 400, 'B4c: offset advances by real row count (deterministic order)');

  withFetch([{ tasks: mkRows(200, 0), hasMore: false }]);
  out = await T.taskExportFetchAllRows({ relation: 'received', scope: '', statusFilter: 'all', search: '', filters: T.defaultTaskListFilters() });
  pass(out.rows.length === 200 && out.capped === false, 'B5: full page + hasMore=false -> stop, not capped');

  calls = withFetch([{ tasks: mkRows(200, 0), hasMore: true }]);
  out = await T.taskExportFetchAllRows({ relation: 'received', scope: '', statusFilter: 'all', search: '', filters: T.defaultTaskListFilters() });
  pass(out.capped === true, 'B6a: hitting the pre-existing offset ceiling returns capped=true (surfaced, not silent)');
  pass(out.rows.length === T.TASK_EXPORT_MAX_OFFSET, 'B6b: stops exactly at the offset ceiling (' + T.TASK_EXPORT_MAX_OFFSET + ')');
  pass(calls.length === T.TASK_EXPORT_MAX_OFFSET / T.TASK_EXPORT_PAGE_SIZE, 'B6c: bounded request count, no infinite loop');

  calls = withFetch([{ tasks: [], hasMore: false }]);
  await T.taskExportFetchAllRows({ relation: 'assigned', scope: '', statusFilter: 'all', search: 'x', filters: Object.assign(T.defaultTaskListFilters(), { creator: 'PHF001', primary: 'PHF080' }) });
  const keys = Object.keys(calls[0]);
  pass(keys.every((k) => ALLOWED_PAYLOAD_KEYS.has(k)), 'B7a: request carries ONLY the whitelisted keys loadTaskList() sends (' + keys.join(',') + ')');
  pass(!('assignee_employee_codes' in calls[0]) && !('requester' in calls[0]) && !('requesterEmployeeCode' in calls[0]), 'B7b: no client-supplied assignee/requester/scope identity — server descriptor stays the only authz boundary');

  calls = withFetch([{ tasks: mkRows(3, 0), hasMore: false }]);
  out = await T.taskExportFetchAllRows({ relation: 'managed', scope: '', statusFilter: 'cancelled', search: '', filters: T.defaultTaskListFilters() });
  pass(calls.every((c) => c.status_filter === 'cancelled') && out.rows.length === 3, 'B8: cancelled workspace tab still exports (status_filter=cancelled forwarded)');
}

function sectionC_markup() {
  const st = T.getState();
  st.list = T.defaultTaskListState();
  const html = T.taskListHtml();
  pass(/data-task-list-export/.test(html) && /Xuất Excel/.test(html), 'C1: toolbar renders one "Xuất Excel" button next to Search / Bộ lọc');
  pass(!/disabled/.test(html.split('data-task-list-export')[1].split('>')[0]), 'C2: button enabled by default');
  st.list.exporting = true;
  const busy = T.taskListHtml();
  pass(/disabled/.test(busy.split('data-task-list-export')[1].split('>')[0]) && /Đang xuất…/.test(busy), 'C3: while exporting -> button disabled + label "Đang xuất…"');
  st.list.exporting = false;
}

async function sectionC_flows() {
  const toasts = [];
  W.phfToast = (type, title, message) => toasts.push({ type, title, message });
  const st = T.getState();
  const root = { querySelector: () => null };

  st.list = Object.assign(T.defaultTaskListState(), { relation: 'received' });
  withFetch([{ tasks: [], hasMore: false }]);
  await T.exportTaskListExcel(root);
  pass(toasts.some((t) => /Không có dữ liệu/.test(t.title)) && st.list.exporting === false, 'C4: empty export -> "Không có dữ liệu" notice, exporting flag reset');

  toasts.length = 0;
  st.list = Object.assign(T.defaultTaskListState(), { relation: 'received' });
  W.fetch = async () => { throw Object.assign(new Error('boom'), { code: 'TASK_CAPABILITY_DENIED' }); };
  await T.exportTaskListExcel(root);
  pass(toasts.some((t) => t.type === 'error' && /Chưa thể xuất Excel/.test(t.title)), 'C5: export failure -> Vietnamese error toast');
  pass(st.list.exporting === false && /quyền/.test(st.list.exportError || ''), 'C6: exporting flag reset + readable exportError after failure');
}

async function sectionD() {
  const st = T.getState();
  st.list = Object.assign(T.defaultTaskListState(), { relation: 'received' });
  W.phfToast = () => {};
  if (!W.URL.createObjectURL) W.URL.createObjectURL = () => 'blob:fake';
  if (!W.URL.revokeObjectURL) W.URL.revokeObjectURL = () => {};
  // Load the SAME vendored bundle the page injects, INTO the jsdom realm, so the
  // model arrays and ExcelJS share a realm (matches production; avoids a
  // cross-realm `instanceof Array` false-negative that only exists in this test).
  W.eval(fs.readFileSync(path.join(ROOT, 'assets', 'vendor', 'exceljs.min.js'), 'utf8'));
  assert.ok(W.ExcelJS, 'D: vendored ExcelJS loaded into the jsdom window');
  let captured = null;
  const RealBlob = W.Blob;
  W.Blob = function (parts) { captured = parts[0]; return new RealBlob(parts, { type: 'x' }); };
  let downloadName = null;
  const origCreate = W.document.createElement.bind(W.document);
  W.document.createElement = function (tag) {
    const el = origCreate(tag);
    if (tag === 'a') { el.click = function () { downloadName = el.download; }; }
    return el;
  };

  withFetch([{
    tasks: [{ task_code: 'CV-9', title: 'Xuất thử', status: 'in_progress', priority: 'quan_trong', category_code: 'X', created_at: '2026-09-01T00:00:00Z', deadline: new Date(NOW - 4 * DAY).toISOString(), completed_at: null, created_by: { full_name: 'G', department: 'KD' }, primary: { full_name: 'L', department: 'Kho' } }],
    hasMore: false,
  }]);
  await T.exportTaskListExcel({ querySelector: () => null });

  pass(/^PHF_Task_toi-nhan_\d{8}_\d{4}\.xlsx$/.test(downloadName || ''), 'D1: real ExcelJS render produced a download with the expected file name (' + downloadName + ')');
  assert.ok(captured, 'D: workbook buffer captured');
  const wb = new RealExcelJS.Workbook();
  await wb.xlsx.load(captured);
  const ws = wb.worksheets[0];
  pass(JSON.stringify(ws.getRow(1).values.slice(1)) === JSON.stringify(T.TASK_EXPORT_HEADERS), 'D2: sheet row 1 = the 13 Vietnamese headers');
  const dataRow = ws.getRow(2).values.slice(1);
  pass(dataRow[7] === '01/09/2026', 'D3: "Ngày tạo" cell is a usable dd/mm/yyyy string');
  pass(dataRow[11] === 'Quá hạn' && typeof dataRow[12] === 'number' && dataRow[12] >= 4, 'D4: "Số ngày quá hạn" is a real number in the sheet (Excel-filterable), value=' + dataRow[12]);
  pass(!!ws.autoFilter && ws.views && ws.views[0] && ws.views[0].state === 'frozen', 'D5: header row has autofilter + frozen pane');
}

function sectionF() {
  // Filter-panel date-control layout regression (Operator, PROD): the global
  // `.phft-input{flex:0 1 320px}` was landing its flex-basis on the vertical
  // axis inside `.phft-lf-field` (flex-direction:column) and stretching
  // <input type="date"> into a ~320px-tall box on every Task-list workspace.
  const cssPath = path.join(ROOT, 'assets', 'css', 'phf-task.css');
  const css = fs.readFileSync(cssPath, 'utf8');
  const rule = (css.match(/\.phft-lf-field select,\.phft-lf-field input\{[^}]*\}/) || [''])[0];
  pass(/flex\s*:\s*(none|0 0 auto)/.test(rule), 'F1: .phft-lf-field select/input pin flex to natural height (neutralises the 320px flex-basis)');
  pass(/min-height\s*:\s*3[0-9]px/.test(rule), 'F2: date/select controls keep a normal input min-height (aligned with Priority/Category/Creator)');
  pass(!/\bheight\s*:\s*(100%|320px)/.test(rule), 'F3: no full-height / 320px stretch on the controls');

  // Same fix reaches every workspace because it targets the ONE shared panel class.
  const st = T.getState();
  ['received', 'assigned', 'managed'].forEach(function (rel) {
    st.list = Object.assign(T.defaultTaskListState(), { relation: rel, filterOpen: true, filterDraft: T.defaultTaskListFilters(), filterPeople: { loading: false, loaded: true, rows: [] } });
    const html = T.taskListFilterPanelHtml();
    pass(/class="phft-list-filter-panel"/.test(html) && /phft-lf-field/.test(html) && /type="date"[^>]*data-task-list-filter-field="deadlineFrom"/.test(html), 'F4-' + rel + ': ' + rel + ' workspace uses the shared .phft-list-filter-panel / .phft-lf-field markup (one fix covers all)');
  });

  // jsdom computed-style crosscheck (best-effort — skipped cleanly if jsdom
  // does not resolve the shorthand).
  try {
    const d2 = new JSDOM('<!doctype html><head><style>' + css + '</style></head><body>' +
      '<div class="phft-list-filter-panel"><div class="phft-list-filter-grid">' +
      '<label class="phft-lf-field"><span>Deadline từ ngày</span><input type="date" class="phft-input" id="di"></label>' +
      '<label class="phft-lf-field"><span>Ưu tiên</span><select class="phft-select" id="se"></select></label>' +
      '</div></div></body>');
    const cs = d2.window.getComputedStyle(d2.window.document.getElementById('di'));
    const basis = cs.flexBasis || cs.getPropertyValue('flex-basis');
    if (basis) pass(basis !== '320px', 'F5: computed flex-basis of the date input is not 320px (' + basis + ')');
    else console.log('SKIP: F5 (jsdom did not resolve flex-basis)');
  } catch (e) {
    console.log('SKIP: F5 (' + e.message + ')');
  }
}

function sectionE() {
  const diff = execFileSync('git', ['-C', ROOT, 'diff', '--stat', 'origin/main', '--', 'assets/js/phf-evaluation.js'], { encoding: 'utf8' }).trim();
  pass(diff === '', 'E1: assets/js/phf-evaluation.js has ZERO diff vs origin/main');
  const evalSrc = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'phf-evaluation.js'), 'utf8');
  pass(/const startValue = profile && profile\.studyStartDate;/.test(evalSrc), 'E2: locked rule still present (no fallback)');
  pass(!/startValue\s*=\s*\(profile && profile\.studyStartDate\)\s*\|\|\s*phfGetStudyStartValue\(\)/.test(evalSrc), 'E3: phfGetStudyStartValue() fallback NOT reintroduced');
}

(async function run() {
  sectionA();
  await sectionB();
  sectionC_markup();
  await sectionC_flows();
  await sectionD();
  sectionF();
  sectionE();
  console.log('\nPHF Task List Export Excel V1: ' + passed + '/' + passed + ' PASS');
})().catch((err) => { console.error('\nFAIL:', err && err.message ? err.message : err); process.exit(1); });
