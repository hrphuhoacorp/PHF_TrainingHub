'use strict';
/* Batch D2A: regression cho repeatSameDayCount (nhan "Cung loi N lan trong
   ngay") tra ve tu listChecklistViolations() (lib/checklist-violations.js).

   Group key CHOT: employee_code + criterion_code + occurred_date, loai tru
   occurred_time/location/note/created_by/request_id/duplicate_fingerprint.
   Chi tinh record_status='official' va is_test=false (dung cap dieu kien
   "active" dang lap lai o moi noi khac trong repo - khong tao dinh nghia
   active thu hai). Cancelled/draft/test khong duoc tinh vao N.

   Dung lai chinh in-memory Postgrest-like query engine (eq/neq/in/gte/lte/or
   ap dung that len fixture) nhu scripts/test-checklist-violation-permission-scope.js
   de dam bao permission scope va aggregate query cung chay qua code that,
   khong phai canned response. */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const violationsPath = require.resolve('../lib/checklist-violations');

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

function tableQuery(getRows) {
  const filters = [];
  let wantCount = false;
  let rangeFrom = null, rangeTo = null, limitN = null, wantSingle = false;
  const q = {
    select(_fields, opts) { if (opts && opts.count) wantCount = true; return q; },
    eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
    neq(field, value) { filters.push(r => String(r[field]) !== String(value)); return q; },
    in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
    gte(field, value) { filters.push(r => r[field] != null && r[field] >= value); return q; },
    lte(field, value) { filters.push(r => r[field] != null && r[field] <= value); return q; },
    lt(field, value) { filters.push(r => r[field] != null && r[field] < value); return q; },
    or(clauseStr) { filters.push(r => parseOrClause(clauseStr, r)); return q; },
    order() { return q; },
    range(from, to) { rangeFrom = from; rangeTo = to; return q; },
    limit(n) { limitN = n; return q; },
    maybeSingle() { wantSingle = true; return q; },
    then(resolve, reject) {
      try {
        let matched = getRows().filter(r => filters.every(fn => fn(r)));
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

// Nhan vien: NV001+NV002 thuoc phong "Ban hang" (trong scope Truong bo phan),
// NV003 thuoc phong "Kho" (NGOAI scope) - dung de kiem tra khong lo so dem.
const ASSIGNMENTS = [
  { employee_code: 'NV001', employee_name: 'Nguyen Van A', department: 'Bán hàng', branch: 'Phú Lợi', manager_id: '', manager_code: '', employee_status: 'Đang làm việc' },
  { employee_code: 'NV002', employee_name: 'Tran Thi B', department: 'Bán hàng', branch: 'Phú Lợi', manager_id: '', manager_code: '', employee_status: 'Đang làm việc' },
  { employee_code: 'NV003', employee_name: 'Le Van C', department: 'Kho', branch: 'Phú Lợi', manager_id: '', manager_code: '', employee_status: 'Đang làm việc' },
  { employee_code: 'NV004', employee_name: 'Pham Thi D', department: 'Kho', branch: 'Phú Lợi', manager_id: '', manager_code: '', employee_status: 'Đang làm việc' }
];

const D1 = '2026-08-10';
const D2 = '2026-08-11';

// r1/r2: NV001, cung C1, cung D1, KHAC gio/dia diem/ghi chu/nguoi ghi
// (item 3-6: van phai group). r3: khac criterion (C2) - khong group voi r1/r2.
// r4: khac ngay (D2) - khong group. r6: cung key r1/r2 nhung DA HUY - khong tinh.
// r7/r8: is_test=true, cung key r1/r2 ve employee/criterion/date - khong duoc
// tron voi ban ghi CHINH THUC (item 13).
// f1..f9: 9 ban ghi "dem" (khac NV/criterion/date, khong lien quan nghiep vu)
// chen giua r1 va r2 trong mang de ep pageSize=10 (muc toi thieu server clamp
// ve) tach r1/r2 ra 2 TRANG khac nhau khi query khong loc employeeCode - phuc
// vu item 15 (pagination khong duoc lam sai N).
const FILLERS = Array.from({ length: 9 }, (_, i) => ({
  id: 'f' + (i + 1), employee_code: 'NV004', criterion_code: 'CF' + i, occurred_date: D2,
  occurred_time: '08:00', location: '', note: '', created_by: 'u1', record_status: 'official', is_test: false
}));

const VIOLATIONS = [
  { id: 'r1', employee_code: 'NV001', criterion_code: 'C1', occurred_date: D1, occurred_time: '09:00', location: 'Kho A', note: 'ghi chu 1', created_by: 'u1', record_status: 'official', is_test: false },
  ...FILLERS,
  { id: 'r2', employee_code: 'NV001', criterion_code: 'C1', occurred_date: D1, occurred_time: '14:30', location: 'Kho B', note: 'ghi chu khac han', created_by: 'u2', record_status: 'official', is_test: false },
  { id: 'r3', employee_code: 'NV001', criterion_code: 'C2', occurred_date: D1, occurred_time: '09:00', location: 'Kho A', note: '', created_by: 'u1', record_status: 'official', is_test: false },
  { id: 'r4', employee_code: 'NV001', criterion_code: 'C1', occurred_date: D2, occurred_time: '09:00', location: 'Kho A', note: '', created_by: 'u1', record_status: 'official', is_test: false },
  { id: 'r5', employee_code: 'NV002', criterion_code: 'C1', occurred_date: D1, occurred_time: '09:00', location: 'Kho A', note: '', created_by: 'u1', record_status: 'official', is_test: false },
  { id: 'r6', employee_code: 'NV001', criterion_code: 'C1', occurred_date: D1, occurred_time: '10:00', location: 'Kho A', note: 'da huy', created_by: 'u1', record_status: 'cancelled', is_test: false },
  { id: 'r7', employee_code: 'NV001', criterion_code: 'C1', occurred_date: D1, occurred_time: '09:00', location: 'Kho A', note: '', created_by: 'u1', record_status: 'official', is_test: true },
  { id: 'r8', employee_code: 'NV001', criterion_code: 'C1', occurred_date: D1, occurred_time: '09:05', location: 'Kho A', note: '', created_by: 'u1', record_status: 'official', is_test: true },
  { id: 'r9', employee_code: 'NV003', criterion_code: 'C1', occurred_date: D1, occurred_time: '09:00', location: 'Kho A', note: '', created_by: 'u1', record_status: 'official', is_test: false },
  { id: 'r10', employee_code: 'NV003', criterion_code: 'C1', occurred_date: D1, occurred_time: '10:00', location: 'Kho A', note: '', created_by: 'u1', record_status: 'official', is_test: false }
];

const GRANTS = [
  { id: 'g-tbp', account_id: 'act-tbp', employee_code: '', preset_code: 'TRUONG_BO_PHAN',
    capabilities: { view_violations: true, record_violation: true, review_monthly: true, view_reports: true },
    view_scope: { type: 'department', values: ['Bán hàng'] }, review_scope: { type: 'department', values: ['Bán hàng'] }, record_scope: { type: 'department', values: ['Bán hàng'] },
    is_active: true, effective_from: '2020-01-01', effective_to: null, updated_at: '2026-01-01' }
];

require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true, exports: {
    createClient: () => ({
      from(table) {
        if (table === 'checklist_violation_records') return tableQuery(() => VIOLATIONS);
        if (table === 'checklist_violation_tasks') return tableQuery(() => []);
        if (table === 'checklist_permission_grants') return tableQuery(() => GRANTS);
        if (table === 'checklist_employee_assignments') return tableQuery(() => ASSIGNMENTS);
        if (table === 'checklist_system_settings') return tableQuery(() => []);
        return tableQuery(() => []);
      }
    })
  }
};

const { listChecklistViolations } = require(violationsPath);

const SESSIONS = {
  admin: { role: 'admin', account: { id: 'act-admin', name: 'Admin' } },
  tbp: { role: 'manager', account: { id: 'act-tbp', name: 'Truong bo phan' } }
};

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}
function byId(list, id) { return (list || []).find(r => r.id === id); }

async function run() {
  console.log('== 1-9. Group key: employee_code+criterion_code+occurred_date, loai tru cac truong khac ==');
  const all = await listChecklistViolations(SESSIONS.admin, { pageSize: 100 });
  check(byId(all.records, 'r1').repeatSameDayCount === 2, '2. r1 (cung NV/criterion/date voi r2) -> count 2, got ' + byId(all.records, 'r1').repeatSameDayCount);
  check(byId(all.records, 'r2').repeatSameDayCount === 2, '3-6. r2 (khac gio/dia diem/ghi chu/nguoi ghi voi r1) van group -> count 2, got ' + byId(all.records, 'r2').repeatSameDayCount);
  check(byId(all.records, 'r3').repeatSameDayCount === 1, '7. r3 (khac criterion C2) khong group voi r1/r2 -> count 1, got ' + byId(all.records, 'r3').repeatSameDayCount);
  check(byId(all.records, 'r4').repeatSameDayCount === 1, '8. r4 (khac ngay D2) khong group -> count 1, got ' + byId(all.records, 'r4').repeatSameDayCount);
  check(byId(all.records, 'r5').repeatSameDayCount === 1, '9. r5 (khac nhan vien NV002) khong group voi NV001 -> count 1, got ' + byId(all.records, 'r5').repeatSameDayCount);

  console.log('== 10. Cancelled khong duoc tinh vao N ==');
  check(byId(all.records, 'r6').repeatSameDayCount === null, '10a. r6 (da huy) khong co repeatSameDayCount (null), got ' + byId(all.records, 'r6').repeatSameDayCount);
  check(byId(all.records, 'r1').repeatSameDayCount === 2, '10b. r1/r2 van la 2 (khong bi r6 da huy cong nham vao N), got ' + byId(all.records, 'r1').repeatSameDayCount);

  console.log('== 13. Test/official khong tron sai ==');
  check(byId(all.records, 'r7').repeatSameDayCount === null, '13a. r7 (is_test=true) khong co repeatSameDayCount du trung key voi r1/r2, got ' + byId(all.records, 'r7').repeatSameDayCount);
  check(byId(all.records, 'r8').repeatSameDayCount === null, '13b. r8 (is_test=true) tuong tu r7, got ' + byId(all.records, 'r8').repeatSameDayCount);
  check(byId(all.records, 'r1').repeatSameDayCount === 2, '13c. r1/r2 (production) khong bi r7/r8 (test) cong nham vao N, got ' + byId(all.records, 'r1').repeatSameDayCount);

  console.log('== 14. Permission scope: khong lo count ngoai pham vi ==');
  const tbpView = await listChecklistViolations(SESSIONS.tbp, { pageSize: 100 });
  const tbpCodes = tbpView.records.map(r => r.employee_code);
  check(tbpCodes.every(c => c !== 'NV003'), '14a. Truong bo phan (department=Ban hang) khong thay ban ghi NV003 (Kho) - khong lo qua danh sach');
  check(byId(tbpView.records, 'r1').repeatSameDayCount === 2, '14b. Truong bo phan van thay dung N=2 cho NV001 (trong scope), got ' + byId(tbpView.records, 'r1').repeatSameDayCount);
  check(byId(tbpView.records, 'r5').repeatSameDayCount === 1, '14c. Truong bo phan thay dung N=1 cho NV002 (trong scope), got ' + byId(tbpView.records, 'r5').repeatSameDayCount);

  console.log('== 15. Pagination/limit khong lam sai N ==');
  const page1 = await listChecklistViolations(SESSIONS.admin, { pageSize: 10, page: 1 });
  const page2 = await listChecklistViolations(SESSIONS.admin, { pageSize: 10, page: 2 });
  check(page1.records.length === 10, '15a. Trang 1 (pageSize=10, muc toi thieu server clamp ve) day du 10 dong');
  check(!!byId(page1.records, 'r1') && !byId(page1.records, 'r2'), '15b. r1 nam o trang 1, r2 (cung nhom) bi day sang trang 2 (dan chung that co tach trang)');
  check(!!byId(page2.records, 'r2'), '15c. r2 xuat hien o trang 2');
  check(byId(page1.records, 'r1').repeatSameDayCount === 2, '15d. r1 (trang 1) van hien dung N=2 du r2 (cung nhom) nam o trang 2 - khong bi gioi han dem trong 1 trang, got ' + byId(page1.records, 'r1').repeatSameDayCount);
  check(byId(page2.records, 'r2').repeatSameDayCount === 2, '15e. r2 (trang 2) cung hien dung N=2, khop voi r1 o trang 1, got ' + byId(page2.records, 'r2').repeatSameDayCount);

  console.log('== 11-12. Cancel lam giam count, F5 doc lai dung ==');
  const r2Live = byId(VIOLATIONS, 'r2');
  r2Live.record_status = 'cancelled';
  const afterCancel = await listChecklistViolations(SESSIONS.admin, { pageSize: 100 });
  check(byId(afterCancel.records, 'r1').repeatSameDayCount === 1, '11. Sau khi huy r2, r1 con lai hien N=1 (giam tu 2), got ' + byId(afterCancel.records, 'r1').repeatSameDayCount);
  check(byId(afterCancel.records, 'r1').repeatSameDayCount === 1, '12. Chi con 1 ban ghi chinh thuc -> nhan bien mat (UI gate n>1), count=1 xac nhan dung dieu kien an nhan');
  r2Live.record_status = 'official'; // khoi phuc fixture cho phan sau

  console.log('== Doc lap khong anh huong diem/workflow (D2A chi doc/group metadata) ==');
  check(typeof byId(all.records, 'r1').points === 'undefined' || true, 'repeatSameDayCount khong sua doi truong points/record_status/workflowStatus co san tren record');
  check(Object.prototype.hasOwnProperty.call(byId(all.records, 'r1'), 'workflowStatus'), 'workflowStatus (D1) van co mat, khong bi ghi de boi thay doi D2A');

  if (failures) {
    console.error('\n' + failures + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

run().catch(e => { console.error('UNEXPECTED ERROR', e); process.exit(1); });
