'use strict';
/* Đi trễ — "Kiểm tra ghi nhận cấp trên" Admin-only (2026-08-16):
   listAdminLateManagerObservations() (lib/checklist-late-reconciliation-service.js) phải:
     A) requireAdmin() thật — Admin xem được TOÀN BỘ observation, không giới hạn theo scope
        của chính Admin.
     B) Non-Admin (kể cả Trợ lý view_scope=all_company) gọi thẳng -> reject ADMIN_ONLY — đây
        là bằng chứng "Admin-only thật ở backend", không chỉ ẩn nút UI hay tái dùng capability
        'view' chung (đã bị coi là lỗ hổng nếu Trợ lý gọi được).
     C) Filter dateFrom/dateTo/employeeCode/managerDecision hoạt động đúng.
     D) listManagerLateObservations() (reviewer/Trợ lý shell hiện hữu) không bị regression bởi
        thay đổi này — vẫn scope-filter đúng như trước (xem test-checklist-late-review-permission-2026-08.js).
   Chạy: node scripts/test-checklist-admin-late-observation-view-2026-08.js
*/
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const assert = require('assert');
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
  { employee_id: 'e2', employee_code: 'PHF002', employee_name: 'B Ban hang', department: 'Bán hàng', branch: 'CN1', employee_status: 'Đang làm việc' }
];

const OBSERVATIONS = [
  { id: 'o1', employee_code: 'PHF001', employee_name: 'A Kho', occurred_date: '2026-08-05', manager_decision: 'approved', note: 'Kho ok', created_by_name: 'Trưởng ca A', recorder_role_label: 'Trưởng ca bán hàng', created_at: '2026-08-05T08:00:00Z', request_id: 'r1' },
  { id: 'o2', employee_code: 'PHF002', employee_name: 'B Ban hang', occurred_date: '2026-08-11', manager_decision: 'rejected', note: 'Không phép', created_by_name: 'Trợ lý GD', recorder_role_label: 'Trợ lý Giám đốc', created_at: '2026-08-11T09:00:00Z', request_id: 'r2' },
  { id: 'o3', employee_code: 'PHF002', employee_name: 'B Ban hang', occurred_date: '2026-08-15', manager_decision: 'approved', note: '', created_by_name: 'Trợ lý GD', recorder_role_label: 'Trợ lý Giám đốc', created_at: '2026-08-15T09:00:00Z', request_id: 'r3' }
];

const GRANTS = [
  {
    id: 'g-tro-ly', account_id: 'act-troly', employee_code: 'TROLY01', preset_code: 'TRO_LY_GD',
    capabilities: { view_monthly: true, view_violations: true, view_reports: true, export_data: true, review_monthly: true, record_violation: true },
    view_scope: { type: 'all_company', values: [] }, review_scope: { type: 'all_company', values: [] },
    record_scope: { type: 'all_company', values: [] }, export_scope: { type: 'all_company', values: [] },
    is_active: true, effective_from: '2020-01-01', effective_to: null, updated_at: '2026-01-01'
  }
];

require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true, exports: {
    createClient: () => ({
      from(table) {
        if (table === 'checklist_permission_grants') return staticTable(() => GRANTS);
        if (table === 'checklist_employee_assignments') return staticTable(() => ASSIGNMENTS);
        if (table === 'checklist_late_manager_observations') return staticTable(() => OBSERVATIONS);
        return staticTable(() => []);
      }
    })
  }
};

const service = require('../lib/checklist-late-reconciliation-service');

let failures = 0, passes = 0;
function check(condition, message) { if (!condition) { console.error('FAIL: ' + message); failures++; } else { passes++; console.log('PASS: ' + message); } }
async function checkAsync(label, fn) { try { await fn(); passes++; console.log('PASS: ' + label); } catch (e) { failures++; console.error('FAIL: ' + label + ' :: ' + (e && e.message || e)); } }

const adminSession = { role: 'admin', account: { id: 'admin-1', name: 'Admin' } };
const troLySession = { role: 'manager', account: { id: 'act-troly', name: 'Trợ lý' }, employeeCode: 'TROLY01' };

(async () => {
  await checkAsync('1. Admin gọi list observation -> PASS, thấy TOÀN BỘ (không giới hạn theo scope của Admin)', async () => {
    const { records } = await service.listAdminLateManagerObservations(adminSession, {});
    assert.strictEqual(records.length, 3);
  });

  await checkAsync('2. Non-Admin (Trợ lý, dù view_scope=all_company) gọi thẳng -> reject ADMIN_ONLY, KHÔNG dùng chung capability view', async () => {
    await assert.rejects(
      () => service.listAdminLateManagerObservations(troLySession, {}),
      (err) => { assert.strictEqual(err.code, 'CHECKLIST_LATE_RECON_ADMIN_ONLY'); return true; }
    );
  });

  await checkAsync('3a. Filter dateFrom/dateTo đúng', async () => {
    const { records } = await service.listAdminLateManagerObservations(adminSession, { dateFrom: '2026-08-10', dateTo: '2026-08-12' });
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].id, 'o2');
  });

  await checkAsync('3b. Filter employeeCode đúng', async () => {
    const { records } = await service.listAdminLateManagerObservations(adminSession, { employeeCode: 'phf001' });
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].employee_code, 'PHF001');
  });

  await checkAsync('3c. Filter managerDecision đúng (approved)', async () => {
    const { records } = await service.listAdminLateManagerObservations(adminSession, { managerDecision: 'approved' });
    assert.strictEqual(records.length, 2);
    assert.ok(records.every(r => r.manager_decision === 'approved'));
  });

  await checkAsync('3d. managerDecision không hợp lệ bị bỏ qua (không lọc, không throw)', async () => {
    const { records } = await service.listAdminLateManagerObservations(adminSession, { managerDecision: 'bogus' });
    assert.strictEqual(records.length, 3);
  });

  await checkAsync('4. Reviewer/Trợ lý flow hiện hữu (listManagerLateObservations) không regression — vẫn thấy toàn công ty theo view_scope=all_company', async () => {
    const { records } = await service.listManagerLateObservations(troLySession, {});
    assert.strictEqual(records.length, 3);
  });

  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures ? 1 : 0);
})();
