'use strict';
/* PHF Task — UI/UX Step 5/5A/5B workspace visual contract (frontend only).
   Loads assets/js/task/phf-task-app.js in jsdom, renders the SHARED
   taskListHtml() for each relation and asserts the presentation contract:
   category chip, semantic status/priority badges, humanized enums, compact
   cross-department chip, progress column, in-tbody empty state, deliberate
   column widths, footer count. No backend, no network, no mutation. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'assets', 'js', 'task', 'phf-task-app.js'), 'utf8');

const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/admin/task/toi-nhan' });
const { window } = dom;
window.__PHF_TASK_TEST_MODE__ = true;
window.phfGetSessionRole = () => 'admin';
window.phfGetCurrentUser = () => ({ fullName: 'Test Admin', email: 'admin@test' });
window.phfNavigate = () => {};
window.phfToast = () => {};
window.eval(code);
const T = window.__PHF_TASK_TEST__;
assert.ok(T, 'test hook window.__PHF_TASK_TEST__ must be exposed');

let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }

const state = T.getState();
function listWith(relation, rows, extra) {
  state.list = Object.assign(T.defaultTaskListState(), { relation, tasks: rows, loading: false }, extra || {});
  return T.taskListHtml();
}
const baseRow = (o) => Object.assign({
  task_id: 't1', task_code: 'CV-2608-0001', title: 'Đối chiếu công nợ tháng 8',
  status: 'in_progress', priority: 'quan_trong', deadline: '2099-01-01T00:00:00.000Z',
  category_code: 'Tài chính', progress_percent: 40,
  created_by: { full_name: 'Nguyễn Văn A', department: 'Bộ phận Tài chính Kế toán' },
  primary: { full_name: 'Trần Thị B', department: 'Bộ phận Tài chính Kế toán' },
}, o || {});

/* ---- 1) category chip ---- */
{
  const html = listWith('received', [baseRow()]);
  pass(/<span class="phft-cat-chip">Tài chính<\/span>/.test(html), 'CATEGORY: renders as a .phft-cat-chip identifier, not bare text');
}
{
  // slug-style code + loaded category list → humanised name
  state.categories = [{ code: 'BAO_CAO', name: 'Báo cáo' }];
  const html = listWith('received', [baseRow({ category_code: 'BAO_CAO' })]);
  pass(/phft-cat-chip">Báo cáo</.test(html) && !/BAO_CAO/.test(html), 'CATEGORY: raw slug humanised via the category lookup (no raw enum leaks)');
  state.categories = [];
}

/* ---- 2) priority badge (existing contract, instantly recognisable) ---- */
{
  pass(/phft-prio-badge tone-orange[^>]*>(<i class="phft-dot"><\/i>)?Quan trọng/.test(listWith('received', [baseRow({ priority: 'quan_trong' })])), 'PRIORITY: quan_trong → orange "Quan trọng" pill');
  pass(/phft-prio-badge tone-red[^>]*>(<i class="phft-dot"><\/i>)?Khẩn cấp/.test(listWith('received', [baseRow({ priority: 'khan_cap' })])), 'PRIORITY: khan_cap → red "Khẩn cấp" pill');
  pass(/phft-prio-badge tone-gray[^>]*>(<i class="phft-dot"><\/i>)?Thường/.test(listWith('received', [baseRow({ priority: 'thuong' })])), 'PRIORITY: thuong → neutral "Thường" pill');
  pass(/phft-cellmuted">weird_value</.test(listWith('received', [baseRow({ priority: 'weird_value' })])), 'PRIORITY: unknown value shown verbatim + muted (no guess)');
}

/* ---- 3) status badge tone (label text unchanged) ---- */
{
  pass(/phft-badge tone-blue">Đang làm</.test(listWith('received', [baseRow({ status: 'in_progress', deadline: '2099-01-01T00:00:00.000Z' })])), 'STATUS: open + future deadline → blue "Đang làm"');
  pass(/phft-badge tone-red">Quá hạn</.test(listWith('received', [baseRow({ status: 'in_progress', deadline: '2000-01-01T00:00:00.000Z' })])), 'STATUS: open + past deadline → red "Quá hạn"');
  pass(/phft-badge tone-green">Hoàn thành</.test(listWith('received', [baseRow({ status: 'completed' })])), 'STATUS: completed → green "Hoàn thành"');
  pass(/phft-badge tone-orange">Cần xử lý lại</.test(listWith('managed', [baseRow({ status: 'completed', rework_state: 'requested' })])), 'STATUS: rework_state=requested → orange "Cần xử lý lại"');
  pass(/phft-badge tone-gray">Đã hủy</.test(listWith('received', [baseRow({ status: 'cancelled' })])), 'STATUS: cancelled → gray "Đã hủy"');
  pass(/phft-badge tone-blue">Đang chờ xử lý</.test(listWith('proposal_sent', [baseRow({ flow_type: 'de_xuat', proposal_status: 'pending' })])), 'STATUS: proposal pending → blue "Đang chờ xử lý"');
}

/* ---- 4) status and progress are SEPARATE, progress has its own column ---- */
{
  const html = listWith('received', [baseRow({ progress_percent: 40 })]);
  pass(/<th>Tiến độ<\/th>/.test(html), 'PROGRESS: dedicated "Tiến độ" column header');
  pass(/phft-prog-track"><i style="width:40%"><\/i><\/span><b>40%<\/b>/.test(html), 'PROGRESS: mini bar + value in its own cell');
  pass(!/Đang làm<\/span> · 40%|Đang làm · 40%/.test(html), 'PROGRESS: no "status · N%" mash in the status cell');
  pass(/phft-cellmuted">—<\/span><\/td>\s*<\/tr>/.test(listWith('received', [baseRow({ progress_percent: undefined })])), 'PROGRESS: missing progress → "—" (calculation untouched, only shown when numeric)');
}

/* ---- 5) compact cross-department chip; full route only in title ---- */
{
  const html = listWith('managed', [baseRow({ is_cross_department: true, source_department: 'Ban giám đốc', target_department: 'Bộ phận Quản trị tổng hợp' })]);
  pass(/<span class="phft-cross-dept-tag" title="Liên phòng ban: Ban giám đốc → Bộ phận Quản trị tổng hợp">Liên phòng ban<\/span>/.test(html), 'CROSS-DEPT: compact chip in the row, full route in title only');
  const rowText = html.replace(/title="[^"]*"/g, '');
  pass(!/Ban giám đốc → Bộ phận Quản trị tổng hợp/.test(rowText), 'CROSS-DEPT: the long route text does NOT appear as visible row content');
}

/* ---- 6) deliberate column-width system (colgroup) ---- */
{
  pass(/<colgroup><col class="c-code"><col class="c-title"><col class="c-person"><col class="c-cat">/.test(listWith('received', [baseRow()])), 'COLUMNS: <colgroup> present with deliberate width classes (received = 8 cols)');
  pass(/<col class="c-person"><col class="c-person2"><col class="c-cat">/.test(listWith('managed', [baseRow()])), 'COLUMNS: managed adds the secondary "Người giao" column (c-person2) without stealing title width');
}

/* ---- 7) empty state stays INSIDE the table shell ---- */
{
  const html = listWith('received', []);
  pass(/<thead>[\s\S]*Tiêu đề công việc[\s\S]*<\/thead>/.test(html), 'EMPTY: table header (column meaning) still rendered with zero rows');
  pass(/<tbody><tr><td colspan="8" class="phft-list-statecell">Không có công việc nào phù hợp\.<\/td><\/tr><\/tbody>/.test(html), 'EMPTY: message sits in a colspan tbody row, not a separate page');
  pass(/phft-kpi-row/.test(html) && /phft-list-toolbar/.test(html), 'EMPTY: KPI row + toolbar still present (same workspace shell)');
}

/* ---- 8) footer: "Đang hiển thị N công việc" + Xem thêm ---- */
{
  const html = listWith('received', [baseRow(), baseRow({ task_id: 't2', task_code: 'CV-2608-0002' })], { hasMore: true });
  pass(/phft-list-foot-count">Đang hiển thị <b>2<\/b> công việc · còn nữa<\/span>/.test(html), 'FOOTER: row-count line with bold number');
  pass(/data-task-list-load-more/.test(html), 'FOOTER: "Xem thêm" button preserved (load-more hook unchanged)');
  pass(!/phft-list-foot/.test(listWith('received', [])), 'FOOTER: no footer when the list is empty');
}

/* ---- 9) proposal wording lock ---- */
{
  const sent = listWith('proposal_sent', [baseRow({ flow_type: 'de_xuat' })]);
  const recv = listWith('proposal_received', [baseRow({ flow_type: 'de_xuat' })]);
  pass(/<th>Người xử lý đề xuất<\/th>/.test(sent), 'PROPOSAL: "Đề xuất tôi gửi" counterparty stays "Người xử lý đề xuất"');
  pass(/<th>Người gửi đề xuất<\/th>/.test(recv), 'PROPOSAL: "Đề xuất tôi nhận xử lý" counterparty stays "Người gửi đề xuất"');
  pass(!/chấp nhận|từ chối|approve|reject/i.test(sent + recv), 'PROPOSAL: no Accept/Reject actions rendered');
}

/* ---- 10) title dominance + person hierarchy in markup ---- */
{
  const html = listWith('received', [baseRow()]);
  pass(/<span class="phft-list-title-main">Đối chiếu công nợ tháng 8<\/span>/.test(html), 'TITLE: task title in the dedicated .phft-list-title-main element');
  pass(/<td class="phft-list-person"><b>Nguyễn Văn A<\/b><small>Bộ phận Tài chính Kế toán<\/small>/.test(html), 'PERSON: name in <b>, department in a separate muted <small> (not one flat string)');
}

console.log('PHF Task — Workspace visual contract (Step 5/5A/5B): ' + passed + '/' + passed + ' PASS');
