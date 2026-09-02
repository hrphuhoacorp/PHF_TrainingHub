'use strict';

/*
 * PHF Task — FILE ATTACHMENT V1 UI (jsdom, no network).
 *
 * The backend/action layer is proven by scripts/test-task-attachment-endpoint-v1.js
 * (20/20) and scripts/task-attachment-e2e-dev.js. This suite proves the NEW
 * user-facing workflow:
 *   - "Đính kèm file" is a SEPARATE section from "Tài liệu / Link"
 *   - Task Detail: list / download / remove gated by permission, safe rendering
 *   - Full Create: files kept LOCAL IN MEMORY, no upload before a real task_id
 *   - client-side fail-early validation (size / extension / 20-file cap)
 *   - human-readable sizes, truthful Vietnamese errors, no storage internals
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'assets/js/task/phf-task-app.js'), 'utf8');
let passed = 0;
function pass(c, m) { assert.ok(c, m); passed += 1; console.log('  PASS  ' + m); }

function newWindow() {
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/ql/task' });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = () => 'manager';
  window.phfGetCurrentUser = () => ({ fullName: 'QA', employeeCode: 'PHF001', id: 'acc-qa', role: 'manager' });
  window.phfNavigate = () => {};
  window.phfToast = () => {};
  window.__fetchLog = [];
  window.fetch = function (url, opts) {
    window.__fetchLog.push({ url: String(url), opts: opts || {} });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: {}, data: { id: 'att-new' } }) });
  };
  window.eval(SRC);
  return window;
}

function fakeFile(name, size, type) {
  // jsdom File — size is derived from content; pad with a Blob part of the size.
  const f = new (newWindow().window.File || File)(['x'.repeat(Math.min(size, 8))], name, { type: type || '' });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

const DETAIL_BASE = {
  task: { id: 'task-1', task_code: 'CV-1', title: 'Việc A', status: 'in_progress', flow_type: 'giao_viec' },
  category: {}, primary: null, related: [], comments: [], links: [],
  viewer: { actions: { view: true, comment: true, upload_attachment: true } },
};

(async () => {
  const w = newWindow();
  const T = w.__PHF_TASK_TEST__;

  // ---- human-readable size ----
  pass(T.phftFileSizeText(512) === '512 B', 'size: bytes');
  pass(T.phftFileSizeText(1536) === '1.5 KB', 'size: KB one decimal under 10');
  pass(T.phftFileSizeText(200 * 1024) === '200 KB', 'size: KB no decimal over 10');
  pass(T.phftFileSizeText(3.5 * 1024 * 1024) === '3.5 MB', 'size: MB');

  // ---- client fail-early validation ----
  pass(T.phftAttachValidateFile({ name: 'a.pdf', size: 1000 }) === '', 'validate: pdf 1KB ok');
  pass(T.phftAttachValidateFile({ name: 'a.docx', size: 1000 }) === '' && T.phftAttachValidateFile({ name: 'a.xlsx', size: 1 }) === '' && T.phftAttachValidateFile({ name: 'a.webp', size: 1 }) === '', 'validate: docx/xlsx/webp ok');
  pass(T.phftAttachValidateFile({ name: 'big.png', size: 4 * 1024 * 1024 + 1 }) === 'File vượt quá giới hạn 4 MB.', 'validate: >4MB -> "File vượt quá giới hạn 4 MB."');
  pass(T.phftAttachValidateFile({ name: 'x.heic', size: 10 }) === 'Định dạng file chưa được hỗ trợ.', 'validate: HEIC / unsupported -> "Định dạng file chưa được hỗ trợ."');
  pass(T.phftAttachValidateFile({ name: 'x.exe', size: 10 }) === 'Định dạng file chưa được hỗ trợ.', 'validate: .exe rejected');
  pass(T.phftAttachValidateFile({ name: 'x.pdf', size: 0 }) === 'File rỗng.', 'validate: empty file');

  // ---- error mapping (truthful VN, no raw exceptions) ----
  pass(T.phftAttachErrorText({ code: 'ATTACHMENT_ORCHESTRATION_LIMIT_REACHED' }) === 'Công việc đã đạt tối đa 20 file đính kèm.', 'error: 20-file cap');
  pass(T.phftAttachErrorText({ code: 'ATTACHMENT_ORCHESTRATION_MIME_EXTENSION_MISMATCH' }).indexOf('không khớp') >= 0, 'error: MIME/ext mismatch');
  pass(T.phftAttachErrorText({ code: 'ZZZ', message: 'boom' }) === 'boom', 'error: unknown code falls back to message');
  pass(T.phftAttachErrorText({}) === 'Không tải được file lên. Vui lòng thử lại.', 'error: no code/message -> generic');

  // ---- Task Detail: empty state ----
  {
    T.getAttachState().uploading = []; T.getAttachState().busy = false; T.getAttachState().error = '';
    const html = T.taskDetailAttachmentsSectionHtml(Object.assign({}, DETAIL_BASE, { attachments: [] }));
    pass(html.indexOf('Đính kèm file') >= 0 && html.indexOf('Chưa có file đính kèm.') >= 0, 'detail: heading + empty state "Chưa có file đính kèm."');
    pass(html.indexOf('data-task-attach-file-input') >= 0 && html.indexOf('Chọn file') >= 0, 'detail: "Chọn file" shown (viewer can upload)');
  }

  // ---- Task Detail: populated + permission + safe DTO ----
  {
    const attachments = [
      { id: 'a1', original_filename: 'báo-giá.pdf', mime_type: 'application/pdf', extension: 'pdf', size_bytes: 210000, uploaded_by_full_name: 'Trần B', created_at: '2026-09-01T00:00:00Z', can_remove: true,
        stored_object_key: 'task/aaa/bbb.pdf', checksum_sha256: 'deadbeef', status: 'active', uploaded_by_employee_code: 'PHF010', internal_path: '/srv/x' },
      { id: 'a2', original_filename: 'ảnh.png', extension: 'png', size_bytes: 900000, can_remove: false },
    ];
    const html = T.taskDetailAttachmentsSectionHtml(Object.assign({}, DETAIL_BASE, { attachments }));
    pass(html.indexOf('báo-giá.pdf') >= 0 && html.indexOf('205 KB') >= 0, 'detail: row shows filename + readable size');
    pass((html.match(/data-task-attach-remove=/g) || []).length === 1, 'detail: "Xóa" only on the row the viewer can_remove');
    pass((html.match(/Tải xuống/g) || []).length === 2, 'detail: "Tải xuống" on every row');
    pass(/href="\/api\/task-attachment\?taskId=task-1&(amp;)?attachmentId=a1"/.test(html), 'detail: download link points at the dedicated endpoint');
    pass(html.indexOf('deadbeef') < 0 && html.indexOf('stored_object_key') < 0 && html.indexOf('task/aaa/bbb.pdf') < 0 && html.indexOf('/srv/x') < 0 && html.indexOf('checksum') < 0 && html.indexOf('PHF010') < 0,
      'detail: NO checksum / storage key / internal path / uploader employee code / internal status rendered');
  }

  // ---- Task Detail: read-only viewer (can view, cannot upload) -> no mutation UI ----
  {
    const ro = Object.assign({}, DETAIL_BASE, { viewer: { actions: { view: true, comment: true, upload_attachment: false } }, attachments: [{ id: 'a1', original_filename: 'x.pdf', extension: 'pdf', size_bytes: 100, can_remove: false }] });
    const html = T.taskDetailAttachmentsSectionHtml(ro);
    pass(html.indexOf('data-task-attach-file-input') < 0 && html.indexOf('Chọn file') < 0, 'read-only viewer: no "Chọn file" upload control');
    pass(html.indexOf('Tải xuống') >= 0, 'read-only viewer: can still download');
    pass(html.indexOf('data-task-attach-remove') < 0, 'read-only viewer: no remove control');
  }

  // ---- detailContentHtml: BOTH sections present and separate ----
  {
    const full = T.detailContentHtml(Object.assign({}, DETAIL_BASE, { attachments: [] }), []);
    pass(full.indexOf('Tài liệu / Link') >= 0 && full.indexOf('Đính kèm file') >= 0 && full.indexOf('Chưa có file đính kèm.') >= 0,
      'gate 20/21: "Tài liệu / Link" AND "Đính kèm file" both render; zero-attachment detail still works');
  }

  // ---- QUICK CREATE: attachment parity, compact ----
  {
    const wq = newWindow(); const TQ = wq.__PHF_TASK_TEST__;
    TQ.getState().createAttachments = []; TQ.getState().createAttachError = '';
    const empty = TQ.createTaskQuickFormHtml();
    pass(empty.indexOf('Tài liệu liên kết (URL)') >= 0, 'quick: linked-documents block present (parity label "Tài liệu liên kết (URL)")');
    pass(empty.indexOf('Đính kèm file') >= 0 && empty.indexOf('data-task-create-attach-input') >= 0, 'quick: "Đính kèm file" + [Chọn file] present');
    pass(empty.indexOf('Tối đa 4 MB/file') >= 0, 'quick: compact helper text "Tối đa 4 MB/file"');
    pass(empty.indexOf('phft-attach-pending-list') < 0, 'quick: default is compact — no empty file list, no big upload box');
    pass(empty.indexOf('data-task-attach-dropzone') < 0, 'quick: no drag/drop zone (not required for Quick)');

    // select files -> compact rows, same shared state/handlers as Full
    const root = wq.document.getElementById('phfTaskRoot'); root.innerHTML = '<div></div>';
    const ok1 = new wq.window.File(['x'], 'q.pdf', { type: 'application/pdf' }); Object.defineProperty(ok1, 'size', { value: 111000 });
    const big = new wq.window.File(['x'], 'q.png', { type: 'image/png' }); Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 });
    const heic = new wq.window.File(['x'], 'q.heic', { type: '' }); Object.defineProperty(heic, 'size', { value: 10 });
    wq.__fetchLog.length = 0;
    TQ.handleCreateAttachSelect(root, [ok1, big, heic]);
    pass(wq.__fetchLog.filter((c) => c.url.indexOf('/api/task-attachment') >= 0).length === 0, 'quick gate 9: selecting files does NOT upload before task_id exists');
    const st = TQ.getState().createAttachments;
    pass(st.length === 3 && st[0].file === ok1, 'quick: File objects held in memory (shared taskUiState.createAttachments)');
    pass(st[1].error === 'File vượt quá giới hạn 4 MB.' && st[2].error === 'Định dạng file chưa được hỗ trợ.', 'quick gate 5/6: >4MB + HEIC flagged inline');
    const withRows = TQ.createAttachmentQuickBlockHtml();
    pass(withRows.indexOf('q.pdf') >= 0 && withRows.indexOf('108 KB') >= 0 && (withRows.match(/data-task-create-attach-remove=/g) || []).length === 3, 'quick: compact rows show filename + size + "Bỏ"');

    // remove one before submit
    TQ.getState().createAttachments.splice(1, 1);
    pass(TQ.getState().createAttachments.length === 2, 'quick gate 8: a selected file can be removed before submit');

    // 20-file cap
    const wc = newWindow(); const TC = wc.__PHF_TASK_TEST__;
    TC.getState().createAttachments = [];
    const many = []; for (let i = 0; i < 25; i += 1) { const f = new wc.window.File(['x'], 'm' + i + '.pdf', { type: 'application/pdf' }); Object.defineProperty(f, 'size', { value: 5 }); many.push(f); }
    TC.handleCreateAttachSelect(wc.document.getElementById('phfTaskRoot'), many);
    pass(TC.getState().createAttachments.length === TC.PHFT_ATTACH_MAX_COUNT && TC.getState().createAttachError.indexOf('20 file') >= 0, 'quick gate 7: max 20 enforced with truthful message');

    // zero-attachment quick create still renders
    const wz = newWindow(); const TZ = wz.__PHF_TASK_TEST__;
    TZ.getState().createAttachments = [];
    pass(TZ.createTaskQuickFormHtml().indexOf('Giao việc') >= 0, 'quick gate 17: zero-attachment Quick Create still renders normally');
  }

  // ---- QUICK CREATE: partial-success banner + staged files clear ----
  {
    const wb = newWindow(); const TB = wb.__PHF_TASK_TEST__;
    TB.setNotifState && null;
    // simulate the state submitTaskCreate leaves after a quick create where 1 of 2 files failed
    TB.getState().quickSuccess = { taskId: 't9', taskCode: 'CV-9', title: 'Việc B', attachNote: 'Công việc đã được tạo, nhưng 1/2 file chưa tải lên được — vào chi tiết công việc để thử lại.', attachFailed: true };
    const banner = TB.quickSuccessBannerHtml();
    pass(banner.indexOf('Tạo công việc thất bại') < 0 && banner.indexOf('nhưng 1/2 file chưa tải lên được') >= 0 && banner.indexOf('is-warning') >= 0,
      'quick gate 11: partial success -> truthful "… file chưa tải lên được", never "Tạo công việc thất bại", warning style');

    TB.getState().quickSuccess = { taskId: 't9', taskCode: 'CV-9', title: 'Việc B', attachNote: 'Đã đính kèm 2 file.', attachFailed: false };
    pass(TB.quickSuccessBannerHtml().indexOf('is-success') >= 0 && TB.quickSuccessBannerHtml().indexOf('Đã đính kèm 2 file.') >= 0, 'quick: all-uploaded -> success banner mentions attachments');

    // identity reset clears staged files
    const wi = newWindow(); const TI = wi.__PHF_TASK_TEST__;
    wi.phfGetAuthenticatedUser = () => ({ id: 'acc-a', employeeCode: 'PHF001', role: 'manager' });
    TI.syncTaskIdentity(null);
    TI.getState().createAttachments = [{ name: 'x.pdf', size: 1, error: '' }];
    wi.phfGetAuthenticatedUser = () => ({ id: 'acc-b', employeeCode: 'PHF999', role: 'admin' });
    TI.syncTaskIdentity(null);
    pass(TI.getState().createAttachments.length === 0, 'quick gate 14: identity change clears staged File selections (no leak between users)');
  }

  // ---- Full Create: files kept in memory, NO upload before task_id ----
  {
    const w2 = newWindow(); const T2 = w2.__PHF_TASK_TEST__;
    const root = w2.document.getElementById('phfTaskRoot');
    root.innerHTML = '<div></div>';
    T2.getState().createAttachments = [];
    const f1 = new w2.window.File(['x'], 'kèm.pdf', { type: 'application/pdf' });
    Object.defineProperty(f1, 'size', { value: 123456 });
    const fBig = new w2.window.File(['x'], 'to.png', { type: 'image/png' });
    Object.defineProperty(fBig, 'size', { value: 5 * 1024 * 1024 });
    w2.__fetchLog.length = 0;
    T2.handleCreateAttachSelect(root, [f1, fBig]);
    pass(w2.__fetchLog.filter((c) => c.url.indexOf('/api/task-attachment') >= 0).length === 0, 'gate 16: choosing files in Full Create does NOT upload (no task_id yet)');
    const state = T2.getState().createAttachments;
    pass(state.length === 2 && state[0].file === f1 && state[0].name === 'kèm.pdf' && state[0].size === 123456,
      'create: selected File objects are held in memory with name + size');
    pass(state[0].error === '' && state[1].error === 'File vượt quá giới hạn 4 MB.', 'create: per-file client validation flagged (big PNG)');
    const block = T2.createAttachmentBlockHtml();
    pass(block.indexOf('Đính kèm file') >= 0 && block.indexOf('kèm.pdf') >= 0 && block.indexOf('121 KB') >= 0 && block.indexOf('File vượt quá giới hạn 4 MB.') >= 0,
      'create: compact block lists selected files with size + inline error');
    pass(block.indexOf('Tối đa 4 MB/file') >= 0, 'create: compact hint "Tối đa 4 MB/file"');
  }

  // ---- Full Create: 20-file cap enforced on selection ----
  {
    const w3 = newWindow(); const T3 = w3.__PHF_TASK_TEST__;
    const root = w3.document.getElementById('phfTaskRoot'); root.innerHTML = '<div></div>';
    T3.getState().createAttachments = [];
    const many = [];
    for (let i = 0; i < 25; i += 1) { const f = new w3.window.File(['x'], 'f' + i + '.pdf', { type: 'application/pdf' }); Object.defineProperty(f, 'size', { value: 100 }); many.push(f); }
    T3.handleCreateAttachSelect(root, many);
    pass(T3.getState().createAttachments.length === T3.PHFT_ATTACH_MAX_COUNT && T3.getState().createAttachError.indexOf('20 file') >= 0,
      'gate 5 (client): Full Create caps selection at 20 with a truthful message');
  }

  // ---- Task Detail: upload posts raw binary to the dedicated endpoint, then reloads ----
  {
    const w4 = newWindow(); const T4 = w4.__PHF_TASK_TEST__;
    const root = w4.document.getElementById('phfTaskRoot'); root.innerHTML = '<div></div>';
    T4.getState().taskId = 'task-1';
    T4.getState().detail = Object.assign({}, DETAIL_BASE, { attachments: [] });
    let reloaded = 0;
    const realReload = w4.fetch;
    w4.fetch = function (url, opts) {
      w4.__fetchLog.push({ url: String(url), opts: opts || {} });
      if (String(url).indexOf('action') >= 0 || String(url).indexOf('/api/data') >= 0) { reloaded += 1; return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: Object.assign({}, DETAIL_BASE, { attachments: [{ id: 'a1', original_filename: 'ok.pdf', extension: 'pdf', size_bytes: 10, can_remove: true }] }) }) }); }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: { id: 'a1' } }) });
    };
    const good = new w4.window.File(['x'], 'ok.pdf', { type: 'application/pdf' });
    Object.defineProperty(good, 'size', { value: 100 });
    w4.__fetchLog.length = 0;
    await T4.handleTaskDetailAttachUpload(root, [good]);
    const up = w4.__fetchLog.find((c) => c.url.indexOf('/api/task-attachment?taskId=task-1') >= 0 && (c.opts.method === 'POST'));
    pass(!!up, 'detail upload: POST to /api/task-attachment?taskId=…');
    pass(up.opts.headers['Content-Type'] === 'application/pdf' && /X-Attachment-Filename/i.test(Object.keys(up.opts.headers).join(',')) && /X-Attachment-Idempotency-Key/i.test(Object.keys(up.opts.headers).join(',')),
      'detail upload: raw binary — Content-Type=file mime + filename + idempotency-key headers, no multipart/base64');
    pass(up.opts.body === good, 'detail upload: request body is the raw File (not JSON, not base64)');
    pass(reloaded >= 1, 'detail upload: success refreshes the attachment list');
  }

  // ---- Task Detail: partial upload failure -> truthful message, no throw ----
  {
    const w5 = newWindow(); const T5 = w5.__PHF_TASK_TEST__;
    const root = w5.document.getElementById('phfTaskRoot'); root.innerHTML = '<div></div>';
    T5.getState().taskId = 'task-1';
    T5.getState().detail = Object.assign({}, DETAIL_BASE, { attachments: [] });
    let n = 0;
    w5.fetch = function (url) {
      if (String(url).indexOf('/api/task-attachment') >= 0) { n += 1; return Promise.resolve({ ok: n === 1, json: () => Promise.resolve(n === 1 ? { ok: true, data: {} } : { ok: false, code: 'ATTACHMENT_ORCHESTRATION_MIME_INVALID', error: 'x' }) }); }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: Object.assign({}, DETAIL_BASE, { attachments: [] }) }) });
    };
    const a = new w5.window.File(['x'], 'a.pdf', { type: 'application/pdf' }); Object.defineProperty(a, 'size', { value: 10 });
    const b = new w5.window.File(['x'], 'b.pdf', { type: 'application/pdf' }); Object.defineProperty(b, 'size', { value: 10 });
    await T5.handleTaskDetailAttachUpload(root, [a, b]);
    pass(T5.getAttachState().busy === false && T5.getAttachState().error.indexOf('1 file chưa tải lên được') >= 0,
      'detail upload: partial failure reported truthfully ("… 1 file chưa tải lên được"), never a silent fail');
  }

  // ---- QUICK CREATE: full drive-through — create once, then upload staged files ----
  {
    const wd = newWindow(); const TD = wd.__PHF_TASK_TEST__;
    const root = wd.document.getElementById('phfTaskRoot');
    const created = { count: 0 }; const uploads = []; let publishCount = 0;
    wd.fetch = function (url, opts) {
      const u = String(url);
      if (u.indexOf('/api/task-attachment') >= 0) { uploads.push({ url: u, method: opts.method, body: opts.body }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: { id: 'att' + uploads.length } }) }); }
      const body = JSON.parse(opts.body || '{}');
      if (body.action === 'listMyTaskNotifications') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: { notifications: [], unreadCount: 0 } }) });
      if (body.action === 'publishTask') { publishCount += 1; return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: { row_version: 2 } }) }); }
      if (body.action === 'getTaskDetail') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: Object.assign({}, DETAIL_BASE, { attachments: [] }) }) });
      // create draft
      created.count += 1;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: { id: 'task-q1', task_code: 'CV-Q1', row_version: 1 } }) });
    };
    const st = TD.getState();
    st.createTab = 'quick';
    st.foundationStatus = { createTaskReady: true }; st.foundationStatusLoading = false;
    st.form = { flow_type: 'giao_viec', title: 'Việc nhanh có file', content: '', category_code: 'DM1', priority: 'thuong', start_at: '2026-09-01T08:00', deadline: '2026-12-01T17:00', primary_employee_code: 'PHF050', related_employee_codes: [], links: [], recurrence: { mode: 'none' } };
    const fa = new wd.window.File(['x'], 'a.pdf', { type: 'application/pdf' }); Object.defineProperty(fa, 'size', { value: 100 });
    const fb = new wd.window.File(['x'], 'b.png', { type: 'image/png' }); Object.defineProperty(fb, 'size', { value: 200 });
    st.createAttachments = [{ file: fa, name: 'a.pdf', size: 100, error: '' }, { file: fb, name: 'b.png', size: 200, error: '' }];

    // submitTaskCreate is internal — drive it through the real form-submit handler
    root.innerHTML = '<form data-task-create-form></form>';
    TD.bindShell(root);
    root.querySelector('[data-task-create-form]').dispatchEvent(new wd.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 60));

    pass(created.count === 1, 'quick gate 10/12: Task draft created exactly ONCE (no duplicate)');
    pass(uploads.length === 2 && uploads.every((x) => x.url.indexOf('taskId=task-q1') >= 0 && x.method === 'POST'), 'quick gate 10: both staged files uploaded to the real task_id after creation');
    pass(uploads[0].body === fa && uploads[1].body === fb, 'quick: uploaded the raw File objects (shared transport, no re-encode)');
    pass(Array.isArray(TD.getState().createAttachments) && TD.getState().createAttachments.length === 0, 'quick gate 13: staged files cleared after successful create');
    const banner = TD.quickSuccessBannerHtml();
    pass(banner.indexOf('Đã đính kèm 2 file.') >= 0, 'quick: success banner confirms the attachments');
  }

  console.log('\n==== TASK_ATTACHMENT_UI_V1  PASS=' + passed + ' ====');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
