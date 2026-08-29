'use strict';

/*
 * PHF Task — MANAGED-VIEW DETAIL UI (M2 fix, LOCKED AUTHORITY RULE 2026-08-28).
 * jsdom, no network. Proves the detail page gates lifecycle actions on the
 * backend-computed detail.viewer block instead of task status alone, and shows
 * the "đang theo dõi" read-only banner for managed-view-only viewers. Backend
 * authority itself is proven by scripts/test-task-permission-v1.js and
 * scripts/test-task-managed-view-intervention-boundary-v1.js.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
function pass(cond, msg) { assert.ok(cond, msg); passed += 1; console.log('  PASS  ' + msg); }
const TASK_APP_SRC = fs.readFileSync(path.join(ROOT, 'assets/js/task/phf-task-app.js'), 'utf8');

function newWindow() {
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/ql/task' });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = function () { return 'manager'; };
  window.phfGetCurrentUser = function () { return { fullName: 'TBP QA', employeeCode: 'PHF012' }; };
  window.phfNavigate = function () {};
  window.phfToast = function () {};
  window.fetch = function () { throw new Error('unstubbed fetch'); };
  window.eval(TASK_APP_SRC);
  return window;
}

const T = newWindow().__PHF_TASK_TEST__;
const activeTask = { id: 't1', task_code: 'CV-2608-0100', status: 'in_progress', row_version: 4, title: 'Việc của nhân sự quản lý', content: 'x', progress_percent: 10, progress_status: 'dang_thuc_hien', flow_type: 'giao_viec', priority: 'thuong', category_code: 'BAO_CAO' };

function actionsBlock(over) {
  return Object.assign({ view: true, comment: true, update_progress: false, complete: false, cancel: false, change_deadline: false, transfer_primary: false, add_related: false, remove_related: false, reopen: false, edit_draft: false, delete_draft: false }, over || {});
}

(async () => {
  // ---- [1] managed_view_only: banner shown, all lifecycle actions hidden ----
  {
    const detail = { task: activeTask, category: {}, primary: { full_name: 'NV' }, related: [], links: [], comments: [], events: [],
      viewer: { relation: 'manager_of_primary', is_creator: false, is_active_primary: false, managed_view_only: true, intervention_basis: null, actions: actionsBlock() } };
    const html = T.detailContentHtml(detail, []);
    pass(html.indexOf('Bạn đang theo dõi công việc của nhân sự mình quản lý') !== -1, 'managed-view: read-only follow banner rendered');
    pass(html.indexOf('data-task-lifecycle-open="cancel"') === -1, 'managed-view: KHÔNG có nút Hủy công việc');
    pass(html.indexOf('data-task-lifecycle-open="complete"') === -1, 'managed-view: KHÔNG có nút Hoàn thành');
    pass(html.indexOf('data-task-progress-save') === -1, 'managed-view: KHÔNG có ô cập nhật tiến độ');
  }

  // ---- [2] executive viewer: full lifecycle actions present, no banner ----
  {
    const detail = { task: activeTask, category: {}, primary: { full_name: 'NV' }, related: [], links: [], comments: [], events: [],
      viewer: { relation: 'admin', is_creator: false, is_active_primary: false, managed_view_only: false, intervention_basis: 'executive_authority',
        actions: actionsBlock({ cancel: true, change_deadline: true, transfer_primary: true, add_related: true }) } };
    const html = T.detailContentHtml(detail, []);
    pass(html.indexOf('Bạn đang theo dõi') === -1, 'executive: KHÔNG hiện banner theo dõi');
    pass(html.indexOf('data-task-lifecycle-open="cancel"') !== -1, 'executive: có nút Hủy công việc');
  }

  // ---- [3] active primary: progress + complete present, cancel hidden ----
  {
    const detail = { task: activeTask, category: {}, primary: { full_name: 'NV' }, related: [], links: [], comments: [], events: [],
      viewer: { relation: 'primary', is_creator: false, is_active_primary: true, managed_view_only: false, intervention_basis: 'active_primary',
        actions: actionsBlock({ update_progress: true, complete: true }) } };
    const html = T.detailContentHtml(detail, []);
    pass(html.indexOf('data-task-progress-save') !== -1, 'primary: có ô cập nhật tiến độ');
    pass(html.indexOf('data-task-lifecycle-open="complete"') !== -1, 'primary: có nút Hoàn thành');
    pass(html.indexOf('data-task-lifecycle-open="cancel"') === -1, 'primary (không quyền update): KHÔNG có nút Hủy');
  }

  // ---- [4] no viewer block (older response) -> legacy status-based fallback ----
  {
    const detail = { task: activeTask, category: {}, primary: { full_name: 'NV' }, related: [], links: [], comments: [], events: [] };
    const html = T.detailContentHtml(detail, []);
    pass(html.indexOf('data-task-lifecycle-open="cancel"') !== -1, 'no-viewer fallback: giữ hành vi cũ (nút Hủy hiện cho task active)');
    pass(html.indexOf('data-task-progress-save') !== -1, 'no-viewer fallback: giữ ô cập nhật tiến độ');
    pass(html.indexOf('data-task-comment-input') !== -1, 'no-viewer fallback: ô trao đổi vẫn hiện (backend là gate thật)');
  }

  // ---- [5] STEP 3C — comment UI for managed-view viewer ----
  {
    const detail = {
      task: activeTask, category: {}, primary: { full_name: 'NV' }, related: [], links: [], events: [],
      comments: [
        { id: 'k1', body: 'Nhắc hoàn thành đúng hạn.', author_employee_code: 'PHF012', author_full_name: 'Lê Vĩnh Thắng', author_department: 'Bộ phận Quản trị tổng hợp', created_at: '2026-08-28T02:00:00Z' },
      ],
      viewer: { relation: 'manager_of_primary', is_creator: false, is_active_primary: false, managed_view_only: true, intervention_basis: null, actions: actionsBlock({ comment: true }) },
    };
    const html = T.detailContentHtml(detail, []);
    pass(html.indexOf('Trao đổi') !== -1, 'managed-view: section Trao đổi có mặt');
    pass(html.indexOf('Lê Vĩnh Thắng') !== -1, 'managed-view: comment cũ hiển thị tên người bình luận');
    pass(html.indexOf('Nhắc hoàn thành đúng hạn.') !== -1, 'managed-view: nội dung comment hiển thị');
    pass(html.indexOf('data-task-comment-input') !== -1, 'managed-view: ô nhập trao đổi có mặt (actions.comment=true)');
    pass(html.indexOf('data-task-comment-submit') !== -1, 'managed-view: nút Gửi trao đổi có mặt');
    pass(html.indexOf('data-task-lifecycle-open="cancel"') === -1, 'managed-view: vẫn KHÔNG có thao tác vòng đời');
    pass(html.indexOf('data-task-progress-save') === -1, 'managed-view: vẫn KHÔNG có cập nhật tiến độ');
  }

  // ---- [6] STEP 3C — viewer explicitly denied comment ----
  {
    const detail = {
      task: activeTask, category: {}, primary: { full_name: 'NV' }, related: [], links: [], comments: [], events: [],
      viewer: { relation: 'none', is_creator: false, is_active_primary: false, managed_view_only: false, intervention_basis: null, actions: actionsBlock({ comment: false, view: false }) },
    };
    const html = T.detailContentHtml(detail, []);
    pass(html.indexOf('data-task-comment-input') === -1, 'comment denied: KHÔNG có ô nhập');
    pass(html.indexOf('Bạn không có quyền thêm trao đổi') !== -1, 'comment denied: hiển thị thông báo không có quyền');
  }

  // ---- [7] STEP 3C — submit flow: empty body blocked, valid body calls API ----
  {
    const win = newWindow();
    const TT = win.__PHF_TASK_TEST__;
    const st = TT.getState();
    st.detail = {
      task: { id: 't1', status: 'in_progress', row_version: 3 }, category: {}, primary: {}, related: [], links: [], comments: [], events: [],
      viewer: { managed_view_only: true, actions: actionsBlock({ comment: true }) },
    };
    st.taskId = 't1';
    const root = win.document.getElementById('phfTaskRoot');
    const calls = [];
    win.fetch = function (url, opt) {
      const body = JSON.parse(opt.body);
      calls.push(body);
      if (body.action === 'addTaskComment') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: { id: 'c-new' } }) });
      if (body.action === 'getTaskDetail') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: st.detail }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: {} }) });
    };
    st.commentDraft = '   ';
    await TT.submitTaskComment(root);
    pass(calls.filter(c => c.action === 'addTaskComment').length === 0 && /không được để trống/.test(st.commentError), 'submit: body rỗng bị chặn client-side, không gọi API');
    st.commentDraft = 'Trao đổi thật';
    await TT.submitTaskComment(root);
    const sent = calls.find(c => c.action === 'addTaskComment');
    pass(!!sent && sent.task_id === 't1' && sent.body === 'Trao đổi thật', 'submit: body hợp lệ -> gọi addTaskComment với task_id + body đúng');
    pass(st.commentDraft === '' && calls.some(c => c.action === 'getTaskDetail'), 'submit: sau khi gửi -> xoá draft + reload chi tiết');
  }

  console.log('\nPHF Task Managed-View Detail UI V1: ' + passed + ' PASS');
})().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
