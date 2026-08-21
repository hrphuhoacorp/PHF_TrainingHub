'use strict';
/* Step 1 (2026-08-15) — Khôi phục flow Ghi nhận lỗi Đi trễ hiện hữu trước Workstream B:
   tiêu chí Đi trễ (mã chứa "DITRE") xuất hiện lại trong Nhập nhanh/Ghi nhận chi tiết/Ghi nhận
   nhiều ngày (violationCriteriaForContext() không còn lọc bỏ DITRE — xem test riêng ở
   test-checklist-late-manager-decision-rename-2026-08.js mục 4), và mỗi form thêm ĐÚNG 1 field
   bắt buộc "Duyệt/Không duyệt" ngay trong card khi tiêu chí là Đi trễ — tái dùng cột
   manager_decision đã có sẵn (migration 1.55.0), KHÔNG tạo bảng/cột mới, KHÔNG mở scoring/
   quota/BCC approve.

   P0 fix (2026-08-15) — 2 lỗi nghiệp vụ đã sửa ở lib/checklist-violations.js:
     P0-1: quyền ghi nhận Đi trễ KHÔNG còn hardcode Admin-only (requireAdmin) — dùng đúng cơ chế
           capability/scope thật requireViolationPermission(session,'record', rows) (action='record',
           record_scope) — actor có capability record + record_scope phủ nhân sự đều ghi được, kể
           cả không phải Admin (Trưởng ca/Trưởng bộ phận/Trợ lý GĐ...).
     P0-2: DITRE không còn tạo official violation/checklist score nào trong
           checklist_violation_records — normalizeCanonical() trả về sớm một payload "late
           observation intent" (__lateObservation), saveChecklistViolations() route các dòng này
           qua recordManagerLateObservation() (lib/checklist-late-reconciliation-service.js) ->
           ghi vào bảng riêng checklist_late_manager_observations.

   File này kiểm chứng lớp BACKEND thật (lib/checklist-violations.js#normalizeCanonical qua
   saveChecklistViolations) bằng in-memory Supabase mock (cùng pattern
   scripts/test-checklist-quick-multi-person-batch.js), và grep-guard lớp FRONTEND (app.js) cho
   3 form đều wiring đúng field mới.
     node scripts/test-checklist-late-generic-entry-restore-2026-08.js
*/
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const fs = require('fs');
const path = require('path');
const supabasePath = require.resolve('../api/_lib/checklist-violations') && require.resolve('@supabase/supabase-js');
const violationsPath = require.resolve('../api/_lib/checklist-violations');

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

let VIOLATION_ROWS = [];
let seq = 1;
function violationsTable() {
  const filters = [];
  let mode = 'select';
  let upsertRows = null;
  const q = {
    select() { return q; },
    eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
    neq(field, value) { filters.push(r => String(r[field]) !== String(value)); return q; },
    in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
    gte(field, value) { filters.push(r => r[field] != null && r[field] >= value); return q; },
    lte(field, value) { filters.push(r => r[field] != null && r[field] <= value); return q; },
    order() { return q; },
    range() { return q; },
    limit() { return q; },
    upsert(rows) { mode = 'upsert'; upsertRows = rows; return q; },
    maybeSingle() { return q; },
    then(resolve, reject) {
      try {
        if (mode === 'upsert') {
          const inserted = [];
          for (const row of upsertRows) {
            const conflicts = row.request_id != null && VIOLATION_ROWS.some(r => r.request_id === row.request_id);
            if (conflicts) continue;
            const saved = { id: 'v' + (seq++), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), record_status: 'official', ...row };
            VIOLATION_ROWS.push(saved);
            inserted.push(saved);
          }
          resolve({ data: inserted, error: null });
          return;
        }
        const matched = VIOLATION_ROWS.filter(r => filters.every(fn => fn(r)));
        resolve({ data: matched, error: null });
      } catch (e) { (reject || (err => Promise.reject(err)))(e); }
    }
  };
  return q;
}

// checklist_late_manager_observations: bảng riêng cho quan sát Đi trễ (P0-2) — mutable, mô
// phỏng đúng upsert onConflict:'request_id', ignoreDuplicates:true như bảng violation ở trên,
// cộng thêm .select('*') sau upsert và fallback .eq('request_id',...).maybeSingle() mà
// recordManagerLateObservation() (lib/checklist-late-reconciliation-service.js) dùng.
let OBSERVATION_ROWS = [];
let obsSeq = 1;
function observationsTable() {
  const filters = [];
  let mode = 'select';
  let upsertRows = null;
  let wantSingle = false;
  const q = {
    select() { return q; },
    eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
    order() { return q; },
    limit() { return q; },
    upsert(rows) { mode = 'upsert'; upsertRows = Array.isArray(rows) ? rows : [rows]; return q; },
    maybeSingle() { wantSingle = true; return q; },
    then(resolve, reject) {
      try {
        if (mode === 'upsert') {
          const inserted = [];
          for (const row of upsertRows) {
            const conflicts = row.request_id != null && OBSERVATION_ROWS.some(r => r.request_id === row.request_id);
            if (conflicts) continue;
            const saved = { id: 'mlo' + (obsSeq++), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row };
            OBSERVATION_ROWS.push(saved);
            inserted.push(saved);
          }
          resolve({ data: inserted, error: null });
          return;
        }
        const matched = OBSERVATION_ROWS.filter(r => filters.every(fn => fn(r)));
        if (wantSingle) { resolve({ data: matched[0] || null, error: null }); return; }
        resolve({ data: matched, error: null });
      } catch (e) { (reject || (err => Promise.reject(err)))(e); }
    }
  };
  return q;
}

const ASSIGNMENTS = [
  { employee_id: 'ID-EMP301', employee_code: 'EMP301', employee_name: 'NV 301', department: 'Bán hàng', title: 'NVBH', branch: 'CN1', manager_id: '', manager_code: 'QL01', manager_name: 'QL01', employee_status: 'Đang làm việc', template_id: 'tpl-late', template_version: '', effective_date: '2020-01-01', updated_at: '2020-01-01T00:00:00Z' },
  { employee_id: 'ID-EMP999', employee_code: 'EMP999', employee_name: 'NV 999 (ngoài phạm vi QL01)', department: 'Kho', title: 'NVK', branch: 'CN2', manager_id: '', manager_code: 'QL02', manager_name: 'QL02', employee_status: 'Đang làm việc', template_id: 'tpl-late', template_version: '', effective_date: '2020-01-01', updated_at: '2020-01-01T00:00:00Z' }
];
const TEMPLATES = [
  { template_key: 'tpl-late', name: 'Mẫu có Đi trễ', status: 'active', template_type: 'sales' }
];
const TEMPLATE_VERSIONS = [
  {
    template_key: 'tpl-late', version_no: 'v1', effective_date: '2020-01-01', created_at: '2020-01-01T00:00:00Z',
    definition: { groups: [{ children: [{ items: [
      { code: 'PHF-DITRE-01', content: 'Đi trễ so với giờ vào ca theo lịch', factor: 1, points: 3 },
      { code: 'PHF-TP-01', content: 'Tác phong làm việc', factor: 1, points: 5 }
    ] }] }] }
  }
];
// QL01: record_scope=direct_reports -> chỉ phủ nhân sự có manager_code=QL01 (EMP301), KHÔNG phủ
// EMP999 (manager_code=QL02) — dùng để chứng minh P0-1 vừa cho actor không-phải-Admin ghi được
// Đi trễ (khi trong scope) vừa vẫn bị chặn đúng khi ngoài scope (không phải CHECKLIST_ADMIN_ONLY
// hardcode nữa, mà là lỗi scope thật).
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
        if (table === 'checklist_late_manager_observations') return observationsTable();
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

const { saveChecklistViolations } = require(violationsPath);

const admin1 = { role: 'admin', account: { id: 'admin-1', name: 'Giám sát' } };
const managerQl01 = { role: 'manager', account: { id: 'act-ql01', name: 'QL01' }, employeeCode: 'QL01' };

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}
async function expectFail(promise, expectedCode, label) {
  try { const r = await promise; check(false, label + ' (không throw như kỳ vọng, muốn code=' + expectedCode + ', got saved=' + JSON.stringify(r)); return null; }
  catch (e) { check(e && e.code === expectedCode, label + ' (kỳ vọng code=' + expectedCode + ', got ' + (e && e.code) + ')'); return e; }
}
function lateRow(overrides) {
  return Object.assign({
    employeeCode: 'EMP301', criterionCode: 'PHF-DITRE-01', occurredDate: '2026-08-15',
    occurredTime: '09:00', location: 'CN1', note: 'Đi trễ 15 phút không báo trước',
    lateMinutes: 15, requestId: 'test-late-' + Math.random().toString(36).slice(2, 8)
  }, overrides);
}
function normalRow(overrides) {
  return Object.assign({
    employeeCode: 'EMP301', criterionCode: 'PHF-TP-01', occurredDate: '2026-08-15',
    occurredTime: '09:00', location: 'CN1', note: 'Không tuân thủ tác phong theo quy định',
    requestId: 'test-normal-' + Math.random().toString(36).slice(2, 8)
  }, overrides);
}

const APP_SRC = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'checklist', 'phf-checklist-app.js'), 'utf8');
const LIB_SRC = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'checklist-violations.js'), 'utf8');

async function run() {
  console.log('== 1. Duyệt lưu đúng — DITRE + managerDecision=approved -> observation, KHÔNG official violation ==');
  {
    const beforeViolations = VIOLATION_ROWS.length;
    const saved = await saveChecklistViolations(admin1, [lateRow({ managerDecision: 'approved' })]);
    check(saved.saved === 1, '1a. Lưu thành công 1 dòng');
    check(saved.savedRows[0].isLateObservation === true, '1a2. savedRows đánh dấu isLateObservation=true');
    const obs = OBSERVATION_ROWS.find(r => r.employee_code === 'EMP301' && r.manager_decision === 'approved');
    check(!!obs, '1b. Có bản ghi trong checklist_late_manager_observations, manager_decision=approved');
    check(VIOLATION_ROWS.length === beforeViolations, '1c. KHÔNG tạo bất kỳ dòng nào trong checklist_violation_records (0 official violation)');
  }

  console.log('== 2. Không duyệt lưu đúng — DITRE + managerDecision=rejected -> observation, KHÔNG official violation ==');
  {
    const beforeViolations = VIOLATION_ROWS.length;
    const saved = await saveChecklistViolations(admin1, [lateRow({ managerDecision: 'rejected' })]);
    check(saved.saved === 1, '2a. Lưu thành công 1 dòng');
    const obs = OBSERVATION_ROWS.find(r => r.employee_code === 'EMP301' && r.manager_decision === 'rejected');
    check(!!obs, '2b. Có bản ghi trong checklist_late_manager_observations, manager_decision=rejected');
    check(VIOLATION_ROWS.length === beforeViolations, '2c. KHÔNG tạo bất kỳ dòng nào trong checklist_violation_records');
  }

  console.log('== 3. Thiếu/sai Duyệt-Không duyệt cho DITRE -> backend chặn ==');
  await expectFail(
    saveChecklistViolations(admin1, [lateRow({ managerDecision: undefined })]),
    'CHECKLIST_LATE_MANAGER_DECISION_REQUIRED',
    '3a. managerDecision rỗng bị chặn'
  );
  await expectFail(
    saveChecklistViolations(admin1, [lateRow({ managerDecision: 'maybe' })]),
    'CHECKLIST_LATE_MANAGER_DECISION_REQUIRED',
    '3b. managerDecision giá trị lạ (không phải approved/rejected) bị chặn'
  );

  console.log('== 4. Các tiêu chí khác (không phải Đi trễ) KHÔNG bắt buộc field này, vẫn tạo official violation như cũ ==');
  {
    const before = VIOLATION_ROWS.length;
    const saved = await saveChecklistViolations(admin1, [normalRow()]);
    check(saved.saved === 1, '4a. Lưu thành công tiêu chí thường (PHF-TP-01) mà không cần managerDecision');
    const row = VIOLATION_ROWS.find(r => r.criterion_code === 'PHF-TP-01');
    check(!!row, '4b. Bản ghi tiêu chí thường đã lưu trong checklist_violation_records');
    check(row && row.record_status === 'official', '4c. record_status=official (giữ nguyên luồng cũ)');
    check(VIOLATION_ROWS.length === before + 1, '4d. Không có dòng thừa nào được tạo ra ngoài ý muốn');
  }

  console.log('== 5. P0-1: quyền ghi Đi trễ là capability/scope thật, KHÔNG hardcode Admin-only ==');
  {
    const before = OBSERVATION_ROWS.length;
    const saved = await saveChecklistViolations(managerQl01, [lateRow({ managerDecision: 'approved', requestId: 'test-late-ql01-inscope' })]);
    check(saved.saved === 1, '5a. QL01 (không phải Admin, có record_scope=direct_reports phủ EMP301) GHI ĐƯỢC Đi trễ — không còn bị chặn CHECKLIST_ADMIN_ONLY');
    check(OBSERVATION_ROWS.length === before + 1, '5a2. Ghi vào checklist_late_manager_observations thành công');
  }
  await expectFail(
    saveChecklistViolations(managerQl01, [lateRow({ employeeCode: 'EMP999', managerDecision: 'approved', requestId: 'test-late-ql01-outscope' })]),
    'CHECKLIST_VIOLATION_OUT_OF_SCOPE',
    '5b. QL01 ghi Đi trễ cho EMP999 (ngoài record_scope, manager_code=QL02) bị chặn ĐÚNG bằng lỗi scope thật, KHÔNG phải CHECKLIST_ADMIN_ONLY'
  );
  {
    const saved = await saveChecklistViolations(managerQl01, [normalRow({ requestId: 'test-normal-ql01' })]);
    check(saved.saved === 1, '5c. QL01 (record+record_scope) vẫn ghi được tiêu chí thường bình thường — permission mechanism record_scope không bị đụng tới');
  }
  {
    const saved = await saveChecklistViolations(admin1, [lateRow({ managerDecision: 'approved', requestId: 'test-late-admin-still-ok' })]);
    check(saved.saved === 1, '5d. Admin (full scope mặc định) vẫn ghi được Đi trễ bình thường');
  }

  console.log('== 6. Regression: flow ghi nhận lỗi khác (không phải Đi trễ) không đổi hành vi ==');
  {
    const saved = await saveChecklistViolations(admin1, [normalRow({ requestId: 'regr-1' })]);
    check(saved.saved === 1, '6a. Ghi nhận tiêu chí thường qua saveChecklistViolations vẫn hoạt động bình thường');
  }

  console.log('== 6b. Batch trộn lẫn DITRE + tiêu chí thường trong CÙNG 1 lần gọi ==');
  {
    const beforeViolations = VIOLATION_ROWS.length;
    const beforeObs = OBSERVATION_ROWS.length;
    const saved = await saveChecklistViolations(admin1, [
      lateRow({ managerDecision: 'approved', requestId: 'test-mixed-late' }),
      normalRow({ requestId: 'test-mixed-normal' })
    ]);
    check(saved.saved === 2, '6b1. Batch trộn 2 loại trả về đủ 2 dòng saved');
    check(VIOLATION_ROWS.length === beforeViolations + 1, '6b2. Đúng 1 dòng mới trong checklist_violation_records (dòng thường)');
    check(OBSERVATION_ROWS.length === beforeObs + 1, '6b3. Đúng 1 dòng mới trong checklist_late_manager_observations (dòng Đi trễ)');
    const lateSaved = saved.savedRows.find(r => r.criterionCode === 'PHF-DITRE-01');
    const normalSaved = saved.savedRows.find(r => r.criterionCode === 'PHF-TP-01');
    check(!!lateSaved && lateSaved.isLateObservation === true, '6b4. Dòng Đi trễ trong savedRows đánh dấu isLateObservation=true');
    check(!!normalSaved && normalSaved.isLateObservation === false, '6b5. Dòng thường trong savedRows đánh dấu isLateObservation=false');
  }

  console.log('== 7. Grep-guard FRONTEND: violationCriteriaForContext() không còn lọc DITRE + isLateCriterionItem() được dùng đúng 3 form ==');
  check(!/code\.indexOf\('DITRE'\)<0/.test(APP_SRC.slice(APP_SRC.indexOf('function violationCriteriaForContext'), APP_SRC.indexOf('function violationCriteriaForContext') + 1200)), '7a. violationCriteriaForContext() không còn filter loại bỏ DITRE');
  check(APP_SRC.includes('function isLateCriterionItem(item)'), '7b. Có helper isLateCriterionItem() dùng chung cho 3 form');
  check(APP_SRC.includes('data-phfck-quick-manager-decision'), '7c. Nhập nhanh (Quick) có field Duyệt/Không duyệt');
  check(APP_SRC.includes('data-phfck-detail-manager-decision'), '7d. Ghi nhận chi tiết (Detail) có field Duyệt/Không duyệt');
  check(APP_SRC.includes('data-phfck-multi-field="managerDecision"'), '7e. Ghi nhận nhiều ngày (Multi) có field Duyệt/Không duyệt');
  check(/managerDecision:isLateCriterionItem\(item\)/.test(APP_SRC), '7f. quickOfficialPayload gửi managerDecision đúng điều kiện isLateCriterionItem');

  console.log('== 8. Grep-guard BACKEND: normalizeCanonical() bắt buộc managerDecision cho DITRE, KHÔNG hardcode Admin-only, KHÔNG mở scoring/quota cho DITRE ==');
  const fnStart = LIB_SRC.indexOf('async function normalizeCanonical');
  const fnEnd = LIB_SRC.indexOf('function persistenceRow', fnStart);
  const fnSlice = LIB_SRC.slice(fnStart, fnEnd);
  check(fnSlice.includes('CHECKLIST_LATE_MANAGER_DECISION_REQUIRED'), '8a. Có mã lỗi CHECKLIST_LATE_MANAGER_DECISION_REQUIRED khi thiếu Duyệt/Không duyệt');
  check(fnSlice.includes('__lateObservation: true'), '8b. normalizeCanonical() trả về payload đánh dấu __lateObservation cho DITRE (không xây official-violation-payload)');
  check(!/requireAdmin[\s\S]{0,80}Đi trễ/.test(fnSlice), '8c. normalizeCanonical() KHÔNG còn hardcode requireAdmin cho việc ghi nhận Đi trễ (P0-1 đã sửa)');
  check(!/quota|hardQuota|autoAdjust/i.test(fnSlice), '8d. Không có logic quota/auto-adjustment nào được thêm vào normalizeCanonical()');

  const saveFnStart = LIB_SRC.indexOf('async function saveChecklistViolations');
  const saveFnEnd = LIB_SRC.indexOf('async function listChecklistViolations', saveFnStart);
  const saveFnSlice = LIB_SRC.slice(saveFnStart, saveFnEnd);
  check(saveFnSlice.includes("require('./checklist-late-reconciliation-service')"), '8e. saveChecklistViolations() route DITRE qua recordManagerLateObservation() (require lazy trong hàm, tránh circular require với checklist-late-reconciliation-service.js)');
  check(!/^const \{ recordManagerLateObservation/m.test(LIB_SRC.slice(0, fnStart)), '8f. KHÔNG require checklist-late-reconciliation-service.js ở top-level của file (tránh circular dependency)');

  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILED') + ' — test-checklist-late-generic-entry-restore-2026-08.js');
  if (failures > 0) process.exit(1);
}

run().catch(err => { console.error('FATAL', err); process.exit(1); });
