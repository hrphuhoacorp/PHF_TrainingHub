'use strict';

// PHF HR — Postgres direct connection (phf_hr), Option B runtime identity.
//
// phf_hr_runtime: LOGIN-only role, ZERO direct grants on schema `task`.
// Reaches phf_hr_app's runtime privileges ONLY via `SET LOCAL ROLE
// phf_hr_app` inside an explicit transaction (transaction-scoped — reverts
// automatically on COMMIT or ROLLBACK, no RESET ROLE needed, safe under
// connection pooling).
//
// `pool` is module-private and NOT exported — no other module can obtain a
// reference to it and call `pool.query()` directly for a write. The only
// way to run writes is `withTaskWriteTransaction()` below, which enforces
// the BEGIN -> SET LOCAL ROLE -> work -> COMMIT/ROLLBACK -> release pattern
// on every call.

const { Pool } = require('pg');
const logger = require('./logger');

let poolSingleton = null;

function getPool(config) {
  if (poolSingleton) return poolSingleton;
  poolSingleton = new Pool({
    host: config.PHF_HR_DB_HOST,
    port: config.PHF_HR_DB_PORT,
    database: config.PHF_HR_DB_NAME,
    user: config.PHF_HR_DB_RUNTIME_USER,
    password: config.PHF_HR_DB_RUNTIME_PASSWORD,
    max: 10, // giá trị khởi điểm thận trọng — chưa có evidence traffic thật cần cao hơn
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Lỗi trên 1 idle client trong pool (vd network drop giữa các lần dùng).
  // Chỉ log lại để có evidence điều tra — KHÔNG tự động reconnect/retry
  // loop nào ở đây, KHÔNG suppress lỗi transaction nào (transaction path có
  // error handling riêng trong withTaskWriteTransaction bên dưới).
  poolSingleton.on('error', (err) => {
    logger.error('db_pool_idle_client_error', { message: err.message });
  });

  return poolSingleton;
}

// ---------------------------------------------------------------------------
// Tier 1 — connectivity/auth only. SELECT 1, không transaction, không SET
// ROLE, không write. Chứng minh phf_hr_runtime connect + authenticate được.
// ---------------------------------------------------------------------------
async function testConnection(config) {
  const pool = getPool(config);
  const result = await pool.query('select 1 as ok');
  return { ok: result.rows[0].ok === 1 };
}

// ---------------------------------------------------------------------------
// Tier 2 — role-boundary proof. Dùng đúng 1 client (pool.connect()) xuyên
// suốt, KHÔNG INSERT/UPDATE/DELETE ở bất kỳ phase nào — chỉ SELECT/SET
// ROLE/BEGIN/ROLLBACK. Trả về snapshot đủ 5 phase để caller/script tự so
// khớp với kỳ vọng, không tự phán "PASS" bên trong hàm này.
// ---------------------------------------------------------------------------
async function testTaskRoleBoundary(config) {
  const pool = getPool(config);
  const client = await pool.connect();
  const phases = {};
  try {
    await client.query('BEGIN');

    let r = await client.query('select current_user, session_user');
    phases.beforeSetRole = r.rows[0];

    await client.query('SET LOCAL ROLE phf_hr_app');

    r = await client.query('select current_user, session_user');
    phases.duringSetRole = r.rows[0];

    r = await client.query('select 1 as ok from task.tasks limit 1');
    // Bảng có thể rỗng — mục đích là chứng minh câu lệnh KHÔNG bị
    // "permission denied", không phải chứng minh có dữ liệu.
    phases.duringSelectSucceeded = true;
    phases.duringSelectRowCount = r.rowCount;

    await client.query('ROLLBACK');

    r = await client.query('select current_user, session_user');
    phases.afterRollback = r.rows[0];

    return phases;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error('db_role_boundary_test_rollback_failed', { message: rollbackErr.message });
    }
    phases.error = err.message;
    throw Object.assign(err, { phases });
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Gate 11 — read-only counterpart to withTaskWriteTransaction() below. Same
// role-boundary pattern (BEGIN -> SET LOCAL ROLE phf_hr_app -> work ->
// COMMIT/ROLLBACK -> release), but the transaction itself is opened
// READ ONLY so Postgres rejects any write at the transaction level even if
// a future bug in a read-path function accidentally issued one — defense
// in depth on top of the caller only ever running SELECT.
// ---------------------------------------------------------------------------
async function withTaskReadTransaction(config, fn, options) {
  const timeoutMs = (options && options.timeoutMs) || 8000;
  const pool = getPool(config);
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query('SET LOCAL ROLE phf_hr_app');
    await client.query(`SET LOCAL statement_timeout = ${Number(timeoutMs)}`);
    const result = await fn(client);
    await client.query('COMMIT');
    client.release();
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error('db_read_transaction_rollback_failed', { message: rollbackErr.message });
    }
    client.release(err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Write-path transaction helper — BẮT BUỘC dùng cho mọi operation Batch 1-6.
// fn(client) PHẢI dùng client.query(...) — KHÔNG được gọi pool.query bên
// trong fn (sẽ lấy 1 connection khác, ngoài transaction/role hiện tại).
// ---------------------------------------------------------------------------
async function withTaskWriteTransaction(config, fn) {
  const pool = getPool(config);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE phf_hr_app');
    const result = await fn(client);
    await client.query('COMMIT');
    client.release();
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error('db_write_transaction_rollback_failed', { message: rollbackErr.message });
    }
    // release(err) báo cho pool huỷ hẳn connection này thay vì tái sử dụng
    // — defense-in-depth, không dựa hoàn toàn vào ROLLBACK đã revert sạch.
    client.release(err);
    throw err;
  }
}

module.exports = { testConnection, testTaskRoleBoundary, withTaskWriteTransaction, withTaskReadTransaction };
