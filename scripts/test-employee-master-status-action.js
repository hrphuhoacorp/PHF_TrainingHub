'use strict';
/*
 * Regression test — "Đổi trạng thái nhân sự" (setEmploymentStatus in
 * api/_lib/employee-master.js). In-memory only, no Supabase/DB thật.
 *
 * Mocks @supabase/supabase-js's createClient with tiny in-memory
 * employee_profiles / user_accounts / employee_master_history tables, with
 * the ability to FORCE a write to fail on a specific table/row so we can
 * prove the atomicity contract without touching any real database:
 *   - chưa liên kết People Master -> lỗi rõ (EMPLOYEE_PROFILE_NOT_LINKED),
 *     KHÔNG silently tạo hồ sơ mới.
 *   - trạng thái không hợp lệ -> lỗi rõ (EMPLOYMENT_STATUS_INVALID).
 *   - đổi active -> inactive: cập nhật ĐÚNG MỘT cột employment_status, ghi
 *     lịch sử kèm effective_date/reason, tự động khóa account liên quan.
 *   - LỊCH SỬ GHI THẤT BẠI sau khi status đã UPDATE -> phải HOÀN TÁC status
 *     về giá trị cũ và trả lỗi cứng — không được báo thành công.
 *   - KHÓA ACCOUNT thất bại một phần (nhiều account, một fail một pass) ->
 *     status + history vẫn giữ nguyên (không rollback), trả về cảnh báo có
 *     cấu trúc locked/failed, KHÔNG dừng ở account đầu tiên lỗi.
 *   - đổi inactive -> active: KHÔNG có bất kỳ đường ghi nào xuống
 *     user_accounts (không tự mở khóa login).
 *   - đổi về CÙNG trạng thái hiện tại: changed=false, KHÔNG ghi thêm dòng
 *     lịch sử rác.
 *
 * Run: node scripts/test-employee-master-status-action.js
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');

let PASS = 0, FAIL = 0;
async function record(name, fn) {
  try { await fn(); PASS++; console.log('  PASS  ' + name); }
  catch (e) { FAIL++; console.error('  FAIL  ' + name + ' -> ' + (e && e.message)); }
}

// ---- in-memory tables ----
let profiles = [];
let userAccounts = [];
let history = [];
let nextId = 1;

// ---- forced-failure injection (test-only) ----
let FORCE_HISTORY_INSERT_FAIL = false;
let FORCE_ACCOUNT_UPDATE_FAIL_IDS = new Set();

function matchEq(row, col, val) { return String(row[col]) === String(val); }
function matchIlike(row, col, val) { return String(row[col] || '').toLowerCase() === String(val || '').toLowerCase(); }

function queryBuilder(table) {
  const filters = [];
  let orFilters = null;
  const store = table === 'employee_profiles' ? profiles : table === 'user_accounts' ? userAccounts : table === 'employee_master_history' ? history : [];
  const api = {
    select() { return api; },
    eq(col, val) { filters.push((r) => matchEq(r, col, val)); return api; },
    ilike(col, val) { filters.push((r) => matchIlike(r, col, val)); return api; },
    or(expr) {
      // "employee_id.eq.X,employee_code.eq.Y" style (lockAccountsForDepartedEmployee)
      const clauses = String(expr).split(',').map((c) => c.split('.'));
      orFilters = (r) => clauses.some(([col, , val]) => matchEq(r, col, val));
      return api;
    },
    limit() { return api; },
    async maybeSingle() {
      const found = store.find((r) => filters.every((f) => f(r))) || null;
      return { data: found, error: null };
    },
    then(resolve, reject) {
      // bare `await db.from(...).select(...).eq(...).or(...)` (lockAccountsForDepartedEmployee's SELECT)
      const rows = store.filter((r) => filters.every((f) => f(r)) && (!orFilters || orFilters(r)));
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    },
    // LAZY update builder — its own filter chain, evaluated only when
    // actually awaited/`.single()`d. The real call shape is always
    // `.update(patch).eq('id', X)` (eq AFTER update), so this must not
    // scope/execute anything until the whole chain is built, otherwise
    // every row in the table would match (patch is applied to ALL rows) —
    // exactly the timing bug that would silently break the partial-failure
    // test below (2+ accounts, only one should be touched per call).
    update(patch) {
      const localFilters = [];
      async function execute() {
        const rows = store.filter((r) => localFilters.every((f) => f(r)));
        if (table === 'user_accounts' && rows.some((r) => FORCE_ACCOUNT_UPDATE_FAIL_IDS.has(r.id))) {
          return { data: null, error: { code: '42501', message: 'permission denied for table user_accounts (forced test failure)' } };
        }
        rows.forEach((r) => Object.assign(r, patch));
        return { data: rows, error: null };
      }
      return {
        eq(col, val) { localFilters.push((r) => matchEq(r, col, val)); return this; },
        then: (res, rej) => execute().then(res, rej),
        select() { return { single: async () => { const r = await execute(); return { data: (r.data || [])[0] || null, error: r.error }; } }; },
      };
    },
    insert(row) {
      const insertResult = (async () => {
        if (table === 'employee_master_history' && FORCE_HISTORY_INSERT_FAIL) {
          return { data: null, error: { code: '42501', message: 'permission denied for table employee_master_history (forced test failure)' } };
        }
        const created = Object.assign({ id: table + '-' + (nextId++) }, row);
        store.push(created);
        return { data: created, error: null };
      })();
      return {
        then: (res, rej) => insertResult.then(res, rej),
        select() { return { single: async () => insertResult }; },
      };
    },
  };
  return api;
}

const fakeSupabaseModule = { createClient() { return { from: (table) => queryBuilder(table) }; } };

const ROOT = path.resolve(__dirname, '..');
const SUPABASE_PKG = require.resolve('@supabase/supabase-js', { paths: [ROOT] });
process.env.SUPABASE_URL = 'https://fake-test.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key-for-offline-test';

const originalLoad = Module._load;
const originalResolve = Module._resolveFilename;
Module._load = function (request, parent, isMain) {
  if (request !== '.' && request !== '..') {
    try {
      const resolved = originalResolve.call(Module, request, parent, isMain);
      if (resolved === SUPABASE_PKG) return fakeSupabaseModule;
    } catch (e) { /* fall through */ }
  }
  return originalLoad.apply(this, arguments);
};
const employeeMaster = require(path.join(ROOT, 'api', '_lib', 'employee-master.js'));
Module._load = originalLoad;

const ADMIN_SESSION = { role: 'admin', account: { id: 'admin-1', name: 'Admin Test' } };

(async () => {
  console.log('\n"Đổi trạng thái nhân sự" (setEmploymentStatus) — offline regression\n');

  await record('Chưa liên kết People Master -> EMPLOYEE_PROFILE_NOT_LINKED, KHÔNG tự tạo hồ sơ', async () => {
    const beforeCount = profiles.length;
    let err = null;
    try { await employeeMaster.setEmploymentStatus(ADMIN_SESSION, { employeeCode: 'PHFNOTLINKED', employmentStatus: 'inactive' }); }
    catch (e) { err = e; }
    assert.ok(err && err.code === 'EMPLOYEE_PROFILE_NOT_LINKED', 'expected EMPLOYEE_PROFILE_NOT_LINKED, got ' + (err && err.code));
    assert.strictEqual(profiles.length, beforeCount, 'không được tạo hồ sơ mới');
  });

  // seed one linked profile + one linked account
  profiles.push({ id: 'pm-seed-1', employee_code: 'PHFSTATUS', full_name: 'Nguyễn Trạng Thái', employment_status: 'active' });
  userAccounts.push({ id: 'acct-seed-1', employee_id: null, employee_code: 'PHFSTATUS', role: 'learner', status: 'active', metadata: {} });

  await record('Trạng thái không hợp lệ -> EMPLOYMENT_STATUS_INVALID', async () => {
    let err = null;
    try { await employeeMaster.setEmploymentStatus(ADMIN_SESSION, { employeeCode: 'PHFSTATUS', employmentStatus: 'on_leave' }); }
    catch (e) { err = e; }
    assert.ok(err && err.code === 'EMPLOYMENT_STATUS_INVALID');
  });

  await record('Ngày hiệu lực sai định dạng -> EFFECTIVE_DATE_INVALID', async () => {
    let err = null;
    try { await employeeMaster.setEmploymentStatus(ADMIN_SESSION, { employeeCode: 'PHFSTATUS', employmentStatus: 'inactive', effectiveDate: '15-09-2026' }); }
    catch (e) { err = e; }
    assert.ok(err && err.code === 'EFFECTIVE_DATE_INVALID');
  });

  // ---- ROLLBACK_TEST: forced history-insert failure must revert the status ----
  await record('History insert LỖI (giả lập) -> status REVERT về giá trị cũ, trả lỗi cứng, KHÔNG báo thành công', async () => {
    FORCE_HISTORY_INSERT_FAIL = true;
    const beforeStatus = profiles.find((p) => p.employee_code === 'PHFSTATUS').employment_status;
    assert.strictEqual(beforeStatus, 'active', 'tiền điều kiện: phải đang active trước khi test revert');
    let err = null;
    try { await employeeMaster.setEmploymentStatus(ADMIN_SESSION, { employeeCode: 'PHFSTATUS', employmentStatus: 'inactive' }); }
    catch (e) { err = e; }
    FORCE_HISTORY_INSERT_FAIL = false;
    assert.ok(err, 'phải throw lỗi cứng, không được resolve thành công');
    assert.strictEqual(err.code, 'EMPLOYMENT_STATUS_HISTORY_FAILED_REVERTED');
    const stored = profiles.find((p) => p.employee_code === 'PHFSTATUS');
    assert.strictEqual(stored.employment_status, 'active', 'status phải được hoàn tác về active, không được kẹt ở inactive');
    assert.strictEqual(userAccounts.find((a) => a.id === 'acct-seed-1').status, 'active', 'account KHÔNG được khóa khi status/history chưa commit thành công');
    assert.strictEqual(history.filter((h) => h.employee_profile_id === 'pm-seed-1').length, 0, 'không được có dòng lịch sử rác nào được ghi');
  });

  await record('active -> inactive: cập nhật employment_status + ghi effective_date/reason vào lịch sử + khóa account', async () => {
    const r = await employeeMaster.setEmploymentStatus(ADMIN_SESSION, {
      employeeCode: 'PHFSTATUS', employmentStatus: 'inactive', effectiveDate: '2026-09-15', reason: 'Nghỉ việc theo yêu cầu cá nhân',
    });
    assert.strictEqual(r.changed, true);
    assert.strictEqual(r.historyLogged, true);
    assert.strictEqual(r.profile.employment_status, 'inactive');
    const stored = profiles.find((p) => p.employee_code === 'PHFSTATUS');
    assert.strictEqual(stored.employment_status, 'inactive');
    const h = history.find((x) => x.employee_profile_id === 'pm-seed-1' && x.domain === 'employment_status');
    assert.ok(h, 'phải có dòng lịch sử domain=employment_status');
    assert.strictEqual(h.after_data.employment_status, 'inactive');
    assert.strictEqual(h.after_data.effective_date, '2026-09-15');
    assert.strictEqual(h.after_data.reason, 'Nghỉ việc theo yêu cầu cá nhân');
    assert.ok(r.accountLock && r.accountLock.locked === 1 && r.accountLock.failed === 0, 'account liên quan phải bị khóa (rule sẵn có)');
    assert.strictEqual(userAccounts.find((a) => a.id === 'acct-seed-1').status, 'inactive');
  });

  await record('inactive -> active: mở lại, KHÔNG khóa thêm gì, KHÔNG tự mở khóa login account', async () => {
    const acctStatusBefore = userAccounts.find((a) => a.id === 'acct-seed-1').status;
    assert.strictEqual(acctStatusBefore, 'inactive', 'tiền điều kiện: account phải đang khóa từ bước trước');
    const r = await employeeMaster.setEmploymentStatus(ADMIN_SESSION, { employeeCode: 'PHFSTATUS', employmentStatus: 'active', reason: 'Quay lại làm việc' });
    assert.strictEqual(r.changed, true);
    assert.strictEqual(r.profile.employment_status, 'active');
    assert.strictEqual(r.accountLock, null, 'không có bất kỳ hành động khóa/mở khóa nào khi active hoá lại');
    assert.strictEqual(userAccounts.find((a) => a.id === 'acct-seed-1').status, 'inactive', 'account đăng nhập PHẢI VẪN bị khóa — không tự mở khóa khi Nghỉ việc -> Đang làm');
  });

  await record('Đổi về CÙNG trạng thái hiện tại -> changed=false, KHÔNG ghi thêm lịch sử', async () => {
    const before = history.length;
    const r = await employeeMaster.setEmploymentStatus(ADMIN_SESSION, { employeeCode: 'PHFSTATUS', employmentStatus: 'active' });
    assert.strictEqual(r.changed, false);
    assert.strictEqual(history.length, before, 'không được ghi thêm dòng lịch sử khi không đổi gì');
  });

  // ---- ACCOUNT_LOCK_PARTIAL_TEST: 2 linked accounts, one forced to fail ----
  await record('Khóa account THẤT BẠI MỘT PHẦN (2 account, 1 fail) -> status/history vẫn commit, KHÔNG dừng ở account lỗi đầu tiên, trả về locked+failed', async () => {
    // Cả 2 account phải đang 'active' để cùng là target của lock loop —
    // acct-seed-1 đã bị khóa ('inactive') ở test trước, reset lại trực tiếp
    // trong store test (KHÔNG qua app) để dựng đúng tình huống 2 account
    // active cùng lúc, một sẽ fail một sẽ pass.
    userAccounts.find((a) => a.id === 'acct-seed-1').status = 'active';
    userAccounts.push({ id: 'acct-seed-2', employee_id: null, employee_code: 'PHFSTATUS', role: 'learner', status: 'active', metadata: {} });
    FORCE_ACCOUNT_UPDATE_FAIL_IDS = new Set(['acct-seed-1']);
    const r = await employeeMaster.setEmploymentStatus(ADMIN_SESSION, { employeeCode: 'PHFSTATUS', employmentStatus: 'inactive', reason: 'Nghỉ việc lần 2 (test partial lock)' });
    FORCE_ACCOUNT_UPDATE_FAIL_IDS = new Set();
    assert.strictEqual(r.changed, true, 'status vẫn phải commit thành công dù account-lock lỗi 1 phần');
    assert.strictEqual(r.historyLogged, true, 'history vẫn phải commit thành công dù account-lock lỗi 1 phần');
    assert.strictEqual(profiles.find((p) => p.employee_code === 'PHFSTATUS').employment_status, 'inactive');
    assert.ok(r.accountLock, 'phải trả về accountLock có cấu trúc');
    assert.strictEqual(r.accountLock.locked, 1, 'account KHÔNG bị force-fail (acct-seed-2) phải được khóa thành công');
    assert.strictEqual(r.accountLock.failed, 1, 'account BỊ force-fail (acct-seed-1) phải được ghi nhận là failed, không làm mất account-2');
    assert.strictEqual(userAccounts.find((a) => a.id === 'acct-seed-2').status, 'inactive', 'account không bị lỗi phải được khóa dù account khác trong cùng lượt lỗi');
    assert.strictEqual(userAccounts.find((a) => a.id === 'acct-seed-1').status, 'active', 'account bị force-fail phải GIỮ NGUYÊN trạng thái cũ (active) — update lỗi không được silently coi như đã khóa');
  });

  await record('QTTH classification/permission KHÔNG bị đụng — setEmploymentStatus chỉ ghi employee_profiles/employee_master_history/user_accounts', async () => {
    const src = require('fs').readFileSync(path.join(ROOT, 'api', '_lib', 'employee-master.js'), 'utf8');
    const fnStart = src.indexOf('async function setEmploymentStatus');
    const fnEnd = src.indexOf('\nasync function savePrivateProfile', fnStart);
    const fnBody = src.slice(fnStart, fnEnd);
    assert.ok(!/qtth\./.test(fnBody), 'setEmploymentStatus không được tham chiếu tới schema qtth.*');
  });

  console.log(`\n${PASS}/${PASS + FAIL} checks passed` + (FAIL ? '  — FAIL' : '  — ALL PASS'));
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(1); });
