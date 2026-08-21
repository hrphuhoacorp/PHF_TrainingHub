'use strict';
/*
 * PHF Checklist — Workstream A remediation engine (2026-08-14, revised at
 * FINAL SANITY GATE cùng ngày).
 *
 * LỊCH SỬ: bản đầu của file này tự động thêm 1 dòng checklist_total trọng số
 * 10 và co giãn tỉ lệ toàn bộ các dòng còn lại cho đủ tổng 100. Gate rà soát
 * cuối Workstream A đã tìm bằng chứng cho con số 10%: không có migration .sql
 * nào, không có checklist_score_policy/policy tương đương nào, không có mẫu
 * "chuẩn" nào từng chạy đúng với dòng checklist_total trước phiên làm việc
 * này định nghĩa con số đó — "10" chỉ là số được chọn thủ công cho 6 mẫu đầu
 * tiên trong CHÍNH phiên này rồi tổng quát hoá ngược thành "quy ước", tức một
 * quyết định chính sách chấm điểm (đổi trọng số tương đối của MỌI tiêu chí
 * khác trong mẫu) bị ngụy trang thành mặc định kỹ thuật. Vì vậy:
 *
 *   - Hàm ở đây KHÔNG còn chọn trọng số hộ Admin và KHÔNG còn co giãn bất kỳ
 *     dòng nào nữa. Không có hằng số trọng số mặc định nào trong file này.
 *   - Việc engine làm bây giờ CHỈ là PHÁT HIỆN (detect): đọc definition, xác
 *     định mẫu có kích hoạt gate hay không (requiresChecklistTotalRow), mẫu
 *     đã có dòng checklist_total hợp lệ hay chưa, và trả về một PLAN object
 *     mô tả đúng hiện trạng — không mutate, không thêm dòng, không đổi số.
 *   - Việc thêm dòng checklist_total (chọn tên, mã, mục tiêu, ĐẶC BIỆT là
 *     trọng số, và có co giãn các dòng khác hay không) phải do Admin thao
 *     tác tường minh qua wizard /admin/checklist/ap-dung-lai-mau — xem
 *     checklistRetroWizardHtml() trong assets/js/checklist/phf-checklist-app.js.
 *     Wizard có thể cung cấp một nút "Co giãn tỉ lệ" TÙY CHỌN (tiện ích, không
 *     bắt buộc, Admin phải bấm mới chạy) nhưng KHÔNG được tự động chạy khi chỉ
 *     phát hiện thiếu dòng.
 *
 * Input: definition {groups, totalRows, templateType} — đúng shape mà
 * lib/checklist-templates.js validateScoredDefinition()/requiresChecklistTotalRow()
 * đã hiểu.
 *
 * Hàm KHÔNG mutate definition đầu vào, KHÔNG gọi DB, KHÔNG side-effect — an
 * toàn để unit-test 100% in-memory và để gọi lại nhiều lần (idempotent, vì
 * chỉ đọc chứ không ghi).
 */
const {requiresChecklistTotalRow, isChecklistTotalRow} = require('./checklist-templates');
const {rowWeight} = require('./checklist-template-retroactive');

function round4(n) { return Math.round(n * 10000) / 10000; }

/*
 * planTotalRowRemediation(definition) -> plan
 *
 * plan.action:
 *   'none'                    — không kích hoạt gate, hoặc đã có dòng checklist_total hợp lệ rồi.
 *   'needs-admin-input'       — kích hoạt gate, THIẾU dòng checklist_total. KHÔNG có gợi ý trọng số nào
 *                                trong plan này — Admin phải tự nhập qua wizard.
 *
 * plan không có addedRow/definition mới/newRowWeight nào — hàm không tạo ra bất kỳ
 * dữ liệu chấm điểm nào, chỉ mô tả hiện trạng để UI/audit hiển thị.
 * Hàm chỉ nhận 1 tham số (definition) — cố ý, để không thể "lách" hardcode
 * trọng số qua caller/options như bản trước.
 */
function planTotalRowRemediation(definition) {
  const def = definition && typeof definition === 'object' ? definition : { groups: [], totalRows: [], templateType: 'checklist_detail' };
  const rows = Array.isArray(def.totalRows) ? def.totalRows : [];

  if (!requiresChecklistTotalRow(def)) {
    return { action: 'none', reason: 'NOT_CHECKLIST_SCORED', definition: def, changed: false };
  }
  if (rows.some(isChecklistTotalRow)) {
    return { action: 'none', reason: 'ALREADY_HAS_CHECKLIST_TOTAL_ROW', definition: def, changed: false };
  }

  const totalWeightBefore = round4(rows.reduce((s, r) => s + rowWeight(r), 0));
  return {
    action: 'needs-admin-input',
    reason: 'CHECKLIST_TOTAL_ROW_MISSING',
    definition: def,
    changed: false,
    existingRowCount: rows.length,
    totalWeightBefore,
    message: 'Mẫu có nhóm tiêu chí Checklist nhưng Bảng tổng điểm chưa có dòng nhận điểm Checklist (source.type=checklist_total). Admin cần thêm dòng và nhập trọng số tường minh qua wizard "Áp dụng lại mẫu" (/admin/checklist/ap-dung-lai-mau) — hệ thống không tự chọn trọng số hoặc co giãn các dòng khác.'
  };
}

module.exports = { planTotalRowRemediation };
