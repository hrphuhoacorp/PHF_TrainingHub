'use strict';
/*
 * Regression test — Account -> People Master auto-link (ensureProfileFromAccount
 * in api/_lib/employee-master.js). In-memory only, no Supabase/DB thật.
 *
 * Mocks @supabase/supabase-js's createClient with a tiny in-memory
 * employee_profiles table so we can assert the core safety contract without
 * touching any real database:
 *   - employeeCode missing -> 'employee_code_required', KHÔNG tạo row.
 *   - name missing -> 'name_required', KHÔNG tạo row.
 *   - new employeeCode -> 'created', đúng 1 row, org fields được ghi từ account.
 *   - gọi lại lần 2 cùng employeeCode (khác tên/phòng ban) -> 'linked_existing',
 *     KHÔNG tạo thêm row (idempotent), KHÔNG ghi đè row cũ (safety).
 *
 * Run: node scripts/test-employee-master-account-sync.js
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');

let PASS = 0, FAIL = 0;
async function record(name, fn) {
  try { await fn(); PASS++; console.log('  PASS  ' + name); }
  catch (e) { FAIL++; console.error('  FAIL  ' + name + ' -> ' + (e && e.message)); }
}

// ---- in-memory employee_profiles + employee_master_history ----
let profiles = [];
let nextId = 1;

function matchEq(row, col, val) { return String(row[col]) === String(val); }
function matchIlike(row, col, val) { return String(row[col] || '').toLowerCase() === String(val || '').toLowerCase(); }

function queryBuilder(table) {
  const filters = [];
  const api = {
    select() { return api; },
    eq(col, val) { filters.push((r) => matchEq(r, col, val)); return api; },
    ilike(col, val) { filters.push((r) => matchIlike(r, col, val)); return api; },
    limit() { return api; },
    async maybeSingle() {
      if (table !== 'employee_profiles') return { data: null, error: null };
      const found = profiles.find((r) => filters.every((f) => f(r))) || null;
      return { data: found, error: null };
    },
    insert(row) {
      const insertResult = (async () => {
        if (table === 'employee_master_history') return { data: { id: 'h-' + (nextId++) }, error: null };
        const created = Object.assign({ id: 'pm-' + (nextId++), employment_status: 'active' }, row);
        profiles.push(created);
        return { data: created, error: null };
      })();
      return {
        then: (res, rej) => insertResult.then(res, rej),
        select() {
          return { single: async () => insertResult };
        },
      };
    },
  };
  return api;
}

const fakeSupabaseModule = {
  createClient() {
    return { from: (table) => queryBuilder(table) };
  },
};

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
  console.log('\nAccount -> People Master auto-link — offline regression\n');

  await record('employeeCode rỗng -> employee_code_required, KHÔNG tạo row', async () => {
    const before = profiles.length;
    const r = await employeeMaster.ensureProfileFromAccount(ADMIN_SESSION, { employeeCode: '', name: 'Nguyễn Test', phone: '0900000000' });
    assert.strictEqual(r.status, 'employee_code_required');
    assert.strictEqual(r.profile, null);
    assert.strictEqual(profiles.length, before);
  });

  await record('name rỗng -> name_required, KHÔNG tạo row', async () => {
    const before = profiles.length;
    const r = await employeeMaster.ensureProfileFromAccount(ADMIN_SESSION, { employeeCode: 'PHF999', name: '', phone: '0900000000' });
    assert.strictEqual(r.status, 'name_required');
    assert.strictEqual(profiles.length, before);
  });

  await record('employeeCode + name mới -> created, đúng 1 row với org fields từ account', async () => {
    const before = profiles.length;
    const r = await employeeMaster.ensureProfileFromAccount(ADMIN_SESSION, {
      employeeCode: 'PHF098', name: 'Trần Thị Case1', phone: '0911111111',
      branch: 'Phú Lợi', department: 'Bán hàng', position: 'Nhân viên',
    });
    assert.strictEqual(r.status, 'created');
    assert.strictEqual(profiles.length, before + 1);
    assert.strictEqual(r.profile.employee_code, 'PHF098');
    assert.strictEqual(r.profile.full_name, 'Trần Thị Case1');
    assert.strictEqual(r.profile.branch, 'Phú Lợi');
    assert.strictEqual(r.profile.department, 'Bán hàng');
  });

  await record('gọi lại CÙNG employeeCode (case-insensitive) -> linked_existing, KHÔNG tạo thêm row, KHÔNG ghi đè', async () => {
    const before = profiles.length;
    const r = await employeeMaster.ensureProfileFromAccount(ADMIN_SESSION, {
      employeeCode: 'phf098', name: 'Tên Khác Nếu Ghi Đè', phone: '0922222222',
      branch: 'Ngô Quyền', department: 'Marketing', position: 'Trưởng nhóm',
    });
    assert.strictEqual(r.status, 'linked_existing');
    assert.strictEqual(profiles.length, before, 'không được tạo thêm row trùng employee_code');
    const stored = profiles.find((p) => p.employee_code === 'PHF098');
    assert.strictEqual(stored.full_name, 'Trần Thị Case1', 'row cũ không bị ghi đè bởi lần gọi thứ 2');
    assert.strictEqual(stored.branch, 'Phú Lợi', 'org field cũ không bị ghi đè');
  });

  await record('hai employeeCode khác nhau -> hai profile độc lập, không đụng nhau', async () => {
    const before = profiles.length;
    const r = await employeeMaster.ensureProfileFromAccount(ADMIN_SESSION, {
      employeeCode: 'PHF100', name: 'Lê Văn Case2', phone: '0933333333',
      branch: 'Lái Thiêu', department: 'Kho vận', position: 'Thủ kho',
    });
    assert.strictEqual(r.status, 'created');
    assert.strictEqual(profiles.length, before + 1);
    assert.strictEqual(profiles.filter((p) => p.employee_code === 'PHF098').length, 1);
    assert.strictEqual(profiles.filter((p) => p.employee_code === 'PHF100').length, 1);
  });

  console.log(`\n${PASS}/${PASS + FAIL} checks passed` + (FAIL ? '  — FAIL' : '  — ALL PASS'));
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(1); });
