'use strict';

// TEST/MOCK HARNESS cho lib/task-write.js — KHÔNG phải production code.
// KHÔNG kết nối DB thật, KHÔNG dùng credential thật, KHÔNG dùng network thật.
// Cùng kỹ thuật đã dùng ở test-transaction-helper-mock-harness.js: inject
// module 'pg' giả vào require.cache TRƯỚC khi require lib/task-write.js (bản
// thân nó require lib/db.js, vốn require 'pg') — KHÔNG sửa bất kỳ file
// production nào (lib/db.js, lib/task-write.js đều không bị đụng bởi harness
// này, chỉ được require).
//
// Bản cập nhật (parity gap fix): thêm test cho integer-boundary normalization
// (Gap 1) và jsonb_build_object phía SQL cho completion/reopen payload
// (Gap 2), đồng thời cập nhật script cho completeTask/reopenTask do 2 hàm
// này nay gộp UPDATE+INSERT events vào 1 statement CTE thay vì 2 statement
// riêng như bản trước.
//
// Chạy: node test-task-write-mock-harness.js

const assert = require('assert');
const fs = require('fs');

const DB_JS_PATH = require.resolve('./lib/db.js');
const TASK_WRITE_JS_PATH = require.resolve('./lib/task-write.js');

// ---------------------------------------------------------------------------
// Fake client — script-driven: mỗi lần .query() gọi, so khớp SQL với bước kế
// tiếp trong "script" đã định nghĩa cho từng scenario. Nếu SQL không khớp
// đúng bước kỳ vọng, hoặc gọi nhiều/ít hơn số bước đã script, test tự FAIL rõ
// ràng thay vì âm thầm bỏ qua.
// ---------------------------------------------------------------------------
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

function loadTaskWriteWithFakePg(client) {
  const pgPath = require.resolve('pg');
  delete require.cache[DB_JS_PATH];
  delete require.cache[TASK_WRITE_JS_PATH];
  const originalPgEntry = require.cache[pgPath];
  require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: makeFakePgModule(client) };
  const taskWrite = require(TASK_WRITE_JS_PATH);
  if (originalPgEntry) require.cache[pgPath] = originalPgEntry;
  else delete require.cache[pgPath];
  return taskWrite;
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

const SELECT_FOR_UPDATE = /^SELECT \* FROM task\.tasks WHERE id = \$1 FOR UPDATE$/;
const UPDATE_TASKS_SIMPLE = /^UPDATE task\.tasks/; // updateTaskProgress vẫn 2-statement
const INSERT_EVENTS_SIMPLE = /^INSERT INTO task\.events/; // updateTaskProgress vẫn 2-statement
const COMBINED_CTE = /^WITH updated AS \( UPDATE task\.tasks/; // completeTask/reopenTask nay gộp 1 statement

(async () => {
  // =========================================================================
  // updateTaskProgress — GAP 1 (integer boundary) — vẫn 2-statement, không
  // đổi cấu trúc SQL, chỉ đổi validation trước khi build query.
  // =========================================================================
  {
    // 1) success (number hợp lệ) — hành vi cũ, không regression
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 5, status: 'published', progress_percent: 0 }], rowCount: 1 } },
      { expect: UPDATE_TASKS_SIMPLE, result: { rows: [{ id: 't1', row_version: 6, status: 'in_progress', progress_percent: 40, progress_status: 'dang_thuc_hien' }], rowCount: 1 } },
      { expect: INSERT_EVENTS_SIMPLE, result: { rows: [], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { updateTaskProgress } = loadTaskWriteWithFakePg(client);
    const out = await updateTaskProgress(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 5, actorEmployeeCode: 'PHF001', progressPercent: 40, progressStatus: 'dang_thuc_hien' });
    const eventCall = client.calls.find((c) => INSERT_EVENTS_SIMPLE.test(c.sql));
    record('updateTaskProgress_SUCCESS_number', out.status === 'in_progress' && out.row_version === 6 && eventCall.params[1] === 'PHF001', { out });
  }

  {
    // 2) CAS mismatch (number, genuine mismatch) — không regression
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 5, status: 'published' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { updateTaskProgress } = loadTaskWriteWithFakePg(client);
    let error;
    try { await updateTaskProgress(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 999, progressPercent: 40, progressStatus: 'dang_thuc_hien' }); } catch (e) { error = e; }
    record('updateTaskProgress_CAS_MISMATCH_number', error && error.code === 'TASK_VERSION_CONFLICT' && client._remainingSteps() === 0, { code: error && error.code });
  }

  {
    // 3) NOT_FOUND — không regression
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [], rowCount: 0 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { updateTaskProgress } = loadTaskWriteWithFakePg(client);
    let error;
    try { await updateTaskProgress(MOCK_CONFIG, { taskId: 'missing', expectedRowVersion: 1, progressPercent: 10, progressStatus: 'dang_thuc_hien' }); } catch (e) { error = e; }
    record('updateTaskProgress_NOT_FOUND', error && error.code === 'TASK_NOT_FOUND', { code: error && error.code });
  }

  {
    // 4) NOT_ACTIVE — không regression
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'draft' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { updateTaskProgress } = loadTaskWriteWithFakePg(client);
    let error;
    try { await updateTaskProgress(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, progressPercent: 10, progressStatus: 'dang_thuc_hien' }); } catch (e) { error = e; }
    record('updateTaskProgress_NOT_ACTIVE', error && error.code === 'TASK_NOT_ACTIVE', { code: error && error.code });
  }

  {
    // 5) percent invalid (number ngoài range) — không regression
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'published' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { updateTaskProgress } = loadTaskWriteWithFakePg(client);
    let error;
    try { await updateTaskProgress(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, progressPercent: 150, progressStatus: 'dang_thuc_hien' }); } catch (e) { error = e; }
    record('updateTaskProgress_PERCENT_INVALID_outOfRange', error && error.code === 'TASK_PROGRESS_PERCENT_INVALID', { code: error && error.code });
  }

  {
    // 6) progress_status invalid — không regression
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'published' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { updateTaskProgress } = loadTaskWriteWithFakePg(client);
    let error;
    try { await updateTaskProgress(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, progressPercent: 10, progressStatus: 'khong_hop_le' }); } catch (e) { error = e; }
    record('updateTaskProgress_STATUS_INVALID', error && error.code === 'TASK_PROGRESS_STATUS_INVALID', { code: error && error.code });
  }

  {
    // 7) expectedRowVersion numeric-string khớp thật -> SUCCESS, không false-positive CAS
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 5, status: 'published' }], rowCount: 1 } },
      { expect: UPDATE_TASKS_SIMPLE, result: { rows: [{ id: 't1', row_version: 6, status: 'in_progress' }], rowCount: 1 } },
      { expect: INSERT_EVENTS_SIMPLE, result: { rows: [], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { updateTaskProgress } = loadTaskWriteWithFakePg(client);
    const out = await updateTaskProgress(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: '5', progressPercent: 10, progressStatus: 'dang_thuc_hien' });
    record('updateTaskProgress_expectedRowVersion_numericString_matches', out.row_version === 6, { out });
  }

  {
    // 7b) expectedRowVersion numeric-string normalize được nhưng KHÔNG khớp -> CAS mismatch thật (không phải do lỗi kiểu)
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 5, status: 'published' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { updateTaskProgress } = loadTaskWriteWithFakePg(client);
    let error;
    try { await updateTaskProgress(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: '999', progressPercent: 10, progressStatus: 'dang_thuc_hien' }); } catch (e) { error = e; }
    record('updateTaskProgress_expectedRowVersion_numericString_genuineMismatch', error && error.code === 'TASK_VERSION_CONFLICT', { code: error && error.code });
  }

  {
    // 8) expectedRowVersion decimal (number) -> normalize FAIL -> throw TƯỜNG MINH TASK_VERSION_CONFLICT (FINAL contract)
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 5, status: 'published' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { updateTaskProgress } = loadTaskWriteWithFakePg(client);
    let error;
    try { await updateTaskProgress(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 5.5, progressPercent: 10, progressStatus: 'dang_thuc_hien' }); } catch (e) { error = e; }
    record('updateTaskProgress_expectedRowVersion_decimalNumber_VERSION_CONFLICT', error && error.code === 'TASK_VERSION_CONFLICT', { code: error && error.code });
  }

  {
    // 8b) expectedRowVersion decimal (string "5.5") -> normalize FAIL -> TASK_VERSION_CONFLICT
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 5, status: 'published' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { updateTaskProgress } = loadTaskWriteWithFakePg(client);
    let error;
    try { await updateTaskProgress(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: '5.5', progressPercent: 10, progressStatus: 'dang_thuc_hien' }); } catch (e) { error = e; }
    record('updateTaskProgress_expectedRowVersion_decimalString_VERSION_CONFLICT', error && error.code === 'TASK_VERSION_CONFLICT', { code: error && error.code });
  }

  {
    // 9) expectedRowVersion non-numeric string "abc" -> normalize FAIL -> TASK_VERSION_CONFLICT
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 5, status: 'published' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { updateTaskProgress } = loadTaskWriteWithFakePg(client);
    let error;
    try { await updateTaskProgress(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 'abc', progressPercent: 10, progressStatus: 'dang_thuc_hien' }); } catch (e) { error = e; }
    record('updateTaskProgress_expectedRowVersion_nonNumericString_VERSION_CONFLICT', error && error.code === 'TASK_VERSION_CONFLICT', { code: error && error.code });
  }

  {
    // 9b) expectedRowVersion "5abc" (mixed) -> normalize FAIL -> TASK_VERSION_CONFLICT (KHÔNG được lọt qua như parseInt("5abc")===5)
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 5, status: 'published' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { updateTaskProgress } = loadTaskWriteWithFakePg(client);
    let error;
    try { await updateTaskProgress(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: '5abc', progressPercent: 10, progressStatus: 'dang_thuc_hien' }); } catch (e) { error = e; }
    record('updateTaskProgress_expectedRowVersion_mixedString_5abc_VERSION_CONFLICT', error && error.code === 'TASK_VERSION_CONFLICT', { code: error && error.code });
  }

  {
    // 9c) expectedRowVersion = NaN -> normalize FAIL -> TASK_VERSION_CONFLICT
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 5, status: 'published' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { updateTaskProgress } = loadTaskWriteWithFakePg(client);
    let error;
    try { await updateTaskProgress(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: NaN, progressPercent: 10, progressStatus: 'dang_thuc_hien' }); } catch (e) { error = e; }
    record('updateTaskProgress_expectedRowVersion_NaN_VERSION_CONFLICT', error && error.code === 'TASK_VERSION_CONFLICT', { code: error && error.code });
  }

  {
    // 9d) expectedRowVersion = Infinity -> normalize FAIL -> TASK_VERSION_CONFLICT
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 5, status: 'published' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { updateTaskProgress } = loadTaskWriteWithFakePg(client);
    let error;
    try { await updateTaskProgress(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: Infinity, progressPercent: 10, progressStatus: 'dang_thuc_hien' }); } catch (e) { error = e; }
    record('updateTaskProgress_expectedRowVersion_Infinity_VERSION_CONFLICT', error && error.code === 'TASK_VERSION_CONFLICT', { code: error && error.code });
  }

  {
    // 10) progressPercent numeric-string hợp lệ -> SUCCESS, payload new_percent phải là NUMBER (không phải string)
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 5, status: 'published' }], rowCount: 1 } },
      { expect: UPDATE_TASKS_SIMPLE, result: { rows: [{ id: 't1', row_version: 6, status: 'in_progress' }], rowCount: 1 } },
      { expect: INSERT_EVENTS_SIMPLE, result: { rows: [], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { updateTaskProgress } = loadTaskWriteWithFakePg(client);
    await updateTaskProgress(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 5, progressPercent: '40', progressStatus: 'dang_thuc_hien' });
    const updateCall = client.calls.find((c) => UPDATE_TASKS_SIMPLE.test(c.sql));
    const eventCall = client.calls.find((c) => INSERT_EVENTS_SIMPLE.test(c.sql));
    const payload = JSON.parse(eventCall.params[3]);
    record(
      'updateTaskProgress_percent_numericString_normalizedToNumber',
      updateCall.params[0] === 40 && typeof updateCall.params[0] === 'number' && typeof payload.new_percent === 'number' && payload.new_percent === 40,
      { updateParam0: updateCall.params[0], payloadNewPercent: payload.new_percent, payloadNewPercentType: typeof payload.new_percent }
    );
  }

  {
    // 11) progressPercent "abc" -> TASK_PROGRESS_PERCENT_INVALID (theo chỉ định tường minh Technical Lead)
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'published' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { updateTaskProgress } = loadTaskWriteWithFakePg(client);
    let error;
    try { await updateTaskProgress(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, progressPercent: 'abc', progressStatus: 'dang_thuc_hien' }); } catch (e) { error = e; }
    record('updateTaskProgress_percent_nonNumericString_invalid', error && error.code === 'TASK_PROGRESS_PERCENT_INVALID', { code: error && error.code });
  }

  {
    // 12) progressPercent decimal -> TASK_PROGRESS_PERCENT_INVALID
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'published' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { updateTaskProgress } = loadTaskWriteWithFakePg(client);
    let error;
    try { await updateTaskProgress(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, progressPercent: 40.5, progressStatus: 'dang_thuc_hien' }); } catch (e) { error = e; }
    record('updateTaskProgress_percent_decimal_invalid', error && error.code === 'TASK_PROGRESS_PERCENT_INVALID', { code: error && error.code });
  }

  {
    // 13) progressPercent numeric-string ngoài range -> TASK_PROGRESS_PERCENT_INVALID
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'published' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { updateTaskProgress } = loadTaskWriteWithFakePg(client);
    let error;
    try { await updateTaskProgress(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, progressPercent: '150', progressStatus: 'dang_thuc_hien' }); } catch (e) { error = e; }
    record('updateTaskProgress_percent_numericString_outOfRange_invalid', error && error.code === 'TASK_PROGRESS_PERCENT_INVALID', { code: error && error.code });
  }

  // =========================================================================
  // completeTask — GAP 2 (jsonb_build_object phía SQL, gộp UPDATE+INSERT)
  // =========================================================================
  {
    // 14) success — SQL phải là 1 statement CTE duy nhất, chứa jsonb_build_object
    // với đủ 4 key, KHÔNG có bước INSERT_EVENTS riêng nào khác.
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 3, status: 'in_progress' }], rowCount: 1 } },
      { expect: COMBINED_CTE, result: { rows: [{ id: 't1', row_version: 4, status: 'completed', completed_at: new Date('2026-08-25T00:00:00Z'), deadline: new Date('2026-09-01T00:00:00Z') }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { completeTask } = loadTaskWriteWithFakePg(client);
    const out = await completeTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 3, actorEmployeeCode: 'PHF001', resultText: 'Xong.' });
    const combinedCall = client.calls.find((c) => COMBINED_CTE.test(c.sql));
    const sqlHasJsonbBuildObject = /jsonb_build_object/.test(combinedCall.sql);
    const sqlHasAllKeys = /'result_text'/.test(combinedCall.sql) && /'completed_at'/.test(combinedCall.sql) && /'on_time'/.test(combinedCall.sql) && /'deadline'/.test(combinedCall.sql);
    const sqlHasOnTimeComparison = /completed_at <= deadline/.test(combinedCall.sql);
    const noSeparateInsertStep = client.calls.filter((c) => c.sql && /^INSERT/.test(c.sql)).length === 0;
    record(
      'completeTask_SUCCESS_jsonb_build_object_in_SQL',
      out.status === 'completed' && sqlHasJsonbBuildObject && sqlHasAllKeys && sqlHasOnTimeComparison && noSeparateInsertStep,
      { out, sqlHasJsonbBuildObject, sqlHasAllKeys, sqlHasOnTimeComparison, noSeparateInsertStep, sql: combinedCall.sql }
    );
  }

  {
    // 15) result_text required — không regression (lỗi trước khi tới combined query)
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'published' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { completeTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await completeTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, resultText: '   ' }); } catch (e) { error = e; }
    record('completeTask_RESULT_REQUIRED', error && error.code === 'TASK_COMPLETION_RESULT_REQUIRED', { code: error && error.code });
  }

  {
    // 16) đã completed rồi -> NOT_ACTIVE — không regression
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'completed' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { completeTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await completeTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, resultText: 'x' }); } catch (e) { error = e; }
    record('completeTask_ALREADY_COMPLETED_NOT_ACTIVE', error && error.code === 'TASK_NOT_ACTIVE', { code: error && error.code });
  }

  {
    // 17) expectedRowVersion decimal -> normalize FAIL -> TASK_VERSION_CONFLICT tường minh
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 3, status: 'in_progress' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { completeTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await completeTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 3.1, resultText: 'x' }); } catch (e) { error = e; }
    record('completeTask_expectedRowVersion_decimal_VERSION_CONFLICT', error && error.code === 'TASK_VERSION_CONFLICT', { code: error && error.code });
  }

  {
    // 17b) expectedRowVersion NaN -> TASK_VERSION_CONFLICT (đồng nhất với updateTaskProgress)
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 3, status: 'in_progress' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { completeTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await completeTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: NaN, resultText: 'x' }); } catch (e) { error = e; }
    record('completeTask_expectedRowVersion_NaN_VERSION_CONFLICT', error && error.code === 'TASK_VERSION_CONFLICT', { code: error && error.code });
  }

  // =========================================================================
  // reopenTask — GAP 2 (jsonb_build_object phía SQL, gộp UPDATE+INSERT)
  // =========================================================================
  {
    // 18) success — CTE duy nhất, jsonb_build_object với previous_completed_at
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 4, status: 'completed', completed_at: new Date('2026-08-20T00:00:00Z') }], rowCount: 1 } },
      { expect: COMBINED_CTE, result: { rows: [{ id: 't1', row_version: 5, status: 'in_progress', completed_at: null }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { reopenTask } = loadTaskWriteWithFakePg(client);
    const out = await reopenTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 4, actorEmployeeCode: 'PHF001', reason: 'Sai kết quả.' });
    const combinedCall = client.calls.find((c) => COMBINED_CTE.test(c.sql));
    const sqlHasJsonbBuildObject = /jsonb_build_object\('previous_completed_at'/.test(combinedCall.sql);
    const sqlHasReasonColumn = /INSERT INTO task\.events \(task_id, event_type, actor_employee_code, actor_account_id, payload, reason\)/.test(combinedCall.sql);
    const reasonParam = combinedCall.params[combinedCall.params.length - 1];
    const noSeparateInsertStep = client.calls.filter((c) => c.sql && /^INSERT/.test(c.sql)).length === 0;
    record(
      'reopenTask_SUCCESS_jsonb_build_object_in_SQL',
      out.status === 'in_progress' && out.completed_at === null && sqlHasJsonbBuildObject && sqlHasReasonColumn && reasonParam === 'Sai kết quả.' && noSeparateInsertStep,
      { out, sqlHasJsonbBuildObject, sqlHasReasonColumn, reasonParam, noSeparateInsertStep, sql: combinedCall.sql }
    );
  }

  {
    // 19) chưa completed -> TASK_NOT_COMPLETED — không regression
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'in_progress' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { reopenTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await reopenTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, reason: 'x' }); } catch (e) { error = e; }
    record('reopenTask_NOT_COMPLETED', error && error.code === 'TASK_NOT_COMPLETED', { code: error && error.code });
  }

  {
    // 20) reason required — không regression
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'completed' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { reopenTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await reopenTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, reason: '' }); } catch (e) { error = e; }
    record('reopenTask_REASON_REQUIRED', error && error.code === 'TASK_REOPEN_REASON_REQUIRED', { code: error && error.code });
  }

  {
    // 20b) expectedRowVersion "5abc" -> TASK_VERSION_CONFLICT (đồng nhất với updateTaskProgress/completeTask)
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 4, status: 'completed' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { reopenTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await reopenTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: '4abc', reason: 'x' }); } catch (e) { error = e; }
    record('reopenTask_expectedRowVersion_mixedString_VERSION_CONFLICT', error && error.code === 'TASK_VERSION_CONFLICT', { code: error && error.code });
  }

  {
    // 20c) expectedRowVersion Infinity -> TASK_VERSION_CONFLICT
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 4, status: 'completed' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { reopenTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await reopenTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: Infinity, reason: 'x' }); } catch (e) { error = e; }
    record('reopenTask_expectedRowVersion_Infinity_VERSION_CONFLICT', error && error.code === 'TASK_VERSION_CONFLICT', { code: error && error.code });
  }

  // =========================================================================
  // cancelTask (Batch 2) — 2-statement đơn giản (payload không có timestamp)
  // =========================================================================
  {
    // C1) success — active task -> cancelled, row_version+1, event previous_status+reason
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 3, status: 'in_progress' }], rowCount: 1 } },
      { expect: UPDATE_TASKS_SIMPLE, result: { rows: [{ id: 't1', row_version: 4, status: 'cancelled', cancel_reason: 'Không còn cần thiết.' }], rowCount: 1 } },
      { expect: INSERT_EVENTS_SIMPLE, result: { rows: [], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { cancelTask } = loadTaskWriteWithFakePg(client);
    const out = await cancelTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 3, actorEmployeeCode: 'PHF001', reason: 'Không còn cần thiết.' });
    const eventCall = client.calls.find((c) => INSERT_EVENTS_SIMPLE.test(c.sql));
    const payload = JSON.parse(eventCall.params[3]);
    record(
      'cancelTask_SUCCESS_previousStatus_and_reason',
      out.status === 'cancelled' && out.row_version === 4 && /'cancel'/.test(eventCall.sql) && payload.previous_status === 'in_progress' && eventCall.params[4] === 'Không còn cần thiết.',
      { out, payload, reasonParam: eventCall.params[4] }
    );
  }

  {
    // C2) draft -> TASK_DRAFT_USE_DELETE
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'draft' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { cancelTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await cancelTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, reason: 'x' }); } catch (e) { error = e; }
    record('cancelTask_DRAFT_USE_DELETE', error && error.code === 'TASK_DRAFT_USE_DELETE', { code: error && error.code });
  }

  {
    // C3) đã cancelled -> TASK_ALREADY_CANCELLED
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'cancelled' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { cancelTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await cancelTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, reason: 'x' }); } catch (e) { error = e; }
    record('cancelTask_ALREADY_CANCELLED', error && error.code === 'TASK_ALREADY_CANCELLED', { code: error && error.code });
  }

  {
    // C4) completed -> phải reopen trước -> TASK_MUST_REOPEN_BEFORE_CANCEL
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'completed' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { cancelTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await cancelTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, reason: 'x' }); } catch (e) { error = e; }
    record('cancelTask_MUST_REOPEN_BEFORE_CANCEL', error && error.code === 'TASK_MUST_REOPEN_BEFORE_CANCEL', { code: error && error.code });
  }

  {
    // C5) missing reason -> TASK_CANCEL_REASON_REQUIRED
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'in_progress' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { cancelTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await cancelTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, reason: '   ' }); } catch (e) { error = e; }
    record('cancelTask_REASON_REQUIRED', error && error.code === 'TASK_CANCEL_REASON_REQUIRED', { code: error && error.code });
  }

  {
    // C6) CAS mismatch -> TASK_VERSION_CONFLICT
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 3, status: 'in_progress' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { cancelTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await cancelTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 999, reason: 'x' }); } catch (e) { error = e; }
    record('cancelTask_CAS_MISMATCH', error && error.code === 'TASK_VERSION_CONFLICT' && client._remainingSteps() === 0, { code: error && error.code });
  }

  {
    // C7) NOT_FOUND
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [], rowCount: 0 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { cancelTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await cancelTask(MOCK_CONFIG, { taskId: 'missing', expectedRowVersion: 1, reason: 'x' }); } catch (e) { error = e; }
    record('cancelTask_NOT_FOUND', error && error.code === 'TASK_NOT_FOUND', { code: error && error.code });
  }

  // =========================================================================
  // changeTaskDeadline (Batch 2) — CTE gộp, jsonb_build_object cho timestamp
  // =========================================================================
  {
    // D1) success — deadline_version+1, row_version+1, event đủ old/new deadline + version
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 2, status: 'in_progress', deadline: new Date('2026-09-01T00:00:00Z'), deadline_version: 1 }], rowCount: 1 } },
      { expect: COMBINED_CTE, result: { rows: [{ id: 't1', row_version: 3, deadline: new Date('2026-09-10T00:00:00Z'), deadline_version: 2 }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { changeTaskDeadline } = loadTaskWriteWithFakePg(client);
    const out = await changeTaskDeadline(MOCK_CONFIG, {
      taskId: 't1', expectedRowVersion: 2, actorEmployeeCode: 'PHF001',
      newDeadline: new Date('2026-09-10T00:00:00Z'), reason: 'Khách hàng dời lịch.',
    });
    const combinedCall = client.calls.find((c) => COMBINED_CTE.test(c.sql));
    const sqlHasJsonbBuildObject = /jsonb_build_object/.test(combinedCall.sql);
    const sqlHasAllKeys = /'old_deadline'/.test(combinedCall.sql) && /'new_deadline'/.test(combinedCall.sql) && /'old_deadline_version'/.test(combinedCall.sql) && /'new_deadline_version'/.test(combinedCall.sql);
    const sqlHasVersionIncrement = /deadline_version = deadline_version \+ 1/.test(combinedCall.sql);
    const noSeparateInsertStep = client.calls.filter((c) => c.sql && /^INSERT/.test(c.sql)).length === 0;
    record(
      'changeTaskDeadline_SUCCESS_jsonb_and_versions',
      out.row_version === 3 && out.deadline_version === 2 && sqlHasJsonbBuildObject && sqlHasAllKeys && sqlHasVersionIncrement && noSeparateInsertStep,
      { out, sqlHasJsonbBuildObject, sqlHasAllKeys, sqlHasVersionIncrement, noSeparateInsertStep, sql: combinedCall.sql, params: combinedCall.params }
    );
  }

  {
    // D2) cancelled -> TASK_CANCELLED_IMMUTABLE
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'cancelled' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { changeTaskDeadline } = loadTaskWriteWithFakePg(client);
    let error;
    try { await changeTaskDeadline(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, newDeadline: new Date(), reason: 'x' }); } catch (e) { error = e; }
    record('changeTaskDeadline_CANCELLED_IMMUTABLE', error && error.code === 'TASK_CANCELLED_IMMUTABLE', { code: error && error.code });
  }

  {
    // D3) missing deadline -> TASK_DEADLINE_REQUIRED
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'in_progress' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { changeTaskDeadline } = loadTaskWriteWithFakePg(client);
    let error;
    try { await changeTaskDeadline(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, newDeadline: null, reason: 'x' }); } catch (e) { error = e; }
    record('changeTaskDeadline_DEADLINE_REQUIRED', error && error.code === 'TASK_DEADLINE_REQUIRED', { code: error && error.code });
  }

  {
    // D4) missing reason -> TASK_DEADLINE_REASON_REQUIRED
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'in_progress' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { changeTaskDeadline } = loadTaskWriteWithFakePg(client);
    let error;
    try { await changeTaskDeadline(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, newDeadline: new Date(), reason: '' }); } catch (e) { error = e; }
    record('changeTaskDeadline_REASON_REQUIRED', error && error.code === 'TASK_DEADLINE_REASON_REQUIRED', { code: error && error.code });
  }

  {
    // D5) CAS mismatch -> TASK_VERSION_CONFLICT
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 2, status: 'in_progress' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { changeTaskDeadline } = loadTaskWriteWithFakePg(client);
    let error;
    try { await changeTaskDeadline(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 999, newDeadline: new Date(), reason: 'x' }); } catch (e) { error = e; }
    record('changeTaskDeadline_CAS_MISMATCH', error && error.code === 'TASK_VERSION_CONFLICT' && client._remainingSteps() === 0, { code: error && error.code });
  }

  {
    // D6) NOT_FOUND
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [], rowCount: 0 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { changeTaskDeadline } = loadTaskWriteWithFakePg(client);
    let error;
    try { await changeTaskDeadline(MOCK_CONFIG, { taskId: 'missing', expectedRowVersion: 1, newDeadline: new Date(), reason: 'x' }); } catch (e) { error = e; }
    record('changeTaskDeadline_NOT_FOUND', error && error.code === 'TASK_NOT_FOUND', { code: error && error.code });
  }

  {
    // 21) expectedRowVersion numeric-string khớp thật -> SUCCESS (không false-positive)
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 4, status: 'completed', completed_at: new Date('2026-08-20T00:00:00Z') }], rowCount: 1 } },
      { expect: COMBINED_CTE, result: { rows: [{ id: 't1', row_version: 5, status: 'in_progress', completed_at: null }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { reopenTask } = loadTaskWriteWithFakePg(client);
    const out = await reopenTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: '4', reason: 'x' });
    record('reopenTask_expectedRowVersion_numericString_matches', out.row_version === 5, { out });
  }

  // =========================================================================
  // createDraftTask (Batch 3) — task_create_draft V2, PHF_TASK_CODE_IDEMPOTENCY_1.71.0
  // ---------------------------------------------------------------------------
  const REPLAY_LOOKUP = /^SELECT \* FROM task\.tasks WHERE created_by_employee_code = \$1 AND create_idempotency_key = \$2 LIMIT 1$/;
  const CATEGORY_LOCK = /^SELECT is_active FROM task\.categories WHERE category_code = \$1 FOR SHARE$/;
  const NEXT_CODE = /^SELECT task\.task_next_code\(now\(\)\) AS code$/;
  const INSERT_TASK = /^INSERT INTO task\.tasks \(/;
  const INSERT_PRIMARY_ASSIGNEE = /^INSERT INTO task\.assignees \(task_id, employee_code, role, assigned_by_employee_code\)/;
  const SELECT_PRIMARY_COUNT = /^SELECT count\(\*\)::int AS count FROM task\.assignees WHERE task_id = \$1 AND role = 'primary' AND is_active = true$/;
  // =========================================================================
  {
    // CD1) success, không primary — không replay lookup (idempotencyKey rỗng),
    // category active, task_next_code() cấp mã, KHÔNG insert assignee.
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: CATEGORY_LOCK, result: { rows: [{ is_active: true }], rowCount: 1 } },
      { expect: NEXT_CODE, result: { rows: [{ code: 'CV-2608-0001' }], rowCount: 1 } },
      { expect: INSERT_TASK, result: { rows: [{ id: 'task-1', status: 'draft', task_code: 'CV-2608-0001', row_version: 1 }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { createDraftTask } = loadTaskWriteWithFakePg(client);
    const out = await createDraftTask(MOCK_CONFIG, {
      flowType: 'giao_viec', title: 'Việc A', content: '', categoryCode: 'CAT1', priority: 'thuong',
      startAt: null, deadline: '2026-09-01T00:00:00Z', primaryEmployeeCode: null, idempotencyKey: null,
      actorEmployeeCode: 'PHF001',
    });
    const noAssigneeInsert = client.calls.filter((c) => c.sql && INSERT_PRIMARY_ASSIGNEE.test(c.sql)).length === 0;
    record('createDraftTask_SUCCESS_noPrimary', out.status === 'draft' && out.task_code === 'CV-2608-0001' && noAssigneeInsert, { out, noAssigneeInsert });
  }

  {
    // CD2) success, có primary — thêm bước INSERT task.assignees(role='primary').
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: CATEGORY_LOCK, result: { rows: [{ is_active: true }], rowCount: 1 } },
      { expect: NEXT_CODE, result: { rows: [{ code: 'CV-2608-0002' }], rowCount: 1 } },
      { expect: INSERT_TASK, result: { rows: [{ id: 'task-2', status: 'draft', task_code: 'CV-2608-0002', row_version: 1 }], rowCount: 1 } },
      { expect: INSERT_PRIMARY_ASSIGNEE, result: { rows: [], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { createDraftTask } = loadTaskWriteWithFakePg(client);
    const out = await createDraftTask(MOCK_CONFIG, {
      flowType: 'giao_viec', title: 'Việc B', content: 'Nội dung', categoryCode: 'CAT1', priority: 'thuong',
      startAt: null, deadline: '2026-09-01T00:00:00Z', primaryEmployeeCode: 'PHF002', idempotencyKey: null,
      actorEmployeeCode: 'PHF001',
    });
    const assigneeCall = client.calls.find((c) => c.sql && INSERT_PRIMARY_ASSIGNEE.test(c.sql));
    record('createDraftTask_SUCCESS_withPrimary', out.status === 'draft' && assigneeCall && assigneeCall.params[1] === 'PHF002', { out, assigneeCall });
  }

  {
    // CD3) deadline required
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { createDraftTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await createDraftTask(MOCK_CONFIG, { flowType: 'giao_viec', title: 'x', categoryCode: 'CAT1', priority: 'thuong', deadline: null, actorEmployeeCode: 'PHF001' }); } catch (e) { error = e; }
    record('createDraftTask_DEADLINE_REQUIRED', error && error.code === 'TASK_DEADLINE_REQUIRED', { code: error && error.code });
  }

  {
    // CD4) start_at > deadline -> TASK_DATE_ORDER_INVALID
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { createDraftTask } = loadTaskWriteWithFakePg(client);
    let error;
    try {
      await createDraftTask(MOCK_CONFIG, {
        flowType: 'giao_viec', title: 'x', categoryCode: 'CAT1', priority: 'thuong',
        startAt: '2026-09-10T00:00:00Z', deadline: '2026-09-01T00:00:00Z', actorEmployeeCode: 'PHF001',
      });
    } catch (e) { error = e; }
    record('createDraftTask_DATE_ORDER_INVALID', error && error.code === 'TASK_DATE_ORDER_INVALID', { code: error && error.code });
  }

  {
    // CD5) category không tồn tại -> TASK_CATEGORY_NOT_FOUND
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: CATEGORY_LOCK, result: { rows: [], rowCount: 0 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { createDraftTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await createDraftTask(MOCK_CONFIG, { flowType: 'giao_viec', title: 'x', categoryCode: 'MISSING', priority: 'thuong', deadline: '2026-09-01T00:00:00Z', actorEmployeeCode: 'PHF001' }); } catch (e) { error = e; }
    record('createDraftTask_CATEGORY_NOT_FOUND', error && error.code === 'TASK_CATEGORY_NOT_FOUND', { code: error && error.code });
  }

  {
    // CD6) category inactive -> TASK_CATEGORY_INACTIVE
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: CATEGORY_LOCK, result: { rows: [{ is_active: false }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { createDraftTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await createDraftTask(MOCK_CONFIG, { flowType: 'giao_viec', title: 'x', categoryCode: 'CAT1', priority: 'thuong', deadline: '2026-09-01T00:00:00Z', actorEmployeeCode: 'PHF001' }); } catch (e) { error = e; }
    record('createDraftTask_CATEGORY_INACTIVE', error && error.code === 'TASK_CATEGORY_INACTIVE', { code: error && error.code });
  }

  {
    // CD7) idempotency: first create — UUID hợp lệ nhưng chưa có row nào ->
    // replay lookup rowCount=0, tiến hành create bình thường.
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: REPLAY_LOOKUP, result: { rows: [], rowCount: 0 } },
      { expect: CATEGORY_LOCK, result: { rows: [{ is_active: true }], rowCount: 1 } },
      { expect: NEXT_CODE, result: { rows: [{ code: 'CV-2608-0003' }], rowCount: 1 } },
      { expect: INSERT_TASK, result: { rows: [{ id: 'task-3', status: 'draft', task_code: 'CV-2608-0003', row_version: 1 }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { createDraftTask } = loadTaskWriteWithFakePg(client);
    const out = await createDraftTask(MOCK_CONFIG, {
      flowType: 'giao_viec', title: 'x', categoryCode: 'CAT1', priority: 'thuong', deadline: '2026-09-01T00:00:00Z',
      idempotencyKey: '11111111-1111-1111-1111-111111111111', actorEmployeeCode: 'PHF001',
    });
    record('createDraftTask_IDEMPOTENCY_firstCreate', out.task_code === 'CV-2608-0003', { out });
  }

  {
    // CD8) idempotency: replay — row đã tồn tại từ (actor,key) này -> return
    // NGUYÊN task cũ, KHÔNG allocate task_code mới, KHÔNG chạm category/next_code/insert.
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: REPLAY_LOOKUP, result: { rows: [{ id: 'task-existing', status: 'draft', task_code: 'CV-2608-0000', row_version: 1 }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { createDraftTask } = loadTaskWriteWithFakePg(client);
    const out = await createDraftTask(MOCK_CONFIG, {
      flowType: 'giao_viec', title: 'x', categoryCode: 'CAT1', priority: 'thuong', deadline: '2026-09-01T00:00:00Z',
      idempotencyKey: '22222222-2222-2222-2222-222222222222', actorEmployeeCode: 'PHF001',
    });
    record('createDraftTask_IDEMPOTENCY_replay_noNewAllocation', out.id === 'task-existing' && out.task_code === 'CV-2608-0000' && client._remainingSteps() === 0, { out });
  }

  {
    // CD9) idempotency replay chạy TRƯỚC validate nghiệp vụ — deadline null
    // (lẽ ra phải throw TASK_DEADLINE_REQUIRED) nhưng replay match trước đó
    // -> return thành công, KHÔNG throw.
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: REPLAY_LOOKUP, result: { rows: [{ id: 'task-existing', status: 'draft', task_code: 'CV-2608-0000', row_version: 1 }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { createDraftTask } = loadTaskWriteWithFakePg(client);
    let error;
    let out;
    try {
      out = await createDraftTask(MOCK_CONFIG, {
        flowType: 'giao_viec', title: 'x', categoryCode: 'CAT1', priority: 'thuong', deadline: null,
        idempotencyKey: '33333333-3333-3333-3333-333333333333', actorEmployeeCode: 'PHF001',
      });
    } catch (e) { error = e; }
    record('createDraftTask_IDEMPOTENCY_replayBeforeValidation', !error && out && out.id === 'task-existing', { out, error: error && error.code });
  }

  {
    // CD10) UUID idempotencyKey sai định dạng -> normalize thành null, ÂM
    // THẦM bỏ qua (KHÔNG replay lookup, KHÔNG lỗi) — create_idempotency_key
    // param của INSERT phải là null.
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: CATEGORY_LOCK, result: { rows: [{ is_active: true }], rowCount: 1 } },
      { expect: NEXT_CODE, result: { rows: [{ code: 'CV-2608-0004' }], rowCount: 1 } },
      { expect: INSERT_TASK, result: { rows: [{ id: 'task-4', status: 'draft', task_code: 'CV-2608-0004', row_version: 1 }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { createDraftTask } = loadTaskWriteWithFakePg(client);
    await createDraftTask(MOCK_CONFIG, {
      flowType: 'giao_viec', title: 'x', categoryCode: 'CAT1', priority: 'thuong', deadline: '2026-09-01T00:00:00Z',
      idempotencyKey: 'not-a-valid-uuid', actorEmployeeCode: 'PHF001',
    });
    const insertCall = client.calls.find((c) => c.sql && INSERT_TASK.test(c.sql));
    record('createDraftTask_invalidUUID_idempotencyKey_normalizedNull', insertCall.params[9] === null, { params: insertCall.params });
  }

  {
    // CD11) race backstop — 2 request đồng thời cùng actor+key: INSERT thứ 2
    // hit unique_violation (23505), bắt lỗi rồi tự SELECT lại + return đúng
    // Task request kia vừa tạo, KHÔNG để lỗi 500 lọt ra ngoài.
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: REPLAY_LOOKUP, result: { rows: [], rowCount: 0 } },
      { expect: CATEGORY_LOCK, result: { rows: [{ is_active: true }], rowCount: 1 } },
      { expect: NEXT_CODE, result: { rows: [{ code: 'CV-2608-0005' }], rowCount: 1 } },
      { expect: INSERT_TASK, error: Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }) },
      { expect: REPLAY_LOOKUP, result: { rows: [{ id: 'task-race-winner', status: 'draft', task_code: 'CV-2608-0005', row_version: 1 }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { createDraftTask } = loadTaskWriteWithFakePg(client);
    const out = await createDraftTask(MOCK_CONFIG, {
      flowType: 'giao_viec', title: 'x', categoryCode: 'CAT1', priority: 'thuong', deadline: '2026-09-01T00:00:00Z',
      idempotencyKey: '44444444-4444-4444-4444-444444444444', actorEmployeeCode: 'PHF001',
    });
    record('createDraftTask_raceBackstop_uniqueViolationReplay', out.id === 'task-race-winner', { out });
  }

  {
    // CD12) task_code phải đến từ task.task_next_code() (DB function), không
    // tự sinh phía JS — verify param truyền vào INSERT khớp đúng giá trị
    // task_next_code() trả về.
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: CATEGORY_LOCK, result: { rows: [{ is_active: true }], rowCount: 1 } },
      { expect: NEXT_CODE, result: { rows: [{ code: 'CV-2608-0042' }], rowCount: 1 } },
      { expect: INSERT_TASK, result: { rows: [{ id: 'task-42', status: 'draft', task_code: 'CV-2608-0042', row_version: 1 }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { createDraftTask } = loadTaskWriteWithFakePg(client);
    await createDraftTask(MOCK_CONFIG, { flowType: 'giao_viec', title: 'x', categoryCode: 'CAT1', priority: 'thuong', deadline: '2026-09-01T00:00:00Z', actorEmployeeCode: 'PHF001' });
    const insertCall = client.calls.find((c) => c.sql && INSERT_TASK.test(c.sql));
    record('createDraftTask_taskCodeFromDbFunction', insertCall.params[8] === 'CV-2608-0042', { params: insertCall.params });
  }

  {
    // CD13) draft KHÔNG ghi event nào — verify KHÔNG có bước INSERT INTO task.events.
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: CATEGORY_LOCK, result: { rows: [{ is_active: true }], rowCount: 1 } },
      { expect: NEXT_CODE, result: { rows: [{ code: 'CV-2608-0006' }], rowCount: 1 } },
      { expect: INSERT_TASK, result: { rows: [{ id: 'task-6', status: 'draft', task_code: 'CV-2608-0006', row_version: 1 }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { createDraftTask } = loadTaskWriteWithFakePg(client);
    await createDraftTask(MOCK_CONFIG, { flowType: 'giao_viec', title: 'x', categoryCode: 'CAT1', priority: 'thuong', deadline: '2026-09-01T00:00:00Z', actorEmployeeCode: 'PHF001' });
    const noEventInsert = client.calls.filter((c) => c.sql && /^INSERT INTO task\.events/.test(c.sql)).length === 0;
    record('createDraftTask_draftNoEventInsert', noEventInsert, { calls: client.calls.map((c) => c.sql) });
  }

  // =========================================================================
  // publishTask (Batch 3) — task_publish, dịch nguyên văn PHF_TASK_CORE_RPC_1.67.0.sql
  // ---------------------------------------------------------------------------
  {
    // P1) success — draft -> published, row_version+1, event 'published' gộp
    // CTE (không statement INSERT rời), department snapshot set khi có
    // sourceDepartment/targetDepartment.
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'draft', flow_type: 'giao_viec', source_department: null }], rowCount: 1 } },
      { expect: SELECT_PRIMARY_COUNT, result: { rows: [{ count: 1 }], rowCount: 1 } },
      { expect: COMBINED_CTE, result: { rows: [{ id: 't1', row_version: 2, status: 'published', published_at: new Date('2026-08-24T00:00:00Z'), source_department: 'Kinh doanh', target_department: 'Kỹ thuật', is_cross_department: true }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { publishTask } = loadTaskWriteWithFakePg(client);
    const out = await publishTask(MOCK_CONFIG, {
      taskId: 't1', expectedRowVersion: 1, actorEmployeeCode: 'PHF001',
      sourceDepartment: 'Kinh doanh', targetDepartment: 'Kỹ thuật',
    });
    const combinedCall = client.calls.find((c) => COMBINED_CTE.test(c.sql));
    const sqlHasPublishedEvent = /'published'/.test(combinedCall.sql) && /jsonb_build_object\('flow_type'/.test(combinedCall.sql);
    const noSeparateInsertStep = client.calls.filter((c) => c.sql && /^INSERT/.test(c.sql)).length === 0;
    record(
      'publishTask_SUCCESS',
      out.status === 'published' && out.row_version === 2 && sqlHasPublishedEvent && noSeparateInsertStep
        && combinedCall.params[1] === 'Kinh doanh' && combinedCall.params[2] === 'Kỹ thuật' && combinedCall.params[3] === true,
      { out, sqlHasPublishedEvent, noSeparateInsertStep, params: combinedCall.params }
    );
  }

  {
    // P2) NOT_FOUND
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [], rowCount: 0 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { publishTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await publishTask(MOCK_CONFIG, { taskId: 'missing', expectedRowVersion: 1, actorEmployeeCode: 'PHF001' }); } catch (e) { error = e; }
    record('publishTask_NOT_FOUND', error && error.code === 'TASK_NOT_FOUND', { code: error && error.code });
  }

  {
    // P3) CAS mismatch
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'draft' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { publishTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await publishTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 999, actorEmployeeCode: 'PHF001' }); } catch (e) { error = e; }
    record('publishTask_CAS_MISMATCH', error && error.code === 'TASK_VERSION_CONFLICT' && client._remainingSteps() === 0, { code: error && error.code });
  }

  {
    // P4) không phải draft -> TASK_NOT_DRAFT
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'published' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { publishTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await publishTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, actorEmployeeCode: 'PHF001' }); } catch (e) { error = e; }
    record('publishTask_NOT_DRAFT', error && error.code === 'TASK_NOT_DRAFT', { code: error && error.code });
  }

  {
    // P5) 0 active primary -> TASK_PRIMARY_REQUIRED
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'draft' }], rowCount: 1 } },
      { expect: SELECT_PRIMARY_COUNT, result: { rows: [{ count: 0 }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { publishTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await publishTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, actorEmployeeCode: 'PHF001' }); } catch (e) { error = e; }
    record('publishTask_PRIMARY_REQUIRED_zero', error && error.code === 'TASK_PRIMARY_REQUIRED', { code: error && error.code });
  }

  {
    // P6) >1 active primary (data anomaly) -> vẫn TASK_PRIMARY_REQUIRED (count<>1, không riêng =0)
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'draft' }], rowCount: 1 } },
      { expect: SELECT_PRIMARY_COUNT, result: { rows: [{ count: 2 }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { publishTask } = loadTaskWriteWithFakePg(client);
    let error;
    try { await publishTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, actorEmployeeCode: 'PHF001' }); } catch (e) { error = e; }
    record('publishTask_PRIMARY_REQUIRED_multiple', error && error.code === 'TASK_PRIMARY_REQUIRED', { code: error && error.code });
  }

  {
    // P7) sourceDepartment/targetDepartment KHÔNG truyền (caller chưa resolve
    // org data) -> params null/null/null, KHÔNG đoán is_cross_department.
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'draft' }], rowCount: 1 } },
      { expect: SELECT_PRIMARY_COUNT, result: { rows: [{ count: 1 }], rowCount: 1 } },
      { expect: COMBINED_CTE, result: { rows: [{ id: 't1', row_version: 2, status: 'published', source_department: null, target_department: null, is_cross_department: null }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { publishTask } = loadTaskWriteWithFakePg(client);
    await publishTask(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, actorEmployeeCode: 'PHF001' });
    const combinedCall = client.calls.find((c) => COMBINED_CTE.test(c.sql));
    record(
      'publishTask_departmentSnapshot_skipWhenNotProvided',
      combinedCall.params[1] === null && combinedCall.params[2] === null && combinedCall.params[3] === null,
      { params: combinedCall.params }
    );
  }

  // =========================================================================
  // transferTaskPrimary (Batch 4) — task_transfer_primary, dịch nguyên văn
  // scripts/PHF_TASK_CORE_RPC_1.67.0.sql mục 7.
  // ---------------------------------------------------------------------------
  const SELECT_ACTIVE_PRIMARY_FOR_UPDATE = /^SELECT employee_code FROM task\.assignees WHERE task_id = \$1 AND role = 'primary' AND is_active = true FOR UPDATE$/;
  const DEACTIVATE_RELATED = /^UPDATE task\.assignees SET is_active = false, deactivated_at = now\(\) WHERE task_id = \$1 AND employee_code = \$2 AND role = 'related' AND is_active = true$/;
  const DEACTIVATE_PRIMARY = /^UPDATE task\.assignees SET is_active = false, deactivated_at = now\(\) WHERE task_id = \$1 AND role = 'primary' AND is_active = true$/;
  const INSERT_NEW_PRIMARY_ASSIGNEE = /^INSERT INTO task\.assignees \(task_id, employee_code, role, is_active, assigned_by_employee_code\)/;
  const UPDATE_TASK_ROWVERSION_ONLY = /^UPDATE task\.tasks SET updated_at = now\(\), row_version = row_version \+ 1 WHERE id = \$1 RETURNING \*$/;
  const INSERT_EVENT_WITH_REASON = /^INSERT INTO task\.events \(task_id, event_type, actor_employee_code, actor_account_id, payload, reason\)/;
  // =========================================================================
  {
    // TP1) success — deactivate related của target trước (wasActiveRelated=true),
    // deactivate primary cũ, insert primary mới, row_version+1, event 'transfer'
    // với from/to/was_active_related đúng.
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 2, status: 'in_progress' }], rowCount: 1 } },
      { expect: SELECT_ACTIVE_PRIMARY_FOR_UPDATE, result: { rows: [{ employee_code: 'PHF_OLD' }], rowCount: 1 } },
      { expect: DEACTIVATE_RELATED, result: { rowCount: 1 } },
      { expect: DEACTIVATE_PRIMARY, result: { rowCount: 1 } },
      { expect: INSERT_NEW_PRIMARY_ASSIGNEE, result: { rowCount: 1 } },
      { expect: UPDATE_TASK_ROWVERSION_ONLY, result: { rows: [{ id: 't1', row_version: 3 }], rowCount: 1 } },
      { expect: INSERT_EVENT_WITH_REASON, result: { rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { transferTaskPrimary } = loadTaskWriteWithFakePg(client);
    const out = await transferTaskPrimary(MOCK_CONFIG, {
      taskId: 't1', expectedRowVersion: 2, actorEmployeeCode: 'PHF001',
      newPrimaryEmployeeCode: 'PHF_NEW', reason: 'Đổi người phụ trách.',
    });
    const eventCall = client.calls.find((c) => INSERT_EVENT_WITH_REASON.test(c.sql));
    const payload = JSON.parse(eventCall.params[3]);
    record(
      'transferTaskPrimary_SUCCESS_event_and_rowversion',
      out.row_version === 3 && payload.from_employee_code === 'PHF_OLD' && payload.to_employee_code === 'PHF_NEW' &&
        payload.was_active_related === true && eventCall.params[4] === 'Đổi người phụ trách.',
      { out, payload }
    );
  }

  {
    // TP2) NOT_FOUND
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [], rowCount: 0 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { transferTaskPrimary } = loadTaskWriteWithFakePg(client);
    let error;
    try { await transferTaskPrimary(MOCK_CONFIG, { taskId: 'missing', expectedRowVersion: 1, newPrimaryEmployeeCode: 'X', reason: 'x' }); } catch (e) { error = e; }
    record('transferTaskPrimary_NOT_FOUND', error && error.code === 'TASK_NOT_FOUND', { code: error && error.code });
  }

  {
    // TP3) CAS mismatch
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 2, status: 'in_progress' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { transferTaskPrimary } = loadTaskWriteWithFakePg(client);
    let error;
    try { await transferTaskPrimary(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 999, newPrimaryEmployeeCode: 'X', reason: 'x' }); } catch (e) { error = e; }
    record('transferTaskPrimary_CAS_MISMATCH', error && error.code === 'TASK_VERSION_CONFLICT' && client._remainingSteps() === 0, { code: error && error.code });
  }

  {
    // TP4) status không active (draft) -> TASK_NOT_ACTIVE
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'draft' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { transferTaskPrimary } = loadTaskWriteWithFakePg(client);
    let error;
    try { await transferTaskPrimary(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, newPrimaryEmployeeCode: 'X', reason: 'x' }); } catch (e) { error = e; }
    record('transferTaskPrimary_NOT_ACTIVE', error && error.code === 'TASK_NOT_ACTIVE', { code: error && error.code });
  }

  {
    // TP5) reason required
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'in_progress' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { transferTaskPrimary } = loadTaskWriteWithFakePg(client);
    let error;
    try { await transferTaskPrimary(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, newPrimaryEmployeeCode: 'X', reason: '  ' }); } catch (e) { error = e; }
    record('transferTaskPrimary_REASON_REQUIRED', error && error.code === 'TASK_TRANSFER_REASON_REQUIRED', { code: error && error.code });
  }

  {
    // TP6) target required
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'in_progress' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { transferTaskPrimary } = loadTaskWriteWithFakePg(client);
    let error;
    try { await transferTaskPrimary(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, newPrimaryEmployeeCode: '  ', reason: 'x' }); } catch (e) { error = e; }
    record('transferTaskPrimary_TARGET_REQUIRED', error && error.code === 'TASK_TRANSFER_TARGET_REQUIRED', { code: error && error.code });
  }

  {
    // TP7) không có active primary hiện tại -> TASK_PRIMARY_NOT_FOUND
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'in_progress' }], rowCount: 1 } },
      { expect: SELECT_ACTIVE_PRIMARY_FOR_UPDATE, result: { rows: [], rowCount: 0 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { transferTaskPrimary } = loadTaskWriteWithFakePg(client);
    let error;
    try { await transferTaskPrimary(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, newPrimaryEmployeeCode: 'X', reason: 'x' }); } catch (e) { error = e; }
    record('transferTaskPrimary_PRIMARY_NOT_FOUND', error && error.code === 'TASK_PRIMARY_NOT_FOUND', { code: error && error.code });
  }

  {
    // TP8) newPrimary === oldPrimary -> TASK_TRANSFER_SAME_EMPLOYEE
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_FOR_UPDATE, result: { rows: [{ id: 't1', row_version: 1, status: 'in_progress' }], rowCount: 1 } },
      { expect: SELECT_ACTIVE_PRIMARY_FOR_UPDATE, result: { rows: [{ employee_code: 'PHF_SAME' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { transferTaskPrimary } = loadTaskWriteWithFakePg(client);
    let error;
    try { await transferTaskPrimary(MOCK_CONFIG, { taskId: 't1', expectedRowVersion: 1, newPrimaryEmployeeCode: 'PHF_SAME', reason: 'x' }); } catch (e) { error = e; }
    record('transferTaskPrimary_SAME_EMPLOYEE', error && error.code === 'TASK_TRANSFER_SAME_EMPLOYEE', { code: error && error.code });
  }

  // =========================================================================
  // addTaskRelated (Batch 4) — task_add_related, dịch nguyên văn
  // scripts/PHF_TASK_CORE_RPC_1.67.0.sql mục 8.
  // ---------------------------------------------------------------------------
  const ADVISORY_LOCK = /^SELECT pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)$/;
  const RELATED_PRIMARY_CHECK = /^SELECT 1 FROM task\.assignees WHERE task_id = \$1 AND employee_code = \$2 AND role = 'primary' AND is_active = true$/;
  const RELATED_EXISTING_SELECT = /^SELECT \* FROM task\.assignees WHERE task_id = \$1 AND employee_code = \$2 AND role = 'related' AND is_active = true/;
  const EVENT_ID_LOOKUP = /^SELECT e\.id FROM task\.events e/;
  const INSERT_EVENTS_GENERIC = /^INSERT INTO task\.events/;
  const INSERT_ASSIGNEES_RELATED = /^INSERT INTO task\.assignees \(task_id, employee_code, role, assigned_by_employee_code\)/;
  // =========================================================================
  {
    // AR1) success — fresh insert (không có related active nào trước đó)
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: ADVISORY_LOCK, result: {} },
      { expect: RELATED_PRIMARY_CHECK, result: { rows: [], rowCount: 0 } },
      { expect: RELATED_EXISTING_SELECT, result: { rows: [], rowCount: 0 } },
      { expect: INSERT_ASSIGNEES_RELATED, result: { rows: [{ id: 'assignee-1', task_id: 't1', employee_code: 'PHF002', role: 'related' }], rowCount: 1 } },
      { expect: INSERT_EVENTS_GENERIC, result: { rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { addTaskRelated } = loadTaskWriteWithFakePg(client);
    const out = await addTaskRelated(MOCK_CONFIG, { taskId: 't1', targetEmployeeCode: 'phf002', actorEmployeeCode: 'PHF001' });
    const eventCall = client.calls.find((c) => INSERT_EVENTS_GENERIC.test(c.sql));
    const payload = JSON.parse(eventCall.params[3]);
    record(
      'addTaskRelated_SUCCESS_freshInsert_uppercased',
      out.employee_code === 'PHF002' && payload.action === 'add' && payload.role === 'related' && payload.employee_code === 'PHF002' && !payload.recovered_missing_audit,
      { out, payload }
    );
  }

  {
    // AR2) idempotent — related active đã tồn tại + event đã có -> return
    // nguyên assignee, KHÔNG insert gì thêm.
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: ADVISORY_LOCK, result: {} },
      { expect: RELATED_PRIMARY_CHECK, result: { rows: [], rowCount: 0 } },
      { expect: RELATED_EXISTING_SELECT, result: { rows: [{ id: 'assignee-2', task_id: 't1', employee_code: 'PHF002', assigned_at: new Date('2026-08-20T00:00:00Z') }], rowCount: 1 } },
      { expect: EVENT_ID_LOOKUP, result: { rows: [{ id: 'evt-1' }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { addTaskRelated } = loadTaskWriteWithFakePg(client);
    const out = await addTaskRelated(MOCK_CONFIG, { taskId: 't1', targetEmployeeCode: 'PHF002', actorEmployeeCode: 'PHF001' });
    record('addTaskRelated_IDEMPOTENT_existingEvent_noNewInsert', out.id === 'assignee-2' && client._remainingSteps() === 0, { out });
  }

  {
    // AR3) recovery — related active tồn tại nhưng THIẾU event -> insert event
    // recovery với recovered_missing_audit=true, KHÔNG insert assignee mới.
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: ADVISORY_LOCK, result: {} },
      { expect: RELATED_PRIMARY_CHECK, result: { rows: [], rowCount: 0 } },
      { expect: RELATED_EXISTING_SELECT, result: { rows: [{ id: 'assignee-3', task_id: 't1', employee_code: 'PHF002', assigned_at: new Date('2026-08-20T00:00:00Z') }], rowCount: 1 } },
      { expect: EVENT_ID_LOOKUP, result: { rows: [], rowCount: 0 } },
      { expect: INSERT_EVENTS_GENERIC, result: { rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { addTaskRelated } = loadTaskWriteWithFakePg(client);
    const out = await addTaskRelated(MOCK_CONFIG, { taskId: 't1', targetEmployeeCode: 'PHF002', actorEmployeeCode: 'PHF001' });
    const eventCall = client.calls.find((c) => INSERT_EVENTS_GENERIC.test(c.sql));
    const payload = JSON.parse(eventCall.params[3]);
    const noAssigneeInsert = client.calls.filter((c) => INSERT_ASSIGNEES_RELATED.test(c.sql)).length === 0;
    record(
      'addTaskRelated_RECOVERY_missingEvent_insertedWithFlag',
      out.id === 'assignee-3' && payload.recovered_missing_audit === true && payload.assignee_id === 'assignee-3' && noAssigneeInsert,
      { out, payload, noAssigneeInsert }
    );
  }

  {
    // AR4) target required (rỗng/whitespace)
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { addTaskRelated } = loadTaskWriteWithFakePg(client);
    let error;
    try { await addTaskRelated(MOCK_CONFIG, { taskId: 't1', targetEmployeeCode: '   ', actorEmployeeCode: 'PHF001' }); } catch (e) { error = e; }
    record('addTaskRelated_TARGET_REQUIRED', error && error.code === 'TASK_RELATED_TARGET_REQUIRED', { code: error && error.code });
  }

  {
    // AR5) target đang là primary active -> TASK_RELATED_IS_PRIMARY
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: ADVISORY_LOCK, result: {} },
      { expect: RELATED_PRIMARY_CHECK, result: { rows: [{ '?column?': 1 }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { addTaskRelated } = loadTaskWriteWithFakePg(client);
    let error;
    try { await addTaskRelated(MOCK_CONFIG, { taskId: 't1', targetEmployeeCode: 'PHF002', actorEmployeeCode: 'PHF001' }); } catch (e) { error = e; }
    record('addTaskRelated_IS_PRIMARY', error && error.code === 'TASK_RELATED_IS_PRIMARY', { code: error && error.code });
  }

  // =========================================================================
  // removeTaskRelated (Batch 4) — dịch nguyên văn removeTaskRelated() trong
  // api/_lib/task-core.js. KHÔNG có CAS (nguồn không có tham số này).
  // ---------------------------------------------------------------------------
  const REMOVE_RELATED_UPDATE = /^UPDATE task\.assignees SET is_active = false, deactivated_at = now\(\) WHERE task_id = \$1 AND employee_code = \$2 AND role = 'related' AND is_active = true RETURNING \*$/;
  // =========================================================================
  {
    // RR1) success
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: REMOVE_RELATED_UPDATE, result: { rows: [{ id: 'assignee-4', task_id: 't1', employee_code: 'PHF002', is_active: false }], rowCount: 1 } },
      { expect: INSERT_EVENTS_GENERIC, result: { rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { removeTaskRelated } = loadTaskWriteWithFakePg(client);
    const out = await removeTaskRelated(MOCK_CONFIG, { taskId: 't1', targetEmployeeCode: 'phf002', actorEmployeeCode: 'PHF001' });
    const eventCall = client.calls.find((c) => INSERT_EVENTS_GENERIC.test(c.sql));
    const payload = JSON.parse(eventCall.params[3]);
    record('removeTaskRelated_SUCCESS', out.id === 'assignee-4' && payload.action === 'remove' && payload.role === 'related' && payload.employee_code === 'PHF002', { out, payload });
  }

  {
    // RR2) không tìm thấy related active -> TASK_RELATED_NOT_FOUND
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: REMOVE_RELATED_UPDATE, result: { rows: [], rowCount: 0 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { removeTaskRelated } = loadTaskWriteWithFakePg(client);
    let error;
    try { await removeTaskRelated(MOCK_CONFIG, { taskId: 't1', targetEmployeeCode: 'PHF999', actorEmployeeCode: 'PHF001' }); } catch (e) { error = e; }
    record('removeTaskRelated_NOT_FOUND', error && error.code === 'TASK_RELATED_NOT_FOUND', { code: error && error.code });
  }

  // =========================================================================
  // addTaskComment (Batch 5) — dịch nguyên văn addTaskComment() trong
  // api/_lib/task-core.js. KHÔNG có CAS/NOT_FOUND (nguồn không có).
  // ---------------------------------------------------------------------------
  const INSERT_COMMENTS = /^INSERT INTO task\.comments/;
  // =========================================================================
  {
    // AC1) success
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: INSERT_COMMENTS, result: { rows: [{ id: 'comment-1', task_id: 't1', body: 'Nội dung comment.' }], rowCount: 1 } },
      { expect: INSERT_EVENTS_GENERIC, result: { rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { addTaskComment } = loadTaskWriteWithFakePg(client);
    const out = await addTaskComment(MOCK_CONFIG, { taskId: 't1', body: '  Nội dung comment.  ', actorEmployeeCode: 'PHF001' });
    const eventCall = client.calls.find((c) => INSERT_EVENTS_GENERIC.test(c.sql));
    const payload = JSON.parse(eventCall.params[3]);
    record('addTaskComment_SUCCESS', out.id === 'comment-1' && payload.comment_id === 'comment-1', { out, payload });
  }

  {
    // AC2) body required
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { addTaskComment } = loadTaskWriteWithFakePg(client);
    let error;
    try { await addTaskComment(MOCK_CONFIG, { taskId: 't1', body: '   ', actorEmployeeCode: 'PHF001' }); } catch (e) { error = e; }
    record('addTaskComment_BODY_REQUIRED', error && error.code === 'TASK_COMMENT_BODY_REQUIRED', { code: error && error.code });
  }

  // =========================================================================
  // addTaskLink (Batch 5) — task_add_link, dịch nguyên văn
  // scripts/PHF_TASK_CORE_RPC_1.67.0.sql mục 9.
  // ---------------------------------------------------------------------------
  const LINK_SELECT_EXISTING = /^SELECT l\.\* FROM task\.links l/;
  const LINK_RELINK_UPDATE = /^UPDATE task\.links SET related_event_id = \$2 WHERE id = \$1 RETURNING \*$/;
  const INSERT_LINKS = /^INSERT INTO task\.links/;
  // =========================================================================
  {
    // AL1) success — fresh insert (không có link active nào khớp)
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: ADVISORY_LOCK, result: {} },
      { expect: LINK_SELECT_EXISTING, result: { rows: [], rowCount: 0 } },
      { expect: INSERT_LINKS, result: { rows: [{ id: 'link-1', task_id: 't1', side: 'input_reference', url: 'https://x.test', related_event_id: null }], rowCount: 1 } },
      { expect: INSERT_EVENTS_GENERIC, result: { rows: [{ id: 'evt-link-1' }], rowCount: 1 } },
      { expect: LINK_RELINK_UPDATE, result: { rows: [{ id: 'link-1', task_id: 't1', side: 'input_reference', url: 'https://x.test', related_event_id: 'evt-link-1' }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { addTaskLink } = loadTaskWriteWithFakePg(client);
    const out = await addTaskLink(MOCK_CONFIG, { taskId: 't1', side: 'input_reference', url: 'https://x.test', label: null, actorEmployeeCode: 'PHF001' });
    record('addTaskLink_SUCCESS_freshInsert_relinked', out.related_event_id === 'evt-link-1', { out });
  }

  {
    // AL2) idempotent full — existing active link đã có related_event_id sẵn
    // -> return nguyên, KHÔNG query/insert gì thêm.
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: ADVISORY_LOCK, result: {} },
      { expect: LINK_SELECT_EXISTING, result: { rows: [{ id: 'link-2', task_id: 't1', side: 'input_reference', url: 'https://x.test', related_event_id: 'evt-old' }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { addTaskLink } = loadTaskWriteWithFakePg(client);
    const out = await addTaskLink(MOCK_CONFIG, { taskId: 't1', side: 'input_reference', url: 'https://x.test', label: null, actorEmployeeCode: 'PHF001' });
    record('addTaskLink_IDEMPOTENT_alreadyLinked_noExtraQuery', out.id === 'link-2' && client._remainingSteps() === 0, { out });
  }

  {
    // AL3) recovery — existing link, related_event_id null, event lookup TÌM
    // THẤY event 'add' đã có -> chỉ relink, KHÔNG insert event mới.
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: ADVISORY_LOCK, result: {} },
      { expect: LINK_SELECT_EXISTING, result: { rows: [{ id: 'link-3', task_id: 't1', side: 'input_reference', url: 'https://x.test', related_event_id: null }], rowCount: 1 } },
      { expect: EVENT_ID_LOOKUP, result: { rows: [{ id: 'evt-found' }], rowCount: 1 } },
      { expect: LINK_RELINK_UPDATE, result: { rows: [{ id: 'link-3', related_event_id: 'evt-found' }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { addTaskLink } = loadTaskWriteWithFakePg(client);
    const out = await addTaskLink(MOCK_CONFIG, { taskId: 't1', side: 'input_reference', url: 'https://x.test', label: null, actorEmployeeCode: 'PHF001' });
    const noNewEventInsert = client.calls.filter((c) => INSERT_EVENTS_GENERIC.test(c.sql)).length === 0;
    record('addTaskLink_RECOVERY_foundExistingEvent_relinkOnly', out.related_event_id === 'evt-found' && noNewEventInsert, { out, noNewEventInsert });
  }

  {
    // AL4) full recovery — existing link, related_event_id null, event lookup
    // KHÔNG tìm thấy gì -> insert recovery event (recovered_missing_audit) rồi relink.
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: ADVISORY_LOCK, result: {} },
      { expect: LINK_SELECT_EXISTING, result: { rows: [{ id: 'link-4', task_id: 't1', side: 'input_reference', url: 'https://x.test', related_event_id: null }], rowCount: 1 } },
      { expect: EVENT_ID_LOOKUP, result: { rows: [], rowCount: 0 } },
      { expect: INSERT_EVENTS_GENERIC, result: { rows: [{ id: 'evt-recovered' }], rowCount: 1 } },
      { expect: LINK_RELINK_UPDATE, result: { rows: [{ id: 'link-4', related_event_id: 'evt-recovered' }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { addTaskLink } = loadTaskWriteWithFakePg(client);
    const out = await addTaskLink(MOCK_CONFIG, { taskId: 't1', side: 'input_reference', url: 'https://x.test', label: null, actorEmployeeCode: 'PHF001' });
    const eventCall = client.calls.find((c) => INSERT_EVENTS_GENERIC.test(c.sql));
    const payload = JSON.parse(eventCall.params[3]);
    record('addTaskLink_FULL_RECOVERY_insertedAndRelinked', out.related_event_id === 'evt-recovered' && payload.recovered_missing_audit === true, { out, payload });
  }

  // =========================================================================
  // removeTaskLink (Batch 5) — dịch nguyên văn removeTaskLink() trong
  // api/_lib/task-core.js. KHÔNG update/hard-delete task.links, chỉ ghi event.
  // ---------------------------------------------------------------------------
  const LINK_REMOVE_SELECT = /^SELECT \* FROM task\.links WHERE id = \$1 AND task_id = \$2$/;
  // =========================================================================
  {
    // RL1) success
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: LINK_REMOVE_SELECT, result: { rows: [{ id: 'link-5', task_id: 't1', side: 'input_reference', url: 'https://x.test' }], rowCount: 1 } },
      { expect: INSERT_EVENTS_GENERIC, result: { rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { removeTaskLink } = loadTaskWriteWithFakePg(client);
    const out = await removeTaskLink(MOCK_CONFIG, { taskId: 't1', linkId: 'link-5', actorEmployeeCode: 'PHF001' });
    const eventCall = client.calls.find((c) => INSERT_EVENTS_GENERIC.test(c.sql));
    const payload = JSON.parse(eventCall.params[3]);
    record('removeTaskLink_SUCCESS_noRowMutation_eventOnly', out.removed === true && out.link_id === 'link-5' && payload.action === 'remove' && payload.link_id === 'link-5', { out, payload });
  }

  {
    // RL2) không tìm thấy link -> TASK_LINK_NOT_FOUND
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: LINK_REMOVE_SELECT, result: { rows: [], rowCount: 0 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { removeTaskLink } = loadTaskWriteWithFakePg(client);
    let error;
    try { await removeTaskLink(MOCK_CONFIG, { taskId: 't1', linkId: 'missing-link', actorEmployeeCode: 'PHF001' }); } catch (e) { error = e; }
    record('removeTaskLink_NOT_FOUND', error && error.code === 'TASK_LINK_NOT_FOUND', { code: error && error.code });
  }

  // =========================================================================
  // setTaskPermissionAssignment (Batch 6) — task_set_permission_assignment,
  // dịch nguyên văn scripts/PHF_TASK_PERMISSION_V1_TARGETED_1.69.0.sql PHẦN 3.
  // KHÔNG có CAS (nguồn không có tham số này). Validate xảy ra TRƯỚC transaction
  // (đồng bộ) — test verify 0 DB call khi validate fail.
  // ---------------------------------------------------------------------------
  const PERMISSION_SELECT_NOW = /^SELECT now\(\) AS now$/;
  const PERMISSION_UPDATE_DEACTIVATE = /^UPDATE task\.permission_assignments/;
  const PERMISSION_INSERT_HISTORY = /^INSERT INTO task\.permission_assignment_history/;
  const PERMISSION_INSERT_NEW = /^INSERT INTO task\.permission_assignments \(/;
  // =========================================================================
  {
    // SP1) success — KHÔNG có assignment active cũ nào khớp (loop 0 lần) ->
    // chỉ 1 history insert ('assign').
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: PERMISSION_SELECT_NOW, result: { rows: [{ now: new Date('2026-08-24T00:00:00Z') }], rowCount: 1 } },
      { expect: ADVISORY_LOCK, result: {} },
      { expect: PERMISSION_UPDATE_DEACTIVATE, result: { rows: [], rowCount: 0 } },
      { expect: PERMISSION_INSERT_NEW, result: { rows: [{ id: 'assign-1', employee_code: 'PHF002', preset_code: 'TRUONG_CA', is_active: true }], rowCount: 1 } },
      { expect: PERMISSION_INSERT_HISTORY, result: { rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { setTaskPermissionAssignment } = loadTaskWriteWithFakePg(client);
    const out = await setTaskPermissionAssignment(MOCK_CONFIG, {
      targetEmployeeCode: 'phf002', presetCode: 'truong_ca', reason: 'Bổ nhiệm trưởng ca.',
      actorEmployeeCode: 'PHF_ADMIN',
    });
    const historyCalls = client.calls.filter((c) => c.sql && PERMISSION_INSERT_HISTORY.test(c.sql));
    record(
      'setTaskPermissionAssignment_SUCCESS_noPrevious_singleAssignHistory',
      out.id === 'assign-1' && historyCalls.length === 1 && /'assign'/.test(historyCalls[0].sql),
      { out, historySql: historyCalls[0].sql }
    );
  }

  {
    // SP2) success — CÓ 1 assignment active cũ khớp -> loop deactivate 1 lần
    // (history 'deactivate') + history 'assign' mới = 2 history insert.
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: PERMISSION_SELECT_NOW, result: { rows: [{ now: new Date('2026-08-24T00:00:00Z') }], rowCount: 1 } },
      { expect: ADVISORY_LOCK, result: {} },
      { expect: PERMISSION_UPDATE_DEACTIVATE, result: { rows: [{ id: 'assign-old', employee_code: 'PHF002', preset_code: 'NHAN_VIEN', is_active: false }], rowCount: 1 } },
      { expect: PERMISSION_INSERT_HISTORY, result: { rowCount: 1 } },
      { expect: PERMISSION_INSERT_NEW, result: { rows: [{ id: 'assign-2', employee_code: 'PHF002', preset_code: 'TRUONG_BO_PHAN', is_active: true }], rowCount: 1 } },
      { expect: PERMISSION_INSERT_HISTORY, result: { rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { setTaskPermissionAssignment } = loadTaskWriteWithFakePg(client);
    const out = await setTaskPermissionAssignment(MOCK_CONFIG, {
      targetEmployeeCode: 'PHF002', presetCode: 'TRUONG_BO_PHAN', reason: 'Thăng chức.',
      actorEmployeeCode: 'PHF_ADMIN',
    });
    const historyCalls = client.calls.filter((c) => c.sql && PERMISSION_INSERT_HISTORY.test(c.sql));
    record(
      'setTaskPermissionAssignment_SUCCESS_withPrevious_deactivateThenAssignHistory',
      out.id === 'assign-2' && historyCalls.length === 2 && /'deactivate'/.test(historyCalls[0].sql) && /'assign'/.test(historyCalls[1].sql),
      { out, sqls: historyCalls.map((c) => c.sql) }
    );
  }

  {
    // SP3) target required — cả account lẫn employee đều rỗng -> throw TRƯỚC
    // transaction, 0 DB call.
    const client = makeFakeClient([]);
    const { setTaskPermissionAssignment } = loadTaskWriteWithFakePg(client);
    let error;
    try { await setTaskPermissionAssignment(MOCK_CONFIG, { presetCode: 'NHAN_VIEN', reason: 'x', actorEmployeeCode: 'PHF_ADMIN' }); } catch (e) { error = e; }
    record('setTaskPermissionAssignment_TARGET_REQUIRED_noDbCall', error && error.code === 'TASK_PERMISSION_ASSIGNMENT_TARGET_REQUIRED' && client.calls.length === 0, { code: error && error.code, calls: client.calls.length });
  }

  {
    // SP4) preset invalid
    const client = makeFakeClient([]);
    const { setTaskPermissionAssignment } = loadTaskWriteWithFakePg(client);
    let error;
    try { await setTaskPermissionAssignment(MOCK_CONFIG, { targetEmployeeCode: 'PHF002', presetCode: 'KHONG_HOP_LE', reason: 'x', actorEmployeeCode: 'PHF_ADMIN' }); } catch (e) { error = e; }
    record('setTaskPermissionAssignment_PRESET_INVALID_noDbCall', error && error.code === 'TASK_PERMISSION_PRESET_INVALID' && client.calls.length === 0, { code: error && error.code, calls: client.calls.length });
  }

  {
    // SP5) reason required
    const client = makeFakeClient([]);
    const { setTaskPermissionAssignment } = loadTaskWriteWithFakePg(client);
    let error;
    try { await setTaskPermissionAssignment(MOCK_CONFIG, { targetEmployeeCode: 'PHF002', presetCode: 'NHAN_VIEN', reason: '  ', actorEmployeeCode: 'PHF_ADMIN' }); } catch (e) { error = e; }
    record('setTaskPermissionAssignment_REASON_REQUIRED_noDbCall', error && error.code === 'TASK_PERMISSION_REASON_REQUIRED' && client.calls.length === 0, { code: error && error.code, calls: client.calls.length });
  }

  {
    // SP6) actor required — cả account lẫn employee actor đều rỗng
    const client = makeFakeClient([]);
    const { setTaskPermissionAssignment } = loadTaskWriteWithFakePg(client);
    let error;
    try { await setTaskPermissionAssignment(MOCK_CONFIG, { targetEmployeeCode: 'PHF002', presetCode: 'NHAN_VIEN', reason: 'x' }); } catch (e) { error = e; }
    record('setTaskPermissionAssignment_ACTOR_REQUIRED_noDbCall', error && error.code === 'TASK_PERMISSION_ACTOR_REQUIRED' && client.calls.length === 0, { code: error && error.code, calls: client.calls.length });
  }

  // =========================================================================
  // Gate 5.4 — findTaskAttachmentByObjectKey (READ-ONLY, idempotency replay lookup)
  // =========================================================================
  const SELECT_ATTACHMENT_BY_OBJECT_KEY = /^SELECT \* FROM task\.attachments WHERE stored_object_key = \$1 LIMIT 1$/;
  const INSERT_ATTACHMENTS = /^INSERT INTO task\.attachments \(/;
  const SELECT_ATTACHMENT_FOR_UPDATE = /^SELECT id, status FROM task\.attachments WHERE id = \$1 AND task_id = \$2 FOR UPDATE$/;
  const UPDATE_ATTACHMENTS = /^UPDATE task\.attachments/;
  const SELECT_ATTACHMENT_FOR_DOWNLOAD = /^SELECT \* FROM task\.attachments WHERE id = \$1 AND task_id = \$2 AND status = 'active' LIMIT 1$/;
  // =========================================================================
  {
    // FA1) found
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_ATTACHMENT_BY_OBJECT_KEY, result: { rows: [{ id: 'att-1', stored_object_key: 'tasks/t1/PHF001/key1' }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { findTaskAttachmentByObjectKey } = loadTaskWriteWithFakePg(client);
    const out = await findTaskAttachmentByObjectKey(MOCK_CONFIG, { storedObjectKey: 'tasks/t1/PHF001/key1' });
    record('findTaskAttachmentByObjectKey_found', out && out.id === 'att-1', { out });
  }

  {
    // FA2) not found -> null (KHÔNG throw)
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_ATTACHMENT_BY_OBJECT_KEY, result: { rows: [], rowCount: 0 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { findTaskAttachmentByObjectKey } = loadTaskWriteWithFakePg(client);
    const out = await findTaskAttachmentByObjectKey(MOCK_CONFIG, { storedObjectKey: 'tasks/t1/PHF001/key-missing' });
    record('findTaskAttachmentByObjectKey_notFound_returnsNull', out === null, { out });
  }

  {
    // FA3) storedObjectKey required
    const client = makeFakeClient([]);
    const { findTaskAttachmentByObjectKey } = loadTaskWriteWithFakePg(client);
    let error;
    try { await findTaskAttachmentByObjectKey(MOCK_CONFIG, { storedObjectKey: '  ' }); } catch (e) { error = e; }
    record('findTaskAttachmentByObjectKey_OBJECT_KEY_REQUIRED_noDbCall', error && error.code === 'TASK_ATTACHMENT_OBJECT_KEY_REQUIRED' && client.calls.length === 0, { code: error && error.code });
  }

  // =========================================================================
  // Gate 5.4 — createTaskAttachmentMetadata
  // =========================================================================
  const VALID_ATTACHMENT_INPUT = {
    taskId: 't1',
    originalFilename: 'minh-chung.jpg',
    storedObjectKey: 'tasks/t1/PHF001/22222222-2222-4222-8222-222222222222',
    mimeType: 'image/jpeg',
    extension: 'jpg',
    sizeBytes: 2048,
    checksumSha256: 'a'.repeat(64),
    uploadedByEmployeeCode: 'PHF001',
  };
  {
    // CA1) success — INSERT attachments + INSERT event 'attachment' action='add', cùng transaction
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: INSERT_ATTACHMENTS, result: { rows: [{ id: 'att-2', task_id: 't1', status: 'active', size_bytes: 2048 }], rowCount: 1 } },
      { expect: INSERT_EVENTS_GENERIC, result: { rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { createTaskAttachmentMetadata } = loadTaskWriteWithFakePg(client);
    const out = await createTaskAttachmentMetadata(MOCK_CONFIG, VALID_ATTACHMENT_INPUT);
    const eventCall = client.calls.find((c) => INSERT_EVENTS_GENERIC.test(c.sql));
    const payload = JSON.parse(eventCall.params[3]);
    record(
      'createTaskAttachmentMetadata_SUCCESS_insert_and_event_sameTransaction',
      out.id === 'att-2' && payload.action === 'add' && payload.attachment_id === 'att-2' && payload.original_filename === 'minh-chung.jpg' && payload.size_bytes === 2048,
      { out, payload }
    );
  }

  {
    // CA2) event insert fail -> toàn bộ rollback (attachment insert KHÔNG được commit)
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: INSERT_ATTACHMENTS, result: { rows: [{ id: 'att-3', task_id: 't1' }], rowCount: 1 } },
      { expect: INSERT_EVENTS_GENERIC, error: Object.assign(new Error('event insert failed'), { code: 'XX000' }) },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { createTaskAttachmentMetadata } = loadTaskWriteWithFakePg(client);
    let error;
    try { await createTaskAttachmentMetadata(MOCK_CONFIG, VALID_ATTACHMENT_INPUT); } catch (e) { error = e; }
    record('createTaskAttachmentMetadata_eventFail_rollsBackAttachmentInsert', error && error.message === 'event insert failed' && client._remainingSteps() === 0, { message: error && error.message });
  }

  {
    // CA3) invalid filename
    const client = makeFakeClient([]);
    const { createTaskAttachmentMetadata } = loadTaskWriteWithFakePg(client);
    let error;
    try { await createTaskAttachmentMetadata(MOCK_CONFIG, { ...VALID_ATTACHMENT_INPUT, originalFilename: '   ' }); } catch (e) { error = e; }
    record('createTaskAttachmentMetadata_FILENAME_REQUIRED_noDbCall', error && error.code === 'TASK_ATTACHMENT_FILENAME_REQUIRED' && client.calls.length === 0, { code: error && error.code });
  }

  {
    // CA4) invalid actor
    const client = makeFakeClient([]);
    const { createTaskAttachmentMetadata } = loadTaskWriteWithFakePg(client);
    let error;
    try { await createTaskAttachmentMetadata(MOCK_CONFIG, { ...VALID_ATTACHMENT_INPUT, uploadedByEmployeeCode: '' }); } catch (e) { error = e; }
    record('createTaskAttachmentMetadata_ACTOR_REQUIRED_noDbCall', error && error.code === 'TASK_ATTACHMENT_ACTOR_REQUIRED' && client.calls.length === 0, { code: error && error.code });
  }

  {
    // CA5) invalid MIME (backstop, dùng policy.isAllowedMime())
    const client = makeFakeClient([]);
    const { createTaskAttachmentMetadata } = loadTaskWriteWithFakePg(client);
    let error;
    try { await createTaskAttachmentMetadata(MOCK_CONFIG, { ...VALID_ATTACHMENT_INPUT, mimeType: 'application/zip' }); } catch (e) { error = e; }
    record('createTaskAttachmentMetadata_MIME_INVALID_noDbCall', error && error.code === 'TASK_ATTACHMENT_MIME_INVALID' && client.calls.length === 0, { code: error && error.code });
  }

  {
    // CA6) invalid size — 0 (schema CHECK size_bytes > 0, KHÔNG PHẢI >=0)
    const client = makeFakeClient([]);
    const { createTaskAttachmentMetadata } = loadTaskWriteWithFakePg(client);
    let error;
    try { await createTaskAttachmentMetadata(MOCK_CONFIG, { ...VALID_ATTACHMENT_INPUT, sizeBytes: 0 }); } catch (e) { error = e; }
    record('createTaskAttachmentMetadata_SIZE_INVALID_zero_noDbCall', error && error.code === 'TASK_ATTACHMENT_SIZE_INVALID' && client.calls.length === 0, { code: error && error.code });
  }

  {
    // CA6b) invalid size — vượt MAX_FILE_SIZE (policy)
    const client = makeFakeClient([]);
    const { createTaskAttachmentMetadata } = loadTaskWriteWithFakePg(client);
    let error;
    try { await createTaskAttachmentMetadata(MOCK_CONFIG, { ...VALID_ATTACHMENT_INPUT, sizeBytes: 999999999 }); } catch (e) { error = e; }
    record('createTaskAttachmentMetadata_TOO_LARGE_noDbCall', error && error.code === 'TASK_ATTACHMENT_TOO_LARGE' && client.calls.length === 0, { code: error && error.code });
  }

  {
    // CA7) invalid checksum
    const client = makeFakeClient([]);
    const { createTaskAttachmentMetadata } = loadTaskWriteWithFakePg(client);
    let error;
    try { await createTaskAttachmentMetadata(MOCK_CONFIG, { ...VALID_ATTACHMENT_INPUT, checksumSha256: 'not-a-sha256' }); } catch (e) { error = e; }
    record('createTaskAttachmentMetadata_CHECKSUM_INVALID_noDbCall', error && error.code === 'TASK_ATTACHMENT_CHECKSUM_INVALID' && client.calls.length === 0, { code: error && error.code });
  }

  {
    // CA8) unique stored_object_key conflict -> KHÔNG tự coi success, tự lookup
    // winner qua findTaskAttachmentByObjectKey() bằng transaction MỚI. Fake
    // Pool.connect() (makeFakePgModule) luôn trả CÙNG 1 client object cho mọi
    // pool.connect() trong lần require này — nên script dưới đây gộp ĐỦ tuần
    // tự bước cho CẢ 2 lệnh gọi withTaskWriteTransaction liên tiếp (INSERT
    // fail -> rollback, RỒI lookup winner -> commit) trên cùng 1 fake client.
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: INSERT_ATTACHMENTS, error: Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }) },
      { expect: /^ROLLBACK$/, result: {} },
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_ATTACHMENT_BY_OBJECT_KEY, result: { rows: [{ id: 'att-winner', stored_object_key: VALID_ATTACHMENT_INPUT.storedObjectKey }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { createTaskAttachmentMetadata } = loadTaskWriteWithFakePg(client);
    const out = await createTaskAttachmentMetadata(MOCK_CONFIG, VALID_ATTACHMENT_INPUT);
    record('createTaskAttachmentMetadata_uniqueConflict_selfHeals_returnsWinner', out && out.id === 'att-winner' && client._remainingSteps() === 0, { out });
  }

  // =========================================================================
  // Gate 5.4 — removeTaskAttachment
  // =========================================================================
  {
    // RA1) success — status pending_delete, deleted actor set, event remove written
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_ATTACHMENT_FOR_UPDATE, result: { rows: [{ id: 'att-4', status: 'active' }], rowCount: 1 } },
      { expect: UPDATE_ATTACHMENTS, result: { rows: [{ id: 'att-4', status: 'pending_delete', deleted_by_employee_code: 'PHF001' }], rowCount: 1 } },
      { expect: INSERT_EVENTS_GENERIC, result: { rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { removeTaskAttachment } = loadTaskWriteWithFakePg(client);
    const out = await removeTaskAttachment(MOCK_CONFIG, { taskId: 't1', attachmentId: 'att-4', reason: 'Nhầm file.', actorEmployeeCode: 'PHF001' });
    const eventCall = client.calls.find((c) => INSERT_EVENTS_GENERIC.test(c.sql));
    const payload = JSON.parse(eventCall.params[3]);
    record(
      'removeTaskAttachment_SUCCESS_pendingDelete_deletedActor_eventReason',
      out.status === 'pending_delete' && out.deleted_by_employee_code === 'PHF001' && payload.action === 'remove' && payload.attachment_id === 'att-4' && payload.reason === 'Nhầm file.',
      { out, payload }
    );
  }

  {
    // RA2) success KHÔNG có reason -> payload KHÔNG có key 'reason'
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_ATTACHMENT_FOR_UPDATE, result: { rows: [{ id: 'att-5', status: 'active' }], rowCount: 1 } },
      { expect: UPDATE_ATTACHMENTS, result: { rows: [{ id: 'att-5', status: 'pending_delete' }], rowCount: 1 } },
      { expect: INSERT_EVENTS_GENERIC, result: { rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { removeTaskAttachment } = loadTaskWriteWithFakePg(client);
    await removeTaskAttachment(MOCK_CONFIG, { taskId: 't1', attachmentId: 'att-5', actorEmployeeCode: 'PHF001' });
    const eventCall = client.calls.find((c) => INSERT_EVENTS_GENERIC.test(c.sql));
    const payload = JSON.parse(eventCall.params[3]);
    record('removeTaskAttachment_noReason_payloadOmitsReasonKey', !Object.prototype.hasOwnProperty.call(payload, 'reason'), { payload });
  }

  {
    // RA3) event fail -> UPDATE rollback (KHÔNG persist status pending_delete)
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_ATTACHMENT_FOR_UPDATE, result: { rows: [{ id: 'att-6', status: 'active' }], rowCount: 1 } },
      { expect: UPDATE_ATTACHMENTS, result: { rows: [{ id: 'att-6', status: 'pending_delete' }], rowCount: 1 } },
      { expect: INSERT_EVENTS_GENERIC, error: Object.assign(new Error('event insert failed'), { code: 'XX000' }) },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { removeTaskAttachment } = loadTaskWriteWithFakePg(client);
    let error;
    try { await removeTaskAttachment(MOCK_CONFIG, { taskId: 't1', attachmentId: 'att-6', actorEmployeeCode: 'PHF001' }); } catch (e) { error = e; }
    record('removeTaskAttachment_eventFail_rollsBackUpdate', error && error.message === 'event insert failed' && client._remainingSteps() === 0, { message: error && error.message });
  }

  {
    // RA4) not found
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_ATTACHMENT_FOR_UPDATE, result: { rows: [], rowCount: 0 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { removeTaskAttachment } = loadTaskWriteWithFakePg(client);
    let error;
    try { await removeTaskAttachment(MOCK_CONFIG, { taskId: 't1', attachmentId: 'missing', actorEmployeeCode: 'PHF001' }); } catch (e) { error = e; }
    record('removeTaskAttachment_NOT_FOUND', error && error.code === 'TASK_ATTACHMENT_NOT_FOUND', { code: error && error.code });
  }

  {
    // RA5) already removed (status khác 'active')
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_ATTACHMENT_FOR_UPDATE, result: { rows: [{ id: 'att-7', status: 'pending_delete' }], rowCount: 1 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { removeTaskAttachment } = loadTaskWriteWithFakePg(client);
    let error;
    try { await removeTaskAttachment(MOCK_CONFIG, { taskId: 't1', attachmentId: 'att-7', actorEmployeeCode: 'PHF001' }); } catch (e) { error = e; }
    record('removeTaskAttachment_ALREADY_REMOVED', error && error.code === 'TASK_ATTACHMENT_ALREADY_REMOVED', { code: error && error.code });
  }

  {
    // RA6) verify KHÔNG có statement DELETE nào chạm task.attachments trong toàn bộ luồng success
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_ATTACHMENT_FOR_UPDATE, result: { rows: [{ id: 'att-8', status: 'active' }], rowCount: 1 } },
      { expect: UPDATE_ATTACHMENTS, result: { rows: [{ id: 'att-8', status: 'pending_delete' }], rowCount: 1 } },
      { expect: INSERT_EVENTS_GENERIC, result: { rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { removeTaskAttachment } = loadTaskWriteWithFakePg(client);
    await removeTaskAttachment(MOCK_CONFIG, { taskId: 't1', attachmentId: 'att-8', actorEmployeeCode: 'PHF001' });
    const noDelete = client.calls.filter((c) => c.sql && /^DELETE/i.test(c.sql)).length === 0;
    record('removeTaskAttachment_NO_DELETE_statement_ever', noDelete, { calls: client.calls.map((c) => c.sql) });
  }

  // =========================================================================
  // Gate 5.4 — getTaskAttachmentForDownload
  // =========================================================================
  {
    // GA1) active found
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_ATTACHMENT_FOR_DOWNLOAD, result: { rows: [{ id: 'att-9', task_id: 't1', status: 'active', stored_object_key: 'tasks/t1/PHF001/k' }], rowCount: 1 } },
      { expect: /^COMMIT$/, result: {} },
    ]);
    const { getTaskAttachmentForDownload } = loadTaskWriteWithFakePg(client);
    const out = await getTaskAttachmentForDownload(MOCK_CONFIG, { taskId: 't1', attachmentId: 'att-9' });
    record('getTaskAttachmentForDownload_active_found', out && out.id === 'att-9', { out });
  }

  {
    // GA2) pending_delete -> coi như unavailable (SQL đã lọc status='active',
    // fake DB trả rowCount=0 mô phỏng đúng hành vi WHERE loại bỏ hàng đó).
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_ATTACHMENT_FOR_DOWNLOAD, result: { rows: [], rowCount: 0 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { getTaskAttachmentForDownload } = loadTaskWriteWithFakePg(client);
    let error;
    try { await getTaskAttachmentForDownload(MOCK_CONFIG, { taskId: 't1', attachmentId: 'att-pending-delete' }); } catch (e) { error = e; }
    record('getTaskAttachmentForDownload_pendingDelete_treatedUnavailable', error && error.code === 'TASK_ATTACHMENT_NOT_FOUND', { code: error && error.code });
  }

  {
    // GA3) wrong taskId -> WHERE task_id=$2 không khớp -> 0 rows -> NOT_FOUND
    // (verify param taskId THẬT SỰ được truyền vào WHERE, không bị bỏ qua)
    const client = makeFakeClient([
      { expect: /^BEGIN$/, result: {} },
      { expect: /^SET LOCAL ROLE phf_hr_app$/, result: {} },
      { expect: SELECT_ATTACHMENT_FOR_DOWNLOAD, result: { rows: [], rowCount: 0 } },
      { expect: /^ROLLBACK$/, result: {} },
    ]);
    const { getTaskAttachmentForDownload } = loadTaskWriteWithFakePg(client);
    let error;
    try { await getTaskAttachmentForDownload(MOCK_CONFIG, { taskId: 'task-WRONG', attachmentId: 'att-9' }); } catch (e) { error = e; }
    const selectCall = client.calls.find((c) => SELECT_ATTACHMENT_FOR_DOWNLOAD.test(c.sql));
    record(
      'getTaskAttachmentForDownload_wrongTaskId_cannotAccess',
      error && error.code === 'TASK_ATTACHMENT_NOT_FOUND' && selectCall.params[1] === 'task-WRONG',
      { code: error && error.code, params: selectCall.params }
    );
  }

  // =========================================================================
  // Module exports check — không regression, nay 18 hàm (Batch 1-6 + Gate 5.4).
  // =========================================================================
  {
    const source = fs.readFileSync(TASK_WRITE_JS_PATH, 'utf8');
    const exportsMatch = source.match(/module\.exports\s*=\s*\{([^}]*)\}/s);
    const staticNames = exportsMatch ? exportsMatch[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
    const client = makeFakeClient([]);
    const taskWrite = loadTaskWriteWithFakePg(client);
    const dynamicNames = Object.keys(taskWrite);
    const expected = [
      'updateTaskProgress', 'completeTask', 'reopenTask', 'cancelTask', 'changeTaskDeadline',
      'createDraftTask', 'publishTask',
      'transferTaskPrimary', 'addTaskRelated', 'removeTaskRelated',
      'addTaskComment', 'addTaskLink', 'removeTaskLink',
      'setTaskPermissionAssignment',
      'findTaskAttachmentByObjectKey', 'createTaskAttachmentMetadata', 'removeTaskAttachment', 'getTaskAttachmentForDownload',
      'createTaskCategory', 'renameTaskCategory', 'setTaskCategoryActive', 'reorderTaskCategory', 'deleteTaskCategoryIfUnused',
      'createTaskPermissionGrant', 'revokeTaskPermissionGrant',
    ];
    const exactMatch = dynamicNames.length === expected.length && expected.every((k) => dynamicNames.includes(k));
    const staticExactMatch = staticNames.length === expected.length && expected.every((k) => staticNames.includes(k));
    record('MODULE_EXPORTS_EXACTLY_25_FUNCTIONS', exactMatch && staticExactMatch, { dynamicNames, staticNames });
  }

  const allPass = results.every((r) => r.pass);
  console.log('OVERALL', allPass ? 'PASS' : 'FAIL', `(${results.filter((r) => r.pass).length}/${results.length})`);
  process.exit(allPass ? 0 : 1);
})();
