'use strict';
/*
 * Regression Test — P0 backend guard (2026-08-15, UPDATED 2026-08-16 khi LATE_APPROVAL_ENABLED
 * chuyển sang true ở LOCAL): xác nhận guard requireLateApprovalEnabled() TỒN TẠI ĐÚNG VỊ TRÍ
 * trong approveLateEvents()/createLinkedAdjustment() (NGAY SAU requireAdmin()/requireDb(), TRƯỚC
 * bất kỳ lệnh .from(...) nào chạm DB) — đây là cơ chế cho phép TẮT approve chỉ bằng 1 hằng số
 * nếu cần rollback khẩn, không phụ thuộc UI. TOÀN BỘ test ở file này CHỈ đọc source (grep-guard),
 * KHÔNG gọi hàm thật/network — vì flag nay = true, gọi hàm thật KHÔNG mock sẽ chạm thẳng
 * Production Supabase (môi trường chỉ có 1 project và đó là Production). Test hành vi RUNTIME
 * thật của approve khi bật (idempotency/re-approve/points/audit) nằm ở
 * scripts/test-checklist-late-approval-activation-2026-08.js — dùng Supabase mock in-memory an
 * toàn, không chạm DB thật.
 *   node scripts/test-checklist-late-approval-backend-guard-2026-08.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const service = require('../api/_lib/checklist-late-reconciliation-service');

let passCount = 0;
function check(label, fn) { fn(); passCount++; console.log('✓ PASS — ' + label); }
async function checkAsync(label, fn) { await fn(); passCount++; console.log('✓ PASS — ' + label); }

const SERVICE_SRC = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'checklist-late-reconciliation-service.js'), 'utf8');

async function main() {
  check('LATE_APPROVAL_ENABLED = true (LOCAL activation 2026-08-16) — hằng số cứng, không đọc process.env (vẫn là quyết định nghiệp vụ có chủ đích, không phải cấu hình môi trường)', () => {
    assert.ok(/const LATE_APPROVAL_ENABLED = true;/.test(SERVICE_SRC), 'LATE_APPROVAL_ENABLED phải khai báo cứng = true (đã kích hoạt LOCAL)');
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

  /* 2026-08-16: LATE_APPROVAL_ENABLED nay = true ở module đang load thật (service đã require() ở
     đầu file) — KHÔNG được gọi service.approveLateEvents()/createLinkedAdjustment() thật ở đây
     nữa (sẽ vượt qua guard và chạm thẳng Supabase Production, môi trường chỉ có 1 project). Thay
     vào đó: verify CƠ CHẾ guard (hàm requireLateApprovalEnabled() + fail()) tự nó throw đúng mã
     lỗi khi hằng số = false, bằng cách eval lại source trong vm sandbox với hằng số bị ép về
     false — chứng minh guard code ĐÚNG (không chỉ đọc source tĩnh), độc lập với giá trị hiện tại
     đang chạy thật trong process (=true). */
  check('requireLateApprovalEnabled(): khi hằng số ép về false (mô phỏng), throw đúng CHECKLIST_LATE_APPROVAL_NOT_ACTIVATED/403 — verify cơ chế guard bằng runtime thật (vm sandbox, không chạm network)', () => {
    const vm = require('vm');
    const failFnSrc = SERVICE_SRC.slice(SERVICE_SRC.indexOf('function fail('), SERVICE_SRC.indexOf('function fail(') + SERVICE_SRC.slice(SERVICE_SRC.indexOf('function fail(')).indexOf('\n}') + 2);
    const guardFnSrc = SERVICE_SRC.slice(SERVICE_SRC.indexOf('function requireLateApprovalEnabled'), SERVICE_SRC.indexOf('function requireLateApprovalEnabled') + SERVICE_SRC.slice(SERVICE_SRC.indexOf('function requireLateApprovalEnabled')).indexOf('\n}') + 2);
    const sandbox = { console };
    vm.createContext(sandbox);
    const src = 'const LATE_APPROVAL_ENABLED = false;\n' + failFnSrc + '\n' + guardFnSrc + '\nthis.__guard = requireLateApprovalEnabled;';
    vm.runInContext(src, sandbox);
    assert.throws(() => sandbox.__guard(), (err) => {
      assert.strictEqual(err.code, 'CHECKLIST_LATE_APPROVAL_NOT_ACTIVATED');
      assert.strictEqual(err.statusCode, 403);
      return true;
    });
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
