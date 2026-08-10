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

const STATE = { grants: [], history: [], employees: [], simulateSchemaMissing: false };

function missingTableQuery(table) {
  // Mô phỏng đúng lỗi Postgrest thật khi bảng chưa tồn tại (PGRST205), để kiểm
  // chứng throwDb() dịch đúng thành KNL_SCHEMA_MISSING thay vì lộ lỗi 500 chung
  // chung — đây chính là bug mà PATCH này sửa (root cause: SQL chưa được chạy).
  const q = {
    select() { return q; }, eq() { return q; }, neq() { return q; }, in() { return q; },
    order() { return q; }, limit() { return q; }, maybeSingle() { return q; }, single() { return q; },
    insert() { return q; }, update() { return q; },
    then(resolve) { resolve({ data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` } }); }
  };
  return q;
}

function buildSupabaseMock() {
  return {
    createClient() {
      return {
        from(table) {
          if (STATE.simulateSchemaMissing && (table === 'knl_permission_grants' || table === 'knl_permission_grant_history')) return missingTableQuery(table);
          if (table === 'knl_permission_grants') return makeTableFactory(STATE.grants)();
          if (table === 'knl_permission_grant_history') return makeTableFactory(STATE.history)();
          if (table === 'employee_profiles') return makeTableFactory(STATE.employees)();
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
// knl-scope.js không phụ thuộc Supabase — require thẳng, không cần mock.
const { subjectMatchesScope } = require('../lib/knl-scope');

// ---------------------------------------------------------------------------
// Fixture nhân sự (checklist_employee_assignments) — CHỈ ĐỌC qua KNL People
// Adapter, mô phỏng dữ liệu tổ chức hiện tại (mục 3-4 của yêu cầu).
// ---------------------------------------------------------------------------
STATE.employees.push(
  { employee_code: 'NV1', full_name: 'Nguyễn Văn NV1', title: 'Nhân viên', department: 'QTTH', branch: 'Ngô Quyền', employment_status: 'active' },
  { employee_code: 'S-PL1', full_name: 'Trần Thị Bán PL', title: 'Nhân viên bán hàng', department: 'Bán hàng', branch: 'Phú Lợi', employment_status: 'active' },
  { employee_code: 'S-NQ1', full_name: 'Lê Văn Bán NQ', title: 'Nhân viên bán hàng', department: 'Bán hàng', branch: 'Ngô Quyền', employment_status: 'active' },
  { employee_code: 'S-LT1', full_name: 'Phạm Thị Bán LT', title: 'Nhân viên bán hàng', department: 'Bán hàng', branch: 'Lái Thiêu', employment_status: 'active' },
  { employee_code: 'S-OTHER', full_name: 'Ngoài Phạm Vi', title: 'Nhân viên bán hàng', department: 'Bán hàng', branch: 'Bình Dương', employment_status: 'active' },
  { employee_code: 'QTTH1', full_name: 'Đồng Nghiệp QTTH', title: 'Chuyên viên', department: 'QTTH', branch: 'Ngô Quyền', employment_status: 'active' },
  { employee_code: 'KHO1', full_name: 'Nhân viên Kho', title: 'Thủ kho', department: 'Kho', branch: 'Phú Lợi', employment_status: 'active' },
  { employee_code: 'OLD1', full_name: 'Đã Nghỉ Việc', title: 'Chuyên viên', department: 'QTTH', branch: 'Ngô Quyền', employment_status: 'inactive' },
  { employee_code: 'TBP-E1', full_name: 'Cấp Dưới Một', title: 'Nhân viên', department: 'Kho', branch: 'Phú Lợi', employment_status: 'active' },
  { employee_code: 'TBP-E2', full_name: 'Cấp Dưới Hai', title: 'Nhân viên', department: 'Kho', branch: 'Phú Lợi', employment_status: 'active' },
  { employee_code: 'TBP-E3', full_name: 'Cấp Dưới Ba', title: 'Nhân viên', department: 'Kho', branch: 'Phú Lợi', employment_status: 'active' }
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
  check(result.people.length === 10, 'CASE 4. Trợ lý GĐ (all_company) thấy toàn bộ 10 nhân sự đang làm việc (11 dòng fixture - 1 đã nghỉ việc)');

  // ---------- CASE 5: Admin/System Admin — đường cứu hộ hoạt động dù KHÔNG có dòng grant nào ----------
  const adminCaps = await getCaps(session('admin', { id: 'u-admin-recovery' }));
  check(adminCaps.isAdmin === true && adminCaps.capabilities.manage_permissions === true && adminCaps.capabilities.access_knl === true, 'CASE 5a. Admin hệ thống (role=admin ở Hub) luôn có full capability KNL kể cả khi chưa từng được cấp grant nào (đường cứu hộ độc lập với bảng knl_permission_grants)');
  result = await listKnlPeople(session('admin', { id: 'u-admin-recovery' }));
  check(result.people.length === 10, 'CASE 5b. Admin recovery access xem được toàn bộ Nhân sự (scope all_company ngầm định)');
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
  check(result.people.length === 11, 'CASE 7c. Filter "all" hiện đủ toàn bộ 11 nhân sự (cả đang làm và đã nghỉ)');

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
  check(STATE.employees.length === 11 && STATE.employees.every(row => Object.prototype.hasOwnProperty.call(row, 'employee_code')), 'CASE 10. KNL People Adapter chỉ ĐỌC employee_profiles (11 dòng fixture nguyên vẹn), không insert/update/delete bảng này ở bất kỳ bước nào trong toàn bộ test');

  // ---------- PATCH UI SHELL + FIX PHÂN QUYỀN — regression cho throwDb(): bảng KNL chưa tồn tại (PGRST205) phải dịch thành lỗi rõ ràng, không phải 500 chung chung ----------
  STATE.simulateSchemaMissing = true;
  threw = null;
  try { await listKnlPermissionGrants(session('admin', { id: 'u-admin' })); }
  catch (err) { threw = err; }
  check(!!threw && threw.code === 'KNL_SCHEMA_MISSING' && threw.statusCode === 503 && /PHF_KNL_PERMISSIONS_1\.0\.sql/.test(threw.message), 'CASE EXTRA. Khi bảng knl_permission_grants chưa tồn tại (PGRST205 thật từ Postgrest), throwDb() dịch thành lỗi 503 KNL_SCHEMA_MISSING trỏ đúng file SQL cần chạy — không rơi vào 500 "Hệ thống chưa thể xử lý yêu cầu" chung chung như trước patch này');
  STATE.simulateSchemaMissing = false;

  // ---------- KNL Permission Audit — batch "reserve TBP" + income_view ----------
  function grantOf(grants, accountId) { return grants.find(g => g.accountId === accountId); }
  async function grantsSnapshot() { return (await listKnlPermissionGrants(session('admin', { id: 'u-admin' }))).grants; }

  // CASE 11: TBP nhiều-nhiều — 2 TBP độc lập cùng liệt kê chung 1 nhân sự (TBP-E2)
  await grant('acc-tbp-a', 'TRUONG_BO_PHAN', { access_knl: true, view_people: true }, { type: 'employees', values: ['TBP-E1', 'TBP-E2'] }, 'Cấp TBP A quản lý E1,E2');
  await grant('acc-tbp-b', 'TRUONG_BO_PHAN', { access_knl: true, view_people: true }, { type: 'employees', values: ['TBP-E2', 'TBP-E3'] }, 'Cấp TBP B quản lý E2,E3');
  result = await listKnlPeople(session('manager', { id: 'acc-tbp-a' }));
  check(JSON.stringify(codesOf(result.people)) === JSON.stringify(['TBP-E1', 'TBP-E2']), 'CASE 11a. TBP A (scope employees=[E1,E2]) thấy đúng E1,E2');
  result = await listKnlPeople(session('manager', { id: 'acc-tbp-b' }));
  check(JSON.stringify(codesOf(result.people)) === JSON.stringify(['TBP-E2', 'TBP-E3']), 'CASE 11b. TBP B (scope employees=[E2,E3]) thấy đúng E2,E3 — cùng E2 với TBP A -> many-to-many, không cần bảng join');

  // CASE 12: TBP A -> Nhân viên (UPDATE cùng 1 row active, không đụng is_active) — mất quyền xem E1,E2 ngay, danh sách dời sang reservedEmployees
  await grant('acc-tbp-a', 'NHAN_VIEN', { access_knl: true, view_people: true }, { type: 'self', values: [] }, 'A rời TBP, chuyển Nhân viên');
  threw = null;
  try { result = await listKnlPeople(session('learner', { id: 'acc-tbp-a', employeeCode: 'ACC-TBP-A-SELF' })); }
  catch (err) { threw = err; }
  check(!threw && codesOf(result.people).length === 0, 'CASE 12a. A (Nhân viên, scope self, employeeCode không khớp bất kỳ fixture nào) không còn thấy E1,E2 hay bất kỳ ai khác');
  let snap = await grantsSnapshot();
  check(JSON.stringify(grantOf(snap, 'acc-tbp-a').peopleScope.reservedEmployees.slice().sort()) === JSON.stringify(['TBP-E1', 'TBP-E2']), 'CASE 12b. Row của A: type đổi thành self, reservedEmployees lưu đúng lại [TBP-E1,TBP-E2] (không mất, không hard delete)');
  check(grantOf(snap, 'acc-tbp-a').peopleScope.values.length === 0, 'CASE 12c. Row của A: values ACTIVE đã rỗng — reserve không tham gia scope hiện hành');

  // CASE 13: đổi tiếp Nhân viên -> Trợ lý GĐ (vẫn KHÔNG phải employees) — reserve phải nguyên vẹn qua 2 lượt đổi liên tiếp
  await grant('acc-tbp-a', 'TRO_LY_GD', { access_knl: true, view_people: true }, { type: 'all_company', values: [] }, 'A đổi tiếp sang Trợ lý GĐ');
  snap = await grantsSnapshot();
  check(JSON.stringify(grantOf(snap, 'acc-tbp-a').peopleScope.reservedEmployees.slice().sort()) === JSON.stringify(['TBP-E1', 'TBP-E2']), 'CASE 13. Đổi role lần 2 (self -> all_company, không qua employees) — reservedEmployees vẫn giữ nguyên [TBP-E1,TBP-E2], không bị ghi đè/mất chỉ vì đổi role thêm lần nữa');

  // CASE 14: cấp lại TBP, KHÔNG chọn ai (values rỗng) — phải tự động phục hồi TRƯỚC khi validate "cần ít nhất 1 người"
  await grant('acc-tbp-a', 'TRUONG_BO_PHAN', { access_knl: true, view_people: true }, { type: 'employees', values: [] }, 'Cấp lại TBP cho A, không tick ai');
  result = await listKnlPeople(session('manager', { id: 'acc-tbp-a' }));
  check(JSON.stringify(codesOf(result.people)) === JSON.stringify(['TBP-E1', 'TBP-E2']), 'CASE 14a. Cấp lại TBP không chọn ai -> tự phục hồi đúng danh sách cũ E1,E2, không cần Admin đọc history/tick tay');
  snap = await grantsSnapshot();
  check(grantOf(snap, 'acc-tbp-a').peopleScope.reservedEmployees.length === 0, 'CASE 14b. Sau khi phục hồi, reservedEmployees được dọn sạch ([]) — invariant type=employees <=> reservedEmployees=[] luôn đúng');

  // CASE 15: rời TBP lần nữa, để chuẩn bị CASE 16 (chọn danh sách mới, không phải để trống)
  await grant('acc-tbp-a', 'NHAN_VIEN', { access_knl: true, view_people: true }, { type: 'self', values: [] }, 'A rời TBP lần 2');
  snap = await grantsSnapshot();
  check(JSON.stringify(grantOf(snap, 'acc-tbp-a').peopleScope.reservedEmployees.slice().sort()) === JSON.stringify(['TBP-E1', 'TBP-E2']), 'CASE 15. Rời TBP lần 2 — reserve lại đúng [TBP-E1,TBP-E2] (danh sách active ngay trước khi rời)');

  // CASE 16: cấp lại TBP nhưng Admin CHỌN danh sách mới (chỉ E3) — không được merge với reserve cũ, reserve cũ bị xoá vì invariant
  await grant('acc-tbp-a', 'TRUONG_BO_PHAN', { access_knl: true, view_people: true }, { type: 'employees', values: ['TBP-E3'] }, 'Cấp lại TBP cho A với danh sách mới');
  result = await listKnlPeople(session('manager', { id: 'acc-tbp-a' }));
  check(JSON.stringify(codesOf(result.people)) === JSON.stringify(['TBP-E3']), 'CASE 16a. Chọn danh sách mới [E3] -> chỉ E3 active, KHÔNG merge với reserve cũ [E1,E2]');
  snap = await grantsSnapshot();
  check(grantOf(snap, 'acc-tbp-a').peopleScope.reservedEmployees.length === 0, 'CASE 16b. reservedEmployees bị dọn sạch ngay khi có danh sách employees chủ động mới — reserve cũ [E1,E2] không quay lại được nữa (đúng ý "không merge")');

  // CASE 17: subjectMatchesScope KHÔNG BAO GIỜ đọc reservedEmployees, kể cả khi cố tình để dữ liệu "khớp" nằm trong đó
  const subjectE1 = { employee_code: 'TBP-E1', department: 'Kho', branch: 'Phú Lợi' };
  check(subjectMatchesScope(subjectE1, { type: 'self', values: [], reservedEmployees: ['TBP-E1'] }, { employeeCode: 'SOMEONE-ELSE' }) === false, 'CASE 17a. type=self, subject KHỚP với reservedEmployees nhưng KHÔNG khớp identity thật -> vẫn false (reservedEmployees không được đọc để "cứu" một scope self không khớp)');
  check(subjectMatchesScope(subjectE1, { type: 'employees', values: ['TBP-E3'], reservedEmployees: ['TBP-E1'] }, {}) === false, 'CASE 17b. type=employees, subject CHỈ có trong reservedEmployees (không có trong values active) -> false — chứng minh hàm chỉ đọc values, tuyệt đối không đọc reservedEmployees dù type đang đúng là employees');
  check(subjectMatchesScope(subjectE1, { type: 'employees', values: ['TBP-E1'], reservedEmployees: [] }, {}) === true, 'CASE 17c. Đối chứng: subject có trong values active thật -> true (hàm vẫn hoạt động đúng cho trường hợp hợp lệ)');

  // CASE 18: Foundation 1.50.0 — Admin luôn full income_view. Backend sensitive API
  // vẫn là source of truth; grant row không được làm stale/thu hồi đường Admin.
  let caps = await getCaps(session('admin', { id: 'u-admin-no-row' }));
  check(caps.capabilities.income_view === true, 'CASE 18a. Admin không có grant row nào -> income_view mặc định true (đường cứu hộ)');
  await grant('u-admin-revoked-income', 'CUSTOM', { access_knl: true, view_people: true, manage_permissions: true, income_view: false }, { type: 'self', values: [] }, 'Thu hồi income_view của Admin này');
  caps = await getCaps(session('admin', { id: 'u-admin-revoked-income' }));
  check(caps.capabilities.income_view === true, 'CASE 18b. Admin có grant row income_view=false vẫn giữ full income_view theo Foundation 1.50.0; backend authorization là source of truth');
  check(caps.capabilities.access_knl === true && caps.capabilities.manage_permissions === true, 'CASE 18c. Cùng Admin đó: các capability cứu hộ khác không bị ảnh hưởng bởi việc income_view bị thu hồi');
  caps = await getCaps(session('admin', { id: 'u-admin-no-row' }));
  check(caps.capabilities.income_view === true, 'CASE 18d. Admin khác (không có override) vẫn income_view=true — thu hồi của 1 Admin không ảnh hưởng Admin khác');

  // CASE 19: income_view — Trợ lý GĐ được cấp ngoại lệ (không mặc định, phải cấp riêng)
  await grant('acc-tlgd-noincome', 'TRO_LY_GD', { access_knl: true, view_people: true }, { type: 'all_company', values: [] }, 'Trợ lý GĐ mặc định không có income_view');
  caps = await getCaps(session('manager', { id: 'acc-tlgd-noincome' }));
  check(caps.capabilities.income_view === false, 'CASE 19a. Trợ lý GĐ theo preset mặc định KHÔNG có income_view (không tự động mặc định true như Admin)');
  await grant('acc-tlgd-income', 'TRO_LY_GD', { access_knl: true, view_people: true, income_view: true, incomeScope: { type: 'all_company', values: [] } }, { type: 'all_company', values: [] }, 'Cấp ngoại lệ Xem thu nhập cho Trợ lý GĐ này');
  caps = await getCaps(session('manager', { id: 'acc-tlgd-income' }));
  check(caps.capabilities.income_view === true, 'CASE 19b. Trợ lý GĐ được Admin cấp ngoại lệ income_view=true thật qua đúng cơ chế capabilities chung (không phải logic hard-code riêng)');

  // ---------- KNL PERMISSION UX POLISH + INCOME SCOPE ----------
  // CASE 20: income_view=true bắt buộc phải có incomeScope hợp lệ - không suy diễn "rỗng = tất cả"
  threw = null;
  try { await grant('acc-income-noscope', 'TRO_LY_GD', { access_knl: true, view_people: true, income_view: true }, { type: 'all_company', values: [] }, 'Bật income_view nhưng không chọn phạm vi'); }
  catch (err) { threw = err; }
  check(!!threw && threw.code === 'KNL_INCOME_SCOPE_REQUIRED', 'CASE 20. income_view=true mà không kèm incomeScope -> bị reject KNL_INCOME_SCOPE_REQUIRED, không tự suy "chưa chọn = xem tất cả"');

  // CASE 21: income_view=true + incomeScope type=all_company -> lưu/đọc lại đúng
  await grant('acc-income-all', 'TRO_LY_GD', { access_knl: true, view_people: true, income_view: true, incomeScope: { type: 'all_company', values: [] } }, { type: 'all_company', values: [] }, 'Cấp Thu nhập phạm vi Tất cả nhân sự');
  snap = await grantsSnapshot();
  check(grantOf(snap, 'acc-income-all').capabilities.income_view === true && grantOf(snap, 'acc-income-all').capabilities.incomeScope.type === 'all_company', 'CASE 21. income_view=true + incomeScope.type=all_company lưu/đọc lại đúng qua listKnlPermissionGrants');

  // CASE 22: income_view=true + incomeScope type=employees + values rỗng -> reject (đúng invariant giống people_scope employees)
  threw = null;
  try { await grant('acc-income-empty-emp', 'TRO_LY_GD', { access_knl: true, view_people: true, income_view: true, incomeScope: { type: 'employees', values: [] } }, { type: 'all_company', values: [] }, 'Chọn nhân sự cụ thể nhưng không tick ai'); }
  catch (err) { threw = err; }
  check(!!threw && threw.code === 'KNL_INCOME_SCOPE_VALUES_REQUIRED', 'CASE 22. incomeScope.type=employees nhưng values rỗng -> reject KNL_INCOME_SCOPE_VALUES_REQUIRED');

  // CASE 23: income_view=true + incomeScope type=employees + values thật -> lưu/đọc lại đúng danh sách employee_code
  await grant('acc-income-specific', 'TRO_LY_GD', { access_knl: true, view_people: true, income_view: true, incomeScope: { type: 'employees', values: ['TBP-E1', 'TBP-E3'] } }, { type: 'all_company', values: [] }, 'Cấp Thu nhập cho đúng E1,E3');
  snap = await grantsSnapshot();
  check(JSON.stringify(grantOf(snap, 'acc-income-specific').capabilities.incomeScope.values.slice().sort()) === JSON.stringify(['TBP-E1', 'TBP-E3']), 'CASE 23. incomeScope.type=employees lưu/đọc lại đúng values=[TBP-E1,TBP-E3] bằng employee_code thật');

  // CASE 24: đổi specific -> all - danh sách specific cũ phải biến mất hẳn khỏi capabilities đã lưu (không sót lại để lỡ tham gia enforcement)
  await grant('acc-income-specific', 'TRO_LY_GD', { access_knl: true, view_people: true, income_view: true, incomeScope: { type: 'all_company', values: [] } }, { type: 'all_company', values: [] }, 'Đổi Thu nhập sang phạm vi Tất cả nhân sự');
  snap = await grantsSnapshot();
  check(grantOf(snap, 'acc-income-specific').capabilities.incomeScope.type === 'all_company' && grantOf(snap, 'acc-income-specific').capabilities.incomeScope.values.length === 0, 'CASE 24. Đổi specific -> all: incomeScope ghi đè hoàn toàn thành {type:all_company,values:[]} - danh sách E1,E3 cũ không còn tồn tại trong capabilities đã lưu');

  // CASE 25: tắt income_view -> incomeScope không còn được lưu (không rác/mồ côi cho lần bật lại sau)
  await grant('acc-income-specific', 'TRO_LY_GD', { access_knl: true, view_people: true, income_view: false }, { type: 'all_company', values: [] }, 'Tắt income_view');
  snap = await grantsSnapshot();
  check(grantOf(snap, 'acc-income-specific').capabilities.income_view === false && !grantOf(snap, 'acc-income-specific').capabilities.incomeScope, 'CASE 25. Tắt income_view -> incomeScope không còn trong capabilities đã lưu (full replace, không merge, không rác)');

  if (failures) {
    console.error('\n' + failures + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nALL PASS');
}

run().catch(err => { console.error('UNCAUGHT', err); process.exit(1); });
