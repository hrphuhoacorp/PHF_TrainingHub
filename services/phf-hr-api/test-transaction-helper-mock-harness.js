'use strict';

// TEST/MOCK HARNESS — KHÔNG phải production code, KHÔNG phải Batch 1 business
// logic. Mục đích DUY NHẤT: kiểm chứng control-flow của
// withTaskWriteTransaction() trong lib/db.js:
//   pool.connect() -> BEGIN -> SET LOCAL ROLE phf_hr_app -> callback ->
//   COMMIT/ROLLBACK -> release()
//
// KHÔNG kết nối DB thật, KHÔNG dùng credential thật, KHÔNG dùng network thật.
// Kỹ thuật: inject 1 module 'pg' GIẢ vào require.cache TRƯỚC khi require
// lib/db.js, để `new Pool(...)` bên trong db.js tạo ra FakePool thay vì
// node-postgres thật — KHÔNG sửa 1 dòng nào trong lib/db.js.
//
// Chạy: node test-transaction-helper-mock-harness.js  (từ thư mục
// services/phf-hr-api, hoặc chỉ định đường dẫn tương ứng).

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const DB_JS_PATH = require.resolve('./lib/db.js');

// ---------------------------------------------------------------------------
// Fake pg client/pool — ghi lại đúng thứ tự mọi client.query()/release() gọi
// tới, và cho phép mô phỏng 1 câu lệnh cụ thể throw lỗi (để test nhánh
// ROLLBACK/COMMIT error).
// ---------------------------------------------------------------------------
function makeFakeClient(events, throwOnSql) {
  return {
    async query(sql) {
      events.push({ type: 'query', sql });
      if (throwOnSql && sql === throwOnSql.sql) {
        throw throwOnSql.error;
      }
      return { rows: [], rowCount: 0 };
    },
    release(err) {
      events.push({ type: 'release', err: err ? err.message : null });
    },
  };
}

function makeFakePgModule(client) {
  function FakePool() {
    return {
      connect: async () => client,
      on: () => {},
    };
  }
  return { Pool: FakePool };
}

// Nạp lại lib/db.js với 'pg' đã bị thay bằng bản giả — không đụng file thật,
// chỉ thao tác require.cache của chính tiến trình test này.
function loadDbWithFakePg(client) {
  const pgPath = require.resolve('pg');
  delete require.cache[DB_JS_PATH]; // ép load lại để poolSingleton reset mỗi test
  const originalPgEntry = require.cache[pgPath];
  require.cache[pgPath] = {
    id: pgPath,
    filename: pgPath,
    loaded: true,
    exports: makeFakePgModule(client),
  };
  const db = require(DB_JS_PATH);
  if (originalPgEntry) {
    require.cache[pgPath] = originalPgEntry;
  } else {
    delete require.cache[pgPath];
  }
  return db;
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
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`, detail !== undefined ? detail : '');
}

(async () => {
  // -------------------------------------------------------------------
  // Scenario A — success path
  // -------------------------------------------------------------------
  {
    const events = [];
    const client = makeFakeClient(events, null);
    const db = loadDbWithFakePg(client);
    let result, error;
    try {
      result = await db.withTaskWriteTransaction(MOCK_CONFIG, async (c) => {
        await c.query('SELECT_INSIDE_CALLBACK');
        return 'FN_OK';
      });
    } catch (e) {
      error = e;
    }
    const sqlSeq = events.filter((e) => e.type === 'query').map((e) => e.sql);
    const releaseEvents = events.filter((e) => e.type === 'release');
    record(
      'SUCCESS_PATH_sequence',
      !error &&
        sqlSeq[0] === 'BEGIN' &&
        sqlSeq[1] === 'SET LOCAL ROLE phf_hr_app' &&
        sqlSeq[2] === 'SELECT_INSIDE_CALLBACK' &&
        sqlSeq[3] === 'COMMIT' &&
        releaseEvents.length === 1 &&
        releaseEvents[0].err === null &&
        result === 'FN_OK',
      { sqlSeq, releaseEvents, result }
    );
  }

  // -------------------------------------------------------------------
  // Scenario B — callback throws -> ROLLBACK -> release(err) -> rethrow
  // -------------------------------------------------------------------
  {
    const events = [];
    const client = makeFakeClient(events, null);
    const db = loadDbWithFakePg(client);
    const fnError = new Error('CALLBACK_ERROR');
    let error;
    try {
      await db.withTaskWriteTransaction(MOCK_CONFIG, async () => {
        throw fnError;
      });
    } catch (e) {
      error = e;
    }
    const sqlSeq = events.filter((e) => e.type === 'query').map((e) => e.sql);
    const releaseEvents = events.filter((e) => e.type === 'release');
    record(
      'ROLLBACK_PATH_callback_throws',
      error === fnError &&
        sqlSeq[0] === 'BEGIN' &&
        sqlSeq[1] === 'SET LOCAL ROLE phf_hr_app' &&
        sqlSeq[2] === 'ROLLBACK' &&
        !sqlSeq.includes('COMMIT') &&
        releaseEvents.length === 1 &&
        releaseEvents[0].err === 'CALLBACK_ERROR',
      { sqlSeq, releaseEvents, errorIsSameObject: error === fnError }
    );
  }

  // -------------------------------------------------------------------
  // Scenario C — ROLLBACK itself throws -> original callback error vẫn
  // được rethrow (không bị rollbackErr che mất), release(err) vẫn dùng lỗi
  // gốc.
  // -------------------------------------------------------------------
  {
    const events = [];
    const rollbackError = new Error('ROLLBACK_FAILED');
    const client = makeFakeClient(events, { sql: 'ROLLBACK', error: rollbackError });
    const db = loadDbWithFakePg(client);
    const fnError = new Error('CALLBACK_ERROR_2');
    let error;
    try {
      await db.withTaskWriteTransaction(MOCK_CONFIG, async () => {
        throw fnError;
      });
    } catch (e) {
      error = e;
    }
    const sqlSeq = events.filter((e) => e.type === 'query').map((e) => e.sql);
    const releaseEvents = events.filter((e) => e.type === 'release');
    record(
      'ROLLBACK_ITSELF_THROWS_original_error_preserved',
      error === fnError &&
        sqlSeq.includes('ROLLBACK') &&
        releaseEvents.length === 1 &&
        releaseEvents[0].err === 'CALLBACK_ERROR_2',
      { sqlSeq, releaseEvents, errorIsOriginalFnError: error === fnError }
    );
  }

  // -------------------------------------------------------------------
  // Scenario D — COMMIT tự nó throw. Implementation hiện tại KHÔNG có
  // nhánh xử lý riêng cho COMMIT error — nó rơi vào cùng catch block với
  // callback error. Test này xác nhận hành vi ĐÓ (qua catch chung), không
  // giả định có 1 nhánh riêng biệt không tồn tại trong code thật.
  // -------------------------------------------------------------------
  {
    const events = [];
    const commitError = new Error('COMMIT_FAILED');
    const client = makeFakeClient(events, { sql: 'COMMIT', error: commitError });
    const db = loadDbWithFakePg(client);
    let result, error;
    try {
      result = await db.withTaskWriteTransaction(MOCK_CONFIG, async () => 'FN_OK_BEFORE_COMMIT_FAIL');
    } catch (e) {
      error = e;
    }
    const sqlSeq = events.filter((e) => e.type === 'query').map((e) => e.sql);
    const releaseEvents = events.filter((e) => e.type === 'release');
    record(
      'COMMIT_THROWS_handled_via_shared_catch_not_dedicated_branch',
      error === commitError &&
        sqlSeq[0] === 'BEGIN' &&
        sqlSeq[1] === 'SET LOCAL ROLE phf_hr_app' &&
        sqlSeq[2] === 'COMMIT' &&
        sqlSeq[3] === 'ROLLBACK' &&
        releaseEvents.length === 1 &&
        releaseEvents[0].err === 'COMMIT_FAILED' &&
        result === undefined,
      { sqlSeq, releaseEvents, note: 'Không có nhánh catch riêng cho COMMIT trong implementation hiện tại — đi qua catch chung, kết quả vẫn đúng (rollback attempt + release(err) + rethrow đúng lỗi COMMIT).' }
    );
  }

  // -------------------------------------------------------------------
  // Static check — SET LOCAL ROLE hiện diện, KHÔNG có session-scoped
  // "SET ROLE" nào (bare, không kèm LOCAL) trong lib/db.js.
  // -------------------------------------------------------------------
  {
    const source = fs.readFileSync(DB_JS_PATH, 'utf8');
    const hasSetLocalRole = /SET LOCAL ROLE/.test(source);
    // \b trước SET để loại false-positive từ "RESET ROLE" (chuỗi "RESET"
    // chứa literal "SET" nhưng không phải session-scoped SET ROLE thật).
    const bareSetRoleMatches = source.match(/\bSET\s+ROLE\b/g) || [];
    record('ROLE_SCOPE_STATIC_CHECK', hasSetLocalRole && bareSetRoleMatches.length === 0, {
      hasSetLocalRole,
      bareSetRoleOccurrences: bareSetRoleMatches.length,
      bareSetRoleMatches,
    });
  }

  // -------------------------------------------------------------------
  // Static + dynamic check — raw pool/getPool KHÔNG được export.
  // -------------------------------------------------------------------
  {
    const source = fs.readFileSync(DB_JS_PATH, 'utf8');
    const exportsLineMatch = source.match(/module\.exports\s*=\s*\{([^}]*)\}/);
    const exportedNamesStatic = exportsLineMatch
      ? exportsLineMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    const events = [];
    const client = makeFakeClient(events, null);
    const db = loadDbWithFakePg(client);
    const exportedNamesDynamic = Object.keys(db);

    const expected = ['testConnection', 'testTaskRoleBoundary', 'withTaskWriteTransaction', 'withTaskReadTransaction'];
    const noPoolStatic = !exportedNamesStatic.includes('pool') && !exportedNamesStatic.includes('getPool');
    const noPoolDynamic = !('pool' in db) && !('getPool' in db);
    const exactMatch =
      exportedNamesDynamic.length === expected.length &&
      expected.every((k) => exportedNamesDynamic.includes(k));

    record('RAW_POOL_EXPORT_CHECK', noPoolStatic && noPoolDynamic && exactMatch, {
      exportedNamesStatic,
      exportedNamesDynamic,
    });
  }

  // -------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------
  const allPass = results.every((r) => r.pass);
  console.log('OVERALL', allPass ? 'PASS' : 'FAIL');
  process.exit(allPass ? 0 : 1);
})();
