'use strict';
/*
 * Regression Test
 * Auth Accounts Consolidation (api/auth/accounts.js)
 * In-memory only
 * No Production Database
 * Safe for future verification
 *
 * Kiểm tra việc gộp api/auth/accounts/{list,create,update,delete,sync}.js + bổ sung
 * reset-password thành 1 file api/auth/accounts.js: đúng action được dispatch tới
 * đúng hàm nghiệp vụ, đúng guard (requireWebOperatorSession/assertAccountMutationAllowed
 * cho list/create/update/delete/reset-password; requireSession(['admin']) riêng cho sync),
 * và response contract giữ nguyên như các file cũ.
 *
 * Không kết nối Supabase/DB thật — chặn lib/auth.js, lib/checklist-permissions.js,
 * lib/request-guard.js bằng spy trước khi nạp api/auth/accounts.js.
 *
 * File này KHÔNG được gọi tự động ở bất kỳ đâu — chỉ chạy thủ công:
 *   node scripts/test-auth-accounts-consolidation.js
 */

const assert = require('assert');
const path = require('path');
const Module = require('module');

// ---------- 1. Trạng thái session giả lập (đổi được giữa các test) ----------
let currentSession = { role: 'admin', sub: 'admin-1', email: 'admin@test.local', account: { id: 'admin-1' } };
const calls = [];

// ---------- 2. Spy cho lib/request-guard.js ----------
const fakeRequestGuard = {
  assertSameOrigin(req) { calls.push(['assertSameOrigin']); },
  assertJsonContentType(req) { calls.push(['assertJsonContentType']); },
  assertContentLength(req) { calls.push(['assertContentLength']); },
  // lib/api-response.js (KHÔNG mock, dùng bản thật) tự require('./request-guard') để lấy
  // publicError — phải cấp lại đúng hành vi gốc, nếu không sendError() sẽ crash.
  publicError(err) {
    const status = Number(err && err.statusCode) || 500;
    if (status >= 400 && status < 500) return { status, body: { ok: false, error: (err && err.message) || 'Yêu cầu không hợp lệ.', code: (err && err.code) || 'BAD_REQUEST' } };
    return { status: 500, body: { ok: false, error: 'Hệ thống chưa thể xử lý yêu cầu. Vui lòng thử lại.', code: 'INTERNAL_ERROR' } };
  }
};

// ---------- 3. Spy cho lib/auth.js ----------
const fakeAuthLib = {
  async requireSession(req, roles) {
    calls.push(['requireSession', roles.slice()]);
    if (!roles.includes(currentSession.role)) {
      const e = new Error('Không có quyền truy cập.'); e.statusCode = 403; e.code = 'FORBIDDEN'; throw e;
    }
    return currentSession;
  },
  async createAccountByAdmin(account) {
    calls.push(['createAccountByAdmin', account]);
    return { account: { id: 'new-1', email: account.email, role: account.role || 'learner' }, temporaryPassword: 'Temp-Create-1' };
  },
  async updateAccountByAdmin(accountId, patch) {
    calls.push(['updateAccountByAdmin', accountId, patch]);
    return { id: accountId, email: patch.email || 'kept@test.local', role: patch.role || 'learner', status: 'active' };
  },
  async deleteAccountByAdmin(accountId, session) {
    calls.push(['deleteAccountByAdmin', accountId]);
    return { id: accountId, status: 'deleted' };
  },
  async listAccountsForAdmin() {
    calls.push(['listAccountsForAdmin']);
    return [{ id: 'a1', email: 'a1@test.local' }, { id: 'a2', email: 'a2@test.local' }];
  },
  async syncAccounts(accounts) {
    calls.push(['syncAccounts', accounts.length]);
    return accounts;
  },
  async resetPasswordByAdmin(accountId) {
    calls.push(['resetPasswordByAdmin', accountId]);
    return { account: { id: accountId, mustChangePassword: true }, temporaryPassword: 'Temp-Reset-1' };
  },
  async getAccountById(id) {
    calls.push(['getAccountById', id]);
    if (id === 'target-admin') return { id, role: 'admin', email: 'root@test.local' };
    if (id === 'target-webop') return { id, role: 'manager', email: 'webop@test.local' };
    return { id, role: 'learner', email: 'nv@test.local' };
  },
  clearCookieHeader() { calls.push(['clearCookieHeader']); return 'phf_session=; Max-Age=0'; }
};

// ---------- 4. Spy cho lib/checklist-permissions.js ----------
const fakeChecklistPermissions = {
  async requireChecklistWebOperator(session) {
    calls.push(['requireChecklistWebOperator', session.role]);
    return session;
  },
  async isChecklistWebOperator(session) {
    calls.push(['isChecklistWebOperator', session.sub]);
    return session.sub === 'target-webop';
  }
};

// ---------- 5. Chặn require() theo đúng đường dẫn thật (không theo chuỗi tương đối) ----------
const ROOT = path.join(__dirname, '..');
const REQUEST_GUARD_PATH = path.join(ROOT, 'lib', 'request-guard.js');
const AUTH_PATH = path.join(ROOT, 'lib', 'auth.js');
const PERMISSIONS_PATH = path.join(ROOT, 'lib', 'checklist-permissions.js');

const originalLoad = Module._load;
const originalResolve = Module._resolveFilename;
Module._load = function (request, parent, isMain) {
  if (request !== '.' && request !== '..' && /[\/\\]/.test(request)) {
    try {
      const resolved = originalResolve.call(Module, request, parent, isMain);
      if (resolved === REQUEST_GUARD_PATH) return fakeRequestGuard;
      if (resolved === AUTH_PATH) return fakeAuthLib;
      if (resolved === PERMISSIONS_PATH) return fakeChecklistPermissions;
    } catch (e) { /* rơi xuống require thật nếu không resolve được */ }
  }
  return originalLoad.apply(this, arguments);
};

const accountsHandler = require(path.join(ROOT, 'api', 'auth', 'accounts.js'));
Module._load = originalLoad; // khôi phục ngay sau khi nạp xong.

// ---------- 6. Fake req/res kiểu Vercel (req.query, req.body, res.status().json()) ----------
function fakeReq(method, { query = {}, body = {} } = {}) {
  return { method, query, body, headers: {} };
}
function fakeRes() {
  const res = { _headers: {}, _status: null, _body: null };
  res.setHeader = (k, v) => { res._headers[k] = v; };
  res.status = (code) => { res._status = code; return { json: (payload) => { res._body = payload; return res; } }; };
  return res;
}

// ---------- 7. Bộ chạy test ----------
const results = [];
async function record(name, fn) {
  calls.length = 0;
  try { await fn(); results.push({ name, pass: true }); console.log('✓ PASS -', name); }
  catch (err) { results.push({ name, pass: false, error: err }); console.log('✗ FAIL -', name, '\n   ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n   ') : err)); }
}

async function main() {
  console.log('=== Regression test: api/auth/accounts.js (mock, không đụng Supabase thật) ===\n');

  await record('GET ?action=list -> dùng requireWebOperatorSession, trả đúng contract cũ', async () => {
    currentSession = { role: 'admin', sub: 'admin-1' };
    const res = fakeRes();
    await accountsHandler(fakeReq('GET', { query: { action: 'list' } }), res);
    assert.strictEqual(res._status, 200);
    assert.deepStrictEqual(res._body, { ok: true, accounts: [{ id: 'a1', email: 'a1@test.local' }, { id: 'a2', email: 'a2@test.local' }] });
    assert.ok(calls.some(c => c[0] === 'requireSession' && JSON.stringify(c[1]) === JSON.stringify(['manager', 'admin'])), 'Phải gọi requireSession(["manager","admin"]) giống requireWebOperatorSession.');
    assert.ok(calls.some(c => c[0] === 'requireChecklistWebOperator'), 'list phải qua requireChecklistWebOperator.');
  });

  await record('GET với action khác "list" -> 405', async () => {
    const res = fakeRes();
    await accountsHandler(fakeReq('GET', { query: { action: 'delete' } }), res);
    assert.strictEqual(res._status, 405);
  });

  await record('POST action=create (Admin) -> 201, đúng contract {ok,user,temporaryPassword}', async () => {
    currentSession = { role: 'admin', sub: 'admin-1' };
    const res = fakeRes();
    await accountsHandler(fakeReq('POST', { body: { action: 'create', account: { email: 'new@test.local', role: 'learner' } } }), res);
    assert.strictEqual(res._status, 201);
    assert.deepStrictEqual(res._body, { ok: true, user: { id: 'new-1', email: 'new@test.local', role: 'learner' }, temporaryPassword: 'Temp-Create-1' });
    assert.ok(calls.some(c => c[0] === 'assertSameOrigin') && calls.some(c => c[0] === 'assertJsonContentType') && calls.some(c => c[0] === 'assertContentLength'), 'create phải chạy đủ 3 guard request-guard.');
  });

  await record('POST action=create (Web Operator, không phải Admin) cố tạo role=admin -> 403 ADMIN_ACCOUNT_PROTECTED', async () => {
    currentSession = { role: 'manager', sub: 'mgr-1' };
    const res = fakeRes();
    await accountsHandler(fakeReq('POST', { body: { action: 'create', account: { email: 'x@test.local', role: 'admin' } } }), res);
    assert.strictEqual(res._status, 403);
    assert.strictEqual(res._body.code, 'ADMIN_ACCOUNT_PROTECTED');
  });

  await record('POST action=update (Admin) -> 200, đúng contract {ok,user,reauthRequired}', async () => {
    currentSession = { role: 'admin', sub: 'admin-1', email: 'admin@test.local' };
    const res = fakeRes();
    await accountsHandler(fakeReq('POST', { body: { action: 'update', accountId: 'a1', account: { email: 'a1@test.local' } } }), res);
    assert.strictEqual(res._status, 200);
    assert.strictEqual(res._body.ok, true);
    assert.strictEqual(res._body.reauthRequired, false);
  });

  await record('POST action=update (Web Operator) nhắm vào tài khoản Admin -> 403 ADMIN_ACCOUNT_PROTECTED', async () => {
    currentSession = { role: 'manager', sub: 'mgr-1' };
    const res = fakeRes();
    await accountsHandler(fakeReq('POST', { body: { action: 'update', accountId: 'target-admin', account: {} } }), res);
    assert.strictEqual(res._status, 403);
    assert.strictEqual(res._body.code, 'ADMIN_ACCOUNT_PROTECTED');
  });

  await record('POST action=update (Web Operator) nhắm vào tài khoản Web Operator khác -> 403 ASSISTANT_ACCOUNT_PROTECTED', async () => {
    currentSession = { role: 'manager', sub: 'mgr-1' };
    const res = fakeRes();
    await accountsHandler(fakeReq('POST', { body: { action: 'update', accountId: 'target-webop', account: {} } }), res);
    assert.strictEqual(res._status, 403);
    assert.strictEqual(res._body.code, 'ASSISTANT_ACCOUNT_PROTECTED');
  });

  await record('POST action=delete (Admin) -> 200, đúng contract {ok,user}', async () => {
    currentSession = { role: 'admin', sub: 'admin-1' };
    const res = fakeRes();
    await accountsHandler(fakeReq('POST', { body: { action: 'delete', accountId: 'a2' } }), res);
    assert.strictEqual(res._status, 200);
    assert.deepStrictEqual(res._body, { ok: true, user: { id: 'a2', status: 'deleted' } });
  });

  await record('POST action=sync (Admin) -> 200 {ok,count}, KHÔNG qua requireChecklistWebOperator (khớp đúng server.js hiện tại)', async () => {
    currentSession = { role: 'admin', sub: 'admin-1' };
    const res = fakeRes();
    await accountsHandler(fakeReq('POST', { body: { action: 'sync', accounts: [{ email: 'x1' }, { email: 'x2' }, { email: 'x3' }] } }), res);
    assert.strictEqual(res._status, 200);
    assert.deepStrictEqual(res._body, { ok: true, count: 3 });
    assert.ok(calls.some(c => c[0] === 'requireSession' && JSON.stringify(c[1]) === JSON.stringify(['admin'])), 'sync phải gọi requireSession(["admin"]) — không nâng lên web operator.');
    assert.ok(!calls.some(c => c[0] === 'requireChecklistWebOperator'), 'sync không được qua requireChecklistWebOperator, khác với 5 action còn lại.');
  });

  await record('POST action=sync (Web Operator, không phải Admin) -> bị chặn (sync vẫn admin-only)', async () => {
    currentSession = { role: 'manager', sub: 'mgr-1' };
    const res = fakeRes();
    await accountsHandler(fakeReq('POST', { body: { action: 'sync', accounts: [] } }), res);
    assert.strictEqual(res._status, 403);
  });

  await record('POST action=reset-password (Admin) -> 200, đúng contract {ok,user,temporaryPassword} (endpoint mới bổ sung)', async () => {
    currentSession = { role: 'admin', sub: 'admin-1' };
    const res = fakeRes();
    await accountsHandler(fakeReq('POST', { body: { action: 'reset-password', accountId: 'a1' } }), res);
    assert.strictEqual(res._status, 200);
    assert.deepStrictEqual(res._body, { ok: true, user: { id: 'a1', mustChangePassword: true }, temporaryPassword: 'Temp-Reset-1' });
  });

  await record('POST action không hợp lệ -> 400 ACCOUNT_ACTION_INVALID', async () => {
    currentSession = { role: 'admin', sub: 'admin-1' };
    const res = fakeRes();
    await accountsHandler(fakeReq('POST', { body: { action: 'delete-everything' } }), res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(res._body.code, 'ACCOUNT_ACTION_INVALID');
  });

  await record('Method không hỗ trợ (PUT) -> 405', async () => {
    const res = fakeRes();
    await accountsHandler(fakeReq('PUT', {}), res);
    assert.strictEqual(res._status, 405);
  });

  console.log('\n=== Kết quả ===');
  const passed = results.filter(r => r.pass).length;
  console.log(passed + '/' + results.length + ' bước PASS.');
  console.log('\nToàn bộ chạy trên spy trong bộ nhớ (lib/auth.js, lib/checklist-permissions.js,');
  console.log('lib/request-guard.js đều bị mock) — không có ghi nào xuống database thật.');
  console.log('Chạy thủ công khi cần: node scripts/test-auth-accounts-consolidation.js');

  if (results.some(r => !r.pass)) process.exitCode = 1;
}

main().catch(err => { console.error('LỖI KHÔNG MONG ĐỢI:', err); process.exitCode = 1; });
