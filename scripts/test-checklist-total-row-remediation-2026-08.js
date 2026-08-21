'use strict';
/*
 * Regression cho lib/checklist-template-total-row-remediation.js — sau khi
 * FINAL SANITY GATE (2026-08-14) xác nhận không có bằng chứng nguồn nào cho
 * trọng số 10% từng gán cho dòng checklist_total, engine được viết lại thành
 * DETECT-ONLY: không còn chọn trọng số, không còn co giãn dòng nào, không
 * còn addedRow/newRowWeight/DEFAULT_CHECKLIST_ROW_WEIGHT. Test dưới đây khẳng
 * định đúng hợp đồng mới và chứng minh KHÔNG có hằng số trọng số mặc định
 * nào còn sót lại trong module.
 * Chạy: node scripts/test-checklist-total-row-remediation-2026-08.js
 */
const remediationModule = require('../api/_lib/checklist-template-total-row-remediation');
const { planTotalRowRemediation } = remediationModule;
const { validateScoredDefinition, isChecklistTotalRow } = require('../api/_lib/checklist-templates');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('FAIL: ' + name); } }

// 0) Module không còn export bất kỳ hằng số trọng số/label/code mặc định
// nào — chứng minh không còn nơi nào để "lách" hardcode một con số trọng số.
(function testNoDefaultWeightExported() {
  const keys = Object.keys(remediationModule);
  ok('module chỉ export planTotalRowRemediation (không export hằng số trọng số/label/code mặc định)', keys.length === 1 && keys[0] === 'planTotalRowRemediation');
  ok('function arity vẫn chỉ nhận definition — không có options/newRowWeight nào có thể set trọng số', planTotalRowRemediation.length === 1);
})();

// 1) Mẫu KHÔNG dùng Checklist scoring (groups=[], templateType='score_summary')
// -> action='none' (false-positive check, không đổi).
(function testNonChecklistUntouched() {
  const def = { templateType: 'score_summary', groups: [], totalRows: [{ code: 'X', target: 100, weight: 100, source: { type: 'manual' } }] };
  const plan = planTotalRowRemediation(def);
  ok('non-checklist: action=none', plan.action === 'none');
  ok('non-checklist: definition unchanged (same reference)', plan.definition === def);
  ok('non-checklist: changed=false', plan.changed === false);
})();

// 2) Mẫu dùng Checklist scoring, THIẾU checklist_total row, dạng array-row
// -> action='needs-admin-input', KHÔNG thêm dòng, KHÔNG đổi trọng số nào,
// definition trả về y hệt definition đầu vào (reference-equal).
(function testArrayRowNeedsAdminInput() {
  const def = {
    templateType: 'checklist_detail',
    groups: [{ code: 'G', name: 'Nhóm', children: [{ code: 'C', name: 'Con', items: [['X-01', 'Tiêu chí', 1]] }] }],
    totalRows: [
      [1, 'A', 'Tiêu chí A', 10, 'điểm', 30, 'Không', { type: 'manual' }, 'A'],
      [2, 'B', 'Tiêu chí B', 10, 'điểm', 70, 'Không', { type: 'manual' }, 'B']
    ]
  };
  const plan = planTotalRowRemediation(def);
  ok('array-row: action=needs-admin-input', plan.action === 'needs-admin-input');
  ok('array-row: changed=false (engine không tự ghi gì)', plan.changed === false);
  ok('array-row: definition KHÔNG bị đổi (reference-equal với input)', plan.definition === def);
  ok('array-row: totalRows vẫn đúng 2 dòng gốc, KHÔNG có dòng checklist_total nào được thêm', plan.definition.totalRows.length === 2 && !plan.definition.totalRows.some(isChecklistTotalRow));
  ok('array-row: totalWeightBefore=100 (đúng tổng 2 dòng gốc, không co giãn)', Math.abs(plan.totalWeightBefore - 100) < 0.0001);
  ok('array-row: plan không có field addedRow/newRowWeight nào (không tồn tại nữa)', plan.addedRow === undefined && plan.newRowWeight === undefined && plan.totalWeightAfter === undefined);
  // Vì engine không remediate nữa, definition vẫn FAIL gate — đây là hành vi ĐÚNG, chờ Admin qua wizard.
  let validated = true; try { validateScoredDefinition(plan.definition); } catch (e) { validated = false; }
  ok('array-row: validateScoredDefinition() vẫn FAIL sau plan (đúng — chưa có Admin input)', validated === false);
})();

// 3) Mẫu dùng Checklist scoring, dạng object-row -> cùng hành vi.
(function testObjectRowNeedsAdminInput() {
  const def = {
    templateType: 'checklist_detail',
    groups: [{ code: 'G', name: 'Nhóm', children: [{ code: 'C', name: 'Con', items: [['X-01', 'Tiêu chí', 1]] }] }],
    totalRows: [
      { id: 'r1', code: 'A', target: 5, weight: 40, source: { type: 'manual' } },
      { id: 'r2', code: 'B', target: 5, weight: 60, source: { type: 'manual' } }
    ]
  };
  const plan = planTotalRowRemediation(def);
  ok('object-row: action=needs-admin-input', plan.action === 'needs-admin-input');
  ok('object-row: definition KHÔNG bị đổi', plan.definition === def);
  ok('object-row: totalWeightBefore=100', Math.abs(plan.totalWeightBefore - 100) < 0.0001);
})();

// 4) Idempotent: gọi lại nhiều lần trên cùng definition CHƯA remediate ->
// luôn trả về cùng 1 kết quả 'needs-admin-input', không có side-effect tích lũy.
(function testIdempotentDetectionOnly() {
  const def = {
    templateType: 'checklist_detail',
    groups: [{ code: 'G', name: 'Nhóm', children: [{ code: 'C', name: 'Con', items: [['X-01', 'Tiêu chí', 1]] }] }],
    totalRows: [[1, 'A', 'Tiêu chí A', 10, 'điểm', 100, 'Không', { type: 'manual' }, 'A']]
  };
  const plan1 = planTotalRowRemediation(def);
  const plan2 = planTotalRowRemediation(def);
  ok('idempotent: 2 lần gọi cùng action', plan1.action === plan2.action && plan1.action === 'needs-admin-input');
  ok('idempotent: definition đầu vào không hề bị mutate qua nhiều lần gọi', def.totalRows.length === 1 && !def.totalRows.some(isChecklistTotalRow));
})();

// 5) Definition đã có sẵn checklist_total row (giả lập Admin đã hoàn tất wizard)
// -> action='none', không đụng gì thêm.
(function testAlreadyHasRow() {
  const def = {
    templateType: 'checklist_detail',
    groups: [{ code: 'G', name: 'Nhóm', children: [{ code: 'C', name: 'Con', items: [['X-01', 'Tiêu chí', 1]] }] }],
    totalRows: [
      [1, 'A', 'Tiêu chí A', 10, 'điểm', 88, 'Không', { type: 'manual' }, 'A'],
      [2, 'B', 'checklist total', 100, 'điểm', 12, 'Không', { type: 'checklist_total' }, 'B']
    ]
  };
  const plan = planTotalRowRemediation(def);
  ok('already-has-row: action=none', plan.action === 'none');
  ok('already-has-row: definition trả về y hệt (reference-equal)', plan.definition === def);
  let validated = true; try { validateScoredDefinition(plan.definition); } catch (e) { validated = false; }
  ok('already-has-row: validateScoredDefinition() PASS (Admin đã tự chọn 12%, không phải mặc định engine)', validated === true);
})();

console.log('PASS: ' + pass + ' / FAIL: ' + fail);
process.exitCode = fail ? 1 : 0;
