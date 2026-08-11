'use strict';
/*
 * KNL Employee Competency Assignment — design/logic validation, KHÔNG chạm DB.
 *
 * Môi trường này không có Postgres/Supabase instance riêng (dev/staging) để
 * chạy thật migration PHF_KNL_EMPLOYEE_COMPETENCY_ASSIGNMENT_1.52.0_DRAFT.sql
 * và RPC knl_set_employee_competency_assignment — chỉ có 1 project Supabase
 * Production duy nhất trong .env, và batch này CẤM ghi/migrate Production.
 *
 * File này validate phần logic THUẦN (action derivation + giới hạn hồi tố)
 * bằng cách port lại chính xác nhánh quyết định trong RPC (xem file .sql cùng
 * tên/kỳ) sang JS thuần, để bắt lỗi thiết kế TRƯỚC khi ai đó chuyển sang SQL
 * thật. Đây KHÔNG thay thế test tích hợp thật trên Postgres (cần làm riêng,
 * trên 1 Supabase project/branch KHÔNG PHẢI Production, trước khi apply thật
 * — ghi rõ trong report là residual risk).
 *
 * Chạy: node scripts/test-knl-competency-assignment-design-2026-08.js
 */

function deriveAction(old, input, today) {
  if (!old) return 'CREATE';
  if (input.effectiveFrom < today) return 'RETROACTIVE_CHANGE';
  if (old.status === 'PROVISIONAL' && input.status === 'CONFIRMED'
      && old.frameworkVersionId === input.frameworkVersionId
      && old.competencyGradeId === input.competencyGradeId) return 'CONFIRM';
  return 'SUPERSEDE';
}

function validateRetroactiveBound(old, input) {
  if (old && input.effectiveFrom < old.effectiveFrom) {
    const e = new Error('KNL_COMPETENCY_RETROACTIVE_BEYOND_CURRENT_PERIOD');
    e.code = 'KNL_COMPETENCY_RETROACTIVE_BEYOND_CURRENT_PERIOD';
    throw e;
  }
}

function validateRetroactiveReason(input, today) {
  if (input.effectiveFrom < today && String(input.reason || '').trim().length < 5) {
    const e = new Error('KNL_COMPETENCY_RETROACTIVE_REASON_REQUIRED');
    e.code = 'KNL_COMPETENCY_RETROACTIVE_REASON_REQUIRED';
    throw e;
  }
}

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}

const TODAY = '2026-08-11';

// ---- CASE 1: chưa có assignment nào -> CREATE ----
check(deriveAction(null, { effectiveFrom: '2026-08-01' }, TODAY) === 'CREATE', '1. Chưa có assignment -> action=CREATE');

// ---- CASE 2: baseline 2026-08-01, hôm nay 2026-08-11 -> retroactive vì effective_from < today ----
check(deriveAction(null, { effectiveFrom: '2026-08-01' }, TODAY) === 'CREATE', '2a. Vẫn CREATE (chưa có old) dù effective_from ở quá khứ - action ưu tiên CREATE khi chưa có row nào, không lẫn RETROACTIVE_CHANGE');
let threw = null;
try { validateRetroactiveReason({ effectiveFrom: '2026-08-01', reason: '' }, TODAY); } catch (e) { threw = e; }
check(!!threw && threw.code === 'KNL_COMPETENCY_RETROACTIVE_REASON_REQUIRED', '2b. Baseline 2026-08-01 (quá khứ so với hôm nay 2026-08-11) không có reason -> reject KNL_COMPETENCY_RETROACTIVE_REASON_REQUIRED (đúng cách baseline batch sẽ luôn kèm reason cố định để pass)');
threw = null;
try { validateRetroactiveReason({ effectiveFrom: '2026-08-01', reason: 'PHF baseline 08/2026 theo danh sách đối soát ban đầu.' }, TODAY); } catch (e) { threw = e; }
check(!threw, '2c. Baseline có reason đủ dài -> pass validation hồi tố');

// ---- CASE 3: CONFIRM — cùng framework/grade, chỉ đổi PROVISIONAL->CONFIRMED, effective_from = hôm nay ----
const provisional = { status: 'PROVISIONAL', frameworkVersionId: 'v1', competencyGradeId: 'g-B1', effectiveFrom: '2026-08-01' };
check(deriveAction(provisional, { status: 'CONFIRMED', frameworkVersionId: 'v1', competencyGradeId: 'g-B1', effectiveFrom: TODAY }, TODAY) === 'CONFIRM', '3. PROVISIONAL->CONFIRMED cùng grade, effective_from=hôm nay -> action=CONFIRM');

// ---- CASE 4: CONFIRM nhưng đổi cả grade (đánh giá thực tế khác baseline) -> vẫn SUPERSEDE, không phải CONFIRM thuần ----
check(deriveAction(provisional, { status: 'CONFIRMED', frameworkVersionId: 'v1', competencyGradeId: 'g-B2', effectiveFrom: TODAY }, TODAY) === 'SUPERSEDE', '4. Confirm nhưng đổi grade khác baseline -> action=SUPERSEDE (không phải CONFIRM thuần, vì nội dung grade thực sự đổi) — vẫn audit đủ before/after grade cũ/mới qua history row');

// ---- CASE 5: đổi framework/grade bình thường (thăng bậc, chuyển vị trí) -> SUPERSEDE ----
const confirmed = { status: 'CONFIRMED', frameworkVersionId: 'v1', competencyGradeId: 'g-B2', effectiveFrom: '2026-08-01' };
check(deriveAction(confirmed, { status: 'CONFIRMED', frameworkVersionId: 'v1', competencyGradeId: 'g-B3', effectiveFrom: TODAY }, TODAY) === 'SUPERSEDE', '5. Thăng bậc B2->B3 -> action=SUPERSEDE');

// ---- CASE 6: RETROACTIVE_CHANGE — có old, effective_from mới < hôm nay ----
check(deriveAction(confirmed, { status: 'CONFIRMED', frameworkVersionId: 'v1', competencyGradeId: 'g-B3', effectiveFrom: '2026-08-05' }, TODAY) === 'RETROACTIVE_CHANGE', '6. Có old, effective_from mới (2026-08-05) < hôm nay (2026-08-11) -> action=RETROACTIVE_CHANGE (ưu tiên cao hơn SUPERSEDE)');

// ---- CASE 7: retroactive bound — không cho lùi trước effective_from của assignment đang active ----
threw = null;
try { validateRetroactiveBound(confirmed /* effectiveFrom=2026-08-01 */, { effectiveFrom: '2026-07-15' }); }
catch (e) { threw = e; }
check(!!threw && threw.code === 'KNL_COMPETENCY_RETROACTIVE_BEYOND_CURRENT_PERIOD', '7a. Chọn effective_from (2026-07-15) TRƯỚC effective_from của assignment đang active (2026-08-01) -> reject, không cho sửa vào lịch sử đã đóng');
threw = null;
try { validateRetroactiveBound(confirmed, { effectiveFrom: '2026-08-01' }); }
catch (e) { threw = e; }
check(!threw, '7b. Chọn đúng effective_from = effective_from hiện tại (sửa lại chính giai đoạn đang mở) -> KHÔNG reject, hợp lệ');
threw = null;
try { validateRetroactiveBound(confirmed, { effectiveFrom: '2026-08-20' }); }
catch (e) { threw = e; }
check(!threw, '7c. Chọn effective_from tương lai (2026-08-20) -> không liên quan retroactive bound, không reject');

// ---- CASE 8: no-overlap conceptual check — sau khi SUPERSEDE, old.effective_to phải = new.effective_from (contiguous, không gap không overlap) ----
function simulateSupersede(oldRow, newEffectiveFrom) {
  return { closedOld: { ...oldRow, isActive: false, effectiveTo: newEffectiveFrom }, newRow: { effectiveFrom: newEffectiveFrom, effectiveTo: null, isActive: true } };
}
const sim = simulateSupersede({ ...confirmed, effectiveFrom: '2026-08-01', effectiveTo: null, isActive: true }, '2026-08-11');
check(sim.closedOld.effectiveTo === sim.newRow.effectiveFrom, '8. old.effective_to === new.effective_from (half-open interval [from,to), không gap/không overlap theo đúng convention EXCLUDE constraint daterange đã thiết kế trong SQL)');

if (failures) {
  console.error('\n' + failures + ' check(s) failed.');
  process.exit(1);
}
console.log('\nALL PASS (design-logic only — CHƯA test RPC/constraint thật trên Postgres, xem ghi chú đầu file)');
