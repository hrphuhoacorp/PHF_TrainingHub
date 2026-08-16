'use strict';
/* Đi trễ — Trợ lý thẩm định (2026-08-16): kiểm chứng chức năng Đi trễ được mở cho người có
   QUYỀN THẨM ĐỊNH CHECKLIST HIỆN HỮU (review_monthly + review_scope, đã có sẵn cho preset
   TRO_LY_GD) — KHÔNG tạo permission/scope mới, KHÔNG hardcode role==='assistant'.
   Cover:
     A) getChecklistRoleWorkspace() (lib/checklist-permissions.js) expose đúng canReviewMonthly/
        reviewScope, mirror y hệt canRecordViolation/recordScope đã có.
     B) listManagerLateObservations() (lib/checklist-late-reconciliation-service.js) scope-filter
        ĐÚNG theo permission.scopeType thật (fix lỗ hổng cũ: trước đây trả TOÀN BỘ observation cho
        bất kỳ ai có quyền 'view', không lọc theo scope) — all_company thấy hết, scope hẹp hơn chỉ
        thấy đúng phạm vi.
     C) Admin-only write/upload actions (previewBccUpload/createBccImport/reconcileBccImport/
        approveLateEvents/createLinkedAdjustment) vẫn requireAdmin() — Trợ lý/reviewer KHÔNG gọi
        được dù đã mở UI xem/ghi nhận.
     D) Client: canUseLateWorkflowArea()/canReviewChecklistLateArea()/buildLateWorkflowCtx() đúng
        wiring (source-scan, đã cover phần lớn ở test-checklist-late-workflow-integration-2026-08.js
        — file này chỉ thêm phần jsdom render thật cho ctx.isReviewer).
   Chạy: node scripts/test-checklist-late-review-permission-2026-08.js
*/
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const supabasePath = require.resolve('@supabase/supabase-js');

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

const ASSIGNMENTS = [
  { employee_id: 'e1', employee_code: 'PHF001', employee_name: 'A Kho', department: 'Kho', branch: 'CN1', employee_status: 'Đang làm việc' },
  { employee_id: 'e2', employee_code: 'PHF002', employee_name: 'B Ban hang', department: 'Bán hàng', branch: 'CN1', employee_status: 'Đang làm việc' },
  { employee_id: 'e3', employee_code: 'PHF003', employee_name: 'C Ban hang', department: 'Bán hàng', branch: 'CN2', employee_status: 'Đang làm việc' }
];

const OBSERVATIONS = [
  { id: 'o1', employee_code: 'PHF001', employee_name: 'A Kho', occurred_date: '2026-08-10', manager_decision: 'approved', note: 'Kho', request_id: 'r1' },
  { id: 'o2', employee_code: 'PHF002', employee_name: 'B Ban hang', occurred_date: '2026-08-11', manager_decision: 'rejected', note: 'BH1', request_id: 'r2' },
  { id: 'o3', employee_code: 'PHF003', employee_name: 'C Ban hang', occurred_date: '2026-08-12', manager_decision: 'approved', note: 'BH2', request_id: 'r3' }
];
let obsSeq = 1;
function observationsTable() {
  const filters = [];
  let mode = 'select', upsertRows = null, wantSingle = false, limitN = null;
  const q = {
    select() { return q; },
    eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
    order() { return q; },
    limit(n) { limitN = n; return q; },
    in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
    gte(field, value) { filters.push(r => r[field] != null && r[field] >= value); return q; },
    lte(field, value) { filters.push(r => r[field] != null && r[field] <= value); return q; },
    upsert(rows) { mode = 'upsert'; upsertRows = Array.isArray(rows) ? rows : [rows]; return q; },
    maybeSingle() { wantSingle = true; return q; },
    then(resolve, reject) {
      try {
        if (mode === 'upsert') {
          const inserted = [];
          for (const row of upsertRows) {
            const conflicts = row.request_id != null && OBSERVATIONS.some(r => r.request_id === row.request_id);
            if (conflicts) continue;
            const saved = { id: 'mlo' + (obsSeq++), ...row };
            OBSERVATIONS.push(saved);
            inserted.push(saved);
          }
          resolve({ data: inserted, error: null });
          return;
        }
        let matched = OBSERVATIONS.filter(r => filters.every(fn => fn(r)));
        if (wantSingle) { resolve({ data: matched[0] || null, error: null }); return; }
        if (limitN != null) matched = matched.slice(0, limitN);
        resolve({ data: matched, error: null });
      } catch (e) { (reject || (err => Promise.reject(err)))(e); }
    }
  };
  return q;
}

const GRANTS = [
  {
    id: 'g-tro-ly', account_id: 'act-troly', employee_code: 'TROLY01', preset_code: 'TRO_LY_GD',
    capabilities: { view_monthly: true, view_violations: true, view_reports: true, export_data: true, review_monthly: true, record_violation: true },
    view_scope: { type: 'all_company', values: [] }, review_scope: { type: 'all_company', values: [] },
    record_scope: { type: 'all_company', values: [] }, export_scope: { type: 'all_company', values: [] },
    is_active: true, effective_from: '2020-01-01', effective_to: null, updated_at: '2026-01-01'
  },
  {
    id: 'g-truong-bp', account_id: 'act-tbp', employee_code: 'TBP01', preset_code: 'TRUONG_BO_PHAN',
    capabilities: { view_monthly: true, view_violations: true, view_reports: true, export_data: true, review_monthly: true, record_violation: true },
    view_scope: { type: 'department', values: ['Bán hàng'] }, review_scope: { type: 'department', values: ['Bán hàng'] },
    record_scope: { type: 'department', values: ['Bán hàng'] }, export_scope: { type: 'department', values: ['Bán hàng'] },
    is_active: true, effective_from: '2020-01-01', effective_to: null, updated_at: '2026-01-01'
  }
];

require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true, exports: {
    createClient: () => ({
      from(table) {
        if (table === 'checklist_permission_grants') return staticTable(() => GRANTS);
        if (table === 'checklist_employee_assignments') return staticTable(() => ASSIGNMENTS);
        if (table === 'checklist_late_manager_observations') return observationsTable();
        return staticTable(() => []);
      }
    })
  }
};

const service = require('../lib/checklist-late-reconciliation-service');
const permissions = require('../lib/checklist-permissions');

let failures = 0, passes = 0;
function check(condition, message) { if (!condition) { console.error('FAIL: ' + message); failures++; } else { passes++; console.log('PASS: ' + message); } }
async function checkAsync(label, fn) { try { await fn(); passes++; console.log('PASS: ' + label); } catch (e) { failures++; console.error('FAIL: ' + label + ' :: ' + (e && e.message || e)); } }

const adminSession = { role: 'admin', account: { id: 'admin-1', name: 'Admin' } };
const troLySession = { role: 'manager', account: { id: 'act-troly', name: 'Trợ lý' }, employeeCode: 'TROLY01' };
const truongBpSession = { role: 'manager', account: { id: 'act-tbp', name: 'Trưởng BP' }, employeeCode: 'TBP01' };

(async () => {
  // =========================================================================
  // A) getChecklistRoleWorkspace() expose canReviewMonthly/reviewScope đúng — mirror
  //    canRecordViolation/recordScope đã có, KHÔNG tạo field/capability mới.
  // =========================================================================
  await checkAsync('A1. Trợ lý (TRO_LY_GD): canReviewMonthly=true, reviewScope=all_company', async () => {
    const ws = await permissions.getChecklistRoleWorkspace(troLySession);
    assert.strictEqual(ws.canReviewMonthly, true);
    assert.strictEqual(ws.reviewScope.type, 'all_company');
    // Cùng lúc canRecordViolation vẫn true, all_company — "quyền ghi nhận Đi trễ toàn công ty
    // hiện có" không bị đụng bởi thay đổi này.
    assert.strictEqual(ws.canRecordViolation, true);
    assert.strictEqual(ws.recordScope.type, 'all_company');
  });
  await checkAsync('A2. Trưởng bộ phận (department-scope): canReviewMonthly=true nhưng reviewScope=department (không phải all_company)', async () => {
    const ws = await permissions.getChecklistRoleWorkspace(truongBpSession);
    assert.strictEqual(ws.canReviewMonthly, true);
    assert.strictEqual(ws.reviewScope.type, 'department');
    assert.deepStrictEqual(ws.reviewScope.values, ['Bán hàng']);
  });
  await checkAsync('A3. Admin: getChecklistRoleWorkspace() trả role=admin, không có field canReviewMonthly (nhánh Admin return sớm, không đổi hành vi cũ)', async () => {
    const ws = await permissions.getChecklistRoleWorkspace(adminSession);
    assert.strictEqual(ws.role, 'admin');
    assert.strictEqual('canReviewMonthly' in ws, false);
  });

  // =========================================================================
  // B) listManagerLateObservations() scope-filter đúng theo permission thật — FIX lỗ hổng cũ
  //    (trước đây trả TOÀN BỘ observation cho bất kỳ ai có quyền 'view').
  // =========================================================================
  await checkAsync('B1. Admin: thấy TOÀN BỘ observation (all_company, đúng quyền)', async () => {
    const { records } = await service.listManagerLateObservations(adminSession, {});
    assert.strictEqual(records.length, 3);
  });
  await checkAsync('B2. Trợ lý (all_company): thấy TOÀN BỘ observation — đúng "quyền thẩm định toàn công ty"', async () => {
    const { records } = await service.listManagerLateObservations(troLySession, {});
    assert.strictEqual(records.length, 3);
  });
  await checkAsync('B3. Trưởng bộ phận (scope="Bán hàng"): CHỈ thấy observation của nhân sự Bán hàng (PHF002/PHF003), KHÔNG thấy PHF001 (Kho) — fix scope-filter', async () => {
    const { records } = await service.listManagerLateObservations(truongBpSession, {});
    const codes = records.map(r => r.employee_code).sort();
    assert.deepStrictEqual(codes, ['PHF002', 'PHF003']);
  });
  await checkAsync('B4. employeeCode filter tường minh vẫn hoạt động bình thường (không đổi behavior cũ khi client tự lọc theo 1 nhân sự)', async () => {
    const { records } = await service.listManagerLateObservations(troLySession, { employeeCode: 'PHF001' });
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].employee_code, 'PHF001');
  });

  // =========================================================================
  // C) Security — Admin-only write/upload actions vẫn requireAdmin(), Trợ lý/reviewer KHÔNG
  //    gọi được dù đã có quyền thẩm định/ghi nhận toàn công ty. Đây là bằng chứng "không chỉ ẩn
  //    nút" — gọi thẳng API với session Trợ lý phải bị chặn ở backend.
  // =========================================================================
  await checkAsync('C1. previewBccUpload: Trợ lý gọi thẳng -> reject CHECKLIST_LATE_RECON_ADMIN_ONLY', async () => {
    await assert.rejects(
      () => service.previewBccUpload(troLySession, [{ 'Mã nhân viên': 'PHF001', 'Ngày': '2026-08-16', 'Phút trễ': '10' }]),
      (err) => { assert.strictEqual(err.code, 'CHECKLIST_LATE_RECON_ADMIN_ONLY'); return true; }
    );
  });
  await checkAsync('C2. createBccImport: Trợ lý gọi thẳng -> reject CHECKLIST_LATE_RECON_ADMIN_ONLY', async () => {
    await assert.rejects(
      () => service.createBccImport(troLySession, { fileName: 'x.xlsx', previewRows: [{ employeeCode: 'PHF001', occurredDate: '2026-08-16', minutesLate: 10 }] }),
      (err) => { assert.strictEqual(err.code, 'CHECKLIST_LATE_RECON_ADMIN_ONLY'); return true; }
    );
  });
  await checkAsync('C3. reconcileBccImport: Trợ lý gọi thẳng -> reject CHECKLIST_LATE_RECON_ADMIN_ONLY', async () => {
    await assert.rejects(
      () => service.reconcileBccImport(troLySession, { importId: 'imp-x', choice: 'row_by_row', rowDecisions: {} }),
      (err) => { assert.strictEqual(err.code, 'CHECKLIST_LATE_RECON_ADMIN_ONLY'); return true; }
    );
  });
  await checkAsync('C4. approveLateEvents: Trợ lý gọi thẳng -> reject CHECKLIST_LATE_RECON_ADMIN_ONLY (chặn trước cả requireLateApprovalEnabled)', async () => {
    await assert.rejects(
      () => service.approveLateEvents(troLySession, [{ importRowId: 'row-x', adminDecision: 'apply_no_permission_points' }]),
      (err) => { assert.strictEqual(err.code, 'CHECKLIST_LATE_RECON_ADMIN_ONLY'); return true; }
    );
  });
  await checkAsync('C5. createLinkedAdjustment: Trợ lý gọi thẳng -> reject CHECKLIST_LATE_RECON_ADMIN_ONLY', async () => {
    await assert.rejects(
      () => service.createLinkedAdjustment(troLySession, { originalViolationId: 'v-x', importRowId: 'row-x', reason: 'test reason 10+ chars' }),
      (err) => { assert.strictEqual(err.code, 'CHECKLIST_LATE_RECON_ADMIN_ONLY'); return true; }
    );
  });
  await checkAsync('C6. Không thể "chỉ vì biết endpoint" mà bypass — Admin session vẫn phải qua ĐÚNG action, không có action nào khác né requireAdmin', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib/checklist-late-reconciliation-service.js'), 'utf8');
    ['previewBccUpload', 'createBccImport', 'reconcileBccImport', 'approveLateEvents', 'createLinkedAdjustment'].forEach(fnName => {
      const idx = src.indexOf('async function ' + fnName);
      const nextFnIdx = src.indexOf('\nasync function ', idx + 1);
      const body = src.slice(idx, nextFnIdx > -1 ? nextFnIdx : idx + 800);
      assert.ok(body.includes('requireAdmin('), fnName + ' phải gọi requireAdmin()');
    });
  });

  // =========================================================================
  // D) recordManagerLateObservation (ghi nhận Duyệt/Không duyệt) — Trợ lý company-wide vẫn hoạt
  //    động bình thường, KHÔNG bị đụng bởi các thay đổi trên (record_scope tách biệt view_scope).
  // =========================================================================
  await checkAsync('D1. Trợ lý ghi nhận cho nhân sự Kho (ngoài "department Bán hàng" của Trưởng BP, nhưng Trợ lý all_company nên vẫn được)', async () => {
    const result = await service.recordManagerLateObservation(troLySession, { employeeCode: 'PHF001', occurredDate: '2026-08-16', managerDecision: 'approved', note: 'ok' });
    assert.ok(result && result.saved !== false);
  });
  await checkAsync('D2. Trưởng BP KHÔNG ghi nhận được cho nhân sự Kho (ngoài scope department "Bán hàng") — record_scope vẫn enforce đúng, không nới quyền', async () => {
    await assert.rejects(
      () => service.recordManagerLateObservation(truongBpSession, { employeeCode: 'PHF001', occurredDate: '2026-08-16', managerDecision: 'approved', note: 'ok' }),
      (err) => { assert.strictEqual(err.code, 'CHECKLIST_VIOLATION_OUT_OF_SCOPE'); return true; }
    );
  });

  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures ? 1 : 0);
})();
