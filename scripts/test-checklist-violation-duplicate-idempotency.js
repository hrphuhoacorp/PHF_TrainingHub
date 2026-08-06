'use strict';
/* Batch D1 - proves saveChecklistViolations() (lib/checklist-violations.js) tells
   apart TWO different things that were previously conflated:

   (a) idempotency KY THUAT: cung mot request_id gui lai (tuan tu hoac gan dong
       thoi) -> CHI 1 record, khong tao lai, khong chay side effect lan hai.
   (b) duplicate NGHIEP VU: hai request_id KHAC NHAU, du noi dung trung nhau
       (cung nhan vien/tieu chi/ngay/gio/dia diem/ghi chu, hoac hai nguoi ghi
       doc lap) -> PHAI duoc tao thanh 2 record doc lap. duplicate_fingerprint
       (sha256 theo noi dung) KHONG con duoc dung de chan insert nua - chi con
       la du lieu luu kem phuc vu audit/nhan "N lan trong ngay" sau nay.

   Day la file test THAT SU goi lib/checklist-violations.js (khong reimplement
   logic can chung minh). Mock Supabase la mot bang mutable that su co unique
   constraint tren request_id (mo phong dung ON CONFLICT (request_id) DO
   NOTHING cua Postgres) - neu code san xuat vo tinh dua fingerprint tro lai
   vai tro chan insert, hoac request_id khong con la duy nhat, test nay se fail
   thuc su, khong chi chay qua.

   Khong test lai permission/scope o day - da co scripts/test-checklist-violation-
   permission-scope.js goi dung requireViolationPermission() (ham saveChecklistViolations
   cung goi) qua toan bo 6 preset. File nay chi them 1 kiem tra nho (Phan H) de
   xac nhan batch permission van check TUNG DONG truoc khi cham DB, khong lap lai
   toan bo ma tran scope. */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const violationsPath = require.resolve('../lib/checklist-violations');

// ---------------------------------------------------------------------------
// Bang tinh (assignments/templates/late policy): read-only, dung lai dung kieu
// tableQuery() da co trong test-checklist-violation-permission-scope.js.
// ---------------------------------------------------------------------------
function staticTable(getRows) {
  const filters = [];
  let limitN = null, wantSingle = false;
  const q = {
    select() { return q; },
    eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
    neq(field, value) { filters.push(r => String(r[field]) !== String(value)); return q; },
    in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
    gte(field, value) { filters.push(r => r[field] != null && r[field] >= value); return q; },
    lte(field, value) { filters.push(r => r[field] != null && r[field] <= value); return q; },
    or() { return q; },
    order() { return q; },
    limit(n) { limitN = n; return q; },
    maybeSingle() { wantSingle = true; return q; },
    then(resolve, reject) {
      try {
        let matched = getRows().filter(r => filters.every(fn => fn(r)));
        if (wantSingle) { resolve({ data: matched[0] || null, error: null }); return; }
        if (limitN != null) matched = matched.slice(0, limitN);
        resolve({ data: matched, error: null });
      } catch (e) { (reject || (err => Promise.reject(err)))(e); }
    }
  };
  return q;
}

// ---------------------------------------------------------------------------
// Bang checklist_violation_records: MUTABLE, that su thuc hien unique
// constraint tren request_id (upsert onConflict:'request_id', ignoreDuplicates:
// true -> mo phong dung INSERT ... ON CONFLICT (request_id) DO NOTHING
// RETURNING *, tuc la CHI tra ve cac dong THAT SU moi insert trong LAN GOI NAY).
// ---------------------------------------------------------------------------
let VIOLATION_ROWS = [];
let seq = 1;
function violationsTable() {
  const filters = [];
  let mode = 'select';
  let upsertRows = null;
  let wantSingle = false;
  const q = {
    select() { return q; },
    eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
    neq(field, value) { filters.push(r => String(r[field]) !== String(value)); return q; },
    in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
    upsert(rows) { mode = 'upsert'; upsertRows = rows; return q; },
    maybeSingle() { wantSingle = true; return q; },
    then(resolve, reject) {
      try {
        if (mode === 'upsert') {
          const inserted = [];
          for (const row of upsertRows) {
            const conflicts = row.request_id != null && VIOLATION_ROWS.some(r => r.request_id === row.request_id);
            if (conflicts) continue; // ON CONFLICT (request_id) DO NOTHING
            const saved = { id: 'v' + (seq++), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), record_status: 'official', ...row };
            VIOLATION_ROWS.push(saved);
            inserted.push(saved);
          }
          resolve({ data: inserted, error: null });
          return;
        }
        const matched = VIOLATION_ROWS.filter(r => filters.every(fn => fn(r)));
        if (wantSingle) { resolve({ data: matched[0] || null, error: null }); return; }
        resolve({ data: matched, error: null });
      } catch (e) { (reject || (err => Promise.reject(err)))(e); }
    }
  };
  return q;
}

const ASSIGNMENTS = [
  { employee_id: 'ID-EMP101', employee_code: 'EMP101', employee_name: 'NV 101', department: 'Bán hàng', title: 'NVBH', branch: 'CN1', manager_id: '', manager_code: 'QL01', manager_name: 'QL01', employee_status: 'Đang làm việc', template_id: 'tpl1', template_version: '', effective_date: '2020-01-01', updated_at: '2020-01-01T00:00:00Z' },
  { employee_id: 'ID-EMP102', employee_code: 'EMP102', employee_name: 'NV 102', department: 'Bán hàng', title: 'NVBH', branch: 'CN1', manager_id: '', manager_code: 'QL01', manager_name: 'QL01', employee_status: 'Đang làm việc', template_id: 'tpl1', template_version: '', effective_date: '2020-01-01', updated_at: '2020-01-01T00:00:00Z' },
  { employee_id: 'ID-EMP103', employee_code: 'EMP103', employee_name: 'NV 103', department: 'Bán hàng', title: 'NVBH', branch: 'CN1', manager_id: '', manager_code: 'QL01', manager_name: 'QL01', employee_status: 'Đang làm việc', template_id: 'tpl1', template_version: '', effective_date: '2020-01-01', updated_at: '2020-01-01T00:00:00Z' },
  { employee_id: 'ID-EMP104', employee_code: 'EMP104', employee_name: 'NV 104', department: 'Bán hàng', title: 'NVBH', branch: 'CN1', manager_id: '', manager_code: 'QL01', manager_name: 'QL01', employee_status: 'Đang làm việc', template_id: 'tpl1', template_version: '', effective_date: '2020-01-01', updated_at: '2020-01-01T00:00:00Z' },
  { employee_id: 'ID-EMP105', employee_code: 'EMP105', employee_name: 'NV 105', department: 'Bán hàng', title: 'NVBH', branch: 'CN1', manager_id: '', manager_code: 'QL01', manager_name: 'QL01', employee_status: 'Đang làm việc', template_id: 'tpl1', template_version: '', effective_date: '2020-01-01', updated_at: '2020-01-01T00:00:00Z' },
  { employee_id: 'ID-EMP106', employee_code: 'EMP106', employee_name: 'NV 106', department: 'Bán hàng', title: 'NVBH', branch: 'CN1', manager_id: '', manager_code: 'QL01', manager_name: 'QL01', employee_status: 'Đang làm việc', template_id: 'tpl1', template_version: '', effective_date: '2020-01-01', updated_at: '2020-01-01T00:00:00Z' },
  { employee_id: 'ID-EMP107', employee_code: 'EMP107', employee_name: 'NV 107 (trong pham vi)', department: 'Bán hàng', title: 'NVBH', branch: 'CN1', manager_id: '', manager_code: 'QL01', manager_name: 'QL01', employee_status: 'Đang làm việc', template_id: 'tpl1', template_version: '', effective_date: '2020-01-01', updated_at: '2020-01-01T00:00:00Z' },
  { employee_id: 'ID-EMP108', employee_code: 'EMP108', employee_name: 'NV 108 (ngoai pham vi)', department: 'Kho', title: 'NVK', branch: 'CN2', manager_id: '', manager_code: 'QL02', manager_name: 'QL02', employee_status: 'Đang làm việc', template_id: 'tpl1', template_version: '', effective_date: '2020-01-01', updated_at: '2020-01-01T00:00:00Z' },
  { employee_id: 'ID-EMP109', employee_code: 'EMP109', employee_name: 'NV 109', department: 'Bán hàng', title: 'NVBH', branch: 'CN1', manager_id: '', manager_code: 'QL01', manager_name: 'QL01', employee_status: 'Đang làm việc', template_id: 'tpl1', template_version: '', effective_date: '2020-01-01', updated_at: '2020-01-01T00:00:00Z' }
];

const TEMPLATES = [
  { template_key: 'tpl1', name: 'Mẫu Bán hàng', status: 'active', template_type: 'sales' }
];
const TEMPLATE_VERSIONS = [
  {
    template_key: 'tpl1', version_no: 'v1', effective_date: '2020-01-01', created_at: '2020-01-01T00:00:00Z',
    definition: {
      groups: [{ children: [{ items: [
        { code: 'C1', content: 'Tiêu chí 1', factor: 1, points: 5 },
        { code: 'PHF-DITRE-01', content: 'Đi trễ so với giờ vào ca theo lịch', factor: 1, points: 0 }
      ] }] }]
    }
  }
];

const GRANTS = [
  {
    id: 'g-ql01', account_id: 'act-ql01', employee_code: 'QL01', preset_code: 'QUAN_LY_TRUC_TIEP',
    capabilities: { view_violations: true, record_violation: true, review_monthly: true, view_reports: true },
    view_scope: { type: 'direct_reports', values: [] }, review_scope: { type: 'direct_reports', values: [] }, record_scope: { type: 'direct_reports', values: [] },
    is_active: true, effective_from: '2020-01-01', effective_to: null, updated_at: '2026-01-01'
  }
];

require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true, exports: {
    createClient: () => ({
      from(table) {
        if (table === 'checklist_violation_records') return violationsTable();
        if (table === 'checklist_employee_assignments') return staticTable(() => ASSIGNMENTS);
        if (table === 'checklist_employee_assignment_history') return staticTable(() => []);
        if (table === 'checklist_templates') return staticTable(() => TEMPLATES);
        if (table === 'checklist_template_versions') return staticTable(() => TEMPLATE_VERSIONS);
        if (table === 'checklist_late_point_policies') return staticTable(() => []);
        if (table === 'checklist_permission_grants') return staticTable(() => GRANTS);
        if (table === 'checklist_system_settings') return staticTable(() => [{ setting_key: 'violation_mode', setting_value: 'production' }]);
        return staticTable(() => []);
      },
      rpc(name, args) {
        if (name === 'phf_mutate_checklist_violation') {
          return (async () => {
            const record = VIOLATION_ROWS.find(r => r.id === args.p_record_id);
            if (!record) return { data: { ok: false, message: 'not found', code: 'CHECKLIST_VIOLATION_NOT_FOUND' }, error: null };
            if (args.p_action === 'cancel') {
              record.record_status = 'cancelled';
              record.cancel_reason = args.p_reason || '';
              record.cancelled_by = args.p_actor_id || '';
              record.updated_at = new Date().toISOString();
              return { data: { ok: true, record }, error: null };
            }
            return { data: { ok: false, message: 'unsupported action in mock', code: 'CHECKLIST_MOCK_UNSUPPORTED' }, error: null };
          })();
        }
        return Promise.resolve({ data: null, error: new Error('RPC not mocked: ' + name) });
      }
    })
  }
};

const {
  saveChecklistViolations,
  cancelChecklistViolation
} = require(violationsPath);

const admin1 = { role: 'admin', account: { id: 'admin-1', name: 'Giám sát' } };
const admin2 = { role: 'admin', account: { id: 'admin-2', name: 'Trưởng ca' } };
const managerQl01 = { role: 'manager', account: { id: 'act-ql01', name: 'QL01' }, employeeCode: 'QL01' };

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}
async function expectFail(promise, expectedCode, label) {
  try { await promise; check(false, label + ' (khong throw nhu ky vong, muon code=' + expectedCode + ')'); }
  catch (e) { check(e && e.code === expectedCode, label + ' (ky vong code=' + expectedCode + ', got ' + (e && e.code) + ')'); }
}
function row(overrides) {
  return Object.assign({
    employeeCode: 'EMP101', criterionCode: 'C1', occurredDate: '2026-08-06',
    occurredTime: '09:00', location: 'CN1', note: 'Ghi nhận lỗi kiểm thử D1'
  }, overrides);
}
function countFor(employeeCode) { return VIOLATION_ROWS.filter(r => r.employee_code === employeeCode).length; }
function activeCountFor(employeeCode) { return VIOLATION_ROWS.filter(r => r.employee_code === employeeCode && r.record_status !== 'cancelled').length; }

async function run() {
  console.log('== 1. Retry cung request_id TUAN TU -> chi 1 record ==');
  const r1a = await saveChecklistViolations(admin1, [row({ employeeCode: 'EMP101', requestId: 'REQ-101-A' })]);
  check(r1a.saved === 1 && r1a.savedRows[0].isNew === true, '1. Lan dau: saved=1, isNew=true');
  const idFirst = r1a.savedRows[0].id;
  const r1b = await saveChecklistViolations(admin1, [row({ employeeCode: 'EMP101', requestId: 'REQ-101-A' })]);
  check(r1b.saved === 1 && r1b.savedRows[0].isNew === false, '1. Retry tuan tu cung request_id: saved=1 (idempotent), isNew=false (khong phai ban ghi moi)');
  check(r1b.savedRows[0].id === idFirst, '1. Retry tra ve DUNG id cua ban ghi da tao (khong tao ban ghi thu 2, evidence se khong bi gan nham record)');
  check(countFor('EMP101') === 1, '1. Tong so record EMP101 trong DB van la 1 sau retry');

  console.log('== 2. Retry cung request_id GAN DONG THOI (concurrent) -> chi 1 record, khong 500 ==');
  const [r2a, r2b] = await Promise.all([
    saveChecklistViolations(admin1, [row({ employeeCode: 'EMP102', requestId: 'REQ-102-CONCURRENT' })]),
    saveChecklistViolations(admin2, [row({ employeeCode: 'EMP102', requestId: 'REQ-102-CONCURRENT' })])
  ]);
  const newFlags = [r2a.savedRows[0].isNew, r2b.savedRows[0].isNew];
  check(newFlags.filter(Boolean).length === 1, '2. Concurrent cung request_id: DUNG 1 trong 2 request duoc danh dau isNew=true (nguoi thang), con lai isNew=false');
  check(r2a.savedRows[0].id === r2b.savedRows[0].id, '2. Ca 2 request concurrent tra ve CUNG mot id ban ghi (khong tao 2 ban ghi, khong loi 500 do unique violation khong duoc xu ly)');
  check(countFor('EMP102') === 1, '2. Tong so record EMP102 trong DB van la 1 sau 2 request concurrent');

  console.log('== 3. Hai request_id KHAC NHAU, NOI DUNG GIONG HET (hai nguoi ghi doc lap) -> 2 record ==');
  const sameContent = { employeeCode: 'EMP103', criterionCode: 'C1', occurredDate: '2026-08-06', occurredTime: '10:00', location: 'CN1', note: 'Trung noi dung nhung la 2 lan ghi nhan khac nhau' };
  const r3a = await saveChecklistViolations(admin1, [row({ ...sameContent, requestId: 'REQ-103-GIAMSAT' })]);
  const r3b = await saveChecklistViolations(admin2, [row({ ...sameContent, requestId: 'REQ-103-TRUONGCA' })]);
  check(r3a.saved === 1 && r3b.saved === 1 && r3a.savedRows[0].isNew === true && r3b.savedRows[0].isNew === true, '3. Ca 2 lan ghi (request_id khac nhau) deu duoc tao moi (isNew=true), KHONG bi CHECKLIST_DUPLICATE_BLOCKED du fingerprint noi dung giong het nhau');
  check(r3a.savedRows[0].id !== r3b.savedRows[0].id, '3. Hai record co id KHAC NHAU - la 2 ban ghi doc lap thuc su, khong phai 1 ban ghi bi doc lai 2 lan');
  check(countFor('EMP103') === 2, '3. Case 3/4 (Giam sat + Truong ca cung ghi, noi dung trung): DUNG 2 record trong DB, khong bi fingerprint chan/skip');

  console.log('== 6. Sang/chieu cung ngay, cung tieu chi, KHAC gio -> 2 record, 2 lan tru diem ==');
  const r6a = await saveChecklistViolations(admin1, [row({ employeeCode: 'EMP104', occurredTime: '08:15', note: 'Loi buoi sang', requestId: 'REQ-104-SANG' })]);
  const r6b = await saveChecklistViolations(admin1, [row({ employeeCode: 'EMP104', occurredTime: '14:30', note: 'Loi buoi chieu', requestId: 'REQ-104-CHIEU' })]);
  check(r6a.saved === 1 && r6b.saved === 1, '6. Ca lan sang va lan chieu deu duoc tao thanh cong');
  check(countFor('EMP104') === 2, '6. EMP104 co 2 record doc lap (sang + chieu) trong DB, moi record giu nguyen points rieng cho tinh tong diem tru sau nay');

  console.log('== 7b. Huy 1 trong 2 record doc lap -> CHI record do hoan diem, record kia giu nguyen ==');
  await cancelChecklistViolation(admin1, { id: r6a.savedRows[0].id, reason: 'Huy de kiem thu D1 - qua thoi han' });
  check(VIOLATION_ROWS.find(r => r.id === r6a.savedRows[0].id).record_status === 'cancelled', '7b. Record buoi sang (r6a) da chuyen sang cancelled');
  check(VIOLATION_ROWS.find(r => r.id === r6b.savedRows[0].id).record_status === 'official', '7b. Record buoi chieu (r6b, doc lap) KHONG bi anh huong boi viec huy record kia');
  check(activeCountFor('EMP104') === 1, '7b. EMP104 chi con 1 record active (buoi chieu) sau khi huy 1 record - hoan diem dung 1 phan, khong dung ca 2');

  console.log('== 7. Hai insert doc lap gan dong thoi (request_id KHAC nhau) -> ca 2 deu ton tai, khong mat ban ghi ==');
  const [r7a, r7b] = await Promise.all([
    saveChecklistViolations(admin1, [row({ employeeCode: 'EMP105', requestId: 'REQ-105-A', occurredTime: '09:00' })]),
    saveChecklistViolations(admin2, [row({ employeeCode: 'EMP105', requestId: 'REQ-105-B', occurredTime: '09:05' })])
  ]);
  check(r7a.savedRows[0].isNew === true && r7b.savedRows[0].isNew === true, '7. Ca 2 request concurrent (request_id khac nhau) deu duoc tao moi thanh cong');
  check(countFor('EMP105') === 2, '7. Khong mat ban ghi nao: ca 2 record deu co trong DB sau khi chay dong thoi (diem live sau nay se tinh du ca 2, vi checklistBreakdown() luon SUM lai tu dau tren toan bo record official, khong cong don tung buoc)');

  console.log('== 11. Batch co 2 dong CUNG request_id trong CUNG 1 lan goi (loi ky thuat frontend) -> chan ro, khong danh doan noi dung ==');
  await expectFail(
    saveChecklistViolations(admin1, [
      row({ employeeCode: 'EMP106', requestId: 'REQ-106-DUP' }),
      row({ employeeCode: 'EMP106', occurredTime: '15:00', note: 'Noi dung khac nhung request_id trung', requestId: 'REQ-106-DUP' })
    ]),
    'CHECKLIST_BATCH_REQUEST_ID_COLLISION',
    '11. Hai dong trong CUNG batch trung request_id (ky thuat, khong phai noi dung) bi chan ro truoc khi cham DB'
  );
  check(countFor('EMP106') === 0, '11. Batch bi chan hoan toan - khong dong nao duoc luu (atomic, khong luu mot phan)');

  console.log('== 12. Batch co 1 dong invalid -> ATOMIC, khong luu dong nao ==');
  await expectFail(
    saveChecklistViolations(admin1, [
      row({ employeeCode: 'EMP101', requestId: 'REQ-101-VALID-BUT-ATOMIC' }),
      row({ employeeCode: 'EMP101', note: '', requestId: 'REQ-101-INVALID' }) // note rong -> invalid
    ]),
    'CHECKLIST_VIOLATION_REQUIRED',
    '12. Dong 2 thieu note lam FAIL ca batch'
  );
  check(!VIOLATION_ROWS.some(r => r.request_id === 'REQ-101-VALID-BUT-ATOMIC'), '12. Dong 1 HOP LE trong batch KHONG bi luu du dong 2 loi (dung contract Atomic toan batch - mot dong loi thi khong luu dong nao)');

  console.log('== H. Batch permission check TUNG DONG, khong phai dong dau roi ap ca batch (bo tro cho test-checklist-violation-permission-scope.js) ==');
  await expectFail(
    saveChecklistViolations(managerQl01, [
      row({ employeeCode: 'EMP107', requestId: 'REQ-107-INSCOPE' }),
      row({ employeeCode: 'EMP108', requestId: 'REQ-108-OUTOFSCOPE' })
    ]),
    'CHECKLIST_VIOLATION_OUT_OF_SCOPE',
    'H. QL01 (direct_reports) gui batch gom 1 nhan vien trong scope + 1 ngoai scope -> CHAN ca batch, khong am tham bo qua dong ngoai scope'
  );
  check(countFor('EMP107') === 0 && countFor('EMP108') === 0, 'H. Khong dong nao trong batch duoc luu khi co 1 dong ngoai pham vi (permission check chay TRUOC khi cham DB, cho toan bo rows)');

  console.log('== 15. Di tre: retry cung request_id khong tao doi; hai lan di tre THAT khac nhau van duoc ghi ==');
  const lateRow = (overrides) => row(Object.assign({
    employeeCode: 'EMP109', criterionCode: 'PHF-DITRE-01', occurredTime: '00:00',
    note: '10 phút | Theo lịch', evidenceRequired: false
  }, overrides));
  const rLateA = await saveChecklistViolations(admin1, [lateRow({ requestId: 'REQ-109-LATE-DAY1' })]);
  check(rLateA.saved === 1 && rLateA.savedRows[0].isNew === true, '15. Di tre lan dau duoc ghi nhan');
  const rLateRetry = await saveChecklistViolations(admin1, [lateRow({ requestId: 'REQ-109-LATE-DAY1' })]);
  check(rLateRetry.savedRows[0].isNew === false && rLateRetry.savedRows[0].id === rLateA.savedRows[0].id, '15. Retry CUNG request_id Di tre KHONG tao ban ghi thu 2 (van la Admin-only, khong doi nghiep vu Di tre, chi chong retry ky thuat)');
  const rLateDay2 = await saveChecklistViolations(admin1, [lateRow({ requestId: 'REQ-109-LATE-DAY2' })]);
  check(rLateDay2.saved === 1 && rLateDay2.savedRows[0].isNew === true, '15. Lan Di tre THAT khac (request_id khac, du noi dung/gio giong het lan truoc vi Di tre luon occurred_time=00:00) van duoc ghi - khong bi fingerprint noi dung chan');
  check(countFor('EMP109') === 2, '15. EMP109 co dung 2 record Di tre doc lap trong DB (lan dau + lan thuc su thu hai), retry khong tinh vao');

  if (failures) {
    console.error('\n' + failures + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

run().catch(e => { console.error('UNEXPECTED ERROR', e); process.exit(1); });
