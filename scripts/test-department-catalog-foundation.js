'use strict';
/*
 * Batch A regression tests — Training Hub canonical department foundation.
 *
 * Covers:
 *  1) catalog exact lookup (9 canonical names, case/whitespace tolerant,
 *     short-form legacy label correctly NOT matched)
 *  2) canonical save accepted (saveProfile + ensureProfileFromAccount write
 *     both department + department_key)
 *  3) unknown department rejected (both write paths)
 *  4) backfill maps all 9 canonical values correctly, leaves unmatched rows
 *     alone, is idempotent
 *  5) existing learner behavior unchanged — delegates to the existing
 *     phf-learning-gate.js / common-program suites, which this batch does
 *     NOT touch (see note in main()).
 *
 * All Supabase access is mocked in-memory — no real DB, no network, no
 * Checklist/QTTH files touched. Run manually:
 *   node scripts/test-department-catalog-foundation.js
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');

let passCount = 0, failCount = 0;
async function record(name, fn) {
  try { await fn(); console.log('  ✓ PASS -', name); passCount++; }
  catch (e) { console.error('  ✗ FAIL -', name, '\n       ', e && e.stack || e); failCount++; }
}

// ---------------------------------------------------------------------------
// PART 1 — pure catalog unit tests (no mocking needed at all).
// ---------------------------------------------------------------------------
const catalog = require(path.join(ROOT, 'api', '_lib', 'department-catalog.js'));

console.log('\n=== Batch A: Training Hub canonical department foundation ===\n');

const CANONICAL_PAIRS = [
  ['dept_ban_giam_doc', 'Ban giám đốc'],
  ['dept_ban_hang', 'Bộ phận bán hàng'],
  ['dept_ban_hang_online', 'Bộ phận bán hàng Online'],
  ['dept_goi_qua_che_bien', 'Bộ phận Gói quà & Chế biến'],
  ['dept_kho_van', 'Bộ phận kho vận'],
  ['dept_quan_tri_tong_hop', 'Bộ phận Quản trị tổng hợp'],
  ['dept_tai_chinh_ke_toan', 'Bộ phận Tài chính Kế toán'],
  ['dept_thu_mua', 'Bộ phận thu mua'],
  ['dept_truyen_thong_quang_cao', 'Bộ phận Truyền thông quảng cáo']
];

(async () => {

await record('1) Catalog has exactly the 9 required entries, no more/less', async () => {
  const list = catalog.listDepartments();
  assert.strictEqual(list.length, 9);
  CANONICAL_PAIRS.forEach(([key, name]) => {
    const entry = list.find(d => d.key === key);
    assert.ok(entry, 'thiếu key ' + key);
    assert.strictEqual(entry.displayName, name);
  });
});

await record('2) resolveDepartmentByDisplayName: exact match for all 9 (case/whitespace tolerant)', async () => {
  CANONICAL_PAIRS.forEach(([key, name]) => {
    assert.strictEqual(catalog.resolveDepartmentByDisplayName(name).key, key);
    assert.strictEqual(catalog.resolveDepartmentByDisplayName('  ' + name.toUpperCase() + '  ').key, key,
      'phải khoan dung khoảng trắng/hoa-thường: ' + name);
  });
});

await record('3) resolveDepartmentByDisplayName: legacy short label "Bán hàng" does NOT match (no fuzzy)', async () => {
  assert.strictEqual(catalog.resolveDepartmentByDisplayName('Bán hàng'), null,
    'nhãn ngắn cũ KHÔNG được tự khớp — đây là rule "no fuzzy mapping" của Batch A');
  assert.strictEqual(catalog.resolveDepartmentByDisplayName('Phòng Marketing'), null);
  assert.strictEqual(catalog.resolveDepartmentByDisplayName(''), null);
});

await record('4) resolveDepartmentForWrite: empty value allowed (no department assigned yet)', async () => {
  const r = catalog.resolveDepartmentForWrite('');
  assert.deepStrictEqual(r, { department: '', departmentKey: null });
});

await record('5) resolveDepartmentForWrite: canonical value accepted, returns canonical displayName + key', async () => {
  const r = catalog.resolveDepartmentForWrite('bộ phận bán hàng'); // lowercase input, should still resolve
  assert.strictEqual(r.departmentKey, 'dept_ban_hang');
  assert.strictEqual(r.department, 'Bộ phận bán hàng'); // canonical casing restored
});

await record('6) resolveDepartmentForWrite: unknown/non-catalog value REJECTED (throws)', async () => {
  assert.throws(() => catalog.resolveDepartmentForWrite('Bán hàng'), catalog.DepartmentCatalogError);
  assert.throws(() => catalog.resolveDepartmentForWrite('Phòng gì đó không tồn tại'), (err) => {
    return err.statusCode === 400 && err.code === 'EMPLOYEE_DEPARTMENT_INVALID';
  });
});

// ---------------------------------------------------------------------------
// PART 2 — employee-master.js write-path tests, with an in-memory fake
// Supabase client injected via Module._load interception (same technique as
// scripts/test-auth-accounts-consolidation.js).
// ---------------------------------------------------------------------------

function makeFakeSupabase(seedProfiles) {
  const tables = { employee_profiles: seedProfiles.map(p => ({ ...p })) };
  let nextId = tables.employee_profiles.length + 1;

  function chain(table, opState) {
    const state = opState || { filters: [] };
    return {
      select() { return chain(table, state); },
      eq(col, val) { return chain(table, { ...state, filters: [...state.filters, [col, val]] }); },
      ilike(col, val) { return chain(table, { ...state, filters: [...state.filters, [col, String(val).toLowerCase()]] }); },
      limit() { return chain(table, state); },
      order() { return chain(table, state); },
      insert(row) {
        const created = { id: 'gen-' + (nextId++), ...row };
        tables[table] = tables[table] || [];
        tables[table].push(created);
        return {
          select() {
            return { single: async () => ({ data: created, error: null }) };
          }
        };
      },
      update(patch) {
        return {
          eq: (col, val) => ({
            select() {
              return {
                single: async () => {
                  const rows = tables[table] || [];
                  const idx = rows.findIndex(r => String(r[col]) === String(val));
                  if (idx < 0) return { data: null, error: { message: 'not found' } };
                  rows[idx] = { ...rows[idx], ...patch };
                  return { data: rows[idx], error: null };
                }
              };
            }
          })
        };
      },
      maybeSingle: async () => {
        const rows = (tables[table] || []).filter(r => state.filters.every(([c, v]) => {
          const cell = r[c];
          return c && (String(cell || '').toLowerCase() === String(v).toLowerCase());
        }));
        return { data: rows[0] || null, error: null };
      },
      single: async () => {
        const rows = (tables[table] || []).filter(r => state.filters.every(([c, v]) => String(r[c]) === String(v)));
        return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } };
      }
    };
  }

  return {
    _tables: tables,
    from(table) {
      if (table === 'employee_master_history') {
        return { insert: async () => ({ data: {}, error: null }) };
      }
      return chain(table);
    }
  };
}

function loadEmployeeMasterWithFakeSupabase(fakeClient) {
  process.env.SUPABASE_URL = 'https://fake.local';
  process.env.SUPABASE_SECRET_KEY = 'fake-secret-key-for-tests';

  const SUPABASE_JS_PATH = require.resolve('@supabase/supabase-js');
  const EMPLOYEE_MASTER_PATH = path.join(ROOT, 'api', '_lib', 'employee-master.js');

  // Nạp lại module sạch mỗi lần test (tránh dùng chung `db` giữa các test case).
  delete require.cache[EMPLOYEE_MASTER_PATH];

  const originalLoad = Module._load;
  const originalResolve = Module._resolveFilename;
  Module._load = function (request, parent, isMain) {
    try {
      const resolved = originalResolve.call(Module, request, parent, isMain);
      if (resolved === SUPABASE_JS_PATH) return { createClient: () => fakeClient };
    } catch (e) { /* fall through to real require */ }
    return originalLoad.apply(this, arguments);
  };
  const mod = require(EMPLOYEE_MASTER_PATH);
  Module._load = originalLoad;
  return mod;
}

const ADMIN_SESSION = { role: 'admin', sub: 'admin-1', account: { id: 'admin-1', name: 'Admin' } };

await record('7) saveProfile(): canonical department accepted, persists BOTH display name and department_key', async () => {
  const fake = makeFakeSupabase([
    { id: 'p1', employee_code: 'PHF200', full_name: 'Nguyễn Test', department: '', department_key: null, employment_status: 'active' }
  ]);
  const em = loadEmployeeMasterWithFakeSupabase(fake);
  const result = await em.saveProfile(ADMIN_SESSION, { employeeCode: 'PHF200', department: 'bộ phận bán hàng' });
  assert.strictEqual(result.profile.department, 'Bộ phận bán hàng', 'phải lưu đúng displayName chuẩn (không phải giá trị admin gõ nguyên văn)');
  assert.strictEqual(result.profile.department_key, 'dept_ban_hang');
});

await record('8) saveProfile(): unknown department REJECTED, no row mutated', async () => {
  const fake = makeFakeSupabase([
    { id: 'p2', employee_code: 'PHF201', full_name: 'Trần Test', department: 'Bộ phận thu mua', department_key: 'dept_thu_mua', employment_status: 'active' }
  ]);
  const em = loadEmployeeMasterWithFakeSupabase(fake);
  await assert.rejects(
    em.saveProfile(ADMIN_SESSION, { employeeCode: 'PHF201', department: 'Phòng không tồn tại' }),
    (err) => err.statusCode === 400 && err.code === 'EMPLOYEE_DEPARTMENT_INVALID'
  );
  // Xác nhận record gốc không bị đụng vào (reject phải xảy ra TRƯỚC khi ghi).
  assert.strictEqual(fake._tables.employee_profiles.find(r => r.id === 'p2').department, 'Bộ phận thu mua');
});

await record('9) saveProfile(): omitting department leaves department_key untouched', async () => {
  const fake = makeFakeSupabase([
    { id: 'p3', employee_code: 'PHF202', full_name: 'Lê Test', department: 'Bộ phận kho vận', department_key: 'dept_kho_van', employment_status: 'active' }
  ]);
  const em = loadEmployeeMasterWithFakeSupabase(fake);
  const result = await em.saveProfile(ADMIN_SESSION, { employeeCode: 'PHF202', note: 'chỉ đổi ghi chú' });
  assert.strictEqual(result.profile.department, 'Bộ phận kho vận');
  assert.strictEqual(result.profile.department_key, 'dept_kho_van');
});

await record('10) ensureProfileFromAccount(): canonical department accepted at auto-create time', async () => {
  const fake = makeFakeSupabase([]);
  const em = loadEmployeeMasterWithFakeSupabase(fake);
  const out = await em.ensureProfileFromAccount(ADMIN_SESSION, { employeeCode: 'PHF203', name: 'Phạm Test', department: 'Bộ phận bán hàng Online' });
  assert.strictEqual(out.status, 'created');
  assert.strictEqual(out.profile.department, 'Bộ phận bán hàng Online');
  assert.strictEqual(out.profile.department_key, 'dept_ban_hang_online');
});

await record('11) ensureProfileFromAccount(): unknown department rejected, but caller (syncPeopleMasterForAccount) tolerates it — verified at catalog level, not account-creation blocking', async () => {
  const fake = makeFakeSupabase([]);
  const em = loadEmployeeMasterWithFakeSupabase(fake);
  await assert.rejects(
    em.ensureProfileFromAccount(ADMIN_SESSION, { employeeCode: 'PHF204', name: 'Vũ Test', department: 'Bán hàng' }),
    (err) => err.statusCode === 400 && err.code === 'EMPLOYEE_DEPARTMENT_INVALID'
  );
  // Không tạo row nào cho employee_code này (reject trước khi insert).
  assert.strictEqual(fake._tables.employee_profiles.find(r => r.employee_code === 'PHF204'), undefined);
});

// ---------------------------------------------------------------------------
// PART 3 — backfill script tests (in-memory fake client, same shape).
// ---------------------------------------------------------------------------
const { runBackfill } = require(path.join(ROOT, 'scripts', 'migrate-backfill-employee-profiles-department-key.js'));

function makeBackfillFakeClient(rows) {
  const table = rows.map(r => ({ ...r }));
  return {
    _table: table,
    from(name) {
      if (name !== 'employee_profiles') throw new Error('unexpected table ' + name);
      return {
        select: () => Promise.resolve({ data: table, error: null }),
        update(patch) {
          return {
            eq: (col, val) => {
              const idx = table.findIndex(r => String(r[col]) === String(val));
              if (idx >= 0) table[idx] = { ...table[idx], ...patch };
              return Promise.resolve({ error: idx >= 0 ? null : { message: 'not found' } });
            }
          };
        }
      };
    }
  };
}

await record('12) Backfill: maps all 9 canonical display names to the correct department_key', async () => {
  const rows = CANONICAL_PAIRS.map(([key, name], i) => ({ id: 'e' + i, employee_code: 'C' + i, department: name, department_key: null }));
  const client = makeBackfillFakeClient(rows);
  const summary = await runBackfill(client);
  assert.strictEqual(summary.updated, 9);
  assert.strictEqual(summary.unmatched.length, 0);
  CANONICAL_PAIRS.forEach(([key], i) => {
    assert.strictEqual(client._table.find(r => r.id === 'e' + i).department_key, key);
  });
});

await record('13) Backfill: leaves non-catalog / legacy short-label rows untouched and reports them (no fuzzy mapping)', async () => {
  const rows = [
    { id: 'legacy-1', employee_code: 'PHF100', department: 'Bán hàng', department_key: null },
    { id: 'blank-1', employee_code: 'PHF999', department: '', department_key: null }
  ];
  const client = makeBackfillFakeClient(rows);
  const summary = await runBackfill(client);
  assert.strictEqual(summary.updated, 0);
  assert.strictEqual(summary.skippedEmpty, 1);
  assert.strictEqual(summary.unmatched.length, 1);
  assert.strictEqual(summary.unmatched[0].employeeCode, 'PHF100');
  assert.strictEqual(client._table.find(r => r.id === 'legacy-1').department_key, null, 'không được tự đoán map cho nhãn ngắn cũ');
});

await record('14) Backfill: idempotent — rows already having department_key are skipped, run twice gives same result', async () => {
  const rows = CANONICAL_PAIRS.slice(0, 3).map(([key, name], i) => ({ id: 'x' + i, employee_code: 'X' + i, department: name, department_key: null }));
  const client = makeBackfillFakeClient(rows);
  const first = await runBackfill(client);
  assert.strictEqual(first.updated, 3);
  const second = await runBackfill(client);
  assert.strictEqual(second.updated, 0, 'lần chạy thứ 2 không được ghi đè lại các dòng đã có department_key');
  assert.strictEqual(second.skippedAlreadySet, 3);
});

console.log('\n=== KẾT QUẢ: ' + passCount + ' PASS, ' + failCount + ' FAIL ===\n');
console.log('LƯU Ý (mục "existing learner behavior unchanged"): Batch A không sửa');
console.log('phf-learning-gate.js hay api/data.js — chạy lại các bộ test đã có sẵn để');
console.log('xác nhận không regression:');
console.log('  node scripts/test-learning-gate-department-alias.js');
console.log('  node scripts/test-learner-lesson-surface-guard-fix.js');
console.log('  node scripts/test-training-hub-common-program.js');
console.log('  node scripts/test-auth-accounts-consolidation.js');
process.exit(failCount ? 1 : 0);

})();
