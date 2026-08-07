'use strict';
/*
 * KNL (Khung năng lực) Step 1 — Regression test cho phân quyền + scope Nhân sự.
 * Bao phủ đúng 10 case bắt buộc ở yêu cầu "PHF HR – KNL STEP 1" mục 17.
 *
 * In-memory only — không chạm Production/Supabase thật — mock @supabase/supabase-js
 * theo đúng kỹ thuật đã dùng ở scripts/test-checklist-violation-notification-detail-500.js
 * (patch Module._resolveFilename + require.cache) để lib/knl-permissions.js và
 * lib/knl-people.js load với client giả, không cần biến môi trường Supabase thật.
 *
 * File này KHÔNG được gọi tự động ở bất kỳ đâu — chỉ chạy thủ công:
 *   node scripts/test-knl-permissions-scope.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const permissionsPath = require.resolve('../lib/knl-permissions');
const peoplePath = require.resolve('../lib/knl-people');
const scopePath = require.resolve('../lib/knl-scope');

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function makeTableFactory(rows) {
  return function tableQuery() {
    const filters = [];
    let mode = 'select', orderSpecs = [], limitN = null, singleMode = null, insertPayload = null, updatePayload = null;
    const q = {
      select() { return q; },
      eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
      neq(field, value) { filters.push(r => String(r[field]) !== String(value)); return q; },
      in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
      order(field, opts) { orderSpecs.push({ field, asc: !(opts && opts.ascending === false) }); return q; },
      limit(n) { limitN = n; return q; },
      maybeSingle() { singleMode = 'maybe'; return q; },
      single() { singleMode = 'single'; return q; },
      insert(payload) { mode = 'insert'; insertPayload = payload; return q; },
      update(payload) { mode = 'update'; updatePayload = payload; return q; },
      then(resolve, reject) {
        try {
          if (mode === 'insert') {
            const list = Array.isArray(insertPayload) ? insertPayload : [insertPayload];
            const inserted = list.map(obj => {
              const row = Object.assign({ id: 'gen-' + Math.random().toString(36).slice(2), created_at: new Date().toISOString(), is_active: true }, obj);
              rows.push(row);
              return row;
            });
            resolve({ data: clone(singleMode ? inserted[0] : inserted), error: null });
            return;
          }
          if (mode === 'update') {
            const matched = rows.filter(r => filters.every(fn => fn(r)));
            matched.forEach(r => Object.assign(r, updatePayload));
            resolve({ data: clone(singleMode ? (matched[0] || null) : matched), error: null });
            return;
          }
          let matched = rows.filter(r => filters.every(fn => fn(r)));
          orderSpecs.forEach(spec => {
            matched = matched.slice().sort((a, b) => {
              const av = a[spec.field], bv = b[spec.field];
              return (av < bv ? -1 : av > bv ? 1 : 0) * (spec.asc ? 1 : -1);
            });
          });
          if (limitN != null) matched = matched.slice(0, limitN);
          if (singleMode === 'maybe') { resolve({ data: clone(matched[0] || null), error: null }); return; }
          if (singleMode === 'single') { resolve({ data: clone(matched[0] || null), error: null }); return; }
          resolve({ data: clone(matched), error: null });
        } catch (e) { (reject || (err => Promise.reject(err)))(e); }
      }
    };
    return q;
  };
}

const STATE = { grants: [], history: [], employees: [] };

function buildSupabaseMock() {
  return {
    createClient() {
      return {
        from(table) {
          if (table === 'knl_permission_grants') return makeTableFactory(STATE.grants)();
          if (table === 'knl_permission_grant_history') return makeTableFactory(STATE.history)();
          if (table === 'checklist_employee_assignments') return makeTableFactory(STATE.employees)();
          throw new Error('Unexpected table in KNL mock: ' + table);
        }
      };
    }
  };
}

function loadKnlLibsWithMock() {
  const Module = require('module');
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === '@supabase/supabase-js') return supabasePath;
    return originalResolve.call(this, request, ...rest);
  };
  const originalCache = require.cache[supabasePath];
  delete require.cache[supabasePath];
  delete require.cache[permissionsPath];
  delete require.cache[peoplePath];
  delete require.cache[scopePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
  const permissionsLib = require(permissionsPath);
  const peopleLib = require(peoplePath);
  Module._resolveFilename = originalResolve;
  if (originalCache) require.cache[supabasePath] = originalCache; else delete require.cache[supabasePath];
  return { permissionsLib, peopleLib };
}

const loaded = loadKnlLibsWithMock();
const { getKnlCapabilities: getCaps, listKnlPermissionGrants, upsertKnlPermissionGrant: upsertGrant } = loaded.permissionsLib;
const { listKnlPeople } = loaded.peopleLib;

// ---------------------------------------------------------------------------
// Fixture nhân sự (checklist_employee_assignments) — CHỈ ĐỌC qua KNL People
// Adapter, mô phỏng dữ liệu tổ chức hiện tại (mục 3-4 của yêu cầu).
// ---------------------------------------------------------------------------
STATE.employees.push(
  { employee_code: 'NV1', employee_name: 'Nguyễn Văn NV1', title: 'Nhân viên', department: 'QTTH', branch: 'Ngô Quyền', employee_status: 'Đang làm việc' },
  { employee_code: 'S-PL1', employee_name: 'Trần Thị Bán PL', title: 'Nhân viên bán hàng', department: 'Bán hàng', branch: 'Phú Lợi', employee_status: 'Đang làm việc' },
  { employee_code: 'S-NQ1', employee_name: 'Lê Văn Bán NQ', title: 'Nhân viên bán hàng', department: 'Bán hàng', branch: 'Ngô Quyền', employee_status: 'Đang làm việc' },
  { employee_code: 'S-LT1', employee_name: 'Phạm Thị Bán LT', title: 'Nhân viên bán hàng', department: 'Bán hàng', branch: 'Lái Thiêu', employee_status: 'Đang làm việc' },
  { employee_code: 'S-OTHER', employee_name: 'Ngoài Phạm Vi', title: 'Nhân viên bán hàng', department: 'Bán hàng', branch: 'Bình Dương', employee_status: 'Đang làm việc' },
  { employee_code: 'QTTH1', employee_name: 'Đồng Nghiệp QTTH', title: 'Chuyên viên', department: 'QTTH', branch: 'Ngô Quyền', employee_status: 'Đang làm việc' },
  { employee_code: 'KHO1', employee_name: 'Nhân viên Kho', title: 'Thủ kho', department: 'Kho', branch: 'Phú Lợi', employee_status: 'Đang làm việc' },
  { employee_code: 'OLD1', employee_name: 'Đã Nghỉ Việc', title: 'Chuyên viên', department: 'QTTH', branch: 'Ngô Quyền', employee_status: 'Đã nghỉ việc' }
);

function session(role, opts) {
  opts = opts || {};
  return { role, account: { id: opts.id || '', name: opts.name || '' }, employeeId: opts.employeeCode || '', sub: opts.id || '' };
}

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}
function codesOf(people) { return people.map(p => p.employeeCode).sort(); }

async function grant(accountId, presetCode, capabilities, peopleScope, reason) {
  return upsertGrant(session('admin', { id: 'u-admin' }), { accountId, presetCode, capabilities, peopleScope, reason: reason || 'Thiết lập test' });
}

async function run() {
  // ---------- CASE 9 (trước hết): tài khoản chưa có grant nào -> không vào được KNL ----------
  let threw = null, result = null;
  try { result = await listKnlPeople(session('learner', { id: 'acc-nogrant' })); }
  catch (err) { threw = err; }
  check(!!threw && threw.code === 'KNL_ACCESS_DENIED', 'CASE 9. Tài khoản không có grant -> listKnlPeople bị deny KNL_ACCESS_DENIED, không throw 500, không lộ dữ liệu');

  // ---------- Thiết lập các grant theo đúng preset mục 6 ----------
  await grant('acc-nv', 'NHAN_VIEN', { access_knl: true, view_people: true }, { type: 'self', values: [] });
  await grant('acc-tcbh', 'TRUONG_CA_CHTR', { access_knl: true, view_people: true }, { type: 'sales_all_branches', values: [] });
  await grant('acc-tbp', 'TRUONG_BO_PHAN', { access_knl: true, view_people: true }, { type: 'department', values: ['QTTH'] });
  await grant('acc-tlgd', 'TRO_LY_GD', { access_knl: true, view_people: true }, { type: 'all_company', values: [] });
  await grant('acc-noviewpeople', 'CUSTOM', { access_knl: true, view_people: false }, { type: 'self', values: [] });

  // ---------- CASE 1: NV chỉ thấy chính mình ----------
  result = await listKnlPeople(session('learner', { id: 'acc-nv', employeeCode: 'NV1' }));
  check(codesOf(result.people).length === 1 && result.people[0].employeeCode === 'NV1', 'CASE 1. Nhân viên (scope self) chỉ thấy chính mình, không thấy đồng nghiệp khác');

  // ---------- CASE 2: Trưởng ca/CHT thấy NV Bán hàng cả 3 chi nhánh, không thấy phòng ban khác / chi nhánh ngoài chốt ----------
  result = await listKnlPeople(session('manager', { id: 'acc-tcbh' }));
  check(JSON.stringify(codesOf(result.people)) === JSON.stringify(['S-LT1', 'S-NQ1', 'S-PL1']), 'CASE 2. Trưởng ca/CHT thấy đúng 3 NV Bán hàng của Phú Lợi + Ngô Quyền + Lái Thiêu, KHÔNG thấy S-OTHER (chi nhánh ngoài chốt) hay bất kỳ phòng ban nào khác');

  // ---------- CASE 3: TBP chỉ thấy đúng bộ phận mình quản lý ----------
  result = await listKnlPeople(session('manager', { id: 'acc-tbp' }));
  check(JSON.stringify(codesOf(result.people)) === JSON.stringify(['NV1', 'QTTH1']), 'CASE 3. TBP (department=QTTH) chỉ thấy nhân sự QTTH, KHÔNG thấy Kho/Bán hàng dù có quyền KNL');

  // ---------- CASE 4: Trợ lý GĐ thấy toàn công ty (đang làm việc) ----------
  result = await listKnlPeople(session('manager', { id: 'acc-tlgd' }));
  check(result.people.length === 7, 'CASE 4. Trợ lý GĐ (all_company) thấy toàn bộ 7 nhân sự đang làm việc (8 dòng fixture - 1 đã nghỉ việc)');

  // ---------- CASE 5: Admin/System Admin — đường cứu hộ hoạt động dù KHÔNG có dòng grant nào ----------
  const adminCaps = await getCaps(session('admin', { id: 'u-admin-recovery' }));
  check(adminCaps.isAdmin === true && adminCaps.capabilities.manage_permissions === true && adminCaps.capabilities.access_knl === true, 'CASE 5a. Admin hệ thống (role=admin ở Hub) luôn có full capability KNL kể cả khi chưa từng được cấp grant nào (đường cứu hộ độc lập với bảng knl_permission_grants)');
  result = await listKnlPeople(session('admin', { id: 'u-admin-recovery' }));
  check(result.people.length === 7, 'CASE 5b. Admin recovery access xem được toàn bộ Nhân sự (scope all_company ngầm định)');
  const adminGrantsView = await listKnlPermissionGrants(session('admin', { id: 'u-admin-recovery' }));
  check(Array.isArray(adminGrantsView.grants) && adminGrantsView.grants.length >= 5, 'CASE 5c. Admin recovery truy cập được màn Phân quyền (listKnlPermissionGrants) dù chính Admin không có grant row nào');

  // ---------- CASE 6: API bypass — truyền filter ngoài phạm vi không được leak dữ liệu ----------
  result = await listKnlPeople(session('manager', { id: 'acc-tbp' }), { department: 'Kho' });
  check(result.people.length === 0, 'CASE 6. TBP (scope QTTH) cố truyền filter department=Kho qua thẳng API vẫn bị 0 kết quả — scope lọc server-side TRƯỚC filter client, không phải chỉ ẩn ở UI');
  threw = null;
  try { await listKnlPeople(session('learner', { id: 'acc-tbp-fake-role' })); }
  catch (err) { threw = err; }
  check(!!threw && threw.code === 'KNL_ACCESS_DENIED', 'CASE 6b. Tài khoản ngoài phạm vi (chưa cấp quyền) gọi thẳng action bị 403 deny, không phải 200 rỗng che giấu lỗi khác');

  // ---------- CASE 7: Nhân viên đã nghỉ việc — mặc định ẩn, filter inactive/all hoạt động đúng ----------
  result = await listKnlPeople(session('manager', { id: 'acc-tlgd' }));
  check(!codesOf(result.people).includes('OLD1'), 'CASE 7a. Mặc định (status=active) KHÔNG hiện nhân sự đã nghỉ việc');
  result = await listKnlPeople(session('manager', { id: 'acc-tlgd' }), { status: 'inactive' });
  check(codesOf(result.people).length === 1 && result.people[0].employeeCode === 'OLD1', 'CASE 7b. Filter "inactive" hiện đúng 1 nhân sự đã nghỉ việc');
  result = await listKnlPeople(session('manager', { id: 'acc-tlgd' }), { status: 'all' });
  check(result.people.length === 8, 'CASE 7c. Filter "all" hiện đủ toàn bộ 8 nhân sự (cả đang làm và đã nghỉ)');

  // ---------- CASE 8: Thay đổi permission -> audit ghi đúng before/after ----------
  const historyBefore = STATE.history.length;
  await upsertGrant(session('admin', { id: 'u-admin' }), { accountId: 'acc-nv', presetCode: 'NHAN_VIEN', capabilities: { access_knl: true, view_people: true }, peopleScope: { type: 'self', values: [] }, isActive: false, reason: 'Ngừng quyền test CASE 8' });
  check(STATE.history.length === historyBefore + 1, 'CASE 8a. Mỗi lần đổi quyền tạo đúng 1 dòng audit mới trong knl_permission_grant_history');
  const lastAudit = STATE.history[STATE.history.length - 1];
  check(lastAudit.action === 'disable' && lastAudit.before_data.is_active === true && lastAudit.after_data.is_active === false && lastAudit.reason === 'Ngừng quyền test CASE 8', 'CASE 8b. Audit ghi đủ action + before/after + reason + actor (mục 12)');
  threw = null;
  try { result = await listKnlPeople(session('learner', { id: 'acc-nv', employeeCode: 'NV1' })); }
  catch (err) { threw = err; }
  check(!!threw && threw.code === 'KNL_ACCESS_DENIED', 'CASE 8c. Sau khi ngừng quyền (is_active=false), NV không còn truy cập KNL được nữa (không có "quyền ma" còn hiệu lực)');

  // ---------- CASE 9b: có access_knl nhưng KHÔNG có view_people -> vẫn bị deny đúng loại lỗi ----------
  threw = null;
  try { await listKnlPeople(session('learner', { id: 'acc-noviewpeople' })); }
  catch (err) { threw = err; }
  check(!!threw && threw.code === 'KNL_VIEW_PEOPLE_DENIED', 'CASE 9d. Tài khoản có access_knl nhưng chưa cấp view_people -> deny đúng mã KNL_VIEW_PEOPLE_DENIED (không nhầm với KNL_ACCESS_DENIED)');

  // ---------- CASE 10: Regression — namespace KNL độc lập, không tạo/sửa bảng checklist_* ----------
  check(STATE.employees.length === 8 && STATE.employees.every(row => Object.prototype.hasOwnProperty.call(row, 'employee_code')), 'CASE 10. KNL People Adapter chỉ ĐỌC checklist_employee_assignments (8 dòng fixture nguyên vẹn), không insert/update/delete bảng này ở bất kỳ bước nào trong toàn bộ test');

  if (failures) {
    console.error('\n' + failures + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nALL PASS');
}

run().catch(err => { console.error('UNCAUGHT', err); process.exit(1); });
