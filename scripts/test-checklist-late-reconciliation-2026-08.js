'use strict';
/*
 * Regression Test — Workstream B (2026-08-14)
 * Đi trễ BCC, đối soát ghi nhận Trưởng ca và Admin phê duyệt. Toàn bộ chạy in-memory /
 * pure-JS — KHÔNG kết nối Supabase thật (môi trường này chỉ có 1 project cấu hình và đó là
 * project Production). An toàn chạy lại bất kỳ lúc nào:
 *   node scripts/test-checklist-late-reconciliation-2026-08.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const recon = require('../lib/checklist-late-reconciliation');
const { PRESETS } = require('../lib/checklist-permissions');
const { subjectMatchesScope } = require('../lib/checklist-scope');

let passCount = 0;
function check(label, fn) { fn(); passCount++; console.log('✓ PASS — ' + label); }

/* ================= Bảng điểm 4 mức: 3/6/8/12 ================= */
check('Bảng điểm Không xin phép: 4 mức đúng 3/6/8/12 theo phút', () => {
  assert.strictEqual(recon.standardNoPermissionPoints(1), 3);
  assert.strictEqual(recon.standardNoPermissionPoints(15), 3);
  assert.strictEqual(recon.standardNoPermissionPoints(16), 6);
  assert.strictEqual(recon.standardNoPermissionPoints(30), 6);
  assert.strictEqual(recon.standardNoPermissionPoints(31), 8);
  assert.strictEqual(recon.standardNoPermissionPoints(45), 8);
  assert.strictEqual(recon.standardNoPermissionPoints(46), 12);
  assert.strictEqual(recon.standardNoPermissionPoints(120), 12);
});

/* ================= Gợi ý điểm theo có/không xin phép/không có ghi nhận ================= */
check('Có xin phép -> gợi ý 0 điểm', () => {
  const shiftLead = [{ employeeCode: 'PHF001', occurredDate: '2026-08-10', managerDecision: 'approved', createdAt: '2026-08-10T08:00:00Z' }];
  const s = recon.computeSuggestion({ employeeCode: 'PHF001', occurredDate: '2026-08-10', minutesLate: 20 }, shiftLead);
  assert.strictEqual(s.managerDecision, 'approved');
  assert.strictEqual(s.suggestedPoints, 0);
  assert.strictEqual(s.standardPoints, 6); // vẫn giữ điểm chuẩn tham khảo dù gợi ý áp dụng = 0
});
check('Không xin phép -> gợi ý trừ theo băng phút', () => {
  const shiftLead = [{ employeeCode: 'PHF002', occurredDate: '2026-08-10', managerDecision: 'rejected', createdAt: '2026-08-10T08:00:00Z' }];
  const s = recon.computeSuggestion({ employeeCode: 'PHF002', occurredDate: '2026-08-10', minutesLate: 40 }, shiftLead);
  assert.strictEqual(s.managerDecision, 'rejected');
  assert.strictEqual(s.suggestedPoints, 8);
});
check('Không có ghi nhận Trưởng ca -> mặc định Không xin phép, nhãn rõ ràng', () => {
  const s = recon.computeSuggestion({ employeeCode: 'PHF003', occurredDate: '2026-08-10', minutesLate: 10 }, []);
  assert.strictEqual(s.managerDecision, 'no_record');
  assert.strictEqual(s.suggestedPoints, 3);
  assert.ok(/không có ghi nhận/i.test(s.suggestionLabel));
});

/* ================= Cảnh báo tần suất — THAM KHẢO, không bao giờ chặn/đổi điểm ================= */
check('Cảnh báo tần suất: vượt ngưỡng tham khảo vẫn KHÔNG đổi suggestedPoints và vẫn duyệt được với điểm chuẩn', () => {
  const band = recon.bandForMinutes(20); // 16-30 phút, ngưỡng tham khảo 2 lần/tháng
  const s = recon.computeSuggestion({ employeeCode: 'PHF004', occurredDate: '2026-08-20', minutesLate: 20 }, [
    { employeeCode: 'PHF004', occurredDate: '2026-08-20', managerDecision: 'approved', createdAt: '2026-08-20T08:00:00Z' }
  ]);
  const warning = recon.buildFrequencyWarning({ band, occurrencesInPeriod: 3, managerDecision: 'approved', employeeName: 'Nguyễn Văn A' });
  assert.strictEqual(warning.overThreshold, true);
  assert.strictEqual(warning.referenceOnly, true);
  assert.ok(/mức tham khảo Nội quy là 2 lần/.test(warning.message));
  // Suggestion không hề bị warning tác động — vẫn 0 điểm (Có xin phép) dù cảnh báo vượt ngưỡng.
  assert.strictEqual(s.suggestedPoints, 0);
  // Dòng có cảnh báo vượt ngưỡng KHÔNG được gom bulk-approve (phải xử lý riêng)...
  assert.strictEqual(recon.isEligibleForBulkApprove(s, warning, null), false);
  // ...nhưng Admin đồng ý áp dụng ĐÚNG điểm gợi ý hệ thống (không đổi số) vẫn là hành động hợp lệ
  // ở tầng approve — warning không có trường "blocking"/"denied" nào cả.
  assert.strictEqual(Object.prototype.hasOwnProperty.call(warning, 'blocking'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(warning, 'denied'), false);
});
check('Không vượt ngưỡng tham khảo -> không có message cảnh báo', () => {
  const band = recon.bandForMinutes(10);
  const warning = recon.buildFrequencyWarning({ band, occurrencesInPeriod: 2, managerDecision: 'rejected' });
  assert.strictEqual(warning.overThreshold, false);
  assert.strictEqual(warning.message, '');
});
check('KHÔNG có bất kỳ hàm nào trong module thực hiện chặn theo số lần (grep-guard chống hồi quy "if count >= N block")', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'checklist-late-reconciliation.js'), 'utf8');
  assert.ok(!/suggestedPoints\s*=\s*0.*overThreshold/i.test(src));
  assert.ok(!/fail\(.*(qu(á|a) ng(ư|u)(ỡ|o)ng|vư(ợ|o)t ng(ư|u)(ỡ|o)ng)/i.test(src));
});

/* ================= Định danh sự kiện: 2 sự kiện thật khác nhau trong 1 ngày phải tách biệt ================= */
check('Định danh KHÔNG chỉ dựa employee+date — 2 ca khác giờ/mã giao dịch trong cùng ngày có identityKey khác nhau', () => {
  const morning = recon.buildEventIdentity({ employeeCode: 'PHF005', occurredDate: '2026-08-11', shift: 'sáng', checkinTime: '08:10', bccTransactionId: 'TX-001' });
  const afternoon = recon.buildEventIdentity({ employeeCode: 'PHF005', occurredDate: '2026-08-11', shift: 'chiều', checkinTime: '13:10', bccTransactionId: 'TX-002' });
  assert.notStrictEqual(morning.identityKey, afternoon.identityKey);
  assert.strictEqual(morning.needsReview, false);
  assert.strictEqual(afternoon.needsReview, false);
});
check('Thiếu cả transaction id lẫn ca/giờ -> đánh dấu cần kiểm tra (không tự merge liều lĩnh)', () => {
  const ambiguous = recon.buildEventIdentity({ employeeCode: 'PHF006', occurredDate: '2026-08-11' });
  assert.strictEqual(ambiguous.needsReview, true);
  const suggestion = recon.computeSuggestion({ employeeCode: 'PHF006', occurredDate: '2026-08-11', minutesLate: 10 }, []);
  assert.strictEqual(suggestion.matchStatus, 'ambiguous_needs_review');
});
check('2 sự kiện thật khác nhau cùng ngày (khác ca/giờ/mã GD) đều sống sót độc lập qua classifyImportRows -> cả 2 đều "new" (không mất dòng nào, không tự động gộp thành 1)', () => {
  const rowA = { employeeCode: 'PHF007', occurredDate: '2026-08-12', shift: 'sáng', checkinTime: '08:05', bccTransactionId: 'TX-A', minutesLate: 10 };
  const rowB = { employeeCode: 'PHF007', occurredDate: '2026-08-12', shift: 'chiều', checkinTime: '13:20', bccTransactionId: 'TX-B', minutesLate: 20 };
  const { new: fresh } = recon.classifyImportRows([rowA, rowB], new Map());
  assert.strictEqual(fresh.length, 2);
  assert.notStrictEqual(fresh[0].importRowKey, fresh[1].importRowKey);
});

/* ================= Idempotency: re-upload y hệt là no-op ================= */
check('Re-upload đúng 1 dòng y hệt -> importRowKey trùng -> classify là identical (no_op), không tạo trùng', () => {
  const row = { employeeCode: 'PHF008', occurredDate: '2026-08-13', shift: 'sáng', checkinTime: '08:00', bccTransactionId: 'TX-IDEMP', minutesLate: 12 };
  const key = recon.buildImportRowKey(row);
  const existingByKey = new Map([[key, { row, status: 'draft' }]]);
  const { identical, changed, new: fresh } = recon.classifyImportRows([row], existingByKey);
  assert.strictEqual(identical.length, 1);
  assert.strictEqual(changed.length, 0);
  assert.strictEqual(fresh.length, 0);
  const actions = recon.applyReconciliationChoice({ identical, changed, new: fresh }, recon.RECONCILE_CHOICE.UPDATE_NEWEST);
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].type, 'no_op');
});

/* ================= 3 lựa chọn đối soát khi trùng khoảng ngày ================= */
function buildChangedClassification(existingStatus) {
  const row = { employeeCode: 'PHF009', occurredDate: '2026-08-14', shift: 'sáng', checkinTime: '08:00', bccTransactionId: 'TX-C', minutesLate: 20 };
  const oldRow = { ...row, minutesLate: 10 }; // nội dung đổi (số phút khác)
  const key = recon.buildImportRowKey(row);
  const oldKey = recon.buildImportRowKey(oldRow);
  // Cùng identityKey nhưng khác nội dung -> mô phỏng bằng cách ép existing map dùng key mới
  // trỏ tới oldRow (đúng kịch bản: BCC gửi lại đúng 1 giao dịch nhưng số phút được sửa).
  const existingByKey = new Map([[key, { row: oldRow, status: existingStatus }]]);
  return recon.classifyImportRows([row], existingByKey);
}
check('keep_old: giữ dữ liệu cũ, dòng thay đổi (chưa chính thức) không bị ghi đè', () => {
  const c = buildChangedClassification('draft');
  const actions = recon.applyReconciliationChoice(c, recon.RECONCILE_CHOICE.KEEP_OLD);
  assert.strictEqual(actions[0].type, 'no_op');
  assert.strictEqual(actions[0].rowStatus, recon.ROW_STATUS.CHANGED);
});
check('update_newest: chỉ cập nhật dòng ĐÃ XÁC NHẬN thay đổi (chưa chính thức) thành draft mới', () => {
  const c = buildChangedClassification('draft');
  const actions = recon.applyReconciliationChoice(c, recon.RECONCILE_CHOICE.UPDATE_NEWEST);
  assert.strictEqual(actions[0].type, 'replace_draft');
  assert.strictEqual(actions[0].rowStatus, recon.ROW_STATUS.PENDING_APPROVAL);
});
check('row_by_row: thiếu quyết định riêng -> needs_review, không tự suy diễn; có quyết định "update"/"keep" thì theo đúng lựa chọn', () => {
  const c1 = buildChangedClassification('draft');
  const noDecision = recon.applyReconciliationChoice(c1, recon.RECONCILE_CHOICE.ROW_BY_ROW, { rowDecisions: {} });
  assert.strictEqual(noDecision[0].type, 'await_decision');
  assert.strictEqual(noDecision[0].rowStatus, recon.ROW_STATUS.NEEDS_REVIEW);

  const c2 = buildChangedClassification('draft');
  const key = c2.changed[0].importRowKey;
  const withUpdate = recon.applyReconciliationChoice(c2, recon.RECONCILE_CHOICE.ROW_BY_ROW, { rowDecisions: { [key]: 'update' } });
  assert.strictEqual(withUpdate[0].type, 'replace_draft');

  const c3 = buildChangedClassification('draft');
  const key3 = c3.changed[0].importRowKey;
  const withKeep = recon.applyReconciliationChoice(c3, recon.RECONCILE_CHOICE.ROW_BY_ROW, { rowDecisions: { [key3]: 'keep' } });
  assert.strictEqual(withKeep[0].type, 'no_op');
});
check('Bất biến: dòng ĐÃ CHÍNH THỨC (official) không bao giờ bị "replace_draft" dù chọn update_newest — luôn tạo linked adjustment', () => {
  const c = buildChangedClassification('official');
  const actionsKeepOld = recon.applyReconciliationChoice(c, recon.RECONCILE_CHOICE.KEEP_OLD);
  const actionsUpdateNewest = recon.applyReconciliationChoice(c, recon.RECONCILE_CHOICE.UPDATE_NEWEST);
  const actionsRowByRow = recon.applyReconciliationChoice(c, recon.RECONCILE_CHOICE.ROW_BY_ROW, { rowDecisions: {} });
  [actionsKeepOld, actionsUpdateNewest, actionsRowByRow].forEach(actions => {
    assert.strictEqual(actions[0].type, 'create_linked_adjustment');
    assert.notStrictEqual(actions[0].type, 'replace_draft');
    assert.strictEqual(actions[0].reasonRequired, true);
  });
});

/* ================= Bulk-approve chỉ cho dòng sạch ================= */
check('Bulk-approve: loại trừ dòng cần kiểm tra / có cảnh báo vượt ngưỡng / đã bị Admin điều chỉnh khác gợi ý', () => {
  const cleanSuggestion = recon.computeSuggestion({ employeeCode: 'PHF010', occurredDate: '2026-08-15', shift: 'sáng', checkinTime: '08:10', minutesLate: 10 }, [
    { employeeCode: 'PHF010', occurredDate: '2026-08-15', managerDecision: 'rejected', createdAt: '2026-08-15T08:00:00Z' }
  ]);
  const noWarning = recon.buildFrequencyWarning({ band: cleanSuggestion.band, occurrencesInPeriod: 1, managerDecision: 'rejected' });
  assert.strictEqual(recon.isEligibleForBulkApprove(cleanSuggestion, noWarning, null), true);
  assert.strictEqual(recon.isEligibleForBulkApprove(cleanSuggestion, noWarning, { appliedPoints: 99 }), false);

  const ambiguous = recon.computeSuggestion({ employeeCode: 'PHF011', occurredDate: '2026-08-15', minutesLate: 10 }, []);
  const forcedAmbiguous = { ...ambiguous, matchStatus: 'ambiguous_needs_review' };
  assert.strictEqual(recon.isEligibleForBulkApprove(forcedAmbiguous, noWarning, null), false);
});

/* ================= Bằng chứng permission thật: TRUONG_CA_BH dùng subjectMatchesScope() ================= */
check('TRUONG_CA_BH record_scope (department_branch) cho phép nhân sự đúng phòng ban/chi nhánh, từ chối ngoài phạm vi (crafted out-of-scope)', () => {
  const grant = PRESETS.TRUONG_CA_BH;
  assert.strictEqual(grant.capabilities.record_violation, true);
  const inScope = subjectMatchesScope({ department: 'Bán hàng', branch: 'Phú Lợi' }, grant.recordScope, {});
  const outOfScopeDept = subjectMatchesScope({ department: 'Kế toán', branch: 'Phú Lợi' }, grant.recordScope, {});
  const outOfScopeBranch = subjectMatchesScope({ department: 'Bán hàng', branch: 'Chi nhánh khác' }, grant.recordScope, {});
  assert.strictEqual(inScope, true);
  assert.strictEqual(outOfScopeDept, false);
  assert.strictEqual(outOfScopeBranch, false);
});
check('Service ghi nhận nhanh (BẤT KỲ ai có quyền, không riêng Trưởng ca) KHÔNG hardcode requireAdmin() — dùng requireViolationPermission() thật (grep-guard chống hồi quy)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'checklist-late-reconciliation-service.js'), 'utf8');
  const fnStart = src.indexOf('async function recordManagerLateObservation');
  const fnEnd = src.indexOf('\n// Bí danh tương thích ngược');
  assert.ok(fnStart > -1 && fnEnd > fnStart);
  const fnBody = src.slice(fnStart, fnEnd);
  assert.ok(!/requireAdmin\(/.test(fnBody), 'recordManagerLateObservation không được gọi requireAdmin()');
  assert.ok(/requireViolationPermission\(session,\s*'record'/.test(fnBody), 'phải gọi requireViolationPermission(session,"record",...) — RECORD scope, không phải view scope');
  assert.ok(!/role\s*===\s*['"]truong_ca['"]/i.test(fnBody), 'không được so khớp cứng theo role string cụ thể nào');
});
check('Grep-guard: domain logic (lib/checklist-late-reconciliation*.js) không hardcode "Trưởng ca"/"truong_ca" làm ĐIỀU KIỆN quyền — chỉ được nhắc tới (nếu có) như ví dụ minh hoạ trong comment', () => {
  const reconSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'checklist-late-reconciliation.js'), 'utf8');
  const serviceSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'checklist-late-reconciliation-service.js'), 'utf8');
  [reconSrc, serviceSrc].forEach(src => {
    assert.ok(!/role\s*===\s*['"]truong_ca['"]/i.test(src));
    assert.ok(!/preset(Code)?\s*===\s*['"]TRUONG_CA/i.test(src), 'không được so khớp cứng theo preset_code Trưởng ca để cấp/chặn quyền ghi nhận');
    assert.ok(!/checklist_late_shift_lead_records/.test(src), 'tên bảng phải là checklist_late_manager_observations (tên chung), không còn tên bảng cũ');
  });
});

/* ================= Điểm chuẩn không đổi dù có cảnh báo — kiểm tra toàn bộ 4 mức lần lượt ================= */
check('4 băng phút đều đúng ngưỡng tham khảo 4/2/1/1 lần/tháng theo brief', () => {
  const byKey = Object.fromEntries(recon.LATE_BANDS.map(b => [b.key, b]));
  assert.strictEqual(byKey.b1_15.referenceMonthlyCount, 4);
  assert.strictEqual(byKey.b16_30.referenceMonthlyCount, 2);
  assert.strictEqual(byKey.b31_45.referenceMonthlyCount, 1);
  assert.strictEqual(byKey.b46_up.referenceMonthlyCount, 1);
});

/* ================= Đối chiếu NHIỀU người ghi nhận cùng 1 sự kiện (vòng generalize) ================= */
check('2 người ghi nhận CÙNG kết quả (đều Không xin phép) -> gộp 1 kết quả duy nhất (matched_agreed), KHÔNG double-count, vẫn giữ audit trail cả 2 người', () => {
  const bccRow = { employeeCode: 'PHF020', occurredDate: '2026-08-16', shift: 'sáng', checkinTime: '08:05', minutesLate: 20 };
  const managerRecords = [
    { employeeCode: 'PHF020', occurredDate: '2026-08-16', managerDecision: 'rejected', createdAt: '2026-08-16T08:10:00Z', createdByName: 'Trưởng ca A', department: 'Bán hàng' },
    { employeeCode: 'PHF020', occurredDate: '2026-08-16', managerDecision: 'rejected', createdAt: '2026-08-16T09:00:00Z', createdByName: 'Trưởng bộ phận B', department: 'Bán hàng' }
  ];
  const s = recon.computeSuggestion(bccRow, managerRecords);
  assert.strictEqual(s.matchStatus, 'matched_agreed');
  assert.strictEqual(s.managerDecision, 'rejected');
  // Đúng 1 kết quả điểm gợi ý (band 16-30 phút = 6đ) — KHÔNG bị nhân đôi vì có 2 người ghi nhận.
  assert.strictEqual(s.suggestedPoints, 6);
  assert.strictEqual(s.recorders.length, 2, 'audit trail phải giữ đủ 2 người ghi nhận gốc, không chỉ mỗi kết quả gộp');
  assert.deepStrictEqual(s.recorders.map(r => r.recordedByName).sort(), ['Trưởng bộ phận B', 'Trưởng ca A']);
});
check('2 người ghi nhận KHÁC kết quả (1 Có xin phép, 1 Không xin phép) -> conflict_needs_review, KHÔNG tự chọn theo thời điểm gần nhất, suggestedPoints=null (chưa có gợi ý cho tới khi Admin chọn)', () => {
  const bccRow = { employeeCode: 'PHF021', occurredDate: '2026-08-16', shift: 'chiều', checkinTime: '13:05', minutesLate: 20 };
  const managerRecords = [
    { employeeCode: 'PHF021', occurredDate: '2026-08-16', managerDecision: 'approved', createdAt: '2026-08-16T13:10:00Z', createdByName: 'Trưởng ca A' },
    { employeeCode: 'PHF021', occurredDate: '2026-08-16', managerDecision: 'rejected', createdAt: '2026-08-16T18:00:00Z', createdByName: 'Trưởng bộ phận B' } // ghi nhận SAU nhưng KHÔNG được tự thắng
  ];
  const s = recon.computeSuggestion(bccRow, managerRecords);
  assert.strictEqual(s.matchStatus, 'conflict_needs_review');
  assert.strictEqual(s.managerDecision, null);
  assert.strictEqual(s.suggestedPoints, null);
  assert.strictEqual(s.recorders.length, 2, 'cả 2 input mâu thuẫn đều phải được giữ lại để Admin xem, không loại bỏ bên nào');
  const byName = Object.fromEntries(s.recorders.map(r => [r.recordedByName, r.managerDecision]));
  assert.strictEqual(byName['Trưởng ca A'], 'approved');
  assert.strictEqual(byName['Trưởng bộ phận B'], 'rejected');
});
check('reconcileManagerRecords: 1 người ghi nhận duy nhất -> status "single" (hành vi cũ giữ nguyên, không coi là gộp/mâu thuẫn)', () => {
  const r = recon.reconcileManagerRecords([{ employeeCode: 'PHF022', managerDecision: 'rejected', createdByName: 'X' }]);
  assert.strictEqual(r.status, 'single');
  assert.strictEqual(r.managerDecision, 'rejected');
});
check('reconcileManagerRecords: rỗng -> status "no_record"', () => {
  const r = recon.reconcileManagerRecords([]);
  assert.strictEqual(r.status, 'no_record');
  assert.strictEqual(r.managerDecision, null);
});
check('isEligibleForBulkApprove: dòng conflict_needs_review KHÔNG BAO GIỜ được gom bulk-approve', () => {
  const conflictSuggestion = { matchStatus: 'conflict_needs_review', suggestedPoints: null };
  assert.strictEqual(recon.isEligibleForBulkApprove(conflictSuggestion, null, null), false);
});
check('Chống double-deduction: 3 người ghi nhận cùng đồng ý "Không xin phép" cho CÙNG 1 sự kiện vẫn chỉ ra đúng 1 suggestedPoints (không cộng dồn theo số người ghi nhận)', () => {
  const bccRow = { employeeCode: 'PHF023', occurredDate: '2026-08-17', shift: 'sáng', checkinTime: '08:00', minutesLate: 50 }; // band 12đ
  const managerRecords = [
    { employeeCode: 'PHF023', occurredDate: '2026-08-17', managerDecision: 'rejected', createdAt: '2026-08-17T08:05:00Z', createdByName: 'A' },
    { employeeCode: 'PHF023', occurredDate: '2026-08-17', managerDecision: 'rejected', createdAt: '2026-08-17T08:06:00Z', createdByName: 'B' },
    { employeeCode: 'PHF023', occurredDate: '2026-08-17', managerDecision: 'rejected', createdAt: '2026-08-17T08:07:00Z', createdByName: 'C' }
  ];
  const s = recon.computeSuggestion(bccRow, managerRecords);
  assert.strictEqual(s.matchStatus, 'matched_agreed');
  assert.strictEqual(s.suggestedPoints, 12, 'điểm gợi ý phải đúng 1 lần theo băng phút trễ, KHÔNG nhân theo số người ghi nhận (12 * 3 sẽ SAI)');
  assert.strictEqual(s.recorders.length, 3);
});
check('matchManagerRecords: chỉ khớp đúng nhân sự + đúng ngày, không lẫn ghi nhận của người/ngày khác', () => {
  const bccRow = { employeeCode: 'PHF024', occurredDate: '2026-08-18' };
  const records = [
    { employeeCode: 'PHF024', occurredDate: '2026-08-18', managerDecision: 'approved' },
    { employeeCode: 'PHF024', occurredDate: '2026-08-19', managerDecision: 'rejected' }, // khác ngày -> không khớp
    { employeeCode: 'PHF025', occurredDate: '2026-08-18', managerDecision: 'rejected' }  // khác người -> không khớp
  ];
  const matched = recon.matchManagerRecords(bccRow, records);
  assert.strictEqual(matched.length, 1);
});

console.log('\n' + passCount + ' bài kiểm tra Workstream B (Đi trễ BCC/ghi nhận từ bộ phận/Admin) đều PASS.');
