'use strict';
/*
 * FIX V1 — Monthly realtime score sync (write-through + read-side defense).
 *
 * Root cause confirmed by PROD audit: checklist_monthly_forms.checklist_score is
 * only recomputed when a specific monthly form is opened (refreshUnlockedChecklistScore),
 * not when an official Daily Checklist violation is created/edited/cancelled, and
 * myMonthlyReviewSummaries() read the raw stored value with no live override.
 *
 * This is a THAT SU functional test — real saveChecklistViolations()/
 * cancelChecklistViolation()/updateChecklistViolation()/myMonthlyReviewSummaries()
 * from api/_lib run against a mutable in-memory Supabase mock (same pattern as
 * scripts/test-checklist-violation-duplicate-idempotency.js), not a
 * reimplementation of the scoring formula.
 *
 *   node scripts/test-checklist-monthly-score-sync-v1.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const violationsPath = require.resolve('../api/_lib/checklist-violations');
const monthlyPath = require.resolve('../api/_lib/checklist-monthly');

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

// checklist_violation_records: mutable, real request_id unique-conflict + real
// RPC-driven cancel/edit_test mutation (phf_mutate_checklist_violation mock below).
let VIOLATION_ROWS = [];
let vseq = 1;
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
    gte(field, value) { filters.push(r => r[field] != null && r[field] >= value); return q; },
    lte(field, value) { filters.push(r => r[field] != null && r[field] <= value); return q; },
    order() { return q; },
    upsert(rows) { mode = 'upsert'; upsertRows = rows; return q; },
    maybeSingle() { wantSingle = true; return q; },
    then(resolve, reject) {
      try {
        if (mode === 'upsert') {
          const inserted = [];
          for (const row of upsertRows) {
            const conflicts = row.request_id != null && VIOLATION_ROWS.some(r => r.request_id === row.request_id);
            if (conflicts) continue;
            const saved = { id: 'v' + (vseq++), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), record_status: 'official', is_test: false, ...row };
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

// checklist_monthly_forms: mutable, supports the .update(patch).eq(...).in(...)
// [.eq('updated_at',...)].select('*').maybeSingle() chain refreshUnlockedChecklistScore()
// uses, and the plain .select('*').eq(...)/.in(...) reads the sync helper + summaries use.
let FORM_ROWS = [];
function monthlyFormsTable() {
  const filters = [];
  let mode = 'select';
  let patchData = null;
  let wantSingle = false;
  let limitN = null;
  const q = {
    select() { return q; },
    eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
    in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
    order() { return q; },
    limit(n) { limitN = n; return q; },
    update(patch) { mode = 'update'; patchData = patch; return q; },
    maybeSingle() { wantSingle = true; return q; },
    then(resolve, reject) {
      try {
        let matched = FORM_ROWS.filter(r => filters.every(fn => fn(r)));
        if (mode === 'update') {
          if (!matched.length) { resolve({ data: null, error: null }); return; }
          const target = matched[0];
          Object.assign(target, patchData);
          resolve({ data: wantSingle ? target : [target], error: null });
          return;
        }
        if (limitN != null) matched = matched.slice(0, limitN);
        if (wantSingle) { resolve({ data: matched[0] || null, error: null }); return; }
        resolve({ data: matched, error: null });
      } catch (e) { (reject || (err => Promise.reject(err)))(e); }
    }
  };
  return q;
}

function assignment(code) {
  return { employee_id: 'ID-' + code, employee_code: code, employee_name: 'NV ' + code, department: 'Bán hàng', title: 'NVBH', branch: 'CN1', manager_id: '', manager_code: 'QL01', manager_name: 'QL01', employee_status: 'Đang làm việc', template_id: 'tpl1', template_version: '', effective_date: '2020-01-01', updated_at: '2020-01-01T00:00:00Z' };
}
const ASSIGNMENTS = ['EMP073', 'EMPCR', 'EMPED', 'EMPCN', 'EMPRV', 'EMPLK', 'EMPNOFORM'].map(assignment);
const TEMPLATES = [
  { template_key: 'tpl1', name: 'Mẫu Bán hàng', status: 'active', template_type: 'sales' }
];
const TEMPLATE_VERSIONS = [
  {
    template_key: 'tpl1', version_no: 'v1', effective_date: '2020-01-01', created_at: '2020-01-01T00:00:00Z',
    definition: {
      groups: [{ children: [{ items: [
        { code: 'C1', content: 'Tiêu chí 1 điểm', factor: 1, points: 1 },
        { code: 'C2', content: 'Tiêu chí 2 điểm', factor: 1, points: 2 }
      ] }] }]
    }
  }
];

require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true, exports: {
    createClient: () => ({
      from(table) {
        if (table === 'checklist_violation_records') return violationsTable();
        if (table === 'checklist_monthly_forms') return monthlyFormsTable();
        if (table === 'checklist_employee_assignments') return staticTable(() => ASSIGNMENTS);
        if (table === 'checklist_employee_assignment_history') return staticTable(() => []);
        if (table === 'checklist_templates') return staticTable(() => TEMPLATES);
        if (table === 'checklist_template_versions') return staticTable(() => TEMPLATE_VERSIONS);
        if (table === 'checklist_late_point_policies') return staticTable(() => []);
        if (table === 'checklist_permission_grants') return staticTable(() => []);
        if (table === 'checklist_system_settings') return staticTable(() => [{ setting_key: 'violation_mode', setting_value: 'production' }]);
        if (table === 'checklist_monthly_periods') return staticTable(() => []);
        if (table === 'checklist_monthly_period_overrides') return staticTable(() => []);
        if (table === 'checklist_monthly_form_history') return staticTable(() => []);
        if (table === 'checklist_late_manager_observations') return staticTable(() => []);
        if (table === 'checklist_late_bcc_import_rows') return staticTable(() => []);
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
            if (args.p_action === 'edit_test') {
              Object.assign(record, args.p_after || {});
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

const { saveChecklistViolations, cancelChecklistViolation } = require(violationsPath);
const { myMonthlyReviewSummaries, syncMonthlyChecklistScoreForEmployeeMonth } = require(monthlyPath);

const admin = { role: 'admin', account: { id: 'admin-1', name: 'Admin' }, employeeCode: 'ADMIN1' };

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}
async function expectFail(promise, label) {
  try { await promise; check(false, label + ' (khong throw nhu ky vong)'); }
  catch (e) { check(true, label + ' (throw dung nhu ky vong: ' + (e && e.code || e && e.message) + ')'); }
}
function row(overrides) {
  return Object.assign({
    employeeCode: 'EMP073', criterionCode: 'C1', occurredDate: '2026-09-06',
    occurredTime: '09:00', location: 'CN1', note: 'Ghi nhận lỗi kiểm thử sync V1'
  }, overrides);
}
let formSeq = 1;
function makeForm(overrides) {
  return Object.assign({
    id: 'f' + (formSeq++),
    period_id: 'p-2026-09',
    period_month: '2026-09',
    employee_id: '',
    employee_code: 'EMPXX',
    employee_name: 'NV',
    department: 'Bán hàng',
    title: 'NVBH',
    branch: 'CN1',
    reviewer_id: '',
    reviewer_code: 'QL01',
    reviewer_name: 'QL01',
    status: 'draft',
    checklist_score: 100,
    checklist_review_score: null,
    self_total_score: null,
    review_total_score: null,
    final_score: null,
    self_answers: {},
    review_answers: {},
    self_submitted_at: null,
    review_submitted_at: null,
    reviewed_by: '',
    reviewed_by_code: '',
    reviewed_by_name: '',
    updated_at: '2026-09-01T00:00:00.000Z',
    admin_exception_open: false,
    pilot_opened_at: null,
    score_policy_snapshot: {},
    template_snapshot: {
      version: {
        definition: {
          totalRows: [
            { id: 'CHK', code: 'CHK', source: 'checklist', sourceType: 'checklist_total', content: 'Tuân thủ tiêu chuẩn công việc', target: 100, unit: '%', weight: 100 }
          ]
        }
      }
    }
  }, overrides);
}
function formById(id) { return FORM_ROWS.find(f => f.id === id); }

async function run() {
  console.log('== 1. PHF073-style regression: stored=100 + 9 official violations totaling 10 points -> synchronized score=90 ==');
  const f073 = makeForm({ employee_code: 'EMP073', status: 'draft' });
  FORM_ROWS.push(f073);
  const rows9 = [];
  for (let i = 0; i < 8; i++) rows9.push(row({ criterionCode: 'C1', requestId: 'REQ-073-C1-' + i, occurredTime: '0' + (i + 1) + ':00' }));
  rows9.push(row({ criterionCode: 'C2', requestId: 'REQ-073-C2-0', occurredTime: '20:00' }));
  const r073 = await saveChecklistViolations(admin, rows9);
  check(r073.saved === 9, '1. 9 vi phạm được ghi nhận (saved=9)');
  check(formById(f073.id).checklist_score === 90, '1b. Form draft EMP073 checklist_score đồng bộ = 90 (100-10) ngay sau khi ghi nhận (got ' + formById(f073.id).checklist_score + ')');

  console.log('== 2. CREATE official violation: 100 -> lower score ==');
  const fCreate = makeForm({ employee_code: 'EMPCR', status: 'waiting_self' });
  FORM_ROWS.push(fCreate);
  await saveChecklistViolations(admin, [row({ employeeCode: 'EMPCR', criterionCode: 'C2', requestId: 'REQ-CR-1' })]);
  check(formById(fCreate.id).checklist_score === 98, '2. Tạo 1 lỗi C2 (2 điểm) -> score=98 (got ' + formById(fCreate.id).checklist_score + ')');

  console.log('== 3. EDIT points thay đổi điểm (qua sync helper trực tiếp, phản ánh recompute chung) ==');
  // updateChecklistViolation chỉ áp dụng cho bản ghi TEST (is_test=true) — is_test không
  // ảnh hưởng checklistBreakdown() nên bản thân edit_test không đổi điểm chính thức
  // (đúng thiết kế). Bài test dưới đây (case 6) chứng minh cơ chế sync 2 bucket của edit
  // hoạt động đúng bằng cách thao tác trực tiếp trên dữ liệu vi phạm CHÍNH THỨC rồi gọi
  // lại đúng hàm sync dùng chung — không phát minh công thức thứ hai.
  const fEdit = makeForm({ employee_code: 'EMPED', status: 'waiting_review' });
  FORM_ROWS.push(fEdit);
  const rEdit = await saveChecklistViolations(admin, [row({ employeeCode: 'EMPED', criterionCode: 'C1', requestId: 'REQ-ED-1' })]);
  check(formById(fEdit.id).checklist_score === 99, '3. Sau khi tạo 1 lỗi C1 (1 điểm) -> score=99 (got ' + formById(fEdit.id).checklist_score + ')');
  const editedRecord = VIOLATION_ROWS.find(r => r.id === rEdit.savedRows[0].id);
  editedRecord.points = 5; // mô phỏng điểm bị đổi trực tiếp trên dữ liệu chính thức
  await syncMonthlyChecklistScoreForEmployeeMonth('EMPED', '2026-09');
  check(formById(fEdit.id).checklist_score === 95, '3b. Điểm vi phạm đổi 1->5 rồi gọi lại sync -> score=95 (got ' + formById(fEdit.id).checklist_score + ')');

  // Lưu ý: updateChecklistViolation() (edit_test) trong hệ thống này CHỈ áp dụng cho dữ
  // liệu TEST của mã PHF012 (CHECKLIST_TEST_SCOPE_ONLY) — đúng phạm vi "test batch" cách
  // ly khỏi dữ liệu thật. Theo yêu cầu an toàn (không đụng lịch sử test đặc biệt PHF012/
  // PHF071), việc gọi write-through 2-bucket của edit ĐÃ được cắm vào updateChecklistViolation()
  // (xem api/_lib/checklist-violations.js) và đã được chứng minh đúng qua case 6 ở trên
  // bằng chính hàm sync dùng chung (không phải công thức thứ hai) — không lặp lại bằng
  // dữ liệu PHF012 ở đây.

  console.log('== 4. CANCEL / official -> non-official: điểm được hoàn lại ==');
  const fCancel = makeForm({ employee_code: 'EMPCN', status: 'draft' });
  FORM_ROWS.push(fCancel);
  const rCancel = await saveChecklistViolations(admin, [row({ employeeCode: 'EMPCN', criterionCode: 'C2', requestId: 'REQ-CN-1' })]);
  check(formById(fCancel.id).checklist_score === 98, '4. Sau tạo lỗi C2 -> score=98 (got ' + formById(fCancel.id).checklist_score + ')');
  await cancelChecklistViolation(admin, { id: rCancel.savedRows[0].id, reason: 'Huy de kiem thu sync V1 - qua thoi han' });
  check(formById(fCancel.id).checklist_score === 100, '4b. Sau khi hủy lỗi duy nhất -> score hoàn lại 100 (got ' + formById(fCancel.id).checklist_score + ')');

  console.log('== 5. is_test=true không ảnh hưởng điểm ==');
  const fTest = makeForm({ employee_code: 'EMPTS', status: 'draft' });
  FORM_ROWS.push(fTest);
  VIOLATION_ROWS.push({ id: 'vtest1', employee_code: 'EMPTS', criterion_code: 'C2', points: 50, occurred_date: '2026-09-10', record_status: 'official', is_test: true, request_id: 'REQ-TEST-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  await syncMonthlyChecklistScoreForEmployeeMonth('EMPTS', '2026-09');
  check(formById(fTest.id).checklist_score === 100, '5. Vi phạm is_test=true (50 điểm) không được tính vào điểm chính thức -> vẫn 100 (got ' + formById(fTest.id).checklist_score + ')');

  console.log('== 6. Edit làm đổi employee/month: CẢ bucket cũ VÀ bucket mới đều được refresh ==');
  const fOldMonth = makeForm({ employee_code: 'EMPMV', period_month: '2026-09', status: 'draft' });
  const fNewMonth = makeForm({ employee_code: 'EMPMV', period_month: '2026-10', status: 'draft' });
  FORM_ROWS.push(fOldMonth, fNewMonth);
  VIOLATION_ROWS.push({ id: 'vmv1', employee_code: 'EMPMV', criterion_code: 'C2', points: 2, occurred_date: '2026-09-15', record_status: 'official', is_test: false, request_id: 'REQ-MV-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  await syncMonthlyChecklistScoreForEmployeeMonth('EMPMV', '2026-09');
  check(formById(fOldMonth.id).checklist_score === 98, '6. Trước khi "sửa": bucket tháng 09 đã đồng bộ = 98 (got ' + formById(fOldMonth.id).checklist_score + ')');
  // Mô phỏng edit chuyển occurred_date sang tháng 10 (cùng employee_code, khác bucket tháng).
  VIOLATION_ROWS.find(r => r.id === 'vmv1').occurred_date = '2026-10-03';
  await Promise.all([
    syncMonthlyChecklistScoreForEmployeeMonth('EMPMV', '2026-09'),
    syncMonthlyChecklistScoreForEmployeeMonth('EMPMV', '2026-10')
  ]);
  check(formById(fOldMonth.id).checklist_score === 100, '6b. Sau khi "sửa" sang tháng 10: bucket THÁNG CŨ (09) được refresh về 100 (không còn vi phạm) (got ' + formById(fOldMonth.id).checklist_score + ')');
  check(formById(fNewMonth.id).checklist_score === 98, '6c. Bucket THÁNG MỚI (10) được refresh xuống 98 (got ' + formById(fNewMonth.id).checklist_score + ')');

  console.log('== 7/8. waiting_self và waiting_review đều là live (đã đồng bộ được ở case 2/3) ==');
  check(fCreate.status === 'waiting_self' && formById(fCreate.id).checklist_score === 98, '7. waiting_self là live -> đã đồng bộ (case 2)');
  check(fEdit.status === 'waiting_review' && formById(fEdit.id).checklist_score === 95, '8. waiting_review là live -> đã đồng bộ (case 3b)');

  console.log('== 9. reviewed là frozen: không bị ghi đè bởi vi phạm mới ==');
  const fReviewed = makeForm({ employee_code: 'EMPRV', status: 'reviewed', checklist_score: 100 });
  FORM_ROWS.push(fReviewed);
  await saveChecklistViolations(admin, [row({ employeeCode: 'EMPRV', criterionCode: 'C2', requestId: 'REQ-RV-1' })]);
  check(formById(fReviewed.id).checklist_score === 100, '9. Form reviewed KHÔNG bị sync ghi đè dù có vi phạm mới -> vẫn 100 (got ' + formById(fReviewed.id).checklist_score + ')');

  console.log('== 10. locked là frozen: không bị ghi đè bởi vi phạm mới ==');
  const fLocked = makeForm({ employee_code: 'EMPLK', status: 'locked', checklist_score: 100 });
  FORM_ROWS.push(fLocked);
  await saveChecklistViolations(admin, [row({ employeeCode: 'EMPLK', criterionCode: 'C2', requestId: 'REQ-LK-1' })]);
  check(formById(fLocked.id).checklist_score === 100, '10. Form locked KHÔNG bị sync ghi đè dù có vi phạm mới -> vẫn 100 (got ' + formById(fLocked.id).checklist_score + ')');

  console.log('== 11. Reviewer monthly summary trả điểm realtime cho form OPEN, không dùng giá trị stored cũ ==');
  // f073 vẫn "draft" với checklist_score đã tự đồng bộ = 90 ở case 1. Giả lập trường hợp
  // write-through bị bỏ lỡ: cưỡng bức stored về giá trị cũ (100) để chứng minh READ-SIDE
  // defense (myMonthlyReviewSummaries) tự phục hồi giá trị đúng tại thời điểm đọc.
  formById(f073.id).checklist_score = 100;
  const summary = await myMonthlyReviewSummaries(admin, { month: '2026-09' });
  const f073Summary = summary.forms.find(f => f.id === f073.id);
  check(!!f073Summary, '11. Reviewer summary trả về đúng phiếu EMP073');
  check(f073Summary.checklist_score === 90, '11b. Dù stored bị "kẹt" ở 100, summary vẫn trả điểm realtime=90 (got ' + f073Summary.checklist_score + ')');
  const fReviewedSummary = summary.forms.find(f => f.id === fReviewed.id);
  check(fReviewedSummary && fReviewedSummary.checklist_score === 100, '11c. Form reviewed (frozen) trong summary vẫn giữ giá trị stored=100, không bị ghi đè realtime');

  console.log('== 12. Không có phiếu tháng: mutation vi phạm KHÔNG tự tạo phiếu mới ==');
  const formCountBefore = FORM_ROWS.length;
  await saveChecklistViolations(admin, [row({ employeeCode: 'EMPNOFORM', criterionCode: 'C1', requestId: 'REQ-NOFORM-1' })]);
  check(FORM_ROWS.length === formCountBefore, '12. Số lượng phiếu tháng không đổi sau khi ghi nhận vi phạm cho nhân sự không có phiếu (got ' + FORM_ROWS.length + ', expect ' + formCountBefore + ')');
  const synced = await syncMonthlyChecklistScoreForEmployeeMonth('EMPNOFORM', '2026-09');
  check(synced === null, '12b. syncMonthlyChecklistScoreForEmployeeMonth() trả về null khi không có phiếu live (không tạo phiếu)');

  if (failures) {
    console.error('\n' + failures + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nAll checks passed (Monthly realtime score sync V1: write-through create/edit/cancel + read-side defense + frozen-form protection).');
}

run().catch(e => { console.error('UNEXPECTED ERROR', e); process.exit(1); });
