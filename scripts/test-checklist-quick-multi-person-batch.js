'use strict';
/* Batch UX-QMP (backend gap fix) - proves 2 thu:

   (1) normalizeCanonical() (lib/checklist-violations.js) gan them {index,
       requestId} vao error.details cho MOI fail() ben trong ham, de client
       "Ghi nhan nhanh nhieu nhan vien" biet CHINH XAC dong nao trong batch
       that bai - ma loi/message/statusCode cua tung fail() KHONG doi (cac
       test D1/permission-scope da co van phai tiep tuc pass nguyen ven,
       chay lai o cuoi file nay bang cach goi lai chinh 2 file do qua
       require - khong, KHONG lam vay o day; su khong doi cua chung duoc
       dam bao boi viec chinh test-checklist-violation-duplicate-idempotency.js
       va test-checklist-violation-permission-scope.js van pass khi chay
       rieng - xem README trong PR/commit message. File nay chi kiem tra
       hanh vi MOI: chi tiet details.index/details.requestId).
   (2) publicError() (lib/request-guard.js) truyen tiep err.details ra
       response cho client KHI VA CHI KHI no ton tai - test truc tiep bang
       cach goi publicError() voi 1 loi co .details va 1 loi khong co, xac
       nhan field 'details' co mat/vang mat dung nhu ky vong (JSON.stringify
       tu drop field undefined).

   Dong thoi dung lam bo test backend cho tinh nang "Ghi nhan nhanh nhieu
   nhan vien" (UI o assets/js/checklist/phf-checklist-app.js) - chung minh
   BACKEND da san sang nhan 1 batch nhieu nhan vien khac nhau qua dung
   action 'saveChecklistViolations' hien co (khong co API action moi nao),
   dung mo hinh in-memory Supabase mock nhu 2 file D1 da dan chieu o tren
   (mutable table + upsert onConflict request_id, ket hop them
   select(fields,{count:'exact'})/range()/or() nhu test-checklist-violation-
   repeat-same-day.js de goi duoc ca listChecklistViolations cho phan D2A). */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const violationsPath = require.resolve('../lib/checklist-violations');
const requestGuardPath = require.resolve('../lib/request-guard');

// ---------------------------------------------------------------------------
// Bang tinh (assignments/templates/grants...): read-only.
// ---------------------------------------------------------------------------
function parseOrClause(clauseStr, row) {
  const clauses = String(clauseStr || '').split(',').map(c => c.trim()).filter(Boolean);
  return clauses.some(clause => {
    const m = clause.match(/^([a-zA-Z0-9_]+)\.(eq|is|gte|lte|neq)\.(.*)$/);
    if (!m) return false;
    const [, field, op, rawVal] = m;
    const rowVal = row[field];
    if (op === 'is') return rawVal === 'null' ? (rowVal === null || rowVal === undefined || rowVal === '') : String(rowVal) === rawVal;
    if (op === 'eq') return String(rowVal) === rawVal;
    if (op === 'neq') return String(rowVal) !== rawVal;
    if (op === 'gte') return rowVal != null && String(rowVal) >= rawVal;
    if (op === 'lte') return rowVal != null && String(rowVal) <= rawVal;
    return false;
  });
}
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
    or(clauseStr) { filters.push(r => parseOrClause(clauseStr, r)); return q; },
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
// Bang checklist_violation_records: MUTABLE - ket hop dung upsert onConflict
// (D1) + select(fields,{count})/range (D2A) de vua goi duoc saveChecklistViolations
// vua goi duoc listChecklistViolations (D2A regression) tren cung 1 fixture.
// ---------------------------------------------------------------------------
let VIOLATION_ROWS = [];
let seq = 1;
function violationsTable() {
  const filters = [];
  let mode = 'select';
  let upsertRows = null;
  let wantCount = false;
  let rangeFrom = null, rangeTo = null, limitN = null, wantSingle = false;
  const q = {
    select(_fields, opts) { if (opts && opts.count) wantCount = true; return q; },
    eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
    neq(field, value) { filters.push(r => String(r[field]) !== String(value)); return q; },
    in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
    gte(field, value) { filters.push(r => r[field] != null && r[field] >= value); return q; },
    lte(field, value) { filters.push(r => r[field] != null && r[field] <= value); return q; },
    or(clauseStr) { filters.push(r => parseOrClause(clauseStr, r)); return q; },
    order() { return q; },
    range(from, to) { rangeFrom = from; rangeTo = to; return q; },
    limit(n) { limitN = n; return q; },
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
        let matched = VIOLATION_ROWS.filter(r => filters.every(fn => fn(r)));
        const count = wantCount ? matched.length : null;
        if (wantSingle) { resolve({ data: matched[0] || null, error: null }); return; }
        if (rangeFrom != null) matched = matched.slice(rangeFrom, rangeTo + 1);
        else if (limitN != null) matched = matched.slice(0, limitN);
        resolve({ data: matched, error: null, count });
      } catch (e) { (reject || (err => Promise.reject(err)))(e); }
    }
  };
  return q;
}

// EMP201/EMP202/EMP203 deu thuoc "Ban hang", manager_code=QL01 (trong scope
// direct_reports cua QL01). EMP299 thuoc "Kho", manager_code=QL02 (NGOAI
// scope QL01) - dung cho test out-of-scope. EMP203 gan template tpl2 (chi co
// tieu chi C2) - khac tpl1 (chi co C1) cua EMP201/EMP202/EMP299 - dung cho
// test "tieu chi cua nhan vien A bi tu choi khi gui cho nhan vien B".
const ASSIGNMENTS = [
  { employee_id: 'ID-EMP201', employee_code: 'EMP201', employee_name: 'NV 201', department: 'Bán hàng', title: 'NVBH', branch: 'CN1', manager_id: '', manager_code: 'QL01', manager_name: 'QL01', employee_status: 'Đang làm việc', template_id: 'tpl1', template_version: '', effective_date: '2020-01-01', updated_at: '2020-01-01T00:00:00Z' },
  { employee_id: 'ID-EMP202', employee_code: 'EMP202', employee_name: 'NV 202', department: 'Bán hàng', title: 'NVBH', branch: 'CN1', manager_id: '', manager_code: 'QL01', manager_name: 'QL01', employee_status: 'Đang làm việc', template_id: 'tpl1', template_version: '', effective_date: '2020-01-01', updated_at: '2020-01-01T00:00:00Z' },
  { employee_id: 'ID-EMP203', employee_code: 'EMP203', employee_name: 'NV 203 (mau khac)', department: 'Bán hàng', title: 'NVBH', branch: 'CN1', manager_id: '', manager_code: 'QL01', manager_name: 'QL01', employee_status: 'Đang làm việc', template_id: 'tpl2', template_version: '', effective_date: '2020-01-01', updated_at: '2020-01-01T00:00:00Z' },
  { employee_id: 'ID-EMP299', employee_code: 'EMP299', employee_name: 'NV 299 (ngoai pham vi QL01)', department: 'Kho', title: 'NVK', branch: 'CN2', manager_id: '', manager_code: 'QL02', manager_name: 'QL02', employee_status: 'Đang làm việc', template_id: 'tpl1', template_version: '', effective_date: '2020-01-01', updated_at: '2020-01-01T00:00:00Z' }
];

const TEMPLATES = [
  { template_key: 'tpl1', name: 'Mẫu Bán hàng', status: 'active', template_type: 'sales' },
  { template_key: 'tpl2', name: 'Mẫu Bán hàng (khác)', status: 'active', template_type: 'sales' }
];
const TEMPLATE_VERSIONS = [
  {
    template_key: 'tpl1', version_no: 'v1', effective_date: '2020-01-01', created_at: '2020-01-01T00:00:00Z',
    definition: { groups: [{ children: [{ items: [{ code: 'C1', content: 'Tiêu chí 1', factor: 1, points: 5 }] }] }] }
  },
  {
    template_key: 'tpl2', version_no: 'v1', effective_date: '2020-01-01', created_at: '2020-01-01T00:00:00Z',
    definition: { groups: [{ children: [{ items: [{ code: 'C2', content: 'Tiêu chí 2', factor: 1, points: 3 }] }] }] }
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
        if (table === 'checklist_violation_tasks') return staticTable(() => []);
        if (table === 'checklist_employee_assignments') return staticTable(() => ASSIGNMENTS);
        if (table === 'checklist_employee_assignment_history') return staticTable(() => []);
        if (table === 'checklist_templates') return staticTable(() => TEMPLATES);
        if (table === 'checklist_template_versions') return staticTable(() => TEMPLATE_VERSIONS);
        if (table === 'checklist_late_point_policies') return staticTable(() => []);
        if (table === 'checklist_permission_grants') return staticTable(() => GRANTS);
        if (table === 'checklist_system_settings') return staticTable(() => [{ setting_key: 'violation_mode', setting_value: 'production' }]);
        return staticTable(() => []);
      }
    })
  }
};

const { saveChecklistViolations, listChecklistViolations } = require(violationsPath);
const { publicError } = require(requestGuardPath);

const admin1 = { role: 'admin', account: { id: 'admin-1', name: 'Giám sát' } };
const managerQl01 = { role: 'manager', account: { id: 'act-ql01', name: 'QL01' }, employeeCode: 'QL01' };

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}
async function expectFail(promise, expectedCode, label) {
  try { const r = await promise; check(false, label + ' (khong throw nhu ky vong, muon code=' + expectedCode + ', got saved=' + JSON.stringify(r)); return null; }
  catch (e) { check(e && e.code === expectedCode, label + ' (ky vong code=' + expectedCode + ', got ' + (e && e.code) + ')'); return e; }
}
function row(overrides) {
  return Object.assign({
    employeeCode: 'EMP201', criterionCode: 'C1', occurredDate: '2026-08-06',
    occurredTime: '09:00', location: 'CN1', note: 'Ghi nhận lỗi kiểm thử QMP'
  }, overrides);
}
function countFor(employeeCode) { return VIOLATION_ROWS.filter(r => r.employee_code === employeeCode).length; }
// Mo phong DUNG logic dedup nguoi nhan thong bao that su dung trong
// api/data.js (recipients = Set cua employeeCode cac row isNew===true) - xem
// dong 330-331 cua file do. Khong sua/goi lai api/data.js (ngoai pham vi
// batch nay), chi doi chieu cung cong thuc tren savedRows tra ve tu
// saveChecklistViolations() de chung minh isNew van phan anh dung "moi hay
// da ton tai truoc" khi batch gom NHIEU nhan vien khac nhau.
function notificationRecipients(savedRows) {
  return [...new Set((savedRows || []).filter(r => r.isNew === true).map(r => String(r.employeeCode || '').toUpperCase()).filter(Boolean))];
}

async function run() {
  console.log('== QMP-1. Hai nhan vien KHAC NHAU trong 1 batch -> ca 2 luu thanh cong doc lap ==');
  const r1 = await saveChecklistViolations(admin1, [
    row({ employeeCode: 'EMP201', requestId: 'QMP-201-A' }),
    row({ employeeCode: 'EMP202', requestId: 'QMP-202-A' })
  ]);
  check(r1.saved === 2, 'QMP-1. saved=2, got ' + r1.saved);
  check(r1.savedRows.every(r => r.isNew === true), 'QMP-1. Ca 2 dong deu isNew=true (lan dau)');
  check(r1.savedRows[0].employeeCode === 'EMP201' && r1.savedRows[1].employeeCode === 'EMP202', 'QMP-1. savedRows giu dung employeeCode tung dong (khong hoan vi/tron nhan vien)');
  check(countFor('EMP201') === 1 && countFor('EMP202') === 1, 'QMP-1. Moi nhan vien co dung 1 record trong DB');
  check(notificationRecipients(r1.savedRows).sort().join(',') === 'EMP201,EMP202', 'QMP-1. Danh sach nguoi nhan thong bao (dedup theo isNew) gom dung 2 nhan vien, got ' + notificationRecipients(r1.savedRows).join(','));

  console.log('== QMP-2. CUNG 1 nhan vien xuat hien nhieu dong (nhieu request_id khac nhau) -> tat ca luu doc lap ==');
  const r2 = await saveChecklistViolations(admin1, [
    row({ employeeCode: 'EMP201', requestId: 'QMP-201-B1', occurredTime: '08:00', note: 'Lan 1 trong ngay khac' }),
    row({ employeeCode: 'EMP201', requestId: 'QMP-201-B2', occurredTime: '13:00', note: 'Lan 2 trong ngay khac' })
  ]);
  check(r2.saved === 2 && r2.savedRows.every(r => r.isNew === true), 'QMP-2. Ca 2 dong CUNG nhan vien EMP201 deu duoc luu doc lap (isNew=true), got saved=' + r2.saved);
  check(countFor('EMP201') === 3, 'QMP-2. EMP201 co tong 3 record (1 tu QMP-1 + 2 tu QMP-2)');
  check(notificationRecipients(r2.savedRows).length === 1 && notificationRecipients(r2.savedRows)[0] === 'EMP201', 'QMP-2. Dedup nguoi nhan CHI con 1 EMP201 du 2 dong trung nhan vien (khong gui thong bao trung 2 lan cho cung 1 nguoi trong 1 batch)');

  console.log('== QMP-3. Batch co 1 nhan vien NGOAI pham vi -> chan CA batch (0 dong duoc luu), giu nguyen ma loi cu ==');
  const beforeCount201 = countFor('EMP201');
  const errScope = await expectFail(
    saveChecklistViolations(managerQl01, [
      row({ employeeCode: 'EMP202', requestId: 'QMP-SCOPE-INSCOPE' }),
      row({ employeeCode: 'EMP299', requestId: 'QMP-SCOPE-OUTOFSCOPE' })
    ]),
    'CHECKLIST_VIOLATION_OUT_OF_SCOPE',
    'QMP-3. QL01 gui batch gom 1 trong scope + 1 ngoai scope (EMP299) -> CHAN ca batch'
  );
  check(!VIOLATION_ROWS.some(r => r.request_id === 'QMP-SCOPE-INSCOPE' || r.request_id === 'QMP-SCOPE-OUTOFSCOPE'), 'QMP-3. Khong dong nao (ke ca dong trong scope) duoc luu - atomic cho ca batch');
  check(countFor('EMP201') === beforeCount201, 'QMP-3. So record EMP201 khong doi (khong co side-effect ngoai y muon tu batch bi chan)');
  check(errScope && errScope.details && errScope.details.employeeCode === 'EMP299', 'QMP-3. Loi OUT_OF_SCOPE van giu dung shape details.employeeCode nhu truoc (requireViolationPermission KHONG bi dong nay), got ' + JSON.stringify(errScope && errScope.details));

  console.log('== QMP-4. Tieu chi cua mau nhan vien A bi tu choi khi gui cho nhan vien B (khac mau) -> CHECKLIST_CRITERION_NOT_IN_EFFECTIVE_TEMPLATE, details.index dung dong loi ==');
  const errCriterion = await expectFail(
    saveChecklistViolations(admin1, [
      row({ employeeCode: 'EMP201', criterionCode: 'C1', requestId: 'QMP-CRIT-VALID-0' }), // dong 0: hop le (C1 thuoc tpl1 cua EMP201)
      row({ employeeCode: 'EMP203', criterionCode: 'C1', requestId: 'QMP-CRIT-INVALID-1' }) // dong 1: C1 KHONG thuoc tpl2 cua EMP203 (EMP203 chi co C2)
    ]),
    'CHECKLIST_CRITERION_NOT_IN_EFFECTIVE_TEMPLATE',
    'QMP-4. C1 (thuoc tpl1/EMP201) bi tu choi khi gui cho EMP203 (tpl2, chi co C2)'
  );
  check(errCriterion && errCriterion.details && errCriterion.details.index === 1, 'QMP-4. details.index === 1 (dong thu 2, dung vi tri gay loi trong batch), got ' + JSON.stringify(errCriterion && errCriterion.details));
  check(errCriterion && errCriterion.details && errCriterion.details.requestId === 'QMP-CRIT-INVALID-1', 'QMP-4. details.requestId khop dung request_id CLIENT gui cho dong loi, got ' + JSON.stringify(errCriterion && errCriterion.details));
  check(!VIOLATION_ROWS.some(r => r.request_id === 'QMP-CRIT-VALID-0'), 'QMP-4. Dong 0 hop le KHONG duoc luu du dong 1 loi (atomic, khong luu mot phan)');

  console.log('== QMP-5. details.index dung vi tri o MOT ly do loi KHAC, o vi tri KHAC (index=2) ==');
  const errNote = await expectFail(
    saveChecklistViolations(admin1, [
      row({ employeeCode: 'EMP201', requestId: 'QMP-NOTE-VALID-0' }),
      row({ employeeCode: 'EMP202', requestId: 'QMP-NOTE-VALID-1' }),
      row({ employeeCode: 'EMP201', note: '', requestId: 'QMP-NOTE-INVALID-2' }) // dong 2: note rong
    ]),
    'CHECKLIST_VIOLATION_REQUIRED',
    'QMP-5. Dong thu 3 (index 2) thieu note lam FAIL ca batch, code CHECKLIST_VIOLATION_REQUIRED giu nguyen'
  );
  check(errNote && errNote.details && errNote.details.index === 2, 'QMP-5. details.index === 2 (dong 3, khac vi tri voi QMP-4), got ' + JSON.stringify(errNote && errNote.details));

  console.log('== QMP-6. Hai dong CUNG request_id trong 1 batch nhieu-nhan-vien -> CHECKLIST_BATCH_REQUEST_ID_COLLISION, 0 dong duoc luu ==');
  await expectFail(
    saveChecklistViolations(admin1, [
      row({ employeeCode: 'EMP201', requestId: 'QMP-DUP-ID' }),
      row({ employeeCode: 'EMP202', requestId: 'QMP-DUP-ID' }) // khac nhan vien nhung TRUNG request_id
    ]),
    'CHECKLIST_BATCH_REQUEST_ID_COLLISION',
    'QMP-6. Trung request_id giua 2 dong KHAC nhan vien van bi chan (ky thuat, khong phai theo noi dung/nhan vien)'
  );
  check(!VIOLATION_ROWS.some(r => r.request_id === 'QMP-DUP-ID'), 'QMP-6. Khong dong nao duoc luu');

  console.log('== QMP-7. Retry CA BATCH (nhieu nhan vien) voi request_id GIONG HET sau khi da thanh cong -> idempotent, khong tao trung, khong nhan dedup trung ==');
  const r7a = await saveChecklistViolations(admin1, [
    row({ employeeCode: 'EMP201', requestId: 'QMP-RETRY-201' }),
    row({ employeeCode: 'EMP202', requestId: 'QMP-RETRY-202' })
  ]);
  check(r7a.saved === 2 && r7a.savedRows.every(r => r.isNew === true), 'QMP-7. Lan dau: ca 2 dong isNew=true');
  const idsBefore = r7a.savedRows.map(r => r.id).sort();
  const countBefore201 = countFor('EMP201'), countBefore202 = countFor('EMP202');
  const r7b = await saveChecklistViolations(admin1, [
    row({ employeeCode: 'EMP201', requestId: 'QMP-RETRY-201' }),
    row({ employeeCode: 'EMP202', requestId: 'QMP-RETRY-202' })
  ]);
  check(r7b.saved === 2 && r7b.savedRows.every(r => r.isNew === false), 'QMP-7. Retry CUNG request_id (ca 2 dong) -> isNew=false ca 2 (khong phai ban ghi moi)');
  check(r7b.savedRows.map(r => r.id).sort().join(',') === idsBefore.join(','), 'QMP-7. Retry tra ve DUNG id cu cho tung dong (khong tao ban ghi thu 2, evidence se khong bi gan nham record)');
  check(countFor('EMP201') === countBefore201 && countFor('EMP202') === countBefore202, 'QMP-7. Khong co record moi nao duoc tao cho ca 2 nhan vien sau retry');
  check(notificationRecipients(r7b.savedRows).length === 0, 'QMP-7. Retry KHONG tao nguoi nhan thong bao nao (isNew=false het) - tranh gui trung thong bao "co loi moi" cho retry ky thuat');

  console.log('== QMP-8. D2A repeatSameDayCount van dung khi 2 dong CUNG employee+criterion+date nam trong CUNG 1 batch nhieu-nhan-vien ==');
  const r8 = await saveChecklistViolations(admin1, [
    row({ employeeCode: 'EMP202', criterionCode: 'C1', occurredDate: '2026-08-05', occurredTime: '08:00', note: 'D2A dong 1', requestId: 'QMP-D2A-1' }),
    row({ employeeCode: 'EMP202', criterionCode: 'C1', occurredDate: '2026-08-05', occurredTime: '15:00', note: 'D2A dong 2 (khac gio)', requestId: 'QMP-D2A-2' })
  ]);
  check(r8.saved === 2, 'QMP-8. Ca 2 dong D2A duoc luu');
  const listing = await listChecklistViolations(admin1, { pageSize: 100, requestIds: ['QMP-D2A-1', 'QMP-D2A-2'] });
  const rec1 = listing.records.find(r => r.request_id === 'QMP-D2A-1');
  const rec2 = listing.records.find(r => r.request_id === 'QMP-D2A-2');
  check(!!rec1 && !!rec2, 'QMP-8. Ca 2 record duoc doc lai qua listChecklistViolations(requestIds=[...])');
  check(rec1 && rec1.repeatSameDayCount === 2, 'QMP-8. Dong 1 co repeatSameDayCount=2 (nam trong 1 batch nhieu-nhan-vien, khong phai chi tinh dung khi tung batch 1-nhan-vien), got ' + (rec1 && rec1.repeatSameDayCount));
  check(rec2 && rec2.repeatSameDayCount === 2, 'QMP-8. Dong 2 cung co repeatSameDayCount=2, khop voi dong 1, got ' + (rec2 && rec2.repeatSameDayCount));

  console.log('== QMP-9. publicError() (lib/request-guard.js) truyen tiep details KHI CO, khong them field khi KHONG CO ==');
  const errWithDetails = new Error('Loi co details');
  errWithDetails.statusCode = 409;
  errWithDetails.code = 'CHECKLIST_CRITERION_NOT_IN_EFFECTIVE_TEMPLATE';
  errWithDetails.details = { index: 1, requestId: 'QMP-CRIT-INVALID-1' };
  const publicWithDetails = publicError(errWithDetails);
  check(publicWithDetails.status === 409, 'QMP-9. status giu nguyen 409 (khong bi anh huong boi details)');
  check(JSON.stringify(publicWithDetails.body.details) === JSON.stringify({ index: 1, requestId: 'QMP-CRIT-INVALID-1' }), 'QMP-9. body.details duoc truyen nguyen ven khi err.details ton tai, got ' + JSON.stringify(publicWithDetails.body));
  check(publicWithDetails.body.error === 'Loi co details' && publicWithDetails.body.code === 'CHECKLIST_CRITERION_NOT_IN_EFFECTIVE_TEMPLATE', 'QMP-9. error/code van giu dung nhu truoc (them details khong lam mat cac field co san)');

  const errNoDetails = new Error('Loi khong details');
  errNoDetails.statusCode = 400;
  errNoDetails.code = 'CHECKLIST_VIOLATION_REQUIRED';
  const publicNoDetails = publicError(errNoDetails);
  check(!Object.prototype.hasOwnProperty.call(publicNoDetails.body, 'details'), 'QMP-9. body KHONG co key "details" khi err.details khong duoc gan (moi loi khac trong toan bo app khong bi doi shape response) - keys=' + Object.keys(publicNoDetails.body).join(','));
  check(JSON.parse(JSON.stringify(publicNoDetails.body)).details === undefined, 'QMP-9. JSON.stringify cung tu drop field details vang mat (khong tra ve details:null gay nham cho client)');

  const err500 = new Error('Loi he thong');
  err500.statusCode = 500;
  err500.code = 'SOME_INTERNAL_CODE';
  err500.details = { shouldNotLeak: true };
  const public500 = publicError(err500);
  check(public500.status === 500 && public500.body.code === 'INTERNAL_ERROR' && !Object.prototype.hasOwnProperty.call(public500.body, 'details'), 'QMP-9. Loi 500 van giu nguyen hanh vi CU (message chung chung, code=INTERNAL_ERROR, KHONG lo details) - khong bi anh huong boi thay doi nay');

  if (failures) {
    console.error('\n' + failures + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

run().catch(e => { console.error('UNEXPECTED ERROR', e); process.exit(1); });
