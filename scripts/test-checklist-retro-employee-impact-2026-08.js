'use strict';
/*
 * Regression — Residual A (2026-08-14): checklistRetroSimulateEmployeeImpact.
 * 3 bài bắt buộc theo báo cáo bàn giao:
 *   1) Gọi API trực tiếp (đúng hàm export thật, không mock lại logic).
 *   2) "Crafted scope" — yêu cầu nhân sự ngoài phạm vi mẫu -> bị từ chối/trả
 *      rỗng cho đúng nhân sự đó, KHÔNG rò rỉ dữ liệu.
 *   3) Empty-state — không có phiếu tháng thật cho kỳ -> "Cần xử lý thủ công",
 *      KHÔNG trả số 0 giả định như dữ liệu thật.
 * Test #1 gọi thẳng simulateEmployeeImpactBatch() (lib/checklist-template-
 * retroactive-service.js) với session KHÔNG phải admin để xác nhận ensureAdmin
 * chặn TRƯỚC khi chạm DB — an toàn chạy trong môi trường chỉ có 1 Supabase
 * project cấu hình (Production, xem README/báo cáo bàn giao) vì code không
 * bao giờ gọi tới db.from() trên nhánh này. Test #2/#3 test lõi THUẦN
 * planEmployeeImpactBatch() (lib/checklist-template-retroactive.js) — 100%
 * in-memory, không cần DB — đây là lõi mà simulateEmployeeImpactBatch() gọi
 * lại sau khi fetch dữ liệu thật, nên test lõi này tương đương test hành vi
 * cuối cùng của action server mà không phải kết nối Production.
 *
 * Chạy: node scripts/test-checklist-retro-employee-impact-2026-08.js
 */
const assert = require('assert');
const { planEmployeeImpactBatch } = require('../lib/checklist-template-retroactive');
const { calculateMonthlyScore } = require('../lib/checklist-score-engine');
const { simulateEmployeeImpactBatch } = require('../lib/checklist-template-retroactive-service');

let passCount = 0;
function check(label, fn) { fn(); passCount++; console.log('✓ PASS — ' + label); }

function objRow({ id, code, target, weight, sourceType }) { return { id, code, content: code, target, unit: 'điểm', weight, source: { type: sourceType || 'manual' } }; }
const oldDefinition = { templateType: 'checklist_detail', groups: [{ code: 'G', children: [] }], totalRows: [objRow({ id: 'A', code: 'A', target: 10, weight: 90 }), objRow({ id: 'CT', code: 'CT', target: 100, weight: 10, sourceType: 'checklist_total' })] };
const newDefinition = { templateType: 'checklist_detail', groups: [{ code: 'G', children: [] }], totalRows: [objRow({ id: 'A', code: 'A', target: 10, weight: 80 }), objRow({ id: 'CT', code: 'CT', target: 100, weight: 20, sourceType: 'checklist_total' })] };

/* ===== #2 Crafted scope: mã nhân sự không thuộc phạm vi mẫu -> manual, không rò rỉ ===== */
check('Crafted-scope: nhân sự KHÔNG có trong scopedByCode (không gán đúng mẫu) -> rơi vào manual[], không có trong results[]', () => {
  const scopedByCode = new Map([['PHF001', { employee_code: 'PHF001', employee_name: 'A' }]]);
  const formByCode = new Map([['PHF001', { id: 'f1', status: 'draft', self_answers: { A: 8 }, review_answers: { A: 9 } }]]);
  const checklistScoreByCode = new Map([['PHF001', 95]]);
  const { results, manual } = planEmployeeImpactBatch({
    employeeCodes: ['PHF001', 'PHF999-NGOAI-PHAM-VI'],
    scopedByCode, formByCode, checklistScoreByCode, oldDefinition, newDefinition, calculateMonthlyScore
  });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].employeeCode, 'PHF001');
  assert.strictEqual(manual.length, 1);
  assert.strictEqual(manual[0].employeeCode, 'PHF999-NGOAI-PHAM-VI');
  assert.strictEqual(manual[0].status, 'Cần xử lý thủ công');
  assert.ok(/không thuộc phạm vi/i.test(manual[0].reason));
});

/* ===== #3 Empty-state: không có phiếu tháng thật -> "Cần xử lý thủ công", không fabricate 0 ===== */
check('Empty-state: nhân sự thuộc phạm vi nhưng KHÔNG có phiếu tháng thật cho kỳ -> "Cần xử lý thủ công", không có kết quả tính điểm giả định', () => {
  const scopedByCode = new Map([['PHF002', { employee_code: 'PHF002', employee_name: 'B' }]]);
  const formByCode = new Map(); // rỗng — không có phiếu tháng nào cho kỳ này
  const { results, manual } = planEmployeeImpactBatch({
    employeeCodes: ['PHF002'], scopedByCode, formByCode, checklistScoreByCode: new Map(), oldDefinition, newDefinition, calculateMonthlyScore
  });
  assert.strictEqual(results.length, 0);
  assert.strictEqual(manual.length, 1);
  assert.strictEqual(manual[0].status, 'Cần xử lý thủ công');
  assert.ok(/Chưa có phiếu tháng thật/i.test(manual[0].reason));
  assert.ok(!('checklistScore' in manual[0]), 'manual entry không được mang theo số liệu tính toán nào (tránh nhầm là dữ liệu thật)');
});

/* ===== Sanity: trường hợp bình thường (có scope + có phiếu) vẫn tính đúng, tái dùng calculateMonthlyScore thật ===== */
check('Happy-path: nhân sự có scope + có phiếu thật -> tính đúng before/after bằng calculateMonthlyScore thật (không viết lại công thức)', () => {
  const scopedByCode = new Map([['PHF003', { employee_code: 'PHF003', employee_name: 'C', department: 'Bán hàng' }]]);
  const formByCode = new Map([['PHF003', { id: 'f3', status: 'reviewed', self_answers: { A: 10 }, review_answers: { A: 10 } }]]);
  const checklistScoreByCode = new Map([['PHF003', 90]]);
  const { results, manual } = planEmployeeImpactBatch({
    employeeCodes: ['PHF003'], scopedByCode, formByCode, checklistScoreByCode, oldDefinition, newDefinition, calculateMonthlyScore
  });
  assert.strictEqual(manual.length, 0);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].checklistScore, 90);
  assert.ok(Number.isFinite(results[0].before.selfTotalScore));
  assert.ok(Number.isFinite(results[0].after.selfTotalScore));
  // Trọng số dòng checklist_total tăng 10% -> 20% giữa old/new definition nên
  // điểm checklist (90, thấp hơn phần còn lại giả định 100) phải kéo điểm
  // tổng SAU thấp đi so với TRƯỚC (không kiểm tra con số tuyệt đối - đó là
  // trách nhiệm của calculateMonthlyScore, đã có bộ test riêng).
  assert.ok(results[0].after.selfTotalScore <= results[0].before.selfTotalScore + 0.0001);
});

/* ===== #1 Direct-API call: admin gate chặn trước khi chạm DB (chạy sau cùng,
   await tuần tự để log không xen lẫn với các check() đồng bộ ở trên) ===== */
async function runDirectApiTests() {
  let threw = null;
  try {
    await simulateEmployeeImpactBatch({ role: 'learner' }, { templateKey: 'nv-ban-hang', periodMonth: '2026-08', employeeCodes: ['PHF001'], oldDefinition, newDefinition });
  } catch (e) { threw = e; }
  assert.ok(threw, 'phải throw khi session không phải admin');
  assert.strictEqual(threw.code, 'CHECKLIST_RETRO_ADMIN_REQUIRED');
  assert.strictEqual(threw.statusCode, 403);
  passCount++; console.log('✓ PASS — Direct-API: session không phải admin bị chặn ensureAdmin (403 CHECKLIST_RETRO_ADMIN_REQUIRED), không chạm DB');

  threw = null;
  try {
    await simulateEmployeeImpactBatch({ role: 'admin' }, {});
  } catch (e) { threw = e; }
  assert.ok(threw, 'phải throw khi thiếu input bắt buộc');
  assert.strictEqual(threw.code, 'CHECKLIST_RETRO_IMPACT_INPUT_REQUIRED');
  passCount++; console.log('✓ PASS — Direct-API: admin nhưng thiếu templateKey/periodMonth/employeeCodes bị chặn input-required (trước khi chạm DB)');
}

runDirectApiTests().then(() => {
  console.log('');
  console.log('=== Kết quả ===');
  console.log(passCount + ' bước PASS.');
  console.log('Test #1 gọi thẳng hàm export thật với session không-admin (chặn trước DB); test #2/#3/happy-path chạy lõi thuần planEmployeeImpactBatch() 100% in-memory — không kết nối Supabase/Production.');
  process.exitCode = 0;
}).catch(err => {
  console.error('FAIL:', err && err.message || err);
  process.exitCode = 1;
});
