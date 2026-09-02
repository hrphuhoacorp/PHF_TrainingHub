'use strict';

// TEST/MOCK HARNESS cho lib/task-read.js + lib/task-query-executor.js
// (Gate 11 — repoint Task read path Supabase PHF-HR-DEV -> PostgreSQL phf_hr).
// KHÔNG kết nối DB thật, KHÔNG dùng credential thật, KHÔNG dùng network thật.
// Cùng kỹ thuật đã dùng ở test-task-write-mock-harness.js: inject module 'pg'
// giả vào require.cache TRƯỚC khi require lib/task-read.js /
// lib/task-query-executor.js (cả hai require lib/db.js, vốn require 'pg') —
// KHÔNG sửa bất kỳ file production nào, chỉ được require.
//
// Chạy: node test-task-read-mock-harness.js

const assert = require('assert');
const crypto = require('crypto');

const DB_JS_PATH = require.resolve('./lib/db.js');
const TASK_READ_JS_PATH = require.resolve('./lib/task-read.js');
const TASK_QUERY_EXECUTOR_JS_PATH = require.resolve('./lib/task-query-executor.js');

function makeFakeClient(script) {
  const calls = [];
  let step = 0;
  return {
    calls,
    async query(sql, params) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      const rule = script[step];
      calls.push({ step, sql: normalized, params });
      step += 1;
      if (!rule) {
        throw new Error(`HARNESS_UNEXPECTED_EXTRA_QUERY: "${normalized}"`);
      }
      if (!rule.expect.test(normalized)) {
        throw new Error(`HARNESS_QUERY_MISMATCH at step ${step - 1}: expected /${rule.expect}/ got "${normalized}"`);
      }
      if (rule.error) throw rule.error;
      return rule.result || { rows: [], rowCount: 0 };
    },
    release() {
      calls.push({ step: 'release' });
    },
    _remainingSteps: () => script.length - step,
  };
}

function makeFakePgModule(client) {
  function FakePool() {
    return { connect: async () => client, on: () => {} };
  }
  return { Pool: FakePool };
}

function loadWithFakePg(modulePath, client) {
  const pgPath = require.resolve('pg');
  delete require.cache[DB_JS_PATH];
  delete require.cache[modulePath];
  const originalPgEntry = require.cache[pgPath];
  require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: makeFakePgModule(client) };
  const mod = require(modulePath);
  if (originalPgEntry) require.cache[pgPath] = originalPgEntry;
  else delete require.cache[pgPath];
  return mod;
}

const MOCK_CONFIG = {
  PHF_HR_DB_HOST: 'mock-host-not-real',
  PHF_HR_DB_PORT: 5432,
  PHF_HR_DB_NAME: 'mock-db-not-real',
  PHF_HR_DB_RUNTIME_USER: 'mock-user-not-real',
  PHF_HR_DB_RUNTIME_PASSWORD: 'mock-password-not-real',
};

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`, detail !== undefined ? detail : '');
}

const BEGIN_RO = /^BEGIN READ ONLY$/;
const SET_ROLE = /^SET LOCAL ROLE phf_hr_app$/;
const SET_TIMEOUT = /^SET LOCAL statement_timeout = \d+$/;
const COMMIT = /^COMMIT$/;
const ROLLBACK = /^ROLLBACK$/;

function signDescriptor(payload, secret) {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  const signature = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
  return { ...payload, signature };
}

(async () => {
  const SECRET = 'mock-signing-secret-not-real';

  // ===========================================================================
  // lib/task-read.js — listTaskCategories()
  // ===========================================================================
  {
    const client = makeFakeClient([
      { expect: BEGIN_RO, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SET_TIMEOUT, result: {} },
      {
        expect: /^SELECT category_code, display_name, description, color, is_active, sort_order FROM task\.categories WHERE is_active = true ORDER BY sort_order ASC$/,
        result: { rows: [{ category_code: 'BAO_CAO', display_name: 'Báo cáo', description: null, color: null, is_active: true, sort_order: 1 }] },
      },
      { expect: COMMIT, result: {} },
    ]);
    const { listTaskCategories } = loadWithFakePg(TASK_READ_JS_PATH, client);
    const out = await listTaskCategories(MOCK_CONFIG);
    record('listTaskCategories_SUCCESS_shape', out.count === 1 && out.data[0].categoryCode === 'BAO_CAO' && out.data[0].displayName === 'Báo cáo' && client._remainingSteps() === 0, { out });
  }

  {
    // schema missing (42P01) -> TASK_SCHEMA_MISSING, 503, ROLLBACK executed
    const client = makeFakeClient([
      { expect: BEGIN_RO, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SET_TIMEOUT, result: {} },
      { expect: /^SELECT category_code/, error: Object.assign(new Error('relation "task.categories" does not exist'), { code: '42P01' }) },
      { expect: ROLLBACK, result: {} },
    ]);
    const { listTaskCategories } = loadWithFakePg(TASK_READ_JS_PATH, client);
    let error;
    try { await listTaskCategories(MOCK_CONFIG); } catch (e) { error = e; }
    record('listTaskCategories_SCHEMA_MISSING', error && error.code === 'TASK_SCHEMA_MISSING' && error.statusCode === 503 && client._remainingSteps() === 0, { code: error && error.code });
  }

  {
    // permission denied (42501) -> TASK_PERMISSION_DENIED, 500
    const client = makeFakeClient([
      { expect: BEGIN_RO, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SET_TIMEOUT, result: {} },
      { expect: /^SELECT category_code/, error: Object.assign(new Error('permission denied for table categories'), { code: '42501' }) },
      { expect: ROLLBACK, result: {} },
    ]);
    const { listTaskCategories } = loadWithFakePg(TASK_READ_JS_PATH, client);
    let error;
    try { await listTaskCategories(MOCK_CONFIG); } catch (e) { error = e; }
    record('listTaskCategories_PERMISSION_DENIED', error && error.code === 'TASK_PERMISSION_DENIED' && error.statusCode === 500, { code: error && error.code });
  }

  {
    // statement_timeout hit (57014) -> TASK_READ_TIMEOUT, 504
    const client = makeFakeClient([
      { expect: BEGIN_RO, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SET_TIMEOUT, result: {} },
      { expect: /^SELECT category_code/, error: Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }) },
      { expect: ROLLBACK, result: {} },
    ]);
    const { listTaskCategories } = loadWithFakePg(TASK_READ_JS_PATH, client);
    let error;
    try { await listTaskCategories(MOCK_CONFIG); } catch (e) { error = e; }
    record('listTaskCategories_TIMEOUT', error && error.code === 'TASK_READ_TIMEOUT' && error.statusCode === 504, { code: error && error.code });
  }

  // ===========================================================================
  // lib/task-read.js — listTasks() (dead/unwired, ported for consistency)
  // ===========================================================================
  {
    const client = makeFakeClient([
      { expect: BEGIN_RO, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SET_TIMEOUT, result: {} },
      {
        expect: /^SELECT id, task_code, flow_type, status, title, category_code, priority, start_at, deadline, progress_percent, progress_status, created_by_employee_code, created_at, updated_at, row_version FROM task\.tasks ORDER BY created_at DESC LIMIT 200$/,
        result: { rows: [{ id: 't1', task_code: 'CV-1', flow_type: 'giao_viec', status: 'published', title: 'x', category_code: 'BAO_CAO', priority: 'normal', start_at: null, deadline: '2026-09-01', progress_percent: 0, progress_status: null, created_by_employee_code: 'PHF001', created_at: '2026-08-01', updated_at: '2026-08-01', row_version: 1 }] },
      },
      { expect: COMMIT, result: {} },
    ]);
    const { listTasks } = loadWithFakePg(TASK_READ_JS_PATH, client);
    const out = await listTasks(MOCK_CONFIG);
    record('listTasks_SUCCESS_shape', out.count === 1 && out.data[0].taskCode === 'CV-1' && out.data[0].rowVersion === 1, { out });
  }

  // ===========================================================================
  // lib/task-read.js — getTaskById() (2026-08-27, SINGLE TASK READ FOUNDATION)
  // ===========================================================================
  {
    // SUCCESS — task + assignees, shape raw snake_case (KHÔNG camelCase —
    // đúng chủ ý, xem comment trong lib/task-read.js).
    const client = makeFakeClient([
      { expect: BEGIN_RO, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SET_TIMEOUT, result: {} },
      {
        expect: /^SELECT \* FROM task\.tasks WHERE id = \$1$/,
        result: { rows: [{ id: 't1', status: 'published', created_by_employee_code: 'PHF010', created_by_account_id: null, row_version: 3 }] },
      },
      {
        expect: /^SELECT \* FROM task\.assignees WHERE task_id = \$1$/,
        result: { rows: [{ id: 'a1', task_id: 't1', employee_code: 'PHF010', role: 'primary', is_active: true }] },
      },
      {
        expect: /^SELECT \* FROM task\.comments WHERE task_id = \$1 ORDER BY created_at ASC$/,
        result: { rows: [{ id: 'c1', task_id: 't1', body: 'hi' }] },
      },
      {
        expect: /^SELECT \* FROM task\.links WHERE task_id = \$1 ORDER BY created_at ASC$/,
        result: { rows: [{ id: 'l1', task_id: 't1', url: 'https://x.y' }] },
      },
      {
        expect: /^SELECT \* FROM task\.events WHERE task_id = \$1 ORDER BY occurred_at DESC$/,
        result: { rows: [{ id: 'e1', task_id: 't1', event_type: 'status' }] },
      },
      // FILE ATTACHMENT V1 — additive ACTIVE-only safe projection (in Promise.all with the 4 above).
      { expect: /^SELECT id, original_filename, mime_type, extension, size_bytes, uploaded_by_employee_code, uploaded_by_account_id, created_at FROM task.attachments WHERE task_id = \$1 AND status = 'active' ORDER BY created_at ASC$/, result: { rows: [{ id: 'att1', original_filename: 'mc.pdf', mime_type: 'application/pdf', extension: 'pdf', size_bytes: 111, uploaded_by_employee_code: 'PHF010', created_at: '2026-08-02' }] } },
      // SOURCE OF WORK V1 — additive proposal-generated reverse lookup.
      { expect: /SELECT 1 FROM task\.proposal_decisions WHERE generated_task_id = \$1 LIMIT 1/, result: { rows: [] } },
      // CANCEL POLICY V1 — additive pending "Yêu cầu hủy" lookup (to_regclass-guarded).
      { expect: /FROM task\.cancel_requests/, result: { rows: [] } },
      { expect: COMMIT, result: {} },
    ]);
    const { getTaskById } = loadWithFakePg(TASK_READ_JS_PATH, client);
    const out = await getTaskById(MOCK_CONFIG, 't1');
    record('getTaskById_SUCCESS_shape_raw_snake_case',
      out.task.id === 't1' && out.task.row_version === 3 && out.task.created_by_employee_code === 'PHF010' &&
      out.assignees.length === 1 && out.assignees[0].role === 'primary' && out.assignees[0].is_active === true &&
      out.comments.length === 1 && out.comments[0].id === 'c1' &&
      out.links.length === 1 && out.links[0].id === 'l1' &&
      out.events.length === 1 && out.events[0].id === 'e1' &&
      out.attachments.length === 1 && out.attachments[0].id === 'att1' && out.attachments[0].stored_object_key === undefined &&
      client._remainingSteps() === 0,
      { out });
  }

  {
    // NOT FOUND — task=null, assignees/comments/links/events=[], KHÔNG query
    // bảng con nào (query thứ 2+ KHÔNG được gọi khi task không tồn tại —
    // tránh query thừa).
    const client = makeFakeClient([
      { expect: BEGIN_RO, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SET_TIMEOUT, result: {} },
      { expect: /^SELECT \* FROM task\.tasks WHERE id = \$1$/, result: { rows: [] } },
      { expect: COMMIT, result: {} },
    ]);
    const { getTaskById } = loadWithFakePg(TASK_READ_JS_PATH, client);
    const out = await getTaskById(MOCK_CONFIG, 'not-exist');
    record('getTaskById_NOT_FOUND_task_null_no_extra_query',
      out.task === null && Array.isArray(out.assignees) && out.assignees.length === 0 &&
      Array.isArray(out.comments) && out.comments.length === 0 &&
      Array.isArray(out.links) && out.links.length === 0 &&
      Array.isArray(out.events) && out.events.length === 0 &&
      Array.isArray(out.attachments) && out.attachments.length === 0 &&
      client._remainingSteps() === 0,
      { out });
  }

  {
    // Nhiều assignees (primary + related/coordinator) — không giới hạn số dòng.
    const client = makeFakeClient([
      { expect: BEGIN_RO, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SET_TIMEOUT, result: {} },
      { expect: /^SELECT \* FROM task\.tasks WHERE id = \$1$/, result: { rows: [{ id: 't2', status: 'in_progress', row_version: 1 }] } },
      {
        expect: /^SELECT \* FROM task\.assignees WHERE task_id = \$1$/,
        result: { rows: [
          { id: 'a1', task_id: 't2', employee_code: 'PHF082', role: 'primary', is_active: true },
          { id: 'a2', task_id: 't2', employee_code: 'PHF010', role: 'related', is_active: true },
          { id: 'a3', task_id: 't2', employee_code: 'PHF012', role: 'related', is_active: false },
        ] },
      },
      { expect: /^SELECT \* FROM task\.comments WHERE task_id = \$1 ORDER BY created_at ASC$/, result: { rows: [] } },
      { expect: /^SELECT \* FROM task\.links WHERE task_id = \$1 ORDER BY created_at ASC$/, result: { rows: [] } },
      { expect: /^SELECT \* FROM task\.events WHERE task_id = \$1 ORDER BY occurred_at DESC$/, result: { rows: [] } },
      { expect: /^SELECT id, original_filename, mime_type, extension, size_bytes, uploaded_by_employee_code, uploaded_by_account_id, created_at FROM task.attachments WHERE task_id = \$1 AND status = 'active' ORDER BY created_at ASC$/, result: { rows: [] } },
      { expect: /SELECT 1 FROM task\.proposal_decisions WHERE generated_task_id = \$1 LIMIT 1/, result: { rows: [] } },
      { expect: /FROM task\.cancel_requests/, result: { rows: [] } },
      { expect: COMMIT, result: {} },
    ]);
    const { getTaskById } = loadWithFakePg(TASK_READ_JS_PATH, client);
    const out = await getTaskById(MOCK_CONFIG, 't2');
    record('getTaskById_multiple_assignees_all_rows_returned', out.assignees.length === 3 && Array.isArray(out.attachments) && out.attachments.length === 0, { out });
  }

  {
    // DB error (vd permission denied) -> mapPgError giữ nguyên hành vi đã có,
    // rollback đúng.
    const client = makeFakeClient([
      { expect: BEGIN_RO, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SET_TIMEOUT, result: {} },
      { expect: /^SELECT \* FROM task\.tasks WHERE id = \$1$/, error: Object.assign(new Error('permission denied'), { code: '42501' }) },
      { expect: ROLLBACK, result: {} },
    ]);
    const { getTaskById } = loadWithFakePg(TASK_READ_JS_PATH, client);
    let error;
    try { await getTaskById(MOCK_CONFIG, 't3'); } catch (e) { error = e; }
    record('getTaskById_DB_ERROR_mapped_and_rolled_back', error && error.code === 'TASK_PERMISSION_DENIED' && client._remainingSteps() === 0, { code: error && error.code });
  }

  // ===========================================================================
  // lib/task-query-executor.js — verifyDescriptor() unchanged behavior
  // ===========================================================================
  {
    const client = makeFakeClient([]); // never reaches DB — descriptor rejected first
    const { executeResolvedTaskQuery } = loadWithFakePg(TASK_QUERY_EXECUTOR_JS_PATH, client);
    let error;
    try { await executeResolvedTaskQuery(MOCK_CONFIG, { mode: 'creator_eq' }, SECRET); } catch (e) { error = e; }
    record('executeResolvedTaskQuery_SIGNATURE_MISSING', error && error.code === 'SIGNATURE_MISSING' && error.statusCode === 401 && client._remainingSteps() === 0, { code: error && error.code });
  }

  {
    const client = makeFakeClient([]);
    const { executeResolvedTaskQuery } = loadWithFakePg(TASK_QUERY_EXECUTOR_JS_PATH, client);
    const descriptor = signDescriptor({ mode: 'creator_eq', flowType: 'giao_viec', expiresAt: new Date(Date.now() - 1000).toISOString(), nonce: 'n1' }, SECRET);
    let error;
    try { await executeResolvedTaskQuery(MOCK_CONFIG, descriptor, SECRET); } catch (e) { error = e; }
    record('executeResolvedTaskQuery_EXPIRED', error && error.code === 'DESCRIPTOR_EXPIRED', { code: error && error.code });
  }

  // ===========================================================================
  // lib/task-query-executor.js — executeResolvedTaskQuery() creator_eq happy path
  // ===========================================================================
  {
    const client = makeFakeClient([
      { expect: BEGIN_RO, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SET_TIMEOUT, result: {} },
      {
        // Proposal V2 (2026-08-29, additive) — SQL nay có alias t./pd. + LEFT
        // JOIN task.proposal_decisions (xem lib/task-query-executor.js).
        expect: /^SELECT t\.id, t\.task_code, t\.flow_type, t\.status, t\.title, t\.priority, t\.deadline, t\.category_code, t\.progress_percent, t\.progress_status, t\.created_by_employee_code, t\.created_by_account_id, t\.recurring_series_id, t\.is_cross_department, t\.source_department, t\.target_department, t\.created_at, t\.row_version, pd\.proposal_status, pd\.recipient_employee_code, pd\.generated_task_id, pd\.reject_reason, pd\.cancel_reason, pd\.decided_by_employee_code, pd\.decided_at, EXISTS \( SELECT 1 FROM task\.proposal_decisions gpd WHERE gpd\.generated_task_id = t\.id \) AS proposal_generated FROM task\.tasks t LEFT JOIN task\.proposal_decisions pd ON pd\.proposal_task_id = t\.id WHERE flow_type = \$1 AND t\.created_by_employee_code = \$2 ORDER BY t\.created_at DESC, t\.id ASC LIMIT \$3 OFFSET \$4$/,
        result: { rows: [{ id: 't1', task_code: 'CV-1', flow_type: 'giao_viec', status: 'published', title: 'x', priority: 'normal', deadline: '2026-09-01', created_by_employee_code: 'PHF001', is_cross_department: false, source_department: 'Bán hàng', target_department: 'Bán hàng', created_at: '2026-08-01', row_version: 1 }] },
      },
      { expect: /^SELECT task_id, employee_code FROM task\.assignees WHERE role = 'primary' AND is_active = true AND task_id = ANY\(\$1::uuid\[\]\)$/, result: { rows: [{ task_id: 't1', employee_code: 'PHF001' }] } },
      // SOURCE OF WORK V1 — additive INITIAL primary (earliest assigned_at).
      { expect: /^SELECT DISTINCT ON \(task_id\) task_id, employee_code FROM task\.assignees WHERE role = 'primary' AND task_id = ANY\(\$1::uuid\[\]\) ORDER BY task_id, assigned_at ASC, id ASC$/, result: { rows: [{ task_id: 't1', employee_code: 'PHF001' }] } },
      { expect: COMMIT, result: {} },
    ]);
    const { executeResolvedTaskQuery } = loadWithFakePg(TASK_QUERY_EXECUTOR_JS_PATH, client);
    const descriptor = signDescriptor({
      mode: 'creator_eq', flowType: 'giao_viec', creatorEmployeeCode: 'PHF001',
      expiresAt: new Date(Date.now() + 60000).toISOString(), nonce: 'n2',
      relation: 'created', scope: 'self', viewScopeType: 'self', requesterActorType: 'nhan_vien',
      offset: 0, limit: 50,
    }, SECRET);
    const out = await executeResolvedTaskQuery(MOCK_CONFIG, descriptor, SECRET);
    // Proposal V2 (2026-08-29) — SQL nay có "FROM task.tasks t LEFT JOIN
    // task.proposal_decisions pd ON ... WHERE" (không còn "task.tasks WHERE"
    // liền nhau) — match rộng hơn nhưng vẫn chỉ khớp đúng 1 câu (list query
    // chính, phân biệt với câu SELECT task_id, employee_code FROM task.assignees).
    const q1 = client.calls.find((c) => /FROM task\.tasks .*WHERE flow_type = \$1/.test(c.sql));
    record('executeResolvedTaskQuery_creator_eq_HAPPY_PATH',
      out.count === 1 && out.data[0].primaryEmployeeCode === 'PHF001' && out.hasMore === false
      && q1.params[0] === 'giao_viec' && q1.params[1] === 'PHF001' && q1.params[2] === 51 && q1.params[3] === 0,
      { out, params: q1.params });
  }

  // ===========================================================================
  // assignee_in — empty array -> emptyResult INSIDE the transaction (BEGIN/SET
  // ROLE/timeout still run — the transaction opens before the branch checks
  // assigneeEmployeeCodes; the short-circuit skips only the SELECT queries).
  // ===========================================================================
  {
    const client = makeFakeClient([
      { expect: BEGIN_RO, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SET_TIMEOUT, result: {} },
      { expect: COMMIT, result: {} },
    ]);
    const { executeResolvedTaskQuery } = loadWithFakePg(TASK_QUERY_EXECUTOR_JS_PATH, client);
    const descriptor = signDescriptor({
      mode: 'assignee_in', flowType: 'giao_viec', assigneeEmployeeCodes: [],
      expiresAt: new Date(Date.now() + 60000).toISOString(), nonce: 'n3',
      relation: 'assigned', scope: 'employees', viewScopeType: 'employees', requesterActorType: 'truong_bo_phan',
      offset: 0, limit: 50,
    }, SECRET);
    const out = await executeResolvedTaskQuery(MOCK_CONFIG, descriptor, SECRET);
    record('executeResolvedTaskQuery_assignee_in_EMPTY_ARRAY_no_select', out.count === 0 && out.data.length === 0 && client._remainingSteps() === 0, { out });
  }

  // ===========================================================================
  // assignee_in — codes given, matching task ids found, excludeDraft + crossDepartmentOnly
  // ===========================================================================
  {
    const client = makeFakeClient([
      { expect: BEGIN_RO, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SET_TIMEOUT, result: {} },
      {
        expect: /^SELECT DISTINCT task_id FROM task\.assignees WHERE role = 'primary' AND is_active = true AND employee_code = ANY\(\$1::text\[\]\) LIMIT 5000$/,
        result: { rows: [{ task_id: 't1' }, { task_id: 't2' }] },
      },
      {
        expect: /^SELECT t\.id, t\.task_code, t\.flow_type, t\.status, t\.title, t\.priority, t\.deadline, t\.category_code, t\.progress_percent, t\.progress_status, t\.created_by_employee_code, t\.created_by_account_id, t\.recurring_series_id, t\.is_cross_department, t\.source_department, t\.target_department, t\.created_at, t\.row_version, pd\.proposal_status, pd\.recipient_employee_code, pd\.generated_task_id, pd\.reject_reason, pd\.cancel_reason, pd\.decided_by_employee_code, pd\.decided_at, EXISTS \( SELECT 1 FROM task\.proposal_decisions gpd WHERE gpd\.generated_task_id = t\.id \) AS proposal_generated FROM task\.tasks t LEFT JOIN task\.proposal_decisions pd ON pd\.proposal_task_id = t\.id WHERE flow_type = \$1 AND id = ANY\(\$2::uuid\[\]\) AND status <> 'draft' AND is_cross_department = true ORDER BY t\.created_at DESC, t\.id ASC LIMIT \$3 OFFSET \$4$/,
        result: { rows: [{ id: 't2', task_code: 'CV-2', flow_type: 'giao_viec', status: 'in_progress', title: 'y', priority: 'high', deadline: '2026-09-05', created_by_employee_code: 'PHF002', is_cross_department: true, source_department: 'A', target_department: 'B', created_at: '2026-08-02', row_version: 1 }] },
      },
      { expect: /^SELECT task_id, employee_code FROM task\.assignees WHERE role = 'primary' AND is_active = true AND task_id = ANY\(\$1::uuid\[\]\)$/, result: { rows: [{ task_id: 't2', employee_code: 'PHF080' }] } },
      { expect: /^SELECT DISTINCT ON \(task_id\) task_id, employee_code FROM task\.assignees WHERE role = 'primary' AND task_id = ANY\(\$1::uuid\[\]\) ORDER BY task_id, assigned_at ASC, id ASC$/, result: { rows: [{ task_id: 't2', employee_code: 'PHF080' }] } },
      { expect: COMMIT, result: {} },
    ]);
    const { executeResolvedTaskQuery } = loadWithFakePg(TASK_QUERY_EXECUTOR_JS_PATH, client);
    const descriptor = signDescriptor({
      mode: 'assignee_in', flowType: 'giao_viec', assigneeEmployeeCodes: ['PHF010', 'PHF012'],
      excludeDraft: true, crossDepartmentOnly: true,
      expiresAt: new Date(Date.now() + 60000).toISOString(), nonce: 'n4',
      relation: 'assigned', scope: 'employees', viewScopeType: 'employees', requesterActorType: 'truong_bo_phan',
      offset: 0, limit: 50,
    }, SECRET);
    const out = await executeResolvedTaskQuery(MOCK_CONFIG, descriptor, SECRET);
    record('executeResolvedTaskQuery_assignee_in_WITH_FILTERS', out.count === 1 && out.data[0].taskCode === 'CV-2' && out.data[0].isCrossDepartment === true, { out });
  }

  // ===========================================================================
  // assignee_in — codes given, ZERO matching task ids -> emptyResult after 1 query
  // ===========================================================================
  {
    const client = makeFakeClient([
      { expect: BEGIN_RO, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SET_TIMEOUT, result: {} },
      { expect: /^SELECT DISTINCT task_id FROM task\.assignees/, result: { rows: [] } },
      { expect: COMMIT, result: {} },
    ]);
    const { executeResolvedTaskQuery } = loadWithFakePg(TASK_QUERY_EXECUTOR_JS_PATH, client);
    const descriptor = signDescriptor({
      mode: 'assignee_in', flowType: 'giao_viec', assigneeEmployeeCodes: ['PHF999'],
      expiresAt: new Date(Date.now() + 60000).toISOString(), nonce: 'n5',
      relation: 'assigned', scope: 'self', viewScopeType: 'self', requesterActorType: 'nhan_vien',
      offset: 0, limit: 50,
    }, SECRET);
    const out = await executeResolvedTaskQuery(MOCK_CONFIG, descriptor, SECRET);
    record('executeResolvedTaskQuery_assignee_in_NO_MATCHING_TASKS', out.count === 0 && client._remainingSteps() === 0, { out });
  }

  // ===========================================================================
  // statusFilter variants — overdue + search, hasMore detection
  // ===========================================================================
  {
    const client = makeFakeClient([
      { expect: BEGIN_RO, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SET_TIMEOUT, result: {} },
      {
        expect: /^SELECT t\.id, t\.task_code, t\.flow_type, t\.status, t\.title, t\.priority, t\.deadline, t\.category_code, t\.progress_percent, t\.progress_status, t\.created_by_employee_code, t\.created_by_account_id, t\.recurring_series_id, t\.is_cross_department, t\.source_department, t\.target_department, t\.created_at, t\.row_version, pd\.proposal_status, pd\.recipient_employee_code, pd\.generated_task_id, pd\.reject_reason, pd\.cancel_reason, pd\.decided_by_employee_code, pd\.decided_at, EXISTS \( SELECT 1 FROM task\.proposal_decisions gpd WHERE gpd\.generated_task_id = t\.id \) AS proposal_generated FROM task\.tasks t LEFT JOIN task\.proposal_decisions pd ON pd\.proposal_task_id = t\.id WHERE flow_type = \$1 AND t\.created_by_employee_code = \$2 AND status IN \('published', 'in_progress'\) AND deadline < \$3 AND \(task_code ILIKE \$4 OR title ILIKE \$4\) ORDER BY t\.created_at DESC, t\.id ASC LIMIT \$5 OFFSET \$6$/,
        result: { rows: [{ id: 't1', row_version: 1 }, { id: 't2', row_version: 1 }, { id: 't3', row_version: 1 }] }, // 3 rows for limit=2 -> hasMore
      },
      { expect: /^SELECT task_id, employee_code FROM task\.assignees/, result: { rows: [] } },
      { expect: /^SELECT DISTINCT ON \(task_id\) task_id, employee_code FROM task\.assignees/, result: { rows: [] } },
      { expect: COMMIT, result: {} },
    ]);
    const { executeResolvedTaskQuery } = loadWithFakePg(TASK_QUERY_EXECUTOR_JS_PATH, client);
    const descriptor = signDescriptor({
      mode: 'creator_eq', flowType: 'giao_viec', creatorEmployeeCode: 'PHF001',
      statusFilter: 'overdue', search: 'CV_2608%',
      expiresAt: new Date(Date.now() + 60000).toISOString(), nonce: 'n6',
      relation: 'created', scope: 'self', viewScopeType: 'self', requesterActorType: 'nhan_vien',
      offset: 0, limit: 2,
    }, SECRET);
    const out = await executeResolvedTaskQuery(MOCK_CONFIG, descriptor, SECRET);
    const q1 = client.calls.find((c) => /FROM task\.tasks .*WHERE flow_type = \$1/.test(c.sql));
    record('executeResolvedTaskQuery_overdue_search_hasMore',
      out.hasMore === true && out.data.length === 2 && q1.params[3] === '%CV\\_2608\\%%',
      { out, params: q1.params });
  }

  // ===========================================================================
  // withTaskReadTransaction — ROLLBACK path on generic error propagates unchanged
  // ===========================================================================
  {
    const client = makeFakeClient([
      { expect: BEGIN_RO, result: {} },
      { expect: SET_ROLE, result: {} },
      { expect: SET_TIMEOUT, result: {} },
      { expect: /^SELECT id, task_code/, error: Object.assign(new Error('unexpected'), { code: 'XX000' }) },
      { expect: ROLLBACK, result: {} },
    ]);
    const { executeResolvedTaskQuery } = loadWithFakePg(TASK_QUERY_EXECUTOR_JS_PATH, client);
    const descriptor = signDescriptor({
      mode: 'creator_eq', flowType: 'giao_viec', creatorEmployeeCode: 'PHF001',
      expiresAt: new Date(Date.now() + 60000).toISOString(), nonce: 'n7',
      relation: 'created', scope: 'self', viewScopeType: 'self', requesterActorType: 'nhan_vien',
      offset: 0, limit: 50,
    }, SECRET);
    let error;
    try { await executeResolvedTaskQuery(MOCK_CONFIG, descriptor, SECRET); } catch (e) { error = e; }
    record('executeResolvedTaskQuery_DB_ERROR_wrapped_and_rolled_back', error && error.code === 'TASK_QUERY_EXECUTOR_DB_ERROR' && client._remainingSteps() === 0, { code: error && error.code });
  }

  const allPass = results.every((r) => r.pass);
  console.log('OVERALL', allPass ? 'PASS' : 'FAIL', `(${results.filter((r) => r.pass).length}/${results.length})`);
  process.exit(allPass ? 0 : 1);
})();
