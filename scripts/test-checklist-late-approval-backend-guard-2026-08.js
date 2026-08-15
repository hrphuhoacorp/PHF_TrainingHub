'use strict';
/*
 * Regression Test — P0 backend guard (2026-08-15): approveLateEvents()/createLinkedAdjustment()
 * PHẢI bị khóa ở BACKEND khi LATE_APPROVAL_ENABLED=false (không chỉ ẩn nút UI) — không tạo
 * official violation, không ghi điểm. Môi trường chỉ có 1 project Supabase cấu hình và đó là
 * Production, nên test này KHÔNG gọi live network: guard phải chặn NGAY sau requireAdmin()/
 * requireDb(), TRƯỚC bất kỳ lệnh .from(...) nào chạm DB — kiểm chứng bằng cách gọi hàm thật
 * (không mock network) và xác nhận nó reject với đúng mã lỗi trước khi có cơ hội gọi Supabase.
 *   node scripts/test-checklist-late-approval-backend-guard-2026-08.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const service = require('../lib/checklist-late-reconciliation-service');

let passCount = 0;
function check(label, fn) { fn(); passCount++; console.log('✓ PASS — ' + label); }
async function checkAsync(label, fn) { await fn(); passCount++; console.log('✓ PASS — ' + label); }

const SERVICE_SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'checklist-late-reconciliation-service.js'), 'utf8');

async function main() {
  check('LATE_APPROVAL_ENABLED mặc định = false (hằng số cứng, không đọc process.env)', () => {
    assert.ok(/const LATE_APPROVAL_ENABLED = false;/.test(SERVICE_SRC), 'LATE_APPROVAL_ENABLED phải khai báo cứng = false');
    assert.ok(!/LATE_APPROVAL_ENABLED\s*=\s*.*process\.env/.test(SERVICE_SRC), 'LATE_APPROVAL_ENABLED không được đọc từ env — đây là quyết định nghiệp vụ có chủ đích');
  });

  check('approveLateEvents(): gọi requireLateApprovalEnabled() NGAY SAU requireAdmin()/requireDb(), TRƯỚC vòng lặp chạm DB', () => {
    const fn = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function approveLateEvents'), SERVICE_SRC.indexOf('function cryptoRandomUuid'));
    const guardIdx = fn.indexOf('requireLateApprovalEnabled()');
    const firstDbCallIdx = fn.indexOf('supabase.from(');
    assert.ok(guardIdx > -1, 'approveLateEvents phải gọi requireLateApprovalEnabled()');
    assert.ok(guardIdx < firstDbCallIdx, 'guard phải chạy TRƯỚC lệnh chạm DB đầu tiên (không tạo official violation trước khi bị chặn)');
  });

  check('createLinkedAdjustment(): gọi requireLateApprovalEnabled() NGAY SAU requireAdmin()/requireDb(), TRƯỚC cancelChecklistViolation()/insert', () => {
    const fn = SERVICE_SRC.slice(SERVICE_SRC.indexOf('async function createLinkedAdjustment'), SERVICE_SRC.indexOf('async function exportLateReconciliation'));
    const guardIdx = fn.indexOf('requireLateApprovalEnabled()');
    const firstMutateIdx = fn.indexOf('cancelChecklistViolation(');
    assert.ok(guardIdx > -1, 'createLinkedAdjustment phải gọi requireLateApprovalEnabled()');
    assert.ok(guardIdx < firstMutateIdx, 'guard phải chạy TRƯỚC khi hủy bản ghi cũ/tạo bản ghi mới');
  });

  check('requireLateApprovalEnabled() throw đúng mã CHECKLIST_LATE_APPROVAL_NOT_ACTIVATED khi flag=false', () => {
    const guardFn = SERVICE_SRC.slice(SERVICE_SRC.indexOf('function requireLateApprovalEnabled'), SERVICE_SRC.indexOf('function requireLateApprovalEnabled') + 400);
    assert.ok(/CHECKLIST_LATE_APPROVAL_NOT_ACTIVATED/.test(guardFn), 'phải dùng đúng mã lỗi semantic CHECKLIST_LATE_APPROVAL_NOT_ACTIVATED');
  });

  /* Gọi hàm THẬT (không mock) với session admin hợp lệ — vì guard chạy trước mọi lệnh DB,
     lời gọi này PHẢI reject ngay, không request Supabase Production, xác nhận bằng chứng sống
     (không chỉ đọc source) rằng backend boundary thật sự chặn được ở runtime. */
  await checkAsync('approveLateEvents(): gọi thật với session admin -> reject CHECKLIST_LATE_APPROVAL_NOT_ACTIVATED, không tạo official violation', async () => {
    const adminSession = { role: 'admin', account: { id: 'test-admin', name: 'Test Admin' } };
    await assert.rejects(
      () => service.approveLateEvents(adminSession, [{ importRowId: 'row-guard-test', adminDecision: 'apply_no_permission_points' }]),
      (err) => {
        assert.strictEqual(err.code, 'CHECKLIST_LATE_APPROVAL_NOT_ACTIVATED');
        assert.strictEqual(err.statusCode, 403);
        return true;
      }
    );
  });

  await checkAsync('createLinkedAdjustment(): gọi thật với session admin -> reject CHECKLIST_LATE_APPROVAL_NOT_ACTIVATED, không tạo bản ghi điều chỉnh', async () => {
    const adminSession = { role: 'admin', account: { id: 'test-admin', name: 'Test Admin' } };
    await assert.rejects(
      () => service.createLinkedAdjustment(adminSession, { originalViolationId: 'v-guard-test', importRowId: 'row-guard-test', reason: 'Kiểm tra guard backend đủ 10 ký tự' }),
      (err) => {
        assert.strictEqual(err.code, 'CHECKLIST_LATE_APPROVAL_NOT_ACTIVATED');
        assert.strictEqual(err.statusCode, 403);
        return true;
      }
    );
  });

  check('recordManagerLateObservation/listManagerLateObservations KHÔNG bị đụng tới bởi guard (manager observation vẫn hoạt động bình thường ở phase-1)', () => {
    assert.ok(!/function recordManagerLateObservation[\s\S]{0,600}requireLateApprovalEnabled/.test(SERVICE_SRC), 'recordManagerLateObservation không được gọi guard này — đây KHÔNG phải hành động tạo official violation');
  });

  console.log('\n' + passCount + ' bài kiểm tra P0 backend guard (approveLateEvents/createLinkedAdjustment) đều PASS.');
}

main().catch((err) => {
  console.error('FAIL:', err && err.message || err);
  process.exit(1);
});
