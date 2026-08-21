'use strict';
/* Regression: Organization Master Cutover — Checklist Write Lock (app layer,
   lib/checklist-assignments.js). Chay logic san xuat that qua stub Supabase
   trong require.cache (cung ky thuat voi test-ai-org-directory.js). Khong co
   test nao truoc do goi truc tiep lib/checklist-assignments.js nen viet moi
   de chung minh: (1) org field client gui len KHONG duoc ghi, luon lay tu
   employee_profiles; (2) domain field (employee_status/leave_until/
   status_note/reason) van ghi binh thuong; (3) listChecklistAssignments
   chieu (project) gia tri Employee Master hien hanh, khong phai gia tri cu
   luu trong bang; (4) nhan vien chua co employee_profiles -> giu gia tri cu,
   khong blank, khong lay tu client. */

const assert = require('assert');
const SUPABASE_MODULE_PATH = require.resolve('@supabase/supabase-js');

function stubSupabase(STATE) {
  function upperIn(rows, col, vals) {
    const set = new Set(vals.map(v => String(v || '').toUpperCase()));
    return rows.filter(r => set.has(String(r[col] || '').toUpperCase()));
  }
  function tableApi(table) {
    return {
      select() {
        return {
          order() { return Promise.resolve({ data: STATE[table] || [], error: null }); },
          in(col, vals) { return Promise.resolve({ data: upperIn(STATE[table] || [], col, vals), error: null }); }
        };
      }
    };
  }
  function rpc(name, args) {
    if (name !== 'phf_save_checklist_assignments') return Promise.resolve({ data: null, error: { message: 'unexpected rpc ' + name } });
    let changed = 0;
    (args.p_rows || []).forEach(item => {
      const idx = STATE.checklist_employee_assignments.findIndex(r => r.employee_key === item.employee_key);
      const row = { ...(idx >= 0 ? STATE.checklist_employee_assignments[idx] : {}), ...item, updated_at: new Date().toISOString() };
      if (idx >= 0) STATE.checklist_employee_assignments[idx] = row; else STATE.checklist_employee_assignments.push(row);
      changed++;
    });
    return Promise.resolve({ data: { saved: (args.p_rows || []).length, changed }, error: null });
  }
  require.cache[SUPABASE_MODULE_PATH] = {
    id: SUPABASE_MODULE_PATH, filename: SUPABASE_MODULE_PATH, loaded: true,
    exports: { createClient: () => ({ from: (t) => tableApi(t), rpc }) }
  };
  delete require.cache[require.resolve('../api/_lib/checklist-assignments')];
}

function t(name, fn) { return fn().then(() => console.log('PASS', name)).catch(e => { console.error('FAIL', name, '-', e.message); process.exitCode = 1; }); }

async function run() {
  const STATE = {
    employee_profiles: [
      { employee_code: 'E001', full_name: 'Nguyễn Văn A', department: 'Ban giám đốc', title: 'Giám đốc', position: '', branch: 'Trụ sở', manager_employee_code: '' },
      { employee_code: 'E002', full_name: 'Trần Thị B', department: 'Bán hàng', title: 'Trưởng ca', position: '', branch: 'Phú Lợi', manager_employee_code: 'E001' }
      // E003 co mat trong checklist nhung KHONG co employee_profiles -> fallback case
    ],
    checklist_employee_assignments: [
      { employee_key: 'e002', employee_id: '', employee_code: 'E002', employee_name: 'Trần Thị B', department: 'Bán hàng', title: 'Trưởng ca', position: '', branch: 'Phú Lợi', manager_id: '', manager_code: 'E001', manager_name: 'Nguyễn Văn A', employee_status: 'Đang làm việc', leave_until: null, status_note: '', template_id: 'tmpl-1', template_version: 'v1', effective_date: '2026-01-01', reason: '', updated_at: '2026-01-01T00:00:00Z' },
      { employee_key: 'e003', employee_id: '', employee_code: 'E003', employee_name: 'Lê Văn C', department: 'STALE DEPT', title: 'STALE TITLE', position: 'STALE POS', branch: 'STALE BRANCH', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', leave_until: null, status_note: '', template_id: '', template_version: '', effective_date: '2026-01-01', reason: '', updated_at: '2026-01-01T00:00:00Z' }
    ]
  };
  stubSupabase(STATE);
  const { listChecklistAssignments, saveChecklistAssignments } = require('../api/_lib/checklist-assignments');
  const adminSession = { role: 'admin', account: { id: 'admin-1', name: 'Admin' } };

  await t('1. Client gửi mutation org field (department/title/branch/manager) bị bỏ qua, ghi đúng giá trị Employee Master', async () => {
    const res = await saveChecklistAssignments(adminSession, [{
      employeeKey: 'e002', employeeCode: 'E002', employeeName: 'Trần Thị B',
      department: 'PHÒNG BAN GIẢ MẠO', title: 'CHỨC DANH GIẢ MẠO', branch: 'CHI NHÁNH GIẢ MẠO', managerCode: 'E999',
      employeeStatus: 'Đang làm việc', effectiveDate: '2026-08-10', reason: 'test'
    }]);
    const saved = res.assignments.find(a => a.employeeCode === 'E002');
    assert.strictEqual(saved.department, 'Bán hàng');
    assert.strictEqual(saved.title, 'Trưởng ca');
    assert.strictEqual(saved.branch, 'Phú Lợi');
    assert.strictEqual(saved.managerCode, 'E001');
    assert.strictEqual(saved.managerName, 'Nguyễn Văn A');
  });

  await t('2. Domain field (employee_status/leave_until/status_note/reason) vẫn ghi đúng theo client', async () => {
    const res = await saveChecklistAssignments(adminSession, [{
      employeeKey: 'e002', employeeCode: 'E002', employeeName: 'Trần Thị B',
      employeeStatus: 'Nghỉ dài hạn', leaveUntil: '2026-09-01', statusNote: 'Nghỉ thai sản',
      effectiveDate: '2026-08-10', reason: 'Cập nhật trạng thái nghỉ dài hạn'
    }]);
    const saved = res.assignments.find(a => a.employeeCode === 'E002');
    assert.strictEqual(saved.employeeStatus, 'Nghỉ dài hạn');
    assert.strictEqual(saved.leaveUntil, '2026-09-01');
    assert.strictEqual(saved.statusNote, 'Nghỉ thai sản');
    assert.strictEqual(saved.reason, 'Cập nhật trạng thái nghỉ dài hạn');
  });

  await t('3. listChecklistAssignments chiếu giá trị Employee Master hiện hành, không phải giá trị cũ lưu trong bảng', async () => {
    STATE.employee_profiles[0].department = 'Ban giám đốc (đã đổi)';
    STATE.checklist_employee_assignments.push({ employee_key: 'e001', employee_id: '', employee_code: 'E001', employee_name: 'Nguyễn Văn A', department: 'STALE', title: 'STALE', position: '', branch: 'STALE', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', leave_until: null, status_note: '', template_id: '', template_version: '', effective_date: '2026-01-01', reason: '', updated_at: '2026-01-01T00:00:00Z' });
    const list = await listChecklistAssignments();
    const e001 = list.assignments.find(a => a.employeeCode === 'E001');
    assert.strictEqual(e001.department, 'Ban giám đốc (đã đổi)');
  });

  await t('4. Nhân viên chưa có employee_profiles -> giữ nguyên giá trị cũ đã lưu, không blank, không lấy theo client', async () => {
    const res = await saveChecklistAssignments(adminSession, [{
      employeeKey: 'e003', employeeCode: 'E003', employeeName: 'Lê Văn C',
      department: 'CLIENT TỰ GÕ', title: 'CLIENT TỰ GÕ', branch: 'CLIENT TỰ GÕ',
      employeeStatus: 'Đang làm việc', effectiveDate: '2026-08-10', reason: 'test'
    }]);
    const saved = res.assignments.find(a => a.employeeCode === 'E003');
    assert.strictEqual(saved.department, 'STALE DEPT');
    assert.strictEqual(saved.title, 'STALE TITLE');
    assert.strictEqual(saved.branch, 'STALE BRANCH');
  });

  if (process.exitCode) { console.error('\nSome tests FAILED'); process.exit(1); }
  console.log('\nALL PASS - test-checklist-org-write-lock-1.50.8.js');
}

run().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
